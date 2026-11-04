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

DSH 把「这个会话能用哪些能力」打包成**Agent 预设（agent preset）**，界面上叫模式。官方介绍了四种，中文界面上依次叫标准、PTC、极简、创造：

| 模式 | 给模型什么 | 适合 |
|---|---|---|
| **Standard** | 完整的工具：文件编辑、shell、文件和网页搜索、Skills、计划、目标、子 agent、workflow | 默认选择，日常写代码和办公从这里开始 |
| **PTC** | 大部分工具还在，但模型通过写程序来调用它们 | 需要大量、重复的工具调用的任务 |
| **Minimal** | 只有一个持久 shell 和一个字符串替换编辑器 | 模型评测；想看「裸」模型能力 |
| **Creator** | 能检查 DSH 运行时、在内存里试插件的工具 | 开发插件和预设 |

### PTC：让模型写程序来调工具

0.2.1 起，内置的默认模式统一成 Standard，已有会话保持原来的模式；0.2.2 预发布版又把 PTC 改成通过配置叠加层启用，旧的 `tools.mode` 配置和 `DSH_TOOLS_MODE` 环境变量需要按升级指南迁移。自己改过配置的话，升级前看一眼 `docs/upgrade-guide/`。

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

`schedule_create` 等工具或界面里的定时任务功能，可以按日历规则（RFC 5545，和日历软件的重复规则同一个标准）定期触发一个会话，比如每周一早上九点生成周报。0.2.1 起它成了 Web 内置能力（界面上叫「自动化任务」），标准、创造和 PTC 模式可用，极简模式和子 agent 不能创建。

### 计划模式

让 agent 先只读、只规划，用 `exit_plan_mode` 把计划交给你，你批准后它才开始改东西。大改动前先对齐方案，和 Claude Code 的 plan 模式是同一个思路。

## 从 Claude Code 迁过来

> [!WARNING]
> 本节的对照按 2026 年 11 月 4 日官方仓库 master 分支的 `dsh-agent-instructions`、`dsh-hooks-claude-code`、`dsh-subagent-claude-code`、`docs/subsystems/skills` 和 `permission-presets` 文档，以及 0.2.1 / 0.2.2 预发布版的 release notes 整理。桥接插件大多是实验性的，以你实际版本为准。

如果你在 Claude Code 里攒了一套 CLAUDE.md、Skills、hooks、MCP 配置，搬到 DSH 时可以按下面这张表逐项对照。概念大多一一对应，差别在「放在哪儿」和「怎么开」：

| Claude Code | DSH 里对应的 | 迁移时要做的 |
|---|---|---|
| `CLAUDE.md`（项目根到当前目录） | 说明文件加载器直接读 `CLAUDE.md`、`AGENTS.md` 和对应的 `.local.md` | 基本不用动；但 `@路径` 导入不会展开 |
| `~/.claude/CLAUDE.md` | `~/.dsh/AGENTS.md`、`~/.agents/AGENTS.md` | 个人级说明复制或软链接过去 |
| `.claude/rules/*.md`（按路径加载） | 没有对应物，不会被读取 | 要紧的条目并进 `CLAUDE.md`，或改写成 Skill |
| `.claude/skills/` | `.dsh/skills`、`.agents/skills`、`~/.agents/skills` 等 | 挪到 `.agents/skills`，两边都能用；格式同样是 `SKILL.md` |
| 权限模式和 allow / deny 规则 | 权限预设（沙箱模式 × 审批策略），没有逐条命令的放行规则 | 「绝不能做」的事写成门禁插件（[第 9 章](09-write-a-plugin.md#第四步门禁插件)）或经 hooks 桥接 |
| `auto` 模式 | 实验性的 `auto` 预设：自动审查员代替你回答审批 | 思路相同，都是用另一个模型做判断，[第 7 章](07-safety.md#权限预设)讲了代价 |
| plan 模式、`/compact`、`/goal` | 计划模式、`/compact`、`/goal` | 用法几乎一样 |
| `settings.json` 里的 hooks | 实验性的 `dsh-hooks-claude-code` 桥接插件 | 在配置补丁里挂上它，`configPath` 指向原来的 hooks 文件 |
| `.mcp.json` | `dsh-mcp-client`，每个 server 一行配置补丁 | 按上文「接入 MCP」逐个改写，密钥改成环境变量引用 |
| `.claude/agents/` 子 agent 定义 | `subagent` 工具；可按需换模型、换模式 | 定义要重写；想原样用 Claude Code，可启用「Claude Code 子智能体」组合包 |
| `claude -p` | `dsh --profile headless` | 参数不同，见[第 10 章](10-automation-and-next.md#一次性运行headless) |
| Claude Agent SDK | DSH 的 Python / TypeScript SDK | 接口不同，要重写调用代码 |
| 插件和 marketplace | npm 包形式的插件，`dsh plugin --profile web add <包名>` 安装 | 不通用，Claude Code 插件需改写；mods 有一个实验性兼容层 |

几处值得多说一句：

- **hooks 桥接只覆盖一部分**。它只运行 `command` 类型的 hook，支持 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`、`SubagentStart`、`SubagentStop` 七个事件，其中 `SubagentStop` 只能观察不能拦截。配置读不出来时它只记一条警告，**不会阻止 DSH 启动**，所以靠 hook 守住的东西，迁过来后要亲手验证一次它真的在拦
- **规矩的约束力不变**。DSH 读你的 `CLAUDE.md`，但它和 Claude Code 一样只是「建议」。Claude Code 里用 deny 规则和 hook 兜住的事，在 DSH 里要用沙箱、审批或门禁插件重新兜一遍，不能以为说明文件带过来就够了
- **工具名不一样**。DSH 的工具是小写的 `read`、`bash`、`subagent`，Claude Code 是 `Read`、`Bash`、`Agent`。说明文件里如果写了「用 Read 工具读」这类话，模型通常能对上，但 hook 脚本里按 `tool_name` 判断的逻辑要检查一遍
- **mods 兼容层只是验证性质的**。release notes 原话是它主要用来验证 Claude Code mods 的 API「大致为 DSH 插件的一个子集」，不打算提供完整兼容；而且 mod 在 DSH 里不受沙箱约束（第 7 章）

比较稳妥的迁移顺序：先让 DSH 读同一份 `CLAUDE.md`、把 Skills 挪到 `.agents/skills`，在一个开了分支的仓库里跑几个只读任务；再接 MCP；最后才处理 hooks 和权限，因为这两样在两边的机制差别最大。

## 本章要点

- 工具按用途分为文件与搜索、执行、联网、计划与协作，MCP 工具名统一为 `mcp__服务名__工具名`
- 四种模式：Standard 是默认；PTC 让模型写程序批量调工具，仍走同一条安全流水线；Minimal 只有 shell 和编辑器，用于评测；Creator 用于开发插件
- DSH 读取 `AGENTS.md` 和 `CLAUDE.md`（个人级 + 项目根到当前目录），为 Claude Code 写的说明文件可以直接复用
- Skills 放在 `.dsh/skills`、`.agents/skills` 或 `~/.dsh/skills` 等目录，平时只露名字，用到才加载
- 子 agent、Teams、目标、Ralph、定时任务、计划模式让它能接更大的活；目标的自动续做需要人来授权
- 从 Claude Code 迁过来：`CLAUDE.md` 直接可用，Skills 挪到 `.agents/skills`；rules、`@` 导入不被读取，权限规则和 hooks 要用门禁插件或实验性桥接重新兜底

## 动手练习

1. **同一个任务，两种模式**（需要 API key）：在一个有几十个 Markdown 文件的仓库里，分别用 Standard 和 PTC 模式各开一个新会话，提同一个任务：「找出所有没有一级标题的 .md 文件」。两边都完成后打开 Trajectory。

   验证：Standard 模式下能看到大量 `read` 调用、模型请求次数多；PTC 模式下主要是一两次 `run_code`，模型请求次数和总输入 token 明显更少。两边给出的文件清单应当一致（可以用 `grep -L '^# ' $(find . -name '*.md' -not -path '*/node_modules/*')` 自己核对）。

   参考答案：PTC 的中间结果留在程序里，只有最终清单回到上下文。如果你的版本里 PTC 要通过配置叠加层启用，按本章提到的 `docs/upgrade-guide/` 操作。

2. **确认它读到了你的 CLAUDE.md**（需要 API key）：在练手仓库的 `CLAUDE.md` 里加一条显眼又无害的规矩，例如「每次回答都以『收到。』开头」，然后在 DSH 里开新会话随便问一句。

   验证：回答以「收到。」开头；在 Trajectory 里展开第一次模型请求，系统提示词里能找到这句话。删掉这条后新开会话，它不再出现。

   参考答案：说明文件在会话开始时加载，中途修改不会影响已经开着的会话，而且会让提示词缓存失效，所以改完要开新会话验证。

3. **写一个会被加载的 Skill**（需要 API key）：在练手仓库建 `.agents/skills/count-chapters/SKILL.md`，描述写「统计某本书的章节数时使用」，正文写「读 book.yaml 的 chapters 字段，只回答数字」。新开会话问「agent-principles 这本书有几章」。再把目录名改成 `CountChapters` 重试一次。

   验证：第一次 Trajectory 里出现一次 `skill` 工具调用，回答只有一个数字；改成大写目录名后不再出现 `skill` 调用。

   参考答案：Skill 名字必须是小写短横线格式，不合规的不会被发现。模型平时只看到名字和描述，所以描述里要写清「什么时候用」。
