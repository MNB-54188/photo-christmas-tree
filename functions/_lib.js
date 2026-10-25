/* ============================================================
 *  Pages Functions 公共工具（下划线开头，不会暴露为路由）
 * ============================================================ */

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...headers },
  });
}

export function ok(data, status = 200) { return json({ ok: true, ...data }, status); }
export function fail(msg, status = 400) { return json({ ok: false, error: msg }, status); }

export async function handleOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

/** 绑定缺失时给出清晰提示（前端收到后会降级为本地存储） */
export function checkEnv(env) {
  if (!env.DB) return 'D1 数据库未绑定：请在 Cloudflare Pages 项目设置中绑定 DB';
  if (!env.PHOTOS_KV) return 'KV 命名空间未绑定：请在 Cloudflare Pages 项目设置中绑定 PHOTOS_KV';
  return null;
}

/** data URL -> { type, bytes } */
export function parseDataUrl(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl || '');
  if (!m) return null;
  const type = m[1] || 'image/jpeg';
  if (!type.startsWith('image/')) return null;
  const body = m[3] || '';
  if (!m[2]) {
    // 非 base64（极少见），直接按 UTF-8 处理
    return { type, bytes: new TextEncoder().encode(decodeURIComponent(body)) };
  }
  const bin = atob(body);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return { type, bytes };
}

export const MAX_BYTES = 8 * 1024 * 1024;   // 单张上限 8MB

export const PHOTO_COLS = 'id, name, width, height, size, created_at';

/* ------------------------------------------------------------------ */
/*  上传密码锁                                                          */
/*  开启方式（任选其一）：                                              */
/*   1) Cloudflare Pages 环境变量（推荐，不用改代码、不用重新部署）       */
/*        UPLOAD_PASSWORD        = 明文密码                             */
/*        UPLOAD_PASSWORD_SHA256 = 密码的 SHA-256                       */
/*   2) 把哈希填进下面的 BUILTIN_PASSWORD_SHA256                        */
/*        （同时填 public/js/api.js 的 BUILTIN_HASH，本地模式才同步）     */
/*  都不填 → 不启用密码锁（任何人都能上传）                              */
/* ------------------------------------------------------------------ */

/** 占位符：改成你自己密码的 SHA-256 才会启用内置密码 */
export const BUILTIN_PASSWORD_SHA256 = '';

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** @returns {{ok:boolean, enabled:boolean}} */
export async function checkPassword(env, password) {
  const plain = env.UPLOAD_PASSWORD;
  const hash = env.UPLOAD_PASSWORD_SHA256 || BUILTIN_PASSWORD_SHA256;
  if (!plain && !hash) return { ok: true, enabled: false };   // 都没配 → 不锁
  if (!password) return { ok: false, enabled: true };

  if (plain && password === plain) return { ok: true, enabled: true };
  if (hash && (await sha256Hex(password)) === String(hash).toLowerCase()) {
    return { ok: true, enabled: true };
  }
  return { ok: false, enabled: true };
}

/** 从请求头里取密码（前端用 X-Upload-Password 传） */
export function passwordFrom(request) {
  return request.headers.get('X-Upload-Password') || '';
}
