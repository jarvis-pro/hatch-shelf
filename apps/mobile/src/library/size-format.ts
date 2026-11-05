/** 书籍管理页显示的大小：不足 1 MB 用 KB（整数），否则 MB 保留一位小数 */
export function formatBytes(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1000) return `${Math.max(1, Math.round(kb))} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** 圆环中心的大数字：拆成数值和单位，分开排版 */
export function splitBytes(bytes: number): { value: string; unit: string } {
  const [value, unit] = formatBytes(bytes).split(' ');
  return { value, unit };
}

export interface SizeCacheEntry {
  /** 统计时这本书的内容指纹；指纹变了说明书更新过，需要重新统计 */
  hash: string | null;
  bytes: number;
  /** 原声录音的大小（0 为没有原声）；录音不影响书的指纹，只作首屏显示，进入页面后总会重新统计 */
  audio?: number;
}

export type SizeCache = Record<string, SizeCacheEntry>;

/**
 * 对照缓存：指纹一致的直接取用，其余（新书、更新过的书）需要重新统计。
 * 原声大小与指纹无关，缓存里有就先用（known 之外的书不用）。
 * 已删除的书不在 books 里，返回的 cache 里也不再保留。
 */
export function reconcileSizes(books: { id: string; contentHash: string | null }[], cache: SizeCache) {
  const known = new Map<string, number>();
  const audio = new Map<string, number>();
  const missing: string[] = [];
  for (const b of books) {
    const hit = cache[b.id];
    if (hit && hit.hash === b.contentHash && hit.audio !== undefined) {
      known.set(b.id, hit.bytes);
      audio.set(b.id, hit.audio);
    } else missing.push(b.id);
  }
  return { known, audio, missing };
}
