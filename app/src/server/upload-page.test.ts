import { describe, expect, it } from 'vitest';
import { UPLOAD_PAGE } from './upload-page';

describe('UPLOAD_PAGE', () => {
  it('does not load anything from outside the app', () => {
    // 只允许 data: URI 和同源的相对路径
    expect(UPLOAD_PAGE).not.toMatch(/(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i);
    expect(UPLOAD_PAGE).not.toMatch(/url\(\s*["']?\s*(?:https?:)?\/\//i);
    expect(UPLOAD_PAGE).not.toMatch(/@import/);
  });

  it('has every icon and image interpolated', () => {
    // 图标名写错时 <svg> 里会是 undefined
    expect(UPLOAD_PAGE).not.toMatch(/>undefined<\/svg>/);
    expect(UPLOAD_PAGE).toContain('data:image/jpeg;base64,');
    expect(UPLOAD_PAGE).toContain('data:image/png;base64,');
  });
});
