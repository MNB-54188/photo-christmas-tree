/* ============================================================
 *  /api/unlock
 *    POST { password } -> 校验上传密码（用于弹窗即时反馈，避免选完
 *                         一堆照片才发现密码错）
 *    GET               -> 查询是否启用了密码锁
 * ============================================================ */

import { ok, fail, handleOptions, checkEnv, checkPassword } from '../_lib.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestGet({ env }) {
  const pw = await checkPassword(env, '');
  return ok({ locked: pw.enabled });
}

export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch (e) { /* 允许空 body */ }
  const pw = await checkPassword(env, body.password || '');
  if (!pw.enabled) return ok({ locked: false, unlocked: true });
  if (!pw.ok) return fail('上传密码不正确', 401);
  return ok({ locked: true, unlocked: true });
}
