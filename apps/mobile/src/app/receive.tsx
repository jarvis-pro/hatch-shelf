import type { SessionItem } from '@shelf/spec';
import { router } from 'expo-router';
import { BookDown, ChevronDown, ChevronRight, CircleAlert, DatabaseBackup, Highlighter, Laptop, Power, RotateCcw, Timer, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getBook, type BookRow } from '@/db/queries';
import { answerRequest, IDLE_MS, progressOf, startReceiving, stopReceiving, useReceive, type Entry, type ReceiveState } from '@/receive/store';
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
      ? '电脑请求推送'
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
      <View style={[styles.content, { paddingTop: 16, paddingBottom: insets.bottom + 12 }]}>
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

        <Hero status={status} height={s.phase === 'done' ? 96 : s.phase === 'receiving' ? 150 : 220} live={!off} />

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
          ) : s.entries.length === 0 && !s.current ? (
            <Empty />
          ) : (
            <ScrollView style={styles.flex} showsVerticalScrollIndicator={false}>
              {/* 已经收到的书再传原声时，进度显示在那本书的行里，不另起一行 */}
              {s.current && !s.entries.some((e) => e.type === 'book' && e.bookId === s.current?.item?.id) && <Uploading current={s.current} />}
              {[...s.entries].reverse().map((e, i) => (
                <EntryRow key={i} e={e} plan={s.plan} current={e.type === 'book' && s.current?.item?.id === e.bookId ? s.current : null} />
              ))}
            </ScrollView>
          )}
        </Glass>

        {s.phase === 'done' ? (
          <View style={{ gap: 10 }}>
            <PrimaryButton label="完成" onPress={stopReceiving} />
            <Text style={[styles.foot, { color: t.fg3 }]}>{s.countdown} 秒后自动结束接收</Text>
          </View>
        ) : (
          <View style={[styles.row6, { justifyContent: 'center' }]}>
            <Timer size={12} color={t.fg3} />
            <Text style={[styles.foot, { color: t.fg3 }]}>屏幕保持常亮 · {IDLE_MS / 60000} 分钟没有动作会自动结束</Text>
          </View>
        )}
      </View>
      <ConfirmSheet s={s} />
    </View>
  );
}

/** 头图：接收中逐步收窄，给列表让出位置 */
function Hero({ status, height, live }: { status: string; height: number; live: boolean }) {
  const t = useTheme();
  const h = useState(() => new Animated.Value(height))[0];
  useEffect(() => {
    if (isReduceMotion()) return h.setValue(height);
    Animated.spring(h, { toValue: height, damping: 20, stiffness: 180, useNativeDriver: false }).start();
  }, [h, height]);
  return (
    <Animated.View style={[styles.hero, { height, borderColor: t.glassStroke }]}>
      <TransferArt live={live} />
      <Glass radius={17} shadow={false} strong style={styles.status}>
        <CrossFade value={status} style={styles.row6}>
          <View style={[styles.dot, { backgroundColor: live ? t.success : t.fg3 }]} />
          <Text style={{ color: live ? t.successText : t.fg2, fontSize: 12, fontWeight: '600' }}>{status}</Text>
        </CrossFade>
      </Glass>
    </Animated.View>
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

/** 书的封面：手机上还没有这本书时画一个带书名首字的占位 */
function ItemCover({ id, title, width = ITEM_COVER }: { id: string; title: string; width?: number }) {
  const t = useTheme();
  const [book, setBook] = useState<BookRow | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void getBook(id).then((b) => alive && setBook(b));
    return () => {
      alive = false;
    };
  }, [id]);
  if (book) return <BookCover book={book} width={width} radius={6} />;
  return (
    <View style={[styles.placeholder, { width, height: Math.round(width * COVER_RATIO), backgroundColor: t.accentSoft }]} accessibilityLabel={title}>
      <BookDown size={Math.round(width / 2.2)} color={t.accent} />
    </View>
  );
}

function IconTile({ icon: Icon, color, tint }: { icon: LucideIcon; color: string; tint: string }) {
  return (
    <View style={[styles.iconTile, { backgroundColor: tint }]}>
      <Icon size={20} color={color} />
    </View>
  );
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.tag, { backgroundColor: `${color}1A` }]}>
      <Text style={{ color, fontSize: 11, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

const kindLabel = (t: Theme, i: SessionItem): [string, string] =>
  i.kind === 'new' ? ['新书', t.accent] : i.kind === 'update' ? ['更新', t.teal] : ['原声', t.highlight];

function Uploading({ current }: { current: NonNullable<ReceiveState['current']> }) {
  const t = useTheme();
  const item = current.item;
  const audio = /\.audio\./.test(current.name ?? '');
  const title = item?.title ?? current.name ?? '正在接收…';
  return (
    <View style={[styles.item, { borderTopColor: t.hairline }]}>
      {item ? <ItemCover id={item.id} title={item.title} /> : <IconTile icon={BookDown} color={t.accent} tint={t.accentSoft} />}
      <View style={styles.itemText}>
        <Text style={{ color: t.fg, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.row6}>
          {item && <Tag label={audio ? '原声' : kindLabel(t, item)[0]} color={audio ? t.highlight : kindLabel(t, item)[1]} />}
          <Text style={{ color: t.fg3, fontSize: 12 }}>{current.ratio >= 1 ? '正在放上书架' : item?.detail}</Text>
        </View>
        <View style={styles.row8}>
          <ProgressBar value={current.ratio} track={t.track} fill={t.accent} style={styles.flex} />
          <Text style={{ color: t.fg3, fontSize: 11, fontVariant: ['tabular-nums'] }}>{Math.round(current.ratio * 100)}%</Text>
        </View>
      </View>
    </View>
  );
}

function EntryRow({ e, plan, current }: { e: Entry; plan: SessionItem[]; current: ReceiveState['current'] }) {
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
  if (e.type === 'failed') {
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
  const { result, book } = e;
  const item = plan.find((i) => i.id === e.bookId);
  const onlyAudio = result.status === 'audio';
  const [label, color] = onlyAudio ? ['原声', t.highlight] : result.status === 'updated' ? ['已更新', t.teal] : ['新书', t.accent];
  const detail = onlyAudio
    ? `补齐 ${e.audioChapters} 章原声`
    : result.status === 'updated'
      ? [item?.detail, '进度保留'].filter(Boolean).join(' · ')
      : [book && `${book.chapterCount} 章`, book && categoryLabel(book.category)].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={() => openBook(e.bookId)} style={[styles.item, { borderTopColor: t.hairline }]}>
      <ItemCover id={e.bookId} title={result.title} />
      <View style={styles.itemText}>
        <Text style={{ color: t.fg, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
          {result.title}
        </Text>
        <View style={styles.row6}>
          <Tag label={label} color={color} />
          <Text style={{ color: t.fg3, fontSize: 12, flexShrink: 1 }} numberOfLines={1}>
            {detail}
            {!onlyAudio && e.audioChapters > 0 ? ` · ${e.audioChapters} 章原声` : ''}
          </Text>
        </View>
        {result.warnings.map((w) => (
          <Text key={w} style={{ color: t.warn, fontSize: 12 }}>
            {w}
          </Text>
        ))}
        {current && (
          <View style={styles.row8}>
            <ProgressBar value={current.ratio} track={t.track} fill={t.highlight} style={styles.flex} />
            <Text style={{ color: t.fg3, fontSize: 11 }}>正在接收原声</Text>
          </View>
        )}
      </View>
      <ChevronRight size={16} color={t.fg4} />
    </Pressable>
  );
}

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
          { backgroundColor: t.dark ? '#16181FF5' : '#FFFFFFF5', paddingBottom: insets.bottom + 12 },
          { transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [500, 0] }) }] },
        ]}
      >
        <View style={[styles.sheetIcon, { backgroundColor: t.accentSoft }]}>
          <Laptop size={24} color={t.accent} />
        </View>
        <Text style={{ color: t.fg, fontSize: 19, fontWeight: '700', textAlign: 'center' }}>
          {req.peer?.name ?? '电脑'} 想推送 {req.items.length} 本书
        </Text>
        <Text style={{ color: t.fg3, fontSize: 13, textAlign: 'center' }}>约 {mb(req.bytes)} · 传完后自动放上书架</Text>
        <Glass radius={18} shadow={false} style={styles.sheetList}>
          <ScrollView showsVerticalScrollIndicator={false}>
            {req.items.map((item, i) => {
              const [label, color] = kindLabel(t, item);
              return (
                <View key={item.id} style={[styles.sheetItem, i > 0 && { borderTopWidth: 1, borderTopColor: t.hairline }]}>
                  <ItemCover id={item.id} title={item.title} width={28} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: t.fg, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={{ color: t.fg3, fontSize: 12 }} numberOfLines={1}>
                      {item.detail}
                    </Text>
                  </View>
                  <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{label}</Text>
                </View>
              );
            })}
          </ScrollView>
        </Glass>
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
  content: { flex: 1, paddingHorizontal: 20, gap: 18 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hero: { borderRadius: 28, overflow: 'hidden', borderWidth: 1 },
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
  foot: { fontSize: 12, textAlign: 'center' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingTop: 28, paddingHorizontal: 20, gap: 10, maxHeight: '82%' },
  sheetIcon: { width: 52, height: 52, borderRadius: 16, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  sheetList: { marginTop: 8, maxHeight: 300, flexShrink: 1 },
  sheetItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 9 },
  sheetButtons: { flexDirection: 'row', gap: 12, marginTop: 10 },
  reject: { flex: 1, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
});
