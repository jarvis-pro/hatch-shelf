# 密码与密钥：Vaultwarden

一人公司的账号多得惊人：两三个云厂商、域名注册商、DNS、镜像仓库、对象存储、应用商店开发者账号、支付平台、邮件推送、短信、每一个 SaaS 的后台，再加上每台服务器的 restic 密码、数据库超级用户密码、签名密钥的口令。它们不能放在脑子里，也不能放在备忘录里。

本章先回答一个经常被跳过的问题：**密码库到底该不该自托管**。然后部署 Vaultwarden，讲清楚它的备份为什么和其他服务不一样，最后把「人用的密码」和「机器用的密钥」分开放。

## 先想清楚：要不要自托管密码库

密码库和本书其他工具有一个本质区别：**它是你恢复其他一切的钥匙**。工具机整个没了，你要靠密码库里的云账号密码登录控制台、靠 restic 密码解开备份、靠 DNS 服务商的密码把域名指到新机器上。如果密码库本身就在那台工具机上，又没有别的副本，你就陷入了一个死循环。

所以这个问题的答案取决于你愿不愿意认真处理这个死循环：

| | 托管（Bitwarden 官方、1Password 等） | 自托管 Vaultwarden |
|---|---|---|
| 可用性 | 服务商负责，通常远高于一台工具机 | 你负责；好在客户端有离线缓存 |
| 数据位置 | 服务商的服务器，客户端加密 | 你的机器，同样客户端加密 |
| 费用 | 个人版每年几十到几百元 | 工具机的一小部分 |
| 「钥匙在锁里」的风险 | 不存在 | 必须用离线副本和应急包解决 |
| 高级功能 | 全部 | 绝大部分（见下文） |

> [!WARNING]
> 各家密码管理器的价格、免费版限制和功能范围以官网当前说明为准。

两种都是合理的选择。一个比较稳的判断：**如果你还没有用任何密码管理器，先用托管版**，把习惯养成，把散落的密码收进来；等你对「应急包、离线导出、定期演练」这几件事有把握了，再考虑迁到自托管。如果你决定自托管，下面这一章的「离线副本」和「应急包」两节一个字都不能跳。

## Vaultwarden 是什么

Vaultwarden 是用 Rust 写的、兼容 Bitwarden 客户端协议的服务端实现。它不是 Bitwarden 官方的产品，但官方的浏览器扩展、桌面端、手机 App、命令行工具都能直接连它：在客户端登录页把服务器地址改成你自己的域名即可。

和 Bitwarden 官方的自托管版相比，它的优势是轻：一个容器，SQLite 数据库，几十兆内存。官方自托管版由十来个容器组成，对一个人来说太重。

> [!WARNING]
> Vaultwarden 是第三方实现，许可证为 AGPL-3.0。它对 Bitwarden 新功能的支持有滞后，部分企业功能（如目录同步、Secrets Manager）不支持或支持有限；Bitwarden 客户端升级后偶尔需要 Vaultwarden 同步升级才能兼容。功能支持情况以 Vaultwarden 项目 Wiki 和发布说明为准。

不需要的东西本书不讲。一个人真正用到的就是：密码条目、安全笔记、TOTP 两步验证码、附件、以及和家人或合作者共享的「组织」。

## 部署

```yaml
# /srv/tools/vaultwarden/compose.yaml
name: vaultwarden

services:
  vaultwarden:
    image: vaultwarden/server:${VW_TAG:?}
    restart: unless-stopped
    env_file: .env
    environment:
      DOMAIN: https://vault.tools.example.com
      SIGNUPS_ALLOWED: "false"
      INVITATIONS_ALLOWED: "false"
      SHOW_PASSWORD_HINT: "false"
      # 管理页面的令牌，存的是哈希，见下文
      ADMIN_TOKEN: ${ADMIN_TOKEN_HASH}
    volumes:
      - data:/data
    networks: [edge]
    mem_limit: 128m

volumes:
  data:

networks:
  edge:
    external: true
```

```text
# Caddyfile 片段
vault.tools.example.com {
	import dns_tls
	import private
	reverse_proxy vaultwarden:80
}
```

几处说明：

- **必须是 HTTPS**。网页版密码库依赖浏览器的 Web Crypto API，只在安全上下文里可用；用 HTTP 访问，网页版直接打不开。第 2 章的 Caddy 已经解决了这一点
- **先开注册、建好自己的账号、再关注册**。第一次启动时临时把 `SIGNUPS_ALLOWED` 设为 `true`，注册完改回 `false` 并重建容器
- **`ADMIN_TOKEN` 存哈希而不是明文**。用容器自带的命令生成：

```bash
docker compose run --rm vaultwarden /vaultwarden hash
# 按提示输入两次管理令牌，输出一串以 $argon2id$ 开头的哈希
```

把哈希写进 `.env` 时注意，里面的 `$` 在 compose 的变量插值里有特殊含义，要写成 `$$`。管理页面（`/admin`）能看到用户列表、改服务端设置，平时用不到，用完可以把 `ADMIN_TOKEN` 删掉，彻底关掉管理页面。

> [!WARNING]
> `/vaultwarden hash` 命令、`ADMIN_TOKEN` 的哈希格式、以及管理页面里的设置会覆盖环境变量这一行为，以 Vaultwarden Wiki 的当前说明为准。

### 只对内网，手机怎么办

本书把 Vaultwarden 放在内网里，公网根本连不上。这意味着手机要一直连着第 9 章的内网才能同步。实际体验是：

- 客户端有**离线缓存**，不连内网时照样能查看和自动填充已有的密码
- 新建或修改的条目，下次连上内网时同步
- 只有「在外面、没连内网、要新建一个密码并立刻在另一台设备上用」这种情况会受影响

Tailscale 的手机客户端可以常驻后台，大多数时候你感觉不到区别。如果确实需要从公网访问，就开放到公网，同时做到三点：开两步验证；`/admin` 路径在 Caddy 里对公网 403；用 fail2ban 盯住登录失败的日志（[《一人运维手册》第 1 章](../production-ops/01-hardening.md)）。

### 邮件

Vaultwarden 发邮件的场景有：新设备登录提醒、两步验证的邮件验证码、组织邀请、紧急访问。不配邮件也能用，但建议配上新设备登录提醒。SMTP 参数用第 8 章选好的托管服务：

```bash
# .env 里追加
SMTP_HOST=<托管服务的 SMTP 主机>
SMTP_PORT=465
SMTP_SECURITY=force_tls
SMTP_FROM=vault@notify.example.com
SMTP_USERNAME=<用户名>
SMTP_PASSWORD=<密码>
```

## 备份：和其他服务不一样的地方

Vaultwarden 的数据全在 `data` 卷里：

| 文件 | 内容 | 丢了会怎样 |
|---|---|---|
| `db.sqlite3` | 所有加密后的条目、账号、组织 | 所有数据没了 |
| `attachments/` | 条目的附件 | 附件没了 |
| `rsa_key*` | 签发登录令牌的密钥 | 所有设备需要重新登录 |
| `config.json` | 管理页面里改过的设置 | 设置回到环境变量的值 |

数据库是 SQLite，正在写入时直接复制文件可能得到损坏的副本。最简单可靠的办法是**停几秒再复制**：凌晨四点没有人在用，停容器对客户端来说只是一次同步失败，下次自动重试。

```bash
#!/usr/bin/env bash
# /srv/tools/vaultwarden/backup.sh
set -euo pipefail
cd "$(dirname "$0")"
out=/srv/tools/_dumps/vaultwarden
mkdir -p "$out"

docker compose stop vaultwarden
# 无论复制成功与否都要把服务拉起来
trap 'docker compose start vaultwarden' EXIT
docker run --rm -v vaultwarden_data:/data:ro -v "$out":/out alpine \
  tar -C /data -czf /out/vaultwarden.tar.gz.tmp .
mv "$out/vaultwarden.tar.gz.tmp" "$out/vaultwarden.tar.gz"
```

`alpine` 镜像在境内同样要从自己的镜像仓库拉。卷名 `vaultwarden_data` 是 Compose 按「项目名_卷名」生成的，用 `docker volume ls` 确认。

主脚本还会顺带备份 `data` 卷的原始文件，那份里的 SQLite 可能不一致，恢复时**用 `_dumps` 里的 tar 包**。可以在 `excludes.txt` 里加一行 `/srv/docker/volumes/vaultwarden_data`，避免恢复时拿错。

### 备份里是什么

restic 备份到对象存储的这份数据，里面的密码条目本身已经是**用你的主密码派生的密钥加密过的**，Vaultwarden 服务端从来不知道明文。所以即使备份泄露，攻击者拿到的也只是密文，还需要破解你的主密码。这是密码库的备份可以放心送到云上的原因，前提是主密码足够强。

## 打破死循环：离线副本和应急包

前面说过，密码库是恢复其他一切的钥匙。为了不让「钥匙锁在箱子里」，需要两样东西放在**工具机之外**。

### 离线副本

每个月从客户端导出一份**加密的** JSON：

- 桌面端或网页版：「工具 → 导出密码库」，格式选「.json（加密）」，类型选「受密码保护」，设一个导出密码
- 导出的文件存到两个地方：你的电脑（加密磁盘上），以及一个不在工具机上的位置（比如家里的 NAS，或者一个加密的 U 盘）

这份副本在工具机完全不可用、restic 备份也一时解不开的时候，能用任何 Bitwarden 客户端（包括官方的托管版）直接导入。

> [!WARNING]
> 导出的菜单位置、格式选项和「受密码保护的导出」能否被其他客户端导入，以 Bitwarden 帮助中心的当前说明为准。不要导出未加密的 JSON 或 CSV，那是你所有密码的明文。

### 应急包

一张打印出来的纸，放在家里一个固定的地方，写着：

- Vaultwarden 的地址和你的账号邮箱
- **主密码**（或者一个只有你能懂的提示，取决于你对家里物理安全的判断）
- **两步验证的恢复码**：Vaultwarden 账号设置里生成的那一串
- 离线副本的导出密码，以及它存放在哪里
- restic 仓库的地址和密码（这是恢复工具机的起点）
- 主要云账号的登录邮箱，以及它们的两步验证恢复码存在哪

这张纸是你整个基础设施的根。写完后做一次演练：假设你的电脑和手机同时丢了，只拿着这张纸和一台借来的电脑，能不能登录密码库、拿到云账号密码、开始恢复？

如果你有家人或合作伙伴需要在你无法处理时接手，Vaultwarden 支持「紧急访问」：指定一个联系人，他申请访问后经过你设定的等待期，若你没有拒绝，他就能查看或接管你的密码库。这需要邮件功能。

## 人用的密码，机器用的密钥

密码库是给**人**用的：你登录控制台、你解开备份时需要的东西。**机器**在运行时需要的密钥（数据库连接串、API 密钥、JWT 签名密钥）不应该靠「人从密码库里复制粘贴到服务器上」来流转：

| | 例子 | 放在哪 |
|---|---|---|
| 人用的 | 云控制台密码、域名注册商密码、两步验证码 | 密码库 |
| 恢复用的根密钥 | restic 密码、SOPS 的 age 私钥、安卓签名密钥口令 | 密码库 + 应急包 |
| 机器运行时用的 | `DATABASE_URL`、第三方 API 密钥 | 在生产机上生成（[《部署与 CI/CD》第 3 章](../deploy-release/03-env-secrets.md)），或用 SOPS 加密进仓库（[《基础设施即代码》第 4 章](../iac-gitops/04-secrets.md)） |
| CI 用的 | 镜像仓库密码、部署 SSH 私钥 | Forgejo 的 Actions Secrets（第 3 章） |

中间那一行最关键：**能解开其他所有密钥的那几把根密钥**，只出现在密码库和应急包里，从不出现在任何仓库、聊天记录或网盘中。

Bitwarden 的命令行工具 `bw` 也能连 Vaultwarden，偶尔写脚本时可以用 `bw get password <条目>` 取一个值。但不要把它变成机器取密钥的常规通道：那等于让一台服务器常驻你的密码库会话，攻击面比 SOPS 大得多。

## 本章要点

- 密码库是恢复其他一切的钥匙；没用过密码管理器时先用托管版，有把握处理离线副本和应急包再自托管
- Vaultwarden 兼容官方 Bitwarden 客户端，一个容器加 SQLite；必须 HTTPS，关闭注册，管理令牌存哈希
- 放在内网里时，客户端的离线缓存让日常使用几乎无感；开放到公网就必须加两步验证、封掉 `/admin`
- SQLite 不能边写边复制：备份钩子停几秒、打包、再启动；恢复时用 dump 目录里的包
- 每月导出一份加密 JSON 放在工具机之外；打印一张应急包，写上主密码、恢复码和 restic 密码，并演练一次
- 人用的密码进密码库；能解开一切的根密钥进密码库和应急包；机器运行时的密钥走生产机生成或 SOPS，不靠复制粘贴
