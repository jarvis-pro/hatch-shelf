import { router, useFocusEffect } from 'expo-router';
import { Search } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listBooks, type BookRow } from '@/db/queries';
import { countLabel, formatDay } from '@/notes/format';
import { listNotesSummary, type NotesSummary } from '@/notes/store';
import { openNotes } from '@/shelf/actions';
import { BookCover } from '@/shelf/BookCover';
import { Backdrop } from '@/ui/Backdrop';
import { Glass, GlassButton } from '@/ui/glass';
import { FadeInUp, PressScale } from '@/ui/motion';
import { PageHeader } from '@/ui/PageHeader';
import { TAB_BAR_SPACE } from '@/ui/TabBar';
import { useTheme } from '@/ui/theme';

type Row = NotesSummary & { book: BookRow };

export default function NotesTab() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<Row[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      void Promise.all([listNotesSummary(), listBooks()]).then(([summary, books]) => {
        const byId = new Map(books.map((b) => [b.id, b]));
        setRows(summary.flatMap((s) => (byId.has(s.bookId) ? [{ ...s, book: byId.get(s.bookId)! }] : [])));
      });
    }, []),
  );

  return (
    <View style={styles.flex}>
      <Backdrop />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 6, paddingBottom: TAB_BAR_SPACE + 20 }]}
        showsVerticalScrollIndicator={false}
      >
        <PageHeader
          title="笔记"
          right={<GlassButton icon={Search} label="搜索" onPress={() => router.push('/search')} />}
        />
        {rows?.length === 0 && (
          <Text style={[styles.empty, { color: t.fg3 }]}>
            还没有高亮或笔记。{'\n'}阅读时长按选中文字，在菜单里选「高亮」或「笔记」。
          </Text>
        )}
        <View style={styles.list}>
          {rows?.map((r, i) => (
            <FadeInUp key={r.bookId} index={i}>
              <PressScale onPress={() => openNotes(r.bookId)}>
                <Glass radius={22} style={styles.card}>
                  <BookCover book={r.book} width={56} radius={8} />
                  <View style={styles.info}>
                    <View style={styles.head}>
                      <Text style={[styles.title, { color: t.fg }]} numberOfLines={1}>
                        {r.book.title}
                      </Text>
                      <Text style={{ color: t.fg3, fontSize: 11 }}>{formatDay(r.lastAt)}</Text>
                    </View>
                    <Text style={{ color: t.fg2, fontSize: 12 }}>{countLabel(r.highlights, r.notes, r.doubts)}</Text>
                    <View style={styles.snip}>
                      <View style={[styles.bar, { backgroundColor: t.highlight }]} />
                      <Text style={{ flex: 1, color: t.fg3, fontSize: 12, lineHeight: 18 }} numberOfLines={2}>
                        {r.latest}
                      </Text>
                    </View>
                  </View>
                </Glass>
              </PressScale>
            </FadeInUp>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, gap: 22 },
  empty: { textAlign: 'center', lineHeight: 22, paddingVertical: 60 },
  list: { gap: 12 },
  card: { flexDirection: 'row', gap: 14, padding: 14 },
  info: { flex: 1, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontSize: 15, fontWeight: '700' },
  snip: { flexDirection: 'row', gap: 8, paddingTop: 2 },
  bar: { width: 2, height: 18, borderRadius: 1, marginTop: 0 },
});
