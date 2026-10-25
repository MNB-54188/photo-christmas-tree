/* 用法: node test/cdp_eval.mjs "<表达式>" —— 通过 CDP 在页面里求值 */
const CDP = 'http://127.0.0.1:9223';
const expr = process.argv[2] || '1+1';

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

const r = await new Promise((resolve) => {
  const id = ++seq;
  pending.set(id, { resolve });
  ws.send(JSON.stringify({
    id, method: 'Runtime.evaluate',
    params: { expression: expr, awaitPromise: true, returnByValue: true },
  }));
});
console.log(JSON.stringify(r, null, 2));
ws.close();
process.exit(0);
