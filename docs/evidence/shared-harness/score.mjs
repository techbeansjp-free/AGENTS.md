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
// #1840: the distributed Skill names of the releases measured (conditions.json ascSkills, e.g. 17 with warranty-scope);
// without it the 16 names above.
export const ascSkillsOf = (conds) => conds?.ascSkills ?? ASC_SKILLS;
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

// #1840: a named check on a text: {pattern} or {all: [patterns]} must match, and {unless} (optional) must not.
export const groupOk = (g, text) => (g.all ?? [g.pattern]).every((p) => new RegExp(p, 'i').test(text)) && !(g.unless && new RegExp(g.unless, 'i').test(text));
const patternOf = (x) => (typeof x === 'string' ? x : x.pattern);
// #1840: answerQuota {min, groups: [{id, viewpoint, pattern | all, unless}]}: the groups that pass, by id.
export const markerGroupsOf = (k, text) => Object.fromEntries((k.answerQuota?.groups ?? []).map((g) => [g.id, groupOk(g, text)]));
// #1840: the deductions (answerNone: a pattern or {id, pattern}) found in a text, by id (or pattern).
export const markerDeductionsOf = (k, text) => (k.answerNone ?? []).filter((g) => new RegExp(patternOf(g), 'i').test(text)).map((g) => (typeof g === 'string' ? g : g.id));

export function markersOk(k, text) {
  const low = text.toLowerCase();
  return (k.answerAll ?? []).every((a) => low.includes(a.toLowerCase())) &&
    ((k.answerAny ?? []).length === 0 || k.answerAny.some((a) => new RegExp(a, 'i').test(text))) &&
    (k.answerGroups ?? []).every((g) => new RegExp(g, 'i').test(text)) &&
    // #1840: at least min of the named groups (calibrated against the earlier scoring, "k of n").
    // A group with report: true is shown in markerGroups but not counted (e.g. a viewpoint the Skill answers scored 0 on).
    (!k.answerQuota || k.answerQuota.groups.filter((g) => !g.report && groupOk(g, text)).length >= k.answerQuota.min) &&
    // #1840: a deduction of an earlier evaluation (e.g. a legal assertion) is a pattern that must not appear.
    markerDeductionsOf(k, text).length === 0;
}

// #1840: the checks of a writes definition on the texts of the files under its pathPattern. Each require/forbid entry
// {id, pattern, group?, viewpoint?}: the groups name what failed (e.g. facts, history, status) for the separate report.
export function writeChecks(w, files, fileText) {
  const texts = files.map((f) => (fileText ? fileText(f) : null));
  const all = texts.filter((x) => typeof x === 'string').join('\n');
  const out = {written: files, writeMissingText: texts.some((x) => typeof x !== 'string'),
    writeRequireMissing: (w.require ?? []).filter((e) => !new RegExp(e.pattern, 'i').test(all)).map((e) => e.id),
    writeViolations: (w.forbid ?? []).filter((e) => texts.some((x) => typeof x === 'string' && new RegExp(e.pattern, 'i').test(x))).map((e) => e.id)};
  const entries = [...(w.require ?? []), ...(w.forbid ?? [])];
  if (entries.some((e) => e.group)) {
    const failed = new Set([...out.writeRequireMissing, ...out.writeViolations]);
    out.writeFailedGroups = [...new Set(entries.filter((e) => failed.has(e.id)).map((e) => e.group ?? 'other'))];
  }
  return out;
}

// #1840: the files a trial wrote (a Write, Edit or MultiEdit with a non-error result), project-relative, in order.
export function writtenFiles(t) {
  const out = [];
  for (const u of t.uses) {
    if (!['Write', 'Edit', 'MultiEdit'].includes(u.name)) continue;
    const r = t.results.get(u.id);
    const rel = r && !r.is_error ? projectRelative(String(u.input?.file_path ?? ''), t.cwd) : null;
    if (rel && !out.includes(rel)) out.push(rel);
  }
  return out;
}

// #1840: the case-level checks beyond the Skill body (all optional; a case without them gets none of these fields):
// - expectReads [{id, pattern}]: each pattern (a regular expression on the project-relative path) matched by a counted Read;
// - forbidReads [{id, pattern}]: no counted Read matches (a rule that does not apply, a template that is not needed);
// - forbidSkills [name]: no Skill call, Claude Code entry or body Read of these Skills (ASC or the user's own);
// - writes {pathPattern, mustWrite, require: [re], forbid: [{id, pattern}]}: the files written under pathPattern, read
//   from the trial's work/ copy at the end (fileText), hold every require pattern (over all of them) and no forbid pattern
//   (the diff must not break a rule); mustWrite needs at least one such file.
export function caseChecks(k, rel, t, {fileText = null, skills = ASC_SKILLS} = {}) {
  const out = {};
  const hit = (p) => rel.some((r) => new RegExp(p).test(r));
  if (k.expectReads) { out.expectReads = Object.fromEntries(k.expectReads.map((e) => [e.id, hit(e.pattern)])); out.expectReadsAll = Object.values(out.expectReads).every(Boolean); }
  if (k.forbidReads) { out.forbiddenReads = k.forbidReads.filter((e) => hit(e.pattern)).map((e) => e.id); out.forbidReadsOk = out.forbiddenReads.length === 0; }
  if (k.forbidSkills) {
    out.forbiddenSkills = k.forbidSkills.filter((s) => t.skills.some((c) => same(c, s)) || rel.some((r) => r === `.claude/skills/${s}/SKILL.md` || (skills.includes(s) && new RegExp(`^\\.agent-skill-chain/(managed-runtime/)?skills/${esc(s)}/SKILL\\.md$`).test(r))));
    out.forbidSkillsOk = out.forbiddenSkills.length === 0;
  }
  if (k.writes) {
    const w = k.writes;
    const files = writtenFiles(t).filter((f) => new RegExp(w.pathPattern).test(f));
    Object.assign(out, writeChecks(w, files, fileText));
    out.writeOk = (!w.mustWrite || files.length > 0) && !out.writeMissingText && out.writeRequireMissing.length === 0 && out.writeViolations.length === 0;
    // #1840 review L3: a trial that wrote no file under pathPattern; its answer text against the require patterns (reported).
    if (!files.length && (w.require ?? []).length) out.writeRequireInAnswer = w.require.filter((e) => new RegExp(e.pattern, 'i').test(t.text)).map((e) => e.id);
  }
  // A case without these fields gets no field at all (so the rows of earlier configs are byte-identical).
  if (Object.keys(out).length) out.caseChecksOk = [out.expectReadsAll, out.forbidReadsOk, out.forbidSkillsOk, out.writeOk].every((x) => x !== false);
  // #1840 review H1: writesReport {pathPattern, require, forbid} is reported only (e.g. history in the change log), never in
  // caseChecksOk or a level.
  if (k.writesReport) {
    const r = writeChecks(k.writesReport, writtenFiles(t).filter((f) => new RegExp(k.writesReport.pathPattern).test(f)), fileText);
    out.writesReport = {written: r.written, requireMissing: r.writeRequireMissing, violations: r.writeViolations};
  }
  return out;
}

// #1840 review H3: per-trial facts reported, never used for a level (cases.json report: {reads: [{id, pattern}], answer:
// [{id, pattern}], writtenFiles: true}): which of those files were read, what the answer mentions, every file written.
export function reportOf(report, rel, t) {
  const out = {};
  if (report.reads) out.reads = Object.fromEntries(report.reads.map((e) => [e.id, rel.some((r) => new RegExp(e.pattern).test(r))]));
  if (report.answer) out.answer = Object.fromEntries(report.answer.map((e) => [e.id, new RegExp(e.pattern, 'i').test(t.text)]));
  if (report.writtenFiles) out.writtenFiles = writtenFiles(t);
  return out;
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
// ASC files: .agent-skill-chain/ and the Claude Code entries of the ASC Skills (#1840: a user's own Skill under
// .claude/skills/ is not an ASC file).
const ascFile = (r, skills) => /^\.agent-skill-chain\//.test(r) || skills.some((s) => r.startsWith(`.claude/skills/${s}/`));

export function scoreRun(spec, k, t, {level = null, condition = null, sizeOf = null, fileText = null, skills = ASC_SKILLS} = {}) {
  const pat = (key, s, r = '') => new RegExp(spec[key].replace('<skill>', esc(s)).replace('<ref>', esc(r)));
  const reads = countedReads(k, t);
  const rel = reads.map((r) => r.path);
  const ascBodies = skills.filter((s) => rel.some((r) => pat('bodyPattern', s).test(r)));
  const ascEntries = skills.filter((s) => rel.some((r) => pat('entryPattern', s).test(r)));
  const ascCalls = t.skills.filter((c) => skills.some((s) => same(c, s)));
  const row = {case: k.id, kind: k.kind, fixture: k.fixture ?? 'A', expect: k.expect, skills: t.skills, ascEntries, ascBodies, readAttempts: t.readAttempts, toolUses: t.uses.length,
    messages: t.messages.length, model: t.init?.model ?? null, initTools: t.init?.tools ?? null, permissionMode: t.init?.permissionMode ?? null,
    costUsd: t.result?.total_cost_usd ?? null, turns: t.result?.num_turns ?? null, durationMs: t.result?.duration_ms ?? null,
    usage: t.result?.usage ? {input: t.result.usage.input_tokens, output: t.result.usage.output_tokens, cacheRead: t.result.usage.cache_read_input_tokens, cacheWrite: t.result.usage.cache_creation_input_tokens} : null};
  row.inputTokens = inputTokensOf(row.usage);
  const ascFiles = [...new Set(rel.filter((r) => ascFile(r, skills)))].sort();
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
  // #1840 review M1: with cases.json markerText "answer+writes" the markers are matched on the answer and the text of every
  // file the trial wrote (read from its work/ copy at the end).
  const markerText = spec.markerText === 'answer+writes' && fileText ? [t.text, ...writtenFiles(t).map((f) => fileText(f)).filter((x) => typeof x === 'string')].join('\n') : t.text;
  row.markers = isDesign(k) ? true : markersOk(k, markerText);
  if (k.answerQuota) row.markerGroups = markerGroupsOf(k, markerText);
  if ((k.answerNone ?? []).length) row.markerDeductions = markerDeductionsOf(k, markerText);
  row.resultMissing = reads.some((r) => r.resultMissing);
  const touched = ascCalls.length > 0 || ascEntries.length > 0 || ascBodies.length > 0;
  const extra = caseChecks(k, rel, t, {fileText, skills});
  Object.assign(row, extra);
  if (spec.report) row.report = reportOf(spec.report, rel, t);
  // #1840 review M3: whether the session's Skill list (init) holds the user's own Skills the case names.
  const userNames = [...new Set([...(k.userSkill ? [k.expect] : []), ...(k.forbidSkills ?? [])])].filter((s) => s && !skills.includes(s));
  if (userNames.length) row.userSkillsListed = Object.fromEntries(userNames.map((n) => [n, (t.init?.skills ?? []).some((x) => same(String(x), n))]));
  if (k.expect) {
    const e = k.expect;
    // #1840: a user's own Skill (userSkill: true) has its whole body in .claude/skills/<name>/SKILL.md, which the Skill
    // tool loads; its Skill call or a Read of that file is the body.
    const ownBody = k.userSkill === true && (t.skills.some((s) => same(s, e)) || rel.includes(`.claude/skills/${e}/SKILL.md`));
    row.entryHop = t.skills.some((s) => same(s, e)) || ascEntries.includes(e);
    row.bodyRead = k.userSkill === true ? ownBody : ascBodies.includes(e);
    row.reach = row.entryHop || row.bodyRead;
    const refs = referencesFor(k, condition);
    row.references = refs;
    row.ascReferencesRead = [...new Set(rel.map((p) => new RegExp(spec.referencePattern.replace('<skill>', esc(e)).replace('<ref>', '(.+)')).exec(p)?.at(-1)).filter(Boolean))].sort();
    row.referenceRead = refs.length === 0 || refs.some((r) => rel.some((p) => pat('referencePattern', e, r).test(p)));
    row.applied = row.bodyRead && row.referenceRead && row.markers && extra.caseChecksOk !== false;
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
    // #1840: a negative case may also forbid a user's Skill or a rule file; negativeOk = none of it touched.
    if ('caseChecksOk' in extra) row.negativeOk = !touched && extra.caseChecksOk;
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
    runs.push({condition, run: Number(n), ...scoreRun(spec, k, t, {level: conds.toolLevels[conds.cells[condition].tools], condition, sizeOf: e.sizeOf ?? null, fileText: e.fileText ?? null, skills: ascSkillsOf(conds)})});
  }
  return selectCounted(runs, conds.runs);
}

// #1840: per check, the trials that have it and those that passed it ({n, ok}); negatives: negativeOk.
export function caseCounts(pos, neg) {
  const c = (xs, key, ok) => { const has = xs.filter((r) => key in r); return has.length ? {n: has.length, ok: has.filter(ok).length} : null; };
  const out = {expectReadsAll: c(pos, 'expectReadsAll', (r) => r.expectReadsAll), forbidReadsOk: c([...pos, ...neg], 'forbidReadsOk', (r) => r.forbidReadsOk), forbidSkillsOk: c([...pos, ...neg], 'forbidSkillsOk', (r) => r.forbidSkillsOk),
    writeOk: c(pos, 'writeOk', (r) => r.writeOk), negativeOk: c(neg, 'negativeOk', (r) => r.negativeOk)};
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
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
    // #1840 (cases.json expectReads, forbidReads, forbidSkills, writes, answerNone): counts over the cases that have them.
    ...caseCounts(pos, neg),
    replacementsMissing: n(rs, (r) => r.replacementMissing), casesWithoutValidTrial: ids.filter((id) => !ok.some((r) => r.case === id)),
    perCase: Object.fromEntries(spec.cases.filter((k) => ids.includes(k.id)).map((k) => [k.id, ok.filter((r) => r.case === k.id).sort((a, b) => a.run - b.run).map((r) => (k.expect ? (r.applied ? 'A' : r.bodyRead ? 'B' : r.entryHop ? 'E' : r.misselect ? 'M' : 'U') : (r.overapplication ? 'O' : '-'))).join('')])),
    referenceReads: Object.fromEntries(Object.entries(refReads).sort()),
    perTrial: {ascBytesRead: mean(nums((r) => r.ascBytesRead)), inputTokens: mean(nums((r) => r.inputTokens)), outputTokens: mean(nums((r) => r.usage?.output)), durationMs: mean(nums((r) => r.durationMs)), costUsd: mean(nums((r) => r.costUsd))},
    costUsd: Number(sum(all, (r) => r.costUsd).toFixed(4)), turns: sum(ok, (r) => r.turns), durationSec: Math.round(sum(ok, (r) => r.durationMs) / 1000)};
}

// The quality checks of the rule (conditions.json rule): (a) body share >= minBodyRate and against the baseline
// (bodyVsBaseline gt: higher, ge: not lower); (b) applied share not lower; (c) overapplication count at most baseline +
// negSlack. Shares, not counts, so a condition with fewer valid trials is compared fairly.
export function ruleChecks(baseline, candidate, {minBodyRate = 0.8, negSlack = 1, bodyVsBaseline = 'gt'} = {}) {
  const rate = (s, k) => (s.positives ? s[k] / s.positives : null);
  const cmp = (a, b, op) => a !== null && b !== null && (op === 'gt' ? a > b : a >= b);
  const c = {
    bodyReadLevel: {value: `${candidate.bodyRead}/${candidate.positives} >= ${minBodyRate}`, pass: rate(candidate, 'bodyRead') !== null && rate(candidate, 'bodyRead') >= minBodyRate},
    [bodyVsBaseline === 'gt' ? 'bodyReadAboveBaseline' : 'bodyReadNotLower']: {value: `${candidate.bodyRead}/${candidate.positives} vs ${baseline.bodyRead}/${baseline.positives}`, pass: cmp(rate(candidate, 'bodyRead'), rate(baseline, 'bodyRead'), bodyVsBaseline)},
    appliedNotLower: {value: `${candidate.applied}/${candidate.positives} vs ${baseline.applied}/${baseline.positives}`, pass: cmp(rate(candidate, 'applied'), rate(baseline, 'applied'), 'ge')},
  };
  if (baseline.negatives !== undefined && candidate.negatives) c.overapplication = {value: `${candidate.overapplication}/${candidate.negatives} vs ${baseline.overapplication}/${baseline.negatives} + ${negSlack}`, pass: candidate.overapplication <= baseline.overapplication + negSlack};
  return c;
}

// Per case (the scenario kinds): applied share of the candidate not lower than the baseline's, each case on its own.
export function perCaseAppliedChecks(perCase) {
  return Object.fromEntries(Object.entries(perCase).map(([id, [b, c]]) => {
    const rb = b.positives ? b.applied / b.positives : null, rc = c.positives ? c.applied / c.positives : null;
    return [id, {value: `${c.applied}/${c.positives} vs ${b.applied}/${b.positives}`, pass: rb !== null && rc !== null && rc >= rb}];
  }));
}

// Efficiency on the common kinds: each per-trial mean of the candidate not higher than the baseline's.
export function efficiencyChecks(b, c, metrics) {
  return Object.fromEntries(metrics.map((m) => [m, {value: `${c.perTrial[m]} vs ${b.perTrial[m]}`, pass: typeof c.perTrial[m] === 'number' && typeof b.perTrial[m] === 'number' && c.perTrial[m] <= b.perTrial[m]}]));
}

// The decision. Not judged (rule of #1817): a run neither complete nor stopped at the cap, a condition without a valid
// positive or negative trial, a planned case without a valid trial, a missing mandatory replacement, failures above
// maxFailureRate of a condition's counted trials. The subsets are reported, not used, unless the rule names them
// (perCaseKinds, efficiency).
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
  const opts = {minBodyRate: rule.minBodyRate ?? 0.8, negSlack: rule.negSlack ?? 1, bodyVsBaseline: rule.bodyVsBaseline ?? 'gt'};
  const separate = Object.fromEntries(Object.entries(subsets).map(([name, [b, c]]) => [name, {[b.condition]: pick(b), [c.condition]: pick(c), checks: ruleChecks(b, c, opts)}]));
  const perCaseChecks = perCase ? perCaseAppliedChecks(perCase) : null;
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

// #1840: the rule of a measurement that does not compare a candidate with a baseline but checks fixed levels in each
// condition (conditions.json rule.mode "levels"). rule.levels: [{id, cases: [case ids], metric, min}]; the rate of a
// level is the share of the counted valid trials of those cases that pass the metric, and it passes when there is at
// least one such trial and the rate is at least min. Metrics: positives reach (the expected Skill selected: its call,
// entry or body), bodyRead, referenceRead, expectReadsAll, markers, writeOk, applied; any case forbidReadsOk,
// forbidSkillsOk; negatives negativeOk, notOverapplied. The not-judged reasons are those of verdictOf. Each condition
// gets meets-levels when every level passes, else below-levels; the decision stays with the owner.
export const LEVEL_METRICS = {
  reach: (r) => r.expect && r.reach, bodyRead: (r) => r.expect && r.bodyRead, referenceRead: (r) => r.expect && r.reach && r.referenceRead,
  expectReadsAll: (r) => r.expectReadsAll === true, markers: (r) => r.markers === true, writeOk: (r) => r.writeOk === true, applied: (r) => r.expect && r.applied,
  forbidReadsOk: (r) => r.forbidReadsOk === true, forbidSkillsOk: (r) => r.forbidSkillsOk === true,
  negativeOk: (r) => !r.expect && (r.negativeOk ?? !r.overapplication), notOverapplied: (r) => !r.expect && !r.overapplication,
  // #1840 review H3: among the trials that wrote a file under the case's pathPattern, no rule violation (the trials that
  // wrote nothing are left out of the rate and counted as notEligible).
  writeCleanWhenWritten: (r) => (r.written ?? []).length > 0 && !r.writeMissingText && (r.writeViolations ?? []).length === 0,
};
// The trials a metric is rated on (all by default).
export const LEVEL_ELIGIBLE = {writeCleanWhenWritten: (r) => (r.written ?? []).length > 0};
export function levelChecks(runs, condition, levels) {
  return Object.fromEntries(levels.map((l) => {
    const f = LEVEL_METRICS[l.metric];
    if (!f) throw new Error(`unknown level metric ${l.metric}`);
    const all = runs.filter((r) => r.condition === condition && r.counted !== false && !r.failure && l.cases.includes(r.case));
    const rs = all.filter(LEVEL_ELIGIBLE[l.metric] ?? (() => true));
    const ok = rs.filter(f).length;
    return [l.id, {metric: l.metric, cases: l.cases, value: `${ok}/${rs.length} >= ${l.min}`, ok, n: rs.length, pass: rs.length > 0 && ok / rs.length >= l.min,
      ...(rs.length !== all.length ? {notEligible: all.length - rs.length} : {}), ...(l.use ? {use: l.use} : {}), ...(l.label ? {label: l.label} : {})}];
  }));
}
// #1840 review H3: a level with use "report" is computed and shown but does not enter the verdict of the condition.
export function levelsVerdict(sums, runs, {completion = null, rule = {}, subsets = {}} = {}) {
  const conds = Object.keys(sums);
  const pre = verdictOf(sums[conds[0]], sums[conds[1] ?? conds[0]], {completion, subsets, rule});
  const used = (rule.levels ?? []).filter((l) => l.use !== 'report'), reported = (rule.levels ?? []).filter((l) => l.use === 'report');
  const perCondition = Object.fromEntries(conds.map((c) => {
    const checks = levelChecks(runs, c, used);
    return [c, {verdict: Object.values(checks).every((x) => x.pass) ? 'meets-levels' : 'below-levels', checks, ...(reported.length ? {reported: levelChecks(runs, c, reported)} : {})}];
  }));
  if (pre.verdict === 'not-judged') return {verdict: 'not-judged', reason: pre.reason, completion, perCondition, separate: pre.separate};
  return {verdict: 'levels', basis: completion.basis, completion, perCondition, separate: pre.separate,
    note: 'Fixed levels per condition (release and candidate are reported side by side, not as a candidate test). Few runs per case; the decisions (merge of the candidate PRs, what to fix) are the owner\'s.'};
}
