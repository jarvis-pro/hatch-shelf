# 类型、trait 与泛型

TS 的类型系统是**结构化**的：只要形状对得上，就是同一个类型。Rust 是**名义**的：类型名不同就是不同的类型，哪怕字段一模一样。这个差别决定了两种语言里「接口」的用法很不一样。这一章从结构体和枚举讲起，再讲 trait（Rust 的接口）、泛型与 trait 约束、静态分发和动态分发，最后用 serde 把 `book.yaml` 解析成结构体，和你熟悉的 zod 做个对照。

## 结构体与枚举：把 TS 的类型翻译过来

先看一份熟悉的 TS 类型，它是书巢 `@shelf/spec` 里 `BookManifest` 的简化版：

```typescript
type Level = "beginner" | "intermediate" | "advanced";

interface NextBook {
  id: string;
  reason?: string;
}

interface BookManifest {
  id: string;
  title: string;
  subtitle?: string;
  level?: Level;
  tags?: string[];
  chapters: string[];
  next?: NextBook[];
}
```

翻译成 Rust：

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Level {
    Beginner,
    Intermediate,
    Advanced,
}

#[derive(Debug, Clone)]
struct NextBook {
    id: String,
    reason: Option<String>,
}

#[derive(Debug, Clone)]
struct BookManifest {
    id: String,
    title: String,
    subtitle: Option<String>,
    level: Option<Level>,
    tags: Vec<String>,
    chapters: Vec<String>,
    next: Vec<NextBook>,
}
```

几处对应关系：

| TS | Rust | 说明 |
|---|---|---|
| `interface` / `type` 对象 | `struct` | 字段类型必须写全 |
| 可选字段 `x?: T` | `x: Option<T>` | 没有 `undefined`，缺省就是 `None` |
| 字符串字面量联合 `"a" \| "b"` | 无数据的 `enum` | 每个成员是一个具名变体 |
| 可辨识联合 | 带数据的 `enum` | 第 1 章见过 |
| `tags?: string[]` | `tags: Vec<String>` | 列表的「缺省」通常就用空列表表示，比 `Option<Vec<T>>` 好用 |

`#[derive(...)]` 让编译器自动为类型实现一些 trait，相当于自动生成样板代码。`Debug` 让它能用 `{:?}` 打印，`Clone` 让它能 `.clone()`，`PartialEq` 让它能用 `==` 比较。TS 里对象天生能打印、能展开复制，Rust 里这些能力都要显式声明，`derive` 让声明只需要一行。

### 名义类型：形状相同也不是同一个类型

```typescript
interface BookId { value: string }
interface ChapterFile { value: string }
const id: BookId = { value: "rust-practice" };
const file: ChapterFile = id;   // TS：合法，形状一样
```

```rust
struct BookId(String);       // 元组结构体：只有一个无名字段
struct ChapterFile(String);

fn open_book(id: &BookId) { println!("打开 {}", id.0); }

fn main() {
    let file = ChapterFile("01-why-rust.md".to_string());
    // open_book(&file);     // 编译错误：expected `&BookId`, found `&ChapterFile`
}
```

这种「只包一层」的结构体叫 **newtype**。在 TS 里你要用 branded type（`string & { __brand: "BookId" }`）才能做到同样的效果，在 Rust 里它是默认行为，而且没有任何运行时开销：`BookId` 在内存里和 `String` 完全一样。

## trait：Rust 的接口

trait 定义一组方法，类型通过 `impl Trait for Type` **显式**声明自己实现了它：

```rust
trait Lint {
    fn name(&self) -> &'static str;
    fn check(&self, file: &str, text: &str) -> Vec<String>;
}

struct SingleH1;
struct FenceLanguage;

impl Lint for SingleH1 {
    fn name(&self) -> &'static str {
        "single-h1"
    }

    fn check(&self, file: &str, text: &str) -> Vec<String> {
        let n = text.lines().filter(|l| l.starts_with("# ")).count();
        if n == 1 { vec![] } else { vec![format!("{file}：H1 有 {n} 个，应为 1 个")] }
    }
}

impl Lint for FenceLanguage {
    fn name(&self) -> &'static str {
        "fence-language"
    }

    fn check(&self, file: &str, text: &str) -> Vec<String> {
        let mut problems = Vec::new();
        let mut in_fence = false;
        for (i, line) in text.lines().enumerate() {
            if let Some(rest) = line.trim_start().strip_prefix("```") {
                if !in_fence && rest.trim().is_empty() {
                    problems.push(format!("{file}:{}：代码块没有标注语言", i + 1));
                }
                in_fence = !in_fence;
            }
        }
        problems
    }
}
```

（`SingleH1` 这里为了简短没跳过代码块里的 `#`，完整版见第 8 章。）

和 TS 的 `interface` 对比：

| | TS `interface` | Rust `trait` |
|---|---|---|
| 实现方式 | 结构化，形状对上就算实现 | 显式 `impl Trait for Type` |
| 能否给别人的类型加方法 | 不能（只能用声明合并或包装） | 能：给 `String` 实现你自己的 trait |
| 默认实现 | 不能（`interface` 只有签名） | 能：trait 里可以写带方法体的默认方法 |
| 字段 | 可以声明字段 | 只有方法，没有字段 |

`if let Some(rest) = ...` 是只关心一个分支时的 `match` 简写，`strip_prefix` 在前缀匹配时返回 `Some(剩余部分)`，否则返回 `None`。

### 默认方法和给已有类型加方法

```rust
trait Describe {
    fn title(&self) -> String;

    fn describe(&self) -> String {        // 默认实现，实现者可以覆盖
        format!("《{}》", self.title())
    }
}

impl Describe for BookManifest {
    fn title(&self) -> String {
        self.title.clone()
    }
}

trait WordCount {
    fn cjk_chars(&self) -> usize;
}

impl WordCount for str {                  // 给标准库的 str 加方法
    fn cjk_chars(&self) -> usize {
        self.chars().filter(|c| ('\u{4e00}'..='\u{9fff}').contains(c)).count()
    }
}

fn main() {
    println!("{}", "所有权与借用 ownership".cjk_chars());   // 6
}
```

给外部类型实现 trait 有一条限制，叫**孤儿规则**：trait 和类型至少有一个是你自己 crate 里定义的。你可以给 `str` 实现自己的 `WordCount`，也可以给自己的 `BookManifest` 实现标准库的 `Display`，但不能给 `str` 实现标准库的 `Display`。这防止了两个库给同一个类型实现同一个 trait 而互相冲突。

## 泛型与 trait 约束

Rust 的泛型和 TS 写法相似，约束用 trait 表达：

```typescript
function longest<T extends { length: number }>(items: T[]): T | undefined {
  return items.reduce<T | undefined>((a, b) => (!a || b.length > a.length ? b : a), undefined);
}
```

```rust
use std::fmt::Display;

fn print_all<T: Display>(items: &[T]) {
    for item in items {
        println!("- {item}");
    }
}

fn max_by_key<T, K: PartialOrd>(items: &[T], key: impl Fn(&T) -> K) -> Option<&T> {
    let mut best: Option<&T> = None;
    for item in items {
        match best {
            Some(b) if key(b) >= key(item) => {}
            _ => best = Some(item),
        }
    }
    best
}
```

约束复杂时，把它挪到 `where` 子句里，可读性更好：

```rust
fn summarize<T>(items: &[T]) -> String
where
    T: Display + Clone,
{
    items.iter().map(|i| i.to_string()).collect::<Vec<_>>().join("、")
}
```

`T: Display + Clone` 表示 T 必须同时实现两个 trait，相当于 TS 的交叉类型约束。

### 单态化：泛型没有运行时开销

TS 的泛型在编译后被擦除，运行时只有一份函数。Rust 的泛型是**单态化**的：`print_all::<String>` 和 `print_all::<i32>` 会被编译成两份独立的机器码，各自针对具体类型优化。好处是零运行时开销，代价是编译变慢、二进制变大。

### impl Trait：参数和返回值的简写

```rust
fn print_one(item: impl Display) {        // 等价于 fn print_one<T: Display>(item: T)
    println!("{item}");
}

fn chapter_files(m: &BookManifest) -> impl Iterator<Item = &String> {
    m.chapters.iter().filter(|f| f.ends_with(".md"))
}
```

返回位置的 `impl Trait` 很常用：它表示「返回某个实现了这个 trait 的具体类型，但我不告诉你具体是什么」。迭代器链的真实类型名又长又难写，用 `impl Iterator<Item = ...>` 就够了。

## 静态分发与动态分发

回到前面的 `Lint`。如果要把多条规则放进一个列表依次运行，问题来了：`SingleH1` 和 `FenceLanguage` 是两个不同的类型，`Vec` 只能装一种类型。这时用 **trait 对象** `dyn Lint`：

```rust
fn run_lints(lints: &[Box<dyn Lint>], file: &str, text: &str) -> Vec<String> {
    let mut all = Vec::new();
    for lint in lints {
        for problem in lint.check(file, text) {
            all.push(format!("[{}] {problem}", lint.name()));
        }
    }
    all
}

fn main() {
    let lints: Vec<Box<dyn Lint>> = vec![Box::new(SingleH1), Box::new(FenceLanguage)];
    let text = "# 标题\n\n```\nfn main() {}\n```\n";
    for p in run_lints(&lints, "demo.md", text) {
        println!("{p}");
    }
}
```

`Box<T>` 把值放到堆上，`Box<dyn Lint>` 是「堆上某个实现了 `Lint` 的值」，调用方法时通过虚表（vtable）查找具体实现，就像 JS 里通过原型链找方法。

| | 泛型 `T: Lint` / `impl Lint` | trait 对象 `dyn Lint` |
|---|---|---|
| 分发方式 | 静态：编译期确定调用哪个函数 | 动态：运行时查虚表 |
| 性能 | 可内联，最快 | 多一次间接调用，通常可忽略 |
| 一个集合里混放不同类型 | 不行 | 行 |
| 二进制体积 | 每个类型一份代码 | 一份代码 |
| 适合 | 默认选择 | 插件式、异构集合 |

规则也简单：**默认用泛型，需要把不同类型放在一起时用 `dyn`**。在 TS 里你不用想这个问题，因为所有方法调用都是动态的。

## 常用的标准 trait

| trait | 作用 | TS 里的对应 |
|---|---|---|
| `Debug` | `{:?}` 调试打印，通常 `derive` | `console.log` 的默认输出 |
| `Display` | `{}` 面向用户的打印，手写 | `toString()` |
| `Clone` / `Copy` | 复制 | `structuredClone` / 原始值赋值 |
| `PartialEq` / `Eq` | `==` | 手写 `isEqual` |
| `PartialOrd` / `Ord` | `<` 和排序 | `sort` 的比较函数 |
| `Hash` | 能做 `HashMap` 的键 | `Map` 的键（JS 按引用，Rust 按值） |
| `Default` | 默认值 `T::default()` | 对象字面量里的默认字段 |
| `From` / `Into` | 类型转换 | 工厂函数 |
| `FromStr` | `"..".parse::<T>()` | 自定义解析函数 |
| `Iterator` | 能被 `for` 遍历 | `[Symbol.iterator]` |

给 `Level` 实现 `Display` 和 `FromStr`，它就能和字符串互相转换：

```rust
use std::fmt;
use std::str::FromStr;

impl fmt::Display for Level {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            Level::Beginner => "beginner",
            Level::Intermediate => "intermediate",
            Level::Advanced => "advanced",
        };
        write!(f, "{s}")
    }
}

impl FromStr for Level {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "beginner" => Ok(Level::Beginner),
            "intermediate" => Ok(Level::Intermediate),
            "advanced" => Ok(Level::Advanced),
            other => Err(format!("未知的 level：{other}")),
        }
    }
}

fn main() {
    let level: Level = "intermediate".parse().unwrap();
    println!("{level}");              // intermediate
    println!("{:?}", "expert".parse::<Level>());   // Err("未知的 level：expert")
}
```

`type Err = String;` 是**关联类型**：实现 trait 时顺带指定一个类型。`Iterator` 的 `type Item` 也是关联类型，它让 `Iterator<Item = String>` 这种写法成立。`Result` 下一章讲。

### From 和 Into

实现了 `From<A> for B`，就自动得到 `Into<B> for A`：

```rust
struct BookId(String);

impl From<&str> for BookId {
    fn from(s: &str) -> Self {
        BookId(s.to_string())
    }
}

fn open(id: impl Into<BookId>) {
    let id: BookId = id.into();
    println!("打开 {}", id.0);
}

fn main() {
    open("rust-practice");                 // &str 自动转成 BookId
    open(BookId::from("electron-desktop"));
}
```

上一章出现过的 `"rust-practice".into()` 就是这个机制：标准库为 `String` 实现了 `From<&str>`。`From` 在下一章的错误处理里还有一个重要用途：`?` 运算符靠它自动转换错误类型。

## serde：用结构体解析 book.yaml

在 TS 里，你用 zod 定义 schema，从中推导类型，再用它校验外部数据。Rust 的做法反过来：**先定义类型，再派生序列化和反序列化**。这件事由 serde 完成，它是 Rust 生态里使用最广的 crate 之一。

```bash
cargo add serde --features derive
cargo add serde_yaml
```

> [!WARNING]
> `serde_yaml` 的作者已在 2024 年把它标记为不再维护（最后版本 0.9.x），现在仍能正常使用，社区也有 `serde_yaml_ng`、`serde_norway` 等分支。选 YAML 库前到 crates.io 看一下最新的维护状态，以各库文档为准。JSON 用 `serde_json`、TOML 用 `toml`，这两个都在活跃维护。

```rust
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Level {
    Beginner,
    Intermediate,
    Advanced,
}

#[derive(Debug, Deserialize)]
struct NextBook {
    id: String,
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BookManifest {
    id: String,
    title: String,
    subtitle: Option<String>,
    category: Option<String>,
    level: Option<Level>,
    #[serde(default)]
    tags: Vec<String>,
    chapters: Vec<String>,
    #[serde(default)]
    next: Vec<NextBook>,
}

fn main() {
    let text = std::fs::read_to_string("book.yaml").expect("读不到 book.yaml");
    let manifest: BookManifest = serde_yaml::from_str(&text).expect("book.yaml 格式不对");
    println!("{}：{} 章，level = {:?}", manifest.title, manifest.chapters.len(), manifest.level);
}
```

和 zod 对照：

| zod | serde | 说明 |
|---|---|---|
| `z.object({...})` | `#[derive(Deserialize)] struct` | 类型就是 schema |
| `.optional()` | `Option<T>` | 字段缺失时是 `None` |
| `.default([])` | `#[serde(default)]` | 用类型的 `Default` 值 |
| `z.enum([...])` | `enum` + `rename_all` | 名字映射规则统一配置 |
| `.regex(...)`、`.max(60)` | 无内置，要手写校验 | serde 只管**形状**，不管业务规则 |
| `.passthrough()` / `.strict()` | 默认忽略多余字段；`#[serde(deny_unknown_fields)]` 拒绝 | 默认行为和 zod 的默认（剥掉多余字段）接近 |
| `z.preprocess(...)` | `#[serde(deserialize_with = "...")]` | 自定义解析函数 |

最后两行之外的那条差别最重要：**serde 只保证结构正确，`id` 只能含 `[a-z0-9-]`、`reason` 不超过 60 字这类规则要自己写**。常见做法是反序列化之后调用一个 `validate` 方法，返回错误列表。这正是下一章的主题。

`created: 2026-11-04` 这种字段，在 YAML 里不加引号会被一些解析器当成日期。书巢的 TS 代码用 `z.preprocess` 统一成字符串；Rust 里如果声明为 `Option<String>`，`serde_yaml` 会把它当字符串读进来，不需要额外处理。用别的 YAML 库时要实际测一下。

## 本章要点

- Rust 是名义类型系统：形状相同、名字不同就是不同类型；newtype 免费得到 TS branded type 的效果
- `Option<T>` 表示可选字段，无数据的 `enum` 表示字符串字面量联合，带数据的 `enum` 表示可辨识联合
- trait 是显式实现的接口，可以有默认方法，可以给外部类型实现自己的 trait（受孤儿规则限制）
- 泛型靠 trait 约束，单态化编译，零运行时开销；返回迭代器用 `impl Iterator<Item = T>`
- 默认用泛型（静态分发），需要异构集合时用 `Box<dyn Trait>`（动态分发）
- `Display`、`FromStr`、`From` / `Into` 是最常手写的几个标准 trait
- serde 从类型派生解析，只管形状；业务规则要在反序列化后自己校验
