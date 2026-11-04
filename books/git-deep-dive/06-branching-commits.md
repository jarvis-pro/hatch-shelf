# 分支策略与提交规范

团队讨论分支策略，比的是 Git Flow、GitHub Flow、主干开发哪个更好；一个人开发时，这些模型大多显得过重。但一个人也有自己的「协作者」：三个月后忘了细节的自己、在 worktree 里并行干活的 coding agent、根据提交历史生成 changelog 的发版脚本、需要在历史里二分查找的 bisect。它们都依赖历史是有规律的。

这一章讲两件事：提交怎么写（Conventional Commits 和原子提交），分支怎么用（一个人的主干开发，以及什么时候需要例外）。

## 提交是写给谁看的

一个提交有三类读者：

| 读者 | 关心什么 | 需要提交提供什么 |
|---|---|---|
| 未来的自己 | 这段代码为什么是这样 | 消息里写清动机，不只是改了什么 |
| 工具 | 这次改动属于哪一类、影响哪个包、是否破坏兼容 | 机器可解析的格式 |
| bisect、revert、cherry-pick | 能不能单独拿出来 | 一个提交只做一件事、每个提交都能构建 |

Conventional Commits 解决第二类，原子提交解决第三类，第一类则靠你写消息时多写一句「为什么」。

## Conventional Commits

> [!WARNING]
> 本节按 Conventional Commits 1.0.0 规范整理，以 conventionalcommits.org 上的最新版本为准。

格式：

```text
<type>[(scope)][!]: <描述>

[正文：为什么改、怎么改的、有什么取舍]

[脚注：BREAKING CHANGE: ... / Refs: #12]
```

规范本身只规定了两个类型的含义：`feat` 对应语义化版本的 minor，`fix` 对应 patch；类型后面加 `!` 或者脚注里写 `BREAKING CHANGE:` 对应 major。其他类型（`docs`、`chore`、`refactor`、`perf`、`test`、`ci`、`build`）是社区惯例，项目可以自己增减。

### hatch-shelf 的用法

hatch-shelf 的 `CLAUDE.md` 里规定了两条：代码用 Conventional Commits，可以加 scope；书的内容用 `content:`，**不要把代码和内容改动混在一个提交里**。写作时的历史大致是这个样子：

![横向条形图：截至 v1.0.3 的 217 个提交中，content 106 个，feat 46 个，docs 33 个，fix 16 个，chore 8 个，refactor 和 perf 各 3 个，合并提交 2 个](assets/commit-types.svg)

```text
fix(app): Tab 栏标签字号从 10 调到 12，小屏上更易读
docs(design): 传书接收中画布与代码同步，统一已开启状态的文案
chore(release): v1.0.3
feat(spec): book.yaml 新增可选字段 next（读完后接着读的书），check 校验书存在
content: add wolf-way（狼道）
```

几个值得注意的做法：

- **自定义类型 `content`**。这个仓库一半的提交是写书，它们和代码的发版节奏完全无关。单独一个类型，生成 App 的 changelog 时可以整类排除，`git log --grep '^content'` 也能单独看内容的进度
- **scope 用包名或目录名**：`app`、`spec`、`reader`、`shelf-pack`、`design`。monorepo 里 scope 直接回答了「影响哪个包」，按包生成 changelog 时就靠它（见[《部署与 CI/CD》的按路径归属](../deploy-release/06-versioning-changelog.md#按路径归属)，那里讲的是更可靠的按路径判断）
- **描述写结果，不写过程**。「Tab 栏标签字号从 10 调到 12，小屏上更易读」同时说了改了什么和为什么；「调整样式」两样都没说
- **发版提交单独一个**。`chore(release): v1.0.3` 只改 `app.json` 的版本号，tag 打在它上面，`git log` 里一眼能看到版本节点

### 描述用中文还是英文

规范不管这个。一个人的项目，用你思考时用的语言写，读起来最快。hatch-shelf 类型和 scope 用英文（工具要解析），描述用中文。唯一要注意的是**同一个仓库保持一致**，混着写会让 `git log --oneline` 很难扫读。

### 正文写什么

一行描述放不下「为什么」时写正文。好的正文回答这几个问题之一：

- 不这样改会怎样（问题的现象）
- 为什么选这个方案，而不是那个更显然的方案
- 有什么已知的限制或后续要做的事

一个示意（正文里的原因是为了举例编写的）：

```text
fix(app): 传书换书时进度条从 0% 起步

之前进度条复用了上一本书的进度状态，换书时会先显示上一本的百分比再跳回 0。
改为在收到新书的第一个分片时重置；没有放在连接建立时重置，是因为同一连接里
可能连续传多本书。
```

可以设一个提交模板提醒自己：

```bash
git config --global commit.template ~/.gitmessage
```

```text
# <type>(<scope>): <结果，而不是过程>
#
# 为什么改？不改会怎样？为什么选这个方案？
```

模板里 `#` 开头的行在提交时会被去掉。

## 原子提交

**一个提交只做一件事，并且这件事是完整的。** 「一件事」的判断标准：能用一句话的描述说清楚，revert 它不会带走别的东西。「完整」的标准：这个提交单独检出，能构建、能通过测试。

实践中最大的障碍是：你改了一下午，工作区里混着三件事。这时用交互式暂存按块挑选：

```bash
git add -p                    # 逐块确认：y 暂存、n 跳过、s 拆得更细、e 手动编辑
git diff --staged             # 确认暂存区里只有这一件事
git commit -m 'refactor(app): 抽出书籍分组的计算'
git add -p                    # 下一件事
```

暂存了一半想确认这一半能不能单独通过检查，可以把没暂存的部分先收起来：

```bash
git stash push --keep-index --include-untracked
pnpm typecheck && pnpm test
git commit -m '...'
git stash pop
```

> [!TIP]
> 让 coding agent 提交时，最常见的问题是把一下午的改动打成一个提交。在 `CLAUDE.md` 里写明「按主题分组提交，代码和内容分开」，并要求它提交前先列出分组让你确认，效果比事后拆分好得多。

## 一个人的分支策略

### 默认：主干开发

一个人开发，默认就在 `main` 上提交，配合第 3 章的 `pull.rebase true`，历史是一条直线。这就是主干开发（trunk-based development）。没有 develop 分支、没有 release 分支、没有长期存在的 feature 分支。

理由很直接：分支的作用是**隔离**，隔离的对象是「还没准备好的改动」和「别人」。一个人的时候没有「别人」，而「还没准备好的改动」大多几个小时就能完成。为了几个小时的隔离去维护一套合并流程，不划算。

### 什么时候开分支

| 场景 | 做法 |
|---|---|
| 一个要做好几天、中途可能放弃的实验 | 开短期分支，做完变基后快进合入；放弃就删掉 |
| coding agent 并行干活 | 每个 agent 一个 worktree、一个分支（第 8 章），完成后变基、快进合入 |
| 已发版的移动端要紧急修复，而 main 上已经有了没准备好发的功能 | 从上一个发版 tag 拉一个修复分支 |
| 需要 PR 来触发 CI 或预览部署 | 开分支走 PR |

第三种情况在移动端尤其常见：App 审核要时间，main 已经往前走了，这时线上版本出了问题。

```bash
git switch -c hotfix/1.0.4 v1.0.3
# 修复、提交
git tag -a v1.0.4 -m 'v1.0.4'
git push origin hotfix/1.0.4 v1.0.4
# 把修复带回 main
git switch main
git cherry-pick <修复的提交>
```

修复先落在修复分支上，再 cherry-pick 回 main，顺序反过来也可以（先在 main 修，再 cherry-pick 到修复分支）。关键是**两边都要有**，否则下一个正常版本会把问题带回来。`git cherry-pick -x` 会在消息里附上「(cherry picked from commit ...)」，方便以后追溯。

### 远程上的 main 要保护

即使一个人，也值得在托管平台上给 `main` 加保护，防的是自己的手误和失控的脚本。

> [!WARNING]
> GitHub 的规则集（rulesets）和分支保护的可选项、免费账户能用到什么程度，按写作时的情况整理，平台功能变化较快，以 GitHub 官方文档为准。

最小的一组规则：

- 禁止强推（block force pushes）
- 禁止删除分支
- 可选：要求 CI 检查通过才能更新（这意味着所有改动都要走 PR，一个人时按需取舍）

推送到被保护的分支被拒绝时，你会收到明确的错误，而不是悄悄覆盖了历史。

### PR 的三种合并方式

在 GitHub 上合并 PR 有三个按钮，对应的历史形状不同：

| 方式 | 结果 | 适合 |
|---|---|---|
| Create a merge commit | 保留分支所有提交，外加一个合并提交 | 想保留「这是一个功能」的分组 |
| Squash and merge | 整个分支压成一个提交 | 分支里的提交很零碎、没有整理过 |
| Rebase and merge | 分支的提交逐个重放到 main 上，无合并提交 | 分支里每个提交都是整理好的原子提交 |

一个人自己的分支，提交都整理过，用 rebase and merge 最贴近主干开发。注意 squash 和 rebase 两种方式都会生成新的提交 ID，本地那个分支要删掉，不要再基于它继续工作（第 3 章 `--onto` 一节讲了基于它工作之后怎么救）。

## 白天上班，晚上做自己的项目

准备做一人公司的人，常见的情况是一台电脑上同时有公司的仓库和自己的仓库。两边的提交身份（姓名、邮箱、签名密钥）必须分开，否则自己项目的历史里会出现公司邮箱，或者反过来。

用条件包含，按目录切换身份：

```ini
# ~/.gitconfig
[user]
	name = jarvis
	email = jarvis@example.com

[includeIf "gitdir:~/work/"]
	path = ~/.gitconfig-work
```

```ini
# ~/.gitconfig-work
[user]
	name = 公司里用的名字
	email = jarvis@company.example
	signingkey = ~/.ssh/id_ed25519_work.pub
```

`gitdir:` 后面的路径以 `/` 结尾，表示这个目录下的所有仓库。检查当前仓库实际生效的身份：

```bash
git config --show-origin --get user.email
```

还可以要求每个仓库必须显式设置身份，忘了就提交失败，而不是悄悄用全局默认值：

```bash
git config --global user.useConfigOnly true
```

签名密钥同样按目录分开，第 9 章细讲。

## 把规范变成检查

写在文档里的规范会被遗忘，尤其是 agent 和深夜的自己。下一章讲 hooks，其中 `commit-msg` hook 就是用来检查提交消息格式的。如果用 commitlint，记得把自定义的类型加进去：

```javascript
// commitlint.config.mjs
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'chore', 'refactor', 'perf', 'test', 'ci', 'build', 'revert', 'content'],
    ],
    // 中文描述不需要大小写规则
    'subject-case': [0],
  },
};
```

规范有了机器检查，changelog 生成（见[《部署与 CI/CD》](../deploy-release/06-versioning-changelog.md#从提交历史自动生成-changelog)）才能放心地依赖它。

## 本章要点

- 提交的读者是未来的自己、工具和 bisect：消息写为什么，格式让机器能解析，粒度让每个提交能单独拿出来
- Conventional Commits 只规定了 `feat`、`fix` 和破坏性变更；类型可以按项目扩展，比如 hatch-shelf 的 `content`
- monorepo 的 scope 用包名；内容和代码分开提交；发版单独一个提交
- `git add -p` 拆出原子提交，`stash --keep-index` 验证暂存的那一半
- 一个人默认主干开发；短期实验、agent 并行、移动端紧急修复时才开分支
- 远程 main 禁止强推和删除；公司和个人项目用 `includeIf` 分开身份
