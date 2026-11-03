/**
 * 听书：把渲染好的正文切成可朗读的段落，并标出正在读的一段（README 第 8 节「听书」）。
 * 段落顺序由 DOM 决定，同一章重渲染（换主题、字号）后编号不变，标记可以原样恢复。
 */

/** 代码块、表格、图示不朗读，念一句提示；行内公式过长时也只念「公式」 */
const SKIPPED: [selector: string, hint: string][] = [
  ['.code-block', '此处有代码，略过。'],
  ['.table-wrap', '此处有表格，略过。'],
  ['.mermaid-wrap', '此处有图示，略过。'],
];

/** 不朗读、也不念提示的元素 */
const SILENT = '.chapter-kicker, hr, img, .img-blocked';

/** 行内公式的 TeX 足够短且不含命令时直接念，如 x^2、n+1 */
const SHORT_TEX = /^[\w\s+\-=<>().,^']{1,12}$/;

/** 含有这些子元素的列表项、引用要继续往里拆，否则整体作为一段 */
const CONTAINER_CHILD = 'p, ul, ol, blockquote, div, pre, h1, h2, h3, h4, h5, h6';

interface Block {
  el: Element;
  text: string;
}

let blocks: Block[] = [];
let active = -1;
/** 用户最近一次手动滚动的时间；之后一段时间内不自动跟随，免得和手指抢 */
let touchedAt = 0;
const FOLLOW_PAUSE_MS = 5000;
/** 底部播放条的高度余量，正在读的段落不要被它挡住 */
const BOTTOM_INSET = 140;

window.addEventListener('touchmove', () => (touchedAt = Date.now()), { passive: true });

function spokenText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const k of clone.querySelectorAll('.katex')) {
    const tex = k.querySelector('annotation')?.textContent?.trim() ?? '';
    k.replaceWith(SHORT_TEX.test(tex) ? ` ${tex} ` : '公式');
  }
  // 脚注编号之类的上标单独念出来没有意义
  for (const s of clone.querySelectorAll('sup')) s.remove();
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function walk(parent: Element, out: Block[]) {
  for (const el of parent.children) {
    if (el.matches(SILENT)) continue;
    const skipped = SKIPPED.find(([sel]) => el.matches(sel));
    if (skipped) {
      out.push({ el, text: skipped[1] });
      continue;
    }
    // 块级公式单独成段（markdown-it-katex 渲染成 p.katex-block）
    if (el.matches('.katex-block')) {
      out.push({ el, text: '此处有公式，略过。' });
      continue;
    }
    if (el.matches('ul, ol, blockquote, div') || (el.matches('li') && el.querySelector(`:scope > :is(${CONTAINER_CHILD})`))) {
      walk(el, out);
      continue;
    }
    const text = spokenText(el);
    if (text) out.push({ el, text });
  }
}

/** 收集本章段落；start 是视口顶部第一段可见的段落，从这里开始读 */
export function collectBlocks(content: Element, topInset: number): { texts: string[]; start: number } {
  const next: Block[] = [];
  walk(content, next);
  blocks = next;
  const start = blocks.findIndex((b) => b.el.getBoundingClientRect().bottom > topInset);
  return { texts: blocks.map((b) => b.text), start: Math.max(0, start) };
}

/** 标出正在读的段落；null 表示结束朗读 */
export function markBlock(index: number | null, topInset: number) {
  blocks[active]?.el.classList.remove('tts-on');
  active = index ?? -1;
  // 朗读期间正文底部多留出播放条的位置
  document.body.classList.toggle('tts-playing', index !== null);
  const el = blocks[active]?.el;
  if (!el) return;
  el.classList.add('tts-on');
  if (Date.now() - touchedAt < FOLLOW_PAUSE_MS) return;
  const rect = el.getBoundingClientRect();
  if (rect.top < topInset || rect.bottom > window.innerHeight - BOTTOM_INSET) {
    // 段落放在屏幕上方三分之一处，后面几段也能看到
    window.scrollTo({ top: window.scrollY + rect.top - Math.max(topInset, window.innerHeight / 3), behavior: 'smooth' });
  }
}

/** 换章时清掉；之前的 DOM 已经不在了 */
export function resetBlocks() {
  blocks = [];
  active = -1;
  document.body.classList.remove('tts-playing');
}

/** 同一章重渲染后重新找段落，并恢复正在读的标记 */
export function remarkBlocks(content: Element) {
  if (active < 0) return;
  const next: Block[] = [];
  walk(content, next);
  blocks = next;
  blocks[active]?.el.classList.add('tts-on');
}
