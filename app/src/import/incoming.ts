import { File } from 'expo-file-system';
import * as Linking from 'expo-linking';
import { useEffect } from 'react';
import { showImportResult } from './feedback';
import { importFile } from './pipeline';

const isFileUrl = (url: string | null): url is string => !!url && url.startsWith('file://');

let chain = Promise.resolve();
const seen = new Set<string>();

/** 依次导入，避免两个文件同时写同一本书 */
function enqueue(url: string) {
  if (seen.has(url)) return;
  seen.add(url);
  chain = chain.then(async () => {
    showImportResult(await importFile(url));
    seen.delete(url);
  });
}

/**
 * 处理通过 AirDrop / 「用书架打开」传进来的文件。
 * iOS 以 file:// URL 打开 App；路由层面由 +native-intent.tsx 把它重定向到首页。
 * 必须在 bootstrap 完成后挂载。
 */
export function useIncomingFiles() {
  useEffect(() => {
    void Linking.getInitialURL().then((url) => isFileUrl(url) && enqueue(url));
    const sub = Linking.addEventListener('url', ({ url }) => isFileUrl(url) && enqueue(url));
    return () => sub.remove();
  }, []);
}

/** 从「文件」App 里选择一个 zip / md 导入 */
export async function pickAndImport() {
  const picked = await File.pickFileAsync({
    mimeTypes: ['application/zip', 'text/markdown', 'text/plain'],
  });
  if (picked.canceled) return;
  enqueue(picked.result.uri);
}
