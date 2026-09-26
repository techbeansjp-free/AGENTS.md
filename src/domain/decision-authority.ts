/**
 * `DecisionAuthorityMode`ごとに、Providerの提案（`proposedValue`）が有効値
 * （`effectiveValue`）へどこまで自動反映されるかを決めるpure判定
 * （Issue #1485、設計正本「最終確定仕様」§1）。
 *
 * **`findingAdmission`（`review-convergence.ts`）と同じ理由でfail-openを
 * 作らない。** `advisory`は`confirmedBy`が無ければ`effectiveValue`を`null`に
 * 留め、`one-way-escalation`は安全側（fail-closed）方向の提案だけを自動反映し、
 * 緩和方向は`advisory`と同じ確認待ちにする。`constrained-choice`は
 * compiled codeが計算済みの安全な候補集合の外を拒否する。
 */
import type { DecisionAuthorityMode } from "./decision-types.js";

export interface AuthorityDecisionInput {
  readonly authorityMode: DecisionAuthorityMode;
  readonly proposedValue: string;
  /** 進行役がこの提案を明示的に確認したことを示す識別子。未確認は`undefined`。 */
  readonly confirmedBy?: string;
  /** `one-way-escalation`のときだけ使う、安全側（fail-closed）方向の値。 */
  readonly oneWaySafeValue?: string;
  /** `constrained-choice`のときだけ使う、compiled codeが計算済みの安全な候補集合。 */
  readonly candidateSet?: readonly string[];
}

export interface AuthorityDecisionResult {
  readonly effectiveValue: string | null;
  readonly requiresConfirmation: boolean;
  readonly rejected: boolean;
  readonly reason: string;
}

export function resolveAuthorityDecision(
  input: AuthorityDecisionInput,
): AuthorityDecisionResult {
  const { authorityMode, proposedValue, confirmedBy } = input;
  const confirmed = typeof confirmedBy === "string" && confirmedBy !== "";

  if (authorityMode === "authoritative")
    return {
      effectiveValue: proposedValue,
      requiresConfirmation: false,
      rejected: false,
      reason: "authoritative: 提案をそのまま有効値として採用した",
    };

  if (authorityMode === "advisory") {
    if (confirmed)
      return {
        effectiveValue: proposedValue,
        requiresConfirmation: false,
        rejected: false,
        reason: `advisory: ${confirmedBy}が明示的に確認したため有効値へ反映した`,
      };
    return {
      effectiveValue: null,
      requiresConfirmation: true,
      rejected: false,
      reason: "advisory: 提案は記録したが進行役の確認が無いため有効値へ反映しない",
    };
  }

  if (authorityMode === "one-way-escalation") {
    if (input.oneWaySafeValue === undefined)
      throw new Error("one-way-escalationにはoneWaySafeValueが必要です");
    if (proposedValue === input.oneWaySafeValue)
      return {
        effectiveValue: proposedValue,
        requiresConfirmation: false,
        rejected: false,
        reason: "one-way-escalation: 安全側（fail-closed）方向のため確認なしで有効値へ反映した",
      };
    if (confirmed)
      return {
        effectiveValue: proposedValue,
        requiresConfirmation: false,
        rejected: false,
        reason: `one-way-escalation: 緩和方向だが${confirmedBy}が明示的に確認したため有効値へ反映した`,
      };
    return {
      effectiveValue: null,
      requiresConfirmation: true,
      rejected: false,
      reason: "one-way-escalation: 緩和方向の提案は進行役の確認が無いため有効値へ反映しない",
    };
  }

  // constrained-choice
  if (input.candidateSet === undefined)
    throw new Error("constrained-choiceにはcandidateSetが必要です");
  if (!input.candidateSet.includes(proposedValue))
    return {
      effectiveValue: null,
      requiresConfirmation: false,
      rejected: true,
      reason: `constrained-choice: 提案が候補集合外です（候補: ${input.candidateSet.join(", ") || "(空)"}）`,
    };
  return {
    effectiveValue: proposedValue,
    requiresConfirmation: false,
    rejected: false,
    reason: "constrained-choice: 候補集合内の選択のため有効値へ反映した",
  };
}
