import { parseLibraryLink, type LibraryLink } from './library';
import { createSlugger, headingText, scanMarkdown } from './markdown';

/**
 * 书里的链接指向哪里。阅读器据此跳转，shelf-pack check 据此校验目标是否存在。
 *
 * - `#anchor`：本章小节
 * - `02-x.md#anchor`：本书另一章（章节文件名可以是中文，渲染后的 href 是百分号编码的，这里解码）
 * - `../other-id/`、`../other-id/03-x.md#anchor`：另一本书（打开到上次读到的位置，或指定章节、小节）
 *
 * 书库里的跨书链接按路径写（`../../<分组>/<书名>/…`，见 library.ts），打包时换成上面的 `../<id>/`，阅读器不会看到
 * - `https://…`：外部链接，交给系统打开
 */
export type BookLink =
  | { kind: 'anchor'; anchor: string }
  | { kind: 'chapter'; file: string; anchor?: string }
  | { kind: 'book'; bookId: string; file?: string; anchor?: string }
  | { kind: 'external'; url: string };

const decode = (s: string | undefined) => {
  if (!s) return undefined;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** 无法识别的写法返回 null（阅读器忽略，check 报错） */
export function parseBookLink(href: string): BookLink | null {
  let m = /^#(.+)$/.exec(href);
  if (m) return { kind: 'anchor', anchor: decode(m[1])! };
  m = /^(?:\.\/)?([^/#?]+\.md)(?:#(.+))?$/.exec(href);
  if (m) return { kind: 'chapter', file: decode(m[1])!.normalize('NFC'), anchor: decode(m[2]) };
  m = /^\.\.\/([a-z0-9-]+)(?:\/(?:([^/#?]+\.md)(?:#(.+))?)?)?$/.exec(href);
  if (m) return { kind: 'book', bookId: m[1], file: decode(m[2])?.normalize('NFC'), anchor: decode(m[3]) };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { kind: 'external', url: href };
  return null;
}

/** 一章里所有标题的锚点（H1–H6），算法与阅读器给标题加 id 一致 */
export function headingAnchors(markdown: string): Set<string> {
  const slug = createSlugger();
  const anchors = new Set<string>();
  for (const line of scanMarkdown(markdown)) {
    if (line.inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.text);
    if (m) anchors.add(slug(headingText(m[2])));
  }
  return anchors;
}

export interface MarkdownLink {
  /** 1 起始的行号 */
  line: number;
  href: string;
}

/** `[文字](地址 "标题")`；地址可以用 `<…>` 括起来（里面可以有空格）。分组：1 地址之前、2 `<…>` 里的地址、3 普通地址、4 地址之后 */
const LINK_RE = /((?<!!)\[[^\]]*\]\(\s*)(?:<([^>\n]*)>|([^)\s<>]+))((?:\s+"[^"]*")?\s*\))/g;

/** 把一行里行内代码以外的部分交给 fn 处理，行内代码原样保留 */
function outsideCode(text: string, fn: (part: string) => string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(/(`+)[\s\S]*?\1/g)) {
    out += fn(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + fn(text.slice(last));
}

/** 正文里的链接（不含图片、代码块和行内代码里的示例） */
export function collectLinks(markdown: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  for (const line of scanMarkdown(markdown)) {
    if (line.inFence) continue;
    outsideCode(line.text, (part) => {
      for (const m of part.matchAll(LINK_RE)) links.push({ line: line.no, href: m[2] ?? m[3] });
      return part;
    });
  }
  return links;
}

/**
 * 改写正文里的链接地址（跳过图片、代码块和行内代码）；`map` 返回新地址，返回 undefined 保留原样。
 * 新地址含空白时用 `<…>` 括起来
 */
export function rewriteLinks(markdown: string, map: (href: string) => string | undefined): string {
  const lines = markdown.split('\n');
  for (const line of scanMarkdown(markdown)) {
    if (line.inFence) continue;
    const i = line.no - 1;
    const cr = lines[i].endsWith('\r') ? '\r' : '';
    const rewritten = outsideCode(line.text, (part) =>
      part.replace(LINK_RE, (all, head: string, angled: string | undefined, bare: string | undefined, tail: string) => {
        const next = map(angled ?? bare!);
        if (next === undefined) return all;
        return `${head}${/\s/.test(next) ? `<${next}>` : next}${tail}`;
      }),
    );
    lines[i] = rewritten + cr;
  }
  return lines.join('\n');
}

/** 一本书的章节文件 → 该章的标题锚点；校验链接目标时使用 */
export type ChapterAnchors = Map<string, Set<string>>;

/**
 * 检查一章里的链接目标是否存在。`self` 是本书的章节锚点；
 * `resolveBook(id)` 返回另一本书的章节锚点，书不存在时返回 null，无从判断（比如单独一本书、旁边没有书库）时返回 undefined 并跳过。
 */
export function lintLinks(
  file: string,
  markdown: string,
  self: { id: string; chapters: ChapterAnchors },
  resolveBook: (id: string) => ChapterAnchors | null | undefined,
  /** 只在书库里传：按路径找书。传了就要求跨书链接按书库的路径写法 */
  resolvePath?: (path: string) => ChapterAnchors | null | undefined,
): string[] {
  const errors: string[] = [];
  const checkTarget = (at: string, href: string, chapters: ChapterAnchors, target: string, anchor?: string) => {
    const anchors = chapters.get(target);
    if (!anchors) errors.push(`${at} 链接的章节不存在：${href}`);
    else if (anchor && !anchors.has(anchor)) errors.push(`${at} 链接的小节不存在：${href}`);
  };
  for (const { line, href } of collectLinks(markdown)) {
    const at = `${file}:${line}`;
    const library: LibraryLink | null = resolvePath ? parseLibraryLink(href) : null;
    if (library) {
      const chapters = resolvePath!(library.path);
      if (chapters === undefined) continue;
      if (!chapters) errors.push(`${at} 链接的书不存在：${href}`);
      else if (library.file) checkTarget(at, href, chapters, library.file, library.anchor);
      continue;
    }
    const link = parseBookLink(href);
    if (resolvePath && link?.kind === 'book') {
      errors.push(`${at} 书库里的跨书链接按路径写，如 <../../分组/书名/章节.md#小节>：${href}`);
      continue;
    }
    if (!link) {
      const hint = resolvePath ? '<../../分组/书名/章节.md#小节>' : '../<book-id>/<章节>.md#小节';
      errors.push(`${at} 无法识别的链接（跨书请写成 ${hint}）：${href}`);
      continue;
    }
    if (link.kind === 'anchor') checkTarget(at, href, self.chapters, file, link.anchor);
    else if (link.kind === 'chapter') checkTarget(at, href, self.chapters, link.file, link.anchor);
    else if (link.kind === 'book') {
      const chapters = link.bookId === self.id ? self.chapters : resolveBook(link.bookId);
      if (chapters === undefined) continue;
      if (!chapters) errors.push(`${at} 链接的书不存在：${href}`);
      else if (link.file) checkTarget(at, href, chapters, link.file, link.anchor);
    }
  }
  return errors;
}
