import * as Haptics from 'expo-haptics';
import { AudioLines, Check, Minus, NotebookPen, Trash } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listBookProgress, listBooks, type BookProgress, type BookRow } from '@/db/queries';
import { deleteBooks } from '@/library/books';
import { useLibraryChanged } from '@/library/events';
import { formatBytes } from '@/library/size-format';
import { cachedSizes, measureSizes } from '@/library/sizes';
import { BatchDeleteDialog } from '@/manage/BatchDeleteDialog';
import { StorageRing, useRingSweep } from '@/manage/StorageRing';
import { countHighlightsByBook } from '@/notes/store';
import { BookCover } from '@/shelf/BookCover';
import { seriesOf, sortSeries } from '@/shelf/categories';
import { readState } from '@/shelf/progress';
import { Backdrop } from '@/ui/Backdrop';
import { Glass } from '@/ui/glass';
import { PressScale, useReduceMotion } from '@/ui/motion';
import { NavBar } from '@/ui/NavBar';
import { useTheme, type Theme } from '@/ui/theme';

/** 圆环与分组的分类色，按书架上的系列顺序依次取用 */
const SERIES_COLORS = ['#2F6BFF', '#8B6CFF', '#18A57B', '#FF8A3D', '#E5484D', '#C2930C', '#0EA5C6', '#D946A8'];

interface Group {
  name: string;
  color: string;
  books: BookRow[];
}

/**
 * 按系列分组，顺序与书架一致。colors 记住本次进入页面时各系列分到的颜色：
 * 删掉一整个系列后其余系列不换色
 */
function groupBooks(books: BookRow[], colors = new Map<string, string>()): Group[] {
  const map = new Map<string, BookRow[]>();
  for (const b of books) {
    const s = seriesOf(b.category);
    map.set(s, [...(map.get(s) ?? []), b]);
  }
  return sortSeries([...map]).map(([name, list]) => {
    if (!colors.has(name)) colors.set(name, SERIES_COLORS[colors.size % SERIES_COLORS.length]);
    return { name, color: colors.get(name)!, books: list };
  });
}

/** 进入页面时从数据库读到的书目和每本书的阅读状态、笔记数（都是很快的查询） */
interface Shelf {
  books: BookRow[];
  progress: Map<string, BookProgress>;
  notes: Map<string, number>;
}

/** 只在值变了时换一个新 Map：缓存命中后的静默刷新大多不变，不必逐本重渲染 */
const withSize = (id: string, bytes: number) => (prev: Map<string, number>) => (prev.get(id) === bytes ? prev : new Map(prev).set(id, bytes));

/**
 * 书籍管理（设置 → 书籍管理）：专为批量删除。页面常驻勾选态，分类标题可整类勾选。
 * 书目一读出来就渲染，每本书的大小在原生后台线程异步统计，统计中可以照常勾选；
 * 结果按内容指纹缓存，下次进入直接显示并静默刷新原声大小。
 */
export default function ManageScreen() {
  const [shelf, setShelf] = useState<Shelf | null>(null);
  /** 书目录的大小 */
  const [bookSizes, setBookSizes] = useState<Map<string, number>>(new Map());
  /** 原声录音的大小（0 为没有原声）；不在书目录下，单独统计后加进每本书的大小 */
  const [audio, setAudio] = useState<Map<string, number>>(new Map());
  /** 第一次进入时是否全部命中缓存：命中就直接显示结果，不播统计动画 */
  const [instant, setInstant] = useState<boolean | null>(null);
  const signal = useRef({ cancelled: false });

  const run = useCallback(() => {
    signal.current.cancelled = true;
    const current = { cancelled: false };
    signal.current = current;
    void (async () => {
      const books = await listBooks();
      const [cached, progress, notes] = await Promise.all([cachedSizes(books), listBookProgress(), countHighlightsByBook(books.map((b) => b.id))]);
      if (current.cancelled) return;
      setShelf({ books, progress, notes });
      setBookSizes(cached.known);
      setAudio(cached.audio);
      setInstant((prev) => prev ?? cached.missing.length === 0);
      // 没缓存的先统计，按系列顺序，色段才能一段接一段扫入；有缓存的随后只静默刷新原声
      const rank = new Map(groupBooks(books).flatMap((g, i) => g.books.map((b) => [b.id, i] as const)));
      const missing = new Set(cached.missing);
      const order = books.map((b) => b.id).sort((a, b) => Number(!missing.has(a)) - Number(!missing.has(b)) || (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
      await measureSizes(
        books,
        order,
        cached,
        (id, bytes, audioBytes) => {
          setBookSizes(withSize(id, bytes));
          setAudio(withSize(id, audioBytes));
        },
        current,
      );
    })().catch((e: Error) => console.warn('[sizes] 统计失败', e));
  }, []);

  useEffect(() => {
    run();
    const s = signal;
    return () => {
      s.current.cancelled = true;
    };
  }, [run]);
  useLibraryChanged(run);

  return (
    <View style={styles.flex}>
      <Backdrop />
      {shelf && instant !== null ? <Content shelf={shelf} bookSizes={bookSizes} audio={audio} instant={instant} /> : <NavBar title="书籍管理" />}
    </View>
  );
}

interface ContentProps {
  shelf: Shelf;
  bookSizes: Map<string, number>;
  audio: Map<string, number>;
  instant: boolean;
}

function Content({ shelf: { books, progress, notes }, bookSizes, audio, instant }: ContentProps) {
  const t = useTheme();
  /** 书和原声都统计完的书才有大小 */
  const sizes = useMemo(() => {
    const total = new Map<string, number>();
    for (const [id, bytes] of bookSizes) {
      const a = audio.get(id);
      if (a !== undefined) total.set(id, bytes + a);
    }
    return total;
  }, [audio, bookSizes]);
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const [picked, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);

  const [colors] = useState(() => new Map<string, string>());
  const groups = useMemo(() => groupBooks(books, colors), [books, colors]);
  const sizeOf = (bs: BookRow[]) => bs.reduce((s, b) => s + (sizes.get(b.id) ?? 0), 0);
  const isMeasured = (bs: BookRow[]) => bs.every((b) => sizes.has(b.id));

  /** 从头数起连续统计完的分类数：色段按这个顺序扫入 */
  const pending = groups.findIndex((g) => !isMeasured(g.books));
  const ready = pending === -1 ? groups.length : pending;
  const sweep = useRingSweep(ready, instant);
  const measured = books.filter((b) => sizes.has(b.id)).length;
  const settled = measured === books.length && sweep.revealed >= groups.length && !sweep.sweeping;

  // 已经不在书架上的书（被别处删掉）不算勾选
  const selected = useMemo(() => new Set(books.filter((b) => picked.has(b.id)).map((b) => b.id)), [books, picked]);

  // 骨架的呼吸：整页共用一个值
  const pulse = useState(() => new Animated.Value(1))[0];
  useEffect(() => {
    if (settled || reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [settled, reduce, pulse]);

  const toggle = (ids: string[]) => {
    void Haptics.selectionAsync();
    setSelected((prev) => {
      const next = new Set(prev);
      const all = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const allSelected = books.length > 0 && selected.size === books.length;
  const chosen = books.filter((b) => selected.has(b.id));
  const chosenBytes = isMeasured(chosen) ? sizeOf(chosen) : undefined;

  const remove = async () => {
    setConfirm(false);
    await deleteBooks(chosen.map((b) => b.id));
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSelected(new Set());
  };

  return (
    <>
      <NavBar
        title="书籍管理"
        right={
          books.length > 0 && (
            <PressScale onPress={() => toggle(allSelected ? books.map((b) => b.id) : books.filter((b) => !selected.has(b.id)).map((b) => b.id))} scale={0.95} accessibilityRole="button">
              <Glass radius={20} style={styles.textBtn}>
                <Text style={{ color: t.accent, fontSize: 15, fontWeight: '600' }}>{allSelected ? '取消全选' : '全选'}</Text>
              </Glass>
            </PressScale>
          )
        }
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {books.length === 0 ? (
          <Text style={{ color: t.fg3, fontSize: 14 }}>书架上还没有书。</Text>
        ) : (
          <>
            <Glass radius={22} style={styles.storage}>
              <StorageRing
                segments={groups.map((g) => ({ key: g.name, color: g.color, bytes: sizeOf(g.books) }))}
                sweep={sweep}
                settled={settled}
                measured={measured}
                total={books.length}
              />
              <View style={styles.legend}>
                {groups.map((g, i) => (
                  <View key={g.name} style={styles.legendRow}>
                    <View style={[styles.legendDot, { backgroundColor: i < sweep.revealed ? g.color : t.track }]} />
                    <Text style={[styles.legendName, { color: t.fg2 }]} numberOfLines={1}>
                      {g.name}
                    </Text>
                    {i < sweep.revealed ? <Text style={[styles.num, { color: t.fg }]}>{formatBytes(sizeOf(g.books))}</Text> : <Skeleton t={t} pulse={pulse} />}
                  </View>
                ))}
              </View>
            </Glass>

            {groups.map((g, gi) => {
              const ids = g.books.map((b) => b.id);
              const count = ids.filter((id) => selected.has(id)).length;
              const revealed = gi < sweep.revealed;
              return (
                <View key={g.name} style={styles.group}>
                  <Pressable onPress={() => toggle(ids)} style={styles.groupHead} accessibilityRole="checkbox" accessibilityState={{ checked: count === 0 ? false : count === ids.length ? true : 'mixed' }}>
                    <GroupCheck state={count === 0 ? 'none' : count === ids.length ? 'all' : 'some'} color={g.color} t={t} />
                    <Text style={[styles.groupName, { color: t.fg }]} numberOfLines={1}>
                      {g.name}
                    </Text>
                    <Text style={[styles.groupMeta, { color: t.fg3 }]}>
                      {g.books.length} 本{revealed ? ` · ${formatBytes(sizeOf(g.books))}` : ''}
                    </Text>
                  </Pressable>
                  <Glass radius={22} style={styles.card}>
                    {g.books.map((b, i) => {
                      const on = selected.has(b.id);
                      const size = revealed ? sizes.get(b.id) : undefined;
                      const audioBytes = revealed ? (audio.get(b.id) ?? 0) : 0;
                      const noteCount = notes.get(b.id) ?? 0;
                      const state = readState(progress.get(b.id));
                      return (
                        <Pressable
                          key={b.id}
                          onPress={() => toggle([b.id])}
                          style={({ pressed }) => [styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.hairline }, pressed && { backgroundColor: t.fill }]}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: on }}
                          accessibilityLabel={[b.title, size !== undefined && formatBytes(size), state, noteCount > 0 && `${noteCount} 条笔记`].filter(Boolean).join('，')}
                        >
                          <View style={[styles.check, on ? { backgroundColor: g.color, borderColor: g.color } : { borderColor: t.fg4 }]}>{on && <Check size={13} color="#fff" strokeWidth={3} />}</View>
                          <BookCover book={b} width={26} radius={4} elevation={0}>
                            <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.coverStroke, { borderColor: t.track }]} />
                          </BookCover>
                          <View style={styles.rowText}>
                            <View style={styles.rowLine}>
                              <Text style={[styles.bookTitle, { color: t.fg }]} numberOfLines={1}>
                                {b.title}
                              </Text>
                              {size !== undefined ? <Text style={[styles.num, { color: t.fg2 }]}>{formatBytes(size)}</Text> : <Skeleton t={t} pulse={pulse} />}
                            </View>
                            <View style={styles.meta}>
                              <Text style={[styles.metaText, { color: t.fg3 }]}>{state}</Text>
                              {noteCount > 0 && (
                                <>
                                  <Text style={[styles.metaText, { color: t.fg3 }]}>·</Text>
                                  <View style={styles.notes}>
                                    <NotebookPen size={12} color={t.fg2} strokeWidth={2} />
                                    <Text style={[styles.metaText, { color: t.fg2 }]}>{noteCount} 条笔记</Text>
                                  </View>
                                </>
                              )}
                              {audioBytes > 0 && (
                                <View style={[styles.audioTag, { backgroundColor: t.accentSoft }]}>
                                  <AudioLines size={11} color={t.accent} strokeWidth={2} />
                                  <Text style={[styles.audioTagText, { color: t.accent }]}>原声 {formatBytes(audioBytes)}</Text>
                                </View>
                              )}
                            </View>
                          </View>
                        </Pressable>
                      );
                    })}
                  </Glass>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>

      <DeleteBar count={chosen.length} bytes={chosenBytes} onPress={() => setConfirm(true)} />
      <BatchDeleteDialog books={chosen} bytes={chosenBytes} visible={confirm} onClose={() => setConfirm(false)} onConfirm={() => void remove()} />
    </>
  );
}

function Skeleton({ t, pulse }: { t: Theme; pulse: Animated.Value }) {
  return <Animated.View style={[styles.skeleton, { backgroundColor: t.track, opacity: pulse }]} />;
}

function GroupCheck({ state, color, t }: { state: 'none' | 'some' | 'all'; color: string; t: Theme }) {
  if (state === 'none') return <View style={[styles.groupCheck, { borderWidth: 1.5, borderColor: t.fg4 }]} />;
  return (
    <View style={[styles.groupCheck, { backgroundColor: state === 'all' ? color : `${color}26` }]}>
      {state === 'all' ? <Check size={12} color="#fff" strokeWidth={3} /> : <Minus size={12} color={color} strokeWidth={3} />}
    </View>
  );
}

/** 选中后从底部升起的删除按钮 */
function DeleteBar({ count, bytes, onPress }: { count: number; bytes?: number; onPress(): void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const shown = useState(() => new Animated.Value(0))[0];
  const [label, setLabel] = useState({ count, bytes });
  if (count > 0 && (label.count !== count || label.bytes !== bytes)) setLabel({ count, bytes });

  useEffect(() => {
    Animated.spring(shown, { toValue: count > 0 ? 1 : 0, damping: 20, stiffness: 240, useNativeDriver: true }).start();
  }, [count, shown]);

  return (
    <Animated.View
      pointerEvents={count > 0 ? 'auto' : 'none'}
      style={[
        styles.deleteWrap,
        { bottom: insets.bottom + 12, opacity: shown, transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] },
      ]}
    >
      <PressScale onPress={onPress} style={[styles.deleteBtn, { backgroundColor: t.danger, shadowColor: t.danger }]} accessibilityRole="button">
        <Trash size={17} color="#fff" strokeWidth={2} />
        <Text style={styles.deleteText}>删除 {label.count} 本</Text>
        {label.bytes !== undefined && <Text style={styles.deleteSub}>· 释放 {formatBytes(label.bytes)}</Text>}
      </PressScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 12, gap: 16 },
  textBtn: { height: 40, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  storage: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 16, paddingHorizontal: 18 },
  legend: { flex: 1, gap: 9 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  legendDot: { width: 8, height: 8, borderRadius: 2 },
  legendName: { flex: 1, fontSize: 13 },
  num: { fontSize: 12, fontWeight: '500', fontVariant: ['tabular-nums'] },
  skeleton: { width: 40, height: 10, borderRadius: 5 },
  group: { gap: 8 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, minHeight: 28 },
  groupCheck: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  groupName: { flex: 1, fontSize: 14, fontWeight: '600' },
  groupMeta: { fontSize: 12, fontVariant: ['tabular-nums'] },
  card: { paddingVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, minHeight: 56 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  coverStroke: { borderRadius: 4, borderWidth: 1 },
  rowText: { flex: 1, gap: 3 },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bookTitle: { flex: 1, fontSize: 15 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12 },
  notes: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  audioTag: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, marginLeft: 2 },
  audioTagText: { fontSize: 10, fontWeight: '500', fontVariant: ['tabular-nums'] },
  deleteWrap: { position: 'absolute', left: 20, right: 20 },
  deleteBtn: {
    height: 56,
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 10 },
  },
  deleteText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  deleteSub: { color: '#FFFFFFCC', fontSize: 14, fontVariant: ['tabular-nums'] },
});
