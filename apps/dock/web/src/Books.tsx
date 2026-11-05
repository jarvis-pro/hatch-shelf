import { Check, Highlighter, LayoutGrid, List, Search, X } from 'lucide-react';
import { useState } from 'react';
import { pushable, statusOf, type Job, type JobItem, type LibBook, type PhoneState } from '../../shared/types';
import { coverUrl, mb, saved } from './api';

export type StatusFilter = 'all' | 'changed' | 'new' | 'error' | 'phoneOnly';

export interface Filter {
  status: StatusFilter;
  group: string | null;
  query: string;
}

type View = 'grid' | 'list';

/** 封面墙（或列表）：按分组排，每组右上角「全选」只选能推的书 */
export function Books({
  books,
  phone,
  job,
  filter,
  onQuery,
  selected,
  selectable,
  onToggle,
}: {
  books: LibBook[];
  phone: PhoneState | null;
  job: Job | null;
  filter: Filter;
  onQuery(q: string): void;
  selected: Set<string>;
  selectable(b: LibBook): boolean;
  onToggle(ids: string[], on: boolean): void;
}) {
  const [view, setView] = useState<View>(() => (saved.get('view') === 'list' ? 'list' : 'grid'));
  const [errorsOf, setErrorsOf] = useState<LibBook | null>(null);
  const changeView = (v: View) => {
    setView(v);
    saved.set('view', v);
  };

  const q = filter.query.trim().toLowerCase();
  const shown = books.filter((b) => {
    if (filter.group && b.group !== filter.group) return false;
    if (q && !b.title.toLowerCase().includes(q) && !b.relPath.toLowerCase().includes(q)) return false;
    const s = statusOf(b, phone);
    switch (filter.status) {
      case 'changed':
        return s === 'update' || (s === 'synced' && pushable(b, phone));
      case 'new':
        return s === 'new';
      case 'error':
        return s === 'error';
      case 'phoneOnly':
        return false;
      default:
        return true;
    }
  });
  const groups = [...new Set(shown.map((b) => b.group))].map((g) => [g, shown.filter((b) => b.group === g)] as const);
  const phoneOnly =
    filter.status === 'phoneOnly' && phone?.status === 'online'
      ? phone.books.filter((d) => !books.some((b) => b.id === d.id) && (!q || d.title.toLowerCase().includes(q)))
      : [];

  const title = filter.group ?? { all: '全部书', changed: '有变化', new: '新书', error: '校验未通过', phoneOnly: '仅手机有' }[filter.status];
  const count = filter.status === 'phoneOnly' ? phoneOnly.length : shown.length;

  return (
    <>
      <div className="toolbar">
        <b className="title">{title}</b>
        <span className="dim">{count} 本</span>
        <div className="spacer" />
        <div className="seg">
          <button className={view === 'grid' ? 'on' : ''} onClick={() => changeView('grid')} title="封面墙">
            <LayoutGrid size={15} />
          </button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => changeView('list')} title="列表">
            <List size={15} />
          </button>
        </div>
        <label className="search">
          <Search size={14} />
          <input value={filter.query} onChange={(e) => onQuery(e.target.value)} placeholder="搜索书名" />
          {filter.query && (
            <button onClick={() => onQuery('')} aria-label="清除">
              <X size={13} />
            </button>
          )}
        </label>
      </div>
      <div className="body">
        {filter.status === 'phoneOnly' ? (
          <section className="group">
            <p className="hint">这些书在手机上，但书库里没有（示例书、改名或删掉的书）。要删掉的话，在手机的「设置 → 书籍管理」里删。</p>
            <div className={view}>
              {phoneOnly.map((d) => (
                <div key={d.id} className="tile">
                  <div className="cover-wrap">
                    <div className="cover placeholder">{d.title.slice(0, 1)}</div>
                    <span className="badge gray">
                      <i />
                      仅手机有
                    </span>
                  </div>
                  <div className="text">
                    <b>{d.title}</b>
                    <span>书库里没有</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : (
          groups.map(([g, list]) => {
            const ids = list.filter(selectable).map((b) => b.id);
            const all = ids.length > 0 && ids.every((id) => selected.has(id));
            return (
              <section key={g} className="group">
                <div className="group-head">
                  <b>{g}</b>
                  <span className="dim">{list.length} 本</span>
                  <div className="spacer" />
                  {ids.length > 0 && (
                    <button className="link" onClick={() => onToggle(ids, !all)}>
                      {all ? '取消全选' : '全选'}
                    </button>
                  )}
                </div>
                <div className={view}>
                  {list.map((b) => (
                    <Tile
                      key={b.id}
                      b={b}
                      phone={phone}
                      item={job?.items.find((i) => i.id === b.id) ?? null}
                      jobState={job?.state ?? null}
                      on={selected.has(b.id) && selectable(b)}
                      can={selectable(b)}
                      onPress={() => (b.errors.length ? setErrorsOf(b) : selectable(b) && onToggle([b.id], !selected.has(b.id)))}
                    />
                  ))}
                </div>
              </section>
            );
          })
        )}
        {count === 0 && <p className="empty">{q ? '没有书名匹配的书' : filter.status === 'all' ? '这个书库里还没有书' : '这里没有书'}</p>}
      </div>
      {errorsOf && (
        <div className="modal-veil" onClick={() => setErrorsOf(null)}>
          <div className="modal errors" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <b>《{errorsOf.title}》没有通过校验</b>
              <button className="close" onClick={() => setErrorsOf(null)} aria-label="关闭">
                <X size={15} />
              </button>
            </div>
            <p className="mono dim">{errorsOf.relPath}</p>
            <ul>
              {errorsOf.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
            <p className="dim">修好后 Dock 会自动重新读取；也可以在仓库里运行 pnpm shelf-pack check 查看。</p>
          </div>
        </div>
      )}
    </>
  );
}

/** 一本书：封面左上角状态，左下角笔记数，右下角勾选；推送时封面底部显示进度 */
function Tile({
  b,
  phone,
  item,
  jobState,
  on,
  can,
  onPress,
}: {
  b: LibBook;
  phone: PhoneState | null;
  item: JobItem | null;
  jobState: Job['state'] | null;
  on: boolean;
  can: boolean;
  onPress(): void;
}) {
  const s = statusOf(b, phone);
  const online = phone?.status === 'online';
  const audioMissing = online ? (phone.audioMissing[b.id] ?? 0) : 0;
  const notes = online ? (phone.notes[b.id] ?? 0) : 0;
  const pushing = item && (jobState === 'confirm' || jobState === 'pushing' || item.state === 'done' || item.state === 'failed');

  let badge: [string, string] | null =
    s === 'error' ? ['danger', '校验未通过'] : s === 'new' ? ['accent', '新书'] : s === 'update' ? ['warn', '有更新'] : null;
  let sub: [string, string] =
    s === 'error'
      ? ['danger', `${b.errors.length} 个错误`]
      : s === 'new'
        ? ['', '手机上还没有']
        : s === 'update'
          ? ['', '内容有更新']
          : audioMissing
            ? ['warn', `手机缺 ${audioMissing} 章原声`]
            : s === 'synced'
              ? ['', `${b.chapters} 章 · 已同步`]
              : ['', `${b.chapters} 章`];
  if (pushing && item) {
    if (item.state === 'done') {
      badge = ['ok', '已推送'];
      sub = ['', item.kind === 'audio' ? `补了 ${item.audio?.total ?? ''} 章原声` : '刚刚'];
    } else if (item.state === 'failed') sub = ['danger', item.error ?? '推送失败'];
    else if (item.state === 'queued') sub = ['', jobState === 'confirm' ? '等手机确认' : '等前面的推完'];
    else sub = ['accent', item.audio ? '正在推送原声' : '正在推送'];
  }

  const ratio = item && item.bytes ? item.sent / item.bytes : 0;
  return (
    <div className={`tile ${s === 'error' ? 'disabled' : ''} ${can || s === 'error' ? 'clickable' : ''}`} onClick={onPress}>
      <div className={`cover-wrap ${on || (pushing && item?.state !== 'done') ? 'selected' : ''} ${pushing ? 'locked' : ''}`}>
        {b.cover ? <img className="cover" src={coverUrl(b.id, b.mtime)} alt="" loading="lazy" /> : <div className="cover placeholder">{b.title.slice(0, 1)}</div>}
        {badge && (
          <span className={`badge ${badge[0]}`}>
            {badge[0] === 'ok' ? <Check size={11} strokeWidth={3} /> : <i />}
            {badge[1]}
          </span>
        )}
        {notes > 0 && !(pushing && item?.state === 'uploading') && (
          <span className="notes" title="手机上有书库里还没有的笔记，点「拉取笔记」写回书库">
            <Highlighter size={11} />+{notes} 条笔记
          </span>
        )}
        {item?.state === 'uploading' && (
          <div className="progress">
            <div className="row">
              <span>{item.audio ? `原声 第 ${item.audio.index} / ${item.audio.total} 章` : mb(item.bytes)}</span>
              <span className="dim">{Math.round(ratio * 100)}%</span>
            </div>
            <div className="track">
              <div style={{ width: `${ratio * 100}%` }} />
            </div>
          </div>
        )}
        {(can || s === 'error') && !pushing && (
          <span className={`check ${on ? 'on' : ''}`}>{on && <Check size={13} strokeWidth={3} />}</span>
        )}
      </div>
      <div className="text">
        <b title={b.relPath}>{b.title}</b>
        <span className={sub[0]}>{sub[1]}</span>
      </div>
    </div>
  );
}
