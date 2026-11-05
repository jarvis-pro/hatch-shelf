import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pushable, statusOf, type Job, type LibBook, type LibraryResponse, type PhoneState } from '../../shared/types';
import { api, saved } from './api';
import { Books, type Filter } from './Books';
import { ConnectModal } from './ConnectModal';
import { FirstRun } from './FirstRun';
import { FloatBar } from './FloatBar';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/** 手机没连上时多久找一次；连上后多久刷新一次手机上的状态 */
const SEARCH_MS = 3000;
const REFRESH_MS = 20000;

export interface Notice {
  text: string;
  tone: 'ok' | 'error';
}

/**
 * Dock 的网页（设计稿「Dock · 电脑端控制台」）：左侧筛选，右侧按分组排封面墙，
 * 和手机比对后的状态写在封面角标上；点封面勾选，底部浮条推送。
 */
export function App() {
  const [libPath, setLibPath] = useState(() => saved.get('library'));
  const [info, setInfo] = useState<{ name: string; scheme: string; subnets: string[] } | null>(null);
  const [library, setLibrary] = useState<LibraryResponse | null>(null);
  const [libError, setLibError] = useState<string | null>(null);
  const [phone, setPhone] = useState<PhoneState | null>(null);
  const [pairKey, setPairKey] = useState(() => saved.get('pairKey'));
  const [connecting, setConnecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>({ status: 'all', group: null, query: '' });
  const [job, setJob] = useState<Job | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<'notes' | 'backup' | null>(null);

  useEffect(() => {
    void api.info().then(setInfo);
  }, []);

  const loadLibrary = useCallback(async () => {
    try {
      setLibrary(await api.library());
      setLibError(null);
    } catch (e) {
      setLibError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (libPath) void loadLibrary();
  }, [libPath, loadLibrary]);

  // 找手机：上一次查完再排下一次，扫网段可能要几秒
  const phoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshPhone = useCallback(async () => {
    if (phoneTimer.current) clearTimeout(phoneTimer.current);
    if (!saved.get('library') || !saved.get('pairKey')) return;
    let next: PhoneState;
    try {
      next = await api.phone();
    } catch {
      next = { status: 'offline' };
    }
    if (next.status === 'online') saved.set('phone', next.addr);
    setPhone(next);
    phoneTimer.current = setTimeout(() => void refreshPhone(), next.status === 'online' ? REFRESH_MS : SEARCH_MS);
  }, []);

  const hasLibrary = library !== null;
  useEffect(() => {
    if (hasLibrary && pairKey) void refreshPhone();
    return () => {
      if (phoneTimer.current) clearTimeout(phoneTimer.current);
    };
  }, [hasLibrary, pairKey, refreshPhone]);

  // 第一次（还没配对过）打开时直接弹出扫码
  useEffect(() => {
    if (library && !pairKey) setConnecting(true);
  }, [library, pairKey]);

  // 扫码连上后关掉弹窗
  useEffect(() => {
    if (connecting && phone?.status === 'online') {
      setConnecting(false);
      setNotice({ text: `已连接 ${phone.device}`, tone: 'ok' });
    }
  }, [connecting, phone]);

  // 推送中轮询进度；结束后刷新书库和手机状态
  const active = job?.state === 'confirm' || job?.state === 'pushing';
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      void api.job().then((j) => {
        setJob(j);
        if (j && j.state !== 'confirm' && j.state !== 'pushing') {
          setSelected(new Set());
          void loadLibrary().then(refreshPhone);
        }
      });
    }, 400);
    return () => clearInterval(id);
  }, [active, loadLibrary, refreshPhone]);

  // 打开页面时如果服务端还有一次推送在跑（刷新了页面），接着显示
  useEffect(() => {
    void api.job().then((j) => j && (j.state === 'confirm' || j.state === 'pushing') && setJob(j));
  }, []);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(id);
  }, [notice]);

  const books = useMemo(() => library?.books ?? [], [library]);
  // 选中的书在状态变化后（比如推完了）不再可推时自动去掉
  const selectable = useCallback((b: LibBook) => !active && pushable(b, phone), [active, phone]);
  const chosen = books.filter((b) => selected.has(b.id) && selectable(b));

  const toggle = (ids: string[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const push = async () => {
    try {
      setJob(await api.push(chosen.map((b) => b.id)));
    } catch (e) {
      setNotice({ text: (e as Error).message, tone: 'error' });
    }
  };

  const pullNotes = async () => {
    setBusy('notes');
    try {
      const r = await api.notes();
      setNotice({ text: r.written ? `${r.written} 本书的笔记已写入书库（${r.count} 条高亮）` : '书库里的笔记已是最新', tone: 'ok' });
      void refreshPhone();
    } catch (e) {
      setNotice({ text: (e as Error).message, tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const backup = async () => {
    setBusy('backup');
    try {
      const data = await api.backup();
      const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `shelf-backup-${new Date(data.exportedAt).toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setNotice({ text: `已下载备份：${data.progress.length} 条进度 · ${data.highlights.length} 条高亮与笔记`, tone: 'ok' });
    } catch (e) {
      setNotice({ text: (e as Error).message, tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const chooseLibrary = (path: string) => {
    saved.set('library', path);
    setLibPath(path);
    setSelected(new Set());
  };

  if (!libPath || (libError && !library)) {
    return (
      <Shell>
        <TopBar info={info} libPath={null} phone={null} paired={!!pairKey} onChangeLibrary={null} onConnect={null} />
        <FirstRun initial={libPath ?? ''} error={libError} onDone={chooseLibrary} />
      </Shell>
    );
  }

  const counts = {
    all: books.length,
    changed: books.filter((b) => {
      const s = statusOf(b, phone);
      return s === 'update' || (s === 'synced' && pushable(b, phone));
    }).length,
    new: books.filter((b) => statusOf(b, phone) === 'new').length,
    error: books.filter((b) => b.errors.length > 0).length,
    phoneOnly: phone?.status === 'online' ? phone.books.filter((d) => !books.some((b) => b.id === d.id)).length : 0,
  };

  return (
    <Shell>
      <TopBar
        info={info}
        libPath={libPath}
        phone={phone}
        paired={!!pairKey}
        onChangeLibrary={() => {
          setLibPath(null);
          setLibrary(null);
        }}
        onConnect={() => setConnecting(true)}
      />
      <main className="main">
        <Sidebar books={books} counts={counts} filter={filter} onFilter={setFilter} />
        <section className="panel">
          <Books
            books={books}
            phone={phone}
            job={job}
            filter={filter}
            onQuery={(query) => setFilter((f) => ({ ...f, query }))}
            selected={selected}
            selectable={selectable}
            onToggle={toggle}
          />
          <FloatBar
            phone={phone}
            job={job}
            chosen={chosen}
            busy={busy}
            onPush={() => void push()}
            onStop={() => void api.stop()}
            onDismiss={() => setJob(null)}
            onNotes={() => void pullNotes()}
            onBackup={() => void backup()}
          />
        </section>
      </main>
      {connecting && info && (
        <ConnectModal
          info={info}
          phone={phone}
          pairKey={pairKey}
          onKey={(k) => {
            saved.set('pairKey', k);
            setPairKey(k);
          }}
          onClose={() => setConnecting(false)}
        />
      )}
      {notice && <div className={`notice ${notice.tone}`}>{notice.text}</div>}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <div className="glow glow-a" />
      <div className="glow glow-b" />
      {children}
    </div>
  );
}
