// Scores the model runs against the fixed oracle (cases.json). Reads only the copied traces.
// Usage: node score.mjs <cases.json> <traces-dir> <condition>... [--runs-json <out.json>]
// Trace files are named <condition>-<case>-<n>.jsonl (copied by run-suite.sh).
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const outIdx = args.indexOf('--runs-json');
const outFile = outIdx >= 0 ? args.splice(outIdx, 2)[1] : null;
const [casesFile, dir, ...conds] = args;
const spec = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
const asc = ['asc', 'contract-enforcement', 'decision-ownership', 'engineering-judgment', 'estimate-and-scope', 'execution-recovery', 'migration-assurance', 'project-foundation', 'research-to-implementation', 'review-and-remediation', 'security-evidence', 'subagent-model-selection', 'tracker-issue-writing', 'user-journey-acceptance', 'verification-optimization', 'work-coordination'];
const body = (s) => new RegExp(spec.bodyPattern.replace('<skill>', s));
const ref = (s, r) => new RegExp(spec.referencePattern.replace('<skill>', s).replace('<ref>', r.replace(/\./g, '\\.')));
const same = (called, s) => called === s || called.endsWith(`:${s}`);
const runs = [];
for (const file of fs.readdirSync(dir).sort()) {
  const m = /^([A-Z])-(.+)-(\d+)\.jsonl(\.missing)?$/.exec(file);
  if (!m || !conds.includes(m[1])) continue;
  const [, cond, id, n, missing] = m;
  const k = spec.cases.find((c) => c.id === id);
  if (!k) continue;
  const row = {condition: cond, case: id, run: Number(n), expect: k.expect};
  if (missing) { runs.push({...row, failure: 'missing trace'}); continue; }
  const lines = fs.readFileSync(path.join(dir, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const result = lines.find((l) => l.type === 'result');
  const uses = lines.filter((l) => l.type === 'assistant').flatMap((l) => l.message.content.filter((c) => c.type === 'tool_use'));
  const skills = uses.filter((u) => u.name === 'Skill').map((u) => String(u.input.skill ?? ''));
  const reads = uses.filter((u) => u.name === 'Read').map((u) => String(u.input.file_path ?? ''));
  const text = result?.result ?? lines.filter((l) => l.type === 'assistant').flatMap((l) => l.message.content.filter((c) => c.type === 'text').map((c) => c.text)).join('\n');
  const ascBodies = asc.filter((s) => reads.some((r) => body(s).test(r)));
  Object.assign(row, {skills, ascBodies, readmeRead: reads.some((r) => /\.agent-skill-chain\/(managed-runtime\/)?skills\/README\.md$/.test(r)), toolUses: uses.length,
    usage: result?.usage ? {input: result.usage.input_tokens, output: result.usage.output_tokens, cacheRead: result.usage.cache_read_input_tokens, cacheWrite: result.usage.cache_creation_input_tokens} : null,
    costUsd: result?.total_cost_usd ?? null, turns: result?.num_turns ?? null, durationMs: result?.duration_ms ?? null});
  if (!result || result.is_error) { row.failure = result ? `result error: ${String(result.result ?? result.subtype).slice(0, 120)}` : 'no result event'; runs.push(row); continue; }
  if (k.expect) {
    const e = k.expect;
    row.reach = skills.some((s) => same(s, e)) || ascBodies.includes(e);
    row.bodyRead = ascBodies.includes(e);
    row.referenceRead = k.references.length === 0 || k.references.some((r) => reads.some((p) => ref(e, r).test(p)));
    const low = text.toLowerCase();
    row.markers = k.answerAll.every((a) => low.includes(a.toLowerCase())) && (k.answerAny.length === 0 || k.answerAny.some((a) => new RegExp(a, 'i').test(text)));
    row.applied = row.bodyRead && row.referenceRead && row.markers;
    row.misselect = !row.reach && (skills.length > 0 || ascBodies.length > 0);
    row.unselected = !row.reach && skills.length === 0 && ascBodies.length === 0;
    row.extraSkills = skills.filter((s) => !same(s, e));
  } else {
    row.overapplication = skills.length > 0 || ascBodies.length > 0;
    row.markers = k.answerAll.every((a) => text.includes(a)) && (k.answerAny.length === 0 || k.answerAny.some((a) => new RegExp(a, 'i').test(text)));
  }
  runs.push(row);
}
if (outFile) fs.writeFileSync(outFile, JSON.stringify(runs, null, 1));
const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) ?? 0), 0);
for (const c of conds) {
  const rs = runs.filter((r) => r.condition === c);
  const ok = rs.filter((r) => !r.failure), pos = ok.filter((r) => r.expect), neg = ok.filter((r) => !r.expect);
  const cnt = (f) => `${pos.filter(f).length}/${pos.length}`;
  console.log(JSON.stringify({condition: c, runs: rs.length, failures: rs.filter((r) => r.failure).length,
    reach: cnt((r) => r.reach), misselect: cnt((r) => r.misselect), unselected: cnt((r) => r.unselected), bodyRead: cnt((r) => r.bodyRead), referenceRead: cnt((r) => r.reach && r.referenceRead), applied: cnt((r) => r.applied),
    extraSkillCalls: sum(pos, (r) => r.extraSkills.length), syntheticCalls: sum(ok, (r) => r.skills.filter((s) => s.startsWith('toolbox:')).length), readmeRead: `${ok.filter((r) => r.readmeRead).length}/${ok.length}`,
    negOverapplication: `${neg.filter((r) => r.overapplication).length}/${neg.length}`, negMarkers: `${neg.filter((r) => r.markers).length}/${neg.length}`,
    perCase: Object.fromEntries(spec.cases.map((k) => [k.id, ok.filter((r) => r.case === k.id).map((r) => (k.expect ? (r.applied ? 'A' : r.reach ? 'R' : r.misselect ? 'M' : 'U') : (r.overapplication ? 'O' : '-'))).join('')])),
    tokens: {input: sum(ok, (r) => r.usage?.input), output: sum(ok, (r) => r.usage?.output), cacheRead: sum(ok, (r) => r.usage?.cacheRead), cacheWrite: sum(ok, (r) => r.usage?.cacheWrite)},
    costUsd: Number(sum(ok, (r) => r.costUsd).toFixed(4)), turns: sum(ok, (r) => r.turns), durationSec: Math.round(sum(ok, (r) => r.durationMs) / 1000)}));
}
