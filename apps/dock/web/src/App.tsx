import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pushable, statusOf, type Job, type LibBook, type LibraryResponse, type PhoneState } from '../../shared/types';
import { api, saved, shortPath, type DockInfo } from './api';
import { Books, type Filter } from './Books';
import { ConnectModal } from './ConnectModal';
import { FirstRun } from './FirstRun';
import { FloatBar } from './FloatBar';
import { Sidebar } from './Sidebar';
import { Toast, type Notice } from './Toast';
import { TopBar } from './TopBar';

/** 手机没连上时多久找一次；连上后多久刷新一次手机上的状态 */
const SEARCH_MS = 3000;
const REFRESH_MS = 20000;

/** 推送结束后的结果，用 Toast 显示 */
function jobNotice(job: Job): Notice {
  const done = job.items.filter((i) => i.state === 'done').length;
  const failed = job.items.filter((i) => i.state === 'failed').length;
  if (job.state === 'done') {
    return failed
      ? { text: `推送完成，${failed} 本没有推上`, sub: [`${done} 本已在手机上`, job.items.find((i) => i.error)?.error].filter(Boolean).join(' · '), tone: 'error', icon: 'alert' }
      : { text: '推送完成', sub: `${done} 本已在手机上`, tone: 'ok' };
  }
  if (job.state === 'rejected') return { text: '手机上拒绝了这次推送', tone: 'error' };
  if (job.state === 'stopped') return done ? { text: '已停止推送', sub: `停止前推完了 ${done} 本`, tone: 'info' } : { text: '已取消这次推送', tone: 'info' };
  return { text: '推送中断', sub: job.error ?? '未知错误', tone: 'error', icon: 'alert' };
}

/**
 * Dock 的网页（设计稿「Dock · 电脑端控制台」）：左侧筛选，右侧按分组排封面墙，
 * 和手机比对后的状态写在封面角标上；点封面勾选，底部浮条推送。
 */
export function App() {
  const [libPath, setLibPath] = useState(() => saved.get('library'));
  const [info, setInfo] = useState<DockInfo | null>(null);
  const [library, setLibrary] = useState<LibraryResponse | null>(null);
  const [libError, setLibError] = useState<string | null>(null);
  const [phone, setPhone] = useState<PhoneState | null>(null);
  const [pairKey, setPairKey] = useState(() => saved.get('pairKey'));
  const [phoneName, setPhoneName] = useState(() => saved.get('phoneName'));
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
    const key = saved.get('pairKey');
    if (!saved.get('library') || !key) return;
    let next: PhoneState;
    try {
      next = await api.phone();
    } catch {
      next = { status: 'offline' };
    }
    // 等结果的时候断开了（或换了密钥），这次结果作废
    if (saved.get('pairKey') !== key) return;
    if (next.status === 'online') {
      saved.set('phone', next.addr);
      saved.set('phoneName', next.device);
      setPhoneName(next.device);
    }
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

  // 连上手机后一直挂着 /api/phone/watch：手机上点「结束」（或被挂起、断网）时立即把顶栏改成等待，
  // 不用等下一次 20 秒的刷新；之后照常每 3 秒找一次手机
  const watchAddr = phone?.status === 'online' ? phone.addr : null;
  useEffect(() => {
    if (!watchAddr) return;
    const ac = new AbortController();
    void (async () => {
      while (!ac.signal.aborted) {
        let receiving = false;
        try {
          receiving = (await api.watch(ac.signal)).receiving;
        } catch {
          // Dock 服务本身连不上，或网页这边取消了
        }
        if (ac.signal.aborted) return;
        if (receiving) continue;
        if (phoneTimer.current) clearTimeout(phoneTimer.current);
        setPhone({ status: 'offline' });
        phoneTimer.current = setTimeout(() => void refreshPhone(), SEARCH_MS);
        return;
      }
    })();
    return () => ac.abort();
  }, [watchAddr, refreshPhone]);

  // 打开页面时还没连过手机，直接弹出扫码（断开之后不自动弹，等点「连接手机」）
  const askedOnce = useRef(false);
  useEffect(() => {
    if (!library || askedOnce.current) return;
    askedOnce.current = true;
    if (!saved.get('phoneName')) setConnecting(true);
  }, [library]);

  // 扫码连上后关掉弹窗
  useEffect(() => {
    if (connecting && phone?.status === 'online') {
      setConnecting(false);
      setNotice({ text: `已连接 ${phone.device}`, sub: '在 Dock 里勾选书，推送到手机', tone: 'ok' });
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
          setNotice(jobNotice(j));
          // 被拒绝时保留勾选，调整后可以再推
          if (j.state !== 'rejected') setSelected(new Set());
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
      setNotice({ text: '没能开始推送', sub: (e as Error).message, tone: 'error', icon: 'alert' });
    }
  };

  const pullNotes = async () => {
    setBusy('notes');
    try {
      const r = await api.notes();
      setNotice(
        r.written
          ? { text: '笔记已写入书库', sub: `${r.written} 本书 · ${r.count} 条高亮，写在各书目录的 notes.md`, tone: 'ok' }
          : { text: '书库里的笔记已是最新', tone: 'ok' },
      );
      void refreshPhone();
    } catch (e) {
      setNotice({ text: '拉取笔记失败', sub: (e as Error).message, tone: 'error', icon: 'alert' });
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
      setNotice({ text: '已下载阅读数据备份', sub: `${data.progress.length} 条进度 · ${data.highlights.length} 条高亮与笔记`, tone: 'ok' });
    } catch (e) {
      setNotice({ text: '备份失败', sub: (e as Error).message, tone: 'error', icon: 'alert' });
    } finally {
      setBusy(null);
    }
  };

  const chooseLibrary = (path: string) => {
    saved.set('library', path);
    setLibPath(path);
    setSelected(new Set());
  };

  // 顶栏「更换」：直接弹系统的选择文件夹对话框，选中能读到书的文件夹才切过去
  const changeLibrary = async () => {
    if (!info?.canPick) {
      setLibPath(null);
      setLibrary(null);
      return;
    }
    try {
      const { path } = await api.pickFolder(libPath);
      if (!path || path === libPath) return;
      const r = await api.check(path);
      if (!r.ok) setNotice({ text: '没能切换书库', sub: r.error, tone: 'error', icon: 'alert' });
      else if (r.books === 0) setNotice({ text: '这个文件夹里没有找到书', sub: '书库里的每本书都要有 book.yaml', tone: 'error', icon: 'alert' });
      else {
        chooseLibrary(path);
        setLibrary(null);
        setNotice({ text: '已切换书库', sub: `${r.books} 本书`, tone: 'ok' });
      }
    } catch (e) {
      setNotice({ text: '没能切换书库', sub: (e as Error).message, tone: 'error', icon: 'alert' });
    }
  };

  /**
   * 断开连接（同一时间只连一台手机）：手机在线时让它结束接收、删掉这台电脑的配对；
   * Dock 这边清掉密钥和手机，回到「连接手机」。换手机就是断开后重新扫码
   */
  const disconnect = async () => {
    const name = phone?.status === 'online' ? phone.device : (phoneName ?? '手机');
    if (phone?.status === 'online') {
      try {
        await api.disconnect();
      } catch {
        // 手机这时连不上也照样断开，它那边的记录可以在手机设置里删
      }
    }
    if (phoneTimer.current) clearTimeout(phoneTimer.current);
    for (const k of ['pairKey', 'phone', 'phoneName'] as const) saved.set(k, null);
    setPairKey(null);
    setPhoneName(null);
    setPhone(null);
    setNotice({ text: `已断开 ${name}`, sub: '要连手机时点右上角「连接手机」扫码', tone: 'info', icon: 'unplug' });
  };

  if (!libPath || (libError && !library)) {
    return (
      <Shell>
        <TopBar info={info} libPath={null} phone={null} phoneName={phoneName} onChangeLibrary={null} onConnect={null} />
        <FirstRun info={info} initial={libPath ?? ''} error={libError} onDone={chooseLibrary} />
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
        libPath={shortPath(libPath, info?.home)}
        phone={phone}
        phoneName={phoneName}
        pushing={active}
        onChangeLibrary={() => void changeLibrary()}
        onConnect={() => setConnecting(true)}
        onDisconnect={disconnect}
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
      <Toast notice={notice} onDone={() => setNotice(null)} />
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
