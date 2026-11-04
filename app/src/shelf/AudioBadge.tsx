import { AudioLines } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/ui/theme';

interface Props {
  /** 按封面大小放大：书架 1，详情页大封面 1.4 */
  scale?: number;
  /** 距封面右上角的距离 */
  inset?: number;
}

/** 封面右上角的「原声」胶囊：有原声的书才显示，与左下角的进度徽标一上一下（设计稿「原声角标 · 方案对比」B） */
export function AudioBadge({ scale = 1, inset = 8 }: Props) {
  const t = useTheme();
  return (
    <View
      accessibilityLabel="有原声"
      style={[
        styles.badge,
        {
          top: inset,
          right: inset,
          height: 20 * scale,
          paddingHorizontal: 7 * scale,
          gap: 3 * scale,
          borderRadius: 10 * scale,
          backgroundColor: t.accent,
          shadowColor: t.accent,
          shadowRadius: 4 * scale,
          shadowOffset: { width: 0, height: 3 * scale },
        },
      ]}
    >
      <AudioLines size={11 * scale} color={t.onAccent} strokeWidth={2.4} />
      <Text style={[styles.text, { color: t.onAccent, fontSize: 10 * scale }]}>原声</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', flexDirection: 'row', alignItems: 'center', shadowOpacity: 0.35 },
  text: { fontWeight: '600' },
});
