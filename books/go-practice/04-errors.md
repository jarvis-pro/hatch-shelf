# 错误处理

几乎每个刚学 Go 的人都会抱怨同一件事：`if err != nil { return err }` 写了一遍又一遍。这一章想说明的是，这种重复是有意的取舍：**错误是普通的返回值，每一个可能失败的调用点都摆在眼前**。看一段 Go 代码，你能准确说出它在哪几行可能失败、失败后去了哪里。TS 的 `throw` 做不到这一点，任何一个函数调用都可能抛出任何东西，类型系统也帮不上忙。

写顺手之后，Go 的错误处理其实只有几个固定套路。这一章把它们讲全。

## error 是一个接口

```go
type error interface {
	Error() string
}
```

任何有 `Error() string` 方法的类型都是错误。可能失败的函数把 `error` 作为最后一个返回值，调用方立即检查：

```go
package main

import (
	"fmt"
	"os"
)

func main() {
	data, err := os.ReadFile("book.yaml")
	if err != nil {
		fmt.Println("读取失败：", err)
		return
	}
	fmt.Println(len(data))
}
```

```text
读取失败： open book.yaml: no such file or directory
```

和 TS 对照：

| TS | Go |
|---|---|
| `throw new Error("x")` | `return errors.New("x")` |
| `try { a(); b(); } catch (e) {}` | 每个调用后 `if err != nil` |
| `catch (e) { if (e instanceof NotFound) }` | `errors.Is(err, ErrNotFound)` / `errors.As(err, &target)` |
| `new Error("x", { cause: e })` | `fmt.Errorf("x: %w", e)` |
| `AggregateError` | `errors.Join(e1, e2)` |
| 未捕获的异常让进程崩溃 | `panic`，只用于不该发生的情况 |
| 函数签名看不出会不会抛 | 签名里有 `error` 就可能失败，没有就不会 |

最后一行是关键差别。Go 函数签名本身就是一份「会不会失败」的文档。

## 包装：给错误加上下文

只是把错误原样往上返回，最后打出来的是 `no such file or directory`，不知道是哪个环节读哪个文件。正确做法是每一层用 `fmt.Errorf` 加上自己这一层的上下文，用 `%w` 包住原错误：

```go
package main

import (
	"fmt"
	"os"
)

func readManifest(dir string) ([]byte, error) {
	data, err := os.ReadFile(dir + "/book.yaml")
	if err != nil {
		return nil, fmt.Errorf("read manifest: %w", err)
	}
	return data, nil
}

func checkBook(dir string) error {
	if _, err := readManifest(dir); err != nil {
		return fmt.Errorf("check %s: %w", dir, err)
	}
	return nil
}

func main() {
	if err := checkBook("books/go-practice"); err != nil {
		fmt.Println(err)
	}
}
```

```text
check books/go-practice: read manifest: open books/go-practice/book.yaml: no such file or directory
```

一条错误信息读起来就是一条调用链，从外到内。几条约定：

- 错误信息**小写开头、不加句号**，因为它会被拼进更长的句子里
- 写「正在做什么」，不写「失败了」：`read manifest: ...` 而不是 `failed to read manifest: ...`，层层叠加后满屏的 failed to 没有信息量
- 上下文里带上关键参数（文件路径、id），但不要重复下层已经带了的信息；`os.ReadFile` 的错误里已经有路径了，上面这个例子里的 `check %s` 其实可以省掉

## 判断错误：errors.Is 与 errors.As

包装之后，原始错误还在链条里，可以用两个函数沿着链条找：

- `errors.Is(err, target)`：链条上是否有**某个特定的错误值**
- `errors.As(err, &target)`：链条上是否有**某个类型的错误**，有就取出来

```go
package main

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
)

func main() {
	_, err := os.ReadFile("/nope/book.yaml")
	err = fmt.Errorf("load book: %w", err)

	if errors.Is(err, fs.ErrNotExist) { // 判断「文件不存在」这一类
		fmt.Println("文件不存在")
	}

	var pathErr *fs.PathError
	if errors.As(err, &pathErr) { // 取出具体类型，读它的字段
		fmt.Println("操作:", pathErr.Op, "路径:", pathErr.Path)
	}

	fmt.Println(err == fs.ErrNotExist) // false：包装过的错误不能用 == 比较
}
```

最后一行是常见 bug：`err == ErrX` 只比较最外层，一旦中间有人包装过就失效。第 2 章配置的 errorlint 专门抓这种写法。

> [!WARNING]
> `errors.AsType` 是 Go 1.26 加入的泛型版本，更老的版本只能用 `errors.As` 加一个预先声明的变量。以 `errors` 包文档和 [go.dev/doc/go1.26](https://go.dev/doc/go1.26) 为准。

Go 1.26 起可以写得更紧凑，不用先声明变量：

```go
package main

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
)

func main() {
	_, err := os.Open("/nope")
	if pe, ok := errors.AsType[*fs.PathError](err); ok {
		fmt.Println("路径:", pe.Path)
	}
}
```

## 定义自己的错误

两种方式，按调用方需要知道多少来选。

**哨兵错误**（sentinel error）：一个包级变量，调用方只需要知道「是不是这种情况」：

```go
var ErrStoreNotFound = errors.New("store not found")
```

**自定义错误类型**：调用方需要更多信息（哪个字段、能不能重试、对应哪个状态码）：

```go
package main

import (
	"errors"
	"fmt"
	"time"
)

// UpstreamError 表示调用第三方服务失败
type UpstreamError struct {
	Service    string
	StatusCode int
	RetryAfter time.Duration
}

func (e *UpstreamError) Error() string {
	return fmt.Sprintf("%s returned %d", e.Service, e.StatusCode)
}

// Retryable 只有限流和服务端错误值得重试；400、401 重试一万次也不会对
func (e *UpstreamError) Retryable() bool {
	return e.StatusCode == 429 || e.StatusCode >= 500
}

func callOCR() error {
	return &UpstreamError{Service: "ocr", StatusCode: 429, RetryAfter: 2 * time.Second}
}

func main() {
	err := fmt.Errorf("recognize receipt 42: %w", callOCR())

	var up *UpstreamError
	if errors.As(err, &up) && up.Retryable() {
		fmt.Printf("%v，%v 后重试\n", err, up.RetryAfter)
	}
}
```

```text
recognize receipt 42: ocr returned 429，2s 后重试
```

这正是[《软件架构与系统设计》队列一章](../system-design/04-queues-jobs.md)里说的「区分可重试和不可重试的错误」，在 Go 里落到一个方法上。

选择的原则：**能用哨兵就用哨兵，需要携带数据才定义类型**。不管哪种，它们都是包的公开 API 的一部分，一旦导出，调用方就会依赖它，改名就是破坏性变更。如果不希望调用方依赖某个错误，就不要导出它，用 `%v` 而不是 `%w` 包装（`%v` 只保留文字，切断链条）。

## 一次处理

一个错误应该**只被处理一次**。「处理」指的是：记日志、转成 HTTP 响应、重试、降级、或者向上返回。常见的反模式是又记日志又返回：

```go
// 反例：同一个错误会在日志里出现三次，每层一次
if err != nil {
	log.Printf("load book failed: %v", err)
	return err
}
```

正确做法是中间层只包装、返回，**在最外层统一记录**：CLI 在 `main` 里打印，HTTP 服务在 handler 或中间件里记日志并转成响应。

## errors.Join：收集多个错误

校验类的场景需要把所有问题都报出来，而不是遇到第一个就返回。第 3 章的 `Validate` 已经用过：

```go
package main

import (
	"errors"
	"fmt"
)

func main() {
	var errs []error
	errs = append(errs, errors.New("缺少 title"))
	errs = append(errs, errors.New("chapters 至少要有一章"))
	err := errors.Join(errs...) // 全是 nil 或空切片时返回 nil

	fmt.Println(err) // 每个错误一行
	if j, ok := err.(interface{ Unwrap() []error }); ok {
		fmt.Println("共", len(j.Unwrap()), "条")
	}
}
```

`errors.Is` 和 `errors.As` 会在 Join 出来的所有分支里查找。

## panic 与 recover

`panic` 是 Go 里最接近 `throw` 的东西：立刻停止当前函数，沿调用栈逐层执行 `defer`，如果没人 `recover`，进程崩溃并打印所有 goroutine 的栈。

**panic 只用于程序员的错误**，也就是「如果代码是对的，这里就不可能发生」的情况：数组越界、空指针解引用、`regexp.MustCompile` 传了写错的正则。可预期的失败（文件不存在、网络超时、用户输入不合法）一律返回 `error`。

```go
package main

import (
	"fmt"
	"regexp"
)

// 包级变量在程序启动时初始化，正则写错了立刻 panic，比运行到一半才发现好
var dateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func safeDiv(a, b int) (q int, err error) {
	defer func() {
		if r := recover(); r != nil { // recover 只在 defer 函数里有效
			err = fmt.Errorf("recovered: %v", r)
		}
	}()
	return a / b, nil
}

func main() {
	fmt.Println(dateRe.MatchString("2026-11-04"))
	fmt.Println(safeDiv(1, 0))
}
```

```text
true
0 recovered: runtime error: integer divide by zero
```

`recover` 唯一常见的正当用途，是在**边界**上兜底，防止一个请求的 bug 拖垮整个服务。`net/http` 已经在每个请求的 goroutine 里做了 recover（会打一行日志、断开这个连接），第 7 章的中间件再加一层，返回一个干净的 500。

注意：**自己用 `go` 启动的 goroutine 里 panic 没人兜**，会直接让整个进程崩溃。第 5 章会再提到。

## 资源清理与 defer 的错误

`defer f.Close()` 会忽略 `Close` 的返回值。对只读文件这没问题；但对**写入**的文件，`Close` 失败可能意味着数据没落盘，应该检查。用命名返回值可以把它合并进函数的错误：

```go
package main

import (
	"errors"
	"fmt"
	"os"
)

func writeReport(path string, body []byte) (err error) {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("create report: %w", err)
	}
	defer func() {
		err = errors.Join(err, f.Close()) // Close 的错误不会被吞掉
	}()

	if _, err := f.Write(body); err != nil {
		return fmt.Errorf("write report: %w", err)
	}
	return nil
}

func main() {
	err := writeReport(os.TempDir()+"/report.txt", []byte("ok\n"))
	fmt.Println(err)
}
```

## 案例：业务错误到 HTTP 状态码

在 NestJS 里，你会抛 `NotFoundException`，让全局异常过滤器转成响应。Go 没有异常，但可以做同样的分层：业务层返回有含义的错误，HTTP 层统一翻译。

```go
package main

import (
	"errors"
	"fmt"
	"net/http"
)

var (
	ErrNotFound  = errors.New("not found")
	ErrForbidden = errors.New("forbidden")
)

// ValidationError 携带字段信息，客户端可以据此高亮表单
type ValidationError struct {
	Field string
	Msg   string
}

func (e *ValidationError) Error() string { return e.Field + ": " + e.Msg }

// statusOf 是唯一一处把业务错误翻译成 HTTP 状态码的地方
func statusOf(err error) (int, string) {
	var ve *ValidationError
	switch {
	case errors.As(err, &ve):
		return http.StatusUnprocessableEntity, ve.Error()
	case errors.Is(err, ErrNotFound):
		return http.StatusNotFound, "资源不存在"
	case errors.Is(err, ErrForbidden):
		return http.StatusForbidden, "没有权限"
	default:
		return http.StatusInternalServerError, "服务器内部错误" // 细节只进日志，不给客户端
	}
}

func main() {
	errs := []error{
		fmt.Errorf("get store 7: %w", ErrNotFound),
		&ValidationError{Field: "amountFen", Msg: "不能为 0"},
		fmt.Errorf("query entries: %w", errors.New("connection reset")),
	}
	for _, err := range errs {
		code, msg := statusOf(err)
		fmt.Println(code, msg)
	}
}
```

```text
404 资源不存在
422 amountFen: 不能为 0
500 服务器内部错误
```

存储层用 `%w` 把 `ErrNotFound` 一路包装上来，中间加了多少层上下文都不影响 `statusOf` 的判断；日志里记的是完整的那条链，客户端只看到翻译过的简短信息。第 7 章的 handler 就是按这个思路写的。

## 减少 if err != nil 的几个办法

重复写 `if err != nil` 本身不是问题，但有几个场景可以写得更干净：

- **把多步操作收进一个函数**，函数里每步检查，调用方只检查一次
- **「粘性错误」模式**：像 `bufio.Scanner`、`bufio.Writer` 那样，第一次出错后记下错误、后续操作变成空操作，最后统一 `Err()` 检查一次

```go
package main

import (
	"bufio"
	"fmt"
	"strings"
)

func main() {
	sc := bufio.NewScanner(strings.NewReader("第一行\n第二行\n"))
	for sc.Scan() { // 循环里不用检查错误
		fmt.Println(sc.Text())
	}
	if err := sc.Err(); err != nil { // 结束后检查一次
		fmt.Println("读取出错：", err)
	}
}
```

不要做的事：写一个 `check(err)` 函数在里面 `panic`，再在外面 `recover`。那是在 Go 里重新发明异常，丢掉了错误显式传递的全部好处。

## 本章要点

- `error` 是只有 `Error() string` 的接口；可能失败的函数把它作为最后一个返回值
- 每一层用 `fmt.Errorf("做什么: %w", err)` 加上下文，信息小写、不加句号、不写 failed to
- 用 `errors.Is` 判断特定错误值，`errors.As`（1.26 起还有 `errors.AsType`）取出特定类型；不要用 `==`
- 能用哨兵错误就用哨兵，需要携带数据再定义错误类型；导出的错误是 API 的一部分
- 一个错误只处理一次：中间层包装返回，最外层记录或翻译
- `errors.Join` 收集多个错误；写入文件时用命名返回值合并 `Close` 的错误
- `panic` 只用于程序员错误；`recover` 只在边界上兜底；自己起的 goroutine 里的 panic 会让进程崩溃
