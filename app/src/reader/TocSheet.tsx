import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ChapterRow } from '@/db/queries';
import type { TocItem } from './bridge';
import type { PALETTE } from './theme';

interface Props {
  visible: boolean;
  palette: (typeof PALETTE)[keyof typeof PALETTE];
  chapters: ChapterRow[];
  currentIdx: number;
  /** 当前章节的 H1–H3，展开在当前章节下面 */
  headings: TocItem[];
  onSelectChapter(idx: number): void;
  onSelectHeading(anchor: string): void;
  onClose(): void;
}

export function TocSheet({ visible, palette, chapters, currentIdx, headings, onSelectChapter, onSelectHeading, onClose }: Props) {
  const insets = useSafeAreaInsets();
  // H1 就是章标题，已经在章节行里显示了
  const subHeadings = headings.filter((h) => h.level > 1);
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: palette.bg }]}>
        <View style={[styles.header, { borderColor: palette.border }]}>
          <Text style={[styles.title, { color: palette.fg }]}>目录</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={{ color: palette.accent, fontSize: 16 }}>完成</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
          {chapters.map((ch, i) => (
            <View key={ch.file}>
              <Pressable
                onPress={() => onSelectChapter(i)}
                style={[styles.chapter, i === currentIdx && { backgroundColor: palette.card }]}
              >
                <Text style={[styles.chapterNo, { color: palette.muted }]}>{i + 1}</Text>
                <Text
                  style={[styles.chapterTitle, { color: i === currentIdx ? palette.accent : palette.fg }]}
                  numberOfLines={2}
                >
                  {ch.title}
                </Text>
              </Pressable>
              {i === currentIdx &&
                subHeadings.map((h) => (
                  <Pressable
                    key={h.anchor}
                    onPress={() => onSelectHeading(h.anchor)}
                    style={[styles.heading, { paddingLeft: h.level === 2 ? 52 : 68 }]}
                  >
                    <Text style={{ color: h.level === 2 ? palette.fg : palette.muted, fontSize: 15 }} numberOfLines={1}>
                      {h.text}
                    </Text>
                  </Pressable>
                ))}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: '600' },
  chapter: { flexDirection: 'row', alignItems: 'baseline', paddingVertical: 14, paddingHorizontal: 20, gap: 12 },
  chapterNo: { width: 20, textAlign: 'right', fontVariant: ['tabular-nums'] },
  chapterTitle: { flex: 1, fontSize: 16, fontWeight: '500' },
  heading: { paddingVertical: 10, paddingRight: 20 },
});
