import crypto from 'node:crypto';
import { stableJson } from '../lib/security.js';
import { enforceTrustedBoundary } from './enforcement.js';

/** @param {any} state */
export function buildFinalizeReport(state) {
  const reasons = [];
  if (!state.repository || !state.worktree || !state.branch || !state.base || !state.headSha || !state.baseSha) reasons.push('同一性が不明です');
  if (state.dirty !== false) reasons.push('worktreeに変更があるか状態が不明です');
  if (!Array.isArray(state.untracked) || state.untracked.length > 0) reasons.push('未追跡ファイルがあるか状態が不明です');
  if (!Array.isArray(state.stashes) || state.stashes.length > 0) reasons.push('stashがあるか状態が不明です');
  if (!Array.isArray(state.temporaryArtifacts) || state.temporaryArtifacts.length > 0) reasons.push('一時資産があるか状態が不明です');
  if (!Array.isArray(state.ignoredArtifacts) || state.ignoredArtifacts.length > 0) reasons.push('無視対象資産があるか状態が不明です');
  for (const [field, label] of [
    ['pushed', 'コミットがpushされていません'], ['remoteBranch', 'リモートブランチがありません'], ['prMerged', 'PRがマージされていません'],
    ['specConsistent', '仕様整合性が証明されていません'], ['testsPassed', 'テスト合格が証明されていません'], ['reviewApproved', 'レビューが承認されていません'],
    ['recoveryReachable', '復旧参照を利用できません'],
  ]) if (state[field] !== true) reasons.push(label);
  if (!state.recoveryRef) reasons.push('復旧参照がありません');
  const snapshot = structuredClone(state);
  const hash = crypto.createHash('sha256').update(stableJson(snapshot)).digest('hex');
  return { version: 1, safe: reasons.length === 0, reasons, snapshot, hash };
}

/** @param {{report: any, approvedHash: string, currentState: any, trustedPolicy: any}} input @param {(operation: string, payload: any) => void} destructive */
export function applyFinalize(input, destructive) {
  if (!input.trustedPolicy) throw new Error('finalize applyにはtrusted policyが必要です');
  const observations = (input.trustedPolicy.rules ?? []).filter((/** @type {any} */ rule) => rule.scope?.includes('worktree') && ['identity', 'path'].includes(rule.riskClass)).map((/** @type {any} */ rule) => ({ ruleId: rule.ruleId, violated: !input.report.safe, reasons: input.report.reasons, checks: ['actual finalize reportのrepository、path、SHA、review、test、recovery状態を導出した'] }));
  const boundary = enforceTrustedBoundary({ policy: input.trustedPolicy, boundary: 'worktree', observations });
  if (!boundary.allowed) throw new Error(`${boundary.diagnostic.ruleId}: ${boundary.diagnostic.reasons.join('; ')}`);
  if (!input.report.safe) throw new Error(`安全でないため完了処理を拒否しました: ${input.report.reasons.join('; ')}`);
  if (!/^[a-f0-9]{64}$/.test(input.approvedHash) || input.approvedHash !== input.report.hash) throw new Error('明示承認が報告ハッシュと一致しません');
  const current = buildFinalizeReport(input.currentState);
  if (!current.safe || current.hash !== input.report.hash) throw new Error('事前確認後に状態が変化しました（TOCTOU）');
  destructive('worktree.remove', { path: current.snapshot.worktree, branch: current.snapshot.branch });
  return { state: 'finalized', worktree: current.snapshot.worktree, branchPreserved: true };
}
