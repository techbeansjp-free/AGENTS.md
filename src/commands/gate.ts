import fs from 'node:fs';
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
使い方: agent-skill-chain gate reviewer-prompt <issue_id> <gate_id> <target_sha>

対象セグメントの成果物・AC-ID・上流承認物を read-only で収集し、conformance（立証）/
falsification（反証）判定プロトコルの指示（ルーブリック・出力 JSON 契約）を標準出力へ出す。
レビュアへの入力プロンプトであり、本コマンドはファイルを読むのみ（書込みなし）。
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
 * verdict の各観点から final を機械的に導出する（判定プロトコル §3.2.2）。
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
    // 収まらず、後続コマンド（adr finalize 等）がバックエンドを問わず参照できる場所が必要なため。
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
        reissued.push(gateId);
      }

      // ローカルモードでは reviews/<gate>.yaml（上記writeYamlFileAtomic）が正本。GitHubモードでは
      // Check Runが正本（AGENTS.md §Coordination Backend）のため、新しいtarget_shaに対して
      // 再発行または無効化のCheck Runを明示的に発行し直す必要がある（発行しないと新SHAにrequired
      // status checkが一切存在せず、merge判定が永久にpending留まりになる）。
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
      [`reissued: ${reissued.join(', ') || '(none)'}`, `invalidated: ${invalidated.join(', ') || '(none)'}`].join('\n'),
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

    const outcome = validateAgainstSchema('gate-report', report, root);
    if (!outcome.valid) return fail(`gate-report がスキーマに適合しません: ${outcome.errors.join('; ')}`);

    writeYamlFileAtomic(gateReportPath, report);
    return ok('final: human_required');
  });
}

/** 判定ステップ・adapter が使う解決済みコンテキスト（adapter 名・backend・issue 番号）を出力する。 */
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

/** 対象セグメントの主成果物名（判定入力の収集対象）。判定プロトコル §3.2.2。 */
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
    const [issueIdRaw, gateId, targetSha] = args;
    if (!issueIdRaw || !gateId || !targetSha) throw new CliError('issue_id, gate_id, target_sha はすべて必須です');
    const { number } = parseIssueId(issueIdRaw);
    validateGateId(gateId);

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
