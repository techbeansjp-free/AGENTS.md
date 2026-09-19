/**
 * reviewer役割のdispatch可能providerを列挙する。**provider名の文字列比較を
 * `resolveReviewRouting`・`launchReview`へ直接埋め込まない。** 新しいprovider
 * （別のローカル実行runtime、または将来の外部SaaS reviewer）を追加するときは、
 * この集合と`src/adapters/reviewer-executors.ts`のREVIEWER_EXECUTORSへ登録するだけで
 * 済むようにする。`implementer`向け`resolveRouting`/`launchCodex`（codex/claude固定）は
 * 本抽象化の対象外（Issue #1425の範囲外、INV-05）。
 */
export const DISPATCHABLE_REVIEWER_PROVIDERS = new Set([
    "ollama",
]);
//# sourceMappingURL=reviewer-provider.js.map