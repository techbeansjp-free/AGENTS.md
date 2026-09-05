import { stableJson } from "../lib/security.js";
import { isRecord } from "../types.js";

const OID = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

/**
 * 再固定で許す移動の種別。
 *
 * **閉じた列挙にする。** 内容が変わる supersession を再固定で表現できるようにすると、
 * 未reviewの内容をreview済みとして参照させる洗浄経路になる。
 */
const METHODS = ["rebase"] as const;

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
}

export interface DiffObservation {
  digest: string;
  changedPaths: readonly string[];
}

export type ReachabilityState = "reachable" | "rewritten" | "unverifiable";

export function isEvidenceReanchorRecord(
  value: unknown,
): value is EvidenceReanchorRecord {
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
    value.recordedAt.trim().length > 0
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
