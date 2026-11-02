import { router } from 'expo-router';
import { ChevronRight, CircleX, Search } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { searchBooks, type SearchHit } from '@/search/query';
import { BookCover } from '@/shelf/BookCover';
import { Backdrop } from '@/ui/Backdrop';
import { Glass } from '@/ui/glass';
import { FadeInUp } from '@/ui/motion';
import { useTheme } from '@/ui/theme';

/** 输入停顿 200ms 后再查，避免每个按键都查一次 */
function useSearch(query: string) {
  const [state, setState] = useState<{ query: string; hits: SearchHit[] } | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let cancelled = false;
    const t = setTimeout(() => {
      searchBooks(q).then(
        (hits) => !cancelled && setState({ query: q, hits }),
        () => !cancelled && setState({ query: q, hits: [] }),
      );
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);
  // 清空输入框后不再显示上一次的结果
  return query.trim() ? state : null;
}

export default function SearchScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const result = useSearch(query);

  // 同一本书的命中归在一张卡片里，保持搜索结果的先后顺序
  const groups = useMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const h of result?.hits ?? []) map.set(h.bookId, [...(map.get(h.bookId) ?? []), h]);
    return [...map.values()];
  }, [result]);

  const open = (h: SearchHit) =>
    router.push({
      pathname: '/read/[id]',
      params: { id: h.bookId, chapter: h.chapterFile, find: result!.query, ...(h.anchor ? { anchor: h.anchor } : {}) },
    });

  return (
    <View style={styles.flex}>
      <Backdrop />
      <View style={[styles.searchRow, { paddingTop: insets.top + 6 }]}>
        <Glass radius={22} style={styles.field}>
          <Search size={17} color={t.fg2} />
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder="搜索全部书籍"
            placeholderTextColor={t.fg3}
            selectionColor={t.accent}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="never"
            style={[styles.input, { color: t.fg }]}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="清除">
              <CircleX size={17} color={t.fg3} />
            </Pressable>
          )}
        </Glass>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={{ color: t.accent, fontSize: 15, fontWeight: '500' }}>取消</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.results, { paddingBottom: insets.bottom + 32 }]}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
        {result && (
          <Text style={{ color: t.fg3, fontSize: 12 }}>
            {result.hits.length === 0
              ? `没有找到「${result.query}」`
              : `在 ${groups.length} 本书中找到 ${result.hits.length >= 100 ? '100+' : result.hits.length} 处`}
          </Text>
        )}
        {groups.map((hits, i) => (
          <FadeInUp key={hits[0].bookId} index={i}>
            <Glass radius={22} style={styles.book}>
              <View style={[styles.bookHead, { borderBottomColor: t.hairline }]}>
                <BookCover
                  book={{ id: hits[0].bookId, title: hits[0].bookTitle, subtitle: null, category: null }}
                  width={24}
                  radius={4}
                  elevation={0}
                />
                <Text style={[styles.bookTitle, { color: t.fg }]} numberOfLines={1}>
                  {hits[0].bookTitle}
                </Text>
                <Text style={{ color: t.fg3, fontSize: 12 }}>{hits.length} 处</Text>
              </View>
              {hits.map((h, j) => (
                <Pressable
                  key={`${h.chapterFile}#${h.anchor ?? ''}#${j}`}
                  onPress={() => open(h)}
                  style={({ pressed }) => [
                    styles.hit,
                    j > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.hairline },
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <View style={styles.where}>
                    <Text style={{ color: t.fg, fontSize: 13, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>
                      第 {h.chapterIdx + 1} 章 · {h.chapterTitle}
                    </Text>
                    {h.heading && h.heading !== h.chapterTitle && (
                      <>
                        <ChevronRight size={12} color={t.fg4} />
                        <Text style={{ color: t.fg3, fontSize: 12, flexShrink: 2 }} numberOfLines={1}>
                          {h.heading}
                        </Text>
                      </>
                    )}
                  </View>
                  <Text style={{ color: t.fg2, fontSize: 13, lineHeight: 20 }} numberOfLines={2}>
                    {h.snippet.before}
                    <Text style={{ color: t.fg, backgroundColor: `${t.accent}24` }}>{h.snippet.match}</Text>
                    {h.snippet.after}
                  </Text>
                </Pressable>
              ))}
            </Glass>
          </FadeInUp>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20 },
  field: { flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14 },
  input: { flex: 1, fontSize: 15, height: 44 },
  results: { paddingHorizontal: 20, paddingTop: 20, gap: 22 },
  book: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  bookHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 8 },
  bookTitle: { flex: 1, fontSize: 15, fontWeight: '700' },
  hit: { paddingVertical: 12, gap: 6 },
  where: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
