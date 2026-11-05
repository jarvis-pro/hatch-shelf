// @vitest-environment happy-dom
import path from 'node:path';
import { assignHeadingIds, kicker, md, type RenderEnv } from '@shelf/reader/render';
import { collectBlocks } from '@shelf/reader/tts';
import { describe, expect, it } from 'vitest';
import { findBooks, lint, readBook } from './books';
import { segmentChapter } from './segment';

// 默认只测 App 自带的示例书；设了 SHELF_LIBRARY（书库仓库，相对代码仓库根目录，如 ../hatch-shelf-library）就测整个书库
const repoRoot = path.resolve(import.meta.dirname, '../../..');
const booksRoot = process.env.SHELF_LIBRARY
  ? path.join(path.resolve(repoRoot, process.env.SHELF_LIBRARY), 'books')
  : path.join(repoRoot, 'apps/mobile/samples');

const validBooks = findBooks(booksRoot)
  .map(readBook)
  .map((book) => ({ book, manifest: lint(book) }))
  .filter(({ manifest }) => manifest.errors.length === 0);

/** 阅读器这一侧：与 main.ts 的 load 相同，把整章渲染进正文容器，再由 collectBlocks 收集段落 */
function readerBlocks(markdown: string): string[] {
  const env: RenderEnv = { bookBaseUrl: 'file:///books/x/' };
  const tokens = md.parse(markdown, env);
  assignHeadingIds(tokens);
  const content = document.createElement('article');
  content.innerHTML = kicker(1) + md.renderer.render(tokens, md.options, env);
  return collectBlocks(content, 0).texts;
}

// 录音按 CLI 切出的段落一段一个文件，手机上按阅读器切出的段落播放，两边必须逐条相同（README 第 8.1 节）
describe('segmentChapter', () => {
  it('has books to test', () => expect(validBooks.length).toBeGreaterThan(0));

  for (const { book, manifest } of validBooks) {
    it(`matches the reader for ${book.dirName}`, async () => {
      for (const chapter of manifest.manifest!.chapters) {
        const markdown = book.files.find((f) => f.path === chapter)!.text!;
        const cli = segmentChapter(markdown);
        expect(cli.length, chapter).toBeGreaterThan(0);
        expect(cli, chapter).toEqual(readerBlocks(markdown));
        // segmentChapter 关掉的 happy-dom 窗口要等事件循环空下来才释放，否则整库跑下来内存耗尽
        await new Promise((r) => setTimeout(r, 0));
      }
    });
  }
});
