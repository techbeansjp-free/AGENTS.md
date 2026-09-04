import { parseJsonStrict, stableJson } from "../lib/security.js";
import { isRecord } from "../types.js";
import { classifyMode, POC_LIMITS, POC_OBSERVABLE_KINDS, QUESTIONS, } from "./mode.js";
export const MODE_DECISION_FILE = "00_モード判定.json";
export const WORKFLOW_JOURNAL_DIRECTORY = "journal";
export const STEP_JOURNAL_BASENAME = "steps.jsonl";
export const STEP_JOURNAL_FILE = `${WORKFLOW_JOURNAL_DIRECTORY}/${STEP_JOURNAL_BASENAME}`;
export const WORKFLOW_STEPS = Object.freeze([
    {
        step: 0,
        skillId: "step-00-stage",
        responsibility: "モード判定と一時ステージングの原子的開始",
        artifact: "`.agent-skill-chain/tmp/issues/<timestamp>_<title>/`",
    },
    {
        step: 1,
        skillId: "step-01-request",
        responsibility: "要求定義。`quick`は計画全体を集約",
        artifact: "`00_要求定義.md`",
    },
    {
        step: 2,
        skillId: "step-02-requirements",
        responsibility: "ストーリー、受け入れ条件、ドメイン規則の定義",
        artifact: "`01_要件定義.md`",
    },
    {
        step: 3,
        skillId: "step-03-requirements-review",
        responsibility: "要求・要件の開始可能性確認",
        artifact: "開始可能性の記録と修正文書",
    },
    {
        step: 4,
        skillId: "step-04-issue-sync",
        responsibility: "開始可能性を確認した計画を1つの耐久トラッカーへ同期",
        artifact: "書き込み後読み取り確認済みトラッカー",
    },
    {
        step: 5,
        skillId: "step-05-design",
        responsibility: "依存関係、安全性、失敗、ロールバックの設計",
        artifact: "`02_設計.md`",
    },
    {
        step: 6,
        skillId: "step-06-plan",
        responsibility: "risk比例検証と最小実装の計画",
        artifact: "`03_実装計画.md`",
    },
    {
        step: 7,
        skillId: "step-07-design-review",
        responsibility: "実装開始可能性の確認",
        artifact: "開始可能性の記録と修正文書",
    },
    {
        step: 8,
        skillId: "step-08-design-sync",
        responsibility: "同じトラッカーへ設計・計画を追記",
        artifact: "書き込み後読み取り確認済みトラッカー",
    },
    {
        step: 9,
        skillId: "step-09-implement",
        responsibility: "専用worktreeで実装",
        artifact: "コード、Gherkinテスト、`docs/specs/`更新",
    },
    {
        step: 10,
        skillId: "step-10-review",
        responsibility: "exact-head最終レビュー、検証、仕様整合性",
        artifact: "実装中発見を含む有限レビューの承認証拠",
    },
    {
        step: 11,
        skillId: "step-11-pr",
        responsibility: "PRを作成しdelivery policyの終端まで進行",
        artifact: "`outcome=pull-request / merged`の終端Evidence。authority待ちと`merge-observed`は未完了",
    },
]);
export const MODE_STEP_SEQUENCES = Object.freeze({
    full: Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    quick: Object.freeze([0, 1, 4, 9, 10, 11]),
    poc: Object.freeze([0, 1, 4, 9, 10, 11]),
});
export const NEVER_SKIPPABLE_STEPS = Object.freeze([
    0, 1, 4, 9, 10, 11,
]);
export function requiredSteps(mode) {
    return MODE_STEP_SEQUENCES[mode];
}
export function skippableSteps(mode) {
    const required = new Set(requiredSteps(mode));
    return WORKFLOW_STEPS.map(({ step }) => step).filter((step) => !required.has(step));
}
const NON_HUMAN_OVERRIDE_ISSUERS = new Set([
    "coordinator",
    "analyst",
    "implementer",
    "reviewer",
    "verifier",
    "finalizer",
    "agent",
    "ai",
    "assistant",
    "codex",
    "claude",
]);
export function validateJournalHumanOverride(input) {
    const parsed = parseHumanOverride(input.override, "HumanOverride");
    const errors = [...parsed.errors];
    if (input.override.issue !== input.issue)
        errors.push("HumanOverrideのIssueが対象と一致しません");
    if (NON_HUMAN_OVERRIDE_ISSUERS.has(input.override.instructedBy.trim().toLowerCase()))
        errors.push("AI agentまたはroleによる自己発行HumanOverrideは使用できません");
    const now = Date.parse(input.now);
    const instructedAt = Date.parse(input.override.instructedAt);
    const expiresAt = Date.parse(input.override.expiresAt);
    if (!Number.isFinite(now) || new Date(now).toISOString() !== input.now)
        errors.push("HumanOverride検証時刻が不正です");
    if (Number.isFinite(now) &&
        Number.isFinite(instructedAt) &&
        instructedAt > now)
        errors.push("HumanOverrideの指示日時が未来です");
    if (Number.isFinite(now) && Number.isFinite(expiresAt) && expiresAt <= now)
        errors.push("HumanOverrideは失効しています");
    return { valid: errors.length === 0, errors };
}
const JOURNAL_FIELDS = new Set([
    "step",
    "skillId",
    "mode",
    "recordedAt",
    "artifacts",
    "evidence",
    "pocObservation",
    "reviewSession",
    "humanOverride",
    "postTerminalIntake",
]);
const POC_OBSERVATION_BINDING_FIELDS = new Set(["headSha", "evidenceDigest"]);
const REVIEW_SESSION_BINDING_FIELDS = new Set([
    "sessionId",
    "roundDigest",
    "headSha",
]);
const OVERRIDE_FIELDS = new Set([
    "issue",
    "scope",
    "instructedBy",
    "instructedAt",
    "expiresAt",
    "reason",
]);
const MODE_DECISION_FIELDS = new Set([
    "mode",
    "requestedMode",
    "answers",
    "changedFiles",
    "reasons",
    "decidedAt",
    "baselineHeadSha",
    "poc",
]);
const POC_FIELDS = new Set([
    "purpose",
    "fixture",
    "useCases",
    "scenarios",
    "observables",
    "outOfScope",
    "successCriteria",
    "abortCriteria",
    "owner",
    "highRisk",
]);
const FIXTURE_FIELDS = new Set([
    "id",
    "root",
    "isolationEvidence",
    "resetEvidence",
    "runner",
]);
const RUNNER_FIELDS = new Set(["id", "path"]);
const USE_CASE_FIELDS = new Set(["id", "actor", "goal"]);
const SCENARIO_FIELDS = new Set([
    "id",
    "useCaseId",
    "given",
    "when",
    "then",
    "argv",
]);
const OBSERVABLE_FIELDS = new Set([
    "id",
    "scenarioId",
    "kind",
    "expected",
    "target",
]);
const RISK_FIELDS = new Set(["id", "present", "evidence"]);
function isMode(value) {
    return value === "quick" || value === "full" || value === "poc";
}
function nonEmpty(value) {
    return typeof value === "string" && value.trim() !== "";
}
function isUtcInstant(value) {
    if (typeof value !== "string")
        return false;
    const timestamp = Date.parse(value);
    return (Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value);
}
function unknownFields(value, allowed) {
    return Object.keys(value).filter((field) => !allowed.has(field));
}
function parseHumanOverride(value, label) {
    const errors = [];
    if (!isRecord(value))
        return { errors: [`${label}はobjectが必要です`] };
    const unknown = unknownFields(value, OVERRIDE_FIELDS);
    if (unknown.length > 0)
        errors.push(`${label}の未知fieldを拒否しました: ${unknown.join(", ")}`);
    if (typeof value.issue !== "number" ||
        !Number.isInteger(value.issue) ||
        value.issue < 1)
        errors.push(`${label}.issueは正の整数が必要です`);
    if (value.scope !== "workflow.pr.create")
        errors.push(`${label}.scopeはworkflow.pr.createが必要です`);
    for (const field of ["instructedBy", "reason"])
        if (!nonEmpty(value[field]))
            errors.push(`${label}.${field}は空でない文字列が必要です`);
    for (const field of ["instructedAt", "expiresAt"])
        if (!isUtcInstant(value[field]))
            errors.push(`${label}.${field}はISO 8601 UTC日時が必要です`);
    if (errors.length > 0)
        return { errors };
    return {
        value: {
            issue: value.issue,
            scope: "workflow.pr.create",
            instructedBy: value.instructedBy,
            instructedAt: value.instructedAt,
            expiresAt: value.expiresAt,
            reason: value.reason,
        },
        errors,
    };
}
function parseJournalEntry(value, line) {
    const label = `journal ${line}行目`;
    const errors = [];
    if (!isRecord(value))
        return { errors: [`${label}はobjectが必要です`] };
    const unknown = unknownFields(value, JOURNAL_FIELDS);
    if (unknown.length > 0)
        errors.push(`${label}の未知fieldを拒否しました: ${unknown.join(", ")}`);
    if (typeof value.step !== "number" ||
        !Number.isInteger(value.step) ||
        value.step < 0 ||
        value.step > 11)
        errors.push(`${label}.stepは0..11の整数が必要です`);
    const definition = typeof value.step === "number"
        ? WORKFLOW_STEPS.find(({ step }) => step === value.step)
        : undefined;
    if (!definition || value.skillId !== definition.skillId)
        errors.push(`${label}.skillIdがstep定義と一致しません`);
    if (!isMode(value.mode))
        errors.push(`${label}.modeが不正です`);
    if (!isUtcInstant(value.recordedAt))
        errors.push(`${label}.recordedAtはISO 8601 UTC日時が必要です`);
    if (!Array.isArray(value.artifacts) ||
        value.artifacts.length === 0 ||
        !value.artifacts.every(nonEmpty))
        errors.push(`${label}.artifactsは空でない文字列を1件以上含む配列が必要です`);
    if (!nonEmpty(value.evidence))
        errors.push(`${label}.evidenceは空でない文字列が必要です`);
    const parsedOverride = value.humanOverride === undefined
        ? { errors: [] }
        : parseHumanOverride(value.humanOverride, `${label}.humanOverride`);
    errors.push(...parsedOverride.errors);
    let pocObservation;
    if (value.pocObservation !== undefined) {
        if (!isRecord(value.pocObservation) ||
            unknownFields(value.pocObservation, POC_OBSERVATION_BINDING_FIELDS)
                .length > 0 ||
            !/^[a-f0-9]{40}$/u.test(String(value.pocObservation.headSha ?? "")) ||
            !/^[a-f0-9]{64}$/u.test(String(value.pocObservation.evidenceDigest ?? "")))
            errors.push(`${label}.pocObservationが不正です`);
        else
            pocObservation = {
                headSha: value.pocObservation.headSha,
                evidenceDigest: value.pocObservation.evidenceDigest,
            };
    }
    if (value.mode === "poc" && Number(value.step) >= 9 && !pocObservation)
        errors.push(`${label}のPoC Step 9以降にはpocObservation bindingが必要です`);
    if ((value.mode !== "poc" || Number(value.step) < 9) && pocObservation)
        errors.push(`${label}ではpocObservation bindingを使用できません`);
    let reviewSession;
    if (value.reviewSession !== undefined) {
        if (!isRecord(value.reviewSession) ||
            unknownFields(value.reviewSession, REVIEW_SESSION_BINDING_FIELDS).length >
                0 ||
            !/^[a-f0-9]{64}$/u.test(String(value.reviewSession.sessionId ?? "")) ||
            !/^[a-f0-9]{64}$/u.test(String(value.reviewSession.roundDigest ?? "")) ||
            !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(String(value.reviewSession.headSha ?? "")))
            errors.push(`${label}.reviewSessionが不正です`);
        else
            reviewSession = {
                sessionId: value.reviewSession.sessionId,
                roundDigest: value.reviewSession.roundDigest,
                headSha: value.reviewSession.headSha,
            };
    }
    if (Number(value.step) === 10 && !reviewSession)
        errors.push(`${label}のStep 10にreviewSession bindingが必要です`);
    if (Number(value.step) !== 10 && reviewSession)
        errors.push(`${label}ではreviewSession bindingを使用できません`);
    let postTerminalIntake;
    if (value.postTerminalIntake !== undefined) {
        if (value.postTerminalIntake !== true)
            errors.push(`${label}のpostTerminalIntakeはtrueだけを受理します`);
        else if (Number(value.step) !== 10)
            errors.push(`${label}のpostTerminalIntakeはStep 10にだけ指定できます`);
        else
            postTerminalIntake = true;
    }
    if (errors.length > 0)
        return { errors };
    return {
        entry: {
            step: value.step,
            skillId: value.skillId,
            mode: value.mode,
            recordedAt: value.recordedAt,
            artifacts: [...value.artifacts],
            evidence: value.evidence,
            ...(pocObservation ? { pocObservation } : {}),
            ...(reviewSession ? { reviewSession } : {}),
            ...(parsedOverride.value ? { humanOverride: parsedOverride.value } : {}),
            ...(postTerminalIntake ? { postTerminalIntake } : {}),
        },
        errors,
    };
}
export function parseStepJournal(text) {
    const entries = [];
    const errors = [];
    const lines = text.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        if (line.trim() === "")
            continue;
        try {
            const parsed = parseJournalEntry(parseJsonStrict(line, `journal ${index + 1}行目`), index + 1);
            errors.push(...parsed.errors);
            if (parsed.entry)
                entries.push(parsed.entry);
        }
        catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
        }
    }
    return { entries, errors };
}
function modeTransitionConflicts(mode, entries) {
    const conflicts = [];
    let previous;
    for (const entry of entries) {
        if (previous !== undefined &&
            entry.mode !== previous &&
            !(previous !== "full" && entry.mode === "full"))
            conflicts.push(`${previous}から${entry.mode}へのモード変更は許可されません`);
        previous = entry.mode;
    }
    if (previous !== undefined && previous !== mode) {
        if (!(previous !== "full" && mode === "full"))
            conflicts.push(`journalの最終モード${previous}と検証モード${mode}が一致しません`);
    }
    return [...new Set(conflicts)];
}
export function validateStepJournal(input) {
    const errors = [];
    if (!Number.isInteger(input.upToStep) ||
        input.upToStep < 0 ||
        input.upToStep > 11)
        errors.push("upToStepは0..11の整数が必要です");
    const expected = requiredSteps(input.mode);
    const expectedSet = new Set(expected);
    const lastByStep = new Map();
    /**
     * **post-terminal intakeの記録は順序判定から外す。**
     *
     * `pr create`後に届いた外部指摘を同じPRで取り込んだroundは、定義上Step 11より
     * 後に現れる。順序判定へ入れるとStep 11がout-of-orderになる。**外すのは順序の
     * 判定だけであり、記録は残る**（Issue #1194）。
     */
    input.entries.forEach((entry, index) => {
        if (entry.postTerminalIntake)
            return;
        lastByStep.set(entry.step, { entry, index });
    });
    const terminalIndex = input.entries.findIndex((entry) => entry.step === 11);
    input.entries.forEach((entry, index) => {
        if (!entry.postTerminalIntake)
            return;
        if (terminalIndex < 0 || index < terminalIndex)
            errors.push("post-terminal intakeのStep 10記録はStep 11より後に置いてください");
    });
    const maximum = errors.length === 0 ? input.upToStep : 11;
    const missingSteps = expected.filter((step) => step <= maximum && !lastByStep.has(step));
    const unexpectedSteps = [...lastByStep.keys()]
        .filter((step) => !expectedSet.has(step))
        .sort((left, right) => left - right);
    const outOfOrder = [];
    const firstFullIndex = input.entries.findIndex((entry) => entry.mode === "full");
    let previousIndex = -1;
    for (const step of expected) {
        if (input.mode === "poc" && step > maximum)
            continue;
        const record = lastByStep.get(step);
        if (!record)
            continue;
        // fullへの単調昇格前にquick/pocで完了したStep 4/9は履歴として
        // 保持するが、fullの補完中は再実施が必要である。通常fullの未来Stepまで
        // 無条件に無視すると過去Stepの後付けを受理するため、昇格前履歴だけを除外する。
        const inheritedFutureHistory = input.mode === "full" &&
            step > maximum &&
            firstFullIndex >= 0 &&
            record.entry.mode !== "full" &&
            record.index < firstFullIndex;
        if (inheritedFutureHistory)
            continue;
        if (record.entry.humanOverride)
            continue;
        if (record.index < previousIndex)
            outOfOrder.push(step);
        else
            previousIndex = record.index;
    }
    const modeConflicts = modeTransitionConflicts(input.mode, input.entries);
    return {
        valid: errors.length === 0 &&
            missingSteps.length === 0 &&
            unexpectedSteps.length === 0 &&
            outOfOrder.length === 0 &&
            modeConflicts.length === 0,
        missingSteps,
        unexpectedSteps,
        outOfOrder,
        modeConflicts,
        errors,
    };
}
function parseAnswers(value) {
    const errors = [];
    if (!isRecord(value))
        return { errors: ["answersはobjectが必要です"] };
    const expected = new Set(QUESTIONS);
    const missing = QUESTIONS.filter((id) => !(id in value));
    const unknown = Object.keys(value).filter((id) => !expected.has(id));
    if (missing.length > 0)
        errors.push(`answersに必須回答がありません: ${missing.join(", ")}`);
    if (unknown.length > 0)
        errors.push(`answersの未知fieldを拒否しました: ${unknown.join(", ")}`);
    const answers = {};
    for (const id of QUESTIONS) {
        const item = value[id];
        if (!isRecord(item) ||
            unknownFields(item, new Set(["answer", "evidence"])).length > 0) {
            errors.push(`${id}はanswerとevidenceだけを持つobjectが必要です`);
            continue;
        }
        if (item.answer !== true &&
            item.answer !== false &&
            item.answer !== "unknown")
            errors.push(`${id}.answerはbooleanまたはunknownが必要です`);
        if (!nonEmpty(item.evidence))
            errors.push(`${id}.evidenceは空でない文字列が必要です`);
        if ((item.answer === true ||
            item.answer === false ||
            item.answer === "unknown") &&
            typeof item.evidence === "string")
            answers[id] = { answer: item.answer, evidence: item.evidence };
    }
    return errors.length === 0 ? { answers, errors } : { errors };
}
function parsePoc(value) {
    const errors = [];
    if (!isRecord(value))
        return { errors: ["pocはobjectが必要です"] };
    const unknown = unknownFields(value, POC_FIELDS);
    if (unknown.length > 0)
        errors.push(`pocの未知fieldを拒否しました: ${unknown.join(", ")}`);
    for (const field of [
        "purpose",
        "outOfScope",
        "successCriteria",
        "abortCriteria",
        "owner",
    ])
        if (!nonEmpty(value[field]))
            errors.push(`poc.${field}は空でない文字列が必要です`);
    let fixture;
    if (!isRecord(value.fixture) ||
        unknownFields(value.fixture, FIXTURE_FIELDS).length > 0)
        errors.push("poc.fixtureはid、root、isolationEvidence、resetEvidence、runnerだけを持つobjectが必要です");
    else {
        const rawFixture = value.fixture;
        const rawRunner = isRecord(rawFixture.runner)
            ? rawFixture.runner
            : undefined;
        for (const field of [
            "id",
            "root",
            "isolationEvidence",
            "resetEvidence",
        ])
            if (!nonEmpty(rawFixture[field]))
                errors.push(`poc.fixture.${field}は空でない文字列が必要です`);
        if (!rawRunner || unknownFields(rawRunner, RUNNER_FIELDS).length > 0)
            errors.push("poc.fixture.runnerはid、pathだけを持つobjectが必要です");
        else {
            for (const field of ["id", "path"])
                if (!nonEmpty(rawRunner[field]))
                    errors.push(`poc.fixture.runner.${field}は空でない文字列が必要です`);
            if (["id", "root", "isolationEvidence", "resetEvidence"].every((field) => typeof rawFixture[field] === "string") &&
                ["id", "path"].every((field) => typeof rawRunner[field] === "string"))
                fixture = {
                    id: rawFixture.id,
                    root: rawFixture.root,
                    isolationEvidence: rawFixture.isolationEvidence,
                    resetEvidence: rawFixture.resetEvidence,
                    runner: {
                        id: rawRunner.id,
                        path: rawRunner.path,
                    },
                };
        }
    }
    const parseObjectArray = (raw, label, allowed, fields, build) => {
        if (!Array.isArray(raw) || raw.length === 0) {
            errors.push(`poc.${label}は1件以上の配列が必要です`);
            return [];
        }
        const result = [];
        raw.forEach((item, index) => {
            if (!isRecord(item) || unknownFields(item, allowed).length > 0) {
                errors.push(`poc.${label}[${index}]の構造が不正です`);
                return;
            }
            if (!fields.every((field) => nonEmpty(item[field]))) {
                errors.push(`poc.${label}[${index}]の必須fieldが不正です`);
                return;
            }
            result.push(build(item));
        });
        return result;
    };
    const useCases = parseObjectArray(value.useCases, "useCases", USE_CASE_FIELDS, ["id", "actor", "goal"], (item) => ({
        id: item.id,
        actor: item.actor,
        goal: item.goal,
    }));
    if (Array.isArray(value.useCases) &&
        value.useCases.length > POC_LIMITS.useCases)
        errors.push(`poc.useCasesは${POC_LIMITS.useCases}件以下が必要です`);
    const scenarios = [];
    if (!Array.isArray(value.scenarios) || value.scenarios.length === 0)
        errors.push("poc.scenariosは1件以上の配列が必要です");
    else
        value.scenarios.forEach((item, index) => {
            if (!isRecord(item) || unknownFields(item, SCENARIO_FIELDS).length > 0) {
                errors.push(`poc.scenarios[${index}]の構造が不正です`);
                return;
            }
            if (!["id", "useCaseId", "given", "when", "then"].every((field) => nonEmpty(item[field])) ||
                !Array.isArray(item.argv) ||
                !item.argv.every((argument) => typeof argument === "string")) {
                errors.push(`poc.scenarios[${index}]の必須fieldが不正です`);
                return;
            }
            scenarios.push({
                id: item.id,
                useCaseId: item.useCaseId,
                given: item.given,
                when: item.when,
                then: item.then,
                argv: [...item.argv],
            });
        });
    if (Array.isArray(value.scenarios) &&
        value.scenarios.length > POC_LIMITS.scenarios)
        errors.push(`poc.scenariosは${POC_LIMITS.scenarios}件以下が必要です`);
    const observables = [];
    if (!Array.isArray(value.observables) || value.observables.length === 0)
        errors.push("poc.observablesは1件以上の配列が必要です");
    else
        value.observables.forEach((item, index) => {
            if (!isRecord(item) ||
                unknownFields(item, OBSERVABLE_FIELDS).length > 0 ||
                !["id", "scenarioId", "kind"].every((field) => nonEmpty(item[field])) ||
                (typeof item.expected !== "string" &&
                    typeof item.expected !== "number") ||
                (item.target !== undefined && !nonEmpty(item.target))) {
                errors.push(`poc.observables[${index}]の構造が不正です`);
                return;
            }
            observables.push({
                id: item.id,
                scenarioId: item.scenarioId,
                kind: item.kind,
                expected: item.expected,
                ...(typeof item.target === "string" ? { target: item.target } : {}),
            });
        });
    if (Array.isArray(value.observables) &&
        value.observables.length > POC_LIMITS.observables)
        errors.push(`poc.observablesは${POC_LIMITS.observables}件以下が必要です`);
    const knownKinds = new Set(POC_OBSERVABLE_KINDS);
    observables.forEach((item, index) => {
        if (!knownKinds.has(item.kind))
            errors.push(`poc.observables[${index}].kindが不正です`);
    });
    if (!Array.isArray(value.highRisk))
        errors.push("poc.highRiskは配列が必要です");
    const highRisk = [];
    if (Array.isArray(value.highRisk))
        value.highRisk.forEach((item, index) => {
            if (!isRecord(item) || unknownFields(item, RISK_FIELDS).length > 0) {
                errors.push(`poc.highRisk[${index}]の構造が不正です`);
                return;
            }
            if (!nonEmpty(item.id) ||
                typeof item.present !== "boolean" ||
                !nonEmpty(item.evidence)) {
                errors.push(`poc.highRisk[${index}]のid、present、evidenceが不正です`);
                return;
            }
            highRisk.push({
                id: item.id,
                present: item.present,
                evidence: item.evidence,
            });
        });
    if (errors.length > 0)
        return { errors };
    return {
        poc: {
            purpose: value.purpose,
            fixture: fixture,
            useCases,
            scenarios,
            observables,
            outOfScope: value.outOfScope,
            successCriteria: value.successCriteria,
            abortCriteria: value.abortCriteria,
            owner: value.owner,
            highRisk,
        },
        errors,
    };
}
export function parsePocDeclaration(text) {
    if (Buffer.byteLength(text, "utf8") > 128 * 1024)
        return { errors: ["PoC宣言が128KiB上限を超えています"] };
    let value;
    try {
        value = parseJsonStrict(text, "PoC宣言");
    }
    catch (error) {
        return { errors: [error instanceof Error ? error.message : String(error)] };
    }
    const parsed = parsePoc(value);
    if (!parsed.poc)
        return { errors: parsed.errors };
    const classified = classifyMode({}, { requestedMode: "poc", poc: parsed.poc });
    if (classified.mode !== "poc")
        return { errors: classified.reasons };
    return { declaration: parsed.poc, errors: [] };
}
export function renderModeDecision(input) {
    if (!isUtcInstant(input.decidedAt))
        throw new Error("decidedAtはISO 8601 UTC日時でなければなりません");
    const result = classifyMode(input.answers, {
        requestedMode: input.requestedMode,
        poc: input.poc,
        changedFiles: input.changedFiles,
        currentMode: input.currentMode,
    });
    const decision = {
        mode: result.mode,
        requestedMode: input.requestedMode,
        answers: input.answers,
        changedFiles: [...(input.changedFiles ?? [])],
        reasons: result.reasons,
        decidedAt: input.decidedAt,
        ...(input.baselineHeadSha
            ? { baselineHeadSha: input.baselineHeadSha }
            : {}),
        ...(input.poc ? { poc: input.poc } : {}),
    };
    const parsed = parseModeDecision(stableJson(decision));
    if (!parsed.decision)
        throw new Error(parsed.errors.join("; "));
    return `${stableJson(decision)}\n`;
}
export function parseModeDecision(text) {
    if (Buffer.byteLength(text, "utf8") > 128 * 1024)
        return { errors: ["モード判定成果物が128KiB上限を超えています"] };
    const errors = [];
    let value;
    try {
        value = parseJsonStrict(text, "モード判定成果物");
    }
    catch (error) {
        return { errors: [error instanceof Error ? error.message : String(error)] };
    }
    if (!isRecord(value))
        return { errors: ["モード判定成果物はobjectが必要です"] };
    const unknown = unknownFields(value, MODE_DECISION_FIELDS);
    if (unknown.length > 0)
        errors.push(`モード判定成果物の未知fieldを拒否しました: ${unknown.join(", ")}`);
    if (!isMode(value.mode))
        errors.push("modeが不正です");
    if (!isMode(value.requestedMode))
        errors.push("requestedModeが不正です");
    if (!isUtcInstant(value.decidedAt))
        errors.push("decidedAtはISO 8601 UTC日時が必要です");
    if (value.mode === "poc" &&
        !/^[a-f0-9]{40}$/u.test(String(value.baselineHeadSha ?? "")))
        errors.push("pocモードにはbaselineHeadShaが必要です");
    if (value.mode !== "poc" && value.baselineHeadSha !== undefined)
        errors.push("baselineHeadShaはpocモードだけで使用できます");
    if (!Array.isArray(value.reasons) ||
        !value.reasons.every((item) => typeof item === "string"))
        errors.push("reasonsは文字列配列が必要です");
    const parsedAnswers = parseAnswers(value.answers);
    errors.push(...parsedAnswers.errors);
    const changedFiles = value.changedFiles ?? [];
    if (!Array.isArray(changedFiles) ||
        changedFiles.length > 256 ||
        !changedFiles.every((file) => nonEmpty(file) && file.length <= 1_024))
        errors.push("changedFilesは1024文字以下を256件以下含む文字列配列が必要です");
    const parsedPoc = value.poc === undefined ? { errors: [] } : parsePoc(value.poc);
    errors.push(...parsedPoc.errors);
    if (value.mode === "poc" && !parsedPoc.poc)
        errors.push("pocモードにはPocDeclarationが必要です");
    if (parsedAnswers.answers && isMode(value.requestedMode)) {
        const classified = classifyMode(parsedAnswers.answers, {
            requestedMode: value.requestedMode,
            poc: parsedPoc.poc,
            changedFiles: Array.isArray(changedFiles)
                ? changedFiles.filter(nonEmpty)
                : [],
        });
        if (value.mode !== classified.mode)
            errors.push(`modeが既存のモード判定結果${classified.mode}と一致しません`);
        if (Array.isArray(value.reasons) &&
            JSON.stringify(value.reasons) !== JSON.stringify(classified.reasons))
            errors.push("reasonsが既存のモード判定結果と一致しません");
    }
    if (errors.length > 0 ||
        !parsedAnswers.answers ||
        !isMode(value.mode) ||
        !isMode(value.requestedMode))
        return { errors };
    return {
        decision: {
            mode: value.mode,
            requestedMode: value.requestedMode,
            answers: parsedAnswers.answers,
            changedFiles: [...changedFiles],
            reasons: [...value.reasons],
            decidedAt: value.decidedAt,
            ...(typeof value.baselineHeadSha === "string"
                ? { baselineHeadSha: value.baselineHeadSha }
                : {}),
            ...(parsedPoc.poc ? { poc: parsedPoc.poc } : {}),
        },
        errors,
    };
}
export function inspectWorkflowStagingArtifacts(input) {
    const modeDecision = input.modeDecisionSource === undefined
        ? { errors: [`${MODE_DECISION_FILE}がありません`] }
        : parseModeDecision(input.modeDecisionSource);
    const journal = input.journalSource === undefined
        ? { entries: [], errors: [`${STEP_JOURNAL_FILE}がありません`] }
        : parseStepJournal(input.journalSource);
    const lastByStep = new Map();
    journal.entries.forEach((entry, index) => lastByStep.set(entry.step, { entry, index }));
    const firstFullIndex = journal.entries.findIndex((entry) => entry.mode === "full");
    const completedSteps = requiredSteps(input.mode).filter((step) => {
        const record = lastByStep.get(step);
        if (!record)
            return false;
        if (input.mode !== "full" || record.entry.mode === "full")
            return true;
        return ((step === 0 || step === 1) &&
            (firstFullIndex < 0 || record.index < firstFullIndex));
    });
    const currentStep = completedSteps.at(-1);
    const validation = validateStepJournal({
        mode: input.mode,
        entries: journal.entries,
        upToStep: input.upToStep ?? currentStep ?? 0,
    });
    const completed = new Set(completedSteps);
    const nextStep = requiredSteps(input.mode).find((step) => !completed.has(step));
    const errors = [
        ...journal.errors,
        ...modeDecision.errors,
        ...(modeDecision.decision && modeDecision.decision.mode !== input.mode
            ? [
                `モード判定成果物のmode ${modeDecision.decision.mode}がstaging recordのmode ${input.mode}と一致しません`,
            ]
            : []),
        ...validation.errors,
    ];
    return {
        staging: input.staging,
        mode: input.mode,
        state: input.state,
        modeDecision: {
            exists: input.modeDecisionSource !== undefined,
            valid: Boolean(modeDecision.decision) && modeDecision.errors.length === 0,
            errors: modeDecision.errors,
        },
        journal: {
            exists: input.journalSource !== undefined,
            valid: journal.errors.length === 0 && validation.valid,
            errors: journal.errors,
        },
        completedSteps,
        currentStep,
        nextStep,
        validation,
        errors,
        valid: errors.length === 0 && Boolean(modeDecision.decision) && validation.valid,
    };
}
export function completePullRequestWorkflow(created, staging, record, recovery = {
    operation: "PR作成",
    repeatAction: "PR作成",
    recoveryEvidence: "PR作成確認",
}) {
    try {
        return {
            exitCode: 0,
            output: { ...created, workflow: record() },
        };
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
            exitCode: 1,
            output: {
                ...created,
                workflow: {
                    recorded: false,
                    diagnostic: {
                        ruleId: "ASC-WORKFLOW-JOURNAL-001",
                        reasons: [
                            `${recovery.operation}後のStep 11記録に失敗しました: ${reason}`,
                        ],
                        next: `${recovery.operation}済みPR ${created.url ?? "（URL不明）"} と固定delivery stateを確認し、同じstagingを指定したdelivery専用コマンドでprovider read-backとStep 11記録を復旧してください。外部の${recovery.repeatAction}は再送せず、復旧後にworkflow verify --staging=${staging} --up-to=11で${recovery.recoveryEvidence}を確認してください`,
                    },
                },
            },
        };
    }
}
//# sourceMappingURL=workflow.js.map