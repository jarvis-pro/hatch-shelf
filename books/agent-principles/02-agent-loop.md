# agent loop

上一章说 agent 的核心是「在循环里使用工具」。这一章把这个循环拆开：它每一轮做什么、靠什么停下来、消息是怎么一轮轮累积起来的，以及为什么几十行代码的循环就能撑起一个编码 agent。读完你会发现，Claude Code 这类产品最核心的部分并不神秘，复杂度都在循环之外。

## 循环的骨架

几乎所有 agent 的主体都是同一个结构：

```mermaid
flowchart TD
  S["收到任务"] --> C["组装上下文：<br/>system + 历史<br/>+ 工具定义"]
  C --> M["调用模型"]
  M --> D{"模型要调用工具吗？"}
  D -->|"是"| X["执行工具<br/>（经过权限检查）"]
  X --> R["把工具结果追加到历史"]
  R --> G{"超过轮数 / 预算？"}
  G -->|"否"| C
  G -->|"是"| F["强制停止，报告现状"]
  D -->|"否"| E["输出最终回答，结束"]
```

用一句话说：**模型提议行动，程序执行行动，结果反馈给模型，直到模型认为完成**。模型从不直接碰外部世界，它只能「说」自己想调用什么工具、参数是什么；真正执行的永远是你的代码。这条边界是后面讨论权限和安全的基础。

## 一个最小实现

下面用 Anthropic 的 TypeScript SDK（`@anthropic-ai/sdk`）写一个最小 agent，只有一个工具：读文件。Messages API 的工具调用协议多年来保持稳定，但具体模型名请以官方文档为准，这里从环境变量读取。

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";

const client = new Anthropic(); // 从 ANTHROPIC_API_KEY 读密钥
const MODEL = process.env.MODEL!; // 例如官方文档列出的最新 Sonnet 模型
const MAX_TURNS = 20;

const tools: Anthropic.Tool[] = [
  {
    name: "read_file",
    description: "读取仓库内一个文本文件的完整内容。路径相对于仓库根目录。",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "如 app/src/reader/bridge.ts" } },
      required: ["path"],
    },
  },
];

async function runTool(name: string, input: any): Promise<string> {
  if (name === "read_file") {
    try {
      return await readFile(input.path, "utf8");
    } catch (e) {
      return `读取失败：${(e as Error).message}`;
    }
  }
  return `未知工具：${name}`;
}

export async function agent(task: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: task }];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: "你是一个代码助手。需要信息时先用工具查看，不要猜测文件内容。",
      tools,
      messages,
    });

    // 模型的整条回复（可能同时包含文字和多个工具调用）原样放回历史
    messages.push({ role: "assistant", content: res.content });

    if (res.stop_reason !== "tool_use") {
      // 没有工具调用：模型认为任务完成
      return res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    }

    // 执行本轮所有工具调用，结果作为一条 user 消息返回
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type === "tool_use") {
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: await runTool(block.name, block.input),
        });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return "达到最大轮数，任务未完成。";
}
```

不到 70 行，但已经具备了 agent 的全部要素：循环、工具、模型决定何时停止。几个值得注意的细节：

- **工具结果走 `user` 角色**：从协议角度看，工具执行结果是「环境」给模型的输入，和用户输入同属外部信息
- **`tool_use_id` 必须对上**：模型一轮可以并行发起多个工具调用，结果要逐一按 id 回填
- **错误也是结果**：读文件失败不抛异常，而是把错误信息返回给模型，让它自己决定换个路径还是放弃。这是 agent 自我纠错的基础，第 3 章会细讲
- **轮数上限是保险丝**：没有它，一个陷入死循环的 agent 会一直烧钱

[《动手构建 Agent》](../build-your-agent/)会从这个骨架出发，逐步加上更多工具、记忆、评测，最后换成 Agent SDK。

## 消息历史是怎么长大的

跑一个任务「`bridge.ts` 里定义了哪些消息类型？」，messages 数组会这样增长：

```text
[0] user       : bridge.ts 里定义了哪些消息类型？
[1] assistant  : (文字) 我先找到这个文件。
                 (tool_use id=t1) read_file {path: "app/src/reader/bridge.ts"}
[2] user       : (tool_result t1) <文件全文，约 3000 token>
[3] assistant  : (文字) 文件里定义了以下几类消息……
```

每一轮调用都要把**整个数组**重新发给模型。这带来一个重要后果：

![一个 20 轮任务中，每轮输入 token 随历史增长、累计输入 token 呈二次方上升](assets/context-growth.svg)

假设 system 加工具定义占 3000 token，每轮新增约 2000 token（模型输出加工具结果），第 $n$ 轮的输入约为 $3000 + 2000(n-1)$，20 轮累计输入约 44 万 token。**单轮成本线性增长，总成本按二次方增长**。这就是为什么长任务一定要关心上下文管理（第 6 章），也是 prompt 缓存对 agent 格外重要的原因：前缀不变的部分可以命中缓存，大幅降低重复部分的成本。

## 停止条件

一个 agent 什么时候停下来，比看上去复杂。常见的停止条件有四类：

| 停止条件 | 谁触发 | 说明 |
|---|---|---|
| 模型不再调用工具 | 模型 | 正常结束，模型认为任务完成 |
| 轮数或 token 预算耗尽 | 程序 | 保险丝，防止失控 |
| 需要人类输入 | 模型或程序 | 遇到歧义、危险操作，主动暂停等待确认 |
| 外部信号 | 用户 | 用户按下中断、超时、进程退出 |

难点在第一类：**模型说「完成了」不等于真的完成了**。模型有很强的倾向在看起来差不多的时候宣布胜利，比如改完代码没跑测试就说「已修复」。对付它的办法不是在 prompt 里写「请务必确认」，而是给它**客观的完成判据**：

- hatch-shelf 的 `CLAUDE.md` 写着「声明任务完成前必须通过 `pnpm typecheck` 和 `pnpm test`」，这就是把完成条件从模型的主观判断变成可执行的检查
- 更进一步，可以在程序里强制：模型想停止时，自动跑测试，没通过就把失败输出塞回去，继续循环。Claude Code 的 Stop hook 就能实现这种机制，[《编码 Agent 实战》](../coding-agents/)会讲具体写法

## 反馈信号决定 agent 的上限

agent 能自我纠错，前提是环境给出了**有信息量的反馈**。对比两种工具返回：

```text
差：命令执行失败。
好：pnpm typecheck 退出码 2
    app/src/reader/bridge.ts(42,7): error TS2322:
    Type 'string' is not assignable to type 'ReaderMessage'.
```

第一种，模型只能瞎猜；第二种，它能直接定位到第 42 行。这就是为什么编码 agent 效果最好：编译器、类型检查、测试、linter 都是现成的高质量反馈源。hatch-shelf 开启 ESLint 的 `no-floating-promises`，除了保护人，也在给 agent 一个更早、更准的报错信号。

一个经验法则：**想让 agent 在某个领域做得好，先问这个领域有没有「编译器」**。没有的话，想办法造一个：写校验脚本、写断言、让另一个模型当评审（第 4 章）。

## 循环之外的复杂度

真实产品中的 agent loop 当然比上面的 70 行复杂，但多出来的部分基本都在循环**周围**，而不是改变循环本身：

```mermaid
flowchart TD
  subgraph 前
    direction TB
    A1["加载 CLAUDE.md /<br/>记忆"] ~~~ A2["组装工具列表"]
  end
  subgraph 循环中
    direction TB
    B1["流式输出给用户"] ~~~ B2["权限检查 /<br/>用户确认"] ~~~ B3["hooks：工具前后"] ~~~ B4["上下文快满时<br/>压缩"]
  end
  subgraph 后
    direction TB
    C1["Stop 检查"] ~~~ C2["保存会话 /<br/>写记忆"]
  end
  前 --> 循环中 --> 后
```

- **流式输出**：让用户实时看到模型的思考和行动，随时可以打断
- **权限检查**：执行工具前判断是否需要用户确认（第 9 章）
- **hooks**：在工具调用前后插入确定性的代码，比如改完文件自动格式化
- **上下文压缩**：历史太长时做摘要（第 6 章）
- **会话持久化**：中断后可以恢复

理解这一点有个实际好处：遇到 agent 行为异常时，你知道该往哪里排查。是模型判断错了（循环内），还是喂给它的上下文有问题（循环前），还是工具返回的信息不够（工具层）？

## 本章要点

- agent loop：**模型提议 → 程序执行 → 结果回填 → 再次调用**，直到模型不再调用工具
- 模型从不直接执行操作，执行权永远在你的代码里
- 每轮都重发完整历史，单轮成本线性增长、**总成本二次方增长**
- 必须有轮数和预算上限；「模型说完成了」不可靠，要用测试等**客观判据**定义完成
- 工具返回的反馈越具体，agent 自我纠错能力越强；有「编译器」的领域最适合 agent
- 产品级 agent 的复杂度主要在循环周围：流式、权限、hooks、压缩、持久化
