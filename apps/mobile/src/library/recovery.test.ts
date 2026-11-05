import { describe, expect, it } from 'vitest';
import { planRecovery } from './recovery';

describe('planRecovery', () => {
  it('新版还没就位时把旧版改回原名', () => {
    expect(planRecovery(['.old-rag', '.tmp-rag', 'llmops'])).toEqual({
      restore: ['.old-rag'],
      remove: ['.tmp-rag'],
    });
  });

  it('新版已就位时删掉旧版', () => {
    expect(planRecovery(['rag', '.old-rag'])).toEqual({ restore: [], remove: ['.old-rag'] });
  });

  it('正常的书目录不动', () => {
    expect(planRecovery(['rag', 'llmops'])).toEqual({ restore: [], remove: [] });
  });

  it('没有 id 的 .old- 当残留删掉', () => {
    expect(planRecovery(['.old-'])).toEqual({ restore: [], remove: ['.old-'] });
  });
});
