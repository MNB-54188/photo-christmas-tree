/* 线上站点（photo-christmas-tree.pages.dev）密码锁浏览器验收
 * 用法：node test/live_lock_check.mjs [密码] [cdp地址]
 * 会自动上传一张示例图并在结束后删除，不留垃圾数据
 */
const PW = process.argv[2];
if (!PW) { console.error('用法: node test/live_lock_check.mjs <密码> [cdp地址]'); process.exit(1); }
const CDP = process.argv[3] || 'http://127.0.0.1:9223';
const BASE = 'https://photo-christmas-tree.pages.dev';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(CDP + '/json')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
};
await new Promise((r) => { ws.onopen = r; });
function send(method, params = {}) {
  return new Promise((res, rej) => { const id = ++seq; pending.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); });
}
async function ev(e) {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return 'ERR:' + (r.exceptionDetails.exception?.description || '?');
  return r.result?.value;
}
await send('Runtime.enable'); await send('Page.enable');
await send('Runtime.evaluate', { expression: `sessionStorage.clear(); 1` });
await send('Page.navigate', { url: BASE + '/?t=' + Date.now() });
await sleep(9000);

const out = {};
out['模式'] = await ev('window.__PT && window.__PT.store.mode');
out['是否加锁'] = await ev('window.__PT && window.__PT.store.locked');
const n0 = await ev('window.__PT.store.photos.length');
out['上传前照片数'] = n0;

await ev(`(async () => {
  const blob = await (await fetch('/assets/samples/09.png')).blob();
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'live-lock-check.png', { type: 'image/png' }));
  const inp = document.getElementById('file-input');
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return 1;
})()`);
await sleep(800);
out['选文件后弹窗'] = await ev(`document.getElementById('lock').classList.contains('hidden') ? '未弹出 ✗' : '已弹出 ✓'`);
await ev(`(() => { document.getElementById('lock-input').value = 'nope'; document.getElementById('lock-ok').click(); return 1; })()`);
await sleep(900);
out['错密码提示'] = await ev(`document.getElementById('lock-err').textContent`);
await ev(`(() => { document.getElementById('lock-input').value = ${JSON.stringify(PW)}; document.getElementById('lock-ok').click(); return 1; })()`);
await sleep(6000);
out['对密码后弹窗'] = await ev(`document.getElementById('lock').classList.contains('hidden') ? '已关闭 ✓' : '仍打开 ✗'`);
out['提示'] = await ev(`document.getElementById('toast').textContent`);
out['上传后照片数'] = await ev('window.__PT.store.photos.length');

/* 清理：删掉刚传的测试图 */
const j = await (await fetch(BASE + '/api/photos')).json();
const hit = (j.photos || []).find((p) => p.name === 'live-lock-check');
if (hit) {
  const d = await fetch(BASE + '/api/photos/' + hit.id, { method: 'DELETE' });
  out['清理测试图'] = (await d.json()).ok ? '已删除 ✓' : '删除失败 ✗';
} else out['清理测试图'] = '未找到（可能未上传成功）';

console.log(JSON.stringify(out, null, 2));
ws.close(); process.exit(0);
