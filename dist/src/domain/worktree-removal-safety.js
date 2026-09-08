import path from "node:path";
export const DEFAULT_FINALIZE_IGNORED_PATH_ALLOWLIST = [
    "node_modules/",
    "dist/",
];
const CONTROL = /\p{C}/u;
const PATTERN_META = /[\\*?[\]{}()|^$+]/u;
/**
 * blocking資産のpathから、その領域を所有するcommandの案内を返す。
 *
 * **入力は`validArtifactPath`を通過したpathだけである。** 空segment、`.`、`..`、絶対path、
 * `\\`、制御文字、非NFCは呼び出し前に不正観測として分離済みなので、`.agent-skill-chain/tmp/issues/`
 * のような末尾slash形や`tmp/issues/../runtime/x`はここへ届かない。**この関数は正規化しない。**
 *
 * **大小文字を畳み込まない。** Gitのpathはcase-sensitiveであり、畳み込むと
 * `.AGENT-SKILL-CHAIN/TMP/ISSUES/x`のような別pathを所有領域と誤認する。
 *
 * **報告だけを変え、判定を1つも変えない。** 案内はallowlist判定の**後**に生成し、
 * `allowedIgnoredArtifacts`へ触れない。REQ-LC-011の「報告するがhealthyを変えない」と
 * 同じ形である。
 *
 * **`STAGING_LIFECYCLE_AREAS`を流用しない。** 同配列は「真なら保護する」ライフサイクル
 * 分類の正本であり`.agent-skill-chain/tmp`全体を含む。案内が必要なのは`issue staging`が
 * 所有する`tmp/issues/`配下だけであり、分類の正本を案内へ流用すると、将来その配列へ
 * 領域を追加したとき誤った案内が出る。**分類と案内を分離する**（Issue #1290）。
 *
 * **exportしない。** 他所から流用され、分類の正本が削除許可の正本へ誤用される事故は
 * Issue #1248で検討され棄却された。同型の誤用の余地を作らない。
 *
 * 接頭辞は末尾`/`を含む。`.agent-skill-chain/tmp/issues`そのものと
 * `.agent-skill-chain/tmp/issues-other/x`は所有領域の**配下ではない**ので案内を出さない。
 */
const OWNING_COMMAND_HINTS = Object.freeze([
    Object.freeze({
        prefix: ".agent-skill-chain/tmp/issues/",
        hint: "この領域はissue stagingが所有します。まず issue staging --root=<worktree> を実行し、表示されたstate=deletion-readyとhashを確認してから issue staging --root=<worktree> --apply --approved-hash=<hash> を実行してください。その後にこのcommandを再実行します",
    }),
]);
function owningCommandHint(artifact) {
    return OWNING_COMMAND_HINTS.find((entry) => artifact.startsWith(entry.prefix))
        ?.hint;
}
export function isSafeFinalizeIgnoredPathPrefix(value) {
    if (typeof value !== "string" ||
        value === "" ||
        value !== value.normalize("NFC") ||
        !value.endsWith("/") ||
        path.isAbsolute(value) ||
        CONTROL.test(value) ||
        PATTERN_META.test(value))
        return false;
    const segments = value.slice(0, -1).split("/");
    return (segments.length > 0 &&
        segments.every((segment) => /^[A-Za-z0-9._-]+$/u.test(segment) &&
            segment !== "" &&
            segment !== "." &&
            segment !== ".." &&
            segment !== ".git"));
}
export function resolveFinalizeIgnoredPathAllowlist(additions = []) {
    return [
        ...new Set([...DEFAULT_FINALIZE_IGNORED_PATH_ALLOWLIST, ...additions]),
    ];
}
function validArtifactPath(value) {
    if (typeof value !== "string" ||
        value === "" ||
        value !== value.normalize("NFC") ||
        path.isAbsolute(value) ||
        value.includes("\\") ||
        CONTROL.test(value))
        return false;
    return value
        .split("/")
        .every((segment) => segment !== "" &&
        segment !== "." &&
        segment !== ".." &&
        segment !== ".git");
}
function matchesPrefix(artifact, prefix) {
    return artifact === prefix.slice(0, -1) || artifact.startsWith(prefix);
}
function describeUnknownArtifact(value) {
    if (typeof value === "string")
        return JSON.stringify(value);
    if (value === null)
        return "null";
    if (["number", "boolean", "undefined"].includes(typeof value))
        return String(value);
    return Array.isArray(value) ? "array" : typeof value;
}
export function assessWorktreeRemovalSafety(observation) {
    const reasons = [];
    const allowedIgnoredArtifacts = [];
    const blockingIgnoredArtifacts = [];
    if (observation.trackedChanges === true)
        reasons.push("未commitの追跡対象fileがあります");
    else if (observation.trackedChanges !== false)
        reasons.push("未commitの追跡対象fileがあるか状態が不明です");
    if (!Array.isArray(observation.untracked))
        reasons.push("未追跡fileの種別が不明です");
    else {
        const invalid = observation.untracked.filter((entry) => !validArtifactPath(entry));
        if (invalid.length > 0)
            reasons.push("未追跡fileの種別が不明です");
        const valid = observation.untracked.filter(validArtifactPath);
        if (valid.length > 0)
            reasons.push(`未追跡fileが${valid.length}件あります`);
    }
    const allowlist = Array.isArray(observation.ignoredPathAllowlist)
        ? observation.ignoredPathAllowlist.filter(isSafeFinalizeIgnoredPathPrefix)
        : [];
    const allowlistValid = Array.isArray(observation.ignoredPathAllowlist) &&
        allowlist.length === observation.ignoredPathAllowlist.length;
    if (!allowlistValid)
        reasons.push("無視対象資産allowlistの種別が不明です");
    if (!Array.isArray(observation.ignoredArtifacts))
        reasons.push("無視対象資産の種別が不明です");
    else {
        for (const artifact of observation.ignoredArtifacts) {
            if (!validArtifactPath(artifact)) {
                reasons.push(`無視対象資産のpath種別が不明です: ${describeUnknownArtifact(artifact)}`);
                continue;
            }
            if (allowlistValid &&
                allowlist.some((prefix) => matchesPrefix(artifact, prefix)))
                allowedIgnoredArtifacts.push(artifact);
            else {
                blockingIgnoredArtifacts.push(artifact);
                /**
                 * **既存の理由は先頭から変えない。** 案内は末尾へ足すだけである。
                 * 案内の有無は`blockingIgnoredArtifacts`にも`safe`にも影響しない。
                 */
                const hint = owningCommandHint(artifact);
                reasons.push(hint === undefined
                    ? `allowlist外の無視対象資産です: ${artifact}`
                    : `allowlist外の無視対象資産です: ${artifact}。${hint}`);
            }
        }
    }
    if (!Array.isArray(observation.stashes))
        reasons.push("stashがあるか状態が不明です");
    else if (observation.stashes.length > 0)
        reasons.push("stashがあります");
    /**
     * **upstream ref由来の理由は、既定branchからの到達を明示的に観測できたときだけ免除する。**
     *
     * 未push、push未実施、remote branch不在はいずれも「commitがremoteに在るか」の代理である。
     * HEADが既定branchから到達できると**観測できた**なら、その代理が不成立でもcommitは
     * remoteに存在する（Issue #1097）。
     *
     * **免除の根拠は`reachableFromDefaultBranch`が真であることだけに限る。** `undefined`は
     * 免除しない。REQ-LC-009が「観測が不正または不明な場合は他の観測から安全状態を推定せず
     * retainとする」と定めており、不明を免除に使うとその要件に反する。
     */
    const recoverableFromDefaultBranch = observation.reachableFromDefaultBranch === true;
    if (!recoverableFromDefaultBranch) {
        if (typeof observation.unpushedCommits === "number" &&
            observation.unpushedCommits > 0)
            reasons.push(`未pushのcommitが${observation.unpushedCommits}件あります`);
        else if (observation.pushed !== true)
            reasons.push("コミットがpushされていません");
        if (observation.remoteBranch !== true)
            reasons.push("リモートブランチがありません");
    }
    if (observation.merged !== true)
        reasons.push("対象PRがマージ済みではないか観測が不明です");
    if (observation.recoveryReachable !== true)
        reasons.push("commitが既定branchから到達できず、復旧手段がありません");
    if (observation.repositoryRoot !== undefined ||
        observation.worktreePath !== undefined) {
        if (typeof observation.repositoryRoot !== "string" ||
            typeof observation.worktreePath !== "string")
            reasons.push("対象worktreeの配置が不明です");
        else {
            const worktreeRoot = path.resolve(observation.repositoryRoot, observation.worktreeRoot ?? ".worktrees");
            const relative = path.relative(worktreeRoot, path.resolve(observation.worktreePath));
            if (relative === "" ||
                relative === ".." ||
                relative.startsWith(`..${path.sep}`) ||
                path.isAbsolute(relative) ||
                relative.split(path.sep).length !== 1)
                reasons.push("対象worktreeが.worktreesの直接の子ではありません");
        }
    }
    return {
        safe: reasons.length === 0,
        reasons: [...new Set(reasons)],
        allowedIgnoredArtifacts,
        blockingIgnoredArtifacts,
    };
}
//# sourceMappingURL=worktree-removal-safety.js.map