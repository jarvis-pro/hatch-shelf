import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getBook, getChapters, type BookRow, type ChapterRow } from '@/db/queries';
import { countHighlights } from '@/notes/store';
import { confirmDelete } from '@/shelf/actions';
import { BookCover } from '@/shelf/BookCover';
import { useShelfColors } from '@/shelf/colors';

const LEVEL_LABELS = { beginner: '入门', intermediate: '进阶', advanced: '高级' } as const;

export default function BookInfoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useShelfColors();
  const [book, setBook] = useState<BookRow | null>(null);
  const [chapters, setChapters] = useState<ChapterRow[]>([]);
  const [noteCount, setNoteCount] = useState(0);

  useEffect(() => {
    void Promise.all([getBook(id), getChapters(id), countHighlights(id)]).then(([b, chs, n]) => {
      setBook(b);
      setChapters(chs);
      setNoteCount(n);
    });
  }, [id]);

  if (!book) return <View style={{ flex: 1, backgroundColor: c.bg }} />;

  const read = (chapter?: string) => {
    router.back();
    router.push({ pathname: '/read/[id]', params: chapter ? { id, chapter } : { id } });
  };

  const meta = [
    ['分类', book.category],
    ['难度', book.level && LEVEL_LABELS[book.level]],
    ['标签', book.tags.join('、') || null],
    ['内容更新', book.updatedAt],
    ['导入时间', new Date(book.importedAt).toLocaleString()],
    ['ID', book.id],
  ].filter((r): r is [string, string] => !!r[1]);

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.container}
    >
      <Stack.Screen options={{ title: '书籍信息' }} />
      <View style={styles.hero}>
        <BookCover book={book} width={110} />
        <View style={styles.heroText}>
          <Text style={[styles.title, { color: c.fg }]}>{book.title}</Text>
          {book.subtitle && <Text style={{ color: c.muted, fontSize: 15 }}>{book.subtitle}</Text>}
          <Pressable style={[styles.readBtn, { backgroundColor: c.accent }]} onPress={() => read()}>
            <Text style={styles.readBtnText}>{book.lastReadAt ? '继续阅读' : '开始阅读'}</Text>
          </Pressable>
        </View>
      </View>

      {book.warnings.length > 0 && (
        <View style={[styles.card, { backgroundColor: c.card }]}>
          {book.warnings.map((w) => (
            <Text key={w} style={{ color: c.danger, fontSize: 14 }}>
              ⚠︎ {w}
            </Text>
          ))}
        </View>
      )}

      <View style={[styles.card, { backgroundColor: c.card }]}>
        {meta.map(([k, v]) => (
          <View key={k} style={styles.metaRow}>
            <Text style={{ color: c.muted }}>{k}</Text>
            <Text style={[styles.metaValue, { color: c.fg }]} numberOfLines={1}>
              {v}
            </Text>
          </View>
        ))}
      </View>

      <Pressable
        style={[styles.card, styles.metaRow, { backgroundColor: c.card }]}
        onPress={() => {
          router.back();
          router.push({ pathname: '/notes/[id]', params: { id } });
        }}
      >
        <Text style={{ color: c.fg, fontSize: 15 }}>高亮与笔记</Text>
        <Text style={{ color: c.muted }}>{noteCount} 条 ›</Text>
      </Pressable>

      <Text style={[styles.sectionTitle, { color: c.fg }]}>目录 · {chapters.length} 章</Text>
      <View style={[styles.card, { backgroundColor: c.card, paddingVertical: 4 }]}>
        {chapters.map((ch, i) => (
          <Pressable key={ch.file} style={styles.chapterRow} onPress={() => read(ch.file)}>
            <Text style={{ color: c.muted, width: 24 }}>{i + 1}</Text>
            <Text style={{ color: c.fg, flex: 1, fontSize: 15 }} numberOfLines={1}>
              {ch.title}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={[styles.card, { backgroundColor: c.card, alignItems: 'center' }]} onPress={() => confirmDelete(book, () => router.back())}>
        <Text style={{ color: c.danger, fontSize: 16 }}>删除这本书</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16, paddingBottom: 48 },
  hero: { flexDirection: 'row', gap: 18 },
  heroText: { flex: 1, gap: 6 },
  title: { fontSize: 22, fontWeight: '700' },
  readBtn: { marginTop: 'auto', alignSelf: 'flex-start', paddingHorizontal: 22, paddingVertical: 10, borderRadius: 20 },
  readBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  card: { borderRadius: 12, padding: 14, gap: 10 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  metaValue: { flexShrink: 1, textAlign: 'right' },
  sectionTitle: { fontSize: 17, fontWeight: '600', marginTop: 8 },
  chapterRow: { flexDirection: 'row', paddingVertical: 10 },
});
