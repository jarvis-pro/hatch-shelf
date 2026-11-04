# 测试与基准

TS 项目里，测试要先选框架（Vitest、Jest），再配断言库、mock 库、覆盖率工具。Go 的测试全部内置：`go test` 是运行器，`testing` 包提供测试、基准、模糊测试和示例，覆盖率和竞争检测是命令行开关。没有断言库，没有 mock 框架，测试就是普通的 Go 代码。

这一章给前两章的两个项目补上测试：`shelfcheck` 的校验逻辑和 CLI 入口、counter-lite 的 HTTP handler，再给章节检查写一个基准测试，用数据驱动一次优化。

## 第一个测试

测试文件以 `_test.go` 结尾，和被测代码放在同一个目录、同一个包里，所以能访问未导出的函数。测试函数以 `Test` 开头，参数是 `*testing.T`：

```go
package book

import "testing"

func TestProblemString(t *testing.T) {
	p := Problem{File: "01-a.md", Line: 3, Msg: "代码块没有标注语言"}
	if got, want := p.String(), "01-a.md:3 代码块没有标注语言"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}
```

```bash
go test ./...                    # 所有包
go test ./internal/book          # 一个包
go test -run TestLint ./...      # 按名字过滤（正则）
go test -v -count=1 ./...        # 详细输出，-count=1 禁用缓存
go test -race ./...              # 带竞争检测，CI 里的默认命令
```

`go test` 会缓存通过的结果，代码和依赖没变时直接显示 `(cached)`，大项目里能省很多时间。

没有 `expect(x).toBe(y)`，比较就是 `if`，失败时调用：

| 方法 | 作用 |
|---|---|
| `t.Errorf` | 记录失败，**继续执行**，一次看到多个问题 |
| `t.Fatalf` | 记录失败，**立即结束**这个测试，后续步骤依赖它时用 |
| `t.Helper()` | 标记辅助函数，失败时报告调用者的行号 |
| `t.Cleanup(f)` | 测试结束时执行清理，相当于 `afterEach` |
| `t.TempDir()` | 一个测试结束后自动删除的临时目录 |
| `t.Parallel()` | 和其他标了 Parallel 的测试并行运行 |
| `t.Skip()` | 跳过，比如没有数据库时跳过集成测试 |

失败信息要写清楚 got 和 want，这是 Go 社区的固定格式。习惯 Jest 的话，可以引入 `testify` 的 `assert` / `require` 包，它很流行；但标准库写法并不比它长多少，而且不需要学一套新 API。

## 表驱动测试

Go 测试最常见的形式：把用例写成一个切片，循环跑，每个用例用 `t.Run` 起一个子测试：

```go
package book

import (
	"slices"
	"strings"
	"testing"
	"testing/fstest"
)

func TestLintChapter(t *testing.T) {
	assets := map[string]bool{"assets/flow.svg": true}
	tests := []struct {
		name string
		text string
		want []string // 期望出现的问题，按顺序
	}{
		{
			name: "合规的一章",
			text: "# 标题\n\n![图](assets/flow.svg)\n\n```go\nfmt.Println()\n```\n",
		},
		{
			name: "没有 H1",
			text: "## 只有二级标题\n",
			want: []string{"a.md 没有 H1 章标题"},
		},
		{
			name: "代码块里的 # 不算 H1",
			text: "# 标题\n\n```bash\n# 注释\n```\n",
		},
		{
			name: "代码块没标语言",
			text: "# 标题\n\n```\nplain\n```\n",
			want: []string{"a.md:3 代码块没有标注语言"},
		},
		{
			name: "远程图片和不存在的图片",
			text: "# 标题\n![x](https://example.com/a.png)\n![y](assets/none.png)\n",
			want: []string{
				"a.md:2 远程图片（离线时无法显示）：https://example.com/a.png",
				"a.md:3 图片不存在：assets/none.png",
			},
		},
		{
			name: "行内代码里的图片语法不算",
			text: "# 标题\n用 `![说明](assets/x.png)` 引用图片\n",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got []string
			for _, p := range LintChapter("a.md", tt.text, assets) {
				got = append(got, p.String())
			}
			if !slices.Equal(got, tt.want) {
				t.Errorf("got  %q\nwant %q", got, tt.want)
			}
		})
	}
}

func TestCheck(t *testing.T) {
	fsys := fstest.MapFS{ // 内存里的文件系统，不碰磁盘
		"book.yaml": {Data: []byte("id: demo\ntitle: 示例\nchapters:\n  - 01-a.md\n  - 02-b.md\n")},
		"01-a.md":   {Data: []byte("# 第一章\n")},
	}
	got := Check(fsys, "demo")
	if len(got) != 1 || got[0].File != "02-b.md" {
		t.Fatalf("got %v", got)
	}
}
```

（`strings` 在后面的基准测试里用到。）

加一个用例就是加一行数据。子测试的名字会出现在输出里，也可以单独运行：`go test -run 'TestLintChapter/没有_H1'`（名字里的空格被替换成下划线）。故意把一个期望改错，失败时是这样：

```text
--- FAIL: TestLintChapter (0.00s)
    --- FAIL: TestLintChapter/代码块没标语言 (0.00s)
        lint_test.go:55: got  ["a.md:3 代码块没有标注语言"]
            want ["a.md:2 代码块没有标注语言"]
FAIL
FAIL	github.com/jarvis/shelfcheck/internal/book	0.470s
```

`TestCheck` 用了上一章说的 `fstest.MapFS`：`Check` 接受 `fs.FS` 接口，测试里传一个 map 就行，不用创建临时目录、不用清理。

## 测试 CLI 入口

上一章把 CLI 的逻辑放在 `run(ctx, args, stdout, stderr) int` 里，现在得到回报：测试直接调用 `run`，用 `bytes.Buffer` 接住输出。这次用真实的临时目录，因为 `run` 内部用的是 `os.DirFS`：

```go
package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeBook 在临时目录里造一本书，files 是「相对路径 → 内容」。
func writeBook(t *testing.T, root, id string, files map[string]string) {
	t.Helper()
	for name, body := range files {
		p := filepath.Join(root, id, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestRun(t *testing.T) {
	root := t.TempDir() // 测试结束自动删除
	writeBook(t, root, "good", map[string]string{
		"book.yaml": "id: good\ntitle: 好书\nchapters: [01-a.md]\n",
		"01-a.md":   "# 第一章\n",
	})
	writeBook(t, root, "bad", map[string]string{
		"book.yaml": "id: bad\ntitle: 坏书\nchapters: [01-a.md]\n",
		"01-a.md":   "没有标题\n",
	})

	var stdout, stderr bytes.Buffer
	code := run(context.Background(), []string{"-q", root}, &stdout, &stderr)

	if code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	want := "✗ bad\n    01-a.md 没有 H1 章标题\n\n1 / 2 本书有错误\n"
	if got := stdout.String(); got != want {
		t.Errorf("stdout:\n%s\nwant:\n%s", got, want)
	}
	if stderr.Len() != 0 {
		t.Errorf("stderr = %q", stderr.String())
	}
}

func TestRunUsage(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := run(context.Background(), nil, &stdout, &stderr); code != 2 {
		t.Errorf("exit code = %d, want 2", code)
	}
	if !strings.Contains(stderr.String(), "用法") {
		t.Errorf("stderr = %q", stderr.String())
	}
}
```

输出比较长、经常变的时候，可以改用**黄金文件**（golden file）：把期望输出存在 `testdata/xxx.golden`，测试时比较；加一个 `-update` 开关，输出确实该变时重新生成。`testdata` 目录会被 Go 工具链忽略，专门放测试数据，相当于 Jest 的 snapshot。

## 测试 HTTP handler：httptest

第 7 章的 handler 依赖 `Store` 接口。测试时写一个内存实现，用 `httptest.NewServer` 起一个真实的 HTTP 服务器（监听本机随机端口）。

完整的测试文件分 4 段给出，从上到下拼起来就是一个 `_test.go` 文件。第一段是导入、内存版 `memStore` 和它的 `List` 方法：

```go
package entry

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// memStore 是测试用的内存实现，只认识 storeID = 1 这一家店。
type memStore struct {
	mu   sync.Mutex
	list []Entry
}

func (s *memStore) List(_ context.Context, storeID int64, limit int) ([]Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []Entry
	for i := len(s.list) - 1; i >= 0 && len(out) < limit; i-- {
		if s.list[i].StoreID == storeID {
			out = append(out, s.list[i])
		}
	}
	return out, nil
}
```

第二段是 `memStore` 的 `Create`（只认 1 号店，其他门店返回 `ErrStoreNotFound`），以及起测试服务器的辅助函数 `newTestServer`：

```go
func (s *memStore) Create(_ context.Context, storeID int64, n NewEntry) (Entry, error) {
	if storeID != 1 {
		return Entry{}, ErrStoreNotFound
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	e := Entry{
		ID: int64(len(s.list) + 1), StoreID: storeID, AmountFen: n.AmountFen,
		Note: n.Note, CreatedAt: time.Date(2026, 11, 4, 9, 0, 0, 0, time.UTC),
	}
	s.list = append(s.list, e)
	return e, nil
}

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	NewHandler(&memStore{}, slog.New(slog.DiscardHandler)).Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}
```

第三段是第一个测试：先 POST 创建一条记录，再 GET 列表，检查读回来的内容：

```go
func TestCreateAndList(t *testing.T) {
	srv := newTestServer(t)

	resp, err := http.Post(srv.URL+"/stores/1/entries", "application/json",
		strings.NewReader(`{"amountFen": 1250, "note": "午餐"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d, body = %s", resp.StatusCode, body)
	}

	resp2, err := http.Get(srv.URL + "/stores/1/entries")
	if err != nil {
		t.Fatal(err)
	}
	defer resp2.Body.Close()
	var got []Entry
	if err := json.NewDecoder(resp2.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].AmountFen != 1250 || got[0].Note != "午餐" {
		t.Errorf("list = %+v", got)
	}
}
```

第四段用表格驱动测试覆盖各种错误输入，每种情况检查返回的状态码：

```go
func TestCreateErrors(t *testing.T) {
	srv := newTestServer(t)
	tests := []struct {
		name   string
		path   string
		body   string
		status int
	}{
		{"非法 JSON", "/stores/1/entries", `{`, http.StatusBadRequest},
		{"未知字段", "/stores/1/entries", `{"amount": 1}`, http.StatusBadRequest},
		{"金额为 0", "/stores/1/entries", `{"amountFen": 0}`, http.StatusUnprocessableEntity},
		{"门店不存在", "/stores/2/entries", `{"amountFen": 100}`, http.StatusNotFound},
		{"storeID 不是数字", "/stores/abc/entries", `{"amountFen": 100}`, http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp, err := http.Post(srv.URL+tt.path, "application/json", strings.NewReader(tt.body))
			if err != nil {
				t.Fatal(err)
			}
			resp.Body.Close()
			if resp.StatusCode != tt.status {
				t.Errorf("status = %d, want %d", resp.StatusCode, tt.status)
			}
		})
	}
}
```

几点：

- 内存实现就是 mock，但它是一个**真正能工作的实现**，不需要 mock 框架录制「第几次调用返回什么」。这得益于接口小、定义在使用方
- 这个测试走的是真实的路由、真实的 JSON 编解码、真实的 HTTP 连接，比直接调用 handler 函数更接近生产
- 只想测单个 handler、不想起服务器时，用 `httptest.NewRecorder()` 当 `ResponseWriter`，`httptest.NewRequest` 造请求，直接调用 `mux.ServeHTTP(rec, req)`

## 集成测试：真的 Postgres

内存实现测不到 SQL 本身。SQL 要用真的 Postgres 测，常见做法是用环境变量控制，没有数据库时跳过：

```go
func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("未设置 TEST_DATABASE_URL，跳过数据库测试")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}
```

本地用 `docker compose` 起一个测试库，CI 里用 service container。每个测试在事务里跑、结束时回滚，或者每个测试用独立的 schema，互不干扰。想在测试代码里自动拉起容器，可以用 testcontainers-go，和 Node 版的 testcontainers 是同一个项目。

## 覆盖率

```bash
go test -cover ./...
```

```text
ok  	github.com/jarvis/shelfcheck/cmd/shelfcheck	0.465s	coverage: 73.8% of statements
ok  	github.com/jarvis/shelfcheck/internal/book	0.976s	coverage: 79.2% of statements
```

```bash
go test -coverprofile=cover.out ./...
go tool cover -html=cover.out        # 浏览器里逐行看哪些没覆盖
```

覆盖率是找漏测分支的工具，不是目标。Go 社区一般不设覆盖率门槛。

## 测试和时间有关的代码：synctest

> [!WARNING]
> `testing/synctest` 在 Go 1.24 是实验特性（需要 `GOEXPERIMENT=synctest`），Go 1.25 正式发布，API 也有调整（1.25 起是 `synctest.Test`）。以 `testing/synctest` 包文档为准。

重试、超时、定时任务这类代码，测试时最怕真的等。`testing/synctest` 让测试在一个「气泡」里运行，气泡里的时间是假的：当气泡里所有 goroutine 都在等待时，时间直接快进到下一个计时器到期。

被测的是一个指数退避重试函数：

```go
// Package retry 按指数退避重试一个操作。
package retry

import (
	"context"
	"time"
)

// Do 最多尝试 attempts 次，第 n 次失败后等待 base * 2^(n-1)。
func Do(ctx context.Context, attempts int, base time.Duration, op func() error) error {
	var err error
	for i := range attempts {
		if err = op(); err == nil {
			return nil
		}
		if i == attempts-1 {
			break
		}
		select {
		case <-time.After(base << i):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return err
}
```

```go
package retry

import (
	"context"
	"errors"
	"testing"
	"testing/synctest"
	"time"
)

func TestDoBackoff(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		start := time.Now() // 气泡里的时间是假的，从固定的起点开始
		calls := 0
		err := Do(context.Background(), 4, time.Second, func() error {
			calls++
			return errors.New("busy")
		})
		if err == nil || calls != 4 {
			t.Fatalf("err = %v, calls = %d", err, calls)
		}
		// 等待了 1s + 2s + 4s，但测试实际上瞬间跑完
		if got := time.Since(start); got != 7*time.Second {
			t.Errorf("elapsed = %v, want 7s", got)
		}
	})
}
```

这个测试断言「总共等了正好 7 秒」，实际运行耗时为 0。相当于 Jest 的 `useFakeTimers`，但不需要手动 `advanceTimersByTime`，也不用改被测代码。

## 基准测试

基准测试函数以 `Benchmark` 开头，参数是 `*testing.B`：

> [!WARNING]
> `b.Loop()` 是 Go 1.24 加入的写法，更老的版本写 `for i := 0; i < b.N; i++`。以 `testing` 包文档为准。

```go
func BenchmarkLintChapter(b *testing.B) {
	var sb strings.Builder
	sb.WriteString("# 标题\n")
	for range 500 {
		// 模拟一章的常见比例：大部分是正文，偶尔有图和代码块
		sb.WriteString("一段正文，带 `code` 和**加粗**。\n\n另一段正文。\n\n")
		sb.WriteString("![图](assets/flow.svg)\n\n```go\nx := 1\n```\n")
	}
	text := sb.String()
	assets := map[string]bool{"assets/flow.svg": true}

	b.ReportAllocs()
	for b.Loop() { // 循环外的准备工作不计入耗时
		LintChapter("a.md", text, assets)
	}
}
```

```bash
go test -run '^$' -bench . -benchmem ./internal/book
```

`-run '^$'` 表示不跑普通测试，只跑基准。`go test` 会自动调整循环次数，直到结果稳定，输出每次操作的耗时、分配的字节数和分配次数。

### 用 pprof 找热点

先看时间花在哪：

```bash
go test -run '^$' -bench . -cpuprofile cpu.out ./internal/book
go tool pprof -top -nodecount=8 book.test cpu.out
```

```text
      flat  flat%   sum%        cum   cum%
     180ms 18.00% 18.00%      370ms 37.00%  regexp.(*Regexp).tryBacktrack
      90ms  9.00% 27.00%       90ms  9.00%  regexp.(*bitState).shouldVisit (inline)
      50ms  5.00% 32.00%       50ms  5.00%  runtime.madvise
      40ms  4.00% 36.00%       40ms  4.00%  internal/bytealg.IndexByteString
      40ms  4.00% 40.00%       70ms  7.00%  regexp.(*bitState).reset
```

大部分时间在正则里。看一下 `LintChapter`：**每一行**都跑了围栏正则，**每一行**都跑了去行内代码和找图片两个正则。但绝大多数行既不是围栏也没有图片。优化就是先用廉价的字符串判断过滤：

```go
// matchFence 先用廉价的前缀判断过滤掉普通行，只有像围栏的行才跑正则。
func matchFence(line string) []string {
	t := strings.TrimLeft(line, " ")
	if !strings.HasPrefix(t, "```") && !strings.HasPrefix(t, "~~~") {
		return nil
	}
	return fenceRe.FindStringSubmatch(line)
}
```

循环里把 `fenceRe.FindStringSubmatch(line)` 换成 `matchFence(line)`，并在找图片之前加一行：

```go
		if !strings.Contains(line, "![") {
			continue // 绝大多数行没有图片，跳过两次正则
		}
```

### 用 benchstat 比较

一次基准的结果有噪声，不能拿单次数字比。正确做法是改动前后各跑多次，用 benchstat 做统计比较（第 2 章用 `go get -tool` 装过）：

```bash
go test -run '^$' -bench . -benchmem -count 8 ./internal/book > old.txt
# 修改代码
go test -run '^$' -bench . -benchmem -count 8 ./internal/book > new.txt
go tool benchstat old.txt new.txt
```

`benchstat` 的原始输出是一张带框线的宽表，在手机上放不下，这里整理成三行（`LintChapter-12`，各跑 8 次）：

| 指标 | 改动前 | 改动后 | 变化 |
|---|---|---|---|
| 耗时 sec/op | 1.733m ± 16% | 1.145m ± 17% | −33.89%（p=0.000） |
| 内存 B/op | 484.9Ki ± 0% | 363.0Ki ± 0% | −25.14%（p=0.000） |
| 分配 allocs/op | 10.005k ± 0% | 5.001k ± 0% | −50.01%（p=0.000） |

时间少了约三分之一，分配次数减半。`p=0.000` 表示差异在统计上显著；`± 16%` 说明这台机器跑基准时并不安静（同时在跑别的东西），绝对数字参考意义有限，但前后对比依然可信。如果 benchstat 显示 `~`，意思是「看不出差别」，那这次优化就不值得留。

这个优化值不值得做？对一个检查一百本书只要 0.03 秒的工具来说，其实不值得。这里演示的是方法：**先有基准，再看 profile，改完用统计比较**，而不是凭感觉改。

## 模糊测试

模糊测试让 Go 自动生成大量随机输入，寻找让代码 panic 或违反断言的情况。对解析器、校验器这种「输入来自外部」的代码特别有用：

```go
func FuzzLintChapter(f *testing.F) {
	f.Add("# 标题\n```go\nx\n```\n") // 种子语料
	f.Add("![x](assets/a.png)")
	f.Fuzz(func(t *testing.T, text string) {
		for _, p := range LintChapter("a.md", text, nil) {
			if p.File != "a.md" {
				t.Fatalf("bad file %q", p.File)
			}
			if p.Line < 0 || p.Line > strings.Count(text, "\n")+1 {
				t.Fatalf("line %d out of range", p.Line)
			}
		}
	})
}
```

```bash
go test -run '^$' -fuzz FuzzLintChapter -fuzztime 30s ./internal/book
```

```text
fuzz: elapsed: 5s, execs: 1539895 (265088/sec), new interesting: 200 (total: 202)
PASS
```

5 秒跑了一百五十多万个输入，没有发现问题。发现问题时，触发失败的输入会被存进 `testdata/fuzz/FuzzLintChapter/`，之后每次普通的 `go test` 都会带上它作为回归用例。

不加 `-fuzz` 时，`go test` 只用种子语料跑一遍 Fuzz 函数，所以它同时也是一个普通的单元测试。

## 本章要点

- 测试全部内置：`go test` 运行、`testing` 包写；比较用 `if`，失败用 `t.Errorf`（继续）或 `t.Fatalf`（停止）
- 表驱动测试 + `t.Run` 子测试是 Go 测试的标准形式；`t.TempDir`、`t.Cleanup`、`t.Helper` 覆盖大部分辅助需求
- 接受接口的代码好测：`fs.FS` 配 `fstest.MapFS`，`Store` 接口配内存实现，`run` 配 `bytes.Buffer`
- `httptest.NewServer` 走真实路由和连接；SQL 用真 Postgres 测，没有数据库时 `t.Skip`
- 1.25 起用 `testing/synctest` 测和时间有关的代码，假时钟自动快进
- 基准用 `b.Loop()`（1.24 起）；先 pprof 找热点，改完用 benchstat 做统计比较
- 模糊测试适合解析器和校验器，发现的问题自动变成回归用例
