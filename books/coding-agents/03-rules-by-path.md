# rules 与按路径加载

上一章说 CLAUDE.md 每一轮都在上下文里，所以要短。可是项目一大，「不说就会做错」的规矩会越积越多：服务端有服务端的坑，移动端有移动端的坑，发版有发版的流程。全塞进 CLAUDE.md，它会膨胀到几百行，每一轮都在为用不上的规矩付上下文，注意力也被稀释。这一章讲 Claude Code 的 `.claude/rules/`：把规矩按主题拆成多个文件，并且**只在 agent 碰到相关文件时才加载**。

## 基本用法

在项目的 `.claude/rules/` 目录下放 Markdown 文件，一个主题一个文件。目录会被递归扫描，可以再分子目录：

```bash
mkdir -p .claude/rules
touch .claude/rules/server.md .claude/rules/mobile.md .claude/rules/build.md
```

没有任何 frontmatter 的 rule 和 CLAUDE.md 一样，启动时就加载。真正有用的是加上 `paths`：

```markdown
---
paths:
  - "apps/api/**"
---

# 服务端

动到 `apps/api` 时加载。这几条改坏了多半一个错都不报。

- 服务端不能用 tsx 跑（esbuild 不出 emitDecoratorMetadata，依赖注入当场报错）
- ……
```

带 `paths` 的 rule 只在 agent 用 Read、Write、Edit 工具操作匹配的文件时才进入上下文。frontmatter 里 `paths` 是唯一被读取的字段，加载时 frontmatter 本身会被去掉。

### paths 的写法

`paths` 是一组 glob，相对于包含 `.claude` 目录的那个目录（通常就是仓库根）：

| 写法 | 匹配 |
|---|---|
| `"apps/api/**"` | `apps/api` 下所有文件 |
| `"**/*.ts"` | 任意目录下的 TS 文件 |
| `"src/**/*.{ts,tsx}"` | 花括号展开，同时匹配 ts 和 tsx |
| `"**/package.json"` | 任意层级的 package.json |
| `"*.md"` | 仅仓库根目录的 md 文件 |

glob 建议用引号括起来：YAML 里以 `*` 开头的裸值会被当成别名语法解析出错。

## 真实案例：hatch-counter 的六份 rules

hatch-counter 是三个项目里最大的：网页端、服务端、管理后台、移动端、官网、文档站六个 app，外加共享包和一堆发版工具。它的 CLAUDE.md 只有五十来行，把大量细则拆进了六份 rules：

| 文件 | paths | 管什么 |
|---|---|---|
| `server.md` | `apps/api/**` | 多租户 RLS、迁移只能往前、幂等层的顺序 |
| `business.md` | 服务端 `business/`、`packages/core/**`、两个前端的 `src/**` | 业务口径只写一处、金额存分、单位换算 |
| `web-ui.md` | 网页端和后台的 `src/**` | 页名四个字、弹窗骨架、快捷键按平台 |
| `mobile.md` | `apps/mobile/**` | 手机上只做现场的几件事、读法从 core 取 |
| `build.md` | `**/package.json`、`.npmrc`、Vite / TS / ESLint 配置 | 依赖布局别动、脚本名别撞 pnpm 内置命令 |
| `tools-and-release.md` | `tools/**`、`.github/**`、`deploy/**` | 发版流水线、部署、群通知 |

几个值得学的设计：

**一个文件可以挂多条路径。** `business.md` 同时挂在服务端、core 和两个前端上，因为「业务口径」横跨这几处——改哪一端都得知道「同一个数两块屏幕上必须一样」。按**关注点**而不是按目录切 rules。

**开头一句话说明何时加载、细节在哪。** 每份 rule 的第一段都是这个格式：

```markdown
动到 `apps/api` 时加载。这几条改坏了多半一个错都不报；细节在 `docs/现行/服务端约束.md`。
```

这既是写给人看的说明，也告诉 agent：这里只是要点，展开去读那份文档。

**只放「改坏了不报错的」。** `web-ui.md` 开头写着「这里只留改坏了多半不报错的」。编译器、lint、测试能拦的不用写，agent 自己会撞上；rules 的版面留给那些会静默出错的坑。例如 `build.md` 里这条：

```markdown
- **脚本名别撞 pnpm 的内置命令（`publish` / `pack` / `deploy` …），也别撞 npm 的 pre/post 钩子**：
  撞了是退出码 0 的静默空跑——移动端 0.1.0 那次 `record` 还叫 `publish`，
  四个 job 全绿、群里播了「发布成功」，而 tag、changelog、版本号一个都没有。
```

这是踩过的真坑，带着现场。下一个 agent 想给脚本起名叫 `deploy` 时，这段话就在它眼前。

## 加载时机的盲区

按路径加载有一个容易被忽略的前提：**它靠工具调用触发**。

- agent 用 Read / Edit / Write 碰到匹配文件 → 加载
- 新版 Claude Code 里，用 `cat`、`head` 查看**单个**文件也算读取，同样会触发
- 但 `grep -r`、`rg`、`find`、跑脚本这类操作不算读某个具体文件，**不会触发**
- 有些任务根本不碰任何文件，比如「发个版」——它只是跑一条命令

hatch-counter 的 CLAUDE.md 专门为这个盲区写了两句：

```markdown
**看代码、改代码用 Read / Edit / Write 工具**：那几份只在这几样工具碰到匹配的文件时才加载，
拿 shell 命令看文件不会触发。**发版、部署之前先把 `tools-and-release.md` 读一遍**，
跑 `pnpm release` 碰不到任何文件。
```

这是很好的模式：**在常驻的 CLAUDE.md 里，为按需加载的规矩留一个手动触发的入口**。凡是「不碰文件就要做的事」（发版、部署、数据库操作、跑某个危险脚本），都在 CLAUDE.md 里写一句「做 X 之前先读 Y」。

## rules、子目录 CLAUDE.md、Skills 怎么选

Claude Code 里能「按需加载说明」的不止 rules 一种。放在一起比较：

| | 带 paths 的 rules | 子目录 CLAUDE.md | Skills |
|---|---|---|---|
| 放哪儿 | `.claude/rules/*.md` | 任意子目录 | `.claude/skills/<名>/SKILL.md` |
| 何时加载 | 碰到匹配 glob 的文件 | 碰到那个子目录里的文件 | 你输入 `/名字`，或模型判断任务相关 |
| 启动成本 | 零 | 零 | 每个 Skill 的一行描述 |
| 匹配粒度 | 任意 glob，可跨目录 | 只能是一个目录 | 按任务语义 |
| 适合 | 横跨多处的关注点、某类文件的约定 | 子项目自带的说明（比如 `books/`） | 流程、操作手册、参考资料 |

![几种机制按何时生效和约束力分布：权限 deny 和 hooks、测试是强制的；CLAUDE.md、常驻 rules 一直在上下文里但只是建议；paths rules 和 Skills 用到才加载，也只是建议](assets/mechanism-map.svg)

选法可以简化成三个问题：

1. **它和「改哪些文件」相关吗？** 相关 → rules（跨目录或按文件类型）或子目录 CLAUDE.md（就是这个目录）
2. **它是一段要执行的流程吗？** 是 → Skill，比如 `/release` 发版清单。还可以在 Skill 的 frontmatter 里设 `disable-model-invocation: true`，让它只在你手动输入时触发——有副作用的流程都该这么设
3. **它绝对不能错吗？** 是 → 无论放哪儿，再加一道 hook 或测试（第 4、7 章）

hatch-shelf 的 `books/AGENTS.md` 是子目录说明的典型：写书的规矩只和 `books/` 有关，放在那个目录里最自然，人类读者也能直接看到。hatch-counter 的发版流程放在了 rules 里加一句手动入口；如果它的发版需要更多交互步骤，改写成一个 `/release` Skill 也是合理的选择。

## 用户级 rules

`~/.claude/rules/` 下的 rule 对你机器上所有项目生效，适合放和项目无关的个人习惯：

```markdown
---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript 习惯

- 不用 enum，用字面量联合类型加 `as const` 对象
- 不写 `any`；确实不知道类型时用 `unknown` 再收窄
- 不用默认导出
```

用户级 rules 先于项目 rules 加载，两者不会互相覆盖，冲突时模型可能随便听一边。所以个人习惯要和项目规矩保持一致，项目里有特殊约定时，在项目 rule 里明确写「本项目例外：……」。

用户级 rule 的 `paths` 相对于会话的主工作目录解析。

## 写 rules 的几条经验

- **一份 rule 一个关注点，文件名就是主题**：`server.md`、`build.md`，而不是 `rules1.md`
- **控制单份长度**。rule 加载后同样占上下文，hatch-counter 的 `tools-and-release.md` 已经相当长，长到这个程度时可以考虑再拆，或把流程细节挪回 `docs/` 只留要点
- **规矩旁边写上为什么和症状**，和 CLAUDE.md 一样
- **在 CLAUDE.md 里列一份 rules 清单**。hatch-counter 的 CLAUDE.md 用一句话列出了六份 rules 各管什么，人和 agent 都能一眼看到全貌
- **改了目录结构记得改 paths**。目录挪了而 glob 没跟上，rule 就永远不会加载，而且不会有任何报错

最后一条值得多说一句：rules 失效是静默的。可以偶尔在会话里用 `/context` 看看当前加载了哪些说明文件（Memory files 一栏），确认你以为生效的 rule 确实在里面。

## 本章要点

- `.claude/rules/*.md` 把规矩按主题拆开；不带 `paths` 的启动即加载，带 `paths` 的只在碰到匹配文件时加载
- `paths` 是相对仓库根的 glob 列表，支持 `**` 和花括号展开；按关注点切 rules，一份可以挂多条路径
- 按路径加载靠文件工具触发，`grep`、跑脚本、发版这类操作不会触发；在 CLAUDE.md 里为它们留「做 X 之前先读 Y」的入口
- 和文件相关的用 rules 或子目录 CLAUDE.md，流程类用 Skill，绝不能错的另加 hook 或测试
- `~/.claude/rules/` 放个人跨项目习惯；rules 失效是静默的，目录变动后记得同步 paths
