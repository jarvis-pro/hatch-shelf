# 排障：dig / curl / mtr / tcpdump

前八章讲的是「每一层怎么工作、会怎么坏」，这一章把它们变成一套出事时可以照着走的流程。工具只有四个主力：`dig` 看 DNS，`curl` 看从 TCP 到 HTTP 的全过程，`mtr` 看路径上的延迟和丢包，`tcpdump` 看真正在线路上跑的包。先讲排障的方法，再逐个讲工具最有用的用法，最后用几个典型案例把它们串起来。

## 先问清楚三件事

动手敲命令之前，先把问题的范围问清楚，这一步往往比工具更能缩小范围：

| 问题 | 为什么重要 |
|---|---|
| **谁**受影响？所有人、某个地区、某个运营商、只有某个用户？ | 所有人受影响多半是服务端；部分人受影响多半是 DNS 缓存、CDN 节点、运营商线路 |
| **什么**坏了？完全打不开、慢、偶发失败、只有某个接口？ | 完全打不开查连通性；慢查延迟和丢包；偶发失败查超时和连接复用；单个接口查应用 |
| **什么时候**开始的？之前改过什么？ | 绝大多数故障发生在变更之后：发版、改 DNS、改 nginx、续证书、改安全组 |

然后**按层验证**（第 1 章）：DNS → 连通性 → 端口 → TLS → HTTP。每一层用最简单的命令确认通或不通，通了就不再怀疑它。

还有一条容易被忽略的原则：**尽量在离问题最近的地方复现**。用户说打不开，先在自己电脑上试，再在服务器本机试（`curl 127.0.0.1`），再在另一个网络（手机热点）试。几个位置的结果对比，往往直接指出问题在哪一段。

## dig：DNS 层

第 3 章已经详细讲过，这里只列排障时的固定动作：

```bash
dig +short api.example.com                  # 当前网络解析到什么
dig +short api.example.com @1.1.1.1         # 换个解析器对比
dig +short api.example.com @ns1.dnsprovider.com   # 权威服务器上的真实配置
dig +trace api.example.com                  # 委派链是否正确
dscacheutil -q host -a name api.example.com # macOS 上程序实际解析到什么
```

判断规则：权威对、公共解析器错 → 缓存未过期，等 TTL；权威就错 → 配置问题；`dig` 对、程序错 → 查 `/etc/hosts`、VPN 的 DNS 设置。

## curl：从 TCP 到 HTTP 的一站式工具

### 读懂 -v

`curl -v` 按时间顺序打印每一层发生的事，是最值得熟练掌握的输出：

```text
* Host api.example.com:443 was resolved.
* IPv4: 203.0.113.10
*   Trying 203.0.113.10:443...
* Connected to api.example.com (203.0.113.10) port 443
* ALPN: curl offers h2,http/1.1
* TLSv1.3 (OUT), TLS handshake, Client hello (1):
* TLSv1.3 (IN), TLS handshake, Server hello (2):
* SSL connection using TLSv1.3 / TLS_AES_256_GCM_SHA384
* ALPN: server accepted h2
* Server certificate:
*  subject: CN=api.example.com
*  expire date: Jan 15 08:12:03 2027 GMT
*  SSL certificate verify ok.
> GET /v1/health HTTP/2
> Host: api.example.com
>
< HTTP/2 200
< content-type: application/json
```

逐段对应：

| 输出 | 层 | 卡在这里说明 |
|---|---|---|
| `resolved` / `IPv4:` | DNS | 解析失败或解析到错误 IP |
| `Trying ...` | 网络 / 传输 | 停在 Trying 很久然后超时：防火墙丢包、IP 不对 |
| `Connected to` | TCP 握手完成 | 到这里说明端口通了 |
| `TLS handshake` / `Server certificate` | TLS | 证书错误、协议不匹配、SNI 问题 |
| `ALPN: server accepted h2` | 协议协商 | 确认是否走了 HTTP/2 |
| `>` 开头 | HTTP 请求 | 检查发出去的头对不对 |
| `<` 开头 | HTTP 响应 | 状态码和响应头 |

（不同 curl 版本的输出措辞略有差异，但顺序一致。）

### 测量每个阶段的耗时

「接口慢」时，先搞清楚慢在哪个阶段。把下面的内容存成 `~/.curl-timing`：

```text
     dns:  %{time_namelookup}s\n
 connect:  %{time_connect}s\n
     tls:  %{time_appconnect}s\n
    ttfb:  %{time_starttransfer}s\n
   total:  %{time_total}s\n
    code:  %{http_code}  proto: HTTP/%{http_version}\n
```

```bash
curl -s -o /dev/null -w @"$HOME/.curl-timing" https://api.example.com/v1/orders
```

这些时间都是**从开始累计**的，相邻两项相减才是该阶段的耗时：

| 差值 | 含义 | 偏大时查什么 |
|---|---|---|
| `dns` | 解析耗时 | 解析器慢、没有缓存 |
| `connect - dns` | TCP 握手，约等于一个 RTT | 物理距离远、线路差，考虑 CDN |
| `tls - connect` | TLS 握手 | TLS 1.2 比 1.3 多一个 RTT |
| `ttfb - tls` | 服务端处理时间（加一个 RTT） | **应用或数据库慢**，去看后端日志和慢查询 |
| `total - ttfb` | 传输响应体 | 响应太大、带宽不足、没开压缩 |

这张表能直接终结很多争论：`ttfb - tls` 占了九成，就别再折腾网络了。

### 绕过 DNS 和 CDN 直接测

```bash
# 把域名强制解析到指定 IP：测新服务器、绕过 CDN 直接测源站
# 与改 Host 头不同，--resolve 让 SNI 和证书校验都按域名进行
curl -sv --resolve api.example.com:443:203.0.113.10 https://api.example.com/v1/health

# 只改连接目标，主机名和 SNI 不变（curl 7.49+）
curl -sv --connect-to api.example.com:443:origin.internal:443 https://api.example.com/

# 指定协议版本对比
curl -s -o /dev/null -w '%{http_version}\n' --http1.1 https://api.example.com/
curl -s -o /dev/null -w '%{http_version}\n' --http2 https://api.example.com/

# 只看响应头
curl -sI https://api.example.com/
```

`--resolve` 是迁移服务器的利器：DNS 还没切，就能用真实域名和证书把新服务器完整测一遍。

`-k`（忽略证书错误）只用来确认「除了证书之外其他都正常」，看完立刻去掉。

## mtr：路径上哪一段有问题

`mtr` 结合了 `traceroute` 和 `ping`：列出到目标经过的每一跳路由器，并持续统计每一跳的丢包和延迟。

```bash
# macOS：brew install mtr，需要 sudo；Ubuntu：apt install mtr-tiny
# -r 报告模式，-w 不截断主机名，-b 同时显示主机名和 IP，-z 显示所属网络（AS 号），-c 发 100 个包
sudo mtr -rwbz -c 100 api.example.com

# 目标禁 ping 时改用 TCP 探测目标端口
sudo mtr -rwbz -c 100 -T -P 443 api.example.com
```

读 `mtr` 最重要的一条规则：**只有一直延续到最后一跳的丢包才是真丢包**。

```text
HOST                         Loss%   Snt   Last   Avg  Best  Wrst StDev
  1. 192.168.1.1              0.0%   100    1.2   1.5   0.9   4.1   0.5
  2. 100.64.0.1               0.0%   100    5.3   6.1   4.8  12.0   1.2
  3. ???                     100.0   100    0.0   0.0   0.0   0.0   0.0
  4. 202.97.x.x              35.0%   100   28.1  29.0  27.5  40.2   2.1
  5. 202.97.y.y               0.0%   100   30.2  31.0  29.8  45.3   2.6
  6. 203.0.113.10             0.0%   100  152.4 153.1 151.0 170.2   3.0
```

- 第 3 跳 100% 丢包、第 4 跳 35% 丢包，但最后一跳 0%：这些路由器只是**限制或不回应 ICMP**（它们忙着转发，懒得回答探测），不影响真实流量
- 如果从某一跳开始，之后**每一跳都有相近的丢包**，直到目标，那一跳附近才是真正的问题点
- 延迟在某一跳突然大幅增加并保持下去（这里第 5 到第 6 跳从 31ms 到 153ms），通常是跨洋或跨运营商的长链路，属于物理距离，不是故障

`mtr` 最有价值的场景是「某些用户慢」：让用户跑一份报告发给你，和你自己的对比，能看出是不是用户所在运营商到你机房的线路有问题。这类问题你修不了，但能据此决定换机房、上 CDN，或者给云厂商提工单。

## tcpdump：看线路上的真相

前面所有工具都是从「客户端视角」推测。`tcpdump` 直接抓取网卡上的包，是判断「包到底有没有到、到了之后谁没回应」的最终手段。

### 常用写法

```bash
# 抓 443 端口的包，不解析主机名和端口名（-nn），Linux 上 -i any 抓所有网卡
sudo tcpdump -nn -i any port 443

# macOS 上指定网卡（Wi-Fi 通常是 en0）
sudo tcpdump -nn -i en0 host 192.168.1.23 and port 8080

# 只看连接的建立和异常断开：SYN 和 RST
sudo tcpdump -nn -i any 'tcp port 443 and (tcp[tcpflags] & (tcp-syn|tcp-rst) != 0)'

# 打印包内容的可读字符（明文 HTTP 时能看到请求行和头部）
sudo tcpdump -nn -i any -A port 3000

# 写入文件，拿到本机用 Wireshark 分析；-c 限制包数，防止文件过大
sudo tcpdump -nn -i any -w /tmp/cap.pcap -c 5000 port 443
```

过滤表达式的基本词汇：`host`、`net 10.0.0.0/8`、`port`、`src` / `dst`、`tcp` / `udp`，用 `and` / `or` / `not` 组合。**先过滤再抓**，否则在繁忙的服务器上输出会淹没你。

### 读懂握手

一次正常的连接建立：

```text
10:21:03.112 IP 198.51.100.7.40001 > 10.0.0.5.443: Flags [S], seq 1866132571, win 64240, length 0
10:21:03.112 IP 10.0.0.5.443 > 198.51.100.7.40001: Flags [S.], seq 2203716211, ack 1866132572, win 65160, length 0
10:21:03.265 IP 198.51.100.7.40001 > 10.0.0.5.443: Flags [.], ack 1, win 502, length 0
```

`Flags` 的含义：`[S]` SYN、`[S.]` SYN-ACK、`[.]` ACK、`[P.]` 带数据、`[F.]` FIN、`[R]` RST。

服务器上抓包时，几种典型的异常形态：

| 看到什么 | 说明 |
|---|---|
| 完全没有 SYN 进来 | 包在到达主机前被丢了：安全组、上游网络、客户端连错了 IP |
| SYN 进来，没有 SYN-ACK 出去 | 主机防火墙丢了，或监听队列满了 |
| SYN 进来，立刻回 `[R]` | 端口没有进程监听（对应客户端的 `Connection refused`） |
| 同一个 SYN 每隔 1、2、4 秒重复出现 | 客户端没收到 SYN-ACK 在重传：回程路径有问题 |
| 连接中途出现 `[R]` | 有一方异常终止：进程崩溃、代理超时、中间设备清掉了连接状态 |

### HTTPS 只能看到外壳

TLS 加密后，`tcpdump` 只能看到 IP、端口、握手过程和数据包大小，看不到 HTTP 内容。这通常已经够用：判断「连没连上、谁先断开、有没有重传」不需要看内容。需要看内容时，在 nginx 到后端那一段（本机明文 HTTP，如 `port 3000`）抓，或者用 `curl -v` 和应用日志。

### 抓包的注意事项

- 抓包需要 root；生产服务器上要加过滤和 `-c` 限制，抓完立刻停
- `.pcap` 文件可能包含明文的令牌、Cookie、个人数据，用完删除，不要随手上传到公开的地方
- Docker 容器的流量可以在宿主机的 `docker0` 或对应的 `br-xxxx` 网卡上抓

## 案例串讲

### 案例 1：改了 DNS，一部分用户还在访问旧服务器

1. `dig @权威服务器` 确认新记录已生效
2. `dig @1.1.1.1`、`dig @223.5.5.5` 等对比，发现部分解析器还返回旧 IP
3. 查旧记录的 TTL：原来是 3600，所以最多要等一小时
4. 处理：旧服务器继续运行到 TTL 过完；下次迁移前先降 TTL（第 3 章）

### 案例 2：接口偶发 502

1. 不是一直坏，说明服务本身是活的，先看 nginx `error.log`
2. 日志里是 `upstream prematurely closed connection` 或 `recv() failed (104: Connection reset by peer)`，且只在请求稀疏时出现
3. 怀疑 nginx 和 Node 之间的 keep-alive 竞争：Node 先关了空闲连接，nginx 刚好复用它（第 2 章）
4. 验证：在宿主机上 `sudo tcpdump -nn -i lo port 3000 and 'tcp[tcpflags] & tcp-rst != 0'`，502 发生时能看到 RST
5. 处理：把 Node 的 `keepAliveTimeout` 调到比 nginx 的上游 keepalive 超时更长

### 案例 3：小文件能上传，大文件失败

1. 看状态码：`413` 是 nginx 的 `client_max_body_size`（默认 1 MB）；`504` 或 `499` 是超时
2. 如果是连接卡住没有状态码，用 `ping -M do -s 1472` 检查 MTU（第 7 章），尤其是在 VPN 或隧道之后
3. 如果前面有 CDN，确认 CDN 自身的上传大小限制

### 案例 4：流式输出一次性吐出

1. `curl -N https://api.example.com/v1/stream`（`-N` 关闭 curl 自己的缓冲）直连源站对比，用 `--resolve` 绕过 CDN
2. 源站直连是流式的，经过 CDN 不是：CDN 在缓冲，查 CDN 的设置
3. 源站直连也不是：nginx 在缓冲，加 `proxy_buffering off` 或让后端返回 `X-Accel-Buffering: no`（第 4 章）
4. 本机 `curl 127.0.0.1:3000` 也不是：问题在应用，检查是否在中间件里被压缩或聚合了

### 案例 5：服务器上本机 curl 正常，外部连不上

按第 7 章的清单走：`ss -tlnp` 看监听地址 → `ufw status` → 安全组 → 外部 `nc -vz` 区分超时和拒绝 → `tcpdump` 看 SYN 有没有到达。

## 一页速查

| 症状 | 第一条命令 | 详见 |
|---|---|---|
| `Could not resolve host` | `dig +short 域名`，再 `dscacheutil` / `getent` | 第 3 章 |
| 连接超时 | `nc -vz -w 3 IP 端口`，服务器上 `tcpdump` 看 SYN | 第 7 章 |
| `Connection refused` | 服务器上 `ss -tlnp` | 第 1、7 章 |
| 证书错误 | `openssl s_client -connect 域名:443 -servername 域名` | 第 5 章 |
| 502 / 504 | nginx `error.log` | 第 2、4 章 |
| 慢 | `curl -w` 分阶段计时 | 本章 |
| 部分用户慢或不通 | 用户侧 `mtr` 报告、多解析器 `dig` | 第 3 章、本章 |
| 更新了用户看不到 | `curl -sI` 看缓存头和命中状态 | 第 6 章 |
| 同一 Wi-Fi 设备互相找不到 | 比对子网、`arp -a`、检查客户端隔离 | 第 8 章 |

## 本章要点

- 先问清**谁、什么、什么时候**，绝大多数故障发生在变更之后
- 按层验证，在多个位置复现对比；下层通了就不再怀疑它
- `curl -v` 按时间顺序展示 DNS → TCP → TLS → HTTP；`-w` 分阶段计时能直接判断慢在网络还是应用
- `--resolve` 让你在不改 DNS 的情况下用真实域名测试任意服务器
- `mtr` 只认一直延续到终点的丢包；中间某跳丢包而终点不丢，通常只是不回应 ICMP
- `tcpdump` 是最终裁判：有没有 SYN、谁回了 RST、有没有重传；生产上要加过滤和数量限制，抓包文件注意保密

## 接下来读什么

这本书讲的是「网络本身」。接下来按导读的运维路线，建议读[《Nginx 与反向代理》](../nginx-gateway/)：本书里反复出现的反代、缓冲、超时、证书续期，在那里会按配置项系统展开。之后是[《部署与 CI/CD》](../deploy-release/)和[《一人运维手册》](../production-ops/)，把这些知识放进真正的发布和值守流程里。如果对容器网络还不够熟，可以回头补[《容器技术》](../docker-containers/)的网络与存储卷一章。
