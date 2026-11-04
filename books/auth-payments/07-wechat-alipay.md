# 微信支付与支付宝

上一章搭好了与渠道无关的骨架：订单、支付单、事件表和唯一的 `settlePayment`。这一章把国内两家接进来。资质怎么办、选哪种支付产品、微信 Native 下单的签名串怎么拼、回调怎么解密，[《定价与商业模式》第 5 章](../pricing-monetization/05-payments-china.md)已经给过代码，这里不再重复。这一章补的是把它做成「能长期跑」的那部分：两种验签模式和密钥轮换、NestJS 里的回调控制器、查单关单退款、支付宝的签名和通知验签，以及两家在细节上的差异。

> [!WARNING]
> 本章的接口路径、字段名、签名规则、通知重试策略和应答格式按 2025 年前后微信支付 APIv3 和支付宝开放平台的官方文档整理。两家都会调整接口和规则（例如微信支付在平台证书之外推出了「微信支付公钥」验签方式），费率和开通条件更是随行业和主体变化。以微信支付商户文档中心（pay.weixin.qq.com）和支付宝开放平台文档（opendocs.alipay.com）的最新版本为准。

## 按端选产品

| 用户在哪 | 微信支付 | 支付宝 |
|---|---|---|
| 电脑浏览器 | Native（展示二维码） | 电脑网站支付（跳转收银台，可扫码） |
| 手机浏览器 | H5 支付（需单独申请） | 手机网站支付 |
| 微信里打开的网页 | JSAPI（需要用户在该公众号下的 openid） | 微信内不能直接拉起支付宝 |
| 原生 App | APP 支付 | APP 支付 |
| 小程序 | 小程序支付 | 支付宝小程序 |

hatch-counter 如果接支付，第一步只需要「电脑浏览器」这一行：网页端续期弹出二维码，店主用手机扫。微信 Native 和支付宝电脑网站支付各接一个，就覆盖了几乎所有店主。JSAPI 要用到第 4 章存下的 `wechat_openids`，这是那张表存在的理由之一。

iOS App 里卖数字内容不能用这两家，要走内购（第 8 章）；它们在 App 里只能卖实物和线下服务。

## 微信支付：一个客户端类

把签名、验签、错误处理收进一个类，业务代码只调方法。签名串的拼法在《定价与商业模式》第 5 章，这里重点看它没讲的两件事：**应答也要验签**，以及**验签用哪把钥匙**。

### 两种验签模式

你调用微信支付的接口时，用的是你自己的商户私钥签名；微信支付发给你的东西（接口应答、回调通知）由微信签名，你要验。验签的钥匙有两种来源：

| 模式 | 钥匙从哪来 | 请求头 `Wechatpay-Serial` 的值 |
|---|---|---|
| 平台证书 | 调「下载平台证书」接口获取，会定期更换，新旧证书有一段重叠期 | 平台证书的序列号 |
| 微信支付公钥 | 在商户平台下载一个公钥文件，有固定的公钥 ID | 公钥 ID（以 `PUB_KEY_ID_` 开头） |

新开通的商户可能只能用公钥模式，老商户可能在从证书模式迁移。最稳的写法是**按 `Wechatpay-Serial` 查钥匙**，两种都支持，迁移期也不会出错：

```typescript
import { createSign, createVerify, randomBytes } from "node:crypto";

export class WechatPayClient {
  /** serial → PEM 公钥。公钥模式只有一个；证书模式在轮换期会有两个 */
  private verifiers = new Map<string, string>();

  constructor(private cfg: WechatPayConfig) {
    if (cfg.wechatPublicKeyId) this.verifiers.set(cfg.wechatPublicKeyId, cfg.wechatPublicKey);
  }

  verify(headers: Record<string, string | undefined>, body: string): boolean {
    const serial = headers["wechatpay-serial"];
    const ts = headers["wechatpay-timestamp"];
    const nonce = headers["wechatpay-nonce"];
    const sig = headers["wechatpay-signature"];
    if (!serial || !ts || !nonce || !sig) return false;

    // 时间戳离现在太远的，不管签名对不对都拒绝：防止截获的旧通知被重放
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;

    const key = this.verifiers.get(serial);
    if (!key) {
      // 不认识的序列号：证书模式下多半是平台证书换了，刷新一次再试（在调用方异步做）
      void this.refreshPlatformCerts();
      return false;
    }
    return createVerify("RSA-SHA256").update(`${ts}\n${nonce}\n${body}\n`).verify(key, sig, "base64");
  }

  async request<T>(method: "GET" | "POST", path: string, body?: object): Promise<T> {
    const payload = body ? JSON.stringify(body) : "";
    const res = await fetch(`https://api.mch.weixin.qq.com${path}`, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: this.authorization(method, path, payload),
      },
      body: body ? payload : undefined,
    });
    const text = await res.text();

    // 应答也要验签：确认这个应答真是微信支付发的，而不是被中间人改过
    if (text && !this.verify(Object.fromEntries(res.headers), text)) {
      throw new Error(`微信支付应答验签失败：${method} ${path}`);
    }
    if (!res.ok) throw new WechatPayError(res.status, text ? JSON.parse(text) : {});
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private authorization(method: string, path: string, body: string): string {
    const ts = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString("hex");
    const sig = createSign("RSA-SHA256")
      .update(`${method}\n${path}\n${ts}\n${nonce}\n${body}\n`)
      .sign(this.cfg.privateKey, "base64");
    return `WECHATPAY2-SHA256-RSA2048 mchid="${this.cfg.mchid}",nonce_str="${nonce}",signature="${sig}",timestamp="${ts}",serial_no="${this.cfg.serialNo}"`;
  }

  private async refreshPlatformCerts(): Promise<void> {
    /* 证书模式：调下载平台证书接口，用 APIv3 密钥解密，填进 verifiers。限频，别每次都调 */
  }
}
```

两个容易漏的细节：

- **`Object.fromEntries(res.headers)` 的键是小写的**，`fetch` 会规范化头名，所以 `verify` 里用小写取
- **不认识的序列号不要直接报错了事**。平台证书轮换时，微信会先用新证书签名，你的缓存里还只有旧的。正确的反应是去下载一次最新证书，下一次重试（回调会重发，应答可以重新请求）就能过

微信支付文档里还提到，它可能在应答里故意放一个错误的签名来探测商户有没有认真验签。上面的代码验签失败就抛错，自然通过这种探测。

### 回调控制器

```typescript
@Controller("pay/wechat")
export class WechatNotifyController {
  constructor(private wx: WechatPayClient, private events: PaymentEvents) {}

  @Post("notify")
  @Public()
  @HttpCode(204)
  async notify(@Req() req: RawBodyRequest<Request>, @Res({ passthrough: true }) res: Response) {
    const raw = req.rawBody?.toString("utf8") ?? "";
    if (!this.wx.verify(req.headers as Record<string, string>, raw)) {
      res.status(401);
      return { code: "FAIL", message: "签名错误" };
    }

    const body = JSON.parse(raw) as WechatNotify;
    const resource = decryptResource(this.wx.apiV3Key, body.resource); // 解密代码见《定价与商业模式》第 5 章

    // 先落库，再处理：落库成功就可以回 204，处理失败由后台任务重试（第 10 章）
    await this.events.record({
      channel: "wechat",
      dedupeKey: body.id, // 通知 ID
      outTradeNo: resource.out_trade_no ?? resource.out_refund_no,
      payload: { event_type: body.event_type, resource },
    });
    // 返回 204 表示收到，不需要应答体
  }
}
```

应答的约定：**成功回 200 或 204，失败回 4xx/5xx 并带一个 `{code, message}` 的 JSON**。微信支付在没收到成功应答时会按一套递增的间隔重发，持续大约一天。所以这个接口要尽量快、尽量只做「验签、解密、落库」三件事，真正的 `settlePayment` 放到事件处理里。

`rawBody` 要在 `NestFactory.create(AppModule, { rawBody: true })` 时打开，验签必须用原始字节，不能用解析后再序列化的 JSON。

### 查单、关单、退款

有了客户端类，这几个接口都很短：

```typescript
export const wechatNative: ChannelAdapter = {
  async query(outTradeNo) {
    const r = await wx.request<WechatTxn>(
      "GET", `/v3/pay/transactions/out-trade-no/${outTradeNo}?mchid=${cfg.mchid}`);
    return mapWechatState(r);
  },

  async close(outTradeNo) {
    try {
      await wx.request("POST", `/v3/pay/transactions/out-trade-no/${outTradeNo}/close`, { mchid: cfg.mchid });
      return { closed: true };
    } catch (e) {
      // 已经支付的单关不掉：交给调用方去查单、走 settlePayment
      if (e instanceof WechatPayError && e.code === "ORDERPAID") return { closed: false, paid: true };
      throw e;
    }
  },

  async refund(p: { outTradeNo: string; outRefundNo: string; refundCents: number; totalCents: number; reason: string }) {
    return wx.request<WechatRefund>("POST", "/v3/refund/domestic/refunds", {
      out_trade_no: p.outTradeNo,
      out_refund_no: p.outRefundNo, // 我方退款单号：同一个号重复提交只会退一次
      reason: p.reason,
      notify_url: `${cfg.publicUrl}/pay/wechat/notify`,
      amount: { refund: p.refundCents, total: p.totalCents, currency: "CNY" },
    });
  },
};
```

退款是**异步**的：申请接口返回的状态通常是「处理中」，最终结果靠退款通知（`event_type` 以 `REFUND.` 开头）或退款查询接口。退款通知和支付通知可以发到同一个地址，按 `event_type` 分流。

状态映射集中在一个函数里：

```typescript
function mapWechatState(r: WechatTxn): ChannelQueryResult {
  switch (r.trade_state) {
    case "SUCCESS":
    case "REFUND": // 转入退款：说明曾经付成功过，先按成功入账，退款由退款流程处理
      return {
        status: "succeeded",
        result: {
          channel: "wechat",
          outTradeNo: r.out_trade_no,
          channelTxnId: r.transaction_id!,
          amountCents: r.amount.total, // 微信的金额单位就是分
          paidAt: new Date(r.success_time!),
        },
      };
    case "NOTPAY":
    case "USERPAYING":
      return { status: "pending" };
    case "CLOSED":
    case "REVOKED":
      return { status: "closed" };
    default:
      return { status: "failed", detail: r.trade_state };
  }
}
```

## 支付宝：签名自己写也不难

支付宝的 API 是「网关 + 方法名」的风格：所有请求发到同一个网关地址，用 `method` 参数区分接口，业务参数放在 `biz_content` 这个 JSON 字符串里。官方有 Node SDK，但不同大版本调用方式差别很大，这里展示协议本身，你可以选择用 SDK 或者直接用这几十行。

### 签名

规则：除 `sign` 外的所有参数，按参数名的 ASCII 顺序排序，拼成 `k1=v1&k2=v2`，用应用私钥做 RSA-SHA256（支付宝称为 RSA2）签名，base64 编码。

```typescript
import { createSign, createVerify } from "node:crypto";

function signString(params: Record<string, string>, exclude: string[]): string {
  return Object.keys(params)
    .filter((k) => !exclude.includes(k) && params[k] !== undefined && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
}

function alipayTimestamp(d = new Date()): string {
  // 支付宝要求 "yyyy-MM-dd HH:mm:ss"，按北京时间
  return new Date(d.getTime() + 8 * 3600_000).toISOString().replace("T", " ").slice(0, 19);
}

export function alipayPagePayUrl(cfg: AlipayConfig, p: { outTradeNo: string; amountCents: number; subject: string; expiresAt: Date }) {
  const params: Record<string, string> = {
    app_id: cfg.appId,
    method: "alipay.trade.page.pay",
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: alipayTimestamp(),
    version: "1.0",
    notify_url: `${cfg.publicUrl}/pay/alipay/notify`,
    return_url: `${cfg.webUrl}/billing/return`, // 只用于展示，不作为支付成功依据
    biz_content: JSON.stringify({
      out_trade_no: p.outTradeNo,
      total_amount: centsToYuan(p.amountCents), // 支付宝的金额单位是元，字符串
      subject: p.subject,
      product_code: "FAST_INSTANT_TRADE_PAY",
      time_expire: alipayTimestamp(p.expiresAt),
    }),
  };
  params.sign = createSign("RSA-SHA256").update(signString(params, ["sign"])).sign(cfg.appPrivateKey, "base64");
  // 电脑网站支付是让浏览器去网关，所以拼成 URL（参数值要编码）返回给前端跳转
  return `${cfg.gateway}?${new URLSearchParams(params)}`;
}
```

签名用的是**原始值**，URL 编码只在拼最终地址时做。签名时就编码，是「签名不对」最常见的原因之一。

### 异步通知验签

支付宝的通知是 `application/x-www-form-urlencoded` 表单。验签规则和签名对称，区别在于要**同时去掉 `sign` 和 `sign_type`**：

```typescript
@Controller("pay/alipay")
export class AlipayNotifyController {
  @Post("notify")
  @Public()
  @Header("Content-Type", "text/plain")
  async notify(@Body() form: Record<string, string>): Promise<string> {
    // Nest 默认的 urlencoded 解析器已经把值解码好了，验签用解码后的值
    const ok = createVerify("RSA-SHA256")
      .update(signString(form, ["sign", "sign_type"]))
      .verify(cfg.alipayPublicKey, form.sign, "base64");
    if (!ok) return "failure";

    if (form.app_id !== cfg.appId) return "failure"; // 不是发给这个应用的

    await events.record({
      channel: "alipay",
      dedupeKey: form.notify_id,
      outTradeNo: form.out_trade_no,
      payload: form,
    });
    // 必须回纯文本 success（不带引号、不带换行），否则支付宝会继续重发
    return "success";
  }
}
```

和微信一样，这里只做验签、核对、落库。处理时再把它映射成统一结果：

```typescript
function mapAlipayNotify(f: Record<string, string>): ChannelQueryResult {
  if (f.trade_status === "TRADE_SUCCESS" || f.trade_status === "TRADE_FINISHED") {
    return {
      status: "succeeded",
      result: {
        channel: "alipay",
        outTradeNo: f.out_trade_no,
        channelTxnId: f.trade_no,
        amountCents: yuanToCents(f.total_amount), // 第 6 章的字符串解析，不用浮点
        paidAt: new Date(`${f.gmt_payment.replace(" ", "T")}+08:00`),
      },
    };
  }
  if (f.trade_status === "WAIT_BUYER_PAY") return { status: "pending" };
  // TRADE_CLOSED 有两种：未付款超时关闭，或付款后全额退款。后者在退款流程里已经处理过
  return { status: "closed" };
}
```

`TRADE_FINISHED` 表示交易完结、不可再退款，它可能在 `TRADE_SUCCESS` 之后很久才单独再通知一次。两条都会进 `settlePayment`，第二条因为支付单已经是 `succeeded` 而直接返回，这正是第 6 章「同一个结论只生效一次」的用处。

### 查单、关单、退款

这几个接口都走网关，`method` 分别是 `alipay.trade.query`、`alipay.trade.close`、`alipay.trade.refund`，共用同一个签名函数，用 POST 发表单。返回的 JSON 里，业务结果在 `<方法名去点换下划线>_response` 字段下（如 `alipay_trade_query_response`），旁边是对它的签名 `sign`，同样要验。

退款要传 `out_request_no`（我方退款请求号）。部分退款时，同一笔交易每次退款用不同的请求号；重试同一次退款用同一个请求号，支付宝据此保证不重复退。

## 两家的差异对照

| 项目 | 微信支付 APIv3 | 支付宝 |
|---|---|---|
| 金额单位 | 分，整数 | 元，两位小数的字符串 |
| 请求格式 | REST + JSON | 网关 + 表单，业务参数是 JSON 字符串 |
| 签名算法 | SHA256 with RSA | SHA256 with RSA（RSA2） |
| 通知格式 | JSON，`resource` 需用 APIv3 密钥解密 | 表单明文 |
| 通知验签 | 时间戳、随机串、原始报文 | 除 `sign`、`sign_type` 外参数排序拼接 |
| 成功应答 | HTTP 200 / 204 | 纯文本 `success` |
| 通知重试 | 递增间隔，约一天 | 递增间隔，约一天 |
| 去重键 | 通知 `id` | `notify_id` |
| 退款结果 | 异步，看退款通知或查询 | 同步返回为主，以查询为准 |

重试的具体间隔两家都写在官方文档里，会调整。记住结论就够了：**回调可能在一天之内多次到达，也可能在你的服务恢复后很久才到达**，处理必须幂等，而且不能只靠回调。

## 联调与上线

**本地收回调**。渠道的通知只能发到公网地址。开发时用一个隧道工具把本地端口暴露出去（如 Cloudflare Tunnel），把 `notify_url` 指向隧道地址。注意 `notify_url` 是下单时传给渠道的，不同环境要用不同的值，从配置里读。

**沙箱**。支付宝开放平台提供沙箱环境，有独立的网关地址、沙箱应用和沙箱买家账号，可以完整走一遍流程。微信支付 APIv3 没有同等完整的沙箱，常见做法是用真实商户号下 1 分钱的订单、付完立刻退款，把下单、回调、查单、关单、退款、退款通知全部走一遍。以两家当前提供的测试方式为准。

**上线前的清单**：

| 检查项 | 怎么验证 |
|---|---|
| 回调地址公网可达，HTTPS 证书有效 | 渠道后台的通知记录里没有失败 |
| 验签失败会拒绝 | 改一个字节重放一条通知，应该被拒 |
| 重复通知只入账一次 | 同一条通知重放三次，到期日只顺延一次 |
| 回调没到也能入账 | 临时关掉回调接口付一笔，看查单任务是否补上 |
| 过期订单在渠道侧被关闭 | 下单不付，过期后在渠道后台查到已关闭 |
| 退款后到期日正确减回 | 部分退款、全额退款各一次 |

## 密钥和证书的保管

| 东西 | 放哪 | 会过期吗 |
|---|---|---|
| 微信商户 API 私钥、证书序列号 | 服务端环境变量或挂载的密钥文件 | 商户 API 证书有有效期，到期前要在商户平台更换 |
| 微信 APIv3 密钥 | 同上 | 不会自动过期，可以手动重设（重设后旧通知解不开） |
| 微信支付公钥 / 平台证书 | 公钥文件随部署分发；平台证书运行时下载缓存 | 平台证书定期轮换 |
| 支付宝应用私钥 | 服务端 | 自己换 |
| 支付宝公钥或证书 | 服务端 | 证书模式下有有效期 |

> [!WARNING]
> 各类证书的有效期和更换流程以两家商户平台的最新说明为准。

会过期的东西，**把到期日写进监控**，提前一个月报警。支付证书过期导致的故障，表现是所有用户都付不了钱，而你可能要到第一个客户来问才知道。私钥和密钥本身怎么管理、泄露了怎么办，见[《应用安全》第 4 章](../app-security/04-passwords-secrets.md)。

## 本章要点

- 按端选产品：桌面网页 SaaS 先接微信 Native 和支付宝电脑网站支付两样就够
- 微信支付的验签按 `Wechatpay-Serial` 查钥匙，同时支持平台证书和微信支付公钥；不认识的序列号先刷新证书
- 应答和回调都要验签，时间戳过旧的直接拒绝
- 回调接口只做验签、解密、核对、落库，然后快速应答；处理放到事件任务里
- 关单遇到「已支付」转去查单入账；退款用我方退款单号保证幂等，结果以通知或查询为准
- 支付宝签名用原始值排序拼接，URL 编码只在拼地址时做；通知验签去掉 `sign` 和 `sign_type`，应答纯文本 `success`
- 两家金额单位不同，在适配层转换；状态映射集中在一个函数里
- 上线前逐项验证：验签、重复通知、回调缺失、过期关单、退款；会过期的证书写进监控
