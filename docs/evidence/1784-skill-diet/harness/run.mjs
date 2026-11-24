// Usage: node run.mjs <repoRoot> <outRoot> <caseId> <A|B|C> <rep> <model> <effort> [casesFile]
// One headless Claude Code session (new Context, no persistence) on a fresh fixture, limited to Read/Glob/Grep/Skill.
// Records the tool trace, usage, cost and wall-clock. Scoring is done separately by score.mjs against cases.json.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const [repoRoot, outRoot, caseId, cond, rep, model, effort, casesFile] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
const cases = JSON.parse(fs.readFileSync(casesFile ?? path.join(here, '..', 'cases.json'), 'utf8'));
const c = cases.cases.find((x) => x.id === caseId);
if (!c) throw Error('unknown case');
const id = `${caseId}-${cond}-${rep}`;
const proj = path.join(outRoot, id, 'proj');
fs.rmSync(path.join(outRoot, id), { recursive: true, force: true });
fs.mkdirSync(path.join(outRoot, id), { recursive: true });
execFileSync('node', [path.join(here, 'make-fixture.mjs'), repoRoot, cond, proj]);

const prompt = cases.preamble + '\n\n' + c.prompt;
const schema = JSON.stringify(cases.schemas[c.schema]);
const tools = 'Read,Glob,Grep,Skill';
const args = ['-p', prompt, '--model', model, '--effort', effort, '--output-format', 'stream-json', '--verbose',
  '--setting-sources', 'project', '--permission-mode', 'dontAsk', '--tools', tools, '--allowedTools', 'Skill', '--strict-mcp-config',
  '--settings', '{"disableAllHooks":true}', '--no-session-persistence', '--json-schema', schema, '--max-budget-usd', '1.50'];
const t0 = Date.now();
const r = spawnSync('claude', args, { cwd: proj, encoding: 'utf8', timeout: 900000, maxBuffer: 64 * 1024 * 1024 });
const wallMs = Date.now() - t0;
fs.writeFileSync(path.join(outRoot, id, 'stream.jsonl'), r.stdout ?? '');
fs.writeFileSync(path.join(outRoot, id, 'stderr.txt'), r.stderr ?? '');

const events = (r.stdout ?? '').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
const toolCalls = [];
const denied = [];
let skillsListed = null;
for (const e of events) {
  if (e.type === 'system' && e.subtype === 'init') skillsListed = e.skills ?? e.slash_commands ?? null;
  if (e.type === 'assistant') for (const b of e.message?.content ?? []) if (b.type === 'tool_use') toolCalls.push({ name: b.name, input: b.input });
  if (e.type === 'user') for (const b of e.message?.content ?? []) if (b.type === 'tool_result' && b.is_error) denied.push(String(typeof b.content === 'string' ? b.content : JSON.stringify(b.content)).slice(0, 200));
}
const result = events.find((e) => e.type === 'result') ?? null;
const rel = (p) => (typeof p === 'string' && p.startsWith(fs.realpathSync(proj)) ? path.relative(fs.realpathSync(proj), p) : typeof p === 'string' && p.startsWith(proj) ? path.relative(proj, p) : p);
const trace = toolCalls.map((t) => ({ name: t.name, target: rel(t.input?.file_path ?? t.input?.skill ?? t.input?.pattern ?? t.input?.path ?? null), path: rel(t.input?.path ?? null) }));
const rec = {
  id, caseId, cond, rep: Number(rep), model, effort, wallMs, exit: r.status,
  structured: result?.structured_output ?? null, resultText: result?.result ?? null, isError: result?.is_error ?? null, subtype: result?.subtype ?? null,
  costUsd: result?.total_cost_usd ?? null, numTurns: result?.num_turns ?? null, durationApiMs: result?.duration_api_ms ?? null,
  usage: result?.usage ?? null, modelUsage: result?.modelUsage ?? null, trace, toolCallCount: toolCalls.length, deniedCount: denied.length, denied, skillsListed,
};
fs.writeFileSync(path.join(outRoot, id, 'record.json'), JSON.stringify(rec, null, 1));
console.log(JSON.stringify({ id, exit: r.status, subtype: rec.subtype, costUsd: rec.costUsd, wallMs, tools: toolCalls.length, structured: !!rec.structured }));
