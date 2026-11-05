/**
 * Markdown → HTML：阅读器显示正文与 shelf-pack 生成录音共用这一份配置（README 第 8.1 节），
 * 两边切出的朗读段落才能逐条对上。这里不碰 DOM，Node 里也能直接运行。
 */
import { createSlugger } from '@shelf/spec/markdown';
import katexModule from '@vscode/markdown-it-katex';
import hljs from 'highlight.js/lib/common';
import MarkdownIt, { type Env, type Token } from 'markdown-it';
import { calloutPlugin } from './callouts';
import type { TocItem } from '../../../apps/mobile/src/reader/bridge';

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Lucide 的 copy / check 图标，与 App 其他地方一致 */
export const svg = (body: string) =>
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
export const ICON_COPY = svg('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>');
export const ICON_CHECK = svg('<path d="M20 6 9 17l-5-5"/>');
export const ICON_CHEVRON = svg('<path d="m9 18 6-6-6-6"/>');

// 该包是带 __esModule 的 CJS；esbuild 按 Node 语义把整个 exports 当作 default
const katexPlugin =
  (katexModule as unknown as { default?: typeof katexModule }).default ?? katexModule;

export const md = new MarkdownIt({ html: false, linkify: true });
md.use(katexPlugin, { throwOnError: false });
md.use(calloutPlugin);

md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx];
  const lang = token.info.trim().split(/\s+/)[0] ?? '';
  const code = token.content;
  if (lang === 'mermaid') {
    return `<div class="mermaid-wrap"><pre class="mermaid">${escapeHtml(code)}</pre></div>`;
  }
  const body =
    lang && hljs.getLanguage(lang)
      ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      : escapeHtml(code);
  return (
    `<div class="code-block"><div class="code-bar">` +
    `<span class="code-lang">${escapeHtml(lang || 'text')}</span>` +
    `<button class="code-copy" type="button" aria-label="复制">${ICON_COPY}</button></div>` +
    `<pre><code class="hljs">${body}</code></pre></div>`
  );
};

md.renderer.rules.table_open = () => '<div class="table-wrap"><table>';
md.renderer.rules.table_close = () => '</table></div>';

md.renderer.rules.image = (tokens, idx, _opts, env?: Env) => {
  const token = tokens[idx];
  const src = String(token.attrGet('src') ?? '');
  const alt = escapeHtml(token.content);
  // 写书规范禁止远程图片；即使出现也不加载（CSP 同样会拦截）
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith('data:')) {
    return `<span class="img-blocked">[远程图片未加载：${alt || escapeHtml(src)}]</span>`;
  }
  const resolved = new URL(src, (env as RenderEnv).bookBaseUrl).href;
  return `<img src="${escapeHtml(resolved)}" alt="${alt}">`;
};

export type RenderEnv = Env & { bookBaseUrl: string };

/** 给 H1–H6 加 id，并收集 H1–H3 作为目录；id 算法与搜索索引共用（@shelf/spec） */
export function assignHeadingIds(tokens: Token[]): TocItem[] {
  const slug = createSlugger();
  const toc: TocItem[] = [];
  tokens.forEach((token, i) => {
    if (token.type !== 'heading_open') return;
    const inline = tokens[i + 1];
    const text = inline.children
      ?.filter((t) => t.type === 'text' || t.type === 'code_inline')
      .map((t) => t.content)
      .join('') ?? inline.content;
    const id = slug(text);
    token.attrSet('id', id);
    const level = Number(token.tag.slice(1));
    if (level <= 3) toc.push({ level: level as 1 | 2 | 3, text, anchor: id });
  });
  return toc;
}


export const kicker = (no: number) => `<p class="chapter-kicker">CHAPTER ${String(no).padStart(2, '0')}</p>`;
