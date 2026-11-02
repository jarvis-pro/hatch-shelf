# 待复核清单

前 52 本书由并行写书 agent 写成（2026-11-02），第五批 6 本（编号 52–57）写于 2026-11-03，存疑点集中在第七节。这里汇总了各 agent 交稿时自己标出的「拿不准、需要人复核」的点，以及主会话核对时发现的问题。

- 已经由主会话核对过、确认无误的点不再列出
- 复核完一条就把 `[ ]` 改成 `[x]`；需要改书时，改完更新该书 `book.yaml` 的 `updated`
- 编号格式：`书 id 第 N 章`

## 一、优先复核：法规、合规与财税

这些内容一旦出错会影响实际决策。书里都只讲框架、没写金额和条款号，并提示以官方最新规定为准，但以下几处的依据较弱。

- [ ] `opc-compliance-cn` 第 7 章：调用已备案模型走属地网信部门登记、需公示模型名称和备案号；AI 生成合成内容标识办法与 GB 45438-2025 于 2025-09-01 施行。主要依据是媒体和律所资料，没找到官方原文
- [ ] `opc-compliance-cn` 第 7 章：hatch-counter 用视觉模型识别单据是否需要做生成式 AI 登记，书中按「边界情形，向属地网信部门确认」处理
- [ ] `opc-compliance-cn` 第 1 章、`opc-finance` 第 5 章：新《公司法》一人公司股东自证财产独立、认缴出资五年内缴足（凭记忆，未见条文原文）
- [ ] `opc-compliance-cn` 第 2 章：市场主体年报时限 1 月 1 日至 6 月 30 日
- [ ] `opc-compliance-cn` 第 4 章：App 备案的依据写了《反电信网络诈骗法》；App 内是否必须展示备案号
- [ ] `opc-compliance-cn` 第 8 章、`growth-marketing` 第 5 章：App Store 中国大陆区要求填 ICP / App 备案信息（来源是 2023–2024 年的报道）
- [ ] `opc-finance` 第 2 章：企业所得税汇算一般次年 5 月底前、经营所得个税汇算一般次年 3 月底前
- [ ] `opc-finance` 第 3 章：小规模纳税人可以自行开具专用发票
- [ ] `opc-finance` 第 5 章：股东借款到年终既不归还又未用于经营，可能被视同分红征个税
- [ ] `opc-finance` 第 6 章：向境外支付服务费的代扣代缴义务；App Store 佣金无国内发票时的扣除凭证（书里只提示「问代账」）
- [ ] `opc-playbook` 第 4 章：竞业限制需给补偿且有期限上限、职务成果归属、主动辞职一般领不到失业金
- [ ] `pricing-monetization` 第 6 章：App Store 佣金框架（30%、小型企业计划 15%、订阅满一年降费、美 / 欧 / 日 / 韩地区规则），以及审核指南 3.1 节三类例外的概述（凭记忆）
- [ ] `pricing-monetization` 第 7 章：七日无理由退货对数字化商品的例外、自动续费监管方向；第 4 章：个人信息保护法对自动化决策价格差别待遇的约束
- [ ] `going-global` 第 2 章：美国 BOI 申报 2025 年 FinCEN 规则调整；外国人持有的单一成员 LLC 每年报 Form 5472 + 形式上的 Form 1120
- [ ] `going-global` 第 3 章：Stripe 截至写作时不支持中国大陆商户直接开户；Lemon Squeezy 2024 年被 Stripe 收购
- [ ] `going-global` 第 4 章：Apple DSA 交易者声明会在欧盟区公开开发者联系信息；Google Play 在中国大陆能否开设收款资料
- [ ] `going-global` 第 7 章：个税法第一、七、八、十三条，《个人外汇管理办法》（人民银行令〔2006〕第 3 号），汇发〔2014〕37 号的引用
- [ ] `multimodal-ai` 第 5、6 章，`llmops` 第 8 章，`copywriting-content` 第 3、7 章，`ai-cognition`：生成式 AI 管理办法、深度合成、声音克隆、广告法、AI 内容标注的框架性描述

## 二、你项目里的改进项（各书顺带发现）

不是书的错误，是写书时读代码发现的，按需处理。

### hatch-counter

- [ ] 最终镜像没有 `USER`，以 root 运行（`docker-containers` 第 3、8 章）
- [ ] 运行阶段的镜像带着开发依赖和 `src/`，原因是迁移要用 tsx 跑源码（`docker-containers` 第 4 章）
- [ ] 备份只靠云盘快照，建议补每日 `pg_dump` + 磁盘告警 + 定期恢复演练（`production-ops` 第 2 章、`database-ops` 第 2、9 章）
- [ ] 配色对比度不到 WCAG AA：浅色成功绿 4.05、信息青 3.94、深色主按钮白字 3.48、占位字 2.77、品牌淡底上的品牌色字 3.86（`design-for-devs` 第 3 章）
- [ ] CLAUDE.md 写着「shell 命令看文件不触发路径 rules」，但现行 Claude Code 文档说对单个文件 `cat` / `head` 也会触发（`coding-agents` 第 3 章，书里两种说法都写了）
- [ ] 以后加 AI 查询功能时，不要让模型直接写 SQL：它可以自己 `set_config` 换掉门店 id，RLS 会失效（`agent-safety` 第 4 章）
- [ ] `RawScan` 字段名（`receiptDate`、`totalAmountCents`、`rawName`）是从 `vlm.ts` 推断的，没核对 `@counter/core` 的类型（`llm-evals`）
- [ ] 还没有用户协议和隐私政策，`docs/操作/发布移动端.md` 里只计划放进 `apps/site`（`contracts-legal` 第 3 章）
- [ ] 到期或删店后数据一直保留（软删除），「彻底删除」不删对象存储里的单据原图和凭证；合同若写「终止后若干天删除」，代码要先补到期清理（`contracts-legal` 第 2 章）
- [ ] 变更流水 90 天后压成按月计数，短于三年诉讼时效，举证时可能查不到明细（`contracts-legal` 第 7 章）
- [ ] 「它现在处于阶段 1：问题验证」是只看仓库推出来的；路线图里有收口老客户端、桌面端退役，可能已有真实用户，请核对第 2 章的现状盘点表，以及拿提交记录举「产品走在验证前面」的例子是否合适（`opc-action-plan` 第 2、9 章）
- [ ] 销售话术里「数据在境内服务器、传输加密」没逐项核对；演示前导入老板报表的流程、标准交付 2 小时都没在真实系统里走过（`b2b-sales` 第 5、6、8 章）

### hatch-recordwall

- [ ] Electron：IPC 不校验发送方；`net:fetch` 接受任意 URL；只读令牌经 preload 交给了页面（`electron-desktop` 第 3 章，请确认书中表述是否合适）
- [ ] 还在用 Reanimated 已废弃的 `runOnJS`，新写法是 `scheduleOnRN`（`rn-expo` 第 9 章）

### hatch-shelf

- [ ] 护眼主题次要文字对比度 4.44，略低于 AA 的 4.5（`design-for-devs` 第 3 章）
- [ ] 三个仓库都还在 pnpm 9.15；`minimumReleaseAge`、默认不跑依赖安装脚本等供应链防护需要 pnpm 10（`app-security` 第 5 章）

## 三、版本敏感的 API 与工具细节

变化快，按需在用到时核对官方文档。

### Claude / Anthropic

- [ ] `llm-app-engineering`：API 版本 2026-10-21 起 Messages 拒绝 `temperature` / `top_p` / `top_k`；Opus 5.5 / Sonnet 5.5 不支持强制 `tool_choice` 和预填充；effort 默认 `medium`；缓存倍数（5 分钟写 1.25×、1 小时写 2×、读约 0.1×）；批处理半价；SDK 默认重试 2 次；`web_search_20260209`
- [ ] `llm-app-engineering` 第 4、5、9 章：`err.headers` 形态、`client.beta.messages.toolRunner`、`stream.abort()` 未编译验证
- [ ] `context-engineering`：beta 写法 `context-management-2025-06-27` / `clear_tool_uses_20250919`、`compact-2026-01-12` / `compact_20260112`、`memory_20250818`、`defer_loading`、对话中途的 system 消息；`Anthropic.MessageCountTokensParams` 类型名
- [ ] `build-your-agent` 第 3 章：`pause_after_compaction` 后以 `stop_reason: "compaction"` 暂停（从类型定义推断）；第 1 章成本图用的 2026-10 价目
- [ ] `build-your-agent` 第 4 章：Agent SDK 0.3.316 的 `tool()` 用 zod 原始形状、依赖 `@modelcontextprotocol/sdk` 1.x 作 peer
- [ ] `multimodal-ai`：图片 token「宽×高÷750」；PDF 限制 32MB / 600 页
- [ ] `rag-systems` 第 6 章：Claude API 原生 citations 的描述
- [ ] Claude Code 参数和字段：`-p`、`--output-format json`、`--allowedTools`、`--max-turns`、`--append-system-prompt`，JSON 里的 `total_cost_usd` / `num_turns` / `is_error`（`personal-agent-workflow`、`llm-evals` 第 6 章、`multi-agent` 第 4 章、`ai-native-opc` 第 7 章）
- [ ] Claude Code 配置：权限规则 `Bash(cmd:*)` / `Read(**/.env*)` / `Edit(./.claude/**)` 写法、Skills 目录与 frontmatter、hooks 的 `tool_response`、沙箱模式、会话转录位置（`agent-principles` 第 8、9 章，`agent-safety`，`personal-agent-workflow`）
- [ ] `tools-and-mcp`：输出 10k token 警告、25k 默认上限、工具搜索默认开启；`pnpm --silent` 在 `.mcp.json` 里能保持 stdout 干净

### MCP

- [ ] `tools-and-mcp` 第 4 章：MCP 规范 2026-07-28 改为无状态（无 `initialize`、每个请求带 `_meta`、`server/discover`、结果带 `resultType`），Roots / Sampling / Logging 废弃。建议再对一次官方规范
- [ ] `tools-and-mcp` 第 6 章：多用户 OAuth 的具体 API（书里只讲概念）

### 前端与移动端

- [ ] `rn-expo`：Gesture Handler 3 Hook API（`usePanGesture`、`onDeactivate`）；Reanimated 4 CSS 过渡写法；Expo Babel 预设自动配置 worklets 插件；免费账号 7 天描述文件；Hermes V1 默认开启、app config 已无 `jsEngine`
- [ ] `react-internals`：lanes 位布局、Scheduler 约 5ms 时间片、Suspense 约 300ms 节流（源码细节）；React Router 7 默认把导航包在 `startTransition` 里；form action 失败后也会重置非受控字段；ESLint 插件预设名 `recommended` / `recommended-latest`
- [ ] `frontend-engineering`：ESLint 10 移除 eslintrc；Tailwind 4 浏览器线 Safari 16.4 / Chrome 111 / Firefox 128；pnpm catalog 从 9.5 起；Vitest 4 浏览器模式稳定；INP 于 2024 年 3 月取代 FID 及三项阈值
- [ ] `design-for-devs`：`Appearance.setColorScheme("unspecified")` 起始版本；Tailwind 4 `--text-*--font-weight` 写法；Nielsen 响应时间三档的出处
- [ ] `electron-desktop`：electron-builder 公证环境变量名（如 `APPLE_API_ISSUER`）；electron-vite 5 是否默认外部化依赖；`@electron/fuses` 的 `resetAdHocDarwinSignature`；`webUtils.getPathForFile`；「不签名在 Apple 芯片上不能稳定运行」「签名未公证也能自动更新」是推断
- [ ] `growth-marketing` 第 7 章：`expo-notifications` 的 `SchedulableTriggerInputTypes.DAILY` 在 SDK 58 是否适用
- [ ] `multimodal-ai` 第 2 章：expo-image-manipulator 对象式 API；sharp 预编译版不带 HEIC 解码

### 后端与 Node

- [ ] `nestjs-backend`：NestJS 12 新 API 均未在真实项目跑过（`@Body({ schema })` + `StandardSchemaValidationPipe`、`HttpExceptionOptions.errorCode`、生命周期钩子按层级调用、ESM 发布及 Node 版本要求、@nestjs/config 改用 Standard Schema、`handleDisconnect` 拿断开原因、ESM 项目默认 Vitest）；`process.loadEnvFile()` 起始版本
- [ ] `ts-node-advanced`：Node 类型擦除版本节点（22.6 加参数、23.6 默认开启、22.18 移植回 22）；字节流 highWaterMark 之前是 16 KiB；Maglev 在新版 Node 是否默认开启；Clinic.js 维护状态；VS Code 火焰图扩展
- [ ] `observability-performance`：Promtail 已弃用改用 Alloy；Alertmanager `telegram_configs.bot_token_file`；Jaeger 2.x 镜像名；postgres.js 不在 OTel 自动埋点列表；`@sentry/nestjs/setup` 导入写法；GlitchTip 的 source map 支持；k6 原生支持 TS；exporter 指标名
- [ ] `system-design`：Express 默认弱 ETag；NOTIFY 载荷上限与同事务合并；`SET LOCAL` 的自定义 GUC 事务后回到空字符串；AWS SDK v3 默认校验和与 S3 兼容服务的兼容性

### 数据库

- [ ] `database-ops`：PG18 镜像挂载点与 PGDATA 变化；PG18 的 EXPLAIN 默认 BUFFERS、initdb 默认校验和、pg_upgrade 保留统计、pg_verifybackup 支持 tar；容器内 trust 认证；Alpine 镜像 postgres uid 70；PgBouncer 1.21 起事务模式支持预备语句；Drizzle 迁移器在事务里执行（`CREATE INDEX CONCURRENTLY` 会报错）；PG16 参数默认值
- [ ] `database-practice`：PG18 内置 `uuidv7()`、B 树跳跃扫描；PG11 加常量默认值列只改元数据；PG12 起 `ALTER TYPE ADD VALUE` 可在事务内；预备语句前 5 次用 custom plan；SQLite 3.34 trigram、3.35 DROP COLUMN、3.37 STRICT；zhparser / pg_jieba 的托管支持情况
- [ ] `rag-systems` 第 3 章：`pgvector/pgvector:pg16` 镜像标签；HNSW 从 0.5.0、并行构建从 0.6.0；Drizzle `generatedAlwaysAs` 引用自身表列、`customType` tsvector 写法

### 运维工具

- [ ] `linux-essentials`：Debian 12 默认不装 rsyslog、journal 默认持久化；systemd 默认值（10 秒 5 次、RestartSec 100ms、停止超时 90 秒）；Docker 23 起 `volume prune` 默认只清匿名卷；Node 25 后不再内置 corepack；Ubuntu 24.04 deb822 与 logrotate.timer；sshd_config.d 先出现的值生效
- [ ] `production-ops`：Ubuntu 22.10 起 ssh.socket 按需拉起；restic S3 后端需删除锁文件；Compose 不自动重启 unhealthy 容器；fail2ban `bantime.increment` 与 `nginx-limit-req`
- [ ] `networking`：iOS 本地网络权限的触发条件与 `NSBonjourServices` 声明；Node `keepAliveTimeout` 默认 5 秒、Node 17 起 `dns.lookup` 不再优先 IPv4；nginx 1.25 起 QUIC、1.25.1 起 `http2 on`；Linux 初始拥塞窗口 10、TIME_WAIT 60 秒
- [ ] `nginx-gateway`：Caddy 对 `text/event-stream` 自动立即刷新；Angie / freenginx 背景；Traefik label 写法
- [ ] `deploy-release`：TestFlight 内部测试上限 100 人、构建 90 天过期；ExportOptions `method` 新名 `app-store-connect`；`wrangler rollback` / `deployments list` 及回滚时 secret 不一定跟着退；Play App Signing 上传密钥可申请重置；docker-rollout 工具名；lefthook 配置
- [ ] `kubernetes`：ingress-nginx 退役；Traefik 默认不限请求体、`traefik.io/v1alpha1` 适用版本；`lifecycle.preStop.sleep` 所需版本；k3s 默认镜像源、默认网段与 ufw 建议
- [ ] `iac-gitops`：Terraform 2023-08 改 BSL、OpenTofu 2024 年初 GA；OpenTofu 状态加密 1.7、早期求值 1.8、S3 `use_lockfile` 1.10；Cloudflare provider 5.x `cloudflare_dns_record`；alicloud 参数名与机型名 `ecs.e-c1m2.large` / `cx22`；`community.sops` vars 插件、`docker_compose_v2` 需 community.docker ≥ 3.6；Argo CD 约 3 分钟轮询
- [ ] `cloud-and-edge`：KV 写入传播约一分钟；D1 单库上限与读副本；付费套餐无硬性消费上限；Cache API 在 `*.workers.dev` 上的行为；新模板倾向 `wrangler.jsonc`
- [ ] `app-security`：OWASP Top 10:2025 是正式版还是 RC；OWASP Mobile Top 10:2024 的 M1–M10（凭记忆）；`expo-secure-store` 的 `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`；`nestjs-pino` redact 写法
- [ ] `agent-safety`：bubblewrap 参数（假设 `/bin`、`/lib` 已并入 `/usr`）；squid 配置与 `ubuntu/squid` 镜像；GitHub 细粒度令牌权限名；`sandbox-exec` 已弃用

### AI 工具链

- [ ] `open-models`：许可证特征表（Qwen 多为 Apache 2.0、DeepSeek 近期 MIT、gpt-oss Apache 2.0、Gemma 各代不同）；显存带宽规格；TRL `max_length` / `processing_class`、transformers `dtype`、mlx-lm `--num-layers`、llama.cpp `-fa on`、`vllm bench serve`、`OLLAMA_CONTEXT_LENGTH`；vLLM 镜像 `command` 写法与 `VLLM_API_KEY`
- [ ] `python-for-ai`：uv 0.12 `uv init` 默认 src 布局；Anthropic Python SDK 会把不支持的约束改写进 description 再本地校验
- [ ] `deep-learning-basics` 第 3 章：`torch.load` 默认 `weights_only=True` 的起始版本
- [ ] `observability-performance`、`llmops` 第 6 章：OTel GenAI 语义约定属性名（仍在开发阶段）
- [ ] `product-analytics`：Umami v3 镜像标签格式与 `TRACKER_SCRIPT_NAME`；PostHog `capture_pageview: 'history_change'`、`opt_out_capturing_by_default`、posthog-react-native 的 `defaultOptIn` 与 `autocapture.captureScreens`

## 四、研究、人物与数据的出处

- [ ] `llm-deep-dive` 第 4、9 章：Mixtral 论文「专家不按主题分工」；Anthropic 2025 年归因图研究里的三个例子；GGUF `S/M/L` 混合规则
- [ ] `context-engineering` 第 1 章、`rag-systems` 第 4、8 章：《Lost in the Middle》、Contextual Retrieval（只有定性描述）
- [ ] `ai-cognition`：哈佛与 BCG 2023「锯齿状前沿」实验；METR 关于任务长度「每隔数月翻一番」；OpenAI 2025 年关于评测鼓励模型猜测的幻觉论文；贝佐斯单向门 / 双向门
- [ ] `product-thinking`：RICE 归于 Intercom 及档位数值；Kano 模型 1980 年代提出
- [ ] `production-ops` 第 5 章：燃烧率参数（主会话已核对与 SRE Workbook 一致，可跳过）
- [ ] `math-for-ai`：Adam 原论文默认参数；「反向计算量约为前向的两倍」
- [ ] `deep-learning-basics` 第 8 章：大模型训练文本「比这里多六七个数量级」（估算）
- [ ] `copywriting-content` 第 5 章：AutoCorrect 的 `--lint` / `--fix` 命令（凭记忆）

## 五、写了但没实际跑过的代码和步骤

真要用之前先在测试环境验证。

- [ ] `deploy-release` 第 4 章：蓝绿部署脚本
- [ ] `database-ops` 第 2、3、8 章：pg_dump 恢复演练、PITR 恢复、16→17 升级步骤
- [ ] `rag-systems`：带向量的 SQL（本机没装 pgvector）
- [ ] `build-your-agent` 第 7 章：Dockerfile、compose、systemd 配置
- [ ] `ai-native-opc` 第 7 章：调度、批准、执行三段 TS 脚本（需 ESM 与 Node 22.18+）
- [ ] `cloud-and-edge` 第 5 章：Durable Object 限流示例
- [ ] `system-design`：postgres.js、Drizzle、R2 binding 相关片段
- [ ] `nestjs-backend` 第 5、8 章：令牌轮换事务、fetch 读流（简化示意）
- [ ] `math-for-ai` 第 6、7 章：两段 PyTorch 代码（本机当时没装 torch）
- [ ] `llm-deep-dive` 第 9 章：transformers / GPT-2 示例
- [ ] `tools-and-mcp`：`push_book` 推到真机
- [ ] `multimodal-ai` 第 5 章：whisper.cpp 的 `whisper-cli` 名称与构建命令
- [ ] `python-for-ai` 第 7 章：流式接口
- [ ] 各书 Mermaid 只做了语法检查，没有逐张在阅读器里渲染；推到手机后翻一遍，看有没有渲染失败的图

## 六、内容上的其他说明

- `llm-evals` 第 7 章的 `ocr_scans` 表是建议新增，仓库里没有
- `pricing-monetization` 第 8 章的金额（99 元/月、可变成本 15 元、固定成本 1500 元）是假设值
- `going-global` 全书以「把 hatch-shelf 做成海外付费产品」为假设场景
- `multimodal-ai` 第 4、5 章的 PDF 对账单、语音记开支，`llm-evals` 的「本周经营小结」「补仓助手」，`agent-safety` 第 7 章的「采购助手」，都是按 hatch-counter 架构推演的设想功能
- `ai-native-opc` 的 `review-budget.svg` 用了色板之外的几个主色中间色阶
- 部分书的单章篇幅超过简报建议的 250 行（主要是完整代码），属于有意为之

## 七、第五批（2026-11-03）

各书的退出条件、交付时长、平台打分、每周投入等数字，凡没标出处的都是作者设定的建议值，书里已注明，下面不再逐条列。

### 法规、社保与财税

- [ ] `opc-action-plan` 第 2、6 章：《劳动合同法》第二十三、二十四、三十七条，来源是 ecoi.net 收录的中文本，不是官方数据库
- [ ] `opc-action-plan` 第 4 章、`b2b-sales` 第 7 章、`opc-transition` 第 8 章：个人收款码（银发〔2021〕259 号、2022 年清算协会公告），依据是 2022 年新闻报道，没确认之后有无新规
- [ ] `b2b-sales` 第 2 章：《通信短信息服务管理规定》（工信部令第 74 号修订，2026-05-01 施行）第二十一条，只见 elawcn 条文整理页；《刑法》第二百五十三条之一凭记忆
- [ ] `b2b-sales` 第 3 章：新《反不正当竞争法》第八条（2025-10-15 施行）转引自律所解读；「给开店顾问付佣金属于灰色」是推断
- [ ] `b2b-sales` 第 7 章：微信确认可视为书面形式（《民法典》第四百六十九条 + 律所科普）
- [ ] `opc-transition` 第 5 章：职工医保停缴 3 个月内补缴可衔接（各地不一）；北京 2026-08-08 起非京籍购房社保 / 个税年限 1 年；人社部 2025-02 认定挂靠违法及人社部令第 48 号第三十二条；医保个人账户家庭共济；上海灵活就业纳入生育保险（沪医保规〔2025〕1 号）；2026 年居民医保个人缴费最低 400 元。均为媒体转述或凭记忆
- [ ] `opc-transition` 第 6 章：灵活就业自缴社保可在汇算时专项扣除（只见 2023 年地方文件）；协商解除经济补偿 3 倍以内免税（财税〔2018〕164 号，凭记忆）；公积金 36 城试点、条例修订稿、上海新办法
- [ ] `opc-transition` 第 7 章：惠民保参保条件、重疾定义规范 2020 修订版、未用社保结算按 60% 赔付
- [ ] `opc-transition` 第 8 章：自然人增值税按次起征点 1000 元（财政部、税务总局公告 2026 年第 10 号）及达到起征点后的征收率；代开劳务报酬发票一般不在代开环节征个税；扣缴单位只能看到自己代扣的数据
- [ ] `contracts-legal` 第 2 章：个体户店主买经营软件是否算消费者（推断为「一般不算」）；《网络交易监督管理办法》第十八条原文未在总局官网核对
- [ ] `contracts-legal` 第 4 章：软件外包按承揽还是技术开发合同认定，没有引具体判例
- [ ] `contracts-legal` 第 6 章：AI 生成内容著作权的正反判决，没检索案号
- [ ] `contracts-legal` 第 8 章：「或裁或诉」约定无效在新《仲裁法》下是否仍然适用；小额诉讼减半交受理费是推断；仲裁费比诉讼贵是概括
- [ ] `contracts-legal` 第 7、9 章：电子签平台功能概括；12348 与中国法律服务网的资料是 2018–2022 年的
- [ ] `opc-transition` 第 2 章：国内接单平台没点名，是否仍在运营没核实

### 平台规则（变化快，开号前以后台为准）

- [ ] `private-domain-cn` 第 3、9 章：小红书专业号审核费 600 元（只有投诉记录）；2025-01-07 起自动回复禁留微信电话；2025-03-12《交易导流违规管理细则》。均无官方原文
- [ ] `private-domain-cn` 第 4 章：个人公众号不能认证、注册上限、服务号每月 4 次、认证费 300 元；视频号不再支持配置「添加企业微信」、可挂公众号文章；视频号认证门槛。多为旧资料或二手报道
- [ ] `private-domain-cn` 第 5 章：抖音企业号审核费 600 元 / 年；私信谐音联系方式被风控；B 站站外导流条款没查到原文
- [ ] `private-domain-cn` 第 6 章：企业微信客户上限（未认证 100、免费 2000、初始 5 万、单成员 2 万）、未认证客户群 200 人、认证费档位、个体户能否认证；企业群发上限官方两处说法矛盾（每月 4 条 / 当月天数）；群机器人能否进外部群
- [ ] `private-domain-cn` 第 8 章：个人主体小程序能否认证、是否收 30 元；个人主体不能接微信支付；备案数量上限；订阅消息规则凭记忆
- [ ] `private-domain-cn` 第 9 章：《互联网广告管理办法》（总局令第 72 号）「显著标明广告」凭记忆；个人微信好友上限约 1 万

### 案例与数据出处

- [ ] `b2b-sales` 第 2 章：2025 年底全国餐饮商户 757.77 万家，只见北京日报客户端转述
- [ ] `opc-cases` 第 2 章：Carrd 是否一人运营及融资金额、100 万美元年收入只来自播客标题；Nomad List 创立年份；Bannerbear 约 63 万美元 ARR 为第三方引用
- [ ] `opc-cases` 第 3 章：Small Bets 分成情况；Refactoring UI 营收出处页打不开；Justin Welsh 2023、2024 年收入未逐条打开原推；Nathan Barry 数据未抽查
- [ ] `opc-cases` 第 4 章：小报童启动时间；Mole「两个月 1 万多付费客户」是支付商口径；极简时钟两年数字口径对不上；貔貅记账是 2022 年数据；flomo 被模仿一事只有当时报道
- [ ] `opc-cases` 第 5 章：门店案例全部是 V2EX 匿名自述，无法交叉验证；没找到国内一两人起步的门店 SaaS 可靠先例
- [ ] `opc-cases` 第 6 章：DesignJoy 数字来自本人推文和 Starter Story；Jonathan Stark、Brennan Dunn 数字来自播客转述
- [ ] `opc-cases` 第 7 章：TypingMind、Chatbase 团队人数说法冲突；沉浸式翻译 3000 万用户的博客没有日期
- [ ] `opc-cases` 第 8 章：Apollo 数字来自媒体转述；微信模板消息下线时间线；Placemark 停止注册和开源的日期
- [ ] `opc-cases` 第 9 章：案例的模式和获客归类是作者判断，分布图数字随归类变化

### 没实际跑过的

- [ ] `b2b-sales` 第 10 章：管道检查脚本假设 `yaml` 包把日期解析成字符串，没运行过
- [ ] `private-domain-cn` 第 7 章：版本播报示例用了路线图里还没做的功能（工资单导出、核单查重），已注明是假设
