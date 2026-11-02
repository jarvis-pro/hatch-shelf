export interface MarkdownLine {
  /** 1 起始的行号 */
  no: number;
  text: string;
  /** 是否在围栏代码块内（含围栏行本身） */
  inFence: boolean;
  /** 本行是代码块的开始围栏时，围栏后的信息串（语言），可能为空字符串 */
  fenceInfo?: string;
}

/**
 * 逐行标注是否位于围栏代码块内。按 CommonMark 规则：关闭围栏的字符与开启相同、长度不短于开启，
 * 所以 ```` 包着 ``` 的写法也能正确识别。
 */
export function scanMarkdown(markdown: string): MarkdownLine[] {
  let open: { char: string; len: number } | null = null;
  return markdown.split(/\r?\n/).map((text, i) => {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
    if (!open) {
      if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
        open = { char: m[1][0], len: m[1].length };
        return { no: i + 1, text, inFence: true, fenceInfo: m[2].trim() };
      }
      return { no: i + 1, text, inFence: false };
    }
    if (m && m[1][0] === open.char && m[1].length >= open.len && m[2].trim() === '') open = null;
    return { no: i + 1, text, inFence: true };
  });
}

/** 第一个 H1（跳过代码块）；用于章标题和单个 .md 的书名 */
export function firstHeading(markdown: string): string | null {
  for (const line of scanMarkdown(markdown)) {
    if (line.inFence) continue;
    const m = /^#\s+(.+?)\s*#*\s*$/.exec(line.text);
    if (m) return m[1];
  }
  return null;
}

/**
 * 标题的纯文本：去掉行内标记，尽量与 markdown-it 渲染后标题里的文字一致
 * （链接留文字、图片和公式去掉、强调与代码标记去掉）。
 */
export function headingText(raw: string): string {
  return raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\$[^$]+\$/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__|~~|\*|_|`)/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!$])/g, '$1')
    .trim();
}

/** 标题锚点：阅读器（给标题加 id）与搜索索引（定位小节）共用，保证一致 */
export function headingSlug(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}_-]/gu, '') || 'section'
  );
}

/** 同一章内重复的标题依次加 -1、-2 后缀；需要按文档顺序对所有级别的标题调用 */
export function createSlugger() {
  const used = new Map<string, number>();
  return (text: string) => {
    const base = headingSlug(text);
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

export interface Section {
  /** 小节标题的锚点；标题之前的内容为 null */
  anchor: string | null;
  heading: string | null;
  level: number;
  /** 小节正文（含标题行），保留代码，去掉围栏标记 */
  body: string;
}

/** 按 H1–H3 切成小节，供全文搜索建索引；H4 及以下并入所在小节 */
export function splitSections(markdown: string): Section[] {
  const slug = createSlugger();
  const sections: Section[] = [];
  let cur: Section = { anchor: null, heading: null, level: 0, body: '' };
  for (const line of scanMarkdown(markdown)) {
    if (line.inFence) {
      if (line.fenceInfo === undefined && !/^ {0,3}(`{3,}|~{3,})\s*$/.test(line.text)) cur.body += `${line.text}\n`;
      continue;
    }
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.text);
    if (m) {
      const text = headingText(m[2]);
      const anchor = slug(text);
      if (m[1].length <= 3) {
        if (cur.body.trim()) sections.push(cur);
        cur = { anchor, heading: text, level: m[1].length, body: '' };
      }
      cur.body += `${text}\n`;
      continue;
    }
    cur.body += `${line.text}\n`;
  }
  if (cur.body.trim()) sections.push(cur);
  return sections;
}
