# 写第一个插件

这一章动手写插件：先让一个最简单的插件跑起来，再给模型加一个工具、给工具加配置，然后写一个拦截危险命令的「门禁」插件和一个记录工具调用的观察插件，最后把它们打包、装进 profile。例子取自本书架作者的项目 hatch-shelf：书的 id 必须只含小写字母、数字和短横线，我们做一个帮 agent 检查 id 的工具。

需要的基础：能读懂 TypeScript，读过[第 8 章](08-cordis.md)。

> [!WARNING]
> 本章代码按 2026 年 11 月初官方仓库 `docs/user/develop/`、`docs/cordis-tutorial/` 和 `docs/cookbook/` 里的示例改写。插件 API 在预览期变化很快，跑不通时以官方文档的最新示例为准，并用 `dsh --profile web --dump-config` 和启动日志排查。

## 准备：从源码运行

官方插件教程假设你在源码仓库里工作（第 2 章「从源码运行」一节）：

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
mkdir -p scratch-plugin/src
```

`scratch-plugin` 是练习用的目录，放在仓库根下。

> [!TIP]
> 想先不花 API 费用把 Cordis 的概念练熟，官方有一套 Cordis 教程（`docs/cordis-tutorial/`），全程不需要 key、不调用模型，用 `node --import tsx ../../vendor/cordis/bin.js` 直接运行。第 7 章就是把一个工具注册进 DSH 的工具服务、在不调模型的情况下执行它。

## 第一步：能加载就行

创建 `scratch-plugin/src/my-plugin.ts`：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello-plugin'

export function apply(ctx: Context) {
  console.log('[hello-plugin] plugin loaded!')
}
```

再创建一个补丁文件 `scratch-plugin/cordis.yml`，把它插进 Web profile。路径**必须是绝对路径**（先在仓库根目录运行 `pwd` 看一下）：

```yaml
- insert:
    - id: hello
      name: '/absolute/path/to/deepseek-harness/scratch-plugin/src/my-plugin.ts'
```

启动：

```bash
pnpm dsh web --patch ./scratch-plugin/cordis.yml
```

终端里出现 `[hello-plugin] plugin loaded!`，第一步完成。

为什么要绝对路径：补丁文件只提供配置，不改变加载器解析模块路径的起点，相对路径会从 profile 目录算起，找不到你的文件。

## 第二步：给模型一个工具

把 `my-plugin.ts` 换成：

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'shelf-tools'
export const inject = ['tools']

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'check_book_id',
    description:
      'Check whether a hatch-shelf book id is valid. ' +
      'Valid ids use lowercase letters, digits and single hyphens, e.g. "rag-systems".',
    parameters: {
      id: { type: 'string', required: true, description: 'The book id to check' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      if (ID_PATTERN.test(args.id)) return `"${args.id}" is a valid book id.`
      const suggestion = args.id
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
      return `"${args.id}" is invalid. Try "${suggestion || 'my-book'}".`
    },
  }))
}
```

逐段看：

- **`inject = ['tools']`**：等工具注册表就绪再启动，之后 `ctx.tools` 一定可用
- **`defineTool`**：用 `parameters` 描述参数。它会做三件事：生成给模型看的 JSON Schema、推导出 `args` 的 TypeScript 类型、在 `execute` 运行前校验模型给的参数。模型传了错误类型的参数，你的代码根本不会被调用
- **`description`**：模型决定用不用这个工具，全靠这段话。写清楚它能做什么、输入长什么样，举个例子。怎么写好工具描述，见[《工具设计与 MCP》第 2 章](../tools-and-mcp/02-descriptions-and-params.md)
- **`output.schema` 和 `render`**：`execute` 返回一个「规范值」，类型由 `output.schema` 声明；`render` 把它转换成模型看到的内容。两者分开，是因为在 PTC 模式下其他程序会直接拿到规范值，而不是一段自然语言

重启后在界面里试：

```text
用 check_book_id 检查一下这几个书名能不能当 id：DeepSeek_Harness、rag-systems、AI 数学
```

模型会调用三次 `check_book_id`，Trajectory 里能看到每次的参数和结果。

几条官方约定值得记住：

- **成功的「坏结果」也是成功**：id 不合法是一个正常的业务结果，应该作为返回值说明，而不是抛异常。只有基础设施故障（比如文件读不了）才抛异常，DSH 会把异常转成一个错误结果交给模型
- **尊重取消信号**：`execute` 的第二个参数 `exec` 里有 `exec.signal`，长时间运行的工作要在它触发时停下
- **不用手动注销**：插件卸载时，工具自动从注册表里消失
- **PTC 模式自动可用**：注册的工具在 PTC 模式下自动变成可以在程序里调用的函数，不需要额外集成

## 第三步：让工具可配置

官方原则：**两个部署可能想设成不同值的东西，都应该是配置项**。比如有的书架允许 id 里有下划线。

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'shelf-tools'
export const inject = ['tools']

export interface Config {
  allowUnderscore: boolean
  maxLength: number
}

export const Config: Schema<Config> = Schema.object({
  allowUnderscore: Schema.boolean().default(false),
  maxLength: Schema.number().default(40),
})

export function apply(ctx: Context, config: Config) {
  const pattern = config.allowUnderscore
    ? /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/
    : /^[a-z0-9]+(?:-[a-z0-9]+)*$/
  // ……注册工具，execute 里用 pattern 和 config.maxLength 检查
}
```

在补丁里给出配置：

```yaml
- insert:
    - id: shelf-tools
      name: '/absolute/path/to/deepseek-harness/scratch-plugin/src/my-plugin.ts'
      config:
        maxLength: 32
```

要点：

- `Config` 必须用 Schemastery 定义，**不能导出一个普通对象**，Cordis 要靠它校验和填默认值
- 默认值写在 schema 字段上，没给的项自动用默认值
- 配置不合法时插件**加载失败并报错**，而不是带着错误的配置运行
- 修改配置会触发热替换：旧实例卸载、注册撤销，新实例用新配置加载

## 第四步：门禁插件

第 7 章说过，提示词里的禁令只是建议。想**强制**禁止 agent 执行 `git push`，写一个挂在 `tools/pre-execute` 上的门禁：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'

export const name = 'no-git-push'

export function apply(ctx: Context) {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const isShell = exec.name === 'bash' || exec.name === 'pwsh'
    if (isShell && JSON.stringify(exec.arguments).includes('git push')) {
      return { kind: 'deny', reason: 'git push is not allowed; ask the user to push.' }
    }
    return next()
  })
}
```

这是第 8 章 `waterfall` 的典型用法：

- 命中规则时**不调用 `next()`**，直接返回拒绝决定，下游的监听器都不会执行
- 不相关的调用**一定要 `return next()`**，否则所有工具调用都会被你吞掉
- `reason` 会交给模型，所以写成它能理解、能据此调整行为的话

注意这个简单的字符串匹配能被绕过（比如 `git  push`、用变量拼命令、在 PTC 程序里调用）。真正的防线仍然是沙箱和审批；门禁适合挡住「不小心」，不适合挡住「故意」。如果某条规则必须是**最终的、不可被后续监听器推翻的拒绝**，官方提供了 `ctx.tools.guard()`。

## 第五步：观察插件

想把每次工具调用记下来（比如统计 agent 最常用哪些工具），监听 `tools/result`：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'

export const name = 'tool-logger'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.on('tools/result', (exec, result) => {
    const text = result.content
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('')
    console.log(`[tool-logger] ${exec.name} -> ${text.slice(0, 80)}`)
  })
}
```

`import type {} from '@deepseek-ai/dsh-tools'` 这一行看起来什么都没导入，作用是引入这个包的类型声明，让 `'tools/result'` 事件和它的参数有类型提示。

门禁插件、观察插件、工具插件三者互相不知道对方存在，它们只通过工具服务和事件联系在一起。这就是插件化的好处：每个插件只做一件事，可以单独开关。

## 第六步：打包和安装

`--patch` 适合开发。要长期使用或分享给别人，把插件打成一个**组合包**：

```text
dsh-shelf-tools/
├── package.json        # 声明 dsh.bundle
├── cordis.patch.yml    # 安装后应用的配置层
└── index.js            # 插件代码（编译后的 JavaScript）
```

`package.json`：

```json
{
  "name": "dsh-shelf-tools",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "engines": { "dsh": ">=0.2.0 <0.3.0" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

`cordis.patch.yml` 里按**包名**而不是文件路径引用插件，这样安装后 Node 能找到它：

```yaml
- insert:
    - id: shelf-tools
      name: dsh-shelf-tools
```

安装进一个 profile：

```bash
dsh plugin --profile demo add ./dsh-shelf-tools
dsh demo
```

第一次使用时会以 `dsh-base` 为底创建 `demo` 这个 profile，再把你的组合包追加进去。`engines.dsh` 声明支持的 DSH 版本范围，版本不匹配时安装和启动都会拒绝，这在 API 频繁变化的预览期尤其有用。

想让别人发现你的插件：发布到 npm，在 GitHub 仓库上加 `dsh-plugin` 话题；团队内部可以自己维护一个插件索引 JSON 文件，放在任意静态托管上，成员在插件页的「发现」标签里添加这个索引源。

## 新功能该放在哪

官方架构文档有一张「新行为放在哪里」的对照表，这是写插件前最该查的东西：

| 想做的事 | 放在哪里 |
|---|---|
| 接一个新的模型提供方 | 在 `ctx.llm` 上注册适配器 |
| 给模型一个新能力 | 在 `ctx.tools` 上注册工具 |
| 让某个会话拥有不同的能力集合 | 组装一个 agent 预设 |
| 换一种 shell 或终端执行方式 | 注册 `ctx.shell` 或 `ctx.terminals` 后端 |
| 控制文件访问 | 注册 `ctx.fs` 提供方，或监听 `fs/*` 事件 |
| 进程隔离 | 用 `ctx.sandbox` 后端 |
| 拦截请求、工具或轮次 | 监听对应的 `agent/*` 或 `tools/*` 事件 |
| 运行中途给模型补充上下文 | 调用 `agent.inject()` |
| 做界面或编辑器集成 | 驱动 `ctx.agents`，从 `session/event` 渲染 |
| 新的需要持久化的会话状态 | 扩展会话事件类型 |
| 新的会话存储后端 | 实现 `SessionPersistence` |

如果要加的是一项完整的可替换能力（比如一种新的代码执行环境），按第 8 章的接缝思路拆成三个包：服务定义、提供方、使用方。

## 让 DSH 帮你写插件

最后一个技巧：切换到 **Creator 模式**，它提供检查 DSH 运行时的只读工具，可以在内存里试装插件。你可以直接说「帮我写一个插件，在每次 `write` 工具写入 `books/` 下的文件后提醒我跑 `pnpm shelf-pack check`」，让它查清楚当前版本的真实 API 再写。这比照着任何一本书（包括这本）抄代码都更不容易过时。持久的改动仍然要打包成组合包、用插件管理安装。

## 本章要点

- 插件开发从源码仓库开始，用 `--patch` 加载，插件路径要写绝对路径
- `defineTool` 用参数描述生成 schema、推导类型、校验参数；`execute` 返回规范值，`render` 决定模型看到什么；业务上的「坏结果」用返回值说明，不抛异常
- 配置用 Schemastery 定义，默认值写在 schema 上，非法配置让加载失败
- `tools/pre-execute` 上的门禁不调 `next()` 就是拒绝，不相关的调用必须 `return next()`；字符串匹配挡不住故意绕过，真正的边界仍是沙箱和审批
- 打包成带 `dsh.bundle` 的 npm 包，用 `dsh plugin --profile <名字> add` 安装，用 `engines.dsh` 锁定兼容版本
