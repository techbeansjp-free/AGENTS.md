import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  planRelease,
  summarizeReleaseOutcome,
  validateReleaseWorkflow,
  type ReleaseOutcome,
  type ReleasePlan,
  type ReleasePlanInput,
} from "../../src/domain/release.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

const REQUIRED_GATES = [
  "quality",
  "build",
  "package",
  "test",
  "typecheck",
] as const;

function releaseInput(
  overrides: Partial<ReleasePlanInput> = {},
): ReleasePlanInput {
  return {
    currentVersion: "0.3.1-beta.1",
    requestedVersion: "0.3.1",
    dryRun: false,
    publishNpm: false,
    actor: "release-operator",
    ref: "main",
    refSha: "0123456789abcdef0123456789abcdef01234567",
    defaultBranch: "main",
    existingTags: [],
    gates: REQUIRED_GATES.map((name) => ({ name, passed: true })),
    ...overrides,
  };
}

type ReleaseSummary = ReturnType<typeof summarizeReleaseOutcome>;
type WorkflowValidation = ReturnType<typeof validateReleaseWorkflow>;

class ReleaseWorld extends WorkflowWorld {
  planInput: unknown = undefined;
  plan: ReleasePlan | undefined = undefined;
  plans: ReleasePlan[] = [];
  planInputs: unknown[] = [];
  outcomes: unknown = undefined;
  publishedOutcomes: unknown = undefined;
  summary: ReleaseSummary | undefined = undefined;
  publishedSummary: ReleaseSummary | undefined = undefined;
  workflowYaml = "";
  workflowValidation: WorkflowValidation | undefined = undefined;
}

const { Given, When, Then } = stepDefinitions<ReleaseWorld>();

Given("release可能な入力でdry-runを有効にする", function () {
  this.planInput = releaseInput({ dryRun: true, publishNpm: true });
});

When("release計画を作成する", function () {
  this.plan = planRelease(this.planInput);
});

Then("release計画はdry-runになる", function () {
  assert.equal(this.plan?.state, "dry-run");
});

Then("検証以外のstageはdry-runを理由に無効になる", function () {
  assert.ok(this.plan);
  assert.equal(
    this.plan.stages.find(({ stage }) => stage === "validate")?.enabled,
    true,
  );
  for (const stage of this.plan.stages.filter(
    ({ stage }) => stage !== "validate",
  )) {
    assert.equal(stage.enabled, false);
    assert.match(stage.reason, /dry-runのため外部更新しない/u);
  }
});

Given("現在以下または同じ優先順位のversionを指定する", function () {
  this.planInputs = [
    releaseInput({ requestedVersion: "0.3.1-beta.1" }),
    releaseInput({ requestedVersion: "0.3.1-alpha.10" }),
    releaseInput({
      currentVersion: "0.3.1-alpha.10",
      requestedVersion: "0.3.1-alpha.2",
    }),
    releaseInput({ requestedVersion: "0.3.1-beta.1+build.2" }),
  ];
});

When("単調増加しないrelease計画を作成する", function () {
  this.plans = this.planInputs.map(planRelease);
});

Then("すべてのrelease計画はversionを根拠に拒否される", function () {
  assert.ok(this.plans.length > 0);
  for (const plan of this.plans) {
    assert.equal(plan.state, "rejected");
    assert.match(plan.reasons.join(" "), /version.*単調増加/iu);
  }
});

Given("作成予定tagが既に存在する", function () {
  this.planInput = releaseInput({ existingTags: ["v0.3.1"] });
});

Then("release計画はtag重複を根拠に拒否される", function () {
  assert.equal(this.plan?.state, "rejected");
  assert.match(this.plan?.reasons.join(" ") ?? "", /tag.*既に存在/u);
});

Given("release対象refが既定branchと異なる", function () {
  this.planInput = releaseInput({ ref: "feature/release" });
});

Then("release計画はbranch不一致を根拠に拒否される", function () {
  assert.equal(this.plan?.state, "rejected");
  assert.match(this.plan?.reasons.join(" ") ?? "", /既定branch/u);
});

Given("必須gateが欠落した入力と失敗した入力を用意する", function () {
  this.planInputs = [
    releaseInput({ gates: [{ name: "quality", passed: true }] }),
    releaseInput({
      gates: REQUIRED_GATES.map((name) => ({
        name,
        passed: name !== "package",
      })),
    }),
  ];
});

When("不完全なgateのrelease計画を作成する", function () {
  this.plans = this.planInputs.map(planRelease);
});

Then("すべてのrelease計画はgateを根拠に拒否される", function () {
  assert.equal(this.plans.length, 2);
  for (const plan of this.plans) {
    assert.equal(plan.state, "rejected");
    assert.match(plan.reasons.join(" "), /gate/u);
  }
});

Given("npm公開の無効入力と有効入力を用意する", function () {
  this.planInputs = [
    releaseInput({
      currentVersion: "0.3.1-alpha.2",
      requestedVersion: "0.3.1-alpha.10",
      publishNpm: false,
    }),
    releaseInput({
      currentVersion: "0.3.1-alpha.2",
      requestedVersion: "0.3.1-alpha.10",
      publishNpm: true,
    }),
  ];
});

When("npm公開条件ごとのrelease計画を作成する", function () {
  this.plans = this.planInputs.map(planRelease);
});

Then("明示入力がある計画だけnpm公開stageが有効になる", function () {
  assert.equal(this.plans.length, 2);
  assert.equal(this.plans[0]?.state, "ready");
  assert.equal(this.plans[1]?.state, "ready");
  assert.equal(
    this.plans[0]?.stages.find(({ stage }) => stage === "npm_publish")?.enabled,
    false,
  );
  assert.equal(
    this.plans[1]?.stages.find(({ stage }) => stage === "npm_publish")?.enabled,
    true,
  );
});

Given("tag成功後にGitHub Releaseが失敗した操作結果がある", function () {
  const outcomes: ReleaseOutcome[] = [
    { stage: "validate", state: "succeeded", detail: "品質gate合格" },
    { stage: "tag", state: "succeeded", detail: "tag作成済み" },
    {
      stage: "github_release",
      state: "failed",
      detail: "GitHub API失敗",
    },
    {
      stage: "npm_publish",
      state: "skipped",
      detail: "先行stage失敗のため未実行",
    },
  ];
  this.outcomes = outcomes;
  this.publishedOutcomes = [
    ...outcomes.slice(0, 2),
    outcomes[2],
    {
      stage: "npm_publish",
      state: "succeeded",
      detail: "公開済みfixture",
    },
  ];
});

When("release操作結果を集約する", function () {
  this.summary = summarizeReleaseOutcome(this.outcomes);
  this.publishedSummary = summarizeReleaseOutcome(this.publishedOutcomes);
});

Then("結果は部分成功として完了stageと未完了stageを分離する", function () {
  assert.equal(this.summary?.state, "partial");
  assert.deepEqual(this.summary?.completed, ["validate", "tag"]);
  assert.deepEqual(this.summary?.pending, ["github_release"]);
});

Then("外部更新済み状態ごとの日本語復旧手順を返す", function () {
  assert.match(this.summary?.recovery.join(" ") ?? "", /tag.*削除/u);
  assert.match(
    this.publishedSummary?.recovery.join(" ") ?? "",
    /npm.*deprecate/u,
  );
});

Given("不正なversion形式と不正なSHAの入力を用意する", function () {
  this.planInputs = [
    releaseInput({ requestedVersion: "0.3.01" }),
    releaseInput({ refSha: "abc123" }),
  ];
});

When("不正入力のrelease計画を作成する", function () {
  this.plans = this.planInputs.map(planRelease);
});

Then("すべてのrelease計画は具体的な入力根拠で拒否される", function () {
  assert.equal(this.plans.length, 2);
  assert.equal(this.plans[0]?.state, "rejected");
  assert.match(this.plans[0]?.reasons.join(" ") ?? "", /version形式/u);
  assert.equal(this.plans[1]?.state, "rejected");
  assert.match(this.plans[1]?.reasons.join(" ") ?? "", /40桁hex/u);
});

Given("実release workflowのYAML本文を読み込む", function () {
  this.workflowYaml = fs.readFileSync(
    path.resolve(".github", "workflows", "release.yml"),
    "utf8",
  );
});

Given("通常push triggerと秘密値出力を含むworkflow本文がある", function () {
  this.workflowYaml = `name: 危険なrelease\n\n"on":\n  workflow_dispatch:\n    inputs:\n      dry_run:\n        default: true\n      publish_npm:\n        default: false\n  push:\n\npermissions:\n  contents: write\n\njobs:\n  release:\n    steps:\n      - name: 日本語の危険な出力\n        run: echo "\${{ secrets.NPM_TOKEN }}"\n      - name: 品質検証\n        run: npm run prepack\n`;
});

When("release workflow契約を検証する", function () {
  this.workflowValidation = validateReleaseWorkflow(this.workflowYaml);
});

Then("workflow検証は有効で必須checkをすべて記録する", function () {
  assert.equal(this.workflowValidation?.valid, true);
  assert.deepEqual(this.workflowValidation?.errors, []);
  assert.ok((this.workflowValidation?.checks.length ?? 0) >= 7);
});

Then("workflow検証はtriggerと秘密値出力を根拠に拒否する", function () {
  assert.equal(this.workflowValidation?.valid, false);
  assert.match(this.workflowValidation?.errors.join(" ") ?? "", /push/u);
  assert.match(this.workflowValidation?.errors.join(" ") ?? "", /秘密/u);
});
