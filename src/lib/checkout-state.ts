import { git } from './exec.js';

/**
 * ISSUE-619: `root-cleanup run` が永続main worktreeで一時ブランチへチェックアウトを
 * 切り替える前後で、実行前の実際のref（ブランチ名 or detached HEADのcommit SHA）を
 * 記録・復元するためだけの最小コンポーネント。root-cleanup固有の対象ファイル検出・
 * PR作成・スコープ検査・マージ判断には一切関与しない。
 *
 * `worktree.ts` の `resolveCurrentBranchInfo`（CI環境の `GITHUB_HEAD_REF` 代替を伴う、
 * 検証目的の論理ブランチ名解決）とは別関数として実装する。復元対象は実行前に
 * チェックアウトしていた実際のrefであり、CI都合の代替名へすり替えてはならないため。
 */
export type CheckoutState = { kind: 'branch'; name: string } | { kind: 'detached'; sha: string };

/** 実行開始時点のチェックアウト状態を記録する。`git rev-parse --abbrev-ref HEAD` が
 * リテラル文字列 `HEAD` を返す場合はdetached HEADとみなし、現在commitのSHAを記録する。 */
export function captureCheckoutState(root: string): CheckoutState {
  const branchResult = git(['rev-parse', '--abbrev-ref', 'HEAD'], root);
  const rawBranch = branchResult.status === 0 ? branchResult.stdout.trim() : '';
  if (branchResult.status === 0 && rawBranch !== 'HEAD' && rawBranch !== '') {
    return { kind: 'branch', name: rawBranch };
  }
  const shaResult = git(['rev-parse', 'HEAD'], root);
  return { kind: 'detached', sha: shaResult.stdout.trim() };
}

/** 記録した状態へチェックアウトを戻す。成功時は `undefined`、失敗時は復元先・失敗後の
 * 現在ブランチ名を含むエラーメッセージ文字列を返す（例外を投げない）。 */
export function restoreCheckoutState(root: string, state: CheckoutState): string | undefined {
  const target = state.kind === 'branch' ? state.name : state.sha;
  const checkout = git(['checkout', target], root);
  if (checkout.status === 0) return undefined;

  const currentResult = git(['rev-parse', '--abbrev-ref', 'HEAD'], root);
  const current = currentResult.status === 0 ? currentResult.stdout.trim() : '(不明)';
  return `チェックアウト状態の復元に失敗しました（復元先: '${target}'、現在のブランチ: '${current}'）: ${checkout.stderr.trim()}`;
}
