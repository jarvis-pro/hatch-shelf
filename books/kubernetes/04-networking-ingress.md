# 网络与 Ingress

Compose 版的流量入口是宿主机上的 nginx：按域名分流、终结 TLS、把 `/v1/` 反代到 `127.0.0.1:3000`，证书靠 certbot 定时续期。这一章把这一层搬进集群：先理解 K8s 的网络模型和 Service 的几种类型，再用 **Ingress** 替代 nginx 的反代配置，用 **cert-manager** 替代 certbot，最后用 **NetworkPolicy** 把数据库圈起来。

## K8s 的网络模型

K8s 对网络只提了几条要求，具体实现交给 CNI 插件：

- 每个 Pod 有自己独立的 IP
- 所有 Pod 之间不经 NAT 就能直接互通，无论在不在同一个节点
- 节点上的进程能访问本节点所有 Pod

这和 Docker 默认的 bridge 网络很不一样：Docker 里每个 compose 项目一张网，容器间隔离靠网络边界；K8s 是**一张扁平的大网**，默认人人互通，隔离要靠 NetworkPolicy 额外声明。k3s 默认的 CNI 是 Flannel，单机集群上你基本感觉不到它的存在。

在这张网上，有三层地址：

| 地址 | 稳定吗 | 谁用 |
|---|---|---|
| Pod IP | 不稳定，Pod 重建就变 | 几乎不直接用 |
| Service ClusterIP + DNS 名 | 稳定 | 集群内部服务互相访问 |
| Ingress / LoadBalancer 对外地址 | 稳定 | 集群外的客户端 |

## Service 的类型

第 2 章写的 Service 没指定 `type`，默认是 ClusterIP。完整的选择是：

| 类型 | 能从哪访问 | 典型用途 |
|---|---|---|
| ClusterIP | 只在集群内 | 绝大多数内部服务：api、postgres |
| NodePort | 每个节点 IP 的某个高位端口（默认 30000–32767） | 调试，或者前面还有一层外部负载均衡 |
| LoadBalancer | 云厂商分配的外部 IP | 云上托管集群对外暴露入口 |
| ClusterIP: None（headless） | 没有虚拟 IP，DNS 直接返回各 Pod IP | StatefulSet，第 5 章用到 |

在自建的单机 k3s 上，没有云厂商来分配 LoadBalancer IP。k3s 自带一个叫 **ServiceLB** 的简易实现：给每个 LoadBalancer 类型的 Service 在节点上起一个小代理，直接占用节点的对应端口。k3s 自带的 Traefik 就是用这种方式占住了节点的 80 和 443。

一个推论：**k3s 装好后，节点的 80/443 已经被 Traefik 占了**，宿主机 nginx 和它不能同时监听这两个端口。第 7 章会讨论两种迁移路线：让 Traefik 接管入口，或者暂时关掉 Traefik、让 nginx 继续站在前面。

### 集群 DNS

CoreDNS 给每个 Service 一个 DNS 名：

```text
<service>.<namespace>.svc.cluster.local
```

同一命名空间内只写 `<service>` 就行，跨命名空间写 `<service>.<namespace>`。所以 hatch-counter 的连接串里写 `postgres:5432`，前提是 Postgres 的 Service 叫 `postgres` 并且和 api 在同一个命名空间。

排查 DNS 问题时，起一个临时 Pod 进去查：

```bash
kubectl -n counter run dns-test --rm -it --image=busybox:1.36 --restart=Never -- nslookup postgres
```

## Ingress：集群的 HTTP 入口

> [!WARNING]
> 本节关于 ingress-nginx 的状态按 2026 年 11 月 Kubernetes 官方博客（2025-11-11《Ingress NGINX Retirement: What You Need to Know》）和 github.com/kubernetes/ingress-nginx 的归档说明整理；各控制器的维护状况变化较快，以 Kubernetes 文档的 Ingress 控制器列表为准。

Service 工作在 TCP/UDP 层，不懂域名和路径。按域名、按路径分流、终结 TLS 这些 HTTP 层的事，交给 **Ingress**。

Ingress 分两部分，这一点要先搞清楚：

- **Ingress 对象**：你写的路由规则，「某个域名的某个路径转给某个 Service」
- **Ingress 控制器**：真正干活的反向代理，它 watch 所有 Ingress 对象，把规则翻译成自己的配置

只写 Ingress 对象而集群里没有控制器，什么都不会发生。常见的控制器：

| 控制器 | 说明 |
|---|---|
| Traefik | k3s 默认自带，配置通过 Ingress 注解和它自己的 CRD（Middleware 等） |
| ingress-nginx | 社区维护多年的 nginx 实现，**已于 2026 年 3 月退役**：不再发布新版本、不修缺陷也不修安全漏洞，GitHub 仓库已归档为只读。已有部署还能继续跑、镜像和 chart 也还能下载，但新集群不应再选它，在用的要尽快迁走 |
| 各云厂商的控制器 | 把 Ingress 翻译成云上的负载均衡器 |

另外要知道 **Gateway API**：它是 Ingress 的继任者，用 `Gateway`、`HTTPRoute` 等对象把「基础设施管理员」和「应用开发者」的职责拆开，表达能力也更强（流量切分、请求头匹配等）。Ingress API 本身已冻结、不再加新功能，但仍是稳定 GA 的 API，不会被移除。对单人单机的场景，Ingress 足够简单，本书用它；k3s 自带的 Traefik 也支持 Gateway API，迁过去长什么样见本章后面的[Gateway API 最小示例](#gateway-api最小示例)。

顺带一提 ingress-nginx 的退役原因：Kubernetes 安全响应委员会的公告说得很直接，项目长期只有一两个人业余维护，又背着大量历史包袱（比如允许在注解里写任意 nginx 配置片段），安全问题修不过来。官方给出的建议是迁到 Gateway API，或者换一个仍在维护的 Ingress 控制器。退役的只是这个 Ingress 控制器项目，nginx 本身和[《Nginx 与反向代理》](../nginx-gateway/)里讲的宿主机 nginx 照常维护。

### hatch-counter 的入口规则

Compose 版的 nginx 按域名分了好几个站。迁移时先处理两个和服务端有关的：

- `api.example.com`：整站转给服务端（移动端用）
- `app.example.com`：网页端静态文件，`/v1/` 转给服务端

网页端的静态文件原本由宿主机 nginx 直接从磁盘上读。迁进集群的一个简单做法是：CI 构建网页端时，把产物打进一个 nginx 镜像，在集群里跑成一个小 Deployment（`counter-web`），配一个同名 Service。这样网页端的发布也变成了「换镜像 tag」，和服务端一个模式。

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: counter
  namespace: counter
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
    traefik.ingress.kubernetes.io/router.middlewares: counter-redirect-https@kubernetescrd
spec:
  ingressClassName: traefik
  tls:
    - hosts:
        - api.example.com
        - app.example.com
      secretName: counter-tls
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: counter-api
                port:
                  name: http
    - host: app.example.com
      http:
        paths:
          - path: /v1
            pathType: Prefix
            backend:
              service:
                name: counter-api
                port:
                  name: http
          - path: /
            pathType: Prefix
            backend:
              service:
                name: counter-web
                port:
                  name: http
```

几个要点：

- **`ingressClassName`** 指定由哪个控制器处理。集群里只有一个控制器时也建议写上，免得以后多装一个时规则被抢
- **`pathType: Prefix`** 按路径段匹配：`/v1` 匹配 `/v1` 和 `/v1/stores`，但不匹配 `/v1abc`。同一个 host 下更长的路径优先，所以 `/v1` 会先于 `/` 生效
- **路径不改写**：请求 `/v1/stores` 到达服务端时还是 `/v1/stores`。这和原 nginx 配置 `proxy_pass` 不带路径的写法效果一致，服务端的路由本来就带 `/v1` 前缀
- **`tls`** 声明这两个域名用 `counter-tls` 这个 Secret 里的证书。这个 Secret 不用手动建，下面的 cert-manager 会根据注解自动申请并写入

### HTTP 跳转 HTTPS：Traefik Middleware

注解里引用的 `counter-redirect-https@kubernetescrd` 是 Traefik 的一个 Middleware 对象，格式是「命名空间-名字@来源」：

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: redirect-https
  namespace: counter
spec:
  redirectScheme:
    scheme: https
    permanent: true
```

已经是 HTTPS 的请求不会被重定向，所以同一个 Ingress 同时服务 80 和 443 不会循环跳转。Middleware 还能做限流（`rateLimit`）、Basic Auth、加响应头等，相当于把 nginx 配置里那些 `location` 块里的指令拆成了可复用的对象。

`traefik.io/v1alpha1` 是 Traefik 自己的 CRD 版本号，名字里虽然带 alpha，却是 Traefik 2.10 之后和 3.x 的正式写法；更早的版本用的是 `traefik.containo.us/v1alpha1`。CRD 的版本跟着控制器走，升级 k3s 时要留意它附带的 Traefik 大版本变化。

### 搬过来时别忘了的几处细节

原 nginx 配置里有几处「不配会出事」的设置，换成 Traefik 要逐一对上：

| nginx 里的设置 | 原因 | 在 Traefik 里 |
|---|---|---|
| `client_max_body_size` 调大 | 服务端请求体上限 12MB（拍照的进货单、整月的收银报表），nginx 默认 1MB | Traefik 默认不限制请求体大小；如果你加了 Buffering 中间件，要把它的上限设到 12MB 以上 |
| SSE 长连接不缓冲、超时放宽 | 网页端有一条推送长连接 | Traefik 默认流式转发响应；入口的超时配置以所用版本的文档为准，上线后实测一条连接能挂多久 |
| `X-Forwarded-For` / `X-Forwarded-Proto` | 服务端要知道真实客户端 IP 和协议 | Traefik 默认会设置这两个头 |

最后一行牵出 `TRUST_PROXY` 该填几的问题。请求路径是：客户端 → Traefik → api Pod。对服务端来说直接连它的是 Traefik，只隔一层，所以 Express 的 `trust proxy` 填 `1`。但这里有个坑：k3s 的 ServiceLB 默认会对进来的连接做 SNAT，Traefik 看到的源地址是节点内部地址而不是真实客户端，它写进 `X-Forwarded-For` 的自然也是错的。解决办法是把 Traefik 的 Service 改成 `externalTrafficPolicy: Local`，保留源 IP。k3s 用一个 `HelmChartConfig` 对象覆盖内置 Traefik 的配置：

```yaml
apiVersion: helm.cattle.io/v1
kind: HelmChartConfig
metadata:
  name: traefik
  namespace: kube-system
spec:
  valuesContent: |-
    service:
      spec:
        externalTrafficPolicy: Local
```

把它放进 `/var/lib/rancher/k3s/server/manifests/traefik-config.yaml`，k3s 会自动应用并重新部署 Traefik。改完以后用一个会打印客户端 IP 的接口实测，确认看到的是你自己的公网 IP。限流、登录风控都依赖这个值，错了的后果是「所有人共享一个限流额度」。

## cert-manager：证书自动续期

cert-manager 是一个控制器，它定义了 `Certificate`、`Issuer` 等 CRD，负责向 Let's Encrypt 这类 CA 申请证书、写进 Secret、到期前自动续期。安装通常用它官方的 Helm chart 或发布页上的清单（以官方文档为准），装好后在 `cert-manager` 命名空间里会有三个 Deployment。

然后建一个集群级的签发者：

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ops@example.com
    privateKeySecretRef:
      name: letsencrypt-account-key
    solvers:
      - http01:
          ingress:
            ingressClassName: traefik
```

流程是这样的：

```mermaid
sequenceDiagram
  participant I as Ingress（带注解）
  participant CM as cert-manager
  participant LE as Let's Encrypt
  participant T as Traefik
  CM->>I: 发现注解，创建 Certificate
  CM->>LE: 下单，拿到 HTTP-01 挑战
  CM->>T: 建临时 Ingress，响应挑战路径
  LE->>T: 访问挑战 URL 验证域名
  LE-->>CM: 签发证书
  CM->>CM: 写进 counter-tls Secret，到期前自动续
```

几个实践建议：

- 先用 Let's Encrypt 的 **staging** 地址（`acme-staging-v02`）调通再切正式地址，正式环境有频率限制，调试时反复失败可能被临时封
- HTTP-01 要求 80 端口能从公网访问到 Traefik。如果服务器在境内且域名未备案，80/443 可能根本不通，这是合规问题而不是技术问题
- 进度看 `kubectl -n counter get certificate,certificaterequest,order,challenge`，卡住时 `describe` 那个 challenge 一般能看到原因

和 certbot 的区别是：证书变成了集群里的一个声明式对象，续期由控制器持续调和，失败会在对象状态和事件里留下记录。但**过期告警仍然要自己做**，证书过期等于所有客户端同时连不上，最好在外部可用性监控里加一条证书剩余天数的检查。

## NetworkPolicy：把数据库圈起来

前面说过，K8s 默认 Pod 之间全通。Compose 版的 Postgres 不开端口、只在 compose 网络里可见；在 K8s 里，同集群任何 Pod 都能连 `postgres.counter:5432`。单人集群里「任何 Pod」看起来就是自己的那几个，但只要以后装了任何第三方 chart，它们就和你的数据库在同一张网上。

k3s 内置了 NetworkPolicy 的实现，可以直接用：

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: postgres-ingress
  namespace: counter
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: postgres
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchExpressions:
              - key: app.kubernetes.io/name
                operator: In
                values:
                  - counter-api
                  - counter-migrate
                  - postgres-backup
      ports:
        - protocol: TCP
          port: 5432
```

语义是：**选中了 postgres 的 Pod 之后，只放行列出的来源**，其余的入站连接一律拒绝。`from` 里只写 `podSelector` 时只匹配同一命名空间的 Pod。`postgres-backup` 是第 5 章的备份任务，要提前放进白名单，否则备份会静悄悄地连不上。

写完一定要验证「该通的通、不该通的不通」：

```bash
# 应该超时：一个不在白名单里的临时 Pod
kubectl -n counter run nettest --rm -it --image=busybox:1.36 --restart=Never -- \
  nc -zv -w 3 postgres 5432
```

## Gateway API：最小示例

> [!WARNING]
> 本节按 2026 年 11 月 k3s 官方文档（docs.k3s.io 的 Networking Services 页）和 Traefik 官方文档整理。k3s 自带的 Traefik 版本、chart 的默认值、支持的 Gateway API 版本都在随 k3s 版本变化，动手前以你所用 k3s 版本的文档和 release notes 为准。

本书用 Ingress，因为它对单机足够。但 ingress-nginx 退役之后，Gateway API 成了社区明确推荐的方向，新文档和新教程会越来越多地用它。这里把上面的 `counter` Ingress 翻译成 Gateway API，看看对象怎么拆。

Gateway API 把 Ingress 一个对象干的事拆成三层：

| 对象 | 谁来写 | 相当于 |
|---|---|---|
| GatewayClass | 控制器自带 | `ingressClassName: traefik` |
| Gateway | 管集群入口的人 | 「在哪些端口、用哪张证书收流量」，Ingress 里的 `tls` 部分 |
| HTTPRoute | 写应用的人 | 「哪个域名的哪个路径转给哪个 Service」，Ingress 里的 `rules` 部分 |

一个人的集群里三层都是你写，拆开的好处不明显；但它的表达能力确实更强：按请求头匹配、按权重切流量做灰度、改写路径，这些在 Ingress 里要靠各控制器自己的注解，在 Gateway API 里是标准字段，换控制器不用重写。

### 第一步：打开 Traefik 的 Gateway 支持

k3s 自带的 Traefik 默认没开 Gateway API。和前面改 `externalTrafficPolicy` 一样，用 `HelmChartConfig` 打开它。注意 **`traefik` 这个 HelmChartConfig 只能有一个**，前面那段 `service` 配置要合在同一份 `valuesContent` 里：

```yaml
apiVersion: helm.cattle.io/v1
kind: HelmChartConfig
metadata:
  name: traefik
  namespace: kube-system
spec:
  valuesContent: |-
    service:
      spec:
        externalTrafficPolicy: Local
    providers:
      kubernetesGateway:
        enabled: true
```

Traefik 重新部署后，`kubectl get gatewayclass` 应该能看到一个叫 `traefik` 的 GatewayClass，状态为 Accepted。chart 也可能顺手建一个默认的 Gateway，用 `kubectl get gateway -A` 看一眼，下面我们自己写一个。

### 第二步：Gateway 和 HTTPRoute

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: counter
  namespace: counter
spec:
  gatewayClassName: traefik
  listeners:
    - name: websecure
      protocol: HTTPS
      port: 8443              # Traefik Pod 里 websecure 入口的端口，不是 443
      tls:
        mode: Terminate
        certificateRefs:
          - name: counter-tls # 还是 cert-manager 写入的那个 Secret
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: counter
  namespace: counter
spec:
  parentRefs:
    - name: counter           # 挂到上面那个 Gateway
  hostnames:
    - app.example.com
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /v1
      backendRefs:
        - name: counter-api
          port: 80            # Service 的端口，这里必须写数字
    - backendRefs:
        - name: counter-web
          port: 80
```

和 Ingress 版对照，有几处要留意：

- **listener 的端口是 Traefik 内部入口的端口**。k3s 的 Traefik Service 把节点的 443 转到 Pod 的 8443、80 转到 8000，Traefik 要求 Gateway 的 listener 端口和它自己的入口端口对上，写成 443 会报找不到对应入口。这是 Traefik 实现的细节，换别的控制器规则可能不同
- **`PathPrefix` 等价于 Ingress 的 `Prefix`**，也是按路径段匹配；没写 `matches` 的规则匹配所有路径，相当于 `/`
- **`backendRefs` 的端口只能写数字**，不能像 Ingress 那样写端口名 `http`
- **HTTP 跳 HTTPS 用标准的 `RequestRedirect` 过滤器**，不再需要 Traefik 的 Middleware：给 80 端口（Traefik 内部 8000）再开一个 HTTP listener，挂一条只有 `filters: [{ type: RequestRedirect, requestRedirect: { scheme: https, statusCode: 301 } }]` 的 HTTPRoute
- **cert-manager 也支持 Gateway API**，但需要单独打开这个功能，签证书的注解写在 Gateway 上而不是 Ingress 上，以 cert-manager 文档为准

验证方法和 Ingress 一样：`kubectl describe httproute counter` 看 `Accepted` 和 `ResolvedRefs` 两个条件是否为 True，再用 `curl --resolve` 实际请求。条件不为 True 时，`describe` 的消息一般会直接说出原因（找不到 Gateway、找不到 Service、端口不对）。

什么时候值得迁：已经用 Ingress 跑得好好的单机集群，没有必要为了迁而迁；新建集群、需要灰度切流量、或者在用 ingress-nginx 的，可以直接从 Gateway API 开始。Kubernetes 官方提供了 `ingress2gateway` 工具，能把现有的 Ingress 对象翻译成 Gateway API 对象作为起点，翻出来的结果仍然要逐条核对。

## 本章要点

- K8s 是一张扁平网络，Pod 默认互通，隔离要靠 NetworkPolicy 声明
- Service 有 ClusterIP、NodePort、LoadBalancer、headless 四种用法；k3s 的 ServiceLB 让 Traefik 直接占用节点的 80/443
- 集群内用 `<service>` 或 `<service>.<namespace>` 访问服务，Service 叫 `postgres` 就能沿用原连接串
- Ingress 对象是规则，控制器才是干活的代理；k3s 默认 Traefik，ingress-nginx 已于 2026 年 3 月退役，Gateway API 是继任者
- Gateway API 把入口拆成 GatewayClass / Gateway / HTTPRoute；k3s 的 Traefik 用 HelmChartConfig 打开，listener 端口要对上 Traefik 内部入口
- 迁移 nginx 时逐项对上请求体上限、长连接、转发头；`externalTrafficPolicy: Local` 才能拿到真实客户端 IP
- cert-manager 让证书成为声明式对象并自动续期，但过期告警仍需外部监控
- 用 NetworkPolicy 只放行 api、迁移、备份三类 Pod 访问 Postgres，并实际验证

## 动手练习

只在本机练习集群里做（按[第 2 章](02-core-objects.md#先起一个练习集群)的命令创建，已把集群的 80 映射到本机 8080），先确认 `kubectl config current-context`，沿用 `lab` 命名空间。先起两个会报出自己名字的小服务：

```bash
kubectl create deployment api --image=hashicorp/http-echo:1.0 -- /http-echo -text=api
kubectl create deployment web --image=hashicorp/http-echo:1.0 -- /http-echo -text=web
kubectl expose deployment api --port=80 --target-port=5678
kubectl expose deployment web --port=80 --target-port=5678
```

1. **Prefix 怎么匹配**：写一个 Ingress，`ingressClassName: traefik`，`host: lab.localhost`，`/v1`（Prefix）转给 `api`，`/`（Prefix）转给 `web`。apply 后先预测，再分别执行 `curl -s -H 'Host: lab.localhost' localhost:8080<路径>`，路径取 `/v1`、`/v1/stores`、`/v1abc`、`/`。

   验证：依次输出 `api`、`api`、`web`、`web`。

   参考答案：`Prefix` 按路径段匹配，`/v1abc` 的第一段是 `v1abc` 不是 `v1`，于是落到 `/`；同一个 host 下更长的路径优先。

2. **集群 DNS 的短名和全名**：执行 `kubectl run dns --rm -it --image=busybox:1.36 --restart=Never -- nslookup api`；再在另一个命名空间里试：`kubectl create namespace other`，然后 `kubectl -n other run dns --rm -it --image=busybox:1.36 --restart=Never -- nslookup api`，最后把 `api` 换成 `api.lab` 重试。

   验证：同命名空间里 `api` 能解析；在 `other` 里 `api` 解析失败，`api.lab` 能解析出同一个 ClusterIP。做完 `kubectl delete namespace other`。

   参考答案：Pod 的 DNS 搜索域先补自己的命名空间，所以短名只在同一命名空间有效，跨命名空间写 `<service>.<namespace>`。

3. **NetworkPolicy 白名单**：apply 一条策略，选中 `app=api` 的 Pod，只允许带 `role=caller` 标签的 Pod 访问 5678 端口。然后分别执行 `kubectl run t1 --rm -it --image=busybox:1.36 --restart=Never -- wget -qO- -T 3 api` 和 `kubectl run t2 --rm -it --image=busybox:1.36 --restart=Never --labels=role=caller -- wget -qO- -T 3 api`。

   验证：`t1` 超时失败；`t2` 输出 `api`。再执行一次第 1 题的 `curl -s -H 'Host: lab.localhost' localhost:8080/v1`，看它是否还能返回 `api`。

   参考答案：策略选中目标 Pod 后，只放行列出的来源，其余入站一律拒绝。经过 Ingress 的请求来自 `kube-system` 里的 Traefik，不在白名单里，所以第 1 题的请求也会被挡；真实的数据库策略只放行 api、迁移、备份，Ingress 本来就不该直连数据库。注意 Service 的端口是 80，但策略里写的是 Pod 上的端口 5678。
