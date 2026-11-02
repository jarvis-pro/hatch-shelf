# hatch-shelf · 书架

个人自用的 iOS 离线 Markdown 书架。AI 在电脑上写书，通过 AirDrop 或局域网传到手机，在本地存储与管理，离线阅读。

- **Bundle ID**：`com.jarvis.shelf`
- **显示名称**：书架
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
- 图表优先使用 Mermaid（` ```mermaid `）
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
- 选择“用书架打开”后，文件进入导入管线
- 书架右上角的“导入”可以从“文件” App 里选一个 zip / md，走同一条管线

### 5.2 局域网传书

- 只有进入 App 的“传书”页面时才启动 HTTP 服务，离开页面后立即关闭（iOS 不允许服务在后台运行）
- 页面显示访问地址 `http://<设备IP>:8080` 和一个 4 位随机 PIN
- 首次使用会触发“本地网络”权限弹窗，需要配置 `NSLocalNetworkUsageDescription`
- 第一版不做 Bonjour 自动发现，手动输入 IP

**接口**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 内置的拖拽上传页面（HTML 打包在 App 内） |
| POST | `/upload` | `multipart/form-data`，字段 `file`；请求头 `X-Pin`（浏览器页面通过表单字段传递） |
| GET | `/books` | 返回本地已有书籍的 id、标题、更新时间（便于 CLI 判断是否需要推送） |

响应统一为 JSON：`{ ok: boolean, bookId?: string, error?: string }`

**限制**：单个文件不超过 50 MB；PIN 连续错误 5 次后，本次服务失效。

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
| books | id, title, subtitle, category, tags(JSON), level, chapter_count, warnings(JSON), imported_at, updated_at, last_read_at | ✅ |
| chapters | book_id, idx, file, title | ✅ |
| progress | book_id, chapter_file, scroll_ratio, anchor, updated_at | ❌ |
| settings | key, value | ❌ |

`last_read_at` 由 `progress` 推导；重建索引时从 `progress` 回填。

---

## 8. 阅读体验

**书架**

- 按 `category` 分组展示，顶部放“继续阅读”卡片
- 没有封面时，用标题和分类色自动生成文字封面
- 长按书籍可删除或查看书籍信息

**阅读器**（WebView 渲染）

- 渲染库：markdown-it + highlight.js + KaTeX + Mermaid，**全部打包进 App，不走 CDN**
- 目录侧栏：由各章的 H1 / H2 / H3 生成
- 阅读进度：记录滚动比例和最近的标题锚点，进入章节时自动恢复
- 主题：亮色、暗色、护眼三种；字号和行距可调
- 代码块：默认横向滚动，可切换为自动换行；提供一键复制
- 宽表格放在可横向滚动的容器里；图片支持点击放大
- 上一章 / 下一章导航
- RN 与 WebView 之间通过 `postMessage` 通信，协议类型定义在 `app/src/reader/bridge.ts`
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

---

## 11. 里程碑

| 阶段 | 内容 | 完成标准 |
|---|---|---|
| **M0 骨架** | pnpm workspace、Expo 工程、`@shelf/spec`、`AGENTS.md` ×2、在真机上跑起来 | dev client 能装到 iPhone 上 |
| **M1 阅读器** | 内置 1～2 本示例书（首次启动时拷贝到 `books/`），书架页、阅读页、目录、阅读进度、主题 | 能完整阅读示例书，退出后再进入能恢复进度 |
| **M2 导入管线 + AirDrop** | inbox → 校验 → 原子写入 → 索引；注册文档类型 | AirDrop 一个 zip 后，书出现在书架上；同 id 再次导入为更新 |
| **M3 局域网传书** | 传书页、HTTP 服务、上传页面、PIN | 电脑浏览器能拖拽上传；curl 能推送 |
| **M4 CLI** | `shelf-pack` 的 check / pack / push | 一条命令完成从写书到手机可读 |
| **后续** | 全文搜索（FTS5，中文用 trigram）、高亮与笔记、“文件” App 可见、笔记导出回仓库 | — |

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
| 解压库 | fflate 而非 react-native-zip-archive | 纯 JS，少一个原生依赖；解压前就能逐条检查路径与大小；App 与 CLI 共用同一份导入逻辑，并能在 Node 里测试。50 MB 上限内整包读入内存可以接受 |
