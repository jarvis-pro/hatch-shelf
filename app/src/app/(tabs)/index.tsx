import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { ChevronRight, Plus, Search } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getChapters, listBookProgress, listBooks, type BookProgress, type BookRow } from '@/db/queries';
import { pickAndImport } from '@/import/incoming';
import { useLibraryChanged } from '@/library/events';
import { rebuildIndex } from '@/library/index-books';
import { BookCover } from '@/shelf/BookCover';
import { compareSeries, seriesLabel, seriesOf } from '@/shelf/categories';
import { EmptyShelf } from '@/shelf/EmptyShelf';
import { openBook, peekBook } from '@/shelf/actions';
import { ShelfBook } from '@/shelf/ShelfBook';
import { Backdrop } from '@/ui/Backdrop';
import { Glass, GlassButton } from '@/ui/glass';
import { FadeInUp, PressScale, ProgressBar, useFirstEntry } from '@/ui/motion';
import { PageHeader } from '@/ui/PageHeader';
import { PullIndicator, usePullRefresh } from '@/ui/PullRefresh';
import { TAB_BAR_SPACE } from '@/ui/TabBar';
import { useTheme } from '@/ui/theme';

const ART = require('../../../assets/images/shelf-background.jpg');
const BOOK_WIDTH = 132;

interface ContinueInfo {
  book: BookRow;
  progress: BookProgress;
  chapterTitle: string;
}

export default function ShelfScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [books, setBooks] = useState<BookRow[] | null>(null);
  const [progress, setProgress] = useState<Map<string, BookProgress>>(new Map());
  const [recent, setRecent] = useState<ContinueInfo | null>(null);
  const playProgress = useFirstEntry('shelf-progress');

  const load = useCallback(async () => {
    const [all, prog] = await Promise.all([listBooks(), listBookProgress()]);
    setBooks(all);
    setProgress(prog);
    // 继续阅读：最近读过、还没读完的一本
    const last = all
      .filter((b) => b.lastReadAt && prog.has(b.id) && !prog.get(b.id)!.finished)
      .sort((a, b) => b.lastReadAt! - a.lastReadAt!)[0];
    if (!last) return setRecent(null);
    const p = prog.get(last.id)!;
    const chapters = await getChapters(last.id);
    setRecent({ book: last, progress: p, chapterTitle: chapters[p.chapterIdx]?.title ?? '' });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useLibraryChanged(useCallback(() => void load(), [load]));

  // 下拉时重新扫描 books/，修正被外部改动过的索引
  const pull = usePullRefresh(
    useCallback(async () => {
      await rebuildIndex();
      await load();
    }, [load]),
  );

  const sections = useMemo(() => {
    const map = new Map<string, BookRow[]>();
    for (const b of books ?? []) {
      const key = seriesOf(b.category);
      map.set(key, [...(map.get(key) ?? []), b]);
    }
    return [...map].sort(([a], [b]) => compareSeries(a, b));
  }, [books]);

  const header = (
    <PageHeader
      title="书架"
      right={
        books?.length !== 0 && (
          <>
            <GlassButton icon={Search} label="搜索" onPress={() => router.push('/search')} />
            <GlassButton icon={Plus} label="从文件导入" onPress={() => void pickAndImport()} />
          </>
        )
      }
    />
  );

  return (
    <View style={styles.flex}>
      <Backdrop art={ART} />
      <Animated.ScrollView
        {...pull.scrollProps}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 6, paddingBottom: TAB_BAR_SPACE + 20 }]}
        showsVerticalScrollIndicator={false}
      >
        {header}
        {books?.length === 0 && <EmptyShelf />}
        {recent && (
          <FadeInUp index={0}>
            <ContinueCard info={recent} animate={playProgress} />
          </FadeInUp>
        )}
        {sections.map(([series, list], i) => {
          const first = sections.slice(0, i).reduce((n, [, l]) => n + l.length, 0);
          return (
            <FadeInUp key={series} index={i + 1} style={styles.section}>
              <View style={styles.sectionHead}>
                <View style={styles.sectionTitle}>
                  <Text style={[styles.sectionName, { color: t.fg }]}>{seriesLabel(series)}</Text>
                  <Text style={[styles.count, { color: t.fg3 }]}>{list.length} 本</Text>
                </View>
                {list.length > 2 && (
                  <PressScale
                    style={styles.all}
                    hitSlop={10}
                    onPress={() => router.push({ pathname: '/category/[name]', params: { name: series } })}
                  >
                    <Text style={{ color: t.fg2, fontSize: 13 }}>全部</Text>
                    <ChevronRight size={14} color={t.fg2} />
                  </PressScale>
                )}
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.rowScroll}
                contentContainerStyle={styles.row}
                decelerationRate="fast"
                snapToInterval={BOOK_WIDTH + 14}
              >
                {list.map((b, j) => (
                  <ShelfBook
                    key={b.id}
                    book={b}
                    progress={progress.get(b.id)}
                    width={BOOK_WIDTH}
                    animateProgress={playProgress}
                    index={first + j + 1}
                  />
                ))}
              </ScrollView>
            </FadeInUp>
          );
        })}
      </Animated.ScrollView>
      <PullIndicator scrollY={pull.scrollY} phase={pull.phase} top={insets.top} />
    </View>
  );
}

function ContinueCard({ info, animate }: { info: ContinueInfo; animate: boolean }) {
  const t = useTheme();
  const { book, progress, chapterTitle } = info;
  return (
    <PressScale onPress={() => openBook(book.id)} onLongPress={() => peekBook(book.id)}>
      <Glass radius={26} style={styles.continue}>
        <BookCover book={book} width={108} radius={10} elevation={2} />
        <View style={styles.continueInfo}>
          <View style={{ gap: 6 }}>
            <View style={styles.label}>
              <View style={[styles.dot, { backgroundColor: t.accent }]} />
              <Text style={{ color: t.accent, fontSize: 12, fontWeight: '600' }}>继续阅读</Text>
            </View>
            <Text style={[styles.continueTitle, { color: t.fg }]} numberOfLines={2}>
              {book.title}
            </Text>
            <Text style={{ color: t.fg2, fontSize: 13, lineHeight: 19 }} numberOfLines={2}>
              第 {progress.chapterIdx + 1} 章 · {chapterTitle}
            </Text>
          </View>
          <View style={{ gap: 8 }}>
            <View style={styles.meta}>
              <Text style={{ color: t.fg, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
                {Math.round(progress.ratio * 100)}%
              </Text>
              <Text style={{ color: t.fg3, fontSize: 11 }}>
                第 {progress.chapterIdx + 1} / {book.chapterCount} 章
              </Text>
            </View>
            <ProgressBar
              value={progress.ratio}
              animate={animate}
              track={t.track}
              fill={<LinearGradient colors={[t.accent, t.accent2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />}
            />
          </View>
        </View>
      </Glass>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, gap: 24 },
  continue: { flexDirection: 'row', padding: 16, gap: 18 },
  continueInfo: { flex: 1, justifyContent: 'space-between' },
  label: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  continueTitle: { fontSize: 21, fontWeight: '700', letterSpacing: -0.2 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  section: { gap: 14 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  sectionName: { fontSize: 18, fontWeight: '700' },
  count: { fontSize: 12 },
  all: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  // 横向滚动延伸到屏幕边缘，封面阴影不被裁掉
  rowScroll: { marginHorizontal: -20, marginVertical: -16 },
  row: { paddingHorizontal: 20, paddingVertical: 16, gap: 14 },
});
