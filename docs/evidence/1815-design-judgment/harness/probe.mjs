// Isolation probe for #1815 (approach of #1814 probe-check.mjs and markers.mjs, adapted to the generation setup: the
// #1807 tools and the browser MCP server). One probe per condition, before the first planned trial, with exactly the
// launch of a measurement trial (run-trial.mjs case `probe`: same sample project build, HOME/config, tools, MCP, model),
// plus a debug log. The model is asked what its context holds and to Read two marker files; the judgement uses only what
// can be cross-checked (init event, debug log, exact texts it cannot know otherwise, tool results).
//
// Gate (owner decision pending): the markers are temporary files in the real HOME and in this repository's git-ignored
// .agent-skill-chain/local/. They are created, and a probe runs, only when results/probe-approval.json is committed with
// {"ownerConfirmed": true, "at": "...", "reference": "..."} recorded by the coordinator.
//
// Usage: node probe.mjs markers create <repo-root> --ledger <ledger> | markers remove <repo-root>
//        node probe.mjs check <probe-trial-dir> <condition> <home-marker> <repo-marker> <repo-root>  (writes probe-check.json)
//        node probe.mjs compare <probe-check.json>... [--out <runs-root>/probe/compare.json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {description, installDirProblems, isMarkerPermissionSuggestion, otherAbsolutePath, managedPolicyFiles, claudeInstallDir, ownerCanaries, hookEventsOf, gitSubjects} from '../../1814-skill-invocation/harness/probe-check.mjs';
import {parseStream} from '../../1807-design-eval-browser/harness/core-steps.mjs';
import {ev} from './pairing.mjs';
import {EXPECTED_INIT_TOOLS} from './run-trial.mjs';

export const POINTER_HEAD = 'このプロジェクトでASCを使う';
export const SAMPLE_SUBJECTS = ['Install ASC', 'initial'];
const MANAGED = ['/Library/Application Support/ClaudeCode/', '/etc/claude-code/'];
const inside = (child, parent) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

export function approvalProblems(root = ev) {
  const f = path.join(root, 'results/probe-approval.json');
  if (!fs.existsSync(f)) return ['results/probe-approval.json is missing (the owner has not confirmed the probe)'];
  const a = JSON.parse(fs.readFileSync(f, 'utf8'));
  const p = [];
  if (a.ownerConfirmed !== true || !a.at || !a.reference) p.push('results/probe-approval.json lacks ownerConfirmed/at/reference');
  const st = spawnSync('git', ['status', '--porcelain', '--', 'results/probe-approval.json'], {cwd: root, encoding: 'utf8'});
  if (st.status !== 0 || st.stdout.trim()) p.push('results/probe-approval.json is not committed');
  return p;
}

export const markerPaths = (repoRoot) => ({
  home: path.join(os.homedir(), 'asc1815-home-marker.txt'),
  repo: path.join(path.resolve(repoRoot), '.agent-skill-chain/local/asc1815-repo-marker.txt'),
});

export function probePrompt(homeMarker, repoMarker) {
  return ['これは評価環境の確認です。作業はしないでください。fileを作らず、browserのtoolも使わず、toolは下の4と5のReadだけを使い、次の順に答えてください。',
    '1. このsessionのContextに含まれている指示ファイル・memory（CLAUDE.md、AGENTS.md、memoryの索引、SessionStart等で追加された文脈を含む）をすべて挙げ、それぞれの出所と、最初の1行と最後の1行（空行を除く）を原文のまま書いてください。無ければ「なし」と書いてください。',
    '2. 使えるSkillの一覧を、名前とdescriptionの原文のまま、すべて書いてください（fileを読まずに、Contextにある一覧から）。',
    '3. 2のうち、名前が asc と user-journey-acceptance のSkillのdescriptionを、それぞれ「DESC asc: <原文>」「DESC user-journey-acceptance: <原文>」の形で1行ずつ書いてください。',
    `4. Readで ${homeMarker} を読む。`, `5. Readで ${repoMarker} を読む。`,
    '6. 4と5の結果（読めたか、拒否されたか）を1行ずつ書いてください。',
    '7. Contextにgitの状態（branch、最近のcommitの件名等）があれば、「GIT: 」で始めて、最近のcommitの件名を原文のまま「 | 」区切りで1行に書いてください。無ければ「GIT: なし」と書いてください。',
    '8. Contextの指示ファイルに、.agent-skill-chain/skills/asc/SKILL.md というpathを含む文があれば、その文を原文のまま「READ-TRIGGER: 」で始めて1行で書いてください。無ければ「READ-TRIGGER: なし」と書いてください。'].join('\n');
}

function traceParts(text) {
  const {events} = parseStream(text);
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init') ?? null;
  const results = new Map();
  for (const e of events) if (e.type === 'user' && Array.isArray(e.message?.content)) for (const c of e.message.content) if (c?.type === 'tool_result') results.set(c.tool_use_id, c);
  const uses = events.filter((e) => e.type === 'assistant').flatMap((e) => (e.message?.content ?? []).filter((c) => c?.type === 'tool_use'));
  const texts = events.filter((e) => e.type === 'assistant').flatMap((e) => (e.message?.content ?? []).filter((c) => c?.type === 'text').map((c) => c.text));
  const result = events.findLast((e) => e.type === 'result') ?? null;
  const okRead = (u) => { const r = results.get(u.id); return u.name === 'Read' && Boolean(r) && r.is_error !== true; };
  return {init, uses, okReads: uses.filter(okRead).map((u) => String(u.input?.file_path ?? '')), text: [...texts, typeof result?.result === 'string' ? result.result : ''].join('\n'), result};
}

// inputs: {trace, debug|null, stderr, fixture, trialDir, ascSkills {name: description}, forbiddenTexts[], ownerLines[],
//          ownerSkills[], markerPaths[2], tokens[], realHome, repoRoot, hostInstallDir, installProblems[]}
export function checkProbe(i) {
  const t = traceParts(i.trace);
  const checks = {};
  const add = (k, pass, detail = null) => { checks[k] = {pass: Boolean(pass), detail}; };
  const init = t.init ?? {};
  add('init', Boolean(t.init));
  add('cwd', init.cwd && path.resolve(init.cwd) === path.resolve(i.fixture));
  add('tools', JSON.stringify([...(init.tools ?? [])].sort()) === JSON.stringify(EXPECTED_INIT_TOOLS), init.tools ?? []);
  add('browserConnected', (init.mcp_servers ?? []).length === 1 && init.mcp_servers[0].name === 'browser' && init.mcp_servers[0].status === 'connected');
  const plugins = init.plugins ?? [];
  const builtin = (pl) => pl && pl.path === 'builtin' && pl.source === `${pl.name}@builtin`;
  add('noPlugins', plugins.every(builtin), {other: plugins.filter((pl) => !builtin(pl)).length});
  add('programDirectory', (i.installProblems ?? []).length === 0, i.installProblems ?? []);
  const listed = (init.skills ?? []).map(String);
  const asc = Object.keys(i.ascSkills);
  add('ascListed', asc.every((s) => listed.some((x) => x === s || x.endsWith(`:${s}`))));
  const nonAsc = listed.filter((s) => !asc.some((a) => s === a || s.endsWith(`:${a}`)));
  add('noOwnerSkills', !nonAsc.some((s) => i.ownerSkills.includes(s.replace(/^.*:/, ''))));
  const isMarker = (u) => u.name === 'Read' && i.markerPaths.some((m) => path.resolve(String(u.input?.file_path ?? '')) === path.resolve(m));
  const looked = t.uses.filter((u) => !isMarker(u) && ['Read', 'Grep', 'Glob'].includes(u.name));
  add('onlyMarkerReads', looked.length === 0 && t.uses.every((u) => u.name === 'Read'), {otherToolCalls: t.uses.filter((u) => !isMarker(u)).length});
  const desc = ['asc', 'user-journey-acceptance'].map((s) => norm(t.text.split('\n').find((l) => l.includes(`DESC ${s}:`)) ?? '').includes(norm(i.ascSkills[s] ?? '\u0000')));
  add('descriptionsInContext', desc.every(Boolean), desc);
  add('readTriggerInContext', t.text.includes(POINTER_HEAD));
  add('noRepoInstructions', !i.forbiddenTexts.some((s) => t.text.includes(s)), `${i.forbiddenTexts.filter((s) => t.text.includes(s)).length} found`);
  const ownerLeaks = i.ownerLines.filter((s) => [t.text, i.debug ?? ''].some((x) => x.includes(s)));
  add('noOwnerInstructionsOrMemory', ownerLeaks.length === 0, `${ownerLeaks.length}/${i.ownerLines.length} owner line(s) found`);
  const gitLine = t.text.split('\n').find((l) => l.includes('GIT:')) ?? '';
  add('gitContextSample', /GIT:\s*なし/.test(gitLine) || gitSubjects(gitLine.replace(/^.*GIT:\s*/, '')).every((s) => SAMPLE_SUBJECTS.includes(s)), gitLine ? 'checked' : 'no GIT line');
  const full = (u) => path.resolve(String(u.input?.file_path ?? ''));
  const attempts = i.markerPaths.map((m) => t.uses.filter((u) => u.name === 'Read' && full(u) === path.resolve(m)).length);
  add('markersAttempted', attempts.every((n) => n >= 1), attempts);
  add('markersRefused', !t.okReads.some((p) => i.markerPaths.some((m) => path.resolve(p) === path.resolve(m))));
  const all = [i.trace, i.debug ?? '', i.stderr ?? ''].join('\n');
  add('markerTokensAbsent', i.tokens.length === 2 && i.tokens.every((tok) => tok && !all.includes(tok)), `${i.tokens.length} token(s)`);
  // Debug log: instruction/memory/settings/skills paths only inside the trial directory, the program directory or the
  // managed-policy location (#1814 probe-check rules, including the marker-line exclusions).
  const isMarkerLine = (line) => (i.markerPaths.some((m) => line.includes(m)) && !otherAbsolutePath(i.markerPaths.reduce((l, m) => l.split(m).join(' '), line))) || isMarkerPermissionSuggestion(line, i.markerPaths);
  const programOk = i.hostInstallDir && (i.installProblems ?? []).length === 0;
  const outside = [];
  for (const line of (i.debug ?? '').split('\n')) {
    if (!/CLAUDE\.md|AGENTS\.md|MEMORY|memory|settings\.json|skills\//i.test(line) || isMarkerLine(line)) continue;
    const missingLine = /Broken symlink or missing file/i.test(line);
    const rest = (missingLine ? MANAGED.reduce((l, m) => l.split(m).join(' '), line) : line).replace(/(^|[^\w/.~-])\.(?:agent-skill-chain|claude)\/[^\s"'`,)\\]*/g, '$1 ');
    for (const p of rest.match(/\/[^\s"'`,)]+/g) ?? []) {
      if (!/CLAUDE\.md|AGENTS\.md|MEMORY|memory|settings|skills/i.test(p)) continue;
      const inTrial = inside(p, i.trialDir) || (fs.existsSync(i.trialDir) && inside(p, fs.realpathSync(i.trialDir)));
      if (!inTrial && !(programOk && inside(p, i.hostInstallDir)) && !MANAGED.some((m) => p.startsWith(m))) outside.push(p);
    }
  }
  add('debugPathsInsideTrial', i.debug !== null && outside.length === 0, i.debug === null ? 'no debug log' : `${new Set(outside).size} outside path(s)`);
  const hostPaths = [i.realHome, i.repoRoot].filter((p) => (i.debug ?? '').split('\n').some((l) => !isMarkerLine(l) && (programOk ? l.split(i.hostInstallDir).join('') : l).includes(p)));
  add('noRealHomeOrRepoInDebug', i.debug !== null && hostPaths.length === 0, `${hostPaths.length} found`);
  add('noHooks', hookEventsOf(i.trace).length === 0, `${hookEventsOf(i.trace).length} hook event(s)`);
  return {pass: Object.values(checks).every((c) => c.pass), checks, tools: init.tools ?? [], nonAscSkills: nonAsc, builtinPlugins: plugins.filter(builtin).map((pl) => pl.name).sort(),
    gitLine: gitLine.replace(/^.*GIT:\s*/, ''), model: init.model ?? null, claudeCodeVersion: init.claude_code_version ?? null, costUsd: t.result?.total_cost_usd ?? null,
    managedPolicyPresent: i.managedPolicyPresent ?? null};
}

// B and S probes must agree on everything but the condition's files (tools, Skill list, plugins, git subjects, model).
export function compareProbes(results) {
  const keys = ['tools', 'nonAscSkills', 'builtinPlugins', 'gitLine', 'model'];
  const n = (r, k) => (k === 'gitLine' ? gitSubjects(r[k]) : Array.isArray(r[k]) ? [...r[k]].sort() : r[k]);
  const differ = keys.filter((k) => new Set(results.map((r) => JSON.stringify(n(r, k)))).size > 1);
  return {pass: results.length >= 2 && results.every((r) => r.pass) && differ.length === 0, differ};
}

// run-trial: before the first planned trial, every condition has a passing probe (probe-check.json written by
// `check`) and the comparison of those probes passed (<runs-root>/probe/compare.json written by `compare --out`).
export function probeProblems(runsRoot, conditions) {
  const dir = path.join(runsRoot, 'probe');
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const p = [];
  for (const c of conditions) {
    const ok = fs.existsSync(dir) && fs.readdirSync(dir).some((n) => n.startsWith(`${c}-r`) && readJson(path.join(dir, n, 'probe-check.json'))?.pass === true);
    if (!ok) p.push(`no passing isolation probe for condition ${c}`);
  }
  if (readJson(path.join(dir, 'compare.json'))?.pass !== true) p.push('no passing probe comparison (probe/compare.json)');
  return p;
}

// Probe admission (run-trial and `markers create`): no probe once any measurement trial (any non-probe, non-ranking
// reservation) is in the ledger; one probe per condition (rep 1); exactly one retry (rep 2) only when probe rep 1 of that
// condition was judged and failed (probe-check.json with pass false). Nothing else.
export const isMeasurementName = (n) => !String(n).startsWith('probe/') && !String(n).startsWith('rank-');
export function probeRefusal({condition, rep, reserved, runsRoot}) {
  if ([...reserved].some(isMeasurementName)) return 'probes run only before the first measurement trial is reserved';
  if (rep === undefined) return null;
  const r = Number(rep);
  if (reserved.has(`probe/${condition}-r${r}`)) return `probe/${condition}-r${r} is already reserved`;
  if (r === 1) return null;
  if (r !== 2) return 'at most one probe and one retry per condition';
  if (!reserved.has(`probe/${condition}-r1`)) return 'the retry needs probe rep 1 first';
  let first = null;
  try { first = JSON.parse(fs.readFileSync(path.join(runsRoot, 'probe', `${condition}-r1`, 'probe-check.json'), 'utf8')); } catch { /* not judged */ }
  if (first?.pass !== false) return 'a retry is allowed only after probe rep 1 was judged and failed';
  return null;
}

function main() {
  const [action, ...rest] = process.argv.slice(2);
  const fail = (m) => { console.error(`refused: ${m}`); process.exit(3); };
  if (action === 'markers') {
    const [op, repoRoot] = rest;
    const p = markerPaths(repoRoot);
    if (op === 'create') {
      const a = approvalProblems(); if (a.length) fail(a.join('; '));
      const li = rest.indexOf('--ledger');
      if (li < 0 || !fs.existsSync(rest[li + 1])) fail('markers create needs --ledger <the recorded ledger>');
      const reserved = new Set(fs.readFileSync(rest[li + 1], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => typeof e.reservedUsd === 'number').map((e) => e.trial));
      const pr = probeRefusal({reserved}); if (pr) fail(pr);
      for (const f of Object.values(p)) { fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, `ASC1815-MARKER-${crypto.randomBytes(12).toString('hex')}\n`, {flag: 'wx', mode: 0o600}); }
      console.log(JSON.stringify(p));
    } else if (op === 'remove') {
      for (const f of Object.values(p)) fs.rmSync(f, {force: true});
      console.log(JSON.stringify({removed: 2}));
    } else fail('markers create <repo-root> --ledger <l> | markers remove <repo-root>');
  } else if (action === 'check') {
    const [dirArg, condition, homeMarker, repoMarker, repoRoot] = rest;
    const dir = path.resolve(dirArg), fixture = fs.realpathSync(path.join(dir, 'fixture'));
    const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
    const ascSkills = Object.fromEntries(fs.readdirSync(path.join(fixture, '.claude/skills')).map((s) => [s, description(read(path.join(fixture, '.claude/skills', s, 'SKILL.md')))]));
    const realHome = os.homedir();
    const userConfigDirs = [...new Set([path.join(realHome, '.claude'), process.env.CLAUDE_CONFIG_DIR].filter(Boolean).map((p) => path.resolve(p)))];
    const owner = ownerCanaries(userConfigDirs);
    const hostInstallDir = claudeInstallDir();
    const repoFirst = (f) => (read(path.join(repoRoot, f)) ?? '').split('\n').map((x) => x.replace(/^\s*#+\s*/, '').trim()).find((x) => x.length >= 8) ?? null;
    const out = {condition, ...checkProbe({trace: read(path.join(dir, 'trace.jsonl')) ?? '', debug: read(path.join(dir, 'debug.log')), stderr: read(path.join(dir, 'stderr.txt')), fixture, trialDir: dir, ascSkills,
      forbiddenTexts: [repoFirst('CLAUDE.md'), repoFirst('AGENTS.md')].filter(Boolean), ownerLines: owner.lines, ownerSkills: owner.skills, markerPaths: [homeMarker, repoMarker],
      tokens: [homeMarker, repoMarker].map((m) => read(m)?.trim()).filter(Boolean), realHome, repoRoot: path.resolve(repoRoot), hostInstallDir,
      installProblems: installDirProblems(hostInstallDir, {realHome, userConfigDirs, repoRoot: path.resolve(repoRoot)}), managedPolicyPresent: managedPolicyFiles().map((f) => path.basename(f))})};
    fs.writeFileSync(path.join(dir, 'probe-check.json'), JSON.stringify(out, null, 1));
    console.log(JSON.stringify({condition, pass: out.pass, failed: Object.entries(out.checks).filter(([, c]) => !c.pass).map(([k]) => k)}));
    process.exit(out.pass ? 0 : 1);
  } else if (action === 'compare') {
    const i = rest.indexOf('--out');
    const files = i >= 0 ? rest.filter((_, j) => j !== i && j !== i + 1) : rest;
    const out = compareProbes(files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))));
    if (i >= 0) fs.writeFileSync(rest[i + 1], JSON.stringify(out, null, 1));
    console.log(JSON.stringify(out));
    process.exit(out.pass ? 0 : 1);
  } else fail('usage: markers create|remove <repo> | check <dir> <cond> <home-marker> <repo-marker> <repo> | compare <json>...');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
