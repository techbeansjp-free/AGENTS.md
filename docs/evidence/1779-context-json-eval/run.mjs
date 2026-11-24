// #1779の読取り役を、隔離した設定のClaude Codeで起動する測定用script。
// 使い方:
//   node run.mjs probe <fixture> <prompt-file> <out-prefix>
//   node run.mjs measure <cases.json> <asc-cli> <fixture-A> <fixture-AC> <out-dir> <rep> <first-condition> [concurrency] [only]
// onlyは`A_R1,AC_R5`のような条件_ケースのカンマ区切り。失敗した試行だけをやり直すときに使い、他の記録を上書きしない。
// 出力（stream-json、stderr、prompt、起動設定）はout側だけに書く。fixtureへは書かない。
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// 読取り役の起動設定。--restrictedはuser/project/localの設定fileを無視し、file toolを作業directoryへ閉じる。
export const CLAUDE_ARGS = [
  '-p', '--model', 'opus', '--output-format', 'stream-json', '--verbose', '--restricted',
  '--tools', 'Read,Glob,Grep', '--allowedTools', 'Read,Glob,Grep', '--permission-mode', 'dontAsk',
  '--strict-mcp-config', '--settings', '{"disableAllHooks":true}', '--no-session-persistence',
];

const childEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

export function launch(fixture, prompt, prefix, timeoutMs = 600000) {
  return new Promise((resolve) => {
    fs.writeFileSync(`${prefix}.prompt.txt`, prompt);
    fs.writeFileSync(`${prefix}.launch.json`, JSON.stringify({ argv: CLAUDE_ARGS, cwd: '<fixture>', envNames: Object.keys(childEnv()).sort() }, null, 1));
    const started = Date.now();
    const out = fs.openSync(`${prefix}.jsonl`, 'w'), err = fs.openSync(`${prefix}.stderr.txt`, 'w');
    const child = spawn('claude', CLAUDE_ARGS, { cwd: fixture, env: childEnv(), stdio: ['pipe', out, err] });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdin.end(prompt);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      fs.closeSync(out); fs.closeSync(err);
      const meta = { code, signal, wallMs: Date.now() - started, startedAt: new Date(started).toISOString() };
      fs.writeFileSync(`${prefix}.meta.json`, JSON.stringify(meta));
      resolve(meta);
    });
  });
}

export function startContext(cli, fixture, paths) {
  const args = [cli, 'start', fixture, ...paths.flatMap((p) => ['--path', p])];
  return JSON.parse(execFileSync('node', args, { encoding: 'utf8' })).context;
}

export function buildPrompt(fixture, req, context) {
  return [
    `Read-only investigation of the repository at \`${fixture}\` (use absolute paths; never edit or create any file).`,
    `Change request (do not implement it): ${req}`,
    'Determine the evidence an engineer must read before implementing AND verifying this change safely: source code, existing tests, contracts/docs that describe the behavior, applicable project rules. Investigate for real; stop when you are confident the set is sufficient.',
    'Working rules: avoid filling context with large tool output; search to locate positions, then read only the necessary ranges; do not dump whole files or logs.',
    'Output of the ASC command `start <repository> --path <intended changed paths>` for this change (its `context` field):',
    '```json', JSON.stringify(context, null, 2), '```',
    'Your final reply must be exactly two lines and nothing else: line 1 `FILES: ` followed by comma-separated repo-relative paths of the evidence; line 2 `ROOT: ` followed by true or false (whether you read the root AGENTS.md/CLAUDE.md).',
  ].join('\n');
}

async function pool(jobs, size) {
  const results = [];
  let next = 0;
  const worker = async () => { while (next < jobs.length) { const i = next++; results[i] = await jobs[i](); } };
  await Promise.all(Array.from({ length: size }, worker));
  return results;
}

const main = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
const [mode, ...rest] = main ? process.argv.slice(2) : ['import'];
if (mode === 'import') {
  // moduleとして読み込まれた場合は何もしない。
} else if (mode === 'probe') {
  const [fixture, promptFile, prefix] = rest;
  console.log(JSON.stringify(await launch(fixture, fs.readFileSync(promptFile, 'utf8'), prefix, 300000)));
} else if (mode === 'measure') {
  const [casesFile, cli, fixtureA, fixtureAC, outDir, rep, first, concurrency = '4', only = ''] = rest;
  const selected = new Set(only.split(',').filter(Boolean));
  const { cases } = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
  const fixtures = { A: fixtureA, AC: fixtureAC };
  const order = first === 'A' ? ['A', 'AC'] : ['AC', 'A'];
  fs.mkdirSync(outDir, { recursive: true });
  // 条件の順序を回ごとに交替する。同じ回の中では、先の条件の全ケースを終えてから後の条件を起動する。
  for (const cond of order) {
    const jobs = cases.filter((c) => !selected.size || selected.has(`${cond}_${c.id}`)).map((c) => async () => {
      const prefix = path.join(outDir, `${cond}_${c.id}_${rep}`);
      if (fs.existsSync(`${prefix}.jsonl`)) throw Error(`refusing to overwrite ${prefix}; rename a failed attempt to .failed1 first`);
      const context = startContext(cli, fixtures[cond], c.paths);
      fs.writeFileSync(`${prefix}.context.json`, JSON.stringify(context, null, 1));
      const meta = await launch(fixtures[cond], buildPrompt(fixtures[cond], c.req, context), prefix);
      console.log(cond, c.id, rep, JSON.stringify(meta));
      return meta;
    });
    await pool(jobs, Number(concurrency));
  }
} else {
  console.error('usage: node run.mjs probe|measure ...');
  process.exitCode = 1;
}
