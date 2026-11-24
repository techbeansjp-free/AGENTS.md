// Launch one isolated, read-only reviewer for #1780 and record its raw events.
// Usage: node run-reviewer.mjs <runs-root> <run-id> <F1|F2|F3|none> <R0|R1> <prompt-file> <out-dir> [model]
// Builds <runs-root>/<run-id>/{target,guide} (fixture from make-fixture.mjs; guide = copies of the repository's
// review-and-remediation SKILL.md and review-method.md, with the R1 sentence added only for R1), then starts
// Claude Code with cwd=<runs-root>/<run-id>. Nothing else is mounted or added; see README "隔離" for the checks.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const [runsRoot, runId, fixture, condition, promptFile, outDir, model = 'opus'] = process.argv.slice(2);
if (!runsRoot || !/^[a-z0-9-]+$/.test(runId ?? '') || !['F1', 'F2', 'F3', 'none'].includes(fixture)
  || !['R0', 'R1'].includes(condition) || !promptFile || !outDir) {
  throw new Error('usage: node run-reviewer.mjs <runs-root> <run-id> <F1|F2|F3|none> <R0|R1> <prompt-file> <out-dir> [model]');
}
// Fixed before measurement (README "条件"). R1 adds exactly this sentence after the existing distinction sentence.
export const ANCHOR = '再現済み、静的な根拠、未確認の懸念を区別し、未実行テストを再現済みとしない。';
export const R1_SENTENCE = 'library・runtimeの挙動に依存する事実は、確認しなければ未確認の懸念とする。';

const runDir = path.join(path.resolve(runsRoot), runId);
if (fs.existsSync(runDir) || fs.existsSync(outDir)) throw new Error('run directory and out directory must not exist');
const target = path.join(runDir, 'target');
const guide = path.join(runDir, 'guide', 'review-and-remediation');
fs.mkdirSync(path.join(guide, 'references'), { recursive: true });
fs.mkdirSync(outDir, { recursive: true });
if (fixture === 'none') fs.mkdirSync(target);
else if (spawnSync(process.execPath, [path.join(here, 'make-fixture.mjs'), fixture, target]).status !== 0) throw new Error('fixture failed');
fs.copyFileSync(path.join(repo, 'skills/review-and-remediation/SKILL.md'), path.join(guide, 'SKILL.md'));
let method = fs.readFileSync(path.join(repo, 'skills/review-and-remediation/references/review-method.md'), 'utf8');
if (method.split(ANCHOR).length !== 2) throw new Error('anchor sentence must occur exactly once');
if (condition === 'R1') method = method.replace(ANCHOR, `${ANCHOR}${R1_SENTENCE}`);
fs.writeFileSync(path.join(guide, 'references', 'review-method.md'), method);

const digest = (dir) => {
  const hash = crypto.createHash('sha256');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else hash.update(`${path.relative(runDir, p)}\0`).update(fs.readFileSync(p));
  });
  walk(dir);
  return hash.digest('hex');
};
const prompt = fs.readFileSync(promptFile, 'utf8').replaceAll('{TARGET}', target).replaceAll('{GUIDE}', path.dirname(guide));
// Exact launch settings (recorded in status.json). --restricted confines the file tools to the working directory.
const args = ['-p', '--model', model, '--output-format', 'stream-json', '--verbose', '--restricted',
  '--permission-mode', 'dontAsk', '--tools', 'Read,Glob,Grep', '--strict-mcp-config',
  '--settings', '{"disableAllHooks":true}', '--no-session-persistence'];
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const status = { runId, fixture, condition, model, args, cwd: runDir, methodSha256: crypto.createHash('sha256').update(method).digest('hex'),
  runDirDigestBefore: digest(runDir), startedAt: new Date().toISOString() };
fs.writeFileSync(path.join(outDir, 'prompt.txt'), prompt);
const events = fs.createWriteStream(path.join(outDir, 'events.jsonl'));
const started = Date.now();
const child = spawn('claude', args, { cwd: runDir, env, stdio: ['pipe', 'pipe', 'pipe'] });
child.stdout.pipe(events);
let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk; });
child.stdin.end(prompt);
const timer = setTimeout(() => child.kill('SIGTERM'), 20 * 60 * 1000);
const code = await new Promise((resolve) => child.on('close', (c, signal) => resolve(c ?? signal)));
clearTimeout(timer);
await new Promise((resolve) => events.end(resolve));
status.exit = code;
status.wallClockMs = Date.now() - started;
status.finishedAt = new Date().toISOString();
status.runDirDigestAfter = digest(runDir);
status.stderr = stderr.slice(0, 2000);
const lines = fs.readFileSync(path.join(outDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const init = lines.find((e) => e.type === 'system' && e.subtype === 'init');
const result = lines.findLast((e) => e.type === 'result');
const toolCalls = {};
for (const e of lines) {
  if (e.type !== 'assistant') continue;
  for (const block of e.message?.content ?? []) if (block.type === 'tool_use') toolCalls[block.name] = (toolCalls[block.name] ?? 0) + 1;
}
Object.assign(status, {
  tools: init?.tools ?? null, mcpServers: init?.mcp_servers ?? null, hostVersion: init?.claude_code_version ?? null,
  modelReported: init?.model ?? null, toolCalls, resultSubtype: result?.subtype ?? null, isError: result?.is_error ?? null,
  durationMs: result?.duration_ms ?? null, numTurns: result?.num_turns ?? null, usage: result?.usage ?? null,
  modelUsage: result?.modelUsage ?? null, totalCostUsd: result?.total_cost_usd ?? null,
});
fs.writeFileSync(path.join(outDir, 'result.txt'), result?.result ?? '');
fs.writeFileSync(path.join(outDir, 'status.json'), `${JSON.stringify(status, null, 2)}\n`);
// A non-zero or signal exit of the Host process makes this runner fail too (run-all.mjs then retries the slot).
if (code !== 0) process.exitCode = 1;
console.log(JSON.stringify({ runId, exit: code, resultSubtype: status.resultSubtype, unchanged: status.runDirDigestBefore === status.runDirDigestAfter }));
