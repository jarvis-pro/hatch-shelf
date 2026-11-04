# 错误格式与错误码

成功的回包每个接口都不一样，失败的回包应该全都一样。客户端里处理错误的代码只写一份：解析错误、决定是重试、跳登录页还是弹一句提示。如果每个接口的错误形状各不相同，这一份代码就会变成一堆 `if`。这一章讲用 RFC 9457（Problem Details）作为统一的错误格式，错误码怎么设计、粒度怎么定，以及服务端和客户端各写一份什么样的代码。

## 错误回包要回答三个问题

一个错误回包有三个读者：

| 读者 | 想知道什么 | 靠哪个字段 |
|---|---|---|
| 客户端程序 | 我该怎么处置：重试、续期、跳登录、弹窗、整屏升级 | 状态码 + 机器可读的错误码 |
| 用户 | 发生了什么，下一步怎么办 | 一句人话 |
| 开发者（多半是你自己） | 这是哪一次请求，日志里怎么找到它 | 请求引用号 |

很多 API 只回答了其中一个。只回 `{ "message": "Validation failed" }`，程序没法分支，用户看不懂；只回 `{ "code": 10023 }`，用户看到的是客户端里一张对照表翻译出来的文案，表没更新就是「未知错误」。

hatch-counter 的错误契约是 `{ error, code }` 两个字段：`error` 是给人看的中文，客户端原样展示；`code` 是给程序的机器码。这个契约的来龙去脉和「报错文案在服务端写」的理由，见[《NestJS 后端架构》的错误处理一章](../nestjs-backend/06-errors.md#先定回包契约)。本章在它的基础上往前走一步：对齐一个公开的标准，让第三方也能按通用方式解析。

## RFC 9457 Problem Details

> [!WARNING]
> 本节按 RFC 9457（2023 年发布，取代 RFC 7807）整理，字段语义凭记忆复述，细节以 IETF 官方 RFC 文本（rfc-editor.org/rfc/rfc9457）为准。

RFC 9457 定义了一种 HTTP API 错误的 JSON 格式，媒体类型是 `application/problem+json`。它规定了五个标准字段：

| 字段 | 含义 | 说明 |
|---|---|---|
| `type` | 问题类型的 URI | 标识「这是哪一类错误」，是给程序认的主键；缺省值是 `about:blank`，表示没有比状态码更多的含义 |
| `title` | 问题类型的简短描述 | 同一个 `type` 的 `title` 应该固定，不随这一次的情况变化 |
| `status` | HTTP 状态码 | 和响应行的状态码一致，方便日志里单独存这段 JSON 时还能看到 |
| `detail` | 针对这一次的说明 | 给人看的，可以带具体的值 |
| `instance` | 这一次出错的 URI | 可以指向一个能查到这次错误的地址，或者就是请求引用号 |

除此之外，**可以加任意扩展字段**，客户端不认识的扩展字段必须忽略。一个完整的例子：

```http
HTTP/1.1 403 Forbidden
Content-Type: application/problem+json

{
  "type": "https://api.hatch-counter.example/problems/store-expired",
  "title": "门店服务已到期",
  "status": 403,
  "detail": "这家门店的服务已于 11 月 1 日到期，请联系客服续期。到期后数据保留 90 天。",
  "instance": "urn:request:01JC4B2M7Q",
  "code": "store_expired"
}
```

用标准格式的好处是具体的：

- 第三方开发者见过这个格式，不用读你的文档就知道去哪里找错误信息
- 很多框架和网关有现成支持：Spring、ASP.NET Core 内置，NestJS 写一个过滤器就行
- `type` 是 URI，可以直接指向文档页，出错时点进去就能看到这类错误的说明和处理办法

### 和 `{ error, code }` 对上

已经有 `{ error, code }` 契约、而且有 App 老版本在用的项目，不需要二选一。Problem Details 允许扩展字段，所以**两套字段可以同时出现**：

```json
{
  "type": "https://api.hatch-counter.example/problems/store-expired",
  "title": "门店服务已到期",
  "status": 403,
  "detail": "这家门店的服务已于 11 月 1 日到期，请联系客服续期。",
  "code": "store_expired",
  "error": "这家门店的服务已于 11 月 1 日到期，请联系客服续期。"
}
```

老客户端照旧读 `error` 和 `code`，新客户端读 `detail` 和 `code`（或 `type`）。等老版本的占比降到可以忽略（第 4 章讲怎么判断），再把 `error` 去掉。`Content-Type` 从 `application/json` 改成 `application/problem+json` 也要确认老客户端不在乎：如果它是按 `res.json()` 直接解析的，没问题；如果它检查了 `Content-Type === "application/json"`，就得等。

### `type` 和 `code` 留哪个

`type` 是标准字段，`code` 是扩展字段，它们承担的是同一个职责。一个人维护的 API 推荐两个都留：

- `type` 用 URI，指向文档里这类错误的说明，给第三方和文档用
- `code` 用短的 `snake_case` 字符串，给自己的客户端写 `switch`，日志里也好搜

两者一一对应，由同一张错误码表生成，不会对不上。

## 错误码怎么设计

### 粒度：按「客户端怎么处置」划分

错误码不是越细越好。判断标准是：**客户端需要对它做出不同的处置吗？**

| 场景 | 要不要单独的码 | 理由 |
|---|---|---|
| 令牌过期 vs 令牌签名不对 | 合成一个 `token_invalid` | 客户端处置一样：续期，续不上去登录 |
| 令牌过期 vs 刷新令牌被重放 | 分开 | 一个续期，一个直接踢回登录页并清本地数据 |
| 金额为负 vs 金额超上限 | 合成 `invalid_input`，字段级的说明放 `errors` | 客户端只需要在表单上标红 |
| 门店到期 vs 门店被停用 | 分开 | 一个显示「去续费」，一个显示「联系客服」 |
| 客户端版本太旧 | 单独的 `client_too_old` | 客户端要弹整屏升级提示，而不是一个 toast |

码太细，客户端的 `switch` 越写越长，大部分分支做的事一样；码太粗，客户端只能去匹配文案，文案一改就坏。

### 命名

- `snake_case`，「名词_状态」：`store_expired`、`token_invalid`、`stock_insufficient`
- 不用数字：`10023` 在日志里没人看得懂，号段分配也是一件多余的事
- 不带 HTTP 状态码的意思：不要叫 `forbidden_store_expired`，状态码已经说了
- **一旦发布就不能改名、不能改含义**，它和 URL 一样是契约的一部分。要改就新增一个码，旧码继续保留

### 错误码表是一份代码

把错误码表写成代码，服务端抛错、文档生成、客户端类型都从它来：

```typescript
// packages/api-contract/src/problems.ts
export const problems = {
  invalid_input:        { status: 400, title: "请求参数不正确" },
  token_invalid:        { status: 401, title: "登录已失效" },
  invalid_signature:    { status: 401, title: "签名不对" },
  refresh_reused:       { status: 401, title: "登录已在别处失效" },
  client_too_old:       { status: 403, title: "客户端版本过旧" },
  store_expired:        { status: 403, title: "门店服务已到期" },
  store_suspended:      { status: 403, title: "门店已停用" },
  perm_denied:          { status: 403, title: "没有这项权限" },
  insufficient_scope:   { status: 403, title: "API key 权限不够" },
  not_found:            { status: 404, title: "要找的东西不存在" },
  state_conflict:       { status: 409, title: "当前状态不允许这个操作" },
  version_mismatch:     { status: 412, title: "数据已被别人修改" },
  idempotency_mismatch: { status: 422, title: "同一次提交换了内容" },
  precondition_required:{ status: 428, title: "修改需要带上版本条件" },
  rate_limited:         { status: 429, title: "操作太频繁" },
  quota_exceeded:       { status: 429, title: "本周期额度已用完" },
  internal:             { status: 500, title: "服务出了点问题" },
} as const;

export type ProblemCode = keyof typeof problems;

export const problemType = (code: ProblemCode) =>
  `https://api.hatch-counter.example/problems/${code.replaceAll("_", "-")}`;
```

客户端拿到 `ProblemCode` 这个联合类型，`switch` 漏了分支 TS 就能提醒（配合 `never` 穷尽检查）。

## 校验错误：字段级的说明

表单提交失败时，客户端需要知道**哪个字段**出了什么问题，才能在对应的输入框下面标红。RFC 9457 的示例用了一个 `errors` 扩展字段，每一项带 JSON Pointer 指向出错的位置：

```json
{
  "type": "https://api.hatch-counter.example/problems/invalid-input",
  "title": "请求参数不正确",
  "status": 400,
  "detail": "有 2 处要改一下",
  "code": "invalid_input",
  "errors": [
    { "pointer": "#/amount", "detail": "金额要大于 0" },
    { "pointer": "#/lines/2/qty", "detail": "第 3 行的数量不能是小数" }
  ]
}
```

`pointer` 用 JSON Pointer（`#/lines/2/qty`）而不是点号路径（`lines.2.qty`），是因为它有标准的转义规则，字段名里有 `.` 或 `/` 也不会歧义。查询参数出错时，用 `parameter` 代替 `pointer`：`{ "parameter": "from", "detail": "日期不存在" }`。

zod 的错误转换过来很直接：

```typescript
import type { ZodError } from "zod";

export function zodToErrors(err: ZodError, where: "body" | "query") {
  return err.issues.map((i) =>
    where === "body"
      ? { pointer: "#/" + i.path.map((p) => String(p).replaceAll("~", "~0").replaceAll("/", "~1")).join("/"), detail: i.message }
      : { parameter: String(i.path[0] ?? ""), detail: i.message },
  );
}
```

`detail` 用的是 schema 里写的中文消息。zod 默认的英文消息（「Expected number, received string」）不该直接给用户看，schema 里要为每个会面向用户的规则写好中文。

## 500：说得少，记得全

服务端的 bug 回给客户端的内容要**少**：不带堆栈、不带 SQL、不带内部服务名。但要给一个能把这次请求和日志对上的引用号：

```json
{
  "type": "about:blank",
  "title": "服务出了点问题",
  "status": 500,
  "detail": "这次没办成，请稍后再试。如果一直这样，把引用号发给客服：01JC4B2M7Q",
  "instance": "urn:request:01JC4B2M7Q",
  "code": "internal"
}
```

引用号同时放进响应头（如 `X-Request-Id`）和日志的每一行。用户截图发过来，你在日志里搜这个号，就能找到完整的 cause 链。引用号最好由网关生成（nginx 的 `$request_id`）并传给后端，这样连 nginx 自己回的 502 都能对上。

## 在 NestJS 里输出 Problem Details

全局过滤器把所有异常收口成同一个格式。下面这个过滤器认三类异常：自己的 `ApiProblem`、zod 校验错误、其他一切：

```typescript
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodError } from "zod";
import { problems, problemType, type ProblemCode } from "@hatch/api-contract";

export class ApiProblem extends Error {
  constructor(
    readonly code: ProblemCode,
    readonly detail: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(detail);
  }
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private log = new Logger("Problem");

  catch(err: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = String(req.headers["x-request-id"] ?? "");

    let code: ProblemCode;
    let detail: string;
    let extra: Record<string, unknown> = {};

    if (err instanceof ApiProblem) {
      ({ code, detail, extra } = err);
    } else if (err instanceof ZodError) {
      code = "invalid_input";
      detail = `有 ${err.issues.length} 处要改一下`;
      extra = { errors: zodToErrors(err, req.method === "GET" ? "query" : "body") };
    } else if (err instanceof HttpException && err.getStatus() < 500) {
      // 框架自己抛的（如路由不存在、请求体解析失败），按状态码粗分
      code = err.getStatus() === 404 ? "not_found" : "invalid_input";
      detail = problems[code].title;
    } else {
      code = "internal";
      detail = `这次没办成，请稍后再试。如果一直这样，把引用号发给客服：${requestId}`;
      this.log.error({ requestId, err }); // 完整的 cause 链只进日志
    }

    const { status, title } = problems[code];
    res
      .status(status)
      .type("application/problem+json")
      .json({
        type: problemType(code),
        title,
        status,
        detail,
        instance: `urn:request:${requestId}`,
        code,
        error: detail, // 兼容老客户端，迁移完成后删除
        ...extra,
      });
  }
}
```

业务代码里抛错就是一行：

```typescript
if (store.expiresAt < now) {
  throw new ApiProblem("store_expired", `这家门店的服务已于 ${fmtDay(store.expiresAt)} 到期，请联系客服续期。`);
}
```

## 客户端：错误也可能不是你回的

客户端解析错误时要记住一件事：**不是所有错误回包都来自你的代码**。nginx 回的 502 是一页 HTML，Cloudflare 的 520 也是 HTML，App 在电梯里断网时根本没有回包。客户端的错误处理要能兜住这些情况：

```typescript
export type Problem = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: ProblemCode | "network" | "unknown";
  errors?: { pointer?: string; parameter?: string; detail: string }[];
};

export async function toProblem(res: Response | null, err?: unknown): Promise<Problem> {
  if (!res) {
    return { type: "about:blank", title: "网络不通", status: 0, code: "network",
             detail: "没连上服务器，检查一下网络再试" };
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("json")) {
    try {
      const body = await res.json();
      if (typeof body.code === "string") return body as Problem;
    } catch {
      /* 落到下面的兜底 */
    }
  }
  // 网关的 HTML 错误页、空回包、格式不认识的
  return {
    type: "about:blank",
    title: "服务暂时不可用",
    status: res.status,
    code: "unknown",
    detail: res.status >= 500 ? "服务器暂时有点问题，过一会儿再试" : `请求没成功（${res.status}）`,
  };
}
```

拿到 `Problem` 之后，客户端的处置逻辑是一个 `switch`，大部分分支都是「把 `detail` 展示出来」：

```typescript
switch (p.code) {
  case "token_invalid":   return refreshAndRetry();
  case "refresh_reused":  return logout();
  case "client_too_old":  return showUpgradeScreen(p.detail);
  case "invalid_input":   return markFields(p.errors);
  default:                return toast(p.detail ?? p.title);
}
```

## 文案用谁的语言

`detail` 是给人看的，那么用什么语言？对一人公司来说：

- 自己的 App 和网页端只有中文用户：`detail` 直接写中文，不做多语言
- 要做出海版：按请求的 `Accept-Language` 选文案，错误码表里每个码配多语言模板
- 开放给第三方开发者：`title` 和 `detail` 面向的是**开发者**而不是终端用户，写清楚是哪个参数、为什么不行。终端用户看到什么由第三方自己决定

最后一点容易搞混。给自己的 App 用的错误文案说的是「这家门店的服务已到期，请联系客服续期」；给开发者的错误说明应该是「`storeId` 对应的门店已过期（expiresAt: 2026-11-01），调用方需提示用户续费」。如果一个接口同时服务两类调用方，按调用方的身份（令牌类型）选文案，或者把面向终端用户的那句话单独放一个扩展字段。

## 本章要点

- 错误回包回答三个问题：程序怎么处置、用户看什么、开发者怎么查
- 用 RFC 9457 Problem Details 作为统一格式，`application/problem+json`，标准字段之外可以加扩展字段
- 已有自定义格式的，新旧字段并存，等老客户端退场再删
- 错误码按「客户端需要不同处置」划分粒度，`snake_case` 命名，发布后不改名不改义
- 错误码表写成代码，服务端、文档和客户端类型从同一处生成
- 校验错误放 `errors` 数组，用 JSON Pointer 指位置，文案写中文
- 500 说得少记得全：只给引用号，完整 cause 链进日志
- 客户端要兜住不是你回的错误：网关的 HTML 页、断网
