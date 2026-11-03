# 注意力的数学推导

## 关于这本书

[《大模型原理科普》](../llm-fundamentals/)用比喻讲清了大模型「是什么」：token、注意力、Transformer、预训练、RLHF、采样。这本是它的进阶篇，回答下一层的问题：

- 注意力公式里的 $\sqrt{d_k}$ 到底从哪来，为什么不除就训练不动
- 「某模型支持 128K 上下文」「用了 GQA」「MoE，激活 37B」「4-bit 量化」这些说法，分别意味着什么代价和取舍
- 推理模型为什么「想得越久越准」，DPO 为什么能跳过奖励模型
- 研究者怎么打开模型，看它内部在算什么

**适合谁**：读过《大模型原理科普》，最好也读过[《AI 数学直觉》](../math-for-ai/)和[《动手学深度学习》](../deep-learning-basics/)，能看懂矩阵乘法、softmax、梯度这些基本记号，写过或至少读过一个 mini-GPT。不要求你会训练大模型，但要愿意跟着推导走几步。

**怎么读**：前五章是架构与推理工程（注意力 → 位置编码 → KV Cache → MoE → 长上下文），后四章是训练与分析（推理模型 → 对齐 → 量化 → 可解释性）。章节之间有依赖，但每章开头都会说明需要前面的哪些概念。代码用 Python + NumPy，复制到 Jupyter 就能跑，建议边读边改参数看结果。

科普篇讲过的直觉（Q/K/V 是「查询 / 键 / 值」、多头是「多个角度」）这里不再重复。本章把注意力写成矩阵，推一遍它的每个设计选择。

## 记号

| 记号 | 含义 | 典型值（以 Llama 3 8B 为例） |
|---|---|---|
| $n$ | 序列长度（token 数） | 最长 8192 |
| $d$ | 模型宽度（残差流维度） | 4096 |
| $h$ | 注意力头数 | 32 |
| $d_k$ | 每个头的维度，$d_k = d / h$ | 128 |
| $L$ | 层数 | 32 |
| $X \in \mathbb{R}^{n \times d}$ | 一层的输入，每行一个 token | |

向量默认是行向量，和 PyTorch 的 `x @ W` 写法一致。

## 单头注意力：三步

对一个头，先把输入投影成三份：

$$
Q = XW_Q,\quad K = XW_K,\quad V = XW_V,\qquad W_Q, W_K, W_V \in \mathbb{R}^{d \times d_k}
$$

然后：

$$
S = \frac{QK^\top}{\sqrt{d_k}} + M,\qquad A = \mathrm{softmax}_{\text{row}}(S),\qquad O = AV
$$

- $S \in \mathbb{R}^{n \times n}$：第 $i$ 行第 $j$ 列是 token $i$ 的 query 和 token $j$ 的 key 的相似度
- $M$ 是因果掩码：$j \le i$ 时 $M_{ij} = 0$，否则 $M_{ij} = -\infty$
- $A$ 每行和为 1，$O$ 的第 $i$ 行是所有 value 的加权平均

掩码用「加 $-\infty$」而不是「乘 0」，原因在 softmax 里：$e^{-\infty} = 0$，被遮住的位置在归一化之前就消失了，剩下的权重自动重新归一化。如果在 softmax 之后再乘 0，每行的和就不再是 1。

### softmax 的两条性质

**平移不变**：对任意常数 $c$，

$$
\mathrm{softmax}(z + c)_i = \frac{e^{z_i + c}}{\sum_j e^{z_j + c}} = \frac{e^{c} e^{z_i}}{e^{c}\sum_j e^{z_j}} = \mathrm{softmax}(z)_i
$$

所以实现时总是先减去每行最大值再取指数，防止 $e^{z}$ 溢出。第 5 章的 FlashAttention 正是靠这条性质，才能把一行拆成多块分别计算。

**雅可比矩阵**：记 $p = \mathrm{softmax}(z)$，则

$$
\frac{\partial p_i}{\partial z_j} = p_i(\delta_{ij} - p_j)
$$

当 $p$ 接近 one-hot（某个 $p_i \approx 1$，其余 $\approx 0$）时，所有项都接近 0：无论 $i = j$ 时的 $p_i(1-p_i)$，还是 $i \ne j$ 时的 $-p_i p_j$。**softmax 饱和，梯度消失**。这是下一节的关键。

## 为什么除以 $\sqrt{d_k}$

假设 $q$ 和 $k$ 的各分量独立，均值 0、方差 1（初始化和归一化之后大致如此）。点积

$$
q \cdot k = \sum_{t=1}^{d_k} q_t k_t
$$

每一项 $q_t k_t$ 的均值是 $\mathbb{E}[q_t]\mathbb{E}[k_t] = 0$，方差是 $\mathbb{E}[q_t^2]\mathbb{E}[k_t^2] = 1$。$d_k$ 个独立项相加，方差为 $d_k$，标准差为 $\sqrt{d_k}$。

$d_k = 128$ 时，点积的标准差约 11.3。一行里随便有几个分数相差二三十，softmax 之后几乎就是 one-hot，梯度接近 0，训练初期这些头基本学不动。除以 $\sqrt{d_k}$ 后方差回到 1，softmax 处在梯度健康的区间。

这个缩放只在「分量方差为 1」的假设下精确，所以有些模型会额外做 QK-Norm（对 $q$、$k$ 先做归一化）来进一步控制分数的尺度，这在大规模训练中能缓解注意力分数爆炸导致的不稳定。它和 $\sqrt{d_k}$ 是同一个目的：**让 softmax 的输入保持在合适的量级**。

下面用 NumPy 验证这个方差，并看看不缩放时 softmax 有多尖：

```python
import numpy as np

rng = np.random.default_rng(0)
dk, n = 128, 16
q = rng.standard_normal(dk)
K = rng.standard_normal((n, dk))

def softmax(z):
    z = z - z.max()
    e = np.exp(z)
    return e / e.sum()

raw = K @ q
print("点积标准差 ≈", raw.std().round(2), " 理论值", np.sqrt(dk).round(2))
print("不缩放，最大权重:", softmax(raw).max().round(3))
print("缩放后，最大权重:", softmax(raw / np.sqrt(dk)).max().round(3))
```

不缩放时最大权重通常在 0.9 以上，缩放后一般只有零点几。

## 多头：拆开、并行、再合并

$h$ 个头各有自己的 $W_Q^{(i)}, W_K^{(i)}, W_V^{(i)} \in \mathbb{R}^{d \times d_k}$，输出拼起来再乘输出矩阵 $W_O \in \mathbb{R}^{d \times d}$：

$$
\mathrm{MHA}(X) = \mathrm{Concat}(O^{(1)}, \dots, O^{(h)})\, W_O
$$

实现上不会真的循环 $h$ 次：把 $W_Q$ 做成 $d \times d$ 的大矩阵一次算完，再 reshape 成 `(h, n, d_k)`，用批量矩阵乘法并行算所有头。

### 换个写法：每个头是两条独立的「电路」

把 $W_O$ 按行切成 $h$ 块，$W_O^{(i)} \in \mathbb{R}^{d_k \times d}$，拼接再相乘就等于分块相乘再求和：

$$
\mathrm{MHA}(X) = \sum_{i=1}^{h} A^{(i)}\, X\, \underbrace{W_V^{(i)} W_O^{(i)}}_{W_{OV}^{(i)}\,\in\,\mathbb{R}^{d\times d}},
\qquad
A^{(i)} = \mathrm{softmax}\Big(\frac{X \overbrace{W_Q^{(i)} W_K^{(i)\top}}^{W_{QK}^{(i)}} X^\top}{\sqrt{d_k}} + M\Big)
$$

这个改写揭示了两件事：

1. 每个头由两个 $d \times d$ 的低秩矩阵（秩不超过 $d_k$）决定：$W_{QK}$ 决定**看哪里**，$W_{OV}$ 决定**看到之后往残差流里写什么**。两者相互独立
2. 各头的输出是**相加**到残差流上的，头与头之间没有直接交互

第 9 章的可解释性研究正是以这种「QK 电路 / OV 电路」视角来拆解模型的。

## 现代 Transformer 块的三处改动

科普篇画的是原始结构。今天主流的仅解码器模型（Llama、Qwen、DeepSeek 等）在细节上有三处普遍改动：

| 部件 | 原始 Transformer（2017） | 现在常见 | 动机 |
|---|---|---|---|
| 归一化位置 | 子层之后（Post-LN） | 子层之前（Pre-LN） | 残差路径上没有归一化，梯度直通，深层更好训 |
| 归一化方式 | LayerNorm | RMSNorm | 去掉均值中心化，计算更省，效果相当 |
| 前馈网络 | ReLU，两层 | SwiGLU，三个矩阵 | 门控结构，同参数量下效果更好 |
| 位置编码 | 正弦绝对位置，加在输入上 | RoPE，作用在 Q、K 上 | 见第 2 章 |

RMSNorm 和 SwiGLU 的公式：

$$
\mathrm{RMSNorm}(x) = \frac{x}{\sqrt{\frac{1}{d}\sum_{t} x_t^2 + \epsilon}} \odot g
$$

$$
\mathrm{FFN}_{\text{SwiGLU}}(x) = \big(\mathrm{SiLU}(xW_1) \odot xW_3\big) W_2,\qquad \mathrm{SiLU}(u) = u \cdot \sigma(u)
$$

SwiGLU 有三个矩阵，为了和「两层、隐层 $4d$」的传统 FFN 参数量持平，隐层通常取 $\frac{2}{3} \cdot 4d = \frac{8}{3}d$ 左右，再取整到硬件友好的倍数。

一个 Pre-LN 块写成公式：

$$
X' = X + \mathrm{MHA}(\mathrm{Norm}(X)),\qquad Y = X' + \mathrm{FFN}(\mathrm{Norm}(X'))
$$

## 算一笔账：参数和 FLOPs

以「FFN 隐层 $4d$、标准多头注意力」的块为例（SwiGLU 取 $\frac{8}{3}d$ 时结果相同）：

| 部件 | 参数量 | 每个 token 的前向 FLOPs |
|---|---|---|
| $W_Q, W_K, W_V, W_O$ | $4d^2$ | $8d^2$ |
| FFN | $8d^2$ | $16d^2$ |
| $QK^\top$ 与 $AV$ | 0 | $4nd$ |
| 合计（每层） | $12d^2$ | $24d^2 + 4nd$ |

两条规律：

- 矩阵乘一个向量，每个参数贡献一次乘法和一次加法，所以**前向 FLOPs ≈ 2 × 参数量**。再算上反向传播（约是前向的两倍），训练每个 token 约 $6N$ FLOPs，$N$ 是参数量。这就是 Scaling Laws 文献里常用的 $C \approx 6ND$
- 注意力分数那一项 $4nd$ **不含参数**，却随上下文长度线性增长（对整个序列则是平方增长）。$n$ 小时它可以忽略；$n$ 和 $6d$ 同量级时它就成了主角。第 5 章会把这个比例画出来

拿 Llama 3 8B 粗算：$12 \times 4096^2 \times 32 \approx 6.4\text{B}$，加上约 1B 的 embedding 和输出层（词表约 128K），再加上 GQA 让 K、V 投影变小、FFN 隐层取 14336，总数在 8B 左右，和公开的参数量对得上。

## 完整实现

下面是一个带因果掩码的多头注意力，和 PyTorch 的写法一一对应，可以拿来对照阅读框架源码：

```python
import numpy as np

def softmax(z, axis=-1):
    z = z - z.max(axis=axis, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=axis, keepdims=True)

def mha(X, Wq, Wk, Wv, Wo, h):
    n, d = X.shape
    dk = d // h
    # (n, d) -> (h, n, dk)
    split = lambda T: T.reshape(n, h, dk).transpose(1, 0, 2)
    Q, K, V = split(X @ Wq), split(X @ Wk), split(X @ Wv)
    S = Q @ K.transpose(0, 2, 1) / np.sqrt(dk)        # (h, n, n)
    mask = np.triu(np.ones((n, n), dtype=bool), k=1)  # 对角线以上为 True
    S = np.where(mask, -np.inf, S)
    A = softmax(S)                                    # 每行和为 1
    O = (A @ V).transpose(1, 0, 2).reshape(n, d)      # 拼回 (n, d)
    return O @ Wo, A

rng = np.random.default_rng(0)
n, d, h = 6, 64, 4
X = rng.standard_normal((n, d))
W = [rng.standard_normal((d, d)) / np.sqrt(d) for _ in range(4)]
out, A = mha(X, *W, h)
print(out.shape)                    # (6, 64)
print(np.allclose(A.sum(-1), 1))    # True
print(np.allclose(np.triu(A[0], 1), 0))  # True：看不到未来
```

### 验证因果性

因果掩码的一个可检验推论：**改动第 $t$ 个 token，前 $t-1$ 个位置的输出不变**。这也是训练时能「一次前向同时监督所有位置」的原因：位置 $i$ 的输出只依赖前 $i$ 个输入，相当于 $n$ 个不同长度的前缀在同一次计算里各自预测下一个 token。

```python
X2 = X.copy()
X2[4] += 1.0                         # 改动第 5 个 token
out2, _ = mha(X2, *W, h)
print(np.allclose(out[:4], out2[:4]))  # True
print(np.allclose(out[4:], out2[4:]))  # False
```

这条性质还直接引出了第 3 章的 KV Cache：既然前面位置的计算结果与后文无关，生成新 token 时就没必要重算它们。

## 本章要点

- 单头注意力是 $\mathrm{softmax}(QK^\top/\sqrt{d_k} + M)V$，掩码用加 $-\infty$ 实现，保证 softmax 后每行仍归一化
- softmax 平移不变，实现时先减最大值；它的雅可比矩阵在输出接近 one-hot 时趋于 0
- 点积方差随 $d_k$ 线性增长，除以 $\sqrt{d_k}$ 把方差拉回 1，避免 softmax 饱和导致梯度消失
- 多头注意力可以改写成各头输出之和，每个头由 QK 电路（看哪里）和 OV 电路（写什么）两部分决定
- 现代块普遍用 Pre-LN、RMSNorm、SwiGLU、RoPE
- 每层参数约 $12d^2$，前向 FLOPs 约 $24d^2 + 4nd$；训练每 token 约 $6N$ FLOPs；注意力分数项随上下文变长而变得显著
