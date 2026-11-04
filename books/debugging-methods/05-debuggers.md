# 调试器

`console.log` 是最常用的调试工具，也确实好用：不需要配置，到处都能用。但它有两个限制：你只能看到**事先想到要打印**的东西；每次想多看一个变量，都要改代码、重新运行、再走一遍复现步骤。

调试器解决的正是这两点。程序停在断点上时，当前作用域里的所有变量、整条调用栈、每一帧的局部状态都摆在面前，你可以随时决定看什么。对于「我不知道该打印什么」的问题，调试器往往比日志快得多。

这一章先讲断点的几种用法，然后按全栈开发者会遇到的几种运行环境分别讲怎么接上调试器：Node 服务、浏览器、iOS 的 WebView、React Native、Electron 主进程。

## 断点不只是「停在这一行」

| 断点类型 | 什么时候用 |
|---|---|
| 行断点 | 想看某一行执行时的状态 |
| 条件断点 | 循环里只关心某一次，比如 `bookId === "go-concurrency"` |
| 日志断点（logpoint） | 想打印但不想改代码；不停下，只输出一条消息 |
| 异常断点 | 不知道错误在哪抛出；勾上「在未捕获的异常处暂停」，或「在所有异常处暂停」 |
| DOM 断点 | 页面上某个元素被谁改了；在 Elements 面板右键元素设置 |
| 请求断点（XHR / fetch） | 某个请求是谁发出的；按 URL 片段设置 |

其中**条件断点和日志断点**最被低估。日志断点等于不改代码的 `console.log`，而且不会被误提交；条件断点让你在第 3000 次循环时才停下来，而不是按 3000 次继续。

**异常断点**适合「报错了但堆栈不全」的情况：勾上「在所有异常处暂停」，程序会在错误被抛出的那一刻停下，即使它后来被某层 `catch` 吞掉了。注意第三方库内部可能频繁抛出并捕获异常，可以配合「忽略列表」把 `node_modules` 排除掉。

停下来之后，几个操作最常用：

- **单步跳过 / 进入 / 跳出**：沿着执行路径走
- **调用栈面板**：点任意一帧，看那一帧的局部变量。这是调试器相对日志最大的优势：你能看到**调用方当时传了什么**
- **监视表达式**：持续观察一个表达式的值
- **控制台**：在当前作用域里执行任意代码，比如调用一个函数看返回值

## 案例：迁移每次启动都要重做一遍

> [!NOTE]
> 根因和现象取自 hatch-recordwall 的真实提交 d800d12；下面的 persist 代码是简化后的重构，断点过程用来演示方法，不是原样记录。

### 现象

hatch-recordwall 做过一次数据格式迁移：把下载记录里的 id 从旧格式换成新格式。迁移逻辑写在 store 的「恢复回调」里：从磁盘读出旧数据后，先跑一遍迁移再放进内存。

上线后发现两件奇怪的事：

- 每次启动日志里都有「迁移了 N 条记录」，N 每次都一样，好像迁移从来没有保存过
- 打开磁盘上的 `downloads.json`，还是旧格式；但 `library.json` 是新格式

### 先读代码

store 的持久化逻辑简化后是这样：

```typescript
export function persist<T>(store: Store<T>, file: File, restore: (raw: unknown) => T) {
  if (file.exists) {
    store.set(restore(JSON.parse(file.textSync())));
  }
  let last = store.get();

  store.subscribe((next) => {
    if (next === last) return;
    last = next;
    scheduleWrite(file, next);
  });
}
```

读了两遍没看出问题。`restore` 里迁移了数据，`store.set` 放进内存，之后有改动就写盘。看起来没毛病。

### 用调试器看

在 `let last = store.get()` 和订阅回调的 `if` 上各下一个断点，冷启动 App。

第一个断点停下时，在控制台里看 `store.get()`：已经是迁移后的新格式。`last` 被赋成了这个值。

继续运行，第二个断点**根本没有停**。启动过程中没有任何改动触发订阅，因为 `restore` 的结果是在订阅之前、在 `last` 赋值之前就放进去的。

这就是问题：**迁移后的数据被当成了「上次写盘的基线」**。在 persist 看来，内存里的数据和上次写盘的一样，没有必要写。实际上磁盘上一直是旧的。

`library.json` 为什么是新的？在它的订阅回调上设一个日志断点 `写 library.json`，冷启动后等一会儿，日志断点打出了一条：一个同步频道列表的后台任务改了数据，顺带写了盘。新格式是被「顺便」写进去的，跟迁移本身无关。

### 修复

基线应该是**磁盘上的内容**，而不是恢复后的内存内容：

```typescript
export function persist<T>(store: Store<T>, file: File, restore: (raw: unknown) => T) {
  let last: T | undefined;
  if (file.exists) {
    const raw = JSON.parse(file.textSync());
    const restored = restore(raw);
    store.set(restored);
    // 恢复回调改过数据（比如迁移）时，内存与磁盘不一致，要立刻写回
    if (JSON.stringify(restored) !== JSON.stringify(raw)) scheduleWrite(file, restored);
  }
  last = store.get();
  // ...
}
```

这个问题光读代码很难看出来，因为每一行单独看都是对的。调试器的作用是让你看到**第二个断点没有停**：一件「本该发生却没发生」的事，日志很难告诉你，因为你不会想到给没发生的事打日志。

## Node：inspector 协议

Node 内置了 inspector，打开后 Chrome DevTools 或 VS Code 可以连上去调试。

> [!WARNING]
> 本节 Node inspector 的参数和行为按 Node.js 22/24 整理，以 nodejs.org 对应版本的 Debugging Guide 和 CLI 文档为准。

### 本地启动

```bash
# 开 inspector，正常运行
node --inspect dist/main.js

# 开 inspector，并停在第一行等调试器连上（调试启动过程时用）
node --inspect-brk dist/main.js

# NestJS 的开发模式
pnpm nest start --debug --watch
```

打开 Chrome 的 `chrome://inspect`，在 Remote Target 里点 inspect，就是一个连着 Node 进程的 DevTools。VS Code 里更方便：在「JavaScript Debug Terminal」里运行任意命令，它会自动附加到所有启动的 Node 进程上，包括 `pnpm test` 起的 Vitest。

### 对一个已经在运行的进程

进程启动时没加 `--inspect`，也可以事后打开：

```bash
kill -USR1 <pid>
```

Node 收到 `SIGUSR1` 会打开 inspector，监听默认的 `127.0.0.1:9229`。这在排查一个「跑了几个小时后才出问题」的进程时很有用，不需要重启它。这个信号在 Windows 上不可用。

### 远程和容器里

inspector 能执行任意代码，**绝不能监听公网地址**。调试服务器上的进程，用 SSH 隧道把远端的回环端口转到本地：

```bash
ssh -L 9229:127.0.0.1:9229 deploy@counter-server
```

然后本地的 `chrome://inspect` 就能看到它。

容器里的进程要在容器内监听 `0.0.0.0:9229`，宿主机只映射到回环地址：

```yaml
services:
  server:
    command: node --inspect=0.0.0.0:9229 dist/main.js
    ports:
      - "127.0.0.1:9229:9229"
```

> [!CAUTION]
> 在生产服务器上暂停断点会让整个进程停下，所有请求都会卡住。生产环境只用日志断点，或者只做 CPU、内存剖析，不要用会暂停的断点。

## 浏览器：Chrome DevTools

网页端的调试大家都熟悉，这里只提几个排查时特别有用、但常被忽略的功能：

- **Sources 面板的「Pause on caught exceptions」**：配合忽略列表，找到被吞掉的错误
- **Network 面板右键「Copy as cURL」**：把一个请求原样复制成命令，脱离页面单独重放、修改参数，是验证「是前端还是后端问题」最快的方法
- **Network 面板的「Initiator」列**：这个请求是哪行代码发出的
- **Overrides**：用本地文件替换线上的某个资源，不用部署就能在线上环境验证修复
- **`debugger;` 语句**：DevTools 开着时执行到它就会暂停，在找不到对应源码位置时很有用

## iOS WebView：Safari Web Inspector

hatch-shelf 的阅读器跑在 WKWebView 里。WebView 里的页面不能用 Chrome DevTools 调试，要用 Mac 上的 Safari。

> [!WARNING]
> 本节 Safari 菜单路径、`isInspectable` 的系统版本要求，以及 react-native-webview 的 `webviewDebuggingEnabled` 属性，按 iOS 26–27 / Safari 26–27 时期的情况整理。Apple 从 2025 年起改用年份命名，iOS 18 之后的下一版就是 iOS 26；按 2026 年 11 月 Apple 安全更新页（support.apple.com/100100），当前为 iOS 27.2 / Safari 27.2。以 developer.apple.com 上 Web Inspector 的说明和 react-native-webview 的仓库文档为准。

步骤：

1. Mac 上的 Safari：设置 → 高级 → 勾选「显示网页开发者功能」，菜单栏出现「开发」
2. iOS 16.4 起，App 内的 WKWebView 默认不可被检查，需要 App 把它设为可检查。react-native-webview 提供了属性：

```tsx
<WebView
  source={{ uri: readerUri }}
  webviewDebuggingEnabled={__DEV__}
  // ...
/>
```

用 `__DEV__` 控制，Release 包里不开。

3. 在模拟器里打开 App 进入阅读页；真机则用数据线连上 Mac，并在 iPhone 的「设置 → App → Safari 浏览器 → 高级」里打开「网页检查器」（iOS 18 起系统自带 App 的设置收进了「App」一栏）
4. Safari 菜单「开发」→ 选择模拟器或设备 → 选择对应的页面

接上之后就是完整的 Web Inspector：DOM、控制台、断点、网络、存储都有。阅读器的排版问题、KaTeX 渲染问题、bridge 消息收发，都在这里看。

调试 RN 和 WebView 之间的通信时，两边各看一半：WebView 一侧在 Safari 里给 `postMessage` 和消息处理函数下断点，RN 一侧在下面要讲的 React Native DevTools 里下断点。消息格式只在一个文件里定义（见[《React Native 与 Expo》的 WebView 一章](../rn-expo/07-webview-bridge.md)），两边对照着看哪一侧收到的和发出的不一致。

## React Native DevTools

> [!WARNING]
> React Native DevTools 从 RN 0.76 起成为默认调试器，各面板（Console、Sources、Memory、Performance、Network）的可用性随 RN 版本逐步增加。本节按写作时 Expo SDK 58 对应的版本整理，以 reactnative.dev 的 Debugging 文档和 docs.expo.dev 对应 SDK 的调试文档为准。

React Native DevTools 是基于 Chrome DevTools 前端的调试器，直接连 Hermes 引擎：

- 在跑着 Metro 的终端里按 `j` 打开
- 或者在 App 里摇一摇（模拟器按 `Cmd+D`）打开开发菜单，选择打开 DevTools

能用的功能：

- **Console**：App 里 `console.log` 的输出，以及在当前上下文执行代码
- **Sources**：断点、单步、调用栈、作用域，和网页上一样
- **React 组件树与 Profiler**：看组件的 props、state，以及哪些组件重新渲染了
- **Memory / Performance**：堆快照和性能录制，第 6、7 章会用到

几个注意点：

- 断点是打在 Hermes 上的，调试的是 dev client 里的 JS，和 Release 构建的行为可能不同（`__DEV__` 分支、压缩）
- 原生层（Swift / Objective-C）的问题要用 Xcode 调试，React Native DevTools 看不到
- 改了原生依赖要重新构建 dev client，否则调试的还是旧的原生壳

## Electron 主进程

Electron 有两类进程：渲染进程是 Chromium 页面，直接用窗口里的 DevTools（`Cmd+Option+I`）；主进程是 Node，要用 inspector。

> [!WARNING]
> Electron 的调试参数和 electron-vite 的命令行选项按写作时的版本整理，以 electronjs.org 的 Debugging the Main Process 文档和 electron-vite 文档为准。

```bash
# 直接用 electron 启动
electron --inspect=9229 .

# 停在主进程第一行
electron --inspect-brk=9229 .
```

然后同样在 `chrome://inspect` 里连上。用 electron-vite 的项目，开发模式下可以通过它的命令行参数把 inspector 选项传给 Electron；用 VS Code 调试时，写一个 launch 配置让它同时附加主进程和渲染进程，效率最高。

hatch-counter 的桌面端是 Electron。排查「点了没反应」这类问题时，最常见的情况是 IPC 某一端出错了而另一端没收到任何消息。这时三个位置各下一个断点：渲染进程调用 `window.api.xxx` 的地方、preload 里转发的地方、主进程里 `ipcMain.handle` 的处理函数。看请求停在了哪一层。IPC 的设计见[《Electron 桌面应用》](../electron-desktop/02-ipc.md)。

## 什么时候还是用日志

调试器不是万能的，这些情况日志更合适：

- **时序相关的问题**：断点一停，时序就变了，竞态问题可能就消失了
- **长时间运行才出现的问题**：不可能在断点前等几个小时
- **线上环境**：不能暂停进程
- **需要看趋势**：一个值在一千次调用里怎么变化，日志加 grep 比断点直观

实际排查中两者常常配合：先用日志缩小到某个函数，再用调试器在那个函数里看细节。

## 本章要点

- 调试器的优势是不需要事先想好看什么；对「本该发生却没发生」的事尤其有效
- 条件断点、日志断点、异常断点比普通行断点更常派上用场
- Node 用 `--inspect` / `--inspect-brk`，运行中的进程发 `SIGUSR1`；远程用 SSH 隧道，inspector 绝不监听公网
- iOS WebView 用 Safari Web Inspector，App 侧需要把 WebView 设为可检查，只在开发构建里开
- React Native DevTools 在 Metro 终端按 `j` 打开，调试的是 Hermes 上的 JS；原生层用 Xcode
- Electron 主进程用 inspector，渲染进程用窗口里的 DevTools；IPC 问题三处下断点
- 时序问题、长时间运行、线上环境，用日志而不是暂停断点

## 动手练习

1. **条件断点停在第 3000 次**：写一个 `loop.mjs`，对 0 到 4999 的每个数算 `Math.sqrt(i) * 2` 并累加，最后打印总和。用 `node --inspect-brk loop.mjs` 启动，在 Chrome 的 `chrome://inspect` 里连上，在循环体那一行加条件断点 `i === 3000`，然后继续运行。

   验证：程序只停一次，Scope 面板里 `i` 是 `3000`；把断点改成日志断点 `i={i}` 后（DevTools 的日志断点表达式写法以当前版本为准），程序不停下，控制台出现输出。

   参考答案：条件断点让你跳过前 2999 次；日志断点等于不改代码的 `console.log`，不会被误提交。

2. **对运行中的进程打开 inspector**：运行 `node -e 'setInterval(() => {}, 1000)' &`，记下 PID，再执行 `kill -USR1 <pid>`（macOS 或 Linux）。

   验证：进程的终端输出里出现 `Debugger listening on ws://127.0.0.1:9229/...`，`chrome://inspect` 的 Remote Target 里出现这个进程。用完 `kill <pid>`。

   参考答案：进程启动时没加 `--inspect` 也能事后打开，默认只监听回环地址；要调试服务器上的进程，用 `ssh -L 9229:127.0.0.1:9229` 转过来，不要让它监听公网。

3. **找到被吞掉的错误**：写一个函数，对一组字符串逐个 `JSON.parse`，失败时 `catch` 后返回 `null`，其中有一个字符串是坏的。在 DevTools 的 Sources 面板勾选「Pause on caught exceptions」再运行。

   验证：调试器停在抛错的 `JSON.parse` 那一行，Scope 里能看到当时是哪个字符串；取消勾选后程序安静地跑完，只多了一个 `null`。

   参考答案：异常断点在错误被抛出的那一刻停下，不管它后来被谁 catch。第三方库内部频繁抛错时，把 `node_modules` 加进忽略列表。
