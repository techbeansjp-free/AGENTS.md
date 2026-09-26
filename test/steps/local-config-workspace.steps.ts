import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { After } from "@cucumber/cucumber";
import { resolveJevProviderConfig } from "../../src/adapters/local-config-workspace.js";
import { JEV_PROVIDER_CONFIG_PATH } from "../../src/domain/jev-provider-config.js";
import type { LocalConfigResolution } from "../../src/domain/local-config-resolution.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface LocalConfigWorkspaceWorld extends WorkflowWorld {
  linkedRoot: string;
  resolution?: LocalConfigResolution<{
    enabled: true;
    apiKeyEnvVar: string;
    endpoint: string;
    model: string;
  }>;
}

const { Given, When, Then } = stepDefinitions<LocalConfigWorkspaceWorld>();

After(function () {
  delete process.env.JEV_API_KEY_LCW;
});

function runGit(root: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function initRepository(root: string): void {
  fs.mkdirSync(root, { recursive: true });
  runGit(root, ["init", "-q", "-b", "main"]);
  runGit(root, ["config", "user.name", "local-config-workspace-test"]);
  runGit(root, [
    "config",
    "user.email",
    "local-config-workspace-test@example.invalid",
  ]);
  fs.writeFileSync(path.join(root, "README.md"), "# fixture\n");
}

function commitAll(root: string, message: string): string {
  runGit(root, ["add", "-A"]);
  runGit(root, ["commit", "-q", "-m", message]);
  return runGit(root, ["rev-parse", "HEAD"]);
}

function writeJevConfig(root: string, overrides: Record<string, unknown>): void {
  const resolved = path.join(root, JEV_PROVIDER_CONFIG_PATH);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(
    resolved,
    JSON.stringify(
      {
        enabled: true,
        apiKeyEnvVar: "JEV_API_KEY_LCW",
        endpoint: "https://api.jev.example.invalid/v1",
        model: "jev-decision-1",
        ...overrides,
      },
      null,
      2,
    ),
  );
}

function createLinkedWorktree(world: LocalConfigWorkspaceWorld): {
  primary: string;
  linked: string;
} {
  const primary = world.temp("asc-lcw-primary-");
  initRepository(primary);
  fs.writeFileSync(
    path.join(primary, ".gitignore"),
    ".agent-skill-chain/local/\n.worktrees/\n",
  );
  fs.writeFileSync(path.join(primary, "target.ts"), "export const x = 1;\n");
  commitAll(primary, "base");
  const linked = path.join(primary, ".worktrees", "linked");
  fs.mkdirSync(path.dirname(linked), { recursive: true });
  runGit(primary, ["worktree", "add", "-q", "-b", "linked", linked]);
  world.linkedRoot = linked;
  return { primary, linked };
}

Given(
  "primaryにJev provider configがあり連結worktreeには無い",
  function (this: LocalConfigWorkspaceWorld) {
    const { primary } = createLinkedWorktree(this);
    process.env.JEV_API_KEY_LCW = "test-value";
    writeJevConfig(primary, {});
  },
);

Given(
  "primaryにJev provider configがあり連結worktreeではdisabledに設定されている",
  function (this: LocalConfigWorkspaceWorld) {
    const { primary, linked } = createLinkedWorktree(this);
    process.env.JEV_API_KEY_LCW = "test-value";
    writeJevConfig(primary, {});
    writeJevConfig(linked, { enabled: false });
  },
);

Given(
  "primaryにJev provider configがあり連結worktreeでは不正な設定になっている",
  function (this: LocalConfigWorkspaceWorld) {
    const { primary, linked } = createLinkedWorktree(this);
    process.env.JEV_API_KEY_LCW = "test-value";
    writeJevConfig(primary, {});
    const resolved = path.join(linked, JEV_PROVIDER_CONFIG_PATH);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, "{ enabled: true, ");
  },
);

Given(
  "primaryにも連結worktreeにもJev provider configが無い",
  function (this: LocalConfigWorkspaceWorld) {
    createLinkedWorktree(this);
  },
);

Given(
  "primaryには無く連結worktreeにJev provider configがある",
  function (this: LocalConfigWorkspaceWorld) {
    const { linked } = createLinkedWorktree(this);
    process.env.JEV_API_KEY_LCW = "test-value";
    writeJevConfig(linked, {});
  },
);

When(
  "連結worktreeからresolveJevProviderConfigを実行する",
  function (this: LocalConfigWorkspaceWorld) {
    this.resolution = resolveJevProviderConfig(this.linkedRoot);
  },
);

Then(
  "解決状態はenabledでsourceはprimaryである",
  function (this: LocalConfigWorkspaceWorld) {
    assert.equal(this.resolution?.state, "enabled");
    assert.ok(
      this.resolution?.state === "enabled" &&
        this.resolution.source === "primary",
    );
  },
);

Then(
  "解決状態はenabledでsourceはactiveである",
  function (this: LocalConfigWorkspaceWorld) {
    assert.equal(this.resolution?.state, "enabled");
    assert.ok(
      this.resolution?.state === "enabled" &&
        this.resolution.source === "active",
    );
  },
);

Then(
  "解決状態はdisabledでsourceはactiveである",
  function (this: LocalConfigWorkspaceWorld) {
    assert.equal(this.resolution?.state, "disabled");
    assert.ok(
      this.resolution?.state === "disabled" &&
        this.resolution.source === "active",
    );
  },
);

Then(
  "解決状態はinvalidでsourceはactiveである",
  function (this: LocalConfigWorkspaceWorld) {
    assert.equal(this.resolution?.state, "invalid");
    assert.ok(
      this.resolution?.state === "invalid" &&
        this.resolution.source === "active",
    );
  },
);

Then("解決状態はabsentである", function (this: LocalConfigWorkspaceWorld) {
  assert.equal(this.resolution?.state, "absent");
});
