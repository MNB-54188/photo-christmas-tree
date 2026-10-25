/* 截一张「线上站点 + 密码弹窗」的图，用于确认样式 */
import { writeFileSync } from 'node:fs';
const CDP = process.argv[2] || 'http://127.0.0.1:9223';
const out = process.argv[3] || 'docs/lock-preview.png';
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
const send = (m, pa = {}) => new Promise((res, rej) => {
  const id = ++seq; pend.set(id, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id, method: m, params: pa }));
});

await send('Page.enable');
await send('Runtime.evaluate', { expression: 'sessionStorage.clear();1' });
await send('Page.navigate', { url: 'https://photo-christmas-tree.pages.dev/?shot=1' });
await sleep(11000);

const expr = `(async () => {
  const b = await (await fetch('/assets/samples/11.png')).blob();
  const dt = new DataTransfer();
  dt.items.add(new File([b], 'shot.png', { type: 'image/png' }));
  const i = document.getElementById('file-input');
  i.files = dt.files;
  i.dispatchEvent(new Event('change', { bubbles: true }));
  return 1;
})()`;
await send('Runtime.evaluate', { expression: expr, awaitPromise: true });
await sleep(1300);
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await sleep(900);
const s = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(s.data, 'base64'));
console.log('saved:', out);
ws.close(); process.exit(0);
