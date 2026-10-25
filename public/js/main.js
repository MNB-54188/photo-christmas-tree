/* ============================================================
 *  main.js —— 图片圣诞树 · 手势相册 主控
 * ============================================================ */

import { PhotoTree, SHAPES, SHAPE_NAMES } from './tree.js';
import { GestureController } from './gestures.js';
import { store, lock } from './api.js';

const $ = (id) => document.getElementById(id);

const el = {
  canvas: $('scene'),
  loader: $('loader'),
  loaderFill: $('loader-fill'),
  loaderTip: $('loader-tip'),
  stat: $('stat'),
  sub: $('brand-sub'),

  file: $('file-input'),
  file2: $('file-input-2'),

  btnGesture: $('btn-gesture'),
  btnRotate: $('btn-rotate'),
  btnSnow: $('btn-snow'),
  btnBloom: $('btn-bloom'),
  btnMusic: $('btn-music'),
  btnHelp: $('btn-help'),
  btnManage: $('btn-manage'),
  btnFull: $('btn-full'),

  cam: $('cam'),
  camVideo: $('cam-video'),
  camCanvas: $('cam-canvas'),
  camClose: $('cam-close'),
  gestureName: $('gesture-name'),
  gbarRot: $('gbar-rot'),
  gbarZoom: $('gbar-zoom'),
  camDebug: $('cam-debug'),

  panel: $('panel'),
  panelBody: $('panel-body'),
  panelClose: $('panel-close'),
  panelCount: $('panel-count'),
  storageNote: $('storage-note'),

  lightbox: $('lightbox'),
  lbImg: $('lb-img'),
  lbName: $('lb-name'),
  lbClose: $('lb-close'),
  lbPrev: $('lb-prev'),
  lbNext: $('lb-next'),

  help: $('help'),
  helpClose: $('help-close'),
  toast: $('toast'),

  lock: $('lock'),
  lockCard: document.querySelector('.lock-card'),
  lockTitle: $('lock-title'),
  lockSub: $('lock-sub'),
  lockInput: $('lock-input'),
  lockInput2: $('lock-input2'),
  lockErr: $('lock-err'),
  lockOk: $('lock-ok'),
  lockClose: $('lock-close'),
  lockTip: $('lock-tip'),
};

/* ---------------- 偏好持久化 ---------------- */
const DEBUG = /[?&]debug=1/.test(location.search);
const PREF_KEY = 'pt-prefs';
const prefs = Object.assign(
  { shape: 'tree', autoRotate: true, snow: true, bloom: true, music: false },
  JSON.parse(localStorage.getItem(PREF_KEY) || '{}')
);
const savePrefs = () => localStorage.setItem(PREF_KEY, JSON.stringify(prefs));

/* ---------------- Toast ---------------- */
let toastTimer = null;
function toast(msg, ms = 2400) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms);
}

/* ---------------- 3D 场景 ---------------- */
let tree;
try {
  tree = new PhotoTree(el.canvas);
} catch (e) {
  el.loader.innerHTML =
    '<div class="loader-inner"><p class="loader-title">无法启动 3D 渲染</p>' +
    '<p class="loader-tip">请使用支持 WebGL 的现代浏览器（Chrome / Edge / Safari）打开</p></div>';
  throw e;
}

/* ---------------- 音乐（WebAudio 合成，无需外链音频） ---------------- */
const NOTES = {
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, B5: 987.77, C6: 1046.5,
};
const MELODY = [
  ['E5', 1], ['E5', 1], ['E5', 2], ['E5', 1], ['E5', 1], ['E5', 2],
  ['E5', 1], ['G5', 1], ['C5', 1.5], ['D5', 0.5], ['E5', 4],
  ['F5', 1], ['F5', 1], ['F5', 1], ['F5', 1], ['F5', 1], ['E5', 1], ['E5', 1],
  ['E5', 0.5], ['E5', 0.5], ['E5', 1], ['D5', 1], ['D5', 1], ['E5', 1], ['D5', 2], ['G5', 2],
  ['E5', 1], ['E5', 1], ['E5', 2], ['E5', 1], ['E5', 1], ['E5', 2],
  ['E5', 1], ['G5', 1], ['C5', 1.5], ['D5', 0.5], ['E5', 4],
  ['F5', 1], ['F5', 1], ['F5', 1], ['F5', 1], ['F5', 1], ['E5', 1], ['E5', 1],
  ['E5', 0.5], ['E5', 0.5], ['G5', 1], ['G5', 1], ['F5', 1], ['D5', 1], ['C5', 4],
];

const music = {
  ctx: null, timer: null, i: 0, on: false,
  _note(freq, dur, when) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 2600;
    o.type = 'triangle';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.14, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(f); f.connect(g); g.connect(this.ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },
  _beat(beats) { /* 每个 beat 260ms */ },
  play() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.on = true;
    let delay = 0;
    const schedule = () => {
      if (!this.on) return;
      const [n, b] = MELODY[this.i % MELODY.length];
      const dur = b * 0.26;
      this._note(NOTES[n] || 440, dur, 0);
      this.i++;
      this.timer = setTimeout(schedule, dur * 1000);
    };
    schedule();
  },
  stop() { this.on = false; clearTimeout(this.timer); this.timer = null; },
  toggle() { if (this.on) { this.stop(); return false; } this.play(); return true; },
};

/* ---------------- 加载 ---------------- */
let loadToken = 0;

function setProgress(p, tip) {
  el.loaderFill.style.width = Math.round(Math.min(1, Math.max(0, p)) * 100) + '%';
  if (tip) el.loaderTip.textContent = tip;
}

async function reloadPhotos() {
  const token = ++loadToken;
  const photos = await store.refresh();
  if (token !== loadToken) return;

  if (!photos.length) {
    setProgress(1, '还没有照片，先添加几张吧');
  }
  await tree.setPhotos(photos, (d, t) => setProgress(0.12 + 0.88 * (d / Math.max(t, 1)), `加载照片 ${d}/${t}`));
  if (token !== loadToken) return;

  renderPanel();
  updateStat();
  setTimeout(() => el.loader.classList.add('done'), 320);
}

function updateStat() {
  const n = store.photos.filter((p) => !p.sample).length;
  el.stat.textContent = `${n || store.photos.length} 张照片`;
  el.sub.textContent = store.mode === 'cloud' ? 'Cloudflare D1 + KV · 多设备同步' : '本地存储模式';
}

/* ---------------- 上传密码锁 ---------------- */

let pendingFiles = null;   // 等待解锁后才处理的文件

/** 弹出密码框。@param {boolean} setup 本地模式首次设置密码 */
function askPassword(setup = false) {
  el.lockTitle.textContent = setup ? '设置上传密码' : '请输入上传密码';
  el.lockSub.textContent = setup
    ? '本地模式下先设一个密码，之后上传都需要它'
    : (store.mode === 'cloud' ? '云端相册已启用上传保护' : '请输入本机上传密码');
  el.lockInput2.classList.toggle('hidden', !setup);
  el.lockInput.value = '';
  el.lockInput2.value = '';
  el.lockErr.textContent = '';
  el.lockTip.textContent = setup
    ? '密码保存在本机浏览器，忘记可在控制台执行 localStorage.removeItem("pt-upload-pw-hash") 重置'
    : '密码只在本次会话内记住，关闭标签页后需重新输入';
  el.lock.classList.remove('hidden');
  setTimeout(() => el.lockInput.focus(), 60);
}

function shakeLock(msg) {
  el.lockErr.textContent = msg;
  el.lockCard.classList.remove('shake');
  void el.lockCard.offsetWidth;
  el.lockCard.classList.add('shake');
}

async function submitPassword() {
  const pw = el.lockInput.value;
  if (!pw) return shakeLock('请输入密码');

  if (lock.mode === 'local' && !lock.hasLocalPassword()) {
    /* 本地模式首次使用：设置密码 */
    if (pw !== el.lockInput2.value) return shakeLock('两次输入的密码不一致');
    await lock.setLocalPassword(pw);
    el.lock.classList.add('hidden');
    toast('上传密码已设置 🔒');
    if (pendingFiles) { const f = pendingFiles; pendingFiles = null; handleFiles(f); }
    return;
  }

  if (lock.mode === 'cloud') {
    const r = await lock.checkCloud(pw);
    if (!r.ok) return shakeLock(r.error || '密码不正确，请重试');
    lock.enabled = true;
    lock.remember(pw);
  } else {
    const okPw = await lock.checkLocal(pw);
    if (!okPw) return shakeLock('密码不正确，请重试');
    lock.remember(pw);
  }

  el.lock.classList.add('hidden');
  if (pendingFiles) { const f = pendingFiles; pendingFiles = null; handleFiles(f); }
}

el.lockOk.addEventListener('click', submitPassword);
el.lockInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPassword(); });
el.lockInput2.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPassword(); });
el.lockClose.addEventListener('click', () => { el.lock.classList.add('hidden'); pendingFiles = null; });
el.lock.addEventListener('click', (e) => {
  if (e.target === el.lock) { el.lock.classList.add('hidden'); pendingFiles = null; }
});

/* ---------------- 上传 ---------------- */

/** 需要密码时先弹框，解锁后再真正处理 */
function requestUpload(fileList) {
  if (lock.unlocked) return handleFiles(fileList);
  pendingFiles = fileList;
  askPassword(lock.mode === 'local' && !lock.hasLocalPassword());
}

async function handleFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return toast('请选择图片文件');
  if (store.mode === 'local' && store.photos.some((p) => p.sample)) {
    store.photos = [];   // 清掉示例
  }
  toast(`正在处理 ${files.length} 张照片…`, 8000);
  let ok = 0, fail = 0;
  for (const f of files) {
    try { await store.add(f); ok++; }
    catch (e) {
      if (e.message === 'UPLOAD_LOCKED') {   // 服务端判定密码失效 → 重新验证
        lock.forget();
        pendingFiles = files.slice(files.indexOf(f));
        toast('上传密码已失效，请重新输入', 3200);
        askPassword();
        return;
      }
      fail++; toast('上传失败：' + (e.message || e), 3000);
    }
  }
  await reloadPhotos();
  toast(fail ? `完成 ${ok} 张，失败 ${fail} 张` : `已添加 ${ok} 张照片 ✨`);
}

/* 注意：必须先拷贝成数组，再清空 input.value —— 否则 FileList 会被一起清空 */
function onPickFiles(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (files.length) requestUpload(files);
}
el.file.addEventListener('change', onPickFiles);
el.file2.addEventListener('change', onPickFiles);

/* ---------------- 相册面板 ---------------- */
function renderPanel() {
  const list = store.photos;
  el.panelCount.textContent = list.filter((p) => !p.sample).length;
  el.storageNote.innerHTML = store.mode === 'cloud'
    ? '☁️ 已连接 Cloudflare：图片存 <b>KV</b>，信息存 <b>D1</b>'
    : '💾 当前为浏览器本地存储（未部署到 Cloudflare）';

  if (!list.length) {
    el.panelBody.innerHTML = '<p class="panel-empty">还没有照片<br />点击下方按钮添加</p>';
    return;
  }
  el.panelBody.innerHTML = list.map((p) => `
    <div class="thumb" data-id="${p.id}">
      <img src="${p.url}" alt="${escapeHtml(p.name)}" loading="lazy" />
      ${p.sample ? '' : '<button data-del="' + p.id + '" title="删除">×</button>'}
    </div>`).join('');

  el.panelBody.querySelectorAll('[data-del]').forEach((b) => {
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const id = b.getAttribute('data-del');
      try {
        await store.remove(id);
        store.photos = store.photos.filter((p) => p.id !== id);
        if (!store.photos.length) store.photos = (await store.refresh());
        await reloadPhotos();
        toast('已删除');
      } catch (e) { toast('删除失败：' + e.message); }
    });
  });
  el.panelBody.querySelectorAll('.thumb').forEach((t) => {
    t.addEventListener('click', () => {
      const i = store.photos.findIndex((p) => p.id === t.dataset.id);
      if (i >= 0) openLightbox(i);
    });
  });
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- 灯箱 ---------------- */
let lbIndex = -1;
function openLightbox(i) {
  if (!store.photos.length) return;
  lbIndex = (i + store.photos.length) % store.photos.length;
  const p = store.photos[lbIndex];
  el.lbImg.src = p.url;
  el.lbName.textContent = `${p.name}　·　${lbIndex + 1} / ${store.photos.length}`;
  el.lightbox.classList.remove('hidden');
}
function closeLightbox() { el.lightbox.classList.add('hidden'); }
function isLightboxOpen() { return !el.lightbox.classList.contains('hidden'); }
el.lbClose.addEventListener('click', closeLightbox);
el.lbPrev.addEventListener('click', (e) => { e.stopPropagation(); openLightbox(lbIndex - 1); });
el.lbNext.addEventListener('click', (e) => { e.stopPropagation(); openLightbox(lbIndex + 1); });
el.lightbox.addEventListener('click', (e) => { if (e.target === el.lightbox) closeLightbox(); });
tree.onPhotoClick = openLightbox;

/* ---------------- 造型切换 ---------------- */
function setShape(shape) {
  if (!SHAPES.includes(shape)) return;
  prefs.shape = shape; savePrefs();
  tree.setShape(shape);
  document.querySelectorAll('#shape-row .chip').forEach((c) => {
    c.classList.toggle('active', c.dataset.shape === shape);
  });
  toast(SHAPE_NAMES[shape] || shape, 1200);
}
document.querySelectorAll('#shape-row .chip').forEach((c) => {
  c.addEventListener('click', () => setShape(c.dataset.shape));
});

/* ---------------- 开关按钮 ---------------- */
function bindToggle(btn, get, set, onChange) {
  const apply = (v) => { btn.classList.toggle('on', v); set(v); onChange && onChange(v); };
  btn.addEventListener('click', () => apply(!get()));
  return apply;
}

const applyRotate = bindToggle(el.btnRotate, () => prefs.autoRotate, (v) => {
  prefs.autoRotate = v; savePrefs(); tree.setAutoRotate(v);
});
const applySnow = bindToggle(el.btnSnow, () => prefs.snow, (v) => {
  prefs.snow = v; savePrefs(); tree.setSnow(v);
});
const applyBloom = bindToggle(el.btnBloom, () => prefs.bloom, (v) => {
  prefs.bloom = v; savePrefs(); tree.setBloom(v);
});
const applyMusic = bindToggle(el.btnMusic, () => prefs.music, (v) => {
  prefs.music = v; savePrefs();
  v ? music.play() : music.stop();
});

/* ---------------- 浮层 ---------------- */
el.btnHelp.addEventListener('click', () => el.help.classList.remove('hidden'));
el.helpClose.addEventListener('click', () => el.help.classList.add('hidden'));
el.help.addEventListener('click', (e) => { if (e.target === el.help) el.help.classList.add('hidden'); });

el.btnManage.addEventListener('click', () => {
  renderPanel();
  el.panel.classList.toggle('hidden');
});
el.panelClose.addEventListener('click', () => el.panel.classList.add('hidden'));

el.btnFull.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => toast('当前环境不支持全屏'));
});

/* ---------------- 手势 ---------------- */
const gc = new GestureController({ video: el.camVideo, canvas: el.camCanvas });
let gestureOn = false;

gc.getRadius = () => tree.orbit.radius;
gc.setRadius = (r) => tree.setRadius(r);
gc.minR = tree.orbit.minR;
gc.maxR = tree.orbit.maxR;
gc.onPointer = (nx, ny, w) => tree.setRotationFromPointer(nx, ny, w);
gc.onStatus = (t) => { el.gestureName.textContent = t; };
gc.onDebug = (t) => { el.camDebug.textContent = t; };
gc.onReady = () => { toast('手势识别已就绪 🖐️', 1800); };
gc.onError = (e) => {
  toast(e.message, 4200);
  gestureOn = false;
  el.btnGesture.classList.remove('on');
  el.cam.classList.add('hidden');
};
gc.onGesture = (name) => {
  switch (name) {
    case 'peace':     // ✌️ 下一张照片（没打开时先打开正中的那张）
      if (isLightboxOpen()) openLightbox(lbIndex + 1);
      else openLightbox(Math.max(0, tree.getCenterIndex()));
      break;
    case 'point':     // ☝️ 关闭照片：只在放大界面生效，避免日常误触
      if (isLightboxOpen()) closeLightbox();
      break;
    case 'three': {   // 🤟 上一个造型
      const i = SHAPES.indexOf(tree.shape);
      setShape(SHAPES[(i - 1 + SHAPES.length) % SHAPES.length]);
      break;
    }
    case 'four': {    // 🖖 下一个造型
      const i = SHAPES.indexOf(tree.shape);
      setShape(SHAPES[(i + 1) % SHAPES.length]);
      break;
    }
    case 'fist':      // ✊ 收回圣诞树
      setShape('tree');
      break;
    default: break;
  }
};

el.btnGesture.addEventListener('click', async () => {
  if (gestureOn) {
    gc.stop();
    gestureOn = false;
    el.btnGesture.classList.remove('on');
    el.cam.classList.add('hidden');
    toast('已关闭手势控制');
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return toast('当前浏览器/环境不支持摄像头（需 HTTPS 或 localhost）');
  }
  if (location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname)) {
    return toast('摄像头需要 HTTPS 环境，当前为 ' + location.protocol);
  }
  el.cam.classList.remove('hidden');
  if (DEBUG) el.camDebug.classList.add('show');
  el.gestureName.textContent = '正在启动…';
  const ok = await gc.start();
  if (ok) { gestureOn = true; el.btnGesture.classList.add('on'); }
  else { el.cam.classList.add('hidden'); }
});

el.camClose.addEventListener('click', () => {
  gc.stop();
  gestureOn = false;
  el.btnGesture.classList.remove('on');
  el.cam.classList.add('hidden');
});

/* ---------------- 键盘 ---------------- */
window.addEventListener('keydown', (e) => {
  if (e.target && /input|textarea/i.test(e.target.tagName)) return;
  if (e.key >= '1' && e.key <= '6') return setShape(SHAPES[+e.key - 1]);
  switch (e.key.toLowerCase()) {
    case ' ': e.preventDefault(); applyRotate(!prefs.autoRotate); break;
    case 'g': el.btnGesture.click(); break;
    case 'h': el.btnHelp.click(); break;
    case 'm': el.btnManage.click(); break;
    case 'escape': closeLightbox(); el.help.classList.add('hidden'); el.panel.classList.add('hidden'); break;
    case 'arrowleft': if (isLightboxOpen()) openLightbox(lbIndex - 1); break;
    case 'arrowright': if (isLightboxOpen()) openLightbox(lbIndex + 1); break;
    default: break;
  }
});

/* ---------------- 渲染循环 ---------------- */
/* ?static=1：测试 / 低性能模式下不做持续渲染，仅单帧 */
const STATIC_MODE = /[?&]static=1/.test(location.search);
let hudTick = 0;
function animate() {
  requestAnimationFrame(animate);
  tree.update();
  tree.render();
  if (gestureOn && ++hudTick % 4 === 0) {
    const o = tree.orbit;
    const th = ((o.theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    el.gbarRot.style.width = (th / (Math.PI * 2)) * 100 + '%';
    el.gbarZoom.style.width =
      ((o.maxR - o.radius) / (o.maxR - o.minR)) * 100 + '%';
  }
  void hudTick;
}

/* ---------------- 启动 ---------------- */
(async function boot() {
  setProgress(0.08, '正在连接存储…');
  const mode = await store.init();
  setProgress(0.12, mode === 'cloud' ? '已连接 Cloudflare' : '使用本地存储');

  applyRotate(prefs.autoRotate);
  applySnow(prefs.snow);
  applyBloom(prefs.bloom);
  if (prefs.music) { try { music.play(); } catch (e) { prefs.music = false; } }
  document.querySelectorAll('#shape-row .chip').forEach((c) => {
    c.classList.toggle('active', c.dataset.shape === prefs.shape);
  });
  tree.shape = prefs.shape;

  if (STATIC_MODE) { tree.update(); tree.render(); } else { animate(); }
  await reloadPhotos();

  /* 调试句柄（控制台可用 __PT 查看） */
  window.__PT = { tree, store, setShape, reloadPhotos, gestures: gc, version: '1.0.0' };

  if (mode === 'local' && location.protocol === 'file:') {
    setTimeout(() => toast('提示：本地直接打开时照片仅存于此浏览器', 4200), 1200);
  }
})();
