import { coverColor } from '@shelf/spec';
import type { CSSProperties } from 'react';

/**
 * 没有 cover.png 时的文字封面：照 App 的 BookCover（apps/mobile/src/shelf/BookCover.tsx）画「书架文库」版式——
 * 米色纸底、衬线书名、按分类取色的色块和底部色带。尺寸都按封面宽度换算（容器查询单位 cqw，1/300 宽 = 1/3 cqw），
 * 和手机上任意大小的封面比例一致；太窄时（列表视图）只留版式不写字
 */
export function TextCover({ id, title, subtitle, category }: { id: string; title: string; subtitle?: string | null; category?: string | null }) {
  const series = category?.split('/')[0];
  return (
    <div className="cover text-cover" style={{ '--c': coverColor(category, id) } as CSSProperties}>
      <div className="tc-head">
        {series && <span className="tc-series">书架文库 · {series}</span>}
        <b className="tc-title">{title}</b>
        {subtitle && <span className="tc-sub">{subtitle}</span>}
      </div>
      <div className="tc-block">
        <i />
      </div>
      <div className="tc-imprint">
        <span>Jarvis</span>
        <i />
      </div>
    </div>
  );
}
