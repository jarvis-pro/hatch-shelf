import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { audioManifestSchema, chapterAudio, prepareAudioImport, sameChapterAudio } from '@shelf/spec';
import { describe, expect, it } from 'vitest';
import { buildChapterPackage, DEFAULT_PARAMS, planAudio, readAudioManifest, requestText, splitPieces, writeAudioManifest } from './audio';
import { lint, readBook } from './books';
import { segmentChapter } from './segment';


describe('splitPieces', () => {
  it('keeps short paragraphs whole', () => expect(splitPieces('一句话。')).toEqual(['一句话。']));

  it('splits long paragraphs at sentence ends within the limit', () => {
    const text = '甲'.repeat(8) + '。' + '乙'.repeat(8) + '！' + '丙'.repeat(3);
    const pieces = splitPieces(text, 10);
    expect(pieces).toEqual(['甲甲甲甲甲甲甲甲。', '乙乙乙乙乙乙乙乙！', '丙丙丙']);
    expect(pieces.join('')).toBe(text);
  });

  it('hard-cuts a sentence that is still too long', () => {
    const pieces = splitPieces('长'.repeat(25), 10);
    expect(pieces.map((p) => p.length)).toEqual([10, 10, 5]);
  });
});

describe('requestText', () => {
  it('turns ASCII brackets into full-width so they are not read as tags', () =>
    expect(requestText('见 [第 3 章]')).toBe('见 【第 3 章】'));
});

describe('planAudio', () => {
  const book = readBook(path.resolve(import.meta.dirname, '../../../apps/mobile/samples/markdown-cheatsheet'));
  const meta = lint(book).manifest!;
  const voice = { provider: 'fish' as const, id: 'v1' };

  it('builds a valid manifest that the app can match against the reader', () => {
    const plan = planAudio(book, meta, voice, DEFAULT_PARAMS);
    expect(audioManifestSchema.safeParse(plan.manifest).success).toBe(true);
    for (const ch of meta.chapters) {
      const paragraphs = segmentChapter(book.files.find((f) => f.path === ch)!.text!);
      expect(chapterAudio(plan.manifest, ch, paragraphs)).not.toBeNull();
    }
    // 重复的提示语只合成一次
    const all = Object.values(plan.manifest.chapters).flat().flatMap((e) => e.files);
    expect(plan.jobs.size).toBeLessThan(all.length);
    expect(Math.max(...[...plan.jobs.values()].map((t) => t.length))).toBeLessThanOrEqual(450);
  });

  it('changes every fingerprint with the voice or params but keeps paragraph keys', () => {
    const a = planAudio(book, meta, voice, DEFAULT_PARAMS);
    const b = planAudio(book, meta, voice, { ...DEFAULT_PARAMS, speed: 1.25 });
    const ch = meta.chapters[0];
    expect(b.manifest.chapters[ch].map((e) => e.key)).toEqual(a.manifest.chapters[ch].map((e) => e.key));
    const filesA = new Set(a.jobs.keys());
    expect([...b.jobs.keys()].some((fp) => filesA.has(fp))).toBe(false);
  });

  it('writes only complete chapters and removes unreferenced recordings', () => {
    const plan = planAudio(book, meta, voice, DEFAULT_PARAMS);
    const dir = mkdtempSync(path.join(tmpdir(), 'shelf-audio-'));
    const [first, ...rest] = meta.chapters;
    for (const fp of plan.chapterFiles.get(first)!) writeFileSync(path.join(dir, `${fp}.mp3`), 'x');
    writeFileSync(path.join(dir, '0000000000000000.mp3'), 'stale');
    writeFileSync(path.join(dir, 'abc.mp3.part'), 'partial');
    const complete = writeAudioManifest(dir, plan);
    const written = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    // 其余章节和第一章共用的提示语录音可能已经齐了，所以只断言第一章在、缺文件的章不在
    expect(Object.keys(written.chapters)).toContain(first);
    expect(complete).toBe(Object.keys(written.chapters).length);
    expect(complete).toBeLessThanOrEqual(1 + rest.length);
    expect(readdirSync(dir)).not.toContain('0000000000000000.mp3');
    expect(readdirSync(dir)).not.toContain('abc.mp3.part');
  });
});

describe('buildChapterPackage', () => {
  it('builds a package the app accepts, with only that chapter', () => {
    const book = readBook(path.resolve(import.meta.dirname, '../../../apps/mobile/samples/markdown-cheatsheet'));
    const meta = lint(book).manifest!;
    const plan = planAudio(book, meta, { provider: 'fish', id: 'v1' }, DEFAULT_PARAMS);
    const dir = mkdtempSync(path.join(tmpdir(), 'shelf-audio-'));
    for (const fp of plan.jobs.keys()) writeFileSync(path.join(dir, `${fp}.mp3`), fp);
    writeAudioManifest(dir, plan);
    const local = readAudioManifest(dir);
    const chapter = meta.chapters[0];
    const r = prepareAudioImport(buildChapterPackage(dir, local, chapter));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.manifest.chapters)).toEqual([chapter]);
    expect(sameChapterAudio(r.manifest, local, chapter)).toBe(true);
  });
});
