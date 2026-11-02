# 数据集构建

微调的效果几乎完全由数据决定。同样的底座、同样的超参数，一份干净、一致、覆盖到位的 500 条数据，常常胜过一份杂乱的 5 万条。这一章讲数据的格式长什么样、模型实际看到的是什么、数据从哪来、怎么清洗和切分，最后用 hatch-counter 的核单记录写一个从业务数据到训练集的转换脚本。

## 格式

主流框架都接受 JSONL（每行一个 JSON 对象）。常见三种形状：

**对话格式**（最常用）：

```json
{"messages": [{"role": "system", "content": "你是门店助手。"}, {"role": "user", "content": "今天土豆进了多少？"}, {"role": "assistant", "content": "今天土豆进了 30 斤。"}]}
```

**补全格式**：

```json
{"prompt": "把下面一行整理成 JSON：土豆 斤 30 2.5 75\n", "completion": "{\"name\":\"土豆\",\"qty\":30}"}
```

**偏好格式**（第 9 章的 DPO 用）：

```json
{"prompt": [{"role": "user", "content": "..."}], "chosen": [{"role": "assistant", "content": "好的回答"}], "rejected": [{"role": "assistant", "content": "差的回答"}]}
```

多轮对话就是 `messages` 里多放几轮；工具调用和视觉输入在 `messages` 里有各自的约定，不同框架字段名略有差异，以所用框架的文档为准。

## 模型实际看到的是什么

`messages` 只是结构化的表示。训练和推理时，它会被底座模型的 **chat template** 渲染成一串带特殊标记的文本再分词。不同家族的模板完全不同，形如：

```text
<|im_start|>system
你是门店助手。<|im_end|>
<|im_start|>user
今天土豆进了多少？<|im_end|>
<|im_start|>assistant
今天土豆进了 30 斤。<|im_end|>
```

这带来两条铁律：

1. **训练和推理必须用同一个模板**。微调时用 A 模板、部署时引擎套了 B 模板，模型会表现得像没训练过，或者停不下来。导出到 GGUF / Ollama 时尤其要检查（第 9 章）
2. **不要自己拼模板字符串**，用分词器的 `apply_chat_template`，框架一般会自动处理

自己确认一下渲染结果是个好习惯：

```python
from transformers import AutoTokenizer

tok = AutoTokenizer.from_pretrained("Qwen/Qwen3-8B")
messages = [
    {"role": "user", "content": "今天土豆进了多少？"},
    {"role": "assistant", "content": "今天土豆进了 30 斤。"},
]
print(tok.apply_chat_template(messages, tokenize=False))
```

### 只在回答上算 loss

一条样本里，system 和 user 部分是给定的条件，assistant 部分才是要学的输出。如果在整条序列上计算 loss，模型会花力气去「学会写用户的问题」和「背 system prompt」，既浪费又可能带偏。所以通常把非 assistant 部分的标签屏蔽掉，只在回答 token 上算 loss（第 7 章 mlx-lm 的 `--mask-prompt`、TRL 的对应选项）。

system prompt 很长、所有样本都一样时，这一点更重要。另一种做法是干脆在训练数据里**去掉或缩短 system prompt**，把它的效果烧进权重，推理时也就不用再带，省下每次调用的 token。但这样训练和推理的输入必须保持一致：训练时没有 system prompt，推理时也别加。

## 数据从哪来

| 来源 | 质量 | 成本 | 注意 |
|---|---|---|---|
| 业务中人工校正过的记录 | 高，且分布贴近真实 | 低（已经在产生） | 用户授权、隐私脱敏 |
| 人工标注 | 高 | 高 | 先写标注规范，多人标注要测一致性 |
| 强模型生成 + 人工抽检 | 中到高 | 中 | 检查服务条款是否允许用输出训练模型 |
| 公开数据集 | 参差 | 低 | 许可证、和你的任务分布差异 |
| 纯合成（模型自由生成） | 容易单调、有偏 | 低 | 只适合补充，不适合当主体 |

对一人公司，第一种最值钱：**任何「模型先给答案、人再确认或修改」的业务环节，都是一个数据飞轮**。设计产品时就把「原始输入 + 模型输出 + 人工最终结果」完整记下来，将来无论做评测还是微调都用得上。

用强模型生成数据时，有一个合规点要注意：多数商业 API 的服务条款限制用其输出开发竞争性模型。给自己的窄任务训练一个内部小模型是否在允许范围内，要读你所用服务的最新条款。开源模型的输出也受其许可证约束（第 1 章）。

## 多少数据才够

没有通用答案，但有几个参考点：

- LIMA 论文（Zhou 等，2023）用约 1000 条精心挑选的样本做 SFT，得到了相当好的对话效果，说明**质量和多样性比数量重要**
- 窄任务（固定格式的抽取、分类、改写）：几百条高质量样本通常就能看到明显效果，一两千条比较稳
- 要改变风格或覆盖很多子场景：几千到上万条
- 判断方法：用 25%、50%、100% 的数据各训一次，看评测分数的曲线。还在明显上升就继续加数据，已经平了就该在质量和覆盖上下功夫

## 清洗清单

| 检查 | 为什么 |
|---|---|
| 去重（完全重复和近似重复） | 重复样本会被过度学习；还会导致训练集和评测集泄漏 |
| 一致性 | 同类输入的输出格式、口径必须一致，模型学的就是这个；两个标注口径打架，模型会学成随机 |
| 长度分布 | 过长样本截断后输出不完整，模型会学会「话说一半」 |
| 错误样本 | 人工校正前的错误输出、半成品，一条坏样本的影响远大于一条好样本 |
| 隐私 | 手机号、身份证号、地址、人名等按需脱敏 |
| 覆盖 | 边界情况、罕见类别是否都有；必要时有针对性地补 |
| 负例 | 需要模型说「无法识别」「信息不足」时，训练集里要有这样的样本 |

最有效的清洗方式朴素到令人意外：**随机抽 50 条，自己逐条读一遍**。格式问题、口径不一、奇怪的脏数据，几乎都能在这一步发现。

## 切分：防止泄漏

至少切出三份：训练集、验证集（训练时看 loss、选检查点）、评测集（最终判断，训练过程中不看）。

**按实体切分，不要随机按行切**。如果同一家供货商的单子同时出现在训练集和评测集，模型可能只是记住了这家的版式，评测分数虚高，换一家新供货商就露馅。正确做法是按供货商（或用户、文档、时间段）分组，整组划入某一份。按时间切（旧数据训练、新数据评测）也很常用，更贴近上线后的真实情况。

评测集最好**在开始造训练数据之前就定下来**，而且由你亲自审过每一条。

## 案例：从核单记录到训练集

hatch-counter 的拍照录单里，每张单子都有原图、模型识别出的逐行格子、以及店主核对修正后提交的结果。假设已经把这些记录导出成 `records.jsonl`，每行形如：

```json
{"id": "r-001", "supplier": "城东蔬菜", "image": "images/r-001.jpg", "columns": ["序号", "产品名称", "单位", "数量", "单价", "金额"], "model_rows": [["1", "土豆", "斤", "30", "2.5", "75"]], "final_rows": [["1", "土豆", "斤", "30", "2.5", "75"]], "consent": true}
```

导出时就要去掉店铺名称、联系方式等与任务无关的信息；`consent` 表示这家门店同意数据用于改进识别。下面的脚本做四件事：过滤未授权和明显异常的记录、去重、按供货商分组切分、转成视觉对话格式：

```python
# build_dataset.py
import hashlib
import json
import random
from collections import defaultdict
from pathlib import Path

SRC = Path("records.jsonl")
OUT = Path("data")
SYSTEM = "你是进货单识别助手。按给定的列逐行抄写表格内容，输出 JSON 数组，每行一个数组。看不清的格子写 null。"

def load(path: Path):
    with path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)

def valid(rec) -> bool:
    if not rec.get("consent"):
        return False
    rows = rec.get("final_rows") or []
    if not rows:
        return False
    width = len(rec["columns"])
    return all(len(r) == width for r in rows)

def fingerprint(rec) -> str:
    # 同一张单子重复提交时，最终结果相同即视为重复
    key = json.dumps([rec["supplier"], rec["final_rows"]], ensure_ascii=False)
    return hashlib.sha256(key.encode()).hexdigest()

def to_example(rec):
    prompt = "表格列依次是：" + "、".join(rec["columns"]) + "。请逐行抄写。"
    answer = json.dumps(rec["final_rows"], ensure_ascii=False)
    return {
        "messages": [
            {"role": "system", "content": [{"type": "text", "text": SYSTEM}]},
            {"role": "user", "content": [{"type": "image"}, {"type": "text", "text": prompt}]},
            {"role": "assistant", "content": [{"type": "text", "text": answer}]},
        ],
        "images": [rec["image"]],
        "supplier": rec["supplier"],
        # 留着模型原始输出与最终结果是否一致，便于统计纠错率和挑难例
        "corrected": rec["model_rows"] != rec["final_rows"],
    }

def main():
    seen, by_supplier = set(), defaultdict(list)
    for rec in load(SRC):
        if not valid(rec):
            continue
        fp = fingerprint(rec)
        if fp in seen:
            continue
        seen.add(fp)
        by_supplier[rec["supplier"]].append(to_example(rec))

    suppliers = sorted(by_supplier)
    random.Random(42).shuffle(suppliers)
    n = len(suppliers)
    split = {
        "test": suppliers[: max(1, n // 10)],
        "valid": suppliers[max(1, n // 10) : max(2, n // 5)],
        "train": suppliers[max(2, n // 5) :],
    }

    OUT.mkdir(exist_ok=True)
    for name, group in split.items():
        examples = [ex for s in group for ex in by_supplier[s]]
        with (OUT / f"{name}.jsonl").open("w", encoding="utf-8") as f:
            for ex in examples:
                f.write(json.dumps(ex, ensure_ascii=False) + "\n")
        corrected = sum(ex["corrected"] for ex in examples)
        print(f"{name}: {len(group)} 家供货商, {len(examples)} 条, 其中人工改过 {corrected} 条")

if __name__ == "__main__":
    main()
```

几个设计点：

- **用人工最终结果作为答案**，而不是模型原始输出，这样训练出来的模型学的是「正确答案」
- `corrected` 字段标记了人工改过的样本。这些是当前模型的**难例**，训练时可以适当加权（比如复制一份），评测时单独统计它们的准确率
- 按供货商分组切分，评测集里全是模型训练时没见过的版式，分数更可信
- `messages` 里的 `{"type": "image"}` 加顶层 `images` 是 TRL 处理视觉数据的约定，其他框架字段名不同，按所用框架调整。视觉模型的微调比纯文本多一些配置（图像处理器、分辨率），先用纯文本的小任务熟悉流程再上

## 本章要点

- 数据格式：对话（`messages`）、补全（`prompt` / `completion`）、偏好（`chosen` / `rejected`），JSONL 存储
- 模型实际看到的是 chat template 渲染后的文本，**训练和推理必须用同一个模板**，用 `apply_chat_template` 不要手拼
- 只在 assistant 回答上计算 loss；system prompt 可以烧进权重，但训练推理要一致
- 最好的数据来源是业务中的人工校正环节，设计产品时就把输入、模型输出、最终结果完整记录下来
- 质量和多样性比数量重要；窄任务几百条就见效，用数据量曲线判断还要不要加
- 清洗：去重、一致性、长度、错误样本、隐私、覆盖、负例；随机抽 50 条亲自读
- 按实体或时间切分训练、验证、评测集，防止泄漏；评测集先于训练数据定下来
