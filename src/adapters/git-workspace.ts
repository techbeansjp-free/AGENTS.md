import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const GIT_WORKSPACE_REJECTION =
  "Git workspace境界を検証できません。rootとGit worktree登録を修復して新しい起動要求を行ってください";

export type GitWorkspaceBoundary =
  | { allowed: false }
  | { allowed: true; roots: readonly string[]; revalidate: () => boolean };

// These overrides also reach Codex's child Git processes. Do not validate one
// topology while authorizing writes against another through inherited settings.
function hasGitOverrides(): boolean {
  return Object.keys(process.env).some(
    (key) =>
      /^GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG.*)$/u.test(
        key,
      ) && process.env[key] !== undefined,
  );
}

/** Resolve only primary repositories and mutually registered linked worktrees. */
export function resolveGitMetadataWriteRoots(
  root: string,
): GitWorkspaceBoundary {
  try {
    if (hasGitOverrides()) return { allowed: false };
    const identities = new Map<string, fs.Stats>();
    const contents = new Map<string, string>();
    const checkPath = (value: string, directory: boolean): string => {
      if (!path.isAbsolute(value) || /[\p{Cc}\p{Cf}]/u.test(value))
        throw new Error(GIT_WORKSPACE_REJECTION);
      // Walk before normalizing '..', so a symlink cannot be hidden by it.
      let current = path.parse(value).root;
      const segments = value.slice(current.length).split(path.sep);
      for (const [index, segment] of segments.entries()) {
        current = path.resolve(current, segment);
        const stat = fs.lstatSync(current);
        if (
          stat.isSymbolicLink() ||
          (index < segments.length - 1 && !stat.isDirectory())
        )
          throw new Error(GIT_WORKSPACE_REJECTION);
        const previous = identities.get(current);
        if (
          previous &&
          (previous.dev !== stat.dev || previous.ino !== stat.ino)
        )
          throw new Error(GIT_WORKSPACE_REJECTION);
        identities.set(current, stat);
      }
      const stat = fs.lstatSync(current);
      if (
        fs.realpathSync(value) !== current ||
        (directory ? !stat.isDirectory() : !stat.isFile())
      )
        throw new Error(GIT_WORKSPACE_REJECTION);
      return current;
    };
    const readLink = (file: string): string => {
      checkPath(file, false);
      const fd = fs.openSync(
        file,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
      );
      try {
        const stat = fs.fstatSync(fd);
        const previous = identities.get(file);
        if (
          !previous ||
          stat.dev !== previous.dev ||
          stat.ino !== previous.ino ||
          stat.size > 16384
        )
          throw new Error(GIT_WORKSPACE_REJECTION);
        const value = fs.readFileSync(fd, "utf8");
        if (Buffer.byteLength(value) > 16384)
          throw new Error(GIT_WORKSPACE_REJECTION);
        contents.set(file, value);
        const line = value.replace(/\r?\n$/u, "");
        if (line === "" || /[\p{Cc}\p{Cf}]/u.test(line))
          throw new Error(GIT_WORKSPACE_REJECTION);
        return line;
      } finally {
        fs.closeSync(fd);
      }
    };
    if (checkPath(root, true) !== root) return { allowed: false };
    const dotGit = path.join(root, ".git");
    const dotStat = fs.lstatSync(dotGit);
    const linked = dotStat.isFile();
    if (!linked && !dotStat.isDirectory()) return { allowed: false };
    checkPath(dotGit, !linked);
    const queryGit = (cwd: string) =>
      spawnSync(
        "git",
        [
          "rev-parse",
          "--path-format=absolute",
          "--show-toplevel",
          "--git-dir",
          "--git-common-dir",
          "--is-bare-repository",
        ],
        {
          cwd,
          encoding: "utf8",
          timeout: 10000,
          maxBuffer: 65536,
          env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
        },
      );
    const query = queryGit(root);
    if (query.error || query.status !== 0) return { allowed: false };
    const lines = query.stdout.replace(/\r?\n$/u, "").split(/\r?\n/u);
    const [top, gitDir, commonDir, bare] = lines;
    if (
      lines.length !== 4 ||
      top !== root ||
      !gitDir ||
      !commonDir ||
      bare !== "false"
    )
      return { allowed: false };
    if (
      checkPath(gitDir, true) !== gitDir ||
      checkPath(commonDir, true) !== commonDir
    )
      return { allowed: false };
    let roots: readonly string[] = [];
    if (linked) {
      if (
        path.basename(commonDir) !== ".git" ||
        path.dirname(gitDir) !== path.join(commonDir, "worktrees")
      )
        return { allowed: false };
      // The common repository must itself be a normal, non-bare primary.
      // A separate-git-dir named '.git' is not sufficient proof of this.
      const primary = queryGit(path.dirname(commonDir));
      if (
        primary.error ||
        primary.status !== 0 ||
        primary.stdout.replace(/\r\n/gu, "\n") !==
          `${path.dirname(commonDir)}\n${commonDir}\n${commonDir}\nfalse\n`
      )
        return { allowed: false };
      const forward = readLink(dotGit);
      if (!forward.startsWith("gitdir: ")) return { allowed: false };
      const resolveLink = (
        base: string,
        value: string,
        directory: boolean,
      ): string =>
        checkPath(
          path.isAbsolute(value) ? value : `${base}${path.sep}${value}`,
          directory,
        );
      if (
        resolveLink(root, forward.slice(8), true) !== gitDir ||
        resolveLink(gitDir, readLink(path.join(gitDir, "gitdir")), false) !==
          dotGit ||
        resolveLink(gitDir, readLink(path.join(gitDir, "commondir")), true) !==
          commonDir
      )
        return { allowed: false };
      roots = Object.freeze([gitDir, commonDir]);
    } else if (gitDir !== dotGit || commonDir !== dotGit)
      return { allowed: false };
    const revalidate = (): boolean => {
      try {
        if (hasGitOverrides()) return false;
        for (const [file, previous] of identities) {
          const current = fs.lstatSync(file);
          if (
            current.dev !== previous.dev ||
            current.ino !== previous.ino ||
            current.mode !== previous.mode ||
            fs.realpathSync(file) !== file
          )
            return false;
        }
        for (const [file, value] of contents)
          if (
            fs.statSync(file).size > 16384 ||
            fs.readFileSync(file, "utf8") !== value
          )
            return false;
        return true;
      } catch {
        return false;
      }
    };
    return revalidate()
      ? { allowed: true, roots, revalidate }
      : { allowed: false };
  } catch {
    // Filesystem exceptions and Git stderr can contain private absolute paths.
    return { allowed: false };
  }
}
