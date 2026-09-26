/**
 * Decision Type Registryのdeterministic resolver実体（Issue #1485、L-01）。
 *
 * DCAND-001〜005は既存compiled codeを**そのまま**呼ぶだけのwrapperであり、
 * 判定内容を1つも変えない。既存の呼び出し元（`issue.ts`・`cli.ts`・
 * `review-artifact.ts`・`policy.ts`）はこれらのresolverを経由せず、直接
 * 既存関数を呼び続ける（L-01「現在の呼び出し元の挙動を変えない」）。
 *
 * DCAND-008は本Issueで新設するdeterministic resolverであり、
 * `.agent-skill-chain/docs/01_開発ワークフロー.md`「CodeRabbitの利用枠制限の判定」
 * 節の基準（対象PRの最新HEADに対する明示的なrate limit観測だけを証拠にし、
 * checkの不在・過去HEADの通知・単なるreview待ちは証拠にしない）を機械化する。
 * 確定できない場合は`"unknown"`を返し、呼び出し側（`decision-invoke.ts`）が
 * providerへadvisoryで委譲する。
 */
import { detectQuickDisqualifiers } from "./mode.js";
import {
  inspectCiDelivery,
  type CiDeliveryInput,
  type CiDeliveryInspection,
} from "./ci-delivery.js";
import { requiresSpecUpdate } from "./spec.js";
import { auditRowDraft } from "./review-artifact.js";
import { hasConcreteDecisionText } from "./policy.js";

export interface Dcand001Input {
  readonly changedFiles: readonly string[];
}
export function resolveDcand001(input: Dcand001Input): readonly string[] {
  return detectQuickDisqualifiers([...input.changedFiles]);
}

export function resolveDcand002(input: CiDeliveryInput): CiDeliveryInspection {
  return inspectCiDelivery(input);
}

export interface Dcand003Input {
  readonly changedFiles: readonly string[];
}
export function resolveDcand003(input: Dcand003Input): boolean {
  return requiresSpecUpdate(input.changedFiles);
}

export interface Dcand004Input {
  readonly path: string;
  readonly changeType: "A" | "M" | "D" | "R";
}
export function resolveDcand004(input: Dcand004Input): string {
  return auditRowDraft(input.path, input.changeType);
}

export interface Dcand005Input {
  readonly value: unknown;
  readonly minimum: number;
}
export function resolveDcand005(input: Dcand005Input): boolean {
  return hasConcreteDecisionText(input.value, input.minimum);
}

export type CodeRabbitLimitEvidenceValue =
  "confirmed-limited" | "no-limit-evidence" | "unknown";

export interface CodeRabbitLimitObservation {
  /** GitHub上でこの観測がどこから来たか。 */
  readonly kind: "check-run" | "review" | "notification" | "review-pending";
  /** この観測が付与されているHEAD SHA。 */
  readonly targetHeadSha: string;
  /** 観測されたtitle・本文・要約テキスト。 */
  readonly text: string;
  readonly observedAt: string;
}

export interface Dcand008Input {
  /** 判定対象PRの最新HEAD SHA。 */
  readonly latestHeadSha: string;
  readonly observations: readonly CodeRabbitLimitObservation[];
}

export interface CodeRabbitLimitEvidenceResult {
  readonly value: CodeRabbitLimitEvidenceValue;
  readonly matchedObservations: readonly CodeRabbitLimitObservation[];
}

const RATE_LIMIT_PATTERN =
  /rate.?limit|usage limit|quota exceeded|利用枠|レート制限|上限に達/iu;

/**
 * `checkの不在、過去HEADの通知、単なるreview待ちは制限の証拠にしない`
 * （`01_開発ワークフロー.md`）を機械化する。**最新HEADを対象にした観測だけ**
 * を見る（`targetHeadSha !== latestHeadSha`は無視する＝過去HEAD通知の除外）。
 */
export function resolveDcand008(
  input: Dcand008Input,
): CodeRabbitLimitEvidenceResult {
  const relevant = input.observations.filter(
    (observation) => observation.targetHeadSha === input.latestHeadSha,
  );
  const limited = relevant.filter((observation) =>
    RATE_LIMIT_PATTERN.test(observation.text),
  );
  if (limited.length > 0)
    return { value: "confirmed-limited", matchedObservations: limited };
  // 単なるreview待ち（review-pending）やnotificationだけでは「制限が無い」証拠にも
  // ならない。check-run・reviewという実際に完了した活動が最新HEADに存在し、かつ
  // rate limit言及が無い場合だけ`no-limit-evidence`とする。
  const completedActivity = relevant.filter(
    (observation) =>
      observation.kind === "check-run" || observation.kind === "review",
  );
  if (completedActivity.length > 0)
    return {
      value: "no-limit-evidence",
      matchedObservations: completedActivity,
    };
  return { value: "unknown", matchedObservations: [] };
}
