import { getDb } from '@/db';
import { getSetting, setSetting } from '@/db/queries';
import { bookDir } from '@/lib/paths';
import { SAMPLE_BOOKS } from '@/samples.generated';
import { deleteAudio } from './audio';
import { notifyLibraryChanged } from './events';
import { writeBookAtomically } from './fs';

/** 首次启动时放入示例书；只放一次，用户删掉后不再出现 */
export async function seedSamples() {
  if (await getSetting('samplesSeeded', false)) return;
  for (const book of SAMPLE_BOOKS) {
    if (!bookDir(book.id).exists) writeBookAtomically(book.id, book.files);
  }
  await setSetting('samplesSeeded', true);
}

/** 删除一本书：文件、原声、索引和阅读进度一起删 */
export async function deleteBook(id: string) {
  await deleteBooks([id]);
}

/** 批量删除（书籍管理页）：逐本删文件，数据库在一个事务里清理，最后只通知一次书架刷新 */
export async function deleteBooks(ids: string[]) {
  if (ids.length === 0) return;
  for (const id of ids) {
    const dir = bookDir(id);
    if (dir.exists) dir.delete();
    deleteAudio(id, false);
  }
  const db = getDb();
  await db.withTransactionAsync(async () => {
    for (const id of ids) {
      await db.runAsync('DELETE FROM chapters WHERE book_id = ?', id);
      await db.runAsync('DELETE FROM search WHERE book_id = ?', id);
      await db.runAsync('DELETE FROM books WHERE id = ?', id);
      await db.runAsync('DELETE FROM progress WHERE book_id = ?', id);
      await db.runAsync('DELETE FROM highlights WHERE book_id = ?', id);
    }
  });
  notifyLibraryChanged();
}
