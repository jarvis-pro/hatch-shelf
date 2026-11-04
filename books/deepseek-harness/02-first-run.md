# 装好并跑起来

这一章从零开始：准备好环境，拿到模型的 API key，启动 DSH，让它在一个真实仓库里完成第一个任务，然后学会用 Trajectory 视图看它到底做了什么。最后整理一份「第一次用之前要知道的事」，包括一个默认开着、很多人没注意到的数据上传开关。

## 动手前的三条安全习惯

DSH 会真的读写文件、执行命令。官方的安全说明写得很直白：它没有经过安全审计，不应被当作安全的、可用于生产的软件。所以先养成三个习惯：

1. **在 git 仓库里用，先开一个新分支**。改坏了 `git checkout .` 就能回来
2. **不要在家目录、系统目录或存着重要资料的目录里启动它**。它默认的工作范围就是你启动时所在的目录
3. **不要把生产环境的密钥放在它能读到的地方**。`.env` 里有线上数据库密码的项目，先拿一份脱敏的副本来练手

这些规则第 7 章会讲清楚背后的原因，这里先照做。

## 三种安装方式

> [!WARNING]
> 本节的安装命令、端口和支持平台按 2026 年 11 月初的官方 README 和产品页整理，可能已变化，以官方仓库 README 的「运行」一节为准。

| 方式 | 适合谁 | 怎么做 |
|---|---|---|
| 桌面应用 | 不想碰命令行，只想用 | 从 DeepSeek 官网的 Harness 页面下载，支持 macOS（Apple 芯片）和 Windows（64 位） |
| npm 直接运行 | 有 Node.js，想快速试 | `npx @deepseek-ai/dsh web` |
| 从源码运行 | 想读源码、写插件 | 克隆仓库后 `pnpm install`、`pnpm run build`、`pnpm dsh web` |

本书以 npm 方式为主，因为它和写插件的路线衔接最好。先装好 Node.js（选当前的 LTS 版本即可），然后：

```bash
npx @deepseek-ai/dsh web
```

这条命令会下载并启动 DSH，在 `http://127.0.0.1:3080` 打开 Web 界面，本机启动时还会自动打开浏览器。想经常用，可以全局安装：

```bash
npm install -g @deepseek-ai/dsh
dsh --version
dsh web
```

几个常用的启动参数：

| 写法 | 作用 |
|---|---|
| `dsh web --no-open` | 只启动服务，不自动打开浏览器 |
| `dsh --profile web --port 8080` | 换一个端口 |
| `dsh --profile web --help` | 查看 Web 应用自己的全部参数 |
| `dsh --help` | 查看启动器的参数 |

`dsh web` 是 `dsh --profile web` 的简写。「profile」可以先理解成「一套启动配置」，第 8 章会讲它的真正含义。

### 从源码运行

要写插件（第 9 章），最终会需要源码：

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 准备构建产物，`pnpm dsh web` 直接用这些产物启动，不会自动重新构建。改了源码想边改边看，用 `pnpm run dev:web`。

## 拿到 DeepSeek API key

DSH 本身免费，但模型推理要花钱，按 token 计费，钱付给模型提供方。默认用的是 DeepSeek 自己的 API：

1. 登录 DeepSeek 开放平台，创建一个 API key
2. 充一点钱。练手阶段几块到十几块钱足够跑很多次小任务
3. 把 key 交给 DSH，两种方式任选：
   - 在 Web 界面打开 **设置 → 模型（Settings → Models）**，填进 DeepSeek 卡片，保存。不需要重启
   - 启动前在终端里设环境变量

```bash
export DEEPSEEK_API_KEY="sk-你的key"
dsh web
```

在界面里填的 key 只能写不能读，保存后只显示打码的摘要。它实际存在 `$DSH_HOME/.credentials.yaml` 里，设置文件里只保存一个引用。`$DSH_HOME` 默认是 `~/.dsh`。

> [!CAUTION]
> 不要把 key 写进项目里的任何文件，也不要贴进对话框让 agent「帮你配置」。agent 能读到的东西，就可能出现在日志、提交记录或者发给模型的请求里。

## 第一个任务

### 选工作区

刚打开的 Web 界面没有选中任何工作区，输入框是灰的。点 **选择工作区（Choose workspace）**，添加一个项目目录并选中它。

这里拿本书架作者自己的项目 hatch-shelf（一个 Expo 写的离线 Markdown 书架 App）做例子。先开一个练手分支：

```bash
cd ~/works/hatch-shelf
git switch -c try-dsh
dsh web
```

### 发出请求

新建会话，选好模型，输入官方文档里的入门例子：

```text
总结这个仓库是做什么的，列出它的主要包和各自的职责。
```

你会看到它开始一步一步地干活。一个顺利的过程大概是这样：

```text
你：总结这个仓库是做什么的，列出它的主要包和各自的职责。

DSH：（read README.md）
     （glob "*/package.json"、"packages/*/package.json"）
     （read package.json、pnpm-workspace.yaml）
     （read packages/spec/src/schema.ts 的开头）
     这是一个个人自用的 iOS 离线 Markdown 书架……
     主要的包：
     - app/：Expo App……
     - packages/spec：book.yaml 的 schema 和导入安全规则，App 和 CLI 共用……
     - tools/shelf-pack：Node 命令行工具，负责校验、打包、推送……
```

注意它不是一口气回答的，而是**先读、再找、再读，最后才回答**。括号里的每一步都是一次工具调用。

### 再来一个会动手的任务

只读任务不会碰你的文件。试一个要改东西的：

```text
给 packages/spec 里的 tags 校验补一条单元测试：重复的 tag 应该报错。写完跑一下这个包的测试。
```

这次它会请求编辑文件、运行 `pnpm test`。在默认的权限设置下（工作区内可写、越界操作要问你），界面会在需要的时候弹出审批，问你是否允许。**每一次审批都认真看一眼它要执行的命令**，这是你在安全上最直接的一道关。

## 用 Trajectory 看清它做了什么

会话页面有一个 **Trajectory（轨迹）** 标签。打开它，你会看到这次任务的完整过程：

- 每一次模型请求：发了什么、回了什么、用了多少 token、花了多久
- 每一次工具调用：工具名、参数、结果
- 子 agent 的调用也能展开查看

刚开始学 DSH，**建议每做完一个任务都翻一下 Trajectory**。几次之后你会形成直觉：什么样的任务它会读很多文件、哪一步最费 token、它在哪里绕了弯路。后面讲 agent 循环和会话日志时，你在 Trajectory 里看到的每一行都会对上号。

## 换模型

输入框附近有模型选择器。切换后从**下一次请求**开始生效，不用重启服务。选中的模型也会成为新会话的默认模型；已经开着的会话继续用它日志里记录的模型。

想接其他家的模型（OpenAI、Anthropic、Kimi、GLM，或者公司内部的网关），在 **设置 → 模型** 里添加，第 6 章细讲。

## 一个默认开着的数据开关

> [!WARNING]
> 本节描述的上传行为和开关位置按 2026 年 11 月初的官方文档 `docs/deepseek-llm-api-wire-extensions` 和 `dsh-session-log-deepseek` 包说明整理，以官方最新文档和界面为准。

使用 **DeepSeek 官方模型 API** 时，DSH 默认会在每次模型请求里额外附带一些信息，发到 DeepSeek 的接口：

| 附带的内容 | 包含什么 | 默认 |
|---|---|---|
| 请求头 | DSH 版本、一个匿名的本机 ID、会话 ID | 开 |
| 插件清单（`dsh_plugin_packages`） | 当前加载的插件包名和版本 | 开 |
| 会话日志（`dsh_session_log`） | 会话的完整事件日志，增量上传：工作目录、系统提示词、你和模型的全部对话、工具的参数和结果、压缩摘要等 | 开 |

这些附加字段不会进入模型的输入，不额外消耗 token，但**会离开你的电脑**。如果你在处理不想外传的代码或资料，先关掉它：

- 打开 **设置 → 通用**，关掉「**在使用官方模型 API 时上传 Session Log**」

关掉之后不再上传会话日志；重新打开时，会把关闭期间还没上传的部分补传上去。另外，官方提到匿名的设置和项目列表统计报告也可以关闭，在设置里找对应的选项。

用第三方模型或自建网关时，这些 DeepSeek 专用的扩展字段不会发送；但你的对话内容当然还是会发给那家模型提供方，这是任何 agent 都避免不了的。

## `~/.dsh` 里有什么

DSH 的本机数据都在 `$DSH_HOME`（默认 `~/.dsh`）下。认识几个主要位置，排查问题时用得上：

| 位置 | 内容 |
|---|---|
| `.credentials.yaml` | 你保存的 API key |
| `profiles/<名字>/` | 每个 profile 一个目录，比如 `profiles/web/`，里面有 `package.json` 和你自己的 `cordis.patch.yml` |
| `cordis.patch.yml` | 对本机所有 profile 生效的配置补丁 |
| `skills/` | 你个人的 Skills（第 5 章） |
| `logs/` | 启动日志，启动失败时报错里会指向这里的诊断文件 |
| `profiles/desktop/` | 桌面版专用的 profile |

会话记录默认也保存在本机。卸载 DSH 时这个目录不会自动删除，里面有你的对话历史和 key，记得自己处理。

## 新手常遇到的情况

| 现象 | 原因和处理 |
|---|---|
| 输入框是灰的 | 还没选工作区 |
| 报 `MISSING_CREDENTIAL` | 没有 key，或者环境变量没传进启动 DSH 的那个终端 |
| 报 `UNKNOWN_MODEL` | 选了一个没配置的模型，重新在选择器里选 |
| 任务做到一半停了，没说做完 | 预览版里偶尔会出现。输入「继续」，它会接着干；反复出现就把任务拆小 |
| 改了一堆不想要的东西 | 这就是为什么要先开分支。`git diff` 看清楚，`git checkout .` 撤回 |
| 想看它为什么这么做 | 翻 Trajectory |

## 本章要点

- 三种用法：桌面应用、`npx @deepseek-ai/dsh web`、源码；Web 界面默认在 `127.0.0.1:3080`
- 模型要自己付费；DeepSeek key 在「设置 → 模型」里填，或用 `DEEPSEEK_API_KEY` 环境变量，存放在 `~/.dsh/.credentials.yaml`
- 先选工作区再开会话；在 git 分支里练手，认真看每一次审批
- Trajectory 视图是学习 DSH 最好的窗口，每次任务后都翻一翻
- 用官方 DeepSeek API 时，会话日志默认会随请求上传，不想外传就在「设置 → 通用」里关掉
