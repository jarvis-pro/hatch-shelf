import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { BookRow } from '@/db/queries';
import { formatBytes } from '@/library/size-format';
import { countHighlightsByBook } from '@/notes/store';
import { exportNotes } from '@/shelf/actions';
import { BookCover } from '@/shelf/BookCover';
import { Glass } from '@/ui/glass';
import { PressScale } from '@/ui/motion';
import { useTheme } from '@/ui/theme';

interface Props {
  books: BookRow[];
  /** 选中书籍的总大小；还没统计完时不显示 */
  bytes?: number;
  visible: boolean;
  onClose(): void;
  onConfirm(): void;
}

/** 扇形叠放的封面：最多 4 本，左右两侧向外微倾 */
const FAN = [
  { x: 0, y: 12, r: 10 },
  { x: 32, y: 4, r: 4 },
  { x: 62, y: 4, r: -4 },
  { x: 94, y: 12, r: -10 },
];

/** 批量删除确认（设计稿「书籍管理 · 批量删除确认」）：有笔记时先提供「先导出笔记」 */
export function BatchDeleteDialog({ books, bytes, visible, onClose, onConfirm }: Props) {
  const t = useTheme();
  const [notes, setNotes] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (visible) void countHighlightsByBook(books.map((b) => b.id)).then(setNotes);
  }, [visible, books]);

  const noteTotal = [...notes.values()].reduce((s, n) => s + n, 0);
  const fan = books.slice(0, FAN.length);
  const fanWidth = 52 + (fan.length > 0 ? FAN[fan.length - 1].x : 0);

  const exportAll = async () => {
    // 分享面板一次只能带一个文件，有笔记的书逐本导出
    for (const b of books) if (notes.has(b.id)) await exportNotes(b.id);
  };

  const body = [
    bytes !== undefined && `共释放 ${formatBytes(bytes)}。`,
    noteTotal > 0
      ? `其中 ${notes.size} 本有笔记（共 ${noteTotal} 条），阅读进度和笔记会一起删除，且无法恢复。`
      : '书籍文件和阅读进度会一起删除，且无法恢复。',
  ]
    .filter(Boolean)
    .join('');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.dark ? '#00000099' : '#1E2A5A40' }]} onPress={onClose} />
      <View style={styles.center} pointerEvents="box-none">
        <Glass radius={30} strong style={styles.alert}>
          <View style={styles.top}>
            <View style={[styles.fan, { width: fanWidth }]}>
              {fan.map((b, i) => (
                <BookCover
                  key={b.id}
                  book={b}
                  width={52}
                  radius={6}
                  style={[styles.fanCover, { left: FAN[i].x, top: FAN[i].y, transform: [{ rotate: `${-FAN[i].r}deg` }] }]}
                />
              ))}
            </View>
            <Text style={[styles.title, { color: t.fg }]}>{books.length === 1 ? `删除《${books[0].title}》？` : `删除这 ${books.length} 本书？`}</Text>
            <Text style={[styles.body, { color: t.fg2 }]}>{body}</Text>
          </View>
          <View style={styles.buttons}>
            {noteTotal > 0 && <DialogButton label="先导出笔记" color="#fff" bg={t.accent} onPress={() => void exportAll()} />}
            <DialogButton label={`删除 ${books.length} 本`} color={t.danger} bg={`${t.danger}14`} onPress={onConfirm} />
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
  top: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 24, paddingBottom: 20, gap: 10 },
  fan: { height: 96 },
  fanCover: { position: 'absolute' },
  title: { fontSize: 17, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  body: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
  buttons: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  button: { height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
});
