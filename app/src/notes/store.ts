import { getDb } from '@/db';
import { getBook, getChapters } from '@/db/queries';
import { buildNotesMarkdown } from '@/notes/export';
import type { HighlightKind, HighlightMark, Quote } from '@/reader/bridge';

export interface Highlight extends Quote {
  id: string;
  bookId: string;
  chapterFile: string;
  kind: HighlightKind;
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
  kind: HighlightKind;
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
  kind: r.kind,
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
  kind: h.kind,
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

export interface NotesSummary {
  bookId: string;
  highlights: number;
  notes: number;
  doubts: number;
  lastAt: number;
  /** 最近一条：有笔记显示笔记，否则显示原文 */
  latest: string;
}

/** 笔记 Tab：每本有高亮的书一行，按最近记录时间倒序 */
export async function listNotesSummary(): Promise<NotesSummary[]> {
  const rows = await getDb().getAllAsync<{ book_id: string; n: number; notes: number; doubts: number; last_at: number; latest: string }>(
    `SELECT book_id, COUNT(*) AS n, COUNT(note) AS notes, SUM(kind = 'doubt') AS doubts, MAX(created_at) AS last_at,
       (SELECT COALESCE(h2.note, h2.text) FROM highlights h2 WHERE h2.book_id = h.book_id
        ORDER BY h2.created_at DESC LIMIT 1) AS latest
     FROM highlights h JOIN books b ON b.id = h.book_id
     GROUP BY book_id ORDER BY last_at DESC`,
  );
  return rows.map((r) => ({ bookId: r.book_id, highlights: r.n, notes: r.notes, doubts: r.doubts, lastAt: r.last_at, latest: r.latest.trim() }));
}

export async function addHighlight(bookId: string, chapterFile: string, quote: Quote, note: string | null, kind: HighlightKind = 'highlight') {
  const now = Date.now();
  const id = `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await getDb().runAsync(
    `INSERT INTO highlights (id, book_id, chapter_file, text, prefix, suffix, anchor, kind, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    bookId,
    chapterFile,
    quote.text,
    quote.prefix,
    quote.suffix,
    quote.anchor ?? null,
    kind,
    note,
    now,
    now,
  );
  return id;
}

export async function setNote(id: string, note: string | null) {
  await getDb().runAsync('UPDATE highlights SET note = ?, updated_at = ? WHERE id = ?', note, Date.now(), id);
}

export async function setKind(id: string, kind: HighlightKind) {
  await getDb().runAsync('UPDATE highlights SET kind = ?, updated_at = ? WHERE id = ?', kind, Date.now(), id);
}

export async function deleteHighlight(id: string) {
  await getDb().runAsync('DELETE FROM highlights WHERE id = ?', id);
}

/** 一本书的笔记导出为 Markdown（分享面板和局域网 GET /notes 共用）；没有高亮时返回 null */
export async function bookNotesMarkdown(bookId: string): Promise<{ title: string; count: number; markdown: string } | null> {
  const [book, chapters, items] = await Promise.all([getBook(bookId), getChapters(bookId), listHighlights(bookId)]);
  if (!book || items.length === 0) return null;
  return { title: book.title, count: items.length, markdown: buildNotesMarkdown(book, chapters, items) };
}
