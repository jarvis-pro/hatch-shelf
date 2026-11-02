import { Directory, Paths } from 'expo-file-system';

/** README 第 7 节的本地存储布局，所有路径从这里取 */
export const booksDir = new Directory(Paths.document, 'books');
export const inboxDir = new Directory(Paths.document, 'inbox');
export const DB_NAME = 'shelf.db';
