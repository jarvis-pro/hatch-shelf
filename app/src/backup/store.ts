import { File, Paths } from 'expo-file-system';
import { Share } from 'react-native';
import { getDb } from '@/db';
import { getSetting } from '@/db/queries';
import { notifyLibraryChanged } from '@/library/events';
import { loadReaderPrefs, saveReaderPrefs, type ReaderPrefs } from '@/reader/theme';
import { setAppearance, type AppearanceMode } from '@/ui/theme';
import {
  BACKUP_FORMAT,
  BACKUP_SETTING_KEYS,
  BACKUP_VERSION,
  backupFileName,
  planRestore,
  type Backup,
  type HighlightRow,
  type ProgressRow,
  describeRestore,
  parseBackup,
  type RestorePlan,
} from './format';

/** 当前的全部用户数据（局域网 GET /backup 和分享导出共用） */
export async function exportBackup(): Promise<Backup> {
  const db = getDb();
  const [progress, highlights] = await Promise.all([
    db.getAllAsync<ProgressRow>('SELECT book_id, chapter_file, scroll_ratio, anchor, updated_at FROM progress ORDER BY book_id, chapter_file'),
    db.getAllAsync<HighlightRow>(
      `SELECT id, book_id, chapter_file, text, prefix, suffix, anchor, kind, note, created_at, updated_at
       FROM highlights ORDER BY book_id, created_at`,
    ),
  ]);
  const settings: Record<string, unknown> = {};
  for (const key of BACKUP_SETTING_KEYS) {
    const value = await getSetting<unknown>(key, undefined);
    if (value !== undefined) settings[key] = value;
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: Date.now(), progress, highlights, settings };
}

/** 导出成 JSON 文件，经分享面板存到「文件」App 或 AirDrop 回电脑 */
export async function shareBackup() {
  const backup = await exportBackup();
  const file = new File(Paths.cache, backupFileName(backup.exportedAt));
  file.create({ overwrite: true });
  file.writeSync(JSON.stringify(backup));
  await Share.share({ url: file.uri, title: '书巢阅读数据备份' });
}

/** 从「文件」App 选一个备份文件恢复；取消时返回 null，否则返回给用户看的结果 */
export async function pickAndRestore(): Promise<string | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['application/json'] });
  if (picked.canceled) return null;
  const parsed = parseBackup(await new File(picked.result.uri).text());
  if (!parsed.ok) throw new Error(parsed.error);
  return describeRestore(await restoreBackup(parsed.backup));
}

/** 按 planRestore 的规则合并进本机；返回实际写入的内容 */
export async function restoreBackup(backup: Backup): Promise<RestorePlan> {
  const db = getDb();
  const [progress, highlights] = await Promise.all([
    db.getAllAsync<Pick<ProgressRow, 'book_id' | 'chapter_file' | 'updated_at'>>('SELECT book_id, chapter_file, updated_at FROM progress'),
    db.getAllAsync<Pick<HighlightRow, 'id' | 'updated_at'>>('SELECT id, updated_at FROM highlights'),
  ]);
  const plan = planRestore({ progress, highlights }, backup);

  await db.withTransactionAsync(async () => {
    for (const p of plan.progress) {
      await db.runAsync(
        `INSERT INTO progress (book_id, chapter_file, scroll_ratio, anchor, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (book_id, chapter_file) DO UPDATE SET
           scroll_ratio = excluded.scroll_ratio, anchor = excluded.anchor, updated_at = excluded.updated_at`,
        p.book_id,
        p.chapter_file,
        p.scroll_ratio,
        p.anchor,
        p.updated_at,
      );
    }
    for (const h of plan.highlights) {
      await db.runAsync(
        `INSERT OR REPLACE INTO highlights
           (id, book_id, chapter_file, text, prefix, suffix, anchor, kind, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        h.id,
        h.book_id,
        h.chapter_file,
        h.text,
        h.prefix,
        h.suffix,
        h.anchor,
        h.kind,
        h.note,
        h.created_at,
        h.updated_at,
      );
    }
    // last_read_at 由 progress 推导（README 第 7 节）；书还没导入的进度先留着，推书后自然生效
    await db.runAsync(
      `UPDATE books SET last_read_at = (SELECT MAX(updated_at) FROM progress p WHERE p.book_id = books.id)
       WHERE id IN (SELECT DISTINCT book_id FROM progress)`,
    );
  });

  // 走各自的保存函数，已打开的页面会立即跟着变
  const { appearance, readerTheme } = plan.settings as { appearance?: AppearanceMode; readerTheme?: Partial<ReaderPrefs> };
  if (appearance) await setAppearance(appearance);
  if (readerTheme) {
    const { fontSize, lineHeight, wrapCode } = { ...(await loadReaderPrefs()), ...readerTheme };
    await saveReaderPrefs({ fontSize, lineHeight, wrapCode });
  }

  notifyLibraryChanged();
  return plan;
}
