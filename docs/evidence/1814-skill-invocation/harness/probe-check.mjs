// Judges one isolation probe (run-trial.mjs case `probe`) before any measurement (#1814, owner requirement). No model call.
// All checks must pass for every condition; otherwise that condition is not measured. The model's answer is used only
// where it can be cross-checked against text it cannot know without the context (exact descriptions, CLAUDE.md first
// line, pointer text) and only when the trace shows it did not Read those files.
// Usage: node probe-check.mjs <probe-trial-dir> <condition> <home-marker> <repo-marker> <repo-root>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseTrace} from './score.mjs';
import {loadConditions} from './apply-condition.mjs';
import {spawnSync} from 'node:child_process';

const ALLOWED_TOOLS = new Set(['Read', 'Glob', 'Grep', 'Skill', 'ToolSearch']);
const MANAGED = ['/Library/Application Support/ClaudeCode/', '/etc/claude-code/'];
const norm = (s) => s.replace(/\s+/g, ' ').trim();
export function description(skillMd) {
  const m = /^---\n[\s\S]*?^description: (.+)$[\s\S]*?\n---/m.exec(skillMd);
  return m ? m[1].trim() : null;
}

// inputs: {trace, debug, stderr, hookLog|null, work, trialDir, condition, ascSkills: {name: description}, baseFirstLine,
//          pointerHead, forbiddenTexts[], tokens[], realHome, repoRoot, hostInstallDir|null}
// hostInstallDir is the Claude Code installation (it may sit under the real HOME); lines naming it are the program itself,
// not user configuration, and are excluded from the HOME check.
export function checkProbe(i) {
  const cond = loadConditions().conditions[i.condition];
  const t = parseTrace(i.trace);
  const checks = {};
  const add = (k, pass, detail) => { checks[k] = {pass: Boolean(pass), detail}; };
  const init = t.init ?? {};
  add('init', Boolean(t.init), t.init ? 'init event present' : 'no init event');
  add('cwd', init.cwd && path.resolve(init.cwd) === path.resolve(i.work), init.cwd ?? null);
  const tools = init.tools ?? [];
  add('tools', tools.length > 0 && tools.every((x) => ALLOWED_TOOLS.has(x)), tools);
  add('noMcp', (init.mcp_servers ?? []).length === 0, init.mcp_servers ?? []);
  add('noPlugins', (init.plugins ?? []).length === 0, init.plugins ?? []);
  const listed = (init.skills ?? []).map(String);
  const asc = Object.keys(i.ascSkills);
  const missing = asc.filter((s) => !listed.some((x) => x === s || x.endsWith(`:${s}`)));
  add('ascListed', listed.length > 0 && missing.length === 0, {missing});
  const text = t.text;
  // Descriptions quoted from the session's Skill list without reading the files.
  const readFiles = t.reads.filter((p) => /\.claude\/skills\/|\.agent-skill-chain\//.test(p));
  const desc = Object.fromEntries(['asc', 'user-journey-acceptance'].map((s) => {
    const line = text.split('\n').find((l) => l.includes(`DESC ${s}:`)) ?? '';
    return [s, norm(line).includes(norm(i.ascSkills[s] ?? '\u0000'))];
  }));
  add('descriptionsInContext', readFiles.length === 0 && Object.values(desc).every(Boolean), {desc, readFiles});
  add('descriptionsVerbatimCount', true, `${asc.filter((s) => norm(text).includes(norm(i.ascSkills[s]))).length}/${asc.length} (informational)`);
  // Instruction files: the sample project's CLAUDE.md, the pointer only when the condition adds it, nothing from elsewhere.
  add('projectClaudeMd', text.includes(i.baseFirstLine), i.baseFirstLine);
  const expectPointer = Boolean(cond.pointer || cond.hook === 'usage');
  add('pointerMatchesCondition', text.includes(i.pointerHead) === expectPointer, {expectPointer});
  const leaked = i.forbiddenTexts.filter((s) => text.includes(s));
  add('noForeignInstructions', leaked.length === 0, leaked);
  // Markers in the real HOME and in the ASC repository: never read, never in any record.
  const markerReads = t.uses.filter((u) => u.name === 'Read' && i.markerPaths.some((m) => String(u.input?.file_path ?? '').endsWith(path.basename(m))));
  const okMarkerReads = t.reads.filter((p) => i.markerPaths.some((m) => p.endsWith(path.basename(m))));
  add('markersAttempted', markerReads.length >= 2, markerReads.length);
  add('markersRefused', okMarkerReads.length === 0, okMarkerReads);
  const all = [i.trace, i.debug ?? '', i.stderr ?? ''].join('\n');
  add('markerTokensAbsent', i.tokens.every((tok) => !all.includes(tok)), null);
  // Debug log: instruction/memory/settings paths must be inside the trial (or the machine's managed-policy location).
  const outside = [];
  for (const line of (i.debug ?? '').split('\n')) {
    if (!/CLAUDE\.md|AGENTS\.md|MEMORY|memory|settings\.json|skills\//i.test(line)) continue;
    if (i.markerPaths.some((m) => line.includes(path.basename(m)))) continue;
    for (const p of line.match(/\/[^\s"'`,)]+/g) ?? []) {
      if (!/CLAUDE\.md|AGENTS\.md|MEMORY|memory|settings|skills/i.test(p)) continue;
      const inTrial = p.startsWith(i.trialDir) || p.startsWith(fs.existsSync(i.trialDir) ? fs.realpathSync(i.trialDir) : i.trialDir);
      const host = i.hostInstallDir && p.startsWith(i.hostInstallDir);
      if (!inTrial && !host && !MANAGED.some((m) => p.startsWith(m))) outside.push(p);
    }
  }
  add('debugPathsInsideTrial', i.debug !== null && outside.length === 0, i.debug === null ? 'no debug log' : [...new Set(outside)].slice(0, 20));
  const hostPaths = [i.realHome, i.repoRoot].filter((p) => (i.debug ?? '').split('\n').some((l) => l.includes(p) && !i.markerPaths.some((m) => l.includes(path.basename(m))) && !(i.hostInstallDir && l.split(i.hostInstallDir).join('').indexOf(p) < 0)));
  add('noRealHomeOrRepoInDebug', hostPaths.length === 0, hostPaths.length ? 'found' : null);
  // Hook delivery (log written by the fixture hook outside the project).
  const hookLines = (i.hookLog ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  add('hookMatchesCondition', cond.hook ? hookLines.some((h) => h.source === 'startup') : hookLines.length === 0, hookLines);
  const nonAsc = listed.filter((s) => !asc.some((a) => s === a || s.endsWith(`:${a}`)));
  return {condition: i.condition, pass: Object.values(checks).every((c) => c.pass), checks, listedSkills: listed.length, nonAscSkills: nonAsc,
    model: init.model ?? null, claudeCodeVersion: init.claude_code_version ?? null, costUsd: t.result?.total_cost_usd ?? null};
}

// Directory of the Claude Code installation that `claude` on PATH resolves to (e.g. .../share/claude), or null.
export function claudeInstallDir() {
  const w = spawnSync('which', ['claude'], {encoding: 'utf8'}).stdout?.trim();
  if (!w) return null;
  const real = fs.realpathSync(w);
  return path.dirname(path.dirname(real));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dirArg, condition, homeMarker, repoMarker, repoRoot] = process.argv.slice(2);
  const dir = path.resolve(dirArg), work = fs.realpathSync(path.join(dir, 'work'));
  const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
  const ascSkills = Object.fromEntries(fs.readdirSync(path.join(work, '.claude/skills')).map((s) => [s, description(read(path.join(work, '.claude/skills', s, 'SKILL.md')))]));
  const base = loadConditions().baseClaudeMd;
  const repoFirst = (f) => (read(path.join(repoRoot, f)) ?? '').split('\n')[0].replace(/^#\s*/, '');
  const out = checkProbe({trace: read(path.join(dir, 'trace.jsonl')) ?? '', debug: read(path.join(dir, 'debug.log')), stderr: read(path.join(dir, 'stderr.txt')),
    hookLog: read(path.join(dir, 'hook.jsonl')), work, trialDir: dir, condition, ascSkills, baseFirstLine: base.split('\n')[0],
    pointerHead: 'このプロジェクトでASCを使う', forbiddenTexts: [repoFirst('CLAUDE.md'), repoFirst('AGENTS.md')].filter(Boolean),
    markerPaths: [homeMarker, repoMarker], tokens: [homeMarker, repoMarker].map((m) => read(m)?.trim()).filter(Boolean),
    realHome: os.homedir(), repoRoot: path.resolve(repoRoot), hostInstallDir: claudeInstallDir()});
  console.log(JSON.stringify(out, null, 1));
  process.exit(out.pass ? 0 : 1);
}
