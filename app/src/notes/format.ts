const DAY = 24 * 60 * 60 * 1000;

/** 「今天」「昨天」「10 月 28 日」，跨年时带上年份 */
export function formatDay(ms: number, now = Date.now()) {
  const d = new Date(ms);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (ms >= start.getTime()) return '今天';
  if (ms >= start.getTime() - DAY) return '昨天';
  const md = `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  return d.getFullYear() === start.getFullYear() ? md : `${d.getFullYear()} 年 ${md}`;
}

export const countLabel = (highlights: number, notes: number) =>
  notes > 0 ? `${highlights} 条高亮 · ${notes} 条笔记` : `${highlights} 条高亮`;
