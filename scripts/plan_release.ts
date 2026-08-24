import fs from "node:fs";
import { planRelease } from "../src/domain/release.js";
import { isPackageVersion, PACKAGE_VERSION } from "../src/lib/version.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name}を指定してください`);
  return value;
}

function booleanEnvironment(name: string): boolean {
  const value = requiredEnvironment(name);
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name}はtrueまたはfalseで指定してください`);
}

const tagsFile = requiredEnvironment("RELEASE_EXISTING_TAGS_FILE");
const existingTags = fs
  .readFileSync(tagsFile, "utf8")
  .split(/\r?\n/u)
  .filter((tag) => tag.length > 0);
const gates = JSON.parse(requiredEnvironment("RELEASE_GATES_JSON")) as unknown;

function latestReleasedVersion(): string {
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

const plan = planRelease({
  currentVersion:
    process.env.RELEASE_CURRENT_VERSION ?? latestReleasedVersion(),
  requestedVersion: requiredEnvironment("RELEASE_REQUESTED_VERSION"),
  dryRun: booleanEnvironment("RELEASE_DRY_RUN"),
  publishNpm: booleanEnvironment("RELEASE_PUBLISH_NPM"),
  actor: requiredEnvironment("RELEASE_ACTOR"),
  ref: requiredEnvironment("RELEASE_REF"),
  refSha: requiredEnvironment("RELEASE_REF_SHA"),
  defaultBranch: requiredEnvironment("RELEASE_DEFAULT_BRANCH"),
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

process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
if (plan.state === "rejected") process.exitCode = 2;
