# 用标准库 net/http 写服务

Node 写 HTTP 服务，第一步通常是选框架：Express、Fastify、NestJS。Go 的标准库 `net/http` 本身就是一个生产级的 HTTP 服务器，Go 1.22 给路由加上了方法匹配和路径参数之后，**一个小服务完全不需要框架**。

这一章用标准库加 pgx（Postgres 驱动）写一个简化版的记账服务：hatch-counter 里「门店流水」的两个接口，一个列出、一个新增。重点不是业务，而是一个 Go 服务该有的骨架：路由、JSON、数据库连接池、中间件、日志、超时和优雅退出。

## 什么时候在 hatch-counter 旁边放一个 Go 服务

先说清楚定位。hatch-counter 的主后端是 NestJS，没必要改写。但有几类东西适合拆成一个独立的小 Go 进程，和 NestJS 共用同一个 Postgres：

- **对外的高频只读接口**：比如给门店小票打印机、收银机轮询的接口，请求量大、逻辑简单，Go 进程常驻内存只要十几 MB
- **数据导出、对账、体检这类批处理**：一个二进制文件加一条 cron，或者第 6 章那样的常驻 worker
- **运维小工具**：健康检查聚合、备份校验

共享数据库时有一条规矩：**表结构只由一方负责迁移**。hatch-counter 用 Drizzle 管理迁移，Go 服务就只读写已有的表，不自己建表、不改表。

## 项目结构

```text
counter-lite/
├── go.mod
├── cmd/server/main.go        # 入口：配置、连接池、路由、中间件、优雅退出
└── internal/entry/
    ├── entry.go              # 类型和 Store 接口
    ├── pg.go                 # Postgres 实现
    ├── handler.go            # HTTP handler
    └── handler_test.go       # 第 9 章
```

```bash
go mod init github.com/jarvis/counter-lite
go get github.com/jackc/pgx/v5
```

用到的表（由 hatch-counter 的迁移创建，这里只是为了说明字段）：

```sql
CREATE TABLE stores (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text   NOT NULL,
  balance_fen bigint NOT NULL DEFAULT 0
);

CREATE TABLE entries (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_id   bigint      NOT NULL REFERENCES stores (id),
  amount_fen bigint      NOT NULL,
  note       text        NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entries_store_created_idx ON entries (store_id, created_at DESC);
```

## 类型与接口

```go
// Package entry 是记账流水：一家店的一笔收入或支出。
package entry

import (
	"context"
	"errors"
	"time"
)

type Entry struct {
	ID        int64     `json:"id"`
	StoreID   int64     `json:"storeId"`
	AmountFen int64     `json:"amountFen"` // 金额用整数分，不用浮点
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"createdAt"`
}

type NewEntry struct {
	AmountFen int64  `json:"amountFen"`
	Note      string `json:"note"`
}

func (n NewEntry) Validate() error {
	if n.AmountFen == 0 {
		return errors.New("amountFen 不能为 0")
	}
	if len([]rune(n.Note)) > 200 {
		return errors.New("note 不超过 200 字")
	}
	return nil
}

var ErrStoreNotFound = errors.New("store not found")

// Store 是 handler 依赖的存储接口，生产用 Postgres，测试用内存实现。
type Store interface {
	List(ctx context.Context, storeID int64, limit int) ([]Entry, error)
	Create(ctx context.Context, storeID int64, n NewEntry) (Entry, error)
}
```

`Store` 接口定义在 handler 所在的包里，只有 handler 用到的两个方法。这就是第 3 章说的「接口定义在使用方」：handler 不知道 Postgres 的存在，第 9 章的测试用一个二十行的内存实现就能替换它。

## 连 Postgres：pgx

Go 有一个标准的数据库抽象 `database/sql`，但对 Postgres，社区首选的是 **pgx**：它直接实现 Postgres 协议，支持 `jsonb`、数组、`COPY`、`LISTEN/NOTIFY` 这些 Postgres 特有的东西，自带连接池 `pgxpool`。

> [!WARNING]
> 本章代码基于 pgx **v5.12**。pgx 的大版本之间 API 不兼容（v4 → v5 改动很大），网上的老示例要看清版本。以 [pkg.go.dev/github.com/jackc/pgx/v5](https://pkg.go.dev/github.com/jackc/pgx/v5) 为准。

```go
package entry

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PGStore struct{ pool *pgxpool.Pool }

func NewPGStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }

func (s *PGStore) List(ctx context.Context, storeID int64, limit int) ([]Entry, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, store_id, amount_fen, note, created_at
		FROM entries
		WHERE store_id = $1
		ORDER BY created_at DESC, id DESC
		LIMIT $2`, storeID, limit)
	if err != nil {
		return nil, fmt.Errorf("query entries: %w", err)
	}
	// 按列的顺序填进结构体字段，SELECT 的列序要和字段顺序一致
	list, err := pgx.CollectRows(rows, pgx.RowToStructByPos[Entry])
	if err != nil {
		return nil, fmt.Errorf("scan entries: %w", err)
	}
	return list, nil
}

func (s *PGStore) Create(ctx context.Context, storeID int64, n NewEntry) (Entry, error) {
	var e Entry
	err := s.pool.QueryRow(ctx, `
		INSERT INTO entries (store_id, amount_fen, note)
		VALUES ($1, $2, $3)
		RETURNING id, store_id, amount_fen, note, created_at`,
		storeID, n.AmountFen, n.Note,
	).Scan(&e.ID, &e.StoreID, &e.AmountFen, &e.Note, &e.CreatedAt)

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" { // foreign_key_violation
		return Entry{}, ErrStoreNotFound
	}
	if err != nil {
		return Entry{}, fmt.Errorf("insert entry: %w", err)
	}
	return e, nil
}
```

几点：

- **永远用 `$1` 占位符传参**，不要拼 SQL 字符串。gosec 会抓字符串拼接的 SQL
- `QueryRow(...).Scan(...)` 查不到行时返回 `pgx.ErrNoRows`，用 `errors.Is` 判断
- Postgres 的错误码（`23503` 外键冲突、`23505` 唯一约束冲突）通过 `errors.As` 取出 `*pgconn.PgError` 判断，翻译成业务错误。这就是第 4 章的「存储层把底层错误翻译成哨兵错误」
- `Query` 返回的 `rows` 要么用 `CollectRows` 读完，要么手动 `defer rows.Close()`，否则连接不会还回池子

### 事务

pgx 的 `BeginFunc` 把「开始、提交、出错回滚」包成一个函数，回调返回 error 就回滚，返回 nil 就提交：

```go
func (s *PGStore) CreateWithBalance(ctx context.Context, storeID int64, n NewEntry) (Entry, error) {
	var e Entry
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			INSERT INTO entries (store_id, amount_fen, note)
			VALUES ($1, $2, $3)
			RETURNING id, store_id, amount_fen, note, created_at`,
			storeID, n.AmountFen, n.Note,
		).Scan(&e.ID, &e.StoreID, &e.AmountFen, &e.Note, &e.CreatedAt)
		if err != nil {
			return fmt.Errorf("insert entry: %w", err)
		}
		tag, err := tx.Exec(ctx,
			`UPDATE stores SET balance_fen = balance_fen + $2 WHERE id = $1`,
			storeID, n.AmountFen)
		if err != nil {
			return fmt.Errorf("update balance: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return ErrStoreNotFound // 返回错误，BeginFunc 会回滚
		}
		return nil
	})
	return e, err
}
```

### 要不要 ORM

TS 里你用 Drizzle 获得类型安全的查询。Go 里对应的思路是反过来的：**先写 SQL，再生成 Go 代码**。工具叫 sqlc：你写 `.sql` 文件和带注释的查询，它生成带类型的函数和结构体。查询多起来以后值得引入；只有几条查询时，像上面这样手写就够了。GORM 之类的全功能 ORM 在 Go 社区评价两极，个人项目不推荐。

## handler 与路由

> [!WARNING]
> 在 `ServeMux` 的模式里写 HTTP 方法（`"GET /path"`）和路径参数（`{storeID}`、`r.PathValue`）是 **Go 1.22** 加入的。更老的版本只能匹配路径前缀，方法和参数要自己解析，或者用 chi、gorilla/mux 之类的路由库。以 `net/http` 包文档中 ServeMux 的 Patterns 一节为准。

handler 文件完整代码分 4 段给出，从上到下拼起来就是 `entry` 包里的一个文件。第一段是导入、`Handler` 结构体和构造函数，以及把两个路由挂到 mux 上的 `Register`：

```go
package entry

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
)

type Handler struct {
	store Store
	log   *slog.Logger
}

func NewHandler(store Store, log *slog.Logger) *Handler {
	return &Handler{store: store, log: log}
}

// Register 把路由挂到 mux 上。方法和路径参数写在模式里（Go 1.22+）。
func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /stores/{storeID}/entries", h.list)
	mux.HandleFunc("POST /stores/{storeID}/entries", h.create)
}
```

第二段是 `GET` 路由对应的 `list`：解析路径参数和 `limit` 查询参数，再从 `Store` 取列表：

```go
func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	storeID, err := strconv.ParseInt(r.PathValue("storeID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "storeID 不是数字")
		return
	}
	limit := 50
	if s := r.URL.Query().Get("limit"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > 200 {
			writeError(w, http.StatusBadRequest, "limit 应为 1–200")
			return
		}
		limit = n
	}

	list, err := h.store.List(r.Context(), storeID, limit)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if list == nil {
		list = []Entry{} // 输出 [] 而不是 null
	}
	writeJSON(w, http.StatusOK, list)
}
```

第三段是 `POST` 路由对应的 `create`：限制请求体大小、严格解码 JSON、校验，再写入，门店不存在时返回 404：

```go
func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	storeID, err := strconv.ParseInt(r.PathValue("storeID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "storeID 不是数字")
		return
	}
	var in NewEntry
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "请求体不是合法 JSON："+err.Error())
		return
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	e, err := h.store.Create(r.Context(), storeID, in)
	if errors.Is(err, ErrStoreNotFound) {
		writeError(w, http.StatusNotFound, "门店不存在")
		return
	}
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, e)
}
```

第四段是前两个 handler 共用的小工具：意外错误统一写日志并返回 500，以及写 JSON 和写错误响应：

```go
// fail 处理意料之外的错误：细节写日志，客户端只看到 500。
func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	h.log.ErrorContext(r.Context(), "request failed",
		"method", r.Method, "path", r.URL.Path, "err", err)
	writeError(w, http.StatusInternalServerError, "服务器内部错误")
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
```

和 NestJS 对照着看：

| NestJS | net/http |
|---|---|
| `@Controller` + `@Get(':id')` | `mux.HandleFunc("GET /x/{id}", fn)` |
| `@Param('id', ParseIntPipe)` | `strconv.ParseInt(r.PathValue("id"), 10, 64)` |
| `@Query()` | `r.URL.Query().Get("limit")` |
| `@Body()` + `ValidationPipe` | `json.Decoder` + `Validate()` |
| `throw new NotFoundException()` | `writeError(w, 404, ...)` 然后 `return` |
| 依赖注入 | 构造函数参数，`NewHandler(store, log)` |
| 拦截器、守卫 | 中间件（包一层 `http.Handler`） |

handler 的签名永远是 `func(w http.ResponseWriter, r *http.Request)`：从 `r` 读请求，往 `w` 写响应。**写完错误响应后一定要 `return`**，这是最常见的 bug：忘了 return，代码继续往下走，又写了一次响应。

几个细节：

- `http.MaxBytesReader` 限制请求体大小，防止有人发一个 1 GB 的 body
- `DisallowUnknownFields` 让拼错的字段名报错，而不是被静默忽略
- `nil` 切片序列化成 JSON 是 `null`，前端拿到 `null` 去 `.map` 会崩，所以返回列表时换成空切片
- 方法不匹配时 `ServeMux` 自动返回 405 并带上 `Allow` 头；路径不匹配返回 404。注册了 `GET` 的模式也会响应 `HEAD`

## 中间件

Go 的中间件就是「接收一个 `http.Handler`、返回一个 `http.Handler`」的函数，相当于 Express 的 `app.use`，但没有 `next()` 回调：调用 `next.ServeHTTP(w, r)` 就是继续往下走。

```go
// statusRecorder 记下 handler 写出的状态码，给访问日志用。
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func withLogging(log *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		defer func() {
			if v := recover(); v != nil {
				log.Error("panic", "path", r.URL.Path, "panic", v)
				http.Error(w, "服务器内部错误", http.StatusInternalServerError)
				return
			}
			log.Info("http", "method", r.Method, "path", r.URL.Path,
				"status", rec.status, "dur_ms", time.Since(start).Milliseconds())
		}()
		next.ServeHTTP(rec, r)
	})
}

func withTimeout(next http.Handler, d time.Duration) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), d)
		defer cancel()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
```

`statusRecorder` 用了第 3 章的嵌入：它嵌入了 `http.ResponseWriter`，所以自动拥有 `Header()` 和 `Write()`，只重写了 `WriteHeader` 来记下状态码。

`withTimeout` 给每个请求的 context 加上 10 秒的截止时间，handler 里所有接受 ctx 的调用（数据库查询）到时间都会返回，这是第 6 章那棵 context 树在服务里的落地。

中间件按包裹顺序执行，最外层最先执行：`withTimeout(withLogging(mux))` 的顺序是超时 → 日志 → 路由。

## 日志：slog

> [!WARNING]
> `log/slog` 是 Go 1.21 加入标准库的结构化日志包；`slog.DiscardHandler` 是 1.24 加入的。以 `log/slog` 包文档为准。

Go 1.21 起标准库自带结构化日志 `log/slog`，输出 JSON 只要一行配置，对应 Node 的 pino：

```go
log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
log.Info("http", "method", "GET", "path", "/stores/1/entries", "status", 200, "dur_ms", 3)
```

```text
{"time":"2026-11-04T15:30:32.401+08:00","level":"INFO","msg":"http","method":"GET","path":"/stores/1/entries","status":200,"dur_ms":3}
```

键值对交替传入，或者用 `slog.Int("status", 200)` 这类强类型写法避免成对写错。日志写到 stdout，由 Docker 或 journald 收集，见[《Linux 运维基础》的日志一章](../linux-essentials/05-journald-logs.md)。

## 入口：配置、连接池与优雅退出

入口文件 `main` 包完整代码分 4 段给出，从上到下拼起来就是整个文件（上一节的中间件除外）。第一段是导入和只负责调用 `run` 的 `main`：

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jarvis/counter-lite/internal/entry"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(log); err != nil {
		log.Error("server exited", "err", err)
		os.Exit(1)
	}
}
```

第二段是 `run` 的开头：监听退出信号，读环境变量，建连接池并在启动时 `Ping` 一次：

```go
func run(log *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return errors.New("缺少环境变量 DATABASE_URL")
	}
	addr := ":" + envOr("PORT", "8080")

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return fmt.Errorf("连接池配置有误: %w", err)
	}
	defer pool.Close()

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		return fmt.Errorf("连不上数据库: %w", err)
	}
```

第三段注册健康检查和业务路由，再创建设好各项超时的 `http.Server`：

```go
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := pool.Ping(r.Context()); err != nil {
			http.Error(w, "db down", http.StatusServiceUnavailable)
			return
		}
		fmt.Fprint(w, "ok")
	})
	entry.NewHandler(entry.NewPGStore(pool), log).Register(mux)

	srv := &http.Server{
		Addr:              addr,
		Handler:           withTimeout(withLogging(log, mux), 10*time.Second),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
```

第四段在后台启动服务，等待启动失败或退出信号，收到信号后优雅关闭；最后是读环境变量的小工具 `envOr`：

```go
	errCh := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", addr)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		return err // 端口被占用之类，启动就失败了
	case <-ctx.Done():
		log.Info("shutting down")
	}

	shutdownCtx, cancel2 := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel2()
	return srv.Shutdown(shutdownCtx) // 不再接新连接，等进行中的请求处理完
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
```

（`statusRecorder`、`withLogging`、`withTimeout` 也在这个文件里，上一节已经列过。）

值得注意的几处：

- **`main` 只做一件事：调用 `run` 并处理它的错误**。`run` 返回 error，里面可以正常使用 `defer`；如果在 `main` 里直接 `os.Exit(1)`，已注册的 `defer` 不会执行
- **`http.Server` 的超时一定要设**。直接用 `http.ListenAndServe(addr, mux)` 的话所有超时都是 0（不限制），一个故意慢慢发请求头的客户端就能占住连接。`ReadHeaderTimeout` 是最起码的
- **`pgxpool.New` 不会立即建立连接**，所以启动时 `Ping` 一次，配置错了马上失败，而不是等第一个请求进来才报错
- **优雅退出**：收到 SIGTERM 后 `srv.Shutdown` 关闭监听、等进行中的请求处理完；之后 `defer pool.Close()` 关闭连接池。配合 Docker 的 `stop_grace_period`，部署时不会有请求被掐断，细节见[《部署与发布》的零停机一章](../deploy-release/04-zero-downtime.md)

连接池默认最大连接数是 `max(4, CPU 核数)`。和 NestJS 共用一个 Postgres 时要算总账：两边的连接池上限加起来不能超过 Postgres 的 `max_connections`。可以在 DSN 上加参数调整：`postgres://user:pass@db:5432/counter?pool_max_conns=10`。

## 跑起来

```bash
docker run -d --name pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:17
# 用上面的 SQL 建表，插入一家店：INSERT INTO stores (name) VALUES ('旗舰店');
DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres go run ./cmd/server
```

```bash
curl -s -X POST localhost:8080/stores/1/entries -d '{"amountFen": 1250, "note": "午餐"}'
curl -s localhost:8080/stores/1/entries
curl -s -X POST localhost:8080/stores/1/entries -d '{"amount": 1}'
curl -s -i -X DELETE localhost:8080/stores/1/entries | head -2
```

```text
{"id":1,"storeId":1,"amountFen":1250,"note":"午餐","createdAt":"2026-11-04T09:30:00+08:00"}
[{"id":1,"storeId":1,"amountFen":1250,"note":"午餐","createdAt":"2026-11-04T09:30:00+08:00"}]
{"error":"请求体不是合法 JSON：json: unknown field \"amount\""}
HTTP/1.1 405 Method Not Allowed
Allow: GET, HEAD, POST
```

## 什么时候该上框架

标准库缺的东西主要是：路由分组和挂载中间件的语法糖、请求参数绑定、OpenAPI 生成。需要时有两个轻量的选择：

- **chi**：只做路由，完全兼容 `http.Handler`，中间件生态和标准库通用。路由很多、要分组时引入，迁移成本几乎为零
- **huma**：基于标准库或 chi，从 Go 类型生成 OpenAPI 文档和请求校验，接近 NestJS + Swagger 的体验

Gin、Echo 也很流行，但它们有自己的 `Context` 类型，和标准库的 handler 不能直接混用。一个人的小服务，标准库加需要时的 chi，足够了。

## 本章要点

- Go 服务适合放在 TS 主后端旁边做高频简单接口、批处理和运维工具；共享数据库时只由一方负责迁移
- Go 1.22 起 `ServeMux` 支持 `"GET /stores/{id}"` 这样的模式，小服务不需要路由框架
- 数据库用 pgx + pgxpool；永远用占位符；用 `errors.As` 取 `*pgconn.PgError` 翻译错误码；`BeginFunc` 管事务
- handler 写完错误响应要 `return`；限制请求体大小；列表返回空切片而不是 nil
- 中间件是 `func(http.Handler) http.Handler`；`slog` 输出结构化日志
- `main` 只调用 `run`；`http.Server` 必须设超时；启动时 Ping 数据库；`Shutdown` 实现优雅退出

## 动手练习

1. **忘了 return 会怎样**：不需要数据库，写一个最小服务：

   ```go
   func list(w http.ResponseWriter, r *http.Request) {
   	id, err := strconv.ParseInt(r.PathValue("storeID"), 10, 64)
   	if err != nil {
   		http.Error(w, "storeID 不是数字", http.StatusBadRequest)
   	}
   	fmt.Fprintf(w, "store %d\n", id)
   }

   func main() {
   	mux := http.NewServeMux()
   	mux.HandleFunc("GET /stores/{storeID}/entries", list)
   	_ = http.ListenAndServe(":18080", mux)
   }
   ```

   运行后执行 `curl -i localhost:18080/stores/abc/entries`，预测状态码和响应体。

   验证：状态码是 `400 Bad Request`，但响应体有两行：`storeID 不是数字` 和 `store 0`。在 `http.Error` 后面加上 `return`，响应体只剩第一行。

   参考答案：`http.Error` 只是写响应，不会结束 handler；代码继续往下跑，又往同一个响应里写了一次。状态码已经发出去，后面的写入只能追加到 body 里。

2. **方法不匹配的自动处理**：对上面的服务执行 `curl -i -X DELETE localhost:18080/stores/1/entries` 和 `curl -I localhost:18080/stores/1/entries`，预测两次的状态行。

   验证：DELETE 得到 `405 Method Not Allowed`，并带 `Allow: GET, HEAD` 头；`-I`（HEAD）得到 `200 OK`。再注册一个 `POST` 模式后重试 DELETE，`Allow` 里会多出 `POST`。

   参考答案：Go 1.22 起 `ServeMux` 知道每个路径注册了哪些方法，路径对、方法不对时返回 405 并列出允许的方法；注册了 `GET` 的模式自动响应 `HEAD`。

3. **null 还是 []**：运行下面两行，预测输出，然后对照本章 `list` handler 里 `if list == nil` 那段判断。

   ```go
   var list []Entry
   a, _ := json.Marshal(list)
   b, _ := json.Marshal([]Entry{})
   fmt.Println(string(a), string(b))
   ```

   验证：输出 `null []`。

   参考答案：nil 切片和空切片 `len` 都是 0，但 `encoding/json` 把 nil 切片编码成 `null`。前端对 `null` 调 `.map` 会报错，所以返回列表前把 nil 换成空切片。
