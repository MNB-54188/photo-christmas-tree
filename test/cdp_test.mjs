/* ============================================================
 *  cdp_test.mjs —— 通过 Chrome DevTools 协议做运行时自检
 *  用法：
 *    1) 启动无头浏览器: msedge --headless=new --remote-debugging-port=9222 \
 *         --user-data-dir=/tmp/pt-profile about:blank
 *    2) node test/cdp_test.mjs "http://127.0.0.1:8123/"
 * ============================================================ */

const target = process.argv[2] || 'http://127.0.0.1:8123/';
const CDP = 'http://127.0.0.1:9223';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(CDP + '/json')).json();
const page = list.find((t) => t.type === 'page');
if (!page) { console.error('找不到页面 target'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const consoleLogs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  } else if (m.method === 'Runtime.consoleAPICalled') {
    consoleLogs.push(m.params.type + ': ' + (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
  } else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    consoleLogs.push('EXCEPTION: ' + (d.exception && (d.exception.description || d.exception.value) || d.text));
  }
};

await new Promise((r) => { ws.onopen = r; });

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: target });

/* 等待加载完成 */
let ready = '';
for (let i = 0; i < 40; i++) {
  await sleep(700);
  try {
    const r = await send('Runtime.evaluate', {
      expression: 'document.readyState + "|" + (window.__PT ? "ready" : "no")',
      returnByValue: true,
    });
    ready = r.result.value;
    if (ready.includes('complete|ready')) break;
  } catch (e) { /* 页面跳转中 */ }
}

/* 主探针 */
const probe = await send('Runtime.evaluate', {
  expression: `(async () => {
    const out = {};
    const P = window.__PT;
    out.hasPT = !!P;
    if (!P) return out;
    out.mode = P.store.mode;
    out.photoCount = P.store.photos.length;
    out.tiles = P.tree.items.length;
    out.shape = P.tree.shape;
    out.dim = P.tree.dim ? { R: +P.tree.dim.R.toFixed(2), H: +P.tree.dim.H.toFixed(2) } : null;
    out.autoRotate = P.tree.autoRotate;

    /* 造型切换冒烟测试 */
    const shapes = ['sphere', 'heart', 'wall', 'tree'];
    for (const s of shapes) {
      P.tree.setShape(s);
      await new Promise(r => setTimeout(r, 120));
      P.tree.update();
      const p0 = P.tree.items[0].mesh.position;
      out['shape_' + s] = { ok: true, sample: [+p0.x.toFixed(2), +p0.y.toFixed(2), +p0.z.toFixed(2)] };
    }

    /* 轨道控制 */
    P.tree.rotateBy(0.5, 0.1);
    P.tree.zoomBy(0.9);
    out.orbitAfter = { theta: +P.tree.orbit.theta.toFixed(3), radius: +P.tree.orbit.radius.toFixed(2) };

    /* 手势接口 */
    P.tree.setRotationFromPointer(0.8, 0.3);
    out.gesturePointer = { theta: +P.tree.orbit.theta.toFixed(3), phi: +P.tree.orbit.phi.toFixed(3) };

    out.centerIndex = P.tree.getCenterIndex();
    return out;
  })()`,
  awaitPromise: true,
  returnByValue: true,
});

console.log('readyState:', ready);
console.log('--- 运行时探针 ---');
if (!probe.result) {
  console.log('evaluate 失败:', JSON.stringify(probe).slice(0, 800));
} else {
  console.log(JSON.stringify(probe.result.result ? probe.result.result.value : probe.result, null, 2));
}

/* DOM 探针 */
const dom = await send('Runtime.evaluate', {
  expression: `(() => ({
    loaderDone: document.getElementById('loader').classList.contains('done'),
    stat: document.getElementById('stat').textContent,
    sub: document.getElementById('brand-sub').textContent,
    tips: document.getElementById('loader-tip').textContent,
    thumbs: document.querySelectorAll('#panel-body .thumb').length,
    chips: [...document.querySelectorAll('#shape-row .chip')].map(c => c.dataset.shape + (c.classList.contains('active') ? '*' : '')),
  }))()`,
  returnByValue: true,
});
console.log('--- DOM 探针 ---');
console.log(JSON.stringify(dom.result && dom.result.result ? dom.result.result.value : dom, null, 2));

if (consoleLogs.length) {
  console.log('--- 页面控制台 ---');
  consoleLogs.slice(0, 30).forEach((l) => console.log(l));
}

ws.close();
process.exit(0);
