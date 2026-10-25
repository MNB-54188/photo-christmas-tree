/* 密码锁调试：清空会话 → 重载 → 逐帧记录弹窗状态 */
const CDP = 'http://127.0.0.1:9223';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch(CDP + '/json')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
const logs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  } else if (m.method === 'Runtime.exceptionThrown') {
    logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  } else if (m.method === 'Runtime.consoleAPICalled') {
    logs.push('LOG: ' + (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
  }
};
await new Promise((r) => { ws.onopen = r; });
function send(method, params = {}) {
  return new Promise((res, rej) => { const id = ++seq; pending.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); });
}
async function ev(e) {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return 'EVAL_ERR: ' + (r.exceptionDetails.exception?.description || '?');
  return r.result?.value;
}
await send('Runtime.enable'); await send('Page.enable');

/* 清会话并重载 */
await ev(`sessionStorage.clear(); 1`);
await send('Page.navigate', { url: 'http://127.0.0.1:8788/?t=' + Date.now() });
await sleep(4000);

console.log('mode=', await ev('window.__PT && window.__PT.store.mode'));
console.log('locked=', await ev('window.__PT && window.__PT.store.locked'));
console.log('lockHidden(before)=', await ev(`document.getElementById('lock').classList.contains('hidden')`));

const r1 = await ev(`(async () => {
  const blob = await (await fetch('/assets/samples/03.png')).blob();
  const file = new File([blob], 'dbg.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(file);
  const inp = document.getElementById('file-input');
  inp.files = dt.files;
  try { inp.dispatchEvent(new Event('change', { bubbles: true })); }
  catch (e) { return 'THROW: ' + e.message; }
  return 'dispatched, files=' + inp.files.length + ' type=' + file.type;
})()`);
console.log('trigger=', r1);

for (let i = 0; i < 16; i++) {
  await sleep(250);
  const s = await ev(`JSON.stringify({
    hidden: document.getElementById('lock').classList.contains('hidden'),
    err: document.getElementById('lock-err').textContent,
    n: window.__PT.store.photos.length,
    toast: document.getElementById('toast').textContent
  })`);
  console.log('t+' + (i + 1) * 250 + 'ms', s);
}
console.log('--- 控制台 ---'); logs.slice(-20).forEach((l) => console.log(l));
ws.close(); process.exit(0);
