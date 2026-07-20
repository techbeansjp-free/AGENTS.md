import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../lib/paths.js';
import { loadConfig } from '../lib/config.js';
import { parseIssueId, CliError } from '../lib/issue.js';
import { leaseFilePath } from '../lib/local-state.js';
import { tryReadYamlFile, writeYamlFileAtomic } from '../lib/yaml-io.js';
import { validateAgainstSchema } from '../lib/schema.js';
import {
  activeLeaseFor,
  activeLeasesFor,
  postLeaseComment,
  deleteLeaseComment,
  listLeaseComments,
  countActiveWriterLeaseIssues,
  markActiveWriterLeaseLabel,
  unmarkActiveWriterLeaseLabel,
  type WriterLease,
} from '../lib/github-lease.js';
import { toYamlString } from '../lib/yaml-io.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';

const ACQUIRE_USAGE = `
使い方: agent-skill-chain lease acquire <issue_id> <segment>

issue_id: ISSUE-<番号> 形式のIssue ID
segment:  spec|design|implementation|validation|adr_finalization

出力:
  成功時: 終了コード0。schemas/lease.schema.yaml準拠のwriter_lease（token含む）を標準出力へ。
  失敗時: 終了コード1以上。既存leaseと競合した場合はholder・expires_atを標準エラー出力へ。
`;

const RELEASE_USAGE = `
使い方: agent-skill-chain lease release <issue_id> <token>

出力:
  成功時: 終了コード0。解放したissue_idを標準出力へ。
  失敗時: 終了コード1以上。token不一致等の理由を標準エラー出力へ。
`;

const RENEW_USAGE = `
使い方: agent-skill-chain lease renew <issue_id> <token>

出力:
  成功時: 終了コード0。更新後のexpires_atを標準出力へ。
  失敗時: 終了コード1以上。token不一致・lease期限切れの場合は理由を標準エラー出力へ。
`;

/**
 * WIP上限（wip.limit、既定3、有効writer lease数で判定）用: ローカルモードで全 issue を横断し
 * issues 配下各issueの lease.yaml のうち expires_at > now の件数を数える。
 */
function countLocalActiveWriterLeases(root: string): number {
  const issuesDir = path.join(root, 'issues');
  if (!fs.existsSync(issuesDir)) return 0;
  const now = new Date().toISOString();
  let count = 0;
  for (const entry of fs.readdirSync(issuesDir, { withFileTypes: true })) {
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
      const existing = tryReadYamlFile<WriterLease>(leaseFilePath(root, number));
      const now = new Date().toISOString();
      if (existing && existing.writer_lease.expires_at > now) {
        // ローカルモードは issue 毎に lease.yaml が1ファイルのみのため、この検査が同一segment・
        // 他segmentいずれの競合も兼ねる（1 Issueにつき同時1つのwriter leaseのみ許可。DESIGN.md参照）。
        return fail(
          `既存の writer lease と競合しています: holder=${existing.writer_lease.holder}, expires_at=${existing.writer_lease.expires_at}`,
        );
      }
      const activeCount = countLocalActiveWriterLeases(root);
      if (activeCount >= config.wip.limit) {
        return fail(
          `WIP上限（wip.limit=${config.wip.limit}）に達しているため writer lease を取得できません（現在の有効writer lease数: ${activeCount}）`,
        );
      }
      writeYamlFileAtomic(leaseFilePath(root, number), lease);
      return ok(toYamlString(lease).trim());
    }

    const conflict = activeLeaseFor(number, segment, root);
    if (conflict) {
      return fail(
        `既存の writer lease と競合しています: holder=${conflict.lease.writer_lease.holder}, expires_at=${conflict.lease.writer_lease.expires_at}`,
      );
    }
    // 1 Issueにつき同時1つのwriter leaseのみ許可する（AGENTS.md §役割・権限・writer lease）。
    // activeLeaseFor は同一segmentのみを判定するため、同issue内の他segmentの有効leaseを
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
    const commentId = postLeaseComment(number, lease, root);
    // 楽観的排他制御: 投稿直後に再確認し、より古い（=先着の）アクティブleaseが他にあれば取得を撤回する。
    const rivals = listLeaseComments(number, root).filter(
      (c) => c.lease.writer_lease.segment === segment && c.lease.writer_lease.token !== lease.writer_lease.token,
    );
    const now = new Date().toISOString();
    // 「自分より先に acquire を開始していた」rival = 相手のコメント投稿がこちらの
    // lease生成時刻（acquired_at、投稿前に確定済み）より前であるもの。
    const olderActiveRival = rivals.find(
      (r) => r.lease.writer_lease.expires_at > now && r.createdAt < lease.writer_lease.acquired_at,
    );
    if (olderActiveRival) {
      deleteLeaseComment(commentId, root);
      return fail(
        `投稿直後に競合を検出したため取得を撤回しました: holder=${olderActiveRival.lease.writer_lease.holder}`,
      );
    }
    // WIP上限判定用ラベル付与（best-effort。失敗してもlease自体の取得成功を妨げない）。
    markActiveWriterLeaseLabel(number, root);
    return ok(toYamlString(lease).trim());
  });
}

export async function release(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(RELEASE_USAGE);
      return 0;
    }
    const [issueIdRaw, token] = args;
    if (!issueIdRaw || !token) throw new CliError('issue_id, token はすべて必須です');
    const { number } = parseIssueId(issueIdRaw);

    const root = repoRoot();
    const config = loadConfig(root);

    if (config.coordination.backend === 'local') {
      const existing = tryReadYamlFile<WriterLease>(leaseFilePath(root, number));
      if (!existing) return fail('解放対象の writer lease が存在しません');
      if (existing.writer_lease.token !== token) return fail('token が一致しません');
      fs.unlinkSync(leaseFilePath(root, number));
      return ok(issueIdRaw);
    }

    const held = listLeaseComments(number, root).find((c) => c.lease.writer_lease.token === token);
    if (!held) return fail('token が一致する writer lease が見つかりません');
    deleteLeaseComment(held.commentId, root);
    // WIP上限判定用ラベル除去（best-effort）。
    unmarkActiveWriterLeaseLabel(number, root);
    return ok(issueIdRaw);
  });
}

export async function renew(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(RENEW_USAGE);
      return 0;
    }
    const [issueIdRaw, token] = args;
    if (!issueIdRaw || !token) throw new CliError('issue_id, token はすべて必須です');
    const { number } = parseIssueId(issueIdRaw);

    const root = repoRoot();
    const config = loadConfig(root);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.lease.ttl_seconds * 1000).toISOString();

    if (config.coordination.backend === 'local') {
      const existing = tryReadYamlFile<WriterLease>(leaseFilePath(root, number));
      if (!existing) return fail('更新対象の writer lease が存在しません');
      if (existing.writer_lease.token !== token) return fail('token が一致しません');
      if (existing.writer_lease.expires_at <= now.toISOString()) {
        return fail(`lease は既に期限切れです（expires_at=${existing.writer_lease.expires_at}）`);
      }
      existing.writer_lease.expires_at = expiresAt;
      writeYamlFileAtomic(leaseFilePath(root, number), existing);
      return ok(expiresAt);
    }

    const held = listLeaseComments(number, root).find((c) => c.lease.writer_lease.token === token);
    if (!held) return fail('token が一致する writer lease が見つかりません');
    if (held.lease.writer_lease.expires_at <= now.toISOString()) {
      return fail(`lease は既に期限切れです（expires_at=${held.lease.writer_lease.expires_at}）`);
    }
    held.lease.writer_lease.expires_at = expiresAt;
    deleteLeaseComment(held.commentId, root);
    postLeaseComment(number, held.lease, root);
    return ok(expiresAt);
  });
}
