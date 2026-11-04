# 容器里跑数据库的取舍

「数据库不要放在 Docker 里」是一句流传很广的话。hatch-counter 恰恰就是这么做的：生产库是 compose 里的一个 `postgres:16-alpine` 容器。这一章回到这个问题本身：容器给数据库带来了哪些真实的风险、每一条怎么防，什么时候该搬到宿主机安装或托管数据库，以及搬家时会遇到什么。最后整理一份 compose 里跑 Postgres 的完整配置，作为全书的收尾。

## 先说结论

数据库放在容器里，**性能上几乎没有损失，风险主要来自操作**。

性能方面：数据放在卷上，卷是宿主机文件系统上的一个普通目录，读写不经过镜像的联合文件系统；网络走 compose 的 bridge，多出来的开销相对一次查询可以忽略。数据库进程本身就是宿主机上的普通进程，只是被 namespace 和 cgroup 隔离（原理见[《容器技术》](../docker-containers/)）。

风险方面，下面这张表是容器特有、或者因为容器而更容易发生的问题：

| 风险 | 怎么发生 | 防法 |
|---|---|---|
| 数据跟着容器消失 | 没挂卷，数据在容器可写层；`docker rm` 就没了 | 必须用命名卷 |
| 误删卷 | `docker compose down -v`、`docker volume prune`、`docker system prune --volumes` | 不在生产机上用这些命令；备份在别处 |
| 关机时被强杀 | 停止超时后容器被 SIGKILL，下次启动要做崩溃恢复 | 调大 `stop_grace_period` |
| 被 OOM 杀掉 | 给容器设了内存上限，Postgres 内存加起来超过它 | 内存上限与 `shared_buffers`、`work_mem` 一起规划 |
| 共享内存不够 | Docker 默认 `/dev/shm` 只有 64MB | 设 `shm_size` |
| 日志撑满磁盘 | 容器日志默认不轮转 | 配置 json-file 的 `max-size` / `max-file` |
| 意外暴露端口 | `ports: "5432:5432"` 会绕过部分防火墙规则直接对外 | 不映射端口，只走 compose 内网 |
| 镜像标签漂移 | 写成 `postgres:latest`，某天拉到了新的大版本 | 至少固定到大版本，如 `16-alpine` |

逐条看几个需要展开的。

### 停止超时

`docker compose stop` 或重启机器时，Docker 先给容器发停止信号，等一段时间（默认 10 秒），超时就发 SIGKILL 强杀。官方 Postgres 镜像把停止信号设为 SIGINT，对应 Postgres 的「快速关闭」：断开所有连接、回滚未提交事务、做一次检查点再退出。

问题在最后那个检查点：写入量大的时候，把内存里的脏页全部刷盘可能超过 10 秒。被强杀不会丢已提交的数据（WAL 已经落盘），但下次启动要做崩溃恢复，启动变慢。给它多一点时间：

```yaml
    stop_grace_period: 60s
```

### 内存上限和 OOM

如果你给 Postgres 容器设了内存上限（`mem_limit` 或 `deploy.resources.limits.memory`），cgroup 会在超出时触发 OOM killer。被杀的如果是某个 backend 进程，postmaster 会认为共享内存可能已损坏，**断开所有连接并重新初始化**，整个库会短暂不可用。

所以内存上限要和第 1 章的参数一起算：`shared_buffers` + 最坏情况下的 `work_mem` 总量 + `maintenance_work_mem` × autovacuum worker 数 + 每个连接的基础开销，都要放得下。hatch-counter 没有设内存上限，让 Postgres 和服务端共享整台机器的内存，在单机上这是更简单的选择，代价是它们之间没有隔离。

### 误删卷

这是容器特有的、最致命的一类事故，因为命令看起来很无害：

```bash
docker compose down -v       # -v 会删除 compose 文件里声明的命名卷
docker system prune --volumes
```

在开发机上随手敲惯了，某天在生产机上也敲了一遍。防法只有两条：生产机上不用这些命令（可以在运维手册里明确写下来），以及**备份不在这台机器上**（第 2 章的 3-2-1）。

## 三种部署形态

| | compose 里的容器 | 宿主机直接安装 | 托管数据库 |
|---|---|---|---|
| 费用 | 机器自带，不另花钱 | 同左 | 按规格另付，同等配置通常贵不少 |
| 安装与配置 | 写进 compose，进 Git，可复现 | apt 安装官方源，配置在 `/etc` | 控制台点选，参数通过参数组修改 |
| 备份 / PITR | **自己做**（第 2、3 章） | 自己做 | 勾选即可，一般支持按时间点恢复 |
| 高可用 | 自己搭（第 4 章） | 自己搭 | 多可用区选项，自动切换 |
| 大版本升级 | 自己做（第 8 章） | 自己做，`pg_upgrade` 更方便 | 控制台操作，仍需停机窗口和测试 |
| 超级用户与扩展 | 完全控制 | 完全控制 | 没有真正的 superuser，扩展只能从白名单里选 |
| 监控 | 自己搭 | 自己搭 | 自带基础监控 |
| 一人运维的时间成本 | 中 | 中 | 低 |

宿主机直接安装和容器相比，主要优势是 `pg_upgrade` 更方便（官方软件源允许多个大版本并存）、少一层 Docker 的操作风险；劣势是配置散落在宿主机上，不如 compose 文件集中、可复现。对已经全面使用 compose 的项目，**没有必要为了「数据库别放容器」而单独改成宿主机安装**。

真正的分水岭在「自建」和「托管」之间：你是在用钱换时间和风险。

## hatch-counter 的选择

hatch-counter 的部署文档里写得很清楚：compose 里的自建 Postgres 是**过渡形态**，正式运营后会迁到托管数据库，到时备份、PITR 都是勾选项。所以当前只配置了云盘自动快照，不维护一套自建的备份体系，因为那意味着要多保管一把密钥、一套保留策略，还要每月演练。作者把「退不回昨天下午」「捞不出单独一家店」作为**已知风险**记录下来，并规定手动改库之前先手动创建一次快照。

这是一个清醒的取舍：风险是被看见并接受的，而不是被忘记的。在这个基础上，本书的建议是两点：

1. **第 2 章那个每日 `pg_dump` 的 systemd timer 成本很低**，几十行脚本，不需要额外的密钥（异地上传除外）。它能补上「捞出一家店」和「快照之外的另一条退路」，在迁到托管之前值得加上
2. **加磁盘告警**。自建 Postgres 在磁盘满时会停止写入，而 WAL 归档失败、复制槽、日志都可能悄悄吃掉磁盘

WAL 归档和从库则可以不做，等迁到托管数据库后由平台提供。

## 迁到托管数据库时会遇到什么

从 compose 迁到云厂商的托管 Postgres，流程上就是第 8 章的 dump / restore（数据量大、要求停机短时用逻辑复制）。但有几个坑和 hatch-counter 的设计直接相关，要提前知道：

- **没有真正的 superuser**。托管数据库给你的最高权限角色通常不是 superuser。hatch-counter 的迁移脚本假设 `counter` 是超级用户（官方镜像的 `POSTGRES_USER` 就是），迁移里建角色、建 RLS 策略、建触发器的语句要逐条确认在受限权限下能否执行
- **角色导出拿不到密码**。`pg_dumpall --roles-only` 要读系统表 `pg_authid` 里的密码哈希，托管环境通常不允许，要加 `--no-role-passwords`，然后在新库上重新给 `counter_app`、`counter_admin` 设密码
- **扩展白名单**。用到的扩展要确认在白名单内。`pg_stat_statements` 一般都支持
- **连接数上限和规格挂钩**。小规格实例的 `max_connections` 可能比你想象的小，结合第 5 章评估是否需要连接池，有的厂商也提供托管的连接池
- **网络**。托管库在 compose 网络之外，要走私有网络（VPC）连接，并确认安全组只允许应用服务器访问。连接要开 TLS
- **参数调整方式不同**。第 1 章那些写在 compose `command` 里的参数，要改到厂商的参数组里，部分参数不允许修改

具体限制各家不同、也会变化，请以所选厂商的官方文档为准。迁移前在托管库的最小规格实例上把第 2 章的恢复演练和服务端测试完整跑一遍，是发现这些问题最便宜的办法。

## 完整配置：compose 里的 Postgres

把全书各章的配置汇总在一起，这是一份在单机 compose 里跑 PostgreSQL 16 的参考配置，适合 4GB 内存、SSD 的云服务器：

```yaml
name: counter

services:
  postgres:
    image: registry.example.com/counter/postgres:16-alpine   # 固定大版本，私有仓库转存
    restart: unless-stopped
    env_file: postgres.env                                   # 密码不进 compose，不进 Git
    shm_size: 256mb                                          # 第 1 章
    stop_grace_period: 60s                                   # 本章
    command:
      - postgres
      # 内存与规划器（第 1 章）
      - -c
      - shared_buffers=1GB
      - -c
      - effective_cache_size=3GB
      - -c
      - work_mem=16MB
      - -c
      - maintenance_work_mem=256MB
      - -c
      - random_page_cost=1.1
      - -c
      - max_wal_size=2GB
      # 护栏（第 1 章）
      - -c
      - idle_in_transaction_session_timeout=5min
      # 观测（第 6 章）
      - -c
      - shared_preload_libraries=pg_stat_statements
      - -c
      - track_io_timing=on
      - -c
      - log_min_duration_statement=500ms
      - -c
      - log_lock_waits=on
      - -c
      - log_temp_files=0
      # 清理（第 7 章）
      - -c
      - autovacuum_vacuum_cost_limit=1000
      # WAL 归档（第 3 章）
      - -c
      - archive_mode=on
      - -c
      - archive_command=test ! -f /wal-archive/%f && cp %p /wal-archive/%f
      - -c
      - archive_timeout=300
    volumes:
      - pgdata:/var/lib/postgresql/data          # 18 起改为 /var/lib/postgresql（第 8 章）
      - /srv/pg-backups/wal:/wal-archive
      - /srv/pg-backups/base:/base-backup
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U counter -d counter"]
      interval: 10s
      timeout: 3s
      retries: 12
    logging:
      driver: json-file
      options: { max-size: "20m", max-file: "3" }
    # 不写 ports：只在 compose 内网可达

volumes:
  pgdata:
```

配套的宿主机侧：

| 事项 | 章节 |
|---|---|
| 每日 `pg_dump` + 角色导出的 systemd timer，异地一份 | 第 2 章 |
| 每季度一次恢复演练，记录耗时 | 第 2 章 |
| 每周基础备份，监控 `pg_stat_archiver` | 第 3 章 |
| 业务角色设置 `statement_timeout`、`lock_timeout` | 第 1 章 |
| 热表单独调低 `autovacuum_vacuum_scale_factor` | 第 7 章 |
| 磁盘、备份心跳、`age(datfrozenxid)` 告警 | 第 2、7 章 |
| 小版本及时升，大版本前彩排 | 第 8 章 |

## 本章要点

- 数据库放在容器里性能几乎无损，风险主要来自操作：卷、停止超时、OOM、共享内存、日志、端口
- 用命名卷，生产机上不用 `down -v` 和 `prune --volumes`；`stop_grace_period` 给足检查点时间
- 已经用 compose 的项目，没必要为此改成宿主机安装；真正的分水岭是自建还是托管
- hatch-counter 把自建库当作过渡形态，风险已记录；迁移前补一个每日 `pg_dump` 和磁盘告警性价比最高
- 迁到托管库要注意：没有 superuser、导不出角色密码、扩展白名单、连接数随规格、参数组

## 动手练习

都在本机一次性容器里做，不要在生产机上试 `down -v`、`prune` 或强杀。

1. **没挂命名卷，数据去哪了**：`docker run -d --name nov -e POSTGRES_PASSWORD=x postgres:16-alpine`，建一张表插几行，然后 `docker rm -f nov`，用同样的命令再起一个 `nov` 查这张表。最后执行 `docker volume ls -f dangling=true`。

   验证：新容器里报 `relation ... does not exist`；`dangling` 列表里多出一个长串哈希名的匿名卷，旧数据就在里面，但没有任何容器再引用它。

   参考答案：官方镜像声明了 `VOLUME`，不挂命名卷时 Docker 会建匿名卷；新容器拿到的是另一个新的匿名卷。一次 `docker volume prune` 就能把旧数据彻底清掉，所以生产必须用命名卷。清理：`docker rm -f nov` 后对那个匿名卷执行 `docker volume rm`。

2. **被强杀之后的启动**：`docker run -d --name stopx -e POSTGRES_PASSWORD=x -v stopx:/var/lib/postgresql/data postgres:16-alpine`，插入一些数据，然后分别用 `docker stop stopx`（正常停止）和 `docker kill stopx`（直接 SIGKILL）停掉，每次停完 `docker start stopx`，看 `docker logs stopx` 的最后几行。

   验证：正常停止后，启动日志里是 `database system was shut down at ...`；强杀后是 `database system was interrupted ...`，接着出现 `redo starts at ...` 的崩溃恢复。两种情况下已提交的数据都在。

   参考答案：强杀不丢已提交数据（WAL 已落盘），但下次启动要重放 WAL。`stop_grace_period` 给快速关闭留出做检查点的时间，避免走到这一步。清理：`docker rm -f stopx; docker volume rm stopx`。

3. **内存上限下的 OOM**：`docker run -d --name oom --memory=256m -e POSTGRES_PASSWORD=x postgres:16-alpine`，在 psql 里执行 `SET work_mem = '1GB';` 后跑 `SELECT count(*) FROM (SELECT g, count(*) FROM generate_series(1, 20000000) g GROUP BY g) s;`，同时另开一个终端连着这个库。

   验证：查询失败，`docker logs oom` 里有 `server process (PID ...) was terminated by signal 9: Killed` 和 `terminating any other active server processes`，另一个终端的连接也被断开。没触发时把行数再加大。

   参考答案：被 cgroup 杀掉的是一个 backend，postmaster 却要断开所有连接、重新初始化共享内存，整个库短暂不可用。设内存上限时要把 `work_mem` 的最坏情况一起算进去。清理：`docker rm -f oom`。

到这里，这本书讲完了单个数据库从调参到升级的全部日常运维。下一步推荐读[《一人运维手册》](../production-ops/)，把数据库放回整台服务器、整个产品的视角里，讲加固、容灾演练、事故响应和值班制度；想把本书里提到的那些告警真正搭起来，读[《可观测性与性能》](../observability-performance/)。
