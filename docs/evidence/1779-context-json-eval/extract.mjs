// run.mjsの生出力（stream-json）から、採点に使う値だけをruns.jsonへ抜き出す読取りだけのscript（#1779）。
// 使い方: node extract.mjs <out-dir> <fixture-A> <fixture-AC> > runs.json
// fixtureの絶対pathはrepo相対へ直し、fixture外を指すtool入力はoutsideとして数える（隔離の事後確認）。
import fs from 'node:fs';
import path from 'node:path';

const [outDir, fixtureA, fixtureAC] = process.argv.slice(2);
const roots = { A: fixtureA, AC: fixtureAC };
const runs = {};
for (const name of fs.readdirSync(outDir).filter((f) => f.endsWith('.jsonl')).sort()) {
  const key = name.slice(0, -'.jsonl'.length);
  const cond = key.split('_')[0];
  const root = path.resolve(roots[cond]);
  const rel = (p) => {
    const abs = path.resolve(root, p);
    return abs === root || abs.startsWith(root + path.sep) ? path.relative(root, abs).split(path.sep).join('/') || '.' : null;
  };
  const meta = JSON.parse(fs.readFileSync(path.join(outDir, `${key}.meta.json`), 'utf8'));
  const events = fs.readFileSync(path.join(outDir, name), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const tools = [], reads = [];
  let outside = 0, result = null, init = null;
  for (const e of events) {
    if (e.type === 'system' && e.subtype === 'init') init = { tools: e.tools, mcp: e.mcp_servers.length, model: e.model, version: e.claude_code_version, permissionMode: e.permissionMode };
    if (e.type === 'assistant')
      for (const c of e.message.content)
        if (c.type === 'tool_use') {
          const target = c.input.file_path ?? c.input.path ?? '.';
          const r = rel(target);
          if (r === null) outside += 1;
          tools.push({ tool: c.name, target: r ?? '<outside>' });
          if (c.name === 'Read' && r !== null) reads.push(r);
        }
    if (e.type === 'result') result = e;
  }
  const text = result?.result ?? '';
  const filesLine = text.split('\n').find((l) => l.startsWith('FILES:'));
  const rootLine = text.split('\n').find((l) => l.startsWith('ROOT:'));
  const usage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, costUSD: 0 };
  for (const m of Object.values(result?.modelUsage ?? {})) {
    usage.input += m.inputTokens; usage.output += m.outputTokens;
    usage.cacheRead += m.cacheReadInputTokens; usage.cacheCreation += m.cacheCreationInputTokens; usage.costUSD += m.costUSD;
  }
  runs[key] = {
    status: meta.code === 0 && result && !result.is_error && filesLine ? 'ok' : 'failed',
    exit: meta.code, signal: meta.signal, startedAt: meta.startedAt, wallMs: meta.wallMs,
    durationMs: result?.duration_ms ?? null, numTurns: result?.num_turns ?? null,
    usage: result ? usage : null, models: Object.keys(result?.modelUsage ?? {}), init,
    toolUses: tools.length, outsideToolInputs: outside, tools, reads: [...new Set(reads)],
    files: filesLine ? filesLine.slice('FILES:'.length).split(',').map((x) => x.trim()).filter(Boolean) : null,
    root: rootLine ? rootLine.slice('ROOT:'.length).trim() : null,
  };
}
process.stdout.write(JSON.stringify(runs, null, 1) + '\n');
