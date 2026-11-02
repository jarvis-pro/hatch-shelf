import { MAX_PACKAGE_BYTES, prepareImport, staleProgressFiles, type ImportInput } from '@shelf/spec';
import { Directory, File, Paths } from 'expo-file-system';
import { getDb } from '@/db';
import { notifyLibraryChanged } from '@/library/events';
import { writeBookAtomically } from '@/library/fs';
import { rebuildIndex } from '@/library/index-books';
import { bookDir, inboxDir } from '@/lib/paths';

export type ImportResult =
  | { ok: true; status: 'added' | 'updated'; bookId: string; title: string; warnings: string[] }
  | { ok: false; fileName: string; error: string };

const stagingId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * 唯一的导入管线（README 第 6 节）：AirDrop、系统分享、文件选择、局域网上传都调用这里。
 * 来源文件先落到 inbox/<id>/，处理结束后无论成败都清理掉。
 */
export async function importFile(uri: string): Promise<ImportResult> {
  const source = new File(uri);
  const fileName = decodeURIComponent(source.name);
  const fail = (error: string): ImportResult => ({ ok: false, fileName, error });
  const staging = new Directory(inboxDir, stagingId());

  try {
    if (!source.exists) return fail('文件不存在');
    if (source.size > MAX_PACKAGE_BYTES) return fail(`文件超过 ${MAX_PACKAGE_BYTES / 1024 / 1024} MB`);

    staging.create({ intermediates: true });
    const staged = new File(staging, 'package');
    source.copySync(staged);

    const lower = fileName.toLowerCase();
    let input: ImportInput;
    if (lower.endsWith('.zip')) input = { kind: 'zip', fileName, bytes: await staged.bytes() };
    else if (lower.endsWith('.md') || lower.endsWith('.markdown')) input = { kind: 'md', fileName, text: await staged.text() };
    else return fail('只支持 .zip 和 .md 文件');

    const prepared = prepareImport(input);
    if (!prepared.ok) return fail(prepared.error);

    const existed = bookDir(prepared.id).exists;
    writeBookAtomically(prepared.id, prepared.files);
    await cleanStaleProgress(prepared.id, prepared.manifest.chapters);
    await rebuildIndex();
    notifyLibraryChanged();

    return {
      ok: true,
      status: existed ? 'updated' : 'added',
      bookId: prepared.id,
      title: prepared.manifest.title,
      warnings: prepared.warnings,
    };
  } catch (e) {
    return fail((e as Error).message);
  } finally {
    if (staging.exists) staging.delete();
    // iOS 把「用书架打开」的文件拷到 Documents/Inbox/，用完即删；App 外的原文件不动
    if (source.exists && source.uri.startsWith(Paths.document.uri)) source.delete();
  }
}

/** 同 id 更新：只保留仍然存在的章节的阅读进度 */
async function cleanStaleProgress(bookId: string, chapters: string[]) {
  const db = getDb();
  const rows = await db.getAllAsync<{ chapter_file: string }>(
    'SELECT chapter_file FROM progress WHERE book_id = ?',
    bookId,
  );
  for (const file of staleProgressFiles(rows.map((r) => r.chapter_file), chapters)) {
    await db.runAsync('DELETE FROM progress WHERE book_id = ? AND chapter_file = ?', bookId, file);
  }
}
