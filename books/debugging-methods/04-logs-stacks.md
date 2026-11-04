# 读日志、错误与堆栈

排查时最先拿到手的证据，几乎总是一段日志、一条报错或者一个堆栈。它们包含的信息往往比第一眼看到的多得多，但也常常被匆匆扫一眼就放过：看到 `500` 就去翻业务代码，看到 `undefined is not an object` 就开始猜是哪个变量。

这一章讲怎么把这些文本读透：日志里先找什么，错误信息每个部分说明了什么，堆栈从哪一帧开始看，以及线上压缩过的代码怎么用 source map 还原。

## 先找第一条错误

一次故障常常在日志里留下几十条错误，但它们大多是连锁反应。数据库连不上，接下来每个请求都会报一次查询失败，每个查询失败又会触发一次重试失败。真正的原因只在最早的那一条里。

在服务器上找第一条错误，先缩小时间窗口，再按时间正序看：

```bash
# systemd 服务
journalctl -u hatch-counter --since "2026-11-03 21:00" --until "2026-11-03 21:10" -o short-iso

# Docker 容器
docker logs hatch-counter-server --since 2026-11-03T21:00:00 --until 2026-11-03T21:10:00 2>&1 | less

# 只看错误级别（JSON 日志）
docker logs hatch-counter-server --since 10m 2>&1 | grep '"level":50' | head -20
```

journald 和 Docker 日志的更多用法见[《Linux 系统与命令行》的 journald 一章](../linux-essentials/05-journald-logs.md)。

找到第一条错误之后，再往前看几行。错误之前的那几条普通日志常常说明了「当时在做什么」：哪个请求、哪个任务、哪个用户。

## 用请求 id 串起一次请求

一个请求在后端会经过守卫、管道、服务、数据库，每一层都可能打日志。线上同时有很多请求，日志是交错的，不串起来就看不清一个请求的完整经过。

hatch-counter 在每个请求进来时生成一个 id，所有日志都带上它，回包头里也带上：

```typescript
import { randomUUID } from "node:crypto";
import { Injectable, NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { requestContext } from "./request-context";

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const id = (req.headers["x-request-id"] as string) || randomUUID();
    res.setHeader("x-request-id", id);
    requestContext.run({ requestId: id, path: req.path }, next);
  }
}
```

`requestContext` 是一个 `AsyncLocalStorage`，日志库从里面取出 id 附在每条日志上。用户截图报错时，只要截图里有这个 id（或者客户端在错误提示里显示它的前几位），就能在日志里直接 grep 出这次请求的全部经过。

日志字段怎么设计、怎么集中收集，见[《可观测性与性能》](../observability-performance/01-logging.md)。

## 错误信息要逐字读

错误信息是写库的人留给你的线索，每个部分都有含义。以 Postgres 的报错为例：

```text
error: date/time field value out of range: "2026-02-30"
    code: '22008'
    severity: 'ERROR'
    routine: 'DateTimeParseError'
```

- **消息**：哪个值、什么问题。这里明确告诉你是 `"2026-02-30"` 这个日期超出范围
- **错误码**：`22008` 是 SQL 标准的 SQLSTATE，类别 `22` 表示「数据异常」。按错误码分类处理比按消息文字匹配可靠得多
- **routine**：Postgres 内部哪个函数报的，一般用不到，但搜索时有用

常见的 SQLSTATE 值得记住几个：`23505` 唯一约束冲突、`23503` 外键约束、`22P02` 输入格式不对（比如把 `abc` 当 uuid）、`40001` 序列化失败（可以重试）、`57014` 查询被取消（常见于超时）。

> [!WARNING]
> 上面的 SQLSTATE 错误码是按 PostgreSQL 文档附录「PostgreSQL Error Codes」整理的，消息文字会随版本变化，以 postgresql.org 对应版本的文档为准。

前端和 Node 里的常见报错也一样要逐字读：

| 报错 | 它在说什么 |
|---|---|
| `Cannot read properties of undefined (reading 'name')` | 有个值是 `undefined`，你在读它的 `name`；要找的是谁返回了 `undefined`，不是 `name` |
| `undefined is not an object (evaluating 'a.b.c')` | 同上，Safari / JavaScriptCore 的写法，括号里给出了完整表达式 |
| `Maximum update depth exceeded` | React 里某个 effect 或渲染中的 setState 形成了循环 |
| `ECONNREFUSED 127.0.0.1:5432` | 那个地址和端口上没有进程在监听；注意看地址是不是你以为的那个 |
| `EADDRINUSE :::3000` | 端口被占了，通常是上一个进程没退干净 |
| `ERR_REQUIRE_ESM` | 用 `require` 加载了一个只提供 ESM 的包 |

`ECONNREFUSED 127.0.0.1` 这一条在容器里尤其常见：容器里的 `127.0.0.1` 是容器自己，不是宿主机。读报错时注意地址，常常能直接看出问题。

## 读堆栈

### 从上往下，找第一帧自己的代码

一个 Node 里的堆栈大致是这样：

```text
TypeError: Cannot read properties of undefined (reading 'amountCents')
    at sumExpenses (/app/dist/expenses/expense.service.js:88:31)
    at Array.reduce (<anonymous>)
    at ExpenseService.monthlyTotal (/app/dist/expenses/expense.service.js:86:22)
    at async ReportController.monthly (/app/dist/reports/report.controller.js:41:19)
    at async /app/node_modules/@nestjs/core/router/router-execution-context.js:46:28
```

读法：

1. **第一行是错误类型和消息**：先读懂它
2. **往下找第一帧自己的代码**：跳过 `node_modules` 和 `<anonymous>`，这里第一帧就是 `sumExpenses`，第 88 行第 31 列
3. **继续往下看调用链**：是谁、带着什么参数走到这里的。这里是月报接口调用的
4. **`async` 前缀**：说明这一帧是异步调用链上的。V8 的零开销异步堆栈只能还原 `await` 链，用 `.then()` 回调或事件回调断开的链条接不上

### 堆栈里没有你的代码

有时候堆栈里一帧自己的代码都没有：

```text
error: invalid input syntax for type uuid: "latest"
    at /app/node_modules/pg/lib/client.js:545:17
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
```

这是数据库驱动的典型情况：错误对象是在收到 Postgres 回包的 socket 回调里创建的，那时调用栈里已经没有发起查询的那段代码了。

对策有两个：

- **靠上下文而不是堆栈**：请求 id 加上这条日志前面的几行，通常足以知道是哪个接口发的查询
- **在边界处包一层并带上 `cause`**：在仓储层捕获驱动错误，重新抛一个带业务含义的错误，把原错误放进 `cause`。新错误的堆栈是在你的代码里创建的

```typescript
try {
  return await db.select().from(expenses).where(eq(expenses.storeId, storeId));
} catch (err) {
  throw new Error(`查询门店 ${storeId} 的开支失败`, { cause: err });
}
```

Node 打印带 `cause` 的错误时会把两层都打出来。日志库序列化错误时也要确认会把 `cause` 带上，否则最有用的那一层就丢了。

## 案例：填错一个日期，回了 500

> [!NOTE]
> 问题和修复取自 hatch-counter 的真实提交 1ddfcd3e；下面的日志行和 curl 结果按提交信息重构，不是原样输出。

### 现象

hatch-counter 的网页端，在销量日历里手动改地址栏的日期参数（比如书签里存了一个旧链接），有时页面弹出「服务端出了点问题」。这是 500 的通用文案。

### 读日志

按时间找到对应的错误：

```text
{"level":50,"time":"2026-10-28T13:02:11.481Z","requestId":"6f1c...","path":"/v1/analytics/daily",
 "err":{"type":"DatabaseError","message":"date/time field value out of range: \"2026-02-30\"",
 "code":"22008","stack":"error: date/time field value out of range ...\n    at /app/node_modules/pg/lib/client.js:545:17 ..."}}
```

逐字读：

- 路径是 `/v1/analytics/daily`，参数里的日期是 `2026-02-30`，一个不存在的日子
- 错误来自 Postgres，`22008`，数据异常
- 状态码是 500，因为全局异常过滤器不认识这个错误，按「未知错误」处理

### 假设与验证

假设：查询参数的校验只检查了格式（`YYYY-MM-DD` 的正则），没有检查是不是真实存在的日期，于是不合法的值一路传到了数据库。

验证很简单，用 curl 直接打三个请求：

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/v1/analytics/daily?date=2026-02-30" -H "Authorization: Bearer $TOKEN"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/v1/analytics/daily?date=2026-13-01" -H "Authorization: Bearer $TOKEN"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/v1/analytics/daily?date=hello" -H "Authorization: Bearer $TOKEN"
```

结果：`500`、`500`、`400`。格式不对的被正则拦下了，格式对但日子不存在的漏到了数据库。顺着这个思路又试了地址里的 id 不是 uuid 的情况，同样是 500，日志里是 `22P02`。

### 修复

两处改动：

1. 日期参数的校验从「格式」改成「格式 + 真实存在」，校验失败回 400 和一句中文
2. 全局异常过滤器认出 `22P02`、`22008` 这类「数据异常」类的数据库错误，统一转成 400，而不是 500。用户输入能触发的错误不应该是 500

顺带发现校验库的默认错误文案是英文的，也一并换成中文。最后补了 e2e 测试，覆盖这几种输入。

这次排查几乎没有用到调试器，**日志里的那一条已经说明了全部问题**，只需要逐字读完它。

## source map：把压缩后的位置还原

线上跑的代码通常经过了编译和压缩，堆栈里的位置对应的是产物而不是源码：

```text
TypeError: Cannot read properties of null (reading 'scrollTop')
    at e.onScroll (index.html:2:184233)
```

第 2 行第 184233 列，这对人没有意义。source map 是一份从产物位置到源码位置的映射表，有了它就能还原出 `src/reader/scroll.ts:57:12`。

> [!WARNING]
> 本节涉及的命令行参数和构建配置（Node 的 `--enable-source-maps`、Vite 的 `build.sourcemap`、Hermes 与 Metro 的 source map 生成）在不同版本间有变化，以 nodejs.org、vite.dev、reactnative.dev 和 docs.expo.dev 对应版本的文档为准。

### Node 服务端

NestJS 用 TypeScript 编译后运行，堆栈里是 `dist/*.js` 的行号。在 `tsconfig.json` 里打开 `sourceMap`，运行时加上：

```bash
node --enable-source-maps dist/main.js
```

堆栈就会直接显示 `.ts` 文件的位置。它对抛错的性能有一些影响，对大多数服务可以忽略。在 Dockerfile 里可以写进 `NODE_OPTIONS`。

### 浏览器与 WebView

Vite 构建时设 `build.sourcemap: "hidden"`：生成 `.map` 文件，但产物里不写 `//# sourceMappingURL` 注释，用户的浏览器不会去加载它。`.map` 文件留在本地或上传到错误监控服务，排查时用它还原堆栈。

hatch-shelf 的阅读器打成了一个单文件 HTML 放进 App。线上阅读器报的错，位置都是 `index.html` 的某一行某一列。构建时把 source map 另存一份，按版本号归档，排查时就能还原。

### React Native

RN 的 Release 包里，JS 被 Hermes 编译成字节码，堆栈里的位置是字节码偏移。还原它需要两份映射合并：Metro 打包产生的 source map，和 Hermes 编译产生的 source map。Expo 和 Sentry 这类工具会帮你在构建时合并并上传，手动做需要用 RN 自带的合并脚本。

关键在于：**source map 必须和那次构建一一对应**。代码哪怕只改了一行，映射就全对不上。所以每次发版构建时就要把 map 归档，事后补生成没有用。

### 自己还原一个位置

手里有 `.map` 文件和一个位置时，可以用 `source-map` 库直接查：

```typescript
import { readFileSync } from "node:fs";
import { SourceMapConsumer } from "source-map";

const raw = JSON.parse(readFileSync("reader-1.0.3.js.map", "utf8"));
await SourceMapConsumer.with(raw, null, (consumer) => {
  console.log(consumer.originalPositionFor({ line: 2, column: 184233 }));
});
// { source: 'src/reader/scroll.ts', line: 57, column: 12, name: 'scrollTop' }
```

线上错误多的话，这件事应该交给错误监控服务自动做，见[《可观测性与性能》的错误监控一章](../observability-performance/05-error-monitoring.md)。

## 写出好读的日志

读日志难，常常是因为日志写得难读。几条写日志的原则，都是从排查时的痛苦里来的：

- **记事实和上下文，不记感想**：`导入失败 bookId=go-concurrency files=12 err=...` 而不是 `出错了！！`
- **带上 id**：请求 id、用户 id、门店 id、书 id，排查时靠它们 grep
- **错误日志带完整的错误对象**，包括 `stack` 和 `cause`，不要只记 `err.message`
- **在边界处记一笔**：请求进来、调用外部服务前后、任务开始和结束。中间过程按需
- **不记敏感信息**：密码、令牌、完整的手机号。见[《应用安全》](../app-security/)

## 本章要点

- 一次故障的日志里，先找第一条错误，再看它之前的几行
- 用请求 id 把一次请求的日志串起来，并在回包和错误提示里给出它
- 错误信息逐字读：消息里的值、错误码、地址；按错误码而不是按文字分类处理
- 堆栈从上往下找第一帧自己的代码；驱动错误常常没有你的帧，靠上下文和 `cause`
- 用户输入能触发的错误应该是 4xx，不是 500
- source map 必须和构建一一对应，在发版构建时归档；Node 用 `--enable-source-maps`，前端用 hidden source map
- 写日志时记事实、带 id、带完整错误对象，排查时才读得动

## 动手练习

1. **用 source map 还原压缩后的位置**：写一个 `scroll.ts`，用 esbuild 打包压缩并生成 source map，分别用 `node out.js` 和 `node --enable-source-maps out.js` 运行，对比堆栈。

   ```typescript
   type Page = { el: { scrollTop: number } | null };

   export function restore(page: Page, top: number) {
     page.el!.scrollTop = top;
   }

   restore({ el: null }, 120);
   ```

   ```bash
   npx esbuild scroll.ts --bundle --minify --sourcemap --platform=node --outfile=out.js
   ```

   验证：不加参数时第一帧是 `at p (.../out.js:1:<几百>)`，函数名被压缩成单个字母；加上 `--enable-source-maps` 后变成 `at restore (.../scroll.ts:4:12)`。

   参考答案：两次运行的产物完全一样，差别只在 Node 是否读取旁边的 `out.js.map`。改一行 `scroll.ts` 重新打包但不更新 map，再用旧 map 还原，位置就对不上了，这就是「map 必须和那次构建一一对应」。

2. **读出错误码**：用一次性容器起一个 Postgres（`docker run --rm -d --name pg -e POSTGRES_PASSWORD=dev postgres:17`），进 `docker exec -it pg psql -U postgres`，先执行 `\set VERBOSITY verbose`，再依次执行 `select '2026-02-30'::date;` 和 `select 'latest'::uuid;`。

   验证：两条报错分别以 `ERROR:  22008:` 和 `ERROR:  22P02:` 开头，消息里带着出问题的原值。用完 `docker stop pg`。

   参考答案：这两个就是本章案例里漏到数据库的两类输入。全局异常过滤器按 SQLSTATE 的 `22` 类别把它们映射成 400，比匹配消息文字可靠，因为消息会随版本和语言设置变。

3. **让驱动错误带上你的帧**：写一个脚本，在 `try` 里 `JSON.parse("{bad")`，在 `catch` 里 `throw new Error("解析 book.yaml 失败", { cause: err })`，用 `node` 运行。

   验证：输出先是 `Error: 解析 book.yaml 失败` 和它的堆栈，后面有一段 `[cause]: SyntaxError: ...`，两层都在。

   参考答案：外层错误的堆栈是在你的代码里创建的，带业务含义；原始错误原样保留在 `cause` 里。接日志库时检查它序列化错误时是否保留了 `cause`。
