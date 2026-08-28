import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  CONSUMER_ACCEPTANCE_MECHANISMS,
  assertIsolation,
  classifyScaleDependentEntrypoint,
  checkConsumerAcceptance,
  composeGitDependencyObservation,
  createIsolatedEnvironment,
  evaluateArtifactIdentity,
  evaluateConsumerAcceptance,
  isConsumerAcceptanceMechanism,
  observeGitDependency,
  observePackedArtifact,
  observeScaleDependentOutput,
  type AtomicConsumerAcceptanceObservation,
  type ArtifactIdentityResult,
  type ConsumerAcceptanceMechanism,
  type ConsumerAcceptanceObservation,
  type ConsumerAcceptanceResult,
  type IsolationAssessment,
  type IsolationInput,
  type ProcessRunner,
} from "../../scripts/check_consumer_acceptance.js";
import { run, type ProcessResult } from "../../src/lib/process.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

function observed<T>(value: T): { state: "observed"; value: T } {
  return { state: "observed", value };
}

function indeterminate(reason: string): {
  state: "indeterminate";
  reason: string;
} {
  return { state: "indeterminate", reason };
}

function observation(
  mechanism: ConsumerAcceptanceMechanism,
  preparationStatus = 0,
  binExists = true,
  entrypointStatus = 0,
): AtomicConsumerAcceptanceObservation {
  return {
    mechanism,
    ...(mechanism === "scale-output"
      ? { scaleFixtureBytes: observed(3 * 1024 * 1024) }
      : {}),
    preparation: {
      status: observed(preparationStatus),
      stdout: "",
      stderr: "",
    },
    binExists: observed(binExists),
    entrypoint: {
      status: observed(entrypointStatus),
      stdout: "",
      stderr: "",
    },
  };
}

class ConsumerAcceptanceWorld extends WorkflowWorld {
  isolationInput: IsolationInput | undefined = undefined;
  isolationAssessment: IsolationAssessment | undefined = undefined;
  observations: ConsumerAcceptanceObservation[] = [];
  acceptanceResult: ConsumerAcceptanceResult | undefined = undefined;
  acceptanceResults: ConsumerAcceptanceResult[] = [];
  mechanismCandidates: string[] = [];
  mechanismValidity: boolean[] = [];
  artifactIdentityInputs: Array<{
    packedArtifactSha256: string | undefined;
    acceptedArtifactSha256: string | undefined;
    publicationArtifactSha256: string | undefined;
  }> = [];
  artifactIdentityResults: ArtifactIdentityResult[] = [];
  processEnvironment: NodeJS.ProcessEnv | undefined = undefined;
  processProbeCommand = "";
  processResult: ProcessResult | undefined = undefined;
  fixtureTarball = "";
  packedObservation: AtomicConsumerAcceptanceObservation | undefined =
    undefined;
  candidateRoot = "";
  candidateCache = "";
  packageCheckAfter: ProcessResult | undefined = undefined;
  registryProbeResult: ProcessResult | undefined = undefined;
  offlinePackageCheckResult: ProcessResult | undefined = undefined;
  gitDependencyCalls: Array<{ file: string; args: string[] }> = [];
  consumerAcceptanceRunner: ProcessRunner | undefined = undefined;
  consumerAcceptanceCalls: Array<{ file: string; args: string[] }> = [];
  consumerAcceptanceCommandResults: ProcessResult[] = [];
  packageManagerSeamDirectory = "";
  packageManagerSeamInjection = "";
  packageManagerSeamLog = "";
  protectedContractDigestBefore = "";
  protectedContractDigestAfter = "";
  protectedFiles: string[] = [];
  protectedPremiseResults: boolean[] = [];
  gitShowFailureRejected = false;
  defaultGitShowFailureRejected = false;
  injectedGitShowReaderCalls = 0;
  parentAuthenticationEnvironment: Record<string, string> = {};
  isolatedProcessEnvironments: NodeJS.ProcessEnv[] = [];
  evidenceValidationErrors: string[][] = [];
  invalidEvidenceErrors: string[][] = [];
  releaseWorkflow = "";
  releaseWorkflowErrors: string[] = [];
}

const { Given, When, Then } = stepDefinitions<ConsumerAcceptanceWorld>();

function copyCandidateTree(source: string, destination: string): void {
  const excluded = new Set([".git", "node_modules"]);
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (current) => {
      const relative = path.relative(source, current);
      if (relative === "") return true;
      const segments = relative.split(path.sep);
      if (excluded.has(segments[0]!)) return false;
      return !(segments[0] === ".agent-skill-chain" && segments[1] === "tmp");
    },
  });
  fs.symlinkSync(
    path.join(source, "node_modules"),
    path.join(destination, "node_modules"),
    "dir",
  );
}

interface ExplicitNpmConfiguration {
  cache: string;
  loglevel: "error";
  registry?: string;
  offline?: true;
}

function createExplicitNpmEnvironment(
  configuration: ExplicitNpmConfiguration,
): NodeJS.ProcessEnv {
  // 親npmの起動方法で観測結果が変わらないよう、npm設定だけは継承せず観測に必要な値から作る。
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.toLowerCase().startsWith("npm_config_"),
    ),
  );
  return {
    ...inheritedEnvironment,
    npm_config_cache: configuration.cache,
    npm_config_loglevel: configuration.loglevel,
    ...(configuration.registry === undefined
      ? {}
      : { npm_config_registry: configuration.registry }),
    ...(configuration.offline === true ? { npm_config_offline: "true" } : {}),
  };
}

function runPackageCheck(root: string, cache: string): ProcessResult {
  return run("npm", ["run", "package:check"], root, {
    allowFailure: true,
    env: createExplicitNpmEnvironment({ cache, loglevel: "error" }),
  });
}

const PROTECTED_SCRIPT_NAMES = [
  "prepare",
  "prepack",
  "verify:distribution",
] as const;

const EVIDENCE_DIRECTORY = path.join(
  "docs",
  "evidence",
  "1024-consumer-acceptance",
);
const EVIDENCE_CONTRACTS = [
  {
    file: "mechanism-1-git-dependency.md",
    mechanism: "git-dependency",
  },
  { file: "mechanism-2-packed-bin.md", mechanism: "packed-bin" },
  { file: "mechanism-3-scale-output.md", mechanism: "scale-output" },
] as const;
const EVIDENCE_FIELDS = [
  "対象製品fileのSHA-256",
  "artifact_sha256",
  "distribution_digest",
  "注入差分",
  "実行command",
  "注入前の終了値",
  "注入後の終了値",
  "機構別診断",
  "保存先",
] as const;
const EVIDENCE_PRODUCT_FILES = [
  "scripts/check_consumer_acceptance.ts",
  "scripts/check_package_contents.ts",
  "src/lib/process.ts",
] as const;
const SHA256_HEX = /^[a-f0-9]{64}$/u;
// この3件は証跡が主張する判定・接続・process境界の実体である。
// package.jsonはmainの自動releaseでversionが変わるため、振る舞いを変えない
// release差分から証跡の束縛を分離する。

function commandOutput(
  file: string,
  args: string[],
  cwd = process.cwd(),
): string {
  const result = run(file, args, cwd, { allowFailure: true });
  assert.equal(
    result.status,
    0,
    `${file} ${args.join(" ")} が失敗しました: ${result.stderr}`,
  );
  return result.stdout;
}

function staticallyReadProtectedFiles(): string[] {
  const source = fs.readFileSync("scripts/check_project_quality.ts", "utf8");
  const block = /const PROTECTED_FILES = \[([^\]]*)\] as const;/u.exec(source);
  assert.ok(block?.[1], "PROTECTED_FILESをsourceから静的に抽出できません");
  const files = [...block[1].matchAll(/"([^"]+)"/gu)].map((match) => match[1]!);
  assert.ok(files.length > 0, "PROTECTED_FILESが空です");
  return files;
}

function readPackageScripts(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
  assert.ok(parsed.scripts, "package.json.scriptsがありません");
  return parsed.scripts;
}

function protectedContractDigest(files: readonly string[]): string {
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    const content = fs.readFileSync(file);
    hash.update(`file:${file}:${content.length}\n`);
    hash.update(content);
  }
  const scripts = readPackageScripts(fs.readFileSync("package.json", "utf8"));
  for (const name of PROTECTED_SCRIPT_NAMES)
    hash.update(`script:${name}:${JSON.stringify(scripts[name])}\n`);
  return hash.digest("hex");
}

type GitFileReader = (ref: string, file: string) => string | Promise<string>;

async function assertProtectedContractMatchesHead(
  root: string,
  protectedFiles: readonly string[],
  readGitFile: GitFileReader = (ref, file) =>
    commandOutput("git", ["show", `${ref}:${file}`], root),
): Promise<void> {
  for (const file of protectedFiles) {
    const headContent = await readGitFile("HEAD", file);
    assert.equal(
      fs.readFileSync(path.join(root, file), "utf8"),
      headContent,
      `${file}がHEADから変わっています`,
    );
  }
  const headPackage = await readGitFile("HEAD", "package.json");
  const headScripts = readPackageScripts(headPackage);
  const candidateScripts = readPackageScripts(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  for (const name of PROTECTED_SCRIPT_NAMES)
    assert.deepEqual(
      candidateScripts[name],
      headScripts[name],
      `package.json.scripts.${name}がHEADから変わっています`,
    );
}

function createMinimalFixtureTarball(world: ConsumerAcceptanceWorld): string {
  const source = world.temp("asc-consumer-package-");
  const packageRoot = path.join(source, "package");
  const artifact = world.temp("asc-consumer-artifact-");
  fs.mkdirSync(path.join(packageRoot, "bin"), { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "agent-skill-chain-consumer-fixture",
        version: "1.0.0",
        bin: { "agent-skill-chain": "bin/cli.js" },
      },
      null,
      2,
    )}\n`,
  );
  const cli = path.join(packageRoot, "bin", "cli.js");
  fs.writeFileSync(
    cli,
    '#!/usr/bin/env node\nprocess.stdout.write("consumer-fixture-ok\\n");\n',
  );
  fs.chmodSync(cli, 0o755);
  const tarball = path.join(artifact, "consumer-fixture.tgz");
  const packed = run(
    "tar",
    ["-czf", tarball, "-C", source, "package"],
    process.cwd(),
  );
  assert.equal(packed.status, 0, packed.stderr);
  return tarball;
}

function evidenceSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  const matches = markdown.matchAll(
    /^## (対象製品fileのSHA-256|artifact_sha256|distribution_digest|注入差分|実行command|注入前の終了値|注入後の終了値|機構別診断|保存先)\n([\s\S]*?)(?=\n## |(?![\s\S]))/gmu,
  );
  for (const match of matches) sections.set(match[1]!, match[2]!.trim());
  return sections;
}

function sectionCodeValue(section: string | undefined): string | undefined {
  return /^`([^`]+)`/u.exec(section ?? "")?.[1];
}

function evidenceProductFileDigests(
  section: string | undefined,
): Array<{ path: string; sha256: string }> {
  return [
    ...(section ?? "").matchAll(/^\|\s*`([^`]+)`\s*\|\s*`([^`]*)`\s*\|\s*$/gmu),
  ].map((match) => ({ path: match[1]!, sha256: match[2]! }));
}

function productFileSha256(file: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

function validateEvidence(
  markdown: string,
  contract: (typeof EVIDENCE_CONTRACTS)[number],
): string[] {
  const sections = evidenceSections(markdown);
  const errors: string[] = [];
  for (const field of EVIDENCE_FIELDS)
    if ((sections.get(field) ?? "").trim() === "")
      errors.push(`${field}が存在しないか空です`);
  for (const field of ["artifact_sha256", "distribution_digest"] as const) {
    const value = (sections.get(field) ?? "").replaceAll("`", "").trim();
    if (!SHA256_HEX.test(value))
      errors.push(`${field}は64桁のhexでなければなりません`);
  }
  const recordedDigests = evidenceProductFileDigests(
    sections.get("対象製品fileのSHA-256"),
  );
  for (const file of EVIDENCE_PRODUCT_FILES) {
    const records = recordedDigests.filter((record) => record.path === file);
    if (records.length === 0) {
      errors.push(`対象製品fileのSHA-256にpathがありません: ${file}`);
      continue;
    }
    if (records.length > 1) {
      errors.push(`対象製品fileのSHA-256にpathが重複しています: ${file}`);
      continue;
    }
    const recorded = records[0]!.sha256;
    if (!SHA256_HEX.test(recorded)) {
      errors.push(
        `対象製品fileのSHA-256は64桁のhexでなければなりません: ${file}`,
      );
      continue;
    }
    let actual: string;
    try {
      actual = productFileSha256(file);
    } catch {
      errors.push(`対象製品fileを読み取れません: ${file}`);
      continue;
    }
    if (recorded !== actual)
      errors.push(`対象製品fileのSHA-256が一致しません: ${file}`);
  }
  for (const record of recordedDigests)
    if (!(EVIDENCE_PRODUCT_FILES as readonly string[]).includes(record.path))
      errors.push(
        `対象製品fileのSHA-256に未定義pathがあります: ${record.path}`,
      );

  const expectedSavePath = path
    .join(EVIDENCE_DIRECTORY, contract.file)
    .split(path.sep)
    .join("/");
  if (sectionCodeValue(sections.get("保存先")) !== expectedSavePath)
    errors.push(`保存先が契約pathと一致しません: ${expectedSavePath}`);
  const mechanism = /機構識別子は\s*`([^`]+)`/u.exec(
    sections.get("機構別診断") ?? "",
  )?.[1];
  if (mechanism !== contract.mechanism)
    errors.push(`機構識別子が契約値と一致しません: ${contract.mechanism}`);

  const before = Number(sectionCodeValue(sections.get("注入前の終了値")));
  if (!Number.isInteger(before) || before !== 0)
    errors.push("注入前の終了値は0でなければなりません");
  const after = Number(sectionCodeValue(sections.get("注入後の終了値")));
  if (!Number.isInteger(after) || after === 0)
    errors.push("注入後の終了値は非0でなければなりません");
  return errors;
}

function isolatedInput(world: ConsumerAcceptanceWorld): IsolationInput {
  const sourceRepositoryRoot = world.temp("asc-consumer-source-");
  const workingDirectory = world.temp("asc-consumer-work-");
  const temporaryStagingRoot = path.join(
    sourceRepositoryRoot,
    ".agent-skill-chain",
    "tmp",
  );
  fs.mkdirSync(temporaryStagingRoot, { recursive: true });
  return {
    sourceRepositoryRoot,
    workingDirectory,
    temporaryStagingRoot,
    env: {
      PATH: process.env.PATH,
      npm_config_cache: path.join(workingDirectory, "cache"),
    },
  };
}

Given("source repository内を指す隔離条件がある", function () {
  const input = isolatedInput(this);
  const linked = path.join(this.temp("asc-consumer-link-"), "repository");
  fs.symlinkSync(input.sourceRepositoryRoot, linked, "dir");
  this.isolationInput = { ...input, workingDirectory: linked };
});

Given("source repositoryの実行入口を含む隔離PATHがある", function () {
  const input = isolatedInput(this);
  const repositoryBin = path.join(
    input.sourceRepositoryRoot,
    "node_modules",
    ".bin",
  );
  fs.mkdirSync(repositoryBin, { recursive: true });
  this.isolationInput = {
    ...input,
    env: {
      ...input.env,
      PATH: `${repositoryBin}${path.delimiter}${input.env.PATH ?? ""}`,
    },
  };
});

Given("source repository内を指す隔離cacheがある", function () {
  const input = isolatedInput(this);
  const repositoryCache = path.join(input.sourceRepositoryRoot, "npm-cache");
  fs.mkdirSync(repositoryCache);
  this.isolationInput = {
    ...input,
    env: { ...input.env, npm_config_cache: repositoryCache },
  };
});

When("consumer acceptanceの隔離条件を判定する", function () {
  assert.ok(this.isolationInput);
  this.isolationAssessment = assertIsolation(this.isolationInput);
});

Then("作業場所がsource repositoryへ到達する理由で拒否される", function () {
  assert.equal(this.isolationAssessment?.isolated, false);
  assert.match(this.isolationAssessment?.reasons.join(" ") ?? "", /作業場所/u);
});

Then("PATHがsource repositoryへ到達する理由で拒否される", function () {
  assert.equal(this.isolationAssessment?.isolated, false);
  assert.match(this.isolationAssessment?.reasons.join(" ") ?? "", /PATH/u);
});

Then("cacheがsource repositoryへ到達する理由で拒否される", function () {
  assert.equal(this.isolationAssessment?.isolated, false);
  assert.match(this.isolationAssessment?.reasons.join(" ") ?? "", /cache/u);
});

Given("導入は成功したがbinが無いpacked-bin観測がある", function () {
  this.observations = [observation("packed-bin", 0, false, 0)];
});

Given("公開入口が非0で終了したpacked-bin観測がある", function () {
  this.observations = [observation("packed-bin", 0, true, 2)];
});

Given("公開入口が非0で終了したscale-output観測がある", function () {
  this.observations = [observation("scale-output", 0, true, 2)];
});

function processResult(
  status: number,
  stdout = "",
  stderr = "",
): ProcessResult {
  return { status, stdout, stderr };
}

function gitDependencyInput(
  world: ConsumerAcceptanceWorld,
  packageManager: "npm" | "pnpm",
  allowBuilds = false,
) {
  return {
    dependency: "git+https://example.invalid/agent-skill-chain.git#fixture",
    packageName: "agent-skill-chain",
    executableName: "agent-skill-chain",
    packageManager,
    allowBuilds,
    sourceRepositoryRoot: world.temp("asc-git-dependency-source-"),
    temporaryStagingRoot: world.temp("asc-git-dependency-staging-"),
  } as const;
}

function injectedGitDependencyRunner(
  world: ConsumerAcceptanceWorld,
  results: readonly ProcessResult[],
): ProcessRunner {
  let index = 0;
  return (file, args, cwd) => {
    world.gitDependencyCalls.push({ file, args: [...args] });
    const result = results[index++];
    assert.ok(
      result,
      `注入runnerの観測値が不足しています: ${file} ${args.join(" ")}`,
    );
    const installs =
      (file === "npm" && args[0] === "install") ||
      (file === "corepack" && args[1] === "install");
    if (installs && result.status === 0) {
      const executable = path.join(
        cwd,
        "node_modules",
        ".bin",
        process.platform === "win32"
          ? "agent-skill-chain.cmd"
          : "agent-skill-chain",
      );
      fs.mkdirSync(path.dirname(executable), { recursive: true });
      fs.writeFileSync(executable, "fixture\n");
    }
    return result;
  };
}

Given("npm準備工程が非0で終了する注入runnerがある", function () {
  this.gitDependencyCalls = [];
  const input = gitDependencyInput(this, "npm");
  this.observations = [
    observeGitDependency(
      input,
      injectedGitDependencyRunner(this, [
        processResult(1, "", "prepare failed"),
      ]),
    ),
  ];
});

Given("allowBuildsなしの明示errorと終了値0を返す注入runnerがある", function () {
  this.gitDependencyCalls = [];
  const explicitError = observeGitDependency(
    gitDependencyInput(this, "pnpm"),
    injectedGitDependencyRunner(this, [
      processResult(0, "11.24.0\n"),
      processResult(1, "", "ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED"),
    ]),
  );
  const unexpectedSuccess = observeGitDependency(
    gitDependencyInput(this, "pnpm"),
    injectedGitDependencyRunner(this, [
      processResult(0, "11.24.0\n"),
      processResult(0),
      processResult(0, "consumer-ok\n"),
    ]),
  );
  this.observations = [explicitError, unexpectedSuccess];
});

Given("allowBuilds有効時の成立と不成立を返す注入runnerがある", function () {
  this.gitDependencyCalls = [];
  const accepted = observeGitDependency(
    gitDependencyInput(this, "pnpm", true),
    injectedGitDependencyRunner(this, [
      processResult(0, "11.24.0\n"),
      processResult(0),
      processResult(0, "consumer-ok\n"),
    ]),
  );
  const rejected = observeGitDependency(
    gitDependencyInput(this, "pnpm", true),
    injectedGitDependencyRunner(this, [
      processResult(0, "11.24.0\n"),
      processResult(1, "", "prepare failed"),
    ]),
  );
  this.observations = [accepted, rejected];
});

Given("終了値を観測できないpacked-bin観測がある", function () {
  this.observations = [
    {
      ...observation("packed-bin"),
      entrypoint: {
        status: indeterminate("公開入口の終了値を観測できません"),
        stdout: "",
        stderr: "",
      },
    },
  ];
});

When("consumer acceptanceを判定する", function () {
  this.acceptanceResult = evaluateConsumerAcceptance(
    this.observations,
    this.observations.map((item) => item.mechanism),
  );
});

When("consumer acceptanceをそれぞれ判定する", function () {
  this.acceptanceResults = this.observations.map((item) =>
    evaluateConsumerAcceptance([item], ["git-dependency"]),
  );
});

When("consumer acceptanceをそれぞれscale-outputとして判定する", function () {
  this.acceptanceResults = this.observations.map((item) =>
    evaluateConsumerAcceptance([item], ["scale-output"]),
  );
});

Then("packed-binは不合格になる", function () {
  assert.equal(this.acceptanceResult?.accepted, false);
  assert.equal(this.acceptanceResult?.mechanisms[0]?.status, "rejected");
});

Then("git-dependencyは不合格になる", function () {
  assert.equal(this.acceptanceResult?.accepted, false);
  assert.equal(this.acceptanceResult?.mechanisms[0]?.status, "rejected");
});

Then("pnpmの明示errorだけが合格になる", function () {
  assert.deepEqual(
    this.acceptanceResults.map((result) => result.accepted),
    [true, false],
  );
  assert.ok(
    this.gitDependencyCalls
      .filter((call) => call.file === "corepack")
      .every((call) => call.args[0] === "pnpm@11.24.0"),
    "pnpmはcorepack pnpm@11.24.0へ固定してください",
  );
});

Then("scale-outputは不合格になる", function () {
  assert.equal(this.acceptanceResult?.accepted, false);
  assert.equal(this.acceptanceResult?.mechanisms[0]?.mechanism, "scale-output");
  assert.equal(this.acceptanceResult?.mechanisms[0]?.status, "rejected");
});

Then("公開入口まで成立した観測だけが合格になる", function () {
  assert.deepEqual(
    this.acceptanceResults.map((result) => result.accepted),
    [true, false],
  );
  assert.ok(
    this.gitDependencyCalls
      .filter((call) => call.file === "corepack")
      .every((call) => call.args[0] === "pnpm@11.24.0"),
    "pnpmはcorepack pnpm@11.24.0へ固定してください",
  );
});

Given("source repositoryの実行入口へsymlinkで戻る継承PATHがある", function () {
  const candidate = this.temp("asc-consumer-candidate-source-");
  const source = this.temp("asc-consumer-real-source-");
  const repositoryBin = path.join(source, "node_modules", ".bin");
  fs.mkdirSync(repositoryBin, { recursive: true });
  fs.symlinkSync(
    path.join(source, "node_modules"),
    path.join(candidate, "node_modules"),
    "dir",
  );
  const linkedBin = path.join(candidate, "node_modules", ".bin");
  const safeBin = this.temp("asc-consumer-safe-bin-");
  this.isolationInput = {
    sourceRepositoryRoot: candidate,
    workingDirectory: this.temp("asc-consumer-isolated-work-"),
    temporaryStagingRoot: path.join(candidate, ".agent-skill-chain", "tmp"),
    env: {
      PATH: `${linkedBin}${path.delimiter}${safeBin}`,
      npm_config_cache: this.temp("asc-consumer-isolated-cache-"),
    },
  };
});

When("consumer acceptance用の隔離envを作る", function () {
  assert.ok(this.isolationInput);
  this.processEnvironment = createIsolatedEnvironment(
    this.isolationInput.sourceRepositoryRoot,
    this.isolationInput.env.npm_config_cache ??
      this.temp("asc-consumer-fallback-cache-"),
    this.isolationInput.env,
  );
});

Then("symlinkで戻る実行入口は隔離PATHから除外される", function () {
  assert.ok(this.isolationInput);
  assert.ok(this.processEnvironment);
  assert.equal(
    this.processEnvironment.PATH,
    this.isolationInput.env.PATH?.split(path.delimiter)[1],
  );
  assert.equal(
    assertIsolation({ ...this.isolationInput, env: this.processEnvironment })
      .isolated,
    true,
  );
});

Given(
  "規模非依存の入力検証errorと規模由来errorと規模条件未達fixtureの観測がある",
  function () {
    const diagnostic = (reason: string): ProcessResult =>
      processResult(
        1,
        `${JSON.stringify({
          result: {
            allowed: false,
            code: "ASC-CLI-VALIDATION-001",
            diagnostic: { reasons: [reason] },
          },
        })}\n`,
      );
    this.observations = [
      {
        ...observation("scale-output"),
        entrypoint: classifyScaleDependentEntrypoint(
          diagnostic("既定ブランチが不明です"),
        ),
      },
      {
        ...observation("scale-output"),
        entrypoint: classifyScaleDependentEntrypoint(
          diagnostic("git ls-filesを実行できませんでした（ENOBUFS）"),
        ),
      },
      {
        ...observation("scale-output"),
        scaleFixtureBytes: observed(1024 * 1024),
      },
    ];
  },
);

Then("3件は判定不能と不合格と判定不能になる", function () {
  assert.deepEqual(
    this.acceptanceResults.map((result) => result.mechanisms[0]?.status),
    ["indeterminate", "rejected", "indeterminate"],
  );
});

Then("packed-binは判定不能として全体を不合格にする", function () {
  assert.equal(this.acceptanceResult?.accepted, false);
  assert.equal(this.acceptanceResult?.mechanisms[0]?.status, "indeterminate");
});

Given("consumer acceptanceの対象機構候補がある", function () {
  this.mechanismCandidates = [
    "git-dependency",
    "packed-bin",
    "scale-output",
    "registry",
  ];
});

Given("先行packed-binを不合格にする注入runnerがある", function () {
  const artifact = this.temp("asc-short-circuit-artifact-");
  this.fixtureTarball = path.join(artifact, "fixture.tgz");
  fs.writeFileSync(this.fixtureTarball, "fixture\n");
  this.consumerAcceptanceCalls = [];
  this.consumerAcceptanceRunner = (file, args) => {
    this.consumerAcceptanceCalls.push({ file, args: [...args] });
    return processResult(0);
  };
});

When("packed-binとscale-outputを順に検査する", function () {
  assert.ok(this.consumerAcceptanceRunner);
  this.acceptanceResult = checkConsumerAcceptance(
    {
      tarballPath: this.fixtureTarball,
      mechanisms: ["packed-bin", "scale-output"],
      sourceRepositoryRoot: process.cwd(),
      temporaryStagingRoot: path.join(
        process.cwd(),
        ".agent-skill-chain",
        "tmp",
      ),
    },
    this.consumerAcceptanceRunner,
  );
});

Then("後続機構を実行せず判定不能理由を残す", function () {
  assert.deepEqual(this.consumerAcceptanceCalls, [
    {
      file: "npm",
      args: [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        fs.realpathSync(this.fixtureTarball),
      ],
    },
  ]);
  assert.equal(this.acceptanceResult?.accepted, false);
  assert.deepEqual(
    this.acceptanceResult?.mechanisms.map(({ mechanism, status }) => ({
      mechanism,
      status,
    })),
    [
      { mechanism: "packed-bin", status: "rejected" },
      { mechanism: "scale-output", status: "indeterminate" },
    ],
  );
  assert.match(
    this.acceptanceResult?.mechanisms[1]?.reasons.join(" ") ?? "",
    /先行機構が不合格のため実行していません/u,
  );
});

function gitDependencyObservation(
  variant: "npm" | "pnpm-without-allow-builds" | "pnpm-with-allow-builds",
  expectation: "prepared" | "explicit-build-denial",
  preparationStatus: number,
  stderr = "",
): AtomicConsumerAcceptanceObservation {
  return {
    ...observation("git-dependency", preparationStatus),
    gitDependencyVariant: variant,
    gitDependencyExpectation: expectation,
    preparation: {
      status: observed(preparationStatus),
      stdout: "",
      stderr,
    },
  };
}

Given("npmとpnpmの3条件を表す複合観測候補がある", function () {
  const npm = gitDependencyObservation("npm", "prepared", 0);
  const denied = gitDependencyObservation(
    "pnpm-without-allow-builds",
    "explicit-build-denial",
    1,
    "ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED",
  );
  const allowed = gitDependencyObservation(
    "pnpm-with-allow-builds",
    "prepared",
    0,
  );
  const silentSuccess = gitDependencyObservation(
    "pnpm-without-allow-builds",
    "explicit-build-denial",
    0,
  );
  const unavailablePnpm = {
    ...allowed,
    preparation: {
      status: indeterminate("corepack pnpm@11.24.0を取得できません"),
      stdout: "",
      stderr: "",
    },
  } satisfies AtomicConsumerAcceptanceObservation;
  this.observations = [
    composeGitDependencyObservation({
      npm,
      pnpmWithoutAllowBuilds: denied,
      pnpmWithAllowBuilds: allowed,
    }),
    composeGitDependencyObservation({
      npm,
      pnpmWithoutAllowBuilds: silentSuccess,
      pnpmWithAllowBuilds: allowed,
    }),
    composeGitDependencyObservation({
      npm,
      pnpmWithoutAllowBuilds: denied,
      pnpmWithAllowBuilds: unavailablePnpm,
    }),
  ];
});

When("複合観測候補をそれぞれgit-dependencyとして判定する", function () {
  this.acceptanceResults = this.observations.map((item) =>
    evaluateConsumerAcceptance([item], ["git-dependency"]),
  );
  this.acceptanceResults.push(
    evaluateConsumerAcceptance(
      [this.observations[0]!, this.observations[0]!],
      ["git-dependency"],
    ),
  );
});

Then(
  "3条件すべての成立だけが合格になり重複する機構観測は判定不能になる",
  function () {
    assert.deepEqual(
      this.acceptanceResults.map((result) => result.mechanisms[0]?.status),
      ["accepted", "rejected", "indeterminate", "indeterminate"],
    );
    assert.deepEqual(
      this.acceptanceResults.map((result) => result.accepted),
      [true, false, false, false],
    );
  },
);

When("対象機構を検証する", function () {
  this.mechanismValidity = this.mechanismCandidates.map(
    isConsumerAcceptanceMechanism,
  );
});

Then("git-dependencyとpacked-binとscale-outputだけを受理する", function () {
  assert.deepEqual(CONSUMER_ACCEPTANCE_MECHANISMS, [
    "git-dependency",
    "packed-bin",
    "scale-output",
  ]);
  assert.deepEqual(this.mechanismValidity, [true, true, true, false]);
});

Given("一致と不一致と算出不能のartifact digestがある", function () {
  const digest = "a".repeat(64);
  this.artifactIdentityInputs = [
    {
      packedArtifactSha256: digest,
      acceptedArtifactSha256: digest,
      publicationArtifactSha256: digest,
    },
    {
      packedArtifactSha256: digest,
      acceptedArtifactSha256: "b".repeat(64),
      publicationArtifactSha256: digest,
    },
    {
      packedArtifactSha256: digest,
      acceptedArtifactSha256: undefined,
      publicationArtifactSha256: digest,
    },
  ];
});

When("artifactの同一性を判定する", function () {
  this.artifactIdentityResults = this.artifactIdentityInputs.map(
    evaluateArtifactIdentity,
  );
});

Then("3者が一致する場合だけ合格になる", function () {
  assert.deepEqual(
    this.artifactIdentityResults.map((result) => result.accepted),
    [true, false, false],
  );
});

Given("process境界へ渡す明示envがある", function () {
  const probeDirectory = this.temp("asc-process-env-");
  this.processProbeCommand = "asc-explicit-env-node";
  fs.symlinkSync(
    process.execPath,
    path.join(probeDirectory, this.processProbeCommand),
  );
  this.processEnvironment = {
    PATH: probeDirectory,
  };
});

When("明示envでprocess境界を実行する", function () {
  assert.ok(this.processEnvironment);
  this.processResult = run(
    this.processProbeCommand,
    ["--version"],
    process.cwd(),
    { env: this.processEnvironment },
  );
});

Then("実processは明示envの値を受け取る", function () {
  assert.equal(this.processResult?.status, 0);
  assert.match(this.processResult?.stdout ?? "", /^v\d+/u);
});

Given(/^保護fileと配布scriptがHEADに一致する$/u, async function () {
  this.protectedFiles = staticallyReadProtectedFiles();
  await assertProtectedContractMatchesHead(process.cwd(), this.protectedFiles);
  this.protectedContractDigestBefore = protectedContractDigest(
    this.protectedFiles,
  );
  this.fixtureTarball = createMinimalFixtureTarball(this);
});

Given(
  "保護fileがmerge-baseと異なりHEADと一致する候補treeがある",
  async function () {
    this.candidateRoot = this.temp("asc-protected-head-");
    this.protectedFiles = ["package-lock.json"];
    this.protectedPremiseResults = [];
    this.gitShowFailureRejected = false;
    this.defaultGitShowFailureRejected = false;
    this.injectedGitShowReaderCalls = 0;
    fs.writeFileSync(
      path.join(this.candidateRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "protected-head-fixture",
          scripts: { prepare: "merge-base-prepare" },
        },
        null,
        2,
      )}\n`,
    );
    fs.writeFileSync(
      path.join(this.candidateRoot, "package-lock.json"),
      "merge-base-version\n",
    );
    await commandOutput("git", ["init", "-q"], this.candidateRoot);
    await commandOutput(
      "git",
      ["config", "user.name", "consumer-acceptance"],
      this.candidateRoot,
    );
    await commandOutput(
      "git",
      ["config", "user.email", "consumer-acceptance@example.invalid"],
      this.candidateRoot,
    );
    await commandOutput("git", ["add", "."], this.candidateRoot);
    await commandOutput(
      "git",
      ["commit", "-q", "-m", "merge base"],
      this.candidateRoot,
    );
    const mergeBase = (
      await commandOutput("git", ["rev-parse", "HEAD"], this.candidateRoot)
    ).trim();
    await commandOutput(
      "git",
      ["update-ref", "refs/remotes/origin/main", mergeBase],
      this.candidateRoot,
    );
    fs.writeFileSync(
      path.join(this.candidateRoot, "package-lock.json"),
      "head-version\n",
    );
    fs.writeFileSync(
      path.join(this.candidateRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "protected-head-fixture",
          scripts: { prepare: "head-prepare" },
        },
        null,
        2,
      )}\n`,
    );
    await commandOutput(
      "git",
      ["add", "package.json", "package-lock.json"],
      this.candidateRoot,
    );
    await commandOutput(
      "git",
      ["commit", "-q", "-m", "head version"],
      this.candidateRoot,
    );
    assert.equal(
      fs.readFileSync(
        path.join(this.candidateRoot, "package-lock.json"),
        "utf8",
      ),
      await commandOutput(
        "git",
        ["show", "HEAD:package-lock.json"],
        this.candidateRoot,
      ),
    );
    assert.notEqual(
      await commandOutput(
        "git",
        ["show", `${mergeBase}:package-lock.json`],
        this.candidateRoot,
      ),
      await commandOutput(
        "git",
        ["show", "HEAD:package-lock.json"],
        this.candidateRoot,
      ),
    );
  },
);

When("保護fileの前提判定を実行する", async function () {
  const accepted = async (): Promise<boolean> => {
    try {
      await assertProtectedContractMatchesHead(
        this.candidateRoot,
        this.protectedFiles,
      );
      return true;
    } catch {
      return false;
    }
  };
  this.protectedPremiseResults.push(await accepted());
  const protectedFile = path.join(this.candidateRoot, "package-lock.json");
  const backup = path.join(this.candidateRoot, "package-lock.head-copy.json");
  fs.copyFileSync(protectedFile, backup);
  fs.appendFileSync(protectedFile, "uncommitted-change\n");
  this.protectedPremiseResults.push(await accepted());
  fs.copyFileSync(backup, protectedFile);
  const worktreeOnlyProtectedFile = "worktree-only-protected.txt";
  fs.writeFileSync(
    path.join(this.candidateRoot, worktreeOnlyProtectedFile),
    "worktree-only\n",
  );
  this.protectedFiles.push(worktreeOnlyProtectedFile);
  this.defaultGitShowFailureRejected = !(await accepted());
  assert.equal(this.protectedFiles.pop(), worktreeOnlyProtectedFile);
  fs.unlinkSync(path.join(this.candidateRoot, worktreeOnlyProtectedFile));
  await assertProtectedContractMatchesHead(
    this.candidateRoot,
    this.protectedFiles,
  );
  try {
    await assertProtectedContractMatchesHead(
      this.candidateRoot,
      this.protectedFiles,
      async () => {
        this.injectedGitShowReaderCalls += 1;
        throw new Error("git show failed");
      },
    );
  } catch {
    this.gitShowFailureRejected = true;
  }
});

Then("前提は成立し、未commit変更とHEAD読取失敗では不成立になる", function () {
  assert.equal(
    this.defaultGitShowFailureRejected,
    true,
    "default readerのgit show失敗を前提成立へ倒してはいけません",
  );
  assert.deepEqual(this.protectedPremiseResults, [true, false]);
  assert.equal(
    this.injectedGitShowReaderCalls,
    1,
    "注入reader callbackを実行して失敗を観測しなければなりません",
  );
  assert.equal(
    this.gitShowFailureRejected,
    true,
    "注入readerのgit show失敗を前提成立へ倒してはいけません",
  );
});

When("最小fixture tarballのconsumer acceptanceを1回観測する", function () {
  this.packedObservation = observePackedArtifact({
    tarballPath: this.fixtureTarball,
    sourceRepositoryRoot: process.cwd(),
    temporaryStagingRoot: path.join(process.cwd(), ".agent-skill-chain", "tmp"),
  });
  this.protectedContractDigestAfter = protectedContractDigest(
    this.protectedFiles,
  );
});

Then("観測前後で保護契約のdigestが一致する", function () {
  assert.ok(this.packedObservation);
  const result = evaluateConsumerAcceptance(
    [this.packedObservation],
    ["packed-bin"],
  );
  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.match(this.protectedContractDigestBefore, /^[a-f0-9]{64}$/u);
  assert.equal(
    this.protectedContractDigestAfter,
    this.protectedContractDigestBefore,
    "consumer acceptanceの観測がsource repositoryの保護契約を変更しました",
  );
});

Given("親processに大小文字のnpm認証tokenがある", function () {
  const names = [
    "NODE_AUTH_TOKEN",
    "node_auth_token",
    "NPM_TOKEN",
    "npm_token",
    "npm_config__auth",
    "NPM_CONFIG__AUTH",
    "npm_config__authToken",
    "npm_config__authtoken",
    "NPM_CONFIG__AUTHTOKEN",
  ];
  this.parentAuthenticationEnvironment = Object.fromEntries(
    names.map((name, index) => [name, `injected-parent-token-${index}`]),
  );
  this.fixtureTarball = path.join(
    this.temp("asc-consumer-token-artifact-"),
    "fixture.tgz",
  );
  fs.writeFileSync(this.fixtureTarball, "runner seam does not read tarball\n");
});

When("tokenを持つ親processからpacked artifactを観測する", function () {
  const originalValues = new Map(
    Object.keys(this.parentAuthenticationEnvironment).map((name) => [
      name,
      process.env[name],
    ]),
  );
  Object.assign(process.env, this.parentAuthenticationEnvironment);
  try {
    for (const [name, value] of Object.entries(
      this.parentAuthenticationEnvironment,
    ))
      assert.equal(process.env[name], value);
    this.isolatedProcessEnvironments = [];
    this.packedObservation = observePackedArtifact(
      {
        tarballPath: this.fixtureTarball,
        sourceRepositoryRoot: process.cwd(),
        temporaryStagingRoot: path.join(
          process.cwd(),
          ".agent-skill-chain",
          "tmp",
        ),
      },
      (file, args, cwd, options) => {
        const env = { ...(options?.env ?? {}) };
        this.isolatedProcessEnvironments.push(env);
        if (file === "npm" && args[0] === "install") {
          const executable = path.join(
            cwd,
            "node_modules",
            ".bin",
            process.platform === "win32"
              ? "agent-skill-chain.cmd"
              : "agent-skill-chain",
          );
          fs.mkdirSync(path.dirname(executable), { recursive: true });
          fs.writeFileSync(executable, "fixture\n");
        }
        return processResult(0, file === "npm" ? "" : "consumer-ok\n");
      },
    );
  } finally {
    for (const [name, value] of originalValues) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

Then("観測用の全processにnpm認証tokenが存在しない", function () {
  assert.ok(this.packedObservation);
  assert.equal(
    evaluateConsumerAcceptance([this.packedObservation], ["packed-bin"])
      .accepted,
    true,
  );
  assert.equal(this.isolatedProcessEnvironments.length, 2);
  const forbidden = new Set([
    "node_auth_token",
    "npm_token",
    "npm_config__auth",
    "npm_config__authtoken",
  ]);
  for (const environment of this.isolatedProcessEnvironments)
    assert.deepEqual(
      Object.keys(environment).filter((name) =>
        forbidden.has(name.toLowerCase()),
      ),
      [],
    );
});

Given("3機構の故障注入証跡がある", function () {
  for (const { file } of EVIDENCE_CONTRACTS)
    assert.equal(
      fs.statSync(path.join(EVIDENCE_DIRECTORY, file)).isFile(),
      true,
      `${file}が通常fileではありません`,
    );
});

When("証跡の必須欄と対象製品fileのSHA-256と機構別の値を検査する", function () {
  this.evidenceValidationErrors = EVIDENCE_CONTRACTS.map((contract) =>
    validateEvidence(
      fs.readFileSync(path.join(EVIDENCE_DIRECTORY, contract.file), "utf8"),
      contract,
    ),
  );
  const complete = fs.readFileSync(
    path.join(EVIDENCE_DIRECTORY, EVIDENCE_CONTRACTS[0].file),
    "utf8",
  );
  const missingFieldCopy = complete.replace(
    /^## 保存先\n[\s\S]*?(?=\n## |(?![\s\S]))/mu,
    "",
  );
  assert.notEqual(missingFieldCopy, complete, "欠欄copyを作れませんでした");
  const replaceOnce = (
    source: string,
    pattern: RegExp,
    replacement: string,
  ) => {
    const replaced = source.replace(pattern, replacement);
    assert.notEqual(
      replaced,
      source,
      `不一致copyを作れませんでした: ${pattern}`,
    );
    return replaced;
  };
  const contract = EVIDENCE_CONTRACTS[0];
  const productDigestRow =
    /^(\|\s*`scripts\/check_consumer_acceptance\.ts`\s*\|\s*`)[a-f0-9]{64}(`\s*\|\s*)$/mu;
  const missingProductPathCopy = complete.replace(productDigestRow, "");
  assert.notEqual(
    missingProductPathCopy,
    complete,
    "対象製品fileのpath欠落copyを作れませんでした",
  );
  const missingMechanismCopy = complete.replace(
    /^## 機構別診断\n[\s\S]*?(?=\n## |(?![\s\S]))/mu,
    "",
  );
  assert.notEqual(
    missingMechanismCopy,
    complete,
    "機構識別子の欠欄copyを作れませんでした",
  );
  const missingBeforeCopy = complete.replace(
    /^## 注入前の終了値\n[\s\S]*?(?=\n## |(?![\s\S]))/mu,
    "",
  );
  assert.notEqual(
    missingBeforeCopy,
    complete,
    "注入前の終了値の欠欄copyを作れませんでした",
  );
  const missingAfterCopy = complete.replace(
    /^## 注入後の終了値\n[\s\S]*?(?=\n## |(?![\s\S]))/mu,
    "",
  );
  assert.notEqual(
    missingAfterCopy,
    complete,
    "注入後の終了値の欠欄copyを作れませんでした",
  );
  this.invalidEvidenceErrors = [
    validateEvidence(
      replaceOnce(complete, productDigestRow, `$1${"f".repeat(64)}$2`),
      contract,
    ),
    validateEvidence(
      replaceOnce(complete, productDigestRow, "$1not-a-sha256$2"),
      contract,
    ),
    validateEvidence(missingProductPathCopy, contract),
    validateEvidence(missingMechanismCopy, contract),
    validateEvidence(missingFieldCopy, contract),
    validateEvidence(missingBeforeCopy, contract),
    validateEvidence(missingAfterCopy, contract),
  ];
});

Then(
  "3件は合格し記録hashの不一致と形式不正と必須欄の欠落は不合格になる",
  function () {
    assert.deepEqual(this.evidenceValidationErrors, [[], [], []]);
    assert.equal(this.invalidEvidenceErrors.length, 7);
    assert.ok(
      this.invalidEvidenceErrors.every((errors) => errors.length > 0),
      JSON.stringify(this.invalidEvidenceErrors),
    );
    assert.match(
      this.invalidEvidenceErrors[0]?.join(" ") ?? "",
      /対象製品fileのSHA-256が一致しません: scripts\/check_consumer_acceptance\.ts/u,
    );
    assert.match(
      this.invalidEvidenceErrors[1]?.join(" ") ?? "",
      /64桁のhexでなければなりません: scripts\/check_consumer_acceptance\.ts/u,
    );
    assert.match(
      this.invalidEvidenceErrors[2]?.join(" ") ?? "",
      /pathがありません: scripts\/check_consumer_acceptance\.ts/u,
    );
    assert.match(this.invalidEvidenceErrors[3]?.join(" ") ?? "", /機構識別子/u);
    assert.match(this.invalidEvidenceErrors[4]?.join(" ") ?? "", /保存先/u);
    assert.match(this.invalidEvidenceErrors[5]?.join(" ") ?? "", /注入前/u);
    assert.match(this.invalidEvidenceErrors[6]?.join(" ") ?? "", /注入後/u);
  },
);

Given("公開binを持つ最小fixture tarballがある", function () {
  this.fixtureTarball = createMinimalFixtureTarball(this);
});

Given("package:checkを実行できる候補treeがある", function () {
  this.candidateRoot = this.temp("asc-package-check-candidate-");
  this.candidateCache = this.temp("asc-package-check-cache-");
  copyCandidateTree(process.cwd(), this.candidateRoot);
  const initialized = run(
    "git",
    ["init", "-q", "-b", "main"],
    this.candidateRoot,
    {
      env: process.env,
    },
  );
  assert.equal(initialized.status, 0, initialized.stderr);
  for (const args of [
    ["config", "user.email", "test@example.invalid"],
    ["config", "user.name", "Consumer Acceptance"],
    ["add", "."],
    ["commit", "-q", "-m", "candidate"],
  ]) {
    const prepared = run("git", args, this.candidateRoot, {
      env: process.env,
    });
    assert.equal(prepared.status, 0, prepared.stderr);
  }
});

Given("到達不能registryとoffline modeを持つ一時npm cacheがある", function () {
  // 空のcacheとoffline modeを併用し、DNSやnetwork状態によらずregistry参照を必ず失敗させる。
  this.processEnvironment = createExplicitNpmEnvironment({
    cache: this.temp("asc-package-check-offline-cache-"),
    registry: "http://registry.invalid/",
    offline: true,
    // ENOTCACHEDを必ず出力し、通常のregistry失敗との識別力を起動元のloglevelから隔離する。
    loglevel: "error",
  });
});

When("同じ環境でregistry参照と実コマンドpackage:checkを実行する", function () {
  assert.ok(this.processEnvironment);
  this.registryProbeResult = run(
    "npm",
    ["view", "agent-skill-chain-registry-probe-1024", "version"],
    process.cwd(),
    { allowFailure: true, env: this.processEnvironment },
  );
  this.offlinePackageCheckResult = run(
    "npm",
    ["run", "package:check"],
    process.cwd(),
    { allowFailure: true, env: this.processEnvironment },
  );
});

Then("registry参照は失敗しpackage:checkは終了値0を返す", function () {
  assert.notEqual(this.registryProbeResult?.status, 0);
  assert.match(
    `${this.registryProbeResult?.stdout ?? ""}\n${this.registryProbeResult?.stderr ?? ""}`,
    /ENOTCACHED|only-if-cached/iu,
    "offline modeによりregistry参照の遮断を観測できませんでした",
  );
  assert.equal(
    this.offlinePackageCheckResult?.status,
    0,
    `${this.offlinePackageCheckResult?.stdout ?? ""}\n${this.offlinePackageCheckResult?.stderr ?? ""}`,
  );
});

When(
  "package.jsonのbinを存在しないpathへ変えてpackage:checkを実行する",
  function () {
    const packageJsonPath = path.join(this.candidateRoot, "package.json");
    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, "utf8"),
    ) as {
      bin: Record<string, string>;
    };
    packageJson.bin["agent-skill-chain"] = "./dist/bin/missing.js";
    fs.writeFileSync(
      packageJsonPath,
      `${JSON.stringify(packageJson, null, 2)}\n`,
    );
    this.packageCheckAfter = runPackageCheck(
      this.candidateRoot,
      this.candidateCache,
    );
  },
);

Given("agent-skill-chainの候補tarballがある", function () {
  const artifact = this.temp("asc-consumer-candidate-");
  const cache = this.temp("asc-consumer-candidate-cache-");
  const packed = run(
    "npm",
    ["pack", "--json", "--ignore-scripts", `--pack-destination=${artifact}`],
    process.cwd(),
    {
      env: createExplicitNpmEnvironment({ cache, loglevel: "error" }),
    },
  );
  assert.equal(packed.status, 0, packed.stderr);
  const report = JSON.parse(packed.stdout) as Array<{ filename: string }>;
  assert.equal(report.length, 1);
  this.fixtureTarball = path.join(artifact, report[0]!.filename);
});

Given("install成功時に公開binを作る制御npm seamがある", function () {
  this.packageManagerSeamDirectory = this.temp("asc-consumer-pm-seam-");
  this.packageManagerSeamInjection = path.join(
    this.packageManagerSeamDirectory,
    "missing-bin",
  );
  this.packageManagerSeamLog = path.join(
    this.packageManagerSeamDirectory,
    "calls.jsonl",
  );
  const head = run("git", ["rev-parse", "HEAD"], process.cwd());
  assert.equal(head.status, 0, head.stderr);
  const expectedDependency = `git+${pathToFileURL(process.cwd()).href}#${head.stdout.trim()}`;
  const npmSeam = path.join(this.packageManagerSeamDirectory, "npm");
  fs.writeFileSync(
    npmSeam,
    [
      "#!/usr/bin/env node",
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      `const injection = ${JSON.stringify(this.packageManagerSeamInjection)};`,
      `const log = ${JSON.stringify(this.packageManagerSeamLog)};`,
      `const expectedDependency = ${JSON.stringify(expectedDependency)};`,
      'fs.appendFileSync(log, `${JSON.stringify({ command: "npm", arguments: process.argv.slice(2) })}\\n`);',
      'const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));',
      'if (manifest.dependencies?.["agent-skill-chain"] !== expectedDependency) process.exit(91);',
      "if (!fs.existsSync(injection)) {",
      '  const executable = path.join(process.cwd(), "node_modules", ".bin", "agent-skill-chain");',
      "  fs.mkdirSync(path.dirname(executable), { recursive: true });",
      '  fs.writeFileSync(executable, "#!/usr/bin/env node\\nprocess.exit(0);\\n");',
      "  fs.chmodSync(executable, 0o755);",
      "}",
      "process.exit(0);",
      "",
    ].join("\n"),
  );
  fs.chmodSync(npmSeam, 0o755);
  const corepackSeam = path.join(this.packageManagerSeamDirectory, "corepack");
  fs.writeFileSync(
    corepackSeam,
    [
      "#!/usr/bin/env node",
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      `const injection = ${JSON.stringify(this.packageManagerSeamInjection)};`,
      `const log = ${JSON.stringify(this.packageManagerSeamLog)};`,
      `const expectedDependency = ${JSON.stringify(expectedDependency)};`,
      "const args = process.argv.slice(2);",
      'if (args[0] !== "pnpm@11.24.0") process.exit(92);',
      'if (args[1] === "--version") { process.stdout.write("11.24.0\\n"); process.exit(0); }',
      'if (args[1] !== "install") process.exit(93);',
      'const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));',
      'if (manifest.dependencies?.["agent-skill-chain"] !== expectedDependency) process.exit(91);',
      'const allowBuilds = fs.existsSync(path.join(process.cwd(), "pnpm-workspace.yaml"));',
      'const command = allowBuilds ? "pnpm-with-allow-builds" : "pnpm-without-allow-builds";',
      "fs.appendFileSync(log, `${JSON.stringify({ command, arguments: args })}\\n`);",
      "if (!allowBuilds) {",
      '  process.stderr.write("ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED\\n");',
      "  process.exit(1);",
      "}",
      "if (!fs.existsSync(injection)) {",
      '  const executable = path.join(process.cwd(), "node_modules", ".bin", "agent-skill-chain");',
      "  fs.mkdirSync(path.dirname(executable), { recursive: true });",
      '  fs.writeFileSync(executable, "#!/usr/bin/env node\\nprocess.exit(0);\\n");',
      "  fs.chmodSync(executable, 0o755);",
      "}",
      "process.exit(0);",
      "",
    ].join("\n"),
  );
  fs.chmodSync(corepackSeam, 0o755);
  const pnpmSeam = path.join(this.packageManagerSeamDirectory, "pnpm");
  fs.writeFileSync(
    pnpmSeam,
    [
      "#!/usr/bin/env node",
      'const fs = require("node:fs");',
      `fs.appendFileSync(${JSON.stringify(this.packageManagerSeamLog)}, ${JSON.stringify(`${JSON.stringify({ command: "pnpm-direct" })}\\n`)});`,
      "process.exit(97);",
      "",
    ].join("\n"),
  );
  fs.chmodSync(pnpmSeam, 0o755);
  this.fixtureTarball = path.join(
    this.packageManagerSeamDirectory,
    "unused.tgz",
  );
  fs.writeFileSync(this.fixtureTarball, "git-dependencyでは未使用\n");
});

When(
  "consumer acceptance commandを実行してから公開binを作らない故障を注入して再実行する",
  function () {
    const execute = (): ProcessResult =>
      run(
        "node",
        [
          "--import",
          "tsx",
          "scripts/check_consumer_acceptance.ts",
          `--tarball=${this.fixtureTarball}`,
          "--mechanisms=git-dependency",
        ],
        process.cwd(),
        {
          allowFailure: true,
          env: {
            ...process.env,
            PATH: `${this.packageManagerSeamDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
          },
        },
      );
    this.consumerAcceptanceCommandResults = [execute()];
    fs.writeFileSync(this.packageManagerSeamInjection, "準備工程を省略\n");
    this.consumerAcceptanceCommandResults.push(execute());
  },
);

Then("注入前は終了値0で注入後はgit-dependencyを示して非0になる", function () {
  assert.deepEqual(
    this.consumerAcceptanceCommandResults.map((result) => result.status),
    [0, 1],
  );
  assert.match(
    `${this.consumerAcceptanceCommandResults[1]?.stdout ?? ""}\n${this.consumerAcceptanceCommandResults[1]?.stderr ?? ""}`,
    /git-dependency/u,
  );
  assert.match(
    this.consumerAcceptanceCommandResults[1]?.stdout ?? "",
    /公開binが存在しません/u,
  );
  const calls = fs
    .readFileSync(this.packageManagerSeamLog, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { command: string });
  assert.deepEqual(
    calls.map((call) => call.command),
    [
      "npm",
      "pnpm-without-allow-builds",
      "pnpm-with-allow-builds",
      "npm",
      "pnpm-without-allow-builds",
      "pnpm-with-allow-builds",
    ],
  );
});

When("packed artifactを隔離環境で観測する", function () {
  this.packedObservation = observePackedArtifact({
    tarballPath: this.fixtureTarball,
    sourceRepositoryRoot: process.cwd(),
    temporaryStagingRoot: path.join(process.cwd(), ".agent-skill-chain", "tmp"),
  });
});

When(
  "ignored出力が1MiBを超えるscratch repositoryで公開入口を観測する",
  function () {
    this.packedObservation = observeScaleDependentOutput({
      tarballPath: this.fixtureTarball,
      sourceRepositoryRoot: process.cwd(),
      temporaryStagingRoot: path.join(
        process.cwd(),
        ".agent-skill-chain",
        "tmp",
      ),
    });
  },
);

Then("導入とbinの実在と公開入口の起動が観測される", function () {
  assert.ok(this.packedObservation);
  const result = evaluateConsumerAcceptance(
    [this.packedObservation],
    ["packed-bin"],
  );
  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(this.packedObservation.preparation.status.state, "observed");
  assert.deepEqual(this.packedObservation.binExists, observed(true));
  assert.equal(this.packedObservation.entrypoint.status.state, "observed");
  assert.equal(
    this.packedObservation.entrypoint.stdout,
    "consumer-fixture-ok\n",
  );
});

Then("packed-binのconsumer acceptanceで不合格になる", function () {
  assert.notEqual(this.packageCheckAfter?.status, 0);
  assert.match(
    `${this.packageCheckAfter?.stdout ?? ""}\n${this.packageCheckAfter?.stderr ?? ""}`,
    /consumer acceptance \(packed-bin\):/u,
  );
});

Then("scale-outputの公開入口は終了値0を返す", function () {
  assert.ok(this.packedObservation);
  assert.equal(this.packedObservation.mechanism, "scale-output");
  assert.deepEqual(this.packedObservation.entrypoint.status, observed(0));
  assert.equal(this.packedObservation.scaleFixtureBytes?.state, "observed");
  assert.ok(
    this.packedObservation.scaleFixtureBytes?.state === "observed" &&
      this.packedObservation.scaleFixtureBytes.value > 1024 * 1024,
    "scratch repositoryのignored出力が1MiBを超えていません",
  );
});

Given("release workflowの公開artifact経路がある", function () {
  this.releaseWorkflow = fs.readFileSync(
    path.join(".github", "workflows", "release.yml"),
    "utf8",
  );
});

When(
  "pack artifactからconsumer acceptanceとpublishへの参照を検査する",
  function () {
    const expectedReference =
      "TARBALL_PATH: ${{ steps.pack_artifact.outputs.tarball_path }}";
    const referenceCount = this.releaseWorkflow
      .split("\n")
      .filter((line) => line.trim() === expectedReference).length;
    const packCount = this.releaseWorkflow
      .split("\n")
      .filter((line) =>
        line.includes("npm pack --json --pack-destination=./release-artifact"),
      ).length;
    this.releaseWorkflowErrors = [];
    if (packCount !== 1)
      this.releaseWorkflowErrors.push(
        `release対象tarballの作成回数が1件ではありません: ${packCount}`,
      );
    if (referenceCount !== 3)
      this.releaseWorkflowErrors.push(
        `pack_artifactのtarball参照が検査・同一性確認・公開の3件ではありません: ${referenceCount}`,
      );
    if (
      !this.releaseWorkflow.includes(
        'node --import tsx scripts/check_consumer_acceptance.ts --tarball="$TARBALL_PATH" --mechanisms=git-dependency,packed-bin,scale-output',
      )
    )
      this.releaseWorkflowErrors.push(
        "consumer acceptanceが同じtarballの3機構を指定していません",
      );
    if (
      !this.releaseWorkflow.includes(
        'run: npm publish --provenance --access public "$TARBALL_PATH"',
      )
    )
      this.releaseWorkflowErrors.push(
        "npm publishが検査済みの同じtarballを参照していません",
      );
  },
);

Then("1度だけ作った同じtarballに3機構の検査と公開が結び付く", function () {
  assert.deepEqual(this.releaseWorkflowErrors, []);
});
