/** 导入管线放行的扩展名（README 第 6 节） */
export const ALLOWED_EXTENSIONS = [
  '.md',
  '.yaml',
  '.yml',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
] as const;

/** 单个导入包的大小上限 */
export const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;

export function isAllowedFile(path: string): boolean {
  const lower = path.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** zip slip 防护：拒绝绝对路径、反斜杠路径和包含 .. 的条目 */
export function isSafeEntryPath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\')) return false;
  if (/^[a-zA-Z]:/.test(path)) return false;
  return !path.split('/').some((seg) => seg === '..');
}
