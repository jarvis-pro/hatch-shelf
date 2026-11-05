/**
 * 听书：收集当前章节的段落（切法见 segment.ts），并标出正在读的一段（README 第 8 节「听书」）。
 * 段落顺序由 DOM 决定，同一章重渲染（换主题、字号）后编号不变，标记可以原样恢复。
 */
import { walk, type Block } from './segment';

let blocks: Block[] = [];
let active = -1;
/** 用户最近一次手动滚动的时间；之后一段时间内不自动跟随，免得和手指抢 */
let touchedAt = 0;
const FOLLOW_PAUSE_MS = 5000;
/** 底部播放面板的高度余量，正在读的段落不要被它挡住 */
const BOTTOM_INSET = 300;
/** 手动滚走后正在读的段落不在屏幕上：不再自动跟随，RN 显示「从这里读」 */
let away = false;
let onAway: (away: boolean) => void = () => {};

window.addEventListener('touchmove', () => (touchedAt = Date.now()), { passive: true });

function inView(el: Element, topInset: number) {
  const rect = el.getBoundingClientRect();
  return rect.bottom > topInset && rect.top < window.innerHeight - BOTTOM_INSET;
}

function setAway(next: boolean) {
  if (next === away) return;
  away = next;
  onAway(away);
}

/** 手指滚动时检查正在读的段落还在不在屏幕上；自动跟随的滚动不算 */
export function watchAway(topInset: number, report: (away: boolean) => void) {
  onAway = report;
  window.addEventListener(
    'scroll',
    () => {
      const el = blocks[active]?.el;
      if (!el || Date.now() - touchedAt > 1000) return;
      setAway(!inView(el, topInset));
    },
    { passive: true },
  );
}

/** 收集本章段落；start 是视口顶部第一段可见的段落，从这里开始读 */
export function collectBlocks(content: Element, topInset: number): { texts: string[]; start: number } {
  const next: Block[] = [];
  walk(content, next);
  blocks = next;
  setAway(false);
  const start = blocks.findIndex((b) => b.el.getBoundingClientRect().bottom > topInset);
  return { texts: blocks.map((b) => b.text), start: Math.max(0, start) };
}

/** 标出正在读的段落；null 表示结束朗读。jump 为用户主动跳段，总是滚过去 */
export function markBlock(content: Element, index: number | null, topInset: number, jump = false) {
  // 听书中自动换到的章节：阅读器加载时清掉了段落，这里重新切
  if (index !== null && blocks.length === 0) walk(content, blocks);
  blocks[active]?.el.classList.remove('tts-on');
  active = index ?? -1;
  if (index === null) setAway(false);
  // 朗读期间正文底部多留出播放条的位置
  document.body.classList.toggle('tts-playing', index !== null);
  const el = blocks[active]?.el;
  if (!el) return;
  el.classList.add('tts-on');
  if (jump) setAway(false);
  else if (away || Date.now() - touchedAt < FOLLOW_PAUSE_MS) return;
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
  setAway(false);
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
