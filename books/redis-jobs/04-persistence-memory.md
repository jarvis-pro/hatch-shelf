# 持久化、内存与淘汰策略

前三章的用途有一个共同点：数据丢了能重建。缓存丢了就重新查库，限流计数丢了就从零开始数，锁丢了最多重复做一次。第 5 章开始往 Redis 里放任务队列，情况就变了：**任务丢了就是一封收据没发出去、一次导出没人做**。所以在讲队列之前，先把 Redis 的持久化和内存管理讲清楚：它在什么情况下会丢数据、丢多少，内存满了会发生什么，以及缓存和队列为什么最好不要共用一个 Redis。

## Redis 怎么持久化

Redis 的数据在内存里，有两种方式落盘：

| 方式 | 怎么做 | 恢复速度 | 最多丢多少 |
|---|---|---|---|
| RDB 快照 | 定期 fork 子进程，把整个内存写成一个二进制文件 | 快 | 上次快照之后的全部写入（几分钟） |
| AOF 追加日志 | 每条写命令追加到日志文件，按策略 fsync | 较慢（要重放） | 取决于 `appendfsync`，默认约 1 秒 |
| 两者都开 | 重启时优先用 AOF 恢复 | | 同 AOF |
| 都不开 | 纯内存 | | 重启全丢 |

> [!WARNING]
> 本节的默认值和文件布局按 Redis 7.x 整理：7.0 起 AOF 改为多文件（`appendonlydir` 目录下的 base + incr 文件），官方镜像默认开启 RDB、不开启 AOF。不同版本和 Valkey、托管服务的默认值可能不同，以你所用版本的 `redis.conf` 注释和官方文档的 Persistence 一节为准，上线前用 `CONFIG GET` 确认实际生效的值。

### RDB

```text
save 3600 1 300 100 60 10000
```

意思是：3600 秒内至少 1 次写、或 300 秒内至少 100 次写、或 60 秒内至少 10000 次写，满足任一条件就做一次快照。快照通过 `fork()` 实现，子进程写盘时父进程照常服务，靠的是操作系统的写时复制：父进程改了哪一页，那一页才被复制一份。

这意味着**快照期间内存可能接近翻倍**。写得越频繁，被复制的页越多。一个 2 GB 的 Redis 在写入高峰做快照，峰值可能到 3–4 GB。给容器设内存上限时要把这部分算进去，否则快照一次就被 OOM 杀掉。

### AOF

```text
appendonly yes
appendfsync everysec
aof-use-rdb-preamble yes
```

`appendfsync` 三个取值：

| 取值 | 含义 | 最多丢 | 性能 |
|---|---|---|---|
| `always` | 每条写命令都 fsync | 几乎不丢 | 差，受磁盘延迟限制 |
| `everysec` | 每秒 fsync 一次 | 约 1 秒（磁盘很慢时可能到 2 秒） | 好，**推荐** |
| `no` | 交给操作系统 | 可能几十秒 | 最好 |

AOF 会越来越大，Redis 会在后台重写（同样是 fork）：把当前内存状态写成一个紧凑的基础文件，之后的命令再追加。`aof-use-rdb-preamble yes` 让基础文件用 RDB 格式，恢复更快。

### 「持久化」的真实含义

即使开了 AOF `everysec`，Redis 的持久性也和 Postgres 不是一个级别：

- Postgres 的 `COMMIT` 返回时，WAL 已经 fsync 到磁盘（默认 `synchronous_commit = on`）
- Redis 的 `SET` 返回时，数据只在内存里，最多一秒后才落盘

所以「BullMQ 的 `queue.add()` 返回了」不等于「任务一定不会丢」：Redis 恰好在这一秒内断电，这个任务就没了。对大多数任务这个窗口可以接受；对「订单写进库了、收据任务一定要发」这种要求，第 6 章的 Postgres 队列能和业务数据在同一个事务里提交，Redis 给不了这个保证。

## 内存上限和淘汰策略

Redis 必须设 `maxmemory`。不设的话，它会一直用到机器内存耗尽，然后被操作系统的 OOM killer 杀掉，连带其他服务。

```text
maxmemory 256mb
maxmemory-policy noeviction
```

内存到上限后怎么办，由 `maxmemory-policy` 决定：

| 策略 | 淘汰范围 | 怎么选 |
|---|---|---|
| `noeviction` | 不淘汰，写命令直接报错 | **队列、锁、任何不能丢的数据** |
| `allkeys-lru` | 所有键，最近最少使用的先走 | 纯缓存的通用选择 |
| `allkeys-lfu` | 所有键，使用频率最低的先走 | 纯缓存，热点明显时比 LRU 好 |
| `volatile-lru` / `volatile-lfu` | 只淘汰设了 TTL 的键 | 缓存和常驻数据混在一起时 |
| `volatile-ttl` | 只淘汰设了 TTL 的，最快过期的先走 | 少用 |
| `allkeys-random` / `volatile-random` | 随机 | 很少用 |

LRU 和 LFU 都是近似算法：Redis 不维护完整的访问顺序，而是每次随机抽几个键（`maxmemory-samples`，默认 5），淘汰其中最该淘汰的。对缓存来说足够好。

### 队列必须是 noeviction

BullMQ 把任务数据、等待列表、延迟集合都存成 Redis 的键，大部分**没有 TTL**。用 `allkeys-lru` 的话，内存一满，Redis 会悄无声息地删掉一些任务键，队列的内部结构就坏了：等待列表里有个 id，对应的任务数据却没了。

BullMQ 启动时会检查这个配置，不是 `noeviction` 会在日志里打一条警告。不要忽略它。

`noeviction` 的代价是内存满了写入报错：`queue.add()` 抛出 `OOM command not allowed`。这是正确的行为，**报错比静默丢任务好**，前提是你有监控（第 9 章）在内存到 80% 时就提醒你。

### 缓存和队列分开

缓存要 `allkeys-lru`，队列要 `noeviction`，两者在同一个 Redis 里没法兼得。折中的 `volatile-lru`（只淘汰带 TTL 的键）理论上可行：缓存键都带 TTL，队列键大多不带。但它依赖「每个缓存键都记得设 TTL」，漏一个就永远不会被淘汰；而且缓存涨满时，可用内存被挤到队列身上。

更省心的做法是**起两个 Redis**：

```yaml
services:
  redis-cache:
    image: redis:7.4-alpine
    command: ["redis-server", "--maxmemory", "128mb", "--maxmemory-policy", "allkeys-lru",
              "--save", "", "--appendonly", "no", "--requirepass", "${REDIS_PASSWORD}"]
    restart: unless-stopped

  redis-queue:
    image: redis:7.4-alpine
    command: ["redis-server", "--maxmemory", "256mb", "--maxmemory-policy", "noeviction",
              "--appendonly", "yes", "--appendfsync", "everysec", "--requirepass", "${REDIS_PASSWORD}"]
    volumes:
      - redis-queue-data:/data
    restart: unless-stopped

volumes:
  redis-queue-data:
```

两份配置正好相反：

| | 缓存实例 | 队列实例 |
|---|---|---|
| 淘汰 | `allkeys-lru` | `noeviction` |
| 持久化 | 全关（`--save ""`、不开 AOF） | AOF `everysec` |
| 数据卷 | 不需要 | 需要 |
| 重启后 | 空的，冷启动一会儿 | 恢复到最多一秒前 |
| 备份 | 不需要 | 需要（见下文） |

一个 Redis 空跑只占几 MB 内存，多起一个的成本很低，换来的是两类数据的故障互不影响。在 Node 里就是两个 `REDIS_URL`，缓存连接和队列连接本来也该分开（第 1 章说过它们的重试配置不同）。

## 估算内存

上线前粗算一下要多大，比上线后被 OOM 叫醒好。

### 每个键的开销

一个键除了值本身，还有键名、过期时间、内部结构的开销，小键大约**每个 50–100 字节**的额外开销。可以直接量：

```bash
redis-cli SET cache:store:42:menu:v1 "$(cat menu.json)"
redis-cli MEMORY USAGE cache:store:42:menu:v1
```

```text
(integer) 18472
```

### 算一个例子

假设 hatch-counter 有 500 家店，缓存每家店的菜单（约 18 KB）、配置（约 2 KB）、今日看板（约 5 KB）：

$$
500 \times (18 + 2 + 5)\ \text{KB} \approx 12.5\ \text{MB}
$$

加上开销和碎片，按 2 倍算，25 MB。128 MB 的缓存实例绰绰有余。

队列这边，BullMQ 每个任务的数据加上内部结构大约 1–2 KB（payload 小的情况下），真正占内存的是**做完了没删的任务**。每天 1 万个任务、全部保留的话，一个月就是 30 万个、几百 MB。所以第 5 章会把 `removeOnComplete` 设成只留最近的一部分。

### 碎片率

```bash
redis-cli INFO memory | grep -E 'used_memory_human|used_memory_rss_human|mem_fragmentation_ratio'
```

```text
used_memory_human:61.20M
used_memory_rss_human:88.43M
mem_fragmentation_ratio:1.44
```

`used_memory` 是 Redis 自己算的数据大小，`used_memory_rss` 是操作系统看到的进程占用。比值在 1.0–1.5 之间正常；大于 1.5 说明碎片多（经常删大量键之后），可以打开 `activedefrag yes` 让它后台整理；**小于 1.0 说明有内存被换到了 swap**，Redis 会变得极慢，要立刻处理。

`maxmemory` 限制的是 `used_memory`，不是 RSS。容器的内存上限要比 `maxmemory` 大出一截：碎片、fork 时的写时复制、客户端缓冲区都在 `maxmemory` 之外。经验值是**容器上限设成 `maxmemory` 的 1.5–2 倍**。

## 大键

一个键的值特别大（一个几 MB 的 String、一个百万成员的 Hash），叫大键。它的问题不只是占内存：

- 读写它的命令要很久，期间 Redis 什么都干不了
- `DEL` 一个百万成员的集合会卡住几百毫秒（用 `UNLINK` 后台释放）
- 网络传输慢，客户端解析慢

找大键：

```bash
redis-cli --bigkeys       # 按类型列出元素最多的键，用 SCAN 实现，不阻塞
redis-cli --memkeys       # 按内存占用列出
```

常见来源和改法：

| 来源 | 改法 |
|---|---|
| 一整张表缓存成一个 JSON | 按店、按分页拆成多个键 |
| 一个 Hash 存了所有用户的会话 | 每个会话一个键 |
| 限流的 Sorted Set 限额太大 | 改用令牌桶（第 3 章） |
| BullMQ 的 completed 集合没清理 | 设 `removeOnComplete`（第 5 章） |

## 备份队列实例

缓存实例不用备份。队列实例在 AOF 之外，最好再定期拷一份 RDB 出去，应对「磁盘坏了」「误执行了 `FLUSHALL`」。

```bash
#!/usr/bin/env bash
# 每天凌晨跑一次：触发快照，等它完成，拷出来
set -euo pipefail
cd /opt/counter

before=$(docker compose exec -T redis-queue redis-cli -a "$REDIS_PASSWORD" --no-auth-warning LASTSAVE)
docker compose exec -T redis-queue redis-cli -a "$REDIS_PASSWORD" --no-auth-warning BGSAVE
until [ "$(docker compose exec -T redis-queue redis-cli -a "$REDIS_PASSWORD" --no-auth-warning LASTSAVE)" != "$before" ]; do
  sleep 1
done

docker compose cp redis-queue:/data/dump.rdb "/backup/redis/queue-$(date +%F).rdb"
find /backup/redis -name 'queue-*.rdb' -mtime +7 -delete
```

不过要想清楚这份备份的价值：从一天前的 RDB 恢复，会把**昨天已经做完的任务重新放回队列**，导致大量重复执行。所以它是灾难兜底，不是日常恢复手段；真用上的时候，任务的幂等性（第 8 章）决定了你会不会出事。

这也是为什么关键的业务事实不该只存在 Redis 里：如果「这个订单要发收据」只存在 BullMQ 的任务里，丢了就无从查起；如果订单表里有一列 `receipt_sent_at`，丢了任务也能用一条 SQL 找出所有没发的订单补发。备份和恢复演练的完整做法见[《PostgreSQL 运维》的备份与恢复](../database-ops/02-backup-restore.md)，Redis 这边远比它简单。

## 本章要点

- RDB 是定期快照，丢几分钟；AOF `everysec` 最多丢约一秒；Redis 的写入返回时不保证已落盘
- 快照和 AOF 重写都会 fork，峰值内存可能接近翻倍，容器上限设成 `maxmemory` 的 1.5–2 倍
- 必须设 `maxmemory`；纯缓存用 `allkeys-lru` / `allkeys-lfu`，队列和锁必须 `noeviction`
- 缓存和队列分成两个 Redis：缓存不持久化、可淘汰；队列开 AOF、不淘汰、要备份
- 上线前用 `MEMORY USAGE` 量一下、算一下；碎片率小于 1 说明在用 swap
- 用 `--bigkeys` 找大键，删大键用 `UNLINK`
- 从旧备份恢复队列会重复执行任务；关键业务事实要在 Postgres 里留痕，能用 SQL 补救

## 动手练习

下面都在一次性容器里做，用完 `docker rm -f` 删掉。造数据用 `redis-cli DEBUG POPULATE`，所以容器启动时加 `--enable-debug-command yes`。

1. **noeviction 时写入报错**：`docker run --rm -d --name rq -p 6379:6379 redis:7.4-alpine redis-server --enable-debug-command yes --maxmemory 20mb --maxmemory-policy noeviction`，然后 `docker exec rq redis-cli DEBUG POPULATE 500000 job 100`，再执行一次 `SET x 1`。

   验证：`SET` 返回以 `OOM command not allowed when used memory > 'maxmemory'` 开头的错误；`DBSIZE` 不再增长；`GET` 之类的读命令照常可用。

   参考答案：`noeviction` 下内存到上限后拒绝写入，已有数据一个不丢，这正是队列需要的行为。

2. **allkeys-lru 时静默淘汰**：用同样的命令起一个 `--maxmemory-policy allkeys-lru` 的容器，同样 `DEBUG POPULATE 500000 job 100`，再循环写几千个新键。

   验证：写入全部成功；`INFO stats` 里的 `evicted_keys` 大于 0；`DBSIZE` 明显少于写入总数。

   参考答案：内存满时 Redis 按近似 LRU 删掉旧键腾地方，客户端收不到任何错误。如果这些键是 BullMQ 的任务数据，队列结构就被悄悄破坏了。

3. **AOF 与重启**：起两个带数据卷的容器，一个 `--appendonly yes`，另一个 `--save "" --appendonly no`，各写 `SET k v`，然后对两个容器执行 `docker restart`，再 `GET k`。

   验证：开 AOF 的容器返回 `"v"`，`docker exec <容器> ls /data/appendonlydir` 能看到 base 和 incr 文件；全关的容器返回 `(nil)`。

   参考答案：开了 AOF 的实例重启时重放日志恢复数据；持久化全关的实例就是纯内存，适合缓存，不适合队列。
