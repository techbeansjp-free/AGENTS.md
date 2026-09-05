/**
 * 登録済みの除外述語が、与えられたpath集合のどれを除外するかを観測する。
 *
 * **測るのはgateの判定差分ではない。** 述語はgate全体ではなくgate内の一部の検査へ
 * 適用される。`isIssueStagingPath`は`check_trace.ts`のSCN配置検査だけに使われ、
 * 同じMarkdownは同gateの要件本文検査へ届く。`check_directory_guides.ts`は
 * `.agent-skill-chain`配下だけを再帰し、`check_package_contents.ts`の実対象は
 * `npm pack`の出力である。**述語の適用範囲をgate全体だと仮定すると、gateの判定を
 * 再現していないのに再現したことになる**（Issue #960 round 1、F-01）。
 *
 * したがってこの層が答えるのは1つだけである。
 * **「この生成物は、登録済みのどの述語にも掛からないか」。**
 * 掛からない生成物は、どこかの検査の判定へそのまま届く。#953の
 * `.agent-skill-chain/tmp/issues`は掛かり、`.claude/`はどの述語にも掛からない。
 *
 * **この層は除外規則を所有しない。** 述語は引数として受け取り、`.gitignore`も読まない。
 */

/** 観測が不完全になった理由。有限列挙とし、設定fileへ出さない。 */
export type ScanBoundaryIncompleteCode =
  | "unknown-predicate"
  | "duplicate-predicate"
  | "missing-predicate"
  | "unresolvable-path"
  | "predicate-unavailable"
  | "scan-failed";

export interface ScanBoundaryIncomplete {
  readonly code: ScanBoundaryIncompleteCode;
  readonly predicate: string | undefined;
  readonly path: string | undefined;
  readonly detail: string;
}

export interface ScanBoundaryExclusion {
  readonly path: string;
  readonly reasonCode: string;
  readonly reason: string;
}

/**
 * 除外述語の供給元。
 *
 * `appliesTo`には**gate名ではなく適用される検査の範囲**を書く。gate名だけを書くと
 * 「gate全体の除外」と読める。`excludes`が`undefined`の述語は、除外集合を
 * moduleとして公開していないため観測できない。**成功へ倒さず不完全に数える。**
 */
export interface ExclusionPredicateSource {
  readonly id: string;
  readonly owner: string;
  readonly appliesTo: string;
  readonly reasonCode: string;
  readonly reason: string;
  readonly excludes: ((relative: string) => boolean) | undefined;
}

export interface PredicateCoverage {
  readonly predicate: string;
  readonly owner: string;
  readonly appliesTo: string;
  readonly excluded: readonly ScanBoundaryExclusion[];
  readonly excludedCount: number;
}

export interface ScanBoundaryObservation {
  readonly predicates: readonly PredicateCoverage[];
  /** どの述語にも掛からなかったpath。**昇順で返す。** */
  readonly uncovered: readonly string[];
  readonly observedPaths: readonly string[];
  readonly incomplete: readonly ScanBoundaryIncomplete[];
  readonly complete: boolean;
}

export interface ScanBoundaryComparison {
  readonly comparable: boolean;
  readonly scopeDelta: number;
  readonly uncoveredDelta: number;
  readonly contributingPaths: readonly string[];
  readonly detail: string;
}

/**
 * 観測に使えるrepository相対pathか判定する。
 *
 * **これは除外規則ではなく入力検証である。** 空、`.`、`..`を含むもの、および
 * drive修飾を持つものは判定不能とし、除外側へ倒さない。倒すと、走査から外れたのか
 * 判定できなかったのかを区別できない。
 *
 * **絶対pathの判定を別に置かない。** 先頭が`/`なら最初のsegmentが空になり、
 * 下のsegment検査が必ず拒否する。別の分岐を置くと、消しても検出できない
 * 等価な分岐が残る（変異試験で実測）。
 */
function isObservableRelativePath(candidate: string): boolean {
  if (typeof candidate !== "string" || candidate === "") return false;
  const normalized = candidate.replaceAll("\\", "/");
  if (/^[A-Za-z]:/u.test(normalized)) return false;
  return !normalized
    .split("/")
    .some((segment) => segment === "" || segment === "." || segment === "..");
}

export function observeScanBoundary(input: {
  /** 観測を期待する述語ID。**供給元とは独立に与える。** 欠落を検出するためである。 */
  readonly predicates: readonly string[];
  readonly paths: readonly string[];
  readonly sources: readonly ExclusionPredicateSource[];
}): ScanBoundaryObservation {
  const incomplete: ScanBoundaryIncomplete[] = [];
  const registry = new Map<string, ExclusionPredicateSource>();
  for (const source of input.sources) {
    if (registry.has(source.id))
      incomplete.push({
        /**
         * **二重登録を未知の登録と同じcodeで返さない。** 文字列の`detail`だけでは
         * 構造化された区別にならず、呼び出し側が理由で分岐できない。
         */
        code: "duplicate-predicate",
        predicate: source.id,
        path: undefined,
        detail: "同じ述語IDが二重に登録されています",
      });
    registry.set(source.id, source);
  }
  /**
   * **供給元にしか無い述語も不完全に数える。** 期待一覧を供給元から作ると、
   * 供給元の削除で期待も同時に縮み、欠落を検出できない（F-02）。
   */
  for (const id of registry.keys())
    if (!input.predicates.includes(id))
      incomplete.push({
        code: "unknown-predicate",
        predicate: id,
        path: undefined,
        detail: "期待一覧に無い述語が登録されています",
      });
  const observed = input.paths.filter((candidate) => {
    if (isObservableRelativePath(candidate)) return true;
    incomplete.push({
      code: "unresolvable-path",
      predicate: undefined,
      path: candidate,
      detail:
        "repository相対pathとして解決できません。空segment、`.`、`..`、drive修飾は判定不能とします",
    });
    return false;
  });
  const predicates: PredicateCoverage[] = [];
  const covered = new Set<string>();
  for (const id of input.predicates) {
    const source = registry.get(id);
    if (source === undefined) {
      incomplete.push({
        code: "missing-predicate",
        predicate: id,
        path: undefined,
        detail: "期待した述語が登録されていません",
      });
      continue;
    }
    if (source.excludes === undefined) {
      incomplete.push({
        code: "predicate-unavailable",
        predicate: id,
        path: undefined,
        detail: source.reason,
      });
      continue;
    }
    const excluded: ScanBoundaryExclusion[] = [];
    for (const relative of observed)
      if (source.excludes(relative)) {
        excluded.push({
          path: relative,
          reasonCode: source.reasonCode,
          reason: source.reason,
        });
        covered.add(relative);
      }
    predicates.push({
      predicate: id,
      owner: source.owner,
      appliesTo: source.appliesTo,
      excluded,
      excludedCount: excluded.length,
    });
  }
  return {
    predicates,
    uncovered: observed.filter((relative) => !covered.has(relative)).sort(),
    observedPaths: [...observed].sort(),
    incomplete,
    complete: incomplete.length === 0,
  };
}

function symmetricDifference(
  left: readonly string[],
  right: readonly string[],
): string[] {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return [
    ...left.filter((value) => !rightSet.has(value)),
    ...right.filter((value) => !leftSet.has(value)),
  ];
}

/**
 * 2つの観測から走査差分と被覆差分を分けて返す。
 *
 * - `scopeDelta`: 観測対象として受理されたpath集合の差。代表生成物を観測できた証拠
 * - `uncoveredDelta`: **どの述語にも掛からないpath集合の差。** 足した生成物が
 *   いずれかの述語に掛かるなら0になる
 *
 * **不完全な観測を比較しない。** 見ていない述語がある状態の「差なし」は、
 * 差が無かったのではなく見ていないだけである（F-04）。
 */
export function compareScanBoundary(
  baseline: ScanBoundaryObservation,
  contaminated: ScanBoundaryObservation,
): ScanBoundaryComparison {
  const refuse = (detail: string): ScanBoundaryComparison => ({
    comparable: false,
    scopeDelta: 0,
    uncoveredDelta: 0,
    contributingPaths: [],
    detail,
  });
  if (!baseline.complete || !contaminated.complete)
    return refuse(
      "不完全な観測は比較しません。見ていない述語がある状態の差は根拠になりません",
    );
  const missing = symmetricDifference(
    baseline.predicates.map((entry) => entry.predicate),
    contaminated.predicates.map((entry) => entry.predicate),
  );
  if (missing.length > 0)
    return refuse(`述語一覧が一致しません: ${[...missing].sort().join("、")}`);
  const uncovered = symmetricDifference(
    baseline.uncovered,
    contaminated.uncovered,
  );
  return {
    comparable: true,
    scopeDelta: symmetricDifference(
      baseline.observedPaths,
      contaminated.observedPaths,
    ).length,
    uncoveredDelta: uncovered.length,
    contributingPaths: [...new Set(uncovered)].sort(),
    detail:
      uncovered.length === 0
        ? "どの述語にも掛からないpathに差はありません"
        : "どの述語にも掛からないpathが増えています。登録済みの述語が覆っていない生成物があります",
  };
}
