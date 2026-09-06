import crypto from "node:crypto";

import { git } from "../lib/process.js";

const GIT_ENV = {
  LANG: "C",
  LC_ALL: "C",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
} as const;

export function observeReviewDiff(
  root: string,
  baseSha: string,
  headSha: string,
): { digest: string; changedPaths: readonly string[] } {
  for (const [label, oid] of [
    ["base", baseSha],
    ["head", headSha],
  ] as const) {
    const observed = git(["rev-parse", "--verify", `${oid}^{commit}`], root, {
      env: GIT_ENV,
    }).stdout.trim();
    if (observed !== oid)
      throw new Error(`review diff ${label} SHAをexact commitへ解決できません`);
  }
  if (
    git(["merge-base", "--is-ancestor", baseSha, headSha], root, {
      env: GIT_ENV,
      allowFailure: true,
    }).status !== 0
  )
    throw new Error("review diff baseがcandidate HEADのancestorではありません");
  const source = git(
    [
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      baseSha,
      headSha,
      "--",
    ],
    root,
    { env: GIT_ENV },
  ).stdout;
  const names = git(
    ["diff", "--name-only", "-z", "--no-renames", baseSha, headSha, "--"],
    root,
    { env: GIT_ENV },
  )
    .stdout.split("\0")
    .filter(Boolean)
    .sort();
  if (new Set(names).size !== names.length)
    throw new Error("review diff path観測に重複があります");
  return {
    digest: crypto.createHash("sha256").update(source).digest("hex"),
    changedPaths: Object.freeze(names),
  };
}

/**
 * commit時点のblobをtextとして読む。存在しなければ`undefined`。
 *
 * **作業treeを読まない。** 再固定の判定はGit objectだけを根拠にする（Issue #1172）。
 */
export function readBlobAtCommit(
  root: string,
  commit: string,
  filePath: string,
): string | undefined {
  const shown = git(["show", `${commit}:${filePath}`], root, {
    env: GIT_ENV,
    allowFailure: true,
  });
  return shown.status === 0 ? shown.stdout : undefined;
}
