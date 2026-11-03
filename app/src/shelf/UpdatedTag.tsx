import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/ui/theme';

/** 章节在上次读过之后被书的更新改动过：目录和详情页的章节行末尾显示 */
export function UpdatedTag() {
  const t = useTheme();
  return (
    <View style={[styles.tag, { backgroundColor: `${t.accent}1A` }]}>
      <Text style={{ color: t.accent, fontSize: 11, fontWeight: '600' }}>已更新</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
});
