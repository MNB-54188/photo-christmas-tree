/* 用法: node test/cdp_shot.mjs <url> <输出.png> [等待毫秒] [形状] */
const CDP = 'http://127.0.0.1:9223';
const url = process.argv[2] || 'http://127.0.0.1:8123/';
const out = process.argv[3] || '/tmp/shot.png';
const waitMs = +(process.argv[4] || 4000);
const shape = process.argv[5] || '';

import { writeFileSync } from 'node:fs';

const list = await (await fetch(CDP + '/json')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  }
};
await new Promise((r) => { ws.onopen = r; });
const send = (m, p) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id, method: m, params: p || {} }));
});

await send('Page.enable');
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, waitMs));

if (shape) {
  await send('Runtime.evaluate', { expression: `window.__PT && window.__PT.setShape('${shape}')` });
  await new Promise((r) => setTimeout(r, 2600));
}

await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await new Promise((r) => setTimeout(r, 900));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('saved:', out, Buffer.from(shot.data, 'base64').length, 'bytes');
ws.close();
process.exit(0);
