import * as Haptics from 'expo-haptics';
import { Check, Minus, Trash } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listBooks, type BookRow } from '@/db/queries';
import { deleteBooks } from '@/library/books';
import { useLibraryChanged } from '@/library/events';
import { formatBytes } from '@/library/size-format';
import { cachedSizes, measureSizes } from '@/library/sizes';
import { BatchDeleteDialog } from '@/manage/BatchDeleteDialog';
import { StorageRing, useRingSweep } from '@/manage/StorageRing';
import { seriesOf, sortSeries } from '@/shelf/categories';
import { Backdrop } from '@/ui/Backdrop';
import { Glass } from '@/ui/glass';
import { EASE_OUT_CUBIC, PressScale, useReduceMotion } from '@/ui/motion';
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

/**
 * 书籍管理（设置 → 书籍管理）：专为批量删除。页面常驻勾选态，分类标题可整类勾选。
 * 每本书的大小异步统计，统计中可以照常勾选；结果按内容指纹缓存，下次进入直接显示。
 */
export default function ManageScreen() {
  const [books, setBooks] = useState<BookRow[] | null>(null);
  const [sizes, setSizes] = useState<Map<string, number>>(new Map());
  /** 第一次进入时是否全部命中缓存：命中就直接显示结果，不播统计动画 */
  const [instant, setInstant] = useState<boolean | null>(null);
  const signal = useRef({ cancelled: false });

  const run = useCallback(() => {
    signal.current.cancelled = true;
    const current = { cancelled: false };
    signal.current = current;
    void (async () => {
      const all = await listBooks();
      const { known, missing } = await cachedSizes(all);
      if (current.cancelled) return;
      setBooks(all);
      setSizes(known);
      setInstant((prev) => prev ?? missing.length === 0);
      // 按系列顺序统计，色段才能一段接一段扫入
      const order = new Map(groupBooks(all).flatMap((g, i) => g.books.map((b) => [b.id, i] as const)));
      missing.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
      await measureSizes(all, missing, known, (id, bytes) => setSizes((prev) => new Map(prev).set(id, bytes)), current);
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
      {books && instant !== null ? <Content books={books} sizes={sizes} instant={instant} /> : <NavBar />}
    </View>
  );
}

function Content({ books, sizes, instant }: { books: BookRow[]; sizes: Map<string, number>; instant: boolean }) {
  const t = useTheme();
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
  const maxSize = Math.max(1, ...sizes.values());

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
        <Text style={[styles.title, { color: t.fg }]} accessibilityRole="header">
          书籍管理
        </Text>

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
                      return (
                        <Pressable
                          key={b.id}
                          onPress={() => toggle([b.id])}
                          style={({ pressed }) => [styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.hairline }, pressed && { backgroundColor: t.fill }]}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: on }}
                          accessibilityLabel={size !== undefined ? `${b.title}，${formatBytes(size)}` : b.title}
                        >
                          <View style={[styles.check, on ? { backgroundColor: g.color, borderColor: g.color } : { borderColor: t.fg4 }]}>{on && <Check size={13} color="#fff" strokeWidth={3} />}</View>
                          <View style={styles.rowText}>
                            <View style={styles.rowLine}>
                              <Text style={[styles.bookTitle, { color: t.fg }]} numberOfLines={1}>
                                {b.title}
                              </Text>
                              {size !== undefined ? <Text style={[styles.num, { color: t.fg2 }]}>{formatBytes(size)}</Text> : <Skeleton t={t} pulse={pulse} />}
                            </View>
                            <View style={[styles.track, { backgroundColor: t.fill }]}>
                              {size !== undefined && <SizeBar ratio={size / maxSize} color={on ? g.color : `${g.color}59`} animate={!instant && !reduce} />}
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

/** 每行的大小比例条：统计出结果时从左向右长出来 */
function SizeBar({ ratio, color, animate }: { ratio: number; color: string; animate: boolean }) {
  const grow = useState(() => new Animated.Value(animate ? 0 : 1))[0];
  useEffect(() => {
    if (animate) Animated.timing(grow, { toValue: 1, duration: 360, easing: EASE_OUT_CUBIC, useNativeDriver: false }).start();
  }, [animate, grow]);
  const width = grow.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${Math.max(2, ratio * 100)}%`] });
  return <Animated.View style={[styles.bar, { width, backgroundColor: color }]} />;
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
  content: { paddingHorizontal: 20, paddingTop: 6, gap: 16 },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, minHeight: 56 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 7 },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bookTitle: { flex: 1, fontSize: 15 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  bar: { height: 4, borderRadius: 2 },
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
