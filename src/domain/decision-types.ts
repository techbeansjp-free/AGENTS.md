/**
 * Decision Type Registry（Issue #1485、v0.4.2 Bounded Decision Skill core）。
 *
 * 設計正本`memo/v0.4.*-計画/04_bounded-decision-skill_再設計.md`
 * 「最終確定仕様」§1が定める、有限選択判断1種類あたりの
 * `executor`（誰が判断するか）と`authorityMode`（提案がどこまで自動反映されるか）
 * の対応表をここへ機械可読な形で持つ。Issue #1483（`decision-contract.ts`）の
 * `DECISION_CANDIDATES`が定義する候補一覧を置き換えず、そのうち採用済み5件
 * （DCAND-001〜005）と除外理由がBR-01（呼び出し元を名指しできない）だった
 * 4件（DCAND-006/008/009/010）を、Decision Skill自身という新しい呼び出し元
 * （`agent-skill-chain decision invoke`）へ束ねる。
 */
import type { DecisionCallableTarget } from "./decision-contract.js";

/** `DecisionCallableTarget`から`"unassigned"`を除いた、実際に委譲可能な対象。 */
export type DecisionProviderTarget = Exclude<
  DecisionCallableTarget,
  "unassigned"
>;

export type DecisionExecutor =
  | { readonly kind: "deterministic"; readonly resolverId: string }
  | {
      readonly kind: "provider";
      readonly target: DecisionProviderTarget;
      readonly model?: string;
    };

/**
 * 判断の提案がどこまで自動的に有効値へ昇格するか。
 *
 * - `authoritative`: 提案がそのまま有効値になる（DCAND-001〜005、DCAND-008の
 *   deterministic resolverが確定できた範囲）。
 * - `advisory`: 提案は記録されるが、有効値への反映には別途確認
 *   （`confirmedBy`）を要する（DCAND-006、DCAND-008のunknown範囲、
 *   DCAND-010の`minor`方向）。
 * - `one-way-escalation`: 安全側（fail-closed）方向の提案だけが確認なしで
 *   自動反映される。緩和方向は`advisory`と同じ扱いになる（DCAND-010の
 *   `not-minor`方向）。
 * - `constrained-choice`: あらかじめcompiled codeが計算した安全な候補集合の
 *   中からの選択だけを自動反映する。候補集合外の値は拒否する（DCAND-009）。
 */
export type DecisionAuthorityMode =
  "authoritative" | "advisory" | "one-way-escalation" | "constrained-choice";

export interface DecisionTypeDefinition {
  readonly id: string;
  readonly label: string;
  readonly executor: DecisionExecutor;
  readonly authorityMode: DecisionAuthorityMode;
}

/**
 * DCAND-006/008/009/010は本Issueで初めてSkill化される。DCAND-001〜005は
 * 既存compiled codeをdeterministic resolverとしてラップするだけで、既存
 * 呼び出し元（`issue.ts`・`cli.ts`・`review-artifact.ts`・`policy.ts`）の
 * 挙動を変えない。DCAND-007/011/012は恒久的に対象外（fail-open方向、または
 * 有限選択の対象外）であり、このRegistryへ加えない。
 */
export const DECISION_TYPES: readonly DecisionTypeDefinition[] = Object.freeze([
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
    id: "DCAND-004",
    label: "個別監査表の行分類（auditRowDraft）",
    executor: Object.freeze({ kind: "deterministic", resolverId: "DCAND-004" }),
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

export function findDecisionType(
  id: string,
): DecisionTypeDefinition | undefined {
  return DECISION_TYPES.find((entry) => entry.id === id);
}

/**
 * DCAND-010の安全側（fail-closed）方向。この値と一致する提案だけが
 * `one-way-escalation`のもとで確認なしに自動反映される。
 */
export const DCAND_010_SAFE_VALUE = "not-minor";
