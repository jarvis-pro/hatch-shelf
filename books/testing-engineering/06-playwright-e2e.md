# Playwright 端到端

端到端测试是最接近用户的一层：真浏览器、真前端、真服务端、真数据库，像用户一样点击和输入。它能发现其他层都发现不了的问题（前端构建配置错了、跨域头漏了、两个页面之间的跳转断了），代价是慢，而且容易不稳定。这一章不重复 Playwright 的安装和基本写法，那些在[《前端工程化与 Web 平台》的 Playwright 一节](../frontend-engineering/09-testing.md#playwright端到端测试)里；这里讲一个人怎么把端到端测试用好：挑哪些流程、怎么把整套环境拉起来、数据怎么准备、怎么让它不乱红。

## 只测几条关键流程

端到端测试的数量要刻意控制。判断一条流程是否值得写端到端测试，问三个问题：

1. **它坏了是不是事故**：用户登录不了、钱记不上、数据导不出来，是；某个设置页的开关错位，不是
2. **下层能不能测到**：如果这条流程的风险全在某个纯函数里，在下层测就够了。端到端只为「拼在一起」这件事付费
3. **它是不是贯穿多层**：前端路由、表单、接口、数据库、再回到页面显示，路径越长，端到端测试的价值越高

按这个标准，hatch-counter 网页端值得写的大概只有这几条：

| 流程 | 为什么值得端到端 |
|---|---|
| 扫码或验证码登录 | 入口，坏了一切都用不了 |
| 记一笔开支，出现在流水和报表里 | 最高频的写操作，贯穿表单、幂等、版本号缓存、报表 |
| 导入一份收银报表 | 文件上传、列识别、预览、确认导入，步骤多 |
| 店员没有权限时看到正确的提示 | 权限错了是信任问题 |
| 另一台设备改了数据，这台一两秒内跟上 | 实时推送，只有两端同时在线才能验证 |

五六条，跑一遍一两分钟。不要追求「每个页面都有一条端到端测试」，那会得到一套跑二十分钟、每周都有几条莫名其妙变红的测试，最后被关掉。

## 把整套环境拉起来

> [!WARNING]
> 本节 `playwright.config.ts` 中 `webServer` 数组、`projects` 依赖、`trace` 等配置项按 Playwright 1.4x–1.5x 版本整理，配置项的名字和默认值可能调整，以 Playwright 官方文档为准。

端到端测试需要前端、服务端和数据库同时在线。Playwright 的 `webServer` 可以配多个服务，按顺序启动，每个都等到端口可用再继续：

```typescript
// apps/web/playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

const API_PORT = 13001;
const WEB_PORT = 15178;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // 几条流程共用一个服务端，先串行，稳定了再说
  forbidOnly: !!process.env.CI, // CI 里禁止残留 test.only
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // 服务端：用编译产物，连 e2e 专用的库
      command: "pnpm -C ../api build && node ../api/dist/main.js",
      url: `http://localhost:${API_PORT}/v1/health`,
      env: {
        PORT: String(API_PORT),
        APP_DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
        NODE_ENV: "development", // 验证码打在日志里，见第 3 章
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { VITE_API_BASE: `http://localhost:${API_PORT}` },
      reuseExistingServer: !process.env.CI,
    },
  ],
});
```

几个选择的理由：

- **端口用不常见的固定值**，避开日常开发用的端口。开发服务器开着的时候跑端到端测试，不会连到开发库上去
- **服务端跑编译产物**，和[《NestJS 后端架构》测试一章](../nestjs-backend/09-testing.md)里 hatch-counter 的思路一致：测的就是要部署的那份代码
- **服务端的 `reuseExistingServer` 设为 `false`**：永远起一个新的，避免连上一个配置不明的旧进程
- **`url` 指向健康检查**，而不是首页：服务端连上数据库才算准备好

数据库用[第 4 章](04-integration-db.md)的方式准备：全局 setup 里从模板库拷一个 `e2e` 库出来。

## 数据：通过 API 准备，每条测试一个新租户

端到端测试最慢的部分往往是准备数据。如果「记一笔开支」这条测试要先在界面上注册、建店、建分类，它就同时在测四五个流程，任何一个坏了它都红，而且慢。

原则是：**只有被测的那一步走界面，前置数据走捷径**。捷径有两种：

- 调服务端的 API（真实接口，比界面快一百倍）
- 直接写数据库（最快，但绕过了服务端的校验，数据可能不合法）

优先用 API。hatch-counter 的服务端测试里有现成的思路：`seedStore` 直接写库建一家店，因为「开户」这条路在专门的测试里验过了，其他测试只是需要一家能用的店。

用 Playwright 的夹具把它包起来，每条测试自动得到一个全新的、已登录的店：

```typescript
// e2e/fixtures.ts
import { test as base, expect, type Page } from "@playwright/test";
import { createTenant, loginToken } from "./api";

type Tenant = { storeId: string; phone: string; token: string };

export const test = base.extend<{ tenant: Tenant; ownerPage: Page }>({
  tenant: async ({}, use, testInfo) => {
    // 手机号按 worker 和测试序号生成，并行时也不会撞
    const phone = `137${String(testInfo.workerIndex).padStart(2, "0")}${String(Date.now()).slice(-6)}`;
    const { storeId } = await createTenant({ name: `e2e-${testInfo.title.slice(0, 10)}`, phone });
    const token = await loginToken(phone);
    await use({ storeId, phone, token });
  },

  ownerPage: async ({ page, tenant }, use) => {
    // 把令牌放进前端读取的存储里，跳过登录界面
    await page.addInitScript(
      ([t, s]) => {
        localStorage.setItem("session", JSON.stringify({ token: t, storeId: s }));
      },
      [tenant.token, tenant.storeId] as const,
    );
    await page.goto("/");
    await use(page);
  },
});

export { expect };
```

> 前端把会话存在哪里、键名是什么，以你的实现为准；上面的 `session` 只是示意。如果令牌存在 httpOnly cookie 里，用 `context.addCookies` 代替。

**每条测试一个新租户，测试结束不清理**。多租户系统天然隔离：A 店看不到 B 店的数据，所以测试之间不会互相干扰，也就可以并行。端到端库在每次运行前从模板重建，残留数据不会累积。

只有「登录」这条测试本身走完整的登录界面，其他测试都用 `ownerPage`。

## 写一条贯穿多层的测试

```typescript
// e2e/expense.spec.ts
import { expect, test } from "./fixtures";

test("记一笔开支，流水和本月合计一起更新", async ({ ownerPage: page }) => {
  await page.getByRole("link", { name: "开支" }).click();
  const total = page.getByTestId("month-total");
  await expect(total).toHaveText("¥0.00");

  await page.getByRole("button", { name: "记一笔" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("金额").fill("85");
  await dialog.getByLabel("用途").fill("菜刀");
  await dialog.getByRole("button", { name: "保存" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole("row", { name: /菜刀/ })).toBeVisible();
  await expect(total).toHaveText("¥85.00");
});
```

（界面元素的名称是示意。）

两个地方值得注意：

- **断言用 Playwright 的 web-first 断言**（`await expect(locator).toHaveText(...)`），它会自动重试直到满足或超时。不要写 `expect(await total.textContent()).toBe(...)`，那是读一次就比较，页面还没更新完就判了失败
- **合计数用了 `getByTestId`**。按[前一本书](../frontend-engineering/09-testing.md)的原则，优先用角色和文字定位；但一个纯数字的显示区域没有合适的角色，文字又是被断言的对象，这时 `data-testid` 是合理的选择

## 两个浏览器：测实时同步

hatch-counter 有一个只有端到端才测得到的功能：店主在电脑上改了数据，店长手机上一两秒内跟上。Playwright 可以在一条测试里开两个独立的浏览器上下文，相当于两台设备：

```typescript
test("另一台设备记了一笔，这台不刷新也能看到", async ({ browser, tenant }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await signIn(a, tenant);
  await signIn(b, tenant);
  await a.goto("/#/expenses");
  await b.goto("/#/expenses");

  await recordExpense(a, { amount: "85", title: "菜刀" });

  // b 没有任何操作，靠推送和缓存失效自己更新
  await expect(b.getByRole("row", { name: /菜刀/ })).toBeVisible({ timeout: 5_000 });
});
```

`signIn`、`recordExpense` 是普通的辅助函数，把重复的界面操作收起来。比起一整套 Page Object 类，**几个按业务动作命名的函数**对一人项目来说足够了，读起来就是业务流程。

超时设为 5 秒，比默认值长：推送要经过数据库触发器、`NOTIFY`、服务端、SSE 到浏览器，再加上客户端的重取。这个数应该比产品承诺的「一两秒」宽松，又不能宽松到掩盖真正的变慢。

## 网络拦截：只拦第三方

Playwright 可以用 `page.route` 拦截任何请求、返回假响应。它很强大，也很容易用过头：把自己服务端的接口全拦了，端到端测试就退化成了前端的组件测试，还更慢。

规则和[第 3 章](03-test-doubles.md)一样：**自己的服务端用真的，第三方的拦掉**。

```typescript
test("OCR 识别超时时，可以手动录入", async ({ ownerPage: page }) => {
  // 服务端调 OCR 时用的是服务端自己的配置，浏览器拦不到；
  // 这里拦的是前端直连的第三方（比如一个前端直接调用的地图或统计脚本）
  await page.route("https://analytics.example.com/**", (route) => route.abort());
  // ……
});
```

注意注释里的那句：服务端发出的请求不经过浏览器，`page.route` 拦不到。服务端的第三方依赖要在服务端那边替换，比如用环境变量把 OCR 服务地址指向一个本地的假服务。

另一个有用的场景是**模拟网络故障**：让某个自己的接口返回 500 或者干脆断开，验证前端有没有给出合理的提示，而不是白屏：

```typescript
await page.route("**/v1/expenses", (route) =>
  route.request().method() === "POST" ? route.abort("timedout") : route.continue(),
);
```

这类测试检查的是前端的错误处理，这时拦截自己的接口是合理的。

## 时间

> [!WARNING]
> `page.clock` 在 Playwright 1.45 引入，方法名和行为可能随版本调整，以 Playwright 官方文档 Clock 一节为准。

报表、到期提醒、「今天」的营业数据，都和当前日期有关。Playwright 提供了控制浏览器时钟的 API：

```typescript
test("月初第一天，本月合计从零开始", async ({ ownerPage: page }) => {
  await page.clock.setFixedTime(new Date("2026-11-01T10:00:00+08:00"));
  await page.reload();
  // ……
});
```

它只控制**浏览器**的时钟。服务端的「今天」仍然是真实日期，如果业务逻辑在服务端按日期计算，两边对不上反而会产生奇怪的结果。hatch-counter 的「营业日」由服务端计算，这类测试更适合放在服务端的 API 测试里，用服务端可注入的时钟来做。

## 截图对比：谨慎使用

`await expect(page).toHaveScreenshot()` 会把页面截图和基准图逐像素比较。它能抓到样式回归，但有两个现实问题：

- **字体渲染因系统而异**：macOS 上生成的基准图，在 Linux CI 上必然对不上。通常要在 Docker 里统一生成和比较
- **任何视觉调整都要更新基准图**，和大快照一样，容易变成无脑更新

一人项目的建议是：只对少数「设计稳定、坏了很难看」的页面做截图对比（比如登录页、打印的工资条），并且用 `mask` 遮住日期、金额这类每次都变的区域。日常的样式检查靠自己看。

## 不只是网页

hatch-shelf 是一个手机 App，看上去和 Playwright 无关，但它有一个网页：手机开启「传书」后，局域网里的电脑用浏览器打开手机的地址，看到一个上传页面。这个页面是一段 HTML 字符串，由 App 内的 HTTP 服务返回。

App 里的服务跑不进测试，但页面本身可以测：在测试里起一个最小的 Node HTTP 服务器，返回同一段 HTML，并实现 `/upload` 接口记录收到了什么，然后用 Playwright 打开页面、选文件、点上传，断言服务器收到了正确的 multipart 请求。这其实是[上一章](05-api-contract.md)契约测试的浏览器版本：验证「浏览器按这个页面发出的请求」和「App 的解析器期望的格式」一致。

## 让端到端测试保持可信

端到端测试一旦开始偶尔乱红，很快就没人相信它了。几条纪律：

- **不写固定等待**。`waitForTimeout` 一出现，就说明有一个没被正确表达的等待条件，找到它，改成等某个元素或某个响应
- **等网络时等具体的请求**：`await page.waitForResponse((r) => r.url().includes("/v1/expenses") && r.request().method() === "POST")`
- **失败时保留现场**：`trace: "retain-on-failure"` 会保存失败那次的完整录像、DOM 快照、网络和控制台。CI 里把 `test-results/` 作为产物上传
- **重试次数最多 1 次**，并且关注「重试后通过」的测试。Playwright 会把它们标成 flaky，这是要处理的信号，不是可以忽略的噪音。[第 9 章](09-ci-flaky.md)专门讲这件事

## 本章要点

- 端到端只测几条「坏了就是事故、贯穿多层」的关键流程，五六条就够
- `webServer` 可以同时拉起服务端和前端；端口避开开发端口，服务端跑编译产物
- 只有被测的那一步走界面，前置数据通过 API 准备；每条测试一个新租户，天然隔离、可以并行
- 用 web-first 断言，不读一次就比较；用按业务动作命名的辅助函数代替繁重的 Page Object
- 两个浏览器上下文可以测多设备实时同步
- `page.route` 只拦第三方和模拟故障，不拦自己的正常接口；它拦不到服务端发出的请求
- 浏览器时钟和服务端时钟是两回事；截图对比只用在少数稳定页面
- 不写固定等待，失败保留 trace，重试后通过的测试要处理

## 动手练习

1. **web-first 断言和读一次的区别**：在空目录运行 `pnpm create playwright` 只装 Chromium，写一条测试：`await page.setContent('<p id="t">加载中</p><script>setTimeout(() => document.getElementById("t").textContent = "完成", 500)</script>')`，然后分别用 `expect(await page.locator("#t").textContent()).toBe("完成")` 和 `await expect(page.locator("#t")).toHaveText("完成")` 断言，`npx playwright test` 各跑一次。

   验证：第一种失败，Received 是 `"加载中"`；第二种通过。

   参考答案：`textContent()` 只读一次，页面还没更新就比较了；web-first 断言会在超时内反复重试。看到想加 `waitForTimeout(600)` 的冲动时，换成第二种写法。

2. **用 route 模拟故障，测前端的错误处理**：页面内容是一段脚本，`fetch("https://api.example.com/items")` 成功时把 `#msg` 写成「已加载」，`catch` 里写成「加载失败，请重试」。测试里在 `setContent` 之前加 `await page.route("https://api.example.com/**", (r) => r.abort("timedout"))`，断言 `#msg` 的文字；再把 abort 换成 `r.fulfill({ json: [] })` 跑一次。

   验证：第一次页面显示「加载失败，请重试」，第二次显示「已加载」；两次都没有真的访问 `api.example.com`。

   参考答案：拦截让「网络坏了」变成可重复的输入，检查的是前端有没有合理的提示。注意它只能拦浏览器发出的请求，服务端发出的请求要在服务端那边替换。

3. **从 trace 里读出失败现场**：在 `playwright.config.ts` 的 `use` 里设 `trace: "retain-on-failure"`，故意让第 1 题的第一种写法失败，然后运行 `npx playwright show-trace` 打开 `test-results/` 下生成的 `trace.zip`。

   验证：trace 查看器里能按时间轴看到每一步操作，以及断言失败那一刻的 DOM 快照，`#t` 的文字是「加载中」。

   参考答案：CI 里把 `test-results/` 作为产物上传，偶发失败时不用重现，直接看当时的页面和网络。通过的测试不保留 trace，平时不占空间。
