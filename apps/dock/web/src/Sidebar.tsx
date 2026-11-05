import type { LibBook } from '../../shared/types';
import type { Filter, StatusFilter } from './Books';

const STATUS: [StatusFilter, string, string | null][] = [
  ['all', '全部', null],
  ['changed', '有变化', 'var(--warn)'],
  ['new', '新书', 'var(--accent)'],
  ['error', '校验未通过', 'var(--danger)'],
  ['phoneOnly', '仅手机有', 'var(--fg3)'],
];

/** 左侧栏：上面按状态筛，下面按分组筛；两者可以叠加 */
export function Sidebar({
  books,
  counts,
  filter,
  onFilter,
}: {
  books: LibBook[];
  counts: Record<StatusFilter, number>;
  filter: Filter;
  onFilter(f: Filter): void;
}) {
  const groups = [...new Map(books.map((b) => [b.group, books.filter((x) => x.group === b.group).length]))];
  return (
    <nav className="sidebar">
      <div className="label">状态</div>
      {STATUS.map(([key, label, color]) => (
        <button
          key={key}
          className={`item ${filter.status === key && filter.group === null ? 'on' : ''}`}
          onClick={() => onFilter({ ...filter, status: key, group: null })}
        >
          {color && <span className="dot" style={{ background: color }} />}
          <span className="name">{label}</span>
          <span className="count">{counts[key]}</span>
        </button>
      ))}
      <div className="label gap">分组</div>
      {groups.map(([g, n]) => (
        <button key={g} className={`item ${filter.group === g ? 'on' : ''}`} onClick={() => onFilter({ ...filter, status: 'all', group: g })}>
          <span className="name">{g}</span>
          <span className="count">{n}</span>
        </button>
      ))}
    </nav>
  );
}
