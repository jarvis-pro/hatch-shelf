# ESLint / Prettier 的分工

代码检查工具最常见的失败方式不是「没装」，而是「装了没人看」：ESLint 输出几百条 warning，Prettier 和 ESLint 为同一行的分号来回改，每次提交 diff 里混着大片的格式变动。久而久之，大家学会了无视这些输出。本章讲清两个工具各管什么、怎么让它们不打架，以及怎么配置才能让 lint 一直保持「有输出就是真问题」的状态。hatch-counter 全仓一份 ESLint 配置，零 error 零 warning，它的 `eslint.config.mjs` 几乎每一块都写了原因，是很好的范本。

本章以 **ESLint 10**、**typescript-eslint 8.70**、**Prettier 3.9**、**eslint-plugin-react-hooks 7** 为准（hatch-counter 锁定的版本）。

## 一句话分工

hatch-counter 的规矩是：**排版归 Prettier，对错归 ESLint**。

| | Prettier | ESLint |
|---|---|---|
| 管什么 | 代码长什么样：缩进、换行、引号、分号、行宽 | 代码对不对：未使用的变量、漏了 await、hooks 依赖、危险写法 |
| 怎么管 | 把代码解析成 AST 再整个重新打印，**没有可选项** | 按规则逐条检查，报告或自动修复 |
| 可配置性 | 极少，故意的 | 极多 |
| 跑错了的代价 | 只是不好看 | 可能是 bug |

Prettier 的哲学是「不讨论风格」。它只给极少的选项，就是为了终结团队里关于分号和引号的争论。hatch-counter 的 `.prettierrc.json` 只改了一个值：

```json
{
  "printWidth": 120
}
```

文档里说这不是随便挑的，是照着现有代码量出来的：80 会把一半的函数签名折断，120 基本贴着作者原本的写法。而且「别改，改一次全仓重排一遍」。

## 让两者不打架

ESLint 早年有大量格式类规则（`indent`、`quotes`、`semi`），和 Prettier 的输出冲突。解决办法是在 ESLint 配置的**最后**挂上 `eslint-config-prettier`，它只做一件事：关掉所有和 Prettier 冲突的规则。

```js
// eslint.config.mjs 末尾
import prettier from "eslint-config-prettier";

export default tseslint.config(
  // ……其他配置
  // 关掉所有跟 Prettier 打架的风格规则，必须排在最后
  prettier,
);
```

必须在最后，因为扁平配置里后面的对象覆盖前面的。

不推荐的做法是 `eslint-plugin-prettier`，它把 Prettier 当成一条 ESLint 规则来跑，格式问题以 lint 错误的形式报出来。结果是 lint 输出里混满了「少个空格」的噪音，而且更慢。**两个工具分开跑**：

```json
{
  "scripts": {
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  }
}
```

ESLint 自己也已经把格式类规则弃用，转交给社区的 ESLint Stylistic 项目维护。用 Prettier 的项目不需要它。

## 扁平配置

ESLint 9 起扁平配置（`eslint.config.js` / `.mjs`）成为默认，旧的 `.eslintrc` 格式在 ESLint 10 中已经移除。扁平配置就是一个**配置对象的数组**，每个对象可以用 `files` / `ignores` 限定作用范围，后面的覆盖前面的：

```mermaid
flowchart TD
  A["全局 ignores<br/>dist、node_modules、生成的代码"] --> B["js.configs.recommended<br/>tseslint.configs.recommended"]
  B --> C["全仓通用规则<br/>no-unused-vars、no-explicit-any"]
  C --> D["按目录：类型感知规则<br/>各指向自己的 tsconfig"]
  D --> E["按目录：运行环境<br/>browser / node 全局变量"]
  E --> F["前端目录：React Hooks 规则"]
  F --> G["项目约定<br/>no-restricted-syntax / imports"]
  G --> H["eslint-config-prettier<br/>必须最后"]
```

hatch-counter 用 typescript-eslint 提供的 `tseslint.config()` 包装这个数组，它主要是提供类型提示和 `extends` 语法。较新的 ESLint 自带了 `defineConfig()` 做同样的事，typescript-eslint 也推荐迁移过去，新项目可以直接用后者（以两者官方文档为准）。

### 只有一个忽略对象时才是全局忽略

```js
{
  ignores: [
    "**/node_modules/**",
    "**/dist/**",
    // 钉到 apps/*：gradle 的产物落在 apps/<app>/release/。
    // 写成 **/release/** 的话会把 tools/release/ 整个吞掉，而且一声不响
    "apps/*/release/**",
    // shadcn 生成的：别手改，那也就没法照 lint 的意见改
    "apps/*/src/components/ui/**",
  ],
},
```

一个对象里**只有** `ignores` 时，它是全局忽略；如果同时有 `rules` 等字段，`ignores` 只是把这个对象自己的作用范围排除掉一部分。这是扁平配置最常见的误解之一。

`release/` 那条注释记录了一个三处都踩过的坑：`.gitignore`、ESLint、`.prettierignore` 里写裸的 `release/` 会匹配任意层级的同名目录，把 `tools/release/` 这个包整个吞掉。而结果是**无声的**：lint 照样绿（只是什么都没看）、`prettier --check` 照样说全部符合格式。**忽略规则要钉到具体路径**。

## 规则怎么选

### 没有 warning 这一档

hatch-counter 最值得借鉴的一条原则：

> 一条规则要么是闸门（error），要么在配置里明说不要并写清为什么。留成 warn 等于养一堆没人看的欠账。

warning 的问题是它不阻止任何事。CI 不会因为它失败，提交钩子不会拦它，于是它只会越积越多，直到 lint 输出成为背景噪音，真正的 error 也被淹没。

```js
{
  rules: {
    // 下划线开头表示「知道它没用上」：解构丢字段、占位参数都靠这个
    "@typescript-eslint/no-unused-vars": ["error", {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
      ignoreRestSiblings: true,
    }],
    // 这一档没有 warn：业务代码里一个 any 都没有，真要逃生就在那一行写 eslint-disable 并说为什么
    "@typescript-eslint/no-explicit-any": "error",
    // TS 自己就认标识符，no-undef 在 .ts 里只会误报
    "no-undef": "off",
  },
},
```

### 类型感知规则：挑真能抓 bug 的

typescript-eslint 有两套规则：普通规则只看语法树；**类型感知规则**会调用 TypeScript 编译器拿到类型信息，能发现更深的问题，但更慢，而且要能找到 `tsconfig`。

全量开启 `recommendedTypeChecked` 往往会因为大量 `any` 而刷屏。hatch-counter 只挑了四条：

```js
const TYPE_AWARE_RULES = {
  // 忘了 await 的 Promise：漏一个就是静默的时序错
  "@typescript-eslint/no-floating-promises": ["error", {
    allowForKnownSafeCalls: [
      { from: "package", package: "node:test", name: ["describe", "it", "test", "before", "after"] },
    ],
  }],
  // 把 async 函数传给只认同步返回值的地方（数组 filter、Express 中间件）
  "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
  "@typescript-eslint/await-thenable": "error",
  "@typescript-eslint/no-unnecessary-type-assertion": "error",
};
```

| 规则 | 抓什么 |
|---|---|
| `no-floating-promises` | 调了返回 Promise 的函数却既不 await 也不处理错误 |
| `no-misused-promises` | 把 async 函数传给期望同步回调的地方，比如 `if (asyncFn())` 永远为真 |
| `await-thenable` | await 一个不是 Promise 的值，通常说明理解错了 API |
| `no-unnecessary-type-assertion` | 多余的 `as`，类型已经是那样了 |

两个配置细节：

- `checksVoidReturn: { attributes: false }`：允许 `onClick={async () => {...}}` 这种 JSX 写法，否则 React 里到处报错
- `node:test` 的 `describe` / `it` 确实返回 Promise，由测试运行器接管，所以用 `allowForKnownSafeCalls` 放行，而不是在测试里满地写 `void`

类型感知规则需要知道每个文件属于哪个 `tsconfig`。一个 app 常常有几套 tsconfig（网页端就有页面和测试两套），所以配置里按目录**显式指定**：

```js
{
  files: ["apps/web/tests/**/*.ts", "apps/web/src/types/**/*.ts"],
  languageOptions: {
    parserOptions: { project: "apps/web/tsconfig.test.json", tsconfigRootDir: import.meta.dirname },
  },
  rules: TYPE_AWARE_RULES,
},
{
  files: ["apps/web/src/**/*.{ts,tsx}", "apps/web/vite.config.ts"],
  ignores: ["apps/web/src/types/**"],
  languageOptions: {
    parserOptions: { project: "apps/web/tsconfig.json", tsconfigRootDir: import.meta.dirname },
  },
  rules: TYPE_AWARE_RULES,
},
```

新目录漏了配置不会报错，只是那块的类型感知规则**静默不跑**。hatch-counter 因此把 `tools/` 下的子包列表改成从文件系统读：

```js
// 名单照 tools/ 底下带 tsconfig.json 的目录现读，不手写：原来是一份数组，
// icons、docs 两个包加进来时都漏了，漏了的包只挨通用规则、类型感知那批静默不跑
const TOOL_PACKAGES = readdirSync(new URL("tools/", import.meta.url), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(new URL(`tools/${d.name}/tsconfig.json`, import.meta.url)))
  .map((d) => d.name);
```

扁平配置就是 JavaScript，可以读文件、做循环，这是它比旧格式强的地方。typescript-eslint 较新的版本还提供了 `projectService` 选项，能自动为每个文件找到对应的 tsconfig，可以省掉这些手工映射，值得评估。

### React Hooks 规则

`eslint-plugin-react-hooks` 7 版本把一批原本服务于 React Compiler 的检查并入了推荐配置。hatch-counter 全部设为 error，只关了一条，并写了一大段理由：

```js
rules: {
  "react-hooks/exhaustive-deps": "error",
  /**
   * 唯一关掉的一条。它要求副作用里不能同步 setState，而本仓 30 处命中全是两类正经写法：
   * 订阅外部源之后把当前值写回 state，以及进页面取数。
   * 按规则改要换成 useSyncExternalStore 和 Suspense——那是架构决定，不是 lint 能推着走的，
   * 而它的收益（React Compiler 的自动 memo）本仓还拿不到。
   * 哪天真上了 compiler，先删这一行，再把那 30 处一起改。
   */
  "react-hooks/set-state-in-effect": "off",
},
```

这段注释示范了「关掉一条规则」应该怎么写：**为什么关、影响多大、什么条件下应该重新打开**。同一批里的 `purity`（渲染期调 `Date.now()`）、`static-components`（在组件里定义组件，每次渲染子树重挂、状态全丢）、`refs`（渲染期读写 ref）则保留，因为它们抓的问题不上 Compiler 也算 bug。

## 把项目约定写成规则

文档里写的约定会被遗忘，lint 规则不会。hatch-counter 用 ESLint 内置的两条通用规则实现了两个项目约定：

```js
{
  files: ["apps/*/src/**/*.tsx"],
  rules: {
    "no-restricted-syntax": ["error", {
      selector: 'JSXOpeningElement[name.name="input"] > JSXAttribute[name.name="type"][value.value="date"]',
      message: '日期选择用 shadcn 的 Calendar / shared/date-picker.tsx，别用 <input type="date">。',
    }],
  },
},
{
  files: ["apps/**/*.{ts,tsx}", "packages/**/*.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [{
        group: ["@counter/core/*", "**/packages/core/src/*"],
        message: 'core 只从包名根上导入（import { x } from "@counter/core"），深路径进不了打包。',
      }],
    }],
  },
},
```

`no-restricted-syntax` 接受 AST 选择器（语法类似 CSS 选择器），几乎任何「不许这样写」的约定都能表达。写选择器时可以借助 AST Explorer 这类在线工具查看节点结构。`message` 要写清**该用什么替代**，而不只是「不许」。

## 落地细节

### 编辑器

编辑器里装 ESLint 和 Prettier 扩展，保存时用 Prettier 格式化。但 hatch-counter 特意**没有**在保存时自动执行 `eslint --fix`，原因是 `--fix` 不是无脑安全的：`no-unnecessary-type-assertion` 会删掉「用来撑宽推断」的断言，比如 `key: g.group as string` 删掉之后，后面往同一个数组 push 别的字面量就类型不过。**自动修复后一定看 diff、跑一遍 typecheck**。

### Prettier 不收敛

罕见但存在：某些写法让 Prettier 在两种排法之间来回跳，跑一次变一次，`format:check` 永远失败。hatch-counter 撞上的是 `(await foo()).slice(0, 10).map(...)` 这种 await 挂在链头上的写法。对策是改写代码（把 await 拆成单独一句），而不是去调配置。

### 不进格式化的文件

`.prettierignore` 里除了产物和生成代码，hatch-counter 还排除了 `*.md`：Prettier 会把 `*斜体*` 换成 `_斜体_`，还按显示宽度把表格补齐成一大片，改一个格子整张表重排，diff 全是噪音。中文 Markdown 文档不进格式化是很常见的选择。

### 大面积格式化的提交

第一次引入 Prettier 时全仓重排，`git blame` 会全部停在那次提交上。把这类提交的 hash 写进 `.git-blame-ignore-revs`，再执行一次：

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

GitHub 网页上的 blame 会自动识别这个文件。

### 在哪里跑

hatch-counter 没有 CI，规定提交前在本地跑四条：`pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`；发版流水线里 `format:check` 和 `lint` 是硬闸门。用编码 agent 的话，把这四条写进 `CLAUDE.md`，agent 声明完成前必须跑通，效果和 CI 类似。

## 本章要点

- 排版归 Prettier，对错归 ESLint；`eslint-config-prettier` 放在配置最后
- 不要用 `eslint-plugin-prettier` 把格式问题混进 lint 输出
- ESLint 10 只有扁平配置；只含 `ignores` 的对象才是全局忽略；忽略规则钉到具体路径
- 没有 warning：规则要么是 error，要么关掉并写清原因和重新打开的条件
- 类型感知规则挑几条真能抓 bug 的；每个目录要指向正确的 tsconfig，漏了会静默失效
- 用 `no-restricted-syntax`、`no-restricted-imports` 把项目约定变成机器检查
- `--fix` 不是绝对安全，修完看 diff、跑 typecheck
