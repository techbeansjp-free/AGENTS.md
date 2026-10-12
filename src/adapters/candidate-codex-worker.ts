import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../lib/process.js";
import { resolveGitWorkspace } from "./review-workspace.js";
import {
  codexPackageRoot,
  makeDirectoriesRemovable,
  workerWriteRoots,
  workerExecutable,
} from "./candidate-worker-boundary.js";

const MAX_WORKER_MS = 30 * 60 * 1000;

export interface CodexCandidateUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  source: "codex-turn-completed";
}

/** Provider-reported usage only; do not infer missing agents or billing totals. */
export function parseCodexCandidateUsage(
  source: string,
): CodexCandidateUsage | null {
  const sums = {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
  let completed = 0;
  for (const line of source.split("\n")) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return null;
    }
    if (
      typeof event !== "object" ||
      event === null ||
      !("type" in event) ||
      event.type !== "turn.completed"
    )
      continue;
    if (
      !("usage" in event) ||
      typeof event.usage !== "object" ||
      event.usage === null
    )
      return null;
    const usage = event.usage as Record<string, unknown>;
    const fields = [
      ["inputTokens", "input_tokens"],
      ["cachedInputTokens", "cached_input_tokens"],
      ["cacheWriteInputTokens", "cache_write_input_tokens"],
      ["outputTokens", "output_tokens"],
      ["reasoningOutputTokens", "reasoning_output_tokens"],
    ] as const;
    if (
      fields.some(
        ([, sourceKey]) =>
          typeof usage[sourceKey] !== "number" ||
          !Number.isSafeInteger(usage[sourceKey]) ||
          (usage[sourceKey] as number) < 0,
      ) ||
      (usage.cached_input_tokens as number) > (usage.input_tokens as number) ||
      (usage.reasoning_output_tokens as number) >
        (usage.output_tokens as number)
    )
      return null;
    for (const [target, sourceKey] of fields) {
      sums[target] += usage[sourceKey] as number;
      if (!Number.isSafeInteger(sums[target])) return null;
    }
    completed += 1;
  }
  return completed > 0 ? { ...sums, source: "codex-turn-completed" } : null;
}

/** Codex talks to its provider outside the tool sandbox; every model tool uses this profile. */
export function runCandidateCodexWorker(input: {
  root: string;
  allowedPaths: readonly string[];
  intent: string;
  correctnessCriterion: string;
}): {
  boundary: "codex-profile";
  status: number;
  stdout: string;
  stderr: string;
  usage: CodexCandidateUsage | null;
  elapsedMs: number;
} {
  if (process.platform !== "linux")
    throw new Error("candidate Codex profileをこのhostで強制できません");
  const root = fs.realpathSync(input.root);
  const workspace = resolveGitWorkspace(root);
  if (workspace.activeRoot === workspace.primaryRoot)
    throw new Error("candidate Codex Workerには専用Git worktreeが必要です");
  const localCodexConfig = path.join(root, ".codex", "config.toml");
  if (fs.lstatSync(localCodexConfig, { throwIfNoEntry: false }))
    throw new Error(
      "candidate Codex Workerはproject-local Codex configを読み込めません",
    );
  const writes = workerWriteRoots(root, input.allowedPaths);
  const codexExecutable = workerExecutable(["codex"]);
  if (
    codexExecutable === root ||
    codexExecutable.startsWith(`${root}${path.sep}`) ||
    codexExecutable === workspace.primaryRoot ||
    codexExecutable.startsWith(`${workspace.primaryRoot}${path.sep}`)
  )
    throw new Error("candidate Codex実行fileを対象repositoryから読めません");
  const runtime = fs.mkdtempSync(
    path.join(os.tmpdir(), "asc-candidate-codex-"),
  );
  const sentinel = path.join(
    path.dirname(root),
    `.asc-candidate-codex-boundary-${crypto.randomUUID()}`,
  );
  const profile = `asc_candidate_codex_${crypto.randomUUID().replaceAll("-", "")}`;
  const filesystem = new Map<string, "read" | "write" | "deny">([
    [":root", "deny"],
    [":minimal", "read"],
    [codexPackageRoot(), "read"],
    [sentinel, "read"],
    [root, "read"],
    [runtime, "write"],
    ...writes.map((item): [string, "write"] => [item, "write"]),
    [path.join(root, ".git"), "read"],
    [path.join(workspace.primaryRoot, ".git"), "read"],
  ]);
  const table = [...filesystem]
    .map(([name, access]) => `${JSON.stringify(name)} = "${access}"`)
    .join(", ");
  const config = [
    "-c",
    `default_permissions="${profile}"`,
    "-c",
    `permissions.${profile}.filesystem={ ${table} }`,
    "-c",
    `permissions.${profile}.network.enabled=false`,
    "-c",
    "features.multi_agent=false",
    "-c",
    "features.multi_agent_v2=false",
  ];
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME,
    LANG: process.env.LANG ?? "C.UTF-8",
    TMPDIR: runtime,
    ...(process.env.CODEX_HOME ? { CODEX_HOME: process.env.CODEX_HOME } : {}),
  };
  try {
    fs.writeFileSync(sentinel, "trusted\n", { flag: "wx", mode: 0o600 });
    const sandbox = ["sandbox", "-P", profile, ...config, "-C", root, "--"];
    const healthy = run(codexExecutable, [...sandbox, "/bin/true"], root, {
      allowFailure: true,
      timeoutMs: 20_000,
      env,
    });
    if (healthy.status !== 0)
      throw new Error(
        `candidate Codex profileを起動できません: ${healthy.stderr.slice(0, 500)}`,
      );
    const probe = run(
      codexExecutable,
      [...sandbox, "/bin/sh", "-c", 'printf x >> "$1"', "probe", sentinel],
      root,
      { allowFailure: true, timeoutMs: 20_000, env },
    );
    if (probe.status === 0 || fs.readFileSync(sentinel, "utf8") !== "trusted\n")
      throw new Error(
        "candidate Codex profileのCoordinator書込禁止を確認できません",
      );
    const prompt = [
      "Implement the user's request in this disposable Git worktree.",
      `Intent: ${input.intent}`,
      `Correctness criterion: ${input.correctnessCriterion}`,
      `Writable source paths: ${input.allowedPaths.join(", ")}`,
      "Modify only the listed source paths. Do not commit, alter Git metadata, or claim tests passed without running them.",
    ].join("\n");
    const startedAt = performance.now();
    const worker = run(
      codexExecutable,
      [
        "exec",
        "--ignore-user-config",
        "--ignore-rules",
        "--ephemeral",
        "--skip-git-repo-check",
        "--json",
        "-C",
        root,
        ...config,
        "-c",
        'approval_policy="never"',
        prompt,
      ],
      root,
      {
        allowFailure: true,
        timeoutMs: MAX_WORKER_MS,
        maxBufferBytes: 16 * 1024 * 1024,
        env,
      },
    );
    return {
      boundary: "codex-profile",
      status: worker.status,
      stdout: worker.stdout,
      stderr: worker.stderr,
      usage: parseCodexCandidateUsage(worker.stdout),
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  } finally {
    fs.rmSync(sentinel, { force: true });
    try {
      fs.rmSync(runtime, { recursive: true, force: true });
    } catch {
      makeDirectoriesRemovable(runtime);
      fs.rmSync(runtime, { recursive: true, force: true });
    }
  }
}
