import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { checkTrustedScriptPinning } from "../../scripts/check_conformance.js";

const { Given, When, Then } = stepDefinitions<WorkflowWorld>();

/**
 * 追跡fileだけを複製し、独立したgit repositoryにする。
 *
 * 検査は`git ls-files`で候補treeを作るため、複製先もrepositoryである必要がある。
 */
function replicate(world: WorkflowWorld): string {
  const source = process.cwd();
  const target = world.temp("asc-scriptpin-");
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: source,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((entry) => entry !== "");
  for (const relative of files) {
    const destination = path.join(target, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(source, relative), destination);
  }
  for (const args of [
    ["init", "-q"],
    ["config", "user.email", "fixture@example.com"],
    ["config", "user.name", "fixture"],
    ["add", "-A"],
  ])
    execFileSync("git", args, { cwd: target, stdio: "ignore" });
  return target;
}

const CHECKS: Readonly<Record<string, (world: WorkflowWorld) => void>> = {
  "SCN-INT-SCRIPTPIN-001": () => {
    assert.deepEqual(checkTrustedScriptPinning(process.cwd()), []);
  },
  "SCN-INT-SCRIPTPIN-002": (world) => {
    const root = replicate(world);
    /**
     * `workflow:check`は`EXPECTED_SCRIPTS`に無い。**保護workflowから参照させると、
     * 候補がその値を差し替えても既定branch側validatorが拒否できない状態になる。**
     */
    const workflow = path.join(root, ".github/workflows/ci.yml");
    fs.appendFileSync(
      workflow,
      "      - name: 固定されていないscriptを呼ぶ\n        run: npm run workflow:check\n",
    );
    execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
    const errors = checkTrustedScriptPinning(root);
    assert.ok(
      errors.some((entry) => entry.includes("workflow:check")),
      `未固定の参照を検出していません: ${errors.join(" | ")}`,
    );
  },
};

Given("script固定検査の準備がある", function (this: WorkflowWorld) {
  this.value = undefined;
});

When(
  "{string}のscript固定検査を実行する",
  function (this: WorkflowWorld, id: string) {
    const check = CHECKS[id];
    assert.ok(check, `未知のscript固定検査です: ${id}`);
    check(this);
  },
);

Then("script固定検査は期待結果になる", function () {
  assert.ok(true);
});
