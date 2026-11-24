// Runs one generation trial with Claude Code (`claude -p`) in a fresh fixture copy.
// Usage: node run-gen.mjs <runs-root> <case-id> <condition> <rep> [--model sonnet] [--budget 1.2] [--skills-root <dir>]
// The fixture gets: the case files, FONTS.md, and .claude/skills/ = ASC distributed skills + the condition's skill.
// Isolation (#1785 P3): --setting-sources project, no --allowedTools, cwd = fixture, no Bash/Web tools.
// Gold, rubric and other trials live outside the fixture. Writes <runs-root>/<case>/<cond>-r<rep>/{fixture,stream.jsonl,meta.json}.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.resolve(here, '..');
const repoRoot = path.resolve(evidence, '../../..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [runsRoot, caseId, cond, rep] = args;
const model = opt('--model', 'sonnet');
const budget = opt('--budget', '1.5');
const ext = opt('--skills-root', process.env.ASC1804_EXT);
const conds = JSON.parse(fs.readFileSync(path.join(evidence, 'conditions.json'), 'utf8')).conditions;
if (!conds[cond]) throw new Error(`unknown condition ${cond}`);
const dir = path.resolve(runsRoot, caseId, `${cond}-r${rep}`);
if (fs.existsSync(dir)) throw new Error(`exists: ${dir}`);
const fixture = path.join(dir, 'fixture');
fs.mkdirSync(fixture, {recursive: true});
fs.cpSync(path.join(evidence, 'cases', caseId), fixture, {recursive: true});
fs.copyFileSync(path.join(evidence, 'cases', 'FONTS.md'), path.join(fixture, 'FONTS.md'));
const skills = path.join(fixture, '.claude', 'skills');
fs.mkdirSync(skills, {recursive: true});
for (const name of fs.readdirSync(path.join(repoRoot, 'skills'))) {
  const src = path.join(repoRoot, 'skills', name);
  if (fs.statSync(src).isDirectory()) fs.cpSync(src, path.join(skills, name), {recursive: true});
}
for (const s of conds[cond].skills) {
  const src = path.join(ext, s.from);
  fs.cpSync(src, path.join(skills, s.name), {recursive: true, filter: (p) => !p.split(path.sep).includes('.git')});
}
const prompt = fs.readFileSync(path.join(evidence, 'harness', 'gen-prompt.txt'), 'utf8');
const flags = ['-p', '--model', model, '--permission-mode', 'acceptEdits', '--setting-sources', 'project',
  '--tools', 'Read,Write,Edit,Glob,Grep,Skill', '--strict-mcp-config', '--settings', '{"disableAllHooks":true}',
  '--no-session-persistence', '--max-budget-usd', budget, '--output-format', 'stream-json', '--verbose'];
const t0 = Date.now();
const r = spawnSync('claude', [...flags, prompt], {cwd: fixture, input: '', encoding: 'utf8', timeout: 20 * 60 * 1000, maxBuffer: 256 * 1024 * 1024,
  env: {...process.env, ANTHROPIC_API_KEY: undefined}});
const wallMs = Date.now() - t0;
fs.writeFileSync(path.join(dir, 'stream.jsonl'), r.stdout ?? '');
fs.writeFileSync(path.join(dir, 'stderr.txt'), r.stderr ?? '');
const events = (r.stdout ?? '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {parseError: l.slice(0, 200)}; } });
const init = events.find((e) => e.type === 'system' && e.subtype === 'init') ?? {};
const result = events.findLast((e) => e.type === 'result') ?? {};
const toolUses = events.filter((e) => e.type === 'assistant').flatMap((e) => (e.message?.content ?? []).filter((c) => c.type === 'tool_use'));
const count = {}; for (const t of toolUses) count[t.name] = (count[t.name] ?? 0) + 1;
const skillCalls = toolUses.filter((t) => t.name === 'Skill').map((t) => t.input?.skill ?? t.input?.command ?? JSON.stringify(t.input));
const reads = toolUses.filter((t) => t.name === 'Read').map((t) => path.relative(fixture, t.input?.file_path ?? ''));
const meta = {schema: 'asc-1804-gen/v1', case: caseId, condition: cond, rep: Number(rep), model, budget: Number(budget),
  exit: r.status, signal: r.signal, spawnError: r.error?.message ?? null, wallMs,
  initModel: init.model ?? null, initSkills: init.skills ?? null, initTools: init.tools ?? null,
  resultSubtype: result.subtype ?? null, isError: result.is_error ?? null, costUsd: result.total_cost_usd ?? null,
  durationMs: result.duration_ms ?? null, numTurns: result.num_turns ?? null, usage: result.usage ?? null, modelUsage: result.modelUsage ?? null,
  permissionDenials: result.permission_denials ?? null, toolCounts: count, skillCalls,
  skillFileReads: reads.filter((p) => p.startsWith('.claude/skills/')), parseErrors: events.filter((e) => e.parseError).length,
  finalText: typeof result.result === 'string' ? result.result.slice(0, 2000) : null};
fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 1));
console.log(JSON.stringify({case: caseId, cond, rep, exit: r.status, subtype: meta.resultSubtype, cost: meta.costUsd, turns: meta.numTurns, skills: skillCalls, wallMs}));
