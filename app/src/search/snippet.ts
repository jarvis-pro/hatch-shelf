export interface Snippet {
  before: string;
  match: string;
  after: string;
}

/**
 * 从小节正文里截出关键词附近的一段，用于搜索结果展示。
 * 大小写不敏感；找不到时（理论上不会）返回开头一段。
 */
export function makeSnippet(body: string, query: string, radius = 28): Snippet {
  const text = body.replace(/\s+/g, ' ').trim();
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return { before: '', match: '', after: text.slice(0, radius * 3) };
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + query.length + radius * 2);
  return {
    before: (start > 0 ? '…' : '') + text.slice(start, i),
    match: text.slice(i, i + query.length),
    after: text.slice(i + query.length, end) + (end < text.length ? '…' : ''),
  };
}
