// V-L3: execution history as append-only events under refs/asc/runs/<run>, shared through a remote,
// projected deterministically into SQLite. Uses a local bare repo as the remote (GitHub not tested here).
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asc-history-refs-'));
const outFile = process.argv[3];
const g = (cwd, args, input) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const tryG = (cwd, args) => { try { return { ok: true, out: g(cwd, args) }; } catch (e) { return { ok: false, out: String(e.stderr) }; } };
const now = () => performance.now();
const res = {};
execFileSync('git', ['init', '-q', '--bare', root + '/origin.git']);
for (const c of ['A', 'B']) {
  execFileSync('git', ['init', '-q', root + '/' + c]);
  g(root + '/' + c, ['config', 'user.email', c + '@x']); g(root + '/' + c, ['config', 'user.name', c]);
  g(root + '/' + c, ['remote', 'add', 'origin', root + '/origin.git']);
  g(root + '/' + c, ['commit', '-q', '--allow-empty', '-m', 'init']);
}
g(root + '/A', ['push', '-q', 'origin', 'HEAD:refs/heads/main']);

// append one event: the run ref's tree holds events/<lamport>-<sha>.json; each commit adds exactly one file
function append(repo, run, ev) {
  const ref = 'refs/asc/runs/' + run;
  const parent = tryG(repo, ['rev-parse', '-q', '--verify', ref]);
  const prevTree = parent.ok ? g(repo, ['rev-parse', ref + '^{tree}']) : null;
  const lines = prevTree ? g(repo, ['ls-tree', prevTree + ':events']).split('\n').filter(Boolean) : [];
  const lamport = lines.length + 1;
  const body = JSON.stringify({ schema: 'asc-event/v1', run, lamport, ...ev });
  const blob = g(repo, ['hash-object', '-w', '--stdin'], body);
  const name = String(lamport).padStart(6, '0') + '-' + crypto.createHash('sha256').update(body).digest('hex').slice(0, 16) + '.json';
  const sub = g(repo, ['mktree'], [...lines, `100644 blob ${blob}\t${name}`].join('\n') + '\n');
  const tree = g(repo, ['mktree'], `040000 tree ${sub}\tevents\n`);
  const commit = g(repo, ['commit-tree', tree, ...(parent.ok ? ['-p', parent.out] : []), '-m', ev.type], '');
  g(repo, ['update-ref', ref, commit, ...(parent.ok ? [parent.out] : [])]); // CAS on the old tip
  return commit;
}
const push = (repo) => tryG(repo, ['push', '-q', 'origin', 'refs/asc/runs/*:refs/asc/runs/*']);
const fetch = (repo) => tryG(repo, ['fetch', '-q', 'origin', '+refs/asc/runs/*:refs/asc/runs/*']);

// 1. two teammates, separate runs: no conflicts by construction
append(root + '/A', 'r-a1', { type: 'run_started', base_tree: 'T0' });
append(root + '/A', 'r-a1', { type: 'attempt', unit: 'u1', round: 1, iter: 1, verdict: 'fail', reason_code: 'test_failed', input_digest: 'd1' });
append(root + '/B', 'r-b1', { type: 'run_started', base_tree: 'T0' });
append(root + '/B', 'r-b1', { type: 'attempt', unit: 'u1', round: 1, iter: 1, verdict: 'pass', input_digest: 'd2' });
res.pushA = push(root + '/A').ok; res.pushB = push(root + '/B').ok;
// 2. plain clone does not carry refs/asc/*; explicit refspec does
execFileSync('git', ['clone', '-q', root + '/origin.git', root + '/C']);
res.plainCloneHasAscRefs = tryG(root + '/C', ['for-each-ref', 'refs/asc']).out !== '';
res.fetchExplicit = fetch(root + '/C').ok;
res.afterFetchRefs = g(root + '/C', ['for-each-ref', '--format=%(refname)', 'refs/asc']).split('\n');
// 3. two writers on the same run ref (should not happen by design): second push is rejected, not silently merged
fetch(root + '/B');
append(root + '/A', 'r-a1', { type: 'attempt', unit: 'u1', round: 1, iter: 2, verdict: 'pass', input_digest: 'd1b' });
append(root + '/B', 'r-a1', { type: 'note', by: 'B' });
res.raceFirstPush = push(root + '/A').ok;
const second = push(root + '/B');
res.raceSecondPushRejected = !second.ok && /rejected|non-fast-forward|fetch first/.test(second.out);
// 4. gc keeps everything reachable from refs/asc
g(root + '/origin.git', ['gc', '-q', '--prune=now']);
res.afterGcEvents = g(root + '/origin.git', ['ls-tree', 'refs/asc/runs/r-a1:events']).split('\n').length;

// 5. projection: replay all refs in a canonical order into SQLite; must be identical from any clone
function project(repo, file) {
  fs.rmSync(file, { force: true });
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE ingest_state(ref TEXT PRIMARY KEY, tip_sha TEXT NOT NULL) STRICT, WITHOUT ROWID;
    CREATE TABLE event(run TEXT NOT NULL, lamport INTEGER NOT NULL, type TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(run, lamport)) STRICT, WITHOUT ROWID;
    CREATE TABLE attempt(run TEXT NOT NULL, unit TEXT NOT NULL, round INTEGER NOT NULL, iter INTEGER NOT NULL, verdict TEXT NOT NULL, reason_code TEXT, input_digest TEXT NOT NULL, PRIMARY KEY(run, unit, round, iter)) STRICT, WITHOUT ROWID;`);
  const refs = g(repo, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/asc/runs']).split('\n').filter(Boolean).sort();
  db.exec('BEGIN');
  for (const line of refs) {
    const [ref, tip] = line.split(' ');
    db.prepare('INSERT INTO ingest_state VALUES (?,?)').run(ref, tip);
    for (const l of g(repo, ['ls-tree', ref + ':events']).split('\n').sort()) {
      const ev = JSON.parse(g(repo, ['cat-file', 'blob', l.split(/\s+/)[2]]));
      db.prepare('INSERT INTO event VALUES (?,?,?,?)').run(ev.run, ev.lamport, ev.type, JSON.stringify(ev));
      if (ev.type === 'attempt') db.prepare('INSERT INTO attempt VALUES (?,?,?,?,?,?,?)').run(ev.run, ev.unit, ev.round, ev.iter, ev.verdict, ev.reason_code ?? null, ev.input_digest);
    }
  }
  db.exec('COMMIT');
  const dump = ['ingest_state', 'event', 'attempt'].map((t) => JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all())).join('\n');
  db.close();
  return crypto.createHash('sha256').update(dump).digest('hex');
}
fetch(root + '/A'); fetch(root + '/C');
const h1 = project(root + '/A', root + '/p1.db'), h2 = project(root + '/A', root + '/p2.db'), h3 = project(root + '/C', root + '/p3.db');
res.projectionDeterministic = h1 === h2; res.projectionSameAcrossClones = h1 === h3;
// 6. scale: 2000 runs x 5 events, push + fresh fetch time, advertised refs
const N = Number(process.argv[2] ?? 2000);
let t = now();
for (let i = 0; i < N; i++) for (let k = 0; k < 5; k++) append(root + '/A', 'r-scale-' + i, { type: 'attempt', unit: 'u' + k, round: 1, iter: 1, verdict: 'pass', input_digest: 'x' + i + k });
res.appendMsPerEvent = (now() - t) / (N * 5);
t = now(); res.scalePush = push(root + '/A').ok; res.scalePushMs = now() - t;
execFileSync('git', ['init', '-q', root + '/D']); g(root + '/D', ['remote', 'add', 'origin', root + '/origin.git']);
t = now(); fetch(root + '/D'); res.freshFetchMs = now() - t;
t = now(); const lr = g(root + '/D', ['ls-remote', 'origin']); res.lsRemoteMs = now() - t; res.advertisedRefs = lr.split('\n').length;
t = now(); project(root + '/D', root + '/p4.db'); res.projectAllMs = now() - t;
res.originBytes = fs.readdirSync(root + '/origin.git', { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).reduce((a, e) => a + fs.statSync(path.join(e.parentPath, e.name)).size, 0);
console.log(JSON.stringify(res, null, 1));
if (outFile) fs.writeFileSync(outFile, JSON.stringify(res, null, 1));
fs.rmSync(root, { recursive: true, force: true });
