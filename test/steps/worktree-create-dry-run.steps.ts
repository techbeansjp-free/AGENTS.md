import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { main } from "../../src/cli.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

class DryRunWorld extends WorkflowWorld {
  cliResult:
    { status: number | null; stdout: string; stderr: string } | undefined =
    undefined;
  remoteDefaultSha = "";
  root = "";
  worktreeStateBefore = "";
  expectedDestination = "";
}

const { Given, When, Then } = stepDefinitions<DryRunWorld>();

const CURRENT_TIME = new Date("2000-01-02T12:00:00.000Z");

function stamp(time: Date, dayOffset = 0): string {
  const local = new Date(time.getTime() + dayOffset * 86_400_000);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return [
    String(local.getFullYear()),
    pad(local.getMonth() + 1),
    pad(local.getDate()),
    "_",
    pad(local.getHours()),
    pad(local.getMinutes()),
    pad(local.getSeconds()),
  ].join("");
}
const BRANCH = "bugfix/1037-worktree-create-dry-run";
const ISSUE = 1037;
const SLUG = "worktree-create-dry-run";

function requireRoot(world: DryRunWorld): string {
  assert.notEqual(world.root, "", "隔離repositoryが未初期化です");
  return world.root;
}

function requireSha(world: DryRunWorld): string {
  assert.notEqual(
    world.remoteDefaultSha,
    "",
    "remote default SHAが未初期化です",
  );
  return world.remoteDefaultSha;
}

function worktreeState(root: string): string {
  const worktrees = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  });
  const branches = execFileSync("git", ["branch", "--list"], {
    cwd: root,
    encoding: "utf8",
  });
  return `${worktrees}\n---\n${branches}`;
}

async function runCli(
  world: DryRunWorld,
  extra: string[],
  overridePath?: string,
): Promise<void> {
  const root = requireRoot(world);
  world.worktreeStateBefore = worktreeState(root);
  const args = [
    "worktree",
    "create",
    `--root=${root}`,
    `--branch=${BRANCH}`,
    "--base=main",
    `--issue=${ISSUE}`,
    `--slug=${SLUG}`,
    "--remote-default-branch=main",
    `--remote-default-sha=${requireSha(world)}`,
    ...(overridePath === undefined ? [] : [`--path=${overridePath}`]),
    ...extra,
  ];
  let stdout = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    stdout += String(chunk);
    return true;
  };
  try {
    const status = await main(args, {
      now: () => new Date(CURRENT_TIME.getTime()),
    });
    world.cliResult = { status, stdout, stderr: "" };
  } catch (error) {
    world.cliResult = {
      status: 1,
      stdout,
      stderr: error instanceof Error ? error.message : String(error),
    };
  } finally {
    process.stdout.write = originalWrite;
  }
}

Given("worktree create dry-run検証用の隔離repositoryがある", function () {
  this.root = this.initRepo();
  fs.mkdirSync(path.join(this.root, ".agent-skill-chain", "policy"), {
    recursive: true,
  });
  fs.copyFileSync(
    ".agent-skill-chain/policy/default.json",
    path.join(this.root, ".agent-skill-chain", "policy", "default.json"),
  );
  fs.copyFileSync(
    ".agent-skill-chain/project-policy.json",
    path.join(this.root, ".agent-skill-chain", "project-policy.json"),
  );
  fs.cpSync(
    ".agent-skill-chain/project",
    path.join(this.root, ".agent-skill-chain", "project"),
    { recursive: true },
  );
  execFileSync("git", ["add", ".agent-skill-chain"], { cwd: this.root });
  execFileSync("git", ["commit", "-q", "-m", "trusted policy fixture"], {
    cwd: this.root,
  });
  fs.appendFileSync(
    path.join(this.root, ".git", "info", "exclude"),
    ".worktrees/\n",
  );
  execFileSync(
    "git",
    ["remote", "add", "origin", "https://github.com/example/fixture.git"],
    { cwd: this.root },
  );
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: this.root,
    encoding: "utf8",
  }).trim();
  execFileSync("git", ["update-ref", "refs/remotes/origin/main", sha], {
    cwd: this.root,
  });
  execFileSync(
    "git",
    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    { cwd: this.root },
  );
  this.remoteDefaultSha = sha;
  this.expectedDestination = path.join(
    this.root,
    ".worktrees",
    `${stamp(CURRENT_TIME)}-${ISSUE}-${SLUG}`,
  );
});

When("{string}でworktree create CLIを実行する", async function (mode: string) {
  const extra =
    mode === "flagなし"
      ? []
      : mode.split(" ").filter((token) => token.length > 0);
  await runCli(this, extra);
});

When(
  "{string}で未来timestampのpathを指定してworktree create CLIを実行する",
  async function (mode: string) {
    const root = requireRoot(this);
    const futurePath = `.worktrees/${stamp(CURRENT_TIME, 1)}-${ISSUE}-${SLUG}`;
    this.expectedDestination = path.join(root, futurePath);
    await runCli(this, [mode], futurePath);
  },
);

Then("repositoryの状態は{string}である", function (expectation: string) {
  assert.equal(expectation, "変わらない");
  const root = requireRoot(this);
  assert.equal(worktreeState(root), this.worktreeStateBefore);
  assert.equal(fs.existsSync(this.expectedDestination), false);
});

Then(
  "worktree create CLIの結果は{string}である",
  function (expectation: string) {
    const result = this.cliResult;
    assert.ok(result, "CLI結果が未記録です");
    const combined = `${result.stdout}\n${result.stderr}`;
    if (expectation === "preview計画") {
      assert.equal(result.status, 0, combined);
      const parsed = JSON.parse(result.stdout) as {
        state?: string;
        path?: string;
        branch?: string;
        base?: string;
      };
      assert.equal(parsed.state, "preview");
      assert.equal(parsed.path, this.expectedDestination);
      assert.equal(path.isAbsolute(parsed.path ?? ""), true);
      assert.equal(parsed.branch, BRANCH);
      assert.match(parsed.base ?? "", /^[0-9a-f]{40}$/u);
      assert.equal(parsed.base, requireSha(this));
      return;
    }
    if (expectation === "作成成功") {
      assert.equal(result.status, 0, combined);
      const parsed = JSON.parse(result.stdout) as {
        state?: string;
        path?: string;
      };
      assert.equal(parsed.state, undefined);
      assert.equal(parsed.path, this.expectedDestination);
      assert.equal(fs.existsSync(this.expectedDestination), true);
      return;
    }
    if (expectation === "拒否") {
      assert.equal(result.status, 1, combined);
      assert.match(combined, /--dry-run|--apply/u);
      return;
    }
    assert.equal(expectation, "配置拒否");
    assert.equal(result.status, 1, combined);
    assert.match(combined, /未来/u);
  },
);
