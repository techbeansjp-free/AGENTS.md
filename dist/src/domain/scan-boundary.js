/**
 * 品質検査の走査境界を観測し、2入力の差分を返す。
 *
 * **この層は除外規則を所有しない。** 各gateの除外述語は引数として受け取り、
 * ここでは適用結果を記録するだけである。`.gitignore`も読まない。
 * 除外条件をここへ書くと、Issue #960が否定した「検査ごとの目的に関係なく
 * 対象を黙って縮小する共通列挙層」になる。
 *
 * 差分は2種類へ分ける。除外pathと件数を出せば観測の生出力は必ず変わるため、
 * 「rootでだけ落ちる」の検出に使えるのは判定へ届いたpathの差だけである。
 */
/**
 * 観測に使えるrepository相対pathか判定する。
 *
 * **これは除外規則ではなく入力検証である。** 絶対path、空、`.`、`..`を含むものは
 * 判定不能とし、除外側へ倒さない。倒すと、走査から外れたのか判定できなかったのかを
 * 区別できなくなる。
 */
function isObservableRelativePath(candidate) {
    if (typeof candidate !== "string" || candidate === "")
        return false;
    const normalized = candidate.replaceAll("\\", "/");
    /**
     * **絶対pathの判定を別に置かない。** 先頭が`/`なら最初のsegmentが空になり、
     * 下のsegment検査が必ず拒否する。別の分岐を置くと、消しても検出できない
     * 等価な分岐が残る（変異試験で実測）。
     */
    return !normalized
        .split("/")
        .some((segment) => segment === "" || segment === "." || segment === "..");
}
export function observeScanBoundary(input) {
    const incomplete = [];
    const registry = new Map(input.sources.map((source) => [source.gate, source]));
    const observable = input.paths.filter((candidate) => {
        if (isObservableRelativePath(candidate))
            return true;
        incomplete.push({
            code: "unresolvable-path",
            gate: undefined,
            path: candidate,
            detail: "repository相対pathとして解決できません。絶対path、空segment、`.`、`..`は判定不能とします",
        });
        return false;
    });
    const gates = [];
    for (const gate of input.gates) {
        const source = registry.get(gate);
        if (source === undefined) {
            incomplete.push({
                code: "unknown-gate",
                gate,
                path: undefined,
                detail: "除外述語の供給元が登録されていないgateです",
            });
            continue;
        }
        if (source.excludes === undefined) {
            incomplete.push({
                code: "predicate-unavailable",
                gate,
                path: undefined,
                detail: source.reason,
            });
            continue;
        }
        const included = [];
        const excluded = [];
        for (const relative of observable) {
            if (source.excludes(relative))
                excluded.push({ path: relative, reason: source.reason });
            else
                included.push(relative);
        }
        gates.push({
            gate,
            included,
            excluded,
            includedCount: included.length,
            excludedCount: excluded.length,
        });
    }
    return {
        gates,
        incomplete,
        complete: incomplete.length === 0,
    };
}
function observedPaths(observation) {
    return new Map(observation.gates.map((gate) => [
        gate.gate,
        {
            all: new Set([
                ...gate.included,
                ...gate.excluded.map((entry) => entry.path),
            ]),
            included: new Set(gate.included),
        },
    ]));
}
function symmetricDifference(left, right) {
    return [
        ...[...left].filter((value) => !right.has(value)),
        ...[...right].filter((value) => !left.has(value)),
    ];
}
/**
 * 2つの観測から走査差分と判定差分を分けて返す。
 *
 * - `scopeDelta`: 走査対象として観測されたpath集合の差。代表生成物を観測できた証拠
 * - `semanticDelta`: **判定へ届いたpath集合の差。** 正しく除外される生成物なら0になる
 *
 * **対象gate一覧が一致しない2件は比較しない。** 片方にしか無いgateの差を
 * 生成物由来の差と取り違える。
 */
export function compareScanBoundary(baseline, contaminated) {
    const left = observedPaths(baseline);
    const right = observedPaths(contaminated);
    const missing = symmetricDifference(new Set(left.keys()), new Set(right.keys()));
    if (missing.length > 0)
        return {
            comparable: false,
            scopeDelta: 0,
            semanticDelta: 0,
            contributingPaths: [],
            detail: `対象gate一覧が一致しません: ${[...missing].sort().join("、")}`,
        };
    let scopeDelta = 0;
    let semanticDelta = 0;
    const contributing = new Set();
    for (const [gate, before] of left) {
        const after = right.get(gate);
        if (after === undefined)
            continue;
        scopeDelta += symmetricDifference(before.all, after.all).length;
        const semantic = symmetricDifference(before.included, after.included);
        semanticDelta += semantic.length;
        for (const relative of semantic)
            contributing.add(relative);
    }
    return {
        comparable: true,
        scopeDelta,
        semanticDelta,
        contributingPaths: [...contributing].sort(),
        detail: semanticDelta === 0
            ? "判定へ届いたpathに差はありません"
            : "判定へ届いたpathに差があります。除外が効いていないgateがあります",
    };
}
//# sourceMappingURL=scan-boundary.js.map