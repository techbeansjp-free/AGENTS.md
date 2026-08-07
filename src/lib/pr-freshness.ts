import { gh } from './exec.js';

/**
 * `gh pr merge` の対象PRのhead/base最新性判定・オプトイン時の最新化試行のみを担う
 * （Issue #493 DESIGN.md「責務・境界」節の `PrFreshnessGuard`）。`gh pr view`／`gh api` 以外の
 * 外部呼び出しは持たない。呼び出し順序の制御（`merge()`）とは責務を分離する。
 */

export interface FreshnessResult {
  status: 'fresh' | 'behind' | 'check_failed' | 'not_applicable';
  baseSha?: string;
}

export interface UpdateResult {
  status: 'updated' | 'failed' | 'not_applicable';
  baseSha?: string;
}

// `gh pr merge --help` が定義する値取り型オプション（次要素を対象識別子探索から除外する）。
// -R/--repo は同時に repoOverride としても検出する。
const VALUE_TAKING_FLAGS = new Set([
  '-A',
  '--author-email',
  '-b',
  '--body',
  '-F',
  '--body-file',
  '-t',
  '--subject',
  '--match-head-commit',
  '-R',
  '--repo',
]);
const REPO_FLAGS = new Set(['-R', '--repo']);

// `checkFreshness()` の UNKNOWN 解決待ちバックオフ（上限5回・合計待機を数秒程度に収める）。
// テスト実行時は環境変数で短縮できる（本番既定値はDESIGN.mdの「数秒程度」の範囲に収まる値）。
function unknownBackoffDelaysMs(): number[] {
  const override = process.env.AGENT_SKILL_CHAIN_TEST_UNKNOWN_BACKOFF_DELAYS_MS;
  if (override) return override.split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v));
  return [100, 200, 400, 800, 1600];
}

// update-branch API 完了確認ポーリングの定数（ADR-0039 Decision 3・5）。
// 本番既定は 3秒間隔・最大10回（合計最大30秒）。テスト実行時のみ環境変数で短縮できる
// （実装の外部から与える値であり、DESIGN.mdが固定する既定値そのものは変更しない）。
export const UPDATE_BRANCH_POLL_INTERVAL_MS = envIntOr(
  'AGENT_SKILL_CHAIN_TEST_UPDATE_BRANCH_POLL_INTERVAL_MS',
  3000,
);
export const UPDATE_BRANCH_POLL_MAX_ATTEMPTS = envIntOr(
  'AGENT_SKILL_CHAIN_TEST_UPDATE_BRANCH_POLL_MAX_ATTEMPTS',
  10,
);

function envIntOr(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** CLIは同期実行前提（`gh`呼び出しは `spawnSync`）のため、ポーリング待機も同期で行う。 */
function sleepSync(ms: number): void {
  if (ms <= 0) return;
  const view = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(view, 0, 0, ms);
}

/**
 * `args`（`gh pr merge` へ渡す引数）から対象PR（番号／URL／ブランチ）を抽出する。見つからない
 * 場合は `gh pr merge` 自体が対象省略時に行う「現在のgitブランチに紐づくPRの暗黙解決」と同じ
 * 処理を `gh pr view --json number` で明示的に行うフォールバックへ進む（ADR-0039 Decision 1）。
 *
 * `-R/--repo` の検出は対象識別子の探索結果に一切左右されない、同一走査内の独立した処理である。
 */
export function resolveMergeTarget(
  args: string[],
  root: string,
): { target: string | undefined; repoOverride: string | undefined } {
  let target: string | undefined;
  let repoOverride: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('-')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex !== -1) {
        const flagName = arg.slice(0, eqIndex);
        const value = arg.slice(eqIndex + 1);
        if (REPO_FLAGS.has(flagName)) repoOverride = value;
        continue;
      }
      if (VALUE_TAKING_FLAGS.has(arg)) {
        const value = args[i + 1];
        if (REPO_FLAGS.has(arg)) repoOverride = value;
        i += 1;
      }
      continue;
    }
    if (target === undefined) target = arg;
  }

  if (target !== undefined) return { target, repoOverride };

  const viewArgs = ['pr', 'view', '--json', 'number'];
  if (repoOverride) viewArgs.push('--repo', repoOverride);
  const result = gh(viewArgs, root);
  if (result.status !== 0) return { target: undefined, repoOverride };
  try {
    const parsed = JSON.parse(result.stdout) as { number?: number };
    if (typeof parsed.number === 'number') return { target: String(parsed.number), repoOverride };
  } catch {
    // JSON解析に失敗した場合もフォールスルーして特定不能として扱う。
  }
  return { target: undefined, repoOverride };
}

interface GhPrViewPayload {
  number?: number;
  state?: string;
  baseRefName?: string;
  headRefName?: string;
  mergeStateStatus?: string;
  baseRefOid?: string;
}

function queryPrView(root: string, target: string, repo?: string): GhPrViewPayload | undefined {
  const args = ['pr', 'view', target];
  if (repo) args.push('--repo', repo);
  args.push('--json', 'number,state,baseRefName,headRefName,mergeStateStatus,baseRefOid');
  const result = gh(args, root);
  if (result.status !== 0) return undefined;
  try {
    return JSON.parse(result.stdout) as GhPrViewPayload;
  } catch {
    return undefined;
  }
}

/**
 * 対象PRのhead/base最新性を `mergeStateStatus` で判定する（ADR-0039 Decision 2）。
 * `repo` は `resolveMergeTarget()` が返す `repoOverride` を呼び出し元がそのまま渡す値であり、
 * ここでは値の妥当性検証・加工を行わず `--repo` フラグとして `gh` へ引き継ぐだけの伝播に限定する。
 * `options.allowUnknownBackoff`（既定 `true`）が `false` の場合は `UNKNOWN` でもバックオフせず、
 * 1回の問い合わせ結果のみで判定する（`attemptUpdateBranch()` 内部ポーリング用）。
 */
export function checkFreshness(
  root: string,
  target: string,
  repo?: string,
  options?: { allowUnknownBackoff?: boolean },
): FreshnessResult {
  const allowUnknownBackoff = options?.allowUnknownBackoff ?? true;
  const delays = allowUnknownBackoff ? unknownBackoffDelaysMs() : [];

  let payload = queryPrView(root, target, repo);
  if (!payload) return { status: 'check_failed' };

  let attempt = 0;
  while (payload?.mergeStateStatus === 'UNKNOWN' && attempt < delays.length) {
    sleepSync(delays[attempt]);
    attempt += 1;
    payload = queryPrView(root, target, repo);
    if (!payload) return { status: 'check_failed' };
  }

  const baseSha = payload.baseRefOid;

  if (payload.state !== 'OPEN') return { status: 'not_applicable', baseSha };
  if (payload.mergeStateStatus === 'UNKNOWN') return { status: 'check_failed', baseSha };
  if (payload.mergeStateStatus === 'BEHIND') return { status: 'behind', baseSha };
  return { status: 'fresh', baseSha };
}

/**
 * `merge.auto_update_branch` 有効時のみ呼ばれる最新化試行（ADR-0039 Decision 3）。
 * update-branch APIは非同期実行（202 Accepted）のため、完了確認は `checkFreshness()` を
 * バックオフ無し（`allowUnknownBackoff: false`）で固定間隔・上限回数ポーリングする。
 */
export function attemptUpdateBranch(root: string, prNumber: string, repo?: string): UpdateResult {
  const apiArgs = ['api', '-X', 'PUT'];
  const repoSegment = repo ? repo : ':owner/:repo';
  apiArgs.push(`repos/${repoSegment}/pulls/${prNumber}/update-branch`);
  const result = gh(apiArgs, root);
  if (result.status !== 0) return { status: 'failed' };

  for (let attempt = 0; attempt < UPDATE_BRANCH_POLL_MAX_ATTEMPTS; attempt += 1) {
    sleepSync(UPDATE_BRANCH_POLL_INTERVAL_MS);
    const polled = checkFreshness(root, prNumber, repo, { allowUnknownBackoff: false });
    if (polled.status === 'fresh') return { status: 'updated', baseSha: polled.baseSha };
    if (polled.status === 'not_applicable') return { status: 'not_applicable' };
    // 'behind' / 'check_failed'（単発UNKNOWNを含む）はいずれも「未反映」として継続する。
  }
  return { status: 'failed' };
}

const UNRELATED_FAILURE_PATTERNS: RegExp[] = [
  /permission/i,
  /must have write access/i,
  /already merged/i,
  /already closed/i,
  /is closed/i,
];

/**
 * `gh pr merge` 失敗時のエラー原因分類（ADR-0039 Decision 4）。既知の「最新性と明らかに無関係」な
 * パターンのみを許可listとして扱い、それ以外は安全側で `ambiguous`（要件7側）を返す。
 */
export const MergeFailureClassifier = {
  classifyMergeFailure(stderr: string): 'unrelated' | 'ambiguous' {
    return UNRELATED_FAILURE_PATTERNS.some((pattern) => pattern.test(stderr)) ? 'unrelated' : 'ambiguous';
  },
};
