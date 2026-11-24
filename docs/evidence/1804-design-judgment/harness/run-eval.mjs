// Runs one blinded evaluator (new Claude Code context, read-only tools, cwd = blind dir).
// Usage: node run-eval.mjs <blind-dir> <out-json> <order-seed> [--model opus] [--budget 4]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [blind, outJson, orderSeed] = args;
const ids = [...new Set(fs.readdirSync(blind).filter((f) => /^[0-9a-z]{4}-notes\.md$/.test(f)).map((f) => f.slice(0, 4)))];
const order = ids.map((id) => [crypto.createHash('sha256').update(orderSeed + id).digest('hex'), id]).sort().map((x) => x[1]);
const prompt = `このフォルダの RUBRIC.md を読み、その手順と基準で、BRIEF.md の依頼に対して生成された画面を採点してください。採点する画面のIDは次の${order.length}件です（この順に見てください）：${order.join(', ')}。各画面の画像（png）は必ずReadで開いて見てください。最後にRUBRIC.mdの形式のJSONを出力してください。`;
const flags = ['-p', '--model', opt('--model', 'opus'), '--permission-mode', 'dontAsk', '--setting-sources', 'project', '--tools', 'Read,Glob,Grep',
  '--strict-mcp-config', '--settings', '{"disableAllHooks":true}', '--no-session-persistence', '--max-budget-usd', opt('--budget', '4'), '--output-format', 'json'];
const t0 = Date.now();
const r = spawnSync('claude', [...flags, prompt], {cwd: blind, input: '', encoding: 'utf8', timeout: 30 * 60 * 1000, maxBuffer: 64 * 1024 * 1024, env: {...process.env, ANTHROPIC_API_KEY: undefined}});
let res = {}; try { res = JSON.parse(r.stdout); } catch { res = {parseError: (r.stdout ?? '').slice(0, 500)}; }
let scores = null; const m = typeof res.result === 'string' ? res.result.match(/```json\s*([\s\S]*?)```/) : null;
if (m) { try { scores = JSON.parse(m[1]).scores; } catch (e) { scores = null; } }
const out = {schema: 'asc-1804-eval/v1', blind: path.basename(blind), order, exit: r.status, wallMs: Date.now() - t0, subtype: res.subtype ?? null, isError: res.is_error ?? null,
  costUsd: res.total_cost_usd ?? null, numTurns: res.num_turns ?? null, usage: res.usage ?? null, modelUsage: res.modelUsage ?? null, scores, rawResult: res.result ?? res.parseError ?? null};
fs.writeFileSync(outJson, JSON.stringify(out, null, 1));
console.log(JSON.stringify({blind: out.blind, exit: r.status, cost: out.costUsd, scored: scores ? Object.keys(scores).length : 0}));
