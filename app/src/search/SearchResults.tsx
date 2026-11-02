import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ShelfColors } from '@/shelf/colors';
import { searchBooks, type SearchHit } from './query';

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
  return state;
}

export function SearchResults({ query, colors: c }: { query: string; colors: ShelfColors }) {
  const result = useSearch(query);
  if (!result) return null;
  if (result.hits.length === 0) {
    return <Text style={[styles.empty, { color: c.muted }]}>没有找到「{result.query}」</Text>;
  }

  const open = (h: SearchHit) =>
    router.push({
      pathname: '/read/[id]',
      params: { id: h.bookId, chapter: h.chapterFile, find: result.query, ...(h.anchor ? { anchor: h.anchor } : {}) },
    });

  return (
    <View style={styles.list}>
      <Text style={{ color: c.muted, fontSize: 13 }}>
        {result.hits.length >= 100 ? '前 100 条结果' : `${result.hits.length} 条结果`}
      </Text>
      {result.hits.map((h, i) => (
        <Pressable key={`${h.bookId}/${h.chapterFile}#${h.anchor ?? i}`} onPress={() => open(h)} style={[styles.hit, { backgroundColor: c.card }]}>
          <Text style={{ color: c.muted, fontSize: 12 }} numberOfLines={1}>
            {h.bookTitle} · {h.chapterTitle}
            {h.heading && h.heading !== h.chapterTitle ? ` · ${h.heading}` : ''}
          </Text>
          <Text style={{ color: c.fg, fontSize: 15, lineHeight: 22 }} numberOfLines={3}>
            {h.snippet.before}
            <Text style={{ color: c.accent, fontWeight: '600' }}>{h.snippet.match}</Text>
            {h.snippet.after}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  hit: { borderRadius: 12, padding: 12, gap: 4 },
  empty: { textAlign: 'center', paddingVertical: 48 },
});
