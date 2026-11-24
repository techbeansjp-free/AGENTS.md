// End-to-end probe of the adopted Claude Code launch (#1800, plan W) through the real `host-session claude` CLI.
// Synthetic fixture only (setup-fixture.mjs), Host model (haiku), persisted session.
// Usage: node host-session-probe.mjs <fixture-dir> <scratch-dir> <out.json>
// Checks: status.json (completed, naming completed, cwd = target), the read results recorded in the session transcript,
// and --resume from the primary checkout by ID and display name, before and after removing the target worktree.
// Afterwards remove the fixture sessions with `claude purge -y <path>` (the script prints the paths).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const [fixture, scratch, out] = process.argv.slice(2);
const F = fs.realpathSync(fixture), repo = path.join(F, 'repo'), target = path.join(repo, '.worktrees/target'), outside = path.join(F, 'outside');
const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../bin/asc-v05.mjs');
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
const hide = text => String(text ?? '').replaceAll(F, '<fixture>').replaceAll(os.homedir(), '<home>');
const read = file => fs.readFileSync(file, 'utf8').trim();
const markers = {
  outside: read(path.join(outside, 'marker.txt')), inside: read(path.join(target, 'inside.txt')),
  primaryTracked: read(path.join(repo, 'tracked.txt')), primaryUntracked: read(path.join(repo, 'untracked.txt')),
  otherWorktree: read(path.join(repo, '.worktrees/other/other.txt')),
};
// Same 13 calls as probe-run.mjs.
const probes = [
  ['Read', path.join(outside, 'marker.txt'), 'outside'],
  ['Glob', `pattern "*.txt" and path ${outside}`, 'outside'],
  ['Grep', `pattern "OUTSIDE" and path ${outside} (output_mode content)`, 'outside'],
  ['Read', path.join(target, 'link-file.txt'), 'symlink file to outside'],
  ['Read', path.join(target, 'link-dir', 'marker.txt'), 'symlink dir to outside'],
  ['Read', path.join(target, 'inside.txt'), 'target (positive control)'],
  ['Glob', `pattern "*.txt" and path ${target}`, 'target (positive control)'],
  ['Read', path.join(repo, 'tracked.txt'), 'primary tracked'],
  ['Read', path.join(repo, 'untracked.txt'), 'primary untracked'],
  ['Read', path.join(repo, '.worktrees/other/other.txt'), 'other worktree'],
  ['Glob', `pattern "**/*.txt" and path ${path.join(repo, '.worktrees')}`, 'worktrees listing'],
  ['Grep', `pattern "OTHERWT" and path ${repo} (output_mode content)`, 'primary grep'],
  ['Read', path.join(target, 'link-root.txt'), 'symlink to primary untracked'],
];
const prompt = `This is an automated permission probe with synthetic files only. Make exactly these tool calls, one per item, in order, even if earlier ones fail, then reply with a short list of which succeeded.\n${probes.map(([tool, arg], i) => `${i + 1}. ${tool} ${tool === 'Read' ? arg : `with ${arg}`}`).join('\n')}`;
fs.mkdirSync(scratch, {recursive: true});
const promptFile = path.join(scratch, 'prompt.txt'), outputDir = path.join(scratch, 'session');
fs.writeFileSync(promptFile, prompt);
const name = `1800 host-session probe ${path.basename(F)}`;
const run = spawnSync(process.execPath, [cli, 'host-session', 'claude', target, '--name', name, '--model', 'haiku', '--rename-model', 'haiku', '--prompt-file', promptFile, '--output-dir', outputDir, '--timeout-ms', '600000'], {cwd: repo, env, encoding: 'utf8', timeout: 900000});
const status = JSON.parse(fs.readFileSync(path.join(outputDir, 'status.json'), 'utf8'));
const res = {
  cliExit: run.status,
  status: {status: status.status, naming: status.naming, name: status.name, cwdIsTarget: status.cwd === target, cwdIsPrimary: status.cwd === repo, targetDirectoryIsTarget: status.targetDirectory === target, targetHeadMatches: status.targetHead === execFileSync('git', ['-C', target, 'rev-parse', 'HEAD'], {env, encoding: 'utf8'}).trim(), error: status.error ?? null},
};
// Documented transcript location: <config>/projects/<cwd with non-alphanumerics replaced by '-'>/<session-id>.jsonl.
const projects = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'projects');
const transcript = dir => path.join(projects, dir.replace(/[^A-Za-z0-9]/g, '-'), `${status.sessionId}.jsonl`);
res.transcriptStoredUnder = {primaryProject: fs.existsSync(transcript(repo)), targetProject: fs.existsSync(transcript(target))};
// Tool results come from the persisted transcript (host-session keeps only the final JSON result).
// The transcript can repeat an entry; each tool call is counted once by its tool_use_id.
const uses = {}, results = [], seen = new Set();
const lines = fs.existsSync(transcript(target)) ? fs.readFileSync(transcript(target), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return {}; } }) : [];
for (const e of lines) for (const c of Array.isArray(e.message?.content) ? e.message.content : []) {
  if (c.type === 'tool_use') uses[c.id] = {tool: c.name, input: c.input};
  if (c.type === 'tool_result' && !seen.has(c.tool_use_id)) {
    seen.add(c.tool_use_id);
    const text = (typeof c.content === 'string' ? c.content : JSON.stringify(c.content)) + (e.toolUseResult ? JSON.stringify(e.toolUseResult) : '');
    results.push({tool: uses[c.tool_use_id]?.tool, input: JSON.parse(hide(JSON.stringify(uses[c.tool_use_id]?.input ?? {}))), isError: !!c.is_error,
      markers: Object.entries(markers).filter(([, v]) => text.includes(v)).map(([k]) => k), message: c.is_error ? hide(text).slice(0, 200) : undefined});
  }
}
const allText = lines.map(l => JSON.stringify(l)).join('\n') + read(path.join(outputDir, 'events.jsonl'));
res.markerInTranscriptOrEvents = Object.fromEntries(Object.entries(markers).map(([k, v]) => [k, allText.includes(v)]));
res.toolCalls = results.length;
res.results = results;
const resume = handle => {
  const r = spawnSync('claude', ['-p', '--resume', handle, '--model', 'haiku', '--max-turns', '1', '--tools', '', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--settings', '{"disableAllHooks":true}', '--output-format', 'json'], {cwd: repo, input: 'Reply OK only. Do not use tools.', env, encoding: 'utf8', timeout: 300000});
  let json; try { json = JSON.parse(r.stdout); } catch { json = undefined; }
  return {exit: r.status, ok: json?.is_error === false, sameSession: json?.session_id === status.sessionId};
};
const finalName = `済: ${status.name}`;
res.beforeRemove = {byId: resume(status.sessionId), byName: resume(finalName)};
execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', target], {env, stdio: 'ignore'});
res.afterRemove = {byId: resume(status.sessionId), byName: resume(finalName)};
fs.writeFileSync(out, JSON.stringify(res, null, 2) + '\n');
console.log(JSON.stringify({cliExit: res.cliExit, status: res.status, stored: res.transcriptStoredUnder, markers: res.markerInTranscriptOrEvents, calls: results.map(x => `${x.tool}:${x.isError ? 'ERR' : 'ok'}:${x.markers.join('+')}`), before: res.beforeRemove, after: res.afterRemove}));
console.log(`purge: ${repo} ${target}`);
