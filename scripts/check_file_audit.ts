import fs from "node:fs";
import path from "node:path";
import {
  extractMarkdownSection,
  validateDistributionImpact,
} from "../src/domain/conformance.js";
import { withoutMarkdownCode } from "../src/domain/issue.js";
import {
  evaluateMergeIntegrity,
  extractLossTokens,
  type MergeObservation,
  type MergePathObservation,
  type RenameResolution,
  type TokenObservation,
} from "../src/domain/merge-integrity.js";

import { git } from "../src/lib/process.js";
import {
  parseJsonStrict,
  stableJson,
  type JsonValue,
} from "../src/lib/security.js";
import { isPackageVersion } from "../src/lib/version.js";
import { REVIEW_RECOVERY_ROUND } from "../src/domain/review-convergence.js";
import { isExecutionEntry } from "../src/lib/entrypoint.js";

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
  /**
   * 比較基点の導出を試みたか。**境界commitが親を2個以上持つときだけ真。**
   *
   * 親2個の境界は、取り込み先branch上のPR mergeと、CIが`pull_request`でcheckoutする
   * `refs/pull/<N>/merge`の双方に当たる。いずれも第1親が取り込み先branchのtipである。
   * 候補branch上でreview artifact commitをHEADにした場合は親1個で、取り込み先が
   * 構造から決まらないため導出を試みない。
   */
  baseDerivable: boolean;
  /** 境界commitの親の個数。診断で親がちょうど2個でないことを示すために持つ。 */
  boundaryParentCount: number;
  /** 境界commitの第1親。取り込み先branchのtipであり、診断で取得すべき履歴を指す。 */
  boundaryFirstParent: string | undefined;
  /**
   * 導出した比較基点。`H_impl`が含む最新の取り込み先branch commitである。
   *
   * **`baseDerivable`が真で`undefined`なら判定不能であり、対象外と混同してはならない。**
   * 浅いcloneでfork点が取得範囲の外にある場合と、merge-baseが複数ある場合に起きる。
   * どちらも「検証すべき場所で検証できなかった」状態であり、合格へ倒さない。
   */
  base: string | undefined;
  /**
   * 各親を候補branch側と仮定したときの`H_impl..review head`のpath数。
   *
   * **選択そのものには使わない。** 既定branchへのPR mergeの親順は
   * `[取り込み先tip, 候補head]`、既定branch追随mergeの親順は`[候補head, 取り込み先tip]`
   * であり、位置だけでは区別できない（Issue #1004）。着地形で選び直す案は
   * `SCN-INT-AUDITBUMP-004`で従来の不合格を合格へ倒したため採らない。
   * ここで持つのは診断のためだけである。
   */
  candidateFinalPathCounts: readonly number[];
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

/**
 * 側のcommit 1件がrelease bumpかを判定する。
 *
 * **自動releaseは`release/bump-*` branchのPR mergeとして着地する。** 既定branch追随で
 * bumpだけを取り込むと、別親側の範囲には必ず親2個のmerge commitが入る。親1個のcommitだけを
 * 受け付けると、その追随では除外が成立しない（Issue #975）。
 *
 * merge commitは`isReleaseBumpTransition`へ委譲し、subject接頭辞の要求を緩めない。
 * merge自身のsubjectは`Merge pull request …`だが、その別親側を再帰的にたどった葉が
 * 接頭辞つきの直接bump commitであることを要求する。
 */
function isReleaseBumpCommit(root: string, commit: string): boolean {
  const parents = commitParents(root, commit);
  if (parents.length === 0) return false;
  if (parents.length > 1)
    return parents.some((parent) =>
      isReleaseBumpTransition(root, { commit, parent }),
    );
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
    sideCommits.every((commit) => isReleaseBumpCommit(root, commit))
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

/**
 * 旧release bump除外を認める境界commit。**最後の旧bump merge commitである。**
 *
 * releaseは既定branchへbump commitを push しなくなった（Issue #1184）。除外logicを
 * 無期限に残すと、移行後に作られた「bump風のcommit」まで監査対象から外せてしまう。
 * **この commit のancestorに限って旧logicを適用する。**
 *
 * 日時やsubjectで判定しない。**移行PRのmerge直前に、その時点の最後の旧bump merge
 * commitで確定する。** 確定後に新しい旧bumpが着地した場合は、そのbumpが除外されずに
 * `audit:check`が落ちるため、取り違えは無言では通らない。
 */
const LEGACY_RELEASE_BUMP_CUTOFF = "7a0fff678e99483baf0f25dd4132c67172a61f7e";

/**
 * `commit`がcutoffのancestorまたはcutoff自身か。
 *
 * **解決できない場合は判定不能として例外にする。** 「解決できないので除外しない」と
 * すると、cutoffをrepositoryから消すだけで除外を止められる。逆に「解決できないので
 * 除外する」とすると、浅い履歴で移行後のbump風commitを素通しできる。
 */
/**
 * cutoffを完全SHAへ解決する。**解決できない場合は判定不能として例外にする。**
 *
 * 「解決できないので除外しない」とすると、cutoffをrepositoryから消すだけで除外を
 * 止められる。逆に「解決できないので除外する」とすると、浅い履歴で移行後の
 * bump形式commitを素通しできる。
 *
 * **監査の開始時に1回だけ呼ぶ。** release bump transitionを見つけた後にだけ解決すると、
 * bumpを含まない履歴では解決不能なcutoffでも合格してしまう（PR #1189 の外部指摘）。
 */
function resolveLegacyBumpCutoff(root: string, cutoff: string): string {
  const resolved = git(["rev-parse", "--verify", `${cutoff}^{commit}`], root, {
    allowFailure: true,
  });
  const oid = resolved.stdout.trim();
  if (resolved.status !== 0 || !/^[a-f0-9]{40}$/u.test(oid))
    throw new Error(
      `release bump除外のcutoff commit ${cutoff} を解決できないため監査できません。履歴を完全に取得してください`,
    );
  return oid;
}

function withinLegacyBumpWindow(
  root: string,
  commit: string,
  cutoff: string,
): boolean {
  return (
    git(["merge-base", "--is-ancestor", commit, cutoff], root, {
      allowFailure: true,
    }).status === 0
  );
}

function releaseBumpParent(
  root: string,
  commit: string,
  cutoff: string,
): string | undefined {
  const parent = commitParents(root, commit).find((candidate) =>
    isReleaseBumpTransition(root, { commit, parent: candidate }),
  );
  if (parent === undefined) return undefined;
  /**
   * **cutoff以後のbump風commitは通常の変更として監査する。** 除外はcutoff以前の
   * 実在した旧bumpのためだけに残す。
   */
  return withinLegacyBumpWindow(root, commit, cutoff) ? parent : undefined;
}

function withoutFinalReleaseBumps(
  root: string,
  current: string,
  cutoff: string,
): string {
  let cursor = current;
  const visited = new Set<string>();
  while (!visited.has(cursor)) {
    visited.add(cursor);
    const parent = releaseBumpParent(root, cursor, cutoff);
    if (!parent) break;
    cursor = parent;
  }
  return cursor;
}

/**
 * 2 commitの**一意な**merge-base。解決できない場合と複数解の場合はundefinedを返す。
 *
 * `--all`を使うのは、複数解を任意の1解で代表させないためである。`observeMerge`と
 * `.agent-skill-chain/docs/02_品質基準.md`は「merge-baseが一意でないmergeは判定不能として
 * 拒否する」と定めており、境界の導出だけが一意性を暗黙に仮定してはならない。
 */
function uniqueMergeBase(
  root: string,
  left: string,
  right: string,
): string | undefined {
  const result = git(["merge-base", "--all", left, right], root, {
    allowFailure: true,
  });
  if (result.status !== 0) return undefined;
  const candidates = lines(result.stdout).filter((oid) =>
    /^[a-f0-9]{40}$/u.test(oid),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * `parent`を候補branch側と仮定したときの`H_impl..review head`のfile数。
 *
 * **診断のためだけに数える。** 本体の判定と同じ`finalAuditPaths`を使うため、
 * 1件ならその親が候補branch側の着地形になっている。0件や複数件なら、その親を
 * 候補側と見なす読み方が成立していない。
 */
function candidateFinalPathCount(
  root: string,
  parent: string,
  cutoff: string,
): number {
  const reviewHead = withoutFinalReleaseBumps(root, parent, cutoff);
  const [implementation = reviewHead] = commitParents(root, reviewHead);
  return finalAuditPaths(root, implementation, reviewHead).length;
}

function inferReviewBoundary(
  root: string,
  current: string,
  cutoff: string,
): ReviewBoundary {
  const boundary = withoutFinalReleaseBumps(root, current, cutoff);
  const boundaryParents = commitParents(root, boundary);
  const reviewHead =
    boundaryParents.length > 1
      ? withoutFinalReleaseBumps(root, boundaryParents.at(-1)!, cutoff)
      : boundary;
  const [implementation = reviewHead] = commitParents(root, reviewHead);
  /**
   * `H_impl`と同じく、比較基点もcommit構造から独立に導出する（Issue #966）。
   *
   * 第1親は取り込み先branchのtipであり、`H_impl`との`merge-base`が
   * 「`H_impl`が含む最新の取り込み先branch commit」になる。直接取り込んだ場合も、
   * 別branch経由で間接的に取り込んだ場合も、この値へ収束する。第1親にrelease bumpが
   * 積まれていてもそれらは`H_impl`の祖先ではないため`merge-base`は動かない。
   */
  const baseDerivable = boundaryParents.length > 1;
  /**
   * **親がちょうど2個の境界だけを導出対象にする。** 親3個以上のoctopus mergeでは、
   * どの親が候補branchかを構造から決められない。`QLT-MERGEINT-003`が損失検知で
   * 「親が2個でないmergeを判定不能として拒否する」と定めており、境界の導出も揃える。
   */
  const base =
    boundaryParents.length === 2
      ? uniqueMergeBase(root, implementation, boundaryParents[0]!)
      : undefined;
  const candidateFinalPathCounts =
    boundaryParents.length === 2
      ? boundaryParents.map((parent) =>
          candidateFinalPathCount(root, parent, cutoff),
        )
      : [];
  return {
    implementation,
    reviewHead,
    baseDerivable,
    boundaryParentCount: boundaryParents.length,
    boundaryFirstParent: boundaryParents[0],
    base,
    candidateFinalPathCounts,
  };
}

function isAuditPath(auditPath: string): boolean {
  return auditPath.startsWith(`${AUDIT_DIRECTORY}/`);
}

/**
 * 選択した親の着地形が成立しないときに、両親の観測を診断へ添える。
 *
 * 既定branch追随merge（親順`[候補head, 取り込み先tip]`）をHEADにすると、選択した
 * 取り込み先側の差分がそのまま「余分なpath」として並び、真の理由が読み取れない
 * （Issue #1004）。**選択は変えずに、両側の観測と是正方法を足す。**
 */
function candidateSideNote(inferred: ReviewBoundary): string[] {
  /**
   * **選択した親の着地形が成立するかで分岐しない。** 成立するなら差分は
   * review artifact 1 fileになり、注記を付ける4つの経路のどれにも到達しない。
   * 分岐を置くと、常に注記を付ける変異が生存する死んだ条件になる。
   *
   * **親の個数ではなく観測配列の長さを見る。** 観測は親2個のときだけ作られるため、
   * 個数と長さの二重管理をやめて、注記が使う配列そのものを条件にする。
   */
  if (inferred.candidateFinalPathCounts.length !== 2) return [];
  return [
    "",
    "**上のpathは候補branch側の差分でない可能性がある。** 親を候補側と仮定したときのH_impl..review headのfile数は" +
      inferred.candidateFinalPathCounts
        .map((count, index) => `第${index + 1}親=${count}件`)
        .join("、") +
      "であり、選択した最後の親はreview artifactちょうど1 fileの着地形になっていない。",
    "既定branchを取り込む追随merge（親順が[候補head, 取り込み先tip]）をHEADにしている場合、選択した親は取り込み先側である。候補branchのreview artifact commitをHEADにして再実行してほしい。",
    "review artifactをまだcommitしていない場合は、実装commitの後にreview artifactだけをcommitしてほしい。",
  ];
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

/**
 * 上限は`.agent-skill-chain/docs/02_品質基準.md`が所有する。ここは同じ値を強制するだけ。
 *
 * **同じ値を2箇所で持たない。** 以前はここへ`3`を直書きしており、
 * PR #1150 が上限を4へ引き上げたときに追随しなかった。`review round`が受理する
 * ラウンドを`audit:check`が拒否し、取り直し1ラウンドが使えなかった（Issue #1159）。
 * 判定の正本である`review-convergence.ts`からimportして乖離を構造的に断つ。
 */
const MAX_REVIEW_ROUNDS = REVIEW_RECOVERY_ROUND;
const STEP_CHAIN_VIA = "経由";
const STEP_CHAIN_BYPASS = "迂回";

/** 申告欄を持つ節。**本文や例示を申告として数えないための境界。** */
const IDENTITY_HEADING = "レビュー識別情報";

/**
 * 申告を読む対象を識別情報の節へ限定し、codeを取り除く。
 *
 * **全文検索では監査目的を迂回できる。** 識別情報の表に欄が無くても、本文・引用・code
 * fenceへ`| ラウンド数 | 1 |`と書くだけで通ってしまう。節を限定し、さらにcodeを除く。
 */
function identitySection(markdown: string): string | undefined {
  const section = extractMarkdownSection(markdown, IDENTITY_HEADING);
  return section === undefined ? undefined : withoutMarkdownCode(section);
}

/**
 * 運用ポリシーが宣言する開発速度の観測基準を、artifactへ残させる欄。
 *
 * `.agent-skill-chain/docs/00_運用ポリシー.md`は「支援層の所要時間が成果物構築の所要時間を
 * 上回らないこと」と「手段の追加を提案する前に、既存手段の縮小で目的を満たせないかを先に
 * 評価すること」を観測基準として宣言しているが、**観測する場所がどこにも無かった。**
 *
 * **閾値で自動停止させない。** 比率は文脈依存で、ドメイン関数のtestが成果物の4倍になるのは
 * 正常である。記録を残させ、人が読んで判断する。
 */
const OBSERVATION_FIELDS = [
  {
    label: "仕様の所有箇所",
    hint: "着手時に読んだ仕様の正本と引用。`該当なし: #<Issue番号>`で仕様側の欠落を起票したことを示す",
  },
  { label: "成果物行数", hint: "製品の変更行数と支援層の行数" },
  {
    label: "縮小の先行評価",
    hint: "既存手段の流用・縮小で足りない理由。評価していない状態を残さない",
  },
] as const;

/** 識別情報の節から`| <label> | <値> |`の値を読む。空欄は未記入として扱う。 */
function identityCell(section: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const cell = new RegExp(`\\| *${escaped} *\\| *([^|]*?) *\\|`, "u").exec(
    section,
  )?.[1];
  return cell === undefined || cell.trim() === "" ? undefined : cell.trim();
}

/**
 * 観測基準の欄が記入されているかを確かめる。
 *
 * `仕様の所有箇所`が`該当なし`のときだけ追加を要求する。仕様に所有箇所が無いなら、
 * **実装を進める前に仕様側の欠落として起票する**のが運用ポリシーの求める順序であり、
 * その起票先をここで指させる。
 */
function observationErrors(section: string): string[] {
  const errors: string[] = [];
  for (const field of OBSERVATION_FIELDS) {
    const value = identityCell(section, field.label);
    if (value === undefined) {
      errors.push(
        `review artifactに「| ${field.label} | … |」がありません。${field.hint}を記録してください`,
      );
      continue;
    }
    if (
      field.label === "仕様の所有箇所" &&
      value.startsWith("該当なし") &&
      !/#\d+/u.test(value)
    )
      errors.push(
        "仕様の所有箇所が該当なしの場合は、仕様側の欠落を起票したIssue番号を`#<番号>`で示してください",
      );
  }
  return errors;
}

/**
 * `| ラウンド数 | 3（注記） |`から先頭の整数を読む。
 *
 * **注記を許す。** 既存artifactは`4（うち1ラウンドは自動review）`のように書いており、
 * 厳格な整数だけを要求すると既存の書き方を一律に壊す。数える対象はラウンド数であって
 * 記法ではない。
 */
function parseReviewRounds(section: string): number | undefined {
  const leading = /^(\d+)/u.exec(
    identityCell(section, "ラウンド数") ?? "",
  )?.[1];
  return leading === undefined ? undefined : Number(leading);
}

/**
 * `| Step chain | 経由: <staging> |`または`| Step chain | 迂回: <理由> |`を読む。
 *
 * **申告の存在だけを要求し、申告内容を検証しない。** 検証しない理由は2つある。
 *
 * 1. staging（`.agent-skill-chain/tmp/`）は`.gitignore`の対象で、追跡fileが0件である。
 *    既定branch側のcheckoutにjournalは存在しないため、`経由`の検証は**必ず失敗する。**
 *    正直な申告だけが落ち、`迂回`は常に通る誘因の逆転を生む。
 * 2. journalの整合検証は捏造への障壁にならない。`validateStepJournal`は在否・順序・mode
 *    しか見ず、`artifacts`と`evidence`は repository 状態へ束縛されない自由文字列である。
 *
 * Issue #986の要求は「迂回した事実が記録に残ればよい」であり、記録の存在で満たされる。
 * **独立oracleを持たない申告を検証したふりをしない。**
 */
function parseStepChain(
  section: string,
): { kind: "via" | "bypass"; detail: string } | undefined {
  const cell = identityCell(section, "Step chain");
  if (cell === undefined) return undefined;
  const matched = /^(経由|迂回) *[:：] *(.+)$/u.exec(cell);
  if (!matched) return undefined;
  return {
    kind: matched[1] === STEP_CHAIN_VIA ? "via" : "bypass",
    detail: matched[2]!.trim(),
  };
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

/**
 * `pass`根拠として書いてよい主張の語彙。**人が明示登録した語だけを見る。**
 *
 * 規範性を推測して拡張しない。契約正本registryが「検出tokenは人が明示登録した
 * 語だけとし、規範性を推測して拡張しない」と定めるのと同じ設計である
 * （`docs/specs/02_要件/04_仕様・品質管理要件.md`）。
 *
 * **`常に`・`必ず`・`すべて`のような一般的全称語は入れない。** 誤検出が急増し、
 * 「散文の論理検査器は作らない」という打ち切り線を越える。
 */
const HIGH_RISK_CLAIM_TOKENS: readonly string[] = Object.freeze([
  "純関数",
  "pure function",
  "副作用を持たない",
  "副作用がない",
  "例外を投げ",
  "never throws",
  "全入力",
  "全ての入力",
  "すべての入力",
  "all inputs",
  "冪等",
  "idempotent",
  "決定的",
  "deterministic",
]);

/**
 * 表のcellを分割する。エスケープ済みの`\|`は区切りにしない。
 */
function splitTableRow(line: string): string[] {
  const body = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "\\" && body[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/**
 * Markdown装飾を除いた判定値。
 *
 * **内部文字を削らない。** `/[*`\s]/gu`で全除去すると`p ass`や`p*ass`まで`pass`になり、
 * 判定列を厳密な`pass`に限る仕様から外れる（Issue #1188のF-04）。前後の空白と
 * **外側の**装飾だけを剥がす。
 */
function verdictValue(cell: string): string {
  let value = cell.trim();
  let previous = "";
  while (value !== previous) {
    previous = value;
    value = value.replace(/^\*\*(.*)\*\*$/su, "$1").trim();
    value = value.replace(/^\*(.*)\*$/su, "$1").trim();
    value = value.replace(/^`(.*)`$/su, "$1").trim();
  }
  return value;
}

/**
 * 行がcode fenceの開始・終了記号か。**行頭の3文字以上の ``` または ~~~ に限る。**
 *
 * 表のcell内に現れるbacktickを誤って開始と読まないよう、行頭に限定する。
 */
function fenceMarker(line: string): string | undefined {
  const match = /^\s{0,3}(`{3,}|~{3,})/u.exec(line);
  return match?.[1]?.[0];
}

/**
 * `pass`判定の根拠行に、検証不能な性質の主張が裸で置かれていないか検査する。
 *
 * **真偽は判定しない。** 判定するのは「登録語彙を含む`pass`行に、SCN参照か
 * 原文引用のどちらかがあるか」だけである。原文引用があってもそれが本当に
 * 実装の原文であることは証明できない。**機構が塞ぐのは、未検証の主張が黙って
 * `pass`根拠として使われる経路である**（Issue #1169）。
 *
 * 対象は判定列が厳密に`pass`である表の行だけとする。finding表・not-applicable・
 * 説明文・訂正記録は対象外である。**範囲を構造で限定することで、根拠らしさの
 * 推測を要さない。**
 */
export function unsupportedClaimRows(markdown: string): string[] {
  const findings: string[] = [];
  let headerCells: string[] | undefined;
  let verdictIndex = -1;
  /**
   * **開いたfenceは同じ記号でだけ閉じる。閉じない場合は以降すべてを対象外にする。**
   *
   * 「閉じていないので本文として扱う」とすると、fenceを開くだけで残り全体を
   * 検査対象へ戻せる。偽陽性を塞ぐ変更なので、開いたら閉じるまで対象外が安全側である
   * （Issue #1188のF-01）。
   */
  let openFence: string | undefined;
  for (const line of markdown.split("\n")) {
    const marker = fenceMarker(line);
    if (marker !== undefined) {
      if (openFence === undefined) openFence = marker;
      else if (openFence === marker) openFence = undefined;
      headerCells = undefined;
      verdictIndex = -1;
      continue;
    }
    if (openFence !== undefined) continue;
    if (!line.trim().startsWith("|")) {
      headerCells = undefined;
      verdictIndex = -1;
      continue;
    }
    const cells = splitTableRow(line);
    if (headerCells === undefined) {
      headerCells = cells;
      verdictIndex = cells.findIndex(
        (cell) => cell === "判定" || cell === "個別判定",
      );
      continue;
    }
    if (/^[-:\s|]+$/u.test(line.replace(/\|/gu, ""))) continue;
    /**
     * **防御的な早期returnである。** `verdictIndex`が-1のとき
     * `cells[-1]`は`undefined`になり直後のpass判定で必ず弾かれるため、
     * この行を消しても挙動は変わらない（変異試験で等価と確認済み）。
     * 判定列を持たない表を対象にしない意図を明示するために残す。
     */
    if (verdictIndex < 0) continue;
    if (verdictValue(cells[verdictIndex] ?? "") !== "pass") continue;
    /**
     * **登録語彙とcellの直積をすべて見る。**
     *
     * `HIGH_RISK_CLAIM_TOKENS.find`は宣言順で最初に一致した1語しか返さず、
     * `cells.find`は最初の1 cellしか見ない。`| idempotent | pass | pure function。SCN-… |`
     * では`pure function`が選ばれてSCN併記で通り、**1列目の裸の`idempotent`が
     * 検査されなかった**（Issue #1188のF-02）。
     *
     * **併記は登録語彙と同じcell内で数える。** 行のどこかにbacktickがあれば通す形に
     * すると、個別監査表のpath列（`src/a.ts`）だけで受理されてしまう。
     */
    for (const [index, claimCell] of cells.entries()) {
      /**
       * **判定列を対象から外す。** この行を消しても挙動は変わらない。判定列のcellは
       * `verdictValue`で厳密に`pass`へ正規化されたものだけがここへ来るため、
       * 登録語彙を含み得ない（`pass`はどの登録語彙の部分文字列でもない）。
       * **変異試験で等価と確認済み。** 責務を明示するために残す。
       */
      if (index === verdictIndex) continue;
      for (const token of HIGH_RISK_CLAIM_TOKENS) {
        if (!claimCell.includes(token)) continue;
        if (/SCN-[A-Z0-9-]+/u.test(claimCell)) continue;
        /**
         * **登録語彙そのものの引用は併記にしない。** 「純関数である。根拠は `純関数`」
         * という循環は、引用が証拠として機能していないことが字面だけで確定する
         * （Issue #1188のF-03）。実測で16件中2件が該当した。
         *
         * **引用が対象コードに実在するかは判定しない。** `grep -n "純関数"`や
         * `[skip ci]`のように対象source本文に無い正当な引用があり、実在検査は
         * F-01と逆向きの偽陽性を作る。
         */
        const quotations = [...claimCell.matchAll(/`([^`]+)`/gu)].map(
          (match) => match[1] ?? "",
        );
        if (
          quotations.some(
            (quotation) => !HIGH_RISK_CLAIM_TOKENS.includes(quotation.trim()),
          )
        )
          continue;
        findings.push(
          `pass判定の根拠へ検証を伴わない性質の主張があります: 「${token}」。同じ行へSCN IDか対象コードの原文引用を併記してください。cell: ${claimCell.slice(0, 120)}`,
        );
      }
    }
  }
  return findings;
}

/**
 * @param legacyReleaseBumpCutoff 旧release bump除外を認める境界commit。
 *   **既定は本repositoryの`LEGACY_RELEASE_BUMP_CUTOFF`である。** 隔離fixtureは
 *   自分の履歴に存在する境界を渡す。**環境変数では受け取らない。** 実行時の値で
 *   除外窓を動かせるようにすると、cutoffを後ろへずらすだけで監査を外せる。
 */
export function checkFileAudit(
  root: string,
  legacyReleaseBumpCutoff: string = LEGACY_RELEASE_BUMP_CUTOFF,
) {
  const errors: string[] = [];
  const current = git(["rev-parse", "HEAD"], root).stdout.trim();
  /**
   * **bumpの有無によらず開始時に解決する。** 解決を除外判定の内側へ置くと、
   * bumpを含まない履歴では解決不能なcutoffでも合格する。
   */
  const cutoff = resolveLegacyBumpCutoff(root, legacyReleaseBumpCutoff);
  const inferred = inferReviewBoundary(root, current, cutoff);
  const finalPaths = finalAuditPaths(
    root,
    inferred.implementation,
    inferred.reviewHead,
  );
  if (finalPaths.length === 0)
    return {
      valid: false,
      errors: [
        [
          "review artifactのcommitがありません。実装commitの後にreview artifactだけをcommitしてください",
          ...candidateSideNote(inferred),
        ].join("\n"),
      ],
    };
  if (finalPaths.length > 1)
    return {
      valid: false,
      errors: [
        [
          invalidFinalPathsError(finalPaths),
          ...candidateSideNote(inferred),
        ].join("\n"),
      ],
    };
  const auditPath = finalPaths[0]!;
  if (!isAuditPath(auditPath))
    return {
      valid: false,
      errors: [
        [
          `H_impl..currentの差分path ${auditPath} は${AUDIT_DIRECTORY}/配下ではありません。実装commitの後にreview artifactだけをcommitしてください`,
          ...candidateSideNote(inferred),
        ].join("\n"),
      ],
    };
  if (!AUDIT_NAME_PATTERN.test(path.posix.basename(auditPath)))
    return {
      valid: false,
      errors: [
        [
          `${auditPath}はreview artifactのfile名書式に一致しません。連番_課題番号…レビュー.mdの書式へ直してください`,
          ...candidateSideNote(inferred),
        ].join("\n"),
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
  /**
   * **比較基点を前へ進めると監査範囲が縮む。** 個別監査表は`比較基点..H_impl`との完全一致
   * だけを要求されるため、縮めた範囲に合わせた表を書けば、除外したcommitは表からも
   * 損失検知の走査範囲からも消える（Issue #966）。`H_impl`と同じ二重確認を課す。
   *
   * **導出を試みて決まらなかった場合は合格へ倒さない。** 浅いcloneでは境界commitの親は
   * 2個に見えるがfork点を観測できず、`undefined`を対象外と同じに扱うと、検証すべき
   * 場所で黙って検証を飛ばす。`fetch-depth`の変更だけで判定を無効化できてしまう。
   */
  if (inferred.baseDerivable && inferred.base === undefined)
    errors.push(
      inferred.boundaryParentCount === 2
        ? `比較基点を導出できません。境界commitの第1親 ${inferred.boundaryFirstParent} とH_impl ${inferred.implementation} の一意なmerge-baseを解決できません。浅いcloneではfetch-depthを0にして全履歴を取得してください。merge-baseが複数ある履歴では、判定できる形へmergeを整理してください`
        : `比較基点を導出できません。境界commitの親が${inferred.boundaryParentCount}個です。導出は親がちょうど2個の境界commitでのみ成立します。どの親が候補branchかを構造から決められないため、判定不能として拒否します`,
    );
  else if (inferred.base !== undefined && parsed.base !== inferred.base)
    errors.push(
      `review artifact本文の比較基点 ${parsed.base} が実際のcommit構造から導出した比較基点 ${inferred.base} と一致しません。比較基点をH_implが含む最新の取り込み先branch commit ${inferred.base} へ直し、個別監査表を比較基点..H_implから再生成してください`,
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
  const artifactText = fs.readFileSync(artifact, "utf8");
  errors.push(...unsupportedClaimRows(artifactText));
  const identity = identitySection(artifactText);
  if (identity === undefined)
    errors.push(
      `review artifactに「## ${IDENTITY_HEADING}」の節がありません。申告はこの節の表だけを正本にします`,
    );
  const rounds = parseReviewRounds(identity ?? "");
  if (rounds === undefined)
    errors.push(
      "review artifactに「| ラウンド数 | N |」がありません。実施したラウンド数を記録してください",
    );
  else if (rounds > MAX_REVIEW_ROUNDS)
    errors.push(
      `reviewラウンドが上限を超えています: ${rounds}（上限${MAX_REVIEW_ROUNDS}）。同じ範囲の予算は自動更新しません`,
    );
  else if (rounds < 1)
    errors.push(`reviewラウンドは1以上で記録してください: ${rounds}`);
  if (parseStepChain(identity ?? "") === undefined)
    errors.push(
      `review artifactに「| Step chain | ${STEP_CHAIN_VIA}: <staging path> |」または「| Step chain | ${STEP_CHAIN_BYPASS}: <理由> |」がありません`,
    );
  errors.push(...observationErrors(identity ?? ""));
  const packageFiles = packageDistributionFiles(root);
  const impact =
    packageFiles === undefined
      ? { errors: [], distributed: [] }
      : validateDistributionImpact({
          markdown: artifactText,
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

if (isExecutionEntry(import.meta.url)) {
  const result = checkFileAudit(process.cwd());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}
