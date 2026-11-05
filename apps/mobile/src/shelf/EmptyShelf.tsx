import { router } from 'expo-router';
import { ArrowDownToLine, FolderInput } from 'lucide-react-native';
import { Image, StyleSheet, Text, View } from 'react-native';
import { pickAndImport } from '@/import/incoming';
import { Glass } from '@/ui/glass';
import { FadeInUp, PressScale } from '@/ui/motion';
import { useTheme } from '@/ui/theme';

const ART = require('../../assets/images/empty-shelf.jpg');

export function EmptyShelf() {
  const t = useTheme();
  return (
    <FadeInUp style={styles.wrap}>
      <Image source={ART} style={styles.art} />
      <View style={styles.text}>
        <Text style={[styles.title, { color: t.fg }]}>书架还是空的</Text>
        <Text style={[styles.body, { color: t.fg2 }]}>
          在电脑上用 AirDrop 发送 .zip 或 .md，{'\n'}或者在「传书」页从浏览器上传。
        </Text>
      </View>
      <View style={styles.buttons}>
        <PressScale onPress={() => void pickAndImport()}>
          <Glass radius={23} style={styles.button}>
            <FolderInput size={16} color={t.fg} />
            <Text style={[styles.label, { color: t.fg }]}>从文件导入</Text>
          </Glass>
        </PressScale>
        <PressScale onPress={() => router.navigate('/transfer')} style={[styles.button, { backgroundColor: t.accent }]}>
          <ArrowDownToLine size={16} color="#fff" />
          <Text style={[styles.label, { color: '#fff' }]}>打开传书</Text>
        </PressScale>
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
  buttons: { flexDirection: 'row', gap: 10, paddingTop: 8 },
  button: { height: 46, borderRadius: 23, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20 },
  label: { fontSize: 14, fontWeight: '600' },
});
