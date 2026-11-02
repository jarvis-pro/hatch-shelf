import { resolveBook } from '@shelf/spec';
import { ScrollView, StyleSheet, Text, useColorScheme } from 'react-native';

// M0 冒烟检查：确认 workspace 包能被 Metro 解析、zod / yaml 能在 Hermes 上运行
const probe = resolveBook({
  dirName: 'hello',
  yamlText: 'id: hello\ntitle: 你好，书架\nchapters: [01-intro.md]',
  mdFiles: ['01-intro.md'],
});

export default function ShelfScreen() {
  const dark = useColorScheme() === 'dark';
  const color = dark ? '#eee' : '#222';
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={[styles.title, { color }]}>书架还是空的</Text>
      <Text style={{ color }}>
        @shelf/spec：{probe.ok ? `OK（${probe.manifest.title}）` : probe.errors.join('\n')}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '600' },
});
