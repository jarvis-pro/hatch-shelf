# 校验与 DTO

TypeScript 的类型只活在编译期。请求体写着 `body: CreateExpense`，运行时进来的可能是任何东西：少字段、多字段、字符串冒充数字、2 月 30 日。**入口处的运行时校验，是把「不可信的输入」变成「有类型的数据」的唯一一道关**。这一章比较 Nest 里两条校验路线（class-validator 和 schema），讲 NestJS 12 新加的 Standard Schema 支持，再看 hatch-counter 怎么用 zod 把查询参数这种最容易写乱的地方收拾干净。

## DTO 是什么

DTO（Data Transfer Object）就是「接口收什么、回什么」的形状定义。在 Nest 里它承担三件事：

1. 给处理函数参数一个 TypeScript 类型
2. 运行时校验和转换输入
3. （可选）生成 OpenAPI 文档

传统写法用类加装饰器，一个类同时满足三件事；schema 写法用 zod 这类库，形状写一次，类型从 schema 推出来。

## 路线一：class-validator

这是 Nest 官方文档长期以来的默认路线：

```ts
import { IsInt, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class CreateExpenseDto {
  @IsString()
  expenseDate!: string;

  @IsInt()
  amountCents!: number;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsString()
  @MaxLength(100)
  title!: string;
}
```

```ts
// main.ts
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

// 控制器
@Post()
create(@Body() body: CreateExpenseDto) { /* ... */ }
```

`ValidationPipe` 靠 `design:paramtypes` 知道参数类型是 `CreateExpenseDto`，用 class-transformer 把普通对象变成类实例，再跑 class-validator。

它的问题在于**同一个形状要写好几遍**：类的属性类型写一遍，装饰器又写一遍（`amountCents: number` 加 `@IsInt()`），前端要用同一个形状时还得再写一份。而且 `!` 断言、`@IsOptional()` 与 `?` 必须手动保持一致，写错了编译器不管。class-validator 和 class-transformer 在 `@nestjs/common` 里一直是可选的对等依赖（v11 就是如此，不是 v12 才改的），不用 `ValidationPipe` 就不必装。v12 的迁移指南也明确说这条装饰器路线继续完整支持、没有移除计划；它给 `ValidationPipe` 新加了 `errorFormat` 选项（`'list'` 或 `'grouped'`），用来选校验失败时的回包形状。

## 路线二：schema 校验

用 zod 写同一个形状：

```ts
import { z } from "zod";

export const CreateExpense = z.object({
  expenseDate: z.string(),
  amountCents: z.number().int(),
  categoryId: z.uuid().nullable(),
  title: z.string().max(100),
});

export type CreateExpenseInput = z.infer<typeof CreateExpense>;
```

形状只写一处，类型是推出来的，不可能对不上。schema 是普通的值，可以放进 monorepo 的共享包，前后端用同一份。

| | class-validator | zod 等 schema 库 |
|---|---|---|
| 形状写几遍 | 类型 + 装饰器 | 一遍 |
| 前后端共用 | 难（装饰器依赖 reflect-metadata） | 容易 |
| 复杂规则（跨字段、联合类型） | 需要自定义装饰器 | `refine`、`discriminatedUnion` 原生支持 |
| 依赖 `emitDecoratorMetadata` | 是 | 否 |
| OpenAPI 生成 | 成熟 | NestJS 12 起官方支持 |

### NestJS 12：Standard Schema 原生支持

> [!WARNING]
> 本节的 `schema` 选项、`StandardSchemaValidationPipe` 的选项和默认值、`StandardSchemaSerializerInterceptor`，按 2026 年 11 月的 NestJS 官方文档 Validation 页面、v12.0.0 发布说明和迁移指南整理；hatch-counter 本身没有用这套 API，没在真实项目里跑过。以 NestJS 官方文档为准。

Standard Schema 是 zod、Valibot、ArkType 等库共同实现的一个接口规范，框架只要认这个接口，就能接受任何一家的 schema。NestJS 12 在路由参数装饰器上加了 `schema` 选项：

```ts
import { Body, Controller, Get, Param, Post, StandardSchemaValidationPipe } from "@nestjs/common";
import { z } from "zod";

// main.ts：全局注册。它只校验声明了 schema 的参数，所以可以和 ValidationPipe 并存
app.useGlobalPipes(new StandardSchemaValidationPipe());

@Controller("v1/expenses")
export class ExpensesController {
  @Post()
  create(@Body({ schema: CreateExpense }) body: CreateExpenseInput) { /* ... */ }

  @Get(":id")
  get(@Param("id", { schema: z.uuid() }) id: string) { /* ... */ }
}
```

`schema` 选项支持 `@Body()`、`@Query()`、`@Param()`、`@RawBody()`，网关的 `@MessageBody()` 和微服务的 `@Payload()` 也能用；可以校验整个对象，也可以只校验某个属性（`@Body("email", { schema: z.email() })`）。注意只在装饰器上写 `schema` 不会生效，**必须注册 `StandardSchemaValidationPipe`** 才会真的校验。它的选项：

| 选项 | 默认 | 作用 |
|---|---|---|
| `transform` | `true` | 处理函数拿到 schema 的输出（经过默认值、转换之后的值）；关掉则校验通过后给原始输入 |
| `exceptionFactory` | 无 | 收到问题列表，返回要抛的异常，用来换成自己的异常类型和文案格式 |
| `errorHttpStatusCode` | `400` | 校验失败的状态码 |
| `validateCustomDecorators` | `false` | 是否也校验 `createParamDecorator()` 做出来的参数装饰器 |
| `validateOptions` | 无 | 原样传给 schema 的 `~standard.validate()` |

两个管道可以同时注册：`ValidationPipe` 只管类型是类的参数，`StandardSchemaValidationPipe` 只管声明了 `schema` 的参数，互不干扰，老项目可以逐个接口迁。同一份 schema 还能喂给 OpenAPI 生成；响应方向用 `StandardSchemaSerializerInterceptor` 配合 `@SerializeOptions({ schema })`，按 schema 校验并整形回包，替代 class-transformer 的那套装饰器。

### hatch-counter 的做法：自己的 ZodPipe

hatch-counter 在 Nest 原生支持之前就选了 zod，自己写了一个十几行的管道（上一章贴过），再包两个小函数：

```ts
export const zBody = <T>(schema: ZodType<T>) => new ZodPipe(schema);
export const zQuery = <T>(schema: ZodType<T>) => new ZodPipe(schema);
```

控制器里这样用：

```ts
@Perm("expenses", "edit")
@Post()
create(@StoreId() storeId: string, @Body(zBody(Create)) body: z.infer<typeof Create>) {
  return this.expenses.create(storeId, body);
}
```

管道的注释写明了选型理由：形状只写一处，类型直接从 schema 推出来，不必再写一遍装饰器版的同一个形状。如果今天新起一个 NestJS 12 项目，直接用原生的 `@Body({ schema })` 就好，效果相同，少维护一个文件。已有项目则没有迁移的必要。

## 校验失败时说什么

zod 默认的错误信息是英文，形如 `Expected number, received string`。如果这句话会原样到达用户眼前，就得处理。hatch-counter 在启动时一行搞定默认语言：

```ts
// main.ts，bootstrap 第一行
z.config(z.locales.zhCN());
```

注释里说得很直接：五百多个字段里绝大多数没写自己的文案，回的是 zod 默认文案，它会原样穿到店主眼前。然后管道只取第一条错误，带上字段路径：

```ts
export function zodMessage(err: ZodError): string {
  const first = err.issues[0];
  const where = first.path.length ? `${first.path.join(".")}：` : "";
  return `${where}${first.message}`;
}
```

只回第一条，是因为面向的是普通用户：一次说一件事，改完再说下一件。如果你的客户端是表单、需要逐字段标红，就回整个 `issues` 数组，让 `exceptionFactory` 组成 `{ path, message }[]`。

真正重要的字段自己写文案：

```ts
export const qDay = z.string().refine(isValidDateStr, "日期要写成 2026-09-01 这样，而且得是真有的一天");
```

## 查询参数：最容易写乱的地方

请求体是 JSON，有数字、布尔、null；查询参数**全是字符串**，而且「没写」「写了空串」「写了不认识的值」都很常见。hatch-counter 的文档记录了以前三种写法并存的状况：按名字取再 `Number(x) || 默认`、直接 `.parse()`（抛的不是 HttpException，填错一个日子回 500）、走管道。同一个日子在三处有三种下场。

现在的规矩是：**查询参数一律整个对象过 schema**，`@Query(zQuery(Schema)) q`，不按名字一个个取。常用的零件集中在 `common/query.ts`：

```ts
/** 地址里 ?x= 跟没写一样：表单清空的筛选会带着空串来 */
const blank = (v: unknown) => (v === "" ? undefined : v);

export const qOptDay = z.preprocess(blank, qDay.optional());

/** 整数。填得不像数、没写都按 undefined，由调用处给默认值 */
export const qInt = z.preprocess(blank, z.coerce.number().int().optional()).catch(undefined);

/** 开关：1 / true 算开，别的（含没写）都算关 */
export const qFlag = z.preprocess(blank, z.string().optional()).transform((v) => v === "1" || v === "true");

/** 一段日子。前后反了报错，不悄悄对调 */
export const qRange = z
  .object({ from: qDay, to: qDay })
  .refine((r) => r.from <= r.to, "日子前后反了：开始那天要在结束那天前面");
```

用起来：

```ts
const List$ = z.object({
  from: qOptDay,
  to: qOptDay,
  status: qPick(z.enum(["confirmed", "pending", "skipped"])),
  unpaid: qFlag,
  page: qInt,
  pageSize: qInt,
});

@Get()
list(@StoreId() storeId: string, @Query(zQuery(List$)) q: z.output<typeof List$>) {
  return this.expenses.list(storeId, { ...q, page: q.page ?? 1 });
}
```

几个值得借鉴的决定：

- **空串当没给**：表单清空的筛选会带着 `?status=` 来
- **日子要真有那一天**：只过正则的 `2026-02-30` 会一路带进 SQL 才炸
- **前后反了报错，不悄悄对调**：对调会把手滑点反的那一下藏起来，看到的数和挑的对不上
- **只认几个值的筛选，不认得的当没给**（`qPick` 内部用 `.catch(undefined)`）：老客户端可能带着服务端已经撤掉的取值来，拒了整页就打不开。这是向后兼容和严格校验之间的取舍：筛选条件宽松，写入的数据严格

### `z.infer` 和 `z.output`

注意上面用的是 `z.output<typeof List$>`。带 `preprocess`、`transform`、`default` 的 schema，输入类型和输出类型不同：`qFlag` 输入是 `string | undefined`，输出是 `boolean`。管道返回的是解析后的值，所以参数类型应该是 output。`z.infer` 等同于 `z.output`，写 `z.output` 意图更清楚；需要输入类型（比如给前端用）时取 `z.input`。

## 多余字段与批量赋值

一个容易忽视的风险：客户端在请求体里多塞一个字段，比如 `{ title: "买菜", storeId: "别人家的店" }`，如果服务端把整个 body 展开写进数据库，就可能改到不该改的列。这叫**批量赋值**（mass assignment）。

| 库 | 默认行为 | 严格模式 |
|---|---|---|
| zod `z.object()` | 剥掉未声明的字段 | `z.strictObject()` 遇到多余字段报错 |
| class-validator | 保留 | `whitelist: true` 剥掉，`forbidNonWhitelisted: true` 报错 |

zod 的默认行为已经是安全的。更根本的防线是：**写数据库时显式列出要写的列**，别 `insert(table).values({ ...body })`。hatch-counter 的门店 id 从来不从请求体取，而是由 `@StoreId()` 从调用者身份里算出来，再由数据库的行级安全兜底。

## 请求体大小

校验之前还有一道关：请求体多大。express 默认 100KB，hatch-counter 拍照上传一张单据 base64 后 0.5–1.2MB、一个月收银报表 1–2MB，所以设成了 12MB，并在注释里写明按这两个数留了约四倍余量。上限要和反向代理一起配，nginx 的 `client_max_body_size` 默认才 1MB，不改的话会出现「小图过得去、大图过不去」这种最难查的症状。

## 复杂结构：判别联合

导入数据时，表里一个分类名可能映射到已有分类，也可能新建一个。用判别联合表达「二选一、各带不同字段」：

```ts
const CategoryResolution = z.discriminatedUnion("action", [
  z.object({ name: z.string(), action: z.literal("map"), categoryId: z.uuid() }),
  z.object({ name: z.string(), action: z.literal("create"), costGroup }),
]);
```

推出的类型在 `action === "map"` 分支里自动有 `categoryId`，处理函数里不需要再手工判空。数组字段记得加上限（`.max(20000)`），防止一个请求塞进上百万个元素拖垮服务端。

## 本章要点

- TypeScript 类型不做运行时检查，入口校验是把不可信输入变成有类型数据的唯一一道关
- class-validator 要把形状写两遍；schema 库（zod 等）写一遍、类型推出来、前后端可共用
- NestJS 12 原生支持 Standard Schema：`@Body({ schema })` 加全局 `StandardSchemaValidationPipe`；已有自定义 zod 管道的项目不必迁移
- 校验文案要面向读者：zod 可全局切中文，关键字段写自己的文案
- 查询参数全是字符串，一律整个对象过 schema；空串当没给、日子要真有、反了报错不对调、不认识的筛选值当没给
- 带转换的 schema 用 `z.output` 标参数类型
- 防批量赋值：schema 剥掉多余字段，写库时显式列出列，身份相关的 id 永远不从请求体取
