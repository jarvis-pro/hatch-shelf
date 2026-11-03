import { describe, expect, it } from 'vitest';
import { backupFileName, describeRestore, parseBackup, planRestore, type HighlightRow, type ProgressRow } from './format';

const progress = (book: string, file: string, at: number): ProgressRow => ({
  book_id: book,
  chapter_file: file,
  scroll_ratio: 0.5,
  anchor: null,
  updated_at: at,
});
const highlight = (id: string, at: number, note: string | null = null): HighlightRow => ({
  id,
  book_id: 'b',
  chapter_file: '01.md',
  text: 't',
  prefix: '',
  suffix: '',
  anchor: null,
  kind: 'highlight',
  note,
  created_at: 1,
  updated_at: at,
});
const backup = (extra: object = {}) =>
  JSON.stringify({ format: 'hatch-shelf-backup', version: 1, exportedAt: 9, progress: [], highlights: [], settings: {}, ...extra });

describe('parseBackup', () => {
  it('accepts a backup and keeps only reader-facing settings', () => {
    const r = parseBackup(backup({ settings: { appearance: 'dark', readerHash: 'x', introPlayed: true } }));
    expect(r.ok && r.backup.settings).toEqual({ appearance: 'dark' });
  });
  it('defaults the kind of highlights from older backups', () => {
    const { kind: _, ...old } = highlight('h', 1);
    const r = parseBackup(backup({ highlights: [old] }));
    expect(r.ok && r.backup.highlights[0].kind).toBe('highlight');
  });
  it('rejects other files and newer versions', () => {
    expect(parseBackup('nope')).toEqual({ ok: false, error: '不是有效的 JSON 文件' });
    expect(parseBackup('{}')).toEqual({ ok: false, error: '不是书巢的阅读数据备份' });
    expect(parseBackup(backup({ version: 2 }))).toEqual({ ok: false, error: '备份来自更新版本的书巢，请先更新 App' });
    expect(parseBackup(backup({ progress: [{ book_id: 'b' }] }))).toEqual({ ok: false, error: '备份里有无法识别的记录' });
  });
});

describe('planRestore', () => {
  it('adds missing rows and keeps the newer copy of existing ones', () => {
    const r = parseBackup(
      backup({
        progress: [progress('a', '01.md', 5), progress('a', '02.md', 5), progress('c', '01.md', 5)],
        highlights: [highlight('new', 5), highlight('older', 1), highlight('newer', 9, '改过')],
      }),
    );
    if (!r.ok) throw new Error(r.error);
    const plan = planRestore(
      { progress: [progress('a', '01.md', 9), progress('a', '02.md', 1)], highlights: [highlight('older', 5), highlight('newer', 5)] },
      r.backup,
    );
    expect(plan.progress.map((p) => `${p.book_id}/${p.chapter_file}`)).toEqual(['a/02.md', 'c/01.md']);
    expect(plan.highlights.map((h) => h.id)).toEqual(['new', 'newer']);
    expect(plan.summary).toEqual({ progressAdded: 1, progressUpdated: 1, highlightsAdded: 1, highlightsUpdated: 1 });
    expect(describeRestore(plan)).toBe('已恢复 2 本书的阅读进度、2 条高亮与笔记');
  });
  it('says so when nothing needs restoring', () => {
    const r = parseBackup(backup());
    if (!r.ok) throw new Error(r.error);
    expect(describeRestore(planRestore({ progress: [], highlights: [] }, r.backup))).toBe(
      '本机的阅读数据已经是最新的，没有需要恢复的内容',
    );
  });
});

it('names backup files by date', () => {
  expect(backupFileName(Date.UTC(2026, 10, 3, 12))).toBe('shelf-backup-2026-11-03.json');
});
