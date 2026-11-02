# 配置与环境变量

配置错误有一个讨厌的特点：**它们往往不在启动时暴露，而是在某个用户点到某个功能时才暴露**。短信密钥没配，等第一个人点「发送验证码」才发现；数据库连接指错了角色，所有测试照样绿，直到有人看见了别人的数据。这一章讲怎么让配置在启动时就把能拦的全拦下来，哪些东西不该放进环境变量，以及 `@nestjs/config` 和「自己写一个加载函数」该怎么选。

## 原则：配置在启动时一次性校验

十二要素应用（12-Factor App）的说法是「配置存在环境变量里」。这只说了存哪，没说怎么用。环境变量有三个天然缺陷：

- **全是字符串**：`PORT=3000` 读进来是 `"3000"`，`FLAG=false` 是一个非空字符串，`if (process.env.FLAG)` 为真
- **可以不存在**：`process.env.JWT_SECRET` 的类型是 `string | undefined`，到处写 `!` 断言等于放弃检查
- **散落各处**：每个模块自己读 `process.env.X`，没人知道全应用到底依赖哪些变量

解法是：**一个 schema 定义所有配置，启动时一次性解析，失败就拒绝启动**。之后全应用只读解析好的、有类型的配置对象，没有任何地方再碰 `process.env`。

## hatch-counter 的 loadConfig

hatch-counter 没有用 `@nestjs/config`，而是写了一个 `config.ts`，核心是一个 zod schema 和一个带缓存的加载函数：

```ts
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1),
  APP_DATABASE_URL: z.string().min(1),
  ADMIN_DATABASE_URL: z.string().min(1),

  JWT_SECRET: z.string().min(16, "JWT_SECRET 至少 16 位"),
  ACCESS_TOKEN_TTL: z
    .string()
    .regex(/^\d+[smhd]$/, "形如 15m / 2h / 7d")
    .default("15m")
    .transform((v) => v as `${number}${"s" | "m" | "h" | "d"}`),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  DEV_LATENCY_MS: z.coerce.number().int().min(0).max(10_000).default(0),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const envFile = resolve(process.cwd(), ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`环境变量有问题：\n${lines.join("\n")}\n参照 .env.example 补齐`);
  }
  const cfg = withoutDevKnobs(parsed.data);
  assertRolesSeparated(cfg);
  assertProductionReady(cfg);
  cached = cfg;
  return cached;
}
```

几个要点：

- **`process.loadEnvFile()`**：Node 内置的 `.env` 加载（Node 20.12 / 21.7 起提供），不用再装 dotenv。已经存在的环境变量不会被 `.env` 覆盖，所以容器里注入的值优先
- **`z.coerce.number()`**：把字符串转成数字，转不了就报错
- **模板字面量类型**：jsonwebtoken 的 `expiresIn` 要的是 `"15m"` 这种模板字面量类型，不是任意 `string`，在 schema 里一次转好，用的地方就不用再断言
- **缓存**：多处调用 `loadConfig()` 只解析一次
- **错误一次列全**：启动失败时把所有问题一起列出来，不是修一个、重启、再报下一个

`main.ts`、各模块的 `useFactory`、迁移脚本都调用同一个 `loadConfig()`，所以迁移命令也要过同样的检查。

## 空串当没填

`.env` 里写 `FOO=` 是最自然的「不要这项」的写法，但 zod 的 `.optional()` 只放过 `undefined`，不放过 `""`。更危险的是数字：`Number("")` 是 `0`。

hatch-counter 的 `TRUST_PROXY` 就是这样一个例子：它是 `z.coerce.number()`，留空会被静默读成 `0`，意思是「我明确回答了：直连」，生产环境的必填检查因此一个字都不会说。解法是一个预处理：

```ts
const blankIsUnset = <T extends z.ZodType>(inner: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), inner.optional());

// 使用
TRUST_PROXY: blankIsUnset(z.coerce.number().int().min(0)),
```

所有可选项都套上这一层，空串和没写就是同一个意思。

## 跨字段和按环境的检查

schema 适合检查单个字段。「几个字段之间的关系」和「只在生产才要求的东西」写成单独的断言函数，在 `loadConfig()` 里依次调用。

### 任何环境都查：三个数据库角色必须不同

hatch-counter 用三个数据库角色：表的 owner（跑迁移）、业务连接（受行级安全约束）、后台连接。如果图省事把业务连接也指到 owner 上，**行级安全会被静默绕过**：owner 默认不受 RLS 约束，没有任何错误日志，所有测试照样绿。这是整套多租户里最贵的一种错，所以启动时就拦：

```ts
export function assertRolesSeparated(cfg: Pick<AppConfig, "DATABASE_URL" | "APP_DATABASE_URL" | "ADMIN_DATABASE_URL">): void {
  const user = (url: string) => {
    try {
      return decodeURIComponent(new URL(url).username);
    } catch {
      return "";
    }
  };
  const owner = user(cfg.DATABASE_URL);
  const app = user(cfg.APP_DATABASE_URL);
  const admin = user(cfg.ADMIN_DATABASE_URL);
  const bad: string[] = [];
  if (app && app === owner) bad.push(`APP_DATABASE_URL 用的还是建表角色 ${owner}，RLS 会被绕过`);
  if (admin && admin === owner) bad.push(`ADMIN_DATABASE_URL 用的还是建表角色 ${owner}`);
  if (admin && admin === app) bad.push("ADMIN_DATABASE_URL 跟 APP_DATABASE_URL 同一个角色");
  if (bad.length) throw new Error(`数据库角色没分开：\n  - ${bad.join("\n  - ")}`);
}
```

这道闸本身也有测试守着（`config.test.ts`）。

### 只在生产查：开发用的值不许上线

```ts
export function assertProductionReady(cfg: AppConfig): void {
  if (cfg.NODE_ENV !== "production") return;
  const missing: string[] = [];
  if (cfg.STORAGE_PROVIDER === "local") missing.push("STORAGE_PROVIDER 还是 local（图片落在容器里，重启就没了）");
  if (cfg.JWT_SECRET.startsWith("dev-")) missing.push("JWT_SECRET 还是开发用的那个");
  if (cfg.TRUST_PROXY === undefined) missing.push("TRUST_PROXY 没填——前面有几层反向代理就填几，直连填 0");
  if (missing.length) throw new Error(`生产环境配置不完整：\n  - ${missing.join("\n  - ")}`);
}
```

一个小技巧：`.env.example` 里的开发密钥统一用 `dev-` 开头，生产检查只要判前缀，就能拦住「把开发机的 `.env` 整份拷上线」这种真会发生的事。

### 忽略而不是拦下：只在开发有意义的旋钮

模拟网络延迟 `DEV_LATENCY_MS` 在生产没有任何用途。对它的处理是**忽略**（非开发环境一律归零），而不是拦下：拦下等于拿「服务起不来」去换一个演示用的旋钮。

```ts
export function withoutDevKnobs(cfg: AppConfig): AppConfig {
  return cfg.NODE_ENV === "development" ? cfg : { ...cfg, DEV_LATENCY_MS: 0 };
}
```

归零放在加载时而不是读取处，是因为下一个读它的地方未必记得再判一次环境。

## 一个没有安全默认值的配置：TRUST_PROXY

`TRUST_PROXY` 值得单独讲，因为它展示了「默认值」这件事可以有多危险。

服务端在 nginx 后面时，`req.ip` 默认是 nginx 的地址，要从 `X-Forwarded-For` 里取真实客户端 IP，就得告诉 express 前面有几层代理（`app.set("trust proxy", n)`）。

| 填的值 | 实际有 1 层 nginx 时的后果 |
|---|---|
| 0 或不信任 | `req.ip` 全是 nginx 的地址，按 IP 限流变成全站共用一个额度，随便谁扫一轮就能让所有人发不出验证码 |
| 1（照实） | 正确 |
| 2（多填） | 信任了客户端自己写进 `X-Forwarded-For` 的那一段，按 IP 限流等于不存在 |

两个方向都会出事，它**没有一个两边都安全的默认值**。所以 hatch-counter 的选择是：生产环境不填就拒绝启动。原来是启动时打一条 warn，但这条 warn 夹在一屏路由日志中间，没人会看见。注释里还提醒：它是跳数不是开关，nginx 前面再挂一层负载均衡就得填 2。

## 哪些配置不该放环境变量

hatch-counter 把配置分成三层：

| 层 | 放在哪 | 例子 | 谁改 |
|---|---|---|---|
| 部署配置 | 环境变量 | 数据库连接、JWT 密钥、端口、存储类型 | 部署的人，改了要重启 |
| 租户配置 | 业务库，跟着门店走 | 营业时段边界 | 店主在界面上改 |
| 平台运营配置 | 后台专用 schema | 识别服务商的降级链和密钥、短信通道 | 超管在后台改，不用重启 |

关键决定是：**第三层一样都不在环境变量里，也不留环境变量兜底**。文档的理由是，两个地方能配同一样东西，「现在到底在用谁」就得靠人去比对；而兜底的那份往往只有一家、没有降级可言，恰恰在最该看清楚的时候最不透明。这几份配置在内存里缓存十秒，修改时主动清缓存。

判断一项配置该放哪，可以问三个问题：改它需要重启吗？谁有资格改？它会频繁变吗？需要运营人员随时调整的东西，放环境变量只会逼你每次都上服务器改文件、重启进程。

## 密钥管理的底线

- `.env` 不进仓库，仓库里放 `.env.example`，列出所有变量和开发用的假值
- 生产的密钥只在服务器上（如 systemd 的 `EnvironmentFile`、Docker Compose 的 `env_file`），文件权限收紧到只有服务账号能读
- **发给客户端的密钥等于公开的密钥**：第三方服务的密钥只放服务端，客户端只能问「这个功能能不能用」，hatch-counter 的识别状态接口只回 `{ ready, tableScan }`，不回服务商、不回模型名
- 日志、审计、错误原因里不许出现密钥：它们会被复制进聊天记录、跟着日志归档。审计只记「改没改」，不记新值
- 健康检查等公开端点的错误详情只进日志，连接串常常整条躺在异常消息里

## 用 @nestjs/config 的写法

如果你更喜欢依赖注入风格，`@nestjs/config` 是官方方案。它的 `ConfigModule.forRoot()` 支持一个 `validate` 函数，可以直接接上同一个 zod schema：

```ts
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (env) => {
        const cfg = schema.parse(env); // 失败抛错，应用起不来
        assertProductionReady(cfg);
        return cfg;
      },
    }),
  ],
})
export class AppModule {}

@Injectable()
export class SomeService {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  get port(): number {
    return this.config.get("PORT", { infer: true });
  }
}
```

NestJS 12 的 `@nestjs/config` 改为通过 Standard Schema 校验，`validationSchema` 可以直接传 zod 等库的 schema；继续用 Joi 的需要 Joi 18 以上，并把 Joi 专有的选项移到 `validationOptions.libraryOptions` 下。具体以官方迁移指南为准。

两种方式对比：

| | 自己的 `loadConfig()` | `@nestjs/config` |
|---|---|---|
| 在 Nest 容器外可用（迁移脚本、测试辅助） | 直接调用 | 要另想办法 |
| 测试里替换配置 | 改环境变量或子进程传 env | `overrideProvider(ConfigService)` |
| 依赖 | 只有 zod | 多一个包 |
| 类型 | `z.infer` 直接得到 | 要给 `ConfigService` 传泛型 |

hatch-counter 选前者，主要是因为迁移脚本、测试辅助、Nest 应用都要读同一份配置，一个普通函数最简单。它的 e2e 测试起的是真进程，要换配置就给子进程传不同的环境变量（见[第 9 章](09-testing.md)）。

## 本章要点

- 所有配置用一个 schema 定义，启动时一次性解析，失败就拒绝启动，并把问题一次列全
- 应用里只读解析好的配置对象，不再到处碰 `process.env`
- 空串当没填，否则 `Number("")` 会把「没填」静默变成 0
- 跨字段检查和生产专属检查写成断言函数：角色必须分开、开发密钥不许上线
- 没有安全默认值的配置（如代理跳数），生产必须显式填写，warn 没人看
- 运营人员要随时改的配置放数据库，不放环境变量，也不留环境变量兜底
- 发给客户端的密钥等于公开；日志、审计、公开端点里不出现密钥
- `@nestjs/config` 和自写加载函数都可以，关键是校验与 fail-fast，而不是选哪个库
