// Builds the synthetic consumer repository for #1814 outside this repository and installs ASC in it the way a user would.
// No model call, no network.
// The repo is a small TypeScript/Express user-management API with a list screen, a requirement memo with open points,
// a brief for an indirect request (as in #1807) and CI/Docker files, so that every path a prompt in cases.json names exists.
// ASC is installed from a release tarball by install-asc.mjs (the documented user steps), never copied from this repo.
// Usage: node make-fixture.mjs <release-tarball> <expected-sha256> <new-fixture-dir> <temp-parent> [--allow-unreleased] [--adopt <option-id>]
// --adopt (stage 3, condition I only) accepts the adopted read-trigger option at install time (install-asc.mjs).
// The digest must equal release.json phases0to2.assetSha256 (review L7); only a dry run passes --allow-unreleased to use a
// locally packed stand-in. The install record (versions, digests, entry hashes, sample HEAD) is written next to the
// project as <new-fixture-dir>.install.json, outside the project so the model cannot see it; run-trial copies it into
// every trial's meta.json.
// The fixture is not committed to the repository; this script is the record of how it is made.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {installAsc} from './install-asc.mjs';
import {assertPlacement} from './guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

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

export function writeSources(dir) {
  for (const [name, text] of Object.entries(files)) {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), {recursive: true});
    fs.writeFileSync(p, text);
  }
  return Object.keys(files).length;
}

// Git without the user's global or system configuration; fixed identity and dates so the fixture is reproducible.
export const gitEnv = (home) => ({PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: '', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: '', GIT_AUTHOR_DATE: '2026-11-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-11-01T00:00:00Z'});
export function git(args, cwd) {
  const r = spawnSync('git', args, {cwd, env: gitEnv(cwd), encoding: 'utf8'});
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr || r.stdout}`);
}

export function releaseDigests() {
  const r = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../release.json'), 'utf8'));
  return [r.phases0to2?.assetSha256, r.phase3?.assetSha256].filter(Boolean);
}

export function makeFixture(tarball, digest, dir, tempParent, {allowUnreleased = false, adopt = null} = {}) {
  if (fs.existsSync(dir)) throw new Error(`refused: exists ${dir}`);
  const clean = digest.replace(/^sha256:/, '');
  if (!allowUnreleased && !releaseDigests().includes(clean)) throw new Error('refused: digest is not a release digest in release.json (use --allow-unreleased only for a dry run)');
  assertPlacement(dir, {repoRoot});
  fs.mkdirSync(dir, {recursive: true});
  const count = writeSources(dir);
  // The project already has its own CLAUDE.md (no ASC mention) before ASC is installed; conditions.json baseClaudeMd.
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../conditions.json'), 'utf8')).baseClaudeMd);
  git(['init', '-q', '-b', 'main'], dir);
  git(['add', '-A'], dir);
  git(['commit', '-q', '-m', 'initial'], dir);
  // v05/USAGE.md: in a Git repository, install in a dedicated worktree, commit the distributed assets there and bring
  // them to main (here a fast-forward merge), as a user sharing ASC through Git would.
  const wt = path.join(dir, '.worktrees', '20261101_000000-1-install-asc');
  git(['worktree', 'add', '-q', '-b', 'chore/1-install-asc', wt, 'main'], dir);
  const install = installAsc(tarball, digest, wt, tempParent, {adopt});
  git(['add', '-A'], wt);
  git(['commit', '-q', '-m', 'Install ASC'], wt);
  git(['merge', '-q', '--ff-only', 'chore/1-install-asc'], dir);
  git(['worktree', 'remove', wt], dir);
  git(['branch', '-q', '-d', 'chore/1-install-asc'], dir);
  fs.rmSync(path.join(dir, '.worktrees'), {recursive: true, force: true});
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: dir, env: gitEnv(dir), encoding: 'utf8'}).stdout.trim();
  const record = {sourceFiles: count, released: !allowUnreleased, sampleHead: head, install};
  fs.writeFileSync(`${dir}.install.json`, JSON.stringify(record, null, 1) + '\n');
  return record;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [tarball, digest, dir, tempParent] = process.argv.slice(2);
  const allowUnreleased = process.argv.includes('--allow-unreleased');
  const i = process.argv.indexOf('--adopt');
  console.log(JSON.stringify(makeFixture(path.resolve(tarball), digest, path.resolve(dir), path.resolve(tempParent), {allowUnreleased, adopt: i >= 0 ? process.argv[i + 1] : null}), null, 1));
}
