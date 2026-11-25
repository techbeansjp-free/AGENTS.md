// #1817: copied from docs/evidence/1814-skill-invocation/harness/score.mjs. Changes: (1) projectRelative also accepts a
// path already redacted by collect.mjs (cwd "<trial>/work", paths "<trial>/work/..."), so the committed public traces
// can be scored directly (#1814 had to score the unredacted scratch copies); real absolute paths are scored as before.
// (2) judge1817 is the #1817 decision rule (decision-criteria.md); --judge B S uses it and reports the targeted cases.
// (3) review L1: replacements are mandatory and exact: the k-th failed planned trial (rep order) is replaced by rep
// runs+k only; a failed replacement stays a failure; a missing replacement is reported and makes the condition not judged.
// (4) review M1: judge1817 is not-judged when a condition has no valid negative trial or a planned case has no valid trial.
// (5) review M-1: judge1817 is not-judged unless the run is complete or stopped at the cap (order.mjs completionStatus);
// the judgement is made only by judge.mjs (fixation, trial fixation digests, ledger), not by this file's command line.
// Scores #1814 runs against the fixed gold (cases.json) from the tool-call record only (stream-json of `claude -p`).
// Adapted from docs/evidence/1783-skill-coexistence/harness/score.mjs. Differences: two hops are counted separately (the
// thin entry .claude/skills/<s>/SKILL.md or the Skill tool, then the body .agent-skill-chain/skills/<s>/SKILL.md);
// tool paths are resolved against the session cwd (init event = sample project root) and matched relative to it; a Read
// counts only when its tool_result is not an error; answerGroups; secondary Skills; budget stops are scored and flagged,
// while process/API errors are failures; hook firing is taken from the hook log written by the fixture hook.
// Usage: node score.mjs <cases.json> <traces-dir> <condition>... [--runs-json <out.json>] [--judge <baseline> <candidate>]
// Trace files: <condition>-<case>-<n>.jsonl (condition = upper-case letters), optional <same>.hook.jsonl,
// <same>.jsonl.missing when the run produced no trace.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {productHookFiredInTrial} from './condition-i.mjs';
import {ledgerConsistency} from './ledger.mjs';

export const ASC_SKILLS = ['asc', 'contract-enforcement', 'decision-ownership', 'engineering-judgment', 'estimate-and-scope', 'execution-recovery', 'migration-assurance', 'project-foundation', 'research-to-implementation', 'review-and-remediation', 'security-evidence', 'subagent-model-selection', 'tracker-issue-writing', 'user-journey-acceptance', 'verification-optimization', 'work-coordination'];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const same = (called, s) => called === s || called.endsWith(`:${s}`);

// Project-root-relative form of a tool path, or null when it is outside the root. macOS /private/tmp and /tmp are the same.
export function projectRelative(p, root) {
  if (!p || !root) return null;
  // A redacted root ("<trial>/work", not absolute) with a path under the same redacted root: strip the root as text.
  if (!path.posix.isAbsolute(root) && (p === root || p.startsWith(`${root}/`))) {
    const rel = path.posix.normalize(p.slice(root.length + 1) || '.');
    return rel === '.' || rel.startsWith('..') ? null : rel;
  }
  const strip = (x) => x.replace(/^\/private(?=\/(tmp|var)\/)/, '');
  const abs = strip(path.posix.normalize(path.posix.isAbsolute(p) ? p : path.posix.join(root, p)));
  const rel = path.posix.relative(strip(path.posix.normalize(root)), abs);
  return rel === '' || rel.startsWith('..') || path.posix.isAbsolute(rel) ? null : rel;
}

export function parseTrace(text) {
  const lines = text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const results = new Map();
  for (const l of lines) if (l.type === 'user' && Array.isArray(l.message?.content)) for (const c of l.message.content) if (c.type === 'tool_result') results.set(c.tool_use_id, c);
  const uses = lines.filter((l) => l.type === 'assistant').flatMap((l) => (l.message?.content ?? []).filter((c) => c.type === 'tool_use'));
  const ok = (u) => { const r = results.get(u.id); return Boolean(r) && !r.is_error; };
  const result = lines.findLast((l) => l.type === 'result') ?? null;
  const texts = lines.filter((l) => l.type === 'assistant').flatMap((l) => (l.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text));
  const init = lines.find((l) => l.type === 'system' && l.subtype === 'init') ?? null;
  return {
    init,
    cwd: init?.cwd ?? null,
    result,
    uses,
    skills: uses.filter((u) => u.name === 'Skill').map((u) => String(u.input?.skill ?? '')),
    reads: uses.filter((u) => u.name === 'Read' && ok(u)).map((u) => String(u.input?.file_path ?? '')),
    readAttempts: uses.filter((u) => u.name === 'Read').length,
    hookEvents: lines.filter((l) => l.type === 'system' && /hook/i.test(String(l.subtype ?? ''))).length,
    text: typeof result?.result === 'string' && result.result ? result.result : texts.join('\n'),
  };
}

export function markersOk(k, text) {
  const low = text.toLowerCase();
  return (k.answerAll ?? []).every((a) => low.includes(a.toLowerCase())) &&
    ((k.answerAny ?? []).length === 0 || k.answerAny.some((a) => new RegExp(a, 'i').test(text))) &&
    (k.answerGroups ?? []).every((g) => new RegExp(g, 'i').test(text));
}

export function scoreRun(spec, k, t, hookLines = null, {expectHook = false} = {}) {
  const pat = (key, s, r = '') => new RegExp(spec[key].replace('<skill>', esc(s)).replace('<ref>', esc(r)));
  const rel = t.reads.map((p) => projectRelative(p, t.cwd)).filter(Boolean);
  const ascBodies = ASC_SKILLS.filter((s) => rel.some((r) => pat('bodyPattern', s).test(r)));
  const ascEntries = ASC_SKILLS.filter((s) => rel.some((r) => pat('entryPattern', s).test(r)));
  const ascCalls = t.skills.filter((c) => ASC_SKILLS.some((s) => same(c, s)));
  const row = {case: k.id, kind: k.kind, expect: k.expect, skills: t.skills, ascEntries, ascBodies, readAttempts: t.readAttempts, toolUses: t.uses.length,
    hookFired: hookLines === null ? null : hookLines.length > 0, hookEvents: t.hookEvents, model: t.init?.model ?? null,
    costUsd: t.result?.total_cost_usd ?? null, turns: t.result?.num_turns ?? null, durationMs: t.result?.duration_ms ?? null,
    usage: t.result?.usage ? {input: t.result.usage.input_tokens, output: t.result.usage.output_tokens, cacheRead: t.result.usage.cache_read_input_tokens, cacheWrite: t.result.usage.cache_creation_input_tokens} : null};
  if (!t.init) return {...row, failure: 'no init event'}; // review L5: cwd and model unknown, cannot be scored
  if (!t.result) return {...row, failure: 'no result event'};
  // review L6: in a hook condition, a trial whose hook did not fire did not receive the condition.
  // The product hook (condition I) does not write the fixture log; its firing is taken from SessionStart hook events.
  const fired = expectHook === 'product' ? productHookFiredInTrial(t.hookEvents) : Boolean(hookLines && hookLines.length > 0);
  if (expectHook === 'product') row.hookFired = fired; // review L-3: the fixture log is empty by design
  if (expectHook && !fired) return {...row, failure: 'hook did not fire'};
  const sub = String(t.result.subtype ?? '');
  // A budget stop is a completed observation of what was read; any other error is a failure.
  row.stopped = /max_budget|max_turns/.test(sub) ? sub : null;
  if (t.result.is_error && !row.stopped) return {...row, failure: `result error: ${String(t.result.result ?? sub).slice(0, 120)}`};
  row.markers = markersOk(k, t.text);
  const touched = ascCalls.length > 0 || ascEntries.length > 0 || ascBodies.length > 0;
  if (k.expect) {
    const e = k.expect;
    row.entryHop = t.skills.some((s) => same(s, e)) || ascEntries.includes(e);
    row.bodyRead = ascBodies.includes(e);
    row.reach = row.entryHop || row.bodyRead;
    row.referenceRead = k.references.length === 0 || k.references.some((r) => rel.some((p) => pat('referencePattern', e, r).test(p)));
    row.applied = row.bodyRead && row.referenceRead && row.markers;
    row.misselect = !row.reach && (t.skills.length > 0 || ascEntries.length > 0 || ascBodies.length > 0);
    row.unselected = !row.reach && t.skills.length === 0 && ascEntries.length === 0 && ascBodies.length === 0;
    row.secondaryRead = Object.fromEntries((k.secondary ?? []).map((s) => [s, ascBodies.includes(s)]));
  } else {
    row.overapplication = touched;
    row.otherSkillCalls = t.skills.filter((c) => !ascCalls.includes(c));
  }
  return row;
}

// Which conditions carry a hook (conditions.json); a condition added later (I) is listed there before it is scored.
const conditionsFile = () => JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../conditions.json'), 'utf8'));
export function conditionHooks() {
  return Object.fromEntries(Object.entries(conditionsFile().conditions).map(([k, v]) => [k, v.hook ?? false]));
}

// review L-3 / #1817 L1: only rep numbers 1..runs are scored. The k-th failed planned trial of a condition and case (in
// rep order) is replaced by rep runs+k and by nothing else; a failed replacement counts as a failure and is not replaced
// again; a failed planned trial whose replacement is absent is kept as a failure and flagged replacementMissing. Every
// other run (a rep above runs+failures, or a rep above runs without a failure to replace) is counted:false.
export function selectCounted(runs, planned) {
  const groups = new Map();
  for (const r of runs) { const k = `${r.condition}|${r.case}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  for (const rs of groups.values()) {
    const plan = rs.filter((r) => r.run <= planned).sort((a, b) => a.run - b.run);
    for (const r of rs) r.counted = r.run <= planned;
    plan.filter((r) => r.failure).forEach((failed, k) => {
      const sub = rs.find((r) => r.run === planned + k + 1);
      if (!sub) { failed.replacementMissing = true; return; }
      failed.counted = false; failed.replacedBy = sub.run; sub.counted = true; sub.replaces = failed.run;
    });
  }
  return runs;
}

export function scoreDir(spec, dir, conds, hooked = conditionHooks(), planned = conditionsFile().runs) {
  const runs = [];
  for (const file of fs.readdirSync(dir).sort()) {
    const m = /^([A-Z]+)-(.+)-(\d+)\.jsonl(\.missing)?$/.exec(file);
    if (!m || !conds.includes(m[1])) continue;
    const [, condition, id, n, missing] = m;
    const k = spec.cases.find((c) => c.id === id);
    if (!k) continue;
    const base = {condition, run: Number(n)};
    if (missing) { runs.push({...base, case: id, kind: k.kind, expect: k.expect, failure: 'missing trace'}); continue; }
    const hookFile = path.join(dir, file.replace(/\.jsonl$/, '.hook.jsonl'));
    const hookLines = fs.existsSync(hookFile) ? fs.readFileSync(hookFile, 'utf8').split('\n').filter(Boolean) : null;
    let t;
    try { t = parseTrace(fs.readFileSync(path.join(dir, file), 'utf8')); } catch (e) { runs.push({...base, case: id, kind: k.kind, expect: k.expect, failure: `unreadable trace: ${e.message}`}); continue; }
    runs.push({...base, ...scoreRun(spec, k, t, hookLines, {expectHook: hooked[condition] ?? false})});
  }
  return selectCounted(runs, planned);
}

export function summarize(spec, runs, condition) {
  const all = runs.filter((r) => r.condition === condition);
  const rs = all.filter((r) => r.counted !== false);
  const ok = rs.filter((r) => !r.failure), pos = ok.filter((r) => r.expect), neg = ok.filter((r) => !r.expect);
  const n = (xs, f) => xs.filter(f).length;
  const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) ?? 0), 0);
  return {condition, runs: rs.length, notCounted: all.length - rs.length, failures: n(rs, (r) => r.failure), stopped: n(ok, (r) => r.stopped),
    positives: pos.length, entryHop: n(pos, (r) => r.entryHop), reach: n(pos, (r) => r.reach), bodyRead: n(pos, (r) => r.bodyRead), referenceRead: n(pos, (r) => r.reach && r.referenceRead),
    applied: n(pos, (r) => r.applied), misselect: n(pos, (r) => r.misselect), unselected: n(pos, (r) => r.unselected),
    negatives: neg.length, overapplication: n(neg, (r) => r.overapplication), negMarkers: n(neg, (r) => r.markers),
    hookFired: n(ok, (r) => r.hookFired === true), hookMissing: n(ok, (r) => r.hookFired === false),
    replacementsMissing: n(rs, (r) => r.replacementMissing), casesWithoutValidTrial: spec.cases.map((k) => k.id).filter((id) => !ok.some((r) => r.case === id)),
    perCase: Object.fromEntries(spec.cases.map((k) => [k.id, ok.filter((r) => r.case === k.id).map((r) => (k.expect ? (r.applied ? 'A' : r.bodyRead ? 'B' : r.entryHop ? 'E' : r.misselect ? 'M' : 'U') : (r.overapplication ? 'O' : '-'))).join('')])),
    costUsd: Number(sum(all, (r) => r.costUsd).toFixed(4)), turns: sum(ok, (r) => r.turns), durationSec: Math.round(sum(ok, (r) => r.durationMs) / 1000)};
}

// Owner pass level (Issue #1814 comment, 2026-11-25), fixed in decision-criteria.md before any run:
// on applicable requests the expected ASC Skill body is read in >= 80% of trials, and procedure application is
// higher than the current state; over-reading on non-applicable requests is at most current state + 1 trial.
// Failures are excluded from denominators. A condition with failures above maxFailureRate is not judged.
export function judge(baseline, candidate, {minBodyRate = 0.8, negSlack = 1, maxFailureRate = 0.1} = {}) {
  const unjudgeable = [baseline, candidate].filter((s) => s.runs === 0 || s.failures / s.runs > maxFailureRate || s.positives === 0).map((s) => s.condition);
  if (unjudgeable.length) return {verdict: 'not-judged', reason: `failures above ${maxFailureRate * 100}% or no runs: ${unjudgeable.join(',')}`};
  // Compare application by rate so that a differing number of valid trials does not decide the result.
  const rate = (s, k) => s[k] / s.positives;
  const checks = {
    bodyRead: {value: `${candidate.bodyRead}/${candidate.positives}`, pass: rate(candidate, 'bodyRead') >= minBodyRate},
    appliedAboveBaseline: {value: `${candidate.applied}/${candidate.positives} vs ${baseline.applied}/${baseline.positives}`, pass: rate(candidate, 'applied') > rate(baseline, 'applied')},
    overapplication: {value: `${candidate.overapplication}/${candidate.negatives} vs ${baseline.overapplication}/${baseline.negatives}`, pass: candidate.overapplication <= baseline.overapplication + negSlack},
  };
  return {verdict: Object.values(checks).every((c) => c.pass) ? 'pass' : 'fail', checks};
}

// #1817 decision rule (decision-criteria.md, fixed before any run; owner decision 2026-11-25). S is an adoption
// candidate iff (a) applied(S) > applied(B), (b) bodyRead(S) >= bodyRead(B) - 1, (c) overapplication(S) <=
// overapplication(B) + 1. (a) and (b) are compared as rates over the valid positive trials (equal to the counts when both
// conditions have the same number, 44 each without failures); (b) tolerates one trial of B's denominator. (c) is a count.
// A condition with failures above maxFailureRate after replacement is not judged.
export function judge1817(baseline, candidate, {negSlack = 1, bodySlack = 1, maxFailureRate = 0.1, targeted = ['asc-3', 'es-1'], completion = null} = {}) {
  const perCase = Object.fromEntries(targeted.map((id) => [id, {[baseline.condition]: baseline.perCase?.[id] ?? '', [candidate.condition]: candidate.perCase?.[id] ?? ''}]));
  const reasons = [];
  // review M-1: an early stop (neither complete nor at the cap) is not judged, so stopping cannot follow the results.
  if (!completion?.basis) reasons.push(`run neither complete nor stopped at the cap (${completion ? `${completion.missingPlanned} planned and ${completion.missingReplacements.length} required replacement(s) not reserved, spent ${completion.spentUsd} + ${completion.perTrialUsd} <= ${completion.stopLineUsd}` : 'no completion record'})`);
  for (const s of [baseline, candidate]) {
    if (s.runs === 0 || s.positives === 0) reasons.push(`${s.condition}: no valid positive trial`);
    else if (s.failures / s.runs > maxFailureRate) reasons.push(`${s.condition}: failures above ${maxFailureRate * 100}%`);
    // review M1: rule (c) must not pass vacuously, and a cap stop must not leave a planned case unmeasured.
    if (!s.negatives) reasons.push(`${s.condition}: no valid negative trial`);
    if ((s.casesWithoutValidTrial ?? []).length) reasons.push(`${s.condition}: no valid trial for ${s.casesWithoutValidTrial.join(',')}`);
    // review L1: replacements are mandatory.
    if (s.replacementsMissing) reasons.push(`${s.condition}: ${s.replacementsMissing} failed trial(s) without the mandatory replacement`);
  }
  if (reasons.length) return {verdict: 'not-judged', reason: reasons.join('; '), completion, targeted: perCase};
  const rate = (s, k) => s[k] / s.positives;
  const checks = {
    appliedAboveBaseline: {value: `${candidate.applied}/${candidate.positives} vs ${baseline.applied}/${baseline.positives}`, pass: rate(candidate, 'applied') > rate(baseline, 'applied')},
    bodyReadNotLower: {value: `${candidate.bodyRead}/${candidate.positives} vs ${baseline.bodyRead}/${baseline.positives} - ${bodySlack}`, pass: rate(candidate, 'bodyRead') >= (baseline.bodyRead - bodySlack) / baseline.positives},
    overapplication: {value: `${candidate.overapplication}/${candidate.negatives} vs ${baseline.overapplication}/${baseline.negatives}`, pass: candidate.overapplication <= baseline.overapplication + negSlack},
  };
  const applied = (s, id) => (s.perCase?.[id] ?? '').split('').filter((c) => c === 'A').length;
  for (const id of targeted) perCase[id].applied = {[baseline.condition]: applied(baseline, id), [candidate.condition]: applied(candidate, id)};
  return {verdict: Object.values(checks).every((c) => c.pass) ? 'adoption-candidate' : 'not-a-candidate', basis: completion.basis, completion, checks, targeted: perCase,
    note: 'With 4 runs per case small differences are not significant; adoption is the owner\'s decision.'};
}

// "Shortfall" (Issue: improve only when the measurement shows one): the current state misses the owner's body-read level.
export const shortfall = (baseline, minBodyRate = 0.8) => baseline.positives > 0 && baseline.bodyRead / baseline.positives < minBodyRate;

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const take = (flag, k) => { const i = args.indexOf(flag); return i >= 0 ? args.splice(i, k + 1).slice(1) : null; };
  const out = take('--runs-json', 1)?.[0] ?? null;
  const pair = take('--judge', 2);
  const [casesFile, dir, ...conds] = args;
  const spec = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
  // review N-1 (d): refuse traces collected from more than one ledger or with a repeated ledger seq.
  const trialsFile = path.join(dir, 'trials.json');
  if (!fs.existsSync(trialsFile)) throw new Error('trials.json (from collect.mjs) is missing');
  const lc = ledgerConsistency(JSON.parse(fs.readFileSync(trialsFile, 'utf8')).filter((r) => !r.missing));
  if (lc.length) throw new Error(`ledger check failed: ${lc.join('; ')}`);
  const runs = scoreDir(spec, dir, conds);
  if (out) fs.writeFileSync(out, JSON.stringify(runs, null, 1));
  const sums = Object.fromEntries(conds.map((c) => [c, summarize(spec, runs, c)]));
  for (const s of Object.values(sums)) console.log(JSON.stringify(s));
  if (pair) { console.error('refused: judge with judge.mjs (fixation, trial fixation digests and ledger completion are checked there)'); process.exit(3); }
}
