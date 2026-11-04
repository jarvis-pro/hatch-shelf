# CI/CD（GitHub Actions）

讲 CI/CD 的文章通常默认一个前提：团队、PR、每次推送都要跑一遍检查。一个人的项目不完全是这样。本书引用的三个项目里，**没有一个在推送或 PR 时跑 CI**：hatch-counter 的检查只在发版那一刻跑，唱片墙和这个书架 App 完全没有流水线，提交前在本机跑 `typecheck` / `test` 是唯一的早期反馈。

这不是偷懒，而是算过账的选择。这一章先把账算清楚：一个人什么时候值得上 CI，然后讲 GitHub Actions 的写法，最后是一个真实的发版流水线拆解。

## 先分清 CI 和 CD

| | 做什么 | 回答的问题 |
|---|---|---|
| CI（持续集成） | 每次改动自动跑 lint、类型检查、测试、构建 | 「这份代码是好的吗」 |
| CD（持续交付） | 自动产出可发布的制品（镜像、安装包、前端包） | 「能不能随时发一版」 |
| CD（持续部署） | 制品自动上线到生产 | 「要不要人按按钮」 |

三者可以分开取舍。hatch-counter 的选择是：**不要 CI，要持续交付，部署一半自动一半手动**。静态站自动上线，服务端换镜像要人 ssh 上去跑 `deploy.sh`。

## 一个人什么时候值得上 CI

hatch-counter 的发布文档把理由写得很清楚：这是个单人仓库、中途提交频繁，绝大多数提交根本不打算发版，逐次跑一个月要烧掉五百多分钟（这是项目自己的估算）；**而发版那一刻正是唯一真正需要「代码是好的」这个结论的时刻**。代价也写明了：静态站能不能构建成功、服务端镜像编不编得过，要等到发版时才知道。

推送时跑 CI 的价值，取决于两件事：**改动从哪来**，以及**错误漏到生产的代价**。

![一个二乘二矩阵：横轴是改动来源，从只有自己到有协作者或后台 agent；纵轴是出错代价，从低到高。左下只靠本机检查，左上在发版时跑完整检查，右下在 PR 上跑轻量 CI，右上两者都要。](assets/ci-decision.svg)

几个让天平倾向「该上了」的信号：

- **开始有别人往仓库推代码**：协作者、外包，或者**在云端跑的编码 agent**。你在本机会跑 `pnpm test`，但一个后台 agent 开的 PR 有没有跑过，你只能靠 CI 告诉你。用 agent 越重，PR 上的 CI 越值钱，它是你审查 agent 产出的第一道筛子
- **本机检查经常被跳过**：赶时间直接 push，然后第二天发现 main 是红的
- **构建环境和本机差异大**：例如生产要 amd64 镜像、要 Linux 下的原生依赖
- **有用户在付钱**：出一次错的代价开始超过 CI 的维护成本

反过来，下面这些情况先不上也没关系：

- 只有你自己提交，且你守得住「提交前跑一遍」
- 发版频率低（一周一两次），发版流水线里已经有完整检查
- 项目还在找方向，下个月可能整个推倒

唱片墙的规则文件里有句话值得记住：「哪天嫌手工烦了再补，别为了看起来完整先把它搭起来」。

### 不上 CI 时的替代品

本机 git hook 是最便宜的「CI」，例如用 lefthook 在推送前跑类型检查：

```yaml
# lefthook.yml
pre-push:
  commands:
    typecheck:
      run: pnpm typecheck
    test:
      run: pnpm test
```

它能被 `--no-verify` 跳过，所以只是提醒，不是保证。但对一个人来说，提醒往往就够了。

## GitHub Actions 的最小骨架

真要上的时候，一份 PR 检查的 workflow 大概是这样（pnpm monorepo + Node 22）：

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
  push:
    branches: [main]

# 同一分支新推送时取消还在跑的旧检查，省分钟数
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4          # pnpm 版本取自 package.json 的 packageManager
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
```

（action 的主版本号会更新，写的时候去各 action 的仓库看一眼当前推荐的版本。）

几个要点：

- **`--frozen-lockfile`**：lockfile 和 `package.json` 对不上就失败，而不是悄悄更新。CI 装的必须是你本机测过的那套依赖
- **`permissions` 最小化**：默认的 `GITHUB_TOKEN` 权限可能比你需要的大，只读就写 `contents: read`
- **`timeout-minutes`**：默认上限是几个小时，一个卡住的步骤能悄悄吃掉大量分钟数
- **把装依赖抽成 composite action**：hatch-counter 把「pnpm + Node 22 + install」写进 `.github/actions/setup/action.yml`，几个 job 共用，Node 版本只写一处

### 需要数据库的测试

hatch-counter 的服务端测试跑在真 Postgres 上，不 mock，因为行级安全策略、触发器、可延迟外键全是数据库行为。GitHub Actions 的 `services` 可以起一个容器：

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U test"
          --health-interval 5s
          --health-retries 10
          --tmpfs /var/lib/postgresql/data:rw
    env:
      DATABASE_URL: postgres://test:test@localhost:5432/test
      JWT_SECRET: ci-only-secret-not-for-production
```

数据目录放在 `tmpfs` 内存盘上：测试数据本来就是一次性的，而清表的成本主要在磁盘同步。CI 里用的密码和密钥明写在 workflow 里没关系，前提是它们**一眼看得出只给 CI 用**。

## 发版流水线：hatch-counter 的 release-api.yml

hatch-counter 的发版流程是这样串起来的：

```mermaid
sequenceDiagram
  participant Me as 本机 pnpm release
  participant GH as GitHub Actions
  participant Reg as 镜像仓库
  participant Git as origin/main
  participant IM as 群通知
  Me->>Me: 预检（工作区干净、在 main、已推送）
  Me->>Me: 算 changelog 给人过目
  Me->>GH: gh workflow run，传 version
  GH->>GH: preflight：lint / typecheck / 带 Postgres 的测试
  GH->>Reg: image：构建并推送镜像
  GH->>Git: publish：提交版本号和 changelog、打 tag
  GH->>Git: 回头确认 tag 真的在 origin 上
  GH->>IM: notify：成功失败都发
```

workflow 只有一个入口，手动触发、收一个参数：

```yaml
on:
  workflow_dispatch:
    inputs:
      version:
        description: "要发的版本号，形如 1.2.0"
        required: true
        type: string

run-name: 发布服务端 ${{ inputs.version }}

concurrency:
  group: release-api
  cancel-in-progress: false   # 发版跑到一半被取消会留下半成品
```

这份流水线里值得抄的设计，每一条背后都有一次事故。

### 不可逆的事排在最后

最早它是 **tag 触发**的：先打 tag，CI 看到 tag 再构建。有一次推镜像走了十五分钟，被当成卡死取消掉，群里播了「失败」，但镜像其实两边都推上去了，tag 也早就在了，三样东西各说各的。

现在的顺序是：**检查 → 构建推送 → 全部成功后才提交版本号、写 changelog、打 tag、推 main**。中途任何一步失败，仓库里一个字都没变，修完用同一个版本号再触发一次就行。tag 因此成了「这一版真发出去了」的唯一权威记号。

### 所有 job 钉在同一个提交上

```yaml
preflight:
  outputs:
    sha: ${{ steps.pin.outputs.sha }}
  steps:
    - uses: actions/checkout@v4
    - id: pin
      run: echo "sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"

image:
  needs: preflight
  steps:
    - uses: actions/checkout@v4
      with:
        ref: ${{ needs.preflight.outputs.sha }}
```

不钉的话，preflight 和 image 之间如果有人往 main 推了新提交，测过的、编进镜像的、最后被打 tag 的可能是三份不同的代码。

### 去看痕迹，不信退出码

```yaml
- name: tag 真上去了吗
  env:
    TAG: api-v${{ inputs.version }}
  run: |
    if ! git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null; then
      echo "✗ origin 上没有 $TAG，上一步没真干成"
      exit 1
    fi
```

有一次记账脚本被 pnpm 吞掉了（脚本名和 pnpm 的内置命令重名），一行没跑，退出码却是 0：四个 job 全绿，群里播「发布成功」，而 tag、changelog、版本号一个都没有。**一步「什么都没做」和「做成了」在退出码上分不出来时，就去看它该留下的痕迹**。

### 宁红勿假绿

推送到镜像仓库要用 secret 登录。没配 secret 时，是安静跳过还是报错？这份流水线的判断是：

- **群通知**没配 webhook 就安静跳过：通知漏一条只是没人看见
- **镜像仓库**没配凭证必须红：漏了会推出一版生产机根本拉不到的镜像，而流水线还是绿的，「那种绿比红更贵」

### 通知用 `if: always()`

```yaml
notify:
  needs: [image, publish]
  if: always()
  env:
    STATUS: ${{ (needs.image.result == 'success' && needs.publish.result == 'success') && 'ok' || 'fail' }}
```

出包失败的时候更该说一声。

## 推还是拉：CI 要不要直接部署到生产

最常见的「持续部署」写法是在 workflow 末尾 ssh 到生产机执行部署。它需要把**一把能登录生产机的私钥放进仓库 secret**。hatch-counter 明确不这么做：

- **服务端**：CI 只推镜像，人 ssh 上去跑 `deploy.sh`。一天发不了几版，多花十秒，换掉的是一条常年开着的、通往生产库的路
- **静态站**：CI 把前端包和一份「指针」文件（版本号、run id、sha256）写进下载桶，机器上常驻的 `agent.sh` 每十几秒匿名读一次指针，变了才拉包、校验哈希、切软链。**机器手里没有任何钥匙，一份被篡改的指针最多能让它「把桶里某一版切上去」**。CI 再从公网取一次首页，认出新版的哈希文件名，才去打 tag

```mermaid
flowchart TD
  CI["CI：构建前端包"] --> OSS["下载桶：包 + 指针"]
  A["机器上的 agent.sh"] -- "每 15 秒读指针" --> OSS
  A --> L["校验 sha256 → 切软链 → 验首页"]
  CI -- "从公网验首页" --> W["线上站点"]
  CI --> T["验过才打 tag"]
```

这是「拉模式」部署，和 GitOps 的思路一致（[《基础设施即代码》](../iac-gitops/)会讲 Argo CD 这类工具）：生产环境主动拉取期望状态，而不是被外部推送。代价是多一个常驻进程要维护，以及上线有十几秒延迟。

## 几个省钱省事的细节

| 细节 | 说明 |
|---|---|
| Actions 分钟数 | 私有仓库有免费额度，超出计费；macOS runner 单价远高于 Linux，具体以 GitHub 当前计费说明为准 |
| artifact 存储额度 | 免费额度很小，几个上百兆的安装包就会撞满。hatch-counter 改为直接从 runner 上传到自己的对象存储 |
| 私有仓库的 Release 附件 | 没有仓库权限的人下载是 404，不能拿来给用户分发安装包 |
| 构建缓存 | `docker/build-push-action` 配 `cache-from: type=gha` 可以复用依赖层 |
| 跨境推镜像 | 从 GitHub 推到境内镜像仓库可能要十几分钟，给 `timeout-minutes` 留余量，别当卡死去取消 |

## 本章要点

- CI、持续交付、持续部署可以分开取舍；一个人的项目常常是「不要 CI、要持续交付」
- 推送时跑 CI 的价值取决于改动从哪来和出错代价；**开始用后台 agent 提 PR 时，CI 就很值得上**
- 不上 CI 时，本机 git hook 是最便宜的替代品
- workflow 基本功：`--frozen-lockfile`、最小 `permissions`、`concurrency`、`timeout-minutes`、composite action 复用安装步骤
- 发版流水线：不可逆的事（tag、推 main）排在最后；所有 job 钉同一个 SHA；验证痕迹而不是信退出码；关键凭证缺失必须红
- 能不把生产机的 ssh 私钥放进 CI 就不放，拉模式部署是一个人也负担得起的替代方案

## 动手练习

1. **`--frozen-lockfile` 拦下没提交的依赖变更**：在一个 pnpm 小项目里先 `pnpm install` 生成 lockfile，然后手动编辑 `package.json`，在 `dependencies` 里加一行 `"ms": "^2.1.3"`（不跑 install），再运行 `pnpm install --frozen-lockfile; echo "exit=$?"`。

   验证：报 `ERR_PNPM_OUTDATED_LOCKFILE`，`exit` 非 0，`pnpm-lock.yaml` 没有被改动（`git diff --stat` 里没有它）。

   参考答案：CI 装的必须是本机测过的那套依赖；不加这个参数时 pnpm 会顺手更新 lockfile，CI 测的就变成了一份你没见过的依赖组合。

2. **看痕迹：用 `git ls-remote --exit-code` 判断 tag 在不在**：用本地裸仓库代替 GitHub：`git init --bare /tmp/origin.git`，在一个测试仓库里 `git remote add origin /tmp/origin.git`、提交一次并 `git push origin HEAD:main`，打一个 `api-v0.1.0` 只在本地不推送。分别运行 `git ls-remote --exit-code --tags origin refs/tags/api-v0.1.0; echo $?`，推送 tag 后再运行一次。

   验证：推送前退出码是 `2`、没有输出；推送后打印一行 `<sha>	refs/tags/api-v0.1.0`，退出码 `0`。

   参考答案：`--exit-code` 让「远端没有匹配的引用」变成非 0 退出码，正好用来替代「相信上一步的退出码」。把本章那段 `if ! git ls-remote ...` 放进脚本，在推送前后各跑一次，应该一次红一次绿。

3. **最便宜的 CI：pre-push 钩子**：在上一题的测试仓库里 `pnpm add -D lefthook`，写本章的 `lefthook.yml`（`test` 改成一条必然失败的命令，如 `run: exit 1`），`pnpm exec lefthook install` 后 `git push origin HEAD:main`，再用 `git push --no-verify origin HEAD:main` 推一次。

   验证：第一次推送被钩子拦下，输出里能看到 `test` 那条命令失败，远端 main 没变（`git ls-remote origin main` 的 sha 没变）；加 `--no-verify` 后推送成功。

   参考答案：钩子在本机执行，能被 `--no-verify` 跳过，所以它是提醒不是保证；一旦有别人或后台 agent 往仓库推代码，就需要 GitHub 那侧的检查来兜底。
