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
      hasPrev: boolean;
      hasNext: boolean;
    }
  | { type: 'setTheme'; theme: ReaderTheme }
  | { type: 'scrollTo'; anchor: string };

/** WebView → RN，通过 window.ReactNativeWebView.postMessage(JSON.stringify(msg)) */
export type FromReader =
  | { type: 'ready' }
  | { type: 'rendered' }
  | { type: 'toc'; items: TocItem[] }
  | { type: 'position'; position: ReaderPosition }
  | { type: 'navigate'; to: 'prev' | 'next' }
  /** 点击了非页内锚点的链接；RN 决定是跳章节还是交给系统打开 */
  | { type: 'link'; href: string }
  | { type: 'error'; message: string };

export type ThemeMode = 'light' | 'dark' | 'sepia';

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
