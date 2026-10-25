/* ============================================================
 *  gh_push_exact.mjs —— 用「与本地提交完全相同的 tree / 作者 / 时间」
 *  通过 GitHub Git Data API 重建提交，使远端 sha 与本地 sha 完全一致。
 *  用法：node tools/gh_push_exact.mjs <token> [owner/repo] [分支]
 * ============================================================ */
import { execSync } from 'node:child_process';

const TOKEN = process.argv[2];
const REPO = process.argv[3] || 'MNB-54188/photo-christmas-tree';
const BRANCH = process.argv[4] || 'main';
if (!TOKEN) { console.error('用法: node tools/gh_push_exact.mjs <token> [owner/repo] [branch]'); process.exit(1); }

const HDR = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'photo-christmas-tree-push',
};
async function gh(method, path, body) {
  const r = await fetch('https://api.github.com' + path, {
    method,
    headers: { ...HDR, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j = {}; try { j = t ? JSON.parse(t) : {}; } catch { j = { raw: t }; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${j.message || t.slice(0, 200)}`);
  return j;
}
const sh = (c) => execSync(c, { maxBuffer: 1 << 26 }).toString();
const shBuf = (c) => execSync(c, { maxBuffer: 1 << 26, encoding: 'buffer' });

const commits = sh(`git rev-list --reverse ${BRANCH}`).trim().split('\n').filter(Boolean);
const blobMap = new Map();
let parent = null;
let fail = 0;

for (const sha of commits) {
  const [an, ae, ad, cn, ce, cd] = sh(
    `git log -1 --format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI ${sha}`).split('\0');
  /* git log %B 输出会在真实提交消息后面多加一个换行，
     去掉这一个换行才是提交对象里存的原文，sha 才能和本地一致 */
  const msg = shBuf(`git log -1 --format=%B ${sha}`).toString('utf8').replace(/\n$/, '');
  const entries = sh(`git ls-tree -r ${sha}`).trim().split('\n').filter(Boolean).map((l) => {
    const [meta, path] = l.split('\t');
    const [mode, type, blob] = meta.split(/\s+/);
    return { mode, type, blob, path };
  });

  for (const e of entries) {
    if (blobMap.has(e.blob)) { e.ghSha = blobMap.get(e.blob); continue; }
    const b = await gh('POST', `/repos/${REPO}/git/blobs`, {
      content: shBuf(`git cat-file blob ${e.blob}`).toString('base64'),
      encoding: 'base64',
    });
    if (b.sha !== e.blob) { console.error(`blob sha 不一致: ${e.path}`); fail++; }
    blobMap.set(e.blob, b.sha);
    e.ghSha = b.sha;
  }

  const tree = await gh('POST', `/repos/${REPO}/git/trees`, {
    tree: entries.map((e) => ({ path: e.path, mode: e.mode, type: 'blob', sha: e.ghSha })),
  });
  if (tree.sha !== sh(`git rev-parse "${sha}^{tree}"`).trim()) console.error(`⚠️ tree sha 不一致 @ ${sha.slice(0, 7)}`);

  const c = await gh('POST', `/repos/${REPO}/git/commits`, {
    message: msg,
    tree: tree.sha,
    parents: parent ? [parent] : [],
    author: { name: an, email: ae, date: ad },
    committer: { name: cn, email: ce, date: cd },
  });
  const same = c.sha === sha;
  if (!same) fail++;
  console.log(`${same ? '✅' : '❌'} ${sha.slice(0, 7)} → ${c.sha.slice(0, 7)}  ${msg.split('\n')[0]}`);
  parent = c.sha;
}

try { await gh('POST', `/repos/${REPO}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: parent }); }
catch { await gh('PATCH', `/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: parent, force: true }); }

const repo = await gh('GET', `/repos/${REPO}`);
if (repo.default_branch !== BRANCH) await gh('PATCH', `/repos/${REPO}`, { default_branch: BRANCH });

console.log(fail ? `\n⚠️ 有 ${fail} 处 sha 未对齐` : `\n🎉 远端与本地 sha 完全一致：https://github.com/${REPO}`);
