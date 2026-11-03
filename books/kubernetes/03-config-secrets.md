# 配置与密钥

上一章的 Deployment 还缺一样关键的东西：环境变量。hatch-counter 的服务端在启动时用 `loadConfig()` 校验一长串配置，缺了数据库连接串或对象存储的密钥会直接退出。Compose 版把它们放在服务器上的 `api.env` 和 `postgres.env` 里。这一章把它们搬进 K8s：普通配置用 **ConfigMap**，敏感信息用 **Secret**，私有镜像仓库的登录凭证用 **imagePullSecret**，最后把 `deploy.sh` 里「先跑迁移再起服务」那一步改造成 **Job**。

## 先把配置分个类

拿 `api.env.example` 里的变量过一遍（只列变量名）：

| 变量 | 敏感吗 | 放哪里 |
|---|---|---|
| `NODE_ENV`、`PORT`、`TRUST_PROXY` | 否 | ConfigMap |
| `ACCESS_TOKEN_TTL`、`REFRESH_TOKEN_TTL_DAYS` | 否 | ConfigMap |
| `STORAGE_PROVIDER`、`STORAGE_BUCKET`、`STORAGE_ENDPOINT` | 否 | ConfigMap |
| `DATABASE_URL`、`APP_DATABASE_URL`、`ADMIN_DATABASE_URL` | 是（含密码） | Secret |
| `JWT_SECRET` | 是 | Secret |
| `SEED_ADMIN_USERNAME`、`SEED_ADMIN_PASSWORD` | 是 | Secret |
| `STORAGE_ACCESS_KEY_ID`、`STORAGE_ACCESS_KEY_SECRET` | 是 | Secret |

分开放的好处：ConfigMap 可以放心进 Git、在 code review 里看 diff；Secret 走另一条更严格的管理路径。三个数据库连接串对应 hatch-counter 的三个数据库角色：建表用的 owner、应用连的受行级安全（RLS）约束的角色、管理后台用的角色。它们迁到 K8s 后照旧分开，迁移 Job 用 owner，服务端用应用角色。

## ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: counter-api-config
  namespace: counter
data:
  NODE_ENV: production
  PORT: "3000"
  TRUST_PROXY: "1"
  ACCESS_TOKEN_TTL: 15m
  REFRESH_TOKEN_TTL_DAYS: "30"
  STORAGE_PROVIDER: oss
  STORAGE_BUCKET: counter-receipts
  STORAGE_ENDPOINT: https://oss.example.com
```

注意 `"3000"`、`"1"`、`"30"` 都加了引号。ConfigMap 的 `data` 只接受字符串，YAML 里裸写 `3000` 会被解析成数字，`kubectl apply` 直接报错。`true`、`yes`、`on` 这类词同理，YAML 1.1 会把它们当布尔值。**给 ConfigMap 里的每个值都加引号**是最省心的习惯，上面不加引号的几个只是因为它们不会被误解析。

示例里的值是演示用的，`TRUST_PROXY` 该填几，要看请求到达服务端之前经过了几层代理，第 4 章讲 Ingress 时再定。

## Secret

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: counter-api-secret
  namespace: counter
type: Opaque
stringData:
  DATABASE_URL: postgres://counter:CHANGE_ME@postgres:5432/counter
  APP_DATABASE_URL: postgres://counter_app:CHANGE_ME@postgres:5432/counter
  ADMIN_DATABASE_URL: postgres://counter_admin:CHANGE_ME@postgres:5432/counter
  JWT_SECRET: CHANGE_ME
  SEED_ADMIN_USERNAME: CHANGE_ME
  SEED_ADMIN_PASSWORD: CHANGE_ME
  STORAGE_ACCESS_KEY_ID: CHANGE_ME
  STORAGE_ACCESS_KEY_SECRET: CHANGE_ME
```

连接串里的主机名还是 `postgres:5432`：第 5 章会给 Postgres 建一个名叫 `postgres` 的 Service，和 Compose 里的服务名一致，连接串原样搬过来就能用。

`stringData` 让你写明文，apiserver 存储时会转成 `data` 字段里的 base64。**base64 不是加密**，任何能读这个 Secret 的人都能一行命令解出来：

```bash
kubectl -n counter get secret counter-api-secret -o jsonpath='{.data.JWT_SECRET}' | base64 -d
```

所以 Secret 的「安全」来自这几层，而不是对象本身：

| 层 | 做法 |
|---|---|
| 存储加密 | 让 apiserver 把 Secret 加密后再写进数据库。k3s 用启动参数 `--secrets-encryption` 开启（第 7 章） |
| 访问控制 | RBAC 限制谁能 `get secret`。单人集群里主要是保护好 kubeconfig 文件 |
| 不进 Git | 上面这份带 `CHANGE_ME` 的 YAML 只当模板，真实值不提交 |

### 真实值从哪来

最直接的办法是复用服务器上现成的 env 文件，`--from-env-file` 会把每一行 `KEY=VALUE` 变成一个键：

```bash
kubectl -n counter create secret generic counter-api-secret \
  --from-env-file=secrets/api.secret.env \
  --dry-run=client -o yaml | kubectl apply -f -
```

`--dry-run=client -o yaml | kubectl apply -f -` 这个组合让命令可以重复执行：第一次创建，之后更新，不会因为「已存在」报错。`secrets/` 目录要加进 `.gitignore`。

把加密后的 Secret 提交进 Git（SOPS、Sealed Secrets）或者从外部密钥库同步（External Secrets + Vault），是更系统的做法，属于 GitOps 的范畴，[《基础设施即代码》](../iac-gitops/)会展开。单人项目起步时，「env 文件放在一个加密备份过的地方，用上面的命令灌进集群」完全够用。

## 把配置交给容器

两种注入方式：作为环境变量，或者作为文件挂载。

### 环境变量：envFrom

hatch-counter 读的是环境变量，用 `envFrom` 一次性导入：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: counter-api
  namespace: counter
spec:
  replicas: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: counter-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: counter-api
    spec:
      imagePullSecrets:
        - name: registry-cred
      containers:
        - name: api
          image: registry.example.com/counter/api:1.4.0
          envFrom:
            - configMapRef:
                name: counter-api-config
            - secretRef:
                name: counter-api-secret
          env:
            - name: NODE_OPTIONS
              value: --max-old-space-size=384
          ports:
            - name: http
              containerPort: 3000
```

（探针、资源等字段和第 2 章相同，这里省略了。）

几条规则：

- 多个来源有同名键时，后面的覆盖前面的；`env` 里显式写的优先级最高
- 应用的连接串原来叫 `APP_DATABASE_URL`，服务端自己知道该用哪个；如果某个程序只认 `DATABASE_URL`，可以用 `env[].valueFrom.secretKeyRef` 把 Secret 里的某个键映射成另一个名字
- 引用的 ConfigMap / Secret 不存在时，Pod 会卡在 `CreateContainerConfigError`，`describe` 能看到原因

### 文件挂载

配置是一整个文件时（比如 nginx 配置、证书），挂成卷更合适：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: config-file-demo
  namespace: counter
spec:
  containers:
    - name: demo
      image: busybox:1.36
      command: ["sh", "-c", "cat /etc/demo/NODE_ENV && sleep 3600"]
      volumeMounts:
        - name: config
          mountPath: /etc/demo
          readOnly: true
  volumes:
    - name: config
      configMap:
        name: counter-api-config
```

ConfigMap 的每个键会变成目录下的一个文件。

### 改了配置，Pod 不会自己重启

这是新手最常踩的坑：

| 注入方式 | 改了 ConfigMap / Secret 之后 |
|---|---|
| 环境变量 | **不会更新**，环境变量只在容器启动时读一次 |
| 卷挂载 | 文件会在一段时间后被 kubelet 更新，但应用得自己重新读文件才生效 |

对 hatch-counter 这种启动时读一次配置的服务，改完配置要主动触发一次滚动重启：

```bash
kubectl -n counter rollout restart deployment/counter-api
```

`rollout restart` 的原理是往 Pod 模板里写一个带时间戳的注解，模板变了，Deployment 就按正常的滚动更新流程替换所有 Pod，同样遵守 maxUnavailable，不会断服。第 6 章用 Helm 时，会用「把配置内容的哈希写进注解」的办法让这件事自动发生。

## 私有镜像仓库的凭证

hatch-counter 的镜像在私有仓库里。Compose 版是在服务器上 `docker login` 一次，凭证存在 Docker 的配置文件里。K8s 里节点上的 containerd 不知道这个凭证，要用一个 `kubernetes.io/dockerconfigjson` 类型的 Secret：

```bash
# 令牌先放进环境变量（比如从密码管理器里读出来），别直接写在命令行上
kubectl -n counter create secret docker-registry registry-cred \
  --docker-server=registry.example.com \
  --docker-username="$REGISTRY_USER" \
  --docker-password="$REGISTRY_TOKEN" \
  --dry-run=client -o yaml | kubectl apply -f -
```

`create secret docker-registry` 没有从标准输入读密码的选项，直接把明文写在命令里会进 shell 历史，所以这里用环境变量传。如果本机已经 `docker login` 过，也可以用 `--from-file=.dockerconfigjson=<docker 配置文件路径>` 直接导入，但要确认那份文件里没有别的仓库的凭证。然后在 Pod 模板里引用它（上面 Deployment 里的 `imagePullSecrets`）。

凭证最好用仓库提供的**只读**访问令牌，不要用主账号密码：集群只需要拉镜像，泄露了也推不了恶意镜像上去。

另一种做法是在 k3s 的 `registries.yaml` 里给整个节点配置仓库凭证和镜像加速地址，这样所有命名空间都不用再声明 `imagePullSecrets`。境内服务器拉不动 Docker Hub 的问题也要在那里解决，第 7 章讲。

## 数据库迁移：从脚本里的一步到 Job

`deploy.sh` 的核心顺序是：**迁移跑完，才起新版本**。迁移用的是 owner 角色，不在服务端启动时自动跑。

在 K8s 里，「跑一次就结束的任务」对应 **Job**：

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: counter-migrate-1-5-0
  namespace: counter
  labels:
    app.kubernetes.io/name: counter-migrate
    app.kubernetes.io/part-of: counter
spec:
  backoffLimit: 0
  activeDeadlineSeconds: 600
  ttlSecondsAfterFinished: 86400
  template:
    metadata:
      labels:
        app.kubernetes.io/name: counter-migrate
    spec:
      restartPolicy: Never
      imagePullSecrets:
        - name: registry-cred
      containers:
        - name: migrate
          image: registry.example.com/counter/api:1.5.0
          command: ["./node_modules/.bin/tsx", "src/db/migrate-cli.ts"]
          envFrom:
            - configMapRef:
                name: counter-api-config
            - secretRef:
                name: counter-api-secret
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              memory: 512Mi
```

关键字段：

| 字段 | 取值 | 为什么 |
|---|---|---|
| `metadata.name` | 带版本号 | Job 的 Pod 模板创建后不可修改，同名 Job 不能「换个镜像再跑」。每个版本一个新名字，历史也清楚 |
| `restartPolicy` | `Never` | 失败了不要原地重启容器 |
| `backoffLimit` | `0` | 迁移失败不自动重试。迁移可能执行了一半，盲目重试有可能让情况更糟，交给人判断 |
| `activeDeadlineSeconds` | 600 | 卡住（比如等锁）超过 10 分钟就判失败，不无限挂着 |
| `ttlSecondsAfterFinished` | 86400 | 完成一天后自动清理 Job 和它的 Pod，免得越积越多 |
| `command` | 直接调 tsx | 沿用 `deploy.sh` 的做法：镜像里的 pnpm 只是 corepack 的 shim，第一次运行要联网下载 |

镜像的工作目录是 `/repo/apps/api`，所以相对路径能找到脚本。迁移脚本和服务端共用 `loadConfig()`，配置缺了什么，它会在碰数据库之前就报错退出，等于白捡了一道配置检查。这一点和 Compose 版一样。

### 把顺序串起来

用 `kubectl wait` 等 Job 完成，再更新 Deployment：

```bash
#!/usr/bin/env bash
set -euo pipefail
VERSION="$1"                       # 例如 1.5.0
JOB="counter-migrate-${VERSION//./-}"
NS=counter

sed "s/__VERSION__/${VERSION}/g; s/__JOB__/${JOB}/g" k8s/migrate-job.tpl.yaml | kubectl apply -f -

if ! kubectl -n "$NS" wait --for=condition=complete "job/$JOB" --timeout=600s; then
  echo "迁移没有成功完成，新版本不上线。日志：" >&2
  kubectl -n "$NS" logs "job/$JOB" >&2 || true
  exit 1
fi

kubectl -n "$NS" set image deployment/counter-api "api=registry.example.com/counter/api:${VERSION}"
kubectl -n "$NS" rollout status deployment/counter-api --timeout=180s
```

`kubectl wait --for=condition=complete` 在 Job 失败时不会立刻返回，而是一直等到超时。`activeDeadlineSeconds` 和 `--timeout` 都设成 600 秒，最坏情况下 10 分钟后脚本退出。想更快发现失败，可以同时等待 `condition=failed`，新版 kubectl 支持用 `--for=jsonpath` 写更灵活的条件。

和 `deploy.sh` 对比一下：

```mermaid
flowchart TB
  subgraph Compose["Compose 版 deploy.sh"]
    A1["改 .env 里的 tag"] --> A2["compose pull"] --> A3["compose run 迁移"] --> A4["compose up --wait"]
    A4 -->|"失败"| A5["trap 退回上一个 tag"]
  end
  subgraph K8s["K8s 版"]
    B1["apply 迁移 Job"] --> B2["wait 完成"] --> B3["更新 Deployment 镜像"] --> B4["rollout status"]
    B4 -->|"新 Pod 不就绪"| B5["卡住，旧 Pod 继续服务"]
  end
```

最大的区别在最后一步：Compose 版是「先替换，失败了再退回」，中间有一段空窗；K8s 版是「新的没就绪就不替换」，失败的发布不会影响线上。手动 `rollout undo` 只是把卡住的那次发布收拾干净。

第 6 章用 Helm 后，这个 Job 会变成一个 **pre-upgrade hook**，`helm upgrade` 自动按「先迁移、后发布」的顺序执行，这个脚本就可以删掉了。

## 维护模式去哪了

`deploy.sh --maintenance` 会创建一个标记文件，宿主机 nginx 看到它就返回 503 维护页，用于长时间回填、删列、换 Postgres 大版本这类必须停服的操作。迁到 K8s 后，最简单的等价做法是准备一个很小的维护页 Deployment，停服时把 Ingress 的后端切过去，做完再切回来。是否停服仍然是人的判断，不该让脚本去猜，这一条和原来的设计一致。

## 本章要点

- 普通配置放 **ConfigMap**，可以进 Git；敏感信息放 **Secret**，真实值不进 Git
- ConfigMap 的值都是字符串，数字和 `true` 一类要加引号
- Secret 只是 base64，安全靠存储加密（k3s `--secrets-encryption`）、访问控制和不提交真实值
- `envFrom` 批量注入环境变量；**改了配置 Pod 不会自动重启**，要 `rollout restart`
- 私有仓库用 `docker-registry` 类型的 Secret 加 `imagePullSecrets`，凭证用只读令牌
- 迁移改成带版本号的 **Job**：`backoffLimit: 0` 不盲目重试，`kubectl wait` 等它完成再发布
- K8s 版发布是「新的没就绪就不替换」，比「替换失败再退回」少了一段空窗
