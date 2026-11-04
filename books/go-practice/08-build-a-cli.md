# 写一个 CLI：用 Go 重写 shelf-pack check

hatch-shelf 仓库里有一个 Node CLI `shelf-pack`，`check` 子命令按写书规范校验 `books/` 下的每本书：`book.yaml` 的字段、章节文件是否存在、每章是否只有一个 H1、代码块是否标了语言、图片是否是本地文件。这一章把它的核心部分用 Go 重写一遍，叫 `shelfcheck`。

先说清楚目的。TS 版工作得很好，而且仓库的规矩是「判断书籍结构的逻辑只写在 `@shelf/spec`」，App 和 CLI 共用一份。用 Go 再写一份，就有了两份规则，迟早会不一致。所以这里的 Go 版是**练习**：它足够小，又覆盖了 CLI 的全部要素（参数解析、文件系统、YAML、正则、并发、退出码、可测试的结构），而且你对它要做什么了如指掌，可以把注意力全放在 Go 上。章末再讨论什么情况下真的值得这样做。

## 要实现什么

| 检查 | TS 版位置 | Go 版 |
|---|---|---|
| `book.yaml` 字段和格式 | `schema.ts`（zod） | `manifest.go` |
| `id` 与目录名一致 | `lint.ts` | `lint.go` 的 `Check` |
| `chapters` 列出的文件存在 | `lint.ts` | 同上 |
| 每章唯一 H1 | `lintChapter` | `LintChapter` |
| 代码块标注语言 | `lintChapter` | `LintChapter` |
| 图片必须是 `assets/` 下存在的本地文件 | `lintChapter` | `LintChapter` |
| 跨书链接、锚点、`next` 指向的书存在 | `links.ts` | 不做，留作练习 |

```text
shelfcheck/
├── go.mod
├── cmd/shelfcheck/main.go      # 参数、并发、输出、退出码
└── internal/book/
    ├── manifest.go             # book.yaml 解析与校验
    ├── lint.go                 # 章节检查与整本书检查
    └── lint_test.go            # 第 9 章
```

```bash
go mod init github.com/jarvis/shelfcheck
go get go.yaml.in/yaml/v3 golang.org/x/sync
```

YAML 库选的是 `go.yaml.in/yaml/v3`。很多老代码用的是 `gopkg.in/yaml.v3`，那个仓库已经归档，YAML 组织接手后发布在新路径下，API 相同。

## book.yaml：解析与校验

`internal/book/manifest.go` 完整文件分 3 段给出，从上到下拼起来就是整个文件。第一段是包声明、导入和几条校验用的正则与取值范围：

```go
// Package book 按写书规范校验一本书，对应 TS 版的 @shelf/spec 里 check 用到的那部分。
package book

import (
	"bytes"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"unicode/utf8"

	"go.yaml.in/yaml/v3"
)

var (
	slugRe        = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
	chapterFileRe = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*\.md$`)
	dateRe        = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	levels        = []string{"beginner", "intermediate", "advanced"}
)
```

第二段定义与 `book.yaml` 对应的结构体，然后是 `ParseManifest` 的前半部分：用开启了 `KnownFields` 的解码器把 YAML 解进结构体：

```go
// Manifest 对应 book.yaml。
type Manifest struct {
	ID       string     `yaml:"id"`
	Title    string     `yaml:"title"`
	Subtitle string     `yaml:"subtitle"`
	Category string     `yaml:"category"`
	Tags     []string   `yaml:"tags"`
	Level    string     `yaml:"level"`
	Created  string     `yaml:"created"`
	Updated  string     `yaml:"updated"`
	Chapters []string   `yaml:"chapters"`
	Next     []NextBook `yaml:"next"`
}

type NextBook struct {
	ID     string `yaml:"id"`
	Reason string `yaml:"reason"`
}

// ParseManifest 解析并校验 book.yaml，返回全部问题而不是遇到第一个就停。
func ParseManifest(data []byte) (*Manifest, error) {
	var m Manifest
	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true) // 拼错的字段名直接报错
	if err := dec.Decode(&m); err != nil {
		return nil, fmt.Errorf("book.yaml 解析失败: %w", err)
	}
```

第三段是 `ParseManifest` 的后半部分：逐个字段校验，问题都收进 `errs`，最后用 `errors.Join` 一起返回：

```go
	var errs []error
	bad := func(format string, args ...any) {
		errs = append(errs, fmt.Errorf(format, args...))
	}
	if !slugRe.MatchString(m.ID) {
		bad("id 只能包含 [a-z0-9-]: %q", m.ID)
	}
	if m.Title == "" {
		bad("缺少 title")
	}
	if m.Level != "" && !slices.Contains(levels, m.Level) {
		bad("level 只能是 %v: %q", levels, m.Level)
	}
	for _, d := range []string{m.Created, m.Updated} {
		if d != "" && !dateRe.MatchString(d) {
			bad("日期格式应为 YYYY-MM-DD: %q", d)
		}
	}
	if len(m.Chapters) == 0 {
		bad("chapters 至少要有一章")
	}
	seen := map[string]bool{}
	for _, ch := range m.Chapters {
		if !chapterFileRe.MatchString(ch) {
			bad("章节文件名只能包含 [a-z0-9-] 并以 .md 结尾: %q", ch)
		}
		if seen[ch] {
			bad("chapters 中有重复文件: %s", ch)
		}
		seen[ch] = true
	}
	if len(m.Next) > 3 {
		bad("next 最多 3 本")
	}
	for _, n := range m.Next {
		if n.ID == m.ID {
			bad("next 不能推荐本书自己")
		}
		if utf8.RuneCountInString(n.Reason) > 60 {
			bad("next.reason 不超过 60 字: %s", n.ID)
		}
	}
	return &m, errors.Join(errs...)
}
```

和 zod 版对照，有几处值得注意：

- **日期字段**：TS 版要处理一个坑，YAML 里不加引号的 `2026-11-04` 会被 js-yaml 解析成 `Date` 对象，所以 schema 里有一段 `preprocess` 把它转回字符串。Go 版里字段类型是 `string`，yaml 库按目标类型解码，直接得到字符串，这个坑不存在。**静态类型的解码是由目标类型驱动的**，这是 Go 处理外部数据的一个好习惯
- **`KnownFields(true)`**：相当于 zod 的 `.strict()`，`chpaters:` 这种拼写错误会直接报出来
- **字数**：`reason` 不超过 60 字，用 `utf8.RuneCountInString` 数字符，不能用 `len`（字节数）
- **正则**：Go 的 `regexp` 是 RE2 语法，保证线性时间，但**不支持反向引用和环视**（`(?=...)`、`(?<=...)`）。从 JS 搬正则过来时要留意；这里用到的都是基本语法，原样照搬即可

## 检查章节

`internal/book/lint.go` 的前半部分分 4 段给出，下一节的 `Check` 接在它后面。第一段是导入和章节检查用到的正则：

```go
package book

import (
	"fmt"
	"io/fs"
	"path"
	"regexp"
	"strings"
)

var (
	fenceRe  = regexp.MustCompile("^ {0,3}(`{3,}|~{3,})(.*)$")
	h1Re     = regexp.MustCompile(`^#\s+\S`)
	imageRe  = regexp.MustCompile(`!\[[^\]]*\]\(\s*<?([^)\s>]+)>?`)
	inlineRe = regexp.MustCompile("(`+).*?`+")
	remoteRe = regexp.MustCompile(`(?i)^([a-z][a-z0-9+.-]*:|//)`)
)
```

第二段定义校验结果 `Problem` 及其打印格式，然后是 `LintChapter` 的开头，`report` 负责收集问题：

```go
// Problem 是一条校验结果，File 和 Line 用来定位。
type Problem struct {
	File string
	Line int // 0 表示整个文件
	Msg  string
}

func (p Problem) String() string {
	if p.Line == 0 {
		return fmt.Sprintf("%s %s", p.File, p.Msg)
	}
	return fmt.Sprintf("%s:%d %s", p.File, p.Line, p.Msg)
}

// LintChapter 检查一章 Markdown：唯一 H1、代码块标语言、图片只能引用本地 assets/。
// assets 是书目录下实际存在的图片路径集合。
func LintChapter(file, text string, assets map[string]bool) []Problem {
	var out []Problem
	report := func(line int, format string, args ...any) {
		out = append(out, Problem{file, line, fmt.Sprintf(format, args...)})
	}
```

第三段是 `LintChapter` 的主循环：逐行跟踪是否在代码块里，代码块外才数 H1、检查图片：

```go
	var fence string // 当前所在代码块的围栏，空串表示不在代码块里
	h1 := 0
	for i, line := range strings.Split(text, "\n") {
		no := i + 1
		if m := fenceRe.FindStringSubmatch(line); m != nil {
			mark, info := m[1], strings.TrimSpace(m[2])
			switch {
			case fence == "":
				fence = mark
				if info == "" {
					report(no, "代码块没有标注语言")
				}
				continue
			case mark[0] == fence[0] && len(mark) >= len(fence) && info == "":
				fence = ""
				continue
			}
		}
		if fence != "" {
			continue
		}
		if h1Re.MatchString(line) {
			h1++
		}
		plain := inlineRe.ReplaceAllString(line, "")
		for _, m := range imageRe.FindAllStringSubmatch(plain, -1) {
			src := m[1]
			switch {
			case remoteRe.MatchString(src):
				report(no, "远程图片（离线时无法显示）：%s", src)
			case !strings.HasPrefix(path.Clean(src), "assets/"):
				report(no, "图片必须放在 assets/ 下：%s", src)
			case !assets[path.Clean(src)]:
				report(no, "图片不存在：%s", src)
			}
		}
	}
```

第四段在循环结束后检查 H1 的数量，`LintChapter` 到此结束：

```go
	switch {
	case h1 == 0:
		report(0, "没有 H1 章标题")
	case h1 > 1:
		report(0, "有 %d 个 H1，每章只能有一个", h1)
	}
	return out
}
```

围栏的判断照搬了 Markdown 的规则：开头的围栏可以是三个以上的反引号或波浪线；结束围栏必须是同一种字符、长度不短于开头、后面不能有别的内容。代码块里的 `# 注释` 和 `![x](y)` 都不算数，所以进了代码块就 `continue`。

`Problem` 实现了 `String()` 方法（第 3 章的 `fmt.Stringer`），打印时自动格式化成 `文件:行号 信息`，和 TS 版的输出一致。

## 检查一整本书：fs.FS

```go
// Check 校验一本书。fsys 以书目录为根，dirName 是目录名（要和 id 一致）。
func Check(fsys fs.FS, dirName string) []Problem {
	data, err := fs.ReadFile(fsys, "book.yaml")
	if err != nil {
		return []Problem{{File: "book.yaml", Msg: "缺少 book.yaml"}}
	}
	var out []Problem
	m, err := ParseManifest(data)
	if err != nil {
		for _, e := range unwrapAll(err) {
			out = append(out, Problem{File: "book.yaml", Msg: e.Error()})
		}
		if m == nil {
			return out
		}
	}
	if m.ID != dirName {
		out = append(out, Problem{File: "book.yaml", Msg: fmt.Sprintf("id（%s）与目录名（%s）不一致", m.ID, dirName)})
	}

	assets := map[string]bool{}
	_ = fs.WalkDir(fsys, "assets", func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			assets[p] = true
		}
		return nil // assets/ 不存在也没关系
	})

	for _, ch := range m.Chapters {
		text, err := fs.ReadFile(fsys, ch)
		if err != nil {
			out = append(out, Problem{File: ch, Msg: "chapters 中列出的文件不存在"})
			continue
		}
		out = append(out, LintChapter(ch, string(text), assets)...)
	}
	return out
}

// unwrapAll 把 errors.Join 合并的错误拆回一条条。
func unwrapAll(err error) []error {
	if j, ok := err.(interface{ Unwrap() []error }); ok {
		return j.Unwrap()
	}
	return []error{err}
}
```

`Check` 的第一个参数是 `fs.FS`，不是目录路径。`fs.FS` 是标准库里的只读文件系统接口，只有一个 `Open` 方法。生产代码传 `os.DirFS(dir)`，测试传 `fstest.MapFS`（一个内存里的 map），不用在测试里建临时目录。这又是一次「接受接口」：同样的函数还能检查一个 zip 包里的书（`zip.Reader` 也实现了 `fs.FS`），或者用 `embed.FS` 检查编译进二进制的示例书。

`ParseManifest` 出错时可能同时返回部分结果（`m` 不为 nil），这里的处理是：解析失败（`m == nil`）就不往下查了；只是字段校验失败，就继续检查章节，一次把问题报全。

## 入口：参数、并发与退出码

`cmd/shelfcheck/main.go` 完整文件分 5 段给出，从上到下拼起来就是整个文件。第一段是导入、版本号和极薄的 `main`：

```go
// shelfcheck 按写书规范校验 books/ 下的书，是 shelf-pack check 的 Go 版。
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"slices"

	"golang.org/x/sync/errgroup"

	"github.com/jarvis/shelfcheck/internal/book"
)

var version = "dev" // 构建时用 -ldflags "-X main.version=..." 覆盖

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	os.Exit(run(ctx, os.Args[1:], os.Stdout, os.Stderr))
}
```

第二段是每本书的结果类型，以及 `run` 的开头：解析命令行参数，处理 `-version` 和参数个数错误：

```go
type result struct {
	name     string
	problems []book.Problem
}

func run(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("shelfcheck", flag.ContinueOnError)
	fs.SetOutput(stderr)
	jobs := fs.Int("j", runtime.NumCPU(), "同时校验的书数")
	quiet := fs.Bool("q", false, "只输出有问题的书")
	showVersion := fs.Bool("version", false, "打印版本")
	fs.Usage = func() {
		fmt.Fprintln(stderr, "用法：shelfcheck [-j N] [-q] <books 目录或一本书的目录>")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if *showVersion {
		fmt.Fprintln(stdout, version)
		return 0
	}
	if fs.NArg() != 1 {
		fs.Usage()
		return 2
	}
```

第三段找出要检查的书，用 `errgroup` 限制并发数逐本检查，结果写进各自的下标：

```go
	dirs, err := findBooks(fs.Arg(0))
	if err != nil {
		fmt.Fprintln(stderr, "错误：", err)
		return 2
	}

	results := make([]result, len(dirs))
	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(*jobs)
	for i, dir := range dirs {
		g.Go(func() error {
			if err := ctx.Err(); err != nil {
				return err // 按了 Ctrl-C，后面的书不再检查
			}
			name := filepath.Base(dir)
			results[i] = result{name, book.Check(os.DirFS(dir), name)}
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		fmt.Fprintln(stderr, "已中断：", err)
		return 130
	}
```

第四段在全部检查完成后按顺序输出结果，并决定退出码，`run` 到此结束：

```go
	failed := 0
	for _, r := range results {
		if len(r.problems) > 0 {
			failed++
			fmt.Fprintf(stdout, "✗ %s\n", r.name)
			for _, p := range r.problems {
				fmt.Fprintf(stdout, "    %s\n", p)
			}
		} else if !*quiet {
			fmt.Fprintf(stdout, "✓ %s\n", r.name)
		}
	}
	if failed > 0 {
		fmt.Fprintf(stdout, "\n%d / %d 本书有错误\n", failed, len(results))
		return 1
	}
	fmt.Fprintf(stdout, "\n%d 本书全部通过\n", len(results))
	return 0
}
```

第五段是 `run` 用到的 `findBooks`，判断目标是一本书还是一个书库目录：

```go
// findBooks：目标目录里有 book.yaml 就是一本书，否则取它下面的每个子目录。
func findBooks(target string) ([]string, error) {
	if _, err := os.Stat(filepath.Join(target, "book.yaml")); err == nil {
		return []string{target}, nil
	}
	entries, err := os.ReadDir(target)
	if err != nil {
		return nil, err
	}
	var dirs []string
	for _, e := range entries {
		if e.IsDir() && e.Name()[0] != '.' {
			dirs = append(dirs, filepath.Join(target, e.Name()))
		}
	}
	slices.Sort(dirs)
	return dirs, nil
}
```

这个入口有几个可以直接套用到任何 CLI 的结构：

**`main` 极薄，逻辑在 `run` 里。** `run` 接收参数、输出流和 context，返回退出码，不碰全局的 `os.Args`、`os.Stdout`，也不调用 `os.Exit`。第 9 章的测试可以直接调用 `run`，传入一个 `bytes.Buffer` 检查输出。

**退出码有含义。** 0 是全部通过，1 是有书不合格，2 是用法错误，130 是被 Ctrl-C 中断（128 + SIGINT 的编号 2，shell 的惯例）。CI 和 git hook 只看退出码。

**`flag` 包够用。** 标准库的 `flag` 支持 `-j 4`、`-j=4`、`--j 4` 几种写法，自动生成 `-h` 帮助。它不支持 `-qj4` 这种短选项合并，也没有子命令。子命令多了（`check`、`pack`、`push`、`ls`）就该用 **cobra**，它是 Go 世界的 commander，kubectl、gh、hugo 都用它；用 `flag.NewFlagSet` 给每个子命令建一个 FlagSet、自己按 `os.Args[1]` 分发，也是常见的轻量做法。

**并发写结果、顺序输出。** 每本书一个 goroutine，结果写到自己的下标里（第 5 章的「不共享」），全部完成后按目录名顺序打印。输出顺序稳定，不会因为谁先检查完而乱序，CI 日志才好对比。

## 跑一下

```bash
go build -o bin/shelfcheck ./cmd/shelfcheck
./bin/shelfcheck -q ~/works/hatch/hatch-shelf/books
```

写这一章时 `books/` 里有几本书正在同时写作，`chapters` 里列了还没写出来的章节，Go 版和 TS 版都把它们报了出来：

```text
✗ rust-practice
    01-why-rust.md chapters 中列出的文件不存在
    02-ownership-borrowing.md chapters 中列出的文件不存在
    03-lifetimes.md chapters 中列出的文件不存在

4 / 88 本书有错误
```

在同一台机器上各跑 5 次，Go 版检查一百本书用时约 0.03 秒，`pnpm shelf-pack check books/` 约 1 秒。这个对比不完全公平：TS 版多做了链接和锚点检查，而且 1 秒里大部分是 pnpm 和 tsx 启动、加载 TypeScript 的时间，真正的检查工作只占一小部分。但这恰好说明了 Go CLI 的优势在哪：**启动几乎不花时间**，适合放在 git pre-commit hook、编辑器保存钩子这种「每次都要跑、要求立刻返回」的位置。

## 分发

Go CLI 的分发方式比 Node CLI 多，也简单：

| 方式 | 对方需要 | 适合 |
|---|---|---|
| `go install github.com/jarvis/shelfcheck/cmd/shelfcheck@latest` | Go 工具链 | 给 Go 开发者 |
| GitHub Releases 上传各平台二进制 | 什么都不需要 | 给所有人，第 10 章讲交叉编译 |
| Homebrew tap | Homebrew | macOS 用户 |
| 放进 Docker 镜像 | Docker | CI |

用 GoReleaser 可以一条命令完成「交叉编译所有平台、打包、生成校验和、发 GitHub Release、更新 Homebrew tap」，对一人公司发工具很省事。

## 输出的几个讲究

- **结果写 stdout，诊断和错误写 stderr**。这样 `shelfcheck books | grep ✗` 不会混进错误信息
- **颜色要可关**：输出到终端时着色，输出被重定向时不着色。判断方法是检查 stdout 是不是终端（`golang.org/x/term` 的 `term.IsTerminal`），并尊重 `NO_COLOR` 环境变量
- **需要机器读取时提供 `-json`**。`Problem` 结构体加上 JSON tag，`json.NewEncoder(stdout).Encode(results)` 一行就有了

## 什么时候值得真的用 Go 重写

回到开头的问题。把一个工作良好的 TS 工具用 Go 重写，代价是两份实现要保持一致。值得做的情况：

- 工具要**分发给没有 Node 环境的人**，或者在一个最小的 CI 镜像里跑
- 工具在**高频路径上**（每次提交、每次保存），启动时间能感觉得到
- 工具本身就是**独立的**，没有和 App 共享的规则

`shelf-pack check` 三条都不太符合：只有仓库所有者自己用，机器上一定有 Node，规则和 App 共享。所以它继续用 TS。如果哪天真要换，做法是先把 TS 版的测试用例导出成一组「输入书目录 → 期望输出」的样例文件，两边的测试都跑这同一组样例，确保行为一致，再逐步替换。

## 本章要点

- CLI 的骨架：`main` 只调用 `run(ctx, args, stdout, stderr) int`，逻辑可测试，退出码有含义
- `flag` 包够用于少量选项；子命令多了用 cobra，或每个子命令一个 `FlagSet`
- 静态类型的解码由目标类型驱动，`KnownFields(true)` 相当于 zod 的 `.strict()`
- Go 的 `regexp` 是 RE2：线性时间，不支持反向引用和环视
- 用 `fs.FS` 而不是路径作为参数，生产用 `os.DirFS`，测试用 `fstest.MapFS`
- 并发检查、按下标收集、顺序输出；stdout 放结果，stderr 放诊断
- Go CLI 的优势是零依赖分发和几乎为零的启动时间；重写已有工具前先算清维护两份实现的代价

## 动手练习

1. **RE2 不认环视**：从 JS 搬一条带否定前瞻的正则过来，运行前预测结果：

   ```go
   _, err := regexp.Compile(`^(?!draft-)[a-z-]+$`)
   fmt.Println(err)
   ```

   验证：输出以 `error parsing regexp: invalid or unsupported Perl syntax` 开头，后面指出出问题的是 `(?!`。如果用的是 `regexp.MustCompile`，程序会在启动时 panic。改写成「先 `slugRe.MatchString(id)`，再 `!strings.HasPrefix(id, "draft-")`」两步判断即可。

   参考答案：Go 的 `regexp` 是 RE2，为了保证线性时间不支持环视和反向引用；需要这类逻辑时拆成几次普通匹配加字符串函数。

2. **预测 LintChapter 的报告**：把本章 `lint.go` 前半部分拼起来（`LintChapter` 和 `Problem`），在 `main` 里对下面两段文本各调用一次，`assets` 传 `map[string]bool{"assets/a.svg": true}`，预测会打印哪几条问题。

   ```go
   text1 := "# 第一章\n\n```\n# 不是标题\n```\n\n![图](./assets/a.svg)\n\n`![x](y.png)`\n"
   text2 := "# 第一章\n\n````markdown\n```go\nx\n```\n````\n# 第二章\n"
   ```

   验证：第一段只有 `01.md:3 代码块没有标注语言`；第二段只有 `有 2 个 H1，每章只能有一个`。

   参考答案：代码块里的 `# 不是标题` 不算 H1；`./assets/a.svg` 经 `path.Clean` 后是 `assets/a.svg`，存在；行内代码里的图片语法先被 `inlineRe` 去掉了。第二段用四个反引号的外层围栏包住三个反引号的内层，内层那一行长度不够，不会结束外层代码块，所以 `go` 那一行不触发检查；真正的两个 H1 都在代码块外。

3. **flag 在第一个位置参数处停下**：用 `flag.NewFlagSet(..., flag.ContinueOnError)` 定义 `-j`，解析失败时 `os.Exit(2)`，最后打印 `*jobs` 和 `fs.Args()`。依次运行 `./cli -j abc`、`./cli -j=3 books`、`./cli books -j 3`，预测三次结果。

   验证：第一次打印 `invalid value "abc" for flag -j: parse error` 和用法说明，`echo $?` 为 `2`；第二次输出 `3 [books]`；第三次输出 `4 [books -j 3]`（4 是默认值）。

   参考答案：标准库 `flag` 遇到第一个非选项参数就停止解析，后面的 `-j 3` 被当成普通参数。这和很多 Node CLI 库的习惯不同，选项要写在位置参数前面；需要任意位置的选项时换 cobra。
