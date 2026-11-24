// Codex read-scope probe without any model call: app-server `initialize`, `thread/start` (ephemeral) and
// `command/exec` only. No `turn/start` is sent, so nothing is sent to a model.
// Usage: CODEX_HOME=<disposable dir> node codex-probe.mjs <fixture-dir> <legacy-read-only|profile> <out.json>
//   legacy-read-only: the launch before #1800 (`sandbox: read-only`).
//   profile: the #1800 launch (codexReviewProfileArguments, thread `permissions`), with the same readable paths
//            as host-session (Host executable, shared Git metadata, macOS developer tools).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {CODEX_REVIEW_PROFILE,codexReviewProfileArguments,codexReviewReadablePaths,resolveExecutable} from '../../../src/host-session.mjs';

const [fixture, condition, out] = process.argv.slice(2);
if (!process.env.CODEX_HOME) throw Error('Set CODEX_HOME to a disposable directory');
if (!['legacy-read-only', 'profile'].includes(condition)) throw Error('unknown condition');
const F = fs.realpathSync(fixture), repo = path.join(F, 'repo'), target = path.join(repo, '.worktrees/target');
// A non-temporary path: this checkout's public AGENTS.md (content is not a secret; only the exit code is recorded).
const nonTmp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../AGENTS.md');
const files = {
  target: path.join(target, 'inside.txt'),
  outside: path.join(F, 'outside/marker.txt'),
  primaryUntracked: path.join(repo, 'untracked.txt'),
  primaryTracked: path.join(repo, 'tracked.txt'),
  otherWorktree: path.join(repo, '.worktrees/other/other.txt'),
  externalWorktree: path.join(F, 'external-target/inside.txt'),
  symlinkToOutside: path.join(target, 'link-file.txt'),
  symlinkDirToOutside: path.join(target, 'link-dir/marker.txt'),
  symlinkToPrimary: path.join(target, 'link-root.txt'),
};
const codex = resolveExecutable('codex');
const readable = codexReviewReadablePaths({executable: codex, gitCommonDir: fs.realpathSync(path.join(repo, '.git'))});
const extra = condition === 'profile' ? codexReviewProfileArguments(target, readable) : [];
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
const server = http.createServer((q, s) => s.end('LOCAL-LISTENER')); await new Promise(r => server.listen(0, '127.0.0.1', r));
const child = spawn(codex, ['app-server', ...extra], {cwd: repo, env, stdio: ['pipe', 'pipe', 'pipe']});
let id = 0; const pending = new Map();
createInterface({input: child.stdout}).on('line', line => {
  const m = JSON.parse(line);
  if (m.method && Object.hasOwn(m, 'id')) { child.stdin.write(JSON.stringify({id: m.id, error: {code: -32601, message: 'denied'}}) + '\n'); return; }
  if (Object.hasOwn(m, 'id') && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); }
});
let stderr = ''; child.stderr.on('data', b => { stderr += b; });
const call = (method, params) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, {resolve, reject}); child.stdin.write(JSON.stringify({id: n, method, params}) + '\n'); });
const hide = text => String(text ?? '').replaceAll(F, '<fixture>').replaceAll(path.dirname(nonTmp), '<checkout>').replaceAll(codex, '<codex>').replaceAll(process.env.CODEX_HOME, '<codex-home>').replaceAll(process.env.HOME ?? '\0', '<home>');
const result = {condition, codexVersion: spawnSync(codex, ['--version'], {encoding: 'utf8'}).stdout.trim(), codexArgs: extra.map(hide), checks: {}};
const policy = condition === 'profile' ? {} : {sandboxPolicy: {type: 'readOnly'}};
const exec = async (command, extraEnv = {}) => {
  try { const r = await call('command/exec', {command, cwd: repo, timeoutMs: 20000, env: {HOME: target, ...extraEnv}, ...policy}); return r; }
  catch (error) { return {rpcError: hide(error.message).slice(0, 200)}; }
};
try {
  await call('initialize', {clientInfo: {name: 'asc_probe', version: '0'}, capabilities: {experimentalApi: true}});
  child.stdin.write(JSON.stringify({method: 'initialized', params: {}}) + '\n');
  const started = await call('thread/start', {cwd: repo, ephemeral: true, approvalPolicy: 'never', ...(condition === 'profile' ? {permissions: CODEX_REVIEW_PROFILE} : {sandbox: 'read-only'})});
  result.thread = {sandbox: started.sandbox, activePermissionProfile: started.activePermissionProfile ?? null, cwd: hide(started.cwd), instructionSources: JSON.parse(hide(JSON.stringify(started.instructionSources ?? null)))};
  for (const [name, file] of Object.entries(files)) {
    const r = await exec(['/bin/cat', file]);
    result.checks[name] = {exitCode: r.exitCode, markerRead: (r.stdout ?? '').includes(fs.readFileSync(file, 'utf8').trim()), stderr: hide(r.stderr).slice(0, 160), rpcError: r.rpcError};
  }
  const nonTmpRead = await exec(['/bin/cat', nonTmp]);
  result.checks.nonTemporaryPath = {exitCode: nonTmpRead.exitCode, stderr: hide(nonTmpRead.stderr).slice(0, 160)};
  const write = await exec(['/usr/bin/touch', path.join(target, 'write-probe.txt')]);
  result.checks.writeTarget = {exitCode: write.exitCode, created: fs.existsSync(path.join(target, 'write-probe.txt')), stderr: hide(write.stderr).slice(0, 160)};
  fs.rmSync(path.join(target, 'write-probe.txt'), {force: true});
  const net = await exec(['/usr/bin/curl', '-sS', '-m', '3', `http://127.0.0.1:${server.address().port}/`]);
  result.checks.localNetwork = {exitCode: net.exitCode, reached: (net.stdout ?? '').includes('LOCAL-LISTENER'), stderr: hide(net.stderr).slice(0, 160)};
  for (const [name, args] of Object.entries({gitLog: ['log', '-1', '--format=%s'], gitStatus: ['status', '--short']})) {
    const r = await exec(['/usr/bin/git', '-C', target, ...args]);
    result.checks[name] = {exitCode: r.exitCode, stdout: hide(r.stdout).slice(0, 120)};
  }
} catch (error) { result.error = hide(error.message); result.stderr = hide(stderr).slice(-800); }
child.stdin.end(); child.kill(); server.close();
fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({condition, error: result.error, thread: result.thread, checks: Object.fromEntries(Object.entries(result.checks).map(([k, v]) => [k, v.markerRead ?? v.reached ?? v.created ?? v.exitCode]))}));
