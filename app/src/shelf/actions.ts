import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import { Share } from 'react-native';
import { getBook, getChapters } from '@/db/queries';
import { buildNotesMarkdown } from '@/notes/export';
import { listHighlights } from '@/notes/store';

export const openBook = (id: string, chapter?: string) =>
  router.push({ pathname: '/read/[id]', params: chapter ? { id, chapter } : { id } });

export const openDetail = (id: string) => router.push({ pathname: '/book/[id]', params: { id } });

/** 长按封面：全屏预览 + 快捷操作 */
export const peekBook = (id: string) => router.push({ pathname: '/peek/[id]', params: { id } });

export const openNotes = (id: string) => router.push({ pathname: '/notes/[id]', params: { id } });

/**
 * 导出一本书的高亮与笔记为 Markdown，通过系统分享面板 AirDrop 回电脑，
 * 放到仓库的 notes/ 目录。没有可导出的内容时返回 false。
 */
export async function exportNotes(bookId: string): Promise<boolean> {
  const [book, chapters, items] = await Promise.all([getBook(bookId), getChapters(bookId), listHighlights(bookId)]);
  if (!book || items.length === 0) return false;
  const file = new File(Paths.cache, `${book.id}.notes.md`);
  file.create({ overwrite: true });
  file.writeSync(buildNotesMarkdown(book, chapters, items));
  await Share.share({ url: file.uri, title: `${book.title} 阅读笔记` });
  return true;
}
