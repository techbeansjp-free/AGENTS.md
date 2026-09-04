export const MODE_QUESTIONS = Object.freeze([
    {
        id: "Q-01",
        disqualifier: "public-api",
        question: "この変更は、外部へ公開するinterface（API、CLI、配布するschema定義file、template、規範文書）とその外部観測可能な振る舞い（終了値、error、既定値、副作用、互換性）を、追加・変更・削除しないか",
    },
    {
        id: "Q-02",
        disqualifier: "data-migration",
        question: "この変更は、既に保存されているデータの形式、移行手順、後方非互換な読み書き規則を追加・変更・削除しないか",
    },
    {
        id: "Q-03",
        disqualifier: "security-boundary",
        question: "この変更は、認証、認可、信頼境界の判定に加え、秘密情報の取得、保存、伝送、表示、伏字化、破棄の扱いを、追加・変更・削除しないか",
    },
    {
        id: "Q-04",
        disqualifier: "dependency",
        question: "この変更は、依存package、lockfile、versionの制約に加え、実行時に必要となる外部の存在（executable、OS library、外部service、常駐process）を、追加・変更・削除しないか",
    },
    {
        id: "Q-05",
        disqualifier: "infrastructure",
        question: "この変更は、実行環境、CI、基盤設定、配布経路、および接続先やendpointの指定を、追加・変更・削除しないか",
    },
    {
        id: "Q-06",
        disqualifier: "irreversible-operation",
        question: "この変更は、削除、公開、送信など元へ戻せない操作について、認可、対象、引数、実行時期、到達性、操作手順、復旧可能性のいずれも追加・変更・削除しないか。いずれも変えない非規範的な引用だけであれば該当しない。不明な場合はfalseとする",
    },
    {
        id: "Q-07",
        disqualifier: "ambiguity",
        question: "現時点の入力に、目的、対象内外、各受け入れ条件の観測方法、判定に用いる閾値、未決事項とその決定権者がすべて明記されており、目的、対象範囲、受け入れ条件、不変条件、要件のいずれのあいだにも矛盾が無いか。1つでも不足、不明、または矛盾があればfalseとする",
    },
    {
        id: "Q-08",
        disqualifier: "multi-context",
        question: "影響する境界づけられたコンテキストが1つに限定でき、他コンテキストのモデルと操作へ触れないか",
    },
]);
/** 承認済みのquick失格分類。`MODE_QUESTIONS`と1対1で対応する。 */
export const QUICK_DISQUALIFIER_IDS = Object.freeze(MODE_QUESTIONS.map((entry) => entry.disqualifier));
const QUESTIONS = MODE_QUESTIONS.map((entry) => entry.id);
/**
 * 質問と分類の対応を検証する。
 * 件数と一意性だけでは、空文字や未承認tokenを含む8件が通過する。集合の完全一致を要求する。
 */
export function validateModeQuestions(questions) {
    const errors = [];
    const expectedIds = Array.from({ length: 8 }, (_, index) => `Q-${String(index + 1).padStart(2, "0")}`);
    const ids = questions.map((entry) => entry.id);
    if (JSON.stringify(ids) !== JSON.stringify(expectedIds))
        errors.push(`モード判定質問のIDが規定と一致しません: ${ids.join("、") || "（なし）"}`);
    for (const entry of questions)
        if (entry.question.trim() === "")
            errors.push(`モード判定質問の文面が空です: ${entry.id}`);
    const texts = questions.map((entry) => entry.question);
    for (const value of new Set(texts.filter((value, index) => texts.indexOf(value) !== index)))
        errors.push(`モード判定質問の文面が重複しています: ${value.slice(0, 24)}…`);
    const declared = questions.map((entry) => entry.disqualifier);
    const duplicated = declared.filter((value, index) => declared.indexOf(value) !== index);
    for (const value of new Set(duplicated))
        errors.push(`quick失格分類が重複しています: ${value}`);
    const approved = new Set(APPROVED_DISQUALIFIERS);
    for (const entry of questions)
        if (!approved.has(entry.disqualifier))
            errors.push(`モード判定質問に対応する分類が承認済みではありません: ${entry.id}（${entry.disqualifier || "（空）"}）`);
    const present = new Set(declared);
    for (const value of APPROVED_DISQUALIFIERS)
        if (!present.has(value))
            errors.push(`quick失格分類に対応する質問がありません: ${value}`);
    return errors;
}
/** 承認済みの分類token。`MODE_QUESTIONS`の値と集合として一致しなければならない。 */
const APPROVED_DISQUALIFIERS = [
    "public-api",
    "data-migration",
    "security-boundary",
    "dependency",
    "infrastructure",
    "irreversible-operation",
    "ambiguity",
    "multi-context",
];
export const POC_HIGH_RISK_IDS = [
    "public-api",
    "personal-data",
    "confidential-data",
    "external-exposure",
    "irreversible-operation",
];
export const POC_OBSERVABLE_KINDS = [
    "exit-code",
    "stdout-digest",
    "stderr-digest",
    "file-digest",
];
export const POC_LIMITS = {
    useCases: 16,
    scenarios: 16,
    observables: 64,
    argvPerScenario: 32,
    argvCharacters: 8_192,
};
const knownHighRiskIds = new Set(POC_HIGH_RISK_IDS);
function nonEmpty(value) {
    return typeof value === "string" && value.trim() !== "";
}
const POC_ID = /^(?:FIX|RUN|UC|SCN|OBS)-[A-Z0-9][A-Z0-9-]*$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CONTROL = /[\p{Cc}\p{Cf}]/u;
function safeRelativePath(value) {
    if (!nonEmpty(value) || CONTROL.test(value) || value.includes("\\"))
        return false;
    if (value.normalize("NFC") !== value)
        return false;
    if (value.startsWith("/") || value.endsWith("/"))
        return false;
    const parts = value.split("/");
    return parts.every((part) => part !== "" && part !== "." && part !== ".." && part !== ".git");
}
function duplicateIds(values) {
    return [
        ...new Set(values
            .map(({ id }) => id)
            .filter((id, index, ids) => ids.indexOf(id) !== index)),
    ];
}
function quickReasons(answers) {
    const reasons = [];
    for (const id of QUESTIONS) {
        const item = answers?.[id];
        if (!item)
            reasons.push(`${id}: 未回答`);
        else if (item.answer !== true)
            reasons.push(`${id}: ${item.answer === "unknown" || item.answer == null ? "不明" : String(item.answer)}`);
        else if (!nonEmpty(item.evidence))
            reasons.push(`${id}: 根拠なし`);
    }
    return reasons;
}
function pocReasons(declaration) {
    if (!declaration)
        return ["PoC宣言がありません"];
    const reasons = [];
    const requiredFields = [
        ["目的", declaration.purpose],
        ["非対象", declaration.outOfScope],
        ["成功条件", declaration.successCriteria],
        ["中止条件", declaration.abortCriteria],
        ["責任者", declaration.owner],
    ];
    for (const [label, value] of requiredFields)
        if (!nonEmpty(value))
            reasons.push(`PoC宣言の${label}が未記入または不明です`);
    const fixture = declaration.fixture;
    if (!fixture ||
        !POC_ID.test(fixture.id ?? "") ||
        !fixture.id.startsWith("FIX-"))
        reasons.push("PoC宣言の隔離fixture IDが不正です");
    if (!fixture || !safeRelativePath(fixture.root))
        reasons.push("PoC宣言の隔離fixture rootが安全な相対pathではありません");
    else if (!fixture.root.startsWith("test/fixtures/poc/"))
        reasons.push("PoC宣言の隔離fixture rootはtest/fixtures/poc/配下が必要です");
    if (!fixture || !nonEmpty(fixture.isolationEvidence))
        reasons.push("PoC宣言の隔離境界Evidenceがありません");
    if (!fixture || !nonEmpty(fixture.resetEvidence))
        reasons.push("PoC宣言のfixture初期化Evidenceがありません");
    if (!fixture?.runner ||
        !POC_ID.test(fixture.runner.id ?? "") ||
        !fixture.runner.id.startsWith("RUN-"))
        reasons.push("PoC宣言のrunner IDが不正です");
    if (!fixture?.runner || !safeRelativePath(fixture.runner.path))
        reasons.push("PoC宣言のrunner pathが安全な相対pathではありません");
    const useCases = Array.isArray(declaration.useCases)
        ? declaration.useCases
        : [];
    if (useCases.length === 0)
        reasons.push("PoC宣言のuse caseがありません");
    if (useCases.length > POC_LIMITS.useCases)
        reasons.push(`PoC宣言のuse caseは${POC_LIMITS.useCases}件以下が必要です`);
    for (const item of useCases) {
        if (!item || !POC_ID.test(item.id ?? "") || !item.id.startsWith("UC-"))
            reasons.push("PoC宣言のuse case IDが不正です");
        if (!item || !nonEmpty(item.actor) || !nonEmpty(item.goal))
            reasons.push(`PoC use case ${item?.id || "（IDなし）"} が不完全です`);
    }
    for (const id of duplicateIds(useCases))
        reasons.push(`PoC use case ID ${id} が重複しています`);
    const useCaseIds = new Set(useCases.map(({ id }) => id));
    const scenarios = Array.isArray(declaration.scenarios)
        ? declaration.scenarios
        : [];
    if (scenarios.length === 0)
        reasons.push("PoC宣言のBDD scenarioがありません");
    if (scenarios.length > POC_LIMITS.scenarios)
        reasons.push(`PoC宣言のBDD scenarioは${POC_LIMITS.scenarios}件以下が必要です`);
    let argvCharacters = 0;
    for (const item of scenarios) {
        if (!item || !POC_ID.test(item.id ?? "") || !item.id.startsWith("SCN-"))
            reasons.push("PoC宣言のBDD scenario IDが不正です");
        if (!item || !useCaseIds.has(item.useCaseId))
            reasons.push(`PoC scenario ${item?.id || "（IDなし）"} のuse case参照が不正です`);
        if (!item ||
            !nonEmpty(item.given) ||
            !nonEmpty(item.when) ||
            !nonEmpty(item.then) ||
            !Array.isArray(item.argv) ||
            item.argv.length > POC_LIMITS.argvPerScenario ||
            !item.argv.every((value) => typeof value === "string" &&
                value.length <= 1_024 &&
                !CONTROL.test(value)))
            reasons.push(`PoC scenario ${item?.id || "（IDなし）"} が不完全です`);
        if (item && Array.isArray(item.argv))
            argvCharacters += item.argv.reduce((total, value) => total + (typeof value === "string" ? value.length : 0), 0);
    }
    if (argvCharacters > POC_LIMITS.argvCharacters)
        reasons.push(`PoC宣言のargv総文字数は${POC_LIMITS.argvCharacters}以下が必要です`);
    for (const id of duplicateIds(scenarios))
        reasons.push(`PoC scenario ID ${id} が重複しています`);
    const scenarioIds = new Set(scenarios.map(({ id }) => id));
    for (const id of useCaseIds)
        if (!scenarios.some(({ useCaseId }) => useCaseId === id))
            reasons.push(`PoC use case ${id} にBDD scenarioがありません`);
    const observables = Array.isArray(declaration.observables)
        ? declaration.observables
        : [];
    if (observables.length === 0)
        reasons.push("PoC宣言の機械observableがありません");
    if (observables.length > POC_LIMITS.observables)
        reasons.push(`PoC宣言の機械observableは${POC_LIMITS.observables}件以下が必要です`);
    const knownKinds = new Set(POC_OBSERVABLE_KINDS);
    for (const item of observables) {
        if (!item || !POC_ID.test(item.id ?? "") || !item.id.startsWith("OBS-"))
            reasons.push("PoC宣言のobservable IDが不正です");
        if (!item || !scenarioIds.has(item.scenarioId))
            reasons.push(`PoC observable ${item?.id || "（IDなし）"} のscenario参照が不正です`);
        const expectedValid = item?.kind === "exit-code"
            ? item.expected === 0
            : nonEmpty(item?.expected) && SHA256.test(String(item.expected));
        const targetValid = item?.kind === "file-digest"
            ? safeRelativePath(item.target) && SHA256.test(String(item.expected))
            : item?.target === undefined;
        if (!item || !knownKinds.has(item.kind) || !expectedValid || !targetValid)
            reasons.push(`PoC observable ${item?.id || "（IDなし）"} が不完全です`);
    }
    for (const id of duplicateIds(observables))
        reasons.push(`PoC observable ID ${id} が重複しています`);
    const fileTargets = observables
        .filter(({ kind }) => kind === "file-digest")
        .map(({ target }) => target)
        .filter((target) => typeof target === "string");
    for (const target of fileTargets) {
        if (target === fixture?.runner?.path)
            reasons.push(`PoC file-digest target ${target} はrunnerと重複できません`);
        const overlaps = fileTargets.filter((other) => other === target ||
            other.startsWith(`${target}/`) ||
            target.startsWith(`${other}/`));
        if (overlaps.length > 1)
            reasons.push(`PoC file-digest target ${target} が重複または親子重複しています`);
    }
    for (const id of scenarioIds)
        if (!observables.some(({ scenarioId }) => scenarioId === id))
            reasons.push(`PoC scenario ${id} に機械observableがありません`);
        else if (!observables.some(({ scenarioId, kind }) => scenarioId === id && kind === "exit-code"))
            reasons.push(`PoC scenario ${id} にexit-code observableがありません`);
        else if (!observables.some(({ scenarioId, kind }) => scenarioId === id && kind !== "exit-code"))
            reasons.push(`PoC scenario ${id} にbehavior observableがありません`);
    const riskEntries = Array.isArray(declaration.highRisk)
        ? declaration.highRisk
        : [];
    for (const id of POC_HIGH_RISK_IDS) {
        const entries = riskEntries.filter((entry) => entry?.id === id);
        if (entries.length !== 1) {
            reasons.push(`PoC high risk条件 ${id} が未確認または重複しています`);
            continue;
        }
        const entry = entries[0];
        if (!entry || typeof entry.present !== "boolean")
            reasons.push(`PoC high risk条件 ${id} の有無が不明です`);
        else if (entry.present)
            reasons.push(`PoC high risk条件 ${id} が存在するためfullへの昇格が必要です`);
        if (!entry || !nonEmpty(entry.evidence))
            reasons.push(`PoC high risk条件 ${id} の根拠がありません`);
    }
    for (const entry of riskEntries) {
        if (!entry || !nonEmpty(entry.id)) {
            reasons.push("PoC high risk条件に識別子がありません");
            continue;
        }
        if (entry.present === true && !knownHighRiskIds.has(entry.id))
            reasons.push(`PoC high risk条件 ${entry.id} が存在するためfullへの昇格が必要です`);
        if (typeof entry.present !== "boolean")
            reasons.push(`PoC high risk条件 ${entry.id} の有無が不明です`);
        if (!nonEmpty(entry.evidence))
            reasons.push(`PoC high risk条件 ${entry.id} の根拠がありません`);
    }
    return [...new Set(reasons)];
}
export function classifyMode(answers, options = {}) {
    if (options.requestedMode !== undefined &&
        !["quick", "full", "poc"].includes(options.requestedMode))
        return {
            mode: "full",
            reasons: [`要求されたモード ${options.requestedMode} は不明です`],
        };
    if (options.requestedMode !== "poc") {
        const reasons = quickReasons(answers);
        if (options.requestedMode === "full" || options.currentMode === "full") {
            if (reasons.length === 0)
                reasons.push("fullからquickまたはpocへ途中降格しません");
            return { mode: "full", reasons };
        }
        return { mode: reasons.length === 0 ? "quick" : "full", reasons };
    }
    const reasons = pocReasons(options.poc);
    if (options.currentMode === "full")
        reasons.push("fullからpocへ途中降格しません");
    for (const disqualifier of detectQuickDisqualifiers(options.changedFiles ?? []))
        reasons.push(`変更fileのhigh risk条件 ${disqualifier} を検出したためfullへの昇格が必要です`);
    return { mode: reasons.length === 0 ? "poc" : "full", reasons };
}
export function detectQuickDisqualifiers(changedFiles) {
    const reasons = new Set();
    for (const file of changedFiles) {
        const normalized = file.replaceAll("\\", "/");
        if (/(^|\/)(package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|requirements.*\.txt|pyproject\.toml|Cargo\.toml)$/.test(normalized))
            reasons.add("dependency");
        if (/(^|\/)(public-api|api\/|openapi|contracts?\/|exports?\.)/i.test(normalized))
            reasons.add("public-api");
        if (/(^|\/)(migrations?|schema\/)/i.test(normalized))
            reasons.add("data-migration");
        if (/(^|\/)(auth|security|secrets?)(\/|\.)/i.test(normalized))
            reasons.add("security-boundary");
        if (/(^|\/)(\.github\/workflows|infra\/|Dockerfile|terraform)/i.test(normalized))
            reasons.add("infrastructure");
    }
    return [...reasons];
}
export { QUESTIONS };
//# sourceMappingURL=mode.js.map