import { contentHash, firstHeading, resolveBook, splitSections } from '@shelf/spec';
import { Directory, File } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb } from '@/db';
import { bookDir, booksDir } from '@/lib/paths';
import { HASH_FILE } from './fs';

interface ScannedBook {
  id: string;
  title: string;
  subtitle: string | null;
  category: string | null;
  tags: string[];
  level: string | null;
  updated: string | null;
  warnings: string[];
  hash: string | null;
  chapters: { file: string; title: string; markdown: string }[];
}

function scanBook(dir: Directory): ScannedBook | null {
  const files = dir.list().filter((e): e is File => e instanceof File);
  const yamlFile = files.find((f) => f.name === 'book.yaml');
  const hashFile = files.find((f) => f.name === HASH_FILE);
  const result = resolveBook({
    dirName: dir.name,
    yamlText: yamlFile?.textSync(),
    mdFiles: files.filter((f) => f.name.endsWith('.md')).map((f) => f.name),
  });
  if (!result.ok) {
    console.warn(`[index] 跳过 ${dir.name}：${result.errors.join('; ')}`);
    return null;
  }
  const { manifest, chapters, warnings } = result;
  // 目录名才是书在设备上的 id；导入管线保证两者一致，这里只做提示
  if (manifest.id !== dir.name) warnings.push(`book.yaml 中的 id（${manifest.id}）与目录名不一致`);
  return {
    id: dir.name,
    title: manifest.title,
    subtitle: manifest.subtitle ?? null,
    category: manifest.category ?? null,
    tags: manifest.tags ?? [],
    level: manifest.level ?? null,
    updated: manifest.updated ?? null,
    warnings,
    hash: hashFile?.textSync().trim() || null,
    chapters: chapters.map((file) => {
      const markdown = new File(dir, file).textSync();
      return { file, markdown, title: firstHeading(markdown) ?? file.replace(/\.md$/, '') };
    }),
  };
}

/**
 * 扫描 books/ 重建 books、chapters 与全文搜索索引（README 第 2 节原则 3）。
 * progress / settings 不动；last_read_at 从 progress 回填。
 */
export async function rebuildIndex() {
  if (!booksDir.exists) booksDir.create({ intermediates: true });
  const scanned = booksDir
    .list()
    .filter((e): e is Directory => e instanceof Directory && !e.name.startsWith('.'))
    .map(scanBook)
    .filter((b): b is ScannedBook => b !== null);

  const db = getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    const prev = await txn.getAllAsync<{ id: string; imported_at: number }>('SELECT id, imported_at FROM books');
    const importedAt = new Map(prev.map((r) => [r.id, r.imported_at]));
    await txn.execAsync('DELETE FROM chapters; DELETE FROM books; DELETE FROM search;');
    for (const b of scanned) await insertBook(txn, b, importedAt.get(b.id) ?? Date.now());
    // 还没记下「读时指纹」的进度（升级前的旧进度、从备份恢复的进度）按当前内容补上，
    // 之后书再更新才标得出「已更新」。只在全量重建时补：导入时补会把刚改过的章节当成读过
    await txn.execAsync(
      `UPDATE progress SET seen_hash = (
         SELECT hash FROM chapters c WHERE c.book_id = progress.book_id AND c.file = progress.chapter_file)
       WHERE seen_hash IS NULL`,
    );
  });
}

/**
 * 冷启动后在后台做的轻量对账：只比对书目录的增删和 .content-hash，有出入的书单独重建。
 * 不读章节正文，书多了也不拖慢启动；书内文件被外部改动（没有更新指纹）要到设置页「重建索引」。
 * 返回是否有书的索引被改动。
 */
export async function syncIndex(): Promise<boolean> {
  if (!booksDir.exists) return false;
  const dirs = booksDir.list().filter((e): e is Directory => e instanceof Directory && !e.name.startsWith('.'));
  const rows = await getDb().getAllAsync<{ id: string; content_hash: string | null }>('SELECT id, content_hash FROM books');
  const indexed = new Map(rows.map((r) => [r.id, r.content_hash]));
  const stale: string[] = [];
  for (const dir of dirs) {
    const hashFile = new File(dir, HASH_FILE);
    const hash = hashFile.exists ? hashFile.textSync().trim() || null : null;
    if (!indexed.has(dir.name) || indexed.get(dir.name) !== hash) stale.push(dir.name);
    indexed.delete(dir.name);
  }
  // 剩下的是目录已经不在的书
  stale.push(...indexed.keys());
  for (const id of stale) await reindexBook(id);
  return stale.length > 0;
}

/**
 * 只重建一本书的索引，供导入管线使用：全量重建要读遍整个书库，批量推送时每本都会越来越慢。
 * 书目录不存在或解析失败时删掉这本书的索引。
 */
export async function reindexBook(id: string) {
  const dir = bookDir(id);
  const scanned = dir.exists ? scanBook(dir) : null;
  const db = getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    const prev = await txn.getFirstAsync<{ imported_at: number }>('SELECT imported_at FROM books WHERE id = ?', id);
    await txn.runAsync('DELETE FROM chapters WHERE book_id = ?', id);
    await txn.runAsync('DELETE FROM search WHERE book_id = ?', id);
    await txn.runAsync('DELETE FROM books WHERE id = ?', id);
    if (scanned) await insertBook(txn, scanned, prev?.imported_at ?? Date.now());
  });
}

async function insertBook(txn: SQLiteDatabase, b: ScannedBook, importedAt: number) {
  await txn.runAsync(
    `INSERT INTO books (id, title, subtitle, category, tags, level, chapter_count, warnings,
                        imported_at, updated_at, content_hash, last_read_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             (SELECT MAX(updated_at) FROM progress WHERE book_id = ?))`,
    b.id,
    b.title,
    b.subtitle,
    b.category,
    JSON.stringify(b.tags),
    b.level,
    b.chapters.length,
    JSON.stringify(b.warnings),
    importedAt,
    b.updated,
    b.hash,
    b.id,
  );
  for (const [idx, ch] of b.chapters.entries()) {
    await txn.runAsync(
      'INSERT INTO chapters (book_id, idx, file, title, hash) VALUES (?, ?, ?, ?, ?)',
      b.id,
      idx,
      ch.file,
      ch.title,
      contentHash([{ path: ch.file, text: ch.markdown }]),
    );
    for (const sec of splitSections(ch.markdown)) {
      await txn.runAsync(
        'INSERT INTO search (book_id, chapter_file, anchor, heading, body) VALUES (?, ?, ?, ?, ?)',
        b.id,
        ch.file,
        sec.anchor,
        sec.heading,
        sec.body,
      );
    }
  }
}
