const AFFIRMATIVE = ['correctness', 'value', 'feasibility', 'consistency', 'maintainability'];
const ADVERSARIAL = ['counterexamples', 'failures', 'boundaries', 'abuse', 'security', 'dataLoss', 'rollback', 'scope'];
const VALUES = new Set(['pass', 'finding', 'not-applicable']);
const DISPOSITIONS = new Set(['valid', 'resolved', 'duplicate', 'false-positive', 'out-of-scope']);
const SEVERITIES = new Set(['Critical', 'High', 'Medium', 'Low']);

/** @param {any} acceptance */
function validRiskAcceptance(acceptance) {
  return acceptance?.authority === 'human'
    && typeof acceptance.owner === 'string' && acceptance.owner.trim() !== ''
    && typeof acceptance.reason === 'string' && acceptance.reason.trim().length >= 12
    && typeof acceptance.reviewCondition === 'string' && acceptance.reviewCondition.trim() !== '';
}

/** @param {unknown} value */
function stringArray(value) { return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim() !== ''); }

/** @param {any} review */
export function evaluateReview(review) {
  if (!Number.isInteger(review.round) || review.round < 1 || review.round > 3) throw new Error('レビューのラウンドは1〜3で指定してください');
  const errors = [];
  /** @type {Array<['affirmative'|'adversarial', string[]]>} */
  const perspectives = [['affirmative', AFFIRMATIVE], ['adversarial', ADVERSARIAL]];
  for (const [perspective, fields] of perspectives) {
    for (const field of fields) {
      const value = review[perspective]?.[field];
      if (!VALUES.has(value)) errors.push(`${perspective}.${field}の評価が未完了です`);
      if (value === 'not-applicable' && (typeof review.rationales?.[perspective]?.[field] !== 'string' || review.rationales[perspective][field].trim() === '')) {
        errors.push(`${perspective}.${field}のnot-applicable理由がありません`);
      }
    }
  }
  if (review.round >= 2) {
    if (!review.focus || !stringArray(review.focus.unresolvedBlocking) || !stringArray(review.focus.fixedDiff) || !Array.isArray(review.focus.adjacentScope)) {
      errors.push(`ラウンド${review.round}には未解決指摘・修正差分・隣接範囲の限定が必要です`);
    }
    if (review.focus?.fullRescan !== false) errors.push(`ラウンド${review.round}で既承認範囲の全再走査はできません`);
  }
  if (!/^[a-f0-9]{40}$/i.test(review.headSha ?? '')) errors.push('headShaが不正です');
  if (review.tests !== 'pass') errors.push('テスト合格が必要です');
  if (review.specConsistency !== 'pass') errors.push('仕様整合性の合格が必要です');
  const findings = Array.isArray(review.findings) ? review.findings : [];
  const blocking = [];
  const acceptedRisks = [];
  for (const finding of findings) {
    if (!finding.id || !finding.severity || !finding.status || !finding.evidence) errors.push('指摘の必須項目が不足しています');
    if (!SEVERITIES.has(finding.severity)) errors.push(`${finding.id ?? '指摘'}の重大度が不正です`);
    if (!DISPOSITIONS.has(finding.status)) errors.push(`${finding.id ?? '指摘'}の分類が不正です`);
    if (['Critical', 'High'].includes(finding.severity) && finding.status === 'valid') {
      if (validRiskAcceptance(finding.riskAcceptance)) acceptedRisks.push(finding.id);
      else blocking.push(finding.id);
    }
  }
  return { approved: errors.length === 0 && blocking.length === 0, blocking, acceptedRisks, errors };
}

export const reviewRubrics = { affirmative: AFFIRMATIVE, adversarial: ADVERSARIAL };
