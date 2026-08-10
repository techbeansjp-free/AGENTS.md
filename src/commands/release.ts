import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../lib/paths.js';
import { git, gh } from '../lib/exec.js';
import { CliError } from '../lib/issue.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';
import {
  resolveVersion as resolveVersionPure,
  previousSemverTag,
  SEMVER_RE,
  RELEASE_BUMP_BRANCH_RE,
} from '../lib/release-version.js';
import { ensureGitIdentity } from '../lib/git-identity.js';
import { findOpenPrByHead } from '../lib/gh-open-pr.js';

/**
 * リリース自動化（Issue #196、ADR-0005）の4コンポーネント（バージョン解決器・bumpブランチ／PR作成
 * ・admin merge器・タガー・リリーサ）をCLIサブコマンドとして実装する。`.github/workflows/
 * agent-skill-chain-release.yml` からは `.agent-skill-chain/scripts/release-*.sh` 経由で呼ばれる。
 */

// ---- resolve-version ----

const RESOLVE_VERSION_USAGE = `
使い方: agent-skill-chain release resolve-version

現在の package.json の version と既存gitタグから、次リリース版数（target）・
package.json 書換えの要否（need_commit）を決定する（副作用なし）。

出力:
  成功時: 終了コード0。以下の行を標準出力へ（$GITHUB_OUTPUT へそのまま追記可能な形式）。
    latest=<semver>
    target=<semver>
    need_commit=true|false
  失敗時: 終了コード1以上。
`;

export async function resolveVersion(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(RESOLVE_VERSION_USAGE), 0;

    const root = repoRoot();
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };

    const tagList = git(['tag', '--list'], root);
    if (tagList.status !== 0) return fail(`git tag --list に失敗しました: ${tagList.stderr.trim()}`);
    const tags = tagList.stdout
      .split('\n')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const resolution = resolveVersionPure(tags, pkg.version);
    process.stdout.write(
      `latest=${resolution.latest}\ntarget=${resolution.target}\nneed_commit=${resolution.needCommit}\n`,
    );
    return 0;
  });
}

// ---- bump（bumpブランチ・PR作成／admin merge器） ----

const BUMP_USAGE = `
使い方: agent-skill-chain release bump <target>

target: package.json へ書き込む次リリース版数（'v'接頭辞なし、例: 0.2.1）。

package.json（および存在すれば package-lock.json）の version を target へ書き換え、短命ブランチ
release/bump-v<target> 上に 'chore(release): v<target> [skip ci]' としてcommit・pushし、
機械生成の版数台帳更新PRを作成、'gh pr merge --admin --squash --subject' でmainへマージする。
マージ直前に head ブランチ名・変更ファイル集合のスコープ検査を行い、逸脱時は自動admin mergeを
行わず human_required として停止する（ADR-0005）。同一版数のブランチ・PRが既存の場合は
スコープ検査を通過したときのみ再利用する（冪等）。

出力:
  成功時: 終了コード0。マージしたPR番号を標準出力へ。
  失敗時（human_required 含む）: 終了コード1以上。理由を標準エラー出力へ。
`;

/** package.json（および存在すれば package-lock.json）の version を target へ書き換える。
 * JSON.parse→JSON.stringify(_, null, 2)+'\n' の往復がこのリポジトリの両ファイルの既存
 * フォーマットと一致することを確認済み（version以外の差分を生まない）。lockfileVersion 3の
 * packages[""].version も版数の正本を反映する必要があるため併せて更新する。 */
function writeBumpedVersionFiles(root: string, target: string): void {
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
  pkg.version = target;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

  const lockPath = path.join(root, 'package-lock.json');
  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as {
      version?: string;
      packages?: Record<string, { version?: string }>;
    };
    lock.version = target;
    if (lock.packages?.['']) lock.packages[''].version = target;
    fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  }
}

/** bump commit へ stage する実在ファイルを返す。package-lock.json は任意のconsumer project
 * では存在しないため、存在しない pathspec を git add へ渡して正当な release bump を失敗させない。 */
function bumpedVersionFilePaths(root: string): string[] {
  const files = ['package.json'];
  if (fs.existsSync(path.join(root, 'package-lock.json'))) files.push('package-lock.json');
  return files;
}

interface BumpPr {
  number: number;
  headRefName: string;
  files: string[];
}

/** branch を head とする、状態が OPEN の版数台帳更新PRを1件探す。存在しなければ undefined
 * （新規作成・または再利用不可＝呼び出し側が human_required とする材料になる）。
 * `findOpenPrByHead`（root-cleanup runと共有）の戻り値から、bump固有のスコープ検査
 * （ファイルパスのみを見る）に必要な形へ整形する薄いラッパー。 */
function findOpenBumpPr(root: string, branch: string): BumpPr | undefined {
  const pr = findOpenPrByHead(root, branch);
  if (!pr) return undefined;
  return { number: pr.number, headRefName: pr.headRefName, files: pr.files.map((f) => f.path) };
}

const BUMP_PR_ALLOWED_FILES = new Set(['package.json', 'package-lock.json']);
const BASE_BRANCH_MODIFIED_RE = /base branch was modified/i;

// Issue #554: admin merge競合の再試行が最終的にhuman_requiredへ倒れても、失敗したCIジョブログ
// 以外に対象PR上へ痕跡が一切残らず、進行役が能動的にワークフロー実行を確認しない限り
// 「安全側で意図的に停止した」のか「見落とされている放置PR」なのか区別できない問題への対応。
const RELEASE_HUMAN_REQUIRED_LABEL = 'release:human_required';

/** human_required停止直前に対象PRへ理由コメント・識別ラベルを付与する（Issue #554 AC-1・AC-2）。
 * 通知そのものの成否は既存の再試行・安全側停止の判定・戻り値に一切影響させない
 * （AC-3）: gh呼び出し失敗はここで握りつぶし、呼び出し元は常にfail(reason)の結果をそのまま返す。 */
function notifyHumanRequired(root: string, prNumber: number, reason: string): void {
  gh(
    [
      'label',
      'create',
      RELEASE_HUMAN_REQUIRED_LABEL,
      '--color',
      'b60205',
      '--description',
      'リリース自動化が安全側停止し人間の対応を待っている',
    ],
    root,
  );
  gh(['pr', 'edit', String(prNumber), '--add-label', RELEASE_HUMAN_REQUIRED_LABEL], root);
  gh(['pr', 'comment', String(prNumber), '--body', reason], root);
}

/** human_requiredとしてfail()する直前に、判明している対象PR番号があれば通知する（AC-1・AC-2）。
 * PR番号が解決できない場合（例: 再試行中にPRを再解決できず終了する経路）は通知をスキップし、
 * 理由文字列のみを返す（silent failさせず、fail()自体は必ず実行される）。 */
function failHumanRequired(root: string, prNumber: number | undefined, reason: string): number {
  if (prNumber !== undefined) notifyHumanRequired(root, prNumber, reason);
  return fail(reason);
}

/** admin merge直前のスコープ検査（ADR-0005）: (a) head が release/bump-v* に一致し、
 * (b) 変更ファイル集合が package.json（±package-lock.json）のみであることを機械検査する。
 * いずれか不成立、または変更ファイルが0件（想定外の空PR）の場合はエラー文言を返す
 * （undefinedは検査通過）。 */
function checkBumpPrScope(pr: BumpPr, expectedBranch: string): string | undefined {
  if (pr.headRefName !== expectedBranch || !RELEASE_BUMP_BRANCH_RE.test(pr.headRefName)) {
    return `PR #${pr.number} の headRefName '${pr.headRefName}' がスコープ外です（期待値: '${expectedBranch}'）`;
  }
  if (pr.files.length === 0) {
    return `PR #${pr.number} の変更ファイルが0件です（想定外の空PR）`;
  }
  const outOfScope = pr.files.filter((p) => !BUMP_PR_ALLOWED_FILES.has(p));
  if (outOfScope.length > 0) {
    return `PR #${pr.number} にスコープ外の変更ファイルが含まれています: ${outOfScope.join(', ')}`;
  }
  return undefined;
}

/** GitHubがPR作成後のmain更新を理由にadmin mergeを拒否したことだけを判定する。認証・
 * 権限・チェック失敗など他のmerge失敗は、一時的なbase競合として再試行してはならない。 */
function isBaseBranchModifiedMergeFailure(stderr: string): boolean {
  return BASE_BRANCH_MODIFIED_RE.test(stderr);
}

interface BumpBaseDivergence {
  diverged: boolean;
  error?: string;
}

/** 既存 release/bump-v<target> ブランチのベースが現在の main より古いか（乖離しているか）を判定する
 * （Issue #228）。origin を fetch した上で merge-base(origin/<branch>, origin/main) と origin/main HEAD
 * を比較する。一致すれば「main はブランチ作成後に進んでいない（乖離なし）」、不一致なら「main が
 * 進んでいる（乖離あり）」。版数フィールド比較ではなく merge-base を採るのは、乖離の定義そのもの
 * （＝ base 前進）を main 側の版数変更有無に依存せず直接判定するため。fetch/merge-base/rev-parse の
 * 失敗は error に載せ、呼び出し側が fail(...) で停止する材料にする。 */
function detectBumpBaseDivergence(root: string, branch: string): BumpBaseDivergence {
  const fetch = git(['fetch', 'origin'], root);
  if (fetch.status !== 0) return { diverged: false, error: `git fetch に失敗しました: ${fetch.stderr.trim()}` };

  const mergeBase = git(['merge-base', `origin/${branch}`, 'origin/main'], root);
  if (mergeBase.status !== 0) return { diverged: false, error: `git merge-base に失敗しました: ${mergeBase.stderr.trim()}` };

  const mainHead = git(['rev-parse', 'origin/main'], root);
  if (mainHead.status !== 0) return { diverged: false, error: `git rev-parse origin/main に失敗しました: ${mainHead.stderr.trim()}` };

  return { diverged: mergeBase.stdout.trim() !== mainHead.stdout.trim() };
}

/** 既存 bump ブランチのベースが現在の main と乖離しているときのみ呼び、ブランチ内容を現在の
 * main 基準の正しい <現行version>→<target> 差分へ作り直す（Issue #228）。作業木を origin/main へ
 * 揃え直し（checkout -B）、identity を保証し、版数ファイルを再生成して force-with-lease で push する。
 * force push 競合時は自動 delete+recreate を採らず human_required 文言を返して安全側停止する
 * （open PR を閉じ状態を複雑化しないため）。その他の失敗は理由文字列を返す。 */
function rebuildBumpBranchToMain(root: string, branch: string, target: string, message: string): string | undefined {
  const checkout = git(['checkout', '-B', branch, 'origin/main'], root);
  if (checkout.status !== 0) return `git checkout -B に失敗しました: ${checkout.stderr.trim()}`;

  const identityError = ensureGitIdentity(root);
  if (identityError) return identityError;

  writeBumpedVersionFiles(root, target);

  const add = git(['add', ...bumpedVersionFilePaths(root)], root);
  if (add.status !== 0) return `git add に失敗しました: ${add.stderr.trim()}`;

  const commit = git(['commit', '-m', message], root);
  if (commit.status !== 0) return `git commit に失敗しました: ${commit.stderr.trim()}`;

  const push = git(['push', '--force-with-lease', 'origin', branch], root);
  if (push.status !== 0) {
    return `human_required: bumpブランチの現行main基準への再構築後、force push が競合しました（${push.stderr.trim()}）`;
  }
  return undefined;
}

export async function bump(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(BUMP_USAGE), 0;
    const [target] = args;
    if (!target || !SEMVER_RE.test(target)) {
      throw new CliError(`target は semver 形式（<major>.<minor>.<patch>）である必要があります: '${target ?? ''}'`);
    }

    const root = repoRoot();
    const branch = `release/bump-v${target}`;
    const message = `chore(release): v${target} [skip ci]`;

    const remoteBranch = git(['ls-remote', '--heads', 'origin', branch], root);
    if (remoteBranch.status !== 0) return fail(`git ls-remote に失敗しました: ${remoteBranch.stderr.trim()}`);
    const branchExists = remoteBranch.stdout.trim().length > 0;

    if (!branchExists) {
      const checkout = git(['checkout', '-b', branch], root);
      if (checkout.status !== 0) return fail(`git checkout -b に失敗しました: ${checkout.stderr.trim()}`);

      const identityError = ensureGitIdentity(root);
      if (identityError) return fail(identityError);

      writeBumpedVersionFiles(root, target);

      const add = git(['add', ...bumpedVersionFilePaths(root)], root);
      if (add.status !== 0) return fail(`git add に失敗しました: ${add.stderr.trim()}`);

      const commit = git(['commit', '-m', message], root);
      if (commit.status !== 0) return fail(`git commit に失敗しました: ${commit.stderr.trim()}`);

      const push = git(['push', 'origin', branch], root);
      if (push.status !== 0) return fail(`git push に失敗しました: ${push.stderr.trim()}`);
    } else {
      // Issue #228: 既存ブランチ再利用時、そのベースが現在の main より古い（複数PR連続マージ等で
      // main が進んだ）場合、内容を更新せず merge を再試行するだけでは実マージコンフリクトを起こす。
      // 乖離を検知したときのみ現行 main 基準へ作り直し、常に正しい差分でマージを試みる状態を保つ。
      // 乖離なし（純粋な一時 API レース）の場合は再生成・force push を行わず従来どおり再試行のみ。
      const divergence = detectBumpBaseDivergence(root, branch);
      if (divergence.error) return fail(divergence.error);
      if (divergence.diverged) {
        const rebuildError = rebuildBumpBranchToMain(root, branch, target, message);
        if (rebuildError) {
          return failHumanRequired(root, findOpenBumpPr(root, branch)?.number, rebuildError);
        }
      }
    }

    let pr = findOpenBumpPr(root, branch);
    if (!pr) {
      const base = 'main';
      const title = `chore(release): v${target}`;
      const body = [
        `機械生成の版数台帳更新PR（Issue #196 リリース自動化が生成）。`,
        '',
        `\`package.json\` の \`version\` を \`${target}\` へ更新する。`,
        'SPEC/DESIGN/PLAN/VALIDATIONを伴わない、承認済みの本Issue design-gate決定（ADR-0005）の機械的執行。',
      ].join('\n');
      const create = gh(['pr', 'create', '--head', branch, '--base', base, '--title', title, '--body', body], root);
      if (create.status !== 0) return fail(`gh pr create に失敗しました: ${create.stderr.trim()}`);

      pr = findOpenBumpPr(root, branch);
      if (!pr) return fail('gh pr create 後にPRを解決できませんでした');
    }

    const scopeError = checkBumpPrScope(pr, branch);
    if (scopeError) {
      return failHumanRequired(root, pr.number, `human_required: 自動admin mergeを行わず停止します（${scopeError}）`);
    }

    const merge = gh(
      ['pr', 'merge', String(pr.number), '--admin', '--squash', '--subject', message, '--body', ''],
      root,
    );
    if (merge.status === 0) return ok(String(pr.number));

    // Issue #266: PR作成直後に別の自動化がmainを更新すると、GitHubはbase更新競合だけを
    // 返してmergeを拒否する。このケースに限り、最新mainから同じ短命branchを再構築し、
    // 同じOPEN PRへ一度だけ再試行する。回数を固定し、他種の失敗を再試行対象にしないことで
    // 無限再試行や認証障害の隠蔽を防ぐ。
    if (!isBaseBranchModifiedMergeFailure(merge.stderr)) {
      return fail(`gh pr merge --admin に失敗しました: ${merge.stderr.trim()}`);
    }

    const retryPrBeforeRebuild = findOpenBumpPr(root, branch);
    if (!retryPrBeforeRebuild) {
      return failHumanRequired(
        root,
        pr.number,
        'human_required: base更新競合後にOPENのbump PRを再解決できないため自動再試行を停止します',
      );
    }
    const retryScopeError = checkBumpPrScope(retryPrBeforeRebuild, branch);
    if (retryScopeError) {
      return failHumanRequired(
        root,
        retryPrBeforeRebuild.number,
        `human_required: base更新競合後の再同期前に自動admin mergeを停止します（${retryScopeError}）`,
      );
    }

    // detectBumpBaseDivergence はoriginを更新する唯一の既存経路であり、ここでは乖離の真偽に
    // かかわらず最新main基準へ再構築する。merge失敗時点から再試行までにmainが再度進んでも、
    // 再試行は一度で打ち切りhuman_requiredへ移行する。
    const refresh = detectBumpBaseDivergence(root, branch);
    if (refresh.error) {
      return failHumanRequired(
        root,
        retryPrBeforeRebuild.number,
        `human_required: base更新競合後に現行mainを取得できないため自動再試行を停止します（${refresh.error}）`,
      );
    }
    const rebuildError = rebuildBumpBranchToMain(root, branch, target, message);
    if (rebuildError) {
      return failHumanRequired(
        root,
        retryPrBeforeRebuild.number,
        `human_required: base更新競合後の現行main基準への再同期に失敗しました（${rebuildError}）`,
      );
    }

    const retryPr = findOpenBumpPr(root, branch);
    if (!retryPr) {
      return failHumanRequired(
        root,
        retryPrBeforeRebuild.number,
        'human_required: base更新競合後に再構築済みbump PRを再解決できないため自動再試行を停止します',
      );
    }
    const rebuiltScopeError = checkBumpPrScope(retryPr, branch);
    if (rebuiltScopeError) {
      return failHumanRequired(
        root,
        retryPr.number,
        `human_required: base更新競合後の再同期後に自動admin mergeを停止します（${rebuiltScopeError}）`,
      );
    }

    const retryMerge = gh(
      ['pr', 'merge', String(retryPr.number), '--admin', '--squash', '--subject', message, '--body', ''],
      root,
    );
    if (retryMerge.status !== 0) {
      return failHumanRequired(
        root,
        retryPr.number,
        `human_required: base更新競合後のadmin merge再試行に失敗しました（${retryMerge.stderr.trim()}）`,
      );
    }

    return ok(String(retryPr.number));
  });
}

// ---- tag（タガー、冪等） ----

const TAG_USAGE = `
使い方: agent-skill-chain release tag <target> <ref>

target: 版数（'v'接頭辞なし、例: 0.2.1）。
ref:    タグを打つcommit-ish（SHAまたはブランチ名）。

v<target> タグが未存在のときのみ、ref へ注釈付きタグを作成しpushする（存在すれば冪等スキップ）。

出力:
  成功時: 終了コード0。作成（またはスキップ）した v<target> を標準出力へ。
  失敗時: 終了コード1以上。
`;

export async function tag(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(TAG_USAGE), 0;
    const [target, ref] = args;
    if (!target || !SEMVER_RE.test(target)) {
      throw new CliError(`target は semver 形式（<major>.<minor>.<patch>）である必要があります: '${target ?? ''}'`);
    }
    if (!ref) throw new CliError('ref は必須です');

    const root = repoRoot();
    const tagName = `v${target}`;

    const existsRemote = git(['ls-remote', '--tags', 'origin', tagName], root);
    if (existsRemote.status !== 0) return fail(`git ls-remote に失敗しました: ${existsRemote.stderr.trim()}`);
    if (existsRemote.stdout.trim().length > 0) {
      return ok(`${tagName}（既存タグを検出したため冪等スキップ）`);
    }

    const identityError = ensureGitIdentity(root);
    if (identityError) return fail(identityError);

    const createTag = git(['tag', '-a', tagName, ref, '-m', `Release ${tagName}`], root);
    if (createTag.status !== 0) return fail(`git tag に失敗しました: ${createTag.stderr.trim()}`);

    const push = git(['push', 'origin', tagName], root);
    if (push.status !== 0) return fail(`git push (tag) に失敗しました: ${push.stderr.trim()}`);

    return ok(tagName);
  });
}

// ---- publish（リリーサ、冪等） ----

const PUBLISH_USAGE = `
使い方: agent-skill-chain release publish <target>

target: 版数（'v'接頭辞なし、例: 0.2.1）。

v<target> の GitHub Release が未存在のときのみ、v<target> タグを指すReleaseを作成する
（存在すれば冪等スキップ）。事前に v<target> タグがリモートに存在している必要がある。
Release本文にはWhat's Changed（マージ済みPR一覧）とFull Changelog（前回semverタグとの
比較リンク）を自動生成で含める。起点は target 未満で最大のsemverタグを明示指定し、
該当タグが無い場合は起点指定なしで自動生成する（失敗しない）。

出力:
  成功時: 終了コード0。作成（またはスキップ）した v<target> を標準出力へ。
  失敗時: 終了コード1以上。
`;

export async function publish(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) return printUsage(PUBLISH_USAGE), 0;
    const [target] = args;
    if (!target || !SEMVER_RE.test(target)) {
      throw new CliError(`target は semver 形式（<major>.<minor>.<patch>）である必要があります: '${target ?? ''}'`);
    }

    const root = repoRoot();
    const tagName = `v${target}`;

    const existing = gh(['release', 'view', tagName], root);
    if (existing.status === 0) {
      return ok(`${tagName}（既存Releaseを検出したため冪等スキップ）`);
    }

    // Issue #226: GitHub側の起点自動検出はRelease履歴由来で旧日時形式タグ（例: v20260720.060726）
    // を起点に選びうるため、直前semverタグが存在する場合のみ --notes-start-tag で明示指定する。
    // タグ一覧はローカルgitから取得する（release workflowは fetch-depth: 0 でcheckoutし、
    // 同一job内の resolve-version が同じ手段で動作している）。
    const tagList = git(['tag', '--list'], root);
    if (tagList.status !== 0) return fail(`git tag --list に失敗しました: ${tagList.stderr.trim()}`);
    const tags = tagList.stdout
      .split('\n')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const startTag = previousSemverTag(tags, target);

    // Issue #226: --notes の固定文は --generate-notes 併用時、自動生成notes（What's Changed /
    // Full Changelog）の先頭に付加される（gh CLI公式仕様）。
    const createArgs = [
      'release',
      'create',
      tagName,
      '--title',
      tagName,
      '--notes',
      `agent-skill-chain ${tagName} のリリース。`,
      '--generate-notes',
    ];
    if (startTag) createArgs.push('--notes-start-tag', startTag);

    const create = gh(createArgs, root);
    if (create.status !== 0) return fail(`gh release create に失敗しました: ${create.stderr.trim()}`);

    return ok(tagName);
  });
}
