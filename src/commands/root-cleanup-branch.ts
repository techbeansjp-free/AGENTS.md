import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../lib/paths.js';
import { loadConfig, type AgentSkillChainConfig } from '../lib/config.js';
import { parseIssueId, CliError } from '../lib/issue.js';
import { git } from '../lib/exec.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';
import { ensureGitIdentity } from '../lib/git-identity.js';
import { findIssueWorktree, defaultBranch } from '../lib/worktree.js';
import { leaseFilePath } from '../lib/local-state.js';
import { tryReadYamlFile, writeYamlFileExclusive } from '../lib/yaml-io.js';
import { validateAgainstSchema } from '../lib/schema.js';
import {
  allLeasesFor,
  acquireLeaseRef,
  releaseLeaseRef,
  listAllLeaseRefNames,
  type WriterLease,
} from '../lib/github-lease.js';
import { ROOT_ARTIFACT_FILES } from '../lib/root-artifacts.js';
import {
  classifyRootArtifacts,
  splitNulRecords,
  type RootArtifactStateEntry,
} from '../lib/root-artifact-state.js';

/**
 * Issue ブランチ上での root成果物マージ前削除（ISSUE-798、ADR-0080）。進行役が起動するが
 * commit の主体は `.agent-skill-chain/config/roles.yaml` の `root_artifact_cleanup_worker`
 * （`scope: root_artifacts_only`）であり、進行役の権限は拡大しない。
 *
 * 入力は対象 Issue の識別子1個のみで、ファイル内容・commit メッセージ本文・任意テキストを
 * 外部から受け取る引数も標準入力経路も持たない。LLM・対話エージェント・アダプタを起動せず、
 * 同一入力・同一リポジトリ状態に対して同一の動作を行う。
 *
 * 既定ブランチへの push を契機とする事後清掃自動化（`root-cleanup run`）と、root 直下の残存を
 * 検査する `verify root-clean` は、契機・対象ブランチ・実行主体が異なる別機構であり本コマンドは
 * それらを一切変更しない。対象ファイル集合を与える `ROOT_ARTIFACT_FILES` のみを共有する。
 */

const USAGE = `
使い方: agent-skill-chain root-cleanup branch <issue_id>

issue_id: ISSUE-<番号> 形式のIssue ID（唯一の入力）

対象IssueのworktreeがチェックアウトしているIssueブランチ上で、repoRoot直下の
SPEC.md/DESIGN.md/PLAN.md/VALIDATION.md（コード内リテラル4件、設定化しない）の削除だけで
構成されたcommitを作り、対象ブランチへpushする。ファイル内容・commitメッセージ本文・任意
テキストを与える引数も標準入力経路も持たず、LLM・対話エージェント・アダプタを起動しない。

停止条件（いずれもcommit・pushを行わず非ゼロ終了する）:
  - Gitから復元できない内容（未追跡ファイル・未commitの変更）を持つ対象ファイルがある
  - 対象4ファイル以外の変更がindexへ記録されている
  - 対象worktreeが既定ブランチをチェックアウトしている、またはdetached HEADである
  - 対象ブランチのremote先頭が不在・先行・分岐している、またはremote先頭からHEADへの差分に
    root成果物の削除以外が含まれる
  - 対象Issueにwriter leaseが1件でも存在する（segmentを問わない。待機・強制解放・回収はしない）

出力:
  成功時: 終了コード0。削除経路では作成したcommitのSHA、no-op経路ではその旨を標準出力へ。
          終了コード0は、対象ブランチのremote先頭がlocal HEADと一致し、そのtreeにも作業ツリーにも
          root成果物が1件も存在しない状態が成立していることを意味する。
  失敗時: 終了コード1以上。原因と利用者が取るべき操作を標準エラー出力へ。
`;

/** 本コマンドが取得する writer lease の segment 値（`.agent-skill-chain/schemas/lease.schema.yaml`）。 */
const CLEANUP_LEASE_SEGMENT = 'root_artifact_cleanup';

/**
 * commit メッセージは固定文字列であり、可変部は `parseIssueId` が `[0-9]+` へ限定した
 * Issue 番号だけである。外部から本文を与える経路を持たせないための固定化（不変条件 I5）。
 */
const COMMIT_MESSAGE_PREFIX = 'chore(root-cleanup): remove root segment artifacts for ISSUE-';

const TARGET_FILES = new Set<string>(ROOT_ARTIFACT_FILES);

interface ExecutionContext {
  issueId: string;
  issueNumber: string;
  worktreePath: string;
  branch: string;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

function failure<T>(error: string): Outcome<T> {
  return { ok: false, error };
}

// ---- git 出力の読み取り ----

interface NameStatusEntry {
  status: string;
  path: string;
}

/** `git diff --name-status -z --no-renames` の `<status> NUL <path> NUL` 列を読む。 */
function parseNameStatus(raw: string): Outcome<NameStatusEntry[]> {
  const records = splitNulRecords(raw);
  if (records.length % 2 !== 0) {
    return failure(`git diff --name-status の出力を解釈できません: ${JSON.stringify(raw)}`);
  }
  const entries: NameStatusEntry[] = [];
  for (let i = 0; i < records.length; i += 2) {
    entries.push({ status: records[i], path: records[i + 1] });
  }
  return { ok: true, value: entries };
}

function headSha(worktreePath: string): Outcome<string> {
  const result = git(['rev-parse', 'HEAD'], worktreePath);
  if (result.status !== 0) return failure(`git rev-parse HEAD に失敗しました: ${result.stderr.trim()}`);
  return { ok: true, value: result.stdout.trim() };
}

/**
 * 対象ブランチの remote 先頭を remote の実体から読む。ローカルの remote-tracking ref の鮮度に
 * 終了コード0の事後条件を依存させないため、`git ls-remote` を用いる。
 * `sha` が undefined の場合は remote に当該ブランチが存在しないことを表す。
 */
function readRemoteTip(worktreePath: string, branch: string): Outcome<string | undefined> {
  const ref = `refs/heads/${branch}`;
  const result = git(['ls-remote', 'origin', ref], worktreePath);
  if (result.status !== 0) {
    return failure(`git ls-remote origin ${ref} に失敗しました: ${result.stderr.trim()}`);
  }
  for (const line of result.stdout.split('\n')) {
    const [sha, name] = line.trim().split(/\s+/);
    if (name === ref && sha) return { ok: true, value: sha };
  }
  return { ok: true, value: undefined };
}

/** remote 先頭の commit をローカルで解決可能にする（祖先判定・tree 検査の前提）。 */
function ensureCommitPresent(worktreePath: string, branch: string, sha: string): string | undefined {
  const present = (): boolean => git(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], worktreePath).status === 0;
  if (present()) return undefined;
  const fetched = git(['fetch', '--no-tags', 'origin', `refs/heads/${branch}`], worktreePath);
  if (fetched.status !== 0) {
    return `remote 先頭 ${sha} を取得できません（git fetch --no-tags origin refs/heads/${branch}）: ${fetched.stderr.trim()}`;
  }
  if (!present()) return `remote 先頭 ${sha} をローカルへ取得できませんでした`;
  return undefined;
}

/** 指定 tree（commit-ish）直下に残存する root成果物を列挙する。 */
function artifactsInTree(worktreePath: string, commitish: string): Outcome<string[]> {
  const result = git(
    ['--literal-pathspecs', 'ls-tree', commitish, '-z', '--', ...ROOT_ARTIFACT_FILES],
    worktreePath,
  );
  if (result.status !== 0) {
    return failure(`git ls-tree ${commitish} に失敗しました: ${result.stderr.trim()}`);
  }
  const present: string[] = [];
  for (const record of splitNulRecords(result.stdout)) {
    const tab = record.indexOf('\t');
    if (tab < 0) return failure(`git ls-tree の出力を解釈できません: ${record}`);
    present.push(record.slice(tab + 1));
  }
  return { ok: true, value: present };
}

// ---- D2 実行文脈ガード ----

function resolveExecutionContext(
  root: string,
  config: AgentSkillChainConfig,
  issueId: string,
  issueNumber: string,
): Outcome<ExecutionContext> {
  const entry = findIssueWorktree(root, config, issueNumber);
  if (!entry) {
    return failure(`ISSUE-${issueNumber} に対応する worktree が見つかりません（issue start 済みか確認してください）`);
  }
  if (!entry.branch) {
    return failure(
      `対象worktree（${entry.path}）がブランチをチェックアウトしていません（detached HEAD）。commit先ブランチが確定しない状態では削除・commit・pushのいずれも行いません。`,
    );
  }

  let base: string;
  try {
    base = defaultBranch(root);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failure(`既定ブランチを特定できないため実行できません（誤って既定ブランチへcommitしないための停止）: ${detail}`);
  }
  if (entry.branch === base || entry.branch === base.replace(/^origin\//, '')) {
    return failure(
      `対象worktree（${entry.path}）が既定ブランチ '${entry.branch}' をチェックアウトしています。既定ブランチ root 直下の清掃は既存の別自動化（root-cleanup run）の担当であり、本コマンドは既定ブランチへ直接commitしません（1 Issue = 1 ブランチ = 1 PR）。Issueブランチをチェックアウトしたworktreeで実行してください。`,
    );
  }

  const tip = readRemoteTip(entry.path, entry.branch);
  if (!tip.ok) return tip;
  if (!tip.value) {
    return failure(
      `対象ブランチ '${entry.branch}' の remote 先頭が存在しません。終了コード0の事後条件をremoteの実体で定義できないため停止します。先に checkpoint を push してから再実行してください。`,
    );
  }
  const remoteSha = tip.value;

  const presence = ensureCommitPresent(entry.path, entry.branch, remoteSha);
  if (presence) return failure(presence);

  if (git(['merge-base', '--is-ancestor', remoteSha, 'HEAD'], entry.path).status !== 0) {
    return failure(
      `対象ブランチ '${entry.branch}' の remote 先頭（${remoteSha}）が local HEAD の祖先ではありません（remote先行または分岐）。本コマンドは force push・merge・rebase のいずれも行わないため、この状態からremoteを同期させる手段を持ちません。先に origin/${entry.branch} を取り込んでから再実行してください。`,
    );
  }

  const diff = git(
    ['--literal-pathspecs', 'diff', '--name-status', '-z', '--no-renames', remoteSha, 'HEAD', '--'],
    entry.path,
  );
  if (diff.status !== 0) {
    return failure(`git diff ${remoteSha} HEAD に失敗しました: ${diff.stderr.trim()}`);
  }
  const parsed = parseNameStatus(diff.stdout);
  if (!parsed.ok) return parsed;
  const unexpected = parsed.value.filter((e) => !(e.status === 'D' && TARGET_FILES.has(e.path)));
  if (unexpected.length > 0) {
    return failure(
      `remote 先頭（${remoteSha}）から local HEAD への差分に root成果物の削除以外が含まれます: ${unexpected
        .map((e) => `${e.status} ${e.path}`)
        .join(', ')}。未pushのcommitを本コマンドがremoteへ持ち込まないため停止します。先に checkpoint を push してから再実行してください。`,
    );
  }

  return { ok: true, value: { issueId, issueNumber, worktreePath: entry.path, branch: entry.branch } };
}

// ---- D3 writer lease の Issue 単位排他 ----

type LeaseHandle = { backend: 'local'; filePath: string } | { backend: 'github'; sha: string };

function leaseConflictMessage(issueNumber: string, descriptions: string[]): string {
  return [
    `ISSUE-${issueNumber} に writer lease が存在するため実行できません（1 Issueにつき同時1つのみ許可）。待機・強制解放・期限切れleaseの回収のいずれも行わずに停止します。`,
    ...descriptions.map((d) => `  - ${d}`),
    '保持者の作業完了を待つか、既存の回収経路（lease resume / lease reclaim / reconcile）で解放してから再実行してください。',
  ].join('\n');
}

/**
 * 対象 Issue の writer lease を Issue 単位で走査する。GitHub モードの lease 正本は
 * `<issue番号>-<segment>` という segment ごとに独立した ref であり、force 無し push の
 * compare-and-set は同一 ref の二重取得しか防がない。したがって Issue 単位の判定は
 * ref 走査（Issue 番号を prefix とする既存プリミティブ）が担う。segment 値は列挙しない。
 *
 * 走査そのものに失敗した場合は「lease 無し」と読み替えず失敗として返す（fail-closed）。
 */
function describeIssueLeases(
  issueNumber: string,
  root: string,
  excludeSegment?: string,
): Outcome<string[]> {
  const scan = listAllLeaseRefNames(root);
  if (!scan.ok) {
    return failure(`対象 Issue の writer lease を走査できませんでした（git ls-remote origin）: ${scan.stderr}`);
  }
  const refNames = scan.refs.filter((r) => r.issueNumber === issueNumber && r.segment !== excludeSegment);
  if (refNames.length === 0) return { ok: true, value: [] };

  const payloads = new Map(allLeasesFor(issueNumber, root).map((entry) => [entry.segment, entry]));
  return {
    ok: true,
    value: refNames.map(({ segment, ref }) => {
      const found = payloads.get(segment);
      return found
        ? `segment=${segment}, holder=${found.lease.writer_lease.holder}, expires_at=${found.lease.writer_lease.expires_at}`
        : `segment=${segment}（lease本体を読み取れません: ${ref}）`;
    }),
  };
}

function buildCleanupLease(issueId: string, ttlSeconds: number): WriterLease {
  const now = new Date();
  return {
    schema_version: 'agent-skill-chain/lease/v1',
    writer_lease: {
      issue_id: issueId,
      holder: `run-${crypto.randomBytes(4).toString('hex')}`,
      segment: CLEANUP_LEASE_SEGMENT,
      acquired_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
      token: crypto.randomBytes(16).toString('hex'),
    },
  };
}

/**
 * 排他性のためだけに writer lease を取得する。`lease acquire` サブコマンドが併せて行う
 * WIP上限判定・Issueラベル付与・Issueコメント投稿は行わない。本コマンドは既に受け入れ済みの
 * Issue に対する終端処理であり、上限到達時にマージ前削除が拒否されると本Issueの目的に反する
 * ためである。排他性は上限判定・可視性副作用ではなく Issue 単位走査が担う。
 */
function acquireIssueLease(
  root: string,
  config: AgentSkillChainConfig,
  issueId: string,
  issueNumber: string,
): Outcome<LeaseHandle> {
  const lease = buildCleanupLease(issueId, config.lease.ttl_seconds);
  const validation = validateAgainstSchema('lease', lease, root);
  if (!validation.valid) {
    return failure(`生成したleaseがスキーマに適合しません: ${validation.errors.join('; ')}`);
  }

  if (config.coordination.backend === 'local') {
    // ローカルモードの lease 正本は Issue につき1ファイルであり、その存在検査がそのまま
    // Issue 単位の判定になる。排他生成自体が Issue 単位の compare-and-set であるため、
    // 検査と取得の間の窓は存在せず再走査も行わない。
    const filePath = leaseFilePath(root, issueNumber);
    if (fs.existsSync(filePath)) {
      const existing = tryReadYamlFile<WriterLease>(filePath);
      return failure(
        leaseConflictMessage(issueNumber, [
          existing
            ? `segment=${existing.writer_lease.segment}, holder=${existing.writer_lease.holder}, expires_at=${existing.writer_lease.expires_at}`
            : `（lease本体を読み取れません: ${filePath}）`,
        ]),
      );
    }
    if (!writeYamlFileExclusive(filePath, lease)) {
      return failure(leaseConflictMessage(issueNumber, ['（検査直後に別プロセスが取得しました）']));
    }
    return { ok: true, value: { backend: 'local', filePath } };
  }

  const before = describeIssueLeases(issueNumber, root);
  if (!before.ok) return before;
  if (before.value.length > 0) return failure(leaseConflictMessage(issueNumber, before.value));

  const acquired = acquireLeaseRef(issueNumber, CLEANUP_LEASE_SEGMENT, lease, root);
  if (!acquired.ok) {
    return failure(
      acquired.reason === 'conflict'
        ? leaseConflictMessage(issueNumber, [`segment=${CLEANUP_LEASE_SEGMENT}（ref pushが競合により拒否されました）`])
        : `writer lease ref への push に失敗しました（権限または接続の問題の可能性があります）: ${acquired.stderr}`,
    );
  }

  // 検査と自ref取得の間の窓では本コマンドが必ず譲る。取得直後にもう一度走査し、自分以外の
  // leaseが1件でもあれば自分のleaseを解放して非ゼロ終了する（他主体を待たせない非対称な譲歩）。
  const after = describeIssueLeases(issueNumber, root, CLEANUP_LEASE_SEGMENT);
  if (!after.ok || after.value.length > 0) {
    const released = releaseLeaseRef(issueNumber, CLEANUP_LEASE_SEGMENT, root, acquired.sha);
    const releaseNote = released.ok
      ? ''
      : `\n自身の writer lease ref の解放にも失敗しました: ${released.stderr}`;
    return failure(
      (after.ok ? leaseConflictMessage(issueNumber, after.value) : after.error) + releaseNote,
    );
  }

  return { ok: true, value: { backend: 'github', sha: acquired.sha } };
}

function releaseIssueLease(root: string, issueNumber: string, handle: LeaseHandle): string | undefined {
  if (handle.backend === 'local') {
    try {
      fs.unlinkSync(handle.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      const detail = error instanceof Error ? error.message : String(error);
      return `writer lease（${handle.filePath}）の解放に失敗しました: ${detail}。手動で削除してから再実行してください。`;
    }
    return undefined;
  }
  const released = releaseLeaseRef(issueNumber, CLEANUP_LEASE_SEGMENT, root, handle.sha);
  if (!released.ok) {
    return `writer lease ref の解放に失敗しました: ${released.stderr}。'agent-skill-chain lease reclaim ISSUE-${issueNumber} ${CLEANUP_LEASE_SEGMENT} --confirm' で回収してください。`;
  }
  return undefined;
}

// ---- D1 観測 / D4 indexスコープ検査 / D5 削除ステージング / D6 完全一致検査 / D7 commit ----

function observeRootArtifacts(worktreePath: string): Outcome<RootArtifactStateEntry[]> {
  const headTree = git(
    ['--literal-pathspecs', 'ls-tree', 'HEAD', '-z', '--', ...ROOT_ARTIFACT_FILES],
    worktreePath,
  );
  if (headTree.status !== 0) return failure(`git ls-tree HEAD に失敗しました: ${headTree.stderr.trim()}`);
  const index = git(
    ['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', ...ROOT_ARTIFACT_FILES],
    worktreePath,
  );
  if (index.status !== 0) return failure(`git ls-files --stage に失敗しました: ${index.stderr.trim()}`);
  const status = git(['status', '--porcelain=v2', '-z', '--untracked-files=all'], worktreePath);
  if (status.status !== 0) return failure(`git status --porcelain=v2 に失敗しました: ${status.stderr.trim()}`);

  return {
    ok: true,
    value: classifyRootArtifacts({ headTree: headTree.stdout, index: index.stdout, status: status.stdout }),
  };
}

/** index と HEAD の差分に対象4ファイル以外のパスが含まれていないことを確認する。 */
function stagedOutOfScopePaths(worktreePath: string): Outcome<string[]> {
  const diff = git(
    ['--literal-pathspecs', 'diff', '--cached', '--name-only', '-z', '--no-renames', 'HEAD', '--'],
    worktreePath,
  );
  if (diff.status !== 0) return failure(`git diff --cached に失敗しました: ${diff.stderr.trim()}`);
  return { ok: true, value: splitNulRecords(diff.stdout).filter((p) => !TARGET_FILES.has(p)) };
}

/**
 * pathspec を対象4ファイルのリテラルへ限定して削除を index へ記録する。作業ツリー上に実体が
 * あるものは作業ツリーと index の双方から取り除かれる。既に index から取り除かれているものは
 * `git rm` の対象にできないため何もしない（削除は既に記録済みである）。pathspec がリテラル固定
 * であるため、対象外パスの未記録の変更・未追跡ファイルは構造的に巻き込めない。
 */
function stageDeletions(worktreePath: string, deletable: RootArtifactStateEntry[]): string | undefined {
  const tracked = deletable.filter((entry) => entry.inIndex).map((entry) => entry.file);
  if (tracked.length === 0) return undefined;
  const removed = git(['--literal-pathspecs', 'rm', '--quiet', '--', ...tracked], worktreePath);
  if (removed.status !== 0) return `git rm に失敗しました: ${removed.stderr.trim()}`;
  return undefined;
}

/**
 * commit 直前に index と HEAD の差分の実体を1点で検査する。分類結果を信用せず、
 * 「削除対象の集合と完全に一致し、かつ全エントリが削除である」ことを確認することで
 * 「削除のみで構成された commit」を構造的に保証する。
 */
function verifyStagedDeletionsOnly(worktreePath: string, expected: string[]): string | undefined {
  const diff = git(
    ['--literal-pathspecs', 'diff', '--cached', '--name-status', '-z', '--no-renames', 'HEAD', '--'],
    worktreePath,
  );
  if (diff.status !== 0) return `git diff --cached に失敗しました: ${diff.stderr.trim()}`;
  const parsed = parseNameStatus(diff.stdout);
  if (!parsed.ok) return parsed.error;

  const notDeletion = parsed.value.filter((e) => e.status !== 'D');
  if (notDeletion.length > 0) {
    return `index に削除以外の変更が含まれるためcommitしません: ${notDeletion.map((e) => `${e.status} ${e.path}`).join(', ')}`;
  }
  const actual = [...parsed.value.map((e) => e.path)].sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((p, i) => p !== wanted[i])) {
    return `indexへ記録された削除（${actual.join(', ') || 'なし'}）が削除対象（${wanted.join(', ')}）と一致しないためcommitしません`;
  }
  return undefined;
}

function commitDeletions(worktreePath: string, issueNumber: string): string | undefined {
  const identityError = ensureGitIdentity(worktreePath);
  if (identityError) return identityError;
  const committed = git(['commit', '-m', `${COMMIT_MESSAGE_PREFIX}${issueNumber}`], worktreePath);
  if (committed.status !== 0) return `git commit に失敗しました: ${committed.stderr.trim()}`;
  return undefined;
}

// ---- D8 remote 同期の確立と終了コード0の事後条件検査 ----

/**
 * 削除経路・no-op経路の双方が無条件に通る最終段。remote 先頭が local HEAD と一致していれば
 * push せず、一致していなければ push する。その後、remote 先頭・local HEAD の tree・対象worktree
 * の作業ツリーの3か所すべてに root成果物が1件も存在しないことを確認する。
 *
 * この段が無条件であるため、「ローカルでは削除済みだがremoteへ反映されていない」状態がno-opとして
 * 成功を返す経路を持たない。push が失敗した後の再実行は、実行文脈ガードが許す「差分は root成果物
 * の削除のみ」に該当し、本段の push で回復する（再実行自体が回復経路であり追加の分岐を持たない）。
 */
function establishRemoteSync(context: ExecutionContext): Outcome<{ pushed: boolean }> {
  const local = headSha(context.worktreePath);
  if (!local.ok) return local;

  const before = readRemoteTip(context.worktreePath, context.branch);
  if (!before.ok) return before;

  const pushRequired = before.value !== local.value;
  if (pushRequired) {
    const pushed = git(['push', 'origin', context.branch], context.worktreePath);
    if (pushed.status !== 0) {
      return failure(
        `git push に失敗しました（local HEAD ${local.value} は保持しています。原因を解消して本コマンドを再実行するとpushから再開します）: ${pushed.stderr.trim()}`,
      );
    }
  }

  const after = readRemoteTip(context.worktreePath, context.branch);
  if (!after.ok) return after;
  if (after.value !== local.value) {
    return failure(
      `対象ブランチ '${context.branch}' の remote 先頭（${after.value ?? '不在'}）が local HEAD（${local.value}）と一致しません。remoteが先行している可能性があります。原因を解消して再実行してください。`,
    );
  }

  const remoteTree = artifactsInTree(context.worktreePath, after.value);
  if (!remoteTree.ok) return remoteTree;
  const localTree = artifactsInTree(context.worktreePath, local.value);
  if (!localTree.ok) return localTree;
  const inWorktree = ROOT_ARTIFACT_FILES.filter((file) => fs.existsSync(path.join(context.worktreePath, file)));

  const residual: string[] = [];
  if (remoteTree.value.length > 0) residual.push(`remote先頭（${after.value}）のtree: ${remoteTree.value.join(', ')}`);
  if (localTree.value.length > 0) residual.push(`local HEAD（${local.value}）のtree: ${localTree.value.join(', ')}`);
  if (inWorktree.length > 0) residual.push(`作業ツリー（${context.worktreePath}）: ${inWorktree.join(', ')}`);
  if (residual.length > 0) {
    return failure(
      [
        'root成果物が残存しているため終了コード0を返しません（成功が残存を隠蔽しないための事後条件）:',
        ...residual.map((r) => `  - ${r}`),
        '残存の原因を解消してから再実行してください。',
      ].join('\n'),
    );
  }
  return { ok: true, value: { pushed: pushRequired } };
}

// ---- 判定順序の結線 ----

function performCleanup(context: ExecutionContext): number {
  const observed = observeRootArtifacts(context.worktreePath);
  if (!observed.ok) return fail(observed.error);

  const risky = observed.value.filter((entry) => entry.state === 'content_loss_risk');
  if (risky.length > 0) {
    return fail(
      [
        'Gitから復元できない内容を失わせないため停止します（削除・commit・pushのいずれも行っていません）:',
        ...risky.map((entry) => `  - ${entry.file}: ${entry.reason}`),
        '内容をcommitするか退避してから再実行してください。',
      ].join('\n'),
    );
  }

  const outOfScope = stagedOutOfScopePaths(context.worktreePath);
  if (!outOfScope.ok) return fail(outOfScope.error);
  if (outOfScope.value.length > 0) {
    return fail(
      `対象4ファイル以外のパスがindexへ記録されており、commitへ含まれてしまうため停止します（削除・commit・pushのいずれも行っていません）: ${outOfScope.value.join(', ')}。対象外の変更をindexから外してから再実行してください。`,
    );
  }

  const deletable = observed.value.filter((entry) => entry.state === 'deletable');
  if (deletable.length > 0) {
    const staged = stageDeletions(context.worktreePath, deletable);
    if (staged) return fail(staged);
    const verified = verifyStagedDeletionsOnly(context.worktreePath, deletable.map((entry) => entry.file));
    if (verified) return fail(verified);
    const committed = commitDeletions(context.worktreePath, context.issueNumber);
    if (committed) return fail(committed);
  }

  const synced = establishRemoteSync(context);
  if (!synced.ok) return fail(synced.error);

  if (deletable.length === 0) {
    // 通常のno-opではpushは発生しない。pushが発生するのは直前の実行がpushを完了できなかった
    // 場合だけであり、そこでも新たなcommitは作らない（変わるのはremoteのrefだけである）。
    return ok(
      synced.value.pushed
        ? '新たなcommitは作らず、remoteへ未反映だった対象ブランチのcommitをpushしました（対象4ファイルは作業ツリー・index・HEADのいずれにも存在しません）'
        : 'no-op（対象4ファイルは作業ツリー・index・HEADのいずれにも存在しません）',
    );
  }
  const sha = headSha(context.worktreePath);
  if (!sha.ok) return fail(sha.error);
  return ok(sha.value);
}

export async function branch(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(USAGE);
      return 0;
    }
    // 入力は issue_id ちょうど1個のみ。標準入力は一切読まない（不変条件 I5）。
    if (args.length !== 1) {
      throw new CliError(`引数は issue_id ちょうど1個です（受け取った引数: ${args.length}個）`);
    }
    const { issueId, number } = parseIssueId(args[0]);

    const root = repoRoot();
    const config = loadConfig(root);

    const context = resolveExecutionContext(root, config, issueId, number);
    if (!context.ok) return fail(context.error);

    const lease = acquireIssueLease(root, config, issueId, number);
    if (!lease.ok) return fail(lease.error);

    let releaseError: string | undefined;
    let code: number;
    try {
      code = performCleanup(context.value);
    } finally {
      releaseError = releaseIssueLease(root, number, lease.value);
    }
    if (releaseError) return fail(releaseError);
    return code;
  });
}
