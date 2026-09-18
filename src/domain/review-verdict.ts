import { evaluateReviewJudgment, type ReviewJudgmentInput } from "./review.js";
import { isRecord } from "../types.js";

const SUBJECTIVE_FIELDS = [
  "round",
  "developmentConsiderations",
  "affirmative",
  "adversarial",
  "rationales",
  "focus",
  "tests",
  "specConsistency",
  "findings",
] as const;

export interface LocalLlmReviewVerdict {
  approved: boolean;
  blocking: string[];
  acceptedRisks: string[];
  errors: string[];
}

/**
 * FR-107（`replace`モード）が要求する「reviewer役割の正式な充足条件」を、
 * 新しい並行判定ロジックとしてではなく、既存`evaluateReviewJudgment`
 * （Claude/Codexレビューと同一のaffirmative/adversarial評価・Critical/High
 * findingsのblocking判定ロジック）へ流し込むことで満たす。
 *
 * `evaluateReview`（`review.ts`）は使わない。同関数の`validateImmutableCandidateEvidence`
 * は「GitHub上で実際にreviewがapprovedとして提出された」という外部事実の存在を
 * 要求しており、これから判定しようとしている対象（まだ外部reviewが存在しない
 * 候補）には適用できない。呼出し元が`externalEvidence.review.verdict = "approved"`
 * を自己申告するだけで通ってしまうと、この関数が守るべき「外部の実在するreview
 * だけが承認を与える」という前提を、まさにこの経路で崩す（FR-107結線の設計
 * レビューで判明。docs/reviews参照）。
 *
 * LLM出力からは主観的な評価部分（affirmative/adversarial評価・findings・
 * developmentConsiderations等）だけを採用する。それ以外のkeyが含まれていても
 * 無視する（客観evidence関連のkeyを注入しようとする応答への防御）。
 */
export function evaluateLocalLlmReview(output: string): LocalLlmReviewVerdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return {
      approved: false,
      blocking: [],
      acceptedRisks: [],
      errors: ["ローカルLLM応答が不正なJSON形式のためreview判定を行えません"],
    };
  }
  if (!isRecord(parsed))
    return {
      approved: false,
      blocking: [],
      acceptedRisks: [],
      errors: ["ローカルLLM応答がJSON objectではありません"],
    };
  const subjective: Record<string, unknown> = {};
  for (const field of SUBJECTIVE_FIELDS)
    if (Object.hasOwn(parsed, field)) subjective[field] = parsed[field];
  try {
    const judgment = evaluateReviewJudgment(
      subjective as unknown as ReviewJudgmentInput,
    );
    return {
      approved: judgment.errors.length === 0 && judgment.blocking.length === 0,
      blocking: judgment.blocking,
      acceptedRisks: judgment.acceptedRisks,
      errors: judgment.errors,
    };
  } catch (error) {
    return {
      approved: false,
      blocking: [],
      acceptedRisks: [],
      errors: [
        error instanceof Error
          ? error.message
          : "ローカルLLM応答のreview判定に失敗しました",
      ],
    };
  }
}
