import { isPackageVersion, packageReleaseVersion } from "../lib/version.js";

export type ReleaseStage =
  "validate" | "tag" | "github_release" | "npm_publish";

export interface ReleasePlanInput {
  currentVersion: string;
  requestedVersion: string;
  dryRun: boolean;
  publishNpm: boolean;
  actor: string;
  ref: string;
  refSha: string;
  defaultBranch: string;
  existingTags: string[];
  gates: Array<{ name: string; passed: boolean }>;
}

export interface ReleaseDiagnostic {
  ruleId: "ASC-RELEASE-PLAN";
  reasons: string[];
}

export interface ReleasePlan {
  state: "ready" | "dry-run" | "rejected";
  version: string;
  tag: string;
  stages: Array<{ stage: ReleaseStage; enabled: boolean; reason: string }>;
  reasons: string[];
  diagnostic?: ReleaseDiagnostic;
}

export interface ReleaseOutcome {
  stage: ReleaseStage;
  state: "succeeded" | "failed" | "skipped";
  detail: string;
}

export interface AutoReleaseInput {
  currentVersion: string;
  existingTags: string[];
  changedPaths: string[];
  headCommitMessage: string;
  ref: string;
  defaultBranch: string;
}

export interface AutoReleasePlan {
  state: "release" | "bump-then-release" | "skipped";
  version: string;
  tag: string;
  needsVersionBump: boolean;
  reasons: string[];
}

const RELEASE_STAGES: readonly ReleaseStage[] = [
  "validate",
  "tag",
  "github_release",
  "npm_publish",
];
const REQUIRED_GATES = [
  "quality",
  "build",
  "package",
  "test",
  "typecheck",
] as const;
const RELEASE_INPUT_KEYS = new Set([
  "currentVersion",
  "requestedVersion",
  "dryRun",
  "publishNpm",
  "actor",
  "ref",
  "refSha",
  "defaultBranch",
  "existingTags",
  "gates",
]);
const AUTO_RELEASE_INPUT_KEYS = new Set([
  "currentVersion",
  "existingTags",
  "changedPaths",
  "headCommitMessage",
  "ref",
  "defaultBranch",
]);
const RELEASE_PATH_PREFIXES = [
  "src/",
  "bin/",
  "scripts/",
  ".agent-skill-chain/",
] as const;
const RELEASE_PATHS = new Set([
  "AGENTS.md",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.build.json",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => keys.has(key));
}

function isGate(value: unknown): value is { name: string; passed: boolean } {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, new Set(["name", "passed"])) &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    typeof value.passed === "boolean"
  );
}

function skippedAutoRelease(
  version: string,
  reasons: string[],
): AutoReleasePlan {
  return {
    state: "skipped",
    version,
    tag: version.length > 0 ? `v${version}` : "",
    needsVersionBump: false,
    reasons,
  };
}

function validateAutoReleaseInput(value: unknown): {
  input?: AutoReleaseInput;
  version: string;
  reasons: string[];
} {
  if (!isRecord(value))
    return {
      version: "",
      reasons: ["自動release計画入力はobjectでなければなりません"],
    };
  const version =
    typeof value.currentVersion === "string" ? value.currentVersion : "";
  const reasons: string[] = [];
  if (!hasOnlyKeys(value, AUTO_RELEASE_INPUT_KEYS))
    reasons.push("自動release計画入力に未知fieldがあります");
  for (const key of [
    "currentVersion",
    "headCommitMessage",
    "ref",
    "defaultBranch",
  ] as const)
    if (typeof value[key] !== "string")
      reasons.push(`${key}は文字列でなければなりません`);
  for (const key of ["existingTags", "changedPaths"] as const)
    if (
      !Array.isArray(value[key]) ||
      value[key].some((item) => typeof item !== "string")
    )
      reasons.push(`${key}は文字列配列でなければなりません`);
  if (reasons.length > 0) return { version, reasons };
  return {
    version,
    reasons,
    input: {
      currentVersion: value.currentVersion as string,
      existingTags: value.existingTags as string[],
      changedPaths: value.changedPaths as string[],
      headCommitMessage: value.headCommitMessage as string,
      ref: value.ref as string,
      defaultBranch: value.defaultBranch as string,
    },
  };
}

function isReleasePath(changedPath: string): boolean {
  const normalized = changedPath.startsWith("./")
    ? changedPath.slice(2)
    : changedPath;
  return (
    RELEASE_PATHS.has(normalized) ||
    RELEASE_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

function nextAutoReleaseVersion(version: string): string | undefined {
  const withoutBuild = version.split("+", 1)[0] ?? version;
  const prereleaseSeparator = withoutBuild.indexOf("-");
  if (prereleaseSeparator >= 0) {
    const core = withoutBuild.slice(0, prereleaseSeparator);
    const identifiers = withoutBuild.slice(prereleaseSeparator + 1).split(".");
    const lastIdentifier = identifiers.at(-1);
    if (!lastIdentifier || !/^\d+$/u.test(lastIdentifier)) return undefined;
    identifiers[identifiers.length - 1] = (
      BigInt(lastIdentifier) + 1n
    ).toString();
    const candidate = `${core}-${identifiers.join(".")}`;
    return isPackageVersion(candidate) ? candidate : undefined;
  }
  const core = packageReleaseVersion(version).split(".");
  const patch = core[2];
  if (core.length !== 3 || !patch || !/^\d+$/u.test(patch)) return undefined;
  const candidate = `${core[0]}.${core[1]}.${BigInt(patch) + 1n}`;
  return isPackageVersion(candidate) ? candidate : undefined;
}

export function planAutoRelease(value: unknown): AutoReleasePlan {
  const validated = validateAutoReleaseInput(value);
  if (!validated.input)
    return skippedAutoRelease(validated.version, validated.reasons);
  const input = validated.input;
  if (!isPackageVersion(input.currentVersion))
    return skippedAutoRelease(input.currentVersion, [
      `currentVersion「${input.currentVersion}」は0.3.xの正しいversion形式ではありません`,
    ]);
  if (input.ref !== input.defaultBranch)
    return skippedAutoRelease(input.currentVersion, [
      `release対象ref「${input.ref}」は既定branch「${input.defaultBranch}」と一致しないため停止します`,
    ]);
  if (input.headCommitMessage.includes("[skip ci]"))
    return skippedAutoRelease(input.currentVersion, [
      "head commit messageに[skip ci]があるため再帰releaseを停止します",
    ]);
  if (!input.changedPaths.some(isReleasePath))
    return skippedAutoRelease(input.currentVersion, [
      "release対象pathの変更がないため自動releaseを停止します",
    ]);

  const currentTag = `v${input.currentVersion}`;
  if (!input.existingTags.includes(currentTag))
    return {
      state: "release",
      version: input.currentVersion,
      tag: currentTag,
      needsVersionBump: false,
      reasons: [
        `package.jsonのversionに対応するtag「${currentTag}」が存在しないためreleaseします`,
      ],
    };

  const nextVersion = nextAutoReleaseVersion(input.currentVersion);
  if (!nextVersion)
    return skippedAutoRelease(input.currentVersion, [
      `version「${input.currentVersion}」を0.3.x内で安全にbumpできないため停止します`,
    ]);
  return {
    state: "bump-then-release",
    version: nextVersion,
    tag: `v${nextVersion}`,
    needsVersionBump: true,
    reasons: [
      `tag「${currentTag}」が既に存在するためversionを「${nextVersion}」へbumpしてからreleaseします`,
    ],
  };
}

function validatePlanInput(value: unknown): {
  input?: ReleasePlanInput;
  reasons: string[];
  requestedVersion: string;
} {
  if (!isRecord(value))
    return {
      reasons: ["release計画入力はobjectでなければなりません"],
      requestedVersion: "",
    };
  const requestedVersion =
    typeof value.requestedVersion === "string" ? value.requestedVersion : "";
  const reasons: string[] = [];
  if (!hasOnlyKeys(value, RELEASE_INPUT_KEYS))
    reasons.push("release計画入力に未知fieldがあります");
  for (const key of [
    "currentVersion",
    "requestedVersion",
    "actor",
    "ref",
    "refSha",
    "defaultBranch",
  ] as const)
    if (typeof value[key] !== "string")
      reasons.push(`${key}は文字列でなければなりません`);
  for (const key of ["dryRun", "publishNpm"] as const)
    if (typeof value[key] !== "boolean")
      reasons.push(`${key}はbooleanでなければなりません`);
  if (
    !Array.isArray(value.existingTags) ||
    value.existingTags.some((tag) => typeof tag !== "string")
  )
    reasons.push("existingTagsは文字列配列でなければなりません");
  if (!Array.isArray(value.gates) || value.gates.some((gate) => !isGate(gate)))
    reasons.push("gatesはnameとpassedを持つ配列でなければなりません");
  if (reasons.length > 0) return { reasons, requestedVersion };
  const input: ReleasePlanInput = {
    currentVersion: value.currentVersion as string,
    requestedVersion: value.requestedVersion as string,
    dryRun: value.dryRun as boolean,
    publishNpm: value.publishNpm as boolean,
    actor: value.actor as string,
    ref: value.ref as string,
    refSha: value.refSha as string,
    defaultBranch: value.defaultBranch as string,
    existingTags: value.existingTags as string[],
    gates: value.gates as Array<{ name: string; passed: boolean }>,
  };
  return { input, reasons, requestedVersion };
}

function prereleaseIdentifiers(version: string): string[] | undefined {
  const withoutBuild = version.split("+", 1)[0] ?? version;
  const separator = withoutBuild.indexOf("-");
  return separator < 0
    ? undefined
    : withoutBuild.slice(separator + 1).split(".");
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumeric = /^\d+$/u.test(left);
  const rightNumeric = /^\d+$/u.test(right);
  if (leftNumeric && rightNumeric) {
    const leftNumber = BigInt(left);
    const rightNumber = BigInt(right);
    return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function comparePackageVersions(left: string, right: string): number {
  const leftCore = packageReleaseVersion(left).split(".");
  const rightCore = packageReleaseVersion(right).split(".");
  for (let index = 0; index < 3; index += 1) {
    const comparison = compareIdentifiers(
      leftCore[index] ?? "0",
      rightCore[index] ?? "0",
    );
    if (comparison !== 0) return comparison;
  }
  const leftPrerelease = prereleaseIdentifiers(left);
  const rightPrerelease = prereleaseIdentifiers(right);
  if (!leftPrerelease && !rightPrerelease) return 0;
  if (!leftPrerelease) return 1;
  if (!rightPrerelease) return -1;
  const length = Math.max(leftPrerelease.length, rightPrerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftPrerelease[index];
    const rightIdentifier = rightPrerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    const comparison = compareIdentifiers(leftIdentifier, rightIdentifier);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function rejectedPlan(version: string, reasons: string[]): ReleasePlan {
  const tag = version.length > 0 ? `v${version}` : "";
  return {
    state: "rejected",
    version,
    tag,
    stages: RELEASE_STAGES.map((stage) => ({
      stage,
      enabled: false,
      reason:
        stage === "validate"
          ? "release条件の検証に失敗した"
          : "計画が拒否されたため外部更新しない",
    })),
    reasons,
    diagnostic: { ruleId: "ASC-RELEASE-PLAN", reasons: [...reasons] },
  };
}

export function planRelease(value: unknown): ReleasePlan {
  const validated = validatePlanInput(value);
  if (!validated.input)
    return rejectedPlan(validated.requestedVersion, validated.reasons);
  const input = validated.input;
  const reasons: string[] = [];
  if (!isPackageVersion(input.requestedVersion))
    reasons.push(
      `requestedVersion「${input.requestedVersion}」は0.3.xの正しいversion形式ではありません`,
    );
  if (!isPackageVersion(input.currentVersion))
    reasons.push(
      `currentVersion「${input.currentVersion}」は0.3.xの正しいversion形式ではありません`,
    );
  if (
    isPackageVersion(input.requestedVersion) &&
    isPackageVersion(input.currentVersion) &&
    comparePackageVersions(input.requestedVersion, input.currentVersion) <= 0
  )
    reasons.push(
      `requestedVersion「${input.requestedVersion}」はcurrentVersion「${input.currentVersion}」から単調増加していません`,
    );
  const tag = `v${input.requestedVersion}`;
  if (input.existingTags.includes(tag))
    reasons.push(`作成予定tag「${tag}」は既に存在します`);
  if (input.ref !== input.defaultBranch)
    reasons.push(
      `release対象ref「${input.ref}」は既定branch「${input.defaultBranch}」と一致しません`,
    );
  if (!/^[0-9a-f]{40}$/iu.test(input.refSha))
    reasons.push("refShaは40桁hexでなければなりません");
  if (input.actor.trim().length === 0)
    reasons.push("release実行actorを空にできません");
  const gateNames = new Set(input.gates.map(({ name }) => name));
  const duplicateGates = input.gates
    .map(({ name }) => name)
    .filter((name, index, names) => names.indexOf(name) !== index);
  if (duplicateGates.length > 0)
    reasons.push(
      `gate名が重複しています: ${[...new Set(duplicateGates)].join(", ")}`,
    );
  const missingGates = REQUIRED_GATES.filter((name) => !gateNames.has(name));
  if (missingGates.length > 0)
    reasons.push(`必須gateが欠落しています: ${missingGates.join(", ")}`);
  const failedGates = input.gates
    .filter(({ passed }) => !passed)
    .map(({ name }) => name);
  if (failedGates.length > 0)
    reasons.push(`失敗したgateがあります: ${failedGates.join(", ")}`);
  if (reasons.length > 0) return rejectedPlan(input.requestedVersion, reasons);

  if (input.dryRun)
    return {
      state: "dry-run",
      version: input.requestedVersion,
      tag,
      stages: RELEASE_STAGES.map((stage) => ({
        stage,
        enabled: stage === "validate",
        reason:
          stage === "validate"
            ? "release前の検証を実行する"
            : "dry-runのため外部更新しない",
      })),
      reasons: [],
    };

  return {
    state: "ready",
    version: input.requestedVersion,
    tag,
    stages: [
      { stage: "validate", enabled: true, reason: "release前検証に合格した" },
      {
        stage: "tag",
        enabled: true,
        reason: "明示されたversion tagを作成する",
      },
      {
        stage: "github_release",
        enabled: true,
        reason: "検証済みtagからGitHub Releaseを作成する",
      },
      {
        stage: "npm_publish",
        enabled: input.publishNpm,
        reason: input.publishNpm
          ? "publishNpmが明示されたためprovenance付きで公開する"
          : "publishNpmが明示されていないため公開しない",
      },
    ],
    reasons: [],
  };
}

function isReleaseOutcome(value: unknown): value is ReleaseOutcome {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, new Set(["stage", "state", "detail"])) &&
    RELEASE_STAGES.includes(value.stage as ReleaseStage) &&
    ["succeeded", "failed", "skipped"].includes(value.state as string) &&
    typeof value.detail === "string" &&
    value.detail.trim().length > 0
  );
}

export function summarizeReleaseOutcome(outcomes: unknown): {
  state: "succeeded" | "partial" | "failed";
  completed: ReleaseStage[];
  pending: ReleaseStage[];
  recovery: string[];
} {
  if (
    !Array.isArray(outcomes) ||
    outcomes.some((item) => !isReleaseOutcome(item))
  )
    return {
      state: "failed",
      completed: [],
      pending: [...RELEASE_STAGES],
      recovery: [
        "操作結果の形式を確認し、外部状態を読み直してからrelease計画を再作成してください",
      ],
    };
  const records = outcomes as ReleaseOutcome[];
  const duplicates = records.filter(
    ({ stage }, index) =>
      records.findIndex((item) => item.stage === stage) !== index,
  );
  if (duplicates.length > 0)
    return {
      state: "failed",
      completed: [],
      pending: [...RELEASE_STAGES],
      recovery: [
        `stage結果の重複（${[...new Set(duplicates.map(({ stage }) => stage))].join(", ")}）を解消し、外部状態を再確認してください`,
      ],
    };
  const byStage = new Map(records.map((outcome) => [outcome.stage, outcome]));
  const completed = RELEASE_STAGES.filter(
    (stage) => byStage.get(stage)?.state === "succeeded",
  );
  const pending = RELEASE_STAGES.filter((stage) => {
    const state = byStage.get(stage)?.state;
    return state === undefined || state === "failed";
  });
  const failed = records.some(({ state }) => state === "failed");
  const state =
    failed || pending.length > 0
      ? completed.length > 0
        ? "partial"
        : "failed"
      : "succeeded";
  const recovery: string[] = [];
  if (state !== "succeeded" && completed.includes("npm_publish"))
    recovery.push(
      "npm公開済みversionは削除せず、npm deprecateで利用非推奨理由と代替versionを案内してください",
    );
  if (state !== "succeeded" && completed.includes("github_release"))
    recovery.push(
      "GitHub Release作成済みの場合は対象tagとの対応を確認し、Releaseを削除してから再実行してください",
    );
  if (state !== "succeeded" && completed.includes("tag"))
    recovery.push(
      "Git tag作成済みの場合は参照SHAを確認し、GitHub Release未公開を確認してからremoteとlocalのtagを削除してください",
    );
  if (state !== "succeeded" && pending.length > 0)
    recovery.push(
      `未完了stage（${pending.join(", ")}）の外部状態を確認し、原因を解消して新しいworkflow runで再計画してください`,
    );
  return { state, completed, pending, recovery };
}

function indentation(line: string): number {
  return /^\s*/u.exec(line)?.[0].length ?? 0;
}

function yamlBlock(lines: string[], start: number): string[] {
  const parentIndent = indentation(lines[start] ?? "");
  const block: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim().length > 0 && indentation(line) <= parentIndent) break;
    block.push(line);
  }
  return block;
}

function inputHasDefault(
  lines: string[],
  inputName: string,
  expected: "true" | "false",
): boolean {
  const inputPattern = new RegExp(`^\\s*${inputName}:\\s*$`, "u");
  const index = lines.findIndex((line) => inputPattern.test(line));
  if (index < 0) return false;
  return yamlBlock(lines, index).some((line) => {
    const match = /^\s*default:\s*["']?(true|false)["']?\s*$/u.exec(line);
    return match?.[1] === expected;
  });
}

function blockHasSafeNpmPublishCondition(block: string[]): boolean {
  const text = block.join("\n");
  return (
    /github\.event_name\s*==\s*['"]workflow_dispatch['"]/u.test(text) &&
    /inputs\.publish_npm\s*==\s*(?:true|['"]true['"])/u.test(text)
  );
}

function jobBlockContaining(lines: string[], lineIndex: number): string[] {
  for (let index = lineIndex; index >= 0; index -= 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/u.test(lines[index] ?? ""))
      return yamlBlock(lines, index);
  }
  return [];
}

function blockHasNpmRun(block: string[], scriptName: string): boolean {
  const escapedScriptName = scriptName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`\\bnpm\\s+run\\s+${escapedScriptName}(?=\\s|$)`, "u").test(
    block.join("\n"),
  );
}

function blockHasNpmTest(block: string[]): boolean {
  return /\bnpm\s+(?:run\s+)?test(?=\s|$)/u.test(block.join("\n"));
}

export function validateReleaseWorkflow(yaml: string): {
  valid: boolean;
  errors: string[];
  checks: string[];
} {
  if (typeof yaml !== "string")
    return {
      valid: false,
      errors: ["workflow YAML本文は文字列でなければなりません"],
      checks: [],
    };
  const lines = yaml.split(/\r?\n/u);
  const errors: string[] = [];
  const checks: string[] = [];
  const onIndex = lines.findIndex((line) =>
    /^\s*(?:on|["']on["']):\s*$/u.test(line),
  );
  const onBlock = onIndex < 0 ? [] : yamlBlock(lines, onIndex);
  if (
    onIndex < 0 ||
    !onBlock.some((line) => /^\s*workflow_dispatch:\s*$/u.test(line))
  )
    errors.push("on:にはworkflow_dispatchを宣言してください");
  else checks.push("手動workflow_dispatch triggerを確認した");
  const pushIndex = onBlock.findIndex((line) => /^\s*push:\s*$/u.test(line));
  const pushBlock = pushIndex < 0 ? [] : yamlBlock(onBlock, pushIndex);
  if (pushIndex < 0) errors.push("on:にはpush triggerを宣言してください");
  else checks.push("自動push triggerを確認した");
  if (
    !pushBlock.some((line) =>
      /^\s*branches:\s*\[\s*['"]?main['"]?\s*\]\s*$/u.test(line),
    )
  )
    errors.push("push.branchesは[main]に限定してください");
  else checks.push("push branchがmainに限定されていることを確認した");
  const expectedReleasePaths = [
    "src/**",
    "bin/**",
    "scripts/**",
    ".agent-skill-chain/**",
    "AGENTS.md",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "tsconfig.build.json",
  ];
  const hasPaths = pushBlock.some((line) => /^\s*paths:\s*$/u.test(line));
  const missingReleasePaths = expectedReleasePaths.filter(
    (expectedPath) =>
      !pushBlock.some((line) => {
        const match = /^\s*-\s*['"]?([^'"]+)['"]?\s*$/u.exec(line);
        return match?.[1] === expectedPath;
      }),
  );
  if (!hasPaths || missingReleasePaths.length > 0)
    errors.push(
      `push.pathsへrelease対象をすべて宣言してください${
        missingReleasePaths.length > 0
          ? `: ${missingReleasePaths.join(", ")}`
          : ""
      }`,
    );
  else checks.push("push pathsがrelease対象に限定されていることを確認した");
  const concurrencyIndex = lines.findIndex((line) =>
    /^\s*concurrency:\s*$/u.test(line),
  );
  const concurrencyBlock =
    concurrencyIndex < 0 ? [] : yamlBlock(lines, concurrencyIndex);
  if (concurrencyIndex < 0)
    errors.push("main更新の直列化にconcurrencyを宣言してください");
  else if (
    !concurrencyBlock.some((line) =>
      /^\s*group:\s*main-mutator\s*$/u.test(line),
    ) ||
    !concurrencyBlock.some((line) =>
      /^\s*cancel-in-progress:\s*false\s*$/u.test(line),
    )
  )
    errors.push("concurrencyはmain-mutatorをcancelせず直列実行してください");
  else checks.push("main-mutator concurrency宣言を確認した");
  const validateJobIndex = lines.findIndex((line) =>
    /^ {2}validate:\s*$/u.test(line),
  );
  const validateJobBlock =
    validateJobIndex < 0 ? [] : yamlBlock(lines, validateJobIndex);
  if (!blockHasNpmRun(validateJobBlock, "prepack"))
    errors.push("validate jobは引き続きnpm run prepackを実行してください");
  else checks.push("validate jobのnpm run prepackを確認した");
  if (
    !validateJobBlock.some((line) =>
      /^\s*if:\s*.*!\s*contains\(github\.event\.head_commit\.message,\s*['"]\[skip ci\]['"]\)/u.test(
        line,
      ),
    )
  )
    errors.push("validate jobに[skip ci]のhead commit message guardが必要です");
  else checks.push("job-levelの[skip ci]再帰防止guardを確認した");
  const bumpVersionJobIndex = lines.findIndex((line) =>
    /^ {2}bump_version:\s*$/u.test(line),
  );
  const bumpVersionJobBlock =
    bumpVersionJobIndex < 0 ? [] : yamlBlock(lines, bumpVersionJobIndex);
  const requiredBumpGateScripts = [
    "project:quality",
    "build",
    "docs:format",
    "test:format",
    "trace:check",
    "architecture:check",
    "conformance:check",
    "package:check",
  ];
  const missingBumpGateScripts = requiredBumpGateScripts.filter(
    (scriptName) => !blockHasNpmRun(bumpVersionJobBlock, scriptName),
  );
  if (missingBumpGateScripts.length > 0)
    errors.push(
      `bump_version jobに必要な品質gateがありません: ${missingBumpGateScripts
        .map((scriptName) => `npm run ${scriptName}`)
        .join(", ")}`,
    );
  else checks.push("bump_version jobの必須release gateを確認した");
  if (
    !blockHasNpmRun(bumpVersionJobBlock, "quality") &&
    !blockHasNpmTest(bumpVersionJobBlock)
  )
    errors.push(
      "bump_version jobはnpm run qualityまたは同等のtest実行stepを含めてください",
    );
  else checks.push("bump_version jobのtest実行gateを確認した");
  if (
    blockHasNpmRun(bumpVersionJobBlock, "prepack") ||
    blockHasNpmRun(bumpVersionJobBlock, "audit:check")
  )
    errors.push(
      "bump_version jobはnpm run prepackまたはaudit:checkを含めないでください",
    );
  else checks.push("bump_version jobがaudit:checkを含まないことを確認した");
  if (!/git\s+commit\b[^\n]*\[skip ci\]/u.test(yaml))
    errors.push("version bump commit messageに[skip ci]が必要です");
  else checks.push("version bump commitの[skip ci]を確認した");
  if (
    !/gh\s+pr\s+(?:create|edit)\b[^\n]*--title\s+[^\n]*\[skip ci\]/u.test(yaml)
  )
    errors.push(
      "bump PR titleに[skip ci]を含めてmerge commitの再帰を防いでください",
    );
  else checks.push("bump PR titleの[skip ci]を確認した");
  if (
    !/secrets\.RELEASE_MAIN_PAT/u.test(yaml) ||
    !/gh\s+pr\s+merge\b[^\n]*--admin/u.test(yaml)
  )
    errors.push(
      "version bumpはRELEASE_MAIN_PATを使うPRのadmin mergeが必要です",
    );
  else checks.push("version bumpのPR経由admin mergeを確認した");
  if (/git\s+push\s+origin\s+(?:main|HEAD:refs\/heads\/main)\b/u.test(yaml))
    errors.push("version bumpをmainへ直接pushしないでください");
  else checks.push("mainへの直接pushがないことを確認した");
  const permissionsDeclared = lines.some((line) =>
    /^\s*permissions:\s*$/u.test(line),
  );
  if (!permissionsDeclared) errors.push("permissionsを明示してください");
  else checks.push("permissions宣言を確認した");
  if (!lines.some((line) => /^\s*contents:\s*(?:read|write)\s*$/u.test(line)))
    errors.push("permissions.contentsはreadまたはwriteを明示してください");
  else checks.push("contents権限の明示を確認した");
  if (!inputHasDefault(lines, "dry_run", "true"))
    errors.push("dry_run入力を宣言しdefaultをtrueにしてください");
  else checks.push("dry_run=trueの安全な既定値を確認した");
  if (!inputHasDefault(lines, "publish_npm", "false"))
    errors.push("publish_npm入力を宣言しdefaultをfalseにしてください");
  else checks.push("publish_npm=falseの安全な既定値を確認した");
  const npmPublishLines = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /\bnpm\s+publish\b/u.test(line));
  if (
    npmPublishLines.some(
      ({ index }) =>
        !blockHasSafeNpmPublishCondition(jobBlockContaining(lines, index)),
    )
  )
    errors.push(
      "npm公開stepはworkflow_dispatchかつpublish_npmが真の場合だけ実行してください",
    );
  else
    checks.push("npm公開が明示的な手動入力だけに限定されていることを確認した");
  if (!/npm\s+run\s+(?:prepack|quality)\b/u.test(yaml))
    errors.push(
      "release前の品質gateとしてnpm run prepackまたはnpm run qualityが必要です",
    );
  else checks.push("release前の品質gateを確認した");
  if (!/git\s+ls-remote\s+--tags\b/u.test(yaml))
    errors.push("tag作成前後にremote tagの存在確認が必要です");
  else checks.push("Git tagの冪等な存在確認を確認した");
  if (!/gh\s+release\s+view\b/u.test(yaml))
    errors.push("GitHub Release作成前後に既存Releaseの確認が必要です");
  else checks.push("GitHub Releaseの冪等な存在確認を確認した");
  if (!/--title\s+["']\$RELEASE_TAG["']/u.test(yaml))
    errors.push(
      "GitHub Release名はpackage versionから導いたtag名と一致させてください",
    );
  else checks.push("GitHub Release名とtag名の一致を確認した");
  const secretOutput = lines.some(
    (line) =>
      /(?:^|\s)(?:echo|cat)(?:\s|$)/u.test(line) &&
      /(?:\$\{\{\s*secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN|TOKEN|PASSWORD|SECRET)/iu.test(
        line,
      ),
  );
  if (secretOutput)
    errors.push("秘密値をechoまたはcatで出力するstepがあります");
  else checks.push("秘密値をechoまたはcatで出力しないことを確認した");
  if (
    !lines.some((line) =>
      /^\s*-?\s*name:\s*.*[\u3040-\u30ff\u3400-\u9fff]/u.test(line),
    )
  )
    errors.push("日本語のstep名が必要です");
  else checks.push("日本語のstep名を確認した");
  return { valid: errors.length === 0, errors, checks };
}
