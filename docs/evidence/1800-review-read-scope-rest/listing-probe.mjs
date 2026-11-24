// Session-listing probe for the criteria in listing-criteria.md. Synthetic fixture, Host model (haiku), persisted sessions.
// Usage: node listing-probe.mjs <fresh-fixture-dir> <primary-cwd|target-cwd> <out.json>
// The rename uses text output like host-session, so its success is the exit code (jsonOk is null).
// Afterwards remove the fixture sessions with `claude purge <path> -y` (the script prints the paths).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {claudeReviewArguments,claudeRenameArguments} from '../../../src/host-session.mjs';

const [fixture, condition, out] = process.argv.slice(2);
const F = fs.realpathSync(fixture), repo = path.join(F, 'repo'), target = path.join(repo, '.worktrees/target');
if (!['primary-cwd', 'target-cwd'].includes(condition)) throw Error('unknown condition');
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
const hide = text => String(text ?? '').replaceAll(F, '<fixture>').replaceAll(os.homedir(), '<home>');
// Host stderr can name local settings files; only whether it was empty is kept.
const claude = (cwd, args, input) => {
  const r = spawnSync('claude', args, {cwd, input, env, encoding: 'utf8', timeout: 300000});
  let json; try { json = JSON.parse(r.stdout); } catch { json = undefined; }
  return {exit: r.status, jsonOk: json ? json.is_error === false : null, sessionId: json?.session_id, result: hide(json?.result ?? r.stdout).slice(0, 120), stderrEmpty: !r.stderr.trim()};
};
// Documented transcript location: <config>/projects/<cwd with non-alphanumerics replaced by '-'>/<session-id>.jsonl.
const projects = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'projects');
const transcriptIn = dir => fs.existsSync(path.join(projects, dir.replace(/[^A-Za-z0-9]/g, '-'), `${sessionId}.jsonl`));
const launchCwd = condition === 'primary-cwd' ? repo : target;
const sessionId = randomUUID(), name = `自動: listing-probe ${condition}`;
const res = {condition, criteriaSha256: 'da3cc1e9870403b5348370a6d0a60af6a56ce433d5accb35487dede079e5e0e6', launchCwd: hide(launchCwd)};
// Same argument builders as host-session (cwd and --add-dir follow the condition).
const start = claudeReviewArguments({model: 'haiku', sessionId, instruction: 'Synthetic listing probe. Reply OK only.', cwd: launchCwd, targetDirectory: target, ephemeral: false, name});
res.start = claude(launchCwd, start, 'Reply OK only. Do not use tools.');
res.rename = claude(launchCwd, claudeRenameArguments({sessionId, name, model: 'haiku'}), 'Reply OK only. Do not use tools.');
const resume = handle => claude(repo, ['-p', '--resume', handle, '--model', 'haiku', '--max-turns', '1', '--tools', '', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--settings', '{"disableAllHooks":true}', '--output-format', 'json'], 'Reply OK only. Do not use tools.');
res.transcriptStoredUnder = {primaryProject: transcriptIn(repo), targetProject: transcriptIn(target)};
res.beforeRemove = {byId: resume(sessionId), byName: resume(`済: ${name}`)};
execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', target], {env, stdio: 'ignore'});
res.afterRemove = {byId: resume(sessionId), byName: resume(`済: ${name}`)};
res.transcriptStoredUnderAfter = {primaryProject: transcriptIn(repo), targetProject: transcriptIn(target)};
for (const phase of ['beforeRemove', 'afterRemove']) for (const k of ['byId', 'byName']) res[phase][k].sameSession = res[phase][k].sessionId === sessionId;
fs.writeFileSync(out, JSON.stringify(res, null, 2) + '\n');
console.log(JSON.stringify(res, null, 1));
console.log(`purge: ${repo} ${target}`);
