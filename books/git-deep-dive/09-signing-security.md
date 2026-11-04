# 签名与安全

这一章讲两件与安全有关的事。前一半是签名：Git 里的作者信息谁都能伪造，签名让你能证明「这个提交确实是我做的」。后一半是泄露：密钥被提交进了仓库，正确的处理顺序是什么，以及怎么让它不再发生。

## 作者信息可以随便写

第 1 章看过提交对象，作者就是一行文本：

```text
author jarvis <jarvis@example.com> 1793757600 +0800
```

它来自 `user.name` 和 `user.email` 配置，Git 不做任何验证。任何人都可以：

```bash
git -c user.name=jarvis -c user.email=jarvis@example.com commit -m 'fix: 看起来是 jarvis 写的'
```

推到托管平台后，平台按邮箱匹配账户，这个提交就会显示你的头像和用户名。对一人公司来说，现实的风险不是有人冒充你给自己的仓库提交（那需要推送权限），而是：

- 你发布的开源库、模板仓库被人 fork 后加料，提交看起来出自你手
- 你的推送凭证泄露后，攻击者推上来的提交和你自己的混在一起，事后无法区分
- 发版标签被替换，指向了另一个提交

签名解决的是**可验证性**：有签名的提交和标签可以被验证确实出自持有私钥的人，没签名的则存疑。

## 用 SSH 密钥签名

> [!WARNING]
> SSH 签名需要 Git 2.34 及以上。托管平台上显示「Verified」的条件和设置入口按写作时的情况整理，以 GitHub 等平台的官方文档为准。

过去 Git 签名只能用 GPG，配置繁琐、密钥管理麻烦。Git 2.34 起可以直接用 SSH 密钥签名，大多数开发者本来就有 SSH 密钥。

### 配置

可以用已有的 SSH 密钥，但更推荐单独生成一把只用于签名的密钥，丢了或换了不影响 SSH 登录：

```bash
ssh-keygen -t ed25519 -C 'jarvis git signing' -f ~/.ssh/id_ed25519_signing
```

```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519_signing.pub
git config --global commit.gpgsign true
git config --global tag.gpgsign true
```

配置项名字里的 `gpg` 是历史原因，`gpg.format ssh` 之后实际用的是 `ssh-keygen` 签名。从此每个提交和附注标签都会自动签名，提交对象里会多出一段 `gpgsig` 头。

私钥有口令时，加进 ssh-agent 就不用每次输入。私钥放在 1Password 这类密码管理器里的，按它的说明把 `gpg.ssh.program` 指向它提供的签名程序。

### 本地验证

验证 SSH 签名需要告诉 Git「哪些公钥属于哪些人」，这就是 allowed signers 文件：

```bash
echo "jarvis@example.com namespaces=\"git\" $(cat ~/.ssh/id_ed25519_signing.pub)" \
  >> ~/.config/git/allowed_signers
git config --global gpg.ssh.allowedSignersFile ~/.config/git/allowed_signers
```

然后：

```bash
git log -1 --show-signature
git verify-commit HEAD
git log --format='%h %G? %s' -10
```

```text
Good "git" signature for jarvis@example.com with ED25519 key SHA256:mwo2gx0g8KAFraz7bF+t2Dvgdu0B78pDM9CMd9iKwuE
```

`%G?` 是签名状态的单字母代码，常见的几个：

| 代码 | 含义 |
|---|---|
| `G` | 有效签名，公钥在 allowed signers 里 |
| `U` | 签名有效，但公钥不在信任列表里 |
| `B` | 签名无效，内容被改过 |
| `N` | 没有签名 |

签名覆盖的是整个提交对象：tree、parent、作者、消息。第 1 章说过 parent 链让一个提交的 ID 确定了它之前的全部历史，所以**验证最新的一个签名提交，就验证了它之前的所有内容未被篡改**。

### 在托管平台上显示 Verified

在 GitHub 的 SSH 密钥设置里，把同一个公钥再添加一次，类型选「Signing Key」（和认证用的密钥是分开登记的）。之后你推上去的签名提交会显示 Verified 标记。

GitHub 还有一个「警觉模式」（vigilant mode）：开启后，你名下所有**没签名**的提交都会被标成 Unverified。这样有人用你的邮箱伪造的提交就会显得可疑。开启前确保你所有机器上都配好了签名，否则自己的提交也会被标记。

### 和第 6 章的身份分离配合

公司和个人项目用不同的身份，签名密钥也应该分开。在第 6 章的 `includeIf` 文件里覆盖 `user.signingkey` 即可：

```ini
# ~/.gitconfig-work
[user]
	email = jarvis@company.example
	signingkey = ~/.ssh/id_ed25519_work_signing.pub
```

### 签标签

发版标签比提交更值得签，因为下游（你自己的发版流水线、用户）是按标签取版本的：

```bash
git tag -s v1.0.4 -m 'v1.0.4'     # 设了 tag.gpgsign 时 -a 也会签
git verify-tag v1.0.4
```

一个更严格的发版流程可以在流水线里先 `git verify-tag`，验证失败就不出包。

### 签名不能防什么

- **私钥所在的机器被攻破**：签名证明的是「持有私钥的人做的」，私钥被偷了就不再成立。签名密钥用口令保护，或者放在硬件密钥、密码管理器里
- **你自己签了有问题的代码**：签名不评价内容。coding agent 在你的机器上提交，用的是你的签名，这意味着「我认可这些提交」，所以审查仍然必要
- **变基后的提交**：变基、amend 会生成新提交并重新签名（用当时执行操作的人的密钥）。帮别人变基会把他们的提交签成你的

## 密钥泄露了怎么办

最常见的情况：把 `.env`、云服务的 AccessKey、App Store Connect 的 `.p8` 私钥提交进了仓库，还推了上去。

正确的顺序和直觉相反。直觉是先删掉文件、改写历史，但**改写历史不能让已经泄露的密钥变得安全**：推送的那一刻，它就可能已经被扫描公开仓库的机器人拿走了（公开仓库的密钥扫描往往在推送后很短时间内就会发生）；就算仓库是私有的，所有克隆、CI 缓存、fork 里都还有它。

```mermaid
flowchart TD
  A["发现泄露"] --> B["1 作废并轮换密钥"]
  B --> C["2 查调用记录<br/>和账单"]
  C --> D["3 修复引用方<br/>重新部署"]
  D --> E["4 清理历史<br/>（可选）"]
  E --> F["5 加上防线"]
```

### 第一步：作废

到服务商的控制台作废这把密钥，生成新的，更新所有使用方。这一步做完，泄露的值就没有用了，后面的步骤都不再紧急。每把密钥在哪些地方使用、怎么换、换的时候会断什么，最好事先就写成一页手册，见[《应用安全》的密钥泄露一节](../app-security/04-passwords-secrets.md#泄露了怎么办)。

### 第二步：评估影响

```bash
# 这个文件什么时候进的仓库、在哪些提交里存在过
git log --all --full-history --format='%h %ad %s' --date=iso -- app/.env

# 某个具体的值出现在哪些提交里
git log --all -S 'AKIAXXXXXXXXXXXXXXXX' --format='%h %ad %s' --date=iso
```

从第一次推送到作废之间的时间，就是暴露窗口。到服务商后台看这段时间的调用记录和账单，确认有没有被滥用。

### 第三步：清理历史，要不要做

作废之后，历史里的那个值只是一个无效字符串。是否清理历史取决于：

| 情况 | 建议 |
|---|---|
| 公开仓库 | 清理。即使已作废，留在历史里会被反复扫到、反复报警 |
| 私有仓库，只有你自己 | 可以不清理。改写历史的代价（所有克隆重来、提交 ID 全变）可能大于收益 |
| 密钥无法作废（比如某些写死在硬件里的、第三方给的不可轮换的凭证） | 必须清理，并评估还有哪些副本 |

清理用第 4 章的 filter-repo。整个文件不该在仓库里，就删路径；值混在其他文件里，就替换文本：

```bash
git clone git@github.com:jarvis/hatch-counter.git /tmp/counter-clean
cd /tmp/counter-clean
git filter-repo --invert-paths --path app/.env
# 或者
git filter-repo --replace-text ../leaked-values.txt
```

在一个三提交的实验仓库上，删掉 `.env` 之后，只包含这一个文件改动的那个提交整个消失了，其余提交的 ID 全部改变，`origin` 远程被移除，需要重新添加后强推：

```text
d3e90f5 feat: b
b14e8a6 feat: a
```

> [!CAUTION]
> 强推之后，托管平台上可能仍有旧提交的副本：已有 PR 引用的提交、fork、平台的缓存视图。在 GitHub 上，这些需要联系平台支持才能彻底清除，具体流程以 GitHub 官方文档「从仓库中删除敏感数据」为准。这正是第一步必须是作废密钥的原因。

### 第四步：防止再次发生

> [!WARNING]
> 本节 gitleaks 的命令写法（子命令在 8.x 的版本之间有过调整）按写作时的版本整理，以 gitleaks 仓库的 README 为准；GitHub 推送保护、密钥扫描对不同账户方案的可用范围以 GitHub 官方文档为准。

**`.gitignore` 先行。** hatch-shelf 的 `.gitignore` 在项目一开始就排除了签名和证书文件：

```text
*.jks
*.p8
*.p12
*.key
*.mobileprovision
```

这类规则要在**第一次需要这些文件之前**就写好。环境变量文件同理：仓库里只放 `.env.example` 模板，真实的 `.env` 被忽略，见[《部署与 CI/CD》的环境变量一章](../deploy-release/03-env-secrets.md#模板进仓库值不进)。

**提交前扫描。** 用 gitleaks 这类工具在 pre-commit 阶段扫描暂存的内容，挂在第 7 章的 lefthook 里：

```yaml
# lefthook.yml
pre-commit:
  commands:
    gitleaks:
      run: gitleaks git --pre-commit --staged --redact --no-banner
```

想覆盖所有仓库，可以用第 7 章介绍的配置式 hook 挂在全局配置里，或者用全局的 `core.hooksPath`。

**推送时拦截。** GitHub 对公开仓库提供推送保护（push protection），识别到已知格式的密钥会拒绝推送。私有仓库是否可用取决于账户方案。

**CI 里再扫一遍全部历史**，作为最后的兜底：

```bash
gitleaks git --redact --no-banner .
```

## 来自别人仓库的风险

最后简单提一下反方向的风险：你 clone 或打开的仓库会不会伤害你。

- **hooks 不会随 clone 下来**。`.git/hooks` 不在版本控制里，所以 clone 一个仓库不会自动执行它的 hook。但第 7 章的 husky、lefthook 会在 `pnpm install` 时安装 hook，而安装脚本本身就能执行任意代码，依赖安装的风险见[《应用安全》的供应链一章](../app-security/05-supply-chain.md)
- **别人的 `.git` 目录不要直接用**。从压缩包、网盘拿到的项目如果带着 `.git` 目录，里面的 `config` 可以设置 `core.fsmonitor`、`core.sshCommand` 等会执行命令的选项。Git 的 `safe.directory` 检查（第 7 章在 CI 里遇到过）就是为此而设：不属于当前用户的仓库目录，Git 默认拒绝操作。拿到这种目录，删掉 `.git` 重新 clone
- **保持 Git 是新的**。Git 每年都会修几个与恶意仓库相关的安全漏洞（子模块路径、符号链接、协议处理），`brew upgrade git` 是成本最低的防护

## 本章要点

- 提交的作者信息可以随便写，签名提供可验证性
- 用 SSH 密钥签名：`gpg.format ssh`、`user.signingkey`、`commit.gpgsign`；本地验证需要 allowed signers 文件
- 平台上要把公钥登记为签名密钥；警觉模式让未签名的提交显示为未验证
- 签名证明「持有私钥的人做的」，不证明内容没问题
- 密钥泄露的顺序：作废轮换 → 评估暴露窗口 → 修复使用方 → 视情况清理历史 → 加防线
- 改写历史不能让泄露的密钥变安全；防线是 `.gitignore` 先行、提交前扫描、推送保护和 CI 兜底

## 动手练习

1. **只在练习仓库里签名**：在临时目录用 `ssh-keygen -t ed25519 -N '' -f key` 生成一把实验密钥，在新仓库里用**本地**配置（不加 `--global`）设置 `gpg.format ssh`、`user.signingkey`、`commit.gpgsign true` 和指向临时 allowed signers 文件的 `gpg.ssh.allowedSignersFile`。提交一次，再用 `-c commit.gpgsign=false` 提交一次。

   验证：`git log --format='%h %G? %s'` 两行分别是 `G` 和 `N`。

   参考答案：allowed signers 里那一行的邮箱要和 `user.email` 一致，否则状态是 `U` 而不是 `G`。用本地配置是为了不影响你真实的全局签名设置。

2. **篡改一个已签名的提交**：把上一题签了名的提交原样取出、只改消息，写成一个新对象，再验证它。

   验证：`git log -1 --format=%G? <新 ID>` 输出 `B`；`git verify-commit <新 ID>` 报 `incorrect signature`，退出码 1。

   参考答案：签名覆盖整个提交对象，`gpgsig` 头原样保留但内容变了，验证必然失败：

   ```bash
   git cat-file commit HEAD~1 | sed 's/^signed$/signed!/' \
     | git hash-object -t commit -w --stdin
   ```

3. **算暴露窗口**：在练习仓库提交一个内容为 `KEY=AKIAABCDEFGHIJKLMNOP` 的 `.env`（假值），下一个提交再 `git rm` 它。用本章第二步的两条命令找出它进入和离开历史的提交。

   验证：`git log --all -S AKIAABCDEFGHIJKLMNOP --format='%h %ad %s' --date=iso` 输出两行：加入它的提交和删除它的提交；最新的工作区里已经没有 `.env`，但 `git show <加入它的提交>:.env` 仍能读出这个值。

   参考答案：两行之间的时间（如果推送过，从第一次推送算起）就是暴露窗口。删掉文件只是让后续快照不再包含它，所以第一步永远是作废密钥。
