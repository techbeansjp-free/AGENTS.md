import { stableJson } from "../lib/security.js";
import { isRecord } from "../types.js";
import {
  comparableReviewEvidence,
  tryParseReviewEvidence,
} from "./review-evidence.js";

const OID = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

/**
 * 再固定で許す移動の種別。
 *
 * **閉じた列挙にする。** artifact-supersessionは同一実装・同一pathの
 * 限定した書式是正だけを表し、判断本文の変更を受理しない。
 */
const METHODS = [
  "rebase",
  "artifact-replacement",
  "artifact-supersession",
  "reviewed-forward",
] as const;

export type EvidenceReanchorMethod = (typeof METHODS)[number];

export interface EvidenceReanchorRecord {
  oldHeadSha: string;
  newHeadSha: string;
  oldBaseSha: string;
  newBaseSha: string;
  diffDigest: string;
  method: EvidenceReanchorMethod;
  reason: string;
  recordedAt: string;
  artifactReplacement?: {
    oldPath: string;
    newPath: string;
    oldDigest: string;
    newDigest: string;
  };
  artifactSupersession?: {
    artifactPath: string;
    oldDigest: string;
    newDigest: string;
  };
  reviewedForward?: {
    sessionId: string;
    roundDigest: string;
    implementationSha: string;
    artifactPath: string;
    artifactDigest: string;
  };
}

export interface DiffObservation {
  digest: string;
  changedPaths: readonly string[];
}

export type ReachabilityState = "reachable" | "rewritten" | "unverifiable";

export function isEvidenceReanchorRecord(
  value: unknown,
): value is EvidenceReanchorRecord {
  const replacement = isRecord(value) ? value.artifactReplacement : undefined;
  const validReplacement =
    isRecord(replacement) &&
    typeof replacement.oldPath === "string" &&
    replacement.oldPath.length > 0 &&
    typeof replacement.newPath === "string" &&
    replacement.newPath.length > 0 &&
    replacement.oldPath !== replacement.newPath &&
    typeof replacement.oldDigest === "string" &&
    SHA256.test(replacement.oldDigest) &&
    typeof replacement.newDigest === "string" &&
    SHA256.test(replacement.newDigest);
  const reviewedForward = isRecord(value) ? value.reviewedForward : undefined;
  const supersession = isRecord(value) ? value.artifactSupersession : undefined;
  const validSupersession =
    isRecord(supersession) &&
    typeof supersession.artifactPath === "string" &&
    supersession.artifactPath.length > 0 &&
    typeof supersession.oldDigest === "string" &&
    SHA256.test(supersession.oldDigest) &&
    typeof supersession.newDigest === "string" &&
    SHA256.test(supersession.newDigest) &&
    supersession.oldDigest !== supersession.newDigest;
  const validReviewedForward =
    isRecord(reviewedForward) &&
    typeof reviewedForward.sessionId === "string" &&
    SHA256.test(reviewedForward.sessionId) &&
    typeof reviewedForward.roundDigest === "string" &&
    SHA256.test(reviewedForward.roundDigest) &&
    typeof reviewedForward.implementationSha === "string" &&
    OID.test(reviewedForward.implementationSha) &&
    typeof reviewedForward.artifactPath === "string" &&
    reviewedForward.artifactPath.length > 0 &&
    typeof reviewedForward.artifactDigest === "string" &&
    SHA256.test(reviewedForward.artifactDigest);
  return (
    isRecord(value) &&
    typeof value.oldHeadSha === "string" &&
    OID.test(value.oldHeadSha) &&
    typeof value.newHeadSha === "string" &&
    OID.test(value.newHeadSha) &&
    typeof value.oldBaseSha === "string" &&
    OID.test(value.oldBaseSha) &&
    typeof value.newBaseSha === "string" &&
    OID.test(value.newBaseSha) &&
    typeof value.diffDigest === "string" &&
    SHA256.test(value.diffDigest) &&
    typeof value.method === "string" &&
    METHODS.some((method) => method === value.method) &&
    typeof value.reason === "string" &&
    value.reason.trim().length > 0 &&
    typeof value.recordedAt === "string" &&
    value.recordedAt.trim().length > 0 &&
    (replacement === undefined ||
      (value.method === "artifact-replacement" && validReplacement)) &&
    (value.method !== "artifact-replacement" || replacement !== undefined) &&
    (supersession === undefined ||
      (value.method === "artifact-supersession" && validSupersession)) &&
    (value.method !== "artifact-supersession" || supersession !== undefined) &&
    (reviewedForward === undefined ||
      (value.method === "reviewed-forward" && validReviewedForward)) &&
    (value.method !== "reviewed-forward" || reviewedForward !== undefined)
  );
}

/**
 * 2つの差分観測が内容として等価かを決める。
 *
 * **再固定記録を引数に取らない。** 記録は主張であり、等価性の根拠にしてはならない。
 * 正当性は消費のたびにGit objectから再計算する。
 *
 * 判定は`observeReviewDiff`が返す完全diffのdigest一致を主条件とする。`digest`は
 * `--binary --full-index --no-renames`のdiff本文のsha256であり、**path名もfile mode行も
 * 本文へ埋め込まれている**。`changedPaths`の比較は防御的冗長として残す。
 */
export function isContentEquivalent(
  before: DiffObservation,
  after: DiffObservation,
): boolean {
  return (
    before.digest === after.digest &&
    stableJson([...before.changedPaths].sort()) ===
      stableJson([...after.changedPaths].sort())
  );
}

/**
 * rebase後の再固定で成立させる二層の等価性。
 *
 * **現行の完全diff digestは`base..H_final`全体を見るため、review証跡の比較基点と
 * `H_impl`が変わるだけで必ず不一致になる。** rebaseは証跡の再生成を要求するので、
 * 層を分ける（Issue #1172）。
 *
 * 1. `base..H_impl`の完全diff digestは**一致を要求する**。強さを落とさない
 * 2. review証跡は比較基点・`H_impl`・`evidenceDigest`以外の全fieldの**一致を要求する**
 * 3. 変更path集合と証跡pathは**完全一致を要求する**
 */
export type RebaseEquivalenceReason =
  | "ok"
  | "artifact-path-changed"
  | "implementation-diff-changed"
  | "identity-unresolvable"
  | "artifact-body-changed";

export function isRebaseEquivalent(input: {
  readonly beforeImplementation: DiffObservation;
  readonly afterImplementation: DiffObservation;
  readonly beforeArtifact: string;
  readonly afterArtifact: string;
  readonly beforeArtifactPath: string;
  readonly afterArtifactPath: string;
}): RebaseEquivalenceReason {
  if (input.beforeArtifactPath !== input.afterArtifactPath)
    return "artifact-path-changed";
  if (
    !isContentEquivalent(input.beforeImplementation, input.afterImplementation)
  )
    return "implementation-diff-changed";
  const before = tryParseReviewEvidence(input.beforeArtifact);
  const after = tryParseReviewEvidence(input.afterArtifact);
  if (!("evidence" in before) || !("evidence" in after))
    return "identity-unresolvable";
  return comparableReviewEvidence(before.evidence, "rebase") ===
    comparableReviewEvidence(after.evidence, "rebase")
    ? "ok"
    : "artifact-body-changed";
}

export interface EffectiveHead {
  effectiveHeadSha: string;
  validCount: number;
  invalidIndex: number | undefined;
  /**
   * 最後に成立した再固定の記録時刻。再固定が1件も無ければ`undefined`。
   *
   * **実効HEADが動いたなら、そのHEADに対する事象時刻も動く**（Issue #969）。
   * 元の固定時刻のまま経過を測ると、新しいHEADのCI runが未生成の場合に
   * 古い時刻からの経過で`undelivered`と誤分類する。
   */
  effectiveRecordedAt: string | undefined;
}

/**
 * append-only chainから実効HEADを導出する。
 *
 * 先頭の`oldHeadSha`は固定済み記録headと一致し、以降は前entryの`newHeadSha`と
 * 一致しなければならない。**連鎖条件を満たさない位置以降は導出に使わない。**
 * chainが空なら固定済み記録headをそのまま返すため、**再固定記録を持たない既存stateの
 * 判定は変更前と完全に同一になる。**
 */
export function deriveEffectiveHead(input: {
  records: readonly unknown[];
  anchoredHeadSha: string;
}): EffectiveHead {
  let effective = input.anchoredHeadSha;
  let validCount = 0;
  let recordedAt: string | undefined;
  for (const [index, candidate] of input.records.entries()) {
    if (!isEvidenceReanchorRecord(candidate))
      return {
        effectiveHeadSha: effective,
        validCount,
        invalidIndex: index,
        effectiveRecordedAt: recordedAt,
      };
    if (
      candidate.oldHeadSha !== effective ||
      candidate.oldHeadSha === candidate.newHeadSha
    )
      return {
        effectiveHeadSha: effective,
        validCount,
        invalidIndex: index,
        effectiveRecordedAt: recordedAt,
      };
    effective = candidate.newHeadSha;
    recordedAt = candidate.recordedAt;
    validCount += 1;
  }
  return {
    effectiveHeadSha: effective,
    validCount,
    invalidIndex: undefined,
    effectiveRecordedAt: recordedAt,
  };
}

/**
 * 実効HEADが対象PRの現在のheadから到達できるかを三値で返す。
 *
 * **providerを観測できない場合に`reachable`と断定しない。** 古いlocal refから
 * 正常と判断すると、書き換え済みの状態を見逃す。
 */
export function observeReachability(input: {
  effectiveHeadSha: string;
  providerHeadSha?: string;
  isAncestor?: (descendant: string) => boolean;
}): { state: ReachabilityState; comparedWith: string | undefined } {
  if (
    input.providerHeadSha === undefined ||
    !OID.test(input.providerHeadSha) ||
    input.isAncestor === undefined
  )
    return { state: "unverifiable", comparedWith: input.providerHeadSha };
  const reachable = input.isAncestor(input.providerHeadSha);
  return {
    state: reachable ? "reachable" : "rewritten",
    comparedWith: input.providerHeadSha,
  };
}
