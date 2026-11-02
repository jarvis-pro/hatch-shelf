import type { HighlightMark, Quote } from '../../src/reader/bridge';

const CONTEXT = 32;
const MAX_QUOTE = 2000;

/**
 * 参与定位的文本节点。排除复制按钮、KaTeX 的 MathML（屏幕上不可见、与可见公式重复）和 Mermaid 图，
 * 选区捕获与定位用的必须是同一套节点，偏移才对得上。
 */
function textNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest('.code-bar, .katex-mathml, svg, .chapter-nav')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

interface TextIndex {
  nodes: Text[];
  /** 每个节点在拼接文本中的起点 */
  starts: number[];
  full: string;
}

function buildIndex(root: HTMLElement): TextIndex {
  const nodes = textNodes(root);
  const starts: number[] = [];
  let full = '';
  for (const n of nodes) {
    starts.push(full.length);
    full += n.data;
  }
  return { nodes, starts, full };
}

/** DOM 中的一个位置 → 拼接文本中的偏移 */
function toOffset(idx: TextIndex, container: Node, offset: number): number {
  if (container.nodeType === Node.TEXT_NODE) {
    const i = idx.nodes.indexOf(container as Text);
    if (i >= 0) return idx.starts[i] + offset;
  }
  // 元素内的位置：取该位置之后的第一个参与定位的文本节点
  const probe = document.createRange();
  probe.setStart(container, offset);
  for (let i = 0; i < idx.nodes.length; i++) {
    if (probe.comparePoint(idx.nodes[i], 0) >= 0) return idx.starts[i];
  }
  return idx.full.length;
}

function nearestAnchor(root: HTMLElement, node: Node): string | undefined {
  let anchor: string | undefined;
  for (const h of root.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id]')) {
    if (h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING || h.contains(node)) anchor = h.id;
    else break;
  }
  return anchor;
}

/** 把当前选区转成 Quote；选区不在正文里或为空时返回 null */
export function quoteFromRange(root: HTMLElement, range: Range | null): Quote | null {
  if (!range || range.collapsed || !root.contains(range.commonAncestorContainer)) return null;
  const idx = buildIndex(root);
  const start = toOffset(idx, range.startContainer, range.startOffset);
  const end = Math.min(toOffset(idx, range.endContainer, range.endOffset), start + MAX_QUOTE);
  const text = idx.full.slice(start, end);
  if (!text.trim()) return null;
  return {
    text,
    prefix: idx.full.slice(Math.max(0, start - CONTEXT), start),
    suffix: idx.full.slice(end, end + CONTEXT),
    anchor: nearestAnchor(root, range.startContainer),
  };
}

const commonSuffix = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
};
const commonPrefix = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
};

/** 在拼接文本中找原文出现的位置，取前后文最吻合的一处 */
export function locate(full: string, q: Quote): number {
  let best = -1;
  let bestScore = -1;
  for (let i = full.indexOf(q.text); i >= 0; i = full.indexOf(q.text, i + 1)) {
    const score =
      commonSuffix(full.slice(Math.max(0, i - q.prefix.length), i), q.prefix) +
      commonPrefix(full.slice(i + q.text.length, i + q.text.length + q.suffix.length), q.suffix);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

function unwrapAll(root: HTMLElement) {
  for (const m of root.querySelectorAll('mark.hl')) {
    const parent = m.parentNode!;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    m.remove();
    parent.normalize();
  }
}

/** 重绘全部高亮；返回定位失败（原文已被改动）的 id */
export function renderHighlights(root: HTMLElement, marks: HighlightMark[]): string[] {
  unwrapAll(root);
  const missing: string[] = [];
  for (const h of marks) {
    // 每次重新建索引：前一条高亮插入 <mark> 会拆分文本节点
    const idx = buildIndex(root);
    const start = locate(idx.full, h);
    if (start < 0) {
      missing.push(h.id);
      continue;
    }
    const end = start + h.text.length;
    idx.nodes.forEach((node, i) => {
      const s = idx.starts[i];
      const e = s + node.data.length;
      if (e <= start || s >= end || node.data.length === 0) return;
      let target = node;
      if (start > s) target = target.splitText(start - s);
      if (end < e) target.splitText(end - Math.max(s, start));
      const mark = document.createElement('mark');
      mark.className = h.hasNote ? 'hl has-note' : 'hl';
      mark.dataset.id = h.id;
      target.replaceWith(mark);
      mark.appendChild(target);
    });
  }
  return missing;
}

/** 一条高亮可能被拆成多个 <mark>；按文字长度分配时长，让整条高亮像一笔连续扫过 */
export function sweepHighlight(root: HTMLElement, id: string, kind: 'in' | 'out', totalMs: number) {
  const marks = [...root.querySelectorAll<HTMLElement>(`mark.hl[data-id="${CSS.escape(id)}"]`)];
  if (kind === 'out') marks.reverse();
  const total = marks.reduce((n, m) => n + (m.textContent?.length ?? 0), 0) || 1;
  let delay = 0;
  for (const m of marks) {
    const duration = (totalMs * (m.textContent?.length ?? 0)) / total;
    m.style.animationDelay = `${delay}ms`;
    m.style.animationDuration = `${duration}ms`;
    m.classList.add(kind === 'in' ? 'hl-in' : 'hl-out');
    delay += duration;
  }
}

export function scrollToHighlight(root: HTMLElement, id: string) {
  root.querySelector(`mark.hl[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' });
}
