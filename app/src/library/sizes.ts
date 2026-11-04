import { getSetting, setSetting, type BookRow } from '@/db/queries';
import { bookDir } from '@/lib/paths';
import { reconcileSizes, type SizeCache } from './size-format';

const KEY = 'bookSizes';

/** 一本书在磁盘上的大小（books/<id>/ 下全部文件，递归） */
function measure(id: string): number {
  const dir = bookDir(id);
  return dir.exists ? (dir.info().size ?? 0) : 0;
}

/** 缓存里仍然有效的大小，进入书籍管理页时先用它们立刻显示 */
export async function cachedSizes(books: BookRow[]) {
  return reconcileSizes(books, await getSetting<SizeCache>(KEY, {}));
}

/**
 * 统计 ids 里每本书的大小，每算完一本回调一次。原生统计是同步调用，
 * 每本之间让出一次事件循环，页面动画和点按不会被卡住。结束后把全部结果写回缓存（顺带清掉已删除的书）。
 */
export async function measureSizes(books: BookRow[], ids: string[], known: Map<string, number>, onSize: (id: string, bytes: number) => void, signal: { cancelled: boolean }) {
  const sizes = new Map(known);
  for (const id of ids) {
    await new Promise((r) => setTimeout(r, 0));
    if (signal.cancelled) return;
    const bytes = measure(id);
    sizes.set(id, bytes);
    onSize(id, bytes);
  }
  const cache: SizeCache = {};
  for (const b of books) {
    const bytes = sizes.get(b.id);
    if (bytes !== undefined) cache[b.id] = { hash: b.contentHash, bytes };
  }
  await setSetting(KEY, cache);
}
