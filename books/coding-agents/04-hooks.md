# hooks

前两章写的都是「请求」：CLAUDE.md 和 rules 告诉 agent 该怎么做，它大多数时候会照做，但不保证。这一章讲**保证**：hooks 是 Claude Code 在生命周期的固定时刻自动执行的命令，不经过模型判断。改完文件自动格式化、碰生成目录直接拦下、收工前强制过一遍类型检查——这些事不该靠 agent 记得，而该由机器来做。

## 什么时候该用 hook

一句话判断：**这件事每次都必须以同样的方式发生，而且不需要动脑子吗？** 是，就写成 hook。

| 场景 | CLAUDE.md 里写 | 写成 hook |
|---|---|---|
| 改完 TS 文件要格式化 | 它有时忘 | 每次编辑后自动跑 prettier |
| `ios/` `android/` 是生成的，不许手改 | 它偶尔还是会改 | 编辑前拦截，告诉它去改 `app.json` |
| 收工前要通过类型检查 | 它有时说「应该没问题」就收工 | 想停下时先跑检查，不过不让停 |
| 等你批准时提醒你 | 做不到 | 发一条系统通知 |

反过来，需要判断的事（「这个改动是否符合架构原则」）不适合用命令式 hook，留给 CLAUDE.md 和评审。

## 配置结构

hooks 写在 settings 文件的 `hooks` 字段里，三层结构：**事件 → 匹配组 → 处理器**。

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/format.sh",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

写在哪个文件决定了作用范围：

| 位置 | 范围 | 入库吗 |
|---|---|---|
| `~/.claude/settings.json` | 你所有的项目 | 否 |
| `.claude/settings.json` | 本项目 | 是，团队共享 |
| `.claude/settings.local.json` | 本项目，仅本机 | 否 |
| Skill 或子 agent 的 frontmatter | 那个 Skill / 子 agent 运行期间 | 跟着文件走 |

会话里输入 `/hooks` 可以浏览当前生效的所有 hooks。来自不同层级的 hooks 是**合并**的，匹配到的全部执行。

### 常用事件

Claude Code 的 hook 事件有三十多个，日常用得上的是这几个：

| 事件 | 什么时候触发 | 典型用途 |
|---|---|---|
| `PreToolUse` | 工具调用之前 | 拦截危险操作、保护文件 |
| `PostToolUse` | 工具调用成功之后 | 格式化、跑 lint 并把结果反馈给它 |
| `Stop` | agent 准备结束本轮时 | 收工前的强制检查 |
| `Notification` | 等你输入或批准时 | 系统通知 |
| `SessionStart` | 会话开始、恢复、压缩之后 | 注入动态上下文 |
| `UserPromptSubmit` | 你提交消息之后、模型处理之前 | 给消息附加上下文、拦截 |

### matcher 怎么写

`matcher` 用来筛选工具（对工具类事件）：

- 省略、`""` 或 `"*"`：全部匹配
- 只含字母数字和 `|`：精确匹配一个或几个工具名，如 `Edit|Write`
- 含其他字符：当作正则，如 `mcp__github__.*`。注意正则不锚定，`Edit.*` 也会匹配 `NotebookEdit`，要整词匹配写 `^Edit$`

处理器上还可以加 `if` 字段，用权限规则的语法进一步筛选，比如 `"if": "Bash(git *)"` 只在 git 命令上触发。

### 输入和输出

hook 命令从 **stdin 收到一段 JSON**，里面有 `session_id`、`cwd`、`hook_event_name` 等公共字段；工具类事件还有 `tool_name` 和 `tool_input`。比如一次 Edit 调用，`tool_input` 里有 `file_path`、`old_string`、`new_string`；Write 则是 `file_path` 和 `content`。

hook 用**退出码**告诉 Claude Code 结果：

| 退出码 | 含义 |
|---|---|
| `0` | 成功，没有意见；stdout 如果是 JSON 会被解析 |
| `2` | 阻断。stderr 的内容作为原因反馈给 Claude（对能阻断的事件而言） |
| 其他 | 非阻断错误，动作照常进行，界面上显示一条 hook 错误提示 |

`2` 的效果因事件而异：在 `PreToolUse` 上是拦下这次调用；在 `PostToolUse` 上工具已经执行完了，拦不住，但 stderr 会被拿给 Claude 看；在 `Stop` 上是不让它停。

需要更精细的控制时，退出 0 并在 stdout 输出 JSON。例如 `PreToolUse` 可以返回：

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "ios/ 由 expo prebuild 生成，改 app.json 或 config plugin"
  }
}
```

`permissionDecision` 可以是 `allow`、`deny`、`ask`、`defer`。

另外，`$CLAUDE_PROJECT_DIR` 环境变量指向会话启动时的项目根，引用脚本时用它，别用相对路径。

## 实战一：保护生成目录和机密文件

hatch-shelf 的 CLAUDE.md 写着「`ios/` `android/` 由 `expo prebuild` 生成，不入库、不手改」。这条规矩改坏了的后果是：手改的原生配置在下次 prebuild 时被静默覆盖。值得升级成 hook。

`.claude/hooks/protect-files.sh`：

```bash
#!/usr/bin/env bash
# 拦截对生成目录和机密文件的编辑。退出码 2 = 阻断，stderr 会反馈给 Claude。
set -euo pipefail

file=$(jq -r '.tool_input.file_path // empty')
[ -z "$file" ] && exit 0

case "$file" in
  */app/ios/*|*/app/android/*)
    echo "已拦截：$file 由 expo prebuild 生成，手改会在下次 prebuild 时被覆盖。原生配置写在 app.json 或 config plugin 里。" >&2
    exit 2 ;;
  */.env|*/.env.*)
    echo "已拦截：$file 是环境变量文件，不要编辑。需要新增变量时告诉用户手动添加。" >&2
    exit 2 ;;
esac
exit 0
```

```bash
chmod +x .claude/hooks/protect-files.sh
```

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/protect-files.sh" }
        ]
      }
    ]
  }
}
```

注意 stderr 的文案：**不只说「不行」，还说「该去哪儿改」**。Claude 收到这段话后会调整方案，而不是换个姿势再试一次。

`.env` 这一项其实用权限规则更直接：在 `permissions.deny` 里加 `Read(./.env)`、`Edit(./.env)`，连读都不让读。hook 的优势是能写复杂逻辑和定制提示语；能用权限规则表达的，优先用权限规则。

## 实战二：编辑后自动格式化

hatch-counter 的规矩是「排版归 Prettier，对错归 ESLint」。每次编辑后自动格式化，agent 就不用操心空格和换行，diff 也干净：

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path' | xargs pnpm exec prettier --write --ignore-unknown"
          }
        ]
      }
    ]
  }
}
```

`--ignore-unknown` 让 prettier 碰到不认识的文件类型时安静跳过，而不是报错。

## 实战三：把 lint 结果喂回去

hatch-shelf 开了 ESLint 的 `no-floating-promises`，CLAUDE.md 里写着「不要用 `// eslint-disable` 绕过」。可以用 `PostToolUse` 在每次改完 App 代码后立刻跑一次 lint，有错就用退出码 2 把报错交给 Claude：

```bash
#!/usr/bin/env bash
# .claude/hooks/lint-app.sh：改了 app/src 下的 TS 文件后立刻跑 ESLint
file=$(jq -r '.tool_input.file_path // empty')
case "$file" in
  */app/src/*.ts|*/app/src/*.tsx) ;;
  *) exit 0 ;;
esac

cd "$CLAUDE_PROJECT_DIR/app"
if ! out=$(pnpm exec eslint "$file" 2>&1); then
  echo "ESLint 未通过，请修复（不要用 eslint-disable 绕过）：" >&2
  echo "$out" >&2
  exit 2
fi
exit 0
```

这比等到收工时一次性跑 `pnpm lint` 好得多：问题在刚引入时就被发现，上下文里还有刚改的代码，修起来最便宜。

同样的思路还可以拦「绕过」本身：在 `PreToolUse` 里检查 Edit 的 `new_string` 或 Write 的 `content` 是否包含 `eslint-disable`，有就阻断。这种「它想偷懒时直接拦住」的 hook，对守住 lint 零告警很有效。

## 实战四：收工前强制检查

CLAUDE.md 里写了「声明完成前必须通过 typecheck 和 test」，但 agent 偶尔还是会在没跑的情况下收工。`Stop` hook 可以把这句话变成硬约束：

```bash
#!/usr/bin/env bash
# .claude/hooks/check-before-stop.sh
input=$(cat)

# 已经因为本 hook 继续过一轮了，就放它停下，避免死循环
if [ "$(echo "$input" | jq -r '.stop_hook_active')" = "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
# 工作区没有改动（纯问答），不用检查
if git diff --quiet && git diff --cached --quiet; then
  exit 0
fi

if ! out=$(pnpm -s typecheck 2>&1); then
  echo "类型检查未通过，修好再结束：" >&2
  echo "$out" | tail -n 40 >&2
  exit 2
fi
exit 0
```

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/check-before-stop.sh", "timeout": 300 }
        ]
      }
    ]
  }
}
```

三个细节：

- **`stop_hook_active` 检查不能省**。Stop hook 阻断后 Claude 会继续工作，再想停时 hook 又被触发；不检查这个字段就可能来回拉锯。Claude Code 自己也有上限，连续阻断若干次后会强制放行
- **只截最后几十行**。类型检查的输出可能很长，全塞回去会浪费上下文
- **只放快的检查**。Stop hook 每轮结束都会跑，全量测试要几分钟的话，日常会很难受。类型检查放 Stop，全量测试留给提交前

## 实战五：通知与上下文注入

agent 停下来等你批准时，你可能已经切到别的窗口了。macOS 上加一个通知：

```json
{
  "hooks": {
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "osascript -e 'display notification \"Claude Code 在等你\" with title \"Claude Code\"'"
          }
        ]
      }
    ]
  }
}
```

这条放在用户级 `~/.claude/settings.json` 里，所有项目都生效。

另一个实用的是在上下文压缩之后重新注入关键信息。`SessionStart` hook 的 stdout 会被加进上下文，matcher 可以是 `startup`、`resume`、`clear`、`compact`：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "compact",
        "hooks": [
          { "type": "command", "command": "echo '提醒：完成前必须通过 pnpm typecheck、pnpm test、pnpm lint。最近提交：'; git log --oneline -5" }
        ]
      }
    ]
  }
}
```

## hook 的安全

hook 是以你的身份、你的权限执行的任意命令。这带来两个提醒：

- **项目里的 `.claude/settings.json` 可能带着 hook**。clone 一个别人的仓库，打开前先看看它配了什么。尤其是非交互模式 `claude -p` 不会弹信任对话框，项目里的 hook 会直接执行
- **hook 脚本自己要稳**。处理文件路径时加引号，用 `jq` 解析输入而不是 `grep`，别在 hook 里拼接未经检查的字符串去执行

调试 hook 时，`Ctrl+O` 打开转录视图可以看到每个 hook 的结果；需要完整日志就用 `claude --debug-file <路径>` 启动。

## 本章要点

- hooks 在固定生命周期自动执行，不经模型判断；必须每次都发生、又不需要判断的事，写成 hook
- 配置是「事件 → matcher → 处理器」三层，写在各级 settings 文件里，多层合并执行
- hook 从 stdin 读 JSON（`tool_name`、`tool_input` 等），退出码 0 放行、2 阻断并把 stderr 反馈给 Claude
- 常用组合：`PreToolUse` 保护文件、`PostToolUse` 格式化和跑 lint、`Stop` 收工前类型检查、`Notification` 提醒你
- 拦截时告诉它「该去哪儿改」；Stop hook 要检查 `stop_hook_active`，只放快的检查
- 能用权限规则表达的优先用权限规则；clone 来的项目先看它的 hooks 再运行
