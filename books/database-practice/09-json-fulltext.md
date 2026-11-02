# JSON 与全文检索

关系模型擅长结构确定的数据，但总有一些东西不那么规整：一组按页面的权限开关、用户导入的表格原样、一篇文章的正文。PostgreSQL 和 SQLite 都内置了 JSON 和全文检索的能力，用得好可以省掉一个文档数据库和一个搜索引擎；用得不好，就成了「什么都往 jsonb 里塞」和「LIKE '%关键词%' 扫全表」。这一章讲 jsonb 的边界和索引、中文全文检索的几种方案，案例是 hatch-counter 的 jsonb 列和 hatch-shelf 的 FTS5 搜索。

语义检索（向量、pgvector、混合检索）属于《RAG 与知识系统》的内容，这里只讲基于字面的检索。

## jsonb 什么时候用

hatch-counter 的数据模型文档里有一条规则：**`jsonb` 只放整份读写、从不进 `where` 的东西**。它列出的 jsonb 列有：

- 成员的一组按页面的权限开关
- 报表格式和单据模板的列定义
- 导入表格时的原表格子
- 工资单那一行的逐日排班考勤快照
- 员工档案「改了哪几格」
- 写接口的回执

它们的共同点：结构由应用代码定义、整体读出整体写回、不需要和其他表连接、不需要按里面的字段筛选。「要按它查的，就该是一列或者另一张表。」

| 适合 jsonb | 不适合 jsonb |
|---|---|
| 整份读写的配置、快照 | 要按字段筛选、排序、聚合的数据 |
| 外部来源、结构不受你控制的原始数据 | 要被外键引用的字段 |
| 稀疏的、每行键不一样的属性 | 每行都有的固定字段 |
| 审计记录里的「改动前后」 | 需要约束（唯一、非空、范围）的字段 |

规则之外的情况确实存在：比如权限开关，偶尔要回答「这家店谁有工资权限」。下面看 jsonb 被查询时怎么建索引，但每次想这么做之前，先问一句：它是不是该升格成一列了？

## json 和 jsonb

PostgreSQL 有两种 JSON 类型：

```sql
select '{"b":1, "a":2, "a":3}'::jsonb as jb, '{"b":1, "a":2, "a":3}'::json as j;
```

```text
        jb        |           j
------------------+-----------------------
 {"a": 3, "b": 1} | {"b":1, "a":2, "a":3}
```

`json` 原样存储文本，保留空格、键顺序和重复键；`jsonb` 解析成二进制结构，键排序去重（重复键保留最后一个），读取和查询更快，还支持索引。**几乎总是用 jsonb**，除非你需要逐字保留原文。

## 读写操作

常用操作符：

| 操作 | 写法 | 结果 |
|---|---|---|
| 取值（jsonb） | `permissions -> 'stock'` | `"view"` |
| 取值（文本） | `permissions ->> 'stock'` | `view` |
| 按路径取 | `doc #>> '{a,b,0}'` | 文本 |
| 包含 | `permissions @> '{"payroll":"edit"}'` | 布尔 |
| 有某个键 | `permissions ? 'payroll'` | 布尔 |
| 设置一个键 | `jsonb_set(permissions, '{report}', '"none"')` | 新的 jsonb |
| 合并 | `permissions \|\| '{"report":"view"}'` | 新的 jsonb |
| 删除一个键 | `permissions - 'report'` | 新的 jsonb |

jsonb 没有「原地修改」：`jsonb_set` 和 `||` 都返回一个新值，`UPDATE` 写回去就是一个新的行版本（第 5 章）。一个很大的 jsonb 文档里改一个键，整个文档都会重写一遍，这是「大 jsonb + 频繁局部更新」不划算的原因。

### NULL 的三种样子

```sql
select '{"a":1}'::jsonb -> 'nope' is null            as missing_key,  -- t：键不存在 → SQL NULL
       '{"a":null}'::jsonb -> 'a'                     as json_null,    -- null：JSON 的 null
       ('{"a":null}'::jsonb -> 'a') is null           as sql_null,     -- f：JSON null 不是 SQL NULL
       ('{"a":null}'::jsonb ->> 'a') is null          as text_null;    -- t：->> 把它转成了 SQL NULL
```

`->` 取出的 JSON `null` 不等于 SQL 的 `NULL`，`->>` 才会转换。写条件时用 `->>` 比较文本，或者用 `@>` 包含查询，避免掉进这个坑。

### 给新键补默认值

hatch-counter 的成员权限有一个细节值得一提：将来新加一个页面，老成员那行 jsonb 里没有这个键。代码里读不到时如果当作「可见」，新功能一上线全店都看得见。所以它的规则是缺失的键按 `none` 处理，必要时在迁移里给所有老行补上：

```sql
update store_members
set permissions = permissions || '{"report":"none"}'
where permissions is not null and not permissions ? 'report';
```

jsonb 没有 schema，「缺键时是什么意思」必须由你明确定义。

## 给 jsonb 建索引

用一张 20 万行的成员表实验，每行一个权限对象，约七分之一的人有工资编辑权限。

### GIN 索引：服务包含查询

```sql
create index members_perm_gin on members using gin (permissions jsonb_path_ops);
explain (analyze, costs off, timing off)
select count(*) from members where permissions @> '{"payroll":"edit"}';
```

```text
 Aggregate (actual rows=1 loops=1)
   ->  Bitmap Heap Scan on members (actual rows=28571 loops=1)
         Recheck Cond: (permissions @> '{"payroll": "edit"}'::jsonb)
         ->  Bitmap Index Scan on members_perm_gin (actual rows=28571 loops=1)
               Index Cond: (permissions @> '{"payroll": "edit"}'::jsonb)
```

GIN（倒排索引）把文档拆成一个个「路径 + 值」，记录每个出现在哪些行里。`jsonb_path_ops` 只支持 `@>` 类查询，但比默认的 `jsonb_ops` 更小更快；需要 `?`（有某个键）查询时才用默认的。

### 表达式索引：服务某个固定的键

但同样的意思换个写法，GIN 就用不上了：

```sql
explain (costs off) select count(*) from members where permissions->>'payroll' = 'edit';
```

```text
   ->  Parallel Seq Scan on members
         Filter: ((permissions ->> 'payroll'::text) = 'edit'::text)
```

GIN 只认 `@>`、`?` 这些操作符。如果查询总是针对同一个键，建一个 B 树表达式索引：

```sql
create index members_payroll_idx on members ((permissions->>'payroll'));
```

之后这条查询就会走 `Bitmap Index Scan on members_payroll_idx`。实测两个索引大小：GIN 728 kB，表达式索引 1368 kB（GIN 对重复值的压缩效果好）。

选择：

- 查询的键不固定（用户自定义字段）→ GIN + `@>`
- 总是查同一个键 → 表达式索引；而且这时应该认真考虑把它变成一个普通列，PostgreSQL 的生成列可以做到不改写入代码：

```sql
alter table members add column payroll text
  generated always as (permissions->>'payroll') stored;
```

## 校验：jsonb 没有 schema

Drizzle 的 `jsonb().$type<T>()` 只影响 TypeScript 类型，库里什么都能写进去。校验要在两层做：

**应用层**：写入前用 zod 校验整份结构，这是主要的防线。hatch-counter 的报表格式、单据模板都有对应的 schema。

**数据库层**：用 `CHECK` 兜住最基本的形状，防止脚本或手工 SQL 写坏：

```sql
alter table store_members add constraint permissions_is_object
  check (permissions is null or jsonb_typeof(permissions) = 'object');
```

SQLite 里 JSON 只是 `TEXT`，可以用 `CHECK (json_valid(value))` 保证至少是合法的 JSON（第 8 章演示过）。

## 全文检索：先看需求

「搜索」这个需求可以细分：

| 需求 | 例子 | 合适的工具 |
|---|---|---|
| 前缀匹配 | 输入「红烧」联想菜名 | B 树索引 + `LIKE '红烧%'` |
| 子串匹配 | 菜名里含「牛肉」 | `pg_trgm` / SQLite FTS5 trigram |
| 分词检索 + 相关度排序 | 在文章里搜「索引原理」 | PostgreSQL 全文检索 / FTS5 |
| 拼写纠错、同义词、复杂排序 | 电商搜索 | 外部搜索引擎 |
| 按意思搜 | 「怎么让查询变快」找到讲索引的章节 | 向量检索，见《RAG 与知识系统》 |

## PostgreSQL 全文检索与中文

PostgreSQL 的全文检索把文本转成 `tsvector`（词位列表），把查询转成 `tsquery`，用 `@@` 匹配。英文效果很好：

```sql
select to_tsvector('english', 'The stores were closing early');
```

```text
 'close':4 'earli':5 'store':2
```

它去掉了停用词（the、were），把词还原成词干（stores → store，closing → close），所以搜 `store` 能匹配 `stores`。

但中文没有空格分词：

```sql
select to_tsvector('simple', '红烧牛肉面 加辣');
-- '加辣':2 '红烧牛肉面':1
select to_tsvector('simple', '红烧牛肉面加辣') @@ to_tsquery('simple', '牛肉');
-- f
```

整段连续的汉字被当成了一个词，搜「牛肉」找不到。中文全文检索有两条路：

1. **安装中文分词扩展**，如 zhparser、pg_jieba。它们是第三方扩展，官方镜像里没有，要自己构建镜像；托管数据库是否支持要看各家的扩展列表。分词效果取决于词典，新词、店名、菜名常常分不准
2. **不分词，用 trigram 做子串匹配**。不需要词典，对短文本（名称、标题）效果很好，下一节

对一人公司的大多数场景（搜菜名、搜客户名、搜笔记标题），第二条路更省心。

## pg_trgm：子串匹配

`pg_trgm` 把字符串切成连续三个字符的片段（trigram），建 GIN 索引后，`LIKE '%xxx%'` 和 `ILIKE` 也能走索引：

```sql
create extension if not exists pg_trgm;
create index dishes_name_trgm on dishes using gin (name gin_trgm_ops);
```

在 10 万行菜名上实测：

```sql
explain (analyze, costs off, timing off) select count(*) from dishes where name like '%牛肉面%';
```

```text
 Aggregate (actual rows=1 loops=1)
   ->  Bitmap Heap Scan on dishes (actual rows=4000 loops=1)
         Recheck Cond: (name ~~ '%牛肉面%'::text)
         ->  Bitmap Index Scan on dishes_name_trgm (actual rows=4000 loops=1)
               Index Cond: (name ~~ '%牛肉面%'::text)
 Execution Time: 0.828 ms
```

注意 trigram 对中文是否有效取决于数据库的字符分类设置：这个实验库的 `datctype` 是 `en_US.utf8`，汉字被当作字母处理，能正常切片。用 `C` 区域设置建的库，非 ASCII 字符的处理可能不同，用之前先拿 `show_trgm('牛肉面')` 看一眼有没有切出片段。

**查询少于 3 个字符时 trigram 帮不上忙**。搜两个字的「牛肉」，模式里切不出完整的 trigram，强制走索引时可以看到它把所有行都当成候选：

```text
   ->  Bitmap Heap Scan on dishes (actual rows=20000 loops=1)
         Rows Removed by Index Recheck: 80000
         ->  Bitmap Index Scan on dishes_name_trgm (actual rows=100000 loops=1)
```

索引返回了全部 10 万行，再逐行复核丢掉 8 万行，比直接顺序扫描还慢，所以优化器默认会选顺序扫描。中文里两个字的查询非常常见，这是 trigram 方案必须正视的限制：数据量小时顺序扫描也够快；数据量大时可以对短查询退回前缀匹配，或者额外建一个二元片段（bigram）的索引表。

`pg_trgm` 还能做相似度搜索，适合「大概是这个名字」的模糊匹配，比如核对进货单上手写的食材名：

```sql
select name, similarity(name, '红烧牛肉') from dishes
where name % '红烧牛肉' order by similarity(name, '红烧牛肉') desc limit 3;
```

`%` 操作符筛出相似度超过阈值（默认 0.3）的行。

## SQLite FTS5：hatch-shelf 的搜索

hatch-shelf 的全文搜索用 SQLite 的 FTS5 虚拟表，分词器选 trigram（SQLite 3.34 起提供）：

```sql
CREATE VIRTUAL TABLE search USING fts5(
  book_id UNINDEXED, chapter_file UNINDEXED, anchor UNINDEXED, heading UNINDEXED, body,
  tokenize = 'trigram'
);
```

设计要点：

- **每行一个小节**（按 H1–H3 切分），而不是一行一章。搜索结果能直接跳到小节锚点，片段也更聚焦
- **只有 `body` 被索引**，其他列标为 `UNINDEXED`，只是跟着存储，用于展示和跳转
- **它是可重建的索引**：和 `books`、`chapters` 一起在 `rebuildIndex()` 的事务里整体重建（第 8 章）

实测几个查询：

```sql
SELECT book_id, heading FROM search WHERE search MATCH '"范围查询"' ORDER BY rank;
-- database-practice|索引原理

SELECT book_id, heading, snippet(search, 2, '[', ']', '…', 8) FROM search WHERE search MATCH '"hnsw"';
-- rag-systems|向量检索|…提供 [HNSW] 索引

SELECT highlight(search, 2, '<b>', '</b>') FROM search WHERE search MATCH '"并发控制"';
-- 多版本<b>并发控制</b>让读不阻塞写

SELECT book_id, heading FROM search WHERE search MATCH '"索引"';
-- （空）
```

几点观察：

- `ORDER BY rank` 按 BM25 相关度排序，FTS5 内置
- trigram 分词器默认不区分大小写，`hnsw` 匹配到了 `HNSW`
- `snippet()` 和 `highlight()` 能直接生成带标记的片段（hatch-shelf 实际用自己的 `makeSnippet()` 在应用层生成片段，方便控制长度和标亮样式）
- **两个字的「索引」搜不到**，和 `pg_trgm` 是同一个限制

hatch-shelf 的处理方式写在 `searchBooks()` 里：

```ts
const rows =
  [...q].length >= 3
    ? await db.getAllAsync<Row>(
        `${select} WHERE search MATCH ? ORDER BY rank LIMIT ${LIMIT}`,
        // 整体作为一个短语，避免用户输入被当成 FTS 语法
        `"${q.replace(/"/g, '""')}"`,
      )
    : await db.getAllAsync<Row>(
        `${select} WHERE s.body LIKE ? ESCAPE '\\' ORDER BY b.title, c.idx LIMIT ${LIMIT}`,
        `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`,
      );
```

这段代码有三处细节值得学：

1. **按字符数分流**：3 个字符及以上走 FTS5；更短的退回 `LIKE` 全表扫描。用 `[...q].length` 而不是 `q.length`，因为后者按 UTF-16 码元计数，emoji 这类字符会被算成 2
2. **把用户输入包成短语**：FTS5 的 `MATCH` 有自己的查询语法（`AND`、`OR`、`NEAR`、`*`、列过滤），用户输入的引号、减号可能被当成语法而报错。整体包进双引号、内部的双引号加倍，用户输入就只是一个字面短语
3. **`LIKE` 要转义通配符**：用户搜「100%」时，`%` 不该被当成通配符。用 `ESCAPE '\'` 并把 `\`、`%`、`_` 都转义

个人书库只有几十本书、几千个小节，`LIKE` 全表扫描在手机上也是毫秒级，这个降级完全可以接受。设计文档里把这条取舍写进了决策记录：「不需要中文分词词典；个人书库规模下 LIKE 扫描足够快」。

## 什么时候该上搜索引擎

数据库内置的检索能力在以下情况会不够用：

- 数据量到了千万级文档，还要求毫秒级响应和复杂的相关度调优
- 需要拼写纠错、同义词、拼音搜索、分面统计
- 搜索流量大到影响主库的事务处理

在那之前，PostgreSQL 的 `pg_trgm` + 全文检索、SQLite 的 FTS5，能覆盖一人公司几乎所有的搜索需求，而且没有额外的服务要部署、要同步、要监控。少一个组件，就少一类凌晨三点的告警。

## 本章要点

- jsonb 只放整份读写、不进 `where` 的东西；要按它查，先考虑升格成列
- 用 jsonb 不用 json；注意 JSON `null` 与 SQL `NULL` 的区别，缺失的键要定义语义
- GIN（`jsonb_path_ops`）服务 `@>` 查询，固定键用表达式索引或生成列
- jsonb 没有 schema：应用层用 zod 校验，库里用 `CHECK` 兜底
- 中文全文检索要么装分词扩展，要么用 trigram 做子串匹配；trigram 不支持少于 3 个字符的查询
- FTS5 trigram 是本地搜索的好选择：用户输入包成短语，短查询退回转义过的 `LIKE`

## 接下来读什么

这本书讲的是「一个库」内部的事。接下来：

- 想知道这个库在线上怎么调参、备份、复制、升级，读《PostgreSQL 运维》
- 想知道缓存、队列、幂等、多租户这些跨越数据库边界的设计，读《软件架构与系统设计》
- 想在自己的数据上做语义检索和问答，读《RAG 与知识系统》
