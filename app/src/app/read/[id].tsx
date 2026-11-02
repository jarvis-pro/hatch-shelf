import { File, Paths } from 'expo-file-system';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ChevronRight, List, NotebookPen, Type } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WebViewMessageEvent } from 'react-native-webview';
import {
  getBook,
  getChapters,
  getLastChapter,
  getProgress,
  getReadChapters,
  saveProgress,
  type BookRow,
  type ChapterRow,
} from '@/db/queries';
import { getReaderUri } from '@/library/bootstrap';
import { bookDir } from '@/lib/paths';
import { chooseHighlightAction, promptNote } from '@/notes/prompts';
import { addHighlight, deleteHighlight, listHighlights, setNote, toMark } from '@/notes/store';
import type { FromReader, Quote, ReaderPosition, SelectionAction, ToReader, TocItem } from '@/reader/bridge';
import { SettingsSheet } from '@/reader/SettingsSheet';
import { loadReaderPrefs, onReaderPrefsChange, saveReaderPrefs, toReaderTheme, type ReaderPrefs } from '@/reader/theme';
import { TocSheet } from '@/reader/TocSheet';
import { WebView, type WebViewHandle } from '@/reader/web-view';
import { openNotes } from '@/shelf/actions';
import { Glass, GlassButton } from '@/ui/glass';
import { ProgressBar } from '@/ui/motion';
import { useTheme } from '@/ui/theme';

export default function ReaderScreen() {
  const {
    id,
    chapter: chapterParam,
    anchor: anchorParam,
    find: findParam,
    highlight: highlightParam,
  } = useLocalSearchParams<{ id: string; chapter?: string; anchor?: string; find?: string; highlight?: string }>();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebViewHandle>(null);
  const [book, setBook] = useState<BookRow | null>(null);
  const [chapters, setChapters] = useState<ChapterRow[]>([]);
  const [prefs, setPrefs] = useState<ReaderPrefs | null>(null);
  const [idx, setIdx] = useState<number | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [anchor, setAnchor] = useState<string | undefined>();
  const [readCount, setReadCount] = useState(0);
  const [webReady, setWebReady] = useState(false);
  const [panel, setPanel] = useState<'toc' | 'settings' | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 跨章链接 `02-x.md#anchor` 或搜索结果跳过来时要定位的锚点 */
  const pendingAnchor = useRef<string | null>(anchorParam ?? null);
  /** 搜索跳转时要标亮的关键词，只用于第一次加载 */
  const pendingFind = useRef<string | null>(findParam ?? null);
  /** 从笔记列表跳过来时要滚到的高亮，只用于第一次加载 */
  const pendingFocus = useRef<string | null>(highlightParam ?? null);
  /** WebView 当前显示的章节，用来给 position 消息归属，避免切章时串到别的章节 */
  const shownFile = useRef<string | null>(null);

  // 阅读页不单独设主题，跟随 App 的外观
  const mode = t.dark ? 'dark' : 'light';
  const theme = prefs && toReaderTheme(prefs, mode);

  useEffect(() => {
    void (async () => {
      const [b, chs, p] = await Promise.all([getBook(id), getChapters(id), loadReaderPrefs()]);
      setBook(b);
      setChapters(chs);
      setPrefs(p);
      const target = chapterParam ?? (await getLastChapter(id));
      setIdx(Math.max(0, chs.findIndex((c) => c.file === target)));
    })().catch((e: Error) => setError(e.message));
  }, [id, chapterParam]);

  // 在设置页改了字号、行距时同步过来
  useEffect(() => onReaderPrefsChange(setPrefs), []);

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
      const anchorTo = pendingAnchor.current;
      const find = pendingFind.current;
      const focus = pendingFocus.current;
      pendingAnchor.current = null;
      pendingFind.current = null;
      pendingFocus.current = null;
      const restore: ReaderPosition | undefined =
        anchorTo || find || focus ? { scrollRatio: 0, anchor: anchorTo ?? undefined } : await getProgress(id, ch.file);
      const highlights = await listHighlights(id, ch.file);
      if (cancelled) return;
      shownFile.current = ch.file;
      setToc([]);
      setAnchor(undefined);
      send({
        type: 'load',
        markdown,
        bookBaseUrl: dir.uri.endsWith('/') ? dir.uri : `${dir.uri}/`,
        theme,
        restore,
        chapterNo: idx + 1,
        find: find ?? undefined,
        highlights: highlights.map(toMark),
        focusHighlight: focus ?? undefined,
      });
      setReadCount((await getReadChapters(id, idx)).size);
    })().catch((e: Error) => !cancelled && setError(`无法读取章节 ${ch.file}：${e.message}`));
    return () => {
      cancelled = true;
    };
    // 主题变化走 setTheme，不重新加载章节
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webReady, idx, chapters, id, send]);

  // 外观或字号行距变化时只换主题，阅读器会保持当前位置
  const themeKey = theme && JSON.stringify(theme);
  const sentTheme = useRef(themeKey);
  useEffect(() => {
    if (!webReady || !theme || sentTheme.current === themeKey) return;
    sentTheme.current = themeKey;
    send({ type: 'setTheme', theme });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeKey, webReady, send]);

  /** 高亮有变化后，重新取当前章节的高亮交给阅读器重绘；animate 指定刚新增或删除的那条做落笔动画 */
  const refreshHighlights = useCallback(
    async (animate?: { id: string; kind: 'in' | 'out' }) => {
      const file = shownFile.current;
      if (!file) return;
      const list = await listHighlights(id, file);
      send({ type: 'setHighlights', highlights: list.map(toMark), animate });
    },
    [id, send],
  );

  const onSelection = useCallback(
    async (action: SelectionAction, quote: Quote | null) => {
      const file = shownFile.current;
      if (!quote || !file) return;
      let note: string | null = null;
      if (action === 'note') {
        note = await promptNote(quote.text);
        if (note === null) return; // 取消
      }
      const added = await addHighlight(id, file, quote, note || null);
      await refreshHighlights({ id: added, kind: 'in' });
    },
    [id, refreshHighlights],
  );

  const onHighlightTap = useCallback(
    async (highlightId: string) => {
      const h = (await listHighlights(id, shownFile.current ?? undefined)).find((x) => x.id === highlightId);
      if (!h) return;
      const action = await chooseHighlightAction(h.text, !!h.note);
      if (action === 'delete') {
        await deleteHighlight(h.id);
        return refreshHighlights({ id: h.id, kind: 'out' });
      }
      if (action === 'note') {
        const note = await promptNote(h.text, h.note ?? '');
        if (note === null) return;
        await setNote(h.id, note || null);
      }
      await refreshHighlights();
    },
    [id, refreshHighlights],
  );

  const goTo = useCallback(
    (next: number, anchorTo?: string) => {
      if (next < 0 || next >= chapters.length) return;
      if (next === idx && anchorTo) return send({ type: 'scrollTo', anchor: anchorTo });
      pendingAnchor.current = anchorTo ?? null;
      setIdx(next);
    },
    [chapters.length, idx, send],
  );

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      const msg = JSON.parse(e.nativeEvent.data) as FromReader;
      switch (msg.type) {
        case 'ready':
          sentTheme.current = themeKey;
          setWebReady(true);
          break;
        case 'toc':
          setToc(msg.items);
          break;
        case 'position':
          setAnchor(msg.position.anchor);
          if (shownFile.current) void saveProgress(id, shownFile.current, msg.position);
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
        case 'selection':
          onSelection(msg.action, msg.quote).catch((err: Error) => setError(err.message));
          break;
        case 'highlightTap':
          onHighlightTap(msg.id).catch((err: Error) => setError(err.message));
          break;
        case 'error':
          console.warn('[reader]', msg.message);
          break;
      }
    },
    [chapters, goTo, id, onSelection, onHighlightTap, themeKey],
  );

  const changePrefs = useCallback((next: ReaderPrefs) => {
    setPrefs(next);
    void saveReaderPrefs(next);
  }, []);

  const total = chapters.length;
  const at = idx ?? 0;

  return (
    <View style={[styles.flex, { backgroundColor: t.paper }]}>
      {theme && (
        <WebView
          ref={webRef}
          style={[styles.flex, { backgroundColor: t.paper }]}
          source={{ uri: getReaderUri() }}
          // 允许读取整个 documentDirectory，书里的相对路径图片才能显示
          allowingReadAccessToURL={Paths.document.uri}
          allowFileAccess
          // 长按选中文字后，系统菜单里多出「高亮」「笔记」
          menuItems={[
            { key: 'highlight', label: '高亮' },
            { key: 'note', label: '笔记' },
          ]}
          onCustomMenuSelection={(e) =>
            send({ type: 'captureSelection', action: e.nativeEvent.key as SelectionAction })
          }
          originWhitelist={['file://*']}
          onShouldStartLoadWithRequest={(req) => req.url === getReaderUri()}
          onMessage={onMessage}
          decelerationRate="normal"
          contentInsetAdjustmentBehavior="never"
          // 进程被系统回收后重新加载，ready 后会重新发 load
          onContentProcessDidTerminate={() => {
            setWebReady(false);
            webRef.current?.reload();
          }}
        />
      )}
      {(!webReady || error) && (
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: t.paper }]}>
          {error ? (
            <Text style={[styles.error, { color: t.fg }]}>{error}</Text>
          ) : (
            <ActivityIndicator color={t.fg3} />
          )}
        </View>
      )}

      {/* 状态栏下方淡出，滚动的正文不会和时间、电量叠在一起 */}
      <LinearGradient
        colors={[t.paper, `${t.paper}00`]}
        style={[styles.topFade, { height: insets.top + 12 }]}
        pointerEvents="none"
      />
      <View style={[styles.topBar, { top: insets.top - 4 }]} pointerEvents="box-none">
        <GlassButton icon={ChevronLeft} label="返回" onPress={() => router.back()} />
        <View style={styles.topRight}>
          <GlassButton icon={List} label="目录" onPress={() => setPanel('toc')} />
          <GlassButton icon={NotebookPen} label="笔记" onPress={() => openNotes(id)} />
          <GlassButton icon={Type} label="阅读设置" onPress={() => setPanel('settings')} />
        </View>
      </View>

      <LinearGradient
        colors={[`${t.paper}00`, `${t.paper}E6`]}
        locations={[0, 0.6]}
        style={[styles.bottom, { paddingBottom: insets.bottom + 8 }]}
        pointerEvents="box-none"
      >
        <Glass radius={26} style={styles.navPill}>
          <NavButton label="上一章" disabled={at <= 0} onPress={() => goTo(at - 1)} left />
          <View style={styles.mid}>
            <Text style={[styles.counter, { color: t.fg }]}>
              {total ? at + 1 : 0} / {total}
            </Text>
            <ProgressBar value={total ? (at + 1) / total : 0} height={3} track={t.track} fill={t.accent} style={{ width: 64 }} />
          </View>
          <NavButton label="下一章" disabled={at >= total - 1} onPress={() => goTo(at + 1)} />
        </Glass>
      </LinearGradient>

      <TocSheet
        visible={panel === 'toc'}
        book={book}
        chapters={chapters}
        currentIdx={at}
        headings={toc}
        activeAnchor={anchor}
        readCount={readCount}
        onSelectChapter={(i) => {
          setPanel(null);
          goTo(i);
        }}
        onSelectHeading={(a) => {
          setPanel(null);
          send({ type: 'scrollTo', anchor: a });
        }}
        onClose={() => setPanel(null)}
      />
      {prefs && (
        <SettingsSheet visible={panel === 'settings'} prefs={prefs} onChange={changePrefs} onClose={() => setPanel(null)} />
      )}
    </View>
  );
}

function NavButton({ label, left, disabled, onPress }: { label: string; left?: boolean; disabled: boolean; onPress(): void }) {
  const t = useTheme();
  const Icon = left ? ChevronLeft : ChevronRight;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.navBtn, { opacity: disabled ? 0.35 : 1 }, pressed && { backgroundColor: t.fill }]}
      accessibilityRole="button"
    >
      {left && <Icon size={16} color={t.fg2} />}
      <Text style={{ color: t.fg2, fontSize: 13 }}>{label}</Text>
      {!left && <Icon size={16} color={t.fg2} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  error: { padding: 24, textAlign: 'center', lineHeight: 22 },
  topFade: { position: 'absolute', left: 0, right: 0, top: 0 },
  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  topRight: { flexDirection: 'row', gap: 8 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 28, paddingHorizontal: 20 },
  navPill: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6 },
  navBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20 },
  mid: { alignItems: 'center', gap: 5 },
  counter: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
