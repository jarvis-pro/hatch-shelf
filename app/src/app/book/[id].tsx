import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { BookMarked, BookOpen, Check, Ellipsis, Info, Layers, Share, Trash2, TriangleAlert } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import {
  getBook,
  getChapters,
  getReadChapters,
  listBookProgress,
  type BookProgress,
  type BookRow,
  type ChapterRow,
} from '@/db/queries';
import { exportNotes, openBook } from '@/shelf/actions';
import { BookCover, useCoverUri } from '@/shelf/BookCover';
import { DeleteDialog } from '@/shelf/DeleteDialog';
import { Backdrop } from '@/ui/Backdrop';
import { DETAIL_COVER_WIDTH, flyBack, useCoverHidden } from '@/ui/CoverFlight';
import { Glass, GlassButton, PrimaryButton } from '@/ui/glass';
import { Menu } from '@/ui/Menu';
import { FadeInUp } from '@/ui/motion';
import { NavBar } from '@/ui/NavBar';
import { useTheme } from '@/ui/theme';

const LEVEL_LABELS = { beginner: '入门', intermediate: '进阶', advanced: '高级' } as const;
const pad2 = (n: number) => String(n).padStart(2, '0');

export default function BookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const cover = useCoverUri(id);
  const [book, setBook] = useState<BookRow | null>(null);
  const [chapters, setChapters] = useState<ChapterRow[]>([]);
  const [progress, setProgress] = useState<BookProgress | undefined>();
  const [read, setRead] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // 封面在飞行时先藏起这里的封面
  const coverHidden = useCoverHidden(id);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const [b, chs, all] = await Promise.all([getBook(id), getChapters(id), listBookProgress()]);
        const p = all.get(id);
        setBook(b);
        setChapters(chs);
        setProgress(p);
        setRead(await getReadChapters(id, p?.chapterIdx ?? 0));
      })();
    }, [id]),
  );

  if (!book) return <View style={{ flex: 1, backgroundColor: t.bg }} />;

  const showInfo = () => {
    const rows = [
      ['分类', book.category],
      ['难度', book.level && LEVEL_LABELS[book.level]],
      ['标签', book.tags.join('、') || null],
      ['内容更新', book.updatedAt],
      ['导入时间', new Date(book.importedAt).toLocaleString()],
      ['ID', book.id],
    ].filter((r): r is [string, string] => !!r[1]);
    Alert.alert(book.title, rows.map(([k, v]) => `${k}：${v}`).join('\n'));
  };

  const exportOrExplain = async () => {
    if (!(await exportNotes(id))) Alert.alert('还没有笔记', '阅读时长按选中文字，在菜单里选「高亮」或「笔记」。');
  };

  // 当前章节读到的比例，画在目录的进度环里
  const current = progress && !progress.finished ? progress.chapterIdx : -1;
  const ring = progress ? Math.max(0.08, progress.ratio * book.chapterCount - progress.chapterIdx) : 0;

  return (
    <View style={styles.flex}>
      <Backdrop cover={cover} glows={false} />
      <NavBar
        onBack={() => flyBack(book, () => router.back())}
        right={<GlassButton icon={Ellipsis} label="更多" onPress={() => setMenu(true)} />}
      />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        <FadeInUp style={styles.hero}>
          <BookCover book={book} width={DETAIL_COVER_WIDTH} radius={14} elevation={2} style={coverHidden && { opacity: 0 }} />
          <View style={styles.titles}>
            <Text style={[styles.title, { color: t.fg }]}>{book.title}</Text>
            {book.subtitle && <Text style={[styles.subtitle, { color: t.fg2 }]}>{book.subtitle}</Text>}
          </View>
          <View style={styles.chips}>
            <Chip icon={Layers} label={`${book.chapterCount} 章`} />
            {progress && <Chip icon={BookMarked} label={progress.finished ? '已读完' : `已读 ${Math.round(progress.ratio * 100)}%`} />}
          </View>
        </FadeInUp>

        <FadeInUp index={1}>
          <PrimaryButton
            icon={BookOpen}
            label={!progress ? '开始阅读' : progress.finished ? '重新阅读' : `继续阅读 · 第 ${progress.chapterIdx + 1} 章`}
            onPress={() => openBook(id, progress?.finished ? chapters[0]?.file : undefined)}
          />
        </FadeInUp>

        {book.warnings.length > 0 && (
          <FadeInUp index={2}>
            <Glass radius={20} style={styles.warnings}>
              {book.warnings.map((w) => (
                <View key={w} style={styles.warning}>
                  <TriangleAlert size={14} color={t.warn} style={{ marginTop: 2 }} />
                  <Text style={{ color: t.fg2, fontSize: 13, lineHeight: 19, flex: 1 }}>{w}</Text>
                </View>
              ))}
            </Glass>
          </FadeInUp>
        )}

        <FadeInUp index={2}>
          <Glass radius={24} style={styles.toc}>
            <View style={styles.tocHead}>
              <Text style={{ color: t.fg, fontSize: 15, fontWeight: '700' }}>目录</Text>
              <Text style={{ color: t.fg3, fontSize: 12 }}>
                已读 {read.size} / {chapters.length}
              </Text>
            </View>
            {chapters.map((ch, i) => {
              const done = read.has(ch.file) && i !== current;
              const on = i === current;
              return (
                <Pressable
                  key={ch.file}
                  onPress={() => openBook(id, ch.file)}
                  style={({ pressed }) => [styles.row, on && { backgroundColor: `${t.accent}0F` }, pressed && { backgroundColor: t.fill }]}
                >
                  <Text style={[styles.no, { color: on ? t.accent : t.fg4 }]}>{pad2(i + 1)}</Text>
                  <Text
                    style={{ flex: 1, fontSize: 14, color: done ? t.fg3 : t.fg, fontWeight: on ? '600' : '400' }}
                    numberOfLines={1}
                  >
                    {ch.title}
                  </Text>
                  {done && <Check size={16} color={t.dark ? t.fg3 : '#9AA6C4'} />}
                  {on && <Ring ratio={ring} color={t.accent} />}
                </Pressable>
              );
            })}
          </Glass>
        </FadeInUp>
      </ScrollView>

      <Menu
        visible={menu}
        top={insets.top + 52}
        onClose={() => setMenu(false)}
        items={[
          { label: '书籍信息', icon: Info, onPress: showInfo },
          { label: '导出笔记', icon: Share, onPress: () => void exportOrExplain() },
          { label: '从书架删除', icon: Trash2, destructive: true, onPress: () => setDeleting(true) },
        ]}
      />
      <DeleteDialog book={book} visible={deleting} onClose={() => setDeleting(false)} onDeleted={() => router.back()} />
    </View>
  );
}

function Chip({ icon: Icon, label }: { icon: typeof Layers; label: string }) {
  const t = useTheme();
  return (
    <Glass radius={14} shadow={false} style={styles.chip}>
      <Icon size={13} color={t.fg2} />
      <Text style={{ color: t.fg2, fontSize: 12, fontWeight: '500' }}>{label}</Text>
    </Glass>
  );
}

/** 当前章节的阅读进度环 */
function Ring({ ratio, color }: { ratio: number; color: string }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18">
      <Circle cx={9} cy={9} r={r} stroke={`${color}26`} strokeWidth={2.5} fill="none" />
      <Circle
        cx={9}
        cy={9}
        r={r}
        stroke={color}
        strokeWidth={2.5}
        fill="none"
        strokeDasharray={`${c * Math.min(1, ratio)} ${c}`}
        strokeLinecap="round"
        transform="rotate(-90 9 9)"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { paddingHorizontal: 20, paddingTop: 14 },
  hero: { alignItems: 'center' },
  titles: { alignItems: 'center', gap: 6, paddingTop: 26 },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.3, textAlign: 'center' },
  subtitle: { fontSize: 14, textAlign: 'center' },
  chips: { flexDirection: 'row', gap: 8, paddingTop: 16, paddingBottom: 22 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, height: 29 },
  warnings: { marginTop: 22, padding: 16, gap: 8 },
  warning: { flexDirection: 'row', gap: 8 },
  toc: { marginTop: 22, paddingVertical: 6 },
  tocHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, height: 44 },
  no: { width: 20, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
