import fs from "node:fs";
import path from "node:path";

/**
 * 個人ローカルのJev（Decision Provider）設定の既定配置。
 * `modelMapping.roles.reviewer`（git管理下・project全体共有）や
 * trusted project policy（`project-policy.json`等）とは独立に、エンジニア
 * 個別のgit管理外設定として持つ（TERM-ASC-1484、INV-1484-01〜04）。
 */
export const JEV_PROVIDER_CONFIG_PATH =
  ".agent-skill-chain/local/jev-provider.json";

export interface JevProviderConfig {
  enabled: true;
  apiKeyEnvVar: string;
  endpoint: string;
  model: string;
}

const ALLOWED_FIELDS = new Set([
  "enabled",
  "apiKeyEnvVar",
  "endpoint",
  "model",
]);

const ENV_VAR_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

/**
 * 設定fileが存在しない・読めない・形状が不正・`enabled`が`true`以外・
 * 指定env varが未設定の場合はすべて`undefined`（providerなし）を返す。
 * **例外を投げない**（INV-1484-02、`supplemental-review-config.ts`の
 * `loadSupplementalReviewConfig`と同型）。
 *
 * **APIキーの値そのものは戻り値へ一切含めない。** `process.env[apiKeyEnvVar]`
 * は「設定されているか」の確認にのみ使い、値自体は破棄する（INV-1484-03）。
 *
 * **`modelMapping`・trusted project policyのいずれも読まない。** この関数が
 * それらのpathへ一切触れない構造そのものがINV-1484-04を保証する。
 *
 * `configPath`はunit testがtmpdir fixtureを指すためだけの開発者専用の
 * 注入点であり、path traversal防止機構を持たない。実行時の呼び出し元は
 * 常に既定値のまま呼ぶ設計とし、動的・信頼できない入力をこの引数へ
 * 渡さないことで安全性を担保する（`supplemental-review-config.ts`と同型）。
 */
export function loadJevProviderConfig(
  root: string,
  configPath: string = JEV_PROVIDER_CONFIG_PATH,
): JevProviderConfig | undefined {
  const resolved = path.resolve(root, configPath);
  let raw: string;
  try {
    if (!fs.statSync(resolved).isFile()) return undefined;
    raw = fs.readFileSync(resolved, "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return undefined;
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).some((key) => !ALLOWED_FIELDS.has(key)))
    return undefined;
  if (record.enabled !== true) return undefined;
  const apiKeyEnvVar = record.apiKeyEnvVar;
  if (
    typeof apiKeyEnvVar !== "string" ||
    !ENV_VAR_NAME_PATTERN.test(apiKeyEnvVar)
  )
    return undefined;
  const endpoint = record.endpoint;
  if (typeof endpoint !== "string" || endpoint.trim() === "") return undefined;
  const model = record.model;
  if (typeof model !== "string" || model.trim() === "") return undefined;
  const envValue = process.env[apiKeyEnvVar];
  if (typeof envValue !== "string" || envValue.length === 0) return undefined;
  return { enabled: true, apiKeyEnvVar, endpoint, model };
}
