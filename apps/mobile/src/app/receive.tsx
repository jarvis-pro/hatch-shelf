import type { SessionItem } from '@shelf/spec';
import { router } from 'expo-router';
import { BookDown, ChevronDown, ChevronRight, CircleAlert, DatabaseBackup, Headphones, Highlighter, Laptop, Power, RotateCcw, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getBook, type BookRow } from '@/db/queries';
import { answerRequest, progressOf, startReceiving, stopReceiving, useReceive, type BookTransfer, type Entry, type ReceiveState } from '@/receive/store';
import { openBook } from '@/shelf/actions';
import { BookCover, COVER_RATIO } from '@/shelf/BookCover';
import { categoryLabel } from '@/shelf/categories';
import { Backdrop } from '@/ui/Backdrop';
import { Glass, GlassButton, GlassPill, PrimaryButton } from '@/ui/glass';
import { CrossFade, EASE_OUT_CUBIC, isReduceMotion, ProgressBar } from '@/ui/motion';
import { TransferArt } from '@/ui/TransferArt';
import { useTheme, type Theme } from '@/ui/theme';

/**
 * 接收页（README 第 5.2 节，设计稿「书巢 · 接收模式」）：只负责确认推送、看着书进来。
 * 选书都在电脑上的 Dock 里做；这里关掉（下滑或左上角）不会结束接收，顶部胶囊会接着显示进度。
 */
export default function ReceiveScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const s = useReceive();

  // 接收结束（倒计时到了、空闲超时、点了结束）时离开这一页；刚进来时还没开起来的那一下不算
  const off = s.phase === 'off';
  const [wasOn, setWasOn] = useState(!off);
  if (!off && !wasOn) setWasOn(true);
  // 出错停下时留在这一页显示原因
  const failed = s.error !== null;
  useEffect(() => {
    if (off && wasOn && !failed && router.canGoBack()) router.back();
  }, [off, wasOn, failed]);

  const { index, total } = progressOf(s);
  const books = s.entries.filter((e) => e.type === 'book');
  const status =
    s.phase === 'confirm'
      ? '已连接 · 收到推送请求'
      : s.phase === 'receiving'
        ? `正在接收 · 第 ${index} / ${total} 本`
        : s.phase === 'done'
          ? `接收完成 · ${books.length} 本`
          : off
            ? '没有开启'
            : s.peer
            ? '已连接 · 等待 Dock 推送'
            : '等待电脑连接';

  return (
    <View style={styles.flex}>
      <Backdrop />
      {/* 接收页是卡片式弹出，顶部不在状态栏下面，不用让出安全区 */}
      <View style={[styles.content, { paddingTop: 16, paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.header}>
          <GlassButton icon={ChevronDown} label="收起" onPress={() => router.back()} />
          <Text style={{ color: t.fg, fontSize: 17, fontWeight: '700' }}>从电脑接收</Text>
          {s.phase === 'done' || off ? (
            <View style={{ width: 40 }} />
          ) : (
            <GlassPill
              icon={Power}
              label="结束"
              color={t.danger}
              onPress={() => {
                stopReceiving();
              }}
            />
          )}
        </View>

        <Hero status={status} live={!off} />

        <Glass radius={24} style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={{ color: t.fg, fontSize: 15, fontWeight: '700' }}>本次接收</Text>
            {s.peer && (
              <View style={styles.row6}>
                <Laptop size={13} color={t.fg3} />
                <Text style={{ color: t.fg3, fontSize: 12 }} numberOfLines={1}>
                  {s.peer.name}
                </Text>
              </View>
            )}
          </View>
          {s.phase === 'done' && <Summary s={s} />}
          {off && s.error ? (
            <Failed error={s.error} />
          ) : s.entries.length === 0 && Object.keys(s.books).length === 0 ? (
            <Empty />
          ) : (
            <ScrollView style={styles.flex} showsVerticalScrollIndicator={false}>
              {rowsOf(s).map((r) =>
                r.type === 'book' ? (
                  <BookItem key={r.key} id={r.id} item={s.plan.find((i) => i.id === r.id)} transfer={s.books[r.id]} entry={r.entry} />
                ) : (
                  <OtherRow key={r.key} e={r.entry} />
                ),
              )}
            </ScrollView>
          )}
        </Glass>

        {s.phase === 'done' && <PrimaryButton label="完成" onPress={stopReceiving} />}
      </View>
      <ConfirmSheet s={s} />
    </View>
  );
}

function Hero({ status, live }: { status: string; live: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.hero, { borderColor: t.glassStroke }]}>
      <TransferArt live={live} />
      <Glass radius={17} shadow={false} strong style={styles.status}>
        <CrossFade value={status} style={styles.row6}>
          <View style={[styles.dot, { backgroundColor: live ? t.success : t.fg3 }]} />
          <Text style={{ color: live ? t.successText : t.fg2, fontSize: 12, fontWeight: '600' }}>{status}</Text>
        </CrossFade>
      </Glass>
    </View>
  );
}

function Empty() {
  const t = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: t.fill }]}>
        <BookDown size={24} color={t.fg3} />
      </View>
      <Text style={{ color: t.fg2, fontSize: 14, fontWeight: '600' }}>等待电脑推送</Text>
      <Text style={{ color: t.fg3, fontSize: 12, lineHeight: 19, textAlign: 'center' }}>
        在电脑的 Dock 里勾选书，点「推送」{'\n'}收到的书会出现在这里，并直接放上书架
      </Text>
    </View>
  );
}

/** 接收服务没能开起来（端口被占用、没有本地网络权限） */
function Failed({ error }: { error: string }) {
  const t = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: `${t.danger}14` }]}>
        <CircleAlert size={24} color={t.danger} />
      </View>
      <Text style={{ color: t.fg, fontSize: 14, fontWeight: '600' }}>接收没能开启</Text>
      <Text style={{ color: t.fg3, fontSize: 12, lineHeight: 19, textAlign: 'center' }}>{error}</Text>
      <PrimaryButton icon={RotateCcw} label="重试" onPress={() => void startReceiving()} style={{ alignSelf: 'stretch', marginTop: 8 }} />
    </View>
  );
}

function Summary({ s }: { s: ReceiveState }) {
  const t = useTheme();
  const books = s.entries.filter((e) => e.type === 'book');
  const added = books.filter((e) => e.result.status === 'added').length;
  const updated = books.filter((e) => e.result.status === 'updated').length;
  const audio = books.reduce((n, e) => n + e.audioChapters, 0);
  const stats: [number, string, string][] = [
    [added, '新书', t.accent],
    [updated, '更新', t.teal],
    [audio, '章原声', t.updated],
  ];
  return (
    <View style={styles.stats}>
      {stats.map(([n, label, color]) => (
        <View key={label} style={[styles.stat, { backgroundColor: t.fill }]}>
          <Text style={{ color, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{n}</Text>
          <Text style={{ color: t.fg3, fontSize: 11 }}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

const ITEM_COVER = 44;

/**
 * 书的封面：手机上已有这本书时用本地封面；还没有时用推送请求带来的缩略图，
 * 没有缩略图（书库里没画封面）时按分类画文字封面，和书架上一致
 */
function ItemCover({ id, title, item, width = ITEM_COVER }: { id: string; title: string; item?: SessionItem | null; width?: number }) {
  const t = useTheme();
  const [book, setBook] = useState<BookRow | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void getBook(id).then((b) => alive && setBook(b));
    return () => {
      alive = false;
    };
  }, [id]);
  const radius = width >= 40 ? 6 : 4;
  if (book) return <BookCover book={book} width={width} radius={radius} />;
  // 还在查本地有没有这本书：先占住位置，免得封面闪一下
  if (book === undefined) return <View style={[styles.placeholder, { width, height: Math.round(width * COVER_RATIO), borderRadius: radius, backgroundColor: t.fill }]} />;
  const look = { id, title, subtitle: item?.subtitle ?? null, category: item?.category ?? null };
  return <BookCover book={look} uri={item?.cover} width={width} radius={radius} />;
}

function IconTile({ icon: Icon, color, tint }: { icon: LucideIcon; color: string; tint: string }) {
  return (
    <View style={[styles.iconTile, { backgroundColor: tint }]}>
      <Icon size={20} color={color} />
    </View>
  );
}

/** 带底色的小标签；底色是 tint（默认同文字色）的 8% */
function Tag({ label, color, tint, weight = '700' }: { label: string; color: string; tint?: string; weight?: '600' | '700' }) {
  return (
    <View style={[styles.tag, { backgroundColor: `${tint ?? color}14` }]}>
      <Text style={{ color, fontSize: 11, fontWeight: weight }}>{label}</Text>
    </View>
  );
}

/** 已更新用的绿：浅色模式下文字比底色深一档，保证对比 */
const updatedTag = (t: Theme): [string, string] => [t.dark ? t.success : '#0B7A3B', '#12A150'];

/** 接收中那一行的标签 */
const kindTag = (t: Theme, i: SessionItem): [string, string] =>
  i.kind === 'new' ? ['新书', t.accent] : i.kind === 'update' ? ['更新', updatedTag(t)[0]] : ['原声', t.accent];

/** 确认框右侧的标签：新书 / 有更新 / 补 N 章原声（设计稿 B1） */
const kindLabel = (t: Theme, i: SessionItem): [string, string] =>
  i.kind === 'new'
    ? ['新书', t.accent]
    : i.kind === 'update'
      ? ['有更新', t.dark ? t.updated : '#B26A00']
      : [i.audioChapters ? `补 ${i.audioChapters} 章原声` : '补原声', t.dark ? t.highlight : '#7C4DFF'];

/** 确认框里一本书的元信息：分类 · 章数 · 含原声 · 大小 */
function SheetMeta({ item }: { item: SessionItem }) {
  const t = useTheme();
  const parts: ReactNode[] = [];
  const text = (key: string, v: string) => (
    <Text key={key} style={[styles.sheetMetaText, { color: t.fg3 }]}>
      {v}
    </Text>
  );
  const series = categoryLabel(item.category ?? null);
  if (series) parts.push(text('c', series));
  if (item.kind === 'new' && item.chapters) parts.push(text('n', `${item.chapters} 章`));
  if (item.kind === 'update') parts.push(text('n', '内容有更新'));
  const audio = item.kind === 'audio' ? (item.audioChapters ? `${item.audioChapters} 章原声` : '原声') : item.hasAudio ? '含原声' : null;
  if (audio)
    parts.push(
      <View key="a" style={styles.row3}>
        <Headphones size={11} color={t.fg3} />
        {text('at', audio)}
      </View>,
    );
  if (item.bytes) parts.push(text('b', mb(item.bytes)));
  return (
    <View style={styles.sheetMeta}>
      {parts.flatMap((p, i) => (i ? [text(`d${i}`, '·'), p] : [p]))}
    </View>
  );
}

/** 原声按章一个包传：已经收了 done 章，正在传下一章 */
const audioStep = (item: SessionItem | null | undefined, done: number) =>
  item?.audioChapters ? `第 ${Math.min(done + 1, item.audioChapters)} / ${item.audioChapters} 章` : '原声';

/** 进行中那一行右侧：已收 / 总共 MB 和百分比（设计稿 C） */
function Bytes({ transfer, total }: { transfer: BookTransfer; total?: number }) {
  const t = useTheme();
  return (
    <View style={styles.row4}>
      {total ? (
        <Text style={{ color: t.fg3, fontSize: 11, fontVariant: ['tabular-nums'] }}>
          {mbOf(transfer.received, total)} / {mb(total)}
        </Text>
      ) : null}
      <Text style={{ color: t.accent, fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{Math.round(transfer.ratio * 100)}%</Text>
    </View>
  );
}

type Row =
  | { type: 'book'; key: string; id: string; entry?: Extract<Entry, { type: 'book' }> }
  | { type: 'other'; key: string; entry: Exclude<Entry, { type: 'book' }> };

/**
 * 列表的行：一本书只有一行（书和每章原声合在一起），key 固定是书的 id，
 * 书放上书架前后都是同一行、不会重建；还没放上书架的书排在最上面
 */
function rowsOf(s: ReceiveState): Row[] {
  const placed = new Set(s.entries.flatMap((e) => (e.type === 'book' ? [e.bookId] : [])));
  const pending: Row[] = s.plan.filter((i) => s.books[i.id] && !placed.has(i.id)).map((i) => ({ type: 'book', key: `book:${i.id}`, id: i.id }));
  const rest: Row[] = [...s.entries].reverse().map((e, i) =>
    e.type === 'book' ? { type: 'book', key: `book:${e.bookId}`, id: e.bookId, entry: e } : { type: 'other', key: `other:${s.entries.length - i}`, entry: e },
  );
  return [...pending, ...rest];
}

function BookItem({ id, item, transfer, entry }: { id: string; item?: SessionItem; transfer?: BookTransfer; entry?: Extract<Entry, { type: 'book' }> }) {
  const t = useTheme();
  const receiving = transfer !== undefined && !transfer.done;
  const title = entry?.result.title ?? item?.title ?? id;
  let label: string;
  let color: string;
  let tint: string | undefined;
  let detail: string;
  if (receiving) {
    // 收的过程中标签不变，只换说明文字；进度条是整本书的
    [label, color] = item ? kindTag(t, item) : ['接收中', t.accent];
    // 原声每章收完都会导入一下，这时仍显示第几章，不闪成「放上书架」
    detail =
      transfer.uploading === 'audio'
        ? `${item?.kind === 'audio' ? '' : '原声 '}${audioStep(item, transfer.audioDone)}`
        : transfer.importing
          ? '正在放上书架'
          : '正在接收';
  } else if (entry) {
    const { result, book } = entry;
    const onlyAudio = result.status === 'audio';
    [label, color] = onlyAudio ? ['原声', t.accent] : result.status === 'updated' ? ['已更新', updatedTag(t)[0]] : ['新书', t.accent];
    tint = result.status === 'updated' && !onlyAudio ? updatedTag(t)[1] : undefined;
    detail = [
      ...(onlyAudio
        ? [`补齐 ${entry.audioChapters} 章原声`]
        : [
            result.status === 'updated' ? (item?.detail ?? null) : book && `${book.chapterCount} 章`,
            result.status === 'updated' ? '进度保留' : book && categoryLabel(book.category),
          ]),
      item?.bytes ? mb(item.bytes) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  } else {
    [label, color] = item ? kindTag(t, item) : ['接收中', t.accent];
    detail = item?.detail ?? '';
  }
  const openable = !!entry && !receiving;
  return (
    <Pressable onPress={openable ? () => openBook(id) : undefined} disabled={!openable} style={[styles.item, { borderTopColor: t.hairline }]}>
      <ItemCover id={id} title={title} item={item} />
      <View style={styles.itemText}>
        <Text style={{ color: t.fg, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.row6}>
          <Tag label={label} color={color} tint={tint} />
          <Text style={{ color: t.fg3, fontSize: 12, flexShrink: 1, flexGrow: 1 }} numberOfLines={1}>
            {detail}
          </Text>
          {receiving && <Bytes transfer={transfer} total={item?.bytes} />}
        </View>
        {entry?.result.warnings.map((w) => (
          <Text key={w} style={{ color: t.warn, fontSize: 12 }}>
            {w}
          </Text>
        ))}
        {/* 上传时 JS 线程忙着收文件和导入，动画会跟不上数字；进度本身更新得很密，直接设值 */}
        {receiving && <ProgressBar value={transfer.ratio} animate={false} track={`${t.accent}1F`} fill={t.accent} />}
      </View>
      {openable && <ChevronRight size={16} color={t.fg4} />}
    </Pressable>
  );
}

function OtherRow({ e }: { e: Exclude<Entry, { type: 'book' }> }) {
  const t = useTheme();
  if (e.type === 'log') {
    return (
      <View style={[styles.item, { borderTopColor: t.hairline }]}>
        <IconTile icon={e.log.kind === 'notes' ? Highlighter : DatabaseBackup} color={t.accent} tint={t.accentSoft} />
        <View style={styles.itemText}>
          <Text style={{ color: t.fg, fontSize: 15, fontWeight: '600' }}>{e.log.kind === 'notes' ? '笔记已发给电脑' : '阅读数据已备份到电脑'}</Text>
          <Text style={{ color: t.fg3, fontSize: 12 }}>{e.log.detail}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.item, { borderTopColor: t.hairline }]}>
      <IconTile icon={CircleAlert} color={t.danger} tint={`${t.danger}14`} />
      <View style={styles.itemText}>
        <Text style={{ color: t.fg, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
          {e.fileName}
        </Text>
        <Text style={{ color: t.warn, fontSize: 12 }} numberOfLines={2}>
          没有导入：{e.error}
        </Text>
      </View>
    </View>
  );
}

/** 「8.1 / 13.1 MB」左边那个数：和总量同一单位，不带单位 */
const mbOf = (bytes: number, total: number) => (total < 1024 * 1024 ? `${Math.round(bytes / 1024)}` : (bytes / 1024 / 1024).toFixed(1));

const mb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** Dock 请求推送时从底部升起：列出要推的书，点「开始接收」才开始传 */
function ConfirmSheet({ s }: { s: ReceiveState }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const req = s.request;
  const v = useState(() => new Animated.Value(0))[0];
  const visible = s.phase === 'confirm' && req !== null;
  useEffect(() => {
    if (!visible) return v.setValue(0);
    Animated.timing(v, { toValue: 1, duration: isReduceMotion() ? 0 : 320, easing: EASE_OUT_CUBIC, useNativeDriver: true }).start();
  }, [visible, v]);
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={() => answerRequest(false)}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.dim, opacity: v }]} />
      <Animated.View
        style={[
          styles.sheet,
          { backgroundColor: t.dark ? '#16181FF5' : '#FFFFFF', paddingBottom: Math.max(insets.bottom, 16) },
          { transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [500, 0] }) }] },
        ]}
      >
        <View style={[styles.grabber, { backgroundColor: t.dark ? '#FFFFFF33' : '#1E2A5A26' }]} />
        <View style={styles.sheetHead}>
          <View style={[styles.sheetIcon, { backgroundColor: t.accentSoft }]}>
            <Laptop size={24} color={t.accent} />
          </View>
          <Text style={{ color: t.fg, fontSize: 18, fontWeight: '700', textAlign: 'center' }}>
            {req.peer?.name ?? '电脑'} 想推送 {req.items.length} 本书
          </Text>
          <Text style={{ color: t.fg3, fontSize: 13, textAlign: 'center' }}>约 {mb(req.bytes)} · 收到后直接放上书架</Text>
        </View>
        <View style={[styles.sheetList, { backgroundColor: t.dark ? '#FFFFFF0A' : '#1E2A5A08' }]}>
          <ScrollView>
            {req.items.map((item, i) => {
              const [label, color] = kindLabel(t, item);
              return (
                <View key={item.id} style={[styles.sheetItem, i > 0 && { borderTopWidth: 1, borderTopColor: t.hairline }]}>
                  <ItemCover id={item.id} title={item.title} item={item} width={34} />
                  <View style={styles.sheetInfo}>
                    <View style={styles.row8}>
                      <Text style={{ flex: 1, color: t.fg, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Tag label={label} color={color} weight="600" />
                    </View>
                    {item.subtitle ? (
                      <Text style={{ color: t.fg2, fontSize: 12 }} numberOfLines={1}>
                        {item.subtitle}
                      </Text>
                    ) : null}
                    <SheetMeta item={item} />
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
        <View style={styles.sheetButtons}>
          <Pressable onPress={() => answerRequest(false)} style={[styles.reject, { backgroundColor: t.fill }]}>
            <Text style={{ color: t.fg, fontSize: 16, fontWeight: '600' }}>拒绝</Text>
          </Pressable>
          <View style={styles.flex}>
            <PrimaryButton label="开始接收" onPress={() => answerRequest(true)} />
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 20, gap: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hero: { height: 150, borderRadius: 28, overflow: 'hidden', borderWidth: 1 },
  status: { position: 'absolute', left: 14, bottom: 14, paddingHorizontal: 12, height: 34, justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  row6: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  row8: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: { flex: 1, overflow: 'hidden' },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10, gap: 12 },
  stats: { flexDirection: 'row', gap: 8, paddingHorizontal: 18, paddingBottom: 14 },
  stat: { flex: 1, height: 58, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24 },
  emptyIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, paddingVertical: 10, borderTopWidth: 1 },
  itemText: { flex: 1, gap: 5 },
  iconTile: { width: ITEM_COVER, height: ITEM_COVER, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  placeholder: { borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  tag: { paddingHorizontal: 6, height: 20, borderRadius: 6, justifyContent: 'center' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingTop: 8, paddingHorizontal: 20, gap: 20, maxHeight: '82%' },
  grabber: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: -8 },
  sheetHead: { alignItems: 'center', gap: 6, paddingTop: 6 },
  sheetIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  sheetList: { maxHeight: 300, flexShrink: 1, borderRadius: 18, paddingVertical: 4, overflow: 'hidden' },
  sheetItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  sheetInfo: { flex: 1, gap: 3 },
  sheetMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'nowrap', overflow: 'hidden' },
  sheetMetaText: { fontSize: 11 },
  row3: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  row4: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sheetButtons: { flexDirection: 'row', gap: 12 },
  reject: { flex: 1, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
});
