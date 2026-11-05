import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  bookAnchors,
  bookPath,
  deviceLinks,
  deviceNext,
  isAllowedFile,
  isLibraryOnly,
  LIBRARY_AUDIO_DIR,
  libraryHref,
  lintBook,
  parseLibraryLink,
  resolveBook,
  rewriteLinks,
  rewriteNextBooks,
  type BookManifest,
  type ChapterAnchors,
  type LintFile,
  type LintResult,
} from '@shelf/spec';
import { strToU8, zipSync, type Zippable } from 'fflate';

const TEXT = /\.(md|ya?ml)$/i;
const isJunk = (name: string) => name.startsWith('.');

/** 代码仓库根目录 */
export const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

/** 书库仓库（hatch-shelf-library）：环境变量 SHELF_LIBRARY，默认是代码仓库旁边的同名目录，与当前目录无关 */
export const libraryDir = () => path.resolve(REPO_ROOT, process.env.SHELF_LIBRARY ?? '../hatch-shelf-library');
/** 书库里放书的 books/ */
export const libraryBooks = () => path.join(libraryDir(), 'books');

export interface LocalBook {
  dir: string;
  dirName: string;
  /** 相对书库 books/ 的路径（用 / 分隔）；不在书库里（单独一本书、App 的示例书）时为 undefined */
  relPath?: string;
  /** 书里的文件；不含 audio/（录音另走音频包，几百个 mp3 没必要逐个读） */
  files: (LintFile & { abs: string })[];
}

/** 名为 books 的最近一级上层目录就是书库根目录；书库里的书放在 books/<分组>/<书名>/ */
export function libraryRoot(dir: string): string | undefined {
  for (let d = path.dirname(path.resolve(dir)); d !== path.dirname(d); d = path.dirname(d)) {
    if (path.basename(d) === 'books') return d;
  }
  return undefined;
}

const isBookDir = (dir: string) => existsSync(path.join(dir, 'book.yaml'));
const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();
const subdirs = (dir: string) =>
  readdirSync(dir)
    .filter((n) => !isJunk(n) && n !== 'assets' && n !== LIBRARY_AUDIO_DIR && isDir(path.join(dir, n)))
    .map((n) => path.join(dir, n));
const hasRootMarkdown = (dir: string) => readdirSync(dir).some((n) => !isJunk(n) && n.endsWith('.md'));

/**
 * `<path>` 直接是一本书就只返回它；否则当作书库（或其中一个分组）递归往下找：
 * 有 book.yaml 的目录是书，不再往里找；没有 book.yaml 但根目录有 .md 的也算书（导入时会走容错规则）
 */
export function findBooks(target: string): string[] {
  const abs = path.resolve(target);
  if (!isDir(abs)) throw new Error(`不是目录：${target}`);
  if (isBookDir(abs)) return [abs];
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const sub of subdirs(dir)) {
      if (isBookDir(sub) || hasRootMarkdown(sub)) found.push(sub);
      else walk(sub);
    }
  };
  walk(abs);
  return found.length > 0 ? found.sort() : [abs];
}

const relTo = (root: string, dir: string) => path.relative(root, path.resolve(dir)).split(path.sep).join('/').normalize('NFC');

export function readBook(dir: string): LocalBook {
  const files: LocalBook['files'] = [];
  const walk = (sub: string) => {
    for (const name of readdirSync(path.join(dir, sub))) {
      if (isJunk(name) || (!sub && name === LIBRARY_AUDIO_DIR)) continue;
      const rel = sub ? `${sub}/${name}` : name;
      const abs = path.join(dir, rel);
      const st = statSync(abs);
      if (st.isDirectory()) walk(rel);
      else files.push({ path: rel.normalize('NFC'), abs, size: st.size, text: TEXT.test(name) ? readFileSync(abs, 'utf8') : undefined });
    }
  };
  walk('');
  const root = libraryRoot(dir);
  return { dir: path.resolve(dir), dirName: path.basename(dir), relPath: root ? relTo(root, dir) : undefined, files };
}

export interface IndexEntry {
  dir: string;
  relPath: string;
  /** book.yaml 读不出来时为 null */
  manifest: BookManifest | null;
}

function readManifest(dir: string): BookManifest | null {
  const file = path.join(dir, 'book.yaml');
  if (!existsSync(file)) return null;
  const mdFiles = readdirSync(dir).filter((n) => !isJunk(n) && n.endsWith('.md'));
  const r = resolveBook({ dirName: path.basename(dir), yamlText: readFileSync(file, 'utf8'), mdFiles });
  return r.ok ? r.manifest : null;
}

const indexCache = new Map<string, IndexEntry[]>();

/** 书库（或任意一个放书的目录）里的全部书；同一个根目录只扫一次，写入书库后调 forgetIndex() */
export function bookIndex(root: string): IndexEntry[] {
  const abs = path.resolve(root);
  if (!indexCache.has(abs)) {
    const entries = isDir(abs)
      ? findBooks(abs)
          .filter((dir) => dir !== abs)
          .map((dir) => ({ dir, relPath: relTo(abs, dir), manifest: readManifest(dir) }))
      : [];
    indexCache.set(abs, entries);
  }
  return indexCache.get(abs)!;
}

export function forgetIndex() {
  indexCache.clear();
  anchorCache.clear();
}

const byId = (root: string, id: string) => bookIndex(root).find((e) => e.manifest?.id === id);
const byPath = (root: string, rel: string) => bookIndex(root).find((e) => e.relPath === rel.normalize('NFC'));

/**
 * 命令行里的一本书。依次按：已有的目录、书库里的路径（`分组/书名`）、id、完整书名、书名的一部分（不分大小写）找，
 * 部分匹配到多本时报错并列出来。书库里的 id 是 UUID，平时传书名就行
 */
export function findBook(arg: string, root = libraryBooks()): string {
  const abs = path.resolve(arg);
  if (isBookDir(abs)) return abs;
  const key = arg.normalize('NFC');
  const index = bookIndex(root);
  const exact = byPath(root, key) ?? byId(root, key) ?? index.find((e) => e.manifest?.title === key);
  if (exact) return exact.dir;
  const lower = key.toLowerCase();
  const partial = index.filter((e) => e.manifest?.title.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0].dir;
  if (partial.length > 1) {
    throw new Error(`「${arg}」匹配到 ${partial.length} 本书，写完整一点：\n${partial.map((e) => `  ${e.relPath}`).join('\n')}`);
  }
  throw new Error(`找不到书：${arg}（不是目录，也不是书库里任何一本书的路径、id 或书名）`);
}

/** check / push / ls 的目标：不传就是整个书库；可以是目录、书库里的分组名，或者一本书（同 findBook） */
export function resolveTarget(arg: string | undefined, root = libraryBooks()): string {
  if (arg === undefined) return root;
  const abs = path.resolve(arg);
  if (isDir(abs)) return abs;
  const group = path.join(root, arg.normalize('NFC'));
  if (isDir(group)) return group;
  return findBook(arg, root);
}

const anchorCache = new Map<string, ChapterAnchors | null>();

function anchorsOf(dir: string): ChapterAnchors | null {
  if (!anchorCache.has(dir)) anchorCache.set(dir, bookAnchors(path.basename(dir), readBook(dir).files)?.chapters ?? null);
  return anchorCache.get(dir)!;
}

/**
 * 手机写法 `../<id>/` 的跨书链接和 next 的 id：只在不在书库里的书（App 的示例书、单独拷出来的书）用到，
 * 在同级目录里找；找不到也无从判断是否真的不存在，返回 undefined 跳过检查
 */
function siblingAnchors(book: LocalBook, id: string): ChapterAnchors | undefined {
  const found = bookIndex(path.dirname(book.dir)).find((e) => e.manifest?.id === id);
  return found ? (anchorsOf(found.dir) ?? undefined) : undefined;
}

export function lint(book: LocalBook): LintResult {
  const root = libraryRoot(book.dir);
  return lintBook(book.dirName, book.files, {
    resolveBook: (id) => (root ? (byId(root, id) ? anchorsOf(byId(root, id)!.dir) : null) : siblingAnchors(book, id)),
    library:
      root && book.relPath !== undefined
        ? { relPath: book.relPath, resolvePath: (p) => (byPath(root, p) ? anchorsOf(byPath(root, p)!.dir) : null) }
        : undefined,
  });
}

/** 输出里称呼一本书：书库里用 `分组/书名`，否则用 id，book.yaml 读不出来时用目录名 */
export const bookLabel = (book: LocalBook, r?: { manifest?: { id: string } }) => book.relPath ?? r?.manifest?.id ?? book.dirName;

export interface ListRow {
  id: string;
  title: string | null;
  chapters: number;
  updated: string | null;
  /** 书目录里有原声清单 */
  audio: boolean;
}

export const NO_CATEGORY = '(未分类)';

/** 按 category 分组，组和组内都按字母序；book.yaml 读不出来的书归入未分类，title 为 null */
export function groupByCategory(books: LocalBook[]): [string, ListRow[]][] {
  const groups = new Map<string, ListRow[]>();
  for (const book of books) {
    const m = lint(book).manifest;
    const key = m?.category ?? NO_CATEGORY;
    const row = {
      id: m?.id ?? book.dirName,
      title: m?.title ?? null,
      chapters: m?.chapters.length ?? 0,
      updated: m?.updated ?? null,
      audio: existsSync(path.join(book.dir, LIBRARY_AUDIO_DIR, 'manifest.json')),
    };
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const byName = (a: string, b: string) => (a === NO_CATEGORY ? 1 : b === NO_CATEGORY ? -1 : a.localeCompare(b));
  const rowName = (r: ListRow) => r.title ?? r.id;
  return [...groups]
    .sort(([a], [b]) => byName(a, b))
    .map(([k, rows]) => [k, rows.sort((a, b) => rowName(a).localeCompare(rowName(b)))]);
}

/**
 * 打成 App 导入管线接受的 zip：所有文件放在 `<id>/` 下，只包含允许的扩展名，不带书库专有的 audio/ 和 notes.md。
 * 书库里的书顺带把按路径写的跨书链接和 next 换成手机上的 id 写法
 */
export function packBook(book: LocalBook, id: string): Uint8Array {
  const root = libraryRoot(book.dir);
  const toId = (p: string) => (root ? (byPath(root, p)?.manifest?.id ?? null) : null);
  const tree: Zippable = {};
  for (const f of book.files) {
    if (!isAllowedFile(f.path) || isLibraryOnly(f.path)) continue;
    let text = f.text;
    if (text !== undefined && root) {
      if (f.path === 'book.yaml') text = deviceNext(text, toId);
      else if (f.path.endsWith('.md') && !f.path.includes('/')) text = deviceLinks(text, toId);
    }
    const data = text !== undefined ? strToU8(text) : new Uint8Array(readFileSync(f.abs));
    // 图片本身已压缩，再压一遍只浪费时间
    tree[`${id}/${f.path}`] = [data, { level: /\.(png|jpe?g|gif|webp)$/i.test(f.path) ? 0 : 6 }];
  }
  return zipSync(tree, { mtime: new Date('2026-01-01') });
}

/** YAML 标量：含特殊字符时加引号 */
const yamlScalar = (s: string) => (/^[\s'"]|[\s]$|[:#[\]{},&*!|>%@`]/.test(s) ? JSON.stringify(s) : s);
const today = () => new Date().toISOString().slice(0, 10);

/** 新建一本书：生成 UUID，按 <分组>/<书名> 建目录，写好 book.yaml 和第一章 */
export function newBook(category: string, title: string, root = libraryBooks()): string {
  const manifest = { title: title.trim(), category: category.trim() };
  const dir = path.join(root, bookPath(manifest));
  if (existsSync(dir)) throw new Error(`已经有这个目录了：${path.relative(root, dir)}`);
  mkdirSync(dir, { recursive: true });
  const chapter = '01-开篇.md';
  writeFileSync(
    path.join(dir, 'book.yaml'),
    [
      `id: ${randomUUID()}`,
      `title: ${yamlScalar(manifest.title)}`,
      `category: ${yamlScalar(manifest.category)}`,
      `created: ${today()}`,
      `updated: ${today()}`,
      'chapters:',
      `  - ${chapter}`,
      '',
    ].join('\n'),
  );
  writeFileSync(path.join(dir, chapter), '# 开篇\n');
  forgetIndex();
  return dir;
}

export interface MoveResult {
  from: string;
  to: string;
  /** 改写了引用的文件（相对 books/） */
  rewritten: string[];
}

/**
 * 改书名或分类：改 book.yaml、移动目录，并把书库里指向这本书的跨书链接和 next 一起改掉。
 * 跨书链接统一从 `../../` 写起，所以这本书自己往外的链接不用动；id 不变，手机上照常是同一本书
 */
export function moveBook(dir: string, change: { title?: string; category?: string }, root = libraryRoot(dir)): MoveResult {
  if (!root) throw new Error('只有书库里的书能用 mv');
  const yamlFile = path.join(dir, 'book.yaml');
  const manifest = readManifest(dir);
  if (!manifest) throw new Error(`${yamlFile} 读不出来，先修好再移动`);
  const from = relTo(root, dir);
  const next = { title: change.title?.trim() ?? manifest.title, category: change.category?.trim() ?? manifest.category };
  const to = bookPath(next);

  let yaml = readFileSync(yamlFile, 'utf8');
  if (change.title !== undefined) yaml = yaml.replace(/^title:.*$/m, `title: ${yamlScalar(next.title)}`);
  if (change.category !== undefined) {
    yaml = /^category:/m.test(yaml)
      ? yaml.replace(/^category:.*$/m, `category: ${yamlScalar(next.category!)}`)
      : yaml.replace(/^(title:.*)$/m, `$1\ncategory: ${yamlScalar(next.category!)}`);
  }
  writeFileSync(yamlFile, yaml);

  const rewritten: string[] = [];
  if (to !== from) {
    const target = path.join(root, to);
    if (existsSync(target)) throw new Error(`目标目录已存在：${to}`);
    mkdirSync(path.dirname(target), { recursive: true });
    renameSync(dir, target);
    const oldParent = path.dirname(dir);
    if (oldParent !== root && readdirSync(oldParent).filter((n) => !isJunk(n)).length === 0) rmdirSync(oldParent);

    for (const entry of bookIndex(root)) {
      const bookDir = entry.dir === dir ? target : entry.dir;
      for (const name of readdirSync(bookDir).filter((n) => n === 'book.yaml' || (n.endsWith('.md') && !isJunk(n)))) {
        const file = path.join(bookDir, name);
        const text = readFileSync(file, 'utf8');
        const out =
          name === 'book.yaml'
            ? rewriteNextBooks(text, (p) => (p === from ? `book: ${to}` : undefined))
            : rewriteLinks(text, (href) => {
                const link = parseLibraryLink(href);
                return link?.path === from ? libraryHref(to, link.file, link.anchor) : undefined;
              });
        if (out !== text) {
          writeFileSync(file, out);
          rewritten.push(`${relTo(root, bookDir)}/${name}`);
        }
      }
    }
  }
  forgetIndex();
  return { from, to, rewritten };
}

/** 两份笔记导出是否只差导出日期；只差日期时不重写文件，避免每次拉取都产生 diff */
export function sameNotes(a: string, b: string): boolean {
  const strip = (s: string) => s.replace(/^exported: .*$/m, '');
  return strip(a) === strip(b);
}
