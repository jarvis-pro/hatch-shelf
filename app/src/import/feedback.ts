import { router } from 'expo-router';
import { Alert } from 'react-native';
import type { ImportResult } from './pipeline';

/** 向用户反馈导入结果（README 第 6 节第 7 步） */
export function showImportResult(r: ImportResult) {
  if (!r.ok) {
    Alert.alert('导入失败', `${r.fileName}\n\n${r.error}`);
    return;
  }
  if (r.status === 'audio') {
    Alert.alert('已导入原声', `《${r.title}》收到 ${r.chapters} 章原声，现在共 ${r.total} 章可以用原声听`);
    return;
  }
  const lines = [`《${r.title}》${r.status === 'updated' ? '已更新为新版本' : '已加入书架'}`];
  if (r.warnings.length) lines.push('', ...r.warnings.map((w) => `⚠︎ ${w}`));
  Alert.alert(r.status === 'updated' ? '已更新' : '已导入', lines.join('\n'), [
    { text: '好', style: 'cancel' },
    { text: '打开', onPress: () => router.push({ pathname: '/read/[id]', params: { id: r.bookId } }) },
  ]);
}
