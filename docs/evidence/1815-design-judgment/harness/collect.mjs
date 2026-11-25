// Writes the per-trial records that go into the public repository (#1815, review M-5). Only derived records are
// published; the raw trace.jsonl, tools.jsonl, proxy.jsonl, screenshots, page text and the sample project stay in the
// scratch runs root. Published per trial:
//   meta.json      selected fields (no init Skill list, no final text, no session id)
//   reads.json     which ASC files were read (reads.mjs)
//   core-steps.json and indicators.json (gold summary, first-view, render summary without page text)
//   tool-calls.json  for every tool call in the trace: its name, its target (file path relative to the sample project,
//                  URL, screenshot path and width, Skill name) and whether it succeeded - never the input body (Write
//                  content, Edit strings) or any result body (fetched page text, images)
// Redaction (#1814 collect.mjs redact + scrubSensitive, the runs root as <runs>, session ids and UUIDs as <id>) is applied
// to every published text, and a published text that still holds the runs root, a UUID or a base64 image is refused.
// Usage: node collect.mjs <runs-root> <render-root> <out-dir>
import fs from 'node:fs';
import path from 'node:path';
import {redact, scrubSensitive} from '../../1814-skill-invocation/harness/collect.mjs';
import {parseStream} from '../../1807-design-eval-browser/harness/core-steps.mjs';
import {projectRelative} from './reads.mjs';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const BASE64_IMAGE = /(?:data:image\/[a-z+]+;base64,|"data"\s*:\s*")[A-Za-z0-9+/]{200,}/;

export function clean(text, runsRoot) {
  const real = fs.existsSync(runsRoot) ? fs.realpathSync(runsRoot) : runsRoot;
  const variants = [...new Set([runsRoot, real, real.replace(/^\/private(?=\/(tmp|var)\/)/, '')])].sort((a, b) => b.length - a.length);
  let t = String(text);
  for (const v of variants) t = t.split(v).join('<runs>');
  t = t.replace(/"session_?[iI]d"\s*:\s*"[^"]*"/g, '"sessionId":"<id>"').replace(UUID, '<id>');
  const r = scrubSensitive(redact(t, runsRoot));
  if (variants.some((v) => r.text.includes(v))) throw new Error('runs root left after redaction');
  if (BASE64_IMAGE.test(r.text)) throw new Error('image data left in a published record');
  return r;
}

// Tool calls without bodies: name, target, success.
export function toolCalls(traceText, cwd) {
  const {events} = parseStream(traceText);
  const results = new Map();
  for (const e of events) if (e.type === 'user' && Array.isArray(e.message?.content)) for (const c of e.message.content) if (c?.type === 'tool_result') results.set(c.tool_use_id, c);
  const uses = events.filter((e) => e.type === 'assistant').flatMap((e) => (e.message?.content ?? []).filter((c) => c?.type === 'tool_use'));
  const target = (u) => {
    const i = u.input ?? {};
    if (i.file_path) return projectRelative(String(i.file_path), cwd) ?? '<outside the project>';
    if (u.name === 'mcp__browser__screenshot') return `${i.path} @${i.width}`;
    if (i.url) return `${i.url}${i.width ? ` @${i.width}` : ''}`;
    if (u.name === 'Skill') return String(i.skill ?? i.command ?? '');
    if (u.name === 'Glob' || u.name === 'Grep') return `${i.pattern ?? ''}${i.path ? ` in ${projectRelative(String(i.path), cwd) ?? '<outside the project>'}` : ''}`;
    return null;
  };
  return uses.map((u) => { const r = results.get(u.id); return {name: u.name, target: target(u), ok: Boolean(r) && r.is_error !== true}; });
}

export function publishTrial({src, renderDir, renderRow, runsRoot}) {
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
  const meta = JSON.parse(read(path.join(src, 'meta.json')));
  const keep = ['schema', 'trial', 'case', 'condition', 'rep', 'model', 'budget', 'claudeVersion', 'resolvedModel', 'initProblems', 'tarballSha256', 'release', 'sampleHead',
    'ascRuntimeVersion', 'adopted', 'images', 'ledgerId', 'ledgerSeq', 'fixedAtCommit', 'fixationSha256', 'exit', 'signal', 'wallMs', 'resultSubtype', 'isError', 'costUsd',
    'numTurns', 'usage', 'permissionDenials', 'toolCounts', 'reads', 'coreSteps', 'credentialInChildFiles'];
  const files = {'meta.json': JSON.stringify(Object.fromEntries(keep.filter((k) => k in meta).map((k) => [k, meta[k]])), null, 1)};
  const reads = read(path.join(src, 'reads.json'));
  if (reads) files['reads.json'] = reads;
  const core = read(path.join(src, 'core-steps.json'));
  if (core) files['core-steps.json'] = core;
  const trace = read(path.join(src, 'trace.jsonl')) ?? '';
  const cwd = JSON.parse(reads ?? '{}').cwd ?? null;
  files['tool-calls.json'] = JSON.stringify(toolCalls(trace, cwd), null, 1);
  const j = (f) => { const t = read(path.join(renderDir, f)); return t ? JSON.parse(t) : null; };
  const render = renderRow ? {...renderRow, viewports: Object.fromEntries(Object.entries(renderRow.viewports ?? {}).map(([k, v]) => { const rest = {...v}; delete rest.textSample; return [k, rest]; }))} : null;
  if (render) delete render.file;
  files['indicators.json'] = JSON.stringify({gold: j('gold.json'), firstView: j('first-view.json'), render}, null, 1);
  let hits = 0;
  const out = {};
  for (const [f, text] of Object.entries(files)) { const r = clean(text, runsRoot); hits += r.hits; out[f] = r.text; }
  return {files: out, hits, row: {trial: meta.trial, costUsd: meta.costUsd, exit: meta.exit, subtype: meta.resultSubtype, reads: meta.reads, coreSteps: meta.coreSteps, ledgerSeq: meta.ledgerSeq}};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [runsArg, renderArg, outArg] = process.argv.slice(2).map((p) => path.resolve(p));
  let hits = 0;
  const rows = [];
  for (const c of fs.readdirSync(runsArg).filter((x) => x !== 'probe' && fs.statSync(path.join(runsArg, x)).isDirectory()).sort()) {
    const rj = path.join(renderArg, c, 'render.json');
    const renderRows = fs.existsSync(rj) ? JSON.parse(fs.readFileSync(rj, 'utf8')) : [];
    for (const t of fs.readdirSync(path.join(runsArg, c)).filter((x) => /^(B|S)-r\d+$/.test(x)).sort()) {
      const src = path.join(runsArg, c, t);
      if (!fs.existsSync(path.join(src, 'meta.json'))) { rows.push({trial: `${c}/${t}`, missing: 'meta.json'}); continue; }
      const p = publishTrial({src, renderDir: path.join(renderArg, c, t), renderRow: renderRows.find((x) => x.id === t), runsRoot: runsArg});
      const dst = path.join(outArg, 'trials', c, t);
      fs.mkdirSync(dst, {recursive: true});
      for (const [f, text] of Object.entries(p.files)) fs.writeFileSync(path.join(dst, f), text);
      hits += p.hits; rows.push(p.row);
    }
  }
  fs.mkdirSync(outArg, {recursive: true});
  fs.writeFileSync(path.join(outArg, 'trials.json'), clean(JSON.stringify(rows, null, 1), runsArg).text);
  console.log(JSON.stringify({trials: rows.length, redactedSensitive: hits}));
}
