/**
 * book.yaml 的 category 用 / 分层（如 `人工智能/Agent`）。书架按第一段分组，原样显示为系列名；
 * 系列名跟着书走，App 不维护映射，新增系列只需推书。
 */
export const UNCATEGORIZED = '未分类';

/** 书所属的系列：category 的第一段；没有分类时为「未分类」 */
export const seriesOf = (category: string | null) => category?.split('/')[0] ?? UNCATEGORIZED;

/** 用于显示的分类名：只显示系列名 */
export const categoryLabel = (category: string | null) => (category ? seriesOf(category) : null);

/**
 * 系列按其中最早导入的那本书排序：先有的系列在前，新系列排在后面；
 * 同时导入时按名称，未分类放最后。导入时间在重建索引时保留，所以顺序稳定。
 */
export function sortSeries<T extends { importedAt: number }>(groups: [string, T[]][]): [string, T[]][] {
  const first = (books: T[]) => Math.min(...books.map((b) => b.importedAt));
  return [...groups].sort(([a, ba], [b, bb]) => {
    if (a === UNCATEGORIZED || b === UNCATEGORIZED) return a === b ? 0 : a === UNCATEGORIZED ? 1 : -1;
    return first(ba) - first(bb) || a.localeCompare(b);
  });
}
