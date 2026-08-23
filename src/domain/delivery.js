import { compareTrustedPolicy, enforceTrustedBoundary, resolveEffectivePolicy } from './enforcement.js';

/** @param {string} pattern @param {string} value */
function branchMatches(pattern, value) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

/** @param {unknown} value @param {string} name */
function requireStringArray(value, name) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.trim() === '' || /[\u0000-\u001f\u007f]/.test(item))) {
    throw new Error(`${name}には空でない安全な文字列配列が必要です`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${name}に重複があります`);
  return value;
}

/** @param {any} evidence @param {string} headSha */
function validateDeliveryEvidence(evidence, headSha) {
  if (!/^[a-f0-9]{40}$/i.test(headSha)) throw new Error('PR対象HEAD SHAは40桁のGit SHAで指定してください');
  if (!evidence || evidence.headSha !== headSha) throw new Error('PR証拠のHEAD SHAが対象HEADと一致しません');
  if (!evidence.review?.approved || evidence.review.headSha !== headSha) throw new Error('同じHEAD SHAに対するレビュー合格が必要です');
  if (!evidence.tests?.passed || evidence.tests.headSha !== headSha) throw new Error('同じHEAD SHAに対するテスト合格が必要です');
  const scenarioIds = requireStringArray(evidence.tests.scenarioIds, 'テスト証拠のSCN ID');
  if (scenarioIds.some((id) => !/^SCN-[A-Z0-9-]+$/.test(id))) throw new Error('テスト証拠に不正なSCN IDがあります');
  if (!evidence.spec?.consistent || evidence.spec.headSha !== headSha) throw new Error('同じHEAD SHAに対する仕様整合性の合格が必要です');
  if (evidence.spec.impact === 'updated') {
    const requirements = requireStringArray(evidence.spec.trace?.requirements, '仕様証拠の要件追跡');
    const scenarios = requireStringArray(evidence.spec.trace?.scenarios, '仕様証拠のシナリオ追跡');
    requireStringArray(evidence.spec.trace?.tests, '仕様証拠のテスト追跡');
    if (requirements.some((id) => !/^[A-Z][A-Z0-9-]*-\d+$/.test(id))) throw new Error('仕様証拠に不正な要件IDがあります');
    if (scenarios.some((id) => !scenarioIds.includes(id)) || scenarioIds.some((id) => !scenarios.includes(id))) throw new Error('仕様とテストのSCN IDが一致しません');
  } else if (evidence.spec.impact === 'no-spec-impact') {
    if (typeof evidence.spec.rationale !== 'string' || evidence.spec.rationale.trim().length < 12) throw new Error('no-spec-impactには対象範囲を限定した根拠が必要です');
  } else {
    throw new Error('仕様影響はupdatedまたはno-spec-impactで指定してください');
  }
}

/** @param {{apply: boolean, authorization?: string, evidence: any, headSha: string, issue: number, head: string, base: string, repository: string, trustedPolicy?: any, candidatePolicy?: any}} input @param {(operation: string, input: any) => any} external */
export function createPullRequest(input, external) {
  const [owner, repositoryName, extra] = input.repository.split('/');
  if (extra || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner ?? '') || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repositoryName ?? '') || repositoryName === '.' || repositoryName === '..') throw new Error('リポジトリは正確なowner/name形式で指定してください');
  if (!/^\d+$/.test(String(input.issue)) || !input.head || !input.base) throw new Error('Issue番号、先頭ブランチ、基点ブランチが必要です');
  if (input.head.startsWith('-') || input.base.startsWith('-') || input.head.includes('..') || input.base.includes('..')) throw new Error('先頭・基点ブランチ名が安全ではありません');
  validateDeliveryEvidence(input.evidence, input.headSha);
  if (input.trustedPolicy) {
    const effective = resolveEffectivePolicy(input.trustedPolicy, input.candidatePolicy);
    const comparison = effective.valid ? compareTrustedPolicy(input.trustedPolicy, effective.policy) : { allowed: false, rejected: [effective.diagnostic] };
    const ownership = input.evidence?.ownership;
    const observations = (input.trustedPolicy.rules ?? []).filter((/** @type {any} */ rule) => rule.scope?.includes('pull_request')).map((/** @type {any} */ rule) => rule.riskClass === 'authority' ? {
      ruleId: rule.ruleId, violated: !effective.valid || !comparison.allowed,
      reasons: effective.valid ? comparison.rejected.flatMap((/** @type {any} */ item) => item?.reasons ?? []) : effective.diagnostic?.reasons ?? ['candidate policyを安全floorへ合成できません'],
      checks: ['trusted policyと固定candidate policyの自己緩和を比較した'],
    } : rule.riskClass === 'quality' ? {
      ruleId: rule.ruleId, violated: ownership?.classified !== true || typeof ownership?.owner !== 'string' || typeof ownership?.targetLayer !== 'string',
      reasons: ['PR evidenceにasset分類、owner、targetLayerの実測結果が必要です'], checks: ['HEAD SHAに拘束されたPR evidenceのownership分類を確認した'],
    } : undefined).filter(Boolean);
    const enforcement = enforceTrustedBoundary({ policy: input.trustedPolicy, boundary: 'pull_request', observations });
    if (!enforcement.allowed) throw new Error(`${enforcement.diagnostic.ruleId}: ${enforcement.diagnostic.reasons.join('; ')}`);
  }
  const preview = { operation: 'pr.create', authorityStatus: 'unverified-preview', repository: input.repository, issue: input.issue, head: input.head, headSha: input.headSha, base: input.base, bodyLink: `Relates to #${input.issue}` };
  if (!input.apply) return { state: 'preview', preview };
  if (!input.trustedPolicy) throw new Error('外部PR作成には既定ブランチから取得したtrusted policyが必要です');
  if (input.authorization !== 'approved') throw new Error('外部書き込みには明示的な承認が必要です');
  const result = external('pr.create', preview);
  return { state: 'waiting_for_human_review', url: result.url, next: '独立したpr mergeコマンドを使う。暗黙のマージ・完了処理・後片付けは行わない' };
}

/** @param {{trustedPolicy: any, candidatePolicy?: any, method: string, checks?: string[], approvals?: Array<{state: string, commitSha: string, actorId: string, submittedAt: string, reviewId: string}>, headSha?: string, prAuthorActorId?: string, implementationAuthorActorId?: string, branch: string, repositoryVerified?: boolean, shaVerified?: boolean, protectionVerified?: boolean, mergeableVerified?: boolean}} input */
export function authorizeMerge(input) {
  const policy = input.trustedPolicy?.merge;
  /** @param {string} reason */
  const deny = (reason) => ({ allowed: false, reason, operations: [] });
  if (!policy || !['disabled', 'assisted', 'automatic'].includes(policy.mode)) return deny('信頼済みポリシーがないか不正です');
  if (policy.mode === 'disabled') return deny('信頼済みポリシーによりマージは無効です');
  if (input.repositoryVerified !== true || input.shaVerified !== true || input.protectionVerified !== true || input.mergeableVerified !== true) return deny('リポジトリ・SHA・保護設定・merge可能状態のtrusted観測が不足または失敗しました');
  if (!Array.isArray(policy.branches) || !policy.branches.some((/** @type {string} */ pattern) => branchMatches(pattern, input.branch))) return deny('先頭ブランチが許可されていません');
  if (!Array.isArray(policy.methods) || !policy.methods.includes(input.method)) return deny('マージ方式が許可されていません');
  if (!Array.isArray(input.checks)) return deny('検査状態が不明です');
  const observedChecks = input.checks;
  const missing = (policy.requiredChecks ?? []).filter((/** @type {string} */ check) => !observedChecks.includes(check));
  if (missing.length > 0) return deny(`必須検査が不足しています: ${missing.join(', ')}`);
  if (!/^[a-f0-9]{40}$/iu.test(input.headSha ?? '')) return deny('merge対象HEADの固定SHAがありません');
  if (!Array.isArray(input.approvals)) return deny('reviewのtrusted観測がありません');
  const needsApproval = (policy.requiredReviews ?? 0) > 0 || policy.mode === 'assisted';
  if (needsApproval && (typeof input.prAuthorActorId !== 'string' || input.prAuthorActorId === '' || typeof input.implementationAuthorActorId !== 'string' || input.implementationAuthorActorId === '')) return deny('PR authorとimplementation authorのstable ID観測がありません');
  const latestByActor = new Map();
  for (const approval of input.approvals) {
    const timestamp = typeof approval?.submittedAt === 'string' ? Date.parse(approval.submittedAt) : Number.NaN;
    if (typeof approval?.actorId !== 'string' || approval.actorId === '' || typeof approval?.state !== 'string' || approval.state === '' || !/^[a-f0-9]{40}$/iu.test(approval?.commitSha ?? '') || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(approval?.submittedAt ?? '') || !Number.isFinite(timestamp) || typeof approval?.reviewId !== 'string' || approval.reviewId === '') return deny('review観測のactor、state、commit SHA、submittedAt、review IDが不正です');
    const current = latestByActor.get(approval.actorId);
    if (!current) { latestByActor.set(approval.actorId, approval); continue; }
    const currentTimestamp = Date.parse(current.submittedAt);
    if (timestamp === currentTimestamp && approval.reviewId === current.reviewId && (approval.state !== current.state || approval.commitSha !== current.commitSha)) return deny('同一review IDの観測内容が矛盾しています');
    if (timestamp > currentTimestamp || (timestamp === currentTimestamp && approval.reviewId.localeCompare(current.reviewId, 'en', { numeric: true }) > 0)) latestByActor.set(approval.actorId, approval);
  }
  const independentApprovals = new Set([...latestByActor.values()].filter((approval) => approval.state === 'APPROVED' && approval.commitSha === input.headSha && approval.actorId !== input.prAuthorActorId && approval.actorId !== input.implementationAuthorActorId).map((approval) => approval.actorId));
  if (independentApprovals.size < (policy.requiredReviews ?? 0)) return deny('同じHEAD SHAに対する独立reviewが不足しています');
  if (policy.mode === 'assisted' && independentApprovals.size < 1) return deny('assistedモードには同じHEAD SHAに対する独立した人間承認が必要です');
  return { allowed: true, reason: '既定ブランチ上の信頼済みポリシーがマージを許可しています', operations: ['pr.merge'] };
}
