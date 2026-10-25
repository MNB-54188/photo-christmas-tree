/* ============================================================
 *  /api/raw/:id  ->  从 KV 返回图片二进制（带长缓存）
 * ============================================================ */

import { handleOptions, checkEnv } from '../../_lib.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestGet({ params, env, request }) {
  const bad = checkEnv(env);
  if (bad) return new Response(bad, { status: 500 });

  const id = String(params.id || '');
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) return new Response('bad id', { status: 400 });

  const { value, metadata } = await env.PHOTOS_KV.getWithMetadata(`photo:${id}`, 'arrayBuffer');

  if (!value) {
    // KV 没有就去 D1 查一下，有记录但 KV 丢失时给出明确提示
    return new Response('not found', { status: 404 });
  }

  const type = (metadata && metadata.type) || 'image/jpeg';
  const etag = `"${id}"`;
  if (request.headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  return new Response(value, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: etag,
      'Access-Control-Allow-Origin': '*',
    },
  });
}
