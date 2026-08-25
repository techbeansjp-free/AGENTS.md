import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  computeDistributionDigest,
  normalizeDistributionContent,
  planAutoRelease,
  validateReleaseWorkflow,
  type AutoReleaseInput,
  type AutoReleasePlan,
  type DistributionDigest,
} from "../../src/domain/release.js";
import { isPackageVersion, PACKAGE_VERSION } from "../../src/lib/version.js";
import { planAutoReleaseFromEnvironment } from "../../scripts/plan_release.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);

function autoReleaseInput(
  overrides: Partial<AutoReleaseInput> = {},
): AutoReleaseInput {
  return {
    currentVersion: "0.3.1-beta.1",
    existingTags: [],
    distributionDigest: DIGEST_A,
    previousDistributionDigest: DIGEST_B,
    headCommitMessage: "Merge pull request #879",
    ref: "main",
    defaultBranch: "main",
    ...overrides,
  };
}

function writeDigestFile(file: string, digest: string): void {
  fs.writeFileSync(
    file,
    `${JSON.stringify({ digest, entryCount: digest.length > 0 ? 1 : 0, errors: [] })}\n`,
  );
}

function fixturePackage(
  directory: string,
  options: { dist?: boolean; readme?: boolean; extra?: boolean } = {},
): void {
  const includeDist = options.dist !== false;
  const includeReadme = options.readme !== false;
  const files = ["dist/"];
  if (includeReadme) files.push("README.md");
  fs.writeFileSync(
    path.join(directory, "package.json"),
    `${JSON.stringify({ name: "distribution-digest-fixture", version: "1.0.0", files }, null, 2)}\n`,
  );
  if (includeDist) {
    fs.mkdirSync(path.join(directory, "dist"), { recursive: true });
    fs.writeFileSync(path.join(directory, "dist", "index.js"), "export {};\n");
  }
  if (includeReadme)
    fs.writeFileSync(path.join(directory, "README.md"), "# fixture\n");
  if (options.extra)
    fs.writeFileSync(path.join(directory, "extra.txt"), "extra\n");
}

function runDigestCli(
  target: string,
  useCwdOption: boolean,
): { status: number | null; stdout: string; stderr: string } {
  const script = path.resolve("scripts", "compute_distribution_digest.ts");
  const tsxLoader = path.resolve("node_modules", "tsx", "dist", "loader.mjs");
  const args = ["--import", tsxLoader, script];
  if (useCwdOption) args.push("--cwd", target);
  const result = spawnSync(process.execPath, args, {
    cwd: useCwdOption ? path.resolve(".") : target,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: path.join(os.tmpdir(), "asc-issue-879-npm-cache"),
    },
  });
  return {
    status: result.status,
    stdout: String(result.stdout),
    stderr: result.error
      ? `${String(result.stderr)}${result.error.message}`
      : String(result.stderr),
  };
}

function successfulDigest(target: string): DistributionDigest {
  const result = runDigestCli(target, true);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as DistributionDigest;
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
  distributionInputs: unknown[] = [];
  distributionResults: DistributionDigest[] = [];
  normalizationPath = "";
  normalizationInputs: string[] = [];
  normalizationResults: string[] = [];
  fixtureDirectory = "";
  digestProcess:
    { status: number | null; stdout: string; stderr: string } | undefined =
    undefined;
  beforeDigest: DistributionDigest | undefined = undefined;
  afterDigest: DistributionDigest | undefined = undefined;
}

const { Given, When, Then } = stepDefinitions<AutoReleaseWorld>();

Given("release対象の現在tagが未存在な自動release入力がある", function () {
  this.autoInput = autoReleaseInput();
});

Given(
  "現在tagが存在して配布digestが一致する自動release入力がある",
  function () {
    this.autoInput = autoReleaseInput({
      existingTags: ["v0.3.1-beta.1"],
      previousDistributionDigest: DIGEST_A,
    });
  },
);

Given("skip ciを含む自動release入力がある", function () {
  this.autoInput = autoReleaseInput({
    existingTags: ["v0.3.1-beta.1"],
    headCommitMessage: "chore: bump version [skip ci]",
  });
});

Given("既定branch以外の自動release入力がある", function () {
  this.autoInput = autoReleaseInput({ ref: "feature/auto-release" });
});

Given("現在tagが存在して配布digestが異なる自動release入力がある", function () {
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

Then("自動release計画は配布物同一を理由に停止する", function () {
  assert.equal(this.autoPlan?.state, "skipped");
  assert.match(this.autoPlan.reasons.join(" "), /配布物.*同一/u);
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
  "自動release entrypoint用の未release・同一・再帰・配布差分入力がある",
  function () {
    this.entrypointInputs = [
      autoReleaseInput(),
      autoReleaseInput({
        existingTags: ["v0.3.1-beta.1"],
        previousDistributionDigest: DIGEST_A,
      }),
      autoReleaseInput({
        existingTags: ["v0.3.1-beta.1"],
        headCommitMessage: "version bump [skip ci]",
      }),
      autoReleaseInput({ existingTags: ["v0.3.1-beta.1"] }),
    ];
  },
);

When("自動release entrypointを入力ごとに実行する", function () {
  this.entrypointPlans = this.entrypointInputs.map((input) => {
    const fixtureDirectory = this.temp("asc-auto-release-");
    const tagsFile = path.join(fixtureDirectory, "tags.txt");
    const digestFile = path.join(fixtureDirectory, "digest.json");
    const previousDigestFile = path.join(
      fixtureDirectory,
      "previous-digest.json",
    );
    fs.writeFileSync(tagsFile, `${input.existingTags.join("\n")}\n`);
    writeDigestFile(digestFile, input.distributionDigest);
    writeDigestFile(previousDigestFile, input.previousDistributionDigest);
    return planAutoReleaseFromEnvironment({
      RELEASE_MODE: "auto",
      RELEASE_CURRENT_VERSION: input.currentVersion,
      RELEASE_EXISTING_TAGS_FILE: tagsFile,
      RELEASE_DISTRIBUTION_DIGEST_FILE: digestFile,
      RELEASE_PREVIOUS_DISTRIBUTION_DIGEST_FILE: previousDigestFile,
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
  assert.match(this.entrypointPlans[1]?.reasons.join(" ") ?? "", /配布物/u);
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
  const digestFile = path.join(fixtureDirectory, "digest.json");
  const previousDigestFile = path.join(
    fixtureDirectory,
    "previous-digest.json",
  );
  fs.writeFileSync(tagsFile, `${input.existingTags.join("\n")}\n`);
  writeDigestFile(digestFile, input.distributionDigest);
  writeDigestFile(previousDigestFile, input.previousDistributionDigest);
  this.fallbackEntrypointPlan = planAutoReleaseFromEnvironment({
    RELEASE_MODE: "auto",
    RELEASE_EXISTING_TAGS_FILE: tagsFile,
    RELEASE_DISTRIBUTION_DIGEST_FILE: digestFile,
    RELEASE_PREVIOUS_DISTRIBUTION_DIGEST_FILE: previousDigestFile,
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

Given("現在tagが存在する自動release entrypoint入力がある", function () {
  this.autoInput = autoReleaseInput({ existingTags: ["v0.3.1-beta.1"] });
});

When(
  "欠落した現在digest fileと壊れた前回digest fileでentrypointを実行する",
  function () {
    const input = this.autoInput as AutoReleaseInput;
    const fixtureDirectory = this.temp("asc-auto-release-invalid-digest-");
    const tagsFile = path.join(fixtureDirectory, "tags.txt");
    const missingDigestFile = path.join(fixtureDirectory, "missing.json");
    const currentDigestFile = path.join(fixtureDirectory, "current.json");
    const brokenDigestFile = path.join(fixtureDirectory, "broken.json");
    fs.writeFileSync(tagsFile, `${input.existingTags.join("\n")}\n`);
    writeDigestFile(currentDigestFile, input.distributionDigest);
    fs.writeFileSync(brokenDigestFile, "{broken");
    const environment = {
      RELEASE_MODE: "auto",
      RELEASE_CURRENT_VERSION: input.currentVersion,
      RELEASE_EXISTING_TAGS_FILE: tagsFile,
      RELEASE_HEAD_COMMIT_MESSAGE: input.headCommitMessage,
      RELEASE_REF: input.ref,
      RELEASE_DEFAULT_BRANCH: input.defaultBranch,
    };
    this.entrypointPlans = [
      planAutoReleaseFromEnvironment({
        ...environment,
        RELEASE_DISTRIBUTION_DIGEST_FILE: missingDigestFile,
        RELEASE_PREVIOUS_DISTRIBUTION_DIGEST_FILE: brokenDigestFile,
      }),
      planAutoReleaseFromEnvironment({
        ...environment,
        RELEASE_DISTRIBUTION_DIGEST_FILE: currentDigestFile,
        RELEASE_PREVIOUS_DISTRIBUTION_DIGEST_FILE: brokenDigestFile,
      }),
    ];
  },
);

Then("欠落した現在digestは停止し壊れた前回digestはfail-openする", function () {
  assert.deepEqual(
    this.entrypointPlans.map(({ state }) => state),
    ["skipped", "bump-then-release"],
  );
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

Given("入力順だけが異なる同じ配布entry集合がある", function () {
  const entries = [
    { path: "z.txt", contentHash: DIGEST_A },
    { path: "あ.txt", contentHash: DIGEST_B },
    { path: "a.txt", contentHash: DIGEST_C },
  ];
  this.distributionInputs = [entries, [...entries].reverse()];
});

Given("contentHashが1件だけ異なる配布entry集合がある", function () {
  this.distributionInputs = [
    [{ path: "a.txt", contentHash: DIGEST_A }],
    [{ path: "a.txt", contentHash: DIGEST_B }],
  ];
});

Given("pathが重複する配布entry集合がある", function () {
  this.distributionInputs = [
    [
      { path: "a.txt", contentHash: DIGEST_A },
      { path: "a.txt", contentHash: DIGEST_B },
    ],
  ];
});

Given("空の配布entry集合がある", function () {
  this.distributionInputs = [[]];
});

Given("不正なcontentHashを持つ配布entry集合がある", function () {
  this.distributionInputs = [
    [{ path: "a.txt", contentHash: DIGEST_A.toUpperCase() }],
  ];
});

When("配布digestをそれぞれ算出する", function () {
  this.distributionResults = this.distributionInputs.map(
    computeDistributionDigest,
  );
});

When("配布digestを算出する", function () {
  this.distributionResults = [
    computeDistributionDigest(this.distributionInputs[0]),
  ];
});

Then("配布digestとentry件数は同じになる", function () {
  assert.match(this.distributionResults[0]?.digest ?? "", /^[0-9a-f]{64}$/u);
  assert.equal(
    this.distributionResults[0]?.digest,
    this.distributionResults[1]?.digest,
  );
  assert.equal(this.distributionResults[0]?.entryCount, 3);
  assert.equal(this.distributionResults[1]?.entryCount, 3);
});

Then("配布digestは異なる", function () {
  assert.notEqual(
    this.distributionResults[0]?.digest,
    this.distributionResults[1]?.digest,
  );
});

Then("配布digestは空で重複errorを返す", function () {
  assert.equal(this.distributionResults[0]?.digest, "");
  assert.match(this.distributionResults[0]?.errors.join(" ") ?? "", /重複/u);
});

Then("配布digestは空で配布物空errorを返す", function () {
  assert.equal(this.distributionResults[0]?.digest, "");
  assert.match(this.distributionResults[0]?.errors.join(" ") ?? "", /0件|空/u);
});

Then("配布digestは空でcontentHash errorを返す", function () {
  assert.equal(this.distributionResults[0]?.digest, "");
  assert.match(
    this.distributionResults[0]?.errors.join(" ") ?? "",
    /contentHash/u,
  );
});

Given("versionだけが異なる二つのpackage.json内容がある", function () {
  this.normalizationPath = "package.json";
  this.normalizationInputs = [
    '{"name":"fixture","version":"1.0.0","files":["dist/"]}',
    '{"name":"fixture","version":"2.0.0","files":["dist/"]}',
  ];
});

Given("指定versionだけが異なる二つのpackage-lock.json内容がある", function () {
  this.normalizationPath = "package-lock.json";
  this.normalizationInputs = [
    '{"name":"fixture","version":"1.0.0","packages":{"":{"version":"1.0.0","license":"MIT"},"node_modules/a":{"version":"3.0.0"}}}',
    '{"name":"fixture","version":"2.0.0","packages":{"":{"version":"2.0.0","license":"MIT"},"node_modules/a":{"version":"3.0.0"}}}',
  ];
});

Given("version以外も異なる二つのpackage.json内容がある", function () {
  this.normalizationPath = "package.json";
  this.normalizationInputs = [
    '{"name":"fixture","version":"1.0.0"}',
    '{"name":"changed","version":"2.0.0"}',
  ];
});

Given("通常fileの配布内容がある", function () {
  this.normalizationPath = "README.md";
  this.normalizationInputs = ["# fixture\n\nversion: 1.0.0\n"];
});

Given("壊れたpackage.jsonの配布内容がある", function () {
  this.normalizationPath = "package.json";
  this.normalizationInputs = ['{"version":'];
});

When("二つの配布内容を正規化する", function () {
  this.normalizationResults = this.normalizationInputs.map((content) =>
    normalizeDistributionContent(this.normalizationPath, content),
  );
});

When("配布内容を正規化する", function () {
  this.normalizationResults = this.normalizationInputs.map((content) =>
    normalizeDistributionContent(this.normalizationPath, content),
  );
});

Then("二つの正規化結果は同じになる", function () {
  assert.equal(this.normalizationResults[0], this.normalizationResults[1]);
});

Then("二つの正規化結果は異なる", function () {
  assert.notEqual(this.normalizationResults[0], this.normalizationResults[1]);
});

Then("配布内容は変更されない", function () {
  assert.equal(this.normalizationResults[0], this.normalizationInputs[0]);
});

Given("currentTagが未存在で現在の配布digestが空の入力がある", function () {
  this.autoInput = autoReleaseInput({ distributionDigest: "" });
});

Given("現在tagが存在して前回配布digestが空の入力がある", function () {
  this.autoInput = autoReleaseInput({
    existingTags: ["v0.3.1-beta.1"],
    previousDistributionDigest: "",
  });
});

Given("現在tagが存在して現在の配布digestが空の入力がある", function () {
  this.autoInput = autoReleaseInput({
    existingTags: ["v0.3.1-beta.1"],
    distributionDigest: "",
  });
});

Given("現在tagが存在して現在の配布digest形式が不正な入力がある", function () {
  this.autoInput = autoReleaseInput({
    existingTags: ["v0.3.1-beta.1"],
    distributionDigest: "not-a-digest",
  });
});

Given("skip ciと不正な現在配布digestを含む自動release入力がある", function () {
  this.autoInput = autoReleaseInput({
    existingTags: ["v0.3.1-beta.1"],
    distributionDigest: "not-a-digest",
    headCommitMessage: "chore: bump [skip ci]",
  });
});

Given("未知fieldを含む自動release入力がある", function () {
  this.autoInput = { ...autoReleaseInput(), changedPaths: ["src/index.ts"] };
});

Then("自動release計画は前回tagを含む配布物同一理由で停止する", function () {
  assert.equal(this.autoPlan?.state, "skipped");
  assert.match(
    this.autoPlan.reasons.join(" "),
    /配布物.*v0\.3\.1-beta\.1.*同一/u,
  );
});

Then("自動release計画は現在digest算出不能を理由に停止する", function () {
  assert.equal(this.autoPlan?.state, "skipped");
  assert.match(this.autoPlan.reasons.join(" "), /現在の配布digest.*算出/u);
});

Then("自動release計画は未知fieldを理由に停止する", function () {
  assert.equal(this.autoPlan?.state, "skipped");
  assert.match(this.autoPlan.reasons.join(" "), /未知field/u);
});

Given("自動release用の実workflow本文を読み込む", function () {
  this.autoWorkflowYaml = fs.readFileSync(
    path.resolve(".github", "workflows", "release.yml"),
    "utf8",
  );
});

Given("audit:checkを含むbump経路のworkflow本文がある", function () {
  const workflow = fs.readFileSync(
    path.resolve(".github", "workflows", "release.yml"),
    "utf8",
  );
  const bumpStart = workflow.indexOf("\n  bump_version:");
  const bumpEnd = workflow.indexOf("\n  tag:", bumpStart);
  assert.ok(bumpStart >= 0);
  assert.ok(bumpEnd > bumpStart);
  const bumpJob = workflow.slice(bumpStart, bumpEnd);
  let unsafeBumpJob = bumpJob;
  if (!bumpJob.includes("npm run prepack")) {
    unsafeBumpJob = bumpJob.replace(
      "npm run package:check",
      "npm run audit:check\n          npm run package:check",
    );
    assert.notEqual(unsafeBumpJob, bumpJob);
  }
  this.autoWorkflowYaml = `${workflow.slice(0, bumpStart)}${unsafeBumpJob}${workflow.slice(bumpEnd)}`;
});

Given("無条件main pushと自動npm公開を含むworkflow本文がある", function () {
  this.autoWorkflowYaml = `name: 危険な自動release\n\n"on":\n  push:\n    branches: [main]\n  workflow_dispatch:\n    inputs:\n      dry_run:\n        default: true\n      publish_npm:\n        default: false\n\npermissions:\n  contents: read\n\njobs:\n  release:\n    steps:\n      - name: 品質検証\n        run: npm run prepack\n      - name: npmを自動公開する\n        run: npm publish\n`;
});

Given("push pathsを追加したrelease workflow本文がある", function () {
  this.autoWorkflowYaml = fs
    .readFileSync(path.resolve(".github", "workflows", "release.yml"), "utf8")
    .replace(
      "    branches: [main]",
      '    branches: [main]\n    paths: ["src/**"]',
    );
});

Given("digest算出stepを削除したrelease workflow本文がある", function () {
  this.autoWorkflowYaml = fs
    .readFileSync(path.resolve(".github", "workflows", "release.yml"), "utf8")
    .replaceAll(
      "scripts/compute_distribution_digest.ts",
      "scripts/omitted_digest.ts",
    );
});

When("自動release workflow契約を検証する", function () {
  this.autoWorkflowValidation = validateReleaseWorkflow(this.autoWorkflowYaml);
});

Then("自動release workflow検証は有効になる", function () {
  assert.equal(this.autoWorkflowValidation?.valid, true);
  assert.deepEqual(this.autoWorkflowValidation?.errors, []);
  assert.ok(
    this.autoWorkflowValidation?.checks.includes(
      "validate jobのnpm run prepackを確認した",
    ),
  );
  assert.ok(
    this.autoWorkflowValidation?.checks.includes(
      "bump_version jobがaudit:checkを含まないことを確認した",
    ),
  );
});

Then(
  "自動release workflow検証はdigest stepとnpm条件を根拠に拒否する",
  function () {
    assert.equal(this.autoWorkflowValidation?.valid, false);
    assert.match(
      this.autoWorkflowValidation?.errors.join(" ") ?? "",
      /digest/u,
    );
    assert.match(
      this.autoWorkflowValidation?.errors.join(" ") ?? "",
      /npm.*workflow_dispatch/u,
    );
  },
);

Then("自動release workflow検証はpush pathsを理由に拒否する", function () {
  assert.equal(this.autoWorkflowValidation?.valid, false);
  assert.match(
    this.autoWorkflowValidation?.errors.join(" ") ?? "",
    /push\.paths.*配布digest/u,
  );
});

Then("自動release workflow検証はdigest契約を満たす", function () {
  assert.equal(this.autoWorkflowValidation?.valid, true);
  assert.ok(
    this.autoWorkflowValidation?.checks.includes(
      "push pathsによる限定が無いことを確認した",
    ),
  );
  assert.ok(
    this.autoWorkflowValidation?.checks.includes(
      "validate jobの配布digest算出を確認した",
    ),
  );
});

Then("自動release workflow検証はdigest step欠落を理由に拒否する", function () {
  assert.equal(this.autoWorkflowValidation?.valid, false);
  assert.match(this.autoWorkflowValidation?.errors.join(" ") ?? "", /digest/u);
});

Then(
  "自動release workflow検証はbump経路のaudit:checkを根拠に拒否する",
  function () {
    assert.equal(this.autoWorkflowValidation?.valid, false);
    assert.match(
      this.autoWorkflowValidation?.errors.join(" ") ?? "",
      /bump_version.*audit:check/u,
    );
  },
);

Then("bump経路はaudit:check以外のrelease gateをすべて含む", function () {
  assert.equal(this.autoWorkflowValidation?.valid, true);
  const workflow = this.autoWorkflowYaml;
  const bumpStart = workflow.indexOf("\n  bump_version:");
  const bumpEnd = workflow.indexOf("\n  tag:", bumpStart);
  assert.ok(bumpStart >= 0);
  assert.ok(bumpEnd > bumpStart);
  const bumpJob = workflow.slice(bumpStart, bumpEnd);
  for (const command of [
    "npm run project:quality",
    "npm run quality",
    "npm run build",
    "npm run docs:format",
    "npm run test:format",
    "npm run trace:check",
    "npm run architecture:check",
    "npm run conformance:check",
    "npm run package:check",
  ]) {
    assert.ok(bumpJob.includes(command));
    const missingGateWorkflow = `${workflow.slice(0, bumpStart)}${bumpJob.replace(command, "npm run omitted:check")}${workflow.slice(bumpEnd)}`;
    assert.equal(validateReleaseWorkflow(missingGateWorkflow).valid, false);
  }
  assert.doesNotMatch(bumpJob, /npm run (?:prepack|audit:check)\b/u);
  const validateJob = workflow.slice(
    workflow.indexOf("\n  validate:"),
    workflow.indexOf("\n  bump_version:"),
  );
  assert.match(validateJob, /npm run prepack\b/u);
});

Given("distと配布fileを持つfixture packageがある", function () {
  this.fixtureDirectory = this.temp("asc-distribution-digest-");
  fixturePackage(this.fixtureDirectory);
});

Given("distが無いfixture packageがある", function () {
  this.fixtureDirectory = this.temp("asc-distribution-digest-no-dist-");
  fixturePackage(this.fixtureDirectory, { dist: false });
});

Given("READMEを配布するfixture packageがある", function () {
  this.fixtureDirectory = this.temp("asc-distribution-readme-");
  fixturePackage(this.fixtureDirectory);
});

Given("docs specsを配布しないfixture packageがある", function () {
  this.fixtureDirectory = this.temp("asc-distribution-docs-");
  fixturePackage(this.fixtureDirectory);
  fs.mkdirSync(path.join(this.fixtureDirectory, "docs", "specs"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(this.fixtureDirectory, "docs", "specs", "fixture.md"),
    "before\n",
  );
});

Given("追加可能な配布fileを持つfixture packageがある", function () {
  this.fixtureDirectory = this.temp("asc-distribution-files-");
  fixturePackage(this.fixtureDirectory, { extra: true });
});

When("fixture packageの配布digest CLIを実行する", function () {
  this.digestProcess = runDigestCli(this.fixtureDirectory, false);
});

When("repository rootからcwd optionで配布digest CLIを実行する", function () {
  this.digestProcess = runDigestCli(this.fixtureDirectory, true);
});

When("READMEだけを変更して前後の配布digestを算出する", function () {
  this.beforeDigest = successfulDigest(this.fixtureDirectory);
  fs.writeFileSync(
    path.join(this.fixtureDirectory, "README.md"),
    "# changed\n",
  );
  this.afterDigest = successfulDigest(this.fixtureDirectory);
});

When("docs specsだけを変更して前後の配布digestを算出する", function () {
  this.beforeDigest = successfulDigest(this.fixtureDirectory);
  fs.writeFileSync(
    path.join(this.fixtureDirectory, "docs", "specs", "fixture.md"),
    "after\n",
  );
  this.afterDigest = successfulDigest(this.fixtureDirectory);
});

When(
  "package filesへ配布対象を追加して前後の配布digestを算出する",
  function () {
    this.beforeDigest = successfulDigest(this.fixtureDirectory);
    const packageFile = path.join(this.fixtureDirectory, "package.json");
    const metadata = JSON.parse(fs.readFileSync(packageFile, "utf8")) as {
      files: string[];
    };
    metadata.files.push("extra.txt");
    fs.writeFileSync(packageFile, `${JSON.stringify(metadata, null, 2)}\n`);
    this.afterDigest = successfulDigest(this.fixtureDirectory);
  },
);

Then("配布file一覧から64桁のdigestを算出する", function () {
  assert.equal(this.digestProcess?.status, 0, this.digestProcess?.stderr);
  const result = JSON.parse(this.digestProcess.stdout) as DistributionDigest;
  assert.match(result.digest, /^[0-9a-f]{64}$/u);
  assert.equal(result.entryCount, 3);
  assert.deepEqual(result.errors, []);
});

Then("distが必要な日本語errorで非0終了する", function () {
  assert.notEqual(this.digestProcess?.status, 0);
  assert.match(this.digestProcess?.stderr ?? "", /dist.*存在.*配布物.*算出/u);
});

Then("指定したfixtureの配布file一覧からdigestを算出する", function () {
  assert.equal(this.digestProcess?.status, 0, this.digestProcess?.stderr);
  const result = JSON.parse(this.digestProcess.stdout) as DistributionDigest;
  assert.match(result.digest, /^[0-9a-f]{64}$/u);
  assert.equal(result.entryCount, 3);
});

Then("README変更後の配布digestは異なる", function () {
  assert.notEqual(this.beforeDigest?.digest, this.afterDigest?.digest);
  assert.equal(this.beforeDigest?.entryCount, this.afterDigest?.entryCount);
});

Then("docs specs変更後の配布digestは同じになる", function () {
  assert.equal(this.beforeDigest?.digest, this.afterDigest?.digest);
  assert.equal(this.beforeDigest?.entryCount, this.afterDigest?.entryCount);
});

Then("追加fileが配布entryへ増えてdigestは異なる", function () {
  assert.equal(
    this.afterDigest?.entryCount,
    (this.beforeDigest?.entryCount ?? 0) + 1,
  );
  assert.notEqual(this.beforeDigest?.digest, this.afterDigest?.digest);
});
