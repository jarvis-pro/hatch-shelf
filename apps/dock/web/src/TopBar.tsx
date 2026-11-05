import { FolderOpen, Smartphone, Unplug } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PhoneState } from '../../shared/types';

/**
 * 顶栏：品牌、当前书库（可更换）、手机（设计稿 ⑧）。同一时间只连一台手机：
 * 还没连过时是「连接手机」，点开扫码；扫过码之后固定是那台手机，点开是手机菜单，只能断开
 */
export function TopBar({
  libPath,
  phone,
  phoneName,
  pushing,
  onChangeLibrary,
  onConnect,
  onDisconnect,
}: {
  info: { name: string } | null;
  libPath: string | null;
  phone: PhoneState | null;
  /** 连着的那台手机的名字；null 表示还没连手机 */
  phoneName: string | null;
  pushing?: boolean;
  onChangeLibrary: (() => void) | null;
  onConnect: (() => void) | null;
  onDisconnect?: () => Promise<void>;
}) {
  const [menu, setMenu] = useState(false);
  const online = phone?.status === 'online';
  const name = online ? phone.device : phoneName;
  const [dot, label, sub] = !phoneName
    ? ['idle', '连接手机', null]
    : online
      ? ['on', phone.device, phone.addr]
      : phone?.status === 'outdated'
        ? ['warn', `${phoneName} 上的书巢需要更新`, null]
        : ['wait', `等待 ${phoneName} 打开接收`, null];
  const status: [string, string] = online
    ? ['on', `已连接 · ${phone.addr}`]
    : phone?.status === 'unpaired'
      ? ['warn', '有手机在接收，但没有和这台电脑配对']
      : phone?.status === 'outdated'
        ? ['warn', '需要更新手机上的书巢']
        : ['wait', '等待打开接收'];
  if (menu && !phoneName) setMenu(false);

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
        <div className="phone-anchor">
          <button
            className={`pill phone${menu ? ' open' : ''}`}
            onClick={() => (phoneName ? setMenu((v) => !v) : onConnect())}
            title={phoneName ? '手机' : '扫码连接手机'}
          >
            <span className={`dot ${dot}`} />
            <b>{label}</b>
            {sub && <span className="mono dim">{sub}</span>}
          </button>
          {menu && name && (
            <PhoneMenu
              name={name}
              status={status}
              foot={
                online
                  ? '同一时间只连一台手机。断开后这台手机要重新扫码才能连接'
                  : phone?.status === 'unpaired'
                    ? `可能是别的手机，也可能是在 ${name} 上删除了这台电脑；是后者的话，断开后重新扫码`
                    : '手机现在没开接收，断开只清掉 Dock 这边；手机上的记录可以在「设置 → 电脑」里删除'
              }
              pushing={!!pushing}
              onClose={() => setMenu(false)}
              onDisconnect={onDisconnect}
            />
          )}
        </div>
      )}
    </header>
  );
}

function PhoneMenu({
  name,
  status,
  foot,
  pushing,
  onClose,
  onDisconnect,
}: {
  name: string;
  status: [string, string];
  foot: string;
  pushing: boolean;
  onClose(): void;
  onDisconnect?: () => Promise<void>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  // 点菜单外面或按 Esc 收起
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  if (confirm && onDisconnect) {
    return (
      <div className="phone-menu confirm" ref={ref} role="dialog" aria-label="确认断开">
        <span className="pm-icon danger">
          <Unplug size={18} />
        </span>
        <b className="pm-title">断开 {name}？</b>
        <p className="pm-desc">
          {pushing ? '正在推送，断开会停止这次推送。' : ''}
          手机会结束接收并删除这台电脑的配对，下次要重新扫码才能连接
        </p>
        <div className="pm-buttons">
          <button className="pm-btn" onClick={() => setConfirm(false)} disabled={busy}>
            取消
          </button>
          <button
            className="pm-btn danger"
            disabled={busy}
            autoFocus
            onClick={() => {
              setBusy(true);
              void onDisconnect().finally(onClose);
            }}
          >
            {busy ? '正在断开…' : '断开'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="phone-menu" ref={ref} role="menu">
      <div className="pm-head">
        <span className="pm-icon">
          <Smartphone size={18} />
        </span>
        <div className="pm-text">
          <b>{name}</b>
          <span>
            <span className={`dot ${status[0]}`} /> {status[1]}
          </span>
        </div>
      </div>
      {onDisconnect && (
        <button className="pm-item danger" role="menuitem" onClick={() => setConfirm(true)}>
          <Unplug size={15} />
          断开连接
        </button>
      )}
      <p className="pm-foot">{foot}</p>
    </div>
  );
}
