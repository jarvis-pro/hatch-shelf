/**
 * 在 Node 里按阅读器的规则切朗读段落（README 第 8.1 节）：渲染和切段直接复用 reader-web 的源码，
 * DOM 由 happy-dom 提供。录音按这里的段落一段一个文件，手机上听书时逐段对上。
 */
import { segmentMarkdown } from '@shelf/reader-web/segment';
import { Window } from 'happy-dom';

export function segmentChapter(markdown: string): string[] {
  // happy-dom 的 document 会一直留着建过的节点，共用一个时整库切下来要好几 GB；每章用完即关
  const window = new Window();
  try {
    // happy-dom 的类型与 lib.dom 的 Document 不完全相同，用到的只是标准 DOM API
    return segmentMarkdown(markdown, window.document as unknown as Document);
  } finally {
    void window.happyDOM.close();
  }
}
