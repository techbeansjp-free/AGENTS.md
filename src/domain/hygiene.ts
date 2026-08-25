import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { git } from "../lib/process.js";
import { stableJson } from "../lib/security.js";
import { isStagingLifecyclePath } from "./staging.js";

export type HygieneKind =
  "empty-directory" | "temporary-artifact" | "completed-worktree-container";

export interface HygieneCandidate {
  path: string;
  relative: string;
  kind: HygieneKind;
  reason: string;
  owner: string;
  removable: boolean;
}

export interface HygieneReport {
  version: 1;
  root: string;
  candidates: HygieneCandidate[];
  excluded: Array<{ relative: string; reason: string }>;
  hash: string;
}

const HYGIENE_KINDS: ReadonlySet<string> = new Set<HygieneKind>([
  "empty-directory",
  "temporary-artifact",
  "completed-worktree-container",
]);
const ROOT_META = /[\0\p{Cc}\p{Cf}%$*?{}~]/u;

interface RepositoryIdentity {
  root: string;
  commonDirectory: string;
}

interface GitSnapshot {
  head: string;
  refs: string;
  root: string;
  status: string[];
  worktrees: string;
}

function slash(value: string): string {
  return value.split(path.sep).join("/");
}

function hasParentReference(value: string): boolean {
  return value.split(/[\\/]+/u).includes("..");
}

function hasUnsafeMeta(value: string): boolean {
  return ROOT_META.test(value) || value.includes("[") || value.includes("]");
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function repositoryIdentity(inputRoot: string): RepositoryIdentity {
  if (
    typeof inputRoot !== "string" ||
    inputRoot.trim() === "" ||
    hasUnsafeMeta(inputRoot) ||
    hasParentReference(inputRoot)
  ) {
    throw new Error(
      "rootには未解決env、glob、制御文字、tilde、親参照を含まない明示pathが必要です",
    );
  }
  const resolved = path.resolve(inputRoot);
  if (path.dirname(resolved) === resolved)
    throw new Error("filesystem rootをworkspace hygieneのrootにできません");
  if (!fs.existsSync(resolved)) throw new Error("rootが存在しません");
  if (fs.lstatSync(resolved).isSymbolicLink())
    throw new Error("symlinkをworkspace hygieneのrootにできません");
  const realRoot = fs.realpathSync(resolved);
  if (realRoot !== resolved)
    throw new Error("symlink祖先を含むrootをworkspace hygieneに使用できません");
  const home = fs.existsSync(os.homedir())
    ? fs.realpathSync(os.homedir())
    : path.resolve(os.homedir());
  if (realRoot === home)
    throw new Error("home directoryをworkspace hygieneのrootにできません");
  const topLevel = git(
    ["rev-parse", "--show-toplevel"],
    realRoot,
  ).stdout.trim();
  const realTopLevel = fs.realpathSync(topLevel);
  if (realTopLevel !== realRoot)
    throw new Error("rootはGit repository rootと一致しなければなりません");
  const commonRaw = git(
    ["rev-parse", "--git-common-dir"],
    realRoot,
  ).stdout.trim();
  const commonResolved = path.resolve(realRoot, commonRaw);
  const commonDirectory = fs.realpathSync(commonResolved);
  return { root: realRoot, commonDirectory };
}

function validateKinds(
  kinds: readonly HygieneKind[] | undefined,
): Set<HygieneKind> {
  const selected = kinds ?? ([...HYGIENE_KINDS] as HygieneKind[]);
  const result = new Set<HygieneKind>();
  for (const kind of selected) {
    if (!HYGIENE_KINDS.has(kind))
      throw new Error(
        `未対応のworkspace hygiene operationです: ${String(kind)}`,
      );
    result.add(kind);
  }
  return result;
}

function fingerprint(stat: fs.Stats): string {
  return [
    stat.dev,
    stat.ino,
    stat.mode,
    stat.size,
    stat.mtimeMs,
    stat.ctimeMs,
  ].join(":");
}

function registeredWorktrees(root: string): Set<string> {
  const result = new Set<string>();
  const output = git(["worktree", "list", "--porcelain"], root).stdout;
  for (const line of output.split(/\r?\n/u)) {
    if (!line.startsWith("worktree ")) continue;
    const worktree = line.slice("worktree ".length);
    if (!fs.existsSync(worktree)) continue;
    result.add(fs.realpathSync(worktree));
  }
  return result;
}

function trackedPaths(root: string): Set<string> {
  return new Set(
    git(["ls-files", "-z"], root).stdout.split("\0").filter(Boolean).map(slash),
  );
}

function isTemporaryArtifact(relative: string): boolean {
  const base = path.posix.basename(relative);
  return (
    base.endsWith(".log") ||
    base.startsWith(".pending-") ||
    base.includes(".tmp-") ||
    relative.startsWith("tmp/")
  );
}

function reportHash(input: {
  root: string;
  candidates: HygieneCandidate[];
  excluded: Array<{ relative: string; reason: string }>;
}): string {
  return crypto.createHash("sha256").update(stableJson(input)).digest("hex");
}

export function previewWorkspaceHygiene(input: {
  root: string;
  kinds?: HygieneKind[];
}): HygieneReport {
  const identity = repositoryIdentity(input.root);
  const selectedKinds = validateKinds(input.kinds);
  const tracked = trackedPaths(identity.root);
  const worktrees = registeredWorktrees(identity.root);
  const candidates: HygieneCandidate[] = [];
  const excluded: Array<{ relative: string; reason: string }> = [
    { relative: ".", reason: "repository root自身は削除対象外です" },
  ];

  const exclude = (relative: string, reason: string): void => {
    excluded.push({ relative: slash(relative), reason });
  };
  const addCandidate = (
    absolute: string,
    relative: string,
    kind: HygieneKind,
    reason: string,
    owner: string,
    stat: fs.Stats,
  ): void => {
    if (!selectedKinds.has(kind)) {
      exclude(relative, `${kind}は今回の検査operationに含まれていません`);
      return;
    }
    candidates.push({
      path: absolute,
      relative: slash(relative),
      kind,
      reason: `${reason} fingerprint=${fingerprint(stat)}`,
      owner,
      removable: true,
    });
  };

  const scanDirectory = (absolute: string, relative: string): boolean => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absolute, { withFileTypes: true });
    } catch (error) {
      exclude(
        relative,
        `directoryを検査できないため保持します: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
    let containsOnlyRemovableEmptyDirectories = true;
    for (const entry of entries) {
      const childRelative = relative
        ? path.join(relative, entry.name)
        : entry.name;
      const childAbsolute = path.join(absolute, entry.name);
      if (isStagingLifecyclePath(childRelative)) {
        exclude(
          childRelative,
          "一時staging、role-log、metricsは専用lifecycle証拠なしにworkspace hygieneで削除しません",
        );
        containsOnlyRemovableEmptyDirectories = false;
        continue;
      }
      if (hasParentReference(childRelative) || hasUnsafeMeta(entry.name)) {
        exclude(childRelative, "安全でないpath表現を含むため保持します");
        containsOnlyRemovableEmptyDirectories = false;
        continue;
      }
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(childAbsolute);
      } catch (error) {
        exclude(
          childRelative,
          `pathを再検査できないため保持します: ${error instanceof Error ? error.message : String(error)}`,
        );
        containsOnlyRemovableEmptyDirectories = false;
        continue;
      }
      if (stat.isSymbolicLink()) {
        exclude(childRelative, "symlinkとsymlink脱出は削除対象外です");
        containsOnlyRemovableEmptyDirectories = false;
        continue;
      }
      let realChild: string;
      try {
        realChild = fs.realpathSync(childAbsolute);
      } catch (error) {
        exclude(
          childRelative,
          `実体pathを解決できないため保持します: ${error instanceof Error ? error.message : String(error)}`,
        );
        containsOnlyRemovableEmptyDirectories = false;
        continue;
      }
      if (!isContained(identity.root, realChild)) {
        exclude(
          childRelative,
          "repository root外へ解決されるpathは削除対象外です",
        );
        containsOnlyRemovableEmptyDirectories = false;
        continue;
      }
      if (
        entry.name === ".git" ||
        realChild === identity.commonDirectory ||
        isContained(identity.commonDirectory, realChild)
      ) {
        exclude(
          childRelative,
          "Git common directory、object、ref、reflog、worktree metadataは常に対象外です",
        );
        containsOnlyRemovableEmptyDirectories = false;
        continue;
      }
      if (entry.isDirectory() && entry.name === "node_modules") {
        exclude(
          childRelative,
          "package manager所有directoryは部分的に再帰削除しません",
        );
        containsOnlyRemovableEmptyDirectories = false;
        continue;
      }
      if (entry.isDirectory()) {
        const childIsRemovableTree = scanDirectory(
          childAbsolute,
          childRelative,
        );
        if (!childIsRemovableTree)
          containsOnlyRemovableEmptyDirectories = false;
        continue;
      }
      containsOnlyRemovableEmptyDirectories = false;
      const normalized = slash(childRelative);
      if (isTemporaryArtifact(normalized)) {
        if (tracked.has(normalized)) {
          exclude(
            childRelative,
            "tracked fileは一時生成物に一致しても保持します",
          );
        } else if (entry.isFile()) {
          addCandidate(
            childAbsolute,
            childRelative,
            "temporary-artifact",
            "repository内の未追跡一時生成物です",
            "workspace owner",
            stat,
          );
        } else {
          exclude(childRelative, "通常fileではない一時生成物は保持します");
        }
      } else if (normalized === "memo" || normalized.startsWith("memo/")) {
        exclude(childRelative, "内容のあるmemo fileは保持します");
      }
    }
    if (containsOnlyRemovableEmptyDirectories) {
      const stat = fs.lstatSync(absolute);
      addCandidate(
        absolute,
        relative,
        "empty-directory",
        relative === "memo" || slash(relative).startsWith("memo/")
          ? "内容を持たないmemo directoryです"
          : "実体fileを含まない空directoryです",
        "workspace owner",
        stat,
      );
    } else if (relative === "memo" || slash(relative).startsWith("memo/")) {
      exclude(relative, "内容のあるmemo directoryは保持します");
    }
    return containsOnlyRemovableEmptyDirectories;
  };

  const scanWorktreeContainers = (directory: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      exclude(
        ".worktrees",
        `worktree containerを検査できないため保持します: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    if (entries.length === 0) {
      const stat = fs.lstatSync(directory);
      addCandidate(
        directory,
        ".worktrees",
        "completed-worktree-container",
        "登録済みworktreeを含まない空のworktree container rootです",
        "Git worktree owner",
        stat,
      );
      return;
    }
    exclude(".worktrees", "空ではないworktree container rootは保持します");
    for (const entry of entries) {
      const relative = path.join(".worktrees", entry.name);
      const absolute = path.join(directory, entry.name);
      if (hasParentReference(relative) || hasUnsafeMeta(entry.name)) {
        exclude(relative, "安全でないpath表現を含むため保持します");
        continue;
      }
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(absolute);
      } catch (error) {
        exclude(
          relative,
          `pathを再検査できないため保持します: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      if (stat.isSymbolicLink()) {
        exclude(relative, "symlinkのworktree containerは削除対象外です");
        continue;
      }
      if (!entry.isDirectory()) {
        exclude(
          relative,
          "worktree container直下のdirectoryではないため保持します",
        );
        continue;
      }
      const real = fs.realpathSync(absolute);
      if (!isContained(identity.root, real)) {
        exclude(relative, "repository root外のworktree containerは保持します");
        continue;
      }
      if (worktrees.has(real)) {
        exclude(
          relative,
          "登録済みworktreeです。worktree本体の削除は本commandの責務ではなくGit公式commandだけで行います",
        );
        continue;
      }
      let contents: string[];
      try {
        contents = fs.readdirSync(absolute);
      } catch (error) {
        exclude(
          relative,
          `worktree containerを検査できないため保持します: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      if (contents.length !== 0) {
        exclude(
          relative,
          "未登録でも空ではないworktree containerは他project資産として保持します",
        );
        continue;
      }
      addCandidate(
        absolute,
        relative,
        "completed-worktree-container",
        "未登録かつ空の完了済みworktree containerです。登録済みworktree本体の削除は本commandの責務ではありません",
        "Git worktree owner",
        stat,
      );
    }
  };

  const rootEntries = fs.readdirSync(identity.root, { withFileTypes: true });
  const worktreeContainersOnly =
    selectedKinds.size === 1 &&
    selectedKinds.has("completed-worktree-container");
  for (const entry of rootEntries) {
    if (entry.name === ".worktrees" && entry.isDirectory()) {
      scanWorktreeContainers(path.join(identity.root, entry.name));
      continue;
    }
    const absolute = path.join(identity.root, entry.name);
    if (hasParentReference(entry.name) || hasUnsafeMeta(entry.name)) {
      exclude(entry.name, "安全でないpath表現を含むため保持します");
      continue;
    }
    const stat = fs.lstatSync(absolute);
    if (entry.name === ".git") {
      exclude(
        entry.name,
        "Git common directory、object、ref、reflog、worktree metadataは常に対象外です",
      );
      continue;
    }
    if (worktreeContainersOnly) {
      exclude(
        entry.name,
        "completed-worktree-container以外は今回の検査operationに含まれていません",
      );
      continue;
    }
    if (stat.isSymbolicLink()) {
      exclude(entry.name, "symlinkとsymlink脱出は削除対象外です");
      continue;
    }
    const real = fs.realpathSync(absolute);
    if (
      real === identity.commonDirectory ||
      isContained(identity.commonDirectory, real)
    ) {
      exclude(
        entry.name,
        "Git common directory、object、ref、reflog、worktree metadataは常に対象外です",
      );
      continue;
    }
    if (entry.isDirectory() && entry.name === "node_modules") {
      exclude(
        entry.name,
        "package manager所有directoryは部分的に再帰削除しません",
      );
      continue;
    }
    if (entry.isDirectory()) {
      scanDirectory(absolute, entry.name);
      continue;
    }
    const normalized = slash(entry.name);
    if (
      !tracked.has(normalized) &&
      entry.isFile() &&
      isTemporaryArtifact(normalized)
    ) {
      addCandidate(
        absolute,
        entry.name,
        "temporary-artifact",
        "repository内の未追跡一時生成物です",
        "workspace owner",
        stat,
      );
    } else if (tracked.has(normalized) && isTemporaryArtifact(normalized)) {
      exclude(entry.name, "tracked fileは一時生成物に一致しても保持します");
    }
  }

  candidates.sort((left, right) => {
    const depth =
      right.relative.split("/").length - left.relative.split("/").length;
    return (
      depth ||
      left.relative.localeCompare(right.relative) ||
      left.kind.localeCompare(right.kind)
    );
  });
  excluded.sort(
    (left, right) =>
      left.relative.localeCompare(right.relative) ||
      left.reason.localeCompare(right.reason),
  );
  const hash = reportHash({ root: identity.root, candidates, excluded });
  return {
    version: 1,
    root: identity.root,
    candidates,
    excluded,
    hash,
  };
}

function snapshot(root: string): GitSnapshot {
  return {
    head: git(["rev-parse", "HEAD"], root).stdout,
    refs: git(["for-each-ref", "--format=%(refname)%00%(objectname)"], root)
      .stdout,
    root: fs.realpathSync(
      git(["rev-parse", "--show-toplevel"], root).stdout.trim(),
    ),
    status: git(
      [
        "-c",
        "core.quotePath=false",
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ],
      root,
    )
      .stdout.split("\0")
      .filter(Boolean),
    worktrees: git(["worktree", "list", "--porcelain"], root).stdout,
  };
}

function expectedStatus(
  before: string[],
  removedCandidates: HygieneCandidate[],
): string[] {
  const removedTemporaryFiles = new Set(
    removedCandidates
      .filter((candidate) => candidate.kind === "temporary-artifact")
      .map((candidate) => `?? ${candidate.relative}`),
  );
  return before.filter((entry) => !removedTemporaryFiles.has(entry));
}

function recoveryMessage(removed: string[], remaining: string[]): string {
  return [
    `削除済み対象: ${removed.length ? removed.join(", ") : "なし"}`,
    `未処理対象: ${remaining.length ? remaining.join(", ") : "なし"}`,
    "復旧方法: GitのHEAD・refs・status・worktree listを確認し、削除済みの未追跡fileはbackupから、空directoryは必要に応じて再作成してください",
  ].join("。 ");
}

function selectedKindsFromReport(report: HygieneReport): HygieneKind[] {
  const disabled = new Set<HygieneKind>();
  for (const kind of HYGIENE_KINDS) {
    if (
      report.excluded.some(
        (entry) =>
          entry.reason === `${kind}は今回の検査operationに含まれていません`,
      )
    ) {
      disabled.add(kind as HygieneKind);
    }
  }
  return ([...HYGIENE_KINDS] as HygieneKind[]).filter(
    (kind) => !disabled.has(kind),
  );
}

function pathStillExists(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return false;
    }
    throw error;
  }
}

export function applyWorkspaceHygiene(
  input: {
    report: HygieneReport;
    approvedHash: string;
    root: string;
    operations: HygieneKind[];
    paths?: string[];
  },
  remove: (target: { path: string; kind: HygieneKind }) => void,
): {
  applied: true;
  removed: string[];
  skipped: Array<{ relative: string; reason: string }>;
  recovery: string[];
} {
  if (!/^[a-f0-9]{64}$/iu.test(input.approvedHash))
    throw new Error("approvedHashは64桁hexでなければなりません");
  if (input.approvedHash !== input.report.hash)
    throw new Error("preview report hashが承認済みhashと一致しません");
  if (input.report.version !== 1)
    throw new Error("未対応のworkspace hygiene report versionです");
  const calculatedHash = reportHash({
    root: input.report.root,
    candidates: input.report.candidates,
    excluded: input.report.excluded,
  });
  if (calculatedHash !== input.report.hash)
    throw new Error("preview reportが改ざんされています");
  const identity = repositoryIdentity(input.root);
  if (identity.root !== input.report.root)
    throw new Error("rootがpreview reportのrepositoryと一致しません");
  const operations = validateKinds(input.operations);
  if (operations.size === 0)
    throw new Error("applyには1件以上の明示operationが必要です");
  const selectedPaths = input.paths
    ? new Set(
        input.paths.map((selected) => {
          if (
            typeof selected !== "string" ||
            selected.trim() === "" ||
            path.isAbsolute(selected) ||
            hasParentReference(selected) ||
            hasUnsafeMeta(selected)
          )
            throw new Error(
              "apply対象pathは安全なrepository相対pathで指定してください",
            );
          return slash(selected);
        }),
      )
    : undefined;
  if (selectedPaths?.size === 0)
    throw new Error("pathsを指定する場合は1件以上の明示pathが必要です");
  const current = previewWorkspaceHygiene({
    root: identity.root,
    kinds: selectedKindsFromReport(input.report),
  });
  if (current.hash !== input.report.hash)
    throw new Error("stale previewまたはTOCTOUを検出したため削除しません");
  const targets = input.report.candidates.filter(
    (candidate) =>
      candidate.removable &&
      operations.has(candidate.kind) &&
      (!selectedPaths || selectedPaths.has(candidate.relative)),
  );
  if (
    selectedPaths &&
    [...selectedPaths].some(
      (selected) =>
        !targets.some((candidate) => candidate.relative === selected),
    )
  )
    throw new Error("明示したapply対象pathが最新preview候補にありません");
  const skipped = input.report.candidates
    .filter(
      (candidate) =>
        !candidate.removable ||
        !operations.has(candidate.kind) ||
        Boolean(selectedPaths && !selectedPaths.has(candidate.relative)),
    )
    .map((candidate) => ({
      relative: candidate.relative,
      reason: !candidate.removable
        ? "削除可能と判定されていません"
        : !operations.has(candidate.kind)
          ? `${candidate.kind}は明示operationに含まれていません`
          : "明示apply対象pathに含まれていません",
    }));
  const before = snapshot(identity.root);
  const removed: string[] = [];
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    if (!target) continue;
    try {
      remove({ path: target.path, kind: target.kind });
      if (pathStillExists(target.path))
        throw new Error(`remove後も対象が存在します: ${target.relative}`);
      removed.push(target.relative);
    } catch (error) {
      let firstUnprocessed = index;
      try {
        if (!pathStillExists(target.path)) {
          if (!removed.includes(target.relative)) removed.push(target.relative);
          firstUnprocessed = index + 1;
        }
      } catch {
        firstUnprocessed = index;
      }
      const remaining = targets
        .slice(firstUnprocessed)
        .map((candidate) => candidate.relative);
      throw new Error(
        `workspace hygieneは部分失敗し、成功とは報告しません: ${error instanceof Error ? error.message : String(error)}。 ${recoveryMessage(removed, remaining)}`,
        { cause: error },
      );
    }
  }
  const after = snapshot(identity.root);
  const expected = expectedStatus(before.status, targets);
  const changed = [
    before.head === after.head ? undefined : "HEAD",
    before.refs === after.refs ? undefined : "refs",
    before.root === after.root ? undefined : "repository root",
    stableJson(expected) === stableJson(after.status) ? undefined : "status",
    before.worktrees === after.worktrees ? undefined : "worktree list",
  ].filter((item): item is string => item !== undefined);
  if (changed.length > 0) {
    throw new Error(
      `削除後のGit状態が期待値と一致しません（${changed.join(", ")}）。 ${recoveryMessage(removed, [])}`,
    );
  }
  return { applied: true, removed, skipped, recovery: [] };
}
