import { Archive, Download, LoaderCircle, Send, Smartphone, Square } from 'lucide-react';
import type { Job, LibBook, PhoneState } from '../../shared/types';
import { mb } from './api';

/**
 * 底部深色浮条：平时放「拉取笔记」「备份阅读数据」和推送；
 * 推送请求发出后等手机确认，确认后显示总进度和「停止」。结束后的结果用 Toast 显示，浮条直接回到平时的样子。
 */
export function FloatBar({
  phone,
  job,
  chosen,
  busy,
  onPush,
  onStop,
  onNotes,
  onBackup,
}: {
  phone: PhoneState | null;
  job: Job | null;
  chosen: LibBook[];
  busy: 'notes' | 'backup' | null;
  onPush(): void;
  onStop(): void;
  onNotes(): void;
  onBackup(): void;
}) {
  const online = phone?.status === 'online';
  const device = online ? phone.device : '手机';

  if (job?.state === 'confirm') {
    const bytes = job.items.reduce((n, i) => n + i.bytes, 0);
    return (
      <Bar>
        <span className="ic">
          <Smartphone size={17} />
        </span>
        <div className="stack">
          <b>等待 {device} 确认…</b>
          <span className="dim">
            {job.items.length} 本 · 约 {mb(bytes)} · 在手机上点「开始接收」后开始传输
          </span>
        </div>
        <button className="ghost" onClick={onStop}>
          取消
        </button>
      </Bar>
    );
  }

  if (job?.state === 'pushing') {
    const total = job.items.reduce((n, i) => n + i.bytes, 0);
    const sent = job.items.reduce((n, i) => n + i.sent, 0);
    const index = Math.min(job.items.length, job.items.filter((i) => i.state === 'done' || i.state === 'failed').length + 1);
    const current = job.items.find((i) => i.state === 'uploading');
    return (
      <Bar>
        <span className="ic">
          <LoaderCircle size={17} className="spin" />
        </span>
        <div className="stack wide">
          <div className="row">
            <b>
              正在推送 {index} / {job.items.length}
              {current ? ` · ${current.title}${current.audio ? ' 的原声' : ''}` : ''}
            </b>
            <span className="dim">
              {mb(sent)} / {mb(total)}
            </span>
          </div>
          <div className="track">
            <div style={{ width: `${total ? (sent / total) * 100 : 0}%` }} />
          </div>
        </div>
        <button className="stop" onClick={onStop}>
          <Square size={12} fill="currentColor" />
          停止
        </button>
      </Bar>
    );
  }

  if (!online) return null;

  const bytes = chosen.reduce((n, b) => n + (b.bytes || 0), 0);
  const noteBooks = Object.keys(phone.notes).length;
  return (
    <Bar>
      {chosen.length ? (
        <>
          <b>已选 {chosen.length} 本</b>
          <span className="dim">约 {mb(bytes)}</span>
        </>
      ) : (
        <span className="dim">点封面勾选要推送的书</span>
      )}
      <span className="divider" />
      <button className="ghost" onClick={onNotes} disabled={busy !== null} title="把手机上的笔记写回书库各书目录的 notes.md">
        {busy === 'notes' ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />}
        拉取笔记{noteBooks ? `（${noteBooks} 本有新笔记）` : ''}
      </button>
      <button className="ghost" onClick={onBackup} disabled={busy !== null} title="下载手机上的阅读进度、高亮与笔记">
        {busy === 'backup' ? <LoaderCircle size={14} className="spin" /> : <Archive size={14} />}
        备份阅读数据
      </button>
      <button className="primary" onClick={onPush} disabled={chosen.length === 0}>
        <Send size={14} />
        {chosen.length ? `推送 ${chosen.length} 本到手机` : '推送到手机'}
      </button>
    </Bar>
  );
}

function Bar({ children }: { children: React.ReactNode }) {
  return (
    <div className="float">
      <div className="bar">{children}</div>
    </div>
  );
}
