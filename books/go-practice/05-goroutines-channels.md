# goroutine 与 channel

这是 Go 和 Node 差别最大的一章。Node 只有一个 JS 线程，并发靠事件循环：所有 I/O 都是非阻塞的，你用 `async/await` 告诉运行时「这里要等，先去干别的」。Go 反过来：**代码写成阻塞的样子**，`os.ReadFile`、`http.Get`、`db.Query` 都是同步调用；并发靠同时跑很多个 goroutine，由运行时把它们调度到多个 CPU 核上。

结果是两件事同时成立：Go 没有「函数颜色」问题（不存在 async 函数传染），而且能真正用上多核；但你也要面对 Node 开发者很少碰到的东西：**数据竞争**。

## goroutine：便宜的线程

在函数调用前加 `go`，它就在一个新的 goroutine 里运行：

```go
package main

import (
	"fmt"
	"time"
)

func say(msg string) {
	for i := range 3 {
		fmt.Println(msg, i)
		time.Sleep(10 * time.Millisecond)
	}
}

func main() {
	go say("后台") // 立刻返回，say 在另一个 goroutine 里跑
	say("前台")
	// main 返回时整个进程退出，不会等其他 goroutine
}
```

goroutine 不是操作系统线程。它初始只占几 KB 的栈（按需增长），创建和切换的开销很小，一个进程里跑十万个 goroutine 是正常的。Go 运行时用 M:N 调度：把大量 goroutine 分配到少量系统线程上，线程数默认等于 CPU 核数（`GOMAXPROCS`）。

当一个 goroutine 做阻塞 I/O（读网络、读文件、等 channel）时，调度器把它挂起，让同一个线程去跑别的 goroutine。网络 I/O 底层用的也是 epoll / kqueue，和 libuv 是同一套机制，只是被藏在了同步 API 后面。

```mermaid
flowchart TD
  subgraph Node
    A[一个 JS 线程] --> B[事件循环]
    B --> C[libuv 处理 I/O]
  end
  subgraph Go
    D[很多 goroutine] --> E[调度器]
    E --> F[N 个系统线程]
    F --> G[N 个 CPU 核]
  end
```

对照 Node 的说法：

| Node | Go |
|---|---|
| 一个 JS 线程，CPU 密集任务会卡住所有请求 | 多个线程，一个 goroutine 算得慢不影响别的 |
| `async` 函数会传染调用链 | 没有 async，函数都是普通函数 |
| 需要多核时开 worker_threads 或 cluster | 默认用满所有核 |
| 共享变量天然安全（同一时刻只有一段 JS 在跑） | 共享变量**需要同步**，否则数据竞争 |

> [!WARNING]
> Go 1.25 起，Linux 上的 `GOMAXPROCS` 默认会参考容器的 CPU 限额（cgroup），不再直接等于宿主机核数；更早的版本在容器里常需要 `go.uber.org/automaxprocs`。以 [go.dev/doc/go1.25](https://go.dev/doc/go1.25) 和 `runtime` 包文档为准。

### G、M、P：调度器里的三个角色

> [!WARNING]
> 下面的本地队列长度 256、偷一半、sysmon 何时收回 P、多久检查一次全局队列，都是 runtime 的实现细节，不属于语言规范，不同 Go 版本可能调整，以对应版本的 `runtime/proc.go` 源码注释为准，背景可看 [Go 1.1 调度器设计文档](https://golang.org/s/go11sched)。

上面说「M:N 调度」，具体由三种对象配合完成，名字取自 runtime 源码（`runtime/proc.go` 开头的注释）：

- **G**（goroutine）：一个待执行的函数加上它自己的栈和状态。`go f()` 就是新建一个 G
- **M**（machine）：一个操作系统线程，真正在 CPU 上跑代码的是它
- **P**（processor）：执行 Go 代码的「许可」，数量就是 `GOMAXPROCS`。**M 必须持有一个 P 才能运行 G**；M 在系统调用里阻塞时可以不持有 P

所以前面那句「线程数默认等于 CPU 核数」更准确的说法是：**同时在跑 Go 代码的线程**最多 `GOMAXPROCS` 个，进程里的线程总数可以更多。

为什么要多一个 P？Go 1.1 之前只有 G 和 M，所有 goroutine 放在一个全局队列里，每次取任务都要抢同一把锁，核数一多就成了瓶颈。P 把可运行的 G 分散到每个 P 自己的本地队列（源码里是长 256 的环形缓冲），内存分配缓存等资源也挂在 P 上，绝大多数调度不需要全局锁。全局队列仍然保留，用来放溢出的 G，各个 P 会定期查看它，避免里面的 G 饿死。

两种情况最能看出 P 的作用：

- **阻塞系统调用**：G 发起一个会卡住线程的系统调用（比如读普通文件、调用 cgo），它所在的 M 跟着卡住。运行时的监控线程 sysmon 发现这个 P 卡在系统调用里超过一小段时间，就把 P 从这个 M 上拿走，交给一个空闲的或新建的 M，P 队列里的其他 G 继续跑。系统调用返回后，原来的 M 要重新找一个空闲 P，找不到就把 G 放回全局队列、自己休眠。网络 I/O 不走这条路：它由 netpoller（epoll / kqueue）处理，G 被挂起，M 不阻塞
- **work stealing**：一个 P 的本地队列空了，它会依次看全局队列、netpoller，再随机挑一个别的 P，**偷走对方本地队列里的一半 G**。这样不需要中央分配，负载也能自动摊平

下图把这几种状态画在一起：

![三个 P 各持有一个 M：P0 的本地队列有四个 G，空闲的 P1 从中偷走一半；P2 原来的 M2 带着 G2 阻塞在系统调用里，P2 被交给新的 M3 继续运行；全局队列由所有 P 共享。](assets/gmp-scheduler.svg)

## 等待一组 goroutine：WaitGroup

上面的例子里 `main` 不会等后台 goroutine。要等一组 goroutine 结束，用 `sync.WaitGroup`：

> [!WARNING]
> `wg.Go(f)` 是 Go 1.25 加入的写法。更老的版本要手动 `wg.Add(1)`、在 goroutine 里 `defer wg.Done()`。以 `sync` 包文档为准。

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

func main() {
	books := []string{"go-practice", "rust-practice", "python-for-ai"}
	var wg sync.WaitGroup
	for _, id := range books {
		wg.Go(func() { // 1.25 起；老写法是 wg.Add(1) + defer wg.Done()
			time.Sleep(20 * time.Millisecond) // 模拟一次 I/O
			fmt.Println("checked", id)
		})
	}
	wg.Wait() // 阻塞到所有 goroutine 结束
	fmt.Println("all done")
}
```

闭包里直接用了循环变量 `id`。Go 1.22 起每次迭代都有独立的 `id`，这样写是安全的；1.22 之前所有 goroutine 共享同一个变量，会打印出三次最后一个值，这是当年最著名的 Go 坑。如果你在老代码里看到 `id := id` 这一行，就是在绕这个坑，新代码里不需要了。

## 数据竞争与 -race

多个 goroutine 同时读写同一个变量，且至少有一个在写，就是数据竞争。结果不可预测：

```go
package main

import (
	"fmt"
	"sync"
)

func main() {
	count := 0
	var wg sync.WaitGroup
	for range 1000 {
		wg.Go(func() {
			count++ // 多个 goroutine 同时读改写同一个变量
		})
	}
	wg.Wait()
	fmt.Println(count)
}
```

我连续跑了两次，分别输出 `978` 和 `957`，没有一次是 1000。`count++` 是「读、加一、写回」三步，两个 goroutine 交错执行就会丢掉一次加法。

Go 自带竞争检测器，加 `-race` 运行就能抓到：

```bash
go run -race main.go
```

```text
==================
WARNING: DATA RACE
Read at 0x00c000012148 by goroutine 11:
  main.main.func1()
      /private/tmp/race/main.go:13 +0x2c

Previous write at 0x00c000012148 by goroutine 7:
  main.main.func1()
      /private/tmp/race/main.go:13 +0x3c
```

`-race` 会让程序慢几倍、内存多用几倍，所以只在测试和开发时开：**`go test -race ./...` 应该是你 CI 的默认命令**。它只能发现实际执行到的竞争，测试覆盖不到的路径它也看不见。

修复有三种方式，按推荐顺序：不共享（每个 goroutine 写自己的那一份）、用 channel 传递、用锁保护。

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

func main() {
	var wg sync.WaitGroup

	// 方式一：锁
	var mu sync.Mutex
	count := 0
	for range 1000 {
		wg.Go(func() {
			mu.Lock()
			count++
			mu.Unlock()
		})
	}

	// 方式二：原子操作，只适合单个计数器这类简单值
	var hits atomic.Int64
	for range 1000 {
		wg.Go(func() { hits.Add(1) })
	}

	wg.Wait()
	fmt.Println(count, hits.Load()) // 1000 1000
}
```

`sync.Mutex` 的零值就能用，不需要初始化。读多写少时用 `sync.RWMutex`。锁要保护的数据和锁本身放在同一个结构体里，旁边写清楚「mu 保护哪些字段」。

## channel：goroutine 之间传数据

channel 是带类型的管道，一端发送、一端接收：

```go
package main

import "fmt"

func main() {
	ch := make(chan int) // 无缓冲：发送方会阻塞，直到接收方取走

	go func() {
		for i := range 3 {
			ch <- i * i // 发送
		}
		close(ch) // 发送方负责关闭，告诉接收方「没有了」
	}()

	for v := range ch { // 一直接收，直到 channel 被关闭
		fmt.Println(v)
	}

	buf := make(chan string, 2) // 有缓冲：缓冲区没满时发送不阻塞
	buf <- "a"
	buf <- "b"
	fmt.Println(<-buf, <-buf, len(buf))

	v, ok := <-ch // 从已关闭的 channel 接收：立即返回零值和 false
	fmt.Println(v, ok)
}
```

几条规则，记住就不会出错：

| 操作 | nil channel | 已关闭的 channel |
|---|---|---|
| 发送 `ch <- v` | 永远阻塞 | **panic** |
| 接收 `<-ch` | 永远阻塞 | 立即返回零值，`ok` 为 false |
| 关闭 `close(ch)` | **panic** | **panic** |

由此得出约定：**只有发送方关闭 channel**，而且只关一次；有多个发送方时，由等它们全部结束的那一方来关。接收方永远不要关。

函数签名里可以限定方向：`chan<- int` 只能发，`<-chan int` 只能收，编译器会检查。

## select：同时等多个 channel

`select` 等待多个 channel 操作中的任意一个就绪，相当于 `Promise.race`，但可以反复用：

```go
package main

import (
	"fmt"
	"time"
)

func main() {
	results := make(chan string)
	go func() {
		time.Sleep(50 * time.Millisecond)
		results <- "识别完成"
	}()

	select {
	case r := <-results:
		fmt.Println(r)
	case <-time.After(30 * time.Millisecond): // 超时
		fmt.Println("超时，放弃")
	}

	ticker := time.NewTicker(10 * time.Millisecond) // 相当于 setInterval
	defer ticker.Stop()
	deadline := time.After(35 * time.Millisecond)
	for {
		select {
		case <-ticker.C:
			fmt.Println("tick")
		case <-deadline:
			fmt.Println("stop")
			return
		}
	}
}
```

带 `default` 分支的 `select` 不会阻塞，可以用来「试着发一下，发不出去就算了」。

上面第一段有一个隐患：超时之后没人再从 `results` 接收，后台 goroutine 会永远阻塞在发送上，这就是 **goroutine 泄漏**。修法是把 `results` 建成 `make(chan string, 1)`，让那一次发送不需要接收方。更通用的办法是第 6 章的 context。

## 常用并发模式

### 对照表

| TS / Node | Go |
|---|---|
| `await Promise.all(tasks)` | `errgroup.Group`：`g.Go(...)` 后 `g.Wait()` |
| `Promise.all` + `p-limit(4)` | `g.SetLimit(4)`，或用容量为 4 的 channel 当信号量 |
| `Promise.allSettled` | `sync.WaitGroup` + 每个任务把错误写进自己的槽位 |
| `Promise.race` / `AbortSignal.timeout` | `select` + `time.After`，或 `context.WithTimeout` |
| `setTimeout(fn, ms)` | `time.AfterFunc(d, fn)` |
| `setInterval` | `time.NewTicker(d)` |
| `EventEmitter` 推消息 | channel |
| BullMQ 之类的队列 + worker | channel + 固定数量的 worker goroutine（进程内） |

### errgroup：带错误的 Promise.all

`golang.org/x/sync/errgroup` 是 Go 团队维护的扩展库，几乎是并发代码的标配：

```bash
go get golang.org/x/sync
```

它在 `WaitGroup` 之上加了三样东西：收集第一个错误、出错时取消其余任务（配合 context）、限制并发数。下面这个例子并发计算 hatch-shelf 仓库 `books/` 下每本书的内容哈希，相当于 `shelf-pack` 判断一本书是否需要重新推送时做的事：

```go
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/sync/errgroup"
)

// hashBook 把一本书目录下所有文件按路径顺序喂给 SHA-256
func hashBook(ctx context.Context, dir string) (string, error) {
	h := sha256.New()
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		if err := ctx.Err(); err != nil { // 别的书出错了，尽早停下
			return err
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		io.WriteString(h, path)
		_, err = io.Copy(h, f)
		return err
	})
	if err != nil {
		return "", fmt.Errorf("hash %s: %w", dir, err)
	}
	return hex.EncodeToString(h.Sum(nil))[:12], nil
}

func main() {
	jobs := flag.Int("j", 8, "并发数")
	flag.Parse()
	root := flag.Arg(0)

	entries, err := os.ReadDir(root)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	var dirs []string
	for _, e := range entries {
		if e.IsDir() {
			dirs = append(dirs, filepath.Join(root, e.Name()))
		}
	}

	start := time.Now()
	sums := make([]string, len(dirs)) // 每个 goroutine 只写自己的下标，不需要加锁
	g, ctx := errgroup.WithContext(context.Background())
	g.SetLimit(*jobs)
	for i, dir := range dirs {
		g.Go(func() error {
			sum, err := hashBook(ctx, dir)
			sums[i] = sum
			return err
		})
	}
	if err := g.Wait(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	for i := range 3 {
		fmt.Println(sums[i], filepath.Base(dirs[i]))
	}
	fmt.Printf("%d 本书，并发 %d，用时 %v\n", len(dirs), *jobs, time.Since(start).Round(time.Millisecond))
}
```

注意 `sums[i] = sum` 这一行：多个 goroutine 同时写同一个切片，但**每个只写自己的下标**，互不重叠，所以不是数据竞争，也不需要锁。这是「不共享」原则最常用的形式：结果按下标放好，顺序天然和输入一致。

在我的机器上（Apple M3 Pro，12 核，`books/` 约 60 MB、近百本书，文件都已在系统缓存里），每种并发数各跑 7 次取中位数：

![并发数为 1、2、4、8、12 时哈希全部书籍的用时中位数分别是 59、33、20、20、21 毫秒，并发 4 之后不再变快。](assets/hash-concurrency.svg)

从 1 到 4 几乎线性变快，之后就平了：瓶颈从 CPU 计算哈希转到了内存带宽和文件系统调用上。并发数不是越大越好，**测一下再定**；对 I/O 密集的任务，合理的默认值通常是 CPU 核数附近。

### worker pool

errgroup 适合「一批任务、全部做完」。如果任务是源源不断进来的（比如一个常驻进程从队列里取任务），用固定数量的 worker 从 channel 里取：

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

type Job struct{ StoreID int }
type Result struct {
	StoreID int
	Msg     string
}

func worker(id int, jobs <-chan Job, results chan<- Result) {
	for j := range jobs { // jobs 被关闭且取空后，循环结束
		time.Sleep(10 * time.Millisecond) // 模拟一次导出
		results <- Result{j.StoreID, fmt.Sprintf("worker %d 导出完成", id)}
	}
}

func main() {
	jobs := make(chan Job)
	results := make(chan Result)

	var wg sync.WaitGroup
	for w := range 3 { // 3 个 worker
		wg.Go(func() { worker(w, jobs, results) })
	}

	go func() { // 生产者：发完就关闭 jobs
		for id := range 7 {
			jobs <- Job{StoreID: id + 1}
		}
		close(jobs)
	}()

	go func() { // 所有 worker 结束后关闭 results，让下面的 range 退出
		wg.Wait()
		close(results)
	}()

	n := 0
	for r := range results {
		n++
		_ = r
	}
	fmt.Println("完成", n, "家店")
}
```

这段代码里三个 channel 的关闭时机是整个模式的关键：生产者发完关 `jobs`；worker 发现 `jobs` 关了就退出；最后一个 worker 退出后关 `results`；主 goroutine 的 `range results` 随之结束。任何一环少了，程序就会卡死，Go 运行时发现所有 goroutine 都在等时会报 `fatal error: all goroutines are asleep - deadlock!`。

这就是[《软件架构与系统设计》](../system-design/04-queues-jobs.md)里「进程内队列」那一档在 Go 里的样子：几十行，不需要任何依赖。和 Node 版一样，进程重启时队列就没了，需要可靠时状态要落库。

## channel 还是锁

Go 有一句口号：「不要通过共享内存来通信，而要通过通信来共享内存」。但这不是说锁不好。实用的判断：

| 场景 | 用什么 |
|---|---|
| 把数据或任务的**所有权**交给另一个 goroutine | channel |
| 通知「完成了」「该停了」 | channel 或 context |
| 多个 goroutine 读写一份**共享状态**（缓存、计数器、连接表） | `sync.Mutex` |
| 一批任务并发跑完、收集错误 | errgroup |
| 只初始化一次 | `sync.Once`、`sync.OnceValue` |

一个缓存 map 用锁保护十行就写完了，硬改成「一个 goroutine 持有 map、其他人通过 channel 发请求」反而更复杂、更慢。

## 自己起的 goroutine 要负责到底

最后两条纪律，违反它们的代码迟早出问题：

1. **每个 goroutine 都要有明确的退出条件**。启动它之前先想好：它什么时候结束？谁在等它？如果答案是「不知道」，那它就是一个潜在的泄漏
2. **goroutine 里的 panic 要自己兜住**。`net/http` 会 recover 每个请求的 panic，但你自己 `go func()` 起的 goroutine 里 panic 会直接让整个进程崩溃。长期运行的后台 goroutine，入口处加一个 `defer` + `recover` 记日志

第 1 条的标准工具是 context，下一章讲。

## 本章要点

- goroutine 是运行时调度的轻量线程，代码写成阻塞的样子，调度器负责并发，默认用满所有核
- `main` 返回时进程退出，不等其他 goroutine；用 `sync.WaitGroup`（1.25 起有 `wg.Go`）或 errgroup 等待
- 1.22 起循环变量每次迭代独立，闭包里直接用是安全的
- 共享变量必须同步，`go test -race` 是 CI 的默认命令；优先不共享，其次 channel，再次锁
- 只有发送方关闭 channel；向已关闭的 channel 发送会 panic；`select` + `time.After` 做超时
- errgroup 是带错误和并发限制的 `Promise.all`；并发数测过再定，不是越大越好
- 每个 goroutine 要有退出条件，否则就是泄漏；自己起的 goroutine 要自己 recover
