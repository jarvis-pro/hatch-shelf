import { Directory, File } from 'expo-file-system';
import { bookDir, booksDir } from '@/lib/paths';

export interface BookFile {
  /** 相对书目录的路径，如 `assets/a.png` */
  path: string;
  text?: string;
  bytes?: Uint8Array;
  base64?: string;
}

/** 书目录下记录内容指纹的隐藏文件；以点开头，扫描与打包都会忽略它 */
export const HASH_FILE = '.content-hash';

/**
 * 原子写入一本书：先完整写到 books/.tmp-<id>/，再整体替换 books/<id>/（README 第 6 节第 4 步）。
 * 替换时先把旧目录挪开，新目录就位后再删旧的，任何时刻 books/<id>/ 要么是旧版要么是新版。
 */
export function writeBookAtomically(id: string, files: BookFile[], hash?: string) {
  if (!booksDir.exists) booksDir.create({ intermediates: true });
  const tmp = new Directory(booksDir, `.tmp-${id}`);
  if (tmp.exists) tmp.delete();
  tmp.create();
  for (const f of files) {
    const file = new File(tmp, f.path);
    file.create({ intermediates: true, overwrite: true });
    // SDK 58 起 write() 是异步的；必须同步写完，下面的 rename 才不会抢在写入之前
    if (f.bytes !== undefined) file.writeSync(f.bytes);
    else if (f.base64 !== undefined) file.writeSync(f.base64, { encoding: 'base64' });
    else file.writeSync(f.text ?? '');
  }
  if (hash) {
    const h = new File(tmp, HASH_FILE);
    h.create();
    h.writeSync(hash);
  }

  const target = bookDir(id);
  const old = new Directory(booksDir, `.old-${id}`);
  if (old.exists) old.delete();
  if (target.exists) target.rename(old.name);
  tmp.rename(id);
  if (old.exists) old.delete();
}
