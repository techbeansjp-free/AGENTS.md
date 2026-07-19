import { repoRoot } from '../lib/paths.js';
import { loadConfig } from '../lib/config.js';
import { parseIssueId, validateSegment, CliError } from '../lib/issue.js';
import { leaseFilePath } from '../lib/local-state.js';
import { tryReadYamlFile, toYamlString } from '../lib/yaml-io.js';
import { activeLeaseFor, type WriterLease } from '../lib/github-lease.js';
import { loadRoles } from '../lib/roles.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';

const USAGE = `
使い方: agent-skill-chain segment start <issue_id> <segment>

issue_id: ISSUE-<番号> 形式のIssue ID
segment:  spec|design|implementation|validation

出力:
  成功時: 終了コード0。起動したワーカーの役割名・role_contractを標準出力へ。
  失敗時: 終了コード1以上。writer lease未取得等の理由を標準エラー出力へ。
`;

const SEGMENT_TO_ROLE: Record<string, string> = {
  spec: 'spec_worker',
  design: 'design_worker',
  implementation: 'implementation_worker',
  validation: 'validation_worker',
};

export async function start(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(USAGE);
      return 0;
    }
    const [issueIdRaw, segment] = args;
    if (!issueIdRaw || !segment) throw new CliError('issue_id, segment はすべて必須です');
    const { number } = parseIssueId(issueIdRaw);
    validateSegment(segment);

    const root = repoRoot();
    const config = loadConfig(root);
    const now = new Date().toISOString();

    const hasActiveLease =
      config.coordination.backend === 'local'
        ? (() => {
            const existing = tryReadYamlFile<WriterLease>(leaseFilePath(root, number));
            return !!existing && existing.writer_lease.segment === segment && existing.writer_lease.expires_at > now;
          })()
        : !!activeLeaseFor(number, segment, root);

    if (!hasActiveLease) {
      return fail(`ISSUE-${number} の segment '${segment}' に有効な writer lease がありません（先に lease acquire を実行してください）`);
    }

    const role = SEGMENT_TO_ROLE[segment];
    const roles = loadRoles(root);
    const contract = roles.role_contracts[role];
    if (!contract) return fail(`config/roles.yaml に role_contracts.${role} が定義されていません`);

    return ok(`role: ${role}\n${toYamlString(contract).trim()}`);
  });
}
