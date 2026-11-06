import { Directory, File } from 'expo-file-system';
import { bookDir, booksDir } from '@/lib/paths';
import { OLD_PREFIX, planRecovery, TMP_PREFIX } from './recovery';

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
 * 替换要两次改名：先把旧目录挪成 .old-<id>，再把新目录改成 <id>。两次改名之间 books/<id>/ 短暂不存在，
 * 如果 App 恰好在这时被杀，下次启动由 recoverInterruptedWrites 把 .old-<id> 改回来，书不会丢。
 */
export async function writeBookAtomically(id: string, files: BookFile[], hash?: string) {
  if (!booksDir.exists) booksDir.create({ intermediates: true });
  const tmp = new Directory(booksDir, `${TMP_PREFIX}${id}`);
  if (tmp.exists) tmp.delete();
  tmp.create();
  for (const f of files) {
    const file = new File(tmp, f.path);
    file.create({ intermediates: true, overwrite: true });
    // 异步写（在原生后台线程，不占 JS 线程），逐个等写完，下面的 rename 才不会抢在写入之前
    if (f.bytes !== undefined) await file.write(f.bytes);
    else if (f.base64 !== undefined) await file.write(f.base64, { encoding: 'base64' });
    else await file.write(f.text ?? '');
  }
  if (hash) {
    const h = new File(tmp, HASH_FILE);
    h.create();
    await h.write(hash);
  }

  const target = bookDir(id);
  const old = new Directory(booksDir, `${OLD_PREFIX}${id}`);
  if (old.exists) old.delete();
  if (target.exists) target.rename(old.name);
  tmp.rename(id);
  if (old.exists) old.delete();
}

/**
 * 启动时收拾上次被中断的 writeBookAtomically：新版没就位就把旧版改回原名，其余残留删掉。
 * 恢复出来的是旧版，和数据库里的索引一致（重建索引在写入之后），不需要重新索引。
 */
export function recoverInterruptedWrites() {
  if (!booksDir.exists) return;
  const names = booksDir
    .list()
    .filter((e): e is Directory => e instanceof Directory)
    .map((d) => d.name);
  const plan = planRecovery(names);
  for (const name of plan.restore) new Directory(booksDir, name).rename(name.slice(OLD_PREFIX.length));
  for (const name of plan.remove) new Directory(booksDir, name).delete();
}
