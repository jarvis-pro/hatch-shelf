import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { AudioLines, BookOpen, Check, ChevronRight, Ellipsis, NotebookPen, Share, Trash2, TriangleAlert } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
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
import { audioBytes, deleteAudio } from '@/library/audio';
import { formatBytes } from '@/library/size-format';
import { exportNotes, openBook, openNotes } from '@/shelf/actions';
import { AudioBadge } from '@/shelf/AudioBadge';
import { BookCover, useCoverUri } from '@/shelf/BookCover';
import { DeleteDialog } from '@/shelf/DeleteDialog';
import { UpdatedTag } from '@/shelf/UpdatedTag';
import { Backdrop } from '@/ui/Backdrop';
import {
  DETAIL_ACTION_HEIGHT,
  DETAIL_CARD_HEIGHT,
  DETAIL_COVER_RADIUS,
  DETAIL_STRIP_HEAD,
  detailBottomInset,
  detailCoverRect,
  flyBack,
  useCoverHidden,
} from '@/ui/CoverFlight';
import { Glass, GlassButton, PrimaryButton } from '@/ui/glass';
import { Menu } from '@/ui/Menu';
import { FadeInUp, PressScale } from '@/ui/motion';
import { NavBar } from '@/ui/NavBar';
import { Panel, PanelScrollView } from '@/ui/Panel';
import { useTheme, type Theme } from '@/ui/theme';

const LEVEL_LABELS = { beginner: '入门', intermediate: '进阶', advanced: '高级' } as const;
const pad2 = (n: number) => String(n).padStart(2, '0');

const CARD_WIDTH = 132;
/** 在读的那张卡加宽，放本章进度 */
const CURRENT_CARD_WIDTH = 156;
const CARD_GAP = 10;
const STRIP_PAD = 24;

/** 书籍详情（长按书架上的书进入）：大封面 + 横滑章节卡 + 继续阅读；「全部」展开完整目录 */
export default function BookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const cover = useCoverUri(id);
  const [book, setBook] = useState<BookRow | null>(null);
  const [chapters, setChapters] = useState<ChapterRow[]>([]);
  const [progress, setProgress] = useState<BookProgress | undefined>();
  const [read, setRead] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState(false);
  const [toc, setToc] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** 本书原声占用的空间；没有原声为 0 */
  const [audio, setAudio] = useState(0);
  // 封面在飞行时先藏起这里的封面
  const coverHidden = useCoverHidden(id);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const [b, chs, all] = await Promise.all([getBook(id), getChapters(id), listBookProgress()]);
        const p = all.get(id);
        setBook(b);
        setAudio(audioBytes(id));
        setChapters(chs);
        setProgress(p);
        setRead(await getReadChapters(id, p?.chapterIdx ?? 0));
      })();
    }, [id]),
  );

  if (!book) return <View style={{ flex: 1, backgroundColor: t.bg }} />;

  const rect = detailCoverRect(insets, screen);
  const current = progress && !progress.finished ? progress.chapterIdx : -1;
  // 当前章节读到的比例
  const inChapter = progress ? Math.min(1, Math.max(0, progress.ratio * book.chapterCount - progress.chapterIdx)) : 0;
  const updatedCount = chapters.filter((ch) => ch.updated).length;
  const state = !progress ? `${chapters.length} 章 · 新书` : progress.finished ? '已读完' : `已读 ${read.size} / ${chapters.length}`;

  const confirmDeleteAudio = () =>
    Alert.alert('删除本书原声？', `释放 ${formatBytes(audio)}。书和笔记都保留，听书改用系统语音。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          deleteAudio(id);
          setAudio(0);
        },
      },
    ]);

  const exportOrExplain = async () => {
    if (!(await exportNotes(id))) Alert.alert('还没有笔记', '阅读时长按选中文字，在菜单里选「高亮」或「笔记」。');
  };

  const open = (file?: string) => {
    setToc(false);
    openBook(id, file);
  };

  return (
    <View style={styles.flex}>
      <Backdrop cover={cover} glows={false} />
      <NavBar
        onBack={() => flyBack(book, () => router.back())}
        right={<GlassButton icon={Ellipsis} label="更多" onPress={() => setMenu(true)} />}
      />
      <BookCover
        book={book}
        width={rect.width}
        radius={DETAIL_COVER_RADIUS}
        elevation={2}
        style={[styles.cover, { left: rect.x, top: rect.y }, coverHidden && { opacity: 0 }]}
      >
        {audio > 0 && <AudioBadge scale={1.4} inset={14} />}
      </BookCover>

      <View style={[styles.bottom, { bottom: detailBottomInset(insets) }]}>
        <FadeInUp index={1} delay={80}>
          <View style={styles.stripHead}>
            <Text style={{ color: t.fg, fontSize: 14, fontWeight: '700' }}>目录</Text>
            <Text style={{ color: t.fg3, fontSize: 12 }}>{state}</Text>
            {updatedCount > 0 && <UpdatedBadge count={updatedCount} />}
            <View style={styles.flex} />
            <PressScale style={styles.all} hitSlop={10} onPress={() => setToc(true)} accessibilityRole="button">
              <Text style={{ color: t.fg2, fontSize: 12 }}>全部</Text>
              <ChevronRight size={14} color={t.fg2} />
            </PressScale>
          </View>
        </FadeInUp>
        <FadeInUp index={2} delay={80}>
          <ChapterStrip
            chapters={chapters}
            read={read}
            current={current}
            inChapter={inChapter}
            fresh={!progress}
            screenWidth={screen.width}
            onOpen={(ch) => openBook(id, ch.file)}
          />
        </FadeInUp>
        <FadeInUp index={3} delay={80} style={styles.actions}>
          <View style={styles.flex}>
            <PrimaryButton
              icon={BookOpen}
              label={!progress ? '开始阅读' : progress.finished ? '重新阅读' : `继续阅读 · 第 ${progress.chapterIdx + 1} 章`}
              onPress={() => openBook(id, progress?.finished ? chapters[0]?.file : undefined)}
            />
          </View>
          <PressScale onPress={() => openNotes(id)} accessibilityRole="button" accessibilityLabel="笔记">
            <Glass radius={DETAIL_ACTION_HEIGHT / 2} style={styles.round}>
              <NotebookPen size={20} color={t.fg} />
            </Glass>
          </PressScale>
        </FadeInUp>
      </View>

      <TocSheet
        visible={toc}
        book={book}
        chapters={chapters}
        read={read}
        current={current}
        inChapter={inChapter}
        state={state}
        updatedCount={updatedCount}
        onOpen={(ch) => open(ch.file)}
        onClose={() => setToc(false)}
      />
      <Menu
        visible={menu}
        top={insets.top + 52}
        onClose={() => setMenu(false)}
        items={[
          { label: '导出笔记', icon: Share, onPress: () => void exportOrExplain() },
          ...(audio > 0
            ? [{ label: '删除本书原声', detail: `${formatBytes(audio)} · 书和笔记都保留`, icon: AudioLines, destructive: true, onPress: confirmDeleteAudio }]
            : []),
          { label: '从书架删除', icon: Trash2, destructive: true, onPress: () => setDeleting(true) },
        ]}
      />
      <DeleteDialog book={book} visible={deleting} onClose={() => setDeleting(false)} onDeleted={() => router.back()} />
    </View>
  );
}

function UpdatedBadge({ count }: { count: number }) {
  const t = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: `${t.updated}1A` }]}>
      <View style={[styles.dot, { backgroundColor: t.updated }]} />
      <Text style={{ color: t.updated, fontSize: 10.5, fontWeight: '600' }}>{count} 章更新</Text>
    </View>
  );
}

interface StripProps {
  chapters: ChapterRow[];
  read: Set<string>;
  current: number;
  inChapter: number;
  /** 还没读过：第一张卡写「从这里开始」 */
  fresh: boolean;
  screenWidth: number;
  onOpen(ch: ChapterRow): void;
}

/** 横向滑动的章节卡，默认滚到在读那一章（它前面露出一张） */
function ChapterStrip({ chapters, read, current, inChapter, fresh, screenWidth, onOpen }: StripProps) {
  const t = useTheme();
  const total = chapters.length * (CARD_WIDTH + CARD_GAP) - CARD_GAP + (current >= 0 ? CURRENT_CARD_WIDTH - CARD_WIDTH : 0);
  const max = Math.max(0, total + STRIP_PAD * 2 - screenWidth);
  const x = Math.min(max, Math.max(0, current - 1) * (CARD_WIDTH + CARD_GAP));
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentOffset={{ x, y: 0 }}
      style={styles.stripScroll}
      contentContainerStyle={styles.strip}
    >
      {chapters.map((ch, i) => {
        const on = i === current;
        const start = fresh && i === 0;
        const done = read.has(ch.file) && !on && !ch.updated;
        const label = on ? `读到 ${Math.round(inChapter * 100)}%` : start ? '从这里开始' : null;
        const body = (
          <>
            <View style={styles.cardHead}>
              <Text style={[styles.no, { color: on ? '#FFFFFFB3' : start ? t.accent : t.fg4 }]}>{pad2(i + 1)}</Text>
              <View style={styles.flex} />
              {done && <Check size={13} color={t.dark ? t.fg3 : '#9AA6C4'} />}
              {ch.updated && !on && (
                <>
                  <View style={[styles.dot, { backgroundColor: t.updated }]} />
                  <Text style={{ color: t.updated, fontSize: 9.5, fontWeight: '600' }}>已更新</Text>
                </>
              )}
              {label && <Text style={{ color: on ? '#FFFFFFCC' : t.accent, fontSize: 9.5, fontWeight: '600' }}>{label}</Text>}
            </View>
            <Text
              style={[styles.cardTitle, { color: on ? '#fff' : done ? t.fg3 : t.fg, fontWeight: on ? '600' : '500' }]}
              numberOfLines={2}
            >
              {ch.title}
            </Text>
            {on && (
              <View style={styles.cardTrack}>
                <View style={[styles.cardFill, { width: `${Math.max(4, inChapter * 100)}%` }]} />
              </View>
            )}
          </>
        );
        return (
          <PressScale key={ch.file} onPress={() => onOpen(ch)} accessibilityRole="button" accessibilityLabel={`第 ${i + 1} 章 ${ch.title}`}>
            {on ? (
              <LinearGradient
                colors={[t.accent, t.accent2]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.card, styles.currentCard, { shadowColor: t.accent }]}
              >
                {body}
              </LinearGradient>
            ) : (
              <Glass
                radius={16}
                shadow={false}
                style={[styles.card, done && { opacity: 0.75 }, start && { borderWidth: 1.5, borderColor: `${t.accent}66` }]}
              >
                {body}
              </Glass>
            )}
          </PressScale>
        );
      })}
    </ScrollView>
  );
}

interface TocProps {
  visible: boolean;
  book: BookRow;
  chapters: ChapterRow[];
  read: Set<string>;
  current: number;
  inChapter: number;
  state: string;
  updatedCount: number;
  onOpen(ch: ChapterRow): void;
  onClose(): void;
}

/** 完整目录：从底部弹出；书籍信息和导入提示也放在这里 */
function TocSheet({ visible, book, chapters, read, current, inChapter, state, updatedCount, onOpen, onClose }: TocProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const info = [book.category, book.level && LEVEL_LABELS[book.level], book.updatedAt && `${book.updatedAt} 更新`].filter(Boolean).join(' · ');
  return (
    <Panel visible={visible} side="bottom" onClose={onClose}>
      <View style={[styles.sheet, { maxHeight: height * 0.75, paddingBottom: insets.bottom + 8, shadowColor: t.shadow }]}>
        <SheetBackground t={t} />
        <View style={[styles.grabber, { backgroundColor: t.dark ? '#FFFFFF33' : '#1E2A5A26' }]} />
        <View style={styles.sheetHead}>
          <View style={styles.sheetTitle}>
            <Text style={{ color: t.fg, fontSize: 18, fontWeight: '700' }}>目录</Text>
            <Text style={{ color: t.fg3, fontSize: 12 }}>{state}</Text>
            <View style={styles.flex} />
            {updatedCount > 0 && <UpdatedBadge count={updatedCount} />}
          </View>
          {info !== '' && <Text style={{ color: t.fg3, fontSize: 12 }}>{info}</Text>}
          {book.warnings.map((w) => (
            <View key={w} style={styles.warning}>
              <TriangleAlert size={13} color={t.warn} style={{ marginTop: 2 }} />
              <Text style={{ color: t.fg2, fontSize: 12, lineHeight: 18, flex: 1 }}>{w}</Text>
            </View>
          ))}
        </View>
        <PanelScrollView showsVerticalScrollIndicator={false}>
          {chapters.map((ch, i) => {
            const on = i === current;
            const done = read.has(ch.file) && !on;
            return (
              <Pressable
                key={ch.file}
                onPress={() => onOpen(ch)}
                style={({ pressed }) => [styles.row, on && { backgroundColor: `${t.accent}0F` }, pressed && { backgroundColor: t.fill }]}
              >
                <Text style={[styles.rowNo, { color: on ? t.accent : t.fg4 }]}>{pad2(i + 1)}</Text>
                <View style={styles.rowText}>
                  <Text style={{ fontSize: 15, color: done ? t.fg3 : t.fg, fontWeight: on ? '600' : '400' }} numberOfLines={1}>
                    {ch.title}
                  </Text>
                  {on && <Text style={{ color: t.accent, fontSize: 11 }}>读到 {Math.round(inChapter * 100)}%</Text>}
                </View>
                {ch.updated && <UpdatedTag />}
                {done && !ch.updated && <Check size={16} color={t.dark ? t.fg3 : '#9AA6C4'} />}
                {on && <Ring ratio={Math.max(0.08, inChapter)} color={t.accent} />}
              </Pressable>
            );
          })}
        </PanelScrollView>
      </View>
    </Panel>
  );
}

function SheetBackground({ t }: { t: Theme }) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.sheetClip]}>
      <BlurView intensity={60} tint={t.blurTint} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={t.dark ? ['#1C1F27F2', '#16181FE6'] : ['#F7F8FBF2', '#F7F8FBE6']} style={StyleSheet.absoluteFill} />
    </View>
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
  cover: { position: 'absolute' },
  bottom: { position: 'absolute', left: 0, right: 0, gap: 8 },
  stripHead: { height: DETAIL_STRIP_HEAD, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: STRIP_PAD },
  all: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 9, paddingHorizontal: 7, paddingVertical: 2 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  // 卡片阴影不被裁掉
  stripScroll: { marginVertical: -12 },
  strip: { paddingHorizontal: STRIP_PAD, paddingVertical: 12, gap: CARD_GAP },
  card: { width: CARD_WIDTH, height: DETAIL_CARD_HEIGHT, borderRadius: 16, padding: 12, paddingTop: 11, gap: 6 },
  currentCard: { width: CURRENT_CARD_WIDTH, shadowOpacity: 0.25, shadowRadius: 9, shadowOffset: { width: 0, height: 8 } },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  no: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cardTitle: { fontSize: 13, lineHeight: 17.5 },
  cardTrack: { marginTop: 'auto', height: 3, borderRadius: 1.5, backgroundColor: '#FFFFFF40', overflow: 'hidden' },
  cardFill: { height: 3, borderRadius: 1.5, backgroundColor: '#FFFFFF' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: STRIP_PAD, marginTop: 14 },
  round: { width: DETAIL_ACTION_HEIGHT, height: DETAIL_ACTION_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  sheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 8,
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -8 },
  },
  sheetClip: { borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: 'hidden' },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3 },
  sheetHead: { paddingHorizontal: 22, paddingTop: 14, paddingBottom: 8, gap: 6 },
  sheetTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  warning: { flexDirection: 'row', gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 22, minHeight: 50, paddingVertical: 8 },
  rowNo: { width: 20, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  rowText: { flex: 1, gap: 2 },
});
