/* 暴力定位：远端提交对象与本地差异到底在哪 */
import { execSync } from 'node:child_process';
const target = process.argv[2];                 // 远端 sha
const tree = '8cd707a671b06117d2f0207277e034ad966d061c';
const localSha = 'f2afb42fa844b06472ac5bc8cae4d4243cbbd271';
const msg = execSync('git log -1 --format=%B f2afb42', { maxBuffer: 1 << 26 }).toString('utf8');
console.log('本地 %B 尾部:', JSON.stringify(msg.slice(-20)));

const variants = [];
for (const tail of ['', '\n', '\n\n']) {
  for (const off of ['+0000', '+0800']) {
    for (const epoch of [1792924805, 1792924805 + 3600 * 8]) {
      variants.push({ tail, off, epoch });
    }
  }
}
for (const v of variants) {
  const body = msg.replace(/\n*$/, '') + v.tail;
  const obj =
    `tree ${tree}\n` +
    `author MNB-54188 <mamingchen5@gmail.com> ${v.epoch} ${v.off}\n` +
    `committer MNB-54188 <mamingchen5@gmail.com> ${v.epoch} ${v.off}\n` +
    `\n${body}`;
  const sha = execSync('git hash-object -t commit --stdin', { input: Buffer.from(obj, 'utf8'), maxBuffer: 1 << 26 }).toString().trim();
  const hit = sha === target ? '  ← 命中远端' : (sha === localSha ? '  (本地)' : '');
  console.log(`tail=${JSON.stringify(v.tail)} off=${v.off} epoch=${v.epoch} → ${sha}${hit}`);
}
console.log('远端:', target);
