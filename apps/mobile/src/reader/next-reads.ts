import { parseBookYaml } from '@shelf/spec';
import { File } from 'expo-file-system';
import { getBook, listBookProgress } from '@/db/queries';
import { bookDir } from '@/lib/paths';
import { coverColor } from '@/shelf/colors';
import type { NextRead } from './bridge';

/**
 * 最后一章末尾「接着读」的书：取自本书 book.yaml 的 next（推荐写在内容里，App 不维护）。
 * 已经读完的书不再推荐；书架上没有的书保留，由阅读器提示先导入
 */
export async function loadNextReads(bookId: string): Promise<NextRead[]> {
  const yaml = new File(bookDir(bookId), 'book.yaml');
  if (!yaml.exists) return [];
  const parsed = parseBookYaml(await yaml.text());
  // 书库里的 next 写的是路径（book:），打包推送时已换成 id；没有 id 的项（直接拷进来的书库原稿）跳过
  const next = (parsed.ok ? (parsed.manifest.next ?? []) : []).flatMap(({ id, reason }) => (id ? [{ id, reason }] : []));
  if (next.length === 0) return [];
  const progress = await listBookProgress();
  const reads = await Promise.all(
    next.map(async ({ id, reason }): Promise<NextRead | null> => {
      if (progress.get(id)?.finished) return null;
      const book = await getBook(id);
      const cover = new File(bookDir(id), 'cover.png');
      return {
        id,
        title: book?.title ?? null,
        reason: reason ?? book?.subtitle ?? null,
        coverUrl: book && cover.exists ? cover.uri : null,
        color: coverColor(book?.category ?? null, id),
      };
    }),
  );
  return reads.filter((r) => r !== null);
}
