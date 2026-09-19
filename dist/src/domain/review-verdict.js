import { evaluateReviewJudgment } from "./review.js";
import { isRecord } from "../types.js";
/**
 * `findings[].riskAcceptance`は「人間の権限者がこのリスクを受容した」という
 * 承認の主張であり、主観的な評価（affirmative/adversarial・所見の内容）とは
 * 性質が異なる。LLM応答にそのまま含めさせると、Critical/High findingを
 * `status: "valid"`のまま自分自身の`riskAcceptance`で`acceptedRisks`側へ
 * 動かし、`blocking`を回避できてしまう（自己承認。独立レビュー指摘）。
 * ここで機械的に剥奪し、`riskAcceptance`はLLM出力からは絶対に採用しない。
 */
function stripRiskAcceptance(findings) {
    if (!Array.isArray(findings))
        return findings;
    const items = findings;
    return items.map((finding) => {
        if (!isRecord(finding))
            return finding;
        const { riskAcceptance: _riskAcceptance, ...rest } = finding;
        return rest;
    });
}
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
];
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
 *
 * `findings[].riskAcceptance`はさらに個別に剥奪する（`stripRiskAcceptance`）。
 * これは「人間の権限者が承認した」という主張であり主観的評価ではないため、
 * LLM自身に付与させるとCritical/High findingを自己承認で`acceptedRisks`へ
 * 動かせてしまう。`replace`モードのローカルLLM経路からはriskAcceptanceを
 * 一切成立させない（受容が必要な指摘は常に`blocking`として安全側に倒す）。
 */
export function evaluateLocalLlmReview(output) {
    let parsed;
    try {
        parsed = JSON.parse(output);
    }
    catch {
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
    const subjective = {};
    for (const field of SUBJECTIVE_FIELDS)
        if (Object.hasOwn(parsed, field))
            subjective[field] = parsed[field];
    if (Object.hasOwn(subjective, "findings"))
        subjective.findings = stripRiskAcceptance(subjective.findings);
    try {
        const judgment = evaluateReviewJudgment(subjective);
        return {
            approved: judgment.errors.length === 0 && judgment.blocking.length === 0,
            blocking: judgment.blocking,
            acceptedRisks: judgment.acceptedRisks,
            errors: judgment.errors,
        };
    }
    catch (error) {
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
//# sourceMappingURL=review-verdict.js.map