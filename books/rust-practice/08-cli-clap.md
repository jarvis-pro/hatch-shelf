# 写一个 CLI：clap 与 Cargo workspace

前七章的知识，第一个落地的地方最好是 CLI：输入是命令行参数和文件，输出是终端文本和退出码，没有界面、没有网络，所有权和错误处理的问题都会出现，但规模可控。而且 Rust 编译出来的是一个独立的二进制文件，不需要目标机器装 Node，这是它做命令行工具最大的优势之一。

这一章从零搭建 `shelf-rs`：一个 Cargo workspace，里面一个库 crate `shelf-core` 负责检查逻辑，一个二进制 crate `shelf-cli` 用 clap 解析参数、并行检查、输出文本或 JSON。最后讲测试、发布构建，以及一个诚实的问题：书巢该不该用它替换现在的 `shelf-pack check`。

## 项目结构：库和命令行分开

```bash
mkdir shelf-rs && cd shelf-rs
cargo new --lib crates/shelf-core
cargo new crates/shelf-cli
```

根目录的 `Cargo.toml` 声明 workspace，并统一管理依赖版本：

```toml
[workspace]
resolver = "3"
members = ["crates/*"]

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
serde_yaml = "0.9"
serde_json = "1"
thiserror = "2"
anyhow = "1"
clap = { version = "4", features = ["derive"] }
rayon = "1"
shelf-core = { path = "crates/shelf-core" }

[profile.release]
lto = true
codegen-units = 1
strip = true
```

> [!WARNING]
> 依赖版本按 2026 年 11 月的情况填写：clap 4、serde 1、thiserror 2、rayon 1；`serde_yaml` 已停止维护（见[第 4 章](04-types-traits-generics.md)）。`resolver = "3"` 需要 Rust 1.84 及以上。写进项目前用 `cargo add` 让 Cargo 选最新的兼容版本，并以 crates.io 和 docs.rs 上的说明为准。

这对应 pnpm workspace 的几个概念：

| pnpm workspace | Cargo workspace |
|---|---|
| `pnpm-workspace.yaml` 里的 `packages` | `[workspace] members` |
| `catalog:` 统一版本 | `[workspace.dependencies]`，成员里写 `serde.workspace = true` |
| `"@shelf/spec": "workspace:*"` | `shelf-core = { path = "..." }` |
| 根目录一份 `pnpm-lock.yaml` | 根目录一份 `Cargo.lock`，`target/` 也共用 |

把检查逻辑放进库，命令行只是一层薄壳，是 Rust 社区的通行做法，和书巢把规则放进 `@shelf/spec`、CLI 和 App 共用是同一个思路。到第 9、10 章，同一个 `shelf-core` 会被 Tauri 和 WASM 再复用两次。

`crates/shelf-core/Cargo.toml`：

```toml
[package]
name = "shelf-core"
version = "0.1.0"
edition = "2024"

[dependencies]
serde.workspace = true
serde_yaml.workspace = true
thiserror.workspace = true
```

`crates/shelf-cli/Cargo.toml`：

```toml
[package]
name = "shelf-cli"
version = "0.1.0"
edition = "2024"

[[bin]]
name = "shelf"
path = "src/main.rs"

[dependencies]
shelf-core.workspace = true
anyhow.workspace = true
clap.workspace = true
rayon.workspace = true
serde_json.workspace = true
```

`[[bin]] name = "shelf"` 让编译出的可执行文件叫 `shelf`，而不是包名 `shelf-cli`。

## shelf-core：检查逻辑

库分三个文件：`lint.rs` 检查单章，`manifest.rs` 解析和校验 `book.yaml`，`lib.rs` 把它们组合起来。

### lint.rs：逐行扫描 Markdown

```rust
use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Debug, Clone, Serialize)]
pub struct Issue {
    pub severity: Severity,
    pub file: String,
    pub line: Option<usize>,
    pub message: String,
}

impl Issue {
    pub fn error(file: &str, line: Option<usize>, message: impl Into<String>) -> Self {
        Issue { severity: Severity::Error, file: file.to_string(), line, message: message.into() }
    }

    pub fn warning(file: &str, line: Option<usize>, message: impl Into<String>) -> Self {
        Issue { severity: Severity::Warning, file: file.to_string(), line, message: message.into() }
    }
}

impl fmt::Display for Issue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let level = match self.severity {
            Severity::Error => "错误",
            Severity::Warning => "警告",
        };
        match self.line {
            Some(n) => write!(f, "{level} {}:{n} {}", self.file, self.message),
            None => write!(f, "{level} {} {}", self.file, self.message),
        }
    }
}

/// 扫描结果中的一行：行号、原文、是否在代码块内；开头的 fence 行带上语言标注
pub struct MdLine<'a> {
    pub no: usize,
    pub text: &'a str,
    pub in_fence: bool,
    pub fence_info: Option<&'a str>,
}

/// 行首连续 3 个以上的 ` 或 ~，返回这段标记
fn fence_marker(line: &str) -> Option<&str> {
    for ch in ['`', '~'] {
        let n = line.chars().take_while(|&c| c == ch).count();
        if n >= 3 {
            return Some(&line[..n]);
        }
    }
    None
}

pub fn scan(markdown: &str) -> impl Iterator<Item = MdLine<'_>> {
    let mut open: Option<&str> = None;   // 当前打开的 fence 标记
    markdown.lines().enumerate().map(move |(i, text)| {
        let trimmed = text.trim_start();
        let no = i + 1;
        match (open, fence_marker(trimmed)) {
            (None, Some(m)) => {
                open = Some(m);
                let info = trimmed[m.len()..].trim();
                MdLine { no, text, in_fence: true, fence_info: Some(info) }
            }
            // 关闭标记：同一种字符、不短于开头、后面没有别的内容
            (Some(o), Some(m)) if m.starts_with(o) && trimmed[m.len()..].trim().is_empty() => {
                open = None;
                MdLine { no, text, in_fence: true, fence_info: None }
            }
            (Some(_), _) => MdLine { no, text, in_fence: true, fence_info: None },
            (None, None) => MdLine { no, text, in_fence: false, fence_info: None },
        }
    })
}

fn is_h1(line: &str) -> bool {
    line.strip_prefix('#')
        .is_some_and(|rest| rest.starts_with(|c: char| c == ' ' || c == '\t') && !rest.trim().is_empty())
}

fn has_remote_image(line: &str) -> bool {
    line.match_indices("![").any(|(i, _)| {
        line[i..].find("](").is_some_and(|j| {
            let src = line[i + j + 2..].trim_start();
            src.starts_with("http://") || src.starts_with("https://") || src.starts_with("//")
        })
    })
}

pub fn lint_chapter(file: &str, markdown: &str) -> Vec<Issue> {
    let mut issues = Vec::new();
    let mut h1 = 0;
    for line in scan(markdown) {
        if line.fence_info == Some("") {
            issues.push(Issue::error(file, Some(line.no), "代码块没有标注语言"));
        }
        if line.in_fence {
            continue;
        }
        if is_h1(line.text) {
            h1 += 1;
        }
        if has_remote_image(line.text) {
            issues.push(Issue::error(file, Some(line.no), "远程图片（离线时无法显示）"));
        }
    }
    match h1 {
        0 => issues.push(Issue::error(file, None, "没有 H1 章标题")),
        1 => {}
        n => issues.push(Issue::error(file, None, format!("有 {n} 个 H1，每章只能有一个"))),
    }
    issues
}
```

这段代码把前几章的东西都用上了：

- `scan` 返回 `impl Iterator<Item = MdLine<'_>>`，每一行的 `text` 和 `fence_info` 都借用原文，不复制字符串（第 3 章的零拷贝）
- `map` 的闭包是 `move` 的，并且修改了捕获的 `open`，所以它是 `FnMut`（第 6 章）
- `message: impl Into<String>` 让调用方既能传 `"字面量"`，也能传 `format!(...)` 的结果（第 4 章的 `Into`）
- `fence_marker` 里的 `&line[..n]` 按字节切片，因为前 `n` 个字符都是单字节的 `` ` `` 或 `~`，切片一定落在字符边界上

### manifest.rs：book.yaml

```rust
use crate::lint::Issue;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Beginner,
    Intermediate,
    Advanced,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NextBook {
    pub id: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookManifest {
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub category: Option<String>,
    pub level: Option<Level>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub chapters: Vec<String>,
    #[serde(default)]
    pub next: Vec<NextBook>,
}

#[derive(Debug, Error)]
pub enum LoadError {
    #[error("读取 {} 失败", .path.display())]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("book.yaml 格式错误：{0}")]
    Yaml(#[from] serde_yaml::Error),
}

/// [a-z0-9]+ 用单个 - 连接，与 @shelf/spec 的 SLUG_RE 一致
pub fn is_slug(s: &str) -> bool {
    !s.is_empty()
        && !s.starts_with('-')
        && !s.ends_with('-')
        && !s.contains("--")
        && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

impl BookManifest {
    /// serde 只保证形状，这里检查业务规则
    pub fn validate(&self, dir_name: &str) -> Vec<Issue> {
        let err = |msg: String| Issue::error("book.yaml", None, msg);
        let mut issues = Vec::new();

        if !is_slug(&self.id) {
            issues.push(err(format!("id 只能包含 [a-z0-9-]：{}", self.id)));
        }
        if self.id != dir_name {
            issues.push(err(format!("id（{}）与目录名（{dir_name}）不一致", self.id)));
        }
        if self.chapters.is_empty() {
            issues.push(err("chapters 不能为空".to_string()));
        }

        let mut seen = HashSet::new();
        for ch in &self.chapters {
            if !seen.insert(ch) {
                issues.push(err(format!("chapters 中有重复文件：{ch}")));
            }
            if !ch.strip_suffix(".md").is_some_and(is_slug) {
                issues.push(err(format!("章节文件名只能包含 [a-z0-9-] 并以 .md 结尾：{ch}")));
            }
        }

        if self.next.len() > 3 {
            issues.push(err("next 最多 3 本".to_string()));
        }
        for n in &self.next {
            if n.id == self.id {
                issues.push(err("next 不能推荐本书自己".to_string()));
            }
            if n.reason.as_ref().is_some_and(|r| r.chars().count() > 60) {
                issues.push(err(format!("next {} 的 reason 超过 60 字", n.id)));
            }
        }
        issues
    }
}
```

`reason` 的长度用 `chars().count()` 而不是 `len()`：后者是 UTF-8 字节数，60 个汉字会被算成 180（第 6 章）。zod 的 `.max(60)` 按 JS 字符串的 `length` 算，也就是 UTF-16 码元数，常用汉字两边结果相同，但 emoji 会有差异。这类细节正是跨语言重写时最容易出现不一致的地方。

### lib.rs：组合

```rust
mod lint;
mod manifest;

pub use lint::{lint_chapter, scan, Issue, MdLine, Severity};
pub use manifest::{is_slug, BookManifest, Level, LoadError, NextBook};

use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct CheckedBook {
    pub manifest: BookManifest,
    pub issues: Vec<Issue>,
}

impl CheckedBook {
    pub fn count(&self, severity: Severity) -> usize {
        self.issues.iter().filter(|i| i.severity == severity).count()
    }
}

pub fn load_manifest(dir: &Path) -> Result<BookManifest, LoadError> {
    let path = dir.join("book.yaml");
    let text = fs::read_to_string(&path).map_err(|source| LoadError::Io { path: path.clone(), source })?;
    Ok(serde_yaml::from_str(&text)?)
}

pub fn check_book(dir: &Path) -> Result<CheckedBook, LoadError> {
    let manifest = load_manifest(dir)?;
    let abs = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
    let dir_name = abs.file_name().and_then(|n| n.to_str()).unwrap_or_default();
    let mut issues = manifest.validate(dir_name);

    for file in &manifest.chapters {
        match fs::read_to_string(dir.join(file)) {
            Ok(md) => issues.extend(lint_chapter(file, &md)),
            Err(e) => issues.push(Issue::error(file, None, format!("读取失败：{e}"))),
        }
    }

    // 目录里有 .md 但没列进 chapters：不算错，导入时会被忽略
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.ends_with(".md") && !manifest.chapters.contains(&name) {
                issues.push(Issue::warning(&name, None, "未列入 chapters，不会被导入"));
            }
        }
    }

    Ok(CheckedBook { manifest, issues })
}
```

`mod lint;` 声明一个模块，对应同目录的 `lint.rs`；`pub use` 把模块里的东西重新导出到 crate 根，相当于 TS 里 `index.ts` 的 `export { ... } from "./lint"`。Rust 的可见性默认是私有的，`pub` 才能被外部使用，和 TS 默认不导出是一个意思。

`entries.flatten()` 跳过读取失败的目录项：`read_dir` 产出的是 `Result<DirEntry>`，而 `Result` 实现了 `IntoIterator`（`Ok` 产出一个元素，`Err` 产出零个），所以 `flatten` 正好把错误过滤掉。

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

Rust 的单元测试直接写在源文件里，放在一个只在测试时编译的模块中。在 `lint.rs` 末尾加上：

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

输出格式不同，不能直接 `diff`，但可以先比各自报出的问题数量，有差异再逐本看。你大概会发现几处差异：TS 版本会先去掉行内代码再查图片链接、还检查跨书链接和锚点，这些本章的 Rust 版本都没实现。

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

`@shelf/spec` 是 TS 写的，App（React Native）和 CLI 共用。如果 CLI 换成 Rust，同一套规则就要在两种语言里各维护一份，而两份实现一旦不一致（比如上面提到的 `reason` 字数在 emoji 上的差异），就会出现「电脑上检查通过、手机上导入失败」这种最难排查的问题。现在的 TS 版本检查八十多本书并不慢，换语言带来的速度提升解决的不是一个真实存在的问题。

这个 Rust 版本的价值在于：它是一个规模合适的练习，涵盖了解析、校验、并行、错误处理、测试、发布的全流程；它产出的 `shelf-core` 库在后两章会被 Tauri 和 WASM 复用。如果哪天规则真的需要由 Rust 维护（比如做一个独立的桌面写书工具），第 10 章会讲怎么让 TS 那一侧也调用同一份 Rust 实现，而不是维护两份。

## 本章要点

- 库 crate 放逻辑，二进制 crate 只做参数解析和输出；Cargo workspace 统一依赖版本和 `target/`
- clap derive 从结构体生成参数解析、校验和 `--help`，`///` 注释就是帮助文字
- 退出码区分「通过 / 有问题 / 工具出错」，方便脚本和 CI 判断
- `par_iter` 并行检查每本书，因为没有共享可变状态，不需要锁
- 测试写在同文件的 `#[cfg(test)] mod tests` 里，`cargo test` 运行；重写已有工具时用真实数据对照两个实现
- `--release` 加 LTO、strip 得到一个独立的二进制文件；性能对比用 hyperfine 实测
- 规则要被多端共用时，不要用两种语言各写一份
