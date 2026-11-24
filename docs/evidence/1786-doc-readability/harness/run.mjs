// 1件の評価を、toolなし・hookなし・MCPなし・非永続のheadless Claude Codeで実行して記録する（#1786）。
// 使い方: node run.mjs <outDir> <case> <cond> <rep> <model> <workRoot>
// outDir に <case>-<cond>-<rep>.json（回答の原文とHost報告のusage）を書く。session_idやpathは記録しない。
// workRoot の下に空の作業directoryを作り、そこをcwdにする（repositoryとgoldはcwdの外）。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildPrompt } from './build-prompt.mjs';

const [outDir, caseId, cond, rep, model, workRoot] = process.argv.slice(2);
if (!outDir || !caseId || !cond || !rep || !model || !workRoot) throw new Error('usage: run.mjs <outDir> <case> <cond> <rep> <model> <workRoot>');
const here = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(here, '../../../..');
const key = `${caseId}-${cond}-${rep}`;
const outFile = path.join(outDir, `${key}.json`);
if (fs.existsSync(outFile)) throw new Error(`already exists: ${key}（上書きしない）`);
if (!fs.statSync(outDir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`outDir がない: 有料の呼出しの前に止める`);
const prompt = buildPrompt(caseId, cond, repoRoot);
const work = path.join(workRoot, key);
fs.mkdirSync(path.dirname(work), { recursive: true });
fs.mkdirSync(work);

const CLAUDE_ARGS = (m) => [
  '-p',
  '--model',
  m,
  '--output-format',
  'json',
  '--tools',
  '',
  '--strict-mcp-config',
  '--settings',
  '{"disableAllHooks":true}',
  '--disable-slash-commands',
  '--no-session-persistence',
  '--permission-mode',
  'dontAsk',
  '--max-budget-usd',
  '1.00',
];

const t0 = Date.now();
const r = spawnSync('claude', CLAUDE_ARGS(model), { cwd: work, input: prompt, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
const wallMs = Date.now() - t0;
let j = null;
try {
  j = JSON.parse(r.stdout);
} catch {
  /* keep null: 出力収集の失敗として記録する */
}
const rec = {
  case: caseId,
  cond,
  rep: Number(rep),
  model,
  promptChars: prompt.length,
  result: j?.result ?? null,
  metrics: {
    wallMs,
    exit: r.status,
    signal: r.signal ?? null,
    timedOut: r.error?.code === 'ETIMEDOUT',
    isError: j?.is_error ?? null,
    subtype: j?.subtype ?? null,
    costUsd: j?.total_cost_usd ?? null,
    numTurns: j?.num_turns ?? null,
    durationApiMs: j?.duration_api_ms ?? null,
    usage: j?.usage
      ? {
          input: j.usage.input_tokens ?? null,
          output: j.usage.output_tokens ?? null,
          cacheRead: j.usage.cache_read_input_tokens ?? null,
          cacheWrite: j.usage.cache_creation_input_tokens ?? null,
        }
      : null,
    models: j?.modelUsage ? Object.keys(j.modelUsage) : null,
    permissionDenials: Array.isArray(j?.permission_denials) ? j.permission_denials.length : null,
  },
  collectError: j ? null : `stdout-not-json (exit ${r.status})`,
};
fs.writeFileSync(path.join(work, 'stderr.txt'), String(r.stderr ?? ''));
fs.writeFileSync(outFile, `${JSON.stringify(rec, null, 1)}\n`);
console.log(JSON.stringify({ key, wallMs, costUsd: rec.metrics.costUsd, exit: r.status, isError: rec.metrics.isError, collectError: rec.collectError }));
