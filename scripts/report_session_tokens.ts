import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { STEP_JOURNAL_FILE } from "../src/domain/workflow.js";
import { isExecutionEntry } from "../src/lib/entrypoint.js";

/**
 * Claude Code session logのtoken指標を集計する開発script（REQ-WF-049）。
 *
 * **本文・prompt・tool入出力の文字列を出力しない。** 出力は数値・session ID・時刻・
 * repository root配下の相対pathだけである。pathはRead/Bashのfile引数から抽出し、
 * URL・root外・token様の文字列は捨てる。同一`message.id`の行は1 callとして数える
 * （Claude Codeは1 messageのcontent blockごとに行を書き、usageを重複して載せる）。
 */

/** Provider counters have different inclusion rules; missing data stays null. */
export function normalizeProviderUsage(
  provider: "codex" | "claude",
  raw: unknown,
  actualCostUsd?: unknown,
) {
  const usage = record(raw);
  const input = count(usage?.input_tokens) ?? null;
  const output = count(usage?.output_tokens) ?? null;
  const cacheRead =
    count(
      provider === "codex"
        ? usage?.cached_input_tokens
        : usage?.cache_read_input_tokens,
    ) ?? null;
  const cacheWrite =
    count(
      provider === "codex"
        ? usage?.cache_write_input_tokens
        : usage?.cache_creation_input_tokens,
    ) ?? null;
  const complete =
    input !== null &&
    output !== null &&
    (provider === "codex" || (cacheRead !== null && cacheWrite !== null));
  return {
    provider,
    input,
    output,
    cacheRead,
    cacheWrite,
    inputIncludesCache: provider === "codex",
    totalProcessed: complete
      ? input + output + (provider === "claude" ? cacheRead! + cacheWrite! : 0)
      : null,
    costUsd:
      typeof actualCostUsd === "number" &&
      Number.isFinite(actualCostUsd) &&
      actualCostUsd >= 0
        ? actualCostUsd
        : null,
  };
}

/** call間隔がこれ以下の区間だけを稼働時間へ数える。 */
const ACTIVE_GAP_MS = 5 * 60 * 1000;
const REPEATED_READ_LIMIT = 10;

interface Call {
  id: string;
  at: number;
  input: number;
  cacheCreation: number;
  cacheRead: number;
  output: number;
}

interface ParsedLog {
  calls: Call[];
  reads: string[];
  skippedLines: number;
}

export interface Distribution {
  median: number;
  p95: number;
  max: number;
}

export interface TokenMetrics {
  calls: number;
  input: number;
  cacheCreation: number;
  cacheRead: number;
  output: number;
  total: number;
  fresh: number;
  cacheReadPerCall: Distribution;
  firstCallContext: number;
  contextPerCall: Distribution;
  observedLifetimeMs: number;
  startedAt: string | null;
  endedAt: string | null;
  activeMs: number;
}

export interface SessionReport extends TokenMetrics {
  id: string;
  kind: "main" | "subagent";
  parent: string | null;
  repeatedReads: { path: string; count: number }[];
  skippedLines: number;
}

export interface StepReport extends TokenMetrics {
  step: number | "pre";
  from: string | null;
  to: string | null;
}

export interface SessionTokenReport {
  sessions: SessionReport[];
  steps: StepReport[];
  totals: TokenMetrics & {
    sessions: number;
    wallClockMs: number;
    skippedLines: number;
  };
  resumeOverhead: {
    sessions: { id: string; context: number }[];
    total: number;
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

/** 中央値は偶数件で中央2件の平均、p95はnearest-rank（`ceil(0.95n)`番目）。 */
export function distribution(values: readonly number[]): Distribution {
  if (values.length === 0) return { median: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? sorted[middle]!
      : (sorted[middle - 1]! + sorted[middle]!) / 2;
  const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1]!;
  return { median, p95, max: sorted.at(-1)! };
}

/**
 * 出力してよいpathはrepository rootのGitが追跡するfileだけとする。追跡済みpathは
 * repositoryに既に公開された名前であり、promptやcommand引数の文字列（URL・token・
 * 秘密を含むfile名）を名前の形で見分ける必要がない。Gitを読めなければ空集合にし、
 * pathを1件も出さない側へ倒す。
 */
export function trackedPaths(root: string): ReadonlySet<string> {
  const listed = spawnSync("git", ["-C", root, "ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listed.status !== 0 || typeof listed.stdout !== "string")
    return new Set();
  return new Set(listed.stdout.split("\0").filter((entry) => entry !== ""));
}

/** repository root配下の追跡済みfileへ正規化できたものだけを返す。 */
export function normalizeReadPath(
  candidate: string,
  cwd: string,
  root: string,
  tracked: ReadonlySet<string>,
): string | undefined {
  if (candidate === "" || candidate.startsWith("-")) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(candidate)) return undefined;
  const relative = path.relative(root, path.resolve(cwd, candidate));
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative))
    return undefined;
  const normalized = relative.split(path.sep).join("/");
  return tracked.has(normalized) ? normalized : undefined;
}

function readPaths(
  block: Record<string, unknown>,
  cwd: string,
  root: string,
  tracked: ReadonlySet<string>,
): string[] {
  const input = record(block.input);
  if (input === undefined) return [];
  if (block.name === "Read" && typeof input.file_path === "string") {
    const normalized = normalizeReadPath(input.file_path, cwd, root, tracked);
    return normalized === undefined ? [] : [normalized];
  }
  if (block.name !== "Bash" || typeof input.command !== "string") return [];
  const found: string[] = [];
  for (const raw of input.command.split(/[\s;|&<>()]+/u)) {
    const token = raw.replace(/^['"]+|['"]+$/gu, "");
    const normalized = normalizeReadPath(token, cwd, root, tracked);
    if (normalized !== undefined) found.push(normalized);
  }
  return found;
}

function parseLog(
  file: string,
  root: string,
  tracked: ReadonlySet<string>,
): ParsedLog {
  const byId = new Map<string, Call>();
  const reads: string[] = [];
  const seenTools = new Set<string>();
  let skippedLines = 0;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let value: Record<string, unknown> | undefined;
    try {
      value = record(JSON.parse(line));
    } catch {
      value = undefined;
    }
    if (value === undefined) {
      skippedLines += 1;
      continue;
    }
    if (value.type !== "assistant") continue;
    const message = record(value.message);
    const usage = record(message?.usage);
    const at = Date.parse(String(value.timestamp));
    const id = message?.id;
    const tokens = [
      count(usage?.input_tokens),
      count(usage?.cache_creation_input_tokens),
      count(usage?.cache_read_input_tokens),
      count(usage?.output_tokens),
    ];
    if (
      typeof id !== "string" ||
      Number.isNaN(at) ||
      tokens.some((token) => token === undefined)
    ) {
      skippedLines += 1;
      continue;
    }
    const [input, cacheCreation, cacheRead, output] = tokens as number[];
    const previous = byId.get(id);
    byId.set(id, {
      id,
      at: previous?.at ?? at,
      input: input!,
      cacheCreation: cacheCreation!,
      cacheRead: cacheRead!,
      output: output!,
    });
    const cwd = typeof value.cwd === "string" ? value.cwd : root;
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const block of content) {
      const item = record(block);
      if (item?.type !== "tool_use") continue;
      // Streaming/replayed message blocks can repeat one tool invocation.
      // Without an ID, preserve the observation instead of guessing identity.
      if (typeof item.id === "string" && item.id !== "") {
        const key = JSON.stringify([id, item.id]);
        if (seenTools.has(key)) continue;
        seenTools.add(key);
      }
      reads.push(...readPaths(item, cwd, root, tracked));
    }
  }
  return {
    calls: [...byId.values()].sort((left, right) => left.at - right.at),
    reads,
    skippedLines,
  };
}

/**
 * 1 session内のcall間隔のうち5分以下の区間を`[from, to)`へ切り取った長さの和。
 * **異なるsessionのcall間隔を数えないため、呼び出し側はsessionごとに渡す。**
 */
function activeWithin(
  calls: readonly Call[],
  from: number | null,
  to: number | null,
): number {
  let activeMs = 0;
  for (let index = 1; index < calls.length; index += 1) {
    const start = calls[index - 1]!.at;
    const end = calls[index]!.at;
    if (end - start > ACTIVE_GAP_MS) continue;
    const clippedStart = from === null ? start : Math.max(start, from);
    const clippedEnd = to === null ? end : Math.min(end, to);
    if (clippedEnd > clippedStart) activeMs += clippedEnd - clippedStart;
  }
  return activeMs;
}

function metrics(calls: readonly Call[]): TokenMetrics {
  const sum = (field: keyof Omit<Call, "id" | "at">) =>
    calls.reduce((total, call) => total + call[field], 0);
  const input = sum("input");
  const cacheCreation = sum("cacheCreation");
  const cacheRead = sum("cacheRead");
  const output = sum("output");
  const activeMs = activeWithin(calls, null, null);
  const first = calls[0];
  return {
    calls: calls.length,
    input,
    cacheCreation,
    cacheRead,
    output,
    total: input + cacheCreation + cacheRead + output,
    fresh: input + cacheCreation + output,
    cacheReadPerCall: distribution(calls.map((call) => call.cacheRead)),
    contextPerCall: distribution(
      calls.map((call) => call.input + call.cacheCreation + call.cacheRead),
    ),
    observedLifetimeMs: first === undefined ? 0 : calls.at(-1)!.at - first.at,
    firstCallContext:
      first === undefined
        ? 0
        : first.cacheRead + first.cacheCreation + first.input,
    startedAt: first === undefined ? null : new Date(first.at).toISOString(),
    endedAt:
      calls.length === 0 ? null : new Date(calls.at(-1)!.at).toISOString(),
    activeMs,
  };
}

function repeatedReads(reads: readonly string[]) {
  const counts = new Map<string, number>();
  for (const read of reads) counts.set(read, (counts.get(read) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, total]) => total >= 2)
    .sort(
      ([leftPath, left], [rightPath, right]) =>
        right - left || leftPath.localeCompare(rightPath),
    )
    .slice(0, REPEATED_READ_LIMIT)
    .map(([readPath, total]) => ({ path: readPath, count: total }));
}

/** journalの記録時刻。1行でも読めなければ区切りに使わない行として捨てる。 */
function journalBoundaries(staging: string): { step: number; at: number }[] {
  const file = path.join(staging, ...STEP_JOURNAL_FILE.split("/"));
  if (!fs.existsSync(file)) return [];
  const boundaries: { step: number; at: number }[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const entry = record(JSON.parse(line));
      const at = Date.parse(String(entry?.recordedAt));
      if (typeof entry?.step === "number" && !Number.isNaN(at))
        boundaries.push({ step: entry.step, at });
    } catch {
      continue;
    }
  }
  return boundaries.sort((left, right) => left.at - right.at);
}

/**
 * Step別の指標。**区間はjournalの各記録時刻から次の記録時刻の直前まで**であり、
 * そのStepの記録以後の作業を数える。最初の記録より前は`pre`である。
 */
function stepReports(
  sessionCalls: readonly (readonly Call[])[],
  staging: string,
): StepReport[] {
  const calls = sessionCalls.flat().sort((left, right) => left.at - right.at);
  const boundaries = journalBoundaries(staging);
  const windows: { step: number | "pre"; from: number | null }[] = [
    { step: "pre", from: null },
    ...boundaries.map(({ step, at }) => ({ step, from: at })),
  ];
  return windows.map((window, index) => {
    const next = windows[index + 1]?.from ?? null;
    const selected = calls.filter(
      (call) =>
        (window.from === null || call.at >= window.from) &&
        (next === null || call.at < next),
    );
    return {
      step: window.step,
      from: window.from === null ? null : new Date(window.from).toISOString(),
      to: next === null ? null : new Date(next).toISOString(),
      ...metrics(selected),
      activeMs: sessionCalls.reduce(
        (sum, session) => sum + activeWithin(session, window.from, next),
        0,
      ),
    };
  });
}

/** `<session>/subagents/<agent>.jsonl`の配置ならsubagentであり、親は`<session>`である。 */
function logKind(file: string): {
  kind: "main" | "subagent";
  parent: string | null;
} {
  const directory = path.dirname(file);
  return path.basename(directory) === "subagents"
    ? { kind: "subagent", parent: path.basename(path.dirname(directory)) }
    : { kind: "main", parent: null };
}

/**
 * 各logの`<session>/subagents/*.jsonl`を子孫まで自動で含める。**同じfileは実pathで1回だけ
 * 数える**（明示指定と自動包含の重複、同じlogの二重指定）。
 */
function expandLogs(
  files: readonly string[],
): { file: string; kind: "main" | "subagent"; parent: string | null }[] {
  const expanded = new Map<
    string,
    { file: string; kind: "main" | "subagent"; parent: string | null }
  >();
  const pending = [...files];
  for (let index = 0; index < pending.length; index += 1) {
    const real = fs.realpathSync(pending[index]!);
    if (expanded.has(real)) continue;
    expanded.set(real, { file: real, ...logKind(real) });
    const id = path.basename(real, ".jsonl");
    const directory = path.join(path.dirname(real), id, "subagents");
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory).sort())
      if (name.endsWith(".jsonl")) pending.push(path.join(directory, name));
  }
  return [...expanded.values()];
}

export function reportSessionTokens(input: {
  logs: readonly string[];
  staging?: string;
  root: string;
}): SessionTokenReport {
  const tracked = trackedPaths(input.root);
  const parsed = expandLogs(input.logs).map((log) => ({
    ...log,
    id: path.basename(log.file, ".jsonl"),
    ...parseLog(log.file, input.root, tracked),
  }));
  const sessions: SessionReport[] = parsed.map((log) => ({
    id: log.id,
    kind: log.kind,
    parent: log.parent,
    ...metrics(log.calls),
    repeatedReads: repeatedReads(log.reads),
    skippedLines: log.skippedLines,
  }));
  const allCalls = parsed
    .flatMap((log) => log.calls)
    .sort((left, right) => left.at - right.at);
  const totalMetrics = metrics(allCalls);
  const activeMs = sessions.reduce((sum, session) => sum + session.activeMs, 0);
  const resumeSessions = sessions
    .filter((session) => session.calls > 0)
    .map((session) => ({ id: session.id, context: session.firstCallContext }));
  return {
    sessions,
    steps:
      input.staging === undefined
        ? []
        : stepReports(
            parsed.map((log) => log.calls),
            input.staging,
          ),
    totals: {
      ...totalMetrics,
      activeMs,
      sessions: sessions.length,
      wallClockMs:
        allCalls.length === 0 ? 0 : allCalls.at(-1)!.at - allCalls[0]!.at,
      skippedLines: sessions.reduce(
        (sum, session) => sum + session.skippedLines,
        0,
      ),
    },
    resumeOverhead: {
      sessions: resumeSessions,
      total: resumeSessions.reduce((sum, session) => sum + session.context, 0),
    },
  };
}

if (isExecutionEntry(import.meta.url)) {
  const logs: string[] = [];
  let staging: string | undefined;
  let root = process.cwd();
  for (const argument of process.argv.slice(2)) {
    if (argument.startsWith("--staging=")) staging = argument.slice(10);
    else if (argument.startsWith("--root=")) root = argument.slice(7);
    else if (argument.startsWith("--")) {
      process.stderr.write(`未知のoptionです: ${argument}\n`);
      process.exit(2);
    } else logs.push(argument);
  }
  if (logs.length === 0) {
    process.stderr.write(
      "使い方: node --import tsx scripts/report_session_tokens.ts <session.jsonl>... [--staging=<dir>] [--root=<repository root>]\n",
    );
    process.exit(2);
  }
  const report = reportSessionTokens({
    logs: logs.map((log) => path.resolve(log)),
    ...(staging === undefined ? {} : { staging: path.resolve(staging) }),
    root: path.resolve(root),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
