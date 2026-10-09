import type { DeliveryState } from "./delivery-state.js";
import {
  latestPlanSeal,
  planAmendmentDigests,
  planSealDigest,
  type PlanSeal,
} from "./plan-seal.js";
import {
  isReviewSessionConverged,
  type ReviewSessionState,
} from "./review-convergence.js";
import type { VerificationRunRecord } from "./verification-run.js";

/**
 * 再開状態（TERM-1517-01、REQ-WF-047）。
 *
 * `workflow advance`のpreviewが保存済み記録とGitから都度導出するpointer集合である。
 * **保存せず、gateの判定根拠にしない（`authority`は常に`advisory`）。** 本文・証拠の
 * 文字列を持たず、path・SHA・digest・状態・件数だけを返す。
 */
export interface WorkflowResume {
  authority: "advisory";
  staging: string;
  headSha: string | null;
  baseSha: string | null;
  planning: {
    sealed: boolean;
    sealDigest: string | null;
    amendmentCount: number;
  } | null;
  implementation: {
    headSha: string | null;
    matchesHead: boolean | null;
  };
  verification: {
    headSha: string;
    scope: VerificationRunRecord["scope"];
    passed: boolean;
    recordDigest: string;
    matchesImplementationHead: boolean | null;
  } | null;
  review: {
    status: ReviewSessionState["status"];
    latestRoundDigest: string;
    candidateHeadSha: string;
    rounds: number;
    matchesImplementationHead: boolean | null;
  } | null;
  delivery: {
    state: DeliveryState["state"];
    pr: number | null;
  } | null;
  errors: string[];
}

/** readerごとの観測結果。失敗は例外にせず理由の文字列で渡す。 */
export type ResumeObservation<T> =
  { ok: true; value: T } | { ok: false; error: string };

export interface WorkflowResumeObservations {
  staging: string;
  headSha: ResumeObservation<string>;
  journal: ResumeObservation<
    readonly {
      step: number;
      implementationHeadSha?: string;
      planSeal?: PlanSeal;
    }[]
  >;
  /** `05_計画変更.md`の本文。fileが無ければ`undefined`。 */
  amendments: ResumeObservation<string | undefined>;
  verificationRuns: ResumeObservation<readonly VerificationRunRecord[]>;
  reviewSession: ResumeObservation<ReviewSessionState | null>;
  delivery: ResumeObservation<DeliveryState | undefined>;
}

/**
 * 両辺が既知のときだけ真偽を返す。**どちらかが不明なら`null`であり、一致と表示しない。**
 */
export function resumeMatches(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean | null {
  if (left === null || left === undefined) return null;
  if (right === null || right === undefined) return null;
  return left === right;
}

function observed<T>(
  observation: ResumeObservation<T>,
  label: string,
  errors: string[],
): { value: T } | undefined {
  if (observation.ok) return { value: observation.value };
  errors.push(`${label}: ${observation.error}`);
  return undefined;
}

/** 観測結果から再開状態を導出する純関数。reader失敗は`errors`へ入れ該当項目を`null`にする。 */
export function deriveWorkflowResume(
  input: WorkflowResumeObservations,
): WorkflowResume {
  const errors: string[] = [];
  const headSha = observed(input.headSha, "HEAD", errors)?.value ?? null;
  const journal = observed(input.journal, "journal", errors)?.value;
  const amendments = observed(input.amendments, "計画変更", errors);
  const runs = observed(input.verificationRuns, "検証記録", errors)?.value;
  const session =
    observed(input.reviewSession, "review session", errors)?.value ?? null;
  const delivery =
    observed(input.delivery, "delivery state", errors)?.value ?? undefined;

  const seal = journal === undefined ? undefined : latestPlanSeal(journal);
  const planning =
    journal === undefined || amendments === undefined
      ? null
      : {
          sealed: seal !== undefined,
          sealDigest: seal === undefined ? null : planSealDigest(seal.seal),
          amendmentCount: planAmendmentDigests(amendments.value).length,
        };
  const implementationHeadSha =
    journal === undefined
      ? null
      : ([...journal].reverse().find((entry) => entry.step === 9)
          ?.implementationHeadSha ?? null);
  const latestRun = runs?.at(-1);
  return {
    authority: "advisory",
    staging: input.staging,
    headSha,
    baseSha: session?.anchor.diffBaseSha ?? null,
    planning,
    implementation: {
      headSha: implementationHeadSha,
      matchesHead: resumeMatches(implementationHeadSha, headSha),
    },
    verification:
      latestRun === undefined
        ? null
        : {
            headSha: latestRun.headSha,
            scope: latestRun.scope,
            passed: latestRun.exitCode === 0 && latestRun.signal === null,
            recordDigest: latestRun.recordDigest,
            matchesImplementationHead: resumeMatches(
              latestRun.headSha,
              implementationHeadSha,
            ),
          },
    review:
      session === null
        ? null
        : {
            status: isReviewSessionConverged(session) ? "converged" : "active",
            latestRoundDigest: session.latestRoundDigest,
            candidateHeadSha: session.latestCandidateHeadSha,
            rounds: session.rounds.length,
            matchesImplementationHead: resumeMatches(
              session.latestCandidateHeadSha,
              implementationHeadSha,
            ),
          },
    delivery:
      delivery === undefined
        ? null
        : { state: delivery.state, pr: delivery.pr?.number ?? null },
    errors,
  };
}
