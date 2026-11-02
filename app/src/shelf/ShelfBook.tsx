import { useRef } from 'react';
import { StyleSheet, Text, View, type HostInstance } from 'react-native';
import type { BookProgress, BookRow } from '@/db/queries';
import { flyToDetail, useCoverHidden } from '@/ui/CoverFlight';
import { PressScale } from '@/ui/motion';
import { useTheme } from '@/ui/theme';
import { openDetail, peekBook } from './actions';
import { BookCover } from './BookCover';
import { bookMeta, ProgressBadge } from './progress';

/** 书架上的一本书：封面 + 书名 + 章数和进度。点按进入详情（封面飞过去），长按预览 */
export function ShelfBook({
  book,
  progress,
  width,
  animateProgress,
  index,
}: {
  book: BookRow;
  progress?: BookProgress;
  width: number;
  animateProgress?: boolean;
  index?: number;
}) {
  const t = useTheme();
  const cover = useRef<HostInstance>(null);
  // 封面在飞行时先藏起真封面，落地后再显示
  const hidden = useCoverHidden(book.id);
  return (
    <PressScale
      style={{ width, gap: 10 }}
      onPress={() => flyToDetail(book, cover.current, () => openDetail(book.id))}
      onLongPress={() => peekBook(book.id)}
    >
      <BookCover ref={cover} book={book} width={width} style={hidden && styles.hidden}>
        <ProgressBadge progress={progress} animate={animateProgress} index={index} />
      </BookCover>
      <View style={{ gap: 4 }}>
        <Text style={[styles.bookTitle, { color: t.fg }]} numberOfLines={1}>
          {book.title}
        </Text>
        <Text style={{ color: t.fg3, fontSize: 11 }} numberOfLines={1}>
          {bookMeta(book, progress)}
        </Text>
      </View>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  bookTitle: { fontSize: 14, fontWeight: '600' },
  hidden: { opacity: 0 },
});
