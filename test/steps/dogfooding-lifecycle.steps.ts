import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { spawnSync } from "node:child_process";

const { Given, When, Then } = stepDefinitions<WorkflowWorld>();

const MANAGED_RECORD = ".agent-skill-chain/managed-assets.json";

interface DoctorResult {
  healthy: boolean;
  installed: boolean;
  adapters: { diagnostics: string[] };
  worktrees?: { cleanupReadyCount: number; diagnostics: string[] };
}

function candidateFiles(source: string): string[] {
  return execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: source,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  )
    .split("\0")
    .filter((entry) => entry !== "" && fs.existsSync(path.join(source, entry)));
}

function replicateRepository(world: WorkflowWorld): string {
  const source = process.cwd();
  const target = world.temp("asc-dogfood-");
  for (const relative of candidateFiles(source)) {
    const destination = path.join(target, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(source, relative), destination);
  }
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: target });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], {
    cwd: target,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: target });
  execFileSync("git", ["add", "-A"], { cwd: target });
  execFileSync("git", ["commit", "-q", "-m", "replica"], { cwd: target });
  return target;
}

function runCli(args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync(
    process.execPath,
    [path.resolve("dist/bin/agent-skill-chain.js"), ...args],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return { status: result.status, stdout: result.stdout };
}

function install(target: string): void {
  const result = runCli(["install", `--root=${target}`, "--apply"]);
  assert.equal(result.status, 0);
}

function diagnose(target: string): DoctorResult {
  return JSON.parse(
    runCli(["doctor", `--root=${target}`]).stdout,
  ) as DoctorResult;
}

function porcelain(target: string): string {
  return execFileSync("git", ["status", "--porcelain"], {
    cwd: target,
    encoding: "utf8",
  }).trim();
}

const CHECKS: Readonly<Record<string, (world: WorkflowWorld) => void>> = {
  "SCN-INT-DOGFOOD-001": (world) => {
    const target = replicateRepository(world);
    install(target);
    const result = diagnose(target);
    assert.deepEqual(result.adapters.diagnostics, []);
    assert.equal(result.installed, true);
    assert.equal(result.healthy, true);
  },
  "SCN-INT-DOGFOOD-002": (world) => {
    const target = replicateRepository(world);
    assert.equal(porcelain(target), "");
    install(target);
    assert.equal(porcelain(target), "");
  },
  "SCN-INT-DOGFOOD-003": (world) => {
    const target = replicateRepository(world);
    const result = diagnose(target);
    assert.equal(result.installed, false);
    assert.equal(result.healthy, false);
    assert.ok(
      result.adapters.diagnostics.some((entry) =>
        entry.includes("managed recordがありません"),
      ),
    );
  },
  "SCN-INT-DOGFOOD-004": (world) => {
    const target = replicateRepository(world);
    install(target);
    fs.rmSync(path.join(target, MANAGED_RECORD));
    const result = diagnose(target);
    assert.equal(result.healthy, false);
  },
  "SCN-INT-DOGFOOD-005": (world) => {
    const target = replicateRepository(world);
    install(target);
    execFileSync("git", ["branch", "feature/merged"], { cwd: target });
    const worktree = path.join(target, ".worktrees", "merged");
    execFileSync("git", ["worktree", "add", "-q", worktree, "feature/merged"], {
      cwd: target,
    });
    const result = diagnose(target);
    assert.ok(result.worktrees);
    assert.equal(result.worktrees.cleanupReadyCount >= 0, true);
    assert.equal(fs.existsSync(worktree), true);
  },
  "SCN-INT-DOGFOOD-006": (world) => {
    const target = replicateRepository(world);
    install(target);
    execFileSync("git", ["branch", "feature/merged"], { cwd: target });
    const worktree = path.join(target, ".worktrees", "merged");
    execFileSync("git", ["worktree", "add", "-q", worktree, "feature/merged"], {
      cwd: target,
    });
    const marker = path.join(worktree, "READY.txt");
    fs.writeFileSync(marker, "keep\n");
    diagnose(target);
    diagnose(target);
    assert.equal(fs.existsSync(marker), true);
    assert.equal(fs.existsSync(worktree), true);
  },
};

Given("dogfooding lifecycle検査の準備がある", function () {
  this.value = undefined;
});

When(
  "{string}のdogfooding lifecycle検査を実行する",
  function (scenario: string) {
    const check = CHECKS[scenario];
    if (!check) return;
    check(this);
    this.validationOutcome = { valid: true };
  },
);

Then("dogfooding lifecycle検査は期待結果になる", function () {
  assert.equal(this.validationOutcome?.valid, true);
});
