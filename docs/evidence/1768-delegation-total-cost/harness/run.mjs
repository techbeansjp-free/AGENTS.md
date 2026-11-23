// Usage: node run.mjs <outDir> <task:T1|T2|T3> <cond:A|B|C> <rep> <parentModel>
// Runs one headless Claude Code session on a fresh fixture and records usage, parent/child split and oracle result.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
const [outDir, task, cond, rep, model] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
const work = path.join(outDir, `${task}-${cond}-${rep}`);
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
execFileSync('node', [path.join(here, 'make-fixture.mjs'), work]);

const TASKS = {
  T1: 'Find which modules under src/ call the function fmtPrice (exclude the module that defines it). End your final message with one line: ANSWER: <comma-separated module file names without extension, sorted>.',
  T2: 'Change fmtPrice in src/format.mjs so it prints two decimal places (e.g. "JPY 5.00"). Keep existing tests passing (update tests only if they must change). Run npm test before finishing.',
  T3: 'Add discount(n, pct) to src/tax.mjs returning n * (1 - pct / 100). Then make every module under src/ that calls fmtPrice apply discount(qty * unit, 10) to the amount before formatting. Modules that do not call fmtPrice must stay unchanged. Run npm test before finishing.',
};
const DELEG = {
  A: ' Do all the work yourself in this session. Do not use the Agent tool.',
  B: ' Delegate the search/implementation work to one subagent using the Agent tool, passing a short description of the goal, the scope and the completion condition, with model set to "haiku". Verify the result yourself.',
  C: ' Delegate the search/implementation work to one subagent using the Agent tool with model set to "haiku". Narrow its input: give only the exact file paths it must read (src/format.mjs and the src/*.mjs modules), the one question, and the required return format (a list of file names or the diff summary). Do not paste file contents. Verify the result yourself.',
};
const prompt = TASKS[task] + DELEG[cond];
const args = ['-p', prompt, '--model', model, '--output-format', 'json', '--permission-mode', 'dontAsk', '--allowedTools', 'Read,Glob,Grep,Edit,Write,Agent,Bash(npm test:*),Bash(node:*)', '--max-budget-usd', '0.60', '--disable-slash-commands'];
if (cond === 'A') args.push('--disallowedTools', 'Agent');
const t0 = Date.now();
const r = spawnSync('claude', args, { cwd: work, encoding: 'utf8', timeout: 600000 });
const wall = Date.now() - t0;
let j = null;
try { j = JSON.parse(r.stdout); } catch { /* keep null */ }

// oracle
const ex = (code) => spawnSync('node', ['-e', code], { cwd: work, encoding: 'utf8' });
let pass = false; let detail = '';
if (task === 'T1') {
  const m = /ANSWER:\s*(.+)/.exec(j?.result ?? '');
  const got = m ? m[1].split(',').map((s) => s.trim().replace(/\.mjs$/, '').replace(/^src\//, '')).sort().join(',') : '';
  pass = got === 'bravo,echo,hotel,kilo,nova'; detail = got;
} else {
  const tests = spawnSync('npm', ['test', '--silent'], { cwd: work, encoding: 'utf8' }).status === 0;
  let spec;
  if (task === 'T2') spec = ex('import("./src/format.mjs").then(m=>{process.exit(m.fmtPrice(5)==="JPY 5.00"?0:1)})').status === 0;
  else {
    const callers = ['bravo', 'echo', 'hotel', 'kilo', 'nova'];
    const others = ['alpha', 'charlie', 'delta', 'foxtrot', 'golf', 'india', 'juliet', 'lima', 'mike'];
    const code = `Promise.all([...${JSON.stringify(callers)},...${JSON.stringify(others)}].map(n=>import("./src/"+n+".mjs"))).then(ms=>{let ok=true;ms.forEach((m,i)=>{const n=i<5?${JSON.stringify(callers)}[i]:${JSON.stringify(others)}[i-5];const v=m[n+"Total"](2,50);ok=ok&&(i<5?v==="JPY 90 "+n:v===n+"100")});process.exit(ok?0:1)})`;
    spec = ex(code).status === 0;
  }
  pass = tests && spec; detail = `tests=${tests} spec=${spec}`;
}

// parent/child split from the persisted session logs (cwd-keyed project dir)
const projDir = path.join(process.env.HOME, '.claude/projects', fs.realpathSync(work).replace(/[^A-Za-z0-9]/g, '-'));
const split = { parent: {}, child: {}, childSessions: 0 };
const add = (bucket, m, u) => { const a = (bucket[m] ??= { n: 0, input: 0, output: 0, cache_read: 0, cache_write: 0 }); a.n++; a.input += u.input_tokens || 0; a.output += u.output_tokens || 0; a.cache_read += u.cache_read_input_tokens || 0; a.cache_write += u.cache_creation_input_tokens || 0; };
const files = [];
(function walk(d) { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.jsonl')) files.push(p); } })(projDir);
for (const f of files) {
  const sub = f.includes('/subagents/'); if (sub) split.childSessions++;
  const last = new Map();
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line) continue; let o; try { o = JSON.parse(line); } catch { continue; }
    const m = o.message; if (m?.role === 'assistant' && m.usage && m.model) last.set(`${m.id}:${o.requestId}`, { m: m.model, u: m.usage });
  }
  for (const { m, u } of last.values()) add(sub ? split.child : split.parent, m, u);
}
const rec = { task, cond, rep: Number(rep), model, pass, detail, wallMs: wall, exit: r.status, costUsd: j?.total_cost_usd ?? null, numTurns: j?.num_turns ?? null, durationApiMs: j?.duration_api_ms ?? null, isError: j?.is_error ?? null, modelUsage: j?.modelUsage ?? null, usage: j?.usage ?? null, split };
fs.writeFileSync(path.join(outDir, `${task}-${cond}-${rep}.json`), JSON.stringify(rec, null, 1));
console.log(JSON.stringify({ task, cond, rep, pass, detail, wallMs: wall, costUsd: rec.costUsd, childSessions: split.childSessions }));
