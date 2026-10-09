import { stableJson } from "../lib/security.js";
import { isSecuritySensitivePath } from "./impact-set.js";
import { REVIEW_CUMULATIVE_PATH_LIMIT, } from "./review-convergence.js";
import { advanceFollowBase, followCrossing, } from "./review-reuse-follow.js";
/**
 * review再利用判定（Issue #1544、02 §4.1のC2）。session記録とGit観測値だけから
 * transition鎖（TERM-1544-04）を再導出し、再review必須条件（TERM-1544-03）を返す。
 * **Gitを呼ばない。** 観測は`ReuseObserver`が行い、観測の例外は`判定不能`へ倒す（INV-03）。
 * `review round --init`の割当と`pr merge`の判定は同じ`judgeReviewReuse`を通る。
 */
export const REUSE_KIND = {
    break: "断絶",
    digest: "digest不一致",
    adjacent: "依存先未検分",
    follow: "追随交差",
    base: "基点不一致",
    legacy: "旧形式session",
    undecidable: "判定不能",
    cumulative: "累積差分未検分",
};
const WHOLE = "全体検分round（review round --initがinspection.cumulative.scope=allを割り当てる）を記録するか、review replace --staging=<staging> --applyでsessionを置換する";
const NEXT_ACTION = {
    断絶: `review round --init --head=<実効H_impl>でfocused roundを記録する。鎖を繋げない場合は${WHOLE}`,
    digest不一致: WHOLE,
    依存先未検分: WHOLE,
    追随交差: "review round --init --head=<実効H_impl>で割当どおりの累積検分round（inspection.cumulative.scope=paths）を記録する",
    基点不一致: "既定branch追随mergeをreview round --initで単独roundとして記録するか、review replace --staging=<staging> --applyでsessionを置換する",
    旧形式session: WHOLE,
    判定不能: WHOLE,
    累積差分未検分: "review round --init --head=<実効H_impl>で割当どおりの累積検分round（inspection.cumulative.scope=paths）を記録する",
};
const WHOLE_KINDS = new Set([
    REUSE_KIND.break,
    REUSE_KIND.digest,
    REUSE_KIND.adjacent,
    REUSE_KIND.legacy,
    REUSE_KIND.undecidable,
]);
/** 空のdiff本文のsha256。sectionが無いpathの累積digestに使う。 */
export const EMPTY_DIFF_DIGEST = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
function byteSorted(values) {
    return [...new Set(values)].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}
/**
 * `recordLayerOnly`を除くroundを記録順に並べる（02 §4.1手順1）。round 1の`candidateHeadSha`は
 * domainが`anchor.initialHeadSha`と一致させている。
 */
function chainPositions(session, prospective) {
    const rounds = [
        ...session.rounds
            .filter((record) => !record.recordLayerOnly)
            .map((record) => ({
            kind: record.followOnly ? "follow" : "counted",
            fromSha: record.inspection?.fromSha,
            toSha: record.candidateHeadSha,
            inspection: record.inspection,
            focus: record.focus,
            prospective: false,
        })),
        ...(prospective
            ? [{ ...prospective, inspection: undefined, prospective: true }]
            : []),
    ];
    return rounds.map((round, index) => {
        const linkFrom = rounds[index - 1]?.toSha ?? session.anchor.diffBaseSha;
        return {
            kind: index === 0 ? "first" : round.kind,
            linkFrom,
            fromSha: index === 0
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
export function judgeReviewReuse(input) {
    const { observer } = input;
    const items = [];
    const add = (kind, fromSha, toSha, paths = [], extra = {}) => {
        items.push(Object.freeze({
            kind,
            paths: Object.freeze(byteSorted(paths)),
            ...(extra.mainPaths
                ? { mainPaths: Object.freeze(byteSorted(extra.mainPaths)) }
                : {}),
            fromSha,
            toSha,
            recomputedDigest: extra.digest ?? null,
            nextAction: NEXT_ACTION[kind],
        }));
    };
    const attempt = (position, observe) => {
        try {
            return observe();
        }
        catch {
            add(REUSE_KIND.undecidable, position.fromSha, position.toSha);
            return undefined;
        }
    };
    const positions = chainPositions(input.session, input.prospective);
    // 手順3: 導出基点はclean追随（link・counted merge transitionともC4が真）でだけ前進する。
    const bases = [];
    const followParents = [];
    let base = input.session.anchor.diffBaseSha;
    positions.forEach((position, index) => {
        if (position.kind !== "first" && position.fromSha !== position.toSha) {
            const parent = attempt(position, () => observer.followParent(position.fromSha, position.toSha, base));
            followParents[index] = parent;
            base = advanceFollowBase(base, parent);
        }
        bases[index] = base;
    });
    // 手順4: 最も後ろの全体検分positionを`j*`にする。
    let fullIndex = 0;
    for (let index = positions.length - 1; index > 0; index -= 1) {
        const position = positions[index];
        const cumulative = position.inspection?.cumulative;
        if (position.kind !== "counted" || cumulative?.scope !== "all")
            continue;
        if (cumulative.baseSha !== bases[index]) {
            add(REUSE_KIND.digest, cumulative.baseSha, position.toSha);
            continue;
        }
        const digest = attempt(position, () => observer.wholeDigest(cumulative.baseSha, position.toSha));
        if (digest === cumulative.diffDigest) {
            fullIndex = index;
            break;
        }
        if (digest !== undefined)
            add(REUSE_KIND.digest, cumulative.baseSha, position.toSha, [], {
                digest,
            });
    }
    // 手順5: `j*`より後のpositionだけを照合し、累積検分要求pathをtagする。
    const tags = new Map();
    const retag = (paths, index) => {
        for (const path of paths) {
            const previous = tags.get(path);
            if (previous)
                tags.set(path, { ...previous, position: index });
        }
    };
    for (let index = fullIndex + 1; index < positions.length; index += 1) {
        const position = positions[index];
        if (position.kind === "follow") {
            const parent = followParents[index];
            if (parent === undefined) {
                add(REUSE_KIND.break, position.linkFrom, position.toSha);
                continue;
            }
            const observed = attempt(position, () => observer.follow(bases[index - 1], parent, position.toSha));
            if (observed === undefined)
                continue;
            const crossing = followCrossing(observed);
            if (crossing.undecidable) {
                add(REUSE_KIND.undecidable, position.linkFrom, position.toSha);
                continue;
            }
            retag(observed.mainChanged, index);
            for (const path of crossing.crossing)
                tags.set(path, {
                    position: index,
                    origin: "follow",
                    mainPaths: observed.mainChanged,
                });
            continue;
        }
        if (position.inspection === undefined && !position.prospective) {
            add(REUSE_KIND.legacy, position.fromSha, position.toSha);
            continue;
        }
        if (position.linkFrom !== position.fromSha) {
            const link = attempt(position, () => observer.link(position.linkFrom, position.fromSha));
            if (link === "break")
                add(REUSE_KIND.break, position.linkFrom, position.fromSha);
        }
        const observed = attempt(position, () => observer.transition(position.fromSha, position.toSha));
        if (observed === undefined)
            continue;
        if (!position.prospective) {
            if (observed.digest !== position.inspection.diffDigest)
                add(REUSE_KIND.digest, position.fromSha, position.toSha, [], {
                    digest: observed.digest,
                });
            if (stableJson(observed.adjacentScope) !==
                stableJson(position.focus.adjacentScope) ||
                observed.unbounded !== (position.focus.adjacentScopeUnbounded === true)) {
                const recorded = new Set(position.focus.adjacentScope.map(({ path }) => path));
                const derived = observed.adjacentScope.map(({ path }) => path);
                const missing = derived.filter((path) => !recorded.has(path));
                add(REUSE_KIND.adjacent, position.fromSha, position.toSha, missing.length > 0 ? missing : derived, { digest: observed.digest });
            }
        }
        retag(observed.changedPaths, index);
        for (const path of observed.changedPaths)
            if (isSecuritySensitivePath(path))
                tags.set(path, { position: index, origin: "security", mainPaths: [] });
    }
    const last = positions.at(-1);
    const auditBase = input.actualAuditBase ?? base;
    if (input.actualAuditBase !== undefined && base !== input.actualAuditBase) {
        const paths = attempt(last, () => observer.changedPaths(base, input.actualAuditBase));
        add(REUSE_KIND.base, last.fromSha, last.toSha, paths ?? []);
    }
    if (last.toSha !== input.effectiveHeadSha)
        add(REUSE_KIND.break, last.toSha, input.effectiveHeadSha);
    // 手順6: tag済みpathは最後のtag以降の累積検分で、監査diffのsection digestと照合する。
    if (tags.size > 0) {
        const sections = attempt(last, () => observer.sections(auditBase, input.effectiveHeadSha));
        const uncovered = new Map();
        for (const [path, tag] of sections ? tags : []) {
            const expected = sections.get(path) ?? EMPTY_DIFF_DIGEST;
            const covered = positions.some((position, index) => {
                const cumulative = position.inspection?.cumulative;
                return (index >= tag.position &&
                    index > fullIndex &&
                    position.kind === "counted" &&
                    cumulative?.scope === "paths" &&
                    cumulative.baseSha === bases[index] &&
                    cumulative.paths.some((entry) => entry.path === path && entry.diffDigest === expected));
            });
            if (covered)
                continue;
            const group = uncovered.get(tag.position) ?? {
                security: [],
                follow: [],
                mainPaths: [],
            };
            if (tag.origin === "follow") {
                group.follow.push(path);
                group.mainPaths.push(...tag.mainPaths);
            }
            else
                group.security.push(path);
            uncovered.set(tag.position, group);
        }
        for (const [index, group] of [...uncovered].sort(([a], [b]) => a - b)) {
            const position = positions[index];
            if (group.follow.length > 0)
                add(REUSE_KIND.follow, position.linkFrom, position.toSha, group.follow, { mainPaths: group.mainPaths });
            if (group.security.length > 0)
                add(REUSE_KIND.cumulative, position.fromSha, position.toSha, group.security);
        }
    }
    return Object.freeze({
        verdict: items.length === 0
            ? "reusable"
            : items.some(({ kind }) => kind === REUSE_KIND.undecidable)
                ? "undecidable"
                : "review-required",
        derivedBaseSha: base,
        reviewRequired: Object.freeze(items),
    });
}
/**
 * 雛形の検分割当（02 §4.1）。記録しようとするroundを仮の末尾positionとして`judgeReviewReuse`
 * で評価し、残る該当から`inspection`（必要時`cumulative`）を決める。clean追随は先に
 * `followOnly` linkとして評価し、該当が無ければ`followOnly`にする。別規則を持たない。
 */
export function assignInspectionForRound(input) {
    const { observer, toSha } = input;
    const prospective = (kind) => ({
        kind,
        fromSha: input.fromSha,
        toSha,
        focus: input.focus,
    });
    if (input.allowFollowOnly && input.fromSha !== toSha) {
        const follow = judgeReviewReuse({
            session: input.session,
            effectiveHeadSha: toSha,
            observer,
            prospective: prospective("follow"),
        });
        if (follow.reviewRequired.length === 0)
            return { followOnly: true, derivedBaseSha: follow.derivedBaseSha };
    }
    const transition = observer.transition(input.fromSha, toSha);
    const verdict = judgeReviewReuse({
        session: input.session,
        effectiveHeadSha: toSha,
        observer,
        prospective: prospective("counted"),
    });
    const baseSha = verdict.derivedBaseSha;
    const pending = byteSorted(verdict.reviewRequired
        .filter(({ kind }) => kind === REUSE_KIND.follow || kind === REUSE_KIND.cumulative)
        .flatMap(({ paths }) => paths));
    let cumulative;
    if (transition.unbounded ||
        pending.length > REVIEW_CUMULATIVE_PATH_LIMIT ||
        verdict.reviewRequired.some(({ kind }) => WHOLE_KINDS.has(kind)))
        cumulative = {
            baseSha,
            scope: "all",
            diffDigest: observer.wholeDigest(baseSha, toSha),
        };
    else if (pending.length > 0) {
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
        derivedBaseSha: baseSha,
        reviewRequired: verdict.reviewRequired,
    };
}
function listPaths(paths) {
    if (paths.length === 0)
        return "なし";
    const shown = paths.slice(0, 20).join(",");
    return paths.length > 20 ? `${shown} ほか${paths.length - 20}件` : shown;
}
/**
 * `pr merge`の拒否診断（DIAG-1544）。SHA・sha256・相対pathだけを出す。基点不一致は
 * 既存文「実際のmerge-base(X)がreview sessionの比較基点(Y)と一致しません」を先頭に保つ。
 */
export function formatReuseDiagnostic(verdict, context) {
    const lines = [
        `review再利用条件が成立しません: verdict=${verdict.verdict} 該当=${verdict.reviewRequired.length}件 session=${context.sessionId.slice(0, 12)} 導出基点=${verdict.derivedBaseSha} actualAuditBase=${context.actualAuditBase} 実効H_impl=${context.effectiveHeadSha}`,
        ...verdict.reviewRequired.map((item) => `[${item.kind}] path=${listPaths(item.paths)}${item.mainPaths ? ` 既定branch側path=${listPaths(item.mainPaths)}` : ""} transition=${item.fromSha}..${item.toSha} 再計算digest=${item.recomputedDigest ?? "なし"} 次の操作: ${item.nextAction}`),
    ];
    if (verdict.reviewRequired.some(({ kind }) => kind === REUSE_KIND.base))
        lines.unshift(`実際のmerge-base(${context.actualAuditBase})がreview sessionの比較基点(${verdict.derivedBaseSha})と一致しません。`);
    return lines.join("\n");
}
//# sourceMappingURL=review-reuse.js.map