import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { run } from "../lib/process.js";
import { validateVerificationArgv } from "../domain/verification-run.js";
import { observeCandidateBoundary } from "./candidate-git.js";
import { CANDIDATE_RISKS, } from "../domain/candidate-workflow.js";
export function candidateAllowedPaths(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 256)
        throw new Error("candidate allowedPathsは事前に1〜256個のpathが必要です");
    const paths = value.map((item) => {
        if (typeof item !== "string" ||
            !item ||
            item.includes("\\") ||
            item.includes("\0") ||
            path.posix.isAbsolute(item) ||
            path.posix.normalize(item) !== item ||
            item.split("/").includes("..") ||
            item.split("/").includes(".") ||
            item.startsWith(".git/"))
            throw new Error("candidate allowedPathsに不正なpathがあります");
        return item;
    });
    if (new Set(paths).size !== paths.length)
        throw new Error("candidate allowedPathsに重複があります");
    return paths;
}
/** A local handoff receipt. It is never formal evidence or an approval. */
export function createCandidateSession(file, input) {
    const realRepo = fs.realpathSync(input.repo);
    const realParent = fs.realpathSync(path.dirname(file));
    if (realParent === realRepo ||
        realParent.startsWith(`${realRepo}${path.sep}`))
        throw new Error("candidate sessionは候補worktreeの外に保存してください");
    const session = {
        ...input,
        kind: "asc-candidate-session/v1",
        id: crypto.randomUUID(),
        repo: realRepo,
    };
    const fd = fs.openSync(file, fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW, 0o600);
    try {
        fs.writeFileSync(fd, `${JSON.stringify(session)}\n`);
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
    return session;
}
export function loadCandidateSession(file, repo) {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    let value;
    try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() ||
            stat.size > 64 * 1024 ||
            stat.size === 0 ||
            (stat.mode & 0o077) !== 0 ||
            (process.getuid !== undefined && stat.uid !== process.getuid()))
            throw new Error("candidate sessionは所有者だけが書ける通常fileが必要です");
        value = JSON.parse(fs.readFileSync(fd, "utf8"));
        const after = fs.fstatSync(fd);
        if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
            throw new Error("candidate sessionの読取境界が変更されました");
    }
    finally {
        fs.closeSync(fd);
    }
    if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new Error("candidate sessionが不正です");
    const session = value;
    if (session.kind !== "asc-candidate-session/v1" ||
        typeof session.id !== "string" ||
        typeof session.intent !== "string" ||
        !session.intent.trim() ||
        typeof session.correctnessCriterion !== "string" ||
        !session.correctnessCriterion.trim() ||
        typeof session.baseSha !== "string" ||
        !/^[0-9a-f]{40}$/.test(session.baseSha) ||
        session.repo !== fs.realpathSync(repo) ||
        typeof session.risk !== "object" ||
        session.risk === null)
        throw new Error("candidate sessionの契約またはworktreeが一致しません");
    candidateAllowedPaths(session.allowedPaths);
    if (CANDIDATE_RISKS.some((risk) => session.risk[risk] !== "cleared"))
        throw new Error("candidate sessionの事前リスク判定が一致しません");
    return session;
}
export function runCandidateTargetTest(repo, argv) {
    const command = validateVerificationArgv(argv, "candidate targetTest");
    const before = observeCandidateBoundary(repo).headSha;
    const result = run(command[0], [...command.slice(1)], repo, {
        allowFailure: true,
        timeoutMs: 10 * 60 * 1000,
        maxBufferBytes: 1024 * 1024,
    });
    const after = observeCandidateBoundary(repo).headSha;
    if (before !== after)
        throw new Error("candidate targetTestの実行中にHEADが変更されました");
    return {
        headSha: before,
        argv: command,
        exitCode: result.status,
        outputSha256: crypto
            .createHash("sha256")
            .update(result.stdout)
            .update("\0")
            .update(result.stderr)
            .digest("hex"),
        source: "cli-observed-target-test",
        formalEvidence: false,
    };
}
//# sourceMappingURL=candidate-session.js.map