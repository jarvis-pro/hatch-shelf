# 定时任务

前面几章的自动化都要你坐在电脑前敲一条命令。再往前一步，是让 agent 在你睡觉、出门的时候自己跑：每天早上把依赖更新和安全公告整理好，每晚检查一遍线上服务，每周日把知识库的 inbox 归档。这一章讲定时任务的选型、一个可靠的包装脚本应该做哪些事，以及无人值守时最容易出问题的几个地方：环境变量、权限、休眠和通知。

## 无人值守意味着什么

定时任务和手动运行最大的区别是：**出了问题，没人当场看到**。所以第 1 章的那张象限图在这里更严格：

- 只把**左上象限**的活做成定时任务：结果能自动检查，做错了代价低
- 任务的默认动作是**只读或只写自己的输出目录**，不改代码仓库、不碰线上
- 结果分两档：正常时安静地写进日志或知识库，**异常时才通知你**

如果一件事需要你每次都看结果才能放心，那它还不适合定时跑，先停留在「起草 + 审阅」。

## 选哪个调度器

| 调度器 | 跑在哪 | 错过的时间点 | 适合 |
|---|---|---|---|
| cron | macOS / Linux | 机器关机或休眠时错过的不补跑 | 常开的 Linux 服务器上的简单任务 |
| launchd | macOS | 休眠中错过的，唤醒后补跑一次 | 跑在自己 Mac 上、需要访问本地文件的任务 |
| systemd timer | Linux | 设了 `Persistent=true` 时，开机后补跑 | 服务器上的任务，日志进 journald |
| CI 定时（如 GitHub Actions 的 schedule） | 云端 | 调度可能有延迟 | 只依赖仓库内容的检查 |
| agent 产品自带的云端定时 | 云端 | 以产品文档为准 | 不想自己维护机器，任务不需要本地文件 |

对个人来说，最常用的是两种：**本地 Mac 用 launchd**（能访问你的仓库、知识库和登录状态），**服务器上用 systemd timer**（第 6 章的运维巡检）。

## 包装脚本：定时任务的核心

不要让调度器直接调 `claude`。中间加一层包装脚本，负责 agent 本身不管的那些事：

| 职责 | 为什么 |
|---|---|
| 设置 PATH 和工作目录 | 调度器启动的进程环境很干净，找不到 `node`、`pnpm`、`claude` |
| 加锁 | 上一次还没跑完，下一次不能再起一个 |
| 超时 | agent 卡住时要能被杀掉，而不是一直占着 |
| 落日志 | 事后要能看到每次跑了什么 |
| 检查结果、决定是否通知 | 安静成功，大声失败 |

一个可以直接改着用的模板：

```bash
#!/usr/bin/env bash
# ~/bin/agent-job.sh <任务名> <prompt 文件>
# 由 launchd / systemd 调用；正常时只写日志，失败或有发现时发通知
set -uo pipefail

JOB="$1"
PROMPT_FILE="$2"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin"

LOG_DIR="$HOME/notes/journal/agent-jobs"
LOCK="/tmp/agent-job-$JOB.lock"
STAMP=$(date +%Y-%m-%d-%H%M)
OUT="$LOG_DIR/$JOB-$STAMP.md"
mkdir -p "$LOG_DIR"

notify() {
  # macOS 本地通知；服务器上换成自己的通知渠道，地址放在环境变量里
  osascript -e "display notification \"$1\" with title \"agent: $JOB\"" 2>/dev/null || true
}

# mkdir 是原子操作，macOS 自带，适合做简单的锁
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "$STAMP 上一次还在运行，跳过" >> "$LOG_DIR/$JOB.skipped.log"
  exit 0
fi
trap 'rmdir "$LOCK"' EXIT

# macOS 默认没有 timeout 命令，用 perl 的 alarm 实现，30 分钟后杀掉
perl -e 'alarm shift; exec @ARGV' 1800 \
  claude -p "$(cat "$PROMPT_FILE")" --max-turns 30 > "$OUT" 2>&1
CODE=$?

if [ $CODE -ne 0 ]; then
  notify "失败（退出码 $CODE），见 $OUT"
elif grep -q '^需要处理' "$OUT"; then
  notify "有需要处理的事项，见 $OUT"
fi
```

最后的判断依赖一个约定：**prompt 要求 agent 在发现问题时以固定的一行开头**（这里是「需要处理」）。这样包装脚本用一个 `grep` 就能决定要不要打扰你，不需要再调一次模型。

### prompt 文件

每个任务的 prompt 放在单独的文件里，和脚本一起放进 Git，改了能追溯：

```text
检查 ~/Documents/works/hatch 下各仓库的依赖状况。只读，不修改任何文件、不安装任何东西。

对每个仓库：
1. 在仓库根目录运行 pnpm outdated 和 pnpm audit --prod
2. 只关注：有已知漏洞的依赖、主版本落后的直接依赖

输出格式：
- 没有需要关注的问题：第一行写「一切正常」，然后每个仓库一行简述
- 有问题：第一行写「需要处理：N 项」，然后按严重程度列出，每项写仓库、包名、当前版本、建议版本、理由

不要编造版本号，只用命令输出里出现的。
```

## macOS：launchd

把任务写成一个 plist，放进 `~/Library/LaunchAgents/`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>me.local.agent.deps-check</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/you/bin/agent-job.sh</string>
    <string>deps-check</string>
    <string>/Users/you/bin/prompts/deps-check.txt</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>7</integer>
    <key>Minute</key>
    <integer>30</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/Users/you/Library/Logs/agent-deps-check.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/you/Library/Logs/agent-deps-check.log</string>
</dict>
</plist>
```

加载、立即试跑、卸载：

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/me.local.agent.deps-check.plist
launchctl kickstart -k gui/$(id -u)/me.local.agent.deps-check   # 立刻跑一次，验证配置
launchctl bootout gui/$(id -u)/me.local.agent.deps-check        # 停用
```

几个要点：

- plist 里的路径必须写**绝对路径**，`~` 不会被展开
- **新任务一定先 `kickstart` 手动跑一次**，看日志确认环境没问题，再等它定时触发
- `StartCalendarInterval` 在 Mac 休眠时错过的触发，会在唤醒后补跑；错过多次也只补一次。合盖带走的笔记本，早上 7:30 的任务可能 9 点开盖才跑，任务本身要能接受这种延迟

## Linux：systemd timer

服务器上用一对 service + timer。用户级的单元放在 `~/.config/systemd/user/`：

```ini
# ~/.config/systemd/user/agent-health.service
[Unit]
Description=Agent 每晚健康巡检

[Service]
Type=oneshot
WorkingDirectory=%h/ops
# 认证等环境变量放在单独文件里，权限 600，不进 Git
EnvironmentFile=%h/.config/agent/env
ExecStart=/bin/bash %h/bin/agent-job.sh health %h/bin/prompts/health.txt
TimeoutStartSec=30min
```

```ini
# ~/.config/systemd/user/agent-health.timer
[Unit]
Description=每晚 23:30 运行健康巡检

[Timer]
OnCalendar=*-*-* 23:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now agent-health.timer
systemctl --user list-timers               # 看下次触发时间
systemctl --user start agent-health.service # 立刻跑一次
journalctl --user -u agent-health.service -n 50
loginctl enable-linger "$USER"              # 用户未登录时也让用户级 timer 运行
```

`Persistent=true` 让关机期间错过的触发在开机后补跑；`TimeoutStartSec` 是 systemd 层面的超时，和包装脚本里的超时互为保险。服务器上的 `osascript` 当然用不了，把 `notify` 换成你的通知渠道，比如往群机器人发一条消息，webhook 地址同样放在 `EnvironmentFile` 里。

## 无人值守的权限

交互时 agent 每做一件有风险的事都会问你；定时任务里没人回答，有两种结果：卡住等待直到超时，或者因为权限被放得太开而直接执行。两者都不好。正确做法是**预先声明这项任务需要的最小权限**：

- 用 `--allowedTools` 或项目里的权限配置，**只放开这项任务要用的命令**，比如依赖检查只需要 `pnpm outdated`、`pnpm audit` 和读文件
- 写文件只允许写到输出目录
- 不要在宿主机上用跳过全部权限确认的选项。真需要放开，放进容器或虚拟机里跑，见[《Agent 安全》](../agent-safety/)

认证也要提前确认：定时任务启动时你不在场，交互式登录流程走不通。具体用哪种认证方式、凭据放在哪里，以官方文档为准；原则是凭据放在权限为 600 的文件或系统钥匙串里，**不写进 prompt、脚本和 Git**。

## 一份起步清单

| 任务 | 频率 | 读什么 | 写什么 | 什么时候通知 |
|---|---|---|---|---|
| 依赖与漏洞检查 | 每天 | 各仓库的 `pnpm outdated` / `pnpm audit` | journal | 有漏洞或主版本落后 |
| 知识库归档 | 每周 | `~/notes/inbox/` | topics、index.md | 有拿不准归属的条目 |
| 周报 | 每周五 | 各仓库 git log | weekly | 不通知，直接看 |
| 线上巡检 | 每晚 | 健康检查接口、最近日志（只读） | journal | 有错误或指标异常 |
| 证书与域名到期 | 每周 | 证书有效期 | journal | 30 天内到期 |

每一项都满足：只读输入、只写自己的输出、结果能用一行判断要不要通知。

## 本章要点

- 定时任务只做左上象限的活：只读或只写输出目录，异常时才通知
- 本地 Mac 用 **launchd**，服务器用 **systemd timer**；注意 cron 不补跑错过的时间点
- 调度器和 agent 之间加一层**包装脚本**：PATH、锁、超时、日志、按约定的首行决定是否通知
- 新任务先手动触发一次验证环境；plist 里写绝对路径
- 无人值守时预先声明最小权限，凭据放在 600 文件或钥匙串里，不进 prompt 和 Git
