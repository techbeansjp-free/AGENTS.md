import { parse, stringify } from 'yaml';
import { repoRoot } from '../lib/paths.js';
import { loadConfig } from '../lib/config.js';
import { parseIssueId, CliError } from '../lib/issue.js';
import { reportFilePath } from '../lib/local-state.js';
import { tryReadYamlFile, writeYamlFileAtomic } from '../lib/yaml-io.js';
import { validateAgainstSchema } from '../lib/schema.js';
import { gh } from '../lib/exec.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';

const USAGE = `
使い方: agent-skill-chain report status <issue_id> <role> <segment> <status> <target_sha> [blocked_reason] [human_escalation_requested]

role:     spec_worker|design_worker|implementation_worker|validation_worker|adr_finalization_worker
segment:  spec|design|implementation|validation|adr_finalization
status:   completed|blocked
blocked_reason: status=blocked の場合必須（推測で補完せず、明確なブロッカーを記述する）
human_escalation_requested: 省略可（既定false）。'true' を指定すると、起動失敗・timeout・
  完了を騙るケース等、進行役への人間エスカレーションを要する blocked であることを明示する
  （AGENTS.md 不変条件I8。launch_worker等のアダプタが使う）。

出力:
  成功時: 終了コード0。発行先（Issueコメントurlまたはreportファイルパス）を標準出力へ。
  失敗時: 終了コード1以上。スキーマ不適合等の理由を標準エラー出力へ。
`;

const LATEST_USAGE = `
使い方: agent-skill-chain report latest <issue_id> <segment>

対象segmentの直近のworker報告（schemas/worker-report.schema.yaml準拠）を1件、KEY=VALUE形式で
標準出力へ出す。launch_worker（アダプタ）が「起動したworkerが実際にcompletedを報告し、
target_shaが押し済みHEADと一致するか」を確認するために使う（AGENTS.md不変条件I8:
完了を騙る場合でもsilent passせず安全側に倒す判定の材料）。

出力:
  成功時: 終了コード0。status=<completed|blocked>\\ntarget_sha=<sha> を標準出力へ。
  失敗時: 終了コード1以上（報告が1件も無い場合を含む）。
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
  human_escalation_requested?: boolean;
}

export async function status(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(USAGE);
      return 0;
    }
    const [issueIdRaw, role, segment, statusValue, targetSha, blockedReason, humanEscalationRaw] = args;
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
      ...(humanEscalationRaw === 'true' ? { human_escalation_requested: true } : {}),
    };
    const outcome = validateAgainstSchema('worker-report', report, root);
    if (!outcome.valid) return fail(`worker report がスキーマに適合しません: ${outcome.errors.join('; ')}`);

    if (config.coordination.backend === 'local') {
      const dest = reportFilePath(root, number, segment);
      writeYamlFileAtomic(dest, report);
      return ok(dest);
    }

    const body = `${MARKER}\n\`\`\`yaml\n${stringify(report)}\`\`\`\n`;
    const result = gh([`issue`, 'comment', number, '--body', body], root);
    if (result.status !== 0) return fail(`gh issue comment に失敗しました: ${result.stderr.trim()}`);
    return ok(result.stdout.trim());
  });
}

/**
 * 対象segmentの直近のworker報告を1件取得する（launch_workerの完了確認・I8安全側判定に使う）。
 * ローカルモードはreportFilePath（1segment1ファイル）を直接読む。GitHubモードは
 * MARKER付きコメントのうちsegmentが一致するものを createdAt 昇順の最後（＝最新）として採用する。
 */
export async function latest(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(LATEST_USAGE);
      return 0;
    }
    const [issueIdRaw, segment] = args;
    if (!issueIdRaw || !segment) throw new CliError('issue_id, segment はすべて必須です');
    const { number } = parseIssueId(issueIdRaw);

    const root = repoRoot();
    const config = loadConfig(root);

    if (config.coordination.backend === 'local') {
      const report = tryReadYamlFile<WorkerReport>(reportFilePath(root, number, segment));
      if (!report) return fail(`ISSUE-${number} の segment '${segment}' に worker report がありません`);
      return ok(`status=${report.status}\ntarget_sha=${report.target_sha}`);
    }

    const result = gh([`issue`, 'view', number, '--json', 'comments'], root);
    if (result.status !== 0) return fail(`gh issue view に失敗しました: ${result.stderr.trim()}`);
    const parsed = JSON.parse(result.stdout) as { comments: { body: string; createdAt: string }[] };
    const reports = parsed.comments
      .filter((c) => c.body.includes(MARKER))
      .map((c) => {
        const match = /```yaml\n([\s\S]*?)```/.exec(c.body);
        if (!match) return undefined;
        try {
          return { report: parse(match[1]) as WorkerReport, createdAt: c.createdAt };
        } catch {
          return undefined;
        }
      })
      .filter((r): r is { report: WorkerReport; createdAt: string } => !!r && r.report.segment === segment)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const last = reports[reports.length - 1];
    if (!last) return fail(`ISSUE-${number} の segment '${segment}' に worker report がありません`);
    return ok(`status=${last.report.status}\ntarget_sha=${last.report.target_sha}`);
  });
}
