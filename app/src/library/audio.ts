import {
  AUDIO_FILE_RE,
  AUDIO_MANIFEST,
  audioManifestSchema,
  mergeAudioManifest,
  referencedAudioFiles,
  type AudioManifest,
  type PreparedAudio,
} from '@shelf/spec';
import { File } from 'expo-file-system';
import { audioDir, bookDir } from '@/lib/paths';
import { notifyLibraryChanged } from './events';

/**
 * 原声录音在设备上的存取（README 第 8.1 节）：documentDirectory/audio/<id>/，与 books/<id>/ 分开，
 * 书更新时整目录替换不会把录音冲掉。
 */

/** 本书的录音清单；没有原声或清单有误时为 null */
export async function loadAudioManifest(bookId: string): Promise<AudioManifest | null> {
  const f = new File(audioDir(bookId), AUDIO_MANIFEST);
  if (!f.exists) return null;
  try {
    const r = audioManifestSchema.safeParse(JSON.parse(await f.text()));
    return r.success && r.data.bookId === bookId ? r.data : null;
  } catch {
    return null;
  }
}

/** 本书录音占用的空间；没有原声为 0 */
export function audioBytes(bookId: string): number {
  const dir = audioDir(bookId);
  return dir.exists ? (dir.info().size ?? 0) : 0;
}

/**
 * 写入一个音频包：先写录音，最后写合并后的清单，中途被杀也不会出现清单引用了却不存在的文件；
 * 写完删掉清单不再引用的录音（换了音色、章节重新生成过）。返回合并后的清单
 */
export function writeAudioPackage(prepared: Extract<PreparedAudio, { ok: true }>, existing: AudioManifest | null): AudioManifest {
  const { bookId } = prepared;
  if (!bookDir(bookId).exists) throw new Error('书架上还没有这本书，先导入书再传原声');
  const dir = audioDir(bookId);
  if (!dir.exists) dir.create({ intermediates: true });

  for (const { name, bytes } of prepared.files) {
    const f = new File(dir, name);
    // 文件名就是内容指纹，已有的不必重写
    if (f.exists && f.size === bytes.length) continue;
    f.create({ overwrite: true });
    f.writeSync(bytes);
  }

  const merged = mergeAudioManifest(existing, prepared.manifest);
  const tmp = new File(dir, `${AUDIO_MANIFEST}.tmp`);
  tmp.create({ overwrite: true });
  tmp.writeSync(JSON.stringify(merged));
  const target = new File(dir, AUDIO_MANIFEST);
  if (target.exists) target.delete();
  // SDK 58 的 move() 是异步的，这里要同步换上，后面的清理才不会抢在它之前
  tmp.rename(AUDIO_MANIFEST);

  const keep = referencedAudioFiles(merged);
  for (const entry of dir.list()) {
    if (entry instanceof File && AUDIO_FILE_RE.test(entry.name) && !keep.has(entry.name.slice(0, -4))) entry.delete();
  }
  notifyLibraryChanged();
  return merged;
}

/** 删除本书原声；书和笔记都保留 */
export function deleteAudio(bookId: string, notify = true) {
  const dir = audioDir(bookId);
  if (dir.exists) dir.delete();
  if (notify) notifyLibraryChanged();
}

/** 有原声的书各自录音的大小（书籍管理页把它算进书和分组的合计） */
export function audioSizes(bookIds: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of bookIds) {
    const bytes = audioBytes(id);
    if (bytes > 0) out.set(id, bytes);
  }
  return out;
}
