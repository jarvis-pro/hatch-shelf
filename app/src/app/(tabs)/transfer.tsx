import * as Clipboard from 'expo-clipboard';
import * as Network from 'expo-network';
import { useKeepAwake } from 'expo-keep-awake';
import { useFocusEffect } from 'expo-router';
import {
  ArrowDownToLine,
  Check,
  CircleAlert,
  Copy,
  LoaderCircle,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sun,
  type LucideIcon,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getBook, type BookRow } from '@/db/queries';
import type { ImportResult } from '@/import/pipeline';
import { LAN_PORT, MAX_PIN_FAILURES, startLanServer, type LanServer } from '@/server/lan-server';
import { openBook } from '@/shelf/actions';
import { BookCover } from '@/shelf/BookCover';
import { categoryLabel } from '@/shelf/categories';
import { Backdrop } from '@/ui/Backdrop';
import { Glass, GlassPill, PrimaryButton } from '@/ui/glass';
import { FadeInUp, isReduceMotion, ProgressBar } from '@/ui/motion';
import { PageHeader } from '@/ui/PageHeader';
import { TAB_BAR_SPACE } from '@/ui/TabBar';
import { TransferArt } from '@/ui/TransferArt';
import { MONO, useTheme, type Theme } from '@/ui/theme';

type Status = 'off' | 'starting' | 'running' | 'locked' | { error: string };
type Received = ImportResult & { at: number; book?: BookRow | null };

const randomPin = () => String(Math.floor(Math.random() * 10000)).padStart(4, '0');

/**
 * 传书（README 第 5.2 节）：默认不开启；开启后只在本页可见时运行，
 * 切到其他 Tab 或 App 进入后台时立即关闭。PIN 每次开启重新生成。
 */
export default function TransferScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<Status>('off');
  const [pin, setPin] = useState(randomPin);
  const [ip, setIp] = useState<string | null>(null);
  const [onWifi, setOnWifi] = useState(true);
  const [received, setReceived] = useState<Received[]>([]);
  const [receiving, setReceiving] = useState<Map<number, number>>(new Map());
  const [toast, setToast] = useState<Received | null>(null);
  const server = useRef<LanServer | null>(null);

  const on = status === 'starting' || status === 'running';

  // 离开页面或进入后台：关闭服务，回到未开启（锁定状态保留，提示用户发生过什么）
  const stop = useCallback(() => {
    server.current?.stop();
    server.current = null;
    setReceiving(new Map());
    setStatus((s) => (s === 'locked' ? s : 'off'));
  }, []);

  useFocusEffect(useCallback(() => stop, [stop]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s !== 'active' && stop());
    return () => sub.remove();
  }, [stop]);

  // 刷新 IP：切换 Wi-Fi 或回到前台时可能变化
  useEffect(() => {
    if (!on) return;
    void Network.getNetworkStateAsync().then((s) => setOnWifi(s.type === Network.NetworkStateType.WIFI));
    void Network.getIpAddressAsync().then((addr) => setIp(addr && addr !== '0.0.0.0' ? addr : null));
  }, [on]);

  const start = () => {
    const nextPin = randomPin();
    setPin(nextPin);
    setReceived([]);
    setStatus('starting');
    server.current?.stop();
    server.current = startLanServer(nextPin, {
      onListening: () => setStatus('running'),
      onReceiving: (key, ratio) =>
        setReceiving((m) => {
          const next = new Map(m);
          if (ratio === null) next.delete(key);
          else next.set(key, ratio);
          return next;
        }),
      onUpload: (r) => {
        void (r.ok ? getBook(r.bookId) : Promise.resolve(null)).then((book) => {
          const item = { ...r, at: Date.now(), book };
          setReceived((list) => [item, ...list]);
          if (r.ok) setToast(item);
        });
      },
      onLocked: () => {
        server.current = null;
        setStatus('locked');
      },
      onError: (error) => setStatus({ error }),
    });
  };

  const url = ip ? `${ip}:${LAN_PORT}` : null;
  const busy = receiving.size > 0;
  const sub = status === 'locked' ? '局域网 · 已停止' : on ? '局域网 · 已开启' : '局域网 · 未开启';

  return (
    <View style={styles.flex}>
      <Backdrop />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 6, paddingBottom: TAB_BAR_SPACE + 20 }]}
        showsVerticalScrollIndicator={false}
      >
        <PageHeader sub={sub} title="传书" right={on && <GlassPill icon={Power} label="停止" color={t.danger} onPress={stop} />} />

        {busy ? (
          <View style={[styles.busy, { backgroundColor: t.accentSoft }]}>
            <Spinner color={t.accent} />
            <Text style={{ color: t.accentText, fontSize: 12, fontWeight: '600' }}>正在接收 {receiving.size} 个文件</Text>
          </View>
        ) : (
          (!on || received.length === 0) && <Hero status={status} compact={on} />
        )}

        {status === 'off' && (
          <>
            <Glass radius={24} style={styles.card}>
              <Text style={[styles.cardTitle, { color: t.fg }]}>从电脑传书到手机</Text>
              {['手机和电脑连同一个 Wi-Fi', '在电脑浏览器打开页面上显示的地址，输入 PIN', '拖入 .zip 或 .md，书会自动出现在书架上'].map(
                (text, i) => (
                  <View key={text} style={styles.step}>
                    <View style={[styles.num, { backgroundColor: t.accentSoft }]}>
                      <Text style={{ color: t.accent, fontSize: 12, fontWeight: '700' }}>{i + 1}</Text>
                    </View>
                    <Text style={{ flex: 1, color: t.ink, fontSize: 13, lineHeight: 20 }}>{text}</Text>
                  </View>
                ),
              )}
            </Glass>
            <PrimaryButton icon={Power} label="开启传书" onPress={start} />
            <Text style={[styles.foot, { color: t.fg3 }]}>
              只在这个页面运行，离开页面或锁屏后自动关闭{'\n'}用 AirDrop 发送不需要开启
            </Text>
          </>
        )}

        {status === 'locked' && (
          <>
            <Glass radius={24} style={[styles.card, styles.locked]}>
              <View style={[styles.lockIcon, { backgroundColor: `${t.danger}14` }]}>
                <ShieldAlert size={20} color={t.danger} />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={[styles.cardTitle, { color: t.fg }]}>PIN 连续输错 {MAX_PIN_FAILURES} 次</Text>
                <Text style={{ color: t.fg2, fontSize: 13, lineHeight: 21 }}>
                  为了安全，这次的服务已经停止。如果不是你自己输错的，可能有人在同一个网络里尝试连接。
                </Text>
              </View>
            </Glass>
            <PrimaryButton icon={RotateCcw} label="重新开启" onPress={start} />
            <Text style={[styles.foot, { color: t.fg3 }]}>重新开启会生成新的 PIN</Text>
          </>
        )}

        {typeof status === 'object' && (
          <>
            <Text style={{ color: t.danger, fontSize: 13 }}>服务启动失败：{status.error}</Text>
            <PrimaryButton icon={RotateCcw} label="重试" onPress={start} />
          </>
        )}

        {on && (
          <>
            {!onWifi && <Text style={{ color: t.warn, fontSize: 13 }}>当前没有连接 Wi-Fi，电脑和手机需要在同一个局域网内。</Text>}
            <Glass radius={24} style={[styles.card, { gap: 16 }]}>
              <View style={{ gap: 6 }}>
                <Text style={{ color: t.fg3, fontSize: 12 }}>在电脑浏览器中打开</Text>
                <View style={styles.addrRow}>
                  <Text style={[styles.addr, { color: t.fg }]} selectable>
                    {url ?? '未获取到 IP 地址'}
                  </Text>
                  {url && <CopyButton text={`http://${url}`} />}
                </View>
              </View>
              <View style={[styles.divider, { backgroundColor: t.hairline }]} />
              <View style={{ gap: 10 }}>
                <View style={styles.pinHead}>
                  <Text style={{ color: t.fg3, fontSize: 12 }}>PIN</Text>
                  <Text style={{ color: t.fg4, fontSize: 11 }}>每次开启重新生成</Text>
                </View>
                <View style={styles.digits}>
                  {pin.split('').map((d, i) => (
                    <View key={i} style={[styles.digit, { backgroundColor: t.dark ? '#FFFFFF0F' : '#FFFFFFB3', borderColor: t.hairline }]}>
                      <Text style={[styles.digitText, { color: t.fg }]}>{d}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </Glass>

            {received.length > 0 || busy ? (
              <ReceivedList items={received} receiving={[...receiving.values()]} />
            ) : (
              <View style={styles.cli}>
                <Text style={{ color: t.fg3, fontSize: 12 }}>或在终端推送</Text>
                <View style={[styles.code, { backgroundColor: t.dark ? '#000000B3' : '#111318E6' }]}>
                  <Text style={styles.codeText} selectable>
                    <Text style={{ color: '#6E9BFF' }}>$ </Text>
                    shelf-pack push books/ --to {ip ?? '<IP>'} --pin {pin} --changed
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.awake}>
              <Sun size={12} color={t.fg3} />
              <Text style={{ color: t.fg3, fontSize: 11 }}>屏幕保持常亮 · 离开页面后服务自动关闭</Text>
            </View>
            <KeepAwake />
          </>
        )}
      </ScrollView>
      {toast && <Toast item={toast} onHide={() => setToast(null)} />}
    </View>
  );
}

/** 服务运行时保持屏幕常亮 */
function KeepAwake() {
  useKeepAwake();
  return null;
}

function Hero({ status, compact }: { status: Status; compact: boolean }) {
  const t = useTheme();
  const [label, dot, text] =
    status === 'running'
      ? ['服务已开启 · 等待上传', t.success, t.successText]
      : status === 'starting'
        ? ['正在开启…', t.fg3, t.fg2]
        : status === 'locked'
          ? ['已停止', t.danger, t.dangerText]
          : ['未开启', t.fg3, t.fg2];
  return (
    <FadeInUp>
      <View style={[styles.hero, { height: compact ? 168 : 200, borderColor: t.glassStroke }]}>
        <TransferArt />
        {status !== 'running' && <View style={[StyleSheet.absoluteFill, { backgroundColor: `${t.bg}66` }]} />}
        <Glass radius={16} shadow={false} strong style={styles.status}>
          <Pulse color={dot} live={status === 'running'} />
          <Text style={{ color: text, fontSize: 12, fontWeight: '600' }}>{label}</Text>
        </Glass>
      </View>
    </FadeInUp>
  );
}

/** 状态点：服务运行时外圈缓慢呼吸 */
function Pulse({ color, live }: { color: string; live: boolean }) {
  const v = useState(() => new Animated.Value(0))[0];
  useEffect(() => {
    if (!live || isReduceMotion()) return v.setValue(0);
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [live, v]);
  return (
    <View style={styles.pulse}>
      <Animated.View
        style={[
          styles.halo,
          {
            backgroundColor: `${color}33`,
            opacity: live ? v.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) : 1,
            transform: [{ scale: live ? v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] }) : 1 }],
          },
        ]}
      />
      <View style={[styles.dot, { backgroundColor: color }]} />
    </View>
  );
}

function Spinner({ color }: { color: string }) {
  const v = useState(() => new Animated.Value(0))[0];
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <Animated.View style={{ transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>
      <LoaderCircle size={14} color={color} />
    </Animated.View>
  );
}

function CopyButton({ text }: { text: string }) {
  const t = useTheme();
  const [copied, setCopied] = useState(false);
  return (
    <Pressable
      onPress={() => {
        void Clipboard.setStringAsync(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      style={[styles.copy, { backgroundColor: t.accentSoft }]}
      accessibilityLabel="复制地址"
    >
      {copied ? <Check size={16} color={t.accent} /> : <Copy size={16} color={t.accent} />}
    </Pressable>
  );
}

function itemView(r: Received, t: Theme): { icon: LucideIcon; color: string; title: string; detail: string; detailColor: string } {
  if (!r.ok) return { icon: CircleAlert, color: t.danger, title: r.fileName, detail: `没有导入：${r.error}`, detailColor: t.warn };
  const series = r.book && categoryLabel(r.book.category);
  const where = series ? `已添加到「${series}」` : '已添加到书架';
  return r.status === 'updated'
    ? { icon: RefreshCw, color: t.teal, title: r.title, detail: '已更新 · 阅读进度和高亮都保留了', detailColor: t.fg2 }
    : { icon: Plus, color: t.teal, title: r.title, detail: where, detailColor: t.fg2 };
}

function ReceivedList({ items, receiving }: { items: Received[]; receiving: number[] }) {
  const t = useTheme();
  return (
    <Glass radius={24} style={styles.received}>
      <View style={styles.receivedHead}>
        <Text style={{ color: t.fg, fontSize: 13, fontWeight: '700' }}>本次接收</Text>
        <Text style={{ color: t.fg3, fontSize: 12 }}>{items.length + receiving.length} 个文件</Text>
      </View>
      {receiving.map((ratio, i) => (
        <View key={`r${i}`} style={styles.item}>
          <View style={[styles.itemIcon, { backgroundColor: t.accentSoft }]}>
            <ArrowDownToLine size={17} color={t.accent} />
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={{ color: t.fg, fontSize: 14, fontWeight: '600' }}>{ratio >= 1 ? '正在导入…' : '正在上传…'}</Text>
            <View style={styles.itemProgress}>
              <ProgressBar value={ratio} track={t.track} fill={t.accent} style={{ flex: 1 }} />
              <Text style={{ color: t.fg2, fontSize: 11, fontVariant: ['tabular-nums'] }}>{Math.round(ratio * 100)}%</Text>
            </View>
          </View>
        </View>
      ))}
      {items.map((r) => {
        const v = itemView(r, t);
        return (
          <Pressable key={r.at} disabled={!r.ok} onPress={() => r.ok && openBook(r.bookId)} style={styles.item}>
            <View style={[styles.itemIcon, { backgroundColor: `${v.color}14` }]}>
              <v.icon size={17} color={v.color} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ color: t.fg, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
                {v.title}
              </Text>
              <Text style={{ color: v.detailColor, fontSize: 12 }} numberOfLines={2}>
                {v.detail}
              </Text>
              {r.ok &&
                r.warnings.map((w) => (
                  <Text key={w} style={{ color: t.warn, fontSize: 12 }}>
                    {w}
                  </Text>
                ))}
            </View>
          </Pressable>
        );
      })}
    </Glass>
  );
}

/** 导入成功后从顶部滑下的提示，3 秒后收起 */
function Toast({ item, onHide }: { item: Received; onHide(): void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const v = useState(() => new Animated.Value(0))[0];
  useEffect(() => {
    v.setValue(0);
    const anim = Animated.sequence([
      Animated.spring(v, { toValue: 1, damping: 22, stiffness: 260, useNativeDriver: true }),
      Animated.delay(3000),
      Animated.timing(v, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]);
    anim.start(({ finished }) => finished && onHide());
    return () => anim.stop();
  }, [item, v, onHide]);
  if (!item.ok) return null;
  const meta = [item.book && `${item.book.chapterCount} 章`, item.book && categoryLabel(item.book.category)].filter(Boolean).join(' · ');
  return (
    <Animated.View
      style={[
        styles.toastWrap,
        {
          top: insets.top - 6,
          opacity: v,
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }],
        },
      ]}
    >
      <Glass radius={22} strong style={styles.toast}>
        {item.book && <BookCover book={item.book} width={28} radius={5} elevation={0} />}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: t.fg, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
            {item.status === 'updated' ? '已更新' : '已添加'}《{item.title}》
          </Text>
          {meta.length > 0 && <Text style={{ color: t.fg3, fontSize: 12 }}>{meta}</Text>}
        </View>
        <Pressable onPress={() => openBook(item.bookId)} hitSlop={10}>
          <Text style={{ color: t.accent, fontSize: 14, fontWeight: '600' }}>查看</Text>
        </Pressable>
      </Glass>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, gap: 22 },
  hero: { borderRadius: 26, overflow: 'hidden', borderWidth: 1 },
  status: { position: 'absolute', left: 12, bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 31 },
  pulse: { width: 10, height: 10, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 16, height: 16, borderRadius: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  busy: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, height: 31, paddingHorizontal: 12, borderRadius: 16 },
  card: { padding: 18, gap: 14 },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  foot: { fontSize: 12, lineHeight: 23, textAlign: 'center', marginTop: -4 },
  locked: { flexDirection: 'row', alignItems: 'flex-start' },
  lockIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  addrRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  addr: { flex: 1, fontFamily: MONO, fontSize: 20, fontWeight: '600', letterSpacing: -0.3 },
  copy: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  divider: { height: 1 },
  pinHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  digits: { flexDirection: 'row', gap: 10 },
  digit: { flex: 1, height: 58, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  digitText: { fontSize: 28, fontWeight: '600', fontVariant: ['tabular-nums'] },
  cli: { gap: 8, paddingHorizontal: 4 },
  code: { borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  codeText: { color: '#E8EAF0', fontFamily: MONO, fontSize: 12, lineHeight: 18 },
  awake: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  received: { paddingVertical: 4 },
  receivedHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11 },
  itemIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  itemProgress: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toastWrap: { position: 'absolute', left: 20, right: 20 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
});
