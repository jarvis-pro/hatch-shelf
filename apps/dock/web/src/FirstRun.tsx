import { ArrowRight, CircleAlert, CircleCheck, Folder, FolderOpen, LibraryBig, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, shortPath, type DockInfo } from './api';

type Check = { ok: true; books: number; groups: number } | { ok: false; error: string } | null;

/**
 * 首次打开（设计稿 ①）：用系统的选择文件夹对话框选书库，选完立即检查能不能找到书。
 * 只有不能弹对话框的系统才退回手填路径。
 */
export function FirstRun({ info, initial, error, onDone }: { info: DockInfo | null; initial: string; error: string | null; onDone(path: string): void }) {
  const [path, setPath] = useState(initial);
  const [check, setCheck] = useState<Check>(error ? { ok: false, error } : null);
  const [picking, setPicking] = useState(false);
  const canPick = info?.canPick ?? true;

  useEffect(() => {
    if (!path.trim()) return setCheck(null);
    const id = setTimeout(() => {
      void api.check(path).then(setCheck, (e: Error) => setCheck({ ok: false, error: e.message }));
    }, 300);
    return () => clearTimeout(id);
  }, [path]);

  const pick = async () => {
    setPicking(true);
    try {
      const r = await api.pickFolder(path || null);
      if (r.path) {
        setCheck(null);
        setPath(r.path);
      }
    } catch (e) {
      setCheck({ ok: false, error: (e as Error).message });
    } finally {
      setPicking(false);
    }
  };

  const ready = check?.ok && check.books > 0;
  return (
    <div className="first-run">
      <form
        className="card pick"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onDone(path.trim());
        }}
      >
        <span className="big-icon">
          <LibraryBig size={24} />
        </span>
        <div>
          <h1>先告诉 Dock 你的书库在哪</h1>
          <p className="dim">选择书库仓库所在的文件夹，Dock 会读取里面 books/ 下的每一本书，连上手机后逐本比对。</p>
        </div>
        <div className="field">
          <span>书库文件夹</span>
          {canPick ? (
            <button type="button" className={`folder-picker ${path ? 'chosen' : ''}`} onClick={() => void pick()} disabled={picking}>
              {path ? <FolderOpen size={16} /> : <Folder size={16} />}
              {/* 没选时用路径格式的占位，顺带提示该选哪一层文件夹；对话框开着时文字不变，只有右边按钮转圈 */}
              <span className={path ? 'mono' : 'mono placeholder'}>{path ? shortPath(path, info?.home) : '~/Documents/hatch-shelf-library'}</span>
              <span className="choose">{picking ? <LoaderCircle size={14} className="spin" /> : path ? '更换…' : '选择文件夹…'}</span>
            </button>
          ) : (
            <div className="input">
              <Folder size={16} />
              <input autoFocus value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/Documents/hatch-shelf-library" spellCheck={false} />
            </div>
          )}
          {check &&
            (check.ok ? (
              <span className={`check-line ${check.books ? 'ok' : 'bad'}`}>
                {check.books ? <CircleCheck size={14} /> : <CircleAlert size={14} />}
                {check.books ? `找到 ${check.books} 本书，分 ${check.groups} 个分组` : '这个文件夹里没有找到书（需要 book.yaml）'}
              </span>
            ) : (
              <span className="check-line bad">
                <CircleAlert size={14} />
                {check.error}
              </span>
            ))}
        </div>
        <button className="primary big" type="submit" disabled={!ready}>
          打开书库
          <ArrowRight size={16} />
        </button>
      </form>
    </div>
  );
}
