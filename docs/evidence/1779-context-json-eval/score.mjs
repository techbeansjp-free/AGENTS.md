// runs.jsonを固定gold（cases.json）で採点し、#1779の採否規則を機械的に適用する読取りだけのscript。
// 使い方: node score.mjs cases.json runs.json
// 採点規則（測定前に固定）:
// - 「挙げた」は回答のFILES行。「開いた」はtool記録のRead。recallはrequiredの規則fileだけで数える。
// - 欠落は「ケース×回×必須規則file」で数える。requiredが空のケースはrecallの対象外。
// - 不要な規則fileは、rulePrefix配下でrequired・optional・repositoryWideOptionalのいずれでもないfile。
// - keyに`.failed`を含む試行は、失敗として件数と費用にだけ計上し、recallには使わない。
// - 採用: A+Cの欠落0（critical欠落0を含む）、かつAの欠落1件以上、かつA+Cの欠落がAより少ない。
// - 区別できる差: 回ごとの値の範囲（最小〜最大）が条件間で重ならない。
import fs from 'node:fs';

const [casesPath, runsPath] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
const cases = new Map(spec.cases.map((c) => [c.id, c]));
const runs = JSON.parse(fs.readFileSync(runsPath, 'utf8'));
const isRule = (p) => p.startsWith(spec.rulePrefix);
const rows = [], failed = [];
for (const [key, r] of Object.entries(runs).sort()) {
  const [cond, cid, rep] = key.split('.')[0].split('_');
  if (key.includes('.failed') || r.status !== 'ok') { failed.push({ key, cond, r }); continue; }
  const c = cases.get(cid);
  const allowed = new Set([...c.required, ...c.optional, ...spec.repositoryWideOptional]);
  const listed = new Set(r.files), opened = new Set(r.reads);
  const missed = c.required.filter((x) => !listed.has(x));
  rows.push({
    key, cond, cid, rep, required: c.required.length, missed,
    critMissed: c.critical.filter((x) => !listed.has(x)),
    notOpened: c.required.filter((x) => !opened.has(x)),
    extraListed: [...listed].filter((x) => isRule(x) && !allowed.has(x)),
    extraOpened: [...opened].filter((x) => isRule(x) && !allowed.has(x)),
    rulesListed: [...listed].filter(isRule).length, rulesOpened: [...opened].filter(isRule).length,
    tok: r.usage.input + r.usage.output + r.usage.cacheRead + r.usage.cacheCreation, out: r.usage.output,
    cost: r.usage.costUSD, tu: r.toolUses, wall: r.wallMs, outside: r.outsideToolInputs,
  });
}
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : NaN);
for (const x of rows)
  console.log(x.key, 'missed', JSON.stringify(x.missed.map((p) => p.slice(spec.rulePrefix.length))), 'notOpened', x.notOpened.length,
    'extraListed', x.extraListed.length, 'extraOpened', x.extraOpened.length, 'tok', x.tok, 'tu', x.tu, 's', Math.round(x.wall / 1000), 'outside', x.outside);
const stats = (rs) => ({
  runs: rs.length, recallRuns: rs.filter((x) => x.required).length,
  misses: sum(rs.map((x) => x.missed.length)), requiredSlots: sum(rs.map((x) => x.required)),
  critMisses: sum(rs.map((x) => x.critMissed.length)), notOpened: sum(rs.map((x) => x.notOpened.length)),
  extraListed: sum(rs.map((x) => x.extraListed.length)), extraOpened: sum(rs.map((x) => x.extraOpened.length)),
  meanRulesOpened: +mean(rs.map((x) => x.rulesOpened)).toFixed(2),
  meanTok: Math.round(mean(rs.map((x) => x.tok))), meanOut: Math.round(mean(rs.map((x) => x.out))),
  meanCost: +mean(rs.map((x) => x.cost)).toFixed(4), meanTu: +mean(rs.map((x) => x.tu)).toFixed(2),
  meanWallS: +(mean(rs.map((x) => x.wall)) / 1000).toFixed(1), outside: sum(rs.map((x) => x.outside)),
});
const result = { conditions: {}, perRep: {}, failed: failed.map(({ key, cond, r }) => ({ key, cond, exit: r.exit, signal: r.signal, cost: r.usage?.costUSD ?? null, tok: r.usage ? r.usage.input + r.usage.output + r.usage.cacheRead + r.usage.cacheCreation : null })) };
for (const cond of ['A', 'AC']) {
  const rs = rows.filter((x) => x.cond === cond);
  result.conditions[cond] = stats(rs);
  result.perRep[cond] = Object.fromEntries([...new Set(rs.map((x) => x.rep))].sort().map((rep) => [rep, stats(rs.filter((x) => x.rep === rep))]));
}
const range = (cond, f) => { const v = Object.values(result.perRep[cond]).map(f); return [Math.min(...v), Math.max(...v)]; };
const distinct = (f) => { const [a, b] = [range('A', f), range('AC', f)]; return { A: a, AC: b, distinguishable: a[1] < b[0] || b[1] < a[0] }; };
result.differences = {
  misses: distinct((s) => s.misses), extraOpened: distinct((s) => s.extraOpened),
  meanTok: distinct((s) => s.meanTok), meanTu: distinct((s) => s.meanTu), meanWallS: distinct((s) => s.meanWallS),
};
const A = result.conditions.A, AC = result.conditions.AC;
result.verdict = {
  acFullRecall: AC.misses === 0 && AC.critMisses === 0,
  aHasMiss: A.misses >= 1, acFewerThanA: AC.misses < A.misses,
};
result.verdict.adopt = result.verdict.acFullRecall && result.verdict.aHasMiss && result.verdict.acFewerThanA;
console.log(JSON.stringify(result, null, 1));
