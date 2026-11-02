import path from 'node:path';
import { isAllowedFile, prepareImport } from '@shelf/spec';
import { describe, expect, it } from 'vitest';
import { findBooks, lint, packBook, readBook } from './books';

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
