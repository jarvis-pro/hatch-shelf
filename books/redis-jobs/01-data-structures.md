# Redis 数据结构与用途对照

## 关于这本书

[《软件架构与系统设计》](../system-design/)的[缓存策略](../system-design/03-caching.md)和[队列与异步任务](../system-design/04-queues-jobs.md)两章讲的是**要不要**：什么时候值得缓存、缓存放哪一层、队列选光谱上的哪一档。这本书接着讲**怎么写**：决定用 Redis 之后，缓存、限流、锁、队列分别用哪个命令、哪个库、哪几个参数，坑在哪里；决定不用 Redis 的时候，Postgres 上的 pg-boss 和 `SKIP LOCKED` 怎么接住同样的活。原理和取舍那两章已经讲过的，这里不再重复，用到时链接过去。

读者画像：日常写 TypeScript、NestJS 和 Postgres，Redis 用过 `GET` / `SET`，BullMQ 照着 README 跑通过，但没想清楚「Redis 挂了会怎样」「任务执行两遍会怎样」。一个人维护服务，后台任务出问题时没人替你值班。

案例主线还是 hatch-counter：门店管理 SaaS，NestJS + Postgres + Drizzle，生产环境是一台云服务器上的 docker compose。按[《软件架构与系统设计》](../system-design/)里记录的做法，它只有一个实例，缓存在进程内存里，队列是进程内队列加数据库记状态，定时任务靠 `job_runs` 表；本书不假设它已经用上了 Redis。本书的写法是：每一章先看那些已记录的做法，再看「如果开第二个实例、加了 Redis」这件事会怎么写。第 6 章专门回答一个人什么时候根本不需要 Redis。

**版本约定**：命令以 Redis 7.x / Valkey 8.x 都支持的部分为准；Node 客户端用 ioredis 5（BullMQ 依赖它）；BullMQ 以 5.x 为准，pg-boss 以 10.x 为准，NestJS 以 10 / 11 为准。只在新版本才有的命令会单独标出来。

怎么读：第 1–4 章讲 Redis 本身（数据结构、缓存、限流和锁、持久化与内存）；第 5–8 章讲后台任务（BullMQ、Postgres 队列、定时与延迟、重试与幂等）；第 9 章讲监控、运维，以及 Redis 许可证变化之后该选 Redis 还是 Valkey。

## 先把 Redis 想对

Redis 是一个**单线程执行命令的内存数据结构服务器**。三个关键词各自带来一条推论：

| 特点 | 推论 |
|---|---|
| 单线程执行命令 | 单条命令天然原子；一条慢命令（比如对百万元素的集合求交集）会卡住所有客户端 |
| 数据在内存 | 快，但容量受内存限制；持久化是「尽量不丢」，不是数据库意义的持久（第 4 章） |
| 数据结构服务器 | 不只是 key-value：列表、哈希、集合、有序集合、流都在服务端操作，不用取回来改完再写回 |

最后一条最常被浪费。很多项目把 Redis 当成「远程的 `Map<string, string>`」，所有东西 `JSON.stringify` 之后 `SET` 进去，要改一个字段就整个取回来、改、写回去。这样既慢，又在并发时丢更新。下面按结构过一遍，每种只讲**它适合干什么**。

> I/O 线程（`io-threads`）只负责网络读写，命令执行仍然是一个线程。所以「单条命令原子、慢命令卡全局」两条结论不变。

## 五种基础结构

### String：计数、开关、序列化对象

String 最多存 512 MB 的字节串，可以是文本、JSON，也可以是整数。

```bash
SET config:sms-provider "aliyun" EX 60      # 带 60 秒过期
SET lock:export:42 "token-abc" NX PX 30000  # 不存在才设，30 秒过期：锁的基础（第 3 章）
INCR rate:login:203.0.113.7                 # 原子 +1，键不存在时从 0 开始
INCRBY quota:store:42:2026-11 5
GETDEL otp:13800000000                      # 取出并删除：一次性验证码
```

`INCR` 是 String 最有用的能力：**读改写在服务端一步完成**，不会有两个请求同时读到 5、各自写回 6 的问题。计数器、限流、生成序号都靠它。

### Hash：一个对象的多个字段

> [!WARNING]
> 本节提到的字段级过期命令（`HEXPIRE` 等）按 Redis 7.4 的发布说明整理，Valkey 和各家托管服务的支持版本不同。使用前以你所用产品的官方命令文档为准。

```bash
HSET session:7f3a userId 1001 storeId 42 role owner
HGET session:7f3a storeId
HINCRBY stats:store:42:2026-11-04 orders 1
HGETALL session:7f3a
```

和「整个对象 JSON 存进 String」相比，Hash 可以只改一个字段、只取一个字段，`HINCRBY` 也是原子的。代价是值只能是字符串，没有嵌套。

一个常见误会是以为可以给 Hash 的单个字段设 TTL。传统上 TTL 只能设在整个键上；Redis 7.4 起有了字段级过期（`HEXPIRE` 等命令），但写之前要先确认你实际跑的版本支持它。

### List：简单队列和最近 N 条

```bash
LPUSH recent:store:42 "order:9001"
LTRIM recent:store:42 0 99          # 只留最近 100 条
LRANGE recent:store:42 0 19         # 取前 20 条

LPUSH queue:sms '{"to":"138...","tpl":"verify"}'
BRPOP queue:sms 5                   # 阻塞弹出，最多等 5 秒
```

`LPUSH` + `BRPOP` 能拼出一个最简单的队列，但弹出的那一刻任务就离开了 Redis：消费者这时候崩了，任务就丢了。补上「处理中」列表（`LMOVE`）、超时回收、重试计数，就是在重写一个队列库。**真要队列，直接用 BullMQ**（第 5 章），它内部也是 List、Sorted Set 和 Lua 脚本组合出来的。

### Set：去重和成员关系

```bash
SADD online:store:42 device:a device:b
SISMEMBER online:store:42 device:a
SCARD online:store:42
SINTER tags:dish:spicy tags:dish:vegan   # 交集：又辣又素的菜
```

适合「这个东西在不在里面」「有几个不同的」。集合很大时 `SMEMBERS`、`SINTER` 是慢命令，要么限制集合大小，要么改用 `SSCAN` 分批取。

### Sorted Set：按分数排序，也是时间索引

每个成员带一个浮点数分数，按分数有序。分数用时间戳时，它就是一个**按时间排序的索引**，这是 Sorted Set 最重要的用法：

```bash
ZADD leaderboard:2026-11 1520 store:42
ZREVRANGE leaderboard:2026-11 0 9 WITHSCORES      # 前 10 名

# 滑动窗口限流：成员是请求 id，分数是毫秒时间戳（第 3 章）
ZADD rl:api:user:1001 1762240000123 req-1
ZREMRANGEBYSCORE rl:api:user:1001 0 1762239940123 # 删掉 60 秒前的
ZCARD rl:api:user:1001

# 延迟任务：分数是到期时间，取所有已到期的
ZRANGEBYSCORE delayed 0 1762240000000 LIMIT 0 10
```

BullMQ 的延迟任务、优先级都是 Sorted Set 实现的。

## 进阶结构

| 结构 | 一句话 | 典型用途 | 一人项目里用得到吗 |
|---|---|---|---|
| Stream | 只追加的日志，带消费组和确认 | 事件流、多个消费者各自读一份 | 很少；要队列用 BullMQ，要事件流多半是过度设计 |
| HyperLogLog | 12 KB 估算基数，误差约 0.81% | 日活 UV、不同 IP 数 | 偶尔；精确要求不高的统计 |
| Bitmap | 按位操作 String | 每天是否签到、功能开关位 | 偶尔 |
| Geo | 经纬度索引（底层是 Sorted Set） | 附近的门店 | 看业务 |
| Pub/Sub | 发出去就忘，不存储 | 多实例之间广播「某缓存失效了」 | 多实例时有用 |

Pub/Sub 值得多说一句：**订阅者不在线时消息直接丢失**，没有重放。用它通知「清一下本地缓存」可以（丢了还有 TTL 兜底），用它传业务事件不行。hatch-counter 跨实例广播用的是 Postgres 的 `LISTEN/NOTIFY`，语义和 Pub/Sub 一样是「在线才收得到」，详见[实时推送](../system-design/05-realtime-push.md)。

## 用途对照表

把常见需求和结构对上：

| 需求 | 结构和命令 | 详见 |
|---|---|---|
| 缓存一个查询结果 | String `SET ... EX` | 第 2 章 |
| 缓存一个可局部更新的对象 | Hash + `EXPIRE` | 第 2 章 |
| 固定窗口限流 | String `INCR` + `EXPIRE` | 第 3 章 |
| 滑动窗口限流 | Sorted Set + Lua | 第 3 章 |
| 令牌桶限流 | Hash + Lua | 第 3 章 |
| 互斥锁 | String `SET NX PX` + Lua 释放 | 第 3 章 |
| 一次性验证码 | String `SET EX` + `GETDEL` | 本章 |
| 会话 | Hash 或 String + TTL | 本章 |
| 在线设备集合 | Set，或 Sorted Set（分数为最后心跳时间） | 本章 |
| 排行榜 | Sorted Set | 本章 |
| 任务队列 | BullMQ（不要手写） | 第 5 章 |
| 延迟任务 | BullMQ `delay`，或 Postgres `run_at` | 第 7 章 |
| 去重（幂等） | String `SET NX EX` | 第 8 章 |

## 键的命名和 TTL

没有表结构，键名就是你的 schema。约定一个格式并坚持：

```text
<用途>:<实体>:<id>[:<子维度>]

cache:store:42:menu:v3
rl:login:ip:203.0.113.7
lock:export:store:42
session:7f3a9c...
```

几条规矩：

- **用冒号分层**：各种 GUI 和 `redis-cli --scan --pattern 'cache:store:42:*'` 都按冒号分组
- **租户 id 进键名**：多租户系统里，缓存键漏了租户维度就是 A 店看到 B 店的数据。[多租户](../system-design/08-multi-tenancy.md)一章讲的隔离原则在 Redis 里只能靠键名保证
- **除了队列和必须常驻的数据，每个键都带 TTL**：没有 TTL 的键会一直留着，几个月后内存满了你也不知道是谁写的
- **键名里放版本号**：缓存的数据格式改了，`cache:...:v3` 换成 `v4`，旧键等 TTL 自然消失，不用清库
- **共用一个 Redis 时加应用前缀**：BullMQ 默认前缀是 `bull`，自己的键用别的前缀，避免互相踩

> [!CAUTION]
> 生产环境不要执行 `KEYS *`。它一次遍历全部键，键多时会卡住 Redis 几秒，期间所有请求超时。要按模式找键用 `SCAN`，它分批返回，不阻塞。

## 在 Node 里连 Redis

> [!WARNING]
> 客户端库的维护状态会变：Redis 官方目前主推 node-redis，ioredis 的更新节奏较慢。本书按 ioredis 5.x 的 API 写。选型前看一下两个仓库最近的发版记录和 BullMQ 文档对客户端的要求，以官方最新说明为准。

Node 有两个主流客户端：**ioredis** 和官方的 **node-redis**。本书用 ioredis，原因很实际：BullMQ 依赖它，一个项目里用同一个客户端，连接配置写一份就够了。

```bash
pnpm add ioredis
```

```typescript
// src/redis/redis.provider.ts
import { Logger, Provider } from "@nestjs/common";
import Redis from "ioredis";

export const REDIS = Symbol("REDIS");

export const redisProvider: Provider = {
  provide: REDIS,
  useFactory: () => {
    const logger = new Logger("Redis");
    const client = new Redis(process.env.REDIS_URL!, {
      // 普通命令：连不上时最多重试 3 次就报错，别让请求一直挂着
      maxRetriesPerRequest: 3,
      // 断线重连的间隔：50ms 起步，封顶 2 秒
      retryStrategy: (times) => Math.min(times * 50, 2000),
      enableOfflineQueue: true,
    });
    client.on("error", (err) => logger.warn(`Redis 错误：${err.message}`));
    client.on("ready", () => logger.log("Redis 已连接"));
    return client;
  },
};
```

```typescript
// src/redis/redis.module.ts
import { Global, Inject, Module, OnApplicationShutdown } from "@nestjs/common";
import type Redis from "ioredis";
import { REDIS, redisProvider } from "./redis.provider";

@Global()
@Module({ providers: [redisProvider], exports: [REDIS] })
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    await this.redis.quit(); // 发 QUIT，等已发出的命令都回来再断
  }
}
```

两个配置值得解释：

- **`error` 事件一定要监听**。ioredis 断线时会发 `error`，没有监听器的话 Node 会把它当未处理的错误打出一大堆栈
- **`maxRetriesPerRequest`** 决定 Redis 不可用时，一条命令最多等多久才失败。缓存场景要它尽快失败（然后降级去查库）；BullMQ 的 Worker 连接则必须设成 `null`（第 5 章），两种用途最好用两个连接

`REDIS_URL` 的格式是 `redis://:密码@redis:6379/0`，用 TLS 时是 `rediss://`。它和其他环境变量一样在启动时校验，写法见[《NestJS 后端架构》的配置一章](../nestjs-backend/07-config-env.md)。

## 在 compose 里起一个 Redis

本地和单机生产都可以这样起：

```yaml
services:
  redis:
    image: redis:7.4-alpine
    restart: unless-stopped
    command:
      - redis-server
      - --requirepass
      - ${REDIS_PASSWORD}
      - --maxmemory
      - 256mb
      - --maxmemory-policy
      - noeviction
      - --appendonly
      - "yes"
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a \"$$REDIS_PASSWORD\" --no-auth-warning ping | grep -q PONG"]
      interval: 10s
      timeout: 3s
      retries: 5
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD}
    # 不写 ports：只在 compose 网络内可达，不暴露到宿主机

volumes:
  redisdata:
```

`maxmemory-policy noeviction` 和 `appendonly yes` 这两项是为队列准备的，为什么这么配、只做缓存时又该怎么配，第 4 章细讲。镜像该选 `redis` 还是 `valkey/valkey`，第 9 章讲许可证的时候再说，这里两者的命令完全一样。

> [!IMPORTANT]
> Redis 绝不能暴露到公网。不写 `ports`，或者只绑 `127.0.0.1`，再加上密码。公网上裸奔的 Redis 是被批量扫描和植入挖矿程序的常见入口。

## 本章要点

- Redis 是单线程执行命令的内存数据结构服务器：单条命令原子，慢命令卡全局，持久化是「尽量不丢」
- 不要把它当远程 `Map<string, string>`：计数用 `INCR`，对象用 Hash，按时间排序用 Sorted Set
- 队列不要用 List 手写，用 BullMQ；Pub/Sub 不在线就丢，只能做通知
- 键名就是 schema：冒号分层、租户 id 进键名、带版本号、除队列外都带 TTL；生产不用 `KEYS`
- Node 客户端用 ioredis，监听 `error`；缓存连接要快速失败，队列连接另开
- Redis 只在内网可达，必须设密码
