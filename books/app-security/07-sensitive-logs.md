# 日志里的敏感信息

日志是安全的朋友，也是安全的漏洞。出事时你要靠日志还原发生了什么；但日志本身也是一份数据，而且往往是**保护最弱的那一份**：数据库有访问控制和备份加密，日志却会被复制进聊天记录、贴进 issue、发给第三方日志服务、跟着备份归档好几年、被你随手丢给编码 agent 帮忙分析。

这一章讲两件事：日志里**不该有**什么，以及为了安全**必须有**什么。告警系统怎么搭、日志怎么集中收集，见[《可观测性与性能》](../observability-performance/)。

## 日志会去哪里

```mermaid
flowchart TD
  A[应用日志] --> B[服务器上的文件 / journald]
  A --> C[第三方错误追踪服务]
  N[nginx 访问日志] --> B
  B --> D[日志轮转与备份归档]
  B --> E["排障时复制到聊天、issue"]
  B --> F["交给编码 agent 分析"]
  C --> G[服务商的服务器]
```

每一个箭头都是一次扩散。写日志的时候要假设：**这一行将来会被你以外的人或程序看到**。

## 绝对不该进日志的

| 类别 | 例子 | 常见的泄露途径 |
|---|---|---|
| 认证凭证 | 密码、访问令牌、刷新令牌、session ID、验证码、TOTP | 请求日志打印了请求头或请求体 |
| 服务端密钥 | API key、JWT 密钥、数据库连接串 | 异常消息里带着连接串；启动时打印整份配置 |
| 个人身份信息 | 完整手机号、身份证号、银行卡号、住址 | 业务日志为了排障打印整个对象 |
| 业务敏感数据 | 别人的账目、工资、聊天内容 | 调试时 `console.log(result)` 忘了删 |

hatch-counter 的文档在好几处写明了这条规矩，可以看出它是一条贯穿全局的约定：

- **审计和失败原因里不许出现 key 和固定验证码**：那两样会被复制进聊天记录、跟着日志归档，审计只记「改没改」（`keyChanged` / `codeChanged`）
- **后台回给界面的手机号一律打码**（门店列表、门店详情、操作日志的内容都是），要看完整号码得点一下，**这一下本身记进操作日志**，摘要里也是打码的
- **短信服务商发送失败的原文只进日志和后台**，店主看到的是「验证码没发出去，稍后再试」

## 泄露的几个典型入口

### 请求日志中间件

> [!WARNING]
> 下面 `nestjs-pino` 的 `pinoHttp` 配置和 pino `redact` 的路径写法按 2025 年前后的版本整理，以 pino、pino-http 和 nestjs-pino 的官方文档为准。

最常见的泄露：为了排障打开了请求日志，顺手把所有请求头和请求体都记下了。`Authorization` 头、`Cookie` 头、登录接口的请求体，全部原样进了日志文件。

在 NestJS 里用 pino（通过 `nestjs-pino`）时，用 `redact` 在序列化时把敏感字段抹掉：

```ts
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            '*.password',
            '*.refreshToken',
            '*.code',          // 验证码
            '*.token',
          ],
          censor: '[REDACTED]',
        },
        // 请求体默认不记；真要记，只在开发环境打开
        autoLogging: { ignore: (req) => req.url === '/v1/health' },
      },
    }),
  ],
})
export class AppLoggerModule {}
```

`redact` 是按路径匹配的，**新增一个敏感字段就要记得加进来**，这很容易忘。更稳妥的思路是反过来：**默认不记请求体**，只记方法、路径、状态码、耗时、用户 ID、请求 ID 这些排障真正需要的字段。

### 异常和堆栈

数据库驱动、HTTP 客户端的异常消息里经常带着连接串、完整 URL（可能含令牌）、SQL 片段。第 3 章讲过，hatch-counter 对外一律回通用的 500，真实原因只进日志；公开的健康检查接口只回两个布尔值，因为连接串常常整条躺在异常消息里。

但「只进日志」不等于「进日志就安全」。连接串进了日志，日志被复制出去，密码就跟着出去了。对于已知会携带敏感信息的异常，记录前做一次清洗：

```ts
/** 把字符串里像连接串密码、Bearer 令牌的部分抹掉 */
export function scrub(text: string): string {
  return text
    .replace(/(\w+:\/\/[^:\s/]+:)[^@\s]+@/g, '$1***@')           // postgres://user:pass@host
    .replace(/(bearer\s+)[\w.~+/=-]+/gi, '$1***')               // Authorization: Bearer xxx
    .replace(/([?&](?:t|token|key|sig)=)[^&\s]+/gi, '$1***');    // URL 里的令牌参数
}
```

清洗是兜底手段，不是主要防线。主要防线是：**不把秘密放在会被打印的地方**，比如不把密钥拼进 URL、不在异常消息里拼接配置值。

### URL 里的令牌

URL 会出现在 nginx 访问日志、浏览器历史、`Referer` 头、代理服务器日志里。所以**令牌应该放在请求头里，而不是 URL 参数里**。

hatch-recordwall 是一个明确的例外，也说明了例外应该怎么处理。锁屏上的封面图是操作系统自己去取的，App 交出去的只是一个地址，挂不上自定义请求头，只能把只读令牌放进 URL（`&t=<令牌>`）。它接受这个代价的前提是：

- 只有图片这一条路认 URL 里的令牌，其他接口一律只认 `Authorization` 头，并且验证过「带 `?t=` 访问别的接口照样回 401」
- 这把令牌是只读的、本来就打进了 App，算不上高价值机密，丢了换一把即可
- 生成令牌时特意用 base64url 编码，不用转义，也不会在访问日志里变成一串 `%2B`

如果你的服务确实需要在 URL 里带凭证，又不想让它进 nginx 访问日志，可以定义一个不含查询参数的日志格式：

```nginx
# 用 $uri（不含查询参数）代替 $request（含完整请求行）
log_format no_query '$remote_addr - [$time_local] "$request_method $uri" '
                    '$status $body_bytes_sent $request_time';

location /v1/img {
    access_log /var/log/nginx/img.log no_query;
    proxy_pass http://api;
}
```

nginx 日志的其他配置见[《Nginx 与反向代理》](../nginx-gateway/)。

### 第三方错误追踪

Sentry 这类服务会自动采集异常发生时的请求信息、用户信息、面包屑（之前的操作记录），然后发到服务商的服务器。它们的 SDK 一般提供「发送前回调」，在里面删掉请求头、请求体和 cookie，并关掉默认采集个人信息的选项。接入时花十分钟看一遍 SDK 的隐私相关配置，比事后去服务商后台删数据省事得多。

### 交给 AI 的日志

把一段日志贴给编码 agent 让它帮忙排障，已经是很多人的日常。这些内容会进入模型服务商的系统，也会留在本地的会话记录里。贴之前过一遍：里面有没有令牌、连接串、用户的手机号。对日志做了脱敏，这一步就轻松很多。agent 读取文件、执行命令时的数据边界，见[《Agent 安全》](../agent-safety/)。

## 个人信息打码

需要在日志或界面里展示个人信息时，打码而不是原样输出：

```ts
/** 13812342046 → 138****2046 */
export const maskPhone = (p: string) => (/^\d{11}$/.test(p) ? `${p.slice(0, 3)}****${p.slice(7)}` : '***');

/** someone@example.com → s***@example.com */
export const maskEmail = (e: string) => {
  const [name, domain] = e.split('@');
  return domain ? `${name.slice(0, 1)}***@${domain}` : '***';
};
```

日志里需要关联同一个用户时，记**用户 ID** 而不是手机号；需要按手机号排查时（比如「这个号今天发了多少条短信」），到数据库里查，而不是在日志里搜。hatch-counter 就是这样：短信发送记录存在 `sms_codes` 表里，排查被刷时看的是表，不是日志。

## 必须有的：安全事件与审计日志

上面说的都是「不该记什么」。反过来，有一类日志是**必须记、而且要认真记**的：安全相关的事件。

### 审计日志不是调试日志

| | 调试日志 | 审计日志 |
|---|---|---|
| 给谁看 | 开发者排障 | 事后追责、合规、发现滥用 |
| 存在哪 | 日志文件，按天轮转 | 数据库表，长期保存 |
| 丢了一条 | 无所谓 | 是一次无痕操作 |
| 内容 | 随意 | 固定字段：谁、什么时候、对谁、做了什么、从哪里 |

hatch-counter 管理后台的操作日志（`admin.audit_logs`）是一个好例子：

- **后台每个动作都记一条**：谁、什么时候、对哪个租户、做了什么、改动摘要、从哪个 IP；登录和登录失败也记
- **跟动作写在同一个事务里**，动作回滚日志也回滚。分开写的话，动作成功而日志写入失败，就成了一次无痕操作，而无痕操作恰恰是最需要留痕的那种
- **存操作人当时的昵称**，删掉的员工照样能按人筛出来
- **动作的名称表放在服务端**，和写日志那一行在一起：名称表放在页面里的话，服务端多一种动作、页面这边一漏，就直接印出代号

```ts
// 审计和动作在同一个事务里
await adminDb.transaction(async (tx) => {
  await tx.update(stores).set({ status: 'suspended' }).where(eq(stores.id, storeId));
  await tx.insert(auditLogs).values({
    actorId: admin.id,
    actorName: admin.nickname,
    action: 'store.suspend',
    storeId,
    summary: reason ? `原因：${reason}` : null,
    ip: req.ip,
  });
});
```

### 哪些事件要记、要告警

| 事件 | 为什么 | 异常信号 |
|---|---|---|
| 登录成功与失败 | 撞库、爆破 | 同一账号或同一 IP 短时间大量失败 |
| 验证码发送 | 短信轰炸、被刷账单 | 发送量突增；被挡回的请求暴增 |
| 刷新令牌重放 | 令牌被盗 | 任何一次都值得看 |
| 权限拒绝 | 越权探测 | 某个账号突然大量 403 |
| 后台敏感操作 | 内部滥用、管理员账号被盗 | 非工作时间、陌生 IP 的操作 |
| 查看完整个人信息 | 数据滥用 | 某个员工大量查看 |

hatch-counter 记录了一个很好的信号源：没开通的号来要验证码时，不发短信，但在 `sms_probes` 表里记一行。**这张表一晚上冒出几千行，就是有人在扫号段**。这种「被拒绝的请求」往往比成功的请求更能说明问题。

记了不看等于没记。一个人不可能每天翻日志，所以要把上面这些异常信号变成主动推送的告警。[《一人运维手册》](../production-ops/)的值班一章讲了一个人怎么设告警阈值才不被吵死。

## 保留多久、谁能看

> [!WARNING]
> 日志涉及个人信息时的保存期限、访问控制和泄露通知义务，以《个人信息保护法》等法规和国家网信办等主管部门的最新规定为准。

- **调试日志**保留够排障用的时间即可，配好轮转，不要无限增长（《一人运维手册》的复盘里就有磁盘被日志写满导致全站不可用的案例）
- **审计日志**保留得更久，只追加，不提供删除接口
- **访问权限**：生产日志只有你自己能看；给外包或合作者排障时，给脱敏后的片段，而不是服务器权限

日志里只要含有个人信息，就涉及个人信息保护的法律义务：收集的必要性、保存期限、访问控制、泄露时的通知。框架和流程见[《国内合规实务》](../opc-compliance-cn/)。

## 用测试守住

和 RLS 一样，「日志里不许出现令牌」这种规矩靠人记早晚会漏。可以写一个测试，在登录、续期这些关键流程里截获日志输出，断言里面不包含令牌：

```ts
import { describe, expect, it } from 'vitest';

describe('日志不泄露凭证', () => {
  it('登录和续期流程的日志里没有令牌和验证码', async () => {
    const lines: string[] = [];
    const app = await createTestApp({ logSink: (line) => lines.push(line) });

    const { accessToken, refreshToken } = await app.loginWithSms('13800000000', '123456');
    await app.refresh(refreshToken);

    const all = lines.join('\n');
    expect(all).not.toContain(accessToken);
    expect(all).not.toContain(refreshToken);
    expect(all).not.toContain('123456');
  });
});
```

`createTestApp`、`loginWithSms` 是你测试工具里的辅助函数，具体怎么截获日志取决于你用的日志库。重点在于把「不泄露」变成一个会变红的断言。

## 本章要点

- 日志往往是保护最弱的一份数据：会被复制、归档、发给第三方、交给 AI
- 凭证、服务端密钥、完整个人信息、别人的业务数据，一律不进日志
- 请求日志默认不记请求体和敏感头；用 pino 的 `redact` 兜底，但别只靠它
- 令牌放请求头而不是 URL；确实要放 URL 时，收窄到一条路、只用低价值令牌，并让访问日志不记查询参数
- 关联用户记 ID，展示个人信息先打码，查看完整信息本身要审计
- 审计日志和调试日志是两回事：固定字段、和动作同一个事务、长期保存
- 被拒绝的请求往往是最好的攻击信号；记了要变成告警
- 用测试断言日志里不出现令牌，把规矩交给机器守
