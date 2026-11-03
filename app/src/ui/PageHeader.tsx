import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from './theme';

/** Tab 页顶部：大标题（可带数量），右侧放玻璃按钮。行高固定，有没有按钮的页面标题都在同一位置，切 Tab 时不跳动 */
export function PageHeader({ title, count, right }: { title: string; count?: string; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.title}>
        <Text style={[styles.text, { color: t.fg }]} accessibilityRole="header">
          {title}
        </Text>
        {count && <Text style={[styles.count, { color: t.fg3 }]}>{count}</Text>}
      </View>
      {right && <View style={styles.right}>{right}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  // 高度取标题行高与玻璃按钮（40）中较大者
  row: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // 数量与标题底部对齐
  title: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  text: { fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: -0.5 },
  count: { fontSize: 15, lineHeight: 22, paddingBottom: 6 },
  right: { flexDirection: 'row', gap: 10 },
});
