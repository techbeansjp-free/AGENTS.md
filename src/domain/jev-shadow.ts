/**
 * Continuous shadow evaluation（Issue #1486、T-02）。
 *
 * `agent-skill-chain decision invoke --apply`が実際にproviderへ委譲した
 * 呼び出し（`executor.kind === "provider"`。今日時点でDCAND-008の
 * unknown分岐・DCAND-009・DCAND-010）について、Jevが設定済み（enabled）
 * であれば同じ判断対象で追加にJevへも問い合わせ、結果を記録する。
 *
 * **shadowはauthorityを一切持たない。** `effectiveValue`・
 * `requiresConfirmation`・`rejected`は既存provider（lightweight-tier）の
 * 結果のまま変わらない。Jevの提案は`JevShadowRecord`へ別途記録するだけで、
 * `resolveAuthorityDecision`の判定へは渡らない（設計正本「最終確定仕様」
 * §4「shadow結果に基づくauthority付与は付録A3の対象外」）。
 *
 * **DCAND-006は対象外（disclosed gap）。** DCAND-006のproposedValueは
 * finding分類の呼び出し元（Step 10 review round）が自由形式で決める文字列
 * であり、`decision invoke`自身は列挙可能なoption集合を知らない。Jevの
 * choice APIはoptions（列挙）を要求するため、DCAND-006をshadow対象へ含める
 * には呼び出し元（review-session.ts）側でseverity/relationの列挙可能な
 * 候補集合を先に決める設計変更が必要になる。本Issueのスコープでは
 * DCAND-008/009/010（列挙可能な候補集合を`decision invoke`自身が既に
 * 持っている3型）だけをshadow対象にする。
 */
import type {
  DecisionAuthorityMode,
  DecisionExecutor,
} from "./decision-types.js";
import type {
  JevChoiceQuestionSpec,
  JevDispatchOutcome,
} from "./jev-dispatch.js";

/** `executor.kind === "provider"`のdecisionだけがshadow対象になり得る。 */
export function isJevShadowEligible(executor: DecisionExecutor): boolean {
  return executor.kind === "provider";
}

const DCAND_010_CRITERIA: Readonly<Record<string, string>> = Object.freeze({
  minor:
    "軽微な矛盾3条件（設計正本が定める判定基準）を全て満たし、gateを緩めても安全と判断できる",
  "not-minor":
    "軽微な矛盾3条件のいずれかを満たさない、またはgateを緩めるべきでないと判断できる",
});

const DCAND_008_CRITERIA: Readonly<Record<string, string>> = Object.freeze({
  "confirmed-limited":
    "対象PRの最新HEADに紐づくCodeRabbit自身のcheck・review・通知に明示的なrate limitの記載がある",
  "no-limit-evidence":
    "最新HEADについて必要なGitHub情報を取得できたが、明示的なrate limitの記載は無い",
  unknown: "GitHub情報を取得できない、または最新HEAD・identityを確定できない",
});

export interface JevShadowQuestionPlan {
  readonly question: JevChoiceQuestionSpec;
  readonly state: Readonly<Record<string, unknown>>;
}

/**
 * `subjectRef`（判断対象を指す文字列。例:「PR#1485 finding F-01」）だけを
 * 送信する。**呼び出し側が渡した`payload`の内容（finding evidence等の
 * 自由形式text）は一切送らない。** 送ってよいevidence sub-fieldの
 * per-type allowlistは本Issueのスコープに含めない（disclosed gap。実際に
 * evidence文字列を使う呼び出し元がまだ無いため、allowlistを先に作らない）。
 */
export function planJevShadowQuestion(input: {
  readonly decisionTypeId: string;
  readonly subjectRef: string;
  readonly candidateSet?: readonly string[];
}): JevShadowQuestionPlan | undefined {
  if (input.decisionTypeId === "DCAND-010") {
    return {
      question: {
        key: "dcand010",
        options: ["minor", "not-minor"],
        criteria: DCAND_010_CRITERIA,
      },
      state: { context: `軽微な矛盾3条件判定の対象: ${input.subjectRef}` },
    };
  }
  if (input.decisionTypeId === "DCAND-008") {
    return {
      question: {
        key: "dcand008",
        options: ["confirmed-limited", "no-limit-evidence", "unknown"],
        criteria: DCAND_008_CRITERIA,
      },
      state: { context: `CodeRabbit利用枠制限判定の対象: ${input.subjectRef}` },
    };
  }
  if (input.decisionTypeId === "DCAND-009") {
    if (input.candidateSet === undefined || input.candidateSet.length < 2)
      return undefined;
    const criteria = Object.fromEntries(
      input.candidateSet.map((name) => [
        name,
        `reviewer候補として${name}を選ぶ`,
      ]),
    );
    return {
      question: {
        key: "dcand009",
        options: [...input.candidateSet],
        criteria,
      },
      state: { context: `reviewer選定の対象: ${input.subjectRef}` },
    };
  }
  return undefined;
}

export interface JevShadowRecord {
  readonly decisionRecordId: string;
  readonly decisionTypeId: string;
  readonly candidateHeadSha: string;
  readonly primaryProposedValue: string;
  readonly primaryAuthorityMode: DecisionAuthorityMode;
  readonly jevModel: string;
  readonly jevResolvedModel: string | null;
  readonly jevProposedValue: string | null;
  readonly jevConfidence: number | null;
  readonly outcomeKind: JevDispatchOutcome["kind"];
  readonly outcomeDetail: string | null;
  readonly matchesPrimaryProposedValue: boolean | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly dispatchedAt: string;
}

export function buildJevShadowRecord(input: {
  readonly decisionRecordId: string;
  readonly decisionTypeId: string;
  readonly candidateHeadSha: string;
  readonly primaryProposedValue: string;
  readonly primaryAuthorityMode: DecisionAuthorityMode;
  readonly jevModel: string;
  readonly outcome: JevDispatchOutcome;
  readonly latencyMs: number;
  readonly dispatchedAt: string;
}): JevShadowRecord {
  const base = {
    decisionRecordId: input.decisionRecordId,
    decisionTypeId: input.decisionTypeId,
    candidateHeadSha: input.candidateHeadSha,
    primaryProposedValue: input.primaryProposedValue,
    primaryAuthorityMode: input.primaryAuthorityMode,
    jevModel: input.jevModel,
    latencyMs: input.latencyMs,
    dispatchedAt: input.dispatchedAt,
  };
  const { outcome } = input;
  if (outcome.kind === "ok") {
    return {
      ...base,
      jevResolvedModel: outcome.resolvedModel,
      jevProposedValue: outcome.answer.choice,
      jevConfidence: outcome.answer.confidence,
      outcomeKind: outcome.kind,
      outcomeDetail: null,
      matchesPrimaryProposedValue:
        outcome.answer.choice === input.primaryProposedValue,
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
    };
  }
  const outcomeDetail =
    outcome.kind === "rate-limited"
      ? `retryAfterMs=${outcome.retryAfterMs ?? "unknown"}`
      : outcome.kind === "unexpected-status"
        ? `status=${outcome.status}: ${outcome.detail}`
        : outcome.detail;
  return {
    ...base,
    jevResolvedModel: null,
    jevProposedValue: null,
    jevConfidence: null,
    outcomeKind: outcome.kind,
    outcomeDetail,
    matchesPrimaryProposedValue: null,
    inputTokens: 0,
    outputTokens: 0,
  };
}
