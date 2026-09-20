import fs from "node:fs";
import path from "node:path";
import {
  loadSupplementalReviewConfig,
  SUPPLEMENTAL_REVIEW_CONFIG_PATH,
} from "../domain/supplemental-review-config.js";
import {
  collectSupplementalReviewDiff,
  collectSupplementalReviewStaging,
  RELATED_FILE_LIMIT,
} from "./supplemental-review-collect.js";
import { REVIEWER_EXECUTORS } from "./reviewer-executors.js";
import { assertLoopbackEndpoint } from "../lib/local-llm-endpoint.js";
import { git } from "../lib/process.js";
import type { ReviewerExecutor } from "../domain/reviewer-provider.js";
import { isRecord } from "../types.js";
import { filterReviewFindingsToTarget } from "../domain/review-finding-scope.js";
import {
  REVIEW_EFFORTS,
  reviewProfileInstruction,
  visibleReviewFindings,
  type ReviewEffort,
  type ReviewProfile,
} from "../domain/review-presentation.js";
import {
  verifyReviewFindings,
  type ReviewFindingAssessment,
} from "./review-finding-verification.js";
import {
  peekPrimaryReviewRoot,
  resolveReviewRoot,
  resolveReviewWorkspace,
} from "./review-workspace.js";

/**
 * `modelMapping`・`resolveReviewRouting`・`launchReview`のいずれも
 * importしない。この構造そのものがINV-1428-04
 * （`modelMapping.roles.reviewer`を読み書きしないこと）を保証する。
 */

export type Severity = "Critical" | "High" | "Medium" | "Low";

export interface SupplementalReviewFinding {
  file: string;
  location: string;
  content: string;
  severity: Severity;
  effort?: ReviewEffort;
}

export type SupplementalReviewResult =
  | { state: "disabled" }
  | {
      state: "findings";
      findings: SupplementalReviewFinding[];
      truncated: boolean;
      ignoredOutOfScopeCount: number;
    }
  | {
      state: "needs_coordinator_review";
      findings: SupplementalReviewFinding[];
      verificationSuggestedFindings: SupplementalReviewFinding[] | null;
      verificationAssessments: ReviewFindingAssessment[] | null;
      headSha: string;
      truncated: boolean;
      ignoredOutOfScopeCount: number;
    }
  | { state: "degraded"; reason: string; truncated: boolean }
  | { state: "error"; reason: string };

/**
 * CodeRabbit等の商用AIレビュアーが公開する観点（バグ・セキュリティ・
 * パフォーマンス・品質・機能性の5分類）に合わせた、diff対象向けの
 * レビュー観点。ユーザーからの明示要求により、「横断的な不整合だけ」
 * という限定を撤去し、この機能単体でCodeRabbit相当以上の精度を
 * 目指す（#1428フォローアップ）。
 */
const DIFF_REVIEW_INSTRUCTION =
  "あなたはCodeRabbit相当以上の精度を持つコードレビュアーです。" +
  "以下のdiffと関連ファイルの文脈をもとに、次の観点でレビューしてください。" +
  "書式・styleだけの指摘や、実害の無い好みの指摘はしないでください。\n" +
  "1. バグ・ロジック誤り: off-by-one・境界条件の誤り、null/undefined参照、" +
  "race condition、コード（コメント・関数名・呼び出し元）が示す意図との不一致\n" +
  "2. セキュリティ脆弱性: SQLインジェクション、XSS、安全でないデシリアライズ、" +
  "認証・認可の不備、ハードコードされた資格情報・秘密情報、入力検証の欠如、" +
  "機密情報のログ出力・エラーメッセージへの露出、暗号関数の誤用\n" +
  "3. パフォーマンス: 不要に高い計算量、N+1、リソースリーク、無制限ループ・再帰\n" +
  "4. 保守性・品質: 複雑度に見合わないコメント欠如、重複コード、誤解を招く命名\n" +
  "5. 機能性: エッジケースの未処理、失敗経路（エラー処理）の欠落、" +
  "既存testで検出できない回帰\n" +
  "6. 変更ファイル単体では気づけない横断的な不整合: 呼び出し元・呼び出し先との" +
  "型・契約の不一致\n" +
  "各指摘は、実際にファイル内容から読み取れる根拠がある場合だけ行ってください。" +
  "findingはdiff適用後（現在のfile内容）に依然として残る問題だけを対象にしてください。" +
  "diffが既存の欠陥を修正している場合、その修正前の状態や修正内容の説明をfindingとして" +
  "報告しないでください（修正済みの問題を指摘として再掲しない）。ある行が既存の" +
  "条件分岐・早期returnにより到達不能であるとコード自身が示している場合、" +
  "その到達不能な行を根拠にfindingを作らないでください。";

/** Step 03/07相当（要求・要件・設計文書）向けのレビュー観点。 */
const STAGING_REVIEW_INSTRUCTION =
  "あなたは要求・要件・設計文書のレビュアーです。" +
  "以下のASC Issue staging内の文書をもとに、次の観点でレビューしてください。\n" +
  "1. 文書間のID不整合: 同一ID（AC/FR/NFR/INV/RQ/OUTCOME/DC/TERM-ASC）が文書間で" +
  "異なる内容を指している、参照されているのに定義がない、定義されているのに" +
  "参照されていない\n" +
  "2. 曖昧・検証不能な受け入れ条件や要件: 誰が読んでも同じ判定になる客観的な" +
  "条件になっているか\n" +
  "3. 矛盾する記述: 文書間または同一文書内で矛盾する記述\n" +
  "4. 抜け漏れ: 述べられている前提・制約に対して考慮されていないエッジケースや" +
  "異常系\n" +
  "各指摘は、文書から読み取れる根拠がある場合だけ行ってください。";

const RESPONSE_FORMAT_INSTRUCTION =
  "出力は必ず次の形式のJSONだけにしてください（前後に説明文を付けない）: " +
  '{"findings": [{"file": "対象file", "location": "該当箇所", ' +
  '"content": "指摘内容（日本語）", "severity": "Critical|High|Medium|Low", ' +
  '"effort": "Quick win|Moderate|Heavy lift"}]}。effortは修正工数の目安です。';

const VALID_SEVERITIES: readonly Severity[] = [
  "Critical",
  "High",
  "Medium",
  "Low",
];

function parseFindings(
  output: string,
): SupplementalReviewFinding[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.findings)) return undefined;
  const findings: SupplementalReviewFinding[] = [];
  for (const item of parsed.findings) {
    if (
      !isRecord(item) ||
      typeof item.file !== "string" ||
      typeof item.content !== "string" ||
      !VALID_SEVERITIES.includes(item.severity as Severity)
    )
      return undefined;
    if (
      item.effort !== undefined &&
      !REVIEW_EFFORTS.includes(item.effort as ReviewEffort)
    )
      return undefined;
    findings.push({
      file: item.file,
      location: typeof item.location === "string" ? item.location : "",
      content: item.content,
      severity: item.severity as Severity,
      ...(item.effort !== undefined
        ? { effort: item.effort as ReviewEffort }
        : {}),
    });
  }
  return findings;
}

async function dispatch(
  promptBody: string,
  config: {
    provider: string;
    model: string;
    endpoint: string;
    timeoutMs: number;
    profile: ReviewProfile;
  },
  truncated: boolean,
  targetFiles: string[],
  execute: ReviewerExecutor | undefined,
  verification?: { root: string; headSha: string },
): Promise<SupplementalReviewResult> {
  const executor = execute ?? REVIEWER_EXECUTORS[config.provider];
  if (!executor)
    return {
      state: "degraded",
      reason: `provider ${config.provider} の実行adapterが未登録です`,
      truncated,
    };
  /**
   * `executeLocalLlm`（Issue #1425既存部品）も内部で同じ検証を行うが、
   * そちらは失敗時に例外を投げる。ここで事前検証してcatchすることで、
   * 送信を行わずAC-1428-06/SCN-SUPPL-006が要求する`degraded`へ倒す
   * （dispatch呼出し前に例外がCLI全体を異常終了させる回帰を防ぐ）。
   */
  try {
    assertLoopbackEndpoint(config.endpoint);
  } catch (error) {
    return {
      state: "degraded",
      reason: error instanceof Error ? error.message : String(error),
      truncated,
    };
  }
  const prompt =
    `findingの対象fileは今回のreview対象に限ります: ${JSON.stringify(targetFiles)}。関連fileは文脈だけです。別taskや過去Issueの欠陥を今回のfindingへ混ぜないでください。\n\n` +
    `${reviewProfileInstruction(config.profile)}${promptBody}\n\n${RESPONSE_FORMAT_INSTRUCTION}`;
  const executed = await executor({
    endpoint: config.endpoint,
    model: config.model,
    prompt,
    timeoutMs: config.timeoutMs,
  });
  if (executed.state !== "succeeded")
    return { state: "degraded", reason: executed.reason, truncated };
  const findings = parseFindings(executed.output ?? "");
  if (findings === undefined)
    return {
      state: "degraded",
      reason: "補助レビュー応答を構造化findingsへparseできませんでした",
      truncated,
    };
  const scoped = filterReviewFindingsToTarget(findings, targetFiles);
  const presented = {
    ...scoped,
    findings: visibleReviewFindings(scoped.findings, config.profile),
  };
  if (!verification) return { state: "findings", ...presented, truncated };
  let verified;
  try {
    verified = await verifyReviewFindings(
      {
        ...verification,
        findings: presented.findings,
        endpoint: config.endpoint,
        model: config.model,
        timeoutMs: config.timeoutMs,
      },
      executor,
    );
  } catch {
    return {
      state: "degraded",
      reason: "findingの投稿前検証に失敗しました",
      truncated,
    };
  }
  // A second LLM pass is only advisory: it can reject a real defect while
  // describing its failure path. Preserve every scoped first-pass candidate.
  return {
    state: "needs_coordinator_review",
    ...presented,
    verificationSuggestedFindings: verified?.suggestedFindings ?? null,
    verificationAssessments: verified?.assessments ?? null,
    headSha: verification.headSha,
    truncated,
  };
}

/**
 * base/head解決不可、非loopback endpoint（`assertLoopbackEndpoint`の拒否）、
 * その他収集・送信段の例外はここで`error`へ変換し、呼出し元（Step 03/07/10の
 * 既存実施）を例外で止めない（NFR-1428-02、AC-1428-06）。
 */
function toErrorResult(error: unknown): SupplementalReviewResult {
  return {
    state: "error",
    reason: error instanceof Error ? error.message : String(error),
  };
}

function loadWorkspaceConfig(root: string, configPath?: string) {
  const selected = configPath ?? SUPPLEMENTAL_REVIEW_CONFIG_PATH;
  const local = loadSupplementalReviewConfig(root, selected);
  let localPathExists = false;
  try {
    fs.lstatSync(path.resolve(root, selected));
    localPathExists = true;
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      return undefined;
  }
  if (local || configPath || localPathExists) return local;
  const candidatePrimary = peekPrimaryReviewRoot(root);
  if (
    candidatePrimary === undefined ||
    candidatePrimary === root ||
    !fs.existsSync(path.join(candidatePrimary, selected))
  )
    return undefined;
  try {
    const primaryRoot = resolveReviewRoot(root).primaryRoot;
    return primaryRoot === root
      ? undefined
      : loadSupplementalReviewConfig(primaryRoot, selected);
  } catch {
    return undefined;
  }
}

/** Step 10相当の対象（exact-head diff＋関連ファイル）に対する補助レビューを実行する（FR-1428-02、FR-1428-04）。 */
export async function launchSupplementalReviewDiff(
  input: {
    root: string;
    baseSha: string;
    headSha: string;
    configPath?: string;
    limit?: number;
  },
  dependencies: { execute?: ReviewerExecutor } = {},
): Promise<SupplementalReviewResult> {
  const config = loadWorkspaceConfig(input.root, input.configPath);
  if (config === undefined) return { state: "disabled" };
  try {
    resolveReviewRoot(input.root);
    if (
      !/^[a-f0-9]{40}$/u.test(input.baseSha) ||
      !/^[a-f0-9]{40}$/u.test(input.headSha) ||
      git(["rev-parse", "HEAD"], input.root).stdout.trim() !== input.headSha
    )
      return {
        state: "error",
        reason: "比較基点または対象HEADを固定できませんでした",
      };
    const collected = collectSupplementalReviewDiff(
      input.root,
      input.baseSha,
      input.headSha,
      input.limit ?? RELATED_FILE_LIMIT,
    );
    const promptBody = `${DIFF_REVIEW_INSTRUCTION}\n\n${collected.promptBody}`;
    const result = await dispatch(
      promptBody,
      config,
      collected.truncated,
      collected.changed,
      dependencies.execute,
      { root: input.root, headSha: input.headSha },
    );
    if (git(["rev-parse", "HEAD"], input.root).stdout.trim() !== input.headSha)
      return { state: "error", reason: "対象HEADを固定できませんでした" };
    return result;
  } catch (error) {
    return toErrorResult(error);
  }
}

/** Step 03/07相当の対象（staging文書間のID整合性）に対する補助レビューを実行する（FR-1428-03、FR-1428-04）。 */
export async function launchSupplementalReviewStaging(
  input: {
    root: string;
    stagingPath: string;
    configPath?: string;
  },
  dependencies: { execute?: ReviewerExecutor } = {},
): Promise<SupplementalReviewResult> {
  const config = loadWorkspaceConfig(input.root, input.configPath);
  if (config === undefined) return { state: "disabled" };
  try {
    resolveReviewWorkspace(input.root, input.stagingPath);
    const collected = collectSupplementalReviewStaging(
      input.root,
      input.stagingPath,
    );
    const promptBody = `${STAGING_REVIEW_INSTRUCTION}\n\n${collected.promptBody}`;
    return await dispatch(
      promptBody,
      config,
      false,
      collected.changed,
      dependencies.execute,
    );
  } catch (error) {
    return toErrorResult(error);
  }
}
