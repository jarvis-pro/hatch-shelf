/**
 * book.yaml 的 category 用 / 分层（如 `ai/agent`）。书架按第一段分组，显示为系列名；
 * 这里列出的系列按顺序排在前面，其他的按字母序排在后面，原样显示。
 */
const SERIES: Record<string, string> = {
  ai: '人工智能',
  opc: '一人公司',
  media: '自媒体与短剧',
  tech: '技术',
  ops: '运维',
  guide: '使用指南',
  reference: '速查',
};

const ORDER = Object.keys(SERIES);
export const UNCATEGORIZED = '未分类';

/** 书所属系列的键：category 的第一段；没有分类时为「未分类」 */
export const seriesOf = (category: string | null) => category?.split('/')[0] ?? UNCATEGORIZED;

export const seriesLabel = (key: string) => SERIES[key] ?? key;

/** 用于显示的分类名：只显示系列名 */
export const categoryLabel = (category: string | null) => (category ? seriesLabel(seriesOf(category)) : null);

export function compareSeries(a: string, b: string) {
  const ia = ORDER.indexOf(a);
  const ib = ORDER.indexOf(b);
  if (a === UNCATEGORIZED || b === UNCATEGORIZED) return a === b ? 0 : a === UNCATEGORIZED ? 1 : -1;
  if (ia >= 0 || ib >= 0) return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
  return a.localeCompare(b);
}
