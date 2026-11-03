import { describe, expect, it } from 'vitest';
import { isSafeEntryPath, parseBookYaml, resolveBook } from './index';

const yaml = `
id: go-concurrency
title: Go 并发编程实战
level: intermediate
created: 2026-11-02
chapters:
  - 01-goroutine.md
  - 02-channel.md
`;

describe('parseBookYaml', () => {
  it('accepts a valid manifest and normalizes dates', () => {
    const r = parseBookYaml(yaml);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.created).toBe('2026-11-02');
  });

  it('rejects bad ids and chapter names', () => {
    const r = parseBookYaml('id: Go_Book\ntitle: x\nchapters: [Intro.md]');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(2);
  });

  it('accepts next books with an optional reason and rejects duplicates', () => {
    const ok = parseBookYaml(`${yaml}next:\n  - id: go-runtime\n    reason: 接着看调度器\n  - id: go-perf\n`);
    expect(ok.ok && ok.manifest.next).toEqual([{ id: 'go-runtime', reason: '接着看调度器' }, { id: 'go-perf' }]);
    const dup = parseBookYaml(`${yaml}next:\n  - id: go-perf\n  - id: go-perf\n`);
    expect(!dup.ok && dup.errors).toEqual(['next: next 中有重复的书']);
  });
});

describe('resolveBook', () => {
  it('skips listed chapters that are missing and ignores unlisted ones', () => {
    const r = resolveBook({ dirName: 'x', yamlText: yaml, mdFiles: ['01-goroutine.md', 'notes.md'] });
    expect(r.ok && r.chapters).toEqual(['01-goroutine.md']);
    expect(r.ok && r.warnings).toHaveLength(1);
  });

  it('falls back to directory name and sorted files without book.yaml', () => {
    const r = resolveBook({ dirName: 'My Notes', mdFiles: ['b.md', 'a.md'] });
    expect(r.ok && r.manifest.id).toBe('my-notes');
    expect(r.ok && r.chapters).toEqual(['a.md', 'b.md']);
  });
});

describe('isSafeEntryPath', () => {
  it.each([
    ['book/01.md', true],
    ['/etc/passwd', false],
    ['book/../../x', false],
    ['C:/x', false],
  ])('%s → %s', (p, ok) => expect(isSafeEntryPath(p)).toBe(ok));
});
