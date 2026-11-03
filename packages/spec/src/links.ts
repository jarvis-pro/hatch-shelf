import { createSlugger, headingText, scanMarkdown } from './markdown';

/**
 * 书里的链接指向哪里。阅读器据此跳转，shelf-pack check 据此校验目标是否存在。
 *
 * - `#anchor`：本章小节
 * - `02-x.md#anchor`：本书另一章
 * - `../other-id/`、`../other-id/03-x.md#anchor`：另一本书（打开到上次读到的位置，或指定章节、小节）
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
  m = /^(?:\.\/)?([a-z0-9-]+\.md)(?:#(.+))?$/.exec(href);
  if (m) return { kind: 'chapter', file: m[1], anchor: decode(m[2]) };
  m = /^\.\.\/([a-z0-9-]+)(?:\/(?:([a-z0-9-]+\.md)(?:#(.+))?)?)?$/.exec(href);
  if (m) return { kind: 'book', bookId: m[1], file: m[2], anchor: decode(m[3]) };
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

/** 正文里的链接（不含图片、代码块和行内代码里的示例） */
export function collectLinks(markdown: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  for (const line of scanMarkdown(markdown)) {
    if (line.inFence) continue;
    const text = line.text.replace(/(`+)[\s\S]*?\1/g, '');
    for (const m of text.matchAll(/(?<!!)\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      links.push({ line: line.no, href: m[1] });
    }
  }
  return links;
}

/** 一本书的章节文件 → 该章的标题锚点；校验链接目标时使用 */
export type ChapterAnchors = Map<string, Set<string>>;

/**
 * 检查一章里的链接目标是否存在。`self` 是本书的章节锚点；
 * `resolveBook(id)` 返回另一本书的章节锚点，书不存在时返回 null。
 */
export function lintLinks(
  file: string,
  markdown: string,
  self: { id: string; chapters: ChapterAnchors },
  resolveBook: (id: string) => ChapterAnchors | null,
): string[] {
  const errors: string[] = [];
  const checkTarget = (at: string, href: string, chapters: ChapterAnchors, target: string, anchor?: string) => {
    const anchors = chapters.get(target);
    if (!anchors) errors.push(`${at} 链接的章节不存在：${href}`);
    else if (anchor && !anchors.has(anchor)) errors.push(`${at} 链接的小节不存在：${href}`);
  };
  for (const { line, href } of collectLinks(markdown)) {
    const at = `${file}:${line}`;
    const link = parseBookLink(href);
    if (!link) {
      errors.push(`${at} 无法识别的链接（跨书请写成 ../<book-id>/<章节>.md#小节）：${href}`);
      continue;
    }
    if (link.kind === 'anchor') checkTarget(at, href, self.chapters, file, link.anchor);
    else if (link.kind === 'chapter') checkTarget(at, href, self.chapters, link.file, link.anchor);
    else if (link.kind === 'book') {
      const chapters = link.bookId === self.id ? self.chapters : resolveBook(link.bookId);
      if (!chapters) errors.push(`${at} 链接的书不存在：${href}`);
      else if (link.file) checkTarget(at, href, chapters, link.file, link.anchor);
    }
  }
  return errors;
}
