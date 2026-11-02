import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseBookYaml, prepareImport, staleProgressFiles } from './index';

const yaml = 'id: demo\ntitle: 示例\nchapters: [01-a.md, 02-b.md]\n';
const zip = (files: Record<string, string | Uint8Array>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])));

describe('prepareImport (zip)', () => {
  it('imports a flat zip with book.yaml', () => {
    const r = prepareImport({
      kind: 'zip',
      fileName: 'whatever.zip',
      bytes: zip({ 'book.yaml': yaml, '01-a.md': '# A', '02-b.md': '# B', 'assets/x.png': new Uint8Array([1, 2]) }),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.id).toBe('demo');
    expect(r.files.map((f) => f.path).sort()).toEqual(['01-a.md', '02-b.md', 'assets/x.png', 'book.yaml']);
    expect(r.files.find((f) => f.path === 'assets/x.png')?.bytes).toEqual(new Uint8Array([1, 2]));
  });

  it('strips a single wrapping directory and macOS junk', () => {
    const r = prepareImport({
      kind: 'zip',
      fileName: 'demo.zip',
      bytes: zip({
        'demo/book.yaml': yaml,
        'demo/01-a.md': '# A',
        'demo/02-b.md': '# B',
        '__MACOSX/demo/._01-a.md': 'x',
        'demo/.DS_Store': 'x',
      }),
    });
    expect(r.ok && r.files.map((f) => f.path).sort()).toEqual(['01-a.md', '02-b.md', 'book.yaml']);
    expect(r.ok && r.warnings).toEqual([]);
  });

  it('rejects zip slip entries', () => {
    const r = prepareImport({ kind: 'zip', fileName: 'x.zip', bytes: zip({ '../evil.md': '# x', 'a.md': '# a' }) });
    expect(r).toEqual({ ok: false, error: expect.stringContaining('../evil.md') });
  });

  it('drops disallowed extensions with a warning', () => {
    const r = prepareImport({ kind: 'zip', fileName: 'x.zip', bytes: zip({ 'book.yaml': yaml, '01-a.md': '# A', 'run.sh': 'rm -rf' }) });
    expect(r.ok && r.files.some((f) => f.path === 'run.sh')).toBe(false);
    expect(r.ok && r.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('run.sh'), expect.stringContaining('02-b.md')]),
    );
  });

  it('writes a book.yaml when the package has none', () => {
    const r = prepareImport({ kind: 'zip', fileName: 'My Notes.zip', bytes: zip({ 'b.md': '# B', 'a.md': '# A' }) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.id).toBe('my-notes');
    const written = parseBookYaml(r.files.find((f) => f.path === 'book.yaml')!.text!);
    expect(written.ok && written.manifest).toMatchObject({ id: 'my-notes', title: 'My Notes', chapters: ['a.md', 'b.md'] });
  });

  it('reports invalid book.yaml', () => {
    const r = prepareImport({ kind: 'zip', fileName: 'x.zip', bytes: zip({ 'book.yaml': 'id: Bad\n', 'a.md': '# a' }) });
    expect(r.ok).toBe(false);
  });

  it('rejects garbage', () => {
    expect(prepareImport({ kind: 'zip', fileName: 'x.zip', bytes: strToU8('not a zip') }).ok).toBe(false);
  });
});

describe('prepareImport (md)', () => {
  it('wraps a single markdown file as a one-chapter book titled by its H1', () => {
    const r = prepareImport({ kind: 'md', fileName: 'Rust Ownership.md', text: '```md\n# not this\n```\n# 所有权\n正文' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.id).toBe('rust-ownership');
    expect(r.manifest).toMatchObject({ title: '所有权', chapters: ['rust-ownership.md'] });
  });
});

describe('staleProgressFiles', () => {
  it('keeps progress only for chapters that still exist', () => {
    expect(staleProgressFiles(['01-a.md', '02-b.md', '03-c.md'], ['01-a.md', '03-c.md', '04-d.md'])).toEqual(['02-b.md']);
  });
});
