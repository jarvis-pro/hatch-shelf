import { unzipSync, strFromU8, type UnzipFileInfo } from 'fflate';
import { z } from 'zod';
import { textHash } from './hash';
import { isSafeEntryPath, MAX_PACKAGE_BYTES } from './rules';
import { CHAPTER_FILE_RE, SLUG_RE } from './schema';

/**
 * 原声（预生成录音）的清单，README 第 8.1 节。
 * 一章的录音按阅读器切出的段落一段一条：key 是段落文字的指纹，files 是这一段的录音文件，按顺序播放
 * （超过单次合成上限的段落切成几段）。App 开始读一章时，本章每段的 key 都与清单逐条相同才用原声。
 */
export const AUDIO_MANIFEST = 'manifest.json';

/** 录音文件名：16 位十六进制指纹 + .mp3 */
export const AUDIO_FILE_RE = /^[0-9a-f]{16}\.mp3$/;

const fingerprint = z.string().regex(/^[0-9a-f]{16}$/);

export const audioManifestSchema = z.object({
  version: z.literal(1),
  bookId: z.string().regex(SLUG_RE),
  voice: z.object({ provider: z.literal('fish'), id: z.string().min(1), name: z.string().optional() }),
  /** 合成参数：模型、格式、码率、语速；参数和音色都进录音指纹，变了就整本重新生成 */
  params: z.object({ model: z.string(), format: z.literal('mp3'), bitrate: z.number(), speed: z.number() }),
  chapters: z.record(
    z.string().regex(CHAPTER_FILE_RE),
    z.array(z.object({ key: fingerprint, files: z.array(fingerprint).min(1) })),
  ),
});

export type AudioManifest = z.infer<typeof audioManifestSchema>;
export type AudioParams = AudioManifest['params'];

/** 段落在清单里的 key：只看文字，与音色无关 */
export const paragraphKey = (text: string) => textHash(text);

/**
 * 本章能不能用原声：段落数相同、每段 key 都对得上才返回各段的录音文件，否则 null（整章用系统语音）
 */
export function chapterAudio(manifest: AudioManifest, chapter: string, paragraphs: string[]): string[][] | null {
  const entries = manifest.chapters[chapter];
  if (!entries || entries.length !== paragraphs.length) return null;
  for (let i = 0; i < paragraphs.length; i++) {
    if (entries[i].key !== paragraphKey(paragraphs[i])) return null;
  }
  return entries.map((e) => e.files);
}

// ---------- 音频包（README 第 8.1 节「传到手机」） ----------

/**
 * 按章推送的音频包：`<id>.audio.<章节>.zip`，根目录一个 manifest.json（只含这一章）加这一章的录音。
 * 书包的扩展名白名单不变（不允许 .mp3），音频包只放行这两种文件
 */
export const audioPackageName = (bookId: string, chapter: string) => `${bookId}.audio.${chapter.replace(/\.md$/, '')}.zip`;

const isAudioEntry = (name: string) => name === AUDIO_MANIFEST || AUDIO_FILE_RE.test(name);

/** zip 根目录有 manifest.json、没有 book.yaml 和 .md：是音频包。只读条目名，不解压 */
export function isAudioPackage(bytes: Uint8Array): boolean {
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter: (f: UnzipFileInfo) => {
        names.push(f.name);
        return false;
      },
    });
  } catch {
    return false;
  }
  return names.includes(AUDIO_MANIFEST) && !names.some((n) => n.endsWith('.md') || n.endsWith('book.yaml'));
}

export type PreparedAudio =
  | { ok: true; bookId: string; manifest: AudioManifest; files: { name: string; bytes: Uint8Array }[] }
  | { ok: false; error: string };

/** 校验并解开音频包；纯函数，App 导入管线调用 */
export function prepareAudioImport(bytes: Uint8Array): PreparedAudio {
  const fail = (error: string): PreparedAudio => ({ ok: false, error });
  if (bytes.byteLength > MAX_PACKAGE_BYTES) return fail(`文件超过 ${MAX_PACKAGE_BYTES / 1024 / 1024} MB`);
  let bad: string | null = null;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (f: UnzipFileInfo) => {
        if (f.name.endsWith('/')) return false;
        if (!isSafeEntryPath(f.name) || !isAudioEntry(f.name)) {
          bad ??= f.name;
          return false;
        }
        return true;
      },
    });
  } catch (e) {
    return fail(`无法解压：${(e as Error).message}`);
  }
  if (bad) return fail(`音频包里只能有 manifest.json 和录音文件：${bad}`);
  const raw = entries[AUDIO_MANIFEST];
  if (!raw) return fail('音频包里缺少 manifest.json');
  let json: unknown;
  try {
    json = JSON.parse(strFromU8(raw));
  } catch {
    return fail('manifest.json 不是有效的 JSON');
  }
  const parsed = audioManifestSchema.safeParse(json);
  if (!parsed.success) return fail('manifest.json 格式不对');
  const manifest = parsed.data;
  const missing = [...referencedAudioFiles(manifest)].filter((fp) => !entries[`${fp}.mp3`]);
  if (missing.length) return fail(`音频包缺少 ${missing.length} 个录音文件`);
  const files = Object.entries(entries)
    .filter(([name]) => name !== AUDIO_MANIFEST)
    .map(([name, data]) => ({ name, bytes: data }));
  return { ok: true, bookId: manifest.bookId, manifest, files };
}

/** 清单引用的全部录音指纹 */
export function referencedAudioFiles(manifest: AudioManifest): Set<string> {
  return new Set(Object.values(manifest.chapters).flatMap((entries) => entries.flatMap((e) => e.files)));
}

const sameVoice = (a: AudioManifest, b: AudioManifest) =>
  a.voice.provider === b.voice.provider && a.voice.id === b.voice.id && JSON.stringify(a.params) === JSON.stringify(b.params);

/**
 * 设备上已有的清单合并进新到的章节：音色和参数相同时按章覆盖；换了音色或参数时旧的整份作废，只留新到的
 */
export function mergeAudioManifest(existing: AudioManifest | null, incoming: AudioManifest): AudioManifest {
  if (!existing || existing.bookId !== incoming.bookId || !sameVoice(existing, incoming)) return incoming;
  return { ...incoming, chapters: { ...existing.chapters, ...incoming.chapters } };
}

/** 设备上这一章的录音与本地的是否相同（push-audio 据此跳过） */
export function sameChapterAudio(device: AudioManifest | null, local: AudioManifest, chapter: string): boolean {
  if (!device || !sameVoice(device, local)) return false;
  return JSON.stringify(device.chapters[chapter]) === JSON.stringify(local.chapters[chapter]);
}
