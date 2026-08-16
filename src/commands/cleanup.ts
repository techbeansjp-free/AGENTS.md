import { repoRoot } from '../lib/paths.js';
import { loadConfig } from '../lib/config.js';
import { parseIssueId, CliError } from '../lib/issue.js';
import { findIssueWorktree, hasUncommittedChanges, inspectUnpushedCommits } from '../lib/worktree.js';
import { leaseFilePath, integrationFilePath } from '../lib/local-state.js';
import { tryReadYamlFile } from '../lib/yaml-io.js';
import { activeLeaseFor, type WriterLease } from '../lib/github-lease.js';
import { git, gh } from '../lib/exec.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';

const USAGE = `
使い方: agent-skill-chain cleanup <issue_id>

issue_id: ISSUE-<番号> 形式のIssue ID

出力:
  成功時: 終了コード0。削除したworktreeパスを標準出力へ。
  失敗時: 終了コード1以上。削除条件を満たさない理由（未完了PR等）を標準エラー出力へ。
`;

interface IntegrationRecord {
  status: 'draft' | 'ready_for_review' | 'merged' | 'closed';
}

interface PullRequestRecord {
  state: string;
  headRefOid?: string;
}

export async function run(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(USAGE);
      return 0;
    }
    const [issueIdRaw] = args;
    if (!issueIdRaw) throw new CliError('issue_id は必須です');
    const { number } = parseIssueId(issueIdRaw);

    const root = repoRoot();
    const config = loadConfig(root);

    const entry = findIssueWorktree(root, config, number);
    if (!entry) {
      throw new CliError(`ISSUE-${number} に対応する worktree が見つかりません（既に削除済みの可能性）`);
    }

    // standards/GIT_CONVENTIONS.md が定めるworktree削除の条件: 4条件をすべて満たした場合のみ削除する。
    const now = new Date().toISOString();
    const activeLease =
      config.coordination.backend === 'local'
        ? tryReadYamlFile<WriterLease>(leaseFilePath(root, number))?.writer_lease.expires_at
        : activeLeaseFor(number, 'spec', root) ??
          activeLeaseFor(number, 'design', root) ??
          activeLeaseFor(number, 'implementation', root) ??
          activeLeaseFor(number, 'validation', root) ??
          activeLeaseFor(number, 'adr_finalization', root);
    const hasActiveLease =
      config.coordination.backend === 'local' ? !!activeLease && activeLease > now : !!activeLease;
    if (hasActiveLease) {
      return fail('有効な writer lease が存在するため削除できません');
    }

    if (hasUncommittedChanges(entry.path)) {
      return fail('worktree 内に未commitの変更があるため削除できません');
    }

    let integrationDone = false;
    let pushedCommit: string | undefined;
    if (config.coordination.backend === 'local') {
      const record = tryReadYamlFile<IntegrationRecord>(integrationFilePath(root, number));
      integrationDone = record?.status === 'merged' || record?.status === 'closed';
    } else if (entry.branch) {
      const prView = gh(['pr', 'list', '--head', entry.branch, '--state', 'all', '--json', 'state,headRefOid'], root);
      if (prView.status === 0) {
        try {
          const prs = JSON.parse(prView.stdout) as PullRequestRecord[];
          const completed = prs.find((pr) => pr.state === 'MERGED' || pr.state === 'CLOSED');
          integrationDone = !!completed;
          pushedCommit = completed?.headRefOid;
        } catch {
          integrationDone = false;
        }
      }
    }
    if (entry.branch) {
      const unpushed = inspectUnpushedCommits(entry.path, entry.branch, pushedCommit);
      if (unpushed.hasUnpushedCommits && unpushed.reason === 'unpreserved_commits') {
        const shas = unpushed.commitShas.map((sha) => sha.slice(0, 12)).join(', ');
        return fail(
          `未pushのcommitがあるため削除できません（保全されていないcommit: ${unpushed.commitShas.length}件 ${shas}）`,
        );
      }
      if (unpushed.hasUnpushedCommits) {
        return fail(`commitの保全状況を確認できないため削除できません（${unpushed.detail}）`);
      }
    }

    if (!integrationDone) {
      return fail('対応する PR / Integration Record が完了済み（merged または closed）ではないため削除できません');
    }

    const remove = git(['worktree', 'remove', entry.path], root);
    if (remove.status !== 0) {
      return fail(`git worktree remove に失敗しました: ${remove.stderr.trim()}`);
    }
    git(['worktree', 'prune'], root);

    return ok(entry.path);
  });
}
