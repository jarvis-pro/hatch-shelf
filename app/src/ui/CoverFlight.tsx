import { BlurView } from 'expo-blur';
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, useWindowDimensions, View, type HostInstance } from 'react-native';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';
import type { BookRow } from '@/db/queries';
import { BookCover, COVER_RATIO } from '@/shelf/BookCover';
import { EASE_OUT_CUBIC, EASE_OUT_QUINT, isReduceMotion } from './motion';
import { useTheme } from './theme';

/**
 * 长按 · 进详情过场（设计稿「长按 · 进详情过场」）：
 * ① 按下 0–300ms：封面缩小压暗；② 抬起 300–420ms：封面弹到 1.15 倍，书架模糊变淡；
 * ③ 展开：封面用弹簧飞到详情页的大封面；返回时按相反路径飞回书架原位。
 * 页面本身用淡入淡出切换；飞行的是根布局上的一份封面副本，两端的真封面在飞行期间隐藏。
 */

type CoverBook = Pick<BookRow, 'id' | 'title' | 'subtitle' | 'category'>;
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 详情页底部区域：章节标题行 + 章节卡 + 按钮，必须与 app/book/[id].tsx 的布局一致 */
export const DETAIL_STRIP_HEAD = 20;
export const DETAIL_CARD_HEIGHT = 96;
export const DETAIL_ACTION_HEIGHT = 54;
const DETAIL_BOTTOM = 21 + DETAIL_STRIP_HEAD + 8 + DETAIL_CARD_HEIGHT + 22 + DETAIL_ACTION_HEIGHT;
export const DETAIL_COVER_RADIUS = 20;

/** 详情页大封面的位置：顶栏下方，宽度取屏幕宽减 60 与可用高度中较小者 */
export function detailCoverRect(insets: EdgeInsets, screen: { width: number; height: number }): Rect {
  // 顶栏：safe area + 4 + 40 按钮 + 4，封面再留 4
  const top = insets.top + 52;
  const bottom = detailBottomInset(insets) + DETAIL_BOTTOM;
  const width = Math.floor(Math.min(screen.width - 60, (screen.height - top - bottom) / COVER_RATIO));
  return { x: (screen.width - width) / 2, y: top, width, height: Math.round(width * COVER_RATIO) };
}

/** 详情页按钮离屏幕底部的距离 */
export const detailBottomInset = (insets: EdgeInsets) => Math.max(insets.bottom, 16) + 10;

export const FLIGHT_MS = 360;
const LIFT_MS = 120;
const LIFT_SCALE = 1.15;
/** 阻尼比 0.85 的弹簧 */
const SPRING = { stiffness: 260, damping: 2 * 0.85 * Math.sqrt(260), mass: 1 };

interface Flight {
  book: CoverBook;
  /** 书架上的位置 */
  shelf: Rect;
  direction: 'open' | 'close';
  /** 起飞后进入详情页 / 返回书架 */
  navigate: () => void;
}

/** 正在飞的书；飞行期间两端的真封面都隐藏，只看得到飞行的副本 */
type Hidden = string | null;

let show: ((f: Flight) => void) | null = null;
let hidden: Hidden = null;
const hiddenListeners = new Set<(h: Hidden) => void>();
/** 从书架进入详情时记下的封面，返回时重新测量，飞回它此刻的位置 */
const origins = new Map<string, { cover: HostInstance; rect: Rect }>();

function setHidden(h: Hidden) {
  hidden = h;
  hiddenListeners.forEach((l) => l(h));
}

/** 这本书的封面此刻是否正在飞（两端都要隐藏） */
export function useCoverHidden(id: string | undefined) {
  const [h, setH] = useState(hidden);
  useEffect(() => {
    hiddenListeners.add(setH);
    return () => {
      hiddenListeners.delete(setH);
    };
  }, []);
  return !!id && h === id;
}

const measure = (cover: HostInstance) =>
  new Promise<Rect>((resolve) => cover.measureInWindow((x, y, width, height) => resolve({ x, y, width, height })));

/** 长按封面：测量位置，抬起后飞向详情页；navigate 在抬起结束、开始飞行时进行 */
export function liftToDetail(book: CoverBook, cover: HostInstance | null, navigate: () => void) {
  if (!cover || !show || isReduceMotion()) return navigate();
  void measure(cover).then((shelf) => {
    origins.set(book.id, { cover, rect: shelf });
    setHidden(book.id);
    show?.({ book, shelf, direction: 'open', navigate });
  });
}

/** 从详情页返回：有起点时飞回书架，否则直接返回 */
export function flyBack(book: CoverBook | null, back: () => void) {
  const origin = book && origins.get(book.id);
  if (!book || !origin || !show || isReduceMotion()) return back();
  origins.delete(book.id);
  // 书架可能在详情页期间重新布局过，以此刻的位置为准；测量失败时用起飞时的位置
  void measure(origin.cover)
    .then((r) => (r.width > 0 ? r : origin.rect), () => origin.rect)
    .then((shelf) => {
      setHidden(book.id);
      show?.({ book, shelf, direction: 'close', navigate: back });
    });
}

/** 在根布局挂载一次，画在所有页面上面 */
export function CoverFlightHost() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const [flight, setFlight] = useState<Flight | null>(null);
  /** 0 = 在书架上，1 = 在详情页 */
  const [p] = useState(() => new Animated.Value(0));
  /** 抬起：0 = 原大，1 = 1.15 倍 */
  const [lift] = useState(() => new Animated.Value(0));
  /** 书架上的模糊遮罩 */
  const [veil] = useState(() => new Animated.Value(0));

  useEffect(() => {
    // 先把起点设好再渲染副本，否则第一帧会停在上一次飞行的终点
    show = (f) => {
      p.setValue(f.direction === 'open' ? 0 : 1);
      lift.setValue(0);
      veil.setValue(0);
      setFlight(f);
    };
    return () => {
      show = null;
    };
  }, [p, lift, veil]);

  useEffect(() => {
    if (!flight) return;
    const done = () => {
      setHidden(null);
      setFlight(null);
    };
    if (flight.direction === 'close') {
      flight.navigate();
      const anim = Animated.timing(p, { toValue: 0, duration: FLIGHT_MS, easing: EASE_OUT_QUINT, useNativeDriver: true });
      anim.start(done);
      return () => anim.stop();
    }
    const anim = Animated.sequence([
      Animated.parallel([
        Animated.timing(lift, { toValue: 1, duration: LIFT_MS, easing: EASE_OUT_CUBIC, useNativeDriver: true }),
        Animated.timing(veil, { toValue: 1, duration: LIFT_MS, easing: EASE_OUT_CUBIC, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.spring(p, { ...SPRING, toValue: 1, useNativeDriver: true }),
        Animated.spring(lift, { ...SPRING, toValue: 0, useNativeDriver: true }),
        // 详情页同时淡入，遮罩随之退场
        Animated.timing(veil, { toValue: 0, duration: 230, easing: EASE_OUT_CUBIC, useNativeDriver: true }),
      ]),
    ]);
    // 抬起结束时进入详情页
    const id = lift.addListener(({ value }) => {
      if (value < 1) return;
      lift.removeListener(id);
      flight.navigate();
    });
    anim.start(done);
    return () => {
      lift.removeListener(id);
      anim.stop();
    };
  }, [flight, p, lift, veil]);

  // 副本按详情页尺寸绘制，放在详情页位置；在书架一端时缩小并平移过去
  const to = detailCoverRect(insets, screen);
  const from = flight?.shelf;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {flight?.direction === 'open' && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: veil }]}>
          <BlurView intensity={18} tint={t.blurTint} style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: `${t.bg}66` }]} />
        </Animated.View>
      )}
      {flight && from && (
        <Animated.View
          style={{
            position: 'absolute',
            left: to.x,
            top: to.y,
            transform: [
              {
                translateX: p.interpolate({ inputRange: [0, 1], outputRange: [from.x + from.width / 2 - (to.x + to.width / 2), 0] }),
              },
              {
                translateY: p.interpolate({ inputRange: [0, 1], outputRange: [from.y + from.height / 2 - (to.y + to.height / 2), 0] }),
              },
              { scale: p.interpolate({ inputRange: [0, 1], outputRange: [from.width / to.width, 1] }) },
              { scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, LIFT_SCALE] }) },
            ],
          }}
        >
          <BookCover book={flight.book} width={to.width} radius={DETAIL_COVER_RADIUS} elevation={2} />
        </Animated.View>
      )}
    </View>
  );
}
