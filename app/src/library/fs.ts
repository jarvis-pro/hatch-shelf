import { Directory, File } from 'expo-file-system';
import { bookDir, booksDir } from '@/lib/paths';

export interface BookFile {
  /** 相对书目录的路径，如 `assets/a.png` */
  path: string;
  text?: string;
  base64?: string;
}

/**
 * 原子写入一本书：先完整写到 books/.tmp-<id>/，再整体替换 books/<id>/（README 第 6 节第 4 步）。
 * 替换时先把旧目录挪开，新目录就位后再删旧的，任何时刻 books/<id>/ 要么是旧版要么是新版。
 */
export function writeBookAtomically(id: string, files: BookFile[]) {
  if (!booksDir.exists) booksDir.create({ intermediates: true });
  const tmp = new Directory(booksDir, `.tmp-${id}`);
  if (tmp.exists) tmp.delete();
  tmp.create();
  for (const f of files) {
    const file = new File(tmp, f.path);
    file.create({ intermediates: true, overwrite: true });
    if (f.base64 !== undefined) file.write(f.base64, { encoding: 'base64' });
    else file.write(f.text ?? '');
  }

  const target = bookDir(id);
  const old = new Directory(booksDir, `.old-${id}`);
  if (old.exists) old.delete();
  if (target.exists) target.rename(old.name);
  tmp.rename(id);
  if (old.exists) old.delete();
}

/** 读取章节第一个 H1（跳过代码块），作为章标题 */
export function extractTitle(markdown: string): string | null {
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    else if (!inFence) {
      const m = /^#\s+(.+?)\s*#*\s*$/.exec(line);
      if (m) return m[1];
    }
  }
  return null;
}
