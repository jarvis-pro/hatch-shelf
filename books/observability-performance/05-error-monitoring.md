# 错误监控

日志里能找到每一个错误，但日志回答不了这几个问题：今天报错的有多少种？哪一种是这次发版新出现的？同一个错误影响了多少个用户？手机 App 里崩溃的那一下，堆栈是什么？

**错误监控**专门处理异常：把每一次异常连同堆栈、上下文、版本号收集起来，**把同一个 bug 引起的成百上千次异常归成一个「问题」**，告诉你它第一次出现在哪个版本、影响了多少人、最近是在变多还是变少。这一章讲错误监控的工作方式、Sentry 生态与自托管选择，以及在 NestJS、React、Expo 里怎么接。

## 它和日志有什么不同

| | 日志 | 错误监控 |
|---|---|---|
| 粒度 | 每一行 | 按「问题」聚合，同一堆栈归为一组 |
| 客户端 | 收不到（除非自己做上报） | 浏览器、手机、桌面端的异常都能收 |
| 版本关联 | 要自己在日志里带版本号 | 内置：哪个版本首次出现、哪个版本修好 |
| 堆栈可读性 | 打包压缩后的堆栈不可读 | 上传 source map 后还原到源码行 |
| 通知 | 需要另配告警 | 内置：新问题、回归、激增时通知 |

最大的区别在**客户端**。服务端出错你至少还有日志；用户手机上的 App 白屏了、按钮点了没反应，如果没有错误监控，你唯一的信息来源就是用户愿不愿意告诉你。

## Sentry 生态与自托管

这个领域事实上的标准是 **Sentry**：SDK 覆盖几乎所有语言和平台，协议是公开的。选择大致有三种：

| 方案 | 特点 | 适合 |
|---|---|---|
| Sentry 官方托管 | 功能最全，有免费额度（以官网当前定价为准） | 不想维护，用户数据可以出境 |
| 自托管 Sentry | 功能完整，但依赖 Kafka、ClickHouse、Redis 等一大堆组件，官方建议的机器配置远超一台小 VPS | 不推荐一个人跑 |
| GlitchTip | 开源，兼容 Sentry 的 SDK 和协议；只需 Postgres + Redis（或更少），一台小机器就能跑 | 自托管首选 |

**GlitchTip** 对一人项目最合适：代码里用的就是官方 Sentry SDK，只是把 DSN 指向自己的 GlitchTip 实例。将来想换到 Sentry 官方托管，改一个 DSN 就行。它不支持 Sentry 的全部高级功能（如会话回放），但错误聚合、堆栈还原、版本追踪、通知这些核心功能都有。

用户在国内、数据不宜出境时，自托管还有合规上的意义：错误上报里难免带着 URL、设备信息甚至部分业务数据。

### 部署 GlitchTip

GlitchTip 官方提供了 Docker Compose 示例文件，包含 web、worker、Postgres、Redis 几个服务。按官方示例部署，注意：

- 可以复用业务的 Postgres 实例，单独建库和角色；也可以用独立实例，隔离性更好
- 它需要一个对外可访问的 HTTPS 地址，浏览器和手机才能上报。在 nginx 上给它配一个子域名（见[《Nginx 与反向代理》](../nginx-gateway/)）
- 关闭开放注册，只留自己的账号
- 设置事件保留天数，避免数据库无限增长

具体环境变量名和服务结构以 GlitchTip 官方文档为准。

## 服务端：NestJS

Sentry 的 Node SDK 提供了 NestJS 专用包 `@sentry/nestjs`：

```bash
pnpm add @sentry/nestjs
```

和 OpenTelemetry 一样，初始化必须早于其他模块加载：

```ts
// src/instrument.ts
import * as Sentry from "@sentry/nestjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  // 和发版流程里的版本号一致，才能对上 source map、看出「哪个版本引入的」
  release: process.env.APP_VERSION,
  // 只收错误，不收性能数据：性能交给第 2、3 章的工具，省额度也省存储
  tracesSampleRate: 0,
  // 默认不收 IP、cookie 等个人信息，保持这样
  sendDefaultPii: false,
  beforeSend(event) {
    // 最后一道过滤：请求头里的令牌无论如何不上报
    if (event.request?.headers) {
      delete event.request.headers.authorization;
      delete event.request.headers.cookie;
    }
    return event;
  },
});
```

```ts
// src/main.ts，第一行
import "./instrument";
import { NestFactory } from "@nestjs/core";
// ……
```

```ts
// app.module.ts
import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { SentryGlobalFilter, SentryModule } from "@sentry/nestjs/setup";

@Module({
  imports: [SentryModule.forRoot() /* , 其他模块 */],
  providers: [{ provide: APP_FILTER, useClass: SentryGlobalFilter }],
})
export class AppModule {}
```

如果你已经有自己的全局异常过滤器（hatch-counter 的 `AppExceptionFilter` 就是），不用 `SentryGlobalFilter`，而是在自己的过滤器里决定哪些异常要上报：

```ts
import * as Sentry from "@sentry/nestjs";

// 在过滤器处理「没认领的异常」那个分支里
const ref = randomBytes(4).toString("hex");
this.logger.error(`[${ref}] ${withCauses(err)}`);
Sentry.captureException(err, { tags: { ref } });   // 把同一个编号带进去，日志和错误监控能互查
reply(500, "服务端出了点问题，稍后再试", undefined, ref);
```

**只上报真正的 bug**。业务校验失败（400）、未登录（401）、无权限（403）、限流（429）都是预期内的结果，上报了只会淹没真正的问题。原则和日志级别一样：需要改代码的才上报。

SDK 的具体 API 在大版本之间有变化，以 Sentry 官方文档里 NestJS 那一页的当前写法为准。

## 前端：React + Vite

```bash
pnpm add @sentry/react
pnpm add -D @sentry/vite-plugin
```

```ts
// src/main.tsx
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  release: import.meta.env.VITE_APP_VERSION,
  environment: import.meta.env.MODE,
});
```

DSN 会被打进前端代码，这没关系：它只能用来**上报**，不能读取数据。真正要保护的是上传 source map 用的认证令牌，它只存在于 CI 或本机的环境变量里。

### source map：让堆栈可读

生产构建的 JS 是压缩过的，堆栈长这样：

```text
TypeError: Cannot read properties of undefined (reading 'qty')
    at e (index-Bf3k2a.js:1:48213)
```

上传 source map 后，错误监控平台能还原成：

```text
TypeError: Cannot read properties of undefined (reading 'qty')
    at PurchaseRow (src/pages/purchases/PurchaseRow.tsx:42:18)
```

Vite 插件在构建时上传 source map，上传后删除本地的 `.map` 文件，避免把源码公开部署出去：

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";

export default defineConfig({
  build: { sourcemap: "hidden" },   // 生成 .map，但产物里不写 sourceMappingURL 注释
  plugins: [
    react(),
    sentryVitePlugin({
      url: process.env.SENTRY_URL,           // 自托管 GlitchTip 的地址
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: { name: process.env.VITE_APP_VERSION },
      sourcemaps: { filesToDeleteAfterUpload: ["dist/**/*.map"] },
    }),
  ],
});
```

GlitchTip 对 source map 上传的支持程度和配置方式与 Sentry 官方略有差异，以 GlitchTip 文档为准。

## 移动端与桌面端

| 平台 | SDK | 要点 |
|---|---|---|
| Expo / React Native | `@sentry/react-native`，提供 Expo config plugin | 需要 dev client 或正式构建，Expo Go 里不完整；JS 的 source map 和原生的符号文件都要上传 |
| Electron | `@sentry/electron` | 主进程和渲染进程分别初始化；原生崩溃通过 minidump 上报 |

早期的 `sentry-expo` 包已被弃用，Expo 项目直接用 `@sentry/react-native`，按 Expo 官方文档里错误上报那一页接入。

客户端错误监控有一条重要的约束：**上报需要联网，需要用户知情**。

- 在隐私政策里写明收集了哪些崩溃和设备信息、发往哪里
- 上架国内应用商店时，SDK 收集设备信息属于个人信息处理的范畴，相关要求会变，以最新的监管规定和商店审核要求为准
- 有的产品原则上就**不联网**。比如 hatch-shelf 是离线书架，设计上除了局域网传书不发起任何网络请求，它就不应该接任何错误上报 SDK。这类 App 的替代做法是把错误写进本地日志文件，在设置页提供「导出诊断信息」，由用户主动通过 AirDrop 或邮件发给你

## 用好错误监控

### 版本与发版联动

把发版流程里的版本号（见[《部署与 CI/CD》](../deploy-release/)版本号一章）传给 `release`，就能得到：

- 每个问题的「首次出现版本」：发版后新冒出来的问题，大概率就是这次改动引入的
- 回归检测：标记为「已解决」的问题在新版本里又出现，会重新打开并通知你

### 分组不准时手动调整

错误监控默认按堆栈分组。两种常见的分组失误：

- **同一个问题被拆成很多组**：错误消息里带了变量（`用户 42 不存在`、`用户 43 不存在`）。把变量放进上下文字段，消息保持固定
- **不同问题被合成一组**：所有错误都经过同一个封装函数抛出，堆栈顶部一模一样。用 `fingerprint` 或在 SDK 里设置自定义分组键

### 通知规则

只为三类事件发通知：

1. **新问题**：从未见过的错误第一次出现
2. **回归**：已解决的问题再次出现
3. **激增**：某个问题在短时间内次数陡增

其余的每周花十分钟浏览一次，按影响用户数排序处理。这和第 4 章的告警原则一样：通知必须稀少，才会被认真对待。

### 忽略噪音

浏览器端会收到大量与你无关的错误：浏览器插件注入的脚本报错、网络断开导致的 `Failed to fetch`、老旧浏览器不支持某个 API。用 SDK 的 `ignoreErrors`、`denyUrls` 过滤掉，或者在平台上把它们标记为忽略。

## 本章要点

- 错误监控把异常按问题聚合，关联版本，能收客户端崩溃，这是日志做不到的
- 自托管首选 GlitchTip：兼容 Sentry SDK，资源占用小；自托管完整版 Sentry 不适合一台小 VPS
- 初始化早于其他模块；有自定义异常过滤器时只上报 500 类真 bug，并带上与日志相同的错误编号
- 前端上传 source map 后删除本地 `.map`；DSN 可以公开，上传令牌不能
- 移动端用 `@sentry/react-native`；客户端上报要在隐私政策里说明；本身不联网的 App 用本地诊断导出代替
- 只为新问题、回归、激增发通知，`release` 必须和发版版本号一致

## 动手练习

1. **亲手还原一次压缩后的堆栈**：在空目录里写 `src.js`，让第 3 行访问 `undefined.qty`；用 `npx esbuild src.js --bundle --minify --platform=node --sourcemap --outfile=out.js` 打包，分别用 `node out.js` 和 `node --enable-source-maps out.js` 运行。

   验证：第一次堆栈指向 `out.js:1:` 加一个列号；第二次指向 `src.js:3`。

   参考答案：source map 记录了压缩后位置到源码位置的映射，错误监控平台做的就是 `--enable-source-maps` 这件事，只不过在服务端做。

2. **确认 .map 没有被公开引用**：把上一题的 `--sourcemap` 换成 `--sourcemap=external` 再打包一次，比较两次产物末尾。

   验证：`tail -c 100 out.js` 在第一次能看到 `//# sourceMappingURL=out.js.map`，第二次没有这一行，但 `out.js.map` 文件仍然生成了。

   参考答案：这和 Vite 的 `sourcemap: "hidden"` 是同一个意思：生成 map 供上传，但产物里不指向它。上传后再删掉本地 `.map`，线上就拿不到源码。

3. **判断哪些该上报**：下面六个异常，哪些应该 `captureException`？(a) 表单校验失败回 400；(b) 令牌过期回 401；(c) 触发限流回 429；(d) `TypeError: Cannot read properties of undefined (reading 'qty')`；(e) 数据库 `ECONNREFUSED` 导致回 500；(f) 第三方识别接口第一次超时、重试后成功。

   验证：对照本章「只上报真正的 bug」的原则，答案应该只有两项。

   参考答案：只报 (d) 和 (e)。(a)(b)(c) 是预期内的业务结果；(f) 已经自愈，记一条 warn 日志即可，持续失败要靠指标里的失败率发现。另外，错误消息里如果写成「用户 42 不存在」，每个 ID 会被分成一组，变量要放进上下文字段。
