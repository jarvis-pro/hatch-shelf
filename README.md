# hatch-shelf · 书巢

个人自用的 iOS 离线 Markdown 书架。AI 在电脑上写书，通过 AirDrop 或局域网传到手机，在本地存储与管理，离线阅读。

- **Bundle ID**：`com.jarvis.shelf`
- **显示名称**：书巢（内部名 `Shelf` 仍用于 Xcode 工程与 scheme）
- **平台**：iOS（Expo / React Native，保留以后出 Android 的可能）

---

## 1. 目标与非目标

**目标**

- 把 AI 产出的技术类、知识类内容组织成“书”，在手机上获得舒适的离线阅读体验
- 导入路径尽量短：AI 写完 → 一条命令或一次 AirDrop → 手机上可读
- 内容格式不绑定任何 AI 服务，任意 agent 遵守 `books/AGENTS.md` 即可写书

**非目标（当前阶段）**

- App 不联网：不做云同步、不做账号、不做热更新
- 不做编辑器：手机端只读，内容的生产在电脑端
- 不上架 App Store：通过开发者账号自装或使用 TestFlight

---

## 2. 整体架构

```
[任意 AI Agent] → books/<id>/ → [shelf-pack CLI] ─┬─ AirDrop / 分享 (.zip/.md)
                                                  └─ 局域网 HTTP 上传
                                                         ↓
                                     App: inbox/ → 校验 → books/ → SQLite 索引
                                                         ↓
                                                     离线阅读
```

**核心原则**

1. **文件即真相**：书籍原文以文件形式存放在 `documentDirectory/books/`，SQLite 只存索引和用户数据
2. **导入只是“往 books/ 放东西”**：所有通道共用同一条导入管线；阅读器只认 `books/` 目录
3. **索引可重建**：`books` 和 `chapters` 两张表随时可以通过扫描目录重建；阅读进度与设置不可丢

---

## 3. 仓库结构

单仓库，pnpm workspace。

```
hatch-shelf/
├── README.md
├── AGENTS.md              # 代码侧规范（开发 App / CLI 时 agent 读取）
├── pnpm-workspace.yaml
├── app/                   # Expo App（Metro 根目录在此，books/ 不会进安装包）
│   └── reader-web/        # @shelf/reader-web：阅读器网页，打包成单个 HTML 放进 App
├── packages/
│   └── spec/              # @shelf/spec：book.yaml 的 zod schema + TS 类型，App 与 CLI 共用
├── tools/
│   └── shelf-pack/        # CLI：校验 → 打包 → 局域网推送
├── notes/                 # 从手机导出的阅读笔记 <book-id>.notes.md
├── design/                # UI 设计稿（pen.dev），不进安装包
│   ├── 设计稿.pen
│   ├── covers/            # 书封，按 <book-id>.png 命名
│   ├── images/            # 插画、图标等，按用途命名
│   └── splash/            # 启动流程画面
└── books/
    ├── AGENTS.md          # 写书规范（agent 在此目录写书时读取）
    └── <book-id>/
```

**提交约定**：内容提交使用 `content:` 前缀，代码提交使用 Conventional Commits（`feat:` / `fix:` / `chore:` …）。查看代码历史时用 `git log -- app/ packages/ tools/` 过滤。

**以后拆仓的条件**：内容需要单独公开、改由其他机器或 agent 专职写书，或者内容体积开始拖慢 clone。届时用 `git subtree split -P books` 带着历史拆出去。如果图片变多，对 `books/**/assets/**` 开启 Git LFS。

---

## 4. 内容规范

### 4.1 目录结构

```
books/go-concurrency/
├── book.yaml
├── cover.png          # 可选；缺省时 App 自动生成文字封面
├── 01-goroutine.md
├── 02-channel.md
└── assets/            # 本书的全部图片
```

### 4.2 book.yaml

```yaml
id: go-concurrency            # 必填，全局唯一，[a-z0-9-]；同 id 再次导入即为更新
title: Go 并发编程实战          # 必填
subtitle: 从 goroutine 到调度器  # 可选
category: tech/go             # 可选，书架分组，用 / 分层
tags: [go, concurrency]       # 可选
level: intermediate           # 可选：beginner | intermediate | advanced
created: 2026-11-02           # 可选
updated: 2026-11-02           # 可选
chapters:                     # 必填，显式排序
  - 01-goroutine.md
  - 02-channel.md
```

### 4.3 写书硬规则（同步写入 books/AGENTS.md）

- 每章一个 `.md` 文件，以唯一的 H1 作为章标题
- 图片只能引用 `assets/` 下的相对路径，**禁止远程图片**（离线时无法显示）
- 图表用 Mermaid（流程、结构类）或 `assets/` 下的 SVG（数据图、坐标图、示意图），**禁止在代码块里用字符画图**；SVG 的底板、尺寸、字体、配色规范见 `books/AGENTS.md`「配图」
- 代码块必须标注语言
- 数学公式使用 KaTeX 语法（`$...$` / `$$...$$`）
- 文件名只使用 `[a-z0-9-]` 和 `.md`

### 4.4 容错

| 输入 | 处理 |
|---|---|
| 目录缺少 `book.yaml` | 用目录名作为 id 和标题，章节按文件名排序 |
| 单个 `.md` 文件 | 包装成单章书，id 取自文件名 |
| `chapters` 列出的文件不存在 | 跳过该章，并在书籍信息里提示 |
| 存在但未列入 `chapters` 的 `.md` | 忽略 |

---

## 5. 导入通道

### 5.1 AirDrop / 系统分享

- 在 `CFBundleDocumentTypes` 中注册 `.zip` 和 `.md`
- 选择“用书巢打开”后，文件进入导入管线
- 书架右上角的“导入”可以从“文件” App 里选一个 zip / md，走同一条管线

### 5.2 局域网传书

- 「传书」Tab 默认不开启，点「开启传书」才启动 HTTP 服务；切到其他 Tab、锁屏或 App 进入后台时立即关闭，回到未开启状态（iOS 不允许服务在后台运行）
- 页面显示访问地址 `http://<设备IP>:8080` 和一个 4 位随机 PIN，每次开启重新生成
- 首次使用会触发“本地网络”权限弹窗，需要配置 `NSLocalNetworkUsageDescription`
- 第一版不做 Bonjour 自动发现，手动输入 IP

**接口**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 内置的拖拽上传页面（HTML 打包在 App 内） |
| POST | `/upload` | `multipart/form-data`，字段 `file`；请求头 `X-Pin`（浏览器页面通过表单字段传递） |
| GET | `/books` | 返回本地已有书籍的 id、标题、更新时间和内容指纹 `hash`（CLI 据此判断是否需要推送）；同样需要 `X-Pin` |
| GET | `/cover/<id>` | 书的 `cover.png`，上传页在导入成功后用来显示封面；需要 `X-Pin`，没有封面时 404 |
| GET | `/ping` | 不需要 PIN；上传页每 3 秒请求一次，连续两次失败就提示连接已断开 |

响应统一为 JSON：`{ ok: boolean, bookId?: string, error?: string }`；`/upload` 成功时还带 `status`（`added` / `updated`）、`title`、`chapters`（章节数）、`cover`（是否有封面）和 `warnings`。

**上传页**：`app/src/server/upload-page.ts`，设计稿见「传书网页 · 电脑浏览器」。整页内联，背景插图和 App 图标以 data URI 放在 `upload-images.ts`，不加载任何外部资源；整个页面都可以松手上传，多个文件串行上传。一次 PIN 错误后，排队中的文件不再发送，避免把 5 次错误次数用完。

**限制**：单个文件不超过 50 MB；PIN 连续错误 5 次后，本次服务失效。

**实现**：HTTP 解析在 `app/src/server/http.ts`（纯函数，Node 中测试），只支持带 `Content-Length` 的请求，每个连接处理一个请求后关闭；会响应 curl 上传大文件时的 `Expect: 100-continue`。上传的文件落成临时文件后交给第 6 节的导入管线，多个上传串行导入；接收过程中按 5% 粒度上报上传进度。服务运行期间保持屏幕常亮。

### 5.3 “文件” App 可见（可选，M4 之后）

开启 `UIFileSharingEnabled` 和 `LSSupportsOpeningDocumentsInPlace`。外部修改文件后，App 在启动或下拉刷新时重新扫描并修正索引。

---

## 6. 导入管线

所有通道走同一条管线：

实现：判断与转换在 `@shelf/spec` 的 `prepareImport()`（纯函数，App 与 CLI 共用），落盘与索引在 `app/src/import/pipeline.ts`。

1. 文件落到 `inbox/<uuid>/`
2. 安全校验
   - 解压时防止 zip slip：拒绝绝对路径和包含 `..` 的条目
   - 只放行这些扩展名：`.md` `.yaml` `.yml` `.png` `.jpg` `.jpeg` `.gif` `.webp` `.svg`
   - 检查单个包大小
3. 用 `@shelf/spec` 解析并校验 `book.yaml`，或按第 4.4 节的容错规则处理
   - zip 里可以直接放书的文件，也可以外面再套一层书目录；`__MACOSX/`、`.DS_Store` 直接丢弃
   - 走容错规则时补写一份 `book.yaml`，让设备上的目录名、id、标题在之后重建索引时保持一致
4. 原子写入：先完整写到 `books/.tmp-<id>/`，再整体替换 `books/<id>/`
5. 同 id 更新时：保留仍然存在的章节的阅读进度，删除已不存在章节的进度
6. 更新 SQLite 索引，清理 `inbox/`
7. 向用户反馈结果（新增 / 更新 / 失败原因）

---

## 7. 本地存储

```
documentDirectory/
├── books/<id>/      # 书籍原文
├── inbox/           # 导入临时区
└── shelf.db         # SQLite
```

| 表 | 字段 | 可重建 |
|---|---|---|
| books | id, title, subtitle, category, tags(JSON), level, chapter_count, warnings(JSON), imported_at, updated_at, content_hash, last_read_at | ✅ |
| chapters | book_id, idx, file, title | ✅ |
| search（FTS5，trigram） | book_id, chapter_file, anchor, heading, body —— 每行一个小节 | ✅ |
| progress | book_id, chapter_file, scroll_ratio, anchor, updated_at | ❌ |
| settings | key, value | ❌ |
| highlights | id, book_id, chapter_file, text, prefix, suffix, anchor, note, created_at, updated_at | ❌ |

`last_read_at` 由 `progress` 推导；重建索引时从 `progress` 回填。

---

## 8. 阅读体验

**界面**

- 视觉稿是 `design/设计稿.pen` 的「晨雾玻璃」：磨砂玻璃卡片、顶部晨雾配图、色彩只来自封面；设计 token 在 `app/src/ui/theme.ts`，亮色取自设计稿，暗色按同一结构压暗
- 底部玻璃 Tab：书架 / 笔记 / 传书 / 设置。外观（亮色 / 暗色 / 跟随系统）在设置页切换，对整个 App 和阅读器生效
- 冷启动先显示与封面同色的原生纯色启动图，JS 接管后封面淡入、停留到数据加载完，再与书架交叉淡化；轻点可跳过
- 轻动效遵循设计稿「轻动效」：位移 ≤ 12pt、缩放 ≥ 0.96，系统开启「减弱动态效果」时降级为短淡入淡出；阅读页内不放环境动效
- 界面不放阅读时长、连续天数之类的统计

**书架**

- 按 `category` 的第一段分系列（如 `ai/agent` 归入「人工智能」，映射在 `app/src/shelf/categories.ts`），每组横向滚动，「全部」进入该系列的网格；顶部放“继续阅读”卡片（最近读过、还没读完的一本）
- 封面左下角显示进度：读完显示 ✓，读过显示百分比。书的进度按「已读章节数 + 当前章节滚动比例」估算
- 封面是 `design/设计稿.pen` 里的原稿导出（600×856），复古丝网印刷风插图 + 每本一个主色，底部统一署名「Jarvis」；没有封面时，按「书架文库」版式用标题、副标题和分类色自动生成文字封面，署名相同
- 点按书籍进入详情页，封面从书架飞到详情页的大封面，返回时飞回原位；「继续阅读」卡片直接进入阅读
- 长按书籍弹出预览：放大的封面、进度和「继续阅读 / 书籍信息 / 笔记」，底部可删除；删除确认里有笔记时先提供「先导出笔记」

**全文搜索**

- 书架右上角的搜索进入全文搜索页；结果按书分组，显示章节、小节和关键词附近的片段
- 索引按 H1–H3 切成小节（`@shelf/spec` 的 `splitSections()`），与 books / chapters 一起在重建索引时生成
- 3 个字符及以上用 FTS5 trigram 匹配并按相关度排序；更短的查询（如两个汉字）退回 `LIKE` 扫描
- 点击结果打开对应章节，跳到小节锚点，并标亮锚点之后第一处匹配。标题锚点算法（`createSlugger()`）由阅读器与索引共用，保证一致

**阅读器**（WebView 渲染）

- 渲染库：markdown-it + highlight.js + KaTeX + Mermaid，**全部打包进 App，不走 CDN**
- 目录：从左侧滑入的抽屉，当前章节展开 H2 / H3，并标出视口所在的小节
- 阅读进度：记录滚动比例和最近的标题锚点，进入章节时自动恢复
- 主题跟随 App 外观，阅读页不单独设主题；字号（14–24，六档）和行距（紧凑 / 适中 / 宽松）可调
- 代码块：默认横向滚动，可切换为自动换行；提供一键复制
- 宽表格放在可横向滚动的容器里；图片支持点击放大
- 底部悬浮的章节导航：上一章 / 当前章节序号 / 下一章
- RN 与 WebView 之间通过 `postMessage` 通信，协议类型定义在 `app/src/reader/bridge.ts`
- 高亮与笔记：长按选中文字，系统菜单里选「高亮」或「笔记」，笔记在浮于键盘上方的面板里输入；点已有高亮可编辑笔记或删除。「笔记」Tab 按书列出有高亮的书，阅读页右上角「笔记」列出整本书的高亮，点一条跳回原文；可导出为 Markdown，经分享面板 AirDrop 回电脑，放到仓库的 `notes/<id>.notes.md`
- 高亮定位不记字符偏移，而是记原文 + 前后各 32 字 + 所在小节锚点；重新打开或书更新后，在正文里找所有出现原文的位置，取前后文最吻合的一处（`app/reader-web/src/highlights.ts`）。原文被改掉的高亮仍在笔记页里，只是在正文中不再显示
- 书更新时高亮保留；删除书时连同阅读进度、高亮一起删除（确认框会提示先导出）
- 阅读器网页（`app/reader-web/`）用 esbuild 打成单个 HTML（JS、CSS、KaTeX 字体全部内联，带禁止网络请求的 CSP），作为资源文件随 App 发布；启动时拷到 `documentDirectory/reader/`，WebView 以 `file://` 加载并获得整个 `documentDirectory` 的读权限，书里的相对路径图片因此可以直接显示
- 示例书在构建时由 `app/scripts/build-samples.mjs` 生成成 TS 模块，首次启动时写入 `books/`，删除后不会再出现

---

## 9. 技术栈

| 层 | 选择 |
|---|---|
| 框架 | Expo（最新稳定 SDK）+ TypeScript + expo-router |
| 构建 | `expo prebuild` / dev client（用到原生模块，不能用 Expo Go） |
| 文件 | expo-file-system |
| 数据库 | expo-sqlite |
| 解压 | fflate（纯 JS，`@shelf/spec` 内使用） |
| 局域网服务 | react-native-tcp-socket + 自己实现的最小 HTTP 解析（只支持上表中的接口） |
| 渲染 | react-native-webview + 本地打包的 reader bundle |
| 界面 | expo-blur（磨砂玻璃）、expo-linear-gradient、react-native-svg + lucide-react-native（图标）、expo-haptics；动效用 RN 自带的 Animated |
| 校验 | zod（`@shelf/spec`） |
| CLI | Node + TypeScript（`tools/shelf-pack`） |

---

## 10. shelf-pack CLI

```bash
shelf-pack check <book-dir|books/>            # 按 spec 校验，检查远程图片、缺失章节等
shelf-pack pack  <book-dir> [-o out.zip]      # 校验后打包成 zip
shelf-pack push  <book-dir> --to <ip> --pin <pin>   # 打包并通过局域网上传
shelf-pack push  books/ --to <ip> --pin <pin> --changed  # 对比设备上的 /books，只推送有变化的书
```

理想流程：agent 写完一本书 → `shelf-pack push books/<id> --to ... --pin ...` → 手机上直接可读。

在仓库根目录以 `pnpm shelf-pack <命令>` 运行。

- `check` 比 App 导入更严格：导入时会被跳过或兜底的情况（缺少 `book.yaml`、id 与目录名不一致、缺失章节、未列入 `chapters` 的 `.md`）在这里都会报出来；另外检查每章唯一 H1、代码块语言、远程图片、图片是否存在于 `assets/` 下。规则在 `@shelf/spec` 的 `lintBook()`
- `pack` / `push` 打出的 zip 把文件放在 `<id>/` 下，只包含允许的扩展名
- `push --changed` 比较内容指纹：`@shelf/spec` 的 `prepareImport()` 对将要写入设备的全部文件算出 `hash`，App 导入时存到书目录下的 `.content-hash` 并进入索引，`/books` 返回它；CLI 用同一个函数解开自己打的 zip 得到指纹，相同则跳过。设备上没有指纹的书（早期导入的、示例书）总是推送
- PIN 错误时立即停止，避免连续失败把手机上的服务锁掉

---

## 11. 里程碑

| 阶段 | 内容 | 完成标准 |
|---|---|---|
| **M0 骨架** | pnpm workspace、Expo 工程、`@shelf/spec`、`AGENTS.md` ×2、在真机上跑起来 | dev client 能装到 iPhone 上 |
| **M1 阅读器** | 内置 1～2 本示例书（首次启动时拷贝到 `books/`），书架页、阅读页、目录、阅读进度、主题 | 能完整阅读示例书，退出后再进入能恢复进度 |
| **M2 导入管线 + AirDrop** | inbox → 校验 → 原子写入 → 索引；注册文档类型 | AirDrop 一个 zip 后，书出现在书架上；同 id 再次导入为更新 |
| **M3 局域网传书** | 传书页、HTTP 服务、上传页面、PIN | 电脑浏览器能拖拽上传；curl 能推送 |
| **M4 CLI** | `shelf-pack` 的 check / pack / push | 一条命令完成从写书到手机可读 |
| **M5 加固** | ESLint `no-floating-promises`；`push --changed` 改为按内容指纹判断 | 漏写 await 无法通过 lint；改内容不改日期也能推送 |
| **M6 搜索** | FTS5 trigram 全文搜索，结果跳到小节并标亮 | 能搜到任意一本书里的句子并跳过去 |
| **M7 笔记** | 高亮、笔记、笔记页、导出回仓库 | 书更新后高亮仍在原位；导出的笔记能被 agent 读到 |
| **后续** | “文件” App 可见 | — |

---

## 12. 决策记录

| 决策 | 结论 | 理由 |
|---|---|---|
| 内容分发 | 不做热更新，纯单机 + AirDrop / 局域网 | OTA 会把内容与 runtimeVersion 绑死，只能全量下发，EAS 在国内连通性差；单机方案零后端 |
| 渲染方式 | WebView 而非 RN 原生 Markdown 组件 | 原生组件对代码高亮、公式、Mermaid、宽表格的支持弱 |
| 仓库 | 单仓库，`books/` 放在顶层 | 个人项目，用分层的 AGENTS.md 隔离上下文即可；拆仓成本低，需要时再拆 |
| 数据源 | 文件即真相，SQLite 只做索引 | 索引可重建；以后加任何同步通道，阅读器都不用改 |
| 局域网方向 | 手机做服务端，电脑做客户端 | 与常见的“WiFi 传书”习惯一致，CLI 可以直接 curl / push |
| 阅读器加载方式 | 单文件 HTML 资源 → 拷到 documentDirectory → `file://` 加载 | 用 `source={{ html }}` 时页面拿不到本地文件读权限，图片只能转 base64；放在 documentDirectory 下与 books/ 同源最简单 |
| Markdown 在哪渲染 | WebView 内（RN 只传原文） | 渲染库只打包一份；RN 侧不需要 DOM 环境 |
| 书中配图 | Mermaid + SVG，不用字符画 | 字符画在手机窄屏上会错位、看不清；SVG 是文本、体积小、矢量可放大，能进 git diff。SVG 自带白底，因为 `<img>` 里拿不到阅读器主题变量 |
| push --changed 的依据 | 内容指纹而非 `updated` | 改了内容忘记改日期时会漏推；指纹由 App 与 CLI 共用的 `prepareImport()` 计算，两边必然一致 |
| 高亮定位 | 原文 + 前后文，而非字符偏移或 DOM 路径 | 书会被 AI 反复修订；偏移和 DOM 路径一改就失效，原文 + 前后文在小改动后仍能找回 |
| 搜索分词 | FTS5 trigram，短查询退回 LIKE | 不需要中文分词词典；trigram 要求至少 3 个字符，个人书库规模下 LIKE 扫描足够快 |
| 阅读主题 | 跟随 App 外观，去掉护眼主题 | 设计稿要求阅读页与整个 App 一致；外观集中在设置页切换，阅读设置只留字号、行距和代码换行 |
| 传书默认状态 | 进入 Tab 不自动开启，需手动「开启传书」 | 传书成为常驻 Tab 后，切过去就开服务会在无意中暴露端口；手动开启、离开即关更稳妥 |
| 动效实现 | RN Animated，不引入 Reanimated | 设计稿的动效都是淡入、位移、弹簧这类简单动画，Animated 的原生驱动足够；少一个原生依赖 |
| 解压库 | fflate 而非 react-native-zip-archive | 纯 JS，少一个原生依赖；解压前就能逐条检查路径与大小；App 与 CLI 共用同一份导入逻辑，并能在 Node 里测试。50 MB 上限内整包读入内存可以接受 |
| 发布方式 | 本地 xcodebuild archive 后直接上传 TestFlight，不用 EAS Build / Submit | EAS 在国内连通性差；签名交给 Xcode 自动管理，构建号写在 app.json 由脚本递增，`ios/` 仍然只由 prebuild 生成 |
| App 名称 | 显示名「书巢」，内部名保留 `Shelf` | 取陆游《书巢记》里堆满书的书房，也呼应 hatch（孵化）：书在电脑上写成，再落进手机里的巢。「书架」仍作为首页 Tab 的名字；`expo.name` 决定 prebuild 的工程名和 TestFlight 脚本的 scheme，不随之改动 |

---

## 13. 发布到 TestFlight

一次性准备：在 App Store Connect 用 Bundle ID `com.jarvis.shelf` 建好 App；Xcode 的 Settings → Accounts 登录开发者账号（脚本用它签名和上传）。

```bash
pnpm app testflight              # 构建号 +1 → build:assets → prebuild → archive → 上传
pnpm app testflight --no-upload  # 只导出 .ipa 到 app/ios/build/export，不改构建号
```

- 构建号是 `app.json` 的 `expo.ios.buildNumber`，每次上传必须递增，脚本自动 +1，失败时恢复原值；上传成功后把 `app.json` 单独提交（`chore(app): 发布 <版本> (<构建号>)`）
- 发新版本时手动改 `expo.version`
- 上传后 App Store Connect 处理 5～15 分钟，构建出现在 TestFlight 的内部测试组即可安装；内部测试不需要审核，构建 90 天后过期
