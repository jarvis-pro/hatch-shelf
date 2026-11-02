import { Directory, Paths } from 'expo-file-system';

/** README 第 7 节的本地存储布局，所有路径从这里取 */
export const booksDir = new Directory(Paths.document, 'books');
export const inboxDir = new Directory(Paths.document, 'inbox');
/** 阅读器 HTML 的落地目录；与 books/ 同在 documentDirectory 下，WebView 才能读到书里的图片 */
export const readerDir = new Directory(Paths.document, 'reader');
export const DB_NAME = 'shelf.db';

export function bookDir(id: string) {
  return new Directory(booksDir, id);
}
