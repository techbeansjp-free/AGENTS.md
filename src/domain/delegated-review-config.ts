import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertLoopbackEndpoint } from "../lib/local-llm-endpoint.js";
import { PROVIDER_AUTONOMOUS_CEILINGS } from "./role.js";
import { DISPATCHABLE_REVIEWER_PROVIDERS } from "./reviewer-provider.js";

export interface DelegatedReviewConfig {
  provider: string;
  model: string;
  endpoint: string;
  timeoutMs: number;
  source: "local" | "primary" | "global";
}

export type DelegatedReviewConfigResult =
  | { state: "disabled" }
  | { state: "invalid"; reason: string }
  | { state: "configured"; config: DelegatedReviewConfig };

const LOCAL_PATH = ".agent-skill-chain/local/supplemental-review.json";
const ALLOWED_KEYS = new Set([
  "enabled",
  "provider",
  "model",
  "endpoint",
  "timeoutMs",
]);

/** Worktree selection wins, then the primary worktree, then the user setting. */
export function resolveDelegatedReviewConfig(
  root: string,
  options: { globalConfigHome?: string; primaryRoot?: string } = {},
): DelegatedReviewConfigResult {
  const globalHome =
    options.globalConfigHome ??
    process.env.XDG_CONFIG_HOME ??
    path.join(os.homedir(), ".config");
  const candidates = [
    { source: "local" as const, file: path.join(root, LOCAL_PATH) },
    ...(options.primaryRoot && options.primaryRoot !== root
      ? [
          {
            source: "primary" as const,
            file: path.join(options.primaryRoot, LOCAL_PATH),
          },
        ]
      : []),
    {
      source: "global" as const,
      file: path.join(globalHome, "agent-skill-chain/supplemental-review.json"),
    },
  ];
  for (const candidate of candidates) {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(candidate.file);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
        continue;
      return {
        state: "invalid",
        reason: `${candidate.source}設定を読めません`,
      };
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536)
      return {
        state: "invalid",
        reason: `${candidate.source}設定は64KiB以下の通常fileが必要です`,
      };
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(candidate.file, "utf8"));
    } catch {
      return {
        state: "invalid",
        reason: `${candidate.source}設定のJSONが不正です`,
      };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return {
        state: "invalid",
        reason: `${candidate.source}設定がobjectではありません`,
      };
    const value = parsed as Record<string, unknown>;
    if (Object.keys(value).some((key) => !ALLOWED_KEYS.has(key)))
      return {
        state: "invalid",
        reason: `${candidate.source}設定に未知fieldがあります`,
      };
    if (value.enabled === false) return { state: "disabled" };
    if (value.enabled !== true)
      return {
        state: "invalid",
        reason: `${candidate.source}設定のenabledが不正です`,
      };
    const provider = value.provider;
    const model = value.model;
    const endpoint = value.endpoint;
    const timeoutMs = value.timeoutMs ?? 300000;
    if (
      typeof provider !== "string" ||
      !DISPATCHABLE_REVIEWER_PROVIDERS.has(provider)
    )
      return {
        state: "invalid",
        reason: `${candidate.source}設定のproviderが不正です`,
      };
    if (
      typeof model !== "string" ||
      !PROVIDER_AUTONOMOUS_CEILINGS[provider]?.allowed.includes(model)
    )
      return {
        state: "invalid",
        reason: `${candidate.source}設定のmodelが承認済み選択値ではありません`,
      };
    if (typeof endpoint !== "string")
      return {
        state: "invalid",
        reason: `${candidate.source}設定のendpointが不正です`,
      };
    try {
      assertLoopbackEndpoint(endpoint);
    } catch {
      return {
        state: "invalid",
        reason: `${candidate.source}設定のendpointはloopback HTTPが必要です`,
      };
    }
    if (
      typeof timeoutMs !== "number" ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      timeoutMs > 30 * 60 * 1000
    )
      return {
        state: "invalid",
        reason: `${candidate.source}設定のtimeoutMsが不正です`,
      };
    return {
      state: "configured",
      config: {
        provider,
        model,
        endpoint,
        timeoutMs,
        source: candidate.source,
      },
    };
  }
  return { state: "disabled" };
}
