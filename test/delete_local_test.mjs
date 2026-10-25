/* 纯静态本地模式（IndexedDB）下：首次上传设置密码 → 删除也要密码
 * 前置：python -m http.server 8123 --directory public（后台）+ 9226 的 Edge
 * 用法：node test/delete_local_test.mjs <密码> [cdp]
 */
const PW = process.argv[2];
const CDP = process.argv[3] || 'http://127.0.0.1:9226';
const BASE = 'http://127.0.0.1:8123/';
if (!PW) { console.error('用法: node test/delete_local_test.mjs <密码> [cdp]'); process.exit(1); }
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
const send = (m, pa = {}) => new Promise((res, rej) => { const id = ++seq; pend.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method: m, params: pa })); });
async function ev(e) {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return 'ERR:' + (r.exceptionDetails.exception?.description || '?');
  return r.result?.value;
}
await send('Runtime.enable'); await send('Page.enable');
await send('Runtime.evaluate', { expression: `try{indexedDB.deleteDatabase('photo-christmas-tree');}catch(e){} localStorage.removeItem('pt-upload-pw-hash'); sessionStorage.clear(); 1` });
await send('Page.navigate', { url: BASE + '?t=' + Date.now() });
await sleep(5000);

const out = {};
out['0_模式'] = await ev('window.__PT.store.mode');   // 期望 local

/* 1. 首次上传 → 应是「设置密码」（两个输入框） */
await ev(`(async () => {
  const b = await (await fetch('/assets/samples/06.png')).blob();
  const dt = new DataTransfer();
  dt.items.add(new File([b], 'local-del.png', { type: 'image/png' }));
  const i = document.getElementById('file-input');
  i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true }));
  return 1;
})()`);
await sleep(800);
out['1_弹窗标题'] = await ev(`document.getElementById('lock-title').textContent`);
out['1_两个输入框'] = await ev(`document.getElementById('lock-input2').classList.contains('hidden') ? '否 ✗' : '是 ✓'`);
await ev(`(() => {
  document.getElementById('lock-input').value = ${JSON.stringify(PW)};
  document.getElementById('lock-input2').value = ${JSON.stringify(PW)};
  document.getElementById('lock-ok').click(); return 1;
})()`);
await sleep(3500);
out['1_上传后照片数'] = await ev('window.__PT.store.photos.length');

/* 2. 删除 → 需要密码 */
await ev(`document.getElementById('btn-manage').click(); 1`);
await sleep(600);
out['2_删除按钮数'] = await ev(`document.querySelectorAll('#panel-body [data-del]').length`);
await ev(`(() => { const b = document.querySelector('#panel-body [data-del]'); if (b) b.click(); return !!b; })()`);
await sleep(700);
out['2_删除弹窗'] = await ev(`document.getElementById('lock').classList.contains('hidden') ? '未弹出 ✗' : '已弹出 ✓'`);
out['2_弹窗标题'] = await ev(`document.getElementById('lock-title').textContent`);

/* 3. 错密码 */
await ev(`(() => { document.getElementById('lock-input').value = 'nope'; document.getElementById('lock-ok').click(); return 1; })()`);
await sleep(800);
out['3_错密码提示'] = await ev(`document.getElementById('lock-err').textContent`);
out['3_照片数(不变)'] = await ev('window.__PT.store.photos.length');

/* 4. 正确密码 → 删除 */
await ev(`(() => { document.getElementById('lock-input').value = ${JSON.stringify(PW)}; document.getElementById('lock-ok').click(); return 1; })()`);
await sleep(2500);
out['4_提示'] = await ev(`document.getElementById('toast').textContent`);
out['4_照片数'] = await ev('window.__PT.store.photos.length');

console.log(JSON.stringify(out, null, 2));
ws.close(); process.exit(0);
