import path from 'node:path';
import { isAllowedFile, prepareImport } from '@shelf/spec';
import { describe, expect, it } from 'vitest';
import { findBooks, groupByCategory, lint, NO_CATEGORY, packBook, readBook, sameNotes } from './books';

const booksRoot = path.resolve(import.meta.dirname, '../../../books');

// 只取能通过 check 的书：books/ 里可能有正在写、还不完整的书，它们不该让测试失败
const validBooks = findBooks(booksRoot)
  .map(readBook)
  .filter((b) => lint(b).errors.length === 0);

describe('packBook', () => {
  it('has books to test', () => expect(validBooks.length).toBeGreaterThan(0));

  // 每本合格的书打包后，App 的导入管线都应原样还原出全部文件
  for (const book of validBooks) {
    it(`round-trips ${book.dirName} through prepareImport`, () => {
      const { manifest } = lint(book);
      const r = prepareImport({ kind: 'zip', fileName: 'x.zip', bytes: packBook(book, manifest!.id) });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.id).toBe(manifest!.id);
      expect(r.warnings).toEqual([]);
      const expected = book.files.filter((f) => isAllowedFile(f.path)).map((f) => f.path).sort();
      expect(r.files.map((f) => f.path).sort()).toEqual(expected);
    });
  }
});

describe('groupByCategory', () => {
  const groups = groupByCategory(validBooks);

  it('lists every book exactly once', () => {
    const ids = groups.flatMap(([, rows]) => rows.map((r) => r.dirName)).sort();
    expect(ids).toEqual(validBooks.map((b) => b.dirName).sort());
  });

  it('sorts categories and the books inside each one', () => {
    const keys = groups.map(([k]) => k);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
    for (const [, rows] of groups) {
      const ids = rows.map((r) => r.dirName);
      expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
    }
  });

  it('puts books without a readable book.yaml last', () => {
    const broken = { dir: '/x', dirName: 'aaa-broken', files: [{ path: 'book.yaml', abs: '/x/book.yaml', size: 3, text: ': :' }] };
    const last = groupByCategory([...validBooks, broken]).at(-1)!;
    expect(last[0]).toBe(NO_CATEGORY);
    expect(last[1].find((r) => r.dirName === 'aaa-broken')?.title).toBeNull();
  });
});

describe('sameNotes', () => {
  const notes = (exported: string, body: string) => `---\nbook: x\nexported: ${exported}\ncount: 1\n---\n\n${body}\n`;
  it('ignores only the export date', () => {
    expect(sameNotes(notes('2026-11-01', '> a'), notes('2026-11-03', '> a'))).toBe(true);
    expect(sameNotes(notes('2026-11-01', '> a'), notes('2026-11-01', '> b'))).toBe(false);
  });
});
