import fs from "node:fs";
import path from "node:path";
import { parseJsonStrict } from "../lib/security.js";
import { isRecord } from "../types.js";
export const DEFAULT_ISSUE_STAGING_ROOT = ".agent-skill-chain/tmp/issues";
export const DEFAULT_STAGING_LAYOUT = Object.freeze({
    rootPattern: DEFAULT_ISSUE_STAGING_ROOT,
    tracked: false,
    issueBody: "full",
});
/** 版管理下stagingで除外する機械記録。文書（00〜04のMarkdown）は追跡する。 */
export const TRACKED_STAGING_GITIGNORE = [
    "# agent-skill-chain: 機械記録は版管理しない（文書00〜04のMarkdownは追跡する）",
    "journal/",
    "staging-record.json",
    "review-session*.json",
    ".full-promotion-transaction.json",
    "00_モード判定.json",
    "verification-input.json",
    "",
].join("\n");
const SEGMENT = /^[A-Za-z0-9._\-\p{L}\p{N}]+$/u;
/** root patternの1 segmentとして許す形。`*`単独か、安全な通常文字のsegment。 */
function validSegment(segment) {
    if (segment === "*")
        return true;
    if (segment === "" || segment === "." || segment === "..")
        return false;
    if (segment === ".git")
        return false;
    return SEGMENT.test(segment) && segment === segment.normalize("NFC");
}
export function isValidStagingRootPattern(value) {
    if (typeof value !== "string" || value === "")
        return false;
    if (path.isAbsolute(value) || value.includes("\\"))
        return false;
    const segments = value.split("/");
    if (segments.length > 16)
        return false;
    if (!segments.every(validSegment))
        return false;
    // 最後のsegmentが`*`だと「stagingの親」が定まらない
    return segments[segments.length - 1] !== "*";
}
/**
 * project policyの`staging`節を検証する。errorsへ理由を積む。
 * 未知fieldと型違いを拒否し、既定値の解決はしない。
 */
export function validateStagingPolicy(value, name, errors) {
    if (!isRecord(value)) {
        errors.push(`${name}はobjectでなければなりません`);
        return;
    }
    for (const key of Object.keys(value))
        if (!["root", "tracked", "issueBody"].includes(key))
            errors.push(`${name}.${key}は未知fieldです`);
    if (value.root !== undefined && !isValidStagingRootPattern(value.root))
        errors.push(`${name}.rootは*を1 segmentだけに使える安全なrepository相対directoryでなければなりません`);
    if (value.tracked !== undefined && typeof value.tracked !== "boolean")
        errors.push(`${name}.trackedはbooleanでなければなりません`);
    if (value.issueBody !== undefined &&
        value.issueBody !== "full" &&
        value.issueBody !== "pointer")
        errors.push(`${name}.issueBodyはfullまたはpointerでなければなりません`);
    if (value.root === undefined && value.tracked === true)
        errors.push(`${name}.tracked=trueには版管理下のrootが必要です（既定rootは版管理外）`);
}
export function resolveStagingLayout(value) {
    const errors = [];
    if (value === undefined)
        return DEFAULT_STAGING_LAYOUT;
    validateStagingPolicy(value, "staging", errors);
    if (errors.length > 0)
        throw new Error(`project policyのstaging節が不正です: ${errors.join("; ")}`);
    const record = value;
    return Object.freeze({
        rootPattern: typeof record.root === "string"
            ? record.root
            : DEFAULT_ISSUE_STAGING_ROOT,
        tracked: record.tracked === true,
        issueBody: record.issueBody === "pointer" ? "pointer" : "full",
    });
}
/**
 * repository rootのproject policy manifestから配置契約を読む。manifestが無い、
 * または`staging`節が無いprojectは既定配置である。manifest全体の妥当性は
 * policy validateが所有し、ここでは`staging`節だけを読む。
 */
export function readStagingLayout(repositoryRoot) {
    const manifest = path.join(repositoryRoot, ".agent-skill-chain", "project-policy.json");
    if (!fs.existsSync(manifest))
        return DEFAULT_STAGING_LAYOUT;
    const parsed = parseJsonStrict(fs.readFileSync(manifest, "utf8"), "project policy manifest");
    if (!isRecord(parsed))
        return DEFAULT_STAGING_LAYOUT;
    // manifest形（policy.staging）と旧monolith形（staging）の両方を読む
    const policy = isRecord(parsed.policy) ? parsed.policy : parsed;
    return resolveStagingLayout(policy.staging);
}
/** repository相対の親directoryがroot patternに一致するか。`*`は1 segment。 */
export function matchesStagingRoot(pattern, relativeParent) {
    const expected = pattern.split("/");
    const actual = relativeParent.split("/");
    if (expected.length !== actual.length)
        return false;
    return expected.every((segment, index) => {
        const value = actual[index] ?? "";
        if (segment === "*")
            return validSegment(value);
        return segment === value;
    });
}
/**
 * root patternに一致する実在directoryを列挙する（`*`を展開）。symlinkは辿らない。
 */
export function listStagingRoots(repositoryRoot, pattern) {
    let current = [repositoryRoot];
    for (const segment of pattern.split("/")) {
        const next = [];
        for (const base of current) {
            if (segment === "*") {
                if (!fs.existsSync(base))
                    continue;
                for (const entry of fs.readdirSync(base, { withFileTypes: true }))
                    if (entry.isDirectory() && validSegment(entry.name))
                        next.push(path.join(base, entry.name));
            }
            else {
                const candidate = path.join(base, segment);
                if (fs.existsSync(candidate) &&
                    !fs.lstatSync(candidate).isSymbolicLink() &&
                    fs.lstatSync(candidate).isDirectory())
                    next.push(candidate);
            }
        }
        current = next;
    }
    return current.sort();
}
/**
 * git pathspecの除外指定。`:(exclude,glob)<pattern>/**`とし、`*`を1 segmentに限る。
 * 既定rootでも同じ形にする。
 */
export function stagingExcludePathspec(layout) {
    return `:(exclude,glob)${layout.rootPattern}/**`;
}
function isDefaultLayoutParent(resolvedStaging) {
    const parent = path.dirname(resolvedStaging);
    return (path.basename(parent) === "issues" &&
        path.basename(path.dirname(parent)) === "tmp" &&
        path.basename(path.dirname(path.dirname(parent))) === ".agent-skill-chain");
}
/**
 * staging pathからrepository rootを導く。
 *
 * 既定配置（`.agent-skill-chain/tmp/issues/<staging>`）は従来どおり4階層上を返す。
 * それ以外は祖先を上へ辿り、`.agent-skill-chain/project-policy.json`を持つ
 * 最初のdirectoryをrootとする。project policyを持たないprojectは既定配置しか
 * 使えないため、見つからなければ拒否する。
 */
export function stagingRepositoryRoot(staging) {
    const resolved = path.resolve(staging);
    if (isDefaultLayoutParent(resolved))
        return path.resolve(resolved, "../../../..");
    let current = path.dirname(resolved);
    while (true) {
        if (fs.existsSync(path.join(current, ".agent-skill-chain", "project-policy.json")))
            return current;
        const parent = path.dirname(current);
        if (parent === current)
            break;
        current = parent;
    }
    throw new Error(`--stagingは${DEFAULT_ISSUE_STAGING_ROOT}/直下のdirectoryが必要です（project policyのstaging.rootを宣言したrepositoryではその直下）`);
}
/**
 * stagingが「repository rootのproject policyが定めるstaging rootの直下」に
 * あることを確かめる。symlink・`..`・rootの外を拒否する。
 */
export function assertIssueStagingLocation(staging, repositoryRoot) {
    const resolved = path.resolve(staging);
    const root = repositoryRoot
        ? path.resolve(repositoryRoot)
        : stagingRepositoryRoot(resolved);
    const layout = readStagingLayout(root);
    const relative = path.relative(root, resolved).split(path.sep).join("/");
    const name = path.basename(resolved);
    const parent = path.dirname(relative);
    if (relative === "" ||
        relative.startsWith("..") ||
        path.isAbsolute(relative) ||
        name === "" ||
        name.includes("..") ||
        !matchesStagingRoot(layout.rootPattern, parent))
        throw new Error(`--stagingは対象rootの${layout.rootPattern}/直下のdirectoryが必要です`);
    return Object.freeze({
        staging: resolved,
        repositoryRoot: root,
        layout,
        relative,
    });
}
//# sourceMappingURL=staging-layout.js.map