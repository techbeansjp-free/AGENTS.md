import { repoRoot } from '../lib/paths.js';
import { loadConfig } from '../lib/config.js';
import { parseIssueId, CliError } from '../lib/issue.js';
import { defaultBranch } from '../lib/worktree.js';
import { integrationFilePath } from '../lib/local-state.js';
import { tryReadYamlFile, writeYamlFileAtomic } from '../lib/yaml-io.js';
import { validateAgainstSchema } from '../lib/schema.js';
import { gh } from '../lib/exec.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';

const USAGE = `
使い方: agent-skill-chain pr create <issue_id> <branch>

branch: Draft PR / Integration Recordの対象ブランチ名

出力:
  成功時: 終了コード0。作成したPR URLまたはIntegration Recordパスを標準出力へ。
  失敗時: 終了コード1以上。理由を標準エラー出力へ。
`;

interface IntegrationRecord {
  schema_version: string;
  issue_id: string;
  branch: string;
  pr_url?: string;
  status: 'draft' | 'ready_for_review' | 'merged' | 'closed';
  closes: string;
  gates: {
    spec: 'pending' | 'approved' | 'rejected';
    design: 'pending' | 'approved' | 'rejected';
    implementation: 'pending' | 'approved' | 'rejected';
    validation: 'pending' | 'approved' | 'rejected';
  };
}

export async function create(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(USAGE);
      return 0;
    }
    const [issueIdRaw, branch] = args;
    if (!issueIdRaw || !branch) throw new CliError('issue_id, branch はすべて必須です');
    const { issueId, number } = parseIssueId(issueIdRaw);

    const root = repoRoot();
    const config = loadConfig(root);

    if (config.coordination.backend === 'local') {
      const existing = tryReadYamlFile<IntegrationRecord>(integrationFilePath(root, number));
      if (existing) {
        return fail(`Integration Record は既に存在します（status=${existing.status}）: ${integrationFilePath(root, number)}`);
      }
      const record: IntegrationRecord = {
        schema_version: 'agent-skill-chain/integration/v1',
        issue_id: issueId,
        branch,
        status: 'draft',
        closes: issueId,
        gates: { spec: 'pending', design: 'pending', implementation: 'pending', validation: 'pending' },
      };
      const outcome = validateAgainstSchema('integration', record, root);
      if (!outcome.valid) return fail(`Integration Record がスキーマに適合しません: ${outcome.errors.join('; ')}`);
      const dest = integrationFilePath(root, number);
      writeYamlFileAtomic(dest, record);
      return ok(dest);
    }

    const base = defaultBranch(root);
    const title = `${issueId}: ${branch.replace(/^[a-z]+\//, '').replace(/-/g, ' ')}`;
    const result = gh(
      ['pr', 'create', '--draft', '--head', branch, '--base', base, '--title', title, '--body', `Closes #${number}`],
      root,
    );
    if (result.status !== 0) return fail(`gh pr create に失敗しました: ${result.stderr.trim()}`);
    return ok(result.stdout.trim());
  });
}
