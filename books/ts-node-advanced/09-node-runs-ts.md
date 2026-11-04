# Node 直接跑 TS 与 erasableSyntaxOnly

很长一段时间里，在 Node 上跑 TypeScript 要么先 `tsc` 编译，要么借助 ts-node、tsx 这类工具即时转译。现在 Node 自己就能跑 `.ts` 文件：`node src/index.ts`，没有构建步骤，没有额外依赖。

但「能跑」有前提：Node 只**擦掉**类型，不**编译** TypeScript。凡是需要生成运行时代码的 TS 语法，它都不认。这一章讲清 Node 的类型擦除是怎么工作的、哪些语法会炸、怎么用 `erasableSyntaxOnly` 等编译选项在写代码时就挡住它们，最后以 hatch-recordwall 的 `tools/` 为例给出一套完整配置，并讨论什么时候该用、什么时候不该用。

## Node 做了什么

> [!WARNING]
> 下表按 2026 年 11 月 Node.js 官方文档「Modules: TypeScript」页面（v26.13.0 版）的版本历史整理；22.23 上的行为是笔者实测，24 及以后的行为只按文档和发布说明整理、没有实机重跑。以 Node.js 官方文档和 changelog 为准。

Node 的类型擦除（type stripping）大致经历了这几步：

| 版本 | 状态 |
|---|---|
| 22.6 | 加入 `--experimental-strip-types`，需要显式开启 |
| 22.7 | 加入 `--experimental-transform-types`（见本章末尾） |
| 23.6 | 默认开启，不再需要参数 |
| 22.18 | 默认开启被移植回 22 LTS，同时不再打印实验性警告 |
| 24.3 | 24 线不再打印实验性警告 |
| 24.12 / 25.2 | type stripping 标为**稳定**（Stability 2） |
| 26.0 | 移除 `--experimental-transform-types` |

所以以 Node 24 LTS 为基线时，`node src/index.ts` 用的是一个稳定功能（24.12 及以后）；22 线上它默认开启、不再报警告，但文档的版本历史里没有把 22 标为稳定。

hatch-recordwall 的根 `package.json` 里写着 `"engines": { "node": ">=22.18" }`，就是这个原因：低于 22.18，`node src/index.ts` 会直接报语法错误，不是降级运行。可以用 `node -p process.features.typescript` 检查当前 Node 的模式，22.23 上输出 `strip`。

擦除的方式很特别：**把类型注解原地替换成空格**，而不是删掉后重新排版：

```mermaid
flowchart LR
  A["const n: number = 1"] --> B["const n         = 1"]
  B --> C["V8 直接执行"]
```

这样做的好处是代码的行号、列号完全不变，**不需要 source map**。报错堆栈、CPU 剖析（第 8 章）里的位置直接对应源码。代价是 Node 只能处理「删掉之后剩下的就是合法 JS」的语法。

## 哪些语法擦不掉

下面每一条都在 Node 22.23 上实测过：

| 语法 | Node 的反应 |
|---|---|
| `enum Level { Info, Warn }` | `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`：enum 会生成一个运行时对象 |
| `namespace Util { export const x = 1 }` | 同上；只含类型的 `declare namespace` 可以 |
| `constructor(private x: number) {}` | 同上：参数属性要生成 `this.x = x` |
| `<number>value` 尖括号断言 | 不支持，提示改用 `value as number` |
| 装饰器 `@Injectable()` | V8 不认识装饰器语法，直接 `SyntaxError` |
| `import x = require("y")`、`export =` | 不支持 |
| `.tsx` 文件 | `ERR_UNKNOWN_FILE_EXTENSION`，JSX 需要真正的编译 |

注意装饰器这一条：**NestJS 重度依赖装饰器和 `emitDecoratorMetadata`**，所以 NestJS 应用不能用 Node 直接跑，仍然需要 `tsc` / SWC 编译。

另外两类问题不报语法错，但同样会在运行时出事：

```ts
// colors.ts
export type Color = "red" | "green";
export const paint = (c: Color): string => c;
```

```ts
// bad-import.ts —— Color 只是类型，擦除后这行 import 会真的去找一个叫 Color 的导出
import { Color } from "./colors.ts";
```

```text
SyntaxError: The requested module './colors.ts' does not provide an export named 'Color'
```

```ts
// bad-ext.ts —— Node 按字面路径找文件，./colors.js 不存在
import { paint } from "./colors.js";
```

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../colors.js'
```

第二个很有迷惑性：在 `moduleResolution: nodenext` 下，`tsc` 会把 `./colors.js` 映射到 `colors.ts`，类型检查完全通过，一跑就挂。

## 让编译器提前拦住

这些错误都要到运行时才暴露，而对 CLI 工具来说，「运行时」往往就是你要用它的那一刻（比如出包上架的当口）。所以要在 `tsconfig` 里打开几道闸门，让编辑器和 `tsc --noEmit` 在写代码时就报错：

| 选项 | 拦住什么 | 引入版本 |
|---|---|---|
| `erasableSyntaxOnly` | enum、带运行时代码的 namespace、参数属性、尖括号断言、`import =` | TS 5.8 |
| `verbatimModuleSyntax` | 没写 `type` 的类型导入（要求写 `import { type Color }` 或 `import type`） | TS 5.0 |
| `allowImportingTsExtensions` | 允许写 `./colors.ts`（要求 `noEmit` 或配合 `rewriteRelativeImportExtensions`） | TS 5.0 |
| `module` / `moduleResolution: nodenext` | 按 Node 的真实规则解析模块，认得 `.ts` 后缀 | — |

实测这三类问题：

```text
bad-enum.ts(1,6): error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.
bad-param.ts(1,23): error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.
bad-import.ts(1,10): error TS1484: 'Color' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
```

有一个漏网之鱼：**装饰器不在 `erasableSyntaxOnly` 的检查范围内**（TS 认为标准装饰器是合法的 JS 语法），但 V8 目前还不支持。在「Node 直接跑」的包里，用 lint 规则或代码评审禁掉装饰器。

### 擦不掉的语法怎么替换

```ts
// enum → as const 对象 + 联合类型
export const Level = { Info: 0, Warn: 1, Error: 2 } as const;
export type Level = (typeof Level)[keyof typeof Level]; // 0 | 1 | 2

function log(level: Level, msg: string) {
  if (level >= Level.Warn) console.error(msg);
}
log(Level.Warn, "disk almost full");

// 参数属性 → 显式字段
class Uploader {
  readonly bucket: string;
  constructor(bucket: string) {
    this.bucket = bucket;
  }
}

// namespace → 模块本身就是命名空间：import * as util from "./util.ts"
```

这些写法本来就更接近标准 JS，打包工具处理起来也更简单。TypeScript 团队近几年的方向也是如此：新特性尽量只在类型层面做文章，不再引入需要生成代码的语法。

## 一套完整配置：hatch-recordwall 的 tools/

hatch-recordwall 的 `tools/` 下有几个 CLI 包（出 iOS 包传 TestFlight、在运行中的 App 里执行 JS、重新打包一段注入 WebView 的脚本），全部 `node src/index.ts` 直接跑，不装 tsx，也没有构建步骤。它们共用的 `tools/tsconfig.base.json`（注释有精简）：

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    // 不给 DOM：这儿跑在 Node 里，没有 window
    "lib": ["ES2022"],
    // nodenext 才认得带 .ts 后缀的相对导入
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "allowImportingTsExtensions": true,
    // 两道给「Node 只擦不编」兜底的闸门
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    // shamefully-hoist 把全仓 @types 提到了根，不写死会全收进来
    "types": ["node"]
  }
}
```

每个包的 `package.json`：

```json
{
  "name": "@tools/ship",
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "ship": "node src/index.ts"
  },
  "dependencies": { "@tools/shared": "workspace:*" }
}
```

几个值得注意的细节：

- **`"type": "module"`**：让 `.ts` 文件按 ESM 处理。不写的话 Node 22 会根据语法自动检测，但 `tsc` 会把文件当成 CommonJS，报一堆模块相关的错误。明确写上，两边口径一致
- **跨包共享源码**：`@tools/shared` 的 `package.json` 里 `"exports": { ".": "./src/index.ts" }`，直接导出 TS 源码。Node 规定**不擦除 `node_modules` 里的 `.ts`**（会报 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`），但 pnpm workspace 的依赖是指向 `tools/shared` 的符号链接，Node 解析到的真实路径不在 `node_modules` 下，所以能跑。这条只对 workspace 内部包成立，**发到 npm 上的包仍然必须编译成 JS**
- **类型检查是单独一步**：Node 只擦不查，类型错了照样运行。`pnpm typecheck` 必须放进提交前检查或 CI
- **`types: ["node"]`**：TypeScript 6.0 起 `types` 的默认值就是空数组（不再自动收录所有 `@types/*`），recordwall 当时用的是 TS 5.9，所以要显式写；在 TS 6 下这一行依然要写，否则连 `process` 都找不到

## Node 不管的事

Node 的类型擦除**完全不读 tsconfig**。所以这些 tsconfig 里的功能在 Node 直接跑时统统不生效：

| tsconfig 功能 | 后果 | 替代 |
|---|---|---|
| `paths`（`@/*` 别名） | 运行时找不到模块 | 用 `package.json` 的 `imports` 字段（`#src/*`），Node 原生支持 |
| `target` 降级 | 不降级，写什么跑什么 | Node 22 本身支持到 ES2024 左右，基本不需要 |
| `jsx` | `.tsx` 根本不支持 | 用打包工具 |
| `experimentalDecorators` / `emitDecoratorMetadata` | 装饰器语法错误 | 用 `tsc` / SWC 编译 |

## 选哪种方式

```mermaid
flowchart TD
  A["要运行的 TS 代码"] --> B{"用到装饰器、<br/>enum、JSX、<br/>paths？"}
  B -->|"是：NestJS、<br/>React 等"| C["编译或打包：<br/>tsc / SWC /<br/>Vite / esbuild"]
  B -->|"否"| D{"是发布到<br/>npm 的库吗？"}
  D -->|"是"| E["tsc 编译成<br/>JS + .d.ts<br/>可用 rewriteRelative<br/>ImportExtensions"]
  D -->|"否"| F{"Node 下限能<br/>定在 22.18 吗？"}
  F -->|"能"| G["node 直接跑 +<br/>erasableSyntaxOnly"]
  F -->|"不能"| H["tsx 等<br/>即时转译工具"]
  C ~~~ D
  E ~~~ F
```

几个真实项目的选择：

| 项目 | 方式 | 原因 |
|---|---|---|
| hatch-recordwall `tools/*` | `node src/index.ts` | 内部 CLI，Node 版本自己能控制，零依赖、无构建 |
| hatch-shelf `tools/shelf-pack` | `tsx src/cli.ts` | 更早写成，依赖的 `@shelf/spec` 用 `moduleResolution: Bundler`、导入不带后缀，要改成 Node 直接跑需要先统一导入写法 |
| hatch-counter 的 NestJS API | 编译后运行 | 装饰器、依赖注入元数据 |
| Expo / Electron 渲染进程 | Metro / Vite 打包 | JSX、资源处理，本来就需要打包 |

如果要把一个 Node 直接跑的包发到 npm，`tsc` 可以在输出时把 `./a.ts` 改写成 `./a.js`：

```bash
tsc --module nodenext --rewriteRelativeImportExtensions --outDir dist
```

```js
// dist/main.js —— 源码里是 import { a } from "./a.ts"
import { a } from "./a.js";
console.log(a);
```

### 如果实在需要 enum

Node 22 和 24 还有一个 `--experimental-transform-types` 参数，会真正转换 enum、namespace 这些语法（同时生成 source map）。它一直是实验性功能，运行时会打印 `ExperimentalWarning`，而且 **Node 26.0.0 已经把它移除了**：今天依赖它的代码，升到 26 就跑不起来。把代码改成可擦除的写法，才是这个生态收敛的方向。

## 去工具链：把 tsx 换成 node

前面说 hatch-shelf 的 `tools/shelf-pack` 还在用 `tsx src/cli.ts`。如果要把它改成 Node 直接跑，去掉 tsx 这个开发依赖，会经历什么？这一节按实际顺序走一遍，也是任何「去工具链」迁移的通用清单。

**第一步：先让它失败一次**。在 Node 22.23 上直接运行：

```text
$ node tools/shelf-pack/src/cli.ts ls
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../tools/shelf-pack/src/books'
imported from .../tools/shelf-pack/src/cli.ts
```

擦除这一关已经过了，卡在**模块解析**：源码里写的是 `from './books'`，没有后缀。tsx 和打包工具会替你补后缀，Node 的 ESM 解析不会，这是迁移里工作量最大的一块。

**第二步：tsconfig 改成 Node 的解析规则**。仓库的 `tsconfig.base.json` 用的是 `moduleResolution: Bundler`，它允许不带后缀的导入，所以 `tsc` 从没报过错。给要直接跑的包单独覆盖：

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

改完先跑 `tsc --noEmit`，它会把每一处不带后缀的相对导入列出来，比运行时一个一个撞快得多。在 shelf-pack 上实测（TypeScript 6.0.3），报了 11 处 `TS2835`：spec 的 `index.ts` 8 处、`cli.ts` 2 处、测试文件 1 处，其余的 `TS2305`、`TS7006` 都是导入解析失败带出来的连锁错误：

```text
packages/spec/src/index.ts(1,15): error TS2835: Relative import paths need explicit
file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or
'nodenext'. Did you mean './schema.js'?
```

注意它建议的是 `.js`：那是给「先编译再运行」的项目准备的。Node 直接跑时要写 `.ts`，写 `.js` 正是本章要点里提到的那个坑。

**第三步：补后缀，处理共享包**。`./books` 改成 `./books.ts`。真正的麻烦在 `@shelf/spec`：它同时被 App（Metro 打包，`Bundler` 解析）和 CLI 用。好在 Metro 和 `Bundler` 解析都认带 `.ts` 后缀的导入（需要 `allowImportingTsExtensions`），所以把 spec 里的相对导入也统一写成 `.ts`，两边都能用。spec 能被 Node 直接加载的前提本章前面讲过：它在 pnpm workspace 里，解析到的真实路径不在 `node_modules` 下。

**第四步：检查擦不掉的语法**。打开 `erasableSyntaxOnly` 和 `verbatimModuleSyntax` 后 `tsc` 会指出 enum、参数属性、漏写 `type` 的类型导入。上面那次实测里 `TS1294` 和 `TS1484` 一条都没有，这一步对 shelf-pack 是零改动；对用 NestJS 风格写过类的项目，这一步可能才是大头。

**第五步：删依赖，改脚本**。`package.json` 里 `"start": "tsx src/cli.ts"` 改成 `"start": "node src/cli.ts"`，删掉 `tsx`，并写上 `"engines": { "node": ">=22.18" }`（以 Node 24 为基线时可以直接写 `>=24.12`）。

还有几件 tsx 顺手做了、换成 node 后要自己接手的事：

| tsx 替你做的 | 换成 node 后 |
|---|---|
| 补导入后缀 | 源码里写 `.ts` 后缀 |
| `tsconfig` 的 `paths` 别名 | 改用 `package.json` 的 `imports`（`#src/*`） |
| `tsx watch` | `node --watch src/cli.ts` |
| 读 `.env` | `node --env-file=.env src/cli.ts` |
| 测试 | Vitest 自己处理 TS，不受影响 |

**什么时候不值得迁**。shelf-pack 每次运行多花的那点转译时间感觉不到，tsx 也不会在运行时引入额外的风险；迁移换来的是少一个依赖，代价是改一遍全部导入、让 spec 的写法受 Node 规则约束。对一个已经稳定工作的工具，这笔账不一定划算。新写的内部 CLI，从第一行就按 Node 直接跑的规矩写，成本几乎为零，hatch-recordwall 的 `tools/` 就是这样。

## 本章要点

- Node 22.18+ / 23.6+ 默认能直接运行 `.ts`，方式是把类型替换成空格：行列号不变，不需要 source map，但完全不读 tsconfig、不做类型检查；24.12 / 25.2 起标为稳定，`--experimental-transform-types` 在 Node 26 被移除
- 从 tsx 迁到 node，最大的工作量在模块解析：改用 `nodenext`、给相对导入补 `.ts` 后缀
- 擦不掉的语法：enum、带代码的 namespace、参数属性、尖括号断言、`import =`；装饰器和 `.tsx` 也不支持，所以 NestJS 和 React 代码仍需编译
- `erasableSyntaxOnly` + `verbatimModuleSyntax` + `allowImportingTsExtensions` + `nodenext` 让这些问题在编辑器里就暴露；装饰器是漏网之鱼，要靠 lint
- 相对导入写 `.ts` 后缀；写 `.js` 后缀 tsc 不报错但 Node 找不到文件
- `node_modules` 里的 `.ts` 不会被擦除；pnpm workspace 内部包因为是符号链接可以直接导出源码，发 npm 的包仍要编译
- 内部工具、脚本、CLI 适合直接跑；库、NestJS、前端代码继续用编译或打包

## 动手练习

1. **enum 在两道关口各怎么报**：在一个 `package.json` 写了 `"type": "module"` 的空目录里建 `e.ts`：

   ```ts
   enum Level { Info, Warn }
   console.log(Level.Warn);
   ```

   先 `node e.ts`，再 `npx tsc --noEmit --erasableSyntaxOnly --module nodenext e.ts`。然后按本章的方法改成 `as const` 对象加联合类型，两条命令再各跑一次。

   验证：`node` 报 `SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript enum is not supported in strip-only mode`；`tsc` 报 `e.ts(1,6): error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.`。改写后 `node` 输出 `1`，`tsc` 无报错。

   参考答案：两边拦的是同一个问题，区别在时机：`tsc` 在编辑器和提交前就能报，`node` 要等到真的运行。

2. **类型导入少写一个 type**：用本章的 `colors.ts`，写一个 `bad.ts`：`import { Color, paint } from "./colors.ts";`，再用 `Color` 注解一个变量并打印 `paint(...)`。运行 `node bad.ts`，然后把导入改成 `import { type Color, paint } from "./colors.ts";` 再运行。

   验证：第一次报 `SyntaxError: The requested module './colors.ts' does not provide an export named 'Color'`；改后正常输出。打开 `verbatimModuleSyntax` 时，`tsc --noEmit` 对第一种写法报 `TS1484`。

   参考答案：擦除只删类型注解，不分析一个导入名是不是纯类型；`Color` 留在了运行时的 `import` 语句里，而 `colors.ts` 运行时并没有这个导出。

3. **行号原样保留**：

   ```ts
   // line.ts
   interface Book {
     id: string;
     title: string;
   }
   function check(b: Book): void {
     if (!b.title) throw new Error(`book ${b.id} has no title`);
   }
   check({ id: "x", title: "" } as Book);
   ```

   预测 `node line.ts` 报错堆栈里指向的行号。

   验证：堆栈第一行是 `.../line.ts:6`，下面打印的源码就是 `throw new Error(...)` 那一行；`at check (.../line.ts:6:...)` 的列号也和编辑器里一致。

   参考答案：类型被替换成等长的空格，前面那个四行的 `interface` 变成空行，没有改变任何位置，所以不需要 source map。

读完这本书，类型系统和运行时这两块地基就打好了。技术栈纵深的下一站是[《React 19 原理与模式》](../react-internals/)，它会用类似的方式拆开 React 的调度和渲染；如果你更关心后端，可以接着读[《NestJS 后端架构》](../nestjs-backend/)，把本书第 4 章到第 8 章的运行时知识用到真实的服务里。
