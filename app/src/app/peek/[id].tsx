import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { BookOpen, Info, NotebookPen, Trash2, X, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getBook, listBookProgress, type BookProgress, type BookRow } from '@/db/queries';
import { countHighlights } from '@/notes/store';
import { openBook, openDetail, openNotes } from '@/shelf/actions';
import { BookCover, useCoverUri } from '@/shelf/BookCover';
import { categoryLabel } from '@/shelf/categories';
import { coverColor } from '@/shelf/colors';
import { DeleteDialog } from '@/shelf/DeleteDialog';
import { Glass, GlassButton } from '@/ui/glass';
import { FadeInUp, PressScale, ProgressBar } from '@/ui/motion';
import { FILL_IMAGE, useTheme } from '@/ui/theme';

/** 长按书架上的封面：放大的封面 + 进度 + 快捷操作 */
export default function PeekScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const cover = useCoverUri(id);
  const [book, setBook] = useState<BookRow | null>(null);
  const [progress, setProgress] = useState<BookProgress | undefined>();
  const [highlights, setHighlights] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    void Promise.all([getBook(id), listBookProgress(), countHighlights(id)]).then(([b, p, n]) => {
      setBook(b);
      setProgress(p.get(id));
      setHighlights(n);
    });
  }, [id]);

  // 先关掉预览再跳转，返回时直接回到书架
  const go = (fn: () => void) => {
    router.back();
    fn();
  };

  const veil = t.dark ? '#0A0C11' : '#F4F5FA';
  const meta = [book && categoryLabel(book.category), book && `${book.chapterCount} 章`, highlights > 0 && `${highlights} 条高亮`].filter(Boolean).join(' · ');

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      {cover ? (
        <View style={styles.art}>
          <Image source={{ uri: cover }} blurRadius={70} style={FILL_IMAGE} resizeMode="cover" />
        </View>
      ) : (
        book && <View style={[styles.art, { backgroundColor: coverColor(book.category, book.id), opacity: 0.35 }]} />
      )}
      <LinearGradient colors={[`${veil}66`, `${veil}B3`, `${veil}E6`]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />

      <View style={[styles.top, { paddingTop: insets.top + 4 }]}>
        <GlassButton icon={X} label="关闭" onPress={() => router.back()} />
      </View>

      {book && (
        <FadeInUp style={styles.center}>
          <BookCover book={book} width={196} radius={16} elevation={2} />
          <View style={styles.titles}>
            <Text style={[styles.title, { color: t.fg }]} numberOfLines={2}>
              {book.title}
            </Text>
            <Text style={{ color: t.fg2, fontSize: 13 }}>{meta}</Text>
          </View>
          {progress && (
            <View style={styles.progress}>
              <ProgressBar value={progress.ratio} track={t.track} fill={t.accent} style={{ width: 180 }} />
              <Text style={{ color: t.fg3, fontSize: 11 }}>
                {progress.finished ? '已读完' : `读到第 ${progress.chapterIdx + 1} 章`}
              </Text>
            </View>
          )}
          <View style={styles.actions}>
            <Action icon={BookOpen} label={progress ? '继续阅读' : '开始阅读'} primary onPress={() => go(() => openBook(id))} />
            <Action icon={Info} label="书籍信息" onPress={() => go(() => openDetail(id))} />
            <Action icon={NotebookPen} label="笔记" onPress={() => go(() => openNotes(id))} />
          </View>
        </FadeInUp>
      )}

      <View style={[styles.deleteWrap, { bottom: insets.bottom + 40 }]}>
        <PressScale style={styles.delete} onPress={() => setDeleting(true)} hitSlop={12}>
          <Trash2 size={14} color={t.danger} />
          <Text style={{ color: t.danger, fontSize: 13, fontWeight: '500' }}>从书架删除</Text>
        </PressScale>
      </View>

      <DeleteDialog book={book} visible={deleting} onClose={() => setDeleting(false)} onDeleted={() => router.back()} />
    </View>
  );
}

function Action({ icon: Icon, label, primary, onPress }: { icon: LucideIcon; label: string; primary?: boolean; onPress(): void }) {
  const t = useTheme();
  return (
    <PressScale style={styles.action} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {primary ? (
        <View style={[styles.circle, styles.primary, { backgroundColor: t.accent, shadowColor: t.accent }]}>
          <Icon size={22} color="#fff" />
        </View>
      ) : (
        <Glass radius={29} style={styles.circle}>
          <Icon size={22} color={t.fg} />
        </Glass>
      )}
      <Text style={{ color: t.ink, fontSize: 12, fontWeight: '500' }}>{label}</Text>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  art: { position: 'absolute', left: -120, right: -120, top: -120, bottom: -120 },
  top: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 20 },
  center: { alignItems: 'center', paddingTop: 56, paddingHorizontal: 28 },
  titles: { alignItems: 'center', gap: 6, paddingTop: 28 },
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -0.3, textAlign: 'center' },
  progress: { alignItems: 'center', gap: 6, paddingTop: 16 },
  actions: { flexDirection: 'row', gap: 26, paddingTop: 34 },
  action: { alignItems: 'center', gap: 8, width: 58 },
  circle: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  primary: { shadowOpacity: 0.3, shadowRadius: 11, shadowOffset: { width: 0, height: 10 } },
  deleteWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  delete: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
