import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  planAutoRelease,
  planRelease,
  type AutoReleasePlan,
  type ReleasePlan,
} from "../src/domain/release.js";
import { isPackageVersion, PACKAGE_VERSION } from "../src/lib/version.js";

function requiredEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name}を指定してください`);
  return value;
}

function booleanEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
): boolean {
  const value = requiredEnvironment(environment, name);
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name}はtrueまたはfalseで指定してください`);
}

function linesFromFile(file: string): string[] {
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/u)
    .filter((tag) => tag.length > 0);
}

function latestReleasedVersion(existingTags: string[]): string {
  let currentVersion = "0.3.0-0";
  for (const tag of existingTags) {
    const version = tag.startsWith("v") ? tag.slice(1) : "";
    if (!isPackageVersion(version)) continue;
    const comparison = planRelease({
      currentVersion,
      requestedVersion: version,
      dryRun: true,
      publishNpm: false,
      actor: "version-comparison",
      ref: "main",
      refSha: "0000000000000000000000000000000000000000",
      defaultBranch: "main",
      existingTags: [],
      gates: [
        { name: "quality", passed: true },
        { name: "build", passed: true },
        { name: "package", passed: true },
        { name: "test", passed: true },
        { name: "typecheck", passed: true },
      ],
    });
    if (comparison.state !== "rejected") currentVersion = version;
  }
  return currentVersion;
}

export function planAutoReleaseFromEnvironment(
  environment: NodeJS.ProcessEnv,
): AutoReleasePlan {
  return planAutoRelease({
    currentVersion: PACKAGE_VERSION,
    existingTags: linesFromFile(
      requiredEnvironment(environment, "RELEASE_EXISTING_TAGS_FILE"),
    ),
    changedPaths: linesFromFile(
      requiredEnvironment(environment, "RELEASE_CHANGED_PATHS_FILE"),
    ),
    headCommitMessage: requiredEnvironment(
      environment,
      "RELEASE_HEAD_COMMIT_MESSAGE",
    ),
    ref: requiredEnvironment(environment, "RELEASE_REF"),
    defaultBranch: requiredEnvironment(environment, "RELEASE_DEFAULT_BRANCH"),
  });
}

function planManualReleaseFromEnvironment(
  environment: NodeJS.ProcessEnv,
): ReleasePlan {
  const existingTags = linesFromFile(
    requiredEnvironment(environment, "RELEASE_EXISTING_TAGS_FILE"),
  );
  const gates = JSON.parse(
    requiredEnvironment(environment, "RELEASE_GATES_JSON"),
  ) as unknown;
  const plan = planRelease({
    currentVersion:
      environment.RELEASE_CURRENT_VERSION ??
      latestReleasedVersion(existingTags),
    requestedVersion: requiredEnvironment(
      environment,
      "RELEASE_REQUESTED_VERSION",
    ),
    dryRun: booleanEnvironment(environment, "RELEASE_DRY_RUN"),
    publishNpm: booleanEnvironment(environment, "RELEASE_PUBLISH_NPM"),
    actor: requiredEnvironment(environment, "RELEASE_ACTOR"),
    ref: requiredEnvironment(environment, "RELEASE_REF"),
    refSha: requiredEnvironment(environment, "RELEASE_REF_SHA"),
    defaultBranch: requiredEnvironment(environment, "RELEASE_DEFAULT_BRANCH"),
    existingTags,
    gates,
  });

  if (plan.version !== PACKAGE_VERSION) {
    const reason = `指定version「${plan.version}」はpackage.json.version「${PACKAGE_VERSION}」と一致しません`;
    plan.state = "rejected";
    plan.reasons.push(reason);
    plan.diagnostic = {
      ruleId: "ASC-RELEASE-PLAN",
      reasons: [...plan.reasons],
    };
    plan.stages = plan.stages.map(({ stage }) => ({
      stage,
      enabled: false,
      reason:
        stage === "validate"
          ? "package versionの検証に失敗した"
          : "計画が拒否されたため外部更新しない",
    }));
  }

  return plan;
}

const entrypointPath = process.argv[1];
if (
  entrypointPath !== undefined &&
  path.resolve(entrypointPath) === fileURLToPath(import.meta.url)
) {
  const plan =
    process.env.RELEASE_MODE === "auto"
      ? planAutoReleaseFromEnvironment(process.env)
      : planManualReleaseFromEnvironment(process.env);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (plan.state === "rejected") process.exitCode = 2;
}
