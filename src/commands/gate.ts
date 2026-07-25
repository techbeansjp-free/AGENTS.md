import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRoot } from '../lib/paths.js';
import { loadConfig } from '../lib/config.js';
import { parseIssueId, validateSegment, SEGMENTS, CliError, type Segment } from '../lib/issue.js';
import { findIssueWorktree } from '../lib/worktree.js';
import { issueDir, reviewFilePath } from '../lib/local-state.js';
import { readYamlFile, writeYamlFileAtomic, toYamlString } from '../lib/yaml-io.js';
import { validateAgainstSchema } from '../lib/schema.js';
import { git, gh } from '../lib/exec.js';
import { digestOf, digestOfFile } from '../lib/digest.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';

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
使い方: agent-skill-chain gate reconcile <issue_id> <target_sha>

出力:
  成功時: 終了コード0。再発行または無効化したゲートIDの一覧を標準出力へ。
  失敗時: 終了コード1以上。理由を標準エラー出力へ。
`;

const RECORD_VERDICT_USAGE = `
使い方: agent-skill-chain gate record-verdict <gate_report_path> [artifact_base_dir]

pending の gate-report（gate review が生成したスキャフォールド）へ、標準入力から与えた
レビュア verdict（JSON）を結線して判定済み gate-report を書き出す。final は verdict の
conformance/falsification/blockers/inconclusive から機械的に導出する（両pass かつ blocking finding
無し→approved／いずれか fail もしくは blocking finding あり→rejected／inconclusive→human_required）。

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
使い方: agent-skill-chain gate reviewer-context <issue_id>

判定ステップ・adapter が必要とするコンテキストを KEY=VALUE 形式で標準出力へ出す。
  adapter=<claude|codex|human>   review.adapter（未設定時 claude）
  backend=<github|local>          coordination.backend
  issue_number=<n>                issue_id から抽出した番号
`;

const REVIEWER_PROMPT_USAGE = `
使い方: agent-skill-chain gate reviewer-prompt <issue_id> <gate_id> <target_sha> [reviewer_slot] [invocation_id]

対象セグメントの成果物・AC-ID・上流承認物を read-only で収集し、conformance（立証）/
falsification（反証）判定プロトコルの指示（ルーブリック・出力 JSON 契約）を標準出力へ出す。
レビュアへの入力プロンプトであり、本コマンドはファイルを読むのみ（書込みなし）。
`;

const STRICT_PREPARE_USAGE = `
使い方: agent-skill-chain gate strict-prepare <issue_id> <gate_report_path>

review_profile=strict かつ final=pending の最終 gate-report から、固定slot reviewer-1 /
reviewer-2 の別invocationを持つscratch reportと、一回限りのprivate session manifestを作る。
`;

const AGGREGATE_STRICT_USAGE = `
使い方: agent-skill-chain gate aggregate-strict <gate_report_path> <session_manifest_path>

private session manifestに結線された2件のscratch reportを一度だけ消費し、slot・invocation・
Issue・gate・target SHA・profile・完了状態・成果物digestを検査して最終gate-reportへ集約する。
`;

interface Finding {
  severity: 'blocking' | 'warning' | 'info';
  origin: 'specification' | 'design' | 'implementation' | 'validation';
  code: string;
  evidence: string[];
}

type ReviewProfile = 'standard' | 'strict';
type ReviewerSlot = 'reviewer-1' | 'reviewer-2';
type InvocationStatus = 'pending' | 'completed' | 'failed';

interface ReviewInvocation {
  issue_id: string;
  gate_id: Segment;
  target_sha: string;
  profile: 'strict';
  reviewer_slot: ReviewerSlot;
  invocation_id: string;
  status: InvocationStatus;
}

interface ReviewerEvidence extends ReviewInvocation {
  conformance: 'pass' | 'fail' | 'pending';
  falsification: 'pass' | 'fail' | 'pending';
  final: 'approved' | 'rejected' | 'pending' | 'human_required';
  blockers: Finding[];
  approved_digest: string;
  approved_artifacts: { path: string; digest: string }[];
}

interface GateReport {
  schema_version: string;
  gate: {
    issue_id?: string;
    id: Segment;
    target_sha: string;
    conformance: 'pass' | 'fail' | 'pending';
    falsification: 'pass' | 'fail' | 'pending';
    final: 'approved' | 'rejected' | 'pending' | 'human_required';
    blockers: Finding[];
    approved_digest: string;
    approved_artifacts: { path: string; digest: string }[];
    review_profile?: ReviewProfile;
    review_invocation?: ReviewInvocation;
    reviewers?: ReviewerEvidence[];
  };
}

interface StrictSessionManifest {
  schema_version: 'agent-skill-chain/strict-review-session/v1';
  session_id: string;
  issue_id: string;
  gate_id: Segment;
  target_sha: string;
  profile: 'strict';
  final_report_path: string;
  consumed: boolean;
  consumed_at?: string;
  reviewers: {
    reviewer_slot: ReviewerSlot;
    invocation_id: string;
    report_path: string;
  }[];
}

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

function strictFinding(gateId: Segment, code: string, evidence: string[]): Finding {
  return {
    severity: 'blocking',
    origin: SEGMENT_ORIGIN[gateId] as Finding['origin'],
    code,
    evidence,
  };
}

function toReviewerEvidence(report: GateReport): ReviewerEvidence | undefined {
  const invocation = report.gate.review_invocation;
  if (!invocation) return undefined;
  return {
    ...invocation,
    conformance: report.gate.conformance,
    falsification: report.gate.falsification,
    final: report.gate.final,
    blockers: report.gate.blockers,
    approved_digest: report.gate.approved_digest,
    approved_artifacts: report.gate.approved_artifacts,
  };
}

function aggregatedLens(reports: GateReport[], lens: 'conformance' | 'falsification'): 'pass' | 'fail' | 'pending' {
  const values = reports.map((report) => report.gate[lens]);
  if (values.some((value) => value === 'fail')) return 'fail';
  if (values.length === 2 && values.every((value) => value === 'pass')) return 'pass';
  return 'pending';
}

function artifactsFingerprint(artifacts: { path: string; digest: string }[]): string {
  return JSON.stringify(
    [...artifacts]
      .map((artifact) => ({ path: artifact.path, digest: artifact.digest }))
      .sort((a, b) => a.path.localeCompare(b.path) || a.digest.localeCompare(b.digest)),
  );
}

function artifactFingerprint(report: GateReport): string {
  return artifactsFingerprint(report.gate.approved_artifacts);
}

function writePrivateJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function parseStrictSessionManifest(value: unknown): StrictSessionManifest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Partial<StrictSessionManifest>;
  if (
    typeof candidate.schema_version !== 'string' ||
    typeof candidate.session_id !== 'string' ||
    typeof candidate.issue_id !== 'string' ||
    typeof candidate.gate_id !== 'string' ||
    typeof candidate.target_sha !== 'string' ||
    typeof candidate.profile !== 'string' ||
    typeof candidate.final_report_path !== 'string' ||
    typeof candidate.consumed !== 'boolean' ||
    !Array.isArray(candidate.reviewers)
  ) {
    return undefined;
  }
  if (
    !candidate.reviewers.every(
      (reviewer) =>
        typeof reviewer === 'object' &&
        reviewer !== null &&
        typeof reviewer.reviewer_slot === 'string' &&
        typeof reviewer.invocation_id === 'string' &&
        typeof reviewer.report_path === 'string',
    )
  ) {
    return undefined;
  }
  return candidate as StrictSessionManifest;
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
): { url?: string; error?: string } {
  const body = JSON.stringify({
    name: checkName,
    head_sha: headSha,
    status: 'completed',
    conclusion,
    output: { title, summary },
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
        issue_id: `ISSUE-${number}`,
        id: gateId,
        target_sha: targetSha,
        conformance: 'pending',
        falsification: 'pending',
        final: 'pending',
        blockers: [],
        approved_digest: `sha256:${'0'.repeat(64)}`,
        approved_artifacts: [],
        review_profile: profile,
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

/**
 * Strict reviewのtrusted launcherだけが使うprivate sessionを準備する。成果物branchの外にある
 * OS runtime領域へ、固定2 slotの別invocationを持つscratch reportを生成する。
 */
export async function strictPrepare(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(STRICT_PREPARE_USAGE);
      return 0;
    }
    const [issueIdRaw, gateReportPathRaw] = args;
    if (!issueIdRaw || !gateReportPathRaw) throw new CliError('issue_id, gate_report_path はすべて必須です');
    const { issueId } = parseIssueId(issueIdRaw);
    const root = repoRoot();
    const gateReportPath = path.resolve(gateReportPathRaw);
    if (!fs.existsSync(gateReportPath)) throw new CliError(`gate-report が存在しません: ${gateReportPath}`);

    const finalReport = readYamlFile<GateReport>(gateReportPath);
    const outcome = validateAgainstSchema('gate-report', finalReport, root);
    if (!outcome.valid) return fail(`gate-report がスキーマに適合しません: ${outcome.errors.join('; ')}`);
    if (finalReport.gate.review_profile !== 'strict') {
      return fail(`strict-prepare は review_profile=strict のgate-reportだけを受け入れます`);
    }
    if (finalReport.gate.issue_id !== issueId) {
      return fail(`strict-prepare のissue_idがgate-reportと一致しません: ${finalReport.gate.issue_id ?? '(missing)'}`);
    }
    if (finalReport.gate.final !== 'pending') {
      return fail(`strict-prepare は final=pending のgate-reportだけを受け入れます`);
    }
    if (finalReport.gate.review_invocation || (finalReport.gate.reviewers?.length ?? 0) > 0) {
      return fail('strict-prepare は未使用の最終gate-reportだけを受け入れます');
    }

    const sessionId = crypto.randomUUID();
    const repoKey = crypto.createHash('sha256').update(fs.realpathSync(root)).digest('hex').slice(0, 16);
    const sessionDir = path.join(os.tmpdir(), 'agent-skill-chain-strict-sessions', repoKey, sessionId);
    fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });

    const slots: ReviewerSlot[] = ['reviewer-1', 'reviewer-2'];
    const manifest: StrictSessionManifest = {
      schema_version: 'agent-skill-chain/strict-review-session/v1',
      session_id: sessionId,
      issue_id: issueId,
      gate_id: finalReport.gate.id,
      target_sha: finalReport.gate.target_sha,
      profile: 'strict',
      final_report_path: gateReportPath,
      consumed: false,
      reviewers: [],
    };

    for (const reviewerSlot of slots) {
      const invocationId = crypto.randomUUID();
      const reportPath = path.join(sessionDir, `${reviewerSlot}.yaml`);
      const scratch: GateReport = structuredClone(finalReport);
      scratch.gate.review_invocation = {
        issue_id: issueId,
        gate_id: finalReport.gate.id,
        target_sha: finalReport.gate.target_sha,
        profile: 'strict',
        reviewer_slot: reviewerSlot,
        invocation_id: invocationId,
        status: 'pending',
      };
      delete scratch.gate.reviewers;
      writeYamlFileAtomic(reportPath, scratch);
      manifest.reviewers.push({ reviewer_slot: reviewerSlot, invocation_id: invocationId, report_path: reportPath });
    }

    const manifestPath = path.join(sessionDir, 'session.json');
    writePrivateJsonAtomic(manifestPath, manifest);
    return ok(
      [
        `session_manifest_path: ${manifestPath}`,
        ...manifest.reviewers.flatMap((reviewer) => [
          `${reviewer.reviewer_slot}_report_path: ${reviewer.report_path}`,
          `${reviewer.reviewer_slot}_invocation_id: ${reviewer.invocation_id}`,
        ]),
      ].join('\n'),
    );
  });
}

/**
 * Strict sessionの2件を一度だけ消費するtrusted aggregation。入力妥当性とhuman_requiredを
 * rejectより先に判定し、両件approvedだけをapprovedにする。
 */
export async function aggregateStrict(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(AGGREGATE_STRICT_USAGE);
      return 0;
    }
    const [gateReportPathRaw, manifestPathRaw] = args;
    if (!gateReportPathRaw || !manifestPathRaw) {
      throw new CliError('gate_report_path, session_manifest_path はすべて必須です');
    }

    const root = repoRoot();
    const gateReportPath = path.resolve(gateReportPathRaw);
    const manifestPath = path.resolve(manifestPathRaw);
    if (!fs.existsSync(gateReportPath)) throw new CliError(`gate-report が存在しません: ${gateReportPath}`);
    const finalReport = readYamlFile<GateReport>(gateReportPath);
    const finalOutcome = validateAgainstSchema('gate-report', finalReport, root);
    if (!finalOutcome.valid) return fail(`最終gate-reportがスキーマに適合しません: ${finalOutcome.errors.join('; ')}`);

    const failClosed = (reason: string, reports: GateReport[] = []): number => {
      finalReport.gate.review_profile = 'strict';
      delete finalReport.gate.review_invocation;
      finalReport.gate.reviewers = reports.map(toReviewerEvidence).filter((value): value is ReviewerEvidence => Boolean(value));
      finalReport.gate.conformance = aggregatedLens(reports, 'conformance');
      finalReport.gate.falsification = aggregatedLens(reports, 'falsification');
      finalReport.gate.final = 'human_required';
      finalReport.gate.blockers = [
        ...reports.flatMap((report) => report.gate.blockers),
        strictFinding(finalReport.gate.id, 'strict-aggregation-invalid', [reason]),
      ];
      writeYamlFileAtomic(gateReportPath, finalReport);
      return ok(`final: human_required\nreason: ${reason}`);
    };

    if (finalReport.gate.review_profile !== 'strict') {
      return failClosed('最終gate-reportのreview_profileがstrictではありません');
    }
    const repoKey = crypto.createHash('sha256').update(fs.realpathSync(root)).digest('hex').slice(0, 16);
    const expectedRuntimeRoot = path.join(os.tmpdir(), 'agent-skill-chain-strict-sessions', repoKey);
    const runtimeRelative = path.relative(expectedRuntimeRoot, manifestPath);
    if (runtimeRelative.startsWith('..') || path.isAbsolute(runtimeRelative) || path.basename(manifestPath) !== 'session.json') {
      return failClosed('private session manifestがtrusted runtime領域外です');
    }
    if (!fs.existsSync(manifestPath)) return failClosed(`private session manifestが存在しません: ${manifestPath}`);

    let manifest: StrictSessionManifest;
    try {
      const parsed = parseStrictSessionManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
      if (!parsed) return failClosed('private session manifestの構造が不正です');
      manifest = parsed;
    } catch (error) {
      return failClosed(`private session manifestを解釈できません: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (manifest.consumed) return failClosed(`session ${manifest.session_id} は既に消費済みです`);
    manifest.consumed = true;
    manifest.consumed_at = new Date().toISOString();
    writePrivateJsonAtomic(manifestPath, manifest);

    const expectedSlots: ReviewerSlot[] = ['reviewer-1', 'reviewer-2'];
    const manifestErrors: string[] = [];
    if (manifest.schema_version !== 'agent-skill-chain/strict-review-session/v1') manifestErrors.push('schema_version不一致');
    if (!/^ISSUE-[0-9]+$/.test(manifest.issue_id)) manifestErrors.push('issue_id不正');
    if (manifest.issue_id !== finalReport.gate.issue_id) manifestErrors.push('最終gate-reportとのissue_id不一致');
    if (manifest.session_id !== path.basename(path.dirname(manifestPath))) manifestErrors.push('session_id不一致');
    if (manifest.profile !== 'strict') manifestErrors.push('profile不一致');
    if (manifest.final_report_path !== gateReportPath) manifestErrors.push('final_report_path不一致');
    if (manifest.gate_id !== finalReport.gate.id) manifestErrors.push('gate_id不一致');
    if (manifest.target_sha !== finalReport.gate.target_sha) manifestErrors.push('target_sha不一致');
    if (manifest.reviewers.length !== 2) manifestErrors.push(`reviewer件数=${manifest.reviewers.length}`);
    const slots = manifest.reviewers.map((reviewer) => reviewer.reviewer_slot);
    if (!expectedSlots.every((slot) => slots.filter((actual) => actual === slot).length === 1)) {
      manifestErrors.push(`slot集合不一致: ${slots.join(',')}`);
    }
    const invocationIds = manifest.reviewers.map((reviewer) => reviewer.invocation_id);
    if (new Set(invocationIds).size !== invocationIds.length) manifestErrors.push('invocation_id重複');
    const reportPaths = manifest.reviewers.map((reviewer) => path.resolve(reviewer.report_path));
    if (new Set(reportPaths).size !== reportPaths.length) manifestErrors.push('report_path重複');
    if (reportPaths.some((reportPath) => path.dirname(reportPath) !== path.dirname(manifestPath))) {
      manifestErrors.push('scratch reportがprivate sessionディレクトリ外を参照');
    }
    if (manifestErrors.length > 0) return failClosed(manifestErrors.join('; '));

    const reports: GateReport[] = [];
    const inputErrors: string[] = [];
    for (const expected of manifest.reviewers) {
      const reportPath = path.resolve(expected.report_path);
      if (!fs.existsSync(reportPath)) {
        inputErrors.push(`${expected.reviewer_slot}: scratch report欠落`);
        continue;
      }
      let report: GateReport;
      try {
        report = readYamlFile<GateReport>(reportPath);
      } catch (error) {
        inputErrors.push(
          `${expected.reviewer_slot}: scratch report解釈失敗 (${error instanceof Error ? error.message : String(error)})`,
        );
        continue;
      }
      const outcome = validateAgainstSchema('gate-report', report, root);
      if (!outcome.valid) {
        inputErrors.push(`${expected.reviewer_slot}: schema不適合 (${outcome.errors.join('; ')})`);
        continue;
      }
      reports.push(report);
      const invocation = report.gate.review_invocation;
      if (!invocation) {
        inputErrors.push(`${expected.reviewer_slot}: review_invocation欠落`);
        continue;
      }
      if (invocation.reviewer_slot !== expected.reviewer_slot) {
        inputErrors.push(`${expected.reviewer_slot}: reviewer_slot不一致`);
      }
      if (invocation.invocation_id !== expected.invocation_id) {
        inputErrors.push(`${expected.reviewer_slot}: invocation_id不一致`);
      }
      if (
        invocation.issue_id !== manifest.issue_id ||
        invocation.gate_id !== manifest.gate_id ||
        invocation.target_sha !== manifest.target_sha ||
        invocation.profile !== 'strict'
      ) {
        inputErrors.push(`${expected.reviewer_slot}: Issue/gate/target_sha/profile結線不一致`);
      }
      if (report.gate.review_profile !== 'strict') inputErrors.push(`${expected.reviewer_slot}: review_profile不一致`);
      if (report.gate.id !== manifest.gate_id || report.gate.target_sha !== manifest.target_sha) {
        inputErrors.push(`${expected.reviewer_slot}: gate report本体のgate/target_sha結線不一致`);
      }
      if (invocation.status !== 'completed') {
        inputErrors.push(`${expected.reviewer_slot}: invocation status=${invocation.status}`);
      }
      if (report.gate.final === 'pending' || report.gate.final === 'human_required') {
        inputErrors.push(`${expected.reviewer_slot}: final=${report.gate.final}`);
      }
    }

    if (reports.length === 2) {
      if (artifactFingerprint(reports[0]) !== artifactFingerprint(reports[1])) {
        inputErrors.push('approved_artifactsのpath/digest集合が不一致');
      }
      if (reports[0].gate.approved_digest !== reports[1].gate.approved_digest) {
        inputErrors.push('approved_digestが不一致');
      }
    }
    if (reports.some((report) => report.gate.final === 'human_required')) {
      inputErrors.push('sub-verdictにhuman_requiredを含む');
    }
    if (inputErrors.length > 0) return failClosed(inputErrors.join('; '), reports);

    const evidence = reports.map(toReviewerEvidence).filter((value): value is ReviewerEvidence => Boolean(value));
    finalReport.gate.reviewers = evidence;
    delete finalReport.gate.review_invocation;
    finalReport.gate.conformance = aggregatedLens(reports, 'conformance');
    finalReport.gate.falsification = aggregatedLens(reports, 'falsification');
    finalReport.gate.blockers = reports.flatMap((report) => report.gate.blockers);
    finalReport.gate.approved_artifacts = reports[0].gate.approved_artifacts;
    finalReport.gate.approved_digest = reports[0].gate.approved_digest;

    const hasReject =
      reports.some((report) => report.gate.final === 'rejected') ||
      reports.some((report) => report.gate.blockers.some((finding) => finding.severity === 'blocking'));
    const bothApproved = reports.every(
      (report) =>
        report.gate.final === 'approved' &&
        report.gate.conformance === 'pass' &&
        report.gate.falsification === 'pass' &&
        !report.gate.blockers.some((finding) => finding.severity === 'blocking'),
    );
    finalReport.gate.final = hasReject ? 'rejected' : bothApproved ? 'approved' : 'human_required';
    if (finalReport.gate.final === 'human_required') {
      finalReport.gate.blockers.push(
        strictFinding(finalReport.gate.id, 'strict-aggregation-inconclusive', ['2件の有効な判定を最終状態へ集約できません']),
      );
    }

    const aggregateOutcome = validateAgainstSchema('gate-report', finalReport, root);
    if (!aggregateOutcome.valid) {
      return failClosed(`集約後gate-reportがスキーマに適合しません: ${aggregateOutcome.errors.join('; ')}`, reports);
    }
    writeYamlFileAtomic(gateReportPath, finalReport);

    const cleanupErrors: string[] = [];
    for (const reviewer of manifest.reviewers) {
      try {
        fs.unlinkSync(reviewer.report_path);
      } catch (error) {
        cleanupErrors.push(`${reviewer.reviewer_slot}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (cleanupErrors.length > 0) return failClosed(`scratch report cleanup失敗: ${cleanupErrors.join('; ')}`, reports);
    return ok(`final: ${finalReport.gate.final}`);
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
    const { issueId, number } = parseIssueId(issueIdRaw);

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
    if (report.gate.review_profile === 'strict' && report.gate.final === 'approved') {
      const reviewers = report.gate.reviewers ?? [];
      const slots = reviewers.map((reviewer) => reviewer.reviewer_slot);
      const invocationIds = reviewers.map((reviewer) => reviewer.invocation_id);
      const valid =
        report.gate.issue_id === issueId &&
        reviewers.length === 2 &&
        ['reviewer-1', 'reviewer-2'].every((slot) => slots.filter((actual) => actual === slot).length === 1) &&
        new Set(invocationIds).size === 2 &&
        reviewers.every(
          (reviewer) =>
            reviewer.profile === 'strict' &&
            reviewer.issue_id === issueId &&
            reviewer.gate_id === report.gate.id &&
            reviewer.target_sha === report.gate.target_sha &&
            reviewer.status === 'completed' &&
            reviewer.final === 'approved' &&
            reviewer.conformance === 'pass' &&
            reviewer.falsification === 'pass' &&
            !reviewer.blockers.some((finding) => finding.severity === 'blocking'),
        ) &&
        reviewers.every(
          (reviewer) =>
            reviewer.approved_digest === report.gate.approved_digest &&
            artifactsFingerprint(reviewer.approved_artifacts) === artifactsFingerprint(report.gate.approved_artifacts),
        );
      if (!valid) {
        return fail('review_profile=strict のapproved gate-reportに独立した2件の承認証跡がありません');
      }
    }

    // ローカルモードでは reviews/<gate>.yaml が正本。GitHubモードでも Check Run（信号）とは別に
    // 同じ構造化レコードを issues/<n>/.agent-skill-chain/reviews/<gate>.yaml へ併記する。
    // gate-report.schema.yaml 準拠の approved_artifacts.digest は Check Run の title/summary には
    // 収まらず、後続コマンド（adr finalize 等）が Coordination Backend を問わず参照できる場所が
    // 必要なため。
    const dest = reviewFilePath(root, number, report.gate.id);
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
    );
    if (published.error) return fail(`Check Run 発行に失敗しました: ${published.error}`);
    return ok(published.url ?? '');
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

    // 変数名は出力メッセージの語（`reissued: ...`。後方互換のため不変）とは独立させる
    // （英単語 `reissued` は禁止語を部分文字列として偶然含むため、変数名としては避ける）。
    const refreshed: string[] = [];
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

      const changed =
        downstreamInvalidated ||
        report.gate.approved_artifacts.some((artifact) => {
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
        refreshed.push(gateId);
      }

      // ローカルモードでは reviews/<gate>.yaml（上記writeYamlFileAtomic）が正本。GitHubモードでは
      // Check Runが調整状態の正本（Coordination Backend が GitHub の場合の唯一の正本）のため、
      // 新しいtarget_shaに対して再発行または無効化のCheck Runを明示的に発行し直す必要がある
      // （発行しないと新SHAにrequired status checkが一切存在せず、merge判定が永久にpending留まりになる）。
      if (config.coordination.backend === 'github') {
        const checkName = config.checks[gateId];
        const published = changed
          ? publishCheckRun(
              root,
              checkName,
              targetSha,
              'action_required',
              `${gateId} gate: invalidated`,
              `approved artifacts changed at ${targetSha}; ${gateId} gate must be re-reviewed`,
            )
          : publishCheckRun(
              root,
              checkName,
              targetSha,
              'success',
              `${gateId} gate: reconciled`,
              `approved artifacts unchanged; reissued for ${targetSha}`,
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
    const [gateReportPath, artifactBaseDir] = args;
    if (!gateReportPath) throw new CliError('gate_report_path は必須です');
    if (!fs.existsSync(gateReportPath)) throw new CliError(`gate-report が存在しません: ${gateReportPath}`);

    const root = repoRoot();
    const report = readYamlFile<GateReport>(gateReportPath);
    const base = validateAgainstSchema('gate-report', report, root);
    if (!base.valid) return fail(`入力 gate-report がスキーマに適合しません: ${base.errors.join('; ')}`);
    if (report.gate.review_profile === 'strict' && !report.gate.review_invocation) {
      return fail('Strictの最終gate-reportへ単一verdictを直接結線できません（trusted aggregationが必要です）');
    }

    let verdict: ReviewerVerdict;
    try {
      verdict = JSON.parse(fs.readFileSync(0, 'utf8')) as ReviewerVerdict;
    } catch (error) {
      return fail(`verdict JSON を解釈できません: ${error instanceof Error ? error.message : String(error)}`);
    }

    const conformance = verdict.conformance ?? 'pending';
    const falsification = verdict.falsification ?? 'pending';
    if (!SUBVERDICT_VALUES.has(conformance) || !SUBVERDICT_VALUES.has(falsification)) {
      return fail('verdict の conformance / falsification は pass|fail|pending のいずれかである必要があります');
    }

    const approvedArtifacts: { path: string; digest: string }[] = [];
    for (const artifact of verdict.approved_artifacts ?? []) {
      if (artifact.digest) {
        approvedArtifacts.push({ path: artifact.path, digest: artifact.digest });
      } else if (artifactBaseDir) {
        approvedArtifacts.push({ path: artifact.path, digest: digestOfFile(path.join(artifactBaseDir, artifact.path)) });
      } else {
        return fail(
          `approved_artifacts '${artifact.path}' に digest が無く artifact_base_dir も指定されていないため digest を確定できません`,
        );
      }
    }

    const final = deriveFinal(verdict);
    report.gate.conformance = conformance;
    report.gate.falsification = falsification;
    report.gate.final = final;
    report.gate.blockers = verdict.blockers ?? [];
    if (approvedArtifacts.length > 0) report.gate.approved_artifacts = approvedArtifacts;
    if (verdict.approved_digest) report.gate.approved_digest = verdict.approved_digest;
    if (report.gate.review_invocation) report.gate.review_invocation.status = 'completed';

    const outcome = validateAgainstSchema('gate-report', report, root);
    if (!outcome.valid) return fail(`結線後の gate-report がスキーマに適合しません: ${outcome.errors.join('; ')}`);

    writeYamlFileAtomic(gateReportPath, report);
    return ok(`final: ${final}`);
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
    if (report.gate.review_invocation) report.gate.review_invocation.status = 'failed';

    const outcome = validateAgainstSchema('gate-report', report, root);
    if (!outcome.valid) return fail(`gate-report がスキーマに適合しません: ${outcome.errors.join('; ')}`);

    writeYamlFileAtomic(gateReportPath, report);
    return ok('final: human_required');
  });
}

/** 判定ステップ・adapter が使う解決済みコンテキスト（adapter 名・backend・Issue 番号）を出力する。 */
export async function reviewerContext(args: string[]): Promise<number> {
  return guard(() => {
    if (isHelp(args)) {
      printUsage(REVIEWER_CONTEXT_USAGE);
      return 0;
    }
    const [issueIdRaw] = args;
    if (!issueIdRaw) throw new CliError('issue_id は必須です');
    const { number } = parseIssueId(issueIdRaw);

    const root = repoRoot();
    const config = loadConfig(root);
    const adapter = config.review.adapter ?? 'claude';
    const worktree = findIssueWorktree(root, config, number);
    const baseDir = worktree ? worktree.path : issueDir(root, number);
    return ok(
      [
        `adapter=${adapter}`,
        `backend=${config.coordination.backend}`,
        `issue_number=${number}`,
        `base_dir=${baseDir}`,
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
    const [issueIdRaw, gateId, targetSha, reviewerSlot, invocationId] = args;
    if (!issueIdRaw || !gateId || !targetSha) throw new CliError('issue_id, gate_id, target_sha はすべて必須です');
    const { number } = parseIssueId(issueIdRaw);
    validateGateId(gateId);
    if ((reviewerSlot && !invocationId) || (!reviewerSlot && invocationId)) {
      throw new CliError('reviewer_slot と invocation_id は同時に指定する必要があります');
    }
    if (reviewerSlot && reviewerSlot !== 'reviewer-1' && reviewerSlot !== 'reviewer-2') {
      throw new CliError(`reviewer_slot は reviewer-1|reviewer-2 のいずれかである必要があります: ${reviewerSlot}`);
    }

    const root = repoRoot();
    const config = loadConfig(root);
    const worktree = findIssueWorktree(root, config, number);
    const baseDir = worktree ? worktree.path : issueDir(root, number);

    const readArtifact = (name: string): string | undefined => {
      const p = path.join(baseDir, name);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined;
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
    if (reviewerSlot && invocationId) {
      sections.push(`- reviewer_slot: ${reviewerSlot}`);
      sections.push(`- invocation_id: ${invocationId}`);
      sections.push('- このinvocationは独立判定であり、peer reviewerの判定結果を入力・推測・再利用してはならない。');
    }
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
          approved_artifacts: [{ path: '判定対象成果物の相対パス', digest: '省略可（アダプタが算出）' }],
          inconclusive: false,
        },
        null,
        2,
      ),
    );
    sections.push('```');
    sections.push(`- 欠落・反例が当該セグメント起因なら origin='${SEGMENT_ORIGIN[gateId]}' を第一候補とする。`);
    sections.push('');

    sections.push('## 判定対象の成果物');
    for (const name of SEGMENT_ARTIFACTS[gateId]) {
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

    return ok(sections.join('\n'));
  });
}
