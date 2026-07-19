import { stringify } from 'yaml';
import { repoRoot } from '../lib/paths.js';
import { loadConfig } from '../lib/config.js';
import { parseIssueId, CliError } from '../lib/issue.js';
import { reportFilePath } from '../lib/local-state.js';
import { writeYamlFileAtomic } from '../lib/yaml-io.js';
import { validateAgainstSchema } from '../lib/schema.js';
import { gh } from '../lib/exec.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';

const USAGE = `
使い方: agent-skill-chain report status <issue_id> <role> <segment> <status> <target_sha> [blocked_reason]

role:     spec_worker|design_worker|implementation_worker|validation_worker|adr_finalization_worker
segment:  spec|design|implementation|validation|adr_finalization
status:   completed|blocked
blocked_reason: status=blocked の場合必須（推測で補完せず、明確なブロッカーを記述する）

出力:
  成功時: 終了コード0。発行先（Issueコメントurlまたはreportファイルパス）を標準出力へ。
  失敗時: 終了コード1以上。スキーマ不適合等の理由を標準エラー出力へ。
`;

const MARKER = '<!-- agent-skill-chain:worker-report -->';

interface WorkerReport {
  schema_version: string;
  issue_id: string;
  role: string;
  segment: string;
  status: 'completed' | 'blocked';
  target_sha: string;
  blocked_reason?: string;
}

export async function status(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(USAGE);
      return 0;
    }
    const [issueIdRaw, role, segment, statusValue, targetSha, blockedReason] = args;
    if (!issueIdRaw || !role || !segment || !statusValue || !targetSha) {
      throw new CliError('issue_id, role, segment, status, target_sha はすべて必須です');
    }
    if (statusValue !== 'completed' && statusValue !== 'blocked') {
      throw new CliError(`status は completed|blocked のいずれかである必要があります: '${statusValue}'`);
    }
    if (statusValue === 'blocked' && !blockedReason) {
      throw new CliError('status=blocked の場合 blocked_reason は必須です（推測で補完しない）');
    }
    const { issueId, number } = parseIssueId(issueIdRaw);

    const root = repoRoot();
    const config = loadConfig(root);

    const report: WorkerReport = {
      schema_version: 'agent-skill-chain/worker-report/v1',
      issue_id: issueId,
      role,
      segment,
      status: statusValue,
      target_sha: targetSha,
      ...(blockedReason ? { blocked_reason: blockedReason } : {}),
    };
    const outcome = validateAgainstSchema('worker-report', report, root);
    if (!outcome.valid) return fail(`worker report がスキーマに適合しません: ${outcome.errors.join('; ')}`);

    if (config.coordination.backend === 'local') {
      const dest = reportFilePath(root, number, segment);
      writeYamlFileAtomic(dest, report);
      return ok(dest);
    }

    const body = `${MARKER}\n\`\`\`yaml\n${stringify(report)}\`\`\`\n`;
    const result = gh(['issue', 'comment', number, '--body', body], root);
    if (result.status !== 0) return fail(`gh issue comment に失敗しました: ${result.stderr.trim()}`);
    return ok(result.stdout.trim());
  });
}
