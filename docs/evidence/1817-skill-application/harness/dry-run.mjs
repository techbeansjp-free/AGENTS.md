// #1817: adapted from docs/evidence/1814-skill-invocation/harness/dry-run.mjs for the two conditions B and S.
// End-to-end dry run without any model call: for each condition, builds the sample project from that condition's tarball
// (make-fixture.mjs: the sha256 must be the one release.json pins for the condition unless --allow-unreleased), checks
// the install record (condition, source release/candidate, pinned, entries verified, adopted read trigger), that CLAUDE.md
// holds the adopted block with the USAGE pointer text after the unchanged base, that every gold Skill body and reference
// exists, placement, applies the condition to a copy (one neutral commit), and compares the two fixtures: the installed
// .agent-skill-chain/skills trees may differ only in skills/asc/SKILL.md and skills/estimate-and-scope/SKILL.md, and the
// S bodies must carry the two edits of commit 4c95f8d4 (B bodies must not). Lists the planned trials with the planning
// cost. Output has no absolute paths (public repository).
// Usage: node dry-run.mjs <new-scratch-root> --B <tarball> --S <tarball> [--allow-unreleased] [--label <text>] [--out <json>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {makeFixture, pinnedFor} from './make-fixture.mjs';
import {applyCondition, loadConditions, pointerText, NEUTRAL_SUBJECT} from './apply-condition.mjs';
import {ASC_SKILLS} from './score.mjs';
import {placementProblems} from './guard.mjs';
import {flags, SAFETY_MARGIN_USD, BUDGET} from './run-trial.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ev = path.resolve(here, '..');
const repoRoot = path.resolve(ev, '../../..');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
// Planning cost per trial (Host total_cost_usd): #1814 stage 3 (condition I, same tools and model) 2.32 USD / 28 trials
// = 0.083; planned at 0.1 with 0.1 per isolation probe.
export const PLAN = {perTrialUsd: 0.1, probeUsd: 0.1, runs: loadConditions().runs, capUsd: BUDGET.capUsd, safetyMarginUsd: SAFETY_MARGIN_USD};
// The two edits of commit 4c95f8d4 (one distinctive phrase each).
export const EDITS = {'asc/SKILL.md': '実装・修正・対応を求める依頼', 'estimate-and-scope/SKILL.md': '何を調べれば見積が確定するか'};
export const EXPECTED_SKILL_DIFF = Object.keys(EDITS).sort();
export const OPEN = '<!-- asc:read-trigger v1 -->', CLOSE = '<!-- /asc:read-trigger -->';

export function trialMatrix(spec, conds) {
  const names = Object.keys(conds.conditions);
  const phases = [
    {phase: 'isolation probe (one per condition, before the measurement)', conditions: names, cases: ['probe'], runs: 1},
    {phase: 'measurement (B and S interleaved per case and rep)', conditions: names, cases: spec.cases.map((c) => c.id), runs: PLAN.runs},
  ];
  for (const p of phases) {
    p.trials = p.conditions.length * p.cases.reduce((a, c) => a + (c === 'probe' ? 1 : p.runs), 0);
    p.planningUsd = Number((p.conditions.length * p.cases.reduce((a, c) => a + (c === 'probe' ? PLAN.probeUsd : p.runs * PLAN.perTrialUsd), 0)).toFixed(2));
  }
  return {phases, totalTrials: phases.reduce((a, p) => a + p.trials, 0), totalPlanningUsd: Number(phases.reduce((a, p) => a + p.planningUsd, 0).toFixed(2)), capUsd: PLAN.capUsd, stopBelowUsd: PLAN.capUsd - PLAN.safetyMarginUsd,
    breakEvenPerTrialUsd: Number(((PLAN.capUsd - PLAN.safetyMarginUsd - BUDGET.perTrialUsd) / (phases.reduce((a, p) => a + p.trials, 0) - 1)).toFixed(3))};
}

// Relative paths of all files under dir (no .git).
export function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => {
    const f = path.join(dir, e.name);
    if (e.name === '.git') return [];
    return e.isDirectory() ? listFiles(f, base) : [path.relative(base, f).split(path.sep).join('/')];
  }).sort();
}
export function treeDiff(a, b) {
  const fa = listFiles(a), fb = listFiles(b);
  const all = [...new Set([...fa, ...fb])].sort();
  return all.filter((f) => !fa.includes(f) || !fb.includes(f) || !fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))));
}

export function claudeMdProblems(md, base, pointer) {
  const p = [];
  if (!md.startsWith(base)) p.push('CLAUDE.md does not start with the unchanged base');
  const i = md.indexOf(OPEN), j = md.indexOf(CLOSE);
  if (i < 0 || j < i) p.push('CLAUDE.md has no adopted read-trigger block');
  else if (!md.slice(i, j).includes(pointer)) p.push('the adopted block does not hold the USAGE pointer text');
  if (md.split(OPEN).length !== 2) p.push('CLAUDE.md has not exactly one adopted block');
  return p;
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const root = path.resolve(args[0]);
  if (fs.existsSync(root)) throw new Error(`refused: exists ${root}`);
  const allowUnreleased = args.includes('--allow-unreleased');
  const spec = JSON.parse(fs.readFileSync(path.join(ev, 'cases.json'), 'utf8'));
  const conds = loadConditions();
  const names = Object.keys(conds.conditions);
  const report = {label: opt('--label', 'dry run'), allowUnreleased, checks: {}, fixtures: {}, conditions: {}};
  const add = (k, pass, detail = null) => { report.checks[k] = {pass: Boolean(pass), detail}; };
  const fixtures = {};
  for (const c of names) {
    const tarball = opt(`--${c}`, null);
    if (!tarball) throw new Error(`--${c} <tarball> is required`);
    fs.mkdirSync(path.join(root, 'tmp', c), {recursive: true});
    const digest = sha(fs.readFileSync(path.resolve(tarball)));
    const fixture = path.join(root, `sample-${c}`);
    const built = makeFixture(c, path.resolve(tarball), digest, fixture, path.join(root, 'tmp', c), {allowUnreleased});
    fixtures[c] = fixture;
    const pin = pinnedFor(c);
    const md = fs.readFileSync(path.join(fixture, 'CLAUDE.md'), 'utf8');
    const pointer = pointerText(fs.readFileSync(path.join(fixture, '.agent-skill-chain/v05/USAGE.md'), 'utf8'));
    const missing = [];
    for (const k of spec.cases) for (const s of [k.expect, ...(k.secondary ?? [])].filter(Boolean)) {
      if (!fs.existsSync(path.join(fixture, `.agent-skill-chain/skills/${s}/SKILL.md`))) missing.push(`${s}/SKILL.md`);
      if (!fs.existsSync(path.join(fixture, `.claude/skills/${s}/SKILL.md`))) missing.push(`entry ${s}`);
      if (s === k.expect) for (const r of k.references) if (!fs.existsSync(path.join(fixture, `.agent-skill-chain/skills/${s}/references/${r}`))) missing.push(`${s}/references/${r}`);
    }
    const named = ['src/users.ts', 'src/validate.ts', 'public/users.html', 'docs/requirements.md', 'docs/BRIEF.md'];
    const row = {condition: c, source: built.source, pinned: built.pinned, released: built.released, expectedSource: pin?.kind ?? null,
      tarballSha256: built.install.tarballSha256, packageVersion: built.install.packageVersion, runtimeVersion: built.install.runtimeVersion,
      entries: built.install.entries.length, entryProblems: built.install.problems, adopted: built.install.adopted,
      claudeMdSha256: sha(md), claudeMdProblems: claudeMdProblems(md, conds.baseClaudeMd, pointer), pointerSha256: sha(pointer),
      goldMissing: missing, scorerSkillsMatchRelease: JSON.stringify([...ASC_SKILLS].sort()) === JSON.stringify(built.install.distributed),
      promptFilesExist: named.every((f) => fs.existsSync(path.join(fixture, f))), placement: placementProblems(fixture, {repoRoot}),
      edits: Object.fromEntries(Object.entries(EDITS).map(([f, phrase]) => [f, fs.readFileSync(path.join(fixture, '.agent-skill-chain/skills', f), 'utf8').includes(phrase)]))};
    row.ok = row.source === row.expectedSource && row.pinned === !allowUnreleased && row.entries === ASC_SKILLS.length && row.entryProblems.length === 0
      && row.adopted?.id === conds.conditions[c].adopt && row.claudeMdProblems.length === 0 && row.goldMissing.length === 0
      && row.scorerSkillsMatchRelease && row.promptFilesExist && row.placement.length === 0
      && Object.values(row.edits).every((v) => v === (c === 'S'));
    report.fixtures[c] = row;
    // The condition is applied to a copy, as run-trial does.
    const copy = path.join(root, 'conditions', c, 'work');
    fs.cpSync(fixture, copy, {recursive: true});
    const a = applyCondition(copy, c);
    const subjects = spawnSync('git', ['log', '--format=%s'], {cwd: copy, encoding: 'utf8'}).stdout.trim().split('\n');
    const keptMd = fs.readFileSync(path.join(copy, 'CLAUDE.md'), 'utf8') === md;
    report.conditions[c] = {applied: a, claudeMdKept: keptMd, settings: fs.existsSync(path.join(copy, '.claude/settings.json')), commitSubjects: subjects,
      placement: placementProblems(copy, {repoRoot}), ok: keptMd && a.changedFiles.length === 0 && placementProblems(copy, {repoRoot}).length === 0};
  }
  add('fixturesInstalledAsPinned', names.every((c) => report.fixtures[c].ok), Object.fromEntries(names.map((c) => [c, report.fixtures[c].ok])));
  add('conditionsApplied', names.every((c) => report.conditions[c].ok));
  add('sameCommitSubjects', new Set(names.map((c) => JSON.stringify(report.conditions[c].commitSubjects))).size === 1 && report.conditions[names[0]].commitSubjects[0] === NEUTRAL_SUBJECT);
  add('sameClaudeMd', new Set(names.map((c) => report.fixtures[c].claudeMdSha256)).size === 1);
  // B and S: the installed Skill trees differ only in the two edited bodies; the rest of the project is reported.
  const skillsDiff = treeDiff(path.join(fixtures.B, '.agent-skill-chain/skills'), path.join(fixtures.S, '.agent-skill-chain/skills'));
  const projectDiff = treeDiff(fixtures.B, fixtures.S);
  report.bsDiff = {skills: skillsDiff, project: projectDiff,
    entriesDiffer: projectDiff.filter((f) => f.startsWith('.claude/')),
    distributionRecordDiffers: projectDiff.filter((f) => f === '.agent-skill-chain/distribution.json').length === 1};
  add('skillsDifferOnlyInEditedBodies', JSON.stringify(skillsDiff) === JSON.stringify(EXPECTED_SKILL_DIFF), skillsDiff);
  add('entriesIdentical', report.bsDiff.entriesDiffer.length === 0, report.bsDiff.entriesDiffer);
  // Whole project: the two bodies (and their managed-runtime copies) and the distribution record that hashes them.
  const expectedProject = ['.agent-skill-chain/distribution.json', ...EXPECTED_SKILL_DIFF.flatMap((f) => [`.agent-skill-chain/managed-runtime/skills/${f}`, `.agent-skill-chain/skills/${f}`])].sort();
  add('projectDiffersOnlyInEditedBodies', JSON.stringify(projectDiff) === JSON.stringify(expectedProject), projectDiff);
  report.plan = trialMatrix(spec, conds);
  report.command = ['claude', '-p', '<prompt>', ...flags({model: conds.model, budget: BUDGET.perTrialUsd})].join(' ');
  report.pass = Object.values(report.checks).every((c) => c.pass);
  const text = JSON.stringify(report, null, 1).split(root).join('<scratch>');
  if (opt('--out', null)) fs.writeFileSync(opt('--out', null), text + '\n');
  console.log(JSON.stringify({pass: report.pass, checks: Object.fromEntries(Object.entries(report.checks).map(([k, v]) => [k, v.pass])), bsDiff: report.bsDiff, totalTrials: report.plan.totalTrials, totalPlanningUsd: report.plan.totalPlanningUsd}));
  process.exit(report.pass ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
