import { File, Paths } from 'expo-file-system';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { getBook, getChapters, type BookRow, type ChapterRow } from '@/db/queries';
import { buildNotesMarkdown } from '@/notes/export';
import { chooseHighlightAction, promptNote } from '@/notes/prompts';
import { deleteHighlight, listHighlights, setNote, type Highlight } from '@/notes/store';
import { useShelfColors } from '@/shelf/colors';

/** 一本书的全部高亮与笔记，按章节分组；可导出为 Markdown 分享回电脑 */
export default function NotesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useShelfColors();
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
    const action = await chooseHighlightAction(h.text, !!h.note);
    if (action === 'delete') await deleteHighlight(h.id);
    if (action === 'note') {
      const note = await promptNote(h.text, h.note ?? '');
      if (note === null) return;
      await setNote(h.id, note || null);
    }
    await load();
  };

  const exportNotes = async () => {
    if (!book) return;
    const file = new File(Paths.cache, `${book.id}.notes.md`);
    file.create({ overwrite: true });
    file.writeSync(buildNotesMarkdown(book, chapters, items));
    // 通过系统分享面板 AirDrop 回电脑，放到仓库的 notes/ 目录
    await Share.share({ url: file.uri, title: `${book.title} 阅读笔记` });
  };

  const titleOf = (file: string) => {
    const i = chapters.findIndex((ch) => ch.file === file);
    return i >= 0 ? `${i + 1}. ${chapters[i].title}` : file;
  };
  const groups = [...new Set(items.map((h) => h.chapterFile))];

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.container}
    >
      <Stack.Screen
        options={{
          title: book ? `${book.title} · 笔记` : '笔记',
          headerRight: () =>
            items.length > 0 ? (
              <Pressable onPress={() => void exportNotes()} hitSlop={10}>
                <Text style={{ color: c.accent, fontSize: 16 }}>导出</Text>
              </Pressable>
            ) : null,
        }}
      />
      {items.length === 0 && (
        <Text style={[styles.empty, { color: c.muted }]}>
          还没有高亮或笔记。阅读时长按选中文字，在菜单里选「高亮」或「笔记」。
        </Text>
      )}
      {groups.map((file) => (
        <View key={file} style={styles.group}>
          <Text style={[styles.chapter, { color: c.fg }]}>{titleOf(file)}</Text>
          {items
            .filter((h) => h.chapterFile === file)
            .map((h) => (
              <Pressable
                key={h.id}
                onPress={() => open(h)}
                onLongPress={() => void edit(h)}
                style={[styles.card, { backgroundColor: c.card }]}
              >
                <Text style={[styles.quote, { color: c.fg, borderColor: '#f5c518' }]} numberOfLines={6}>
                  {h.text.trim()}
                </Text>
                {h.note && <Text style={{ color: c.fg, fontSize: 15, lineHeight: 22 }}>{h.note}</Text>}
                <Text style={{ color: c.muted, fontSize: 12 }}>{new Date(h.createdAt).toLocaleDateString()}</Text>
              </Pressable>
            ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 20, paddingBottom: 48 },
  empty: { textAlign: 'center', paddingVertical: 60, lineHeight: 22 },
  group: { gap: 10 },
  chapter: { fontSize: 17, fontWeight: '600' },
  card: { borderRadius: 12, padding: 14, gap: 8 },
  quote: { borderLeftWidth: 3, paddingLeft: 10, fontSize: 15, lineHeight: 22 },
});
