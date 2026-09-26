import fs from "node:fs";
import path from "node:path";
import { deriveDistributionImpact } from "../src/domain/conformance.js";
import {
  parseReviewEvidence,
  REVIEW_EVIDENCE_NAME_PATTERN,
  type ReviewEvidence,
} from "../src/domain/review-evidence.js";
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

const AUDIT_DIRECTORIES = [
  "docs/reviews",
  ".agent-skill-chain/reviews",
] as const;
const AUDIT_NAME_PATTERN = REVIEW_EVIDENCE_NAME_PATTERN;
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
   * 比較基点の導出を試みたか。親2個のmerge境界では第1親、親1個のcandidate
   * 境界ではcandidate外で固定したremote default tipをtrust anchorにする。
   * 実行入口でanchorが無い場合も真として、検証不能を合格へ倒さない。
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

interface AuditTrustAnchor {
  /** candidateの外部で固定した取り込み先branch tip。 */
  trustedDefaultTip?: string;
  /** 実行入口では、単一親でもtrust anchor無しの合格を禁止する。 */
  requireSingleParentBase?: boolean;
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

/**
 * 生成物pathを配布境界の単位（`dist/<top>/`）へまとめる。
 *
 * **`dist/`は配布境界の中にある。** 除外すると、生成物を直接書き換えた変更が
 * 配布物影響の記述を要求されなくなる（PR #1218 の外部指摘）。一方で61 fileを
 * 1行ずつ書かせると、**src変更のたび表が生成file行で埋まり、本来確認すべき
 * 配布影響が埋没する。**
 *
 * **`dist/src/`・`dist/bin/`のような境界単位へまとめると両方を満たす。**
 * 触れた事実は残り、記述は境界ごとに1行で済む。`package.json`の`files`に
 * 無い単位（`dist/vendor/`など）は配布判定側で対象外になる。
 */
function generatedDistributionGroup(target: string): string | undefined {
  if (!isGeneratedDistributionPath(target)) return undefined;
  const [, top] = target.split("/");
  return top === undefined || top === "" ? "dist/" : `dist/${top}/`;
}

function isGeneratedDistributionPath(target: string): boolean {
  return target === "dist" || target.startsWith("dist/");
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

/**
 * `H_final`で終わる、review artifactだけを変える第1親suffixを遡って`H_impl`を返す。
 *
 * **`H_impl`を`HEAD^`に固定すると、artifactの帳簿合わせのたびに`H_impl`が動く。**
 * 記載した`H_impl`と個別監査表を追随させる必要が生じ、その追随commitがまた
 * `H_impl`を動かす。**有限レビュー予算がreviewの実質でなく帳簿合わせで消える**
 * （Issue #1074）。2026-09-06の#980では予算3のうち2ラウンドがこれに費やされた。
 *
 * **suffixの各commitは、artifact 1 fileだけを変えるものに限る。** 他pathを含む
 * commit、merge commit、rename、複数artifactの同時変更で遡りを止める。
 * **止められない場合は`HEAD^`と同じ結果へ戻る**ため、判定が緩む方向へは動かない。
 */
function withoutTrailingAuditCommits(root: string, head: string): string {
  /**
   * **起点は従来どおり`HEAD^`である。** ここを`HEAD`にすると、review headが
   * artifact以外を含む場合に`H_impl..current`が空になり、
   * 「artifact以外のfileが含まれています」を検出できなくなる。
   */
  const [start = head] = commitParents(root, head);
  let cursor = start;
  const visited = new Set<string>();
  while (!visited.has(cursor)) {
    visited.add(cursor);
    const parents = commitParents(root, cursor);
    /** **merge commitで止める。** 親が1個でなければ第1親suffixとして扱えない。 */
    if (parents.length !== 1) break;
    const parent = parents[0]!;
    const changed = changedPathsWithoutRenames(root, parent, cursor);
    /**
     * **artifact 1 fileだけを変えるcommitだけを遡る。** 0件や2件以上、
     * 許可されたreview directory配下でないpathを含む場合は実装commitであり境界になる。
     */
    if (changed.length !== 1 || !isAuditPath(changed[0]!)) break;
    cursor = parent;
  }
  /**
   * **遡った結果が緩む入力では`HEAD^`へ戻す。**
   *
   * 遡りは`H_impl..current`を広げる。広げた結果がreview artifact 1件でなくなるなら、
   * 遡らなかった場合に検出できた違反を見逃す。実測で、cutoffより後のrelease bump
   * commitが`finalAuditPaths`のrelease遷移として吸収され、**本来落ちる入力が
   * 通るようになった**（`SCN-UNIT-AUDITBUMP-005`）。
   * **判定が緩む方向へは動かさない**（Issue #1074）。
   */
  const widened = new Set(changedPathsWithoutRenames(root, cursor, head));
  if (widened.size !== 1 || !isAuditPath([...widened][0]!)) return start;
  return cursor;
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
  trustAnchor: AuditTrustAnchor = {},
): ReviewBoundary {
  const boundary = withoutFinalReleaseBumps(root, current, cutoff);
  const boundaryParents = commitParents(root, boundary);
  const reviewHead =
    boundaryParents.length > 1
      ? withoutFinalReleaseBumps(root, boundaryParents.at(-1)!, cutoff)
      : boundary;
  const implementation = withoutTrailingAuditCommits(root, reviewHead);
  /**
   * `H_impl`と同じく、比較基点もcommit構造から独立に導出する（Issue #966）。
   *
   * 第1親は取り込み先branchのtipであり、`H_impl`との`merge-base`が
   * 「`H_impl`が含む最新の取り込み先branch commit」になる。直接取り込んだ場合も、
   * 別branch経由で間接的に取り込んだ場合も、この値へ収束する。第1親にrelease bumpが
   * 積まれていてもそれらは`H_impl`の祖先ではないため`merge-base`は動かない。
   */
  const baseDerivable =
    boundaryParents.length > 1 ||
    trustAnchor.trustedDefaultTip !== undefined ||
    trustAnchor.requireSingleParentBase === true;
  /**
   * **親がちょうど2個の境界だけを導出対象にする。** 親3個以上のoctopus mergeでは、
   * どの親が候補branchかを構造から決められない。`QLT-MERGEINT-003`が損失検知で
   * 「親が2個でないmergeを判定不能として拒否する」と定めており、境界の導出も揃える。
   */
  const base =
    boundaryParents.length === 2
      ? uniqueMergeBase(root, implementation, boundaryParents[0]!)
      : boundaryParents.length === 1 &&
          trustAnchor.trustedDefaultTip !== undefined
        ? uniqueMergeBase(root, implementation, trustAnchor.trustedDefaultTip)
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
  return AUDIT_DIRECTORIES.some((directory) =>
    auditPath.startsWith(`${directory}/`),
  );
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
      "であり、選択した最後の親はreview証跡ちょうど1 fileの着地形になっていない。",
    "既定branchを取り込む追随merge（親順が[候補head, 取り込み先tip]）をHEADにしている場合、選択した親は取り込み先側である。候補branchのreview証跡commitをHEADにして再実行してほしい。",
    "review証跡をまだcommitしていない場合は、実装commitの後にreview証跡だけをcommitしてほしい。",
  ];
}

function invalidFinalPathsError(finalPaths: string[]): string {
  const auditPaths = finalPaths.filter(isAuditPath);
  const extraPaths =
    auditPaths.length === 1
      ? finalPaths.filter((changedPath) => changedPath !== auditPaths[0])
      : finalPaths;
  return [
    "H_impl..currentはreview証跡だけでなければなりません。H_impl..currentにreview証跡以外のfileが含まれています。実装commitの後にはreview証跡だけをcommitしてください。余分なpath:",
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

/**
 * @param legacyReleaseBumpCutoff 旧release bump除外を認める境界commit。
 *   **既定は本repositoryの`LEGACY_RELEASE_BUMP_CUTOFF`である。** 隔離fixtureは
 *   自分の履歴に存在する境界を渡す。**環境変数では受け取らない。** 実行時の値で
 *   除外窓を動かせるようにすると、cutoffを後ろへずらすだけで監査を外せる。
 */
export function checkFileAudit(
  root: string,
  legacyReleaseBumpCutoff: string = LEGACY_RELEASE_BUMP_CUTOFF,
  trustAnchor: AuditTrustAnchor = {},
) {
  const errors: string[] = [];
  const current = git(["rev-parse", "HEAD"], root).stdout.trim();
  /**
   * **bumpの有無によらず開始時に解決する。** 解決を除外判定の内側へ置くと、
   * bumpを含まない履歴では解決不能なcutoffでも合格する。
   */
  const cutoff = resolveLegacyBumpCutoff(root, legacyReleaseBumpCutoff);
  const inferred = inferReviewBoundary(root, current, cutoff, trustAnchor);
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
          "review証跡のcommitがありません。実装commitの後に`review export`で生成したreview証跡だけをcommitしてください",
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
          `H_impl..currentの差分path ${auditPath} は${AUDIT_DIRECTORIES.map((directory) => `${directory}/`).join(" または ")}配下ではありません。実装commitの後にreview証跡だけをcommitしてください`,
          ...candidateSideNote(inferred),
        ].join("\n"),
      ],
    };
  const name = AUDIT_NAME_PATTERN.exec(path.posix.basename(auditPath));
  if (name === null)
    return {
      valid: false,
      errors: [
        [
          `${auditPath}はreview証跡のfile名書式に一致しません。\`review export\`が生成する<Issue番号>_review.jsonを使ってください`,
          ...candidateSideNote(inferred),
        ].join("\n"),
      ],
    };
  const artifact = path.join(root, auditPath);
  if (!fs.existsSync(artifact))
    return {
      valid: false,
      errors: [
        `${auditPath}がありません。review証跡を追加した状態でcommitしてください`,
      ],
    };
  let evidence: ReviewEvidence;
  try {
    evidence = parseReviewEvidence(fs.readFileSync(artifact, "utf8"));
  } catch (error) {
    return {
      valid: false,
      errors: [
        `${auditPath}をreview証跡として読めません: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  if (Number(name[1]) !== evidence.issue)
    errors.push(
      `${auditPath}のfile名のIssue番号とreview証跡のissue ${evidence.issue} が一致しません`,
    );
  const base = evidence.observed.baseSha;
  const implementation = evidence.observed.implementationHeadSha;
  if (implementation !== inferred.implementation)
    errors.push(
      `review証跡のH_impl ${implementation} が実際のcommit構造から導出したH_impl ${inferred.implementation} と一致しません。review headの親commitで\`review export\`を実行し直してください`,
    );
  /**
   * **比較基点を前へ進めると監査範囲が縮む。** 縮めた範囲では、除外したcommitが
   * 損失検知の走査範囲から消える（Issue #966）。`H_impl`と同じ二重確認を課す。
   *
   * **導出を試みて決まらなかった場合は合格へ倒さない。** 浅いcloneでは境界commitの親は
   * 2個に見えるがfork点を観測できず、`undefined`を対象外と同じに扱うと、検証すべき
   * 場所で黙って検証を飛ばす。`fetch-depth`の変更だけで判定を無効化できてしまう。
   */
  if (inferred.baseDerivable && inferred.base === undefined)
    errors.push(
      inferred.boundaryParentCount === 2
        ? `比較基点を導出できません。境界commitの第1親 ${inferred.boundaryFirstParent} とH_impl ${inferred.implementation} の一意なmerge-baseを解決できません。浅いcloneではfetch-depthを0にして全履歴を取得してください。merge-baseが複数ある履歴では、判定できる形へmergeを整理してください`
        : inferred.boundaryParentCount === 1
          ? `比較基点を導出できません。candidate外で固定したremote default branch tipを取得し、全履歴を取得して再実行してください`
          : `比較基点を導出できません。境界commitの親が${inferred.boundaryParentCount}個です。どの親が候補branchかを構造から決められないため、判定不能として拒否します`,
    );
  else if (inferred.base !== undefined && base !== inferred.base)
    errors.push(
      `review証跡の比較基点 ${base} が実際のcommit構造から導出した比較基点 ${inferred.base} と一致しません。H_implが含む最新の取り込み先branch commit ${inferred.base} を\`review export --base\`へ渡して再生成してください`,
    );
  for (const oid of [base, implementation]) {
    const resolved = git(["rev-parse", "--verify", `${oid}^{commit}`], root, {
      allowFailure: true,
    });
    if (resolved.status !== 0 || resolved.stdout.trim() !== oid)
      errors.push(`固定commitを解決できません: ${oid}`);
  }
  if (errors.length > 0)
    return { valid: false, errors, base, implementation, auditPath };
  if (base === implementation)
    errors.push("比較基点とH_implは異なるcommitでなければなりません");
  const baseAncestry = git(
    ["merge-base", "--is-ancestor", base, implementation],
    root,
    { allowFailure: true },
  );
  if (baseAncestry.status !== 0)
    errors.push("比較基点がH_implのancestorではありません");
  else if (base !== implementation)
    errors.push(
      ...evaluateMergeIntegrity(
        collectMergeObservations(root, base, implementation),
      ).errors,
    );
  const ancestry = git(
    ["merge-base", "--is-ancestor", implementation, current],
    root,
    { allowFailure: true },
  );
  if (ancestry.status !== 0)
    errors.push("H_implがcurrent HEADのancestorではありません");
  if (evidence.observed.session.countedRounds > MAX_REVIEW_ROUNDS)
    errors.push(
      `reviewラウンドが上限を超えています: ${evidence.observed.session.countedRounds}（上限${MAX_REVIEW_ROUNDS}）。同じ範囲の予算は自動更新しません`,
    );
  /**
   * **配布物影響はGitとpackage filesから導出して報告する。** 散文の記述は要求しない。
   * 生成物は配布境界の単位（`dist/<top>/`）へまとめる。
   */
  const changed =
    baseAncestry.status === 0 ? changedPaths(root, base, implementation) : [];
  const packageFiles = packageDistributionFiles(root);
  const distributed =
    packageFiles === undefined
      ? []
      : deriveDistributionImpact({
          changedPaths: [
            ...new Set(
              changed.map(
                (entry) => generatedDistributionGroup(entry) ?? entry,
              ),
            ),
          ],
          packageFiles,
        });
  return {
    valid: errors.length === 0,
    errors,
    base,
    implementation,
    current,
    auditPath,
    changedFiles: changed.length,
    countedRounds: evidence.observed.session.countedRounds,
    distributedPaths: distributed,
  };
}

/**
 * candidate内のstaleな`refs/remotes/origin/HEAD`をauthorityにせず、remoteが現在
 * 公開するHEADを直接固定する。通信失敗、対話認証要求、曖昧な応答はfail-closedにする。
 */
export function remoteDefaultTip(root: string): string | undefined {
  const observed = git(["ls-remote", "--symref", "origin", "HEAD"], root, {
    allowFailure: true,
    timeoutMs: 30_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (observed.status !== 0) return undefined;
  const symbolic = lines(observed.stdout).filter((line) =>
    /^ref: refs\/heads\/[^\s]+\s+HEAD$/u.test(line),
  );
  const tips = lines(observed.stdout)
    .map((line) => /^([a-f0-9]{40})\s+HEAD$/u.exec(line)?.[1])
    .filter((tip): tip is string => tip !== undefined);
  if (symbolic.length !== 1 || tips.length !== 1) return undefined;
  const tip = tips[0]!;
  const resolved = git(["rev-parse", "--verify", `${tip}^{commit}`], root, {
    allowFailure: true,
  });
  return resolved.status === 0 && resolved.stdout.trim() === tip
    ? tip
    : undefined;
}

if (isExecutionEntry(import.meta.url)) {
  const root = process.cwd();
  const result = checkFileAudit(root, LEGACY_RELEASE_BUMP_CUTOFF, {
    trustedDefaultTip: remoteDefaultTip(root),
    requireSingleParentBase: true,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}
