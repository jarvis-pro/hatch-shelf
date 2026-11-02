import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listBookProgress, listBooks, type BookProgress, type BookRow } from '@/db/queries';
import { seriesLabel, seriesOf } from '@/shelf/categories';
import { ShelfBook } from '@/shelf/ShelfBook';
import { Backdrop } from '@/ui/Backdrop';
import { FadeInUp } from '@/ui/motion';
import { NavBar } from '@/ui/NavBar';
import { useTheme } from '@/ui/theme';

const PAD = 20;
const GAP = 14;
const COLUMNS = 3;

/** 书架分区的「全部」：一个系列下的所有书，三列网格 */
export default function CategoryScreen() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [books, setBooks] = useState<BookRow[]>([]);
  const [progress, setProgress] = useState<Map<string, BookProgress>>(new Map());

  useFocusEffect(
    useCallback(() => {
      void Promise.all([listBooks(), listBookProgress()]).then(([all, p]) => {
        setBooks(all.filter((b) => seriesOf(b.category) === name));
        setProgress(p);
      });
    }, [name]),
  );

  const bookWidth = Math.floor((Math.min(width, 700) - PAD * 2 - GAP * (COLUMNS - 1)) / COLUMNS);

  return (
    <View style={styles.flex}>
      <Backdrop />
      <NavBar />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.head}>
          <Text style={[styles.title, { color: t.fg }]}>{seriesLabel(name)}</Text>
          <Text style={{ color: t.fg3, fontSize: 13 }}>{books.length} 本</Text>
        </View>
        <View style={styles.grid}>
          {books.map((b, i) => (
            <FadeInUp key={b.id} index={i}>
              <ShelfBook book={b} progress={progress.get(b.id)} width={bookWidth} />
            </FadeInUp>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: PAD, paddingTop: 12, gap: 20 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: GAP, rowGap: 24 },
});
