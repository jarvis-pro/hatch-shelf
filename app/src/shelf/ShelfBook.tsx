import { StyleSheet, Text, View } from 'react-native';
import type { BookProgress, BookRow } from '@/db/queries';
import { useCoverHidden } from '@/ui/CoverFlight';
import { PressScale } from '@/ui/motion';
import { useTheme } from '@/ui/theme';
import { useBookPress } from './actions';
import { AudioBadge } from './AudioBadge';
import { BookCover } from './BookCover';
import { bookMeta, ProgressBadge } from './progress';

/** 书架上的一本书：封面 + 书名 + 章数和进度。点按直接进阅读页，长按进详情（封面飞过去） */
export function ShelfBook({
  book,
  progress,
  width,
  animateProgress,
  index,
  audio = false,
}: {
  book: BookRow;
  progress?: BookProgress;
  /** 有原声时封面右上角显示「原声」 */
  audio?: boolean;
  width: number;
  animateProgress?: boolean;
  index?: number;
}) {
  const t = useTheme();
  const { cover, press } = useBookPress(book);
  // 封面在飞行时先藏起真封面，落地后再显示
  const hidden = useCoverHidden(book.id);
  return (
    <PressScale style={{ width, gap: 10 }} {...press}>
      <BookCover ref={cover} book={book} width={width} style={hidden && styles.hidden}>
        <ProgressBadge progress={progress} animate={animateProgress} index={index} />
        {audio && <AudioBadge />}
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
