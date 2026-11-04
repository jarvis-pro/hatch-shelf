# 测评分器

上一章写了一组评分器，`pnpm eval receipt` 已经能跑出分数。在拿这些分数去决定「这个 prompt 改动要不要合并」之前，还有一件事：**确认评分器本身是对的**。评分器也是代码，也会有 bug。这一章用三种办法检查它：手工构造的单元测试、在整个测试集上跑的性质检查、和人对一遍。最后说评分器改了之后，旧的分数该怎么办。

## 评分器错了，比模型错了更糟

模型读错一格，会在分数上体现出来，你能看到、能去修。评分器错了，分数本身就是错的，而你会照着错的分数做决定：把一个变好的改动当成退步回滚掉，或者把一个变差的改动合进主干。更麻烦的是，这种错误**不会报错**，报告照常输出，数字看起来也很合理。

上一章的评分器里，几类容易出错的地方：

| 位置 | 可能的 bug | 后果 |
|---|---|---|
| 配对阈值 | `>=` 写成 `<=`，或阈值调得太高 | 名字差一个字的行配不上，漏读和多读各算一次，`line_recall` 被冤枉 |
| 0/0 | 一张没有行的单，`pairs.length / output.lines.length` 得到 `NaN` | `NaN` 混进平均值，整个汇总变成 `NaN`；更糟的是 `NaN === 1` 为假，`receipt_exact` 悄悄变成 0 |
| 空值 | `null` 和 `undefined` 混用，`p.unit === g.unit` 在一边是 `null`、一边是 `undefined` 时为假 | 两边都没写单位，却被判字段错 |
| 浮点 | 数量 6.7 用 `===` 比 | 模型读对了，评分器说错了 |
| 汇总 | 只在部分样例上出现的指标按 0 计 | 没有合计的单，`total_consistency` 平白拉低 |

这些 bug 有一个共同点：**在大部分样例上不会触发**，只有碰到特定的边界情况才出错。所以不能靠「看一眼报告，数字挺正常」来判断评分器没问题。

## 用手工构造的样例写单元测试

最直接的办法是给评分器写普通的单元测试：手工构造一对输出和期望，断言分数。这类测试不调模型，可以放进普通的 `pnpm test` 里，每次都跑。

要覆盖的情况，按上一章评分器的设计逐条列出来：

| 情况 | 期望 |
|---|---|
| 输出和期望完全相同 | 所有指标都是 1 |
| 两边都没有行（只拍到抬头） | `line_precision`、`line_recall` 都是 1，不是 `NaN` |
| 漏读中间一行 | `line_recall` 下降，后面的行不错位，`field_acc` 仍是 1 |
| 多读了合计行 | 只有 `line_precision` 下降 |
| 名字差一个字（「土豆」读成「士豆」） | 能配上；`name` 字段判错，其余字段照常比较 |
| 同一张单出现两次「青椒」 | 按位置就近配对，不交叉 |
| 任何输入 | 每个分数都是 0 到 1 之间的有限数 |

```typescript
// evals/receipt/scorers.test.ts
import { describe, expect, it } from "vitest";
import { lineScorer, exactScorer } from "./scorers";
import type { Receipt, ReceiptLine } from "./schema";

const line = (name: string, quantity: number, unitPriceCents = 100): ReceiptLine => ({
  name,
  unit: "斤",
  quantity,
  unitPriceCents,
  amountCents: Math.round(quantity * unitPriceCents),
});
const receipt = (lines: ReceiptLine[]): Receipt => ({ date: null, supplier: null, totalCents: null, lines });
const input = { image: "x.jpg", sha256: "", layout: null };
const score = async (output: Receipt, expected: Receipt) => {
  const scores = [...(await lineScorer({ input, output, expected })), ...(await exactScorer({ input, output, expected }))];
  return Object.fromEntries(scores.map((s) => [s.name, s.value]));
};

describe("lineScorer", () => {
  it("完全相同时全部为 1", async () => {
    const r = receipt([line("白菜", 6), line("毛豆", 8)]);
    const s = await score(r, structuredClone(r));
    expect(Object.values(s).every((v) => v === 1)).toBe(true);
  });

  it("两边都没有行时不是 NaN", async () => {
    const s = await score(receipt([]), receipt([]));
    expect(s.line_precision).toBe(1);
    expect(s.line_recall).toBe(1);
  });

  it("漏读一行不会让后面的行错位", async () => {
    const expected = receipt([line("白菜", 6), line("毛豆", 8), line("土豆", 30)]);
    const output = receipt([line("白菜", 6), line("土豆", 30)]);
    const s = await score(output, expected);
    expect(s.line_recall).toBeCloseTo(2 / 3);
    expect(s.field_acc).toBe(1);
  });

  it("名字错一个字仍能配上，只扣名字这一格", async () => {
    const s = await score(receipt([line("士豆", 30)]), receipt([line("土豆", 30)]));
    expect(s.line_recall).toBe(1);
    expect(s.field_acc).toBeCloseTo(4 / 5);
    expect(s.receipt_exact).toBe(0);
  });

  it("重复的货品名按位置就近配对", async () => {
    const expected = receipt([line("青椒", 3, 400), line("白菜", 6), line("青椒", 5, 350)]);
    const s = await score(structuredClone(expected), expected);
    expect(s.field_acc).toBe(1);
  });
});
```

最后一个测试值得说一句：两行「青椒」名字完全相同，相似度都是 1，如果配对时不看位置，第 1 行可能配到第 3 行上，数量和单价全部判错。这正是上一章 `matchLines` 排序里加了位置作为第二关键字的原因。测试把这个设计意图固定下来，以后有人「简化」排序逻辑时会立刻失败。

写这些测试时有一个习惯：**先让测试失败一次**。比如把 `ratio` 里的 0/0 处理删掉，确认「两边都没有行」那条测试会变红，再改回来。一条从来没失败过的测试，你不知道它是真的在检查，还是断言写错了、永远通过。

## 在整个测试集上跑性质检查

手工构造的样例只覆盖你想到的情况。测试集里有几百张真实的单，它们会碰到你没想到的边界：标注里某个字段是 `null`、一张单上有三行同名、单位写成「斤 」带个空格。不需要知道正确分数，只要利用几个**一定成立的性质**，就能拿整个测试集来检查评分器：

| 性质 | 做法 | 抓到什么 |
|---|---|---|
| 自己和自己比，满分 | 把期望直接当成输出 | 评分器的比较逻辑错误；也会抓到标注本身的问题，比如名字归一化之后撞在一起的两行 |
| 改坏一格，必须扣分 | 把期望复制一份，随机改掉一个字段 | 某个字段其实没被比较（`FIELDS` 漏了一项、比较函数永远返回真） |
| 行顺序打乱，行指标不变 | 把期望的行随机重排后当成输出 | 配对依赖了位置；顺带暴露同名行的配对问题 |

```typescript
// evals/receipt/scorers.dataset.test.ts
import { describe, expect, it } from "vitest";
import { loadCases } from "@hatch/evalkit";
import { Receipt, ReceiptInput } from "./schema";
import { lineScorer, headerScorer, exactScorer } from "./scorers";

const cases = await loadCases(new URL("./cases.jsonl", import.meta.url).pathname, ReceiptInput, Receipt);
const scorers = [lineScorer, headerScorer, exactScorer];

async function scoreAll(input: ReceiptInput, output: Receipt, expected: Receipt) {
  const out: Record<string, number> = {};
  for (const scorer of scorers) {
    for (const s of await scorer({ input, output, expected })) out[s.name] = s.value;
  }
  return out;
}

describe("在全部样例上检查评分器的性质", () => {
  it.each(cases.map((c) => [c.id, c] as const))("%s：自己和自己比得满分", async (_, c) => {
    const s = await scoreAll(c.input, structuredClone(c.expected), c.expected);
    for (const [name, v] of Object.entries(s)) expect(v, name).toBe(1);
  });

  it.each(cases.filter((c) => c.expected.lines.length > 0).map((c) => [c.id, c] as const))(
    "%s：改坏一格就不再全对",
    async (_, c) => {
      const output = structuredClone(c.expected);
      output.lines[0].quantity = (output.lines[0].quantity ?? 0) + 1;
      const s = await scoreAll(c.input, output, c.expected);
      expect(s.receipt_exact).toBe(0);
      expect(s.field_acc).toBeLessThan(1);
    },
  );
});
```

这里故意没有把 `consistencyScorer` 放进「满分」检查：上一章说过，单据本身可能算错了金额，标注照抄纸上的字，一致性评分器在这种样例上得 0 分是正确的。一个性质只在它真的成立的范围内检查，否则测试会逼你去「修」本来没错的东西。

「行顺序打乱」这一条没写进代码，因为它并不总是成立：一张单上有两行同名的「青椒」，打乱后就近配对会配错。第一次在全部样例上跑这条检查时，失败的样例正好就是有同名行的那几张。这不是 bug，而是贪心配对已知的局限，可以在测试里跳过有同名行的样例，并在评分器的注释里写明。性质检查的价值之一，就是把这类「我以为不会发生」的情况从几百张单里找出来。

第一次跑「自己和自己比」，失败的往往不是评分器，而是标注：日期写成了 `2026/3/5`，名字里混进了全角空格，某一行的金额字段漏填。这些在 `loadCases` 的 schema 校验里不一定报错，却会在评分时变成莫名其妙的扣分。把它们修掉，测试集本身也干净了一轮。

## 和人对一遍

单元测试和性质检查能证明评分器**按你的设计**在工作，但不能证明你的设计**和你真正在意的事**一致。`receipt_exact` 的本意是「店主一格都不用改」，评分器判的是「每个字段和标注一字不差」，这两件事之间可能有缝。

找缝的办法和[第 5 章校准评判模型](04-llm-judge.md#校准评判模型和人一致吗)是同一个思路，只是对象换成了代码评分器：

1. 从一次完整运行的结果里，抽 20 条 `receipt_exact = 0` 的和 20 条 `receipt_exact = 1` 的
2. 打开原图和模型输出，**不看评分器的 `detail`**，自己判断：店主拿到这个结果，要不要改
3. 把你的判断和评分器的结论放在一起，逐条看不一致的

不一致分两个方向，原因和修法也不同：

| 方向 | 常见原因 | 修法 |
|---|---|---|
| 评分器判错，你觉得不用改 | 比较太死板：「6.70」和「6.7」、「斤」和「市斤」、日期格式不同 | 在比较前补归一化，或者在标注规范里统一写法 |
| 评分器判对，你觉得要改 | 标注本身错了；或者评分器没比较某样店主在意的东西 | 改标注；或者在评分器里加一项比较 |

第二个方向更危险，因为它会让分数**偏高**。比如标注员把一行的单价抄错了，模型恰好也读成同一个错的数，评分器判全对，店主却要改。抽查时发现一条，就要想到测试集里可能还有同类的，按[第 2 章的标注质量抽查](02-datasets.md#标注质量抽查)再查一轮。

代码评分器和评判模型的不同在于：它对自己的规则是百分之百一致的，不一致只能来自规则本身。所以每一条不一致，最终都落到一个具体的改动上：改归一化、改标注规范、改标注，或者确认这是可以接受的差异并记下来。这一轮做完，`receipt_exact` 才真正接近「店主一格都不用改」。

这件事不用常做。评分器写好时做一次，之后在评分规则、标注规范或任务本身有明显变化时再做一次。

## 评分器改了，旧分数怎么办

上面每一种检查都可能让你改评分器：补一个归一化，修一个 0/0，加一项比较。改完之后有一个容易忽略的后果：**新评分器打出的分数，和旧基线不能直接比**。

假设你在比较单位前加了「市斤 → 斤」的归一化，同时改了 prompt。新一轮 `receipt_exact` 从 0.62 涨到 0.68，其中多少是 prompt 的功劳、多少是评分器放宽了，分不清。[第 6 章的基线](05-regression.md#基线和谁比)比较的前提，是两边用同一把尺子。

处理办法有两条：

- **评分器的改动单独提交**，不和 prompt 或模型的改动混在一起
- **用新评分器给旧输出重新打分**，生成新的基线。上一章的运行器把模型的完整输出存在了 `results/` 里，重新打分不需要再调一次模型

```typescript
// evals/receipt/rescore.ts
// 用法：pnpm tsx evals/receipt/rescore.ts evals/receipt/results/<某次运行>.json
import { readFile, writeFile } from "node:fs/promises";
import { loadCases, summarize, printSummary, type CaseResult, type Score } from "@hatch/evalkit";
import { Receipt, ReceiptInput } from "./schema";
import { lineScorer, headerScorer, exactScorer, consistencyScorer } from "./scorers";

const file = process.argv[2];
if (!file) throw new Error("传入一次运行的结果文件");

const run = JSON.parse(await readFile(file, "utf8")) as { meta: Record<string, string>; results: CaseResult<Receipt>[] };
const cases = await loadCases(new URL("./cases.jsonl", import.meta.url).pathname, ReceiptInput, Receipt);
const byId = new Map(cases.map((c) => [c.id, c]));
const scorers = [lineScorer, headerScorer, exactScorer, consistencyScorer];

const results: CaseResult<Receipt>[] = [];
for (const r of run.results) {
  const c = byId.get(r.id);
  // 出错的样例和已经从测试集删掉的样例原样保留，不重新打分
  if (!c || r.error || r.output === undefined) {
    results.push(r);
    continue;
  }
  const scores: Score[] = [{ name: "ok", value: 1 }];
  for (const scorer of scorers) scores.push(...(await scorer({ input: c.input, output: r.output, expected: c.expected })));
  results.push({ ...r, scores });
}

const summary = summarize(results);
printSummary(summary, "receipt_exact");
const out = file.replace(/\.json$/, ".rescored.json");
await writeFile(out, JSON.stringify({ meta: run.meta, summary, results }, null, 2));
console.log(`重新打分的结果：${out}`);
```

拿旧输出的重新打分结果作为新的基线，再和用新评分器跑出的新输出比较，两边就用的是同一把尺子了。重新打分时顺便看一眼新旧分数差了多少：差得很多，说明这次评分器的改动影响面比你以为的大，值得回头再看一遍改的是什么。

这也是一个理由，让 `results/` 里的完整输出至少保留到下一次更新基线之后：没有旧输出，就只能把旧模型、旧 prompt 再跑一遍，既花钱，结果也不完全一样。

## 本章要点

- 评分器出错不会报错，只会给出看起来很合理的错分数，要像测业务代码一样测它
- **单元测试**覆盖边界：完全相同、两边为空、漏读、多读、名字差一个字、同名行；每条测试先让它失败一次
- **性质检查**拿整个测试集验证评分器：自己和自己比得满分、改坏一格必须扣分；只在性质真的成立的范围内检查
- 第一次跑性质检查，常常先抓到的是**标注的问题**
- **和人对一遍**：抽满分和零分的样例各 20 条人工判断，不一致的逐条落到改归一化、改规范或改标注上；「评分器判对、人觉得要改」最危险
- 评分器改了，**单独提交，并用新评分器给旧输出重新打分**作为新基线，否则分数涨跌分不清是谁的功劳
