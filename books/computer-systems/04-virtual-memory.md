# 虚拟内存

`top` 里一个 Node 进程的 VIRT 列写着几十 GB，机器总共只有 4 GB 内存；`process.memoryUsage()` 里 `rss` 和 `heapUsed` 差了一倍；容器里的服务没有任何报错就消失了，退出码 137。这些现象背后是同一套机制：**虚拟内存**。进程看到的地址不是真实的物理地址，而是操作系统和硬件一起维护的一层映射。理解这层映射，才能看懂内存指标、判断内存到底够不够、知道 OOM 是谁杀的。

## 每个进程一个假的地址空间

在虚拟内存之下，每个进程都以为自己独占一整块从 0 开始的、巨大的地址空间。进程 A 的地址 `0x1000` 和进程 B 的地址 `0x1000` 是两个完全不同的物理位置，互相看不到。

这层间接带来了几样东西：

- **隔离**：一个进程无法读写另一个进程的内存，野指针最多弄坏自己
- **简化**：每个程序都可以假设代码在固定的位置、堆和栈有充足的空间，不用关心物理内存里还有谁
- **按需分配**：申请了 1 GB 不等于占了 1 GB，真正用到时才分配物理内存
- **共享**：多个进程可以把同一块物理内存映射进各自的地址空间，比如共享库的代码、文件的页缓存

## 页与页表

映射不是逐字节做的，而是以**页**为单位。Linux 在 x86-64 上通常是 4 KB 一页，Apple Silicon 上的 macOS 和 iOS 是 16 KB（`sysctl hw.pagesize` 输出 16384）。

虚拟地址被拆成两部分：高位是**虚拟页号**，低位是**页内偏移**。操作系统为每个进程维护一张**页表**，记录「虚拟页号 → 物理页号」以及这一页的权限（可读、可写、可执行）。CPU 里的内存管理单元（MMU）每次访存都自动查这张表，把虚拟地址翻译成物理地址。

一个 48 位的地址空间如果用一张平铺的表，光页表本身就要几百 GB，所以页表是多级的，没用到的部分不分配：

![x86-64 的 48 位虚拟地址被拆成四个 9 位的页表索引和一个 12 位的页内偏移，逐级查表得到物理地址](assets/virtual-address.svg)

查四级页表意味着一次访存要先做四次访存，这显然不可接受。所以 CPU 里有一个专门缓存翻译结果的小缓存，叫 **TLB**（Translation Lookaside Buffer）。TLB 只有几百到几千项，第 3 章实验里工作集超过几 MB 后延迟缓慢上升，一部分原因就是 TLB 装不下所有页的翻译了。数据库常建议开启**大页**（Linux 的 huge pages，2 MB 一页），一个 TLB 项能覆盖的范围大了 512 倍，就是为了减少这类开销。

### Android 的 16 KB 页

> [!WARNING]
> 本小节关于 Android 16 KB 页大小的要求按 2025 年 Google Play 的政策整理，具体的生效时间、适用的 targetSdk 和豁免条件可能已调整，以 Android 开发者文档「支持 16 KB 页面大小」和 Google Play 政策的最新说明为准。

页大小不只是内核的细节。Android 从 15 开始支持 16 KB 页的设备，Google Play 要求新上架和更新的应用兼容 16 KB 页：应用里的原生库（`.so`）必须按 16 KB 对齐编译。对 React Native / Expo 应用来说，这意味着 RN 本身、Hermes 以及所有带原生代码的依赖都要升到支持 16 KB 对齐的版本。第 9 章讲可执行文件格式时会再说到「段对齐」。

## 按需分配：申请不等于占用

`malloc` 一大块内存，或者 Node 里 `Buffer.allocUnsafeSlow` 一个大缓冲，操作系统只是在页表里登记「这段虚拟地址有效」，并不立刻分配物理页。第一次访问某一页时，MMU 发现这一页还没有对应的物理页，触发**缺页异常**（page fault），内核这时才分配一个物理页、清零、填进页表，然后让那条指令重新执行。

用 Node 看一下：

```js
// rss.mjs
const mb = (n) => (n / 2 ** 20).toFixed(0) + " MB";
const show = (label) => console.log(label, "rss", mb(process.memoryUsage().rss));

show("启动");
const buf = Buffer.allocUnsafeSlow(1024 * 2 ** 20);         // 申请 1 GB
show("申请 1 GB 后");
for (let i = 0; i < buf.length / 2; i += 4096) buf[i] = 1;  // 每 4 KB 写一个字节，只写前一半
show("写了前一半");
buf.fill(1);
show("全部写过");
```

```text
$ node rss.mjs
启动 rss 38 MB
申请 1 GB 后 rss 40 MB
写了前一半 rss 556 MB
全部写过 rss 1068 MB
```

申请 1 GB 之后 RSS 几乎没动；每页只写一个字节，RSS 就涨了 512 MB，因为内核分配物理内存的粒度是整页。

缺页分两种：

- **次要缺页**（minor fault）：数据已经在内存里，只是还没映射，比如第一次碰一块新申请的内存、或者文件已经在页缓存里。代价是微秒级
- **主要缺页**（major fault）：数据要从磁盘读，比如被换出到 swap 的页、或者 `mmap` 了一个还没读过的文件。代价是磁盘 I/O 级别

Linux 上 `ps -o min_flt,maj_flt -p <pid>` 能看到一个进程累计的缺页次数，主要缺页持续增长通常意味着内存不够、在频繁换页。

## 读懂内存指标

有了按需分配和共享，「一个进程用了多少内存」就有好几种算法：

| 指标 | 含义 | 在哪看 |
|---|---|---|
| VSZ / VIRT | 虚拟地址空间登记了多大，包括没碰过的 | `ps`、`top` |
| RSS / RES | 当前实际驻留在物理内存里的页，包括共享库 | `ps`、`top`、`process.memoryUsage().rss` |
| PSS | RSS 里共享的部分按共享进程数平摊 | `/proc/<pid>/smaps_rollup` |
| heapTotal / heapUsed | V8 堆向系统要了多少、其中多少在用 | `process.memoryUsage()` |
| external / arrayBuffers | V8 堆外的 Buffer、ArrayBuffer | `process.memoryUsage()` |

**VIRT 大不说明任何问题**。V8 启动时就会预留大片虚拟地址给堆和代码空间，Go 程序、Java 程序也一样，几十 GB 的 VIRT 很正常。

**判断内存压力看 RSS，判断 JS 泄漏看 heapUsed**。一个 Node 进程 RSS 持续上涨而 `heapUsed` 平稳，问题多半在堆外：Buffer 没释放、原生模块泄漏、或者 glibc 的 malloc 没有把空闲内存还给系统。这类问题的排查流程见[《TS 与 Node 进阶》的内存一章](../ts-node-advanced/06-memory-gc-leaks.md#进程内存的组成)。

多个进程的 RSS **不能直接相加**。十个 Postgres 后端进程，每个 RSS 显示几百 MB，里面大部分是同一块共享内存（`shared_buffers`），加起来会远超实际。整机还剩多少内存，看 `free` 的 `available` 列，原因见[《Linux 实战》](../linux-essentials/03-processes-signals.md#内存别被-free-吓到)。

## 内存映射文件

页表不仅能把虚拟地址映射到匿名的物理内存，还能映射到**文件**。`mmap` 一个文件后，读那段内存就是读文件：第一次访问某一页触发缺页，内核从磁盘读进来放进页缓存，然后映射给进程。之后的访问就是普通的内存读取，没有 `read` 系统调用，也没有从内核缓冲区到用户缓冲区的那次拷贝。

可执行文件和共享库就是这样加载的（第 9 章）：程序启动时并不把整个文件读进内存，而是 `mmap` 进来，用到哪页才读哪页。所以多个进程运行同一个程序、链接同一个 `libc`，物理内存里只有一份代码。

数据库也会用 `mmap`。SQLite 可以通过 `PRAGMA mmap_size` 让读操作走内存映射，省掉拷贝；LMDB 整个就建立在 `mmap` 之上。Postgres 则坚持自己管理缓冲池，不用 `mmap` 读数据文件，原因之一是 `mmap` 下 I/O 错误会变成一个难以处理的信号、刷盘的时机也不受数据库控制，而数据库需要精确控制「什么时候写到磁盘」（第 8 章）。

## 内存不够时：swap 与 OOM

物理内存用完时，内核有两条路：

1. **换出**：把一些不常用的页写到磁盘上的 swap 区，腾出物理页。下次访问再换回来（主要缺页）。文件映射的页和页缓存更简单，干净的直接丢掉，需要时从文件重读
2. **杀进程**：实在腾不出来，Linux 的 **OOM killer** 按一个评分挑一个进程杀掉，通常是占内存最多的那个

Linux 默认允许**过量承诺**（overcommit）：所有进程申请的虚拟内存总和可以超过物理内存加 swap，赌大家不会同时用满。这让 `malloc` 几乎从不失败，代价是真用满时只能靠 OOM killer 收场。所以在 Linux 上，「内存不够」很少表现为某次分配返回错误，而是表现为某个进程突然被 `SIGKILL`。

小内存的云服务器（1–2 GB）建议配一点 swap。不是为了让程序跑在 swap 上，而是给偶发的内存尖峰一个缓冲，避免 OOM killer 在半夜杀掉数据库。swap 持续被大量使用（`vmstat` 的 `si`/`so` 列一直不为零）则说明内存真的不够，该加内存或者减负载了。

## 容器的内存上限

容器的内存限制是用 cgroup 实现的（见[《容器技术》的 cgroup 一节](../docker-containers/01-container-internals.md#cgroup限制进程能用多少资源)）。`docker run -m 512m` 或 compose 里的 `mem_limit` 给这个容器里的所有进程设了一个物理内存总额。超过它，内核在**这个 cgroup 内部**触发 OOM，杀掉其中的进程，即使宿主机还有大把空闲内存。

被 OOM 杀掉的容器有几个特征：

- 退出码 **137**，也就是 128 + 9，9 是 `SIGKILL`
- 应用日志里**没有任何错误**，因为进程根本没机会打日志
- `docker inspect <容器>` 里 `State.OOMKilled` 为 `true`；宿主机 `dmesg` 里能看到 `Memory cgroup out of memory: Killed process ...`

容器里跑 Node 还有一层：V8 堆有自己的上限，和 cgroup 的限制是两回事。V8 堆先撞上限，你会得到一个 `JavaScript heap out of memory` 的错误和栈；cgroup 先撞上限，你什么也得不到，进程直接没了。所以通常把 `--max-old-space-size` 设成容器限额的 60–75%，给堆外内存留余地，让 V8 先报错。具体算法见[《TS 与 Node 进阶》的容器里的堆上限](../ts-node-advanced/06-memory-gc-leaks.md#容器里的堆上限)。

## fork 与写时复制

Unix 创建进程的经典方式是 `fork`：复制当前进程，得到一个几乎一模一样的子进程。如果真的把父进程的内存全部复制一遍，一个占 2 GB 的进程 fork 一次要拷 2 GB。

虚拟内存让这件事几乎免费：fork 时只复制页表，父子进程的页表指向**同一批物理页**，并把这些页都标成只读。任何一方去写某一页时触发缺页，内核这时才把那一页复制一份给写的一方。这叫**写时复制**（copy-on-write，COW）。

很多软件依赖这个机制：

- **Redis 的 RDB 持久化**：fork 一个子进程，子进程看到的是 fork 那一刻的内存快照，慢慢写盘；父进程继续服务，只有被修改的页才会复制。这也是为什么 Redis 文档建议留出内存余量：写入频繁时，快照期间被复制的页可能接近整个数据集
- **Postgres 的连接**：每个新连接，主进程（postmaster）fork 出一个后端进程，共享代码和已经初始化的状态，第 5 章展开
- **Shell 执行命令**：先 fork 出子进程，再在子进程里 `exec` 加载新程序

Node 的 `child_process.fork()` 名字里有 fork，但它不是 Unix 的 fork：它是启动一个全新的 Node 进程去跑指定的脚本，并建立 IPC 通道，父子之间不共享任何内存状态。

## 权限：段错误与 JIT

页表里每一页都带权限位。访问没有映射的地址、往只读页写、执行不可执行的页，MMU 都会触发异常，内核给进程发 `SIGSEGV`，也就是**段错误**。在 JS 里你几乎碰不到它，但原生模块里的 bug 会让整个 Node 进程以 `Segmentation fault` 退出，没有 JS 栈，这时要怀疑最近升级过的原生依赖。

出于安全考虑，现代系统普遍执行 **W^X** 原则：一页要么可写、要么可执行，不能同时两者都是。这样攻击者往缓冲区里写进去的数据不能直接当代码跑。

JIT 编译器（V8、JavaScriptCore）恰恰需要「先写机器码、再执行」，所以它们要在写完后切换页的权限，平台也要专门允许这种行为。iOS 只允许系统自己的进程（比如 Safari 和 WKWebView 的 Web 内容进程）做 JIT，普通 App 进程不能把可写内存变成可执行。这就是 React Native 在 iOS 上用 Hermes 的一个重要背景：Hermes 在**构建时**就把 JS 编译成字节码，运行时解释执行，不需要 JIT。hatch-shelf 的阅读器跑在 WebView 里，那部分 JS 由 WKWebView 的 JavaScriptCore 执行；App 本身的界面逻辑跑在 Hermes 上，两边的执行方式是不一样的。

## 本章要点

- 每个进程有独立的虚拟地址空间，由页表映射到物理内存；页大小在 Linux x86-64 上通常 4 KB，Apple Silicon 16 KB
- 多级页表加 TLB 完成地址翻译；大页能减少 TLB 压力
- 申请不等于占用：第一次写某页才触发缺页、分配物理页，所以 VIRT 大没关系，看 RSS
- RSS 涨而 heapUsed 平稳，问题在堆外；多进程的 RSS 不能直接相加
- `mmap` 把文件映射进内存，可执行文件和共享库都这样加载，物理内存里只有一份
- Linux 默认过量承诺，内存耗尽靠 OOM killer 杀进程；容器内存超限退出码 137、日志里什么也没有
- 给 V8 设的堆上限要低于容器限额，让 JS 先报错
- fork 靠写时复制几乎免费，Redis 快照和 Postgres 连接都依赖它；Node 的 `child_process.fork` 不是 Unix fork
- W^X 让 JIT 需要平台许可；iOS 普通 App 不能 JIT，这是 Hermes 预编译字节码的背景之一
