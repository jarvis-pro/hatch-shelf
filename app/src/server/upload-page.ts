/** 电脑浏览器访问 http://<设备IP>:8080/ 时看到的上传页面；整页内联，不依赖任何外部资源 */
export const UPLOAD_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>书架 · 传书</title>
<style>
  :root { --bg:#f5f5f7; --card:#fff; --fg:#1d1d1f; --muted:#6e6e73; --accent:#0071e3; --ok:#1a7f37; --err:#cf222e; --border:#d2d2d7; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#000; --card:#1c1c1e; --fg:#f5f5f7; --muted:#98989d; --accent:#2997ff; --ok:#3fb950; --err:#ff7b72; --border:#38383a; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 -apple-system, "PingFang SC", system-ui, sans-serif; }
  main { max-width: 560px; margin: 48px auto; padding: 0 16px; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  p.sub { color: var(--muted); margin: 0 0 24px; }
  label { display: block; font-weight: 600; margin-bottom: 6px; }
  #pin { width: 140px; font: 600 24px ui-monospace, Menlo, monospace; letter-spacing: 8px; padding: 8px 12px;
         border: 1px solid var(--border); border-radius: 10px; background: var(--card); color: var(--fg); }
  #drop { margin-top: 20px; border: 2px dashed var(--border); border-radius: 16px; background: var(--card);
          padding: 48px 16px; text-align: center; cursor: pointer; transition: border-color .15s; }
  #drop.over { border-color: var(--accent); }
  #drop strong { color: var(--accent); }
  ul { list-style: none; padding: 0; margin: 20px 0 0; }
  li { background: var(--card); border-radius: 10px; padding: 10px 14px; margin-bottom: 8px; display: flex; gap: 12px; justify-content: space-between; }
  li .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  li .state { flex-shrink: 0; color: var(--muted); }
  li.ok .state { color: var(--ok); }
  li.err .state { color: var(--err); }
  code { font-family: ui-monospace, Menlo, monospace; font-size: 13px; }
  details { margin-top: 28px; color: var(--muted); }
  pre { background: var(--card); padding: 12px; border-radius: 10px; overflow-x: auto; }
</style>
</head>
<body>
<main>
  <h1>传书到书架</h1>
  <p class="sub">支持 <code>.zip</code>（一本书的目录）和 <code>.md</code>（单章书），单个文件不超过 50 MB。</p>
  <label for="pin">PIN（手机传书页面上显示）</label>
  <input id="pin" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="0000">
  <div id="drop"><strong>拖拽文件到这里</strong>，或点击选择<input id="file" type="file" accept=".zip,.md,.markdown" multiple hidden></div>
  <ul id="list"></ul>
  <details>
    <summary>用命令行推送</summary>
    <pre id="curl"></pre>
  </details>
</main>
<script>
  var pinInput = document.getElementById('pin');
  var drop = document.getElementById('drop');
  var fileInput = document.getElementById('file');
  var list = document.getElementById('list');
  document.getElementById('curl').textContent =
    'curl -H "X-Pin: <PIN>" -F file=@book.zip ' + location.origin + '/upload';

  var queue = Promise.resolve();
  function add(files) {
    for (var i = 0; i < files.length; i++) (function (f) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="name"></span><span class="state">等待中</span>';
      li.firstChild.textContent = f.name;
      list.prepend(li);
      queue = queue.then(function () { return upload(f, li); });
    })(files[i]);
  }

  function upload(file, li) {
    var state = li.lastChild;
    var pin = pinInput.value.trim();
    if (!/^\\d{4}$/.test(pin)) { li.className = 'err'; state.textContent = '请先输入 4 位 PIN'; return; }
    state.textContent = '上传中…';
    var fd = new FormData();
    fd.append('pin', pin);
    fd.append('file', file, file.name);
    return fetch('/upload', { method: 'POST', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        li.className = res.ok ? 'ok' : 'err';
        state.textContent = res.ok ? (res.status === 'updated' ? '已更新' : '已导入') : res.error;
      })
      .catch(function () { li.className = 'err'; state.textContent = '连接失败，传书页面可能已关闭'; });
  }

  drop.onclick = function () { fileInput.click(); };
  fileInput.onchange = function () { add(fileInput.files); fileInput.value = ''; };
  drop.ondragover = function (e) { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = function () { drop.classList.remove('over'); };
  drop.ondrop = function (e) { e.preventDefault(); drop.classList.remove('over'); add(e.dataTransfer.files); };
</script>
</body>
</html>
`;
