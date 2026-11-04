# 工具、模式与扩展

这一章讲日常使用 DSH 时最常打交道的东西：它手里有哪些工具，四种 Agent 模式有什么区别，怎么用项目说明文件和 Skills 教它规矩，怎么接 MCP，以及子 agent、目标、定时任务这些「让它干更大的活」的功能。

> [!WARNING]
> 本章的工具名、模式名、目录位置和默认开关按 2026 年 11 月初官方仓库的 `docs/tool-catalog.md`、`docs/subsystems/` 和各包 README 整理。预览期这些变化很快，以官方文档和你实际版本里的界面为准。

## 工具清单

DSH 的工具都由各自的插件提供，下面按用途分组列出常见的。不是每个模式、每个 profile 都会全部启用。

### 文件与搜索

| 工具 | 做什么 |
|---|---|
| `read` / `write` / `edit` | 读文件、整个写入、精确替换一段文本 |
| `apply_patch` | 用补丁格式一次改多处（Standard 模式启用） |
| `read_image` | 读图片，前提是当前模型支持图片输入 |
| `glob` / `grep` | 按文件名找文件、按内容搜索。内置打包的 ripgrep，不需要你另装 |
| `str_replace_editor` | 查看、创建、替换、插入的「瑞士军刀」式编辑器，Minimal 模式用它 |

### 执行

| 工具 | 做什么 |
|---|---|
| `bash`（Windows 上是 `pwsh`） | 跑 shell 命令，可以放到后台运行 |
| `job_list` / `job_output` / `job_kill` | 查看、读取、停止后台任务 |
| `terminal_open` / `terminal_send` / `terminal_read` 等 | 开一个持久终端，适合需要来回交互的程序（默认不开） |
| `lsp` | 调用语言服务器：跳转定义、找引用、看类型 |
| `run_code` | PTC 模式下运行一段调用工具的程序（下文细讲） |

### 联网

| 工具 | 做什么 |
|---|---|
| `web_search` / `web_fetch` | 搜索网页、抓取页面。用官方 DeepSeek key 时搜索不需要额外的 API |

### 计划与协作

| 工具 | 做什么 |
|---|---|
| `todo_write` | 维护一份待办清单，界面上显示成勾选列表 |
| `ask_user_question` | 停下来问你一个问题 |
| `exit_plan_mode` | 在计划模式下提交计划，等你批准后才开始动手 |
| `subagent` / `send_message` / `wait_agent` / `list_agents` / `interrupt_agent` | 派子 agent、给它发消息、等它结果、打断它 |
| `create_goal` / `get_goal` / `update_goal` | 设定一个跨多个轮次的目标 |
| `schedule_create` / `schedule_list` 等 | 创建和管理定时任务 |
| `workflow` / `ralph` | 用脚本编排多个子 agent；反复用全新 agent 冲击同一个目标 |
| `skill` | 加载一个 Skill 的完整说明 |
| `present` | 把产出的文件作为「交付物」展示给你 |

另外还有通过 MCP 接进来的外部工具，名字统一是 `mcp__<服务名>__<工具名>`。

## 四种 Agent 模式

DSH 把「这个会话能用哪些能力」打包成**Agent 预设（agent preset）**，界面上叫模式。官方介绍了四种：

| 模式 | 给模型什么 | 适合 |
|---|---|---|
| **Standard** | 完整的工具：文件编辑、shell、文件和网页搜索、Skills、计划、目标、子 agent、workflow | 默认选择，日常写代码和办公从这里开始 |
| **PTC** | 大部分工具还在，但模型通过写程序来调用它们 | 需要大量、重复的工具调用的任务 |
| **Minimal** | 只有一个持久 shell 和一个字符串替换编辑器 | 模型评测；想看「裸」模型能力 |
| **Creator** | 能检查 DSH 运行时、在内存里试插件的工具 | 开发插件和预设 |

### PTC：让模型写程序来调工具

PTC 模式最值得单独说。官方文档没有写出缩写的全称，从行为看对应的是「程序化工具调用（programmatic tool calling）」，产品页上它叫 Code mode。

普通模式下，模型每调一次工具都要走一个完整步骤：发请求、等回复、执行、把结果塞回上下文。如果任务是「把 200 个文件的标题都读出来，挑出没有一级标题的」，就是 200 次往返，上下文里堆满 200 份文件内容。

PTC 模式下，DSH 把可用的工具生成成一个**程序库（SDK）**，模型只看到一个 `run_code` 工具。模型写一段程序：

```ts
const files = await glob({ pattern: 'books/**/*.md' })
const missing = []
for (const f of files) {
  const text = await read({ path: f })
  if (!/^# /m.test(text)) missing.push(f)
}
return missing
```

这段程序在一个受控的运行环境里执行，里面每一次 `glob`、`read` 调用**仍然走同一条工具流水线**：权限检查、审批、沙箱一样不少。区别是中间结果留在程序里，只有最终的 `missing` 回到模型的上下文。往返次数和上下文占用都大幅下降。

上面的代码只是示意，生成的 SDK 里函数名和参数形状以你实际版本里 `run_code` 的说明为准。

## 用说明文件教它规矩

和 Claude Code、Codex 一样，DSH 会读取项目里的**说明文件**，作为每个会话的背景知识。默认行为（由 `dsh-agent-instructions` 插件提供）：

- **个人级**：`~/.dsh/AGENTS.md`，然后是 `~/.agents/AGENTS.md`
- **项目级**：从项目根（最近的含 `.git` 的目录）一路往下到当前工作目录，每一层的 `AGENTS.md` 和 `CLAUDE.md`，从宽到窄依次加载
- **本地覆盖**：`AGENTS.local.md`、`CLAUDE.local.md`，适合放不入库的个人偏好
- **预算**：个人级和项目级各自有一个字节上限（默认 64 KB），超出的部分会被截断

这意味着：**你为 Claude Code 写的 `CLAUDE.md`，DSH 直接就能用**。比如 hatch-shelf 仓库根目录的 `CLAUDE.md` 写了「声明任务完成前必须通过 `pnpm typecheck`、`pnpm test` 和 `pnpm lint`」，在这个仓库里打开 DSH，它的第一次请求就会带上这条规矩。`CLAUDE.md` 和 `AGENTS.md` 内容一样时只会加载一次。

说明文件怎么写，[《编码 Agent 实战》第 2 章](../coding-agents/02-claude-md.md)讲得很细，规则对 DSH 同样适用：短、具体、只写「不说就会做错」的事。

## Skills：按需加载的专项本领

Skills 是一种「平时只露个名字和简介，用到时才加载全文」的说明书。适合放篇幅较长、只在特定任务里需要的知识，比如「怎么给这个项目写一本新书」「怎么生成周报」。

DSH 按下面的优先级查找 Skills，排在前面的同名 Skill 胜出：

| 优先级 | 位置 | 说明 |
|---|---|---|
| 1 | `<项目根>/.dsh/skills` | 项目专用，DSH 自己的目录 |
| 2 | `<项目根>/.agents/skills` | 项目专用，和其他 agent 工具共享的目录 |
| 3 | 配置里指定的目录 | |
| 4 | `~/.dsh/skills` | 个人的 |
| 5 | `~/.agents/skills` | 个人的，跨工具共享 |
| 6 | 随插件打包的 Skills | |

一个 Skill 可以是一个目录 `<名字>/SKILL.md`（目录里还能放脚本、模板等附件），也可以是一个单独的 `<名字>.md`。名字必须是小写短横线格式，比如 `write-weekly-report`。

```text
.agents/skills/
└── new-book/
    ├── SKILL.md          # 开头写名字和一句话描述，正文写步骤
    └── book-template.yaml
```

会话开始时，模型只看到每个 Skill 的名字和描述；判断需要时调用 `skill` 工具加载全文。Skills 目录有变化时 DSH 会自动发现，不用重启。为什么这样设计，见[《上下文工程》第 6 章](../context-engineering/06-skills-progressive.md)。

## 接入 MCP

MCP（Model Context Protocol）是让 agent 接外部工具的通用协议，[《工具设计与 MCP》](../tools-and-mcp/)整本书都在讲它。DSH 通过 `dsh-mcp-client` 插件接 MCP 服务器，支持本地子进程（stdio）和远程（Streamable HTTP）两种方式。

接入方式是在配置补丁里插入一行（第 8 章会解释「补丁」）：

```yaml
- insert:
    - id: mcp-my-memory
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: my-memory
        transport: stdio
        command: my-memory-mcp
```

然后用 `dsh web --patch ./这个文件.yml` 启动；想长期生效，把这段合并进 `~/.dsh/profiles/web/cordis.patch.yml`。接上后，这个服务器的工具会以 `mcp__my-memory__<工具名>` 的形式出现。

几个要点：

- 启动 stdio 服务器前，DSH 会从环境变量里**剔除看起来像密钥的变量和所有 `DSH_*` 变量**。服务器需要的密钥要在配置的 `env` 里显式给出（引用环境变量，不要把密钥写进 YAML）
- 服务器崩溃会自动重连；重连次数用尽后工具会被注销
- 目前不支持 MCP 的提示词模板、向用户索取输入（elicitation）和资源订阅
- 官方仓库带了三份「记忆」类 MCP 服务器的参考配置（Memorix、官方参考 memory 服务器、Engram），默认都关着，作为示例很好用

## 让它干更大的活

下面这些功能把 agent 从「回答一个问题」推向「完成一个项目」。都还比较新，部分标为实验性。

### 子 agent

主 agent 可以用 `subagent` 工具把一块独立的工作派给子 agent，自己接着干别的；之后用 `wait_agent` 等结果，或用 `send_message` 追加指示。子 agent 可以全新开始，也可以从当前会话分叉（继承上下文）；可以用不同的模型，甚至不同的模式。

什么时候值得派子 agent、怎么控制成本，见[《多 Agent 编排》](../multi-agent/)。

### Agent Teams

在根会话上开启 Team 模式后，一组 agent 共享一块**任务板**（`team_task_create`、`team_task_update` 等），可以认领、更新任务。任务变化不会自动唤醒别的 agent，需要显式发消息通知。

### 目标（goal）

用 `/goal` 命令或 `create_goal` 工具给会话设定一个目标。目标是附着在会话上的一个持久状态（进行中、暂停、受阻、完成），agent 每完成一轮会检查目标，没完成就自动开始下一轮，直到完成、受阻或达到轮数上限。

一个安全细节：创建、修改、暂停、恢复目标需要**人**的授权；会话恢复或分叉后，自动续做默认是「解除」状态，必须由你重新确认才会继续跑。这是为了防止一个旧会话被重新打开时自己悄悄干起活来。

### Ralph 循环

`ralph` 工具反复启动**全新**的子 agent 去冲击同一个不变的目标，每一轮不继承上一轮的对话，只通过共享的工作区和一份结构化的交接报告传递进度。适合那种「做到一半上下文就乱了，不如换个干净的脑子重来」的长任务。

### 定时任务

`schedule_create` 等工具或界面里的定时任务功能，可以按日历规则（RFC 5545，和日历软件的重复规则同一个标准）定期触发一个会话，比如每周一早上九点生成周报。子 agent 不能创建定时任务。

### 计划模式

让 agent 先只读、只规划，用 `exit_plan_mode` 把计划交给你，你批准后它才开始改东西。大改动前先对齐方案，和 Claude Code 的 plan 模式是同一个思路。

## 和 Claude Code 生态的兼容

如果你在 Claude Code 里攒了一些东西，DSH 有几座「桥」：

- `CLAUDE.md` 直接被说明文件加载器读取（上文）
- `.agents/skills` 是跨工具共享的 Skills 目录
- 有一个桥接插件能运行 Claude Code 的 settings hooks（`dsh-hooks-claude-code`）
- 有一个**实验性**的桥接插件能加载 Claude Code 的 mods，但行为有不少差异，而且 mod 在 DSH 里不受沙箱约束，第 7 章会提醒这一点

## 本章要点

- 工具按用途分为文件与搜索、执行、联网、计划与协作，MCP 工具名统一为 `mcp__服务名__工具名`
- 四种模式：Standard 是默认；PTC 让模型写程序批量调工具，仍走同一条安全流水线；Minimal 只有 shell 和编辑器，用于评测；Creator 用于开发插件
- DSH 读取 `AGENTS.md` 和 `CLAUDE.md`（个人级 + 项目根到当前目录），为 Claude Code 写的说明文件可以直接复用
- Skills 放在 `.dsh/skills`、`.agents/skills` 或 `~/.dsh/skills` 等目录，平时只露名字，用到才加载
- 子 agent、Teams、目标、Ralph、定时任务、计划模式让它能接更大的活；目标的自动续做需要人来授权
