/**
 * RN ↔ 阅读器 WebView 的 postMessage 协议。
 * 两端都只通过这里的类型收发消息（packages/reader 以 type-only 方式引用本文件）；
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
      /** 最后一章正文之后的「接着读」（book.yaml 的 next）；不是最后一章或没有可推荐的书时省略 */
      next?: NextRead[];
    }
  | { type: 'setTheme'; theme: ReaderTheme }
  | { type: 'scrollTo'; anchor: string }
  /** 用户点了选择菜单里的「高亮」/「笔记」，请阅读器回报当前选区 */
  | { type: 'captureSelection'; action: SelectionAction }
  /**
   * 新增、删除高亮或修改笔记后重绘本章高亮。
   * animate：刚新增的高亮从左到右扫过（in），刚删除的先反向收回再移除（out）
   */
  | { type: 'setHighlights'; highlights: HighlightMark[]; animate?: { id: string; kind: 'in' | 'out' } }
  /**
   * 听书：请阅读器把本章切成可朗读的段落，回报 ttsBlocks。
   * following：后面各章的 Markdown，按同样的规则一起切好；App 在后台时 WebView 被冻结，读完本章后靠它接着读
   */
  | { type: 'ttsCollect'; following?: string[] }
  /**
   * 听书：标出正在读的第 index 段（ttsBlocks 里的下标），必要时滚过去；null 表示结束。
   * jump：用户主动跳段（上一段 / 下一段 / 拖进度）或自动换章后回到前台，不管刚才有没有手动滚走都滚过去
   */
  | { type: 'ttsMark'; index: number | null; jump?: boolean }
  /** 章内查找：标亮本章全部匹配（不区分大小写），当前处取视口里或之后的第一处；空字符串等同 clearFind */
  | { type: 'find'; query: string }
  /** 跳到上一处（-1）/ 下一处（1），首尾循环 */
  | { type: 'findStep'; delta: 1 | -1 }
  /** 关闭查找，清除全部查找标亮（也会清掉搜索跳转留下的那处） */
  | { type: 'clearFind' };

/** WebView → RN，通过 window.ReactNativeWebView.postMessage(JSON.stringify(msg)) */
export type FromReader =
  | { type: 'ready' }
  | { type: 'rendered' }
  | { type: 'toc'; items: TocItem[] }
  | { type: 'position'; position: ReaderPosition }
  /** 点击了非页内锚点的链接；RN 决定是跳章节、跳到另一本书还是交给系统打开。text 是链接文字 */
  | { type: 'link'; href: string; text: string }
  /** 回应 captureSelection；没有选中文字时 quote 为 null */
  | { type: 'selection'; action: SelectionAction; quote: Quote | null }
  | { type: 'highlightTap'; id: string }
  /** 回应 ttsCollect：按顺序排好的朗读文本，start 是视口里第一段的下标；following 与请求里的各章一一对应 */
  | { type: 'ttsBlocks'; texts: string[]; start: number; following: string[][] }
  /** 听书时手动滚动，正在读的段落离开（away）或回到屏幕；离开期间不自动跟随 */
  | { type: 'ttsAway'; away: boolean }
  /** 回应 find / findStep，以及查找中切换主题后的重新标亮。index 从 1 开始，没有匹配时 total 和 index 都是 0 */
  | { type: 'findResult'; query: string; index: number; total: number }
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

/** 「接着读」推荐的一本书；点按时阅读器发出 `../<id>/` 的 link 消息，与跨书链接走同一条路 */
export interface NextRead {
  id: string;
  /** 书架上没有这本书时为 null，阅读器提示先导入 */
  title: string | null;
  /** book.yaml 里的一句理由，没写时用那本书的副标题 */
  reason: string | null;
  /** cover.png 的 file:// URL；没有封面时画文字封面 */
  coverUrl: string | null;
  /** 文字封面的主色，与书架一致 */
  color: string;
}

export interface TocItem {
  level: 1 | 2 | 3;
  text: string;
  anchor: string;
}

/** doubt：存疑，读者觉得这里可能有错，修订时优先核实 */
export type SelectionAction = 'highlight' | 'note' | 'doubt';

export type HighlightKind = 'highlight' | 'doubt';

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
  kind: HighlightKind;
  hasNote: boolean;
}
