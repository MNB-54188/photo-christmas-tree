/* ============================================================
 *  gh_push_api.mjs —— 当 git 协议/github.com 被代理挡住时，
 *  改用 GitHub Git Data API 把本地提交原样写进远程仓库。
 *  用法：node tools/gh_push_api.mjs <token> [owner/repo] [分支]
 * ============================================================ */
import { execSync } from 'node:child_process';

const TOKEN = process.argv[2];
const REPO = process.argv[3] || 'MNB-54188/photo-christmas-tree';
const BRANCH = process.argv[4] || 'main';
if (!TOKEN) { console.error('用法: node tools/gh_push_api.mjs <token> [owner/repo] [branch]'); process.exit(1); }

const API = 'https://api.github.com';
const HDR = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'photo-christmas-tree-push',
};

async function gh(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: { ...HDR, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let j = {}; try { j = txt ? JSON.parse(txt) : {}; } catch { j = { raw: txt }; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${j.message || txt.slice(0, 300)}`);
  return j;
}

const sh = (cmd) => execSync(cmd, { maxBuffer: 1024 * 1024 * 64 }).toString();
const shBuf = (cmd) => execSync(cmd, { maxBuffer: 1024 * 1024 * 64, encoding: 'buffer' });

/* 1. 按时间顺序列出本地提交 */
const commits = sh(`git rev-list --reverse ${BRANCH}`).trim().split('\n').filter(Boolean);
console.log(`本地提交 ${commits.length} 个：`, commits.map((c) => c.slice(0, 7)).join(' '));

const blobMap = new Map();   // git blob sha -> github blob sha

/* 1.5 空仓库不能直接建 blob：先用 contents API 造一个引导提交 */
async function currentHead() {
  try {
    const r = await gh('GET', `/repos/${REPO}/git/ref/heads/${BRANCH}`);
    return r.object.sha;
  } catch { return null; }
}
let parent = await currentHead();
if (!parent) {
  const boot = await gh('PUT', `/repos/${REPO}/contents/.init`, {
    message: 'chore: initialize repository',
    content: Buffer.from('bootstrap\n').toString('base64'),
    branch: BRANCH,
  });
  parent = boot.commit.sha;
  console.log(`🌱 空仓库已初始化（引导提交 ${parent.slice(0, 7)}）`);
}

for (const sha of commits) {
  const msg = shBuf(`git log -1 --format=%B ${sha}`).toString('utf8').trim();
  const entries = sh(`git ls-tree -r ${sha}`).trim().split('\n').filter(Boolean).map((line) => {
    const [meta, path] = line.split('\t');
    const [mode, type, blob] = meta.split(/\s+/);
    return { mode, type, blob, path };
  });

  /* 2. 上传 blob（同一内容只传一次） */
  let uploaded = 0;
  for (const e of entries) {
    if (blobMap.has(e.blob)) { e.ghSha = blobMap.get(e.blob); continue; }
    const content = shBuf(`git cat-file blob ${e.blob}`).toString('base64');
    const b = await gh('POST', `/repos/${REPO}/git/blobs`, { content, encoding: 'base64' });
    blobMap.set(e.blob, b.sha);
    e.ghSha = b.sha;
    uploaded++;
  }

  /* 3. 建树 */
  const tree = await gh('POST', `/repos/${REPO}/git/trees`, {
    tree: entries.map((e) => ({ path: e.path, mode: e.mode, type: 'blob', sha: e.ghSha })),
  });

  /* 4. 建提交 */
  const c = await gh('POST', `/repos/${REPO}/git/commits`, {
    message: msg,
    tree: tree.sha,
    parents: parent ? [parent] : [],
  });
  parent = c.sha;
  console.log(`✅ ${sha.slice(0, 7)} → ${c.sha.slice(0, 7)}  (${entries.length} 个文件，新传 blob ${uploaded})`);
}

/* 5. 指向分支 */
try {
  await gh('POST', `/repos/${REPO}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: parent });
  console.log(`🌿 已创建 refs/heads/${BRANCH}`);
} catch (e) {
  await gh('PATCH', `/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: parent, force: true });
  console.log(`🌿 已更新 refs/heads/${BRANCH}`);
}

/* 6. 确认默认分支 */
const repo = await gh('GET', `/repos/${REPO}`);
if (repo.default_branch !== BRANCH) {
  await gh('PATCH', `/repos/${REPO}`, { default_branch: BRANCH });
  console.log(`🔧 默认分支改为 ${BRANCH}`);
}
console.log(`\n🎉 完成：https://github.com/${REPO}`);
