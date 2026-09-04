import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { calculateStagingDigest, finalizeStoredStagingPromotion, listStagingArtifacts, promoteStoredStagingModeToFull, refreshStoredStagingDigest, readStoredStagingRecord, STAGING_RECORD_FILE, STAGING_PROMOTION_TRANSACTION_FILE as PROMOTION_TRANSACTION_FILE, withStagingMutationLock, } from "../domain/staging.js";
import { MODE_DECISION_FILE, parseModeDecision, parseStepJournal, renderModeDecision, STEP_JOURNAL_FILE, inspectWorkflowStagingArtifacts, validateStepJournal, WORKFLOW_STEPS, } from "../domain/workflow.js";
import { assessImplementationDiscovery, parseImplementationDiscoveryInput, } from "../domain/agile-verification.js";
import { MODE_QUESTIONS, } from "../domain/mode.js";
import { writeFileAtomic } from "../lib/atomic.js";
import { findPackageRoot } from "../lib/package-root.js";
import { parseJsonStrict, stableJson } from "../lib/security.js";
import { isRecord } from "../types.js";
import { DELIVERY_STATE_FILE, parseDeliveryState, } from "../domain/delivery-state.js";
import { POC_OBSERVATION_DIRECTORY, pocObservationArtifact, validatePocObservationEvidence, } from "../domain/poc-observation.js";
import { assertPocHeadChangeScope, executePocSandboxObservation, } from "./poc-execution.js";
export { calculatePocFixtureDigest } from "./poc-execution.js";
const packageRoot = findPackageRoot(import.meta.url);
const issueTemplateRoot = path.join(packageRoot, ".agent-skill-chain", "templates", "issue");
const FULL_PLAN_ARTIFACTS = Object.freeze([
    "01_要件定義.md",
    "02_設計.md",
    "03_実装計画.md",
]);
const PROMOTION_DISCOVERY_FILE = "09_実装中発見_full昇格.json";
const JOURNAL_TRANSACTION_SCHEMA = "agent-skill-chain/workflow-journal-transaction/v1";
const POC_OBSERVATION_TRANSACTION_SCHEMA = "agent-skill-chain/poc-observation-transaction/v1";
function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}
function journalTransactionPath(staging) {
    return path.join(path.dirname(staging), `.${path.basename(staging)}.workflow-journal-transaction.json`);
}
function parseJournalTransaction(source) {
    const value = parseJsonStrict(source, "workflow journal transaction");
    if (!isRecord(value))
        throw new Error("workflow journal transactionはobjectが必要です");
    const fields = new Set([
        "schemaVersion",
        "journalBeforeDigest",
        "journalAfterDigest",
        "stagingDigestBefore",
        "artifacts",
        "otherArtifactsDigest",
    ]);
    if (Object.keys(value).some((field) => !fields.has(field)) ||
        [...fields].some((field) => !(field in value)) ||
        value.schemaVersion !== JOURNAL_TRANSACTION_SCHEMA ||
        !/^[a-f0-9]{64}$/u.test(String(value.journalBeforeDigest ?? "")) ||
        !/^[a-f0-9]{64}$/u.test(String(value.journalAfterDigest ?? "")) ||
        !/^[a-f0-9]{64}$/u.test(String(value.stagingDigestBefore ?? "")) ||
        !/^[a-f0-9]{64}$/u.test(String(value.otherArtifactsDigest ?? "")) ||
        !Array.isArray(value.artifacts) ||
        value.artifacts.length > 256 ||
        value.artifacts.some((artifact) => typeof artifact !== "string" ||
            Buffer.byteLength(artifact, "utf8") > 1024 ||
            artifact.normalize("NFC") !== artifact))
        throw new Error("workflow journal transactionの構造が不正です");
    const artifacts = value.artifacts;
    if (new Set(artifacts).size !== artifacts.length ||
        stableJson(artifacts) !==
            stableJson([...artifacts].sort((left, right) => left.localeCompare(right))) ||
        artifacts.some((artifact) => artifact === "" ||
            path.isAbsolute(artifact) ||
            artifact.includes("\\") ||
            artifact.split("/").some((part) => part === ".." || part === ".git")))
        throw new Error("workflow journal transactionのartifact一覧が不正です");
    return {
        schemaVersion: JOURNAL_TRANSACTION_SCHEMA,
        journalBeforeDigest: String(value.journalBeforeDigest),
        journalAfterDigest: String(value.journalAfterDigest),
        stagingDigestBefore: String(value.stagingDigestBefore),
        artifacts: [...artifacts],
        otherArtifactsDigest: String(value.otherArtifactsDigest),
    };
}
function assertRegularTransactionPath(transaction) {
    const stat = fs.lstatSync(transaction);
    if (stat.isSymbolicLink() ||
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.size > 64 * 1024)
        throw new Error("workflow journal transactionはsymlink・hardlinkでない通常fileが必要です");
    if (fs.realpathSync(transaction) !== transaction)
        throw new Error("workflow journal transactionにsymlink祖先を使用できません");
}
export function inspectPendingJournalTransaction(stagingInput) {
    const staging = assertWorkflowStaging(stagingInput);
    const transaction = journalTransactionPath(staging);
    if (!fs.existsSync(transaction))
        return null;
    assertRegularTransactionPath(transaction);
    const parsed = parseJournalTransaction(fs.readFileSync(transaction, "utf8"));
    const stored = readStoredStagingRecord(staging);
    const artifacts = listStagingArtifacts(staging);
    const otherArtifacts = artifacts.filter((artifact) => artifact !== STEP_JOURNAL_FILE);
    if (stableJson(stored.artifacts) !== stableJson(parsed.artifacts) ||
        stableJson(artifacts) !== stableJson(parsed.artifacts) ||
        calculateStagingDigest(staging, otherArtifacts) !==
            parsed.otherArtifactsDigest)
        throw new Error("workflow journal transaction以外のstaging成果物が変更されています");
    const journalDigest = sha256(fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE)));
    const currentStagingDigest = calculateStagingDigest(staging, artifacts);
    if (journalDigest === parsed.journalBeforeDigest &&
        stored.digest === parsed.stagingDigestBefore &&
        currentStagingDigest === parsed.stagingDigestBefore)
        return { ...parsed, state: "before-publish" };
    if (journalDigest === parsed.journalAfterDigest &&
        (stored.digest === parsed.stagingDigestBefore ||
            stored.digest === currentStagingDigest))
        return { ...parsed, state: "published" };
    throw new Error("workflow journalがtransactionの旧版・新版いずれとも一致しません");
}
function clearJournalTransaction(staging) {
    const transaction = journalTransactionPath(staging);
    if (!fs.existsSync(transaction))
        return;
    assertRegularTransactionPath(transaction);
    fs.unlinkSync(transaction);
    fsyncDirectory(path.dirname(staging));
}
function recoverPendingJournalTransactionLocked(staging) {
    const pending = inspectPendingJournalTransaction(staging);
    if (!pending)
        return false;
    if (pending.state === "published") {
        const journal = readWorkflowJournal(staging);
        if (journal.errors.length > 0)
            throw new Error(`published journal transactionのJSONLが不正です: ${journal.errors.join("; ")}`);
        refreshStoredStagingDigest(staging);
        fsyncFile(path.join(staging, STAGING_RECORD_FILE));
        fsyncDirectory(staging);
    }
    clearJournalTransaction(staging);
    return pending.state === "published";
}
export function recoverPendingJournalTransaction(stagingInput) {
    const staging = assertWorkflowStaging(stagingInput);
    return withStagingMutationLock(staging, () => recoverPendingJournalTransactionLocked(staging));
}
export function assertWorkflowStaging(staging) {
    const resolved = path.resolve(staging);
    const parent = path.dirname(resolved);
    if (path.basename(parent) !== "issues" ||
        path.basename(path.dirname(parent)) !== "tmp" ||
        path.basename(path.dirname(path.dirname(parent))) !==
            ".agent-skill-chain" ||
        path.basename(resolved).includes(".."))
        throw new Error("--stagingは.agent-skill-chain/tmp/issues/直下のdirectoryが必要です");
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error("--stagingはsymlinkでない通常directoryが必要です");
    if (fs.realpathSync(resolved) !== resolved)
        throw new Error("--stagingにsymlink祖先を使用できません");
    return resolved;
}
function assertRegularJournalPath(journal) {
    const directory = path.dirname(journal);
    const directoryStat = fs.lstatSync(directory);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory())
        throw new Error("workflow journal directoryはsymlinkでない通常directoryが必要です");
    if (fs.realpathSync(directory) !== directory)
        throw new Error("workflow journal directoryにsymlink祖先を使用できません");
    const stat = fs.lstatSync(journal);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1)
        throw new Error("workflow journalはsymlink・hardlinkでない通常fileが必要です");
    if (fs.realpathSync(journal) !== journal)
        throw new Error("workflow journalにsymlink祖先を使用できません");
    return stat;
}
function readDescriptor(descriptor, size) {
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
        const read = fs.readSync(descriptor, buffer, offset, size - offset, offset);
        if (read === 0)
            throw new Error("workflow journalを完全に再読取できません");
        offset += read;
    }
    return buffer;
}
function writeDescriptorFully(descriptor, source) {
    let offset = 0;
    while (offset < source.length) {
        const written = fs.writeSync(descriptor, source, offset, source.length - offset, null);
        if (written <= 0)
            throw new Error("workflow journalを完全に一時fileへ書き込めません");
        offset += written;
    }
}
function writeJournalTransaction(staging, journalBeforeDigest, journalAfterDigest) {
    if (inspectPendingJournalTransaction(staging))
        throw new Error("未復旧のworkflow journal transactionがあります");
    const stored = refreshStoredStagingDigest(staging);
    const marker = {
        schemaVersion: JOURNAL_TRANSACTION_SCHEMA,
        journalBeforeDigest,
        journalAfterDigest,
        stagingDigestBefore: stored.digest,
        artifacts: stored.artifacts,
        otherArtifactsDigest: calculateStagingDigest(staging, stored.artifacts.filter((artifact) => artifact !== STEP_JOURNAL_FILE)),
    };
    const transaction = journalTransactionPath(staging);
    writeFileAtomic(transaction, `${stableJson(marker)}\n`);
    fsyncFile(transaction);
    fsyncDirectory(path.dirname(staging));
    const inspected = inspectPendingJournalTransaction(staging);
    if (!inspected || inspected.state !== "before-publish")
        throw new Error("workflow journal transactionの開始確認に失敗しました");
}
export function readWorkflowJournal(staging) {
    const resolved = assertWorkflowStaging(staging);
    const record = readStoredStagingRecord(resolved);
    const journal = path.join(resolved, STEP_JOURNAL_FILE);
    if (!fs.existsSync(journal))
        return {
            mode: record.mode,
            entries: [],
            errors: [`${STEP_JOURNAL_FILE}がありません`],
            source: "",
        };
    assertRegularJournalPath(journal);
    const source = fs.readFileSync(journal, "utf8");
    const parsed = parseStepJournal(source);
    return { mode: record.mode, ...parsed, source };
}
export function appendWorkflowJournalEntry(input) {
    if (input.entry.step === 0 || input.entry.step === 11)
        throw new Error("Step 0はstaging初期化専用、Step 11はdelivery終端専用です。汎用journal追記では記録できません");
    const staging = assertWorkflowStaging(input.staging);
    return withStagingMutationLock(staging, () => appendWorkflowJournalEntryLocked(staging, input.entry, input.headSha));
}
export function appendDeliveryTerminalJournalEntry(input) {
    if (input.entry.step !== 11)
        throw new Error("delivery終端journal追記はStep 11だけを記録できます");
    const staging = assertWorkflowStaging(input.staging);
    return withStagingMutationLock(staging, () => appendWorkflowJournalEntryLocked(staging, input.entry, input.headSha));
}
function appendWorkflowJournalEntryLocked(staging, entry, headSha) {
    recoverPendingJournalTransactionLocked(staging);
    recoverPocObservationTransactionLocked(staging);
    const current = readWorkflowJournal(staging);
    if (current.errors.length > 0)
        throw new Error(`journalの追記前検査に失敗しました: ${current.errors.join("; ")}`);
    /**
     * **Step 11記録後に追記できるのはpost-terminal intakeのStep 10だけである。**
     *
     * `pr create`後に届いた外部reviewer指摘を同じPRへ取り込む経路（Issue #1194）が、
     * この追記を要する。他のStepと通常のStep 10は引き続き拒否する。**封印そのものは
     * 残し、1種類だけ通す。**
     */
    if (current.entries.some(({ step }) => step === 11) &&
        !entry.postTerminalIntake)
        throw new Error("Step 11記録後にworkflow journalへ追記できるのはpost-terminal intakeのStep 10だけです");
    /**
     * **post-terminal intakeはterminal delivery stateの後に置く記録である。**
     *
     * `step11-recorded`はまさにintakeの前提条件であり、ここで拒否すると
     * Issue #1194 の取り込み経路が成立しない。**intake以外のStep 0〜10は
     * 引き続き拒否する。**
     */
    if (entry.step < 11 && !entry.postTerminalIntake) {
        const deliveryFile = path.join(staging, DELIVERY_STATE_FILE);
        if (fs.existsSync(deliveryFile)) {
            const delivery = parseDeliveryState(fs.readFileSync(deliveryFile, "utf8"));
            if (delivery.state === "merge-observed" ||
                delivery.state === "step11-recorded")
                throw new Error("terminal delivery state後はStep 0〜10を追記できません");
        }
    }
    if (entry.mode !== current.mode)
        throw new Error(`entry mode ${entry.mode}がstaging mode ${current.mode}と一致しません`);
    let entryToWrite = entry;
    if (current.mode === "poc" && entry.step >= 9) {
        if (!headSha)
            throw new Error("PoCのStep 9以降には検証対象HEAD SHAとpoc-observation Evidenceが必要です");
        const context = pocContextAtStaging(staging);
        assertPocHeadChangeScope({
            repositoryRoot: path.resolve(staging, "../../../.."),
            baselineHeadSha: context.baselineHeadSha,
            headSha,
            fixtureRoot: context.declaration.fixture.root,
        });
        const observation = inspectStoredPocObservationEvidence(staging, headSha);
        if (!observation.valid)
            throw new Error(`PoCのStep 9以降を拒否しました: ${observation.errors.join("; ")}`);
        if (!observation.evidence)
            throw new Error("PoC観測Evidenceのbindingを取得できません");
        const binding = {
            headSha,
            evidenceDigest: observation.evidence.evidenceDigest,
        };
        if (entry.pocObservation &&
            stableJson(entry.pocObservation) !== stableJson(binding))
            throw new Error("PoC journal entryの観測bindingがcurrent HEADと一致しません");
        entryToWrite = { ...entry, pocObservation: binding };
    }
    const journal = path.join(staging, STEP_JOURNAL_FILE);
    const before = assertRegularJournalPath(journal);
    const descriptor = fs.openSync(journal, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    let pinnedSource;
    try {
        const opened = fs.fstatSync(descriptor);
        if (!opened.isFile() ||
            opened.nlink !== 1 ||
            opened.dev !== before.dev ||
            opened.ino !== before.ino)
            throw new Error("workflow journalが検査後に差し替えられました");
        pinnedSource = readDescriptor(descriptor, opened.size).toString("utf8");
        if (pinnedSource !== current.source)
            throw new Error("workflow journalが追記前検査後に変更されました");
    }
    finally {
        fs.closeSync(descriptor);
    }
    const line = `${JSON.stringify(entryToWrite)}\n`;
    const proposedSource = `${pinnedSource}${line}`;
    const parsedProposed = parseStepJournal(proposedSource);
    if (parsedProposed.errors.length > 0)
        throw new Error(`journal entryの構造検査に失敗しました: ${parsedProposed.errors.join("; ")}`);
    const validation = validateStepJournal({
        mode: current.mode,
        entries: parsedProposed.entries,
        upToStep: entryToWrite.step,
    });
    if (!validation.valid)
        throw new Error(`journalの追記を拒否しました: missingSteps=${validation.missingSteps.join(",")}; unexpectedSteps=${validation.unexpectedSteps.join(",")}; outOfOrder=${validation.outOfOrder.join(",")}; modeConflicts=${validation.modeConflicts.join("; ")}; errors=${validation.errors.join("; ")}`);
    const expectedDigest = sha256(proposedSource);
    writeJournalTransaction(staging, sha256(pinnedSource), expectedDigest);
    const temporary = path.join(path.dirname(staging), `.workflow-journal-${path.basename(staging)}-${process.pid}-${crypto.randomBytes(8).toString("hex")}.tmp`);
    let temporaryDescriptor;
    try {
        temporaryDescriptor = fs.openSync(temporary, fs.constants.O_WRONLY |
            fs.constants.O_CREAT |
            fs.constants.O_EXCL |
            fs.constants.O_NOFOLLOW, 0o600);
        writeDescriptorFully(temporaryDescriptor, Buffer.from(proposedSource));
        fs.fsyncSync(temporaryDescriptor);
        fs.closeSync(temporaryDescriptor);
        temporaryDescriptor = undefined;
        const currentPath = assertRegularJournalPath(journal);
        if (currentPath.dev !== before.dev ||
            currentPath.ino !== before.ino ||
            currentPath.size !== before.size ||
            currentPath.mtimeMs !== before.mtimeMs ||
            fs.readFileSync(journal, "utf8") !== pinnedSource)
            throw new Error("workflow journalがatomic publish前に変更されました");
        fs.renameSync(temporary, journal);
        fsyncDirectory(path.dirname(journal));
        fsyncDirectory(path.dirname(staging));
    }
    finally {
        if (temporaryDescriptor !== undefined)
            fs.closeSync(temporaryDescriptor);
        if (fs.existsSync(temporary))
            fs.unlinkSync(temporary);
    }
    assertRegularJournalPath(journal);
    const journalDigest = sha256(fs.readFileSync(journal));
    if (journalDigest !== expectedDigest)
        throw new Error("journalのatomic publish後読み取りdigestが一致しません");
    const stored = refreshStoredStagingDigest(staging);
    fsyncFile(path.join(staging, STAGING_RECORD_FILE));
    fsyncDirectory(staging);
    clearJournalTransaction(staging);
    return { entry: entryToWrite, journalDigest, stagingDigest: stored.digest };
}
function pocContextAtStaging(staging) {
    const modeFile = path.join(staging, MODE_DECISION_FILE);
    assertRegularContainedFile(staging, MODE_DECISION_FILE);
    if (fs.lstatSync(modeFile).size > 128 * 1024)
        throw new Error("PoC観測用モード判定成果物が128KiB上限を超えています");
    const parsed = parseModeDecision(fs.readFileSync(modeFile, "utf8"));
    if (!parsed.decision || parsed.errors.length > 0)
        throw new Error(`PoC観測用のモード判定成果物が不正です: ${parsed.errors.join("; ")}`);
    if (parsed.decision.mode !== "poc" || !parsed.decision.poc)
        throw new Error("poc-observation Evidenceはpoc stagingだけへ記録できます");
    if (!parsed.decision.baselineHeadSha)
        throw new Error("poc stagingにbaselineHeadShaがありません");
    return {
        declaration: parsed.decision.poc,
        baselineHeadSha: parsed.decision.baselineHeadSha,
    };
}
function pocDeclarationAtStaging(staging) {
    return pocContextAtStaging(staging).declaration;
}
function readPinnedRegularFile(file, label, maximumBytes) {
    const before = fs.lstatSync(file);
    if (before.isSymbolicLink() ||
        !before.isFile() ||
        before.nlink !== 1 ||
        before.size > maximumBytes ||
        fs.realpathSync(file) !== file)
        throw new Error(`${label}の通常file境界またはbyte上限が不正です`);
    const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
        const opened = fs.fstatSync(descriptor);
        if (!opened.isFile() ||
            opened.nlink !== 1 ||
            opened.size > maximumBytes ||
            opened.dev !== before.dev ||
            opened.ino !== before.ino)
            throw new Error(`${label}が検査後に差し替えられました`);
        const source = readDescriptor(descriptor, opened.size);
        const after = fs.fstatSync(descriptor);
        const named = fs.lstatSync(file);
        if (after.dev !== opened.dev ||
            after.ino !== opened.ino ||
            after.size !== opened.size ||
            after.nlink !== 1 ||
            named.isSymbolicLink() ||
            !named.isFile() ||
            named.dev !== opened.dev ||
            named.ino !== opened.ino)
            throw new Error(`${label}が読取中に変更されました`);
        return source;
    }
    finally {
        fs.closeSync(descriptor);
    }
}
function pinPocDirectory(directory) {
    if (process.platform !== "linux")
        throw new Error("PoC Evidenceの原子的publishにはLinuxが必要です");
    const resolved = path.resolve(directory);
    const descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fs.fstatSync(descriptor);
        const named = fs.lstatSync(resolved);
        if (!opened.isDirectory() ||
            named.isSymbolicLink() ||
            !named.isDirectory() ||
            opened.dev !== named.dev ||
            opened.ino !== named.ino ||
            fs.realpathSync(resolved) !== resolved)
            throw new Error(`PoC Evidence publish directoryが不正です: ${resolved}`);
        return {
            descriptor,
            directory: resolved,
            dev: opened.dev,
            ino: opened.ino,
        };
    }
    catch (error) {
        fs.closeSync(descriptor);
        throw error;
    }
}
function assertPinnedPocDirectory(pinned) {
    const opened = fs.fstatSync(pinned.descriptor);
    const named = fs.lstatSync(pinned.directory);
    if (!opened.isDirectory() ||
        named.isSymbolicLink() ||
        !named.isDirectory() ||
        opened.dev !== pinned.dev ||
        opened.ino !== pinned.ino ||
        named.dev !== pinned.dev ||
        named.ino !== pinned.ino ||
        fs.realpathSync(pinned.directory) !== pinned.directory)
        throw new Error("PoC Evidence publish directoryが実行中に差し替えられました");
}
function pinnedPocEntry(pinned, leaf) {
    if (leaf === "" || leaf.includes("/") || leaf.includes("\\"))
        throw new Error("PoC Evidence publish leafが不正です");
    return `/proc/self/fd/${pinned.descriptor}/${leaf}`;
}
export function inspectStoredPocObservationEvidence(stagingInput, headSha) {
    const staging = assertWorkflowStaging(stagingInput);
    const declaration = pocDeclarationAtStaging(staging);
    const artifact = pocObservationArtifact(headSha);
    const file = path.join(staging, artifact);
    if (!fs.existsSync(file))
        return {
            valid: false,
            exists: false,
            errors: [`${artifact}がありません`],
        };
    const checked = validatePocObservationEvidence({
        source: readPinnedRegularFile(file, "poc-observation Evidence", 256 * 1024).toString("utf8"),
        declaration,
        headSha,
    });
    return { ...checked, exists: true };
}
export function inspectCurrentPocJournalBinding(stagingInput, headSha, upToStep) {
    const staging = assertWorkflowStaging(stagingInput);
    const observation = inspectStoredPocObservationEvidence(staging, headSha);
    if (!observation.valid || !observation.evidence)
        return { valid: false, errors: observation.errors };
    const journal = readWorkflowJournal(staging);
    const errors = [...journal.errors];
    try {
        const context = pocContextAtStaging(staging);
        assertPocHeadChangeScope({
            repositoryRoot: path.resolve(staging, "../../../.."),
            baselineHeadSha: context.baselineHeadSha,
            headSha,
            fixtureRoot: context.declaration.fixture.root,
        });
    }
    catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
    }
    const binding = {
        headSha,
        evidenceDigest: observation.evidence.evidenceDigest,
    };
    for (const step of [9, 10, 11].filter((value) => value <= upToStep)) {
        const entry = [...journal.entries]
            .reverse()
            .find((item) => item.step === step);
        if (!entry || stableJson(entry.pocObservation) !== stableJson(binding))
            errors.push(`current HEADのPoC observation bindingが最新Step ${step}にありません`);
    }
    return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
export function assertPocDeliveryChangeScope(stagingInput, baseSha, headSha) {
    const staging = assertWorkflowStaging(stagingInput);
    const context = pocContextAtStaging(staging);
    return assertPocHeadChangeScope({
        repositoryRoot: path.resolve(staging, "../../../.."),
        baselineHeadSha: baseSha,
        headSha,
        fixtureRoot: context.declaration.fixture.root,
    });
}
export function validatePocObservationForStaging(input) {
    const staging = assertWorkflowStaging(input.staging);
    return validatePocObservationEvidence({
        source: input.source,
        declaration: pocDeclarationAtStaging(staging),
        headSha: input.headSha,
    });
}
function pinPocStaging(staging) {
    const recordFile = path.join(staging, STAGING_RECORD_FILE);
    const recordSource = fs.readFileSync(recordFile, "utf8");
    const record = readStoredStagingRecord(staging);
    const artifacts = listStagingArtifacts(staging);
    if (stableJson(artifacts) !== stableJson(record.artifacts) ||
        calculateStagingDigest(staging, artifacts) !== record.digest)
        throw new Error("PoC観測前のstaging artifact集合またはdigestが保存recordと一致しません");
    const artifactDigests = new Map(artifacts.map((relative) => [
        relative,
        sha256(fs.readFileSync(path.join(staging, relative))),
    ]));
    return {
        recordSource,
        recordDigest: record.digest,
        artifacts,
        artifactDigests,
    };
}
function assertPinnedPocStaging(staging, snapshot, publishedArtifact) {
    if (fs.readFileSync(path.join(staging, STAGING_RECORD_FILE), "utf8") !==
        snapshot.recordSource)
        throw new Error("PoC観測中にstaging recordが変更されました");
    const expectedArtifacts = publishedArtifact
        ? [...new Set([...snapshot.artifacts, publishedArtifact])].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
        : snapshot.artifacts;
    if (stableJson(listStagingArtifacts(staging)) !== stableJson(expectedArtifacts))
        throw new Error("PoC観測中にstaging artifact集合が変更されました");
    for (const relative of snapshot.artifacts) {
        if (relative === publishedArtifact)
            continue;
        const current = sha256(fs.readFileSync(path.join(staging, relative)));
        if (current !== snapshot.artifactDigests.get(relative))
            throw new Error(`PoC観測中にstaging artifactが変更されました: ${relative}`);
    }
}
function pocObservationTransactionPath(staging) {
    return path.join(path.dirname(staging), `.${path.basename(staging)}.poc-observation.transaction.json`);
}
function clearPocObservationTransaction(staging) {
    const marker = pocObservationTransactionPath(staging);
    if (fs.existsSync(marker))
        fs.unlinkSync(marker);
    fsyncDirectory(path.dirname(staging));
}
function writePocObservationTransaction(staging, snapshot, evidence) {
    if (snapshot.artifacts.length > 256 ||
        snapshot.artifacts.some((artifact) => Buffer.byteLength(artifact, "utf8") > 1024))
        throw new Error("PoC observation世代またはartifact数が上限を超えています");
    const temporary = `.${path.basename(staging)}.poc-observation.${evidence.headSha}.tmp`;
    const marker = {
        schemaVersion: POC_OBSERVATION_TRANSACTION_SCHEMA,
        headSha: evidence.headSha,
        artifact: pocObservationArtifact(evidence.headSha),
        evidenceDigest: evidence.evidenceDigest,
        temporary,
        artifactsBefore: snapshot.artifacts,
        stagingDigestBefore: snapshot.recordDigest,
    };
    const file = pocObservationTransactionPath(staging);
    if (fs.existsSync(file))
        throw new Error("未完了のPoC observation transactionがあります");
    const markerSource = `${stableJson(marker)}\n`;
    if (Buffer.byteLength(markerSource, "utf8") > 64 * 1024)
        throw new Error("PoC observation transaction markerが64KiB上限を超えます");
    writeFileAtomic(file, markerSource);
    fsyncFile(file);
    fsyncDirectory(path.dirname(staging));
    return path.join(path.dirname(staging), temporary);
}
function recoverPocObservationTransactionLocked(staging) {
    const markerFile = pocObservationTransactionPath(staging);
    if (!fs.existsSync(markerFile))
        return;
    const marker = parseJsonStrict(readPinnedRegularFile(markerFile, "PoC observation transaction marker", 64 * 1024).toString("utf8"), "PoC observation transaction");
    if (!isRecord(marker) ||
        marker.schemaVersion !== POC_OBSERVATION_TRANSACTION_SCHEMA ||
        !/^[a-f0-9]{40}$/u.test(String(marker.headSha ?? "")) ||
        marker.artifact !== pocObservationArtifact(String(marker.headSha)) ||
        !/^[a-f0-9]{64}$/u.test(String(marker.evidenceDigest ?? "")) ||
        marker.temporary !==
            `.${path.basename(staging)}.poc-observation.${String(marker.headSha)}.tmp` ||
        !/^[a-f0-9]{64}$/u.test(String(marker.stagingDigestBefore ?? "")) ||
        !Array.isArray(marker.artifactsBefore) ||
        !marker.artifactsBefore.every((item) => typeof item === "string"))
        throw new Error("PoC observation transaction markerが不正です");
    const artifact = marker.artifact;
    const before = [...marker.artifactsBefore];
    if (new Set(before).size !== before.length ||
        stableJson(before) !==
            stableJson([...before].sort((left, right) => left.localeCompare(right))) ||
        before.some((item) => item === "" ||
            path.isAbsolute(item) ||
            item.includes("\\") ||
            item.split("/").some((part) => part === ".." || part === ".git")))
        throw new Error("PoC observation transactionのartifactsBeforeが不正です");
    const temporary = path.join(path.dirname(staging), marker.temporary);
    const artifactFile = path.join(staging, artifact);
    if (fs.existsSync(temporary) && fs.existsSync(artifactFile)) {
        const temporaryStat = fs.lstatSync(temporary);
        const artifactStat = fs.lstatSync(artifactFile);
        if (temporaryStat.isSymbolicLink() ||
            artifactStat.isSymbolicLink() ||
            !temporaryStat.isFile() ||
            !artifactStat.isFile() ||
            temporaryStat.dev !== artifactStat.dev ||
            temporaryStat.ino !== artifactStat.ino ||
            temporaryStat.nlink !== 2 ||
            artifactStat.nlink !== 2)
            throw new Error("PoC observation transactionのtempとEvidenceが同一inodeではありません");
        fs.unlinkSync(temporary);
        fsyncDirectory(path.dirname(staging));
    }
    const removeTemporary = () => {
        if (!fs.existsSync(temporary))
            return;
        const stat = fs.lstatSync(temporary);
        if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1)
            throw new Error("PoC observation transaction tempが不正です");
        fs.unlinkSync(temporary);
        fsyncDirectory(path.dirname(staging));
    };
    const expectedAfter = [...new Set([...before, artifact])].sort((left, right) => left.localeCompare(right));
    const record = readStoredStagingRecord(staging);
    const inventory = listStagingArtifacts(staging);
    if (stableJson(record.artifacts) === stableJson(expectedAfter) &&
        stableJson(inventory) === stableJson(expectedAfter) &&
        calculateStagingDigest(staging, inventory) === record.digest) {
        const checked = inspectStoredPocObservationEvidence(staging, marker.headSha);
        if (!checked.valid ||
            checked.evidence?.evidenceDigest !== marker.evidenceDigest)
            throw new Error("完了済みPoC observation transactionのEvidenceが不正です");
        removeTemporary();
        clearPocObservationTransaction(staging);
        return;
    }
    if (stableJson(record.artifacts) !== stableJson(before) ||
        record.digest !== marker.stagingDigestBefore ||
        calculateStagingDigest(staging, before) !== record.digest)
        throw new Error("PoC observation transactionの開始前stagingが一致しません");
    if (stableJson(inventory) === stableJson(before)) {
        removeTemporary();
        clearPocObservationTransaction(staging);
        return;
    }
    if (stableJson(inventory) !== stableJson(expectedAfter))
        throw new Error("PoC observation transaction中のartifact集合が不正です");
    const checked = inspectStoredPocObservationEvidence(staging, marker.headSha);
    if (!checked.valid ||
        checked.evidence?.evidenceDigest !== marker.evidenceDigest)
        throw new Error("PoC observation transactionのEvidenceが不正です");
    refreshStoredStagingDigest(staging);
    fsyncFile(path.join(staging, STAGING_RECORD_FILE));
    fsyncDirectory(staging);
    removeTemporary();
    clearPocObservationTransaction(staging);
}
function storeGeneratedPocObservationEvidence(input) {
    const staging = assertWorkflowStaging(input.staging);
    return withStagingMutationLock(staging, () => {
        assertPinnedPocStaging(staging, input.snapshot);
        const declaration = pocDeclarationAtStaging(staging);
        const checked = validatePocObservationEvidence({
            source: input.source,
            declaration,
            headSha: input.headSha,
        });
        if (!checked.valid || !checked.evidence)
            throw new Error(`poc-observation Evidenceを拒否しました: ${checked.errors.join("; ")}`);
        const artifact = pocObservationArtifact(input.headSha);
        const directory = path.join(staging, POC_OBSERVATION_DIRECTORY);
        if (!fs.existsSync(directory)) {
            fs.mkdirSync(directory, { mode: 0o700 });
            fsyncDirectory(staging);
        }
        const directoryStat = fs.lstatSync(directory);
        if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory())
            throw new Error("poc-observationsはsymlinkでない通常directoryが必要です");
        const file = path.join(staging, artifact);
        const canonical = `${stableJson(checked.evidence)}\n`;
        if (fs.existsSync(file)) {
            const current = readPinnedRegularFile(file, "poc-observation Evidence", 256 * 1024).toString("utf8");
            if (current !== canonical)
                throw new Error("同一HEADのpoc-observation Evidenceは置換できません");
            throw new Error("同一HEADのpoc-observation Evidenceは新規publishできません");
        }
        const temporary = writePocObservationTransaction(staging, input.snapshot, checked.evidence);
        const sourceDirectory = pinPocDirectory(path.dirname(staging));
        const targetDirectory = pinPocDirectory(directory);
        let descriptor;
        try {
            descriptor = fs.openSync(pinnedPocEntry(sourceDirectory, path.basename(temporary)), fs.constants.O_WRONLY |
                fs.constants.O_CREAT |
                fs.constants.O_EXCL |
                fs.constants.O_NOFOLLOW, 0o600);
            writeDescriptorFully(descriptor, Buffer.from(canonical));
            fs.fsyncSync(descriptor);
            fs.closeSync(descriptor);
            descriptor = undefined;
            assertPinnedPocDirectory(sourceDirectory);
            assertPinnedPocDirectory(targetDirectory);
            fs.renameSync(pinnedPocEntry(sourceDirectory, path.basename(temporary)), pinnedPocEntry(targetDirectory, path.basename(file)));
            fs.fsyncSync(targetDirectory.descriptor);
            fs.fsyncSync(sourceDirectory.descriptor);
            fsyncDirectory(staging);
            assertPinnedPocDirectory(sourceDirectory);
            assertPinnedPocDirectory(targetDirectory);
        }
        finally {
            if (descriptor !== undefined)
                fs.closeSync(descriptor);
            fs.closeSync(targetDirectory.descriptor);
            fs.closeSync(sourceDirectory.descriptor);
        }
        assertPinnedPocStaging(staging, input.snapshot, artifact);
        const reread = inspectStoredPocObservationEvidence(staging, input.headSha);
        if (!reread.valid ||
            reread.evidence?.evidenceDigest !== checked.evidence.evidenceDigest)
            throw new Error(`poc-observation Evidenceの書き込み後検証に失敗しました: ${reread.errors.join("; ")}`);
        const stored = refreshStoredStagingDigest(staging);
        fsyncFile(path.join(staging, STAGING_RECORD_FILE));
        fsyncDirectory(staging);
        clearPocObservationTransaction(staging);
        return {
            evidence: checked.evidence,
            evidenceDigest: checked.evidence.evidenceDigest,
            stagingDigest: stored.digest,
        };
    });
}
export function executePocObservation(input) {
    const staging = assertWorkflowStaging(input.staging);
    return withStagingMutationLock(staging, () => {
        recoverPendingJournalTransactionLocked(staging);
        recoverPocObservationTransactionLocked(staging);
        const stagingSnapshot = pinPocStaging(staging);
        const journal = readWorkflowJournal(staging);
        if (journal.errors.length > 0 ||
            journal.entries.some(({ step }) => step === 11))
            throw new Error("Step 11記録後は新しいPoC observationを生成できません");
        const deliveryFile = path.join(staging, DELIVERY_STATE_FILE);
        if (fs.existsSync(deliveryFile)) {
            const delivery = parseDeliveryState(fs.readFileSync(deliveryFile, "utf8"));
            if (delivery.state === "merge-observed" ||
                delivery.state === "step11-recorded")
                throw new Error("terminal delivery state後はPoC observationを生成できません");
        }
        const existingArtifact = path.join(staging, pocObservationArtifact(input.headSha));
        if (fs.existsSync(existingArtifact)) {
            const existing = inspectStoredPocObservationEvidence(staging, input.headSha);
            if (!existing.valid || !existing.evidence)
                throw new Error(`既存PoC observation Evidenceが不正です: ${existing.errors.join("; ")}`);
            const record = readStoredStagingRecord(staging);
            return {
                passed: true,
                evidence: existing.evidence,
                evidenceDigest: existing.evidence.evidenceDigest,
                stagingDigest: record.digest,
            };
        }
        const context = pocContextAtStaging(staging);
        const evidence = executePocSandboxObservation({
            repositoryRoot: path.resolve(staging, "../../../.."),
            declaration: context.declaration,
            baselineHeadSha: context.baselineHeadSha,
            headSha: input.headSha,
            observedAt: input.observedAt,
        });
        assertPinnedPocStaging(staging, stagingSnapshot);
        const stored = storeGeneratedPocObservationEvidence({
            staging,
            source: `${stableJson(evidence)}\n`,
            headSha: input.headSha,
            snapshot: stagingSnapshot,
        });
        return { passed: true, ...stored };
    });
}
export function inspectWorkflowStaging(staging, upToStep) {
    const resolved = assertWorkflowStaging(staging);
    const record = readStoredStagingRecord(resolved);
    const modeFile = path.join(resolved, MODE_DECISION_FILE);
    const journalFile = path.join(resolved, STEP_JOURNAL_FILE);
    return inspectWorkflowStagingArtifacts({
        staging: resolved,
        mode: record.mode,
        state: record.state,
        ...(fs.existsSync(modeFile)
            ? { modeDecisionSource: fs.readFileSync(modeFile, "utf8") }
            : {}),
        ...(fs.existsSync(journalFile)
            ? { journalSource: fs.readFileSync(journalFile, "utf8") }
            : {}),
        ...(upToStep === undefined ? {} : { upToStep }),
    });
}
export function workflowStep(step) {
    return WORKFLOW_STEPS.find((definition) => definition.step === step);
}
function escapedCell(value) {
    return value
        .replaceAll("|", "｜")
        .replace(/[\r\n]+/gu, " ")
        .trim();
}
function assertRegularContainedFile(staging, file) {
    const absolute = path.join(staging, file);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isFile())
        throw new Error(`昇格元成果物はsymlinkでない通常fileが必要です: ${file}`);
    if (fs.realpathSync(absolute) !== absolute)
        throw new Error(`昇格元成果物にsymlink祖先を使用できません: ${file}`);
}
function appendEvidence(current, evidence) {
    const existing = current?.evidence?.trim();
    return {
        answer: false,
        evidence: existing ? `${existing}; ${evidence}` : evidence,
    };
}
function promotedModeDecision(input) {
    const answers = Object.fromEntries(Object.entries(input.decision.answers).map(([id, answer]) => [
        id,
        { ...answer },
    ]));
    const poc = input.decision.poc
        ? {
            ...input.decision.poc,
            fixture: {
                ...input.decision.poc.fixture,
                runner: { ...input.decision.poc.fixture.runner },
            },
            useCases: input.decision.poc.useCases.map((item) => ({ ...item })),
            scenarios: input.decision.poc.scenarios.map((item) => ({ ...item })),
            observables: input.decision.poc.observables.map((item) => ({
                ...item,
            })),
            highRisk: input.decision.poc.highRisk.map((risk) => ({ ...risk })),
        }
        : undefined;
    const questionByDisqualifier = new Map(MODE_QUESTIONS.map(({ id, disqualifier }) => [disqualifier, id]));
    const quickQuestion = (disqualifier) => questionByDisqualifier.get(disqualifier) ??
        (["personal-data", "confidential-data", "external-exposure"].includes(disqualifier)
            ? "Q-03"
            : undefined);
    const setPocRisk = (id, evidence) => {
        if (!poc)
            throw new Error("PoC昇格には元のPoC宣言が必要です");
        const existing = poc.highRisk.find((risk) => risk.id === id);
        if (existing) {
            existing.present = true;
            existing.evidence = `${existing.evidence}; ${evidence}`;
        }
        else
            poc.highRisk.push({ id, present: true, evidence });
    };
    if (input.previousMode === "quick") {
        for (const disqualifier of input.discovery.modeDisqualifiers) {
            const question = quickQuestion(disqualifier.id);
            if (!question)
                throw new Error(`quick昇格理由をQ-01〜Q-08へ写像できません: ${disqualifier.id}`);
            answers[question] = appendEvidence(answers[question], `実装中発見 ${disqualifier.id}: ${disqualifier.evidence}`);
        }
        if (input.discovery.expandsSecurityBoundary)
            answers["Q-03"] = appendEvidence(answers["Q-03"], "実装中発見でsecurity境界の拡大を確認した");
        if (input.discovery.introducesIrreversibleOperation)
            answers["Q-06"] = appendEvidence(answers["Q-06"], "実装中発見で不可逆操作の導入を確認した");
    }
    else {
        for (const disqualifier of input.discovery.modeDisqualifiers)
            setPocRisk(disqualifier.id, `実装中発見: ${disqualifier.evidence}`);
        if (input.discovery.expandsSecurityBoundary)
            setPocRisk("external-exposure", "実装中発見でsecurity境界の拡大を確認した");
        if (input.discovery.introducesIrreversibleOperation)
            setPocRisk("irreversible-operation", "実装中発見で不可逆操作の導入を確認した");
    }
    const rendered = renderModeDecision({
        requestedMode: input.decision.requestedMode,
        answers,
        decidedAt: input.promotedAt,
        ...(poc ? { poc } : {}),
        changedFiles: input.decision.changedFiles,
    });
    const parsed = parseModeDecision(rendered);
    if (!parsed.decision || parsed.decision.mode !== "full")
        throw new Error(`昇格後のモード判定をfullとして再現できません: ${parsed.errors.join("; ")}`);
    return rendered;
}
function tableValue(source, label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`^\\|[ \\t]*${escaped}[ \\t]*\\|[ \\t]*([^|]+?)[ \\t]*\\|[ \\t]*$`, "mu")
        .exec(source)?.[1]
        ?.trim();
}
function replaceTableValue(source, label, value) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return source.replace(new RegExp(`^\\|[ \\t]*${escaped}[ \\t]*\\|[^\\n|]+\\|[ \\t]*$`, "mu"), `| ${label} | ${escapedCell(value)} |`);
}
function promotedRequirementDocument(input) {
    let source = fs.readFileSync(path.join(issueTemplateRoot, "00_要求定義_full.md"), "utf8");
    for (const label of ["件名", "仕様の所有箇所"]) {
        const value = tableValue(input.previousSource, label);
        if (value)
            source = replaceTableValue(source, label, value);
    }
    source = replaceTableValue(source, "正本", input.tracker ?? "未同期（full昇格後にStep 4/8で同期する）");
    source = replaceTableValue(source, "作成・更新日", input.promotedAt);
    for (const [id, answer] of Object.entries(input.decision.answers)) {
        const renderedAnswer = answer.answer === true
            ? "true"
            : answer.answer === false
                ? "false"
                : "unknown";
        source = source.replace(new RegExp(`^\\|[ \\t]*${id}[ \\t]*\\|[^\\n|]+\\|[^\\n|]+\\|[ \\t]*$`, "mu"), `| ${id} | ${renderedAnswer} | ${escapedCell(answer.evidence ?? "根拠なし")} |`);
    }
    const note = `> ${input.previousMode}からfullへ単調昇格した。昇格前の集約契約は\`${input.backupArtifact}\`に保持し、変更された契約部分だけをこの文書と01〜03へ再確定する。`;
    return source.replace("\n\n## 0. 管理情報", `\n\n${note}\n\n## 0. 管理情報`);
}
function parsePromotionTransaction(source) {
    const value = parseJsonStrict(source, PROMOTION_TRANSACTION_FILE);
    if (!isRecord(value))
        throw new Error("full昇格transactionが不正です");
    const fields = new Set([
        "schemaVersion",
        "pid",
        "previousMode",
        "originalRecordSource",
        "originalDecisionSource",
        "originalRequirementSource",
        "absentArtifacts",
    ]);
    const unknown = Object.keys(value).filter((field) => !fields.has(field));
    const missing = [...fields].filter((field) => !(field in value));
    if (unknown.length > 0 || missing.length > 0)
        throw new Error("full昇格transactionのfield集合が不正です");
    if (value.schemaVersion !== "agent-skill-chain/full-promotion-transaction/v1" ||
        !Number.isInteger(value.pid) ||
        value.pid <= 0 ||
        (value.previousMode !== "quick" && value.previousMode !== "poc") ||
        typeof value.originalRecordSource !== "string" ||
        typeof value.originalDecisionSource !== "string" ||
        typeof value.originalRequirementSource !== "string" ||
        !Array.isArray(value.absentArtifacts) ||
        !value.absentArtifacts.every((item) => typeof item === "string"))
        throw new Error("full昇格transactionの値が不正です");
    const originalRecord = parseJsonStrict(value.originalRecordSource, "full昇格transaction.originalRecordSource");
    const originalDecision = parseModeDecision(value.originalDecisionSource);
    if (!isRecord(originalRecord) ||
        originalRecord.schemaVersion !== "agent-skill-chain/staging-record/v1" ||
        originalRecord.mode !== value.previousMode ||
        !originalDecision.decision ||
        originalDecision.decision.mode !== value.previousMode)
        throw new Error("full昇格transactionの復元元契約が不正です");
    const allowed = new Set([
        ...FULL_PLAN_ARTIFACTS,
        `00_要求定義_昇格前_${value.previousMode}.md`,
        `00_モード判定_昇格前_${value.previousMode}.json`,
        PROMOTION_DISCOVERY_FILE,
    ]);
    const absentArtifacts = [...value.absentArtifacts];
    if (new Set(absentArtifacts).size !== absentArtifacts.length ||
        absentArtifacts.some((artifact) => !allowed.has(artifact)))
        throw new Error("full昇格transactionの復旧対象が不正です");
    return {
        schemaVersion: value.schemaVersion,
        pid: value.pid,
        previousMode: value.previousMode,
        originalRecordSource: value.originalRecordSource,
        originalDecisionSource: value.originalDecisionSource,
        originalRequirementSource: value.originalRequirementSource,
        absentArtifacts,
    };
}
function parsePersistedPromotionDiscovery(source) {
    const value = parseJsonStrict(source, PROMOTION_DISCOVERY_FILE);
    if (!isRecord(value))
        throw new Error("full昇格Evidenceがobjectではありません");
    const expected = new Set([
        "schemaVersion",
        "promotedAt",
        "previousMode",
        "selectedDisposition",
        "discovery",
        "assessment",
    ]);
    if (Object.keys(value).some((field) => !expected.has(field)) ||
        [...expected].some((field) => !(field in value)))
        throw new Error("full昇格Evidenceのfield集合が不正です");
    if (value.schemaVersion !== "agent-skill-chain/implementation-discovery/v1" ||
        (value.previousMode !== "quick" && value.previousMode !== "poc") ||
        value.selectedDisposition !== "promote-to-full" ||
        typeof value.promotedAt !== "string" ||
        !Number.isFinite(Date.parse(value.promotedAt)) ||
        new Date(Date.parse(value.promotedAt)).toISOString() !== value.promotedAt)
        throw new Error("full昇格Evidenceの管理値が不正です");
    const discovery = parseImplementationDiscoveryInput(value.discovery);
    if (discovery.workflowMode !== value.previousMode)
        throw new Error("full昇格EvidenceのpreviousModeと発見modeが一致しません");
    const assessment = assessImplementationDiscovery(discovery);
    const promotable = (value.previousMode === "quick" &&
        assessment.disposition === "promote-to-full") ||
        (value.previousMode === "poc" &&
            assessment.disposition === "stop-or-promote-full");
    if (!promotable || stableJson(value.assessment) !== stableJson(assessment))
        throw new Error("full昇格Evidenceから昇格判定を再現できません");
    return {
        previousMode: value.previousMode,
        promotedAt: value.promotedAt,
        discovery,
        assessment,
    };
}
function processIsAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return !(error instanceof Error &&
            "code" in error &&
            error.code === "ESRCH");
    }
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
function writeExclusiveAtomic(destination, source) {
    const temporary = path.join(path.dirname(path.dirname(destination)), `.full-promotion-${path.basename(path.dirname(destination))}-${process.pid}-${crypto.randomBytes(6).toString("hex")}.tmp`);
    fs.writeFileSync(temporary, source, { flag: "wx", mode: 0o600 });
    try {
        const descriptor = fs.openSync(temporary, "r");
        try {
            fs.fsyncSync(descriptor);
        }
        finally {
            fs.closeSync(descriptor);
        }
        fs.linkSync(temporary, destination);
        fsyncDirectory(path.dirname(destination));
    }
    finally {
        if (fs.existsSync(temporary))
            fs.unlinkSync(temporary);
    }
}
function recoverPromotionTransaction(staging) {
    const transactionPath = path.join(staging, PROMOTION_TRANSACTION_FILE);
    const transaction = parsePromotionTransaction(fs.readFileSync(transactionPath, "utf8"));
    writeFileAtomic(path.join(staging, "00_要求定義.md"), transaction.originalRequirementSource);
    writeFileAtomic(path.join(staging, MODE_DECISION_FILE), transaction.originalDecisionSource);
    writeFileAtomic(path.join(staging, STAGING_RECORD_FILE), transaction.originalRecordSource, { temporaryDirectory: path.dirname(staging) });
    for (const artifact of transaction.absentArtifacts) {
        const target = path.join(staging, artifact);
        if (!fs.existsSync(target))
            continue;
        const stat = fs.lstatSync(target);
        if (stat.isSymbolicLink() || !stat.isFile())
            throw new Error(`full昇格rollback対象が通常fileではありません: ${artifact}`);
        fs.unlinkSync(target);
    }
    for (const entry of fs.readdirSync(staging))
        if (entry.includes(`.tmp-${transaction.pid}-`)) {
            const target = path.join(staging, entry);
            const stat = fs.lstatSync(target);
            if (!stat.isSymbolicLink() && stat.isFile())
                fs.unlinkSync(target);
        }
    fs.unlinkSync(transactionPath);
    const restored = readStoredStagingRecord(staging);
    if (restored.mode !== transaction.previousMode)
        throw new Error("full昇格transactionのrollback確認に失敗しました");
}
function promotionResult(input) {
    if (input.promoted.mode !== "full" ||
        (input.promoted.state !== "local-active" &&
            input.promoted.state !== "promotion-active"))
        throw new Error("full昇格後のstaging状態が不正です");
    return {
        previousMode: input.previousMode,
        mode: "full",
        state: input.promoted.state,
        tracker: input.promoted.tracker,
        backupArtifact: `00_要求定義_昇格前_${input.previousMode}.md`,
        modeDecisionBackupArtifact: `00_モード判定_昇格前_${input.previousMode}.json`,
        discoveryArtifact: PROMOTION_DISCOVERY_FILE,
        affectedArtifacts: Object.freeze([
            "00_要求定義.md",
            ...FULL_PLAN_ARTIFACTS,
        ]),
        nextSteps: Object.freeze([2, 3, 4, 5, 6, 7, 8, 9, 10]),
        assessment: input.assessment,
    };
}
export function previewWorkflowStagingPromotion(input) {
    const staging = assertWorkflowStaging(input.staging);
    const deliveryStatePath = path.join(staging, DELIVERY_STATE_FILE);
    if (fs.existsSync(deliveryStatePath)) {
        assertRegularContainedFile(staging, DELIVERY_STATE_FILE);
        const delivery = parseDeliveryState(fs.readFileSync(deliveryStatePath, "utf8"));
        throw new Error(`delivery開始後のstagingはfull昇格できません: state=${delivery.state}`);
    }
    const current = readStoredStagingRecord(staging);
    if (current.mode === "full")
        throw new Error("stagingは既にfullであり、再昇格できません");
    if (input.discovery.workflowMode !== current.mode)
        throw new Error(`発見入力mode ${input.discovery.workflowMode}がstaging mode ${current.mode}と一致しません`);
    const artifacts = listStagingArtifacts(staging);
    if (stableJson(artifacts) !== stableJson(current.artifacts) ||
        calculateStagingDigest(staging, artifacts) !== current.digest)
        throw new Error("昇格前の成果物一覧またはdigestがstaging記録と一致しません");
    const assessment = assessImplementationDiscovery(input.discovery);
    const promotable = (current.mode === "quick" &&
        assessment.disposition === "promote-to-full") ||
        (current.mode === "poc" &&
            assessment.disposition === "stop-or-promote-full");
    if (!promotable)
        throw new Error(`実装中発見の判定${assessment.disposition}はfull昇格を要求していません`);
    return {
        state: "preview",
        operation: "promote-full",
        previousMode: current.mode,
        targetMode: "full",
        tracker: current.tracker,
        affectedArtifacts: Object.freeze([
            "00_要求定義.md",
            ...FULL_PLAN_ARTIFACTS,
        ]),
        assessment,
        next: "内容を確認し、適用する場合は同じ入力で--applyを指定してください",
    };
}
/**
 * 実装中発見のpure assessmentを、同じIssue staging上の耐久的なfull昇格へ適用する。
 * PoCではこのcommandの明示実行自体を「停止ではなくfull昇格を選んだ」証拠とする。
 */
export function promoteWorkflowStagingToFull(input) {
    const staging = assertWorkflowStaging(input.staging);
    return withStagingMutationLock(staging, () => promoteWorkflowStagingToFullLocked({ ...input, staging }));
}
function promoteWorkflowStagingToFullLocked(input) {
    const staging = assertWorkflowStaging(input.staging);
    recoverPendingJournalTransactionLocked(staging);
    recoverPocObservationTransactionLocked(staging);
    const deliveryStatePath = path.join(staging, DELIVERY_STATE_FILE);
    if (fs.existsSync(deliveryStatePath)) {
        assertRegularContainedFile(staging, DELIVERY_STATE_FILE);
        const delivery = parseDeliveryState(fs.readFileSync(deliveryStatePath, "utf8"));
        throw new Error(`delivery開始後のstagingはfull昇格できません: state=${delivery.state}`);
    }
    const transactionPath = path.join(staging, PROMOTION_TRANSACTION_FILE);
    if (fs.existsSync(transactionPath)) {
        assertRegularContainedFile(staging, PROMOTION_TRANSACTION_FILE);
        const pending = parsePromotionTransaction(fs.readFileSync(transactionPath, "utf8"));
        if (pending.pid !== process.pid && processIsAlive(pending.pid))
            throw new Error(`別process（pid=${pending.pid}）がfull昇格を実行中です`);
        recoverPromotionTransaction(staging);
    }
    const recordPath = path.join(staging, STAGING_RECORD_FILE);
    const decisionPath = path.join(staging, MODE_DECISION_FILE);
    for (const file of [
        STAGING_RECORD_FILE,
        MODE_DECISION_FILE,
        "00_要求定義.md",
        STEP_JOURNAL_FILE,
    ])
        assertRegularContainedFile(staging, file);
    const recoveredRecord = readStoredStagingRecord(staging);
    if (recoveredRecord.mode === "full") {
        const actualArtifacts = listStagingArtifacts(staging);
        if (stableJson(actualArtifacts) !== stableJson(recoveredRecord.artifacts) ||
            calculateStagingDigest(staging, actualArtifacts) !==
                recoveredRecord.digest)
            throw new Error("commit済みfull昇格の成果物またはdigestが一致しません");
        const discoveryPath = path.join(staging, PROMOTION_DISCOVERY_FILE);
        if (!fs.existsSync(discoveryPath))
            throw new Error("stagingは既にfullであり、再昇格できません");
        assertRegularContainedFile(staging, PROMOTION_DISCOVERY_FILE);
        const persisted = parsePersistedPromotionDiscovery(fs.readFileSync(discoveryPath, "utf8"));
        if (stableJson(persisted.discovery) !== stableJson(input.discovery))
            throw new Error("再実行した発見入力が永続化済み昇格Evidenceと一致しません");
        const backupArtifact = `00_モード判定_昇格前_${persisted.previousMode}.json`;
        assertRegularContainedFile(staging, backupArtifact);
        const backupDecision = parseModeDecision(fs.readFileSync(path.join(staging, backupArtifact), "utf8"));
        const canonicalDecision = parseModeDecision(fs.readFileSync(decisionPath, "utf8"));
        if (!backupDecision.decision ||
            backupDecision.decision.mode !== persisted.previousMode ||
            !canonicalDecision.decision ||
            canonicalDecision.decision.mode !== "full" ||
            canonicalDecision.decision.requestedMode !==
                backupDecision.decision.requestedMode)
            throw new Error("永続化済み昇格のモード判定履歴を再現できません");
        return promotionResult({
            previousMode: persisted.previousMode,
            promoted: recoveredRecord,
            assessment: persisted.assessment,
        });
    }
    const originalRecordSource = fs.readFileSync(recordPath, "utf8");
    const originalDecisionSource = fs.readFileSync(decisionPath, "utf8");
    const current = readStoredStagingRecord(staging);
    if (current.mode === "full")
        throw new Error("stagingは既にfullであり、再昇格できません");
    if (input.discovery.workflowMode !== current.mode)
        throw new Error(`発見入力mode ${input.discovery.workflowMode}がstaging mode ${current.mode}と一致しません`);
    const parsedDecision = parseModeDecision(originalDecisionSource);
    if (!parsedDecision.decision || parsedDecision.errors.length > 0)
        throw new Error(`昇格前のモード判定成果物が不正です: ${parsedDecision.errors.join("; ")}`);
    if (parsedDecision.decision.mode !== current.mode)
        throw new Error("昇格前のモード判定成果物とstaging modeが一致しません");
    const actualArtifacts = listStagingArtifacts(staging);
    if (stableJson(actualArtifacts) !== stableJson(current.artifacts))
        throw new Error("昇格前の成果物一覧がstaging記録と一致しません");
    if (calculateStagingDigest(staging, actualArtifacts) !== current.digest)
        throw new Error("昇格前のcontent digestがstaging記録と一致しません");
    const assessment = assessImplementationDiscovery(input.discovery);
    const promotable = (current.mode === "quick" &&
        assessment.disposition === "promote-to-full") ||
        (current.mode === "poc" &&
            assessment.disposition === "stop-or-promote-full");
    if (!promotable)
        throw new Error(`実装中発見の判定${assessment.disposition}はfull昇格を要求していません`);
    const previousRequirementPath = path.join(staging, "00_要求定義.md");
    const previousRequirementSource = fs.readFileSync(previousRequirementPath, "utf8");
    const backupArtifact = `00_要求定義_昇格前_${current.mode}.md`;
    const backupPath = path.join(staging, backupArtifact);
    const modeDecisionBackupArtifact = `00_モード判定_昇格前_${current.mode}.json`;
    const modeDecisionBackupPath = path.join(staging, modeDecisionBackupArtifact);
    const discoveryPath = path.join(staging, PROMOTION_DISCOVERY_FILE);
    for (const target of [backupPath, modeDecisionBackupPath, discoveryPath])
        if (fs.existsSync(target))
            throw new Error(`昇格成果物が既に存在するため上書きしません: ${target}`);
    const fullDecision = promotedModeDecision({
        previousMode: current.mode,
        decision: parsedDecision.decision,
        discovery: input.discovery,
        promotedAt: input.promotedAt,
    });
    const parsedFullDecision = parseModeDecision(fullDecision);
    if (!parsedFullDecision.decision)
        throw new Error(parsedFullDecision.errors.join("; "));
    const promotedRequirement = promotedRequirementDocument({
        previousMode: current.mode,
        previousSource: previousRequirementSource,
        tracker: current.tracker,
        promotedAt: input.promotedAt,
        decision: parsedFullDecision.decision,
        backupArtifact,
    });
    const newArtifacts = [
        backupArtifact,
        modeDecisionBackupArtifact,
        PROMOTION_DISCOVERY_FILE,
        ...FULL_PLAN_ARTIFACTS,
    ];
    const absentArtifacts = newArtifacts.filter((artifact) => !fs.existsSync(path.join(staging, artifact)));
    const transaction = {
        schemaVersion: "agent-skill-chain/full-promotion-transaction/v1",
        pid: process.pid,
        previousMode: current.mode,
        originalRecordSource,
        originalDecisionSource,
        originalRequirementSource: previousRequirementSource,
        absentArtifacts,
    };
    writeExclusiveAtomic(transactionPath, `${stableJson(transaction)}\n`);
    let committed = false;
    try {
        if (fs.readFileSync(recordPath, "utf8") !== originalRecordSource ||
            fs.readFileSync(decisionPath, "utf8") !== originalDecisionSource ||
            fs.readFileSync(previousRequirementPath, "utf8") !==
                previousRequirementSource)
            throw new Error("昇格適用直前にstagingのmode状態が変化しました");
        const lockedArtifacts = listStagingArtifacts(staging).filter((artifact) => artifact !== PROMOTION_TRANSACTION_FILE);
        if (stableJson(lockedArtifacts) !== stableJson(current.artifacts) ||
            calculateStagingDigest(staging, lockedArtifacts) !== current.digest)
            throw new Error("昇格lock取得後にstaging成果物が変化しました");
        writeFileAtomic(backupPath, previousRequirementSource);
        writeFileAtomic(modeDecisionBackupPath, originalDecisionSource);
        writeFileAtomic(previousRequirementPath, promotedRequirement);
        for (const artifact of FULL_PLAN_ARTIFACTS) {
            const destination = path.join(staging, artifact);
            if (fs.existsSync(destination)) {
                const stat = fs.lstatSync(destination);
                if (stat.isSymbolicLink() || !stat.isFile())
                    throw new Error(`full成果物が通常fileではありません: ${artifact}`);
                continue;
            }
            fs.copyFileSync(path.join(issueTemplateRoot, artifact), destination, fs.constants.COPYFILE_EXCL);
        }
        writeFileAtomic(discoveryPath, `${stableJson({
            schemaVersion: "agent-skill-chain/implementation-discovery/v1",
            promotedAt: input.promotedAt,
            previousMode: current.mode,
            selectedDisposition: "promote-to-full",
            discovery: input.discovery,
            assessment,
        })}\n`);
        writeFileAtomic(decisionPath, fullDecision);
        const promoted = promoteStoredStagingModeToFull(staging);
        if (!promoted.artifacts.includes(PROMOTION_TRANSACTION_FILE))
            throw new Error("full昇格記録にtransaction markerがありません");
        const finalized = finalizeStoredStagingPromotion(staging);
        for (const artifact of finalized.artifacts)
            fsyncFile(path.join(staging, artifact));
        fsyncFile(recordPath);
        fsyncDirectory(staging);
        fs.unlinkSync(transactionPath);
        committed = true;
        fsyncDirectory(staging);
        const verifiedArtifacts = listStagingArtifacts(staging);
        if (stableJson(verifiedArtifacts) !== stableJson(finalized.artifacts) ||
            calculateStagingDigest(staging, verifiedArtifacts) !== finalized.digest)
            throw new Error("full昇格commit後の成果物またはdigestが一致しません");
        return promotionResult({
            previousMode: current.mode,
            promoted: finalized,
            assessment,
        });
    }
    catch (error) {
        let rollbackError;
        if (!committed && fs.existsSync(transactionPath)) {
            try {
                recoverPromotionTransaction(staging);
            }
            catch (rollback) {
                rollbackError = rollback;
            }
        }
        if (rollbackError)
            throw new Error(`full昇格に失敗しrollbackも完了できませんでした: ${error instanceof Error ? error.message : String(error)}; rollback=${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`, { cause: error });
        throw error;
    }
}
export function resolvePullRequestStaging(input) {
    const trackerMatches = (staging) => {
        const tracker = readStoredStagingRecord(staging).tracker;
        const matched = typeof tracker === "string"
            ? /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/([1-9]\d*)$/iu.exec(tracker)
            : null;
        return Boolean(matched &&
            `${matched[1]}/${matched[2]}`.toLowerCase() ===
                input.repository.toLowerCase() &&
            Number(matched[3]) === input.issue);
    };
    const issuesRoot = path.join(path.resolve(input.root), ".agent-skill-chain", "tmp", "issues");
    if (input.staging) {
        const requested = path.resolve(input.staging);
        if (path.dirname(requested) !== issuesRoot)
            throw new Error("明示stagingは対象rootの.agent-skill-chain/tmp/issues/直下にあるdirectoryが必要です");
        const staging = assertWorkflowStaging(requested);
        if (!trackerMatches(staging))
            throw new Error("明示stagingのtrackerが対象repository・Issueと一致しません");
        return staging;
    }
    if (!fs.existsSync(issuesRoot))
        throw new Error("PR作成に必要なIssue staging directoryがありません");
    const candidates = fs
        .readdirSync(issuesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(issuesRoot, entry.name))
        .filter((candidate) => {
        try {
            return trackerMatches(candidate);
        }
        catch {
            return false;
        }
    });
    if (candidates.length !== 1)
        throw new Error("PR作成対象のIssue stagingを一意に解決できません。--stagingで明示してください");
    return assertWorkflowStaging(candidates[0]);
}
//# sourceMappingURL=workflow-journal.js.map