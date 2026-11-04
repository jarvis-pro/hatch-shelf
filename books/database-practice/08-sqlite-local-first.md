# SQLite 与本地优先

SQLite 不是「小号的 PostgreSQL」。它没有服务器进程，整个库就是一个文件，嵌在你的 App 进程里。这让它在手机、桌面、边缘环境里几乎无可替代，也让它的很多行为和 PostgreSQL 不同：类型宽松、外键默认关闭、改表结构能力有限、同一时刻只有一个写者。这一章以 hatch-shelf（Expo 离线书架）为例，讲本地数据库怎么设计、怎么迁移、怎么和「文件」配合，以及本地优先架构要想清楚的几件事。

## SQLite 的形状

| 方面 | PostgreSQL | SQLite |
|---|---|---|
| 部署 | 独立服务器进程，网络连接 | 一个库文件，进程内函数调用 |
| 并发写 | 行级锁，多个写者 | 整库一个写者（WAL 模式下读写可并发） |
| 类型 | 严格 | 类型亲和性，默认很宽松 |
| 外键 | 始终生效 | 每个连接要 `PRAGMA foreign_keys = ON` |
| 改表结构 | 几乎任意 `ALTER TABLE` | 只能加列、改名、删列，其余要重建表 |
| 往返开销 | 每条查询一次网络往返 | 几乎为零，N+1 不那么致命 |

最后一条很有意思：因为查询是进程内的函数调用，在 SQLite 里「一次查一行、查很多次」的成本远低于 PostgreSQL。SQLite 官方文档甚至专门写过「许多小查询在 SQLite 里是高效的」。这不是鼓励写 N+1，但说明在服务端成立的性能直觉，换到本地库要重新评估。

## 先决定：什么是真相

hatch-shelf 的设计文档第一条原则是「**文件即真相**」：

- 书的原文只以文件形式存在 `documentDirectory/books/<id>/`
- SQLite 只存两类东西：**可重建的索引**和**不可丢的用户数据**

| 表 | 内容 | 能否重建 |
|---|---|---|
| `books` | 书名、分类、标签、章数…… | 能，扫描 `books/` 目录即可 |
| `chapters` | 每本书的章节顺序和标题 | 能 |
| `search` | 全文检索索引（FTS5） | 能 |
| `progress` | 每章的阅读位置 | **不能** |
| `settings` | 字号、主题等 | **不能** |
| `highlights` | 高亮和笔记 | **不能** |

这个划分决定了后面所有的设计：

- 索引表坏了、结构变了、逻辑有 bug，**直接清空重建**，不需要为它写数据迁移
- 用户数据表要像服务端的业务表一样谨慎：迁移只能往前，不能丢
- 两类表之间**不加外键**。`progress.book_id` 没有引用 `books(id)`：重建索引时会清空 `books`，如果有外键级联，阅读进度就跟着没了

最后一点值得强调。直觉上 `progress` 应该引用 `books`，但「书被删了再导入回来，阅读进度应该还在」才是正确的产品行为。**外键表达的是生命周期依赖**，而这里两者的生命周期是独立的。

`books.last_read_at` 则是一个从 `progress` 推出来的缓存列：重建索引时用 `(SELECT MAX(updated_at) FROM progress WHERE book_id = ?)` 回填。这是第 1 章「可重算的缓存」的又一个例子。

## 打开数据库：两条 PRAGMA

hatch-shelf 的 `getDb()` 一打开库就执行：

```ts
db = openDatabaseSync(DB_NAME, undefined, Paths.document.uri);
db.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
```

**`journal_mode = WAL`**：默认的回滚日志模式下，写事务会阻塞所有读。WAL 模式把写入追加到 `-wal` 文件，读者看自己开始时的快照（第 5 章），读写互不阻塞。在 App 里，这意味着后台导入一本书时，界面上的书架查询不会卡住。WAL 模式是持久的，设一次就写进了库文件。

**`foreign_keys = ON`**：这一条**每个连接都要设**，SQLite 默认不检查外键。实测：

```sql
PRAGMA foreign_keys;    -- 0
CREATE TABLE books (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL);
CREATE TABLE chapters (book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                       idx INTEGER NOT NULL, PRIMARY KEY (book_id, idx));
INSERT INTO books VALUES ('a', 'A');
INSERT INTO chapters VALUES ('a', 0);
DELETE FROM books WHERE id = 'a';
SELECT count(*) FROM chapters;               -- 1：级联删除没有发生
INSERT INTO chapters VALUES ('ghost', 0);    -- 成功：指向不存在的书
PRAGMA foreign_keys = ON;
INSERT INTO chapters VALUES ('ghost2', 0);   -- Error: FOREIGN KEY constraint failed
```

忘了这一条，`ON DELETE CASCADE` 只是摆设。

## 类型亲和性与 STRICT

SQLite 的列类型只是「建议」：

```sql
CREATE TABLE loose (n INTEGER);
INSERT INTO loose VALUES ('abc'), ('12'), (3.5);
SELECT n, typeof(n) FROM loose;
```

```text
abc|text
12|integer
3.5|real
```

`'abc'` 原样存成了文本，`'12'` 被转成了整数，`3.5` 存成了实数。一列里三种类型。3.37 起可以用 `STRICT` 表要求严格类型：

```sql
CREATE TABLE strict_t (n INTEGER) STRICT;
INSERT INTO strict_t VALUES ('abc');
-- Error: cannot store TEXT value in INTEGER column strict_t.n
```

`STRICT` 表只允许 `INTEGER`、`REAL`、`TEXT`、`BLOB`、`ANY` 这几种类型名。新项目建议用；hatch-shelf 的表建得早，没有用，靠 TypeScript 层的类型和 `@shelf/spec` 的校验兜底。

SQLite 没有日期、布尔、JSON 类型，常见的约定：

| 要存 | hatch-shelf 的做法 |
|---|---|
| 时间戳 | `INTEGER`，毫秒（`Date.now()`），如 `imported_at`、`progress.updated_at` |
| 日期字符串 | `TEXT`，原样存 `YYYY-MM-DD`，如 `books.updated_at` 来自 book.yaml |
| 列表 | `TEXT`，存 JSON 数组，如 `tags`、`warnings`，默认值 `'[]'` |
| 设置值 | `TEXT`，存 JSON，读时 `JSON.parse` |

## 迁移：user_version

SQLite 文件头里有一个整数 `user_version`，留给应用自己用。hatch-shelf 用它记录「迁移执行到第几条」：

```ts
/**
 * 按顺序执行的迁移；user_version 记录已执行到第几条。只能追加，不能修改已发布的条目。
 */
const MIGRATIONS = [
  `CREATE TABLE books (...); CREATE TABLE chapters (...);
   CREATE TABLE progress (...); CREATE TABLE settings (...);`,
  `ALTER TABLE books ADD COLUMN content_hash TEXT;`,
  `CREATE VIRTUAL TABLE search USING fts5(...);`,
  `CREATE TABLE highlights (...); CREATE INDEX highlights_by_chapter ON highlights (book_id, chapter_file);`,
];

const { user_version } = db.getFirstSync<{ user_version: number }>('PRAGMA user_version')!;
for (let v = user_version; v < MIGRATIONS.length; v++) {
  db.withTransactionSync(() => {
    db.execSync(MIGRATIONS[v]);
    db.execSync(`PRAGMA user_version = ${v + 1}`);
  });
}
```

这不到二十行代码就是一个完整的迁移系统，几个关键点：

- **每条迁移和版本号的更新在同一个事务里**。SQLite 的 DDL 是事务性的，迁移执行到一半崩溃，整条回滚，版本号也不会前进，下次启动重来
- **只能追加，不能修改已发布的条目**。已经装在用户手机上的 App 跑过第 2 条，你改了第 2 条的内容，它不会再跑
- **迁移在启动时同步执行**，在任何查询之前。手机上的库很小，几毫秒就完成了

和第 6 章的 Drizzle 对比：服务端用时间戳判断，本地用一个递增整数，原理相同，都是「记下执行到哪里，之后只往前」。

### ALTER TABLE 的限制

SQLite 的 `ALTER TABLE` 只支持：

- `ADD COLUMN`（不能加主键、唯一约束，非空列必须有默认值）
- `RENAME TO`、`RENAME COLUMN`
- `DROP COLUMN`（3.35 起，且该列不能被索引、约束等引用）

要改列类型、加约束、改主键，只能**重建表**。官方文档给出的标准流程是：

```sql
PRAGMA foreign_keys = OFF;   -- 要在事务外设置
BEGIN;
CREATE TABLE settings_new (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value))
);
INSERT INTO settings_new (key, value) SELECT key, value FROM settings;
DROP TABLE settings;
ALTER TABLE settings_new RENAME TO settings;
-- 重建原来的索引、触发器、视图
PRAGMA foreign_key_check;    -- 确认没有破坏引用
COMMIT;
PRAGMA foreign_keys = ON;
```

对于可重建的索引表，有更简单的路：迁移里直接 `DROP TABLE` 再按新结构建，然后触发一次全量重建索引。这就是「索引可重建」在迁移层面带来的好处。

## 重建索引：一个排他事务

hatch-shelf 的 `rebuildIndex()` 扫描 `books/` 目录，然后在一个事务里整体替换三张索引表：

```ts
await db.withExclusiveTransactionAsync(async (txn) => {
  const prev = await txn.getAllAsync<{ id: string; imported_at: number }>('SELECT id, imported_at FROM books');
  const importedAt = new Map(prev.map((r) => [r.id, r.imported_at]));
  await txn.execAsync('DELETE FROM chapters; DELETE FROM books; DELETE FROM search;');
  for (const b of scanned) {
    await txn.runAsync(
      `INSERT INTO books (..., imported_at, ..., last_read_at)
       VALUES (..., ?, ..., (SELECT MAX(updated_at) FROM progress WHERE book_id = ?))`,
      /* ... */ importedAt.get(b.id) ?? Date.now(), b.id,
    );
    // 逐章插入 chapters，逐小节插入 search
  }
});
```

几个值得注意的地方：

- **先读出旧的 `imported_at` 再清空**，因为「导入时间」不能从文件里推出来，它是索引表里唯一需要保留的信息
- **整体替换在一个事务里**：界面上的查询要么看到完整的旧索引，要么看到完整的新索引，不会看到半空的书架
- **用 `withExclusiveTransactionAsync` 而不是 `withTransactionAsync`**。expo-sqlite 的文档提醒，普通的异步事务不是独占的，同一连接上并发的其他异步查询可能被夹进这个事务里执行；独占版本在自己的连接作用域（`txn`）里执行，一旦升级成写事务，期间其他异步写入会直接以 `database is locked` 失败而不是混进来。所以重建索引期间要避免别处同时写库，或者对这类错误做重试
- **所有 SQL 都是参数化的**（`?` 占位），书名里有引号也不会出问题

注意事务里的写都要通过 `txn` 对象执行，而不是外面的 `db`，否则就不在这个事务里。

## 用户数据：UPSERT

阅读进度每翻几页就要保存一次，「有就更新，没有就插入」：

```ts
await db.runAsync(
  `INSERT INTO progress (book_id, chapter_file, scroll_ratio, anchor, updated_at)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT (book_id, chapter_file) DO UPDATE SET
     scroll_ratio = excluded.scroll_ratio, anchor = excluded.anchor, updated_at = excluded.updated_at`,
  bookId, chapterFile, pos.scrollRatio, pos.anchor ?? null, now,
);
```

`ON CONFLICT ... DO UPDATE` 依赖一个唯一约束来判断冲突，这里是主键 `(book_id, chapter_file)`。`excluded` 指的是「本来要插入的那一行」。这个语法和 PostgreSQL 基本相同，Drizzle 里对应 `onConflictDoUpdate()`。

不要写成「先 SELECT 看有没有，再决定 INSERT 还是 UPDATE」：两步之间有空隙（第 4 章的丢失更新），也多一次查询。

## 用 EXPLAIN QUERY PLAN 检查索引

主键会自动建一个索引（`sqlite_autoindex_*`）。检查「打开一本书时恢复到最近读的章节」这条查询：

```sql
EXPLAIN QUERY PLAN
SELECT chapter_file FROM progress WHERE book_id = 'x' ORDER BY updated_at DESC LIMIT 1;
```

```text
|--SEARCH progress USING INDEX sqlite_autoindex_progress_1 (book_id=?)
`--USE TEMP B-TREE FOR ORDER BY
```

主键 `(book_id, chapter_file)` 的最左前缀能定位到这本书，但排序要额外做。一本书最多几十章，临时排序可以忽略，不值得为它加索引。

高亮表则不同，按章节查高亮是阅读时的高频操作：

```sql
EXPLAIN QUERY PLAN SELECT * FROM highlights WHERE book_id = 'x' AND chapter_file = 'a.md';
-- 没有索引时：SCAN highlights
CREATE INDEX highlights_by_chapter ON highlights (book_id, chapter_file);
-- 之后：SEARCH highlights USING INDEX highlights_by_chapter (book_id=? AND chapter_file=?)
```

hatch-shelf 在建 `highlights` 表的同一条迁移里建了这个索引。

## 本地优先：要想清楚的几件事

「本地优先」（local-first）指数据首先存在用户设备上，App 离线完全可用，网络只用来同步。hatch-shelf 是一个极简的版本：它根本不联网（除了局域网传书），数据只在一台设备上。一旦要跨设备同步，就要面对下面这些问题。

### 谁是真相

| 模型 | 说明 | 例子 |
|---|---|---|
| 服务端是真相，本地是缓存 | 本地可以随时丢弃重拉 | hatch-counter 的客户端：「数据只在服务端，客户端不建库」 |
| 本地是真相，服务端是备份 | 每台设备各自完整 | 单设备笔记 App |
| 多端对等，合并出真相 | 每台设备都能离线写，需要冲突合并 | 协作文档、多设备笔记 |

hatch-counter 明确选了第一种：门店数据要多人同时用、要做跨店的运营统计，服务端唯一一份最简单。它的文档里专门记了「为什么不选每家店一个 SQLite」：跨租户的看板、计费、用量统计都得自己攒，省下的迁移成本会在运营阶段还回去。

### 同步需要的表结构

如果要做多端同步，表设计上至少需要：

- **全局唯一的主键**：UUID，离线时各端独立生成也不会撞（第 1 章）
- **修改时间或版本号**：判断哪边更新
- **删除要留痕**：硬删的行无法同步给其他设备，至少要有一张「已删除 id」表或一个墓碑标记
- **变更日志**：记录「自上次同步以来改了什么」，而不是每次全量比对

冲突合并的策略从简单到复杂：后写者胜（按时间戳）、按字段合并、交给用户选、CRDT（无冲突复制数据类型，数学上保证各端最终一致）。对个人工具，「按字段的后写者胜」通常足够；真要做协作，直接用成熟的同步引擎，别自己写。

hatch-shelf 的高亮用「原文 + 前后文」定位，而不是存字符偏移，也是同一种思路：书的内容会更新，偏移量会失效，而原文片段在更新后仍大概率能找到。**存能自我修复的引用，而不是脆弱的位置**。

### 数据导出

本地数据唯一的副本在用户手机上，App 被删就没了。所以要有导出：hatch-shelf 把高亮和笔记导出成 Markdown，按章节分组，既能备份，也能交给 agent 阅读。用户数据的可导出性，是本地优先应用的基本责任。

## 本章要点

- SQLite 是进程内的库文件：单写者、类型宽松、外键默认关闭、改表能力有限
- 先划分「可重建的索引」和「不可丢的用户数据」；两者生命周期独立时不要加外键
- 打开库就设 `journal_mode = WAL` 和 `foreign_keys = ON`（后者每个连接都要设）
- 用 `user_version` + 只追加的迁移数组，每条迁移和版本号在同一个事务里
- 改约束、改类型要重建表；索引表可以直接删了重建
- 整体替换索引用独占事务，写入都经过事务对象；「有则改无则插」用 `ON CONFLICT`
- 要跨设备同步，先定谁是真相；UUID、版本号、墓碑和变更日志是同步的前提

## 动手练习

1. **类型亲和性与 STRICT**：运行 `sqlite3 :memory:`，执行本章的 `CREATE TABLE loose (n INTEGER); INSERT INTO loose VALUES ('abc'), ('12'), (3.5); SELECT n, typeof(n) FROM loose;`，再建 `CREATE TABLE strict_t (n INTEGER) STRICT;` 并插入 `'abc'`。

   验证：第一段输出 `abc|text`、`12|integer`、`3.5|real`；第二段报 `cannot store TEXT value in INTEGER column strict_t.n`。macOS 自带的 sqlite3 版本低于 3.37 时 `STRICT` 会报语法错误，用 `sqlite3 --version` 确认，必要时用 Homebrew 装新版。

   参考答案：普通表的列类型只是亲和性，能转就转、转不了原样存；`STRICT` 表才真正按声明的类型拒绝写入。

2. **迁移和 user_version 同进退**：在一个临时文件上执行 `sqlite3 /tmp/uv.db "CREATE TABLE p (id INTEGER); PRAGMA user_version = 1;"`，再执行 `sqlite3 /tmp/uv.db "BEGIN; ALTER TABLE p ADD COLUMN note TEXT; PRAGMA user_version = 2; ROLLBACK; PRAGMA user_version; PRAGMA table_info(p);"`。

   验证：输出的 `user_version` 是 `1`，`table_info` 只列出 `id` 一列。

   参考答案：SQLite 的 DDL 和 `user_version` 都在事务里，迁移执行到一半失败时，表结构和版本号一起回滚，下次启动从同一条迁移重来。所以本章的迁移循环把每条迁移和版本号的更新放在同一个事务里。

3. **UPSERT 而不是先查再写**：在 `sqlite3 :memory:` 里建 `CREATE TABLE progress (book_id TEXT, chapter_file TEXT, ratio REAL, PRIMARY KEY (book_id, chapter_file));`，用 `INSERT ... ON CONFLICT (book_id, chapter_file) DO UPDATE SET ratio = excluded.ratio` 先后写入同一章的 `0.2` 和 `0.6`，查 `SELECT count(*), max(ratio) FROM progress;`；再不带 `ON CONFLICT` 插入同一章一次。

   验证：查询结果是 `1|0.6`；不带 `ON CONFLICT` 的插入报 `UNIQUE constraint failed: progress.book_id, progress.chapter_file`。

   参考答案：`ON CONFLICT` 靠主键判断冲突，`excluded` 是本来要插入的那一行。一条语句完成「有则改、无则插」，没有先 `SELECT` 再决定时那段可以被别人插进来的空隙。
