import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isAllowedFile, isLibraryOnly, prepareImport } from '@shelf/spec';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { findBook, findBooks, groupByCategory, lint, moveBook, newBook, NO_CATEGORY, packBook, readBook, sameNotes } from './books';

// 默认只测 App 自带的示例书；设了 SHELF_LIBRARY（书库仓库，相对代码仓库根目录，如 ../hatch-shelf-library）就测整个书库
const repoRoot = path.resolve(import.meta.dirname, '../../..');
const booksRoot = process.env.SHELF_LIBRARY
  ? path.join(path.resolve(repoRoot, process.env.SHELF_LIBRARY), 'books')
  : path.join(repoRoot, 'app/samples');

// 只取能通过 check 的书：书库里可能有正在写、还不完整的书，它们不该让测试失败
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
      const expected = book.files.filter((f) => isAllowedFile(f.path) && !isLibraryOnly(f.path)).map((f) => f.path).sort();
      expect(r.files.map((f) => f.path).sort()).toEqual(expected);
    });
  }
});

describe('groupByCategory', () => {
  const groups = groupByCategory(validBooks);

  it('lists every book exactly once', () => {
    const ids = groups.flatMap(([, rows]) => rows.map((r) => r.id)).sort();
    expect(ids).toEqual(validBooks.map((b) => lint(b).manifest!.id).sort());
  });

  it('sorts categories and the books inside each one', () => {
    const keys = groups.map(([k]) => k);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
    for (const [, rows] of groups) {
      const names = rows.map((r) => r.title ?? r.id);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    }
  });

  it('puts books without a readable book.yaml last', () => {
    const broken = { dir: '/x', dirName: 'aaa-broken', files: [{ path: 'book.yaml', abs: '/x/book.yaml', size: 3, text: ': :' }] };
    const last = groupByCategory([...validBooks, broken]).at(-1)!;
    expect(last[0]).toBe(NO_CATEGORY);
    expect(last[1].find((r) => r.id === 'aaa-broken')?.title).toBeNull();
  });
});

describe('sameNotes', () => {
  const notes = (exported: string, body: string) => `---\nbook: x\nexported: ${exported}\ncount: 1\n---\n\n${body}\n`;
  it('ignores only the export date', () => {
    expect(sameNotes(notes('2026-11-01', '> a'), notes('2026-11-03', '> a'))).toBe(true);
    expect(sameNotes(notes('2026-11-01', '> a'), notes('2026-11-01', '> b'))).toBe(false);
  });
});

describe('library', () => {
  // books/<分组>/<书名>/，id 是 UUID，跨书引用按路径写，打包时换成 id
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'shelf-')), 'books');
  const GO = '11111111-1111-4111-8111-111111111111';
  const RUST = '22222222-2222-4222-8222-222222222222';
  const write = (rel: string, id: string, title: string, category: string, body: string, extra = '') => {
    const dir = path.join(root, rel);
    mkdirSync(path.join(dir, 'audio'), { recursive: true });
    writeFileSync(path.join(dir, 'book.yaml'), `id: ${id}\ntitle: ${title}\ncategory: ${category}\nchapters: [01-并发.md]\n${extra}`);
    writeFileSync(path.join(dir, '01-并发.md'), body);
    writeFileSync(path.join(dir, 'notes.md'), '# 笔记\n');
    writeFileSync(path.join(dir, 'audio', 'manifest.json'), '{}');
    return dir;
  };
  const go = write('技术/Go 实战', GO, 'Go 实战', '技术/Go', '# 并发\n\n见 [所有权](<../../技术/Rust 入门/01-并发.md#并发>)', 'next:\n  - book: 技术/Rust 入门\n');
  const rust = write('技术/Rust 入门', RUST, 'Rust 入门', '技术/Rust', '# 并发\n\n回到 [Go](<../../技术/Go 实战/>)');

  it('finds books by path, id, title or part of the title', () => {
    expect(findBooks(root)).toEqual([go, rust]);
    expect(findBook('技术/Rust 入门', root)).toBe(rust);
    expect(findBook(RUST, root)).toBe(rust);
    expect(findBook('Go 实战', root)).toBe(go);
    expect(findBook('rust', root)).toBe(rust);
    expect(() => findBook(' ', root)).toThrow('匹配到');
    expect(() => findBook('Python', root)).toThrow('找不到书');
  });

  it('checks the library rules and resolves path links', () => {
    expect(lint(readBook(go))).toMatchObject({ errors: [], warnings: [] });
    expect(lint(readBook(rust)).errors).toEqual([]);
  });

  it('packs without library-only files and with device links', () => {
    const files = unzipSync(packBook(readBook(go), GO));
    expect(Object.keys(files).sort()).toEqual([`${GO}/01-并发.md`, `${GO}/book.yaml`]);
    expect(strFromU8(files[`${GO}/01-并发.md`])).toContain(`[所有权](../${RUST}/01-并发.md#并发)`);
    expect(strFromU8(files[`${GO}/book.yaml`])).toContain(`  - id: ${RUST}`);
  });

  it('creates a book and moves it, rewriting links that point to it', () => {
    const dir = newBook('人工智能/RAG', 'RAG 与知识系统', root);
    expect(path.relative(root, dir)).toBe('人工智能/RAG 与知识系统');
    expect(lint(readBook(dir)).errors).toEqual([]);

    const r = moveBook(rust, { title: 'Rust 实用入门' }, root);
    expect(r).toMatchObject({ from: '技术/Rust 入门', to: '技术/Rust 实用入门' });
    expect(existsSync(rust)).toBe(false);
    expect(readFileSync(path.join(go, '01-并发.md'), 'utf8')).toContain('(<../../技术/Rust 实用入门/01-并发.md#并发>)');
    expect(readFileSync(path.join(go, 'book.yaml'), 'utf8')).toContain('  - book: 技术/Rust 实用入门');
    expect(lint(readBook(go)).errors).toEqual([]);
    expect(lint(readBook(path.join(root, '技术/Rust 实用入门'))).errors).toEqual([]);
  });
});
