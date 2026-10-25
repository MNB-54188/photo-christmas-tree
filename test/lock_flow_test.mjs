/* ============================================================
 *  lock_flow_test.mjs —— 上传密码锁「端到端」浏览器验收
 *  前置：
 *    1) npx wrangler pages dev public --port 8788 -b UPLOAD_PASSWORD=test1234
 *    2) msedge --headless=new --remote-debugging-port=9223 --user-data-dir=/tmp/pt-lk3 http://127.0.0.1:8788/
 *  用法：node test/lock_flow_test.mjs [密码]
 * ============================================================ */
const PW = process.argv[2] || 'test1234';
const CDP = 'http://127.0.0.1:9223';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(CDP + '/json')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  }
};
await new Promise((r) => { ws.onopen = r; });
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
  return r.result?.value;
}

await send('Runtime.enable');
await send('Page.enable');

/* 0. 清空会话（避免上次记住的密码）+ 清空云端照片，保证干净起点 */
await send('Runtime.evaluate', { expression: `sessionStorage.clear(); 1` });
const before = await (await fetch('http://127.0.0.1:8788/api/photos')).json();
for (const p of before.photos || []) {
  await fetch('http://127.0.0.1:8788/api/photos/' + p.id, { method: 'DELETE' });
}
await send('Page.navigate', { url: 'http://127.0.0.1:8788/?t=' + Date.now() });
await sleep(4500);

const out = {};
const srv0 = await (await fetch('http://127.0.0.1:8788/api/photos')).json();
out['0_服务端初始照片数'] = (srv0.photos || []).length;
out['0_前端照片数'] = await ev('window.__PT ? window.__PT.store.photos.length : -1');
out['0_模式'] = await ev('window.__PT ? window.__PT.store.mode : "?"');
out['0_已锁定'] = await ev('window.__PT ? !!window.__PT.store.locked : null');

/* 1. 用带正确 MIME 的 File 触发上传流程 */
await ev(`(async () => {
  const blob = await (await fetch('/assets/samples/01.png')).blob();
  const file = new File([blob], 'lock-test.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const inp = document.getElementById('file-input');
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return file.type + '/' + file.size;
})()`);
await sleep(600);
out['1_触发文件类型'] = await ev('"image/png"');
out['1_弹窗是否显示'] = await ev(`document.getElementById('lock').classList.contains('hidden') ? '未弹出 ✗' : '已弹出 ✓'`);
out['1_弹窗标题'] = await ev(`document.getElementById('lock-title').textContent`);

/* 2. 错误密码 */
await ev(`(() => {
  document.getElementById('lock-input').value = 'wrong-pw';
  document.getElementById('lock-ok').click();
  return 1;
})()`);
await sleep(700);
out['2_错误密码提示'] = await ev(`document.getElementById('lock-err').textContent || '(空)'`);
out['2_弹窗仍打开'] = await ev(`document.getElementById('lock').classList.contains('hidden') ? '被关闭 ✗' : '保持打开 ✓'`);
out['2_照片数(应仍为0)'] = await ev('window.__PT.store.photos.length');

/* 3. 正确密码 */
await ev(`(() => {
  document.getElementById('lock-input').value = ${JSON.stringify(PW)};
  document.getElementById('lock-ok').click();
  return 1;
})()`);
/* 3b. 解锁后轮询，等上传落地（最多 10 秒） */
let closedAt = -1;
for (let i = 0; i < 20; i++) {
  await sleep(500);
  const st = await ev(`JSON.stringify({h:document.getElementById('lock').classList.contains('hidden'),t:document.getElementById('toast').textContent})`);
  const o = JSON.parse(st);
  if (o.h && closedAt < 0) closedAt = i;
  if (o.t) { out['3_toast_' + i] = o.t; break; }
}
out['3_弹窗是否关闭'] = await ev(`document.getElementById('lock').classList.contains('hidden') ? '已关闭 ✓(第' + ${closedAt} + '次轮询)' : '仍打开 ✗'`);
out['3_前端照片数'] = await ev('window.__PT.store.photos.length');
out['3_状态栏'] = await ev(`document.getElementById('stat').textContent`);

/* 4. 服务端核对 */
const after = await (await fetch('http://127.0.0.1:8788/api/photos')).json();
out['4_服务端照片数'] = (after.photos || []).length;
out['4_文件名'] = (after.photos || []).map((p) => p.name).join(',');

/* 5. 二次上传（会话内已记住密码，不应再弹窗） */
await ev(`(async () => {
  const blob = await (await fetch('/assets/samples/02.png')).blob();
  const file = new File([blob], 'lock-test2.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(file);
  const inp = document.getElementById('file-input');
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return 1;
})()`);
await sleep(2200);
out['5_第二次上传弹窗'] = await ev(`document.getElementById('lock').classList.contains('hidden') ? '未弹出 ✓(已记住)' : '又弹出 ✗'`);
out['5_照片数'] = await ev('window.__PT.store.photos.length');

/* 6. 未授权直接调接口（应 401） */
const r401 = await fetch('http://127.0.0.1:8788/api/photos', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'x.png', data: 'data:image/png;base64,iVBORw0KGgo=' }),
});
out['6_无密码直传状态码'] = r401.status;

console.log(JSON.stringify(out, null, 2));
ws.close();
process.exit(0);
