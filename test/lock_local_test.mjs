/* 纯静态本地模式（IndexedDB，无后端接口）下的密码锁验收
 * 前置：python -m http.server 8123 --directory public   +  已开 9223 的 Edge
 * 用法：node test/lock_local_test.mjs [密码]
 */
const PW = process.argv[2] || 'ma13136665930';
const CDP = process.argv[3] || 'http://127.0.0.1:9223';
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
await send('Runtime.evaluate', { expression: `sessionStorage.clear(); localStorage.removeItem('pt-upload-pw-hash'); 1` });
await send('Page.navigate', { url: 'http://127.0.0.1:8123/?t=' + Date.now() });
await sleep(4500);

const out = {};
out['模式'] = await ev('window.__PT && window.__PT.store.mode');           // 期望 local
out['是否加锁'] = await ev(`!!window.__PT && !document.getElementById('lock').classList.contains('hidden') ? '弹窗中' : (window.__PT ? '待触发' : 'no')`);

await ev(`(async () => {
  const blob = await (await fetch('/assets/samples/05.png')).blob();
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'local-test.png', { type: 'image/png' }));
  const inp = document.getElementById('file-input');
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return 1;
})()`);
await sleep(700);
out['选文件后弹窗'] = await ev(`document.getElementById('lock').classList.contains('hidden') ? '未弹出 ✗' : '已弹出 ✓'`);

await ev(`(() => { document.getElementById('lock-input').value = 'bad'; document.getElementById('lock-ok').click(); return 1; })()`);
await sleep(600);
out['错密码'] = await ev(`document.getElementById('lock-err').textContent`);

await ev(`(() => { document.getElementById('lock-input').value = ${JSON.stringify(PW)}; document.getElementById('lock-ok').click(); return 1; })()`);
await sleep(2500);
out['对密码后弹窗'] = await ev(`document.getElementById('lock').classList.contains('hidden') ? '已关闭 ✓' : '仍打开 ✗'`);
out['提示'] = await ev(`document.getElementById('toast').textContent`);
out['照片数'] = await ev('window.__PT.store.photos.length');
console.log(JSON.stringify(out, null, 2));
ws.close(); process.exit(0);
