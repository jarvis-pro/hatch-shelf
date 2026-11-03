import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { isAllowedFile, lintBook, type LintFile, type LintResult } from '@shelf/spec';
import { strToU8, zipSync, type Zippable } from 'fflate';

const TEXT = /\.(md|ya?ml)$/i;
const isJunk = (name: string) => name.startsWith('.');

export interface LocalBook {
  dir: string;
  dirName: string;
  files: (LintFile & { abs: string })[];
}

/** `<book-dir>` 直接是一本书；否则把它当作 books/ 根目录，取下面的每个子目录 */
export function findBooks(target: string): string[] {
  const abs = path.resolve(target);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`不是目录：${target}`);
  if (existsSync(path.join(abs, 'book.yaml'))) return [abs];
  const subdirs = readdirSync(abs)
    .filter((n) => !isJunk(n) && statSync(path.join(abs, n)).isDirectory())
    .map((n) => path.join(abs, n));
  // 子目录里没有 book.yaml 也算书（导入时会走容错规则）；但若一个子目录都没有，就把目标本身当书
  return subdirs.length > 0 ? subdirs : [abs];
}

export function readBook(dir: string): LocalBook {
  const files: LocalBook['files'] = [];
  const walk = (sub: string) => {
    for (const name of readdirSync(path.join(dir, sub))) {
      if (isJunk(name)) continue;
      const rel = sub ? `${sub}/${name}` : name;
      const abs = path.join(dir, rel);
      const st = statSync(abs);
      if (st.isDirectory()) walk(rel);
      else files.push({ path: rel, abs, size: st.size, text: TEXT.test(name) ? readFileSync(abs, 'utf8') : undefined });
    }
  };
  walk('');
  return { dir, dirName: path.basename(dir), files };
}

export function lint(book: LocalBook): LintResult {
  return lintBook(book.dirName, book.files);
}

export interface ListRow {
  dirName: string;
  title: string | null;
  chapters: number;
  updated: string | null;
}

export const NO_CATEGORY = '(未分类)';

/** 按 category 分组，组和组内都按字母序；book.yaml 读不出来的书归入未分类，title 为 null */
export function groupByCategory(books: LocalBook[]): [string, ListRow[]][] {
  const groups = new Map<string, ListRow[]>();
  for (const book of books) {
    const m = lint(book).manifest;
    const key = m?.category ?? NO_CATEGORY;
    const row = { dirName: book.dirName, title: m?.title ?? null, chapters: m?.chapters.length ?? 0, updated: m?.updated ?? null };
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const byName = (a: string, b: string) => (a === NO_CATEGORY ? 1 : b === NO_CATEGORY ? -1 : a.localeCompare(b));
  return [...groups]
    .sort(([a], [b]) => byName(a, b))
    .map(([k, rows]) => [k, rows.sort((a, b) => a.dirName.localeCompare(b.dirName))]);
}

/**
 * 打成 App 导入管线接受的 zip：所有文件放在 `<id>/` 下，只包含允许的扩展名。
 */
export function packBook(book: LocalBook, id: string): Uint8Array {
  const tree: Zippable = {};
  for (const f of book.files) {
    if (!isAllowedFile(f.path)) continue;
    const data = f.text !== undefined ? strToU8(f.text) : new Uint8Array(readFileSync(f.abs));
    // 图片本身已压缩，再压一遍只浪费时间
    tree[`${id}/${f.path}`] = [data, { level: /\.(png|jpe?g|gif|webp)$/i.test(f.path) ? 0 : 6 }];
  }
  return zipSync(tree, { mtime: new Date('2026-01-01') });
}
