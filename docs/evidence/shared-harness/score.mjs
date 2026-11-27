// Shared harness: scoring of the full trials (app fixtures, #1817), the truncated design trials (three messages, #1820
// stage 2) and the scenario trials (an app fixture variant whose answer states a procedure), and the decision rule.
// From docs/evidence/1820-write-tools-read/stage2/harness/score.mjs (kept: projectRelative, parseTrace, markersOk,
// initProblems, countedReads, entryHop / bodyRead / reach / referenceRead / applied / misselect / unselected /
// secondaryRead / overapplication, selectCounted = mandatory one-time replacements, summarize, perCase letters, the
// design facts). Parameterised:
// - a case may name its references per condition (referencesByCondition: e.g. B [] when the rule is in the body itself,
//   S ["merge-permission.md"] when it moved to a reference); applied = body, one of those references (none listed:
//   true) and the markers, as #1817. Every row records the ASC references it read (ascReferencesRead), whether the
//   markers matched without the listed reference (markersWithoutReference), the bytes of the ASC files it read
//   (ascBytesRead, from the trial's work/ copy via sizeOf) and its input tokens (input + cache read + cache write);
// - the rule is conditions.json rule (verdictOf): body share at least minBodyRate and against the baseline (gt or ge),
//   applied not lower, overapplication at most baseline + negSlack, optionally per-case applied not lower for the
//   scenario kinds and the efficiency means not higher on the common kinds;
// - scoring takes the raw trace texts (scoreTrials), so no published trace is needed (owner decision B of #1823).
// No model call.
import path from 'node:path';
import {loadConditions} from './apply-condition.mjs';

export const ASC_SKILLS = ['asc', 'contract-enforcement', 'decision-ownership', 'engineering-judgment', 'estimate-and-scope', 'execution-recovery', 'migration-assurance', 'project-foundation', 'research-to-implementation', 'review-and-remediation', 'security-evidence', 'subagent-model-selection', 'tracker-issue-writing', 'user-journey-acceptance', 'verification-optimization', 'work-coordination'];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const same = (called, s) => called === s || called.endsWith(`:${s}`);

// Project-root-relative form of a tool path, or null when it is outside the root. macOS /private/tmp and /tmp are the same.
export function projectRelative(p, root) {
  if (!p || !root) return null;
  if (!path.posix.isAbsolute(root) && (p === root || p.startsWith(`${root}/`))) {
    const rel = path.posix.normalize(p.slice(root.length + 1) || '.');
    return rel === '.' || rel.startsWith('..') ? null : rel;
  }
  const strip = (x) => x.replace(/^\/private(?=\/(tmp|var)\/)/, '');
  const abs = strip(path.posix.normalize(path.posix.isAbsolute(p) ? p : path.posix.join(root, p)));
  const rel = path.posix.relative(strip(path.posix.normalize(root)), abs);
  return rel === '' || rel.startsWith('..') || path.posix.isAbsolute(rel) ? null : rel;
}

// Stream-json of `claude -p`: assistant events grouped into messages by message.id, in order of first appearance.
export function parseTrace(text) {
  const lines = text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const results = new Map();
  for (const l of lines) if (l.type === 'user' && Array.isArray(l.message?.content)) for (const c of l.message.content) if (c.type === 'tool_result') results.set(c.tool_use_id, c);
  const messages = [];
  const byId = new Map();
  for (const l of lines.filter((x) => x.type === 'assistant')) {
    const id = l.message?.id ?? `anon-${messages.length}`;
    if (!byId.has(id)) { const m = {id, uses: [], texts: []}; byId.set(id, m); messages.push(m); }
    for (const c of l.message?.content ?? []) {
      if (c.type === 'tool_use') byId.get(id).uses.push(c);
      else if (c.type === 'text') byId.get(id).texts.push(c.text);
    }
  }
  const result = lines.findLast((l) => l.type === 'result') ?? null;
  const init = lines.find((l) => l.type === 'system' && l.subtype === 'init') ?? null;
  const uses = messages.flatMap((m) => m.uses);
  const texts = messages.flatMap((m) => m.texts);
  return {init, cwd: init?.cwd ?? null, result, messages, results, uses,
    reads: uses.filter((u) => u.name === 'Read' && results.has(u.id) && !results.get(u.id).is_error).map((u) => String(u.input?.file_path ?? '')),
    skills: uses.filter((u) => u.name === 'Skill').map((u) => String(u.input?.skill ?? '')),
    readAttempts: uses.filter((u) => u.name === 'Read').length,
    text: typeof result?.result === 'string' && result.result ? result.result : texts.join('\n')};
}

export function markersOk(k, text) {
  const low = text.toLowerCase();
  return (k.answerAll ?? []).every((a) => low.includes(a.toLowerCase())) &&
    ((k.answerAny ?? []).length === 0 || k.answerAny.some((a) => new RegExp(a, 'i').test(text))) &&
    (k.answerGroups ?? []).every((g) => new RegExp(g, 'i').test(text));
}

// The init event against level W (stage 1 rule): same tools (ToolSearch tolerated), same permission mode, no MCP server.
export function initProblems(init, level) {
  if (!init) return ['no init event'];
  const p = [];
  const want = level.tools.split(',').sort();
  const have = [...(init.tools ?? [])].filter((x) => x !== 'ToolSearch').sort();
  if (JSON.stringify(have) !== JSON.stringify(want)) p.push(`tools ${have.join(',')} != ${want.join(',')}`);
  if ((init.permissionMode ?? null) !== level.initPermissionMode) p.push(`permission mode ${init.permissionMode} != ${level.initPermissionMode}`);
  if ((init.mcp_servers ?? []).length) p.push('MCP servers present');
  return p;
}

export const isDesign = (k) => k.kind === 'design';

// The Reads that count: fixture A (#1817) a non-error result; a design case (stopped after its last message) also a Read
// whose result is absent (issued, stage 1). Returns project-relative paths with the 1-based message of each.
export function countedReads(k, t) {
  const out = [];
  t.messages.forEach((m, i) => {
    for (const u of m.uses) {
      if (u.name !== 'Read') continue;
      const r = t.results.get(u.id);
      const counts = r ? !r.is_error : isDesign(k);
      const rel = counts ? projectRelative(String(u.input?.file_path ?? ''), t.cwd) : null;
      if (rel) out.push({path: rel, message: i + 1, resultMissing: !r});
    }
  });
  return out;
}

// The references of a case for a condition (referencesByCondition, else references).
export function referencesFor(k, condition) {
  if (!k.referencesByCondition) return k.references ?? [];
  const r = k.referencesByCondition[condition];
  if (!Array.isArray(r)) throw new Error(`case ${k.id} names no references for condition ${condition}`);
  return r;
}
export const inputTokensOf = (u) => (u ? (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) : null);
const ASC_FILE = /^\.agent-skill-chain\/|^\.claude\/skills\//;

export function scoreRun(spec, k, t, {level = null, condition = null, sizeOf = null} = {}) {
  const pat = (key, s, r = '') => new RegExp(spec[key].replace('<skill>', esc(s)).replace('<ref>', esc(r)));
  const reads = countedReads(k, t);
  const rel = reads.map((r) => r.path);
  const ascBodies = ASC_SKILLS.filter((s) => rel.some((r) => pat('bodyPattern', s).test(r)));
  const ascEntries = ASC_SKILLS.filter((s) => rel.some((r) => pat('entryPattern', s).test(r)));
  const ascCalls = t.skills.filter((c) => ASC_SKILLS.some((s) => same(c, s)));
  const row = {case: k.id, kind: k.kind, fixture: k.fixture ?? 'A', expect: k.expect, skills: t.skills, ascEntries, ascBodies, readAttempts: t.readAttempts, toolUses: t.uses.length,
    messages: t.messages.length, model: t.init?.model ?? null, initTools: t.init?.tools ?? null, permissionMode: t.init?.permissionMode ?? null,
    costUsd: t.result?.total_cost_usd ?? null, turns: t.result?.num_turns ?? null, durationMs: t.result?.duration_ms ?? null,
    usage: t.result?.usage ? {input: t.result.usage.input_tokens, output: t.result.usage.output_tokens, cacheRead: t.result.usage.cache_read_input_tokens, cacheWrite: t.result.usage.cache_creation_input_tokens} : null};
  row.inputTokens = inputTokensOf(row.usage);
  const ascFiles = [...new Set(rel.filter((r) => ASC_FILE.test(r)))].sort();
  row.ascFilesRead = ascFiles.length;
  row.ascBytesRead = sizeOf ? ascFiles.reduce((a, r) => a + (sizeOf(r) ?? 0), 0) : null;
  if (!t.init) return {...row, failure: 'no init event'};
  if (!t.result) return {...row, failure: 'no result event'};
  if (level) {
    const ip = initProblems(t.init, level);
    if (ip.length) return {...row, failure: `condition not received: ${ip.join('; ')}`};
  }
  const sub = String(t.result.subtype ?? '');
  row.stopped = /max_budget|max_turns/.test(sub) ? sub : null;
  if (t.result.is_error && !row.stopped) return {...row, failure: `result error: ${String(t.result.result ?? sub).slice(0, 120)}`};
  if (isDesign(k) && !t.messages.length) return {...row, failure: 'no assistant message'};
  row.markersApplicable = !isDesign(k);
  row.markers = isDesign(k) ? true : markersOk(k, t.text);
  row.resultMissing = reads.some((r) => r.resultMissing);
  const touched = ascCalls.length > 0 || ascEntries.length > 0 || ascBodies.length > 0;
  if (k.expect) {
    const e = k.expect;
    row.entryHop = t.skills.some((s) => same(s, e)) || ascEntries.includes(e);
    row.bodyRead = ascBodies.includes(e);
    row.reach = row.entryHop || row.bodyRead;
    const refs = referencesFor(k, condition);
    row.references = refs;
    row.ascReferencesRead = [...new Set(rel.map((p) => new RegExp(spec.referencePattern.replace('<skill>', esc(e)).replace('<ref>', '(.+)')).exec(p)?.at(-1)).filter(Boolean))].sort();
    row.referenceRead = refs.length === 0 || refs.some((r) => rel.some((p) => pat('referencePattern', e, r).test(p)));
    row.applied = row.bodyRead && row.referenceRead && row.markers;
    row.markersWithoutReference = row.markersApplicable && row.markers && refs.length > 0 && !row.referenceRead;
    row.misselect = !row.reach && (t.skills.length > 0 || ascEntries.length > 0 || ascBodies.length > 0);
    row.unselected = !row.reach && t.skills.length === 0 && ascEntries.length === 0 && ascBodies.length === 0;
    row.secondaryRead = Object.fromEntries((k.secondary ?? []).map((s) => [s, ascBodies.includes(s)]));
    if (isDesign(k)) {
      const first = reads.find((r) => pat('bodyPattern', e).test(r.path));
      row.bodyReadMessage = first ? first.message : null;
      const writeAt = t.messages.findIndex((m) => m.uses.some((u) => u.name === 'Write' || u.name === 'Edit'));
      row.writeBeforeBody = writeAt >= 0 && (!first || writeAt + 1 < first.message);
      row.skillAsc = t.skills.some((s) => same(s, 'asc'));
      row.firstTools = (t.messages[0]?.uses ?? []).map((u) => ({name: u.name, target: u.name === 'Skill' ? String(u.input?.skill ?? '') : (projectRelative(String(u.input?.file_path ?? u.input?.path ?? ''), t.cwd) ?? (u.input?.pattern ? String(u.input.pattern) : '<outside>'))}));
    }
  } else {
    row.overapplication = touched;
    row.otherSkillCalls = t.skills.filter((c) => !ascCalls.includes(c));
  }
  return row;
}

// #1817 review L-3 / L1: only rep numbers 1..planned are scored. The k-th failed planned trial of a condition and case (in
// rep order) is replaced by rep planned+k and by nothing else; a failed replacement counts as a failure and is not
// replaced again; a failed planned trial whose replacement is absent is kept as a failure and flagged replacementMissing.
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

// Scores the trials of a runs root from their raw records. entries: [{name, text (trace.jsonl) or null, failure (a
// collect-level failure such as 'missing trace' or 'not settled') or null, sizeOf (project-relative path -> bytes in
// the trial's work/ copy) or null}]. Names are <condition>-<case>-<rep>; other names are skipped.
export function scoreTrials(spec, entries, conds = loadConditions()) {
  const runs = [];
  for (const e of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const m = /^([A-Z]+)-(.+)-(\d+)$/.exec(e.name);
    if (!m || !conds.cells[m[1]]) continue;
    const [, condition, id, n] = m;
    const k = spec.cases.find((c) => c.id === id);
    if (!k) continue;
    const base = {condition, run: Number(n), case: id, kind: k.kind, fixture: k.fixture ?? 'A', expect: k.expect};
    if (e.failure || e.text === null || e.text === undefined) { runs.push({...base, failure: e.failure ?? 'missing trace'}); continue; }
    let t;
    try { t = parseTrace(e.text); } catch (err) { runs.push({...base, failure: `unreadable trace: ${err.message}`}); continue; }
    runs.push({condition, run: Number(n), ...scoreRun(spec, k, t, {level: conds.toolLevels[conds.cells[condition].tools], condition, sizeOf: e.sizeOf ?? null})});
  }
  return selectCounted(runs, conds.runs);
}

const mean = (xs) => (xs.length ? Number((xs.reduce((a, x) => a + x, 0) / xs.length).toFixed(1)) : null);

// One condition; `only` limits the cases to a subset (a fixture, a kind or one case) for the separate reports.
export function summarize(spec, runs, condition, {only = null} = {}) {
  const ids = only ? spec.cases.filter(only).map((k) => k.id) : spec.cases.map((k) => k.id);
  const all = runs.filter((r) => r.condition === condition && ids.includes(r.case));
  const rs = all.filter((r) => r.counted !== false);
  const ok = rs.filter((r) => !r.failure), pos = ok.filter((r) => r.expect), neg = ok.filter((r) => !r.expect);
  const n = (xs, f) => xs.filter(f).length;
  const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) ?? 0), 0);
  const nums = (f) => ok.map(f).filter((x) => typeof x === 'number');
  const refReads = {};
  for (const r of ok) for (const x of r.ascReferencesRead ?? []) refReads[x] = (refReads[x] ?? 0) + 1;
  return {condition, runs: rs.length, notCounted: all.length - rs.length, failures: n(rs, (r) => r.failure), stopped: n(ok, (r) => r.stopped),
    positives: pos.length, entryHop: n(pos, (r) => r.entryHop), reach: n(pos, (r) => r.reach), bodyRead: n(pos, (r) => r.bodyRead), referenceRead: n(pos, (r) => r.reach && r.referenceRead),
    applied: n(pos, (r) => r.applied), misselect: n(pos, (r) => r.misselect), unselected: n(pos, (r) => r.unselected),
    markersWithoutReference: n(pos, (r) => r.markersWithoutReference === true),
    negatives: neg.length, overapplication: n(neg, (r) => r.overapplication), negMarkers: n(neg, (r) => r.markers),
    designWriteBeforeBody: n(pos, (r) => r.writeBeforeBody === true),
    replacementsMissing: n(rs, (r) => r.replacementMissing), casesWithoutValidTrial: ids.filter((id) => !ok.some((r) => r.case === id)),
    perCase: Object.fromEntries(spec.cases.filter((k) => ids.includes(k.id)).map((k) => [k.id, ok.filter((r) => r.case === k.id).sort((a, b) => a.run - b.run).map((r) => (k.expect ? (r.applied ? 'A' : r.bodyRead ? 'B' : r.entryHop ? 'E' : r.misselect ? 'M' : 'U') : (r.overapplication ? 'O' : '-'))).join('')])),
    referenceReads: Object.fromEntries(Object.entries(refReads).sort()),
    perTrial: {ascBytesRead: mean(nums((r) => r.ascBytesRead)), inputTokens: mean(nums((r) => r.inputTokens)), outputTokens: mean(nums((r) => r.usage?.output)), durationMs: mean(nums((r) => r.durationMs)), costUsd: mean(nums((r) => r.costUsd))},
    costUsd: Number(sum(all, (r) => r.costUsd).toFixed(4)), turns: sum(ok, (r) => r.turns), durationSec: Math.round(sum(ok, (r) => r.durationMs) / 1000)};
}

// The tolerance of the rule (conditions.json rule.tolerance), in trials: the candidate may be that many trials below the
// baseline in bodyRead and applied (over the positives), in applied per scenario case (perScenarioApplied), and that many
// above it in overapplication (overapplication; when absent, negSlack). Every field defaults to 0, so a rule without
// tolerance keeps the stage-1 comparisons. Shares are compared by cross-multiplication: c/pc >= (b - tol)/pb.
export const TOLERANCE_KEYS = ['bodyRead', 'applied', 'perScenarioApplied', 'overapplication'];
export function toleranceOf(rule = {}) {
  const t = rule.tolerance ?? {};
  if (typeof t !== 'object' || Array.isArray(t)) throw new Error('rule.tolerance must be an object');
  for (const [k, v] of Object.entries(t)) {
    if (!TOLERANCE_KEYS.includes(k)) throw new Error(`rule.tolerance has an unknown field ${k}`);
    if (!Number.isInteger(v) || v < 0) throw new Error(`rule.tolerance.${k} must be a non-negative integer`);
  }
  return Object.fromEntries(TOLERANCE_KEYS.map((k) => [k, t[k] ?? 0]));
}
// candidate share (cn/cd) against the baseline share (bn/bd) lowered by tol trials of the baseline: ge or gt.
const shareCmp = (cn, cd, bn, bd, tol, op) => (cd > 0 && bd > 0 ? (op === 'gt' ? cn * bd > (bn - tol) * cd : cn * bd >= (bn - tol) * cd) : false);
const minus = (tol) => (tol ? ` - ${tol}` : '');

// The quality checks of the rule (conditions.json rule): (a) body share >= minBodyRate and against the baseline
// (bodyVsBaseline gt: higher, ge: not lower), less tolerance.bodyRead trials; (b) applied share not lower, less
// tolerance.applied trials; (c) overapplication count at most baseline + tolerance.overapplication (else negSlack).
// Shares, not counts, so a condition with fewer valid trials is compared fairly.
export function ruleChecks(baseline, candidate, {minBodyRate = 0.8, negSlack = 1, bodyVsBaseline = 'gt', tolerance = {}} = {}) {
  const tol = {bodyRead: 0, applied: 0, ...tolerance};
  const rate = (s, k) => (s.positives ? s[k] / s.positives : null);
  const slack = tolerance.overapplication ?? negSlack;
  const c = {
    bodyReadLevel: {value: `${candidate.bodyRead}/${candidate.positives} >= ${minBodyRate}`, pass: rate(candidate, 'bodyRead') !== null && rate(candidate, 'bodyRead') >= minBodyRate},
    [bodyVsBaseline === 'gt' ? 'bodyReadAboveBaseline' : 'bodyReadNotLower']: {value: `${candidate.bodyRead}/${candidate.positives} vs ${baseline.bodyRead}/${baseline.positives}${minus(tol.bodyRead)}`, pass: shareCmp(candidate.bodyRead, candidate.positives, baseline.bodyRead, baseline.positives, tol.bodyRead, bodyVsBaseline)},
    appliedNotLower: {value: `${candidate.applied}/${candidate.positives} vs ${baseline.applied}/${baseline.positives}${minus(tol.applied)}`, pass: shareCmp(candidate.applied, candidate.positives, baseline.applied, baseline.positives, tol.applied, 'ge')},
  };
  if (baseline.negatives !== undefined && candidate.negatives) c.overapplication = {value: `${candidate.overapplication}/${candidate.negatives} vs ${baseline.overapplication}/${baseline.negatives} + ${slack}`, pass: candidate.overapplication <= baseline.overapplication + slack};
  return c;
}

// Per case (the scenario kinds): applied share of the candidate not lower than the baseline's, less tol trials, each
// case on its own.
export function perCaseAppliedChecks(perCase, tol = 0) {
  return Object.fromEntries(Object.entries(perCase).map(([id, [b, c]]) => [id, {value: `${c.applied}/${c.positives} vs ${b.applied}/${b.positives}${minus(tol)}`, pass: shareCmp(c.applied, c.positives, b.applied, b.positives, tol, 'ge')}]));
}

// Efficiency on the common kinds: each per-trial mean of the candidate not higher than the baseline's.
export function efficiencyChecks(b, c, metrics) {
  return Object.fromEntries(metrics.map((m) => [m, {value: `${c.perTrial[m]} vs ${b.perTrial[m]}`, pass: typeof c.perTrial[m] === 'number' && typeof b.perTrial[m] === 'number' && c.perTrial[m] <= b.perTrial[m]}]));
}

// The decision. Not judged (rule of #1817): a run neither complete nor stopped at the cap, a condition without a valid
// positive or negative trial, a planned case without a valid trial, a missing mandatory replacement, failures above
// maxFailureRate of a condition's counted trials. The subsets are reported, not used, unless the rule names them
// (perCaseKinds, efficiency). rule.tolerance (toleranceOf) lowers the baseline in the checks by whole trials.
export function verdictOf(baseline, candidate, {completion = null, subsets = {}, perCase = null, efficiency = null, rule = {}} = {}) {
  const maxFailureRate = rule.maxFailureRate ?? 0.1;
  const reasons = [];
  if (!completion?.basis) reasons.push(`run neither complete nor stopped at the cap (${completion ? `${completion.missingPlanned} planned and ${completion.missingReplacements.length} required replacement(s) not reserved, spent ${completion.spentUsd} + ${completion.perTrialUsd} <= ${completion.stopLineUsd}` : 'no completion record'})`);
  for (const s of [baseline, candidate]) {
    if (s.runs === 0 || s.positives === 0) reasons.push(`${s.condition}: no valid positive trial`);
    else if (s.failures / s.runs > maxFailureRate) reasons.push(`${s.condition}: failures above ${maxFailureRate * 100}%`);
    if (!s.negatives) reasons.push(`${s.condition}: no valid negative trial`);
    if ((s.casesWithoutValidTrial ?? []).length) reasons.push(`${s.condition}: no valid trial for ${s.casesWithoutValidTrial.join(',')}`);
    if (s.replacementsMissing) reasons.push(`${s.condition}: ${s.replacementsMissing} failed trial(s) without the mandatory replacement`);
  }
  const tolerance = toleranceOf(rule);
  const opts = {minBodyRate: rule.minBodyRate ?? 0.8, negSlack: rule.negSlack ?? 1, bodyVsBaseline: rule.bodyVsBaseline ?? 'gt', tolerance: rule.tolerance ?? {}};
  const separate = Object.fromEntries(Object.entries(subsets).map(([name, [b, c]]) => [name, {[b.condition]: pick(b), [c.condition]: pick(c), checks: ruleChecks(b, c, opts)}]));
  const perCaseChecks = perCase ? perCaseAppliedChecks(perCase, tolerance.perScenarioApplied) : null;
  const efficiencyResult = efficiency ? {kinds: efficiency.kinds, [efficiency.b.condition]: efficiency.b.perTrial, [efficiency.c.condition]: efficiency.c.perTrial, checks: efficiencyChecks(efficiency.b, efficiency.c, efficiency.metrics)} : null;
  if (reasons.length) return {verdict: 'not-judged', reason: reasons.join('; '), completion, separate, perCase: perCaseChecks, efficiency: efficiencyResult};
  const checks = ruleChecks(baseline, candidate, opts);
  const all = [...Object.values(checks), ...Object.values(perCaseChecks ?? {}), ...Object.values(efficiencyResult?.checks ?? {})];
  return {verdict: all.every((x) => x.pass) ? 'adoption-candidate' : 'not-a-candidate', basis: completion.basis, completion, checks, perCase: perCaseChecks, efficiency: efficiencyResult, separate,
    note: 'With 4 runs per case small differences are not significant; adoption is the owner\'s decision. The separate subsets are reported, not used for the verdict.'};
}
// The #1820 stage-2 rule under its old name (bodyVsBaseline gt, no per-case or efficiency checks).
export const judge1820s2 = (baseline, candidate, {maxFailureRate = 0.1, completion = null, subsets = {}} = {}) => verdictOf(baseline, candidate, {completion, subsets, rule: {maxFailureRate, bodyVsBaseline: 'gt'}});
const pick = (s) => ({positives: s.positives, bodyRead: s.bodyRead, applied: s.applied, perCase: s.perCase, perTrial: s.perTrial, referenceReads: s.referenceReads, ...(s.negatives ? {negatives: s.negatives, overapplication: s.overapplication} : {})});

// A case filter from a subset definition of conditions.json subsets: {fixtures: [...]} and/or {kinds: [...]}.
export const subsetFilter = (def) => (k) => (!def.fixtures || def.fixtures.includes(k.fixture ?? 'A')) && (!def.kinds || def.kinds.includes(k.kind));
