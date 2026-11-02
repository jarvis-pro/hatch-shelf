import { router } from 'expo-router';
import { ActionSheetIOS, Alert, Platform } from 'react-native';
import type { BookRow } from '@/db/queries';
import { deleteBook } from '@/library/books';

export function confirmDelete(book: BookRow, onDeleted: () => void) {
  Alert.alert(`删除《${book.title}》？`, '书籍文件和阅读进度都会被删除。', [
    { text: '取消', style: 'cancel' },
    { text: '删除', style: 'destructive', onPress: () => void deleteBook(book.id).then(onDeleted) },
  ]);
}

/** 书架上长按书籍弹出的操作 */
export function showBookActions(book: BookRow, onDeleted: () => void) {
  const info = () => router.push({ pathname: '/book/[id]', params: { id: book.id } });
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: book.title, options: ['书籍信息', '删除', '取消'], destructiveButtonIndex: 1, cancelButtonIndex: 2 },
      (i) => {
        if (i === 0) info();
        if (i === 1) confirmDelete(book, onDeleted);
      },
    );
  } else {
    Alert.alert(book.title, undefined, [
      { text: '书籍信息', onPress: info },
      { text: '删除', style: 'destructive', onPress: () => confirmDelete(book, onDeleted) },
      { text: '取消', style: 'cancel' },
    ]);
  }
}
