/**
 * `EvaluationLabel`（Issue #1486、T-03）。
 *
 * 設計正本`memo/v0.4.*-計画/04_bounded-decision-skill_再設計.md`
 * 「最終確定仕様」§4が定める、Decision Recordと別に持つ評価用label。
 * **`effectiveValue`（進行役が採用した値）はground truthではない。**
 * `referenceValue`（事後に確定した正解）とJevの`proposedValue`を比較して
 * 初めて精度評価になる（循環論法を避ける）。
 *
 * **この module はpure domain。** journalのfile I/Oは
 * `src/adapters/evaluation-label-store.ts`が持つ。
 */
import { isRecord } from "../types.js";

export const LABEL_SOURCES = [
  "deterministic-oracle",
  "evidence-adjudicated",
  "independent-review",
  "owner-adjudicated",
] as const;

export type EvaluationLabelSource = (typeof LABEL_SOURCES)[number];

export interface EvaluationLabel {
  readonly decisionRecordId: string;
  readonly referenceValue: string;
  readonly labelSource: EvaluationLabelSource;
  readonly evidenceRefs: readonly string[];
  readonly labeledAt: string;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "")
    throw new Error(`${label}は空でない文字列が必要です`);
  return value;
}

function requiredLabelSource(value: unknown): EvaluationLabelSource {
  if (
    typeof value !== "string" ||
    !(LABEL_SOURCES as readonly string[]).includes(value)
  )
    throw new Error(
      `labelSourceは${LABEL_SOURCES.join("、")}のいずれかが必要です`,
    );
  return value as EvaluationLabelSource;
}

function requiredEvidenceRefs(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("evidenceRefsは1件以上の配列が必要です");
  return value.map((entry, index) =>
    requiredString(entry, `evidenceRefs[${index}]`),
  );
}

/**
 * 入力から`EvaluationLabel`を検証しながら構築する。**`owner-adjudicated`
 * 以外の3種は、少なくとも1件の`evidenceRefs`（別decisionRecordId・
 * test/source/diffのpath・独立reviewerの成果物path等）を要求する
 * （owner-adjudicatedだけはowner自身の裁定であり、別evidenceを要求しない）。**
 */
export function parseEvaluationLabelInput(value: unknown): EvaluationLabel {
  if (!isRecord(value))
    throw new Error("evaluation label入力はobjectが必要です");
  const labelSource = requiredLabelSource(value.labelSource);
  const evidenceRefs =
    labelSource === "owner-adjudicated" && !Array.isArray(value.evidenceRefs)
      ? []
      : requiredEvidenceRefs(value.evidenceRefs);
  return {
    decisionRecordId: requiredString(
      value.decisionRecordId,
      "decisionRecordId",
    ),
    referenceValue: requiredString(value.referenceValue, "referenceValue"),
    labelSource,
    evidenceRefs,
    labeledAt: requiredString(value.labeledAt, "labeledAt"),
  };
}
