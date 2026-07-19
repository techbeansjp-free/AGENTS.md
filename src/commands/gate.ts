import { repoRoot } from '../lib/paths.js';
import { loadConfig } from '../lib/config.js';
import { parseIssueId, validateSegment, SEGMENTS, CliError, type Segment } from '../lib/issue.js';
import { findIssueWorktree } from '../lib/worktree.js';
import { reviewFilePath } from '../lib/local-state.js';
import { readYamlFile, writeYamlFileAtomic, toYamlString } from '../lib/yaml-io.js';
import { validateAgainstSchema } from '../lib/schema.js';
import { git, gh } from '../lib/exec.js';
import { digestOf } from '../lib/digest.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';

const REVIEW_USAGE = `
使い方: agent-skill-chain gate review <issue_id> <gate_id> <profile>

gate_id: spec|design|implementation|validation
profile: standard|strict

出力:
  成功時: 終了コード0。schemas/gate-report.schema.yaml準拠のgate-reportパス（レビュア記入用の
          白紙スキャフォールド）とreviewer_countを標準出力へ。
  失敗時: 終了コード1以上。理由を標準エラー出力へ。
`;

const PUBLISH_USAGE = `
使い方: agent-skill-chain gate publish <issue_id> <gate_report_path>

出力:
  成功時: 終了コード0。発行先（Check Run URLまたはreviews/<gate>.yamlパス）を標準出力へ。
  失敗時: 終了コード1以上。スキーマ不適合等の理由を標準エラー出力へ。
`;

const RECONCILE_USAGE = `
使い方: agent-skill-chain gate reconcile <issue_id> <target_sha>

出力:
  成功時: 終了コード0。再発行または無効化したゲートIDの一覧を標準出力へ。
  失敗時: 終了コード1以上。理由を標準エラー出力へ。
`;

interface GateReport {
  schema_version: string;
  gate: {
    id: Segment;
    target_sha: string;
    conformance: 'pass' | 'fail' | 'pending';
    falsification: 'pass' | 'fail' | 'pending';
    final: 'approved' | 'rejected' | 'pending' | 'human_required';
    blockers: unknown[];
    approved_digest: string;
    approved_artifacts: { path: string; digest: string }[];
  };
}

function validateGateId(value: string): asserts value is Segment {
  validateSegment(value);
}

export async function review(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(REVIEW_USAGE);
      return 0;
    }
    const [issueIdRaw, gateId, profile] = args;
    if (!issueIdRaw || !gateId || !profile) throw new CliError('issue_id, gate_id, profile はすべて必須です');
    const { number } = parseIssueId(issueIdRaw);
    validateGateId(gateId);
    if (profile !== 'standard' && profile !== 'strict') {
      throw new CliError(`profile は standard|strict のいずれかである必要があります: '${profile}'`);
    }

    const root = repoRoot();
    const config = loadConfig(root);
    const entry = findIssueWorktree(root, config, number);
    if (!entry) throw new CliError(`ISSUE-${number} の worktree が見つかりません`);
    const targetSha = git(['rev-parse', 'HEAD'], entry.path).stdout.trim();
    if (!targetSha) throw new CliError('target_sha を取得できませんでした');

    const scaffold: GateReport = {
      schema_version: 'agent-skill-chain/gate-report/v1',
      gate: {
        id: gateId,
        target_sha: targetSha,
        conformance: 'pending',
        falsification: 'pending',
        final: 'pending',
        blockers: [],
        approved_digest: `sha256:${'0'.repeat(64)}`,
        approved_artifacts: [],
      },
    };
    const outcome = validateAgainstSchema('gate-report', scaffold, root);
    if (!outcome.valid) return fail(`スキャフォールド生成に失敗しました: ${outcome.errors.join('; ')}`);

    const reportPath = reviewFilePath(root, number, gateId);
    writeYamlFileAtomic(reportPath, scaffold);

    const reviewerCount = config.review[profile].reviewer_count;
    return ok(`gate_report_path: ${reportPath}\nreviewer_count: ${reviewerCount}`);
  });
}

export async function publish(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(PUBLISH_USAGE);
      return 0;
    }
    const [issueIdRaw, gateReportPath] = args;
    if (!issueIdRaw || !gateReportPath) throw new CliError('issue_id, gate_report_path はすべて必須です');
    const { number } = parseIssueId(issueIdRaw);

    const root = repoRoot();
    const config = loadConfig(root);
    const report = readYamlFile<GateReport>(gateReportPath);
    const outcome = validateAgainstSchema('gate-report', report, root);
    if (!outcome.valid) return fail(`gate-report がスキーマに適合しません: ${outcome.errors.join('; ')}`);
    if (report.gate.conformance === 'pending' || report.gate.falsification === 'pending') {
      return fail('conformance / falsification が pending のままの gate-report は publish できません');
    }

    // ローカルモードでは reviews/<gate>.yaml が正本。GitHubモードでも Check Run（信号）とは別に
    // 同じ構造化レコードを issues/<n>/.agent-skill-chain/reviews/<gate>.yaml へ併記する。
    // gate-report.schema.yaml 準拠の approved_artifacts.digest は Check Run の title/summary には
    // 収まらず、後続コマンド（adr finalize 等）がバックエンドを問わず参照できる場所が必要なため。
    const dest = reviewFilePath(root, number, report.gate.id);
    writeYamlFileAtomic(dest, report);

    if (config.coordination.backend === 'local') {
      return ok(dest);
    }

    const checkName = config.checks[report.gate.id];
    const conclusion =
      report.gate.final === 'approved' ? 'success' : report.gate.final === 'rejected' ? 'failure' : 'action_required';
    const body = JSON.stringify({
      name: checkName,
      head_sha: report.gate.target_sha,
      status: 'completed',
      conclusion,
      output: {
        title: `${report.gate.id} gate: ${report.gate.final}`,
        summary:
          report.gate.blockers.length === 0
            ? 'no blockers'
            : `blockers: ${JSON.stringify(report.gate.blockers)}`,
      },
    });
    const result = gh(['api', 'repos/{owner}/{repo}/check-runs', '--input', '-'], root, body);
    if (result.status !== 0) return fail(`Check Run 発行に失敗しました: ${result.stderr.trim()}`);
    try {
      const parsed = JSON.parse(result.stdout) as { html_url?: string };
      return ok(parsed.html_url ?? result.stdout.trim());
    } catch {
      return ok(result.stdout.trim());
    }
  });
}

export async function reconcile(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(RECONCILE_USAGE);
      return 0;
    }
    const [issueIdRaw, targetSha] = args;
    if (!issueIdRaw || !targetSha) throw new CliError('issue_id, target_sha はすべて必須です');
    const { number } = parseIssueId(issueIdRaw);

    const root = repoRoot();
    const config = loadConfig(root);
    if (config.coordination.backend !== 'local') {
      return fail('gate reconcile は現時点で local バックエンドのみ対応しています（githubモードはCheck Run digest照合が別途必要）');
    }

    const reissued: string[] = [];
    const invalidated: string[] = [];
    let downstreamInvalidated = false;

    for (const gateId of SEGMENTS) {
      const reportPath = reviewFilePath(root, number, gateId);
      let report: GateReport;
      try {
        report = readYamlFile<GateReport>(reportPath);
      } catch {
        continue; // このゲートは未レビュー・未発行
      }

      if (downstreamInvalidated) {
        report.gate.conformance = 'pending';
        report.gate.falsification = 'pending';
        report.gate.final = 'pending';
        writeYamlFileAtomic(reportPath, report);
        invalidated.push(gateId);
        continue;
      }

      const changed = report.gate.approved_artifacts.some((artifact) => {
        const show = git(['show', `${targetSha}:${artifact.path}`], root);
        if (show.status !== 0) return true; // 削除された等 = 変化あり
        return digestOf(show.stdout) !== artifact.digest;
      });

      if (changed) {
        report.gate.conformance = 'pending';
        report.gate.falsification = 'pending';
        report.gate.final = 'pending';
        writeYamlFileAtomic(reportPath, report);
        invalidated.push(gateId);
        downstreamInvalidated = true;
      } else {
        report.gate.target_sha = targetSha;
        writeYamlFileAtomic(reportPath, report);
        reissued.push(gateId);
      }
    }

    return ok(
      [`reissued: ${reissued.join(', ') || '(none)'}`, `invalidated: ${invalidated.join(', ') || '(none)'}`].join('\n'),
    );
  });
}
