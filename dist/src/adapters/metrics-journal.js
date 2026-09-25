import fs from "node:fs";
import path from "node:path";
import { assertWorkflowStaging, readWorkflowJournal, } from "./workflow-journal.js";
import { withStagingMutationLock } from "../domain/staging.js";
import { stagingRepositoryRoot } from "../domain/staging-layout.js";
import { computeEventDurationsMs, computeMetricsWindowMs, computeReviewRounds, computeStepDurationsMs, computeSupportArtifactSplit, parseMetricsEventLine, parseMetricsEventLog, validateNextMetricsEvent, } from "../domain/metrics.js";
import { parseReviewSessionState } from "../domain/review-convergence.js";
import { writeFileAtomic } from "../lib/atomic.js";
import { parseJsonStrict } from "../lib/security.js";
/** staging配下、`journal/steps.jsonl`と同じ`journal/`directoryへ置く（02 §4.1）。 */
export const METRICS_EVENT_LOG_FILE = "journal/metrics-events.jsonl";
/** `.agent-skill-chain/metrics/`はdocs/specs/14_開発・品質/00_ディレクトリ構成.mdが既に予約するrepository-root相対の実行時領域。 */
export const METRICS_OUTPUT_DIRECTORY = ".agent-skill-chain/metrics";
function assertRegularMetricsLogPath(logPath) {
    const directory = path.dirname(logPath);
    const directoryStat = fs.lstatSync(directory);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory())
        throw new Error("metrics events log directoryはsymlinkでない通常directoryが必要です");
    if (fs.realpathSync(directory) !== directory)
        throw new Error("metrics events log directoryにsymlink祖先を使用できません");
    if (!fs.existsSync(logPath))
        return;
    const stat = fs.lstatSync(logPath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1)
        throw new Error("metrics events logはsymlink・hardlinkでない通常fileが必要です");
    if (fs.realpathSync(logPath) !== logPath)
        throw new Error("metrics events logにsymlink祖先を使用できません");
}
export function readMetricsEventLog(staging) {
    const resolved = assertWorkflowStaging(staging);
    const logPath = path.join(resolved, METRICS_EVENT_LOG_FILE);
    if (!fs.existsSync(logPath))
        return { entries: [], errors: [], source: "" };
    assertRegularMetricsLogPath(logPath);
    const source = fs.readFileSync(logPath, "utf8");
    const parsed = parseMetricsEventLog(source);
    return { ...parsed, source };
}
/**
 * FR-1482-03。`journal/metrics-events.jsonl`へ1行追記する。
 *
 * 既存`workflow record`（`src/adapters/workflow-journal.ts`）と同じ
 * trusted boundary判定（`assertWorkflowStaging`）とsingle-writer lock
 * （`withStagingMutationLock`）を再利用し、専用の耐久保証機構を新設しない（NFR-02）。
 */
export function appendMetricsEvent(input) {
    const resolved = assertWorkflowStaging(input.staging);
    return withStagingMutationLock(resolved, () => {
        const logPath = path.join(resolved, METRICS_EVENT_LOG_FILE);
        const existing = fs.existsSync(logPath)
            ? (() => {
                assertRegularMetricsLogPath(logPath);
                return parseMetricsEventLog(fs.readFileSync(logPath, "utf8"));
            })()
            : { entries: [], errors: [] };
        if (existing.errors.length > 0)
            throw new Error(`metrics events logの既存内容が不正です: ${existing.errors.join("; ")}`);
        const candidate = {
            kind: input.kind,
            phase: input.phase,
            label: input.label,
        };
        const transition = validateNextMetricsEvent(existing.entries, candidate);
        if (!transition.ok)
            throw new Error(transition.reason);
        const entryCheck = parseMetricsEventLine({
            kind: input.kind,
            phase: input.phase,
            label: input.label,
            recordedAt: input.now ?? new Date().toISOString(),
        }, existing.entries.length + 1);
        if (entryCheck.errors.length > 0 || !entryCheck.entry)
            throw new Error(entryCheck.errors.join("; "));
        const entry = entryCheck.entry;
        const nextSource = existing.entries.length === 0
            ? `${JSON.stringify(entry)}\n`
            : `${fs.readFileSync(logPath, "utf8").replace(/\n$/u, "")}\n${JSON.stringify(entry)}\n`;
        writeFileAtomic(logPath, nextSource);
        return { entry };
    });
}
function byLabelForKind(byLabel, kind) {
    const prefix = `${kind}:`;
    const result = {};
    for (const [key, ms] of Object.entries(byLabel)) {
        if (key.startsWith(prefix))
            result[key.slice(prefix.length)] = ms;
    }
    return result;
}
/**
 * FR-1482-05。T01〜T03の算出結果を1つのreportへ統合する。
 * `review-session`の入力が無い場合は`review_rounds`・`support_ms`をunavailable（null）として
 * 報告し、他fieldの算出は継続する（NFR-03）。
 */
export function buildMetricsReport(input) {
    const journal = readWorkflowJournal(input.staging);
    const warnings = [...journal.errors];
    const stepDurations = computeStepDurationsMs(journal.entries);
    const stepMs = {};
    for (const duration of stepDurations)
        stepMs[String(duration.step)] = duration.ms;
    const eventLog = readMetricsEventLog(input.staging);
    warnings.push(...eventLog.errors);
    if (eventLog.source === "")
        warnings.push(`${METRICS_EVENT_LOG_FILE}がありません。role_ms/model_ms/deterministic_msはunavailableです`);
    const eventDurations = computeEventDurationsMs(eventLog.entries);
    warnings.push(...eventDurations.warnings);
    let reviewRounds = null;
    if (input.reviewSessionPath) {
        if (!fs.existsSync(input.reviewSessionPath)) {
            warnings.push(`review session file(${input.reviewSessionPath})がありません。review_roundsはunavailableです`);
        }
        else {
            try {
                const raw = fs.readFileSync(input.reviewSessionPath, "utf8");
                const state = parseReviewSessionState(parseJsonStrict(raw, "review session"));
                reviewRounds = computeReviewRounds(state);
            }
            catch (error) {
                warnings.push(`review session fileの解析に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    const windowMs = computeMetricsWindowMs({
        stepEntries: journal.entries,
        eventEntries: eventLog.entries,
    });
    const split = computeSupportArtifactSplit({
        windowMs,
        roleByLabel: eventDurations.byLabel,
    });
    return {
        step_ms: stepMs,
        role_ms: byLabelForKind(eventDurations.byLabel, "role"),
        model_ms: byLabelForKind(eventDurations.byLabel, "model"),
        deterministic_ms: byLabelForKind(eventDurations.byLabel, "deterministic"),
        review_rounds: reviewRounds,
        support_ms: eventLog.source === "" ? null : split.support_ms,
        artifact_build_ms: split.artifact_build_ms,
        warnings,
    };
}
/** `--out`指定時、`.agent-skill-chain/metrics/<slug>.json`へreportを永続化する。 */
export function writeMetricsReport(input) {
    const resolved = assertWorkflowStaging(input.staging);
    const repositoryRoot = stagingRepositoryRoot(resolved);
    const slug = path.basename(resolved);
    const destination = path.join(repositoryRoot, METRICS_OUTPUT_DIRECTORY, `${slug}.json`);
    writeFileAtomic(destination, `${JSON.stringify(input.report, null, 2)}\n`);
    return { path: destination };
}
//# sourceMappingURL=metrics-journal.js.map