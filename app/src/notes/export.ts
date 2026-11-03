export interface ExportChapter {
  file: string;
  title: string;
}

export interface ExportHighlight {
  chapterFile: string;
  /** 缺省为普通高亮 */
  kind?: 'highlight' | 'doubt';
  text: string;
  anchor?: string;
  note: string | null;
  createdAt: number;
}

const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const quote = (text: string) =>
  text
    .trim()
    .split('\n')
    .map((l) => `> ${l}`.trimEnd())
    .join('\n');

/**
 * 导出为 Markdown：放回仓库的 notes/<id>.notes.md，供 agent 修订这本书时参考（见 books/AGENTS.md）。
 * 每条记录都带章节文件名与小节锚点，方便定位到原文。
 * 存疑单独放在最前面的「存疑」一节（修订时优先核实），其余高亮按章节分组。
 */
export function buildNotesMarkdown(
  book: { id: string; title: string },
  chapters: ExportChapter[],
  highlights: ExportHighlight[],
  exportedAt = Date.now(),
): string {
  const doubts = highlights.filter((h) => h.kind === 'doubt');
  const rest = highlights.filter((h) => h.kind !== 'doubt');
  const lines = [
    '---',
    `book: ${book.id}`,
    `exported: ${date(exportedAt)}`,
    `count: ${highlights.length}`,
    `doubts: ${doubts.length}`,
    '---',
    '',
    `# 《${book.title}》阅读笔记`,
  ];
  const order = new Map(chapters.map((c, i) => [c.file, i]));
  const byChapter = (a: ExportHighlight, b: ExportHighlight) =>
    (order.get(a.chapterFile) ?? Infinity) - (order.get(b.chapterFile) ?? Infinity);
  const entry = (h: ExportHighlight, location: string) => {
    lines.push('', quote(h.text));
    if (h.note) lines.push('', h.note.trim());
    lines.push('', `<sub>${date(h.createdAt)}${location}</sub>`);
  };

  if (doubts.length > 0) {
    lines.push('', '## 存疑', '', '<!-- 读者认为可能有错、需要核实的地方 -->');
    // 稳定排序：同一章内保持原有的创建顺序
    for (const h of [...doubts].sort(byChapter)) {
      const i = order.get(h.chapterFile);
      const chapter = i === undefined ? h.chapterFile : `第 ${i + 1} 章 ${h.chapterFile}`;
      entry(h, ` · ${chapter}${h.anchor ? `#${h.anchor}` : ''}`);
    }
  }

  const files = [...new Set(rest.map((h) => h.chapterFile))].sort(
    (a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity),
  );
  for (const file of files) {
    const i = order.get(file);
    lines.push('', `## ${i === undefined ? file : `${i + 1}. ${chapters[i].title}`}`, '', `<!-- ${file} -->`);
    for (const h of rest.filter((x) => x.chapterFile === file)) entry(h, h.anchor ? ` · #${h.anchor}` : '');
  }
  return `${lines.join('\n')}\n`;
}
