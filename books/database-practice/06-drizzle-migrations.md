# Drizzle 与迁移

前五章讲的是数据库本身，这一章回到每天写的代码：用 Drizzle 定义表结构、写查询，用 drizzle-kit 生成迁移。ORM 的用法文档里都有，这里关心的是那些文档不太强调、却会在生产上出事的地方：迁移是怎么被记账和执行的，哪些操作会锁表，哪些东西 Drizzle 根本不知道。

版本以 hatch-counter 当前用的为准：`drizzle-orm` 0.45、`drizzle-kit` 0.31、驱动 `postgres`（postgres.js）3.4。Drizzle 迭代很快，API 细节以对应版本的官方文档为准。

## schema 即代码

Drizzle 的表结构写在 TypeScript 里，同时是三样东西：查询构造器的类型来源、drizzle-kit 生成迁移的依据、团队（和 agent）阅读表结构的文档。

```ts
import { sql } from "drizzle-orm";
import { date, doublePrecision, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** 每张业务表都带的三列。没有 deleted_at：业务行一律硬删 */
const storeCols = () => ({
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const salesRecords = pgTable(
  "sales_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleDate: date("sale_date").notNull(),
    itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    quantity: doublePrecision("quantity").notNull(),
    amountCents: integer("amount_cents").notNull(),
    /** 当天 0 点起的分钟数，不是时刻 */
    orderMin: integer("order_min"),
    ...storeCols(),
  },
  (t) => [
    index("sales_date_idx").on(t.storeId, t.saleDate),
    index("sales_item_date_idx").on(t.itemId, t.saleDate),
  ],
);

export type SaleRow = typeof salesRecords.$inferSelect;   // 查出来的行
export type NewSale = typeof salesRecords.$inferInsert;   // 插入时要给的字段
```

这是 hatch-counter `schema.ts` 的简化版。几个值得学的习惯：

- **公共列用函数展开**（`storeCols()`），新表不会漏掉 `store_id` 或时间戳
- **列的口径写在注释里**。「分钟数不是时刻」「数量为什么用 double」这种信息，写在 schema 旁边，比写在任何别的地方都更容易被看到
- **索引在 schema 里定义**，和第 2 章的分析一一对应：每个索引服务哪类查询，一眼能看出来
- **`$inferSelect` / `$inferInsert` 派生类型**，不要手写一份接口再去同步

要注意 `jsonb("permissions").$type<Record<string, string>>()` 里的 `$type` **只是 TypeScript 类型**，库里不做任何校验。jsonb 的内容需要在写入前用 zod 之类的工具校验（第 9 章）。

## 查询：构造器与 sql 模板

Drizzle 的查询构造器贴近 SQL，生成的语句基本可以预期：

```ts
const rows = await tx
  .select({ itemId: salesRecords.itemId, total: sql<number>`sum(${salesRecords.amountCents})::int` })
  .from(salesRecords)
  .where(and(eq(salesRecords.storeId, storeId), gte(salesRecords.saleDate, from), lt(salesRecords.saleDate, to)))
  .groupBy(salesRecords.itemId);
```

复杂的分析查询（窗口函数、CTE、区间聚合）直接用 `sql` 模板写更清楚。模板里的 `${}` 会变成参数，不会拼接字符串，所以是防注入的：

```ts
const result = await tx.execute(sql`
  select sale_date, sum(amount_cents) as total,
         sum(sum(amount_cents)) over (order by sale_date) as running
  from sales_records
  where sale_date >= ${from} and sale_date < ${to}
  group by sale_date order by sale_date
`);
```

真正危险的是 `sql.raw()` 和驱动的 `unsafe()`，它们原样拼接。只在标识符来自代码常量时用，绝不接用户输入。

### 类型的边界

手写 SQL 时，返回值的类型由驱动决定，`sql<number>` 只是你的声明：

- `sum()`、`count()` 在 PostgreSQL 里返回 `bigint` / `numeric`，postgres.js 按**字符串**交回来，因为 JS 的 number 装不下所有 64 位整数。hatch-counter 用一个 `num()` 辅助函数统一转换，或者在 SQL 里 `::int` 显式转换（确定不会溢出时）
- `date` 列默认会被一些驱动转成 JS `Date`，在时区边界上挪一天。hatch-counter 在 `postgres()` 的 `types` 配置里把 `date` 钉成原样字符串，Drizzle 的 `date()` 列默认也是按字符串读写

把这些规则写进项目的「存储约定」，比每次靠记忆可靠。

## drizzle-kit：generate 与 push

| 命令 | 做什么 | 用在哪 |
|---|---|---|
| `drizzle-kit generate` | 对比 schema 和上一次的快照，生成一份 SQL 迁移文件 | 所有要上生产的改动 |
| `drizzle-kit generate --custom` | 生成一份空的迁移，自己写 SQL | Drizzle 表达不了的改动 |
| `drizzle-kit migrate`，或代码里调 `migrate()` | 执行还没跑过的迁移 | 部署时 |
| `drizzle-kit push` | 直接把 schema 同步到库，不留迁移文件 | 只在原型阶段、可随时重建的库上 |

`push` 很方便，但它不留记录、可能为了「同步」删列，**绝不对有真实数据的库用**。从第一个生产版本开始，就只走 generate + migrate。

hatch-counter 的 `drizzle.config.ts`：

```ts
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // 后台的表在单独的 admin schema 里。不列上这个名字，
  // drizzle-kit 只看 public，会把那几张表当成「要删掉的」
  schemaFilter: ["public", "admin"],
  strict: true,
  verbose: true,
});
```

`schemaFilter` 那条注释是踩过的坑：drizzle-kit 默认只看 `public`，其他 schema 里的表在它眼里是「schema 里没定义的表」，生成的迁移会试图删掉它们。`strict: true` 让 `push` 在执行每条语句前都要求确认，算是给误用 `push` 加了一道闸。

## 迁移是怎么记账的

`drizzle/` 目录下有两样东西：

- `NNNN_名字.sql`：要执行的 SQL，语句之间用 `--> statement-breakpoint` 分隔
- `meta/`：每份迁移对应的 schema 快照 `NNNN_snapshot.json`，以及账本 `_journal.json`

账本里每一条记录了序号、标签和一个时间戳 `when`：

```json
{ "idx": 2, "version": "7", "when": 1793439667448, "tag": "0002_admin_login_failures", "breakpoints": true }
```

执行迁移时，Drizzle 的迁移器（以 0.45 的 PostgreSQL 实现为例）做的事情是：

1. 确保 `drizzle` schema 下有一张 `__drizzle_migrations` 表（`id`、`hash`、`created_at`）
2. 读出这张表里 `created_at` 最大的那一条
3. 按账本顺序遍历迁移，**凡是 `when` 大于那个值的**，就执行，并插入一条记录
4. 第 3 步全部包在**同一个事务**里

```mermaid
flowchart TD
  A["读 _journal.json"] --> B["查 __drizzle_migrations 里最大的 created_at"]
  B --> C{"这份迁移的 when 更大？"}
  C -- 是 --> D["执行 SQL，插入一条记录"]
  C -- 否 --> E["跳过"]
  D --> F{"还有下一份？"}
  E --> F
  F -- 是 --> C
  F -- 否 --> G["提交整个事务"]
```

从这个机制能推出几条规则：

- **判断「跑没跑过」靠时间戳，不靠文件名或哈希**。改一份已经跑过的迁移文件，库不会再跑它；手工往账本里塞一条时间戳更小的记录，它会被永远跳过
- **待跑的迁移在一个事务里**：一份失败，这一批全部回滚，库停在上一个版本，这是好事
- 但这也意味着**不能在迁移里执行不能放进事务的语句**，比如 `CREATE INDEX CONCURRENTLY`（下文）

hatch-counter 利用这个机制做过一次「基线重置」：把之前四十多份迁移压成两份基线，基线在账本里的 `when` 设成和旧链最后一份相同。于是空库会从基线建起；已经跑完旧链的库，最大 `created_at` 不小于基线的 `when`，基线被当作已经跑过。理解了记账方式，这种操作就不神秘了，但也要清楚它的前提：停在旧链半路的库接不上。

## Drizzle 不知道的东西

schema.ts 不是库的全部。hatch-counter 的文档专门列了一份「只写在手写迁移里」的清单：

- 行级安全的启用和策略
- 触发器和函数（版本号、变更流水、回收站）
- 数据库角色和 `GRANT` / `REVOKE`
- 种子数据，比如单行配置表的那一行

做法是：先 `generate` 出建表的部分，再在同一份文件末尾追加手写段落，每段前面用醒目的注释隔开并写明原因：

```sql
CREATE TABLE "expense_images" ( ... );
--> statement-breakpoint
-- ─── 手写：RLS，多租户隔离只靠它 ───
ALTER TABLE "expense_images" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "expense_images_tenant" ON "expense_images"
  USING (store_id = nullif(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = nullif(current_setting('app.store_id', true), '')::uuid);
```

整份都是手写的（删触发器、改函数），用 `generate --custom --name <名字>` 生成空文件再写，这样快照和账本会一起生成，快照链不会断。**不要手工编辑 `_journal.json`**：快照链一断，下一次 `generate` 就会卡在一个需要终端交互的提问上。

改一个已经上线的函数或触发器，新建一份迁移写 `CREATE OR REPLACE`，不要回头改旧文件——跑过的库不会再跑它。

既然 Drizzle 不知道这些东西，就要用测试守住。hatch-counter 有一个测试扫描 `public` 下每张带 `store_id` 的表，检查它是否开了 RLS、是否挂着名为 `<表>_tenant` 的策略；漏了就红。新增表忘了写策略，跑起来一个错都不报，只有测试能发现。

## 安全的迁移

### 只能往前，要能在有数据的库上跑通

开发库是空的或者只有几行假数据，生产库有真实数据。典型的翻车：

- 给已有数据的表加 `NOT NULL` 列且没有默认值：直接失败
- 加唯一约束，但历史数据里已经有重复：直接失败
- 改列类型，有的值转不过去：直接失败

在本地用一份接近生产的数据（脱敏的导出或者种子脚本生成的大量数据）跑一遍迁移，是最便宜的保险。hatch-counter 的测试每次都从迁移现建模板库，新迁移一定会被跑到。

### 扩展与收缩

改名、拆列、换类型这类**不兼容**的改动，不要一步做完，而是分成几次发布：

```mermaid
flowchart LR
  A["扩展：加新列，新旧都写"] --> B["回填：分批把老数据搬到新列"]
  B --> C["切换：代码只读新列"]
  C --> D["收缩：删旧列"]
```

原因是部署期间新旧两个版本的代码可能同时在跑，或者新版本出问题要回滚。每一步都要让「上一版代码」仍然能正常工作。hatch-counter 的数据模型文档里有两处「这一列代码不读不写，下一次删列时一起删」，就是收缩那一步攒着等批量做。

一人公司停机维护的成本往往可以接受，不是每个改动都必须零停机。但「先加后删」的习惯成本很低，值得保持。

### 哪些操作会锁表

| 操作 | 锁 | 大表上的后果 |
|---|---|---|
| 加列，默认值为常量（PG 11+） | 短暂排他锁 | 只改元数据，毫秒级 |
| 加列，默认值为 `random()` 等易变函数 | 排他锁 | 重写整表（第 5 章实测 100 万行 3 秒） |
| 改列类型（大多数情况） | 排他锁 | 重写整表和索引 |
| `SET NOT NULL` | 排他锁 | 扫全表验证 |
| `CREATE INDEX` | 阻塞写入 | 建索引期间所有写入排队 |
| `CREATE INDEX CONCURRENTLY` | 不阻塞写入 | 慢一些，但**不能在事务里执行** |
| 加外键 / CHECK | 默认要扫全表验证 | 可以先 `NOT VALID` 再 `VALIDATE` 分两步 |

另一个隐患是**锁排队**：迁移的 `ALTER TABLE` 要等表上正在运行的长查询结束才能拿到排他锁，而在它排队期间，后来的所有查询都排在它后面。迁移里设一个 `SET lock_timeout = '5s'`，拿不到锁就失败重来，比卡住整个服务好。线上锁等待怎么观察，见[《PostgreSQL 运维》](../database-ops/)。

### CONCURRENTLY 与迁移事务

Drizzle 把待跑的迁移包在一个事务里，而 `CREATE INDEX CONCURRENTLY` 不能在事务中执行：

```text
ERROR:  CREATE INDEX CONCURRENTLY cannot run inside a transaction block
```

所以：

- 表不大（几十万行以内），直接 `CREATE INDEX`，几秒钟的写阻塞可以接受
- 表很大，在迁移之外手动执行 `CREATE INDEX CONCURRENTLY IF NOT EXISTS ...`，再发一份迁移用 `IF NOT EXISTS` 把它补进账本，让 schema 和快照保持一致

### 枚举值：加了不能马上用

PostgreSQL 12 起，`ALTER TYPE ... ADD VALUE` 可以在事务里执行，但新值在提交前不能使用：

```text
ERROR:  unsafe use of new value "c" of enum type kind
HINT:  New enum values must be committed before they can be used.
```

因为待跑的迁移在同一个事务里，「一份迁移加枚举值、下一份迁移用它」在本地分两次跑时没问题，上线时一起跑就会失败。hatch-counter 的规矩是干脆避开：要分种类又不想加枚举值，就用另一列区分。另外，枚举值只能加不能删，这也是很多项目宁可用 `text` + `CHECK` 的原因。

## 一份迁移的完整流程

1. 改 `schema.ts`
2. `drizzle-kit generate --name 有意义的名字`，打开生成的 SQL 逐行看
3. Drizzle 写不出来的部分（RLS、触发器、授权、回填），追加到同一份文件末尾，注释写清原因
4. 在开发库上执行迁移，跑全部测试
5. 对照上面的锁表格检查：这份迁移在生产数据量下会锁多久？
6. 迁移和代码一起提交；部署时先迁移，再起新代码（扩展型迁移对旧代码无害）

两个容易踩的坑：一份 diff 里不要同时删一张表又建一张，drizzle-kit 会问「是不是改名」，这个提问要终端，CI 或 agent 环境里会直接卡住；改了一份还没提交但已经灌进开发库的迁移，开发库要重置重来，否则改动永远不会生效。

## 本章要点

- schema.ts 是类型、迁移依据和文档三合一：公共列用函数展开，口径写在注释里
- `sql` 模板是参数化的；`sql.raw` 才危险。手写 SQL 的返回类型由驱动决定，`bigint` 是字符串
- 生产只用 generate + migrate，不用 push；多 schema 要配 `schemaFilter`
- Drizzle 按账本里的时间戳判断迁移跑没跑过，待跑的迁移在一个事务里执行
- RLS、触发器、授权、种子数据 Drizzle 不知道，手写在迁移里并用测试守住
- 不兼容的改动用扩展—回填—切换—收缩；注意哪些 DDL 会锁表、重写表
- `CREATE INDEX CONCURRENTLY` 进不了迁移事务；新枚举值提交前不能用
