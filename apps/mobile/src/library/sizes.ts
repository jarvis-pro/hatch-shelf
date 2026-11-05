import { getInfoAsync } from 'expo-file-system/legacy';
import { getSetting, setSetting, type BookRow } from '@/db/queries';
import { audioDir, bookDir } from '@/lib/paths';
import { reconcileSizes, type SizeCache } from './size-format';

const KEY = 'bookSizes';

/**
 * 目录（递归）在磁盘上的大小，不存在为 0。
 * 用 legacy 的 getInfoAsync：遍历在原生后台队列里做，不占 JS 线程；
 * 新 API 的 Directory.info().size 是同步调用，书大、录音多时会把整个页面卡住
 */
async function dirBytes(uri: string): Promise<number> {
  const info = await getInfoAsync(uri);
  return info.exists ? info.size : 0;
}

/** 缓存里的大小，进入书籍管理页时先用它们立刻显示：书按内容指纹判断是否有效，原声总是先用缓存再静默刷新 */
export async function cachedSizes(books: BookRow[]) {
  return reconcileSizes(books, await getSetting<SizeCache>(KEY, {}));
}

/**
 * 按 order 的顺序逐本统计：missing 里的书重新统计书的大小，原声每本都重新统计（录音更新不改书的指纹）。
 * 每算完一本回调一次；结束后把全部结果写回缓存（顺带清掉已删除的书）。
 */
export async function measureSizes(
  books: BookRow[],
  order: string[],
  cached: { known: Map<string, number>; audio: Map<string, number>; missing: string[] },
  onSize: (id: string, bytes: number, audio: number) => void,
  signal: { cancelled: boolean },
) {
  const sizes = new Map(cached.known);
  const audio = new Map(cached.audio);
  const missing = new Set(cached.missing);
  for (const id of order) {
    const bytes = missing.has(id) ? await dirBytes(bookDir(id).uri) : sizes.get(id);
    const audioBytes = await dirBytes(audioDir(id).uri);
    if (signal.cancelled) return;
    if (bytes === undefined) continue;
    sizes.set(id, bytes);
    audio.set(id, audioBytes);
    onSize(id, bytes, audioBytes);
  }
  const cache: SizeCache = {};
  for (const b of books) {
    const bytes = sizes.get(b.id);
    if (bytes !== undefined) cache[b.id] = { hash: b.contentHash, bytes, audio: audio.get(b.id) };
  }
  await setSetting(KEY, cache);
}
