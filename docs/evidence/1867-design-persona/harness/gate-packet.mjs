// #1867 gate, the part that reads the design records (config/layers/gate-count.json). No model call.
//   pack:    node harness/gate-packet.mjs pack <runs-root> <out-dir> --seed <s> [--replace <failed>=<replacement>]...
//            <out-dir>/packet/{TASK.md, index.json, records/<id>.md}: the 24 records (B and S) under random ids in a
//            random order (seed), nothing else; a missing record is an empty file. <out-dir>/key/key.json maps ids back.
//            Pass <out-dir>/packet to asc host-session claude as the directory (reads are closed to it).
//   combine: node harness/gate-packet.mjs combine --round <key.json>=<answer-file> --round <key.json>=<answer-file>
//            --runs-json <results/runs.json> --out <gate.json>
//            A record has (a) / (b) when both rounds say true; split, missing or unreadable -> false. An S trial passes the
//            gate when (a), (b) and the machine part (runs.json expectReadsAll: the design-creation SKILL.md read) hold;
//            a case is judgeable with 2 of 3; the gate is "未判定" with fewer than 3 judgeable cases of 4.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeRng, shuffle, idAllocator, extractJson, readJson, writeJson} from '../../1835-design-eval-layers/harness/eval-common.mjs';
import {countedTrials, parseReplacements, argList, workOf, RECORD, CASES} from './trials.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PROMPT = path.resolve(here, '../config/layers/gate-count-prompt.md');

export function pack({runs, out, seed, replacements = {}}) {
  if (!seed) throw new Error('--seed is required');
  const pk = path.join(out, 'packet');
  if (fs.existsSync(pk)) throw new Error(`${pk} exists; use a new directory`);
  const trials = countedTrials(replacements);
  const newId = idAllocator(makeRng(seed, 'gate-ids'), 6);
  const order = shuffle(trials, makeRng(seed, 'gate-order'));
  fs.mkdirSync(path.join(pk, 'records'), {recursive: true});
  const key = {schema: 'asc-1867-gate-key/v1', seed, records: {}};
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

// One round's answers by trial run name: {run: {a, b}} (false where the answer is missing or not a boolean).
export function roundAnswers(key, text) {
  const j = extractJson(text);
  const rec = j && typeof j.records === 'object' && j.records ? j.records : {};
  return Object.fromEntries(Object.entries(key.records).map(([id, k]) => [k.run, {a: rec[id]?.a === true, b: rec[id]?.b === true, answered: id in rec}]));
}

export function combine({rounds, runsRows}) {
  if (rounds.length !== 2) throw new Error('combine needs exactly 2 rounds');
  const machine = Object.fromEntries(runsRows.map((r) => [`${r.condition}-${r.case}-${r.run}`, r.expectReadsAll === true]));
  const runsOf = rounds.map(({key}) => Object.values(key.records).map((r) => r.run).sort().join());
  if (runsOf[0] !== runsOf[1]) throw new Error('the two rounds do not hold the same trials');
  const ans = rounds.map(({key, text}) => roundAnswers(key, text));
  const trials = Object.values(rounds[0].key.records).map((k) => {
    const a = ans.every((x) => x[k.run].a), b = ans.every((x) => x[k.run].b);
    const m = machine[k.run] ?? false;
    return {condition: k.condition, case: k.case, slot: k.slot, run: k.run, a, b, aRounds: ans.map((x) => x[k.run].a), bRounds: ans.map((x) => x[k.run].b),
      unanswered: ans.map((x) => !x[k.run].answered), recordMissing: k.recordMissing, machine: m, gate: a && b && m};
  }).sort((x, y) => (x.run < y.run ? -1 : 1));
  const perCase = Object.fromEntries(CASES.map((c) => {
    const s = trials.filter((t) => t.condition === 'S' && t.case === c);
    const pass = s.filter((t) => t.gate).length;
    return [c, {S: `${pass}/${s.length}`, judgeable: pass >= 2, B: {a: trials.filter((t) => t.condition === 'B' && t.case === c && t.a).length, b: trials.filter((t) => t.condition === 'B' && t.case === c && t.b).length, of: 3}}];
  }));
  const judgeable = Object.entries(perCase).filter(([, v]) => v.judgeable).map(([c]) => c);
  return {schema: 'asc-1867-gate/v1', rule: 'record (a)/(b): both rounds true; S trial: (a) and (b) and the SKILL.md read; case: 2 of 3; overall: 3 of 4 cases',
    trials, perCase, judgeableCases: judgeable, gate: judgeable.length >= 3 ? 'judged' : '未判定',
    minOwnerDecidedPairs: Math.ceil((24 * judgeable.length) / 4)};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2), opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
  try {
    if (a[0] === 'pack') {
      const key = pack({runs: path.resolve(a[1]), out: path.resolve(a[2]), seed: opt('--seed'), replacements: parseReplacements(argList(a, '--replace'))});
      console.log(JSON.stringify({records: Object.keys(key.records).length, missing: Object.values(key.records).filter((r) => r.recordMissing).length}));
    } else if (a[0] === 'combine') {
      const rounds = argList(a, '--round').map((x) => { const [k, f] = x.split('='); return {key: readJson(path.resolve(k)), text: fs.readFileSync(path.resolve(f), 'utf8')}; });
      const res = combine({rounds, runsRows: readJson(path.resolve(opt('--runs-json')))});
      writeJson(path.resolve(opt('--out')), res);
      console.log(JSON.stringify({gate: res.gate, judgeableCases: res.judgeableCases, perCase: res.perCase}));
    } else { console.error('usage: gate-packet.mjs pack|combine ...'); process.exit(2); }
  } catch (e) { console.error(e.message); process.exit(2); }
}
