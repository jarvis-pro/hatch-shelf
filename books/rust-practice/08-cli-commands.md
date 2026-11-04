# 写一个 CLI（下）：clap 命令、测试与发布

[上一章](08-cli-clap.md)搭好了 Cargo workspace，写完了检查库 `shelf-core`：`check_book` 检查一本书，`load_manifest` 只读 `book.yaml`。这一章给它套上命令行：用 clap 定义 `check` 和 `ls` 两个命令，用 rayon 并行检查、按退出码区分结果，然后讲测试、发布构建，以及书巢该不该用它替换现在的 `shelf-pack check`。

## shelf-cli：用 clap 定义命令

clap 的 derive 风格和 serde 一样：先定义结构体，再从命令行参数「反序列化」出来。

```rust
use anyhow::{Context, Result};
use clap::{Parser, Subcommand, ValueEnum};
use rayon::prelude::*;
use serde_json::json;
use shelf_core::{check_book, load_manifest, CheckedBook, LoadError, Severity};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

/// 书巢的书籍检查工具（Rust 版）
#[derive(Parser)]
#[command(name = "shelf", version)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// 按写书规范检查一本书，或 books/ 下的全部书
    Check {
        /// 书目录，或包含多本书的目录
        path: PathBuf,
        /// 输出格式
        #[arg(long, value_enum, default_value_t = Format::Text)]
        format: Format,
        /// 有警告也以非零状态退出
        #[arg(long)]
        strict: bool,
    },
    /// 按分类列出全部书
    Ls {
        #[arg(default_value = "books")]
        path: PathBuf,
    },
}

#[derive(Clone, Copy, ValueEnum)]
enum Format {
    Text,
    Json,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let result = match cli.command {
        Command::Check { path, format, strict } => check(&path, format, strict),
        Command::Ls { path } => ls(&path).map(|()| true),
    };
    match result {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::from(1),
        Err(e) => {
            eprintln!("shelf: {e:#}");
            ExitCode::from(2)
        }
    }
}
```

- 文档注释 `///` 会变成 `--help` 里的说明文字，结构体上的那条就是程序的简介
- 字段名 `strict` 自动变成 `--strict`，`bool` 类型自动成为开关；没有 `#[arg(long)]` 的字段是位置参数
- `ValueEnum` 让 `--format` 只接受 `text` 和 `json`，输错时 clap 会列出可选值
- 退出码：0 表示通过，1 表示有问题，2 表示工具本身出错（读不到目录之类）。这是 Unix 工具的惯例，CI 和 shell 脚本靠它判断结果

运行 `shelf --help`：

```text
书巢的书籍检查工具（Rust 版）

Usage: shelf <COMMAND>

Commands:
  check  按写书规范检查一本书，或 books/ 下的全部书
  ls     按分类列出全部书
  help   Print this message or the help of the given subcommand(s)

Options:
  -h, --help     Print help
  -V, --version  Print version
```

这些都是 clap 根据类型定义生成的，包括参数校验、错误提示和 shell 补全（`clap_complete` crate）。对照 TS 里用 commander 或 yargs 时手写的那些选项定义，clap derive 的好处是：参数的类型就是 Rust 的类型，解析完直接是一个强类型的 `Cli` 值，不存在「`opts.format` 可能是任意字符串」的情况。

### check 命令

```rust
/// 一个目录本身是书就返回它，否则返回其下所有含 book.yaml 的子目录
fn book_dirs(path: &Path) -> Result<Vec<PathBuf>> {
    if path.join("book.yaml").exists() {
        return Ok(vec![path.to_path_buf()]);
    }
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(path)
        .with_context(|| format!("读取目录 {} 失败", path.display()))?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.join("book.yaml").exists())
        .collect();
    dirs.sort();
    Ok(dirs)
}

fn check(path: &Path, format: Format, strict: bool) -> Result<bool> {
    let dirs = book_dirs(path)?;
    let results: Vec<(PathBuf, Result<CheckedBook, LoadError>)> =
        dirs.par_iter().map(|d| (d.clone(), check_book(d))).collect();

    let mut failed = 0;
    for (_, r) in &results {
        let bad = match r {
            Ok(b) => b.count(Severity::Error) > 0 || (strict && b.count(Severity::Warning) > 0),
            Err(_) => true,
        };
        if bad {
            failed += 1;
        }
    }

    match format {
        Format::Json => {
            let report: Vec<_> = results
                .iter()
                .map(|(dir, r)| match r {
                    Ok(b) => json!({ "dir": dir, "id": b.manifest.id, "issues": b.issues }),
                    Err(e) => json!({ "dir": dir, "error": format!("{e}") }),
                })
                .collect();
            println!("{}", serde_json::to_string_pretty(&report)?);
        }
        Format::Text => {
            for (dir, r) in &results {
                match r {
                    Ok(b) if b.issues.is_empty() => println!("✓ {}  {}", b.manifest.id, b.manifest.title),
                    Ok(b) => {
                        println!("✗ {}  {}", b.manifest.id, b.manifest.title);
                        for issue in &b.issues {
                            println!("    {issue}");
                        }
                    }
                    Err(e) => println!("✗ {}  {e}", dir.display()),
                }
            }
            println!("\n{} 本书，{failed} 本有问题", results.len());
        }
    }
    Ok(failed == 0)
}
```

`par_iter` 让每本书在 rayon 的线程池里并行检查（第 7 章）。`check_book` 只读文件、不共享可变状态，所以并行化不需要任何锁；结果按输入顺序收集，输出顺序是稳定的。

JSON 输出让这个工具能被别的程序消费，比如 CI 里用 `jq` 过滤，或者第 9 章的 Tauri 界面直接拿来展示。`json!` 宏里的 `b.issues` 能直接放进去，因为 `Issue` 派生了 `Serialize`。

### ls 命令

```rust
fn ls(path: &Path) -> Result<()> {
    let mut shelves: BTreeMap<String, Vec<(String, String)>> = BTreeMap::new();
    for dir in book_dirs(path)? {
        match load_manifest(&dir) {
            Ok(m) => {
                let shelf = m
                    .category
                    .as_deref()
                    .and_then(|c| c.split('/').next())
                    .unwrap_or("未分类")
                    .to_string();
                shelves.entry(shelf).or_default().push((m.id, m.title));
            }
            Err(e) => eprintln!("跳过 {}：{e}", dir.display()),
        }
    }
    for (shelf, mut books) in shelves {
        books.sort();
        println!("{shelf}（{} 本）", books.len());
        for (id, title) in books {
            println!("  {id}  {title}");
        }
    }
    Ok(())
}
```

这和第 6 章的 `group_by_shelf` 是同一个逻辑，区别是这里的 `BTreeMap` 存的是 `String` 而不是 `&str`：数据来自循环里临时加载的 `BookManifest`，每轮循环结束它就被释放了，引用活不过循环。第 3 章的建议在这里直接适用：**数据来源是临时的，就让容器拥有数据**。`push((m.id, m.title))` 把两个字段的所有权从 `m` 里移出来，不需要 `clone`。

## 运行

```bash
cargo run -p shelf-cli -- check ../hatch-shelf/books/rust-practice
cargo run -p shelf-cli -- check ../hatch-shelf/books --format json | jq '.[] | select(.issues | length > 0) | .id'
cargo run -p shelf-cli -- ls ../hatch-shelf/books
```

`-p shelf-cli` 指定 workspace 里的哪个包，`--` 之后的参数传给程序本身，和 `pnpm run dev -- --port 3000` 里的 `--` 是一个意思。

## 测试

Rust 的单元测试直接写在源文件里，放在一个只在测试时编译的模块中。在上一章的 `lint.rs` 末尾加上：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_hash_lines_inside_fences() {
        let md = "# 标题\n\n```rust\n# 这是注释，不是标题\n```\n";
        assert!(lint_chapter("a.md", md).is_empty());
    }

    #[test]
    fn reports_fence_without_language() {
        let md = "# 标题\n\n```\nplain\n```\n";
        let issues = lint_chapter("a.md", md);
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].line, Some(3));
    }

    #[test]
    fn reports_multiple_h1() {
        let issues = lint_chapter("a.md", "# 一\n\n# 二\n");
        assert_eq!(issues.len(), 1);
        assert!(issues[0].message.contains("2 个 H1"));
    }

    #[test]
    fn detects_remote_image() {
        let issues = lint_chapter("a.md", "# 标题\n![封面](https://example.com/a.png)\n");
        assert_eq!(issues[0].line, Some(2));
    }
}
```

```bash
cargo test                 # 跑整个 workspace 的测试
cargo test -p shelf-core   # 只跑一个包
cargo test fence           # 只跑名字里含 fence 的测试
```

| Vitest | Rust 内置测试 |
|---|---|
| `*.test.ts` 文件 | 同文件的 `#[cfg(test)] mod tests`，或 `tests/` 目录下的集成测试 |
| `test("...", () => {})` | `#[test] fn ...()` |
| `expect(a).toBe(b)` | `assert_eq!(a, b)` |
| `expect(x).toBeTruthy()` | `assert!(x)` |
| `expect(() => f()).toThrow()` | `#[should_panic]`，或断言返回 `Err` |

`#[cfg(test)]` 是条件编译：只有 `cargo test` 时这个模块才会被编译，发布构建里不包含任何测试代码。放在同一个文件里的测试还能访问私有函数，比如 `is_h1`。

测试整个命令行程序（参数解析、退出码、输出），常用 `assert_cmd` 和 `tempfile` 两个 crate，放在 `crates/shelf-cli/tests/` 目录下，它们会以子进程的方式运行编译好的 `shelf`。

### 用 TS 版本做对照测试

重写一个已有工具时，最可靠的测试方式是**拿同一批输入对照两个实现的输出**。书巢的 `books/` 目录有八十多本真实的书，正好是现成的测试集：

```bash
pnpm -s shelf-pack check books/ > /tmp/ts.txt
shelf check books/ > /tmp/rs.txt
diff <(grep -c 错误 /tmp/ts.txt) <(grep -c 错误 /tmp/rs.txt)
```

输出格式不同，不能直接 `diff`，但可以先比各自报出的问题数量，有差异再逐本看。你大概会发现几处差异：TS 版本会先去掉行内代码再查图片链接、还检查跨书链接和锚点，这些上一章的 `shelf-core` 都没实现。

## 发布构建

```bash
cargo build --release
ls -lh target/release/shelf
./target/release/shelf check ~/books
```

根 `Cargo.toml` 里的 `[profile.release]` 做了三件事：`lto = true` 跨 crate 做链接期优化，`codegen-units = 1` 牺牲编译速度换更好的优化，`strip = true` 去掉调试符号减小体积。这样编译出的 `shelf` 是一个几 MB 的独立文件，复制到任何同架构的 Mac 上都能直接运行，不需要装 Rust 或 Node。

想知道它比 TS 版本快多少，用 `hyperfine` 实测，不要凭感觉：

```bash
hyperfine --warmup 2 'pnpm -s shelf-pack check books/' './target/release/shelf check books/'
```

要注意比较的是什么：`pnpm shelf-pack` 每次都要启动 Node、用 tsx 编译 TS，这部分固定开销可能占了大头；而且两边实现的规则并不相同。实测数字要结合这两点来读。

### 给别的机器用

```bash
cargo install --path crates/shelf-cli          # 装到 ~/.cargo/bin，自己用
rustup target add x86_64-apple-darwin          # 给 Intel Mac 交叉编译
cargo build --release --target x86_64-apple-darwin
```

要发给别人用时，常见做法是在 GitHub Actions 里为每个平台编译，上传到 Release；或者像 Biome、esbuild 那样，把各平台的二进制放进各自的 npm 包，用 `optionalDependencies` 按平台安装。第 10 章的 napi-rs 用的就是后一种方式。

## 该不该替换 shelf-pack

写完这个工具，自然会想：要不要用它替换书巢现有的 `shelf-pack check`？答案是**不要**，原因正是书巢的代码规范里写的那条：

> 判断书籍结构的逻辑（容错规则、扩展名白名单、zip slip 检查）只写在 `@shelf/spec`，App 和 CLI 调用它。

`@shelf/spec` 是 TS 写的，App（React Native）和 CLI 共用。如果 CLI 换成 Rust，同一套规则就要在两种语言里各维护一份，而两份实现一旦不一致（比如[上一章](08-cli-clap.md#manifestrsbookyaml)提到的 `reason` 字数在 emoji 上的差异），就会出现「电脑上检查通过、手机上导入失败」这种最难排查的问题。现在的 TS 版本检查八十多本书并不慢，换语言带来的速度提升解决的不是一个真实存在的问题。

这个 Rust 版本的价值在于：它是一个规模合适的练习，涵盖了解析、校验、并行、错误处理、测试、发布的全流程；它产出的 `shelf-core` 库在后两章会被 Tauri 和 WASM 复用。如果哪天规则真的需要由 Rust 维护（比如做一个独立的桌面写书工具），第 10 章会讲怎么让 TS 那一侧也调用同一份 Rust 实现，而不是维护两份。

## 本章要点

- 二进制 crate 只做参数解析和输出，逻辑都在上一章的 `shelf-core` 里
- clap derive 从结构体生成参数解析、校验和 `--help`，`///` 注释就是帮助文字
- 退出码区分「通过 / 有问题 / 工具出错」，方便脚本和 CI 判断
- `par_iter` 并行检查每本书，因为没有共享可变状态，不需要锁
- 测试写在同文件的 `#[cfg(test)] mod tests` 里，`cargo test` 运行；重写已有工具时用真实数据对照两个实现
- `--release` 加 LTO、strip 得到一个独立的二进制文件；性能对比用 hyperfine 实测
- 规则要被多端共用时，不要用两种语言各写一份

## 动手练习

1. **clap 替你拒绝非法值**：运行 `cargo run -p shelf-cli -- check books --format yaml`，预测输出和退出码（`echo $?`）。再试 `cargo run -p shelf-cli -- check --help`，找到 `--format` 那一行。

   验证：clap 报 `invalid value 'yaml' for '--format <FORMAT>'`，并列出可选值 `text`、`json`，退出码是 `2`；`check --help` 里能看到 `--format` 的默认值 `text` 和可选值，以及 `--strict` 的说明（来自 `///` 注释）。

   参考答案：`ValueEnum` 把枚举的变体变成合法取值，解析阶段就拒绝了非法输入，你的代码拿到的 `format` 一定是 `Text` 或 `Json`。clap 的用法错误默认以 2 退出，正好和本章「2 表示工具本身出错」的约定一致。

2. **三种退出码**：在临时目录里造一本书 `demo/`（`book.yaml` 的 `id: demo`，`chapters: [01-a.md]`，`01-a.md` 内容为 `# 一\n`），再在目录里多放一个没列入 chapters 的 `draft.md`。依次运行下面三条命令，每条之后 `echo $?`，先写下预测：

   ```bash
   shelf check demo
   shelf check demo --strict
   shelf check no-such-dir
   ```

   验证：第一条输出 `✗ demo` 和一条 `警告 draft.md 未列入 chapters，不会被导入`，退出码 `0`（只有警告）；第二条输出相同，退出码 `1`；第三条在 stderr 打印以 `shelf: 读取目录 no-such-dir 失败` 开头的一行，退出码 `2`。

   参考答案：`check` 返回 `Ok(false)` 映射为 1，`Err` 映射为 2；`--strict` 让警告也算失败。注意第一条虽然退出码为 0，文本输出里仍是 `✗`，因为它只看 `issues` 是否为空，这也是可以顺手改进的地方。

3. **让 ls 的容器借用临时数据**：把 `ls` 里的 `shelves` 改成 `BTreeMap<&str, Vec<(&str, &str)>>`，`push((&m.id, &m.title))`，并去掉 `shelf` 末尾的 `.to_string()`，`cargo check`。

   验证：报「借用的值活得不够久」一类的错误（通常是 `E0597`），指出 `m` 在本轮循环结束时被释放，而 `shelves` 之后还要用。改回拥有所有权的版本后通过。

   参考答案：`m` 是每轮循环临时加载的，容器活得比它久，只能拥有数据。原来的 `push((m.id, m.title))` 把字段移出 `m`，不需要 clone。
