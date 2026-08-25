import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  planAutoRelease,
  validateReleaseWorkflow,
  type AutoReleaseInput,
  type AutoReleasePlan,
} from "../../src/domain/release.js";
import { isPackageVersion, PACKAGE_VERSION } from "../../src/lib/version.js";
import { planAutoReleaseFromEnvironment } from "../../scripts/plan_release.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

function autoReleaseInput(
  overrides: Partial<AutoReleaseInput> = {},
): AutoReleaseInput {
  return {
    currentVersion: "0.3.1-beta.1",
    existingTags: [],
    changedPaths: ["src/domain/release.ts"],
    headCommitMessage: "Merge pull request #861",
    ref: "main",
    defaultBranch: "main",
    ...overrides,
  };
}

type WorkflowValidation = ReturnType<typeof validateReleaseWorkflow>;

class AutoReleaseWorld extends WorkflowWorld {
  autoInput: unknown = undefined;
  autoInputs: unknown[] = [];
  autoPlan: AutoReleasePlan | undefined = undefined;
  autoPlans: AutoReleasePlan[] = [];
  autoWorkflowYaml = "";
  autoWorkflowValidation: WorkflowValidation | undefined = undefined;
  entrypointInputs: AutoReleaseInput[] = [];
  entrypointPlans: AutoReleasePlan[] = [];
  fallbackEntrypointPlan: AutoReleasePlan | undefined = undefined;
}

const { Given, When, Then } = stepDefinitions<AutoReleaseWorld>();

Given("release対象pathを変更した自動release入力がある", function () {
  this.autoInput = autoReleaseInput();
});

Given("文書とtestとworkflowだけを変更した自動release入力がある", function () {
  this.autoInput = autoReleaseInput({
    changedPaths: [
      "docs/specs/12_運用保守/00_運用設計.md",
      "memo/release.md",
      "test/features/unit/auto-release.feature",
      ".github/workflows/release.yml",
    ],
  });
});

Given("skip ciを含む自動release入力がある", function () {
  this.autoInput = autoReleaseInput({
    headCommitMessage: "chore: bump version [skip ci]",
  });
});

Given("既定branch以外の自動release入力がある", function () {
  this.autoInput = autoReleaseInput({ ref: "feature/auto-release" });
});

Given("現在versionのtagが存在する自動release入力がある", function () {
  this.autoInput = autoReleaseInput({ existingTags: ["v0.3.1-beta.1"] });
});

Given("prereleaseと通常versionと解決不能versionの衝突入力がある", function () {
  this.autoInputs = [
    autoReleaseInput({
      currentVersion: "0.3.1-beta.9",
      existingTags: ["v0.3.1-beta.9"],
    }),
    autoReleaseInput({
      currentVersion: "0.3.9",
      existingTags: ["v0.3.9"],
    }),
    autoReleaseInput({
      currentVersion: "0.3.1-beta",
      existingTags: ["v0.3.1-beta"],
    }),
  ];
});

When("自動release計画を作成する", function () {
  this.autoPlan = planAutoRelease(this.autoInput);
});

When("衝突した自動release計画を作成する", function () {
  this.autoPlans = this.autoInputs.map(planAutoRelease);
});

Then("自動release計画は現在versionのreleaseへ進む", function () {
  assert.equal(this.autoPlan?.state, "release");
  assert.equal(this.autoPlan.version, "0.3.1-beta.1");
  assert.equal(this.autoPlan.tag, "v0.3.1-beta.1");
  assert.equal(this.autoPlan.needsVersionBump, false);
});

Then("自動release計画は対象pathなしを理由に停止する", function () {
  assert.equal(this.autoPlan?.state, "skipped");
  assert.match(this.autoPlan.reasons.join(" "), /release対象path/u);
});

Then("自動release計画は再帰防止を理由に停止する", function () {
  assert.equal(this.autoPlan?.state, "skipped");
  assert.match(this.autoPlan.reasons.join(" "), /\[skip ci\].*再帰/u);
});

Then("自動release計画はbranch不一致を理由に停止する", function () {
  assert.equal(this.autoPlan?.state, "skipped");
  assert.match(this.autoPlan.reasons.join(" "), /既定branch/u);
});

Then("自動release計画は次のprereleaseへbumpしてからreleaseする", function () {
  assert.equal(this.autoPlan?.state, "bump-then-release");
  assert.equal(this.autoPlan.version, "0.3.1-beta.2");
  assert.equal(this.autoPlan.tag, "v0.3.1-beta.2");
  assert.equal(this.autoPlan.needsVersionBump, true);
});

Given(
  "自動release entrypoint用の対象・非対象・再帰・tag衝突入力がある",
  function () {
    this.entrypointInputs = [
      autoReleaseInput(),
      autoReleaseInput({ changedPaths: ["docs/specs/README.md"] }),
      autoReleaseInput({ headCommitMessage: "version bump [skip ci]" }),
      autoReleaseInput({ existingTags: ["v0.3.1-beta.1"] }),
    ];
  },
);

When("自動release entrypointを入力ごとに実行する", function () {
  this.entrypointPlans = this.entrypointInputs.map((input) => {
    const fixtureDirectory = this.temp("asc-auto-release-");
    const tagsFile = path.join(fixtureDirectory, "tags.txt");
    const pathsFile = path.join(fixtureDirectory, "paths.txt");
    fs.writeFileSync(tagsFile, `${input.existingTags.join("\n")}\n`);
    fs.writeFileSync(pathsFile, `${input.changedPaths.join("\n")}\n`);
    return planAutoReleaseFromEnvironment({
      RELEASE_MODE: "auto",
      RELEASE_CURRENT_VERSION: input.currentVersion,
      RELEASE_EXISTING_TAGS_FILE: tagsFile,
      RELEASE_CHANGED_PATHS_FILE: pathsFile,
      RELEASE_HEAD_COMMIT_MESSAGE: input.headCommitMessage,
      RELEASE_REF: input.ref,
      RELEASE_DEFAULT_BRANCH: input.defaultBranch,
    });
  });
});

Then("entrypointはreleaseと停止とbumpを外部更新なしで返す", function () {
  assert.deepEqual(
    this.entrypointPlans.map(({ state }) => state),
    ["release", "skipped", "skipped", "bump-then-release"],
  );
  assert.match(this.entrypointPlans[1]?.reasons.join(" ") ?? "", /対象path/u);
  assert.match(this.entrypointPlans[2]?.reasons.join(" ") ?? "", /再帰/u);
  assert.equal(this.entrypointPlans[3]?.version, "0.3.1-beta.2");
});

Given("現在versionを省略した自動release entrypoint入力がある", function () {
  this.autoInput = autoReleaseInput({ currentVersion: PACKAGE_VERSION });
});

When("現在versionを省略して自動release entrypointを実行する", function () {
  const input = this.autoInput as AutoReleaseInput;
  const fixtureDirectory = this.temp("asc-auto-release-fallback-");
  const tagsFile = path.join(fixtureDirectory, "tags.txt");
  const pathsFile = path.join(fixtureDirectory, "paths.txt");
  fs.writeFileSync(tagsFile, `${input.existingTags.join("\n")}\n`);
  fs.writeFileSync(pathsFile, `${input.changedPaths.join("\n")}\n`);
  this.fallbackEntrypointPlan = planAutoReleaseFromEnvironment({
    RELEASE_MODE: "auto",
    RELEASE_EXISTING_TAGS_FILE: tagsFile,
    RELEASE_CHANGED_PATHS_FILE: pathsFile,
    RELEASE_HEAD_COMMIT_MESSAGE: input.headCommitMessage,
    RELEASE_REF: input.ref,
    RELEASE_DEFAULT_BRANCH: input.defaultBranch,
  });
});

Then("entrypointはpackage.jsonのversionを使用する", function () {
  assert.equal(this.fallbackEntrypointPlan?.state, "release");
  assert.equal(this.fallbackEntrypointPlan.version, PACKAGE_VERSION);
  assert.equal(this.fallbackEntrypointPlan.tag, `v${PACKAGE_VERSION}`);
});

Then(
  "解決可能なversionは0.3.x内でbumpし解決不能なversionは停止する",
  function () {
    assert.equal(this.autoPlans.length, 3);
    assert.equal(this.autoPlans[0]?.version, "0.3.1-beta.10");
    assert.equal(this.autoPlans[1]?.version, "0.3.10");
    for (const plan of this.autoPlans.slice(0, 2)) {
      assert.equal(plan.state, "bump-then-release");
      assert.equal(isPackageVersion(plan.version), true);
      assert.match(plan.version, /^0\.3\./u);
    }
    assert.equal(this.autoPlans[2]?.state, "skipped");
    assert.match(this.autoPlans[2]?.reasons.join(" ") ?? "", /bump/u);
  },
);

Given("自動release用の実workflow本文を読み込む", function () {
  this.autoWorkflowYaml = fs.readFileSync(
    path.resolve(".github", "workflows", "release.yml"),
    "utf8",
  );
});

Given("無条件main pushと自動npm公開を含むworkflow本文がある", function () {
  this.autoWorkflowYaml = `name: 危険な自動release\n\n"on":\n  push:\n    branches: [main]\n  workflow_dispatch:\n    inputs:\n      dry_run:\n        default: true\n      publish_npm:\n        default: false\n\npermissions:\n  contents: read\n\njobs:\n  release:\n    steps:\n      - name: 品質検証\n        run: npm run prepack\n      - name: npmを自動公開する\n        run: npm publish\n`;
});

When("自動release workflow契約を検証する", function () {
  this.autoWorkflowValidation = validateReleaseWorkflow(this.autoWorkflowYaml);
});

Then("自動release workflow検証は有効になる", function () {
  assert.equal(this.autoWorkflowValidation?.valid, true);
  assert.deepEqual(this.autoWorkflowValidation?.errors, []);
});

Then("自動release workflow検証はpathsとnpm条件を根拠に拒否する", function () {
  assert.equal(this.autoWorkflowValidation?.valid, false);
  assert.match(this.autoWorkflowValidation?.errors.join(" ") ?? "", /paths/u);
  assert.match(
    this.autoWorkflowValidation?.errors.join(" ") ?? "",
    /npm.*workflow_dispatch/u,
  );
});
