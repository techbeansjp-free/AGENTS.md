import fs from "node:fs";
import path from "node:path";
import { git } from "../lib/process.js";
import { GIT_ENV } from "./review-diff.js";
import { resolveGitWorkspace } from "./review-workspace.js";
/** Candidate Git observations must never run repository hooks or fsmonitor. */
export const CANDIDATE_GIT_ENV = {
    ...GIT_ENV,
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "3",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/dev/null",
    GIT_CONFIG_KEY_1: "core.fsmonitor",
    GIT_CONFIG_VALUE_1: "false",
    GIT_CONFIG_KEY_2: "core.attributesFile",
    GIT_CONFIG_VALUE_2: "/dev/null",
};
/** Catch obvious access-control removal even when the changed file name is neutral. */
export function observeRemovedAccessGuard(root, baseSha, headSha) {
    const patch = git([
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--unified=0",
        baseSha,
        headSha,
        "--",
    ], root, { env: CANDIDATE_GIT_ENV, maxBufferBytes: 8 * 1024 * 1024 }).stdout;
    return patch
        .split("\n")
        .some((line) => line.startsWith("-") &&
        !line.startsWith("---") &&
        /\b(?:auth\w*|permission\w*|acl\w*|canAccess|isAdmin|hasRole)\b/iu.test(line.slice(1)));
}
/** Reject executable clean filters before any worktree status/diff can invoke them. */
export function assertNoCandidateFilters(root) {
    const paths = git(["ls-files", "-z"], root, {
        env: CANDIDATE_GIT_ENV,
    })
        .stdout.split("\0")
        .filter(Boolean);
    const indexFlags = git(["ls-files", "-v", "-z"], root, {
        env: CANDIDATE_GIT_ENV,
    })
        .stdout.split("\0")
        .filter(Boolean);
    if (indexFlags.some((entry) => !entry.startsWith("H ")))
        throw new Error("candidate indexにassume-unchanged・skip-worktree等の隠蔽flagがあります");
    // Git may fall back to index attributes and checkout reads committed
    // attributes. Reject every tracked attribute file, including assume-unchanged
    // entries, before status or worktree add can execute a configured filter.
    const committed = git(["ls-tree", "-r", "--name-only", "-z", "HEAD"], root, {
        env: CANDIDATE_GIT_ENV,
    })
        .stdout.split("\0")
        .filter(Boolean);
    if ([...paths, ...committed].some((item) => item === ".gitattributes" || item.endsWith("/.gitattributes")))
        throw new Error("candidateはGit属性fileを含むrepositoryで実行できません");
    const attributes = new Set();
    for (const relative of paths) {
        let directory = path.posix.dirname(relative);
        while (true) {
            attributes.add(path.join(root, directory === "." ? "" : directory, ".gitattributes"));
            if (directory === ".")
                break;
            directory = path.posix.dirname(directory);
        }
    }
    const infoPath = git(["rev-parse", "--git-path", "info/attributes"], root, {
        env: CANDIDATE_GIT_ENV,
    }).stdout.trim();
    attributes.add(path.isAbsolute(infoPath) ? infoPath : path.resolve(root, infoPath));
    for (const file of attributes) {
        if (!fs.existsSync(file))
            continue;
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.size > 1024 * 1024)
            throw new Error("candidate Git属性fileの形式またはsizeが不正です");
        if (/\bfilter\b/u.test(fs.readFileSync(file, "utf8")))
            throw new Error("candidate Git clean filter属性を含むrepositoryは実行できません");
    }
}
/** Verify linked worktree registration and clean state without inherited Git overrides. */
export function observeCandidateBoundary(root) {
    const workspace = resolveGitWorkspace(root);
    if (workspace.activeRoot === workspace.primaryRoot)
        throw new Error("candidateは主worktreeではなく専用Git worktreeが必要です");
    assertNoCandidateFilters(root);
    const headSha = git(["rev-parse", "HEAD"], root, {
        env: CANDIDATE_GIT_ENV,
    }).stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(headSha))
        throw new Error("candidate HEADが不正です");
    if (git(["status", "--porcelain", "-z"], root, { env: CANDIDATE_GIT_ENV })
        .stdout.length > 0)
        throw new Error("candidate worktreeに未記録の変更があります");
    return { headSha };
}
/** Recompute the fork point without trusting the writable candidate session. */
export function observeCandidateForkBase(root, headSha) {
    const workspace = resolveGitWorkspace(root);
    if (workspace.activeRoot === workspace.primaryRoot)
        throw new Error("candidateは主worktreeではなく専用Git worktreeが必要です");
    const remote = git(["rev-parse", "--verify", "refs/remotes/origin/HEAD^{commit}"], root, { env: CANDIDATE_GIT_ENV, allowFailure: true });
    const anchorSha = remote.status === 0
        ? remote.stdout.trim()
        : git(["rev-parse", "HEAD"], workspace.primaryRoot, {
            env: CANDIDATE_GIT_ENV,
        }).stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(anchorSha))
        throw new Error("candidateのGit基準HEADが不正です");
    const forkBase = git(["merge-base", headSha, anchorSha], root, {
        env: CANDIDATE_GIT_ENV,
    }).stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(forkBase))
        throw new Error("candidateのGit分岐点が不正です");
    return forkBase;
}
/** Inspect a committed candidate. Dirty state, diverged base and changed HEAD stop assessment. */
export function observeCandidateGit(root, baseSha) {
    if (!/^[0-9a-f]{40}$/.test(baseSha))
        throw new Error("candidate base SHAが不正です");
    const { headSha } = observeCandidateBoundary(root);
    const forkBase = observeCandidateForkBase(root, headSha);
    if (baseSha !== forkBase)
        throw new Error("candidate sessionのbaseがGit分岐点と一致しません");
    const resolved = git(["rev-parse", "--verify", `${baseSha}^{commit}`], root, {
        env: CANDIDATE_GIT_ENV,
    }).stdout.trim();
    if (resolved !== baseSha)
        throw new Error("candidate baseをexact commitへ解決できません");
    git(["merge-base", "--is-ancestor", baseSha, headSha], root, {
        env: CANDIDATE_GIT_ENV,
    });
    const changedPaths = git(["diff", "--no-renames", "--name-only", "-z", baseSha, headSha], root, { env: CANDIDATE_GIT_ENV })
        .stdout.split("\0")
        .filter(Boolean);
    if (observeCandidateBoundary(root).headSha !== headSha ||
        observeCandidateForkBase(root, headSha) !== forkBase)
        throw new Error("candidate Git観測中にHEADが変更されました");
    return { baseSha, headSha, changedPaths };
}
//# sourceMappingURL=candidate-git.js.map