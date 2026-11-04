# 待复核清单

前 52 本书由并行写书 agent 写成（2026-11-02），第五批 6 本（编号 52–57）和第六批 22 本（编号 58–79）写于 2026-11-03，存疑点分别在第七、八节。这里汇总了各 agent 交稿时自己标出的「拿不准、需要人复核」的点，以及主会话核对时发现的问题。

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

## 八、第六批：自媒体与短剧（2026-11-03）

写作中途，本会话的 WebSearch 额度（200 次，22 个写书 agent 共用）用完了，之后各书只能用 WebFetch 查已知网址。所以这一批**平台规则、费率、门槛和行业数据的依据普遍偏弱**，查不到的书里都写了「未公开 / 以后台为准」，没有编数字。各书的退出条件、打分、价格、工时等标明「假设 / 建议值」的数字下面不再逐条列。

已经由主会话核对原文、可作为全系列口径的：

- 《微短剧发展管理办法》：国家广播电视总局令第 16 号，2026-07-31 公布、2026-09-01 施行（nrta.gov.cn 原文）。第二条单集少于二十分钟；第五条一 / 二 / 三类；第十二条一类备案公示；第十七条三类由播出单位审核并标注节目编号；第二十七条片头标注编号；第三十四条 AI 作品每集明显位置加提示标识；第五十二条境内拍摄用于境外播出也适用。`ai-drama-post` 第 8 章原写「征求意见稿」、`drama-scriptwriting` 第 2 章原写「未能核对」，已改正
- 《人工智能生成合成内容标识办法》第三、四、五、六、九、十条（网信办原文，`ai-content-pipeline` 第 10 章、`media-compliance` 第 5 章）
- 《未成年人网络保护条例》第二十三、三十一、四十四、四十五条，《网络主播行为规范》第一、十三、十四条（`media-compliance`）
- 《直播电商监督管理办法》令第 117 号，2025-12-18 公布、2026-02-01 施行（`live-streaming`）
- 星图结算管理规则（2026-01-01 修订）、抖音开放平台视频发布接口、视频号直播加热 FAQ、知识星球帮助中心

跨书需要对齐口径的：广告法条号与教培广告（`brand-deals`、`knowledge-products`、`media-compliance`）；抖音后台「2 秒跳出率 / 5 秒完播率」指标名（`topic-and-hooks`、`account-positioning`、`douyin-kuaishou`）；带货门槛（`ecommerce-selling`、`douyin-kuaishou`、`live-streaming`、`media-action-plan` 说法不一）。

### `media-opc-overview`

- [ ] 第 2、3、7 章：《管理提示（AI 微短剧分类分层标准）》80 万 / 30 万分档、2026-07-01 执行；《微短剧发展管理办法》2026-07-31 发布、09-01 施行、每集明显位置加 AI 标识——只见澎湃、IT 之家转述；另有报道重点微短剧门槛 300 万（可能旧口径）
- [ ] 第 2 章：2025 微短剧规模 634 亿 / 677.9 亿 / 超 1000 亿含漫剧 / 动画微短剧 189.8 亿 / 2026 AI 剧漫剧约 400 亿，均二手转述口径不一；漫剧单分钟成本千元到数千元为券商观点二次转述
- [ ] 第 3 章：红果月活 3.56 亿（QuestMobile 2026-05）；小红书月活超 4 亿为口头表述；快手 / B 站 / 腾讯 2026Q2 数据未核财报；投流和商单工具名称凭已有知识
- [ ] 第 1 章：MCN 约 2.9 万家、主播账号 1.93 亿、月活开播 3326.7 万（中国演出行业协会 2025-06 报告媒体转载）
- [ ] 第 7 章：网络主播行为规范 2022-06、互联网广告管理办法 2023-05-01、AI 标识办法 2025-09-01 凭已有知识；《直播电商监督管理办法》2025-12 发布只有一个二手来源

### `topic-and-hooks`

- [ ] 第 4、8 章：抖音后台「2 秒跳出率」「5 秒完播率」指标名与口径无官方说明
- [ ] 第 1 章：看后搜 53% / 主动搜 47%（可能沿用 2024 旧数据）；小红书超 70% 月活用搜索（2024 上半年报告转引）
- [ ] 第 3 章：抖音 2024-08《违规蹭热不当获利》、2025-04《恶意营销号治理规范》只见摘要；387.4 万账号（IT 之家 2026-06-12）；热点时效窗口为经验
- [ ] 第 7 章：各平台标题字数和封面像素未查到官方口径；小红书封面比例引自 Canva 指南；抖音主页网格角标为示意
- [ ] 第 9 章：各平台合集功能名称入口未逐一核实

### `brand-deals`

- [ ] 第 2 章：星图个人达人 2026-09-20 起自动打款、星广联投 1 万粉门槛——第三方 mvpdata.net 转述
- [ ] 第 2 章：蒲公英门槛（2022 资料 1000 / 5000 粉）、服务费结算未查到；花火规则为 2020 报道；互选门槛 2023 第三方；互选与磁力聚星服务费结算未查到
- [ ] 第 2 章：税务总局 2025 第 15、16 号公告累计预扣口径依据律所解读；「在职开发者汇算可能补税」为推论
- [ ] 第 5、6 章：《广告法》第九、十一、十三、十四、十七、二十四、二十五、三十八条条号，《互联网广告管理办法》显著标明广告表述，凭记忆
- [ ] 第 7 章：《民法典》第五百八十五、一千零一十九、一千零二十一至一千零二十三条；个人代开发票、小规模 3% 征收率
- [ ] 第 2、7 章：与 media-compliance 口径需对齐

### `ecommerce-selling`

- [ ] 第 2 章：直播带货有效粉丝 ≥200（2025-04 修订）媒体转述；带货保证金 500 元无官方依据；达人佣金扣 10% 服务费为早年资料
- [ ] 第 2 章：精选联盟 5% 佣金下限生效时间两说（4-01 全量 / 4-01 五类目、4-15 全品类）；结算节奏为旧说法
- [ ] 第 4、7 章：抖店技术服务费 2%–5%、2024 保证金征求意见稿金额为第三方转述；千川·乘方订单 0.6%、免佣扩全类目（2026-01-08 媒体）适用条件未核
- [ ] 第 6 章：团购达人 ≥1000 粉无日期来源；本地生活费率 2%–8% 为 2022 数据；团购佣金无权威值
- [ ] 第 7 章：小红书个人店保证金与类目、微信小店入驻保证金费率（服务商文章）及个人能否开店未核
- [ ] 第 8 章：「仅退款」调整依据北京商报 2025-04；口碑分 / 体验分维度权重无官方资料
- [ ] 第 9 章：小红书买手 1000 粉（2023–2024）；公众号优选联盟粉丝 >100（IT之家实测）；分享员 100 元保证金（B 站文章）；小红书 / 视频号佣金与结算未查到

### `account-positioning`

- [ ] 第 1 章：抖音 2023《人工智能生成内容平台规范暨行业倡议》虚拟人注册、使用者实名——媒体转述；2026 年 AI 账号新规未查
- [ ] 第 1、5、9 章：《关于加强「自媒体」管理的通知》资质领域、认证材料与领域标签、信息来源标注——依据媒体报道，未见全文
- [ ] 第 2 章：平台官方灵感工具入口名称来自第三方教程；第三方数据工具定位来自应用商店介绍
- [ ] 第 5 章：各平台改名 / 改头像次数、置顶条数未查到官方说明
- [ ] 第 6 章：删后重发、互赞群、多号切换的风控说法为经验
- [ ] 第 7 章：「5 秒完播率」「2 秒跳出率」指标名与口径未见官方说明（与 topic-and-hooks 同一问题）

### `video-script-storyboard`

- [ ] 第 1 章：平台画幅 / 时长规格无带日期官方页，正文只写以发布页为准
- [ ] 第 2、3、5、6 章：口播语速 3–4 字 / 秒、字幕一行 12–16 字、各类视频平均镜头时长、拍摄时间估算均为经验值
- [ ] 第 7 章：Windows 11 菜单路径未逐项核对
- [ ] 第 8 章：AI 标识办法发布机关与施行日期凭记忆（建议与 opc-compliance-cn 已核口径对齐）

### `drama-distribution`

- [ ] 第 3 章：一 / 二 / 三类与重点 / 普通 / 其他的对应是作者理解；AI 微短剧 80 万 / 30 万分档（2026-06-25 网络视听司管理提示）只有新华社转述；总局是否另发分类标准未查到
- [ ] 第 3 章：2025-02 通知文号「广电办发〔2024〕35 号」、2024-06-01 起未备案不得上线——媒体转述；送审材料清单除申请表、梗概外为常见做法整理；各省细则未查到
- [ ] 第 4 章：正片前 5 秒展示不少于 3 秒 AI 提示、元数据溯源（澎湃转述骨朵调研）；过审率不足 30%、超 7 万部清退、3-31 前补审均为媒体数字；GB 45438-2025 视频标识位置凭记忆
- [ ] 第 5、6 章：各平台入驻条件、分账比例、结算周期、iOS 虚拟支付费率均未查到，书中只写结构
- [ ] 第 8 章：北京互联网法院 AI 文生图案号 (2023)京0491民初11279号凭记忆；著作权法第十七、十九条、民法典第一千零二十三、一千一百九十五条待核；版权登记费用时限未查到
- [ ] 第 10 章：ReelShort / DramaBox / ShortMax 所属公司凭记忆；办法第五十二条「境内拍摄」是否涵盖 AI 制作为作者理解

### `douyin-kuaishou`

- [ ] 第 1、7 章：快手数据用 2025Q3 业绩公告（DAU 4.162 亿、GMV 3850 亿），需换最新季报；抖音月活 9.74 亿为 QuestMobile 2025-12 经券商转引
- [ ] 第 2 章：抖音算法原理来自媒体转述（95152.douyin.com 原文未抓到）；快手「70% 流量给普通人」「基尼系数」为约 2020 年高管口径
- [ ] 第 3 章：后台指标名称与位置按常见版本写，无官方帮助文档
- [ ] 第 4 章：发布页「添加声明」选项、网页端定时发布与合集开通条件需对照界面
- [ ] 第 5 章：抖音搜索规模只有 2021 官方数字；创作灵感 / 搜索热词功能现名待核
- [ ] 第 6 章：电商分级门槛 200 / 500 / 1000 有效粉丝（2025-04-17）媒体转述；保证金 50 / 500 元说法不一；团购达人、星图、快手带货、磁力聚星、直播开通门槛均写「以官方为准」
- [ ] 第 8 章：申诉入口、健康分查询路径来自第三方 / IT 之家；申诉时效与次数无官方说明
- [ ] 第 9 章：「一人一号、一企两号」为媒体对 2023 网信办通知的转述；2026-03「一部短剧只能一个抖音账号发布」需找短剧版权中心公告原文

### `xhs-channels-bilibili`

- [ ] 第 2 章：小红书 70% 月活用搜索（2024 上半年转引）、日均 6 亿次搜索为媒体说法；CES 公式官方未确认；标题 20 字上限未核实
- [ ] 第 3 章：蒲公英门槛 500–2000 粉说法不一；蒲公英健康等级为 2022 报道
- [ ] 第 3、10 章：小红书 AI 规则依据 2026-02-12 公告、2026-04-27 治理规则——均为媒体转述
- [ ] 第 4 章：视频号不能新配置添加企业微信——转引 private-domain-cn，原公告日期未查到
- [ ] 第 5 章：视频号创作分成（100 粉、个人号、结算日）、互选万粉、各阶段功能均为 2023 资料
- [ ] 第 6 章：B 站 2025-03-07 取消二级分区只有萌娘百科来源
- [ ] 第 6、7 章：B 站 2025Q3 数据（DAU 1.17 亿、MAU 3.76 亿等）来自扬子晚报网，未对照财报
- [ ] 第 7 章：B 站创作激励为 2024-04 版规则；花火门槛为 2020 报道；包月充电 30 元档与 70/30 分成为 2023 内测资料

### `live-streaming`

- [ ] 第 3 章：抖音带货 200 有效粉丝（南方都市报转述）；电脑开播 1000 粉来自经验帖；2021-02 七部门指导意见中未满 16 周岁不得注册主播、16–18 需监护人同意凭记忆
- [ ] 第 2 章：三档设备价位为估算；平台对 OBS 等推流工具的态度未核
- [ ] 第 10 章：《网络主播行为规范》2022-06、《明码标价和禁止价格欺诈规定》2022-07-01、广告法第九条与电商法 / 反不正当竞争法概括凭记忆
- [ ] 第 7 章：把直播电商办法第六十三条引申为「直播间里任何人的言行都算在你头上」是实务提醒，请确认措辞；「达人工作台」名称未核

### `shooting-editing`

- [ ] 第 1 章：灯、三脚架、有线领夹麦、柔光箱价格区间为经验量级；4K HEVC 每分钟 300–400MB 为估算
- [ ] 第 3 章：人声 -14 LUFS 为国外流媒体经验值；DJI Mic 3 的 32-bit 浮点只对机内录音有效需核官方
- [ ] 第 4 章：竖屏遮挡区比例为经验值，需用当前抖音 / 小红书截图核对
- [ ] 第 6 章：剪映快捷键、主轨磁吸默认、文字剪视频 / 删语气词是否收费、SRT 导入菜单、VIP / SVIP 端差异（IT 之家）未核
- [ ] 第 7 章：平台曲库仅限本平台为第三方整理；阿里巴巴普惠体、HarmonyOS Sans、站酷系列、抖音美好体免费商用需逐个到官方确认
- [ ] 第 10 章：导出规格表为常用工作值非官方；B 站 4K 清晰度档位、小红书 3:4 信息流面积需核

### `micro-drama-industry`

- [ ] 第 1、8 章：2020 备案系统单列、2022–2023 专项整治、2024 分类分层审核三个节点凭行业常识；「未经审核备案不得上网」施行年份有 2024 / 2026 两说；第 1 章办法内容依据澎湃、IT 之家（应与 drama-distribution 已核官网原文对齐）
- [ ] 第 3、5 章：视频号激励最高 135%、微信短剧主体增长 31%、收入破千万公司超 90 家；快手好剧激励 20 万、Top10 版权方分账超 2000 万——均只见搜索摘要
- [ ] 第 5 章：抖音 AI 仿真人剧系数 60→40、3D 漫剧 50→40（娱乐独角兽转述，单位未明）；红果 AI 仿真人剧本 20% 分成；抖音真人剧 20% 额外分账、保底超 15 亿取自新京报相关标题
- [ ] 第 3 章：微信小程序短剧技术服务费表为 WebFetch 解析摘要（文档 2026-10-29 编辑），需对照原表
- [ ] 第 6 章：全部成本拆分与测算参数为假设
- [ ] 第 7 章：「纯 AI 短剧」判定、2026-01 儿童类微短剧管理提示、快手清理低质漫剧只有媒体说法
- [ ] 第 9 章：海外短剧 23.29 亿美元、11.99 亿次下载为媒体转引；ReelShort / DramaBox 归属凭常识；「其他地区 23%」由 100%−77% 推算；中国—东盟报告 8.5 亿用户只见摘要

### `knowledge-products`

- [ ] 第 6 章（重点）：微信小店教培类目规则 2025-03-23 生效、「禁止教授 AI 商业变现课程」来自课堂界转载；个人不能开小店、保证金为第三方说法；第 1、10 章也引用，对读者影响大
- [ ] 第 6 章：小报童 15% 服务费、分销佣金、个税代扣、24 小时无理由退款来自第三方；知识星球数据已核官方帮助中心（10%–20% 落点规则未写明）；小鹅通三档年费与免抽佣额度为 2025-01 第三方数据，2026-06 可能改为按交易抽成
- [ ] 第 6 章：抖音课程服务费率、学浪资质、2024-07 小程序收紧未核；2025-02-15《教育培训类商品宣传规范》为行业转载；得到约 50% 分成为媒体转述；网易云课堂 / B 站课堂规则未查到；小红书交易导流细则 2025-03-12 为行业转载
- [ ] 第 1、7、8 章：广告法教培广告要点（第二十四条）凭记忆；多级分销涉传销风险的口径需与 media-compliance 对齐

### `paid-traffic`

- [ ] 第 3 章：DOU+ 起投 100 元、时长与目标选项、不能手动出价来自较早第三方资料；「DOU+ 无广告标识、与自然流共享频控」只见搜索摘要
- [ ] 第 4 章：千川标准推广 2025-12-29 下线、净成交 ROI 定义、成本保障赔付来自服务商文章；全域推广出价选项与起投预算需对照后台
- [ ] 第 5 章：薯条 75 元起投、按曝光计费（2026-05 第三方）；「为 ta 加热」2025-10 上线出处；封面点击率 7% 参考值；聚光开户门槛（600 元认证、预存 2000–5 万说法不一）
- [ ] 第 6 章：微信豆兑换比例、公众号付费加热 500 豆起充、腾讯广告首充 5000–10000 元（第三方）
- [ ] 第 7 章：快手粉条起投、目标、审核规则未能确认；磁力金牛 Nobid、套餐投、ROI 上调 5%–10% 来自服务商转载
- [ ] 第 9 章：各平台能否导出为一般判断

### `media-action-plan`

- [ ] 第 5 章：带货门槛引 IT 之家 2024-08-05（0 粉开橱窗、主页橱窗 ≥500、图文 ≥1000），2025 年调整说法不一；蒲公英 1000 粉为 2022 前后报道；星图门槛未查到
- [ ] 第 8 章：分类分层 30 万 / 100 万依据新华网 2025-02-05 与地方解读（应与 drama-distribution 已核办法原文对齐）；「多数平台分账面向机构主体」为推断
- [ ] 第 8 章：漫剧万播 5–10 元、红果取消 AI 仿真人保底改 20% 分成只有骨朵一个来源；定制报价引央视财经、财联社转载；腰部公司盈利 3%–5% 为受访者判断；火山引擎激励计划未核官方
- [ ] 第 7 章：代表性 AI 工具现行产品名与商用条款未逐个核对
- [ ] 第 1–8 章：各阶段退出条件数字为作者建议值

### `ai-drama-storyboard`

- [ ] 第 1 章：AI 标识办法 2025-09 施行、广州互联网法院奥特曼案凭记忆（未写案名）
- [ ] 第 1、5 章：Stability AI 社区许可已核官网；FLUX 许可条款未查实
- [ ] 第 5、7 章：Kling 4.0 规格只来自界面新闻 2026-10-16；即梦会员价为 2026-11 限时活动价；Seedance 2.0 API 价为 2026-03 IT 之家；Vidu 参数价格未查到；通义万相 wan2.7 与 Midjourney V8.1 / --oref 规则可能已变
- [ ] 第 7 章：Runway 价格已核官网定价页
- [ ] 第 1 章：时间与成本示例为假设；第 8 章「运动笔刷」是否仍在各工具未核
- [ ] 第 9 章：21.3KB，略超 20KB 上限（示例集完整，保留）

### `ai-content-pipeline`

- [ ] 第 1、4 章：Sora 2 网页端 4 月、API 9 月下线只有第三方汇总；视频模型型号与价格区间来自第三方聚合
- [ ] 第 3、5、6 章：图像、TTS、数字人、AI 音乐代表工具未逐一核官网
- [ ] 第 4 章：Remotion 商用许可要求、剪映草稿无官方接口凭记忆
- [ ] 第 5 章：北京互联网法院 2024 AI 声音侵权案、深度合成规定「单独同意」表述凭记忆
- [ ] 第 6、10 章：抖音 2023 虚拟人注册与实名要求凭记忆
- [ ] 第 10 章：抖音 2026-03 处置 4.2 万条 / 1.4 万账号、小红书 2026-02-12 与 04-27 公告为媒体转述；配套国标未写编号；AI 字幕 / 降噪不算生成合成内容为作者判断
- [ ] 第 7 章：23KB 超上限（代码骨架），代码未在生产跑过
- [ ] 第 9 章：单价均为假设

### `drama-scriptwriting`

- [ ] 第 1 章：微短剧定义（几十秒到 15 分钟）引 2022 广电通知媒体转述，发布日期两说；单集 1–2 分钟、80–100 集（澎湃、36 氪 2024）；AI 漫剧单集 3–8 分钟单一来源
- [ ] 第 2 章：2026-06 专项治理 8 类问题（腾讯新闻）；2026-09「凡播必审」与《微短剧发展管理办法》写为「未能核对原文」——应按 drama-distribution 已核原文更新；DataEye AI 仿真人占比单一来源；35 号文三类分级为新华社报道
- [ ] 第 6 章：免费集数与单集价格来自行业媒体，出处笼统
- [ ] 第 8 章：红果 2025-08 剧本新政评级（蓝鲸单一来源）；抖音 2026-08 剧本撮合与千部计划（DataEye 转载）；番茄小说分成与奖励；编剧单部 2 万、头部保底 5–10 万；巨量「1–5 万保底 + 1%–2%」为旧数据；著作权法第十、十三、十九条条号待核
- [ ] 第 1、7 章：单集字数、台词长度、角色数量为行业经验
- [ ] 第 9、10 章：示例剧本《藏经阁里改错字》原创，但套路常见，建议查撞名撞情节；第 9 章 21KB 超上限（60 集分集大纲）

### `ai-drama-post`

- [ ] 第 8 章（口径冲突）：本书把《微短剧发展管理办法》写成 2026-06-24 征求意见稿；drama-distribution 称已在 nrta.gov.cn 读到正式版（总局令第 16 号，2026-07-31 公布、09-01 施行）——收尾时需核对并统一
- [ ] 第 8 章：各平台短剧成片技术规格未查到，规格表为行业通行做法；GB 45438-2025 视频显式标识最短时长（二手称 2 秒）与字高未核原文；编号显示时长字号无细则
- [ ] 第 4 章：国内平台响度标准未查到，-14 到 -16 LUFS 为经验；EBU R128 / ATSC A/85 / Spotify 数值凭记忆；剪映 / 抖音曲库仅限平台内使用需核条款
- [ ] 第 2 章：深度合成规定「人声编辑须单独同意」「合成人声显著标识」凭记忆，无条号
- [ ] 第 3 章：ITU-R BT.1359 音画同步阈值凭记忆；第 7 章：达芬奇 Deflicker 需 Studio 版凭记忆；第 5 章：思源字体 SIL OFL 凭记忆
- [ ] 第 10 章：单价时薪为假设

### `creator-tools`

- [ ] 第 5 章：抖音代发布能力个人开发者能否申请未查到；快手、小红书、B 站开放平台正文未抓到；星图 / 蒲公英 / 互选是否开放 API、各广告 Marketing API 服务商资质未核；BYOK 是否算向公众提供生成式 AI 服务——建议法务确认
- [ ] 第 3 章：点名产品的归属与说法（Storyboarder 开源免费等）凭已有知识
- [ ] 第 9 章：法律风险只按类别，无条号判例；「被平台以不正当竞争起诉的先例」无出处——补判例或删
- [ ] 第 5、9 章：AI 标识办法表述凭已有知识（应与 ai-content-pipeline 已核原文对齐）
- [ ] 第 2、4、6、7、8、10 章：打分、阈值、工作量、价格为作者判断 / 假设

### `media-cases`

- [ ] 全书：写作时 WebSearch 已用尽，约一半出处转引自维基百科条目参考文献，标「转引」的原文未逐一打开；建议搜索恢复后优先核对转引项
- [ ] 第 7 章：没找到可核实的一两人 AI 漫剧团队案例（只有 2 个平台级案例）；横店等基地因 AI 停工、红果漫剧 2025-11 上线只见维基百科汇总
- [ ] 第 6 章：《我在八零年代当后妈》拍摄 10 天、后期 8 万、首日充值超 2000 万来源不明；听花岛实控人与出品依据维基百科
- [ ] 第 2 章：张雪峰 2024 年销售额约 2 亿、营收超 8 亿为转引腾讯新闻；2026-03-24 去世——主会话已用维基百科人物条目确认（引新民晚报、证券时报、中新社、公司讣告），证券时报原链接抓取超时；何同学 2025-11 访谈道歉只依据维基百科
- [ ] 第 3 章：刘畊宏约 30 天涨粉超 1000 万为转引
- [ ] 第 4 章：东方甄选营收利润未引年报，销售额为飞瓜第三方；交个朋友 GMV、罗永浩首播销售额写「未公开」，建议补查
- [ ] 第 5 章：papi 酱广告拍卖 2200 万 / 2066 万两说；papitube 成立时间与签约数未查到
- [ ] 第 8 章：东北雨姐罚没 165 万、辛巴罚款 90 万与 200 万、猫一杯处罚、红果 5 天暂停上新为转引（时代财经链接 404）；已核：浙江税务薇娅通报、中央网信办 2025-12-03 通报、北京网信办 2025-12-12 通报、新京报红果约谈报道
- [ ] 涉及真人的处罚与负面事件，发布前建议再核一遍措辞是否严格限于公开通报

### `media-compliance`

- [ ] 第 2 章：《广告法》《互联网广告管理办法》条号与罚款用维基文库核对，需对照国家法律法规数据库；第五十六条代言人连带责任凭记忆；化妆品功效宣传未核《化妆品监督管理条例》
- [ ] 第 3 章：《关于加强「自媒体」管理的通知》（2023-07）原文 404，资质认证、来源标注、虚构演绎标注、矩阵号、营利权限按报道；证券投资咨询许可、「双减」范围凭记忆；2026-06-18 清朗专项转引 account-positioning
- [ ] 第 5 章：北京互联网法院 AI 文生图案结论、AI 声音侵权判例凭记忆
- [ ] 第 6 章：条例第二十、二十四、二十六条条号来自英文转述；平台 16 岁以下不能开播凭记忆；最高法未成年人打赏返还文件、文明办直播打赏文件未核
- [ ] 第 7 章：MCN 合同是否适用任意解除权、劳动关系认定、违约金调减为实务经验，需对照判例
- [ ] 第 8 章：税务总局 2025 第 16 号公告未抓原文（依据律所解读）；测算中收入额按 80% 计为假设；2022 三部门规范网络直播营利行为意见未核
- [ ] 第 9 章：经营所得速算扣除数（主会话核对：0 / 1500 / 10500 / 40500 / 65500 与现行表一致）；无综合所得者减除 6 万凭记忆；小规模能否自开专票未核；劳务报酬转经营所得的认定为风险提示
- [ ] 第 10 章：平台协议账号归平台、账号财产性利益司法认可凭记忆

## 九、DeepSeek Harness 入门（2026-11-04）

依据是 2026-11-04 抓取的官方仓库 `deepseek-ai/deepseek-harness`（README、SAFETY、`docs/` 下架构、术语、Cordis 教程、子系统、cookbook、用户指南）和 DataCamp 两篇介绍。DSH 是开发者预览版，以下几处没在真实环境里跑过或依据较弱：

- [ ] 第 2 章：「设置 → 通用 → 在使用官方模型 API 时上传 Session Log」的开关文字取自包 README；匿名统计报告可关闭的说法来自 DataCamp，未在官方文档里找到具体位置
- [ ] 第 3 章：手动压缩命令写的是 `/compact`（由 `dsh-command-compact` 包推断，未核命令名）
- [ ] 第 5 章：PTC 的全称（程序化工具调用）是推断，官方文档未写；PTC 示例程序里的函数名和参数形状是示意
- [ ] 第 5 章：Ralph、目标、Teams、定时任务的描述来自工具目录和术语表，未实际使用
- [ ] 第 9 章：门禁插件里 `exec.arguments` 的实际形状（对象还是字符串）未核，示例用 `JSON.stringify` 兜底；`check_book_id` 工具和配置示例没有在真实 DSH 里跑过
- [ ] 第 10 章：Python SDK 示例按官方指南的参数重写（`with DeepSeekHarness(...) as harness`、`harness.run(...)`、`result.final_response`），没有实际运行；TypeScript SDK 只在架构文档里提到
- [ ] 第 1 章：DeepSeek 招聘 Harness 团队的时间和地点来自媒体报道

## 十、全库体检第一轮：纠错与补 WARNING（2026-11-04）

见 `AUDIT-2026-11.md`。这一轮把法规、财税、平台规则、版本敏感内容统一改成 `> [!WARNING]`，正文事实基本没动；下面是改的时候发现依据特别弱、或怀疑有错但按规则没改的地方。

### 法规与财税

- [ ] `contracts-legal` 第 5 章：《反不正当竞争法》2025 年修订后，商业秘密定义和条号没有按新版核对
- [ ] `contracts-legal` 第 8 章：《仲裁法》条号（第十、十一、二十七、二十九、五十二、七十二条）和「2025 年修订、2026-03-01 施行」需按新法原文核对
- [ ] `contracts-legal` 第 4 章：配图 milestone-payment.svg 是 30/20/40/10 四段，`opc-transition` 第 2 章改成了 30/60/10 三段；两边尾款都是 10%，看是否统一结构
- [ ] `opc-transition` 第 8 章：财政部、税务总局 2026 年第 10 号公告（按次起征点 1000 元、执行到 2027 年底）
- [ ] `opc-transition` 第 5 章：北京 2026-08-08 购房社保年限调整、新华社 2026-09 医保户籍限制报道、2026 年度居民医保个人缴费「不低于 400 元」，均来自媒体报道
- [ ] `opc-transition` 第 6 章：住建部 2026-06《住房公积金管理条例（修订征求意见稿）》和「36 个城市试点」
- [ ] `opc-finance` 第 5 章：「股东借款年终未还视同分红」没有文号
- [ ] `opc-compliance-cn` 第 1、6 章：2025 年下半年以来的新规（网安法修正、个人信息保护合规审计管理办法、个人信息出境认证办法、存量公司出资期限过渡）正文没写，WARNING 里只做了提示
- [ ] `opc-compliance-cn` 第 7、8 章：「2023 年苹果中国区大规模下架接入境外模型的 AI 应用」的时间和表述
- [ ] `opc-action-plan` 第 2、6 章：劳动合同法条文引用的是转载本，换成国家法律法规数据库
- [ ] `going-global` 第 2 章：Form 5472 漏报罚款只写了「很重」；第 3 章 Lemon Squeezy 现状、Stripe 是否支持中国大陆商户；第 5 章欧盟—美国数据隐私框架现状
- [ ] `going-global` 第 4 章、`pricing-monetization` 第 6 章：美区外链支付（2025 年判决后）、欧盟 CTC 与新费用结构、日本《移动软件竞争法》都没具体写；30% / 15% 费率写的是「被广泛报道」
- [ ] `media-compliance` 第 8 章：2025 年第 16 号公告（平台累计预扣）作者没看到原文；增值税按次起征点 1000 元是转引
- [ ] `media-compliance` 第 6 章：「十六周岁以下一般不允许开播」的依据

### 微短剧政策

- [ ] `drama-distribution` 第 3 章：80 万 / 30 万分档标准和 2025 年通知文号都是媒体转述，是全书最弱的依据；《微短剧发展管理办法》（总局令第 16 号，2026-09-01 施行）本身也需对照原文
- [ ] `drama-distribution` 第 4 章：「前 5 秒、不少于 3 秒」的标识做法、清理潮「过审率不足三成」均为媒体转述
- [ ] `micro-drama-industry` 第 8 章：罚则写「报道称罚款上限为十万元」，与 `drama-distribution` 第 3 章（擅自播出依《广播电视管理条例》第五十条，十万元以下只针对偏离备案等情形）可能不一致；本轮还把「单集不超过 20 分钟」改成了与 drama-distribution 一致的「不足 20 分钟」，需对照办法第二条确认
- [ ] `micro-drama-industry` 第 5 章：抖音系数「60→40」的单位是推测的百分比；火山引擎 2026-10 激励等活动可能已结束（`media-action-plan` 第 8 章同）
- [ ] `drama-scriptwriting` 第 8 章：红果剧本评级档位表是 2025-08 的规则
- [ ] `ai-drama-storyboard` 第 7 章：Seedance「约 1 元 / 秒」只依据一篇 2026-03 报道，不清楚是 API 预告价还是平台内计费

### 平台规则与工具

- [ ] `douyin-kuaishou` 第 6 章、`live-streaming` 第 3 章、`ecommerce-selling` 第 2 章：「200 粉直播带货」等分级门槛只有媒体转述；带货保证金 50 / 500 元说法不一
- [ ] `ecommerce-selling` 第 2 章：「达人佣金扣 10% 技术服务费」无 2026 年依据；「佣金下限 5%」两家报道生效时间不一致；第 6 章团购「1000 粉」门槛无日期、生活服务佣金 2%–8% 是 2022 年数据
- [ ] `live-streaming` 第 6 章：示例只算了毛佣金，找到官方结算扣点后补一行到手数字
- [ ] `paid-traffic` 第 4 章「2025-12-29 标准推广下线」只有一篇第三方文章；第 5、6 章聚光开户预存、腾讯广告首充、微信豆兑换比例（0.1 元与 7 豆 1 元）互相矛盾
- [ ] `xhs-channels-bilibili` 第 5、7 章：视频号变现门槛（2023）、花火门槛（2020）、B 站创作激励（2024-04）；`brand-deals` 第 2 章蒲公英（2022）、互选（2023）门槛
- [ ] `knowledge-products` 第 6 章：小报童 15%、小鹅通年费来自 2025 年第三方整理，小鹅通 2026 年有改按交易抽成的报道；抖音、视频号课程类目费率没查到官方原文
- [ ] `douyin-kuaishou` 第 1 章与 `media-opc-overview` 第 3 章的快手用户数（2025Q3 vs 2026Q2：日活 4.12 亿、月活 7.97 亿）待核实后统一
- [ ] `ai-content-pipeline` 第 4 章：「Sora 2 网页端 / App 4 月下线、API 9 月下线」只有第三方汇总

### 软件版本

- [ ] `ts-node-advanced` 第 5 章：「Node 22.23 默认 `--no-maglev`」依据很弱，需对照 Node 22 changelog；全书基线建议换到 Node 24 LTS 重跑实验
- [ ] `nestjs-backend` 多章：v12 新 API 名称未逐个对照发布说明（`StandardSchemaValidationPipe`、`StandardSchemaSerializerInterceptor`、`@Body({ schema })`、`errorCode`、`@nestjs/config` 的 `libraryOptions`、Node 20.19+/22.12+、钩子顺序调整等）
- [ ] `redis-jobs` 第 2、3、5 章：`@nestjs/bullmq`、`@nestjs/cache-manager`、`@nestjs/throttler` 与 NestJS 12 配套的版本；第 1、5 章 Redis 连接 `quit` 与 Worker 关闭在 v12 钩子顺序下的先后需实测
- [ ] `electron-desktop` 第 1 章：Electron 44 是否仍在支持窗口；第 6 章 `notarize: true` 和 `APPLE_API_KEY` 等变量名对照 electron-builder 26 文档
- [ ] `app-security` 第 3 章：OWASP Top 10:2025 是否定稿、A01–A10 最终名称
- [ ] `database-practice` 第 6 章：Drizzle v1 发布后「迁移是怎么记账的」「基线重置」可能整节失效
- [ ] `react-internals` 第 1 章：React 19.3 的变更内容未核对

### 其他

- [ ] `pricing-monetization` 第 8 章：hatch-counter 只有一个收费档，第七步仍在讲升级时的新旧套餐日价折算，前后略有张力
- [ ] `company-basics` 第 5 章有 6 个 WARNING，可合并；第 7 章「王蕾」担保案例用的是 2025 / 2026 年具体年份，建议改成相对时间
- [ ] `shelf-guide` 第 1 章首句「离线的 Markdown 阅读器」与「文案不提离线」的偏好是否冲突，请仓库所有者确认

## 十一、全库体检第二轮：首批配图（2026-11-04）

- [ ] `go-practice` 第 5 章新增「G、M、P：调度器里的三个角色」一节：按 runtime 源码注释和调度器设计文档的印象写成，没有联网逐条核对（本地队列长 256、偷一半、sysmon 收回 P 的时机）
- [ ] `redis-jobs` 第 5 章：「prioritized 从 BullMQ 4.0 起才是独立状态」是凭记忆写的；完整状态机里合并了两组边，其中一个边标签超过 8 字
- [ ] `product-analytics` 第 5 章「先修哪一步」：表格里三种改进的幅度不同（+1、+10、+5 个点），且没算「核心动作」这一步，与后文「提升的绝对值相同时」对不上；新图按统一 +5 个点算，结果是注册提升最大，与本节「先看越靠后的步骤」的倾向相反。是否把表格改成同幅度，由作者决定
- [ ] `growth-marketing` 第 1 章：推论按 k 可忽略算出上限 A/c=1000，TS 示例用 referral=0.02，稳态是 A/(c−k)≈1111，两处口径不同（新图注明了 k 取 0）
- [ ] `git-deep-dive` 第 4 章：为配图补了一个 reset 后用 reflog 找回的场景，沿用正文示例的哈希，`main@{2}` = 2f3de4f 是从正文推出来的
- [ ] `video-script-storyboard` 第 5 章：书中示例分镜没有远景镜头，火柴人分镜用的是第 7 章镜 17–20（特写、中景、大特写、全景）

## 十二、全库体检第四轮：内容更新（2026-11-04）

第四轮按一手来源核实了 26 本高优先级书和 5 本跨书对齐。`[ ]` 为待复核；`[x]` 或「已核」为本轮已核实、前面章节对应条目可勾掉的。

### coding-agents

- [ ] `01-how-agents-work.md#权限模式`：按 2026-11 code.claude.com「Choose a permission mode」改写。新增事实：终端 / VS Code 新会话内置默认是 `auto`（v2.1.283 起，不可用时退回 Manual），`claude -p` 默认 Manual；`dontAsk` 不进 Shift+Tab 循环；项目级 settings 写 `auto` / `bypassPermissions` 不生效。版本号跟得很紧，建议下次修订再对一次
- [ ] `01-how-agents-work.md#权限规则` 新图 `assets/permission-funnel.svg`：判定顺序（hook 退出码 2 → deny → ask → allow → 模式）是从 permissions 文档的几处说明拼出来的简化示意，省略了「任何模式都不自动放行」的例外和 auto 模式下宽泛 Bash allow 被丢弃的情况，请人看一眼是否过度简化
- [ ] `04-hooks.md#常用事件`：「34 个事件」是数 2026-11 Hooks reference 事件表得出的，新版本几乎每次都加事件
- [ ] `03-rules-by-path.md#插件把整套规矩打包`（新增）和 `07-review-testing.md#无人值守headless-与-github-actions`（新增）：按官方文档写，没在真实环境跑过 `claude plugin install`、`--permission-prompts none`、示例工作流 YAML；`--bare` 官方预告会成为 `-p` 默认
- [x] REVIEW.md 第二节 hatch-counter「shell 命令看文件不触发路径 rules」：2026-11 memory 文档确认对单个文件 `cat` / `head` 也会触发路径 rules，书里第 3 章写法正确；需要改的是 hatch-counter 项目自己的 CLAUDE.md

### deepseek-harness

- [x] REVIEW.md 第九节「第 3 章 `/compact` 由包名推断」：0.2.1-alpha.3 / 0.2.1-rc.1 release notes 原文「Web 与桌面端可通过 /compact 指令手动压缩上下文」，已在正文注明来源，可划掉
- [x] REVIEW.md 第九节「TypeScript SDK 只在架构文档里提到」：0.2.1 / 0.2.2 release notes 多处写到 TypeScript 与 Python SDK（resume、插件管理、审批），第 10 章已改写；PyPI 上 `deepseek-harness-sdk` 最新 0.2.1rc2。Python 示例仍未实际运行
- [ ] `01-what-is-dsh.md` WARNING：基线改为「npm latest = 0.2.1-rc.5，next = 0.2.2-rc.1，GitHub 最新 release 0.2.2-alpha.3」。0.2.2-rc.1 在 npm 上当天发布、GitHub 还没有 release notes，0.2.2 正式发布后需按其 notes 再核一遍
- [ ] `05-tools-and-modes.md#文件与搜索`：`apply_patch` 书里写「Standard 模式启用」（依据 master 的 `docs/tool-catalog.md`：`dsh-base` 和 Web `standard` 预设启用），但 0.2.2-alpha.3 release notes 写「新增默认关闭的 `apply_patch` 工具」，两处说法不一致，未改正文
- [ ] `05-tools-and-modes.md#ptc让模型写程序来调工具`：PTC 全称仍未在官方文档找到（查了 glossary、`docs/subsystems/ptc-runtime`、tool-catalog、release notes），维持「推断」的写法
- [ ] `05-tools-and-modes.md#从-claude-code-迁过来`（新增）：对照表依据 `dsh-agent-instructions`（不解析 `@path` 和 `.claude/rules/`）、`dsh-hooks-claude-code`（只跑 command hook、七个事件、配置读失败只警告）、`dsh-subagent-claude-code`（默认 `dontAsk`）README 和 approval 文档（没找到逐条命令放行规则）。「DSH 没有逐条命令的放行规则」是没找到即推断为没有，未在真实 DSH 里验证
- [ ] `10-automation-and-next.md#一次性运行headless`：headless 参数表来自仓库 `docs/cli-help.md`；「0.2.1 起 headless 只读环境变量和 .env、不读界面保存的 key」来自 release notes 和 `packages/bundle/headless` README，未实际运行

### tools-and-mcp

- [x] REVIEW.md 第三节「输出 10k token 警告、25k 默认上限、工具搜索默认开启」：2026-11 Claude Code MCP 文档原文确认，第 2、7 章已加来源；`pnpm --silent`：在本仓库（pnpm 9.15）实测 `pnpm --silent <script>` 不再往 stdout 打印 `> pkg@ script` 那行，可划掉
- [x] REVIEW.md「MCP」节「2026-07-28 无状态」：逐条对照 modelcontextprotocol.io 的 2026-07-28 Key Changes、Versioning、Base Protocol、Streamable HTTP、Deprecated 页，原有说法全部成立（含 `-32602`/400、`-32022`、`server/discover`、`resultType`、`ttlMs`/`cacheScope`、`Mcp-Method`/`Mcp-Name`/`x-mcp-header`、兼容矩阵），并补了 `-32021`、`logLevel`、`notifications/roots/list_changed` 删除、错误码区段、OTel `_meta`、授权变更、弃用期至少 12 个月。可划掉
- [ ] `04-mcp-protocol.md#扩展与-mcp-apps`（新增）：官方 Extension Support Matrix 的支持标记是图标，抓取不到，正文没写哪些客户端支持 MCP Apps；「宿主不支持时工具结果本身仍要完整可用」是作者建议，规范页面没写成硬性要求
- [ ] `05-build-mcp-server.md#发布与分发mcp-registry`（新增）：官方 Registry 仍是 preview；`mcp-publisher` 流程和 `server.json` 示例按 Quickstart 改写，没有实际发布过
- [ ] `06-auth-and-permissions.md#多用户oauth-21`：REVIEW.md 原条目「多用户 OAuth 的具体 API」仍未解决，本轮只补了 `iss` 校验（RFC 9207）和凭证绑定签发方两条规范要求

### llm-fundamentals

- [ ] `02-tokens-embeddings.md#小实验自己数-token`：tiktoken 0.14.0 的切分结果是实际跑出来的；Anthropic `count_tokens` 的 curl（`anthropic-version: 2026-10-21`、`claude-opus-5-5`、新分词器约多 30%）照 2026-11 的 platform.claude.com Token counting 文档写，没有用真实 key 跑过；OpenAI Tokenizer 网页地址 platform.openai.com/tokenizer 凭记忆，未打开核对
- [ ] `06-sft-rlhf.md#推理模型先想再答`：o1 发布于 2024-09、o1 博客「准确率随训练和推理计算平滑提升」、DeepSeek-R1 于 2025-01 开源且 R1-Zero 回答长度自发变长，均凭记忆写（与公开报道一致，未逐字核对原文）；思考 token 按输出计费已对照 Anthropic extended thinking 文档
- [ ] `05-pretraining.md#有多大`：「一本书约 10 万英文单词、约 13 万 token」是粗略换算；Qwen3「119 种语言和方言」凭 Qwen3 发布博客记忆

### ai-cognition

- [ ] `01-boundaries-hallucination.md#边界不是一条线是锯齿`：758 人、18 个任务、多完成 12.2%、快 25.1%、质量高 40% 以上、范围外正确率低 19 个百分点，按 HBS 工作论文 24-013 摘要的记忆写；HBS 和 SSRN 页面均 403，只用二手转述交叉核对（二手源有写 25% 而非 25.1%）
- [ ] `05-trends-and-hype.md#任务时长翻倍metr-的具体数字`：TH1.1 的 196 / 131（107–161）/ 89 天和 Opus 4.5 320 分钟、GPT-5 214 分钟已在 metr.org 原文核对；散点图里各模型的发布日期是凭记忆填的（METR 页面不给日期），GPT-4o 的 5 分钟取自 TH1.1 页面的新旧任务集对比表；「约 12 小时（5–61 小时）」「超过 16 小时测不准」来自 2026-05-19 Frontier Risk Report；「正在试新的任务集」依据 METR 网站搜索摘要提到的 MirrorCode-Early，未打开原文
- [ ] `05-trends-and-hype.md#什么时候跟进新东西`：贝佐斯单向门 / 双向门写成「2015 年致股东信（2016 年 4 月发布）」，凭记忆，未打开原信

### llm-evals

- [ ] `03-testing-scorers.md`（新章）：单元测试、全测试集性质检查、`rescore.ts` 的代码没有实际跑过；`@hatch/evalkit` 是否导出 `CaseResult` / `Score` 类型按前几章推断
- [ ] `06-agent-evals.md#用无头模式跑-agent`：参数表已按 2026-11 Claude Code 官方文档（CLI reference、headless、Agent SDK 的 SDKResultMessage）核对；改正了「`--allowedTools` 只放行这些工具」的说法（它只免确认，不限制工具集，限制要用 `--tools`），并补了 `--tools`、`--no-session-persistence`、macOS/Linux 默认无 Glob/Grep 的说明。改后的命令没有实际跑过
- [ ] 拆章后全书「第 N 章」文字编号顺延（原第 4–7 章变为第 5–8 章），`build-your-agent/06-evals.md`、`ai-native-opc/03-customer-support.md` 里指向本书的链接文字和 ROADMAP 章节列表已同步；文件名未改

### nestjs-backend

- 已核实，可勾掉 REVIEW.md 第 95、485 行的大部分：`@Body({ schema })`（含 `@Query`/`@Param`/`@RawBody`）、`StandardSchemaValidationPipe` 选项与默认值（transform=true、errorHttpStatusCode=400、validateCustomDecorators=false）、`StandardSchemaSerializerInterceptor` + `@SerializeOptions({ schema })`、`HttpExceptionOptions.errorCode` 及回包形状、生命周期钩子按层级调用、ESM 发布与 Node 20.19+/22.12+、`@nestjs/config` 走 Standard Schema + Joi 18 + `validationOptions.libraryOptions`、ESM 模板默认 Vitest（CJS 仍 Jest）、`Reflector.createDecorator` 生成器、`ArgumentMetadata` 泛型。来源：GitHub v12.0.0 release、docs.nestjs.com/migration-guide、Validation / Exception filters 页、npm `@nestjs/schematics@12.0.12` 模板。`process.loadEnvFile()` 20.12 / 21.7 维持原说法（未另查 Node 文档）
- 01-di-modules.md#nestjs-12-与-esm：原说法「NestJS 12 起 class-validator 和 class-transformer 已是可选依赖」（04-validation-dto.md#路线一class-validator）有误，`@nestjs/common` 11.1.6 起就是可选 peer 依赖，已改正
- 08-realtime.md#什么时候需要-websocket：`handleDisconnect` 拿到断开原因只出现在 v12.0.0 release notes，Gateways 文档页没写参数类型和适配器支持范围，需看 `@nestjs/websockets` 类型定义复核
- 01-di-modules.md#nestjs-12-与-esm、09-testing.md#测试框架与装饰器元数据：ESM 模板靠 Vite 8 内置 Oxc 输出装饰器元数据（模板无 SWC 插件，Vite 8 迁移说明确认支持且有类型推断局限）；`import type` 导致元数据退化为 `Object` 是按 Vite 说明推断，未实测
- 01-di-modules.md#生命周期钩子：v12「按层级调用」的具体排序规则官方未给出
- 01-di-modules.md#nestjs-12-与-esm：`@Optional()` 继承变化「12.1 起恢复」按迁移指南原文，未实测
- 10-data-transactions.md（新章）：Drizzle 0.45 事务语义按源码（postgres-js session 的 begin/savepoint、TransactionRollbackError）整理；「连接池调到 1 测出事务内借第二条连接」是建议做法，hatch-counter 未采用；`@nestjs-cls/transactional`（4.0.2）及 Drizzle 适配器（2.0.2）只核实了 npm 上存在，未实际接入

### database-practice

- 已核实（REVIEW.md 第 103 行）：PG18 `uuidv7()`（及别名 `uuidv4()`）、B 树 skip scan（PG18 Release Notes）；PG11 非易变默认值加列只改元数据、PG12 `ALTER TYPE ADD VALUE` 可在事务里（PG12 Release Notes）、预备语句前 5 次 custom plan（PG18 PREPARE 文档）；SQLite 3.34 FTS5 trigram、3.35 DROP COLUMN、3.37 STRICT（sqlite.org release log）
- 05-mvcc.md#加列不一定重写表：原说法把 `now()` 列为会重写表的易变函数，有误（`now()` 是 stable，PG 文档举例的是 `clock_timestamp()`），已改正
- 01-modeling.md#关于这本书：基线改为 PG 18，但书中执行计划和输出仍是 16 上的实测，未在 18 上逐条重跑（本机无 Docker 守护进程）；02-indexes.md#联合索引顺序就是一切 里「这条在 18 上可能用上 skip scan」未实测
- 01-modeling.md#生成列让库替你算：「18 里虚拟生成列不能建索引」只有二手来源，PG 文档页未明说；01-modeling.md#约束把规矩写进库里 的 `WITHOUT OVERLAPS` 需要 `btree_gist` 也只有二手来源
- 06-drizzle-migrations.md#drizzle-v1-改了什么：按 drizzle-orm / drizzle-kit 1.0.0-rc.5 源码整理（按文件夹名记账、新增 name/applied_at 列、`drizzle-kit up`、去掉 drop、`strict` 弃用改 `--explain`、`--hints`/`--hints-file`）。「做过基线重置的库升 v1 时迁移器会因对不上的旧记录报错」是读源码推断，未在 hatch-counter 上实跑；v1 正式版发布后需复核整节（对应 REVIEW.md 第 489 行）
- 04-transactions.md#修法二条件更新乐观并发：「Drizzle 0.45 的 `.returning()` 没有 old/new 写法」按 API 推断，未查到官方说明
- 09-json-fulltext.md#postgresql-全文检索与中文：zhparser / pg_jieba 的托管数据库支持情况仍未核实，维持原说法

### debugging-methods

- [ ] `05-debuggers.md#webview` 附近（Safari Web Inspector 步骤第 3 步）：改成「设置 → App → Safari 浏览器 → 高级 → 网页检查器」，依据是 iOS 18 起系统设置把自带 App 收进「App」一栏，凭记忆，未找到 Apple 一手文档逐字核对
- [ ] `09-production-only.md#线上取证清单出事时先保存什么`：iOS 崩溃日志路径「设置 → 隐私与安全性 → 分析与改进 → 分析数据」凭记忆，需在 iOS 26/27 真机上核对

### app-security

- [ ] `05-supply-chain.md#近几年的几起真实事件`：Shai-Hulud 第二波（2025-11 下旬）只有 Check Point、Seceon、Cycode 等安全厂商报告，起始日期（11-21 / 11-24）和受影响包数（700+ / 1000+）各家不一致，正文只写了「11 月下旬」「把入口提前到 preinstall」，未写数字
- [ ] `05-supply-chain.md#近几年的几起真实事件`：2026-08 keyv 蠕虫只有 Wiz、Aikido、JFrog 的分析和 VentureBeat 的报道（受影响包数 400+ 到 868 不等），「用项目自己的 GitHub Actions 发版、带有效 provenance」来自 VentureBeat 转述 Aikido / JFrog / Wiz；正文写「数百个包」，未写具体数字
- [ ] `05-supply-chain.md#近几年的几起真实事件`：xz-utils「被一位工程师因 SSH 登录变慢追查发现」「化名维护者花了几年时间」按公开报道的通行说法写，NVD 条目本身不含这些细节
- [ ] `06-mobile-security.md#本地存储令牌放进钥匙串`：docs.expo.dev SDK 58 的 SecureStore 页面把 `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` 显示为 deprecated，但 expo/expo 源码 `packages/expo-secure-store/src/SecureStore.ts` 里废弃的是 `ALWAYS_THIS_DEVICE_ONLY`（文档渲染疑似错位）；正文按源码保留原写法，WARNING 里写明了。Expo 修正文档后可复核
- [ ] `04-passwords-secrets.md#用-nodecrypto-的-scrypt`：新加的 WARNING 引用 OWASP Password Storage Cheat Sheet 的 scrypt 推荐值（N=2^17, r=8, p=1），凭记忆，未在本轮重新打开原文核对
- [ ] `01-authentication.md#oauth-20-与-oidc用别人的账号登录`：WARNING 引用 RFC 9700（2025 年 1 月）和 App Store 审核指南 4.8 节，凭记忆，未逐字核对

### growth-marketing

- `02-seo.md#geo让-ai-搜索引用你`：新增 GEO 一节。Google 说法、Pew 2025-07-22 点击数据（8% vs 15%、引用链接 1%、58% 搜索出现 AI 摘要）、GEO 论文（KDD 2024，最多约 40%）均按一手来源写；国内 AI 助手（豆包、DeepSeek、元宝、Kimi）的引用规则没有公开资料，正文写明只能自己观察，待有官方说明时补
- `02-seo.md`、`05-aso.md`、`06-cold-start.md`、`08-channel-evaluation.md` 新增的算例数字全部标为示例假设（08 的 99 元 / 15 元沿用 pricing-monetization 第 8 章）
- REVIEW 第 503 行（第 1 章 A/c 与 A/(c−k) 口径不同）已在推论 1 里补上 A/(c−k)≈1111 的说明，可勾掉

### pricing-monetization

- `06-app-store-iap.md#地区规则`：美区外链费用仍在诉讼中（第九巡回 2025-12-11 发回重审，最高法院 2026-06-30 同意审理藐视法庭部分），Apple 能收多少尚未确定；最高法院和地区法院有结论后需更新。美国部分依据的是 9to5mac / MacRumors / IPWatchdog 等媒体对判决的报道和 Apple 审核指南现行文本，未直接读判决书原文
- `06-app-store-iap.md#佣金的框架`：标准费率 30% 在 Apple 小型企业计划页面没有直接写出，仍是「被广泛报道」；该页还写「订阅满一年后 10%」，是否全球适用还是仅指欧盟 / 日本，表述不清，正文没有采用
- REVIEW 第 24、458 行中欧盟 CTC、日本 MSCA 部分已按 Apple 开发者网站一手页面写明（欧盟 2026-10-01 起，日本 2025-12-18 起），可更新状态；韩国规则未核对

### going-global

- `03-stripe-payments.md#什么时候用-mor什么时候用-stripe-直连`：Polar、Creem 的官方文档没有列出接受的卖家国家，中国大陆个人能否开通未核实，正文已提示自行确认。Stripe 开户国家（不含中国大陆）和 Managed Payments 商户地区白名单、商品范围、买家限制国家（含中国）按 Stripe 官方页面核实；Lemon Squeezy 现状按其 2026-01-28 官方博客（未宣布关停、向 Managed Payments 迁移）
- `02-overseas-entity.md#美国-llc-为什么最常被推荐`：Form 5472 罚款（25,000 美元，IRS 通知后 90 天未改正每 30 天再加 25,000 美元，按关联方分别计）按 IRS《Instructions for Form 5472》（Rev. 12/2024）核实，REVIEW 第 457 行这一条可勾掉；BOI 段落仍是 2025 年的表述，本轮未重新核实
- `04-app-store-global.md#其他地区`：美国、日本、欧盟 DMA 已按 2026-11 更新并链到 pricing-monetization 第 6 章；韩国未核对

### employee-to-owner

- 无需人工复核的事实项。本轮把 02 / 03 / 05 / 08 / 09 中 text 块里同一行用多个空格隔开的填空字段拆成每行一项；新增两张图的数字取自第 2 章场景一已有算例和第 5 章续约例子

### opc-compliance-cn

- [ ] `06-pipl.md#网络安全法修正罚款不再先警告`：修正后条号（第六十一条、第四十二条、第七十一条、新增第二十条）和罚款档位取自新华社受权发布的修改决定全文（news.cn 2025-10-29），没有逐条对照全国人大或网信办刊载的重新公布文本；条号以重新公布的法律文本为准
- [ ] `06-pipl.md#数据出境用海外大模型要特别小心`：《个人信息出境认证办法》的适用条件（非关基、10 万–不满 100 万人 / 不满 1 万人敏感信息、不含重要数据、禁止拆分）和证书 3 年有效期取自国家网信办 2025-10-17 答记者问页面，没有打开办法条文本身；认证规则、认证机构名单尚待市场监管总局公布
- [ ] `01-entity-choice.md#注册资本认缴不等于不用缴`：新《公司法》第四十七条「五年内缴足」、第二百六十六条过渡条款，条号未打开 flk.npc.gov.cn 原文核对（第二十三条第三款已见上市公司公告引用原文）；国务院注册资本登记管理规定已在中国政府网原文核对。原 REVIEW 第一节「凭记忆，未见条文原文」一条可据此部分勾掉
- [x] `02-registration.md#每年和每月要做的事`：年报 1 月 1 日至 6 月 30 日，已按《企业信息公示暂行条例》第八条（国务院令第 654 号原文转载）核对；未查到该条例 2024 年以后的修订，原 REVIEW 第一节对应条目可勾掉
- [x] REVIEW 第十节「第 1、6 章 2025 年下半年以来的新规正文没写」：四项均已查到原文并写入正文，可勾掉

### opc-finance

- [ ] `07-annual-filing.md#你自己综合所得汇算`：「2025 年度汇算在 2026 年 3 月初实行预约办理（国家税务总局 2026 年第 1 号通告）」来自媒体转述，没有打开通告原文
- [ ] `08-bookkeeper-quotes.md`：章首 WARNING 引用财政部《代理记账管理办法》凭记忆，未核对现行版本
- [ ] `09-closing-down.md#个体户`：个体户简易注销无需公示（《市场主体登记管理条例》第三十三条）凭记忆，未核对原文
- [ ] `09-closing-down.md#清税税务这一关`：「清算期间单独作为一个纳税期间」凭记忆（《企业所得税法》第五十五条只规定清算所得申报，单独纳税年度的口径在财税文件里），未核对文号
- [ ] `09-closing-down.md#剩下的钱怎么拿回来`：剩余财产分配「相当于未分配利润和盈余公积的部分按股息处理、超过投资成本的部分可能产生所得」的框架凭记忆，正文已要求让代账算
- [x] `07-annual-filing.md` 及 `02-taxes.md` 申报日历：企业所得税 5 个月内（江苏省税务局汇算须知）、经营所得次年 3 月 31 日前（江苏省税务局引用《个人所得税法》）、综合所得 3 月 1 日至 6 月 30 日（国家税务总局令第 57 号，中国政府网）已核对，原 REVIEW 第一节「企业所得税汇算一般次年 5 月底前、经营所得个税汇算一般次年 3 月底前」可勾掉
- [x] `05-separate-money.md#借款`：股东借款年终未还视同分红的依据为财税〔2003〕158 号第二条（国务院公报、国家税务总局法规库收录），已写进 WARNING；REVIEW 第一节和第十节「没有文号」两条可勾掉

### media-cases

- [ ] 第 4 章 `04-ecommerce-live.md#案例-11东方甄选教育公司转型直播电商`：已补 2026 财年公司口径（营收约 57 亿元、GMV 102 亿元、自营 GMV 54 亿元，依据新华财经 2026-08-21 报道）；净利润只有盈利预告区间 5.2 亿—5.5 亿元（澎湃 2026-07-24），港交所年报原文未打开核对
- [ ] 第 4 章 与辉同行：仍只有 2024 年飞瓜第三方月销数据，未找到公司口径的更新数字
- 已核（可勾掉第八节对应条目的一部分）：第 2 章张雪峰 2026-03-24 在苏州去世，证券时报（2026-03-25，中华网转载）、界面新闻（2026-03-25）均引述峰学蔚来公司讣告（心源性猝死），澎湃新闻（2026-03-25）转载郑州大学悼念文章，三家一致；正文已改为多源表述

### douyin-kuaishou

- [ ] 第 1、7 章：快手 2025 年第四季度电商 GMV 5218 亿元、全年约 1.6 万亿元依据的是搜索摘录里的公告原文片段和多家媒体，未直接打开 2026-03-25 公告 PDF；日均使用时长 126 分钟（2025Q4）只见媒体报道。2026Q2 公告（已读原文）未披露 GMV 总额与使用时长
- [ ] 第 1 章：抖音月活 10.29 亿为 QuestMobile《2026 上半年中国移动互联网实力价值榜》媒体转述（凤凰网科技 2026-08-04），未见报告原文；抖音搜索规模截至 2026-11 仍只有 2021 年「5.5 亿」官方数字
- [ ] 第 6 章 `06-permissions.md#电商带货2025-年的分级门槛`：200 / 500 / 1000 有效粉丝门槛仍只有 2025-04 媒体转述，规则中心原文未找到，也未见之后调整的报道；作者保证金改按 IT 之家 2026-02-05 报道写为基础 500 元 + 浮动 + 风险、补缴 3 天（无规则原文）。`ecommerce-selling` 第 2 章、`live-streaming` 第 3 章的保证金说法需与此对齐
- [ ] 第 6 章 `06-permissions.md#快手电商`：快手达人 0 元保证金带货分销依据扬子晚报 2025-02-03 对「十条惠商举措」的报道，2026 年无更新
- 已核：快手 2026Q2（2026-08-19 公告原文）DAU 412.3 百万、MAU 797.3 百万，与 `media-opc-overview` 第 3 章一致，第十节「快手用户数待统一」一条可勾掉

### media-compliance

- 已核（可勾掉第八节第 8 章、第十节对应条目）：国家税务总局 2025 年第 16 号公告原文（法规库，2025-06-26 成文、2025-10-01 施行）——累计预扣法、收入额按 80%、减除费用按「在该平台连续取得劳务报酬的月份数」× 5000、增值税代办申报与小规模优惠、500 万元引导登记；财政部 税务总局 2026 年第 10 号公告（起征点按月 10 万 / 按季 30 万 / 按次 1000 元，3% 减按 1%，执行至 2027-12-31）；国家税务总局 2026 年第 4 号公告（平台代办申报的从业人员适用月 10 万元起征点而非按次 1000 元）。第 8 章「增值税」一节已据此改写（原文按次 1000 元的说法对平台收入不准确）
- [ ] 第 8 章：16 号公告未写预扣率表本身（引用 2018 年第 61 号公告），正文写 3%–45% 七级为据 61 号推定
- [ ] `opc-transition` 第 8 章、`brand-deals` 第 2 章：增值税表述可参照本书第 8 章更新后的口径（平台代办 → 月 10 万；品牌直接付款 → 按次 1000 元）

### brand-deals

- 第 2 章第 16 号公告的依据已从律所解读改为原文核对；本轮只加图（rate-card-ladder.svg、mcn-split.svg），第 2 章其余待核条目未动
- [ ] 第 9 章 mcn-split.svg 的 7 : 3、6 : 4 是演示用假设比例（书中明确没有可靠行业数据），图和正文都已注明，需人确认这种示意是否合适

### topic-and-hooks

- 本轮只加图（structure-timelines.svg、demand-cost-quadrant.svg），第 1、3、4、7、8、9 章的待核条目未动

### ai-content-pipeline

- 04-video.md#截至-2026-年-11-月的格局：Sora 下线已按 OpenAI 开发者文档弃用页核实（2026-03-24 通知，Videos API 与 sora-2 系列 2026-09-24 移除）；网页端 / App 2026-04-26 关闭只有媒体援引帮助中心（help.openai.com 文章 403 未能直接读到）。REVIEW 第 480 行与第 369 节第一条可关闭 API 部分
- 04-video.md 同节：Kling 4.0、Seedance 2.5、Vidu Q4 Preview、wan2.7、Veo 3.1 Lite 的规格与日期来自财联社、新华网、新京报、中国日报和第三方 API 平台；只有 MiniMax H3（2026-07-31）核到官方发布记录。Kling 4.0 API 是否已开放未查到
- 03-images.md#工具怎么选：新增版本清单，gpt-image-2（2026-04）、Nano Banana 2（2026-02）、Seedream 5.0 / 5.0 Pro、FLUX.2 依据为媒体报道；Midjourney V8.2 与 V8 编辑模型已核官方更新公告
- 05-voice.md#tts-选型：MiniMax Speech-2.8 核到官方发布记录；Eleven v4（2026-09-28）只有媒体报道；豆包语音合成 2.0 为 2025-10 发布，2026 年未查到新版本合成模型
- 06-digital-human.md#工具怎么选（WARNING 所在小节）：数字人工具（剪映数字人、腾讯智影、蝉镜、闪剪、硅基智能、HeyGen）本轮未逐一核官网，仍只写名称
- 07 拆章：07-pipeline.md（上，架构与骨架）+ 07-pipeline-stages.md（下，生成步骤、关卡、待发布包）；两篇 H1 都标「第 7 章」上 / 下，以免后面章节的「第 8 / 9 / 10 章」文字引用错位。代码仍未在生产跑过

### ai-drama-storyboard

- 07-video-generation.md#工具对比与选型：Seedance「约 1 元 / 秒」矛盾已改写：说明是媒体按 46 元 / 百万 tokens 折算的估算，当时 2.0 未开 API；补 2.0 mini（23 元 / 百万 tokens，约 0.5 元 / 秒 @720P，东方财富 2026-06）和 2.5 API 2026-08 开放（新京报）。火山方舟模型价格页是 JS 渲染，未能直接读到官方单价
- 07 / 05 同节：Kling 4.0 规格依据界面新闻、财联社 2026-10-16；Vidu Q4 Preview 依据中国日报、新京报 2026-10；价格为首发优惠价
- 05-character-consistency.md#工具的一致性能力对比：Midjourney 改为 V8.2（官方 2026-07-24）与 V8 编辑模型取代 --oref（官方 2026-08-27）；06-image-prompts.md 中 Midjourney `::` 多段权重在 V8 上是否仍有效未核
- 08-motion-comic.md：「运动笔刷」是否仍在各工具未核（维持原写法）

### drama-distribution

- 03-filing-review.md#政策演变为什么会有三套说法：35 号文已在 nrta.gov.cn 核到原文（广电办发〔2024〕35 号，落款 2024-02-05，2025-02-05 官网公开，2024-06-01 起未经审核且备案不得上网，重点含「平台招商主推 / 首页首屏推荐」）。REVIEW 第 280–281 行文号部分可关闭；drama-scriptwriting、micro-drama-industry 等书写「2025 年 2 月通知」「35 号文」的地方可按此统一
- 03-filing-review.md 同节：2026-06-25《管理提示（AI 微短剧分类分层标准）》80 万 / 30 万在 nrta.gov.cn 站内搜索未找到原文，仍只有新华社、澎湃等转述，维持并标注
- 03-filing-review.md#材料清单：按办法第十九条原文补了一类送审五项材料；办法第二条「少于二十分钟」、第四十六条「可以并处十万元以下罚款」（只针对偏离备案 / 许可、转移送审）、第五十二条第二款「在境内拍摄、用于境外播出」均已核原文，可用于处理 REVIEW 第 466 行 micro-drama-industry 的罚则与时长口径冲突；办法未写废止 35 号文
- 04-ai-drama-rules.md#2026-年清理潮的教训：补了总局官网可查的 2026-06-01 专项治理（两个月、八类问题，原文未提 AI）；过审率不足三成、7 万部清退、补审仍为媒体数字
- 08-copyright.md：(2023)京0491民初11279号、2023-11-27 判决已由多家律所和法律媒体交叉确认，判决原文仍未核
- 05、06 章平台入驻、分账、费率维持结构写法，本轮未找到官方数字

### brand-deals

- 02-platforms.md「星图结算」附近（约第 92 行）：「小规模纳税人开 3% 专票」是星图平台对开票的要求，和 2026–2027 年小规模纳税人减按 1% 计征的优惠不冲突（专票可放弃减免按 3% 开），未改；如需写明两者关系请人工复核星图帮助中心原文。

### live-streaming

- 03-before-going-live.md 开播门槛列表：快手只补了「2025-02 新入驻达人 0 元保证金带货」（媒体报道，链接到 douyin-kuaishou 06#快手电商），快手开播 / 带货的粉丝门槛仍未查到官方说明。


## 十三、全库体检第五轮：去重与练习（2026-11-04）

50 本技术书 428 章新增「动手练习」，共约 1270 题。给出具体输出的题大多在本机实跑过；以下几类没有实跑，题里只写了要观察的现象，读者照做时若与题目不符，以实际为准并回来改题：

- [ ] 需要 Docker 的题（本机当时 Docker 未运行）：Postgres / pgvector（llm-app 07、llm-evals 07、llmops 03/04/08、rag 03/04/05、database-practice、database-ops、system-design 03–08）、容器 OOM / PID 1、observability-performance 的 Prometheus / Alertmanager 镜像 tag（凭记忆）
- [ ] rust-practice 全部练习未编译（本机无 rustc），只写了有把握的错误码
- [ ] 凭记忆写死的输出：k6 阈值失败退出码 99、`ERR_PNPM_OUTDATED_LOCKFILE`、SOPS `MAC mismatch`、OpenTofu `Instance cannot be destroyed`、Redis 的 OOM / NOPERM 前缀
- [ ] deepseek-harness 练习按书中 0.2.1 行为写，未装 DSH 验证；kubernetes、self-hosting、nginx-gateway、networking、linux-essentials 的练习均未在真机跑过

出题过程中发现的正文问题：

- [x] `llm-app-engineering/05-streaming.md` 控制器用 `req.on("close")` 中止上游：POST 请求体读完后 req 的 close 立即触发。已改为 `res.on("close")` + `!res.writableFinished`。其他书里 GET 型 SSE 的 `req.on("close")` 实测在客户端断开时才触发，未改
- [x] `agent-safety/06` 查「污染后被拒」会话的 jq 管道永远匹配不上，已改为 `(.event.decision // .event.type)`
- [ ] `nestjs-backend/01`：去掉 `emitDecoratorMetadata` 后正文说启动报错，实际可能是注入成 undefined、请求 500；`02`「AsyncLocalStorage 包在订阅外面会拿到 undefined」在新版 Nest 下可能不成立
- [ ] `computer-systems` 伪共享：M3 Pro 缓存行 128 字节，实测隔开 64 字节已不再互相拖慢，正文「隔开一个缓存行」的说法可补一句
- [ ] `deep-learning-basics/08` 的 `targets.view(-1)` 遇到不连续张量会报错（书中流程碰不到）；`02`「卡住次数」手写版与 nn 版结果不同；`05` 第 3 题「打乱像素后 CNN 领先缩小」未验证
- [ ] 书中代码的边界 bug 改成了练习题、正文未改：`tools-and-mcp/05` `read_chapter` offset 越界、`context-engineering/05` `runSearch` 返回「第 11–10 处」、`agent-safety/06` redact 漏 `export` 前缀和小写 YAML 键、`coding-agents/06` boundary 正则漏动态 `import()` / `require()`

去重：

- [ ] `system-design/04` 的 65 行 worker 循环保留：redis-jobs 06 在它之上扩展、自身没有 worker 代码。是否把它搬进 redis-jobs 由作者决定
- [ ] `agent-principles/01` autonomy-spectrum（系统形态谱系）和 `build-your-agent/07` approval-matrix（同一工具在三种运行方式下的处理）与主图内容不同，保留
- [ ] 有效时薪统一到 skills-to-business 04 的口径（可计费 48%）后，opc-transition 02/03/08、employee-to-owner 04 的日费率、报价、项目款、记账示例都按新口径重算了，建议通读一遍这几章

## 十四、收尾轮：中低优先级书更新、新章节与第九批大纲（2026-11-04）

第五节「中」「低」优先级的书按一手来源核实修订；新增章节见 AUDIT 第七节。`[ ]` 待复核，`[x]` 或「已核」表示本轮已核实、前面对应条目可勾掉。

### api-design

- `07-openapi-codegen.md#openapi-32要不要升`（新增）：OpenAPI 3.2.0 的发布日期和新增字段按 spec.openapis.org 和 OpenAPI Initiative 公告核实；`@nestjs/swagger`、`zod-openapi`、`openapi-typescript`、`oasdiff`、Prism 各自对 3.2 的支持没有逐一核对
- AUDIT 第五节建议的「10 补 API 暴露成 MCP」本轮未做（不在本轮分配范围内）

### auth-payments

- `08-stripe-iap.md#app-外付款美区外链与-google-play-替代计费`（新增）：Google 美区替代计费 / 外部内容链接的上报起始日（2026-10-01）、下载上报延期到 2027-02-01、服务费 10% 起、结算费 5% 均按 Play 管理中心帮助页和 2026-06-24 Android Developers Blog 整理；非订阅类交易的服务费率表在官方博客里是图片，没有取到具体数字，正文未写。逐笔上报的时限（第三方资料说 24 小时）没有在官方页面上直接看到，正文只写「按各计划要求」
- 同节：「跳转时记 link_out 以备将来按 7 天窗口报数」是设计建议，美区 Apple 外链费用和是否需要上报尚无定论

### redis-jobs

- `01-data-structures.md` 版本约定表：Redis 8.10、Valkey 9.1、BullMQ 6、pg-boss 12 按 GitHub releases / npm 发布时间核实；示例仍用 `redis:7.4-alpine`，换 8 系「一般也能跑」未实测
- `05-bullmq.md#bullmq-6-改了什么`（新增）：按 docs.bullmq.io Changelog 整理 6.0 破坏性变化和 PostgreSQL 后端，未在本书示例上实际升级；`@nestjs/bullmq` 12 对 BullMQ 6 的支持只看了 npm peerDependencies
- `06-postgres-queue.md#pg-boss`：导入改为 `import { PgBoss } from "pg-boss"`（v12 去掉默认导出）；其余选项（`retryLimit`、`retryBackoff`、`deadLetter`、`singletonKey`、`startAfter`、`schedule` 的 `tz`）按 v10 写法保留，v11 / v12 是否改名未逐项核对
- `09-ops-monitoring.md#怎么选` 一带：「字段级过期」作为选 Redis 的理由已不成立（Valkey 9.0 起支持，Linux 基金会 2025-10 公告），已改；两边 HFE 命令参数细节是否完全一致未核对
- `09-ops-monitoring.md`：compose 示例镜像从 `valkey/valkey:8-alpine` 改为 `9-alpine`（Docker Hub 上标签存在），未实际启动验证

### system-design

- `04-queues-jobs.md#持久化执行把多步流程交给引擎`（新增）：DBOS、Temporal、Restate、Inngest、Trigger.dev、Cloudflare Workflows、AWS Step Functions 的形态按公开介绍概括，未部署验证；示意代码不对应任何一家 SDK
- `05-realtime-push.md#android-和国内厂商通道`（新增）：华为消息分类按华为开发者文档（未申请自分类默认资讯营销、每设备每日 2 或 5 条）概括，正文未写具体条数；其他厂商「也有类似分类和限额」只有第三方（个推）文档佐证

### computer-systems

- `04-virtual-memory.md#android-的-16-kb-页`：已按 developer.android.com 现行页面改为「targetSdk 35+ 的应用，2027-02-01 起不兼容的更新无法发布」。此前流传的 2025-11-01 / 2026-05-31 截止日期在现页面上已不再出现，说明推迟过；以 Play 管理中心提示为准
- `01-data-representation.md`：Node 22 仍在 LTS、最新 LTS 为 Node 26，按 nodejs.org Releases 页面整理；页面上「最后更新」一栏不是 EOL 日期，Node 22 的确切 EOL 未写

### git-deep-dive

- `04-rewrite-rescue.md#git-history更直接的改写命令`：`git history` 2.54 引入（reword、split）、2.55 加 `fixup`、2.56 加 `drop`，按 RelNotes 2.55.0 / 2.56.0 和 GitHub 博客核实；Git 3.0 无确定发布日期按 BreakingChanges 文档。二手报道称「Git 3.0 计划 2027 年春」，没有一手来源，正文未写
- 输出里的 40 位哈希已截成 7 位；`hash-object` / `shasum` 对照、`.git/refs` 文件内容、`.git-blame-ignore-revs`（要求完整 ID）、练习答案里的完整 blob ID 保留全长，并在第 1 章加了一句说明

### go-practice

- `01-ts-to-go.md#go-127-带来了什么`（新增）：按 go.dev/doc/go1.27 整理；本机只有 Go 1.26.5，`uuid.NewV7`、`strings.CutLast` 示例没有编译过（API 签名按 pkg.go.dev 核对）
- `03-structs-interfaces-generics.md`：泛型限制表里「方法自带类型参数」一行改为「1.27 起可以，接口方法仍不行」，书里其余泛型代码未在 1.27 上重跑

### rust-practice

- `01-why-rust.md#edition-2024-的新写法`（新增）：let chains（1.88，仅 2024）、异步闭包和 `AsyncFn`（1.85）等按发布说明和 Edition Guide 整理；本机无 rustc，示例（尤其 `retry` 里异步闭包配合 `?` 的类型推断）未编译
- 版本约定改为「最新稳定版 Rust 1.99（2026-10-01），补丁版 1.99.1（10-15）」，按 blog.rust-lang.org/releases

### markdown-cheatsheet

- 全章重写为「写法 | 效果」速查，规则以 books/AGENTS.md 为准；`\$` 转义在 `@vscode/markdown-it-katex` 下实测有效，提示块、表格转义竖线在 markdown-it 下渲染核对过，未在 App 里实机看

### shelf-guide

- `01-welcome.md` 首句「离线的 Markdown 阅读器」按要求未改，仍待作者决定（REVIEW 已有条目）
- `03-rendering-showcase.md`：Go 示例改用 `wg.Go`（Go 1.25 起，本机 1.26.5 编译运行通过）；新增 `assets/squares.svg` 作为 SVG 回归用例，qlmanage 预览无重叠。两本都是 App 内置示例书，需要 `pnpm app build:assets` 后才进安装包

### reading-map

- 书数核对：`shelf-pack ls` 共 98 本 = 96 本（与 01 的系列表、08 的进度表一致）+ shelf-guide + markdown-cheatsheet；各系列章节覆盖的书与分类一致
- `07-reading-paths.md`：第一到第六批的书名全部改成链接；`01-how-to-use.md`「接下来五章」改为六章
- `09-media.md` 文件序号与阅读顺序不一致：改文件名会让已有的阅读进度、高亮和笔记失去对应，本轮未改，需作者决定是否重命名

### business-basics

- [ ] 第 5 章 `05-unit-economics.md#一单面馆的堂食和外卖`：外卖费用结构改按中国新闻网「民生调查局」2026-03-13 北京商家个案（技术服务费约 6%、3 公里内商家承担基础运费 3.5 元、7 元红包后 20 元单到手不足 4 元）；京东外卖 2026-01-01 起收佣、淘宝闪购部分地区新签合同佣金上调 0.2%–1% 来自同文及投中网 2026-02-10（商家爆料）。都是媒体个案，没有平台公布的统一费率
- [ ] 同上：《外卖平台补贴行为规范十条（征求意见稿）》是 2026-06-17 市场监管总局公开征求意见（财联社），截至 2026-11 没查到正式发布；搜索摘要里有些媒体把时间写成 2025 年，以财联社 2026-06-17 报道为准
- 第 7 章 `07-competition.md#算一笔价格战的账`：新增两家面馆价格战算例，全部为假设数字，按第 3 章公式可复算

### company-basics

- 第 7 章 王蕾担保案例的具体年份已改成「开业第二年 / 第四年」，第十节对应条目可勾掉
- [ ] 第 5 章 6 个 WARNING 没有合并：硬规则要求 WARNING 放在所在小节开头，6 个分属不同小节，合并会违反规则，建议维持

### skills-to-business

- 第 5 章 `05-first-clients.md#先把三份文件找出来`：已按最高人民法院官网原文补《劳动争议司法解释（二）》第十三至十五条（2025-09-01 施行）。《反不正当竞争法》2025 年修订、2025-10-15 施行只核到施行日期，没打开新法原文确认商业秘密条款的条号（正文没写条号）
- 第 7 章 `07-from-time-to-leverage.md#ai-助手的位置`：重写为 2026 年版本，不点具体产品；对 AI 能力的描述是概括性判断，没有一手来源

### opc-transition

- 第 8 章 `08-side-income-tax.md#增值税自然人也可能要交`：口径已与 media-compliance 08 对齐，补了 2026 年第 10 号公告全称、发布日期和「3% 减按 1%」。依据是 media-compliance 那边已核实的原文，这一轮没有再打开公告
- [ ] 第 5 章 `05-social-insurance.md#购房购车落户入学看连续两个字`：北京《关于进一步优化调整本市房地产政策的通知》（住建委、规自委、公积金中心，2026-08-07 印发、08-08 施行）条文按科技日报 2026-08-08 报道引用（「五环内……购房之日前连续缴纳满 1 年及以上」），财联社同期报道一致；住建委官网原文没打开。「五环外此前已是 1 年」只见同花顺等转述（称 2025 年 12 月调整），正文写成「据同期报道」

### opc-action-plan

- 第 1 章：「9–18 个月」第一轮已改成 8–16 / 21–31 个月，这一轮按各章周期复算无误；新增 stage-timeline.svg（各阶段最短 / 最长首尾相接的时间条）
- 第 2、6 章：ecoi.net 的条文链接已删，改为指向国家法律法规数据库，第七、十节对应条目可勾掉；第 2 章顺带补了司法解释（二）第十三条
- [ ] 第 4 章 个人收款码 2022 年之后有无新规，这一轮没查

### opc-cases

- [ ] 第 5 章：V2EX 回访只看了 noconfuse、pbk、Eyon 主题列表第一页，部分日期不带年份。noconfuse 2024-10 发过求职帖；pbk 2024-07 之后没有点餐软件的新帖；Eyon 第一页没有云店管的后续。fingal、MioMioOs 没回访
- [ ] 第 7 章：「是否已出售」只查到「没有出售消息」——TypingMind（Tony Dinh 2026 年在 Product Hunt 发「重新发布」帖）、HeadshotPro（官网 about 页仍署他为创始人，自述累计收入 1,000 万美元以上，已写入正文）、Chatbase、PDF.ai。PDF.ai 当年买下代码库约 2 万美元只见第三方转述，没写进正文

### opc-playbook

- 第 4 章缩成导读：保留三条路径、跑道公式和图、模拟脚本（opc-action-plan 06 依赖它）、辞职信号；副业边界、主体、事务清单压短并指向专门章节，副业边界补了 WARNING。外部链接的锚点 `#副业期间的边界`、`#心理上的落差` 保留。第一节第 23 行对应条目可视为已处理
- 第 7 章：各模式后加了指向 opc-cases 对应章节 / 案例的链接

### wolf-way

- 第 9 章 `09-stories.md#后来的研究怎么说`：新增「流行版 vs 多因修正版」两张 TD Mermaid 图，内容只用本章已引用的研究，没有新的事实

### design-for-devs

- [ ] `06-mobile-guidelines.md#ios-26liquid-glass`：「UIDesignRequiresCompatibility 用 iOS 27 SDK 构建后不再生效」依据是 Apple 开发者论坛 thread/832710 上标为 Apple Staff 的答复（2026-06），Apple 文档页本身未能读到正文；「玻璃只用在控件层」按 HIG / WWDC25 的通行表述，未逐字核对 HIG 页面
- [ ] `06-mobile-guidelines.md#androidedge-to-edge-成为强制`：Android 16 停用 `windowOptOutEdgeToEdgeEnforcement` 按 developer.android.com 行为变更页；Expo SDK 54 起不能关闭按 expo.dev/changelog/sdk-54。`expo-glass-effect` 的 `isLiquidGlassAvailable()` 按 SDK 58 文档搜索摘要，未在真机验证

### product-analytics

- [ ] `08-when-not-to-track.md#网络数据安全管理条例里和埋点相关的几条`：第二十一、二十二、二十四、六十四条按网信办网站全文（cac.gov.cn/2024-09/30）摘取，经抓取工具转述，个别措辞以原文为准
- [ ] `08-when-not-to-track.md#apple-的隐私清单`：2024-05-01 起新增名单内 SDK 需带隐私清单与原因声明，依据是 Apple Developer News 2024-04 公告的搜索摘要；隐私清单文档页为 JS 渲染未能读到正文，四个键名凭记忆；「hatch-shelf 的 NSPrivacyAccessedAPITypes 多半要填几项」未在本项目构建中核对

### ai-native-opc

- `08-org-design.md#一个月度成本算例`：新增算例，单次花费均标为示例假设，content-draft / finance-recon 两条工作流为假设，无需核实；模型单价未写

### copywriting-content

- [ ] `03-landing-page.md#证据凭什么信你`：《广告法》第二十八条引文按君合等律所解读转述，未打开全国人大现行文本逐字核对
- `07-ai-writing.md#诚实的边界`：《人工智能生成合成内容标识办法》第十条按网信办网站全文核对（施行日 2025-09-01）；02 章唯一的 LR 流程图已改 TD

### ecommerce-selling

- 02-showcase-and-alliance.md#2026-年的变化佣金下限-5：「佣金下限 5%」已在抖音电商学习中心《精选联盟推广费/服务费结算规则》（2026-07-30 公示、08-05 生效，页面 2026-10-12）核到：各推广策略费率区间 5%–50% / 5%–80%，附录 1 特殊类目最低 1%。REVIEW 第 474 行「佣金下限 5%」可关闭；但 2026-03-04 新规公告原文和 4-01 / 4-15 分批生效仍只有北京日报、亿邦动力报道，「店铺授权账号 / 混合经营账号」例外路径规则原文里没看到
- 02-showcase-and-alliance.md#计算：「达人佣金扣 10% 技术服务费」已按同一规则改正：站内推广按经营评级 A / B+ / B 10%、C 20%、D 40%，站外 10%；结算改为确认收货 15 天后、可冻结近 15 天佣金 5% 作预留金。REVIEW 第 474 行「10% 技术服务费」可关闭（04 章例一同步改了说明）
- 第 6、7、8、9 章原有待核条目本轮未处理

### knowledge-products

- 06-platforms.md#自建店铺的-saas小鹅通：已按小鹅通官网定价页（xiaoe-tech.com/server_price，2026-11 查看）改正：AI 基础 / 专业 / 旗舰版 6800 / 12800 / 25800 元，私域虚拟商品免收额度 12.5 万 / 25 万 / 62.5 万（原第三方数字 25 / 50 / 125 万，现减半），超出收 2%；公域引流订单 2%。第 6 章到手收入图按 3 万 / 10 万计算仍在免收额度内，数字不变
- 06-platforms.md#小报童：15% 服务费、24 小时退款仍只有第三方（ai-bot.cn、CreatorCut），官网无公开费率页，维持原说法
- 06-platforms.md#视频号--微信小店：教培类目「禁止 AI 商业变现课程」补了 AIbase 第二家媒体报道，规则原文仍未找到；抖音课程类目费率仍未找到官方原文

### paid-traffic

- 04-qianchuan.md#20252026-年的变化全域推广成为主流：巨量千川帮助中心、规则中心、抖音电商学习中心都没找到标准推广下线公告。现有三个时间点：品玩 2025-03-18 转述官方「年内推商品 100% 升级全域」；蝉妈妈（亿邦动力 2025-05-07）称 5-22 起推商品标准推广停止操作；搜狐称 2025-12-29 全面下线。正文已改成不下具体日期的写法；规则中心仍挂「标准投放成本保障规则」，推直播是否还有标准推广入口未确认

### micro-drama-industry

- 05-revenue-sharing.md#分成系数：补 2026-07 抖音版权中心更新（腾讯新闻 2026-07-29：仿真人 / 3D / 2D 维持 40，解说漫 1→10，热度阶梯奖励最高 20 万）和 4 月调整的完整系数（澎湃号 2026-05-02：解说漫 5→1，2D 40、表情包 10 不变）。「推测为百分比」已删，改为「单位未公开、相对乘数」。仍无版权中心通知原文；8–10 月未查到新调整
- 08-policy-trends.md#罚则：已按办法第四十四至四十九条（drama-distribution 第 3 章已核原文）改写，REVIEW 第 466 行罚则部分可关闭；01 章「不超过 20 分钟」改为第二条「少于 20 分钟」

### drama-scriptwriting

- 08-adaptation-and-selling.md#平台的编剧征集：红果 2025-08 剧本评级表保留，补 2026 年零散报道（虎嗅转载最话 FunTalk 2026-06-01：AI 仿真人剧本取消保底改 20% 分成的传闻及红果否认；真人剧按剧本 / 编剧等级最高 10 万保底金、B 级剧启动金 20–30 万）。2026 年完整评级表未找到
- 著作权法第十、十三、十九条条号与 2020 修正版一致（凭对法条的了解，未打开数据库原文）

### ai-drama-post

- 02-voice-rights.md#法律上的几条底线：深度合成规定已在中国网信网核到原文条号——第十四条第二款（人声编辑单独同意）、第十七条第一款第（二）项（合成人声、仿声显著标识），REVIEW「凭记忆，无条号」可关闭
- 拆章：02-voiceover.md 的「合同里要写清的授权」「音色克隆：授权与合规」移到新章 02-voice-rights.md，新增「先分清三样东西」「几种常见情形」「授权材料怎么归档」三节（作者整理的做法，无新事实数字）

### creator-tools

- 09-dont-do.md#三爬取平台数据：「被平台以不正当竞争起诉的先例」补了新浪微博诉脉脉、大众点评诉百度地图两案（凭已有知识写「2016 年前后判决」，判决书原文未打开）

### electron-desktop

- [ ] `06-packaging-signing.md#配置`：原说法「`APPLE_API_KEY`（.p8 文件路径）」。`app-builder-lib@26.18.0` 源码把它原样交给 `@electron/notarize`，后者 README 要求填 .p8 绝对路径，正文维持「路径」；但 electron.build 文档站 v26 公证页写的是 base64 编码的 .p8 内容（v27 文档说两种都行），二者不一致，需要用真实账号实测一次确认
- [ ] `06-packaging-signing.md#macos-签名为什么不能不签` 与 `07-auto-update.md#先决条件签名`：「签名未公证也能自动更新」（signing-levels 图里「开发者证书 → 自动更新：能」）。Electron autoUpdater 文档只写「macOS 上必须签名（Squirrel.Mac 要求）」，没提公证；正文已标为推断，未实测
- [ ] `06-packaging-signing.md#不签名为什么不行`：「不签名在苹果芯片上不能稳定运行、系统随时可能杀掉进程」。`@electron/fuses` README 写明 arm64 上改过不重签会因签名校验错误拒绝启动，部分佐证；「随时被杀」的具体表现仍是推断，正文已注明
- [ ] `05-native-integration.md#钥匙串safestorage`：Electron 45 弃用同步 `safeStorage` 方法、46 计划移除（Breaking Changes 页已核实）；异步版 `encryptStringAsync` 等从哪个版本开始提供、44 里能否用，官方 API 页没写版本，未核实
- [ ] `06-packaging-signing.md#electron-builder-怎么配`：electron-builder 26.18 的 `azureSignOptions` 内部仍调用 PowerShell 模块 `TrustedSigning`（`Invoke-TrustedSigning`），微软已把服务更名为 Artifact Signing；改名后该模块是否继续可用、electron-builder 是否会改名，未查到说明。是否必须在 Windows 主机上构建也未核实（正文写「通常在 Windows 的 CI 机器上构建」）
- [ ] `06-packaging-signing.md#选哪种方式`：Artifact Signing「每月 9.99 美元起」引自 Microsoft Learn 的 SmartScreen 页，未打开 Azure 定价页核对
- [ ] `03-security.md#对照唱片墙做了什么为什么没做什么`（REVIEW 第 53 行 hatch-recordwall 条目）：「IPC 不校验发送方；`net:fetch` 接受任意 URL；只读令牌经 preload 交给页面」。书中把前两条标为「可改进」、令牌标为「知情的取舍」，并写明前提（只加载自打包代码、封死导航）和前提变化时要补什么，表述恰当，未改；是否仍是 hatch-recordwall 现状需对照仓库代码

### frontend-engineering

- `02-css-layout-cascade.md#新特性与兼容性线`：新写的「锚点定位：核心属性 2026 年 1 月（Firefox 147）起新近可用，整体仍未达 Baseline」。依据是 web-features 3.45：整体特性 status=false（只列 Safari 27），但 `anchor-name`、`anchor()`、`position-area`、`@position-try` 各自 baseline low 2026-01-13；`position-anchor` 属性要到 2026-09（Chrome/Firefox 151、Safari 27）。MDN 页面上的标记可能随 web-features 下一版变化，需人看一眼 MDN 当前显示。
- `02-css-layout-cascade.md#新特性与兼容性线`：`popover` 写成「2025 年 1 月起新近可用」，来自 web-features（因 iOS Safari 18.3 才算完整支持）；常见说法是 2024 年 4 月。两种口径都有，按 web-features 写。
- `08-eslint-prettier.md#oxlintbiome-与-oxfmt`：Oxlint 类型感知覆盖「61 条中的 59 条」取自 oxc.rs 文档；tsgolint 仓库 README 写的是「62 条中 60 条」，口径不一，正文已注明。
- `08-eslint-prettier.md#oxlintbiome-与-oxfmt`：Oxfmt「0.x，2026 年 2 月进入 beta」——beta 公告是 2026-02-24 的 Oxc 博客；之后没找到 stable 公告，当前 npm 版本 0.76.0（2026-11-03），「仍是 beta」是按版本号推断。「通过 Prettier JS/TS 一致性测试全部用例」是项目方自述（VoidZero 2026 年 2 月月报），未见第三方验证。

### going-global

- [ ] `08-overseas-clients.md#服务出口的增值税零税率和免税`：新章按《增值税法实施条例》（国务院令第 826 号）第九、四十八、四十九条，财政部 税务总局公告 2026 年第 11 号，国家税务总局公告 2026 年第 5 号整理（条例原文在税务总局政策法规库核对；第 11 号、第 5 号公告是经 WebFetch 摘要读的，没有逐条看原文）。财税〔2016〕36 号附件 4、国家税务总局公告 2016 年第 29 号是否已明文废止没查到（第 5 号公告的废止清单在附件 xlsx 里，未打开），正文写了「未查到确切说法」
- [ ] `08-overseas-clients.md#备案和要留的资料`：「第 11 号公告对部分跨境服务，未签书面合同或未取得收入按征税处理」来自公告摘要（第七条第（一）项第 8 目附近），适用的服务范围未逐字核对；跨境服务免税是否需要备案还是留存备查，第 5 号公告正文没写明
- [ ] `08-overseas-clients.md#以个人身份接单`：自然人偶尔接海外单的增值税处理（按次 / 按期、能否免税、是否代开）没有查到专门规定，正文写了依据有限
- [ ] `08-overseas-clients.md#哪些服务落在哪一边`：「技术咨询、架构评审 → 鉴证咨询或专业技术服务 → 免税」是按税目名称粗略对照，正文已要求让代账按税目注释确认
- [ ] `08-overseas-clients.md#境内所得没有扣缴义务人要自己申报`：远程接单按实施条例第三条属境内所得、没有扣缴义务人时个税法第十三条第一款「次月十五日内」与第十一条综合所得汇算的关系，实务口径未查到统一说明，正文写了依据有限。注意：第 7 章 `07-tax-and-remittance.md#居民个人的全球所得` 把个人在 App Store / MoR 的收入一律称为「境外所得」，与来源地规则（特许权按使用地、劳务按提供地）是否一致值得复核
- [ ] `08-overseas-clients.md#个人5-万美元的年度便利化额度`：5 万美元和第二、四、十、二十五条按外汇局官网刊载的汇发〔2007〕1 号 PDF 原文核对；「额度按自然年、年末清零」来自外汇局厦门市分局服务小贴士（搜索摘要）；「关注名单当年及之后两年不享有额度」来自银行和分局公开说明，未打开 2015/2016 年那份外汇局通知原文，正文未写文号
- [ ] `08-overseas-clients.md#选收款服务商时要问的问题`：Wise / Payoneer 对中国大陆居民的开户准入、可收币种、回流方式没有在官方页面核实，正文只列了要问的问题、未写结论
- [ ] `08-overseas-clients.md#知识产权归属`：美国「work made for hire」对独立承包人的默认规则、`#适用法律与争议解决` 中纽约公约的表述凭常识写，未核对原文；《涉外民事关系法律适用法》第四十一条凭记忆，未打开 flk.npc.gov.cn 原文

### growth-marketing

- [ ] `09-activation-paid.md#中国大陆区能不能投`：新增章节。依据 ads.apple.com「Advertise in Mainland China」帮助页、Countries and Regions 页和《Apple Advertising Guidelines for mainland China》（July 2026 PDF）：主体与 App 需审核、个人需个体工商户营业执照、非企业主体可能不能投放 Books/Periodicals 等类别、产品页广告位在大陆不可用。未查到：Apple Ads Basic 能否投放大陆；书巢这类「阅读用户自己文件」的 App 会被归入哪个类别、需哪些资质。正文已写依据有限
- [ ] `09-activation-paid.md#名字和投放位置`：Apple Search Ads 改名 Apple Ads 的时间（2025 年 4 月）来自 9to5Mac、Search Engine Land 等媒体报道，未找到 Apple 官方新闻稿原文；官网现已统一用 Apple Ads、searchads.apple.com 301 跳转到 ads.apple.com 已确认
- [ ] `09-activation-paid.md#出价`：「实际扣费可能低于最高出价」来自 Apple Ads 词汇表（搜索摘要转述，未打开原页逐字核对）；Maximize Conversions 需打开 Search Match、目标 CPA 仅限搜索结果广告位，按 Compare Solutions 和 Ad Placement Options 页
- [ ] `09-activation-paid.md#归因adservices`：令牌 24 小时 TTL、POST 端点、404 重试建议、30 天点击 / 24 小时浏览归因窗口、年龄性别广告组返回 false 按 developer.apple.com AdServices 文档 JSON 核对；「数据保留 21 天」按 ads.apple.com 归因概览页。是否需要 ATT 授权未核实，正文未提
- [ ] `09-activation-paid.md#其他付费渠道简述`：Google App Campaigns 按 Google Ads 帮助中心 6247380 页整理；Meta 应用推广和国内安卓商店推广规则未核实，正文已标依据有限
- `09-activation-paid.md` 全部算例（激活率 35%、付费率 15%、到手 20 元、CPT 2 元、点击到安装 40% 等）均标为示例假设，没有引用任何行业平均 CPT / CPI
- 章节位置：08-channel-evaluation 是收尾章，但其他书有十余处写「《获客与增长》第 8 章」指渠道评估，插到 08 前会让这些章号全部错位，所以新章追加为 09，并在 08 的「接下来读什么」补一句指向第 9 章；01 的章节表改为九章。若希望全书回顾留在最后一章，需要另行调整

### iac-gitops

- [ ] `03-ansible.md#升级到-ansible-core-219-以后`：2.19 的破坏性变更已按官方 Porting Guide for ansible-core 2.19 和 ansible/ansible GitHub releases（2.19.0 发布于 2025-07-21，Ansible 12 捆绑 2.19，写作时最新 2.22.0）核对，`ANSIBLE_ALLOW_BROKEN_CONDITIONALS` 已在 stable-2.19 的 base.yml 里核对；但本章 playbook 没有在 2.19+ 上实际跑过，只按规则逐条对照。顺带把证书任务的 `acme_staging | default(false)` 改成加 `| bool`（命令行传 `-e acme_staging=false` 时是字符串真值）

### cloud-and-edge

- [ ] `06-wrangler-deploy.md#静态站workers-static-assets`：「新项目从 Workers 开始」按 Cloudflare Pages 文档首页的提示原文；`not_found_handling` 的 `404-page` 取值凭记忆（binding 页只出现了 `single-page-application`），未部署验证
- [ ] `05-storage-primitives.md#workflows拆成步骤的长任务`：GA 日期（2025-04-07）、默认重试（5 次、10 秒、指数退避、10 分钟超时）、2026-07 计费调整按官方 docs / changelog；示例代码（`WorkflowEntrypoint`、`step.do` 的重试参数写法）未在 wrangler 里实际部署
- [ ] `05-storage-primitives.md#containers跑不进-isolate-的代码`：GA（2026-04-13，Workers 付费套餐，按活跃 CPU 计费）按官方 changelog；「冷启动秒级」是概括，未实测

### observability-performance

- [ ] `03-tracing-otel.md#在-nestjs-里接入`：已按 OTel JS 3.0.0（2026-10-20 发布）改写，`sdk-trace-base` → `sdk-trace`；`parentSpanContext` 示例在本机 Node 22.23 + sdk-node 0.300.0 上跑通。完整的 NestJS + auto-instrumentations-node 0.82 接入没有跑过
- [ ] `02-metrics-prometheus.md#另一种接法用-otlp-把指标推给-prometheus`：`--web.enable-otlp-receiver`、`/api/v1/otlp/v1/metrics`、`promote_resource_attributes` 按 prometheus.io 的 OpenTelemetry 指南；`OTEL_METRIC_EXPORT_INTERVAL` 是否被 NodeSDK 读取凭记忆；整套配置没有在容器里跑过（本机 Docker 未运行）

### database-ops

- [ ] 全书基线从 PG 16 改为 18：镜像改 `postgres:18-alpine`，挂载点改 `/var/lib/postgresql`、数据目录 `18/docker`（按 docker-library/postgres 18 的 Dockerfile 和 entrypoint 源码核对，挂旧的 `.../data` 会 exit 1）。各章练习和 `03-wal-pitr.md` 的恢复步骤（`/pg/18/docker` 路径、`chown -R 70:70 /pg/18`）、`04-replication.md` 的 `pg_basebackup -D /var/lib/postgresql/18/docker` 都没有在 18 上实际跑过（本机 Docker 未运行），建议跑一遍
- [ ] `03-wal-pitr.md#不装工具的折中原生增量备份`：`--incremental`、`pg_combinebackup -n/-o`、`summarize_wal`、`wal_summary_keep_time` 默认 10 天按 PG 18 文档；「pg_combinebackup 读的是目录（plain 格式）」文档没有明说，未实测
- [ ] `08-major-upgrade.md#18-带来的变化以及-19`：练习 1 里 18 镜像报错的具体文字按 entrypoint 源码概括，未实际运行；PG 19 写作时为 RC1（2026-10-15）
- [ ] `07-vacuum-bloat.md`：18 起 `autovacuum_max_workers` 可在 `autovacuum_worker_slots` 内重载调整，按 18 Release Notes 与参数文档

### production-ops

- [ ] `07-user-files.md`（新章）：R2 不支持版本控制 / Object Lock、桶锁、`wrangler r2 bucket lifecycle|lock add` 语法、预签名 URL 1 秒到 7 天且不支持 POST 均按 Cloudflare 官方文档核对；rclone 练习（`--backup-dir`、`--max-delete` 超限报错）本机未装 rclone，未实际运行；`rclone check --download` 等参数凭 rclone 文档记忆
- [ ] `07-user-files.md#删除请求真的删干净`：个保法第四十七条（含「技术上难以实现」时停止除存储和必要安全保护之外的处理）按最高检门户网刊载的法律文本核对
- [ ] 新章插在 07 之后，检查清单变成第 9 章，书内「第 8 章（清单）」的文字引用已统一改成「第 9 章」

### app-security

- [ ] `07-server-compromise.md`（新章）：《国家网络安全事件报告管理办法》（2025-11-01 施行，一般运营者「较大以上」事件 4 小时内报属地省级网信部门）按中国网信网刊载全文核对；个保法第五十七条按法律文本；练习 1、2（`docker diff`、`/proc/*/exe (deleted)`）本机 Docker 未运行，未实际跑过，`docker diff` 的具体输出行需复核
- [ ] 新章插在 07 之后，安全自查清单变成第 9 章，01 的「怎么读」已同步

### self-hosting

- [ ] `08-email.md#spfdkimdmarc`：只加了一张 SPF/DKIM/DMARC 验证时序图和一段 DMARC 对齐说明，无事实性变更

### linux-essentials

- [ ] `06-package-management.md#ubuntu-2604-换了哪些底层工具`：sudo-rs / rust-coreutils（cp、mv、rm 仍为 GNU）、chrony、systemd 259、OpenSSH 10.2、内核 7.0 按 Ubuntu 26.04 官方「Summary for LTS users」整理；「sudo-rs 下常见 sudoers 写法照常生效」「通过 update-alternatives --config sudo 切回 sudo.ws」只有二手来源（Ubuntu Server Docs 的 sudo-rs 页未抓到），需在 26.04 机器上实测

### networking

- [ ] `08-ipv6-dual-stack.md#国内的-ipv6-现状`：8.69 亿活跃用户、移动 70.85% / 固定 32.38% 流量占比按 cac.gov.cn 2026-07-28 报道（截至 2025 年底）；全国流量占比 34.55%（2026-06）及 2027/2030 目标只见于二手报道，未写入正文
- [ ] `08-ipv6-dual-stack.md#happy-eyeballs`：Node 20 起 `autoSelectFamily` 默认开启、约 250 ms 回退，凭记忆写，未查 Node 文档
- [ ] `08-ipv6-dual-stack.md#系统和服务这一侧`：Docker 发布端口默认同时绑 `[::]`、绑 127.0.0.1 时不暴露 v6，凭记忆写；云厂商开 IPv6 的四步只核对了阿里云的二手整理
- [ ] `08-ipv6-dual-stack.md#动手练习`：三道练习未实际运行
- [ ] `05-tls.md#有效期在缩短`：certbot 4.0 起剩余 1/3 有效期续期、4.1 起支持 ARI 来自打包方 changelog 和 Let's Encrypt 社区帖，未查 certbot 仓库原文

### nginx-gateway

- [ ] `03-https-acme.md#nginx-原生-acme-模块`：官方文档和 README 均未说明 HTTP-01 挑战能否与 80 端口的 301 跳转写在同一 server 块、续期后是否需要 reload；Ubuntu / Debian 自带源有无对应模块包未查清；模块仍是 0.x（GitHub README 与 nginx.org 对 TLS-ALPN-01 是否支持说法不一，正文按 nginx.org 写「支持」）

### docker-containers

- [ ] `04-multi-stage.md#量化镜像大小去哪了`：AUDIT 要求复核体积数字，本机 Docker 未运行，没有实测；正文改为加说明「containerd 镜像存储下大小不可直接比，书中 MB 数只是量级」
- [ ] `06-compose.md#容器起不来排查清单`：退出码表和练习 4（`docker run alpine bash` 得到 127、`-m 32m` 得到 137 + OOMKilled）未实测

### kubernetes

- [ ] `04-networking-ingress.md#gateway-api最小示例`：Traefik 的 Gateway listener 端口须等于其入口端口（8000 / 8443）来自 Traefik Hub helm 参考和社区帖；k3s chart 是否自动创建默认 Gateway 未确认；整段示例未在 k3s 上实测
- [ ] `07-troubleshooting.md#crashloopbackoff启动就退出`：containerd 下命令不存在时 `StartError` / 退出码 128、退避 10 秒翻倍至 5 分钟凭记忆写；三道练习未实测

### deploy-release

- [ ] `05-ci-cd.md#action-的版本号`：示例停在 checkout / setup-node / pnpm action-setup 的 v6（checkout、setup-node 已有 v7）；其他书里若还有 `@v4` 未一并处理

### llm-deep-dive

- [ ] `04-moe.md#几个代表模型`：新增 Kimi K2 / gpt-oss-120b / gpt-oss-20b / Qwen3-Next-80B-A3B 四行。参数和专家配置来自 Hugging Face 模型卡与 `config.json`（已核对）；发布月份（2025 年 7 / 8 / 9 月）按模型卡 changelog 和论文日期推定，未找到各家官方发布公告原文

### open-models

- [ ] `01-landscape.md#主要家族` NOTE：Qwen3.5（2026-02）、Qwen3.6（2026-04）、Qwen3.8（2026-08）的时间和许可证取自 Hugging Face API 的 `createdAt` 与 `cardData.license`（中小尺寸 apache-2.0，Qwen3.8-Flash-Next 与 Qwen3.8-2.4T-A95B 为 other），未读官方发布博客
- [ ] `05-gpu.md#2026-年的几类新硬件`：B200 每卡显存各来源 180 / 192 GB 不一（NVIDIA DGX B200 页面是 8 卡共 1440 GB），B300 的 288 GB 来自媒体报道，未读到 NVIDIA 单卡 datasheet
- [ ] `05-gpu.md#2026-年的几类新硬件`：M5 Pro / Max 带宽（307 / 460 / 614 GB/s）来自 Apple 支持页面 126319；「M5 的 GPU 加入神经网络加速单元」来自 MacRumors 等二手报道；M5 Pro 是否可配 128 GB 支持页面摘要有歧义，正文只写了 M5 Max 最高 128 GB

### math-for-ai

- [ ] `07-gradient-descent.md#muon把整块矩阵的更新拉匀`：`torch.optim.Muon` 在 PyTorch 2.15 文档中存在（默认 momentum 0.95、ns_steps 5），但首次加入的版本号未查到，正文只写「新版 PyTorch」；Newton-Schulz 示例在本机 numpy 上跑过

### python-for-ai

- [ ] `03-typing-pydantic.md#让检查器跑起来`：pyrefly「已发布 1.x」只依据 PyPI 上的版本号 1.4.0，未读其稳定性声明；ty 0.0.97 的 Beta 状态取自 PyPI classifier
- [ ] `01-ts-to-python.md#313-之后的新变化`：3.15 的条目（PEP 810 / 686 / 814、macOS 安装包默认附带自由线程支持）按 docs.python.org 的 What's New in 3.15 整理；3.14 惰性标注示例在本机 3.12 / 3.14 上实测

### multimodal-ai

- [ ] `05-speech.md#中文场景的开源模型paraformer-与-sensevoice`：SenseVoice 模型卡的语种数自相矛盾（50+ / 5 / 6），正文只列了中粤英日韩；速度数字是作者自报
- [ ] `05-speech.md#端到端语音模型`：「通义的 Qwen-Omni 系列能直接处理语音输入输出」凭已有知识写，未查官方模型卡
- [ ] `04-document-understanding.md#不抽文字也能检索colpali`：「基于 PaliGemma」「一页几百到上千个向量」来自对论文的已有了解，arXiv 摘要页未写明

### llm-app-engineering

- [ ] `01-api-basics.md#temperature-去哪了`、`06-prompt-caching.md#自动缓存最简单`、`04-tool-use.md#服务端工具`：三处按 Claude API 技能参考资料（缓存于 2026-10-06）核对一致，未直接抓取 platform.claude.com 的线上页面

### rag-systems

- [ ] `03-pgvector.md`：pgvector 版本节点（HNSW 0.5.0、并行构建 0.6.0、halfvec / sparsevec / L1 0.7.0、迭代扫描 0.8.0）已按 CHANGELOG 核实，`pg16` 和 `0.8.7-pg16` 标签已在 Docker Hub 确认；本章 SQL 在 PG 17 / 18 上未实测

### llmops

- [ ] `llmops/08-data-compliance.md#跨境用境外模型时多想一步`、`#给合规审计留证据`、`#生成式-ai-的专门规定`：出境认证门槛、合规审计办法、网安法修正、标识办法日期直接沿用《国内合规实务》第 6、7 章（第 6 章已按原文核实；第 7 章的标识办法 / GB 45438-2025 仍是「按 2025 年前后整理」口径），本轮未再独立查原文

### agent-principles

- [ ] `agent-principles/04-planning-reflection.md#扩展思考从给预算到给力度`：力度五档的行为描述、默认值（多数 `high`，Opus 5.5 / Haiku 5.5 为 `medium`）、改力度使缓存失效，按 2026-11 platform.claude.com 的 Steering thinking / Effort 页面整理；各家模型变化快，下一轮复查

### agent-safety

- [ ] `agent-safety/01-threat-model.md#三要素私密数据不可信内容对外通信`：Meta「Agents Rule of Two」（2025-10-31）的内容来自 Simon Willison 的转述和其他二手报道，未打开 Meta 原文
- [ ] `agent-safety/06-audit-replay.md#一次真实事故amazon-q-扩展里的删除指令`：事实以 AWS 安全公告 AWS-2025-015（CVE-2025-8217）为准；「提示词要求清理本地文件和云资源」的具体内容来自 CSO Online、iTnews 报道，AWS 公告本身未描述指令内容

### build-your-agent

- [x] REVIEW 第 70、71 行可以勾掉：`pause_after_compaction`、`stop_reason: "compaction"`、`compact_20260112`、`context-management-2025-06-27` 已在 `@anthropic-ai/sdk` 1.3.0 的类型定义里核到；Agent SDK 0.3.316 的 `tool()` 第三个参数是 `AnyZodRawShape`，peer 依赖 `@modelcontextprotocol/sdk ^1.29.0`、`zod ^4`，发布于 2026-10-31，内置 Claude Code 2.1.316，均按 npm registry 核对。写作时最新为 sdk 1.4.0、agent-sdk 0.3.318，书里锁定的版本未改

### context-engineering

- [ ] `context-engineering/08-measure-debug.md#示例两周账本对比`：周报数字是虚构的演示数据（正文已标明），按 Opus 5.5 价目（4 / 5 / 0.2 / 20 美元每百万 token）计算；价目变动时重算
- [ ] `context-engineering/01-scarce-window.md#context-rot研究怎么说`：Chroma 报告（2025-07-14）和 NoLiMa（arXiv 2502.05167，ICML 2025）的结论按原文摘要和报告页面整理；《Lost in the Middle》仍只有定性描述（REVIEW 第 130 行不变）

### tools-and-mcp

- [ ] `tools-and-mcp/08-agent-interop.md`（新章）：A2A 1.0.0（2026-03-12）、1.0.1（5 月）按 GitHub releases；150+ 组织、微软 / AWS 接入按 Linux Foundation 2026-04-09 公告；A2A 加入 AAIF（2026-08-17）按 aaif.io 博客。以下只有二手来源：IBM ACP 并入 A2A 的具体日期（2025 年 8 月，原仓库已归档）、JetBrains 加入 Agent Client Protocol（2025 年 10 月，The Register）、ACP Agent Registry 上线（2026 年 1 月）、A2UI 当前生产版本 v0.9.x / 1.0 候选（来自搜索摘要，未直接打开 github.com/google/A2UI）
- [ ] `tools-and-mcp/08-agent-interop.md#ag-ui事件长什么样`：事件名按 docs.ag-ui.com 的 Events 页面（PascalCase 写法），线上传输的类型名可能是大写下划线形式，未核对
- [ ] 新增第 8 章后全书为八章，`books/ROADMAP.md` 里 tools-and-mcp 的章节列表（如有）需要同步，本轮未改 ROADMAP（其他 agent 在改）

### media-opc-overview

- `03-platform-landscape.md#用户规模`：腾讯、快手、B 站 2026Q3 业绩截至 2026-11-04 均未发布（按往年 11 月中下旬），仍用 Q2 数据；发布后需更新表格、`assets/platform-mau.svg` 和本章要点
- `03-platform-landscape.md#用户规模`：抖音月活 10.29 亿（QuestMobile《2026 上半年中国移动互联网实力价值榜》，2026-08-04）只见中华网等转载，未见报告原文；「3 月首次破 10 亿（10.09 亿）」只见经济日报（台）、remio 转述，QuestMobile 春季报告页面未列该数字。同一榜单红果免费短剧 3.68 亿，与正文 2026-05 的 3.56 亿并列写出

### media-action-plan

- `08-d3-d5-release-studio.md#路线一平台分账先算账`：火山引擎「精品 AI 剧激励计划」（2026-10-19 发起；Seedance 全量制作且 2.5 占比 >50%；红果热度前 10 / 20 / 50 名 20 / 10 / 5 万；一半现金一半返券；首期申报截止 2027-01-31）只有财联社 2026-10-21、IT 之家报道，未找到火山引擎官方公告原文
- 同节：红果取消 AI 仿真人保底、改 20% 分成仍只有骨朵一个来源，本轮未找到新信息

### account-positioning

- `01-track-and-persona.md#资质领域先查再选`、`09-tech-creator-route.md`：《关于加强「自媒体」管理的通知》第 2、3 条已按人民论坛网 2023-07-10 转载全文核对（落款 2023-07-05），中国网信网原文页仍未打开；其余 REVIEW 条目（指标名、改名次数等）本轮未处理

### shooting-editing

- `06-capcut-workflow.md#什么时候换桌面专业软件`：DaVinci Resolve Studio 官网 2026-11 显示「Was $295 Now $236」，属于促销价，过后需复查；免费版「导入不限分辨率、导出最高 UHD」依据官网产品页与 21 版 readme 的第三方摘要
- `01-equipment.md#第三档800012000-元追求质感`：索尼 ZV-E10 II 国行建议零售价 7499 元本轮未复核

### xhs-channels-bilibili

- `05-channels-content-money.md#变现入口`、`#粉丝阶段与功能`：视频号创作分成计划（100 粉、个人号、原创声明）、互选万粉、各粉丝阶段功能，2026-11 复查仍只有 2023 年资料，规则只在视频号助手登录后可见，维持原说法
- `07-bilibili-tech-knowledge.md#up-主的变现方式`：花火入驻门槛（2020）、创作激励（2024-04）、包月充电（2023）2026-11 复查未找到官方新版或调整报道，维持原说法
- `06-bilibili-long-video.md#几个基本数字`：已换成 B 站 2026Q2 数据（DAU 1.17 亿、MAU 3.71 亿、113 分钟、千粉 UP 主 +30%、万粉 +21%、人均收入 +21%），来源为品玩等媒体对财报的报道，未对照 IR 原文；Q3 财报发布后可更新

### live-streaming

- `06-product-lineup.md#怎么算一场的预估佣金`：公式已补技术服务费，档位（A/B+/B 10%、C 20%、D 40%，站外 10%）转引 ecommerce-selling 02（该书据抖音电商学习中心规则原文整理），本轮自己没能打开规则原文；快手、视频号达人扣点未查到公开规则。REVIEW 第十节「live-streaming 第 6 章：示例只算了毛佣金」可勾掉

### opc-finance

- 02-taxes.md#2026-年常用数字参考：新增参考表。已按原文核实：财政部 税务总局公告 2026 年第 10 号（2026-01-30，江苏税务转载全文，起征点与 3% 减按 1% 条款原文）；2023 年第 12 号（2023-08-02，国家税务总局法规库原文）；《个人所得税法》第六条 6 万元（法规库原文）、附表二经营所得税率表（江苏税务转载页附图）。
- 02-taxes.md#2026-年常用数字参考：「未达到起征点可选择放弃免税、开专票」一句来自 2026 年第 10 号的检索摘要，未逐字核对原文条款，需人复核。
- 02-taxes.md#2026-年常用数字参考：未放入「只有经营所得、没有综合所得的个人可减除费用 6 万元」——出自《个人所得税法实施条例》第十五条，本轮未查到官网原文，仅有培训课件转述。
- 02-taxes.md#2026-年常用数字参考：2026 年第 10 号第六条概括废止 2025-12-31 前的国内环节增值税优惠文件，2023 年第 19 号（原 1% 征收率依据）是否随之停止执行原文未点名；表中只引用第 10 号，不受影响，但如他书仍引用 2023 年第 19 号需复核。
- 02-taxes.md#2026-年常用数字参考：未查到 2026 年对 2023 年第 12 号的调整公告（检索至 2026-11），如有新公告需更新。

### private-domain-cn

- `06-wecom-customer-groups.md#群发和客户朋友圈的上限`：原说法「企业群发每月 4 条 / 当月天数，两处矛盾」。查到：群发规则使用说明页（work.weixin.qq.com/nl/act/p/a7db65e80f964edf）与开发者文档 path/92135 一致——管理员可按日/周/月配置，默认 1 条/日，按月时每月最多当月天数；「群发助手」功能页（nl/act/p/c502a27e56c44feb）仍写「每位客户每月可收到企业的 4 条」。正文已改为以前两者为主、注明功能页可能是旧规则，矛盾本身仍在官方页面上，需人在后台确认
- `06-wecom-customer-groups.md#开通和认证`：认证后 5 万 / 2000 两种情况、未认证 100（含已删除）、单成员 2 万、个体户按「企业」类型认证、300 元审核费已按帮助中心 help2/pc/20172、19734、14641 核实并改写。「已删除的客户也占名额」帮助中心只对未认证写明，认证后是否同样计入未查到
- `06-wecom-customer-groups.md#个人微信还是企业微信`：个人微信好友约 1 万，仍只有 2023 年报道转述腾讯客服，本轮未查到官方原文（维持原说法）

### b2b-sales

- `07-close-payment-invoice.md#收集开票信息`：原说法「开专用发票的另需：地址电话、开户行及账号」。查到：国家税务总局公告 2024 年第 11 号只列「购买方信息」不列子项；深圳市税务局问答（搜索摘要，原页 IPv6 连接失败未能打开）和黑龙江税务局《热线问题选编 2026 年第 7 期》称数电票票面删除地址栏和银行账号栏，银行账号可勾选「是否展示」显示在备注栏。数电专票开具时开户行及账号是否必填，未找到总局层面的明确条文；北京市税务局《数电票常见问题清单》PDF 已下载但无法提取文本，未读到。正文改为「票面不再显示、专票照收、按开票界面提示填」，需人在电子税务局实际开一张专票确认

### product-thinking

- [ ] `09-validation-pmf.md#40-是怎么来的`：「Ellis 对比将近一百家初创公司得出 40%」只查到 Rahul Vohra 2018-11-12 First Round Review 文章的转述；Ellis 本人 2009-05-18《Free Customer Development Help – Survey.io》、2010-03-01《Optimization Mistakes That Kill Startups》只给 40% 不讲来历；《Hacking Growth》（2017）原书未能核对。正文已写明依据有限、当经验线看
- [ ] `09-validation-pmf.md#问谁`：抽样条件（体验过核心、至少用过两次、最近两周用过）已按 Ellis 2009 原文核实；「约 40 份回答起有方向性」出自 Vohra 文章，Ellis 原文无最低样本数
- [ ] `09-validation-pmf.md#国内收款的注意点`：消保法预收款退还义务、2024 年《消费者权益保护法实施条例》预付式消费条款只查到人民日报海外版 2024-04-16 报道，未核对条文原文与条号；「个人收款码不宜用于经营收款」凭记忆写，未找到支付平台 / 人民银行一手文件。已加 WARNING
- [ ] `09-validation-pmf.md`：「接下来读什么」一节从 08 章末尾移到 09 章末尾（新章追加在最后）；08 章末尾改为一句指向第 9 章。如更希望新章放在 04 之后，需要同步改全书「第 N 章」的编号引用

### react-internals

- `01-jsx-to-fiber.md#这本书讲什么适合谁怎么读`：原说法「19.3 与 19.2 差异未逐项核对」。已按 React 仓库 CHANGELOG（v19.3.1 标签）和 npm 发布记录核对：19.2.0 = 2025-10-01，19.3.0 = 2026-09-09，最新 19.3.1 = 2026-10-14，正文补了两版新增对照表。react.dev 博客没有找到 19.3 的发布文章（只查到 CHANGELOG），如官方后来发了博客，建议对照一遍表格措辞。REVIEW.md 第 490 行那条可以视为已处理。
- `04-concurrent-rendering.md#lanes-在树上的传播`：新增「19.3 起 transition 各自独立渲染」的说法，依据是 CHANGELOG 19.3.0「Render transitions independently instead of entangling them」(#37290) 和 v19.3.1 源码 `enableParallelTransitions = true`、`getHighestPriorityLanes` 对 TransitionLane1–10 只取最高位。「同一个 transition 里的多次 setState 仍在同一条 lane」是按 `requestTransitionLane` 的逐事件复用推断的，没有实际跑过验证。
- `06-actions-and-forms.md#form-action把函数交给表单`：原说法「失败也会重置非受控字段」维持。react.dev `<form>` 文档写的是「action 成功后」重置；v19.3.1 源码 `startHostTransition` 在调用 action 前无条件 `requestFormReset`，所以返回错误 state 也会重置。action 抛错（reject）时重置是否仍然提交没有实测，正文只写了「错误交给 Error Boundary」。章末练习 1 的预期结果没有在 19.3 上实际运行确认。

### rn-expo

- [x] REVIEW 第三节 `rn-expo` 一条（Gesture Handler 3 Hook API、Reanimated 4 / worklets、Expo Babel 预设自动配置、Hermes V1 默认、app config 无 `jsEngine`）：2026-11 按 SDK 58 文档、`expo@58.0.22` 的 bundledNativeModules.json、Reanimated 3.x 迁移指南、RNGH「升级到 3」指南核实，均属实，各节已加带来源的 WARNING。「免费账号 7 天描述文件」只找到 Apple 开发者论坛的官方回复，没找到会员说明页原文，`10-signing-testflight.md#装到自己手机上` 已注明依据
- [ ] `08-local-storage.md#查询与事务`：SDK 58 文档说 `withExclusiveTransactionAsync` 跑在新连接上、原连接的 `PRAGMA foreign_keys` 不生效。书中 `rebuildIndex()` 显式清三张表所以不受影响，但请确认 hatch-shelf 的 `rebuildIndex` 里有没有依赖外键级联的写法
- [ ] `10-signing-testflight.md#美区外链支付`（新增）：审核指南条文按 2026-11 现行文本核对；`Storefront.current?.countryCode` 的 Expo 模块写法（`AsyncFunction` 用 Swift `async` 闭包）没有编译验证；「美区可否只给外链、不提供 IAP」指南没有直接写明，正文未作断言
- [ ] `11-android-china.md`（新增章）：以下几点依据有限或未实测：「国内商店普遍收 APK」是公开资料的普遍说法、未逐家核对；VasDolly helper 的包路径 `com.tencent.vasdolly.helper.ChannelReaderUtil` 与 Kotlin 模块写法未编译验证（版本 3.0.6 取自其 README）；华为 Maven 仓库地址和 `agconnect-services.json` 凭经验写；「厂商后台登记 SHA-256 指纹、调试包可能拿不到令牌」是一般经验，未逐家核对；「不少 SDK 通过 ContentProvider 自动初始化」是一般性描述；HarmonyOS NEXT 不运行 APK 依据 Reuters / 财新 / 第一财经报道（2024），未查华为官方原文

### ts-node-advanced

- [x] REVIEW 第三节 `ts-node-advanced` 一条和第十节「Node 22.23 默认 `--no-maglev`」：2026-11 已核。类型擦除版本节点按 Node 官方「Modules: TypeScript」版本历史核对属实，并补了 24.3 去警告、24.12 / 25.2 标稳定、26.0 移除 `--experimental-transform-types`；Maglev 关闭来自 v22.9.0 发布说明（仅针对 v22 线）；字节流 64 KiB 来自 Node 22 发布公告，另据 Node 24 文档补了「Windows 上仍是 16 KiB」；Clinic.js README 写明不再积极维护；VS Code 的 Flame Chart Visualizer 扩展属实
- [ ] 全书基线：按指示改为 Node 24 LTS，但 2026-11 时 Node 26 已于 10-28 进入 Active LTS，Node 24 / 22 都在维护期。是否把基线进一步换到 26，请作者决定。实验仍是 Node 22.23 上跑的（order.mjs 本轮在 22.23.1 上复跑，输出一致），Node 24 未实机重跑，`05-v8-pipeline-hidden-classes.md#分层编译管线` 里 Node 24 的 Maglev 默认值没查到官方说明，正文写成「自己用命令查」
- [ ] `09-node-runs-ts.md#去工具链把-tsx-换成-node`（新增）：tsc 报错数是本轮在 shelf-pack 上实测的；「Metro 认带 `.ts` 后缀的相对导入」、`node --env-file` / `--watch` 替代 tsx 的说法没有在本仓库实际迁移验证
### react-internals

- `01-jsx-to-fiber.md#这本书讲什么适合谁怎么读`：原说法「19.3 与 19.2 差异未逐项核对」。已按 React 仓库 CHANGELOG（v19.3.1 标签）和 npm 发布记录核对：19.2.0 = 2025-10-01，19.3.0 = 2026-09-09，最新 19.3.1 = 2026-10-14，正文补了两版新增对照表。react.dev 博客没有找到 19.3 的发布文章（只查到 CHANGELOG），如官方后来发了博客，建议对照一遍表格措辞。REVIEW.md 第 490 行那条可以视为已处理。
- `04-concurrent-rendering.md#lanes-在树上的传播`：新增「19.3 起 transition 各自独立渲染」的说法，依据是 CHANGELOG 19.3.0「Render transitions independently instead of entangling them」(#37290) 和 v19.3.1 源码 `enableParallelTransitions = true`、`getHighestPriorityLanes` 对 TransitionLane1–10 只取最高位。「同一个 transition 里的多次 setState 仍在同一条 lane」是按 `requestTransitionLane` 的逐事件复用推断的，没有实际跑过验证。
- `06-actions-and-forms.md#form-action把函数交给表单`：原说法「失败也会重置非受控字段」维持。react.dev `<form>` 文档写的是「action 成功后」重置；v19.3.1 源码 `startHostTransition` 在调用 action 前无条件 `requestFormReset`，所以返回错误 state 也会重置。action 抛错（reject）时重置是否仍然提交没有实测，正文只写了「错误交给 Error Boundary」。章末练习 1 的预期结果没有在 19.3 上实际运行确认。
### frontend-engineering

- `02-css-layout-cascade.md#新特性与兼容性线`：新写的「锚点定位：核心属性 2026 年 1 月（Firefox 147）起新近可用，整体仍未达 Baseline」。依据是 web-features 3.45：整体特性 status=false（只列 Safari 27），但 `anchor-name`、`anchor()`、`position-area`、`@position-try` 各自 baseline low 2026-01-13；`position-anchor` 属性要到 2026-09（Chrome/Firefox 151、Safari 27）。MDN 页面上的标记可能随 web-features 下一版变化，需人看一眼 MDN 当前显示。
- `02-css-layout-cascade.md#新特性与兼容性线`：`popover` 写成「2025 年 1 月起新近可用」，来自 web-features（因 iOS Safari 18.3 才算完整支持）；常见说法是 2024 年 4 月。两种口径都有，按 web-features 写。
- `08-eslint-prettier.md#oxlintbiome-与-oxfmt`：Oxlint 类型感知覆盖「61 条中的 59 条」取自 oxc.rs 文档；tsgolint 仓库 README 写的是「62 条中 60 条」，口径不一，正文已注明。
- `08-eslint-prettier.md#oxlintbiome-与-oxfmt`：Oxfmt「0.x，2026 年 2 月进入 beta」——beta 公告是 2026-02-24 的 Oxc 博客；之后没找到 stable 公告，当前 npm 版本 0.76.0（2026-11-03），「仍是 beta」是按版本号推断。「通过 Prettier JS/TS 一致性测试全部用例」是项目方自述（VoidZero 2026 年 2 月月报），未见第三方验证。
### electron-desktop

- [ ] `06-packaging-signing.md#配置`：原说法「`APPLE_API_KEY`（.p8 文件路径）」。`app-builder-lib@26.18.0` 源码把它原样交给 `@electron/notarize`，后者 README 要求填 .p8 绝对路径，正文维持「路径」；但 electron.build 文档站 v26 公证页写的是 base64 编码的 .p8 内容（v27 文档说两种都行），二者不一致，需要用真实账号实测一次确认
- [ ] `06-packaging-signing.md#macos-签名为什么不能不签` 与 `07-auto-update.md#先决条件签名`：「签名未公证也能自动更新」（signing-levels 图里「开发者证书 → 自动更新：能」）。Electron autoUpdater 文档只写「macOS 上必须签名（Squirrel.Mac 要求）」，没提公证；正文已标为推断，未实测
- [ ] `06-packaging-signing.md#不签名为什么不行`：「不签名在苹果芯片上不能稳定运行、系统随时可能杀掉进程」。`@electron/fuses` README 写明 arm64 上改过不重签会因签名校验错误拒绝启动，部分佐证；「随时被杀」的具体表现仍是推断，正文已注明
- [ ] `05-native-integration.md#钥匙串safestorage`：Electron 45 弃用同步 `safeStorage` 方法、46 计划移除（Breaking Changes 页已核实）；异步版 `encryptStringAsync` 等从哪个版本开始提供、44 里能否用，官方 API 页没写版本，未核实
- [ ] `06-packaging-signing.md#electron-builder-怎么配`：electron-builder 26.18 的 `azureSignOptions` 内部仍调用 PowerShell 模块 `TrustedSigning`（`Invoke-TrustedSigning`），微软已把服务更名为 Artifact Signing；改名后该模块是否继续可用、electron-builder 是否会改名，未查到说明。是否必须在 Windows 主机上构建也未核实（正文写「通常在 Windows 的 CI 机器上构建」）
- [ ] `06-packaging-signing.md#选哪种方式`：Artifact Signing「每月 9.99 美元起」引自 Microsoft Learn 的 SmartScreen 页，未打开 Azure 定价页核对
- [ ] `03-security.md#对照唱片墙做了什么为什么没做什么`（REVIEW 第 53 行 hatch-recordwall 条目）：「IPC 不校验发送方；`net:fetch` 接受任意 URL；只读令牌经 preload 交给页面」。书中把前两条标为「可改进」、令牌标为「知情的取舍」，并写明前提（只加载自打包代码、封死导航）和前提变化时要补什么，表述恰当，未改；是否仍是 hatch-recordwall 现状需对照仓库代码

