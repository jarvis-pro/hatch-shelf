# 监控与运维

缓存挂了会变慢，队列堵了却可能很久没人发现：任务安静地堆在 `waiting` 里，用户只是觉得「收据怎么还没到」。后台任务出问题的典型样子不是报错，而是**什么都没发生**。这一章讲 Redis 和队列分别要盯哪几个数、怎么接进 Prometheus 和告警、日常运维里的几件事（安全、升级、排障），最后讲 Redis 许可证的变化和 Valkey，帮你决定镜像该写哪一个。

## Redis 要盯的指标

所有数字都来自 `INFO` 命令：

```bash
redis-cli -a "$REDIS_PASSWORD" --no-auth-warning INFO
```

| 指标（INFO 字段） | 含义 | 关注什么 |
|---|---|---|
| `used_memory` / `maxmemory` | 已用 / 上限 | 队列实例超过 80% 就该处理 |
| `mem_fragmentation_ratio` | 碎片率 | 小于 1 在用 swap；大于 1.5 碎片多（第 4 章） |
| `evicted_keys` | 累计被淘汰的键 | 缓存实例在涨说明内存不够；**队列实例必须是 0** |
| `keyspace_hits` / `keyspace_misses` | 命中 / 未命中 | 缓存命中率 |
| `connected_clients` | 当前连接数 | 突然涨很多通常是连接泄漏 |
| `blocked_clients` | 阻塞命令等待中的连接 | BullMQ Worker 在等任务时会占用，数量应与 Worker 数相当 |
| `rejected_connections` | 因超过 `maxclients` 被拒 | 应为 0 |
| `instantaneous_ops_per_sec` | 每秒命令数 | 看趋势 |
| `rdb_last_bgsave_status` / `aof_last_write_status` | 上次持久化是否成功 | 必须是 `ok`，磁盘满时会变成 `err` |

命中率按定义算：

$$
\text{命中率} = \frac{\text{hits}}{\text{hits} + \text{misses}}
$$

它是全实例的数，混合了所有缓存键。某一类缓存的命中率要在应用里自己打点（`getOrLoad` 里命中和未命中各计一次）。命中率低不一定是坏事：可能只是这类数据本来就不适合缓存（[取用形状决定值不值得缓存](../system-design/03-caching.md#取用形状决定值不值得缓存)）。

## 接进 Prometheus

> [!WARNING]
> 下面的 exporter 镜像标签和指标名按 redis_exporter 1.6x 版本整理，不同版本的指标名可能有出入。以 oliver006/redis_exporter 仓库的 README 和你部署后 `/metrics` 的实际输出为准。

用 redis_exporter 把 `INFO` 转成 Prometheus 指标。整个 Prometheus 栈的部署见[《可观测性与性能》的指标一章](../observability-performance/02-metrics-prometheus.md#部署-prometheus-栈)，这里只加一个服务：

```yaml
services:
  redis-exporter:
    image: oliver006/redis_exporter:v1.62.0
    restart: unless-stopped
    environment:
      REDIS_ADDR: redis://redis-queue:6379
      REDIS_PASSWORD: ${REDIS_PASSWORD}
    # 只给 Prometheus 抓，不暴露到宿主机
```

```yaml
# prometheus.yml
scrape_configs:
  - job_name: redis-queue
    static_configs:
      - targets: ["redis-exporter:9121"]
```

镜像标签写死一个具体版本，版本号以项目的 GitHub releases 为准。要监控两个 Redis（缓存和队列），起两个 exporter，或者用 exporter 的多目标模式。

告警规则：

```yaml
groups:
  - name: redis
    rules:
      - alert: RedisDown
        expr: redis_up == 0
        for: 1m
        annotations:
          summary: "Redis {{ $labels.instance }} 连不上"

      - alert: RedisQueueMemoryHigh
        expr: redis_memory_used_bytes{job="redis-queue"} / redis_memory_max_bytes{job="redis-queue"} > 0.8
        for: 10m
        annotations:
          summary: "队列 Redis 内存超过 80%，满了之后入队会报错"

      - alert: RedisQueueEvicting
        expr: increase(redis_evicted_keys_total{job="redis-queue"}[5m]) > 0
        annotations:
          summary: "队列 Redis 在淘汰键，检查 maxmemory-policy"

      - alert: RedisPersistenceFailing
        expr: redis_rdb_last_bgsave_status == 0 or redis_aof_last_write_status == 0
        for: 5m
        annotations:
          summary: "Redis 持久化失败，检查磁盘"
```

指标名以你所用 exporter 版本的实际输出为准，部署后打开 `http://redis-exporter:9121/metrics` 对一遍。告警怎么分级、怎么避免半夜被不重要的事叫醒，见[告警设计](../observability-performance/04-alerting.md)。

## 队列要盯的指标

Redis 健康不代表队列健康。worker 全挂了，Redis 的所有指标都很正常，只是 `waiting` 在一直涨。队列需要自己的指标：

| 指标 | 说明 | 告警条件 |
|---|---|---|
| 等待数 | `waiting` + `prioritized` + 到期的 `delayed` | 持续上涨 |
| **最老等待任务的年龄** | 排在最前面的任务等了多久 | **最重要**：超过这个队列的预期时限 |
| 执行中 | `active` | 长时间为 0 且有等待 = worker 没在干活 |
| 失败速率 | 单位时间进入死信的数量 | 大于 0 就看一眼 |
| 处理耗时 | 从取走到完成 | P95 显著变长 |

「最老等待任务的年龄」比「等待数」好用得多。等待数 500 可能完全正常（刚扇出了 500 家店的体检），但最老的任务等了 20 分钟一定不正常。它同时覆盖了「worker 挂了」「worker 太慢」「某个任务卡住了整个队列」几种情况。

### BullMQ：定期采样导出

```typescript
// src/queue/queue-metrics.service.ts
import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Queue } from "bullmq";
import { Gauge } from "prom-client";

const jobs = new Gauge({ name: "queue_jobs", help: "各状态任务数", labelNames: ["queue", "state"] });
const oldest = new Gauge({ name: "queue_oldest_waiting_seconds", help: "最老等待任务的等待秒数", labelNames: ["queue"] });

@Injectable()
export class QueueMetricsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly queues: Queue[];

  constructor(@InjectQueue("sms") sms: Queue, @InjectQueue("export") exp: Queue) {
    this.queues = [sms, exp];
  }

  onModuleInit() {
    this.timer = setInterval(() => void this.sample(), 15_000);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private async sample() {
    for (const q of this.queues) {
      const counts = await q.getJobCounts("waiting", "prioritized", "active", "delayed", "failed");
      for (const [state, n] of Object.entries(counts)) jobs.set({ queue: q.name, state }, n);

      // 队列按先进先出，最前面的就是最老的
      const [first] = await q.getJobs(["waiting", "prioritized"], 0, 0, true);
      oldest.set({ queue: q.name }, first ? (Date.now() - first.timestamp) / 1000 : 0);
    }
  }
}
```

只在一个进程里采样（比如 API 进程），否则多个实例上报同样的数。`prioritized` 状态里的任务按优先级而不是时间排序，最前面的不一定最老，这里取的是近似值。

```yaml
- alert: QueueStuck
  expr: queue_oldest_waiting_seconds{queue="sms"} > 120
  for: 2m
  annotations:
    summary: "短信队列最老的任务已经等了 {{ $value }} 秒"
```

不同队列的阈值不同：短信两分钟，导出半小时。

### Postgres 队列：一条 SQL

```sql
SELECT kind,
       count(*) FILTER (WHERE status = 'queued' AND run_at <= now()) AS ready,
       count(*) FILTER (WHERE status = 'running')                    AS running,
       count(*) FILTER (WHERE status = 'failed')                     AS failed,
       extract(epoch FROM now() - min(run_at) FILTER (WHERE status = 'queued' AND run_at <= now())) AS oldest_sec
FROM jobs
GROUP BY kind;
```

Postgres 队列的好处在这里又体现了一次：任务状态和业务数据在同一个库，后台首页可以直接展示，不需要额外的导出器。pg-boss 的任务在 `pgboss.job` 表里，可以写类似的查询，或者用它的 `getQueueStats` 一类 API（以所用版本为准）。

### 心跳：确认定时任务跑了

队列指标看不出「凌晨 3 点的体检根本没触发」。这要靠第 7 章的 `job_runs`：检查最近一个周期有没有记录、`ok` 是不是 true。可以导出成指标，也可以用外部的心跳服务（任务跑完 ping 一个 URL，到点没收到就告警），做法见[《可观测性与性能》的可用性监控](../observability-performance/06-uptime-monitoring.md)。

## 安全

[第 1 章](01-data-structures.md#在-compose-里起一个-redis)说过 Redis 不能暴露到公网、必须设密码。再补两点：

### 用 ACL 给应用一个受限用户

`requirepass` 设的是默认用户的密码，这个用户能执行所有命令，包括 `FLUSHALL`、`CONFIG SET`、`DEBUG`。Redis 6 起可以用 ACL 给应用一个权限更小的用户：

```text
# users.acl
user default off
user app on >应用密码 ~* &* +@all -flushall -flushdb -config -debug -shutdown -keys -acl
user ops on >运维密码 ~* &* +@all
```

```yaml
services:
  redis-queue:
    command: ["redis-server", "--aclfile", "/etc/redis/users.acl", "--appendonly", "yes",
              "--maxmemory", "256mb", "--maxmemory-policy", "noeviction"]
    volumes:
      - ./redis/users.acl:/etc/redis/users.acl:ro
      - redis-queue-data:/data
```

这里逐个去掉了清库、改配置、调试、关机、`KEYS` 和改 ACL 的命令。也可以用 `-@dangerous` 一次去掉一整类，但这一类里还包括 `INFO` 等客户端库启动时会用到的命令，BullMQ 就会读 Redis 的版本和配置，去得太多会让它启动报错或打警告。应用用 `redis://app:密码@redis-queue:6379` 连接，上线前在测试环境用这个用户把 API 和 worker 都跑一遍，确认没有命令被拒。

### 旧的 rename-command

网上很多教程用 `rename-command FLUSHALL ""` 禁用危险命令。这是 ACL 出现之前的做法，会影响复制和某些客户端，现在用 ACL 代替。

## 升级

Redis 的小版本升级（7.2.4 → 7.2.5）直接换镜像标签、重启即可，数据文件兼容。大版本升级要注意：

- **RDB / AOF 文件向前兼容，不向后兼容**：新版本能读旧版本的文件，旧版本读不了新版本写的文件。升级后想回滚，旧的数据文件就用不了了
- 先在另一个实例上用生产数据的拷贝启动新版本，确认能正常加载
- 队列实例升级时，最稳的做法是**先排空**：停止入队（API 暂时把任务写进 Postgres outbox 或直接在维护窗口操作），等 `waiting` 和 `active` 归零，再换版本

缓存实例没有这些顾虑：换个版本，空着启动，冷启动几分钟就好了。

## 排障清单

| 现象 | 先看 | 常见原因 |
|---|---|---|
| 接口偶尔慢几百毫秒 | `SLOWLOG GET 20`、`LATENCY DOCTOR` | 大键、`KEYS`、fork 时内存大 |
| 入队报 `OOM command not allowed` | `INFO memory` | 历史任务没清理（`removeOnComplete`）、大 payload |
| 任务被执行两次 | 任务日志里的 `attemptsMade`、stalled 事件 | 事件循环被堵、锁过期；处理函数不幂等 |
| 任务堆积不动 | `active` 数、worker 日志 | worker 挂了、连不上 Redis、某个任务卡死占满并发 |
| Redis 内存一直涨 | `redis-cli --bigkeys`、`--memkeys` | 键没设 TTL、限流 Sorted Set 太大 |
| 连接数一直涨 | `CLIENT LIST` | 每个请求 `new Redis()` 没关；`duplicate()` 没 `quit` |
| 重启后数据少了 | `INFO persistence` | 没开 AOF、数据卷没挂上 |

`SLOWLOG` 记录执行时间超过 `slowlog-log-slower-than`（默认 10 毫秒）的命令。Redis 里 10 毫秒已经很慢了，可以把阈值调到 1 毫秒看得更细。

`CLIENT LIST` 会显示每个连接的名字。给不同用途的连接起名，排查时一眼看出是谁：

```typescript
new Redis(url, { connectionName: "api-cache" });
```

## 许可证变化与 Valkey

> [!WARNING]
> 本节的许可证和版本时间线按 2026 年下半年能查到的公开信息整理，许可证条款可能再次调整。做决定前以 Redis 官方仓库的 LICENSE 文件、redis.io 的许可证说明页，以及 Valkey 官方网站和 Linux 基金会的公告为准；如果你的产品涉及对外提供数据库服务，请咨询专业法律意见。

### 时间线

| 时间 | 事件 |
|---|---|
| 2024 年 3 月 | Redis 宣布从 BSD-3 改为双许可证 RSALv2 / SSPLv1，从 7.4 版开始生效 |
| 2024 年 3–4 月 | Linux 基金会发起 Valkey，从 Redis 7.2.4（最后一个 BSD 版本）分叉，保持 BSD-3 许可证 |
| 2024 年下半年起 | Valkey 8.x 发布；多家云厂商的托管 Redis 服务开始提供或切换到 Valkey |
| 2025 年 | Redis 8 在原有两个许可证之外增加 AGPLv3 选项，并把 JSON、搜索等原来的模块并入 Redis 本体 |

### 对一人公司意味着什么

RSALv2 和 SSPLv1 主要限制的是**把 Redis 本身作为服务提供给别人**（比如你开一个托管 Redis 的云服务）。把 Redis 作为自己 SaaS 的内部组件，用户只用你的应用、不直接用 Redis，通常不受影响。AGPLv3 的义务主要在你修改了 Redis 源码并通过网络提供服务时。

所以对 hatch-counter 这样的项目，**用 Redis 7.4+ 或 Redis 8 在许可证上一般没有问题**。选 Valkey 的理由更多是：

- 想用纯开源（BSD）许可证、不想再关心许可证的后续变化
- 所在的云厂商托管服务默认就是 Valkey，自建和托管保持一致
- 需要的命令在 Redis 7.2 里都有，Valkey 完全够用

选 Redis 的理由：

- 需要 Redis 7.4 以后新增的功能（比如字段级过期），且 Valkey 还没有或实现不同
- 用到了 Redis 8 并入本体的 JSON、搜索等功能

### 兼容性和切换

Valkey 从 7.2.4 分叉，**到 7.2 为止的命令、协议、RDB 格式都兼容**。ioredis、node-redis 都能直接连 Valkey，BullMQ 的官方文档也列出了对 Valkey 的支持（以当前文档为准）。本书的全部命令都在这个范围里。

两边各自新增的功能已经开始分叉，切换前要核对：

- **新版本 Redis 写出的 RDB 文件，Valkey 可能读不了**（反过来也一样）。从 Redis 7.4+ 切到 Valkey，不要指望直接挂上旧的数据卷
- 缓存实例：直接换镜像，空着启动
- 队列实例：按上面「升级」的做法，先排空再换

```yaml
services:
  redis-queue:
    image: valkey/valkey:8-alpine
    command: ["valkey-server", "--appendonly", "yes", "--maxmemory", "256mb",
              "--maxmemory-policy", "noeviction", "--requirepass", "${REDIS_PASSWORD}"]
```

命令行工具对应改成 `valkey-cli`（大多数镜像里也保留了 `redis-cli` 的别名，以镜像实际内容为准）。

### 怎么选

对一个从零开始的一人项目，我的建议是：**选 Valkey，只用两边都有的命令**。这样许可证不用操心，托管服务可选的更多，将来要切换也只是换一个镜像名。真正需要某个 Redis 独有的功能时，再为它换回来，那时候你会清楚地知道自己为什么需要它。

当然，更好的建议是第 6 章那句：**先确认你需要它**。

## 本章要点

- Redis 盯内存占比、淘汰数（队列必须为 0）、持久化状态、连接数；命中率是全局数，分类命中率在应用里打点
- 用 redis_exporter 接 Prometheus；告警：连不上、队列内存超 80%、在淘汰、持久化失败
- 队列最重要的指标是「最老等待任务的年龄」；BullMQ 定期采样导出，Postgres 队列一条 SQL
- 定时任务靠 `job_runs` 或外部心跳确认跑了
- 用 ACL 给应用一个去掉清库、改配置等危险命令的用户，替代 `rename-command`
- 数据文件不向后兼容；队列实例升级或切换前先排空，缓存实例空着启动即可
- 许可证：作为自己 SaaS 的内部组件用 Redis 一般没问题；新项目可选 Valkey、只用共有命令，切换只是换镜像
