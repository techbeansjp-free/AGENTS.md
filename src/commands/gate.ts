import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, worktreeRoot } from '../lib/paths.js';
import { loadConfig } from '../lib/config.js';
import { parseIssueId, validateSegment, SEGMENTS, CliError, type Segment } from '../lib/issue.js';
import { findIssueWorktree } from '../lib/worktree.js';
import { issueDir, reviewFilePath, stateFilePath } from '../lib/local-state.js';
import { readYamlFile, tryReadYamlFile, writeYamlFileAtomic, toYamlString } from '../lib/yaml-io.js';
import { validateAgainstSchema } from '../lib/schema.js';
import { git, gh } from '../lib/exec.js';
import { digestOf, digestOfFile } from '../lib/digest.js';
import { isHelp, printUsage, guard, fail, ok } from '../lib/cli-io.js';
import { classifyCoreReview } from '../lib/model-selection.js';
import {
  evidencePromptDigest,
  renderReviewEvidence,
  verifyGithubReviewEvidence,
  type EvidenceVerdict,
  type GithubReviewRecord,
  type ReviewEvidence,
  type VerifiedReviewer,
} from '../lib/review-evidence.js';

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
使い方: agent-skill-chain gate submit-evidence <issue_id> <gate_id> <profile> <target_sha> <base_sha> <trusted_base_sha> <pr_number> <reviewer_run_id> <slot> <adapter> <model> <reasoning>

protected base由来のローカルreviewer verdict（stdin JSON）を構造化し、GitHub PR Review APIへ
COMMENTとして保存する。Issue worktreeのcandidate recorderからの実行、dirty base、SHA不一致は拒否する。
`;

const VERIFY_EVIDENCE_USAGE = `
使い方: agent-skill-chain gate verify-evidence <issue_id> <gate_id> <profile> <target_sha> <base_sha> <pr_number> <gate_report_path> [review_subject]

protected baseのpolicy/verifierでGitHub PR・commit・review metadataと構造化証跡を検証・集約し、
gate-reportへ書く。証跡不足・古いSHA・自己承認・actor未解決はhuman_requiredへ安全側停止する。
`;

interface Finding {
  severity: 'blocking' | 'warning' | 'info';
  origin: 'specification' | 'design' | 'implementation' | 'validation';
  code: string;
  evidence: string[];
}

interface GateReport {
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
  };
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

function artifactsAtSha(root: string, paths: string[], targetSha: string): { path: string; digest: string }[] {
  return paths.map((artifactPath) => {
    const shown = git(['show', `${targetSha}:${artifactPath}`], root);
    if (shown.status !== 0) throw new CliError(`target SHAの成果物を読めません: ${artifactPath}`);
    return { path: artifactPath, digest: digestOf(shown.stdout) };
  });
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
        digest = digestOfFile(path.join(artifactBaseDir, artifact.path));
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
      !reviewerRunId ||
      !slotRaw ||
      !adapterRaw ||
      model === undefined ||
      reasoning === undefined
    ) {
      throw new CliError('submit-evidenceの引数が不足しています');
    }
    const { issueId } = parseIssueId(issueIdRaw);
    validateGateId(gateId);
    if (profile !== 'standard' && profile !== 'strict') throw new CliError('profileはstandard|strictのみです');
    if (adapterRaw !== 'codex' && adapterRaw !== 'claude' && adapterRaw !== 'human') {
      throw new CliError(`未登録adapterはevidenceを投稿できません: ${adapterRaw}`);
    }
    const slot = Number(slotRaw);
    if (!Number.isInteger(slot) || slot < 1 || slot > 2) throw new CliError('slotは1|2のみです');
    if (!/^review-[A-Za-z0-9._-]+$/.test(reviewerRunId)) throw new CliError('reviewer_run_id形式が不正です');

    const root = repoRoot();
    const executionRoot = worktreeRoot();
    if (executionRoot !== root) throw new CliError('Issue worktreeのcandidate recorderからevidenceを投稿できません');
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
    const artifacts = artifactsAtSha(root, expectedArtifactPaths(root, gateId, baseSha, targetSha), targetSha);
    const promptDigest = evidencePromptDigest(issueId, gateId, targetSha, artifacts);
    let verdict: EvidenceVerdict;
    try {
      verdict = JSON.parse(fs.readFileSync(0, 'utf8')) as EvidenceVerdict;
    } catch (error) {
      throw new CliError(`verdict JSONを解釈できません: ${error instanceof Error ? error.message : String(error)}`);
    }
    verdict.approved_artifacts = artifacts;

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

    const evidence: ReviewEvidence = {
      schema_version: 'agent-skill-chain/gate-review-evidence/v1',
      issue_id: issueId,
      gate: gateId,
      profile,
      target_sha: targetSha,
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
    return ok(submitted.stdout.trim());
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
    const { issueId } = parseIssueId(issueIdRaw);
    validateGateId(gateId);
    if (profile !== 'standard' && profile !== 'strict') throw new CliError('profileはstandard|strictのみです');
    if (reviewSubjectRaw && reviewSubjectRaw !== 'ordinary' && reviewSubjectRaw !== 'core_audit') {
      throw new CliError('review_subjectはordinary|core_auditのみです');
    }

    const root = repoRoot();
    const policy = classifyCoreReview(root, {
      targetSha,
      baseRef: baseSha,
      reviewSubject: reviewSubjectRaw as 'ordinary' | 'core_audit' | undefined,
    });
    if (!policy.policy) throw new CliError('登録済みreview policyがありません');
    const prResponse = gh(['api', `repos/{owner}/{repo}/pulls/${prNumber}`], root);
    const commitsResponse = gh(['api', `repos/{owner}/{repo}/pulls/${prNumber}/commits?per_page=100`], root);
    const reviewsResponse = gh(['api', `repos/{owner}/{repo}/pulls/${prNumber}/reviews?per_page=100`], root);
    if (prResponse.status !== 0 || commitsResponse.status !== 0 || reviewsResponse.status !== 0) {
      throw new CliError('GitHub PR/commit/review metadataを取得できません');
    }
    const pr = JSON.parse(prResponse.stdout) as {
      user: { login: string | null } | null;
      head: { sha: string };
      base: { sha: string };
    };
    if (pr.head.sha !== targetSha || pr.base.sha !== baseSha) throw new CliError('PRのbase/head SHAが入力と一致しません');
    const commits = parseGhList<{
      author: { login: string | null } | null;
      committer: { login: string | null } | null;
    }>(commitsResponse.stdout);
    const writerLogins = [pr.user?.login, ...commits.flatMap((commit) => [commit.author?.login, commit.committer?.login])];
    const unresolvedWriterActor = writerLogins.some((login) => !login);
    const writerActors = [...new Set(writerLogins.filter((login): login is string => !!login))];

    const artifacts = artifactsAtSha(root, expectedArtifactPaths(root, gateId, baseSha, targetSha), targetSha);
    const promptDigest = evidencePromptDigest(issueId, gateId, targetSha, artifacts);
    const result = verifyGithubReviewEvidence({
      reviews: parseGhList<GithubReviewRecord>(reviewsResponse.stdout),
      issueId,
      gate: gateId,
      profile,
      targetSha,
      trustedActors: policy.policy.execution.trusted_reviewer_actors,
      writerActors,
      unresolvedWriterActor,
      expectedPromptDigest: promptDigest,
      expectedArtifacts: artifacts,
      coreReviewRequired: policy.required,
      codexModel: policy.policy.adapters.codex.model,
      codexReasoning: policy.policy.adapters.codex.reasoning_effort,
    });
    const report: GateReport = {
      schema_version: 'agent-skill-chain/gate-report/v1',
      gate: {
        id: gateId,
        target_sha: targetSha,
        conformance: result.conformance,
        falsification: result.falsification,
        final: result.final,
        blockers: result.blockers,
        approved_digest: digestOf(JSON.stringify(result.approved_artifacts)),
        approved_artifacts: result.approved_artifacts,
        reviewers: result.reviewers,
      },
    };
    const validation = validateAgainstSchema('gate-report', report, root);
    if (!validation.valid) return fail(`検証済みgate-reportがschema不適合です: ${validation.errors.join('; ')}`);
    writeYamlFileAtomic(reportPath, report);
    return ok(`final: ${result.final}${result.reason ? `\nreason: ${result.reason}` : ''}`);
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
    const baseDir = worktree ? worktree.path : issueDir(root, number);
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

    const root = repoRoot();

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

    const artifactNames =
      baseSha && gateId === 'implementation'
        ? expectedArtifactPaths(root, gateId, baseSha, targetSha)
        : SEGMENT_ARTIFACTS[gateId];
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

    return ok(sections.join('\n'));
  });
}
