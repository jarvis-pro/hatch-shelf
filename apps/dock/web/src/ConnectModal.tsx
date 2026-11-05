import { pairUrl } from '@shelf/spec';
import { LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { useEffect } from 'react';
import type { PhoneState } from '../../shared/types';
import { newPairKey, qrUrl } from './api';

/**
 * 扫码连接手机（设计稿 ③）：二维码里是一次性生成、之后长期有效的配对密钥。
 * 手机扫码后打开接收，Dock 扫网段找到它，这里随即关闭。
 */
export function ConnectModal({
  info,
  phone,
  pairKey,
  onKey,
  onClose,
}: {
  info: { name: string; scheme: string; subnets: string[] };
  phone: PhoneState | null;
  pairKey: string | null;
  onKey(key: string): void;
  onClose(): void;
}) {
  useEffect(() => {
    if (!pairKey) onKey(newPairKey());
  }, [pairKey, onKey]);

  if (!pairKey) return null;
  const url = pairUrl(info.scheme, { key: pairKey, name: info.name });
  const status =
    phone?.status === 'outdated'
      ? { warn: true, text: '找到了手机，但书巢版本太旧', sub: '请先更新手机上的书巢' }
      : phone?.status === 'unpaired'
        ? { warn: false, text: '找到了在接收的手机，等它扫码…', sub: `${phone.addr} · 还没有用这张二维码配对` }
        : { warn: false, text: '等待手机打开接收…', sub: `正在扫描 ${info.subnets.join('、') || '局域网'}` };

  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal connect" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>连接手机</b>
          <button className="close" onClick={onClose} aria-label="关闭">
            <X size={15} />
          </button>
        </div>
        <div className="connect-body">
          <div className="qr">
            <img src={qrUrl(url)} alt="配对二维码" />
            <img className="logo" src="/app-icon.png" alt="" />
          </div>
          <ol>
            <li>打开 iPhone 相机，对准二维码</li>
            <li>点「在书巢中打开」，书巢开始接收</li>
            <li>这里自动变成已连接，之后不用再扫</li>
          </ol>
        </div>
        <div className={`waiting ${status.warn ? 'warn' : ''}`}>
          {status.warn ? <TriangleAlert size={16} /> : <LoaderCircle size={16} className="spin" />}
          <div>
            <b>{status.text}</b>
            <span className="mono dim">{status.sub}</span>
          </div>
        </div>
        <p className="dim small">
          二维码里是这台电脑的配对密钥，扫码后长期有效。已经配对过的手机，在书架「+」里选「从电脑接收」就能连上。
          {info.scheme !== 'shelf' && ' 当前连接的是开发版书巢。'}
        </p>
      </div>
    </div>
  );
}
