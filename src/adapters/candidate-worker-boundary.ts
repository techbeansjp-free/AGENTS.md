import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../lib/process.js";
import { candidateAllowedPaths } from "./candidate-session.js";
import { resolveGitWorkspace } from "./review-workspace.js";

const MAX_WORKER_MS = 30 * 60 * 1000;

function workerExecutable(argv: readonly string[]): string {
  const command = argv[0]!;
  const candidates = path.isAbsolute(command)
    ? [command]
    : (process.env.PATH ?? "")
        .split(path.delimiter)
        .map((directory) => path.join(directory, command));
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found)
    throw new Error(`candidate Worker実行fileがありません: ${command}`);
  const actual = fs.realpathSync(found);
  if (!fs.statSync(actual).isFile())
    throw new Error(
      `candidate Worker実行fileが通常fileではありません: ${command}`,
    );
  return actual;
}

function codexPackageRoot(): string {
  const executable = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((directory) => path.join(directory, "codex"))
    .find((candidate) => fs.existsSync(candidate));
  if (!executable)
    throw new Error("candidate Worker隔離にはCodex sandboxが必要です");
  const actual = fs.realpathSync(executable);
  const packageRoot = path.dirname(path.dirname(actual));
  return fs.statSync(packageRoot).isDirectory()
    ? packageRoot
    : path.dirname(actual);
}

function assertNoWriteAlias(directory: string): void {
  let entries = 0;
  const visit = (current: string): void => {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      entries += 1;
      if (entries > 10_000)
        throw new Error("candidate Workerの書込領域が検査上限を超えました");
      const absolute = path.join(current, item.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isDirectory()) visit(absolute);
      else if (!stat.isFile() || stat.nlink !== 1)
        throw new Error(
          `candidate Workerの書込領域にsymlink・hardlink・特殊fileがあります: ${absolute}`,
        );
    }
  };
  visit(directory);
}

function workerWriteRoots(root: string, paths: readonly string[]): string[] {
  const roots = new Set<string>();
  for (const relative of paths.length === 0
    ? []
    : candidateAllowedPaths([...paths])) {
    const first = relative.split("/")[0];
    if (
      first === ".git" ||
      first === ".agent-skill-chain" ||
      first === ".codex" ||
      first === ".agents" ||
      first === ".github"
    )
      throw new Error(
        `candidate Workerへ管理領域を書込許可できません: ${relative}`,
      );
    const absolute = path.join(root, relative);
    const directory = path.dirname(absolute);
    if (directory === root) {
      throw new Error(
        `candidateのルート直下fileはこのhostで隔離できません: ${relative}`,
      );
    } else {
      if (!fs.existsSync(directory) || !fs.lstatSync(directory).isDirectory())
        throw new Error(`candidateの書込親directoryがありません: ${relative}`);
      if (fs.realpathSync(directory) !== directory)
        throw new Error(
          `candidateの書込親directoryにsymlink祖先があります: ${relative}`,
        );
      if (!roots.has(directory)) {
        assertNoWriteAlias(directory);
        roots.add(directory);
      }
    }
  }
  return [...roots].sort();
}

/** Run one worker with source-only write access; the coordinator keeps preflight state in memory. */
export function runCandidateWorkerBoundary(input: {
  root: string;
  allowedPaths: readonly string[];
  argv: readonly string[];
}) {
  if (process.platform !== "linux")
    throw new Error("candidate Worker隔離をこのhostで強制できません");
  if (
    input.argv.length === 0 ||
    input.argv.some((part) => !part || part.includes("\0"))
  )
    throw new Error("candidate Worker argvが不正です");
  const root = fs.realpathSync(input.root);
  const workspace = resolveGitWorkspace(root);
  if (workspace.activeRoot === workspace.primaryRoot)
    throw new Error("candidate Workerには専用Git worktreeが必要です");
  const parent = path.dirname(root);
  const writes = workerWriteRoots(root, input.allowedPaths);
  const packageRoot = codexPackageRoot();
  const executable = workerExecutable(input.argv);
  const runtime = fs.mkdtempSync(
    path.join(os.tmpdir(), "asc-candidate-worker-"),
  );
  const sentinel = path.join(
    parent,
    `.asc-candidate-boundary-${crypto.randomUUID()}`,
  );
  const profile = `asc_candidate_${crypto.randomUUID().replaceAll("-", "")}`;
  const filesystem = new Map<string, "read" | "write">([
    [":minimal", "read"],
    [os.tmpdir(), "read"],
    [packageRoot, "read"],
    [path.dirname(executable), "read"],
    [parent, "read"],
    [root, "read"],
    [runtime, "write"],
    ...writes.map((item): [string, "write"] => [item, "write"]),
    [path.join(root, ".git"), "read"],
    [path.join(workspace.primaryRoot, ".git"), "read"],
  ]);
  const table = [...filesystem]
    .map(([name, access]) => `${JSON.stringify(name)} = "${access}"`)
    .join(", ");
  const prefix = [
    "sandbox",
    "-c",
    `default_permissions="${profile}"`,
    "-c",
    `permissions.${profile}.filesystem={ ${table} }`,
    "-c",
    `permissions.${profile}.network.enabled=false`,
    "-P",
    profile,
    "-C",
    root,
    "--",
  ];
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: runtime,
    TMPDIR: runtime,
    LANG: process.env.LANG ?? "C.UTF-8",
  };
  try {
    fs.writeFileSync(sentinel, "trusted\n", { flag: "wx", mode: 0o600 });
    const healthy = run("codex", [...prefix, "/bin/true"], root, {
      allowFailure: true,
      timeoutMs: 20_000,
      env,
    });
    if (healthy.status !== 0)
      throw new Error(
        `candidate Workerのhost隔離を起動できません: ${healthy.stderr.slice(0, 500)}`,
      );
    const probe = run(
      "codex",
      [...prefix, "/bin/sh", "-c", 'printf x >> "$1"', "probe", sentinel],
      root,
      { allowFailure: true, timeoutMs: 20_000, env },
    );
    if (probe.status === 0 || fs.readFileSync(sentinel, "utf8") !== "trusted\n")
      throw new Error("candidate WorkerのCoordinator書込禁止を確認できません");
    const worker = run("codex", [...prefix, ...input.argv], root, {
      allowFailure: true,
      timeoutMs: MAX_WORKER_MS,
      maxBufferBytes: 4 * 1024 * 1024,
      env,
    });
    return {
      boundary: "host-enforced" as const,
      status: worker.status,
      stdout: worker.stdout,
      stderr: worker.stderr,
    };
  } finally {
    fs.rmSync(sentinel, { force: true });
    fs.rmSync(runtime, { recursive: true, force: true });
  }
}
