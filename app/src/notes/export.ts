export interface ExportChapter {
  file: string;
  title: string;
}

export interface ExportHighlight {
  chapterFile: string;
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
 */
export function buildNotesMarkdown(
  book: { id: string; title: string },
  chapters: ExportChapter[],
  highlights: ExportHighlight[],
  exportedAt = Date.now(),
): string {
  const lines = [
    '---',
    `book: ${book.id}`,
    `exported: ${date(exportedAt)}`,
    `count: ${highlights.length}`,
    '---',
    '',
    `# 《${book.title}》阅读笔记`,
  ];
  const order = new Map(chapters.map((c, i) => [c.file, i]));
  const files = [...new Set(highlights.map((h) => h.chapterFile))].sort(
    (a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity),
  );
  for (const file of files) {
    const i = order.get(file);
    lines.push('', `## ${i === undefined ? file : `${i + 1}. ${chapters[i].title}`}`, '', `<!-- ${file} -->`);
    for (const h of highlights.filter((x) => x.chapterFile === file)) {
      lines.push('', quote(h.text));
      if (h.note) lines.push('', h.note.trim());
      lines.push('', `<sub>${date(h.createdAt)}${h.anchor ? ` · #${h.anchor}` : ''}</sub>`);
    }
  }
  return `${lines.join('\n')}\n`;
}
