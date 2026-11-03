import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { getDb } from '@/db';
import { getSetting, setSetting } from '@/db/queries';
import { inboxDir, readerDir } from '@/lib/paths';
import readerHtml from '../../assets/reader/index.html';
import { seedSamples } from './books';
import { rebuildIndex } from './index-books';

/**
 * 索引的结构版本：scanBook / splitSections 的产出或索引表结构变了就加一，
 * 下次启动全量重建一次。平时冷启动直接用 SQLite 里已有的索引。
 */
const INDEX_VERSION = 1;

let readerUri: string | null = null;

/** 阅读器页面在 documentDirectory 下的 file:// 地址；bootstrap 之后可用 */
export function getReaderUri(): string {
  if (!readerUri) throw new Error('阅读器尚未安装');
  return readerUri;
}

/** 阅读器随 App 版本变化时才覆盖，保证两者一致 */
async function installReader() {
  const asset = Asset.fromModule(readerHtml);
  const dest = new File(readerDir, 'index.html');
  if (!dest.exists || !asset.hash || (await getSetting('readerHash', '')) !== asset.hash) {
    await asset.downloadAsync();
    if (!readerDir.exists) readerDir.create({ intermediates: true });
    if (dest.exists) dest.delete();
    new File(asset.localUri ?? asset.uri).copySync(dest);
    await setSetting('readerHash', asset.hash);
  }
  readerUri = dest.uri;
}

export async function bootstrap() {
  getDb();
  if (!inboxDir.exists) inboxDir.create({ intermediates: true });
  await installReader();
  await seedSamples();
  if ((await getSetting('indexVersion', 0)) !== INDEX_VERSION) {
    await rebuildIndex();
    await setSetting('indexVersion', INDEX_VERSION);
  }
}
