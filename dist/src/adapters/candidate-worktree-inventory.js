import fs from "node:fs";
import path from "node:path";
import { git } from "../lib/process.js";
import { parseWorktreeHeads } from "../domain/worktree-survey.js";
import { CANDIDATE_GIT_ENV } from "./candidate-git.js";
import { resolveGitWorkspace } from "./review-workspace.js";
const RESULT_PREFIX = ".asc-candidate-result-";
/** Read-only recovery inventory. It never prunes or removes Git metadata. */
export function inventoryCandidateWorktrees(rootInput) {
    const root = fs.realpathSync(rootInput);
    const primaryRoot = resolveGitWorkspace(root).primaryRoot;
    const parent = path.dirname(root);
    const observed = parseWorktreeHeads(git(["worktree", "list", "--porcelain"], root, {
        env: CANDIDATE_GIT_ENV,
    }).stdout);
    const relevant = observed.heads.filter((entry) => path.dirname(entry.path) === parent &&
        path.basename(entry.path).startsWith(RESULT_PREFIX));
    const registered = new Set(relevant.map((entry) => entry.path));
    const entries = [];
    for (const item of relevant) {
        if (!fs.existsSync(item.path)) {
            entries.push({
                path: item.path,
                headSha: item.headSha,
                state: "registered-missing",
                reason: "Git登録だけが残っています。自動pruneせず所有者が確認してください",
            });
            continue;
        }
        try {
            const stat = fs.lstatSync(item.path);
            if (!stat.isDirectory() ||
                stat.isSymbolicLink() ||
                fs.realpathSync(item.path) !== item.path ||
                item.headState !== "detached" ||
                resolveGitWorkspace(item.path).primaryRoot !== primaryRoot ||
                git(["rev-parse", "HEAD"], item.path, {
                    env: CANDIDATE_GIT_ENV,
                }).stdout.trim() !== item.headSha) {
                entries.push({
                    path: item.path,
                    headSha: item.headSha,
                    state: "registered-unknown",
                    reason: "結果worktreeの登録・HEAD・実pathが一致しません",
                });
                continue;
            }
            const status = git(["status", "--porcelain=v1", "--untracked-files=all", "--ignored"], item.path, { env: CANDIDATE_GIT_ENV }).stdout;
            entries.push({
                path: item.path,
                headSha: item.headSha,
                state: status === "" ? "registered-clean" : "registered-modified",
                reason: status === ""
                    ? "候補結果の所有者が独立レビュー・正式採用または明示破棄を決定します"
                    : "作業file・未追跡file・ignored fileを含む変更があるため保持します",
            });
        }
        catch (error) {
            entries.push({
                path: item.path,
                headSha: item.headSha,
                state: "registered-unknown",
                reason: `状態を確認できないため保持します: ${error instanceof Error ? error.message : String(error)}`,
            });
        }
    }
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
        if (!entry.name.startsWith(RESULT_PREFIX) ||
            registered.has(path.join(parent, entry.name)))
            continue;
        entries.push({
            path: path.join(parent, entry.name),
            headSha: null,
            state: entry.isDirectory()
                ? "unregistered-directory"
                : "unregistered-path",
            reason: "Git登録のない同名pathです。自動削除せず所有者が確認してください",
        });
    }
    return {
        authority: "observation-only",
        root,
        entries: entries.sort((left, right) => left.path.localeCompare(right.path)),
        errors: observed.errors,
    };
}
//# sourceMappingURL=candidate-worktree-inventory.js.map