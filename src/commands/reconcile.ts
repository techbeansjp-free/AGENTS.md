import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../lib/paths.js';
import { loadConfig } from '../lib/config.js';
import { findIssueWorktree, hasUncommittedChanges, hasUnpushedCommits, listWorktrees } from '../lib/worktree.js';
import { leaseFilePath } from '../lib/local-state.js';
import { tryReadYamlFile } from '../lib/yaml-io.js';
import { allLeasesFor, releaseLeaseRef, type WriterLease } from '../lib/github-lease.js';
import { isHelp, printUsage, guard, ok } from '../lib/cli-io.js';

const USAGE = `
使い方: agent-skill-chain reconcile

引数なし。全Issueを走査する。

出力:
  成功時: 終了コード0。回収したlease・人間判断へ昇格した件の一覧を標準出力へ。
  失敗時: 終了コード1以上。理由を標準エラー出力へ。
`;

function isSafeToReclaim(root: string, config: ReturnType<typeof loadConfig>, issueNumber: string): boolean {
  const entry = findIssueWorktree(root, config, issueNumber);
  if (!entry) return true; // worktree自体が既に無い = 保護すべき未push状態も無い
  if (hasUncommittedChanges(entry.path)) return false;
  if (entry.branch && hasUnpushedCommits(entry.path, entry.branch)) return false;
  return true;
}

export async function run(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(USAGE);
      return 0;
    }
    const root = repoRoot();
    const config = loadConfig(root);
    const now = new Date().toISOString();
    const reclaimed: string[] = [];
    const escalated: string[] = [];

    if (config.coordination.backend === 'local') {
      const issueLeaseRoot = path.join(root, `issues`);
      const issueNumbers = fs.existsSync(issueLeaseRoot) ? fs.readdirSync(issueLeaseRoot) : [];
      for (const issueNumber of issueNumbers) {
        const lease = tryReadYamlFile<WriterLease>(leaseFilePath(root, issueNumber));
        if (!lease || lease.writer_lease.expires_at > now) continue;
        const label = `ISSUE-${issueNumber}:${lease.writer_lease.segment}`;
        if (isSafeToReclaim(root, config, issueNumber)) {
          fs.unlinkSync(leaseFilePath(root, issueNumber));
          reclaimed.push(label);
        } else {
          escalated.push(`${label}（未push/未commitの変更が残存、human_required）`);
        }
      }
    } else {
      const issueNumbers = new Set<string>();
      for (const entry of listWorktrees(root)) {
        const match = /-(\d+)-[a-z0-9-]+\/?$/.exec(path.basename(entry.path));
        if (match) issueNumbers.add(match[1]);
      }
      for (const issueNumber of issueNumbers) {
        // ref-based lock（ADR-0002）ではsegmentごとにref自体が1つしか存在し得ないため、
        // 同一segmentで複数の有効leaseが競合する状態は構造的に発生しない
        // （旧・Issueコメントベース実装で存在した「複数の有効leaseが競合」escalationは不要になった）。
        const leases = allLeasesFor(issueNumber, root);
        for (const l of leases) {
          const label = `ISSUE-${issueNumber}:${l.segment}`;
          if (l.lease.writer_lease.expires_at > now) continue; // 有効なleaseはそのまま
          if (isSafeToReclaim(root, config, issueNumber)) {
            const released = releaseLeaseRef(issueNumber, l.segment, root);
            if (released.ok) reclaimed.push(label);
            // 削除に失敗した場合は次回reconcileに委ねる（reclaimed/escalatedいずれにも計上しない）。
          } else {
            escalated.push(`${label}（未push/未commitの変更が残存、human_required）`);
          }
        }
      }
    }

    return ok(
      [`reclaimed: ${reclaimed.join(', ') || '(none)'}`, `escalated: ${escalated.join(', ') || '(none)'}`].join('\n'),
    );
  });
}
