import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as Network from 'expo-network';
import { useKeepAwake } from 'expo-keep-awake';
import {
  ArrowDownToLine,
  Check,
  CircleAlert,
  Copy,
  LoaderCircle,
  Power,
  RotateCcw,
  ShieldAlert,
  Sun,
  type LucideIcon,
} from 'lucide-react-native';
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { Animated, AppState, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getBook, type BookRow } from '@/db/queries';
import type { ImportResult } from '@/import/pipeline';
import { LAN_PORT, MAX_PIN_FAILURES, startLanServer, type LanServer, type ReceivingUpload } from '@/server/lan-server';
import { setLanRunning } from '@/server/lan-status';
import { openBook } from '@/shelf/actions';
import { BookCover, COVER_RATIO } from '@/shelf/BookCover';
import { categoryLabel } from '@/shelf/categories';
import { Backdrop } from '@/ui/Backdrop';
import { Glass, GlassPill, PrimaryButton } from '@/ui/glass';
import { CrossFade, EASE_IN_OUT_CUBIC, EASE_OUT_CUBIC, EASE_OUT_QUINT, FadeInUp, isReduceMotion, ProgressBar } from '@/ui/motion';
import { PageHeader } from '@/ui/PageHeader';
import { TAB_BAR_SPACE } from '@/ui/TabBar';
import { TransferArt } from '@/ui/TransferArt';
import { MONO, useTheme } from '@/ui/theme';

type Status = 'off' | 'starting' | 'running' | 'locked' | { error: string };
type Received = ImportResult & { id: number; book?: BookRow | null };

const randomPin = () => String(Math.floor(Math.random() * 10000)).padStart(4, '0');
let receivedSeq = 0;
/** 上一个文件结束后多久没有新文件才算这一批接收完：CLI 推送是逐本串行的，中间有短暂空档 */
const BATCH_IDLE_MS = 1500;

/**
 * 传书（README 第 5.2 节）：默认不开启；开启后一直运行到手动停止，切到其他 Tab 也不关闭。
 * App 在后台时 iOS 会挂起服务，回到前台时用同一个 PIN 重新监听。PIN 每次开启重新生成。
 */
export default function TransferScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<Status>('off');
  const [pin, setPin] = useState(randomPin);
  const [ip, setIp] = useState<string | null>(null);
  const [onWifi, setOnWifi] = useState(true);
  const [received, setReceived] = useState<Received[]>([]);
  const [receiving, setReceiving] = useState<Map<number, ReceivingUpload>>(new Map());
  const [toast, setToast] = useState<Received | null>(null);
  const server = useRef<LanServer | null>(null);
  // 一批接收中只为第一本弹提示，避免批量推送时提示条连续刷新
  const batchToasted = useRef(false);

  const on = status === 'starting' || status === 'running';

  // 手动停止：关闭服务，回到未开启
  const stop = () => {
    server.current?.stop();
    server.current = null;
    setReceiving(new Map());
    setStatus('off');
  };

  useEffect(() => {
    setLanRunning(on);
  }, [on]);
  // 页面卸载时（如重新加载）不留下没人管的服务
  useEffect(
    () => () => {
      server.current?.stop();
      setLanRunning(false);
    },
    [],
  );

  // 刷新 IP：切换 Wi-Fi 或回到前台时可能变化
  useEffect(() => {
    if (!on) return;
    void Network.getNetworkStateAsync().then((s) => setOnWifi(s.type === Network.NetworkStateType.WIFI));
    void Network.getIpAddressAsync().then((addr) => setIp(addr && addr !== '0.0.0.0' ? addr : null));
  }, [on]);

  const listen = (listenPin: string) => {
    server.current?.stop();
    server.current = startLanServer(listenPin, {
      onListening: () => setStatus('running'),
      onReceiving: (key, upload) =>
        setReceiving((m) => {
          const next = new Map(m);
          if (upload === null) next.delete(key);
          else next.set(key, upload);
          return next;
        }),
      onUpload: (r) => {
        void (r.ok ? getBook(r.bookId) : Promise.resolve(null)).then((book) => {
          const item = { ...r, id: ++receivedSeq, book };
          setReceived((list) => [item, ...list]);
          if (r.ok && !batchToasted.current) {
            batchToasted.current = true;
            setToast(item);
          }
        });
      },
      onLocked: () => {
        server.current = null;
        setStatus('locked');
      },
      onError: (error) => {
        server.current?.stop();
        server.current = null;
        setStatus({ error });
      },
    });
  };

  const start = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextPin = randomPin();
    setPin(nextPin);
    setReceived([]);
    setStatus('starting');
    listen(nextPin);
  };

  // 后台期间监听的端口可能被系统回收：回到前台时用同一个 PIN 重新监听，电脑端不用重新输入
  const resume = useEffectEvent(() => {
    if (!server.current) return;
    setReceiving(new Map());
    listen(pin);
  });
  useEffect(() => {
    let prev = AppState.currentState;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && prev === 'background') resume();
      prev = s;
    });
    return () => sub.remove();
  }, []);

  const url = ip ? `${ip}:${LAN_PORT}` : null;
  const batch = useBatch(receiving.size > 0);
  useEffect(() => {
    if (!batch) batchToasted.current = false;
  }, [batch]);
  const [shown, leaving] = useGroupSwap(groupOf(status));
  // 开启时说明收起后头图才收窄；关闭时立即放宽
  const compact = (shown === 'on' || shown === null) && on;
  const exit = shown === 'on' ? ON_EXIT : OFF_EXIT;

  return (
    <View style={styles.flex}>
      <Backdrop />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 6, paddingBottom: TAB_BAR_SPACE + 20 }]}
        showsVerticalScrollIndicator={false}
      >
        <PageHeader
          title="传书"
          right={
            shown === 'on' && (
              <FadeInUp axis="x" leaving={leaving} exitOffset={0} exitDuration={ON_EXIT.exitDuration}>
                <GlassPill
                  icon={Power}
                  label="停止"
                  color={t.danger}
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    stop();
                  }}
                />
              </FadeInUp>
            )
          }
        />

        {(!on || (received.length === 0 && !batch)) && <Hero status={status} compact={compact} />}

        {shown === 'off' && (
          <>
            <FadeInUp index={0} delay={ENTER_DELAY} leaving={leaving} {...exit}>
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
            </FadeInUp>
            <FadeInUp index={1} delay={ENTER_DELAY} leaving={leaving} {...exit}>
              <PrimaryButton
                icon={status === 'starting' ? LoaderCircle : Power}
                label={status === 'starting' ? '正在开启…' : '开启传书'}
                onPress={start}
              />
            </FadeInUp>
            <FadeInUp index={2} delay={ENTER_DELAY} leaving={leaving} {...exit}>
              <Text style={[styles.foot, { color: t.fg3 }]}>
                开启后一直运行，直到手动停止{'\n'}用 AirDrop 发送不需要开启
              </Text>
            </FadeInUp>
          </>
        )}

        {shown === 'locked' && (
          <>
            <FadeInUp index={0} delay={ENTER_DELAY} leaving={leaving} {...exit}>
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
            </FadeInUp>
            <FadeInUp index={1} delay={ENTER_DELAY} leaving={leaving} {...exit}>
              <PrimaryButton icon={RotateCcw} label="重新开启" onPress={start} />
            </FadeInUp>
            <FadeInUp index={2} delay={ENTER_DELAY} leaving={leaving} {...exit}>
              <Text style={[styles.foot, { color: t.fg3 }]}>重新开启会生成新的 PIN</Text>
            </FadeInUp>
          </>
        )}

        {shown === 'error' && typeof status === 'object' && (
          <>
            <FadeInUp index={0} leaving={leaving} {...exit}>
              <Text style={{ color: t.danger, fontSize: 13 }}>服务启动失败：{status.error}</Text>
            </FadeInUp>
            <FadeInUp index={1} leaving={leaving} {...exit}>
              <PrimaryButton icon={RotateCcw} label="重试" onPress={start} />
            </FadeInUp>
          </>
        )}

        {shown === 'on' && (
          <>
            {!onWifi && <Text style={{ color: t.warn, fontSize: 13 }}>当前没有连接 Wi-Fi，电脑和手机需要在同一个局域网内。</Text>}
            <FadeInUp index={0} leaving={leaving} {...exit}>
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
                        <RollIn index={i}>
                          <Text style={[styles.digitText, { color: t.fg }]}>{d}</Text>
                        </RollIn>
                      </View>
                    ))}
                  </View>
                </View>
              </Glass>
            </FadeInUp>

            <FadeInUp index={1} leaving={leaving} {...exit}>
              {received.length > 0 || batch ? (
                <ReceivedList items={received} batch={batch} receiving={[...receiving]} />
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
            </FadeInUp>

            <FadeInUp index={2} leaving={leaving} {...exit}>
              <View style={styles.awake}>
                <Sun size={12} color={t.fg3} />
                <Text style={{ color: t.fg3, fontSize: 11 }}>屏幕保持常亮 · 用完记得点右上角停止</Text>
              </View>
            </FadeInUp>
          </>
        )}
        {on && <KeepAwake />}
      </ScrollView>
      {toast && <Toast item={toast} onHide={() => setToast(null)} />}
    </View>
  );
}

type Group = 'off' | 'on' | 'locked' | 'error' | null;

/** 页面下半部分显示哪一组内容；正在开启时两组都不显示 */
const groupOf = (s: Status): Group =>
  s === 'running' ? 'on' : s === 'starting' ? null : s === 'locked' ? 'locked' : typeof s === 'object' ? 'error' : 'off';

/** 退场参数：说明组向上收、依次错开；运行组向下收、同时退场，比入场快 */
const OFF_EXIT = { exitOffset: -8, exitStagger: 20, exitDuration: 180 };
const ON_EXIT = { exitOffset: 8, exitStagger: 0, exitDuration: 160 };
/** 关闭时说明组等头图开始变化后再进来 */
const ENTER_DELAY = 60;

/**
 * 先让正在显示的分组退场，退场结束后换成最新的目标分组。
 * 退场途中目标再变（如 starting → running）不重新计时。
 */
function useGroupSwap(target: Group): [Group, boolean] {
  const [shown, setShown] = useState<Group>(target);
  const latest = useRef(target);
  useEffect(() => {
    latest.current = target;
  }, [target]);
  const leaving = shown !== target;
  useEffect(() => {
    if (!leaving) return;
    const ms = shown === null ? 0 : isReduceMotion() ? 200 : shown === 'on' ? ON_EXIT.exitDuration : OFF_EXIT.exitDuration + 2 * OFF_EXIT.exitStagger;
    const id = setTimeout(() => setShown(latest.current), ms);
    return () => clearTimeout(id);
  }, [leaving, shown]);
  return [shown, leaving];
}

/**
 * 是否处在一批接收中：有文件在传时立即为真，全部结束后再等 BATCH_IDLE_MS 才变回假，
 * 让逐本推送的整批过程在界面上是一个连续状态，而不是每本闪一次。
 */
function useBatch(receiving: boolean): boolean {
  const [held, setHeld] = useState(receiving);
  if (receiving && !held) setHeld(true);
  useEffect(() => {
    if (receiving) return;
    const id = setTimeout(() => setHeld(false), BATCH_IDLE_MS);
    return () => clearTimeout(id);
  }, [receiving]);
  return receiving || held;
}

/** 服务运行时保持屏幕常亮 */
function KeepAwake() {
  useKeepAwake();
  return null;
}

/**
 * 头图：开启时收窄到 168、遮罩褪去（场景亮起）；关闭时稍后放宽、遮罩回来（场景暗下）。
 * 遮罩只在服务运行时去掉，光带一直流动。
 */
function Hero({ status, compact }: { status: Status; compact: boolean }) {
  const t = useTheme();
  const live = status === 'running';
  const height = useState(() => new Animated.Value(compact ? 168 : 200))[0];
  const veil = useState(() => new Animated.Value(live ? 0 : 1))[0];
  useEffect(() => {
    if (isReduceMotion()) return height.setValue(compact ? 168 : 200);
    const anim = Animated.sequence([
      Animated.delay(compact ? 0 : 120),
      Animated.spring(height, { toValue: compact ? 168 : 200, damping: 20, stiffness: 180, useNativeDriver: false }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [compact, height]);
  useEffect(() => {
    if (isReduceMotion()) return veil.setValue(live ? 0 : 1);
    const anim = live
      ? Animated.timing(veil, { toValue: 0, duration: 400, easing: EASE_OUT_CUBIC, useNativeDriver: true })
      : Animated.timing(veil, { toValue: 1, duration: 300, delay: 120, easing: EASE_IN_OUT_CUBIC, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [live, veil]);
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
      <Animated.View style={[styles.hero, { height, borderColor: t.glassStroke }]}>
        <TransferArt live={live} />
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: `${t.bg}66`, opacity: veil }]} />
        <Glass radius={16} shadow={false} strong style={styles.status}>
          <CrossFade value={label} style={styles.statusInner}>
            <Pulse color={dot} live={live} />
            <Text style={{ color: text, fontSize: 12, fontWeight: '600' }}>{label}</Text>
          </CrossFade>
        </Glass>
      </Animated.View>
    </FadeInUp>
  );
}

/** PIN 数字从格子下方滚入，逐位错开 40ms */
function RollIn({ index, children }: { index: number; children: ReactNode }) {
  const v = useState(() => new Animated.Value(isReduceMotion() ? 1 : 0))[0];
  useEffect(() => {
    if (isReduceMotion()) return;
    Animated.timing(v, { toValue: 1, duration: 300, delay: 120 + index * 40, easing: EASE_OUT_QUINT, useNativeDriver: true }).start();
  }, [v, index]);
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
      {children}
    </Animated.View>
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

function Spinner({ color, size = 14 }: { color: string; size?: number }) {
  const v = useState(() => new Animated.Value(0))[0];
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <Animated.View style={{ transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>
      <LoaderCircle size={size} color={color} />
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

/** 接收列表里封面的宽度；没有封面可显示的行（进度、失败）用同样大小的图标块占位，保持行高一致 */
const ITEM_COVER = 40;

/** 与封面同尺寸的图标块 */
function ItemIcon({ icon: Icon, color, tint }: { icon: LucideIcon; color: string; tint: string }) {
  return (
    <View style={[styles.itemIcon, { backgroundColor: tint }]}>
      <Icon size={17} color={color} />
    </View>
  );
}

function ReceivedItem({ r }: { r: Received }) {
  const t = useTheme();
  if (!r.ok) {
    return (
      <View style={styles.item}>
        <ItemIcon icon={CircleAlert} color={t.danger} tint={`${t.danger}14`} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: t.fg, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
            {r.fileName}
          </Text>
          <Text style={{ color: t.warn, fontSize: 12 }} numberOfLines={2}>
            没有导入：{r.error}
          </Text>
        </View>
      </View>
    );
  }
  const series = r.book && categoryLabel(r.book.category);
  const updated = r.status === 'updated';
  const audio = r.status === 'audio';
  const meta = audio
    ? `原声 ${r.total} / ${r.book?.chapterCount ?? r.total} 章`
    : [r.book && `${r.book.chapterCount} 章`, series].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={() => openBook(r.bookId)} style={styles.item}>
      {r.book ? (
        <BookCover book={r.book} width={ITEM_COVER} radius={6} />
      ) : (
        <ItemIcon icon={ArrowDownToLine} color={t.teal} tint={`${t.teal}14`} />
      )}
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: t.fg, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
          {r.title}
        </Text>
        <View style={styles.itemMeta}>
          <View style={[styles.tag, { backgroundColor: updated || audio ? `${t.teal}1F` : t.accentSoft }]}>
            <Text style={{ color: updated || audio ? t.teal : t.accent, fontSize: 11, fontWeight: '600' }}>
              {audio ? '原声' : updated ? '已更新' : '新书'}
            </Text>
          </View>
          {meta.length > 0 && (
            <Text style={{ flex: 1, color: t.fg3, fontSize: 12 }} numberOfLines={1}>
              {meta}
            </Text>
          )}
        </View>
        {updated && <Text style={{ color: t.fg3, fontSize: 12 }}>阅读进度和高亮都保留了</Text>}
        {r.warnings.map((w) => (
          <Text key={w} style={{ color: t.warn, fontSize: 12 }}>
            {w}
          </Text>
        ))}
      </View>
    </Pressable>
  );
}

/**
 * 本次接收列表。一批接收期间顶部固定一行，显示正在上传或导入的书和上传进度；
 * 文件之间的空档显示为等待下一个文件。整批结束后才收起，列表只会逐本变长，不会来回伸缩。
 */
function ReceivedList({ items, batch, receiving }: { items: Received[]; batch: boolean; receiving: [number, ReceivingUpload][] }) {
  const t = useTheme();
  // 同时有多个时显示最慢的那个
  const [currentKey, current] = receiving.length > 0 ? receiving.reduce((a, b) => (b[1].ratio < a[1].ratio ? b : a)) : [null, null];
  // 换成另一个文件时进度条重新挂载：先无过渡地回到 0%，再过渡到实际进度；文件间的空档沿用上一个，不回放
  const [barKey, setBarKey] = useState(0);
  if (currentKey !== null && currentKey !== barKey) setBarKey(currentKey);
  const ratio = current?.ratio ?? 1;
  const book = useUploadingBook(current?.name);
  const stage = !current ? '等待下一个文件' : ratio >= 1 ? '正在导入' : '正在上传';
  const more = receiving.length > 1 ? ` · ${receiving.length} 个文件` : '';
  return (
    <Glass radius={24} style={styles.received}>
      <View style={styles.receivedHead}>
        <Text style={{ color: t.fg, fontSize: 13, fontWeight: '700' }}>本次接收</Text>
        <View style={styles.receivedCount}>
          {batch && <Spinner color={t.fg3} size={12} />}
          <Text style={{ color: t.fg3, fontSize: 12, fontVariant: ['tabular-nums'] }}>
            {batch ? `已收到 ${items.length} 个` : `${items.length} 个文件`}
          </Text>
        </View>
      </View>
      {batch && (
        <View style={styles.item}>
          {current && book ? (
            <BookCover book={book} width={ITEM_COVER} radius={6} />
          ) : (
            <ItemIcon icon={ArrowDownToLine} color={t.accent} tint={t.accentSoft} />
          )}
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: t.fg, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
              {current ? (book?.title ?? current.name ?? `${stage}…`) : `${stage}…`}
            </Text>
            {current && (book || current.name) && (
              <Text style={{ color: t.fg3, fontSize: 12 }} numberOfLines={1}>
                {stage}
                {more}
              </Text>
            )}
            <View style={styles.itemProgress}>
              <ProgressBar key={barKey} value={ratio} track={t.track} fill={t.accent} style={{ flex: 1 }} />
              <Text style={{ color: t.fg2, fontSize: 11, fontVariant: ['tabular-nums'] }}>{Math.round(ratio * 100)}%</Text>
            </View>
          </View>
        </View>
      )}
      {items.map((r) => (
        <ReceivedItem key={r.id} r={r} />
      ))}
    </Glass>
  );
}

/** 按上传的文件名（`<id>.zip`，shelf-pack 推送时就是这样）找书架上已有的同一本书，用来显示封面和书名 */
function useUploadingBook(name: string | undefined): BookRow | null {
  const id = name?.replace(/\.(zip|md|markdown)$/i, '');
  const [found, setFound] = useState<{ id: string; book: BookRow | null } | null>(null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    void getBook(id).then((book) => {
      if (alive) setFound({ id, book });
    });
    return () => {
      alive = false;
    };
  }, [id]);
  return found && found.id === id ? found.book : null;
}

/** 导入成功后从顶部滑下的提示，3 秒后收起 */
function Toast({ item, onHide }: { item: Received; onHide(): void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const v = useState(() => new Animated.Value(0))[0];
  // onHide 每次渲染都是新函数，不能放进依赖，否则上传进度一刷新提示就从头再弹一次
  const hide = useEffectEvent(onHide);
  useEffect(() => {
    v.setValue(0);
    const anim = Animated.sequence([
      Animated.spring(v, { toValue: 1, damping: 22, stiffness: 260, useNativeDriver: true }),
      Animated.delay(3000),
      Animated.timing(v, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]);
    anim.start(({ finished }) => finished && hide());
    return () => anim.stop();
  }, [item, v]);
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
            {item.status === 'audio' ? '已收到原声' : item.status === 'updated' ? '已更新' : '已添加'}《{item.title}》
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
  status: { position: 'absolute', left: 12, bottom: 12, paddingHorizontal: 12, height: 31, justifyContent: 'center' },
  statusInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pulse: { width: 10, height: 10, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 16, height: 16, borderRadius: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
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
  receivedHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  receivedCount: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 18 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 10 },
  itemIcon: { width: ITEM_COVER, height: Math.round(ITEM_COVER * COVER_RATIO), borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  itemMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tag: { paddingHorizontal: 6, height: 18, borderRadius: 6, justifyContent: 'center' },
  itemProgress: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toastWrap: { position: 'absolute', left: 20, right: 20 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
});
