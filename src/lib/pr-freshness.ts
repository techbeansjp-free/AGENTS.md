import { gh } from './exec.js';

/**
 * `gh pr merge` の対象PRのhead/base最新性判定・オプトイン時の最新化試行のみを担う。
 * `gh pr view`／`gh api` 以外の外部呼び出しは持たない。呼び出し順序の制御（`merge()`）とは
 * 責務を分離する。
 */

export interface FreshnessResult {
  status: 'fresh' | 'behind' | 'check_failed' | 'not_applicable';
  baseSha?: string;
  // Issue #493実装ゲート是正: update-branch等、数値PR番号を要求するREST APIへ対象識別子
  // （PR番号／URL／ブランチのいずれか）をそのまま渡すと不正なパスになるため、`gh pr view`
  // が返す実際のPR番号を呼び出し元（merge()）が正規化に使えるよう引き継ぐ。
  prNumber?: string;
  // Issue #493実装ゲート2回目是正: `gh pr view` の応答（`url`）から一意に導出した対象PRの
  // 実際の所属リポジトリ（`owner/repo`）。呼び出し元が別経路の値（`-R`由来の`repoOverride`等）
  // に頼らず、以降のcompare・update-branch呼び出しをこの値へ揃えられるよう引き継ぐ。
  repo?: string;
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
// テスト実行時のみ環境変数で短縮できる（本番既定値は変更しない）。
function unknownBackoffDelaysMs(): number[] {
  const override = process.env.AGENT_SKILL_CHAIN_TEST_UNKNOWN_BACKOFF_DELAYS_MS;
  if (override) return override.split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v));
  return [100, 200, 400, 800, 1600];
}

// update-branch API 完了確認ポーリングの定数。本番既定は 3秒間隔・最大10回（合計最大30秒）。
// テスト実行時のみ環境変数で短縮できる（実装の外部から与える値であり、既定値そのものは変更しない）。
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
 * 処理を `gh pr view --json number` で明示的に行うフォールバックへ進む。
 *
 * `-R/--repo` の検出は対象識別子の探索結果に一切左右されない、同一走査内の独立した処理である。
 * ここで返す `repoOverride` は、あくまで `gh pr view` 呼び出し自体への `--repo` ヒントに過ぎない。
 * 対象PRの実際の所属リポジトリ（compare・update-branch等、後続API呼び出しの根拠）は、
 * `checkFreshness()` が `gh pr view` の応答（`url`）から別途一意に導出する
 * （fork由来PRやcwdの既定リポジトリと異なるリポジトリのPR URLを対象指定した場合でも、
 * `repoOverride` 未指定のままcwdの既定リポジトリへ誤って作用しないようにするため）。
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
      // `-R` は値密着の短縮形式（例: `-Rowner/repo`）も許容する。長いオプション名（`--repo`）は
      // ghの慣例上 `=` 区切りのみを許容するため対象外。
      if (arg.startsWith('-R') && !arg.startsWith('--') && arg.length > 2) {
        repoOverride = arg.slice(2);
        continue;
      }
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
  url?: string;
  isCrossRepository?: boolean;
  // Issue #493実装ゲート3回目是正: `gh pr view --json headRepositoryOwner` の実際の応答は
  // 文字列ではなくオブジェクト（例: `{"id":"O_...","login":"owner"}`）である。誤って文字列型
  // で宣言しテンプレートリテラルへ直接埋め込むと`"[object Object]:<branch>"`という壊れた値に
  // なり、まさにfork（クロスリポジトリ）由来PRのcompare呼び出しが常に失敗する
  // （head-repository-owner-type-mismatch）。
  headRepositoryOwner?: { login: string };
}

function queryPrView(root: string, target: string, repo?: string): GhPrViewPayload | undefined {
  const args = ['pr', 'view', target];
  if (repo) args.push('--repo', repo);
  args.push(
    '--json',
    'number,state,baseRefName,headRefName,mergeStateStatus,baseRefOid,url,isCrossRepository,headRepositoryOwner',
  );
  const result = gh(args, root);
  if (result.status !== 0) return undefined;
  try {
    return JSON.parse(result.stdout) as GhPrViewPayload;
  } catch {
    return undefined;
  }
}

/**
 * `gh pr view` が返す PR URL（形式: `https://github.com/<owner>/<repo>/pull/<n>`）から、
 * 対象PRの実際の所属リポジトリ（`owner/repo`）を一意に導出する。`-R/--repo` 等、呼び出し側が
 * 別経路で保持する値には一切依存しない（fork由来PRやcwdの既定リポジトリと異なるリポジトリの
 * PRを対象指定した場合でも、常にPR自身の応答から正しいリポジトリを特定するため）。
 */
function deriveRepoFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/.exec(url);
  return match ? match[1] : undefined;
}

interface GhCompareResult {
  status?: string;
  behind_by?: number;
}

/** `gh api repos/<repo>/compare/<base>...<head>`（GitHub REST APIのcompareエンドポイント）を呼ぶ。 */
function queryCompare(root: string, repo: string, base: string, head: string): GhCompareResult | undefined {
  const result = gh(['api', `repos/${repo}/compare/${base}...${head}`], root);
  if (result.status !== 0) return undefined;
  try {
    return JSON.parse(result.stdout) as GhCompareResult;
  } catch {
    return undefined;
  }
}

/**
 * 対象PRのhead/base最新性を判定する。`repo` は `gh pr view` 呼び出し自体への `--repo` ヒントに
 * 過ぎず、値の妥当性検証・加工を行わず伝播するだけに限定する。compare等の後続API呼び出しの
 * 根拠となる実際の所属リポジトリは、`gh pr view` の応答（`url`）から都度導出する
 * （`deriveRepoFromUrl()`）。
 * `options.allowUnknownBackoff`（既定 `true`）が `false` の場合は `UNKNOWN` でもバックオフせず、
 * 1回の問い合わせ結果のみで判定する（`attemptUpdateBranch()` 内部ポーリング用）。
 *
 * `mergeStateStatus` はbase branch側のruleset設定（「Require branches to be up to date before
 * merging」等）が有効な場合にのみ `BEHIND` を返すGitHub仕様であり、無効な場合は実際にbehindでも
 * `CLEAN`/`UNSTABLE`/`BLOCKED` 等 `BEHIND` 以外の値が返り得る。これを判定の唯一の根拠にすると、
 * behindなPRはそのままマージされないという保証自体が無効化されるため、実際のahead/behindは
 * `gh api compare` で独立に検証し、`mergeStateStatus` はUNKNOWN解決待ちのポーリング制御にのみ
 * 補助的に用いる。バックオフ後もUNKNOWNのままであっても、compare API呼び出し自体は
 * `mergeStateStatus` に依存せず行えるため、ここで判定を諦めずcompare結果まで進む。
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
  const prNumber = typeof payload.number === 'number' ? String(payload.number) : undefined;
  const actualRepo = deriveRepoFromUrl(payload.url);

  if (payload.state !== 'OPEN') return { status: 'not_applicable', baseSha, prNumber, repo: actualRepo };

  if (!payload.baseRefName || !payload.headRefName) {
    return { status: 'check_failed', baseSha, prNumber, repo: actualRepo };
  }
  if (!actualRepo) {
    // 実際の所属リポジトリを特定できない場合、compareをどのリポジトリに対して呼ぶべきか
    // 安全に決定できないため、これ以上進めず失敗として扱う。
    return { status: 'check_failed', baseSha, prNumber };
  }
  const headArg =
    payload.isCrossRepository && payload.headRepositoryOwner?.login
      ? `${payload.headRepositoryOwner.login}:${payload.headRefName}`
      : payload.headRefName;
  const compare = queryCompare(root, actualRepo, payload.baseRefName, headArg);
  if (!compare) return { status: 'check_failed', baseSha, prNumber, repo: actualRepo };
  const isBehind = compare.status === 'behind' || (typeof compare.behind_by === 'number' && compare.behind_by > 0);
  if (isBehind) return { status: 'behind', baseSha, prNumber, repo: actualRepo };
  return { status: 'fresh', baseSha, prNumber, repo: actualRepo };
}

/**
 * `merge.auto_update_branch` 有効時のみ呼ばれる最新化試行。
 * update-branch APIは非同期実行（202 Accepted）のため、完了確認は `checkFreshness()` を
 * バックオフ無し（`allowUnknownBackoff: false`）で固定間隔・上限回数ポーリングする。
 * `repo` は呼び出し元が `checkFreshness()` の結果から得た対象PRの実際の所属リポジトリ
 * （`FreshnessResult.repo`）を渡すこと。`resolveMergeTarget()` が返す `repoOverride` を
 * そのまま渡すと、fork由来PRやcwdの既定リポジトリと異なるリポジトリのPRに対して
 * 誤ったリポジトリへ書き込み系APIを呼んでしまう。
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
 * `gh pr merge` 失敗時のエラー原因分類。既知の「最新性と明らかに無関係」なパターンのみを
 * 許可listとして扱い、それ以外は安全側で `ambiguous` を返す。
 */
export const MergeFailureClassifier = {
  classifyMergeFailure(stderr: string): 'unrelated' | 'ambiguous' {
    return UNRELATED_FAILURE_PATTERNS.some((pattern) => pattern.test(stderr)) ? 'unrelated' : 'ambiguous';
  },
};
