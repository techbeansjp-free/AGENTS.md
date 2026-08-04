import { repoRoot } from '../lib/paths.js';
import { loadConfig } from '../lib/config.js';
import { parseIssueId, validateSegment, CliError } from '../lib/issue.js';
import { leaseFilePath, stateFilePath } from '../lib/local-state.js';
import { tryReadYamlFile, toYamlString } from '../lib/yaml-io.js';
import { activeLeaseFor, type WriterLease } from '../lib/github-lease.js';
import { loadRoles } from '../lib/roles.js';
import { loadProjectPolicyDocuments } from '../lib/project-policy.js';
import {
  detectGithubReviewStatus,
  detectLocalBlockingFindings,
  formatReviewStatusBlock,
} from '../lib/review-status.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';

const USAGE = `
使い方: agent-skill-chain segment start <issue_id> <segment>

issue_id: ISSUE-<番号> 形式のIssue ID
segment:  spec|design|implementation|validation

segment が implementation の場合、\`.agent-skill-chain/config/agent-skill-chain.yaml\` の
\`human_confirmation.before_implementation\` が明示的に false でない限り（既定 true）、
role_contractを返す前に日本語メッセージで停止する。

出力:
  成功時: 終了コード0。起動したワーカーの役割名・role_contractを標準出力へ。
  失敗時: 終了コード1以上。writer lease未取得・人間確認未取得（implementationのみ）等の理由を標準エラー出力へ。
`;

const SEGMENT_TO_ROLE: Record<string, string> = {
  spec: 'spec_worker',
  design: 'design_worker',
  implementation: 'implementation_worker',
  validation: 'validation_worker',
};

interface LocalStateIssueFields {
  id?: string;
  title?: string;
  request?: string;
}

/**
 * ローカル Coordination Backend の state.yaml が保持する title/request（ISSUE-183）を、
 * ワーカー起動プロンプトへ同梱する `issue:` セクションへ整形する。title/request のいずれも
 * 無い state（後方互換ケース）では undefined を返し、呼び出し側は従来どおりの出力
 * （セクション無し）のままにする。
 */
function buildIssueBlock(issueIdRaw: string, state: LocalStateIssueFields | undefined): string | undefined {
  if (!state || (state.title === undefined && state.request === undefined)) return undefined;
  const issueYaml: Record<string, string> = { id: state.id ?? issueIdRaw };
  if (state.title !== undefined) issueYaml.title = state.title;
  if (state.request !== undefined) issueYaml.request = state.request;
  const indented = toYamlString(issueYaml)
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => `  ${line}`)
    .join('\n');
  return `issue:\n${indented}`;
}

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

    // Issue #427: 実装セグメントの着手は既定で人間の明示的な確認を要求する（`merge.autonomous`と
    // 同じ精神の独立した opt-in、`autonomy: gated | full` とは別軸）。role_contractを返す前に
    // 早期リターンで停止する。spec/design/validationセグメントはこのゲートの対象外。
    if (segment === 'implementation' && config.human_confirmation?.before_implementation !== false) {
      return fail(
        [
          '実装セグメントの着手には人間レビューが必要です。設計内容（DESIGN.md/PLAN.md）についてまず人間に確認を取ってください。',
          '人間がこの場で着手を承認した場合は、このコマンドを呼ばず直接ワーカーを起動して構いません。',
          '複数Issueにわたる自走的な運用が既に人間から許可されている場合は、`.agent-skill-chain/config/agent-skill-chain.yaml` の `human_confirmation.before_implementation: false` を設定してください。',
        ].join('\n'),
      );
    }

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

    // local backend で state.yaml に title/request（Issue本文）があれば、ワーカー起動プロンプトへ
    // 同梱する（ISSUE-183 要件5・AC-5）。本文が無い state・GitHubモードでは従来どおり同梱しない。
    let issueBlock: string | undefined;
    if (config.coordination.backend === 'local') {
      const state = tryReadYamlFile<LocalStateIssueFields>(stateFilePath(root, number));
      issueBlock = buildIssueBlock(issueIdRaw, state);
    }

    const reviewStatus =
      config.coordination.backend === 'local'
        ? detectLocalBlockingFindings(root, number, segment)
        : detectGithubReviewStatus(root, number);

    const parts = [`role: ${role}`];
    if (issueBlock) parts.push(issueBlock);
    if (reviewStatus) parts.push(formatReviewStatusBlock(reviewStatus));
    parts.push(toYamlString(contract).trim());
    parts.push(...loadProjectPolicyDocuments(root, segment));
    return ok(parts.join('\n'));
  });
}
