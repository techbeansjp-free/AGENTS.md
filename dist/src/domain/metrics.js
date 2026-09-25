import { isRecord } from "../types.js";
import { countedRounds, } from "./review-convergence.js";
import { ROLES } from "./role.js";
/**
 * TERM-ASC-131（計測イベント）。role切替・model呼び出し・deterministic tool呼び出しの
 * 開始・終了を、`.agent-skill-chain/metrics/<staging名>/events.jsonl`へ追記専用で
 * 記録する最小単位（staging digestの対象外領域。独立reviewのH1指摘により
 * staging配下から移設した。02 §4.3参照）。
 *
 * **compiled codeが自動生成しない。** Step境界は現状SKILL.md（進行役が読む手順書）にしか
 * 表現がなく、compiled codeが役割切替・model呼び出しを自動観測する経路は無い
 * （Issue #1482調査、`memo/v0.4.*-計画/01_v0.4.0_計測基盤.md`）。進行役の明示発行だけを受理する。
 */
export const METRICS_EVENT_KINDS = ["role", "model", "deterministic"];
export const METRICS_EVENT_PHASES = ["start", "end"];
const METRICS_EVENT_FIELDS = new Set(["kind", "phase", "label", "recordedAt"]);
/** labelの最大長。極端に長い文字列を拒否する（01 §10、SCN-MT-1482-010）。 */
const MAX_LABEL_LENGTH = 200;
function nonEmptyString(value) {
    return typeof value === "string" && value.trim() !== "";
}
/**
 * 制御文字・書式文字を含む文字列を拒否する（独立reviewのL1指摘を反映）。
 *
 * C0制御文字（U+0000-U+001F）とDEL（U+007F）に加え、C1制御文字
 * （U+0080-U+009F）、zero-width文字（U+200B-U+200F）、bidi override
 * （U+202A-U+202E）、BOM（U+FEFF）も拒否する。tab・改行も含む。
 *
 * **正規表現literalへ該当文字を直接埋め込まない。** エディタ・整形ツールが
 * 不可視文字をbyte単位で書き換える事故を避けるため、コードポイントの数値比較で判定する。
 */
const FORMAT_CHARACTER_RANGES = [
    [0x0000, 0x001f],
    [0x007f, 0x009f],
    [0x200b, 0x200f],
    [0x202a, 0x202e],
    [0xfeff, 0xfeff],
];
function hasControlCharacter(value) {
    for (const codePoint of value) {
        const point = codePoint.codePointAt(0) ?? 0;
        if (FORMAT_CHARACTER_RANGES.some(([start, end]) => point >= start && point <= end))
            return true;
    }
    return false;
}
function isRole(value) {
    return ROLES.some((role) => role === value);
}
function isUtcInstant(value) {
    if (typeof value !== "string")
        return false;
    const timestamp = Date.parse(value);
    return (Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value);
}
function isMetricsEventKind(value) {
    return METRICS_EVENT_KINDS.some((kind) => kind === value);
}
function isMetricsEventPhase(value) {
    return METRICS_EVENT_PHASES.some((phase) => phase === value);
}
/**
 * `journal/metrics-events.jsonl`の1行をstrictに検証する。
 *
 * 既存`journal/steps.jsonl`のparser（`parseStepJournal`、`src/domain/workflow.ts`）と
 * 同じ様式（未知field拒否、ISO 8601 UTC厳密一致、行番号付きエラー）を踏襲するが、
 * `StepJournalEntry`のschemaは変更しない（BR-1482-01）。
 *
 * `kind="role"`のlabelは`src/domain/role.ts`の`ROLES`列挙値のいずれかに限定する
 * （BR-1482-03、独立reviewのL1指摘）。`model`・`deterministic`は自由文字列のまま
 * だが、長さ上限と制御文字拒否は共通で適用する。
 */
export function parseMetricsEventLine(value, line) {
    const label = `metrics events ${line}行目`;
    const errors = [];
    if (!isRecord(value))
        return { errors: [`${label}はobjectが必要です`] };
    const unknown = Object.keys(value).filter((field) => !METRICS_EVENT_FIELDS.has(field));
    if (unknown.length > 0)
        errors.push(`${label}の未知fieldを拒否しました: ${unknown.join(", ")}`);
    if (!isMetricsEventKind(value.kind))
        errors.push(`${label}.kindはrole・model・deterministicのいずれかが必要です`);
    if (!isMetricsEventPhase(value.phase))
        errors.push(`${label}.phaseはstart・endのいずれかが必要です`);
    if (!nonEmptyString(value.label))
        errors.push(`${label}.labelは空でない文字列が必要です`);
    else if (hasControlCharacter(value.label))
        errors.push(`${label}.labelに制御文字・書式文字を含めることはできません`);
    else if (value.label.length > MAX_LABEL_LENGTH)
        errors.push(`${label}.labelは${MAX_LABEL_LENGTH}文字以下が必要です`);
    else if (value.kind === "role" && !isRole(value.label))
        errors.push(`${label}.labelはkind=roleのときROLES列挙値（${ROLES.join("・")}）のいずれかが必要です`);
    if (!isUtcInstant(value.recordedAt))
        errors.push(`${label}.recordedAtはISO 8601 UTC日時が必要です`);
    if (errors.length > 0)
        return { errors };
    return {
        entry: {
            kind: value.kind,
            phase: value.phase,
            label: value.label,
            recordedAt: value.recordedAt,
        },
        errors: [],
    };
}
/** JSONL全体をparseする。既存`parseStepJournal`と同じ空行スキップ・行番号付き様式。 */
export function parseMetricsEventLog(text) {
    const entries = [];
    const errors = [];
    const lines = text.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        if (line.trim() === "")
            continue;
        try {
            const parsed = parseMetricsEventLine(JSON.parse(line), index + 1);
            errors.push(...parsed.errors);
            if (parsed.entry)
                entries.push(parsed.entry);
        }
        catch {
            errors.push(`metrics events ${index + 1}行目は正しいJSONではありません`);
        }
    }
    return { entries, errors };
}
/** kindごとの現在の開区間。無ければidle（undefined）。INV-03/04の判定に使う。 */
export function openIntervalsByKind(entries) {
    const open = {};
    for (const entry of entries) {
        if (entry.phase === "start")
            open[entry.kind] = { label: entry.label, recordedAt: entry.recordedAt };
        else
            delete open[entry.kind];
    }
    return open;
}
/**
 * 新規eventが状態遷移契約（INV-03・INV-04）を満たすかを検証する。
 *
 * 各kindは独立にidle/openの2状態を持つ（01 §2.4）。startはidleのときだけ、
 * endはopenのときだけ受理する。単一進行役の逐次実行を前提とし、
 * 同一kindの並行開区間は扱わない（02 §4.3「対象外」）。
 *
 * `recordedAt`を渡した場合、endがopen区間のstartより前の時刻を持つ
 * 「時間逆行」も拒否する（独立reviewのM2指摘）。
 */
export function validateNextMetricsEvent(existing, candidate) {
    const open = openIntervalsByKind(existing);
    const current = open[candidate.kind];
    if (candidate.phase === "start") {
        if (current !== undefined)
            return {
                ok: false,
                reason: `kind=${candidate.kind}は既にlabel="${current.label}"でopen状態です（INV-03）。先にphase=endを記録してください`,
            };
        return { ok: true };
    }
    if (current === undefined)
        return {
            ok: false,
            reason: `kind=${candidate.kind}はidle状態のためphase=endを記録できません（INV-04）。対応するphase=startが必要です`,
        };
    if (candidate.recordedAt !== undefined) {
        const startMs = Date.parse(current.recordedAt);
        const endMs = Date.parse(candidate.recordedAt);
        if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs < startMs)
            return {
                ok: false,
                reason: `kind=${candidate.kind}のendがstart（${current.recordedAt}）より前の時刻です。時間逆行を拒否します`,
            };
    }
    return { ok: true };
}
/**
 * FR-1482-01。`journal/steps.jsonl`の**行順**（append順）で連続するentry間の
 * `recordedAt`差分を`step_ms`として算出する。行順を正本とし時刻順で並べ替えない
 * （TERM-ASC-063「行順で検証し、時刻順だけで実施を推測しない」）。
 *
 * 戻り値は配列であり、同じStep番号が複数回現れても全entryを保持する。
 */
export function computeStepDurationsMs(entries) {
    const durations = [];
    for (let index = 1; index < entries.length; index += 1) {
        const previous = entries[index - 1];
        const current = entries[index];
        if (!previous || !current)
            continue;
        const fromMs = Date.parse(previous.recordedAt);
        const toMs = Date.parse(current.recordedAt);
        if (!Number.isFinite(fromMs) || !Number.isFinite(toMs))
            continue;
        durations.push({
            step: current.step,
            ms: Math.max(0, toMs - fromMs),
            fromRecordedAt: previous.recordedAt,
            toRecordedAt: current.recordedAt,
        });
    }
    return durations;
}
/**
 * FR-1482-02。`countedRounds`（`src/domain/review-convergence.ts`）をそのまま再利用する。
 * `followOnly`・`recordLayerOnly`のroundは予算に数えないという既存契約と同じ定義を使う。
 */
export function computeReviewRounds(state) {
    return countedRounds(state);
}
/**
 * FR-1482-04。`journal/metrics-events.jsonl`のstart/end対から
 * `role_ms`/`model_ms`/`deterministic_ms`とlabel別内訳を算出する。
 *
 * 未終了区間（開いたままのstart）はwarningとして報告し合計から除外する（02 §6）。
 * end側のtimestampがstartより前（時間逆行）の場合もwarningとして報告し、
 * 当該区間は合計へ含めない（0で無言に丸めない。独立reviewのM2指摘）。
 */
export function computeEventDurationsMs(entries) {
    const totals = {};
    const byLabel = {};
    const warnings = [];
    const open = {};
    for (const entry of entries) {
        if (entry.phase === "start") {
            if (open[entry.kind])
                warnings.push(`kind=${entry.kind}で未終了のstart（label="${open[entry.kind].label}"）を新しいstartが上書きしました`);
            open[entry.kind] = { label: entry.label, recordedAt: entry.recordedAt };
            continue;
        }
        const started = open[entry.kind];
        if (!started) {
            warnings.push(`kind=${entry.kind}のend（label="${entry.label}"）に対応するstartがありません`);
            continue;
        }
        const fromMs = Date.parse(started.recordedAt);
        const toMs = Date.parse(entry.recordedAt);
        if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
            warnings.push(`kind=${entry.kind}のlabel="${started.label}"区間は時刻を解釈できないため除外しました`);
            delete open[entry.kind];
            continue;
        }
        if (toMs < fromMs) {
            warnings.push(`kind=${entry.kind}のlabel="${started.label}"区間はend（${entry.recordedAt}）がstart（${started.recordedAt}）より前のため除外しました`);
            delete open[entry.kind];
            continue;
        }
        const ms = toMs - fromMs;
        totals[entry.kind] = (totals[entry.kind] ?? 0) + ms;
        const key = `${entry.kind}:${started.label}`;
        byLabel[key] = (byLabel[key] ?? 0) + ms;
        delete open[entry.kind];
    }
    const openKinds = [];
    for (const [kind, interval] of Object.entries(open)) {
        if (interval) {
            openKinds.push(kind);
            warnings.push(`kind=${kind}のstart（label="${interval.label}"）が終了していません（unavailable扱い）`);
        }
    }
    return { totals, byLabel, openKinds, warnings };
}
/**
 * FR-1482-05・BR-1482-03。`artifact_build_ms`はrole=implementerのrole_msだけから
 * 算出し（`src/domain/role.ts`のROLES列挙のうちimplementerだけを対象にする）、
 * `support_ms`は計測window全体からそれを差し引いた値とする（02 §12で確定した式）。
 *
 * role kindが現在open状態（まだ閉じていない区間がある）の場合、確定値ではなく
 * 途中経過を誤って100%支援層または0%支援層のように見せてしまうため、両fieldを
 * unavailable（null）として報告する（独立reviewのM1指摘）。
 */
export function computeSupportArtifactSplit(input) {
    if (input.roleOpen)
        return { artifact_build_ms: null, support_ms: null };
    const artifactBuildMs = input.roleByLabel["role:implementer"] ?? 0;
    const supportMs = Math.max(0, input.windowMs - artifactBuildMs);
    return { artifact_build_ms: artifactBuildMs, support_ms: supportMs };
}
/**
 * 計測window全体のms。`journal/steps.jsonl`の全entryと
 * `journal/metrics-events.jsonl`の全eventを**合わせた集合**の最古・最新timestampの
 * 差分を採る（独立reviewのM1指摘。以前の実装は2つの個別spanをmaxしていたため、
 * 一方の集合がもう一方の範囲外に出る場合に過小評価していた）。
 */
export function computeMetricsWindowMs(input) {
    const timestamps = [
        ...input.stepEntries.map((entry) => entry.recordedAt),
        ...input.eventEntries.map((entry) => entry.recordedAt),
    ]
        .map((value) => Date.parse(value))
        .filter((value) => Number.isFinite(value));
    if (timestamps.length < 2)
        return 0;
    return Math.max(0, Math.max(...timestamps) - Math.min(...timestamps));
}
//# sourceMappingURL=metrics.js.map