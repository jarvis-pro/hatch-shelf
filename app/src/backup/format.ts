/**
 * 阅读数据备份：SQLite 里不可重建的用户数据（阅读进度、高亮与笔记、外观与阅读设置）。
 * 书籍原文不在备份里，换机或重装后重新推书即可；进度和高亮按书 id 与章节文件名挂回去。
 *
 * 纯函数，不碰数据库，便于在 Node 里测试。
 */

export const BACKUP_FORMAT = 'hatch-shelf-backup';
export const BACKUP_VERSION = 1;

/** 只备份读者自己设的项；introPlayed、readerHash 这类内部状态不备份 */
export const BACKUP_SETTING_KEYS = ['appearance', 'readerTheme'] as const;

export interface ProgressRow {
  book_id: string;
  chapter_file: string;
  scroll_ratio: number;
  anchor: string | null;
  updated_at: number;
}

export interface HighlightRow {
  id: string;
  book_id: string;
  chapter_file: string;
  text: string;
  prefix: string;
  suffix: string;
  anchor: string | null;
  kind: 'highlight' | 'doubt';
  note: string | null;
  created_at: number;
  updated_at: number;
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  progress: ProgressRow[];
  highlights: HighlightRow[];
  /** 值是 settings 表里 JSON.parse 之后的结果 */
  settings: Record<string, unknown>;
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isOptStr = (v: unknown) => v === null || v === undefined || isStr(v);

function isProgress(r: unknown): r is ProgressRow {
  const o = r as Record<string, unknown>;
  return !!o && isStr(o.book_id) && isStr(o.chapter_file) && isNum(o.scroll_ratio) && isOptStr(o.anchor) && isNum(o.updated_at);
}

function isHighlight(r: unknown): r is HighlightRow {
  const o = r as Record<string, unknown>;
  return (
    !!o &&
    [o.id, o.book_id, o.chapter_file, o.text, o.prefix, o.suffix].every(isStr) &&
    isOptStr(o.anchor) &&
    isOptStr(o.note) &&
    (o.kind === undefined || o.kind === 'highlight' || o.kind === 'doubt') &&
    isNum(o.created_at) &&
    isNum(o.updated_at)
  );
}

/** 解析备份文件；格式不对时返回错误说明 */
export function parseBackup(text: string): { ok: true; backup: Backup } | { ok: false; error: string } {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { ok: false, error: '不是有效的 JSON 文件' };
  }
  if (data?.format !== BACKUP_FORMAT) return { ok: false, error: '不是书巢的阅读数据备份' };
  if (!isNum(data.version) || data.version > BACKUP_VERSION) return { ok: false, error: '备份来自更新版本的书巢，请先更新 App' };
  if (!Array.isArray(data.progress) || !Array.isArray(data.highlights)) return { ok: false, error: '备份内容不完整' };
  const progress = data.progress.filter(isProgress);
  const highlights = data.highlights.filter(isHighlight).map((h) => ({ ...h, kind: h.kind ?? 'highlight' }));
  if (progress.length !== data.progress.length || highlights.length !== data.highlights.length) {
    return { ok: false, error: '备份里有无法识别的记录' };
  }
  const settings: Record<string, unknown> = {};
  const raw = (data.settings ?? {}) as Record<string, unknown>;
  for (const key of BACKUP_SETTING_KEYS) if (key in raw) settings[key] = raw[key];
  return {
    ok: true,
    backup: { format: BACKUP_FORMAT, version: data.version, exportedAt: isNum(data.exportedAt) ? data.exportedAt : 0, progress, highlights, settings },
  };
}

export interface RestorePlan {
  progress: ProgressRow[];
  highlights: HighlightRow[];
  settings: Record<string, unknown>;
  summary: { progressAdded: number; progressUpdated: number; highlightsAdded: number; highlightsUpdated: number };
}

/**
 * 合并而不是覆盖：本机没有的记录写入，两边都有的保留 updated_at 较新的一份。
 * 所以恢复不会丢掉备份之后在本机新增的进度和高亮；代价是备份之后在本机删掉的高亮会被恢复回来。
 * 设置以备份为准（只有外观和阅读设置两项）。
 */
export function planRestore(
  current: {
    progress: Pick<ProgressRow, 'book_id' | 'chapter_file' | 'updated_at'>[];
    highlights: Pick<HighlightRow, 'id' | 'updated_at'>[];
  },
  backup: Backup,
): RestorePlan {
  const progressKey = (p: Pick<ProgressRow, 'book_id' | 'chapter_file'>) => `${p.book_id}\u0000${p.chapter_file}`;
  const localProgress = new Map(current.progress.map((p) => [progressKey(p), p]));
  const localHighlights = new Map(current.highlights.map((h) => [h.id, h]));
  const summary = { progressAdded: 0, progressUpdated: 0, highlightsAdded: 0, highlightsUpdated: 0 };

  const progress = backup.progress.filter((p) => {
    const local = localProgress.get(progressKey(p));
    if (!local) summary.progressAdded += 1;
    else if (p.updated_at > local.updated_at) summary.progressUpdated += 1;
    else return false;
    return true;
  });
  const highlights = backup.highlights.filter((h) => {
    const local = localHighlights.get(h.id);
    if (!local) summary.highlightsAdded += 1;
    else if (h.updated_at > local.updated_at) summary.highlightsUpdated += 1;
    else return false;
    return true;
  });
  return { progress, highlights, settings: backup.settings, summary };
}

/** 「恢复了 3 本书的进度、12 条高亮」这样的一句话 */
export function describeRestore(plan: RestorePlan): string {
  const s = plan.summary;
  const books = new Set(plan.progress.map((p) => p.book_id)).size;
  const parts = [
    books > 0 && `${books} 本书的阅读进度`,
    s.highlightsAdded + s.highlightsUpdated > 0 && `${s.highlightsAdded + s.highlightsUpdated} 条高亮与笔记`,
  ].filter(Boolean);
  return parts.length ? `已恢复 ${parts.join('、')}` : '本机的阅读数据已经是最新的，没有需要恢复的内容';
}

/** 备份文件名：shelf-backup-2026-11-03.json */
export const backupFileName = (ms: number) => `shelf-backup-${new Date(ms).toISOString().slice(0, 10)}.json`;
