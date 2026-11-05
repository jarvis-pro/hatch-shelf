/**
 * 把渲染好的正文切成可朗读的段落（README 第 8 节「听书」、第 8.1 节「预生成录音」）。
 * 阅读器听书和 shelf-pack 生成录音都走这里：录音按这里切出的段落一段一个文件，两边必须逐条一致。
 * 只用到标准 DOM API，Node 里在 happy-dom 之类的环境中同样能跑。
 */
import { md, type RenderEnv } from './render';

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

export interface Block {
  el: Element;
  text: string;
}

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

export function walk(parent: ParentNode, out: Block[]) {
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

/**
 * 切还没显示的章节：渲染进 template（里面的图片不会加载），按同样的规则只取文本。
 * 编号与这一章显示出来后 collectBlocks 的结果一致，自动换章后标记可以直接用
 */
export function segmentHtml(html: string, doc: Document = document): string[] {
  const template = doc.createElement('template');
  template.innerHTML = html;
  const out: Block[] = [];
  walk(template.content, out);
  return out.map((b) => b.text);
}

/**
 * 一章 Markdown 的朗读段落；与这一章显示出来后 collectBlocks 的结果一致。
 * doc 默认是页面本身，Node 里传入 happy-dom 的 document
 */
export function segmentMarkdown(markdown: string, doc: Document = document): string[] {
  // 只取文本，图片地址随便给一个基准即可
  const env: RenderEnv = { bookBaseUrl: 'file:///' };
  return segmentHtml(md.render(markdown, env), doc);
}
