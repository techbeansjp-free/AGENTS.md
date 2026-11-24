// Static inventory of an untrusted repo (read-only). Usage: node inventory.mjs <repo-dir> [subpath...]
import fs from 'node:fs'; import path from 'node:path'; import {execFileSync} from 'node:child_process'; import crypto from 'node:crypto';
const [root, ...subs] = process.argv.slice(2);
let files = execFileSync('git', ['-C', root, 'ls-files', ...subs], {encoding: 'utf8'}).split('\n').filter(Boolean);
const ext = {}, code = [], urls = {}, hits = {};
const pats = {
  network: /\b(fetch\(|XMLHttpRequest|axios|requests\.(get|post)|urllib|http\.request|https\.request|curl |wget |WebSocket\(|navigator\.sendBeacon)/,
  exec: /\b(child_process|subprocess|os\.system|execSync|spawnSync|exec\(|eval\(|new Function\()/,
  secrets: /(process\.env|os\.environ|\.ssh\/|id_rsa|\.aws\/|API_KEY|_TOKEN|\.netrc|keychain)/i,
  fsWrite: /(writeFileSync|fs\.write|open\([^)]*['"]w|shutil\.(rm|move)|rmSync|unlink)/,
  injection: /(ignore (all |the )?(previous|prior) instructions|disregard .*instructions|you must (now )?(run|execute)|system prompt|do not tell the user)/i,
  remoteScript: /<script[^>]+src=["']https?:|@import url\(["']?https?:|<link[^>]+href=["']https?:/i,
};
let total = 0; const sha = crypto.createHash('sha256');
for (const f of files) {
  const p = path.join(root, f); let st; try { st = fs.lstatSync(p); } catch { continue; }
  if (st.isSymbolicLink()) { (hits.symlink ??= []).push(f + ' -> ' + fs.readlinkSync(p)); continue; }
  if (!st.isFile()) continue; total += st.size;
  const e = (path.extname(f) || '(none)').toLowerCase(); ext[e] = (ext[e] ?? 0) + 1;
  const buf = fs.readFileSync(p); sha.update(f + '\0'); sha.update(buf);
  if (['.py','.js','.mjs','.cjs','.ts','.sh','.ps1','.bat'].includes(e) || (st.mode & 0o111)) code.push(f);
  if (st.size > 5e6) continue; const s = buf.toString('utf8');
  for (const m of s.matchAll(/https?:\/\/[^\s)"'<>\]`]+/g)) { let h; try { h = new URL(m[0]).hostname; } catch { continue; } urls[h] = (urls[h] ?? 0) + 1; }
  for (const [k, re] of Object.entries(pats)) if (re.test(s)) (hits[k] ??= []).push(f);
}
const top = Object.entries(urls).sort((a, b) => b[1] - a[1]);
console.log(JSON.stringify({files: files.length, bytes: total, contentSha256: sha.digest('hex'), ext, codeFiles: code.length, codeSample: code.slice(0, 40), urlHosts: top.length, urlCount: top.reduce((a, b) => a + b[1], 0), topHosts: top.slice(0, 15), hits: Object.fromEntries(Object.entries(hits).map(([k, v]) => [k, {n: v.length, sample: v.slice(0, 12)}]))}, null, 1));
