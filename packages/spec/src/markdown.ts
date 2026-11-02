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
