import { stableJson } from "../lib/security.js";
import { isSecuritySensitivePath } from "./impact-set.js";
import {
  REVIEW_CUMULATIVE_PATH_LIMIT,
  type ReviewAdjacentScope,
  type ReviewCumulativeInspection,
  type ReviewInspection,
  type ReviewRoundFocus,
  type ReviewSessionState,
} from "./review-convergence.js";

/**
 * review再利用判定（Issue #1544、02 §4.1のC2）。session記録とGit観測値だけから
 * transition鎖（TERM-1544-04）を再導出し、再review必須条件（TERM-1544-03）を返す。
 * **Gitを呼ばない。** 観測は`ReuseObserver`が行い、観測の例外は`判定不能`へ倒す（INV-03）。
 * `review round --init`の割当と`pr merge`の判定は同じ`judgeReviewReuse`を通る。
 * 既定branch追随による変化は再利用しない（05_計画変更 AMD-001）。round 1のheadより後の追随で
 * 比較基点が動いたら、その基点からの全体検分（`inspection.cumulative.scope="all"`）を要求する。
 * round 1のheadが既に`actualAuditBase`を含む（round 1の検分範囲と基点が食い違う）場合は、
 * 全体検分でも基点を動かさない（`review replace`で作り直す）。
 */

export const REUSE_KIND = {
  break: "断絶",
  digest: "digest不一致",
  adjacent: "依存先未検分",
  base: "基点不一致",
  legacy: "旧形式session",
  undecidable: "判定不能",
  cumulative: "累積差分未検分",
} as const;
export type ReuseKind = (typeof REUSE_KIND)[keyof typeof REUSE_KIND];

const WHOLE =
  "全体検分round（review round --initがinspection.cumulative.scope=allを割り当てる）を記録するか、review replace --staging=<staging> --applyでsessionを置換する";
const NEXT_ACTION: Readonly<Record<ReuseKind, string>> = {
  断絶: `review round --init --head=<実効H_impl>でfocused roundを記録する。鎖を繋げない場合は${WHOLE}`,
  digest不一致: WHOLE,
  依存先未検分: WHOLE,
  基点不一致:
    "round 1の後の既定branch追随で比較基点が動いた場合は、review round --init --head=<実効H_impl>が割り当てるactualAuditBaseからの全体検分round（inspection.cumulative.scope=all）を記録する。round 1のheadが既にactualAuditBaseを含む場合はreview replace --staging=<staging> --applyでsessionを置換する",
  旧形式session: WHOLE,
  判定不能: WHOLE,
  累積差分未検分:
    "review round --init --head=<実効H_impl>で割当どおりの累積検分round（inspection.cumulative.scope=paths）を記録する",
};
const WHOLE_KINDS: ReadonlySet<ReuseKind> = new Set([
  REUSE_KIND.break,
  REUSE_KIND.digest,
  REUSE_KIND.adjacent,
  REUSE_KIND.base,
  REUSE_KIND.legacy,
  REUSE_KIND.undecidable,
]);

/** 空のdiff本文のsha256。sectionが無いpathの累積digestに使う。 */
export const EMPTY_DIFF_DIGEST =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export interface ReviewRequiredItem {
  readonly kind: ReuseKind;
  readonly paths: readonly string[];
  readonly fromSha: string;
  readonly toSha: string;
  readonly recomputedDigest: string | null;
  readonly nextAction: string;
}

export interface ReuseVerdict {
  readonly verdict: "reusable" | "review-required" | "undecidable";
  readonly derivedBaseSha: string;
  readonly reviewRequired: readonly ReviewRequiredItem[];
}

/** transition 1件の観測（影響集合導出1回）。 */
export interface TransitionObservation {
  readonly digest: string;
  readonly changedPaths: readonly string[];
  readonly adjacentScope: readonly ReviewAdjacentScope[];
  readonly unbounded: boolean;
}

/** C3が実装するGit観測。いずれも例外を投げうる。 */
export interface ReuseObserver {
  /** 内容非変化のlinkか。 */
  link(
    previousHeadSha: string,
    nextSha: string,
  ): "evidence-suffix" | "tree-equal" | "break";
  transition(fromSha: string, toSha: string): TransitionObservation;
  wholeDigest(baseSha: string, toSha: string): string;
  /** `ancestorSha`が`descendantSha`の祖先（同一を含む）か。 */
  isAncestor(ancestorSha: string, descendantSha: string): boolean;
  changedPaths(fromSha: string, toSha: string): readonly string[];
  sections(baseSha: string, headSha: string): ReadonlyMap<string, string>;
}

/** 記録しようとするround（雛形の割当で仮の末尾positionにする）。 */
export interface ProspectiveRound {
  readonly fromSha: string;
  readonly toSha: string;
  readonly focus: ReviewRoundFocus;
}

export interface ReuseJudgeInput {
  readonly session: ReviewSessionState;
  /**
   * 実際のmerge-base（`pr merge`は検証済み既定branch tipから、雛形はlocal tipから求める）。
   * 全体検分はこの基点からのものだけを起点にする。省略時は`anchor.diffBaseSha`を使う。
   */
  readonly actualAuditBase?: string;
  readonly effectiveHeadSha: string;
  readonly observer: ReuseObserver;
  readonly prospective?: ProspectiveRound;
}

interface Position {
  readonly kind: "first" | "counted" | "follow";
  readonly linkFrom: string;
  readonly fromSha: string;
  readonly toSha: string;
  readonly inspection?: ReviewInspection;
  readonly focus: ReviewRoundFocus;
  readonly prospective: boolean;
}

function byteSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) =>
    Buffer.compare(Buffer.from(left), Buffer.from(right)),
  );
}

/**
 * `recordLayerOnly`を除くroundを記録順に並べる（02 §4.1手順1）。round 1の`candidateHeadSha`は
 * domainが`anchor.initialHeadSha`と一致させている。
 */
function chainPositions(
  session: ReviewSessionState,
  prospective: ProspectiveRound | undefined,
): Position[] {
  const rounds = [
    ...session.rounds
      .filter((record) => !record.recordLayerOnly)
      .map((record) => ({
        kind: record.followOnly ? ("follow" as const) : ("counted" as const),
        fromSha: record.inspection?.fromSha,
        toSha: record.candidateHeadSha,
        inspection: record.inspection,
        focus: record.focus,
        prospective: false,
      })),
    ...(prospective
      ? [
          {
            ...prospective,
            kind: "counted" as const,
            inspection: undefined,
            prospective: true,
          },
        ]
      : []),
  ];
  return rounds.map((round, index) => {
    const linkFrom = rounds[index - 1]?.toSha ?? session.anchor.diffBaseSha;
    return {
      kind: index === 0 ? "first" : round.kind,
      linkFrom,
      fromSha:
        index === 0
          ? linkFrom
          : round.kind === "follow"
            ? linkFrom
            : (round.fromSha ?? linkFrom),
      toSha: round.toSha,
      ...(round.inspection ? { inspection: round.inspection } : {}),
      focus: round.focus,
      prospective: round.prospective,
    };
  });
}

export function judgeReviewReuse(input: ReuseJudgeInput): ReuseVerdict {
  const { observer } = input;
  const items: ReviewRequiredItem[] = [];
  const add = (
    kind: ReuseKind,
    fromSha: string,
    toSha: string,
    paths: readonly string[] = [],
    digest?: string,
  ): void => {
    items.push(
      Object.freeze({
        kind,
        paths: Object.freeze(byteSorted(paths)),
        fromSha,
        toSha,
        recomputedDigest: digest ?? null,
        nextAction: NEXT_ACTION[kind],
      }),
    );
  };
  const attempt = <T>(position: Position, observe: () => T): T | undefined => {
    try {
      return observe();
    } catch {
      add(REUSE_KIND.undecidable, position.fromSha, position.toSha);
      return undefined;
    }
  };
  const positions = chainPositions(input.session, input.prospective);
  // 手順4: 実際のmerge-baseからの全体検分のうち最も後ろを`j*`にし、基点はそこでだけ動く。
  // 動かせるのは、round 1のheadが含まない基点（round 1より後の追随が持ち込んだ基点）だけである。
  const { anchor } = input.session;
  const target = input.actualAuditBase ?? anchor.diffBaseSha;
  let base = anchor.diffBaseSha;
  let fullIndex = 0;
  const rebasable =
    target === base ||
    attempt(positions[0]!, () =>
      observer.isAncestor(target, anchor.initialHeadSha),
    ) === false;
  for (let index = positions.length - 1; rebasable && index > 0; index -= 1) {
    const position = positions[index]!;
    const cumulative = position.inspection?.cumulative;
    if (
      position.kind !== "counted" ||
      cumulative?.scope !== "all" ||
      cumulative.baseSha !== target
    )
      continue;
    const digest = attempt(position, () =>
      observer.wholeDigest(cumulative.baseSha, position.toSha),
    );
    if (digest === cumulative.diffDigest) {
      fullIndex = index;
      base = target;
      break;
    }
    if (digest !== undefined)
      add(REUSE_KIND.digest, cumulative.baseSha, position.toSha, [], digest);
  }
  // 手順5: `j*`より後のcounted transitionだけを照合し、security pathをtagする。
  // 追随（`followOnly`）roundは何も被覆せず、基点も動かさない（AMD-001）。
  const tags = new Map<string, number>();
  for (let index = fullIndex + 1; index < positions.length; index += 1) {
    const position = positions[index]!;
    if (position.kind === "follow") continue;
    if (position.inspection === undefined && !position.prospective) {
      add(REUSE_KIND.legacy, position.fromSha, position.toSha);
      continue;
    }
    if (position.linkFrom !== position.fromSha) {
      const link = attempt(position, () =>
        observer.link(position.linkFrom, position.fromSha),
      );
      if (link === "break")
        add(REUSE_KIND.break, position.linkFrom, position.fromSha);
    }
    const observed = attempt(position, () =>
      observer.transition(position.fromSha, position.toSha),
    );
    if (observed === undefined) continue;
    if (!position.prospective) {
      if (observed.digest !== position.inspection!.diffDigest)
        add(
          REUSE_KIND.digest,
          position.fromSha,
          position.toSha,
          [],
          observed.digest,
        );
      if (
        stableJson(observed.adjacentScope) !==
          stableJson(position.focus.adjacentScope) ||
        observed.unbounded !== (position.focus.adjacentScopeUnbounded === true)
      ) {
        const recorded = new Set(
          position.focus.adjacentScope.map(({ path }) => path),
        );
        const derived = observed.adjacentScope.map(({ path }) => path);
        const missing = derived.filter((path) => !recorded.has(path));
        add(
          REUSE_KIND.adjacent,
          position.fromSha,
          position.toSha,
          missing.length > 0 ? missing : derived,
          observed.digest,
        );
      }
    }
    for (const path of observed.changedPaths)
      if (isSecuritySensitivePath(path)) tags.set(path, index);
  }
  const last = positions.at(-1)!;
  if (base !== target) {
    const paths = attempt(last, () => observer.changedPaths(base, target));
    add(REUSE_KIND.base, last.fromSha, last.toSha, paths ?? []);
  }
  if (last.toSha !== input.effectiveHeadSha)
    add(REUSE_KIND.break, last.toSha, input.effectiveHeadSha);
  // 手順6: tag済みpathは最後のtag以降の累積検分で、監査diffのsection digestと照合する。
  if (tags.size > 0) {
    const sections = attempt(last, () =>
      observer.sections(target, input.effectiveHeadSha),
    );
    const uncovered = new Map<number, string[]>();
    for (const [path, tagged] of sections ? tags : []) {
      const expected = sections!.get(path) ?? EMPTY_DIFF_DIGEST;
      const covered = positions.some((position, index) => {
        const cumulative = position.inspection?.cumulative;
        return (
          index >= tagged &&
          index > fullIndex &&
          position.kind === "counted" &&
          cumulative?.scope === "paths" &&
          cumulative.baseSha === base &&
          cumulative.paths.some(
            (entry) => entry.path === path && entry.diffDigest === expected,
          )
        );
      });
      if (!covered)
        uncovered.set(tagged, [...(uncovered.get(tagged) ?? []), path]);
    }
    for (const [index, paths] of [...uncovered].sort(([a], [b]) => a - b)) {
      const position = positions[index]!;
      add(REUSE_KIND.cumulative, position.fromSha, position.toSha, paths);
    }
  }
  return Object.freeze({
    verdict:
      items.length === 0
        ? "reusable"
        : items.some(({ kind }) => kind === REUSE_KIND.undecidable)
          ? "undecidable"
          : "review-required",
    derivedBaseSha: base,
    reviewRequired: Object.freeze(items),
  });
}

export interface InspectionAssignment {
  readonly inspection: ReviewInspection;
  readonly reviewRequired: readonly ReviewRequiredItem[];
}

/**
 * 雛形の検分割当（02 §4.1）。記録しようとするroundを仮の末尾positionとして`judgeReviewReuse`
 * で評価し、残る該当から`inspection`（必要時`cumulative`）を決める。別規則を持たない。
 * 比較基点が動いていれば（`基点不一致`）`actualAuditBase`からの全体検分を割り当てる（AMD-001）。
 */
export function assignInspectionForRound(input: {
  readonly session: ReviewSessionState;
  readonly actualAuditBase?: string;
  readonly fromSha: string;
  readonly toSha: string;
  readonly focus: ReviewRoundFocus;
  readonly observer: ReuseObserver;
}): InspectionAssignment {
  const { observer, toSha } = input;
  const transition = observer.transition(input.fromSha, toSha);
  const verdict = judgeReviewReuse({
    session: input.session,
    ...(input.actualAuditBase === undefined
      ? {}
      : { actualAuditBase: input.actualAuditBase }),
    effectiveHeadSha: toSha,
    observer,
    prospective: { fromSha: input.fromSha, toSha, focus: input.focus },
  });
  const pending = byteSorted(
    verdict.reviewRequired
      .filter(({ kind }) => kind === REUSE_KIND.cumulative)
      .flatMap(({ paths }) => paths),
  );
  let cumulative: ReviewCumulativeInspection | undefined;
  if (
    transition.unbounded ||
    pending.length > REVIEW_CUMULATIVE_PATH_LIMIT ||
    verdict.reviewRequired.some(({ kind }) => WHOLE_KINDS.has(kind))
  ) {
    const baseSha = input.actualAuditBase ?? input.session.anchor.diffBaseSha;
    cumulative = {
      baseSha,
      scope: "all",
      diffDigest: observer.wholeDigest(baseSha, toSha),
    };
  } else if (pending.length > 0) {
    const baseSha = verdict.derivedBaseSha;
    const sections = observer.sections(baseSha, toSha);
    cumulative = {
      baseSha,
      scope: "paths",
      paths: pending.map((path) => ({
        path,
        diffDigest: sections.get(path) ?? EMPTY_DIFF_DIGEST,
      })),
    };
  }
  return {
    inspection: {
      fromSha: input.fromSha,
      diffDigest: transition.digest,
      ...(cumulative ? { cumulative } : {}),
    },
    reviewRequired: verdict.reviewRequired,
  };
}

function listPaths(paths: readonly string[]): string {
  if (paths.length === 0) return "なし";
  const shown = paths.slice(0, 20).join(",");
  return paths.length > 20 ? `${shown} ほか${paths.length - 20}件` : shown;
}

/**
 * `pr merge`の拒否診断（DIAG-1544）。SHA・sha256・相対pathだけを出す。基点不一致は
 * 既存文「実際のmerge-base(X)がreview sessionの比較基点(Y)と一致しません」を先頭に保つ。
 */
export function formatReuseDiagnostic(
  verdict: ReuseVerdict,
  context: {
    readonly sessionId: string;
    readonly actualAuditBase: string;
    readonly effectiveHeadSha: string;
  },
): string {
  const lines = [
    `review再利用条件が成立しません: verdict=${verdict.verdict} 該当=${verdict.reviewRequired.length}件 session=${context.sessionId.slice(0, 12)} 導出基点=${verdict.derivedBaseSha} actualAuditBase=${context.actualAuditBase} 実効H_impl=${context.effectiveHeadSha}`,
    ...verdict.reviewRequired.map(
      (item) =>
        `[${item.kind}] path=${listPaths(item.paths)} transition=${item.fromSha}..${item.toSha} 再計算digest=${item.recomputedDigest ?? "なし"} 次の操作: ${item.nextAction}`,
    ),
  ];
  if (verdict.reviewRequired.some(({ kind }) => kind === REUSE_KIND.base))
    lines.unshift(
      `実際のmerge-base(${context.actualAuditBase})がreview sessionの比較基点(${verdict.derivedBaseSha})と一致しません。`,
    );
  return lines.join("\n");
}
