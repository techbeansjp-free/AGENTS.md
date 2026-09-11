/**
 * SCN IDの文法（TERM-ASC-104）。**この文法の字面はここにだけ置く。**
 *
 * `SCN-`に大文字英数字とハイフンだけを1文字以上続けた識別子である。conformance
 * binding schemaの`pattern`と同じ集合であり、Issue成果物検証（`issue validate`）と
 * delivery証跡（`pr create`）は同じ述語で判定する。
 * 検査ごとに正規表現を書き写すと、末尾境界の有無だけで受理集合が食い違い、工程の
 * 途中で受理したIDが終端で拒否される（Issue #1349）。
 *
 * **小文字の枝番（`SCN-69-001a`）は文法外である。** 文法の拡張はschema・
 * `scripts/check_trace.ts`・`scripts/check_gherkin_format.ts`と同時に行う。
 */
export const SCENARIO_ID_CHARACTER_CLASS = "[A-Z0-9-]";
/** `SCN-`に続く本体の文法（1文字以上）。正規表現へ埋め込む字面 */
export const SCENARIO_ID_BODY = `${SCENARIO_ID_CHARACTER_CLASS}+`;
const SCENARIO_ID = new RegExp(`^SCN-${SCENARIO_ID_BODY}$`, "u");
/** 文字列全体がSCN IDの文法に適合するときだけtrue。正規化・読み替えを行わない */
export function isScenarioId(value) {
    return typeof value === "string" && SCENARIO_ID.test(value);
}
//# sourceMappingURL=scenario-id.js.map