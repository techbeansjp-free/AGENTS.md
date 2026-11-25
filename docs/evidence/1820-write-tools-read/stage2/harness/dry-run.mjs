// #1820 stage 2: adapted from ../../harness/dry-run.mjs (stage 1). End-to-end dry run without any model call: builds the
// eight fixtures (conditions B and S x fixtures A, D3, D4, D7) from the two pinned tarballs (make-fixture.mjs), checks each
// install record (pinned tarball of its condition, 16 entries verified, read trigger adopted), CLAUDE.md (A: the unchanged
// base, then the adopted block; D: the adopted block only), the files the prompts name, placement, applies the neutral
// commit to a copy (as run-trial does), and compares B with S:
// - the adopted CLAUDE.md block differs only in its first sentence (conditions.json candidateText), in every fixture;
// - the installed .claude/skills/asc/SKILL.md descriptions are the B and S texts, the rest of that entry and the other 15
//   entries are byte-identical;
// - the installed project files differ only in the expected set (installedDiffExpected).
// It checks the stage-1 spend against the stage-1 published ledger (run-trial.mjs stage1Problems) and prints the launch
// command of every probe and planned trial with the --settings content of a fixture A and a fixture D trial. Output has
// no absolute local paths: the root is written as <scratch>, the ledger directory as <ledger-dir>.
// Usage: node dry-run.mjs <new-scratch-root> --tarball-B <tgz> --tarball-S <tgz> [--ledger <file>] [--allow-unreleased] [--out <json>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {makeFixture, pinned, loadConditions} from './make-fixture.mjs';
import {applyCondition, NEUTRAL_SUBJECT} from './apply-condition.mjs';
import {ASC_SKILLS} from './score.mjs';
import {placementProblems} from './guard.mjs';
import {flags, BUDGET, STOP_LINE_USD, cellOf, promptFor, maxTurnsFor, isolationSettings, probeContext, probeSteps, stage1Problems} from './run-trial.mjs';
import {plannedTrials, orderProblems, loadOrder} from './order.mjs';
import {fixtureDir} from './run-all.mjs';
import {description} from './probe-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ev = path.resolve(here, '..');
const repoRoot = path.resolve(ev, '../../../..');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const OPEN = '<!-- asc:read-trigger v1 -->', CLOSE = '<!-- /asc:read-trigger -->';
// Planning cost per trial (README「費用」): fixture A 0.12 USD (#1817 measured 0.085 mean and 0.141 max per full trial
// with read-only tools; the write tools can make asc-3 and ui-1 longer), design 0.15 USD (three messages; the third may
// write the page), probe 0.15 USD (the stage-1 W probe cost 0.121). Expected: A 0.085, design 0.10, probe 0.121.
export const PLAN = {appTrialUsd: 0.12, designTrialUsd: 0.15, probeUsd: 0.15};
export const EXPECT = {appTrialUsd: 0.085, designTrialUsd: 0.10, probeUsd: 0.121};
// Files of the installed sample project that may differ between B and S (the tarballs differ only in USAGE.md, the asc
// body and release-identity.json; the project copies and the managed-runtime copies of the first two, the entry, the
// record and CLAUDE.md follow from them).
export const INSTALLED_DIFF_EXPECTED = ['.agent-skill-chain/distribution.json', '.agent-skill-chain/managed-runtime/skills/asc/SKILL.md', '.agent-skill-chain/managed-runtime/v05/USAGE.md',
  '.agent-skill-chain/skills/asc/SKILL.md', '.agent-skill-chain/v05/USAGE.md', '.claude/skills/asc/SKILL.md', 'CLAUDE.md'];

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

// The text between the delimiters of the adopted block (without the delimiter lines).
export const blockText = (md) => { const i = md.indexOf(OPEN), j = md.indexOf(CLOSE); return i < 0 || j < i ? null : md.slice(i + OPEN.length, j).replace(/^\r?\n/, '').replace(/\r?\n$/, ''); };

// B and S blocks differ only in the first sentence: each starts with its own first sentence and the rest is identical; the
// text before and after the blocks (the base CLAUDE.md, the delimiters) is identical too.
export function firstSentenceDiff(mdB, mdS, texts) {
  const b = blockText(mdB), s = blockText(mdS);
  const p = [];
  if (b === null || s === null) return {pass: false, problems: ['no adopted block']};
  if (!b.startsWith(texts.B)) p.push('the B block does not start with the B first sentence');
  if (!s.startsWith(texts.S)) p.push('the S block does not start with the S first sentence');
  const restB = b.slice(texts.B.length), restS = s.slice(texts.S.length);
  if (restB !== restS) p.push('the blocks differ after the first sentence');
  if (!restB.trim()) p.push('the blocks have nothing after the first sentence');
  if (mdB.split(b).join('<block>') !== mdS.split(s).join('<block>')) p.push('CLAUDE.md differs outside the block text');
  return {pass: p.length === 0, problems: p, restSha256: sha(restB), restChars: restB.length};
}

// Files under a project (without .git), as relative paths.
export function projectFiles(dir) {
  const out = [];
  const walk = (d, rel) => { for (const e of fs.readdirSync(d, {withFileTypes: true})) { if (e.name === '.git') continue; const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(path.join(d, e.name), r); else if (e.isFile()) out.push(r); } };
  walk(dir, '');
  return out.sort();
}
export function installedDiff(dirB, dirS) {
  const fb = projectFiles(dirB), fs2 = projectFiles(dirS);
  const all = [...new Set([...fb, ...fs2])].sort();
  return all.filter((f) => !fb.includes(f) || !fs2.includes(f) || !fs.readFileSync(path.join(dirB, f)).equals(fs.readFileSync(path.join(dirS, f))));
}

export function trialPlan(conds = loadConditions(), spec = JSON.parse(fs.readFileSync(path.join(ev, 'cases.json'), 'utf8'))) {
  const planned = plannedTrials(loadOrder(), conds.runs);
  const probes = conds.probeCells.map((c) => ({condition: c, case: 'probe', rep: 1, name: `${c}-probe-1`}));
  const kind = (t) => spec.cases.find((k) => k.id === t.case).kind;
  const count = (f) => planned.filter(f).length;
  const app = count((t) => kind(t) !== 'design'), design = count((t) => kind(t) === 'design');
  const usd = (u) => Number((app * u.appTrialUsd + design * u.designTrialUsd + probes.length * u.probeUsd).toFixed(2));
  return {probes, planned, plannedTrials: planned.length, byCondition: Object.fromEntries(Object.keys(conds.cells).map((c) => [c, count((t) => t.condition === c)])),
    positivesA: count((t) => ['asc', 'purpose'].includes(kind(t))), design, negatives: count((t) => kind(t) === 'negative'),
    planningUsd: usd(PLAN), expectedUsd: usd(EXPECT), stopLineUsd: STOP_LINE_USD, ownerCapUsd: BUDGET.ownerCapUsd, stage1SpentUsd: BUDGET.stage1SpentUsd,
    bothStagesAtMostUsd: Number((BUDGET.stage1SpentUsd + STOP_LINE_USD).toFixed(4)),
    breakEvenPerTrialUsd: Number(((STOP_LINE_USD - BUDGET.perTrialUsd - probes.length * PLAN.probeUsd) / (planned.length - 1)).toFixed(3))};
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const root = path.resolve(args[0]);
  if (fs.existsSync(root)) throw new Error(`refused: exists ${root}`);
  const allowUnreleased = args.includes('--allow-unreleased');
  const tarballs = {B: path.resolve(opt('--tarball-B', '')), S: path.resolve(opt('--tarball-S', ''))};
  const ledger = path.resolve(opt('--ledger', path.join(root, 'ledger', 'ledger.jsonl')));
  const spec = JSON.parse(fs.readFileSync(path.join(ev, 'cases.json'), 'utf8'));
  const conds = loadConditions();
  const report = {label: 'dry run (no model call)', allowUnreleased, checks: {}, fixtures: {}, copies: {}};
  const add = (k, pass, detail = null) => { report.checks[k] = {pass: Boolean(pass), detail}; };
  const digests = Object.fromEntries(Object.entries(tarballs).map(([c, t]) => [c, sha(fs.readFileSync(t))]));
  const fixturesRoot = path.join(root, 'fixtures');
  const dirs = {};
  for (const c of Object.keys(conds.cells)) for (const f of Object.keys(conds.fixtures)) {
    const id = `${c}-${f}`;
    fs.mkdirSync(path.join(root, 'tmp', id), {recursive: true});
    const dir = fixtureDir(fixturesRoot, c, f);
    const built = makeFixture(c, f, tarballs[c], digests[c], dir, path.join(root, 'tmp', id), {allowUnreleased});
    dirs[id] = dir;
    const md = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    const def = conds.fixtures[f];
    const named = def.kind === 'app' ? ['docs/BRIEF.md', 'docs/requirements.md', 'src/validate.ts', 'src/users.ts', 'public/users.html'] : [...Object.keys(def.files), ...(def.emptyDirs ?? [])];
    const row = {condition: c, fixture: f, kind: def.kind, source: built.source, pinned: built.pinned, tarballSha256: built.install.tarballSha256, packageVersion: built.install.packageVersion,
      runtimeVersion: built.install.runtimeVersion, sources: built.sources, entries: built.install.entries.length, entryProblems: built.install.problems, adopted: built.install.adopted?.id ?? null,
      adoptedAction: built.install.adopted?.action ?? null, blockSha256: built.install.adopted?.blockSha256 ?? null, claudeMdSha256: sha(md), claudeMdProblems: claudeMdProblems(md, def.baseClaudeMd),
      scorerSkillsMatchRelease: JSON.stringify([...ASC_SKILLS].sort()) === JSON.stringify(built.install.distributed),
      ascBodyPresent: fs.existsSync(path.join(dir, '.agent-skill-chain/skills/asc/SKILL.md')), referencesPresent: ['implementation.md', 'workspace.md'].every((r) => fs.existsSync(path.join(dir, '.agent-skill-chain/skills/asc/references', r))),
      promptFilesExist: named.every((n) => fs.existsSync(path.join(dir, n))), placement: placementProblems(dir, {repoRoot})};
    const wantSource = allowUnreleased ? 'unpinned' : pinned(c).kind;
    row.ok = row.source === wantSource && row.entries === ASC_SKILLS.length && row.entryProblems.length === 0 && row.adopted === conds.adopt
      && row.claudeMdProblems.length === 0 && row.scorerSkillsMatchRelease && row.ascBodyPresent && row.referencesPresent && row.promptFilesExist && row.placement.length === 0;
    report.fixtures[id] = row;
    const copy = path.join(root, 'copies', id, 'work');
    fs.cpSync(dir, copy, {recursive: true});
    const a = applyCondition(copy);
    const subjects = spawnSync('git', ['log', '--format=%s'], {cwd: copy, encoding: 'utf8'}).stdout.trim().split('\n');
    report.copies[id] = {applied: a, commitSubjects: subjects, ok: a.changedFiles.length === 0 && subjects[0] === NEUTRAL_SUBJECT && placementProblems(copy, {repoRoot}).length === 0};
  }
  add('pinnedTarballs', !allowUnreleased && Object.keys(tarballs).every((c) => digests[c] === pinned(c)?.assetSha256), Object.fromEntries(Object.keys(tarballs).map((c) => [c, pinned(c)?.kind ?? null])));
  add('fixturesInstalled', Object.values(report.fixtures).every((r) => r.ok), Object.fromEntries(Object.entries(report.fixtures).map(([k, r]) => [k, r.ok])));
  add('neutralCommitInCopies', Object.values(report.copies).every((c) => c.ok));
  add('sameCommitSubjects', new Set(Object.values(report.copies).map((c) => JSON.stringify(c.commitSubjects))).size === 1, report.copies['B-A'].commitSubjects);
  add('sameRuntimeVersion', new Set(Object.values(report.fixtures).map((r) => r.runtimeVersion)).size === 1, report.fixtures['B-A'].runtimeVersion);
  // B against S, per fixture: the CLAUDE.md block, the asc entry and the other entries, the installed files.
  const texts = conds.candidateText;
  report.compare = {};
  for (const f of Object.keys(conds.fixtures)) {
    const b = dirs[`B-${f}`], s = dirs[`S-${f}`];
    const md = (d) => fs.readFileSync(path.join(d, 'CLAUDE.md'), 'utf8');
    const entry = (d, n) => fs.readFileSync(path.join(d, '.claude/skills', n, 'SKILL.md'), 'utf8');
    const descB = description(entry(b, 'asc')), descS = description(entry(s, 'asc'));
    const others = ASC_SKILLS.filter((n) => n !== 'asc' && entry(b, n) !== entry(s, n));
    const ascRest = entry(b, 'asc').replace(/^description: .*$/m, '') === entry(s, 'asc').replace(/^description: .*$/m, '');
    report.compare[f] = {readTrigger: firstSentenceDiff(md(b), md(s), texts.readTriggerFirstSentence),
      ascDescription: {B: descB, S: descS, pass: descB === texts.ascDescription.B && descS === texts.ascDescription.S && ascRest, entryOtherwiseSame: ascRest},
      otherEntriesDiffer: others, installedDiff: installedDiff(b, s)};
  }
  add('readTriggerFirstSentenceOnly', Object.values(report.compare).every((x) => x.readTrigger.pass), Object.fromEntries(Object.entries(report.compare).map(([f, x]) => [f, x.readTrigger.problems])));
  add('ascDescriptionAsIntended', Object.values(report.compare).every((x) => x.ascDescription.pass && x.otherEntriesDiffer.length === 0), {B: texts.ascDescription.B, S: texts.ascDescription.S});
  add('installedDiffExpected', Object.values(report.compare).every((x) => x.installedDiff.every((p) => INSTALLED_DIFF_EXPECTED.includes(p)) && ['CLAUDE.md', '.claude/skills/asc/SKILL.md'].every((p) => x.installedDiff.includes(p))),
    Object.fromEntries(Object.entries(report.compare).map(([f, x]) => [f, x.installedDiff])));
  add('runOrder', orderProblems(loadOrder(), spec, conds).length === 0, orderProblems(loadOrder(), spec, conds));
  add('stage1Spend', stage1Problems().length === 0, stage1Problems());
  const plan = trialPlan(conds, spec);
  add('budgetBothStages', plan.bothStagesAtMostUsd <= BUDGET.ownerCapUsd && plan.planningUsd <= plan.stopLineUsd, {stage1: plan.stage1SpentUsd, stopLine: plan.stopLineUsd, both: plan.bothStagesAtMostUsd, planning: plan.planningUsd});
  // The launch command of every probe and planned trial, as run-trial.mjs builds it (paths relative to the trial dir).
  const command = (t) => {
    const cell = cellOf(t.condition, conds);
    const probe = t.case === 'probe';
    const k = probe ? {id: 'probe'} : spec.cases.find((c) => c.id === t.case);
    const maxTurns = maxTurnsFor(k, conds);
    return {trial: t.name, condition: t.condition, case: t.case, kind: probe ? 'probe' : k.kind, fixture: probe ? 'A' : k.fixture, maxTurns,
      promptText: probe ? '<probe prompt of level W>' : promptFor(k),
      argv: ['claude', '-p', '<promptText>', ...flags({level: cell.level, model: conds.model, budget: probe ? BUDGET.probeUsd : BUDGET.perTrialUsd, maxTurns, settingsFile: 'settings.json', debugFile: probe ? 'debug.log' : null})].join(' ')};
  };
  report.launch = [...plan.probes, ...plan.planned].map(command);
  add('maxTurns', report.launch.every((l) => (l.kind === 'probe' ? l.argv.includes(`--max-turns ${conds.probeMaxTurns} `) : l.kind === 'design' ? l.argv.includes(`--max-turns ${conds.maxTurnsByKind.design} `) : !l.argv.includes('--max-turns'))),
    {probe: conds.probeMaxTurns, design: conds.maxTurnsByKind.design, app: 'none'});
  add('levelFlags', report.launch.every((l) => l.argv.includes(`--tools ${conds.toolLevels.W.tools} `) && l.argv.includes(`--disallowedTools ${conds.toolLevels.W.disallowed} `) && l.argv.includes('--permission-mode acceptEdits') && l.argv.includes('--settings settings.json')));
  const runsRoot = path.join(root, 'runs');
  const firstA = plan.planned[0], firstD = plan.planned.find((t) => spec.cases.find((k) => k.id === t.case).kind === 'design');
  const fxOf = (t) => fixtureDir(fixturesRoot, t.condition, spec.cases.find((k) => k.id === t.case).fixture);
  report.settingsExampleA = {trial: firstA.name, settings: isolationSettings({work: path.join(runsRoot, firstA.name, 'work'), runsRoot, fixture: fxOf(firstA), ledger})};
  report.settingsExampleD = {trial: firstD.name, settings: isolationSettings({work: path.join(runsRoot, firstD.name, 'work'), runsRoot, fixture: fxOf(firstD), ledger})};
  add('fixtureDenied', [report.settingsExampleA, report.settingsExampleD].every((x, i) => { const fx = fs.realpathSync(fxOf([firstA, firstD][i])); return x.settings.sandbox.filesystem.denyRead.includes(fx) && x.settings.sandbox.filesystem.denyWrite.includes(fx); }), [firstA.name, firstD.name]);
  report.probeSteps = Object.fromEntries(plan.probes.map((t) => {
    const ctx = probeContext({dir: path.join(runsRoot, t.name), runsRoot, fixture: dirs[`${t.condition}-A`], ledger, homeMarker: path.join(root, 'home-marker'), repoMarker: path.join(root, 'repo-marker')});
    const steps = probeSteps(cellOf(t.condition, conds).tools, ctx);
    return [t.name, {count: steps.length, expected: conds.probeSteps.W, steps: steps.map((st) => `${st.id} ${st.tool} ${st.expect}`)}];
  }));
  add('probeStepsCounted', Object.values(report.probeSteps).every((x) => x.count === x.expected && x.count + 2 <= conds.probeMaxTurns), Object.fromEntries(Object.entries(report.probeSteps).map(([k, x]) => [k, x.count])));
  report.plan = {...plan, probes: plan.probes.map((t) => t.name), planned: undefined};
  report.pass = Object.values(report.checks).every((c) => c.pass);
  const text = JSON.stringify(report, null, 1).split(root).join('<scratch>').split(path.dirname(ledger)).join('<ledger-dir>');
  if (opt('--out', null)) fs.writeFileSync(opt('--out', null), text + '\n');
  console.log(JSON.stringify({pass: report.pass, checks: Object.fromEntries(Object.entries(report.checks).map(([k, v]) => [k, v.pass])),
    plannedTrials: plan.plannedTrials, positivesA: plan.positivesA, design: plan.design, negatives: plan.negatives, probes: plan.probes.length,
    planningUsd: plan.planningUsd, expectedUsd: plan.expectedUsd, stopLineUsd: plan.stopLineUsd, bothStagesAtMostUsd: plan.bothStagesAtMostUsd}));
  for (const l of report.launch) console.log(`${l.trial}\t${l.argv.split(root).join('<scratch>')}\t${l.promptText}`);
  process.exit(report.pass ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
