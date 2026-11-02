import { getDb } from '@/db';
import type { HighlightMark, Quote } from '@/reader/bridge';

export interface Highlight extends Quote {
  id: string;
  bookId: string;
  chapterFile: string;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

type Row = {
  id: string;
  book_id: string;
  chapter_file: string;
  text: string;
  prefix: string;
  suffix: string;
  anchor: string | null;
  note: string | null;
  created_at: number;
  updated_at: number;
};

const toHighlight = (r: Row): Highlight => ({
  id: r.id,
  bookId: r.book_id,
  chapterFile: r.chapter_file,
  text: r.text,
  prefix: r.prefix,
  suffix: r.suffix,
  anchor: r.anchor ?? undefined,
  note: r.note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const toMark = (h: Highlight): HighlightMark => ({
  id: h.id,
  text: h.text,
  prefix: h.prefix,
  suffix: h.suffix,
  anchor: h.anchor,
  hasNote: !!h.note,
});

/** 一本书（或其中一章）的全部高亮，按章节顺序、章内创建顺序排列 */
export async function listHighlights(bookId: string, chapterFile?: string): Promise<Highlight[]> {
  const rows = await getDb().getAllAsync<Row>(
    `SELECT h.* FROM highlights h
     LEFT JOIN chapters c ON c.book_id = h.book_id AND c.file = h.chapter_file
     WHERE h.book_id = ? ${chapterFile ? 'AND h.chapter_file = ?' : ''}
     ORDER BY c.idx IS NULL, c.idx, h.created_at`,
    ...(chapterFile ? [bookId, chapterFile] : [bookId]),
  );
  return rows.map(toHighlight);
}

export async function countHighlights(bookId: string): Promise<number> {
  const row = await getDb().getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM highlights WHERE book_id = ?', bookId);
  return row?.n ?? 0;
}

export async function addHighlight(bookId: string, chapterFile: string, quote: Quote, note: string | null) {
  const now = Date.now();
  const id = `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await getDb().runAsync(
    `INSERT INTO highlights (id, book_id, chapter_file, text, prefix, suffix, anchor, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    bookId,
    chapterFile,
    quote.text,
    quote.prefix,
    quote.suffix,
    quote.anchor ?? null,
    note,
    now,
    now,
  );
  return id;
}

export async function setNote(id: string, note: string | null) {
  await getDb().runAsync('UPDATE highlights SET note = ?, updated_at = ? WHERE id = ?', note, Date.now(), id);
}

export async function deleteHighlight(id: string) {
  await getDb().runAsync('DELETE FROM highlights WHERE id = ?', id);
}
