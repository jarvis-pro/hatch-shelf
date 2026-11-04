# 集合、迭代器与闭包

日常代码里最多的操作，是对一堆数据做过滤、变换、分组、统计。在 TS 里这是数组方法链 `filter().map().reduce()`；在 Rust 里是**迭代器**。两者写起来很像，但有两个关键区别：Rust 的迭代器是**惰性**的，而且所有权规则会决定你拿到的是元素本身、引用还是可变引用。

这一章先介绍常用集合，再讲迭代器的三种形态和常用适配器，然后讲闭包和它的三个 trait，最后用「按分类列出全部书」这个例子把它们串起来，它正是书巢 `pnpm shelf-pack ls` 做的事。

## 常用集合

| Rust | TS 对应 | 说明 |
|---|---|---|
| `Vec<T>` | `T[]` | 最常用，连续内存 |
| `VecDeque<T>` | 用数组模拟的队列 | 两端都能高效增删 |
| `HashMap<K, V>` | `Map<K, V>` | 无序；键要实现 `Hash + Eq` |
| `BTreeMap<K, V>` | 排序后的 `Map` | 按键有序遍历；键要实现 `Ord` |
| `HashSet<T>` / `BTreeSet<T>` | `Set<T>` | 同上，一个无序一个有序 |
| `String` | `string` | UTF-8，可增长 |

除了 `Vec` 和 `String`，其余都要先 `use std::collections::...`。

### Vec

```rust
fn main() {
    let mut files: Vec<String> = Vec::new();
    files.push("02-ownership-borrowing.md".to_string());
    files.push("01-why-rust.md".to_string());
    files.sort();                                   // 原地排序，字符串按字典序

    let first: &String = &files[0];                 // 越界会 panic
    let maybe: Option<&String> = files.get(10);     // 越界返回 None
    println!("{first} {maybe:?} {}", files.len());

    files.retain(|f| f.ends_with(".md"));           // 原地过滤，相当于 files = files.filter(...)
    if let Some(last) = files.pop() {
        println!("弹出 {last}");
    }
    println!("{}", files.contains(&"01-why-rust.md".to_string()));
}
```

`files[0]` 和 `files.get(0)` 的区别值得记住：前者假设下标合法，越界就是 bug；后者把越界当成正常情况，返回 `Option`。处理外部输入时用 `get`。

### HashMap 与 entry

```rust
use std::collections::HashMap;

fn main() {
    let mut bytes_by_book: HashMap<String, usize> = HashMap::new();
    bytes_by_book.insert("rust-practice".to_string(), 14_000);

    match bytes_by_book.get("rust-practice") {      // 查询可以直接用 &str
        Some(n) => println!("{n}"),
        None => println!("没有"),
    }

    // 计数的惯用写法：entry API
    let words = ["rust", "tauri", "rust", "wasm", "rust"];
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for w in words {
        *counts.entry(w).or_insert(0) += 1;
    }
    println!("{counts:?}");
}
```

`entry(key)` 返回这个键对应的「位置」，`or_insert(0)` 在键不存在时插入 0，然后返回值的可变引用，`*` 解引用后加一。TS 里对应的是：

```typescript
counts.set(w, (counts.get(w) ?? 0) + 1);
```

Rust 版本只查一次哈希表，TS 版本查两次。更重要的是，entry API 让「不存在就创建，存在就修改」成为一个原子的操作，不会因为中间插了别的代码而出错。

`HashMap` 的遍历顺序是随机的（每次运行都可能不同），需要稳定顺序时用 `BTreeMap`，或者收集成 `Vec` 后排序。这一点和 JS 的 `Map`（保持插入顺序）不同，从 JS 过来很容易踩。

### 字符串：UTF-8 的代价

Rust 的 `String` 是 UTF-8 字节序列，这带来几个和 JS 不同的行为：

```rust
fn main() {
    let s = "Rust 入门";
    println!("{}", s.len());              // 11：字节数（"Rust " 5 个 + 两个汉字各 3 个）
    println!("{}", s.chars().count());    // 7：字符数
    // let c = s[0];                      // 编译错误：字符串不能按下标取字符
    println!("{:?}", s.chars().nth(5));   // Some('入')
    println!("{}", &s[0..4]);             // "Rust"：按字节切片
    // println!("{}", &s[0..6]);          // 运行时 panic：6 落在「入」的中间
    println!("{:?}", s.get(0..6));        // None：安全版本
}
```

- `len()` 是字节数，不是字符数。要字符数用 `chars().count()`，这是 O(n) 的
- 不能用下标取字符，因为 UTF-8 下第 n 个字符的位置要从头数
- 字节切片 `&s[a..b]` 必须落在字符边界上，否则 panic；不确定时用 `s.get(a..b)` 返回 `Option`

JS 的字符串是 UTF-16，`"入".length` 是 1，但 emoji 的 `length` 是 2，也有类似的坑，只是不那么显眼。Rust 把问题摆在了明面上。

拼接字符串的几种写法：

```rust
fn main() {
    let id = "rust-practice";
    let a = format!("books/{id}/book.yaml");       // 最常用，相当于模板字符串
    let mut b = String::from("books/");
    b.push_str(id);                                // 追加
    b.push('/');
    let c = ["01", "02", "03"].join(",");          // 数组 join
    println!("{a} {b} {c}");
}
```

## 迭代器的三种形态

对一个 `Vec<String>` 遍历，有三种方式，区别在于**拿到的是什么**：

| 写法 | 元素类型 | 遍历后原集合 | 用途 |
|---|---|---|---|
| `v.iter()` / `for x in &v` | `&String` | 还在 | 只读，最常用 |
| `v.iter_mut()` / `for x in &mut v` | `&mut String` | 还在，已被修改 | 原地修改每个元素 |
| `v.into_iter()` / `for x in v` | `String` | 被消耗，不能再用 | 把元素移出来，转交给别处 |

```rust
fn main() {
    let mut tags = vec!["Rust".to_string(), "Tauri".to_string()];

    for t in &tags {                     // &String
        println!("{t}");
    }
    for t in &mut tags {                 // &mut String
        *t = t.to_lowercase();
    }
    let owned: Vec<String> = tags.into_iter().map(|t| format!("#{t}")).collect();
    // println!("{tags:?}");             // 编译错误：tags 已被 into_iter 消耗
    println!("{owned:?}");
}
```

上一章所有权的规则在这里直接体现：要么借着看，要么借着改，要么拿走。

## 惰性：没有 collect 就什么都不做

JS 的数组方法是**立即执行**的，每一步都生成一个新数组：

```typescript
const result = files.filter((f) => f.endsWith(".md")).map((f) => f.toUpperCase()).slice(0, 3);
// filter 遍历全部、生成数组；map 遍历全部、生成数组；slice 再生成一个
```

Rust 的迭代器适配器只是把操作「串起来」，直到遇到一个**消费者**（`collect`、`sum`、`count`、`for` 循环……）才开始一个元素一个元素地流过整条链：

```rust
fn main() {
    let files = vec!["01-a.md", "README", "02-b.md", "03-c.md", "04-d.md"];
    let result: Vec<String> = files
        .iter()
        .filter(|f| f.ends_with(".md"))
        .map(|f| f.to_uppercase())
        .take(3)                       // 拿够 3 个就停，后面的元素根本不会被处理
        .collect();
    println!("{result:?}");
}
```

没有中间数组，`take(3)` 之后不再处理剩下的元素。这和 JS 的生成器（`function*`）或者新的 Iterator Helpers 是同一个思路，只是在 Rust 里这是默认行为，并且编译器会把整条链优化成一个手写循环的速度，这叫**零成本抽象**。

忘了消费者时，编译器会提醒你：

```text
warning: unused `Map` that must be used
  = note: iterators are lazy and do nothing unless consumed
```

### 常用适配器和消费者

| Rust | JS | 说明 |
|---|---|---|
| `map(f)` | `map` | |
| `filter(f)` | `filter` | 闭包参数是 `&&T`（引用的引用），用 `\|f\|` 或 `\|&&f\|` 解构 |
| `filter_map(f)` | `flatMap` 返回 `[]` 或 `[x]` | `f` 返回 `Option`，`None` 被丢掉 |
| `flat_map(f)` | `flatMap` | |
| `enumerate()` | `map((x, i) => ...)` | 产出 `(下标, 元素)` |
| `zip(other)` | 无内置 | 两个迭代器并排走 |
| `take(n)` / `skip(n)` | `slice` | |
| `rev()` | `toReversed()` | |
| `chain(other)` | `concat` | |
| `collect()` | 无（JS 本来就是数组） | 收集成 `Vec`、`HashMap`、`String`…… |
| `sum()` / `count()` | `reduce` / `length` | |
| `fold(init, f)` | `reduce(f, init)` | |
| `any(f)` / `all(f)` | `some` / `every` | |
| `find(f)` / `position(f)` | `find` / `findIndex` | 返回 `Option` |
| `min_by_key(f)` / `max_by_key(f)` | 用 `reduce` 手写 | |

### collect 的魔法

`collect` 能收集成什么，由目标类型决定：

```rust
use std::collections::{BTreeSet, HashMap};

fn main() {
    let pairs = vec![("rust-practice", 10), ("electron-desktop", 8)];

    let map: HashMap<&str, i32> = pairs.iter().cloned().collect();
    let ids: BTreeSet<&str> = pairs.iter().map(|(id, _)| *id).collect();
    let line: String = ids.iter().map(|s| s.to_string()).collect::<Vec<_>>().join(", ");

    // Vec<Result<T, E>> 可以直接收集成 Result<Vec<T>, E>：遇到第一个错误就停
    let nums: Result<Vec<u32>, _> = ["1", "2", "x"].iter().map(|s| s.parse::<u32>()).collect();
    println!("{map:?} {line} {nums:?}");
}
```

最后一行特别有用：一组可能失败的操作，收集成「要么全部成功的列表，要么第一个错误」，相当于 `Promise.all` 的失败语义，而且是同步的。`collect::<Vec<_>>()` 里的 `::<>` 叫 turbofish，在没法从上下文推断目标类型时手动指定。

## 闭包

Rust 的闭包写法是 `|参数| 表达式`：

```rust
fn main() {
    let min_bytes = 12_000;
    let is_long = |bytes: usize| bytes >= min_bytes;   // 捕获了外部的 min_bytes
    println!("{}", is_long(14_000));

    let add = |a, b| a + b;                             // 类型可以推断
    println!("{}", add(1, 2));

    let summarize = |title: &str, n: usize| {           // 多行用花括号
        let unit = if n > 1 { "章" } else { "章（单章）" };
        format!("{title}：{n} {unit}")
    };
    println!("{}", summarize("Rust 实用入门", 10));
}
```

和 JS 闭包一样，它能捕获外部变量。不一样的是，**怎么捕获**受所有权规则约束，于是有了三个 trait。

### Fn、FnMut、FnOnce

| trait | 对捕获的变量做什么 | 能调用几次 | 例子 |
|---|---|---|---|
| `Fn` | 只读（借用 `&`） | 任意次 | 上面的 `is_long` |
| `FnMut` | 修改（借用 `&mut`） | 任意次，但调用时要独占 | 计数器 |
| `FnOnce` | 拿走所有权（移动） | 只能一次 | 把捕获的 `String` 交出去 |

```rust
fn main() {
    // FnMut：修改捕获的变量
    let mut seen = 0;
    let mut tick = || seen += 1;      // 闭包本身也要声明为 mut
    tick();
    tick();
    println!("{seen}");               // 2

    // FnOnce：把捕获的值移出去
    let title = String::from("Rust 实用入门");
    let take = move || title;         // 调用时把 title 交出去
    let t = take();
    // let t2 = take();               // 编译错误：FnOnce 只能调用一次
    println!("{t}");
}
```

编译器会根据闭包体自动判断它实现了哪个 trait。你需要关心的是**写接收闭包的函数时**选哪个约束：

- 接收方只调用一次：用 `FnOnce`，对调用者限制最少
- 接收方要多次调用，闭包可能改状态：用 `FnMut`
- 接收方要多次调用，可能并发调用：用 `Fn`

```rust
fn retry<T, E>(times: usize, mut op: impl FnMut() -> Result<T, E>) -> Result<T, E> {
    let mut last = op();
    for _ in 1..times {
        if last.is_ok() {
            break;
        }
        last = op();
    }
    last
}
```

### move 闭包

`move` 关键字强制闭包**拿走**所有捕获变量的所有权，而不是借用。它在单线程代码里不常用，但在开线程和 async 任务里必不可少，因为新线程可能比当前函数活得更久，不能借用当前函数的局部变量（上一章 `T: 'static` 的那条约束）：

```rust
use std::thread;

fn main() {
    let ids = vec!["rust-practice".to_string(), "electron-desktop".to_string()];
    let handle = thread::spawn(move || {      // ids 被移进新线程
        ids.len()
    });
    println!("{}", handle.join().unwrap());
}
```

去掉 `move` 会报错「closure may outlive the current function, but it borrows `ids`」。下一章会大量用到。

## 实现自己的迭代器

任何类型只要实现 `Iterator` trait 的一个方法 `next`，就能用上全部适配器：

```rust
/// 按 ```代码块``` 切分 Markdown：产出 (是否在代码块中, 行号, 行内容)
struct Lines<'a> {
    inner: std::iter::Enumerate<std::str::Lines<'a>>,
    in_fence: bool,
}

impl<'a> Lines<'a> {
    fn new(text: &'a str) -> Self {
        Lines { inner: text.lines().enumerate(), in_fence: false }
    }
}

impl<'a> Iterator for Lines<'a> {
    type Item = (bool, usize, &'a str);

    fn next(&mut self) -> Option<Self::Item> {
        let (i, line) = self.inner.next()?;
        let is_fence = line.trim_start().starts_with("```");
        let in_code = self.in_fence || is_fence;
        if is_fence {
            self.in_fence = !self.in_fence;
        }
        Some((in_code, i + 1, line))
    }
}

fn main() {
    let md = "# 标题\n```rust\n# 不是标题\n```\n## 小节";
    let h1 = Lines::new(md)
        .filter(|(in_code, _, line)| !in_code && line.starts_with("# "))
        .count();
    println!("H1：{h1}");   // 1
}
```

这个迭代器第 8 章会直接用到：所有「跳过代码块」的检查规则都基于它，只写一次。和 TS 实现 `[Symbol.iterator]` 相比，你只写了 `next`，`filter`、`count` 等几十个方法都是 trait 的默认实现免费送的。

## 案例：按分类列出全部书

书巢的 `pnpm shelf-pack ls` 按分类列出全部书。用 Rust 实现核心逻辑：给定一组书的元信息，按 `category` 的第一段分组，组内按 id 排序，没有分类的归入「未分类」。

```rust
use std::collections::BTreeMap;

#[derive(Debug)]
struct BookInfo {
    id: String,
    title: String,
    category: Option<String>,
    chapters: usize,
}

fn group_by_shelf(books: &[BookInfo]) -> BTreeMap<&str, Vec<&BookInfo>> {
    let mut groups: BTreeMap<&str, Vec<&BookInfo>> = BTreeMap::new();
    for b in books {
        let shelf = b
            .category
            .as_deref()                        // Option<String> -> Option<&str>
            .and_then(|c| c.split('/').next())
            .unwrap_or("未分类");
        groups.entry(shelf).or_default().push(b);
    }
    for list in groups.values_mut() {
        list.sort_by(|a, b| a.id.cmp(&b.id));
    }
    groups
}

fn main() {
    let books = vec![
        BookInfo { id: "rust-practice".into(), title: "Rust 实用入门".into(), category: Some("技术/Rust".into()), chapters: 10 },
        BookInfo { id: "electron-desktop".into(), title: "Electron 桌面应用".into(), category: Some("技术/桌面".into()), chapters: 8 },
        BookInfo { id: "reading-map".into(), title: "书架导读".into(), category: Some("导读".into()), chapters: 8 },
        BookInfo { id: "scratch".into(), title: "草稿".into(), category: None, chapters: 1 },
    ];

    for (shelf, list) in group_by_shelf(&books) {
        let total: usize = list.iter().map(|b| b.chapters).sum();
        println!("{shelf}（{} 本，{total} 章）", list.len());
        for b in list {
            println!("  {:<20} {}", b.id, b.title);
        }
    }

    let longest = books.iter().max_by_key(|b| b.chapters).map(|b| b.title.as_str());
    println!("章节最多：{}", longest.unwrap_or("无"));
}
```

几个值得注意的地方：

- 返回值 `BTreeMap<&str, Vec<&BookInfo>>` 里全是引用，指向传入的 `books`，没有复制任何字符串。按省略规则，这些引用的生命周期跟随唯一的输入参数，不用标注
- `as_deref()` 把 `Option<String>` 变成 `Option<&str>`，这是处理可选字符串字段时最常用的一个方法
- `or_default()` 是 `or_insert(Vec::new())` 的简写，要求值类型实现 `Default`
- `BTreeMap` 让分类按名字有序输出；如果用 `HashMap`，每次运行顺序都可能不同
- `{:<20}` 是格式说明：左对齐、宽度 20。中文字符在终端里占两列，用这种方式对齐中文会不齐，正式工具里可以用 `unicode-width` crate 计算显示宽度

## 本章要点

- `Vec`、`HashMap`、`BTreeMap`、`HashSet` 覆盖了日常需求；需要稳定顺序时用 `BTree*`
- `entry(k).or_insert(v)` / `or_default()` 是「不存在就创建，存在就修改」的惯用写法
- `String` 是 UTF-8：`len()` 是字节数，不能下标取字符，切片要落在字符边界上
- `iter()` / `iter_mut()` / `into_iter()` 分别借着看、借着改、拿走
- 迭代器是惰性的，遇到消费者才执行，编译后和手写循环一样快
- `collect()` 的目标类型决定结果；`Result` 的迭代器可以收集成 `Result<Vec<T>, E>`
- 闭包按捕获方式实现 `Fn` / `FnMut` / `FnOnce`；跨线程时用 `move` 把所有权交给闭包
- 实现 `next` 一个方法，就得到全部迭代器适配器

## 动手练习

1. **切到汉字中间**：把[字符串：UTF-8 的代价](#字符串utf-8-的代价)一节的程序跑一遍，记下 `len()` 和 `chars().count()` 的值；然后取消 `&s[0..6]` 那一行的注释，预测是编译错误还是运行时错误。

   验证：原程序前两行输出 `11` 和 `7`。取消注释后 `cargo build` 能通过，`cargo run` 时 panic，信息以 `byte index 6 is not a char boundary` 开头，并指出它落在 `'入'` 里面。`s.get(0..6)` 那一行则安全地打印 `None`。

   参考答案：切片范围是运行时的值，编译器无法检查是否落在字符边界上，只能在运行时 panic。处理外部输入时用 `get` 拿到 `Option`。

2. **看清惰性求值的顺序**：在本章「惰性」一节的例子上加两处打印，预测输出的每一行：

   ```rust
   let files = vec!["01-a.md", "README", "02-b.md", "03-c.md"];
   let result: Vec<String> = files
       .iter()
       .inspect(|f| println!("看 {f}"))
       .filter(|f| f.ends_with(".md"))
       .map(|f| { println!("转 {f}"); f.to_uppercase() })
       .take(2)
       .collect();
   println!("{result:?}");
   ```

   验证：依次输出 `看 01-a.md`、`转 01-a.md`、`看 README`、`看 02-b.md`、`转 02-b.md`，最后是 `["01-A.MD", "02-B.MD"]`；`03-c.md` 从未出现。再把 `.collect()` 删掉（连同 `let result` 和最后一行），会看到 `unused` 警告，而且什么都不打印。

   参考答案：元素一个一个流过整条链，而不是每一步处理完整个数组；`take(2)` 拿够之后不再向上游要元素。没有消费者时整条链不会执行。

3. **去掉 move**：把「move 闭包」一节的 `thread::spawn(move || ...)` 里的 `move` 删掉，预测 `cargo check` 的结果。

   验证：报 `error[E0373]`，说闭包可能比当前函数活得更久，却借用了 `ids`，并建议加上 `move`。

   参考答案：`thread::spawn` 要求闭包是 `'static` 的，新线程可能在 `main` 的局部变量释放后还在跑，所以不能借用，只能拿走所有权。
