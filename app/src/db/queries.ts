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

export function getChapters(bookId: string): Promise<ChapterRow[]> {
  return getDb().getAllAsync<ChapterRow>(
    'SELECT idx, file, title FROM chapters WHERE book_id = ? ORDER BY idx',
    bookId,
  );
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
    `INSERT INTO progress (book_id, chapter_file, scroll_ratio, anchor, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (book_id, chapter_file) DO UPDATE SET
       scroll_ratio = excluded.scroll_ratio, anchor = excluded.anchor, updated_at = excluded.updated_at`,
    bookId,
    chapterFile,
    pos.scrollRatio,
    pos.anchor ?? null,
    now,
  );
  await db.runAsync('UPDATE books SET last_read_at = ? WHERE id = ?', now, bookId);
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
