// Usage: node probe.mjs <scratchDir>
// Deterministic counterexamples without a model: what a re-run after an interruption sees when an external side effect
// (push, PR creation, merge) already happened, and what Git does when two agents take the same Issue branch.
// It exercises the local stand-in (tracker.mjs) and Git itself; real GitHub behaviour is cited from documentation.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const [scratch] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
const runDir = path.join(scratch, 'probe');
execFileSync('node', [path.join(here, 'make-fixture.mjs'), runDir, 'K1']);
const work = path.join(runDir, 'work');
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const sh = (cmd, args, cwd = work) => { const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' }); return { code: r.status, out: `${r.stdout}${r.stderr}`.trim().split('\n').slice(-1)[0] }; };
const tracker = (...args) => sh('node', [path.join(runDir, 'tools/tracker.mjs'), ...args]);
const results = [];
const expect = (name, ok, detail) => results.push({ name, ok, detail });

fs.writeFileSync(path.join(work, 'src/slug.mjs'), "import { normalize } from './util.mjs';\nexport function slugify(s) { return normalize(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }\n");
sh('git', ['add', '-A']); sh('git', ['commit', '-qm', 'slug']);
const p1 = sh('git', ['push', '-q', 'origin', 'HEAD']);
const p2 = sh('git', ['push', 'origin', 'HEAD']);
expect('re-push of the same commit after an interruption is a no-op', p1.code === 0 && p2.code === 0 && /up-to-date/i.test(p2.out), p2.out);
const c1 = tracker('pr-create'), c2 = tracker('pr-create');
expect('a second PR creation is refused (read back instead of duplicating)', c1.code === 0 && c2.code !== 0, c2.out);
const head = sh('git', ['rev-parse', 'HEAD']).out;
const ci = JSON.parse(fs.readFileSync(path.join(runDir, 'tracker-data/ci.json'), 'utf8'));
ci[head] = { status: 'success', log: 'probe' };
fs.writeFileSync(path.join(runDir, 'tracker-data/ci.json'), JSON.stringify(ci));
const stale = tracker('merge', '--match-head', '0'.repeat(40));
expect('merge with a stale expected head is refused', stale.code !== 0, stale.out);
const m1 = tracker('merge', '--match-head', head), m2 = tracker('merge', '--match-head', head);
expect('a repeated merge after an interruption is refused (already merged)', m1.code === 0 && m2.code !== 0, m2.out);
const second = path.join(runDir, 'second-agent');
const wt = sh('git', ['worktree', 'add', second, 'feature/1-slugify']);
expect('Git refuses a second worktree on the same Issue branch', wt.code !== 0, wt.out);
const out = { at: new Date().toISOString(), results, allOk: results.every((r) => r.ok) };
console.log(JSON.stringify(out, null, 1));
