import path from 'node:path';
import { isAllowedFile, prepareImport } from '@shelf/spec';
import { describe, expect, it } from 'vitest';
import { findBooks, lint, packBook, readBook } from './books';

const booksRoot = path.resolve(import.meta.dirname, '../../../books');

describe('packBook', () => {
  // 仓库里每本书打包后，App 的导入管线都应原样还原出全部文件
  for (const dir of findBooks(booksRoot)) {
    it(`round-trips ${path.basename(dir)} through prepareImport`, () => {
      const book = readBook(dir);
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
