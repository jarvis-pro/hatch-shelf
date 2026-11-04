import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  AUDIO_MANIFEST,
  audioManifestSchema,
  audioPackageName,
  chapterAudio,
  isAudioPackage,
  mergeAudioManifest,
  paragraphKey,
  prepareAudioImport,
  referencedAudioFiles,
  sameChapterAudio,
  type AudioManifest,
} from './audio';
import { textHash } from './hash';

const paragraphs = ['第一章', '这是第一段。', '此处有代码，略过。'];

const manifest: AudioManifest = {
  version: 1,
  bookId: 'demo',
  voice: { provider: 'fish', id: 'v1' },
  params: { model: 's2.1-pro-free', format: 'mp3', bitrate: 64, speed: 1 },
  chapters: {
    '01-intro.md': paragraphs.map((p, i) => ({ key: paragraphKey(p), files: [textHash(`f${i}`)] })),
  },
};

describe('textHash', () => {
  it('is 16 hex chars and stable', () => {
    expect(textHash('听书')).toMatch(/^[0-9a-f]{16}$/);
    expect(textHash('听书')).toBe(textHash('听书'));
    expect(textHash('听书')).not.toBe(textHash('听书。'));
  });
});

describe('chapterAudio', () => {
  it('parses a valid manifest', () => expect(audioManifestSchema.safeParse(manifest).success).toBe(true));

  it('returns files when every paragraph matches', () => {
    expect(chapterAudio(manifest, '01-intro.md', paragraphs)).toEqual([0, 1, 2].map((i) => [textHash(`f${i}`)]));
  });

  it('falls back when a paragraph changed, was added, or the chapter is missing', () => {
    expect(chapterAudio(manifest, '01-intro.md', ['第一章', '这是改过的第一段。', '此处有代码，略过。'])).toBeNull();
    expect(chapterAudio(manifest, '01-intro.md', [...paragraphs, '新增一段'])).toBeNull();
    expect(chapterAudio(manifest, '02-next.md', paragraphs)).toBeNull();
  });
});

describe('audio packages', () => {
  const fp = (s: string) => textHash(s);
  const one: AudioManifest = {
    ...manifest,
    chapters: { '01-intro.md': [{ key: fp('a'), files: [fp('x'), fp('y')] }] },
  };
  const pack = (m: AudioManifest, extra: Record<string, Uint8Array> = {}) =>
    zipSync({
      [AUDIO_MANIFEST]: strToU8(JSON.stringify(m)),
      ...Object.fromEntries([...referencedAudioFiles(m)].map((f) => [`${f}.mp3`, strToU8(f)])),
      ...extra,
    });

  it('recognizes and prepares a chapter package', () => {
    const bytes = pack(one);
    expect(isAudioPackage(bytes)).toBe(true);
    const r = prepareAudioImport(bytes);
    expect(r.ok && r.bookId).toBe('demo');
    expect(r.ok && r.files.map((f) => f.name).sort()).toEqual([`${fp('x')}.mp3`, `${fp('y')}.mp3`].sort());
  });

  it('is not confused with a book package', () => {
    expect(isAudioPackage(zipSync({ 'book.yaml': strToU8('id: x'), 'manifest.json': strToU8('{}') }))).toBe(false);
  });

  it('rejects other files, unsafe paths and missing recordings', () => {
    expect(prepareAudioImport(pack(one, { 'evil.sh': strToU8('x') })).ok).toBe(false);
    expect(prepareAudioImport(pack(one, { '../0000000000000000.mp3': strToU8('x') })).ok).toBe(false);
    const missing = zipSync({ [AUDIO_MANIFEST]: strToU8(JSON.stringify(one)) });
    expect(prepareAudioImport(missing)).toEqual({ ok: false, error: '音频包缺少 2 个录音文件' });
  });

  it('merges chapters with the same voice and replaces on a new voice', () => {
    const two: AudioManifest = { ...one, chapters: { '02-next.md': [{ key: fp('b'), files: [fp('z')] }] } };
    expect(Object.keys(mergeAudioManifest(one, two).chapters).sort()).toEqual(['01-intro.md', '02-next.md']);
    const other = { ...two, voice: { provider: 'fish' as const, id: 'v2' } };
    expect(Object.keys(mergeAudioManifest(one, other).chapters)).toEqual(['02-next.md']);
    expect(sameChapterAudio(one, one, '01-intro.md')).toBe(true);
    expect(sameChapterAudio(one, { ...one, params: { ...one.params, speed: 1.25 } }, '01-intro.md')).toBe(false);
  });

  it('names packages by chapter', () => expect(audioPackageName('demo', '01-intro.md')).toBe('demo.audio.01-intro.zip'));
});
