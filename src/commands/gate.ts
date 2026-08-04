import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { repoRoot, worktreeRoot } from '../lib/paths.js';
import { loadConfig } from '../lib/config.js';
import { parseIssueId, validateSegment, SEGMENTS, CliError, type Segment } from '../lib/issue.js';
import { findIssueWorktree } from '../lib/worktree.js';
import { issueDir, reviewFilePath, stateFilePath } from '../lib/local-state.js';
import { readYamlFile, tryReadYamlFile, writeYamlFileAtomic, toYamlString } from '../lib/yaml-io.js';
import { validateAgainstSchema } from '../lib/schema.js';
import { git, gh } from '../lib/exec.js';
import { digestOf, artifactDigestOf, artifactDigestOfFile, ARTIFACT_ABSENT_DIGEST } from '../lib/digest.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';
import { classifyCoreReview } from '../lib/model-selection.js';
import {
  canonicalJson,
  evidencePromptDigest,
  isEvidenceVerdict,
  renderReviewEvidence,
  verifyGithubReviewEvidence,
  type EvidenceVerdict,
  type GithubReviewRecord,
  type ReviewEvidence,
  type VerifiedReviewAttempt,
  type VerifiedReviewer,
} from '../lib/review-evidence.js';
import {
  assertTrustedAppCheck,
  assertTrustedGateAttestationVerification,
  buildTrustedGateAttestation,
  canonicalReportIsOversize,
  createTrustedGateCheck,
  fetchTrustedGateApiContext,
  finalizeTrustedGateCheck,
  githubJsonDirect,
  parseTrustedGateCheckOutput,
  parseTrustedGateDispatchEvent,
  parseTrustedGateWorkflow,
  readTrustedGateCheck,
  readTrustedGateRecordState,
  selectLatestTrustedGateCheck,
  TRUSTED_GATE_WORKFLOW_PATH,
  trustedGateExternalId,
  writeTrustedGateRecordState,
  type TrustedGateActionRun,
  type TrustedGateApiContext,
  type TrustedGateAttestationEnvelope,
  type TrustedGateCheckRun,
  type TrustedGateRecordState,
  type TrustedGateRepository,
} from '../lib/trusted-gate-recorder.js';

const REVIEW_USAGE = `
使い方: agent-skill-chain gate review <issue_id> <gate_id> <profile> [target_sha]

gate_id: spec|design|implementation|validation
profile: standard|strict
target_sha: 省略可。指定時はこの値をgate-reportのtarget_shaとして採用し、
            entry.pathでのgit rev-parse HEADによる自己解決を行わない。
            CI環境（actions/checkoutがpull_requestのマージrefをdetached HEADで
            チェックアウトするケース）では、呼び出し元（workflow）がPRの実際の
            ブランチ先端コミット（github.event.pull_request.head.sha）を明示的に
            渡すことで、Check Runのhead_shaとPRの実際のコミットの不一致を防ぐ。
            省略時は従来通りgit rev-parse HEADで自己解決する（ローカル開発機での
            既存の使い方はそのまま）。

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
使い方: agent-skill-chain gate reconcile <issue_id> <target_sha> [pr_number]

出力:
  成功時: 終了コード0。再発行または無効化したゲートIDの一覧を標準出力へ。
  失敗時: 終了コード1以上。理由を標準エラー出力へ。
`;

const RECORD_VERDICT_USAGE = `
使い方: agent-skill-chain gate record-verdict <gate_report_path> [artifact_base_dir] [expected_reviewer_count]

pending の gate-report（gate review が生成したスキャフォールド）へ、標準入力から与えた
レビュア verdict（JSON。複数レビュア時は配列）を結線して判定済み gate-report を書き出す。final は verdict の
conformance/falsification/blockers/inconclusive から機械的に導出する（両pass かつ blocking finding
無し→approved／いずれか fail もしくは blocking finding あり→rejected／inconclusive→human_required）。
expected_reviewer_count を指定した場合は、独立 verdict の件数が完全一致しなければ書込みを拒否する。

verdict JSON（stdin）:
  {"conformance":"pass|fail|pending","falsification":"pass|fail|pending",
   "blockers":[{"severity":"blocking|warning|info","origin":"specification|design|implementation|validation",
                "code":"...","evidence":["..."]}],
   "approved_artifacts":[{"path":"...","digest":"sha256:..."}],
   "inconclusive":false}

read-only 契約: verdict を生成するレビュア（AI/人間）には書込みツールを与えず、gate-report への
書込みは本コマンド（trusted code）のみが行う。
`;

const MARK_HUMAN_REQUIRED_USAGE = `
使い方: agent-skill-chain gate mark-human-required <gate_report_path>

gate-report の final を human_required に設定して書き出す（conformance/falsification は据え置き）。
レビュア起動失敗・タイムアウト・未構成・非同期 deferral のフェイルセーフ書込みに用いる
（AGENTS.md 不変条件 I8「判定不能を approve/success へ倒さない」）。冪等。
`;

const REVIEWER_CONTEXT_USAGE = `
使い方: agent-skill-chain gate reviewer-context <issue_id> [target_sha] [base_ref] [review_subject] [adapter]

判定ステップ・adapter が必要とするコンテキストを KEY=VALUE 形式で標準出力へ出す。
  adapter=<claude|codex|human>   review.adapter（未設定時 claude）
  backend=<github|local>          coordination.backend
  issue_number=<n>                issue_id から抽出した番号
  core_review_required=<bool>     登録済みproject policyによるコアレビュー要否
  core_review_status=<status>     resolved|unresolved

target_sha/base_ref: 指定時はGit差分からコア変更を分類する。
review_subject: ordinary|core_audit。GitHub workflowがPR labelの正本値を渡す。
                ローカルモードで省略時はstate.yamlのreview_subjectを読む。
adapter: claude|codex|human。進行役がローカルreviewerを明示選択する場合だけ指定する。
`;

const REVIEWER_PROMPT_USAGE = `
使い方: agent-skill-chain gate reviewer-prompt <issue_id> <gate_id> <target_sha> [base_sha]

対象セグメントの成果物・AC-ID・上流承認物を read-only で収集し、conformance（立証）/
falsification（反証）判定プロトコルの指示（ルーブリック・出力 JSON 契約）を標準出力へ出す。
レビュアへの入力プロンプトであり、本コマンドはファイルを読むのみ（書込みなし）。
`;

const SUBMIT_EVIDENCE_USAGE = `
使い方: agent-skill-chain gate submit-evidence <issue_id> <gate_id> <profile> <target_sha> <base_sha> <trusted_base_sha> <pr_number> <attempt_id> <expected_count> <reviewer_run_id> <slot> <adapter> <model> <reasoning>

protected base由来のローカルreviewer verdict（stdin JSON）を構造化し、GitHub PR Review APIへ
COMMENTとして保存する。Issue worktreeのcandidate recorderからの実行、dirty base、SHA不一致は拒否する。
`;

const VERIFY_EVIDENCE_USAGE = `
使い方: agent-skill-chain gate verify-evidence <issue_id> <gate_id> <profile> <target_sha> <base_sha> <pr_number> <gate_report_path> [review_subject]

protected baseのpolicy/verifierでGitHub PR・commit・review metadataと構造化証跡を検証・集約し、
gate-reportへ書く。証跡不足・古いSHA・実行attestation不一致・actor未解決はhuman_requiredへ安全側停止する。
`;

const MATERIALIZE_CHECK_REPORT_USAGE = `
使い方: agent-skill-chain gate materialize-check-report <issue_id> <gate_id> <target_sha> <gate_report_path>

現在SHAの専用App CheckをActions workflow run_number/run_attemptへ結合し、latest runが
completed successの場合だけattestation、report、review evidence、artifact digestを再構築して
noncanonicalなローカルcacheへ復元する。標準Actions Appやopaque Check ID順は信頼しない。
`;

const RECORD_TRUSTED_CHECK_USAGE = `
使い方:
  agent-skill-chain gate record-trusted-check validate
  agent-skill-chain gate record-trusted-check prepare <state_path> <attestation_envelope_path>
  agent-skill-chain gate record-trusted-check finalize <state_path> <attestation_envelope_path> <verification_json_path>

repository_dispatchの厳密なallowlistを検査し、protected-main verifierのgate reportを専用GitHub Appの
in-progress Checkへ束縛する。finalizeは固定workflowのartifact attestationとcurrent API正本を
再検証し、最後の外部操作としてだけCheckをcompletedへPATCHする。
`;

interface Finding {
  severity: 'blocking' | 'warning' | 'info';
  origin: 'specification' | 'design' | 'implementation' | 'validation';
  code: string;
  evidence: string[];
}

export interface GateReport {
  schema_version: string;
  gate: {
    id: Segment;
    target_sha: string;
    conformance: 'pass' | 'fail' | 'pending';
    falsification: 'pass' | 'fail' | 'pending';
    final: 'approved' | 'rejected' | 'pending' | 'human_required';
    blockers: Finding[];
    approved_digest: string;
    approved_artifacts: { path: string; digest: string }[];
    reviewers?: VerifiedReviewer[];
    review_attempt?: VerifiedReviewAttempt;
  };
}

type ApprovedArtifact = GateReport['gate']['approved_artifacts'][number];
type ApprovedBaseline =
  | { found: true; approvedArtifacts: ApprovedArtifact[] }
  | { found: false };

const TRUSTED_WORKFLOW_EVENTS: Readonly<Record<string, readonly string[]>> = {
  '.github/workflows/agent-skill-chain-gate.yml': ['pull_request_target', 'pull_request_review'],
  '.github/workflows/agent-skill-chain-reconcile.yml': ['pull_request_target'],
};

interface ReviewerVerdict {
  conformance?: 'pass' | 'fail' | 'pending';
  falsification?: 'pass' | 'fail' | 'pending';
  blockers?: Finding[];
  approved_artifacts?: { path: string; digest?: string }[];
  approved_digest?: string;
  inconclusive?: boolean;
  final?: 'approved' | 'rejected' | 'pending' | 'human_required';
}

const SUBVERDICT_VALUES = new Set(['pass', 'fail', 'pending']);
// Issue #309: 実在する成果物の内容 digest（artifactDigestOf/artifactDigestOfFile）とは
// 別ドメインから導出された sentinel のため、実在ファイルの内容といかなる場合も衝突しない。
export const ABSENT_ARTIFACT_DIGEST = ARTIFACT_ABSENT_DIGEST;
const LOCAL_REVIEW_LAUNCHER_PATHS = [
  '.agent-skill-chain/scripts/gate-local-review.sh',
  '.agent-skill-chain/scripts/gate-launch-reviewer.sh',
  '.agent-skill-chain/scripts/gate-review.sh',
  '.agent-skill-chain/adapters/claude.sh',
  '.agent-skill-chain/adapters/codex.sh',
  '.agent-skill-chain/adapters/human.sh',
  '.agent-skill-chain/config/roles.yaml',
  '.agent-skill-chain/project/manifest.yaml',
  '.agent-skill-chain/project/MODEL_TIER_TABLE.md',
  '.agent-skill-chain/schemas/gate-report.schema.yaml',
  '.agent-skill-chain/schemas/project-policy.schema.yaml',
] as const;

interface LauncherToken {
  schema_version: 'agent-skill-chain/launcher-token/v1';
  attempt_id: string;
  expected_count: 1 | 2;
  profile: 'standard' | 'strict';
  target_sha: string;
  base_sha: string;
  pr_number: string;
  nonce: string;
  slots: { slot: 1 | 2; run_id: string }[];
  consumed_slots: number[];
}

/**
 * verdict の各観点（conformance・falsification・blockers・inconclusive）から final を機械的に導出する。
 * I8 安全側: 判定不能（inconclusive・観点が pending 等）は decidedly approve/reject へ倒さず
 * human_required にする。approve は「両 pass かつ blocking finding が 1 件も無い」ときのみ。
 */
function deriveFinal(verdict: ReviewerVerdict): GateReport['gate']['final'] {
  const hasBlocking = (verdict.blockers ?? []).some((b) => b.severity === 'blocking');
  if (verdict.inconclusive === true || verdict.final === 'human_required') return 'human_required';
  if (verdict.conformance === 'pass' && verdict.falsification === 'pass' && !hasBlocking) return 'approved';
  if (verdict.conformance === 'fail' || verdict.falsification === 'fail' || hasBlocking) return 'rejected';
  return 'human_required';
}

function aggregateSubverdict(
  verdicts: ReviewerVerdict[],
  key: 'conformance' | 'falsification',
): GateReport['gate']['conformance'] {
  const values = verdicts.map((verdict) => verdict[key] ?? 'pending');
  if (values.includes('fail')) return 'fail';
  if (values.every((value) => value === 'pass')) return 'pass';
  return 'pending';
}

/**
 * Strict profile の独立 verdict を trusted code で集約する。
 * 1 件でも rejected なら rejected、全件 approved の場合だけ approved、
 * それ以外（判定不能・pending）は human_required とする（I8）。
 */
function aggregateVerdicts(verdicts: ReviewerVerdict[]): ReviewerVerdict {
  const finals = verdicts.map(deriveFinal);
  const final = finals.includes('rejected')
    ? 'rejected'
    : finals.every((value) => value === 'approved')
      ? 'approved'
      : 'human_required';
  return {
    conformance: aggregateSubverdict(verdicts, 'conformance'),
    falsification: aggregateSubverdict(verdicts, 'falsification'),
    blockers: verdicts.flatMap((verdict) => verdict.blockers ?? []),
    approved_artifacts: verdicts.flatMap((verdict) => verdict.approved_artifacts ?? []),
    approved_digest:
      verdicts.length > 0 &&
      verdicts.every(
        (verdict) => verdict.approved_digest && verdict.approved_digest === verdicts[0].approved_digest,
      )
        ? verdicts[0].approved_digest
        : undefined,
    final,
    inconclusive: final === 'human_required',
  };
}

function changedPaths(root: string, baseSha: string, targetSha: string): string[] {
  const result = git(['diff', '--name-only', `${baseSha}...${targetSha}`], root);
  if (result.status !== 0) throw new CliError(`base...target差分を取得できません: ${result.stderr.trim()}`);
  return result.stdout.split('\n').map((entry) => entry.trim()).filter(Boolean);
}

function expectedArtifactPaths(root: string, gateId: Segment, baseSha: string, targetSha: string): string[] {
  const changed = changedPaths(root, baseSha, targetSha);
  const candidates =
    gateId === 'spec'
      ? ['SPEC.md']
      : gateId === 'design'
        ? ['DESIGN.md', 'PLAN.md', ...changed.filter((entry) => entry.startsWith('docs/adr/'))]
        : gateId === 'validation'
          ? ['VALIDATION.md', ...changed.filter((entry) => entry === 'test-execution.log')]
          : changed.filter(
              (entry) =>
                !['SPEC.md', 'DESIGN.md', 'PLAN.md', 'VALIDATION.md', 'test-execution.log'].includes(entry) &&
                !entry.startsWith('docs/adr/'),
            );
  const unique = [...new Set(candidates)];
  if (unique.length === 0) throw new CliError(`${gateId} gateの承認対象成果物がありません`);
  return unique;
}

function artifactsAtSha(
  root: string,
  paths: string[],
  targetSha: string,
  allowAbsent: boolean,
): { path: string; digest: string }[] {
  return paths.map((artifactPath) => ({
    path: artifactPath,
    digest: artifactDigestAtSha(root, artifactPath, targetSha, allowAbsent),
  }));
}

function artifactDigestAtSha(root: string, artifactPath: string, targetSha: string, allowAbsent = false): string {
  const shown = git(['show', `${targetSha}:${artifactPath}`], root);
  if (shown.status === 0) return artifactDigestOf(shown.stdout);
  if (allowAbsent) return ABSENT_ARTIFACT_DIGEST;
  throw new CliError(`target SHAの必須成果物を読めません: ${artifactPath}`);
}

function localReviewLauncherDigest(root: string, trustedBaseSha: string): string {
  const blobs = LOCAL_REVIEW_LAUNCHER_PATHS.map((launcherPath) => {
    const shown = git(['show', `${trustedBaseSha}:${launcherPath}`], root);
    if (shown.status !== 0) throw new CliError(`trusted baseのlauncher構成を読めません: ${launcherPath}`);
    return { path: launcherPath, digest: digestOf(shown.stdout) };
  });
  return digestOf(JSON.stringify(blobs));
}

function launcherTokenPayload(token: LauncherToken): Omit<LauncherToken, 'consumed_slots'> {
  const { consumed_slots: _consumedSlots, ...payload } = token;
  return payload;
}

function reserveLauncherTokenSlot(options: {
  tokenPath: string;
  attemptId: string;
  expectedCount: number;
  profile: 'standard' | 'strict';
  targetSha: string;
  baseSha: string;
  prNumber: string;
  reviewerRunId: string;
  slot: number;
}): { digest: string; finalSlot: boolean } {
  const tokenPath = path.resolve(options.tokenPath);
  const parent = path.dirname(tokenPath);
  const parentStat = fs.lstatSync(parent);
  const stat = fs.lstatSync(tokenPath);
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  if (
    path.basename(parent).startsWith('agent-skill-chain-local-review.') === false ||
    !parentStat.isDirectory() ||
    (uid !== undefined && parentStat.uid !== uid) ||
    (parentStat.mode & 0o077) !== 0 ||
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (uid !== undefined && stat.uid !== uid) ||
    (stat.mode & 0o777) !== 0o600
  ) {
    throw new CliError('launcher tokenの所有者・mode・隔離ディレクトリを検証できません');
  }
  let token: LauncherToken;
  try {
    token = JSON.parse(fs.readFileSync(tokenPath, 'utf8')) as LauncherToken;
  } catch {
    throw new CliError('launcher tokenを解釈できません');
  }
  const expectedFromProfile = options.profile === 'strict' ? 2 : 1;
  if (
    token.schema_version !== 'agent-skill-chain/launcher-token/v1' ||
    token.attempt_id !== options.attemptId ||
    token.expected_count !== options.expectedCount ||
    token.expected_count !== expectedFromProfile ||
    token.profile !== options.profile ||
    token.target_sha !== options.targetSha ||
    token.base_sha !== options.baseSha ||
    token.pr_number !== options.prNumber ||
    !/^attempt-[A-Za-z0-9._-]+$/.test(token.attempt_id) ||
    !/^[0-9a-f]{48}$/.test(token.nonce) ||
    token.slots.length !== token.expected_count ||
    token.slots.some(
      (entry, index) =>
        entry.slot !== index + 1 ||
        !/^review-[A-Za-z0-9._-]+$/.test(entry.run_id),
    ) ||
    token.slots[options.slot - 1]?.run_id !== options.reviewerRunId ||
    !Array.isArray(token.consumed_slots) ||
    token.consumed_slots.some((slot) => !Number.isInteger(slot) || slot < 1 || slot > token.expected_count) ||
    new Set(token.consumed_slots).size !== token.consumed_slots.length ||
    token.consumed_slots.includes(options.slot)
  ) {
    throw new CliError('launcher tokenがattempt/run/slot契約と一致しないか既に消費済みです');
  }
  const digest = digestOf(canonicalJson(launcherTokenPayload(token)));
  token.consumed_slots.push(options.slot);
  token.consumed_slots.sort((left, right) => left - right);
  const descriptor = fs.openSync(
    tokenPath,
    fs.constants.O_WRONLY | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW,
  );
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(token)}\n`);
  } finally {
    fs.closeSync(descriptor);
  }
  return { digest, finalSlot: token.consumed_slots.length === token.expected_count };
}

function assertDefaultBranchBase(
  pr: { head?: { sha?: string }; base?: { sha?: string; ref?: string } },
  repository: { default_branch?: string },
  expectedBaseSha: string,
  expectedHeadSha: string,
): void {
  if (
    !repository.default_branch ||
    pr.base?.ref !== repository.default_branch ||
    pr.base.sha !== expectedBaseSha ||
    pr.head?.sha !== expectedHeadSha
  ) {
    throw new CliError('PRがrepository default branchの指定base/head SHAを対象としていません');
  }
}

function assertNoCoordinationSecretInVerdict(verdictText: string): void {
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) {
    const secret = process.env[name];
    if (secret && verdictText.includes(secret)) {
      throw new CliError(`verdictに${name}由来のcoordination credentialが含まれています`);
    }
  }
  if (
    /(?:github_pat_[A-Za-z0-9_]{20,}|gh[opsu]_[A-Za-z0-9]{20,}|https?:\/\/[^/\s:@]+:[^@\s]+@)/.test(verdictText)
  ) {
    throw new CliError('verdictにcredential形式またはcredential-bearing URLが含まれています');
  }
}

/** レビュアCLI（`claude -p`等）の出力から、最初に出現する完全なJSONオブジェクト（`{`から対応する
 * `}`まで）を中括弧の対応関係で抽出する。Markdownコードフェンス（```json ... ``` / ``` ... ```）・
 * JSON本体の前後の説明文・tool-call試行らしきテキストのいずれが付いていても、埋め込まれたJSON本体
 * だけを取り出せる（Issue #303のフェンス限定対応をIssue #312で一般化）。文字列リテラル内の`{`・`}`は
 * エスケープを考慮しつつ構造としてカウントしない。対応する`{`が見つからない場合は入力をtrimして
 * そのまま返す（JSONとして妥当かどうかの判定は後続のJSON.parseに委ねる）。 */
function extractFirstJsonObject(text: string): string {
  const start = text.indexOf('{');
  if (start === -1) return text.trim();

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.trim();
}

function parseGhList<T>(stdout: string): T[] {
  const parsed = JSON.parse(stdout) as T[] | T[][];
  if (!Array.isArray(parsed)) throw new CliError('GitHub API一覧応答が配列ではありません');
  return parsed.flat() as T[];
}

function validateGateId(value: string): asserts value is Segment {
  validateSegment(value);
}

/** gate publish / gate reconcile 共通の Check Run 発行処理。 */
function publishCheckRun(
  root: string,
  checkName: string,
  headSha: string,
  conclusion: 'success' | 'failure' | 'action_required',
  title: string,
  summary: string,
  text?: string,
): { url?: string; error?: string } {
  const body = JSON.stringify({
    name: checkName,
    head_sha: headSha,
    status: 'completed',
    conclusion,
    output: { title, summary, ...(text ? { text } : {}) },
  });
  // gh api は --input だけではPOSTにならず既定のGETのまま送信されてしまう（-f/-Fを渡した場合の
  // みPOSTへ暗黙変更される。setup.ts の rulesetStep() と同様に -X で明示する必要がある）。
  const result = gh(['api', '-X', 'POST', 'repos/{owner}/{repo}/check-runs', '--input', '-'], root, body);
  if (result.status !== 0) return { error: result.stderr.trim() };
  try {
    const parsed = JSON.parse(result.stdout) as { html_url?: string };
    return { url: parsed.html_url ?? result.stdout.trim() };
  } catch {
    return { url: result.stdout.trim() };
  }
}

export async function review(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(REVIEW_USAGE);
      return 0;
    }
    const [issueIdRaw, gateId, profile, targetShaArg] = args;
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
    // target_sha が明示指定された場合はそれを採用する（CI環境ではentry.pathのHEADが
    // actions/checkoutのマージrefdetached HEADになりPRの実際のブランチ先端コミットと
    // 乖離するため。呼び出し元workflowがgithub.event.pull_request.head.shaを渡す）。
    // 未指定時は従来通りentry.pathのHEADから自己解決する（ローカル開発機での既存利用を維持）。
    const targetSha = targetShaArg || git(['rev-parse', 'HEAD'], entry.path).stdout.trim();
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

    const reportPath = reviewFilePath(root, number, gateId, config.coordination.backend);
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
    // 拒否するのは「真に未レビュー（final==pending）」のみ。human_required（レビュー完了・判定不能）は
    // action_required として発行させる（非同期 human レビュー・レビュア起動失敗のフェイルセーフを
    // 永久 pending にせず merge blocked として可視化するため）。
    if (report.gate.final === 'pending') {
      return fail('final が pending（未レビュー）のままの gate-report は publish できません');
    }
    // approved は conformance/falsification が両 pass である場合のみ許可する（矛盾拒否）。
    if (
      report.gate.final === 'approved' &&
      !(report.gate.conformance === 'pass' && report.gate.falsification === 'pass')
    ) {
      return fail(
        `final=approved だが conformance=${report.gate.conformance} / falsification=${report.gate.falsification}（両 pass でない）ため矛盾しています`,
      );
    }

    // ローカルモードでは reviews/<gate>.yaml が正本。GitHubモードでも Check Run（信号）とは別に
    // 同じ構造化レコードを一時記録する。gate-report.schema.yaml 準拠の approved_artifacts.digest は
    // Check Run の title/summary には収まらず、後続コマンド（adr finalize 等）が Coordination
    // Backend を問わず参照できる場所が必要なため。GitHubモードではこの一時記録先はリポジトリ
    // 作業ツリー内（root直下 `issues/`）ではなく os.tmpdir() 配下（Issue #399。過去にPR #238で
    // このパスがgit管理下へ誤commitされた実例がある）。
    const dest = reviewFilePath(root, number, report.gate.id, config.coordination.backend);
    writeYamlFileAtomic(dest, report);

    if (config.coordination.backend === 'local') {
      return ok(dest);
    }

    const checkName = config.checks[report.gate.id];
    const conclusion =
      report.gate.final === 'approved' ? 'success' : report.gate.final === 'rejected' ? 'failure' : 'action_required';
    const summary =
      report.gate.blockers.length === 0 ? 'no blockers' : `blockers: ${JSON.stringify(report.gate.blockers)}`;
    const published = publishCheckRun(
      root,
      checkName,
      report.gate.target_sha,
      conclusion,
      `${report.gate.id} gate: ${report.gate.final}`,
      summary,
      canonicalJson(report),
    );
    if (published.error) return fail(`Check Run 発行に失敗しました: ${published.error}`);
    return ok(published.url ?? '');
  });
}

function parseCheckRuns(stdout: string): {
  id?: number;
  conclusion?: string | null;
  check_suite?: { id?: number } | null;
  output?: { text?: string | null } | null;
}[] {
  const parsed = JSON.parse(stdout) as
    | { check_runs?: unknown[] }
    | { check_runs?: unknown[] }[];
  const pages = Array.isArray(parsed) ? parsed : [parsed];
  return pages.flatMap((page) => (Array.isArray(page.check_runs) ? page.check_runs : [])) as {
    id?: number;
    conclusion?: string | null;
    check_suite?: { id?: number } | null;
    output?: { text?: string | null } | null;
  }[];
}

function parseWorkflowRuns(stdout: string): { path?: string; event?: string }[] {
  const parsed = JSON.parse(stdout) as
    | { workflow_runs?: unknown[] }
    | { workflow_runs?: unknown[] }[];
  const pages = Array.isArray(parsed) ? parsed : [parsed];
  return pages.flatMap((page) => (Array.isArray(page.workflow_runs) ? page.workflow_runs : [])) as {
    path?: string;
    event?: string;
  }[];
}

function parseApprovedArtifacts(text: string, root: string): ApprovedArtifact[] | undefined {
  try {
    const report = JSON.parse(text) as GateReport;
    const validation = validateAgainstSchema('gate-report', report, root);
    if (!validation.valid) return undefined;
    return report.gate.approved_artifacts;
  } catch {
    return undefined;
  }
}

function resolveApprovedBaseline(
  root: string,
  gateId: Segment,
  targetSha: string,
  checkName: string,
  prNumber?: string,
): ApprovedBaseline {
  let resolvedPrNumber = prNumber;
  if (!resolvedPrNumber) {
    const pullsResponse = gh(
      ['api', `repos/{owner}/{repo}/commits/${targetSha}/pulls?per_page=100`, '--paginate', '--slurp'],
      root,
    );
    if (pullsResponse.status !== 0) {
      throw new CliError(`対象SHAに対応するPRを取得できません（${gateId}）: ${pullsResponse.stderr.trim()}`);
    }
    const pulls = parseGhList<{ number?: number }>(pullsResponse.stdout);
    const number = pulls.find((pull) => Number.isSafeInteger(pull.number) && Number(pull.number) > 0)?.number;
    if (!number) return { found: false };
    resolvedPrNumber = String(number);
  }

  const commitsResponse = gh(
    ['api', `repos/{owner}/{repo}/pulls/${resolvedPrNumber}/commits?per_page=100`, '--paginate', '--slurp'],
    root,
  );
  if (commitsResponse.status !== 0) {
    throw new CliError(`PRコミット履歴を取得できません（${gateId}）: ${commitsResponse.stderr.trim()}`);
  }
  const commits = parseGhList<{ sha?: string }>(commitsResponse.stdout);
  const targetIndex = commits.findIndex((commit) => commit.sha === targetSha);
  if (targetIndex < 0) {
    throw new CliError(`target_shaがPRコミット履歴に存在しません（${gateId}）: ${targetSha}`);
  }

  for (const commit of commits.slice(0, targetIndex).reverse()) {
    if (!commit.sha) continue;
    const checksResponse = gh(
      [
        'api',
        `repos/{owner}/{repo}/commits/${commit.sha}/check-runs?check_name=${encodeURIComponent(checkName)}&filter=all&per_page=100`,
        '--paginate',
        '--slurp',
      ],
      root,
    );
    if (checksResponse.status !== 0) {
      throw new CliError(`Check Run履歴を取得できません（${gateId}）: ${checksResponse.stderr.trim()}`);
    }

    const successfulChecks = parseCheckRuns(checksResponse.stdout)
      .filter((check) => check.conclusion === 'success')
      .sort((left, right) => (right.id ?? 0) - (left.id ?? 0));
    for (const candidate of successfulChecks) {
      const checkSuiteId = candidate.check_suite?.id;
      if (!Number.isSafeInteger(checkSuiteId) || Number(checkSuiteId) <= 0) continue;
      const actionsResponse = gh(
        [
          'api',
          `repos/{owner}/{repo}/actions/runs?check_suite_id=${checkSuiteId}&head_sha=${encodeURIComponent(commit.sha)}&per_page=100`,
          '--paginate',
          '--slurp',
        ],
        root,
      );
      if (actionsResponse.status !== 0) {
        throw new CliError(`Check Run発行元を取得できません（${gateId}）: ${actionsResponse.stderr.trim()}`);
      }
      const trustedSource = parseWorkflowRuns(actionsResponse.stdout).some((run) => {
        const allowedEvents = run.path ? TRUSTED_WORKFLOW_EVENTS[run.path] : undefined;
        return Boolean(allowedEvents && run.event && allowedEvents.includes(run.event));
      });
      if (!trustedSource || typeof candidate.output?.text !== 'string') continue;
      const approvedArtifacts = parseApprovedArtifacts(candidate.output.text, root);
      if (approvedArtifacts) return { found: true, approvedArtifacts };
    }
  }
  return { found: false };
}

function readReconcileReport(
  root: string,
  issueNumber: string,
  gateId: Segment,
  targetSha: string,
  githubBackend: boolean,
): GateReport | undefined {
  const reportPath = reviewFilePath(root, issueNumber, gateId);
  try {
    if (!githubBackend) return readYamlFile<GateReport>(reportPath);

    const relativeReportPath = path.relative(root, reportPath).split(path.sep).join('/');
    const targetRef = `refs/agent-skill-chain/targets/${targetSha}`;
    const shown = git(['show', `${targetRef}:${relativeReportPath}`], root);
    if (shown.status !== 0) return undefined;
    return parseYaml(shown.stdout) as GateReport;
  } catch {
    return undefined;
  }
}

export async function reconcile(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(RECONCILE_USAGE);
      return 0;
    }
    const [issueIdRaw, targetSha, prNumber] = args;
    if (!issueIdRaw || !targetSha) throw new CliError('issue_id, target_sha はすべて必須です');
    if (prNumber && (!/^[1-9][0-9]*$/.test(prNumber) || !Number.isSafeInteger(Number(prNumber)))) {
      throw new CliError(`pr_numberは正の安全な整数である必要があります: '${prNumber}'`);
    }
    const { number } = parseIssueId(issueIdRaw);

    const root = repoRoot();
    const config = loadConfig(root);

    // 変数名は出力メッセージの語（`reissued: ...`。後方互換のため不変）とは独立させる
    // （英単語 `reissued` は禁止語を部分文字列として偶然含むため、変数名としては避ける）。
    const refreshed: string[] = [];
    const invalidated: string[] = [];
    let downstreamInvalidated = false;
    const githubBackend = config.coordination.backend === 'github';

    for (const gateId of SEGMENTS) {
      // Issue #399: 書込み先（このgateIdのreconcile結果をローカルへ併記する場所）は
      // `gate review`/`gate publish` と同じ規約でbackendに応じて分岐させる（GitHubモードは
      // os.tmpdir() 配下、root直下 `issues/` は使わない）。`readReconcileReport` がGitHubモードで
      // 読むのはこの実際の書込み先ではなくgit ref（PR head の read-only git object）内の
      // ローカル規約（root相対）の仮想パスであり、両者は独立している（`readReconcileReport`
      // 自身の実装を参照）。
      const reportPath = reviewFilePath(root, number, gateId, config.coordination.backend);
      const report = readReconcileReport(root, number, gateId, targetSha, githubBackend);
      if (!report) continue; // このゲートは未レビュー・未発行

      const baseline =
        githubBackend
          ? resolveApprovedBaseline(root, gateId, targetSha, config.checks[gateId], prNumber)
          : { found: true as const, approvedArtifacts: report.gate.approved_artifacts };
      if (!baseline.found) continue;

      const changed =
        downstreamInvalidated ||
        baseline.approvedArtifacts.some(
          (artifact) =>
            artifactDigestAtSha(root, artifact.path, targetSha, gateId === 'implementation') !== artifact.digest,
        );

      if (changed) {
        report.gate.conformance = 'pending';
        report.gate.falsification = 'pending';
        report.gate.final = 'pending';
        writeYamlFileAtomic(reportPath, report);
        invalidated.push(gateId);
        downstreamInvalidated = true;
      } else {
        report.gate.target_sha = targetSha;
        if (githubBackend) {
          report.gate.approved_artifacts = baseline.approvedArtifacts;
        }
        writeYamlFileAtomic(reportPath, report);
        refreshed.push(gateId);
      }

      // ローカルモードでは reviews/<gate>.yaml（上記writeYamlFileAtomic）が正本。GitHubモードでは
      // Check Runが調整状態の正本（Coordination Backend が GitHub の場合の唯一の正本）のため、
      // 新しいtarget_shaに対して再発行または無効化のCheck Runを明示的に発行し直す必要がある
      // （発行しないと新SHAにrequired status checkが一切存在せず、merge判定が永久にpending留まりになる）。
      if (githubBackend) {
        const checkName = config.checks[gateId];
        const published = changed
          ? publishCheckRun(
              root,
              checkName,
              targetSha,
              'action_required',
              `${gateId} gate: invalidated`,
              `approved artifacts changed at ${targetSha}; ${gateId} gate must be re-reviewed`,
              canonicalJson(report),
            )
          : publishCheckRun(
              root,
              checkName,
              targetSha,
              'success',
              `${gateId} gate: reconciled`,
              `approved artifacts unchanged; reissued for ${targetSha}`,
              canonicalJson(report),
            );
        if (published.error) return fail(`Check Run 再発行に失敗しました（${gateId}）: ${published.error}`);
      }
    }

    return ok(
      [`reissued: ${refreshed.join(', ') || '(none)'}`, `invalidated: ${invalidated.join(', ') || '(none)'}`].join('\n'),
    );
  });
}

/**
 * レビュア verdict（stdin JSON）を pending gate-report へ結線して判定済み gate-report を書く。
 * read-only レビュア（AI/人間）は verdict を返すだけで gate-report を書かない。書込みは trusted な
 * 本コマンドに限定する（ADR-1 の read-only 契約を機構的に担保する）。
 */
export async function recordVerdict(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(RECORD_VERDICT_USAGE);
      return 0;
    }
    const [gateReportPath, artifactBaseDir, expectedReviewerCountRaw] = args;
    if (!gateReportPath) throw new CliError('gate_report_path は必須です');
    if (!fs.existsSync(gateReportPath)) throw new CliError(`gate-report が存在しません: ${gateReportPath}`);
    let expectedReviewerCount: number | undefined;
    if (expectedReviewerCountRaw !== undefined) {
      expectedReviewerCount = Number(expectedReviewerCountRaw);
      if (!Number.isInteger(expectedReviewerCount) || expectedReviewerCount < 1) {
        throw new CliError('expected_reviewer_count は1以上の整数である必要があります');
      }
    }

    const root = repoRoot();
    const report = readYamlFile<GateReport>(gateReportPath);
    const base = validateAgainstSchema('gate-report', report, root);
    if (!base.valid) return fail(`入力 gate-report がスキーマに適合しません: ${base.errors.join('; ')}`);

    let parsedVerdict: ReviewerVerdict | ReviewerVerdict[];
    try {
      parsedVerdict = JSON.parse(fs.readFileSync(0, 'utf8')) as ReviewerVerdict | ReviewerVerdict[];
    } catch (error) {
      return fail(`verdict JSON を解釈できません: ${error instanceof Error ? error.message : String(error)}`);
    }

    const verdicts = Array.isArray(parsedVerdict) ? parsedVerdict : [parsedVerdict];
    if (verdicts.length === 0) return fail('verdict は1件以上必要です');
    if (expectedReviewerCount !== undefined && verdicts.length !== expectedReviewerCount) {
      return fail(
        `独立 reviewer verdict 件数が不足しています: expected=${expectedReviewerCount}, actual=${verdicts.length}`,
      );
    }
    if (expectedReviewerCount !== undefined && !Array.isArray(parsedVerdict)) {
      return fail('expected_reviewer_count 指定時の verdict JSON は独立 verdict の配列である必要があります');
    }
    const verdict = aggregateVerdicts(verdicts);
    const conformance = verdict.conformance ?? 'pending';
    const falsification = verdict.falsification ?? 'pending';
    if (!SUBVERDICT_VALUES.has(conformance) || !SUBVERDICT_VALUES.has(falsification)) {
      return fail('verdict の conformance / falsification は pass|fail|pending のいずれかである必要があります');
    }

    const approvedArtifactsByPath = new Map<string, string>();
    for (const artifact of verdict.approved_artifacts ?? []) {
      let digest: string;
      if (artifactBaseDir) {
        digest = artifactDigestOfFile(path.join(artifactBaseDir, artifact.path));
      } else if (artifact.digest) {
        digest = artifact.digest;
      } else {
        return fail(
          `approved_artifacts '${artifact.path}' に digest が無く artifact_base_dir も指定されていないため digest を確定できません`,
        );
      }
      const existing = approvedArtifactsByPath.get(artifact.path);
      if (existing && existing !== digest) {
        return fail(`approved_artifacts '${artifact.path}' の digest が独立 verdict 間で一致しません`);
      }
      approvedArtifactsByPath.set(artifact.path, digest);
    }
    const approvedArtifacts = [...approvedArtifactsByPath].map(([artifactPath, digest]) => ({
      path: artifactPath,
      digest,
    }));

    const final = deriveFinal(verdict);
    report.gate.conformance = conformance;
    report.gate.falsification = falsification;
    report.gate.final = final;
    report.gate.blockers = verdict.blockers ?? [];
    if (approvedArtifacts.length > 0) report.gate.approved_artifacts = approvedArtifacts;
    if (verdict.approved_digest) report.gate.approved_digest = verdict.approved_digest;

    const outcome = validateAgainstSchema('gate-report', report, root);
    if (!outcome.valid) return fail(`結線後の gate-report がスキーマに適合しません: ${outcome.errors.join('; ')}`);

    writeYamlFileAtomic(gateReportPath, report);
    return ok(`final: ${final}`);
  });
}

export async function submitEvidence(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(SUBMIT_EVIDENCE_USAGE);
      return 0;
    }
    const [
      issueIdRaw,
      gateId,
      profile,
      targetSha,
      baseSha,
      trustedBaseSha,
      prNumber,
      attemptId,
      expectedCountRaw,
      reviewerRunId,
      slotRaw,
      adapterRaw,
      model,
      reasoning,
    ] = args;
    if (
      !issueIdRaw ||
      !gateId ||
      !profile ||
      !targetSha ||
      !baseSha ||
      !trustedBaseSha ||
      !prNumber ||
      !attemptId ||
      !expectedCountRaw ||
      !reviewerRunId ||
      !slotRaw ||
      !adapterRaw ||
      model === undefined ||
      reasoning === undefined
    ) {
      throw new CliError('submit-evidenceの引数が不足しています');
    }
    const { issueId, number } = parseIssueId(issueIdRaw);
    validateGateId(gateId);
    if (profile !== 'standard' && profile !== 'strict') throw new CliError('profileはstandard|strictのみです');
    if (adapterRaw !== 'codex' && adapterRaw !== 'claude' && adapterRaw !== 'human') {
      throw new CliError(`未登録adapterはevidenceを投稿できません: ${adapterRaw}`);
    }
    const slot = Number(slotRaw);
    const expectedCount = Number(expectedCountRaw);
    const expectedFromProfile = profile === 'strict' ? 2 : 1;
    if (!Number.isInteger(slot) || slot < 1 || slot > 2) throw new CliError('slotは1|2のみです');
    if (expectedCount !== expectedFromProfile) throw new CliError('expected_countがprofileと一致しません');
    if (!/^attempt-[A-Za-z0-9._-]+$/.test(attemptId)) throw new CliError('attempt_id形式が不正です');
    if (!/^review-[A-Za-z0-9._-]+$/.test(reviewerRunId)) throw new CliError('reviewer_run_id形式が不正です');
    const launcherTokenPath = process.env.ASC_LAUNCHER_TOKEN_FILE;
    if (!launcherTokenPath) throw new CliError('launcher token fileがありません');

    const root = repoRoot();
    const executionRoot = worktreeRoot();
    if (executionRoot !== root) throw new CliError('Issue worktreeのcandidate recorderからevidenceを投稿できません');
    const prResponse = gh(['api', `repos/{owner}/{repo}/pulls/${prNumber}`], root);
    const repositoryResponse = gh(['api', 'repos/{owner}/{repo}'], root);
    if (prResponse.status !== 0 || repositoryResponse.status !== 0) {
      throw new CliError('PRのprotected default base/head metadataを取得できません');
    }
    const pr = JSON.parse(prResponse.stdout) as { head?: { sha?: string }; base?: { sha?: string; ref?: string } };
    const repository = JSON.parse(repositoryResponse.stdout) as { default_branch?: string };
    if (baseSha !== trustedBaseSha) throw new CliError('base SHAとtrusted base SHAが一致しません');
    assertDefaultBranchBase(pr, repository, baseSha, targetSha);
    const head = git(['rev-parse', 'HEAD'], root).stdout.trim();
    if (head !== trustedBaseSha) throw new CliError('recorder HEADがtrusted base SHAと一致しません');
    // gate-local-review.sh は起動前に untracked を含む完全な clean 状態を確認する。
    // その後 gate-review.sh が Git 管理外の coordination scaffold を生成するため、
    // recorder では tracked file の改変だけを再検査する。
    if (git(['status', '--porcelain', '--untracked-files=no'], root).stdout.trim()) {
      throw new CliError('trusted base worktreeのtracked fileがdirtyです');
    }

    const policy = classifyCoreReview(root, { targetSha, baseRef: baseSha }).policy;
    if (!policy) throw new CliError('登録済みreview policyがありません');
    const artifacts = artifactsAtSha(
      root,
      expectedArtifactPaths(root, gateId, baseSha, targetSha),
      targetSha,
      gateId === 'implementation',
    );
    const promptDigest = evidencePromptDigest(buildReviewerPrompt(root, number, gateId, targetSha, baseSha));
    const launcherDigest = localReviewLauncherDigest(root, trustedBaseSha);
    let parsedVerdict: unknown;
    try {
      const verdictText = fs.readFileSync(0, 'utf8');
      assertNoCoordinationSecretInVerdict(verdictText);
      parsedVerdict = JSON.parse(extractFirstJsonObject(verdictText));
    } catch (error) {
      throw new CliError(`verdict JSONを解釈できません: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isEvidenceVerdict(parsedVerdict, false)) {
      throw new CliError('verdict JSONが必須enum・finding・inconclusive契約に適合しません');
    }
    const verdict: EvidenceVerdict = { ...parsedVerdict, approved_artifacts: artifacts };

    const core = classifyCoreReview(root, { targetSha, baseRef: baseSha });
    if (core.required && (core.status !== 'resolved' || profile !== 'strict')) {
      throw new CliError('コア対象の分類またはStrict profileを確認できません');
    }
    if (
      core.required &&
      adapterRaw === 'codex' &&
      (model !== policy.adapters.codex.model || reasoning !== policy.adapters.codex.reasoning_effort)
    ) {
      throw new CliError('Codex core reviewerのmodel/reasoningがpolicyと一致しません');
    }
    if (core.required && adapterRaw === 'claude' && process.env.ASC_CAPABILITY_PROBE_PASSED !== 'true') {
      throw new CliError('Claude core reviewerのcapability probe成功を確認できません');
    }
    const launcherToken = reserveLauncherTokenSlot({
      tokenPath: launcherTokenPath,
      attemptId,
      expectedCount,
      profile,
      targetSha,
      baseSha,
      prNumber,
      reviewerRunId,
      slot,
    });

    const evidence: ReviewEvidence = {
      schema_version: 'agent-skill-chain/gate-review-evidence/v3',
      issue_id: issueId,
      gate: gateId,
      profile,
      target_sha: targetSha,
      attempt_id: attemptId,
      expected_count: expectedCount as 1 | 2,
      execution: {
        launcher: 'agent-skill-chain/gate-local-review/v1',
        trusted_base_sha: trustedBaseSha,
        launcher_digest: launcherDigest,
        launcher_token_digest: launcherToken.digest,
        isolation: 'ephemeral_clone',
        sandbox: 'read_only',
      },
      reviewer: {
        run_id: reviewerRunId,
        slot: slot as 1 | 2,
        adapter: adapterRaw,
        model,
        reasoning,
        capability: {
          model_tier: core.required ? policy.capability.model_tier : 'explicit_selection',
          reasoning_tier: core.required ? policy.capability.reasoning_tier : 'explicit_selection',
          read_only: true,
        },
      },
      prompt_digest: promptDigest,
      verdict,
    };
    const body = JSON.stringify({ body: renderReviewEvidence(evidence), event: 'COMMENT', commit_id: targetSha });
    const submitted = gh(
      ['api', '-X', 'POST', `repos/{owner}/{repo}/pulls/${prNumber}/reviews`, '--input', '-'],
      root,
      body,
    );
    if (submitted.status !== 0) return fail(`PR review evidence投稿に失敗しました: ${submitted.stderr.trim()}`);
    if (launcherToken.finalSlot) fs.unlinkSync(launcherTokenPath);
    return ok(submitted.stdout.trim());
  });
}

function buildVerifiedGateReport(options: {
  root: string;
  issueId: string;
  issueNumber: string;
  gateId: Segment;
  profile: 'standard' | 'strict';
  targetSha: string;
  baseSha: string;
  reviewSubject?: 'ordinary' | 'core_audit';
  repository: { default_branch?: string };
  pullRequest: {
    user: { login: string | null } | null;
    head: { sha: string };
    base: { sha: string; ref: string };
  };
  commits: { author: { login: string | null } | null; committer: { login: string | null } | null }[];
  reviews: GithubReviewRecord[];
}): { report: GateReport; reason?: string } {
  const policy = classifyCoreReview(options.root, {
    targetSha: options.targetSha,
    baseRef: options.baseSha,
    reviewSubject: options.reviewSubject,
  });
  if (!policy.policy) throw new CliError('登録済みreview policyがありません');
  if (
    policy.required &&
    (policy.status !== 'resolved' || options.profile !== policy.policy.required_profile)
  ) {
    throw new CliError('コア対象には解決済み分類とStrict profileが必要です');
  }
  assertDefaultBranchBase(
    options.pullRequest,
    options.repository,
    options.baseSha,
    options.targetSha,
  );
  const writerLogins = [
    options.pullRequest.user?.login,
    ...options.commits.flatMap((commit) => [commit.author?.login, commit.committer?.login]),
  ];
  const unresolvedWriterActor = writerLogins.some((login) => !login);
  const writerActors = [...new Set(writerLogins.filter((login): login is string => !!login))];
  const artifacts = artifactsAtSha(
    options.root,
    expectedArtifactPaths(options.root, options.gateId, options.baseSha, options.targetSha),
    options.targetSha,
    options.gateId === 'implementation',
  );
  const promptDigest = evidencePromptDigest(
    buildReviewerPrompt(
      options.root,
      options.issueNumber,
      options.gateId,
      options.targetSha,
      options.baseSha,
    ),
  );
  const launcherDigest = localReviewLauncherDigest(options.root, options.baseSha);
  const result = verifyGithubReviewEvidence({
    reviews: options.reviews,
    issueId: options.issueId,
    gate: options.gateId,
    profile: options.profile,
    targetSha: options.targetSha,
    trustedActors: policy.policy.execution.trusted_reviewer_actors,
    writerActors,
    unresolvedWriterActor,
    expectedPromptDigest: promptDigest,
    expectedArtifacts: artifacts,
    expectedTrustedBaseSha: options.baseSha,
    expectedLauncherDigest: launcherDigest,
    coreReviewRequired: policy.required,
    codexModel: policy.policy.adapters.codex.model,
    codexReasoning: policy.policy.adapters.codex.reasoning_effort,
  });
  const report: GateReport = {
    schema_version: 'agent-skill-chain/gate-report/v1',
    gate: {
      id: options.gateId,
      target_sha: options.targetSha,
      conformance: result.conformance,
      falsification: result.falsification,
      final: result.final,
      blockers: result.blockers,
      approved_digest: digestOf(JSON.stringify(result.approved_artifacts)),
      approved_artifacts: result.approved_artifacts,
      reviewers: result.reviewers,
      ...(result.review_attempt ? { review_attempt: result.review_attempt } : {}),
    },
  };
  const validation = validateAgainstSchema('gate-report', report, options.root);
  if (!validation.valid) {
    throw new CliError(`検証済みgate-reportがschema不適合です: ${validation.errors.join('; ')}`);
  }
  return { report, reason: result.reason };
}

function buildVerifiedGateReportFromTrustedContext(
  root: string,
  context: TrustedGateApiContext,
): { report: GateReport; reason?: string } {
  return buildVerifiedGateReport({
    root,
    issueId: context.issueId,
    issueNumber: String(context.issueNumber),
    gateId: context.payload.gate,
    profile: context.profile,
    targetSha: context.payload.target_sha,
    baseSha: context.pullRequest.base.sha,
    reviewSubject: context.reviewSubject,
    repository: context.repository,
    pullRequest: context.pullRequest,
    commits: context.commits,
    reviews: context.reviews,
  });
}

export async function verifyEvidence(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(VERIFY_EVIDENCE_USAGE);
      return 0;
    }
    const [issueIdRaw, gateId, profile, targetSha, baseSha, prNumber, reportPath, reviewSubjectRaw] = args;
    if (!issueIdRaw || !gateId || !profile || !targetSha || !baseSha || !prNumber || !reportPath) {
      throw new CliError('verify-evidenceの引数が不足しています');
    }
    const { issueId, number } = parseIssueId(issueIdRaw);
    validateGateId(gateId);
    if (profile !== 'standard' && profile !== 'strict') throw new CliError('profileはstandard|strictのみです');
    if (reviewSubjectRaw && reviewSubjectRaw !== 'ordinary' && reviewSubjectRaw !== 'core_audit') {
      throw new CliError('review_subjectはordinary|core_auditのみです');
    }

    const root = repoRoot();
    const prResponse = gh(['api', `repos/{owner}/{repo}/pulls/${prNumber}`], root);
    const repositoryResponse = gh(['api', 'repos/{owner}/{repo}'], root);
    const commitsResponse = gh(
      ['api', `repos/{owner}/{repo}/pulls/${prNumber}/commits?per_page=100`, '--paginate', '--slurp'],
      root,
    );
    const reviewsResponse = gh(
      ['api', `repos/{owner}/{repo}/pulls/${prNumber}/reviews?per_page=100`, '--paginate', '--slurp'],
      root,
    );
    if (
      prResponse.status !== 0 ||
      repositoryResponse.status !== 0 ||
      commitsResponse.status !== 0 ||
      reviewsResponse.status !== 0
    ) {
      throw new CliError('GitHub PR/commit/review metadataを取得できません');
    }
    const pr = JSON.parse(prResponse.stdout) as {
      user: { login: string | null } | null;
      head: { sha: string };
      base: { sha: string; ref: string };
    };
    const repository = JSON.parse(repositoryResponse.stdout) as { default_branch?: string };
    const commits = parseGhList<{
      author: { login: string | null } | null;
      committer: { login: string | null } | null;
    }>(commitsResponse.stdout);
    const verified = buildVerifiedGateReport({
      root,
      issueId,
      issueNumber: number,
      gateId,
      profile,
      targetSha,
      baseSha,
      reviewSubject: reviewSubjectRaw as 'ordinary' | 'core_audit' | undefined,
      repository,
      pullRequest: pr,
      commits,
      reviews: parseGhList<GithubReviewRecord>(reviewsResponse.stdout),
    });
    writeYamlFileAtomic(reportPath, verified.report);
    return ok(
      `final: ${verified.report.gate.final}${verified.reason ? `\nreason: ${verified.reason}` : ''}`,
    );
  });
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new CliError(`${name}が構成されていません`);
  return value;
}

function trustedGateEventFromEnvironment(): ReturnType<typeof parseTrustedGateDispatchEvent> {
  const eventPath = requiredEnvironment('GITHUB_EVENT_PATH');
  let event: unknown;
  try {
    event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  } catch {
    throw new CliError('GITHUB_EVENT_PATHのrepository_dispatch eventを解釈できません');
  }
  return parseTrustedGateDispatchEvent(event);
}

export function consumeTrustedGateSecrets(
  env: NodeJS.ProcessEnv = process.env,
): {
  githubToken: string;
  credentials: { appId: string; privateKey: string };
} {
  const appId = env.ASC_GATE_APP_ID;
  const privateKey = env.ASC_GATE_APP_PRIVATE_KEY;
  const githubToken = env.GITHUB_TOKEN;
  if (!appId) throw new CliError('ASC_GATE_APP_IDが構成されていません');
  if (!privateKey) throw new CliError('ASC_GATE_APP_PRIVATE_KEYが構成されていません');
  if (!githubToken) throw new CliError('GITHUB_TOKENが構成されていません');

  // secretはdirect fetchの明示引数だけに閉じ込める。以後のgit/gh/npm等の子processへ
  // process.env経由で継承させない。CLI processはphase完了後に終了するため復元もしない。
  delete env.ASC_GATE_APP_PRIVATE_KEY;
  delete env.GITHUB_TOKEN;
  return {
    githubToken,
    credentials: { appId, privateKey },
  };
}

function assertTrustedRecorderCheckout(root: string, workflowSha: string, targetSha: string): void {
  const head = git(['rev-parse', 'HEAD'], root).stdout.trim();
  if (head !== workflowSha) throw new CliError('trusted recorder checkoutがGITHUB_WORKFLOW_SHAと一致しません');
  if (git(['status', '--porcelain', '--untracked-files=no'], root).stdout.trim()) {
    throw new CliError('trusted recorder checkoutのtracked fileがdirtyです');
  }
  if (git(['rev-parse', '--verify', `${targetSha}^{commit}`], root).status !== 0) {
    throw new CliError('dispatch target SHAのGit objectがありません');
  }
}

function assertTrustedActionRun(
  actionRun: TrustedGateActionRun,
  state: TrustedGateRecordState,
): void {
  if (
    actionRun.id !== state.workflow.run_id ||
    actionRun.run_number !== state.workflow.run_number ||
    actionRun.run_attempt !== state.workflow.run_attempt ||
    actionRun.path !== TRUSTED_GATE_WORKFLOW_PATH ||
    actionRun.head_sha !== state.workflow.sha ||
    actionRun.head_branch !== 'main' ||
    actionRun.event !== 'repository_dispatch' ||
    actionRun.status !== 'in_progress' ||
    actionRun.conclusion !== null
  ) {
    throw new CliError('Actions APIのworkflow run/attempt/source tupleがcurrent in-progress runと一致しません');
  }
}

export async function recordTrustedCheck(args: string[]): Promise<number> {
  return guard(async () => {
    if (isHelp(args)) {
      printUsage(RECORD_TRUSTED_CHECK_USAGE);
      return 0;
    }
    const [phase, firstPath, secondPath] = args;
    if (!phase || !['validate', 'prepare', 'finalize'].includes(phase)) {
      throw new CliError('record-trusted-check phaseはvalidate|prepare|finalizeのみです');
    }
    const event = trustedGateEventFromEnvironment();
    const workflow = parseTrustedGateWorkflow(process.env);
    if (phase === 'validate') {
      if (args.length !== 1) throw new CliError('validateに追加引数は指定できません');
      return ok(
        [
          `pr_number=${event.payload.pr_number}`,
          `gate=${event.payload.gate}`,
          `target_sha=${event.payload.target_sha}`,
        ].join('\n'),
      );
    }
    const repository = requiredEnvironment('GITHUB_REPOSITORY');
    const { githubToken, credentials } = consumeTrustedGateSecrets();
    const root = repoRoot();
    assertTrustedRecorderCheckout(root, workflow.sha, event.payload.target_sha);

    if (phase === 'prepare') {
      if (!firstPath || !secondPath || args.length !== 3) {
        throw new CliError('prepareにはstate_pathとattestation_envelope_pathが必要です');
      }
      const context = await fetchTrustedGateApiContext({
        actor: event.actor,
        payload: event.payload,
        repository,
        githubToken,
      });
      const verified = buildVerifiedGateReportFromTrustedContext(root, context);
      if (!verified.report.gate.review_attempt) {
        throw new CliError(`latest v3 review attemptを検証できません${verified.reason ? `: ${verified.reason}` : ''}`);
      }
      const config = loadConfig(root);
      const check = await createTrustedGateCheck({
        repository,
        repositoryId: context.repository.id,
        credentials,
        checkName: config.checks[event.payload.gate],
        payload: event.payload,
        workflow,
      });
      const attestation = buildTrustedGateAttestation({
        repository: context.repository,
        payload: event.payload,
        workflow,
        check,
        report: verified.report,
      });
      const state: TrustedGateRecordState = {
        schema_version: 'agent-skill-chain/trusted-gate-record-state/v1',
        actor: event.actor,
        payload: event.payload,
        issue_id: context.issueId,
        profile: context.profile,
        review_subject: context.reviewSubject,
        base_sha: context.pullRequest.base.sha,
        workflow,
        check,
        report: verified.report,
        report_oversize: canonicalReportIsOversize(verified.report),
        attestation,
      };
      writeTrustedGateRecordState(firstPath, secondPath, state);
      return ok(`state_path=${path.resolve(firstPath)}\nattestation_path=${path.resolve(secondPath)}`);
    }

    const verificationPath = args[3];
    if (!firstPath || !secondPath || !verificationPath || args.length !== 4) {
      throw new CliError('finalizeにはstate_path、attestation_envelope_path、verification_json_pathが必要です');
    }
    const state = readTrustedGateRecordState(firstPath);
    if (
      state.actor !== event.actor ||
      canonicalJson(state.payload) !== canonicalJson(event.payload) ||
      canonicalJson(state.workflow) !== canonicalJson(workflow)
    ) {
      throw new CliError('stateのdispatch actor/payload/workflow tupleがcurrent runと一致しません');
    }
    const envelopeBytes = fs.readFileSync(secondPath);
    let envelope: TrustedGateAttestationEnvelope;
    let verification: unknown;
    try {
      envelope = JSON.parse(envelopeBytes.toString('utf8')) as TrustedGateAttestationEnvelope;
      verification = JSON.parse(fs.readFileSync(verificationPath, 'utf8'));
    } catch {
      throw new CliError('attestation envelopeまたはverification JSONを解釈できません');
    }
    if (
      envelopeBytes.toString('utf8') !== `${canonicalJson(envelope)}\n` ||
      canonicalJson(envelope) !== canonicalJson(state.attestation)
    ) {
      throw new CliError('attestation envelope bytesがprepared stateと一致しません');
    }
    assertTrustedGateAttestationVerification({ verification, envelopeBytes, envelope });

    const context = await fetchTrustedGateApiContext({
      actor: event.actor,
      payload: event.payload,
      repository,
      githubToken,
    });
    const current = buildVerifiedGateReportFromTrustedContext(root, context);
    if (
      context.issueId !== state.issue_id ||
      context.profile !== state.profile ||
      context.reviewSubject !== state.review_subject ||
      context.pullRequest.base.sha !== state.base_sha ||
      canonicalJson(current.report) !== canonicalJson(state.report)
    ) {
      throw new CliError('finalize時のIssue/profile/base/evidence/artifact正本がprepared reportから変化しました');
    }
    const currentCheck = await readTrustedGateCheck({
      repository,
      repositoryId: state.attestation.repository.id,
      credentials,
      checkId: state.check.id,
    });
    const expectedExternalId = trustedGateExternalId(workflow, event.payload);
    assertTrustedAppCheck({
      check: currentCheck,
      expectedAppId: Number(credentials.appId),
      expectedName: state.check.name,
      expectedSha: event.payload.target_sha,
      expectedExternalId,
      expectedStatus: 'in_progress',
    });
    if (currentCheck.conclusion !== null || currentCheck.id !== envelope.check.id) {
      throw new CliError('Checkがreplayされたか既にcompletedです');
    }
    const currentActionRun = await githubJsonDirect<TrustedGateActionRun>(
      fetch,
      githubToken,
      `/repos/${repository}/actions/runs/${workflow.run_id}`,
    );
    assertTrustedActionRun(currentActionRun, state);
    const rebuiltAttestation = buildTrustedGateAttestation({
      repository: context.repository,
      payload: event.payload,
      workflow,
      check: currentCheck,
      report: current.report,
    });
    if (canonicalJson(rebuiltAttestation) !== canonicalJson(envelope)) {
      throw new CliError('attestationのrepository/report/review/check bindingを再構築できません');
    }
    const reportOversize = canonicalReportIsOversize(current.report);
    if (reportOversize !== state.report_oversize) {
      throw new CliError('canonical report size判定がprepared stateと一致しません');
    }

    // success/failure/action_requiredを確定するApp PATCHが最後の外部操作。これ以降に再取得・
    // attestation検査・filesystem更新を追加してはならない。
    await finalizeTrustedGateCheck({
      repository,
      repositoryId: state.attestation.repository.id,
      credentials,
      checkId: currentCheck.id,
      report: current.report,
      attestation: rebuiltAttestation,
      reportOversize,
    });
    return 0;
  });
}

export async function materializeCheckReport(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(MATERIALIZE_CHECK_REPORT_USAGE);
      return 0;
    }
    const [issueIdRaw, gateId, targetSha, reportPath] = args;
    if (!issueIdRaw || !gateId || !targetSha || !reportPath) {
      throw new CliError('materialize-check-reportの引数が不足しています');
    }
    parseIssueId(issueIdRaw);
    validateGateId(gateId);
    const root = repoRoot();
    const config = loadConfig(root);
    if (config.coordination.backend !== 'github') {
      throw new CliError('materialize-check-reportはGitHub backend専用です');
    }
    const checkName = config.checks[gateId];
    const expectedAppIdRaw = requiredEnvironment('ASC_GATE_APP_ID');
    if (!/^[1-9][0-9]*$/.test(expectedAppIdRaw) || !Number.isSafeInteger(Number(expectedAppIdRaw))) {
      throw new CliError('ASC_GATE_APP_IDは正の安全な整数である必要があります');
    }
    const expectedAppId = Number(expectedAppIdRaw);
    const repositoryResponse = gh(['api', 'repos/{owner}/{repo}'], root);
    const checksResponse = gh(
      [
        'api',
        `repos/{owner}/{repo}/commits/${targetSha}/check-runs?check_name=${encodeURIComponent(checkName)}&filter=all&per_page=100`,
        '--paginate',
        '--slurp',
      ],
      root,
    );
    const actionsResponse = gh(
      [
        'api',
        `repos/{owner}/{repo}/actions/workflows/${encodeURIComponent(TRUSTED_GATE_WORKFLOW_PATH)}/runs?event=repository_dispatch&branch=main&per_page=100`,
        '--paginate',
        '--slurp',
      ],
      root,
    );
    if (repositoryResponse.status !== 0 || checksResponse.status !== 0 || actionsResponse.status !== 0) {
      throw new CliError('repository、Check Run、Actions runのAPI正本を取得できません');
    }
    const repository = JSON.parse(repositoryResponse.stdout) as TrustedGateRepository;
    if (
      !Number.isSafeInteger(repository.id) ||
      repository.id <= 0 ||
      !repository.full_name ||
      repository.default_branch !== 'main'
    ) {
      throw new CliError('repository identity/default branchを解決できません');
    }
    const parsedChecks = JSON.parse(checksResponse.stdout) as
      | { check_runs?: TrustedGateCheckRun[] }
      | { check_runs?: TrustedGateCheckRun[] }[];
    const checkPages = Array.isArray(parsedChecks) ? parsedChecks : [parsedChecks];
    const checkRuns = checkPages.flatMap((page) => page.check_runs ?? []);
    const potentialOutputs = checkRuns.flatMap((run) => {
      if (
        run.app?.id !== expectedAppId ||
        run.app?.name === 'GitHub Actions' ||
        run.app?.slug === 'github-actions' ||
        run.name !== checkName ||
        run.head_sha !== targetSha ||
        typeof run.output?.text !== 'string'
      ) {
        return [];
      }
      try {
        return [{ run, output: parseTrustedGateCheckOutput(run.output.text) }];
      } catch {
        return [];
      }
    });
    const prNumbers = new Set(
      potentialOutputs.map(({ output }) => output.attestation.pr_number),
    );
    if (prNumbers.size !== 1) {
      throw new CliError('専用App Check outputから対象PRを一意に解決できません');
    }
    const prNumber = [...prNumbers][0];
    const parsedActions = JSON.parse(actionsResponse.stdout) as
      | { workflow_runs?: TrustedGateActionRun[] }
      | { workflow_runs?: TrustedGateActionRun[] }[];
    const actionPages = Array.isArray(parsedActions) ? parsedActions : [parsedActions];
    const actionRuns = actionPages.flatMap((page) => page.workflow_runs ?? []);
    const selected = selectLatestTrustedGateCheck({
      actionRuns,
      checkRuns,
      payload: { pr_number: prNumber, gate: gateId, target_sha: targetSha },
      expectedAppId,
      expectedCheckName: checkName,
    });
    if (typeof selected.checkRun.output?.text !== 'string') {
      throw new CliError('latest専用App Checkにoutput envelopeがありません');
    }
    const output = parseTrustedGateCheckOutput(selected.checkRun.output.text);
    const report = output.report as GateReport;
    const attestation = output.attestation;
    const pullResponse = gh(['api', `repos/{owner}/{repo}/pulls/${prNumber}`], root);
    const commitsResponse = gh(
      ['api', `repos/{owner}/{repo}/pulls/${prNumber}/commits?per_page=100`, '--paginate', '--slurp'],
      root,
    );
    const reviewsResponse = gh(
      ['api', `repos/{owner}/{repo}/pulls/${prNumber}/reviews?per_page=100`, '--paginate', '--slurp'],
      root,
    );
    const issueNumber = parseIssueId(issueIdRaw).number;
    const issueResponse = gh(['api', `repos/{owner}/{repo}/issues/${issueNumber}`], root);
    if (
      pullResponse.status !== 0 ||
      commitsResponse.status !== 0 ||
      reviewsResponse.status !== 0 ||
      issueResponse.status !== 0
    ) {
      throw new CliError('PR、Issue、commit、review evidenceのAPI正本を取得できません');
    }
    const pullRequest = JSON.parse(pullResponse.stdout) as TrustedGateApiContext['pullRequest'];
    const issueRecord = JSON.parse(issueResponse.stdout) as TrustedGateApiContext['issueRecord'];
    const branchIssue = /^[^/]+\/([1-9][0-9]*)-[a-z0-9][a-z0-9-]*$/.exec(pullRequest.head.ref);
    if (
      pullRequest.number !== prNumber ||
      pullRequest.state !== 'open' ||
      pullRequest.head.sha !== targetSha ||
      pullRequest.base.ref !== repository.default_branch ||
      !branchIssue ||
      branchIssue[1] !== issueNumber ||
      issueRecord.number !== Number(issueNumber) ||
      issueRecord.state !== 'open' ||
      !Array.isArray(issueRecord.labels)
    ) {
      throw new CliError('current PR head/default base/Issue identityがCheck outputと一致しません');
    }
    const labels = issueRecord.labels
      .map((label) => typeof label === 'string' ? label : label.name ?? '')
      .filter(Boolean);
    const context: TrustedGateApiContext = {
      actor: '',
      payload: { pr_number: prNumber, gate: gateId, target_sha: targetSha },
      repository,
      pullRequest,
      issueRecord,
      issueId: issueIdRaw,
      issueNumber: Number(issueNumber),
      profile: !labels.includes('risk:normal') || labels.includes('autonomy:full') ? 'strict' : 'standard',
      reviewSubject: labels.includes('review:core-audit') ? 'core_audit' : 'ordinary',
      commits: parseGhList<TrustedGateApiContext['commits'][number]>(commitsResponse.stdout),
      reviews: parseGhList<GithubReviewRecord>(reviewsResponse.stdout),
    };
    const rebuilt = buildVerifiedGateReportFromTrustedContext(root, context).report;
    const expectedAttestation = buildTrustedGateAttestation({
      repository,
      payload: context.payload,
      workflow: {
        path: TRUSTED_GATE_WORKFLOW_PATH,
        ref: 'refs/heads/main',
        sha: selected.actionRun.head_sha,
        run_id: selected.actionRun.id,
        run_number: selected.actionRun.run_number,
        run_attempt: selected.actionRun.run_attempt,
      },
      check: selected.checkRun,
      report: rebuilt,
    });
    if (
      canonicalReportIsOversize(report) ||
      canonicalJson(report) !== canonicalJson(rebuilt) ||
      canonicalJson(attestation) !== canonicalJson(expectedAttestation)
    ) {
      throw new CliError('Check outputのreport/attestation/evidence/artifact bindingを再構築できません');
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-attestation.'));
    const envelopePath = path.join(tempDir, 'agent-skill-chain-gate-attestation.json');
    fs.writeFileSync(envelopePath, `${canonicalJson(attestation)}\n`, { mode: 0o600 });
    const verifiedAttestation = gh(
      [
        'attestation',
        'verify',
        envelopePath,
        '-R',
        repository.full_name,
        '--signer-workflow',
        `${repository.full_name}/${TRUSTED_GATE_WORKFLOW_PATH}`,
        '--source-ref',
        'refs/heads/main',
        '--signer-digest',
        selected.actionRun.head_sha,
        '--format',
        'json',
      ],
      root,
    );
    const envelopeBytes = fs.readFileSync(envelopePath);
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (verifiedAttestation.status !== 0) {
      throw new CliError('trusted gate artifact attestationを検証できません');
    }
    let verification: unknown;
    try {
      verification = JSON.parse(verifiedAttestation.stdout);
    } catch {
      throw new CliError('gh attestation verifyのJSON出力を解釈できません');
    }
    assertTrustedGateAttestationVerification({ verification, envelopeBytes, envelope: attestation });
    writeYamlFileAtomic(reportPath, report);
    return ok(reportPath);
  });
}

/**
 * gate-report の final を human_required に倒すフェイルセーフ書込み（I8）。
 * レビュア起動失敗・タイムアウト・未構成（silent pass 禁止）や human adapter の非同期 deferral で用いる。
 */
export async function markHumanRequired(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(MARK_HUMAN_REQUIRED_USAGE);
      return 0;
    }
    const [gateReportPath] = args;
    if (!gateReportPath) throw new CliError('gate_report_path は必須です');
    if (!fs.existsSync(gateReportPath)) throw new CliError(`gate-report が存在しません: ${gateReportPath}`);

    const root = repoRoot();
    const report = readYamlFile<GateReport>(gateReportPath);
    report.gate.final = 'human_required';

    const outcome = validateAgainstSchema('gate-report', report, root);
    if (!outcome.valid) return fail(`gate-report がスキーマに適合しません: ${outcome.errors.join('; ')}`);

    writeYamlFileAtomic(gateReportPath, report);
    return ok('final: human_required');
  });
}

/** 判定ステップ・adapter が使う解決済みコンテキストとコアモデル要求を出力する。 */
export async function reviewerContext(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(REVIEWER_CONTEXT_USAGE);
      return 0;
    }
    const [issueIdRaw, targetSha, baseRef, reviewSubjectRaw, requestedAdapterRaw] = args;
    if (!issueIdRaw) throw new CliError('issue_id は必須です');
    const { number } = parseIssueId(issueIdRaw);

    const root = repoRoot();
    const config = loadConfig(root);
    const configuredAdapter = config.review.adapter ?? 'claude';
    const worktree = findIssueWorktree(root, config, number);
    const baseDir = worktree ? worktree.path : issueDir(root, number, config.coordination.backend);
    // reviewer policy/classifierはprotected base（main worktree）をtrust rootとし、Issue worktreeが
    // 同じPRで変更したcandidate policyを自己承認に使わない。
    const policyRoot = root;

    let reviewSubject: string | undefined = reviewSubjectRaw;
    if (!reviewSubject && config.coordination.backend === 'local') {
      const state = tryReadYamlFile<{ review_subject?: string }>(stateFilePath(root, number));
      reviewSubject = state?.review_subject;
    }
    if (reviewSubject && reviewSubject !== 'ordinary' && reviewSubject !== 'core_audit') {
      throw new CliError(`review_subject は ordinary|core_audit のいずれかである必要があります: ${reviewSubject}`);
    }

    const decision = classifyCoreReview(policyRoot, {
      targetSha,
      baseRef,
      reviewSubject: reviewSubject as 'ordinary' | 'core_audit' | undefined,
    });
    const policy = decision.policy;
    if (requestedAdapterRaw && !['claude', 'codex', 'human'].includes(requestedAdapterRaw)) {
      throw new CliError(`未登録adapterは選択できません: ${requestedAdapterRaw}`);
    }
    const adapter = (requestedAdapterRaw || configuredAdapter) as 'claude' | 'codex' | 'human';
    const policyLines = policy
      ? [
          `core_required_profile=${policy.required_profile}`,
          `core_model_tier=${policy.capability.model_tier}`,
          `core_reasoning_tier=${policy.capability.reasoning_tier}`,
          `codex_required_model=${policy.adapters.codex.model}`,
          `codex_required_reasoning_effort=${policy.adapters.codex.reasoning_effort}`,
          `codex_override_attestation_env=${policy.adapters.codex.override_attestation_env}`,
          `core_reviewer_location=${policy.execution.reviewer_location}`,
          `core_evidence_transport=${policy.execution.evidence_transport}`,
          `core_ci_role=${policy.execution.ci_role}`,
          `core_reviewer_count=${policy.execution.reviewer_count}`,
          `claude_model_env=${policy.adapters.claude.model_env}`,
          `claude_model_tier_env=${policy.adapters.claude.model_tier_env}`,
          `claude_reasoning_tier_env=${policy.adapters.claude.reasoning_tier_env}`,
          `claude_reasoning_probe_env=${policy.adapters.claude.reasoning_probe_env}`,
        ]
      : [];
    return ok(
      [
        `adapter=${adapter}`,
        `backend=${config.coordination.backend}`,
        `issue_number=${number}`,
        `base_dir=${baseDir}`,
        `core_review_required=${decision.required}`,
        `core_review_status=${decision.status}`,
        `core_review_reason=${decision.reason}`,
        ...policyLines,
      ].join('\n'),
    );
  });
}

/** 対象セグメントの主成果物名（判定入力の収集対象）。 */
const SEGMENT_ARTIFACTS: Record<Segment, string[]> = {
  spec: ['SPEC.md'],
  design: ['DESIGN.md', 'PLAN.md'],
  implementation: ['DESIGN.md', 'PLAN.md'],
  validation: ['VALIDATION.md'],
};

/** blocking finding の origin をセグメントに対応づける既定（進行役の差し戻し先決定に使う）。 */
const SEGMENT_ORIGIN: Record<Segment, string> = {
  spec: 'specification',
  design: 'design',
  implementation: 'implementation',
  validation: 'validation',
};

function collectAcIds(specText: string): string[] {
  const ids = new Set<string>();
  for (const match of specText.matchAll(/\bAC-[0-9]+\b/g)) ids.add(match[0]);
  return [...ids].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
}

function buildReviewerPrompt(
  root: string,
  number: string,
  gateId: Segment,
  targetSha: string,
  baseSha?: string,
): string {
    const readArtifact = (name: string): string | undefined => {
      const shown = git(['show', `${targetSha}:${name}`], root);
      return shown.status === 0 ? shown.stdout : undefined;
    };

    const specText = readArtifact('SPEC.md') ?? '';
    const acIds = collectAcIds(specText);

    const sections: string[] = [];
    sections.push('# ゲートレビュア判定プロンプト（read-only）');
    sections.push('');
    sections.push(
      `あなたは agent-skill-chain の ${gateId} ゲートのレビュアである。成果物を read-only で読み、` +
        'conformance（立証）と falsification（反証）の 2 観点で判定し、下記 JSON 契約に従って verdict のみを返す。' +
        '成果物・gate-report・その他いかなるファイルも書き換えてはならない（書込みは trusted なアダプタが行う）。',
    );
    sections.push('');
    sections.push(`- issue: ISSUE-${number}`);
    sections.push(`- gate: ${gateId}`);
    sections.push(`- target_sha: ${targetSha}`);
    sections.push('');
    sections.push('## 埋め込まれていない参照ファイルの扱い（ハルシネーション防止）');
    sections.push(
      'あなたには read-only ツールを含むいかなるツール呼び出しも許可されていない。' +
        '実際の内容を検証できるのは本プロンプト内に文字列として展開済みのセクション（判定対象の差分・判定対象の成果物・上流の承認済み成果物）のみである。' +
        '成果物本文が具体的なファイルパス（既存テストファイル名・実装ファイル名等）を名指しで言及していても、' +
        'そのファイルが上記セクションに展開されていない限り内容は一切不明であり、あなたの学習知識や推測で内容を補ってはならない。' +
        '埋め込まれていないファイルについて、具体的なコード引用・関数名・assertion 内容等を伴う証跡を推測・創作し、' +
        'それを blockers[].evidence として提示することを固く禁じる。' +
        '当該ファイルの記述が判定に不可欠な場合は、その部分は検証不能である旨を明記した上で conformance または falsification を pending とし、inconclusive:true を返すこと。',
    );
    sections.push('');
    sections.push('## 適用対象の AC-ID（SPEC.md 由来。全件を conformance 判定で網羅すること）');
    sections.push(acIds.length > 0 ? acIds.join(', ') : '(SPEC.md から AC-ID を検出できず。conformance は inconclusive とし human_required へ倒すこと)');
    sections.push('');

    sections.push('## conformance（立証）ルーブリック');
    sections.push(
      '- 適用対象の全 AC-ID / 要件が当該セグメント成果物で証跡付きに充足されているかを判定する。' +
        '1 件でも欠落・未証跡なら conformance=fail とし、欠落を生んだセグメントを origin に持つ blocking finding を付与する。',
    );
    sections.push('## falsification（反証）ルーブリック');
    sections.push(
      '- 反例（未処理エッジ・矛盾・危険な既定・未テストの失敗経路・spec⇔実装乖離）を能動的に 1 件以上探索する。' +
        'blocking な反例が 1 件でもあれば falsification=fail とし origin 付き blocking finding を付与する。',
    );
    sections.push('## final の扱い');
    sections.push(
      `- final はアダプタが verdict から機械的に導出する（両 pass かつ blocking 無し→approved／いずれか fail もしくは blocking→rejected）。` +
        '判定不能（inconclusive）・origin 衝突・人間判断が必要な場合は inconclusive:true を返す（silent pass 禁止＝I8）。',
    );
    sections.push('');
    sections.push('## 出力 JSON 契約（この形式のみを返すこと）');
    sections.push('```json');
    sections.push(
      JSON.stringify(
        {
          conformance: 'pass|fail|pending',
          falsification: 'pass|fail|pending',
          blockers: [
            {
              severity: 'blocking|warning|info',
              origin: 'specification|design|implementation|validation',
              code: '短い識別子',
              evidence: ['根拠（ファイル・AC-ID 等）'],
            },
          ],
          approved_artifacts: [{ path: '判定対象成果物の相対パス（digest は trusted code が算出）' }],
          inconclusive: false,
        },
        null,
        2,
      ),
    );
    sections.push('```');
    sections.push(`- 欠落・反例が当該セグメント起因なら origin='${SEGMENT_ORIGIN[gateId]}' を第一候補とする。`);
    sections.push('');

    const artifactNames = baseSha
      ? expectedArtifactPaths(root, gateId, baseSha, targetSha)
      : SEGMENT_ARTIFACTS[gateId];
    if (baseSha) {
      const diff = git(
        ['diff', '--no-ext-diff', '--no-color', '--full-index', `${baseSha}...${targetSha}`, '--', ...artifactNames],
        root,
      );
      if (diff.status !== 0) throw new CliError(`判定対象差分を読めません: ${diff.stderr.trim()}`);
      sections.push('## 判定対象の差分');
      sections.push(diff.stdout ? '```diff\n' + diff.stdout.trimEnd() + '\n```' : '(差分なし)');
      sections.push('');
    }
    sections.push('## 判定対象の成果物');
    for (const name of artifactNames) {
      const content = readArtifact(name);
      sections.push(`### ${name}`);
      sections.push(content !== undefined ? '```\n' + content.trimEnd() + '\n```' : '(未検出)');
      sections.push('');
    }
    if (gateId !== 'spec') {
      sections.push('## 上流の承認済み成果物（整合検査用）');
      sections.push('### SPEC.md');
      sections.push(specText ? '```\n' + specText.trimEnd() + '\n```' : '(未検出)');
      sections.push('');
    }

    return sections.join('\n').trimEnd();
}

/**
 * conformance/falsification 判定プロトコルのプロンプト（ルーブリック・出力契約）を組み立てる（判定プロトコル）。
 * 対象セグメントの成果物・SPEC の AC-ID を read-only で収集し、レビュアへの指示を出力する。
 */
export async function reviewerPrompt(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(REVIEWER_PROMPT_USAGE);
      return 0;
    }
    const [issueIdRaw, gateId, targetSha, baseSha] = args;
    if (!issueIdRaw || !gateId || !targetSha) throw new CliError('issue_id, gate_id, target_sha はすべて必須です');
    const { number } = parseIssueId(issueIdRaw);
    validateGateId(gateId);
    return ok(buildReviewerPrompt(repoRoot(), number, gateId, targetSha, baseSha));
  });
}
