import fs from "node:fs";
import path from "node:path";
import { validateDistributionImpact } from "../src/domain/conformance.js";
import { pathToFileURL } from "node:url";
import { git } from "../src/lib/process.js";
import {
  parseJsonStrict,
  stableJson,
  type JsonValue,
} from "../src/lib/security.js";
import { isPackageVersion } from "../src/lib/version.js";

const AUDIT_DIRECTORY = "docs/reviews";
const AUDIT_NAME_PATTERN = /^\d+_課題\d+.*レビュー\.md$/u;
const RELEASE_BUMP_PREFIX = "chore(release): bump version to ";
const RELEASE_BUMP_PATHS = new Set(["package.json", "package-lock.json"]);

interface CommitTransition {
  commit: string;
  parent: string;
}

interface ReviewBoundary {
  implementation: string;
  reviewHead: string;
}

function lines(output: string): string[] {
  return output.trim().split(/\r?\n/u).filter(Boolean);
}

function commitParents(root: string, commit: string): string[] {
  return git(["show", "-s", "--format=%P", commit], root)
    .stdout.trim()
    .split(/\s+/u)
    .filter(Boolean);
}

function changedPaths(root: string, parent: string, commit: string): string[] {
  return lines(
    git(
      [
        "-c",
        "core.quotepath=false",
        "diff",
        "--name-only",
        `${parent}..${commit}`,
        "--",
      ],
      root,
    ).stdout,
  );
}

function releaseVersionFromSubject(subject: string): string | undefined {
  if (!subject.startsWith(RELEASE_BUMP_PREFIX)) return undefined;
  const [version] = subject.slice(RELEASE_BUMP_PREFIX.length).split(/\s+/u);
  return isPackageVersion(version) ? version : undefined;
}

function objectWithoutVersion(value: JsonValue): JsonValue | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "version"),
  );
}

function packageJsonOnlyChangesVersion(
  root: string,
  parent: string,
  commit: string,
): boolean {
  try {
    const before = objectWithoutVersion(
      parseJsonStrict(
        git(["show", `${parent}:package.json`], root).stdout,
        `${parent}:package.json`,
      ),
    );
    const after = objectWithoutVersion(
      parseJsonStrict(
        git(["show", `${commit}:package.json`], root).stdout,
        `${commit}:package.json`,
      ),
    );
    return (
      before !== undefined &&
      after !== undefined &&
      stableJson(before) === stableJson(after)
    );
  } catch {
    return false;
  }
}

function hasReleaseBumpChanges(
  root: string,
  parent: string,
  commit: string,
): boolean {
  const paths = changedPaths(root, parent, commit);
  if (
    paths.length === 0 ||
    paths.some((changedPath) => !RELEASE_BUMP_PATHS.has(changedPath))
  )
    return false;
  return (
    !paths.includes("package.json") ||
    packageJsonOnlyChangesVersion(root, parent, commit)
  );
}

function isDirectReleaseBump(root: string, commit: string): boolean {
  const parents = commitParents(root, commit);
  if (parents.length !== 1) return false;
  const subject = git(
    ["show", "-s", "--format=%s", commit],
    root,
  ).stdout.trim();
  return (
    releaseVersionFromSubject(subject) !== undefined &&
    hasReleaseBumpChanges(root, parents[0]!, commit)
  );
}

function isReleaseBumpSide(
  root: string,
  selectedParent: string,
  sideParent: string,
): boolean {
  const sideCommits = lines(
    git(["rev-list", `${selectedParent}..${sideParent}`], root).stdout,
  );
  return (
    sideCommits.length > 0 &&
    sideCommits.every((commit) => isDirectReleaseBump(root, commit))
  );
}

function isReleaseBumpTransition(
  root: string,
  transition: CommitTransition,
): boolean {
  const subject = git(
    ["show", "-s", "--format=%s", transition.commit],
    root,
  ).stdout.trim();
  if (
    releaseVersionFromSubject(subject) !== undefined &&
    hasReleaseBumpChanges(root, transition.parent, transition.commit)
  )
    return true;
  const parents = commitParents(root, transition.commit);
  return (
    parents.length > 1 &&
    hasReleaseBumpChanges(root, transition.parent, transition.commit) &&
    parents.some(
      (parent) =>
        parent !== transition.parent &&
        isReleaseBumpSide(root, transition.parent, parent),
    )
  );
}

function implementationPath(
  root: string,
  implementation: string,
  current: string,
): CommitTransition[] {
  const reversed: CommitTransition[] = [];
  let cursor = current;
  while (cursor !== implementation) {
    const parents = commitParents(root, cursor);
    const parent = parents.find((candidate) => {
      const ancestry = git(
        ["merge-base", "--is-ancestor", implementation, candidate],
        root,
        { allowFailure: true },
      );
      return ancestry.status === 0;
    });
    if (!parent) return [];
    reversed.push({ commit: cursor, parent });
    cursor = parent;
  }
  return reversed.reverse();
}

function finalAuditPaths(
  root: string,
  implementation: string,
  current: string,
): string[] {
  const finalPaths = changedPaths(root, implementation, current);
  const transitions = implementationPath(root, implementation, current);
  if (transitions.length === 0 && implementation !== current) return finalPaths;
  const releasePaths = new Set<string>();
  const regularPaths = new Set<string>();
  for (const transition of transitions) {
    const target = isReleaseBumpTransition(root, transition)
      ? releasePaths
      : regularPaths;
    for (const changedPath of changedPaths(
      root,
      transition.parent,
      transition.commit,
    ))
      target.add(changedPath);
  }
  return finalPaths.filter(
    (changedPath) =>
      !releasePaths.has(changedPath) || regularPaths.has(changedPath),
  );
}

function releaseBumpParent(root: string, commit: string): string | undefined {
  return commitParents(root, commit).find((parent) =>
    isReleaseBumpTransition(root, { commit, parent }),
  );
}

function withoutFinalReleaseBumps(root: string, current: string): string {
  let cursor = current;
  const visited = new Set<string>();
  while (!visited.has(cursor)) {
    visited.add(cursor);
    const parent = releaseBumpParent(root, cursor);
    if (!parent) break;
    cursor = parent;
  }
  return cursor;
}

function inferReviewBoundary(root: string, current: string): ReviewBoundary {
  const boundary = withoutFinalReleaseBumps(root, current);
  const boundaryParents = commitParents(root, boundary);
  const reviewHead =
    boundaryParents.length > 1
      ? withoutFinalReleaseBumps(root, boundaryParents.at(-1)!)
      : boundary;
  const [implementation = reviewHead] = commitParents(root, reviewHead);
  return { implementation, reviewHead };
}

function isAuditPath(auditPath: string): boolean {
  return auditPath.startsWith(`${AUDIT_DIRECTORY}/`);
}

function invalidFinalPathsError(finalPaths: string[]): string {
  const auditPaths = finalPaths.filter(isAuditPath);
  const extraPaths =
    auditPaths.length === 1
      ? finalPaths.filter((changedPath) => changedPath !== auditPaths[0])
      : finalPaths;
  return [
    "H_impl..currentはreview artifactだけでなければなりません。H_impl..currentにreview artifact以外のfileが含まれています。実装commitの後にはreview artifactだけをcommitしてください。余分なpath:",
    ...extraPaths.map((changedPath) => `- ${changedPath}`),
  ].join("\n");
}

function packageDistributionFiles(root: string): string[] | undefined {
  const metadata = path.join(root, "package.json");
  if (!fs.existsSync(metadata)) return undefined;
  const parsed = JSON.parse(fs.readFileSync(metadata, "utf8")) as {
    files?: unknown;
  };
  if (parsed.files === undefined) return undefined;
  if (!Array.isArray(parsed.files))
    throw new Error("package.jsonのfilesが配列ではありません");
  return parsed.files.filter(
    (entry): entry is string => typeof entry === "string",
  );
}

export function parseFileAudit(markdown: string) {
  const base = /\| 比較基点 \| `([a-f0-9]{40})` \|/iu.exec(markdown)?.[1];
  const implementation = /\| H_impl \| `([a-f0-9]{40})` \|/iu.exec(
    markdown,
  )?.[1];
  const section =
    markdown.split("## 変更ファイル個別監査")[1]?.split("\n## ")[0] ?? "";
  const entries: Array<{
    path: string;
    status: string;
    fields: string[];
    decision: string;
  }> = [];
  for (const line of section.split(/\r?\n/u)) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (
      cells.length !== 9 ||
      !/^\x60[^\x60]+\x60$/u.test(cells[0]) ||
      !["A", "M", "D", "R"].includes(cells[1])
    )
      continue;
    entries.push({
      path: cells[0].slice(1, -1),
      status: cells[1],
      fields: cells.slice(2, 8),
      decision: cells[8],
    });
  }
  return { base, implementation, entries };
}

export function checkFileAudit(root: string) {
  const errors: string[] = [];
  const current = git(["rev-parse", "HEAD"], root).stdout.trim();
  const inferred = inferReviewBoundary(root, current);
  const finalPaths = finalAuditPaths(
    root,
    inferred.implementation,
    inferred.reviewHead,
  );
  if (finalPaths.length === 0)
    return {
      valid: false,
      errors: [
        "review artifactのcommitがありません。実装commitの後にreview artifactだけをcommitしてください",
      ],
    };
  if (finalPaths.length > 1)
    return {
      valid: false,
      errors: [invalidFinalPathsError(finalPaths)],
    };
  const auditPath = finalPaths[0]!;
  if (!isAuditPath(auditPath))
    return {
      valid: false,
      errors: [
        `H_impl..currentの差分path ${auditPath} は${AUDIT_DIRECTORY}/配下ではありません。実装commitの後にreview artifactだけをcommitしてください`,
      ],
    };
  if (!AUDIT_NAME_PATTERN.test(path.posix.basename(auditPath)))
    return {
      valid: false,
      errors: [
        `${auditPath}はreview artifactのfile名書式に一致しません。連番_課題番号…レビュー.mdの書式へ直してください`,
      ],
    };
  const artifact = path.join(root, auditPath);
  if (!fs.existsSync(artifact))
    return {
      valid: false,
      errors: [
        `${auditPath}がありません。review artifactを追加した状態でcommitしてください`,
      ],
    };
  const parsed = parseFileAudit(fs.readFileSync(artifact, "utf8"));
  if (!parsed.base || !parsed.implementation)
    return {
      valid: false,
      errors: ["比較基点またはH_implの完全SHAがありません"],
    };
  if (parsed.implementation !== inferred.implementation)
    errors.push(
      `review artifact本文のH_impl ${parsed.implementation} が実際のcommit構造から導出したH_impl ${inferred.implementation} と一致しません。review artifactのH_implをreview headの親commitへ直してください`,
    );
  for (const oid of [parsed.base, parsed.implementation]) {
    const resolved = git(["rev-parse", "--verify", `${oid}^{commit}`], root, {
      allowFailure: true,
    });
    if (resolved.status !== 0 || resolved.stdout.trim() !== oid)
      errors.push(`固定commitを解決できません: ${oid}`);
  }
  if (errors.length > 0)
    return {
      valid: false,
      errors,
      base: parsed.base,
      implementation: parsed.implementation,
      auditedFiles: parsed.entries.length,
    };
  if (parsed.base === parsed.implementation)
    errors.push("比較基点とH_implは異なるcommitでなければなりません");
  const baseAncestry = git(
    ["merge-base", "--is-ancestor", parsed.base, parsed.implementation],
    root,
    { allowFailure: true },
  );
  if (baseAncestry.status !== 0)
    errors.push("比較基点がH_implのancestorではありません");
  const expected = git(
    [
      "-c",
      "core.quotepath=false",
      "diff",
      "--name-status",
      `${parsed.base}..${parsed.implementation}`,
      "--",
    ],
    root,
  )
    .stdout.trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const [status, ...parts] = line.split("\t");
      return { status: status?.[0] ?? "", path: parts.at(-1) ?? "" };
    });
  const expectedKeys = expected
    .map((entry) => `${entry.status}\u0000${entry.path}`)
    .sort();
  const actualKeys = parsed.entries
    .map((entry) => `${entry.status}\u0000${entry.path}`)
    .sort();
  if (new Set(actualKeys).size !== actualKeys.length)
    errors.push("個別監査に重複pathがあります");
  if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys))
    errors.push(
      `個別監査とGit差分path集合が一致しません: expected=${expected.length} actual=${parsed.entries.length}`,
    );
  for (const entry of parsed.entries) {
    if (entry.fields.some((field) => field === "" || field === "-"))
      errors.push(
        `${entry.path}のowner・layer・責務・依存・追跡・安全性に空欄があります`,
      );
    if (entry.decision !== "pass")
      errors.push(`${entry.path}の個別判定がpassではありません`);
  }
  const ancestry = git(
    ["merge-base", "--is-ancestor", parsed.implementation, current],
    root,
    { allowFailure: true },
  );
  if (ancestry.status !== 0)
    errors.push("H_implがcurrent HEADのancestorではありません");
  const packageFiles = packageDistributionFiles(root);
  const impact =
    packageFiles === undefined
      ? { errors: [], distributed: [] }
      : validateDistributionImpact({
          markdown: fs.readFileSync(artifact, "utf8"),
          changedPaths: expected.map((entry) => entry.path),
          packageFiles,
        });
  errors.push(...impact.errors);
  return {
    valid: errors.length === 0,
    errors,
    base: parsed.base,
    implementation: parsed.implementation,
    current,
    auditPath,
    auditedFiles: parsed.entries.length,
    distributedPaths: impact.distributed,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const result = checkFileAudit(process.cwd());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}
