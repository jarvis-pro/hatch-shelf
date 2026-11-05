import { ArrowRight, CircleAlert, CircleCheck, Folder, LibraryBig, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from './api';

type Check = { ok: true; books: number; groups: number } | { ok: false; error: string } | null;

/** 首次打开（设计稿 ①）：填书库路径，实时检查能不能找到书；路径只存在这个浏览器里 */
export function FirstRun({ initial, error, onDone }: { initial: string; error: string | null; onDone(path: string): void }) {
  const [path, setPath] = useState(initial);
  const [check, setCheck] = useState<Check>(error ? { ok: false, error } : null);

  useEffect(() => {
    if (!path.trim()) return setCheck(null);
    const id = setTimeout(() => {
      void api.check(path).then(setCheck, (e: Error) => setCheck({ ok: false, error: e.message }));
    }, 300);
    return () => clearTimeout(id);
  }, [path]);

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
          <p className="dim">填写书库仓库的本地路径，Dock 会读取里面 books/ 下的每一本书，连上手机后逐本比对。</p>
        </div>
        <label className="field">
          <span>书库路径</span>
          <div className="input">
            <Folder size={16} />
            <input autoFocus value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/Documents/hatch-shelf-library" spellCheck={false} />
          </div>
          {check &&
            (check.ok ? (
              <span className={`check-line ${check.books ? 'ok' : 'bad'}`}>
                {check.books ? <CircleCheck size={14} /> : <CircleAlert size={14} />}
                {check.books ? `找到 ${check.books} 本书，分 ${check.groups} 个分组` : '这个目录里没有找到书（需要 book.yaml）'}
              </span>
            ) : (
              <span className="check-line bad">
                <CircleAlert size={14} />
                {check.error}
              </span>
            ))}
        </label>
        <button className="primary big" type="submit" disabled={!ready}>
          打开书库
          <ArrowRight size={16} />
        </button>
        <span className="foot dim">
          <Lock size={12} />
          路径只保存在这个浏览器里，Dock 只监听本机 127.0.0.1
        </span>
      </form>
    </div>
  );
}
