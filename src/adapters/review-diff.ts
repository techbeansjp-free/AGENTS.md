import crypto from "node:crypto";

import { git } from "../lib/process.js";
import { isEvidenceOnlyPath } from "../domain/review.js";

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

/** exact commitが持つ唯一の親をworktreeへ触れずに観測する。 */
export function observeSingleCommitParent(
  root: string,
  headSha: string,
): string {
  const observed = git(["rev-parse", "--verify", `${headSha}^{commit}`], root, {
    env: GIT_ENV,
  }).stdout.trim();
  if (observed !== headSha)
    throw new Error("review suffix HEADをexact commitへ解決できません");
  const parents = git(["show", "-s", "--format=%P", headSha], root, {
    env: GIT_ENV,
  })
    .stdout.trim()
    .split(/\s+/u)
    .filter(Boolean);
  if (parents.length !== 1)
    throw new Error("review suffix HEADは単一親commitでなければなりません");
  return parents[0]!;
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

/**
 * **evidence-only suffix**: `fromSha`が`toSha`のancestorで、`fromSha..toSha`の
 * 差分がevidence-only allowlist配下の1 pathだけならそのpathを返す（Issue #1272）。
 *
 * review artifactをcommitするとHEADが`H_impl`から`H_final`へ動く。reviewerが
 * 確認した内容とPR・mergeされる内容の一致という性質は、artifact 1 fileの追加では
 * 破れない。従来はこの移動にも「取り直しround」を要求し、製品差分の無いroundで
 * 収束後の別枠を毎Issue消費していた。**受理するのはこの形だけで、空差分・
 * 2 path以上・allowlist外・非ancestorはundefinedにし、呼び出し側が従来と同じ
 * 文言で拒否する。**
 */
export function evidenceOnlySuffix(
  root: string,
  fromSha: string,
  toSha: string,
): string | undefined {
  if (fromSha === toSha) return undefined;
  /**
   * **1 commitだけを受理する**（round 1 R1-H-02）。`toSha`の第1親が`fromSha`で
   * なければ、途中commitのauthorをmerge認可が実装者と誤認しうるため拒否する。
   * ancestor関係はこの条件に含まれる。
   */
  const parent = git(["rev-parse", "--verify", `${toSha}^1^{commit}`], root, {
    env: GIT_ENV,
    allowFailure: true,
  });
  if (parent.status !== 0 || parent.stdout.trim() !== fromSha) return undefined;
  const parents = git(["rev-list", "--parents", "-n", "1", toSha], root, {
    env: GIT_ENV,
    allowFailure: true,
  });
  if (parents.status !== 0 || parents.stdout.trim().split(/\s+/u).length !== 2)
    return undefined;
  /**
   * **rename検出を切り、change typeとmodeまで見る**（round 1 R1-H-01）。
   * `--name-only`はrename先だけを1 pathとして出すため、製品fileをartifact pathへ
   * `git mv`した差分が「artifact 1件の追加」に見える。`--raw`で追加(A)または
   * 変更(M)の通常file（mode 100644）1件だけを受理し、削除・rename・copy・
   * type変更・symlink・gitlink・実行権限付与を拒否する。
   */
  const raw = git(
    ["diff", "--raw", "--no-renames", "--no-abbrev", "-z", fromSha, toSha],
    root,
    { env: GIT_ENV, allowFailure: true },
  );
  if (raw.status !== 0) return undefined;
  const fields = raw.stdout.split("\0").filter((item) => item.length > 0);
  if (fields.length !== 2) return undefined;
  const [meta, only] = fields;
  const matched =
    /^:(?<srcMode>[0-7]{6}) (?<dstMode>[0-7]{6}) [0-9a-f]+ [0-9a-f]+ (?<status>[AM])$/u.exec(
      meta ?? "",
    );
  if (!matched?.groups) return undefined;
  /**
   * 追加は000000→100644、変更は100644→100644だけを受理する。
   * 削除・type変更・symlink・gitlink・実行権限の付与と除去を落とす。
   * `--no-renames`によりrename・copyは2 pathとして上の件数検査で落ちる。
   */
  const { srcMode, dstMode, status } = matched.groups;
  if (
    dstMode !== "100644" ||
    (status === "A" && srcMode !== "000000") ||
    (status === "M" && srcMode !== "100644")
  )
    return undefined;
  return isEvidenceOnlyPath(only) ? only : undefined;
}
