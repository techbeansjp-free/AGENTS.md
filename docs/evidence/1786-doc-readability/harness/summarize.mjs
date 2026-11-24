// score.mjs の出力（scores.json）を条件・反復ごとに集計し、EVAL_PLAN の採否基準を機械的に当てはめる（#1786）。
// 使い方: node summarize.mjs <scores.json> [scores-a0.json]
// A0 の記録が含まれていれば supplementA0 に別に集計する（採否基準には使わない）。
import fs from 'node:fs';

const rows = process.argv.slice(2).flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : NaN);
const range = (xs) => `${Math.min(...xs).toFixed(3)}〜${Math.max(...xs).toFixed(3)}`;
const out = { review: {}, reader: {}, perCase: {}, decision: {} };

const rev = rows.filter((r) => r.case.startsWith('R'));
for (const cond of ['A', 'B', 'C']) {
  const rs = rev.filter((r) => r.cond === cond);
  const perRep = [1, 2, 3].map((rep) => {
    const x = rs.filter((r) => r.rep === rep && r.score.valid);
    return { rep, n: x.length, det: sum(x.map((r) => r.score.detected.length)), tot: sum(x.map((r) => r.score.defects)) };
  });
  const v = rs.filter((r) => r.score.valid);
  const r5 = v.filter((r) => r.case === 'R5');
  out.review[cond] = {
    runs: rs.length,
    valid: v.length,
    recallPerRep: perRep.map((p) => (p.tot ? p.det / p.tot : NaN)),
    detectedPerRep: perRep.map((p) => `${p.det}/${p.tot}`),
    harmful: sum(v.map((r) => r.score.harmful.length)),
    cleanFlagged: sum(v.map((r) => r.score.cleanFlagged)),
    misquoted: sum(v.map((r) => r.score.misquoted)),
    unmatched: sum(v.map((r) => r.score.unmatched)),
    findingsMean: mean(v.map((r) => r.score.findings)),
    r5Retained: r5.map((r) => `${r.score.revised?.retained}/${r.score.revised?.total}`),
    r5RevisedChars: r5.map((r) => r.score.revised?.chars),
    costMean: mean(rs.map((r) => r.metrics.costUsd ?? 0)),
    costSum: sum(rs.map((r) => r.metrics.costUsd ?? 0)),
    outputMean: mean(rs.map((r) => r.metrics.usage?.output ?? 0)),
    cacheReadMean: mean(rs.map((r) => r.metrics.usage?.cacheRead ?? 0)),
    cacheWriteMean: mean(rs.map((r) => r.metrics.usage?.cacheWrite ?? 0)),
    inputMean: mean(rs.map((r) => r.metrics.usage?.input ?? 0)),
    wallMeanS: mean(rs.map((r) => r.metrics.wallMs / 1000)),
    wallRangeS: range(rs.map((r) => r.metrics.wallMs / 1000)),
    turns: [...new Set(rs.map((r) => r.metrics.numTurns))],
  };
  for (const c of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']) {
    const x = v.filter((r) => r.case === c);
    out.perCase[`${c}-${cond}`] = {
      detected: x.map((r) => r.score.detected.length),
      of: x[0]?.score.defects,
      missedCounts: Object.entries(
        x.flatMap((r) => r.score.missed).reduce((m, id) => ({ ...m, [id]: (m[id] ?? 0) + 1 }), {}),
      ).map(([id, n]) => `${id}×${n}`),
      harmful: x.flatMap((r) => r.score.harmful),
    };
  }
}
const rd = rows.filter((r) => r.case.startsWith('P'));
for (const cond of ['A', 'C']) {
  const rs = rd.filter((r) => r.cond === cond);
  const v = rs.filter((r) => r.score.valid);
  const perRep = [1, 2, 3].map((rep) => v.filter((r) => r.rep === rep));
  out.reader[cond] = {
    runs: rs.length,
    valid: v.length,
    correctPerRep: perRep.map((x) => `${sum(x.map((r) => r.score.correct))}/${sum(x.map((r) => r.score.questions))}`),
    ambPerRep: perRep.map((x) => `${sum(x.map((r) => r.score.ambDetected.length))}/${sum(x.map((r) => r.score.ambiguityGold))}`),
    misread: sum(v.map((r) => r.score.misread)),
    overUnknown: sum(v.map((r) => r.score.overUnknown)),
    unknownOk: `${sum(v.map((r) => r.score.unknownOk))}/${sum(v.map((r) => r.score.unknownQ))}`,
    wrongDirection: sum(v.map((r) => r.score.wrongDirection)),
    missing: sum(v.map((r) => r.score.missing)),
    ambReportedMean: mean(v.map((r) => r.score.ambiguitiesReported)),
    p1AmbReported: v.filter((r) => r.case === 'P1').map((r) => r.score.ambiguitiesReported),
    perQ: Object.fromEntries(['P1', 'P2', 'P3'].map((c) => [c, v.filter((r) => r.case === c).map((r) => Object.values(r.score.perQ).join(''))])),
    costMean: mean(rs.map((r) => r.metrics.costUsd ?? 0)),
    costSum: sum(rs.map((r) => r.metrics.costUsd ?? 0)),
    outputMean: mean(rs.map((r) => r.metrics.usage?.output ?? 0)),
    wallMeanS: mean(rs.map((r) => r.metrics.wallMs / 1000)),
  };
}
// 採否基準（EVAL_PLAN）を機械的に当てはめる
const A = out.review.A;
for (const k of ['B', 'C']) {
  const K = out.review[k];
  const improve = Math.min(...K.recallPerRep) > Math.max(...A.recallPerRep);
  const retained = (x) => sum(x.r5Retained.map((v) => Number(v.split('/')[0])));
  const safe = K.harmful + K.cleanFlagged + K.misquoted <= A.harmful + A.cleanFlagged + A.misquoted && retained(K) >= retained(A);
  const dRecall = mean(K.recallPerRep) - mean(A.recallPerRep);
  const costOk = K.costMean <= 1.5 * A.costMean || dRecall >= 0.15;
  out.decision[`review-${k}`] = { improve, safe, costOk, dRecall: Number(dRecall.toFixed(3)), costRatio: Number((K.costMean / A.costMean).toFixed(2)) };
}
const pc = (s) => s.map((x) => Number(x.split('/')[0]));
const RA = out.reader.A;
const RC = out.reader.C;
out.decision['reader-C'] = {
  improveCorrect: Math.min(...pc(RC.correctPerRep)) > Math.max(...pc(RA.correctPerRep)),
  improveAmb: Math.min(...pc(RC.ambPerRep)) > Math.max(...pc(RA.ambPerRep)),
  safe: RC.misread + RC.wrongDirection <= RA.misread + RA.wrongDirection,
  costRatio: Number((RC.costMean / RA.costMean).toFixed(2)),
};
out.decision.aRecallMean = Number(mean(A.recallPerRep).toFixed(3));
// 基準4の判定（EVAL_PLAN）
const aSafe = A.harmful === 0;
const verdict = (d) => (!d.safe || !d.costOk ? '不採用' : d.improve ? '既存Skillの限定改善候補' : '採用しない（改善なし）');
out.decision.candidates = { 'review-B': verdict(out.decision['review-B']), 'review-C': verdict(out.decision['review-C']), 'reader-C': out.decision['reader-C'].safe ? (out.decision['reader-C'].improveCorrect || out.decision['reader-C'].improveAmb ? '既存Skillの限定改善候補' : '採用しない（改善なし）') : '不採用' };
const anyImprove = Object.values(out.decision.candidates).includes('既存Skillの限定改善候補');
out.decision.overall = anyImprove ? '既存Skillの限定改善候補' : out.decision.aRecallMean >= 0.8 && aSafe ? '現行方式で十分' : '追加評価が必要';
// 補足：A0（照合の段落なし、結果を見た後に追加）。採否基準の対象外
const a0 = rows.filter((r) => r.cond === 'A0');
if (a0.length) {
  const v = a0.filter((r) => r.score.valid);
  out.supplementA0 = {
    runs: a0.length,
    valid: v.length,
    perCase: Object.fromEntries(['R2', 'R3', 'R4', 'R5'].map((c) => [c, v.filter((r) => r.case === c).map((r) => `${r.score.detected.length}/${r.score.defects}`)])),
    missed: v.flatMap((r) => r.score.missed),
    harmful: sum(v.map((r) => r.score.harmful.length)),
    cleanFlagged: sum(v.map((r) => r.score.cleanFlagged)),
    misquoted: sum(v.map((r) => r.score.misquoted)),
    r5Retained: v.filter((r) => r.case === 'R5').map((r) => `${r.score.revised?.retained}/${r.score.revised?.total}`),
    costMean: mean(a0.map((r) => r.metrics.costUsd ?? 0)),
    costSum: sum(a0.map((r) => r.metrics.costUsd ?? 0)),
    aSameCasesCostMean: mean(rev.filter((r) => r.cond === 'A' && ['R2', 'R3', 'R4', 'R5'].includes(r.case)).map((r) => r.metrics.costUsd ?? 0)),
    wallMeanS: mean(a0.map((r) => r.metrics.wallMs / 1000)),
  };
}
console.log(JSON.stringify(out, null, 1));
