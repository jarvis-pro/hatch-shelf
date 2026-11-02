/**
 * RN ↔ 阅读器 WebView 的 postMessage 协议。
 * 两端都只通过这里的类型收发消息（reader-web 以 type-only 方式引用本文件）；
 * 新增消息时同步修改两端。
 */

/** RN → WebView，通过 injectJavaScript 调用 window.__shelf.receive(msg) */
export type ToReader =
  | {
      type: 'load';
      markdown: string;
      /** 本书目录的 file:// URL，以 / 结尾；章节内的相对路径（图片）据此解析 */
      bookBaseUrl: string;
      theme: ReaderTheme;
      restore?: ReaderPosition;
      /** 第几章（从 1 开始），显示在章标题上方 */
      chapterNo: number;
      /** 搜索跳转时要标亮的关键词：在 restore.anchor 之后找第一处 */
      find?: string;
      highlights: HighlightMark[];
      /** 从笔记列表跳转时要滚到的高亮 id（优先于 restore） */
      focusHighlight?: string;
    }
  | { type: 'setTheme'; theme: ReaderTheme }
  | { type: 'scrollTo'; anchor: string }
  /** 用户点了选择菜单里的「高亮」/「笔记」，请阅读器回报当前选区 */
  | { type: 'captureSelection'; action: SelectionAction }
  /**
   * 新增、删除高亮或修改笔记后重绘本章高亮。
   * animate：刚新增的高亮从左到右扫过（in），刚删除的先反向收回再移除（out）
   */
  | { type: 'setHighlights'; highlights: HighlightMark[]; animate?: { id: string; kind: 'in' | 'out' } };

/** WebView → RN，通过 window.ReactNativeWebView.postMessage(JSON.stringify(msg)) */
export type FromReader =
  | { type: 'ready' }
  | { type: 'rendered' }
  | { type: 'toc'; items: TocItem[] }
  | { type: 'position'; position: ReaderPosition }
  /** 点击了非页内锚点的链接；RN 决定是跳章节还是交给系统打开 */
  | { type: 'link'; href: string }
  /** 回应 captureSelection；没有选中文字时 quote 为 null */
  | { type: 'selection'; action: SelectionAction; quote: Quote | null }
  | { type: 'highlightTap'; id: string }
  | { type: 'error'; message: string };

/** 跟随 App 外观，阅读页不单独设主题 */
export type ThemeMode = 'light' | 'dark';

export interface ReaderTheme {
  mode: ThemeMode;
  /** px */
  fontSize: number;
  lineHeight: number;
  wrapCode: boolean;
}

export interface ReaderPosition {
  /** 0–1，滚动距离 / 可滚动总高度 */
  scrollRatio: number;
  /** 视口顶部之上最近的标题 id */
  anchor?: string;
}

export interface TocItem {
  level: 1 | 2 | 3;
  text: string;
  anchor: string;
}

export type SelectionAction = 'highlight' | 'note';

/**
 * 一段原文的定位信息：原文本身加前后文。书更新后在正文里找所有出现原文的位置，
 * 取前后文最吻合的一处，比记录字符偏移更能承受内容修改。
 */
export interface Quote {
  text: string;
  /** 原文之前最多 32 个字符 */
  prefix: string;
  /** 原文之后最多 32 个字符 */
  suffix: string;
  /** 原文所在小节的标题锚点 */
  anchor?: string;
}

export interface HighlightMark extends Quote {
  id: string;
  hasNote: boolean;
}
