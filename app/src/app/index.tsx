import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { getChapters, getLastChapter, listBooks, type BookRow } from '@/db/queries';
import { pickAndImport } from '@/import/incoming';
import { useLibraryChanged } from '@/library/events';
import { rebuildIndex } from '@/library/index-books';
import { showBookActions } from '@/shelf/actions';
import { BookCover } from '@/shelf/BookCover';
import { useShelfColors, type ShelfColors } from '@/shelf/colors';

const PAD = 20;
const GAP = 16;
const COLUMNS = 3;

interface ContinueInfo {
  book: BookRow;
  chapterTitle: string;
  chapterIdx: number;
}

export default function ShelfScreen() {
  const c = useShelfColors();
  const { width } = useWindowDimensions();
  const [books, setBooks] = useState<BookRow[]>([]);
  const [recent, setRecent] = useState<ContinueInfo | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const all = await listBooks();
    setBooks(all);
    const last = all
      .filter((b) => b.lastReadAt)
      .sort((a, b) => b.lastReadAt! - a.lastReadAt!)[0];
    if (!last) return setRecent(null);
    const [file, chapters] = await Promise.all([getLastChapter(last.id), getChapters(last.id)]);
    const idx = Math.max(0, chapters.findIndex((ch) => ch.file === file));
    setRecent({ book: last, chapterTitle: chapters[idx]?.title ?? '', chapterIdx: idx });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useLibraryChanged(load);

  // 下拉时重新扫描 books/，修正被外部改动过的索引
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await rebuildIndex();
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const sections = useMemo(() => {
    const map = new Map<string, BookRow[]>();
    for (const b of books) {
      const key = b.category ?? '未分类';
      map.set(key, [...(map.get(key) ?? []), b]);
    }
    return [...map];
  }, [books]);

  const coverWidth = Math.floor((Math.min(width, 700) - PAD * 2 - GAP * (COLUMNS - 1)) / COLUMNS);
  const open = (id: string) => router.push({ pathname: '/read/[id]', params: { id } });

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerButtons}>
              <Pressable onPress={() => router.push('/transfer')} hitSlop={10}>
                <Text style={{ color: c.accent, fontSize: 16 }}>传书</Text>
              </Pressable>
              <Pressable onPress={() => void pickAndImport()} hitSlop={10}>
                <Text style={{ color: c.accent, fontSize: 16 }}>导入</Text>
              </Pressable>
            </View>
          ),
        }}
      />
      {recent && <ContinueCard info={recent} colors={c} onPress={() => open(recent.book.id)} />}

      {books.length === 0 && (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: c.fg }]}>书架还是空的</Text>
          <Text style={{ color: c.muted, textAlign: 'center' }}>AirDrop 一个 .zip / .md，或点右上角「传书」「导入」</Text>
        </View>
      )}

      {sections.map(([category, list]) => (
        <View key={category} style={styles.section}>
          <Text style={[styles.sectionTitle, { color: c.fg }]}>{category}</Text>
          <View style={styles.grid}>
            {list.map((b) => (
              <Pressable
                key={b.id}
                style={{ width: coverWidth }}
                onPress={() => open(b.id)}
                onLongPress={() => showBookActions(b, load)}
              >
                <BookCover book={b} width={coverWidth} />
                <Text style={[styles.bookTitle, { color: c.fg }]} numberOfLines={2}>
                  {b.title}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function ContinueCard({ info, colors: c, onPress }: { info: ContinueInfo; colors: ShelfColors; onPress(): void }) {
  const { book, chapterTitle, chapterIdx } = info;
  return (
    <Pressable onPress={onPress} style={[styles.continue, { backgroundColor: c.card }]}>
      <BookCover book={book} width={64} />
      <View style={styles.continueText}>
        <Text style={{ color: c.muted, fontSize: 13 }}>继续阅读</Text>
        <Text style={[styles.continueTitle, { color: c.fg }]} numberOfLines={1}>
          {book.title}
        </Text>
        <Text style={{ color: c.muted, fontSize: 14 }} numberOfLines={1}>
          第 {chapterIdx + 1} / {book.chapterCount} 章 · {chapterTitle}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerButtons: { flexDirection: 'row', gap: 18 },
  container: { padding: PAD, paddingBottom: 48, gap: 28 },
  continue: { flexDirection: 'row', gap: 16, padding: 14, borderRadius: 14, alignItems: 'center' },
  continueText: { flex: 1, gap: 4 },
  continueTitle: { fontSize: 18, fontWeight: '600' },
  section: { gap: 12 },
  sectionTitle: { fontSize: 20, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: GAP, rowGap: 20 },
  bookTitle: { marginTop: 8, fontSize: 13, lineHeight: 18 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 80 },
  emptyTitle: { fontSize: 20, fontWeight: '600' },
});
