import { isRecord } from "../types.js";
import { assessWorktreeRemovalSafety, resolveFinalizeIgnoredPathAllowlist, } from "./worktree-removal-safety.js";
const WORKTREE_DIRECTORY_IDENTITY = /(?:^|[\\/])\d{8}_\d{6}-(\d+)-([a-z0-9][a-z0-9-]*)$/u;
const WORKTREE_BRANCH_IDENTITY = /^[a-z][a-z0-9-]{0,31}\/(\d+)-([a-z0-9][a-z0-9-]*)$/u;
const OBSERVATION_FIELDS = new Set([
    "path",
    "repositoryRoot",
    "branch",
    "headState",
    "headSha",
    "isPrimary",
    "mergedIntoDefault",
    "dirty",
    "untracked",
    "ignoredArtifacts",
    "stashes",
    "unpushedCommits",
    "pushed",
    "remoteBranch",
    "recoveryReachable",
    "reachableFromDefaultBranch",
]);
function emptySurvey(errors = []) {
    return {
        entries: [],
        cleanupReady: [],
        retained: [],
        inProgress: [],
        errors,
    };
}
function validationErrors(value, index) {
    const located = isRecord(value) &&
        typeof value.path === "string" &&
        value.path.trim() !== ""
        ? `entry[${index}]（${value.path}）`
        : `entry[${index}]`;
    const prefix = located;
    if (!isRecord(value))
        return [`${prefix}はobjectでなければなりません`];
    const errors = [];
    const unknown = Object.keys(value).filter((field) => !OBSERVATION_FIELDS.has(field));
    if (unknown.length > 0)
        errors.push(`${prefix}に未知fieldがあります: ${unknown.join(", ")}`);
    if (typeof value.path !== "string" || value.path.trim() === "")
        errors.push(`${prefix}.pathは空でない文字列でなければなりません`);
    if (typeof value.repositoryRoot !== "string" ||
        value.repositoryRoot.trim() === "")
        errors.push(`${prefix}.repositoryRootは空でない文字列でなければなりません`);
    /**
     * **detached HEADは正当な観測である。** `headState`の明示値を根拠にし、attachedなら
     * 空でないbranch、detachedなら`null`を要求する。矛盾（attachedで空、detachedで
     * branchあり）と不明（headStateが列挙外）は不正観測として分離し、**pathを添えて**
     * 名指しする。raw添字だけでは対象を特定できない（Issue #1251）。
     */
    const headState = value.headState;
    if (headState !== "attached" && headState !== "detached")
        errors.push(`${prefix}.headStateはattachedまたはdetachedでなければなりません`);
    if (typeof value.headSha !== "string" ||
        !/^[0-9a-f]{40}$/u.test(value.headSha))
        errors.push(`${prefix}.headShaは40桁の小文字hexでなければなりません`);
    if (headState === "attached") {
        if (typeof value.branch !== "string" || value.branch.trim() === "")
            errors.push(`${prefix}.branchはattachedのとき空でない文字列でなければなりません`);
    }
    else if (headState === "detached" && value.branch !== null)
        errors.push(`${prefix}.branchはdetachedのときnullでなければなりません`);
    for (const field of [
        "isPrimary",
        "mergedIntoDefault",
        "dirty",
        "recoveryReachable",
        "pushed",
        "remoteBranch",
    ])
        if (typeof value[field] !== "boolean")
            errors.push(`${prefix}.${field}はbooleanでなければなりません`);
    if (!Array.isArray(value.untracked) ||
        value.untracked.some((item) => typeof item !== "string"))
        errors.push(`${prefix}.untrackedは文字列配列でなければなりません`);
    for (const field of ["ignoredArtifacts", "stashes"])
        if (!Array.isArray(value[field]) ||
            value[field].some((item) => typeof item !== "string"))
            errors.push(`${prefix}.${field}は文字列配列でなければなりません`);
    if (!Number.isInteger(value.unpushedCommits) ||
        Number(value.unpushedCommits) < 0)
        errors.push(`${prefix}.unpushedCommitsは0以上の整数でなければなりません`);
    /**
     * `reachableFromDefaultBranch`は省略可能だが、与えるならbooleanでなければならない。
     * **不正値をundefinedとして扱わない。** 免除の根拠になるfieldであり、
     * 不明を免除へ倒すとREQ-LC-009のfail-closedに反する（Issue #1097）。
     */
    if (value.reachableFromDefaultBranch !== undefined &&
        typeof value.reachableFromDefaultBranch !== "boolean")
        errors.push(`${prefix}.reachableFromDefaultBranchはbooleanでなければなりません`);
    return errors;
}
function classify(observation, ignoredPathAllowlist) {
    if (observation.isPrimary)
        return {
            path: observation.path,
            branch: observation.branch,
            headState: observation.headState,
            disposition: "primary",
            reasons: ["repository root自身は後片付け対象ではありません"],
        };
    const assessment = assessWorktreeRemovalSafety({
        repositoryRoot: observation.repositoryRoot,
        worktreePath: observation.path,
        trackedChanges: observation.dirty,
        untracked: observation.untracked,
        ignoredArtifacts: observation.ignoredArtifacts,
        ignoredPathAllowlist,
        stashes: observation.stashes,
        pushed: observation.pushed,
        remoteBranch: observation.remoteBranch,
        merged: observation.mergedIntoDefault,
        recoveryReachable: observation.recoveryReachable,
        reachableFromDefaultBranch: observation.reachableFromDefaultBranch,
        unpushedCommits: observation.unpushedCommits,
    });
    /**
     * detachedは分類を自動でretainへ変える理由ではなく、**現行finalizeが対象branchを
     * 要求する**事実を理由として加える。REQ-LC-010の「不一致は`reasons`へ報告するが分類を
     * 変えない」先例と同じ形にし、理由が残る限りcleanup-readyへは進まない（Issue #1251）。
     */
    const reasons = [
        ...assessment.reasons,
        ...(observation.headState === "detached"
            ? [
                "HEADがdetachedです。現行のfinalizeは対象branchを要求するため、この経路では後片付けできません",
            ]
            : []),
    ];
    if (!observation.mergedIntoDefault)
        return {
            path: observation.path,
            branch: observation.branch,
            headState: observation.headState,
            disposition: "in-progress",
            reasons,
        };
    return reasons.length > 0
        ? {
            path: observation.path,
            branch: observation.branch,
            headState: observation.headState,
            disposition: "retain",
            reasons,
        }
        : {
            path: observation.path,
            branch: observation.branch,
            headState: observation.headState,
            disposition: "cleanup-ready",
            reasons: [
                "既定branchへmerge済みで、finalize共通の保持条件がありません",
            ],
        };
}
function namingMismatchReasons(observation) {
    if (observation.branch === null)
        return [];
    const directory = WORKTREE_DIRECTORY_IDENTITY.exec(observation.path);
    const branch = WORKTREE_BRANCH_IDENTITY.exec(observation.branch);
    if (!directory || !branch)
        return [];
    const reasons = [];
    if (directory[1] !== branch[1])
        reasons.push(`worktree directory名とbranch名のIssue番号が一致しません（directory: ${directory[1]}、branch: ${branch[1]}）`);
    if (directory[2] !== branch[2])
        reasons.push(`worktree directory名とbranch名のslugが一致しません（directory: ${directory[2]}、branch: ${branch[2]}）`);
    return reasons;
}
export function surveyWorktrees(value, ignoredPathAllowlist = resolveFinalizeIgnoredPathAllowlist()) {
    if (!Array.isArray(value))
        return emptySurvey(["worktree観測は配列でなければなりません"]);
    const result = emptySurvey();
    const candidates = [];
    for (const [index, entry] of value.entries()) {
        const errors = validationErrors(entry, index);
        if (errors.length > 0) {
            result.errors.push(...errors);
            continue;
        }
        candidates.push({ index, observation: entry });
    }
    const pathCounts = new Map();
    for (const { observation } of candidates)
        pathCounts.set(observation.path, (pathCounts.get(observation.path) ?? 0) + 1);
    const duplicatePaths = new Set([...pathCounts]
        .filter(([, count]) => count > 1)
        .map(([entryPath]) => entryPath));
    for (const duplicatePath of duplicatePaths)
        result.errors.push(`worktree pathが重複しています: ${duplicatePath}`);
    for (const { observation } of candidates) {
        if (duplicatePaths.has(observation.path))
            continue;
        const entry = classify(observation, ignoredPathAllowlist);
        entry.reasons.push(...namingMismatchReasons(observation));
        result.entries.push(entry);
        if (entry.disposition === "cleanup-ready")
            result.cleanupReady.push(entry.path);
        else if (entry.disposition === "retain")
            result.retained.push(entry.path);
        else if (entry.disposition === "in-progress")
            result.inProgress.push(entry.path);
    }
    return result;
}
//# sourceMappingURL=worktree-survey.js.map