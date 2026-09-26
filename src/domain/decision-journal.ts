/**
 * Decision Journal（Issue #1485、v0.4.2 Bounded Decision Skill core）。
 *
 * 設計正本「最終確定仕様」§2が定める`DecisionJournalField`の最終形を
 * `DecisionJournalRecord`として実装する。`src/domain/decision-contract.ts`の
 * `DecisionJournalField`（Issue #1483、C-04でdesign-onlyのまま残した placeholder）
 * は削除・変更せず残す。本Issueが実装するのはこの新しい型であり、既存の
 * placeholderを「置き換える」のではなく、その先で予告されていた実装
 * （コメント: 「実装・schema変更は本Issueのscopeに含まない（v0.4.2以降）」＝
 * v0.4.2である本Issueで実装する）をここへ追加する。
 *
 * **この module はpure domain。** journalのfile I/Oは
 * `src/adapters/decision-journal-store.ts`が持つ。
 */
import crypto from "node:crypto";
import { stableJson } from "../lib/security.js";
import type {
  DecisionAuthorityMode,
  DecisionExecutor,
} from "./decision-types.js";

export interface DecisionJournalRecord {
  readonly decisionRecordId: string;
  readonly decisionTypeId: string;
  readonly inputDigest: string;
  readonly subjectRef: string;
  readonly candidateHeadSha: string;
  readonly executor: DecisionExecutor;
  readonly providerModel: string | null;
  readonly providerVersion: string | null;
  readonly proposedValue: string;
  readonly effectiveValue: string | null;
  readonly authorityMode: DecisionAuthorityMode;
  readonly adjudicationReason: string;
  readonly latencyMs: number;
  readonly cost: number;
  readonly decidedAt: string;
}

const HEAD_SHA_PATTERN = /^[a-f0-9]{40}$/u;

/** 入力のstable digest。decisionRefのinputDigest一致検査に使う。 */
export function computeDecisionInputDigest(value: unknown): string {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

/**
 * DCAND-006（finding分類記入）のinputDigestを計算する共通式。
 * `src/adapters/decision-invoke.ts`（記録時）と`src/adapters/review-session.ts`
 * （Step 10 review round consumer側検証、L-03）の両方がこの関数を呼び、
 * finding自身が持つ`id`（=`subjectRef`として使う）・`path`・`evidence`だけから
 * 独立に同じdigestを再計算できることを保証する。raw入力全体を保存せず、
 * review round側が既に持っている情報だけから照合できるようにするための
 * 意図的な絞り込み。
 */
export function computeFindingClassificationInputDigest(input: {
  readonly subjectRef: string;
  readonly path: string;
  readonly evidence: string;
}): string {
  return computeDecisionInputDigest({
    subjectRef: input.subjectRef,
    path: input.path,
    evidence: input.evidence,
  });
}

/** 内容決定的なdecisionRecordId。同一内容の再実行でも安定して再現できる。 */
export function computeDecisionRecordId(input: {
  decisionTypeId: string;
  candidateHeadSha: string;
  inputDigest: string;
  decidedAt: string;
}): string {
  const digest = crypto
    .createHash("sha256")
    .update(stableJson(input))
    .digest("hex");
  return `DR-${digest.slice(0, 16)}`;
}

export interface DecisionRefExpectation {
  readonly decisionTypeId: string;
  readonly candidateHeadSha: string;
  readonly inputDigest: string;
  /**
   * 現在の設定から再計算した「今もこのdecisionを信頼してよいprovider version」。
   * `record.providerVersion`と一致しない場合はexpiredとして拒否する
   * （providerのmodel・endpoint設定が変わった後に古い判断を信頼させない）。
   * `null`はexecutorがdeterministicで比較不要であることを表す。
   */
  readonly currentProviderVersion: string | null;
}

export type DecisionRefVerification =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * consumer側（Step 10 review round等）が`decisionRef`を検証するpure判定
 * （Issue #1485、L-03）。**record自体（journalから読み出した内容）は
 * 呼び出し元が別途I/Oで取得し、ここへ渡す。**
 */
export function verifyDecisionRefBinding(
  record: DecisionJournalRecord,
  expected: DecisionRefExpectation,
): DecisionRefVerification {
  if (record.decisionTypeId !== expected.decisionTypeId)
    return {
      ok: false,
      reason: `decisionRefのtypeが不一致です（record=${record.decisionTypeId}, expected=${expected.decisionTypeId}）`,
    };
  if (!HEAD_SHA_PATTERN.test(expected.candidateHeadSha))
    return { ok: false, reason: "candidateHeadShaの形式が不正です" };
  if (record.candidateHeadSha !== expected.candidateHeadSha)
    return {
      ok: false,
      reason: "decisionRefのcandidateHeadShaがround.candidateHeadShaと不一致です",
    };
  if (record.inputDigest !== expected.inputDigest)
    return {
      ok: false,
      reason: "decisionRefのinputDigestが再計算値と不一致です",
    };
  if (
    expected.currentProviderVersion !== null &&
    record.providerVersion !== expected.currentProviderVersion
  )
    return {
      ok: false,
      reason: `decisionRefのprovider versionが期限切れです（record=${record.providerVersion ?? "null"}, current=${expected.currentProviderVersion}）`,
    };
  if (record.effectiveValue === null)
    return {
      ok: false,
      reason: "decisionRefはeffectiveValueが未確定（advisory未確認）です",
    };
  return { ok: true };
}
