import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import { Share } from 'react-native';
import { bookNotesMarkdown } from '@/notes/store';

export const openBook = (id: string, chapter?: string, anchor?: string) =>
  router.push({ pathname: '/read/[id]', params: { id, ...(chapter && { chapter }), ...(chapter && anchor && { anchor }) } });

export const openDetail = (id: string) => router.push({ pathname: '/book/[id]', params: { id } });

/** 长按封面：全屏预览 + 快捷操作 */
export const peekBook = (id: string) => router.push({ pathname: '/peek/[id]', params: { id } });

export const openNotes = (id: string) => router.push({ pathname: '/notes/[id]', params: { id } });

/**
 * 导出一本书的高亮与笔记为 Markdown，通过系统分享面板 AirDrop 回电脑，
 * 放到仓库的 notes/ 目录。没有可导出的内容时返回 false。
 */
export async function exportNotes(bookId: string): Promise<boolean> {
  const notes = await bookNotesMarkdown(bookId);
  if (!notes) return false;
  const file = new File(Paths.cache, `${bookId}.notes.md`);
  file.create({ overwrite: true });
  file.writeSync(notes.markdown);
  await Share.share({ url: file.uri, title: `${notes.title} 阅读笔记` });
  return true;
}
