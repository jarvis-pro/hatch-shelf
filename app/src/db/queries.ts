import type { BookLevel } from '@shelf/spec';
import type { ReaderPosition } from '@/reader/bridge';
import { getDb } from './index';

export interface BookRow {
  id: string;
  title: string;
  subtitle: string | null;
  category: string | null;
  tags: string[];
  level: BookLevel | null;
  chapterCount: number;
  warnings: string[];
  importedAt: number;
  updatedAt: string | null;
  lastReadAt: number | null;
  contentHash: string | null;
}

export interface ChapterRow {
  idx: number;
  file: string;
  title: string;
  /** 读过这一章之后，书更新改动了它的内容 */
  updated: boolean;
}

type RawBook = {
  id: string;
  title: string;
  subtitle: string | null;
  category: string | null;
  tags: string;
  level: BookLevel | null;
  chapter_count: number;
  warnings: string;
  imported_at: number;
  updated_at: string | null;
  last_read_at: number | null;
  content_hash: string | null;
};

const toBook = (r: RawBook): BookRow => ({
  id: r.id,
  title: r.title,
  subtitle: r.subtitle,
  category: r.category,
  tags: JSON.parse(r.tags),
  level: r.level,
  chapterCount: r.chapter_count,
  warnings: JSON.parse(r.warnings),
  importedAt: r.imported_at,
  updatedAt: r.updated_at,
  lastReadAt: r.last_read_at,
  contentHash: r.content_hash,
});

export async function listBooks(): Promise<BookRow[]> {
  const rows = await getDb().getAllAsync<RawBook>(
    'SELECT * FROM books ORDER BY category IS NULL, category, title',
  );
  return rows.map(toBook);
}

export async function getBook(id: string): Promise<BookRow | null> {
  const row = await getDb().getFirstAsync<RawBook>('SELECT * FROM books WHERE id = ?', id);
  return row ? toBook(row) : null;
}

export async function getChapters(bookId: string): Promise<ChapterRow[]> {
  const rows = await getDb().getAllAsync<Omit<ChapterRow, 'updated'> & { updated: number }>(
    `SELECT c.idx, c.file, c.title, COALESCE(p.seen_hash != c.hash, 0) AS updated
     FROM chapters c LEFT JOIN progress p ON p.book_id = c.book_id AND p.chapter_file = c.file
     WHERE c.book_id = ? ORDER BY c.idx`,
    bookId,
  );
  return rows.map((r) => ({ ...r, updated: r.updated === 1 }));
}

// ---------- 阅读进度 ----------

export async function getProgress(bookId: string, chapterFile: string): Promise<ReaderPosition | undefined> {
  const row = await getDb().getFirstAsync<{ scroll_ratio: number; anchor: string | null }>(
    'SELECT scroll_ratio, anchor FROM progress WHERE book_id = ? AND chapter_file = ?',
    bookId,
    chapterFile,
  );
  return row ? { scrollRatio: row.scroll_ratio, anchor: row.anchor ?? undefined } : undefined;
}

/** 最近读过的章节文件；没有记录时返回 null */
export async function getLastChapter(bookId: string): Promise<string | null> {
  const row = await getDb().getFirstAsync<{ chapter_file: string }>(
    'SELECT chapter_file FROM progress WHERE book_id = ? ORDER BY updated_at DESC LIMIT 1',
    bookId,
  );
  return row?.chapter_file ?? null;
}

export async function saveProgress(bookId: string, chapterFile: string, pos: ReaderPosition) {
  const now = Date.now();
  const db = getDb();
  await db.runAsync(
    `INSERT INTO progress (book_id, chapter_file, scroll_ratio, anchor, updated_at, seen_hash)
     VALUES (?, ?, ?, ?, ?, (SELECT hash FROM chapters WHERE book_id = ? AND file = ?))
     ON CONFLICT (book_id, chapter_file) DO UPDATE SET
       scroll_ratio = excluded.scroll_ratio, anchor = excluded.anchor, updated_at = excluded.updated_at,
       seen_hash = excluded.seen_hash`,
    bookId,
    chapterFile,
    pos.scrollRatio,
    pos.anchor ?? null,
    now,
    bookId,
    chapterFile,
  );
  await db.runAsync('UPDATE books SET last_read_at = ? WHERE id = ?', now, bookId);
}

export interface BookProgress {
  /** 最近读的章节 */
  chapterFile: string;
  chapterIdx: number;
  /** 0–1，按「已读章节数 + 当前章节滚动比例」估算 */
  ratio: number;
  /** 视为读完：读到最后一章末尾 */
  finished: boolean;
}

const FINISHED_RATIO = 0.95;

/** 每本书最近一次阅读的位置，用于书架上的进度徽标和进度条 */
export async function listBookProgress(): Promise<Map<string, BookProgress>> {
  const rows = await getDb().getAllAsync<{ book_id: string; chapter_file: string; scroll_ratio: number; idx: number; chapter_count: number }>(
    `SELECT p.book_id, p.chapter_file, p.scroll_ratio, c.idx, b.chapter_count
     FROM progress p
     JOIN chapters c ON c.book_id = p.book_id AND c.file = p.chapter_file
     JOIN books b ON b.id = p.book_id
     WHERE p.updated_at = (SELECT MAX(updated_at) FROM progress p2 WHERE p2.book_id = p.book_id)`,
  );
  return new Map(
    rows.map((r) => {
      const finished = r.idx === r.chapter_count - 1 && r.scroll_ratio >= FINISHED_RATIO;
      const ratio = finished ? 1 : Math.min(1, (r.idx + r.scroll_ratio) / Math.max(1, r.chapter_count));
      return [r.book_id, { chapterFile: r.chapter_file, chapterIdx: r.idx, ratio, finished }];
    }),
  );
}

/** 一本书里视为读过的章节：在当前章节之前，或者滚动到了末尾 */
export async function getReadChapters(bookId: string, currentIdx: number): Promise<Set<string>> {
  const rows = await getDb().getAllAsync<{ file: string; idx: number; scroll_ratio: number | null }>(
    `SELECT c.file, c.idx, p.scroll_ratio FROM chapters c
     LEFT JOIN progress p ON p.book_id = c.book_id AND p.chapter_file = c.file
     WHERE c.book_id = ?`,
    bookId,
  );
  return new Set(rows.filter((r) => r.idx < currentIdx || (r.scroll_ratio ?? 0) >= FINISHED_RATIO).map((r) => r.file));
}

// ---------- 设置 ----------

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await getDb().getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row ? (JSON.parse(row.value) as T) : fallback;
}

export async function setSetting(key: string, value: unknown) {
  await getDb().runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value),
  );
}
