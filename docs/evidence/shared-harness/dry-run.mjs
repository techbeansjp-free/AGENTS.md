// Shared harness: end-to-end dry run without any model call, from docs/evidence/1820-write-tools-read/stage2/harness/dry-run.mjs.
// Builds the fixtures of the config (every fixture the cases and the probe use) for each condition whose tarball is given
// (make-fixture.mjs; a placeholder condition cannot be built and is reported as pending), checks each install record
// (pinned tarball of its condition, the 16 entries verified, read trigger adopted), CLAUDE.md (an app fixture: the
// unchanged base, then the adopted block; a design folder: the adopted block only), the files the prompts name
// (fixtures.<id>.promptFiles, or the design files) and the case-level needs (cases.json needs: {file, includes}), the
// references each case expects for that condition (referencesByCondition), placement, and applies the neutral commit to a
// copy (as run-trial does). With two conditions it compares them: the installed files differ only in
// conditions.json dryRun.installedDiffExpected (and include dryRun.requiredDiff); with conditions.json candidateText the
// #1820 stage-2 checks of the CLAUDE.md block and the asc description run too. It checks the prior-stage spend
// (run-trial.mjs priorSpendProblems), the plan against the stop line, and prints the launch command of every probe and
// planned trial of the built conditions with the --settings content of the first trial of each fixture kind. Output has
// no absolute local paths: the root is written as <scratch>, the ledger directory as <ledger-dir>.
// Usage: node dry-run.mjs <new-scratch-root> --tarball-<C> <tgz>... [--ledger <file>] [--allow-unreleased] [--out <json>] --config <dir>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {makeFixture, pinned, loadConditions, releasePlaceholders} from './make-fixture.mjs';
import {applyCondition, NEUTRAL_SUBJECT} from './apply-condition.mjs';
import {ascSkillsOf, referencesFor} from './score.mjs';
import {placementProblems} from './guard.mjs';
import {flags, BUDGET, STOP_LINE_USD, cellOf, promptFor, maxTurnsFor, isolationSettings, probeContext, probeSteps, priorSpendProblems, priorSpentUsd, fixtureOf} from './run-trial.mjs';
import {plannedTrials, orderProblems, loadOrder} from './order.mjs';
import {fixtureDir} from './run-all.mjs';
import {description} from './probe-check.mjs';
import {REPO_ROOT, loadSpec} from './config.mjs';

const repoRoot = REPO_ROOT;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const OPEN = '<!-- asc:read-trigger v1 -->', CLOSE = '<!-- /asc:read-trigger -->';
// The planning and expected cost per trial by case kind come from conditions.json budget.plan and budget.expect.

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

export function trialPlan(conds = loadConditions(), spec = loadSpec()) {
  const planned = plannedTrials(loadOrder(), conds.runs);
  const probes = conds.probeCells.map((c) => ({condition: c, case: 'probe', rep: 1, name: `${c}-probe-1`}));
  const kind = (t) => spec.cases.find((k) => k.id === t.case).kind;
  const count = (f) => planned.filter(f).length;
  const byKind = {};
  for (const t of planned) byKind[kind(t)] = (byKind[kind(t)] ?? 0) + 1;
  const total = (per, probe) => Object.entries(byKind).reduce((a, [k, n]) => a + n * (per[k] ?? NaN), 0) + probes.length * probe;
  const plan = BUDGET.plan, expect = BUDGET.expect;
  const usd = (u) => Number(total(u.perKindUsd, u.probeUsd).toFixed(2));
  const tokens = (per, probe) => (per ? Math.round(total(per, probe ?? 0)) : null);
  return {probes, planned, plannedTrials: planned.length, byCondition: Object.fromEntries(Object.keys(conds.cells).map((c) => [c, count((t) => t.condition === c)])), byKind,
    planningUsd: usd(plan), expectedUsd: usd(expect), stopLineUsd: STOP_LINE_USD, ownerCapUsd: BUDGET.ownerCapUsd, priorSpentUsd: priorSpentUsd(),
    expectedInputTokens: tokens(expect.perKindInputTokens, expect.probeInputTokens), expectedOutputTokens: tokens(expect.perKindOutputTokens, expect.probeOutputTokens),
    allStagesAtMostUsd: Number((priorSpentUsd() + STOP_LINE_USD).toFixed(4)),
    breakEvenPerTrialUsd: Number(((STOP_LINE_USD - BUDGET.perTrialUsd - probes.length * plan.probeUsd) / (planned.length - 1)).toFixed(3))};
}

// #1840: with conditions.json ascSkills, the references of every case whose expected Skill is one of them (relative to
// .agent-skill-chain/skills/asc/references, so another Skill's as ../../<skill>/references/<ref>); without the field (the
// test config, #1823) only the asc cases, as before (review L1).
export function fixtureReferences(cases, condition, conds) {
  const skills = ascSkillsOf(conds, condition);
  const refCases = conds.ascSkills ? cases.filter((k) => skills.includes(k.expect)) : cases.filter((k) => k.expect === 'asc');
  return [...new Set(refCases.flatMap((k) => referencesFor(k, condition).map((r) => (k.expect === 'asc' ? r : `../../${k.expect}/references/${r}`))))];
}

// An installed file that may differ between the conditions: listed, or matching a listed entry that starts with ^.
export const diffAllowed = (p, list) => list.some((e) => (e.startsWith('^') ? new RegExp(e).test(p) : e === p));
// The files a fixture must hold for its prompts: fixtures.<id>.promptFiles, or the design files and empty directories.
export const namedFiles = (def) => def.promptFiles ?? [...Object.keys(def.files ?? {}), ...(def.emptyDirs ?? [])];
// Case needs on a built fixture: each {file, includes: [text...]} must exist and contain every text.
export function needsProblems(dir, k) {
  const p = [];
  for (const n of k.needs ?? []) {
    const f = path.join(dir, n.file);
    if (!fs.existsSync(f)) { p.push(`${k.id}: ${n.file} is missing`); continue; }
    const text = fs.readFileSync(f, 'utf8');
    for (const x of n.includes ?? []) if (!text.includes(x)) p.push(`${k.id}: ${n.file} lacks ${JSON.stringify(x)}`);
  }
  return p;
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const root = path.resolve(args[0]);
  if (fs.existsSync(root)) throw new Error(`refused: exists ${root}`);
  const allowUnreleased = args.includes('--allow-unreleased');
  const conds = loadConditions();
  const spec = loadSpec();
  const tarballs = Object.fromEntries(Object.keys(conds.cells).filter((c) => opt(`--tarball-${c}`, null)).map((c) => [c, path.resolve(opt(`--tarball-${c}`))]));
  const built = Object.keys(tarballs);
  if (!built.length) throw new Error('give --tarball-<condition> for at least one condition');
  const ledger = path.resolve(opt('--ledger', path.join(root, 'ledger', 'ledger.jsonl')));
  const report = {label: 'dry run (no model call)', allowUnreleased, conditions: built, pending: releasePlaceholders(), checks: {}, fixtures: {}, copies: {}};
  const add = (k, pass, detail = null) => { report.checks[k] = {pass: Boolean(pass), detail}; };
  const digests = Object.fromEntries(Object.entries(tarballs).map(([c, t]) => [c, sha(fs.readFileSync(t))]));
  const fixturesRoot = path.join(root, 'fixtures');
  const used = [...new Set([conds.probeFixture ?? 'A', ...spec.cases.map((k) => k.fixture ?? 'A')])];
  const dirs = {};
  for (const c of built) for (const f of used) {
    const id = `${c}-${f}`;
    fs.mkdirSync(path.join(root, 'tmp', id), {recursive: true});
    const dir = fixtureDir(fixturesRoot, c, f);
    const made = makeFixture(c, f, tarballs[c], digests[c], dir, path.join(root, 'tmp', id), {allowUnreleased});
    dirs[id] = dir;
    const md = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    const def = conds.fixtures[f];
    const cases = spec.cases.filter((k) => (k.fixture ?? 'A') === f);
    const skills = ascSkillsOf(conds, c);
    const refs = fixtureReferences(cases, c, conds);
    const row = {condition: c, fixture: f, kind: def.kind, source: made.source, pinned: made.pinned, tarballSha256: made.install.tarballSha256, packageVersion: made.install.packageVersion,
      runtimeVersion: made.install.runtimeVersion, sources: made.sources, entries: made.install.entries.length, entryProblems: made.install.problems, adopted: made.install.adopted?.id ?? null,
      adoptedAction: made.install.adopted?.action ?? null, blockSha256: made.install.adopted?.blockSha256 ?? null, claudeMdSha256: sha(md), claudeMdProblems: claudeMdProblems(md, def.baseClaudeMd),
      scorerSkillsMatchRelease: JSON.stringify([...skills].sort()) === JSON.stringify(made.install.distributed),
      ascBodyPresent: fs.existsSync(path.join(dir, '.agent-skill-chain/skills/asc/SKILL.md')), references: refs,
      referencesPresent: refs.every((r) => fs.existsSync(path.join(dir, '.agent-skill-chain/skills/asc/references', r))),
      promptFilesExist: namedFiles(def).every((n) => fs.existsSync(path.join(dir, n))), needs: cases.flatMap((k) => needsProblems(dir, k)), placement: placementProblems(dir, {repoRoot})};
    const wantSource = allowUnreleased ? 'unpinned' : pinned(c).kind;
    row.ok = row.source === wantSource && row.entries === skills.length && row.entryProblems.length === 0 && row.adopted === conds.adopt
      && row.claudeMdProblems.length === 0 && row.scorerSkillsMatchRelease && row.ascBodyPresent && row.referencesPresent && row.promptFilesExist && row.needs.length === 0 && row.placement.length === 0;
    report.fixtures[id] = row;
    const copy = path.join(root, 'copies', id, 'work');
    fs.cpSync(dir, copy, {recursive: true});
    const a = applyCondition(copy);
    const subjects = spawnSync('git', ['log', '--format=%s'], {cwd: copy, encoding: 'utf8'}).stdout.trim().split('\n');
    report.copies[id] = {applied: a, commitSubjects: subjects, ok: a.changedFiles.length === 0 && subjects[0] === NEUTRAL_SUBJECT && placementProblems(copy, {repoRoot}).length === 0};
  }
  const first = `${built[0]}-${used[0]}`;
  add('pinnedTarballs', !allowUnreleased && built.every((c) => digests[c] === pinned(c)?.assetSha256), Object.fromEntries(built.map((c) => [c, pinned(c)?.kind ?? null])));
  add('fixturesInstalled', Object.values(report.fixtures).every((r) => r.ok), Object.fromEntries(Object.entries(report.fixtures).map(([k, r]) => [k, r.ok])));
  add('caseNeeds', Object.values(report.fixtures).every((r) => r.needs.length === 0), Object.fromEntries(Object.entries(report.fixtures).map(([k, r]) => [k, r.needs])));
  add('neutralCommitInCopies', Object.values(report.copies).every((c) => c.ok));
  add('sameCommitSubjects', new Set(Object.values(report.copies).map((c) => JSON.stringify(c.commitSubjects))).size === 1, report.copies[first].commitSubjects);
  add('sameRuntimeVersion', new Set(Object.values(report.fixtures).map((r) => r.runtimeVersion)).size === 1, report.fixtures[first].runtimeVersion);
  if (built.length === 2) {
    const [cb, cs] = built;
    const texts = conds.candidateText ?? null;
    const dr = conds.dryRun ?? {};
    report.compare = {};
    for (const f of used) {
      const b = dirs[`${cb}-${f}`], s = dirs[`${cs}-${f}`];
      const md = (d) => fs.readFileSync(path.join(d, 'CLAUDE.md'), 'utf8');
      const entry = (d, n) => fs.readFileSync(path.join(d, '.claude/skills', n, 'SKILL.md'), 'utf8');
      // #1867: the entries of the Skills both conditions distribute (ascSkillsByCondition may add a Skill to one).
      const common = ascSkillsOf(conds, cb).filter((n) => ascSkillsOf(conds, cs).includes(n));
      const x = {installedDiff: installedDiff(b, s), otherEntriesDiffer: common.filter((n) => n !== 'asc' && entry(b, n) !== entry(s, n))};
      if (texts) {
        const descB = description(entry(b, 'asc')), descS = description(entry(s, 'asc'));
        const ascRest = entry(b, 'asc').replace(/^description: .*$/m, '') === entry(s, 'asc').replace(/^description: .*$/m, '');
        x.readTrigger = firstSentenceDiff(md(b), md(s), texts.readTriggerFirstSentence);
        x.ascDescription = {B: descB, S: descS, pass: descB === texts.ascDescription.B && descS === texts.ascDescription.S && ascRest, entryOtherwiseSame: ascRest};
      }
      report.compare[f] = x;
    }
    if (texts) {
      add('readTriggerFirstSentenceOnly', Object.values(report.compare).every((x) => x.readTrigger.pass), Object.fromEntries(Object.entries(report.compare).map(([f, x]) => [f, x.readTrigger.problems])));
      add('ascDescriptionAsIntended', Object.values(report.compare).every((x) => x.ascDescription.pass && x.otherEntriesDiffer.length === 0), texts.ascDescription);
    } else add('otherEntriesSame', Object.values(report.compare).every((x) => x.otherEntriesDiffer.length === 0));
    add('installedDiffExpected', Object.values(report.compare).every((x) => x.installedDiff.every((p) => diffAllowed(p, dr.installedDiffExpected ?? [])) && (dr.requiredDiff ?? []).every((p) => x.installedDiff.includes(p))),
      Object.fromEntries(Object.entries(report.compare).map(([f, x]) => [f, x.installedDiff])));
  }
  add('runOrder', orderProblems(loadOrder(), spec, conds).length === 0, orderProblems(loadOrder(), spec, conds));
  add('priorSpend', priorSpendProblems().length === 0, priorSpendProblems());
  const plan = trialPlan(conds, spec);
  add('budget', plan.allStagesAtMostUsd <= BUDGET.ownerCapUsd && plan.planningUsd <= plan.stopLineUsd, {prior: plan.priorSpentUsd, stopLine: plan.stopLineUsd, allStages: plan.allStagesAtMostUsd, planning: plan.planningUsd, expected: plan.expectedUsd});
  // The launch command of every probe and planned trial of the built conditions, as run-trial.mjs builds it.
  const command = (t) => {
    const cell = cellOf(t.condition, conds);
    const probe = t.case === 'probe';
    const k = probe ? {id: 'probe'} : spec.cases.find((c) => c.id === t.case);
    const maxTurns = maxTurnsFor(k, conds);
    return {trial: t.name, condition: t.condition, case: t.case, kind: probe ? 'probe' : k.kind, fixture: fixtureOf(k, conds), maxTurns,
      promptText: probe ? '<probe prompt of level W>' : promptFor(k),
      argv: ['claude', '-p', '<promptText>', ...flags({level: cell.level, model: conds.model, budget: probe ? BUDGET.probeUsd : BUDGET.perTrialUsd, maxTurns, settingsFile: 'settings.json', debugFile: probe ? 'debug.log' : null})].join(' ')};
  };
  report.launch = [...plan.probes, ...plan.planned].filter((t) => built.includes(t.condition)).map(command);
  const kindOf = (l) => conds.fixtures[l.fixture]?.kind;
  add('maxTurns', report.launch.every((l) => (l.kind === 'probe' ? l.argv.includes(`--max-turns ${conds.probeMaxTurns} `) : conds.maxTurnsByKind[kindOf(l)] ? l.argv.includes(`--max-turns ${conds.maxTurnsByKind[kindOf(l)]} `) : !l.argv.includes('--max-turns'))),
    {probe: conds.probeMaxTurns, ...conds.maxTurnsByKind});
  add('levelFlags', report.launch.every((l) => l.argv.includes(`--tools ${conds.toolLevels.W.tools} `) && l.argv.includes(`--disallowedTools ${conds.toolLevels.W.disallowed} `) && l.argv.includes('--permission-mode acceptEdits') && l.argv.includes('--settings settings.json') && l.argv.includes(`--max-budget-usd ${l.kind === 'probe' ? BUDGET.probeUsd : BUDGET.perTrialUsd} `)));
  add('probeDebugLog', report.launch.filter((l) => l.kind === 'probe').length === built.length && report.launch.every((l) => (l.kind === 'probe') === l.argv.includes('--debug-file debug.log')));
  const runsRoot = path.join(root, 'runs');
  const mine = plan.planned.filter((t) => built.includes(t.condition));
  const fxOf = (t) => fixtureDir(fixturesRoot, t.condition, spec.cases.find((k) => k.id === t.case).fixture ?? 'A');
  const examples = [...new Map(mine.map((t) => [conds.fixtures[spec.cases.find((k) => k.id === t.case).fixture ?? 'A'].kind, t])).values()];
  report.settingsExamples = examples.map((t) => ({trial: t.name, settings: isolationSettings({work: path.join(runsRoot, t.name, 'work'), runsRoot, fixture: fxOf(t), ledger})}));
  add('fixtureDenied', report.settingsExamples.every((x, i) => { const fx = fs.realpathSync(fxOf(examples[i])); return x.settings.sandbox.filesystem.denyRead.includes(fx) && x.settings.sandbox.filesystem.denyWrite.includes(fx); }), examples.map((t) => t.name));
  report.probeSteps = Object.fromEntries(plan.probes.filter((t) => built.includes(t.condition)).map((t) => {
    const ctx = probeContext({dir: path.join(runsRoot, t.name), runsRoot, fixture: dirs[`${t.condition}-${conds.probeFixture ?? 'A'}`], ledger, homeMarker: path.join(root, 'home-marker'), repoMarker: path.join(root, 'repo-marker')});
    const steps = probeSteps(cellOf(t.condition, conds).tools, ctx);
    return [t.name, {count: steps.length, expected: conds.probeSteps.W, steps: steps.map((st) => `${st.id} ${st.tool} ${st.expect}`)}];
  }));
  add('probeStepsCounted', Object.values(report.probeSteps).every((x) => x.count === x.expected && x.count + 2 <= conds.probeMaxTurns), Object.fromEntries(Object.entries(report.probeSteps).map(([k, x]) => [k, x.count])));
  report.plan = {...plan, probes: plan.probes.map((t) => t.name), planned: undefined};
  report.pass = Object.values(report.checks).every((c) => c.pass);
  const text = JSON.stringify(report, null, 1).split(root).join('<scratch>').split(path.dirname(ledger)).join('<ledger-dir>');
  if (opt('--out', null)) fs.writeFileSync(opt('--out', null), text + '\n');
  console.log(JSON.stringify({pass: report.pass, pending: report.pending, checks: Object.fromEntries(Object.entries(report.checks).map(([k, v]) => [k, v.pass])),
    plannedTrials: plan.plannedTrials, byKind: plan.byKind, probes: plan.probes.length, planningUsd: plan.planningUsd, expectedUsd: plan.expectedUsd, stopLineUsd: plan.stopLineUsd,
    breakEvenPerTrialUsd: plan.breakEvenPerTrialUsd, expectedInputTokens: plan.expectedInputTokens, expectedOutputTokens: plan.expectedOutputTokens}));
  for (const l of report.launch) console.log(`${l.trial}\t${l.argv.split(root).join('<scratch>')}\t${l.promptText}`);
  process.exit(report.pass ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
