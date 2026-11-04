/**
 * 原声：在电脑上用 Fish Audio 把书按阅读器的段落预先读成录音（README 第 8.1 节）。
 * 输出到仓库根目录的 audio/<book-id>/（不入库）：manifest.json + 每个录音一个 <指纹>.mp3。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  AUDIO_FILE_RE,
  AUDIO_MANIFEST,
  paragraphKey,
  textHash,
  type AudioManifest,
  type AudioParams,
  type BookManifest,
} from '@shelf/spec';
import type { LocalBook } from './books';
import { segmentChapter } from './segment';

/** 默认音色「成熟男性讲故事」；一套书库只用一个音色 */
export const DEFAULT_VOICE = 'e0cbb35d7cc2420c87f2ea6ad623b61a';
export const DEFAULT_PARAMS: AudioParams = { model: 's2.1-pro-free', format: 'mp3', bitrate: 64, speed: 1 };

/** 免费版单次 500 字符，留些余量 */
export const MAX_REQUEST_CHARS = 450;
/** 实测 S2.1 中文约 6.5 字 / 秒（1 倍速） */
const CHARS_PER_SECOND = 6.54;

/** 超长段落按句切，单句仍超长时硬切；不超长的原样返回一段 */
export function splitPieces(text: string, max = MAX_REQUEST_CHARS): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let buf = '';
  for (let sent of text.split(/(?<=[。！？；!?;])/)) {
    if (buf && buf.length + sent.length > max) {
      out.push(buf);
      buf = '';
    }
    while (sent.length > max) {
      out.push(sent.slice(0, max));
      sent = sent.slice(max);
    }
    buf += sent;
  }
  if (buf) out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** 发给合成接口的文字：S2 把方括号当成语气标签（如 [whisper]），正文里的方括号换成全角 */
export const requestText = (piece: string) => piece.replace(/\[/g, '【').replace(/\]/g, '】');

export interface AudioPlan {
  manifest: AudioManifest;
  /** 指纹 → 合成用的文字；相同的文字（如「此处有代码，略过。」）只合成一次 */
  jobs: Map<string, string>;
  /** 每章用到的指纹，用来判断哪些章已经齐全 */
  chapterFiles: Map<string, string[]>;
  paragraphs: number;
  chars: number;
}

/** 按全书切段，算出清单和需要的全部录音；不读写文件 */
export function planAudio(book: LocalBook, meta: BookManifest, voice: AudioManifest['voice'], params: AudioParams): AudioPlan {
  const jobs = new Map<string, string>();
  const chapterFiles = new Map<string, string[]>();
  const chapters: AudioManifest['chapters'] = {};
  let paragraphs = 0;
  let chars = 0;
  for (const chapter of meta.chapters) {
    const markdown = book.files.find((f) => f.path === chapter)?.text;
    if (markdown === undefined) continue;
    const entries = segmentChapter(markdown).map((text) => {
      paragraphs++;
      chars += text.length;
      const files = splitPieces(text).map((piece) => {
        const sent = requestText(piece);
        const fp = textHash(JSON.stringify([sent, voice.provider, voice.id, params]));
        jobs.set(fp, sent);
        return fp;
      });
      return { key: paragraphKey(text), files };
    });
    chapters[chapter] = entries;
    chapterFiles.set(chapter, [...new Set(entries.flatMap((e) => e.files))]);
  }
  const manifest: AudioManifest = { version: 1, bookId: meta.id, voice, params, chapters };
  return { manifest, jobs, chapterFiles, paragraphs, chars };
}

export const estimateSeconds = (chars: number, speed: number) => chars / CHARS_PER_SECOND / speed;

export function fishApiKey(): string {
  const env = process.env.FISH_API_KEY?.trim();
  if (env) return env;
  try {
    return execFileSync('security', ['find-generic-password', '-s', 'fish-audio', '-w'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('找不到 Fish Audio 密钥：设置环境变量 FISH_API_KEY，或存进钥匙串（服务名 fish-audio）');
  }
}

/** 音色在 Fish 上的名字，只用来记进清单；取不到不影响生成 */
export async function voiceName(key: string, id: string): Promise<string | undefined> {
  try {
    const res = await fetch(`https://api.fish.audio/model/${id}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { title?: unknown };
    return typeof body.title === 'string' ? body.title : undefined;
  } catch {
    return undefined;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function synthesize(key: string, text: string, voice: string, params: AudioParams): Promise<Uint8Array> {
  const body = {
    text,
    format: params.format,
    mp3_bitrate: params.bitrate,
    reference_id: voice,
    latency: 'normal',
    ...(params.speed !== 1 && { prosody: { speed: params.speed } }),
  };
  for (let attempt = 0; ; attempt++) {
    let detail: string;
    try {
      const res = await fetch('https://api.fish.audio/v1/tts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', model: params.model },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
      if (res.ok) {
        const data = new Uint8Array(await res.arrayBuffer());
        if (data.length > 0) return data;
        detail = '返回了空文件';
      } else {
        detail = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
        // 4xx（除 429）重试也没用：密钥、参数或额度有问题
        if (res.status < 500 && res.status !== 429) throw new FatalError(detail);
      }
    } catch (e) {
      if (e instanceof FatalError) throw e;
      detail = e instanceof Error ? e.message : String(e);
    }
    if (attempt >= 5) throw new Error(detail);
    await sleep(5_000 * 2 ** attempt);
  }
}

class FatalError extends Error {}

export interface GenerateOptions {
  key: string;
  concurrency: number;
  onProgress?: (done: number, total: number) => void;
}

/**
 * 合成还没有的录音。先写 .part 再改名，中断后留下的都是完整文件，重跑时跳过；
 * 遇到不可重试的错误（如密钥无效）立刻停下，其余失败记下来继续
 */
export async function generateAudio(
  outDir: string,
  plan: AudioPlan,
  fingerprints: string[],
  opts: GenerateOptions,
): Promise<{ failed: { fp: string; error: string }[] }> {
  mkdirSync(outDir, { recursive: true });
  const todo = fingerprints.filter((fp) => !existsSync(path.join(outDir, `${fp}.mp3`)));
  const failed: { fp: string; error: string }[] = [];
  let next = 0;
  let done = 0;
  let fatal: Error | undefined;
  const worker = async () => {
    while (!fatal && next < todo.length) {
      const fp = todo[next++];
      try {
        const data = await synthesize(opts.key, plan.jobs.get(fp)!, plan.manifest.voice.id, plan.manifest.params);
        const file = path.join(outDir, `${fp}.mp3`);
        writeFileSync(`${file}.part`, data);
        renameSync(`${file}.part`, file);
      } catch (e) {
        if (e instanceof FatalError) fatal = e;
        else failed.push({ fp, error: e instanceof Error ? e.message : String(e) });
      }
      opts.onProgress?.(++done, todo.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));
  if (fatal) throw fatal;
  return { failed };
}

/**
 * 写清单（只收录音全部齐全的章节，App 不会拿到缺文件的章），并删掉清单不再引用的录音。
 * 返回齐全的章节数
 */
export function writeAudioManifest(outDir: string, plan: AudioPlan): number {
  const has = (fp: string) => existsSync(path.join(outDir, `${fp}.mp3`));
  const chapters: AudioManifest['chapters'] = {};
  for (const [chapter, entries] of Object.entries(plan.manifest.chapters)) {
    if (plan.chapterFiles.get(chapter)!.every(has)) chapters[chapter] = entries;
  }
  const referenced = new Set(plan.jobs.keys());
  for (const name of readdirSync(outDir)) {
    const stale = AUDIO_FILE_RE.test(name) && !referenced.has(name.slice(0, -4));
    if (stale || name.endsWith('.part')) rmSync(path.join(outDir, name));
  }
  writeFileSync(path.join(outDir, AUDIO_MANIFEST), `${JSON.stringify({ ...plan.manifest, chapters }, null, 2)}\n`);
  return Object.keys(chapters).length;
}
