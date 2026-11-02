# 日常自动化

上一章讲了怎么判断一件事能不能交给 agent。这一章落到最常见的一类：每周、每天都要做一遍的小事，比如写周报、整理文件、批量改写一批文档。它们单次不费事，但加起来很占时间，而且打断注意力。本章讲三件事：什么时候用脚本、什么时候用 agent、什么时候让 agent 写脚本；怎么在命令行里非交互地调用 agent；以及怎么把反复敲的 prompt 沉淀成可复用的 skill。

## 脚本、agent，还是 agent 写脚本

自动化不等于「全交给大模型」。三种做法各有适用面：

| 做法 | 适合 | 优点 | 缺点 |
|---|---|---|---|
| 纯脚本 | 规则明确：按日期改名、合并 CSV、跑命令收集数据 | 快、免费、每次结果一样 | 碰到模糊输入就失败 |
| agent 直接做 | 需要理解内容：总结、分类、改写、识别票据 | 能处理模糊输入 | 慢、花钱、结果有波动 |
| agent 写脚本 | 规则明确但你懒得写 | 一次生成，之后按脚本的成本跑 | 需要审一遍脚本 |

一个实用的组合是：**确定性的部分交给脚本，需要理解的部分交给 agent，两者用文件衔接**。脚本负责收集数据、校验结果；agent 只做中间那一步「读懂并写出来」。这样大模型的波动被限制在一个小环节里，前后都有确定的检查。

```mermaid
flowchart LR
  A[脚本：收集原始数据] --> B[文件：raw.txt]
  B --> C[agent：理解、归纳、改写]
  C --> D[文件：draft.md]
  D --> E[脚本：格式和数量校验]
  E --> F[人：看一眼，发出去]
```

## 在命令行里调用 agent

交互式会话适合探索；要把 agent 串进脚本，需要非交互模式。Claude Code 用 `-p`（`--print`）：给一段 prompt，跑完把结果打到标准输出就退出。

```bash
# 最简单的形式
claude -p "用三句话总结 README.md"

# 从标准输入喂材料
git log --since="1 week ago" --oneline | claude -p "把这些提交按功能归类，写成中文周报"

# 要给程序解析时，输出 JSON（结果在 result 字段里）
claude -p "列出 docs/ 下过时的页面" --output-format json
```

几个跟自动化相关的参数（名称以你所用版本的 `claude --help` 为准）：

| 参数 | 作用 |
|---|---|
| `-p` / `--print` | 非交互模式，跑完退出 |
| `--output-format json` | 输出结构化结果，方便脚本解析 |
| `--allowedTools` | 预先允许的工具，非交互时不会弹确认 |
| `--max-turns` | 限制 agent loop 的轮数，防止跑飞 |
| `--append-system-prompt` | 在默认 system prompt 后追加说明 |

非交互模式下没人点「允许」，所以**权限要提前想好**。原则是只给这项任务需要的工具：写周报只需要读，就不要放开写文件和任意 Bash。

## 例子一：跨仓库周报

独立开发者常常同时维护几个仓库。周报的原料就是各仓库一周的提交记录，这部分完全确定，用脚本收集：

```bash
#!/usr/bin/env bash
# weekly.sh：收集多个仓库一周的提交，交给 agent 写周报
set -euo pipefail

REPOS=(
  "$HOME/Documents/works/hatch/hatch-shelf"
  "$HOME/Documents/works/hatch/hatch-counter"
  "$HOME/Documents/works/hatch/hatch-recordwall"
)
OUT_DIR="$HOME/notes/weekly"
WEEK=$(date +%G-W%V)
RAW="$OUT_DIR/$WEEK.raw.txt"
mkdir -p "$OUT_DIR"

: > "$RAW"
for repo in "${REPOS[@]}"; do
  echo "## $(basename "$repo")" >> "$RAW"
  git -C "$repo" log --since="7 days ago" --no-merges \
    --pretty=format:'- %ad %s' --date=short >> "$RAW" || true
  printf '\n\n' >> "$RAW"
done

claude -p --max-turns 3 "$(cat <<EOF
下面是我这周在几个仓库的提交记录。写一份中文周报：
- 每个仓库一节，按「新功能 / 修复 / 内容 / 杂项」归类，合并同一件事的多次提交
- 每条写改完之后是什么样，不写文件名
- 末尾一节「下周关注」，只根据提交里看得出的未完成事项写，看不出就写「无」
只输出 Markdown 正文。

$(cat "$RAW")
EOF
)" > "$OUT_DIR/$WEEK.md"

# 简单校验：每个仓库都应该有一节
for repo in "${REPOS[@]}"; do
  grep -q "$(basename "$repo")" "$OUT_DIR/$WEEK.md" || echo "警告：周报里缺少 $(basename "$repo")"
done
```

几个设计点：

- **原料存成文件**（`.raw.txt`）。周报写得不对时，先看原料对不对，问题出在哪一步一目了然
- **prompt 里写验收**：「看不出就写无」防止 agent 为了凑内容编造计划
- **只把文本喂进去**，agent 不需要任何工具，`--max-turns` 设得很小
- 提交信息写得好，周报才写得好。仓库约定「写改完之后是什么样，不写改了哪个文件」的提交风格，在这里直接受益

## 例子二：批量整理文件

下载目录里堆满了 `IMG_4721.PNG`、`截屏2026-10-03 下午3.12.08.png`、`invoice(3).pdf`。想按内容改名归档，规则很难写死，需要看图才知道是什么。

直接让 agent「整理下载目录」风险不小：它会边看边改，改错了很难回溯。更稳的做法是**两段式**：agent 只产出计划，脚本执行计划。

第一步，让 agent 写一份映射表，不动任何文件：

```text
查看 ~/Downloads/inbox/ 下的所有图片和 PDF，为每个文件建议一个新名字和目标目录。

规则：
- 新名字格式：YYYY-MM-DD-内容简述.扩展名，简述用中文，不超过 12 个字
- 目标目录只能是 receipts / screenshots / docs / unknown 之一
- 看不出内容的放 unknown，名字保持原样

只写一个文件 ~/Downloads/inbox/plan.csv，表头为 old,new,dir。
不要移动、重命名或删除任何文件。
```

第二步，你打开 `plan.csv` 扫一眼，改掉不满意的行。第三步，用一个确定的脚本执行：

```bash
#!/usr/bin/env bash
# apply-plan.sh：按 plan.csv 移动文件，默认只打印，加 --run 才真的执行
set -euo pipefail
cd ~/Downloads/inbox
RUN=${1:-}

tail -n +2 plan.csv | while IFS=, read -r old new dir; do
  [ -f "$old" ] || { echo "跳过，不存在：$old"; continue; }
  dest="../sorted/$dir/$new"
  if [ -e "$dest" ]; then echo "跳过，目标已存在：$dest"; continue; fi
  if [ "$RUN" = "--run" ]; then
    mkdir -p "../sorted/$dir" && mv -n "$old" "$dest"
  fi
  echo "$old -> $dest"
done
```

这个模式把「需要理解的判断」和「有副作用的动作」拆开了：判断可以错，你在中间有一次审阅机会；动作是确定的脚本，默认 dry-run，用 `mv -n` 不覆盖已有文件。上一章说的「往左上角挪」，这里就是一个具体例子。

## 把重复的 prompt 沉淀成 skill

用一阵子你会发现，有些 prompt 每隔一段时间就要敲一遍，而且每次都要补充同样的背景：报销标准是什么、周报格式是什么、某个客户的偏好是什么。这类东西应该写下来，变成 agent 随时能取用的说明书。

Claude Code 里有两种常见的沉淀方式：

| 方式 | 放在哪 | 怎么触发 | 适合 |
|---|---|---|---|
| 斜杠命令 | 项目或用户目录下的 commands 目录 | 你手动输入 `/命令名` | 固定流程，你清楚什么时候要用 |
| Skill | `.claude/skills/<名字>/SKILL.md`（项目级）或用户目录下同名路径 | agent 根据描述自己判断要不要加载，也可以手动调用 | 带领域知识的任务，平时只占一行描述 |

Skill 的好处是**渐进式加载**：平时只有名字和一句描述在上下文里，真正用到时才读全文。所以可以放心写得很细。一个 skill 的骨架：

```markdown
---
name: weekly-report
description: 根据多个仓库的提交记录生成中文周报。用户说「写周报」「这周干了什么」时使用。
---

# 周报

## 数据来源
运行 ~/bin/weekly.sh 收集原始提交；不要自己逐个仓库 git log。

## 格式
- 每个仓库一节，按「新功能 / 修复 / 内容 / 杂项」归类
- 每条写改完之后是什么样，不写文件名
- 末尾「下周关注」，看不出就写「无」

## 自查
- 每个仓库都有一节
- 没有出现原料里没有的事项
```

`description` 写得好不好，决定 agent 会不会在该用的时候想起它：写清「做什么」和「用户怎么说的时候用」。仓库所有者自己的环境里就有类似的个人 skill，比如按固定标准生成月度报销清单、把粘贴进来的原始数据整理成汇总表。它们的共同点是：**规则稳定、每次都要交代、交代错了结果就不对**。

### 什么时候该写成 skill

一个简单的规则：**同样的背景解释第二次的时候，就把它写下来**。写下来的成本是十分钟，之后每次省下的是重新组织语言的时间，以及漏说一条规则导致返工的风险。

## 常见的坑

| 坑 | 表现 | 对策 |
|---|---|---|
| 让 agent 边判断边动手 | 改错了一批文件，不知道改了哪些 | 两段式：先出计划文件，再由脚本执行 |
| 原料不落盘 | 结果不对，不知道是数据问题还是理解问题 | 每一步的输入输出都写成文件 |
| 权限给太大 | 写周报的任务顺手改了仓库 | 非交互模式只放开必要的工具 |
| 没写验收 | 输出看起来不错，其实漏了一个仓库 | prompt 里写自查，脚本里再校验一遍 |
| 什么都用 agent | 简单改名也跑一遍模型，又慢又贵 | 规则明确的部分让 agent 写成脚本，以后直接跑脚本 |

## 本章要点

- 确定性的部分用脚本，需要理解的部分用 agent，两者用文件衔接
- `claude -p` 让 agent 可以被脚本调用；非交互时权限要提前收紧，并用 `--max-turns` 防止跑飞
- 有副作用的批量操作用**两段式**：agent 产出计划文件，人审阅，确定的脚本执行，默认 dry-run
- 同样的背景解释到第二次，就沉淀成 skill 或斜杠命令；skill 的 `description` 决定它能不能被想起
