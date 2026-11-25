// #1820: copied from docs/evidence/1817-skill-application/harness/probe-check.mjs. Changes: a probe belongs to a probe cell
// (one per tools level); the tools must be exactly the level's tools (ToolSearch tolerated) and the permission mode the
// level's; the pointer is always expected (every cell adopts the read trigger) and no hook; levels W and X: the Write
// outside the working directory was attempted, refused and left no file; level X: each Bash step was attempted, the
// write inside work/ succeeded (the sandbox auto-allow is in force, so the --settings file was applied), the marker reads
// and the writes outside were refused (no token in any record, no sentinel file), and the network request got no HTTP
// status; `compare` checks every other session fact (Skills, plugins, git context, model) and writes --out.
// Review M2/M3/L4 (#1820): the probe is the fixed step list of run-trial.mjs probeSteps for the level (recomputed from
// meta.json probeContext). Every step must be attempted and every attempt must have a tool_result (a missing result is a
// failure); a step expected refused needs positive evidence on every attempt (is_error, a non-zero exit, "Operation not
// permitted", a denial; for curl a non-zero exit or 000); a step expected ok must succeed. Level X also checks that
// `cat CLAUDE.md` in work/ printed the first line of work/CLAUDE.md (the sandbox allowRead of work/ works); git status in
// work/ is recorded (info, not judged). Review L2: each result records the trial and the sha256 of the trace and meta it
// read, and `compare` carries them, so run-trial.mjs can bind the comparison to the ledger settlements; `compare --drop X`
// is the pre-written comparison when X is dropped (conditions.json dropNote). Review L1: the raw conditions are used.
// Judges one isolation probe (run-trial.mjs case `probe`) before any measurement (#1814, owner requirement). No model call.
// All checks must pass for every condition; otherwise that condition is not measured. The model's answer is used only
// where it can be cross-checked against text it cannot know without the context (exact descriptions, CLAUDE.md first
// line, pointer text, the owner's own instruction/memory first lines) and only when the trace shows it did not Read,
// Grep or Glob those files. `compare` then checks that the conditions differ only by CLAUDE.md / hook output (review M1).
// Usage: node probe-check.mjs <probe-trial-dir> <condition> <home-marker> <repo-marker> <repo-root>
//        node probe-check.mjs compare <probe-result.json>... [--drop X] --out <runs-root>/probe-compare.json
// The output names no foreign text: the owner's instruction/memory lines are used for matching only and reported as counts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {parseTrace} from './score.mjs';
import {loadRawConditions, NEUTRAL_SUBJECT} from './apply-condition.mjs';
import {pointerHeadI} from './condition-i.mjs';
import {INSIDE_FILE, probeSteps} from './run-trial.mjs';

const TOLERATED_TOOLS = ['ToolSearch'];
const MANAGED = ['/Library/Application Support/ClaudeCode/', '/etc/claude-code/'];
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const stripHeading = (s) => s.replace(/^\s*#+\s*/, '').trim();
const inside = (child, parent) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
export function description(skillMd) {
  const m = /^---\n[\s\S]*?^description: (.+)$[\s\S]*?\n---/m.exec(skillMd);
  return m ? m[1].trim() : null;
}

// The Claude Code program directory: the directory of the real executable (e.g. .../claude/versions), never a
// directory that is, contains, or lies in the real HOME, a user config directory or the repository (review M2).
export function installDirProblems(dir, {realHome, userConfigDirs, repoRoot}) {
  if (!dir) return ['no Claude Code executable found'];
  const bad = [];
  for (const p of [realHome, ...userConfigDirs, repoRoot].filter(Boolean)) if (inside(p, dir)) bad.push(`program directory contains ${p === realHome ? 'the real HOME' : p === repoRoot ? 'the repository' : 'a user config directory'}`);
  for (const p of [...userConfigDirs, repoRoot].filter(Boolean)) if (inside(dir, p)) bad.push(`program directory lies in ${p === repoRoot ? 'the repository' : 'a user config directory'}`);
  return bad;
}
// Stage-0 finding: when the probe's deliberate marker Reads are denied, Claude Code logs one debug line
// 'Permission suggestions for Read: [...]' whose ruleContent values are "/" + a directory + "/**". Such a line is
// excluded only when every ruleContent is a marker file or the parent directory of a marker file, and the line holds no
// other absolute path. Nothing broader is excluded.
export function isMarkerPermissionSuggestion(line, markerPaths) {
  if (!line.includes('Permission suggestions for Read:')) return false;
  const rules = [...line.matchAll(/\\"ruleContent\\":\s*\\"([^"\\]+)\\"/g)].map((m) => m[1]);
  if (!rules.length) return false;
  const allowed = new Set(markerPaths.flatMap((m) => [path.resolve(m), path.dirname(path.resolve(m))]));
  const target = (r) => r.replace(/^\/(?=\/)/, '').replace(/\/\*\*$/, '');
  if (!rules.every((r) => allowed.has(target(r)))) return false;
  const others = (line.replace(/\\"ruleContent\\":\s*\\"[^"\\]+\\"/g, '').match(/(?<![\w.-])\/[^\s"'`,)\\]+/g) ?? []);
  return others.length === 0;
}

// True when the text still holds an absolute path (a '/' not inside a word or a relative path).
export const otherAbsolutePath = (text) => /(?<![\w.-])\/[^\s"'`,)\\]+/.test(text);

// Managed-policy files present on this machine (recorded with every probe result; review L2).
export const managedPolicyFiles = () => MANAGED.flatMap((d) => { try { return fs.readdirSync(d).map((f) => path.join(d, f)); } catch { return []; } });

export function claudeInstallDir() {
  const w = spawnSync('which', ['claude'], {encoding: 'utf8'}).stdout?.trim();
  return w ? path.dirname(fs.realpathSync(w)) : null;
}

// First non-empty line of each of the owner's own instruction/memory files and the names of the owner's Skills, read only
// to detect leakage (review M3). Covers ~/.claude and a parent CLAUDE_CONFIG_DIR. Never printed.
export function ownerCanaries(userConfigDirs) {
  const lines = [], skills = [];
  const first = (f) => { try { const l = fs.readFileSync(f, 'utf8').split('\n').map((x) => stripHeading(x)).find((x) => x.length >= 8); if (l) lines.push(l); } catch { /* absent */ } };
  for (const d of userConfigDirs) {
    first(path.join(d, 'CLAUDE.md'));
    try { for (const p of fs.readdirSync(path.join(d, 'projects'))) first(path.join(d, 'projects', p, 'memory', 'MEMORY.md')); } catch { /* none */ }
    try { skills.push(...fs.readdirSync(path.join(d, 'skills'))); } catch { /* none */ }
  }
  return {lines: [...new Set(lines)], skills: [...new Set(skills)]};
}

// inputs: {trace, debug|null, stderr, hookLog|null, work, trialDir, condition, ascSkills: {name: description},
//          baseFirstLine, pointerHead, forbiddenTexts[], ownerLines[], ownerSkills[], markerPaths[2], tokens[], realHome,
//          repoRoot, hostInstallDir|null, installProblems[]; #1820: sentinels {trial, repo}, insideExists (work/<INSIDE_FILE>
//          after the probe), sentinelExists {trial, repo} (after the probe)}
export function checkProbe(i) {
  const conds = i.conditionsOverride ?? loadRawConditions();
  const cellDef = conds.cells[i.condition];
  const levelId = cellDef?.tools ?? null;
  const level = levelId ? conds.toolLevels[levelId] : null;
  const t = parseTrace(i.trace);
  const checks = {};
  const add = (k, pass, detail) => { checks[k] = {pass: Boolean(pass), detail}; };
  const init = t.init ?? {};
  add('init', Boolean(t.init), t.init ? 'init event present' : 'no init event');
  add('cwd', init.cwd && path.resolve(init.cwd) === path.resolve(i.work), init.cwd ? 'compared' : null);
  const tools = init.tools ?? [];
  const want = (level?.tools ?? '').split(',').filter(Boolean).sort();
  add('tools', Boolean(level) && JSON.stringify(tools.filter((x) => !TOLERATED_TOOLS.includes(x)).sort()) === JSON.stringify(want), {tools, want});
  add('permissionMode', Boolean(level) && init.permissionMode === level.initPermissionMode, init.permissionMode ?? null);
  add('noMcp', (init.mcp_servers ?? []).length === 0, (init.mcp_servers ?? []).length);
  // Stage-0 finding: Claude Code lists its own bundled plugins (path "builtin", source "<name>@builtin") for every user.
  // Those are allowed and named; any other plugin fails.
  const plugins = init.plugins ?? [];
  const builtin = (pl) => pl && pl.path === 'builtin' && typeof pl.source === 'string' && pl.source === `${pl.name}@builtin`;
  add('noPlugins', plugins.every(builtin), {builtin: plugins.filter(builtin).map((pl) => pl.name), other: plugins.filter((pl) => !builtin(pl)).length});
  add('programDirectory', (i.installProblems ?? []).length === 0, i.installProblems ?? []);
  const listed = (init.skills ?? []).map(String);
  const asc = Object.keys(i.ascSkills);
  const missing = asc.filter((s) => !listed.some((x) => x === s || x.endsWith(`:${s}`)));
  add('ascListed', listed.length > 0 && missing.length === 0, {missing});
  const nonAsc = listed.filter((s) => !asc.some((a) => s === a || s.endsWith(`:${a}`)));
  const ownerSkillHits = nonAsc.filter((s) => i.ownerSkills.includes(s.replace(/^.*:/, '')));
  add('noOwnerSkills', ownerSkillHits.length === 0, `${ownerSkillHits.length} listed Skill name(s) match the owner's Skills`);
  const text = t.text;
  // Descriptions quoted from the session's Skill list without reading or searching the files (review L4).
  const isMarker = (u) => u.name === 'Read' && i.markerPaths.some((m) => path.resolve(String(u.input?.file_path ?? '')) === path.resolve(m));
  // #1820: a probe step (e.g. the Glob in the repository's .agent-skill-chain/local/) is not a look-up; Bash counts.
  const isStep = (u) => (i.steps ?? []).some((st) => stepMatches(st, u));
  const looked = t.uses.filter((u) => ['Read', 'Grep', 'Glob', 'Bash'].includes(u.name) && !isMarker(u) && !isStep(u) && /\.claude\/skills|\.agent-skill-chain|SKILL\.md/.test(JSON.stringify(u.input ?? {})));
  const desc = Object.fromEntries(['asc', 'user-journey-acceptance'].map((s) => {
    const line = text.split('\n').find((l) => l.includes(`DESC ${s}:`)) ?? '';
    return [s, norm(line).includes(norm(i.ascSkills[s] ?? '\u0000'))];
  }));
  add('descriptionsInContext', looked.length === 0 && Object.values(desc).every(Boolean), {desc, lookedUp: looked.length});
  add('descriptionsVerbatimCount', true, `${asc.filter((s) => norm(text).includes(norm(i.ascSkills[s]))).length}/${asc.length} (informational)`);
  // Instruction files: the sample project's CLAUDE.md, the pointer only when the condition adds it, nothing from elsewhere.
  add('projectClaudeMd', text.replace(/#/g, '').includes(stripHeading(i.baseFirstLine)), 'heading marks ignored (review L3)');
  // review N3: the probe asks for the first and the last line of each instruction source; the pointer is CLAUDE.md's last
  // paragraph (P) or the whole hook context (H), so it appears in the answer only when the condition delivers it.
  // #1820: every cell adopts the read trigger, so the pointer is always expected.
  add('pointerMatchesCondition', text.includes(pointerHeadI), {expectPointer: true});
  const leaked = i.forbiddenTexts.filter((s) => text.includes(s));
  add('noRepoInstructions', leaked.length === 0, `${leaked.length} repository instruction line(s) found`);
  const ownerLeaks = i.ownerLines.filter((s) => [text, i.debug ?? ''].some((x) => x.includes(s)));
  add('noOwnerInstructionsOrMemory', ownerLeaks.length === 0, `${ownerLeaks.length}/${i.ownerLines.length} owner line(s) found`);
  // Git context: if shown, only neutral subjects; nothing condition-specific (review M1).
  const gitLine = text.split('\n').find((l) => l.includes('GIT:')) ?? '';
  add('gitContextNeutral', !/read trigger|adopt/i.test(gitLine) && (!/GIT:\s*なし/.test(gitLine) ? gitLine.includes(NEUTRAL_SUBJECT) || !gitLine.trim() : true), gitLine ? 'checked' : 'no GIT line');
  // Markers in the real HOME and in the ASC repository: each attempted by its full path, refused, never in any record.
  const full = (u) => path.resolve(String(u.input?.file_path ?? ''));
  const attempts = i.markerPaths.map((m) => t.uses.filter((u) => u.name === 'Read' && full(u) === path.resolve(m)).length);
  add('markersAttempted', attempts.every((n) => n >= 1), attempts);
  const okMarkerReads = t.reads.filter((p) => i.markerPaths.some((m) => path.resolve(p) === path.resolve(m)));
  add('markersRefused', okMarkerReads.length === 0, okMarkerReads.length);
  const all = [i.trace, i.debug ?? '', i.stderr ?? ''].join('\n');
  add('markerTokensAbsent', i.tokens.length === 2 && i.tokens.every((tok) => tok && !all.includes(tok)), `${i.tokens.length} token(s) checked (review L2: both required)`);
  // Debug log: instruction/memory/settings paths must be inside the trial, the program directory or the managed location.
  const outside = [];
  // A line that names a marker is excluded only when no other absolute path is on it (review L3).
  // #1820: the sentinel paths the probe writes to on purpose are treated like the markers.
  const markerLike = [...i.markerPaths, ...Object.values(i.sentinels ?? {})];
  const stepPaths = stepPathsOf(i.steps ?? []);
  const isMarkerLine = (line) => (markerLike.some((m) => line.includes(m)) && !otherAbsolutePath(markerLike.reduce((l, m) => l.split(m).join(' '), line)))
    || isMarkerPermissionSuggestion(line, markerLike) || isProbeStepLine(line, stepPaths);
  for (const line of (i.debug ?? '').split('\n')) {
    if (!/CLAUDE\.md|AGENTS\.md|MEMORY|memory|settings\.json|skills\//i.test(line) || isMarkerLine(line)) continue;
    // Stage-0 findings: (1) the managed-policy path contains a space, so it is removed as a whole before paths are taken;
    // (2) a project-relative path that starts with ".agent-skill-chain/" or ".claude/" (not preceded by a path character;
    // e.g. the pointer text ".agent-skill-chain/skills/asc/SKILL.md" echoed by the hook log line) is removed as a whole;
    // "/x/.claude/..." and "~/.claude/..." stay and are checked.
    // The managed-policy path is removed only on the "missing file / broken symlink" lines (review L2); a managed file
    // that exists and is loaded stays visible (and its presence is recorded in managedPolicyPresent).
    const missingLine = /Broken symlink or missing file/i.test(line);
    const rest = (missingLine ? MANAGED.reduce((l, m) => l.split(m).join(' '), line) : line).replace(/(^|[^\w/.~-])\.(?:agent-skill-chain|claude)\/[^\s"'`,)\\]*/g, '$1 ');
    for (const p of rest.match(/\/[^\s"'`,)]+/g) ?? []) {
      if (!/CLAUDE\.md|AGENTS\.md|MEMORY|memory|settings|skills/i.test(p)) continue;
      const inTrial = inside(p, i.trialDir) || (fs.existsSync(i.trialDir) && inside(p, fs.realpathSync(i.trialDir)));
      const program = i.hostInstallDir && (i.installProblems ?? []).length === 0 && inside(p, i.hostInstallDir);
      if (!inTrial && !program && !MANAGED.some((m) => p.startsWith(m))) outside.push(p);
    }
  }
  add('debugPathsInsideTrial', i.debug !== null && outside.length === 0, i.debug === null ? 'no debug log' : `${new Set(outside).size} outside path(s)`);
  const programOk = i.hostInstallDir && (i.installProblems ?? []).length === 0;
  const hostPaths = [i.realHome, i.repoRoot].filter((p) => (i.debug ?? '').split('\n').some((l) => !isMarkerLine(l) && (programOk ? l.split(i.hostInstallDir).join('') : l).includes(p)));
  add('noRealHomeOrRepoInDebug', i.debug !== null && hostPaths.length === 0, `${hostPaths.length} found`);
  // Hooks: the fixture hook log matches the condition, and the trace shows no hook other than the condition's (review M3).
  const hookLines = (i.hookLog ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  // review L-1: hook events are classified by their event name; only SessionStart may appear, and no more SessionStart
  // responses than the fixture hook logged (fixture hooks), at least one for the product hook, none without a hook.
  // The exact event shape is first seen at stage 0; an unknown shape makes this fail (safe side) and is reported.
  const hookEvents = hookEventsOf(i.trace);
  const nameOf = (e) => String(e.hook_event_name ?? e.hook_event ?? e.hook_name ?? '');
  const otherEvents = hookEvents.filter((e) => nameOf(e) && !/SessionStart/.test(nameOf(e)));
  const foreignCommand = hookEvents.filter((e) => typeof e.command === 'string');
  const responses = hookEvents.filter((e) => e.subtype === 'hook_response' && (!nameOf(e) || /SessionStart/.test(nameOf(e)))).length;
  // #1820: no cell has a hook.
  add('hookMatchesCondition', hookLines.length === 0 && responses === 0, {logged: hookLines.length, responses});
  add('noForeignHooks', otherEvents.length === 0 && foreignCommand.length === 0 && responses === 0,
    `${hookEvents.length} hook event(s), ${otherEvents.length} non-SessionStart, ${foreignCommand.length} foreign command(s)`);
  const stepped = probeStepChecks(i, t, levelId);
  Object.assign(checks, stepped.checks);
  return {condition: i.condition, trial: i.trialName ?? path.basename(i.trialDir), traceSha256: i.traceSha256 ?? null, metaSha256: i.metaSha256 ?? null,
    pass: Object.values(checks).every((c) => c.pass), checks, info: stepped.info, steps: (i.steps ?? []).length, listedSkills: listed.length, nonAscSkills: nonAsc,
    builtinPlugins: plugins.filter(builtin).map((pl) => pl.name).sort(), managedPolicyPresent: i.managedPolicyPresent ?? null,
    tools, gitLine: gitLine.replace(/^.*GIT:\s*/, ''), model: init.model ?? null, claudeCodeVersion: init.claude_code_version ?? null, costUsd: t.result?.total_cost_usd ?? null};
}

// #1820 (review M2/M3/L4): the probe steps of run-trial.mjs probeSteps against the trace.
const unquote = (x) => String(x).replace(/['"]/g, '').replace(/\s+/g, ' ').trim();
export function stepMatches(step, u) {
  if (u.name !== step.tool) return false;
  const inp = u.input ?? {};
  if (step.tool === 'Read' || step.tool === 'Write') return path.resolve(String(inp.file_path ?? '')) === path.resolve(step.path);
  if (step.tool === 'Glob' || step.tool === 'Grep') return JSON.stringify(inp).includes(step.path);
  if (step.tool === 'Bash') return unquote(inp.command ?? '').includes(unquote(step.command));
  return false;
}

// The text of a tool_result (a string, or the text parts of a content array).
export const resultText = (r) => (typeof r?.content === 'string' ? r.content : Array.isArray(r?.content) ? r.content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('\n') : JSON.stringify(r?.content ?? ''));

// Positive evidence that a step was refused. A missing result is never evidence.
export function refusalEvidence(step, r) {
  if (!r) return false;
  const text = resultText(r);
  if (step.id === 'network') return r.is_error === true || /^\s*0{3}\s*$/.test(text.replace(/^"|"$/g, '')) || /exit code [1-9]/i.test(text);
  return r.is_error === true || /operation not permitted|permission denied|not permitted|denied|not allowed|haven't granted|blocked|拒否|exit code [1-9]/i.test(text);
}

const firstLine = (x) => String(x ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';

// Absolute paths named by the probe steps (a debug line that names only these is the probe's own line).
export const stepPathsOf = (steps) => [...new Set(steps.flatMap((st) => [st.path, ...(st.command ? (st.command.match(/(?<![\w.-])\/[^\s"'`,)\\]+/g) ?? []) : [])]).filter(Boolean))];
export function isProbeStepLine(line, stepPaths) {
  const tokens = line.match(/(?<![\w.-])\/[^\s"'`,)\\]+/g) ?? [];
  return tokens.length > 0 && tokens.every((tok) => stepPaths.includes(tok) || stepPaths.includes(tok.replace(/[.:;]+$/, '')));
}

export function probeStepChecks(i, t, levelId) {
  const checks = {}, info = {};
  const add = (k, pass, detail) => { checks[k] = {pass: Boolean(pass), detail}; };
  const steps = i.steps ?? [];
  add('probeStepsDefined', levelId && steps.length > 0 && steps.length === (i.expectedSteps ?? steps.length), {steps: steps.length, expected: i.expectedSteps ?? null});
  const resultOf = (u) => t.results.get(u.id) ?? null;
  const attempts = Object.fromEntries(steps.map((st) => [st.id, t.uses.filter((u) => stepMatches(st, u))]));
  const ids = (f) => steps.filter(f).map((st) => st.id);
  add('probeStepsAttempted', ids((st) => !attempts[st.id].length).length === 0, {missing: ids((st) => !attempts[st.id].length)});
  // review M3: every attempt of every step has a tool_result; a missing result is a failure.
  add('probeStepResults', ids((st) => attempts[st.id].some((u) => !resultOf(u))).length === 0, {withoutResult: ids((st) => attempts[st.id].some((u) => !resultOf(u)))});
  const notRefused = ids((st) => st.expect === 'refused' && (!attempts[st.id].length || !attempts[st.id].every((u) => refusalEvidence(st, resultOf(u)))));
  add('probeStepsRefused', notRefused.length === 0, {withoutRefusalEvidence: notRefused});
  const notOk = ids((st) => st.expect === 'ok' && !attempts[st.id].some((u) => resultOf(u) && resultOf(u).is_error !== true));
  add('probeStepsSucceeded', notOk.length === 0, {failed: notOk});
  if (levelId === 'W' || levelId === 'X') add('sentinelsAbsent', i.sentinelExists && !i.sentinelExists.trial && !i.sentinelExists.repo, i.sentinelExists ?? 'not checked');
  if (levelId !== 'X') return {checks, info};
  // The write inside work/ ran (sandboxed commands are auto-allowed only when the --settings sandbox is in force).
  add('sandboxInsideWrite', i.insideExists === true, i.insideExists ?? 'not checked');
  // review M2: the sandbox denies reads of the runs root but re-allows work/: cat CLAUDE.md printed its first line.
  const catMd = steps.find((st) => st.id === 'insideCatClaudeMd');
  const mdOut = (catMd ? attempts[catMd.id] : []).map(resultOf).filter((r) => r && r.is_error !== true).map((r) => firstLine(resultText(r)));
  add('allowReadWork', Boolean(i.workClaudeMdFirstLine) && mdOut.includes(i.workClaudeMdFirstLine), {matched: mdOut.includes(i.workClaudeMdFirstLine)});
  // No HTTP status came back from the network request (a status means the request left the machine).
  const net = steps.find((st) => st.id === 'network');
  const statuses = (net ? attempts[net.id] : []).filter((u) => resultOf(u) && resultOf(u).is_error !== true && /^\s*[1-5][0-9]{2}\s*$/.test(resultText(resultOf(u)).replace(/^"|"$/g, '')));
  add('networkBlocked', net && attempts[net.id].length >= 1 && statuses.length === 0, statuses.length);
  // git in work/ inside the sandbox: recorded only (README: residual risks).
  const git = steps.find((st) => st.id === 'insideGitStatus');
  const gr = (git ? attempts[git.id] : []).map(resultOf);
  info.insideGitStatus = {attempted: gr.length, resultPresent: gr.filter(Boolean).length, ok: gr.some((r) => r && r.is_error !== true), firstLine: gr.filter(Boolean).map((r) => firstLine(resultText(r)).slice(0, 120))[0] ?? null};
  return {checks, info};
}

// Across conditions, only CLAUDE.md / hook output may differ: same tools, same Skill list, same git context (review M1).
export function hookEventsOf(trace) {
  return trace.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && e.type === 'system' && /^hook_/.test(String(e.subtype ?? '')));
}

// review L-7: the git line is compared as the set of commit subjects, not as the model's exact wording.
// The model may or may not prefix each subject with an abbreviated commit id; only the subjects are compared.
export const gitSubjects = (line) => [...new Set(String(line ?? '').split('|').map((x) => x.trim().replace(/^[0-9a-f]{7,40}\s+/, '').trim()).filter(Boolean))].sort();

export function compareProbes(results, {drop = null, conds = loadRawConditions()} = {}) {
  // #1820: the probe cells differ in their tools level by design (each probe is checked against its level), so tools is
  // not compared; every other session fact must be the same.
  // Review L1: with --drop X the probe cells of X must have failed and are left out of the comparison of session facts.
  // Review L2: each probe's trial and trace/meta sha256 are carried for the ledger binding (order.mjs probeCompareProblems).
  if (drop && !(conds.droppableLevels ?? []).includes(drop)) throw new Error(`tools level ${drop} may not be dropped`);
  const isDropped = (r) => Boolean(drop) && conds.cells[r.condition]?.tools === drop;
  const kept = results.filter((r) => !isDropped(r));
  const keys = ['nonAscSkills', 'builtinPlugins', 'gitLine', 'model'];
  const norm1 = (r, k) => (k === 'gitLine' ? gitSubjects(r[k]) : ['nonAscSkills', 'tools', 'builtinPlugins'].includes(k) ? [...(r[k] ?? [])].sort() : r[k]);
  const differ = keys.filter((k) => new Set(kept.map((r) => JSON.stringify(norm1(r, k)))).size > 1);
  const droppedOk = results.filter(isDropped).every((r) => r.pass === false) && (!drop || results.some(isDropped));
  return {pass: kept.length > 0 && kept.every((r) => r.pass) && differ.length === 0 && droppedOk, conditions: results.map((r) => r.condition), differ, dropped: drop ?? null,
    probes: results.map((r) => ({condition: r.condition, trial: r.trial ?? null, pass: r.pass, traceSha256: r.traceSha256 ?? null, metaSha256: r.metaSha256 ?? null}))};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  if (argv[0] === 'compare') {
    const oi = argv.indexOf('--out'), di = argv.indexOf('--drop');
    const files = argv.slice(1).filter((a, k, xs) => !['--out', '--drop'].includes(a) && !['--out', '--drop'].includes(xs[k - 1]));
    const out = compareProbes(files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))), {drop: di >= 0 ? argv[di + 1] : null});
    if (oi >= 0) fs.writeFileSync(argv[oi + 1], JSON.stringify(out, null, 1) + '\n');
    console.log(JSON.stringify(out));
    process.exit(out.pass ? 0 : 1);
  }
  const [dirArg, condition, homeMarker, repoMarker, repoRoot] = argv;
  const dir = path.resolve(dirArg), work = fs.realpathSync(path.join(dir, 'work'));
  const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
  const ascSkills = Object.fromEntries(fs.readdirSync(path.join(work, '.claude/skills')).map((s) => [s, description(read(path.join(work, '.claude/skills', s, 'SKILL.md')))]));
  const conds = loadRawConditions();
  const base = conds.fixtures[conds.cells[condition]?.fixture ?? 'A'].baseClaudeMd ?? '';
  const meta = JSON.parse(read(path.join(dir, 'meta.json')) ?? '{}');
  const sentinels = meta.probeSentinels ?? {};
  const ctx = meta.probeContext ?? null;
  const levelId = conds.cells[condition]?.tools ?? null;
  if (!ctx || path.resolve(ctx.homeMarker) !== path.resolve(homeMarker) || path.resolve(ctx.repoMarker) !== path.resolve(repoMarker)) {
    console.error('refused: meta.json has no probe context, or its markers are not the ones given'); process.exit(3);
  }
  const fileSha = (f) => (fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : null);
  const repoFirst = (f) => stripHeading((read(path.join(repoRoot, f)) ?? '').split('\n')[0]);
  const realHome = os.homedir();
  const userConfigDirs = [...new Set([path.join(realHome, '.claude'), process.env.CLAUDE_CONFIG_DIR].filter(Boolean).map((p) => path.resolve(p)))];
  const owner = ownerCanaries(userConfigDirs);
  const hostInstallDir = claudeInstallDir();
  const out = checkProbe({trace: read(path.join(dir, 'trace.jsonl')) ?? '', debug: read(path.join(dir, 'debug.log')), stderr: read(path.join(dir, 'stderr.txt')),
    hookLog: read(path.join(dir, 'hook.jsonl')), work, trialDir: dir, condition, ascSkills, baseFirstLine: base.split('\n')[0],
    pointerHead: 'このプロジェクトでASCを使う', forbiddenTexts: [repoFirst('CLAUDE.md'), repoFirst('AGENTS.md')].filter(Boolean),
    ownerLines: owner.lines, ownerSkills: owner.skills, markerPaths: [homeMarker, repoMarker],
    tokens: [homeMarker, repoMarker].map((m) => read(m)?.trim()).filter(Boolean), realHome, repoRoot: path.resolve(repoRoot),
    hostInstallDir, installProblems: installDirProblems(hostInstallDir, {realHome, userConfigDirs, repoRoot: path.resolve(repoRoot)}),
    managedPolicyPresent: managedPolicyFiles().map((f) => path.basename(f)),
    sentinels, sentinelExists: {trial: Boolean(sentinels.trial && fs.existsSync(sentinels.trial)), repo: Boolean(sentinels.repo && fs.existsSync(sentinels.repo))},
    insideExists: fs.existsSync(path.join(work, meta.probeInsideFile ?? INSIDE_FILE)),
    steps: levelId ? probeSteps(levelId, ctx) : [], expectedSteps: levelId ? conds.probeSteps?.[levelId] ?? null : null,
    workClaudeMdFirstLine: firstLine(read(path.join(work, 'CLAUDE.md'))),
    trialName: path.basename(dir), traceSha256: fileSha(path.join(dir, 'trace.jsonl')), metaSha256: fileSha(path.join(dir, 'meta.json'))});
  console.log(JSON.stringify(out, null, 1));
  process.exit(out.pass ? 0 : 1);
}
