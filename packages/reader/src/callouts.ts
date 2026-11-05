import type { MarkdownIt, StateCore, Token } from 'markdown-it';

/** Lucide 图标，与代码块的复制按钮同一套 */
const icon = (body: string) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const CALLOUTS = {
  note: { title: '注意', icon: icon('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>') },
  tip: {
    title: '提示',
    icon: icon('<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>'),
  },
  important: {
    title: '重要',
    icon: icon('<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M12 7v2"/><path d="M12 13h.01"/>'),
  },
  warning: {
    title: '警告',
    icon: icon('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
  },
  caution: {
    title: '当心',
    icon: icon('<path d="M12 16h.01"/><path d="M12 8v4"/><path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"/>'),
  },
} as const;

export type CalloutKind = keyof typeof CALLOUTS;

/** 引用块第一段开头的 `[!WARNING]`；GitHub 要求独占一行，这里也接受后面直接跟正文 */
const MARKER = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\n|$)?/i;

/**
 * GitHub 风格的提示块：`> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]`。
 * 在 inline 解析前改写 token：给 blockquote 加 class、去掉标记、插入标题；其余引用块不变。
 */
export function calloutPlugin(md: MarkdownIt) {
  md.core.ruler.before('inline', 'callout', (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'blockquote_open') continue;
      const inline = tokens[i + 2];
      if (tokens[i + 1]?.type !== 'paragraph_open' || inline?.type !== 'inline') continue;
      const m = MARKER.exec(inline.content);
      if (!m) continue;
      const kind = m[1].toLowerCase() as CalloutKind;
      tokens[i].attrJoin('class', `callout callout-${kind}`);
      const title = new state.Token('callout_title', '', 0);
      title.meta = { kind };
      inline.content = inline.content.slice(m[0].length);
      if (inline.content.trim() === '') {
        // 标记独占第一段：整段（paragraph_open / inline / paragraph_close）换成标题
        tokens.splice(i + 1, 3, title);
      } else {
        tokens.splice(i + 1, 0, title);
      }
    }
  });

  md.renderer.rules.callout_title = (tokens: Token[], idx: number) => {
    const { kind } = tokens[idx].meta as { kind: CalloutKind };
    const c = CALLOUTS[kind];
    return `<p class="callout-title">${c.icon}<span>${c.title}</span></p>\n`;
  };
}
