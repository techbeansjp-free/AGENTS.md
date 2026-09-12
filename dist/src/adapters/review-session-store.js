import fs from "node:fs";
import path from "node:path";
import { parseJsonStrict } from "../lib/security.js";
import { deriveEffectiveHead, isEvidenceReanchorRecord, } from "../domain/evidence-reanchor.js";
import { parseReviewSessionState, } from "../domain/review-convergence.js";
import { git } from "../lib/process.js";
import { assertWorkflowStaging } from "./workflow-journal.js";
export const REVIEW_SESSION_FILE = "review-session.json";
const EVIDENCE_REANCHOR_FILE = "journal/reanchor.jsonl";
const GIT_ENV = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
};
/** 保存済みfollow-only recordをcaller申告ではなく実Gitから再検証する。 */
export function isDefaultBranchFollowMerge(root, previousHeadSha, candidateHeadSha) {
    const parents = git(["rev-list", "--parents", "-n", "1", `${candidateHeadSha}^{commit}`], root, { env: GIT_ENV, allowFailure: true });
    if (parents.status !== 0)
        return false;
    const [self, first, second, ...rest] = parents.stdout.trim().split(/\s+/u);
    if (self !== candidateHeadSha ||
        first === undefined ||
        second === undefined ||
        rest.length > 0 ||
        first !== previousHeadSha)
        return false;
    const defaultTip = git(["rev-parse", "--verify", "refs/remotes/origin/HEAD^{commit}"], root, { env: GIT_ENV, allowFailure: true });
    if (defaultTip.status !== 0)
        return false;
    if (git(["merge-base", "--is-ancestor", second, defaultTip.stdout.trim()], root, {
        env: GIT_ENV,
        allowFailure: true,
    }).status !== 0)
        return false;
    const automatic = git(["merge-tree", "--write-tree", first, second], root, {
        env: GIT_ENV,
        allowFailure: true,
    });
    const mergedTree = git(["rev-parse", "--verify", `${candidateHeadSha}^{tree}`], root, { env: GIT_ENV, allowFailure: true });
    return (automatic.status === 0 &&
        mergedTree.status === 0 &&
        automatic.stdout.trim().split("\n")[0] === mergedTree.stdout.trim() &&
        mergedTree.stdout.trim() !== "");
}
function assertRegularSessionFile(file) {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() ||
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.size > 2 * 1024 * 1024 ||
        fs.realpathSync(file) !== file)
        throw new Error("review sessionはsymlink・hardlinkでない2MiB以下の通常fileが必要です");
}
function readReanchorChain(staging) {
    const file = path.join(staging, EVIDENCE_REANCHOR_FILE);
    if (!fs.existsSync(file))
        return [];
    const records = [];
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        if (line.trim() === "")
            continue;
        const value = parseJsonStrict(line, "再固定記録");
        if (!isEvidenceReanchorRecord(value))
            throw new Error("再固定記録の形式が不正です");
        records.push(value);
    }
    return records;
}
export function readStoredReviewSession(stagingInput) {
    const staging = assertWorkflowStaging(stagingInput);
    const file = path.join(staging, REVIEW_SESSION_FILE);
    if (!fs.existsSync(file))
        return null;
    assertRegularSessionFile(file);
    const session = parseReviewSessionState(parseJsonStrict(fs.readFileSync(file, "utf8"), "review session"));
    const root = path.resolve(staging, "../../../..");
    const reanchorRecords = readReanchorChain(staging);
    for (const [index, record] of session.rounds.entries()) {
        if (!record.followOnly)
            continue;
        const previous = session.rounds[index - 1];
        if (previous === undefined ||
            !isDefaultBranchFollowMerge(root, deriveEffectiveHead({
                records: reanchorRecords,
                anchoredHeadSha: previous.candidateHeadSha,
            }).effectiveHeadSha, record.candidateHeadSha))
            throw new Error(`保存済みreview sessionのfollow-only round ${record.round}を実Gitで再検証できません`);
    }
    return session;
}
//# sourceMappingURL=review-session-store.js.map