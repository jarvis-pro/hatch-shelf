import { File, Paths } from 'expo-file-system';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { WebViewMessageEvent } from 'react-native-webview';
import {
  getBook,
  getChapters,
  getLastChapter,
  getProgress,
  saveProgress,
  type BookRow,
  type ChapterRow,
} from '@/db/queries';
import { getReaderUri } from '@/library/bootstrap';
import { bookDir } from '@/lib/paths';
import type { FromReader, ReaderPosition, ReaderTheme, ToReader, TocItem } from '@/reader/bridge';
import { SettingsSheet } from '@/reader/SettingsSheet';
import { loadReaderTheme, PALETTE, saveReaderTheme } from '@/reader/theme';
import { TocSheet } from '@/reader/TocSheet';
import { WebView, type WebViewHandle } from '@/reader/web-view';

export default function ReaderScreen() {
  const { id, chapter: chapterParam } = useLocalSearchParams<{ id: string; chapter?: string }>();
  const webRef = useRef<WebViewHandle>(null);
  const [book, setBook] = useState<BookRow | null>(null);
  const [chapters, setChapters] = useState<ChapterRow[]>([]);
  const [theme, setTheme] = useState<ReaderTheme | null>(null);
  const [idx, setIdx] = useState<number | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [webReady, setWebReady] = useState(false);
  const [panel, setPanel] = useState<'toc' | 'settings' | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 跨章链接 `02-x.md#anchor` 跳过去时要定位的锚点 */
  const pendingAnchor = useRef<string | null>(null);
  /** WebView 当前显示的章节，用来给 position 消息归属，避免切章时串到别的章节 */
  const shownFile = useRef<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [b, chs, t] = await Promise.all([getBook(id), getChapters(id), loadReaderTheme()]);
      setBook(b);
      setChapters(chs);
      setTheme(t);
      const target = chapterParam ?? (await getLastChapter(id));
      setIdx(Math.max(0, chs.findIndex((c) => c.file === target)));
    })().catch((e: Error) => setError(e.message));
  }, [id, chapterParam]);

  const send = useCallback((msg: ToReader) => {
    webRef.current?.injectJavaScript(`window.__shelf.receive(${JSON.stringify(msg)});true;`);
  }, []);

  // WebView 就绪或切换章节时加载章节内容
  useEffect(() => {
    if (!webReady || idx === null || !theme || chapters.length === 0) return;
    const ch = chapters[idx];
    let cancelled = false;
    void (async () => {
      const dir = bookDir(id);
      const markdown = await new File(dir, ch.file).text();
      const anchor = pendingAnchor.current;
      pendingAnchor.current = null;
      const restore: ReaderPosition | undefined = anchor
        ? { scrollRatio: 0, anchor }
        : await getProgress(id, ch.file);
      if (cancelled) return;
      shownFile.current = ch.file;
      setToc([]);
      send({
        type: 'load',
        markdown,
        bookBaseUrl: dir.uri.endsWith('/') ? dir.uri : `${dir.uri}/`,
        theme,
        restore,
        hasPrev: idx > 0,
        hasNext: idx < chapters.length - 1,
      });
    })().catch((e: Error) => !cancelled && setError(`无法读取章节 ${ch.file}：${e.message}`));
    return () => {
      cancelled = true;
    };
    // theme 变化走 setTheme，不重新加载章节
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webReady, idx, chapters, id, send]);

  const goTo = useCallback(
    (next: number, anchor?: string) => {
      if (next < 0 || next >= chapters.length) return;
      if (next === idx && anchor) return send({ type: 'scrollTo', anchor });
      pendingAnchor.current = anchor ?? null;
      setIdx(next);
    },
    [chapters.length, idx, send],
  );

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      const msg = JSON.parse(e.nativeEvent.data) as FromReader;
      switch (msg.type) {
        case 'ready':
          setWebReady(true);
          break;
        case 'toc':
          setToc(msg.items);
          break;
        case 'position':
          if (shownFile.current) void saveProgress(id, shownFile.current, msg.position);
          break;
        case 'navigate':
          goTo((idx ?? 0) + (msg.to === 'next' ? 1 : -1));
          break;
        case 'link': {
          const m = /^(?:\.\/)?([a-z0-9-]+\.md)(?:#(.+))?$/.exec(msg.href);
          if (m) {
            const target = chapters.findIndex((c) => c.file === m[1]);
            if (target >= 0) goTo(target, m[2] ? decodeURIComponent(m[2]) : undefined);
          } else if (/^https?:/i.test(msg.href)) {
            void Linking.openURL(msg.href);
          }
          break;
        }
        case 'error':
          console.warn('[reader]', msg.message);
          break;
      }
    },
    [chapters, goTo, id, idx],
  );

  const changeTheme = useCallback(
    (next: ReaderTheme) => {
      setTheme(next);
      void saveReaderTheme(next);
      send({ type: 'setTheme', theme: next });
    },
    [send],
  );

  const palette = PALETTE[theme?.mode ?? 'light'];
  const current = idx !== null ? chapters[idx] : undefined;

  return (
    <View style={[styles.flex, { backgroundColor: palette.bg }]}>
      <Stack.Screen
        options={{
          title: current?.title ?? book?.title ?? '',
          headerStyle: { backgroundColor: palette.bg },
          headerTintColor: palette.fg,
          headerShadowVisible: false,
          headerRight: () => (
            <View style={styles.headerButtons}>
              <HeaderButton label="目录" color={palette.accent} onPress={() => setPanel('toc')} />
              <HeaderButton label="Aa" color={palette.accent} onPress={() => setPanel('settings')} />
            </View>
          ),
        }}
      />
      {theme && (
        <WebView
          ref={webRef}
          style={[styles.flex, { backgroundColor: palette.bg }]}
          source={{ uri: getReaderUri() }}
          // 允许读取整个 documentDirectory，书里的相对路径图片才能显示
          allowingReadAccessToURL={Paths.document.uri}
          allowFileAccess
          originWhitelist={['file://*']}
          onShouldStartLoadWithRequest={(req) => req.url === getReaderUri()}
          onMessage={onMessage}
          decelerationRate="normal"
          // 进程被系统回收后重新加载，ready 后会重新发 load
          onContentProcessDidTerminate={() => {
            setWebReady(false);
            webRef.current?.reload();
          }}
        />
      )}
      {(!webReady || error) && (
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: palette.bg }]}>
          {error ? (
            <Text style={[styles.error, { color: palette.fg }]}>{error}</Text>
          ) : (
            <ActivityIndicator color={palette.muted} />
          )}
        </View>
      )}
      {theme && (
        <TocSheet
          visible={panel === 'toc'}
          palette={palette}
          chapters={chapters}
          currentIdx={idx ?? 0}
          headings={toc}
          onSelectChapter={(i) => {
            setPanel(null);
            goTo(i);
          }}
          onSelectHeading={(anchor) => {
            setPanel(null);
            send({ type: 'scrollTo', anchor });
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {theme && (
        <SettingsSheet
          visible={panel === 'settings'}
          palette={palette}
          theme={theme}
          onChange={changeTheme}
          onClose={() => setPanel(null)}
        />
      )}
    </View>
  );
}

function HeaderButton({ label, color, onPress }: { label: string; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.headerButton}>
      <Text style={[styles.headerButtonText, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  error: { padding: 24, textAlign: 'center', lineHeight: 22 },
  headerButtons: { flexDirection: 'row', gap: 16 },
  headerButton: { paddingHorizontal: 4 },
  headerButtonText: { fontSize: 16, fontWeight: '500' },
});
