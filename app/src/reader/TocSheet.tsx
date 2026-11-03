import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BookRow, ChapterRow } from '@/db/queries';
import { BookCover } from '@/shelf/BookCover';
import { UpdatedTag } from '@/shelf/UpdatedTag';
import { Panel } from '@/ui/Panel';
import { useTheme } from '@/ui/theme';
import type { TocItem } from './bridge';

interface Props {
  visible: boolean;
  book: BookRow | null;
  chapters: ChapterRow[];
  currentIdx: number;
  /** 当前章节的 H1–H3，展开在当前章节下面 */
  headings: TocItem[];
  /** 视口所在小节的锚点 */
  activeAnchor?: string;
  readCount: number;
  onSelectChapter(idx: number): void;
  onSelectHeading(anchor: string): void;
  onClose(): void;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 目录：从左侧滑入的玻璃抽屉，当前章节展开小节 */
export function TocSheet({ visible, book, chapters, currentIdx, headings, activeAnchor, readCount, onSelectChapter, onSelectHeading, onClose }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  // H1 就是章标题，已经在章节行里显示了
  const subHeadings = headings.filter((h) => h.level > 1);
  const active = subHeadings.some((h) => h.anchor === activeAnchor) ? activeAnchor : subHeadings[0]?.anchor;

  return (
    <Panel visible={visible} side="left" onClose={onClose}>
      <View style={[styles.drawer, { shadowColor: t.shadow }]}>
        <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
          <BlurView intensity={60} tint={t.blurTint} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={t.dark ? ['#1C1F27F2', '#16181FE6'] : ['#FFFFFFE6', '#FFFFFFCC']} style={StyleSheet.absoluteFill} />
        </View>
        {book && (
          <View style={[styles.book, { paddingTop: insets.top + 18 }]}>
            <BookCover book={book} width={40} radius={6} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: t.fg, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>
                {book.title}
              </Text>
              <Text style={{ color: t.fg3, fontSize: 12 }}>
                {chapters.length} 章 · 已读 {readCount} 章
              </Text>
            </View>
          </View>
        )}
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}>
          {chapters.map((ch, i) => {
            const on = i === currentIdx;
            const past = i < currentIdx;
            return (
              <View key={ch.file}>
                <Pressable
                  onPress={() => onSelectChapter(i)}
                  style={({ pressed }) => [styles.chapter, on && { backgroundColor: `${t.accent}12` }, pressed && { backgroundColor: t.fill }]}
                >
                  <Text style={[styles.no, { color: on ? t.accent : t.fg4 }]}>{pad2(i + 1)}</Text>
                  <Text
                    style={{ flex: 1, fontSize: 14, color: on ? t.fg : past ? t.fg3 : t.fg, fontWeight: on ? '600' : '400' }}
                    numberOfLines={2}
                  >
                    {ch.title}
                  </Text>
                  {/* 正在读的这一章打开时就算读过了新版本 */}
                  {ch.updated && !on && <UpdatedTag />}
                </Pressable>
                {on &&
                  subHeadings.map((h) => {
                    const hit = h.anchor === active;
                    return (
                      <Pressable
                        key={h.anchor}
                        onPress={() => onSelectHeading(h.anchor)}
                        style={[styles.heading, { paddingLeft: h.level === 2 ? 44 : 58 }]}
                      >
                        <View style={[styles.bar, { backgroundColor: hit ? t.accent : t.track }]} />
                        <Text style={{ color: hit ? t.accent : t.fg2, fontSize: 13, fontWeight: hit ? '600' : '400', flex: 1 }} numberOfLines={1}>
                          {h.text}
                        </Text>
                      </Pressable>
                    );
                  })}
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  drawer: { flex: 1, shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 8, height: 0 } },
  book: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 22, paddingBottom: 18 },
  list: { paddingHorizontal: 12 },
  chapter: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 10 },
  no: { width: 18, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingRight: 10 },
  bar: { width: 2, height: 14, borderRadius: 1 },
});
