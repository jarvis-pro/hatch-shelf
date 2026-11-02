import { MAX_PACKAGE_BYTES } from '@shelf/spec';
import { UPLOAD_HERO, UPLOAD_ICON } from './upload-images';

/** lucide 图标的 SVG 内容（从 lucide-react-native 摘出），页面不加载任何外部资源 */
const ICONS: Record<string, string> = {
  'mouse-pointer-2': '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  'folder-archive': '<circle cx="15" cy="19" r="2"/><path d="M20.9 19.8A2 2 0 0 0 22 18V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h5.1"/><path d="M15 11v-1"/><path d="M15 17v-2"/>',
  'file-text': '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  'hard-drive': '<path d="M10 16h.01"/><path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M21.946 12.013H2.054"/><path d="M6 16h.01"/>',
  terminal: '<path d="M12 19h8"/><path d="m4 17 6-6-6-6"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  'circle-alert': '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  'book-up': '<path d="M12 13V7"/><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/><path d="m9 10 3-3 3 3"/>',
  'book-x': '<path d="m14.5 7.5-5 5"/><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/><path d="m9.5 7.5 5 5"/>',
  'book-plus': '<path d="M12 7v6"/><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/><path d="M9 10h6"/>',
  'book-check': '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/><path d="m9 9.5 2 2 4-4"/>',
  smartphone: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  'arrow-down-to-line': '<path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/>',
  'wifi-off': '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
  'rotate-cw': '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

const icon = (name: string, size: number) =>
  `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const MAX_MB = MAX_PACKAGE_BYTES / 1024 / 1024;

/**
 * 电脑浏览器访问 http://<设备IP>:8080/ 时看到的上传页面（设计稿「传书网页 · 电脑浏览器」）。
 * 整页内联，不依赖任何外部资源；跟随系统亮 / 暗色。
 */
export const UPLOAD_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>书巢 · 传书</title>
<style>
  :root {
    --bg:#EEF0F5; --fg:#111318; --fg2:#4B5060; --muted:#8C92A0; --line:#1E2A5A14; --sep:#1E2A5A26;
    --accent:#2F6BFF; --accent-ink:#1F4FD1; --accent-soft:#2F6BFF1F; --accent-shadow:#2F6BFF40;
    --ok:#0E9384; --ok-soft:#0E938414; --err:#E5484D; --err-ink:#C53A3F;
    --glass:linear-gradient(#FFFFFFB8,#FFFFFF70); --glass-stroke:#FFFFFFD9; --shadow:0 12px 32px #1E2A5A12;
    --panel:#FFFFFFD6; --digit:#FFFFFFE6; --digit-stroke:#1E2A5A14;
    --ph:#2F6BFF0F; --ph-stroke:#2F6BFF33; --ph-err:#E5484D0D; --ph-err-stroke:#E5484D40; --ph-wait:#1E2A5A08;
    --ghost:#FFFFFF8C; --ghost-stroke:#1E2A5A1F; --cover-shadow:0 6px 14px #1E2A5A33;
    --glow1:#6E9BFF40; --glow2:#B28CFF2E; --hero-opacity:.75; --veil:238,240,245;
    --banner:#FFFFFFE0; --banner-stroke:#E5484D33; --solid:#15171D; --solid-fg:#FFFFFF;
    --overlay:#EAF0FFB8; --chip:#FFFFFFF0; --code:#15171D; --code-fg:#E6E8EE;
    --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,monospace;
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg:#0B0D12; --fg:#F2F3F7; --fg2:#B4B9C4; --muted:#8C92A0; --line:#FFFFFF14; --sep:#FFFFFF26;
      --accent:#5B8CFF; --accent-ink:#8FB0FF; --accent-soft:#5B8CFF2E; --accent-shadow:#5B8CFF40;
      --ok:#34D3B4; --ok-soft:#2DD4BF1A; --err:#FF7B7E; --err-ink:#FF9A9C;
      --glass:linear-gradient(#FFFFFF14,#FFFFFF08); --glass-stroke:#FFFFFF1A; --shadow:0 12px 32px #00000059;
      --panel:#14171ECC; --digit:#FFFFFF0D; --digit-stroke:#FFFFFF14;
      --ph:#5B8CFF14; --ph-stroke:#5B8CFF40; --ph-err:#FF6B6E14; --ph-err-stroke:#FF6B6E4D; --ph-wait:#FFFFFF08;
      --ghost:#FFFFFF0D; --ghost-stroke:#FFFFFF1F; --cover-shadow:0 6px 14px #00000080;
      --glow1:#3D63D92E; --glow2:#7B54E626; --hero-opacity:.4; --veil:11,13,18;
      --banner:#14171EE6; --banner-stroke:#FF7B7E40; --solid:#F2F3F7; --solid-fg:#111318;
      --overlay:#0B0D12C7; --chip:#1A1E27F0; --code:#05060A; --code-fg:#E6E8EE;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body { background: var(--bg); color: var(--fg); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  button { font: inherit; color: inherit; border: 0; background: none; padding: 0; cursor: pointer; }
  .ic { display: block; flex-shrink: 0; }
  .glass { background: var(--glass); border: 1px solid var(--glass-stroke); box-shadow: var(--shadow); -webkit-backdrop-filter: blur(32px); backdrop-filter: blur(32px); }

  /* 背景：插图铺满整页，右侧压一层底色，再叠两团柔光 */
  .bg { position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; }
  .bg .art { position: absolute; inset: 0; background: url(${UPLOAD_HERO}) center / cover no-repeat; opacity: var(--hero-opacity); }
  .bg .veil { position: absolute; inset: 0; background: linear-gradient(to left, rgba(var(--veil),.95) 15%, rgba(var(--veil),.6) 55%, rgba(var(--veil),0)); }
  .bg .glow { position: absolute; border-radius: 50%; filter: blur(160px); }
  .bg .g1 { left: -120px; top: -140px; width: 640px; height: 480px; background: var(--glow1); }
  .bg .g2 { right: -140px; bottom: -160px; width: 560px; height: 520px; background: var(--glow2); }

  .page { min-height: 100vh; display: flex; flex-direction: column; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 20px 40px; gap: 16px; }
  .brand { display: flex; align-items: center; gap: 10px; font-size: 15px; }
  .brand b { font-weight: 700; }
  .brand .sep { width: 1px; height: 14px; background: var(--sep); }
  .brand span { color: var(--fg2); font-weight: 500; }
  .logo { width: 28px; height: 28px; border-radius: 8px; }
  .conn { height: 36px; border-radius: 18px; padding: 0 14px; display: flex; align-items: center; gap: 8px; font-size: 12px; white-space: nowrap; }
  .conn i { width: 8px; height: 8px; border-radius: 50%; background: #12A150; }
  .conn b { font-weight: 600; }
  .conn code { font-family: var(--mono); color: var(--muted); }
  .offline .conn i { background: var(--err); }

  main { flex: 1; display: flex; align-items: center; gap: 32px; padding: 12px 40px 0 72px; }
  .hero { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 22px; padding-bottom: 40px; }
  .eyebrow { display: flex; align-items: center; gap: 8px; color: var(--accent); font-size: 13px; font-weight: 600; }
  h1 { margin: 0; font-size: 56px; line-height: 1.15; letter-spacing: -1px; font-weight: 700; }
  .lead { margin: 0; color: var(--fg2); font-size: 15px; }
  .actions { display: flex; align-items: center; gap: 14px; padding-top: 6px; flex-wrap: wrap; }
  .pick { height: 46px; border-radius: 23px; padding: 0 22px; display: flex; align-items: center; gap: 8px; background: var(--accent); color: #fff; font-size: 14px; font-weight: 600; box-shadow: 0 8px 20px var(--accent-shadow); transition: background .15s, box-shadow .15s; }
  .pick.dim { background: color-mix(in srgb, var(--accent) 40%, transparent); box-shadow: none; }

  .pin { position: relative; height: 46px; border-radius: 23px; padding: 0 7px 0 16px; display: flex; align-items: center; gap: 10px; cursor: text; }
  .pin.focus { border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
  .pin.bad { border-color: color-mix(in srgb, var(--err) 35%, transparent); }
  .pin > span { font-size: 12px; font-weight: 700; letter-spacing: 1px; color: var(--muted); }
  .digits { display: flex; gap: 4px; }
  .digit { width: 30px; height: 32px; border-radius: 8px; background: var(--digit); border: 1px solid var(--digit-stroke); display: grid; place-items: center; font: 600 16px var(--mono); }
  .pin.focus .digit.cur { border-color: var(--accent); background: var(--digit); }
  .pin.focus .digit.cur:empty::after { content: ""; width: 1.5px; height: 16px; background: var(--accent); animation: blink 1s steps(1) infinite; }
  .pin.bad .digit { border-color: var(--err); color: var(--err-ink); background: color-mix(in srgb, var(--err) 5%, transparent); }
  @keyframes blink { 50% { opacity: 0; } }
  #pin { position: absolute; inset: 0; opacity: 0; border: 0; font-size: 16px; cursor: text; }

  .hint { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; color: var(--accent); margin-top: -8px; }
  .hint.bad { color: var(--err-ink); }
  .hint.bad .ic { color: var(--err); }
  .hint.flash { animation: flash .5s; }
  @keyframes flash { 30% { transform: translateX(4px); } 60% { transform: translateX(-3px); } }
  .formats { display: flex; align-items: center; gap: 20px; padding-top: 8px; font-size: 12px; flex-wrap: wrap; }
  .fmt { display: flex; align-items: center; gap: 6px; color: var(--fg2); font: 600 12px var(--mono); }
  .fmt .ic { color: var(--muted); }
  .cli-link { display: flex; align-items: center; gap: 5px; color: var(--accent); font-size: 12px; font-weight: 600; }
  .cli { max-width: 560px; background: var(--code); color: var(--code-fg); border-radius: 18px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
  .cli[hidden] { display: none; }
  .cli .h { display: flex; justify-content: space-between; align-items: center; font-size: 12px; font-weight: 600; color: #B4B9C4; }
  .cli .row { display: flex; align-items: flex-start; gap: 12px; }
  .cli code { flex: 1; font: 12px/1.6 var(--mono); overflow-wrap: anywhere; }
  .cli .row button, .cli .h button { color: #8C92A0; display: flex; align-items: center; gap: 4px; font-size: 12px; flex-shrink: 0; }
  .cli .row button:hover, .cli .h button:hover { color: #E6E8EE; }

  .banner { display: none; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 20px; background: var(--banner); border: 1px solid var(--banner-stroke); box-shadow: var(--shadow); -webkit-backdrop-filter: blur(32px); backdrop-filter: blur(32px); }
  .banner .icbox { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: color-mix(in srgb, var(--err) 8%, transparent); color: var(--err); flex-shrink: 0; }
  .banner .tx { flex: 1; display: flex; flex-direction: column; gap: 3px; }
  .banner b { font-size: 14px; }
  .banner p { margin: 0; font-size: 12px; line-height: 1.55; color: var(--fg2); }
  .banner button { height: 36px; border-radius: 18px; padding: 0 14px; display: flex; align-items: center; gap: 6px; background: var(--solid); color: var(--solid-fg); font-size: 13px; font-weight: 600; flex-shrink: 0; }
  .offline .banner { display: flex; }
  .offline .eyebrow, .offline .hint, .offline .cli { display: none; }
  .offline h1, .offline .lead, .offline .actions, .offline .formats { opacity: .4; pointer-events: none; }
  .offline .pick { background: var(--muted); box-shadow: none; }

  /* 本次上传浮层 */
  .panel { width: 460px; height: 520px; max-height: calc(100vh - 160px); min-height: 360px; flex-shrink: 0; border-radius: 24px; background: var(--panel); border: 1px solid var(--glass-stroke); box-shadow: var(--shadow); -webkit-backdrop-filter: blur(32px); backdrop-filter: blur(32px); display: flex; flex-direction: column; padding: 6px 0 8px; overflow: hidden; }
  .panel .head { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px 10px; }
  .panel .head b { font-size: 14px; }
  .panel .head span, .note { font-size: 12px; color: var(--muted); }
  #list { flex: 1; overflow-y: auto; }
  .empty { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 0 40px 20px; text-align: center; }
  .ghosts { display: flex; align-items: center; gap: 12px; }
  .ghost { width: 46px; height: 66px; border-radius: 3px 7px 7px 3px; background: var(--ghost); border: 1px solid var(--ghost-stroke); }
  .ghost.mid { width: 59px; height: 84px; display: grid; place-items: center; color: var(--accent); }
  .empty b { display: block; font-size: 14px; font-weight: 600; }
  .empty span { font-size: 12px; color: var(--muted); }
  .item { display: flex; align-items: center; gap: 16px; padding: 12px 20px; border-bottom: 1px solid var(--line); }
  .item:last-child { border-bottom: 0; }
  .cover { width: 54px; height: 76px; border-radius: 3px 7px 7px 3px; flex-shrink: 0; display: grid; place-items: center; border: 1px solid transparent; background-size: cover; background-position: center; }
  .up .cover, .wait .cover { background-color: var(--ph); border-color: var(--ph-stroke); color: var(--accent); }
  .wait .cover { background-color: var(--ph-wait); border-color: var(--ghost-stroke); color: var(--muted); }
  .err .cover { background-color: var(--ph-err); border-color: var(--ph-err-stroke); color: var(--err); }
  .ok .cover { background-color: var(--ok-soft); color: var(--ok); }
  .ok .cover.img { border: 0; box-shadow: var(--cover-shadow); }
  .ok .cover.img .ic { display: none; }
  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .l1 { display: flex; align-items: center; gap: 8px; }
  .name { flex: 1; min-width: 0; font-size: 15px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .state { font-size: 12px; font-weight: 600; flex-shrink: 0; }
  .up .state { color: var(--accent); font-variant-numeric: tabular-nums; }
  .wait .state { color: var(--muted); font-weight: 400; }
  .err .state { color: var(--err); }
  .ok .state { color: var(--ok); background: var(--ok-soft); border-radius: 10px; padding: 2px 8px; }
  .meta { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .msg { font-size: 12px; color: var(--fg2); }
  .up .msg, .wait .msg { color: var(--muted); }
  .err .msg { color: var(--err-ink); }
  .bar { height: 4px; border-radius: 2px; background: var(--accent-soft); overflow: hidden; }
  .bar i { display: block; height: 100%; width: 0; border-radius: 2px; background: var(--accent); transition: width .2s; }
  .err .bar { background: color-mix(in srgb, var(--err) 12%, transparent); }
  .err .bar i { background: var(--err); }
  .note { display: flex; align-items: center; gap: 6px; padding: 10px 20px 8px; border-top: 1px solid var(--line); }

  footer { text-align: center; padding: 12px 16px 22px; font-size: 12px; color: var(--muted); }

  /* 拖拽经过页面时整页高亮 */
  .overlay { position: fixed; inset: 0; z-index: 10; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 22px; padding-bottom: 40px; text-align: center; background: var(--overlay); border: 3px solid var(--accent); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); pointer-events: none; }
  .dragging .overlay { display: flex; }
  .ring { width: 120px; height: 120px; border-radius: 50%; background: color-mix(in srgb, var(--accent) 10%, transparent); display: grid; place-items: center; }
  .ring div { width: 84px; height: 84px; border-radius: 50%; background: var(--accent); color: #fff; display: grid; place-items: center; box-shadow: 0 14px 30px color-mix(in srgb, var(--accent) 35%, transparent); }
  .overlay b { display: block; font-size: 34px; color: var(--accent-ink); }
  .overlay span { font-size: 15px; color: var(--fg2); }

  @media (max-width: 960px) {
    header { padding: 16px; }
    main { flex-direction: column; align-items: stretch; padding: 8px 16px 0; gap: 24px; }
    .hero { padding-bottom: 0; }
    h1 { font-size: 40px; }
    .panel { width: auto; height: auto; max-height: none; min-height: 0; }
    #list { max-height: 60vh; }
    .empty { padding: 24px 24px 28px; }
    .conn code { display: none; }
    .overlay b { font-size: 26px; }
  }
</style>
</head>
<body>
<div class="bg"><div class="art"></div><div class="veil"></div><div class="glow g1"></div><div class="glow g2"></div></div>
<div class="page">
  <header>
    <div class="brand"><img class="logo" src="${UPLOAD_ICON}" alt=""><b>书巢</b><i class="sep"></i><span>传书</span></div>
    <div class="conn glass"><i></i><b id="conn">已连接书巢</b><code id="host"></code></div>
  </header>
  <main>
    <section class="hero">
      <div class="banner" role="alert">
        <div class="icbox">${icon('wifi-off', 18)}</div>
        <div class="tx"><b>和书巢的连接断开了</b><p>手机上的传书已关闭（离开传书页、锁屏或 PIN 连续输错 5 次）。在手机上重新开启传书，再刷新本页，PIN 会换成新的。</p></div>
        <button id="reload">${icon('rotate-cw', 14)}刷新页面</button>
      </div>
      <div class="eyebrow">${icon('mouse-pointer-2', 14)}整个页面都可以松手</div>
      <h1>把书拖到<br>这个页面上</h1>
      <p class="lead">拖进来的书会直接出现在手机书架上，可以一次拖入多个文件。</p>
      <div class="actions">
        <button class="pick" id="pick">${icon('plus', 16)}选择文件</button>
        <label class="pin glass" id="pinBox">
          <span>PIN</span>
          <div class="digits"><div class="digit"></div><div class="digit"></div><div class="digit"></div><div class="digit"></div></div>
          <input id="pin" inputmode="numeric" maxlength="4" autocomplete="off" aria-label="PIN" autofocus>
        </label>
        <input id="file" type="file" accept=".zip,.md,.markdown" multiple hidden>
      </div>
      <div class="hint" id="hint"></div>
      <div class="formats">
        <span class="fmt">${icon('folder-archive', 14)}.zip</span>
        <span class="fmt">${icon('file-text', 14)}.md</span>
        <span class="fmt">${icon('hard-drive', 14)}${MAX_MB} MB</span>
        <button class="cli-link" id="cliLink">${icon('terminal', 13)}命令行推送</button>
      </div>
      <div class="cli" id="cli" hidden>
        <div class="h">用命令行推送<button id="cliClose" aria-label="关闭">${icon('x', 14)}</button></div>
        <div class="row"><code id="cmd1"></code><button data-copy="cmd1">${icon('copy', 13)}复制</button></div>
        <div class="row"><code id="cmd2"></code><button data-copy="cmd2">${icon('copy', 13)}复制</button></div>
      </div>
    </section>
    <section class="panel">
      <div class="head"><b>本次上传</b><span id="summary">还没有文件</span></div>
      <div id="list">
        <div class="empty" id="empty">
          <div class="ghosts"><div class="ghost"></div><div class="ghost mid">${icon('book-plus', 20)}</div><div class="ghost"></div></div>
          <div><b>导入成功的书会带着封面出现在这里</b><span>可以一次拖入多个文件，会按顺序逐个导入</span></div>
        </div>
      </div>
      <div class="note">${icon('smartphone', 13)}<span id="note">导入完成的书会直接出现在手机书架上</span></div>
    </section>
  </main>
  <footer>手机离开传书页、锁屏或切到后台时，这个页面会断开</footer>
</div>
<div class="overlay">
  <div class="ring"><div>${icon('arrow-down-to-line', 34)}</div></div>
  <div><b id="dropTitle">松开即可上传</b><span id="dropSub">会按顺序逐个导入，导入完成的书会直接出现在手机书架上</span></div>
</div>
<script>
  var ICONS = ${JSON.stringify(ICONS)};
  var MAX_BYTES = ${MAX_PACKAGE_BYTES};
  function ic(name, size) {
    return '<svg class="ic" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
  }
  function $(id) { return document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function size(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  var pinInput = $('pin'), pinBox = $('pinBox'), digits = pinBox.querySelectorAll('.digit');
  var hint = $('hint'), pick = $('pick'), fileInput = $('file'), list = $('list');
  var offline = false, pinBad = false;
  var items = [];
  $('host').textContent = location.host;

  // ---------- PIN ----------
  function pin() { return pinInput.value; }
  function pinReady() { return /^[0-9]{4}$/.test(pin()); }
  function renderPin() {
    var v = pin();
    for (var i = 0; i < 4; i++) {
      digits[i].textContent = v[i] || '';
      digits[i].classList.toggle('cur', i === Math.min(v.length, 3) && v.length < 4);
    }
    pinBox.classList.toggle('bad', pinBad);
    pick.classList.toggle('dim', !pinReady());
    if (pinBad) setHint('circle-alert', 'PIN 不正确，请核对手机上显示的 4 位数字', true);
    else if (!pinReady()) setHint('info', '先填 PIN，再拖入文件；PIN 在手机「传书」页查看', false);
    else setHint(null);
    renderCli();
  }
  function setHint(name, text, bad) {
    hint.style.display = name ? '' : 'none';
    if (!name) return;
    hint.className = 'hint' + (bad ? ' bad' : '');
    hint.innerHTML = ic(name, 14) + esc(text);
  }
  function needPin() {
    pinInput.focus();
    hint.classList.remove('flash');
    void hint.offsetWidth;
    hint.classList.add('flash');
  }
  pinInput.addEventListener('input', function () {
    pinInput.value = pinInput.value.replace(/[^0-9]/g, '').slice(0, 4);
    pinBad = false;
    renderPin();
  });
  pinInput.addEventListener('focus', function () { pinBox.classList.add('focus'); });
  pinInput.addEventListener('blur', function () { pinBox.classList.remove('focus'); });
  if (document.activeElement === pinInput) pinBox.classList.add('focus');

  // ---------- 命令行 ----------
  function renderCli() {
    var p = pinReady() ? pin() : '<PIN>';
    $('cmd1').textContent = 'shelf-pack push books/ --to ' + location.host + ' --pin ' + p + ' --changed';
    $('cmd2').textContent = 'curl -H "X-Pin: ' + p + '" -F file=@book.zip ' + location.origin + '/upload';
  }
  $('cliLink').onclick = function () { $('cli').hidden = !$('cli').hidden; };
  $('cliClose').onclick = function () { $('cli').hidden = true; };
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.onclick = function () {
      var text = $(btn.getAttribute('data-copy')).textContent;
      // 局域网 http 不是安全上下文，navigator.clipboard 不可用，用选区复制
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      ta.remove();
      btn.innerHTML = ic('check', 13) + '已复制';
      setTimeout(function () { btn.innerHTML = ic('copy', 13) + '复制'; }, 1500);
    };
  });

  // ---------- 上传列表 ----------
  function render(it) {
    var cover = '', state = '', meta = '', extra = '';
    var title = it.title ? '《' + esc(it.title) + '》' : esc(it.file.name);
    if (it.status === 'wait') {
      cover = ic('clock', 20); state = '等待中'; meta = size(it.file.size);
      extra = '<div class="msg">排在前面的文件传完后开始</div>';
    } else if (it.status === 'up') {
      var pct = Math.round(it.progress * 100);
      cover = ic('book-up', 20); state = it.importing ? '导入中' : pct + '%'; meta = size(it.file.size);
      extra = '<div class="bar"><i style="width:' + pct + '%"></i></div><div class="msg">' + (it.importing ? '已传完，正在导入…' : '上传中，完成后显示封面') + '</div>';
    } else if (it.status === 'err') {
      cover = ic('book-x', 20); state = '失败'; meta = size(it.file.size);
      extra = (it.progress > 0 && it.progress < 1 ? '<div class="bar"><i style="width:' + Math.round(it.progress * 100) + '%"></i></div>' : '') + '<div class="msg">' + esc(it.error) + '</div>';
    } else {
      cover = ic('book-check', 20); state = it.updated ? '已更新' : '已导入';
      meta = esc(it.file.name) + ' · ' + size(it.file.size);
      extra = '<div class="msg">' + (it.updated ? '已换成新版本，阅读进度保留' : it.chapters + ' 章 · 已加入书架') + '</div>';
    }
    it.el.className = 'item ' + it.status;
    it.el.innerHTML = '<div class="cover' + (it.coverUrl ? ' img" style="background-image:url(' + it.coverUrl + ')' : '') + '">' + cover + '</div>' +
      '<div class="info"><div class="l1"><div class="name">' + title + '</div><div class="state">' + state + '</div></div>' +
      '<div class="meta">' + meta + '</div>' + extra + '</div>';
    summary();
  }
  function summary() {
    var done = items.filter(function (it) { return it.status === 'ok'; }).length;
    $('summary').textContent = items.length ? items.length + ' 个文件' + (done ? ' · ' + done + ' 本已导入' : '') : '还没有文件';
    $('note').textContent = done ? '导入完成的书已经出现在手机书架上' : '导入完成的书会直接出现在手机书架上';
  }

  var queue = Promise.resolve();
  function add(files) {
    if (offline) return;
    if (!pinReady()) { needPin(); return; }
    $('empty').style.display = 'none';
    var first = items.length;
    for (var i = 0; i < files.length; i++) (function (f) {
      var it = { file: f, status: 'wait', progress: 0, el: document.createElement('div') };
      var lower = f.name.toLowerCase();
      if (!/[.](zip|md|markdown)$/.test(lower)) { it.status = 'err'; it.error = '只支持 .zip 和 .md 文件'; }
      else if (f.size > MAX_BYTES) { it.status = 'err'; it.error = '文件超过 ' + MAX_BYTES / 1024 / 1024 + ' MB'; }
      items.push(it);
      list.appendChild(it.el);
      render(it);
      if (it.status === 'wait') queue = queue.then(function () { return upload(it); });
    })(files[i]);
    // 让这一批的第一个文件出现在浮层顶部
    if (items[first]) list.scrollTop = items[first].el.offsetTop - list.offsetTop;
  }

  function upload(it) {
    // 前面的文件 PIN 错了或者服务已断开，后面的不再发，免得把错误次数用完
    if (offline) return fail(it, '连接已断开，没有上传');
    if (pinBad || !pinReady()) return fail(it, 'PIN 不正确，文件没有上传。改好 PIN 后重新拖入即可');
    var sentPin = pin();
    it.status = 'up';
    render(it);
    return new Promise(function (resolve) {
      var xhr = new XMLHttpRequest();
      var fd = new FormData();
      fd.append('pin', sentPin);
      fd.append('file', it.file, it.file.name);
      xhr.upload.onprogress = function (e) {
        if (!e.lengthComputable) return;
        it.progress = e.loaded / e.total;
        render(it);
      };
      xhr.upload.onload = function () { it.progress = 1; it.importing = true; render(it); };
      xhr.onerror = function () {
        var pct = Math.round(it.progress * 100);
        fail(it, pct > 0 && pct < 100 ? '传到 ' + pct + '% 时连接中断，重新连接后需要再传一次' : '连接失败，传书页面可能已关闭');
        goOffline();
        resolve();
      };
      xhr.onload = function () {
        var res = {};
        try { res = JSON.parse(xhr.responseText); } catch (e) {}
        if (xhr.status === 401) {
          if (pin() === sentPin) { pinBad = true; renderPin(); }
          fail(it, 'PIN 不正确，文件没有上传。改好 PIN 后重新拖入即可');
        } else if (xhr.status === 403) {
          fail(it, res.error || 'PIN 错误次数过多，本次服务已关闭');
          goOffline();
        } else if (!res.ok) {
          fail(it, res.error || '导入失败（' + xhr.status + '）');
        } else {
          it.status = 'ok';
          it.title = res.title;
          it.updated = res.status === 'updated';
          it.chapters = res.chapters;
          render(it);
          if (res.cover) loadCover(it, res.bookId, sentPin);
        }
        resolve();
      };
      xhr.open('POST', '/upload');
      xhr.send(fd);
    });
  }
  function fail(it, error) { it.status = 'err'; it.importing = false; it.error = error; render(it); }
  function loadCover(it, id, p) {
    fetch('/cover/' + encodeURIComponent(id), { headers: { 'X-Pin': p } })
      .then(function (r) { return r.ok ? r.blob() : null; })
      .then(function (b) { if (b) { it.coverUrl = URL.createObjectURL(b); render(it); } })
      .catch(function () {});
  }

  // ---------- 连接状态 ----------
  function goOffline() {
    if (offline) return;
    offline = true;
    document.body.classList.add('offline');
    document.body.classList.remove('dragging');
    $('conn').textContent = '已断开';
    pinInput.blur();
    items.forEach(function (it) { if (it.status === 'wait') fail(it, '连接已断开，没有上传'); });
  }
  var misses = 0;
  function ping() {
    if (offline) return;
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 4000);
    fetch('/ping', { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error(); misses = 0; })
      .catch(function () { if (++misses >= 2) goOffline(); })
      .then(function () { clearTimeout(timer); setTimeout(ping, 3000); });
  }
  setTimeout(ping, 3000);
  $('reload').onclick = function () { location.reload(); };

  // ---------- 选择 / 拖拽 ----------
  pick.onclick = function () { if (!pinReady()) { needPin(); return; } fileInput.click(); };
  fileInput.onchange = function () { add(fileInput.files); fileInput.value = ''; };

  var depth = 0;
  function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0; }
  document.addEventListener('dragenter', function (e) {
    if (!hasFiles(e) || offline) return;
    e.preventDefault();
    if (depth++ === 0) {
      var n = Array.prototype.filter.call(e.dataTransfer.items || [], function (x) { return x.kind === 'file'; }).length;
      if (pinReady()) {
        $('dropTitle').textContent = n ? '松开即可上传 ' + n + ' 个文件' : '松开即可上传';
        $('dropSub').textContent = '会按顺序逐个导入，导入完成的书会直接出现在手机书架上';
      } else {
        $('dropTitle').textContent = '先填好 PIN';
        $('dropSub').textContent = 'PIN 在手机「传书」页查看，填好后再拖进来';
      }
      document.body.classList.add('dragging');
    }
  });
  function endDrag() { depth = 0; clearTimeout(dragTimer); document.body.classList.remove('dragging'); }
  // 拖拽停在页面上时 dragover 会持续触发；一段时间收不到说明已经拖出窗口或取消了
  var dragTimer;
  document.addEventListener('dragover', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    clearTimeout(dragTimer);
    dragTimer = setTimeout(endDrag, 400);
  });
  document.addEventListener('dragleave', function () { if (--depth <= 0) endDrag(); });
  document.addEventListener('drop', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    endDrag();
    add(e.dataTransfer.files);
  });

  renderPin();
</script>
</body>
</html>
`;
