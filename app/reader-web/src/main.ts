import mermaid from 'mermaid';
import { ICON_CHECK, ICON_CHEVRON, ICON_COPY, assignHeadingIds, escapeHtml, kicker, md, type RenderEnv } from './render';
import { activeFind, clearFind, find, findStep } from './find';
import { quoteFromRange, renderHighlights, scrollToHighlight, sweepHighlight } from './highlights';
import { segmentMarkdown } from './segment';
import { collectBlocks, markBlock, remarkBlocks, resetBlocks, watchAway } from './tts';
import type {
  FromReader,
  NextRead,
  ReaderPosition,
  ReaderTheme,
  ToReader,
} from '../../src/reader/bridge';

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(data: string): void };
    __shelf: { receive(msg: ToReader): void };
  }
}

function post(msg: FromReader) {
  window.ReactNativeWebView?.postMessage(JSON.stringify(msg));
}

// ---------- 页面状态 ----------

const content = document.getElementById('content')!;
/** 最后一章正文之后的「接着读」，放在 #content 外面，高亮、搜索和目录都不会碰到它 */
const nextRead = document.getElementById('next-read')!;
/** 09 高亮落笔：像荧光笔划过选区 */
const SWEEP_MS = 280;
/** 顶部返回、「···」按钮和渐隐区的高度；听书从它下面第一段开始读 */
const TOP_INSET = 100;

watchAway(TOP_INSET, (away) => post({ type: 'ttsAway', away }));

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let current: Extract<ToReader, { type: 'load' }> | null = null;
let restoring = false;
let scrollTimer: ReturnType<typeof setTimeout> | undefined;

function applyTheme(theme: ReaderTheme) {
  const root = document.documentElement;
  root.dataset.theme = theme.mode;
  root.style.setProperty('--font-size', `${theme.fontSize}px`);
  root.style.setProperty('--line-height', String(theme.lineHeight));
  root.classList.toggle('wrap-code', theme.wrapCode);
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: theme.mode === 'dark' ? 'dark' : 'default',
    // 输出原始尺寸，由 renderMermaid 判断是否转向，再用 CSS 缩到屏幕宽
    flowchart: { useMaxWidth: false },
    sequence: { useMaxWidth: false },
    class: { useMaxWidth: false },
    state: { useMaxWidth: false },
    er: { useMaxWidth: false },
  });
}

/** 章标题上方的 CHAPTER 07 */

/** 左右方向的流程图：flowchart LR / RL，graph LR / RL */
const HORIZONTAL = /^(\s*(?:flowchart|graph)\s+)(LR|RL)\b/m;

const svgWidth = (svg: SVGSVGElement) => svg.viewBox.baseVal?.width || svg.getBoundingClientRect().width;

/**
 * 竖屏手机上，左右方向的流程图一长就只能横向拖着看。渲染后量一下，比屏幕宽的改成
 * 上下方向重新渲染；其余仍然过宽的图（时序图等）由 CSS 缩到屏幕宽。
 */
async function renderMermaid() {
  const nodes = [...content.querySelectorAll<HTMLElement>('pre.mermaid')];
  if (nodes.length === 0) return;
  const sources = new Map(nodes.map((n) => [n, n.textContent ?? '']));
  const available = content.clientWidth;
  try {
    await mermaid.run({ nodes, suppressErrors: true });
    const tooWide = nodes.filter((n) => {
      const svg = n.querySelector('svg');
      return svg && HORIZONTAL.test(sources.get(n)!) && svgWidth(svg) > available;
    });
    for (const n of tooWide) {
      n.removeAttribute('data-processed');
      n.textContent = sources
        .get(n)!
        .replace(HORIZONTAL, '$1TD')
        .replace(/^(\s*direction\s+)(LR|RL)\b/gm, '$1TB');
    }
    if (tooWide.length > 0) await mermaid.run({ nodes: tooWide, suppressErrors: true });
  } catch (e) {
    post({ type: 'error', message: `Mermaid: ${(e as Error).message}` });
  }
}

/** 等图片加载完（或超时），避免恢复进度时页面高度还在变 */
function waitImages(timeoutMs: number) {
  const pending = [...content.querySelectorAll('img')]
    .filter((img) => !img.complete)
    .map(
      (img) =>
        new Promise((r) => {
          img.addEventListener('load', r);
          img.addEventListener('error', r);
        }),
    );
  return Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, timeoutMs))]);
}

/**
 * 进度按正文算：「接着读」不计入可滚动高度，滚到正文末尾就是 1，
 * 「读完」的判定（FINISHED_RATIO）不受卡片高度影响
 */
function maxScroll() {
  const tail = nextRead.hidden ? 0 : document.documentElement.scrollHeight - nextRead.offsetTop;
  return Math.max(0, document.documentElement.scrollHeight - tail - window.innerHeight);
}

/** 没有 cover.png 时画一个缩小的「书架文库」文字封面：纸底、色块、署名色带 */
function nextCover(book: NextRead) {
  if (!book.title) return '<span class="next-cover next-cover-missing"></span>';
  if (book.coverUrl) return `<span class="next-cover"><img src="${escapeHtml(book.coverUrl)}" alt=""></span>`;
  return `<span class="next-cover next-cover-text" style="--cover:${escapeHtml(book.color)}"><i></i><b></b></span>`;
}

function renderNext(books: NextRead[] | undefined) {
  nextRead.hidden = !books?.length;
  nextRead.innerHTML = books?.length
    ? '<p class="next-kicker">接着读</p>' +
      books
        .map((b) => {
          const title = b.title ? escapeHtml(b.title) : '书架上还没有这本书';
          const note = b.title ? '' : `<span class="next-note">需要先导入「${escapeHtml(b.id)}」</span>`;
          const reason = b.reason ? `<span class="next-reason">${escapeHtml(b.reason)}</span>` : '';
          return (
            `<a class="next-book" href="../${escapeHtml(b.id)}/" data-label="${b.title ? `《${escapeHtml(b.title)}》` : ''}">` +
            `${nextCover(b)}<span class="next-body"><span class="next-title">${title}</span>${reason}${note}</span>` +
            `<span class="next-go">${ICON_CHEVRON}</span></a>`
          );
        })
        .join('')
    : '';
}

function scrollToAnchor(anchor: string, smooth = false) {
  document.getElementById(anchor)?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
}

function restore(pos?: ReaderPosition) {
  if (!pos) return window.scrollTo(0, 0);
  if (pos.scrollRatio > 0) return window.scrollTo(0, pos.scrollRatio * maxScroll());
  if (pos.anchor) return scrollToAnchor(pos.anchor);
  window.scrollTo(0, 0);
}

/**
 * 搜索结果跳转：从锚点所在标题之后找第一处匹配（找不到再从头找），标亮并滚到屏幕中间。
 * 只在单个文本节点内匹配，跨格式（如一半加粗）的匹配会退回到只定位锚点。
 */
function findAndMark(query: string, anchor?: string) {
  const needle = query.toLowerCase();
  const start = anchor ? document.getElementById(anchor) : null;
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  const after = start
    ? nodes.filter((n) => start.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)
    : [];
  for (const node of [...after, ...nodes]) {
    const i = (node.textContent ?? '').toLowerCase().indexOf(needle);
    if (i < 0 || node.parentElement?.closest('.katex, svg, .code-bar')) continue;
    const hit = node.splitText(i);
    hit.splitText(query.length);
    const mark = document.createElement('mark');
    mark.className = 'find-hit';
    hit.replaceWith(mark);
    mark.appendChild(hit);
    mark.scrollIntoView({ block: 'center' });
    return;
  }
}

function currentPosition(): ReaderPosition {
  const max = maxScroll();
  const scrollRatio = max > 0 ? Math.min(1, window.scrollY / max) : 0;
  let anchor: string | undefined;
  for (const h of content.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id]')) {
    if (h.getBoundingClientRect().top > 80) break;
    anchor = h.id;
  }
  return { scrollRatio, anchor };
}

/** refind：查找中切换主题整章重渲染时，重新标亮并回到原来那一处 */
async function load(msg: Extract<ToReader, { type: 'load' }>, refind?: { query: string; index: number } | null) {
  clearFind(content);
  // find / focusHighlight 只在这次加载生效；之后切换主题重渲染时不再跳转
  current = { ...msg, find: undefined, focusHighlight: undefined };
  restoring = true;
  // 丢弃上一章还没发出的进度，否则会用新章节的 DOM 算出错误位置
  clearTimeout(scrollTimer);
  applyTheme(msg.theme);
  const env: RenderEnv = { bookBaseUrl: msg.bookBaseUrl };
  const tokens = md.parse(msg.markdown, env);
  const toc = assignHeadingIds(tokens);
  content.innerHTML = kicker(msg.chapterNo) + md.renderer.render(tokens, md.options, env);
  renderNext(msg.next);
  post({ type: 'toc', items: toc });
  await renderMermaid();
  renderHighlights(content, msg.highlights);
  remarkBlocks(content);
  await waitImages(1500);
  restore(msg.restore);
  if (msg.find) findAndMark(msg.find, msg.restore?.anchor);
  if (msg.focusHighlight) scrollToHighlight(content, msg.focusHighlight);
  if (refind) post({ type: 'findResult', ...find(content, refind.query, false, refind.index) });
  // 等一帧，让 scrollTo 触发的 scroll 事件先过去
  requestAnimationFrame(() => {
    restoring = false;
    post({ type: 'rendered' });
    // 打开即记一次进度，没滚动过的章节也会成为「最近阅读」
    post({ type: 'position', position: currentPosition() });
  });
}

window.__shelf = {
  receive(msg) {
    switch (msg.type) {
      case 'load':
        resetBlocks();
        // 渲染失败也要回报 rendered，否则 App 的版式占位会一直盖着
        load(msg).catch((e: Error) => {
          post({ type: 'error', message: e.message });
          post({ type: 'rendered' });
        });
        break;
      case 'setTheme':
        // Mermaid 的配色只能在渲染时决定，所以整章重渲染并保持位置
        if (current) void load({ ...current, theme: msg.theme, restore: currentPosition() }, activeFind());
        else applyTheme(msg.theme);
        break;
      case 'scrollTo':
        scrollToAnchor(msg.anchor);
        break;
      case 'captureSelection': {
        const sel = window.getSelection();
        const live = sel && sel.rangeCount > 0 && !sel.isCollapsed ? sel.getRangeAt(0) : null;
        post({ type: 'selection', action: msg.action, quote: quoteFromRange(content, live ?? lastRange) });
        sel?.removeAllRanges();
        lastRange = null;
        break;
      }
      case 'setHighlights': {
        if (current) current = { ...current, highlights: msg.highlights };
        const { animate } = msg;
        if (animate?.kind === 'out' && !reducedMotion.matches) {
          // 先收回，再按新的列表重绘
          sweepHighlight(content, animate.id, 'out', SWEEP_MS);
          setTimeout(() => renderHighlights(content, msg.highlights), SWEEP_MS);
          break;
        }
        renderHighlights(content, msg.highlights);
        if (animate?.kind === 'in' && !reducedMotion.matches) sweepHighlight(content, animate.id, 'in', SWEEP_MS);
        break;
      }
      case 'ttsCollect': {
        const following = (msg.following ?? []).map((m) => segmentMarkdown(m));
        post({ type: 'ttsBlocks', ...collectBlocks(content, TOP_INSET), following });
        break;
      }
      case 'ttsMark':
        markBlock(content, msg.index, TOP_INSET, msg.jump);
        break;
      case 'find':
        post({ type: 'findResult', ...find(content, msg.query, !reducedMotion.matches) });
        break;
      case 'findStep':
        post({ type: 'findResult', ...findStep(msg.delta, !reducedMotion.matches) });
        break;
      case 'clearFind':
        clearFind(content);
        break;
    }
  },
};

// ---------- 交互 ----------

/**
 * 最近一次非空选区。点系统选择菜单里的自定义项时，选区可能已被清掉，
 * 所以持续记录，捕获时优先用当前选区、其次用它。
 */
let lastRange: Range | null = null;
document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed) lastRange = sel.getRangeAt(0).cloneRange();
});

window.addEventListener(
  'scroll',
  () => {
    if (restoring) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => post({ type: 'position', position: currentPosition() }), 400);
  },
  { passive: true },
);

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

const overlay = document.getElementById('image-overlay')!;
const overlayImg = overlay.querySelector('img')!;

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;

  const copyBtn = target.closest<HTMLButtonElement>('.code-copy');
  if (copyBtn) {
    const code = copyBtn.closest('.code-block')?.querySelector('code')?.textContent ?? '';
    void copyText(code).then(() => {
      copyBtn.innerHTML = ICON_CHECK;
      setTimeout(() => (copyBtn.innerHTML = ICON_COPY), 1500);
    });
    return;
  }

  const hl = target.closest<HTMLElement>('mark.hl');
  if (hl && window.getSelection()?.isCollapsed !== false) {
    post({ type: 'highlightTap', id: hl.dataset.id! });
    return;
  }

  if (target.closest('#image-overlay')) {
    if (target === overlayImg) overlay.classList.toggle('zoomed');
    else overlay.classList.remove('open', 'zoomed');
    return;
  }

  if (target instanceof HTMLImageElement && content.contains(target)) {
    overlayImg.src = target.src;
    overlay.classList.add('open');
    return;
  }

  const link = target.closest('a');
  if (link) {
    e.preventDefault();
    const href = link.getAttribute('href') ?? '';
    if (href.startsWith('#')) scrollToAnchor(decodeURIComponent(href.slice(1)), true);
    // 「接着读」的链接文字是整张卡片，书名另放在 data-label
    else if (href) post({ type: 'link', href, text: link.dataset.label ?? link.textContent?.trim() ?? '' });
  }
});

window.addEventListener('error', (e) => post({ type: 'error', message: e.message }));
window.addEventListener('unhandledrejection', (e) =>
  post({ type: 'error', message: String((e.reason as Error)?.message ?? e.reason) }),
);

post({ type: 'ready' });
