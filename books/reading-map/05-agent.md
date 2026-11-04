# Agent 原理与个人工作流

如果说大模型是「一个很聪明的大脑」，Agent 就是给这个大脑配上手脚、记忆和工作流程，让它能**自己完成一件事**。对一人公司来说，Agent 就是你的团队。

这个系列分三层：

| 层次 | 书 | 你会得到 |
|---|---|---|
| 原理 | Agent 原理与设计、上下文工程、工具设计与 MCP、多 Agent 编排 | 理解 agent 为什么有时聪明、有时犯傻 |
| 构建 | 动手构建 Agent、Agent 安全 | 能自己写出可靠、安全的 agent |
| 使用 | 编码 Agent 实战、个人 Agent 工作流、AI 认知进阶、DeepSeek Harness 入门 | 让 agent 每天替你干活，并保持清醒的判断 |

## 原理

### [Agent 原理与设计](../agent-principles/) · `agent-principles`

系列的总纲。讲 agent loop、工具、规划与反思、记忆、MCP 与 Skills、沙箱与权限，最后整理常见失败模式。后面每本书都是在展开它的某一章。

### [上下文工程](../context-engineering/) · `context-engineering`

Agent 的表现，很大程度上取决于它在每一步「看到了什么」。这本书讲上下文窗口的预算、记忆分层、压缩与摘要、按需检索，以及 Skills 的渐进式加载。

### [工具设计与 MCP](../tools-and-mcp/) · `tools-and-mcp`

工具是 agent 的手。这本书讲好工具的标准、描述与参数怎么设计、错误怎么返回，然后从协议讲到动手写一个 MCP server。

### [多 Agent 编排](../multi-agent/) · `multi-agent`

什么时候一个 agent 不够用，以及怎么组织多个 agent：子 agent 与上下文隔离、确定性 workflow、并行与汇总、交叉验证和成本控制。

## 构建

### [动手构建 Agent](../build-your-agent/) · `build-your-agent`

先从零写一个最小的 agent loop，再一步步加上工具、记忆和 MCP，然后用 Agent SDK 重写，最后部署成常驻服务。

### [Agent 安全](../agent-safety/) · `agent-safety`

Agent 能动手，就可能闯祸。这本书讲威胁模型、Prompt 注入、沙箱、权限边界、人在回路和审计。

## 使用

### [编码 Agent 实战](../coding-agents/) · `coding-agents`

讲你每天在用的编码 agent：CLAUDE.md / AGENTS.md 怎么写、rules 按路径加载、hooks、子 agent、怎么用它管理 monorepo，以及常见的坑。这套书本身就是这样写出来的。

### [DeepSeek Harness 入门](../deepseek-harness/) · `deepseek-harness`

DeepSeek 开源的 agent 运行时（`dsh`），从零讲起：装好跑起来，看懂 agent 循环和只追加的会话日志，配模型、管权限，再进入「一切皆插件」的 Cordis 底座，写出第一个插件。也是对照着理解 Claude Code 这类 harness 内部结构的一本书。

### [个人 Agent 工作流](../personal-agent-workflow/) · `personal-agent-workflow`

跳出写代码，看 agent 还能接哪些活：日常自动化、个人知识库、定时任务、写书、运维。重点是怎么把工作拆成 agent 能接的形状，以及怎么让工作流持续迭代。

### [AI 认知进阶](../ai-cognition/) · `ai-cognition`

技术之外的判断力：幻觉与能力边界、对齐与安全、AI 原生的产品思维、人机分工、怎么不被炒作带着走，以及一个人在 AI 时代的位置。
