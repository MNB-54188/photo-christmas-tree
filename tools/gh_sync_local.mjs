/* ============================================================
 *  gh_sync_local.mjs —— 当提交是通过 GitHub API 写入（本地 sha 与远端不同）时，
 *  用相同的 tree / 作者 / 时间在本地重建出「一模一样 sha」的提交，
 *  让本地仓库与远端完全对齐（以后 git push/pull 不会冲突）。
 *  用法：node tools/gh_sync_local.mjs <token> [owner/repo] [分支]
 * ============================================================ */
import { execSync } from 'node:child_process';

const TOKEN = process.argv[2];
const REPO = process.argv[3] || 'MNB-54188/photo-christmas-tree';
const BRANCH = process.argv[4] || 'main';
if (!TOKEN) { console.error('用法: node tools/gh_sync_local.mjs <token> [owner/repo] [branch]'); process.exit(1); }

const HDR = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'sync' };
const gh = async (path) => {
  const r = await fetch('https://api.github.com' + path, { headers: HDR });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
};
const sh = (cmd, env = {}) => execSync(cmd, { env: { ...process.env, ...env }, maxBuffer: 1 << 26 }).toString().trim();

const remote = (await gh(`/repos/${REPO}/commits?per_page=100`)).reverse();
const localCommits = sh(`git rev-list --reverse ${BRANCH}`).split('\n').filter(Boolean);

/* 远端第 1 个是引导提交，后面依次对应本地提交 */
let prev = null;
remote.forEach((c, i) => {
  const meta = c.commit;
  let tree;
  if (i === 0) {
    /* 引导提交：把 .init 写成本地 tree */
    const blob = sh(`git hash-object -w --stdin`, {}); // 占位，下面用真实内容
    void blob;
    const content = Buffer.from('bootstrap\n');
    const bsha = execSync('git hash-object -w --stdin', { input: content, maxBuffer: 1 << 26 }).toString().trim();
    tree = sh(`printf '100644 blob ${bsha}\\t.init\\n' | git mktree`);
  } else {
    const localSha = localCommits[i - 1];
    tree = sh(`git rev-parse ${localSha}^{tree}`);
    if (tree !== meta.tree.sha) {
      console.error(`⚠️  tree 不一致：本地 ${localSha} → ${tree}，远端 → ${meta.tree.sha}`);
      process.exit(1);
    }
  }

  const toDate = (iso) => `${Math.floor(Date.parse(iso) / 1000)} +0000`;
  const env = {
    GIT_AUTHOR_NAME: meta.author.name,
    GIT_AUTHOR_EMAIL: meta.author.email,
    GIT_AUTHOR_DATE: toDate(meta.author.date),
    GIT_COMMITTER_NAME: meta.committer.name,
    GIT_COMMITTER_EMAIL: meta.committer.email,
    GIT_COMMITTER_DATE: toDate(meta.committer.date),
  };
  const args = prev ? `-p ${prev}` : '';
  const sha = execSync(`git commit-tree ${tree} ${args}`, {
    env: { ...process.env, ...env },
    input: Buffer.from(meta.message + '\n', 'utf8'),
    maxBuffer: 1 << 26,
  }).toString().trim();

  if (sha !== c.sha) {
    console.error(`❌ sha 未对齐：本地重建 ${sha} ≠ 远端 ${c.sha}`);
    process.exit(1);
  }
  console.log(`✅ 重建 ${sha.slice(0, 7)}  ${meta.message.split('\n')[0]}`);
  prev = sha;
});

sh(`git update-ref refs/heads/${BRANCH} ${prev}`);
sh(`git update-ref refs/remotes/origin/${BRANCH} ${prev}`);
console.log(`\n🎉 本地 ${BRANCH} 已指向 ${prev.slice(0, 7)}，与远端完全一致`);
console.log(sh('git status --short | head -5') || '(工作区干净)');
