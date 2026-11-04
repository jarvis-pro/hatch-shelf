# 代码评审与测试

agent 写代码的速度远超你读代码的速度。这是它的价值，也是它最大的风险：如果每一行都要你逐字审，你就成了瓶颈；如果不审，错误会以同样的速度堆积。出路是**把验收尽量交给机器，把你的注意力留给机器验不了的地方**。这一章讲怎么搭这套验收：让 agent 自己跑测试闭环、用测试守住规矩、用新上下文做评审，以及你读 diff 时该盯着什么。

## 反馈环：越早越便宜

![agent 的反馈环从快到慢依次是：类型检查和 lint、单元和集成测试、端到端和真机验证、人读 diff 评审、上线后用户发现；越往下越慢、修起来越贵](assets/feedback-ladder.svg)

这张阶梯对人类开发者同样成立，但对 agent 尤其要紧，原因有二：

- **agent 能自己用上面几层**。类型检查和测试的报错是它能读懂、能据此修改的。上面几层越完整，它越能自己闭环
- **agent 不会累，但会自信**。它说「改好了」时的语气，和真改好了时一模一样。只有机器检查的结果是可信的

所以搭验收的顺序是：先把最上面两层做扎实（这是投入产出比最高的），再考虑端到端，最后才是你的人工评审。

## 第一层：类型检查和 lint 要严

对 agent 来说，**TypeScript 的严格模式就是免费的测试**。`strict: true`、`noUncheckedIndexedAccess` 这类选项会让 agent 写的代码在编译期就暴露大量错误，而且报错信息精确到行，它修起来很快。

lint 规则同理。hatch-shelf 专门接入了 ESLint 并开启 `no-floating-promises`（忘了 await 的 Promise），这是 agent 很常犯、运行时又很难发现的错。CLAUDE.md 里配了一句：

```markdown
`no-floating-promises` 不要用 `// eslint-disable` 绕过：确实不需要等待时写 `void promise`，
需要处理失败时加 `.catch`。
```

注意它同时给了「不许做什么」和「该怎么做」。只说「不许绕过」，agent 被卡住时可能会换一种方式绕过；给出正确写法，它就有路可走。

hatch-counter 和 hatch-recordwall 都把「`pnpm lint` 零 error 零 warning，别让它长回来」写进了 CLAUDE.md。零告警是一个容易守的状态：只要有一条 warning 被放过，很快就会有第二条、第十条，agent 也会把「有 warning」当成正常。

## 第二层：测试是 agent 的完成标准

### 写进 CLAUDE.md

```markdown
声明任务完成前必须通过 `pnpm typecheck`、`pnpm test` 和 `pnpm lint`。
```

这一句让 agent 的「完成」有了客观定义。再配合第 4 章的 Stop hook，它就没法跳过。

### 先写测试再写实现

对边界清楚的任务，让 agent 走测试先行最稳：

```text
给 @shelf/spec 加一个函数，判断章节文件名是否合法（只允许 [a-z0-9-] 和 .md）。
先只写测试，覆盖合法名、大写、空格、中文、没有扩展名、双扩展名这几种情况，
跑一遍确认它们失败，然后停下来给我看测试。
```

你确认测试覆盖的是你想要的行为后，再让它写实现、跑到全绿。好处是：

- 你审的是**测试**（行为的描述），而不是实现细节，审起来快得多
- 测试先失败再通过，证明测试确实测到了东西
- agent 有了明确的目标，不会在「看起来对了」时停下

### 测试守规矩

上一章讲过把架构边界写成测试。这里再强调一个模式：**每当 rules 里写下一条「改坏了不报错」的规矩，就想想能不能变成测试**。hatch-counter 的服务端 rule 里写着「新加带 `store_id` 的业务表，两处都要加」，紧跟着就是「`tests/rls.test.ts` 扫着」「`tests/live.e2e.test.ts` 守着」。规矩负责告诉 agent 为什么，测试负责保证它做到。

### 盯住「改测试让它通过」

agent 被测试卡住时，有一种很危险的捷径：改测试，而不是改代码。常见形态：

| 形态 | 怎么发现 |
|---|---|
| 删掉失败的用例 | diff 里测试文件有大段删除 |
| 加 `.skip` / `.only` | 搜 `\.skip\(`、`\.only\(` |
| 把断言改成和错误结果一致 | 断言里的期望值变了，但需求没变 |
| 把 `toEqual` 放宽成 `toBeDefined` | 断言变弱了 |

在 CLAUDE.md 里明说：「测试失败时修代码，不要修改已有测试的断言；确实需要改测试时先说明理由」。hatch-counter 的 business rule 里有一句更强的：分析那几份断言「是逐字从单机时代桌面端的老测试抄来的，『两端给同一个数』靠的就是它」——告诉 agent 这些测试是基准，不能动。

## 第三层：让 agent 自己去看

类型和单测都过了，不代表功能真的对。界面错位、交互卡住、真机上崩溃，只有跑起来才看得到。现在的编码 agent 已经能自己做一部分这类验证：

- **浏览器预览**：Claude Code 的桌面端能起开发服务器、打开预览、截图、读控制台报错。hatch-counter 和 hatch-recordwall 的 `.claude/launch.json` 就是为此准备的，里面登记了每个 app 的启动命令和端口
- **iOS 模拟器**：能构建、安装、截图、点按。hatch-shelf 的 dev client 就可以这样验
- **自制的探针**：hatch-recordwall 有一个 `pnpm eval '<js>'`，能在跑着的 App 里执行一段 JS，CLAUDE.md 说明它的用途是「模拟器点不动时靠它验」。给 agent 造一个能观察运行时状态的工具，往往比让它看截图更可靠

在任务里明确要求：「改完之后启动 App，打开阅读页截图给我看」。让它拿出证据，而不是一句「应该没问题了」。

## 第四层：评审

### 让新上下文来评审

写代码的会话评审自己的代码，效果有限：它会沿着自己的思路觉得一切合理。更好的做法是换一个没参与过的上下文：

- 用第 5 章的 `diff-reviewer` 这类只读子 agent，只给它 diff 和项目规矩
- 用 Claude Code 自带的评审类 Skill，比如 `/code-review`（审当前改动的正确性问题），以及 `/security-review`（审安全问题）。具体参数随版本变化，用前看 `/help`
- 开一个新会话，让它读 `git diff main...HEAD` 并对照 CLAUDE.md 找问题

要点是**给它代码，不给它结论**。如果你在评审请求里写「我觉得这个改动没问题，帮我确认一下」，它很可能就确认了。

### 用脚本做无人值守的评审

`claude -p` 是非交互模式，能塞进任何脚本。比如提交前对暂存区做一次评审：

```bash
#!/usr/bin/env bash
# scripts/review-staged.sh：对暂存的改动做一次评审，结果打印到终端
set -euo pipefail

git diff --cached | claude -p \
  --append-system-prompt "你是这个仓库的代码评审。对照仓库的 CLAUDE.md，只报告正确性问题、违反项目规矩之处、被绕过的检查（eslint-disable、any、被删或跳过的测试）。每条一行：文件:行号 问题。没有问题就输出「无」。" \
  --allowedTools "Read,Grep,Glob"
```

几个参数：`-p` 非交互执行并打印结果；`--append-system-prompt` 在默认系统提示词之后追加要求；`--allowedTools` 预先放行只读工具，让它能去读相关文件而不用等你批准。需要机器解析结果时加 `--output-format json`，结果在 `result` 字段里。在 CI 里跑时，官方建议加 `--bare`，跳过本机的 hooks、插件、CLAUDE.md 自动发现，让每台机器上结果一致（它需要用 API key 认证）。

hatch-counter 没有 CI，CLAUDE.md 写的是「提交前在仓库根跑 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`。仓库没有 CI，这四条本地跑是唯一的早期反馈」。对一人公司来说这很现实：与其维护一套 CI，不如把本地检查做严、让 agent 每次都跑。

### 你读 diff 时盯什么

机器检查过了，你的人工评审就可以聚焦在机器看不出的地方：

| 盯什么 | 为什么 |
|---|---|
| 改动范围是否超出任务 | agent 爱顺手「改进」无关代码，diff 变大、风险变高 |
| 删掉了什么 | 删除比新增更危险，尤其是删了校验、删了测试 |
| 绕过了什么 | `eslint-disable`、`as any`、`@ts-ignore`、`catch {}` 吞掉错误 |
| 新加的依赖 | 是否必要、版本是否合适、Expo 项目是否用了 `npx expo install` |
| 逻辑放的位置 | 是否放在了 CLAUDE.md 规定的地方，而不是离手最近的地方 |
| 硬编码 | 地址、密钥、魔法数字 |
| 用户可见的文案 | agent 写的报错和提示常常是「技术正确但不说人话」 |

最后一条在 hatch-counter 里是明文规矩：「面向店主写文案：报错、空态、确认框都是中文人话，说清后果」。

一个实用的习惯：**先看 `git diff --stat`**。如果你让它修一个 bug，它改了十五个文件，先别看内容，直接问它为什么。

## 无人值守：headless 与 GitHub Actions

上面那个评审脚本已经是 headless（非交互）用法的雏形。把 agent 放进脚本、定时任务或 CI 时，没有人能点「允许」，几件事要提前想好。

> [!WARNING]
> 本节的参数和默认值按 2026 年 11 月 code.claude.com 的「Run Claude Code programmatically」「Choose a permission mode」「Claude Code GitHub Actions」文档整理。`--bare` 官方预告会在以后成为 `-p` 的默认行为，以官方文档为准。

### `claude -p` 的几块积木

| 参数 | 作用 |
|---|---|
| `-p` | 非交互执行，打印结果后退出；成功退出码 0，失败非 0 |
| `--bare` | 不自动加载 hooks、Skills、插件、MCP、自动记忆和 CLAUDE.md，每台机器结果一致；只认 `ANTHROPIC_API_KEY`，不用订阅登录 |
| `--output-format json` | 结果在 `result` 字段，带会话 id 和用量；`stream-json` 逐行输出事件 |
| `--json-schema '<schema>'` | 要求按给定结构输出，结果在 `structured_output` 字段；模型拒绝时这个字段不存在，用之前先判断 |
| `--permission-mode` | 整场运行的权限基线，见下 |
| `--allowedTools` | 预先放行的工具，写法和权限规则一样，如 `"Bash(pnpm test *)"` |
| `--max-turns` | 限制轮数，防止跑飞 |
| `--continue` / `--resume <id>` | 接着上一次的会话跑 |

不加 `--bare` 时要记住第 4 章说过的那条：`-p` 不弹信任对话框，**项目 `.claude/settings.json` 里的 hooks 和 `.mcp.json` 里的 server 会直接运行**。在 CI 里处理别人提交的 PR 时，这就是一个注入入口。

### 无人值守时的权限

`claude -p` 默认从 Manual 模式开始，需要审批的调用没人批，就直接被拒绝。三种常见配法：

- **白名单**：`--permission-mode dontAsk --allowedTools "Bash(pnpm test *)" "Read"`。只做列出来的事，其他一律拒绝，最可预测，适合 CI
- **分类器**：`--permission-mode auto --permission-prompts none`。由 auto 模式的分类器逐个判断，落到「需要问人」的一律拒绝并告诉 Claude 别重试，适合定时跑的维护任务
- **全放开**：`--dangerously-skip-permissions`。只在一次性的容器、虚拟机里用，并以非 root 用户运行

```bash
# 每晚跑一次：只允许跑测试和读文件，结果写成 JSON 供后续脚本处理
claude --bare -p "跑 pnpm test，失败的用例逐条说明原因，不要改代码" \
  --permission-mode dontAsk \
  --allowedTools "Bash(pnpm test *)" "Read" \
  --max-turns 20 \
  --output-format json | jq -r '.result'
```

### GitHub Actions

官方的 `anthropics/claude-code-action` 把同样的能力接到 GitHub 上。在仓库里打开 Claude Code，输入 `/install-github-app`，它会安装 Claude GitHub App、把 API key（或用 `claude setup-token` 生成的订阅令牌）存成仓库 secret，再推一个带工作流文件的分支让你开 PR。需要仓库管理员权限，也可以照文档手工配置。

它有两种运行方式：

- **交互模式**：工作流里不写 `prompt`，Claude 等 issue 或 PR 评论里出现 `@claude`，按评论的要求干活，结果回复在同一条讨论里
- **自动化模式**：写了 `prompt`（可以是一段话，也可以是调用一个 Skill），每次触发就直接跑，比如每个 PR 打开时自动评审

```yaml
# .github/workflows/claude.yml：评论里 @claude 时响应
name: Claude Code
on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
jobs:
  claude:
    if: contains(github.event.comment.body, '@claude')
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: write
      pull-requests: write
      issues: write
      id-token: write
      actions: read
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 1
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          claude_args: "--max-turns 10"
```

几条要点：

- **谁能触发**：默认只有对仓库有写权限的人能触发，机器人账号也被挡住（防止 bot 互相触发成循环），要放开分别用 `allowed_non_write_users`、`allowed_bots`
- **规矩照样来自 CLAUDE.md**：Action 里的 Claude 每次运行都读仓库的 CLAUDE.md，前几章写下的规矩在这里同样生效；也因此 CLAUDE.md 越短，每次运行越省
- **成本是两份**：GitHub Actions 的分钟数加模型的 token。用 `--max-turns`、`timeout-minutes` 和 GitHub 的 `concurrency` 控制住上限
- **它的提交仍要人审**：Action 能开分支、推提交，合并前照本章前面的清单看 diff

对没有 CI 的个人项目（比如 hatch-counter），没必要为了它专门搭一套 CI；本地的 `claude -p` 评审脚本已经覆盖了大部分价值。仓库开始有协作者、PR 多起来时，再考虑接 Actions。

## 提交

评审通过后的提交也可以交给 agent，但要把约定写清楚。三个项目的共同约定：

- Conventional Commits 前缀，中文描述
- 描述写**改完之后是什么样**，不写改了哪个文件（hatch-counter 和 hatch-recordwall 都给了示例）
- 一个主题一个提交，代码和内容（书）不混在一个提交里
- 不加 AI 署名

提交是不可逆的协作动作，推送更是。可以在权限里把 `git push` 设为 `ask` 或 `deny`，提交前自己最后看一眼 `git log -p -1`。

## 本章要点

- 验收按反馈速度分层：类型检查和 lint → 测试 → 端到端 / 真机 → 人工评审 → 用户发现；越往上越便宜，先把上两层做扎实
- 严格的类型和 lint 是 agent 的免费测试；禁止绕过时要同时给出正确写法；保持零告警
- 「完成前必须通过 typecheck 和 test」写进 CLAUDE.md，配合 Stop hook；边界清楚的任务用测试先行
- 警惕 agent 修改测试让它通过：删用例、加 skip、改断言、放宽断言
- 让 agent 自己跑起来看：预览、模拟器、自制探针，要它拿出截图等证据
- 评审用新上下文，给代码不给结论；`claude -p` 能把评审塞进脚本；你读 diff 时盯范围、删除、绕过、依赖、位置、硬编码和文案
- 无人值守时先定权限基线：CI 用 `dontAsk` + 白名单，定时任务可用 `auto` + `--permission-prompts none`，`--bare` 让结果不受本机配置影响；GitHub Actions 用 `/install-github-app` 接入，`@claude` 触发或按 `prompt` 自动跑
