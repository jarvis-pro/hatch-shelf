import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from './theme';

/** Tab 页顶部：大标题，右侧放玻璃按钮。行高固定，有没有按钮的页面标题都在同一位置，切 Tab 时不跳动 */
export function PageHeader({ title, right }: { title: string; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.title, { color: t.fg }]} accessibilityRole="header">
        {title}
      </Text>
      {right && <View style={styles.right}>{right}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  // 高度取标题行高与玻璃按钮（40）中较大者
  row: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: -0.5 },
  right: { flexDirection: 'row', gap: 10 },
});
