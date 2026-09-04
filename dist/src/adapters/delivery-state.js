import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { DELIVERY_STATE_FILE, bindPullRequest, claimMergeDispatch, claimPullRequestCreationDispatch, deliveryStateDigest, observeMerge, parseDeliveryState, prepareMergeIntent, preparePullRequestCreation, recordStep11, renderDeliveryState, requireDeliveryReconciliation, resumePullRequestCreationAfterConfirmedAbsence, } from "../domain/delivery-state.js";
import { calculateStagingDigest, listStagingArtifacts, readStoredStagingRecord, refreshStoredStagingDigest, STAGING_RECORD_FILE, withStagingMutationLock, } from "../domain/staging.js";
import { writeFileAtomic } from "../lib/atomic.js";
import { parseJsonStrict, stableJson } from "../lib/security.js";
import { isRecord } from "../types.js";
import { assertWorkflowStaging } from "./workflow-journal.js";
export const DELIVERY_STATE_TRANSACTION_SCHEMA = "agent-skill-chain/delivery-state-transaction/v1";
export const DELIVERY_STATE_TRANSACTION_LIMITS = Object.freeze({
    bytes: 256 * 1024,
    artifacts: 2_048,
    pathBytes: 4_096,
});
const SHA256 = /^[a-f0-9]{64}$/u;
const CONTROL = /[\0\p{Cc}\p{Cf}]/u;
const TRANSACTION_FIELDS = new Set([
    "schemaVersion",
    "deliveryBeforeDigest",
    "deliveryAfterDigest",
    "deliveryBeforeFileDigest",
    "deliveryAfterFileDigest",
    "stagingRecordBeforeFileDigest",
    "stagingRecordAfterFileDigest",
    "stagingDigestBefore",
    "stagingDigestAfter",
    "artifactsBefore",
    "artifactsAfter",
    "otherArtifactsDigest",
]);
function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}
function fsyncFile(file) {
    const descriptor = fs.openSync(file, "r");
    try {
        fs.fsyncSync(descriptor);
    }
    finally {
        fs.closeSync(descriptor);
    }
}
function fsyncDirectory(directory) {
    if (process.platform === "win32")
        return;
    const descriptor = fs.openSync(directory, "r");
    try {
        fs.fsyncSync(descriptor);
    }
    finally {
        fs.closeSync(descriptor);
    }
}
function deliveryFile(staging) {
    return path.join(staging, ...DELIVERY_STATE_FILE.split("/"));
}
function assertDeliveryDirectory(staging) {
    const directory = path.dirname(deliveryFile(staging));
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error("delivery stateの親はsymlinkでない通常directoryが必要です");
    if (fs.realpathSync(directory) !== directory)
        throw new Error("delivery stateの親にsymlink祖先を使用できません");
    return directory;
}
export function deliveryStateTransactionPath(stagingInput) {
    const staging = assertWorkflowStaging(stagingInput);
    return path.join(path.dirname(staging), `.${path.basename(staging)}.delivery-state.transaction.json`);
}
function readRegularFileBounded(file, maximumBytes, label) {
    const named = fs.lstatSync(file);
    if (named.isSymbolicLink() ||
        !named.isFile() ||
        named.nlink !== 1 ||
        named.size <= 0 ||
        named.size > maximumBytes ||
        fs.realpathSync(file) !== file)
        throw new Error(`${label}はsymlink・hardlinkでない${maximumBytes} byte以下の通常fileが必要です`);
    const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fs.fstatSync(descriptor);
        if (!opened.isFile() ||
            opened.nlink !== 1 ||
            opened.dev !== named.dev ||
            opened.ino !== named.ino ||
            opened.size !== named.size)
            throw new Error(`${label}が検査後に差し替えられました`);
        const buffer = Buffer.alloc(opened.size);
        let offset = 0;
        while (offset < buffer.length) {
            const count = fs.readSync(descriptor, buffer, offset, buffer.length - offset, offset);
            if (count <= 0)
                throw new Error(`${label}を完全に読み取れません`);
            offset += count;
        }
        const after = fs.fstatSync(descriptor);
        if (after.dev !== opened.dev ||
            after.ino !== opened.ino ||
            after.size !== opened.size ||
            after.mtimeMs !== opened.mtimeMs)
            throw new Error(`${label}が読み取り中に変更されました`);
        return buffer;
    }
    finally {
        fs.closeSync(descriptor);
    }
}
function validArtifactPath(value) {
    return (value !== "" &&
        Buffer.byteLength(value, "utf8") <=
            DELIVERY_STATE_TRANSACTION_LIMITS.pathBytes &&
        value.normalize("NFC") === value &&
        !path.isAbsolute(value) &&
        !value.includes("\\") &&
        !CONTROL.test(value) &&
        value !== STAGING_RECORD_FILE &&
        value
            .split("/")
            .every((part) => part !== "" && part !== "." && part !== ".." && part !== ".git"));
}
function parseArtifactPaths(value, label) {
    if (!Array.isArray(value) ||
        value.length > DELIVERY_STATE_TRANSACTION_LIMITS.artifacts ||
        value.some((item) => typeof item !== "string" || !validArtifactPath(item)))
        throw new Error(`${label}のpathまたは件数が不正です`);
    const paths = [...value];
    if (new Set(paths).size !== paths.length ||
        stableJson(paths) !==
            stableJson([...paths].sort((left, right) => left.localeCompare(right))))
        throw new Error(`${label}は重複のない字句順が必要です`);
    return paths;
}
function nullableDigest(value) {
    return value === null || (typeof value === "string" && SHA256.test(value));
}
function requiredDigest(value) {
    return typeof value === "string" && SHA256.test(value);
}
function parseDeliveryStateTransaction(source) {
    const value = parseJsonStrict(source, "delivery state transaction");
    if (!isRecord(value) ||
        Object.keys(value).length !== TRANSACTION_FIELDS.size ||
        Object.keys(value).some((field) => !TRANSACTION_FIELDS.has(field)) ||
        value.schemaVersion !== DELIVERY_STATE_TRANSACTION_SCHEMA ||
        !nullableDigest(value.deliveryBeforeDigest) ||
        !requiredDigest(value.deliveryAfterDigest) ||
        !nullableDigest(value.deliveryBeforeFileDigest) ||
        !requiredDigest(value.deliveryAfterFileDigest) ||
        !requiredDigest(value.stagingRecordBeforeFileDigest) ||
        !requiredDigest(value.stagingRecordAfterFileDigest) ||
        !requiredDigest(value.stagingDigestBefore) ||
        !requiredDigest(value.stagingDigestAfter) ||
        !requiredDigest(value.otherArtifactsDigest))
        throw new Error("delivery state transactionの構造またはdigestが不正です");
    const artifactsBefore = parseArtifactPaths(value.artifactsBefore, "delivery state transaction artifactsBefore");
    const artifactsAfter = parseArtifactPaths(value.artifactsAfter, "delivery state transaction artifactsAfter");
    const expectedAfter = artifactsBefore.includes(DELIVERY_STATE_FILE)
        ? artifactsBefore
        : [...artifactsBefore, DELIVERY_STATE_FILE].sort((left, right) => left.localeCompare(right));
    if (stableJson(artifactsAfter) !== stableJson(expectedAfter) ||
        !artifactsAfter.includes(DELIVERY_STATE_FILE) ||
        (value.deliveryBeforeDigest === null) !==
            (value.deliveryBeforeFileDigest === null) ||
        (value.deliveryBeforeDigest === null) !==
            !artifactsBefore.includes(DELIVERY_STATE_FILE) ||
        value.deliveryBeforeDigest === value.deliveryAfterDigest ||
        value.deliveryBeforeFileDigest === value.deliveryAfterFileDigest)
        throw new Error("delivery state transactionのbefore/after関係が不正です");
    return {
        schemaVersion: DELIVERY_STATE_TRANSACTION_SCHEMA,
        deliveryBeforeDigest: value.deliveryBeforeDigest,
        deliveryAfterDigest: value.deliveryAfterDigest,
        deliveryBeforeFileDigest: value.deliveryBeforeFileDigest,
        deliveryAfterFileDigest: value.deliveryAfterFileDigest,
        stagingRecordBeforeFileDigest: value.stagingRecordBeforeFileDigest,
        stagingRecordAfterFileDigest: value.stagingRecordAfterFileDigest,
        stagingDigestBefore: value.stagingDigestBefore,
        stagingDigestAfter: value.stagingDigestAfter,
        artifactsBefore,
        artifactsAfter,
        otherArtifactsDigest: value.otherArtifactsDigest,
    };
}
function readDeliverySource(staging) {
    const file = deliveryFile(staging);
    if (!fs.existsSync(file))
        return undefined;
    return readRegularFileBounded(file, 1024 * 1024, "delivery state").toString("utf8");
}
function projectedStagingDigest(staging, artifacts, deliveryFileDigest) {
    const values = artifacts.map((relative) => {
        if (relative === DELIVERY_STATE_FILE) {
            if (!deliveryFileDigest)
                throw new Error("delivery stateを含む成果物集合にbefore digestがありません");
            return { relative, digest: deliveryFileDigest };
        }
        const absolute = path.join(staging, ...relative.split("/"));
        return { relative, digest: sha256(fs.readFileSync(absolute)) };
    });
    return sha256(stableJson(values));
}
function recordSource(record) {
    return `${JSON.stringify(record, null, 2)}\n`;
}
function transactionMarkerPathLocked(staging) {
    return path.join(path.dirname(staging), `.${path.basename(staging)}.delivery-state.transaction.json`);
}
function assertRegularTransactionMarker(marker) {
    readRegularFileBounded(marker, DELIVERY_STATE_TRANSACTION_LIMITS.bytes, "delivery state transaction marker");
}
function clearDeliveryStateTransactionLocked(staging) {
    const marker = transactionMarkerPathLocked(staging);
    if (!fs.existsSync(marker))
        return;
    assertRegularTransactionMarker(marker);
    fs.unlinkSync(marker);
    fsyncDirectory(path.dirname(staging));
}
function inspectPendingDeliveryStateTransactionLocked(staging) {
    const markerFile = transactionMarkerPathLocked(staging);
    if (!fs.existsSync(markerFile))
        return null;
    const marker = parseDeliveryStateTransaction(readRegularFileBounded(markerFile, DELIVERY_STATE_TRANSACTION_LIMITS.bytes, "delivery state transaction marker").toString("utf8"));
    const recordFile = path.join(staging, STAGING_RECORD_FILE);
    const currentRecordSource = fs.readFileSync(recordFile, "utf8");
    const currentRecordFileDigest = sha256(currentRecordSource);
    const currentRecord = readStoredStagingRecord(staging);
    const inventory = listStagingArtifacts(staging);
    const otherArtifacts = marker.artifactsAfter.filter((artifact) => artifact !== DELIVERY_STATE_FILE);
    if (stableJson(marker.artifactsBefore.filter((artifact) => artifact !== DELIVERY_STATE_FILE)) !== stableJson(otherArtifacts) ||
        calculateStagingDigest(staging, otherArtifacts) !==
            marker.otherArtifactsDigest ||
        projectedStagingDigest(staging, marker.artifactsBefore, marker.deliveryBeforeFileDigest) !== marker.stagingDigestBefore ||
        projectedStagingDigest(staging, marker.artifactsAfter, marker.deliveryAfterFileDigest) !== marker.stagingDigestAfter)
        throw new Error("delivery state transaction以外のstaging成果物またはdigestが変更されています");
    const recordBefore = currentRecordFileDigest === marker.stagingRecordBeforeFileDigest &&
        currentRecord.digest === marker.stagingDigestBefore &&
        stableJson(currentRecord.artifacts) === stableJson(marker.artifactsBefore);
    const recordAfter = currentRecordFileDigest === marker.stagingRecordAfterFileDigest &&
        currentRecord.digest === marker.stagingDigestAfter &&
        stableJson(currentRecord.artifacts) === stableJson(marker.artifactsAfter);
    if (!recordBefore && !recordAfter)
        throw new Error("staging recordがdelivery transactionのbefore/afterいずれとも一致しません");
    const currentDeliverySource = readDeliverySource(staging);
    const currentDeliveryFileDigest = currentDeliverySource
        ? sha256(currentDeliverySource)
        : null;
    const currentDeliveryDigest = currentDeliverySource
        ? deliveryStateDigest(parseDeliveryState(currentDeliverySource))
        : null;
    const deliveryBefore = currentDeliveryDigest === marker.deliveryBeforeDigest &&
        currentDeliveryFileDigest === marker.deliveryBeforeFileDigest;
    const deliveryAfter = currentDeliveryDigest === marker.deliveryAfterDigest &&
        currentDeliveryFileDigest === marker.deliveryAfterFileDigest;
    if (deliveryBefore) {
        if (!recordBefore ||
            stableJson(inventory) !== stableJson(marker.artifactsBefore) ||
            calculateStagingDigest(staging, inventory) !== marker.stagingDigestBefore)
            throw new Error("delivery publish前のtransaction状態が不整合です");
        return { marker, state: "before-publish" };
    }
    if (deliveryAfter) {
        if (stableJson(inventory) !== stableJson(marker.artifactsAfter) ||
            calculateStagingDigest(staging, inventory) !== marker.stagingDigestAfter)
            throw new Error("delivery publish後のtransaction状態が不整合です");
        return {
            marker,
            state: recordAfter ? "record-refreshed" : "delivery-published",
        };
    }
    throw new Error("delivery stateがtransactionのbefore/afterいずれとも一致しません");
}
function recoverPendingDeliveryStateTransactionLocked(staging) {
    const pending = inspectPendingDeliveryStateTransactionLocked(staging);
    if (!pending)
        return "none";
    if (pending.state === "before-publish") {
        clearDeliveryStateTransactionLocked(staging);
        return "rolled-back";
    }
    if (pending.state === "delivery-published") {
        refreshStoredStagingDigest(staging);
        const refreshed = inspectPendingDeliveryStateTransactionLocked(staging);
        if (!refreshed || refreshed.state !== "record-refreshed")
            throw new Error("delivery state transactionのrecord復旧確認に失敗しました");
    }
    clearDeliveryStateTransactionLocked(staging);
    return "completed";
}
export function recoverPendingDeliveryStateTransaction(stagingInput) {
    const staging = assertWorkflowStaging(stagingInput);
    return withStagingMutationLock(staging, () => recoverPendingDeliveryStateTransactionLocked(staging));
}
function beginDeliveryStateTransactionLocked(staging, state) {
    if (fs.existsSync(transactionMarkerPathLocked(staging)))
        throw new Error("未復旧のdelivery state transactionがあります");
    const artifactsBefore = listStagingArtifacts(staging);
    const storedBefore = readStoredStagingRecord(staging);
    const storedBeforeSource = fs.readFileSync(path.join(staging, STAGING_RECORD_FILE), "utf8");
    if (stableJson(artifactsBefore) !== stableJson(storedBefore.artifacts) ||
        calculateStagingDigest(staging, artifactsBefore) !== storedBefore.digest)
        throw new Error("delivery transaction開始前のstaging recordが一致しません");
    const beforeSource = readDeliverySource(staging);
    const beforeState = beforeSource
        ? parseDeliveryState(beforeSource)
        : undefined;
    if (beforeState && stableJson(beforeState) === stableJson(state))
        return null;
    if ((beforeState === undefined) !==
        !artifactsBefore.includes(DELIVERY_STATE_FILE))
        throw new Error("delivery stateとstaging artifact inventoryが一致しません");
    const source = renderDeliveryState(state);
    const artifactsAfter = artifactsBefore.includes(DELIVERY_STATE_FILE)
        ? [...artifactsBefore]
        : [...artifactsBefore, DELIVERY_STATE_FILE].sort((left, right) => left.localeCompare(right));
    if (artifactsAfter.length > DELIVERY_STATE_TRANSACTION_LIMITS.artifacts ||
        artifactsAfter.some((artifact) => !validArtifactPath(artifact)))
        throw new Error("delivery transactionのartifact pathまたは件数が上限外です");
    const deliveryAfterFileDigest = sha256(source);
    const stagingDigestAfter = projectedStagingDigest(staging, artifactsAfter, deliveryAfterFileDigest);
    const storedAfter = {
        ...storedBefore,
        artifacts: artifactsAfter,
        digest: stagingDigestAfter,
    };
    const marker = {
        schemaVersion: DELIVERY_STATE_TRANSACTION_SCHEMA,
        deliveryBeforeDigest: beforeState ? deliveryStateDigest(beforeState) : null,
        deliveryAfterDigest: deliveryStateDigest(state),
        deliveryBeforeFileDigest: beforeSource ? sha256(beforeSource) : null,
        deliveryAfterFileDigest,
        stagingRecordBeforeFileDigest: sha256(storedBeforeSource),
        stagingRecordAfterFileDigest: sha256(recordSource(storedAfter)),
        stagingDigestBefore: storedBefore.digest,
        stagingDigestAfter,
        artifactsBefore: [...artifactsBefore],
        artifactsAfter,
        otherArtifactsDigest: calculateStagingDigest(staging, artifactsBefore.filter((artifact) => artifact !== DELIVERY_STATE_FILE)),
    };
    const markerSource = `${stableJson(marker)}\n`;
    if (Buffer.byteLength(markerSource, "utf8") >
        DELIVERY_STATE_TRANSACTION_LIMITS.bytes)
        throw new Error("delivery state transaction markerがbyte上限を超えています");
    writeFileAtomic(transactionMarkerPathLocked(staging), markerSource, {
        temporaryDirectory: path.dirname(staging),
    });
    const inspected = inspectPendingDeliveryStateTransactionLocked(staging);
    if (!inspected || inspected.state !== "before-publish")
        throw new Error("delivery state transaction markerの開始確認に失敗しました");
    return { marker, source };
}
function readLocked(staging) {
    const source = readDeliverySource(staging);
    return source === undefined ? undefined : parseDeliveryState(source);
}
function persistLocked(staging, state) {
    recoverPendingDeliveryStateTransactionLocked(staging);
    const directory = assertDeliveryDirectory(staging);
    const file = deliveryFile(staging);
    const transaction = beginDeliveryStateTransactionLocked(staging, state);
    if (!transaction) {
        const current = readLocked(staging);
        if (!current)
            throw new Error("delivery stateのno-op transactionにcurrent stateがありません");
        return current;
    }
    writeFileAtomic(file, transaction.source, {
        temporaryDirectory: path.dirname(staging),
    });
    fsyncFile(file);
    fsyncDirectory(directory);
    if (recoverPendingDeliveryStateTransactionLocked(staging) !== "completed")
        throw new Error("delivery state transactionを完了できませんでした");
    const reread = readLocked(staging);
    if (!reread || stableJson(reread) !== stableJson(state))
        throw new Error("delivery stateの書き込み後読み取り確認に失敗しました");
    return reread;
}
function recoverAndReadLocked(staging) {
    recoverPendingDeliveryStateTransactionLocked(staging);
    return readLocked(staging);
}
function sameCreate(left, right) {
    const { dispatchClaimedAt: _leftClaim, ...leftIdentity } = left;
    const { dispatchClaimedAt: _rightClaim, ...rightIdentity } = right;
    return stableJson(leftIdentity) === stableJson(rightIdentity);
}
export function readStoredDeliveryState(directory) {
    const staging = assertWorkflowStaging(directory);
    return withStagingMutationLock(staging, () => recoverAndReadLocked(staging));
}
/**
 * 外部PR作成より前にcreate intentをdurable化する。同じintentの再読取だけを許し、
 * 異なるPR作成入力で既存stateを上書きしない。
 */
export function prepareStoredPullRequestCreation(directory, create) {
    const staging = assertWorkflowStaging(directory);
    return withStagingMutationLock(staging, () => {
        recoverPendingDeliveryStateTransactionLocked(staging);
        const prepared = preparePullRequestCreation(create);
        const current = readLocked(staging);
        if (!current)
            return persistLocked(staging, prepared);
        if (!sameCreate(current.create, prepared.create))
            throw new Error("既存delivery stateのPR作成identityと入力が一致しません");
        return current;
    });
}
/**
 * provider create直前にone-shot claimをfsyncする。dispatchAllowed=trueを得た
 * 呼出元だけが外部createを1回呼べる。claim後は成否不明でも再claimできない。
 */
export function claimStoredPullRequestCreationDispatch(directory, claimedAt) {
    const staging = assertWorkflowStaging(directory);
    return withStagingMutationLock(staging, () => {
        const current = recoverAndReadLocked(staging);
        if (!current)
            throw new Error("PR create dispatchより前のintentがありません");
        if (current.state !== "create-prepared")
            return { state: current, dispatchAllowed: false };
        if (current.create.dispatchClaimedAt !== null)
            return { state: current, dispatchAllowed: false };
        return {
            state: persistLocked(staging, claimPullRequestCreationDispatch(current, claimedAt)),
            dispatchAllowed: true,
        };
    });
}
export function resumeStoredPullRequestCreationAfterConfirmedAbsence(directory) {
    const staging = assertWorkflowStaging(directory);
    return withStagingMutationLock(staging, () => {
        const current = recoverAndReadLocked(staging);
        if (!current)
            throw new Error("PR create再開より前のintentがありません");
        return persistLocked(staging, resumePullRequestCreationAfterConfirmedAbsence(current));
    });
}
export function bindStoredPullRequest(directory, binding) {
    const staging = assertWorkflowStaging(directory);
    return withStagingMutationLock(staging, () => {
        const current = recoverAndReadLocked(staging);
        if (!current)
            throw new Error("PR bindingより前のcreate intentがありません");
        if (current.pr) {
            if (stableJson(current.pr) !== stableJson(binding))
                throw new Error("固定済みPR bindingを変更できません");
            return current;
        }
        return persistLocked(staging, bindPullRequest(current, binding));
    });
}
export function prepareStoredMergeIntent(directory, merge) {
    const staging = assertWorkflowStaging(directory);
    return withStagingMutationLock(staging, () => {
        const current = recoverAndReadLocked(staging);
        if (!current)
            throw new Error("mergeより前のdelivery stateがありません");
        if (current.state === "pr-bound")
            return {
                state: persistLocked(staging, prepareMergeIntent(current, merge)),
                requestAllowed: true,
            };
        if (!current.merge)
            throw new Error(`${current.state}にmerge intentがありません`);
        const { dispatchClaimedAt: _dispatchClaim, observation: _observation, ...currentIdentity } = current.merge;
        if (stableJson(currentIdentity) !== stableJson(merge))
            throw new Error("既存merge intentのimmutable identityを変更できません");
        return {
            state: current,
            requestAllowed: current.merge.dispatchClaimedAt === null,
        };
    });
}
/** merge provider callにもcreateと同じdurable one-shot claimを適用する。 */
export function claimStoredMergeDispatch(directory, claimedAt) {
    const staging = assertWorkflowStaging(directory);
    return withStagingMutationLock(staging, () => {
        const current = recoverAndReadLocked(staging);
        if (!current)
            throw new Error("merge dispatchより前のintentがありません");
        if (current.state !== "merge-prepared" || !current.merge)
            return { state: current, dispatchAllowed: false };
        if (current.merge.dispatchClaimedAt !== null)
            return { state: current, dispatchAllowed: false };
        return {
            state: persistLocked(staging, claimMergeDispatch(current, claimedAt)),
            dispatchAllowed: true,
        };
    });
}
export function observeStoredMerge(directory, observation) {
    const staging = assertWorkflowStaging(directory);
    return withStagingMutationLock(staging, () => {
        const current = recoverAndReadLocked(staging);
        if (!current)
            throw new Error("merge observationより前のstateがありません");
        const next = observeMerge(current, observation);
        return next === current ? current : persistLocked(staging, next);
    });
}
export function recordStoredStep11(directory, input) {
    const staging = assertWorkflowStaging(directory);
    return withStagingMutationLock(staging, () => {
        const current = recoverAndReadLocked(staging);
        if (!current)
            throw new Error("Step 11より前のdelivery stateがありません");
        if (current.step11) {
            if (current.step11.outcome !== input.outcome ||
                current.step11.recordedAt !== input.recordedAt ||
                current.step11.journalDigest !== input.journalDigest)
                throw new Error("記録済みStep 11 evidenceを変更できません");
            return current;
        }
        return persistLocked(staging, recordStep11(current, input));
    });
}
export function requireStoredDeliveryReconciliation(directory, input) {
    const staging = assertWorkflowStaging(directory);
    return withStagingMutationLock(staging, () => {
        const current = recoverAndReadLocked(staging);
        if (!current)
            throw new Error("照合対象のdelivery stateがありません");
        if (current.state === "reconciliation-required")
            return current;
        return persistLocked(staging, requireDeliveryReconciliation(current, input));
    });
}
//# sourceMappingURL=delivery-state.js.map