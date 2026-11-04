# 性能剖析

前几章讲了很多「可能慢」的原因：同步代码阻塞事件循环、超态的属性访问、反复 deopt、GC 压力。但实际排查时，**最常见的错误是还没测量就开始猜**。凭直觉优化的代码，十次有八次优化的不是瓶颈。

这一章讲 Node 自带的剖析工具链：先用指标判断问题在哪一类，再用 CPU 剖析找热点函数，用堆剖析找分配大户。重点是 `--cpu-prof` 这类**零依赖、随 Node 一起发布**的工具，它们在生产服务器上也能用。

## 先分清是哪一类慢

| 症状 | 先看什么 | 可能的原因 |
|---|---|---|
| 所有接口一起变慢，CPU 接近 100% | 事件循环延迟、CPU 剖析 | 某段同步计算太重 |
| 所有接口一起变慢，CPU 不高 | 事件循环延迟、线程池 | 线程池排队（第 4 章）、外部依赖慢 |
| 个别接口慢 | 日志里的耗时、数据库慢查询 | 多半是 SQL 或外部 API，不是 Node |
| 越跑越慢，重启恢复 | 内存曲线、GC 日志 | 内存泄漏导致 GC 越来越频繁（第 6 章） |
| 偶发的长尾延迟 | p99 延迟、GC 停顿 | 大对象分配、大 JSON 序列化 |

两个最有用的运行时指标都在 `node:perf_hooks` 里，开销极低，可以常驻生产：

- **事件循环延迟**：`monitorEventLoopDelay()`，第 4 章用过，反映「回调要排多久的队」
- **事件循环利用率**（ELU）：`performance.eventLoopUtilization()`，0 到 1 之间，表示事件循环有多大比例的时间在执行 JS 而不是空闲等待

```ts
// elu.ts
import { performance } from "node:perf_hooks";

const before = performance.eventLoopUtilization();
// 每 100 ms 忙 30 ms
const t = setInterval(() => { const end = Date.now() + 30; while (Date.now() < end); }, 100);

setTimeout(() => {
  clearInterval(t);
  const elu = performance.eventLoopUtilization(before);
  console.log("ELU", elu.utilization.toFixed(2)); // ELU 0.27
}, 1000);
```

ELU 比进程 CPU 使用率更准：CPU 使用率里混着线程池和 GC 后台线程的工作，而 ELU 只反映主线程。**ELU 持续接近 1，说明这个进程的 JS 已经算不过来了**，加机器或拆 worker 才有用；ELU 很低但延迟高，瓶颈在别处（I/O、数据库、线程池）。

## CPU 剖析：--cpu-prof

V8 内置一个采样剖析器：每隔一小段时间（默认约 1 ms）记录一次当前调用栈，跑完后统计每个函数出现在栈顶的频率。Node 用一个参数就能开：

```bash
node --cpu-prof --cpu-prof-dir=out slow.ts
# 进程退出时写出 out/CPU.20261102.191901.42922.0.001.cpuprofile
```

`.cpuprofile` 是 JSON 格式，可以用 Chrome DevTools（Performance 面板，或者 `chrome://inspect` 里的「Open dedicated DevTools for Node」→ Profiler）、VS Code（直接打开文件有按函数统计的表格视图，装上微软的 Flame Chart Visualizer 扩展可看火焰图）或 speedscope 打开。

### 一个完整的例子

下面这段代码故意写得低效：在一个热循环里，每个字符都新建一个正则对象。

```ts
// slow.ts
import { createHash } from "node:crypto";

function slugify(title: string): string {
  // 故意写得低效：每次都新建正则
  return title.toLowerCase().split("").filter((ch) => new RegExp("[a-z0-9]").test(ch)).join("");
}

function hashAll(n: number): string {
  let last = "";
  for (let i = 0; i < n; i++) last = createHash("sha256").update(slugify(`Chapter ${i} Title`)).digest("hex");
  return last;
}

console.log(hashAll(300_000));
```

不开图形界面也能读剖析结果。`.cpuprofile` 的结构很简单：`nodes` 是调用树的节点，`samples` 是每次采样落在哪个节点，`timeDeltas` 是采样间隔。几十行代码就能算出每个函数的「自身耗时」（self time）：

```ts
// top.ts —— 用法：node top.ts <file.cpuprofile> [N]
import { readFileSync } from "node:fs";

interface Node { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }
interface Profile { nodes: Node[]; samples: number[]; timeDeltas: number[] }

const [file, n = "10"] = process.argv.slice(2);
if (!file) throw new Error("usage: node top.ts <file.cpuprofile> [N]");
const prof = JSON.parse(readFileSync(file, "utf8")) as Profile;
const byId = new Map(prof.nodes.map((nd) => [nd.id, nd]));
const self = new Map<string, number>();
prof.samples.forEach((id, i) => {
  const f = byId.get(id)!.callFrame;
  const key = `${f.functionName || "(anonymous)"} ${f.url.split("/").pop()}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (prof.timeDeltas[i] ?? 0));
});
const total = [...self.values()].reduce((a, b) => a + b, 0);
for (const [k, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, Number(n)))
  console.log(`${((us / total) * 100).toFixed(1).padStart(5)}%  ${(us / 1000).toFixed(0).padStart(6)} ms  ${k}`);
```

```text
$ node top.ts out/*.cpuprofile 8
 45.4%     262 ms  (anonymous) slow.ts:5
 11.6%      67 ms  slugify slow.ts:3
  9.9%      57 ms  (garbage collector) :0
  6.9%      40 ms  Hash hash:88
  5.5%      32 ms  digest hash:150
  5.1%      29 ms  RegExp: [a-z0-9] :0
  3.9%      23 ms  hashAll slow.ts:8
  3.1%      18 ms  (anonymous) slow.ts:1
```

读法：

- 第 5 行的匿名函数（`filter` 的回调）占了近一半时间，加上 `slugify` 自身和 `RegExp`，字符串处理是绝对的大头；真正的业务——计算哈希——只占百分之十几
- `(garbage collector)` 占近 10%：每个字符一个正则对象、一个单字符字符串，制造了大量短命垃圾
- 行号和源码完全对得上：Node 直接跑 `.ts` 时类型被替换成空格，位置不变，不需要 source map（第 9 章）

把 `slugify` 改成一次正则替换、正则提到模块级：

```ts
const NON_ALNUM = /[^a-z0-9]/g;

function slugify(title: string): string {
  return title.toLowerCase().replace(NON_ALNUM, "");
}
```

输出的哈希完全相同，总耗时从 0.58 s 降到 0.20 s。**剖析 → 改热点 → 再剖析验证**，这就是性能优化的全部流程。

### 火焰图怎么看

先分清两种图：DevTools Performance 面板里的 flame chart 横轴是**时间顺序**，适合看「某一时刻在干什么」；speedscope 的 Left Heavy 视图这类 flame graph 把相同调用栈合并，横轴是**时间占比**，适合找热点。两者纵轴都是调用栈深度，越宽的块越耗时。

- 找**顶部又宽又平**的块：那是自身耗时高的函数，优化它收益最大
- 很宽但上面堆满了子调用的块，自身不慢，是它调用的东西慢
- 大片的 `(garbage collector)`：去看分配（下一节）
- 大片的 `(program)` 或 `(idle)`：主线程在等 I/O，CPU 剖析帮不上忙，回到上面的分类表

### 剖析一个运行中的服务

`--cpu-prof` 要在进程退出时才写文件，对常驻的服务不方便。这时用 inspector：

```bash
# 启动时打开 inspector（只监听本机）
node --inspect=127.0.0.1:9229 dist/main.js

# 已经在跑、没带参数的进程：发 SIGUSR1 让它打开 inspector（Linux / macOS）
kill -USR1 <pid>

# 在你的电脑上开 SSH 隧道，然后在 Chrome 打开 chrome://inspect
ssh -L 9229:127.0.0.1:9229 user@your-server
```

连上后在 Profiler 里点开始，用压测工具（autocannon、k6）打一波流量，再点停止。**inspector 端口等于远程代码执行权限**，绝不能监听 `0.0.0.0` 或在 Docker 里把 9229 映射到公网；容器里要用时，映射成 `127.0.0.1:9229:9229` 再走 SSH 隧道。

## 堆剖析：谁在分配内存

CPU 剖析里 GC 占比高，说明有地方在大量制造垃圾。`--heap-prof` 开启 V8 的采样堆剖析器，记录「哪个调用栈分配了多少内存」：

```bash
node --heap-prof --heap-prof-dir=hp slow.ts
# 写出 hp/Heap.20261102.193105.63763.0.001.heapprofile
```

`.heapprofile` 同样能在 DevTools 的 Memory 面板加载，看到按函数统计的分配量。注意区分它和第 6 章的堆快照：

| 工具 | 回答的问题 | 适合 |
|---|---|---|
| 堆快照 `.heapsnapshot` | 此刻内存里**还活着**哪些对象，被谁引用 | 查泄漏 |
| 采样堆剖析 `.heapprofile` | 一段时间里**哪里分配**了最多内存（不管死没死） | 查 GC 压力、优化分配 |
| `--trace-gc` | GC 多频繁、每次多久 | 判断 GC 是不是问题 |

## 更多工具

### --prof：V8 原生的 tick 剖析

`--cpu-prof` 出现之前的老办法，现在偶尔还有用，因为它能看到 V8 内建函数（Builtin）和 C++ 层面的耗时：

```bash
node --prof slow.ts          # 生成 isolate-0x...-v8.log
node --prof-process isolate-*.log | head -30
```

```text
 [JavaScript]:
   ticks  total  nonlib   name
     33    7.1%    7.1%  RegExp: [a-z0-9]
     22    4.7%    4.7%  Builtin: ArrayPrototypeJoin
     18    3.9%    3.9%  Builtin: RegExpConstructor
```

能直接看到 `RegExpConstructor` 这一项——每次 `new RegExp` 的代价。

### 代码内的计时

对已知的可疑代码段，`performance.mark` / `measure` 比剖析器更直接，结果也能接进监控：

```ts
import { performance, PerformanceObserver } from "node:perf_hooks";

new PerformanceObserver((list) => {
  for (const e of list.getEntries()) console.log(e.name, e.duration.toFixed(1), "ms");
}).observe({ entryTypes: ["measure"] });

performance.mark("render:start");
const html = Array.from({ length: 100_000 }, (_, i) => `<li>${i}</li>`).join("");
performance.mark("render:end");
performance.measure("render", "render:start", "render:end");
```

### 第三方工具

| 工具 | 用途 | 备注 |
|---|---|---|
| Clinic.js（doctor / flame / bubbleprof） | 自动诊断问题类型、火焰图、异步调用可视化 | 曾是 Node 社区的常用工具；根据公开信息其维护已不活跃，在新版 Node 上使用前先看仓库状态 |
| 0x | 生成火焰图 | 底层同样基于 V8 的剖析数据 |
| autocannon / k6 | 压测，制造可复现的负载 | 剖析要在有负载时做才有意义 |
| speedscope | 打开 `.cpuprofile` 的火焰图查看器 | 有本地 CLI，可离线使用 |

工具会变，原理不会：上面这些几乎都是在 V8 的 CPU 剖析数据和 `perf_hooks` 指标上做包装。掌握 `--cpu-prof`、`--heap-prof`、ELU 和事件循环延迟，就能覆盖绝大多数场景。

## 剖析的几条纪律

- **在接近生产的条件下测**：开发模式（热重载、source map、未压缩的依赖）的剖析结果会误导你
- **有负载才剖析**：空闲的服务剖出来全是 `(idle)`
- **先剖析再优化，优化后再剖析**：没有前后对比数据的优化，等于没做
- **一次只改一处**：同时改三处，你不知道是哪处起了作用
- **记录基线**：把关键接口的 p50 / p99 延迟和 ELU 记下来，下次才知道是变好还是变坏

## 本章要点

- 先按症状分类：CPU 高看剖析，CPU 低但延迟高看事件循环和线程池，越跑越慢看内存
- ELU 和事件循环延迟是开销极低、可常驻生产的两个核心指标
- `--cpu-prof` 零依赖生成 `.cpuprofile`，可在 DevTools / VS Code 打开，也能用几十行脚本直接统计 self time
- 火焰图找顶部宽而平的块；GC 占比高就转去看分配（`--heap-prof`）
- 运行中的服务用 inspector + SSH 隧道剖析，inspector 端口绝不暴露到公网
- 剖析 → 改热点 → 再剖析验证，一次只改一处

## 动手练习

1. **自己走一遍剖析循环**：把本章的 `slow.ts` 和 `top.ts` 存下来，运行 `node --cpu-prof --cpu-prof-dir=before slow.ts`，再 `node top.ts before/*.cpuprofile 5`。按本章的方法改写 `slugify`，输出到 `after` 目录再统计一次。

   验证：改之前排第一的是 `(anonymous) slow.ts:5`（`filter` 回调），占四成多，前几名里还有 `RegExp: [a-z0-9]`；改之后这两项消失，排在前面的变成哈希相关的 `digest`、`Hash`，两次打印的哈希值完全相同，总采样时间明显变短。

   参考答案：热点在字符串处理而不是哈希。改完后剖析结果的「形状」变了，这才算验证了优化，而不是只看到总时间变短。

2. **ELU 分不清的和分得清的**：

   ```js
   // elu.mjs —— node elu.mjs sync / node elu.mjs async
   import { performance } from "node:perf_hooks";
   import { pbkdf2 } from "node:crypto";
   const before = performance.eventLoopUtilization();
   const t = setInterval(() => {
     if (process.argv[2] === "sync") { const end = Date.now() + 90; while (Date.now() < end); }
     else pbkdf2("pw", "salt", 300_000, 64, "sha512", () => {});
   }, 100);
   setTimeout(() => {
     clearInterval(t);
     console.log(process.argv[2], "ELU", performance.eventLoopUtilization(before).utilization.toFixed(2));
   }, 1000);
   ```

   预测两次的 ELU，运行时同时用活动监视器或 `top` 看进程 CPU。

   验证：`sync` 约 `0.80`（每 100 ms 忙 90 ms），`async` 接近 `0.00`，尽管后者的进程 CPU 使用率并不低。

   参考答案：异步 `pbkdf2` 在线程池里算，主线程大部分时间空闲。ELU 只反映主线程，所以它能区分「JS 算不过来」和「后台线程在忙」，这是只看 CPU 使用率做不到的。

3. **剖析一个运行中的服务**：用第 7 章的 `serve.ts` 加上 `--inspect=127.0.0.1:9229` 启动，在 Chrome 打开 `chrome://inspect`，在 Profiler 里开始录制，同时用 `npx autocannon -d 5 http://localhost:3000` 压 5 秒，停止录制。然后不带 `--inspect` 重启服务，用 `kill -USR1 <pid>` 再连一次。

   验证：录制结果里能看到 `pipeline`、文件读取和 HTTP 写出相关的调用栈；空闲时录制则几乎全是 `(idle)`。发送 `SIGUSR1` 后，服务的 stderr 打印出 `Debugger listening on ws://127.0.0.1:9229/...`，`chrome://inspect` 里出现这个进程。

   参考答案：剖析必须在有负载时做。`SIGUSR1` 能给已经在跑的进程打开 inspector，默认只监听本机；它等同远程代码执行权限，所以远程服务器上只通过 SSH 隧道连。
