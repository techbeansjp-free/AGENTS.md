/**
 * reviewer役割のdispatch可能providerを列挙する。**provider名の文字列比較を
 * `resolveReviewRouting`・`launchReview`へ直接埋め込まない。** 新しいprovider
 * （別のローカル実行runtime、または将来の外部SaaS reviewer）を追加するときは、
 * この集合と`src/adapters/reviewer-executors.ts`のREVIEWER_EXECUTORSへ登録するだけで
 * 済むようにする。`implementer`向け`resolveRouting`/`launchCodex`（codex/claude固定）は
 * 本抽象化の対象外（Issue #1425の範囲外、INV-05）。
 */
export const DISPATCHABLE_REVIEWER_PROVIDERS: ReadonlySet<string> = new Set([
  "ollama",
]);

export interface ReviewerExecutionResult {
  state: "succeeded" | "failed" | "unknown";
  reason: string;
  /** LLMの実応答本文。`succeeded`時だけ設定する。結果証跡へ生転記しない呼出し元の責務は変わらない */
  output?: string;
}

export type ReviewerExecutor = (input: {
  endpoint: string;
  model: string;
  prompt: string;
}) => Promise<ReviewerExecutionResult>;
