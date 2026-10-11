import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { git } from "../lib/process.js";
import { validateVerificationArgv } from "../domain/verification-run.js";
import { CANDIDATE_RISKS, decideCandidatePost, decideCandidatePreflight, } from "../domain/candidate-workflow.js";
import { CANDIDATE_GIT_ENV, assertNoCandidateFilters, observeCandidateBoundary, observeCandidateForkBase, observeCandidateGit, } from "./candidate-git.js";
import { candidateAllowedPaths } from "./candidate-session.js";
import { makeDirectoriesRemovable, runCandidateWorkerBoundary, } from "./candidate-worker-boundary.js";
function assertNoIgnoredWorkerInputs(root, allowedPaths) {
    const directories = [
        ...new Set(allowedPaths.map((item) => path.posix.dirname(item))),
    ];
    const ignored = git([
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "-z",
        "--",
        ...directories,
    ], root, { env: CANDIDATE_GIT_ENV })
        .stdout.split("\0")
        .filter(Boolean);
    if (ignored.length > 0)
        throw new Error(`candidate Workerの書込領域にGit ignored fileがあります: ${ignored.join(", ")}`);
}
function uncommittedPaths(root) {
    const commands = [
        ["diff", "--name-only", "-z", "--no-renames", "--"],
        ["diff", "--cached", "--name-only", "-z", "--no-renames", "--"],
        ["ls-files", "--others", "--exclude-standard", "-z", "--"],
    ];
    return [
        ...new Set(commands.flatMap((argv) => git(argv, root, { env: CANDIDATE_GIT_ENV })
            .stdout.split("\0")
            .filter(Boolean))),
    ].sort();
}
function gitWorktreePath(root, name) {
    const value = git(["rev-parse", "--git-path", name], root, {
        env: CANDIDATE_GIT_ENV,
    }).stdout.trim();
    return path.isAbsolute(value) ? value : path.resolve(root, value);
}
/** Publish only while Git's ordinary index and symbolic HEAD are locked and unchanged. */
function publishCandidateCommit(input) {
    const indexLock = `${input.indexFile}.lock`;
    let indexFd;
    try {
        indexFd = fs.openSync(indexLock, "wx", 0o600);
        const currentIndex = fs.readFileSync(input.indexFile);
        if (crypto.createHash("sha256").update(currentIndex).digest("hex") !==
            input.indexDigest ||
            !fs.readFileSync(input.headFile).equals(input.headBytes) ||
            git(["rev-parse", "HEAD"], input.root, {
                env: CANDIDATE_GIT_ENV,
            }).stdout.trim() !== input.baseSha)
            throw new Error("candidate publication前にHEADまたはindexが変更されました");
        fs.writeFileSync(indexFd, fs.readFileSync(input.privateIndex));
        fs.fsyncSync(indexFd);
        // Update only this linked worktree's HEAD. --no-deref detaches it and
        // cannot publish to a different branch after a symbolic-ref race.
        git([
            "-c",
            "core.hooksPath=/dev/null",
            "update-ref",
            "--no-deref",
            "HEAD",
            input.commitSha,
            input.baseSha,
        ], input.root, { env: CANDIDATE_GIT_ENV });
        if (git(["rev-parse", "HEAD"], input.root, {
            env: CANDIDATE_GIT_ENV,
        }).stdout.trim() !== input.commitSha ||
            git(["symbolic-ref", "--quiet", "HEAD"], input.root, {
                env: CANDIDATE_GIT_ENV,
                allowFailure: true,
            }).status === 0)
            throw new Error("candidate publication中にHEADが変更されました");
        fs.renameSync(indexLock, input.indexFile);
    }
    finally {
        if (indexFd !== undefined)
            fs.closeSync(indexFd);
        if (indexFd !== undefined)
            fs.rmSync(indexLock, { force: true });
    }
}
function readCandidateFile(file, relative, remainingBytes) {
    let fd;
    try {
        fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    }
    catch (error) {
        if (error.code === "ENOENT")
            return null;
        throw error;
    }
    try {
        const before = fs.fstatSync(fd);
        if (!before.isFile() ||
            before.nlink !== 1 ||
            before.size > Math.min(16 * 1024 * 1024, remainingBytes))
            throw new Error(`candidate import対象が通常fileではないかsize上限を超えます: ${relative}`);
        const bytes = Buffer.alloc(before.size);
        let readBytes = 0;
        while (readBytes < bytes.length) {
            const count = fs.readSync(fd, bytes, readBytes, bytes.length - readBytes, null);
            if (count === 0)
                break;
            readBytes += count;
        }
        const extra = Buffer.alloc(1);
        const extraBytes = fs.readSync(fd, extra, 0, 1, null);
        const after = fs.fstatSync(fd);
        if (readBytes !== before.size ||
            extraBytes !== 0 ||
            after.size !== before.size ||
            after.mtimeMs !== before.mtimeMs ||
            after.ctimeMs !== before.ctimeMs)
            throw new Error(`candidate import対象が読取中に変更されました: ${relative}`);
        return { bytes, mode: before.mode & 0o777 };
    }
    finally {
        fs.closeSync(fd);
    }
}
function installCandidateFile(root, relative, file) {
    const destination = path.join(root, relative);
    const parent = path.dirname(destination);
    if (fs.realpathSync(parent) !== parent)
        throw new Error(`candidate import先にsymlink祖先があります: ${relative}`);
    if (file === null) {
        fs.rmSync(destination, { force: true });
        return;
    }
    const temporary = path.join(parent, `.asc-import-${crypto.randomUUID()}`);
    try {
        fs.writeFileSync(temporary, file.bytes, { flag: "wx", mode: file.mode });
        fs.renameSync(temporary, destination);
    }
    finally {
        fs.rmSync(temporary, { force: true });
    }
}
/** Preflight, isolated Worker and Git observation share one trusted Coordinator invocation. */
export function executeCandidate(input) {
    const root = fs.realpathSync(input.root);
    const baseSha = observeCandidateBoundary(root).headSha;
    const headFile = gitWorktreePath(root, "HEAD");
    const headBytes = fs.readFileSync(headFile);
    const indexFile = gitWorktreePath(root, "index");
    const indexDigest = crypto
        .createHash("sha256")
        .update(fs.readFileSync(indexFile))
        .digest("hex");
    const allowedPaths = candidateAllowedPaths(input.allowedPaths);
    if (observeCandidateForkBase(root, baseSha) !== baseSha)
        throw new Error("candidate事前HEADがGit分岐点と一致しません");
    const preflight = decideCandidatePreflight({
        intent: input.intent,
        correctnessCriterion: input.correctnessCriterion,
        baseSha,
        isolatedWorktree: true,
        risk: input.risk,
        unresolved: input.unresolved,
    });
    if (preflight.route !== "candidate")
        return { ...preflight, baseSha };
    // Reject malformed verification before the Worker can mutate its disposable worktree.
    const command = validateVerificationArgv(input.targetTest, "candidate targetTest");
    if (Object.keys(input.risk).some((key) => !CANDIDATE_RISKS.includes(key)))
        throw new Error("未知のcandidateリスク項目があります");
    assertNoIgnoredWorkerInputs(root, allowedPaths);
    // The Worker can write an allowed parent directory. Run it in a separate
    // throwaway worktree and import only the validated allowed files.
    const workerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "asc-candidate-copy-"));
    let workerRegistered = false;
    let workerBoundary;
    let changedPaths = [];
    let workerFailure;
    try {
        git(["worktree", "add", "--detach", "--", workerRoot, baseSha], root, {
            env: CANDIDATE_GIT_ENV,
        });
        workerRegistered = true;
        assertNoIgnoredWorkerInputs(workerRoot, allowedPaths);
        const worker = runCandidateWorkerBoundary({
            root: workerRoot,
            allowedPaths,
            argv: input.workerArgv,
        });
        workerBoundary = worker.boundary;
        if (worker.status !== 0)
            throw new Error(`candidate Workerが失敗しました（終了値${worker.status}）: ${worker.stderr.slice(0, 500)}`);
        assertNoCandidateFilters(workerRoot);
        assertNoIgnoredWorkerInputs(workerRoot, allowedPaths);
        if (git(["rev-parse", "HEAD"], workerRoot, {
            env: CANDIDATE_GIT_ENV,
        }).stdout.trim() !== baseSha)
            throw new Error("candidate Workerが事前HEADを変更しました");
        changedPaths = uncommittedPaths(workerRoot);
        if (changedPaths.length === 0)
            throw new Error("candidate Workerが候補差分を作成しませんでした");
        const unexpected = changedPaths.filter((item) => !allowedPaths.includes(item));
        if (unexpected.length > 0)
            throw new Error(`candidate Workerが許可範囲外を変更しました: ${unexpected.join(", ")}`);
        for (const relative of changedPaths) {
            const source = path.join(workerRoot, relative);
            let stat;
            try {
                stat = fs.lstatSync(source);
            }
            catch (error) {
                if (error.code === "ENOENT")
                    continue;
                throw error;
            }
            if (!stat.isFile() || stat.nlink !== 1)
                throw new Error(`candidate Workerの差分は通常fileが必要です: ${relative}`);
        }
        let remainingBytes = 64 * 1024 * 1024;
        const imports = changedPaths.map((relative) => {
            const file = readCandidateFile(path.join(workerRoot, relative), relative, remainingBytes);
            remainingBytes -= file?.bytes.length ?? 0;
            const original = readCandidateFile(path.join(root, relative), relative, remainingBytes);
            remainingBytes -= original?.bytes.length ?? 0;
            return { relative, file, original };
        });
        if (observeCandidateBoundary(root).headSha !== baseSha)
            throw new Error("candidate import前に元worktreeが変更されました");
        const applied = [];
        try {
            for (const item of imports) {
                installCandidateFile(root, item.relative, item.file);
                applied.push(item);
            }
        }
        catch (error) {
            const rollbackErrors = [];
            for (const item of applied.reverse()) {
                try {
                    installCandidateFile(root, item.relative, item.original);
                }
                catch (rollbackError) {
                    rollbackErrors.push(rollbackError);
                }
            }
            if (rollbackErrors.length > 0)
                throw new AggregateError([error, ...rollbackErrors], "candidate importとrollbackが失敗しました", { cause: error });
            throw error;
        }
    }
    catch (error) {
        workerFailure = error;
    }
    const cleanupErrors = [];
    if (workerRegistered) {
        try {
            git(["worktree", "remove", "--force", "--", workerRoot], root, {
                env: CANDIDATE_GIT_ENV,
            });
        }
        catch (first) {
            try {
                // Git may already have removed registration before deletion fails.
                // Remove the owned temp directory, then verify both artifacts are gone.
                makeDirectoriesRemovable(workerRoot);
                fs.rmSync(workerRoot, { recursive: true, force: true });
                const registered = git(["worktree", "list", "--porcelain"], root, {
                    env: CANDIDATE_GIT_ENV,
                })
                    .stdout.split("\n")
                    .some((line) => line === `worktree ${workerRoot}`);
                if (registered)
                    throw new Error("candidate一時worktreeのGit登録が残っています", {
                        cause: first,
                    });
            }
            catch (second) {
                cleanupErrors.push(first, second);
            }
        }
    }
    try {
        fs.rmSync(workerRoot, { recursive: true, force: true });
    }
    catch (error) {
        cleanupErrors.push(error);
    }
    if (workerFailure !== undefined && cleanupErrors.length > 0)
        throw new AggregateError([workerFailure, ...cleanupErrors], `candidate Workerとcleanupが失敗しました: ${cleanupErrors.map(String).join("; ").slice(0, 800)}`);
    if (workerFailure !== undefined)
        throw workerFailure;
    if (cleanupErrors.length > 0)
        throw new AggregateError(cleanupErrors, `candidate一時worktreeのcleanupが失敗しました: ${cleanupErrors.map(String).join("; ").slice(0, 800)}`);
    if (workerBoundary === undefined)
        throw new Error("candidate Worker境界を観測できません");
    assertNoCandidateFilters(root);
    const currentSha = git(["rev-parse", "HEAD"], root, {
        env: CANDIDATE_GIT_ENV,
    }).stdout.trim();
    if (currentSha !== baseSha)
        throw new Error("candidate import中にHEADが変更されました");
    if (uncommittedPaths(root).join("\0") !== changedPaths.join("\0"))
        throw new Error("candidate importと許可差分が一致しません");
    // A private index keeps staging failures out of the caller's index. commit-tree
    // never executes repository hooks, and update-ref compares the exact preflight
    // HEAD so a concurrent move cannot be silently committed over.
    const indexDir = fs.mkdtempSync(path.join(os.tmpdir(), "asc-candidate-index-"));
    const indexEnv = {
        ...CANDIDATE_GIT_ENV,
        GIT_INDEX_FILE: path.join(indexDir, "index"),
    };
    let publishedCommitSha;
    try {
        git(["-c", "core.hooksPath=/dev/null", "read-tree", baseSha], root, {
            env: indexEnv,
        });
        const stagedBlobs = new Map();
        // Bypass repository-defined clean filters and Git hooks. Only the observed
        // regular-file bytes enter this private index.
        for (const relative of changedPaths) {
            const absolute = path.join(root, relative);
            let stat;
            try {
                stat = fs.lstatSync(absolute);
            }
            catch (error) {
                if (error.code === "ENOENT") {
                    git([
                        "-c",
                        "core.hooksPath=/dev/null",
                        "update-index",
                        "--force-remove",
                        "--",
                        relative,
                    ], root, {
                        env: indexEnv,
                    });
                    stagedBlobs.set(relative, null);
                    continue;
                }
                throw error;
            }
            if (!stat.isFile() || stat.nlink !== 1)
                throw new Error(`candidate staging対象が通常fileではありません: ${relative}`);
            const blobSha = git(["hash-object", "-w", "--no-filters", "--", relative], root, {
                env: indexEnv,
            }).stdout.trim();
            if (!/^[0-9a-f]{40}$/.test(blobSha))
                throw new Error(`candidate blob SHAが不正です: ${relative}`);
            git([
                "-c",
                "core.hooksPath=/dev/null",
                "update-index",
                "--add",
                "--cacheinfo",
                stat.mode & 0o111 ? "100755" : "100644",
                blobSha,
                relative,
            ], root, { env: indexEnv });
            stagedBlobs.set(relative, { sha: blobSha, mode: stat.mode & 0o111 });
        }
        const stagedPaths = git(["diff", "--cached", "--name-only", "-z", "--no-renames", "--"], root, { env: indexEnv })
            .stdout.split("\0")
            .filter(Boolean)
            .sort();
        if (stagedPaths.join("\0") !== changedPaths.join("\0"))
            throw new Error("candidate staging中に差分が変更されました。隔離worktreeを破棄してください");
        const stagedEntries = git(["ls-files", "--stage", "-z", "--", ...allowedPaths], root, { env: indexEnv })
            .stdout.split("\0")
            .filter(Boolean);
        if (stagedEntries.some((entry) => !/^100(?:644|755) [0-9a-f]{40} 0\t/u.test(entry)))
            throw new Error("candidate stagingに通常file以外があります。隔離worktreeを破棄してください");
        for (const relative of changedPaths) {
            const absolute = path.join(root, relative);
            const staged = stagedBlobs.get(relative);
            let stat;
            try {
                stat = fs.lstatSync(absolute);
            }
            catch (error) {
                if (error.code === "ENOENT" &&
                    staged === null)
                    continue;
                throw new Error(`candidate staging後に作業fileが変更されました: ${relative}`, { cause: error });
            }
            if (!staged ||
                !stat.isFile() ||
                stat.nlink !== 1 ||
                (stat.mode & 0o111) !== staged.mode ||
                git(["hash-object", "--no-filters", "--", relative], root, {
                    env: indexEnv,
                }).stdout.trim() !== staged.sha)
                throw new Error(`candidate staging後に作業fileが変更されました: ${relative}`);
        }
        const treeSha = git(["write-tree"], root, { env: indexEnv }).stdout.trim();
        if (git(["rev-parse", "HEAD"], root, {
            env: CANDIDATE_GIT_ENV,
        }).stdout.trim() !== baseSha)
            throw new Error("candidate commit前にHEADが移動しました。隔離worktreeを破棄してください");
        const commitEnv = {
            ...CANDIDATE_GIT_ENV,
            GIT_AUTHOR_NAME: "ASC Candidate",
            GIT_AUTHOR_EMAIL: "candidate@localhost.invalid",
            GIT_COMMITTER_NAME: "ASC Candidate",
            GIT_COMMITTER_EMAIL: "candidate@localhost.invalid",
        };
        const commitSha = git([
            "commit-tree",
            treeSha,
            "-p",
            baseSha,
            "-m",
            "asc: isolated candidate implementation",
        ], root, { env: commitEnv }).stdout.trim();
        if (!/^[0-9a-f]{40}$/.test(commitSha))
            throw new Error("candidate commit objectが不正です");
        publishCandidateCommit({
            root,
            baseSha,
            commitSha,
            headFile,
            headBytes,
            indexFile,
            indexDigest,
            privateIndex: indexEnv.GIT_INDEX_FILE,
        });
        publishedCommitSha = commitSha;
    }
    finally {
        fs.rmSync(indexDir, { recursive: true, force: true });
    }
    const observed = observeCandidateGit(root, baseSha);
    if (observed.headSha !== publishedCommitSha)
        throw new Error("candidate publication後にHEADが変更されました");
    if (observed.changedPaths.join("\0") !== changedPaths.join("\0"))
        throw new Error("candidate Workerの差分とcommitが一致しません");
    const testResult = runCandidateWorkerBoundary({
        root,
        allowedPaths: [],
        argv: command,
    });
    const afterTest = observeCandidateBoundary(root).headSha;
    if (afterTest !== publishedCommitSha)
        throw new Error("candidate差分と対象テストのHEADが一致しません");
    const targetTest = {
        headSha: afterTest,
        argv: command,
        exitCode: testResult.status,
        outputSha256: crypto
            .createHash("sha256")
            .update(testResult.stdout)
            .update("\0")
            .update(testResult.stderr)
            .digest("hex"),
        source: "cli-observed-isolated-target-test",
        formalEvidence: false,
    };
    const decision = decideCandidatePost({
        observedPaths: observed.changedPaths,
        allowedPaths,
        targetTestsPassed: targetTest.exitCode === 0,
        gaps: input.gaps,
    });
    return {
        ...decision,
        ...observed,
        intent: input.intent,
        correctnessCriterion: input.correctnessCriterion,
        allowedPaths,
        targetTest,
        workerBoundary,
        formalWorkflowUnchanged: true,
        independentReviewRequired: true,
        riskAssessmentSource: "caller-asserted",
    };
}
//# sourceMappingURL=candidate-execution.js.map