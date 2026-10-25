/* 截一张「默认圣诞树造型 + 示例照片」的效果图，用于 README 头图
 * 用法：node test/shot_preview.mjs [cdp] [url] [输出] [造型]
 */
import { writeFileSync } from 'node:fs';
const CDP = process.argv[2] || 'http://127.0.0.1:9223';
const url = process.argv[3] || 'http://127.0.0.1:8123/';
const out = process.argv[4] || 'docs/preview.png';
const shape = process.argv[5] || 'tree';
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
/* 清掉本地照片，保证是示例照片的干净画面 */
await send('Runtime.evaluate', { expression: `try{indexedDB.deleteDatabase('photo-christmas-tree');}catch(e){} sessionStorage.clear(); 1` });
await send('Page.navigate', { url });
await sleep(9000);
await send('Runtime.evaluate', { expression: `window.__PT && window.__PT.setShape('${shape}')` });
await sleep(3000);
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await sleep(1000);
const s = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(s.data, 'base64'));
console.log('saved:', out, Buffer.from(s.data, 'base64').length, 'bytes');
ws.close(); process.exit(0);
