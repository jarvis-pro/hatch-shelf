# 写一个 CLI（上）：Cargo workspace 与检查库

前七章的知识，第一个落地的地方最好是 CLI：输入是命令行参数和文件，输出是终端文本和退出码，没有界面、没有网络，所有权和错误处理的问题都会出现，但规模可控。而且 Rust 编译出来的是一个独立的二进制文件，不需要目标机器装 Node，这是它做命令行工具最大的优势之一。

从这一章开始搭建 `shelf-rs`：一个 Cargo workspace，里面一个库 crate `shelf-core` 负责检查逻辑，一个二进制 crate `shelf-cli` 用 clap 解析参数、并行检查、输出文本或 JSON。内容分两章：这一章搭 workspace、写完 `shelf-core` 这个库；[下一章](08-cli-commands.md)用 clap 给它套上命令行，再讲测试、发布构建，以及一个诚实的问题：书巢该不该用它替换现在的 `shelf-pack check`。

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

`lint.rs` 完整文件分 3 段给出，从上到下拼起来就是整个文件。第一段定义问题的严重程度和 `Issue`，附带两个构造函数和打印格式：

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
```

第二段是逐行扫描：`MdLine` 描述一行，`fence_marker` 识别围栏标记，`scan` 返回一个迭代器，边走边记录当前是否在代码块里：

```rust
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
```

第三段是两个判断函数和对外的 `lint_chapter`：用上一段的 `scan` 逐行检查代码块语言、H1 数量和远程图片：

```rust
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

`manifest.rs` 完整文件分 3 段给出，从上到下拼起来就是整个文件。第一段是导入和与 `book.yaml` 对应的类型：

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
```

第二段是读取失败时的错误类型 `LoadError`（用 thiserror 派生），以及判断 slug 的 `is_slug`：

```rust
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
```

第三段是 `validate`：serde 只保证结构，业务规则在这里逐条检查，问题全部收集后返回：

```rust
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

## 本章要点

- 库 crate 放逻辑，二进制 crate 只做参数解析和输出；Cargo workspace 统一依赖版本、`Cargo.lock` 和 `target/`
- `[workspace.dependencies]` 相当于 pnpm 的 `catalog:`，成员里写 `xxx.workspace = true`
- 检查逻辑拆成单章扫描（`lint.rs`）、`book.yaml` 解析与校验（`manifest.rs`）和组合（`lib.rs`）三块；serde 只管形状，规则自己校验
- 按字符数算长度用 `chars().count()`，`len()` 是 UTF-8 字节数；跨语言重写时这类细节最容易不一致
- `mod` 声明模块，`pub use` 重新导出，相当于 TS 的 `index.ts`；Rust 默认私有
- `Result` 实现了 `IntoIterator`，`flatten` 可以顺手过滤掉读取失败的项

## 动手练习

1. **给 lint_chapter 写一个测试**：在 `lint.rs` 末尾加一个测试模块，先写下你预测的问题列表，再 `cargo test -p shelf-core`。

   ```rust
   #[cfg(test)]
   mod tests {
       use super::*;

       #[test]
       fn mixed() {
           let md = "# 标题\n~~~\nx\n~~~\n# 第二个\n![a](https://x.test/a.png)\n";
           let got: Vec<String> = lint_chapter("a.md", md).iter().map(|i| i.to_string()).collect();
           assert_eq!(got, vec!["在这里写你的预测"]);
       }
   }
   ```

   验证：第一次运行测试失败，`assert_eq!` 的输出里 `left` 就是实际结果：依次是 `错误 a.md:2 代码块没有标注语言`、`错误 a.md:6 远程图片（离线时无法显示）`、`错误 a.md 有 2 个 H1，每章只能有一个`。把它们填进 `vec![...]` 后测试通过。

   参考答案：`~~~` 也是围栏，后面没写语言；逐行的问题按行号先后加入，H1 计数在扫描结束后才报告，所以排在最后。

2. **is_slug 的边界**：对 `"rust-practice"`、`"Rust"`、`"a--b"`、`"-a"`、`"a1"`、`""` 逐个预测 `is_slug` 的结果，写成一个 `#[test]` 里的六条 `assert_eq!`。

   验证：`cargo test` 通过时，结果依次是 `true`、`false`、`false`、`false`、`true`、`false`。

   参考答案：大写字母不在允许的字节里；连续的 `--`、开头或结尾的 `-` 被单独排除；空串被第一条条件排除。和 `@shelf/spec` 的 `SLUG_RE` 对照，可以把这组用例同时放进 TS 测试，确认两边一致。

3. **把 chars().count() 换成 len()**：写一个测试，构造一个 `next` 里 `reason` 为 30 个汉字（`"字".repeat(30)`）的 `BookManifest`，断言 `validate` 不报 reason 超长。先确认通过，再把 `validate` 里的 `r.chars().count()` 改成 `r.len()`，预测测试结果。

   验证：原代码测试通过；改成 `len()` 后测试失败，多出一条 `next ... 的 reason 超过 60 字`。

   参考答案：30 个汉字是 90 个 UTF-8 字节。跨语言移植规则时，这类「长度怎么数」的差别最好用测试固定下来。

库写好了，但还没有入口。[下一章](08-cli-commands.md)用 clap 定义 `check` 和 `ls` 两个命令，并行检查全部书，再讲测试和发布。
