// Session-listing probe for the criteria in listing-criteria.md. Synthetic fixture, Host model (haiku), persisted sessions.
// Usage: node listing-probe.mjs <fresh-fixture-dir> <primary-cwd|target-cwd> <out.json>
// Afterwards remove the fixture sessions with `claude purge <path> -y` (the script prints the paths).
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {claudeReviewArguments,claudeRenameArguments} from '../../../src/host-session.mjs';

const [fixture, condition, out] = process.argv.slice(2);
const F = fs.realpathSync(fixture), repo = path.join(F, 'repo'), target = path.join(repo, '.worktrees/target');
if (!['primary-cwd', 'target-cwd'].includes(condition)) throw Error('unknown condition');
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
const hide = text => String(text ?? '').replaceAll(F, '<fixture>');
const claude = (cwd, args, input) => {
  const r = spawnSync('claude', args, {cwd, input, env, encoding: 'utf8', timeout: 300000});
  let json; try { json = JSON.parse(r.stdout); } catch { json = undefined; }
  return {exit: r.status, ok: r.status === 0 && json?.is_error === false, sessionId: json?.session_id, result: hide(json?.result ?? r.stdout).slice(0, 120), stderr: hide(r.stderr).slice(0, 200)};
};
const launchCwd = condition === 'primary-cwd' ? repo : target;
const sessionId = randomUUID(), name = `自動: listing-probe ${condition}`;
const res = {condition, criteriaSha256: 'da3cc1e9870403b5348370a6d0a60af6a56ce433d5accb35487dede079e5e0e6', launchCwd: hide(launchCwd)};
// Same argument builders as host-session (cwd and --add-dir follow the condition).
const start = claudeReviewArguments({model: 'haiku', sessionId, instruction: 'Synthetic listing probe. Reply OK only.', cwd: launchCwd, targetDirectory: target, ephemeral: false, name});
res.start = claude(launchCwd, start, 'Reply OK only. Do not use tools.');
res.rename = claude(launchCwd, claudeRenameArguments({sessionId, name, model: 'haiku'}), 'Reply OK only. Do not use tools.');
const resume = handle => claude(repo, ['-p', '--resume', handle, '--model', 'haiku', '--max-turns', '1', '--tools', '', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--settings', '{"disableAllHooks":true}', '--output-format', 'json'], 'Reply OK only. Do not use tools.');
const dry = dir => hide(spawnSync('claude', ['purge', '--dry-run', dir], {env, encoding: 'utf8'}).stdout).split('\n').filter(l => l.includes(sessionId) || /transcript|session/i.test(l)).slice(0, 6);
res.storedUnder = {primary: dry(repo), target: dry(target)};
res.beforeRemove = {byId: resume(sessionId), byName: resume(`済: ${name}`)};
execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', target], {env, stdio: 'ignore'});
res.afterRemove = {byId: resume(sessionId), byName: resume(`済: ${name}`)};
for (const phase of ['beforeRemove', 'afterRemove']) for (const k of ['byId', 'byName']) res[phase][k].sameSession = res[phase][k].sessionId === sessionId;
fs.writeFileSync(out, JSON.stringify(res, null, 2) + '\n');
console.log(JSON.stringify(res, null, 1));
console.log(`purge: ${repo} ${target}`);
