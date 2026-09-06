import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  computeDistributionDigest,
  normalizeDistributionContent,
  planAutoRelease,
  releaseJobDocumentationMismatch,
  releaseWorkflowJobNames,
  validateReleaseWorkflow,
  type AutoReleaseInput,
  type AutoReleasePlan,
  type DistributionDigest,
} from "../../src/domain/release.js";
import { isPackageVersion, PACKAGE_VERSION } from "../../src/lib/version.js";
import { planAutoReleaseFromEnvironment } from "../../scripts/plan_release.js";
import { canonicalBumpDiff } from "../../scripts/prepare_release_bump.js";
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
  releaseJobMarkdown = "";
  releaseJobYaml = "";
  releaseJobMismatch: string[] = [];
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
  bumpJobSteps: WorkflowStep[] = [];
  workflowDefaultsShell = false;
  bumpJobDefaultsShell = false;
  compositionErrors: string[] = [];
  bumpFixtures: BumpFixture[] = [];
  bumpResults: Array<{
    status: number | null;
    stdout: string;
    stderr: string;
  }> = [];
  bumpUseBaseVersion = false;
}

/**
 * `bump_version` jobのstep 1件。**shellの構文を解釈しない。**
 *
 * `run`はscalarの全文をtrimして保持し、`if`・`continue-on-error`・`shell`はkeyの
 * 有無だけを持つ。C-1のscalar完全一致で「そのstepにはその1行しか書けない」ことを
 * 保証するため、関数定義・`eval`・間接呼び出しは構造的に入り込めない。
 */
interface WorkflowStep {
  run: string | undefined;
  hasIf: boolean;
  hasContinueOnError: boolean;
  hasShell: boolean;
  /** block mappingとして読めなかったstep。**内容を判定できないため違反として扱う。** */
  unparsed: boolean;
}

/**
 * 合成を検査する対象script。**version注入stepである**（Issue #1184）。
 *
 * bump経路が消えたため、`prepare_release_bump.ts`はもう実行経路に無い。
 * `npm publish <tgz>`が`prepack`を実行しない以上、注入漏れを公開前に検出する
 * 機会はこのstepだけであり、**ifやcontinue-on-errorで飛ばせないことを固定する。**
 */
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

Then("自動release計画は次のprerelease tagでreleaseする", function () {
  assert.equal(this.autoPlan?.state, "release");
  assert.equal(this.autoPlan.version, "0.3.1-beta.2");
  assert.equal(this.autoPlan.tag, "v0.3.1-beta.2");
  assert.equal(this.autoPlan.needsVersionBump, false);
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

Then("entrypointはreleaseと停止を外部更新なしで返す", function () {
  assert.deepEqual(
    this.entrypointPlans.map(({ state }) => state),
    ["release", "skipped", "skipped", "release"],
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

Then("entrypointは既存tagから現在versionを導く", function () {
  /**
   * **package.jsonのversionを使わない。** sentinelになったため、正本は既存tagである
   * （Issue #1184）。tagが1件も無い入力では初期値の`0.3.0-0`から次のtagを導く。
   */
  assert.equal(this.fallbackEntrypointPlan?.state, "release");
  assert.notEqual(this.fallbackEntrypointPlan.version, PACKAGE_VERSION);
  assert.equal(
    this.fallbackEntrypointPlan.tag,
    `v${this.fallbackEntrypointPlan.version}`,
  );
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
    ["skipped", "release"],
  );
});

Then(
  "解決可能なversionは0.3.x内で次tagへ進み解決不能なversionは停止する",
  function () {
    assert.equal(this.autoPlans.length, 3);
    assert.equal(this.autoPlans[0]?.version, "0.3.1-beta.10");
    assert.equal(this.autoPlans[1]?.version, "0.3.10");
    for (const plan of this.autoPlans.slice(0, 2)) {
      assert.equal(plan.state, "release");
      assert.equal(plan.needsVersionBump, false);
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

Given("bump_version jobを持つworkflow本文がある", function () {
  /**
   * **実workflowへbump jobを1件足しただけの本文にする。** 他の条件は満たしたまま
   * bump jobの存在だけで拒否されることを固定する（Issue #1184）。
   */
  const workflow = fs.readFileSync(
    path.resolve(".github", "workflows", "release.yml"),
    "utf8",
  );
  const tagStart = workflow.indexOf("\n  tag:");
  assert.ok(tagStart >= 0);
  this.autoWorkflowYaml = `${workflow.slice(0, tagStart)}\n  bump_version:\n    name: versionをmainへ反映する\n    runs-on: ubuntu-latest\n    steps:\n      - name: 何もしない\n        run: "true"\n${workflow.slice(tagStart)}`;
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

Given(
  "配布前品質検証の入口へ接尾辞を付けたrelease workflow本文がある",
  function () {
    this.autoWorkflowYaml = fs
      .readFileSync(path.resolve(".github", "workflows", "release.yml"), "utf8")
      .replaceAll(
        "npm run verify:distribution",
        "npm run verify:distribution-extra",
      )
      .replaceAll("npm run prepack", "npm run prepack-extra")
      .replaceAll("npm run quality", "npm run quality-extra");
  },
);

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
      "validate jobの配布前品質検証の実行を確認した",
    ),
  );
  /**
   * **checks配列の中身だけでは条件の存在を固定できない。** 条件式を`false`へ倒す変異でも
   * else側のcheckは積まれるため生存する。**本文から該当行を消して拒否されることを
   * 確かめる。**
   */
  const workflow = this.autoWorkflowYaml;
  /**
   * **remote tip照合は2箇所を個別に消す。** 両方を一度に消す反例では、
   * どちらか1件だけを残したworkflowが通る形の緩さを検出できない。
   */
  const tipLines = [
    ...workflow.matchAll(/^.*git ls-remote origin "refs\/heads\/.*$/gmu),
  ];
  assert.equal(tipLines.length, 2);
  for (const [index, expected] of [
    "validate jobにtrigger SHAとremote既定branch tipを照合するstepが必要です",
    "tag jobにtag書き込み直前のremote既定branch tip再照合stepが必要です",
  ].entries()) {
    /**
     * **位置で消す。** 2行は字面が同一なので`replace`では常に先頭が消え、
     * tag側を消したつもりでvalidate側が消える。
     */
    const match = tipLines[index]!;
    const start = match.index ?? -1;
    assert.ok(start >= 0, expected);
    const removed = `${workflow.slice(0, start)}${workflow.slice(start + match[0].length)}`;
    assert.notEqual(removed, workflow, expected);
    assert.ok(
      validateReleaseWorkflow(removed).errors.includes(expected),
      expected,
    );
  }
  for (const [expected, pattern] of [
    [
      "release対象commitの親が2つであることを確認するstepが必要です",
      /^.*git rev-list --parents -n 1 .*$/gmu,
    ],
  ] as const) {
    const removed = workflow.replace(pattern, "");
    assert.notEqual(removed, workflow, expected);
    /**
     * **`valid === false`では足りない。** 該当行を消すと他の条件も同時に崩れるため、
     * 条件式を`false`へ倒す変異でも`valid`は`false`のままになる。**その条件が出す
     * 診断そのものを要求する。**
     */
    assert.ok(
      validateReleaseWorkflow(removed).errors.includes(expected),
      expected,
    );
  }
  /**
   * **checkoutより前へ戻す変異も殺す。** checkout前の`git ls-remote origin`は
   * workspaceにrepositoryが無いため必ず失敗する。
   */
  const tagJobStart = workflow.indexOf("\n  tag:");
  const tagJobEnd = workflow.indexOf("\n  github_release:");
  const tagJob = workflow.slice(tagJobStart, tagJobEnd);
  const tipStep = tipLines[1]![0];
  const movedTagJob = tagJob
    .replace(`${tipStep}\n`, "")
    .replace(
      "      - name: 検証済みrelease対象commitを取得する",
      `${tipStep}\n      - name: 検証済みrelease対象commitを取得する`,
    );
  assert.notEqual(movedTagJob, tagJob);
  assert.ok(
    validateReleaseWorkflow(
      `${workflow.slice(0, tagJobStart)}${movedTagJob}${workflow.slice(tagJobEnd)}`,
    ).errors.includes(
      "tag jobのremote既定branch tip再照合はactions/checkoutより後に置いてください",
    ),
  );
  for (const check of [
    "bump_version jobが存在しないことを確認した",
    "validate jobのremote既定branch tip照合stepを確認した",
    "tag jobのremote既定branch tip再照合stepを確認した",
    "tag jobの再照合がcheckoutより後にあることを確認した",
    "RELEASE_MAIN_PATを使わないことを確認した",
    "releaseがPRをmergeしないことを確認した",
    "releaseがPRを作成しないことを確認した",
    "既定branchへの直接pushがないことを確認した",
    "2-parent判定を確認した",
  ])
    assert.ok(this.autoWorkflowValidation?.checks.includes(check), check);
});

Then(
  "自動release workflow検証はdigest stepとnpm条件を根拠に拒否する",
  function () {
    assert.equal(this.autoWorkflowValidation?.valid, false);
    assert.match(
      this.autoWorkflowValidation?.errors.join(" ") ?? "",
      /digest/u,
    );
    /**
     * **npm公開は条件付きで許すのではなく存在を許さない。** 条件付きにすると、
     * 条件を満たす入力を与えるだけで方針違反の経路が開く（Issue #1216）。
     */
    assert.ok(
      this.autoWorkflowValidation?.errors.includes(
        "npm公開stepを置かないでください。npm registryへは公開しません",
      ),
      this.autoWorkflowValidation?.errors.join(" / "),
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
  "自動release workflow検証はbump_version jobの存在を根拠に拒否する",
  function () {
    assert.equal(this.autoWorkflowValidation?.valid, false);
    assert.match(
      this.autoWorkflowValidation?.errors.join(" ") ?? "",
      /bump_version jobを置かないでください/u,
    );
  },
);

Then("実workflowは既定branchへ書き込まない", function () {
  assert.equal(this.autoWorkflowValidation?.valid, true);
  const workflow = this.autoWorkflowYaml;
  /**
   * **書き込み経路を1件ずつ入れて拒否されることを確かめる。** 「現在の本文に無い」
   * ことの確認だけでは、条件を消す変異が生き残る。
   */
  for (const [injected, expected] of [
    [
      "  bump_version:\n    name: dummy\n",
      "bump_version jobを置かないでください。releaseは既定branchへ書き込まずtagとGitHub Releaseだけを作ります",
    ],
    [
      "        run: gh pr create --base main --head x --title y\n",
      "releaseからPRを作成しないでください",
    ],
    [
      "        run: gh pr merge 1 --admin --merge\n",
      "releaseからPRをmergeしないでください",
    ],
    [
      "        run: git push origin main\n",
      "release workflowから既定branchへpushしないでください",
    ],
    [
      "        run: git push --force origin main\n",
      "release workflowから既定branchへpushしないでください",
    ],
    [
      "        run: git -C /tmp/worktree push origin main\n",
      "release workflowから既定branchへpushしないでください",
    ],
    [
      "        run: git push origin HEAD:main\n",
      "release workflowから既定branchへpushしないでください",
    ],
    [
      "        run: git push origin +main\n",
      "release workflowから既定branchへpushしないでください",
    ],
    [
      "          TOKEN: ${{ secrets.RELEASE_MAIN_PAT }}\n",
      "RELEASE_MAIN_PATを使わないでください。既定branchへの書き込み権限をreleaseへ与えません",
    ],
  ] as const) {
    assert.ok(
      validateReleaseWorkflow(`${workflow}\n${injected}`).errors.includes(
        expected,
      ),
      expected,
    );
  }
  const validateJob = workflow.slice(
    workflow.indexOf("\n  validate:"),
    workflow.indexOf("\n  tag:"),
  );
  assert.match(validateJob, /npm run (?:prepack|verify:distribution)\b/u);
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

Then(
  "自動release workflow検証は配布前品質検証の欠落を理由に拒否する",
  function () {
    assert.equal(this.autoWorkflowValidation?.valid, false);
    assert.ok(
      this.autoWorkflowValidation?.errors.includes(
        "release前の品質gateとしてnpm run prepack、npm run verify:distribution、npm run qualityのいずれかが必要です",
      ),
    );
  },
);

Given("release.ymlをYAMLのjob構造として読み込む", function () {
  this.autoWorkflowYaml = fs.readFileSync(
    path.resolve(".github", "workflows", "release.yml"),
    "utf8",
  );
});

When("npm公開経路の不在を判定する", function () {
  this.autoWorkflowValidation = validateReleaseWorkflow(this.autoWorkflowYaml);
});

Then("npm公開jobもpublish_npm入力もnpm publish stepも存在しない", function () {
  const yaml = this.autoWorkflowYaml;
  /**
   * **job名の集合そのものを検査する。** `includes`だけでは、npm公開jobを
   * 足し戻す変異を素通しする。
   */
  assert.deepEqual(releaseWorkflowJobNames(yaml), [
    "validate",
    "tag",
    "github_release",
  ]);
  assert.equal(/\bnpm\s+publish\b/u.test(yaml), false);
  assert.equal(/^\s*publish_npm\s*:/mu.test(yaml), false);
  assert.equal(this.autoWorkflowValidation?.valid, true);
});

/** bump準備の隔離fixture。**実`origin`を持たず`os.tmpdir()`配下だけを対象にする。** */
interface BumpFixture {
  work: string;
  bare: string;
  base: string;
  branch: string;
  targetVersion: string;
  remoteHeadBefore: string;
  racePath?: string;
}

/** `isPackageVersion`は`0.3.x`系だけを受理するため、fixtureも同じ体系で採番する。 */
const FIXTURE_BASE_VERSION = "0.3.1-beta.1";
const FIXTURE_TARGET_VERSION = "0.3.1-beta.2";

function fixtureGit(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")}: ${String(result.stderr ?? "")}`,
  );
  return String(result.stdout ?? "").trim();
}

function writeManifests(directory: string, version: string): void {
  fs.writeFileSync(
    path.join(directory, "package.json"),
    `${JSON.stringify({ name: "bump-fixture", version, private: true }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(directory, "package-lock.json"),
    `${JSON.stringify(
      {
        name: "bump-fixture",
        version,
        lockfileVersion: 3,
        requires: true,
        packages: { "": { name: "bump-fixture", version } },
      },
      null,
      2,
    )}\n`,
  );
}

function fixtureNpmVersion(directory: string, version: string): void {
  const result = spawnSync(
    "npm",
    ["version", version, "--no-git-tag-version", "--allow-same-version"],
    { cwd: directory, encoding: "utf8" },
  );
  assert.equal(result.status, 0, String(result.stderr ?? ""));
}

/**
 * 隔離fixtureを1件作る。**6 scenarioがこのhelperを共用し、差分だけを引数で与える。**
 *
 * `branch`は既存bump branchの状態を選ぶ。`absent`は未作成、`stale`は`B`より古い基準、
 * `canonical`は`B`基準で正規、`contaminated`は正規bump差分を超える混入を持つ。
 */
function bumpFixture(
  world: AutoReleaseWorld,
  options: {
    branch: "absent" | "stale" | "canonical" | "contaminated";
    race?: boolean;
    /** `B`の`package.json`へ`__proto__` keyを混ぜる。strict parserが落とすkeyである。 */
    protoKey?: boolean;
    /** `B`の`package.json`へremoteへ書き込む`postversion` lifecycleを置く。 */
    lifecyclePush?: boolean;
  },
): BumpFixture {
  const bare = world.temp("asc-bump-remote-");
  fixtureGit(["init", "--bare", "-q", "-b", "main", "."], bare);
  const work = world.temp("asc-bump-work-");
  fixtureGit(["init", "-q", "-b", "main", "."], work);
  fixtureGit(["config", "user.email", "test@example.invalid"], work);
  fixtureGit(["config", "user.name", "Test"], work);
  writeManifests(work, FIXTURE_BASE_VERSION);
  if (options.protoKey || options.lifecyclePush) {
    const manifest = path.join(work, "package.json");
    const parsed = JSON.parse(fs.readFileSync(manifest, "utf8")) as Record<
      string,
      unknown
    >;
    if (options.lifecyclePush)
      /**
       * **lifecycleが専用refへ書いた痕跡を観測点にする。** bump branchへ書かせると、
       * scriptが最後のpushで上書きしてしまい結果が同じになり、検出力を持たない。
       * 別refなら「最後の1回のpush以外にremoteへ書いたか」を直接観測できる。
       */
      parsed.scripts = {
        postversion:
          "git commit -q --allow-empty --message lifecycle && git push -q origin HEAD:refs/heads/lifecycle-evidence",
      };
    const raw = JSON.stringify(parsed, null, 2);
    fs.writeFileSync(
      manifest,
      options.protoKey
        ? `${raw.replace(/^\{/u, '{\n  "__proto__": { "polluted": true },')}\n`
        : `${raw}\n`,
    );
  }
  fixtureGit(["add", "package.json", "package-lock.json"], work);
  fixtureGit(["commit", "-q", "--message", "fixture"], work);
  fixtureGit(["remote", "add", "origin", bare], work);
  fixtureGit(["push", "-q", "origin", "HEAD:refs/heads/main"], work);
  const older = fixtureGit(["rev-parse", "--verify", "HEAD^{commit}"], work);
  /**
   * **mainの前進は全variantで同じに行う。** INV-02は「bump branchの有無だけを変えた対」の
   * 比較を要求するため、`B`の内容がvariantごとに違うと比較が成立しない。
   * `stale`はbump branchを`older`から作ることだけで乖離を作る。
   */
  fs.writeFileSync(path.join(work, "README.md"), "# advanced\n");
  fixtureGit(["add", "README.md"], work);
  fixtureGit(["commit", "-q", "--message", "advance main"], work);
  fixtureGit(["push", "-q", "origin", "HEAD:refs/heads/main"], work);
  fixtureGit(["fetch", "-q", "origin", "main"], work);
  const base = fixtureGit(
    ["rev-parse", "--verify", "origin/main^{commit}"],
    work,
  );
  const branch = `release/bump-v${FIXTURE_TARGET_VERSION}`;
  let remoteHeadBefore = "";
  if (options.branch !== "absent") {
    const from = options.branch === "stale" ? older : base;
    fixtureGit(["switch", "--detach", from], work);
    fixtureNpmVersion(work, FIXTURE_TARGET_VERSION);
    if (options.branch === "contaminated") {
      const lockfile = path.join(work, "package-lock.json");
      const parsed = JSON.parse(fs.readFileSync(lockfile, "utf8")) as {
        packages: Record<string, Record<string, unknown>>;
      };
      parsed.packages[""]!.integrity = "sha512-contaminated";
      fs.writeFileSync(lockfile, `${JSON.stringify(parsed, null, 2)}\n`);
    }
    fixtureGit(["add", "package.json", "package-lock.json"], work);
    fixtureGit(
      [
        "commit",
        "-q",
        "--message",
        `chore(release): bump version to ${FIXTURE_TARGET_VERSION} [skip ci]`,
      ],
      work,
    );
    fixtureGit(["push", "-q", "origin", `HEAD:refs/heads/${branch}`], work);
    remoteHeadBefore = fixtureGit(["rev-parse", "--verify", "HEAD"], work);
    fixtureGit(["switch", "-q", "main"], work);
  }
  /**
   * **観測とpushのあいだに別主体がbump branchを作成する競合を決定的に作る。**
   *
   * `pre-push` hookでは作れない。hookはremoteのref広告を受け取った後に走るため、
   * 通常pushもleaseも同じ「観測済みの旧値」を送り、両者を区別できない。
   * 区別できるのは**広告の時点でrefが未作成で、push時点では存在する**場合だけである。
   * そこで`ls-remote`を実行した直後にbare remoteへrefを作る`git` shimをPATHへ挿す。
   * このときE-04のとおり通常pushはfast-forwardとして受理され競合を素通りし、
   * 空expect leaseは`stale info`で拒否する。
   */
  let racePath: string | undefined;
  if (options.race) {
    const realGit = String(
      spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout ??
        "",
    ).trim();
    assert.ok(realGit.length > 0, "gitの実体を解決できません");
    racePath = world.temp("asc-bump-race-");
    const shim = path.join(racePath, "git");
    fs.writeFileSync(
      shim,
      [
        "#!/bin/sh",
        `"${realGit}" "$@"`,
        "status=$?",
        'if [ "$1" = "ls-remote" ]; then',
        `  "${realGit}" --git-dir='${bare}' update-ref 'refs/heads/${branch}' '${base}'`,
        "fi",
        "exit $status",
        "",
      ].join("\n"),
    );
    fs.chmodSync(shim, 0o755);
  }
  return {
    work,
    bare,
    base,
    branch,
    targetVersion: FIXTURE_TARGET_VERSION,
    remoteHeadBefore,
    racePath,
  };
}

function runPrepareBump(
  fixture: BumpFixture,
  version = fixture.targetVersion,
): { status: number | null; stdout: string; stderr: string } {
  const script = path.resolve("scripts", "prepare_release_bump.ts");
  const tsxLoader = path.resolve("node_modules", "tsx", "dist", "loader.mjs");
  const result = spawnSync(process.execPath, ["--import", tsxLoader, script], {
    cwd: fixture.work,
    encoding: "utf8",
    env: {
      ...process.env,
      RELEASE_VERSION: version,
      npm_config_cache: path.join(os.tmpdir(), "asc-issue-1051-npm-cache"),
      PATH: fixture.racePath
        ? `${fixture.racePath}:${process.env.PATH ?? ""}`
        : process.env.PATH,
    },
  });
  return {
    status: result.status,
    stdout: String(result.stdout ?? ""),
    stderr: result.error
      ? `${String(result.stderr ?? "")}${result.error.message}`
      : String(result.stderr ?? ""),
  };
}

/** `B`のtreeに正規bump差分だけを適用した期待treeを、fixtureとは独立に構築する。 */
function expectedBumpTree(
  fixture: BumpFixture,
  world: AutoReleaseWorld,
): string {
  const oracle = world.temp("asc-bump-oracle-");
  fixtureGit(["init", "-q", "-b", "main", "."], oracle);
  fixtureGit(["config", "user.email", "test@example.invalid"], oracle);
  fixtureGit(["config", "user.name", "Test"], oracle);
  fixtureGit(["remote", "add", "origin", fixture.bare], oracle);
  fixtureGit(["fetch", "-q", "origin", fixture.base], oracle);
  fixtureGit(["switch", "--detach", fixture.base], oracle);
  fixtureNpmVersion(oracle, fixture.targetVersion);
  fixtureGit(["add", "package.json", "package-lock.json"], oracle);
  fixtureGit(["commit", "-q", "--message", "oracle"], oracle);
  return fixtureGit(["rev-parse", "--verify", "HEAD^{tree}"], oracle);
}

Given(
  "Bより古い基準のbump branchを持つ隔離repositoryと、bump branchを持たない同条件の隔離repositoryを用意する",
  function () {
    this.bumpFixtures = [
      bumpFixture(this, { branch: "stale" }),
      bumpFixture(this, { branch: "absent" }),
    ];
  },
);

Given("B基準で正規なbump branchを持つ隔離repositoryを用意する", function () {
  this.bumpFixtures = [bumpFixture(this, { branch: "canonical" })];
});

Given(
  "package-lock.jsonのintegrityを変えた混入、package.jsonに__proto__ keyを持つ基準、versionのlifecycleがremoteへ書き込む基準の3つの隔離repositoryを用意する",
  function () {
    this.bumpFixtures = [
      bumpFixture(this, { branch: "contaminated" }),
      bumpFixture(this, { branch: "absent", protoKey: true }),
      bumpFixture(this, { branch: "absent", lifecyclePush: true }),
    ];
  },
);

Given(
  "基準SHAを取得できない隔離repositoryと、観測後に別主体がbump branchを作成する隔離repositoryを用意する",
  function () {
    const unreachable = bumpFixture(this, { branch: "absent" });
    fixtureGit(["remote", "remove", "origin"], unreachable.work);
    this.bumpFixtures = [
      unreachable,
      bumpFixture(this, { branch: "absent", race: true }),
    ];
  },
);

Given(
  "mainのversionが目標versionと一致する隔離repositoryを用意する",
  function () {
    this.bumpFixtures = [bumpFixture(this, { branch: "absent" })];
    this.bumpUseBaseVersion = true;
  },
);

When("3つでbump準備手順を実行する", function () {
  this.bumpResults = this.bumpFixtures.map((fixture) =>
    runPrepareBump(fixture),
  );
});

When("bump準備手順を実行する", function () {
  const fixture = this.bumpFixtures[0]!;
  this.bumpResults = [
    runPrepareBump(
      fixture,
      this.bumpUseBaseVersion ? FIXTURE_BASE_VERSION : fixture.targetVersion,
    ),
  ];
});

When("双方でbump準備手順を実行する", function () {
  this.bumpResults = this.bumpFixtures.map((fixture) =>
    runPrepareBump(fixture),
  );
});

Then(
  "HのtreeはBのtreeと正規bump差分の合成に一致し、二つのgate対象treeのtree hashも一致する",
  function () {
    for (const result of this.bumpResults)
      assert.equal(result.status, 0, result.stderr);
    const trees = this.bumpFixtures.map((fixture) =>
      fixtureGit(["rev-parse", "--verify", "HEAD^{tree}"], fixture.work),
    );
    const expected = expectedBumpTree(this.bumpFixtures[0]!, this);
    assert.equal(trees[0], expected);
    assert.equal(trees[0], trees[1]);
  },
);

Then(
  "remote headは実行前後で変化せず、そのbump commitのsubjectはchore\\(release): bump version toで始まり、変更pathはpackage.jsonとpackage-lock.jsonだけになる",
  function () {
    const fixture = this.bumpFixtures[0]!;
    assert.equal(this.bumpResults[0]?.status, 0, this.bumpResults[0]?.stderr);
    const after = fixtureGit(
      ["rev-parse", "--verify", `refs/heads/${fixture.branch}`],
      fixture.bare,
    );
    assert.equal(after, fixture.remoteHeadBefore);
    const subject = fixtureGit(
      ["show", "-s", "--format=%s", after],
      fixture.bare,
    );
    assert.ok(
      subject.startsWith("chore(release): bump version to "),
      `subjectが接頭辞と一致しません: ${subject}`,
    );
    const paths = fixtureGit(
      ["diff", "--name-only", fixture.base, after, "--"],
      fixture.bare,
    )
      .split(/\r?\n/u)
      .filter(Boolean);
    assert.deepEqual(paths.sort(), ["package-lock.json", "package.json"]);
  },
);

Then(
  "混入は作り直しで除かれるか非0で停止し、__proto__を持つ基準は非0で停止し、lifecycleが書いた内容はremoteのbump branchに残らない",
  function () {
    const [contaminated, , lifecycle] = this.bumpFixtures;
    const results = this.bumpResults;
    if (results[0]!.status === 0) {
      const tree = fixtureGit(
        ["rev-parse", "--verify", "HEAD^{tree}"],
        contaminated!.work,
      );
      assert.equal(tree, expectedBumpTree(contaminated!, this));
      const lockfile = fixtureGit(
        ["show", "HEAD:package-lock.json", "--"],
        contaminated!.work,
      );
      assert.ok(!lockfile.includes("contaminated"), "混入が残っています");
    } else
      assert.ok(
        results[0]!.stderr.trim().length > 0,
        "停止理由が出力にありません",
      );
    assert.notEqual(results[1]!.status, 0, "__proto__を持つ基準を通しました");
    assert.ok(
      results[1]!.stderr.trim().length > 0,
      "停止理由が出力にありません",
    );
    /**
     * **lifecycleが書いた内容はremoteに残ってはならない。** `--ignore-scripts`が
     * 外れると`postversion`が判定より前にbump branchへforce pushでき、
     * 「書き込みは最後の1回のpushだけ」を破る。
     */
    /**
     * **正規bump差分の第1段階を直接観測する。**
     *
     * scriptの経路では候補が常に`npm version <V>`の出力なので、変更後の3 fieldが
     * `V`でない入力へ到達しない。第1段階を外す変異はscript経由では区別できないため、
     * exportされた判定関数へ直接その入力を与えて検出力を持たせる。
     */
    const canonicalLock = (value: string): string =>
      JSON.stringify(
        {
          name: "bump-fixture",
          version: value,
          lockfileVersion: 3,
          requires: true,
          packages: { "": { name: "bump-fixture", version: value } },
        },
        null,
        2,
      );
    assert.equal(
      canonicalBumpDiff(
        {
          manifest: JSON.stringify({ name: "bump-fixture", version: "0.3.1" }),
          lockfile: canonicalLock("0.3.1"),
        },
        {
          manifest: JSON.stringify({ name: "bump-fixture", version: "0.3.2" }),
          lockfile: canonicalLock("9.9.9").replace(
            '"version": "9.9.9",\n  "lockfileVersion"',
            '"version": "9.9.9",\n  "lockfileVersion"',
          ),
        },
        "0.3.2",
      ),
      false,
      "変更後の3 fieldが目標versionでない候補を通しました",
    );
    /**
     * **`__proto__`はescapeでも書ける。** raw文字列一致では`"__\u0070roto__"`を
     * 見逃す。decode後のmember keyを見ていることをここで観測する。
     * あわせて、値の中に同じ断片を含む正当なJSONを誤って拒否しないことも観測する。
     */
    assert.equal(
      canonicalBumpDiff(
        {
          manifest: JSON.stringify({ name: "bump-fixture", version: "0.3.1" }),
          lockfile: canonicalLock("0.3.1"),
        },
        {
          manifest: `{"name":"bump-fixture","__\\u0070roto__":{"x":1},"version":"0.3.2"}`,
          lockfile: canonicalLock("0.3.2"),
        },
        "0.3.2",
      ),
      false,
      "escape表記の__proto__ keyを通しました",
    );
    assert.equal(
      canonicalBumpDiff(
        {
          manifest: JSON.stringify({
            name: "bump-fixture",
            description: '"__proto__": はここでは値である',
            version: "0.3.1",
          }),
          lockfile: canonicalLock("0.3.1"),
        },
        {
          manifest: JSON.stringify({
            name: "bump-fixture",
            description: '"__proto__": はここでは値である',
            version: "0.3.2",
          }),
          lockfile: canonicalLock("0.3.2"),
        },
        "0.3.2",
      ),
      true,
      "値の中の断片をkeyと誤認しました",
    );
    const evidence = spawnSync(
      "git",
      ["rev-parse", "--verify", "refs/heads/lifecycle-evidence"],
      { cwd: lifecycle!.bare, encoding: "utf8" },
    );
    assert.notEqual(
      evidence.status,
      0,
      "lifecycleがremoteへ書き込みました。最後の1回のpush以外の書き込みが起きています",
    );
  },
);

Then(
  "いずれもgateを実行せず非0で終了し、成立しなかった条件を出力へ残す",
  function () {
    for (const result of this.bumpResults) {
      assert.notEqual(result.status, 0, result.stdout);
      assert.ok(result.stderr.trim().length > 0, "停止理由が出力にありません");
      assert.equal(result.stdout, "");
    }
  },
);

Then("bump branchとPRのremote状態は変化しない", function () {
  const fixture = this.bumpFixtures[0]!;
  assert.equal(this.bumpResults[0]?.status, 0, this.bumpResults[0]?.stderr);
  const refs = fixtureGit(
    ["for-each-ref", "--format=%(refname) %(objectname)"],
    fixture.bare,
  )
    .split(/\r?\n/u)
    .filter(Boolean);
  assert.deepEqual(
    refs.filter((line) => line.startsWith("refs/heads/release/")),
    [],
  );
});

/** 権限境界表の一致検査用の最小fixture。 */
const RELEASE_JOB_FIXTURE_YAML = [
  "jobs:",
  "  validate:",
  "    name: 検証",
  // **値を持たないnested keyを入れる。** indent限定を外す変異は、これをjob名として拾う。
  "    permissions:",
  "      contents: read",
  "  tag:",
  "    name: tag",
  "    steps:",
  "",
].join("\n");

function permissionTable(jobs: readonly string[]): string {
  return [
    "### 権限境界",
    "",
    "| job | 開始条件 | 権限 | 外部更新 |",
    "|---|---|---|---|",
    ...jobs.map((job) => `| \`${job}\` | 条件 | \`contents: read\` | なし |`),
    "",
  ].join("\n");
}

Given("release workflowと、廃止済みjobを載せた権限境界表がある", function () {
  this.releaseJobMarkdown = permissionTable([
    "validate",
    "tag",
    "bump_version",
  ]);
});

Given("release workflowと、jobを載せ落とした権限境界表がある", function () {
  this.releaseJobMarkdown = permissionTable(["validate"]);
});

Given("release workflowと、一致する権限境界表がある", function () {
  /**
   * **権限境界表の外にjob名を含む行を置く。** 表の1列目限定を外す変異は、
   * 復旧表の`bump_version`を廃止済みjobとして拾う。
   */
  this.releaseJobMarkdown = [
    permissionTable(["validate", "tag"]),
    "### 途中失敗時の復旧",
    "",
    "| 確認済み状態 | 復旧 |",
    "|---|---|",
    "| `bump_version`は廃止した経路である | 参照しない |",
    "",
  ].join("\n");
});

Given(
  "ハイフンと大文字とアンダースコア始まりのjobを持つrelease workflowと、空の権限境界表がある",
  function () {
    /**
     * **GitHub Actionsのjob IDは英字または`_`で始まり、英数字・`-`・`_`を使える。**
     * `[a-z][a-z0-9_]*`へ狭めると3件とも両方の集合から同時に落ち、
     * 集合差が空になって検出できない。
     */
    this.releaseJobYaml = [
      "jobs:",
      "  deploy-docs:",
      "    name: docs",
      "  Deploy:",
      "    name: deploy",
      "  _shared:",
      "    name: shared",
      "",
    ].join("\n");
    this.releaseJobMarkdown = permissionTable([]);
  },
);

Given(
  "行末コメントつきのjobs見出しとjob keyを持つrelease workflowと、空の権限境界表がある",
  function () {
    /**
     * **`jobs: # …`も`validate: # …`も正当なYAMLである。** 行末コメントを許さないと、
     * コメントを付けたjobが集合から落ち、**未記載のjobを検出できない**。
     * PR #1195 のjob ID文法と同じfail-openである（PR #1197 の外部指摘）。
     */
    this.releaseJobYaml = [
      "jobs: # release全体のjob定義",
      "  validate: # 品質自己緩和の拒否",
      "    name: 検証",
      "  tag:",
      "    name: tag",
      "",
    ].join("\n");
    this.releaseJobMarkdown = permissionTable([]);
  },
);

Given(
  "行末コメントに見える値を持つkeyだけのrelease workflowと、空の権限境界表がある",
  function () {
    /**
     * **行末コメントの許可でkey-valueまで拾ってはならない。** `runs-on: ubuntu`のような
     * 値つきkeyをjob名として拾うと、逆向きの偽陽性になる。
     */
    this.releaseJobYaml = [
      "jobs:",
      "  validate:",
      "    name: 検証",
      "  runs_here: ubuntu-latest # 値つきなのでjobではない",
      "",
    ].join("\n");
    this.releaseJobMarkdown = permissionTable([]);
  },
);

Then("2件のjobを載せていないことを理由に拒否する", function () {
  assert.deepEqual(this.releaseJobMismatch, [
    "運用設計の権限境界表がrelease workflowのjobを載せていません: tag、validate",
  ]);
});

Then("validateだけを載せていないことを理由に拒否する", function () {
  assert.deepEqual(this.releaseJobMismatch, [
    "運用設計の権限境界表がrelease workflowのjobを載せていません: validate",
  ]);
});

Given("権限境界表の外に同形式の表があるreview文書がある", function () {
  /**
   * **走査は`### 権限境界`節の中だけに限る。** 文書全体を走査すると、
   * 別の節の表の1列目をjob名と誤認する。
   */
  this.releaseJobMarkdown = [
    permissionTable(["validate", "tag"]),
    "### 途中失敗時の復旧",
    "",
    "| 状態 | 復旧 |",
    "|---|---|",
    "| `bump_version` | 参照しない |",
    "| `deploy-docs` | 参照しない |",
    "",
  ].join("\n");
});

When("release jobと権限境界表の一致を検証する", function () {
  this.releaseJobMismatch = releaseJobDocumentationMismatch({
    yaml: this.releaseJobYaml || RELEASE_JOB_FIXTURE_YAML,
    markdown: this.releaseJobMarkdown,
  });
});

Then("3件のjobを載せていないことを理由に拒否する", function () {
  assert.deepEqual(this.releaseJobMismatch, [
    "運用設計の権限境界表がrelease workflowのjobを載せていません: Deploy、_shared、deploy-docs",
  ]);
});

Then("存在しないjobを載せていることを理由に拒否する", function () {
  assert.deepEqual(this.releaseJobMismatch, [
    "運用設計の権限境界表がrelease workflowに存在しないjobを載せています: bump_version",
  ]);
});

Then("jobを載せていないことを理由に拒否する", function () {
  assert.deepEqual(this.releaseJobMismatch, [
    "運用設計の権限境界表がrelease workflowのjobを載せていません: tag",
  ]);
});

Then("release jobと権限境界表の不一致は0件である", function () {
  assert.deepEqual(this.releaseJobMismatch, []);
});

Then("git-dependency acceptanceの行を消すと拒否される", function () {
  assert.equal(this.autoWorkflowValidation?.valid, true);
  const workflow = this.autoWorkflowYaml;
  const match = /^.*--mechanisms=git-dependency.*$/mu.exec(workflow);
  assert.ok(match, "acceptance行が見つかりません");
  const removed = `${workflow.slice(0, match.index)}${workflow.slice(
    match.index + match[0].length,
  )}`;
  assert.notEqual(removed, workflow);
  /**
   * **checks配列の有無ではなくerror本文を名指しする。** checksだけを見ると、
   * 条件を常に真へ倒す変異が生存する。
   */
  assert.ok(
    validateReleaseWorkflow(removed).errors.includes(
      "validate jobでconsumer acceptanceのgit-dependencyを実行してください",
    ),
    validateReleaseWorkflow(removed).errors.join(" / "),
  );
});

Then("acceptance stepはtag jobの定義より前にある", function () {
  const workflow = this.autoWorkflowYaml;
  const acceptance = workflow.indexOf("--mechanisms=git-dependency");
  const tagJob = /^ {2}tag:$/mu.exec(workflow)?.index ?? -1;
  assert.ok(acceptance >= 0, "acceptance行が見つかりません");
  assert.ok(tagJob >= 0, "tag jobが見つかりません");
  /**
   * **tag自体が`npx github:...#<tag>`の配布アドレスになる。** GitHub Release作成
   * より前で止めるだけでは遅い。
   */
  assert.ok(acceptance < tagJob, `${acceptance} !< ${tagJob}`);
});

Then("npm公開stepとpublish_npm入力のどちらを足しても拒否される", function () {
  const workflow = this.autoWorkflowYaml;
  const withPublish = workflow.replace(
    "  tag:",
    "  publish:\n    steps:\n      - name: 公開する\n        run: npm publish\n\n  tag:",
  );
  assert.ok(
    validateReleaseWorkflow(withPublish).errors.includes(
      "npm公開stepを置かないでください。npm registryへは公開しません",
    ),
    validateReleaseWorkflow(withPublish).errors.join(" / "),
  );
  const withInput = workflow.replace(
    "      dry_run:",
    "      publish_npm:\n        type: boolean\n        default: false\n      dry_run:",
  );
  assert.ok(
    validateReleaseWorkflow(withInput).errors.includes(
      "publish_npm入力を宣言しないでください。npm公開経路は存在しません",
    ),
    validateReleaseWorkflow(withInput).errors.join(" / "),
  );
});

Then("job一覧はvalidateとtagとgithub_releaseだけである", function () {
  /**
   * **job名の集合そのものを検査する。** `includes`だけでは、npm公開jobを
   * 足し戻す変異を素通しする。
   */
  assert.deepEqual(releaseWorkflowJobNames(this.autoWorkflowYaml), [
    "validate",
    "tag",
    "github_release",
  ]);
});

Then("job結果の要求を外すかalwaysを足すと拒否される", function () {
  const workflow = this.autoWorkflowYaml;
  for (const [from, expected] of [
    [
      "needs.validate.result == 'success' &&\n          (needs.validate.outputs.state",
      "tag jobはneeds.validate.result == 'success'を条件へ含めてください",
    ],
    [
      "needs.tag.result == 'success' &&",
      "github_release jobはneeds.tag.result == 'success'を条件へ含めてください",
    ],
  ] as const) {
    const removed = workflow.replace(
      from,
      from.replace(/needs\.[a-z_]+\.result == 'success' &&\n?\s*/u, ""),
    );
    assert.notEqual(removed, workflow, expected);
    assert.ok(
      validateReleaseWorkflow(removed).errors.includes(expected),
      validateReleaseWorkflow(removed).errors.join(" / "),
    );
  }
  /**
   * **`always()`の混入も拒否する。** 条件を満たしていても`always()`があれば
   * 先行jobの失敗後に起動する。
   */
  const withAlways = workflow.replace(
    "      ${{ needs.validate.result == 'success' &&",
    "      ${{ always() && needs.validate.result == 'success' &&",
  );
  assert.ok(
    validateReleaseWorkflow(withAlways).errors.some((error) =>
      error.includes("always()を外してください"),
    ),
    validateReleaseWorkflow(withAlways).errors.join(" / "),
  );
});

Then(
  "acceptanceへifやcontinue-on-errorや失敗握り潰しを足すと拒否される",
  function () {
    const workflow = this.autoWorkflowYaml;
    const stepHeader =
      "      - name: 実Git依存でのconsumer acceptanceを検証する";
    for (const [injected, expected] of [
      [
        `${stepHeader}\n        if: \${{ false }}`,
        "consumer acceptance stepへifを付けないでください。skipできる経路になります",
      ],
      [
        `${stepHeader}\n        continue-on-error: true`,
        "consumer acceptance stepへcontinue-on-error: trueを付けないでください",
      ],
    ] as const) {
      const mutated = workflow.replace(stepHeader, injected);
      assert.notEqual(mutated, workflow, expected);
      assert.ok(
        validateReleaseWorkflow(mutated).errors.includes(expected),
        validateReleaseWorkflow(mutated).errors.join(" / "),
      );
    }
    const swallowed = workflow.replace(
      '--tarball="$TARBALL_PATH" --mechanisms=git-dependency',
      '--tarball="$TARBALL_PATH" --mechanisms=git-dependency || true',
    );
    assert.ok(
      validateReleaseWorkflow(swallowed).errors.some((error) =>
        error.includes("失敗を握り潰さないでください"),
      ),
      validateReleaseWorkflow(swallowed).errors.join(" / "),
    );
  },
);

Then("quoted keyと行継続で書いたnpm公開も拒否される", function () {
  const workflow = this.autoWorkflowYaml;
  /**
   * **正規化してから探す。** 素の文字列一致では、YAMLのquoted keyと
   * shellの行継続がいずれも検査を通る（Issue #1216 F-04）。
   */
  const quotedKey = workflow.replace(
    "      dry_run:",
    '      "publish_npm":\n        type: boolean\n        default: false\n      dry_run:',
  );
  assert.ok(
    validateReleaseWorkflow(quotedKey).errors.includes(
      "publish_npm入力を宣言しないでください。npm公開経路は存在しません",
    ),
    validateReleaseWorkflow(quotedKey).errors.join(" / "),
  );
  const continued = workflow.replace(
    "  tag:",
    "  publish:\n    steps:\n      - name: 公開\n        run: |\n          npm \\\n            publish\n\n  tag:",
  );
  assert.ok(
    validateReleaseWorkflow(continued).errors.includes(
      "npm公開stepを置かないでください。npm registryへは公開しません",
    ),
    validateReleaseWorkflow(continued).errors.join(" / "),
  );
});
