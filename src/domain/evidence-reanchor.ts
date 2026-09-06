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

/** review artifactの「レビュー識別情報」節が持つ、機械導出される2つの正規セル。 */
export interface ReviewIdentityAnchor {
  readonly base: string;
  readonly implementation: string;
}

const REVIEW_IDENTITY_HEADING = "## 0. レビュー識別情報";
const IDENTITY_BASE_ROW = /^\| 比較基点 \| `([a-f0-9]{40})` \|$/gmu;
const IDENTITY_IMPL_ROW = /^\| H_impl \| `([a-f0-9]{40})` \|$/gmu;
/** 正規化後に入る値。40桁hexと同じ形にしない。 */
export const REVIEW_IDENTITY_PLACEHOLDER = "<正規化済み>";

function uniqueIdentitySection(markdown: string): string | undefined {
  const parts = markdown.split(REVIEW_IDENTITY_HEADING);
  /** **節が0個または2個以上なら同定できない。** 一意でない入力を受理しない。 */
  if (parts.length !== 2) return undefined;
  return parts[1]!.split("\n## ")[0] ?? "";
}

function singleMatch(section: string, pattern: RegExp): string | undefined {
  const found = [...section.matchAll(pattern)];
  /** **重複欄を受理しない。** 2つ目を書き足して片方だけ正しくする迂回を防ぐ。 */
  return found.length === 1 ? found[0]![1] : undefined;
}

/**
 * review artifactから、機械導出される2つの正規セルを構造として取り出す。
 *
 * **全文regexでは足りない。** 節が一意であること、各欄がその節に1つだけ現れることを
 * 要求する。**同定できない入力はundefinedを返し、呼び出し側が拒否する**（Issue #1172）。
 */
export function parseReviewIdentityAnchor(
  markdown: string,
): ReviewIdentityAnchor | undefined {
  const section = uniqueIdentitySection(markdown);
  if (section === undefined) return undefined;
  const base = singleMatch(section, new RegExp(IDENTITY_BASE_ROW));
  const implementation = singleMatch(section, new RegExp(IDENTITY_IMPL_ROW));
  if (base === undefined || implementation === undefined) return undefined;
  return { base, implementation };
}

/**
 * 2つの正規セルの値だけをplaceholderへ置き換える。
 *
 * **緩めるのはSHA一般ではない。** 別commitのcitation、検証Evidence、例示中のOIDは
 * そのまま比較対象に残す。**`audit:check`が検証しないSHA改変を洗浄しない**ため、
 * 独立導出でき独立検証できる2欄だけを対象にする（Issue #1172）。
 */
export function normalizeReviewIdentityAnchor(
  markdown: string,
): string | undefined {
  const section = uniqueIdentitySection(markdown);
  if (section === undefined) return undefined;
  if (parseReviewIdentityAnchor(markdown) === undefined) return undefined;
  const normalizedSection = section
    .replace(
      new RegExp(IDENTITY_BASE_ROW),
      `| 比較基点 | \`${REVIEW_IDENTITY_PLACEHOLDER}\` |`,
    )
    .replace(
      new RegExp(IDENTITY_IMPL_ROW),
      `| H_impl | \`${REVIEW_IDENTITY_PLACEHOLDER}\` |`,
    );
  return markdown.replace(section, normalizedSection);
}

/**
 * rebase後の再固定で成立させる二層の等価性。
 *
 * **現行の完全diff digestは`base..H_final`全体を見るため、artifactのSHA行を1行
 * 変えるだけで必ず不一致になる。** ASCの規定するrebase手順は`audit:check`のために
 * SHA行の更新を要求するので、**両者の要求が同時に満たせない**（Issue #1172）。
 *
 * 層を分ける。
 *
 * 1. `base..H_impl`の完全diff digestは**一致を要求する**。強さを落とさない
 * 2. terminal review artifactは、上記2欄だけを正規化して**byte一致を要求する**
 * 3. 変更path集合とartifact pathは**完全一致を要求する**
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
  const before = normalizeReviewIdentityAnchor(input.beforeArtifact);
  const after = normalizeReviewIdentityAnchor(input.afterArtifact);
  if (before === undefined || after === undefined)
    return "identity-unresolvable";
  return before === after ? "ok" : "artifact-body-changed";
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
