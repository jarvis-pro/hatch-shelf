# 认证、限流与配额的接口约定

认证方案怎么选（Session 还是 JWT、要不要上 Passkey）、令牌怎么轮换，是安全问题，[《应用安全》的认证一章](../app-security/01-authentication.md)和[《NestJS 后端架构》的 JWT 一章](../nestjs-backend/05-jwt-permissions.md)已经讲过。限流在网关上怎么配，见[《Nginx 与网关》的限流一章](../nginx-gateway/05-rate-limit.md)。这一章只讲它们在**接口上**的样子：凭证放在请求的哪里，给第三方用的 API key 怎么设计，被限流、配额用完时回什么、客户端怎么配合。

## 凭证放在哪

| 位置 | 例子 | 用在 |
|---|---|---|
| `Authorization` 头 | `Authorization: Bearer eyJhbGci...` | App、第三方服务端调用；默认选择 |
| Cookie | `Cookie: sid=...`（`HttpOnly; Secure; SameSite=Lax`） | 同站点的网页端 |
| 查询参数 | `?token=...` | **尽量不用** |

查询参数放凭证的问题在于 URL 会出现在太多地方：nginx 访问日志、浏览器历史、`Referer` 头、错误监控的面包屑。一个令牌写进 URL，就等于写进了所有这些地方。

唯一常见的例外是**预签名的下载链接**：导出文件、图片，需要能直接放进 `<img src>` 或交给系统下载器，没法加请求头。这类链接里的签名要满足：只对这一个资源有效、几分钟内过期、只能读。它是一张一次性的门票，不是用户的令牌。

网页端用 Cookie 还是 Bearer 令牌，涉及 CSRF 和 XSS 之间的取舍，这里不展开。从接口约定的角度，要做的是**同一个接口两种凭证都认**，服务端在一个守卫里统一解析成同一个「当前调用方」对象，后面的代码不关心凭证从哪来。

## 三类调用方，三种凭证

| 调用方 | 凭证 | 有效期 | 代表谁 |
|---|---|---|---|
| 自己的 App、网页端 | 用户登录后拿到的访问令牌 + 刷新令牌 | 访问令牌分钟级，刷新令牌数周 | 某个用户，在某家门店 |
| 第三方的服务端（集成你的系统） | API key | 长期，直到撤销 | 某家门店（或某个账号），而不是某个人 |
| 第三方的应用替用户操作 | OAuth 2.0 授权得到的令牌 | 同用户令牌 | 某个用户，授权给某个应用，限定范围 |

一人公司起步时只有第一类。当门店说「我们的收银系统想把每天的流水自动推给你」，就需要第二类。第三类（让别人的应用「用 hatch-counter 账号登录」并代用户操作）通常很久以后才需要，而且实现成本高，到时候用成熟的 OAuth 服务端库，不要自己写。

## API key 的设计

API key 看起来就是一个随机字符串，但有几处细节决定了它好不好用、出事时好不好处理。

### 格式：带前缀

```text
hck_live_3vQb8Kx2mN7pR4tW9yZ1aB5cD6eF0gH2
hck_test_8pL2kJ4hG6fD8sA0qW3eR5tY7uI9oP1z
```

- `hck_` 是产品前缀：用户在一堆配置里一眼认出这是哪家的 key
- `live_` / `test_` 区分环境：测试 key 只能操作测试数据，拿错了不会动到真账
- 带前缀的 key 能被 GitHub 等平台的密钥扫描识别。key 被误提交到公开仓库时，平台可以通知你（需要向平台登记前缀格式），这比用户自己发现要早得多

### 存储：只存哈希

API key 和密码一样，**数据库里只存哈希**，明文只在创建时展示一次。和密码不同的是，API key 本身是高熵的随机串，不需要 bcrypt 这类慢哈希，SHA-256 就够了，而且验证要快，因为每个请求都要验。

```typescript
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const sha256 = (s: string) => createHash("sha256").update(s).digest();

export function generateApiKey(env: "live" | "test") {
  const secret = randomBytes(24).toString("base64url"); // 192 位熵
  const key = `hck_${env}_${secret}`;
  return {
    key,                              // 只返回给用户这一次
    prefix: key.slice(0, 16),         // 存明文前缀，列表里显示「hck_live_3vQb8Kx…」让用户认
    hash: sha256(key),                // 存哈希
  };
}

export async function verifyApiKey(repo: ApiKeyRepo, presented: string) {
  const row = await repo.findByPrefix(presented.slice(0, 16));
  if (!row || row.revokedAt) return null;
  const ok = timingSafeEqual(sha256(presented), row.hash);
  if (!ok) return null;
  void repo.touchLastUsed(row.id); // 记最后使用时间，不阻塞请求
  return row;
}
```

数据表里除了哈希，还要有：

| 字段 | 用途 |
|---|---|
| `name` | 用户起的名字：「收银系统」「财务导出脚本」，撤销时知道是哪个 |
| `prefix` | 列表里展示 |
| `scopes` | 权限范围 |
| `created_at` / `last_used_at` | 长期不用的 key 提醒用户清理 |
| `revoked_at` | 撤销 |

### 允许同时有多个 key

**一个账号要能同时有多个有效的 key**。这不是为了方便，而是为了轮换：要换 key 时，先建一个新的，把调用方切过去，确认旧的 `last_used_at` 不再更新，再撤销旧的。只允许一个 key 的系统，换 key 那一刻必然有一段服务中断。

### 权限范围

API key 默认不应该拥有账号的全部权限。给它一组 scope：

```text
expenses:read  expenses:write  products:read  reports:read
```

收银系统只需要 `expenses:write`，那就只给它这个。key 泄露时，损失被限制在这个范围内。scope 不够时回 403，Problem Details 里说清缺哪个：

```json
{
  "type": "https://api.hatch-counter.example/problems/insufficient-scope",
  "title": "API key 权限不够",
  "status": 403,
  "detail": "这个 key 没有 products:write 权限。在「设置 → API key」里给它加上，或者换一个有权限的 key。",
  "code": "insufficient_scope",
  "requiredScope": "products:write"
}
```

## 401 和 403

接口约定里最容易混的两个状态码，再强调一次：

| 状态码 | 含义 | 客户端处置 |
|---|---|---|
| 401 | 没带凭证，或凭证无效、过期 | 续期，续不上去登录 |
| 403 | 凭证有效，但这个身份不允许做这件事 | 展示原因，重新登录没用 |

401 的回包按 HTTP 规范应该带 `WWW-Authenticate` 头说明认证方式，比如 `WWW-Authenticate: Bearer`；令牌过期时可以带上 `error="invalid_token"`。自己的客户端不一定读它，但第三方的 HTTP 库可能会。

把 403 回成 401 会让客户端陷入「续期—重试—又 401」的循环，见[《NestJS 后端架构》的错误处理一章](../nestjs-backend/06-errors.md#401-和-403-不能混)。

## 限流

### 两层限流

| 层 | 按什么限 | 挡什么 | 在哪配 |
|---|---|---|---|
| 网关 | IP | 扫描、暴力破解、单个来源的洪水 | nginx `limit_req` |
| 应用 | 账号 / API key | 某个调用方的脚本写错了死循环、某家门店用量异常 | 应用代码 |

只靠网关按 IP 限流不够：一家大门店的十台收银机可能在同一个 NAT 后面，共享一个 IP；而一个第三方集成的服务端可能从很多 IP 发出请求。**按调用方身份的限流必须在应用层做**，因为只有应用知道这个请求属于谁。

### 令牌桶

应用层限流最常用的算法是令牌桶：每个调用方一个桶，容量 `burst`，每秒补充 `rate` 个令牌，每个请求消耗一个，桶空了就拒绝。它允许短时间的突发（桶里攒着的令牌），又限制了长期的平均速率。

单实例部署时，桶放在进程内存里就够了：

```typescript
type Bucket = { tokens: number; updatedAt: number };

export class TokenBucketLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(private rate: number, private burst: number) {}

  /** 返回 0 表示放行；否则返回建议等待的秒数 */
  take(id: string, now = Date.now()): number {
    const b = this.buckets.get(id) ?? { tokens: this.burst, updatedAt: now };
    const elapsed = (now - b.updatedAt) / 1000;
    b.tokens = Math.min(this.burst, b.tokens + elapsed * this.rate);
    b.updatedAt = now;
    this.buckets.set(id, b);

    if (b.tokens >= 1) {
      b.tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - b.tokens) / this.rate);
  }
}
```

```typescript
@Injectable()
export class RateLimitGuard implements CanActivate {
  private limiter = new TokenBucketLimiter(5, 20); // 每秒 5 个，最多攒 20 个

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();
    const wait = this.limiter.take(req.caller.id); // 守卫链里认证之后才执行
    if (wait > 0) {
      res.setHeader("Retry-After", String(wait));
      throw new ApiProblem("rate_limited", `操作太频繁了，${wait} 秒后再试`);
    }
    return true;
  }
}
```

这个实现有两个已知的局限，单实例够用时不必提前解决：多实例部署时每个实例各算各的（换成 Redis，或者用 Postgres 的一行计数），以及 `Map` 不会清理不活跃的桶（定期扫掉一段时间没更新的）。

### 回包约定

被限流时：

- 状态码 **429 Too Many Requests**
- `Retry-After` 头：多少秒后可以再试。这是 HTTP 标准头，客户端和各种 HTTP 库都可能认识
- Problem Details，`code: "rate_limited"`

> [!WARNING]
> `RateLimit` / `RateLimit-Policy` 响应头目前是 IETF 草案（draft-ietf-httpapi-ratelimit-headers），各版草案的字段格式变化较大，常见的 `X-RateLimit-*` 也只是事实惯例。本节按凭记忆的草案内容概括，以 IETF 最新草案为准。

除了被拒时告诉调用方，还可以在**每个成功的回包**上告诉调用方剩余额度，让行为良好的客户端主动放慢。历史上大家各用各的 `X-RateLimit-Limit`、`X-RateLimit-Remaining`、`X-RateLimit-Reset`；IETF 正在把它标准化为 `RateLimit-Policy`（描述策略）和 `RateLimit`（当前剩余）两个头。对一人公司来说，被拒时给出 `Retry-After` 就已经覆盖了大部分价值，每个回包都带额度信息是锦上添花，等第三方真的需要时再加。

### 客户端要遵守 Retry-After

自己的客户端收到 429，要按 `Retry-After` 等待后再重试，而且**只重试一次左右**，不要立刻重试，更不要在多个层次都重试（为什么见[《软件架构与系统设计》的重试一节](../system-design/06-idempotency-consistency.md#重试)）。对外文档里也要把这条写清楚，因为第三方最常见的错误就是收到 429 立刻重试，把自己永远锁在限流状态里。

## 配额

限流管的是「速率」：每秒不能太多。**配额**管的是「总量」：每个月能用多少。比如单据识别要调第三方的大模型，每次都有成本，hatch-counter 可以给每家门店每月一个识别次数上限，套餐越高上限越高。

两者在接口上要区分开，因为客户端的处置完全不同：

| | 限流 | 配额用完 |
|---|---|---|
| 原因 | 短时间内太快 | 本周期的总量用完了 |
| 等一会儿能好吗 | 能，几秒到几分钟 | 不能，要等到下个周期或升级套餐 |
| 状态码 | 429 | 429（或 403） |
| 错误码 | `rate_limited` | `quota_exceeded` |
| `Retry-After` | 几秒 | 不给，或给到周期重置的时间 |
| 客户端处置 | 静默等待后重试 | 不重试，告诉用户额度用完了、什么时候恢复、怎么升级 |

状态码用 429 还是 403 各家做法不一。用 429 的理由是「请求太多了」本质上是同一类；用 403 的理由是「等一会儿也没用」。关键不在状态码，而在**错误码一定要分开**，否则客户端会把配额用完当成限流，在后台不停地重试一个注定失败的请求。

```json
{
  "type": "https://api.hatch-counter.example/problems/quota-exceeded",
  "title": "本月额度已用完",
  "status": 429,
  "detail": "这个月的单据识别次数（200 次）已经用完了，12 月 1 日恢复。急用的话可以在「设置 → 套餐」里升级。",
  "code": "quota_exceeded",
  "quota": { "limit": 200, "used": 200, "resetsAt": "2026-12-01T00:00:00+08:00" }
}
```

另外提供一个查询当前用量的接口，让客户端在用户点「识别」之前就能显示「本月还剩 12 次」，而不是等用完了才告诉他：

```http
GET /usage

{
  "period": { "start": "2026-11-01", "end": "2026-11-30" },
  "items": [
    { "metric": "receipt_ocr", "limit": 200, "used": 188 },
    { "metric": "export", "limit": null, "used": 3 }
  ]
}
```

`limit: null` 表示不限。配额计数要和业务操作在同一个事务里扣减（或者在操作成功后扣减），失败的操作不应该消耗配额，否则用户会因为你的服务出错而损失额度。

## 本章要点

- 凭证放 `Authorization` 头或 Cookie，不放查询参数；预签名下载链接是唯一常见例外，且要短时效、单资源、只读
- 同一个接口认多种凭证，守卫里统一解析成「当前调用方」
- 第三方服务端调用用 API key：带产品和环境前缀，只存哈希、只展示一次，允许多个并存以便轮换，配上 scope
- 401 是凭证问题，403 是权限问题，客户端处置不同
- 网关按 IP 限流，应用按调用方身份限流；单实例用内存令牌桶就够
- 被限流回 429 + `Retry-After` + `rate_limited`，客户端按它等待，只在一层重试
- 配额和限流用不同的错误码，配额用完不要让客户端重试；提供用量查询接口；失败的操作不扣配额

## 动手练习

1. **预测令牌桶的放行数**：把本章的 `TokenBucketLimiter`（rate 5、burst 20）拷进 `bucket.ts`，用固定的 `now` 调用：先在 `now = 0` 连续 `take("a", 0)` 25 次，再在 `now = 1000` 连续调用 10 次。先写下预测，再用 `npx tsx bucket.ts` 跑。

   验证：第一轮前 20 次返回 `0`，后 5 次返回 `1`；第二轮前 5 次返回 `0`，后 5 次返回 `1`。

   参考答案：桶满时有 20 个令牌可以一次花掉（突发），被拒的请求不扣令牌；过了 1 秒按 rate 补回 5 个，所以长期平均速率是每秒 5 个。

2. **生成并验证 API key**：用本章的 `generateApiKey` 和 `verifyApiKey`，以一个 `Map` 充当 `repo`（按 `prefix` 存行）。生成一个 key，分别验证原 key、改掉最后一个字符的 key、改掉前缀里一个字符的 key。

   验证：只有原 key 返回行，另外两个返回 `null`；打印 `key.length` 和 `prefix`，能看到 `prefix` 是 `hck_live_` 加上 7 个随机字符。

   参考答案：前缀用于定位行和在列表里给人认，哈希比对才是验证；SHA-256 输出定长 32 字节，`timingSafeEqual` 不会因为长度不同抛错。数据库泄露时只有哈希，无法还原出能用的 key。

3. **给错误分类**：判断以下情况回什么状态码和错误码：① 令牌签名对、已过期；② API key 只有 `expenses:read`，调了 `POST /expenses`；③ 一个 key 一秒内发了 50 个请求；④ 门店本月识别 200 次已用完；⑤ 请求里没有 `Authorization` 头。

   验证：对照[401 和 403](#401-和-403)、[配额](#配额)两节自查，特别是客户端拿到后会不会进入「续期—重试」循环。

   参考答案：① 401 `token_invalid`；② 403 `insufficient_scope`，带 `requiredScope`；③ 429 `rate_limited` + `Retry-After`；④ 429 或 403 `quota_exceeded`，不给几秒级的 `Retry-After`；⑤ 401，带 `WWW-Authenticate: Bearer`。
