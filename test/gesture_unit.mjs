/* ============================================================
 *  gesture_unit.mjs —— 手势判定单元测试（纯 Node，无需浏览器/摄像头）
 *
 *  直接 import public/js/gestures.js，喂入伪造的 MediaPipe 21 关键点。
 *  运行：node test/gesture_unit.mjs
 * ============================================================ */

import { GestureController } from '../public/js/gestures.js';

const P = (x, y) => ({ x, y, z: 0 });
const clone = (a) => a.map((p) => ({ x: p.x, y: p.y, z: 0 }));

/* 基准：五指张开的右手（正对摄像头），拇指外展 */
const OPEN = [
  P(0.50, 0.90), P(0.40, 0.85), P(0.30, 0.78), P(0.22, 0.70), P(0.16, 0.62),
  P(0.46, 0.66), P(0.45, 0.56), P(0.45, 0.50), P(0.45, 0.45),
  P(0.52, 0.65), P(0.53, 0.54), P(0.53, 0.48), P(0.53, 0.43),
  P(0.58, 0.67), P(0.59, 0.57), P(0.59, 0.51), P(0.59, 0.46),
  P(0.64, 0.70), P(0.65, 0.62), P(0.65, 0.57), P(0.65, 0.52),
];
const PALM = 0.2504;   // dist(wrist, lm[9])

/* 手掌张开、但拇指判定不理想的各种真实情况 */
const variants = {
  '标准张开手掌': OPEN,
  '拇指外展较小': (() => { const h = clone(OPEN); h[4] = P(0.24, 0.66); h[3] = P(0.28, 0.72); return h; })(),
  '拇指几乎贴掌(侧对手)': (() => { const h = clone(OPEN); h[4] = P(0.38, 0.74); h[3] = P(0.38, 0.78); h[2] = P(0.40, 0.82); return h; })(),
  '手掌略倾斜': (() => { const h = clone(OPEN); h[4] = P(0.20, 0.70); h[17] = P(0.62, 0.74); return h; })(),
};

/* 四指伸直 + 拇指明确折向掌心（数字 4 手势） */
function fourHand() {
  const h = clone(OPEN);
  h[4] = P(0.48, 0.80); h[3] = P(0.46, 0.82); h[2] = P(0.44, 0.84);
  return h;
}
/* 食指伸直、其余弯曲 —— 指一下 */
function pointHand() {
  const h = clone(OPEN);
  h[4] = P(0.40, 0.78);
  h[12] = P(0.51, 0.62); h[11] = P(0.52, 0.58);
  h[16] = P(0.57, 0.64); h[15] = P(0.58, 0.60);
  h[20] = P(0.63, 0.68); h[19] = P(0.64, 0.65);
  return h;
}
/* 捏合：ratio = 拇指尖↔食指尖距离 / 手掌尺度 */
function pinchHand(ratio = 0.06) {
  const h = pointHand();
  h[6] = P(0.45, 0.56); h[7] = P(0.40, 0.58); h[8] = P(0.40, 0.60);
  const d = ratio * PALM;
  h[4] = P(0.40 - d * 0.6, 0.60 + d * 0.8);
  return h;
}
/* 比耶：食指中指伸直，无名/小指弯曲 */
function peaceHand() {
  const h = clone(OPEN);
  h[4] = P(0.40, 0.78);
  h[16] = P(0.57, 0.64); h[15] = P(0.58, 0.60);
  h[20] = P(0.63, 0.68); h[19] = P(0.64, 0.65);
  return h;
}
/* 三指：食指中指无名指伸直，小指弯曲 */
function threeHand() {
  const h = clone(OPEN);
  h[4] = P(0.40, 0.78);
  h[20] = P(0.63, 0.68); h[19] = P(0.64, 0.65);
  return h;
}
/* 张开手掌但小指没完全伸直（MediaPipe 常见误判） */
function openPinkyShort() {
  const h = clone(OPEN);
  h[20] = P(0.65, 0.56);   // 小指尖稍微收回一点
  return h;
}
/* 握拳：所有指尖卷回掌心，拇指压在手指上 */
function fistHand() {
  const h = clone(OPEN);
  h[4] = P(0.44, 0.80);
  [8, 12, 16, 20].forEach((t, i) => { h[t] = P(0.50 + i * 0.03, 0.74); });
  [7, 11, 15, 19].forEach((t, i) => { h[t] = P(0.49 + i * 0.03, 0.70); });
  return h;
}
/* 握拳变体：食指尖没完全收回（tip 略大于 1），或拇指搭在外面 */
const fistVariants = {
  '握拳·标准': fistHand(),
  '握拳·拇指搭在外侧': (() => { const h = fistHand(); h[4] = P(0.40, 0.78); h[3] = P(0.38, 0.81); h[2] = P(0.40, 0.84); return h; })(),
  '握拳·食指微露': (() => { const h = fistHand(); h[8] = P(0.47, 0.70); h[7] = P(0.46, 0.72); return h; })(),
  '握拳·握得松一点': (() => { const h = fistHand(); [8, 12, 16, 20].forEach((t, i) => { h[t] = P(0.50 + i * 0.03, 0.71); }); return h; })(),
};

/* ---------------- 测试框架 ---------------- */
let pass = 0, fail = 0;
function check(label, actual, expect) {
  const ok = actual === expect;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} ${label.padEnd(26)} 得到 ${String(actual).padEnd(8)} 期望 ${expect}`);
}

const gc = new GestureController({ video: null, canvas: null });
gc.SMOOTH = 1;                       // 关闭平滑，直接用原始输入
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

console.log('\n── 张开手掌（此前被误判为 four）──');
for (const [name, lm] of Object.entries(variants)) {
  check(name, analyze(lm).name, 'open');
}

console.log('\n── 其他手势不串味 ──');
check('数字4(拇指折向掌心)', analyze(fourHand()).name, 'four');
check('伸食指', analyze(pointHand()).name, 'point');
check('捏合', analyze(pinchHand(0.06)).name, 'pinch');
check('握拳', analyze(fistHand()).name, 'fist');
console.log('\n── 握拳（此前被误判为 pinch）──');
for (const [name, lm] of Object.entries(fistVariants)) {
  check(name, analyze(lm).name, 'fist');
}
console.log('');
check('比耶', analyze(peaceHand()).name, 'peace');
check('三指', analyze(threeHand()).name, 'three');
check('张开但小指没收好', analyze(openPinkyShort()).name, 'open');

console.log('\n── 捏合滞后 ──');
check('首次半张开', analyze(pinchHand(0.5)).name, 'none');
analyze(pinchHand(0.06));
gc._prevNames = ['pinch'];
check('已捏合时半张开', analyze(pinchHand(0.5)).name, 'pinch');

console.log('\n── 缩放方向与生效 ──');
radius = 48;
let h1 = analyze(pinchHand(0.06));
gc._dispatch([h1]); gc._dispatch([h1]);
const r0 = radius;
for (let i = 1; i <= 8; i++) gc._dispatch([analyze(pinchHand(0.06 + i * 0.05))]);
check('单手张开=放大', radius < r0 ? '放大' : '缩小', '放大');

radius = 48;
const mk = (cx) => { const h = analyze(pinchHand(0.06)); h.cx = cx; h.cy = 0.5; return h; };
let a = mk(0.35), b = mk(0.55);
gc._dispatch([a, b]); gc._dispatch([a, b]);
const rTwo = radius;
a = mk(0.20); b = mk(0.80);
for (let i = 0; i < 12; i++) gc._dispatch([a, b]);
check('双手拉开=放大', radius < rTwo ? '放大' : '无变化', '放大');
a = mk(0.42); b = mk(0.48);
for (let i = 0; i < 12; i++) gc._dispatch([a, b]);
check('双手靠拢=缩小', radius > rTwo ? '缩小' : '无变化', '缩小');

fired.length = 0;
gc._fired = 'pinch';
gc._pinchReleaseAt = performance.now();
const hp = analyze(pointHand());
for (let i = 0; i < 10; i++) gc._dispatch([hp]);
check('松手冷却无误触', fired.length, 0);

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
