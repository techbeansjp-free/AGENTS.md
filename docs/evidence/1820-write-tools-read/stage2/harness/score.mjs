// #1820 stage 2: scoring of the full trials (fixture A, #1817) and the truncated design trials (fixture D, three messages).
// From ../../../1817-skill-application/harness/score.mjs (kept: projectRelative incl. the redacted "<trial>/work" form,
// the path patterns, markersOk with answerGroups, entryHop / bodyRead / reach / referenceRead / applied / misselect /
// unselected / secondaryRead / overapplication, selectCounted = mandatory one-time replacements, summarize, perCase
// letters) and from ../../harness/score.mjs (stage 1; kept: messages grouped by message.id, the issued rule for a run
// stopped by --max-turns, initProblems = a trial whose init shows other tools or permission mode than level W is a failure).
// Changes: a design case (kind design, cases.json) is scored on the issued tool calls of its (at most three) messages; its
// markers are not applicable (no final answer) and true by definition; applied = the asc body and implementation.md or
// workspace.md. It also records the message of the first body read and whether a Write/Edit came before it. The
// decision rule of decision-criteria.md is judge1820s2 (the owner rule), with fixture A and D reported separately.
// No model call. Usage: node score.mjs <traces-dir> [--runs-json <out>]   (descriptive only; the decision is judge.mjs)
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConditions} from './apply-condition.mjs';

const ev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ev, f), 'utf8'));
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

export function scoreRun(spec, k, t, {level = null} = {}) {
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
    row.referenceRead = k.references.length === 0 || k.references.some((r) => rel.some((p) => pat('referencePattern', e, r).test(p)));
    row.applied = row.bodyRead && row.referenceRead && row.markers;
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

export function scoreDir(spec, dir, conds = loadConditions()) {
  const runs = [];
  for (const file of fs.readdirSync(dir).sort()) {
    const m = /^([A-Z]+)-(.+)-(\d+)\.jsonl(\.missing)?$/.exec(file);
    if (!m || !conds.cells[m[1]]) continue;
    const [, condition, id, n, missing] = m;
    const k = spec.cases.find((c) => c.id === id);
    if (!k) continue;
    const base = {condition, run: Number(n)};
    if (missing) { runs.push({...base, case: id, kind: k.kind, fixture: k.fixture ?? 'A', expect: k.expect, failure: 'missing trace'}); continue; }
    let t;
    try { t = parseTrace(fs.readFileSync(path.join(dir, file), 'utf8')); } catch (e) { runs.push({...base, case: id, kind: k.kind, fixture: k.fixture ?? 'A', expect: k.expect, failure: `unreadable trace: ${e.message}`}); continue; }
    runs.push({...base, ...scoreRun(spec, k, t, {level: conds.toolLevels[conds.cells[condition].tools]})});
  }
  return selectCounted(runs, conds.runs);
}

// One condition; `only` limits the positives to a subset of cases (fixture A or the design cases) for the separate reports.
export function summarize(spec, runs, condition, {only = null} = {}) {
  const ids = only ? spec.cases.filter(only).map((k) => k.id) : spec.cases.map((k) => k.id);
  const all = runs.filter((r) => r.condition === condition && ids.includes(r.case));
  const rs = all.filter((r) => r.counted !== false);
  const ok = rs.filter((r) => !r.failure), pos = ok.filter((r) => r.expect), neg = ok.filter((r) => !r.expect);
  const n = (xs, f) => xs.filter(f).length;
  const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) ?? 0), 0);
  return {condition, runs: rs.length, notCounted: all.length - rs.length, failures: n(rs, (r) => r.failure), stopped: n(ok, (r) => r.stopped),
    positives: pos.length, entryHop: n(pos, (r) => r.entryHop), reach: n(pos, (r) => r.reach), bodyRead: n(pos, (r) => r.bodyRead), referenceRead: n(pos, (r) => r.reach && r.referenceRead),
    applied: n(pos, (r) => r.applied), misselect: n(pos, (r) => r.misselect), unselected: n(pos, (r) => r.unselected),
    negatives: neg.length, overapplication: n(neg, (r) => r.overapplication), negMarkers: n(neg, (r) => r.markers),
    designWriteBeforeBody: n(pos, (r) => r.writeBeforeBody === true),
    replacementsMissing: n(rs, (r) => r.replacementMissing), casesWithoutValidTrial: ids.filter((id) => !ok.some((r) => r.case === id)),
    perCase: Object.fromEntries(spec.cases.filter((k) => ids.includes(k.id)).map((k) => [k.id, ok.filter((r) => r.case === k.id).sort((a, b) => a.run - b.run).map((r) => (k.expect ? (r.applied ? 'A' : r.bodyRead ? 'B' : r.entryHop ? 'E' : r.misselect ? 'M' : 'U') : (r.overapplication ? 'O' : '-'))).join('')])),
    costUsd: Number(sum(all, (r) => r.costUsd).toFixed(4)), turns: sum(ok, (r) => r.turns), durationSec: Math.round(sum(ok, (r) => r.durationMs) / 1000)};
}

// The owner rule (Issue #1820 owner decision 2026-11-26; decision-criteria.md rule 1). S is an adoption candidate iff, over
// the applicable cases (fixture A asc/purpose cases and the design cases together):
//   (a) bodyRead(S) / positives(S) >= 0.8 and bodyRead(S) / positives(S) > bodyRead(B) / positives(B);
//   (b) applied(S) / positives(S) >= applied(B) / positives(B);
//   (c) overapplication(S) <= overapplication(B) + 1 (counts, negative cases).
// Not judged (rule 1, from #1817): a run neither complete nor stopped at the cap, a condition without a valid positive or
// negative trial, a planned case without a valid trial, a missing mandatory replacement, failures above 10% of a
// condition's counted trials. The fixture A and design subsets are computed the same way and reported, not used.
export function ruleChecks(baseline, candidate, {minBodyRate = 0.8, negSlack = 1} = {}) {
  const rate = (s, k) => (s.positives ? s[k] / s.positives : null);
  const c = {
    bodyReadLevel: {value: `${candidate.bodyRead}/${candidate.positives} >= ${minBodyRate}`, pass: rate(candidate, 'bodyRead') !== null && rate(candidate, 'bodyRead') >= minBodyRate},
    bodyReadAboveBaseline: {value: `${candidate.bodyRead}/${candidate.positives} vs ${baseline.bodyRead}/${baseline.positives}`, pass: rate(candidate, 'bodyRead') !== null && rate(baseline, 'bodyRead') !== null && rate(candidate, 'bodyRead') > rate(baseline, 'bodyRead')},
    appliedNotLower: {value: `${candidate.applied}/${candidate.positives} vs ${baseline.applied}/${baseline.positives}`, pass: rate(candidate, 'applied') !== null && rate(baseline, 'applied') !== null && rate(candidate, 'applied') >= rate(baseline, 'applied')},
  };
  if (baseline.negatives !== undefined && candidate.negatives) c.overapplication = {value: `${candidate.overapplication}/${candidate.negatives} vs ${baseline.overapplication}/${baseline.negatives} + ${negSlack}`, pass: candidate.overapplication <= baseline.overapplication + negSlack};
  return c;
}

export function judge1820s2(baseline, candidate, {maxFailureRate = 0.1, completion = null, subsets = {}} = {}) {
  const reasons = [];
  if (!completion?.basis) reasons.push(`run neither complete nor stopped at the cap (${completion ? `${completion.missingPlanned} planned and ${completion.missingReplacements.length} required replacement(s) not reserved, spent ${completion.spentUsd} + ${completion.perTrialUsd} <= ${completion.stopLineUsd}` : 'no completion record'})`);
  for (const s of [baseline, candidate]) {
    if (s.runs === 0 || s.positives === 0) reasons.push(`${s.condition}: no valid positive trial`);
    else if (s.failures / s.runs > maxFailureRate) reasons.push(`${s.condition}: failures above ${maxFailureRate * 100}%`);
    if (!s.negatives) reasons.push(`${s.condition}: no valid negative trial`);
    if ((s.casesWithoutValidTrial ?? []).length) reasons.push(`${s.condition}: no valid trial for ${s.casesWithoutValidTrial.join(',')}`);
    if (s.replacementsMissing) reasons.push(`${s.condition}: ${s.replacementsMissing} failed trial(s) without the mandatory replacement`);
  }
  const separate = Object.fromEntries(Object.entries(subsets).map(([name, [b, c]]) => [name, {[b.condition]: pick(b), [c.condition]: pick(c), checks: ruleChecks(b, c)}]));
  if (reasons.length) return {verdict: 'not-judged', reason: reasons.join('; '), completion, separate};
  const checks = ruleChecks(baseline, candidate);
  return {verdict: Object.values(checks).every((x) => x.pass) ? 'adoption-candidate' : 'not-a-candidate', basis: completion.basis, completion, checks, separate,
    note: 'With 4 runs per case small differences are not significant; adoption is the owner\'s decision. The separate fixture A and design (D) checks are reported, not used for the verdict.'};
}
const pick = (s) => ({positives: s.positives, bodyRead: s.bodyRead, applied: s.applied, perCase: s.perCase, ...(s.negatives ? {negatives: s.negatives, overapplication: s.overapplication} : {})});

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--runs-json');
  const out = i >= 0 ? args.splice(i, 2)[1] : null;
  const spec = readJson('cases.json');
  const runs = scoreDir(spec, path.resolve(args[0]));
  if (out) fs.writeFileSync(out, JSON.stringify(runs, null, 1));
  for (const c of Object.keys(loadConditions().cells)) console.log(JSON.stringify(summarize(spec, runs, c)));
}
