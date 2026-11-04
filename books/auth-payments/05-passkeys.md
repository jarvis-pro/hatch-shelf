# Passkey 实现

Passkey 为什么值得加，[《应用安全》第 1 章](../app-security/01-authentication.md)已经说清楚了：服务端只存公钥、天然防钓鱼、不花短信钱。那一章的建议是「主登录方式不变，把 Passkey 作为快捷方式和第二因素加上去」。这一章按这个路线把它做出来：表怎么建、注册和登录两段各两个接口、网页和 Expo App 各要配什么，以及那些第一次做时会卡住的细节（rpID 选错了改不回来、计数器是 0、安卓的 origin 长得不像网址）。

> [!WARNING]
> 本章代码基于 SimpleWebAuthn（`@simplewebauthn/server` 和 `@simplewebauthn/browser`）v13 前后的 API 编写，这个库在大版本之间多次改过参数名和返回结构（例如验证登录时传入凭据的参数名）。React Native 端的 Passkey 库和 Expo 的配置方式变化更快。动手前以各库对应版本的文档为准，并确认与你的 Expo SDK 版本兼容。

## 先定 rpID，定了就别改

WebAuthn 里的 **rpID**（Relying Party ID）是一个域名，每把 Passkey 在创建时就和它绑死了。浏览器和系统只会为匹配的域名使用这把钥匙，这正是它防钓鱼的来源，也意味着**rpID 一旦定下、用户创建了 Passkey，就不能再改**：改了之后所有老 Passkey 全部失效。

rpID 可以是当前页面域名本身，或它的上级域名（不能是公共后缀）。所以：

| 你的域名 | rpID 选什么 |
|---|---|
| 网页在 `app.example.com`，API 在 `api.example.com` | `example.com`，这样以后加 `admin.example.com` 也能共用 |
| 只有一个 `example.com` | `example.com` |

App 端的 Passkey 也要和这个域名关联（下文「Expo App 怎么接」），所以选一个你长期持有、不会换的主域名。

## 两张表

```sql
CREATE TABLE passkeys (
  id              text PRIMARY KEY,        -- credential ID，base64url
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  public_key      bytea NOT NULL,
  counter         bigint NOT NULL DEFAULT 0,
  transports      text[],                  -- internal / hybrid / usb ...，登录时回传给浏览器作提示
  device_type     text NOT NULL,           -- singleDevice / multiDevice（可同步）
  backed_up       boolean NOT NULL,
  name            text,                    -- 用户可改，如「iPhone」「工作电脑」
  last_used_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON passkeys (account_id);

-- 每次注册、登录的挑战，一次性、短时效
CREATE TABLE webauthn_challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid,                        -- 注册时有；无用户名登录时为空
  purpose     text NOT NULL,               -- register / login / reauth
  challenge   text NOT NULL,
  expires_at  timestamptz NOT NULL
);
```

Passkey 不放进第 1 章的 `credentials` 表，因为一个人通常会有好几把：手机一把、电脑一把、同步到家里的 iPad 又是同一把。

挑战放数据库而不是 Session 或内存：API 是无状态的，两次请求可能落到不同进程上（零停机发布时就会）。挑战表的行用完就删，定时任务清掉过期的。

## 注册：两个接口

注册要求用户**已经登录**（用短信或其他方式），在设置页点「添加通行密钥」。

```typescript
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";

const RP_ID = "example.com";
const RP_NAME = "掌柜眼";
// 允许的来源：网页的 origin，以及安卓 App 的 origin（见下文）
const ORIGINS = ["https://app.example.com", ...androidOrigins()];

export async function passkeyRegisterOptions(db: Db, accountId: string, displayName: string) {
  const existing = await db.execute<{ id: string; transports: string[] | null }>(sql`
    SELECT id, transports FROM passkeys WHERE account_id = ${accountId}`);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: uuidToBytes(accountId),   // 写进 Passkey 的 userHandle，无用户名登录时能拿回来
    userName: displayName,            // 只用于系统界面上的展示，如「尾号 8000」
    attestationType: "none",          // 不需要验证设备厂商
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports ?? undefined })),
    authenticatorSelection: {
      residentKey: "required",        // 可发现凭据：登录时不用先输手机号
      userVerification: "preferred",
    },
  });

  await saveChallenge(db, { accountId, purpose: "register", challenge: options.challenge });
  return options;
}

export async function passkeyRegisterVerify(db: Db, accountId: string, body: RegistrationResponseJSON) {
  const expectedChallenge = await takeChallenge(db, { accountId, purpose: "register" });

  const { verified, registrationInfo } = await verifyRegistrationResponse({
    response: body,
    expectedChallenge,
    expectedOrigin: ORIGINS,
    expectedRPID: RP_ID,
  });
  if (!verified || !registrationInfo) throw new AppError("通行密钥添加失败", 400);

  const { credential, credentialDeviceType, credentialBackedUp } = registrationInfo;
  await db.execute(sql`
    INSERT INTO passkeys (id, account_id, public_key, counter, transports, device_type, backed_up)
    VALUES (${credential.id}, ${accountId}, ${Buffer.from(credential.publicKey)}, ${credential.counter},
            ${credential.transports ?? null}, ${credentialDeviceType}, ${credentialBackedUp})`);
}
```

`excludeCredentials` 把这个账号已有的 Passkey 告诉设备，防止在同一个设备上重复注册。`takeChallenge` 是「取出并删除」，和第 4 章的 `state` 一样只能用一次：

```typescript
async function takeChallenge(db: Db, q: { accountId?: string; purpose: string; challengeId?: string }) {
  const [row] = await db.execute<{ challenge: string }>(sql`
    DELETE FROM webauthn_challenges
    WHERE purpose = ${q.purpose} AND expires_at > now()
      AND (${q.challengeId ?? null}::uuid IS NULL OR id = ${q.challengeId ?? null}::uuid)
      AND (${q.accountId ?? null}::uuid IS NULL OR account_id = ${q.accountId ?? null}::uuid)
    RETURNING challenge`);
  if (!row) throw new AppError("操作超时，请重试", 400);
  return row.challenge;
}
```

## 登录：两个接口

登录用**可发现凭据**（discoverable credential）：不用先输手机号，浏览器或系统直接列出这个网站的 Passkey 让用户选。因为不知道是谁在登录，挑战不挂账号，用一个 `challengeId` 关联前后两次请求：

```typescript
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";

export async function passkeyLoginOptions(db: Db) {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "preferred",
    // allowCredentials 留空：让设备自己列出可用的 Passkey
  });
  const challengeId = await saveChallenge(db, { purpose: "login", challenge: options.challenge });
  return { options, challengeId };
}

export async function passkeyLoginVerify(db: Db, challengeId: string, body: AuthenticationResponseJSON) {
  const expectedChallenge = await takeChallenge(db, { purpose: "login", challengeId });

  const [pk] = await db.execute<PasskeyRow>(sql`SELECT * FROM passkeys WHERE id = ${body.id}`);
  // 不区分「没这把钥匙」和「验签失败」，统一一句
  if (!pk) throw new AuthError("通行密钥无效，请换一种方式登录", "passkey_invalid");

  const { verified, authenticationInfo } = await verifyAuthenticationResponse({
    response: body,
    expectedChallenge,
    expectedOrigin: ORIGINS,
    expectedRPID: RP_ID,
    credential: {
      id: pk.id,
      publicKey: new Uint8Array(pk.public_key),
      counter: Number(pk.counter),
      transports: pk.transports ?? undefined,
    },
  });
  if (!verified) throw new AuthError("通行密钥无效，请换一种方式登录", "passkey_invalid");

  await db.execute(sql`
    UPDATE passkeys SET counter = ${authenticationInfo.newCounter}, last_used_at = now()
    WHERE id = ${pk.id}`);
  return pk.account_id; // 交给第 2 章发票
}
```

注意 Passkey 登录**不经过** `resolveIdentity`：它不是一个外部身份，而是直接属于某个账号的凭据。验证通过就知道是哪个账号，直接发票。

### 计数器经常是 0

WebAuthn 设计了一个签名计数器：每用一次加一，服务端发现计数器倒退了，说明凭据可能被克隆。但**可同步的 Passkey**（iCloud 钥匙串、Google 密码管理器里的那种）在多台设备之间同步，没法维护一个单调递增的计数，它们通常永远返回 0。

SimpleWebAuthn 的处理是：存的和新来的都是 0 时不视为倒退。你要做的只是**不要自己额外加「计数器为 0 就拒绝」这类逻辑**，也不要把计数器倒退直接当成攻击处理到封号的程度。记一条日志、提醒用户检查即可。

## 网页端怎么接

```typescript
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";

export async function addPasskey() {
  const options = await api.post("/auth/passkey/register/options");
  const response = await startRegistration({ optionsJSON: options });
  await api.post("/auth/passkey/register/verify", response);
}

export async function loginWithPasskey() {
  const { options, challengeId } = await api.post("/auth/passkey/login/options");
  const response = await startAuthentication({ optionsJSON: options });
  return api.post("/auth/passkey/login/verify", { challengeId, response });
}
```

体验上可以再进一步：**条件式界面**（conditional UI）。在手机号输入框上加 `autocomplete="username webauthn"`，页面加载时就以 `useBrowserAutofill: true` 调用 `startAuthentication`，用户点输入框时，浏览器会在自动填充建议里列出 Passkey。有 Passkey 的人一点就登录，没有的人照常输手机号，两条路不互相打扰。

用户取消系统面板时，库会抛出 `NotAllowedError`，这是正常情况，不要弹错误提示，静默回到原界面。

## Expo App 怎么接

> [!WARNING]
> 关联域名文件的格式、App 端 Passkey 库的选择和 Expo 的配置项以 Apple、Google 和所用库的最新文档为准；需要原生模块的库只能在 dev client 里运行，不能用 Expo Go。

App 里的 Passkey 和网页共用同一个 rpID，要让系统相信「这个 App 有权使用 `example.com` 的 Passkey」，需要双向声明：

| 平台 | App 这边 | 网站这边 |
|---|---|---|
| iOS | `app.json` 的 `ios.associatedDomains` 加 `webcredentials:example.com` | `https://example.com/.well-known/apple-app-site-association` 里的 `webcredentials.apps` 列出 `<TeamID>.<BundleID>` |
| Android | 用对应的签名证书构建 | `https://example.com/.well-known/assetlinks.json` 里声明 App 包名和签名证书指纹，关系包含 `delegate_permission/common.get_login_creds` |

iOS 的关联文件：

```json
{
  "webcredentials": {
    "apps": ["ABCDE12345.com.example.counter"]
  }
}
```

这个文件必须通过 HTTPS 直接返回（不能重定向），`Content-Type` 为 `application/json`。在 nginx 里给它单独写一个 `location`，是最常见的配置方式。

**安卓的 origin 不是网址**。安卓 App 发起的 WebAuthn 请求，`clientDataJSON` 里的 origin 是 `android:apk-key-hash:<签名证书 SHA-256 的 base64url>`。所以服务端的 `expectedOrigin` 要把它加进去：

```typescript
function androidOrigins(): string[] {
  // 每个签名证书（调试、发布、应用商店重签名）都算一个，指纹从环境变量读
  return (process.env.ANDROID_CERT_SHA256 ?? "")
    .split(",")
    .filter(Boolean)
    .map((hex) => `android:apk-key-hash:${Buffer.from(hex.replace(/:/g, ""), "hex").toString("base64url")}`);
}
```

调试版和发布版签名不同，两个都要加；应用商店如果替你重新签名，也要加上商店给出的那张证书。

App 端选一个封装了 iOS `ASAuthorization` 和安卓 Credential Manager 的 React Native 库，它们接收的参数就是服务端 `generate*Options` 返回的 JSON，返回的也是 SimpleWebAuthn 能直接验证的格式。所以**服务端代码网页和 App 完全共用**，只有 origin 列表不同。

## 用作第二因素和再验证

Passkey 最省事的用法其实不是登录，而是第 2 章的「敏感操作再验一次」。用户已经登录，知道是谁，所以带上 `allowCredentials`：

```typescript
export async function passkeyReauthOptions(db: Db, accountId: string) {
  const creds = await db.execute<{ id: string; transports: string[] | null }>(sql`
    SELECT id, transports FROM passkeys WHERE account_id = ${accountId}`);
  if (!creds.length) return null; // 没有 Passkey，前端改用验证码
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "required", // 再验证必须真的刷脸或输入设备密码
    allowCredentials: creds.map((c) => ({ id: c.id, transports: c.transports ?? undefined })),
  });
  await saveChallenge(db, { accountId, purpose: "reauth", challenge: options.challenge });
  return options;
}
```

验证时多一条检查：返回的 Passkey 必须属于当前账号。验证通过后 `UPDATE devices SET reauth_at = now()`。用户刷一下脸就能改手机号，不用等短信，你也省一条短信钱。

管理后台更进一步：hatch-counter 的后台现在是「密码 + TOTP」，Passkey 可以直接替代 TOTP 作为第二因素，或者在员工都配好之后作为唯一的登录方式。后台用户就那么几个，强制推行的成本很低。

## 管理和兜底

设置页里要有一个 Passkey 列表：名字（用户可改，默认按 `transports` 和 User-Agent 猜一个，如「iPhone」）、添加时间、最后使用时间、删除按钮。删除也要求最近再验证过。

**早期不要让 Passkey 成为唯一的登录方式**。用户换了手机、退出了 iCloud、清掉了浏览器的密码管理器，Passkey 就没了。第 4 章的解绑规则里把 Passkey 算作一种登录方式，但对 C 端用户，建议始终保留手机号作为兜底，Passkey 只是更快的那条路。

## 测试

Passkey 的端到端测试不需要真设备。Chrome DevTools 的 WebAuthn 面板可以添加虚拟认证器，Playwright 可以通过 CDP 做同样的事：

```typescript
import { test } from "@playwright/test";

test("添加通行密钥后可以用它登录", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });

  await loginWithSms(page);                // 先用验证码登录
  await page.getByRole("button", { name: "添加通行密钥" }).click();
  await page.getByText("已添加").waitFor();

  await logout(page);
  await page.getByRole("button", { name: "使用通行密钥登录" }).click();
  await page.getByText("今日概览").waitFor();
});
```

服务端的单元测试里，挑战的一次性、过期、`challengeId` 不匹配、Passkey 属于别的账号（再验证场景）这几条，比签名本身更值得测：签名验证是库的事，这几条是你的事。

## 本章要点

- rpID 选长期持有的主域名，一旦用户创建了 Passkey 就不能改
- 一人多把 Passkey，单独建表；挑战存库、一次性、短时效
- 注册要求已登录，用 `excludeCredentials` 防重复；登录用可发现凭据，`allowCredentials` 留空
- Passkey 登录不经过 `resolveIdentity`，验证通过直接发票
- 可同步的 Passkey 计数器常为 0，不要额外拒绝
- 网页可以用条件式界面把 Passkey 放进自动填充；用户取消不报错
- App 端靠关联域名文件双向声明；安卓的 origin 是证书指纹，所有签名证书都要加进 `expectedOrigin`
- 最划算的用法是敏感操作的再验证和后台的第二因素；C 端早期保留手机号兜底
- 用虚拟认证器做端到端测试，重点测挑战和归属这些自己写的逻辑

## 动手练习

1. **rpID 必须匹配当前域名**：用 `npx serve` 在本机起一个空页面，用 Chrome 打开 `http://localhost:3000`，在 DevTools 的 WebAuthn 面板里勾选「Enable virtual authenticator environment」并添加一个支持 resident key 的认证器。在控制台调用 `navigator.credentials.create`，`rp.id` 分别填 `"localhost"` 和 `"example.com"`（`challenge` 和 `user.id` 用 `crypto.getRandomValues(new Uint8Array(16))`，`pubKeyCredParams: [{ type: "public-key", alg: -7 }]`）。

   验证：`localhost` 的那次返回一个 `PublicKeyCredential`，WebAuthn 面板里多出一条凭据；`example.com` 的那次抛出 `SecurityError`。

   参考答案：rpID 只能是当前域名或它的上级域名，这条规则由浏览器执行，钓鱼网站拿不到你域名下的 Passkey。也因此 rpID 定下之后就不能改。

2. **看一眼服务端要验的 `clientDataJSON`**：接着上一题，把成功返回的凭据存成 `cred`，执行 `JSON.parse(new TextDecoder().decode(cred.response.clientDataJSON))`。

   验证：能看到 `type: "webauthn.create"`、`origin: "http://localhost:3000"`，以及一个 base64url 形式的 `challenge`，它解码后正是你传进去的那 16 个字节。

   参考答案：`verifyRegistrationResponse` 的 `expectedChallenge`、`expectedOrigin` 比对的就是这几个字段。挑战一次性、存库，是为了保证这份响应是对你刚发出的那次请求的回答。

3. **算安卓的 origin**：假设签名证书的 SHA-256 指纹是 `00:01:02:...:1F`（32 个字节依次为 0 到 31），用本章的 `androidOrigins` 写法算出它对应的 origin。

   验证：结果是 `android:apk-key-hash:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8`。

   参考答案：去掉冒号按十六进制解成字节，再做 base64url（无填充）。真实项目里调试版和发布版证书各算一个，都放进 `expectedOrigin`。
