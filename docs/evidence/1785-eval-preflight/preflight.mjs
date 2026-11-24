// 既存の採点器・収集経路へ合成出力を与え、モデルを呼ばずに区別・採点・集計の不備を調べる（#1785）。
// 使い方: node preflight.mjs <repository root（読取りだけ）> <作業directory（空、書込み可）>
// 既存資産は変更しない。採点器の変異（M+／M−）は作業directoryの写しにだけ作る。外部へ送信しない。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [repo, work] = process.argv.slice(2).map((p) => path.resolve(p));
const here = path.dirname(new URL(import.meta.url).pathname);
const ev = (...p) => path.join(repo, 'docs/evidence', ...p);
const started = Date.now();
const node = (args, opts = {}) => {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 60000, ...opts });
  return { exit: r.status, signal: r.signal, out: r.stdout ?? '', err: (r.stderr ?? '').split('\n').find((l) => /Error/.test(l)) ?? '' };
};
const dir = (name) => {
  const d = path.join(work, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const report = { s67: {}, s74: {}, mutants: {}, r68: {}, hs: {}, aggregation: {} };

// ---- S67（#1767 score.mjs）：runs.jsonの値は [[tokens, tools, ms], "FILES"] ----
const cases67 = JSON.parse(fs.readFileSync(ev('1767-context-read-selection/cases.json'), 'utf8'));
const k1 = cases67.cases.find((c) => c.id === 'K1');
const perfect67 = [...k1.required, ...k1.optional].join(', ');
const m = [50000, 8, 30000];
const variants67 = {
  correct: JSON.stringify({ A_K1_1: [m, perfect67] }),
  wrong: JSON.stringify({ A_K1_1: [m, 'README.md, package.json'] }),
  partial: JSON.stringify({ A_K1_1: [m, k1.required[0]] }),
  empty: JSON.stringify({ A_K1_1: [m, ''] }),
  timeout: JSON.stringify({ A_K1_1: [m, null] }),
  broken: JSON.stringify({ A_K1_1: [m, perfect67] }).slice(0, 30),
  duplicate: `{"A_K1_1": [${JSON.stringify(m)}, ${JSON.stringify(perfect67)}], "A_K1_1": [${JSON.stringify(m)}, "README.md"]}`,
  missing: JSON.stringify({ A_K1_1: [m, perfect67], A_K1_3: [m, perfect67] }), // 3回のうちrep2が欠落
};
const score67 = (scorer, runsText) => {
  const d = dir(`s67-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(path.join(d, 'runs.json'), runsText);
  const r = node([scorer, ev('1767-context-read-selection/cases.json'), path.join(d, 'runs.json')]);
  const line = r.out.split('\n').find((l) => l.startsWith('A_K1_'));
  const summary = r.out.split('\n').find((l) => l.startsWith('A runs'));
  return { exit: r.exit, err: r.err, row: line ?? null, runs: summary ? Number(/runs (\d+)/.exec(summary)[1]) : null, recall: line ? Number(/recall ([\d.]+)/.exec(line)[1]) : null };
};
const orig67 = ev('1767-context-read-selection/score.mjs');
for (const [k, v] of Object.entries(variants67)) report.s67[k] = score67(orig67, v);

// ---- S74（#1774 score.mjs）：fileを相対で読むので写しを作る ----
const gold74 = JSON.parse(fs.readFileSync(ev('1774-security-audit-eval/gold.json'), 'utf8'));
const perfect74 = Object.fromEntries(gold74.items.map((i) => [i.id, i.kind === 'true' ? (i.accept.includes('confirmed') ? 'c' : 'nv') : i.kind === 'needs_validation' ? 'nv' : 'r']));
const wrong74 = Object.fromEntries(gold74.items.map((i) => [i.id, i.kind === 'true' ? 'r' : 'c']));
const partial74 = Object.fromEntries(Object.entries(perfect74).slice(0, 3));
const run74 = (v, n = 1) => ({ case: 'small', cond: 'A', run: n, agent: `x${n}`, tokens: 50000, ms: 60000, v, extras: [], notes: [] });
const variants74 = {
  correct: JSON.stringify({ runs: [run74(perfect74)] }),
  wrong: JSON.stringify({ runs: [run74(wrong74)] }),
  partial: JSON.stringify({ runs: [run74(partial74)] }),
  empty: JSON.stringify({ runs: [run74({})] }),
  timeout: JSON.stringify({ runs: [run74(null)] }),
  broken: JSON.stringify({ runs: [run74(perfect74)] }).slice(0, 40),
  duplicate: JSON.stringify({ runs: [run74(perfect74, 1), run74(perfect74, 1), run74(perfect74, 2), run74(perfect74, 3)] }),
  missing: JSON.stringify({ runs: [run74(perfect74, 1), run74(perfect74, 3)] }),
};
const score74 = (source, runsText) => {
  const d = dir(`s74-${Math.random().toString(36).slice(2)}`);
  for (const f of ['gold.json', 'gold-scale.json']) fs.copyFileSync(ev('1774-security-audit-eval', f), path.join(d, f));
  fs.writeFileSync(path.join(d, 'score.mjs'), source);
  fs.writeFileSync(path.join(d, 'runs.json'), runsText);
  const r = node([path.join(d, 'score.mjs')]);
  const rows = r.out.split('\n').filter((l) => l.startsWith('small\tA\t'));
  const mean = r.out.split('\n').find((l) => l.startsWith('small\tA\tn='));
  const first = rows[0]?.split('\t');
  return { exit: r.exit, err: r.err, rows: rows.length, n: mean ? Number(/n=(\d+)/.exec(mean)[1]) : null, detected: first?.[3] ?? null, critMiss: first ? Number(first[4]) : null, nvOK: first?.[5] ?? null, fp: first?.[7] ?? null };
};
const src74 = fs.readFileSync(ev('1774-security-audit-eval/score.mjs'), 'utf8');
for (const [k, v] of Object.entries(variants74)) report.s74[k] = score74(src74, v);

// ---- 採点器の反例：goldから作る較正用回答（完全・空、および全て誤り）で、M+／M−を検出できるか ----
const mutate = (src, from, to) => {
  if (!src.includes(from)) throw Error(`mutation anchor missing: ${from}`);
  return src.replace(from, to);
};
const src67 = fs.readFileSync(orig67, 'utf8');
const mut67 = {
  original: src67,
  // M+：空文字列がどのpathにも部分一致する（空の回答が満点になる）
  'M+ substring': mutate(src67, 'const missed = req.filter((x) => !got.has(x)).sort();', 'const missed = req.filter((x) => ![...got].some((g) => x.includes(g))).sort();'),
  // M−：区切りの空白を除かない（", "区切りの正解の2件目以降が一致しない）
  'M- no-trim': mutate(src67, "files.split(',').map((x) => x.trim())", "files.split(',')"),
  // M+（空でない回答）：FILES行が空でなければ欠落なしとする（空の回答では発火しない）
  'M+ nonempty': mutate(src67, 'const missed = req.filter((x) => !got.has(x)).sort();', "const missed = files.trim() ? [] : req.filter((x) => !got.has(x)).sort();"),
};
const calibrate67 = (src) => {
  const d = dir(`m67-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(path.join(d, 'score.mjs'), src);
  const p = score67(path.join(d, 'score.mjs'), variants67.correct);
  const e = score67(path.join(d, 'score.mjs'), variants67.empty);
  const w = score67(path.join(d, 'score.mjs'), variants67.wrong);
  // 2点の較正（完全・空）と、全て誤りの回答を加えた3点の較正を別々に判定する
  return { perfectRecall: p.recall, emptyRecall: e.recall, wrongRecall: w.recall, defect2: !(p.recall === 1 && e.recall === 0), defect3: !(p.recall === 1 && e.recall === 0 && w.recall === 0) };
};
for (const [k, s] of Object.entries(mut67)) report.mutants[`s67 ${k}`] = calibrate67(s);
const mut74 = {
  original: src74,
  // M+：判定が無い項目をconfirmedとみなす
  'M+ default-confirmed': mutate(src74, 'if (reported && item.accept.includes(full[v])) s.detected++;', "if (item.accept.includes(full[v] ?? 'confirmed')) s.detected++;"),
  // M−：判定名の写し間違い（confirmedが一致しない）
  'M- label-typo': mutate(src74, "const full = { c: 'confirmed',", "const full = { c: 'confirm',"),
  // M+（空でない回答）：何らかの判定があれば検出とする（rejectedも数える）
  'M+ any-verdict': mutate(src74, 'if (reported && item.accept.includes(full[v])) s.detected++;', 'if (v) s.detected++;'),
};
const calibrate74 = (src) => {
  const p = score74(src, variants74.correct);
  const e = score74(src, variants74.empty);
  const trueTotal = gold74.items.filter((i) => i.kind === 'true').length;
  const w = score74(src, variants74.wrong);
  const ok2 = p.detected === `${trueTotal}/${trueTotal}` && e.detected === `0/${trueTotal}`;
  return { perfectDetected: p.detected, emptyDetected: e.detected, wrongDetected: w.detected, defect2: !ok2, defect3: !(ok2 && w.detected === `0/${trueTotal}`) };
};
for (const [k, s] of Object.entries(mut74)) report.mutants[`s74 ${k}`] = calibrate74(s);

// ---- R68（#1768 run.mjs）：PATH上の`claude`を代役に差し替えて、モデルを呼ばずに実行する ----
const bin = dir('bin');
fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(here, 'fake-claude.mjs')}" "$@"\n`, { mode: 0o755 });
const home = dir('home');
const r68 = (mode, outName) => {
  const out = path.join(work, outName);
  fs.mkdirSync(out, { recursive: true });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, FAKE_MODE: mode };
  const r = node([ev('1768-delegation-total-cost/harness/run.mjs'), out, 'T1', 'A', '1', 'fake-model'], { env });
  const file = path.join(out, 'T1-A-1.json');
  if (!fs.existsSync(file)) return { harnessExit: r.exit, err: r.err, record: null };
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const parentOut = Object.values(j.split.parent).reduce((a, b) => a + b.output, 0);
  return { harnessExit: r.exit, pass: j.pass, detail: j.detail, exit: j.exit, isError: j.isError, costUsd: j.costUsd, parentOutputTokens: parentOut };
};
for (const mode of ['correct', 'wrong', 'partial', 'empty', 'broken', 'timeout', 'ratelimit', 'missing']) report.r68[mode] = r68(mode, `r68-${mode}`);
// 重複：同じ出力先で2回実行する（前回のsession記録が残る。READMEが注意している経路）
r68('correct', 'r68-duplicate');
report.r68.duplicate = r68('correct', 'r68-duplicate');

// ---- 集計の反例：streamingで同じmessageが2回記録された場合の、最後の値と最初の値 ----
{
  const key = fs.realpathSync(path.join(work, 'r68-correct', 'T1-A-1')).replace(/[^A-Za-z0-9]/g, '-');
  const logDir = path.join(home, '.claude/projects', key);
  const lines = fs.readdirSync(logDir).flatMap((f) => fs.readFileSync(path.join(logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  const firstWins = new Map();
  for (const o of lines) if (!firstWins.has(`${o.message.id}:${o.requestId}`)) firstWins.set(`${o.message.id}:${o.requestId}`, o.message.usage.output_tokens);
  report.aggregation = {
    recordedLines: lines.length,
    lastValue: lines.at(-1).message.usage.output_tokens,
    r68LastWins: report.r68.correct.parentOutputTokens,
    firstWinsMutant: [...firstWins.values()].reduce((a, b) => a + b, 0),
    sumAllLinesMutant: lines.reduce((a, o) => a + o.message.usage.output_tokens, 0),
  };
}

// ---- HS（host-session）：--executableで代役を使い、非Gitのdirectoryを対象にする ----
const hsTarget = dir('hs-target');
const prompt = path.join(work, 'hs-prompt.txt');
fs.writeFileSync(prompt, 'synthetic preflight prompt\n');
const fakeExe = path.join(bin, 'fake-claude');
fs.copyFileSync(path.join(bin, 'claude'), fakeExe);
fs.chmodSync(fakeExe, 0o755);
const hs = (mode) => {
  const out = path.join(work, `hs-out-${mode}`);
  const env = { ...process.env, HOME: home, FAKE_MODE: mode, FAKE_TIMEOUT_SLEEP: mode === 'timeout' ? '5000' : '' };
  const r = node([path.join(repo, 'bin/asc-v05.mjs'), 'host-session', 'claude', hsTarget, '--name', `preflight ${mode}`, '--model', 'fake', '--prompt-file', prompt, '--output-dir', out, '--executable', fakeExe, '--ephemeral', '--timeout-ms', '1500'], { env });
  const status = fs.existsSync(path.join(out, 'status.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'status.json'), 'utf8')) : null;
  return { cliExit: r.exit, status: status?.status ?? null, error: status?.error ?? null, resultSaved: fs.existsSync(path.join(out, 'result.txt')) && fs.readFileSync(path.join(out, 'result.txt'), 'utf8').trim().length > 0 };
};
for (const mode of ['correct', 'wrong', 'partial', 'empty', 'broken', 'timeout', 'ratelimit', 'stale', 'missing']) report.hs[mode] = hs(mode);

// ---- goldの前提の検査（#1774の規模ケース）：goldの真の欠陥に、到達に必要なデータの作成経路があるか ----
// 生成scriptはfileを書くだけで実行しない。判定はこのfixtureに固有の静的規則（POST routeかseedの有無）。
report.goldPrecondition = {};
const goldScale = JSON.parse(fs.readFileSync(ev('1774-security-audit-eval/gold-scale.json'), 'utf8'));
for (const variant of ['seedless', 'seeded']) {
  const d = dir(`fixture-scale-${variant}`);
  const r = node([ev('1774-security-audit-eval/make-fixture-scale.mjs'), d, ...(variant === 'seeded' ? ['--seed'] : [])]);
  const seed = fs.existsSync(path.join(d, 'src/seed.mjs'));
  report.goldPrecondition[variant] = { generatorExit: r.exit };
  for (const item of goldScale.items.filter((i) => i.kind === 'true')) {
    const src = fs.readFileSync(path.join(d, item.file), 'utf8');
    report.goldPrecondition[variant][item.id] = { postRoute: src.includes("['POST'"), seed, reachable: src.includes("['POST'") || seed };
  }
}

// 代役の起動回数（modeごと）。収集経路が失敗後に自動で再試行していないかを見る
report.invocations = {};
for (const l of fs.readFileSync(path.join(home, 'invocations.log'), 'utf8').split('\n').filter(Boolean)) report.invocations[l] = (report.invocations[l] ?? 0) + 1;

report.elapsedMs = Date.now() - started;
process.stdout.write(JSON.stringify(report, null, 1) + '\n');
