import { File } from 'expo-file-system';
import { useMemo, type ReactNode } from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { BookRow } from '@/db/queries';
import { bookDir } from '@/lib/paths';
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
  width: number;
  /** 圆角，默认按宽度取 */
  radius?: number;
  /** 投影强度：0 不投影 */
  elevation?: 0 | 1 | 2;
  style?: StyleProp<ViewStyle>;
  /** 叠在封面左下角的徽标（进度） */
  children?: ReactNode;
}

/** 封面比例 300:428（设计稿原稿尺寸） */
export const COVER_RATIO = 428 / 300;

/** 有 cover.png 用图片，否则按「书架文库」版式生成文字封面 */
export function BookCover({ book, width, radius, elevation = 1, style, children }: Props) {
  const t = useTheme();
  const cover = useCoverUri(book.id);
  const height = Math.round(width * COVER_RATIO);
  const r = radius ?? (width >= 150 ? 14 : width >= 100 ? 12 : width >= 50 ? 8 : 4);
  const shadow = elevation
    ? {
        shadowColor: t.coverShadow,
        shadowOpacity: t.dark ? 0.5 : elevation === 2 ? 0.28 : 0.18,
        shadowRadius: elevation === 2 ? 22 : 12,
        shadowOffset: { width: 0, height: elevation === 2 ? 20 : 10 },
      }
    : null;

  return (
    <View style={[{ width, height, borderRadius: r }, shadow, style]}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: r, overflow: 'hidden' }]}>
        {cover ? (
          <Image source={{ uri: cover }} style={FILL_IMAGE} resizeMode="cover" />
        ) : (
          <TextCover book={book} width={width} />
        )}
        {width >= 40 && <View style={[StyleSheet.absoluteFill, styles.stroke, { borderRadius: r }]} />}
      </View>
      {children}
    </View>
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
        {width >= 90 && <Text style={[styles.imprintText, { fontSize: 9 * s, letterSpacing: 2.5 * s }]}>HATCH SHELF</Text>}
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
  imprintText: { color: '#F3EEE4', fontWeight: '600' },
  mark: { backgroundColor: '#F3EEE4', marginLeft: 'auto' },
});
