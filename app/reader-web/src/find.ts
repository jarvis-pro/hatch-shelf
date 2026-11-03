/**
 * 章内查找：标亮本章全部匹配，记住当前处，支持上一处 / 下一处。
 * 用的是搜索跳转同款 `mark.find-hit`（加 in-chapter 区分样式），与高亮 `mark.hl` 可以互相嵌套，
 * 重绘高亮只拆 mark.hl，不影响这里的标亮。
 */

/** 不参与查找的区域：复制按钮、公式、Mermaid 图（包进 <mark> 会打乱它们的排版） */
const SKIP = '.code-bar, .katex, svg, .mermaid';
/** 匹配不跨这些块；同一块里可以跨加粗、链接、高亮等行内格式 */
const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, pre, td, th, dt, dd, blockquote, figcaption';

let state: { query: string; hits: HTMLElement[][]; index: number } | null = null;

function textGroups(root: HTMLElement): Text[][] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const groups: Text[][] = [];
  let block: Element | null | undefined;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const b = n.parentElement?.closest(BLOCK) ?? null;
    if (b !== block || groups.length === 0) groups.push([]);
    block = b;
    groups[groups.length - 1].push(n as Text);
  }
  return groups;
}

/** 在一组相邻文本节点里找全部（不重叠的）匹配，包上 <mark>；返回按文档顺序排列的每处匹配的 mark */
function markGroup(nodes: Text[], needle: string): HTMLElement[][] {
  const starts: number[] = [];
  let full = '';
  for (const n of nodes) {
    starts.push(full.length);
    full += n.data;
  }
  // 个别字符转小写后长度会变，偏移就对不上了，这时退回区分大小写
  const lower = full.toLowerCase();
  const hay = lower.length === full.length ? lower : full;
  const ranges: [number, number][] = [];
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
    ranges.push([i, i + needle.length]);
  }
  // 倒序包裹：splitText 把前半段留在原节点里，前面匹配的偏移不受影响
  const hits: HTMLElement[][] = [];
  for (const [start, end] of ranges.reverse()) {
    const marks: HTMLElement[] = [];
    nodes.forEach((node, i) => {
      const s = starts[i];
      const e = s + node.data.length;
      if (e <= start || s >= end || node.data.length === 0) return;
      let target = node;
      if (start > s) target = target.splitText(start - s);
      if (end < e) target.splitText(end - Math.max(s, start));
      const mark = document.createElement('mark');
      mark.className = 'find-hit in-chapter';
      target.replaceWith(mark);
      mark.appendChild(target);
      marks.push(mark);
    });
    hits.unshift(marks);
  }
  return hits;
}

/** 清除全部查找标亮，包括搜索跳转留下的那处 */
export function clearFind(root: HTMLElement) {
  state = null;
  for (const m of root.querySelectorAll('mark.find-hit')) {
    const parent = m.parentNode!;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    m.remove();
    parent.normalize();
  }
}

function select(index: number, smooth: boolean) {
  if (!state || state.hits.length === 0) return;
  for (const m of state.hits[state.index] ?? []) m.classList.remove('current');
  state.index = index;
  const marks = state.hits[index];
  for (const m of marks) m.classList.add('current');
  marks[0].scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
}

export interface FindResult {
  query: string;
  index: number;
  total: number;
}

const result = (): FindResult =>
  state
    ? { query: state.query, index: state.hits.length ? state.index + 1 : 0, total: state.hits.length }
    : { query: '', index: 0, total: 0 };

/**
 * 标亮全部匹配。keepIndex 用于重渲染后恢复到原来那一处；否则取视口里或之后的第一处，
 * 都在视口之上时取第一处。
 */
export function find(root: HTMLElement, query: string, smooth: boolean, keepIndex?: number): FindResult {
  clearFind(root);
  const needle = query.toLowerCase();
  if (!needle.trim()) return { query, index: 0, total: 0 };
  const hits = textGroups(root).flatMap((g) => markGroup(g, needle));
  state = { query, hits, index: 0 };
  if (hits.length === 0) return result();
  let index = keepIndex !== undefined ? Math.min(keepIndex, hits.length - 1) : -1;
  if (index < 0) index = Math.max(0, hits.findIndex((h) => h[0].getBoundingClientRect().bottom > 0));
  select(index, smooth);
  return result();
}

export function findStep(delta: 1 | -1, smooth: boolean): FindResult {
  if (state && state.hits.length > 0) {
    const n = state.hits.length;
    select((state.index + delta + n) % n, smooth);
  }
  return result();
}

/** 查找进行中时返回查找词和当前处（从 0 开始），供重渲染后恢复 */
export function activeFind(): { query: string; index: number } | null {
  return state && { query: state.query, index: state.index };
}
