# 写一个 MCP server

这一章把前四章的内容落成代码：用官方 TypeScript SDK 给 hatch-shelf 的书库写一个 MCP server，叫 `shelf-books`。它提供三个只读工具、一个资源模板和一个提示模板，带完整的测试，最后接进 Claude Code。

代码基于 `@modelcontextprotocol/server` 2.4.0（SDK 2.x 系列，实现 2026-07-28 版协议，同时兼容旧版客户端）和 zod 4，运行在 Node 22 上。本章所有代码都在这个版本上实际跑通过。

## SDK 1.x 与 2.x

动手之前先分清版本，因为网上大量教程还是 1.x 的写法：

| | SDK 1.x | SDK 2.x |
|---|---|---|
| 包名 | `@modelcontextprotocol/sdk`（一个包） | `@modelcontextprotocol/server`、`@modelcontextprotocol/client` 等多个包 |
| 导入 | `@modelcontextprotocol/sdk/server/mcp.js` 这类深路径 | `@modelcontextprotocol/server`、`@modelcontextprotocol/server/stdio` |
| `inputSchema` | zod 的「原始形状」对象 `{ a: z.string() }` | 完整的 schema `z.object({ a: z.string() })` |
| stdio 启动 | `new StdioServerTransport()` + `server.connect()` | `serveStdio(factory)` |
| HTTP | 每个请求手动创建 transport | `createMcpHandler(factory)`，返回 web 标准的 `fetch` 处理函数 |
| 协议错误类 | `McpError` / `ErrorCode` | `ProtocolError` / `ProtocolErrorCode` |
| 协议版本 | 2025-11-25 及更早 | 2026-07-28，并兼容旧版 |

《Agent 原理与设计》第 8 章的最小示例用的是 1.x 写法。1.x 在 2.x 发布后仍会维护一段时间（只修 bug 和安全问题），已有项目可以用官方提供的 codemod 迁移。新项目直接用 2.x。

2.x 有一个值得注意的设计：包的根入口是**运行时中立**的，不依赖任何 Node 内置模块，所以同一份 server 代码可以跑在 Node、Cloudflare Workers、Deno、Bun 上；需要启动子进程的 stdio 相关代码放在 `/stdio` 子路径里，只有显式导入时才会进入打包结果。

## 设计：先写下工具清单

按第 1 章的方法，先想清楚 agent 会用它做什么：

- 「ai/agent 分类下有哪些书？」
- 「读一下《Agent 原理与设计》讲 MCP 的那一章」
- 「这本书推送前还有格式问题吗？」

对应三个工具，全部只读：

| 工具 | 参数 | 返回 | 注解 |
|---|---|---|---|
| `list_books` | `category?` 分类前缀 | 书的 id、书名、分类、难度、章节数 | 只读、不触达外部 |
| `read_chapter` | `bookId`、`file`、`offset` | 章节正文，每次最多 200 行，带分页头 | 只读、不触达外部 |
| `check_book` | `bookId` | 是否通过、错误、提示 | 只读、不触达外部 |

再加一个资源模板 `shelf://books/{bookId}/book.yaml`（让用户把某本书的元数据附加进上下文）和一个提示模板 `review-book`（一键发起「审读一本书」的工作流）。

一个关键的设计决定：**`check_book` 复用 `@shelf/spec` 的 `lintBook`**。hatch-shelf 的原则是「判断书籍结构的逻辑只写在 `@shelf/spec`」，App 的导入管线和 `shelf-pack check` 都调用它。MCP server 作为第三个调用方，同样不应该自己实现一套校验规则，否则三处规则迟早会不一致。

## 项目结构

放在仓库的 `tools/shelf-mcp/`，作为 pnpm workspace 的一个包，和 `shelf-pack` 并列：

```text
tools/shelf-mcp/
├── package.json
├── tsconfig.json
└── src/
    ├── library.ts       # 书库访问：路径校验、读取、调用 @shelf/spec
    ├── server.ts        # createServer 工厂：注册工具、资源、提示模板
    ├── stdio.ts         # stdio 入口
    └── server.test.ts   # 用内存中的客户端测试
```

把「书库访问」和「MCP 注册」分成两个文件：`library.ts` 是普通的 TypeScript 函数，可以单独测试、被别的入口复用；`server.ts` 只负责把这些函数包装成工具。

`package.json`：

```json
{
  "name": "shelf-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/stdio.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@modelcontextprotocol/server": "^2.4.0",
    "@shelf/spec": "workspace:*",
    "zod": "^4.6.7"
  },
  "devDependencies": {
    "@modelcontextprotocol/client": "^2.4.0",
    "@types/node": "^22",
    "tsx": "^4.23.15",
    "typescript": "~6.0.3",
    "vitest": "^5.0.5"
  }
}
```

`"type": "module"` 是必需的，SDK 只发布 ES 模块。`tsconfig.json` 沿用仓库的基础配置：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src"]
}
```

在仓库根目录执行 `pnpm install` 即可。客户端包只在测试里用到，所以放在 `devDependencies`。

## 书库访问层

```typescript
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintBook, type LintFile, type LintResult } from '@shelf/spec';

/** books/ 根目录：由启动配置决定，不接受模型传入。默认是仓库根目录下的 books/ */
export const BOOKS_ROOT = path.resolve(
  process.env.SHELF_BOOKS_DIR ?? fileURLToPath(new URL('../../../books', import.meta.url)),
);

const BOOK_ID = /^[a-z0-9-]+$/;
const TEXT = /\.(md|ya?ml)$/i;

export class ToolInputError extends Error {}

/** 把 bookId 解析成真实目录，拒绝一切逃出 BOOKS_ROOT 的路径 */
export async function bookDir(bookId: string): Promise<string> {
  if (!BOOK_ID.test(bookId)) {
    throw new ToolInputError(`bookId 只能包含小写字母、数字和连字符，收到 "${bookId}"`);
  }
  const root = await realpath(BOOKS_ROOT); // 根目录本身也可能经过符号链接
  let real: string;
  try {
    real = await realpath(path.join(root, bookId));
  } catch {
    throw new ToolInputError(`没有 id 为 "${bookId}" 的书。先调用 list_books 查看可用的 id`);
  }
  if (!real.startsWith(root + path.sep)) {
    throw new ToolInputError(`"${bookId}" 指向 books 目录之外，拒绝访问`);
  }
  return real;
}

/** 读出一本书的全部文件，交给 @shelf/spec 校验，与 shelf-pack check 同一套规则 */
export async function lintLocalBook(bookId: string): Promise<LintResult> {
  const dir = await bookDir(bookId);
  const files: LintFile[] = [];
  const walk = async (sub: string) => {
    for (const name of await readdir(path.join(dir, sub))) {
      if (name.startsWith('.')) continue;
      const rel = sub ? `${sub}/${name}` : name;
      const abs = path.join(dir, rel);
      const st = await stat(abs);
      if (st.isDirectory()) await walk(rel);
      else files.push({ path: rel, size: st.size, text: TEXT.test(name) ? await readFile(abs, 'utf8') : undefined });
    }
  };
  await walk('');
  return lintBook(bookId, files);
}

export interface BookSummary {
  id: string;
  title: string;
  category?: string;
  level?: string;
  chapters: number;
}

export async function listBooks(): Promise<BookSummary[]> {
  const out: BookSummary[] = [];
  for (const name of (await readdir(BOOKS_ROOT)).sort()) {
    if (!BOOK_ID.test(name)) continue;
    const st = await stat(path.join(BOOKS_ROOT, name));
    if (!st.isDirectory()) continue;
    const r = await lintLocalBook(name);
    if (!r.manifest) continue; // 没有合法 book.yaml 的目录跳过，check_book 能看到原因
    const m = r.manifest;
    out.push({ id: m.id, title: m.title, category: m.category, level: m.level, chapters: r.chapters.length });
  }
  return out;
}

export async function readChapter(bookId: string, file: string): Promise<string> {
  const r = await lintLocalBook(bookId);
  if (!r.chapters.includes(file)) {
    throw new ToolInputError(`《${r.manifest?.title ?? bookId}》没有章节 "${file}"。可用章节：${r.chapters.join(', ')}`);
  }
  return readFile(path.join(await bookDir(bookId), file), 'utf8');
}
```

几个要点：

- **根目录来自配置**：`SHELF_BOOKS_DIR` 环境变量，缺省时按源文件位置推出仓库的 `books/`。模型永远不能指定根目录（第 2 章「配置不是参数」）
- **两道路径防线**：先用正则限定 `bookId` 的字符集，挡住 `../` 之类的输入；再用 `realpath` 解析出真实路径（包括符号链接），确认仍在根目录之内。只做字符串检查不够，目录里的一个符号链接就可能指向外面
- **章节必须在清单里**：`readChapter` 只允许读 `book.yaml` 的 `chapters` 中列出的文件，而不是目录里任意 `.md`，这和阅读器的行为一致
- **错误分两类**：`ToolInputError` 表示模型能修正的输入问题，消息写成可行动的形式；其他异常属于意外故障

`listBooks` 对每本书都跑一遍完整校验，书多了会慢。几十本书的规模下没问题；规模变大时可以只解析 `book.yaml`，或者按文件修改时间缓存。

## 注册工具、资源和提示模板

```typescript
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { bookDir, lintLocalBook, listBooks, readChapter, ToolInputError } from './library';

const MAX_LINES = 200;

/** 把可预期的错误变成模型能读懂的工具错误，其余异常照常抛出 */
function toolError(e: unknown) {
  if (e instanceof ToolInputError) {
    return { content: [{ type: 'text' as const, text: e.message }], isError: true };
  }
  throw e;
}

export function createServer(): McpServer {
  const server = new McpServer({ name: 'shelf-books', version: '0.1.0' });

  const bookSummary = z.object({
    id: z.string(),
    title: z.string(),
    category: z.string().optional(),
    level: z.string().optional(),
    chapters: z.number().int(),
  });

  server.registerTool(
    'list_books',
    {
      title: '列出书架上的书',
      description:
        '列出 books/ 下所有能通过解析的书：id、书名、分类、难度、章节数。' +
        '可按分类前缀过滤（如 ai/agent 会匹配 ai/agent 及其子分类）。' +
        '只读元数据，不读正文；要读正文用 read_chapter，要查格式问题用 check_book。',
      inputSchema: z.object({
        category: z.string().optional().describe('分类前缀，如 ai 或 ai/agent；不填返回全部'),
      }),
      outputSchema: z.object({ books: z.array(bookSummary) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ category }) => {
      const all = await listBooks();
      const books = category
        ? all.filter((b) => b.category === category || b.category?.startsWith(`${category}/`))
        : all;
      const text = books.length
        ? books.map((b) => `${b.id}\t${b.title}\t${b.category ?? '-'}\t${b.chapters} 章`).join('\n')
        : `没有分类以 "${category}" 开头的书。现有分类：${[...new Set(all.map((b) => b.category ?? '-'))].join(', ')}`;
      return { content: [{ type: 'text', text }], structuredContent: { books } };
    },
  );

  server.registerTool(
    'read_chapter',
    {
      title: '读取章节',
      description:
        `读取某本书的一个章节，按行分页，每次最多 ${MAX_LINES} 行。` +
        '返回内容开头会标明总行数和本次范围；没读完时用 offset 继续。' +
        'file 必须是 book.yaml 的 chapters 里列出的文件名，如 01-what-is-agent.md。',
      inputSchema: z.object({
        bookId: z.string().describe('书的 id，来自 list_books'),
        file: z.string().describe('章节文件名，如 03-tools-and-actions.md'),
        offset: z.number().int().min(0).default(0).describe('从第几行开始（0 起）'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ bookId, file, offset }) => {
      try {
        const lines = (await readChapter(bookId, file)).split('\n');
        const end = Math.min(offset + MAX_LINES, lines.length);
        const more = end < lines.length ? `，还有 ${lines.length - end} 行，用 offset=${end} 继续` : '，已到结尾';
        const header = `[${bookId}/${file} 共 ${lines.length} 行，本次 ${offset + 1}-${end} 行${more}]`;
        return { content: [{ type: 'text', text: `${header}\n${lines.slice(offset, end).join('\n')}` }] };
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    'check_book',
    {
      title: '校验一本书',
      description:
        '按写书规范校验一本书（与 shelf-pack check 同一套规则）：book.yaml 字段、章节 H1、' +
        '代码块语言、远程图片、缺失的 assets 等。返回错误和提示；errors 为空才算通过。' +
        '修改书的内容后应该调用它确认没有引入新问题。',
      inputSchema: z.object({ bookId: z.string().describe('书的 id，来自 list_books') }),
      outputSchema: z.object({
        ok: z.boolean(),
        errors: z.array(z.string()),
        warnings: z.array(z.string()),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ bookId }) => {
      try {
        const r = await lintLocalBook(bookId);
        const result = { ok: r.errors.length === 0 && !!r.manifest, errors: r.errors, warnings: r.warnings };
        const text = result.ok
          ? `${bookId} 通过校验${r.warnings.length ? `，另有 ${r.warnings.length} 条提示：\n${r.warnings.join('\n')}` : ''}`
          : `${bookId} 有 ${r.errors.length} 个错误：\n${r.errors.join('\n')}`;
        return { content: [{ type: 'text', text }], structuredContent: result };
      } catch (e) {
        return toolError(e);
      }
    },
  );

  // 资源：由用户或宿主选择附加到上下文，例如在 Claude Code 里用 @ 引用
  server.registerResource(
    'book-manifest',
    new ResourceTemplate('shelf://books/{bookId}/book.yaml', {
      list: async () => ({
        resources: (await listBooks()).map((b) => ({
          uri: `shelf://books/${b.id}/book.yaml`,
          name: `${b.title} · book.yaml`,
          mimeType: 'application/yaml',
        })),
      }),
    }),
    { description: '一本书的 book.yaml 原文', mimeType: 'application/yaml' },
    async (uri, { bookId }) => {
      const dir = await bookDir(String(bookId)); // 同样做路径校验，失败时抛出协议错误
      return { contents: [{ uri: uri.href, text: await readFile(path.join(dir, 'book.yaml'), 'utf8') }] };
    },
  );

  // 提示模板：用户主动选择的工作流，在 Claude Code 里表现为斜杠命令
  server.registerPrompt(
    'review-book',
    {
      title: '审读一本书',
      description: '先校验，再逐章审读，给出修改建议',
      argsSchema: z.object({ bookId: z.string().describe('要审读的书 id') }),
    },
    ({ bookId }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `请审读书架上的《${bookId}》：\n` +
              '1. 先调用 check_book，列出必须修的错误\n' +
              '2. 用 read_chapter 逐章阅读，指出事实存疑、讲得不清楚、缺少例子的地方\n' +
              '3. 最后按优先级给出修改清单，不要直接改文件',
          },
        },
      ],
    }),
  );

  return server;
}
```

对照前几章看这段代码：

- **描述**按第 2 章的模板写：做什么、范围、返回、与相邻工具的区别、限制
- **`inputSchema`** 是 zod schema，`.describe()` 的文字就是模型看到的参数说明。SDK 用同一个 schema 生成 JSON Schema、在调用前校验参数、推导处理函数的参数类型
- **`outputSchema` + `structuredContent`**：`list_books` 和 `check_book` 返回结构化结果，同时在 `content` 里给模型一份可读文本。SDK 会在结果发出前按 `outputSchema` 校验
- **`read_chapter` 的分页头**明确告诉模型总行数和下一步的 `offset`（第 2 章）
- **`toolError`** 把可预期的错误变成 `isError: true`，其他异常继续抛出由 SDK 兜底（第 3 章）
- **`annotations`** 标记三个工具都是只读、不触达外部，宿主可以据此自动放行
- **资源回调**里的失败会成为协议错误（资源由宿主读取，不是模型），所以这里直接让 `bookDir` 的异常抛出
- **注册顺序就是 `tools/list` 的顺序**，保持固定，满足规范对确定顺序的建议

`createServer` 写成工厂函数而不是导出一个单例，是 SDK 2.x 的约定：stdio 入口为连接调用一次，HTTP 入口为**每个请求**调用一次。不要在工厂外面的共享实例上注册工具；需要复用的东西（数据库连接池、缓存）放在模块作用域，在工厂里引用。

## stdio 入口

```typescript
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { BOOKS_ROOT } from './library';
import { createServer } from './server';

const handle = serveStdio(createServer);
// stdout 是协议通道，日志只能写 stderr
console.error(`shelf-books MCP server 已启动，books 目录：${BOOKS_ROOT}`);

process.on('SIGINT', () => void handle.close());
```

`serveStdio` 接管 stdin / stdout，并调用工厂创建实例。再强调一次：**启动提示用 `console.error` 写到 stderr**，stdout 留给协议。宿主关闭管道（stdin 结束）时连接会自动关闭；如果你的 server 持有定时器、文件监听之类会让进程保持运行的东西，要在连接关闭时释放。

## 测试：用真实客户端，不用 mock

SDK 2.x 推荐的测试方式是：用 `createMcpHandler` 包装同一个工厂，把它的 `fetch` 交给客户端的 HTTP 传输，整个请求在进程内完成，不监听端口：

```typescript
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from './server';

const handler = createMcpHandler(createServer);
const client = new Client({ name: 'shelf-mcp-test', version: '0.0.0' }, { versionNegotiation: { mode: 'auto' } });

beforeAll(async () => {
  const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  await client.connect(transport);
});

afterAll(async () => {
  await client.close();
  await handler.close();
});

const text = (r: { content?: unknown }) => (r.content as { type: string; text: string }[])[0].text;

describe('shelf-books MCP server', () => {
  it('按固定顺序暴露三个工具', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['list_books', 'read_chapter', 'check_book']);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
  });

  it('list_books 按分类前缀过滤，并返回结构化结果', async () => {
    const r = await client.callTool({ name: 'list_books', arguments: { category: 'ai/agent' } });
    const { books } = r.structuredContent as { books: { id: string; category?: string }[] };
    expect(books.length).toBeGreaterThan(0);
    expect(books.every((b) => b.category?.startsWith('ai/agent'))).toBe(true);
  });

  it('拒绝路径穿越，并在错误里引用传入的值', async () => {
    const r = await client.callTool({ name: 'read_chapter', arguments: { bookId: '../etc', file: 'passwd.md' } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('"../etc"');
  });

  it('章节不存在时列出可用章节', async () => {
    const r = await client.callTool({ name: 'read_chapter', arguments: { bookId: 'agent-principles', file: '99-nope.md' } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('01-what-is-agent.md');
  });

  it('缺少必填参数时由 SDK 返回校验错误', async () => {
    const r = await client.callTool({ name: 'check_book', arguments: {} });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('bookId');
  });

  it('check_book 复用 @shelf/spec 的校验规则', async () => {
    const r = await client.callTool({ name: 'check_book', arguments: { bookId: 'agent-principles' } });
    expect(r.structuredContent).toMatchObject({ ok: true, errors: [] });
  });
});
```

这些测试覆盖了前三章强调的每一点：工具顺序固定、结构化结果、路径穿越被拒绝且错误引用了传入的值、不存在的章节返回候选列表、缺少参数时 SDK 的校验错误能到达模型、校验规则来自 `@shelf/spec`。

`versionNegotiation: { mode: 'auto' }` 让客户端先用 `server/discover` 探测，协商出新版协议。客户端默认走旧版 `initialize` 握手；想同时覆盖两代，可以把同一组测试用两种模式各跑一遍。

在仓库根目录运行：

```bash
pnpm --filter shelf-mcp test
pnpm --filter shelf-mcp typecheck
```

因为它是 workspace 的一个包，根目录的 `pnpm test` 和 `pnpm typecheck` 也会自动包含它。

## 用 Inspector 手动调试

MCP Inspector 是官方的本地调试工具，会启动你的 server 并打开一个网页，可以列出和调用工具、读资源、取提示模板：

```bash
npx @modelcontextprotocol/inspector pnpm --filter shelf-mcp start
```

在打开的页面里点 Connect，进入 Tools 标签，选 `read_chapter`，填入 `agent-principles` 和 `03-tools-and-actions.md` 运行，能看到带分页头的正文。也可以故意填错 `bookId`，看看模型会收到什么样的错误。

Inspector 适合检查「工具能不能用」，但不能回答「模型会不会用对」。后者要在真实宿主里观察（第 1 章）。

## 接入 Claude Code

### 项目级配置

在仓库根目录放一个 `.mcp.json`，提交进版本库，所有在这个仓库里使用 Claude Code 的人都能用：

```json
{
  "mcpServers": {
    "shelf-books": {
      "type": "stdio",
      "command": "pnpm",
      "args": ["--silent", "--filter", "shelf-mcp", "start"]
    }
  }
}
```

注意 `--silent`：pnpm 运行脚本时默认会在 stdout 打印一行脚本信息，这行内容会混进协议通道。直接用 `npx tsx tools/shelf-mcp/src/stdio.ts` 也可以避开这个问题。项目级的 server 在交互式会话里首次使用前，Claude Code 会请你确认是否信任。

也可以用命令行添加，`--scope` 决定存在哪里：

```bash
# 只在当前项目、只对自己生效（默认，存在 ~/.claude.json）
claude mcp add shelf-books -- npx tsx tools/shelf-mcp/src/stdio.ts

# 写进项目的 .mcp.json，团队共享
claude mcp add --scope project shelf-books -- npx tsx tools/shelf-mcp/src/stdio.ts
```

`--` 后面是启动 server 的命令。环境变量用 `--env KEY=value` 传入，`.mcp.json` 里则写在 `env` 字段，并支持 `${VAR}` 和 `${VAR:-默认值}` 形式的变量展开，这样密钥不用写进版本库。

### 验证

在 Claude Code 里输入 `/mcp`，应该能看到 `shelf-books` 已连接，下面列出三个工具。然后直接用自然语言提问：

```text
书架上 ai/agent 分类有哪些书？哪本章节最少？
```

模型会调用 `mcp__shelf-books__list_books`，参数是 `{"category": "ai/agent"}`。提问里没有提到任何工具名，模型是根据描述自己选的。再试试：

```text
用 shelf-books 检查一下 agent-principles，有问题的话读一下对应章节
```

观察它是否先调用 `check_book`，再按需调用 `read_chapter`，以及遇到长章节时是否会用 `offset` 继续读。这就是第 1 章说的「读记录」。

提示模板会以斜杠命令的形式出现，资源可以用 `@` 引用后附加进上下文。具体的交互形式取决于宿主版本，以 Claude Code 文档为准。

### 排查连接问题

| 现象 | 常见原因 | 怎么查 |
|---|---|---|
| `/mcp` 显示连接失败 | 启动命令在宿主的工作目录下跑不起来 | 在仓库根目录手动运行同一条命令 |
| 连上后立刻断开 | 有内容写到了 stdout | 搜索 `console.log`，检查包管理器是否打印了额外信息 |
| 看不到新加的工具 | 宿主缓存了旧的工具列表 | 重启 server 或重新连接 |
| 工具调用超时 | 处理函数太慢或卡住 | 给处理函数加超时；调大 server 的 `timeout` 配置 |
| 读不到书 | `SHELF_BOOKS_DIR` 指错了 | 看 stderr 里打印的 books 目录 |

## 本章要点

- 新项目用 SDK 2.x：`@modelcontextprotocol/server`，`inputSchema` 是完整的 zod schema，`serveStdio` / `createMcpHandler` 接收工厂函数
- 先写工具清单再写代码；校验规则复用 `@shelf/spec`，不在 server 里另写一套
- 访问层和注册层分开；根目录来自配置；路径用字符集校验加 `realpath` 双重防护
- `content` 给模型，`structuredContent` + `outputSchema` 给程序；可预期错误返回 `isError`
- 用进程内的真实客户端测试，覆盖正常路径和错误路径；Inspector 用来手动调试
- 用 `.mcp.json` 或 `claude mcp add` 接入 Claude Code；stdout 不能有任何非协议输出
