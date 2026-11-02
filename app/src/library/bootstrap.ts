import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { getDb } from '@/db';
import { inboxDir, readerDir } from '@/lib/paths';
import readerHtml from '../../assets/reader/index.html';
import { seedSamples } from './books';
import { rebuildIndex } from './index-books';

let readerUri: string | null = null;

/** 阅读器页面在 documentDirectory 下的 file:// 地址；bootstrap 之后可用 */
export function getReaderUri(): string {
  if (!readerUri) throw new Error('阅读器尚未安装');
  return readerUri;
}

/** 每次启动都覆盖一次，保证阅读器与 App 版本一致 */
async function installReader() {
  const asset = Asset.fromModule(readerHtml);
  await asset.downloadAsync();
  if (!readerDir.exists) readerDir.create({ intermediates: true });
  const dest = new File(readerDir, 'index.html');
  if (dest.exists) dest.delete();
  new File(asset.localUri ?? asset.uri).copySync(dest);
  readerUri = dest.uri;
}

export async function bootstrap() {
  getDb();
  if (!inboxDir.exists) inboxDir.create({ intermediates: true });
  await installReader();
  await seedSamples();
  await rebuildIndex();
}
