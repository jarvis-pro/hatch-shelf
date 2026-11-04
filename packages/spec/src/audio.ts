import { z } from 'zod';
import { textHash } from './hash';
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
