// #1867 review M-3: the check before each stage after the generation (the gate count, layer 1, the owner page, layer 2,
// the decision). No model call.
//   node docs/evidence/1867-design-persona/harness/stage-check.mjs <stage> --fixed-commit <commit> --log <stage-checks.jsonl>
// It runs, from the repository root:
//   1. node docs/evidence/shared-harness/fixation.mjs check <config>/results/fixation.json --config <config>
//   2. git diff --exit-code <commit> -- <TOOLS> and no untracked file under them (git status --porcelain)
//   3. the sha256 of #1835 prompts/ against config/layers/eval.json prompts
// and appends one JSON line to --log ({stage, at, head, fixedCommit, fixation, diff, prompts, ok}). Exit 1 when any fails;
// the stage is then not run.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, '../../../..');
export const CONFIG = 'docs/evidence/1867-design-persona/config';
export const STAGES = ['gate', 'layer1', 'owner-page', 'layer2', 'decide'];
export const TOOLS = ['docs/evidence/1867-design-persona/harness', 'docs/evidence/1835-design-eval-layers/harness', 'docs/evidence/1835-design-eval-layers/prompts',
  'docs/evidence/1804-design-judgment/gold.json', 'docs/evidence/1815-design-judgment/cases.json'];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// eval.json prompts: {note, <file>: sha256}; every listed file of promptsDir must have that sha256.
export function promptProblems(prompts, promptsDir) {
  const out = [];
  for (const [f, want] of Object.entries(prompts).filter(([k]) => k !== 'note')) {
    const p = path.join(promptsDir, f);
    if (!fs.existsSync(p)) { out.push(`${f}: missing`); continue; }
    const got = sha(fs.readFileSync(p));
    if (got !== want) out.push(`${f}: ${got} != ${want}`);
  }
  return out;
}

const run = (cmd, args) => { const r = spawnSync(cmd, args, {cwd: REPO, encoding: 'utf8'}); return {code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 2000)}; };

export function stageCheck({stage, fixedCommit}) {
  if (!STAGES.includes(stage)) throw new Error(`stage must be one of ${STAGES.join(', ')}`);
  if (!/^[0-9a-f]{7,40}$/.test(fixedCommit ?? '')) throw new Error('--fixed-commit <commit> is required');
  const fx = run(process.execPath, ['docs/evidence/shared-harness/fixation.mjs', 'check', `${CONFIG}/results/fixation.json`, '--config', CONFIG]);
  const diff = run('git', ['diff', '--exit-code', '--stat', fixedCommit, '--', ...TOOLS]);
  const untracked = run('git', ['status', '--porcelain', '--untracked-files=all', '--', ...TOOLS]);
  const cfg = JSON.parse(fs.readFileSync(path.join(REPO, CONFIG, 'layers/eval.json'), 'utf8'));
  const pp = promptProblems(cfg.prompts, path.join(REPO, 'docs/evidence/1835-design-eval-layers/prompts'));
  const rec = {stage, at: new Date().toISOString(), head: run('git', ['rev-parse', 'HEAD']).out, fixedCommit,
    fixation: {ok: fx.code === 0, out: fx.out}, diff: {ok: diff.code === 0 && untracked.out === '', changed: diff.out, untracked: untracked.out},
    prompts: {ok: pp.length === 0, problems: pp}};
  rec.ok = rec.fixation.ok && rec.diff.ok && rec.prompts.ok;
  return rec;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2), opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
  try {
    if (!opt('--log')) throw new Error('--log <stage-checks.jsonl> is required');
    const rec = stageCheck({stage: a[0], fixedCommit: opt('--fixed-commit')});
    fs.appendFileSync(path.resolve(opt('--log')), JSON.stringify(rec) + '\n');
    console.log(JSON.stringify({stage: rec.stage, ok: rec.ok, fixation: rec.fixation.ok, diff: rec.diff.ok, prompts: rec.prompts.ok}));
    if (!rec.ok) process.exitCode = 1;
  } catch (e) { console.error(e.message); process.exit(2); }
}
