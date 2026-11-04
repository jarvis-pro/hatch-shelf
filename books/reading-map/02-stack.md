# 技术栈纵深

这个系列的出发点是你**已经在用**的技术：TypeScript、React、Expo、Electron、NestJS、Postgres。目标不是从零学，而是把「能写出来」升级到「知道为什么这么写、出了问题知道往哪查」。

TS 与 Node 你已经熟练，所以只保留一本进阶书。

## 语言与运行时

### [TS 与 Node 进阶](../ts-node-advanced/) · `ts-node-advanced`

跳过语法入门，直接讲类型系统的本质、事件循环和 V8 的工作方式、内存泄漏怎么查、Stream 的背压，以及 Node 直接跑 TS 背后的取舍。读完它，你遇到「类型写不出来」和「进程越跑越慢」这两类问题时，会知道从哪里下手。

## 前端与客户端

### [React 19 原理与模式](../react-internals/) · `react-internals`

从 Fiber 讲到并发渲染、Suspense、Actions 和 React Compiler。读懂了调和机制，大部分性能问题和「为什么又重渲染了」的疑惑都会迎刃而解。

### [前端工程化与 Web 平台](../frontend-engineering/) · `frontend-engineering`

一半讲浏览器（渲染流水线、CSS、Web Vitals、CORS / CSP），一半讲工程（Vite、pnpm workspace、Tailwind 4、headless 组件、测试）。它对应 hatch-counter 网页端的整条工具链。

### [React Native 与 Expo](../rn-expo/) · `rn-expo`

RN 新架构、expo-router、config plugin、原生模块、WebView 桥接，一直讲到 TestFlight 上架。这本书离你最近，hatch-shelf 和 hatch-recordwall 的大部分坑都会在这里出现。

### [Electron 桌面应用](../electron-desktop/) · `electron-desktop`

三进程模型、IPC 与安全、签名公证、自动更新。最后一章比较 Electron 与 Tauri，帮你判断下一个桌面项目该选哪个。

## 服务端与数据

### [NestJS 后端架构](../nestjs-backend/) · `nestjs-backend`

讲清依赖注入和请求生命周期，再讲守卫、拦截器、权限模型和长连接。对应 hatch-counter 的 `apps/api`。

### [数据库原理与实战](../database-practice/) · `database-practice`

只讲开发视角：建模、索引、执行计划、事务与 MVCC、Drizzle 迁移，以及 SQLite 的本地优先用法。线上运维那部分放在运维系列的[《PostgreSQL 运维》](../database-ops/)。

## 架构与安全

### [软件架构与系统设计](../system-design/) · `system-design`

一个人做的系统不需要微服务，但需要清楚的边界。这本书从模块化单体讲起，讲缓存、队列、幂等和多租户，最后推演一个系统从 1 个用户长到 1 万个用户的过程。

### [应用安全](../app-security/) · `app-security`

一人公司没有安全团队，出事就是你一个人的事。这本书讲认证方案对比、OWASP Top 10、密钥管理和供应链安全，最后给一份可以直接对照的自查清单。

## 工程基本功

这一组是每个项目都用得上、却很少有人系统学过的几块。

### [计算机系统基础](../computer-systems/) · `computer-systems`

数据怎么表示、CPU 和内存怎么配合、进程与线程、I/O 模型、fsync 和页缓存。它是其他技术书的地基：Number 精度、事件循环、数据库为什么要刷盘，答案都在这一层。

### [Git 深入](../git-deep-dive/) · `git-deep-dive`

从对象模型讲起，讲合并与变基、用 reflog 救回丢掉的提交、用 bisect 找出引入 bug 的那次改动，最后讲 hooks、大仓库和签名。

### [测试工程](../testing-engineering/) · `testing-engineering`

一个人没有 QA，测试就是你的安全网。这本书讲测什么、不测什么，从 Vitest 单元测试、真实数据库的集成测试一直讲到 Playwright 端到端和移动端测试，最后给出一个人能长期坚持的测试策略。

### [调试与问题排查](../debugging-methods/) · `debugging-methods`

把排查当成科学实验来做：稳定复现、二分定位、读堆栈、用调试器和火焰图，再到线上无法复现的问题。每章都有一个完整的排查故事。

## 后端进阶

### [API 设计](../api-design/) · `api-design`

资源建模、错误格式、分页、版本演进、幂等和 Webhook。App 老版本还在用的时候，接口怎么改才不出事，这本书给出具体规则。

### [账号与支付工程](../auth-payments/) · `auth-payments`

《应用安全》讲认证方案怎么选，《定价与商业模式》讲怎么收钱，这本讲怎么实现：账号数据模型、验证码和第三方登录、Passkey、微信支付与支付宝、内购校验、订阅状态机和对账。

### [Redis 与后台任务](../redis-jobs/) · `redis-jobs`

《软件架构与系统设计》讲缓存和队列的取舍，这本讲落地：Redis 的缓存、限流和锁，BullMQ 和用 Postgres 做队列，以及定时任务、重试和死信。

## 第二语言

### [Go 语言实战](../go-practice/) · `go-practice`

写给 TS 开发者。用 Go 写 CLI、小服务和运维工具，最后编译成一个二进制文件，放进最小镜像。

### [Rust 实用入门](../rust-practice/) · `rust-practice`

写给 TS 开发者。所有权和生命周期讲透之后，用 Rust 写 CLI、做 Tauri 桌面应用、编译 WASM 和 Node 原生扩展。
