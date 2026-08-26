import fs from "node:fs";
import path from "node:path";
import { validateDistributionImpact } from "../src/domain/conformance.js";
import {
  evaluateMergeIntegrity,
  extractLossTokens,
  type MergeObservation,
  type MergePathObservation,
  type RenameResolution,
  type TokenObservation,
} from "../src/domain/merge-integrity.js";
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

/**
 * rename検出を無効にした変更path。renameを検出すると移動元pathが列挙から落ち、
 * 移動元が対象path集合から漏れる。損失検知では移動元と移動先の双方が必要である。
 */
function changedPathsWithoutRenames(
  root: string,
  parent: string,
  commit: string,
): string[] {
  return lines(
    git(
      [
        "-c",
        "core.quotepath=false",
        "diff",
        "--name-only",
        "--no-renames",
        `${parent}..${commit}`,
        "--",
      ],
      root,
    ).stdout,
  );
}

/** `<mode> <type> <oid>\t<path>` 形式のtree entryをpath→oidの対応表にする。 */
function treeEntries(
  root: string,
  commit: string,
): Map<string, string> | undefined {
  const listed = git(
    ["-c", "core.quotepath=false", "ls-tree", "-r", "--full-name", commit],
    root,
    { allowFailure: true },
  );
  if (listed.status !== 0) return undefined;
  const entries = new Map<string, string>();
  for (const line of lines(listed.stdout)) {
    const [meta, entryPath] = line.split("\t");
    const [, type, oid] = (meta ?? "").split(/\s+/u);
    // blob以外のentryはoidを空にして、内容を観測できないことを表す。
    if (entryPath !== undefined)
      entries.set(entryPath, type === "blob" ? (oid ?? "") : "");
  }
  return entries;
}

/** blob oidごとに損失検知tokenを一度だけ取り出して再利用する。 */
function blobTokens(
  root: string,
  oid: string,
  cache: Map<string, readonly string[] | undefined>,
): readonly string[] | undefined {
  if (!cache.has(oid)) {
    const shown = git(["cat-file", "blob", oid], root, { allowFailure: true });
    cache.set(
      oid,
      shown.status === 0 ? extractLossTokens(shown.stdout) : undefined,
    );
  }
  return cache.get(oid);
}

function observeTokens(
  root: string,
  entries: Map<string, string> | undefined,
  filePath: string,
  cache: Map<string, readonly string[] | undefined>,
): TokenObservation {
  if (entries === undefined)
    return { kind: "unreadable", reason: "treeを列挙できません" };
  const oid = entries.get(filePath);
  if (oid === undefined) return { kind: "absent" };
  if (oid === "")
    return { kind: "unreadable", reason: `${filePath}はblobではありません` };
  const tokens = blobTokens(root, oid, cache);
  return tokens === undefined
    ? { kind: "unreadable", reason: `blob ${oid.slice(0, 8)}を読めません` }
    : { kind: "present", tokens };
}

/** 親からmerge結果へのrename追跡で、指定pathの移動先を1件返す。 */
function renamedPath(
  root: string,
  parent: string,
  commit: string,
  filePath: string,
): string | undefined {
  const diff = git(
    [
      "-c",
      "core.quotepath=false",
      "diff",
      "-M",
      "--name-status",
      `${parent}..${commit}`,
      "--",
    ],
    root,
    { allowFailure: true },
  );
  if (diff.status !== 0) return undefined;
  for (const line of lines(diff.stdout)) {
    const cells = line.split("\t");
    if (cells[0]?.startsWith("R") && cells[1] === filePath) return cells[2];
  }
  return undefined;
}

function observeMergePath(
  root: string,
  commit: string,
  parents: readonly string[],
  trees: {
    base: Map<string, string> | undefined;
    first: Map<string, string> | undefined;
    second: Map<string, string> | undefined;
    merged: Map<string, string> | undefined;
  },
  filePath: string,
  cache: Map<string, readonly string[] | undefined>,
): MergePathObservation {
  const observation = {
    path: filePath,
    base: observeTokens(root, trees.base, filePath, cache),
    firstParent: observeTokens(root, trees.first, filePath, cache),
    secondParent: observeTokens(root, trees.second, filePath, cache),
    merged: observeTokens(root, trees.merged, filePath, cache),
  };
  if (observation.merged.kind !== "absent") return observation;
  const holders = [
    { parent: parents[0]!, observed: observation.firstParent },
    { parent: parents[1]!, observed: observation.secondParent },
  ].filter((entry) => entry.observed.kind === "present");
  // 解決できた親だけを積むと、片方だけ解決した場合に未解決を黙って捨てる。
  const renameTargets: RenameResolution[] = holders.map((holder) => {
    const moved = renamedPath(root, holder.parent, commit, filePath);
    return moved === undefined
      ? { kind: "unresolved", parent: holder.parent }
      : {
          kind: "resolved",
          parent: holder.parent,
          path: moved,
          observation: observeTokens(root, trees.merged, moved, cache),
        };
  });
  return { ...observation, renameTargets };
}

function observeMerge(root: string, commit: string): MergeObservation {
  const parents = commitParents(root, commit);
  if (parents.length !== 2)
    return { commit, parents, mergeBases: [], paths: [] };
  const [first, second] = parents as [string, string];
  const resolved = git(["merge-base", "--all", first, second], root, {
    allowFailure: true,
  });
  const mergeBases = resolved.status === 0 ? lines(resolved.stdout) : [];
  if (mergeBases.length !== 1)
    return { commit, parents, mergeBases, paths: [] };
  const base = mergeBases[0]!;
  const targets = new Set([
    ...changedPathsWithoutRenames(root, base, first),
    ...changedPathsWithoutRenames(root, base, second),
    ...changedPathsWithoutRenames(root, first, commit),
    ...changedPathsWithoutRenames(root, second, commit),
  ]);
  const trees = {
    base: treeEntries(root, base),
    first: treeEntries(root, first),
    second: treeEntries(root, second),
    merged: treeEntries(root, commit),
  };
  const cache = new Map<string, readonly string[] | undefined>();
  const paths = [...targets]
    .sort()
    .map((filePath) =>
      observeMergePath(root, commit, parents, trees, filePath, cache),
    );
  return { commit, parents, mergeBases, paths };
}

/**
 * 監査範囲`比較基点..H_impl`に含まれるmerge commitを観測する。
 * release bump除外は適用しない。除外はpath差分の判定にだけ働く責務である。
 */
export function collectMergeObservations(
  root: string,
  base: string,
  implementation: string,
): MergeObservation[] {
  return lines(
    git(["rev-list", "--merges", `${base}..${implementation}`], root).stdout,
  ).map((commit) => observeMerge(root, commit));
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
  else if (parsed.base !== parsed.implementation)
    errors.push(
      ...evaluateMergeIntegrity(
        collectMergeObservations(root, parsed.base, parsed.implementation),
      ).errors,
    );
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
