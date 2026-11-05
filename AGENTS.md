# hatch-shelf 代码规范

个人自用的 iOS 离线 Markdown 书架。设计文档见 `README.md`，动手前先读与当前任务相关的章节；
架构或决策有变时同步更新 README（尤其是第 12 节决策记录）。

书、封面原稿、原声录音和阅读笔记在相邻的书库仓库 `../hatch-shelf-library`（私有、纯数据，没有 package.json），写书规则见那里的 `AGENTS.md`。shelf-pack 默认就操作那个书库（环境变量 `SHELF_LIBRARY` 可改）。

## 仓库结构

| 目录 | 内容 |
|---|---|
| `app/` | Expo App（expo-router，路由在 `app/src/app/`，其他代码放在 `app/src/` 下的其他目录） |
| `app/reader-web/` | `@shelf/reader-web`：WebView 里运行的阅读器（markdown-it + highlight.js + KaTeX + Mermaid），`build.mjs` 打成 `app/assets/reader/index.html` |
| `packages/spec/` | `@shelf/spec`：book.yaml 的 zod schema、容错解析、导入安全规则。App 与 CLI 共用，**不得依赖 Node 或 RN 专有 API** |
| `tools/shelf-pack/` | Node CLI：check / pack / push |
| `app/samples/` | 随安装包发布的 2 本示例书（shelf-guide、markdown-cheatsheet），也是 shelf-pack 测试用的书 |
| `design/` | App 的 UI 设计稿 `设计稿.pen`（只能用 pen.dev / Pencil MCP 读写）；图片放 `covers/` `images/` `splash/` 子目录，不放在根目录。封面原稿在书库仓库的 `封面.pen`，改封面去那边 |

## 原则

- **文件即真相**：书籍原文只存在 `documentDirectory/books/`；SQLite 只存索引（可重建）和用户数据（progress / settings，不可丢）
- **单一导入管线**：所有导入通道只负责把文件交给管线，不得各自写 `books/`
- **App 不联网**：除传书页面的局域网 HTTP 服务外，不发起任何网络请求；阅读器资源全部本地打包，不走 CDN
- 判断书籍结构的逻辑（容错规则、扩展名白名单、zip slip 检查）只写在 `@shelf/spec`，App 和 CLI 调用它
- RN ↔ WebView 通信的消息类型只在 `app/src/reader/bridge.ts` 定义

## Expo 注意事项

当前为 Expo SDK 58。Expo 每个 SDK 都有破坏性变更，不要凭记忆写 API：

1. 先看 `app/package.json` 里 `expo` 的主版本
2. 查对应版本文档 `https://docs.expo.dev/versions/v<major>.0.0/`，或从 `https://docs.expo.dev/llms.txt` 找到具体页面

- 依赖用 `npx expo install <pkg>`（在 `app/` 下执行）安装，以获得与 SDK 匹配的版本
- `ios/` `android/` 由 `expo prebuild` 生成，不入库、不手改；原生配置写在 `app.json` 或 config plugin 中
- 用到原生模块，必须使用 dev client（`pnpm app ios`），不能用 Expo Go；新增原生依赖后要重新构建
- 不使用 EAS Update（见 README 决策记录）
- 改了 `reader-web/` 或 `app/samples/` 里的示例书后要重新 `pnpm app build:assets`；改了 `metro.config.js` 要重启 Metro

## 命令

```bash
pnpm install                 # 根目录；使用 hoisted node_modules（见 .npmrc）
pnpm app ios                 # 构建 dev client（包名 com.jarvis.shelf.dev，不覆盖正式版）并安装到模拟器 / 真机（加 --device 选真机）
pnpm app start               # 启动 Metro（会先执行 build:assets）
pnpm app build:assets        # 重新生成阅读器 HTML 和示例书模块（两者都不入库）
pnpm typecheck               # 全仓类型检查
pnpm test                    # 全仓测试
pnpm lint                    # App 的 ESLint（含 no-floating-promises）
pnpm shelf-pack check               # 校验整个书库；check app/samples 校验示例书
pnpm shelf-pack ls                  # 按分类列出书库里的书；其他命令（new / mv / audio / push …）见 README 第 10 节
SHELF_LIBRARY=../hatch-shelf-library pnpm --filter shelf-pack test   # 改了切段、校验、打包规则后对整个书库跑一遍
pnpm app testflight          # 构建 Release 并上传 TestFlight（见 README 第 13 节）
```

声明任务完成前必须通过 `pnpm typecheck`、`pnpm test` 和 `pnpm lint`。

`no-floating-promises` 不要用 `// eslint-disable` 绕过：确实不需要等待时写 `void promise`，需要处理失败时加 `.catch`。

## 提交

- 代码使用 Conventional Commits：`feat:` / `fix:` / `chore:` / `refactor:` / `docs:` …，可加 scope，如 `feat(app):`、`feat(spec):`
- 内容使用 `content:`；不要把代码和内容改动混在一个提交里
- 提交信息和 PR 描述不加任何 AI 署名（如 `Co-Authored-By: Claude …`、`Generated with Claude Code`），作者只有仓库所有者
