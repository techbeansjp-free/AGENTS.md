import fs from "node:fs";
import path from "node:path";
import type { LocalConfigClassification } from "./local-config-resolution.js";

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
  const classified = classifyJevProviderConfig(root, configPath);
  return classified.state === "enabled" ? classified.config : undefined;
}

/**
 * `loadJevProviderConfig`と同じ単一rootの読み取りを行うが、`undefined`へ
 * 潰す前の理由（absent/disabled/invalid/enabled）を区別して返す
 * （Issue #1485、L-04）。**git・worktreeには一切触れない。**
 * active→primary worktreeのfallback判定は`src/adapters/local-config-workspace.ts`
 * の`resolveLocalConfigWithWorkspaceFallback`が、この関数をactive/primary両方の
 * rootへ適用することで行う。
 *
 * `loadJevProviderConfig`はこの関数の`state === "enabled"`だけを`config`として
 * 返す薄いwrapperであり、既存8scenario（SCN-UNIT-JEVCFG-001〜008）の
 * 外部から見た挙動は変えない。
 */
export function classifyJevProviderConfig(
  root: string,
  configPath: string = JEV_PROVIDER_CONFIG_PATH,
): LocalConfigClassification<JevProviderConfig> {
  const resolved = path.resolve(root, configPath);
  let raw: string;
  try {
    if (!fs.statSync(resolved).isFile()) return { state: "absent" };
    raw = fs.readFileSync(resolved, "utf8");
  } catch (error) {
    /**
     * **`ENOENT`／`ENOTDIR`だけを`absent`にする（PR #1497独立review round 4
     * 指摘）。** 二重の`fs`呼び出し（`statSync`→`readFileSync`）を1つの
     * `catch`でまとめて`absent`へ潰していたため、`EACCES`（権限拒否）等の
     * 「fileはあるが読めない」も"absent"として扱われ、`resolveLocalConfig
     * WithWorkspaceFallback`（local-config-workspace.ts）がactive worktreeの
     * 本当のerrorを隠してprimary worktreeへ誤ってfallbackしていた。fallback
     * はabsent（未設定）時だけの意図であり、読めないfileはinvalidとして
     * 呼び出し元へ伝える。
     */
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") return { state: "absent" };
    return { state: "invalid", reason: "設定fileを読み取れません" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: "invalid", reason: "JSON構文が不正です" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return { state: "invalid", reason: "topレベルはobjectが必要です" };
  const record = parsed as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter(
    (key) => !ALLOWED_FIELDS.has(key),
  );
  if (unknownKeys.length > 0)
    return {
      state: "invalid",
      reason: `未知keyを含みます: ${unknownKeys.join(", ")}`,
    };
  if (record.enabled === false || !("enabled" in record))
    return { state: "disabled" };
  if (record.enabled !== true)
    return { state: "invalid", reason: "enabledはtrueまたはfalseが必要です" };
  const apiKeyEnvVar = record.apiKeyEnvVar;
  if (
    typeof apiKeyEnvVar !== "string" ||
    !ENV_VAR_NAME_PATTERN.test(apiKeyEnvVar)
  )
    return { state: "invalid", reason: "apiKeyEnvVarが不正です" };
  const endpoint = record.endpoint;
  if (typeof endpoint !== "string" || endpoint.trim() === "")
    return { state: "invalid", reason: "endpointが不正です" };
  const model = record.model;
  if (typeof model !== "string" || model.trim() === "")
    return { state: "invalid", reason: "modelが不正です" };
  const envValue = process.env[apiKeyEnvVar];
  if (typeof envValue !== "string" || envValue.length === 0)
    return {
      state: "invalid",
      reason: `enabledだが指定env var ${apiKeyEnvVar} が未設定です`,
    };
  return {
    state: "enabled",
    config: { enabled: true, apiKeyEnvVar, endpoint, model },
  };
}
