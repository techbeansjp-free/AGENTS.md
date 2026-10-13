import fs from "node:fs";
import path from "node:path";
import { isExecutionEntry } from "../src/lib/entrypoint.js";

type Format = "codex-host" | "codex-exec" | "codex-rollout";
type Coverage = "complete" | "partial" | "missing";
type Counter = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
};
type Agent = {
  id: string;
  format: Format;
  files: string[];
  startedAt: string | null;
  endedAt: string | null;
  rootTurnId?: string;
};
type Phase = { name: string; at: string };
type Manifest = {
  agents: Agent[];
  phases: Phase[];
};
type Observation = {
  id: string;
  at: number | null;
  usage: Counter;
};
type ObservationSet = {
  calls: Observation[];
  coverage: Coverage;
  taskStart: number | null;
  taskEnd: number | null;
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function time(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
    throw new Error(`ISO UTC時刻が不正です: ${value}`);
  return parsed;
}
function counter(value: unknown): Counter {
  const raw = object(value);
  if (raw === null) throw new Error("usageが欠測です");
  const keys = {
    input: "input_tokens",
    cacheRead: "cached_input_tokens",
    cacheWrite: "cache_write_input_tokens",
    output: "output_tokens",
    reasoning: "reasoning_output_tokens",
  } as const;
  const result = {} as Counter;
  for (const [key, source] of Object.entries(keys)) {
    const count = raw[source];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)
      throw new Error(`usage.${source}が欠測または不正です`);
    result[key as keyof Counter] = count;
  }
  if (result.cacheRead > result.input || result.reasoning > result.output)
    throw new Error("usageの包含関係が不正です");
  return result;
}
function observations(agent: Agent): ObservationSet | null {
  const from = agent.startedAt === null ? null : time(agent.startedAt);
  const to = agent.endedAt === null ? null : time(agent.endedAt);
  if (from !== null && to !== null && to < from)
    throw new Error(`agent ${agent.id}の終了が開始より前です`);
  const found = new Map<string, Observation>();
  let taskStart: number | null = null;
  let taskEnd: number | null = null;
  let taskStarts = 0;
  let taskEnds = 0;
  let finalCumulative: Counter | null = null;
  let responseItems = 0;
  for (const file of agent.files) {
    if (!fs.existsSync(file)) return null;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let value: Record<string, unknown>;
      try {
        value = object(JSON.parse(line)) ?? {};
      } catch {
        return null;
      }
      let id: string | null = null;
      let usage: unknown;
      let at: number | null = null;
      if (agent.format === "codex-rollout") {
        const payload = object(value.payload);
        if (value.type === "event_msg" && payload?.type === "task_started") {
          taskStarts += 1;
          taskStart =
            typeof value.timestamp === "string" ? time(value.timestamp) : null;
        }
        if (value.type === "event_msg" && payload?.type === "task_complete") {
          taskEnds += 1;
          taskEnd =
            typeof value.timestamp === "string" ? time(value.timestamp) : null;
        }
        if (value.type === "response_item") responseItems += 1;
      }
      if (
        agent.format === "codex-host" &&
        value.type === "token_usage_record"
      ) {
        const payload = object(value.payload);
        if (typeof payload?.response_id !== "string")
          throw new Error("response_idが欠測です");
        if (agent.rootTurnId && payload.root_turn_id !== agent.rootTurnId)
          continue;
        id = payload.response_id;
        usage = payload.usage;
        if (typeof value.timestamp !== "string")
          throw new Error("host時刻が欠測です");
        at = time(value.timestamp);
        if ((from !== null && at < from) || (to !== null && at > to)) continue;
      } else if (
        agent.format === "codex-exec" &&
        value.type === "turn.completed"
      ) {
        id = `${file}:${found.size}`;
        usage = value.usage;
      } else if (
        agent.format === "codex-rollout" &&
        value.type === "token_usage_record"
      ) {
        const payload = object(value.payload);
        if (
          typeof payload?.response_id !== "string" ||
          typeof value.timestamp !== "string"
        )
          return null;
        if (agent.rootTurnId && payload.root_turn_id !== agent.rootTurnId)
          continue;
        id = payload.response_id;
        usage = payload.usage;
        at = time(value.timestamp);
        try {
          finalCumulative = counter(payload.thread_token_usage);
        } catch {
          finalCumulative = null;
        }
        if ((from !== null && at < from) || (to !== null && at > to)) continue;
      }
      if (id === null) continue;
      let parsedUsage: Counter;
      try {
        parsedUsage = counter(usage);
      } catch {
        return null;
      }
      // A completed model response with zero input and output cannot substantiate
      // a usage total; some Codex hosts emit this placeholder on review runs.
      if (parsedUsage.input === 0 && parsedUsage.output === 0) return null;
      const item = { id, at, usage: parsedUsage };
      const previous = found.get(id);
      if (
        previous &&
        JSON.stringify(previous.usage) !== JSON.stringify(item.usage)
      )
        return null;
      found.set(id, item);
    }
  }
  const calls = [...found.values()];
  if (agent.format === "codex-rollout") {
    const complete =
      taskStarts === 1 &&
      taskEnds === 1 &&
      taskStart !== null &&
      taskEnd !== null &&
      taskEnd >= taskStart &&
      (from === null || from <= taskStart) &&
      (to === null || to >= taskEnd) &&
      (calls.length === 0
        ? responseItems === 0
        : finalCumulative !== null &&
          JSON.stringify(sum(calls.map((call) => call.usage))) ===
            JSON.stringify(finalCumulative));
    if (!complete && calls.length === 0) return null;
    return {
      calls,
      coverage: complete ? "complete" : "partial",
      taskStart,
      taskEnd,
    };
  }
  if (calls.length === 0) return null;
  return {
    calls,
    coverage: agent.format === "codex-exec" ? "complete" : "partial",
    taskStart: null,
    taskEnd: null,
  };
}
function sum(items: readonly Counter[]): Counter {
  return items.reduce(
    (result, item) => ({
      input: result.input + item.input,
      cacheRead: result.cacheRead + item.cacheRead,
      cacheWrite: result.cacheWrite + item.cacheWrite,
      output: result.output + item.output,
      reasoning: result.reasoning + item.reasoning,
    }),
    { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
  );
}
export function reportCodexE2E(manifest: Manifest) {
  if (
    !Array.isArray(manifest.agents) ||
    manifest.agents.length === 0 ||
    !Array.isArray(manifest.phases)
  )
    throw new Error("1件以上のagentsとphasesが必要です");
  const names = new Set<string>();
  const callsByAgent = new Map<string, ObservationSet | null>();
  const agents = manifest.agents.map((agent) => {
    if (names.has(agent.id))
      throw new Error(`agent IDが重複しています: ${agent.id}`);
    names.add(agent.id);
    const observed = observations(agent);
    callsByAgent.set(agent.id, observed);
    const usage =
      observed === null ? null : sum(observed.calls.map((call) => call.usage));
    return {
      id: agent.id,
      format: agent.format,
      startedAt: agent.startedAt,
      endedAt: agent.endedAt,
      wallMs:
        agent.startedAt === null || agent.endedAt === null
          ? null
          : time(agent.endedAt) - time(agent.startedAt),
      toolWaitMs: null,
      coverage: observed?.coverage ?? "missing",
      calls: observed?.calls.length ?? null,
      usage,
      processedTokens: usage === null ? null : usage.input + usage.output,
      maxObservedInputPerCall:
        observed === null || observed.calls.length === 0
          ? null
          : Math.max(...observed.calls.map((call) => call.usage.input)),
      costUsd: null,
      // Codex input already contains cache reads; do not add them again.
      inputIncludesCacheRead: true,
    };
  });
  const ordered = manifest.phases.map((phase) => ({
    ...phase,
    ms: time(phase.at),
  }));
  for (let i = 1; i < ordered.length; i += 1)
    if (ordered[i]!.ms < ordered[i - 1]!.ms)
      throw new Error("phase時刻の順序が不正です");
  const phases = ordered.slice(0, -1).map((phase, index) => {
    const end = ordered[index + 1]!.ms;
    return {
      name: phase.name,
      from: phase.at,
      to: ordered[index + 1]!.at,
      wallMs: end - phase.ms,
      hostAgentUsage: manifest.agents
        .filter(
          (agent) =>
            agent.format === "codex-host" || agent.format === "codex-rollout",
        )
        .map((agent) => {
          const observed = callsByAgent.get(agent.id);
          const selected = observed?.calls.filter(
            (call) => call.at !== null && call.at >= phase.ms && call.at < end,
          );
          const coverage: Coverage =
            observed == null
              ? "missing"
              : observed.coverage === "complete" &&
                  observed.taskStart !== null &&
                  observed.taskEnd !== null &&
                  observed.taskStart <= phase.ms &&
                  observed.taskEnd >= end
                ? "complete"
                : selected && selected.length > 0
                  ? "partial"
                  : "missing";
          const usage =
            coverage === "missing"
              ? null
              : sum((selected ?? []).map((call) => call.usage));
          return {
            id: agent.id,
            coverage,
            calls: usage === null ? null : (selected?.length ?? 0),
            usage,
            processedTokens: usage === null ? null : usage.input + usage.output,
          };
        }),
    };
  });
  const measured = agents.filter((agent) => agent.processedTokens !== null);
  const observedLowerBound = measured.reduce(
    (total, agent) => total + agent.processedTokens!,
    0,
  );
  return {
    kind: "asc-codex-e2e-measurement/v1",
    agents,
    phases,
    observedLowerBound,
    agentInventoryCoverage: "unverified" as const,
    actualAllAgentProcessedTokens: null,
    allDeclaredAgentProcessedTokens:
      measured.length === agents.length &&
      agents.every((agent) => agent.coverage === "complete")
        ? observedLowerBound
        : null,
    actualCostUsd: null,
    limitations: [
      "missing usage stays null; the observed lower bound is not an all-agent total; the manifest must enumerate every agent",
      "input includes cache reads; cache writes and reasoning output are subsets, not additive totals",
      "tool wait and provider billing are not available from these event streams",
      "maxObservedInputPerCall is not an exact context high-water mark",
      "declared agents may omit launched agents; actual all-agent total remains null without independent inventory evidence",
    ],
  };
}
if (isExecutionEntry(import.meta.url)) {
  const file = process.argv[2];
  if (!file || process.argv.length !== 3)
    throw new Error(
      "usage: node --import tsx scripts/report_codex_e2e.ts <manifest.json>",
    );
  const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as Manifest;
  for (const agent of manifest.agents)
    agent.files = agent.files.map((name) =>
      path.resolve(path.dirname(file), name),
    );
  process.stdout.write(
    `${JSON.stringify(reportCodexE2E(manifest), null, 2)}\n`,
  );
}
