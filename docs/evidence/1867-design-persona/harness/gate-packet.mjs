// #1867 gate, the part that reads the design records (config/layers/gate-count.json). No model call.
//   pack:    node harness/gate-packet.mjs pack <runs-root> <out-dir> --seed <s> --runs-json <results/runs.json>
//            [--replace <failed>=<replacement>]...
//            <out-dir>/packet/{TASK.md, index.json, records/<id>.md}: the records of the 24 slots (B and S) under random
//            ids in a random order (seed), nothing else; a valid trial without a record is an empty file. <out-dir>/key/
//            key.json maps ids back. The packet directory is the launch directory of the read-only counting session
//            (gate-count.json host). Review L-1: the trials taken must be the counted rows of runs.json (checkCounted, as
//            combine), and a slot without a valid trial (its replacement failed too, or no replacement was run) is not
//            in the packet: the key lists it in absent, and combine counts it as 無い ((a), (b) and the gate false).
//   check:   node harness/gate-packet.mjs check <packet-dir> <answer-file>
//            Whether a round's answer must be redone (review L-2): no answer, unreadable JSON, or an id without a/b
//            booleans -> exit 1 (redo once in a new context). Reads only the packet's ids, never the key.
//   combine: node harness/gate-packet.mjs combine --round <key.json>=<answer>[+<redo>] --round <key.json>=<answer>[+<redo>]
//            --runs-json <results/runs.json> --out <gate.json>
//            The redo of a round is given exactly when check refused its first answer; the redo is the round's answer
//            and an id it still leaves out is false. A record has (a) / (b) when both rounds say true; split, missing or
//            unreadable -> false. An S trial passes the gate when (a), (b) and the machine part (runs.json expectReadsAll:
//            the design-creation SKILL.md read) hold; a case is judgeable with 2 of 3; the gate is "未判定" with fewer
//            than 3 judgeable cases of 4. The trials of the keys must be the counted rows of runs.json (review L-3).
//            costUsd: the total_cost_usd of every answer file (an answer is the claude -p --output-format json output,
//            or a plain text answer, whose cost is unknown).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeRng, shuffle, idAllocator, extractJson, readJson, writeJson} from '../../1835-design-eval-layers/harness/eval-common.mjs';
import {countedTrials, parseReplacements, argList, workOf, RECORD, CASES, checkCounted, failedCounted} from './trials.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PROMPT = path.resolve(here, '../config/layers/gate-count-prompt.md');

export function pack({runs, out, seed, replacements = {}, runsRows}) {
  if (!seed) throw new Error('--seed is required');
  if (!Array.isArray(runsRows)) throw new Error('--runs-json <results/runs.json> is required (review L-1)');
  const pk = path.join(out, 'packet');
  if (fs.existsSync(pk)) throw new Error(`${pk} exists; use a new directory`);
  checkCounted(replacements, runsRows);
  const failed = failedCounted(runsRows);
  const all = countedTrials(replacements);
  const trials = all.filter((t) => !failed.has(t.name));
  const newId = idAllocator(makeRng(seed, 'gate-ids'), 6);
  const order = shuffle(trials, makeRng(seed, 'gate-order'));
  fs.mkdirSync(path.join(pk, 'records'), {recursive: true});
  const key = {schema: 'asc-1867-gate-key/v1', seed, records: {},
    absent: all.filter((t) => failed.has(t.name)).map((t) => ({condition: t.condition, case: t.case, slot: t.slot, run: t.name, reason: 'failed trial (no valid trial in the slot)'}))};
  const ids = order.map((t) => {
    const id = newId('r');
    const f = path.join(workOf(runs, t), RECORD);
    const has = fs.existsSync(f);
    fs.writeFileSync(path.join(pk, 'records', `${id}.md`), has ? fs.readFileSync(f) : '');
    key.records[id] = {condition: t.condition, case: t.case, slot: t.slot, run: t.name, recordMissing: !has};
    return id;
  });
  fs.copyFileSync(PROMPT, path.join(pk, 'TASK.md'));
  writeJson(path.join(pk, 'index.json'), ids);
  writeJson(path.join(out, 'key', 'key.json'), key);
  return key;
}

// An answer file: the output of claude -p --output-format json ({type: 'result', result, total_cost_usd, ...}) or a plain text.
export function answerOf(raw) {
  let j = null;
  try { j = JSON.parse(raw); } catch { /* plain text */ }
  if (j && typeof j === 'object' && j.type === 'result') return {text: typeof j.result === 'string' ? j.result : '', costUsd: typeof j.total_cost_usd === 'number' ? j.total_cost_usd : null, isError: j.is_error === true, subtype: j.subtype ?? null};
  return {text: typeof raw === 'string' ? raw : '', costUsd: null, isError: false, subtype: null};
}
const recordsOf = (text) => { const j = extractJson(text); return j && typeof j.records === 'object' && j.records && !Array.isArray(j.records) ? j.records : null; };
const answeredId = (rec, id) => typeof rec?.[id]?.a === 'boolean' && typeof rec?.[id]?.b === 'boolean';

// Review L-2: whether a round's answer must be redone once. ids: the packet's index.json.
export function answerStatus(ids, raw) {
  const {text, costUsd, isError, subtype} = answerOf(raw);
  if (!text.trim()) return {ok: false, reason: 'no-answer', missingIds: ids, costUsd, isError, subtype};
  const rec = recordsOf(text);
  if (!rec) return {ok: false, reason: 'unreadable', missingIds: ids, costUsd, isError, subtype};
  const missingIds = ids.filter((id) => !answeredId(rec, id));
  return {ok: missingIds.length === 0, reason: missingIds.length ? 'partial' : null, missingIds, costUsd, isError, subtype};
}

// One round's answers by trial run name: {run: {a, b}} (false where the answer is missing or not a boolean).
export function roundAnswers(key, raw) {
  const rec = recordsOf(answerOf(raw).text) ?? {};
  return Object.fromEntries(Object.entries(key.records).map(([id, k]) => [k.run, {a: rec[id]?.a === true, b: rec[id]?.b === true, answered: answeredId(rec, id)}]));
}

// rounds: [{key, attempts: [answer, redo?]}] ({key, text} is one attempt).
export function combine({rounds, runsRows}) {
  if (rounds.length !== 2) throw new Error('combine needs exactly 2 rounds');
  const machine = Object.fromEntries(runsRows.map((r) => [`${r.condition}-${r.case}-${r.run}`, r.expectReadsAll === true]));
  const absentOf = (key) => key.absent ?? [];
  const runsOf = rounds.map(({key}) => [...Object.values(key.records), ...absentOf(key)].map((r) => r.run).sort().join());
  if (runsOf[0] !== runsOf[1]) throw new Error('the two rounds do not hold the same trials');
  if (rounds.map(({key}) => absentOf(key).map((r) => r.run).sort().join()).some((x, _, xs) => x !== xs[0])) throw new Error('the two rounds do not leave out the same slots');
  // review L-3: the trials of the key are the counted rows of runs.json; L-1: the slots left out are its failed counted rows
  const slotsOf = [...Object.values(rounds[0].key.records), ...absentOf(rounds[0].key)];
  const repl = Object.fromEntries(slotsOf.filter((r) => r.run !== `${r.condition}-${r.case}-${r.slot.split('-r')[1]}`).map((r) => [`${r.condition}-${r.case}-${r.slot.split('-r')[1]}`, r.run]));
  checkCounted(repl, runsRows);
  const failed = failedCounted(runsRows);
  const absentRuns = absentOf(rounds[0].key).map((r) => r.run).sort().join(), wantAbsent = slotsOf.filter((r) => failed.has(r.run)).map((r) => r.run).sort().join();
  if (absentRuns !== wantAbsent) throw new Error(`the slots left out of the packet [${absentRuns}] are not the failed counted rows of runs.json [${wantAbsent}]`);
  const attemptsInfo = rounds.map(({key, attempts, text}, i) => {
    const at = attempts ?? [text];
    if (at.length < 1 || at.length > 2) throw new Error(`round ${i + 1}: one answer and at most one redo`);
    const first = answerStatus(Object.keys(key.records), at[0]);
    if (!first.ok && at.length === 1) throw new Error(`round ${i + 1}: the answer must be redone once in a new context (${first.reason}; missing ${first.missingIds.length})`);
    if (first.ok && at.length === 2) throw new Error(`round ${i + 1}: a redo is only for an answer that check refused`);
    const last = at.length === 2 ? answerStatus(Object.keys(key.records), at[1]) : first;
    const costs = at.map((x) => answerOf(x).costUsd);
    return {raw: at[at.length - 1], redone: at.length === 2, firstReason: first.reason, missingAfterRedo: last.ok ? 0 : last.missingIds.length,
      costUsd: costs.reduce((s, c) => s + (c ?? 0), 0), costMissing: costs.filter((c) => c === null).length};
  });
  const ans = rounds.map(({key}, i) => roundAnswers(key, attemptsInfo[i].raw));
  const trials = [...Object.values(rounds[0].key.records).map((k) => {
    const a = ans.every((x) => x[k.run].a), b = ans.every((x) => x[k.run].b);
    const m = machine[k.run] ?? false;
    return {condition: k.condition, case: k.case, slot: k.slot, run: k.run, a, b, aRounds: ans.map((x) => x[k.run].a), bRounds: ans.map((x) => x[k.run].b),
      unanswered: ans.map((x) => !x[k.run].answered), recordMissing: k.recordMissing, machine: m, gate: a && b && m};
  }), ...absentOf(rounds[0].key).map((k) => ({condition: k.condition, case: k.case, slot: k.slot, run: k.run, a: false, b: false, aRounds: [false, false], bRounds: [false, false],
    unanswered: [true, true], recordMissing: true, absent: k.reason, machine: false, gate: false}))].sort((x, y) => (x.run < y.run ? -1 : 1));
  const perCase = Object.fromEntries(CASES.map((c) => {
    const s = trials.filter((t) => t.condition === 'S' && t.case === c);
    const pass = s.filter((t) => t.gate).length;
    return [c, {S: `${pass}/${s.length}`, judgeable: pass >= 2, B: {a: trials.filter((t) => t.condition === 'B' && t.case === c && t.a).length, b: trials.filter((t) => t.condition === 'B' && t.case === c && t.b).length, of: 3}}];
  }));
  const judgeable = Object.entries(perCase).filter(([, v]) => v.judgeable).map(([c]) => c);
  return {schema: 'asc-1867-gate/v1', rule: 'record (a)/(b): both rounds true; S trial: (a) and (b) and the SKILL.md read; case: 2 of 3; overall: 3 of 4 cases',
    trials, perCase, judgeableCases: judgeable, gate: judgeable.length >= 3 ? 'judged' : '未判定',
    minOwnerDecidedPairs: Math.ceil((24 * judgeable.length) / 4),
    rounds: attemptsInfo.map(({raw, ...x}) => x), costUsd: Number(attemptsInfo.reduce((s, x) => s + x.costUsd, 0).toFixed(4)),
    costMissing: attemptsInfo.reduce((s, x) => s + x.costMissing, 0)};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2), opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
  try {
    if (a[0] === 'pack') {
      if (!opt('--runs-json')) throw new Error('--runs-json <results/runs.json> is required (review L-1)');
      const key = pack({runs: path.resolve(a[1]), out: path.resolve(a[2]), seed: opt('--seed'), replacements: parseReplacements(argList(a, '--replace')), runsRows: readJson(path.resolve(opt('--runs-json')))});
      console.log(JSON.stringify({records: Object.keys(key.records).length, missing: Object.values(key.records).filter((r) => r.recordMissing).length, absent: key.absent.map((r) => r.run)}));
    } else if (a[0] === 'check') {
      const st = answerStatus(readJson(path.join(path.resolve(a[1]), 'index.json')), fs.readFileSync(path.resolve(a[2]), 'utf8'));
      console.log(JSON.stringify({ok: st.ok, reason: st.reason, missing: st.missingIds.length, costUsd: st.costUsd, isError: st.isError, subtype: st.subtype}));
      if (!st.ok) process.exitCode = 1;
    } else if (a[0] === 'combine') {
      const rounds = argList(a, '--round').map((x) => { const [k, f] = x.split('='); return {key: readJson(path.resolve(k)), attempts: f.split('+').map((g) => fs.readFileSync(path.resolve(g), 'utf8'))}; });
      const res = combine({rounds, runsRows: readJson(path.resolve(opt('--runs-json')))});
      writeJson(path.resolve(opt('--out')), res);
      console.log(JSON.stringify({gate: res.gate, judgeableCases: res.judgeableCases, perCase: res.perCase, costUsd: res.costUsd, rounds: res.rounds}));
    } else { console.error('usage: gate-packet.mjs pack|check|combine ...'); process.exit(2); }
  } catch (e) { console.error(e.message); process.exit(2); }
}
