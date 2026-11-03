import { Paths } from 'expo-file-system';
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import { DB_NAME } from '@/lib/paths';

/**
 * 按顺序执行的迁移；user_version 记录已执行到第几条。只能追加，不能修改已发布的条目。
 * books / chapters 是可重建的索引；progress / settings 是用户数据，不可丢。
 */
const MIGRATIONS = [
  `
  CREATE TABLE books (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT,
    category TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    level TEXT,
    chapter_count INTEGER NOT NULL,
    warnings TEXT NOT NULL DEFAULT '[]',
    imported_at INTEGER NOT NULL,
    updated_at TEXT,
    last_read_at INTEGER
  );
  CREATE TABLE chapters (
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    file TEXT NOT NULL,
    title TEXT NOT NULL,
    PRIMARY KEY (book_id, idx)
  );
  CREATE TABLE progress (
    book_id TEXT NOT NULL,
    chapter_file TEXT NOT NULL,
    scroll_ratio REAL NOT NULL DEFAULT 0,
    anchor TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (book_id, chapter_file)
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  `,
  // 内容指纹，供 shelf-pack push --changed 判断是否需要推送；来自书目录下的 .content-hash
  `ALTER TABLE books ADD COLUMN content_hash TEXT;`,
  // 全文搜索：每行一个小节（按 H1–H3 切分），可随 books / chapters 一起重建。
  // trigram 分词不依赖词典，中英文都能做子串匹配（查询至少 3 个字符，更短的走 LIKE）
  `CREATE VIRTUAL TABLE search USING fts5(
    book_id UNINDEXED, chapter_file UNINDEXED, anchor UNINDEXED, heading UNINDEXED, body,
    tokenize = 'trigram'
  );`,
  // 高亮与笔记：用户数据，不可重建。用原文 + 前后文定位，书更新后仍能找回位置
  `CREATE TABLE highlights (
    id TEXT PRIMARY KEY NOT NULL,
    book_id TEXT NOT NULL,
    chapter_file TEXT NOT NULL,
    text TEXT NOT NULL,
    prefix TEXT NOT NULL,
    suffix TEXT NOT NULL,
    anchor TEXT,
    note TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX highlights_by_chapter ON highlights (book_id, chapter_file);`,
  // 高亮类型：highlight 普通高亮；doubt 存疑（读者觉得这里可能有错，导出时排在最前，供修订时优先核实）
  `ALTER TABLE highlights ADD COLUMN kind TEXT NOT NULL DEFAULT 'highlight';`,
];

let db: SQLiteDatabase | null = null;

export function getDb(): SQLiteDatabase {
  if (db) return db;
  db = openDatabaseSync(DB_NAME, undefined, Paths.document.uri);
  db.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const { user_version } = db.getFirstSync<{ user_version: number }>('PRAGMA user_version')!;
  for (let v = user_version; v < MIGRATIONS.length; v++) {
    db.withTransactionSync(() => {
      db!.execSync(MIGRATIONS[v]);
      db!.execSync(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return db;
}
