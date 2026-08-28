import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  run,
  type ProcessOptions,
  type ProcessResult,
} from "../src/lib/process.js";
import { isExecutionEntry } from "../src/lib/entrypoint.js";

export const CONSUMER_ACCEPTANCE_MECHANISMS = [
  "git-dependency",
  "packed-bin",
  "scale-output",
] as const;

export type ConsumerAcceptanceMechanism =
  (typeof CONSUMER_ACCEPTANCE_MECHANISMS)[number];

const SCALE_FIXTURE_MINIMUM_BYTES = 1024 * 1024;

export type ObservationValue<T> =
  { state: "observed"; value: T } | { state: "indeterminate"; reason: string };

export interface CommandObservation {
  status: ObservationValue<number>;
  stdout: string;
  stderr: string;
}

export type GitDependencyObservationVariant =
  "npm" | "pnpm-without-allow-builds" | "pnpm-with-allow-builds";

export interface AtomicConsumerAcceptanceObservation {
  mechanism: ConsumerAcceptanceMechanism;
  gitDependencyVariant?: GitDependencyObservationVariant;
  gitDependencyExpectation?: "prepared" | "explicit-build-denial";
  // 機構1・2は規模fixtureを作らないため、規模を観測する機構3だけがこの値を持つ。
  scaleFixtureBytes?: ObservationValue<number>;
  preparation: CommandObservation;
  binExists: ObservationValue<boolean>;
  entrypoint: CommandObservation;
}

export interface GitDependencyCompositeObservation {
  mechanism: "git-dependency";
  kind: "git-dependency-composite";
  observations: {
    npm: AtomicConsumerAcceptanceObservation;
    pnpmWithoutAllowBuilds: AtomicConsumerAcceptanceObservation;
    pnpmWithAllowBuilds: AtomicConsumerAcceptanceObservation;
  };
}

export type ConsumerAcceptanceObservation =
  AtomicConsumerAcceptanceObservation | GitDependencyCompositeObservation;

export interface MechanismAcceptance {
  mechanism: string;
  status: "accepted" | "rejected" | "indeterminate";
  reasons: string[];
}

export interface ConsumerAcceptanceResult {
  accepted: boolean;
  mechanisms: MechanismAcceptance[];
  reasons: string[];
}

export interface IsolationInput {
  sourceRepositoryRoot: string;
  workingDirectory: string;
  temporaryStagingRoot: string;
  env: Readonly<Record<string, string | undefined>>;
}

export interface IsolationAssessment {
  isolated: boolean;
  reasons: string[];
}

export interface ArtifactIdentityInput {
  packedArtifactSha256: string | undefined;
  acceptedArtifactSha256: string | undefined;
  publicationArtifactSha256: string | undefined;
}

export interface ArtifactIdentityResult {
  accepted: boolean;
  reasons: string[];
}

export interface PackedArtifactInput {
  tarballPath: string;
  sourceRepositoryRoot: string;
  temporaryStagingRoot: string;
}

export interface GitDependencyInput {
  dependency: string;
  packageName: string;
  executableName: string;
  packageManager: "npm" | "pnpm";
  allowBuilds: boolean;
  sourceRepositoryRoot: string;
  temporaryStagingRoot: string;
}

type GitDependencyCommonInput = Omit<
  GitDependencyInput,
  "packageManager" | "allowBuilds"
>;

export interface ConsumerAcceptanceCheckInput extends PackedArtifactInput {
  mechanisms: readonly string[];
  gitDependency?: Pick<
    GitDependencyInput,
    "dependency" | "packageName" | "executableName"
  >;
}

export type ProcessRunner = (
  file: string,
  args: string[],
  cwd: string,
  options?: ProcessOptions,
) => ProcessResult;

function canonicalPath(target: string): string {
  const resolved = path.resolve(target.normalize("NFC"));
  let existing = resolved;
  const missing: string[] = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return resolved;
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  return path.resolve(fs.realpathSync(existing), ...missing).normalize("NFC");
}

function isContained(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function sourceRepositoryEntrypoints(sourceRepositoryRoot: string): string[] {
  return [
    canonicalPath(path.join(sourceRepositoryRoot, "dist")),
    canonicalPath(path.join(sourceRepositoryRoot, "node_modules", ".bin")),
  ];
}

function reachesSourceRepositoryEntrypoint(
  sourceRepositoryRoot: string,
  candidate: string,
): boolean {
  const canonicalCandidate = canonicalPath(candidate);
  return sourceRepositoryEntrypoints(sourceRepositoryRoot).some((entrypoint) =>
    isContained(entrypoint, canonicalCandidate),
  );
}

function indeterminate<T>(reason: string): ObservationValue<T> {
  return { state: "indeterminate", reason };
}

function commandIndeterminate(reason: string): CommandObservation {
  return { status: indeterminate(reason), stdout: "", stderr: "" };
}

function unsafeBoundary(
  candidate: string,
  sourceRepositoryRoot: string,
  temporaryStagingRoot: string,
): "source repository" | "一時ステージング領域" | undefined {
  if (isContained(sourceRepositoryRoot, candidate)) return "source repository";
  if (isContained(temporaryStagingRoot, candidate))
    return "一時ステージング領域";
  return undefined;
}

/**
 * symlinkやUnicode表現の違いを文字列比較の抜け道にしないため、実体pathへ正規化して
 * source repositoryと一時ステージング領域への到達可能性を調べる。
 */
export function assertIsolation(input: IsolationInput): IsolationAssessment {
  const sourceRepositoryRoot = canonicalPath(input.sourceRepositoryRoot);
  const temporaryStagingRoot = canonicalPath(input.temporaryStagingRoot);
  const workingDirectory = canonicalPath(input.workingDirectory);
  const reasons: string[] = [];
  const workingBoundary = unsafeBoundary(
    workingDirectory,
    sourceRepositoryRoot,
    temporaryStagingRoot,
  );
  if (workingBoundary) reasons.push(`作業場所が${workingBoundary}へ到達します`);

  const pathValue = input.env.PATH ?? input.env.Path ?? "";
  for (const entry of pathValue.split(path.delimiter).filter(Boolean)) {
    const canonicalEntry = canonicalPath(entry);
    if (reachesSourceRepositoryEntrypoint(sourceRepositoryRoot, entry))
      reasons.push(
        `PATHがsource repositoryの実行入口へ到達します: ${canonicalEntry}`,
      );
  }

  const cacheVariables = [
    "npm_config_cache",
    "NPM_CONFIG_CACHE",
    "pnpm_config_store_dir",
    "PNPM_STORE_DIR",
    "COREPACK_HOME",
  ] as const;
  for (const variable of cacheVariables) {
    const cache = input.env[variable];
    if (!cache) continue;
    const boundary = unsafeBoundary(
      canonicalPath(cache),
      sourceRepositoryRoot,
      temporaryStagingRoot,
    );
    if (boundary) reasons.push(`${variable} cacheが${boundary}へ到達します`);
  }
  return { isolated: reasons.length === 0, reasons };
}

export function isConsumerAcceptanceMechanism(
  value: string,
): value is ConsumerAcceptanceMechanism {
  return CONSUMER_ACCEPTANCE_MECHANISMS.some(
    (mechanism) => mechanism === value,
  );
}

function evaluateAtomicObservation(
  mechanism: ConsumerAcceptanceMechanism,
  observation: AtomicConsumerAcceptanceObservation,
): MechanismAcceptance {
  if (
    mechanism === "git-dependency" &&
    observation.gitDependencyExpectation === "explicit-build-denial"
  ) {
    if (observation.preparation.status.state === "indeterminate")
      return {
        mechanism,
        status: "indeterminate",
        reasons: [observation.preparation.status.reason],
      };
    const explicitlyDenied =
      observation.preparation.status.value !== 0 &&
      `${observation.preparation.stdout}\n${observation.preparation.stderr}`.includes(
        "ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED",
      );
    return {
      mechanism,
      status: explicitlyDenied ? "accepted" : "rejected",
      reasons: explicitlyDenied
        ? []
        : observation.preparation.status.value === 0
          ? ["allowBuildsなしのgit依存準備が終了値0で成功扱いになりました"]
          : ["allowBuildsなしの明示的な準備拒否errorを観測できません"],
    };
  }
  if (mechanism === "scale-output") {
    const scaleFixtureBytes = observation.scaleFixtureBytes;
    if (!scaleFixtureBytes || scaleFixtureBytes.state === "indeterminate")
      return {
        mechanism,
        status: "indeterminate",
        reasons: [
          scaleFixtureBytes?.state === "indeterminate"
            ? scaleFixtureBytes.reason
            : "規模fixtureの生成byte数を観測できません",
        ],
      };
    if (scaleFixtureBytes.value <= SCALE_FIXTURE_MINIMUM_BYTES)
      return {
        mechanism,
        status: "indeterminate",
        reasons: [
          "規模条件を満たすfixtureを生成できていないため、規模の観測へ到達していません",
        ],
      };
  }
  const indeterminateReasons = [
    observation.preparation.status,
    observation.binExists,
    observation.entrypoint.status,
  ].flatMap((value) => (value.state === "indeterminate" ? [value.reason] : []));
  const reasons: string[] = [];
  if (
    observation.preparation.status.state === "observed" &&
    observation.preparation.status.value !== 0
  )
    reasons.push(
      `準備工程が終了値${observation.preparation.status.value}で失敗しました`,
    );
  if (
    observation.binExists.state === "observed" &&
    !observation.binExists.value
  )
    reasons.push("公開binが存在しません");
  if (
    observation.entrypoint.status.state === "observed" &&
    observation.entrypoint.status.value !== 0
  )
    reasons.push(
      `公開入口が終了値${observation.entrypoint.status.value}で失敗しました`,
    );
  if (reasons.length === 0 && indeterminateReasons.length > 0)
    return {
      mechanism,
      status: "indeterminate",
      reasons: indeterminateReasons,
    };
  return {
    mechanism,
    status: reasons.length === 0 ? "accepted" : "rejected",
    reasons,
  };
}

export function composeGitDependencyObservation(input: {
  npm: AtomicConsumerAcceptanceObservation;
  pnpmWithoutAllowBuilds: AtomicConsumerAcceptanceObservation;
  pnpmWithAllowBuilds: AtomicConsumerAcceptanceObservation;
}): GitDependencyCompositeObservation {
  return {
    mechanism: "git-dependency",
    kind: "git-dependency-composite",
    observations: input,
  };
}

function isGitDependencyCompositeObservation(
  observation: ConsumerAcceptanceObservation,
): observation is GitDependencyCompositeObservation {
  return (
    "kind" in observation && observation.kind === "git-dependency-composite"
  );
}

function evaluateGitDependencyCompositeObservation(
  observation: GitDependencyCompositeObservation,
): MechanismAcceptance {
  const components = [
    {
      label: "npm",
      variant: "npm",
      observation: observation.observations.npm,
    },
    {
      label: "pnpm（allowBuildsなし）",
      variant: "pnpm-without-allow-builds",
      observation: observation.observations.pnpmWithoutAllowBuilds,
    },
    {
      label: "pnpm（allowBuildsあり）",
      variant: "pnpm-with-allow-builds",
      observation: observation.observations.pnpmWithAllowBuilds,
    },
  ] as const;
  const identityReasons = components.flatMap((component) =>
    component.observation.mechanism !== "git-dependency" ||
    component.observation.gitDependencyVariant !== component.variant
      ? [`${component.label}の観測識別子が一致しません`]
      : [],
  );
  if (identityReasons.length > 0)
    return {
      mechanism: "git-dependency",
      status: "indeterminate",
      reasons: identityReasons,
    };

  const evaluated = components.map((component) => ({
    label: component.label,
    result: evaluateAtomicObservation("git-dependency", component.observation),
  }));
  const rejectedReasons = evaluated.flatMap(({ label, result }) =>
    result.status === "rejected"
      ? result.reasons.map((reason) => `${label}: ${reason}`)
      : [],
  );
  if (rejectedReasons.length > 0)
    return {
      mechanism: "git-dependency",
      status: "rejected",
      reasons: rejectedReasons,
    };
  const indeterminateReasons = evaluated.flatMap(({ label, result }) =>
    result.status === "indeterminate"
      ? result.reasons.map((reason) => `${label}: ${reason}`)
      : [],
  );
  return {
    mechanism: "git-dependency",
    status: indeterminateReasons.length === 0 ? "accepted" : "indeterminate",
    reasons: indeterminateReasons,
  };
}

function evaluateObservation(
  mechanism: ConsumerAcceptanceMechanism,
  observations: readonly ConsumerAcceptanceObservation[],
): MechanismAcceptance {
  const matches = observations.filter(
    (observation) => observation.mechanism === mechanism,
  );
  if (matches.length !== 1)
    return {
      mechanism,
      status: "indeterminate",
      reasons: [
        matches.length === 0
          ? "観測値がありません"
          : "観測値を一意に決定できません",
      ],
    };
  const observation = matches[0]!;
  if (isGitDependencyCompositeObservation(observation))
    return evaluateGitDependencyCompositeObservation(observation);
  return evaluateAtomicObservation(mechanism, observation);
}

export function createIsolatedEnvironment(
  sourceRepositoryRoot: string,
  cache: string,
  inheritedEnvironment: Readonly<
    Record<string, string | undefined>
  > = process.env,
  offline = true,
): NodeJS.ProcessEnv {
  const inheritedPath =
    inheritedEnvironment.PATH ?? inheritedEnvironment.Path ?? "";
  const safePath = inheritedPath
    .split(path.delimiter)
    .filter(Boolean)
    .filter(
      (entry) =>
        !reachesSourceRepositoryEntrypoint(sourceRepositoryRoot, entry),
    )
    .join(path.delimiter);
  const environment: NodeJS.ProcessEnv = {
    ...inheritedEnvironment,
    PATH: safePath,
    npm_config_cache: cache,
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };
  if (offline) environment.npm_config_offline = "true";
  else delete environment.npm_config_offline;
  // acceptanceが公開authorityを引き継ぐと、検査の欠陥が外部変更へ拡大するため除去する。
  const npmAuthenticationVariables = new Set([
    "node_auth_token",
    "npm_token",
    "npm_config__auth",
    "npm_config__authtoken",
  ]);
  for (const variable of Object.keys(environment))
    if (npmAuthenticationVariables.has(variable.toLowerCase()))
      delete environment[variable];
  return environment;
}

function processObservation(result: ProcessResult): CommandObservation {
  return {
    status: { state: "observed", value: result.status },
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function failedObservation(
  mechanism: ConsumerAcceptanceMechanism,
  reason: string,
): AtomicConsumerAcceptanceObservation {
  return {
    mechanism,
    preparation: commandIndeterminate(reason),
    binExists: indeterminate(reason),
    entrypoint: commandIndeterminate(reason),
  };
}

function skippedObservation(
  mechanism: ConsumerAcceptanceMechanism,
  reason: string,
): AtomicConsumerAcceptanceObservation {
  const observation = failedObservation(mechanism, reason);
  return mechanism === "scale-output"
    ? { ...observation, scaleFixtureBytes: indeterminate(reason) }
    : observation;
}

interface InstalledArtifactContext {
  executable: string;
  temporaryDirectory: string;
  workingDirectory: string;
  env: NodeJS.ProcessEnv;
}

type InstalledEntrypoint = (
  context: InstalledArtifactContext,
  runProcess: ProcessRunner,
) => ProcessResult;

/**
 * source treeのbuild結果で欠落を補完できないことを証明するため、local tarballだけを
 * repository外へ導入し、生成された公開binそのものを起動する。
 */
function observeInstalledArtifact(
  input: PackedArtifactInput,
  mechanism: ConsumerAcceptanceMechanism,
  invokeEntrypoint: InstalledEntrypoint,
  runProcess: ProcessRunner,
): AtomicConsumerAcceptanceObservation {
  let tarball: string;
  try {
    tarball = fs.realpathSync(path.resolve(input.tarballPath));
    if (!fs.statSync(tarball).isFile())
      return failedObservation(mechanism, "tarballが通常fileではありません");
  } catch (error) {
    return failedObservation(
      mechanism,
      `local tarballを読み取れません: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "asc-consumer-acceptance-"),
  );
  try {
    const workingDirectory = path.join(temporary, "consumer");
    const cache = path.join(temporary, "npm-cache");
    fs.mkdirSync(workingDirectory);
    fs.mkdirSync(cache);
    const env = createIsolatedEnvironment(input.sourceRepositoryRoot, cache);
    const isolationInput: IsolationInput = {
      sourceRepositoryRoot: input.sourceRepositoryRoot,
      workingDirectory,
      temporaryStagingRoot: input.temporaryStagingRoot,
      env,
    };
    const generatedIsolation = assertIsolation(isolationInput);
    if (!generatedIsolation.isolated)
      return failedObservation(
        mechanism,
        generatedIsolation.reasons.join(" / "),
      );

    fs.writeFileSync(
      path.join(workingDirectory, "package.json"),
      '{"name":"consumer-acceptance-observer","private":true}\n',
    );
    const installationIsolation = assertIsolation(isolationInput);
    if (!installationIsolation.isolated)
      return failedObservation(
        mechanism,
        installationIsolation.reasons.join(" / "),
      );

    let installed: ProcessResult;
    try {
      installed = runProcess(
        "npm",
        [
          "install",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--package-lock=false",
          tarball,
        ],
        workingDirectory,
        { allowFailure: true, env },
      );
    } catch (error) {
      return failedObservation(
        mechanism,
        `packed artifactの導入結果を観測できません: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const preparation = processObservation(installed);
    const executable = path.join(
      workingDirectory,
      "node_modules",
      ".bin",
      process.platform === "win32"
        ? "agent-skill-chain.cmd"
        : "agent-skill-chain",
    );
    const binExists = fs.existsSync(executable);
    if (installed.status !== 0)
      return {
        mechanism,
        preparation,
        binExists: indeterminate("導入が失敗したためbinを検証できません"),
        entrypoint: commandIndeterminate(
          "導入が失敗したため公開入口を起動できません",
        ),
      };
    if (!binExists)
      return {
        mechanism,
        preparation,
        binExists: { state: "observed", value: false },
        entrypoint: commandIndeterminate(
          "公開binが存在しないため公開入口を起動できません",
        ),
      };

    try {
      const entrypoint = invokeEntrypoint(
        {
          executable,
          temporaryDirectory: temporary,
          workingDirectory,
          env,
        },
        runProcess,
      );
      return {
        mechanism,
        preparation,
        binExists: { state: "observed", value: true },
        entrypoint: processObservation(entrypoint),
      };
    } catch (error) {
      return {
        mechanism,
        preparation,
        binExists: { state: "observed", value: true },
        entrypoint: commandIndeterminate(
          `公開入口の終了値を観測できません: ${error instanceof Error ? error.message : String(error)}`,
        ),
      };
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

export function observePackedArtifact(
  input: PackedArtifactInput,
  runProcess: ProcessRunner = run,
): AtomicConsumerAcceptanceObservation {
  return observeInstalledArtifact(
    input,
    "packed-bin",
    ({ executable, workingDirectory, env }, execute) =>
      execute(executable, [], workingDirectory, {
        allowFailure: true,
        env,
      }),
    runProcess,
  );
}

const PNPM_VERSION = "11.24.0";

type GitDependencyResolution =
  | { resolved: true; input: GitDependencyCommonInput }
  | { resolved: false; reason: string };

function defaultExecutableName(
  packageName: string,
  bin: unknown,
): string | undefined {
  if (typeof bin === "string") return packageName.split("/").at(-1);
  if (!isRecord(bin)) return undefined;
  const entries = Object.entries(bin);
  if (
    entries.length !== 1 ||
    typeof entries[0]?.[0] !== "string" ||
    typeof entries[0]?.[1] !== "string"
  )
    return undefined;
  return entries[0][0];
}

/**
 * release経路の既定値はcandidate自身のHEADと公開metadataから都度導出する。
 * 固定値へ複製するとpackage名やbinの変更後も別の対象を検査できてしまうためである。
 */
function resolveGitDependencyInput(
  input: ConsumerAcceptanceCheckInput,
  runProcess: ProcessRunner,
): GitDependencyResolution {
  if (input.gitDependency)
    return {
      resolved: true,
      input: {
        ...input.gitDependency,
        sourceRepositoryRoot: input.sourceRepositoryRoot,
        temporaryStagingRoot: input.temporaryStagingRoot,
      },
    };
  let manifest: unknown;
  try {
    manifest = JSON.parse(
      fs.readFileSync(
        path.join(input.sourceRepositoryRoot, "package.json"),
        "utf8",
      ),
    ) as unknown;
  } catch (error) {
    return {
      resolved: false,
      reason: `package.jsonを読み取れません: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!isRecord(manifest) || typeof manifest.name !== "string")
    return {
      resolved: false,
      reason: "package.jsonからpackage名を一意に解決できません",
    };
  const executableName = defaultExecutableName(manifest.name, manifest.bin);
  if (!executableName)
    return {
      resolved: false,
      reason: "package.jsonのbinからexecutable名を一意に解決できません",
    };
  let head: ProcessResult;
  try {
    head = runProcess(
      "git",
      ["rev-parse", "--verify", "HEAD"],
      input.sourceRepositoryRoot,
      { allowFailure: true },
    );
  } catch (error) {
    return {
      resolved: false,
      reason: `source repositoryのHEADを観測できません: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const sha = head.stdout.trim();
  if (head.status !== 0 || !/^[a-f0-9]{40,64}$/u.test(sha))
    return {
      resolved: false,
      reason: "source repositoryのHEAD SHAを一意に解決できません",
    };
  return {
    resolved: true,
    input: {
      dependency: `git+${pathToFileURL(path.resolve(input.sourceRepositoryRoot)).href}#${sha}`,
      packageName: manifest.name,
      executableName,
      sourceRepositoryRoot: input.sourceRepositoryRoot,
      temporaryStagingRoot: input.temporaryStagingRoot,
    },
  };
}

/**
 * git依存の準備工程はpackage managerごとに意味が異なる。npmとallowBuilds有効時は
 * 公開入口まで成立させ、allowBuildsなしのpnpmは安全機構の明示停止そのものを観測する。
 */
export function observeGitDependency(
  input: GitDependencyInput,
  runProcess: ProcessRunner = run,
): AtomicConsumerAcceptanceObservation {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "asc-consumer-git-dependency-"),
  );
  const expectation =
    input.packageManager === "pnpm" && !input.allowBuilds
      ? "explicit-build-denial"
      : "prepared";
  const variant: GitDependencyObservationVariant =
    input.packageManager === "npm"
      ? "npm"
      : input.allowBuilds
        ? "pnpm-with-allow-builds"
        : "pnpm-without-allow-builds";
  try {
    const workingDirectory = path.join(temporary, "consumer");
    const cache = path.join(temporary, "package-manager-cache");
    const corepackHome = path.join(temporary, "corepack");
    const pnpmStore = path.join(temporary, "pnpm-store");
    fs.mkdirSync(workingDirectory);
    fs.mkdirSync(cache);
    fs.mkdirSync(corepackHome);
    fs.mkdirSync(pnpmStore);
    const env = createIsolatedEnvironment(
      input.sourceRepositoryRoot,
      cache,
      process.env,
      false,
    );
    env.COREPACK_HOME = corepackHome;
    env.pnpm_config_store_dir = pnpmStore;
    const isolationInput: IsolationInput = {
      sourceRepositoryRoot: input.sourceRepositoryRoot,
      workingDirectory,
      temporaryStagingRoot: input.temporaryStagingRoot,
      env,
    };
    const isolation = assertIsolation(isolationInput);
    if (!isolation.isolated)
      return {
        ...failedObservation("git-dependency", isolation.reasons.join(" / ")),
        gitDependencyVariant: variant,
        gitDependencyExpectation: expectation,
      };

    const packageManifest: Record<string, unknown> = {
      name: "consumer-acceptance-git-dependency",
      private: true,
      dependencies: { [input.packageName]: input.dependency },
    };
    fs.writeFileSync(
      path.join(workingDirectory, "package.json"),
      `${JSON.stringify(packageManifest, null, 2)}\n`,
    );
    if (input.packageManager === "pnpm" && input.allowBuilds)
      // pnpm 11はpackage.jsonのpnpm.allowBuildsを読まない。実git依存を許可する
      // selectorをworkspace正本へ置かなければ、許可したつもりでも常に安全停止する。
      fs.writeFileSync(
        path.join(workingDirectory, "pnpm-workspace.yaml"),
        `allowBuilds:\n  ${JSON.stringify(`${input.packageName}@${input.dependency}`)}: true\n`,
      );

    if (input.packageManager === "pnpm") {
      let version: ProcessResult;
      try {
        version = runProcess(
          "corepack",
          [`pnpm@${PNPM_VERSION}`, "--version"],
          workingDirectory,
          { allowFailure: true, env },
        );
      } catch (error) {
        return {
          ...failedObservation(
            "git-dependency",
            `corepack pnpm@${PNPM_VERSION}を取得できません: ${error instanceof Error ? error.message : String(error)}`,
          ),
          gitDependencyVariant: variant,
          gitDependencyExpectation: expectation,
        };
      }
      if (version.status !== 0 || version.stdout.trim() !== PNPM_VERSION)
        return {
          ...failedObservation(
            "git-dependency",
            `corepack pnpm@${PNPM_VERSION}を取得できません`,
          ),
          gitDependencyVariant: variant,
          gitDependencyExpectation: expectation,
        };
    }

    let installed: ProcessResult;
    try {
      installed =
        input.packageManager === "npm"
          ? runProcess(
              "npm",
              ["install", "--no-audit", "--no-fund", "--package-lock=false"],
              workingDirectory,
              { allowFailure: true, env },
            )
          : runProcess(
              "corepack",
              [`pnpm@${PNPM_VERSION}`, "install"],
              workingDirectory,
              { allowFailure: true, env },
            );
    } catch (error) {
      return {
        ...failedObservation(
          "git-dependency",
          `git依存の準備結果を観測できません: ${error instanceof Error ? error.message : String(error)}`,
        ),
        gitDependencyVariant: variant,
        gitDependencyExpectation: expectation,
      };
    }
    const preparation = processObservation(installed);
    const executable = path.join(
      workingDirectory,
      "node_modules",
      ".bin",
      process.platform === "win32"
        ? `${input.executableName}.cmd`
        : input.executableName,
    );
    if (expectation === "explicit-build-denial") {
      const binExists = fs.existsSync(executable);
      let entrypoint = commandIndeterminate(
        "pnpmが準備工程を拒否したため公開入口を起動しません",
      );
      if (installed.status === 0 && binExists)
        try {
          entrypoint = processObservation(
            runProcess(executable, [], workingDirectory, {
              allowFailure: true,
              env,
            }),
          );
        } catch (error) {
          entrypoint = commandIndeterminate(
            `公開入口の終了値を観測できません: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      return {
        mechanism: "git-dependency",
        gitDependencyVariant: variant,
        gitDependencyExpectation: expectation,
        preparation,
        binExists: { state: "observed", value: binExists },
        entrypoint,
      };
    }
    if (installed.status !== 0)
      return {
        mechanism: "git-dependency",
        gitDependencyVariant: variant,
        gitDependencyExpectation: expectation,
        preparation,
        binExists: indeterminate("準備工程が失敗したためbinを検証できません"),
        entrypoint: commandIndeterminate(
          "準備工程が失敗したため公開入口を起動できません",
        ),
      };
    if (!fs.existsSync(executable))
      return {
        mechanism: "git-dependency",
        gitDependencyVariant: variant,
        gitDependencyExpectation: expectation,
        preparation,
        binExists: { state: "observed", value: false },
        entrypoint: commandIndeterminate(
          "公開binが存在しないため公開入口を起動できません",
        ),
      };
    try {
      return {
        mechanism: "git-dependency",
        gitDependencyVariant: variant,
        gitDependencyExpectation: expectation,
        preparation,
        binExists: { state: "observed", value: true },
        entrypoint: processObservation(
          runProcess(executable, [], workingDirectory, {
            allowFailure: true,
            env,
          }),
        ),
      };
    } catch (error) {
      return {
        mechanism: "git-dependency",
        gitDependencyVariant: variant,
        gitDependencyExpectation: expectation,
        preparation,
        binExists: { state: "observed", value: true },
        entrypoint: commandIndeterminate(
          `公開入口の終了値を観測できません: ${error instanceof Error ? error.message : String(error)}`,
        ),
      };
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function observeGitDependencyComposite(
  input: GitDependencyCommonInput,
  runProcess: ProcessRunner,
): GitDependencyCompositeObservation {
  return composeGitDependencyObservation({
    npm: observeGitDependency(
      { ...input, packageManager: "npm", allowBuilds: false },
      runProcess,
    ),
    pnpmWithoutAllowBuilds: observeGitDependency(
      { ...input, packageManager: "pnpm", allowBuilds: false },
      runProcess,
    ),
    pnpmWithAllowBuilds: observeGitDependency(
      { ...input, packageManager: "pnpm", allowBuilds: true },
      runProcess,
    ),
  });
}

/**
 * 1MiB直上では子processが終了して欠陥が現れない場合があるため、利用者報告と
 * 同じ3MiBのignored出力を作る。深いdirectory名でpath長を稼ぎ、生成file数を抑える。
 */
const IGNORED_OUTPUT_BYTES = 3 * 1024 * 1024;

function fillIgnoredArtifacts(repository: string): number {
  const directory = path.join(
    repository,
    "node_modules",
    "d".repeat(120),
    "e".repeat(120),
    "g".repeat(120),
  );
  fs.mkdirSync(directory, { recursive: true });
  let bytes = 0;
  for (let index = 0; bytes < IGNORED_OUTPUT_BYTES; index += 1) {
    const file = path.join(
      directory,
      `${String(index).padStart(6, "0")}${"f".repeat(240)}`,
    );
    fs.writeFileSync(file, "");
    bytes += Buffer.byteLength(path.relative(repository, file)) + 1;
  }
  return bytes;
}

function requireSuccessfulPreparation(
  result: ProcessResult,
  label: string,
): void {
  if (result.status !== 0)
    throw new Error(
      `${label}が終了値${result.status}で失敗しました: ${result.stderr}`,
    );
}

function prepareScaleRepository(
  repository: string,
  env: NodeJS.ProcessEnv,
  runProcess: ProcessRunner,
): number {
  fs.mkdirSync(repository);
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["config", "user.email", "test@example.invalid"],
    ["config", "user.name", "Consumer Acceptance"],
  ])
    requireSuccessfulPreparation(
      runProcess("git", args, repository, { allowFailure: true, env }),
      `git ${args[0]}`,
    );
  fs.writeFileSync(path.join(repository, ".gitignore"), "node_modules/\n");
  fs.writeFileSync(path.join(repository, "README.md"), "# scale fixture\n");
  for (const args of [
    ["add", ".gitignore", "README.md"],
    ["commit", "-q", "-m", "fixture"],
  ])
    requireSuccessfulPreparation(
      runProcess("git", args, repository, { allowFailure: true, env }),
      `git ${args[0]}`,
    );
  const remote = path.join(path.dirname(repository), "scale-origin.git");
  for (const args of [
    ["init", "--bare", remote],
    ["remote", "add", "origin", remote],
    ["push", "-u", "origin", "main"],
    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
  ])
    requireSuccessfulPreparation(
      runProcess("git", args, repository, { allowFailure: true, env }),
      `git ${args[0]}`,
    );
  return fillIgnoredArtifacts(repository);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCliValidationFailure(result: ProcessResult): boolean {
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.result)) return false;
    const code = parsed.result.code;
    return typeof code === "string" && code.startsWith("ASC-CLI-VALIDATION-");
  } catch {
    return false;
  }
}

/**
 * 入力不備で規模依存経路へ着かなかった失敗と、出力上限超過そのものを分離する。
 * CLIがprocess境界のENOBUFSも共通診断へ包むため、診断codeだけでは区別しない。
 */
export function classifyScaleDependentEntrypoint(
  result: ProcessResult,
): CommandObservation {
  const output = `${result.stdout}\n${result.stderr}`;
  const scaleFailure =
    /\bENOBUFS\b|ERR_CHILD_PROCESS_STDIO_MAXBUFFER|maxBuffer/u.test(output);
  if (result.status !== 0 && isCliValidationFailure(result) && !scaleFailure)
    return {
      status: indeterminate(
        "規模に依存しない入力検証errorのため規模の観測へ到達しませんでした",
      ),
      stdout: result.stdout,
      stderr: result.stderr,
    };
  return processObservation(result);
}

/**
 * source経由のCLIでは配布境界を検査できないため、tarballから導入した公開binを
 * 大規模scratch repositoryに対して起動する。
 */
export function observeScaleDependentOutput(
  input: PackedArtifactInput,
  runProcess: ProcessRunner = run,
): AtomicConsumerAcceptanceObservation {
  let scaleFixtureBytes: ObservationValue<number> = indeterminate(
    "規模fixtureの生成byte数を観測できません",
  );
  const observation = observeInstalledArtifact(
    input,
    "scale-output",
    ({ executable, temporaryDirectory, env }, execute) => {
      const repository = path.join(temporaryDirectory, "scratch-repository");
      scaleFixtureBytes = {
        state: "observed",
        value: prepareScaleRepository(repository, env, execute),
      };
      const result = execute(
        executable,
        ["worktree", "survey", `--root=${repository}`],
        repository,
        { allowFailure: true, env },
      );
      return result;
    },
    runProcess,
  );
  if (observation.entrypoint.status.state === "indeterminate")
    return { ...observation, scaleFixtureBytes };
  return {
    ...observation,
    scaleFixtureBytes,
    entrypoint: classifyScaleDependentEntrypoint({
      status: observation.entrypoint.status.value,
      stdout: observation.entrypoint.stdout,
      stderr: observation.entrypoint.stderr,
    }),
  };
}

/**
 * 呼び出し側が要求した機構だけを同一tarballから観測し、欠測や未知機構も
 * 評価器のfail-closed判定へ渡す。
 */
export function checkConsumerAcceptance(
  input: ConsumerAcceptanceCheckInput,
  runProcess: ProcessRunner = run,
): ConsumerAcceptanceResult {
  const observations: ConsumerAcceptanceObservation[] = [];
  let rejected = false;
  for (const mechanism of input.mechanisms) {
    if (!isConsumerAcceptanceMechanism(mechanism)) continue;
    if (rejected) {
      // 不合格確定後も高価な観測を続ける必要はないが、未実行を欠測と混同させない。
      if (!observations.some((item) => item.mechanism === mechanism))
        observations.push(
          skippedObservation(
            mechanism,
            "先行機構が不合格のため実行していません",
          ),
        );
      continue;
    }
    let observation: ConsumerAcceptanceObservation;
    if (mechanism === "git-dependency") {
      const gitDependency = resolveGitDependencyInput(input, runProcess);
      observation = gitDependency.resolved
        ? observeGitDependencyComposite(gitDependency.input, runProcess)
        : failedObservation("git-dependency", gitDependency.reason);
    } else if (mechanism === "packed-bin")
      observation = observePackedArtifact(input, runProcess);
    else observation = observeScaleDependentOutput(input, runProcess);
    observations.push(observation);
    const status = evaluateConsumerAcceptance([observation], [mechanism])
      .mechanisms[0]?.status;
    if (status === "rejected") rejected = true;
  }
  return evaluateConsumerAcceptance(observations, input.mechanisms);
}

/**
 * 部分的な観測を成功扱いするとrelease gateを迂回できるため、未知・重複・欠測を
 * すべて不合格へ畳み込む。
 */
export function evaluateConsumerAcceptance(
  observations: readonly ConsumerAcceptanceObservation[],
  requestedMechanisms: readonly string[],
): ConsumerAcceptanceResult {
  const reasons: string[] = [];
  if (requestedMechanisms.length === 0)
    reasons.push("対象機構を1件以上指定してください");
  const uniqueMechanisms = [...new Set(requestedMechanisms)];
  if (uniqueMechanisms.length !== requestedMechanisms.length)
    reasons.push("対象機構が重複しています");
  const unknown = uniqueMechanisms.filter(
    (mechanism) => !isConsumerAcceptanceMechanism(mechanism),
  );
  if (unknown.length > 0)
    reasons.push(`未知の対象機構です: ${unknown.join(", ")}`);
  const mechanisms = uniqueMechanisms.map((mechanism) =>
    isConsumerAcceptanceMechanism(mechanism)
      ? evaluateObservation(mechanism, observations)
      : {
          mechanism,
          status: "indeterminate" as const,
          reasons: ["既知の対象機構ではありません"],
        },
  );
  return {
    accepted:
      reasons.length === 0 &&
      mechanisms.length > 0 &&
      mechanisms.every((mechanism) => mechanism.status === "accepted"),
    mechanisms,
    reasons,
  };
}

/**
 * 公開直前に値が欠けた場合も同一性を証明できないため、形式不正を不一致と同じく拒否する。
 */
export function evaluateArtifactIdentity(
  input: ArtifactIdentityInput,
): ArtifactIdentityResult {
  const values = [
    input.packedArtifactSha256,
    input.acceptedArtifactSha256,
    input.publicationArtifactSha256,
  ];
  const reasons: string[] = [];
  if (values.some((value) => !value || !/^[a-f0-9]{64}$/u.test(value)))
    reasons.push("artifact SHA-256を3者すべてから算出できません");
  if (reasons.length === 0 && new Set(values).size !== 1)
    reasons.push("artifact SHA-256の3者が一致しません");
  return { accepted: reasons.length === 0, reasons };
}

function commandLineInput(
  arguments_: readonly string[],
): ConsumerAcceptanceCheckInput {
  let tarballPath = "";
  let mechanisms: string[] = [];
  for (const argument of arguments_) {
    if (argument.startsWith("--tarball=")) {
      tarballPath = argument.slice("--tarball=".length);
      continue;
    }
    if (argument.startsWith("--mechanisms=")) {
      mechanisms = argument
        .slice("--mechanisms=".length)
        .split(",")
        .filter((value) => value !== "");
      continue;
    }
    throw new Error(`未知のoptionです: ${argument}`);
  }
  if (tarballPath === "") throw new Error("--tarballを指定してください");
  return {
    tarballPath,
    mechanisms,
    sourceRepositoryRoot: process.cwd(),
    temporaryStagingRoot: path.join(process.cwd(), ".agent-skill-chain", "tmp"),
  };
}

function main(): void {
  try {
    const result = checkConsumerAcceptance(
      commandLineInput(process.argv.slice(2)),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.accepted) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

// importされた検査を副作用なく再利用しつつ、release workflowからの直接実行だけをgateにする。
if (isExecutionEntry(import.meta.url)) main();
