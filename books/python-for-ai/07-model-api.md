# 调模型 API

[《大模型应用工程》](../llm-app-engineering/)用 TypeScript 讲了调用模型 API 的方方面面：参数、结构化输出、工具调用、流式、缓存、重试。这一章不重复那些概念，而是回答一个更具体的问题：**同样的事情，在 Python 里怎么写**。你会发现 Python SDK 和 TS SDK 几乎一一对应，真正的差别在语言层面：关键字参数、同步与异步两套客户端、用 Pydantic 而不是 zod 描述输出结构。

为什么要会用 Python 调模型？因为很多 AI 工作天然发生在 Python 里：在 notebook 里批量试 prompt、用 Pandas 分析评测结果、给数据集打标签、写一次性的数据清洗脚本。这些场景下再切回 TS 反而麻烦。

## 准备

```bash
uv add anthropic
export ANTHROPIC_API_KEY=...        # 或者写进 .env，用 pydantic-settings 读取（第 3 章）
```

示例以 Anthropic 的 Python SDK（`anthropic` 包，写作时为 2.x）为准，模型 ID 统一放在常量里。写作时（2026 年 11 月）的当前型号是 `claude-opus-5-5`、`claude-sonnet-5-5`、`claude-haiku-5-5`，型号更新很快，用之前查一下官方文档的模型列表。

## 第一次调用

TS 版：

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const response = await client.messages.create({
  model: "claude-opus-5-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "用一句话解释什么是虚拟环境" }],
});
for (const block of response.content) {
  if (block.type === "text") console.log(block.text);
}
```

Python 版：

```python
import anthropic

MODEL = "claude-opus-5-5"
client = anthropic.Anthropic()        # 从环境变量 ANTHROPIC_API_KEY 读取密钥

response = client.messages.create(
    model=MODEL,
    max_tokens=1024,
    messages=[{"role": "user", "content": "用一句话解释什么是虚拟环境"}],
)
for block in response.content:
    if block.type == "text":
        print(block.text)

print(response.stop_reason)                                    # end_turn / max_tokens / ...
print(response.usage.input_tokens, response.usage.output_tokens)
```

差别一目了然：

| | TS SDK | Python SDK |
|---|---|---|
| 客户端 | `new Anthropic()` | `anthropic.Anthropic()`（同步）/ `anthropic.AsyncAnthropic()`（异步） |
| 调用 | `await client.messages.create({...})` | `client.messages.create(...)`，参数是关键字参数 |
| 参数命名 | `max_tokens`（与 API 一致） | `max_tokens`（与 API 一致） |
| 消息 | 对象字面量 | dict 字面量，键要加引号 |
| 响应对象 | 带类型的普通对象 | Pydantic 模型，用属性访问：`response.usage.input_tokens` |
| 区分内容块 | `block.type === "text"` 收窄 | `block.type == "text"`，pyright 同样能收窄 |
| 结构化输出 | zod + 辅助函数 | Pydantic 模型 + `client.messages.parse` |
| 超时单位 | 毫秒 | 秒 |

响应对象本身就是 Pydantic 模型，所以第 3 章的那些方法都能用：`response.model_dump()` 转成 dict，`response.model_dump_json()` 存成 JSON 日志。

### 系统提示和多轮对话

```python
import anthropic

MODEL = "claude-opus-5-5"
client = anthropic.Anthropic()

history: list[anthropic.types.MessageParam] = []

def chat(user_text: str) -> str:
    history.append({"role": "user", "content": user_text})
    response = client.messages.create(
        model=MODEL,
        max_tokens=2048,
        system="你是一位耐心的 Python 老师，读者是熟练的 TypeScript 开发者。回答简短，必要时给 TS 对照。",
        messages=history,
    )
    history.append({"role": "assistant", "content": response.content})   # 原样放回完整内容块
    return "".join(b.text for b in response.content if b.type == "text")

print(chat("Python 的列表推导式相当于 TS 的什么？"))
print(chat("那字典推导式呢？"))
```

API 是无状态的，每次都要把完整的历史发过去。把 `response.content` 原样放回历史（而不是只放提取出的文字），是官方推荐的做法：内容块里除了文字，还可能有工具调用、思考块等需要回传的信息。

`anthropic.types.MessageParam` 是 SDK 导出的类型（一个 `TypedDict`），给 `history` 标上它，pyright 就能检查你拼的消息结构对不对。不要自己重新定义一套。

## 流式输出

```python
import anthropic

MODEL = "claude-opus-5-5"
client = anthropic.Anthropic()

with client.messages.stream(
    model=MODEL,
    max_tokens=4096,
    messages=[{"role": "user", "content": "写一段 200 字左右的 uv 介绍"}],
) as stream:
    for text in stream.text_stream:          # TS 里是 for await (const ev of stream)
        print(text, end="", flush=True)
    final = stream.get_final_message()       # 完整的消息，含 usage

print()
print(final.usage.output_tokens)
```

`with` 语句（第 1 章讲过的上下文管理器）保证流结束或出错时连接被正确关闭。输出很长或 `max_tokens` 设得很大时，应该用流式接口，避免一次性请求等太久触发超时；不需要逐字显示的话，直接调用 `get_final_message()` 拿结果即可。

## 结构化输出：Pydantic 模型直接当 schema

这是 Python SDK 最顺手的地方。第 3 章说过，Pydantic 模型可以导出 JSON Schema；SDK 的 `messages.parse` 把这件事自动化了：传入模型类，SDK 生成 schema 发给 API，拿到结果后再用同一个模型校验，返回一个类型完整的对象。

```python
from typing import Literal

import anthropic
from pydantic import BaseModel, Field

MODEL = "claude-opus-5-5"
client = anthropic.Anthropic()

class Ticket(BaseModel):
    """一条客服工单的分类结果。"""
    category: Literal["bug", "billing", "feature", "other"]
    urgency: int = Field(ge=1, le=5, description="1 最不紧急，5 最紧急")
    summary: str = Field(description="一句话概括用户的问题")

response = client.messages.parse(
    model=MODEL,
    max_tokens=1024,
    messages=[{"role": "user", "content": "付款之后会员没生效，已经两天了，客服也不回！"}],
    output_format=Ticket,
)
ticket = response.parsed_output        # 类型是 Ticket | None
if ticket is not None:
    print(ticket.category, ticket.urgency, ticket.summary)
```

和 TS 版对照：

| | TS | Python |
|---|---|---|
| 描述结构 | zod schema | Pydantic 模型 |
| 调用 | 结构化输出辅助函数 + zod | `client.messages.parse(..., output_format=Model)` |
| 拿结果 | 解析后的对象 | `response.parsed_output`，是 `Model` 的实例 |

两个值得知道的细节：

- API 的结构化输出只支持 JSON Schema 的一个子集，像「最小值」「最短长度」这类约束不一定能直接表达。写作时的 SDK 会把这些约束改写进字段的 `description` 里提示模型，拿到结果后再在本地用 Pydantic 完整校验；校验不通过会抛 `pydantic.ValidationError`，要准备好处理
- `parsed_output` 的类型是 `Ticket | None`：模型拒绝回答、输出被 `max_tokens` 截断时可能拿不到结果，先检查 `stop_reason`，或者像上面这样判空

## 看图：识别进货单

hatch-counter 用视觉模型识别手写的进货单。它的服务端是 NestJS，但这类功能的原型完全可以先在 Python 里做：在 notebook 里拿几张真实的单子反复调 prompt 和 schema，满意了再移植。下面是核心代码：

```python
import base64
from pathlib import Path
from typing import Literal

import anthropic
from pydantic import BaseModel, Field

MODEL = "claude-opus-5-5"
client = anthropic.Anthropic()

class LineItem(BaseModel):
    name: str = Field(description="食材名称，按单据原文")
    quantity: float = Field(gt=0)
    unit: Literal["斤", "公斤", "箱", "袋", "个", "瓶", "桶"]
    unit_price_cents: int = Field(ge=0, description="单价，单位：分")

class PurchaseSlip(BaseModel):
    supplier: str = Field(description="供应商名称")
    slip_date: str = Field(description="单据日期，格式 YYYY-MM-DD；看不清就填空字符串")
    items: list[LineItem]
    unreadable: list[str] = Field(default_factory=list, description="看不清、无法确定的行，原样描述")

def read_slip(path: Path) -> PurchaseSlip | None:
    data = base64.standard_b64encode(path.read_bytes()).decode("ascii")
    response = client.messages.parse(
        model=MODEL,
        max_tokens=4096,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}},
                {"type": "text", "text": "这是一张餐馆的进货单照片。逐行提取品名、数量、单位和单价。不确定的内容放进 unreadable，不要猜。"},
            ],
        }],
        output_format=PurchaseSlip,
    )
    return response.parsed_output

slip = read_slip(Path("mock-data/01-七月/进货单/07-01 老王蔬菜 进货单.jpg"))
if slip:
    for item in slip.items:
        print(item.name, item.quantity, item.unit, item.unit_price_cents / 100)
```

几个设计上的考虑，和语言无关，但在这里一起说：

- 金额用 `int` 表示「分」，避免浮点误差，也绕开了 `Decimal` 在 JSON Schema 里的歧义
- 单位用 `Literal` 枚举，模型只能从中选，下游扣库存时不用再做模糊匹配
- 给模型一个「看不清」的出口（`unreadable`），比逼它每一项都给出答案更可靠；人工复核时只需要看这些
- 图片放在文字之前，是官方文档推荐的顺序

多模态应用的完整讨论（OCR 的边界、怎么拍照、如何评测识别准确率）在[《多模态应用》](../multimodal-ai/)里。

## 错误处理与重试

SDK 默认会对连接错误、429、5xx 等自动重试 2 次（指数退避），超时默认 10 分钟。可以在客户端或单次请求上调整：

```python
import anthropic

client = anthropic.Anthropic(max_retries=4, timeout=60.0)       # 秒，不是毫秒
quick = client.with_options(timeout=10.0, max_retries=0)         # 单次覆盖，不修改原客户端
```

自动重试之后仍然失败的，按异常类型分别处理，从具体到宽泛：

```python
import anthropic

client = anthropic.Anthropic()

try:
    response = client.messages.create(
        model="claude-opus-5-5",
        max_tokens=1024,
        messages=[{"role": "user", "content": "hi"}],
    )
except anthropic.BadRequestError as e:          # 400：请求本身有问题，重试没用
    print("请求错误：", e.message)
except anthropic.AuthenticationError:           # 401：密钥不对
    print("检查 ANTHROPIC_API_KEY")
except anthropic.RateLimitError as e:           # 429：已经自动重试过，仍然限流
    print("限流，retry-after =", e.response.headers.get("retry-after"))
except anthropic.APIStatusError as e:           # 其他 HTTP 错误
    print("API 错误", e.status_code)
except anthropic.APIConnectionError:            # 网络问题
    print("网络错误")
```

`except` 按类型分支，正是第 1 章说的 Python 风格；TS 里要写一串 `instanceof`。区分「可重试」和「不可重试」的意义，《大模型应用工程》的错误与重试一章讲得更细。

## 并发：AsyncAnthropic

识别一个月的几十张进货单，一张一张串行调用太慢。用异步客户端加信号量控制并发数：

```python
import asyncio

import anthropic

MODEL = "claude-opus-5-5"
client = anthropic.AsyncAnthropic()
limit = asyncio.Semaphore(4)                    # 最多同时 4 个请求，避免撞上限流

async def summarize(text: str) -> str:
    async with limit:
        response = await client.messages.create(
            model=MODEL,
            max_tokens=512,
            messages=[{"role": "user", "content": f"用一句话总结：\n\n{text}"}],
        )
    return "".join(b.text for b in response.content if b.type == "text")

async def main() -> None:
    docs = ["第一篇文章……", "第二篇文章……", "第三篇文章……"]
    results = await asyncio.gather(*(summarize(d) for d in docs), return_exceptions=True)
    for doc, result in zip(docs, results):
        if isinstance(result, BaseException):
            print("失败：", doc[:10], result)
        else:
            print(result)

asyncio.run(main())
```

对照 TS：`asyncio.Semaphore` 相当于 `p-limit`，`asyncio.gather(..., return_exceptions=True)` 相当于 `Promise.allSettled`。

如果结果不急着要（比如每晚跑一批数据），可以用 API 的批处理接口（Message Batches）：提交一批请求，异步处理完再取结果，价格比实时调用便宜。SDK 里是 `client.messages.batches`，具体折扣和限制以官方文档为准。

## 控制成本的几个习惯

在 Python 里批量调用模型，最容易出的事故是**一不小心跑了几千次请求**。几个习惯：

- **先小样本**：在 notebook 里先跑 5 条，看输出和 `usage`，估算总成本，再跑全量
- **缓存结果**：把每条输入的结果存成 JSON 文件（或 SQLite），重跑时跳过已完成的，脚本中途崩了也不用从头再来
- **记录用量**：把 `response.usage` 写进日志，用 Pandas 汇总，按模型和任务看花费
- **按任务选模型**：简单的分类、抽取可以试试更便宜的型号，或者调低 `output_config` 里的 `effort`（推理深度），在小样本上对比效果再决定。各型号的能力和价格以官方文档为准
- **长前缀用缓存**：同一份很长的系统提示被反复使用时，开启 prompt caching，原理见《大模型应用工程》

下一章的小工具会把「缓存结果」和「先小样本」做进代码里。

## 本章要点

- Python SDK 和 TS SDK 结构几乎一致：`messages.create`、`messages.stream`，参数改成关键字参数，客户端分同步和异步两种
- 响应对象是 Pydantic 模型，可以直接 `model_dump_json()` 存日志；消息历史用 SDK 导出的 `MessageParam` 类型
- 结构化输出用 `client.messages.parse(output_format=Model)`，同一个 Pydantic 模型既生成 schema 又校验结果；记得处理 `None` 和校验失败
- 图片以 base64 内容块传入，放在文字之前；schema 里给模型留「看不清」的出口
- SDK 自带重试；剩下的错误按异常类型从具体到宽泛处理
- 并发用 `AsyncAnthropic` + `asyncio.Semaphore` + `gather`；批量任务先小样本、缓存结果、记录用量

## 动手练习

1. **不调 API，先验证并发骨架**：把[并发：AsyncAnthropic](#并发asyncanthropic)里的模型调用换成 `await asyncio.sleep(1)`，信号量设为 4，同时提交 8 个任务，并让第 6 个任务（`i == 5`）抛一个 `RuntimeError`。

   ```python
   limit = asyncio.Semaphore(4)

   async def fake_call(i: int) -> str:
       async with limit:
           await asyncio.sleep(1)          # 假装是一次 1 秒的模型调用
       if i == 5:
           raise RuntimeError("模拟 429")
       return f"ok {i}"
   ```

   验证：用 `time.perf_counter()` 计时 `asyncio.gather(..., return_exceptions=True)`，总耗时约 2.0 秒；结果列表里有 1 个是异常对象，其余 7 个是字符串，程序没有中途退出。

   参考答案：8 个任务、每次最多 4 个同时进行，分两批，所以约 2 秒；`return_exceptions=True` 让失败以返回值的形式出现，相当于 `Promise.allSettled`。

2. **触发一次 AuthenticationError**：用 `anthropic.Anthropic(api_key="sk-ant-invalid", max_retries=0)` 创建客户端，套上[错误处理与重试](#错误处理与重试)里的 `try/except` 发一次请求。不需要有效的 key，但需要能连上 API。

   验证：走进 `except anthropic.AuthenticationError` 分支，`e.status_code` 是 `401`；断网再跑一次，走进 `APIConnectionError` 分支。

   参考答案：SDK 把 HTTP 状态码映射成不同的异常类，401 不会被自动重试；网络层的失败是另一类异常，和 HTTP 错误分开处理。

3. **结构化输出看边界**（需要 API key）：用本章的 `Ticket` 和 `messages.parse`，对三条输入各调一次：一条明确的账单问题、一条功能建议、一条「你好」。每次打印 `response.stop_reason`、`response.parsed_output` 和 `response.usage.input_tokens`。

   验证：前两条应分别得到 `billing` 和 `feature` 类别的 `Ticket` 实例；第三条观察模型如何归类（多半是 `other`），以及 `urgency` 是否落在 1–5 之间。三次的 `input_tokens` 都包含了 schema 带来的开销。

   参考答案：`parsed_output` 是本地用 Pydantic 校验过的对象，所以 `urgency` 越界会变成 `ValidationError` 而不是悄悄进入下游；输入很模糊时，`Literal` 里留一个 `other` 能给模型一个合理的出口。
