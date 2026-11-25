// #1820: adapted from docs/evidence/1817-skill-application/harness/dry-run.mjs. End-to-end dry run without any model
// call: builds fixtures A (app repo) and D (design folder) from the pinned release tarball (make-fixture.mjs), checks each
// install record (pinned release, 16 entries verified, read trigger adopted), CLAUDE.md (A: the unchanged base, then the
// adopted block; D: the adopted block only), the files each prompt names, placement, applies the neutral commit to a copy
// (as run-trial does), and prints the launch command of every probe and planned trial (cell, case, rep, prompt, flags)
// with the --settings content of one trial. Output has no absolute local paths: the root is written as <scratch>.
// Review fixes: each probe's step list (run-trial.mjs probeSteps) has the count of conditions.json probeSteps and fits
// probeMaxTurns; the --settings example is also shown for a fixture-D trial (its fixture is denied); the plan of the
// pre-written drop of X (8 cells, 44 trials) is checked against run-order.json.
// Usage: node dry-run.mjs <new-scratch-root> --tarball <tgz> [--ledger <file>] [--allow-unreleased] [--out <json>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {makeFixture, pinned, loadConditions} from './make-fixture.mjs';
import {applyCondition, applyDrop, NEUTRAL_SUBJECT} from './apply-condition.mjs';
import {ASC_SKILLS} from './score.mjs';
import {placementProblems} from './guard.mjs';
import {flags, BUDGET, SAFETY_MARGIN_USD, cellOf, promptFor, isolationSettings, probeContext, probeSteps} from './run-trial.mjs';
import {plannedTrials, orderProblems, loadOrder} from './order.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ev = path.resolve(here, '..');
const repoRoot = path.resolve(ev, '../../..');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const OPEN = '<!-- asc:read-trigger v1 -->', CLOSE = '<!-- /asc:read-trigger -->';
// Planning cost per trial: #1817 measured 0.085 USD per full trial (mean) and two turns are about 0.05 by its token
// shares; planned at 0.08 per trial and 0.2 per probe (the probes run more turns: up to 19 steps; #1817 probes of 8
// steps cost 0.066 and 0.084).
export const PLAN = {perTrialUsd: 0.08, probeUsd: 0.2};

export function claudeMdProblems(md, base) {
  const p = [];
  if (base && !md.startsWith(base)) p.push('CLAUDE.md does not start with the unchanged base');
  if (!base && !md.startsWith(OPEN)) p.push('CLAUDE.md is not the adopted block only');
  const i = md.indexOf(OPEN), j = md.indexOf(CLOSE);
  if (i < 0 || j < i) p.push('CLAUDE.md has no adopted read-trigger block');
  if (md.split(OPEN).length !== 2) p.push('CLAUDE.md has not exactly one adopted block');
  if (!base && md.slice(j + CLOSE.length).trim()) p.push('CLAUDE.md has text after the block');
  return p;
}

export function trialPlan(conds = loadConditions(), spec = JSON.parse(fs.readFileSync(path.join(ev, 'cases.json'), 'utf8'))) {
  const planned = plannedTrials(loadOrder(), conds, spec);
  const probes = conds.probeCells.map((c) => ({condition: c, case: 'probe', rep: 1, name: `${c}-probe-1`}));
  const byCell = Object.fromEntries(Object.keys(conds.cells).map((c) => [c, planned.filter((t) => t.condition === c).length]));
  const usd = Number((planned.length * PLAN.perTrialUsd + probes.length * PLAN.probeUsd).toFixed(2));
  return {probes, planned, byCell, plannedTrials: planned.length, positives: planned.filter((t) => t.case === 'brief').length, negatives: planned.filter((t) => t.case !== 'brief').length,
    planningUsd: usd, stopLineUsd: BUDGET.capUsd - SAFETY_MARGIN_USD, ownerCapUsd: BUDGET.ownerCapUsd,
    breakEvenPerTrialUsd: Number(((BUDGET.capUsd - SAFETY_MARGIN_USD - BUDGET.perTrialUsd - probes.length * PLAN.probeUsd) / (planned.length - 1)).toFixed(3)),
    byLevel: Object.fromEntries([...new Set(Object.values(conds.cells).map((c) => c.tools))].map((lv) => [lv, planned.filter((t) => conds.cells[t.condition].tools === lv).length]))};
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const root = path.resolve(args[0]);
  if (fs.existsSync(root)) throw new Error(`refused: exists ${root}`);
  const allowUnreleased = args.includes('--allow-unreleased');
  const tarball = path.resolve(opt('--tarball', ''));
  const ledger = path.resolve(opt('--ledger', path.join(root, 'ledger', 'ledger.jsonl')));
  const spec = JSON.parse(fs.readFileSync(path.join(ev, 'cases.json'), 'utf8'));
  const conds = loadConditions();
  const report = {label: 'dry run (no model call)', allowUnreleased, checks: {}, fixtures: {}, copies: {}};
  const add = (k, pass, detail = null) => { report.checks[k] = {pass: Boolean(pass), detail}; };
  const digest = sha(fs.readFileSync(tarball));
  const fixtures = {};
  for (const f of Object.keys(conds.fixtures)) {
    fs.mkdirSync(path.join(root, 'tmp', f), {recursive: true});
    const dir = path.join(root, `fixture-${f}`);
    const built = makeFixture(f, tarball, digest, dir, path.join(root, 'tmp', f), {allowUnreleased});
    fixtures[f] = dir;
    const md = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    const def = conds.fixtures[f];
    const named = def.kind === 'app' ? ['docs/BRIEF.md', 'src/validate.ts'] : [...Object.keys(def.files), ...(def.emptyDirs ?? [])];
    const row = {fixture: f, kind: def.kind, source: built.source, pinned: built.pinned, tarballSha256: built.install.tarballSha256, packageVersion: built.install.packageVersion,
      runtimeVersion: built.install.runtimeVersion, sources: built.sources, entries: built.install.entries.length, entryProblems: built.install.problems, adopted: built.install.adopted?.id ?? null,
      adoptedAction: built.install.adopted?.action ?? null, claudeMdSha256: sha(md), claudeMdProblems: claudeMdProblems(md, def.baseClaudeMd),
      scorerSkillsMatchRelease: JSON.stringify([...ASC_SKILLS].sort()) === JSON.stringify(built.install.distributed),
      ascBodyPresent: fs.existsSync(path.join(dir, '.agent-skill-chain/skills/asc/SKILL.md')), readmePresent: fs.existsSync(path.join(dir, '.agent-skill-chain/skills/README.md')),
      promptFilesExist: named.every((n) => fs.existsSync(path.join(dir, n))), placement: placementProblems(dir, {repoRoot})};
    row.ok = row.source === (allowUnreleased ? 'unpinned' : 'release') && row.entries === ASC_SKILLS.length && row.entryProblems.length === 0 && row.adopted === conds.adopt
      && row.claudeMdProblems.length === 0 && row.scorerSkillsMatchRelease && row.ascBodyPresent && row.readmePresent && row.promptFilesExist && row.placement.length === 0;
    report.fixtures[f] = row;
    const copy = path.join(root, 'copies', f, 'work');
    fs.cpSync(dir, copy, {recursive: true});
    const a = applyCondition(copy);
    const subjects = spawnSync('git', ['log', '--format=%s'], {cwd: copy, encoding: 'utf8'}).stdout.trim().split('\n');
    report.copies[f] = {applied: a, commitSubjects: subjects, ok: a.changedFiles.length === 0 && subjects[0] === NEUTRAL_SUBJECT && placementProblems(copy, {repoRoot}).length === 0};
  }
  const pin = pinned();
  add('pinnedRelease', !allowUnreleased && digest === pin.assetSha256, {tag: pin.tag});
  add('fixturesInstalled', Object.values(report.fixtures).every((r) => r.ok), Object.fromEntries(Object.entries(report.fixtures).map(([k, r]) => [k, r.ok])));
  add('neutralCommitInCopies', Object.values(report.copies).every((c) => c.ok));
  add('sameCommitSubjects', new Set(Object.values(report.copies).map((c) => JSON.stringify(c.commitSubjects))).size === 1, report.copies.A.commitSubjects);
  add('sameInstalledSkills', new Set(Object.values(report.fixtures).map((r) => r.runtimeVersion)).size === 1);
  add('runOrder', orderProblems(loadOrder(), spec, conds).length === 0, orderProblems(loadOrder(), spec, conds));
  const plan = trialPlan(conds, spec);
  // The launch command of every probe and planned trial, as run-trial.mjs builds it (paths relative to the trial dir).
  const command = (t) => {
    const cell = cellOf(t.condition, conds);
    const probe = t.case === 'probe';
    const k = spec.cases.find((c) => c.id === t.case);
    return {trial: t.name, cell: t.condition, tools: cell.tools, prompt: probe || k.kind === 'negative' ? null : cell.prompt, fixture: cell.fixture,
      promptText: probe ? '<probe prompt of the tools level>' : promptFor(cell, k, conds),
      argv: ['claude', '-p', '<promptText>', ...flags({level: cell.level, model: conds.model, budget: probe ? BUDGET.probeUsd : BUDGET.perTrialUsd, maxTurns: probe ? conds.probeMaxTurns : conds.maxTurns, settingsFile: 'settings.json', debugFile: probe ? 'debug.log' : null})].join(' ')};
  };
  report.launch = [...plan.probes, ...plan.planned].map(command);
  const runsRoot = path.join(root, 'runs');
  report.settingsExample = isolationSettings({work: path.join(runsRoot, plan.planned[0].name, 'work'), runsRoot, fixture: fixtures.A, ledger});
  const firstD = plan.planned.find((t) => conds.cells[t.condition].fixture === 'D');
  report.settingsExampleD = isolationSettings({work: path.join(runsRoot, firstD.name, 'work'), runsRoot, fixture: fixtures.D, ledger});
  add('fixtureDDenied', report.settingsExampleD.sandbox.filesystem.denyRead.includes(fs.realpathSync(fixtures.D)) && report.settingsExampleD.sandbox.filesystem.denyWrite.includes(fs.realpathSync(fixtures.D)), firstD.name);
  // The probe steps of each probe cell (paths of this dry run; markers stand in as <home-marker>/<repo-marker>).
  report.probeSteps = Object.fromEntries(plan.probes.map((t) => {
    const ctx = probeContext({dir: path.join(runsRoot, t.name), runsRoot, fixture: fixtures.A, ledger, homeMarker: path.join(root, 'home-marker'), repoMarker: path.join(root, 'repo-marker')});
    const steps = probeSteps(cellOf(t.condition, conds).tools, ctx);
    return [t.name, {count: steps.length, expected: conds.probeSteps[cellOf(t.condition, conds).tools], steps: steps.map((st) => `${st.id} ${st.tool} ${st.expect}`)}];
  }));
  add('probeStepsCounted', Object.values(report.probeSteps).every((x) => x.count === x.expected && x.count + 2 <= conds.probeMaxTurns), Object.fromEntries(Object.entries(report.probeSteps).map(([k, x]) => [k, x.count])));
  // The pre-written drop of X (conditions.json dropNote): 8 cells, the order without the X entries.
  const dropped = applyDrop(conds, 'X');
  const dropPlan = trialPlan(dropped, spec);
  report.dropX = {cells: Object.keys(dropped.cells), plannedTrials: dropPlan.plannedTrials, positives: dropPlan.positives, negatives: dropPlan.negatives, probeCells: dropped.probeCells, orderProblems: orderProblems(loadOrder(), spec, dropped)};
  add('dropXPlan', report.dropX.cells.length === 8 && report.dropX.plannedTrials === 44 && report.dropX.orderProblems.length === 0, {cells: 8, trials: dropPlan.plannedTrials});
  add('everyCellLaunched', Object.keys(conds.cells).every((c) => report.launch.some((l) => l.cell === c && /--max-turns 2 /.test(l.argv))));
  add('levelFlags', report.launch.every((l) => l.argv.includes(`--tools ${conds.toolLevels[l.tools].tools} `) && (conds.toolLevels[l.tools].permissionMode ? l.argv.includes(`--permission-mode ${conds.toolLevels[l.tools].permissionMode}`) : !l.argv.includes('--permission-mode'))));
  report.plan = {...plan, probes: plan.probes.map((t) => t.name), planned: undefined};
  report.pass = Object.values(report.checks).every((c) => c.pass);
  const text = JSON.stringify(report, null, 1).split(root).join('<scratch>').split(path.dirname(ledger)).join('<ledger-dir>');
  if (opt('--out', null)) fs.writeFileSync(opt('--out', null), text + '\n');
  console.log(JSON.stringify({pass: report.pass, checks: Object.fromEntries(Object.entries(report.checks).map(([k, v]) => [k, v.pass])),
    plannedTrials: plan.plannedTrials, positives: plan.positives, negatives: plan.negatives, probes: plan.probes.length, planningUsd: plan.planningUsd, stopLineUsd: plan.stopLineUsd}));
  for (const l of report.launch) console.log(`${l.trial}\t${l.argv.split(root).join('<scratch>')}\t${l.promptText}`);
  process.exit(report.pass ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
