# 结构体、接口与泛型

TS 的类型系统是为了给 JavaScript 这门动态语言补上类型而设计的，所以它极其灵活：联合类型、条件类型、映射类型、模板字面量类型，几乎什么都能表达。Go 的类型系统走的是另一条路：**能表达的东西少，但每样都直接对应运行时的内存布局和行为**。

这一章把 TS 里最常用的几样东西（`interface`、`class`、泛型、枚举、`zod` schema）逐一对应到 Go，看看在表达力少得多的类型系统里，日常代码怎么写。

## 结构体

```typescript
interface Book {
  id: string;
  title: string;
  tags: string[];
  level?: "beginner" | "intermediate" | "advanced";
}
const b: Book = { id: "go-practice", title: "Go 语言实战", tags: [] };
```

```go
package main

import "fmt"

type Book struct {
	ID    string
	Title string
	Tags  []string
	Level string // 没有可选字段，空串就是「没填」
}

func main() {
	b := Book{ID: "go-practice", Title: "Go 语言实战"} // 没写的字段是零值
	b.Tags = append(b.Tags, "go")                  // nil 切片可以直接 append
	fmt.Printf("%+v\n", b)

	p := &Book{ID: "rust"} // 取结构体字面量的地址很常见
	p.Title = "Rust"
	fmt.Println(p.Title)

	// 一次性的匿名结构体，测试用例表里很常用
	pt := struct{ X, Y int }{1, 2}
	fmt.Println(pt.X + pt.Y)
}
```

Go 的结构体是**名义类型**：两个字段完全一样的结构体，只要名字不同就是不同类型，不能互相赋值（可以显式转换）。这和 TS 的结构化类型不同。

没有可选字段，零值承担了「没填」的意思。如果确实需要区分「没填」和「填了零值」（比如 PATCH 接口里「不改」和「改成 0」），用指针 `*int`，`nil` 表示没填。

### 结构体 tag 与 JSON

```go
package main

import (
	"encoding/json"
	"fmt"
	"time"
)

type Entry struct {
	ID        int64     `json:"id"`
	AmountFen int64     `json:"amountFen"`
	Note      string    `json:"note,omitempty"`     // 空串时不输出
	CreatedAt time.Time `json:"createdAt,omitzero"` // 零值时间不输出，1.24 起
	secret    string    // 小写，不导出，JSON 看不见
}

func main() {
	e := Entry{ID: 1, AmountFen: 1250, secret: "x"}
	data, _ := json.Marshal(e)
	fmt.Println(string(data)) // {"id":1,"amountFen":1250}

	var in Entry
	err := json.Unmarshal([]byte(`{"id": 2, "amountFen": "12"}`), &in)
	fmt.Println(err) // json: cannot unmarshal string into Go struct field Entry.amountFen of type int64
}
```

反引号里的 `json:"..."` 是**结构体 tag**，给反射用的元数据，`encoding/json`、数据库库、YAML 库都读它。

`json.Unmarshal` 会做类型检查（字符串塞不进 `int64`），但**不做业务校验**：缺了字段就是零值，不会报错。zod 的 `.min(1)`、`.regex()` 这些在 Go 里要自己写一个 `Validate()` 方法，后面的[案例](#案例bookyaml-的校验)会写一个。

## 方法

Go 没有 class，方法是挂在类型上的函数，接收者写在函数名前面：

```go
package main

import "fmt"

type Counter struct {
	name  string
	value int
}

// NewCounter 是构造函数的惯例写法：一个普通函数，名字以 New 开头
func NewCounter(name string) *Counter {
	return &Counter{name: name}
}

// 指针接收者：要修改 c，或者结构体较大
func (c *Counter) Inc() { c.value++ }

// 值接收者：只读，拿到的是副本
func (c Counter) String() string { return fmt.Sprintf("%s=%d", c.name, c.value) }

func main() {
	c := NewCounter("books")
	c.Inc()
	c.Inc()
	fmt.Println(c) // books=2，fmt 发现它实现了 String() 就会调用
}
```

接收者选值还是指针，一条实用规则：**只要有一个方法需要指针接收者，这个类型的所有方法都用指针接收者**。混用会让「这个类型的值能不能满足某个接口」变得难以判断。

方法可以挂在任何**本包定义的**类型上，不限于结构体：

```go
type Level string

func (l Level) Valid() bool {
	return l == "beginner" || l == "intermediate" || l == "advanced"
}
```

## 嵌入：组合代替继承

```go
package main

import (
	"fmt"
	"sync"
)

type Timestamps struct {
	CreatedAt string
	UpdatedAt string
}

func (t *Timestamps) Touch(now string) { t.UpdatedAt = now }

type Store struct {
	Timestamps // 嵌入：字段和方法被「提升」到 Store 上
	Name       string
}

// 嵌入 sync.Mutex 是常见写法，但会把 Lock/Unlock 暴露给外部
type SafeCount struct {
	mu sync.Mutex // 更推荐写成具名的小写字段
	n  int
}

func (s *SafeCount) Add() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.n++
}

func main() {
	s := Store{Name: "旗舰店"}
	s.Touch("2026-11-04") // 直接调用嵌入类型的方法
	fmt.Println(s.UpdatedAt, s.Timestamps.UpdatedAt)

	var c SafeCount
	c.Add()
	fmt.Println(c.n)
}
```

嵌入不是继承：`Store` 不是 `Timestamps` 的子类，不能把 `Store` 传给要 `Timestamps` 的函数；被提升的方法里 `t` 仍然是 `Timestamps`，不知道外面还包着一个 `Store`。没有 `super`，没有方法覆盖的多态。需要多态，用接口。

## 接口

这是 Go 和 TS 最像的地方：**接口是结构化的，隐式实现**。一个类型只要有接口要求的全部方法，就自动满足这个接口，不需要写 `implements`。

```go
package main

import (
	"fmt"
	"os"
	"strings"
)

type Notifier interface {
	Notify(msg string) error
}

type ConsoleNotifier struct{ prefix string }

func (c ConsoleNotifier) Notify(msg string) error {
	_, err := fmt.Fprintln(os.Stdout, c.prefix+msg)
	return err
}

type MemoryNotifier struct{ sent []string }

func (m *MemoryNotifier) Notify(msg string) error {
	m.sent = append(m.sent, msg)
	return nil
}

func remindAll(n Notifier, stores []string) error {
	for _, s := range stores {
		if err := n.Notify(s + " 今天还没记账"); err != nil {
			return err
		}
	}
	return nil
}

func main() {
	_ = remindAll(ConsoleNotifier{prefix: "[提醒] "}, []string{"旗舰店"})

	mem := &MemoryNotifier{} // 注意是指针：Notify 的接收者是 *MemoryNotifier
	_ = remindAll(mem, []string{"a", "b"})
	fmt.Println(strings.Join(mem.sent, " / "))
}
```

### 接口要小，定义在使用方

标准库里最重要的几个接口都只有一个方法：

| 接口 | 方法 | 谁实现了它 |
|---|---|---|
| `io.Reader` | `Read(p []byte) (n int, err error)` | 文件、网络连接、HTTP 请求体、`strings.Reader`、gzip 解压流 |
| `io.Writer` | `Write(p []byte) (n int, err error)` | 文件、`os.Stdout`、HTTP 响应、`bytes.Buffer`、哈希 |
| `fmt.Stringer` | `String() string` | 任何想自定义打印格式的类型 |
| `error` | `Error() string` | 所有错误 |

因为接口小，组合起来威力很大：一个接受 `io.Reader` 的函数，能读文件、读网络、读内存、读解压后的数据，不用改一行代码。这相当于 Node 的 Stream，但接口简单得多。

Go 社区有一句老话：**接受接口，返回结构体**。另一条配套的习惯是：**接口定义在使用它的包里**，而不是实现它的包里。第 7 章的 HTTP handler 需要存储层，就在 handler 所在的包里定义一个只有两个方法的 `Store` 接口；Postgres 实现和测试用的内存实现各自满足它，彼此不知道对方存在。

这和 NestJS 里「先定义一个 `abstract class` 作为注入令牌，再写实现」的顺序正好反过来。

### 类型断言与类型开关

接口变量里装的具体类型可以在运行时取出来：

```go
package main

import "fmt"

func describe(v any) string { // any 是 interface{} 的别名，相当于 TS 的 unknown
	switch x := v.(type) {
	case nil:
		return "nil"
	case int:
		return fmt.Sprintf("整数 %d", x)
	case string:
		return fmt.Sprintf("字符串 %q", x)
	case fmt.Stringer:
		return "Stringer: " + x.String()
	default:
		return fmt.Sprintf("其他类型 %T", x)
	}
}

func main() {
	fmt.Println(describe(42), describe("hi"), describe(3.14), describe(nil))

	var v any = "hello"
	s, ok := v.(string) // 单个类型断言，带 ok 不会 panic
	fmt.Println(s, ok)
	_, ok = v.(int)
	fmt.Println(ok) // false
}
```

TS 的可辨识联合（`type Msg = { kind: "a" } | { kind: "b" }`）在 Go 里没有直接对应。常见替代是定义一个接口，各个变体类型实现它，再用类型开关分发；编译器不会检查分支是否穷尽，可以用 golangci-lint 的 `exhaustive` 之类的 linter 补上。

### nil 接口的坑

接口值由两部分组成：**动态类型**和**动态值**。只有两者都为空时，接口才等于 `nil`：

```go
package main

import "fmt"

type MyErr struct{}

func (*MyErr) Error() string { return "my error" }

func find(ok bool) error {
	var e *MyErr // 类型是 *MyErr，值是 nil
	if !ok {
		e = &MyErr{}
	}
	return e // 错误写法：即使 e 是 nil 指针，返回的 error 也不等于 nil
}

func main() {
	err := find(true)
	fmt.Println(err == nil) // false！
}
```

规则：**返回 `error` 的函数，成功时直接 `return nil`**，不要返回一个值为 nil 的具体类型指针。

## 用常量和 iota 写枚举

```go
package main

import "fmt"

type Status int

const (
	Queued  Status = iota // 0，iota 在每个 const 块里从 0 开始自增
	Running               // 1
	Done                  // 2
	Failed                // 3
)

func (s Status) String() string {
	switch s {
	case Queued:
		return "queued"
	case Running:
		return "running"
	case Done:
		return "done"
	case Failed:
		return "failed"
	}
	return fmt.Sprintf("Status(%d)", int(s))
}

func main() {
	s := Running
	fmt.Println(s, Status(7)) // running Status(7)
}
```

Go 的枚举只是「有名字的常量」，`Status(7)` 照样能编译，不像 TS 的字面量联合那样被编译器拦住。需要和外部交互的枚举（JSON、数据库），直接用字符串常量往往更省事：`type Level string` 加几个 `const`，再写一个 `Valid()` 方法。

## 函数式选项：代替可选参数

Go 没有默认参数，也没有可选参数。构造一个有很多可选配置的东西时，常见两种写法：传一个配置结构体（零值即默认），或者用**函数式选项**：

```go
package main

import (
	"fmt"
	"time"
)

type Client struct {
	baseURL string
	timeout time.Duration
	retries int
}

type Option func(*Client)

func WithTimeout(d time.Duration) Option { return func(c *Client) { c.timeout = d } }
func WithRetries(n int) Option           { return func(c *Client) { c.retries = n } }

func NewClient(baseURL string, opts ...Option) *Client {
	c := &Client{baseURL: baseURL, timeout: 10 * time.Second, retries: 2} // 默认值
	for _, opt := range opts {
		opt(c)
	}
	return c
}

func main() {
	c := NewClient("http://192.168.1.8:8787", WithTimeout(3*time.Second))
	fmt.Printf("%+v\n", *c)
}
```

选项少的时候用配置结构体就好，别为了显得地道而上函数式选项。

## 泛型

Go 1.18 加入了泛型。它能做的事比 TS 少很多，但覆盖了最常见的需求：写一次，适用于多种元素类型的函数和容器。

```typescript
function map<T, U>(xs: T[], f: (x: T) => U): U[] {
  return xs.map(f);
}
function maxOf<T extends number | string>(xs: T[]): T { /* ... */ }
```

```go
package main

import (
	"cmp"
	"fmt"
	"strings"
)

// 类型参数写在方括号里，any 表示没有约束
func Map[T, U any](xs []T, f func(T) U) []U {
	out := make([]U, 0, len(xs))
	for _, x := range xs {
		out = append(out, f(x))
	}
	return out
}

func Filter[T any](xs []T, keep func(T) bool) []T {
	var out []T
	for _, x := range xs {
		if keep(x) {
			out = append(out, x)
		}
	}
	return out
}

// cmp.Ordered 约束：支持 < > 的类型（整数、浮点、字符串）
func MaxOf[T cmp.Ordered](xs []T) (T, bool) {
	var zero T
	if len(xs) == 0 {
		return zero, false
	}
	m := xs[0]
	for _, x := range xs[1:] {
		m = max(m, x) // 内置 max，1.21 起
	}
	return m, true
}

// 自定义约束：~int 表示「底层类型是 int 的所有类型」，包括 type Status int
type Number interface {
	~int | ~int64 | ~float64
}

func Sum[T Number](xs []T) T {
	var s T
	for _, x := range xs {
		s += x
	}
	return s
}

// 泛型类型：一个集合
type Set[T comparable] struct{ m map[T]struct{} }

func NewSet[T comparable](items ...T) *Set[T] {
	s := &Set[T]{m: make(map[T]struct{})}
	for _, it := range items {
		s.m[it] = struct{}{}
	}
	return s
}

func (s *Set[T]) Has(v T) bool { _, ok := s.m[v]; return ok }

func main() {
	ids := []string{"go-practice", "rust-practice", "python-for-ai"}
	upper := Map(ids, strings.ToUpper) // 类型参数自动推断
	short := Filter(ids, func(s string) bool { return len(s) < 13 })
	m, _ := MaxOf([]int{3, 9, 4})
	fmt.Println(upper, short, m, Sum([]float64{1.5, 2.5}))

	set := NewSet(ids...)
	fmt.Println(set.Has("go-practice"), set.Has("java"))
}
```

和 TS 比，Go 泛型的限制：

| TS 能做 | Go |
|---|---|
| 条件类型、映射类型、`infer` | 没有，类型参数只能被约束、不能被计算 |
| 方法自带类型参数 `map<U>(f)` | 1.26 及以前不行，方法只能用类型声明上的类型参数；**1.27 起可以**，但接口里的方法仍不能带类型参数，泛型方法也不能用来实现接口（见[第 1 章](01-ts-to-go.md#go-127-带来了什么)） |
| 联合类型作为普通值的类型 | 不行，`int \| string` 只能出现在约束里 |
| 约束里访问字段 | 不行，约束只能约束方法和底层类型 |

实际写下来，Go 代码里需要自己写泛型的地方很少：标准库的 `slices`、`maps`、`cmp`、`sync`（`sync.Map` 之外）已经覆盖了大部分容器操作。**先写具体类型，出现第三份几乎一样的代码时再考虑泛型**，这是 Go 团队自己的建议。

## 迭代器：range over func

> [!WARNING]
> 用 `for range` 遍历函数（range over func）和 `iter` 包从 Go 1.23 开始提供；`slices.Collect`、`maps.Keys` 等返回迭代器的函数也是 1.23 加入的。以 [go.dev/doc/go1.23](https://go.dev/doc/go1.23) 和 `iter` 包文档为准。

TS 的生成器函数 `function*` 在 Go 里对应 `iter.Seq`：一个接受 `yield` 回调的函数。`for range` 可以直接遍历它：

```go
package main

import (
	"bufio"
	"fmt"
	"iter"
	"maps"
	"slices"
	"strings"
)

// Headings 逐个产出 Markdown 里的标题行，相当于 function* headings(md) { yield ... }
func Headings(md string) iter.Seq2[int, string] {
	return func(yield func(int, string) bool) {
		sc := bufio.NewScanner(strings.NewReader(md))
		no := 0
		for sc.Scan() {
			no++
			if line := sc.Text(); strings.HasPrefix(line, "#") {
				if !yield(no, line) { // 调用方 break 时 yield 返回 false，必须停下
					return
				}
			}
		}
	}
}

func main() {
	md := "# 第一章\n正文\n## 小节\n更多正文\n## 另一个小节\n"
	for no, h := range Headings(md) {
		fmt.Println(no, h)
		if no > 2 {
			break
		}
	}

	ages := map[string]int{"b": 2, "a": 1, "c": 3}
	keys := slices.Sorted(maps.Keys(ages)) // 迭代器 → 排好序的切片
	fmt.Println(keys)
}
```

迭代器的好处是惰性：遍历到一半 `break`，后面的行就不会再扫描。日常代码里你更多是**使用**返回迭代器的标准库函数（`maps.Keys`、`strings.Lines`、`slices.Values`），而不是自己写。

## 案例：book.yaml 的校验

hatch-shelf 用 zod 定义 `book.yaml` 的 schema，`shelf-pack` 和 App 共用。看看同样的校验在 Go 里怎么写：

```typescript
export const bookManifestSchema = z.object({
  id: z.string().regex(SLUG_RE, 'id 只能包含 [a-z0-9-]'),
  title: z.string().trim().min(1),
  level: z.enum(LEVELS).optional(),
  chapters: z.array(z.string().regex(CHAPTER_FILE_RE)).min(1),
  next: z.array(nextBookSchema).max(3).optional(),
});
```

Go 里分成两步：结构体负责**形状**（字段和类型），一个函数负责**规则**：

```go
package main

import (
	"errors"
	"fmt"
	"regexp"
	"slices"
)

var slugRe = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

type Manifest struct {
	ID       string   `yaml:"id"`
	Title    string   `yaml:"title"`
	Level    string   `yaml:"level"`
	Chapters []string `yaml:"chapters"`
}

// Validate 收集全部问题，而不是遇到第一个就返回，和 zod 的 safeParse 一样
func (m *Manifest) Validate() error {
	var errs []error
	if !slugRe.MatchString(m.ID) {
		errs = append(errs, fmt.Errorf("id 只能包含 [a-z0-9-]: %q", m.ID))
	}
	if m.Title == "" {
		errs = append(errs, errors.New("缺少 title"))
	}
	if m.Level != "" && !slices.Contains([]string{"beginner", "intermediate", "advanced"}, m.Level) {
		errs = append(errs, fmt.Errorf("level 不合法: %q", m.Level))
	}
	if len(m.Chapters) == 0 {
		errs = append(errs, errors.New("chapters 至少要有一章"))
	}
	return errors.Join(errs...) // 没有错误时返回 nil
}

func main() {
	m := Manifest{ID: "Go_Practice", Level: "expert"}
	fmt.Println(m.Validate())
}
```

```text
id 只能包含 [a-z0-9-]: "Go_Practice"
缺少 title
level 不合法: "expert"
chapters 至少要有一章
```

比 zod 啰嗦，但没有任何魔法：校验逻辑就是普通代码，可以单步调试，报错信息完全由你控制。社区也有 `go-playground/validator` 这类基于 tag 的校验库（`validate:"required,min=1"`），规则简单时可以用；规则一复杂，tag 里的小语言反而难读。完整的 `ParseManifest` 在[第 8 章](08-build-a-cli.md)。

## 本章要点

- 结构体是名义类型，没有可选字段，零值表示「没填」，需要区分时用指针
- 结构体 tag 给 JSON、YAML、数据库库提供字段映射；`json.Unmarshal` 只查类型不查业务规则
- 方法挂在类型上；有一个指针接收者，就全部用指针接收者；`NewXxx` 函数充当构造函数
- 嵌入是组合不是继承，没有 `super` 和覆盖
- 接口隐式实现、要小、定义在使用方；返回 `error` 时成功就 `return nil`，避免 nil 接口坑
- 枚举是 `const` + `iota` 或字符串常量，编译器不检查穷尽
- 泛型覆盖「同一逻辑适用多种类型」，没有条件类型；先写具体类型，重复三次再泛化
- 1.23 起可以用 `for range` 遍历迭代器函数，标准库的 `maps.Keys`、`slices.Sorted` 都基于它

## 动手练习

1. **nil 接口打印出了什么**：把[nil 接口的坑](#nil-接口的坑)一节的程序复制下来，把最后一行改成 `fmt.Println(err == nil, err)`，再加一行 `fmt.Printf("%T\n", err)`。运行前预测这两行输出。

   验证：输出 `false my error` 和 `*main.MyErr`。把 `find` 改成成功时 `return nil` 后，输出变成 `true <nil>` 和 `<nil>`。

   参考答案：返回的接口值动态类型是 `*MyErr`、动态值是 nil 指针，所以不等于 `nil`；`Error()` 的接收者没有解引用，在 nil 指针上调用也不会 panic，于是打印出了 `my error`，这种 bug 在日志里很难看出来。

2. **值不满足指针接收者的接口**：写一个 `Notifier` 接口和 `MemoryNotifier`（`Notify` 用指针接收者，同本章示例），在 `main` 里写 `mem := MemoryNotifier{}`，然后把 `mem` 直接传给一个参数类型是 `Notifier` 的函数。预测编译结果，再改一处让它通过。

   验证：编译失败，报错包含 `MemoryNotifier does not implement Notifier (method Notify has pointer receiver)`。把实参改成 `&mem` 后编译通过，并且函数里追加的消息在 `mem.sent` 里看得到。

   参考答案：指针接收者的方法只属于 `*MemoryNotifier` 的方法集。传值进去会被复制，修改落在副本上，所以编译器直接拒绝。

3. **去掉约束里的 `~`**：定义 `type Status int` 和约束 `type Number interface{ int | int64 | float64 }`（故意不写 `~`），用本章的 `Sum` 计算 `Sum([]Status{1, 2, 3})`。预测结果，再按报错提示修复。

   验证：编译失败，报错是 `Status does not satisfy Number (possibly missing ~ for int in Number)`；约束改成 `~int | ~int64 | ~float64` 后输出 `6`。

   参考答案：`int` 只匹配 `int` 本身；`~int` 匹配所有底层类型是 `int` 的类型，`Status` 也在其中。
