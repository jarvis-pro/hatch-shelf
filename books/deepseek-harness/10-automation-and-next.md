# 自动化与接下来学什么

前面九章都是「人坐在界面前和 agent 一起干活」。这一章看 DSH 的另一面：不开界面，从命令行、脚本、Python 程序、编辑器或 GitHub 事件里驱动它。最后整理一份预览期的生存指南和后续的学习路线。

> [!WARNING]
> 本章的命令、SDK 用法和实验性功能按 2026 年 11 月初官方仓库的 `apps/cli/README.md`、`docs/user/guide/python-sdk.md` 和 `docs/user/guide/github-review.md` 整理。这些入口在预览期变化频繁，以官方最新文档为准。

## 五种运行形态

DSH 随发行版提供五个 profile 模板，对应五种用法：

| profile | 怎么启动 | 用途 |
|---|---|---|
| `web` | `dsh web` | 浏览器界面，日常使用 |
| `headless` | `dsh --profile headless "任务"` | 跑一个任务，打印最终回答，退出 |
| `sdk` | 由 SDK 启动 | 程序通过标准输入输出的 JSON-RPC 驱动它 |
| `sdk-minimal` | 由 SDK 启动 | 同上，但只带最小的工具集合 |
| `acp` | `dsh --profile acp` | 通过 ACP（Agent Client Protocol）服务编辑器等自动化客户端 |

桌面应用另有一个保留的 `desktop` profile，自带运行时。

它们不是五个不同的程序，而是同一套插件的五种组合：都以 `dsh-base`（模型、工具、存储、沙箱、审批……）为第一层，再叠上各自的入口。这正是第 8 章那套 profile 机制的用处。

## 一次性运行：headless

```bash
cd ~/works/hatch-shelf
dsh --profile headless "运行 pnpm shelf-pack check books/，把报错按书分组总结出来"
```

它会新建一个会话（会话照常保存，事后可以在界面里打开查看）、跑完任务、打印最终回答、退出。适合放进脚本或定时任务里。

无人值守时要多想一步：**没有人在界面前点「允许」**。按第 7 章的失败即关闭原则，没人应答的审批会被拒绝，所以需要审批的动作做不了。这是安全的默认行为。在 CI 里使用前：

- 用 `dsh --profile headless --dump-config` 看清它的沙箱和审批设置
- 只给它预先确定、范围明确的任务
- 在一次性的容器里跑，用只有必要权限的凭据

## Python SDK

想在自己的程序里调用 DSH，用官方 Python SDK：

```bash
python -m pip install deepseek-harness-sdk
export DEEPSEEK_API_KEY="sk-你的key"
```

要求 Python 3.10 以上；安装包里自带匹配的 `dsh` 运行时，**不需要另装 Node.js**。支持 Linux（x64、arm64）、macOS 14 以上（Apple 芯片）和 Windows x64。

官方示例的形状大致是这样：

```python
from pathlib import Path
from deepseek_harness import DeepSeekHarness

workspace = Path("~/works/hatch-shelf").expanduser()
dsh_home = Path("~/.dsh-sdk").expanduser()

with DeepSeekHarness(
    provider="deepseek-official",
    model="deepseek-v4-flash",
    max_tokens=49_152,
    cwd=str(workspace),
    dsh_home=str(dsh_home),
    profile="sdk-minimal",
) as harness:
    result = harness.run(
        "检查 books/ 下所有书的 book.yaml，列出缺少 subtitle 的书",
        session_id="audit-001",
    )
    print(result.final_response)
```

几点说明：

- `DeepSeekHarness` 在第一次使用时才在后台启动一个 `dsh` 进程，`with` 块结束时关闭
- `session_id` 相同的多次 `run` 会接着同一个会话往下聊；想要全新的上下文就换一个 id
- 给 SDK 一个**单独的 `dsh_home`**，和你日常用的 `~/.dsh` 分开，避免互相影响配置和会话
- `profile="sdk-minimal"` 只带最小的工具集；需要完整能力用 `sdk`
- 通知、事件等完整 API 见仓库里 `python/sdk/README.md`

官方架构文档也提到了 TypeScript SDK，原理相同：都是以 `sdk` profile 启动 `dsh` 命令行，再通过 JSON-RPC 和它通信。

## 接进编辑器：ACP

`dsh --profile acp` 通过 ACP 协议在标准输入输出上提供服务，支持 ACP 的编辑器或自动化客户端可以把 DSH 当作后端 agent。ACP 端为它自己的 agent 注册「一次性机器应答器」来处理审批，所以权限决策由客户端负责，接入前要清楚客户端会怎么回答审批。

## 由事件触发：定时任务和 webhook

- **定时任务**：第 5 章讲过，按日历规则定期启动一个会话，适合周报、定期巡检
- **webhook**（实验性）：官方有一个 GitHub 示例——拉取请求从草稿变成「待评审」时，自动在对应仓库的工作区里创建一个**只读**的评审会话。它在单独的端口上只开放一个 `POST /github` 接口，用签名密钥校验请求，需要你自己用反向代理或隧道把它暴露给 GitHub

这类功能把 DSH 从「助手」推向「无人值守的同事」，第 7 章的安全清单要更严格地执行：只读任务优先，密钥用专门生成的，端口只暴露必要的那一个。

## 预览期生存指南

DSH 还在快速迭代。几条让你少踩坑的习惯：

| 习惯 | 原因 |
|---|---|
| **固定版本** | `npx @deepseek-ai/dsh@<版本号> web`，或全局安装指定版本。不要让脚本每次拉最新版 |
| **升级前看升级指南** | 官方仓库 `docs/upgrade-guide/` 下按版本列出了每一项破坏性变更和迁移步骤 |
| **插件写上 `engines.dsh`** | 版本不兼容时直接拒绝加载，而不是运行到一半出错 |
| **配置改动后跑 `--dump-config`** | 确认你的补丁真的生效、没有误删别的配置 |
| **启动失败看 `~/.dsh/logs/`** | 报错会列出失败的插件、还在等依赖的插件和缺失的服务，并指向完整诊断文件 |
| **插件不工作先怀疑 PENDING** | 第 8 章：多半是某个依赖服务没加载 |
| **别直接解析会话文件** | 存储格式常变，用 SDK 或会话查询工具读取 |
| **遇到问题去官方渠道** | GitHub Discussions 提反馈和 bug |

## 三个练手项目

读完本书，按难度递增试试：

1. **只用不写**：在一个自己的项目里，用 Standard 模式完成一个真实的小任务（修一个 bug、补一组测试）。全程只用 `workspace-write` 预设，事后翻 Trajectory，数一数它读了多少文件、花了多少 token，想想哪些步骤可以通过改进说明文件省掉
2. **配置**：给项目写一个 `AGENTS.md` 和一个 Skill；接一个第三方模型，用同一个任务对比 DeepSeek 和它的表现与花费
3. **写插件**：把第 9 章的门禁插件改成可配置的（禁止的命令列表从配置读取），打包成组合包，装进一个新的 profile，用 headless 模式验证它确实拦住了被禁止的命令

## 接下来读什么

### 本书架里

| 想深入 | 读 |
|---|---|
| agent 的通用原理，DSH 每个设计为什么这样做 | [《Agent 原理与设计》](../agent-principles/) |
| 自己从零写一个 agent，体会 harness 替你做了什么 | [《动手构建 Agent》](../build-your-agent/) |
| 上下文、压缩、Skills 背后的道理 | [《上下文工程》](../context-engineering/) |
| 工具怎么设计、MCP 怎么写 | [《工具设计与 MCP》](../tools-and-mcp/) |
| 子 agent、团队、workflow 怎么编排 | [《多 Agent 编排》](../multi-agent/) |
| 沙箱、提示词注入、审计的完整框架 | [《Agent 安全》](../agent-safety/) |
| 把 agent 用成可靠的编码帮手（规矩、闸门、验收） | [《编码 Agent 实战》](../coding-agents/) |
| DeepSeek 模型本身：MoE、推理模型 | [《大模型原理进阶》](../llm-deep-dive/) |
| 评估 agent 做得好不好 | [《评测与质量》](../llm-evals/) |
| 写插件需要的 TypeScript 和 Node 功底 | [《TS 与 Node 进阶》](../ts-node-advanced/) |

### 官方资料

1. **官方仓库 README 和 `SAFETY.md`**：十分钟读完，先读
2. **`docs/architecture.md`**：第 3、8 章的概念全部出自这里，有中文版
3. **`docs/cordis-tutorial/`**：七章 Cordis 教程，不需要 API key
4. **`docs/user/develop/`**：插件开发教程，从第一个插件到打包发布
5. **`docs/glossary.md`**：术语表，遇到不认识的词先查这里
6. **`docs/subsystems/`**：每个子系统一篇，查具体 API 时用

### 论文和文章

- *A Programming Paradigm for Spatiotemporal Composability*（arXiv 2608.25512）：Cordis 的理论基础，偏程序语言理论，可以先只读摘要和引言
- *Security Assessment of DeepSeek Harness with A.I.G*（arXiv 2608.16393）：第三方对 DSH 抵御间接提示词注入能力的评估
- *Prompt-Induced Waste in Coding Agents*（arXiv 2608.01347）：讨论推理强度、harness 设计和端到端成本之间的关系
- Anthropic 工程博客上关于 agent 和 harness 的系列文章，如 *Building effective agents*、*Effective context engineering for AI agents*、*Effective harnesses for long-running agents*：理解「harness」这个概念的来龙去脉

## 本章要点

- 同一套插件组合成五种 profile：web、headless、sdk、sdk-minimal、acp，对应界面、一次性运行、程序调用和编辑器接入
- headless 适合脚本和定时任务；无人值守时没人应答审批，需要审批的动作会被拒绝，这是安全的默认
- Python SDK 自带运行时，给它单独的 `dsh_home`，用 `session_id` 控制是否延续会话
- 定时任务和 webhook 让 DSH 无人值守地工作，安全要求随之提高
- 预览期要固定版本、升级前看升级指南、改配置后跑 `--dump-config`
