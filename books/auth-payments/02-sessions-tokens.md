# 密码、Session 与令牌的实现

Session 和 JWT 怎么选、双令牌为什么要轮换、刷新令牌放在哪，[《应用安全》第 1 章](../app-security/01-authentication.md)和[《NestJS 后端架构》第 5 章](../nestjs-backend/05-jwt-permissions.md)已经讲过，密码哈希的参数见[《应用安全》第 4 章](../app-security/04-passwords-secrets.md)。这一章不再重复这些结论，只讲把它们落成代码时会撞上的事：并发续期把人踢下线、密码登录泄露了「这个号注册过没有」、找回密码链接被用两次、「退出所有设备」到底退出了什么。

## 一套服务，三种客户端

先把全局定下来。hatch-counter 的同一个 API 服务要接网页端、移动端和管理后台：

| 客户端 | 首次登录 | 访问令牌 | 刷新令牌 | 令牌的 `aud` |
|---|---|---|---|---|
| 网页端 | 短信验证码、扫码 | 页面内存 | httpOnly cookie，`Path=/v1/auth` | `tenant` |
| 移动端 | 短信验证码 | 内存 | 系统安全存储 | `tenant` |
| 管理后台 | 用户名 + 密码 + TOTP | 页面内存 | httpOnly cookie，`Path=/v1/admin/auth` | `admin` |

这张表里有两条不显眼的设计：

- **两个 cookie 名字和 Path 都不同**。同一个浏览器里网页端和后台都登着，两张刷新票互不覆盖，各自的续期接口也看不见另一张
- **轮换、重放判定、按设备作废这些规则不关心票装在哪**。cookie 也好、请求体也好，进了服务端都交给同一个 `TokensService`。写代码时把「从哪读票」和「怎么处理票」分开，否则网页端和移动端会各长出一套规则

## 密码登录

hatch-counter 只有后台用密码。面向用户的密码登录要多处理两件事：不让人探出谁注册过，以及在调高哈希参数之后让老用户平滑升级。

### 不泄露账号是否存在

错误提示统一成「手机号或密码不对」只解决了一半。另一半在**响应时间**：账号不存在时直接返回，账号存在时要跑一次几百毫秒的慢哈希，攻击者用秒表就能分辨。所以账号不存在时也要跑一次哈希：

```typescript
// 启动时算一次，参数和真实哈希一样
const DUMMY_HASH = await hashPassword(randomBytes(16).toString("hex"));

export async function passwordLogin(db: Db, phone: string, password: string, ctx: LoginCtx) {
  await assertLoginAllowed(db, phone, ctx.ip); // 限流，见下一节

  const row = await findPasswordByPhone(db, phone); // { accountId, hash } | undefined
  const ok = await verifyPassword(password, row?.hash ?? DUMMY_HASH);

  if (!row || !ok) {
    await recordLoginFailure(db, phone, ctx.ip);
    throw new AuthError("手机号或密码不对", "bad_credentials");
  }

  if (needsRehash(row.hash)) {
    // 参数调高之后，老用户在下一次登录成功时顺手升级，不需要一次性迁移
    await db.execute(sql`
      UPDATE credentials SET secret = ${await hashPassword(password)}, updated_at = now()
      WHERE account_id = ${row.accountId} AND kind = 'password'`);
  }
  return row.accountId;
}

function needsRehash(stored: string): boolean {
  const [algo, n] = stored.split("$");
  return algo !== "scrypt" || Number(n) < CURRENT_N;
}
```

注册接口有同样的问题：「这个手机号已注册」本身就是泄露。对手机号登录的产品，最干净的做法是**不分注册和登录**：只有一个「获取验证码」，验证通过后由第 1 章的 `resolveIdentity` 决定是登录还是新建。这也是国内产品普遍采用验证码登录的原因之一。

### 限流用库里的计数，不用内存

慢哈希让每次密码验证都很贵，登录接口不限流就是一个让人免费消耗你 CPU 的入口。限流至少两道：按账号（防针对一个人猜密码）、按 IP（防拿一个密码撞很多账号）。

hatch-counter 的验证码、扫码登录的限流都是**查库数行**，不是内存计数器。理由写在代码注释里：多实例部署下，内存计数器等于没限。一人公司虽然通常只有一个实例，但零停机发布时新旧两个进程会同时在线，重启也会清零计数，查库更可靠：

```sql
CREATE TABLE login_failures (
  id          bigserial PRIMARY KEY,
  subject     text NOT NULL,           -- 规范化后的手机号或用户名
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON login_failures (subject, created_at);
CREATE INDEX ON login_failures (ip, created_at);
```

```typescript
const WINDOW = "15 minutes";
const PER_SUBJECT = 5;
const PER_IP = 50;

async function assertLoginAllowed(db: Db, subject: string, ip: string) {
  const [r] = await db.execute<{ by_subject: number; by_ip: number }>(sql`
    SELECT
      count(*) FILTER (WHERE subject = ${subject})::int AS by_subject,
      count(*) FILTER (WHERE ip = ${ip})::int          AS by_ip
    FROM login_failures
    WHERE created_at > now() - ${WINDOW}::interval
      AND (subject = ${subject} OR ip = ${ip})`);
  if (r.by_subject >= PER_SUBJECT || r.by_ip >= PER_IP) {
    throw new RateLimitError("试错次数太多，15 分钟后再试");
  }
}
```

两个细节：

- **按账号限流不要做成永久锁定**。「错 5 次锁账号直到联系客服」会变成一个攻击手段：知道你手机号的人随时可以把你锁在门外。滚动窗口到点自动解开就够了
- **成功登录不必清空失败记录**。清空的话，攻击者每猜 4 次就用自己的账号登一次，按 IP 的限额就被绕过了。让记录自然过期，定时任务删掉一天前的行

用 Redis 做这类计数会更省数据库，Redis 版本的滑动窗口在同批的另一本书里会讲。表的量级不大时，Postgres 完全够用。

## 找回密码

找回密码是另一条「首次证明身份」的路，安全性不能比登录低：

```sql
CREATE TABLE password_resets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

规则：

1. **申请时无论账号存不存在，都回同一句**「如果这个邮箱注册过，你会收到一封邮件」
2. **令牌 32 字节随机数，库里只存哈希，30 分钟过期**
3. **只能用一次**，用条件更新保证，并发点两次链接只有一次生效
4. **用掉之后作废这个账号所有设备的会话**，包括发起找回的这台以外的全部
5. **新申请让旧的未用令牌失效**，邮箱里同时躺着几条有效链接没有好处

```typescript
export async function resetPassword(db: Db, token: string, newPassword: string) {
  const hash = sha256(token);
  await db.transaction(async (tx) => {
    const [row] = await tx.execute<{ account_id: string }>(sql`
      UPDATE password_resets SET used_at = now()
      WHERE token_hash = ${hash} AND used_at IS NULL AND expires_at > now()
      RETURNING account_id`);
    if (!row) throw new AppError("链接已失效，请重新申请", 410);

    await tx.execute(sql`
      INSERT INTO credentials (account_id, kind, secret) VALUES (${row.account_id}, 'password', ${await hashPassword(newPassword)})
      ON CONFLICT (account_id, kind) DO UPDATE SET secret = EXCLUDED.secret, updated_at = now()`);
    await revokeAllDevices(tx, row.account_id);
  });
}
```

`UPDATE ... WHERE used_at IS NULL ... RETURNING` 是本书会反复出现的写法：**用一条条件更新同时完成「检查」和「占用」**。先 `SELECT` 判断再 `UPDATE`，两个并发请求会都通过检查。

## 设备是会话的主人

hatch-counter 的会话不挂在账号上，挂在**设备**上：设备 ID 由客户端生成并长期保存，同一台机器重新登录落回同一行；刷新票挂在设备下面；「我的账号 → 登录设备」列的就是这张表；踢下线是作废那一台的票。

为什么要多这一层，而不是直接让刷新票挂账号？

- **踢人按台算**。店主在手机上点退出，不该把收银电脑一起踢下线
- **重放检测按台算**。发现某台设备的票被复制，作废这一台的全部票，其他设备不受牵连
- **设备上能挂信息**：平台、App 版本、浏览器、最后活跃时间。后台的「各版本铺开情况」就是数这张表算出来的

登录成功时 upsert 设备：

```typescript
async function touchDevice(tx: Tx, accountId: string, d: DeviceInput) {
  // 同一个设备 ID 换了账号登录（店里一台电脑先后给两个人用）：设备行跟着换主人，旧主人的票作废
  await tx.execute(sql`
    INSERT INTO devices (id, account_id, platform, name, app_version, last_seen_at)
    VALUES (${d.id}, ${accountId}, ${d.platform}, ${d.name}, ${d.appVersion}, now())
    ON CONFLICT (id) DO UPDATE SET
      account_id = EXCLUDED.account_id,
      name = EXCLUDED.name,
      app_version = EXCLUDED.app_version,
      last_seen_at = now(),
      revoked_at = NULL`);
  await tx.execute(sql`
    UPDATE refresh_tokens SET revoked_at = now()
    WHERE device_id = ${d.id} AND account_id <> ${accountId} AND revoked_at IS NULL`);
}
```

设备 ID 来自客户端，所以**不能信它做任何授权判断**，它只是一个分组键。恶意客户端伪造别人的设备 ID 能做到的，最多是让自己的票挂到那一行上（`ON CONFLICT` 会把那一行改成自己的账号，并作废原主人的票）。如果这对你的产品是个问题，设备 ID 改成服务端在首次登录时生成、下发给客户端保存即可。

## 刷新：并发是最常见的误伤

轮换和重放检测的规则见前面提到的两章。实现时最常撞上的问题不是攻击，是**自己的客户端并发续期**：

- 网页端开了三个标签页，访问令牌同时过期，三个标签页同时拿同一张刷新票去续
- 移动端启动时五个请求同时 401，各自触发一次续期

按严格规则，第一个续期成功、旧票标为已用；第二个拿着已用的旧票来，被判为重放，整台设备下线。用户看到的是：开了几个标签页，莫名其妙被踢了。

要在两头同时处理。

### 客户端：一次只续一个

同一个页面里，用一个共享的 Promise 把并发续期合成一次：

```typescript
let refreshing: Promise<string> | null = null;

async function getFreshAccessToken(): Promise<string> {
  // 已经有一个续期在路上，就等它，不另发
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const send = (token: string) =>
    fetch(input, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });

  let res = await send(accessToken);
  if (res.status === 401 && (await res.clone().json()).code === "token_expired") {
    accessToken = await getFreshAccessToken();
    res = await send(accessToken); // 只重放一次，再 401 就交给登录页
  }
  return res;
}
```

多个标签页之间，共享 Promise 管不到。浏览器提供了 Web Locks API，可以把续期包在一把跨标签页的锁里，拿到锁之后先看看别的标签页是不是刚续过：

```typescript
async function doRefresh(): Promise<string> {
  return navigator.locks.request("auth-refresh", async () => {
    // 别的标签页刚续过，会把新的访问令牌广播出来（BroadcastChannel），这里直接用
    const shared = latestTokenFromOtherTabs();
    if (shared && !isExpiringSoon(shared)) return shared;

    const res = await fetch("/v1/auth/refresh", { method: "POST", credentials: "include" });
    if (!res.ok) throw new SessionEndedError();
    const { accessToken } = await res.json();
    broadcastToken(accessToken);
    return accessToken;
  });
}
```

### 服务端：给并发留一个很窄的窗口

客户端做了合并，服务端仍然要能容忍偶发的并发（老版本客户端、网络重发）。做法是**旧票在被轮换后的极短时间内再来，不判重放，而是返回它刚刚派生出的那张新票的「兄弟」**。

```sql
-- 轮换：用条件更新占住旧票，只有一个请求能成功
UPDATE refresh_tokens SET used_at = now()
WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
RETURNING id, account_id, device_id;
```

```typescript
const CONCURRENT_GRACE_MS = 10_000;

export async function rotate(db: Db, presented: string): Promise<TokenPair> {
  return db.transaction(async (tx) => {
    const hash = sha256(presented);
    const [won] = await tx.execute<TokenRow>(sql`
      UPDATE refresh_tokens SET used_at = now()
      WHERE token_hash = ${hash} AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
      RETURNING id, account_id, device_id`);
    if (won) return issueChild(tx, won);

    // 没抢到：看看是不是「刚刚」被用掉的
    const [old] = await tx.execute<TokenRow & { used_at: Date }>(sql`
      SELECT id, account_id, device_id, used_at FROM refresh_tokens WHERE token_hash = ${hash}`);
    if (!old || !old.used_at) throw new AuthError("登录已失效", "refresh_invalid");

    if (Date.now() - old.used_at.getTime() < CONCURRENT_GRACE_MS) {
      return issueChild(tx, old); // 同一台设备上的并发续期，再派生一张
    }

    // 超出窗口：按重放处理（hatch-counter 在这里还有「回包丢失」的 24 小时宽限，规则见上文链接）
    await revokeDevice(tx, old.device_id);
    throw new AuthError("登录状态异常，请重新登录", "refresh_reused");
  });
}
```

窗口要窄，十秒足以覆盖并发，又让窃取者几乎不可能刚好卡进去。hatch-counter 的 24 小时宽限解决的是另一个问题（续期回包丢在路上），它的约束更严：只有旧票底下那张新票**从没被用过**才放行，放行的同时作废那张没人收到的新票。两种宽限可以并存，判断顺序是先看并发窗口，再看回包丢失。

## 守卫每个请求查一次设备

访问令牌是 JWT，验签不用查库。但 hatch-counter 的守卫在验签之后还会查一下这台设备有没有被撤销：

```typescript
const claims = await this.tokens.verifyAccess(token); // 验签名、过期、aud
const [dev] = await db.execute(sql`
  SELECT revoked_at FROM devices WHERE id = ${claims.did} AND account_id = ${claims.sub}`);
if (!dev || dev.revoked_at) throw new AuthError("这台设备已退出登录", "device_revoked");
```

一次按主键的查询，换来「踢下线立即生效」，而不是等访问令牌自然过期的十五分钟。对要支持「店员离职立刻踢」的产品，这次查询是值的。如果真的要省，可以把撤销的设备 ID 放进一个短期缓存，但先量一下这次查询到底占了多少，通常它远不是瓶颈。

## 退出的三种粒度

| 动作 | 做什么 | 什么时候用 |
|---|---|---|
| 退出当前设备 | 作废这台设备的刷新票，标记设备 `revoked_at`，清 cookie | 用户点「退出登录」 |
| 踢掉某台设备 | 同上，作用于指定设备 | 「登录设备」列表里点某一台 |
| 退出所有其他设备 | 除当前设备外全部作废 | 改密码、换手机号、解绑身份、找回密码之后自动执行 |

```typescript
export async function revokeDevice(tx: Tx, deviceId: string) {
  await tx.execute(sql`UPDATE devices SET revoked_at = now() WHERE id = ${deviceId} AND revoked_at IS NULL`);
  await tx.execute(sql`UPDATE refresh_tokens SET revoked_at = now() WHERE device_id = ${deviceId} AND revoked_at IS NULL`);
}

export async function revokeAllDevices(tx: Tx, accountId: string, except?: string) {
  await tx.execute(sql`
    UPDATE devices SET revoked_at = now()
    WHERE account_id = ${accountId} AND revoked_at IS NULL
      AND (${except ?? null}::uuid IS NULL OR id <> ${except ?? null}::uuid)`);
  await tx.execute(sql`
    UPDATE refresh_tokens t SET revoked_at = now()
    FROM devices d
    WHERE t.device_id = d.id AND d.account_id = ${accountId} AND d.revoked_at IS NOT NULL
      AND t.revoked_at IS NULL`);
}
```

退出接口本身要做到**幂等且总是成功**：票已经无效、已经过期、根本没带，都回 204 并清 cookie。退出失败而让用户卡在「退不出去」的状态，比多做一次无用的更新糟糕得多。

## 敏感操作再验一次

登录状态能维持三十天，但不是三十天里所有操作都该凭这张票就能做。换手机号、注销账号、修改收款信息、查看完整的 API 密钥，这些动作应该要求用户**最近**证明过一次身份。

做法是在设备上记一个「最近一次强验证的时间」，敏感接口检查它：

```sql
ALTER TABLE devices ADD COLUMN reauth_at timestamptz;
```

```typescript
import { applyDecorators, SetMetadata, UseGuards } from "@nestjs/common";

export const RECENT_AUTH = "recentAuth";
export const RequireRecentAuth = (maxAgeSec = 300) =>
  applyDecorators(SetMetadata(RECENT_AUTH, maxAgeSec), UseGuards(RecentAuthGuard));

@Injectable()
export class RecentAuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private db: DbService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const maxAge = this.reflector.get<number>(RECENT_AUTH, ctx.getHandler());
    const req = ctx.switchToHttp().getRequest();
    const [d] = await this.db.execute<{ reauth_at: Date | null }>(sql`
      SELECT reauth_at FROM devices WHERE id = ${req.auth.deviceId}`);
    if (d?.reauth_at && Date.now() - d.reauth_at.getTime() < maxAge * 1000) return true;
    // 前端认这个错误码，弹出「为了安全，请再验证一次」，验证通过后重试原请求
    throw new AuthError("请再验证一次身份", "reauth_required");
  }
}

// 用法
@Post("phone/change")
@RequireRecentAuth()
changePhone(/* ... */) {}
```

「再验一次」可以是验证码、密码、Passkey 中的任何一种，验证通过后 `UPDATE devices SET reauth_at = now()`。Passkey 在这里体验最好：刷一下脸就完成，不花短信钱。

## 后台用有状态 Session

上面这套双令牌是为了让移动端和网页端共用一套机制。如果你的管理后台是纯同源的网页，用传统的服务端 Session 更简单，也更好控制：

```sql
CREATE TABLE admin_sessions (
  id_hash       text PRIMARY KEY,       -- session ID 的 SHA-256
  admin_id      uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  ip            inet,
  user_agent    text
);
```

后台 Session 要有两个超时：

- **空闲超时**（比如 30 分钟没操作）：`last_seen_at` 太旧就失效，防止离开座位后被人用
- **绝对超时**（比如 12 小时）：`created_at` 太旧就失效，不管多活跃，每天至少重新登录一次

`last_seen_at` 不必每个请求都写，距上次写超过一分钟再写，省掉大部分写操作。hatch-counter 的后台没有走这条路，而是复用了双令牌，只是用 `aud: admin` 隔开、cookie 的 Path 分开；两种做法都对，选团队里（也就是你自己）更熟的那种。

## 用测试守住边界

这一章的每个规则都对应一个容易回归的边界，值得写成端到端测试，跑在真实的 Postgres 上：

| 用例 | 期望 |
|---|---|
| 不存在的账号和错误密码 | 返回同一个错误码，耗时同一量级 |
| 同一账号连续失败到阈值 | 下一次被限流；窗口过后恢复 |
| 同一张刷新票并发续期两次 | 两次都拿到新票，设备不被作废 |
| 用过的刷新票在窗口外再来 | 设备被作废，另一台设备不受影响 |
| 找回密码链接并发提交两次 | 只有一次成功，其余回 410 |
| 找回密码成功 | 所有设备的刷新票失效 |
| 踢掉设备 A 之后，A 的访问令牌 | 立即 401，不等过期 |
| 换手机号之后 | 当前设备仍在，其他设备全部失效 |
| 敏感接口超过 5 分钟未再验证 | 返回 `reauth_required` |

并发用例的写法很简单：`await Promise.all([rotate(t), rotate(t)])`，然后断言结果。不写这类测试，并发问题会在某个用户开了三个标签页的那天才第一次出现。

## 本章要点

- 同一个服务接多种客户端时，「票装在哪」和「票怎么处理」分开写；不同客户端用不同的 cookie 名、Path 和 `aud`
- 账号不存在时也跑一次慢哈希，避免用时间探测账号；参数调高后在登录时顺手重算
- 登录限流按账号和按 IP 两道，计数放库里；不做永久锁定，成功登录也不清空失败记录
- 找回密码令牌只存哈希、短时效、一次性，用掉后作废所有设备
- 「检查再占用」用一条 `UPDATE ... WHERE ... RETURNING` 完成
- 会话挂在设备上：踢人、重放检测、版本统计都按台算；设备 ID 只是分组键，不做授权依据
- 并发续期是最常见的误伤：客户端合并续期（共享 Promise、Web Locks），服务端留十秒左右的并发窗口
- 退出接口总是成功；敏感操作要求最近再验证一次；纯网页后台可以用带空闲和绝对超时的服务端 Session
