import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "../lib/atomic.js";
import { git } from "../lib/process.js";
import { stableJson } from "../lib/security.js";
import { calculateStagingDigest, listStagingArtifacts, readStoredStagingRecord, refreshStoredStagingDigest, withStagingMutationLock, } from "../domain/staging.js";
import { readStagingLayout, stagingExcludePathspec, stagingRepositoryRoot, } from "../domain/staging-layout.js";
import { missingTargetedFeatures, parseVerificationRuns, renderVerificationRuns, sealVerificationRun, validateVerificationArgv, VERIFICATION_RUN_FILE, VERIFICATION_RUN_SCHEMA_VERSION, } from "../domain/verification-run.js";
import { computeImpactSet } from "./impact-set.js";
import { GIT_ENV } from "./review-diff.js";
import { readStoredReviewSession } from "./review-session-store.js";
import { assertWorkflowStaging } from "./workflow-journal.js";
/** 記録fileの上限。超えたら読まずに拒否する（fail closed）。 */
const MAX_RECORD_FILE_BYTES = 8 * 1024 * 1024;
/**
 * stagingの検証記録を厳密に読む。**fileが無ければ空である。** symlink・hardlink・
 * 通常file以外・上限超過・1行でも読めない記録は全体を拒否する。
 */
export function readVerificationRuns(stagingInput) {
    const staging = assertWorkflowStaging(stagingInput);
    const file = path.join(staging, ...VERIFICATION_RUN_FILE.split("/"));
    const directory = path.dirname(file);
    const directoryStat = fs.lstatSync(directory, { throwIfNoEntry: false });
    if (directoryStat === undefined)
        return Object.freeze([]);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory())
        throw new Error("検証記録directoryはsymlinkでない通常directoryが必要です");
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (stat === undefined)
        return Object.freeze([]);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1)
        throw new Error("検証記録はsymlink・hardlinkでない通常fileが必要です");
    if (stat.size > MAX_RECORD_FILE_BYTES)
        throw new Error(`検証記録fileが上限${MAX_RECORD_FILE_BYTES} byteを超えています`);
    const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fs.fstatSync(descriptor);
        if (opened.dev !== stat.dev || opened.ino !== stat.ino)
            throw new Error("検証記録が読取直前に変化しました");
        return parseVerificationRuns(fs.readFileSync(descriptor, "utf8"));
    }
    finally {
        fs.closeSync(descriptor);
    }
}
function stagingDigestConsistent(staging) {
    try {
        const stored = readStoredStagingRecord(staging);
        const artifacts = listStagingArtifacts(staging);
        return (stableJson(stored.artifacts) === stableJson(artifacts) &&
            stored.digest === calculateStagingDigest(staging, artifacts));
    }
    catch {
        return false;
    }
}
/**
 * 検証記録を1件追記する。既存記録を厳密に読み直してから、全体をatomicに書き換える。
 *
 * **staging digestは、追記前に記録と一致していた場合だけ再固定する。** 追記前から
 * 不一致なら無関係な変更を正当化しないためそのままにする（review roundとStep記録が
 * 従来どおり再固定する）。
 */
export function appendVerificationRun(stagingInput, record) {
    const staging = assertWorkflowStaging(stagingInput);
    return withStagingMutationLock(staging, () => {
        const existing = readVerificationRuns(staging);
        if (existing.some((item) => item.recordDigest === record.recordDigest))
            throw new Error("同じrecordDigestの検証記録が既にあります");
        const consistent = stagingDigestConsistent(staging);
        const next = [...existing, record];
        const file = path.join(staging, ...VERIFICATION_RUN_FILE.split("/"));
        const directory = path.dirname(file);
        const directoryStat = fs.lstatSync(directory, { throwIfNoEntry: false });
        if (directoryStat === undefined)
            fs.mkdirSync(directory, { mode: 0o700 });
        writeFileAtomic(file, renderVerificationRuns(next), {
            temporaryDirectory: path.dirname(staging),
        });
        if (consistent)
            refreshStoredStagingDigest(staging);
        const reread = readVerificationRuns(staging);
        if (stableJson(reread) !== stableJson(next))
            throw new Error("検証記録の書き込み後read-backが一致しません");
        return reread;
    });
}
function resolveCommit(root, label, value) {
    const observed = git(["rev-parse", "--verify", `${value}^{commit}`], root, {
        env: GIT_ENV,
        allowFailure: true,
    });
    if (observed.status !== 0)
        throw new Error(`${label}をexact commitへ解決できません: ${value}`);
    return observed.stdout.trim();
}
/**
 * 追跡fileと未追跡fileが現在HEADと完全一致するかを観測する。stagingの配置rootは
 * 除く（Step 9の候補worktree検査と同じ形）。
 */
function worktreeDifferences(root) {
    return git([
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--",
        ".",
        stagingExcludePathspec(readStagingLayout(root)),
    ], root, { env: GIT_ENV }).stdout;
}
/**
 * 検証の比較基点と影響集合を解決する。**比較基点は`--base`、無ければreview sessionの
 * 比較基点である。** どちらも無ければ拒否する。
 */
export function resolveVerificationTarget(input) {
    const staging = assertWorkflowStaging(input.staging);
    const root = stagingRepositoryRoot(staging);
    let baseSha;
    if (input.base !== undefined)
        baseSha = resolveCommit(root, "--base", input.base);
    else {
        const session = readStoredReviewSession(staging);
        if (session === null)
            throw new Error("verify runにはreview sessionの比較基点か--base=<commit>が必要です");
        baseSha = session.anchor.diffBaseSha;
    }
    return {
        baseSha,
        impact: computeImpactSet({ root, baseSha, headSha: input.headSha }),
    };
}
/**
 * 検証commandを**shellを通さず**argvのまま実行し、結果を機械記録へ追記する
 * （`verify run`、REQ-WF-040）。
 *
 * 1. 候補worktreeが現在HEADと完全一致することを要求し、HEADのexact SHAを記録する
 * 2. 比較基点..HEADの影響集合を導出する。影響集合がfullなら`scope=targeted`を拒否し、
 *    targetedなら`scope=targeted`のargvが影響集合の選んだfeatureを全部含むことを要求する
 * 3. commandを実行する。出力は標準エラーへ中継し、記録にはdigestだけを残す
 * 4. 実行後もHEADとworktreeが変わっていないことを確かめてから記録する
 */
export async function runVerification(input) {
    const staging = assertWorkflowStaging(input.staging);
    const root = stagingRepositoryRoot(staging);
    const argv = validateVerificationArgv([...input.argv], "verify runのcommand");
    const now = input.now ?? (() => new Date());
    const output = input.output ?? process.stderr;
    if (worktreeDifferences(root) !== "")
        throw new Error("verify runは追跡fileと未追跡fileが現在HEADと完全一致するworktreeでだけ実行できます。変更をcommitしてから再実行してください");
    const headSha = resolveCommit(root, "current HEAD", "HEAD");
    const { baseSha, impact } = resolveVerificationTarget({
        staging,
        headSha,
        ...(input.base === undefined ? {} : { base: input.base }),
    });
    if (input.scope === "targeted" && impact.mode === "full")
        throw new Error(`影響集合がfullのためscope=targetedの検証は記録できません: ${impact.reasons.slice(0, 3).join("; ")}`);
    if (input.scope === "targeted") {
        const missing = missingTargetedFeatures(argv, impact.features);
        if (missing.length > 0)
            throw new Error(`scope=targetedのcommandは影響集合が選んだfeatureを全部argvに含む必要があります: ${missing.join(", ")}`);
    }
    const [file, ...args] = argv;
    const startedAt = now().toISOString();
    const stdout = crypto.createHash("sha256");
    const stderr = crypto.createHash("sha256");
    const outcome = await new Promise((resolve, reject) => {
        const child = spawn(file, args, {
            cwd: root,
            env: process.env,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
        });
        child.stdout.on("data", (chunk) => {
            stdout.update(chunk);
            output.write(chunk);
        });
        child.stderr.on("data", (chunk) => {
            stderr.update(chunk);
            output.write(chunk);
        });
        child.once("error", (error) => reject(new Error(`verify runのcommandを起動できません: ${file}（${error.code ?? error.name}）`)));
        child.once("close", (code, signal) => resolve({ exitCode: signal === null ? code : null, signal }));
    });
    const finishedAt = now().toISOString();
    if (resolveCommit(root, "current HEAD", "HEAD") !== headSha)
        throw new Error("verify runの実行中にHEADが変わりました。観測を記録しません");
    if (worktreeDifferences(root) !== "")
        throw new Error("verify runの実行後に追跡fileまたは未追跡fileが変わりました。観測を記録しません。commandが生成するfileを.gitignoreへ入れるか、commitと一致する状態で再実行してください");
    const record = sealVerificationRun({
        schemaVersion: VERIFICATION_RUN_SCHEMA_VERSION,
        baseSha,
        headSha,
        command: argv,
        scope: input.scope,
        impactDigest: impact.digest,
        impactMode: impact.mode,
        exitCode: outcome.exitCode,
        signal: outcome.signal,
        startedAt,
        finishedAt,
        stdoutDigest: stdout.digest("hex"),
        stderrDigest: stderr.digest("hex"),
    });
    appendVerificationRun(staging, record);
    return { record, impact };
}
//# sourceMappingURL=verification-run.js.map