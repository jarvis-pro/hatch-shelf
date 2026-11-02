# 测试

前面八章反复出现一句话：「改坏了不报错」。守卫顺序调换、拦截器套叠顺序变了、新表漏了行级安全策略、配置指错了数据库角色，这些错误都不会让编译失败，也不会让服务启动失败，只会在某一天让某个用户看到不该看到的东西。**对一人公司来说，测试的首要任务不是追求覆盖率，而是把这些「不报错的规矩」变成会报错的断言**。这一章讲 Nest 官方的测试工具，再讲 hatch-counter 为什么选择「真数据库、真进程」的 e2e 测试，以及怎么用元测试守住约定。

## 三层测试，各测什么

| 层 | 测什么 | 速度 | hatch-counter 的例子 |
|---|---|---|---|
| 单元测试 | 纯函数、无依赖的逻辑 | 毫秒 | 配置断言、版本号比较、日期校验 |
| 集成测试 | 直连数据库验证数据库行为 | 百毫秒 | 行级安全、唯一约束、触发器 |
| e2e 测试 | 起真服务端，用 HTTP 打 | 秒 | 登录、权限、幂等、推送 |

很多教程推荐「大量单元测试、少量 e2e」的金字塔。但对一个以 CRUD 和权限为主的后端，**业务逻辑很大一部分在数据库和请求管线里**：RLS 策略、触发器、守卫顺序、拦截器顺序。把它们 mock 掉的单元测试，验的只是「我调用了我以为该调用的东西」。hatch-counter 的测试辅助文件开头就写着：测试跑在真实的 Postgres 上，不 mock；RLS、触发器、可延迟外键全都是数据库行为，mock 掉就等于什么都没验。

## Nest 的官方测试工具

先看 Nest 提供的标准做法，它适合测试单个 provider 或一组模块。

### 测试一个 service，替换它的依赖

```ts
import { Test } from "@nestjs/testing";

describe("ExpensesService", () => {
  let service: ExpensesService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ExpensesService,
        { provide: StorageService, useValue: { save: async () => "rcp-test.jpg", remove: async () => {} } },
      ],
    })
      .overrideProvider(DbService)
      .useValue(fakeDb)
      .compile();

    service = moduleRef.get(ExpensesService);
  });

  it("金额为负时拒绝", async () => {
    await expect(service.create("store-1", { amountCents: -1 /* ... */ })).rejects.toThrow();
  });
});
```

`Test.createTestingModule()` 建一个只含指定 provider 的小容器，`overrideProvider` 把依赖换成假的。这是依赖注入在测试上的直接红利。

### 起一个完整应用打 HTTP

```ts
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(() => app.close());

it("没登录访问业务接口回 401", () => {
  return request(app.getHttpServer()).get("/v1/expenses").expect(401);
});
```

这种写法有一个容易忽略的问题：`main.ts` 里做的事（全局过滤器、请求体上限、zod 语言、express 错误中间件）在这里都没有执行，**测的应用和部署的应用不是同一个**。常见的补救是把 `main.ts` 里的配置抽成一个 `configureApp(app)` 函数，测试和启动都调用它。

### 测试框架与装饰器元数据

[第 1 章](01-di-modules.md)讲过，Nest 的依赖注入依赖 `emitDecoratorMetadata`。测试框架用什么转换 TypeScript，直接决定上面的测试能不能跑：

| 测试运行方式 | 装饰器元数据 | 说明 |
|---|---|---|
| Jest + ts-jest | 有 | CommonJS 项目的传统组合 |
| Vitest + SWC / OXC 插件 | 有 | NestJS 12 ESM 项目的默认组合 |
| node:test + tsx（esbuild） | **没有** | 不能在测试进程里组装 Nest 应用 |

## hatch-counter 的选择：起真进程打 dist

hatch-counter 用 Node 内置的 `node:test`，测试进程本身用 tsx 跑。由于 esbuild 不输出装饰器元数据，它**不在测试进程里 import `AppModule`**，而是先 `tsc` 编译，再起一个子进程跑 `dist/main.js`，也就是真正会部署出去的那份产物：

```json
{
  "scripts": {
    "pretest": "tsc -p tsconfig.json && tsx tests/prepare-db.ts",
    "test": "node --import tsx --test --test-concurrency=4 --test-reporter=spec \"tests/**/*.test.ts\""
  }
}
```

```ts
export async function startServer(env: Record<string, string> = {}): Promise<TestServer> {
  const port = await freePort();
  const proc = spawn(process.execPath, [resolve(__dirname, "../../dist/main.js")], {
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(port),
      APP_DATABASE_URL: testUrl(cfg.APP_DATABASE_URL),
      DEV_LATENCY_MS: "0", // 开发机 .env 里开着模拟延迟的话，四百多条测试每条先睡半秒
      ...env, // 排在最后，测试可以覆盖任何一项
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // 等日志里出现启动成功的那一行，20 秒超时
  // ……
}
```

这样做的好处很明确：`main.ts` 里的一切都被测到了，换配置只需给子进程传不同的环境变量。健康检查的测试就是这么验证「数据库连不上要回 503」的：起一个 `APP_DATABASE_URL` 指向不存在的库的服务端，打 `/v1/health`，断言状态码。

几个辅助函数里的工程细节值得借鉴：

- **向内核要空闲端口**（`listen(0)` 拿到端口再关掉），不自己随机抽。一次测试要起二十多个服务端进程，随机抽撞车是迟早的事，而且常用的随机区间落在 Linux 的临时端口区里
- **开发模式下验证码打在日志里**，测试从子进程的 stdout 里捞出来完成登录流程，不需要 mock 短信服务
- **子进程的环境变量要显式关掉定时任务**：几十个服务端一起跑每日体检，只会拖慢别的测试，还可能和清库操作撞成死锁

## 一个测试文件一个数据库

所有测试共用一个库时，各自清表会互相死锁，只能串行跑。hatch-counter 的做法是：

1. `pretest` 阶段建一个模板库，迁移只在它身上跑一次
2. 每个测试文件用 `CREATE DATABASE ... TEMPLATE ...` 从模板拷出自己的库，库名从测试文件名算出来（如 `counter_test_payroll_e2e`），出事时一眼看出是哪个文件
3. 文件内每条测试前清表，各文件之间互不干扰

```ts
await admin.unsafe(`drop database if exists ${TEST_DB} with (force)`);
await admin.unsafe(`create database ${TEST_DB} template ${TEMPLATE_DB}`);
```

并发数是钉死的 4，不是「按 CPU 核数」。注释里算了一笔账：每个并行的测试文件最多占 19 条数据库连接（服务端进程的业务池 10、后台池 4、推送监听 1，测试自己 4），PostgreSQL 默认 `max_connections` 是 100。4 个并行是 76 条，还有余量；开到 8 个就会撞上去，而撞上去的表现是偶发的连接失败，不是一句说得清的报错。

## 写一条 e2e 测试

```ts
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { openTestDb, resetDb, type TestDb } from "./helpers/db";
import { api, startServer, type TestServer } from "./helpers/server";

describe("成员权限", () => {
  let db: TestDb;
  let server: TestServer;

  before(async () => {
    db = await openTestDb();
    server = await startServer();
  });
  after(async () => {
    await server.stop();
    await db.close();
  });
  beforeEach(() => resetDb(db));

  it("没开开支的店员读开支列表，回 403 并说清去哪开", async () => {
    const { token, storeId } = await loginAsMember(server, db, { expenses: "none" });
    const res = await api<{ error: string; code: string }>(server, "GET", "/v1/expenses", { token, storeId });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "perm_denied");
    assert.match(res.body.error, /成员权限/);
  });
});
```

注意测试名：**写的是规则和理由，不是「test 1」**。hatch-counter 的测试名像「库连不上就回 503，不是 200 带一句 ok:false——探活的看的是状态码」。测试红了的时候，读测试名就知道违反了什么、为什么重要。

断言 `code` 而不是完整文案，与[第 6 章](06-errors.md)的契约一致：文案会改，code 不会。

## 元测试：用测试守住约定

这是本章最值得带走的技巧。很多规矩不是「某个接口的行为」，而是「所有同类东西都必须满足的条件」，比如「每张带 `store_id` 的表都必须开行级安全」。逐表写测试会漏掉以后新加的表，所以要**扫描全集**：

```ts
it("public 下每张带 store_id 的表都开了行级安全，挂着同一句租户策略", async () => {
  const tables = await db.owner<{ tbl: string; rls: boolean }[]>`
    select c.relname as tbl, c.relrowsecurity as rls
    from pg_class c
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'store_id' and not a.attisdropped
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  `;
  const exempt = ["store_members", "store_version_pending"];

  assert.ok(tables.length > 20, `才找到 ${tables.length} 张表，查询本身多半写错了`);
  for (const t of tables) {
    if (exempt.includes(t.tbl)) continue;
    assert.ok(t.rls, `${t.tbl} 带着 store_id 却没开行级安全：所有门店互相看得见这张表`);
  }
});
```

三个细节让这类测试可靠：

- **对查询结果本身做健全性检查**（`tables.length > 20`）：查询写错返回空数组时，循环一次都不跑，测试照样绿
- **豁免名单要反查**：名单里的表已经不存在了，就报错让人把名单也删掉，免得名单越积越长
- **断言信息写后果**：「所有门店互相看得见这张表」，比「expected true」有用得多

hatch-counter 用同样的思路守住了好几条约定：

| 元测试 | 守住的约定 |
|---|---|
| `rls.test.ts` | 每张租户表都有 RLS 和同一句策略 |
| `live.e2e.test.ts` | 每张租户表都挂了版本号触发器并归到某一块，否则那块永远不刷新 |
| `change-log.e2e.test.ts` | 每张租户表要么记变更流水，要么在豁免名单里 |
| `config.test.ts` | 三条数据库连接指到同一角色时启动失败 |
| `admin.e2e.test.ts` | 租户令牌调不动后台接口，后台令牌调不动业务接口 |
| `client-version.e2e.test.ts` | 版本闸门排在鉴权前面 |

同样的思路可以用在 Nest 层：启动应用后用 `DiscoveryService` 和 `Reflector` 遍历所有控制器方法，断言每个方法要么标了 `@Public()`，要么标了 `@Perm()` 或 `@AnyMember()`，要么在一张明确的「仅店主」名单里。

## 测试长连接

SSE 端点也能用普通的 `fetch` 测：开一条连接，按顺序读事件，设好超时。

```ts
it("有人提交就推，推的是换了版的那几块", async () => {
  const events = await openEvents(server, token, storeId);
  const first = await events.next();
  assert.equal(first.event, "snapshot");

  await api(server, "POST", "/v1/stock/restock", { token, storeId, body: restockBody });

  const changed = await events.next();
  assert.equal(changed.event, "changed");
  assert.ok("stock" in (changed.data as { versions: object }).versions);
  events.close();
});
```

辅助函数里每次读取都要和一个超时 Promise 赛跑（`Promise.race`），否则推送没来时测试会一直挂着，直到整个测试运行器超时，报错信息毫无帮助。

## 跑测试的几条纪律

- **跑测试前停掉开发服务**：hatch-counter 的开发命令是 `tsc --watch`，和 `pretest` 的 `tsc` 抢着写 `dist/`，表现是一次红几十个、再跑一遍全绿，报错里一个字都不提 dev
- **测试要能在开发机上一条命令跑完**：仓库没有 CI 的话，本地跑是唯一的早期反馈
- **一个 bug 一条测试**：修 bug 之前先写一条会红的测试，修完变绿，这条规矩就永远不会再坏

## 本章要点

- 后端测试的首要任务是把「改坏了不报错」的规矩变成会报错的断言，而不是追求覆盖率
- 权限、RLS、触发器这类逻辑在数据库和请求管线里，mock 掉就什么都没验；用真数据库测
- Nest 的 `Test.createTestingModule` + `overrideProvider` 适合测单个 provider；测完整应用时要注意 `main.ts` 里的配置是否也生效
- 测试运行器必须能输出装饰器元数据，否则不能在测试进程里组装 Nest 应用；也可以像 hatch-counter 一样起真进程打编译产物
- 一个测试文件一个数据库（从模板拷），并发数按连接数上限算
- 测试名写规则和理由，断言 code 而不是文案
- **元测试**扫描全集来守约定：对查询结果做健全性检查、豁免名单反查、断言信息写后果

## 接下来读什么

这本书讲的是 NestJS 这一层。往下一层，hatch-counter 的很多关键设计（行级安全、触发器维护的版本号、迁移、事务与隔离级别）都在数据库里，接着读《数据库原理与实战》。往上一层，幂等、缓存、实时推送、多租户这些跨越整个系统的问题，在《软件架构与系统设计》里有完整的讨论。认证和权限只是安全的一部分，《应用安全》会补上 OWASP Top 10、密钥管理和供应链安全，并给出一份可以逐项对照的自查清单。
