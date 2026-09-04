/**
 * 監査範囲に含まれるmerge commitが、どちらの親の内容も失っていないことを判定する。
 *
 * 判定はGit観測値だけを入力とする純関数であり、file systemとGitへ触れない。
 * 走査範囲の選択に使う`比較基点`は申告値であり、この不変条件の対象外である。
 * `比較基点`の独立導出はIssue #966が所有する。
 */
/**
 * 損失検知tokenの判定規則。**この定義が唯一の正本である。**
 *
 * 括弧を`(...)`とし量指定子を`{n,}`で書くため、JavaScriptの`RegExp`とPOSIX EREの
 * 双方で同じ意味を持つ。安定IDを包含し、`SHA-256`のようなID以外のtokenも拾う。
 * 広く拾うのは、片親が持っていた文字列がmergeで消えたことを検知する目的に沿う。
 */
export const LOSS_TOKEN_PATTERN = "[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)*-[0-9]{2,}";
const NEXT_ACTION = "mergeでは両親の内容を保持し、消す操作はmergeの後の通常commitで行ってください";
const UNREADABLE_NEXT_ACTION = "repositoryのobjectを復旧するか取得し直したうえで再実行してください";
const RENAME_NEXT_ACTION = "renameと内容変更を別commitへ分けて取り込み直してください";
/**
 * 文字列から損失検知tokenを重複なく昇順で取り出す。
 */
export function extractLossTokens(text) {
    if (typeof text !== "string" || text === "")
        return [];
    const matched = text.matchAll(new RegExp(LOSS_TOKEN_PATTERN, "gu"));
    return [...new Set([...matched].map((entry) => entry[0]))].sort();
}
function shortSha(commit) {
    return commit.slice(0, 8);
}
function tokensOf(observation) {
    return observation.kind === "present" ? observation.tokens : [];
}
function unreadableReason(label, observation) {
    return observation.kind === "unreadable"
        ? `${label}の内容を観測できません: ${observation.reason}`
        : undefined;
}
/**
 * 保持必須集合。両親が保持していたtokenと、いずれかの親がmerge-baseから新たに導入したtoken。
 * 片方の親だけがmerge-baseから削除したtokenは含まれない。
 */
function requiredTokens(observation) {
    const base = new Set(tokensOf(observation.base));
    const first = new Set(tokensOf(observation.firstParent));
    const second = new Set(tokensOf(observation.secondParent));
    const required = new Set();
    for (const token of first)
        if (second.has(token) || !base.has(token))
            required.add(token);
    for (const token of second)
        if (!base.has(token))
            required.add(token);
    return [...required].sort();
}
/**
 * merge結果側の実際のtoken集合。移動先が一意に確定しない場合はundefinedを返し、
 * 呼び出し側が判定不能として扱う。
 */
function actualTokens(observation) {
    if (observation.merged.kind === "present")
        return { tokens: observation.merged.tokens };
    const targets = observation.renameTargets ?? [];
    const resolved = targets.filter((target) => target.kind === "resolved");
    // どの親からも移動先を特定できない場合だけ、保持必須集合がすべて失われたものとする。
    if (resolved.length === 0)
        return { tokens: [] };
    if (resolved.length !== targets.length)
        return {
            undecidable: `一部の親でだけ移動先を特定できました: ${resolved
                .map((target) => `${shortSha(target.parent)}→${target.path}`)
                .join("、")}`,
        };
    const distinct = [...new Set(resolved.map((target) => target.path))];
    if (distinct.length > 1)
        return {
            undecidable: `移動先の候補が一意ではありません: ${distinct.join("、")}`,
        };
    const unreadable = resolved.find((target) => target.observation.kind === "unreadable");
    if (unreadable)
        return {
            undecidable: `移動先 ${unreadable.path} の内容を観測できません`,
        };
    return { tokens: tokensOf(resolved[0].observation) };
}
/**
 * 保持必須集合が空でない移動元だけを、移動先の占有主張として数える。
 * 空の移動元は失うものが無く、正当なrenameを衝突と誤検知させるだけである。
 */
function claimsTarget(observation) {
    return requiredTokens(observation).length > 0;
}
/**
 * 1つのmerge内で、複数の出現位置が同じ移動先pathへ潰れた組を返す。
 *
 * 潰れる形は2つある。異なる移動元が同じ移動先へ解決される場合と、移動先が
 * merge結果に残る別の要求元そのものである場合である。どちらも移動先の1個の
 * tokenで複数の出現位置を保持したと誤認する。
 */
function collidingRenameTargets(paths) {
    const occupied = new Set(paths
        .filter((observation) => observation.merged.kind === "present" && claimsTarget(observation))
        .map((observation) => observation.path));
    const sourcesByTarget = new Map();
    for (const observation of paths) {
        if (!claimsTarget(observation))
            continue;
        for (const target of observation.renameTargets ?? []) {
            if (target.kind !== "resolved")
                continue;
            const sources = sourcesByTarget.get(target.path) ?? new Set();
            sources.add(observation.path);
            if (occupied.has(target.path))
                sources.add(target.path);
            sourcesByTarget.set(target.path, sources);
        }
    }
    return new Map([...sourcesByTarget]
        .filter(([, sources]) => sources.size > 1)
        .map(([target, sources]) => [target, [...sources].sort()]));
}
function collidingTargetOf(observation, collisions) {
    for (const target of observation.renameTargets ?? [])
        if (target.kind === "resolved" && collisions.has(target.path))
            return target.path;
    return undefined;
}
function evaluatePath(commit, observation, collisions) {
    const unreadable = [
        unreadableReason("merge-base", observation.base),
        unreadableReason("第1親", observation.firstParent),
        unreadableReason("第2親", observation.secondParent),
        unreadableReason("merge結果", observation.merged),
    ].filter((reason) => reason !== undefined);
    if (unreadable.length > 0)
        return unreadable.map((reason) => `${shortSha(commit)} の ${observation.path} を判定できません。${reason}。観測できない内容を空として扱わずに拒否します。${UNREADABLE_NEXT_ACTION}`);
    const collided = collidingTargetOf(observation, collisions);
    if (collided !== undefined)
        return [
            `${shortSha(commit)} の ${observation.path} を判定できません。複数の移動元が同じ移動先 ${collided} へ解決されました: ${collisions.get(collided).join("、")}。${RENAME_NEXT_ACTION}`,
        ];
    const actual = actualTokens(observation);
    if ("undecidable" in actual)
        return [
            `${shortSha(commit)} の ${observation.path} を判定できません。${actual.undecidable}。${RENAME_NEXT_ACTION}`,
        ];
    const present = new Set(actual.tokens);
    const lost = requiredTokens(observation).filter((token) => !present.has(token));
    if (lost.length === 0)
        return [];
    return [
        `${shortSha(commit)} のmergeが ${observation.path} の損失検知tokenを失っています: ${lost.join("、")}。${NEXT_ACTION}`,
    ];
}
function evaluateObservation(observation) {
    const commit = shortSha(observation.commit);
    if (observation.parents.length !== 2)
        return [
            `${commit} は親が${observation.parents.length}個であり追随mergeとして判定できません。単一のmerge-baseを持つ2親mergeで取り込み直してください`,
        ];
    if (observation.mergeBases.length !== 1)
        return [
            `${commit} はmerge-baseが${observation.mergeBases.length}個であり一意ではありません。単一のmerge-baseを持つ2親mergeで取り込み直してください`,
        ];
    const collisions = collidingRenameTargets(observation.paths);
    return observation.paths.flatMap((path) => evaluatePath(observation.commit, path, collisions));
}
/**
 * 観測列から損失と判定不能を評価する。例外を投げず、すべてerrorsへ入れる。
 */
export function evaluateMergeIntegrity(observations) {
    const errors = observations.flatMap(evaluateObservation);
    return {
        valid: errors.length === 0,
        errors,
        checkedMerges: observations.length,
        inspectedPaths: observations.reduce((total, observation) => total + observation.paths.length, 0),
    };
}
//# sourceMappingURL=merge-integrity.js.map