/* ============================================================
 *  gesture_test.mjs —— 手势判定逻辑单元测试（无需摄像头）
 *
 *  通过 CDP 在页面里 import gestures.js，喂入"伪造的 MediaPipe 21 关键点"，
 *  验证：捏合不再被误判成食指、双手缩放真的生效、缩放方向正确。
 *
 *  用法：
 *    msedge --headless=new --remote-debugging-port=9223 ...
 *    node test/gesture_test.mjs
 * ============================================================ */

const CDP = 'http://127.0.0.1:9223';
const BASE = process.argv[2] || 'http://127.0.0.1:8123';

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

await send('Page.enable');
await send('Page.navigate', { url: BASE + '/' });
await new Promise((r) => setTimeout(r, 1500));

const PROBE = `
(async () => {
  const mod = await import('/js/gestures.js');
  const P = (x, y) => ({ x, y, z: 0 });

  /* ---- 手型工厂：21 个关键点，坐标为归一化图像坐标 ---- */
  const OPEN = [
    P(0.50,0.90), P(0.40,0.85), P(0.30,0.78), P(0.22,0.70), P(0.16,0.62),
    P(0.46,0.66), P(0.45,0.56), P(0.45,0.50), P(0.45,0.45),
    P(0.52,0.65), P(0.53,0.54), P(0.53,0.48), P(0.53,0.43),
    P(0.58,0.67), P(0.59,0.57), P(0.59,0.51), P(0.59,0.46),
    P(0.64,0.70), P(0.65,0.62), P(0.65,0.57), P(0.65,0.52),
  ];
  const clone = (a) => a.map(p => ({ x: p.x, y: p.y, z: 0 }));
  const PALM = 0.2504;   // dist(wrist, lm[9])，即 pinchRatio 的分母

  /* 食指伸直、其余弯曲、拇指收回 —— 经典的"指一下" */
  function pointHand() {
    const h = clone(OPEN);
    h[4] = P(0.40, 0.78);                       // 拇指收
    h[12] = P(0.51, 0.62); h[11] = P(0.52, 0.58);
    h[16] = P(0.57, 0.64); h[15] = P(0.58, 0.60);
    h[20] = P(0.63, 0.68); h[19] = P(0.64, 0.65);
    return h;
  }
  /* 捏合：拇指尖与食指尖挨在一起。ratio = 指尖间距 / 手掌尺度 */
  function pinchHand(ratio = 0.06) {
    const h = pointHand();
    h[6] = P(0.45, 0.56);
    h[7] = P(0.40, 0.58);
    h[8] = P(0.40, 0.60);                            // 食指尖固定在掌外
    const d = ratio * PALM;
    h[4] = P(0.40 - d * 0.6, 0.60 + d * 0.8);        // 拇指尖，与食指尖相距 d
    return h;
  }
  function fistHand() {
    const h = clone(OPEN);
    h[4] = P(0.44, 0.80);
    [8, 12, 16, 20].forEach((t, i) => { h[t] = P(0.50 + i * 0.03, 0.74); });
    [7, 11, 15, 19].forEach((t, i) => { h[t] = P(0.49 + i * 0.03, 0.70); });
    return h;
  }

  const out = {};
  const gc = new mod.GestureController({ video: null, canvas: null });
  gc.SMOOTH = 1;                       // 测试时关闭平滑，直接用原始输入
  let radius = 48;
  gc.getRadius = () => radius;
  gc.setRadius = (r) => { radius = Math.max(14, Math.min(96, r)); };
  gc.minR = 14; gc.maxR = 96;
  const fired = [];
  gc.onGesture = (n) => fired.push(n);

  const analyze = (lm, idx = 0) => {
    const h = gc._analyze(lm, null, idx);
    gc._prev = [h.lm]; gc._prevNames = [h.name];
    return h;
  };

  /* ---- 1. 捏合不应被判成食指 ---- */
  out['1_捏合判定'] = analyze(pinchHand(0)).name;           // 期望 pinch
  out['1b_捏合数值'] = +analyze(pinchHand(0)).pinchRatio.toFixed(3);

  /* ---- 2. 伸食指应判成 point，且不被误判为 pinch ---- */
  out['2_食指判定'] = analyze(pointHand()).name;            // 期望 point
  out['2b_食指捏合值'] = +analyze(pointHand()).pinchRatio.toFixed(3);

  /* ---- 3. 张开手掌 / 握拳 ---- */
  out['3_张开手掌'] = analyze(OPEN).name;                   // 期望 open
  out['3b_握拳'] = analyze(fistHand()).name;                // 期望 fist

  /* ---- 4. 捏合滞后：已在捏合状态时，半张开(0.5)仍保持 pinch ---- */
  out['4_首次半张开不判捏合'] = analyze(pinchHand(0.5)).name;  // 0.5 > 0.42 → 非 pinch
  analyze(pinchHand(0.06));                                   // 先进入捏合
  gc._prevNames = ['pinch'];
  out['4b_已捏合时半张开保持'] = analyze(pinchHand(0.5)).name; // 0.5 < 0.62 → pinch

  /* ---- 5. 单手捏合缩放：手指张开应"拉近"（radius 变小 = 放大） ---- */
  radius = 48;
  const h1 = analyze(pinchHand(0.06));   // 捏紧
  gc._dispatch([h1]); gc._dispatch([h1]);
  const rStart = radius;
  for (let i = 1; i <= 8; i++) {         // 逐渐张开
    const h = analyze(pinchHand(0.06 + i * 0.05));
    gc._dispatch([h]);
  }
  out['5_单手张开后半径'] = { 起: +rStart.toFixed(2), 终: +radius.toFixed(2), 方向: radius < rStart ? '拉近(放大) ✓' : '推远(缩小) ✗' };

  /* ---- 6. 双手缩放：基准只建立一次，两手拉开放大 ---- */
  radius = 48;
  const mk = (cx) => { const h = analyze(pinchHand(0)); h.cx = cx; h.cy = 0.5; return h; };
  let a = mk(0.35), b = mk(0.55);        // 初始间距 0.20
  gc._dispatch([a, b]); gc._dispatch([a, b]);
  const rTwoStart = radius;
  a = mk(0.20); b = mk(0.80);            // 拉开到 0.60
  for (let i = 0; i < 12; i++) gc._dispatch([a, b]);
  out['6_双手拉开放大'] = { 起: +rTwoStart.toFixed(2), 终: +radius.toFixed(2), 方向: radius < rTwoStart ? '拉近(放大) ✓' : '无变化/反了 ✗' };

  /* ---- 7. 双手靠拢应缩小（推远） ---- */
  a = mk(0.42); b = mk(0.48);            // 收拢到 0.06
  for (let i = 0; i < 12; i++) gc._dispatch([a, b]);
  out['7_双手靠拢'] = { 半径: +radius.toFixed(2), 方向: radius > rTwoStart ? '推远(缩小) ✓' : '✗' };

  /* ---- 8. 捏合松开后短时间内不应误触发离散手势 ---- */
  fired.length = 0;
  gc._fired = 'pinch';
  gc._pinchReleaseAt = performance.now();
  const hp = analyze(pointHand());
  for (let i = 0; i < 10; i++) gc._dispatch([hp]);
  out['8_松手冷却期间触发数'] = fired.length;   // 期望 0

  return out;
})()
`;

const r = await send('Runtime.evaluate', {
  expression: PROBE, awaitPromise: true, returnByValue: true,
});

if (!r.result) {
  console.log('无 result，原始响应：', JSON.stringify(r).slice(0, 1500));
} else if (r.exceptionDetails) {
  console.log('执行异常:', JSON.stringify(r.exceptionDetails, null, 2).slice(0, 1500));
} else {
  console.log(JSON.stringify(r.result.result ? r.result.result.value : r.result, null, 2));
}
ws.close();
process.exit(0);
