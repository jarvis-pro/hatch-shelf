import { FolderOpen } from 'lucide-react';
import type { PhoneState } from '../../shared/types';

/** 顶栏：品牌、当前书库（可更换）、手机连接状态（点开扫码连接） */
export function TopBar({
  libPath,
  phone,
  paired,
  onChangeLibrary,
  onConnect,
}: {
  info: { name: string } | null;
  libPath: string | null;
  phone: PhoneState | null;
  paired: boolean;
  onChangeLibrary: (() => void) | null;
  onConnect: (() => void) | null;
}) {
  const [dot, label, sub] = !paired
    ? ['idle', '连接手机', null]
    : phone?.status === 'online'
      ? ['on', phone.device, phone.addr]
      : phone?.status === 'unpaired'
        ? ['warn', '手机上的配对已取消', '点这里重新扫码']
        : phone?.status === 'outdated'
          ? ['warn', '手机上的书巢需要更新', null]
          : ['wait', '等待手机打开接收', null];
  return (
    <header className="topbar">
      <div className="brand">
        <img src="/app-icon.png" alt="" />
        <b>书巢</b>
        <span className="sep" />
        <span className="dock">Dock</span>
      </div>
      {libPath && onChangeLibrary && (
        <div className="pill library">
          <FolderOpen size={14} />
          <span className="mono">{libPath}</span>
          <button className="mini" onClick={onChangeLibrary}>
            更换
          </button>
        </div>
      )}
      <div className="spacer" />
      {onConnect && (
        <button className="pill phone" onClick={onConnect} title="扫码连接手机">
          <span className={`dot ${dot}`} />
          <b>{label}</b>
          {sub && <span className="mono dim">{sub}</span>}
        </button>
      )}
    </header>
  );
}
