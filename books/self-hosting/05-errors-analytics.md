# 错误追踪与统计：GlitchTip 与 Umami

错误追踪和网站统计是两类最值得自托管的工具：它们都在收集**用户那一侧**的数据，上报里有 URL、设备信息，有时还有一段业务内容；它们的上报地址都需要被用户的浏览器和手机稳定访问到，放在境外的服务上，国内用户的上报会丢一部分。

怎么在 NestJS、React、Expo 里接 Sentry SDK，[《可观测性与性能》第 5 章](../observability-performance/05-error-monitoring.md)已经讲完了；Umami 和 PostHog 的取舍与部署，[《数据分析与埋点》第 7 章](../product-analytics/07-self-hosting.md)也讲完了。本章只做那两章没做的事：**给 GlitchTip 一份完整的 compose，把它和 Umami 都放进第 2 章的底座，并解决它们共同的难题：一半要对公网开放，一半只能对内网**。

## 一半公开，一半私有

错误追踪和统计都有两类入口：

| 入口 | 谁访问 | 能否只对内网 |
|---|---|---|
| 上报接口 | 每一个用户的浏览器和手机 | 不能，必须公网可达 |
| 管理界面 | 只有你 | 能，也应该 |
| source map 上传 | 你的 CI | 能，runner 在内网里 |

最省事的做法是整个服务开放到公网，靠登录密码保护管理界面。本书的做法是**用 Caddy 只放行上报那几个路径**，其余路径对公网一律 403：

```mermaid
flowchart TD
  U["用户的 App"] -->|"/api/1/envelope/"| C["Caddy"]
  X["公网其他请求"] -->|"/、/login"| C
  ME["你（内网）"] -->|任意路径| C
  C -->|放行| G["GlitchTip"]
  C -->|403| D["拒绝"]
```

这样管理界面的登录页根本不暴露，撞库、爆破、未来某个版本的登录漏洞都与你无关。代价是 Caddyfile 里多几行，以及升级时要确认上报路径没有变。

## 部署 GlitchTip

为什么是 GlitchTip 而不是自托管完整版 Sentry，《可观测性与性能》第 5 章已经比较过了：GlitchTip 兼容 Sentry 的 SDK 和协议，组件只有 web、worker、Postgres 和一个 Redis 兼容的缓存，一台小机器就能跑。

> [!WARNING]
> GlitchTip 的镜像标签、环境变量名（尤其是注册开关、事件保留天数、缓存连接这几项）和 worker 的启动命令在不同大版本间有调整。下面的 compose 按写作时的官方示例整理，部署前以 GlitchTip 官网的安装文档和官方 compose 示例为准。

```yaml
# /srv/tools/glitchtip/compose.yaml
name: glitchtip

x-common: &common
  image: glitchtip/glitchtip:${GLITCHTIP_TAG:?}
  restart: unless-stopped
  env_file: .env
  environment: &env
    DATABASE_URL: postgres://glitchtip:${PG_PASSWORD}@postgres:5432/glitchtip
    REDIS_URL: redis://valkey:6379/0
    # 管理界面的地址（内网域名），见下文
    GLITCHTIP_DOMAIN: https://glitchtip.tools.example.com
    DEFAULT_FROM_EMAIL: GlitchTip <noreply@notify.example.com>
    # 关闭开放注册，只留你自己的账号
    ENABLE_USER_REGISTRATION: "false"
    # 事件保留天数，决定数据库会长多大
    GLITCHTIP_MAX_EVENT_LIFE_DAYS: "30"
    CELERY_WORKER_AUTOSCALE: "1,2"
  depends_on:
    postgres:
      condition: service_healthy
    valkey:
      condition: service_started
  volumes:
    - uploads:/code/uploads

services:
  web:
    <<: *common
    networks:
      default:
      edge:
        aliases: [glitchtip-web]
    mem_limit: 384m

  worker:
    <<: *common
    command: ./bin/run-celery-with-beat.sh
    mem_limit: 384m

  migrate:
    <<: *common
    command: ./manage.py migrate
    restart: "no"
    # 放进单独的 profile，docker compose up 时不会被一起拉起
    profiles: [migrate]

  postgres:
    image: postgres:${PG_TAG:?}
    restart: unless-stopped
    environment:
      POSTGRES_USER: glitchtip
      POSTGRES_PASSWORD: ${PG_PASSWORD}
      POSTGRES_DB: glitchtip
    volumes:
      - pg-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "glitchtip"]
      interval: 10s
    mem_limit: 256m

  valkey:
    image: valkey/valkey:${VALKEY_TAG:?}
    restart: unless-stopped
    mem_limit: 64m

volumes:
  uploads:
  pg-data:

networks:
  edge:
    external: true
```

```bash
# /srv/tools/glitchtip/.env，权限 600
GLITCHTIP_TAG=<官方发布页上的版本号>
PG_TAG=16-alpine
VALKEY_TAG=<当前稳定版>
PG_PASSWORD=<openssl rand -hex 24>
SECRET_KEY=<openssl rand -hex 32>
# 发邮件用第 8 章选好的托管服务，465 端口走 TLS
EMAIL_URL=smtp+ssl://<用户名>:<密码>@<SMTP 主机>:465
```

几处说明：

- **用 YAML 锚点（`x-common`）**让 web、worker、migrate 共用同一份镜像和环境变量，升级时只改一处版本号，三个容器不会出现版本不一致
- **`migrate` 是一次性容器**，每次升级时先用 `docker compose run --rm migrate` 跑它，再启动其他服务。放进单独的 profile，是为了让平时的 `docker compose up -d` 不去启动它
- **`valkey` 是 Redis 的开源分支**，用法完全一样。缓存里没有需要备份的数据，所以不挂卷
- **`SECRET_KEY` 生成后不要再改**，它用来签名会话等数据，改了会让已登录的会话全部失效
- **事件保留 30 天**：错误追踪的价值在「最近」，30 天前的错误要么修了、要么不重要了。数据库大小和这个数字近似成正比

启动和初始化：

```bash
cd /srv/tools/glitchtip
docker compose run --rm migrate
docker compose up -d
# 创建你的账号（关闭了注册，只能用命令行建）
docker compose exec web ./manage.py createsuperuser
```

### Caddy：只放行上报路径

Sentry 协议的上报地址形如 `/api/<项目编号>/envelope/`，旧版 SDK 还会用 `/api/<项目编号>/store/`。做法是**一个服务、两个域名**：公网域名只放行这两类路径，管理界面另起一个内网域名，指向同一个容器。

```text
# 公网域名：只做上报
errors.example.com {
	import dns_tls

	@ingest path_regexp ^/api/[0-9]+/(envelope|store)/$
	handle @ingest {
		request_body {
			max_size 2MB
		}
		reverse_proxy glitchtip-web:8000
	}

	handle {
		respond 403
	}
}

# 内网域名：管理界面、source map 上传
glitchtip.tools.example.com {
	import dns_tls
	import private
	reverse_proxy glitchtip-web:8000
}
```

为什么不在 `errors.example.com` 一个域名里用 `import private` 区分？因为这个域名在公网 DNS 上解析到工具机的**公网地址**，你在内网里访问它时，流量也走公网地址进来，`remote_ip` 不在内网地址段里，你自己也会被 403。分成两个域名，规则就简单了：公网域名只有上报，内网域名只有你。

相应地，compose 里的 `GLITCHTIP_DOMAIN` 要改成内网域名 `https://glitchtip.tools.example.com`，否则登录跳转、邮件里的链接会指向打不开的公网域名。代价是项目设置里显示的 DSN 也是内网域名，写进客户端之前，要手动把 DSN 的主机部分换成 `errors.example.com`。前端的 source map 上传（Vite 插件的 `url`）则填内网域名，它由 CI 在内网里执行。

> [!CAUTION]
> 配好之后，用一台不在内网里的手机验证三件事：管理界面打不开；用手机上的测试 App 触发一个错误，能在 GlitchTip 里看到；用 `curl` 往上报路径发一个空请求，返回的是 GlitchTip 的错误而不是 Caddy 的 403。少验证一项，就可能出现「看起来一切正常，其实一条错误都没收到」。

### 上报限流

上报接口对公网开放，就可能被刷：有人拿到你打包在前端里的 DSN，写个脚本狂发事件，把数据库撑满。DSN 本来就是公开的，这个风险无法消除，只能限制：

- Caddy 的 `request_body` 限制单次请求大小
- GlitchTip 的项目设置里可以给每个项目设置事件速率上限
- Beszel 的磁盘告警（第 4 章）是最后一道防线

如果你需要按 IP 限流，Caddy 要加第三方插件，参考[《Nginx 与反向代理》第 8 章](../nginx-gateway/08-alternatives.md)里说的 `xcaddy` 编译方式，和第 2 章的 DNS 插件一起编进去。

### 备份钩子与容量

```bash
#!/usr/bin/env bash
# /srv/tools/glitchtip/backup.sh
set -euo pipefail
cd "$(dirname "$0")"
out=/srv/tools/_dumps/glitchtip
mkdir -p "$out"
docker compose exec -T postgres pg_dump -U glitchtip -Fc glitchtip > "$out/glitchtip.dump.tmp"
mv "$out/glitchtip.dump.tmp" "$out/glitchtip.dump"
```

错误数据的备份价值不高：丢了也就是丢了最近 30 天的错误历史。之所以还是备份，是因为里面有项目配置、告警规则和已标记为「已解决」的状态，重建起来很烦。

每月看一眼库的大小：

```bash
docker compose exec postgres psql -U glitchtip -c \
  "select pg_size_pretty(pg_database_size('glitchtip'));"
```

如果它增长得比你预期快，先去看是哪个项目、哪个问题在刷屏，通常是某个错误在循环里被反复上报，修掉它或者在 SDK 里加采样，比调大磁盘更根本。

## 把 Umami 放进底座

Umami 的部署步骤按[《数据分析与埋点》第 7 章](../product-analytics/07-self-hosting.md)来。那一章的 compose 是独立部署的形态：端口绑在 `127.0.0.1`、由宿主机的 nginx 反代、自己写了一套备份脚本和 timer。放进本书的底座只需要改几处：

| 原来 | 改成 |
|---|---|
| `ports: "127.0.0.1:3000:3000"` | 去掉 `ports`，umami 容器加入 `edge` 网络 |
| 数据库卷叫别的名字 | 改名为 `pg-data`，匹配第 2 章的备份排除规则 |
| 自己的备份脚本和 timer | 删掉 timer，脚本改写成只负责导出的 `backup.sh` |
| nginx 站点配置 | 换成下面的 Caddy 配置 |
| 没有内存上限 | umami 和它的库各加 `mem_limit: 256m`（第 2 章） |

统计和错误追踪是同一个形态：统计脚本和数据收集接口要对公网，看板只对内网。

```text
stats.example.com {
	import dns_tls

	# 统计脚本和收集接口对公网；脚本名按你在 Umami 里的配置改
	@public path /script.js /api/send
	handle @public {
		reverse_proxy umami:3000
	}

	handle {
		respond 403
	}
}

umami.tools.example.com {
	import dns_tls
	import private
	reverse_proxy umami:3000
}
```

> [!WARNING]
> Umami 的统计脚本路径、数据收集接口路径（以及用来改脚本名的环境变量）以当前版本的官方文档为准；改了脚本名以绕开广告拦截时，这里的放行路径要同步改。

《数据分析与埋点》第 7 章提到过把统计脚本改名、放在自己的主域名下以减少被广告拦截的比例，那是另一个维度的考虑，和这里的「只放行公开路径」可以叠加。

### 要不要共用一个 Postgres

GlitchTip、Umami、Forgejo 各带一个 Postgres，内存上限加起来 768M。合并成一个共享实例能省下几百兆，但本书不建议：

- **升级节奏绑在一起**：某个服务的新版本要求 Postgres 17，其他服务就得一起升，或者都等着
- **故障一起出**：共享库的磁盘、连接数、锁出问题时，所有服务一起挂
- **备份和恢复变复杂**：恢复一个服务时要小心别动到其他服务的库

内存真的紧张时，先考虑让对 Postgres 依赖很轻的服务（比如 Forgejo）改用 SQLite，而不是合并数据库。

## 什么时候不用自托管它们

自托管错误追踪和统计的理由，是数据在境内、上报稳定。下面几种情况，托管服务更合适：

- **产品主要面向海外用户**：上报地址放在境内反而慢，用 Sentry、PostHog 的官方托管
- **事件量很大**：每天几十万条以上的错误事件，GlitchTip 的单机 Postgres 会开始吃力，到这个量级你的收入多半也撑得起托管服务
- **你根本不会去看**：没人看的错误列表不如没有。先确定你有每周处理一次错误的习惯（[《可观测性与性能》第 5 章](../observability-performance/05-error-monitoring.md)最后一节），再决定要不要搭

## 本章要点

- 错误追踪和统计接触用户数据、上报要稳定，是最值得自托管的两类工具
- 它们都是「一半公开、一半私有」：上报接口对公网，管理界面只对内网；用 Caddy 只放行上报路径
- 一个服务两个域名：公网域名只做上报，管理界面用内网域名；DSN 的主机部分手动改成公网域名
- GlitchTip 的 web、worker、migrate 用 YAML 锚点共用镜像和环境变量；事件保留 30 天控制库的大小
- 配好后用不在内网里的手机验证：管理界面打不开、上报能收到
- Umami 放进底座只改网络、卷名、备份钩子、入口和内存上限几处；各服务的 Postgres 不合并
