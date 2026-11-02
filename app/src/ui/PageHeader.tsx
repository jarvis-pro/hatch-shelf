import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from './theme';

/** Tab 页顶部：一行小字副标题 + 大标题，右侧放玻璃按钮 */
export function PageHeader({ sub, title, right }: { sub: string; title: string; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.titles}>
        <Text style={[styles.sub, { color: t.fg2 }]}>{sub}</Text>
        <Text style={[styles.title, { color: t.fg }]} accessibilityRole="header">
          {title}
        </Text>
      </View>
      {right && <View style={styles.right}>{right}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  titles: { gap: 2 },
  sub: { fontSize: 13, fontWeight: '500' },
  title: { fontSize: 34, fontWeight: '700', letterSpacing: -0.5 },
  right: { flexDirection: 'row', gap: 10, paddingBottom: 6 },
});
