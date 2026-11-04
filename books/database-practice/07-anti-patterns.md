# 常见反模式

前面几章是原理，这一章是错题本。下面这些写法在数据量小的时候都能跑，测试也都能过，等数据长大、并发上来、或者某个边界条件出现时才出问题。每一条都给出症状、原因和改法；能实测的给出了实测结果。

## 查询类

### N+1 查询

症状：列表页随着数据增长越来越慢，日志里同一条 SQL 刷屏，只是参数不同。

```ts
// 反例：先查出 40 道菜，再对每道菜查一次销量
const items = await tx.select().from(itemsTable);
for (const item of items) {
  item.sold = await tx
    .select({ n: sql<number>`sum(${salesRecords.quantity})` })
    .from(salesRecords)
    .where(eq(salesRecords.itemId, item.id));
}
```

40 道菜是 41 次往返。每次查询本身只要零点几毫秒，但每次往返都有网络和协议开销，应用和数据库不在同一台机器时尤其明显。

改法是让数据库一次做完：

```ts
const rows = await tx
  .select({
    id: itemsTable.id,
    name: itemsTable.name,
    sold: sql<number>`coalesce(sum(${salesRecords.quantity}), 0)`,
  })
  .from(itemsTable)
  .leftJoin(salesRecords, eq(salesRecords.itemId, itemsTable.id))
  .groupBy(itemsTable.id, itemsTable.name);
```

不方便连接时，至少改成「一次查出所有 id 对应的数据」：`where(inArray(salesRecords.itemId, ids))`，然后在内存里按 id 分组。Drizzle 的关系查询（`db.query.xxx.findMany({ with: { ... } })`）会生成单条带子查询的 SQL，也能避免 N+1。

GraphQL 和组件各自取数的前端架构特别容易写出 N+1，DataLoader 这类批处理工具就是为它而生的。

### OFFSET 深分页

症状：前几页很快，翻到后面越来越慢。

```sql
select id from sales_records where store_id = $1
order by sale_date desc, id desc
limit 20 offset 15000;
```

`OFFSET 15000` 的意思是「算出前 15020 行，扔掉前 15000 行」。实测这家店两万行，计划里排序节点处理了 15020 行，耗时 24.6 ms；而第一页不到 1 ms。数据越多、页码越深，越慢。

改法是**键集分页**（keyset / cursor pagination）：记住上一页最后一行的排序键，下一页从它之后开始。

```sql
create index sales_page_idx on sales_records (store_id, sale_date, id);

select id, sale_date from sales_records
where store_id = $1 and (sale_date, id) < ($2, $3)   -- 上一页最后一行
order by sale_date desc, id desc
limit 20;
```

```text
 Limit (actual rows=20 loops=1)
   ->  Index Only Scan Backward using sales_page_idx on sales_records (actual rows=20 loops=1)
         Index Cond: ((store_id = '906f...'::uuid) AND (ROW(sale_date, id) < ROW('2025-06-01'::date, 'ffffffff-...'::uuid)))
 Execution Time: 0.070 ms
```

只读 20 行，不管翻到第几页都一样快。要点：

- 排序键必须**唯一**，所以在 `sale_date` 后面补上 `id` 作为决胜列，否则同一天的行会在翻页时重复或遗漏
- 用行比较 `(a, b) < (x, y)`，它能直接作为索引条件
- 代价是不能「跳到第 37 页」。对信息流、流水列表、无限滚动，这本来就不需要

### 对列做运算或类型不匹配

第 2 章实测过：`to_char(sale_date, 'YYYY-MM') = '2026-03'` 让索引只能定位到店，然后过滤掉 18919 行。同类的写法还有：

| 反例 | 改法 |
|---|---|
| `where date(created_at) = '2026-03-01'` | `where created_at >= '2026-03-01' and created_at < '2026-03-02'` |
| `where amount_cents / 100 > 50` | `where amount_cents > 5000` |
| `where lower(name) = 'abc'` | 建表达式索引 `on (lower(name))`，或用 `citext` 类型 |
| `where uuid_col = '...'::text` 之类的类型不一致 | 参数用和列一样的类型 |

### NOT IN 遇上 NULL

找「从没卖过的菜」：

```sql
select count(*) from items where id not in (select item_id from sales_records);
```

如果子查询结果里有一个 `NULL`，这条查询会**永远返回 0 行**。原因在 SQL 的三值逻辑：

```sql
select 1 where 1 not in (2, null);   -- 0 行
select 1 where 1 not in (2, 3);      -- 1 行
```

`1 not in (2, null)` 等价于 `1 <> 2 and 1 <> null`，后者结果是「未知」，整体就是未知，不算真。`sales_records.item_id` 是 `NOT NULL` 的所以这里碰巧没事，但只要子查询的列可空（比如 `parent_record_id`），就会悄无声息地出错。一律改用 `NOT EXISTS`：

```sql
select count(*) from items i
where not exists (select 1 from sales_records s where s.item_id = i.id);
```

它语义正确，而且优化器能把它变成反连接，通常更快。

### SELECT * 和不加 LIMIT

`select *` 的问题不只是多传几列：

- 有一列存了大段文本或 jsonb，每次列表查询都要把它读出来、传过来
- 用不上仅索引扫描
- 表加了列，前端突然多出一个字段，甚至把不该暴露的列（比如 `token_hash`）带了出去

列表接口只查需要的列；任何可能返回很多行的接口都要有上限。hatch-counter 的分页一律经过同一个函数，每页条数夹在 1 到 500 之间，客户端传多大都不会一次拖出整张表。

### 在大表上 count(*)

「共 12,345 条」看起来无害，但 PostgreSQL 的 `count(*)` 必须真的数一遍（MVCC 下每个事务看到的行数可能不同，没有一个现成的总数可用）。大表的精确计数可能比查询数据本身还慢。

替代方案：只显示「还有更多」；或者用 `pg_class.reltuples` 拿估算值；或者限定范围后再计数（某店某月）。

## 建模类

### 应用层手写租户过滤

每条查询都写 `where store_id = ?`，看起来没问题，直到有一条漏了。后果是「A 店看见了 B 店的账」，而且不报任何错，测试也照样绿。

hatch-counter 的选择是只靠 PostgreSQL 的行级安全（RLS）隔离租户：每张带 `store_id` 的表一条策略，业务查询本身一条 `where store_id` 都不写，全在设好上下文的事务里执行。

```sql
alter table sales_records enable row level security;
create policy sales_records_tenant on sales_records
  using (store_id = nullif(current_setting('app.store_id', true), '')::uuid)
  with check (store_id = nullif(current_setting('app.store_id', true), '')::uuid);
```

这条策略里每个细节都有讲究：

- **上下文必须用 `SET LOCAL`（`set_config(..., true)`）**。连接是池化的，会话级的 `SET` 会留在连接上被下一个请求捡到，那就是跨租户泄露本身
- **`nullif(..., '')` 不能删**。事务结束后，设置回到的是空字符串而不是 NULL，`''::uuid` 会报错；抹成 NULL 后 `store_id = NULL` 恒为假，没有上下文就一行都看不到
- **应用连接的角色既不能是表的 owner，也不能是超级用户**，这两种默认绕过 RLS。用错了角色，隔离等于没开，同样不报任何错

RLS 不是免费的：策略条件会并进每条查询的计划，所以索引都要以 `store_id` 开头。但它把「漏写一个 where」这类 bug 从「可能发生」变成了「不可能发生」，对一人公司来说非常值。

### 软删除一刀切

给每张表加 `deleted_at`，删除改成更新。代价是：

- **每个读取都要记得过滤** `deleted_at is null`，漏一处就把删掉的数据显示出来
- **唯一约束全部失效**：删掉的「红烧肉」还占着名字，新建同名菜会撞唯一约束，只能改成部分唯一索引
- 外键的级联删除不再起作用，要自己处理子表

hatch-counter 的做法是业务行一律硬删，需要「能找回」的，由触发器在删除时把整行（连同被级联删掉的子行）存进一张回收站表，30 天后清理。原表的读取和约束都保持简单。要「保留历史」的则用状态表达：员工离职是 `status = 'left'`，停用的班次有 `disabled_at`，撤掉的导入批次保留那一行、标为 `reverted`。

选择标准：如果「删除」在业务上是一个状态（离职、停用、作废），用状态列；如果只是想防误删，用回收站或备份，不要污染所有查询。

### EAV：万能的键值表

```sql
create table attributes (entity_id uuid, key text, value text);
```

「这样以后加字段就不用改表了」。代价是失去了类型、约束、外键，查询要写成一串自连接，每个值都是字符串。需要灵活字段时，PostgreSQL 有更好的选择：确实是动态结构就用 jsonb（第 9 章）；结构是确定的，就老老实实加列，迁移的成本没有想象中高。

### 一格里存多个值

`tags = 'a,b,c'` 违反第一范式：没法建索引、没法加外键、改一个标签要做字符串操作。PostgreSQL 里用数组或 jsonb 加 GIN 索引，或者用关联表；SQLite 里用 JSON 数组 + `json_each`（hatch-shelf 的 `tags` 列就是这样，第 8 章）。

### 多态关联

```sql
create table comments (target_type text, target_id uuid, body text);
```

`target_id` 有时指向菜品、有时指向订单，数据库无法为它建外键，删了菜品留下孤儿评论。改法是每种目标一个可空外键列加一条 CHECK「恰好一个非空」，或者每种目标一张关联表。hatch-counter 的开支表就是前者：从单据、补仓、周期规则、工资单来的开支，各挂各的外键。

## 类型类

### 浮点数存钱

`0.1 + 0.2` 在 IEEE 754 里不等于 `0.3`，加上几千笔就会差出一分钱，而对账恰恰对一分钱最敏感。用整数分（`integer` / `bigint`）或 `numeric`。

### 时区：日期挪了一天

服务端跑在 UTC 的容器里，业务在北京时间。下面两种错误都会让日子挪一天：

```sql
set timezone = 'Asia/Shanghai';
select '2026-03-01 07:30+08'::timestamptz::date                         as local_date,  -- 2026-03-01
       ('2026-03-01 07:30+08'::timestamptz at time zone 'UTC')::date     as utc_date;    -- 2026-02-28
```

北京时间早上七点半录的单，按 UTC 折算日期就成了前一天。JS 里也一样：`new Date("2026-03-01")` 被解析成 UTC 零点，在西八区显示成 2 月 28 日。

hatch-counter 的规则可以直接照抄：

- 业务日期存 `date`，进出都是 `YYYY-MM-DD` 字符串，不经过 JS 的 `Date`
- 服务端要「今天」一律调用同一个按 `Asia/Shanghai` 计算的函数
- SQL 里把 `created_at` 折成日期时，显式写 `at time zone` 业务时区，不依赖会话设置
- 时间戳一律 `timestamptz`，不用不带时区的 `timestamp`

## 运行类

### 长事务和在事务里调接口

第 4、5 章讲过：长事务持有锁、阻止 VACUUM、占用连接。最常见的来源是在事务里调用外部服务（识别、短信、支付）。外部调用放在事务外，事务只包数据库读写。

### 把文件存进数据库

几 MB 的图片存进 `bytea` 列，备份变大、复制变慢、每次 `select *` 都在搬图片。hatch-counter 的进货单原图存在对象存储，库里只存键（`image_file`）；整店导出的压缩包也不进库，库里只记生成到哪一步和存储里的位置。

### 用 ORM 生成的迁移不看就上

drizzle-kit 生成的 SQL 有时和你以为的不一样：改名被识别成删列再加列（数据没了）、改类型生成了重写全表的语句。每份迁移都要读一遍，对照第 6 章的锁表格检查。

## 一页清单

| 反模式 | 症状 | 改法 |
|---|---|---|
| N+1 | 同一 SQL 刷屏 | 连接、`inArray` 批量、关系查询 |
| OFFSET 深分页 | 越往后越慢 | 键集分页 + 唯一排序键 |
| 对列做运算 | 索引条件变成 Filter | 改写成范围 |
| `NOT IN` 子查询 | 结果莫名为空 | `NOT EXISTS` |
| 大表 `count(*)` | 总数比数据还慢 | 估算值或「还有更多」 |
| 应用层租户过滤 | 漏一个 where 就泄露 | RLS + `SET LOCAL` + 非 owner 角色 |
| 软删除一刀切 | 处处过滤、唯一约束失效 | 硬删 + 回收站；业务状态用状态列 |
| EAV / 逗号分隔 | 无类型、无索引 | 加列、jsonb、数组、关联表 |
| 浮点存钱 | 差一分钱 | 整数分 |
| 日期经过 JS Date | 挪一天 | `date` 列走字符串，显式业务时区 |
| 事务里调接口 | 连接耗尽、表膨胀 | 外部调用移出事务 |

## 本章要点

- N+1 和深分页是最常见的两个性能坑，改法分别是批量取数和键集分页
- `NOT IN` 遇上 NULL 会静默返回空，统一用 `NOT EXISTS`
- 多租户隔离交给 RLS，注意 `SET LOCAL`、`nullif` 和应用角色三个细节
- 软删除、EAV、多态关联都是用「灵活」换掉了数据库的约束能力，慎用
- 钱用整数分，日期用 `date` 字符串，业务时区显式写出
- 事务里不调外部服务，文件不进数据库，生成的迁移必须人工审

## 动手练习

1. **NOT IN 遇上 NULL**：在 `pg-lab` 里建 `create table items (id int); insert into items values (1), (2), (3); create table refs (item_id int); insert into refs values (1), (null);`，分别执行 `select count(*) from items where id not in (select item_id from refs);` 和 `select count(*) from items i where not exists (select 1 from refs r where r.item_id = i.id);`。

   验证：`NOT IN` 返回 `0`；`NOT EXISTS` 返回 `2`。删掉 `refs` 里的 NULL 行后，`NOT IN` 也返回 `2`。

   参考答案：`2 not in (1, null)` 展开成 `2 <> 1 and 2 <> null`，后半是「未知」，整体不为真，于是每一行都被排除。`NOT EXISTS` 只看有没有匹配的行，不受 NULL 影响。

2. **OFFSET 与键集分页**：用第 2 章练习的 `sales` 表，建 `create index sales_page on sales (store_id, sale_date, id);` 并 `vacuum analyze sales;`。对店 7 分别跑 `explain (analyze, buffers)`：一条 `select id, sale_date from sales where store_id = 7 order by sale_date desc, id desc limit 20 offset 15000`，一条 `select id, sale_date from sales where store_id = 7 and (sale_date, id) < ('2025-06-01', 1000000) order by sale_date desc, id desc limit 20`。

   验证：两条都可能用上 `sales_page`；OFFSET 那条的扫描节点 `actual rows` 是 15020 左右，键集那条只有 20，`Buffers` 和耗时差出一个数量级以上。

   参考答案：`OFFSET` 要先产出前 15020 行再扔掉；行比较 `(sale_date, id) < (...)` 能直接进 `Index Cond`，从上一页最后一行之后开始读。`id` 是决胜列，保证排序键唯一。

3. **RLS 和「谁会绕过它」**：建 `create table notes (store_id text, body text); insert into notes values ('s1', 'a'), ('s2', 'b');`，开 RLS 并加策略 `using (store_id = nullif(current_setting('app.store_id', true), ''))`。先用 `postgres`（超级用户）查 `select count(*) from notes;`；再 `create role app; grant select on notes to app; set role app;` 后查一次；然后 `begin; select set_config('app.store_id', 's1', true); select count(*) from notes; commit;`，提交后再查一次。

   验证：超级用户看到 `2`；`app` 角色没设上下文时 `0`；事务里设了 `s1` 后 `1`；提交后又回到 `0`。

   参考答案：超级用户和表的 owner 默认绕过 RLS，应用必须用另一个角色连接。`set_config(..., true)` 只在当前事务有效，提交后设置变回空字符串，`nullif` 把它抹成 NULL，于是一行都看不到。
