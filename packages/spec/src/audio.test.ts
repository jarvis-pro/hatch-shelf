import { describe, expect, it } from 'vitest';
import { audioManifestSchema, chapterAudio, paragraphKey, type AudioManifest } from './audio';
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
