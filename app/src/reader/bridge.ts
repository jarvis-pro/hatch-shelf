/**
 * RN ↔ 阅读器 WebView 的 postMessage 协议。
 * 两端都只通过这里的类型收发消息；新增消息时同步修改两端。
 */

/** RN → WebView */
export type ToReader =
  | { type: 'load'; html: string; theme: ReaderTheme; restore?: ReaderPosition }
  | { type: 'setTheme'; theme: ReaderTheme }
  | { type: 'scrollTo'; anchor: string };

/** WebView → RN */
export type FromReader =
  | { type: 'ready' }
  | { type: 'toc'; items: TocItem[] }
  | { type: 'position'; position: ReaderPosition }
  | { type: 'openImage'; src: string }
  | { type: 'copy'; text: string };

export interface ReaderTheme {
  mode: 'light' | 'dark' | 'sepia';
  fontSize: number;
  lineHeight: number;
  wrapCode: boolean;
}

export interface ReaderPosition {
  scrollRatio: number;
  anchor?: string;
}

export interface TocItem {
  level: 1 | 2 | 3;
  text: string;
  anchor: string;
}
