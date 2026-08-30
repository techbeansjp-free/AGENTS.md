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

const BUMP_SCRIPT_RUN = "node --import tsx scripts/prepare_release_bump.ts";

/**
 * `bump_version` jobで使ってよいgit sub commandの**allowlist**。
 *
 * **禁止集合の列挙をやめてallowlistにした。** 禁止側を数えると`git restore --source`、
 * `git -c alias.x=checkout x`、`git-switch`、`/usr/bin/git switch`、`'git' switch`の
 * ような表記で素通りする。allowlistなら未知の表記は既定で違反になる。
 */
const ALLOWED_GIT_SUBCOMMANDS = ["show", "fetch", "rev-parse", "ls-remote"];

/** `git`本体を指すtokenか。quoteとdirectoryを剥がしてbasenameで判定する。 */
function isGitInvocation(token: string): boolean {
  const bare = token.replace(/^["']|["']$/gu, "");
  const base = bare.split("/").pop() ?? bare;
  return base === "git" || base.startsWith("git-");
}

/** `run`本文に、allowlist外のgit sub commandが現れるか。**未知の形は違反とする。** */
function forbiddenGitUsage(run: string): string[] {
  const found: string[] = [];
  for (const line of run.split(/\n/u)) {
    const tokens = line.split(/\s+/u).filter(Boolean);
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]!;
      if (!isGitInvocation(token)) continue;
      const bare = token.replace(/^["']|["']$/gu, "");
      const base = bare.split("/").pop() ?? bare;
      if (base.startsWith("git-")) {
        const subcommand = base.slice(4);
        if (!ALLOWED_GIT_SUBCOMMANDS.includes(subcommand))
          found.push(`git ${subcommand}`);
        continue;
      }
      let cursor = index + 1;
      while (cursor < tokens.length) {
        const next = tokens[cursor]!;
        if (next === "-c" || next === "--git-dir" || next === "-C") {
          cursor += 2;
          continue;
        }
        if (next.startsWith("-")) {
          cursor += 1;
          continue;
        }
        break;
      }
      const subcommand = tokens[cursor];
      if (
        subcommand === undefined ||
        !ALLOWED_GIT_SUBCOMMANDS.includes(subcommand)
      )
        found.push(`git ${subcommand ?? "(不明)"}`);
    }
  }
  return found;
}

function indentWidth(line: string): number {
  return line.length - line.trimStart().length;
}

/** `start`行の次から、`start`行より深いindentが続く範囲を返す。 */
function blockAfter(lines: string[], start: number): string[] {
  const parent = indentWidth(lines[start] ?? "");
  const block: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim().length > 0 && indentWidth(line) <= parent) break;
    block.push(line);
  }
  return block;
}

/**
 * 指定scopeにある**すべての**`defaults:`について、`run.shell`があるかを判定する。
 *
 * **最初の1件だけを見てはならない。** 先行jobにshellなしの`defaults:`があると
 * workflow直下のshellあり`defaults:`を見落とし、逆にscopeを絞らないと
 * job側の`defaults:`をworkflow側の判定に使ってしまう。**indentでscopeを固定し全件走査する。**
 */
function hasDefaultsRunShell(lines: string[], scopeIndent: number): boolean {
  return lines.some((line, index) => {
    if (indentWidth(line) !== scopeIndent || !/^\s*defaults:\s*$/u.test(line))
      return false;
    const defaultsBlock = blockAfter(lines, index);
    return defaultsBlock.some((runLine, runIndex) => {
      if (!/^\s*run:\s*$/u.test(runLine)) return false;
      return blockAfter(defaultsBlock, runIndex).some((shellLine) =>
        /^\s*shell:\s*\S/u.test(shellLine),
      );
    });
  });
}

/** `- `で始まるstep項目ごとにkeyを読む。`run: |`のblock scalarは全文を連結する。 */
function parseSteps(stepsBlock: string[]): WorkflowStep[] {
  /**
   * **項目の列挙は`- `に続く内容の有無で決めない。**
   *
   * `-`だけの行に続けてmappingを書くのはYAMLとして妥当だが、`-\s+\S`を要求すると
   * その行が項目として列挙されず、配下の`run:`が走査対象から外れる。認識できた
   * 最初のstepより前に置かれた場合は完全に見えなくなる。
   * **項目のindentを固定し、そのindentで`-`から始まる行をすべて項目とする。**
   * 内容が読めない項目は後段の`unparsed`がC-0で違反へ倒す。
   */
  const firstDash = stepsBlock.findIndex((line) => /^\s*-/u.test(line));
  const itemIndent = firstDash >= 0 ? indentWidth(stepsBlock[firstDash]!) : -1;
  const itemIndexes = stepsBlock
    .map((line, index) =>
      indentWidth(line) === itemIndent && /^\s*-(\s|$)/u.test(line)
        ? index
        : -1,
    )
    .filter((index) => index >= 0);
  return itemIndexes.map((start, order) => {
    const end = itemIndexes[order + 1] ?? stepsBlock.length;
    const item = stepsBlock.slice(start, end);
    const normalized = item.map((line, index) =>
      index === 0 ? line.replace(/^(\s*)-\s+/u, "$1  ") : line,
    );
    const step: WorkflowStep = {
      run: undefined,
      hasIf: false,
      hasContinueOnError: false,
      hasShell: false,
      /**
       * **解析できる正準形以外はすべて違反にする。**
       *
       * `- {name: x, run: ...}`のflow mapping、`-`だけの行に続けてmappingを書く形、
       * anchor・alias・merge keyは、いずれもYAMLとして妥当でありながらこの行ベース
       * 解析器が読み落とす。読めない形を無視すると検査が素通りする。
       * **`- <key>:`で始まるblock mappingだけを解析対象とし、他は違反へ倒す。**
       */
      unparsed:
        !/^\s*-\s+[A-Za-z][A-Za-z0-9_-]*:/u.test(item[0] ?? "") ||
        normalized.some(
          (line) =>
            indentWidth(line) === indentWidth(normalized[0] ?? "") &&
            /^\s*<<\s*:/u.test(line),
        ),
    };
    const keyIndent = indentWidth(normalized[0] ?? "");
    for (let index = 0; index < normalized.length; index += 1) {
      const line = normalized[index] ?? "";
      if (indentWidth(line) !== keyIndent || line.trim().length === 0) continue;
      if (/^\s*if:\s*\S/u.test(line)) step.hasIf = true;
      if (/^\s*continue-on-error:\s*\S/u.test(line))
        step.hasContinueOnError = true;
      if (/^\s*shell:\s*\S/u.test(line)) step.hasShell = true;
      /**
       * **block scalarの判定をinlineより先に置く。**`run: |`の`|`は非空白なので、
       * inlineの`\S`が先に一致すると本文を1文字と誤読し、C-5が発火しなくなる。
       */
      if (/^\s*run:\s*[|>][-+0-9]*\s*$/u.test(line))
        step.run = blockAfter(normalized, index)
          .map((body) => body.trim())
          .filter(Boolean)
          .join("\n");
      else {
        const inline = /^\s*run:\s*(\S.*)$/u.exec(line);
        if (inline) step.run = inline[1]!.trim();
      }
    }
    return step;
  });
}

/** `02_設計.md` §10.1のC-1〜C-6。満たさない条件を日本語で返す。 */
function evaluateComposition(world: AutoReleaseWorld): string[] {
  const errors: string[] = [];
  const steps = world.bumpJobSteps;
  if (steps.some((step) => step.unparsed))
    errors.push(
      "C-0: block mappingとして読めないstepがあります。flow記法のstepは内容を判定できないため拒否します",
    );
  const matched = steps.filter((step) => step.run === BUMP_SCRIPT_RUN);
  if (matched.length !== 1)
    errors.push(
      `C-1: run scalarが${BUMP_SCRIPT_RUN}と完全一致するstepはちょうど1件必要ですが${matched.length}件でした`,
    );
  const target = matched[0];
  if (target?.hasIf) errors.push("C-2: script呼び出しstepがifを持っています");
  if (target?.hasContinueOnError)
    errors.push("C-3: script呼び出しstepがcontinue-on-errorを持っています");
  const targetIndex = target ? steps.indexOf(target) : -1;
  const npmCiBefore =
    targetIndex >= 0 &&
    steps
      .slice(0, targetIndex)
      .some((step) => /(^|\n)\s*npm ci(\s|$)/u.test(step.run ?? ""));
  if (!npmCiBefore)
    errors.push(
      "C-4: script呼び出しstepより前にnpm ciを実行するstepがありません",
    );
  for (const step of steps)
    for (const usage of forbiddenGitUsage(step.run ?? ""))
      errors.push(`C-5: job内にallowlist外のgitコマンド${usage}が残っています`);
  if (target?.hasShell)
    errors.push("C-6: script呼び出しstepがshell keyを持っています");
  if (world.bumpJobDefaultsShell)
    errors.push("C-6: bump_version jobがdefaults.run.shellを持っています");
  if (world.workflowDefaultsShell)
    errors.push("C-6: workflowがdefaults.run.shellを持っています");
  return errors;
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
  if (
    !bumpJob.includes("npm run prepack") &&
    !bumpJob.includes("npm run verify:distribution")
  ) {
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
  assert.ok(
    this.autoWorkflowValidation?.checks.includes(
      "bump_version jobが配布前品質検証とaudit:checkを含まないことを確認した",
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
  assert.doesNotMatch(
    bumpJob,
    /npm run (?:prepack|verify:distribution|audit:check)\b/u,
  );
  const validateJob = workflow.slice(
    workflow.indexOf("\n  validate:"),
    workflow.indexOf("\n  bump_version:"),
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

Given(
  "release.ymlのbump_version jobをYAMLのstep構造として読み込む",
  function () {
    const yaml = fs.readFileSync(
      path.resolve(".github", "workflows", "release.yml"),
      "utf8",
    );
    const lines = yaml.split(/\r?\n/u);
    /**
     * **`indentWidth <= 2`で絞ってはならない。**`defaults:`は indent 0、`run:`は 2、
     * `shell:`は 4 にあるため、絞ると`shell:`が落ちてworkflow直下の上書きを見逃す。
     */
    this.workflowDefaultsShell = hasDefaultsRunShell(lines, 0);
    const jobIndex = lines.findIndex((line) =>
      /^\s{2}bump_version:\s*$/u.test(line),
    );
    assert.ok(jobIndex >= 0, "bump_version jobが見つかりません");
    const jobBlock = blockAfter(lines, jobIndex);
    this.bumpJobDefaultsShell = hasDefaultsRunShell(jobBlock, 4);
    const stepsIndex = jobBlock.findIndex((line) =>
      /^\s*steps:\s*$/u.test(line),
    );
    assert.ok(stepsIndex >= 0, "bump_version jobのstepsが見つかりません");
    this.bumpJobSteps = parseSteps(blockAfter(jobBlock, stepsIndex));
    assert.ok(this.bumpJobSteps.length > 0, "stepを1件も読み取れませんでした");
  },
);

When("C-1からC-6の条件を判定する", function () {
  this.compositionErrors = evaluateComposition(this);
});

Then(
  "scriptを呼ぶstepはrun scalarが完全一致で1件だけ存在し、ifとcontinue-on-errorとshellを持たず、npm ciが先行し、HEADを動かすコマンドがjob内に無く、jobとworkflowのdefaults.run.shellも無い",
  function () {
    assert.deepEqual(this.compositionErrors, []);
  },
);

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
