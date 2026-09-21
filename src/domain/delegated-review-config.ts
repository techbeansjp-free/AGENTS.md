import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertLoopbackEndpoint } from "../lib/local-llm-endpoint.js";
import { isValidLocalLlmModel } from "../lib/local-llm-model.js";
import type { ReviewProfile } from "./review-presentation.js";

export interface DelegatedReviewConfig {
  provider: string;
  model: string;
  endpoint: string;
  timeoutMs: number;
  source: "local" | "primary" | "global";
  profile: ReviewProfile;
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
  "profile",
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
      value.profile !== undefined &&
      value.profile !== "chill" &&
      value.profile !== "assertive"
    )
      return {
        state: "invalid",
        reason: `${candidate.source}設定のprofileが不正です`,
      };
    // This personal configuration is Ollama-only, even if the formal reviewer
    // provider registry later gains another local runtime or a SaaS provider.
    if (provider !== "ollama")
      return {
        state: "invalid",
        reason: `${candidate.source}設定のproviderが不正です`,
      };
    // The executor applies the same minimal transport hygiene before dispatch.
    // Advisory review model choice does not grant autonomous reviewer authority.
    if (!isValidLocalLlmModel(model))
      return {
        state: "invalid",
        reason: `${candidate.source}設定のmodel名が不正です`,
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
        profile: (value.profile ?? "assertive") as ReviewProfile,
      },
    };
  }
  return { state: "disabled" };
}
