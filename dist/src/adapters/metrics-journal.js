import fs from "node:fs";
import path from "node:path";
import { assertWorkflowStaging, readWorkflowJournal, } from "./workflow-journal.js";
import { withStagingMutationLock } from "../domain/staging.js";
import { stagingRepositoryRoot } from "../domain/staging-layout.js";
import { computeEventDurationsMs, computeMetricsWindowMs, computeReviewRounds, computeStepDurationsMs, computeSupportArtifactSplit, parseMetricsEventLine, parseMetricsEventLog, validateNextMetricsEvent, } from "../domain/metrics.js";
import { parseReviewSessionState } from "../domain/review-convergence.js";
import { writeFileAtomic } from "../lib/atomic.js";
import { parseJsonStrict } from "../lib/security.js";
/**
 * `.agent-skill-chain/metrics/`配下、staging名で分けたdirectory。
 *
 * **staging配下（`journal/`）へは置かない。** stagingのdigest inventory
 * （`src/domain/staging.ts`の`inventory()`）は少数の既知除外fileを除く全fileを
 * artifactとして数えるため、staging配下へ置くと`workflow mark`のたびにdigestが変わり、`workflow record`・
 * `review artifact`・`pr create`等の既存digest一致検査を壊す（独立reviewのH1指摘）。
 * `.agent-skill-chain/metrics/`はdocs/specs/14_開発・品質/00_ディレクトリ構成.mdが
 * 既に予約するrepository-root相対の実行時領域であり、staging digestの対象外。
 */
export const METRICS_OUTPUT_DIRECTORY = ".agent-skill-chain/metrics";
function metricsEventLogPath(repositoryRoot, staging) {
    const slug = path.basename(staging);
    return path.join(repositoryRoot, METRICS_OUTPUT_DIRECTORY, slug, "events.jsonl");
}
function metricsReportPath(repositoryRoot, staging) {
    const slug = path.basename(staging);
    return path.join(repositoryRoot, METRICS_OUTPUT_DIRECTORY, `${slug}.json`);
}
function assertRegularFilePath(rawTarget, label) {
    // 呼び出し元は絶対pathで渡すとは限らない（--review-sessionはCLI利用者の
    // 相対path指定を受理する）。realpathは常に絶対pathを返すため、先に
    // 絶対化しないと相対dirnameとの比較が常に不一致になる（独立reviewの
    // 新規指摘：round2で発見）。
    const target = path.resolve(rawTarget);
    const directory = path.dirname(target);
    if (fs.existsSync(directory)) {
        const directoryStat = fs.lstatSync(directory);
        if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory())
            throw new Error(`${label} directoryはsymlinkでない通常directoryが必要です`);
        if (fs.realpathSync(directory) !== directory)
            throw new Error(`${label} directoryにsymlink祖先を使用できません`);
    }
    if (!fs.existsSync(target))
        return;
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1)
        throw new Error(`${label}はsymlink・hardlinkでない通常fileが必要です`);
    if (fs.realpathSync(target) !== target)
        throw new Error(`${label}にsymlink祖先を使用できません`);
}
export function readMetricsEventLog(staging) {
    const resolved = assertWorkflowStaging(staging);
    const repositoryRoot = stagingRepositoryRoot(resolved);
    const logPath = metricsEventLogPath(repositoryRoot, resolved);
    if (!fs.existsSync(logPath))
        return { entries: [], errors: [], source: "", path: logPath };
    assertRegularFilePath(logPath, "metrics events log");
    const source = fs.readFileSync(logPath, "utf8");
    const parsed = parseMetricsEventLog(source);
    return { ...parsed, source, path: logPath };
}
/**
 * FR-1482-03。計測イベントを1行追記する。
 *
 * 既存`workflow record`（`src/adapters/workflow-journal.ts`）と同じ
 * trusted boundary判定（`assertWorkflowStaging`）とsingle-writer lock
 * （`withStagingMutationLock`）を再利用し、専用の耐久保証機構を新設しない（NFR-02）。
 * lockはstaging単位（`--staging`が指すdirectory）で取得し、実ファイルは
 * staging外の`.agent-skill-chain/metrics/`配下へ書く。
 */
export function appendMetricsEvent(input) {
    const resolved = assertWorkflowStaging(input.staging);
    return withStagingMutationLock(resolved, () => {
        const repositoryRoot = stagingRepositoryRoot(resolved);
        const logPath = metricsEventLogPath(repositoryRoot, resolved);
        const existing = fs.existsSync(logPath)
            ? (() => {
                assertRegularFilePath(logPath, "metrics events log");
                return parseMetricsEventLog(fs.readFileSync(logPath, "utf8"));
            })()
            : { entries: [], errors: [] };
        if (existing.errors.length > 0)
            throw new Error(`metrics events logの既存内容が不正です: ${existing.errors.join("; ")}`);
        const candidateRecordedAt = input.now ?? new Date().toISOString();
        const transition = validateNextMetricsEvent(existing.entries, {
            kind: input.kind,
            phase: input.phase,
            label: input.label,
            recordedAt: candidateRecordedAt,
        });
        if (!transition.ok)
            throw new Error(transition.reason);
        const entryCheck = parseMetricsEventLine({
            kind: input.kind,
            phase: input.phase,
            label: input.label,
            recordedAt: candidateRecordedAt,
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
 *
 * metrics event logが存在しない、またはparse errorを含む場合は
 * role_ms/model_ms/deterministic_ms（およびそのbreakdown・artifact_build_ms・
 * support_ms）をunavailable（null）として報告し、fail-closedとする
 * （02 §6、独立reviewのM2指摘）。`review-session`の入力が無い場合は
 * `review_rounds`をunavailable（null）として報告し、他fieldの算出は継続する（NFR-03）。
 */
export function buildMetricsReport(input) {
    const journal = readWorkflowJournal(input.staging);
    const warnings = [...journal.errors];
    const stepDurations = computeStepDurationsMs(journal.entries);
    const eventLog = readMetricsEventLog(input.staging);
    warnings.push(...eventLog.errors);
    const eventLogUnavailable = eventLog.source === "" || eventLog.errors.length > 0;
    if (eventLog.source === "")
        warnings.push(`${eventLog.path}がありません。role_ms/model_ms/deterministic_msはunavailableです`);
    else if (eventLog.errors.length > 0)
        warnings.push("metrics event logに不正な行が含まれるため、role_ms/model_ms/deterministic_msをfail-closedでunavailableとしました");
    const eventDurations = eventLogUnavailable
        ? { totals: {}, byLabel: {}, openKinds: [], warnings: [] }
        : computeEventDurationsMs(eventLog.entries);
    warnings.push(...eventDurations.warnings);
    let reviewRounds = null;
    if (input.reviewSessionPath) {
        assertRegularFilePath(input.reviewSessionPath, "review session file");
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
        eventEntries: eventLogUnavailable ? [] : eventLog.entries,
    });
    const split = eventLogUnavailable
        ? { artifact_build_ms: null, support_ms: null }
        : computeSupportArtifactSplit({
            windowMs,
            roleByLabel: eventDurations.byLabel,
            roleOpen: eventDurations.openKinds.includes("role"),
        });
    return {
        step_ms: stepDurations,
        role_ms: eventLogUnavailable ? null : (eventDurations.totals.role ?? 0),
        model_ms: eventLogUnavailable ? null : (eventDurations.totals.model ?? 0),
        deterministic_ms: eventLogUnavailable
            ? null
            : (eventDurations.totals.deterministic ?? 0),
        role_breakdown: byLabelForKind(eventDurations.byLabel, "role"),
        model_breakdown: byLabelForKind(eventDurations.byLabel, "model"),
        deterministic_breakdown: byLabelForKind(eventDurations.byLabel, "deterministic"),
        review_rounds: reviewRounds,
        support_ms: split.support_ms,
        artifact_build_ms: split.artifact_build_ms,
        warnings,
    };
}
/** `--out`指定時、`.agent-skill-chain/metrics/<slug>.json`へreportを永続化する。 */
export function writeMetricsReport(input) {
    const resolved = assertWorkflowStaging(input.staging);
    const repositoryRoot = stagingRepositoryRoot(resolved);
    const destination = metricsReportPath(repositoryRoot, resolved);
    writeFileAtomic(destination, `${JSON.stringify(input.report, null, 2)}\n`);
    return { path: destination };
}
//# sourceMappingURL=metrics-journal.js.map