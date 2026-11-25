// Condition <-> tarball pairing for #1815 (release.json). No model call, no network.
// - tarballProblems: the tarball given to a trial must be the one pinned for its condition (sha256). A tarball pinned for
//   the other condition, or not pinned at all, is refused.
// - installedProblems: after the install, the two reference files that carry the candidate text must have the hashes
//   pinned for the condition, and CLAUDE.md must carry the adopted read-trigger block.
// - packageDiff: relative paths that differ between two unpacked package trees (dry run: B vs S = differsOnly).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const ev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const evidenceRoot = path.resolve(ev, '..');
export const loadJson = (rel) => JSON.parse(fs.readFileSync(path.join(ev, rel), 'utf8'));
export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const fileSha256 = (p) => sha256(fs.readFileSync(p));
export const READ_TRIGGER_MARK = '<!-- asc:read-trigger v1 -->';

export function tarballProblems(release, conds, cond, digest) {
  const c = conds.conditions?.[cond];
  if (!c) return [`unknown condition ${cond}`];
  const pinned = release[c.release]?.assetSha256;
  if (!pinned) return [`condition ${cond} has no pinned tarball in release.json`];
  if (digest === pinned) return [];
  const other = Object.entries(conds.conditions).find(([, x]) => release[x.release]?.assetSha256 === digest);
  return [other ? `tarball is pinned for condition ${other[0]}, not ${cond}` : 'tarball sha256 is not pinned in release.json'];
}

export function installedProblems(release, cond, project) {
  const want = release.installedReferences?.[cond];
  if (!want) return [`no installedReferences for ${cond}`];
  const p = [];
  for (const [rel, sha] of Object.entries(want)) {
    const f = path.join(project, rel);
    if (!fs.existsSync(f)) p.push(`${rel} is missing`);
    else if (fileSha256(f) !== sha) p.push(`${rel} differs from release.json installedReferences.${cond}`);
  }
  const md = path.join(project, 'CLAUDE.md');
  if (!fs.existsSync(md) || !fs.readFileSync(md, 'utf8').includes(READ_TRIGGER_MARK)) p.push('CLAUDE.md has no adopted read-trigger block');
  return p;
}

function walk(root, rel = '', out = new Map()) {
  for (const e of fs.readdirSync(path.join(root, rel), {withFileTypes: true})) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(root, r, out);
    else out.set(r, fileSha256(path.join(root, r)));
  }
  return out;
}

// Paths present in only one tree or with different bytes, sorted. skip: relative prefixes to ignore (e.g. '.git').
export function packageDiff(a, b, {skip = []} = {}) {
  const keep = (r) => !skip.some((s) => r === s || r.startsWith(`${s}/`));
  const x = walk(a), y = walk(b);
  const all = [...new Set([...x.keys(), ...y.keys()])].filter(keep).sort();
  return all.filter((r) => x.get(r) !== y.get(r));
}
