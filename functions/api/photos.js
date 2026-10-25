/* ============================================================
 *  /api/photos
 *    GET  -> 照片列表（D1 元数据）
 *    POST -> 上传照片（二进制写入 KV，元信息写入 D1）
 * ============================================================ */

import {
  ok, fail, handleOptions, checkEnv, parseDataUrl,
  MAX_BYTES, PHOTO_COLS, checkPassword, passwordFrom,
} from '../_lib.js';

export async function onRequestOptions() { return handleOptions(); }

/* ------------------------- 列表 ------------------------- */
export async function onRequestGet({ env }) {
  const bad = checkEnv(env);
  if (bad) return fail(bad, 500);

  try {
    const { results } = await env.DB.prepare(
      `SELECT ${PHOTO_COLS} FROM photos ORDER BY created_at DESC LIMIT 800`
    ).all();
    /* 顺带告诉前端：是否启用了上传密码锁 */
    const pw = await checkPassword(env, '');
    return ok({ photos: results || [], locked: pw.enabled });
  } catch (e) {
    return fail('读取失败：' + (e && e.message ? e.message : e), 500);
  }
}

/* ------------------------- 上传 ------------------------- */
export async function onRequestPost({ request, env }) {
  const bad = checkEnv(env);
  if (bad) return fail(bad, 500);

  /* 密码锁：启用后必须校验通过才能上传 */
  const pw = await checkPassword(env, passwordFrom(request));
  if (!pw.ok) return fail('上传密码不正确', 401);

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return fail('请求体必须是 JSON');
  }

  const { id, name, data, width, height } = payload || {};
  if (!id || !/^[A-Za-z0-9_-]{4,64}$/.test(String(id))) return fail('非法 id');
  if (!data || typeof data !== 'string') return fail('缺少图片数据');

  const parsed = parseDataUrl(data);
  if (!parsed) return fail('图片格式错误（需 image/* 的 data URL）');
  if (parsed.bytes.byteLength > MAX_BYTES) {
    return fail(`单张照片不能超过 ${MAX_BYTES / 1024 / 1024}MB（当前 ${(parsed.bytes.byteLength / 1024 / 1024).toFixed(1)}MB）`);
  }

  const createdAt = Date.now();

  try {
    // 1) 二进制写入 KV（键带前缀，便于管理）
    await env.PHOTOS_KV.put(`photo:${id}`, parsed.bytes, {
      metadata: { type: parsed.type, createdAt },
    });

    // 2) 元信息写入 D1
    await env.DB.prepare(
      `INSERT INTO photos (id, name, kv_key, width, height, size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        String(id),
        String(name || '未命名').slice(0, 60),
        `photo:${id}`,
        Number(width) || 0,
        Number(height) || 0,
        parsed.bytes.byteLength,
        createdAt
      )
      .run();

    return ok({
      photo: {
        id: String(id),
        name: String(name || '未命名').slice(0, 60),
        width: Number(width) || 0,
        height: Number(height) || 0,
        size: parsed.bytes.byteLength,
        created_at: createdAt,
      },
    });
  } catch (e) {
    return fail('保存失败：' + (e && e.message ? e.message : e), 500);
  }
}
