import type { ComponentType, RefAttributes } from 'react';
import { WebView as RNWebView, type WebViewProps } from 'react-native-webview';

export type WebViewHandle = { injectJavaScript(script: string): void; reload(): void };

// 上游类型声明为 `class WebView<P = undefined> extends Component<WebViewProps & P>`，
// P 取默认值时 props 变成 never；这里重新标注一次类型
export const WebView = RNWebView as unknown as ComponentType<WebViewProps & RefAttributes<WebViewHandle>>;
