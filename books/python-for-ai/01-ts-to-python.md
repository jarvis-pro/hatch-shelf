# TS 对照速学 Python

AI 领域几乎所有东西都先有 Python 版：模型厂商的 SDK、PyTorch、Hugging Face、各种论文的参考实现、Jupyter 里的教程。你可以只用 TypeScript 调模型 API，但一旦想读懂一段训练代码、跑一个开源模型、分析一批数据，就绕不开 Python。

好消息是，对一个熟练的 TS 开发者来说，Python 的语法一个下午就能上手，真正要花时间的是**思维习惯**：哪些地方和 JS 看起来一样其实不一样，哪些 JS 里的惯用法在 Python 里有更好的写法。这一章用对照表和并排代码把这些差异一次讲清。

## 这本书讲什么、适合谁、怎么读

**讲什么**：为了做 AI 相关的工作，一个 TS 开发者需要的那部分 Python。八章分别是：语法对照、uv 与环境管理、类型标注与 Pydantic、NumPy、Pandas、Jupyter、用 Python 调模型 API、动手写一个小工具。不讲 Web 框架（Django、FastAPI 只在需要时一笔带过），也不讲深度学习本身，那是[《动手学深度学习》](../deep-learning-basics/)的事。

**适合谁**：日常写 TypeScript（React、NestJS、Node 脚本都算）、没系统学过 Python 的开发者。你不需要先懂 Python，但要懂 TS：全书默认你知道 `interface`、泛型、`Promise`、`async/await`、zod、pnpm 是什么。

**怎么读**：第 1–3 章是语言和工具链的基础，按顺序读；第 4–6 章是数据处理三件套，是后面读深度学习代码的前置；第 7–8 章是把前面的东西组合起来干活。每章的代码都可以复制到文件里直接跑。

**几个约定**：

- Python 版本以 **3.12** 为基线，代码在 3.12 上实际跑过；3.13、3.14 同样适用
- 包管理统一用 **uv**（第 2 章），不用 pip / conda / poetry。运行示例的方式是 `uv run xxx.py`
- 写作时（2026 年 11 月）本书用到的库版本大致是：NumPy 2.x、Pandas 3.x、Pydantic 2.x、Anthropic Python SDK 2.x。库更新快，遇到行为不一致以官方文档为准

## 心智模型：先校准几个大前提

| 方面 | TypeScript / Node | Python |
|---|---|---|
| 类型 | 编译期检查，运行时擦除 | 运行时**动态**类型；类型标注可选，由独立的检查器（pyright、mypy）检查，解释器不管 |
| 代码块 | `{ }` | **缩进**（约定 4 个空格），冒号开头 |
| 运行方式 | `tsc` / `tsx` / Node 直接跑 TS | 解释器直接跑 `.py`，没有构建步骤 |
| 并发 | 单线程事件循环，I/O 默认异步 | 默认同步阻塞；异步要显式用 `asyncio` |
| 数字 | 只有 `number`（双精度浮点）和 `bigint` | `int`（任意精度整数）和 `float`（双精度）分开 |
| 包管理 | npm / pnpm，`node_modules` 在项目里 | uv，依赖装进项目的 `.venv` 虚拟环境 |
| 风格 | camelCase | 变量和函数 `snake_case`，类 `PascalCase`，常量 `UPPER_CASE` |

最需要转变的是第一行：**Python 的类型标注不会阻止任何代码运行**。`def f(x: int)` 照样可以传字符串进去，直到某一行真正出错。类型标注的价值在编辑器提示和静态检查上，第 3 章细讲。

## 变量与基本类型

```typescript
const name = "hatch";
let count = 3;
const ratio = 0.75;
const ok = true;
const nothing = null;
```

```python
name = "hatch"
count = 3
ratio = 0.75
ok = True          # 首字母大写
nothing = None     # 只有 None，没有 undefined
```

Python 没有 `const` / `let`，变量直接赋值即可。约定上全大写的名字表示常量（`MODEL = "claude-opus-5-5"`），但语言不强制。

### 数字运算的几个坑

```python
print(7 / 2)     # 3.5   真除法，结果总是 float
print(7 // 2)    # 3     整除（向下取整）
print(-7 // 2)   # -4    注意是向下取整，不是向零取整
print(7 % 3)     # 1
print(2 ** 10)   # 1024  乘方，相当于 JS 的 2 ** 10
print(2 ** 100)  # 1267650600228229401496703205376，int 不会溢出
print(round(2.5), round(3.5))  # 2 4   银行家舍入：.5 舍到偶数
print(0.1 + 0.2) # 0.30000000000000004，和 JS 一样是 IEEE 754
```

`round` 的行为和 JS 的 `Math.round` 不同，算钱时尤其要注意，金额计算用标准库的 `decimal.Decimal` 或者整数分。

### 真值判断：空容器是假

这是从 JS 过来最容易踩的坑：

| 值 | JS 里 | Python 里 |
|---|---|---|
| `0`、`""` | 假 | 假 |
| `null` / `None` | 假 | 假 |
| 空数组 `[]` | **真** | **假** |
| 空对象 `{}` | **真** | **假**（空字典） |

所以 Python 里判断列表非空的惯用写法就是 `if items:`。反过来，要区分「是 None」和「是空」时，必须写 `if x is None:`。

### 相等与身份

```python
a = [1, 2]
b = [1, 2]
print(a == b)   # True   比较值（相当于深比较，不需要 lodash.isEqual）
print(a is b)   # False  比较是否同一个对象（相当于 JS 的 ===  对对象的语义）
print(a is not None)
```

Python 的 `==` 不做隐式类型转换（`1 == "1"` 是 `False`），所以没有 `===` 这回事。`is` 只用在 `None`、`True`、`False` 这类单例上。

## 字符串

```typescript
const user = "Ada";
const msg = `Hello, ${user}! You have ${3 * 2} tasks.`;
const multi = `line 1
line 2`;
```

```python
user = "Ada"
msg = f"Hello, {user}! You have {3 * 2} tasks."
multi = """line 1
line 2"""
print(f"{3.14159:.2f}")    # 3.14     格式说明符写在冒号后
print(f"{1234567:,}")      # 1,234,567
print(f"{user=}")          # user='Ada'  调试时很好用
```

常用方法对照：

| JS | Python |
|---|---|
| `s.length` | `len(s)` |
| `s.toUpperCase()` | `s.upper()` |
| `s.trim()` | `s.strip()` |
| `s.split(",")` | `s.split(",")` |
| `arr.join(",")` | `",".join(arr)`（方法在分隔符上） |
| `s.includes("x")` | `"x" in s` |
| `s.startsWith("x")` | `s.startswith("x")` |
| `s.replaceAll("a", "b")` | `s.replace("a", "b")`（默认就是全部替换） |
| `s.slice(1, 3)` | `s[1:3]` |

Python 的字符串是 Unicode 码点序列，`len("你好")` 是 2；JS 的字符串是 UTF-16，emoji 之类的字符长度会算成 2。

## 四种内置容器

| TS | Python | 字面量 | 说明 |
|---|---|---|---|
| `Array` | `list` | `[1, 2, 3]` | 可变、有序 |
| 只读元组 `readonly [number, string]` | `tuple` | `(1, "a")` | 不可变，常用于「多返回值」 |
| `Object` / `Record` / `Map` | `dict` | `{"a": 1}` | 键值对，保持插入顺序 |
| `Set` | `set` | `{1, 2, 3}` | 注意 `{}` 是空 dict，空集合要写 `set()` |

```python
nums = [3, 1, 2]
nums.append(4)              # push
nums.extend([5, 6])         # push(...arr)
last = nums.pop()           # pop
nums.sort()                 # 原地排序，数字按数值排（JS 默认按字符串排）
print(sorted(nums, reverse=True))  # 返回新列表
print(len(nums), 3 in nums)

user = {"name": "Ada", "age": 36}
print(user["name"])                 # 键不存在会抛 KeyError
print(user.get("email"))            # None，不抛错，类似 user.email
print(user.get("email", "n/a"))     # 带默认值，类似 user.email ?? "n/a"
for key, value in user.items():     # Object.entries(user)
    print(key, value)
merged = {**user, "age": 37}        # { ...user, age: 37 }
merged2 = user | {"age": 37}        # 3.9+ 的合并写法，效果相同
```

Python 的 dict 访问用 `d["key"]`，没有 `d.key` 这种点语法；点语法是给对象属性用的。

### 切片

切片是 Python 最好用的语法之一，列表、字符串、元组都支持，第 4 章的 NumPy 把它推广到了多维：

```python
xs = [0, 1, 2, 3, 4, 5]
print(xs[1:4])    # [1, 2, 3]     左闭右开，同 slice(1, 4)
print(xs[:2])     # [0, 1]        前两个
print(xs[-2:])    # [4, 5]        后两个，负数从末尾数
print(xs[::2])    # [0, 2, 4]     步长 2
print(xs[::-1])   # [5, 4, 3, 2, 1, 0]  反转
print(xs[-1])     # 5             相当于 xs.at(-1)
```

### 解包

```typescript
const [first, ...rest] = [1, 2, 3];
const { name, age } = user;
[a, b] = [b, a];
```

```python
first, *rest = [1, 2, 3]       # first=1, rest=[2, 3]
user = {"name": "Ada", "age": 36}
name, age = user["name"], user["age"]   # dict 没有解构语法，按键取
a, b = 1, 2
a, b = b, a                    # 交换
```

## 推导式：代替 map / filter

JS 里链式调用 `map`、`filter` 的场景，Python 的惯用写法是**推导式**（comprehension）：

```typescript
const squares = nums.filter((n) => n % 2 === 0).map((n) => n * n);
const byId = Object.fromEntries(users.map((u) => [u.id, u]));
```

```python
nums = [1, 2, 3, 4, 5, 6]
squares = [n * n for n in nums if n % 2 == 0]       # [4, 16, 36]

users = [{"id": 1, "name": "Ada"}, {"id": 2, "name": "Linus"}]
by_id = {u["id"]: u for u in users}                 # dict 推导式
names = {u["name"] for u in users}                  # set 推导式
total = sum(n * n for n in nums)                    # 生成器表达式，不建中间列表
print(any(n > 5 for n in nums), all(n > 0 for n in nums))  # some / every
```

Python 也有 `map()`、`filter()` 和 `lambda`，但 `lambda` 只能写单个表达式，复杂逻辑会很别扭。推导式读起来像一句话，是社区公认的写法。

## 控制流

```python
score = 85
if score >= 90:
    grade = "A"
elif score >= 80:          # 不是 else if
    grade = "B"
else:
    grade = "C"

label = "pass" if score >= 60 else "fail"   # 三元表达式，语序和 JS 不同

for i in range(3):         # 0, 1, 2；range(1, 10, 2) 是 1,3,5,7,9
    print(i)

fruits = ["apple", "pear"]
for i, fruit in enumerate(fruits):          # 要下标时用 enumerate
    print(i, fruit)

prices = [3.5, 2.0]
for fruit, price in zip(fruits, prices):    # 并行遍历两个列表
    print(fruit, price)
```

没有 `for (let i = 0; i < n; i++)`，也没有 `++`，写 `i += 1`。

### match：结构化的 switch

3.10 加入的 `match` 比 `switch` 强得多，能按结构匹配，很适合处理模型 API 返回的不同类型的内容块：

```python
def describe(block: dict) -> str:
    match block:
        case {"type": "text", "text": text}:
            return f"文本：{text}"
        case {"type": "tool_use", "name": name}:
            return f"调用工具 {name}"
        case {"type": _}:
            return "其他类型"
        case _:
            return "不认识"

print(describe({"type": "text", "text": "你好"}))
print(describe({"type": "tool_use", "name": "search", "input": {}}))
```

没有 fall-through，不需要 `break`。

## 函数

```typescript
function greet(name: string, greeting = "Hello"): string {
  return `${greeting}, ${name}`;
}
greet("Ada", "Hi");
function sum(...nums: number[]) { return nums.reduce((a, b) => a + b, 0); }
function createUser({ name, admin = false }: { name: string; admin?: boolean }) {}
```

```python
def greet(name: str, greeting: str = "Hello") -> str:
    return f"{greeting}, {name}"

greet("Ada", "Hi")
greet("Ada", greeting="Hi")          # 关键字参数：任何参数都能按名字传

def total(*nums: float) -> float:    # *args：剩余位置参数，是个 tuple
    return sum(nums)

def create_user(name: str, *, admin: bool = False) -> dict:
    # 单独的 * 之后的参数只能按名字传，相当于 TS 里用对象参数的效果
    return {"name": name, "admin": admin}

def log(msg: str, **fields: object) -> None:   # **kwargs：剩余关键字参数，是个 dict
    print(msg, fields)

print(total(1, 2, 3))
print(create_user("Ada", admin=True))
log("saved", user_id=1, ms=12)

args = [1, 2, 3]
opts = {"admin": True}
print(total(*args), create_user("Ada", **opts))   # 展开，相当于 ...args
```

**关键字参数**是 Python 和 JS 风格差异最大的地方。JS 里为了可读性会传一个配置对象；Python 直接用关键字参数，API 文档里看到 `client.messages.create(model=..., max_tokens=...)` 就是这种写法。

### 可变默认参数的坑

```python
def add_item(item, items=[]):     # 错误写法：默认值只在函数定义时求值一次
    items.append(item)
    return items

print(add_item(1))   # [1]
print(add_item(2))   # [1, 2]   上一次调用留下的列表被复用了

def add_item_ok(item, items=None):
    if items is None:
        items = []
    items.append(item)
    return items
```

默认值不要用 `[]`、`{}` 这类可变对象，用 `None` 再在函数里创建。

## 类与 dataclass

```python
class Counter:
    def __init__(self, start: int = 0) -> None:   # 构造函数
        self.value = start                         # self 相当于 this，必须显式写

    def inc(self, step: int = 1) -> int:
        self.value += step
        return self.value

    def __repr__(self) -> str:                     # 相当于自定义 toString，print 时用
        return f"Counter({self.value})"

c = Counter()
c.inc()
print(c)   # Counter(1)
```

Python 没有 `private` / `public`，约定下划线开头（`self._cache`）表示内部使用。

大多数时候你只想要一个「带字段的数据结构」，这时用 `dataclass`，它自动生成构造函数、`__repr__` 和 `__eq__`：

```python
from dataclasses import dataclass, field

@dataclass
class Book:
    id: str
    title: str
    tags: list[str] = field(default_factory=list)   # 可变默认值的正确写法

@dataclass(frozen=True)          # 不可变，类似 readonly
class Point:
    x: float
    y: float

b = Book(id="python-for-ai", title="面向 AI 的 Python")
print(b)                          # Book(id='python-for-ai', title='面向 AI 的 Python', tags=[])
print(Point(1, 2) == Point(1, 2)) # True，按字段比较
```

需要对外部数据做**校验**（API 响应、模型输出、配置文件）时，用 Pydantic 而不是 dataclass，第 3 章讲。

## 异常

```python
import json

def load_config(text: str) -> dict:
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:          # 按类型捕获，可以写多个 except
        raise ValueError(f"配置不是合法 JSON：{e}") from e
    finally:
        print("done")

try:
    load_config("{oops")
except ValueError as e:
    print("出错了：", e)
```

两点区别：一是 `except` 按**异常类型**分支，不用在 `catch` 里写 `instanceof`；二是 Python 的惯用风格是「先做再说」（EAFP），比如直接 `d["key"]` 然后捕获 `KeyError`，而不是先检查键是否存在。

资源清理用 `with`（上下文管理器），相当于 TS 5.2 的 `using`：

```python
from pathlib import Path

Path("notes.txt").write_text("hello\n", encoding="utf-8")
with open("notes.txt", encoding="utf-8") as f:   # 离开代码块自动关闭文件
    for line in f:
        print(line.rstrip())
```

## 模块与导入

```typescript
import { readFile } from "node:fs/promises";
import * as path from "node:path";
export function helper() {}
```

```python
from pathlib import Path          # 从模块导入名字
import json                       # 导入整个模块，用 json.loads 访问
import numpy as np                # 起别名，数据科学圈的固定写法
from .utils import helper         # 相对导入，只能在包内部用
```

Python 没有 `export`：模块里所有不以下划线开头的顶层名字都可以被导入。一个文件就是一个模块，一个带 `__init__.py` 的目录是一个包。

你会在几乎所有脚本末尾看到这段：

```python
def main() -> None:
    print("running")

if __name__ == "__main__":
    main()
```

意思是「只有直接运行这个文件时才执行 `main()`，被别的文件 `import` 时不执行」。相当于 Node 里判断「当前模块是不是入口文件」，CommonJS 写作 `require.main === module`。

## 异步：asyncio

Node 的 I/O 天生异步；Python 默认是同步的，`requests.get()` 会阻塞整个线程。要并发发请求，用 `asyncio`：

```typescript
async function fetchAll(ids: number[]) {
  return Promise.all(ids.map((id) => fetchOne(id)));
}
await fetchAll([1, 2, 3]);
```

```python
import asyncio

async def fetch_one(i: int) -> str:
    await asyncio.sleep(0.1)          # 模拟一次网络请求
    return f"result {i}"

async def main() -> None:
    results = await asyncio.gather(*(fetch_one(i) for i in [1, 2, 3]))  # Promise.all
    print(results)

    async with asyncio.TaskGroup() as tg:      # 3.11+，任一任务失败会取消其余任务
        t1 = tg.create_task(fetch_one(4))
        t2 = tg.create_task(fetch_one(5))
    print(t1.result(), t2.result())

asyncio.run(main())                   # 顶层没有 await，要用 asyncio.run 启动事件循环
```

几个要点：

- 协程函数调用后不会自动执行，必须 `await` 或交给 `gather` / `create_task`。这点和 JS 的 Promise 一创建就开始跑不同
- 在 `async def` 里调用同步阻塞函数（比如 `time.sleep`、同步 HTTP 客户端）会卡住整个事件循环
- 写一次性脚本时，同步代码往往更简单。真正需要并发调用模型 API 时再上 `asyncio`，第 7 章有完整例子

## 常见坑速查

| 现象 | 原因 | 正确做法 |
|---|---|---|
| `if items:` 判断空数组和 JS 结果相反 | 空容器为假 | 有意为之，善用它；区分 None 时写 `is None` |
| 函数默认值里的列表越积越多 | 默认值只求值一次 | 默认值用 `None` |
| `IndentationError` | 混用 Tab 和空格或缩进不一致 | 编辑器统一 4 空格，交给 ruff 格式化 |
| `d.key` 报 `AttributeError` | dict 不支持点访问 | `d["key"]` 或 `d.get("key")` |
| `round(2.5)` 等于 2 | 银行家舍入 | 金额用 `Decimal` 或整数分 |
| 改了一个列表，另一个变量也变了 | 赋值只是引用 | `xs.copy()`、`list(xs)`，嵌套结构用 `copy.deepcopy` |
| 脚本 `import` 自己写的 `json.py` 出问题 | 和标准库模块重名 | 别用标准库模块名给自己的文件命名 |

## 本章要点

- Python 是动态类型语言，类型标注只给工具看，运行时不检查
- 缩进即代码块，命名用 `snake_case`，`None` 是唯一的空值
- 空列表、空字典是假值，这和 JS 相反
- `list` / `tuple` / `dict` / `set` 对应 Array / 只读元组 / Object / Set；切片和推导式是最常用的两种语法
- 关键字参数是 Python API 的主流风格，`*` 之后的参数只能按名字传
- 默认参数不要用可变对象；数据结构用 `dataclass`，校验外部数据用 Pydantic
- 异步要显式用 `asyncio`，`asyncio.gather` 相当于 `Promise.all`

## 动手练习

1. **预测可变默认参数**：把[可变默认参数的坑](#可变默认参数的坑)里的 `add_item` 存成 `ex1.py`，在末尾写 `a = add_item(1)`、`b = add_item(2)`、`print(a, b, a is b)`，先写下你预测的输出，再用 `uv run ex1.py` 运行；然后改成 `add_item_ok` 的写法再跑一次。

   验证：第一次输出是 `[1, 2] [1, 2] True`；改用 `None` 默认值后输出 `[1] [2] False`。

   参考答案：默认值 `[]` 在 `def` 执行时只创建一次，两次调用拿到的是同一个列表对象，所以 `a` 和 `b` 是同一个东西。

2. **把 filter / map 改写成推导式**：给定 `users = [{"id": 1, "name": "Ada", "active": True}, {"id": 2, "name": "Linus", "active": False}, {"id": 3, "name": "Grace", "active": True}]`，用推导式写出 TS 里 `users.filter(u => u.active).map(u => u.name.toUpperCase())` 和 `Object.fromEntries(users.map(u => [u.id, u.name]))` 的等价代码。顺便打印 `bool([])`、`bool({})`、`bool([0])`。

   验证：输出 `['ADA', 'GRACE']`、`{1: 'Ada', 2: 'Linus', 3: 'Grace'}`，以及 `False False True`。

   参考答案：

   ```python
   names = [u["name"].upper() for u in users if u["active"]]
   by_id = {u["id"]: u["name"] for u in users}
   print(names, by_id)
   print(bool([]), bool({}), bool([0]))   # 空容器为假；有元素就为真，哪怕元素是 0
   ```

3. **量出 gather 的并发效果**：写一个 `async def fetch_one(i)`，里面 `await asyncio.sleep(1)`。在 `main` 里先用 `for` 循环逐个 `await` 三次，再用 `asyncio.gather` 同时跑三个，分别用 `time.perf_counter()` 计时；最后在 `main` 里直接调用 `fetch_one(99)` 而不 `await`。

   验证：逐个 `await` 约 3.0 秒，`gather` 约 1.0 秒；最后一行会触发 `RuntimeWarning: coroutine 'fetch_one' was never awaited`，`sleep` 根本没有执行。

   参考答案：逐个 `await` 是串行等待；`gather` 让三个协程在同一个事件循环里交替等待。协程函数调用后只得到一个协程对象，不像 JS 的 Promise 那样一创建就开始跑。
