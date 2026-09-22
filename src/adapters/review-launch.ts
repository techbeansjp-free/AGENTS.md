import fs from "node:fs";
import path from "node:path";
import { loadOperationPolicy } from "../domain/policy.js";
import { resolveReviewRouting } from "../domain/review-routing.js";
import {
  evaluateLocalLlmReview,
  type LocalLlmReviewVerdict,
} from "../domain/review-verdict.js";
import { resolveContained } from "../lib/security.js";
import type { ReviewerExecutor } from "../domain/reviewer-provider.js";
import { REVIEWER_EXECUTORS } from "./reviewer-executors.js";

export interface ReviewLaunchInput {
  root: string;
  scope: string;
  coordinator: string;
  implementer: string;
  reviewer: string;
  implementerContext: string;
  reviewerContext: string;
  promptFile: string;
}

function rejection(reason: string) {
  return {
    state: "rejected" as const,
    dispatched: false,
    reason,
    next: "入力・trusted project policy・reviewer役割の設定を修復して再実行してください。起動済みtaskの自動再送は行いません",
  };
}

/**
 * `codex-launch.ts`の`readPrompt`と同じTOCTOU対策（NFC正規化、制御文字拒否、
 * symlink拒否、fd一致確認、1MiB上限）を独立に実装する。既存implementer向け
 * fileへは依存しない（INV-05）。
 */
function readPrompt(root: string, promptFile: string): string {
  if (
    /[\p{Cc}\p{Cf}]/u.test(promptFile) ||
    promptFile.normalize("NFC") !== promptFile
  )
    throw new Error("prompt-fileに制御文字または非NFC名を使用できません");
  const file = resolveContained(root, promptFile);
  const stat = fs.lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    fs.realpathSync(file) !== file ||
    stat.size > 1024 * 1024
  )
    throw new Error("prompt-fileはroot内の1MiB以下の通常fileが必要です");
  const descriptor = fs.openSync(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    const opened = fs.fstatSync(descriptor);
    if (
      opened.dev !== stat.dev ||
      opened.ino !== stat.ino ||
      opened.size > 1024 * 1024
    )
      throw new Error("prompt-fileが読取直前に変化しました");
    const prompt = fs.readFileSync(descriptor, "utf8");
    if (prompt.trim() === "" || Buffer.byteLength(prompt) > 1024 * 1024)
      throw new Error("prompt-fileは空でない1MiB以下のtask本文が必要です");
    return prompt;
  } finally {
    fs.closeSync(descriptor);
  }
}

/** Each invocation reloads trusted policy before and after dispatch to detect mid-flight changes. */
export async function launchReview(
  input: ReviewLaunchInput,
  dependencies: { execute?: ReviewerExecutor } = {},
) {
  const identifiers = [
    input.scope,
    input.coordinator,
    input.implementer,
    input.reviewer,
    input.implementerContext,
    input.reviewerContext,
  ];
  if (
    identifiers.some(
      (value) =>
        value.trim() === "" ||
        value.length > 512 ||
        /[\p{Cc}\p{Cf}]/u.test(value),
    )
  )
    return rejection(
      "scope、identity、contextは制御文字を含まない非空値が必要です",
    );
  if (
    input.coordinator === input.reviewer ||
    input.implementer === input.reviewer
  )
    return rejection(
      "reviewerはcoordinator・implementerと異なるidentityへ割り当ててください",
    );

  let root: string;
  let prompt: string;
  try {
    root = path.resolve(input.root);
    if (fs.realpathSync(root) !== root || !fs.statSync(root).isDirectory())
      throw new Error("rootはsymlinkを含まない通常directoryが必要です");
    prompt = readPrompt(root, input.promptFile);
  } catch (error) {
    return rejection(
      error instanceof Error
        ? error.message
        : "prompt-fileの読み取りに失敗しました",
    );
  }

  const trusted = loadOperationPolicy(root);
  const choices = trusted.policy.projectChoices?.modelMapping;
  if (!choices || typeof choices === "string")
    return rejection("trusted modelMappingが未設定です");
  const policySha = trusted.provenance.commitSha;
  if (typeof policySha !== "string" || !/^[a-f0-9]{40}$/u.test(policySha))
    return rejection("trusted policyの固定commit SHAを確認できません");

  const decision = resolveReviewRouting({
    scope: input.scope,
    coordinatorIdentity: input.coordinator,
    implementerIdentity: input.implementer,
    reviewerIdentity: input.reviewer,
    implementerContext: input.implementerContext,
    reviewerContext: input.reviewerContext,
    modelMapping: choices,
  });
  if (decision.state !== "resolved") return rejection(decision.reason);

  const executor =
    dependencies.execute ?? REVIEWER_EXECUTORS[decision.provider];
  if (!executor)
    return rejection(`provider ${decision.provider} の実行adapterが未登録です`);

  const executed = await executor({
    endpoint: decision.endpoint,
    model: decision.model,
    prompt,
  });

  /**
   * dispatch後（ローカルLLM応答待ちの最大既定15分間）にtrusted policyが変化した
   * ケースを検出する。dispatch前の2回だけでは、応答待ち中の変更を見逃す
   * （独立レビュー指摘）。前回同様、検出のみでdispatch自体は取り消さない
   * （Git/Codexの既存failed/unknown契約と同じ、実行結果は既に確定している）。
   */
  const rechecked = loadOperationPolicy(root);
  if (rechecked.provenance.commitSha !== policySha)
    return rejection(
      "trusted policyが観測中に変化しました。新しい起動要求で再検証してください",
    );

  /**
   * FR-107（`replace`）はローカルLLM結果でreviewer役割の正式な充足条件を満たす。
   * `evaluateLocalLlmReview`はLLM出力の主観的な評価部分だけを既存
   * `evaluateReviewJudgment`（Claude/Codexレビューと同一のCritical/High
   * blocking判定）へ流し込む。`supplement`はFR-106のとおり既存reviewの充足
   * 条件を変えないため評価しない。
   */
  let verdict: LocalLlmReviewVerdict | undefined;
  if (decision.mode === "replace" && executed.state === "succeeded") {
    verdict = evaluateLocalLlmReview(executed.output ?? "");
  }

  return {
    ...executed,
    dispatched: executed.state === "succeeded",
    scope: input.scope,
    provider: decision.provider,
    model: decision.model,
    mode: decision.mode,
    trustedPolicySha: policySha,
    ...(verdict ? { verdict } : {}),
  };
}
