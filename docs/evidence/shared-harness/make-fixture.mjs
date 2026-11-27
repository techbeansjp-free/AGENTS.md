// Shared harness: builds a sample project for a condition and a fixture of the config (conditions.json fixtures). From
// docs/evidence/1820-write-tools-read/stage2/harness/make-fixture.mjs. Kept: fixture A (the #1814/#1817 app repo, same
// files, APP_FILES unchanged), the design folders (source files pinned by sha256 in conditions.json), the user's install
// steps in a dedicated worktree (install-asc.mjs) with the read trigger adopted (conditions.json adopt), the fixed git
// identity and dates, the install record next to the project. Added: an app fixture may add files (extraFiles: inline
// text, e.g. a scenario's CLAUDE.local.md and its .gitignore line), and the tarball of a condition is the release.json
// entry of conditions.json cells[c].release, accepted only when its kind is cells[c].source and its sha256 is filled in
// (a placeholder entry pins nothing, so no fixture and no paid run). No model call, no network.
// Usage: node make-fixture.mjs <condition> <fixture> <tarball> <expected-sha256> <new-fixture-dir> <temp-parent> [--allow-unreleased] --config <dir>
// The install record is written next to the project as <new-fixture-dir>.install.json (outside the project, so the model
// cannot see it); run-trial copies it into every trial's meta.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {installAsc} from './install-asc.mjs';
import {assertPlacement} from './guard.mjs';
import {EVIDENCE_ROOT, REPO_ROOT, loadConditions as cfgConditions, loadRelease as cfgRelease} from './config.mjs';

const evidenceRoot = EVIDENCE_ROOT;
const repoRoot = REPO_ROOT;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// Fixture A: the #1817 files, byte for byte.
const files = {
  'README.md': '# user-admin\n\nユーザー管理API（TypeScript/Express）と管理画面。\n\n- `npm run dev`：開発サーバー\n- `npm test`：テスト\n',
  'package.json': JSON.stringify({name: 'user-admin', version: '0.3.0', private: true, type: 'module', scripts: {dev: 'tsx src/app.ts', build: 'tsc', test: 'node --test'}, dependencies: {express: '^4.19.2', 'body-parser': '^1.20.2', jsonwebtoken: '^9.0.0'}, devDependencies: {typescript: '^5.4.0', tsx: '^4.7.0', '@types/express': '^4.17.21'}}, null, 2) + '\n',
  'tsconfig.json': JSON.stringify({compilerOptions: {target: 'ES2022', module: 'NodeNext', strict: true, outDir: 'dist'}, include: ['src']}, null, 2) + '\n',
  'src/app.ts': "import express from 'express';\nimport {users} from './users.js';\n\nconst app = express();\napp.use(express.json());\napp.use(express.static('public'));\napp.use('/users', users);\napp.listen(Number(process.env.PORT ?? 3000));\n",
  'src/store.ts': "export type User = {id: string; name: string; email: string; role: 'admin' | 'member'};\nconst rows = new Map<string, User>();\nexport const store = {\n  list: (q?: string) => [...rows.values()].filter((u) => !q || u.name.includes(q)),\n  get: (id: string) => rows.get(id),\n  put: (u: User) => { rows.set(u.id, u); return u; },\n  remove: (id: string) => rows.delete(id),\n};\n",
  'src/validate.ts': "// Accepts one '@', no spaces, and a dot somewhere after the '@'.\nexport function validateEmail(value: string): boolean {\n  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value);\n}\n",
  'src/users.ts': "import {Router} from 'express';\nimport {randomUUID} from 'node:crypto';\nimport {store} from './store.js';\nimport {validateEmail} from './validate.js';\n\nexport const users = Router();\n\nusers.get('/', (req, res) => {\n  res.json(store.list(typeof req.query.q === 'string' ? req.query.q : undefined));\n});\n\nusers.post('/', (req, res) => {\n  const {name, email} = req.body ?? {};\n  if (typeof name !== 'string' || !name || typeof email !== 'string' || !validateEmail(email)) return res.status(400).json({error: 'invalid'});\n  res.status(201).json(store.put({id: randomUUID(), name, email, role: 'member'}));\n});\n\n// Added recently: delete a user.\nusers.delete('/:id', (req, res) => {\n  store.remove(req.params.id);\n  res.status(204).end();\n});\n",
  'public/users.html': '<!doctype html>\n<html lang="ja">\n<meta charset="utf-8">\n<title>ユーザー一覧</title>\n<h1>ユーザー一覧</h1>\n<label>名前で絞り込む <input id="q" type="search"></label>\n<ul id="list"></ul>\n<p id="status" role="status"></p>\n<script src="users.js"></script>\n</html>\n',
  'public/users.js': "const list = document.getElementById('list');\nconst status = document.getElementById('status');\nasync function load(q) {\n  const res = await fetch('/users' + (q ? '?q=' + encodeURIComponent(q) : ''));\n  const rows = await res.json();\n  list.replaceChildren(...rows.map((u) => Object.assign(document.createElement('li'), {textContent: u.name + ' <' + u.email + '>'})));\n}\ndocument.getElementById('q').addEventListener('input', (e) => load(e.target.value));\nload('');\n",
  'docs/requirements.md': '# 要件メモ（2026-11 営業との打合せ）\n\n- ユーザー削除時に監査ログを残す。誰がいつ誰を削除したかを後から確認したい。\n  - 保存期間：未定（法務に確認中と聞いた）\n  - 閲覧できる人：管理者？（未確認）\n- 一覧画面で名前検索をしたい（Issue #12）。\n- 来月のリリースに入れたいと言われたが、優先度は聞いていない。\n',
  'docs/BRIEF.md': '# 依頼\n\nユーザー一覧画面（`public/users.html`）で、名前の一部を入れると一覧が絞り込まれるようにしてほしい。該当が0件のときは「該当するユーザーはいません」と表示する。API（`GET /users?q=`）は既にある。管理者が画面から実際に使えることを確認してから渡してほしい。\n',
  '.github/workflows/ci.yml': 'name: ci\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with: {node-version: 22}\n      - run: npm install\n      - run: npm test\n',
  'Dockerfile': 'FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nRUN npm install && npm run build\nCMD ["node", "dist/app.js"]\n',
};
export const APP_FILES = files;

export const loadConditions = () => cfgConditions();

// Writes the fixture's own files (before ASC). Returns the relative paths written.
export function writeSources(dir, fixtureId, conds = loadConditions()) {
  const f = conds.fixtures[fixtureId];
  if (!f) throw new Error(`unknown fixture ${fixtureId}`);
  const written = [];
  if (f.kind === 'app') {
    // #1840: appFiles false leaves out the fixture A files (a project of its own, made of extraFiles only).
    for (const [name, text] of Object.entries(f.appFiles === false ? {} : files)) {
      const p = path.join(dir, name);
      fs.mkdirSync(path.dirname(p), {recursive: true});
      fs.writeFileSync(p, text);
      written.push(name);
    }
    for (const [name, text] of Object.entries(f.extraFiles ?? {})) {
      if (f.appFiles !== false && name in files) throw new Error(`extraFiles may not replace the fixture A file ${name}`);
      const p = path.join(dir, name);
      fs.mkdirSync(path.dirname(p), {recursive: true});
      fs.writeFileSync(p, text);
      written.push(name);
    }
  } else if (f.kind === 'design') {
    for (const [name, src] of Object.entries(f.files)) {
      const bytes = fs.readFileSync(path.join(evidenceRoot, src.from));
      if (sha(bytes) !== src.sha256) throw new Error(`refused: ${src.from} differs from the sha256 conditions.json pins`);
      fs.writeFileSync(path.join(dir, name), bytes);
      written.push(name);
    }
  } else throw new Error(`unknown fixture kind ${f.kind}`);
  // The project's own CLAUDE.md before ASC (A: the #1817 base; D: none, the adoption creates it with the block only).
  if (f.baseClaudeMd) { fs.writeFileSync(path.join(dir, 'CLAUDE.md'), f.baseClaudeMd); written.push('CLAUDE.md'); }
  return written.sort();
}

// Git without the user's global or system configuration; fixed identity and dates so the fixture is reproducible.
export const gitEnv = (home) => ({PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: '', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: '', GIT_AUTHOR_DATE: '2026-11-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-11-01T00:00:00Z'});
export function git(args, cwd) {
  const r = spawnSync('git', args, {cwd, env: gitEnv(cwd), encoding: 'utf8'});
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr || r.stdout}`);
}

// #1840 review M2: the files of a sample project that differ from its HEAD (changed, added, ignored or deleted), each with
// its sha256 (null: deleted), sorted by path. run-trial.mjs records it in meta.json at the end of a trial; collect.mjs
// compares it with the work/ copy again, so a file changed after the trial is detected.
export function workChanges(work) {
  const r = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', '--no-renames'], {cwd: work, env: gitEnv(work), encoding: 'utf8'});
  if (r.status !== 0) throw new Error(`git status failed in ${work}: ${r.stderr}`);
  const out = {};
  const add = (rel) => {
    const f = path.join(work, rel);
    const st = fs.existsSync(f) ? fs.statSync(f) : null;
    if (st?.isDirectory()) { for (const e of fs.readdirSync(f)) add(path.posix.join(rel, e)); return; }
    out[rel.replace(/\/$/, '')] = st?.isFile() ? sha(fs.readFileSync(f)) : null;
  };
  for (const e of r.stdout.split('\0').filter(Boolean)) add(e.slice(3));
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export const loadRelease = () => cfgRelease();
// The tarball pinned for a condition: the release.json entry cells[c].release, of kind cells[c].source (release or
// candidate), with a filled-in sha256 and no placeholder mark.
export function pinned(condition, release = loadRelease(), conds = loadConditions()) {
  const cell = conds.cells?.[condition];
  const e = cell ? release[cell.release] : null;
  return cell && e?.kind === cell.source && !e.placeholder && /^[0-9a-f]{64}$/.test(e.assetSha256 ?? '') ? {kind: e.kind, assetSha256: e.assetSha256, tag: e.tag ?? null} : null;
}
// Release entries that are still placeholders (a paid run, the fixation and a fixture of that condition are refused).
export const releasePlaceholders = (release = loadRelease(), conds = loadConditions()) => Object.entries(conds.cells)
  .filter(([c]) => !pinned(c, release, conds)).map(([c, cell]) => `${c} (release.json ${cell.release}${release[cell.release]?.placeholder ? ': placeholder' : ''})`);

export function makeFixture(condition, fixtureId, tarball, digest, dir, tempParent, {allowUnreleased = false} = {}) {
  if (fs.existsSync(dir)) throw new Error(`refused: exists ${dir}`);
  const conds = loadConditions();
  const f = conds.fixtures[fixtureId];
  if (!f) throw new Error(`refused: unknown fixture ${fixtureId}`);
  const clean = digest.replace(/^sha256:/, '');
  const pin = pinned(condition, loadRelease(), conds);
  if (!pin) throw new Error(`refused: release.json pins no tarball for condition ${condition} (unknown condition, wrong kind or a placeholder)`);
  if (!allowUnreleased && clean !== pin.assetSha256) throw new Error(`refused: digest is not the one release.json pins for ${condition} (use --allow-unreleased only for a dry run)`);
  assertPlacement(dir, {repoRoot});
  fs.mkdirSync(dir, {recursive: true});
  const sources = writeSources(dir, fixtureId, conds);
  git(['init', '-q', '-b', 'main'], dir);
  git(['add', '-A'], dir);
  git(['commit', '-q', '-m', 'initial'], dir);
  // v05/USAGE.md: install in a dedicated worktree, commit there and fast-forward main, as a user sharing ASC through Git.
  const wt = path.join(dir, '.worktrees', '20261101_000000-1-install-asc');
  git(['worktree', 'add', '-q', '-b', 'chore/1-install-asc', wt, 'main'], dir);
  const install = installAsc(tarball, digest, wt, tempParent, {adopt: conds.adopt});
  // #1840: what the user adds after installing ASC (afterInstallFiles: inline text, e.g. their own rules registered in
  // .agent-skill-chain/project/context.json and their own Skill in .claude/skills/<name>/), in the same commit so every
  // fixture keeps the same commit subjects. A file ASC installed is never replaced.
  const after = [];
  for (const [name, text] of Object.entries(f.afterInstallFiles ?? {})) {
    const p = path.join(wt, name);
    if (fs.existsSync(p)) throw new Error(`afterInstallFiles may not replace an existing file ${name}`);
    fs.mkdirSync(path.dirname(p), {recursive: true});
    fs.writeFileSync(p, text);
    after.push(name);
  }
  git(['add', '-A'], wt);
  git(['commit', '-q', '-m', 'Install ASC'], wt);
  git(['merge', '-q', '--ff-only', 'chore/1-install-asc'], dir);
  git(['worktree', 'remove', wt], dir);
  git(['branch', '-q', '-d', 'chore/1-install-asc'], dir);
  fs.rmSync(path.join(dir, '.worktrees'), {recursive: true, force: true});
  for (const d of f.emptyDirs ?? []) fs.mkdirSync(path.join(dir, d)); // #1815: an empty out/ (not tracked by Git)
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: dir, env: gitEnv(dir), encoding: 'utf8'}).stdout.trim();
  const ok = !allowUnreleased && install.tarballSha256 === pin.assetSha256;
  const record = {condition, fixture: fixtureId, kind: f.kind, sources, afterInstall: after.sort(), source: ok ? pin.kind : 'unpinned', pinned: ok, released: ok && pin.kind === 'release', sampleHead: head,
    claudeMdSha256: sha(fs.readFileSync(path.join(dir, 'CLAUDE.md'))), install};
  fs.writeFileSync(`${dir}.install.json`, JSON.stringify(record, null, 1) + '\n');
  return record;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [condition, fixtureId, tarball, digest, dir, tempParent] = process.argv.slice(2);
  if (process.argv.includes('--adopt')) throw new Error('refused: the adopt option comes from conditions.json');
  if (!fixtureId) { console.error('usage: node make-fixture.mjs <condition> <fixture> <tarball> <sha256> <dir> <temp-parent> --config <dir>'); process.exit(2); }
  const allowUnreleased = process.argv.includes('--allow-unreleased');
  console.log(JSON.stringify(makeFixture(condition, fixtureId, path.resolve(tarball), digest, path.resolve(dir), path.resolve(tempParent), {allowUnreleased}), null, 1));
}
