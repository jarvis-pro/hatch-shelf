# API 与契约测试

一个人的项目也有很多「两端」：服务端和网页端、服务端和手机 App、命令行工具和手机上的传书服务、React Native 和它里面的 WebView。两端各自的测试都绿，拼到一起却不能用，原因几乎总是同一类：**两边对某件事的理解不一致**，比如字段名、状态码、请求头、编码方式。把两端之间的约定写成测试，就是契约测试。这一章先讲 API 测试该测什么，再讲怎么守住两端之间的约定，最后讲最难的那部分：已经装在别人手机上的旧版本。

## 契约在哪里

先列一下本书三个项目里的「两端」：

| 项目 | 一端 | 另一端 | 约定的内容 |
|---|---|---|---|
| hatch-counter | NestJS 服务端 | 网页端、手机端、管理后台 | 接口路径、请求体、错误码、自定义请求头 |
| hatch-shelf | `shelf-pack push` 命令行 | 手机上的局域网 HTTP 服务 | 路径、PIN 请求头、multipart 格式 |
| hatch-shelf | React Native 外壳 | WebView 里的阅读器 | `postMessage` 的消息类型 |
| hatch-recordwall | 手机端和桌面端 | Cloudflare Worker 曲库 | 列表格式、Range 请求 |

约定是否稳定，取决于**两端是不是一起发布**：

- 一起构建、一起发布的两端（RN 外壳和打包进 App 的阅读器），版本永远一致，约定靠共享类型就能守住
- 分开发布的两端（服务端和已经装在用户手机上的 App），线上永远同时存在多个版本的组合，约定必须向后兼容

## 第一道防线：共享类型

两端在同一个 monorepo 里时，最便宜的契约测试是**编译器**。

hatch-shelf 的规范里有一条：RN 和 WebView 之间的消息类型只在 `app/src/reader/bridge.ts` 定义，阅读器那边以 type-only 方式引用同一个文件。

```typescript
/** RN → WebView，通过 injectJavaScript 调用 window.__shelf.receive(msg) */
export type ToReader =
  | { type: "load"; markdown: string; bookBaseUrl: string; theme: ReaderTheme /* …… */ }
  | { type: "setTheme"; theme: ReaderTheme }
  | { type: "scrollTo"; anchor: string };
  // ……

/** WebView → RN，通过 window.ReactNativeWebView.postMessage(JSON.stringify(msg)) */
export type FromReader =
  | { type: "ready" }
  | { type: "rendered" }
  | { type: "toc"; items: TocItem[] };
  // ……
```

两端的收发函数都以这两个联合类型为参数，再配合[第 1 章](01-what-to-test.md)的穷尽检查：新增一种消息，没处理它的那一端编译失败。这样的「契约测试」零运行成本。

hatch-counter 走得更远：请求头名、错误码、请求体的类型都从 `@counter/core` 导出，服务端和三个客户端引用同一份。比如幂等请求头的名字：

```typescript
// packages/core/src/platform/idempotency.ts
export const IDEMPOTENCY_HEADER = "idempotency-key";
export const IDEMPOTENT_REPLAY_HEADER = "idempotent-replay";
```

把字符串常量也放进共享包，看起来小题大做，但请求头名拼错一个字母，编译器是发现不了的。

共享类型有两个局限：

1. **类型在运行时不存在**。服务端声明返回 `Expense`，实际返回的 JSON 少了一个字段，TypeScript 不会知道。所以边界上要用 zod 这类运行时校验，而测试可以顺便用同一份 schema 校验每一个响应
2. **只能保证「当前版本的两端」一致**。线上的旧客户端用的是旧类型，编译器管不到它

## API 测试测什么

服务端的 API 测试（起真服务、打 HTTP）是契约的另一半：它确认服务端**实际**表现成约定的样子。

hatch-counter 的 API 测试关注的不是业务计算（那在 core 的单元测试里），而是这些「只有在 HTTP 层才看得见」的东西：

| 关注点 | 例子 |
|---|---|
| 状态码 | 没登录回 401，没权限回 403，库连不上回 503 |
| 错误码 | 403 的响应体里 `code` 是 `perm_denied`，而不是比较整句文案 |
| 请求头的语义 | 带同一个幂等键重放，原样返回第一次的响应 |
| 守卫的顺序 | 版本闸门排在鉴权前面 |
| 多租户隔离 | A 店的令牌读不到 B 店的数据 |

下面是它幂等测试里的一条，值得逐行看：

```typescript
it("同一个请求号再来，原样回第一次那份，账上只有一笔", async () => {
  const { token, categoryId } = await tenant();
  const key = randomUUID();
  const first = await record(token, knife(categoryId), key);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.headers.get(IDEMPOTENT_REPLAY_HEADER), null);

  const again = await record(token, knife(categoryId), key);
  assert.equal(again.status, 201, "状态码跟第一次一样");
  assert.equal(again.headers.get(IDEMPOTENT_REPLAY_HEADER), "true");
  assert.deepEqual(again.body, first.body, "回的是第一次那一份，连 id 都一样");
  assert.ok(again.headers.get(VERSIONS_AFTER_HEADER), "重放的回包也带着写完之后的版本号");
  assert.equal(await count(token), 1);
});
```

- 第一次请求的断言带上了 `JSON.stringify(first.body)`：前置步骤失败时，报错里直接能看到服务端说了什么，而不只是「expected 201, got 400」
- 最后一行不信响应，**回头去数账上到底有几笔**。响应说成功了不代表数据库里真的只有一笔
- 紧接着还有一条「没带请求号的照旧每次都记（老客户端）」：新功能不能破坏没升级的客户端

幂等本身的设计见[《软件架构与系统设计》的幂等一章](../system-design/06-idempotency-consistency.md)。

### 用 schema 校验每一个响应

如果响应的 schema 已经在共享包里用 zod 定义了，可以让测试的 HTTP 辅助函数**自动校验每个响应**，一处改动就让几百条测试都变成了契约测试：

```typescript
import type { z } from "zod";

export async function apiParsed<S extends z.ZodTypeAny>(
  server: TestServer,
  method: string,
  path: string,
  schema: S,
  opts: RequestOpts = {},
): Promise<{ status: number; body: z.infer<S> }> {
  const res = await api<unknown>(server, method, path, opts);
  if (res.status >= 400) return { status: res.status, body: res.body as z.infer<S> };
  const parsed = schema.safeParse(res.body);
  if (!parsed.success) {
    throw new Error(`${method} ${path} 的响应不符合约定：\n${parsed.error.message}`);
  }
  return { status: res.status, body: parsed.data };
}
```

这样服务端某天多返回了一个 `null` 而 schema 要求字符串，相关的每一条测试都会指出来，而不是等到手机端渲染时崩溃。

## 第二道防线：让两个实现直接对话

有些约定不在类型里，而在**字节**里。hatch-shelf 的传书功能就是一个真实的例子。

手机上的局域网 HTTP 服务是自己写的，为了简单和安全，它**只接受带 `Content-Length` 的请求**，分块传输（`Transfer-Encoding: chunked`）直接回 411。命令行工具 `shelf-pack push` 用 `fetch` 上传书的压缩包，而 `fetch` 发送 `FormData` 时可能使用分块传输。于是命令行那边的上传函数是手工拼 multipart 的，源码注释写着原因：

```typescript
/**
 * 手动拼 multipart：App 的 HTTP 服务只接受带 Content-Length 的请求，
 * 而 fetch 对 FormData 可能使用分块传输。
 */
export async function upload(to: string, pin: string, fileName: string, data: Uint8Array) {
  const boundary = `----shelf-pack-${Math.random().toString(36).slice(2)}`;
  // ……拼出 head + data + tail，带上 Content-Length
}
```

两边各有自己的测试：服务端的 `http.test.ts` 用手写的 multipart 测解析器，命令行那边测打包逻辑。但**没有一条测试把「命令行拼出来的字节」喂给「服务端的解析器」**。某天有人把命令行的上传改回 `FormData`（看起来更「规范」），两边的测试都是绿的，传书却不能用了。

补上这条测试并不难：两端的代码都在同一个仓库，解析器是纯函数。只要把命令行里「拼请求」的部分抽成一个返回字节的纯函数，测试就能让两边直接对话：

```typescript
import { describe, expect, it } from "vitest";
import { buildUploadRequest } from "../../tools/shelf-pack/src/device";
import { parseMultipart, RequestParser, textOf } from "./http";

describe("shelf-pack push ↔ 局域网服务", () => {
  it("命令行拼出的上传请求，服务端能完整解析出文件和文件名", () => {
    const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
    const raw = buildUploadRequest({ host: "192.168.1.5:8080", pin: "1234", fileName: "测试工程.zip", data: zipBytes });

    const r = new RequestParser(10 * 1024 * 1024).push(raw);
    expect(r.type).toBe("complete"); // 不是 411：请求带着 Content-Length
    if (r.type !== "complete") return;

    expect(r.request.headers["x-pin"]).toBe("1234");
    const parts = parseMultipart(r.request.body, r.request.headers["content-type"])!;
    const file = parts.find((p) => p.name === "file");
    expect(file?.filename).toBe("测试工程.zip");
    expect(file?.data).toEqual(zipBytes);
  });
});
```

> 这里的 `buildUploadRequest` 是为了测试而抽出的函数，hatch-shelf 当前的 `upload` 是把拼字节和发请求写在一起的。是否值得为这条测试做一次小重构，取决于你多担心这个约定被改坏。

这种测试的模式是通用的：**A 的输出直接作为 B 的输入**。同一个仓库里的两端，只要各自把「生成」和「解析」做成纯函数，就能这样对接。比起两边各自对着一份手写样本测试，它不会出现「两边都对着同一份错的样本」的情况。

## 第三道防线：旧版本

前两道防线都假设两端的代码就在眼前。真正难的是已经发出去的客户端：

- App Store 的审核和用户的升级习惯，让手机上的旧版本可能存在几个月
- 店里那台收银电脑的浏览器标签页可能一周没刷新，跑着上周的前端代码
- 你没法 import 一个「上个月的客户端」来跑测试

对策分三层。

### 只做加法

接口演进的基本规则：加字段可以，删字段、改字段含义、改类型不行。具体说：

| 改动 | 对旧客户端安全吗 |
|---|---|
| 响应里加一个字段 | 安全（旧客户端忽略它） |
| 请求里加一个可选字段 | 安全 |
| 请求里加一个**必填**字段 | 不安全，旧客户端不会带 |
| 删除或改名响应字段 | 不安全 |
| 枚举值加一个新成员 | 看情况：旧客户端的 `switch` 可能不认识它 |
| 改错误码 | 不安全，客户端靠错误码分支 |

hatch-counter 的幂等功能就是按这个规则加的：带请求号的走幂等，不带的照旧每次都记，并且有一条测试专门守着「不带请求号」这条路。

### 把旧版本挡在门外

总有必须破坏兼容的时候。hatch-counter 的做法是**版本闸门**：每个请求带一个客户端版本头，服务端维护每种客户端的最低版本，低于它的请求统一回一个明确的错误，客户端据此提示用户更新。

闸门的测试里最关键的一条是**顺序**：闸门必须排在鉴权前面。源码注释解释了为什么：一台旧客户端的令牌多半也过期了，如果鉴权先执行，它听到的是「登录已过期」，于是去重新登录、再被拒、再重登，永远听不到「请更新」那句话。而这个顺序是模块里 provider 的排列，正是会被顺手改坏的那种东西。

测试里用了两个刻意极端的版本号：

```typescript
/** 比任何一条真线都低 / 都高。这样断言不跟着 MIN_CLIENT 那个数走 */
const OLD = "0.0.1";
const NEW = "999.0.0";
```

这样以后调整最低版本，不用改测试。

### 保存真实的旧请求

第三层是把旧客户端**真实发出的请求**存成样本，作为测试数据回放。每次发布客户端版本时，从开发环境的日志里截一批该版本的典型请求（去掉令牌等敏感信息），存进 `tests/fixtures/requests/web-1.4.0/`。之后每次改服务端，回放所有仍在支持范围内的版本的样本，断言状态码不是 4xx。

这比任何手写的兼容性测试都可靠，因为它测的是旧客户端**实际**会发什么，而不是你记得它会发什么。

## 要不要上 Pact

> [!WARNING]
> 本节对 Pact 工作流程的描述按其公开文档的通用概念整理，具体的 API、Pact Broker 的部署方式和收费方案可能变化，以 Pact 官方文档为准。

谈契约测试，绕不开消费者驱动的契约（consumer-driven contracts）和它的代表工具 Pact：

1. 消费者（客户端）在自己的测试里声明「我会发这样的请求，期望这样的响应」，生成一份契约文件
2. 契约文件发布到一个中间服务（Pact Broker）
3. 提供者（服务端）的 CI 拉取所有消费者的契约，逐条回放验证
4. 发布前查询「这个版本的服务端和线上所有消费者版本是否兼容」

它解决的是**不同团队、不同仓库**之间的协调问题：服务端团队不知道有哪些客户端在用哪些字段。一个人维护一个 monorepo 时，这个问题基本不存在：共享类型和 schema 校验覆盖了当前版本，版本闸门和旧请求回放覆盖了旧版本。多部署和维护一个 Broker，换来的收益很有限。

值得考虑 Pact 的情况：你给第三方提供了公开 API，或者你的服务端被别人的仓库调用，而你看不到他们的代码。

## 调用第三方 API

反过来，你是消费者、第三方是提供者时（OCR 服务、短信网关、支付），你没法在他们的 CI 里跑测试。可行的做法：

- **保存真实响应作为样本**：第一次接入时，把沙箱环境的真实响应存下来，作为[第 3 章](03-test-doubles.md)网络层替身的返回值。不要凭文档手写，文档和实际响应经常对不上
- **定期跑一次冒烟测试**：写几条直接调用沙箱的测试，不放进每次提交的 CI，而是每天或每周跑一次，失败了通知自己。它的目的是发现「对方改了接口」
- **适配层做运行时校验**：第三方响应一进来就用 zod 解析，解析失败的错误信息带上原始响应，记进日志。对方悄悄改了格式时，你在日志里看到的是一句清楚的「某字段缺失」，而不是十层之外的 `undefined is not a function`

## 本章要点

- 契约是两端对某件事的共同理解；一起发布的两端靠共享类型，分开发布的两端要考虑向后兼容
- 共享类型和常量是零成本的契约测试，但类型在运行时不存在，边界上要做 schema 校验
- API 测试关注只有 HTTP 层才看得见的东西：状态码、错误码、请求头语义、守卫顺序、租户隔离
- 断言不只信响应，要回头去查数据库的实际状态
- 同一仓库的两端，把生成和解析做成纯函数，让 A 的输出直接喂给 B
- 旧版本靠三层：只做加法、版本闸门（排在鉴权前面）、回放真实的旧请求
- 一人 monorepo 通常不需要 Pact；给第三方提供 API 时再考虑
- 调用第三方：保存真实响应、定期冒烟、适配层运行时校验

## 动手练习

1. **看 fetch 到底发了什么头**：开一个终端运行 `nc -l 9000`（Linux 上是 `nc -l -p 9000`），另一个终端用 Node 22 分别发两次请求，每次发完回到第一个终端看请求头，再重新起 `nc`：

   ```bash
   node -e 'const f=new FormData(); f.append("file", new Blob(["hi"]), "a.zip"); fetch("http://localhost:9000/", {method:"POST", body:f}).catch(()=>{})'
   node -e 'const s=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode("hi")); c.close()}}); fetch("http://localhost:9000/", {method:"POST", body:s, duplex:"half"}).catch(()=>{})'
   ```

   验证：第二条请求的头里是 `Transfer-Encoding: chunked`，没有 `Content-Length`；第一条记下它实际带的是哪一个。

   参考答案：请求体长度能不能预先知道，取决于 body 的类型和运行时实现，不是调用方能从 API 上看出来的。只接受 `Content-Length` 的服务端遇到第二种就会回 411，所以本章主张让「命令行拼出的字节」直接喂给解析器测试，而不是相信 `fetch` 的默认行为。

2. **让 schema 抓住一个多出来的 null**：在装了 `zod` 的目录里写一个脚本，定义 `z.object({ id: z.string(), note: z.string() })`，分别对 `{ id: "1", note: "x" }` 和 `{ id: "1", note: null }` 调用 `safeParse`，打印 `success` 和 `error?.issues`。

   验证：第一次 `success: true`；第二次 `success: false`，issues 里有一条 `path` 是 `["note"]`。

   参考答案：类型在运行时不存在，服务端多返回一个 `null`，只有运行时校验看得见。把这一步放进测试的 HTTP 辅助函数，几百条测试就都顺带成了契约测试。

3. **判断哪些改动能上线**：服务端准备发布这几处改动，手机上还有三个月前的旧版本：响应里加 `tags` 数组；请求体新增必填的 `currency`；错误码 `quota_exceeded` 改名为 `limit_reached`；状态枚举加一个 `archived`；请求里加一个可选的 `note`。逐条判断对旧客户端是否安全，不安全的给出替代做法。

   验证：每一条都能说出「旧客户端会怎样」。

   参考答案：加 `tags` 和可选 `note` 安全。必填 `currency` 不安全，改成可选并给服务端默认值。错误码改名不安全，旧客户端靠它分支，保留旧码或者用版本闸门挡住旧版。加 `archived` 要看旧客户端的 `switch` 是否有兜底分支；不确定时只对新版本返回它，或者让旧版本看到一个它认识的值。
