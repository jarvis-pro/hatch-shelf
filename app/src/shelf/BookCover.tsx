import { File } from 'expo-file-system';
import { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { BookRow } from '@/db/queries';
import { bookDir } from '@/lib/paths';
import { coverColor } from './colors';

/** 有 cover.png 用图片，否则按标题和分类色生成文字封面 */
export function BookCover({ book, width }: { book: BookRow; width: number }) {
  const cover = useMemo(() => {
    const f = new File(bookDir(book.id), 'cover.png');
    return f.exists ? f.uri : null;
  }, [book.id]);
  const size = { width, height: Math.round(width * 1.4) };

  if (cover) return <Image source={{ uri: cover }} style={[styles.cover, size]} resizeMode="cover" />;

  return (
    <View style={[styles.cover, styles.textCover, size, { backgroundColor: coverColor(book.category, book.id) }]}>
      <View style={styles.spine} />
      <Text style={[styles.title, { fontSize: width > 140 ? 20 : 15 }]} numberOfLines={5}>
        {book.title}
      </Text>
      {book.category && (
        <Text style={styles.category} numberOfLines={1}>
          {book.category}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { borderRadius: 6, overflow: 'hidden' },
  textCover: { padding: 12, paddingLeft: 16, justifyContent: 'space-between' },
  spine: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, backgroundColor: 'rgba(0,0,0,0.18)' },
  title: { color: '#fff', fontWeight: '700', lineHeight: 22 },
  category: { color: 'rgba(255,255,255,0.75)', fontSize: 11 },
});
