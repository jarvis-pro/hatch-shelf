# MCP 协议

前三章讲的设计方法对任何形式的工具都适用。从这一章开始进入 MCP（Model Context Protocol）：怎么把工具做成一个独立的服务，让 Claude Code、桌面客户端、IDE 里的各种 agent 都能接入。

[《Agent 原理与设计》第 8 章](../agent-principles/08-mcp-and-skills.md)已经讲了 MCP 解决什么问题（M×N 变 M+N）和三种原语的定位。这一章深入协议本身：消息长什么样、一次调用经过哪些步骤、两种传输方式的差别，以及 2026-07-28 这一版规范带来的重大变化：**MCP 变成了无状态协议**。理解这些，第 5 章写 server、第 6 章做认证时才知道 SDK 在背后替你做了什么。

## 架构回顾

| 角色 | 是什么 | 例子 |
|---|---|---|
| Host（宿主） | 用户直接使用的 AI 应用，负责调用模型、管理权限和界面 | Claude Code、VS Code、桌面聊天客户端 |
| Client（客户端） | 宿主内部的连接器，每个 client 对接一个 server | Claude Code 为 `.mcp.json` 里每个 server 建一个 |
| Server（服务端） | 暴露能力的程序 | 本书的 `shelf-books` |

```mermaid
flowchart TD
  U["用户"] --> H
  subgraph H["Host：Claude Code"]
    M["模型调用与权限"]
    C1["Client A"]
    C2["Client B"]
    M --- C1
    M --- C2
  end
  C1 <-->|"stdio"| S1["shelf-books<br/>本地进程"]
  C2 <-->|"Streamable HTTP"| S2["远程 server"]
```

一个关键点：**模型从不直接和 server 说话**。模型只看到宿主转交的工具列表，输出「想调用什么」；宿主检查权限后，由 client 向 server 发请求，再把结果交还模型。这意味着权限、确认、审计都发生在宿主这一层（第 6 章）。

MCP 的设计参考了 LSP（Language Server Protocol）：LSP 让任何编辑器都能接入任何语言的补全和跳转，MCP 让任何 AI 应用都能接入任何外部能力。

## 三种服务端原语

| 原语 | 由谁控制 | 典型交互 | 书库 server 里的例子 |
|---|---|---|---|
| Tools | 模型 | 模型根据对话自动决定调用 | `list_books`、`read_chapter`、`check_book` |
| Resources | 应用 / 用户 | 用户在界面里选择附加，或宿主自动附加 | `shelf://books/{bookId}/book.yaml` |
| Prompts | 用户 | 以斜杠命令或菜单项出现 | `review-book`：审读一本书的工作流 |

区分「由谁控制」很重要。Tools 是模型主动调用的，所以要考虑模型会不会误用；Resources 是被动的数据，由人决定读不读；Prompts 是人主动触发的模板。同一份数据，比如一个章节的正文，既可以做成工具（模型自己决定去读），也可以做成资源（用户在 Claude Code 里用 `@` 引用后附加进上下文）。

客户端也可以向 server 提供能力。2026-07-28 版规范中，核心的客户端能力是 **Elicitation**：server 在执行过程中向用户索要额外信息（比如确认、补充一个参数）。早期版本里的 Roots（告诉 server 可以访问哪些目录）、Sampling（server 借用客户端的模型做生成）和 Logging 在这一版被标记为**弃用**（Deprecated），规范建议的替代方案分别是：通过工具参数、资源 URI 或配置传目录，直接对接模型 API，日志写 stderr 或用 OpenTelemetry。按这一版同时引入的功能生命周期政策，「弃用」意味着功能仍然完整可用、但已排期移除，弃用期至少十二个月，规范里有一张专门的弃用功能登记表。新写的 server 不要再依赖它们。

## 消息格式：JSON-RPC 2.0

MCP 的所有消息都是 JSON-RPC 2.0，分三种：

| 类型 | 有 `id` | 需要回复 | 例子 |
|---|---|---|---|
| 请求 | 有 | 是 | `tools/list`、`tools/call`、`resources/read` |
| 响应 | 有（与请求相同） | 否 | `result` 或 `error` 二选一 |
| 通知 | 无 | 否 | `notifications/tools/list_changed`、`notifications/progress` |

MCP 在 JSON-RPC 之上加了两条约束：请求的 `id` 不能是 `null`，同一发送方未完成的请求 `id` 不能重复。

## 2026-07-28：MCP 变成无状态协议

> [!WARNING]
> 本节按 2026 年 11 月 modelcontextprotocol.io 上 2026-07-28 版规范的 Key Changes（changelog）、Versioning、Base Protocol 和 Streamable HTTP 页面逐条核对。写作时 2026-07-28 是规范标注的当前（Current）版本，当前版本仍可能接收向后兼容的修订；字段名、错误码以官方规范为准。

这一版是 MCP 发布以来变化最大的一次。理解它需要先看旧版本怎么工作。

### 旧版：先握手，再对话

2025-11-25 及更早的版本（规范称为 legacy 版本）要求每个连接先做一次初始化握手：

```mermaid
sequenceDiagram
  participant C as Client
  participant S as Server
  C->>S: initialize（协议版本、客户端能力、clientInfo）
  S-->>C: 协商后的版本、服务端能力、serverInfo
  C->>S: notifications/initialized
  Note over C,S: 之后的请求都依赖这次握手建立的会话状态
  C->>S: tools/list
  S-->>C: 工具列表
  C->>S: tools/call
  S-->>C: 结果
```

在 HTTP 上，握手之后 server 会发一个 `Mcp-Session-Id`，客户端之后每个请求都带上它。这个设计在本地 stdio 下没什么问题，但对远程部署很不友好：server 要记住每个会话，多实例部署需要会话亲和或共享存储，负载均衡器得理解 MCP 会话。

### 新版：每个请求自带上下文

2026-07-28 版去掉了 `initialize` 握手和协议层的会话。每个请求在 `_meta` 里自带协议版本和客户端能力：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "check_book",
    "arguments": { "bookId": "agent-principles" },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/clientInfo": { "name": "claude-code", "version": "x.y.z" }
    }
  }
}
```

其中 `protocolVersion` 和 `clientCapabilities` 是必填的，缺了 server 必须返回 `-32602`（HTTP 下是 400）；`clientInfo` 建议每次都带。处理某个请求需要客户端没声明的能力时，server 返回 `MissingRequiredClientCapabilityError`（`-32021`），在 `data.requiredCapabilities` 里列出缺的能力。另有一个可选键 `io.modelcontextprotocol/logLevel`，下文再说。server 在结果的 `_meta` 里报上自己的身份。下面是本书的书库 server（用 SDK 2.4.0 运行）对一个不存在的书 id 的真实响应：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [{ "type": "text", "text": "没有 id 为 \"nope\" 的书。先调用 list_books 查看可用的 id" }],
    "isError": true,
    "resultType": "complete",
    "_meta": { "io.modelcontextprotocol/serverInfo": { "name": "shelf-books", "version": "0.1.0" } }
  }
}
```

注意新增的 `resultType` 字段：所有结果都必须带。`"complete"` 表示普通结果；`"input_required"` 表示 server 需要更多输入才能完成（见下文的多轮请求）。

想事先知道 server 支持哪些版本和能力，可以调用新增的 `server/discover`。server 必须实现它：

```json
{
  "result": {
    "supportedVersions": ["2026-07-28"],
    "capabilities": {
      "tools": { "listChanged": true },
      "resources": { "listChanged": true },
      "prompts": { "listChanged": true }
    },
    "resultType": "complete",
    "ttlMs": 0,
    "cacheScope": "private",
    "_meta": { "io.modelcontextprotocol/serverInfo": { "name": "shelf-books", "version": "0.1.0" } }
  },
  "jsonrpc": "2.0",
  "id": 1
}
```

如果请求的版本 server 不支持，它返回 `UnsupportedProtocolVersionError`（错误码 `-32022`），并在 `data.supported` 里列出支持的版本，客户端换一个版本重试。

### 无状态对工具设计意味着什么

规范说得很直接：server **不能**依赖同一连接上之前的请求来建立上下文；一个打开的 stdio 进程也**不是**一个会话，客户端可能在同一条连接上穿插不相关的请求。

所以如果你的工具需要跨调用的状态，比如一个打开的浏览器页面、一个数据库事务、一个购物车，就必须用**显式句柄**：一个创建工具返回 id，后续工具把这个 id 当作普通参数接收。

```text
create_draft({ bookId })          → { draftId: "drf_8f2c…" }
append_section({ draftId, text }) → 追加内容
publish_draft({ draftId })        → 写入 books/
```

规范对句柄给了几条建议：认证过的 server 每次调用都要校验调用者对该句柄的权限（句柄只是名字，不是凭证）；未认证的 server 用足够随机的值（比如 UUIDv4）并设有效期；句柄保持不透明，不要编码内部结构；过期规则写进创建工具的描述里；对过期或未知的句柄返回可行动的工具错误，让模型能重新创建。

这其实和第 1 章的「行为确定」一脉相承：工具的结果只取决于参数，不取决于隐藏的连接状态。

### 新旧版本怎么共存

| 客户端 \ 服务端 | 仅新版 | 新旧都支持 | 仅旧版 |
|---|---|---|---|
| 仅新版 | 正常 | 正常 | 失败 |
| 新旧都支持 | 正常 | 正常 | 正常（探测后回落到 `initialize`） |
| 仅旧版 | 失败 | 正常 | 正常 |

结论是：**写 server 时同时支持新旧两代**最稳妥，因为你无法控制用户的客户端升级到了哪一版。官方 TypeScript SDK 2.x 的 `serveStdio` 和 `createMcpHandler` 默认就是双代兼容的：收到 `initialize` 走旧版语义，收到带 `_meta` 的请求走新版语义。本书的书库 server 用旧版 `initialize` 连接时，SDK 协商出的版本是 `2025-11-25`；用新版请求时则按 `2026-07-28` 处理。你写的工具代码完全不用区分。

### 这一版的其他变化

| 变化 | 内容 |
|---|---|
| 多轮请求（MRTR） | server 不再主动向客户端发请求，而是返回 `resultType: "input_required"` 和需要的输入（如 elicitation）；客户端带上 `inputResponses` 重试原请求 |
| 订阅 | 去掉 HTTP 的 GET 通道和 `resources/subscribe`，统一用 `subscriptions/listen` 打开一条长连接接收变更通知 |
| 删除 | `ping`、`logging/setLevel`、`notifications/roots/list_changed`、SSE 断点续传（响应流断了，客户端要用新的请求 id 重发） |
| 日志级别 | 改为每个请求在 `_meta` 里用 `io.modelcontextprotocol/logLevel` 指定；没带这个键的请求，server 不得发 `notifications/message` |
| 缓存提示 | `tools/list` 等列表结果必须带 `ttlMs` 和 `cacheScope`，客户端据此缓存 |
| 确定顺序 | `tools/list` 应按确定顺序返回，方便缓存和提高 prompt cache 命中率 |
| JSON Schema | `inputSchema` / `outputSchema` 默认 2020-12 方言，可用任何关键字；不得自动解引用网络上的 `$ref` |
| Tasks | 长时间运行的异步任务移出核心协议，成为官方扩展 `io.modelcontextprotocol/tasks`，改为用 `tasks/get` 轮询 |
| 扩展机制 | 能力里新增 `extensions` 字段，Tasks、MCP Apps（在对话里渲染交互界面）等以扩展形式提供，见下文「扩展与 MCP Apps」 |
| 错误码 | `-32020` 到 `-32099` 保留给规范使用；资源不存在的错误码从 `-32002` 改为 `-32602` |
| 链路追踪 | 约定在 `_meta` 里用 `traceparent`、`tracestate`、`baggage` 传 OpenTelemetry 上下文 |
| 授权 | 动态客户端注册（DCR）弃用，推荐客户端 ID 元数据文档；客户端要校验授权响应里的 `iss`（RFC 9207）；凭证按签发它的授权服务器分开保存。第 6 章细讲 |

协议还在快速演进。实际开发时以官方规范的 changelog 为准，并依赖 SDK 处理这些细节。

## 一次工具调用的完整过程

把上面的内容串起来，看 Claude Code 通过书库 server 校验一本书时发生了什么：

```mermaid
sequenceDiagram
  participant U as 用户
  participant H as Host（含模型调用）
  participant C as MCP Client
  participant S as shelf-books
  H->>C: 启动时获取工具
  C->>S: tools/list
  S-->>C: 工具定义（名称、描述、schema、注解）
  U->>H: 帮我检查 agent-principles 能不能推送
  H->>H: 模型看到工具列表，决定调用 check_book
  H->>H: 权限检查（允许 / 询问用户 / 拒绝）
  H->>C: 调用 check_book
  C->>S: tools/call {bookId}
  S->>S: 校验参数，运行 @shelf/spec 的 lintBook
  S-->>C: 结果 + structuredContent
  C-->>H: 结果
  H->>H: 模型读结果，组织回复
  H-->>U: 通过校验，可以推送
```

## 传输方式

协议消息需要一个载体。MCP 定义了两种标准传输：

| | stdio | Streamable HTTP |
|---|---|---|
| 形态 | 宿主把 server 作为子进程启动，用 stdin / stdout 通信 | server 是一个独立的 HTTP 服务，宿主发 POST 请求 |
| 适合 | 本地工具：读本地文件、调本地命令 | 远程服务、多用户、SaaS |
| 生命周期 | 由宿主管理，宿主退出进程就结束 | 独立部署，长期运行 |
| 认证 | 不走 OAuth，凭证从环境变量读取 | 规范定义了基于 OAuth 2.1 的授权 |
| 典型配置 | `command` + `args` + `env` | `url` + 认证 |

### stdio

消息以换行分隔，每行一个 JSON-RPC 消息，消息内部不能有换行。server 从 stdin 读请求，往 stdout 写响应。由此得出写 stdio server 最重要的一条规则：

> **stdout 只能写协议消息。日志、调试输出、启动提示一律写 stderr。**

一行 `console.log('server started')` 就会让宿主读到一行不是 JSON-RPC 的内容，导致连接失败。SDK 文档专门强调了这一点，这也是新手写 MCP server 最常踩的坑。

### Streamable HTTP

server 暴露一个 HTTP 端点（通常是 `/mcp`），客户端用 POST 发送每个请求。server 可以直接返回一个 JSON 响应，也可以把响应升级成 SSE 流，在最终结果之前先推送进度等通知。2026-07-28 版去掉了会话之后，每个请求独立处理，server 可以像普通无状态 Web 服务一样横向扩展，部署到 Cloudflare Workers 这类平台也很自然。

这一版还要求 HTTP 请求带上标准头 `Mcp-Method`、`Mcp-Name`（以及 `MCP-Protocol-Version`），让负载均衡器、网关不解析请求体也能按方法路由和限流。工具的参数还可以用 `x-mcp-header` 标注，把某个参数值镜像到 `Mcp-Param-*` 请求头上。注意不要给密码、令牌这类敏感参数加这个标注，因为请求头对中间设备可见。

旧的 HTTP+SSE 传输（2024 年的最初设计）已经弃用，新项目不要使用。

## 工具相关的消息

最后看一下与工具直接相关的几个方法，第 5 章写代码时会对应上：

| 方法 / 通知 | 方向 | 作用 |
|---|---|---|
| `tools/list` | 客户端 → 服务端 | 获取工具列表，支持分页，结果带缓存提示 |
| `tools/call` | 客户端 → 服务端 | 调用工具，`params` 含 `name` 和 `arguments` |
| `notifications/tools/list_changed` | 服务端 → 客户端 | 工具列表变了，客户端应重新获取 |
| `resources/list` / `resources/templates/list` / `resources/read` | 客户端 → 服务端 | 列出和读取资源 |
| `prompts/list` / `prompts/get` | 客户端 → 服务端 | 列出和获取提示模板 |

规范还规定 `tools/list` 返回的工具集合**不能因连接而异**，但可以因请求所带的授权而异，比如只返回调用者权限范围内的工具。这条规则在第 6 章讲权限时会用到。

## 扩展与 MCP Apps

2026-07-28 版把「核心协议」和「扩展」分开了：核心只放每个实现都要支持的东西，其余做成可选的官方扩展，放在 `modelcontextprotocol` 组织下以 `ext-` 开头的仓库里。双方都声明支持某个扩展时才会用它：客户端在每个请求 `_meta` 的 `clientCapabilities.extensions` 里声明，server 在 `server/discover` 返回的能力里声明。

> [!WARNING]
> 扩展的名单、阶段和 MCP Apps 的字段按 2026 年 11 月 modelcontextprotocol.io 的 Extensions Overview、MCP Apps 和 Build an MCP App 页面整理。扩展各自独立演进，哪些客户端支持哪个扩展以官方的 Extension Support Matrix 为准。

扩展分三个阶段：Experimental（随时可变）、Beta、Stable（只随核心协议的新版本变化）。写作时的官方扩展：

| 扩展 | 标识 | 阶段 | 做什么 |
|---|---|---|---|
| MCP Apps | `io.modelcontextprotocol/ui` | Stable | server 返回可交互的 HTML 界面，在对话里渲染 |
| Tasks | `io.modelcontextprotocol/tasks` | Beta，计划并入核心 | 长时间运行的异步任务：轮询、中途补充输入 |
| Skills over MCP | `io.modelcontextprotocol/skills` | Beta | 通过 MCP 资源发现和读取 Agent Skills（第 7 章提到的那个方向） |
| OAuth Client Credentials | `io.modelcontextprotocol/oauth-client-credentials` | Stable | 机器对机器的授权，不需要人在浏览器里点 |
| Enterprise-Managed Authorization | `io.modelcontextprotocol/enterprise-managed-authorization` | Stable | 由企业身份提供商集中管控授权 |

### MCP Apps 怎么工作

普通工具返回的是文本、图片或结构化数据，宿主把它们当消息显示。MCP Apps 让工具多带一个**界面**：比如「按地区看销量」返回一张能点击下钻的地图，「配置一次部署」返回一张带校验的表单，而不是在对话里一问一答十几轮。

它没有发明新原语，而是把已有的两样拼在一起：一个工具，加一个 `ui://` 开头的资源。

```mermaid
sequenceDiagram
  participant H as 宿主
  participant A as App（iframe）
  participant S as MCP server
  H->>S: tools/list，发现工具带 ui 资源
  H->>S: resources/read ui://…
  S-->>H: 一份 HTML
  H->>S: tools/call
  S-->>H: 结果
  H-->>A: 把结果推给界面
  A->>H: 用户操作后请求调工具
  H->>S: tools/call（宿主代转）
```

要点：

- **工具声明界面**：工具定义的 `_meta.ui.resourceUri` 指向一个 `ui://` 资源，宿主可以在工具被调用之前就预加载它
- **界面是一份 HTML**：通常把 JS、CSS 打包成单个文件；要从外部域名加载资源，必须在资源的 `_meta.ui.csp` 里声明，否则默认拒绝
- **在沙箱 iframe 里运行**：界面碰不到宿主页面、拿不到 cookie；要麦克风、摄像头这类权限，在 `_meta.ui.permissions` 里申请，由宿主决定给不给
- **双向通信走宿主**：界面和宿主之间用 postMessage 上的一套 JSON-RPC 方言通信，部分方法和核心协议相同（如 `tools/call`），多数是 `ui/` 前缀的新方法。界面想调工具，要经宿主转发，照样受宿主的权限检查

官方 TypeScript 包是 `@modelcontextprotocol/ext-apps`：服务端用 `registerAppTool`、`registerAppResource` 注册工具和界面资源，界面里用 `App` 类和宿主通信。

对本书的书库 server 来说，「本书各章的图表、代码块数量一览」做成一个 MCP App 是合适的：数据本来就由 `list_books` 给出，界面只是换一种呈现。但要记住两点：**扩展是双方都声明才启用的，宿主不支持时界面不会出现，所以工具结果本身仍要是完整、有意义的文本或结构化数据**；界面是第三方代码在用户眼前运行，第 6 章讲的「工具返回的内容也是攻击面」对它同样成立。

## 本章要点

- Host 负责模型调用和权限，Client 是连接器，Server 暴露能力；模型从不直接和 server 通信
- 三种服务端原语：Tools（模型控制）、Resources（应用控制）、Prompts（用户控制）；Roots、Sampling、Logging 在 2026-07-28 版已弃用
- 消息格式是 JSON-RPC 2.0：请求、响应、通知
- 2026-07-28 版去掉了 `initialize` 握手和会话：每个请求在 `_meta` 里自带版本和能力，所有结果带 `resultType`，新增 `server/discover`
- 无状态意味着跨调用的状态要用显式句柄作为工具参数传递
- 新旧两代通过探测共存；SDK 2.x 的 server 默认双代兼容
- 传输：stdio 用于本地子进程，**stdout 只写协议消息**；Streamable HTTP 用于远程服务，现在可以无状态横向扩展
- 核心之外的能力以官方扩展提供，按 `extensions` 字段协商；MCP Apps 用「工具 + `ui://` 资源」在对话里渲染沙箱化的交互界面，宿主不支持时工具结果本身仍要完整可用

## 动手练习

1. **一行 console.log 毁掉 stdio**：不用 SDK，写一个最小的「宿主」：用 `spawn` 启动子进程，按行读它的 stdout，每行 `JSON.parse`，解析失败就打印「协议错误」。子进程先 `console.log("server started")`，再往 stdout 写一行 JSON-RPC 响应。运行后把子进程的 `console.log` 改成 `console.error` 再运行。

   验证：第一次输出一行「协议错误：不是 JSON-RPC → server started」，然后才是正常消息；改成 `console.error` 后只剩正常消息，`server started` 出现在终端的 stderr 里。

   参考答案：stdio 传输按行分隔消息，stdout 上的每一行都会被当成协议消息。真实宿主遇到这种行时，可能直接断开连接。

   ```js
   import { spawn } from "node:child_process";
   import { createInterface } from "node:readline";
   const child = spawn("node", [process.argv[2]]);
   createInterface({ input: child.stdout }).on("line", (line) => {
     try { console.log("收到消息", JSON.parse(line)); }
     catch { console.log("协议错误：不是 JSON-RPC →", line); }
   });
   ```

2. **认出消息的类型**：判断下面五条各是请求、响应还是通知，并指出哪条不符合 MCP 的约束：A. `{"jsonrpc":"2.0","id":7,"method":"tools/list","params":{}}`；B. `{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}`；C. `{"jsonrpc":"2.0","id":null,"method":"tools/call","params":{"name":"x"}}`；D. `{"jsonrpc":"2.0","id":7,"result":{"tools":[]}}`；E. `{"jsonrpc":"2.0","id":7,"error":{"code":-32602,"message":"Unknown tool: x"}}`。

   验证：A 请求、B 通知、C 不合法、D 和 E 是响应。

   参考答案：MCP 要求请求的 `id` 不能是 `null`。D 作为 2026-07-28 版的结果还缺 `resultType` 和列表结果要求的 `ttlMs`、`cacheScope`，按新版规范也不完整；E 是协议错误，模型通常看不到。

3. **把隐藏状态改成显式句柄**：一个旧的数据库 server 有三个工具：`open_db(path)`、`query(sql)`、`close_db()`，`query` 默认作用于「上次打开的那个库」。按本章「无状态对工具设计意味着什么」重新设计这组工具。

   验证：新设计里每个后续工具都有一个显式的句柄参数；`path` 不再是模型可传的参数（改由配置决定可选的库）；描述里写明句柄的有效期和过期后的处理方式。

   参考答案：例如 `open_db({ name })` 返回 `{ dbHandle, expiresAt }`，`query({ dbHandle, sql })`，`close_db({ dbHandle })`；句柄用足够随机的值；过期或未知的句柄返回可行动的工具错误「句柄已过期，请重新调用 open_db」。
