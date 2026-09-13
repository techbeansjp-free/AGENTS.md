import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  launchCodex,
  type CodexLaunchInput,
} from "../../src/adapters/codex-launch.js";
import {
  codexExecutionArguments,
  executeCodex,
} from "../../src/adapters/codex-execution.js";
import { gitWorkspaceFixture } from "../support/git-workspace-fixture.js";
import {
  codexFixtureScript,
  withProviderPath,
} from "../support/provider-fixture.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class GitWorkspaceWorld extends WorkflowWorld {
  workspace: ReturnType<typeof gitWorkspaceFixture> | undefined;
}
const { Given, When, Then } = stepDefinitions<GitWorkspaceWorld>();
const observation = () => ({
  status: 0,
  stderr: "",
  stdout:
    [
      { id: 2, result: { config: {} } },
      {
        id: 1,
        result: {
          data: [
            {
              model: "fixture-model",
              isDefault: true,
              supportedReasoningEfforts: [{ reasoningEffort: "high" }],
            },
          ],
          nextCursor: null,
        },
      },
    ]
      .map((value) => JSON.stringify(value))
      .join("\n") + "\n",
});
function input(
  root: string,
  sandbox: CodexLaunchInput["sandbox"] = "workspace-write",
): CodexLaunchInput {
  return {
    root,
    sandbox,
    scope: "issue-1383",
    coordinator: "a",
    implementer: "b",
    reviewer: "c",
    implementerContext: "b-context",
    reviewerContext: "c-context",
    risk: "identity",
    mode: "full",
    promptFile: "task.txt",
  };
}

Given("Git書込commandを使わない隔離linked worktree fixtureがある", function () {
  this.workspace = gitWorkspaceFixture();
});

When(
  "実Git照会からlinked Git metadata write rootsを模擬Codexへ配送する",
  { timeout: 15_000 },
  async function () {
    assert.ok(this.workspace);
    const fixture = this.workspace;
    const registry = spawnSync("git", ["worktree", "list", "--porcelain"], {
      cwd: fixture.root,
      encoding: "utf8",
    });
    assert.equal(registry.status, 0);
    assert.ok(registry.stdout.includes(`worktree ${fixture.root}\n`));
    const binary = path.join(fixture.directory, "bin");
    fixture.write(path.join(binary, "codex"), codexFixtureScript(binary));
    fs.chmodSync(path.join(binary, "codex"), 0o755);
    let count = 0;
    this.value = await withProviderPath(binary, () =>
      launchCodex(input(fixture.root), {
        observeExecutor: observation,
        execute: async (execution) => {
          count++;
          const args = codexExecutionArguments(execution);
          const roots = args.flatMap((arg, index) =>
            arg === "--add-dir" ? [args[index + 1]] : [],
          );
          assert.deepEqual(
            roots,
            [fixture.gitDir, fixture.commonDir],
            "linked worktree must deliver both Git metadata write roots exactly once",
          );
          const result = await executeCodex(execution);
          const call: unknown = JSON.parse(
            fs.readFileSync(path.join(binary, "calls.jsonl"), "utf8"),
          );
          assert.deepEqual(call, { args, input: execution.prompt });
          // Exercise only the disposable linked worktree's real Git index.
          const index = path.join(fixture.gitDir, "index");
          assert.equal(fs.existsSync(index), false);
          const added = spawnSync("git", ["add", "--", "task.txt"], {
            cwd: fixture.root,
            encoding: "utf8",
          });
          assert.equal(added.status, 0, added.stderr);
          assert.ok(fs.statSync(index).isFile());
          const staged = spawnSync("git", ["show", ":task.txt"], {
            cwd: fixture.root,
            encoding: "utf8",
          });
          assert.equal(staged.status, 0, staged.stderr);
          assert.equal(
            staged.stdout,
            fs.readFileSync(path.join(fixture.root, "task.txt"), "utf8"),
          );
          return result;
        },
      }),
    );
    assert.equal(count, 1);
  },
);

Then("linked起動は成功し追加rootを一度ずつ渡す", function () {
  assert.ok(
    this.value && typeof this.value === "object" && "state" in this.value,
  );
  assert.equal(this.value.state, "succeeded");
});

When("不正なGit相互linkと未知topologyを起動前に拒否する", async function () {
  const cases = [
    "reverse",
    "forward",
    "commondir",
    "separate",
    "missing",
    "multiline",
    "control",
    "symlink",
    "root-symlink",
    "subdirectory",
    "non-git",
    "separate-primary",
    "bare-common",
    "commondir-empty",
    "reverse-empty",
    "symlink-parent-traversal",
  ];
  for (const variant of cases) {
    const fixture = gitWorkspaceFixture();
    let root = fixture.root;
    if (variant === "reverse")
      fixture.write(
        path.join(fixture.gitDir, "gitdir"),
        path.join(fixture.primary, ".git") + "\n",
      );
    if (variant === "forward" || variant === "separate")
      fixture.write(path.join(root, ".git"), `gitdir: ${fixture.commonDir}\n`);
    if (variant === "commondir")
      fixture.write(path.join(fixture.gitDir, "commondir"), "../../missing\n");
    if (variant === "missing")
      fixture.write(path.join(root, ".git"), "gitdir: /missing-1383\n");
    if (variant === "multiline")
      fixture.write(
        path.join(fixture.gitDir, "gitdir"),
        path.join(root, ".git") + "\nextra\n",
      );
    if (variant === "control")
      fixture.write(
        path.join(fixture.gitDir, "gitdir"),
        path.join(root, ".git") + "\0\n",
      );
    if (variant === "symlink") {
      fs.symlinkSync(fixture.gitDir, path.join(fixture.directory, "alias"));
      fixture.write(
        path.join(root, ".git"),
        `gitdir: ${path.join(fixture.directory, "alias")}\n`,
      );
    }
    if (variant === "root-symlink") {
      root = path.join(fixture.directory, "root-alias");
      fs.symlinkSync(fixture.root, root);
    }
    if (variant === "subdirectory" || variant === "non-git") {
      root = path.join(
        variant === "subdirectory" ? fixture.root : fixture.directory,
        "sub",
      );
      fixture.write(path.join(root, "task.txt"), "private-prompt-1383");
    }
    if (variant === "separate-primary")
      fixture.write(
        path.join(fixture.commonDir, "config"),
        `[core]\nrepositoryformatversion = 0\nbare = false\nworktree = ${fixture.root}\n`,
      );
    if (variant === "bare-common")
      fixture.write(
        path.join(fixture.commonDir, "config"),
        "[core]\nrepositoryformatversion = 0\nbare = true\n",
      );
    if (variant === "commondir-empty")
      fixture.write(path.join(fixture.gitDir, "commondir"), "\n");
    if (variant === "reverse-empty")
      fixture.write(path.join(fixture.gitDir, "gitdir"), "\n");
    if (variant === "symlink-parent-traversal") {
      fs.symlinkSync(fixture.root, path.join(fixture.directory, "alias"));
      fixture.write(
        path.join(root, ".git"),
        `gitdir: ${fixture.directory}/alias/../primary space/.git/worktrees/linked\n`,
      );
    }
    let observations = 0;
    let executions = 0;
    const result = await launchCodex(input(root), {
      observeExecutor: () => {
        observations++;
        return observation();
      },
      execute: async () => {
        executions++;
        return { state: "succeeded", exitCode: 0, reason: "unexpected" };
      },
    });
    assert.equal(result.state, "rejected", variant);
    assert.equal(result.dispatched, false, variant);
    assert.equal(observations, 0, variant);
    assert.equal(executions, 0, variant);
  }
  for (const change of ["reverse", "config", "directory"]) {
    const fixture = gitWorkspaceFixture();
    let executions = 0;
    const result = await launchCodex(input(fixture.root), {
      observeExecutor: () => {
        if (change === "reverse")
          fixture.write(path.join(fixture.gitDir, "gitdir"), "invalid\n");
        if (change === "config") {
          const config = path.join(fixture.commonDir, "config");
          // Preserve repositoryformatversion so Git applies the bare setting.
          fixture.write(
            config,
            fs
              .readFileSync(config, "utf8")
              .replace("bare = false", "bare = true"),
          );
        }
        if (change === "directory") {
          fs.renameSync(fixture.gitDir, fixture.gitDir + "-old");
          fs.cpSync(fixture.gitDir + "-old", fixture.gitDir, {
            recursive: true,
          });
        }
        return observation();
      },
      execute: async () => {
        executions++;
        return { state: "succeeded", exitCode: 0, reason: "unexpected" };
      },
    });
    assert.equal(result.state, "rejected", change);
    assert.equal(result.dispatched, false, change);
    assert.equal(executions, 0, change);
  }
  this.value = true;
});

When("read-onlyとprimaryの固定argvを維持する", async function () {
  assert.ok(this.workspace);
  for (const [root, sandbox] of [
    [this.workspace.root, "read-only"],
    [this.workspace.primary, "workspace-write"],
  ] as const) {
    let count = 0;
    const result = await launchCodex(input(root, sandbox), {
      observeExecutor: observation,
      execute: async (execution) => {
        count++;
        assert.deepEqual(codexExecutionArguments(execution), [
          "exec",
          "--json",
          "--ephemeral",
          "--model",
          "fixture-model",
          "-c",
          'model_provider="openai"',
          "-c",
          'model_reasoning_effort="high"',
          "-c",
          'service_tier="default"',
          "--sandbox",
          sandbox,
          "--cd",
          root,
          "-",
        ]);
        return { state: "succeeded", exitCode: 0, reason: "fixture" };
      },
    });
    assert.equal(result.state, "succeeded");
    assert.equal(count, 1);
  }
  this.value = true;
});

When("Git境界拒否結果からprivate入力を除外する", async function () {
  assert.ok(this.workspace);
  const fixture = this.workspace;
  fixture.write(
    path.join(fixture.gitDir, "gitdir"),
    "/private-home-1383/private-repository-1383/private-sentinel-1383\n",
  );
  const result = await launchCodex(input(fixture.root), {
    observeExecutor: observation,
    execute: async () => ({
      state: "succeeded",
      exitCode: 0,
      reason: "unexpected",
    }),
  });
  assert.equal(result.state, "rejected");
  assert.equal(result.dispatched, false);
  const serialized = JSON.stringify(result);
  for (const secret of [
    "private-prompt-1383",
    "private-home-1383",
    "private-repository-1383",
    "private-sentinel-1383",
    fixture.directory,
    process.env.HOME ?? "home-sentinel",
  ])
    assert.equal(serialized.includes(secret), false);
  const valid = gitWorkspaceFixture();
  const binary = path.join(valid.directory, "git-bin");
  for (const stdout of [
    "",
    "relative\npaths\nhere\nfalse\n",
    `${valid.root}\n${valid.gitDir}\n${valid.commonDir}\nfalse\nextra\n`,
  ]) {
    valid.write(
      path.join(binary, "git"),
      `#!${process.execPath}\nprocess.stderr.write(${JSON.stringify("private-git-stderr-1383 " + valid.directory)}); process.stdout.write(${JSON.stringify(stdout)}); process.exitCode = ${stdout === "" ? 1 : 0};\n`,
    );
    fs.chmodSync(path.join(binary, "git"), 0o755);
    await withProviderPath(binary, async () => {
      const rejected = await launchCodex(input(valid.root), {
        observeExecutor: () => {
          assert.fail("Git rejection must precede provider observation");
        },
        execute: async () => {
          assert.fail("Git rejection must precede execution");
        },
      });
      assert.equal(rejected.state, "rejected");
      assert.equal(rejected.dispatched, false);
      for (const secret of [
        "private-git-stderr-1383",
        valid.directory,
        "private-prompt-1383",
      ])
        assert.equal(JSON.stringify(rejected).includes(secret), false);
    });
  }
  this.value = true;
});

Then("Git workspace境界の受け入れ条件を満たす", function () {
  assert.equal(this.value, true);
});
