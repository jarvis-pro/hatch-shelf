# 技术栈纵深

这个系列的出发点是你**已经在用**的技术：TypeScript、React、Expo、Electron、NestJS、Postgres。目标不是从零学，而是把「能写出来」升级到「知道为什么这么写、出了问题知道往哪查」。

TS 与 Node 你已经熟练，所以只保留一本进阶书。

## 语言与运行时

### TS 与 Node 进阶 · `ts-node-advanced`

跳过语法入门，直接讲类型系统的本质、事件循环和 V8 的工作方式、内存泄漏怎么查、Stream 的背压，以及 Node 直接跑 TS 背后的取舍。读完它，你遇到「类型写不出来」和「进程越跑越慢」这两类问题时，会知道从哪里下手。

## 前端与客户端

### React 19 原理与模式 · `react-internals`

从 Fiber 讲到并发渲染、Suspense、Actions 和 React Compiler。读懂了调和机制，大部分性能问题和「为什么又重渲染了」的疑惑都会迎刃而解。

### 前端工程化与 Web 平台 · `frontend-engineering`

一半讲浏览器（渲染流水线、CSS、Web Vitals、CORS / CSP），一半讲工程（Vite、pnpm workspace、Tailwind 4、headless 组件、测试）。它对应 hatch-counter 网页端的整条工具链。

### React Native 与 Expo · `rn-expo`

RN 新架构、expo-router、config plugin、原生模块、WebView 桥接，一直讲到 TestFlight 上架。这本书离你最近，hatch-shelf 和 hatch-recordwall 的大部分坑都会在这里出现。

### Electron 桌面应用 · `electron-desktop`

三进程模型、IPC 与安全、签名公证、自动更新。最后一章比较 Electron 与 Tauri，帮你判断下一个桌面项目该选哪个。

## 服务端与数据

### NestJS 后端架构 · `nestjs-backend`

讲清依赖注入和请求生命周期，再讲守卫、拦截器、权限模型和长连接。对应 hatch-counter 的 `apps/api`。

### 数据库原理与实战 · `database-practice`

只讲开发视角：建模、索引、执行计划、事务与 MVCC、Drizzle 迁移，以及 SQLite 的本地优先用法。线上运维那部分放在运维系列的《PostgreSQL 运维》。

## 架构与安全

### 软件架构与系统设计 · `system-design`

一个人做的系统不需要微服务，但需要清楚的边界。这本书从模块化单体讲起，讲缓存、队列、幂等和多租户，最后推演一个系统从 1 个用户长到 1 万个用户的过程。

### 应用安全 · `app-security`

一人公司没有安全团队，出事就是你一个人的事。这本书讲认证方案对比、OWASP Top 10、密钥管理和供应链安全，最后给一份可以直接对照的自查清单。
