import { git } from "../lib/process.js";
import { GIT_ENV } from "./review-diff.js";
import { resolveGitWorkspace } from "./review-workspace.js";
/** Verify linked worktree registration and clean state without inherited Git overrides. */
export function observeCandidateBoundary(root) {
    const workspace = resolveGitWorkspace(root);
    if (workspace.activeRoot === workspace.primaryRoot)
        throw new Error("candidateは主worktreeではなく専用Git worktreeが必要です");
    const headSha = git(["rev-parse", "HEAD"], root, {
        env: GIT_ENV,
    }).stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(headSha))
        throw new Error("candidate HEADが不正です");
    if (git(["status", "--porcelain", "-z"], root, { env: GIT_ENV }).stdout.length >
        0)
        throw new Error("candidate worktreeに未記録の変更があります");
    return { headSha };
}
/** Recompute the fork point without trusting the writable candidate session. */
export function observeCandidateForkBase(root, headSha) {
    const workspace = resolveGitWorkspace(root);
    if (workspace.activeRoot === workspace.primaryRoot)
        throw new Error("candidateは主worktreeではなく専用Git worktreeが必要です");
    const remote = git(["rev-parse", "--verify", "refs/remotes/origin/HEAD^{commit}"], root, { env: GIT_ENV, allowFailure: true });
    const anchorSha = remote.status === 0
        ? remote.stdout.trim()
        : git(["rev-parse", "HEAD"], workspace.primaryRoot, {
            env: GIT_ENV,
        }).stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(anchorSha))
        throw new Error("candidateのGit基準HEADが不正です");
    const forkBase = git(["merge-base", headSha, anchorSha], root, {
        env: GIT_ENV,
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
        env: GIT_ENV,
    }).stdout.trim();
    if (resolved !== baseSha)
        throw new Error("candidate baseをexact commitへ解決できません");
    git(["merge-base", "--is-ancestor", baseSha, headSha], root, {
        env: GIT_ENV,
    });
    const changedPaths = git(["diff", "--no-renames", "--name-only", "-z", baseSha, headSha], root, { env: GIT_ENV })
        .stdout.split("\0")
        .filter(Boolean);
    if (observeCandidateBoundary(root).headSha !== headSha ||
        observeCandidateForkBase(root, headSha) !== forkBase)
        throw new Error("candidate Git観測中にHEADが変更されました");
    return { baseSha, headSha, changedPaths };
}
//# sourceMappingURL=candidate-git.js.map