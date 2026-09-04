import { isRecord } from "../types.js";
import { POC_HIGH_RISK_IDS, QUICK_DISQUALIFIER_IDS } from "./mode.js";
const methods = (...values) => Object.freeze(values);
const BASE_VERIFICATION = Object.freeze({
    "bug-fix": methods("bug-reproduction", "regression-test", "integration-test"),
    "new-feature": methods("acceptance-test", "integration-test", "build"),
    refactoring: methods("regression-test", "static-analysis", "type-check"),
    documentation: methods("schema-validation", "graph-conformance-check", "build"),
    configuration: methods("schema-validation", "contract-test", "integration-test"),
    migration: methods("runtime-validation", "rollback-validation", "compatibility-test"),
    "security-sensitive": methods("negative-test", "security-analysis", "static-analysis"),
    algorithm: methods("unit-test", "property-based-test", "differential-test"),
    api: methods("contract-test", "integration-test", "acceptance-test"),
    concurrency: methods("race-test", "stress-test", "invariant-test"),
});
const CHANGE_TYPES = Object.freeze([
    "bug-fix",
    "new-feature",
    "refactoring",
    "documentation",
    "configuration",
    "migration",
    "security-sensitive",
    "algorithm",
    "api",
    "concurrency",
]);
const CHANGE_RISKS = Object.freeze([
    "low",
    "medium",
    "high",
    "critical",
]);
function exactInputObject(value, label, fields) {
    if (!isRecord(value))
        throw new Error(`${label}はobjectが必要です`);
    const unknown = Object.keys(value).filter((field) => !fields.includes(field));
    if (unknown.length > 0)
        throw new Error(`${label}の未知fieldを拒否しました: ${unknown.join(", ")}`);
    const missing = fields.filter((field) => !Object.prototype.hasOwnProperty.call(value, field));
    if (missing.length > 0)
        throw new Error(`${label}の必須fieldがありません: ${missing.join(", ")}`);
    return value;
}
function nonEmptyStringArray(value, label) {
    if (!Array.isArray(value) || value.length === 0)
        throw new Error(`${label}は空でない文字列配列が必要です`);
    const strings = [];
    for (const item of value) {
        if (typeof item !== "string" || item.trim() === "")
            throw new Error(`${label}は空でない文字列配列が必要です`);
        strings.push(item);
    }
    return Object.freeze(strings);
}
function requiredBoolean(value, field, label) {
    if (typeof value[field] !== "boolean")
        throw new Error(`${label}.${field}はbooleanが必要です`);
    return value[field];
}
export function parseVerificationSelectionInput(value) {
    const input = exactInputObject(value, "Verification Set入力", [
        "changeType",
        "risk",
        "affectedBoundaries",
        "requirementIds",
        "acceptanceCriteriaIds",
        "impactAnalysis",
    ]);
    if (!CHANGE_TYPES.some((changeType) => changeType === input.changeType))
        throw new Error("Verification Set入力.changeTypeが不正です");
    if (!CHANGE_RISKS.some((risk) => risk === input.risk))
        throw new Error("Verification Set入力.riskが不正です");
    const impact = exactInputObject(input.impactAnalysis, "Verification Set入力.impactAnalysis", [
        "securityRelevant",
        "dataLossPossible",
        "irreversibleOperation",
        "externalContractChanged",
        "concurrentBehaviorChanged",
    ]);
    return {
        changeType: input.changeType,
        risk: input.risk,
        affectedBoundaries: nonEmptyStringArray(input.affectedBoundaries, "Verification Set入力.affectedBoundaries"),
        requirementIds: nonEmptyStringArray(input.requirementIds, "Verification Set入力.requirementIds"),
        acceptanceCriteriaIds: nonEmptyStringArray(input.acceptanceCriteriaIds, "Verification Set入力.acceptanceCriteriaIds"),
        impactAnalysis: Object.freeze({
            securityRelevant: requiredBoolean(impact, "securityRelevant", "Verification Set入力.impactAnalysis"),
            dataLossPossible: requiredBoolean(impact, "dataLossPossible", "Verification Set入力.impactAnalysis"),
            irreversibleOperation: requiredBoolean(impact, "irreversibleOperation", "Verification Set入力.impactAnalysis"),
            externalContractChanged: requiredBoolean(impact, "externalContractChanged", "Verification Set入力.impactAnalysis"),
            concurrentBehaviorChanged: requiredBoolean(impact, "concurrentBehaviorChanged", "Verification Set入力.impactAnalysis"),
        }),
    };
}
function requireIdentifiers(values, label) {
    if (values.length === 0 || values.some((value) => value.trim() === ""))
        throw new Error(`${label}を1件以上指定してください`);
}
export function selectVerificationSet(input) {
    requireIdentifiers(input.requirementIds, "Requirement ID");
    requireIdentifiers(input.acceptanceCriteriaIds, "Acceptance Criteria ID");
    if (input.affectedBoundaries.length === 0)
        throw new Error("Affected Boundaryを1件以上指定してください");
    const methods = new Set(BASE_VERIFICATION[input.changeType]);
    if (input.affectedBoundaries.length > 1)
        methods.add("integration-test");
    if (input.risk === "high" ||
        input.risk === "critical" ||
        input.impactAnalysis.securityRelevant) {
        methods.add("negative-test");
        methods.add("security-analysis");
    }
    if (input.impactAnalysis.dataLossPossible ||
        input.impactAnalysis.irreversibleOperation) {
        methods.add("regression-test");
        methods.add("rollback-validation");
    }
    if (input.impactAnalysis.externalContractChanged) {
        methods.add("contract-test");
        methods.add("integration-test");
    }
    if (input.impactAnalysis.concurrentBehaviorChanged) {
        methods.add("race-test");
        methods.add("invariant-test");
    }
    return {
        changeType: input.changeType,
        risk: input.risk,
        affectedBoundaries: Object.freeze([...input.affectedBoundaries]),
        requirementIds: Object.freeze([...input.requirementIds]),
        acceptanceCriteriaIds: Object.freeze([...input.acceptanceCriteriaIds]),
        impactAnalysis: Object.freeze({ ...input.impactAnalysis }),
        methods: Object.freeze([...methods]),
    };
}
export const CHANGED_CONTRACT_KINDS = Object.freeze([
    "domain-invariant",
    "requirement",
    "interface",
    "data",
    "design-responsibility",
    "non-functional",
    "operations",
]);
const CANONICAL_MODE_DISQUALIFIER_IDS = new Set([
    ...QUICK_DISQUALIFIER_IDS,
    ...POC_HIGH_RISK_IDS,
]);
function parseModeDisqualifiers(value) {
    if (!Array.isArray(value))
        throw new Error("実装中発見入力.modeDisqualifiersは配列が必要です");
    const ids = new Set();
    return Object.freeze(value.map((candidate, index) => {
        const label = `実装中発見入力.modeDisqualifiers[${index}]`;
        const item = exactInputObject(candidate, label, ["id", "evidence"]);
        const id = item.id;
        const evidence = item.evidence;
        if (typeof id !== "string" || id.trim() === "")
            throw new Error(`${label}.idは空でない文字列が必要です`);
        if (typeof evidence !== "string" || evidence.trim() === "")
            throw new Error(`${label}.evidenceは空でない文字列が必要です`);
        const normalizedId = id.trim();
        if (!CANONICAL_MODE_DISQUALIFIER_IDS.has(normalizedId))
            throw new Error(`実装中発見入力.modeDisqualifiersの未知idを拒否しました: ${normalizedId}`);
        if (ids.has(normalizedId))
            throw new Error(`実装中発見入力.modeDisqualifiersの重複idを拒否しました: ${normalizedId}`);
        ids.add(normalizedId);
        return Object.freeze({ id: normalizedId, evidence });
    }));
}
function parseChangedContractKinds(value) {
    if (!Array.isArray(value))
        throw new Error("実装中発見入力.changedContractKindsは配列が必要です");
    const seen = new Set();
    const kinds = [];
    for (const candidate of value) {
        if (typeof candidate !== "string" ||
            !CHANGED_CONTRACT_KINDS.some((kind) => kind === candidate))
            throw new Error(`実装中発見入力.changedContractKindsの未知値を拒否しました: ${String(candidate)}`);
        const kind = candidate;
        if (seen.has(kind))
            throw new Error(`実装中発見入力.changedContractKindsの重複値を拒否しました: ${kind}`);
        seen.add(kind);
        kinds.push(kind);
    }
    return Object.freeze(kinds);
}
export function parseImplementationDiscoveryInput(value) {
    const input = exactInputObject(value, "実装中発見入力", [
        "discoveryId",
        "workflowMode",
        "modeDisqualifiers",
        "changedContractKinds",
        "changesGoal",
        "changesScope",
        "changesAcceptanceCriteria",
        "expandsSecurityBoundary",
        "introducesIrreversibleOperation",
    ]);
    if (input.workflowMode !== "full" &&
        input.workflowMode !== "quick" &&
        input.workflowMode !== "poc")
        throw new Error("実装中発見入力.workflowModeが不正です");
    if (typeof input.discoveryId !== "string" ||
        !/^DISC-[A-Z0-9][A-Z0-9._-]{0,122}$/u.test(input.discoveryId))
        throw new Error("実装中発見入力.discoveryIdはDISC-で始まる安定IDが必要です");
    return Object.freeze({
        discoveryId: input.discoveryId,
        workflowMode: input.workflowMode,
        modeDisqualifiers: parseModeDisqualifiers(input.modeDisqualifiers),
        changedContractKinds: parseChangedContractKinds(input.changedContractKinds),
        changesGoal: requiredBoolean(input, "changesGoal", "実装中発見入力"),
        changesScope: requiredBoolean(input, "changesScope", "実装中発見入力"),
        changesAcceptanceCriteria: requiredBoolean(input, "changesAcceptanceCriteria", "実装中発見入力"),
        expandsSecurityBoundary: requiredBoolean(input, "expandsSecurityBoundary", "実装中発見入力"),
        introducesIrreversibleOperation: requiredBoolean(input, "introducesIrreversibleOperation", "実装中発見入力"),
    });
}
const DISCOVERY_RECORD_FIELDS = Object.freeze([
    "discoveryId",
    "fact",
    "impact",
    "decision",
    "action",
    "verification",
    "specificationUpdate",
]);
const FULL_CONTRACT_ARTIFACTS = Object.freeze([
    "00_要求定義.md",
    "01_要件定義.md",
    "02_設計.md",
    "03_実装計画.md",
]);
export function assessImplementationDiscovery(discovery) {
    const workflowMode = discovery.workflowMode;
    const modeDisqualifiers = Object.freeze(discovery.modeDisqualifiers.map((item) => Object.freeze({ ...item })));
    const contractChanged = discovery.changesGoal ||
        discovery.changesScope ||
        discovery.changesAcceptanceCriteria ||
        discovery.expandsSecurityBoundary ||
        discovery.introducesIrreversibleOperation ||
        discovery.changedContractKinds.length > 0 ||
        discovery.modeDisqualifiers.length > 0;
    if (!contractChanged)
        return {
            discoveryId: discovery.discoveryId,
            workflowMode,
            modeDisqualifiers,
            disposition: "continue",
            affectedArtifacts: Object.freeze([]),
            requiredRecordFields: DISCOVERY_RECORD_FIELDS,
        };
    if (discovery.workflowMode === "quick") {
        const mustPromote = discovery.expandsSecurityBoundary ||
            discovery.introducesIrreversibleOperation ||
            discovery.modeDisqualifiers.length > 0;
        return {
            discoveryId: discovery.discoveryId,
            workflowMode,
            modeDisqualifiers,
            disposition: mustPromote
                ? "promote-to-full"
                : "rebaseline-affected-contracts",
            affectedArtifacts: Object.freeze(mustPromote ? FULL_CONTRACT_ARTIFACTS : ["00_要求定義.md"]),
            requiredRecordFields: DISCOVERY_RECORD_FIELDS,
        };
    }
    if (discovery.workflowMode === "poc") {
        const unsafeForPoc = discovery.expandsSecurityBoundary ||
            discovery.introducesIrreversibleOperation ||
            discovery.modeDisqualifiers.length > 0;
        return {
            discoveryId: discovery.discoveryId,
            workflowMode,
            modeDisqualifiers,
            disposition: unsafeForPoc
                ? "stop-or-promote-full"
                : "rebaseline-affected-contracts",
            affectedArtifacts: Object.freeze(unsafeForPoc ? [] : ["00_要求定義.md"]),
            ...(unsafeForPoc ? { promotionArtifacts: FULL_CONTRACT_ARTIFACTS } : {}),
            requiredRecordFields: DISCOVERY_RECORD_FIELDS,
        };
    }
    const affected = new Set();
    if (discovery.changesGoal || discovery.changesScope)
        affected.add("00_要求定義.md");
    if (discovery.changesGoal ||
        discovery.changesScope ||
        discovery.changesAcceptanceCriteria ||
        discovery.expandsSecurityBoundary ||
        discovery.introducesIrreversibleOperation ||
        discovery.changedContractKinds.length > 0 ||
        discovery.modeDisqualifiers.length > 0) {
        affected.add("01_要件定義.md");
        affected.add("02_設計.md");
        affected.add("03_実装計画.md");
    }
    return {
        discoveryId: discovery.discoveryId,
        workflowMode,
        modeDisqualifiers,
        disposition: "rebaseline-affected-contracts",
        affectedArtifacts: Object.freeze([...affected]),
        requiredRecordFields: DISCOVERY_RECORD_FIELDS,
    };
}
export function assertWorkflowMergeAllowed(workflowMode) {
    if (workflowMode === "poc")
        throw new Error("PoCはPRが停止点でありpr mergeを実行できません");
}
export function decideDeliveryContinuation(input) {
    if (input.workflowMode === "poc" || input.trustedMergeMode === "disabled")
        return "stop-at-pr";
    if (input.trustedMergeMode === "assisted" && !input.assistedAuthorityVerified)
        return "wait-authority";
    if (!input.mergeReadyVerified)
        return "wait-merge-ready";
    return "invoke-pr-merge";
}
//# sourceMappingURL=agile-verification.js.map