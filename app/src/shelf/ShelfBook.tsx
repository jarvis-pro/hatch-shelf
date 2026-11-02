import { StyleSheet, Text, View } from 'react-native';
import type { BookProgress, BookRow } from '@/db/queries';
import { PressScale } from '@/ui/motion';
import { useTheme } from '@/ui/theme';
import { openBook, peekBook } from './actions';
import { BookCover } from './BookCover';
import { bookMeta, ProgressBadge } from './progress';

/** 书架上的一本书：封面 + 书名 + 章数和进度 */
export function ShelfBook({ book, progress, width }: { book: BookRow; progress?: BookProgress; width: number }) {
  const t = useTheme();
  return (
    <PressScale style={{ width, gap: 10 }} onPress={() => openBook(book.id)} onLongPress={() => peekBook(book.id)}>
      <BookCover book={book} width={width}>
        <ProgressBadge progress={progress} />
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
});
