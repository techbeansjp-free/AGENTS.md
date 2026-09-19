import fs from "node:fs";
import path from "node:path";
import { DISPATCHABLE_REVIEWER_PROVIDERS } from "./reviewer-provider.js";
import type { ReviewProfile } from "./review-presentation.js";

/**
 * 補助レビューの既定配置。`modelMapping.roles.reviewer`（Issue #1425、
 * git管理下・project全体共有）とは独立に、エンジニア個別のgit管理外設定
 * として持つ（TERM-ASC-124、INV-1428-03、INV-1428-04）。
 */
export const SUPPLEMENTAL_REVIEW_CONFIG_PATH =
  ".agent-skill-chain/local/supplemental-review.json";

export interface SupplementalReviewConfig {
  enabled: true;
  provider: string;
  model: string;
  endpoint: string;
  timeoutMs: number;
  profile: ReviewProfile;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const ALLOWED_FIELDS = new Set([
  "enabled",
  "provider",
  "model",
  "endpoint",
  "timeoutMs",
  "profile",
]);

/**
 * 設定fileが存在しない・読めない・形状が不正・`enabled`が`true`以外・
 * providerが未知の場合はすべて`undefined`（disabled）を返す。**例外を
 * 投げない。** 呼出し元（`supplemental-review-launch.ts`）はこの関数の
 * 戻り値だけでStep 03/07/10の既存実施を妨げないかどうかを決める（INV-1428-03）。
 *
 * `modelMapping`・trusted project policyのいずれも読まない。この関数が
 * `roles.reviewer`へ触れない構造そのものがINV-1428-04を保証する。
 */
export function loadSupplementalReviewConfig(
  root: string,
  configPath: string = SUPPLEMENTAL_REVIEW_CONFIG_PATH,
): SupplementalReviewConfig | undefined {
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
  const provider = record.provider;
  if (
    typeof provider !== "string" ||
    !DISPATCHABLE_REVIEWER_PROVIDERS.has(provider)
  )
    return undefined;
  const model = record.model;
  if (typeof model !== "string" || model.trim() === "") return undefined;
  const endpoint = record.endpoint;
  if (typeof endpoint !== "string" || endpoint.trim() === "") return undefined;
  const timeoutMsRaw = record.timeoutMs;
  if (
    timeoutMsRaw !== undefined &&
    !(
      typeof timeoutMsRaw === "number" &&
      Number.isInteger(timeoutMsRaw) &&
      timeoutMsRaw > 0
    )
  )
    return undefined;
  const timeoutMs = timeoutMsRaw ?? DEFAULT_TIMEOUT_MS;
  if (
    record.profile !== undefined &&
    record.profile !== "chill" &&
    record.profile !== "assertive"
  )
    return undefined;
  return {
    enabled: true,
    provider,
    model,
    endpoint,
    timeoutMs,
    profile: (record.profile ?? "assertive") as ReviewProfile,
  };
}
