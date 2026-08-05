import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../lib/paths.js';
import { loadConfig } from '../lib/config.js';
import { parseIssueId, CliError } from '../lib/issue.js';
import { leaseFilePath } from '../lib/local-state.js';
import { tryReadYamlFile, writeYamlFileAtomic, writeYamlFileExclusive } from '../lib/yaml-io.js';
import { validateAgainstSchema } from '../lib/schema.js';
import {
  activeLeaseFor,
  activeLeasesFor,
  allLeasesFor,
  acquireLeaseRef,
  renewLeaseRef,
  resumeLeaseRef,
  releaseLeaseRef,
  postLeaseComment,
  postLeaseReclaimComment,
  cleanupLeaseComment,
  countActiveWriterLeaseIssues,
  markActiveWriterLeaseLabel,
  unmarkActiveWriterLeaseLabel,
  publicLease,
  type WriterLease,
} from '../lib/github-lease.js';
import {
  credentialFor,
  readLeaseCredential,
  removeLeaseCredential,
  tokensEqual,
  writeLeaseCredential,
} from '../lib/lease-credential.js';
import { findIssueWorktree, hasUncommittedChanges, hasUnpushedCommits } from '../lib/worktree.js';
import { git } from '../lib/exec.js';
import { toYamlString } from '../lib/yaml-io.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';

const ACQUIRE_USAGE = `
使い方: agent-skill-chain lease acquire <issue_id> <segment>

issue_id: ISSUE-<番号> 形式のIssue ID
segment:  spec|design|implementation|validation|adr_finalization

出力:
  成功時: 終了コード0。tokenを除いたwriter_leaseを標準出力へ。credentialはGit管理外へ0600で保存する。
  失敗時: 終了コード1以上。既存leaseと競合した場合はholder・expires_atを標準エラー出力へ。
`;

const RELEASE_USAGE = `
使い方: agent-skill-chain lease release <issue_id> [token]

出力:
  成功時: 終了コード0。解放したissue_idを標準出力へ。
  失敗時: 終了コード1以上。credential不一致等の理由を標準エラー出力へ。

token省略時はGit管理外のcredentialを使う。旧形式の移行時だけ引数または
AGENT_SKILL_CHAIN_LEASE_TOKEN環境変数で明示できる。
`;

const RENEW_USAGE = `
使い方: agent-skill-chain lease renew <issue_id> [token]

出力:
  成功時: 終了コード0。更新後のexpires_atを標準出力へ。
  失敗時: 終了コード1以上。credential不一致・lease期限切れの場合は理由を標準エラー出力へ。

token省略時はGit管理外のcredentialを使う。旧形式の移行時だけ引数または
AGENT_SKILL_CHAIN_LEASE_TOKEN環境変数で明示できる。
`;

const RESUME_USAGE = `
使い方: agent-skill-chain lease resume <issue_id> <segment> [legacy_token]

期限切れのGitHub writer leaseを、同一holderのcredentialと同一Issue専用dirty worktreeを
確認した場合だけCAS更新する。legacy_tokenは旧形式移行用であり、標準出力・標準エラーへ表示しない。
`;

const RECLAIM_USAGE = `
使い方: agent-skill-chain lease reclaim <issue_id> <segment> --confirm [--actor <value>]

期限切れのGitHub writer leaseを、credential不要の人間向け回収経路で削除する。
回収には --confirm が必須で、成功後はIssueへ監査コメントを投稿する。
`;

/**
 * WIP上限（wip.limit、既定3、有効writer lease数で判定）用: ローカルモードで全 Issue を横断し
 * `issues` 配下の各 Issue の lease.yaml のうち expires_at > now の件数を数える。
 */
function countLocalActiveWriterLeases(root: string): number {
  const issueLeaseRoot = path.join(root, `issues`);
  if (!fs.existsSync(issueLeaseRoot)) return 0;
  const now = new Date().toISOString();
  let count = 0;
  for (const entry of fs.readdirSync(issueLeaseRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const lease = tryReadYamlFile<WriterLease>(leaseFilePath(root, entry.name));
    if (lease && lease.writer_lease.expires_at > now) count++;
  }
  return count;
}

function buildLease(issueId: string, segment: string, ttlSeconds: number): WriterLease {
  const now = new Date();
  const expires = new Date(now.getTime() + ttlSeconds * 1000);
  return {
    schema_version: 'agent-skill-chain/lease/v1',
    writer_lease: {
      issue_id: issueId,
      holder: `run-${crypto.randomBytes(4).toString('hex')}`,
      segment,
      acquired_at: now.toISOString(),
      expires_at: expires.toISOString(),
      token: crypto.randomBytes(16).toString('hex'),
    },
  };
}

function resolveCredentialToken(root: string, issueNumber: string, explicit?: string): string | undefined {
  return explicit || process.env.AGENT_SKILL_CHAIN_LEASE_TOKEN || readLeaseCredential(root, issueNumber)?.token;
}

function rememberCredential(
  root: string,
  config: ReturnType<typeof loadConfig>,
  issueNumber: string,
  lease: WriterLease,
): void {
  const worktree = findIssueWorktree(root, config, issueNumber);
  writeLeaseCredential(root, credentialFor(lease, worktree));
}

export async function acquire(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(ACQUIRE_USAGE);
      return 0;
    }
    const [issueIdRaw, segment] = args;
    if (!issueIdRaw || !segment) throw new CliError('issue_id, segment はすべて必須です');
    const { issueId, number } = parseIssueId(issueIdRaw);

    const root = repoRoot();
    const config = loadConfig(root);
    const lease = buildLease(issueId, segment, config.lease.ttl_seconds);
    const outcome = validateAgainstSchema('lease', lease, root);
    if (!outcome.valid) return fail(`生成したleaseがスキーマに適合しません: ${outcome.errors.join('; ')}`);

    if (config.coordination.backend === 'local') {
      // ローカルモードは Issue 毎に lease.yaml が1ファイルのみのため、この排他生成が同一segment・
      // 他segmentいずれの競合検査も兼ねる（1 Issueにつき同時1つのwriter leaseのみ許可。DESIGN.md参照）。
      const filePath = leaseFilePath(root, number);
      const now = new Date().toISOString();

      // 1回目: 既存ファイル無しからの排他生成（O_CREAT|O_EXCL相当）を試みる。成功すれば
      // read-check-then-writeを経由しない真のcompare-and-setとして取得完了する。
      let created = writeYamlFileExclusive(filePath, lease);
      if (!created) {
        const existing = tryReadYamlFile<WriterLease>(filePath);
        if (existing && existing.writer_lease.expires_at > now) {
          return fail(
            `既存の writer lease と競合しています: holder=${existing.writer_lease.holder}, expires_at=${existing.writer_lease.expires_at}`,
          );
        }
        // 期限切れ（stale）のため回収し、1回だけ再試行する（無限リトライしない）。
        try {
          fs.unlinkSync(filePath);
        } catch {
          // 既に他プロセスが回収済みの可能性がある。後続の再試行の成否に委ねる。
        }
        created = writeYamlFileExclusive(filePath, lease);
        if (!created) {
          return fail('lease の回収中に別プロセスが再取得したため取得できませんでした（再試行してください）');
        }
      }

      // 取得成功後にWIP上限チェックを行う（自分自身を含めて数えるため、書込み前の`>=`判定と
      // 同値になるよう`>`で比較する。DESIGN.md参照）。超過していれば直前に書いたlease.yamlを
      // ロールバックする（advisoryなWIP上限のためのロールバックであり、1 Issue内の排他性という
      // 主目的の原子性には影響しない）。
      const activeCount = countLocalActiveWriterLeases(root);
      if (activeCount > config.wip.limit) {
        fs.unlinkSync(filePath);
        return fail(
          `WIP上限（wip.limit=${config.wip.limit}）に達しているため writer lease を取得できません（現在の有効writer lease数: ${activeCount - 1}）`,
        );
      }
      rememberCredential(root, config, number, lease);
      return ok(toYamlString(publicLease(lease)).trim());
    }

    // 事前チェック（fail-fast用）: 既に有効なleaseが存在すれば、refへのpushを試みるまでもなく
    // 速やかに競合として拒否する。実際の排他性の担保はこの事前チェックではなく、後続の
    // acquireLeaseRef（refへのforce無しpush、ADR-0002）が担う——事前チェックと押下の間に他プロセスが
    // 先取りした場合も、pushのfast-forward拒否によって二重取得は発生しない（AC-1）。
    const conflict = activeLeaseFor(number, segment, root);
    if (conflict) {
      return fail(
        `既存の writer lease と競合しています: holder=${conflict.lease.writer_lease.holder}, expires_at=${conflict.lease.writer_lease.expires_at}`,
      );
    }
    // 1 Issueにつき同時1つのwriter leaseのみ許可する（AGENTS.md の役割・権限・writer lease の定義）。
    // activeLeaseFor は同一segmentのみを判定するため、同一Issue内の他segmentの有効leaseを
    // 別途検出する（segment start が活用する activeLeaseFor 自体のスコープは変更しない）。
    const crossSegmentConflict = activeLeasesFor(number, root).find((c) => c.lease.writer_lease.segment !== segment);
    if (crossSegmentConflict) {
      return fail(
        `ISSUE内の他segment（${crossSegmentConflict.lease.writer_lease.segment}）に有効な writer lease が存在するため取得できません（1 Issueにつき同時1つのみ許可）: holder=${crossSegmentConflict.lease.writer_lease.holder}, expires_at=${crossSegmentConflict.lease.writer_lease.expires_at}`,
      );
    }
    const activeCount = countActiveWriterLeaseIssues(root);
    if (activeCount >= config.wip.limit) {
      return fail(
        `WIP上限（wip.limit=${config.wip.limit}）に達しているため writer lease を取得できません（現在の有効writer lease数: ${activeCount}）`,
      );
    }

    const acquired = acquireLeaseRef(number, segment, lease, root);
    if (!acquired.ok) {
      if (acquired.reason === 'conflict') {
        // push時点で真の競合が検出された（事前チェックをすり抜けた真の並行acquireのケース）。
        const rival = activeLeaseFor(number, segment, root);
        return fail(
          rival
            ? `既存の writer lease と競合しています（ref pushで検出）: holder=${rival.lease.writer_lease.holder}, expires_at=${rival.lease.writer_lease.expires_at}`
            : 'writer lease ref への push が競合により拒否されました（既に他プロセスが取得済みの可能性があります）',
        );
      }
      return fail(`writer lease ref への push に失敗しました（権限または接続の問題の可能性があります）: ${acquired.stderr}`);
    }

    // Issueコメントへの投稿はhuman向け可視性のためのbest-effort処理であり、正本（git ref）の
    // 取得成否には影響させない（ADR-0002）。
    try {
      postLeaseComment(number, lease, root);
    } catch {
      // best-effort: 可視性コメントの投稿失敗はlease取得自体の成功を妨げない。
    }
    // WIP上限判定用ラベル付与（best-effort。失敗してもlease自体の取得成功を妨げない）。
    markActiveWriterLeaseLabel(number, root);
    rememberCredential(root, config, number, lease);
    return ok(toYamlString(publicLease(lease)).trim());
  });
}

export async function release(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(RELEASE_USAGE);
      return 0;
    }
    const [issueIdRaw, explicitToken] = args;
    if (!issueIdRaw) throw new CliError('issue_id は必須です');
    const { number } = parseIssueId(issueIdRaw);

    const root = repoRoot();
    const config = loadConfig(root);
    const token = resolveCredentialToken(root, number, explicitToken);
    if (!token) return fail('writer lease credential が見つかりません（human_required）');

    if (config.coordination.backend === 'local') {
      const existing = tryReadYamlFile<WriterLease>(leaseFilePath(root, number));
      if (!existing) return fail('解放対象の writer lease が存在しません');
      if (!tokensEqual(existing.writer_lease.token, token)) return fail('writer lease credential が一致しません');
      fs.unlinkSync(leaseFilePath(root, number));
      removeLeaseCredential(root, number);
      return ok(issueIdRaw);
    }

    const held = allLeasesFor(number, root).find((c) => tokensEqual(c.lease.writer_lease.token, token));
    if (!held) return fail('writer lease credential が一致するleaseが見つかりません');
    const released = releaseLeaseRef(number, held.segment, root, held.sha);
    if (!released.ok) {
      return fail(`writer lease ref の削除に失敗しました: ${released.stderr}`);
    }
    // best-effort: acquire時に投稿した可視性コメントの削除（lease自体の解放成否には影響しない）。
    cleanupLeaseComment(number, held.lease.writer_lease.holder, root);
    // WIP上限判定用ラベル除去（best-effort）。
    unmarkActiveWriterLeaseLabel(number, root);
    removeLeaseCredential(root, number);
    return ok(issueIdRaw);
  });
}

export async function renew(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(RENEW_USAGE);
      return 0;
    }
    const [issueIdRaw, explicitToken] = args;
    if (!issueIdRaw) throw new CliError('issue_id は必須です');
    const { number } = parseIssueId(issueIdRaw);

    const root = repoRoot();
    const config = loadConfig(root);
    const token = resolveCredentialToken(root, number, explicitToken);
    if (!token) return fail('writer lease credential が見つかりません（human_required）');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.lease.ttl_seconds * 1000).toISOString();

    if (config.coordination.backend === 'local') {
      const existing = tryReadYamlFile<WriterLease>(leaseFilePath(root, number));
      if (!existing) return fail('更新対象の writer lease が存在しません');
      if (!tokensEqual(existing.writer_lease.token, token)) return fail('writer lease credential が一致しません');
      if (existing.writer_lease.expires_at <= now.toISOString()) {
        return fail(`lease は既に期限切れです（expires_at=${existing.writer_lease.expires_at}）`);
      }
      existing.writer_lease.expires_at = expiresAt;
      writeYamlFileAtomic(leaseFilePath(root, number), existing);
      return ok(expiresAt);
    }

    const held = allLeasesFor(number, root).find((c) => tokensEqual(c.lease.writer_lease.token, token));
    if (!held) return fail('writer lease credential が一致するleaseが見つかりません');
    if (held.lease.writer_lease.expires_at <= now.toISOString()) {
      return fail(`lease は既に期限切れです（expires_at=${held.lease.writer_lease.expires_at}）`);
    }
    const updatedLease: WriterLease = {
      ...held.lease,
      writer_lease: { ...held.lease.writer_lease, expires_at: expiresAt },
    };
    const renewed = renewLeaseRef(number, held.segment, updatedLease, root, held.sha);
    if (!renewed.ok) {
      return fail(
        renewed.reason === 'conflict'
          ? `renew に失敗しました（他プロセスがrefを更新済みの可能性があります）: ${renewed.stderr}`
          : `writer lease ref への push に失敗しました（権限または接続の問題の可能性があります）: ${renewed.stderr}`,
      );
    }
    return ok(expiresAt);
  });
}

export async function resume(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(RESUME_USAGE);
      return 0;
    }
    const [issueIdRaw, segment, legacyToken] = args;
    if (!issueIdRaw || !segment) throw new CliError('issue_id, segment はすべて必須です');
    const { issueId, number } = parseIssueId(issueIdRaw);
    const root = repoRoot();
    const config = loadConfig(root);
    if (config.coordination.backend !== 'github') {
      return fail('lease resume はGitHub Coordination Backendでのみ利用できます');
    }

    const existing = allLeasesFor(number, root).find((entry) => entry.segment === segment);
    if (!existing) return fail('再開対象の writer lease が見つかりません（human_required）');
    const now = new Date();
    if (existing.lease.writer_lease.expires_at > now.toISOString()) {
      return fail(
        `writer lease は期限内です: holder=${existing.lease.writer_lease.holder}, expires_at=${existing.lease.writer_lease.expires_at}`,
      );
    }
    if (
      existing.lease.writer_lease.issue_id !== issueId ||
      existing.lease.writer_lease.segment !== segment
    ) {
      return fail('writer lease のIssueまたはsegmentが一致しません（human_required）');
    }

    const credential = readLeaseCredential(root, number);
    const token = resolveCredentialToken(root, number, legacyToken);
    if (!token || !tokensEqual(existing.lease.writer_lease.token, token)) {
      return fail('同一holderの writer lease credential を確認できません（human_required）');
    }
    if (
      credential &&
      (credential.issue_id !== issueId ||
        credential.segment !== segment ||
        credential.holder !== existing.lease.writer_lease.holder ||
        !tokensEqual(credential.token, token))
    ) {
      return fail('writer lease credential のholderまたは作業識別情報が一致しません（human_required）');
    }

    const worktree = findIssueWorktree(root, config, number);
    if (!worktree?.branch) {
      return fail('Issue専用worktreeまたはbranchを確認できません（human_required）');
    }
    if (
      credential?.worktree_path &&
      path.resolve(credential.worktree_path) !== path.resolve(worktree.path)
    ) {
      return fail('writer lease credential のworktreeが一致しません（human_required）');
    }
    if (credential?.branch && credential.branch !== worktree.branch) {
      return fail('writer lease credential のbranchが一致しません（human_required）');
    }
    const dirty =
      hasUncommittedChanges(worktree.path) ||
      hasUnpushedCommits(worktree.path, worktree.branch);
    if (!dirty) {
      return fail('Issue専用worktreeに未commitまたは未pushの変更がありません（human_required）');
    }

    const expiresAt = new Date(now.getTime() + config.lease.ttl_seconds * 1000).toISOString();
    const resumedLease: WriterLease = {
      schema_version: 'agent-skill-chain/lease/v1',
      writer_lease: {
        ...existing.lease.writer_lease,
        acquired_at: now.toISOString(),
        expires_at: expiresAt,
        token: crypto.randomBytes(16).toString('hex'),
      },
    };
    const validation = validateAgainstSchema('lease', resumedLease, root);
    if (!validation.valid) {
      return fail(`再開用leaseがスキーマに適合しません: ${validation.errors.join('; ')}`);
    }
    const resumed = resumeLeaseRef(number, segment, existing.sha, resumedLease, root);
    if (!resumed.ok) {
      return fail(
        resumed.reason === 'conflict'
          ? 'resumeに失敗しました（検査後にrefが更新されています、human_required）'
          : `resume用 writer lease ref の更新に失敗しました: ${resumed.stderr}`,
      );
    }

    rememberCredential(root, config, number, resumedLease);
    cleanupLeaseComment(number, existing.lease.writer_lease.holder, root);
    try {
      postLeaseComment(number, resumedLease, root);
    } catch {
      // best-effort: refのCAS成功を可視性コメントの失敗で取り消さない。
    }
    markActiveWriterLeaseLabel(number, root);
    return ok(toYamlString(publicLease(resumedLease)).trim());
  });
}

export async function reclaim(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(RECLAIM_USAGE);
      return 0;
    }
    const [issueIdRaw, segment] = args;
    if (!issueIdRaw || !segment) throw new CliError('issue_id, segment はすべて必須です');
    const { number } = parseIssueId(issueIdRaw);
    const root = repoRoot();
    const config = loadConfig(root);
    if (config.coordination.backend !== 'github') {
      return fail('lease reclaim はGitHub Coordination Backendでのみ利用できます');
    }
    if (!args.includes('--confirm')) {
      return fail('`--confirm` オプションを付けて再実行してください');
    }

    const existing = allLeasesFor(number, root).find((entry) => entry.segment === segment);
    if (!existing) {
      return fail('対象の writer lease が見つかりません（既に回収済み、または issue_id/segment 指定誤りの可能性があります）');
    }
    const now = new Date().toISOString();
    if (existing.lease.writer_lease.expires_at > now) {
      return fail(
        `writer lease は期限内です: holder=${existing.lease.writer_lease.holder}, expires_at=${existing.lease.writer_lease.expires_at}`,
      );
    }

    const released = releaseLeaseRef(number, segment, root, existing.sha);
    if (!released.ok) {
      return fail(
        released.reason === 'conflict'
          ? '回収に失敗しました（検査後にrefが更新されています）'
          : `writer lease ref の削除に失敗しました: ${released.stderr}`,
      );
    }

    // ref削除後は、releaseと同じく有効leaseの可視性情報もbest-effortで片付ける。
    cleanupLeaseComment(number, existing.lease.writer_lease.holder, root);
    unmarkActiveWriterLeaseLabel(number, root);

    const actorFlagIndex = args.indexOf('--actor');
    const explicitActor = actorFlagIndex === -1 ? undefined : args[actorFlagIndex + 1];
    const configuredActor = git(['config', 'user.name'], root);
    const actor =
      (explicitActor && !explicitActor.startsWith('--') ? explicitActor : undefined) ||
      (configuredActor.status === 0 ? configuredActor.stdout.trim() : '') ||
      'unknown-operator';

    try {
      postLeaseReclaimComment(number, actor, existing.lease.writer_lease.holder, segment, root);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return fail(
        `ref削除は成功したが監査コメント投稿に失敗しました。手動で gh issue comment を実行してください: ${detail}`,
      );
    }
    return ok(
      `writer lease を回収しました: issue_id=${issueIdRaw}, segment=${segment}, previous_holder=${existing.lease.writer_lease.holder}`,
    );
  });
}
