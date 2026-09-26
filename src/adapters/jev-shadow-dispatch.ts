/**
 * `decision invoke --apply`実行後にbest-effortで呼ぶcontinuous shadowの
 * 本体（Issue #1486、T-02）。
 *
 * **例外を外へ投げない。** 失敗しても呼び出し元（`invokeDecision`が既に
 * 確定したeffectiveValue/authorityMode）へ一切影響を与えない。Jevが未設定
 * （`resolveJevProviderConfig`が`enabled`以外）の場合は静かにno-opする
 * （Jevを使わない開発者には何も起きない）。
 */
import { resolveJevProviderConfig } from "./local-config-workspace.js";
import { dispatchJevChoice } from "./jev-http-client.js";
import {
  buildJevShadowRecord,
  isJevShadowEligible,
  planJevShadowQuestion,
  type JevShadowRecord,
} from "../domain/jev-shadow.js";
import {
  appendJevShadowRecord,
  findJevShadowRecord,
} from "./jev-shadow-store.js";
import type { DecisionInvokeResult } from "./decision-invoke.js";

export interface RunJevShadowInput {
  readonly activeRoot: string;
  readonly primaryRoot: string;
  readonly staging: string;
  readonly result: DecisionInvokeResult;
  readonly now?: () => Date;
}

export type JevShadowRunOutcome =
  | { readonly ran: false; readonly reason: string }
  | { readonly ran: true; readonly record: JevShadowRecord };

export async function runJevContinuousShadow(
  input: RunJevShadowInput,
): Promise<JevShadowRunOutcome> {
  if (!isJevShadowEligible(input.result.executor))
    return {
      ran: false,
      reason:
        "対象decision typeではありません（executor.kindがproviderではない）",
    };
  const resolution = resolveJevProviderConfig(input.activeRoot);
  if (resolution.state !== "enabled")
    return { ran: false, reason: `Jev未設定（state=${resolution.state}）` };
  const plan = planJevShadowQuestion({
    decisionTypeId: input.result.decisionTypeId,
    subjectRef: input.result.subjectRef,
    candidateSet: input.result.candidateSet,
  });
  if (plan === undefined)
    return {
      ran: false,
      reason:
        "この decision type / 候補集合では shadow question を構成できません",
    };
  if (input.result.decisionRecordId === null)
    return {
      ran: false,
      reason: "--applyされていないためshadowを記録しません",
    };
  let existing: JevShadowRecord | undefined;
  try {
    existing = findJevShadowRecord(
      input.primaryRoot,
      input.staging,
      input.result.decisionRecordId,
    );
  } catch (error) {
    return {
      ran: false,
      reason: `既存jev-shadow journalの読み取りに失敗: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (existing !== undefined)
    return { ran: false, reason: "既にshadow記録済みです" };

  const now = (input.now ?? (() => new Date()))();
  try {
    const dispatch = await dispatchJevChoice({
      config: resolution.config,
      question: plan.question,
      state: plan.state,
    });
    const record = buildJevShadowRecord({
      decisionRecordId: input.result.decisionRecordId,
      decisionTypeId: input.result.decisionTypeId,
      candidateHeadSha: input.result.candidateHeadSha,
      primaryProposedValue: input.result.proposedValue,
      primaryAuthorityMode: input.result.authorityMode,
      jevModel: resolution.config.model,
      outcome: dispatch.outcome,
      latencyMs: dispatch.latencyMs,
      dispatchedAt: now.toISOString(),
    });
    appendJevShadowRecord(input.primaryRoot, input.staging, record);
    return { ran: true, record };
  } catch (error) {
    return {
      ran: false,
      reason: `shadow dispatch中に想定外の例外: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
