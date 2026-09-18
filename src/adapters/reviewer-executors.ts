import type { ReviewerExecutor } from "../domain/reviewer-provider.js";
import { executeLocalLlm } from "./local-llm-execution.js";

/**
 * `resolveReviewRouting`が返す`provider`から、実際にdispatchするexecutorを引く
 * 表。`launchReview`はprovider名で分岐しない。新しいprovider（別のローカル実行
 * runtime、または将来の外部SaaS reviewer）を追加するときは、この表と
 * `DISPATCHABLE_REVIEWER_PROVIDERS`（reviewer-provider.ts）へ登録するだけで済む。
 */
export const REVIEWER_EXECUTORS: Readonly<Record<string, ReviewerExecutor>> = {
  ollama: executeLocalLlm,
};
