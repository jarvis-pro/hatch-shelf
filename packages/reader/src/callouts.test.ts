import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { calloutPlugin } from './callouts';

const md = new MarkdownIt().use(calloutPlugin);

describe('calloutPlugin', () => {
  it('标记独占一行：去掉标记，加上标题', () => {
    const html = md.render('> [!WARNING]\n> 以官方最新规定为准。');
    expect(html).toContain('<blockquote class="callout callout-warning">');
    expect(html).toContain('<span>警告</span>');
    expect(html).toContain('<p>以官方最新规定为准。</p>');
    expect(html).not.toContain('[!WARNING]');
  });

  it('标记单独成段、大小写不敏感、后面直接跟正文都可以', () => {
    expect(md.render('> [!tip]\n>\n> 第一段\n>\n> 第二段')).toMatch(
      /callout-tip">\n<p class="callout-title">.*<span>提示<\/span><\/p>\n<p>第一段<\/p>\n<p>第二段<\/p>/,
    );
    expect(md.render('> [!NOTE] 同一行的正文')).toContain('<p>同一行的正文</p>');
  });

  it('五种类型都有中文标题', () => {
    for (const [kind, title] of [
      ['NOTE', '注意'],
      ['TIP', '提示'],
      ['IMPORTANT', '重要'],
      ['WARNING', '警告'],
      ['CAUTION', '当心'],
    ]) {
      expect(md.render(`> [!${kind}]\n> x`)).toContain(`<span>${title}</span>`);
    }
  });

  it('普通引用块和未知标记不变', () => {
    expect(md.render('> 普通引用')).toBe('<blockquote>\n<p>普通引用</p>\n</blockquote>\n');
    expect(md.render('> [!FOO]\n> x')).toBe('<blockquote>\n<p>[!FOO]\nx</p>\n</blockquote>\n');
    expect(md.render('> 正文 [!NOTE]')).not.toContain('callout');
  });

  it('嵌套在提示块里的普通引用不受影响', () => {
    const html = md.render('> [!NOTE]\n> 外层\n>\n> > 内层');
    expect(html).toContain('<blockquote class="callout callout-note">');
    expect(html).toContain('<blockquote>\n<p>内层</p>');
  });
});
