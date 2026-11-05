import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { BookRow } from '@/db/queries';
import { deleteBook } from '@/library/books';
import { countHighlights } from '@/notes/store';
import { Glass } from '@/ui/glass';
import { PressScale } from '@/ui/motion';
import { useTheme } from '@/ui/theme';
import { exportNotes } from './actions';
import { BookCover } from './BookCover';

interface Props {
  book: BookRow | null;
  visible: boolean;
  onClose(): void;
  onDeleted(): void;
}

/** 删除确认：有笔记时先提供「先导出笔记」 */
export function DeleteDialog({ book, visible, onClose, onDeleted }: Props) {
  const t = useTheme();
  const [notes, setNotes] = useState(0);

  useEffect(() => {
    if (visible && book) void countHighlights(book.id).then(setNotes);
  }, [visible, book]);

  if (!book) return null;

  const remove = async () => {
    await deleteBook(book.id);
    onClose();
    onDeleted();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.dark ? '#00000099' : '#1E2A5A40' }]} onPress={onClose} />
      <View style={styles.center} pointerEvents="box-none">
        <Glass radius={30} strong style={styles.alert}>
          <View style={styles.top}>
            <BookCover book={book} width={56} radius={6} />
            <Text style={[styles.title, { color: t.fg }]}>删除《{book.title}》？</Text>
            <Text style={[styles.body, { color: t.fg2 }]}>
              {notes > 0
                ? `阅读进度、高亮和 ${notes} 条笔记会一起删除，且无法恢复。建议先把笔记导出到电脑。`
                : '书籍文件和阅读进度会一起删除，且无法恢复。'}
            </Text>
          </View>
          <View style={styles.buttons}>
            {notes > 0 && (
              <DialogButton label="先导出笔记" color="#fff" bg={t.accent} onPress={() => void exportNotes(book.id)} />
            )}
            <DialogButton label="删除" color={t.danger} bg={`${t.danger}14`} onPress={() => void remove()} />
            <DialogButton label="取消" color={t.fg2} weight="500" onPress={onClose} />
          </View>
        </Glass>
      </View>
    </Modal>
  );
}

function DialogButton({ label, color, bg, weight = '600', onPress }: { label: string; color: string; bg?: string; weight?: '500' | '600'; onPress(): void }) {
  return (
    <PressScale onPress={onPress} style={[styles.button, { backgroundColor: bg }]} accessibilityRole="button">
      <Text style={{ color, fontSize: 15, fontWeight: weight }}>{label}</Text>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  alert: { width: 300 },
  top: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 28, paddingBottom: 20, gap: 10 },
  title: { fontSize: 17, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  body: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
  buttons: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  button: { height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
});
