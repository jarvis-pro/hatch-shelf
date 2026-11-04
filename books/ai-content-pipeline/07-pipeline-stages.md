# 搭一条自动化流水线（下）：生成、关卡与交付

[上篇](07-pipeline.md)搭好了架构、job 目录和代码骨架的公共部分，脚本已经生成并过了自动检查。这一篇接着写脚本过关卡 1 之后的步骤：按段配音和生成字幕、ffmpeg 合成、统一加标识、两道人工关卡的实现、把各步骤串起来的主流程，最后是流水线的终点「待发布包」，以及为什么发布这一步留给人。

**本章代码同样是骨架示例，未在生产环境跑过**，类型和工具函数沿用上篇，各家 API 的具体参数以官方文档为准。

## 步骤：配音和字幕

按段合成配音有一个额外的好处：**每段的时长是已知的，字幕可以直接由分段时长生成，不需要再跑一遍语音识别**。

```ts
// stages/tts-and-subtitles.ts
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { toReadable } from "../pronounce";          // 第 5 章的发音词典
import type { Job, Script } from "../types";
import type { TtsProvider } from "../providers";

const GAP = 0.4;   // 段间停顿，秒

export async function runTts(job: Job, script: Script, tts: TtsProvider): Promise<number[]> {
  const durations: number[] = [];
  let cost = 0;
  for (const [i, seg] of script.segments.entries()) {
    const n = String(i + 1).padStart(2, "0");
    const readable = toReadable(seg.text);
    await writeFile(join(job.dir, "segments", `${n}.read.txt`), readable);
    const r = await tts.synth(readable, join(job.dir, "segments", `${n}.mp3`), { voice: "my-clone-v2" });
    durations.push(r.duration);
    cost += r.cost;
  }
  job.cost.tts = cost;
  job.stages.tts = { status: "done", provider: tts.name, at: new Date().toISOString() };
  return durations;
}

/** 每段原稿再按标点切成短句，按字数比例分配该段时长 */
export function buildSrt(script: Script, durations: number[]): string {
  const ts = (t: number) => {
    const ms = Math.round(t * 1000);
    const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60;
    const s = Math.floor(ms / 1000) % 60, r = ms % 1000;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(r).padStart(3, "0")}`;
  };
  const items: string[] = [];
  let t = 0;
  script.segments.forEach((seg, i) => {
    const lines = seg.text.split(/(?<=[，。！？；])/).map((x) => x.replace(/[，。；]$/, "")).filter(Boolean);
    const total = lines.reduce((a, l) => a + l.length, 0);
    for (const line of lines) {
      const d = durations[i] * (line.length / total);
      items.push(`${items.length + 1}\n${ts(t)} --> ${ts(t + d)}\n${line}\n`);
      t += d;
    }
    t += GAP;
  });
  return items.join("\n");
}
```

按字数比例分配时长是近似的，对于 60 秒的口播，误差通常在可接受范围内；对齐要求高的话，用第 4 章的语音识别重新打时间戳，或者用 TTS 服务返回的字级时间戳（不少服务支持）。注意字幕用的是**原稿** `seg.text`，配音用的是**朗读稿** `readable`，这是第 5 章说的两稿分离。

## 步骤：合成

用 ffmpeg 把每段的图和音频合成一个片段，再拼接、烧字幕。下面直接拼命令行参数调用 ffmpeg：

```ts
// stages/assemble.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const run = promisify(execFile);

export async function assemble(dir: string, count: number, durations: number[]): Promise<void> {
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const n = String(i + 1).padStart(2, "0");
    const d = (durations[i] + 0.4).toFixed(2);
    const out = join(dir, "segments", `${n}.mp4`);
    // 静态图加缓慢推近，避免画面完全不动
    await run("ffmpeg", [
      "-y", "-loop", "1", "-i", join(dir, "segments", `${n}.png`),
      "-i", join(dir, "segments", `${n}.mp3`),
      "-filter_complex",
      `[0:v]scale=1188:2112,zoompan=z='min(zoom+0.0006,1.08)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30[v];[1:a]apad[a]`,
      "-map", "[v]", "-map", "[a]", "-t", d,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", out,
    ]);
    parts.push(`file '${out}'`);
  }
  const list = join(dir, "segments", "list.txt");
  await writeFile(list, parts.join("\n"));
  await run("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", list,
    "-vf", `subtitles=${join(dir, "subtitles.srt")}:force_style='FontName=Source Han Sans SC,FontSize=12,MarginV=60'`,
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-c:v", "libx264", "-crf", "20", "-c:a", "aac", join(dir, "draft.mp4"),
  ]);
}
```

字幕的 `MarginV` 要把字幕抬离画面底部，避开平台界面的遮挡区（第 3 章）。烧字幕需要 ffmpeg 编译时带 libass。

## 步骤：标识

按《人工智能生成合成内容标识办法》，视频的显式标识应在起始画面和播放周边适当位置添加（原文见第 10 章）。流水线里在合成后统一加一个角标，保证每条都不会漏：

```ts
// stages/label.ts
export async function addLabel(dir: string): Promise<void> {
  await run("ffmpeg", [
    "-y", "-i", join(dir, "draft.mp4"),
    "-vf",
    // 全程左上角小角标；前 3 秒在画面中上部再显示一次较大的提示
    "drawtext=fontfile=/path/to/SourceHanSansSC-Regular.otf:text='AI 生成':x=40:y=120:fontsize=30:fontcolor=white@0.85:box=1:boxcolor=black@0.35:boxborderw=8," +
    "drawtext=fontfile=/path/to/SourceHanSansSC-Regular.otf:text='本视频含 AI 生成内容':x=(w-text_w)/2:y=h*0.18:fontsize=44:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=14:enable='lt(t,3)'",
    "-metadata", "comment=AIGC: 含人工智能生成合成内容",
    "-c:a", "copy", join(dir, "final.mp4"),
  ]);
}
```

（`run` 和 `join` 的导入同上一段。）

两点说明：

- 上面写进 `comment` 的元数据只是一个自己的记录，**不等于**国家标准规定的隐式标识格式。隐式标识主要由生成服务提供者写入（你调用的 TTS、图像服务导出的文件里），平台发布时也会核验和添加。自己合成时不要删除或篡改上游文件里的标识
- 角标的位置和样式参考各平台的要求，发布时**还要**在平台上勾选 AI 内容声明。流水线加角标是兜底，不是替代

## 步骤：人工关卡

关卡的实现很简单：流水线跑到关卡就停，生成一份审核页，等人写下结论。

```ts
// stages/gate.ts
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import type { Job } from "../types";

const FINAL_CHECKLIST = [
  "完整看过一遍成片，声音和画面没有错误",
  "字幕没有错字，和配音一致",
  "事实清单逐条核对过",
  "画面没有畸形、乱码、他人商标和真人肖像",
  "起始画面和角标有 AI 标识",
  "标题和封面与内容一致，没有夸大和效果承诺",
  "这条内容换掉账号名后仍然只有我能做出来",
];

export async function gate(job: Job, name: "gate1" | "gate2"): Promise<boolean> {
  const file = join(job.dir, name === "gate1" ? "review-script.json" : "review-final.json");
  try {
    await access(file);
  } catch {
    await writeFile(join(job.dir, `${name}.todo.md`),
      `# 待审：${job.id}\n\n${FINAL_CHECKLIST.map((c) => `- [ ] ${c}`).join("\n")}\n\n` +
      `审完后写 ${file}：{"approved": true|false, "note": "...", "checked": [...]}`);
    job.stages[name] = { status: "pending" };
    return false;                      // 停在这里，等人
  }
  const r = JSON.parse(await readFile(file, "utf8")) as { approved: boolean; checked?: string[] };
  const allChecked = name === "gate1" || (r.checked?.length ?? 0) === FINAL_CHECKLIST.length;
  job.stages[name] = { status: r.approved && allChecked ? "approved" : "rejected", at: new Date().toISOString() };
  return r.approved && allChecked;
}
```

`gate2` 要求清单全部勾选才算通过。这是一个小小的强制：不让「看都没看就点通过」那么容易。

## 主流程

```ts
// cli.ts
import { loadJob, saveJob } from "./job";
import { runScript } from "./stages/script";
import { gate } from "./stages/gate";
// ……其余步骤

async function main(id: string): Promise<void> {
  const job = await loadJob(id);
  const step = async (name: keyof typeof job.stages, fn: () => Promise<unknown>) => {
    if (job.stages[name]?.status === "done") return;          // 幂等：做过就跳过
    try {
      job.stages[name] = { status: "running" };
      await fn();
    } catch (e) {
      job.stages[name] = { status: "failed", error: String(e) };
      throw e;
    } finally {
      await saveJob(job);                                      // 每一步后都落盘
    }
  };

  await step("script", () => runScript(job));
  if (!(await gate(job, "gate1"))) return void (await saveJob(job));
  // await step("tts", ...); await step("images", ...); await step("subtitles", ...);
  // await step("assemble", ...); await step("label", ...);
  if (!(await gate(job, "gate2"))) return void (await saveJob(job));
  // await step("package", ...);
}

main(process.argv[2]).catch((e) => {
  console.error(e);
  process.exit(1);
});
```

用法：

```bash
pnpm pipeline new 2026-11-03-first-users --material materials/2026-11-01-first-users.md
pnpm pipeline run 2026-11-03-first-users      # 跑到关卡 1 停下
# 审脚本，写 review-script.json
pnpm pipeline run 2026-11-03-first-users      # 继续跑到关卡 2 停下
# 看成片，写 review-final.json
pnpm pipeline run 2026-11-03-first-users      # 生成待发布包
pnpm pipeline rerun 2026-11-03-first-users images   # 只重跑配图及其之后的步骤
```

## 待发布包

流水线的终点是一个目录，而不是一次发布：

```text
publish/
├── final.mp4
├── cover.jpg
├── post.md
└── checklist.md
```

- `post.md`：各平台的标题、简介、话题标签
- `checklist.md`：发布时要做的事

`checklist.md` 提醒发布时的手工步骤：

```text
发布前：
- 在发布页勾选 AI 生成内容声明（抖音：高级设置中的自主声明；其他平台见各自发布页）
- 选择封面 cover.jpg，在手机上预览遮挡
- 如用平台曲库音乐，在平台内添加，不要用本地混好的版本
- 商单内容勾选对应的商业合作标识

发布后：
- 记录作品链接到 jobs/<id>/job.json
- 24 小时、72 小时各记录一次数据
```

## 为什么不自动发布

技术上，你可能找得到自动发布的办法：平台开放接口里的部分能力、浏览器自动化、各种「多平台一键分发」工具。这本书的建议是：**发布这一步由人在平台上完成**。理由：

1. **平台规则**。各平台对非官方的自动化操作（脚本模拟、群控、批量登录）都有明确限制，被识别为异常操作会影响账号，严重的封号。用官方开放平台的能力是可以的，但通常需要企业资质、应用审核，并且有用途限制，以各平台开放平台文档为准（给创作者做工具时的接口问题，见[《给创作者和短剧团队做工具》](../creator-tools/)）
2. **最后一眼**。在手机上预览封面、勾选声明、看一眼标题，这一分钟能挡住很多事故
3. **问责清楚**。人点了发布，就意味着人对这条内容负责。自动发布的流水线，出了问题很难说清是谁的决定

自动化的终点是「让发布只需要一分钟」，而不是「让发布不需要人」。

## 跑起来之后

流水线跑通只是开始。接下来该做的：

- **记录每条的耗时和费用**，和手工做法比，看哪一步还值得优化（第 9 章）
- **把数据接回来**：发布后的播放、完播、互动记录到 job 目录，按提示词版本、模型、配图风格分组看，才知道改动有没有用
- **定期抽查**：每周随机挑几条已发布的内容，重新按清单检查一遍，看看关卡有没有流于形式

## 本章要点

- 按段配音让字幕可以直接由时长生成；字幕用原稿，配音用朗读稿
- 显式标识在流水线里统一加作兜底，不删上游的隐式标识，发布时仍要在平台声明
- 人工关卡就是「停下来等一个文件」；成片关卡要求清单全部勾选
- 主流程每一步后落盘、做过就跳过，可以从任意一步重跑
- 终点是待发布包而不是自动发布：非官方自动化有封号风险，最后一眼和问责都需要人
