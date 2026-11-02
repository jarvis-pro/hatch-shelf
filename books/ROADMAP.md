# 书单规划

为「将来做 OPC（一人公司）」准备的全套书：技术栈纵深、运维、AI 大模型、Agent、一人公司经营。
这份文件是**写书用的规划和进度表**，面向写书的 agent；读者看的版本是 `reading-map`（书架导读）这本书。

## 约定

- 写新书前先看这里对应条目的大纲；大纲是起点，写的时候可以调整，调整后回写本文件
- 写完一本：把状态改成「已完成」，同步更新 `reading-map/08-progress.md`，并把两者的 `updated` 日期改掉
- 案例优先取自仓库所有者自己的项目：hatch-shelf（Expo 离线书架）、hatch-counter（NestJS + Postgres + Docker 部署的门店管理）、hatch-recordwall（Expo / Electron / Cloudflare Worker 播放器）
- 每本 6–10 章，一本书一个 `content:` 提交
- 状态只有三种：未写 / 在写 / 已完成

## 写作顺序

| 批次 | 目标 | 顺序（编号） |
|---|---|---|
| 第一批 | 认知打底 | 0 → 21 → 26 → 32 → 38 → 39 → 41 → 10 → 12 |
| 第二批 | 运维上手 | 11 → 13 → 14 → 20 → 18 → 19 |
| 第三批 | AI 纵深 | 22 → 23 → 24 → 25 → 33 → 34 → 28 → 29 |
| 第四批 | OPC 商业 | 42 → 47 → 49 → 45 → 48 → 46 |
| 其余 | 按需 | 51 `ai-native-opc` 作为收尾放最后 |

---

## 导读

### 0. 书架导读 `reading-map`

- 入门 · `guide` · 状态：已完成
- 章节：怎么用这套书 · 技术栈纵深 · 运维与基础设施 · AI 大模型 · Agent 原理与个人工作流 · OPC 一人公司 · 阅读路线 · 写作进度

---

## 技术栈纵深

### 1. TS 与 Node 进阶 `ts-node-advanced`

- 进阶 · `tech/typescript` · 状态：已完成
- 只写进阶，跳过语法入门
- 章节：类型系统的集合论视角 · 泛型、条件类型与 infer 实战 · 类型体操的边界（什么时候该停） · 事件循环与 libuv · V8 编译管线与隐藏类 · 内存与 GC、泄漏排查 · Stream 与背压 · 性能剖析（--cpu-prof / clinic） · Node 直接跑 TS 与 erasableSyntaxOnly

### 2. React 19 原理与模式 `react-internals`

- 中级→进阶 · `tech/frontend` · 状态：已完成
- 章节：从 JSX 到 Fiber 树 · 调和与 diff · Hooks 的链表实现 · 并发渲染与优先级 · Suspense 与 use · Actions 与表单 · React Compiler · 状态管理选型 · 性能排查

### 3. 前端工程化与 Web 平台 `frontend-engineering`

- 中级 · `tech/frontend` · 状态：已完成
- 章节：浏览器渲染流水线 · CSS 布局与层叠 · Web Vitals 与性能 · Vite / esbuild / Rollup · pnpm workspace 与 monorepo · Tailwind 4 与设计令牌 · Radix 等 headless 组件 · ESLint / Prettier 的分工 · Vitest 与 Playwright · CORS / CSP 与前端安全

### 4. React Native 与 Expo `rn-expo`

- 中级→进阶 · `tech/mobile` · 状态：已完成
- 章节：RN 新架构（JSI / Fabric / TurboModules） · Hermes · expo-router · dev client 与 prebuild · config plugin · 写一个原生模块 · WebView 与双向桥接 · 本地存储（SQLite / 文件系统） · 性能与动画（Reanimated） · 签名、TestFlight 与上架

### 5. Electron 桌面应用 `electron-desktop`

- 中级 · `tech/desktop` · 状态：已完成
- 章节：主进程 / preload / 渲染进程 · IPC 设计 · 安全清单（contextIsolation、沙箱） · electron-vite 工程 · 原生能力与系统集成 · 打包、签名与公证 · 自动更新 · 与 Tauri 的取舍

### 6. NestJS 后端架构 `nestjs-backend`

- 中级 · `tech/backend` · 状态：已完成
- 章节：依赖注入与模块 · 请求生命周期 · 守卫、拦截器与管道 · 校验与 DTO · JWT 与权限模型 · 错误处理与错误文案 · 配置与环境变量 · 长连接（SSE / WebSocket） · 测试

### 7. 数据库原理与实战 `database-practice`

- 中级→进阶 · `tech/database` · 状态：已完成
- 开发视角；运维部分见 19 `database-ops`
- 章节：关系建模与范式 · 索引原理（B+ 树） · 执行计划 · 事务与隔离级别 · MVCC · Drizzle 与迁移 · 常见反模式 · SQLite 与本地优先 · JSON 与全文检索

### 8. 软件架构与系统设计 `system-design`

- 进阶 · `tech/architecture` · 状态：已完成
- 章节：单体与模块化单体 · 分层与边界 · 缓存策略 · 队列与异步任务 · 实时推送 · 幂等、重试与一致性 · 文件与对象存储 · 多租户 · 从 1 到 1 万用户的演进

### 9. 应用安全 `app-security`

- 中级 · `tech/security` · 状态：已完成
- 章节：认证方案对比（Session / JWT / OAuth / Passkey） · 授权模型 · OWASP Top 10 · 密码与密钥管理 · 依赖与供应链 · 移动端安全 · 日志里的敏感信息 · 安全自查清单

---

## 运维与基础设施

### 10. Linux 系统与命令行 `linux-essentials`

- 入门→中级 · `ops/linux` · 状态：已完成
- 章节：Shell 与常用命令 · 文件系统与权限 · 进程、信号与资源 · systemd 与服务管理 · journald 与日志 · 包管理 · 磁盘与挂载 · Shell 脚本 · 排障工具箱

### 11. 计算机网络 `networking`

- 入门→中级 · `ops/network` · 状态：已完成
- 章节：分层模型 · TCP 与 UDP · DNS 全链路 · HTTP/1.1 → 2 → 3 · TLS 与证书 · CDN · NAT、防火墙与端口 · 局域网与 mDNS · 排障（dig / curl / mtr / tcpdump）

### 12. 容器技术 `docker-containers`

- 中级 · `ops/container` · 状态：已完成
- 章节：容器原理（namespace / cgroup / 联合文件系统） · 镜像与分层 · Dockerfile 最佳实践 · 多阶段构建与瘦身 · 网络与存储卷 · Compose 编排 · 镜像仓库 · 容器安全

### 13. Nginx 与反向代理 `nginx-gateway`

- 中级 · `ops/network` · 状态：已完成
- 章节：配置模型与 location 匹配 · 反向代理与负载均衡 · HTTPS 与 ACME 自动续期 · 静态资源与缓存 · 限流与防刷 · WebSocket / SSE 代理 · 日志与排障 · Caddy 等替代品

### 14. 部署与 CI/CD `deploy-release`

- 中级 · `ops/deploy` · 状态：已完成
- 章节：VPS 选型与初始化 · 部署脚本 · 环境变量与密钥 · 零停机发布 · CI/CD（GitHub Actions） · 版本号与 changelog · 回滚 · 移动端与桌面端的发版

### 15. Kubernetes 入门到实战 `kubernetes`

- 中级→进阶 · `ops/container` · 状态：已完成
- 章节：K8s 解决什么问题 · 核心对象（Pod / Deployment / Service） · 配置与密钥 · 网络与 Ingress · 存储 · Helm · 用 k3s 搭单机小集群 · 什么时候不该上 K8s

### 16. 基础设施即代码 `iac-gitops`

- 进阶 · `ops/deploy` · 状态：已完成
- 章节：为什么要 IaC · Terraform / OpenTofu · Ansible 配置管理 · 密钥管理（SOPS / Vault） · GitOps 与 Argo CD · 一个人的 IaC 落地

### 17. 云与边缘 `cloud-and-edge`

- 进阶 · `ops/cloud` · 状态：已完成
- 章节：VPS / Serverless / 托管服务怎么选 · 国内云与海外云 · 对象存储 · Cloudflare Workers 运行模型 · R2 / KV / D1 / Durable Objects · wrangler 与部署 · 成本模型与账单控制

### 18. 可观测性与性能 `observability-performance`

- 中级→进阶 · `ops/sre` · 状态：已完成
- 章节：日志 · 指标与 Prometheus · 链路追踪与 OpenTelemetry · 告警设计 · 错误监控 · 可用性监控 · 压测（k6） · 瓶颈定位 · 容量规划

### 19. PostgreSQL 运维 `database-ops`

- 进阶 · `ops/database` · 状态：已完成
- 章节：安装与参数调优 · 备份与恢复 · WAL 归档与 PITR · 主从复制 · 连接池（PgBouncer） · 慢查询治理 · VACUUM 与膨胀 · 大版本升级 · 容器里跑数据库的取舍

### 20. 一人运维手册 `production-ops`

- 中级→进阶 · `ops/sre` · 状态：已完成
- 章节：服务器加固（SSH / 防火墙 / fail2ban） · 备份与容灾演练 · 事故响应流程 · 复盘 · SLO 与错误预算 · 成本控制 · 一个人的值班制度 · 运维检查清单

---

## AI 大模型

### 21. 大模型原理科普 `llm-fundamentals`

- 入门 · `ai/llm` · 状态：已完成
- 章节：从函数拟合到神经网络 · token 与 embedding · 注意力机制 · Transformer · 预训练 · SFT 与 RLHF · 推理与采样 · Scaling Law · 大模型能做什么、不能做什么

### 22. AI 数学直觉 `math-for-ai`

- 入门→中级 · `ai/ml` · 状态：已完成
- 章节：向量与矩阵 · 矩阵乘法的几何意义 · 概率与分布 · 信息论（熵、交叉熵） · 导数与梯度 · 链式法则与反向传播 · 优化与梯度下降

### 23. 面向 AI 的 Python `python-for-ai`

- 入门 · `ai/ml` · 状态：已完成
- 写给 TS 开发者
- 章节：TS 对照速学 Python · uv 与环境管理 · 类型标注与 Pydantic · NumPy · Pandas · Jupyter · 调模型 API · 写个小工具

### 24. 动手学深度学习 `deep-learning-basics`

- 中级 · `ai/ml` · 状态：已完成
- 章节：PyTorch 张量 · 感知机到多层网络 · 训练循环 · 过拟合与正则化 · 卷积网络 · 序列模型 · 手写注意力 · 从零写一个 mini-GPT

### 25. 大模型原理进阶 `llm-deep-dive`

- 进阶 · `ai/llm` · 状态：已完成
- 章节：注意力的数学推导 · 位置编码（RoPE） · KV Cache 与解码优化 · MoE · 长上下文技术 · 推理模型与思维链 · 对齐方法（RLHF / DPO / Constitutional） · 量化原理 · 可解释性

### 26. 大模型应用工程 `llm-app-engineering`

- 中级 · `ai/app` · 状态：已完成
- 章节：模型 API 与参数 · Prompt 工程 · 结构化输出 · 工具调用 · 流式输出 · Prompt 缓存 · 成本与延迟 · 模型选型 · 错误与重试

### 27. 多模态应用 `multimodal-ai`

- 中级 · `ai/app` · 状态：已完成
- 章节：视觉模型原理 · 图像预处理 · 单据识别（hatch-counter 进货单案例） · 文档理解 · 语音识别与合成 · 图像生成 · 多模态 prompt 技巧

### 28. RAG 与知识系统 `rag-systems`

- 中级→进阶 · `ai/app` · 状态：已完成
- 章节：RAG 解决什么问题 · embedding 模型 · 向量库与 pgvector · 分块策略 · 混合检索 · 重排 · 评测 · RAG 与长上下文的取舍

### 29. 评测与质量 `llm-evals`

- 进阶 · `ai/app` · 状态：已完成
- 章节：为什么要做 eval · 构建测试集 · 规则评分 · LLM-as-judge · 回归测试 · 评测 Agent 与多步任务 · 线上监控与反馈闭环

### 30. 开源模型：部署、量化与微调 `open-models`

- 中级→进阶 · `ai/llm` · 状态：已完成
- 章节：开源模型版图 · Ollama 与 llama.cpp · vLLM 推理服务 · 量化格式与取舍 · GPU 选型与租用 · 什么时候需要微调 · LoRA / QLoRA · 数据集构建 · DPO 与蒸馏

### 31. LLM 应用上线 `llmops`

- 进阶 · `ai/app` · 状态：已完成
- 章节：模型网关 · 多供应商与降级 · 限流与配额 · 成本监控 · Prompt 版本管理 · 观测与追踪 · Prompt 注入防护 · 数据合规

---

## Agent 原理与个人工作流

### 32. Agent 原理与设计 `agent-principles`

- 中级→进阶 · `ai/agent` · 状态：已完成
- 章节：什么是 Agent · agent loop · 工具与行动 · 规划与反思 · 记忆 · 上下文工程概览 · 多 agent 概览 · MCP 与 Skills · 沙箱与权限 · 常见失败模式

### 33. 上下文工程 `context-engineering`

- 进阶 · `ai/agent` · 状态：已完成
- 章节：上下文窗口是稀缺资源 · system prompt 的写法 · 记忆分层 · 压缩与摘要 · 按需检索 · Skills 的渐进式加载 · 长任务的状态管理 · 度量与调试

### 34. 工具设计与 MCP `tools-and-mcp`

- 中级→进阶 · `ai/agent` · 状态：已完成
- 章节：好工具的标准 · 工具描述与参数设计 · 错误返回 · MCP 协议 · 写一个 MCP server · 权限与认证 · 工具集的组织

### 35. 多 Agent 编排 `multi-agent`

- 进阶 · `ai/agent` · 状态：已完成
- 章节：什么时候需要多 agent · 编排模式 · 子 agent 与上下文隔离 · workflow 与确定性编排 · 并行与汇总 · 交叉验证 · 成本控制 · 案例：这套书的编排复盘

### 36. 动手构建 Agent `build-your-agent`

- 进阶 · `ai/agent` · 状态：已完成
- 章节：最小 agent loop · 接入工具 · 加上记忆 · 用 Agent SDK 重写 · 接 MCP · 评测 · 部署成常驻服务

### 37. Agent 安全 `agent-safety`

- 进阶 · `ai/agent` · 状态：已完成
- 章节：威胁模型 · Prompt 注入 · 沙箱 · 权限边界 · 人在回路 · 审计与回放 · 安全设计清单

### 38. 编码 Agent 实战 `coding-agents`

- 中级 · `ai/agent` · 状态：已完成
- 章节：编码 agent 怎么工作 · CLAUDE.md / AGENTS.md 怎么写 · rules 与按路径加载 · hooks · 子 agent 与并行 · 用 agent 管理 monorepo · 代码评审与测试 · 常见坑

### 39. 个人 Agent 工作流 `personal-agent-workflow`

- 中级 · `ai/agent` · 状态：已完成
- 章节：把工作拆成 agent 能接的活 · 日常自动化 · 个人知识库 · 定时任务 · 让 agent 写书 · 让 agent 做运维 · 工作流的迭代

### 40. AI 认知进阶 `ai-cognition`

- 中级→进阶 · `ai/agent` · 状态：已完成
- 章节：能力边界与幻觉 · 对齐与安全 · AI 原生的产品思维 · 人机分工 · 判断趋势、不被炒作带着走 · 个人在 AI 时代的位置

---

## OPC 一人公司

### 41. 一人公司方法论 `opc-playbook`

- 入门 · `opc/business` · 状态：已完成
- 章节：什么是 OPC · 选方向 · 快速验证 · 从副业到全职 · 精力与节奏 · 什么时候该放弃 · 案例拆解

### 42. 产品思维 `product-thinking`

- 入门→中级 · `opc/product` · 状态：已完成
- 章节：需求从哪来 · 用户访谈 · 问题与方案分开 · MVP 的边界 · 优先级取舍 · 把需求写下来 · 路线图 · 从反馈到迭代

### 43. 写给开发者的设计课 `design-for-devs`

- 入门 · `opc/product` · 状态：已完成
- 章节：交互原则 · 排版 · 色彩 · 间距与网格 · 设计系统 · 移动端规范 · 空态、错误态与文案

### 44. 文案与内容 `copywriting-content`

- 入门 · `opc/growth` · 状态：已完成
- 章节：产品文案 · 报错、空态与确认框 · 着陆页 · 内容营销 · 写作习惯 · 个人品牌 · 用 AI 写但不像 AI

### 45. 获客与增长 `growth-marketing`

- 中级 · `opc/growth` · 状态：已完成
- 章节：增长模型 · SEO · 社交媒体 · 社区运营 · ASO · 冷启动 · 留存 · 渠道评估

### 46. 数据分析与埋点 `product-analytics`

- 中级 · `opc/growth` · 状态：已完成
- 章节：要看哪些指标 · 埋点设计 · 埋点实现 · 留存、转化与 LTV · 漏斗分析 · A/B 测试 · 自托管 PostHog / Umami · 什么时候不该埋点

### 47. 定价与商业模式 `pricing-monetization`

- 中级 · `opc/business` · 状态：已完成
- 章节：商业模式 · 订阅、买断与内购 · 定价心理 · 价格实验 · 支付接入（国内） · App Store 内购 · 退款与客诉 · 案例：给门店 SaaS 定价

### 48. 财务与税务 `opc-finance`

- 入门→中级 · `opc/legal` · 状态：已完成
- 章节：记账基础 · 税种与申报 · 发票 · 现金流 · 个人与公司的钱分开 · 记账工具与代账

### 49. 国内合规实务 `opc-compliance-cn`

- 中级 · `opc/legal` · 状态：已完成
- 章节：主体选择（个体户 / 一人有限公司） · 注册流程 · ICP 备案与经营许可 · App 备案 · 软件著作权 · 个人信息保护法 · 生成式 AI 相关规定 · 上架资质

### 50. 出海实务 `going-global`

- 中级 · `opc/legal` · 状态：已完成
- 章节：出海全景 · 海外主体 · Stripe 与海外收款 · App Store 海外区 · GDPR 与隐私政策 · 海外云与域名 · 税务与汇款

### 51. 用 AI 撑起一人公司 `ai-native-opc`

- 进阶 · `opc/business` · 状态：已完成
- 全书单的收尾，串起前面所有系列
- 章节：AI 原生的一人公司 · 研发 · 客服 · 运营与内容 · 营销 · 财务与行政 · 自动化流水线 · 一个人的组织设计 · 结语
