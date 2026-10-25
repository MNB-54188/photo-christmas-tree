/* ============================================================
 *  gesture_map_test.mjs —— 验证"手势 → 实际动作"的映射
 *  需要浏览器：通过 CDP 在页面里调用 gc.onGesture(name) 并检查结果
 *
 *  用法：
 *    msedge --headless=new --remote-debugging-port=9223 ...
 *    node test/gesture_map_test.mjs [url]
 * ============================================================ */

const CDP = 'http://127.0.0.1:9223';
const url = process.argv[2] || 'http://127.0.0.1:8788/';

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
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.enable');
await send('Page.navigate', { url });

let ready = '';
for (let i = 0; i < 40; i++) {
  await sleep(700);
  const r = await send('Runtime.evaluate', {
    expression: 'document.readyState + "|" + (window.__PT ? "ready" : "no")', returnByValue: true,
  });
  ready = r.result.value;
  if (ready.includes('complete|ready')) break;
}
console.log('页面状态:', ready);

const r = await send('Runtime.evaluate', {
  expression: `(async () => {
    const P = window.__PT;
    const lb = document.getElementById('lightbox');
    const open = () => !lb.classList.contains('hidden');
    const cap = () => document.getElementById('lb-name').textContent;
    const out = {};
    const step = async (g) => { P.gestures.onGesture(g); await new Promise(r => setTimeout(r, 120)); };

    /* 1. 比耶：未打开时先打开一张 */
    await step('peace');
    out['1_比耶_打开照片'] = open() ? '已打开' : '未打开';
    const first = cap();

    /* 2. 比耶：再触发一次 → 下一张 */
    await step('peace');
    out['2_比耶_下一张'] = cap() !== first ? ('换了一张: ' + cap().slice(-12)) : '没变化 ✗';

    /* 3. 食指：关闭（此时在照片界面，应生效） */
    await step('point');
    out['3_食指_关闭'] = open() ? '没关掉 ✗' : '已关闭 ✓';

    /* 4. 食指：不在照片界面时不生效（防误触） */
    const shapeBefore = P.tree.shape;
    await step('point');
    out['4_食指_非照片界面'] = (!open() && P.tree.shape === shapeBefore) ? '无副作用 ✓' : '有误触 ✗';

    /* 5. 四指：下一个造型 */
    const s0 = P.tree.shape;
    await step('four');
    out['5_四指_下一个造型'] = s0 + ' → ' + P.tree.shape;

    /* 6. 三指：上一个造型 */
    const s1 = P.tree.shape;
    await step('three');
    out['6_三指_上一个造型'] = s1 + ' → ' + P.tree.shape;

    /* 7. 握拳：收回圣诞树 */
    await step('fist');
    out['7_握拳'] = P.tree.shape;

    return out;
  })()`,
  awaitPromise: true, returnByValue: true,
});

const ex = r.exceptionDetails || (r.result && r.result.exceptionDetails);
if (ex) console.log('异常:', JSON.stringify(ex).slice(0, 1500));
else if (!r.result) console.log('原始响应:', JSON.stringify(r).slice(0, 1000));
else console.log(JSON.stringify(r.result.result ? r.result.result.value : r.result, null, 2));

ws.close();
process.exit(0);
