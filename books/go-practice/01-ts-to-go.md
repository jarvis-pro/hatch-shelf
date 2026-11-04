# TS 对照速学 Go

你已经能用 TypeScript 写完一整套产品：Expo 做 App，NestJS 加 Postgres 做后端，Electron 做桌面端。那为什么还要学 Go？

因为一人公司里有一类活，Node 做起来总是差一点：**发给别人用的命令行工具**（对方机器上未必有 Node，`npx` 第一次要下载半天）、**常驻在服务器上的小守护进程**（Node 进程空跑就占几十 MB 内存）、**运维脚本**（Bash 写到两百行就开始失控）。Go 把这些事做得很朴素：`go build` 出一个几 MB 的静态二进制文件，拷到任何同架构的机器上就能跑，没有运行时，没有 `node_modules`。

这本书不劝你把 NestJS 后端改写成 Go。主业务继续用 TS，Go 用在它最顺手的地方：CLI、小服务、运维工具。

## 这本书讲什么、适合谁、怎么读

**讲什么**：十章，从语法对照到上线部署。前六章是语言本身：语法、工具链、类型系统、错误处理、并发、context；后四章是干活：用标准库写一个连 Postgres 的 HTTP 服务、把 hatch-shelf 的 `shelf-pack check` 用 Go 重写一遍、测试与基准、构建与部署。

**适合谁**：TS 写得很熟、没写过 Go 的全栈开发者。全书默认你知道泛型、`Promise`、`async/await`、zod、pnpm、Docker 是什么。

**怎么读**：第 1–4 章按顺序读；第 5–6 章是 Go 和 Node 差别最大的部分，建议对照[《TS 与 Node 进阶》的事件循环一章](../ts-node-advanced/04-event-loop-libuv.md)一起看；第 7–10 章是两个贯穿的例子，可以边读边敲。

> [!WARNING]
> 本书以 **Go 1.26** 为基线，代码在 Go 1.26.5（macOS / arm64）上实际编译运行过。Go 每半年发一个版本（2 月、8 月），标准库会持续增加新 API；书中标注了「1.2x 起」的特性在更老的版本上不可用，新版本可能有更好的写法。写作时最新的是 2026 年 8 月发布的 Go 1.27，和本书相关的变化见本章[「Go 1.27 带来了什么」](#go-127-带来了什么)。以 [go.dev/doc/devel/release](https://go.dev/doc/devel/release) 和各版本的 Release Notes 为准。

## 心智模型：先校准几个大前提

| 方面 | TypeScript / Node | Go |
|---|---|---|
| 类型 | 结构化类型，编译期检查，运行时擦除 | 静态类型，**编译不过就不能运行**；接口是结构化的，其余是名义类型 |
| 产物 | JS 文件 + `node_modules`，要有 Node 运行时 | 一个原生二进制文件，自带运行时和 GC |
| 并发 | 单线程事件循环，`async/await` | goroutine（轻量线程）+ channel，代码写成同步的样子，调度器负责并发 |
| 错误 | `throw` / `try-catch` | 错误是**返回值**，`if err != nil` 显式处理 |
| 空值 | `null`、`undefined` | 每个类型都有**零值**（`0`、`""`、`false`、`nil`），没有 undefined |
| 可见性 | `export` | 名字**首字母大写**即导出 |
| 风格 | Prettier + ESLint，配置各异 | `gofmt` 只有一种格式，没有配置项 |
| 继承 | `class extends` | 没有继承，用组合（嵌入）和接口 |

Go 的设计目标是「一群水平参差的人写出来的代码长得差不多」，所以语言特性刻意做少：没有三元运算符、没有函数重载、没有默认参数、没有异常、没有 `map/filter` 链式调用。刚开始会觉得啰嗦，写多了会发现读别人的代码几乎没有理解成本。

## 第一个程序

```go
package main

import "fmt"

func main() {
	name := "hatch"
	fmt.Printf("hello, %s! %d 本书\n", name, 3)
}
```

```bash
go run main.go          # 编译并运行，相当于 tsx main.ts
go build -o hello .     # 编译出二进制 ./hello
```

三点：每个文件第一行声明所属的包，可执行程序的入口必须是 `package main` 里的 `func main()`；导入了不用的包、声明了不用的局部变量都是**编译错误**，不是警告；缩进是 Tab，这由 `gofmt` 决定，不用讨论。

## 变量、类型与零值

```typescript
const name = "hatch";
let count = 3;
let ratio: number = 0.75;
let user: User | undefined;
```

```go
package main

import "fmt"

type User struct{ Name string }

func main() {
	name := "hatch"      // 短变量声明，只能在函数内用，类型由右边推断
	var count int = 3    // 完整写法
	var ratio = 0.75     // 省略类型，推断为 float64
	var user *User       // 没赋值就是零值：指针的零值是 nil
	const maxBooks = 500 // 常量，编译期确定

	var total int    // 零值 0
	var title string // 零值 ""
	var ok bool      // 零值 false
	fmt.Println(name, count, ratio, user == nil, maxBooks, total, title == "", ok)
}
```

**零值**是 Go 最重要的概念之一：任何变量声明后都有确定的值，不存在「未初始化」。好的 Go 类型会让零值直接可用，比如 `var mu sync.Mutex` 不用构造就能加锁，`var sb strings.Builder` 不用 `new` 就能写入。

### 数字类型

| TS | Go | 说明 |
|---|---|---|
| `number`（整数用途） | `int` | 64 位平台上是 64 位，日常计数、下标都用它 |
| `number`（浮点用途） | `float64` | 和 JS 的 number 一样是 IEEE 754 双精度 |
| `bigint` | `int64` / `math/big` | 定长整数会溢出回绕，不报错 |
| `Uint8Array` 的元素 | `byte`（即 `uint8`） | 字节 |
| 无 | `rune`（即 `int32`） | 一个 Unicode 码点 |

Go **没有隐式类型转换**：`int` 和 `int64` 不能直接相加，`int` 和 `float64` 也不行，必须写 `float64(n)`。整数除法向零截断，`7 / 2` 是 `3`，`-7 / 2` 是 `-3`。

```go
package main

import "fmt"

func main() {
	price := 1250 // 金额用整数分
	qty := 3
	rate := 0.06
	tax := float64(price*qty) * rate // 必须显式转换
	fmt.Println(7/2, -7/2, 7.0/2, tax)
	// 输出：3 -3 3.5 225
}
```

### 字符串、字节与 rune

Go 的字符串是**不可变的字节序列**，通常存 UTF-8。这和 JS 的 UTF-16 字符串不同，`len` 返回的是字节数：

```go
package main

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

func main() {
	s := "Go 实战"
	fmt.Println(len(s))                    // 9：字节数，一个汉字占 3 字节
	fmt.Println(utf8.RuneCountInString(s)) // 5：字符数
	for i, r := range s {                  // range 字符串按 rune 迭代，i 是字节下标
		fmt.Print(i, ":", string(r), " ")
	}
	fmt.Println()

	fmt.Println(strings.ToUpper("go"), strings.Contains(s, "实"), strings.Split("a,b", ","))
	fmt.Println(strings.TrimSpace("  x  "), strings.Join([]string{"a", "b"}, "-"))
	msg := fmt.Sprintf("%s 有 %d 章，进度 %.1f%%", "go-practice", 10, 42.5)
	fmt.Println(msg)
}
```

Go 没有模板字符串，拼接用 `+`、`fmt.Sprintf` 或 `strings.Builder`。反引号是**原始字符串**，不处理转义、可以跨行，写正则和 SQL 时很方便：`` `^\d{4}-\d{2}$` ``。

`fmt` 的格式化动词常用这几个：`%v`（默认格式，万能）、`%+v`（结构体带字段名）、`%q`（带引号的字符串，调试时看清空白字符）、`%T`（类型名）、`%w`（只用在 `fmt.Errorf` 里包装错误，第 4 章讲）。

## 切片与 map

TS 的数组在 Go 里对应**切片**（slice）。Go 也有定长数组 `[3]int`，但日常几乎只用切片 `[]int`。

```go
package main

import (
	"fmt"
	"slices"
)

func main() {
	nums := []int{3, 1, 2}
	nums = append(nums, 4, 5) // push：append 返回新切片，必须接住
	fmt.Println(len(nums), nums[0], nums[len(nums)-1])
	fmt.Println(nums[1:3])                      // [1 2]，左闭右开，同 slice(1, 3)
	slices.Sort(nums)                           // 原地排序
	fmt.Println(nums, slices.Contains(nums, 4)) // includes
	idx := slices.Index(nums, 3)                // indexOf
	fmt.Println(idx)

	ids := make([]string, 0, 100) // 长度 0、容量 100，预分配
	ids = append(ids, "go-practice")
	fmt.Println(ids)

	// map：键值对，相当于 Map<string, number>
	ages := map[string]int{"ada": 36}
	ages["linus"] = 55
	age, ok := ages["grace"] // 取不存在的键得到零值；ok 区分「不存在」和「值为 0」
	fmt.Println(age, ok, len(ages))
	delete(ages, "ada")
	for k, v := range ages { // 遍历顺序是随机的，需要稳定顺序就先排序键
		fmt.Println(k, v)
	}
}
```

切片不是数组本身，而是一个三元组：**指向底层数组的指针、长度、容量**。两个切片可以共享同一个底层数组，这是 Go 新手最常踩的坑：

![切片 s 指向底层数组的第 1 到 3 个元素，t 由 s[0:2] 得到，两者共享同一块内存，修改 t[0] 会同时改变 s[0]。](assets/slice-header.svg)

```go
package main

import (
	"fmt"
	"slices"
)

func main() {
	arr := []int{0, 1, 2, 3, 4, 5}
	s := arr[1:4] // [1 2 3]，len 3，cap 5
	t := s[0:2]   // [1 2]，和 s 共享底层数组
	t[0] = 100
	fmt.Println(arr, s, t) // [0 100 2 3 4 5] [100 2 3] [100 2]

	t = append(t, 99) // cap 还够，直接写进底层数组，覆盖了 s[2]
	fmt.Println(s)    // [100 2 99]

	c := slices.Clone(s) // 需要独立副本时复制一份
	c[0] = 0
	fmt.Println(s[0], c[0]) // 100 0
}
```

规则很简单：**把切片传出去或从别处拿到切片时，默认它可能和别人共享**；需要独立修改就用 `slices.Clone`。`map` 和切片一样是引用语义，传给函数后函数里的修改调用方可见。

没有 `map`、`filter`、`reduce` 方法，就写 `for` 循环。标准库的 `slices` 和 `maps` 包提供了排序、查找、比较、去重这类常用函数，覆盖了大部分 lodash 的用途。

## 控制流

Go 只有一种循环 `for`，没有 `while`；`if` 和 `switch` 不需要括号，但花括号必须有。

```go
package main

import (
	"fmt"
	"os"
)

func main() {
	for i := 0; i < 3; i++ { // 经典 for
		fmt.Print(i)
	}
	for i := range 3 { // 遍历整数，1.22 起
		fmt.Print(i)
	}
	n := 0
	for n < 3 { // 相当于 while
		n++
	}
	for _, name := range []string{"a", "b"} { // 相当于 for...of，_ 丢弃下标
		fmt.Print(name)
	}
	fmt.Println()

	// if 可以带一个初始化语句，变量只在 if/else 里可见
	if info, err := os.Stat("go.mod"); err == nil {
		fmt.Println("size", info.Size())
	} else {
		fmt.Println("no go.mod")
	}

	level := "intermediate"
	switch level { // 不会 fall-through，不用写 break
	case "beginner", "intermediate":
		fmt.Println("入门或进阶")
	case "advanced":
		fmt.Println("高级")
	default:
		fmt.Println("未知")
	}

	score := 85
	switch { // 没有表达式的 switch，代替 if-else 链
	case score >= 90:
		fmt.Println("A")
	case score >= 80:
		fmt.Println("B")
	default:
		fmt.Println("C")
	}
}
```

没有三元运算符。`x := a ? b : c` 在 Go 里老老实实写成 `if`，或者先赋默认值再条件覆盖。

## 函数：多返回值

```typescript
function divide(a: number, b: number): { q: number; r: number } {
  return { q: Math.trunc(a / b), r: a % b };
}
const { q, r } = divide(7, 2);
```

```go
package main

import (
	"errors"
	"fmt"
)

func divide(a, b int) (int, int, error) {
	if b == 0 {
		return 0, 0, errors.New("除数不能为 0")
	}
	return a / b, a % b, nil
}

func sum(nums ...int) int { // 可变参数，nums 是 []int
	total := 0
	for _, n := range nums {
		total += n
	}
	return total
}

func main() {
	q, r, err := divide(7, 2)
	if err != nil {
		fmt.Println(err)
		return
	}
	fmt.Println(q, r, sum(1, 2, 3), sum([]int{4, 5}...))

	double := func(x int) int { return x * 2 } // 函数字面量（闭包）
	fmt.Println(double(21))
}
```

**多返回值**是 Go 错误处理的基础：可能失败的函数最后一个返回值是 `error`，调用方立刻检查。第 4 章专门讲。

没有默认参数和可选参数。参数多了的惯用法是传一个配置结构体，或者用「函数式选项」（第 3 章）。

## 指针

Go 有指针，但没有指针运算，用起来比 C 安全得多。你可以把它理解成「显式的引用」：

```go
package main

import "fmt"

type Book struct {
	ID    string
	Pages int
}

func addPageByValue(b Book) { b.Pages++ } // 拿到的是副本，改了没用
func addPage(b *Book)       { b.Pages++ } // 拿到的是指针，改的是原值

func main() {
	b := Book{ID: "go-practice", Pages: 10}
	addPageByValue(b)
	fmt.Println(b.Pages) // 10
	addPage(&b)          // & 取地址
	fmt.Println(b.Pages) // 11

	p := &b
	fmt.Println(p.Pages) // 指针访问字段不用写 (*p).Pages，Go 自动解引用
}
```

在 JS 里对象永远按引用传递，Go 里**结构体默认按值复制**。什么时候用指针：需要修改调用方的值；结构体较大，不想复制；或者需要用 `nil` 表示「没有」。小结构体按值传递完全正常，不用为了「性能」到处加 `*`。

## 包、导出与 defer

```go
package book // 一个目录就是一个包，目录里所有 .go 文件属于同一个包

import "strings"

// Normalize 首字母大写：导出，包外可以调用 book.Normalize
func Normalize(id string) string {
	return strings.ToLower(trim(id))
}

// trim 首字母小写：只在 book 包内可见
func trim(s string) string { return strings.TrimSpace(s) }
```

没有 `export` 关键字，也没有 `private`；**首字母大写就是导出**，对函数、类型、结构体字段、方法、常量都一样。这条规则还会影响 JSON：小写字段不会被 `encoding/json` 序列化。

`defer` 把一个调用推迟到函数返回时执行，用来做清理，相当于 `try/finally` 或 TS 5.2 的 `using`：

```go
package main

import (
	"fmt"
	"os"
)

func firstLine(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close() // 不管从哪个 return 离开，都会关闭文件

	buf := make([]byte, 64)
	n, err := f.Read(buf)
	if err != nil {
		return "", err
	}
	return string(buf[:n]), nil
}

func main() {
	os.WriteFile("demo.txt", []byte("hello\n"), 0o644)
	line, err := firstLine("demo.txt")
	fmt.Printf("%q %v\n", line, err)
	os.Remove("demo.txt")
}
```

习惯是**拿到资源后紧接着写 defer**，打开和关闭写在相邻两行，不会忘。多个 defer 按后进先出的顺序执行。

## 常见坑速查

| 现象 | 原因 | 正确做法 |
|---|---|---|
| `declared and not used` 编译不过 | 未使用的局部变量和导入是错误 | 删掉，或调试时临时赋给 `_` |
| `append` 之后原切片没变 | `append` 返回新切片 | 永远写 `s = append(s, x)` |
| 改了一个切片，另一个也变了 | 共享底层数组 | 需要独立副本时 `slices.Clone` |
| 往 `nil` map 写入 panic | `var m map[string]int` 的零值不能写 | 用 `make(map[string]int)` 或字面量初始化 |
| 遍历 map 每次顺序不同 | 故意随机化 | 需要稳定输出时先 `slices.Sorted(maps.Keys(m))` |
| JSON 里字段丢了 | 字段首字母小写，未导出 | 字段大写，用 tag 指定 JSON 名（第 3 章） |
| `len("中文")` 是 6 | 返回字节数 | 字符数用 `utf8.RuneCountInString` |
| 整数相除结果不对 | `int / int` 截断 | 先转 `float64`，金额用整数分 |

## Go 1.27 带来了什么

> [!WARNING]
> 本节按 2026 年 11 月 [go.dev/doc/go1.27](https://go.dev/doc/go1.27) 和 [go.dev/doc/devel/release](https://go.dev/doc/devel/release) 整理。书里的代码没有在 Go 1.27 上逐个重跑，下面列出的新写法也没有实际编译过，以官方 Release Notes 和包文档为准。

Go 1.27 在 2026 年 8 月 19 日发布。Go 官方只维护最新的两个大版本，1.27 发布之后 **1.25 不再收安全修复**，本书的基线 1.26 仍在维护期内。go.mod 里写 `go 1.26.5` 的项目在 1.27 上照常编译；想用下面这些新东西，要把 `go` 行改成 `go 1.27`。

和本书内容相关的变化：

| 变化 | 影响本书哪里 |
|---|---|
| **方法可以声明自己的类型参数**（泛型方法）。接口里的方法仍然不行，泛型方法也不能用来实现接口 | [第 3 章](03-structs-interfaces-generics.md)泛型限制表里「方法自带类型参数」一行，1.27 起放开了一半 |
| `encoding/json` 底层换成了 `encoding/json/v2` 的实现，解码明显变快，错误信息文字可能和以前不同；新增 `encoding/json/v2` 和 `encoding/json/jsontext` 两个包，v2 默认拒绝非法 UTF-8 和重复的键 | 第 3、7 章的 `json.Marshal` / `json.NewDecoder` 写法不用改；**别在测试里断言 JSON 错误信息的原文** |
| 新的标准库包 `uuid`：`uuid.NewV4()`、`uuid.NewV7()`、`uuid.Parse` | 以前要引 `github.com/google/uuid`，现在标准库就有 |
| `strings.CutLast` / `bytes.CutLast`：按**最后一次**出现的分隔符切开 | 处理文件扩展名、`host:port` 这类「取最后一段」的场景 |
| `testing/synctest.Sleep`：等于 `time.Sleep` 加 `synctest.Wait`；`httptest.NewTestServer` 用内存网络，能放进 synctest 气泡里 | [第 9 章](09-testing-benchmarks.md)的 synctest 和 httptest 两节 |
| `go fix` 的现代化改写里，把 `wg.Add(1)` + `defer wg.Done()` 改成 `wg.Go` 的那条改名为 `waitgroupgo` | [第 5 章](05-goroutines-channels.md)的 `wg.Go` |
| `go.mod` 写 `go 1.27` 及以上时，`go mod tidy` 把 `require` 合并成最多两块：直接依赖一块、间接依赖一块 | [第 2 章](02-modules-toolchain.md)的 go.mod 会出现一次性的格式变化，diff 看起来大，内容没变 |
| macOS 上要求 macOS 13 Ventura 及以上 | 第 10 章交叉编译出的 darwin 二进制，老 Mac 上跑不了 |

两个新写法的样子，对照 TS：

```go
// TS: crypto.randomUUID()；Go 1.27 起不用第三方库
id := uuid.NewV7() // 按时间有序，适合做数据库主键
fmt.Println(id.String())

// TS: s.slice(s.lastIndexOf(".") + 1)
name, ext, found := strings.CutLast("notes.final.md", ".")
// name = "notes.final", ext = "md", found = true
```

**升不升级**：小工具和 CLI 跟着最新版走成本很低，`go.mod` 改一行、跑一遍测试即可；第 2 章讲的工具链自动切换会替没装 1.27 的机器下载对应版本。只有一件事要留意：如果代码里有人比较过 JSON 错误信息的字符串，1.27 之后可能对不上。

## 本章要点

- Go 适合一人公司里 Node 做得别扭的部分：分发给别人的 CLI、常驻小服务、运维工具；主业务继续用 TS
- 静态类型、编译成单个原生二进制；未使用的变量和导入是编译错误
- 每个类型都有零值，好的类型让零值直接可用；没有 undefined
- 切片是「指针 + 长度 + 容量」，可能共享底层数组；`append` 必须接住返回值
- 只有 `for` 一种循环，`switch` 不 fall-through，没有三元运算符
- 多返回值 + `error` 是错误处理的基础；首字母大写即导出；`defer` 做清理

## 动手练习

1. **append 覆盖了谁**：新建 `main.go`，写入下面的代码。运行前先预测三行输出里 `arr` 的第 4 个元素是多少，再 `go run main.go`。

   ```go
   package main

   import "fmt"

   func main() {
   	arr := []int{0, 1, 2, 3, 4, 5}
   	s := arr[1:3]
   	t := append(s, 99)
   	t[0] = -1
   	fmt.Println(arr, s, t)
   }
   ```

   验证：输出是 `[0 -1 2 99 4 5] [-1 2] [-1 2 99]`。然后把 `s := arr[1:3]` 改成 `s := slices.Clone(arr[1:3])`（补上 `import "slices"`），再跑一次，`arr` 应保持 `[0 1 2 3 4 5]`。

   参考答案：`s` 的容量是 5，`append` 不需要扩容，直接把 99 写进底层数组下标 3 的位置，`t` 和 `s`、`arr` 共享同一块内存，所以 `t[0] = -1` 也改到了 `arr[1]`。`Clone` 后 `s` 有自己的底层数组，两边互不影响。

2. **编译器比 ESLint 严格**：在一个能跑的程序里加一行 `total := 0` 但不使用它，预测 `go run` 的结果；再把它改成 `_ = total` 试一次。

   验证：第一次编译失败，报错形如 `./main.go:6:2: declared and not used: total`，程序不会运行；加上 `_ = total` 后正常运行。对未使用的 `import` 做同样的实验，会看到 `"xxx" imported and not used`。

   参考答案：未使用的局部变量和导入在 Go 里是编译错误，不是警告；`_` 是空白标识符，赋给它就算「用过了」，只适合调试时临时用。

3. **nil map 能读不能写**：写一个程序，先 `var m map[string]int`，打印 `m["a"]` 和 `len(m)`，再执行 `m["a"] = 1`。预测哪一步出问题，然后把声明改成 `m := map[string]int{}` 再跑。

   验证：读和 `len` 正常输出 `0 0`，写入时程序崩溃，输出以 `panic: assignment to entry in nil map` 开头；改用字面量初始化后不再 panic。

   参考答案：map 的零值是 `nil`，读取返回值类型的零值，写入则 panic。需要可写的 map 时用 `make` 或字面量创建。
