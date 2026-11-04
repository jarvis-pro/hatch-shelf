# 类型标注与 Pydantic

习惯了 TypeScript 的人，第一次写 Python 时最不安的是：没有类型，重构全靠胆子。其实现代 Python 有一套相当完整的类型系统，写法和 TS 很像；再加上 Pydantic 这个「Python 版 zod」，你可以在 Python 里重建熟悉的工作方式：**静态类型管代码内部，运行时校验管系统边界**。

这一章先把 TS 类型和 Python 类型标注一一对上，再讲怎么让检查器真正跑起来，最后用 Pydantic 校验外部数据，并顺手生成 JSON Schema：调用大模型做结构化输出时，正是靠它。

## 类型标注是什么，不是什么

```python
def total(prices: list[float]) -> float:
    return sum(prices)

total(["1.5", "2"])   # 解释器照样执行，直到 sum 内部才抛 TypeError
```

和 TS 相比有两个根本差别：

| | TypeScript | Python |
|---|---|---|
| 谁来检查 | `tsc`，编译不过就不产出 JS | 独立的检查器（pyright、mypy），解释器完全不看 |
| 不检查会怎样 | 一般跑不起来（除非用 tsx 这类只擦类型的工具） | 照样运行，类型错了就在运行时某处出错 |

换句话说，Python 的类型标注和「Node 直接跑 TS、只擦除类型」的模式很像：类型只对工具有意义。所以**必须把检查器接进编辑器和 CI**，否则标注只是注释。

对上面的代码运行 mypy：

```bash
uvx mypy ty1.py
```

```text
ty1.py:4: error: List item 0 has incompatible type "str"; expected "float"  [list-item]
ty1.py:4: error: List item 1 has incompatible type "str"; expected "float"  [list-item]
Found 2 errors in 1 file (checked 1 source file)
```

## TS 类型与 Python 类型对照

| TypeScript | Python（3.12+ 写法） | 说明 |
|---|---|---|
| `string` / `number` / `boolean` | `str` / `int`、`float` / `bool` | `int` 可以传给标注为 `float` 的参数 |
| `null` / `undefined` | `None` | |
| `T[]` | `list[T]` | 3.9 起内置类型可直接加方括号，不用 `typing.List` |
| `readonly T[]` | `Sequence[T]`（`collections.abc`） | 只读视角的参数类型 |
| `[number, string]` | `tuple[int, str]` | 变长：`tuple[int, ...]` |
| `Record<string, T>` | `dict[str, T]` | 只读视角：`Mapping[str, T]` |
| `Set<T>` | `set[T]` | |
| `A \| B` | `A \| B` | 3.10 起支持，和 TS 写法一样 |
| `T \| undefined`、可选参数 | `T \| None` | 旧代码里写成 `Optional[T]` |
| `"a" \| "b"` | `Literal["a", "b"]` | |
| `any` | `Any` | 关掉检查 |
| `unknown` | `object` | 用前要收窄 |
| `never` | `Never`（或返回值用 `NoReturn`） | |
| `(x: number) => string` | `Callable[[int], str]` | |
| `type Id = string` | `type Id = str` | 3.12 的 `type` 语句 |
| `function f<T>(x: T): T` | `def f[T](x: T) -> T` | 3.12 的泛型语法（PEP 695） |
| `interface`（描述对象形状） | `TypedDict` / `Protocol` / `dataclass` | 见下文，按用途选 |
| `as Foo` | `cast(Foo, x)` | 同样是「相信我」，不做运行时转换 |
| `x!` | 无，需显式判断 `if x is not None` | |

### 一段带标注的代码

```python
from collections.abc import Callable, Sequence
from typing import Literal

type Role = Literal["user", "assistant"]
type Message = dict[str, str]

def first[T](items: Sequence[T]) -> T | None:
    return items[0] if items else None

def apply_all(xs: list[int], fn: Callable[[int], int]) -> list[int]:
    return [fn(x) for x in xs]

def make_message(role: Role, text: str) -> Message:
    return {"role": role, "content": text}

print(first([3, 1, 2]))                     # 3
print(first([]))                            # None
print(apply_all([1, 2], lambda x: x * 10))  # [10, 20]
print(make_message("user", "hi"))
```

`type` 语句和 `def first[T]` 这种泛型写法是 3.12 才有的；老代码里会看到 `T = TypeVar("T")` 和 `TypeAlias`，意思相同。

### 类型收窄

和 TS 一样，检查器会根据控制流收窄联合类型：

```python
def describe(x: int | str | None) -> str:
    if x is None:
        return "空"
    if isinstance(x, int):        # 相当于 typeof x === "number"
        return f"整数 {x + 1}"
    return f"字符串 {x.upper()}"  # 这里 x 已被收窄为 str

print(describe(None), describe(41), describe("ok"))
```

`isinstance` 是运行时真实存在的检查，可以收窄类、内置类型；对 `TypedDict` 这种只存在于类型层面的东西不行，要靠判断某个键的值（类似 TS 的可辨识联合）。

## 描述「对象形状」的四种方式

TS 里一个 `interface` 走天下；Python 按用途分成几种：

| 方式 | 运行时是什么 | 校验数据吗 | 适合 |
|---|---|---|---|
| `TypedDict` | 普通 dict | 否 | 给已有的 dict 加类型，比如 JSON 解析结果、SDK 的请求参数 |
| `dataclass` | 类的实例 | 否 | 程序内部的数据结构 |
| `Protocol` | 只用于类型检查 | 否 | 结构化类型：「有这些方法的东西都行」，最像 TS 的 interface |
| Pydantic `BaseModel` | 类的实例 | **是** | 系统边界：API 请求和响应、配置、LLM 输出 |

```python
from dataclasses import dataclass
from typing import NotRequired, Protocol, TypedDict

class BookMeta(TypedDict):           # 形状描述，实例就是普通 dict
    id: str
    title: str
    tags: NotRequired[list[str]]     # 可选键，相当于 tags?: string[]

meta: BookMeta = {"id": "python-for-ai", "title": "面向 AI 的 Python"}

class Summarizer(Protocol):          # 结构化类型：不需要显式继承
    def summarize(self, text: str) -> str: ...

@dataclass
class FirstLine:
    def summarize(self, text: str) -> str:
        return text.splitlines()[0]

def run(s: Summarizer, text: str) -> str:
    return s.summarize(text)

print(meta["title"], run(FirstLine(), "第一行\n第二行"))
```

Python 的类默认是**名义类型**（按继承关系判断），这和 TS 的结构化类型不同；`Protocol` 是专门为结构化类型留的口子。

## 让检查器跑起来

两个主流检查器：

| 检查器 | 特点 |
|---|---|
| pyright | 微软出品，VS Code 的 Pylance 内核就是它，速度快，推断能力强，体验最接近 tsc |
| mypy | 历史最久的官方系检查器，生态插件多 |

Astral（uv、ruff 的作者）也在开发自己的类型检查器 ty，`uv check` 子命令与之相关，现状和成熟度以其官方文档为准。本书用 pyright：

```bash
uv add --dev pyright
uv run pyright
```

配置同样写进 `pyproject.toml`：

```toml
[tool.pyright]
pythonVersion = "3.12"
typeCheckingMode = "standard"   # basic / standard / strict，相当于 tsconfig 的 strict 程度
```

建议的起步方式和 TS 项目迁移一样：先 `standard`，新代码都写标注；核心模块再逐步开 `strict`。第三方库大多自带类型（看包里有没有 `py.typed` 文件），NumPy、Pandas、Pydantic、Anthropic SDK 都有；Pandas 的完整类型存根在单独的 `pandas-stubs` 包里。

## Pydantic：Python 版的 zod

类型标注不做运行时检查，而外部数据（HTTP 请求体、JSON 文件、环境变量、模型输出）恰恰最需要检查。Pydantic 的做法是：**用类型标注声明模型，运行时按标注校验并转换数据**。TS 里对应的是 zod：

```typescript
import { z } from "zod";

const LineItem = z.object({
  name: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.enum(["斤", "公斤", "箱", "袋", "个"]),
});
type LineItem = z.infer<typeof LineItem>;
const item = LineItem.parse(json);
```

```python
from typing import Literal
from pydantic import BaseModel, Field

class LineItem(BaseModel):
    name: str = Field(min_length=1)
    quantity: float = Field(gt=0)
    unit: Literal["斤", "公斤", "箱", "袋", "个"]

item = LineItem.model_validate({"name": "土豆", "quantity": 30, "unit": "斤"})
print(item.name, item.quantity)   # 土豆 30.0
```

注意方向的不同：zod 是先写 schema 再推导类型；Pydantic 是类本身既是类型又是 schema，不需要 `z.infer` 这一步。

### 一个完整的例子：进货单

hatch-counter 里有一个功能是拍照识别进货单：店主把供应商手写的单子拍下来，视觉模型读出供应商、日期和每一行的品名、数量、单位、单价，再补进库存。模型输出不可全信，必须校验。下面用 Pydantic 描述这份数据（字段为说明而简化）：

```python
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, field_validator

class LineItem(BaseModel):
    name: str = Field(min_length=1, description="食材名称")
    quantity: float = Field(gt=0)
    unit: Literal["斤", "公斤", "箱", "袋", "个"]
    unit_price: Decimal = Field(ge=0, decimal_places=2)

class PurchaseSlip(BaseModel):
    supplier: str
    slip_date: date
    items: list[LineItem]
    note: str | None = None

    @field_validator("supplier")
    @classmethod
    def strip_supplier(cls, v: str) -> str:
        return v.strip()

raw = {
    "supplier": " 老王蔬菜 ",
    "slip_date": "2026-07-01",
    "items": [{"name": "土豆", "quantity": "30", "unit": "斤", "unit_price": "1.8"}],
}
slip = PurchaseSlip.model_validate(raw)
print(slip.supplier, slip.slip_date, slip.items[0].quantity)   # 老王蔬菜 2026-07-01 30.0
print(slip.model_dump(mode="json"))

bad = {
    "supplier": "x",
    "slip_date": "07/01",
    "items": [{"name": "", "quantity": -1, "unit": "吨", "unit_price": "1.234"}],
}
try:
    PurchaseSlip.model_validate(bad)
except ValidationError as e:
    for err in e.errors():
        print(err["loc"], err["msg"])
```

输出：

```text
老王蔬菜 2026-07-01 30.0
{'supplier': '老王蔬菜', 'slip_date': '2026-07-01', 'items': [{'name': '土豆', 'quantity': 30.0, 'unit': '斤', 'unit_price': '1.8'}], 'note': None}
('slip_date',) Input should be a valid date or datetime, input is too short
('items', 0, 'name') String should have at least 1 character
('items', 0, 'quantity') Input should be greater than 0
('items', 0, 'unit') Input should be '斤', '公斤', '箱', '袋' or '个'
('items', 0, 'unit_price') Decimal input should have no more than 2 decimal places
```

几个值得注意的行为：

- **默认会做宽松转换**：字符串 `"30"` 被转成了 `30.0`，`"2026-07-01"` 被转成了 `date` 对象。zod 默认不转换（要用 `z.coerce`）。想要严格模式，给模型加 `model_config = ConfigDict(strict=True)`
- **一次报告全部错误**，每条带着路径（`loc`），可以直接拿来回喂给模型让它修正
- 嵌套模型、列表、可选字段都按标注自动处理
- `model_dump()` 转回 dict，`mode="json"` 会把 `date`、`Decimal` 转成 JSON 友好的字符串；`model_dump_json()` 直接得到 JSON 字符串

### 常用 API 速查

| 要做的事 | zod | Pydantic v2 |
|---|---|---|
| 从 dict 校验 | `Schema.parse(obj)` | `Model.model_validate(obj)` |
| 从 JSON 字符串校验 | `Schema.parse(JSON.parse(s))` | `Model.model_validate_json(s)`（更快） |
| 不抛异常的校验 | `safeParse` | 捕获 `ValidationError` |
| 转回普通对象 | 本来就是对象 | `m.model_dump()` / `m.model_dump_json()` |
| 复制并修改 | `{ ...obj, x: 1 }` | `m.model_copy(update={"x": 1})` |
| 自定义校验 | `.refine()` | `@field_validator` / `@model_validator` |
| 默认值 | `.default(x)` | `x: int = 0`；可变默认值用 `Field(default_factory=list)` |
| 校验非模型类型 | `z.array(z.number()).parse()` | `TypeAdapter(list[float]).validate_python()` |
| 生成 JSON Schema | `z.toJSONSchema()`（zod 4） | `Model.model_json_schema()` |

Pydantic 有 v1 和 v2 两个大版本，API 名字差别很大（v1 是 `parse_obj`、`.dict()`）。网上搜到的旧答案很多是 v1 写法，认准 `model_` 前缀的就是 v2。

### 可辨识联合

模型 API 返回的内容块、工具调用的结果，经常是「按 `type` 字段区分的几种结构」。TS 里用可辨识联合，Pydantic 里用 `discriminator`：

```python
from typing import Annotated, Literal
from pydantic import BaseModel, Field, TypeAdapter

class TextBlock(BaseModel):
    type: Literal["text"]
    text: str

class ToolUseBlock(BaseModel):
    type: Literal["tool_use"]
    name: str
    input: dict[str, object]

type Block = Annotated[TextBlock | ToolUseBlock, Field(discriminator="type")]

blocks = TypeAdapter(list[Block]).validate_python([
    {"type": "text", "text": "我来查一下"},
    {"type": "tool_use", "name": "search", "input": {"q": "uv"}},
])
for b in blocks:
    match b:
        case TextBlock(text=t):
            print("文本", t)
        case ToolUseBlock(name=n):
            print("工具", n)
```

指定 `discriminator` 后，Pydantic 直接按 `type` 选择模型，报错信息也只针对那一个分支，不会把所有分支的错误都列出来。

## 从模型到 JSON Schema

Pydantic 能把模型导出成 JSON Schema，这是它在 AI 场景里最有价值的能力之一：

```python
import json
from typing import Literal
from pydantic import BaseModel, Field

class Ticket(BaseModel):
    """一条客服工单的分类结果。"""
    category: Literal["bug", "billing", "feature", "other"]
    urgency: int = Field(ge=1, le=5, description="1 最不紧急，5 最紧急")
    summary: str = Field(description="一句话概括用户的问题")

print(json.dumps(Ticket.model_json_schema(), ensure_ascii=False, indent=2))
```

得到的 schema 包含字段类型、枚举值、范围约束和 `description`。把它交给模型 API 作为结构化输出的格式约束或工具的参数定义，模型就会按这个结构返回；拿到结果后再用同一个模型 `model_validate_json` 校验一遍。**一份定义，同时用于约束模型和校验结果**，这就是第 7 章的核心做法。Anthropic 的 Python SDK 甚至可以直接接受 Pydantic 模型。

给 LLM 用的模型有几个小建议：

- 字段的 `description` 和类的 docstring 会进入 schema，写清楚含义，这就是在写 prompt
- 枚举优先用 `Literal`，比自由文本可靠得多
- 金额这类字段，`Decimal` 在 schema 里会变成「数字或字符串」，给模型用时常改成 `float` 或「以分为单位的 `int`」，入库前再转换

## 配置与环境变量：pydantic-settings

NestJS 项目里常用 zod 或 class-validator 校验环境变量，启动时缺配置立刻失败。Python 里对应的是 `pydantic-settings`（单独的包）：

```bash
uv add pydantic-settings
```

```python
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="APP_")

    anthropic_api_key: SecretStr          # 读 APP_ANTHROPIC_API_KEY，打印时显示为 **********
    model: str = "claude-opus-5-5"        # 读 APP_MODEL，没有就用默认值
    max_concurrency: int = 4              # 环境变量是字符串，会自动转成 int

settings = Settings()  # type: ignore[call-arg]
print(settings.model, settings.max_concurrency)
```

缺少必填项时 `Settings()` 直接抛 `ValidationError`，服务起不来，这正是想要的效果。行尾的 `type: ignore` 是因为检查器不知道必填字段会从环境变量里来，会误报「缺少参数」。

`SecretStr` 防止密钥在日志和异常信息里被意外打印出来，用 `.get_secret_value()` 取真实值。`.env` 文件照例不进 Git。

## 本章要点

- Python 的类型标注只给工具看，必须把 pyright 或 mypy 接进编辑器和 CI 才有意义
- 3.12 起的写法已经很接近 TS：`A | B`、`list[T]`、`type X = ...`、`def f[T](...)`
- 描述对象形状按用途选：`TypedDict` 给 dict 加类型，`dataclass` 做内部结构，`Protocol` 做结构化类型，Pydantic 守系统边界
- Pydantic 相当于 zod：类即 schema，`model_validate` 校验并转换，错误带路径、一次报全
- `model_json_schema()` 把模型变成 JSON Schema，同一份定义既能约束模型输出，又能校验结果
- 环境变量用 `pydantic-settings` 校验，密钥用 `SecretStr`

## 动手练习

1. **运行时不管，检查器会管**：把下面的代码存成 `shout.py`，先 `uv run shout.py`，再 `uvx mypy shout.py`（或 `uvx pyright shout.py`）。

   ```python
   def shout(name: str | None) -> str:
       return name.upper() + "!"

   print(shout("ada"))
   ```

   验证：直接运行打印 `ADA!`，没有任何报错；mypy 报 `Item "None" of "str | None" has no attribute "upper"  [union-attr]`，pyright 报 `"upper" is not a known attribute of "None"`。

   参考答案：解释器不看标注，这次碰巧传的是字符串所以能跑；检查器按标注推理，知道 `name` 可能是 `None`。在前面加 `if name is None: return "!"` 收窄后，两个检查器都不再报错。

2. **宽松转换与严格模式**：定义 `class Lax(BaseModel): quantity: float`，再定义一个加了 `model_config = ConfigDict(strict=True)` 的 `Strict`，分别对 `{"quantity": "30"}` 调用 `model_validate`。

   验证：`Lax` 得到 `quantity=30.0`；`Strict` 抛 `ValidationError`，错误的 `loc` 是 `('quantity',)`，信息是 `Input should be a valid number`。

   参考答案：Pydantic 默认像 `z.coerce` 一样把字符串 `"30"` 转成数字；严格模式下类型必须原样匹配。处理模型输出时宽松模式通常更省事，但要清楚它会替你做转换。

3. **看 schema 里有什么**：用[从模型到 JSON Schema](#从模型到-json-schema)里的 `Ticket`，取 `s = Ticket.model_json_schema()`，打印 `s["description"]`、`s["required"]`、`s["properties"]["category"]["enum"]` 和 `urgency` 的 `minimum` / `maximum`。

   验证：依次看到 docstring 原文 `一条客服工单的分类结果。`、`['category', 'urgency', 'summary']`、`['bug', 'billing', 'feature', 'other']`、`1 5`。

   参考答案：docstring 成了 schema 的 `description`，`Literal` 成了 `enum`，`Field(ge=1, le=5)` 成了 `minimum` / `maximum`；没有默认值的字段都进了 `required`。这些就是第 7 章发给模型的格式约束。
