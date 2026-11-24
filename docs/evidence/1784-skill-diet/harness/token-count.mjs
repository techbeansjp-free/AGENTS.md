// Usage: node token-count.mjs <repoRoot> <outDir> <model>
// Measures how many input tokens the Host consumes when its Read tool returns each Skill file (as registered for a consumer).
// One session reads one file per turn; the token count of a file is the growth of the input side between consecutive turns
// minus the previous turn's output. The Read result includes the Host's line-number prefix, so it is what the Host actually loads.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const [repoRoot, outDir, model] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
fs.mkdirSync(outDir, { recursive: true });
const proj = path.join(outDir, 'proj');
const cproj = path.join(outDir, 'cproj');
for (const d of [proj, cproj]) fs.rmSync(d, { recursive: true, force: true });
execFileSync('node', [path.join(here, 'make-fixture.mjs'), repoRoot, 'B', proj]);
execFileSync('node', [path.join(here, 'make-fixture.mjs'), repoRoot, 'C', cproj]);
for (const rel of ['SKILL.md', 'references/review.md', 'references/controller.md']) {
  const to = path.join(proj, 'candidate-c', rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(cproj, '.agent-skill-chain/skills/asc', rel), to);
}
fs.rmSync(cproj, { recursive: true, force: true });
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.md')) files.push(path.relative(proj, p)); } })(path.join(proj, '.agent-skill-chain/skills'));
files.push('candidate-c/SKILL.md', 'candidate-c/references/review.md', 'candidate-c/references/controller.md');
const prompt = 'Token measurement. Read the following files with the Read tool, exactly one Read call per message, in this order, never in parallel and without commentary. After the last one reply DONE.\n' + files.map((f, i) => `${i + 1}. ${f}`).join('\n');
const args = ['-p', prompt, '--model', model, '--effort', 'low', '--output-format', 'stream-json', '--verbose', '--setting-sources', 'project', '--permission-mode', 'dontAsk',
  '--tools', 'Read', '--strict-mcp-config', '--settings', '{"disableAllHooks":true}', '--no-session-persistence', '--max-budget-usd', '3.00'];
const r = spawnSync('claude', args, { cwd: proj, encoding: 'utf8', timeout: 1800000, maxBuffer: 64 * 1024 * 1024 });
const events = r.stdout.split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
// Group assistant events by message id (one API call may be split into several events).
const calls = [];
for (const e of events) {
  if (e.type !== 'assistant') continue;
  const id = e.message.id; let c = calls.find((x) => x.id === id);
  if (!c) { c = { id, usage: e.message.usage, reads: [] }; calls.push(c); }
  c.usage = e.message.usage;
  for (const b of e.message.content ?? []) if (b.type === 'tool_use' && b.name === 'Read') c.reads.push(path.relative(fs.realpathSync(proj), fs.realpathSync(path.resolve(proj, b.input.file_path))));
}
const side = (u) => (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
const rows = [];
for (let i = 0; i + 1 < calls.length; i++) {
  if (calls[i].reads.length !== 1) { rows.push({ file: calls[i].reads.join(','), tokens: null, note: 'not exactly one Read in this call' }); continue; }
  rows.push({ file: calls[i].reads[0], tokens: side(calls[i + 1].usage) - side(calls[i].usage) - (calls[i].usage.output_tokens ?? 0) });
}
const result = events.find((e) => e.type === 'result');
const out = { model, files: files.length, rows, costUsd: result?.total_cost_usd ?? null, note: 'tokens include the Read line-number prefix and the tool_result wrapper' };
fs.writeFileSync(path.join(outDir, 'tokens.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ rows: rows.length, costUsd: out.costUsd }));
