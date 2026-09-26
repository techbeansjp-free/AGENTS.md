/**
 * DCAND-006/008/009/010は本Issueで初めてSkill化される。DCAND-001〜005は
 * 既存compiled codeをdeterministic resolverとしてラップするだけで、既存
 * 呼び出し元（`issue.ts`・`cli.ts`・`policy.ts`）の
 * 挙動を変えない。DCAND-007/011/012は恒久的に対象外（fail-open方向、または
 * 有限選択の対象外）であり、このRegistryへ加えない。
 */
export const DECISION_TYPES = Object.freeze([
    Object.freeze({
        id: "DCAND-001",
        label: "quick失格分類の検出（detectQuickDisqualifiers）",
        executor: Object.freeze({ kind: "deterministic", resolverId: "DCAND-001" }),
        authorityMode: "authoritative",
    }),
    Object.freeze({
        id: "DCAND-002",
        label: "CI run配信状態の3値判定（inspectCiDelivery）",
        executor: Object.freeze({ kind: "deterministic", resolverId: "DCAND-002" }),
        authorityMode: "authoritative",
    }),
    Object.freeze({
        id: "DCAND-003",
        label: "仕様更新要否の判定（requiresSpecUpdate）",
        executor: Object.freeze({ kind: "deterministic", resolverId: "DCAND-003" }),
        authorityMode: "authoritative",
    }),
    Object.freeze({
        id: "DCAND-005",
        label: "開発考慮事項の決定文言が具体的かの判定（hasConcreteDecisionText）",
        executor: Object.freeze({ kind: "deterministic", resolverId: "DCAND-005" }),
        authorityMode: "authoritative",
    }),
    Object.freeze({
        id: "DCAND-006",
        label: "review findingの分類・理由の記入",
        executor: Object.freeze({ kind: "provider", target: "lightweight-tier" }),
        authorityMode: "advisory",
    }),
    Object.freeze({
        id: "DCAND-008",
        label: "CodeRabbit利用枠制限の判定",
        executor: Object.freeze({ kind: "deterministic", resolverId: "DCAND-008" }),
        /**
         * ここに置く値は`unknown`時（deterministic resolverが確定できず
         * providerへ委譲する場合）のfallback authorityModeである。resolverが
         * `confirmed-limited`/`no-limit-evidence`を確定できた場合は
         * `src/adapters/decision-invoke.ts`が`authoritative`へ上書きする
         * （設計正本「最終確定仕様」§1の「authoritative（確定できた範囲）／
         * advisory（残り）」を1つのDecision Typeで表現するための実装上の分岐）。
         */
        authorityMode: "advisory",
    }),
    Object.freeze({
        id: "DCAND-009",
        label: "reviewer選定（Codex Sol/Opus等）",
        executor: Object.freeze({ kind: "provider", target: "lightweight-tier" }),
        authorityMode: "constrained-choice",
    }),
    Object.freeze({
        id: "DCAND-010",
        label: "「軽微な矛盾」3条件判定",
        executor: Object.freeze({ kind: "provider", target: "lightweight-tier" }),
        authorityMode: "one-way-escalation",
    }),
]);
export function findDecisionType(id) {
    return DECISION_TYPES.find((entry) => entry.id === id);
}
/**
 * DCAND-010の安全側（fail-closed）方向。この値と一致する提案だけが
 * `one-way-escalation`のもとで確認なしに自動反映される。
 */
export const DCAND_010_SAFE_VALUE = "not-minor";
//# sourceMappingURL=decision-types.js.map