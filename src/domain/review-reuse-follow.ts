/**
 * 既定branch追随のtransitionだけを扱う判定部品（Issue #1544、02 §4.1手順5・6の追随部分）。
 * Gitを呼ばず、C3が観測した値だけを受け取る。
 */

/** clean追随（`followOnly` link）1件の観測。 */
export interface FollowObservation {
  /** `git diff --name-only 旧基点 第2親`（既定branch側の変更path）。 */
  readonly mainChanged: readonly string[];
  /** `computeImpactSet(第2親, merge)`の変更pathと隣接範囲path。 */
  readonly impactPaths: readonly string[];
  /** 影響集合が`full`（判定不能）。 */
  readonly unbounded: boolean;
}

/**
 * 追随で既定branch側から入った変化とPRの変更path・隣接範囲との交差X（FR-06・BR-07）。
 * 影響集合が`full`なら交差を判定できないため`undecidable`を返す（INV-03）。
 */
export function followCrossing(
  observation: FollowObservation,
): { undecidable: true } | { undecidable: false; crossing: string[] } {
  if (observation.unbounded) return { undecidable: true };
  const pullRequest = new Set(observation.impactPaths);
  return {
    undecidable: false,
    crossing: observation.mainChanged.filter((path) => pullRequest.has(path)),
  };
}

/**
 * 追随で導出基点を前進させる（02 §4.1）。前進するのはC4が真（`merge-tree`一致のclean merge）
 * で第2親が導出基点の子孫と観測された場合だけで、観測側は満たさなければ`undefined`を返す。
 */
export function advanceFollowBase(
  baseSha: string,
  secondParent: string | undefined,
): string {
  return secondParent ?? baseSha;
}
