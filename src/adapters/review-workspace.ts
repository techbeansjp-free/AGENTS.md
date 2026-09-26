import fs from "node:fs";
import path from "node:path";
import { git } from "../lib/process.js";
import { resolveContained } from "../lib/security.js";

export interface ReviewWorkspace {
  primaryRoot: string;
}

/** Filesystem-only hint used solely to avoid Git process startup when disabled. */
export function peekPrimaryReviewRoot(root: string): string | undefined {
  try {
    const dotGit = path.join(root, ".git");
    const stat = fs.lstatSync(dotGit);
    if (stat.isDirectory()) return root;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384)
      return undefined;
    const link = fs.readFileSync(dotGit, "utf8").trimEnd();
    if (!link.startsWith("gitdir: ")) return undefined;
    const gitDir = path.resolve(root, link.slice(8));
    const worktreesDir = path.dirname(gitDir);
    const commonDir = path.dirname(worktreesDir);
    return path.basename(worktreesDir) === "worktrees" &&
      path.basename(commonDir) === ".git"
      ? path.dirname(commonDir)
      : undefined;
  } catch {
    return undefined;
  }
}

function gitIdentity(root: string): [string, string, string, string] {
  const lines = git(
    [
      "rev-parse",
      "--path-format=absolute",
      "--show-toplevel",
      "--git-dir",
      "--git-common-dir",
      "--is-bare-repository",
    ],
    root,
  )
    .stdout.trimEnd()
    .split("\n");
  if (lines.length !== 4 || lines.some((line) => line === ""))
    throw new Error("Git worktreeを識別できません");
  return lines as [string, string, string, string];
}

function isCanonicalDirectory(value: string): boolean {
  return (
    path.isAbsolute(value) &&
    !/[\p{Cc}\p{Cf}]/u.test(value) &&
    fs.lstatSync(value).isDirectory() &&
    fs.realpathSync(value) === value
  );
}

function readMetadataFile(file: string): string {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384)
    throw new Error("Git metadata fileが不正です");
  return fs.readFileSync(file, "utf8").trimEnd();
}

/**
 * `root`が属するGit worktree一式を表す（Issue #1485、L-04設計正本§3）。
 * `activeRoot`は検証済みの`root`そのもの、`primaryRoot`は連結先の主worktreeで、
 * `root`自身が主worktreeの場合は両者が一致する。
 */
export interface GitWorkspace {
  readonly activeRoot: string;
  readonly primaryRoot: string;
}

/**
 * Read-only Git identity check for reviewer inputs and inherited local config。
 *
 * **`resolveReviewRoot`・`loadWorkspaceConfig`（Issue #1428）が個別に持っていた
 * primary worktree検証を一般化した共通adapter。** `resolveReviewRoot`はこの関数の
 * 薄いwrapperであり、既存呼び出し元（`supplemental-review-launch.ts`）の挙動を
 * 変えない（Issue #1485、L-04）。
 */
export function resolveGitWorkspace(root: string): GitWorkspace {
  if (
    Object.keys(process.env).some(
      (key) =>
        /^GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG.*)$/u.test(
          key,
        ) && process.env[key] !== undefined,
    ) ||
    !isCanonicalDirectory(root)
  )
    throw new Error("Git worktree境界を検証できません");
  const [top, gitDir, commonDir, bare] = gitIdentity(root);
  if (
    top !== root ||
    bare !== "false" ||
    !isCanonicalDirectory(gitDir) ||
    !isCanonicalDirectory(commonDir) ||
    path.basename(commonDir) !== ".git"
  )
    throw new Error("Git worktree境界を検証できません");
  const primaryRoot = path.dirname(commonDir);
  const [primaryTop, primaryGitDir, primaryCommonDir, primaryBare] =
    gitIdentity(primaryRoot);
  if (
    !isCanonicalDirectory(primaryRoot) ||
    primaryTop !== primaryRoot ||
    primaryGitDir !== commonDir ||
    primaryCommonDir !== commonDir ||
    primaryBare !== "false"
  )
    throw new Error("主worktreeを検証できません");
  const dotGit = path.join(root, ".git");
  if (root === primaryRoot) {
    if (dotGit !== gitDir || !fs.lstatSync(dotGit).isDirectory())
      throw new Error("主worktreeのGit metadataが不正です");
  } else {
    if (
      path.dirname(gitDir) !== path.join(commonDir, "worktrees") ||
      readMetadataFile(dotGit) !== `gitdir: ${gitDir}` ||
      readMetadataFile(path.join(gitDir, "gitdir")) !== dotGit
    )
      throw new Error("連結worktreeの登録が不正です");
  }
  const registered = git(["worktree", "list", "--porcelain"], root).stdout;
  if (!registered.split("\n").includes(`worktree ${root}`))
    throw new Error("Git worktreeが登録されていません");
  return { activeRoot: root, primaryRoot };
}

/** Read-only Git identity check for reviewer inputs and inherited local config. */
export function resolveReviewRoot(root: string): ReviewWorkspace {
  return { primaryRoot: resolveGitWorkspace(root).primaryRoot };
}

/** Bind staging documents to the same registered Git worktree as root. */
export function resolveReviewWorkspace(
  root: string,
  stagingPath: string,
): ReviewWorkspace {
  const workspace = resolveReviewRoot(root);
  const staging = resolveContained(root, stagingPath);
  const stagingRoot = git(
    ["rev-parse", "--show-toplevel"],
    staging,
  ).stdout.trim();
  if (stagingRoot !== root)
    throw new Error("stagingとrootは同じGit worktreeである必要があります");
  return workspace;
}
