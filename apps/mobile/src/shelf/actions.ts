import * as Haptics from 'expo-haptics';
import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import { useRef } from 'react';
import { Share, type HostInstance } from 'react-native';
import type { BookRow } from '@/db/queries';
import { bookNotesMarkdown } from '@/notes/store';
import { liftToDetail } from '@/ui/CoverFlight';

export const openBook = (id: string, chapter?: string, anchor?: string) =>
  router.push({ pathname: '/read/[id]', params: { id, ...(chapter && { chapter }), ...(chapter && anchor && { anchor }) } });

export const openDetail = (id: string) => router.push({ pathname: '/book/[id]', params: { id } });

export const openNotes = (id: string) => router.push({ pathname: '/notes/[id]', params: { id } });

/**
 * 书架上的一本书：点按直接进阅读页；长按 300ms 后中等触感、封面抬起并飞进详情页
 * （设计稿「长按 · 进详情过场」）。返回的 cover 交给 BookCover 的 ref，用来测量封面位置
 */
export function useBookPress(book: BookRow) {
  const cover = useRef<HostInstance>(null);
  const press = {
    scale: 0.96,
    longPressHaptic: Haptics.ImpactFeedbackStyle.Medium,
    onPress: () => openBook(book.id),
    onLongPress: () => liftToDetail(book, cover.current, () => openDetail(book.id)),
  };
  return { cover, press };
}

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
