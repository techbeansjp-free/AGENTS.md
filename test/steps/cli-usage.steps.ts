import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { main } from "../../src/cli.js";
import {
  CliValidationError,
  COMMAND_USAGE,
  findCommandUsage,
  renderUsage,
} from "../../src/cli-usage.js";
import { checkCliUsage } from "../../scripts/check_cli_usage.js";

const { Given, When, Then } = stepDefinitions<WorkflowWorld>();

interface CapturedRun {
  readonly status: number | undefined;
  readonly stdout: string;
  readonly reasons: readonly string[];
  readonly next: string | undefined;
  readonly message: string;
}

async function run(args: string[]): Promise<CapturedRun> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let stdout = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    const status = await main(args);
    return { status, stdout, reasons: [], next: undefined, message: "" };
  } catch (error) {
    if (error instanceof CliValidationError)
      return {
        status: undefined,
        stdout,
        reasons: error.reasons,
        next: error.next,
        message: error.message,
      };
    return {
      status: undefined,
      stdout,
      reasons: [],
      next: undefined,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    process.stdout.write = originalWrite;
  }
}

function repositoryWithRemoteDefault(world: WorkflowWorld): string {
  const root = fs.realpathSync(world.initRepo());
  fs.mkdirSync(path.join(root, ".agent-skill-chain", "policy"), {
    recursive: true,
  });
  fs.copyFileSync(
    path.resolve(".agent-skill-chain/policy/default.json"),
    path.join(root, ".agent-skill-chain", "policy", "default.json"),
  );
  execFileSync("git", ["add", ".agent-skill-chain/policy/default.json"], {
    cwd: root,
  });
  execFileSync(
    "git",
    [
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "user.name=Test",
      "commit",
      "-q",
      "-m",
      "policy",
    ],
    { cwd: root },
  );
  execFileSync(
    "git",
    ["remote", "add", "origin", "https://github.com/example/fixture.git"],
    { cwd: root },
  );
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  execFileSync("git", ["update-ref", "refs/remotes/origin/main", sha], {
    cwd: root,
  });
  execFileSync(
    "git",
    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    { cwd: root },
  );
  return root;
}

function syntheticRoot(world: WorkflowWorld, body: string): string {
  const root = world.temp("asc-cli-usage-");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "cli.ts"), body, "utf8");
  return root;
}

function syntheticCli(dispatch: string): string {
  return [
    "export async function main(argv: string[]): Promise<number> {",
    "  const [command, subcommand] = argv;",
    "  const flags: Record<string, string | boolean> = {};",
    dispatch,
    "  return 0;",
    "}",
    "",
  ].join("\n");
}

const CHECKS: Readonly<
  Record<string, (world: WorkflowWorld) => Promise<void> | void>
> = {
  "SCN-UNIT-CLIUSAGE-001": async () => {
    const result = await run(["worktree", "create"]);
    assert.deepEqual(result.reasons, [
      "--issue=...が必要です",
      "--branch=...が必要です",
      "--slug=...が必要です",
      "--base=...が必要です",
      "--remote-default-branch=...が必要です",
      "--remote-default-sha=...が必要です",
    ]);
    assert.ok(result.next?.includes("worktree create --help"));
  },
  "SCN-UNIT-CLIUSAGE-002": async () => {
    const result = await run([
      "conformance",
      "validate",
      "--contract=/nonexistent/c.json",
      "--binding=/nonexistent/b.json",
    ]);
    assert.deepEqual(result.reasons, ["--evidence=...が必要です"]);
  },
  "SCN-UNIT-CLIUSAGE-003": async () => {
    const result = await run(["worktree", "create", "--help"]);
    assert.equal(result.status, 0);
    assert.equal(result.reasons.length, 0);
    const printed = JSON.parse(result.stdout) as { command: string };
    assert.equal(printed.command, "worktree create");
  },
  "SCN-UNIT-CLIUSAGE-004": () => {
    const usage = findCommandUsage("worktree", "create");
    assert.ok(usage);
    const rendered = renderUsage(usage) as {
      requiredFlags: { flag: string }[];
      optionalFlags: { flag: string; fallback: string }[];
      example: string;
    };
    assert.ok(
      rendered.requiredFlags.some((item) => item.flag === "--issue=<整数>"),
    );
    const root = rendered.optionalFlags.find((item) =>
      item.flag.startsWith("--root="),
    );
    assert.equal(root?.fallback, "現在の作業directory");
    assert.ok(rendered.example.startsWith("npx agent-skill-chain worktree"));
  },
  /**
   * 配布schema`workflow-mode-decision.schema.json`はmode決定の**記録**であって
   * `--assessment`の入力ではない。記録を渡した利用者へ期待形式を名指しで返す（Issue #996）。
   */
  "SCN-UNIT-CLIUSAGE-013": async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "asc-assessment-"));
    const file = path.join(directory, "record.json");
    const answers = Object.fromEntries(
      Array.from({ length: 8 }, (_unused, index) => [
        `Q-0${index + 1}`,
        { answer: true, evidence: "根拠" },
      ]),
    );
    fs.writeFileSync(
      file,
      JSON.stringify({
        mode: "quick",
        requestedMode: "quick",
        answers,
        reasons: [],
        decidedAt: "2026-08-28T00:00:00Z",
      }),
    );
    const result = await run([
      "issue",
      "create",
      "--title=題",
      `--assessment=${file}`,
    ]);
    fs.rmSync(directory, { recursive: true, force: true });
    assert.notEqual(result.status, 0);
    assert.ok(
      [...result.reasons, result.message].some((text) =>
        text.includes(
          '質問IDをキーに{"answer":true|false|"unknown","evidence":"根拠"}を持つobjectを渡してください',
        ),
      ),
      [...result.reasons, result.message].join(" / "),
    );
  },
  /**
   * `--staging-path`だけを渡した場合、**同期の前に**拒否する。後で拒否すると
   * Issueは同期済みなのにcommandが失敗した状態になる（Issue #994）。
   * ここではGitHubへ到達しないことを、拒否理由が案内文であることで確かめる。
   */
  "SCN-UNIT-CLIUSAGE-014": async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "asc-sync-"));
    const bodyFile = path.join(directory, "ISSUE_BODY.md");
    fs.writeFileSync(bodyFile, "# 本文\n");
    const result = await run([
      "issue",
      "sync",
      "--repo=example/absent-repository",
      "--issue=1",
      `--body-file=${bodyFile}`,
      "--apply",
      "--authorize=approved",
      `--staging-path=${directory}`,
    ]);
    assert.notEqual(result.status, 0);
    assert.ok(
      [...result.reasons, result.message].some((text) =>
        text.includes(
          "fullのStep 4では同期記録を更新せず、workflow record --step=4",
        ),
      ),
      [...result.reasons, result.message].join(" / "),
    );
    /**
     * modeとcheckpointの整合も同期の前に判定する。**配置違反のstaging pathを渡すと、
     * 事前検査が動いていれば配置のerrorになり、動いていなければGitHub側のerrorになる。**
     */
    const misplaced = await run([
      "issue",
      "sync",
      "--repo=example/absent-repository",
      "--issue=1",
      `--body-file=${bodyFile}`,
      "--apply",
      "--authorize=approved",
      `--staging-path=${directory}`,
      "--checkpoint=4",
    ]);
    fs.rmSync(directory, { recursive: true, force: true });
    assert.notEqual(misplaced.status, 0);
    assert.ok(
      [...misplaced.reasons, misplaced.message].some((text) =>
        text.includes(
          "同期記録は.agent-skill-chain/tmp/issues/直下のstagingだけに書き込めます",
        ),
      ),
      [...misplaced.reasons, misplaced.message].join(" / "),
    );
  },
  "SCN-UNIT-CLIUSAGE-005": async () => {
    const result = await run(["worktree", "create", "--branch", "feature/x"]);
    assert.deepEqual(result.reasons, [
      "--branchは空白区切りでは受理しません。--branch=値の形式で指定してください",
    ]);
  },
  "SCN-UNIT-CLIUSAGE-006": async () => {
    const result = await run(["workflow", "steps", "--mode", "full"]);
    assert.equal(result.status, 0);
    const printed = JSON.parse(result.stdout) as { mode: string };
    assert.equal(printed.mode, "full");
  },
  "SCN-UNIT-CLIUSAGE-007": async () => {
    const result = await run(["review", "validate", "/nonexistent/review.md"]);
    assert.equal(result.reasons.length, 0);
    assert.ok(!result.message.includes("--file=...が必要です"));
  },
  "SCN-UNIT-CLIUSAGE-008": async (world) => {
    const repository = repositoryWithRemoteDefault(world);
    const result = await run([
      "worktree",
      "create",
      `--root=${repository}`,
      "--path=.git/worktrees/x",
    ]);
    assert.equal(result.reasons.length, 0);
    assert.ok(!result.message.includes("--issue=...が必要です"));
    assert.ok(result.message.includes("ASC-GIT-INTERNAL-001"));
  },
  "SCN-UNIT-CLIUSAGE-009": (world) => {
    const root = syntheticRoot(
      world,
      syntheticCli(
        '  if (command === "worktree" && subcommand === "survey") {\n' +
          '    const undeclared = flags["unlisted"];\n' +
          "    if (undeclared) return 1;\n" +
          "  }",
      ),
    );
    const result = checkCliUsage(root);
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((error) =>
        error.includes("usageに未記載のflagを実装が読んでいます: --unlisted"),
      ),
    );
  },
  "SCN-UNIT-CLIUSAGE-010": (world) => {
    const root = syntheticRoot(
      world,
      syntheticCli(
        '  if (command === "worktree" && subcommand === "survey") {\n' +
          '    const value = required(flags, "undocumented");\n' +
          "    if (value) return 1;\n" +
          "  }",
      ),
    );
    const result = checkCliUsage(root);
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((error) =>
        error.includes(
          "実装がrequiredとして要求するflagがusageの必須・条件付きにありません: --undocumented",
        ),
      ),
    );
  },
  "SCN-UNIT-CLIUSAGE-011": (world) => {
    const root = syntheticRoot(
      world,
      syntheticCli(
        '  if (command === "worktree" && subcommand === "unknown") {\n' +
          "    return 1;\n" +
          "  }",
      ),
    );
    const result = checkCliUsage(root);
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((error) =>
        error.includes("usage定義がないsubcommandです: worktree unknown"),
      ),
    );
  },
  "SCN-UNIT-CLIUSAGE-012": () => {
    const result = checkCliUsage(process.cwd());
    assert.deepEqual(result.errors, []);
    assert.equal(result.valid, true);
    assert.equal(result.commands, COMMAND_USAGE.length);
  },
};

Given("CLI usage単体検査の準備がある", function () {
  this.value = undefined;
});

When(
  "{string}のCLI usage単体検査を実行する",
  async function (scenario: string) {
    const check = CHECKS[scenario];
    if (!check) return;
    await check(this);
    this.validationOutcome = { valid: true };
  },
);

Then("CLI usage単体検査は期待結果になる", function () {
  assert.equal(this.validationOutcome?.valid, true);
});
