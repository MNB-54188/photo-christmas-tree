/* ============================================================
 *  api.js —— 照片存储层
 *    云端模式：Cloudflare Pages Functions + D1(元数据) + KV(图片二进制)
 *    本地模式：IndexedDB（未部署 / 接口不可用 / 纯静态托管时自动降级）
 * ============================================================ */

const DB_NAME = 'photo-christmas-tree';
const STORE = 'photos';
const MAX_SIDE = 1400;      // 上传前最长边
const QUALITY = 0.82;       // JPEG 质量

/* ---------------- IndexedDB 极简封装 ---------------- */

let _dbPromise = null;
function idb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

async function idbAll() {
  const db = await idb();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}
async function idbPut(rec) {
  const db = await idb();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE, 'readwrite').objectStore(STORE).put(rec);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}
async function idbDel(id) {
  const db = await idb();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

/* ---------------- 图片压缩 ---------------- */

export async function fileToDataURL(file, maxSide = MAX_SIDE, quality = QUALITY) {
  const bmp = await loadBitmap(file);
  const { width, height } = bmp;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();

  return { dataUrl: c.toDataURL('image/jpeg', quality), width: w, height: h };
}

async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) { /* 回退 */ }
  }
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('图片读取失败')); };
    img.src = url;
  });
}

/* ---------------- 内置示例照片 ---------------- */

const SAMPLES = [
  { id: 'sample-01', name: '圣诞夜 · 01' },
  { id: 'sample-02', name: '圣诞夜 · 02' },
  { id: 'sample-03', name: '圣诞夜 · 03' },
  { id: 'sample-04', name: '圣诞夜 · 04' },
  { id: 'sample-05', name: '圣诞夜 · 05' },
  { id: 'sample-06', name: '圣诞夜 · 06' },
  { id: 'sample-07', name: '圣诞夜 · 07' },
  { id: 'sample-08', name: '圣诞夜 · 08' },
  { id: 'sample-09', name: '圣诞夜 · 09' },
  { id: 'sample-10', name: '圣诞夜 · 10' },
  { id: 'sample-11', name: '圣诞夜 · 11' },
  { id: 'sample-12', name: '圣诞夜 · 12' },
];

export function samplePhotos() {
  return SAMPLES.map((s, i) => ({
    ...s,
    url: `/assets/samples/${String(i + 1).padStart(2, '0')}.png`,
    sample: true,
    createdAt: 0,
  }));
}

/* ---------------- 存储门面 ---------------- */

/* ---------------- 上传密码锁 ---------------- */

const SESSION_KEY = 'pt-upload-pw';      // 会话内记住（关闭标签页即失效）
const LOCAL_HASH_KEY = 'pt-upload-pw-hash'; // 本地模式的密码哈希

/**
 * 内置密码的 SHA-256：与 functions/_lib.js 的 BUILTIN_PASSWORD_SHA256 必须一致。
 * 作用：纯静态打开（没有后端接口）时，本地模式也用同一个密码加锁，
 *      做到「本地和 Cloudflare 同一个密码」。
 * 默认为空占位符：此时本地模式会在首次上传时让你自己设一个密码（存本机 localStorage）。
 * 想固定密码：把这里和 functions/_lib.js 一起改成同一个哈希，
 *            或只在 Cloudflare 后台配 UPLOAD_PASSWORD（云端优先用环境变量）。
 */
const BUILTIN_HASH = '';

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const lock = {
  /** 云端：由后端 /api/photos 返回的 locked 决定；本地：是否设过密码 */
  enabled: false,
  /** 本次会话是否已解锁（明文密码只存 sessionStorage） */
  _pw: sessionStorage.getItem(SESSION_KEY) || '',

  get password() { return this._pw; },
  get unlocked() {
    if (!this.enabled) return true;
    if (this.mode === 'cloud') return !!this._pw;
    return !!this._pw && this._localOk;
  },
  _localOk: false,
  mode: 'local',

  remember(pw) { this._pw = pw; this._localOk = true; sessionStorage.setItem(SESSION_KEY, pw); },
  forget() { this._pw = ''; this._localOk = false; sessionStorage.removeItem(SESSION_KEY); },

  hasLocalPassword() { return !!localStorage.getItem(LOCAL_HASH_KEY) || !!BUILTIN_HASH; },
  async setLocalPassword(pw) {
    const h = await sha256Hex(pw);
    localStorage.setItem(LOCAL_HASH_KEY, h);
    this.enabled = true;
    this.remember(pw);
  },
  async checkLocal(pw) {
    const h = localStorage.getItem(LOCAL_HASH_KEY) || BUILTIN_HASH;
    if (!h) return true;                      // 没有任何密码 → 不锁
    return (await sha256Hex(pw)) === h;
  },

  /** 云端：询问后端该密码是否正确 */
  async checkCloud(pw) {
    try {
      const r = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Upload-Password': pw },
        body: JSON.stringify({ password: pw }),
      });
      const j = await r.json().catch(() => ({}));
      return { ok: r.ok && j.ok === true, locked: !!j.locked };
    } catch (e) {
      return { ok: false, locked: true, error: e.message };
    }
  },
};

export const store = {
  mode: 'local',          // 'cloud' | 'local'
  photos: [],             // [{ id, name, url, createdAt, sample? }]
  locked: false,          // 云端是否启用了上传密码锁

  async init() {
    this.mode = 'local';
    try {
      const r = await fetch('/api/photos', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const ct = (r.headers.get('content-type') || '');
      if (r.ok && ct.includes('application/json')) {
        const j = await r.json();
        if (j && j.ok === true && Array.isArray(j.photos)) {
          this.mode = 'cloud';
          this.locked = !!j.locked;
        }
      }
    } catch (e) { /* 保持本地模式 */ }

    lock.mode = this.mode;
    lock.enabled = this.mode === 'cloud' ? this.locked : lock.hasLocalPassword();
    if (lock._pw) lock._localOk = true;   // 同一会话内已验证过，无需重输
    await this.refresh();
    return this.mode;
  },

  async refresh() {
    let list = [];
    if (this.mode === 'cloud') {
      try {
        const r = await fetch('/api/photos', { cache: 'no-store' });
        const j = await r.json();
        if (j && j.ok) list = j.photos;
        else throw new Error(j && j.error ? j.error : 'list failed');
      } catch (e) {
        this.mode = 'local';
        list = await idbAll();
      }
    } else {
      list = await idbAll().catch(() => []);
    }

    this.photos = list
      .map((p) => ({
        id: p.id,
        name: p.name || '未命名',
        url: this.mode === 'cloud' ? `/api/raw/${p.id}` : p.data,
        createdAt: p.created_at || p.createdAt || 0,
        sample: false,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);

    if (!this.photos.length) this.photos = samplePhotos();
    return this.photos;
  },

  async add(file) {
    const { dataUrl, width, height } = await fileToDataURL(file);
    const id = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const name = (file.name || '照片').replace(/\.[^.]+$/, '').slice(0, 40);
    const createdAt = Date.now();

    if (this.mode === 'cloud') {
      const r = await fetch('/api/photos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Upload-Password': lock.password || '',
        },
        body: JSON.stringify({ id, name, data: dataUrl, width, height }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) { lock.forget(); throw new Error('UPLOAD_LOCKED'); }
      if (!r.ok || !j.ok) throw new Error(j.error || `上传失败 (${r.status})`);
    } else {
      await idbPut({ id, name, data: dataUrl, width, height, createdAt });
    }
    return { id, name, width, height, createdAt };
  },

  async remove(id) {
    if (!id || String(id).startsWith('sample-')) return;
    if (this.mode === 'cloud') {
      const r = await fetch(`/api/photos/${id}`, {
        method: 'DELETE',
        headers: { 'X-Upload-Password': lock.password || '' },
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) { lock.forget(); throw new Error('DELETE_LOCKED'); }
      if (!r.ok || !j.ok) throw new Error(j.error || `删除失败 (${r.status})`);
    } else {
      await idbDel(id);
    }
  },

  isSample(id) { return String(id).startsWith('sample-'); },
};
