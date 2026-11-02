import { useEffect, useState } from 'react';
import { Animated, StyleSheet, useWindowDimensions, View, type HostInstance } from 'react-native';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';
import type { BookRow } from '@/db/queries';
import { BookCover, COVER_RATIO } from '@/shelf/BookCover';
import { EASE_OUT_QUINT, isReduceMotion } from './motion';

/**
 * 03 共享元素转场：书架封面飞向详情页的大封面，返回时飞回原位。
 * 页面本身用淡入淡出切换；飞行的是根布局上的一份封面副本，两端的真封面在飞行期间隐藏。
 */

type CoverBook = Pick<BookRow, 'id' | 'title' | 'subtitle' | 'category'>;
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 详情页大封面的宽度与位置，必须与 app/book/[id].tsx 的布局一致 */
export const DETAIL_COVER_WIDTH = 172;
const detailRect = (insets: EdgeInsets, screenWidth: number): Rect => ({
  x: (screenWidth - DETAIL_COVER_WIDTH) / 2,
  // 顶栏：safe area + 4 + 40 按钮 + 4，正文再留 14
  y: insets.top + 62,
  width: DETAIL_COVER_WIDTH,
  height: Math.round(DETAIL_COVER_WIDTH * COVER_RATIO),
});

export const FLIGHT_MS = 360;

interface Flight {
  book: CoverBook;
  /** 书架上的位置 */
  shelf: Rect;
  direction: 'open' | 'close';
}

/** 正在飞的书；飞行期间两端的真封面都隐藏，只看得到飞行的副本 */
type Hidden = string | null;

let show: ((f: Flight) => void) | null = null;
let hidden: Hidden = null;
const hiddenListeners = new Set<(h: Hidden) => void>();
/** 从书架进入详情时记下的起点，返回时飞回这里 */
const origins = new Map<string, Rect>();

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

/** 测量书架上的封面，然后飞向详情页；navigate 在起飞的同一帧进行 */
export function flyToDetail(book: CoverBook, cover: HostInstance | null, navigate: () => void) {
  if (!cover || !show || isReduceMotion()) return navigate();
  cover.measureInWindow((x, y, width, height) => {
    const shelf = { x, y, width, height };
    origins.set(book.id, shelf);
    setHidden(book.id);
    show?.({ book, shelf, direction: 'open' });
    navigate();
  });
}

/** 从详情页返回：有起点时飞回书架，否则直接返回 */
export function flyBack(book: CoverBook | null, back: () => void) {
  const shelf = book && origins.get(book.id);
  if (!book || !shelf || !show || isReduceMotion()) return back();
  origins.delete(book.id);
  setHidden(book.id);
  show({ book, shelf, direction: 'close' });
  back();
}

/** 在根布局挂载一次，画在所有页面上面 */
export function CoverFlightHost() {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const [flight, setFlight] = useState<Flight | null>(null);
  /** 0 = 在书架上，1 = 在详情页 */
  const [p] = useState(() => new Animated.Value(0));

  useEffect(() => {
    // 先把起点设好再渲染副本，否则第一帧会停在上一次飞行的终点
    show = (f) => {
      p.setValue(f.direction === 'open' ? 0 : 1);
      setFlight(f);
    };
    return () => {
      show = null;
    };
  }, [p]);

  useEffect(() => {
    if (!flight) return;
    const open = flight.direction === 'open';
    const anim = Animated.timing(p, { toValue: open ? 1 : 0, duration: FLIGHT_MS, easing: EASE_OUT_QUINT, useNativeDriver: true });
    anim.start(() => {
      setHidden(null);
      setFlight(null);
    });
    return () => anim.stop();
  }, [flight, p]);

  if (!flight) return null;
  // 副本按详情页尺寸绘制，放在详情页位置；飞在书架一端时缩小并平移过去
  const to = detailRect(insets, screenWidth);
  const from = flight.shelf;
  const scale = from.width / to.width;
  const dx = from.x + from.width / 2 - (to.x + to.width / 2);
  const dy = from.y + from.height / 2 - (to.y + to.height / 2);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View
        style={{
          position: 'absolute',
          left: to.x,
          top: to.y,
          transform: [
            { translateX: p.interpolate({ inputRange: [0, 1], outputRange: [dx, 0] }) },
            { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [dy, 0] }) },
            { scale: p.interpolate({ inputRange: [0, 1], outputRange: [scale, 1] }) },
          ],
        }}
      >
        <BookCover book={flight.book} width={to.width} radius={14} elevation={2} />
      </Animated.View>
    </View>
  );
}
