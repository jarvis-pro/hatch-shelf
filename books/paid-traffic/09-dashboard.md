# 数据看板：导出、字段与汇总

投了几周、用了两个以上平台以后，你会发现数据散在各处：DOU+ 订单在 App 里，千川报表在 PC 后台，薯条在小红书，视频号加热在创作者中心，成交和退款又在各自的店铺后台。每个平台的字段名不一样、口径不一样，月底想回答「这个月投流到底赚没赚」都很难。

这一章做一个能长期用的看板：先定义统一的字段，再讲各平台数据怎么拿，最后给两种实现——表格软件版和一个几十行的汇总脚本。目标不是做得漂亮，而是**每周花 15 分钟就能知道每个平台、每个商品是赚是亏**。

## 先定字段，再找数据

看板的核心是一张**明细表**：每一行是「某天 × 某平台 × 某个投放单元」的数据。所有平台的数据都转换成这同一组字段：

| 字段 | 类型 | 定义 | 示例 |
|---|---|---|---|
| `date` | 日期 | 投放日期（消耗发生的那天） | 2026-11-02 |
| `platform` | 文本 | 抖音 / 快手 / 小红书 / 视频号 | 抖音 |
| `tool` | 文本 | 投放产品 | DOU+ / 随心推 / 千川 / 薯条 / 聚光 / 视频号加热 / 粉条 / 磁力金牛 |
| `unit_id` | 文本 | 订单号或计划 ID，用来去重 | 订单号 |
| `content` | 文本 | 投的是哪条内容，用你自己的编号 | V-031 |
| `sku` | 文本 | 关联的商品 / 课程编号，没有就留空 | SKU-A |
| `objective` | 文本 | 投放目标 | 涨粉 / 成交 / 私信 / 播放 |
| `test_id` | 文本 | 属于哪轮测试（第 8 章测试计划表的编号），没有就留空 | T-2026-11-01 |
| `spend` | 金额 | 实付人民币（微信豆、薯币等一律折算成实付金额） | 150.00 |
| `impressions` | 整数 | 付费曝光 / 展现 | 5200 |
| `clicks` | 整数 | 点击（平台无此项就留空） | 96 |
| `conversions` | 整数 | 目标转化数（对应 `objective`） | 4 |
| `gmv` | 金额 | 支付成交金额（平台口径，没有就留空） | 396.00 |
| `refund` | 金额 | 已发生的退款金额（会随时间更新） | 0 |

再加一张**单位经济表**，每个 SKU 一行，就是第 2 章的保本计算表：

| 字段 | 定义 |
|---|---|
| `sku` | 编号 |
| `platform` | 平台（同一商品不同平台扣点不同，分开写） |
| `price` / `fee_rate` / `cost` / `shipping` / `refund_rate` / `refund_loss` | 第 2 章的 $P, f, C, s, r, d$ |
| `breakeven_cpa` | 公式算出 |
| `breakeven_roi` | 公式算出（支付口径） |

和一张**非成交目标的上限表**：涨粉、私信这类目标没有 GMV，用第 2 章估算的上限：

| `objective` | `max_cpa` | 来源 |
|---|---|---|
| 涨粉 | 0.8 | 第 2 章粉丝价值估算，取保守值 |
| 私信 | 16.48 | 线索价值 = 私信成交率 × 单位贡献 |

### 派生指标

不要把派生指标存进明细表，在汇总时算，避免改了公式后旧数据对不上：

| 指标 | 公式 |
|---|---|
| CPM | `spend / impressions * 1000` |
| CTR | `clicks / impressions` |
| CPA | `spend / conversions` |
| 支付 ROI | `gmv / spend` |
| 净成交 ROI | `(gmv - refund) / spend` |
| 贡献利润 | `conversions × 单位贡献 - spend`（只对成交目标，见下文） |
| 是否过线 | CPA ≤ `breakeven_cpa` 或 ≤ `max_cpa` |

「贡献利润」用的是第 2 章的单位贡献 $c$（已经按退款率扣过期望损失），所以**不需要等退款发生**就能估算；等退款数据成熟后，再用实际退款核对退款率假设是否成立。

## 各平台的数据怎么拿

| 工具 | 在哪看 | 能否导出 |
|---|---|---|
| DOU+ | 抖音 App → DOU+ 订单 | 不确定，可能需要手动抄录 |
| 随心推 | 抖音 App → 随心推订单 | 不确定，可能需要手动抄录 |
| 巨量千川 | 千川 PC 后台 → 数据报表 | 一般支持下载 |
| 薯条 | 小红书 App → 薯条订单 | 不确定 |
| 聚光 | 聚光后台 → 数据报表 | 一般支持下载 |
| 视频号加热 | 创作者中心 → 加热订单 | 不确定 |
| 粉条 | 快手 App → 作品推广订单 | 不确定 |
| 磁力金牛 | 磁力金牛后台 → 报表 | 一般支持下载 |
| 店铺成交、退款 | 抖店 / 快手小店 / 微信小店 / 小红书店铺后台 | 一般支持订单导出 |

「能否导出」一栏是我的一般判断，没有逐个核实，**以你看到的后台为准**。各平台导出文件的列名也经常调整，所以下面的脚本不写死列名，而是用一份映射配置。

App 内的加热订单通常没有导出功能，手动抄录时只抄最关键的五个数：日期、订单号、消耗、曝光、目标转化。一单 1 分钟，每周集中抄一次。

### 关于第三方数据工具

市面上有一些第三方数据工具号称能自动抓取各平台投放数据。使用前确认它是通过平台**官方开放接口**授权获取数据，而不是要你交出账号密码去模拟登录——后者有账号安全风险，也可能违反平台用户协议。平台开放接口的情况见[《给创作者和短剧团队做工具》](../creator-tools/)。

## 方案一：表格软件

适合单平台、每周几十行数据的阶段。任何支持公式和数据透视的表格软件都可以（Excel、WPS、飞书多维表格等）。

建三个工作表：`明细`、`单位经济`、`周报`。

`明细` 表除了上面的原始字段，加几个公式列（假设第 1 行是表头，`spend` 在 I 列，`impressions` 在 J 列，`clicks` 在 K 列，`conversions` 在 L 列，`gmv` 在 M 列，`refund` 在 N 列，`sku` 在 F 列）：

```text
O 列 CPM         = IF(J2>0, I2/J2*1000, "")
P 列 CPA         = IF(L2>0, I2/L2, "")
Q 列 净成交ROI   = IF(I2>0, (M2-N2)/I2, "")
R 列 保本CPA     = XLOOKUP(F2, 单位经济!A:A, 单位经济!H:H, "")
S 列 贡献利润    = IF(R2="", "", L2*R2 - I2)
T 列 周          = 年份和周数，例如 TEXT(A2,"yyyy") & "-W" & TEXT(WEEKNUM(A2,2),"00")
```

`XLOOKUP` 在旧版软件里可以换成 `VLOOKUP`；保本 CPA 就是单位贡献 $c$，所以「转化数 × 保本 CPA − 消耗」就是这批投放扣完广告费后留下的钱。

`周报` 用数据透视：行 = 周、平台、工具；值 = 消耗求和、转化求和、GMV 求和、贡献利润求和。CPA 和 ROI 在透视表外用求和后的值再算一遍（**不要对每行的 CPA 求平均**，那样小单和大单权重一样，结果是错的）。

## 方案二：汇总脚本

多平台、有下载文件以后，用脚本把各平台的 CSV 合并成统一明细，再出周报。下面是一个没有第三方依赖的 Node 脚本。Node 23.6 起可以直接运行 TypeScript 文件；Node 22 需要加 `--experimental-strip-types` 参数；更早的版本先用 `tsc` 编译。

目录结构：

```text
ads-data/
├── mapping.json        # 各平台列名映射
├── units.json          # 单位经济表
├── raw/                # 各平台导出的 CSV，按「工具名-日期.csv」命名
│   ├── qianchuan-2026-11-02.csv
│   └── manual-2026-11-02.csv   # 手动抄录的 App 内订单，直接用统一字段
└── report.ts
```

`mapping.json` 写「统一字段 ← 平台列名」，列名照着你下载的文件表头填：

```json
{
  "qianchuan": {
    "platform": "抖音",
    "tool": "千川",
    "columns": {
      "date": "（填导出文件里日期那一列的表头）",
      "unit_id": "（计划 ID 列）",
      "spend": "（消耗列）",
      "impressions": "（展示数列）",
      "clicks": "（点击数列）",
      "conversions": "（成交订单数列）",
      "gmv": "（成交金额列）"
    }
  },
  "manual": { "platform": "", "tool": "", "columns": {} }
}
```

`manual` 的 `columns` 为空，表示文件本身已经是统一字段。

`units.json`：

```json
{
  "SKU-A@抖音": { "price": 99, "feeRate": 0.05, "cost": 35, "shipping": 8, "refundRate": 0.15, "refundLoss": 10 }
}
```

`report.ts`：

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

type Row = {
  date: string; platform: string; tool: string; unit_id: string; content: string;
  sku: string; objective: string; test_id: string;
  spend: number; impressions: number; clicks: number; conversions: number; gmv: number; refund: number;
};
type Unit = { price: number; feeRate: number; cost: number; shipping: number; refundRate: number; refundLoss: number };
type Mapping = Record<string, { platform: string; tool: string; columns: Record<string, string> }>;

const dir = process.argv[2] ?? "ads-data";
const mapping: Mapping = JSON.parse(readFileSync(join(dir, "mapping.json"), "utf8"));
const units: Record<string, Unit> = JSON.parse(readFileSync(join(dir, "units.json"), "utf8"));

// 最简 CSV 解析：支持双引号包裹和引号内逗号
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const split = (line: string) => {
    const out: string[] = []; let cur = ""; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const [header, ...rest] = lines.map(split);
  return rest.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])));
}

const num = (s: string | undefined) => {
  const n = Number((s ?? "").replace(/[,¥%\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function contribution(u: Unit) {
  const kept = u.price * (1 - u.feeRate) - u.cost - u.shipping;
  return (1 - u.refundRate) * kept - u.refundRate * u.refundLoss;
}

const rows: Row[] = [];
const seen = new Set<string>();
for (const file of readdirSync(join(dir, "raw")).filter((f) => f.endsWith(".csv"))) {
  const key = file.split("-")[0];
  const m = mapping[key];
  if (!m) { console.warn(`跳过 ${file}：mapping.json 里没有 ${key}`); continue; }
  for (const r of parseCsv(readFileSync(join(dir, "raw", file), "utf8"))) {
    const get = (field: string) => r[m.columns[field] ?? field];
    const row: Row = {
      date: get("date"), platform: m.platform || get("platform"), tool: m.tool || get("tool"),
      unit_id: get("unit_id"), content: get("content") ?? "", sku: get("sku") ?? "",
      objective: get("objective") ?? "", test_id: get("test_id") ?? "",
      spend: num(get("spend")), impressions: num(get("impressions")), clicks: num(get("clicks")),
      conversions: num(get("conversions")), gmv: num(get("gmv")), refund: num(get("refund")),
    };
    const id = `${row.tool}|${row.unit_id}|${row.date}`;
    if (seen.has(id)) continue; // 同一天同一订单只算一次，重复下载不会重复计数
    seen.add(id);
    rows.push(row);
  }
}

// ISO 周
function week(d: string) {
  const t = new Date(d + "T00:00:00Z");
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const w = 1 + Math.round(((t.getTime() - first.getTime()) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, "0")}`;
}

type Agg = { spend: number; imp: number; clk: number; conv: number; gmv: number; refund: number; profit: number; hasUnit: boolean };
const groups = new Map<string, Agg>();
for (const r of rows) {
  const k = [week(r.date), r.platform, r.tool, r.sku || "-"].join(" | ");
  const g = groups.get(k) ?? { spend: 0, imp: 0, clk: 0, conv: 0, gmv: 0, refund: 0, profit: 0, hasUnit: false };
  const u = units[`${r.sku}@${r.platform}`];
  g.spend += r.spend; g.imp += r.impressions; g.clk += r.clicks;
  g.conv += r.conversions; g.gmv += r.gmv; g.refund += r.refund;
  if (u) { g.profit += r.conversions * contribution(u) - r.spend; g.hasUnit = true; }
  groups.set(k, g);
}

const f = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "-");
console.log("周 | 平台 | 工具 | SKU | 消耗 | CPM | CTR | 转化 | CPA | 净成交ROI | 贡献利润");
for (const [k, g] of [...groups].sort()) {
  console.log([
    k, f(g.spend), f((g.spend / g.imp) * 1000), g.clk ? f((g.clk / g.imp) * 100, 1) + "%" : "-",
    g.conv, f(g.spend / g.conv), g.gmv ? f((g.gmv - g.refund) / g.spend) : "-", g.hasUnit ? f(g.profit) : "-",
  ].join(" | "));
}
```

运行：

```bash
node ads-data/report.ts ads-data
# Node 22：node --experimental-strip-types ads-data/report.ts ads-data
```

用一份千川导出（20 单、消耗 1,200.50 元、关联 SKU-A）和两条手抄订单试跑，输出类似：

```text
周 | 平台 | 工具 | SKU | 消耗 | CPM | CTR | 转化 | CPA | 净成交ROI | 贡献利润
2026-W45 | 小红书 | 薯条 | - | 75.00 | 18.75 | - | 30 | 2.50 | - | -
2026-W45 | 抖音 | DOU+ | - | 100.00 | 20.00 | - | 120 | 0.83 | - | -
2026-W45 | 抖音 | 千川 | SKU-A | 1200.50 | 40.02 | 1.5% | 20 | 60.02 | 1.65 | -362.65
```

千川这一行 CPA 60 元高于保本 41.89 元，20 单贡献 837.85 元，扣掉 1,200.50 元消耗，亏 362.65 元——ROI 1.65 低于第 2 章算出的保本 2.36，结论一致。

几点说明：

- **去重键**是「工具 + 订单 / 计划 ID + 日期」。同一份数据重复下载、文件覆盖不全时都不会重复计数
- 后台导出文件里一般没有你自己的 SKU 编号：一个计划只推一个商品时，在 CSV 里手动加一列 `sku` 并在映射里写 `"sku": "sku"`
- **贡献利润**只对在 `units.json` 里找得到单位经济的 SKU 计算；涨粉、私信等目标显示为 `-`，用上限表人工判断
- 脚本只读本地文件，不联网。数据含订单信息，`ads-data/` 不要放进公开仓库
- 平台导出文件如果是 xlsx，先在表格软件里另存为 CSV（UTF-8）

## 退款回填

退款滞后几天到几周。处理方式：

1. 明细表的 `refund` 字段**按订单日期**归属，而不是按退款发生日期
2. 每周更新时，重新导出过去 30 天的店铺订单，把退款回填到对应日期
3. 周报里标注「近 14 天数据未成熟」，这部分的净成交 ROI 偏高
4. 每月用成熟的数据（30 天以前的订单）核对 `units.json` 里的 `refundRate`，偏差大就更新

## 每周 15 分钟的流程

```mermaid
flowchart LR
  A[下载 / 抄录<br/>上周各平台数据] --> B[放进 raw/<br/>回填过去 30 天退款]
  B --> C[跑脚本或刷新透视表]
  C --> D[看三个数<br/>每个工具的贡献利润<br/>过线的计划<br/>没过线的计划]
  D --> E[按第 8 章规则<br/>加预算 / 停 / 换素材]
  E --> F[在测试计划表里<br/>填结论]
```

看板只回答三个问题：**哪里在赚、哪里在亏、下周钱往哪里放**。其他指标（CPM、CTR）是用来解释原因的，不是用来做决定的。

## 常见坑

- **对 CPA、ROI 求平均**：比率要用总和重算
- **微信豆、薯币按数量记账**：统一换成实付人民币
- **退款按退款日期记**：会让近期 ROI 偏高、远期 ROI 偏低，看不出真实趋势
- **字段口径随平台改版悄悄变化**：导出文件表头变了要及时更新映射，否则某一列会全部变成 0。脚本每次跑完看一眼总消耗和后台对不对得上
- **看板越做越复杂**：超过一屏的看板，你就不会每周看了

## 本章要点

- 先定统一字段：日期、平台、工具、单元 ID、内容、SKU、目标、测试编号、消耗、曝光、点击、转化、GMV、退款
- 另建单位经济表和非成交目标上限表，派生指标在汇总时计算
- App 内订单多半只能手动抄录，后台报表用列名映射合并，按「工具 + ID + 日期」去重
- 比率用总和重算，不要求平均；退款按订单日期回填，近 14 天数据标为未成熟
- 看板只回答：哪里赚、哪里亏、下周钱往哪放
