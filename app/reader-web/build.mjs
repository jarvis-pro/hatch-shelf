// 把阅读器打成单个 HTML（JS、CSS、KaTeX 字体全部内联），输出到 app/assets/reader/index.html。
// App 启动时把它拷到 documentDirectory，用 file:// 加载，这样书里的相对路径图片可以直接显示。
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const here = import.meta.dirname;
const outFile = path.resolve(here, '../assets/reader/index.html');
const require = createRequire(import.meta.url);

const { outputFiles } = await build({
  absWorkingDir: here,
  entryPoints: ['src/main.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'safari17',
  legalComments: 'none',
  write: false,
});
// 内联到 <script> 时，字符串里的 `<!--` `<script` `</script` 会干扰 HTML 解析（DOMPurify、Mermaid 里都有）。
// 这些序列只会出现在字符串 / 正则字面量里，把 `<` 换成 `\x3C` 语义不变。
const js = outputFiles[0].text.replace(/<(?=!--|\/?script)/gi, '\\x3C');

// KaTeX：只保留 woff2 并转成 data URL
const katexCssPath = require.resolve('katex/dist/katex.min.css');
const fontsDir = path.join(path.dirname(katexCssPath), 'fonts');
const katexCss = readFileSync(katexCssPath, 'utf8').replace(
  /src:url\(fonts\/([\w-]+)\.woff2\) format\("woff2"\)[^;}]*/g,
  (_, name) =>
    `src:url(data:font/woff2;base64,${readFileSync(path.join(fontsDir, `${name}.woff2`)).toString('base64')}) format("woff2")`,
);
if (katexCss.includes('url(fonts/')) throw new Error('KaTeX 字体未全部内联');

const css = katexCss + readFileSync(path.join(here, 'src/style.css'), 'utf8');

// CSP 保证阅读器不发起任何网络请求：只允许本地文件和内联资源
const csp = [
  "default-src 'none'",
  "img-src file: data: blob:",
  "style-src 'unsafe-inline'",
  "font-src data:",
  "script-src 'unsafe-inline'",
].join('; ');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>${css}</style>
</head>
<body>
<article id="content"></article>
<aside id="next-read" hidden></aside>
<div id="image-overlay"><button class="overlay-close" type="button">✕</button><img alt=""></div>
<script>${js}</script>
</body>
</html>
`;

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, html);
console.log(`reader → ${path.relative(process.cwd(), outFile)} (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
