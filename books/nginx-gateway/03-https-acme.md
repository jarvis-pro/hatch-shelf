# HTTPS 与 ACME 自动续期

今天没有理由不上 HTTPS：浏览器会把 HTTP 站点标成「不安全」，Service Worker、地理位置、剪贴板等 API 只在安全上下文可用，iOS 默认禁止 App 发明文请求，而证书本身是免费的。真正的风险不在「怎么上」，而在「**哪天忘了续期**」：证书一过期，网页打不开，移动端（地址打包时写死）全部连不上，而且是在你最没准备的时候。

这一章讲 TLS 在 nginx 里怎么配，以及怎么用 ACME 协议让证书自己续期。

## TLS 终结在哪一层

```mermaid
flowchart LR
  C["客户端"] -->|"HTTPS（加密）"| N["nginx：持有证书和私钥"]
  N -->|"HTTP（明文，本机回环）"| A["后端 127.0.0.1:3000"]
```

nginx 负责握手、加解密，后端只说明文 HTTP。好处是证书只在一个地方，后端不用关心；前提是 nginx 到后端这一段**在可信网络里**，同一台机器的回环地址或 Docker 内网都满足。后端要知道原始请求是不是 HTTPS，看上一章的 `X-Forwarded-Proto`。

## 证书是怎么签出来的：ACME

Let's Encrypt 这类免费 CA 用 **ACME** 协议自动签发证书。核心问题是「怎么证明这个域名归你控制」，常用两种挑战方式：

| 挑战 | 怎么证明 | 优点 | 限制 |
|---|---|---|---|
| HTTP-01 | CA 访问 `http://域名/.well-known/acme-challenge/<token>`，能取到指定内容 | 简单，不需要 DNS 权限 | 必须开放 80 端口；不能签通配符 |
| DNS-01 | 在 `_acme-challenge.域名` 添加指定 TXT 记录 | 能签 `*.example.com`；机器可以不对公网开放 | 需要 DNS 服务商的 API 密钥 |

```mermaid
sequenceDiagram
  participant C as certbot
  participant CA as Let's Encrypt
  participant N as nginx :80
  C->>CA: 我要 api.example.com 的证书
  CA-->>C: 把 token 放到 /.well-known/acme-challenge/ 下
  C->>N: 把文件写进 webroot 目录
  CA->>N: GET /.well-known/acme-challenge/token
  N-->>CA: 返回 token 内容
  CA-->>C: 验证通过，签发证书
```

单机部署、每个子域名一张证书，HTTP-01 就够了。

## certbot 的三种模式

| 模式 | 命令 | 行为 |
|---|---|---|
| `--nginx` | `certbot --nginx -d example.com` | 自动改写你的 nginx 配置，插入证书路径和跳转 |
| `--webroot` | `certbot certonly --webroot -w /var/www/certbot -d example.com` | 只往一个目录写挑战文件，**不碰配置** |
| `--standalone` | `certbot certonly --standalone -d example.com` | 自己临时监听 80，需要先停掉 nginx |

hatch-counter 明确选了 `--webroot`，理由写在配置开头的注释里：`--nginx` 模式会就地改写 server 块，线上配置就和仓库里的不一样了；下次从仓库覆盖回去，证书配置会被一起抹掉。**配置文件要以仓库为准**，签证书的工具只负责签证书。

## 从零上线的顺序

有个先有鸡还是先有蛋的问题：完整配置里引用了证书文件，证书还没签，`nginx -t` 不过；而签证书又需要 nginx 在 80 端口上服务挑战文件。解法是**先放一份只处理挑战的临时配置**：

```bash
sudo rm -f /etc/nginx/sites-enabled/default
sudo mkdir -p /var/www/certbot

sudo tee /etc/nginx/conf.d/acme.conf >/dev/null <<'CONF'
server {
    listen 80;
    listen [::]:80;
    server_name example.com www.example.com api.example.com app.example.com;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
}
CONF
sudo nginx -t && sudo systemctl reload nginx
```

然后签证书。一张证书可以带多个名字（`-d` 写多次），也可以每个子域名一张：

```bash
sudo certbot certonly --webroot -w /var/www/certbot -d api.example.com
sudo certbot certonly --webroot -w /var/www/certbot -d app.example.com
sudo certbot certonly --webroot -w /var/www/certbot -d example.com -d www.example.com
```

第一次运行会问邮箱。一定填一个真能收到的：续期失败的提醒邮件是证书过期前唯一的预警。签好的文件在：

```text
/etc/letsencrypt/live/api.example.com/fullchain.pem   # 证书 + 中间证书链
/etc/letsencrypt/live/api.example.com/privkey.pem     # 私钥
```

`live/` 下是指向 `archive/` 的软链，续期后软链自动指向新文件，nginx 配置里的路径永远不用改。最后删掉临时配置，换上正式配置：

```bash
sudo rm /etc/nginx/conf.d/acme.conf
sudo cp site.conf /etc/nginx/conf.d/
sudo nginx -t && sudo systemctl reload nginx
```

> 国内服务器还有一个前置条件：域名未完成备案时，云厂商会在入口拦截 80 / 443 的访问，certbot 报的错看起来像 nginx 配错了。先确认 `curl -sI http://域名/` 返回的 `Server:` 是 nginx，再签证书。

## 正式配置

```nginx
# 80：只做两件事，服务 ACME 挑战、其余跳 HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name example.com www.example.com api.example.com app.example.com;

    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.example.com;

    ssl_certificate     /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    location / {
        proxy_pass http://api_backend;
        include /etc/nginx/snippets/proxy-common.conf;
    }
}
```

注意 80 端口的跳转块**必须保留** `/.well-known/acme-challenge/`：续期时 CA 仍然走 HTTP 访问挑战文件。Let's Encrypt 虽然会跟随跳转，但那样挑战文件就得在 443 的 server 块里也能取到，多一处容易漏配的地方；在 80 上直接服务掉，路径最短、最不依赖其他配置。

### http2 的两种写法

nginx 1.25.1 起推荐写成独立指令 `http2 on;`，`listen ... http2` 被标记为 deprecated。但 Ubuntu 22.04 和 24.04 自带的 nginx 分别是 1.18 和 1.24，不认识 `http2 on;`，`nginx -t` 直接报错。

hatch-counter 的选择是统一用老写法：新版本照样认，只多一句警告；新写法在老版本上起不来。用发行版自带 nginx 时这是更稳的选择。用 nginx 官方源装了新版的话，可以换成新写法：

```nginx
server {
    listen 443 ssl;
    http2 on;
    # ...
}
```

### TLS 参数要不要调

Debian / Ubuntu 打包的 `nginx.conf` 里已经有一行 `ssl_protocols`，新版本 nginx 的默认值也只开 TLS 1.2 和 1.3。对个人项目，以下几行足够：

```nginx
http {
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache   shared:SSL:10m;   # 会话复用，减少完整握手
    ssl_session_timeout 1d;
    ssl_session_tickets off;
}
```

密码套件不要凭记忆写，用 Mozilla 的「SSL Configuration Generator」按 nginx 版本和 OpenSSL 版本生成「Intermediate」档位即可。

### HSTS：上之前想清楚

```nginx
add_header Strict-Transport-Security "max-age=31536000" always;
```

HSTS 让浏览器在有效期内**只用 HTTPS** 访问这个域名。好处是防降级攻击；风险是一旦设了一年，哪天 HTTPS 出问题，用户连「点击继续访问」的选项都没有。建议先用短的 `max-age`（比如一天）跑一段时间，确认证书续期稳定再拉长。`includeSubDomains` 会波及所有子域名，加之前确认每个子域名都有 HTTPS。

## 自动续期

Let's Encrypt 证书有效期 90 天，certbot 默认在剩余 30 天以内时才真正续期。Let's Encrypt 已经宣布会逐步缩短证书有效期，具体时间表以其官方公告为准，这更说明续期**必须全自动**。

用 apt 装的 certbot 自带一个 systemd 定时器，每天运行两次 `certbot renew`：

```bash
systemctl list-timers | grep certbot      # 确认定时器在
sudo certbot renew --dry-run              # 演练一次完整续期流程
sudo certbot certificates                 # 查看每张证书的到期时间
```

### 续期后必须 reload

certbot 换了磁盘上的文件，但 nginx 进程内存里还是旧证书，**不 reload 就等于没续**。用 deploy hook 让每次续期成功后自动 reload：

```bash
sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh >/dev/null <<'SH'
#!/bin/sh
systemctl reload nginx
SH
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo certbot renew --dry-run
```

`renewal-hooks/deploy/` 下的脚本只在**真正续期成功**后执行，不会每天无谓地 reload。

hatch-counter 没有把 nginx 和 certbot 放进 Docker Compose，原因也在这里：宿主机上的 certbot 续期 + deploy hook 是现成的；塞进容器之后，「续期后通知另一个容器 reload」这套得自己拼，而这正是最不能出错的环节。

### 防止「静默过期」

自动化最怕的是悄悄坏掉。至少做一层外部检查：

```bash
# 查看线上证书的到期时间
echo | openssl s_client -connect api.example.com:443 -servername api.example.com 2>/dev/null \
  | openssl x509 -noout -enddate
```

把它放进你已有的监控（定时任务 + 告警、或者第三方的拨测服务），剩余不足 14 天就报警。可观测性的整体做法见《可观测性与性能》。

## 常见问题

| 现象 | 可能原因 |
|---|---|
| certbot 报 `Timeout during connect` | DNS 还没生效，或防火墙 / 安全组没放行 80 |
| certbot 报 `Invalid response ... 403/404` | 挑战文件路径不对：`root` 和 `-w` 不是同一个目录；或者被备案拦截 |
| `nginx -t` 报 `cannot load certificate` | 引用的证书还没签成，或路径写错 |
| 浏览器报证书链不完整（部分安卓） | `ssl_certificate` 用了 `cert.pem` 而不是 `fullchain.pem` |
| 续期成功但浏览器还显示旧到期时间 | 没有 reload |

## 本章要点

- nginx 做 TLS 终结，后端只说 HTTP；后端靠 `X-Forwarded-Proto` 知道原始协议
- ACME 用 HTTP-01（需要 80 端口）或 DNS-01（能签通配符）证明域名所有权
- 用 `certbot certonly --webroot`，不让工具改写配置，配置以仓库为准
- 首次上线先放只处理挑战的临时配置，签完证书再换正式配置
- 80 端口块保留 `/.well-known/acme-challenge/`，其余 301 到 HTTPS
- 发行版自带的老 nginx 不认 `http2 on;`，统一用 `listen 443 ssl http2` 更稳
- 续期靠 certbot 定时器，**deploy hook 里 reload nginx** 是必需的一步；再加一层外部到期监控
