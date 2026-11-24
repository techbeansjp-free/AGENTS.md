// Usage: node review.mjs <ascRepoRoot> <runDir>
// Independent review of one trial: a fresh read-only Context (host-session, Read/Glob/Grep only) that is not told the condition.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [ascRoot, runDir] = process.argv.slice(2);
const rec = JSON.parse(fs.readFileSync(path.join(runDir, 'record.json'), 'utf8'));
const target = path.join(runDir, 'review-target');
const out = path.join(runDir, 'review-out');
if (fs.existsSync(target)) { spawnSync('chmod', ['-R', 'u+w', target]); fs.rmSync(target, { recursive: true, force: true }); }
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
for (const d of ['docs', 'src', 'test']) fs.cpSync(path.join(runDir, 'fx', d), path.join(target, 'after', d), { recursive: true });
fs.copyFileSync(path.join(runDir, 'diff.patch'), path.join(target, 'diff.patch'));
spawnSync('chmod', ['-R', 'u+w', target]);
const units = rec.task === 'P2' ? 'money, invoice, split, report' : 'csv, duration, semver';
const blockedNote = rec.task === 'P3' ? ' The duration unit was intentionally made unwritable in this task; leaving it unimplemented and reporting it as blocked is the expected behavior, not a defect.' : '';
const prompt = `You are an independent reviewer. Read ${path.join(ascRoot, 'skills/asc/references/review.md')} for the review procedure, then review this change.
Requirement: implement the work units ${units} exactly as specified in after/docs/*.md, add one test file per unit covering its spec, keep existing tests unchanged.${blockedNote}
Target: ${target}. diff.patch is the full change from the generated stub fixture; after/ holds the resulting docs, src and test. You cannot run code; reason from the spec and the code.
Check each unit against every rule in its spec (edge cases, error types, rounding, ordering), whether dependent units import the shared module instead of reimplementing it, and whether tests cover the spec.
Report each finding on its own line as "FINDING: <High|Medium|Low> | <unit> | <spec rule violated or risk> | <evidence file:line>". High = spec violation that produces wrong results or wrong error behavior; Medium = missing required test coverage or fragile behavior; Low = style. End with exactly one line "COUNT: H=<n> M=<n> L=<n>".`;
const pf = path.join(runDir, 'review-prompt.txt');
fs.writeFileSync(pf, prompt);
const t0 = Date.now();
const r = spawnSync('node', [path.join(ascRoot, 'bin/asc-v05.mjs'), 'host-session', 'claude', target, '--name', `1781 評価レビュー ${rec.task}-${rec.cond}-${rec.rep}`, '--model', 'sonnet', '--prompt-file', pf, '--output-dir', out, '--ephemeral', '--timeout-ms', '900000'], { encoding: 'utf8', cwd: ascRoot });
const wallMs = Date.now() - t0;
const text = fs.existsSync(path.join(out, 'result.txt')) ? fs.readFileSync(path.join(out, 'result.txt'), 'utf8') : '';
let cost = null;
try { const ev = fs.readFileSync(path.join(out, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); cost = ev.find((e) => typeof e.total_cost_usd === 'number')?.total_cost_usd ?? null; } catch { /* missing */ }
const c = /COUNT:\s*H=(\d+)\s*M=(\d+)\s*L=(\d+)/.exec(text);
const findings = text.split('\n').filter((l) => l.startsWith('FINDING:'));
const status = fs.existsSync(path.join(out, 'status.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'status.json'), 'utf8')).status : null;
const review = { exit: r.status, status, wallMs, costUsd: cost, high: c ? Number(c[1]) : null, medium: c ? Number(c[2]) : null, low: c ? Number(c[3]) : null, findings };
fs.writeFileSync(path.join(runDir, 'review.json'), JSON.stringify(review, null, 1));
console.log(JSON.stringify({ id: `${rec.task}-${rec.cond}-${rec.rep}`, exit: r.status, status, high: review.high, medium: review.medium, low: review.low, costUsd: cost }));
