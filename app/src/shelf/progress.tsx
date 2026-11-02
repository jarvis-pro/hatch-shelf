import { BlurView } from 'expo-blur';
import { StyleSheet, Text, View } from 'react-native';
import type { BookProgress, BookRow } from '@/db/queries';
import { useTheme } from '@/ui/theme';

export const percent = (p: BookProgress) => `${Math.round(p.ratio * 100)}%`;

/** 「12 章 · 已读完」「10 章 · 读到 40%」「16 章 · 未开始」 */
export function bookMeta(book: Pick<BookRow, 'chapterCount'>, p: BookProgress | undefined) {
  const state = !p ? '未开始' : p.finished ? '已读完' : `读到 ${percent(p)}`;
  return `${book.chapterCount} 章 · ${state}`;
}

/** 封面左下角的进度徽标：读完显示 ✓，读过显示百分比，没读过（或刚打开）不显示 */
export function ProgressBadge({ progress }: { progress?: BookProgress }) {
  const t = useTheme();
  if (!progress || (!progress.finished && progress.ratio < 0.01)) return null;
  return (
    <View style={styles.badge}>
      <BlurView intensity={30} tint={t.blurTint} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: t.dark ? '#00000059' : '#FFFFFF9E' }]} />
      <Text style={[styles.text, { color: t.fg }]}>{progress.finished ? '✓' : percent(progress)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    height: 20,
    paddingHorizontal: 8,
    borderRadius: 10,
    overflow: 'hidden',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#FFFFFFCC',
  },
  text: { fontSize: 10, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
