# 生命周期

上一章的借用规则里还剩一条没展开：**引用不能比它指向的值活得更久**。生命周期（lifetime）就是编译器用来检查这一条的工具。它的语法 `'a` 看起来很吓人，但概念很朴素：大多数时候编译器能自己推断，你只需要在少数几种情况下帮它标一下「这个返回的引用来自哪个参数」。

这一章先讲生命周期要防止的问题，再讲什么时候需要标注、怎么标，最后用一个「零拷贝解析 Markdown 标题」的例子把它用起来，并给出一条实用建议：什么时候干脆别用引用。

## 要防止的问题：悬垂引用

```rust
fn main() {
    let r;
    {
        let title = String::from("Rust 实用入门");
        r = &title;
    }   // title 在这里被释放
    println!("{r}");   // r 指向已经释放的内存
}
```

```text
error[E0597]: `title` does not live long enough
  |
4 |         let title = String::from("Rust 实用入门");
  |             ----- binding `title` declared here
5 |         r = &title;
  |             ^^^^^^ borrowed value does not live long enough
6 |     }
  |     - `title` dropped here while still borrowed
7 |     println!("{r}");
  |               --- borrow later used here
```

在 JS 里这不是问题：只要 `r` 还引用着那个字符串，GC 就不会回收它。Rust 没有 GC，`title` 离开作用域就释放，所以编译器必须证明：**每个引用被使用时，它指向的值还活着**。

在一个函数内部，编译器能看到所有变量的作用域，自己就能检查。难的是跨函数的情况。

## 什么时候需要标注

看这个函数：返回两个字符串里较长的那个。

```rust
fn longer(a: &str, b: &str) -> &str {
    if a.len() >= b.len() { a } else { b }
}
```

```text
error[E0106]: missing lifetime specifier
  |
1 | fn longer(a: &str, b: &str) -> &str {
  |              ----     ----     ^ expected named lifetime parameter
  |
  = help: this function's return type contains a borrowed value, but the signature does not say whether it is borrowed from `a` or `b`
```

报错说得很清楚：返回值是一个引用，但签名没说它借自 `a` 还是 `b`。编译器检查调用方时**只看签名，不看函数体**（这样改函数体不会让别处的代码突然编译不过）。所以签名里必须写明这层关系：

```rust
fn longer<'a>(a: &'a str, b: &'a str) -> &'a str {
    if a.len() >= b.len() { a } else { b }
}
```

`'a` 是一个**生命周期参数**，写法和泛型参数放在一起。这个签名的意思是：返回的引用至少在 `a` 和 `b` 都有效的那段时间内有效。换句话说，返回值的有效期取两者中较短的那个。

调用方就可以据此检查：

```rust
fn main() {
    let a = String::from("所有权与借用");
    let result;
    {
        let b = String::from("生命周期");
        result = longer(&a, &b);
        println!("{result}");   // 可以：a 和 b 都还活着
    }
    // println!("{result}");    // 不行：b 已经释放，result 可能指向它
}
```

**生命周期标注不改变任何值活多久**，它只是描述引用之间的关系，让编译器能在调用处做检查。这有点像 TS 的泛型：`function first<T>(xs: T[]): T` 不改变任何值的类型，只是告诉编译器「返回值的类型和参数元素的类型相同」。

如果返回值只和一个参数有关，就只标那一个：

```rust
fn first_line<'a>(text: &'a str, _hint: &str) -> &'a str {
    text.lines().next().unwrap_or("")
}
```

## 省略规则：为什么大多数时候不用写

上一章写了很多带引用的函数，都没标生命周期。因为编译器有三条**省略规则**（lifetime elision），能覆盖大多数情况：

1. 每个引用参数各自得到一个生命周期参数
2. 如果只有**一个**输入引用，输出引用的生命周期就和它相同
3. 如果是方法，参数里有 `&self` 或 `&mut self`，输出引用的生命周期就和 `self` 相同

```rust
fn trim_heading(line: &str) -> &str {           // 规则 2：只有一个输入，不用标
    line.trim_start_matches('#').trim()
}

struct Book {
    title: String,
}

impl Book {
    fn title(&self) -> &str {                   // 规则 3：跟随 self，不用标
        &self.title
    }
}
```

只有当规则推不出来时（比如有两个输入引用、返回一个引用，又不是方法），才需要手写。实际写应用代码时，你需要手写生命周期的地方很少。

## 结构体里放引用

结构体字段是引用时，必须标生命周期，表示「这个结构体不能比它借用的数据活得更久」：

```rust
struct Heading<'a> {
    level: u8,
    text: &'a str,
}
```

这正是**零拷贝解析**的基础：解析结果直接指向原始文本，不复制任何字符串。下面用书巢的场景写一个例子：从一章 Markdown 里提取所有 H1–H3 标题，跳过代码块里的 `#`。这正是阅读器生成目录、`shelf-pack check` 检查「唯一 H1」时要做的事。

```rust
#[derive(Debug)]
struct Heading<'a> {
    level: u8,
    text: &'a str,
}

fn headings(markdown: &str) -> Vec<Heading<'_>> {
    let mut out = Vec::new();
    let mut in_fence = false;
    for line in markdown.lines() {
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let level = line.chars().take_while(|&c| c == '#').count();
        if (1..=3).contains(&level) && line[level..].starts_with(' ') {
            out.push(Heading { level: level as u8, text: line[level..].trim() });
        }
    }
    out
}

fn main() {
    let chapter = std::fs::read_to_string("03-lifetimes.md").expect("读取失败");
    let hs = headings(&chapter);
    let h1_count = hs.iter().filter(|h| h.level == 1).count();
    println!("H1 数量：{h1_count}");
    for h in &hs {
        println!("{}{}", "  ".repeat(h.level as usize - 1), h.text);
    }
}
```

几点说明：

- `Vec<Heading<'_>>` 里的 `'_` 是「省略的生命周期」，按规则 2 跟随唯一的输入 `markdown`。写成 `fn headings<'a>(markdown: &'a str) -> Vec<Heading<'a>>` 效果相同
- `line[level..]` 按**字节**切片。这里能安全切，是因为前 `level` 个字符都是单字节的 `#`；如果在一个中文字符中间切，程序会 panic，第 6 章讲字符串时细说
- `hs` 里的每个 `text` 都指向 `chapter` 里的字节。只要 `hs` 还在用，`chapter` 就不能被释放或修改，编译器会替你守住这一点

如果你试图在 `chapter` 释放后继续用 `hs`：

```rust
fn load_headings(path: &str) -> Vec<Heading<'static>> {
    let chapter = std::fs::read_to_string(path).unwrap();
    headings(&chapter)   // 编译错误：返回了指向局部变量的引用
}
```

编译器会拒绝，因为 `chapter` 在函数结束时就释放了。这类 bug 在 C 里很常见，在 Rust 里不可能写出来。

## 'static：活到程序结束

`'static` 是一个特殊的生命周期，表示「在整个程序运行期间都有效」。字符串字面量就是 `&'static str`，因为它们编译在二进制文件里：

```rust
const DEFAULT_CATEGORY: &str = "未分类";      // 常量的引用默认是 'static

fn level_label(level: u8) -> &'static str {
    match level {
        1 => "beginner",
        2 => "intermediate",
        _ => "advanced",
    }
}
```

你会在两种地方经常见到 `'static`：

- **返回字面量的函数**，像上面的 `level_label`
- **类型约束 `T: 'static`**，最常见于 `std::thread::spawn` 和 `tokio::spawn`。它的意思不是「T 必须活到程序结束」，而是「T 不包含任何非 `'static` 的引用」，也就是说 T 要么拥有自己的全部数据，要么只借用全局数据。原因是新线程可能比当前函数活得更久，不能让它借用当前函数的局部变量。第 7 章会反复遇到这个约束，解决办法通常是 `move` 闭包加上拥有所有权的数据

> [!TIP]
> 编译器提示「consider adding `'static`」时，先别照做。给引用加上 `'static` 往往只是把问题推到调用处。大多数情况下，正确的改法是**让数据被拥有**（`String` 代替 `&str`），或者用 `Arc` 共享。

## 实用建议：先用拥有所有权的类型

生命周期是 Rust 里最需要经验的部分。对一个刚上手的 TS 开发者，下面这条规则能省掉大部分麻烦：

| 场景 | 建议 |
|---|---|
| 函数参数 | 用引用 `&str`、`&[T]`、`&T`，几乎不用标生命周期 |
| 函数返回值 | 返回拥有所有权的类型（`String`、`Vec<T>`），除非明显是从参数里取一部分 |
| 结构体字段 | 用 `String`、`Vec<T>`；只有在性能敏感的解析器里才放引用 |
| 需要在多处共享 | `Rc<T>`（单线程）或 `Arc<T>`（多线程），不要硬用引用 |
| 生命周期报错改了三次还不过 | 改成拥有所有权，加一次 `clone()` |

多一次字符串复制的成本，在绝大多数程序里不可测量；而和生命周期较劲花掉的一个下午，是实打实的成本。上面的 `Heading<'a>` 是一个合理使用引用的例子：解析器一次处理整本书，标题很多，原文又一直在内存里；如果只是解析一个 `book.yaml`，直接用 `String` 就好。

把 `Heading` 改成拥有所有权的版本，只需要在构造时调用 `to_string()`：

```rust
#[derive(Debug, Clone)]
struct OwnedHeading {
    level: u8,
    text: String,
}

fn to_owned_headings(markdown: &str) -> Vec<OwnedHeading> {
    headings(markdown)
        .into_iter()
        .map(|h| OwnedHeading { level: h.level, text: h.text.to_string() })
        .collect()
}
```

现在返回值和输入文本没有关系了，可以随意存放、跨线程传递。

## 案例：按书巢的规则生成锚点

书巢的写书规范规定了小节锚点的生成方式：标题文字转小写、空格换成 `-`、去掉标点。这是一个典型的「输入一个 `&str`，输出一个新 `String`」的函数，返回值必须是新分配的字符串，因为内容变了：

```rust
fn slug(heading: &str) -> String {
    heading
        .trim()
        .to_lowercase()
        .chars()
        .filter_map(|c| {
            if c == ' ' {
                Some('-')
            } else if c.is_alphanumeric() || c == '-' || c == '_' {
                Some(c)
            } else {
                None   // 去掉标点，包括中文标点
            }
        })
        .collect()
}

fn main() {
    println!("{}", slug("Stream 与背压"));          // stream-与背压
    println!("{}", slug("'static：活到程序结束"));    // static活到程序结束
}
```

`char::is_alphanumeric` 对汉字返回 `true`，所以中文保留；中文冒号、引号这类标点被去掉。它和书巢 TS 实现的细节是否完全一致，要用同一批标题对照测试，这正是第 8 章写测试时要做的事。

注意这里不需要任何生命周期标注：输入是引用，输出是拥有所有权的 `String`，两者之间没有借用关系。

## 本章要点

- 生命周期防止悬垂引用：引用被使用时，它指向的值必须还活着
- 标注不改变值活多久，只描述引用之间的关系，让编译器在调用处检查
- 三条省略规则覆盖了大多数函数：单个输入引用、或方法里的 `&self`，返回引用都不用标
- 结构体里放引用要标 `'a`，适合零拷贝解析这类性能敏感的场景
- `'static` 表示活到程序结束；`T: 'static` 约束表示 T 不借用局部数据，常见于 spawn
- 先用拥有所有权的类型，生命周期报错改不动时加一次 `clone()`，不丢人

## 动手练习

1. **把 println 移出内层作用域**：用本章 `longer` 的调用示例，把内层作用域里的 `println!("{result}");` 删掉，打开外面那行被注释的 `println!`，预测 `cargo check` 的结果。

   验证：报 `` error[E0597]: `b` does not live long enough ``，并标出 `b` 在内层 `}` 处被释放、`result` 在外面又被使用。

   参考答案：签名 `fn longer<'a>(a: &'a str, b: &'a str) -> &'a str` 告诉编译器返回值可能借自 `b`，所以 `result` 的有效期不能超过 `b`。编译器只看签名，即使这次运行实际返回的是更长的 `a` 也一样。

2. **只和一个参数有关时**：写一个函数，返回值只来自第一个参数，先不写生命周期：

   ```rust
   fn pick(a: &str, _b: &str) -> &str {
       a
   }

   fn main() {
       let a = String::from("所有权与借用");
       let r;
       {
           let b = String::from("生命周期");
           r = pick(&a, &b);
       }
       println!("{r}");
   }
   ```

   先预测错误码，再改成 `fn pick<'a>(a: &'a str, _b: &str) -> &'a str`，预测 `main` 能否通过。

   验证：第一次报 `error[E0106]: missing lifetime specifier`；改完后编译通过，打印 `所有权与借用`。

   参考答案：两个输入引用时省略规则推不出输出跟谁走。只把 `'a` 标在 `a` 上，等于声明返回值和 `b` 无关，`b` 先释放也不影响 `r`。和练习 1 对照，可以看出标注描述的是关系，标得越准，调用方越自由。

3. **返回指向局部变量的引用**：把本章 `headings` 和 `Heading` 拷进项目，再加上「结构体里放引用」一节末尾的 `load_headings`，`cargo check`。然后改成返回 `Vec<OwnedHeading>`（用本章的 `to_owned_headings`）。

   验证：第一次报 `` error[E0515]: cannot return value referencing local variable `chapter` ``；改成拥有所有权的版本后通过。

   参考答案：`chapter` 在函数结束时释放，`Heading` 里的 `text` 都指向它。写成 `'static` 也救不了，正确的改法是让返回值拥有自己的数据。
