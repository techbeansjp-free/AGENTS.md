import fs from "node:fs";
import path from "node:path";
import { resolveContained } from "../lib/security.js";
import { isRecord } from "../types.js";
const IDS = Array.from({ length: 12 }, (_, index) => `I${index + 1}`);
const CONTRACT_FIELDS = [
    "id",
    "name",
    "statement",
    "sourceHook",
    "enforcementHooks",
    "evidenceHooks",
    "rollback",
];
const BINDING_FIELDS = [
    "id",
    "status",
    "reason",
    "evidence",
    "sourcePaths",
    "enforcement",
    "counterexampleScenarios",
];
const SAFE_BINDING_PATH = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)(?!.*\\)(?!.*\/$)[^\u0000]+$/u;
const CHECK_ID = /^[a-z][a-z0-9-]{0,63}$/u;
const CHECK_ID_MAX_LENGTH = 64;
export const DEVELOPMENT_CONSIDERATION_IDS = [
    "DC-PRIVACY",
    "DC-OBSERVABILITY",
    "DC-UX",
    "DC-TOKENS",
];
const PROJECT_RULE_PREFIX = ["ASC", "DOGFOOD"].join("-");
export const PROJECT_RULE_ENFORCEMENT_POINTS = Object.fromEntries([
    ["CI-PERMISSION-001", "checkQualityCiPermissions"],
    ["CI-TRIGGER-001", "checkQualityCiTriggers"],
    ["CODE-QUALITY-001", "checkQualityCommands"],
    ["DISTRIBUTION-BOUNDARY-001", "checkPackageDistributionBoundary"],
    ["DOCS-001", "checkJapaneseDocuments"],
    ["DOGFOODING-001", "checkConformance"],
    ["JAPANESE-DOCS-001", "checkJapaneseDocuments"],
    ["LOCKFILE-001", "checkPackageManagerBoundary"],
    ["NAMING-EXCEPTION-001", "checkFixedMarkdownNames"],
    ["NO-REGISTRY-PUBLISH-001", "checkRegistryPublishProhibition"],
    ["NUMBERED-MARKDOWN-001", "checkFixedMarkdownNames"],
    ["OWNERSHIP-LOCAL-001", "validateOwnershipBoundary"],
    ["OWNERSHIP-PR-001", "validateOwnershipBoundary"],
    ["PACKAGE-001", "checkPackageDistributionBoundary"],
    ["PACKAGE-MANAGER-001", "checkPackageManagerBoundary"],
    ["DISTRIBUTION-IMPACT-001", "validateDistributionImpact"],
    ["QUALITY-COMMAND-001", "checkQualityCommands"],
    ["REVIEW-EXCEPTION-001", "validateReviewExceptions"],
    ["RUNTIME-001", "checkNodeRuntimeAlignment"],
    ["SAFETY-001", "checkTrustedPolicyBoundary"],
].map(([suffix, point]) => [`${PROJECT_RULE_PREFIX}-${suffix}`, point]));
export const CANONICAL_SINGLE_SOURCE_RULE_ID = "ASC-CANON-SINGLE-SOURCE-001";
export const CANONICAL_SCAN_LOCATIONS = [
    ".agent-skill-chain/docs/",
    ".agent-skill-chain/templates/",
    "docs/specs/",
];
const CANONICAL_REGISTRY_FIELDS = ["schemaVersion", "contracts"];
const CANONICAL_CONTRACT_FIELDS = [
    "contractId",
    "canonical",
    "tokens",
    "reason",
];
const CANONICAL_CONTRACT_ID = /^CANON-CONTRACT-[A-Z0-9-]+$/u;
const MARKDOWN_LINK = /\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/gu;
const MARKDOWN_LINK_DEFINITION = /^[^\S\n]*\[[^\]]+\]:[^\S\n]*(\S+)/gmu;
function inCanonicalScanLocation(relative) {
    return CANONICAL_SCAN_LOCATIONS.some((location) => relative.startsWith(location));
}
/**
 * 規範を宣言するlocation配下のMarkdownだけを走査対象にする。
 * 証跡、一時ステージング、実装は規範を宣言しないため除外する。
 */
export function collectCanonicalScanTargets(relativePaths) {
    return relativePaths.filter((relative) => relative.endsWith(".md") &&
        !relative.includes("..") &&
        inCanonicalScanLocation(relative));
}
export function validateCanonicalContracts(value, existingPaths) {
    const errors = [];
    if (!isRecord(value))
        return {
            contracts: [],
            errors: ["契約正本registryはobjectでなければなりません"],
        };
    const unknownTopLevel = Object.keys(value).find((key) => !CANONICAL_REGISTRY_FIELDS.includes(key));
    if (unknownTopLevel !== undefined)
        errors.push(`契約正本registryに未知のfieldがあります: ${unknownTopLevel}`);
    if (value.schemaVersion !== "agent-skill-chain/canonical-contracts/v1")
        errors.push("契約正本registryのschemaVersionが未知です");
    if (!Array.isArray(value.contracts))
        return {
            contracts: [],
            errors: [...errors, "契約正本registryのcontractsは配列が必要です"],
        };
    const contracts = [];
    const seen = new Set();
    for (const [index, entry] of value.contracts.entries()) {
        const label = `contracts[${index}]`;
        if (!isRecord(entry)) {
            errors.push(`${label}はobjectでなければなりません`);
            continue;
        }
        const unknownField = Object.keys(entry).find((key) => !CANONICAL_CONTRACT_FIELDS.includes(key));
        if (unknownField !== undefined)
            errors.push(`${label}に未知のfieldがあります: ${unknownField}`);
        const { contractId, canonical, tokens, reason } = entry;
        if (typeof contractId !== "string" ||
            !CANONICAL_CONTRACT_ID.test(contractId)) {
            errors.push(`${label}のcontractIdはCANON-CONTRACT-で始まる識別子が必要です`);
            continue;
        }
        if (seen.has(contractId)) {
            errors.push(`契約IDが重複しています: ${contractId}`);
            continue;
        }
        seen.add(contractId);
        if (typeof canonical !== "string" || canonical.length === 0) {
            errors.push(`${contractId}のcanonicalはrepository相対pathが必要です`);
            continue;
        }
        if (!inCanonicalScanLocation(canonical))
            errors.push(`${contractId}のcanonicalが規範宣言location外を指しています: ${canonical}`);
        else if (!existingPaths.has(canonical))
            errors.push(`${contractId}のcanonicalが実在しません: ${canonical}`);
        if (!Array.isArray(tokens) ||
            tokens.length === 0 ||
            tokens.some((token) => typeof token !== "string" || token.length === 0)) {
            errors.push(`${contractId}のtokensは空でない文字列の配列が必要です`);
            continue;
        }
        if (typeof reason !== "string" || reason.length === 0) {
            errors.push(`${contractId}のreasonが必要です`);
            continue;
        }
        contracts.push({
            contractId,
            canonical,
            tokens: tokens,
            reason,
        });
    }
    return { contracts: errors.length > 0 ? [] : contracts, errors };
}
/**
 * Markdownのlink targetを比較可能な形へ揃える。
 * anchor、title、山括弧、percent encodeはいずれも正当な記法であり、
 * 正本pathが日本語のため「リンクをコピー」はpercent encode形を生む。
 */
function normalizeLinkTarget(raw) {
    let target = raw.trim();
    if (target.startsWith("<") && target.endsWith(">"))
        target = target.slice(1, -1).trim();
    const anchor = target.indexOf("#");
    if (anchor >= 0)
        target = target.slice(0, anchor);
    if (target.length === 0)
        return undefined;
    try {
        return decodeURIComponent(target);
    }
    catch {
        return target;
    }
}
function referencesCanonical(sourcePath, text, canonical) {
    const base = path.posix.dirname(sourcePath);
    const targets = [
        ...[...text.matchAll(MARKDOWN_LINK)].map((matched) => matched[1]),
        ...[...text.matchAll(MARKDOWN_LINK_DEFINITION)].map((matched) => matched[1]),
    ];
    for (const raw of targets) {
        if (raw === undefined)
            continue;
        const target = normalizeLinkTarget(raw);
        if (target === undefined)
            continue;
        const resolved = target.startsWith("/")
            ? path.posix.normalize(target.slice(1))
            : path.posix.normalize(path.posix.join(base, target));
        if (resolved === canonical)
            return true;
    }
    return false;
}
/**
 * 参照の存在だけを判定し、記述内容の一致を判定しない。
 * 内容一致検査は複製問題を機械化しただけになり同じ分岐を再生産するため採らない。
 */
export function detectCanonicalDuplication(input) {
    const violations = [];
    const errors = [];
    for (const file of input.files) {
        if (file.text === null) {
            errors.push(`走査対象を読み取れませんでした: ${file.path}`);
            continue;
        }
        for (const contract of input.contracts) {
            if (file.path === contract.canonical)
                continue;
            if (!contract.tokens.some((token) => file.text?.includes(token)))
                continue;
            if (referencesCanonical(file.path, file.text, contract.canonical))
                continue;
            violations.push({
                path: file.path,
                contractId: contract.contractId,
                canonical: contract.canonical,
                ruleId: CANONICAL_SINGLE_SOURCE_RULE_ID,
                remediation: `${CANONICAL_SINGLE_SOURCE_RULE_ID}: 複製した記述を削除し、${contract.canonical}へのMarkdown linkへ置き換えてください`,
            });
        }
    }
    return { violations, errors };
}
const PROJECT_RULE_FIELDS = [
    "ruleId",
    "purpose",
    "riskClass",
    "scope",
    "enforcement",
    "activation",
    "owner",
    "targetLayer",
    "evidence",
    "remediation",
    "overridePolicy",
    "rollback",
];
const PROJECT_RULE_METADATA_FIELDS = [
    "packageDefault",
    "projectOverride",
    "changeAuthority",
];
const PROJECT_RULE_ID = /\bASC-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/gu;
function projectRuleIds(source) {
    return new Set(source.match(PROJECT_RULE_ID) ?? []);
}
export function validateProjectRuleLedgerEntry(value, label = "rule") {
    const errors = [];
    if (!isRecord(value))
        return { valid: false, errors: [`${label}はobjectでなければなりません`] };
    for (const field of PROJECT_RULE_FIELDS)
        if (value[field] === undefined)
            errors.push(`${label}.${field}が必要です`);
    for (const field of [
        "ruleId",
        "purpose",
        "riskClass",
        "owner",
        "evidence",
        "remediation",
        "rollback",
    ])
        if (!text(value[field]))
            errors.push(`${label}.${field}は空でない文字列でなければなりません`);
    if (typeof value.ruleId !== "string" ||
        !/^ASC-[A-Z0-9]+(?:-[A-Z0-9]+)*$/u.test(value.ruleId))
        errors.push(`${label}.ruleIdはASC-で始まる安定IDでなければなりません`);
    if (!strings(value.scope))
        errors.push(`${label}.scopeは重複のない非空文字列配列でなければなりません`);
    if (!["deny", "require", "assist", "warn", "record"].includes(String(value.enforcement)))
        errors.push(`${label}.enforcementが不正です`);
    const metadataCount = PROJECT_RULE_METADATA_FIELDS.filter((field) => value[field] !== undefined).length;
    if (metadataCount !== 0 &&
        metadataCount !== PROJECT_RULE_METADATA_FIELDS.length)
        errors.push(`${label}のpackageDefault、projectOverride、changeAuthorityは3fieldを同時に指定してください`);
    for (const field of PROJECT_RULE_METADATA_FIELDS)
        if (value[field] !== undefined && !text(value[field]))
            errors.push(`${label}.${field}は空でない文字列でなければなりません`);
    return { valid: errors.length === 0, errors };
}
export function buildRuleCoverage(input) {
    const normativeIds = projectRuleIds(input.normativeText);
    const schemaIds = projectRuleIds(input.schemaText);
    const runtimeIds = projectRuleIds(input.runtimeText);
    const ciIds = projectRuleIds(input.ciText);
    const definedIds = new Set(input.rules.flatMap((rule) => isRecord(rule) &&
        typeof rule.ruleId === "string" &&
        /^ASC-[A-Z0-9]+(?:-[A-Z0-9]+)*$/u.test(rule.ruleId)
        ? [rule.ruleId]
        : []));
    const rowIds = new Set([
        ...definedIds,
        ...normativeIds,
        ...schemaIds,
        ...ciIds,
    ]);
    const rows = [...rowIds]
        .sort((left, right) => left.localeCompare(right, "en"))
        .map((ruleId) => ({
        ruleId,
        normative: normativeIds.has(ruleId),
        schema: schemaIds.has(ruleId),
        runtime: runtimeIds.has(ruleId),
        ci: ciIds.has(ruleId),
    }));
    const orphans = [];
    for (const row of rows) {
        if (definedIds.has(row.ruleId) && !row.runtime && !row.ci)
            orphans.push({
                ruleId: row.ruleId,
                reason: "rule fileに存在しますがruntimeにもCIにもenforcement pointがありません",
            });
        if (row.normative && !definedIds.has(row.ruleId))
            orphans.push({
                ruleId: row.ruleId,
                reason: "規範文書に存在しますがproject policyに定義されていません",
            });
        if (row.schema && !row.runtime)
            orphans.push({
                ruleId: row.ruleId,
                reason: "schemaに存在しますがruntimeで検証されていません",
            });
        if (row.ci &&
            !definedIds.has(row.ruleId) &&
            !row.normative &&
            !row.schema &&
            !row.runtime)
            orphans.push({
                ruleId: row.ruleId,
                reason: "CIだけに存在する暗黙ruleです",
            });
    }
    return { rows, orphans };
}
export function validateDevelopmentConsiderationRecords(value, label = "document") {
    const errors = [];
    if (!Array.isArray(value))
        return {
            valid: false,
            errors: [`${label}: 開発契約の適用判断は配列でなければなりません`],
            checked: DEVELOPMENT_CONSIDERATION_IDS,
        };
    const records = value.filter(isRecord);
    if (records.length !== value.length)
        errors.push(`${label}: 開発契約の適用判断にobject以外があります`);
    for (const id of DEVELOPMENT_CONSIDERATION_IDS) {
        const matches = records.filter((record) => record.id === id);
        if (matches.length !== 1) {
            errors.push(`${label}: ${id}は重複なく1件必要です`);
            continue;
        }
        const record = matches[0] ?? {};
        if (record.status !== "applicable" && record.status !== "not-applicable")
            errors.push(`${label}: ${id}の判定はapplicableまたはnot-applicableでなければなりません`);
        for (const [field, minimum] of [
            ["reason", 8],
            ["evidence", 4],
        ]) {
            const fieldValue = record[field];
            if (typeof fieldValue !== "string" ||
                fieldValue.trim().length < minimum ||
                /^(?:-|なし|未定|不明|x+)$/iu.test(fieldValue.trim()) ||
                /[（{][^）}]+[）}]/u.test(fieldValue))
                errors.push(`${label}: ${id}の${field === "reason" ? "理由" : "証拠"}が具体化されていません`);
        }
    }
    for (const record of records)
        if (typeof record.id !== "string" ||
            !DEVELOPMENT_CONSIDERATION_IDS.some((id) => id === record.id))
            errors.push(`${label}: ${String(record.id ?? "unknown")}は未知の開発契約IDです`);
    return {
        valid: errors.length === 0,
        errors,
        checked: DEVELOPMENT_CONSIDERATION_IDS,
    };
}
export function validateDevelopmentConsiderations(markdown, label = "document") {
    const rows = [];
    for (const line of markdown.split(/\r?\n/u)) {
        const cells = line
            .split("|")
            .slice(1, -1)
            .map((cell) => cell.trim());
        const id = cells[0];
        if (typeof id !== "string" ||
            !DEVELOPMENT_CONSIDERATION_IDS.some((expected) => expected === id))
            continue;
        rows.push({
            id,
            status: cells[2] ?? "",
            reason: cells[3] ?? "",
            evidence: cells[4] ?? "",
        });
    }
    return validateDevelopmentConsiderationRecords(rows, label);
}
function text(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function strings(value) {
    return (Array.isArray(value) &&
        value.length > 0 &&
        value.every(text) &&
        new Set(value).size === value.length);
}
function bindingStatus(value) {
    if (value.status === undefined || value.status === "applicable")
        return "applicable";
    return value.status === "not-applicable" ? value.status : undefined;
}
function enforcementPointKey(point) {
    if (!isRecord(point))
        return "";
    const kind = point.kind === undefined ? "module-export" : String(point.kind);
    const relative = typeof point.path === "string"
        ? path.posix.normalize(point.path.normalize("NFC"))
        : "";
    const reference = kind === "module-export"
        ? String(point.export ?? "")
        : kind === "file-entrypoint"
            ? String(point.runner ?? "")
            : String(point.checkId ?? "");
    return `${kind}\u0000${relative}\u0000${reference}`;
}
export function checkIdForRuleId(ruleId) {
    if (!/^ASC-[A-Z0-9]+(?:-[A-Z0-9]+)*$/u.test(ruleId))
        return undefined;
    const checkId = ruleId.slice("ASC-".length).toLowerCase();
    return CHECK_ID.test(checkId) ? checkId : undefined;
}
const DIAGNOSTIC_CHECK_ID_LIMIT = 20;
const DIAGNOSTIC_RULE_ID_LIMIT = 3;
function diagnosticRuleId(ruleId) {
    return JSON.stringify(ruleId.slice(0, CHECK_ID_MAX_LENGTH));
}
function unregisteredCheckRefMessage(input) {
    const underivableRuleIds = new Set();
    for (const rule of input.rules) {
        if (!isRecord(rule) || typeof rule.ruleId !== "string")
            continue;
        if (checkIdForRuleId(rule.ruleId) === undefined)
            underivableRuleIds.add(rule.ruleId);
    }
    const sortedCheckIds = [...input.registeredCheckIds].sort();
    const shownCheckIds = sortedCheckIds.slice(0, DIAGNOSTIC_CHECK_ID_LIMIT);
    const registered = sortedCheckIds.length === 0
        ? "登録済みcheckIdは0件です"
        : `登録済みcheckId(${sortedCheckIds.length}件): ${shownCheckIds.join(", ")}${sortedCheckIds.length > shownCheckIds.length
            ? `, ほか${sortedCheckIds.length - shownCheckIds.length}件`
            : ""}`;
    const parts = [
        `${input.prefix}check-refがproject ruleへ登録されていません: ${input.checkId}`,
        "checkIdはproject ruleのruleIdから接頭辞ASC-を除いて小文字化した値です",
        "規則の正本は`.agent-skill-chain/docs/00_運用ポリシー.md`の「conformance scopeと適用可否」節です",
        registered,
    ];
    if (underivableRuleIds.size > 0)
        parts.push(`導出できないruleId(${underivableRuleIds.size}件): ${[
            ...underivableRuleIds,
        ]
            .sort()
            .slice(0, DIAGNOSTIC_RULE_ID_LIMIT)
            .map(diagnosticRuleId)
            .join(", ")}`);
    return parts.join("。");
}
export function validateConformanceContract(contract) {
    const errors = [];
    if (!isRecord(contract))
        return {
            valid: false,
            errors: ["contractはobjectでなければなりません"],
            invariants: [],
        };
    for (const key of Object.keys(contract))
        if (!["schemaVersion", "invariants"].includes(key))
            errors.push(`contract.${key}は未知fieldです`);
    if (contract.schemaVersion !== "agent-skill-chain/conformance/v1")
        errors.push("conformance schemaVersionが不正です");
    if (!Array.isArray(contract.invariants))
        errors.push("invariantsは配列でなければなりません");
    else {
        const ids = contract.invariants.map((item) => isRecord(item) ? item.id : undefined);
        if (contract.invariants.length !== 12)
            errors.push("invariantsはexact 12件でなければなりません");
        for (const id of IDS)
            if (ids.filter((item) => item === id).length !== 1)
                errors.push(`${id}は重複なく1件必要です`);
        for (const id of ids)
            if (typeof id !== "string" || !IDS.includes(id))
                errors.push(`${String(id ?? "unknown")}は未知invariantです`);
        for (const item of contract.invariants) {
            if (!isRecord(item)) {
                errors.push("invariantはobjectでなければなりません");
                continue;
            }
            for (const field of CONTRACT_FIELDS)
                if (item[field] === undefined)
                    errors.push(`${item.id ?? "unknown"}.${field}が必要です`);
            for (const field of Object.keys(item))
                if (!CONTRACT_FIELDS.includes(field))
                    errors.push(`${item.id ?? "unknown"}.${field}は未知fieldです`);
            for (const field of ["name", "statement", "sourceHook", "rollback"])
                if (!text(item[field]))
                    errors.push(`${item.id ?? "unknown"}.${field}は空でない文字列でなければなりません`);
            for (const field of ["enforcementHooks", "evidenceHooks"])
                if (!strings(item[field]))
                    errors.push(`${item.id ?? "unknown"}.${field}は重複のない非空文字列配列でなければなりません`);
        }
    }
    return {
        valid: errors.length === 0,
        errors,
        invariants: contract.invariants ?? [],
    };
}
/** Keep shape validation separate so candidate data cannot trigger filesystem reads before its paths are proven safe. */
export function validateProjectConformanceBinding(binding, rulesInput) {
    const errors = [];
    if (!isRecord(binding))
        return { valid: false, errors: ["bindingはobjectでなければなりません"] };
    for (const key of Object.keys(binding))
        if (!["schemaVersion", "bindings"].includes(key))
            errors.push(`binding.${key}は未知fieldです`);
    if (binding.schemaVersion !== "agent-skill-chain/project-conformance/v1")
        errors.push("binding schemaVersionが不正です");
    const bindings = Array.isArray(binding.bindings) ? binding.bindings : [];
    const registeredCheckIds = rulesInput === undefined
        ? undefined
        : new Set((Array.isArray(rulesInput) ? rulesInput : []).flatMap((rule) => {
            if (!isRecord(rule) || typeof rule.ruleId !== "string")
                return [];
            const checkId = checkIdForRuleId(rule.ruleId);
            return checkId ? [checkId] : [];
        }));
    if (rulesInput !== undefined && !Array.isArray(rulesInput))
        errors.push("project rulesは配列でなければなりません");
    if (bindings.length !== 12)
        errors.push("bindingsはexact 12件でなければなりません");
    const ids = bindings.map((item) => (isRecord(item) ? item.id : undefined));
    for (const id of IDS)
        if (ids.filter((item) => item === id).length !== 1)
            errors.push(`binding ${id}は重複なく1件必要です`);
    for (const id of ids)
        if (typeof id !== "string" || !IDS.includes(id))
            errors.push(`binding ${String(id ?? "unknown")}は未知invariantです`);
    for (const item of bindings) {
        if (!isRecord(item)) {
            errors.push("binding itemはobjectでなければなりません");
            continue;
        }
        if (item.id === undefined)
            errors.push(`${item.id ?? "unknown"}.idが必要です`);
        for (const field of Object.keys(item))
            if (!BINDING_FIELDS.includes(field))
                errors.push(`${item.id ?? "unknown"}.${field}は未知fieldです`);
        const status = bindingStatus(item);
        if (!status)
            errors.push(`${String(item.id)}.statusが不正です`);
        if (status === "not-applicable") {
            if (!text(item.reason))
                errors.push(`${String(item.id)}.reasonが必要です`);
            if (!text(item.evidence))
                errors.push(`${String(item.id)}.evidenceが必要です`);
            for (const field of [
                "sourcePaths",
                "enforcement",
                "counterexampleScenarios",
            ])
                if (item[field] !== undefined)
                    errors.push(`${String(item.id)}.${field}はnot-applicableでは指定できません`);
            continue;
        }
        if (item.reason !== undefined || item.evidence !== undefined)
            errors.push(`${String(item.id)}のreason/evidenceはnot-applicableでだけ指定できます`);
        if (!strings(item.sourcePaths))
            errors.push(`${item.id}.sourcePathsが不正です`);
        if (!strings(item.counterexampleScenarios) ||
            item.counterexampleScenarios.some((id) => !/^SCN-[A-Z0-9-]+$/u.test(id)))
            errors.push(`${String(item.id)}.counterexampleScenariosが不正です`);
        const enforcement = Array.isArray(item.enforcement) ? item.enforcement : [];
        if (enforcement.length === 0)
            errors.push(`${item.id}.enforcementが必要です`);
        const enforcementTuples = enforcement.map(enforcementPointKey);
        if (new Set(enforcementTuples).size !== enforcementTuples.length)
            errors.push(`${item.id}.enforcementのpath/export tupleが重複しています`);
        for (const point of enforcement) {
            if (!isRecord(point)) {
                errors.push(`${String(item.id)}.enforcement itemが不正です`);
                continue;
            }
            const kind = point.kind === undefined ? "module-export" : point.kind;
            const allowed = kind === "module-export"
                ? ["kind", "path", "export"]
                : kind === "file-entrypoint"
                    ? ["kind", "path", "runner"]
                    : kind === "check-ref"
                        ? ["kind", "checkId"]
                        : ["kind"];
            for (const key of Object.keys(point))
                if (!allowed.includes(key))
                    errors.push(`${item.id}.enforcement.${key}は未知fieldです`);
            if (kind === "module-export") {
                if (!text(point.path) || !text(point.export))
                    errors.push(`${item.id}.module-exportはpathとexportが必要です`);
                else if (!SAFE_BINDING_PATH.test(point.path))
                    errors.push(`${item.id}.enforcement.pathが不正です`);
            }
            else if (kind === "file-entrypoint") {
                if (!text(point.path) || !text(point.runner))
                    errors.push(`${item.id}.file-entrypointはpathとrunnerが必要です`);
                else if (!SAFE_BINDING_PATH.test(point.path))
                    errors.push(`${item.id}.enforcement.pathが不正です`);
            }
            else if (kind === "check-ref") {
                if (!text(point.checkId) || !CHECK_ID.test(point.checkId))
                    errors.push(`${item.id}.check-ref.checkIdが不正です`);
                else if (registeredCheckIds !== undefined &&
                    !registeredCheckIds.has(point.checkId))
                    errors.push(unregisteredCheckRefMessage({
                        prefix: `${item.id}.`,
                        checkId: point.checkId,
                        registeredCheckIds,
                        rules: Array.isArray(rulesInput) ? rulesInput : [],
                    }));
            }
            else
                errors.push(`${item.id}.enforcement.kindが不正です`);
        }
    }
    return { valid: errors.length === 0, errors };
}
/**
 * 実行されないtextを空白へ落とし、commentやliteralの中の名前だけでconformanceを満たせないようにする。
 *
 * **推測しない。** `/`が正規表現literalか除算かを確信できない位置では`undefined`を返し、呼び出し側が
 * 検査不能として扱う。当てにいくと、外れた入力でliteralやcommentの中身がcodeとして漏れる。
 * 2026-08-27の実測では、`1. / 2`の除算を正規表現と誤読した結果、直後のblock commentの中身が
 * codeとして残り、**存在しないexportが実在と誤認された。**
 *
 * 正規表現literalは改行を含めない。走査が正規表現状態のまま改行へ達したら、それは`/`の判定が
 * 誤りだったことの証明である。**その場で`undefined`を返す。**
 *
 * template literalの`${}`は深さを数える。内側templateの開始backtickを外側の終端と誤認すると、
 * literalの中身がcodeとして漏れる。
 *
 * @returns 実行されるtextだけを残したsource。判定できない、または走査が脱線した場合は`undefined`
 */
function executableSource(source) {
    /** 直前の有意token。識別子は語全体を保持する。 */
    let previous = "";
    /** `${`で開いた区画の外側brace深さ。空でなければtemplateの内側にいる。 */
    const templateDepths = [];
    let braceDepth = 0;
    let result = "";
    let state = "code";
    let escaped = false;
    for (let index = 0; index < source.length; index += 1) {
        const current = source[index];
        const next = source[index + 1];
        if (state === "code") {
            if (current === "/" && next === "/") {
                result += "  ";
                index += 1;
                state = "line-comment";
                continue;
            }
            if (current === "/" && next === "*") {
                result += "  ";
                index += 1;
                state = "block-comment";
                continue;
            }
            if (current === "'" || current === '"' || current === "`") {
                result += " ";
                state = current;
                escaped = false;
                previous = "";
                continue;
            }
            if (current === "/") {
                const kind = slashKind(previous);
                if (kind === "unknown")
                    return undefined;
                if (kind === "regex") {
                    result += " ";
                    state = "regex";
                    escaped = false;
                    previous = "";
                    continue;
                }
            }
            if (current === "{")
                braceDepth += 1;
            else if (current === "}") {
                const opened = templateDepths.at(-1);
                if (opened !== undefined && opened === braceDepth) {
                    templateDepths.pop();
                    result += " ";
                    state = "`";
                    escaped = false;
                    previous = "";
                    continue;
                }
                braceDepth -= 1;
            }
            result += current;
            if (!isSpace(current))
                previous =
                    /[\w$]/u.test(current) && /[\w$]$/u.test(previous)
                        ? previous + current
                        : current;
            continue;
        }
        if (state === "line-comment") {
            if (isLineTerminator(current)) {
                result += current;
                state = "code";
                previous = "";
            }
            else
                result += " ";
            continue;
        }
        if (state === "block-comment") {
            if (current === "*" && next === "/") {
                result += "  ";
                index += 1;
                state = "code";
                previous = "";
            }
            else
                result += isLineTerminator(current) ? current : " ";
            continue;
        }
        if (state === "regex" || state === "regex-class") {
            /** 正規表現literalは改行を含めない。到達したら`/`の判定が誤りだった証明である。 */
            if (isLineTerminator(current))
                return undefined;
            if (escaped) {
                result += " ";
                escaped = false;
                continue;
            }
            if (current === "\\") {
                result += " ";
                escaped = true;
                continue;
            }
            if (state === "regex" && current === "[") {
                result += " ";
                state = "regex-class";
                continue;
            }
            if (state === "regex-class" && current === "]") {
                result += " ";
                state = "regex";
                continue;
            }
            if (state === "regex" && current === "/") {
                result += " ";
                state = "code";
                previous = "/";
                continue;
            }
            result += " ";
            continue;
        }
        if (escaped) {
            result += isLineTerminator(current) ? current : " ";
            escaped = false;
            continue;
        }
        if (current === "\\") {
            result += " ";
            escaped = true;
            continue;
        }
        if (state === "`" && current === "$" && next === "{") {
            templateDepths.push(braceDepth);
            result += "  ";
            index += 1;
            state = "code";
            previous = "";
            continue;
        }
        if (current === state) {
            result += " ";
            state = "code";
            previous = state === "`" ? "`" : "";
            continue;
        }
        result += isLineTerminator(current) ? current : " ";
    }
    /**
     * 走査の終わりに残ってよいのは`code`と、EOFで正常に終わる`line-comment`だけである。
     * それ以外は未終端であり、推測で結果を返さない。
     */
    if (state !== "code" && state !== "line-comment")
        return undefined;
    return templateDepths.length === 0 ? result : undefined;
}
/** JavaScriptの行終端子。LFだけを見るとCR区切りのsourceで走査が脱線する。 */
function isLineTerminator(character) {
    return (character === "\n" ||
        character === "\r" ||
        character === "\u2028" ||
        character === "\u2029");
}
function isSpace(character) {
    return /\s/u.test(character);
}
/**
 * `/`の直前tokenから、正規表現literalか除算かを判別する。
 *
 * **確信できない位置では`unknown`を返す。** `)`の直後は制御文の閉じ括弧なら正規表現、
 * 式の呼び出しなら除算であり、tokenだけでは決まらない。`.`の直後も数値literalの小数点か
 * property accessかで変わる。**当てにいかない。**
 */
function slashKind(previous) {
    if (previous === "")
        return "regex";
    if (REGEX_ALLOWING_KEYWORDS.has(previous))
        return "regex";
    if (previous === ")" || previous === ".")
        return "unknown";
    return /[\w$\]]$/u.test(previous) ? "divide" : "regex";
}
const REGEX_ALLOWING_KEYWORDS = new Set([
    "await",
    "case",
    "delete",
    "do",
    "else",
    "in",
    "instanceof",
    "new",
    "of",
    "return",
    "throw",
    "typeof",
    "void",
    "yield",
]);
/** `/`の直前がこの形なら除算である。 */
/**
 * exportの実在を3値で返す。
 *
 * **「解析できなかった」と「実在しない」を同じ値へ潰さない。** 利用者が次に採る操作が
 * 異なるためである。実在しないならenforcement宣言を直すかexportを実装する。
 * 解析できないならsourceの記法を直す。**exportは実在するかもしれない**（Issue #1134）。
 *
 * 判定不能を合格へ倒さない点は変えない。呼び出し側はどちらの値でもerrorを積む。
 */
function findExport(file, name) {
    const source = executableSource(fs.readFileSync(file, "utf8"));
    /** 解析できないsourceをexport実在の根拠にしない。 */
    if (source === undefined)
        return "unparsable";
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`^\\s*export\\s+(?:default\\s+)?(?:async\\s+)?(?:function\\s*\\*?|class|const|let|var)\\s+${escaped}\\b`, "mu").test(source))
        return "present";
    if (new RegExp(`^\\s*export\\s*\\*\\s+as\\s+${escaped}\\b`, "mu").test(source))
        return "present";
    for (const match of source.matchAll(/^\s*export\s*\{([^}]*)\}/gmu)) {
        const exported = match[1].split(",").map((entry) => entry
            .trim()
            .split(/\s+as\s+/u)
            .at(-1)
            ?.trim());
        if (exported.includes(name))
            return "present";
    }
    return "absent";
}
export function validateRepositoryConformance(root, contract, binding, evidenceInput = {}, rulesInput = []) {
    const contractResult = validateConformanceContract(contract);
    const bindingResult = validateProjectConformanceBinding(binding, rulesInput);
    const errors = [...contractResult.errors, ...bindingResult.errors];
    if (!isRecord(binding))
        return { valid: false, errors };
    const bindings = Array.isArray(binding.bindings) ? binding.bindings : [];
    const evidence = isRecord(evidenceInput) ? evidenceInput : {};
    if (!isRecord(evidenceInput))
        errors.push("成功証拠はobjectでなければなりません");
    for (const field of Object.keys(evidence))
        if (!["tool", "passedScenarioIds"].includes(field))
            errors.push(`成功証拠.${field}は未知fieldです`);
    const passedScenarioIds = Array.isArray(evidence.passedScenarioIds)
        ? evidence.passedScenarioIds
        : [];
    if (!Array.isArray(evidence.passedScenarioIds) ||
        evidence.passedScenarioIds.some((id) => typeof id !== "string" || !/^SCN-[A-Z0-9-]+$/u.test(id)))
        errors.push("成功証拠passedScenarioIdsが不正です");
    const passed = new Set(passedScenarioIds);
    if (!text(evidence.tool))
        errors.push("成功証拠toolが必要です");
    const registeredCheckIds = new Set((Array.isArray(rulesInput) ? rulesInput : []).flatMap((rule) => {
        if (!isRecord(rule) || typeof rule.ruleId !== "string")
            return [];
        const checkId = checkIdForRuleId(rule.ruleId);
        return checkId ? [checkId] : [];
    }));
    if (!Array.isArray(rulesInput))
        errors.push("project rulesは配列でなければなりません");
    for (const item of bindings) {
        if (!isRecord(item)) {
            errors.push("binding itemはobjectでなければなりません");
            continue;
        }
        if (bindingStatus(item) === "not-applicable")
            continue;
        for (const relative of Array.isArray(item.sourcePaths)
            ? item.sourcePaths
            : []) {
            if (typeof relative !== "string")
                continue;
            try {
                const file = resolveContained(root, relative);
                if (!fs.statSync(file).isFile())
                    errors.push(`${String(item.id)}のsourceがfileではありません: ${relative}`);
            }
            catch {
                errors.push(`${String(item.id)}のsourceが実在しません: ${relative}`);
            }
        }
        for (const point of Array.isArray(item.enforcement)
            ? item.enforcement
            : []) {
            if (!isRecord(point))
                continue;
            const kind = point.kind === undefined ? "module-export" : point.kind;
            if (kind === "check-ref") {
                if (typeof point.checkId === "string" &&
                    CHECK_ID.test(point.checkId) &&
                    !registeredCheckIds.has(point.checkId))
                    errors.push(unregisteredCheckRefMessage({
                        prefix: `${String(item.id)}.`,
                        checkId: point.checkId,
                        registeredCheckIds,
                        rules: Array.isArray(rulesInput) ? rulesInput : [],
                    }));
                continue;
            }
            if (typeof point.path !== "string")
                continue;
            try {
                const file = resolveContained(root, point.path);
                if (kind === "file-entrypoint") {
                    const stat = fs.lstatSync(file);
                    if (stat.isSymbolicLink() || !stat.isFile())
                        errors.push(`${String(item.id)}のfile-entrypointはsymlinkでない通常fileでなければなりません: ${point.path}`);
                }
                else if (!text(point.export))
                    errors.push(`${String(item.id)}のenforcement exportが実在しません: ${point.path}#${String(point.export)}`);
                else {
                    const found = findExport(file, point.export);
                    if (found === "unparsable")
                        errors.push(`${String(item.id)}のenforcement sourceを解析できないためexportの実在を判定できません: ${point.path}#${point.export}。未終端のstring literalやtemplate literal、判定できない\`/\`が無いか確かめてください。exportは実在するかもしれません`);
                    else if (found === "absent")
                        errors.push(`${String(item.id)}のenforcement exportが実在しません: ${point.path}#${point.export}`);
                }
            }
            catch {
                errors.push(`${String(item.id)}のenforcement pathが実在しません: ${point.path}`);
            }
        }
        for (const scenario of Array.isArray(item.counterexampleScenarios)
            ? item.counterexampleScenarios
            : [])
            if (!passed.has(scenario))
                errors.push(`${String(item.id)}のcounterexampleに成功証拠がありません: ${String(scenario)}`);
    }
    return {
        valid: errors.length === 0,
        errors,
        checked: IDS,
        evidenceTool: evidence.tool,
    };
}
function flattenedBindings(declaration) {
    return declaration.bindingDocuments.flatMap((document) => isRecord(document) && Array.isArray(document.bindings)
        ? document.bindings.filter(isRecord)
        : []);
}
export function classifyConformanceDeclarationDiff(trusted, candidate) {
    const diff = { weakened: [], allowed: [] };
    const trustedScope = trusted.scope ?? "repository-bound";
    const candidateScope = candidate.scope ?? "repository-bound";
    if (trustedScope === "repository-bound" &&
        candidateScope === "package-attested")
        diff.weakened.push("conformanceScope: repository-boundからpackage-attestedへ格下げしている");
    else if (trustedScope !== candidateScope)
        diff.allowed.push("conformanceScope");
    const candidateById = new Map(flattenedBindings(candidate).map((binding) => [
        String(binding.id),
        binding,
    ]));
    for (const trustedBinding of flattenedBindings(trusted)) {
        const id = String(trustedBinding.id);
        const candidateBinding = candidateById.get(id);
        if (!candidateBinding) {
            diff.weakened.push(`binding ${id}: trusted bindingを削除している`);
            continue;
        }
        const trustedStatus = bindingStatus(trustedBinding);
        const candidateStatus = bindingStatus(candidateBinding);
        if (trustedStatus === "applicable" &&
            candidateStatus === "not-applicable") {
            diff.weakened.push(`binding ${id}: applicableからnot-applicableへ格下げしている`);
            continue;
        }
        if (trustedStatus === "not-applicable" && candidateStatus === "applicable")
            diff.allowed.push(`binding ${id}.status`);
        if (trustedStatus !== "applicable" || candidateStatus !== "applicable")
            continue;
        for (const field of ["enforcement", "counterexampleScenarios"]) {
            const trustedCount = Array.isArray(trustedBinding[field])
                ? trustedBinding[field].length
                : 0;
            const candidateCount = Array.isArray(candidateBinding[field])
                ? candidateBinding[field].length
                : 0;
            if (candidateCount < trustedCount)
                diff.weakened.push(`binding ${id}.${field}: 要素数を${trustedCount}件から${candidateCount}件へ減らしている`);
            else if (candidateCount > trustedCount)
                diff.allowed.push(`binding ${id}.${field}`);
        }
    }
    return diff;
}
export const DISTRIBUTION_IMPACT_HEADING = "## 配布物影響";
const DISTRIBUTION_IMPACT_HEADING_TEXT = "配布物影響";
const DISTRIBUTION_DECISION_UPDATED = "配布物を更新した";
const DISTRIBUTION_DECISION_NOT_UPDATED = "配布物を更新しない";
function normalizeRelative(value) {
    return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}
export function distributedPaths(input) {
    const files = input.packageFiles.map(normalizeRelative);
    const compiled = new Map();
    if (files.includes("dist/src/"))
        compiled.set("src/", "dist/src/");
    if (files.includes("dist/bin/"))
        compiled.set("dist/bin/", "dist/bin/");
    if (files.includes("dist/bin/"))
        compiled.set("bin/", "dist/bin/");
    const direct = files;
    const matched = [];
    for (const raw of input.changedPaths) {
        const relative = normalizeRelative(raw);
        const isDirect = direct.some((entry) => entry.endsWith("/") ? relative.startsWith(entry) : relative === entry);
        const isCompiled = [...compiled.keys()].some((prefix) => relative.startsWith(prefix));
        if (isDirect || isCompiled)
            matched.push(relative);
    }
    return [...new Set(matched)].sort();
}
export function extractMarkdownSection(markdown, headingText) {
    const pattern = new RegExp(`^## (?:\\d+\\.\\s*)?${headingText.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*$`, "u");
    const lines = markdown.split(/\r?\n/u);
    const start = lines.findIndex((line) => pattern.test(line.trimEnd()));
    if (start === -1)
        return undefined;
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^## /u.test(line));
    return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}
export function validateDistributionImpact(input) {
    const errors = [];
    const distributed = distributedPaths({
        changedPaths: input.changedPaths,
        packageFiles: input.packageFiles,
    });
    const section = extractMarkdownSection(input.markdown, DISTRIBUTION_IMPACT_HEADING_TEXT);
    if (section === undefined) {
        errors.push(`review artifactへ「${DISTRIBUTION_IMPACT_HEADING}」の節が必要です。配布境界へ入る変更pathと、配布物を更新したか更新しない理由を記述してください`);
        return { valid: false, errors, distributed };
    }
    for (const relative of distributed)
        if (!section.includes(relative))
            errors.push(`配布物影響の節に配布境界へ入る変更pathがありません: ${relative}`);
    const decisionLines = section
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("判断:"));
    const decisions = decisionLines.map((line) => line.slice("判断:".length).trim());
    const allowed = [
        DISTRIBUTION_DECISION_UPDATED,
        DISTRIBUTION_DECISION_NOT_UPDATED,
    ];
    if (decisions.length !== 1)
        errors.push(`配布物影響の節へ「判断: ${DISTRIBUTION_DECISION_UPDATED}」または「判断: ${DISTRIBUTION_DECISION_NOT_UPDATED}」の行が1件だけ必要です`);
    else if (!allowed.includes(decisions[0] ?? ""))
        errors.push(`配布物影響の判断は「${DISTRIBUTION_DECISION_UPDATED}」または「${DISTRIBUTION_DECISION_NOT_UPDATED}」のいずれかでなければなりません: ${decisions[0]}`);
    const groundLines = section
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("根拠:"));
    const grounds = groundLines.map((line) => line.slice("根拠:".length).trim());
    if (grounds.length !== 1)
        errors.push("配布物影響の節へ「根拠:」の行が1件だけ必要です");
    else {
        const ground = grounds[0] ?? "";
        if (ground.length < 20)
            errors.push("配布物影響の根拠が短すぎます。判断した理由を記述してください");
        if (/^\{.*\}$/u.test(ground) || ground.includes("{"))
            errors.push("配布物影響の根拠にplaceholderが残っています");
    }
    return { valid: errors.length === 0, errors, distributed };
}
export const REVIEW_EXCEPTION_SCHEMA_VERSION = "agent-skill-chain/project-review-exceptions/v1";
export const REVIEW_EXCEPTION_KINDS = [
    "independent-reviewer-absent",
    "transient-failure",
    "reported-success-without-review",
];
const REVIEW_EXCEPTION_FIELDS = [
    "exceptionId",
    "kind",
    "condition",
    "detection",
    "approvalSource",
    "approver",
    "scope",
    "coversIrreversibleDistribution",
    "reason",
    "approvedAt",
    "expiresAt",
    "unsatisfiedRequirement",
    "record",
];
const REVIEW_EXCEPTION_TEXT_FIELDS = REVIEW_EXCEPTION_FIELDS.filter((field) => field !== "expiresAt" && field !== "coversIrreversibleDistribution");
function isInstant(value) {
    if (typeof value !== "string")
        return false;
    const parsed = Date.parse(value);
    return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}
export function validateReviewExceptions(input) {
    const errors = [];
    const active = [];
    if (!isInstant(input.now)) {
        errors.push("現在時刻はISO8601の絶対時刻でなければなりません");
        return { valid: false, errors, active };
    }
    const document = input.document;
    if (!isRecord(document) ||
        document.schemaVersion !== REVIEW_EXCEPTION_SCHEMA_VERSION ||
        !Array.isArray(document.exceptions)) {
        errors.push("review例外正本の構造が不正です");
        return { valid: false, errors, active };
    }
    const seen = new Set();
    for (const [index, raw] of document.exceptions.entries()) {
        const label = `review例外[${index}]`;
        if (!isRecord(raw)) {
            errors.push(`${label}はobjectでなければなりません`);
            continue;
        }
        for (const key of Object.keys(raw))
            if (!REVIEW_EXCEPTION_FIELDS.includes(key))
                errors.push(`${label}に未知fieldがあります: ${key}`);
        for (const field of REVIEW_EXCEPTION_FIELDS)
            if (!Object.hasOwn(raw, field))
                errors.push(`${label}に${field}がありません`);
        for (const field of REVIEW_EXCEPTION_TEXT_FIELDS) {
            if (!Object.hasOwn(raw, field))
                continue;
            const value = raw[field];
            if (typeof value !== "string" || value.trim() === "")
                errors.push(`${label}の${field}は空でない文字列でなければなりません`);
        }
        const exceptionId = raw.exceptionId;
        if (typeof exceptionId === "string") {
            if (!/^RVX-[A-Z0-9][A-Z0-9-]*$/u.test(exceptionId))
                errors.push(`${label}のexceptionIdはRVX-で始まる識別子でなければなりません`);
            if (seen.has(exceptionId))
                errors.push(`${label}のexceptionIdが重複しています: ${exceptionId}`);
            seen.add(exceptionId);
        }
        if (Object.hasOwn(raw, "kind") &&
            !REVIEW_EXCEPTION_KINDS.includes(raw.kind))
            errors.push(`${label}のkindは${REVIEW_EXCEPTION_KINDS.join("、")}のいずれかでなければなりません`);
        if (raw.kind === "transient-failure")
            errors.push(`${label}のtransient-failureは例外にできません。再試行の上限を超えた場合はindependent-reviewer-absentまたはreported-success-without-reviewとして宣言してください`);
        if (Object.hasOwn(raw, "approvedAt") && !isInstant(raw.approvedAt))
            errors.push(`${label}のapprovedAtはISO8601の絶対時刻でなければなりません`);
        const covers = raw.coversIrreversibleDistribution;
        if (Object.hasOwn(raw, "coversIrreversibleDistribution") &&
            typeof covers !== "boolean")
            errors.push(`${label}のcoversIrreversibleDistributionは真偽値でなければなりません`);
        if (!Object.hasOwn(raw, "expiresAt"))
            continue;
        const expiresAt = raw.expiresAt;
        if (expiresAt === null && covers === true) {
            errors.push(`${label}は外部への不可逆な配布を対象に含めるため、失効日時を無期限にできません`);
            continue;
        }
        if (expiresAt === null) {
            // 無期限を明示するnull。keyの省略とは区別する。
            if (typeof exceptionId === "string")
                active.push(exceptionId);
            continue;
        }
        if (!isInstant(expiresAt)) {
            errors.push(`${label}のexpiresAtはISO8601の絶対時刻またはnullでなければなりません`);
            continue;
        }
        if (Date.parse(expiresAt) <= Date.parse(input.now))
            errors.push(`${label}のreview例外は${expiresAt}に失効しています。削除するか承認元と失効日時を更新してください`);
        else if (typeof exceptionId === "string")
            active.push(exceptionId);
    }
    return { valid: errors.length === 0, errors, active };
}
//# sourceMappingURL=conformance.js.map