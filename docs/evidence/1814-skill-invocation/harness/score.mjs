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

export const ASC_SKILLS = ['asc', 'contract-enforcement', 'decision-ownership', 'engineering-judgment', 'estimate-and-scope', 'execution-recovery', 'migration-assurance', 'project-foundation', 'research-to-implementation', 'review-and-remediation', 'security-evidence', 'subagent-model-selection', 'tracker-issue-writing', 'user-journey-acceptance', 'verification-optimization', 'work-coordination'];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const same = (called, s) => called === s || called.endsWith(`:${s}`);

// Project-root-relative form of a tool path, or null when it is outside the root. macOS /private/tmp and /tmp are the same.
export function projectRelative(p, root) {
  if (!p || !root) return null;
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
  if (expectHook && !(hookLines && hookLines.length > 0)) return {...row, failure: 'hook did not fire'};
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
export function conditionHooks() {
  const f = path.join(path.dirname(fileURLToPath(import.meta.url)), '../conditions.json');
  return Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(f, 'utf8')).conditions).map(([k, v]) => [k, Boolean(v.hook)]));
}

export function scoreDir(spec, dir, conds, hooked = conditionHooks()) {
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
    runs.push({...base, ...scoreRun(spec, k, t, hookLines, {expectHook: Boolean(hooked[condition])})});
  }
  return runs;
}

export function summarize(spec, runs, condition) {
  const rs = runs.filter((r) => r.condition === condition);
  const ok = rs.filter((r) => !r.failure), pos = ok.filter((r) => r.expect), neg = ok.filter((r) => !r.expect);
  const n = (xs, f) => xs.filter(f).length;
  const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) ?? 0), 0);
  return {condition, runs: rs.length, failures: n(rs, (r) => r.failure), stopped: n(ok, (r) => r.stopped),
    positives: pos.length, entryHop: n(pos, (r) => r.entryHop), reach: n(pos, (r) => r.reach), bodyRead: n(pos, (r) => r.bodyRead), referenceRead: n(pos, (r) => r.reach && r.referenceRead),
    applied: n(pos, (r) => r.applied), misselect: n(pos, (r) => r.misselect), unselected: n(pos, (r) => r.unselected),
    negatives: neg.length, overapplication: n(neg, (r) => r.overapplication), negMarkers: n(neg, (r) => r.markers),
    hookFired: n(ok, (r) => r.hookFired === true), hookMissing: n(ok, (r) => r.hookFired === false),
    perCase: Object.fromEntries(spec.cases.map((k) => [k.id, ok.filter((r) => r.case === k.id).map((r) => (k.expect ? (r.applied ? 'A' : r.bodyRead ? 'B' : r.entryHop ? 'E' : r.misselect ? 'M' : 'U') : (r.overapplication ? 'O' : '-'))).join('')])),
    costUsd: Number(sum(rs, (r) => r.costUsd).toFixed(4)), turns: sum(ok, (r) => r.turns), durationSec: Math.round(sum(ok, (r) => r.durationMs) / 1000)};
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

// "Shortfall" (Issue: improve only when the measurement shows one): the current state misses the owner's body-read level.
export const shortfall = (baseline, minBodyRate = 0.8) => baseline.positives > 0 && baseline.bodyRead / baseline.positives < minBodyRate;

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const take = (flag, k) => { const i = args.indexOf(flag); return i >= 0 ? args.splice(i, k + 1).slice(1) : null; };
  const out = take('--runs-json', 1)?.[0] ?? null;
  const pair = take('--judge', 2);
  const [casesFile, dir, ...conds] = args;
  const spec = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
  const runs = scoreDir(spec, dir, conds);
  if (out) fs.writeFileSync(out, JSON.stringify(runs, null, 1));
  const sums = Object.fromEntries(conds.map((c) => [c, summarize(spec, runs, c)]));
  for (const s of Object.values(sums)) console.log(JSON.stringify(s));
  if (pair) console.log(JSON.stringify({judge: pair, shortfall: shortfall(sums[pair[0]]), ...judge(sums[pair[0]], sums[pair[1]])}));
}
