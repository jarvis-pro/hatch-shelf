/**
 * 书库（hatch-shelf-library）里的约定，README 第 4.1 节。
 *
 * 书库是给人看的：书放在 `books/<分类第一段>/<书名>/`，章节文件可以用中文名，跨书引用按路径写；
 * 手机上则是机器的视角：书平铺在 `books/<id>/`，id 是 UUID。两边的差别只在打包时翻译一次
 * （`deviceLinks()` / `deviceNext()`），App 和阅读器只认手机上的写法。
 */
import { rewriteLinks } from './links';
import type { BookManifest } from './schema';

/** 书库里新书的 id：小写 UUID（`crypto.randomUUID()`），不带含义，改书名、换分类都不用动 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * 只在书库里有、不进书包的东西：原声录音 `audio/`（按段落指纹命名的 mp3 + manifest.json，另走音频包推送）
 * 和从手机导出的阅读笔记 `notes.md`
 */
export const LIBRARY_AUDIO_DIR = 'audio';
export const LIBRARY_NOTES_FILE = 'notes.md';
export const isLibraryOnly = (path: string) => path === LIBRARY_NOTES_FILE || path.startsWith(`${LIBRARY_AUDIO_DIR}/`);

/** 书名当目录名时换掉的字符：路径分隔符和 macOS 会换成 / 的冒号改成全角，控制字符去掉 */
export const dirSafe = (name: string) =>
  name
    .trim()
    .replace(/\//g, '／')
    .replace(/\\/g, '＼')
    .replace(/:/g, '：')
    .replace(/[\u0000-\u001f]/g, '');

/**
 * 书在书库里的目录（相对 books/）：`<category 第一段>/<书名>`，没有分类时就是书名。
 * 第一段就是书架上的分组；子分类只写在 book.yaml 里，不建目录
 */
export function bookPath(manifest: Pick<BookManifest, 'title' | 'category'>): string {
  const title = dirSafe(manifest.title);
  const group = manifest.category?.split('/')[0];
  return (group ? `${group}/${title}` : title).normalize('NFC');
}

const decodeSegment = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export interface LibraryLink {
  /** 目标书相对 books/ 的路径：`<分组>/<书名>` */
  path: string;
  file?: string;
  anchor?: string;
}

/**
 * 书库里的跨书链接：从章节文件出发的 `../../<分组>/<书名>/[章节.md][#小节]`。
 * 书都在 books/ 下第二层，所以统一从 `../../` 写起，同组的书也一样；书名有空格时整个地址用 `<…>` 括起来
 */
export function parseLibraryLink(href: string): LibraryLink | null {
  const m = /^\.\.\/\.\.\/([^/#?]+)\/([^/#?]+)\/(?:([^/#?]+\.md))?(?:#(.+))?$/.exec(href);
  if (!m) return null;
  return {
    path: `${decodeSegment(m[1])}/${decodeSegment(m[2])}`.normalize('NFC'),
    file: m[3] === undefined ? undefined : decodeSegment(m[3]).normalize('NFC'),
    anchor: m[4] === undefined ? undefined : decodeSegment(m[4]),
  };
}

/** 拼出书库写法的跨书链接地址（含空格时由 rewriteLinks 加上 `<…>`） */
export const libraryHref = (path: string, file?: string, anchor?: string) =>
  `../../${path}/${file ?? ''}${anchor ? `#${anchor}` : ''}`;

/** 打包：书库写法的跨书链接换成手机上的 `../<id>/…`；`resolvePath` 找不到的书原样保留（check 会报错） */
export function deviceLinks(markdown: string, resolvePath: (path: string) => string | null): string {
  return rewriteLinks(markdown, (href) => {
    const link = parseLibraryLink(href);
    const id = link && resolvePath(link.path);
    if (!link || !id) return undefined;
    return `../${id}/${link.file ?? ''}${link.anchor ? `#${link.anchor}` : ''}`;
  });
}

const NEXT_BOOK_LINE = /^(\s*(?:-\s+)?)book:\s*(.+?)\s*$/;
const unquote = (s: string) => s.replace(/^(['"])(.*)\1$/, '$2');

/** book.yaml 里 next 的 `book: <分组>/<书名>` 各行，按出现顺序 */
export function nextBookPaths(yamlText: string): string[] {
  return yamlText
    .split(/\r?\n/)
    .map((line) => NEXT_BOOK_LINE.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => unquote(m[2]).normalize('NFC'));
}

/** 改写 book.yaml 里 next 的 `book:` 行；`map` 返回整行的新内容（不含缩进和 `- `），返回 undefined 保留原样 */
export function rewriteNextBooks(yamlText: string, map: (path: string) => string | undefined): string {
  return yamlText
    .split('\n')
    .map((line) => {
      const m = NEXT_BOOK_LINE.exec(line.replace(/\r$/, ''));
      const replaced = m ? map(unquote(m[2]).normalize('NFC')) : undefined;
      return m && replaced !== undefined ? `${m[1]}${replaced}${line.endsWith('\r') ? '\r' : ''}` : line;
    })
    .join('\n');
}

/** 打包：next 的 `book: <路径>` 换成 `id: <uuid>` */
export const deviceNext = (yamlText: string, resolvePath: (path: string) => string | null) =>
  rewriteNextBooks(yamlText, (path) => {
    const id = resolvePath(path);
    return id ? `id: ${id}` : undefined;
  });
