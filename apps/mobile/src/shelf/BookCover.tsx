import { File } from 'expo-file-system';
import { useContext, useMemo, type ReactNode, type Ref } from 'react';
import { Animated, Image, StyleSheet, Text, View, type HostInstance, type StyleProp, type ViewStyle } from 'react-native';
import type { BookRow } from '@/db/queries';
import { bookDir } from '@/lib/paths';
import { PressContext } from '@/ui/motion';
import { FILL_IMAGE, useTheme } from '@/ui/theme';
import { categoryLabel } from './categories';
import { coverColor } from './colors';

/** 书目录下的 cover.png；没有时返回 null */
export function useCoverUri(bookId: string | undefined) {
  return useMemo(() => {
    if (!bookId) return null;
    const f = new File(bookDir(bookId), 'cover.png');
    return f.exists ? f.uri : null;
  }, [bookId]);
}

type CoverBook = Pick<BookRow, 'id' | 'title' | 'subtitle' | 'category'>;

interface Props {
  book: CoverBook;
  /** 直接给出封面图（如推送请求里的缩略图）；不给时读书目录下的 cover.png */
  uri?: string;
  width: number;
  /** 圆角，默认按宽度取 */
  radius?: number;
  /** 投影强度：0 不投影 */
  elevation?: 0 | 1 | 2;
  style?: StyleProp<ViewStyle>;
  /** 叠在封面上的徽标（左下角进度、右上角原声），自行绝对定位 */
  children?: ReactNode;
  /** 用于测量封面在屏幕上的位置（共享元素转场） */
  ref?: Ref<HostInstance>;
}

/** 封面比例 300:428（设计稿原稿尺寸） */
export const COVER_RATIO = 428 / 300;

/** 有 cover.png 用图片，否则按「书架文库」版式生成文字封面 */
export function BookCover({ book, uri, width, radius, elevation = 1, style, children, ref }: Props) {
  const t = useTheme();
  // 在 PressScale 里时，按下会让阴影收紧并上移，像封面被按得贴近了书架
  const pressed = useContext(PressContext);
  const local = useCoverUri(book.id);
  const cover = uri ?? local;
  const height = Math.round(width * COVER_RATIO);
  const r = radius ?? (width >= 150 ? 14 : width >= 100 ? 12 : width >= 50 ? 8 : 4);
  const blur = elevation === 2 ? 22 : 12;
  const offset = elevation === 2 ? 20 : 10;
  const lerp = (from: number, to: number) => (pressed ? pressed.interpolate({ inputRange: [0, 1], outputRange: [from, to] }) : from);
  const shadow = elevation
    ? {
        shadowColor: t.coverShadow,
        shadowOpacity: t.dark ? 0.5 : elevation === 2 ? 0.28 : 0.18,
        shadowRadius: lerp(blur, blur * 0.5),
        shadowOffset: { width: 0, height: lerp(offset, offset * 0.4) },
      }
    : null;

  return (
    <Animated.View ref={ref} style={[{ width, height, borderRadius: r }, shadow, style]}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: r, overflow: 'hidden' }]}>
        {cover ? (
          <Image source={{ uri: cover }} style={FILL_IMAGE} resizeMode="cover" />
        ) : (
          <TextCover book={book} width={width} />
        )}
        {width >= 40 && <View style={[StyleSheet.absoluteFill, styles.stroke, { borderRadius: r }]} />}
      </View>
      {children}
    </Animated.View>
  );
}

/** 米色纸底 + 衬线书名 + 底部色带，配色取自分类 */
function TextCover({ book, width }: { book: CoverBook; width: number }) {
  const s = width / 300;
  const color = coverColor(book.category, book.id);
  const series = categoryLabel(book.category);
  if (width < 40) return <View style={[StyleSheet.absoluteFill, { backgroundColor: color }]} />;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#F3EEE4' }]}>
      <View style={{ paddingHorizontal: 24 * s, paddingTop: 26 * s, gap: 10 * s }}>
        {series && width >= 90 && (
          <Text style={[styles.series, { color, fontSize: 10 * s, letterSpacing: 2 * s }]} numberOfLines={1}>
            书架文库 · {series}
          </Text>
        )}
        {/* 缩略图（目录、笔记列表）里字太小，只保留版式 */}
        {width >= 90 && (
          <Text style={[styles.title, { fontSize: 34 * s, lineHeight: 42 * s }]} numberOfLines={3}>
            {book.title}
          </Text>
        )}
        {book.subtitle && width >= 90 && (
          <Text style={[styles.subtitle, { fontSize: 12 * s }]} numberOfLines={2}>
            {book.subtitle}
          </Text>
        )}
      </View>
      <View style={[styles.block, { backgroundColor: color, left: 24 * s, right: 24 * s, top: 190 * s, bottom: 56 * s }]}>
        <View style={[styles.blockInner, { borderColor: '#F3EEE466', margin: 10 * s }]} />
      </View>
      <View style={[styles.imprint, { backgroundColor: color, height: 32 * s, paddingHorizontal: 24 * s }]}>
        {width >= 90 && <Text style={[styles.imprintText, { fontSize: 18 * s }]}>Jarvis</Text>}
        <View style={[styles.mark, { width: 10 * s, height: 10 * s, borderRadius: 5 * s }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stroke: { borderWidth: 1, borderColor: '#FFFFFF66' },
  series: { fontWeight: '600' },
  title: { color: '#1A1A1A', fontWeight: '700', fontFamily: 'Songti SC' },
  subtitle: { color: '#4A4640' },
  block: { position: 'absolute', borderRadius: 2, opacity: 0.9 },
  blockInner: { flex: 1, borderWidth: 1 },
  imprint: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // 署名用 iOS 自带的手写体，与图片封面上的签名一致
  imprintText: { color: '#F3EEE4', fontFamily: 'Snell Roundhand' },
  mark: { backgroundColor: '#F3EEE4', marginLeft: 'auto' },
});
