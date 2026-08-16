import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, worktreeRoot } from '../lib/paths.js';
import { loadConfig } from '../lib/config.js';
import { parseIssueId, validateSegment, CliError } from '../lib/issue.js';
import { leaseFilePath, stateFilePath } from '../lib/local-state.js';
import { tryReadYamlFile, toYamlString } from '../lib/yaml-io.js';
import { gh } from '../lib/exec.js';
import { activeLeaseFor, type WriterLease } from '../lib/github-lease.js';
import { loadRoles, type RolesDocument } from '../lib/roles.js';
import { loadProjectPolicyDocuments } from '../lib/project-policy.js';
import { quickBlockedNotice, resolveQuickMode } from '../lib/quick-mode.js';
import { resolveIssueWorktreeExactlyOne } from '../lib/worktree.js';
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

type WorkerContract = RolesDocument['role_contracts'][string];

const QUICK_EXEMPT_IMPLEMENTATION_INPUTS = new Set(['SPEC.md', 'DESIGN.md', 'PLAN.md']);

/** Issue #690: quick は成果物の利用を禁じず、存在義務だけを免除する。 */
function buildQuickImplementationContract(contract: WorkerContract, worktreePath: string): WorkerContract {
  const hasPlan = fs.existsSync(path.join(worktreePath, 'PLAN.md'));
  const inputs = [
    'Issue',
    ...contract.inputs.filter(
      (input) => QUICK_EXEMPT_IMPLEMENTATION_INPUTS.has(input) && fs.existsSync(path.join(worktreePath, input)),
    ),
    'related accepted ADR（存在する場合）',
  ];
  const rules = contract.rules.flatMap((rule) =>
    rule.startsWith('PLANの順序に従う')
      ? [
          ...(hasPlan ? [rule] : []),
          '同梱されたIssue内容を要求の正本として実装する',
          'Issue内容から実装範囲を確定できない場合は推測で補完せずblockedを報告する',
        ]
      : [rule],
  );
  return { ...contract, inputs, rules };
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

function readGithubIssueBlock(root: string, issueIdRaw: string, issueNumber: string): string | undefined {
  const view = gh(['issue', 'view', issueNumber, '--json', 'number,title,body'], root);
  if (view.status !== 0) return undefined;
  try {
    const payload = JSON.parse(view.stdout) as { number?: number; title?: string; body?: string };
    return buildIssueBlock(issueIdRaw, {
      id: payload.number === undefined ? issueIdRaw : `ISSUE-${payload.number}`,
      ...(typeof payload.title === 'string' && payload.title.length > 0 ? { title: payload.title } : {}),
      ...(typeof payload.body === 'string' && payload.body.length > 0 ? { request: payload.body } : {}),
    });
  } catch {
    return undefined;
  }
}

function buildCompletionReportBlock(issueId: string, role: string, segment: string): string {
  return [
    'worker_completion_report:',
    '  instruction: 成果物をcommit・pushした後、最終応答の前に次のコマンドで完了状態を進行役へ報告する',
    `  command: .agent-skill-chain/scripts/report-status.sh ${issueId} ${role} ${segment} completed "$(git rev-parse HEAD)"`,
  ].join('\n');
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
    let contract = roles.role_contracts[role];
    if (!contract) return fail(`config/roles.yaml に role_contracts.${role} が定義されていません`);

    // local backend で state.yaml に title/request（Issue本文）があれば、ワーカー起動プロンプトへ
    // 同梱する（ISSUE-183 要件5・AC-5）。本文が無い state・GitHubモードでは従来どおり同梱しない。
    let issueBlock: string | undefined;
    if (config.coordination.backend === 'local') {
      const state = tryReadYamlFile<LocalStateIssueFields>(stateFilePath(root, number));
      issueBlock = buildIssueBlock(issueIdRaw, state);
    }

    if (segment === 'implementation') {
      const worktree = resolveIssueWorktreeExactlyOne(root, config, number);
      if (worktree.status !== 'found') {
        return fail(`ISSUE-${number} の worktree を一意に解決できないためimplementation契約を生成できません`);
      }
      const quick = resolveQuickMode(root, worktree.worktree.path, number, config.coordination.backend);
      if (quick.requested && !quick.exempt) process.stderr.write(`${quickBlockedNotice(quick)}\n`);
      if (quick.exempt) {
        if (config.coordination.backend === 'github') {
          issueBlock = readGithubIssueBlock(root, issueIdRaw, number);
        }
        if (!issueBlock) {
          return fail('Issue内容を取得できないためsize:quick用のimplementation契約を生成できません');
        }
        contract = buildQuickImplementationContract(contract, worktree.worktree.path);
      }
    }

    let reviewStatus;
    if (config.coordination.backend === 'local') {
      reviewStatus = detectLocalBlockingFindings(root, number, segment);
    } else {
      let githubRoot = root;
      try {
        githubRoot = worktreeRoot();
      } catch {
        // Issue #446: 検出用root解決の失敗でworker起動全体を止めず、PR側の部分障害として表面化させる。
      }
      reviewStatus = detectGithubReviewStatus(githubRoot, number);
    }

    const parts = [`role: ${role}`];
    if (issueBlock) parts.push(issueBlock);
    if (reviewStatus) parts.push(formatReviewStatusBlock(reviewStatus));
    parts.push(toYamlString(contract).trim());
    parts.push(buildCompletionReportBlock(issueIdRaw, role, segment));
    parts.push(...loadProjectPolicyDocuments(root, segment));
    return ok(parts.join('\n'));
  });
}
