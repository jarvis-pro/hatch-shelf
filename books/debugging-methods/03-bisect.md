# 二分定位

上一章说，假设空间太大、一个个猜猜不完的时候，可以改用二分。二分的好处是**它不需要你猜对**：只要能判断「这一半有没有问题」，每一步就能排除一半的可能，128 种可能 7 步就能找到。

这一章先讲二分为什么有效、什么时候能用，然后分别讲它在代码、数据、配置和版本上的用法，重点是 `git bisect run` 这个能把整个过程交给机器跑的命令。

## 为什么二分这么快

假设一个问题是 $N$ 个候选原因之一，逐个检查平均要查 $N/2$ 次，最坏 $N$ 次。二分每次排除一半，最多需要：

$$
\lceil \log_2 N \rceil
$$

次。差别随 $N$ 增大而急剧拉开：

| 候选数 $N$ | 逐个检查（最坏） | 二分（最多） |
|---|---|---|
| 16 | 16 | 4 |
| 128 | 128 | 7 |
| 1000 | 1000 | 10 |
| 10000 | 10000 | 14 |

更重要的是，二分**不依赖经验**。逐个检查时你会按「最可疑」的顺序查，经验好就快，经验错就慢；二分只需要一个「好 / 坏」的判断，跟你对问题的理解无关。所以当你完全没有头绪时，二分往往是最快的路。

![在 16 个提交中用二分法定位引入问题的提交，四步之内收敛](assets/bisect-steps.svg)

## 二分的前提

二分能用，需要三个条件：

1. **有一个已知的好点和一个已知的坏点**：上个版本没问题、这个版本有；这份数据没问题、那份有
2. **好坏是单调的**：从好点到坏点之间，问题一旦出现就一直存在。如果中间问题出现又消失又出现，二分会给出错误答案
3. **有一个可靠的判断**：每一步能明确说出「好」还是「坏」。如果问题是偶发的，先按上一章的方法把复现变稳定，或者每一步循环跑多次再下结论

第 2 条最容易被忽视。比如一个问题是由「改动 A」和「改动 B」共同引起的，A 在第 30 个提交、B 在第 70 个，二分会停在第 70 个，告诉你是 B 的问题。这个答案不算错，但不完整：只看 B 的改动可能看不出问题，需要意识到它和更早的某个改动有关。

## 案例：开支合计多了一分钱

> [!NOTE]
> 以下为示例场景：项目背景取自 hatch-counter，故障、提交和输出都是为演示 `git bisect run` 编写的，不是真实发生过的排查。

hatch-counter 是门店管理的 SaaS，后端是 NestJS 和 Postgres。假设有一天店主反馈：月报导出的 Excel 里，开支合计比网页上显示的多了一分钱。

一分钱的问题很难靠读代码找到。开支合计涉及记账、周期开支摊销、工资结算、导出格式化好几个模块，最近两个月的提交有一百多个，每个都可能动过相关代码。

### 先确认好点和坏点

上个月的 `v1.4.0` 标签：用同一份测试数据导出，合计正确。当前 `main`：多一分。两点都确认过，可以二分。

### 写一个判断脚本

手动二分需要每一步都构建、起服务、导出、比对，七八轮下来也要一个小时。不如把判断写成脚本，交给 `git bisect run`：

```bash
#!/usr/bin/env bash
# /private/tmp/bisect/check-expense-total.sh
# 退出码约定：0 = 好，1-124 = 坏，125 = 这个提交无法判断（跳过）

set -u
# 测试文件是临时写的，旧提交里没有，每一步都从仓库外复制进来
cp /private/tmp/bisect/bisect-expense-total.e2e.test.ts apps/server/tests/
pnpm install --frozen-lockfile > /dev/null 2>&1 || exit 125
pnpm --filter server build > /dev/null 2>&1 || exit 125

pnpm --filter server vitest run tests/bisect-expense-total.e2e.test.ts > /dev/null 2>&1
result=$?
rm apps/server/tests/bisect-expense-total.e2e.test.ts
exit $result
```

被调用的测试是临时写的，只做一件事：用固定的测试数据生成月报，比较导出的合计与按明细逐笔相加的结果：

```typescript
import { expect, it } from "vitest";
import { seedStore, exportMonthlyReport, listExpenses } from "./helpers";

it("月报开支合计等于明细之和", async () => {
  const store = await seedStore("fixtures/expense-rounding.json");
  const report = await exportMonthlyReport(store.id, "2026-09");
  const items = await listExpenses(store.id, "2026-09");

  const expectedCents = items.reduce((sum, e) => sum + e.amountCents, 0);
  expect(report.expenseTotalCents).toBe(expectedCents);
});
```

注意两点：

- **脚本和测试放在仓库外**，每一步复制进工作区、跑完删掉。二分过程中 git 会把工作区切到旧提交，留在工作区里的未跟踪文件还可能挡住 checkout
- **构建失败时退出 125**，告诉 git「这个提交跳过」，而不是判成坏。中间总有几个提交因为别的原因编译不过，判成坏会把二分引向错误的方向

### 交给 git 跑

```bash
git bisect start main v1.4.0
git bisect run /private/tmp/bisect/check-expense-total.sh
```

跑完之后输出：

```text
running '/private/tmp/bisect/check-expense-total.sh'
Bisecting: 31 revisions left to test after this (roughly 5 steps)
[<提交哈希>] <提交标题>
...
<提交哈希> is the first bad commit
    refactor: 周期开支摊销抽成纯函数，月报和页面共用
```

一百多个提交大约 7 轮，每轮要装依赖、构建、跑测试，整个过程不需要人盯着。

### 看那个提交

```bash
git show <坏提交> -- apps/server/src/expenses/
git bisect reset
```

`git bisect reset` 把工作区切回二分前的分支，别忘了。

这个重构把摊销计算抽成了一个纯函数。原来的代码在每一笔摊销上都用整数分计算，按天摊的时候余数统一加到最后一天；重构后的函数为了「更通用」改成先用元做浮点除法，再在月报里四舍五入每一笔：

```typescript
// 重构后：每笔各自四舍五入，30 笔的舍入误差累加起来
const daily = amount / days;
return range.map((d) => ({ date: d, amount: Math.round(daily * 100) / 100 }));
```

网页上显示合计时是先加总再四舍五入，月报是先四舍五入每笔再加总，于是差了一分。根因是重构改变了舍入的位置，而原来的测试只覆盖了能整除的金额。

### 修复

回到整数分计算，余数归到最后一天，把那个临时测试改成正式测试并加上不能整除的用例。金额一律以「分」为单位的整数存储和计算，这条规则写进项目约定。

## 代码之内的二分

不需要 git 也能二分：问题出在一段代码里，但不知道是哪一行时，可以注释掉一半看问题还在不在。

hatch-shelf 的阅读器在某些章节上初始化很慢。阅读器的渲染流程是一串插件：markdown-it 解析、highlight.js 高亮、KaTeX 公式、Mermaid 图表、目录提取、图片路径改写。不知道慢在哪一步时，把插件列表关掉一半：

```typescript
const plugins = [
  headingAnchors,
  imagePaths,
  // highlight,
  // katex,
  // mermaid,
  // admonitions,
];
```

慢消失了，问题在被注释的那一半；再打开其中两个，依此类推。四次就能定位到具体插件。这比给每个插件计时要粗糙，但不需要任何工具，几分钟就有结论。找到插件后再用第 6 章的火焰图看插件内部哪里慢。

## 数据的二分

问题只在某份数据上出现时，对数据二分。

`shelf-pack check books/` 校验全部上百本书，假如某天它直接崩溃，报一个与具体书无关的栈。逐本跑太慢，可以对书单二分：

```bash
ls books | head -50 > /private/tmp/bisect/half.txt
mkdir -p /private/tmp/bisect/books
xargs -I{} cp -R books/{} /private/tmp/bisect/books/ < /private/tmp/bisect/half.txt
pnpm shelf-pack check /private/tmp/bisect/books
```

还崩，就在这五十本里再切；不崩，问题在另外五十本。七轮之内找到那本书，然后对那本书的章节再二分，最后对那一章的内容二分，直到找到触发崩溃的那几行。

同样的方法适用于：

- 导入的 Excel 有一万行，某一行让解析器报错
- 一个 JSON 配置文件，某个字段让服务启动失败
- 一批用户里，某个用户的数据让报表计算异常

## 配置的二分

配置改了一堆之后出问题，也可以二分：把一半配置恢复成上一个能用的版本，看问题在哪一半。

hatch-counter 的 nginx 配置、Docker Compose 文件、Expo 的 `app.json`，都适合这样做。前提是配置在版本控制里，能随时取回旧版本对照，这也是为什么配置应该提交进仓库。

## 版本的二分

问题出在依赖升级之后，而一次升级动了几十个包，可以对依赖二分：

1. 先只升级一半的包，看问题在不在
2. 定位到某个包后，在它的版本号之间二分：`2.3.0` 好、`2.8.0` 坏，试 `2.5.0`
3. 定位到某个版本后，去读那个版本的 changelog，常常直接写着行为变化

hatch-shelf 升 Expo SDK 时不方便这样拆，因为 SDK 内的包版本是绑定的。这种情况下改为读 SDK 的升级说明和破坏性变更列表，对照项目里用到的 API 逐个检查。第 1 章 `File.write()` 变成异步就是这样查到的。

## 一个提交内部的二分

二分定位到的提交如果很大，还可以在它内部继续二分：把这个提交的改动拆成两半，只应用一半，看问题在不在。

```bash
# 在坏提交的父提交上新开一个分支
git switch -c bisect-inner <坏提交>~1

# 只挑一部分改动应用：按文件
git checkout <坏提交> -- apps/server/src/expenses/amortize.ts

# 或者交互地按代码块挑选
git checkout -p <坏提交> -- apps/server/src/expenses/
```

应用一半之后跑判断脚本，问题出现就说明在这一半里，否则在另一半。几轮之后能精确到某个文件的某一段改动。重构类的提交特别适合这样做，因为它们往往在很多文件里做了「看起来等价」的改动，而其中一处其实不等价。

## git bisect 的常用操作

除了 `run`，几个常用的操作：

```bash
# 手动模式：每一步自己判断
git bisect start
git bisect bad              # 当前提交是坏的
git bisect good v1.4.0      # 这个标签是好的
# git 切到中间某个提交，测试后告诉它结果
git bisect good             # 或 git bisect bad
git bisect skip             # 这个提交无法判断

# 查看和回放过程
git bisect log > /private/tmp/bisect/log.txt
git bisect replay /private/tmp/bisect/log.txt

# 只沿主线的合并提交二分，不进入功能分支内部
git bisect start --first-parent

# 结束，回到原来的分支
git bisect reset
```

`--first-parent` 在用合并提交工作的仓库里很有用：先定位到是哪个合并引入了问题，再决定要不要进入那个分支内部二分。

如果判断条件不是「有 bug / 没 bug」，比如是「变快了 / 没变快」，可以用 `git bisect start --term-old=fast --term-new=slow` 自定义两端的名字，避免把「好」「坏」弄反。

## 提交粒度决定二分的精度

二分能找到的最小单位是一个提交。如果那个提交改了二十个文件、三件事，二分只能告诉你「是这一坨」，剩下的还得自己看。

这是保持提交小而单一的一个实际理由：**每个提交只做一件事、每个提交都能编译通过**，未来二分时就能精确到一件事。hatch-shelf 要求代码和内容改动不混在一个提交里，也有这个好处。

## 本章要点

- 二分最多 $\lceil \log_2 N \rceil$ 步，而且不依赖经验；完全没头绪时它常常最快
- 前提：有已知的好点和坏点、好坏单调、每一步有可靠的判断
- `git bisect run` 把判断写成脚本交给机器：0 好，1–124 坏，125 跳过；脚本放在仓库外
- 代码、数据、配置、依赖版本都可以二分：每次恢复或去掉一半，看问题在哪一半
- 找到提交后读它的改动；跑完记得 `git bisect reset`
- 提交越小越单一，二分的结论越精确
