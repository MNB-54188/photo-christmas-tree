/* ============================================================
 *  /api/photos/:id
 *    DELETE -> 删除照片（同时清理 KV 与 D1）
 * ============================================================ */

import { ok, fail, handleOptions, checkEnv } from '../../_lib.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestDelete({ params, env }) {
  const bad = checkEnv(env);
  if (bad) return fail(bad, 500);

  const id = String(params.id || '');
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) return fail('非法 id');

  try {
    const row = await env.DB.prepare('SELECT kv_key FROM photos WHERE id = ?').bind(id).first();
    if (row && row.kv_key) {
      await env.PHOTOS_KV.delete(row.kv_key);
    }
    await env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(id).run();
    return ok({ id });
  } catch (e) {
    return fail('删除失败：' + (e && e.message ? e.message : e), 500);
  }
}
