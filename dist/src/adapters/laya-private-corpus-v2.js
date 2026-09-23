import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { createPrivateStructuralCase, validatePrivateStructuralCase, } from "../domain/laya-private-corpus-v2.js";
import { git } from "../lib/process.js";
import { parseJsonStrict } from "../lib/security.js";
import { readOwnerOnlyFile } from "./laya-private-authorization.js";
const SAFE_GIT_ENV = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    LANG: "C",
    LC_ALL: "C",
};
function nearestExisting(input) {
    let candidate = path.resolve(input);
    while (!fs.existsSync(candidate)) {
        const parent = path.dirname(candidate);
        if (parent === candidate)
            break;
        candidate = parent;
    }
    return candidate;
}
export function isInsideAnyGitWorktree(input) {
    const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: nearestExisting(input),
        encoding: "utf8",
        env: SAFE_GIT_ENV,
        stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error || result.status === null)
        throw new Error("Git worktree境界を検証できません");
    if (result.status === 0)
        return result.stdout.trim() !== "";
    if (result.status === 128 &&
        /not a git repository/u.test(result.stderr ?? ""))
        return false;
    throw new Error("Git worktree境界を検証できません");
}
export function writePrivateCorpusNoReplace(storePrefixInput, outputName, payload, onDirectoryPinned) {
    const storePrefix = path.resolve(storePrefixInput);
    const temporaryRoot = fs.realpathSync(os.tmpdir());
    if (path.dirname(storePrefix) !== temporaryRoot ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(path.basename(storePrefix)) ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/u.test(outputName) ||
        isInsideAnyGitWorktree(temporaryRoot))
        throw new Error("private corpus output指定が不正です");
    const runRoot = fs.mkdtempSync(`${storePrefix}-`);
    const directoryDescriptor = fs.openSync(runRoot, fs.constants.O_RDONLY |
        (fs.constants.O_DIRECTORY ?? 0) |
        (fs.constants.O_NOFOLLOW ?? 0));
    fs.fchmodSync(directoryDescriptor, 0o700);
    try {
        onDirectoryPinned?.(runRoot);
        const result = spawnSync("python3", [
            "-I",
            "-c",
            [
                "import os,sys",
                "flags=os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0)",
                "fd=os.open(sys.argv[1],flags,0o600,dir_fd=3)",
                "data=sys.stdin.buffer.read()",
                "offset=0",
                "while offset < len(data): offset += os.write(fd,data[offset:])",
                "os.fsync(fd)",
                "os.close(fd)",
            ].join("\n"),
            outputName,
        ], {
            input: payload,
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe", directoryDescriptor],
            env: { PATH: process.env.PATH ?? "" },
        });
        if (result.status !== 0 || result.error)
            throw new Error("private corpusのdescriptor相対writeに失敗しました");
    }
    finally {
        fs.closeSync(directoryDescriptor);
    }
    return path.basename(runRoot);
}
export function assertAuthorizedPrivateRepository(rootInput, authorizedRemote) {
    const root = fs.realpathSync(rootInput);
    const top = fs.realpathSync(git(["rev-parse", "--show-toplevel"], root, {
        env: SAFE_GIT_ENV,
    }).stdout.trim());
    if (root !== top)
        throw new Error("private sourceはGit repository rootが必要です");
    const remote = git(["remote", "get-url", "origin"], root, {
        env: SAFE_GIT_ENV,
    }).stdout.trim();
    if (remote !== authorizedRemote)
        throw new Error("owner許可済みprivate remote以外を拒否しました");
    return root;
}
export function assertExternalPrivateStore(repositoryRootInput, storeRootInput) {
    const repositoryRoot = fs.realpathSync(repositoryRootInput);
    const unresolved = path.resolve(storeRootInput);
    const beforeRelative = path.relative(repositoryRoot, unresolved);
    if (beforeRelative === "" ||
        (!beforeRelative.startsWith(`..${path.sep}`) && beforeRelative !== "..") ||
        isInsideAnyGitWorktree(unresolved))
        throw new Error("private corpus storeは全Git worktree外が必要です");
    fs.mkdirSync(unresolved, { recursive: true, mode: 0o700 });
    const storeRoot = fs.realpathSync(storeRootInput);
    const relative = path.relative(repositoryRoot, storeRoot);
    if (relative === "" ||
        (!relative.startsWith(`..${path.sep}`) && relative !== ".."))
        throw new Error("private corpus storeはGit repository外が必要です");
    if (isInsideAnyGitWorktree(storeRoot))
        throw new Error("private corpus storeは全Git worktree外が必要です");
    if ((fs.statSync(storeRoot).mode & 0o077) !== 0)
        throw new Error("private corpus storeは0700が必要です");
    return storeRoot;
}
export function assertExternalPrivateFile(repositoryRootInput, fileInput, maximumBytes) {
    const originalStat = fs.lstatSync(fileInput);
    if (originalStat.isSymbolicLink())
        throw new Error("private inputのsymbolic linkを拒否しました");
    const repositoryRoot = fs.realpathSync(repositoryRootInput);
    const file = fs.realpathSync(fileInput);
    if (file !== path.resolve(fileInput))
        throw new Error("private inputのsymlink祖先を拒否しました");
    const relative = path.relative(repositoryRoot, file);
    const stat = fs.lstatSync(file);
    if (relative === "" ||
        (!relative.startsWith(`..${path.sep}`) && relative !== "..") ||
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > maximumBytes ||
        (stat.mode & 0o077) !== 0 ||
        isInsideAnyGitWorktree(path.dirname(file)))
        throw new Error("private inputはrepository外かつownerだけが読める通常fileが必要です");
    return file;
}
export function createStructuralCasesFromJsonl(repositoryRootInput, revision, inputPath, policy, authorizedRemote, authorizedInputSha256) {
    if (!/^[0-9a-f]{40}$/u.test(revision))
        throw new Error("private revisionは完全SHAが必要です");
    const repositoryRoot = assertAuthorizedPrivateRepository(repositoryRootInput, authorizedRemote);
    const commit = git(["rev-parse", "--verify", `${revision}^{commit}`], repositoryRoot, { env: SAFE_GIT_ENV }).stdout.trim();
    if (commit !== revision)
        throw new Error("private revisionを完全SHAへ固定できません");
    const input = assertExternalPrivateFile(repositoryRoot, inputPath, 64 * 1024 * 1024);
    const inputBytes = readOwnerOnlyFile(input, 64 * 1024 * 1024);
    if (crypto.createHash("sha256").update(inputBytes).digest("hex") !==
        authorizedInputSha256)
        throw new Error("private corpus input digestがowner承認値と一致しません");
    const cases = inputBytes
        .toString("utf8")
        .split(/\r?\n/u)
        .filter((line) => line.trim() !== "")
        .map((line, index) => {
        const parsed = parseJsonStrict(line, `private corpus line ${index + 1}`);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error("private corpus rowはobjectが必要です");
        const candidate = parsed;
        if (candidate.sourceCommit !== commit)
            throw new Error("private corpus provenanceが固定snapshotと一致しません");
        return validatePrivateStructuralCase(createPrivateStructuralCase(candidate, policy));
    });
    return cases.sort((left, right) => left.caseId < right.caseId ? -1 : left.caseId > right.caseId ? 1 : 0);
}
//# sourceMappingURL=laya-private-corpus-v2.js.map