import { File, Paths } from 'expo-file-system';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Ellipsis, Headphones, List, NotebookPen, Type } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseBookLink } from '@shelf/spec';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
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
import { applyHighlightAction, chooseHighlightAction, promptNote } from '@/notes/prompts';
import { addHighlight, listHighlights, toMark } from '@/notes/store';
import type { FromReader, Quote, ReaderPosition, SelectionAction, ToReader, TocItem } from '@/reader/bridge';
import { loadNextReads } from '@/reader/next-reads';
import { COVER_MS, PagePlaceholder, type PlaceholderChapter } from '@/reader/PagePlaceholder';
import { ReadAloudBar } from '@/reader/ReadAloudBar';
import { SettingsSheet } from '@/reader/SettingsSheet';
import { useReadAloud } from '@/reader/speech';
import { loadReaderPrefs, onReaderPrefsChange, saveReaderPrefs, toReaderTheme, type ReaderPrefs } from '@/reader/theme';
import { TocSheet } from '@/reader/TocSheet';
import { WebView, type WebViewHandle } from '@/reader/web-view';
import { openBook, openNotes } from '@/shelf/actions';
import { GlassButton } from '@/ui/glass';
import { Menu } from '@/ui/Menu';
import { useTheme } from '@/ui/theme';

/**
 * 跨书链接 `../<id>/…`：在当前阅读页之上打开另一本书，返回时回到原处。
 * 书还没导入时用链接文字（通常是《书名》）提示，没有文字才显示 id
 */
async function openLinkedBook(bookId: string, label: string, chapter?: string, anchor?: string) {
  if (await getBook(bookId)) openBook(bookId, chapter, anchor);
  else Alert.alert('书架上还没有这本书', `需要先导入${label.startsWith('《') ? label.replace(/》.*$/, '》') : `「${bookId}」`}`);
}

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
  /** 阅读器已渲染完当前章节；之前由版式占位盖住 */
  const [rendered, setRendered] = useState(false);
  const [placeholder, setPlaceholder] = useState<PlaceholderChapter | null>(null);
  const [panel, setPanel] = useState<'menu' | 'toc' | 'settings' | null>(null);
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

  const speech = useReadAloud(send);
  const { stop: stopSpeech, onBlocks: onSpeechBlocks } = speech;
  const speaking = speech.state !== 'idle';

  // 章节一确定就画版式占位，不等 WebView；跳转或从中途继续时顶部没有章标题
  useEffect(() => {
    if (idx === null || chapters.length === 0) return;
    const ch = chapters[idx];
    // 同步读取：加载章节的 effect 会在第一次 await 之后清空这些 ref
    const jump = !!(pendingAnchor.current || pendingFind.current || pendingFocus.current);
    let cancelled = false;
    void (async () => {
      const saved = jump ? undefined : await getProgress(id, ch.file);
      const fromMiddle = jump || (!!saved && (saved.scrollRatio > 0 || !!saved.anchor));
      if (!cancelled) setPlaceholder({ no: idx + 1, title: fromMiddle ? null : ch.title });
    })().catch(() => !cancelled && setPlaceholder({ no: idx + 1, title: null }));
    return () => {
      cancelled = true;
    };
  }, [idx, chapters, id]);

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
      const next = idx === chapters.length - 1 ? await loadNextReads(id) : undefined;
      // 切章时等占位盖住旧正文再换内容
      if (shownFile.current) await new Promise((r) => setTimeout(r, COVER_MS));
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
        next,
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
      if (action !== 'highlight') {
        note = await promptNote(quote.text, '', action === 'doubt');
        if (note === null) return; // 取消
      }
      const added = await addHighlight(id, file, quote, note || null, action === 'doubt' ? 'doubt' : 'highlight');
      await refreshHighlights({ id: added, kind: 'in' });
    },
    [id, refreshHighlights],
  );

  const onHighlightTap = useCallback(
    async (highlightId: string) => {
      const h = (await listHighlights(id, shownFile.current ?? undefined)).find((x) => x.id === highlightId);
      if (!h) return;
      const deleted = await applyHighlightAction(h, await chooseHighlightAction(h));
      await refreshHighlights(deleted ? { id: h.id, kind: 'out' } : undefined);
    },
    [id, refreshHighlights],
  );

  const goTo = useCallback(
    (next: number, anchorTo?: string) => {
      if (next < 0 || next >= chapters.length) return;
      if (next === idx && anchorTo) return send({ type: 'scrollTo', anchor: anchorTo });
      // 听书只读当前这一章，换章即停
      if (speaking) stopSpeech();
      pendingAnchor.current = anchorTo ?? null;
      setRendered(false);
      setIdx(next);
    },
    [chapters.length, idx, send, speaking, stopSpeech],
  );

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      const msg = JSON.parse(e.nativeEvent.data) as FromReader;
      switch (msg.type) {
        case 'ready':
          sentTheme.current = themeKey;
          setWebReady(true);
          break;
        case 'rendered':
          setRendered(true);
          break;
        case 'toc':
          setToc(msg.items);
          break;
        case 'position':
          setAnchor(msg.position.anchor);
          if (shownFile.current) void saveProgress(id, shownFile.current, msg.position);
          break;
        case 'link': {
          // 链接写法见 @shelf/spec 的 parseBookLink；页内锚点由阅读器自己处理
          const link = parseBookLink(msg.href);
          if (link?.kind === 'external') {
            if (/^https?:/i.test(link.url)) void Linking.openURL(link.url);
          } else if (link?.kind === 'book' && link.bookId !== id) {
            openLinkedBook(link.bookId, msg.text, link.file, link.anchor).catch((err: Error) => setError(err.message));
          } else if (link && link.kind !== 'anchor' && link.file) {
            const target = chapters.findIndex((c) => c.file === link.file);
            if (target >= 0) goTo(target, link.anchor);
          }
          break;
        }
        case 'selection':
          onSelection(msg.action, msg.quote).catch((err: Error) => setError(err.message));
          break;
        case 'highlightTap':
          onHighlightTap(msg.id).catch((err: Error) => setError(err.message));
          break;
        case 'ttsBlocks':
          onSpeechBlocks(msg.texts, msg.start);
          break;
        case 'error':
          console.warn('[reader]', msg.message);
          break;
      }
    },
    [chapters, goTo, id, onSelection, onHighlightTap, themeKey, onSpeechBlocks],
  );

  const changePrefs = useCallback((next: ReaderPrefs) => {
    setPrefs(next);
    void saveReaderPrefs(next);
  }, []);

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
            { key: 'doubt', label: '存疑' },
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
            setRendered(false);
            webRef.current?.reload();
          }}
        />
      )}
      <PagePlaceholder
        visible={!rendered}
        chapter={prefs && placeholder}
        fontSize={prefs?.fontSize ?? 16}
        lineHeight={prefs?.lineHeight ?? 1.85}
      />
      {error && (
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: t.paper }]}>
          <Text style={[styles.error, { color: t.fg }]}>{error}</Text>
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
        <GlassButton icon={Ellipsis} label="更多" onPress={() => setPanel('menu')} />
      </View>

      {/* 不提供上一章 / 下一章，换章走目录，正文铺满到屏幕底 */}
      <Menu
        visible={panel === 'menu'}
        top={insets.top + 44}
        items={[
          { label: '目录', icon: List, onPress: () => setPanel('toc') },
          { label: '本书笔记', icon: NotebookPen, onPress: () => openNotes(id) },
          { label: '阅读设置', icon: Type, onPress: () => setPanel('settings') },
          speaking
            ? { label: '停止听书', icon: Headphones, onPress: stopSpeech }
            : { label: '听本章', icon: Headphones, onPress: speech.start },
        ]}
        onClose={() => setPanel(null)}
      />

      <ReadAloudBar
        state={speech.state}
        rate={speech.rate}
        onPause={speech.pause}
        onResume={speech.resume}
        onRate={speech.cycleRate}
        onStop={stopSpeech}
      />

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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  error: { padding: 24, textAlign: 'center', lineHeight: 22 },
  topFade: { position: 'absolute', left: 0, right: 0, top: 0 },
  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
});
