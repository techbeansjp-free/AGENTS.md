// Builds one #1815 sample project outside this repository: the case files (BRIEF.md, data.json) + FONTS.md, a Git
// repository, and ASC installed from a release/candidate tarball the way a user does (#1814 make-fixture.mjs: a dedicated
// worktree, install-asc.mjs = npm --offline + project-assets --register-claude-skill --apply, read trigger adopted with
// --adopt), committed and fast-forwarded to main. Then an empty out/ (as #1807 run-gen.mjs). No model call, no network.
// The install record is returned (the caller writes it outside the project, so the model cannot see it).
// Usage: node make-sample.mjs <case-id> <tarball> <sha256> <new-project-dir> <temp-parent>
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {installAsc} from '../../1814-skill-invocation/harness/install-asc.mjs';
import {git, gitEnv} from '../../1814-skill-invocation/harness/make-fixture.mjs';
import {assertPlacement} from '../../1814-skill-invocation/harness/guard.mjs';
import {ev, evidenceRoot, loadJson} from './pairing.mjs';

const repoRoot = path.resolve(ev, '../../..');

export function caseFiles(caseId) {
  const spec = loadJson('cases.json');
  const k = spec.cases[caseId];
  if (!k) throw new Error(`unknown case ${caseId}`);
  const src = path.join(evidenceRoot, k.from);
  const files = fs.readdirSync(src).filter((f) => fs.statSync(path.join(src, f)).isFile()).sort().map((f) => [f, path.join(src, f)]);
  files.push(['FONTS.md', path.join(evidenceRoot, spec.fonts)]);
  return files;
}

export function makeSample(caseId, tarball, digest, dir, tempParent, {adopt} = {}) {
  if (fs.existsSync(dir)) throw new Error(`refused: exists ${dir}`);
  if (!adopt) throw new Error('refused: the read trigger must be adopted (condition I of #1814)');
  assertPlacement(dir, {repoRoot});
  fs.mkdirSync(dir, {recursive: true});
  const files = caseFiles(caseId);
  for (const [name, src] of files) fs.copyFileSync(src, path.join(dir, name));
  git(['init', '-q', '-b', 'main'], dir);
  git(['add', '-A'], dir);
  git(['commit', '-q', '-m', 'initial'], dir);
  const wt = path.join(dir, '.worktrees', '20261101_000000-1-install-asc');
  git(['worktree', 'add', '-q', '-b', 'chore/1-install-asc', wt, 'main'], dir);
  const install = installAsc(tarball, digest, wt, tempParent, {adopt});
  git(['add', '-A'], wt);
  git(['commit', '-q', '-m', 'Install ASC'], wt);
  git(['merge', '-q', '--ff-only', 'chore/1-install-asc'], dir);
  git(['worktree', 'remove', wt], dir);
  git(['branch', '-q', '-d', 'chore/1-install-asc'], dir);
  fs.rmSync(path.join(dir, '.worktrees'), {recursive: true, force: true});
  fs.mkdirSync(path.join(dir, 'out'));
  const g = (a) => spawnSync('git', a, {cwd: dir, env: gitEnv(dir), encoding: 'utf8'}).stdout.trim();
  return {case: caseId, caseFiles: files.map(([n]) => n), sampleHead: g(['rev-parse', 'HEAD']), status: g(['status', '--porcelain', '--untracked-files=all']), install};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [caseId, tarball, digest, dir, tempParent] = process.argv.slice(2);
  const r = makeSample(caseId, path.resolve(tarball), digest, path.resolve(dir), path.resolve(tempParent), {adopt: loadJson('conditions.json').adopt});
  console.log(JSON.stringify(r, null, 1));
}
