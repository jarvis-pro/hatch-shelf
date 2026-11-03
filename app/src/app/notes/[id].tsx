import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { CircleHelp, Hash, PenLine, Share } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getBook, getChapters, type BookRow, type ChapterRow } from '@/db/queries';
import { countLabel } from '@/notes/format';
import { applyHighlightAction, chooseHighlightAction } from '@/notes/prompts';
import { listHighlights, type Highlight } from '@/notes/store';
import { exportNotes } from '@/shelf/actions';
import { BookCover, useCoverUri } from '@/shelf/BookCover';
import { Backdrop } from '@/ui/Backdrop';
import { Glass, GlassPill } from '@/ui/glass';
import { FadeInUp, PressScale } from '@/ui/motion';
import { NavBar } from '@/ui/NavBar';
import { useTheme } from '@/ui/theme';

/** 一本书的全部高亮与笔记，按章节分组；可导出为 Markdown 分享回电脑 */
export default function BookNotesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const cover = useCoverUri(id);
  const [book, setBook] = useState<BookRow | null>(null);
  const [chapters, setChapters] = useState<ChapterRow[]>([]);
  const [items, setItems] = useState<Highlight[]>([]);

  const load = useCallback(async () => {
    const [b, chs, hs] = await Promise.all([getBook(id), getChapters(id), listHighlights(id)]);
    setBook(b);
    setChapters(chs);
    setItems(hs);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const open = (h: Highlight) =>
    router.push({ pathname: '/read/[id]', params: { id, chapter: h.chapterFile, highlight: h.id } });

  const edit = async (h: Highlight) => {
    await applyHighlightAction(h, await chooseHighlightAction(h));
    await load();
  };

  const titleOf = (file: string) => {
    const i = chapters.findIndex((ch) => ch.file === file);
    return i >= 0 ? `第 ${i + 1} 章 · ${chapters[i].title}` : file;
  };
  const groups = [...new Set(items.map((h) => h.chapterFile))];
  const notes = items.filter((h) => h.note).length;
  const doubts = items.filter((h) => h.kind === 'doubt').length;

  return (
    <View style={styles.flex}>
      <Backdrop cover={cover} glows={false} />
      <NavBar right={items.length > 0 && <GlassPill icon={Share} label="导出" onPress={() => void exportNotes(id)} />} />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        {book && (
          <View style={styles.head}>
            <BookCover book={book} width={52} radius={8} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.title, { color: t.fg }]} numberOfLines={2}>
                {book.title}
              </Text>
              <Text style={{ color: t.fg2, fontSize: 13 }}>{countLabel(items.length, notes, doubts)}</Text>
            </View>
          </View>
        )}
        {items.length === 0 && (
          <Text style={[styles.empty, { color: t.fg3 }]}>
            还没有高亮或笔记。{'\n'}阅读时长按选中文字，在菜单里选「高亮」「笔记」或「存疑」。
          </Text>
        )}
        {groups.map((file, gi) => (
          <FadeInUp key={file} index={gi} style={styles.group}>
            <Text style={{ color: t.fg3, fontSize: 12, fontWeight: '500' }}>{titleOf(file)}</Text>
            {items
              .filter((h) => h.chapterFile === file)
              .map((h) => (
                <PressScale key={h.id} scale={0.98} onPress={() => open(h)} onLongPress={() => void edit(h)}>
                  <Glass radius={20} style={styles.card}>
                    <View style={styles.quote}>
                      <View style={[styles.bar, { backgroundColor: h.kind === 'doubt' ? t.warn : t.highlight }]} />
                      <Text style={[styles.quoteText, { color: t.body }]}>{h.text.trim()}</Text>
                    </View>
                    {h.kind === 'doubt' && !h.note && (
                      <View style={styles.meta}>
                        <CircleHelp size={13} color={t.warn} />
                        <Text style={{ color: t.warn, fontSize: 12, fontWeight: '600' }}>存疑</Text>
                      </View>
                    )}
                    {h.note && (
                      <View style={[styles.note, { backgroundColor: t.dark ? '#FFFFFF0F' : '#FFFFFF99' }]}>
                        {h.kind === 'doubt' ? (
                          <CircleHelp size={14} color={t.warn} style={{ marginTop: 3 }} />
                        ) : (
                          <PenLine size={14} color={t.accent} style={{ marginTop: 3 }} />
                        )}
                        <Text style={{ flex: 1, color: t.ink, fontSize: 13, lineHeight: 21 }}>{h.note}</Text>
                      </View>
                    )}
                    {h.anchor && (
                      <View style={styles.meta}>
                        <Hash size={12} color={t.fg3} />
                        <Text style={{ color: t.fg3, fontSize: 11 }} numberOfLines={1}>
                          {h.anchor}
                        </Text>
                      </View>
                    )}
                  </Glass>
                </PressScale>
              ))}
          </FadeInUp>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { paddingHorizontal: 20, paddingTop: 16, gap: 20 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -0.3 },
  empty: { textAlign: 'center', lineHeight: 22, paddingVertical: 60 },
  group: { gap: 10 },
  card: { paddingVertical: 14, paddingHorizontal: 16, gap: 10 },
  quote: { flexDirection: 'row', gap: 10 },
  bar: { width: 3, borderRadius: 2 },
  quoteText: { flex: 1, fontSize: 14, lineHeight: 23 },
  note: { flexDirection: 'row', gap: 8, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
