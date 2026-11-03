# 运维与基础设施

一人公司最常见的死法之一，是产品做出来了却跑不稳：半夜宕机没人知道，数据库没备份，证书过期了用户先发现。这个系列的目标是让你**一个人也能把线上服务管得像有个运维团队**。

## 地基

### [Linux 系统与命令行](../linux-essentials/) · `linux-essentials`

服务器上的一切都建在这里：权限、进程、systemd、journald、磁盘，加上一套排障工具箱。如果你登上服务器时还有点心虚，就从这本开始。

### [计算机网络](../networking/) · `networking`

DNS 怎么解析、TLS 怎么握手、HTTP/2 和 HTTP/3 到底快在哪、CDN 做了什么。大部分「线上访问不了」的问题，最后都落在这本书讲的某一层。

## 交付链路

### [容器技术](../docker-containers/) · `docker-containers`

先讲容器原理（namespace、cgroup），再讲 Dockerfile、多阶段构建和 Compose 编排。hatch-counter 的线上部署就是一份 docker-compose。

### [Nginx 与反向代理](../nginx-gateway/) · `nginx-gateway`

反向代理、HTTPS 自动续期、限流、SSE / WebSocket 代理。最后一章介绍 Caddy 这类更省心的替代品。

### [部署与 CI/CD](../deploy-release/) · `deploy-release`

讲 VPS 初始化、部署脚本、零停机发布、GitHub Actions、版本号与回滚，也包括移动端和桌面端怎么发版。

### [Kubernetes 入门到实战](../kubernetes/) · `kubernetes`

K8s 是行业通用语言，值得懂；但对一人公司来说，它往往是过度设计。这本书讲核心对象和 Helm，再用 k3s 搭一个单机集群，最后一章专门讨论「什么时候不该上 K8s」。

### [基础设施即代码](../iac-gitops/) · `iac-gitops`

服务器配置写成代码，换机器、重建环境才不靠记忆。这本书讲 Terraform / OpenTofu、Ansible、GitOps 和密钥管理，并说明一个人该落地到什么程度。

### [云与边缘](../cloud-and-edge/) · `cloud-and-edge`

VPS、Serverless、托管服务怎么选，国内云和海外云怎么取舍，再加上 Cloudflare 全家桶（Workers、R2、KV、D1）。hatch-recordwall 的曲库就跑在 Worker + R2 上。

## 稳定性

### [可观测性与性能](../observability-performance/) · `observability-performance`

先看见，再优化。前半本讲日志、指标、追踪和告警，后半本讲压测、瓶颈定位和容量规划。

### [PostgreSQL 运维](../database-ops/) · `database-ops`

数据是一人公司最不能丢的东西。这本书讲备份与 PITR（按时间点恢复）、主从复制、连接池、慢查询、VACUUM 和大版本升级。

### [一人运维手册](../production-ops/) · `production-ops`

整个系列的收口：服务器加固、容灾演练、事故响应与复盘、SLO 与错误预算、成本控制，以及一个人怎么安排值班。读完会得到一份可以长期照着执行的检查清单。
