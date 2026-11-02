import { getDb } from '@/db';
import { makeSnippet, type Snippet } from './snippet';

export interface SearchHit {
  bookId: string;
  bookTitle: string;
  chapterFile: string;
  chapterTitle: string;
  /** 小节锚点；章节开头（第一个标题之前）为 null */
  anchor: string | null;
  heading: string | null;
  snippet: Snippet;
}

const LIMIT = 100;

/**
 * 全文搜索。trigram 索引只能匹配 3 个字符及以上，更短的查询（如两个汉字）退回 LIKE 全表扫描，
 * 个人书库的规模下足够快。
 */
export async function searchBooks(raw: string): Promise<SearchHit[]> {
  const q = raw.trim();
  if (!q) return [];
  const select = `SELECT s.book_id, s.chapter_file, s.anchor, s.heading, s.body,
                         b.title AS book_title, c.title AS chapter_title
                  FROM search s
                  JOIN books b ON b.id = s.book_id
                  JOIN chapters c ON c.book_id = s.book_id AND c.file = s.chapter_file`;
  type Row = {
    book_id: string;
    chapter_file: string;
    anchor: string | null;
    heading: string | null;
    body: string;
    book_title: string;
    chapter_title: string;
  };
  const db = getDb();
  const rows =
    [...q].length >= 3
      ? await db.getAllAsync<Row>(
          `${select} WHERE search MATCH ? ORDER BY rank LIMIT ${LIMIT}`,
          // 整体作为一个短语，避免用户输入被当成 FTS 语法
          `"${q.replace(/"/g, '""')}"`,
        )
      : await db.getAllAsync<Row>(
          `${select} WHERE s.body LIKE ? ESCAPE '\\' ORDER BY b.title, c.idx LIMIT ${LIMIT}`,
          `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`,
        );
  return rows.map((r) => ({
    bookId: r.book_id,
    bookTitle: r.book_title,
    chapterFile: r.chapter_file,
    chapterTitle: r.chapter_title,
    anchor: r.anchor,
    heading: r.heading,
    snippet: makeSnippet(r.body, q),
  }));
}
