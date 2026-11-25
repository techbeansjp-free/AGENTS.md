// Judges one isolation probe (run-trial.mjs case `probe`) before any measurement (#1814, owner requirement). No model call.
// All checks must pass for every condition; otherwise that condition is not measured. The model's answer is used only
// where it can be cross-checked against text it cannot know without the context (exact descriptions, CLAUDE.md first
// line, pointer text, the owner's own instruction/memory first lines) and only when the trace shows it did not Read,
// Grep or Glob those files. `compare` then checks that the conditions differ only by CLAUDE.md / hook output (review M1).
// Usage: node probe-check.mjs <probe-trial-dir> <condition> <home-marker> <repo-marker> <repo-root>
//        node probe-check.mjs compare <probe-result.json>...
// The output names no foreign text: the owner's instruction/memory lines are used for matching only and reported as counts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {parseTrace} from './score.mjs';
import {loadConditions, NEUTRAL_SUBJECT} from './apply-condition.mjs';
import {pointerExpectedI, pointerHeadI, productHookFiredInProbe} from './condition-i.mjs';

const ALLOWED_TOOLS = new Set(['Read', 'Glob', 'Grep', 'Skill', 'ToolSearch']);
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
  const others = (line.replace(/\\"ruleContent\\":\s*\\"[^"\\]+\\"/g, '').match(/(?<![\w.\-])\/[^\s"'`,)\\]+/g) ?? []);
  return others.length === 0;
}

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
//          repoRoot, hostInstallDir|null, installProblems[]}
export function checkProbe(i) {
  const cond = (i.conditionsOverride ?? loadConditions()).conditions[i.condition]; // override: tests of condition I only
  const t = parseTrace(i.trace);
  const checks = {};
  const add = (k, pass, detail) => { checks[k] = {pass: Boolean(pass), detail}; };
  const init = t.init ?? {};
  add('init', Boolean(t.init), t.init ? 'init event present' : 'no init event');
  add('cwd', init.cwd && path.resolve(init.cwd) === path.resolve(i.work), init.cwd ? 'compared' : null);
  const tools = init.tools ?? [];
  add('tools', tools.length > 0 && tools.every((x) => ALLOWED_TOOLS.has(x)), tools);
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
  const looked = t.uses.filter((u) => ['Read', 'Grep', 'Glob'].includes(u.name) && !isMarker(u) && /\.claude\/skills|\.agent-skill-chain|SKILL\.md/.test(JSON.stringify(u.input ?? {})));
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
  const expectPointer = cond.adopt ? pointerExpectedI(cond) : Boolean(cond.pointer || cond.hook === 'usage');
  const head = cond.adopt ? pointerHeadI : i.pointerHead;
  add('pointerMatchesCondition', text.includes(head) === expectPointer, {expectPointer});
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
  const isMarkerLine = (line) => i.markerPaths.some((m) => line.includes(m)) || isMarkerPermissionSuggestion(line, i.markerPaths);
  for (const line of (i.debug ?? '').split('\n')) {
    if (!/CLAUDE\.md|AGENTS\.md|MEMORY|memory|settings\.json|skills\//i.test(line) || isMarkerLine(line)) continue;
    // Stage-0 findings: (1) the managed-policy path contains a space, so it is removed as a whole before paths are taken;
    // (2) a project-relative path that starts with ".agent-skill-chain/" or ".claude/" (not preceded by a path character;
    // e.g. the pointer text ".agent-skill-chain/skills/asc/SKILL.md" echoed by the hook log line) is removed as a whole;
    // "/x/.claude/..." and "~/.claude/..." stay and are checked.
    const rest = MANAGED.reduce((l, m) => l.split(m).join(' '), line).replace(/(^|[^\w/.~-])\.(?:agent-skill-chain|claude)\/[^\s"'`,)\\]*/g, '$1 ');
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
  const foreignCommand = hookEvents.filter((e) => typeof e.command === 'string' && !e.command.includes('asc-read-trigger') && cond.hook !== 'product');
  const responses = hookEvents.filter((e) => e.subtype === 'hook_response' && (!nameOf(e) || /SessionStart/.test(nameOf(e)))).length;
  const fixtureHook = cond.hook === 'usage' || cond.hook === 'strong';
  add('hookMatchesCondition', fixtureHook ? hookLines.some((h) => h.source === 'startup') : cond.hook === 'product' ? productHookFiredInProbe(hookLines.length, responses) : hookLines.length === 0 && responses === 0,
    {logged: hookLines.length, responses});
  add('noForeignHooks', otherEvents.length === 0 && foreignCommand.length === 0 && (!fixtureHook || responses <= hookLines.length) && (cond.hook || responses === 0),
    `${hookEvents.length} hook event(s), ${otherEvents.length} non-SessionStart, ${foreignCommand.length} foreign command(s)`);
  return {condition: i.condition, pass: Object.values(checks).every((c) => c.pass), checks, listedSkills: listed.length, nonAscSkills: nonAsc,
    tools, gitLine: gitLine.replace(/^.*GIT:\s*/, ''), model: init.model ?? null, claudeCodeVersion: init.claude_code_version ?? null, costUsd: t.result?.total_cost_usd ?? null};
}

// Across conditions, only CLAUDE.md / hook output may differ: same tools, same Skill list, same git context (review M1).
export function hookEventsOf(trace) {
  return trace.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && e.type === 'system' && /^hook_/.test(String(e.subtype ?? '')));
}

// review L-7: the git line is compared as the set of commit subjects, not as the model's exact wording.
export const gitSubjects = (line) => [...new Set(String(line ?? '').split('|').map((x) => x.trim()).filter(Boolean))].sort();

export function compareProbes(results) {
  const keys = ['tools', 'nonAscSkills', 'gitLine', 'model'];
  const norm1 = (r, k) => (k === 'gitLine' ? gitSubjects(r[k]) : k === 'nonAscSkills' || k === 'tools' ? [...r[k]].sort() : r[k]);
  const differ = keys.filter((k) => new Set(results.map((r) => JSON.stringify(norm1(r, k)))).size > 1);
  return {pass: results.every((r) => r.pass) && differ.length === 0, conditions: results.map((r) => r.condition), differ};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  if (argv[0] === 'compare') {
    const out = compareProbes(argv.slice(1).map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))));
    console.log(JSON.stringify(out));
    process.exit(out.pass ? 0 : 1);
  }
  const [dirArg, condition, homeMarker, repoMarker, repoRoot] = argv;
  const dir = path.resolve(dirArg), work = fs.realpathSync(path.join(dir, 'work'));
  const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
  const ascSkills = Object.fromEntries(fs.readdirSync(path.join(work, '.claude/skills')).map((s) => [s, description(read(path.join(work, '.claude/skills', s, 'SKILL.md')))]));
  const base = loadConditions().baseClaudeMd;
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
    hostInstallDir, installProblems: installDirProblems(hostInstallDir, {realHome, userConfigDirs, repoRoot: path.resolve(repoRoot)})});
  console.log(JSON.stringify(out, null, 1));
  process.exit(out.pass ? 0 : 1);
}
