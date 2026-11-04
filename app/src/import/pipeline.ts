import { isAudioPackage, MAX_PACKAGE_BYTES, prepareAudioImport, prepareImport, staleProgressFiles, type ImportInput } from '@shelf/spec';
import { Directory, File, Paths } from 'expo-file-system';
import { getDb } from '@/db';
import { getBook } from '@/db/queries';
import { loadAudioManifest, writeAudioPackage } from '@/library/audio';
import { notifyLibraryChanged } from '@/library/events';
import { writeBookAtomically } from '@/library/fs';
import { reindexBook } from '@/library/index-books';
import { bookDir, inboxDir } from '@/lib/paths';
import { createSerialQueue } from '@/lib/serial-queue';

export type ImportResult =
  | { ok: true; status: 'added' | 'updated'; bookId: string; title: string; warnings: string[] }
  /** 原声音频包（README 第 8.1 节）：chapters 为这次传来的章数，total 为本书现在有原声的章数 */
  | { ok: true; status: 'audio'; bookId: string; title: string; chapters: number; total: number; warnings: string[] }
  | { ok: false; fileName: string; error: string };

const stagingId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const runSerially = createSerialQueue();

/**
 * 唯一的导入管线（README 第 6 节）：AirDrop、系统分享、文件选择、局域网上传都调用这里。
 * 所有通道共用一个队列，一次只导入一个文件，避免同一本书的写入和重建索引交错。
 */
export function importFile(uri: string): Promise<ImportResult> {
  return runSerially(() => importFileNow(uri));
}

/** 来源文件先落到 inbox/<id>/，处理结束后无论成败都清理掉 */
async function importFileNow(uri: string): Promise<ImportResult> {
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
    if (lower.endsWith('.zip')) {
      const bytes = await staged.bytes();
      if (isAudioPackage(bytes)) return await importAudio(bytes, fail);
      input = { kind: 'zip', fileName, bytes };
    }
    else if (lower.endsWith('.md') || lower.endsWith('.markdown')) input = { kind: 'md', fileName, text: await staged.text() };
    else return fail('只支持 .zip 和 .md 文件');

    const prepared = prepareImport(input);
    if (!prepared.ok) return fail(prepared.error);

    const existed = bookDir(prepared.id).exists;
    writeBookAtomically(prepared.id, prepared.files, prepared.hash);
    await cleanStaleProgress(prepared.id, prepared.manifest.chapters);
    await reindexBook(prepared.id);
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
    // iOS 把「用书巢打开」的文件拷到 Documents/Inbox/，用完即删；App 外的原文件不动
    if (source.exists && source.uri.startsWith(Paths.document.uri)) source.delete();
  }
}

/** 原声音频包：书必须已经在书架上；录音写到 audio/<id>/，不进 books/<id>/ */
async function importAudio(bytes: Uint8Array, fail: (error: string) => ImportResult): Promise<ImportResult> {
  const prepared = prepareAudioImport(bytes);
  if (!prepared.ok) return fail(prepared.error);
  const book = await getBook(prepared.bookId);
  if (!book) return fail(`书架上还没有「${prepared.bookId}」，先导入书再传原声`);
  const merged = writeAudioPackage(prepared, await loadAudioManifest(prepared.bookId));
  return {
    ok: true,
    status: 'audio',
    bookId: prepared.bookId,
    title: book.title,
    chapters: Object.keys(prepared.manifest.chapters).length,
    total: Object.keys(merged.chapters).length,
    warnings: [],
  };
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
