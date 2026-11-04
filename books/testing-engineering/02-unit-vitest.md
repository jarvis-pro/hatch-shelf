# 单元测试与 Vitest

单元测试是整套测试里最便宜的一层：不起服务、不连数据库、不开浏览器，一条测试几毫秒。它的前提是被测的东西是**纯的**：给定输入，得到确定的输出，不偷偷读时钟、不偷偷写文件。这一章讲怎么写出好的单元测试，以及用 Vitest 把它们组织起来。案例取自 hatch-shelf 的 `@shelf/spec` 和局域网传书的 HTTP 解析器，它们是这个仓库里测试最密的地方。

Vitest 在 Vite 项目里的配置、组件测试和 Testing Library 的查询原则，[《前端工程化与 Web 平台》的 Vitest 与 Playwright 一章](../frontend-engineering/09-testing.md)已经讲过，这里不重复，重点放在「测试本身怎么写」。

## 什么算一个「单元」

上一章提过，「单元」如果理解成「一个类」，会逼出大量 mock。更好用的定义是：**一个单元是一段可以单独描述行为的逻辑**，它可以是一个函数，也可以是几个函数、一个小模块，只要它们一起对外提供一个说得清的行为，并且不碰进程外的东西（网络、磁盘、数据库、真实时钟）。

按这个定义，hatch-shelf 的 `prepareImport` 是一个单元：它内部调用了 zip 解包、`book.yaml` 解析、路径检查、扩展名过滤，但对外的行为只有一句话，「给我一个文件的字节，告诉我这是不是一本合法的书、应该写进去哪些文件」。测试只关心这句话，不关心内部拆成了几个函数。

## 一条测试的结构

每条测试都可以分成三段：准备（Arrange）、执行（Act）、断言（Assert）。下面是 hatch-shelf 里真实的一条：

```typescript
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { prepareImport } from "./index";

const zip = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

describe("prepareImport (zip)", () => {
  it("rejects zip slip entries", () => {
    // 准备：在内存里拼一个带 ../ 路径的压缩包
    const bytes = zip({ "../evil.md": "# x", "a.md": "# a" });
    // 执行
    const r = prepareImport({ kind: "zip", fileName: "x.zip", bytes });
    // 断言：失败，并且错误信息点名了那个文件
    expect(r).toEqual({ ok: false, error: expect.stringContaining("../evil.md") });
  });
});
```

几个值得注意的地方：

- **测试数据就在测试里**。压缩包不是仓库里的一个二进制文件，而是用 `fflate` 当场拼出来的，读测试的人一眼看到它包含什么
- **执行只有一行**。如果执行段要写好几行，往往说明被测的接口不好用
- **断言用了非对称匹配器** `expect.stringContaining`：只要求错误信息提到文件名，不锁定整句措辞

三段之间留空行就够了，不必写注释，上面的注释只是为了说明。

## 断言选哪个

Vitest 的 `expect` 和 Jest 兼容，常用的相等断言有好几个，区别经常被搞混：

| 断言 | 比较方式 | 适合 |
|---|---|---|
| `toBe` | `Object.is`，引用相等 | 原始值：数字、字符串、布尔 |
| `toEqual` | 递归比较值，忽略 `undefined` 属性 | 大部分对象和数组 |
| `toStrictEqual` | 递归比较，`undefined` 属性、类实例的类型也要一致 | 需要区分「没有这个字段」和「字段为 undefined」 |
| `toMatchObject` | 只比较期望里列出的字段 | 返回值很大，只关心其中几项 |

`toMatchObject` 是写抗重构测试的利器。hatch-shelf 的 HTTP 解析器测试里：

```typescript
it("parses a GET in one chunk", () => {
  const r = new RequestParser(100).push(enc("GET /books?x=1 HTTP/1.1\r\nHost: a\r\nX-Pin: 1234\r\n\r\n"));
  expect(r).toMatchObject({
    type: "complete",
    request: { method: "GET", path: "/books", headers: { "x-pin": "1234" } },
  });
});
```

解析结果里还有 `query`、`body` 和别的头，以后可能还会加字段。测试只锁定这条测试关心的东西：请求方法、路径（不含查询串）、头名被转成了小写。加字段不会让它红。

另外两个常用的组合：

- `expect.arrayContaining([...])`：数组包含这些元素，顺序和其余元素不管。用来断言「警告列表里提到了 `run.sh`」
- `expect(fn).toThrow(/正则/)` 和 `await expect(promise).rejects.toThrow()`：断言抛错。注意异步版本前面的 `await`，漏了它测试会直接通过

## 让边界情况一目了然：表格驱动

同一个函数要测一串输入输出时，用 `it.each` 写成表格，比复制十条 `it` 清楚得多：

```typescript
import { describe, expect, it } from "vitest";
import { formatBytes } from "./size-format";

// 规则：不足 1000 KB 显示整数 KB（至少 1 KB），否则显示一位小数的 MB
describe("formatBytes", () => {
  it.each([
    [0, "1 KB"],
    [10, "1 KB"],
    [999 * 1024, "999 KB"],
    [999.6 * 1024, "1000 KB"],
    [1000 * 1024, "1.0 MB"],
    [58.2 * 1024 * 1024, "58.2 MB"],
  ])("%d 字节显示为 %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
```

这是 hatch-shelf 书籍管理页显示占用空间的函数，期望值是按它的实现算出来的。表格的价值在于**边界值排成一列，漏了哪个一眼就看出来**。排出来之后，第四行就很显眼：999.6 KB 小于 1000，走 KB 分支，四舍五入后显示成「1000 KB」，而不是「1.0 MB」。这算不算错，要由产品决定；但不把边界排出来，这个问题根本不会被看见。

挑边界值有一套固定的问法：空的（0、空字符串、空数组）、一个的、刚好在阈值上的、阈值减一和加一的、最大的、非法的（负数、`NaN`、乱码）。日期再加上：月末、闰年 2 月 29 日、跨年、跨时区的午夜。

## 把时间变成参数

单元测试最常见的不确定来源是时间。函数里直接写 `new Date()` 或 `Date.now()`，测试结果就会随运行日期变化。

最干净的办法不是 mock 时钟，而是**把「现在」作为参数传进去**。hatch-shelf 导出阅读笔记的函数就是这样设计的，第四个参数是导出时间：

```typescript
it("groups by chapter order and keeps locations", () => {
  const md = buildNotesMarkdown(
    { id: "demo", title: "示例" },
    [
      { file: "01-a.md", title: "甲" },
      { file: "02-b.md", title: "乙" },
    ],
    [
      { chapterFile: "02-b.md", text: "第二章的一句", anchor: "小节", note: "想法", createdAt: Date.UTC(2026, 10, 2) },
      { chapterFile: "01-a.md", text: "两行\n原文", note: null, createdAt: Date.UTC(2026, 10, 1) },
    ],
    Date.UTC(2026, 10, 3), // 「现在」由调用方给
  );
  expect(md).toContain("exported: 2026-11-03");
});
```

调用方在生产代码里传 `Date.now()`，测试里传一个固定值。被测函数从此是纯的，不需要任何测试框架的特殊能力。`Date.UTC` 的月份从 0 开始，`10` 是 11 月，这是写日期测试时最常见的笔误之一。

### 改不了签名时：假时钟

> [!WARNING]
> 本节 `vi.useFakeTimers` 的默认行为按 2026 年 11 月 Vitest 5 官方文档（Config / fakeTimers 和迁移指南）整理：默认替换全局可用的计时相关 API（`setTimeout`、`Date`、`performance` 等，Vitest 5 起也包括 `Temporal`），但不替换 `process.nextTick` 和 `queueMicrotask`。不同大版本有过调整，以 Vitest 官方文档为准。

有些代码不方便加参数，比如一个内部用 `setTimeout` 做防抖的模块。这时用 Vitest 的假时钟：

```typescript
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSaver } from "./progress-saver";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-04T09:00:00+08:00"));
});

afterEach(() => {
  vi.useRealTimers();
});

it("连续滚动只在停下 1 秒后写一次进度", () => {
  const write = vi.fn();
  const saver = createSaver(write, 1000);

  saver.update({ anchor: "a" });
  vi.advanceTimersByTime(500);
  saver.update({ anchor: "b" });
  vi.advanceTimersByTime(999);
  expect(write).not.toHaveBeenCalled();

  vi.advanceTimersByTime(1);
  expect(write).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledWith({ anchor: "b" });
});
```

两个纪律：`afterEach` 里一定恢复真时钟，否则后面的测试会莫名其妙卡住；假时钟测试只推进你关心的那几段时间，不要用 `runAllTimers` 一把跑完，那样测不出「过早触发」这类错误。

## 一个好例子：把输入拆碎再喂

hatch-shelf 的局域网 HTTP 服务是自己写的请求解析器。TCP 收到的数据是一块一块来的，一个请求可能被切在任何位置：请求行中间、头部的 `\r\n\r\n` 中间、请求体中间。手写几个切分点很难覆盖全，测试干脆**一个字节一个字节地喂**：

```typescript
it("assembles a body split across many chunks, including a split header terminator", () => {
  const raw = "POST /upload HTTP/1.1\r\nContent-Length: 11\r\n\r\nhello world";
  const p = new RequestParser(100);
  let last;
  for (const ch of raw) last = p.push(enc(ch));
  expect(last).toMatchObject({ type: "complete" });
  if (last?.type === "complete") expect(textOf(last.request.body)).toBe("hello world");
});
```

这条测试覆盖了所有可能的切分位置，代价只是一个循环。这种「把输入换个方式喂进去，结果应该不变」的想法，推广一下就是**基于性质的测试**（property-based testing）：不写具体的输入输出，而是写一条对所有输入都成立的性质，让工具随机生成上百个输入去验证。

```typescript
import fc from "fast-check";
import { expect, it } from "vitest";

it("任意切分方式，解析结果都和一次性喂入相同", () => {
  const raw = enc("POST /upload HTTP/1.1\r\nContent-Length: 11\r\n\r\nhello world");
  fc.assert(
    fc.property(fc.uniqueArray(fc.integer({ min: 1, max: raw.length - 1 })), (cuts) => {
      const points = [0, ...cuts.sort((a, b) => a - b), raw.length];
      const p = new RequestParser(100);
      let last;
      for (let i = 0; i < points.length - 1; i++) last = p.push(raw.slice(points[i], points[i + 1]));
      expect(last).toMatchObject({ type: "complete" });
    }),
  );
});
```

`fast-check` 失败时会自动「缩小」反例，给出最短的那个切分方式。适合用性质测试的地方：解析与序列化互逆（`parse(stringify(x))` 等于 `x`）、排序结果有序且元素不变、任意切分不影响结果。业务规则一般不适合，写具体的例子更清楚。

## 快照：只给小而稳定的输出

快照测试把输出存成文件，下次运行时比对。它很省事，也很容易滥用：一个组件渲染出几百行 HTML，存成快照，以后每次改样式都要更新，更新的人从不细看 diff，快照就沦为「记录现状」而不是「检查正确」。

更好的用法是**内联快照**，并且只给小的输出：

```typescript
it("单个 Markdown 文件导入时，文件名转成书 id", () => {
  const r = prepareImport({ kind: "md", fileName: "Rust Ownership.md", text: "# 所有权\n正文" });
  expect(r.ok && r.id).toMatchInlineSnapshot(`"rust-ownership"`);
});
```

第一次运行时 Vitest 把实际值填进源码，以后它就是一条普通断言，和代码放在一起，review 时能看到。输出超过十来行，就该拆成几条有针对性的断言了。

## 类型也能测

`@shelf/spec` 这类被多个包共用的库，导出的类型本身就是接口的一部分。Vitest 内置了类型断言：

```typescript
import { expectTypeOf, it } from "vitest";
import { parseBookYaml } from "./manifest";

it("解析失败时没有 manifest 字段", () => {
  const r = parseBookYaml("");
  if (!r.ok) expectTypeOf(r).not.toHaveProperty("manifest");
});
```

类型测试在 `vitest --typecheck` 下由 TypeScript 编译器检查，不在运行时执行。大部分项目用不上，写公共库、写复杂的泛型工具类型时才值得加。

## 在 monorepo 里组织 Vitest

> [!WARNING]
> 本节的 `test.projects` 配置按 2026 年 11 月 Vitest 5 官方文档和迁移指南整理（hatch-shelf 当前用 Vitest 5.0）。`projects` 从 Vitest 3.2 开始取代早期的 workspace（单独的 `vitest.workspace.ts` 文件）；Vitest 5 又改了几处默认行为，见下方代码后的说明。配置项仍可能调整，以 Vitest 官方文档 Projects 一节为准。

hatch-shelf 的做法最简单：每个包各自有 `"test": "vitest run"`，根目录的 `pnpm test` 就是 `pnpm -r test`，逐个包跑。好处是每个包的测试环境独立：`@shelf/spec` 跑在纯 Node 环境，App 的测试只跑 `src` 下不依赖 React Native 的纯模块。

包多了以后，也可以在根目录用一份配置统一跑，Vitest 会并行调度各个项目：

```typescript
// vitest.config.ts（仓库根目录）
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/*",
      "tools/*",
      {
        test: {
          name: "app",
          root: "./app",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
```

Vitest 5 在这里改了三处默认行为，从 4 升级时要留意：

- **内联项目默认继承根配置**（`extends` 默认为 `true`），根配置里的插件、`setupFiles` 等会合并进上面那个 `app` 项目；不想继承就写 `extends: false`。用路径引用的项目（`"packages/*"`）不继承
- **内联项目默认共用根配置的 Vite 服务**（`sharedViteServer`），配置文件只执行一次。某个插件需要每个项目各实例化一次时，关掉这个选项
- **不再向上级目录查找配置文件**。在子目录里直接跑 `vitest` 找不到根目录的配置，要用 `--config` 显式指定

日常开发里最常用的是监听模式。`vitest`（不带 `run`）启动后监听文件，改了哪个模块只重跑依赖它的测试；`vitest --changed` 只跑和未提交改动相关的测试，适合提交前快速过一遍。

## 单元测试的几条纪律

- **一条测试只验一条规则**。一条测试里断言十件事，红了不知道是哪件；但一条规则需要多个断言来表达（比如「失败，并且错误点名了文件」）是可以的
- **测试之间不共享可变状态**。`beforeEach` 里重新构造，不要在 `describe` 顶层建一个对象让几条测试轮流改
- **不要在测试里写逻辑**。测试里出现 `if`、循环、计算期望值，说明你在测试里重新实现了一遍被测代码。期望值直接写字面量（上面逐字节喂的循环是在构造输入，不是在算期望值）
- **先看它红一次**。新写的测试先故意改坏被测代码，确认测试会红，再改回来。从没红过的测试可能什么都没测
- **修 bug 先写测试**。拿到一个 bug，先写一条能复现它的测试，看着它红，修完看着它绿

## 本章要点

- 单元是一段可以单独描述行为的逻辑，不一定是一个类；它不碰进程外的东西
- 准备、执行、断言三段式；测试数据写在测试里，执行段只有一行
- `toMatchObject` 和非对称匹配器只锁定关心的字段，测试更抗重构
- 边界值用 `it.each` 排成表格；挑边界有固定的问法
- 时间最好作为参数传入；改不了签名才用假时钟，并在 `afterEach` 里恢复
- 换个方式喂输入、结果应该不变，是很强的测试思路；推广开就是性质测试
- 快照只给小而稳定的输出，优先内联快照
- monorepo 里可以各包各跑，也可以用 `projects` 统一调度
