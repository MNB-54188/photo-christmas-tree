/* 删除密码锁端到端验收（浏览器）
 * 前置：npx wrangler pages dev public --port 8788 -b UPLOAD_PASSWORD=<密码> + 9223 的 Edge
 * 用法：node test/delete_lock_test.mjs <密码> [cdp]
 */
const PW = process.argv[2];
const CDP = process.argv[3] || 'http://127.0.0.1:9223';
const BASE = 'http://127.0.0.1:8788';
if (!PW) { console.error('用法: node test/delete_lock_test.mjs <密码> [cdp地址]'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(CDP + '/json')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pend = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
};
await new Promise((r) => { ws.onopen = r; });
function send(m, pa = {}) {
  return new Promise((res, rej) => { const id = ++seq; pend.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method: m, params: pa })); });
}
async function ev(e) {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return 'ERR:' + (r.exceptionDetails.exception?.description || '?');
  return r.result?.value;
}
await send('Runtime.enable'); await send('Page.enable');

/* 清空云端 + 会话，重新加载 */
for (const p of (await (await fetch(BASE + '/api/photos')).json()).photos || []) {
  await fetch(`${BASE}/api/photos/${p.id}`, { method: 'DELETE', headers: { 'X-Upload-Password': PW } });
}
await send('Runtime.evaluate', { expression: 'sessionStorage.clear();1' });
await send('Page.navigate', { url: BASE + '/?t=' + Date.now() });
await sleep(5000);

const out = {};
out['0_模式'] = await ev('window.__PT.store.mode');
out['0_已加锁'] = await ev('window.__PT.store.locked');

/* 1. 上传一张（先解锁） */
await ev(`(async () => {
  const b = await (await fetch('/assets/samples/04.png')).blob();
  const dt = new DataTransfer();
  dt.items.add(new File([b], 'del-flow.png', { type: 'image/png' }));
  const i = document.getElementById('file-input');
  i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true }));
  return 1;
})()`);
await sleep(700);
out['1_上传弹窗'] = await ev(`document.getElementById('lock').classList.contains('hidden') ? '未弹出 ✗' : '已弹出 ✓'`);
await ev(`(() => { document.getElementById('lock-input').value = ${JSON.stringify(PW)}; document.getElementById('lock-ok').click(); return 1; })()`);
await sleep(4000);
out['1_上传后照片数'] = await ev('window.__PT.store.photos.length');

/* 2. 打开相册面板，点删除 → 应再次要求密码（force） */
await ev(`document.getElementById('btn-manage').click(); 1`);
await sleep(600);
out['2_面板删除按钮数'] = await ev(`document.querySelectorAll('#panel-body [data-del]').length`);
await ev(`(() => { const b = document.querySelector('#panel-body [data-del]'); if (b) b.click(); return !!b; })()`);
await sleep(700);
out['2_删除弹窗'] = await ev(`document.getElementById('lock').classList.contains('hidden') ? '未弹出 ✗' : '已弹出 ✓'`);
out['2_弹窗标题'] = await ev(`document.getElementById('lock-title').textContent`);

/* 3. 错密码 → 不删除 */
await ev(`(() => { document.getElementById('lock-input').value = 'bad'; document.getElementById('lock-ok').click(); return 1; })()`);
await sleep(900);
out['3_错密码提示'] = await ev(`document.getElementById('lock-err').textContent`);
out['3_照片数(应不变)'] = await ev('window.__PT.store.photos.length');

/* 4. 正确密码 → 删除成功 */
await ev(`(() => { document.getElementById('lock-input').value = ${JSON.stringify(PW)}; document.getElementById('lock-ok').click(); return 1; })()`);
await sleep(3000);
out['4_提示'] = await ev(`document.getElementById('toast').textContent`);
out['4_照片数'] = await ev('window.__PT.store.photos.length');
const srv = await (await fetch(BASE + '/api/photos')).json();
out['4_服务端照片数'] = (srv.photos || []).length;

console.log(JSON.stringify(out, null, 2));
ws.close(); process.exit(0);
