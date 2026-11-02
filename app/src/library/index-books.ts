import { firstHeading, resolveBook, splitSections } from '@shelf/spec';
import { Directory, File } from 'expo-file-system';
import { getDb } from '@/db';
import { booksDir } from '@/lib/paths';
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
    for (const b of scanned) {
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
        importedAt.get(b.id) ?? Date.now(),
        b.updated,
        b.hash,
        b.id,
      );
      for (const [idx, ch] of b.chapters.entries()) {
        await txn.runAsync(
          'INSERT INTO chapters (book_id, idx, file, title) VALUES (?, ?, ?, ?)',
          b.id,
          idx,
          ch.file,
          ch.title,
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
  });
}
