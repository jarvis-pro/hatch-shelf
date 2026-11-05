import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassButton } from './glass';
import { useTheme } from './theme';

/** 二级页面顶部：左边返回，右边放操作按钮；给了 title 时居中显示页面标题 */
export function NavBar({ right, onBack, title }: { right?: ReactNode; onBack?: () => void; title?: string }) {
  const insets = useSafeAreaInsets();
  const t = useTheme();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 4 }]}>
      <View style={title !== undefined && styles.side}>
        <GlassButton icon={ChevronLeft} label="返回" onPress={onBack ?? (() => router.back())} />
      </View>
      {title !== undefined && (
        <Text style={[styles.title, { color: t.fg }]} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
      )}
      <View style={[styles.right, title !== undefined && styles.side]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 4 },
  right: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  /** 左右等宽，标题才居中；放得下「取消全选」 */
  side: { width: 96 },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },
});
