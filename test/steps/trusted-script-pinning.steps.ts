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
  "SCN-INT-SCRIPTPIN-003": (world) => {
    const root = replicate(world);
    /**
     * `project`は固定集合に無いが、固定済み`project:quality`の診断文に部分文字列として
     * 現れる。**部分一致で帰属させると見逃す。**
     */
    fs.appendFileSync(
      path.join(root, ".github/workflows/ci.yml"),
      "      - name: 固定済みscriptの接頭辞を呼ぶ\n        run: npm run project\n",
    );
    execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
    const errors = checkTrustedScriptPinning(root);
    assert.ok(
      errors.some((entry) => entry.includes("呼ぶprojectが")),
      `接頭辞が一致する未固定scriptを見逃しています: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-SCRIPTPIN-004": (world) => {
    const root = replicate(world);
    /** commentと`echo`の引数を参照と誤認しないこと。 */
    fs.appendFileSync(
      path.join(root, ".github/workflows/ci.yml"),
      [
        "      # npm run nonexistent:gate",
        '      - run: echo "npm run another:gate"',
        "",
      ].join("\n"),
    );
    execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
    assert.deepEqual(checkTrustedScriptPinning(root), []);
  },
  "SCN-INT-SCRIPTPIN-005": (world) => {
    const root = replicate(world);
    /**
     * **判定不能を合格へ倒さない。** 参照を1件も抽出できない状態は、固定漏れが無いことでは
     * なく、抽出が働いていないことを意味する。
     */
    for (const workflow of fs.readdirSync(path.join(root, ".github/workflows")))
      fs.writeFileSync(
        path.join(root, ".github/workflows", workflow),
        "on: push\njobs: {}\n",
      );
    execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
    assert.deepEqual(checkTrustedScriptPinning(root), [
      "保護workflowがnpm scriptを1件も参照していません",
    ]);
  },
  "SCN-INT-SCRIPTPIN-006": (world) => {
    /**
     * 保護workflowは残したまま、gitのmetadataだけを失わせる。**参照は抽出できるが候補tree
     * を作れない状態**で、合格ではなく判定不能として拒否することを要求する。
     */
    const root = world.temp("asc-scriptpin-nogit-");
    const source = path.join(process.cwd(), ".github/workflows");
    fs.mkdirSync(path.join(root, ".github/workflows"), { recursive: true });
    for (const workflow of fs.readdirSync(source))
      fs.copyFileSync(
        path.join(source, workflow),
        path.join(root, ".github/workflows", workflow),
      );
    assert.deepEqual(checkTrustedScriptPinning(root), [
      "script固定を判定できません: 追跡fileを列挙できません",
    ]);
  },
  "SCN-INT-SCRIPTPIN-007": (world) => {
    /**
     * **引用符付きの参照を抽出できないと、固定漏れが検出されないまま合格になる。**
     * 単一引用符と二重引用符のそれぞれについて、未固定のscript名を名指しで拒否する
     * ことを要求する。`workflow:check`は固定集合に無い。
     */
    for (const invocation of [
      "npm run 'workflow:check'",
      'npm run-script "workflow:check"',
    ]) {
      const root = replicate(world);
      fs.appendFileSync(
        path.join(root, ".github/workflows/ci.yml"),
        `      - name: 引用符で未固定scriptを呼ぶ\n        run: ${invocation}\n`,
      );
      execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
      const errors = checkTrustedScriptPinning(root);
      assert.ok(
        errors.some((entry) => entry.includes("workflow:check")),
        `引用符付きの参照を抽出できていません: ${invocation} / ${errors.join(" | ")}`,
      );
    }
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
