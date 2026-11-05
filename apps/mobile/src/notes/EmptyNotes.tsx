import { PenLine } from 'lucide-react-native';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Glass } from '@/ui/glass';
import { FadeInUp } from '@/ui/motion';
import { useTheme } from '@/ui/theme';

const ART = require('../../assets/images/empty-notes.jpg');

/** 笔记 Tab 的空状态：配图 + 说明 + 缩小的选中菜单，示意怎么留下标记 */
export function EmptyNotes() {
  const t = useTheme();
  return (
    <FadeInUp style={styles.wrap}>
      <Image source={ART} style={styles.art} />
      <View style={styles.text}>
        <Text style={[styles.title, { color: t.fg }]}>还没有笔记</Text>
        <Text style={[styles.body, { color: t.fg2 }]}>
          读到想留下的地方，长按选中文字，{'\n'}在菜单里选一种标记。
        </Text>
      </View>
      <View style={styles.demo} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Glass radius={22} strong style={styles.menu}>
          <View style={styles.item}>
            <View style={[styles.dot, { backgroundColor: t.highlight }]} />
            <Text style={[styles.label, { color: t.fg }]}>高亮</Text>
          </View>
          <View style={[styles.sep, { backgroundColor: t.track }]} />
          <View style={styles.item}>
            <PenLine size={14} color={t.fg2} strokeWidth={2} />
            <Text style={[styles.label, { color: t.fg }]}>笔记</Text>
          </View>
          <View style={[styles.sep, { backgroundColor: t.track }]} />
          <View style={styles.item}>
            <View style={[styles.dot, { backgroundColor: t.warn }]} />
            <Text style={[styles.label, { color: t.fg }]}>存疑</Text>
          </View>
        </Glass>
        <Text style={[styles.sample, { color: t.fg3 }]}>
          读书是
          <Text style={{ color: t.fg, backgroundColor: t.highlightSoft }}>和另一个人的慢对话</Text>。
        </Text>
      </View>
    </FadeInUp>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 24, paddingTop: 40 },
  art: { width: 240, height: 240, borderRadius: 40 },
  text: { alignItems: 'center', gap: 8 },
  title: { fontSize: 20, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 24, textAlign: 'center' },
  demo: { alignItems: 'center', gap: 12, paddingTop: 4 },
  menu: { height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: 14, fontWeight: '500' },
  sep: { width: 1, height: 18 },
  sample: { fontSize: 15, fontFamily: 'Songti SC' },
});
