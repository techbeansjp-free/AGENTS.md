const PROJECT_CHOICE_FIELDS = [
    "language",
    "testRunner",
    "gherkinDialect",
    "testLayers",
    "forbiddenTestFileSuffixes",
    "naming",
    "packageManager",
    "runtime",
    "ci",
    "modelMapping",
    "release",
    "projectKind",
    "capabilities",
    "quality",
];
const AUTHORITY_FIELDS = ["release", "ci"];
const ALLOWED_STRING_FIELDS = [
    "language",
    "testRunner",
    "gherkinDialect",
    "naming",
    "packageManager",
    "runtime",
    "projectKind",
];
const CAPABILITY_FIELDS = [
    "privacySecurity",
    "observability",
    "humanCenteredUi",
    "designTokens",
];
const QUALITY_STRING_FIELDS = ["implementationLanguage"];
const QUALITY_APPLICABILITY_FIELDS = [
    "lintCommand",
    "formatCheckCommand",
    "formatWriteCommand",
    "typecheckCommand",
    "runtimeValidation",
];
const DECISION_FIELDS = ["status", "reason", "evidence"];
const MODEL_TIERS = ["routine", "standard", "advanced", "critical"];
const MODEL_TIER_STRENGTH = {
    routine: 1,
    standard: 2,
    advanced: 3,
    critical: 4,
};
const ROLE_CONTRACT_FIELDS = [
    "allowedPaths",
    "allowedOperations",
    "forbiddenOperations",
    "requiredEvidence",
];
const ROLE_NAMES = [
    "coordinator",
    "analyst",
    "implementer",
    "reviewer",
    "verifier",
    "finalizer",
];
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isString(value) {
    return typeof value === "string";
}
export function isStringArray(value) {
    return (Array.isArray(value) && value.every((item) => typeof item === "string"));
}
function sameValue(trusted, candidate, visited = new WeakMap()) {
    if (Object.is(trusted, candidate))
        return true;
    if (Array.isArray(trusted) && Array.isArray(candidate)) {
        if (trusted.length !== candidate.length)
            return false;
        return trusted.every((item, index) => sameValue(item, candidate[index], visited));
    }
    if (!isRecord(trusted) || !isRecord(candidate))
        return false;
    if (visited.get(trusted) === candidate)
        return true;
    visited.set(trusted, candidate);
    const trustedKeys = Object.keys(trusted).sort();
    const candidateKeys = Object.keys(candidate).sort();
    if (!sameValue(trustedKeys, candidateKeys, visited))
        return false;
    return trustedKeys.every((key) => sameValue(trusted[key], candidate[key], visited));
}
function pushUnique(target, item) {
    if (!target.includes(item))
        target.push(item);
}
function weaken(diff, fieldPath, reason) {
    pushUnique(diff.weakened, `${fieldPath}: ${reason}`);
}
function rejectUnknownFields(value, knownFields, fieldPath, diff) {
    let valid = true;
    for (const key of Object.keys(value).sort()) {
        if (knownFields.includes(key))
            continue;
        valid = false;
        weaken(diff, `${fieldPath}.${key}`, "未知のproject choice fieldを黙って受理しない");
    }
    return valid;
}
function validateValue(trusted, candidate, guard, fieldPath, diff) {
    const trustedValid = guard(trusted);
    const candidateValid = guard(candidate);
    if (!trustedValid)
        weaken(diff, fieldPath, "trusted側の値が型契約を満たしていない");
    if (!candidateValid)
        weaken(diff, fieldPath, "candidate側の値が型契約を満たしていない");
    return trustedValid && candidateValid;
}
function isDecision(value) {
    return (isRecord(value) &&
        (value.status === "applicable" || value.status === "not-applicable") &&
        typeof value.reason === "string" &&
        typeof value.evidence === "string");
}
function inspectDecisionUnknownFields(value, fieldPath, diff) {
    return isRecord(value)
        ? rejectUnknownFields(value, DECISION_FIELDS, fieldPath, diff)
        : false;
}
function classifyDecision(trusted, candidate, fieldPath, diff) {
    const trustedKnown = inspectDecisionUnknownFields(trusted, fieldPath, diff);
    const candidateKnown = inspectDecisionUnknownFields(candidate, fieldPath, diff);
    const trustedValid = isDecision(trusted) && trustedKnown;
    const candidateValid = isDecision(candidate) && candidateKnown;
    if (!trustedValid) {
        weaken(diff, fieldPath, "trusted側の適用判定が型契約を満たしていない");
        return;
    }
    if (!candidateValid) {
        weaken(diff, fieldPath, trusted.status === "applicable"
            ? "trusted側のapplicable判定をcandidate側で維持していない"
            : "candidate側の適用判定が型契約を満たしていない");
        return;
    }
    if (trusted.status === "applicable" && candidate.status !== "applicable")
        weaken(diff, `${fieldPath}.status`, "trusted側のapplicable判定を格下げしている");
    else if (trusted.status !== candidate.status)
        pushUnique(diff.allowed, `${fieldPath}.status`);
    for (const field of ["reason", "evidence"])
        if (trusted[field] !== candidate[field])
            pushUnique(diff.allowed, `${fieldPath}.${field}`);
}
function isNotApplicableDecision(value) {
    return isDecision(value) && value.status === "not-applicable";
}
function classifyQualityValue(trusted, candidate, fieldPath, diff) {
    const trustedString = isString(trusted);
    const candidateString = isString(candidate);
    const trustedDecision = isNotApplicableDecision(trusted);
    const candidateDecision = isNotApplicableDecision(candidate);
    if (!trustedString && !trustedDecision) {
        weaken(diff, fieldPath, "trusted側のquality値が型契約を満たしていない");
        return;
    }
    if (!candidateString && !candidateDecision) {
        inspectDecisionUnknownFields(candidate, fieldPath, diff);
        weaken(diff, fieldPath, "candidate側のquality値が型契約を満たしていない");
        return;
    }
    if (trustedString && candidateDecision) {
        weaken(diff, fieldPath, "trusted側の具体値をnot-applicableへ格下げしている");
        return;
    }
    if (trustedDecision && candidateString) {
        pushUnique(diff.allowed, fieldPath);
        return;
    }
    if (trustedDecision && candidateDecision) {
        inspectDecisionUnknownFields(trusted, fieldPath, diff);
        inspectDecisionUnknownFields(candidate, fieldPath, diff);
    }
    if (!sameValue(trusted, candidate))
        pushUnique(diff.allowed, fieldPath);
}
/**
 * 要素削除を表す弱化理由の接頭辞。
 *
 * **受理判定がこの文言で縮小entryを識別する。** 同じfieldPathでも型契約違反の
 * entryを受理候補にしないため、literalを複製せずここから共有する。
 */
export const MONOTONIC_SHRINK_REASON_PREFIX = "trusted側の要素を削除している: ";
function classifyMonotonicArray(trusted, candidate, fieldPath, diff) {
    if (!validateValue(trusted, candidate, isStringArray, fieldPath, diff))
        return;
    if (!isStringArray(trusted) || !isStringArray(candidate))
        return;
    const missing = trusted.filter((item) => !candidate.includes(item));
    if (missing.length > 0)
        weaken(diff, fieldPath, `${MONOTONIC_SHRINK_REASON_PREFIX}${missing.join("、")}`);
    else if (!sameValue(trusted, candidate))
        pushUnique(diff.allowed, fieldPath);
}
function inspectModelMapping(value, fieldPath, diff) {
    if (value === undefined || typeof value === "string")
        return true;
    if (!isRecord(value)) {
        weaken(diff, fieldPath, "modelMappingは文字列または構造化値でなければならない");
        return false;
    }
    let valid = rejectUnknownFields(value, [
        "roles",
        "fallback",
        "evidenceStoreRoot",
        "retention",
        "roleContracts",
        "tierMapping",
        "minimumTierByRisk",
    ], fieldPath, diff);
    const roles = value.roles;
    if (!isRecord(roles)) {
        weaken(diff, `${fieldPath}.roles`, "rolesはobjectでなければならない");
        valid = false;
    }
    else {
        valid =
            rejectUnknownFields(roles, ["coordinator", "implementer", "reviewer"], `${fieldPath}.roles`, diff) && valid;
        for (const role of ["coordinator", "implementer", "reviewer"]) {
            const rolePath = `${fieldPath}.roles.${role}`;
            const configuration = roles[role];
            if (!isRecord(configuration)) {
                weaken(diff, rolePath, "role設定はobjectでなければならない");
                valid = false;
                continue;
            }
            valid =
                rejectUnknownFields(configuration, role === "reviewer"
                    ? [
                        "provider",
                        "logicalTier",
                        "reasoningEffort",
                        "speed",
                        "independence",
                    ]
                    : ["provider", "logicalTier", "reasoningEffort", "speed"], rolePath, diff) && valid;
            if (typeof configuration.provider !== "string" ||
                (configuration.logicalTier !== "project_default" &&
                    configuration.logicalTier !== "highest_available") ||
                configuration.reasoningEffort !== "high" ||
                configuration.speed !== "standard") {
                weaken(diff, rolePath, "role設定が型契約を満たしていない");
                valid = false;
            }
            if (role === "reviewer") {
                const independence = configuration.independence;
                if (!isRecord(independence)) {
                    weaken(diff, `${rolePath}.independence`, "reviewer独立性はobjectでなければならない");
                    valid = false;
                }
                else {
                    valid =
                        rejectUnknownFields(independence, ["differentFrom"], `${rolePath}.independence`, diff) && valid;
                    if (independence.differentFrom !== "implementer") {
                        weaken(diff, `${rolePath}.independence.differentFrom`, "reviewer独立性が型契約を満たしていない");
                        valid = false;
                    }
                }
            }
        }
    }
    const fallback = value.fallback;
    if (!isRecord(fallback)) {
        weaken(diff, `${fieldPath}.fallback`, "fallbackはobjectでなければならない");
        valid = false;
    }
    else {
        valid =
            rejectUnknownFields(fallback, ["when", "role", "modelSelection"], `${fieldPath}.fallback`, diff) && valid;
        if (fallback.when !== "implementer_unavailable" ||
            fallback.role !== "coordinator" ||
            fallback.modelSelection !== "project_default") {
            weaken(diff, `${fieldPath}.fallback`, "fallback設定が型契約を満たしていない");
            valid = false;
        }
    }
    if (typeof value.evidenceStoreRoot !== "string") {
        weaken(diff, `${fieldPath}.evidenceStoreRoot`, "evidenceStoreRootは文字列でなければならない");
        valid = false;
    }
    const retention = value.retention;
    if (!isRecord(retention)) {
        weaken(diff, `${fieldPath}.retention`, "retentionはobjectでなければならない");
        valid = false;
    }
    else {
        valid =
            rejectUnknownFields(retention, [
                "retentionDays",
                "maxRecordsPerIssue",
                "maxRecordBytes",
                "rotationCondition",
                "deletionMethod",
            ], `${fieldPath}.retention`, diff) && valid;
        if (typeof retention.retentionDays !== "number" ||
            typeof retention.maxRecordsPerIssue !== "number" ||
            typeof retention.maxRecordBytes !== "number" ||
            retention.rotationCondition !== "oldest_first" ||
            retention.deletionMethod !== "preview_then_explicit") {
            weaken(diff, `${fieldPath}.retention`, "retention設定が型契約を満たしていない");
            valid = false;
        }
    }
    if (value.roleContracts !== undefined) {
        if (!isRecord(value.roleContracts)) {
            weaken(diff, `${fieldPath}.roleContracts`, "roleContractsはobjectでなければならない");
            valid = false;
        }
        else {
            for (const [role, contract] of Object.entries(value.roleContracts)) {
                const contractPath = `${fieldPath}.roleContracts.${role}`;
                if (!ROLE_NAMES.some((candidate) => candidate === role)) {
                    weaken(diff, contractPath, "未知のrole contractを追加している");
                    valid = false;
                }
                if (!isRecord(contract)) {
                    weaken(diff, contractPath, "role contractはobjectでなければならない");
                    valid = false;
                    continue;
                }
                valid =
                    rejectUnknownFields(contract, ROLE_CONTRACT_FIELDS, contractPath, diff) && valid;
                for (const field of ROLE_CONTRACT_FIELDS)
                    if (!isStringArray(contract[field])) {
                        weaken(diff, `${contractPath}.${field}`, "role contract fieldは文字列配列でなければならない");
                        valid = false;
                    }
            }
        }
    }
    for (const field of ["tierMapping", "minimumTierByRisk"]) {
        const tierMap = value[field];
        if (tierMap === undefined)
            continue;
        if (!isRecord(tierMap)) {
            weaken(diff, `${fieldPath}.${field}`, `${field}はobjectでなければならない`);
            valid = false;
            continue;
        }
        for (const [key, tier] of Object.entries(tierMap))
            if (!MODEL_TIERS.some((candidate) => candidate === tier)) {
                weaken(diff, `${fieldPath}.${field}.${key}`, "tierが型契約を満たしていない");
                valid = false;
            }
    }
    return valid;
}
function classifyRoleContracts(trusted, candidate, fieldPath, diff) {
    const trustedContracts = isRecord(trusted.roleContracts)
        ? trusted.roleContracts
        : {};
    const candidateContracts = isRecord(candidate.roleContracts)
        ? candidate.roleContracts
        : {};
    for (const [role, trustedValue] of Object.entries(trustedContracts)) {
        const rolePath = `${fieldPath}.roleContracts.${role}`;
        const candidateValue = candidateContracts[role];
        if (!isRecord(trustedValue) || !isRecord(candidateValue)) {
            if (!Object.hasOwn(candidateContracts, role))
                weaken(diff, rolePath, "trusted側のrole contractを削除している");
            continue;
        }
        for (const field of ROLE_CONTRACT_FIELDS) {
            const trustedItems = trustedValue[field];
            const candidateItems = candidateValue[field];
            if (!isStringArray(trustedItems) || !isStringArray(candidateItems))
                continue;
            if (!sameValue(trustedItems, candidateItems))
                pushUnique(diff.allowed, `${rolePath}.${field}`);
        }
    }
    for (const role of Object.keys(candidateContracts))
        if (!Object.hasOwn(trustedContracts, role))
            pushUnique(diff.allowed, `${fieldPath}.roleContracts.${role}`);
}
function classifyTierMap(trusted, candidate, field, fieldPath, diff) {
    const trustedMap = isRecord(trusted[field]) ? trusted[field] : {};
    const candidateMap = isRecord(candidate[field]) ? candidate[field] : {};
    for (const [key, trustedTier] of Object.entries(trustedMap)) {
        const candidateTier = candidateMap[key];
        if (field === "minimumTierByRisk" && candidateTier === undefined) {
            weaken(diff, `${fieldPath}.${field}.${key}`, "trusted側のrisk別最低tierを削除している");
            continue;
        }
        if (MODEL_TIERS.some((tier) => tier === trustedTier) &&
            MODEL_TIERS.some((tier) => tier === candidateTier)) {
            if (MODEL_TIER_STRENGTH[candidateTier] <
                MODEL_TIER_STRENGTH[trustedTier])
                weaken(diff, `${fieldPath}.${field}.${key}`, `tierを${String(trustedTier)}から${String(candidateTier)}へ引き下げている`);
            else if (candidateTier !== trustedTier)
                pushUnique(diff.allowed, `${fieldPath}.${field}.${key}`);
        }
    }
    for (const key of Object.keys(candidateMap))
        if (!Object.hasOwn(trustedMap, key))
            pushUnique(diff.allowed, `${fieldPath}.${field}.${key}`);
}
function classifyModelMappingExtensions(trusted, candidate, fieldPath, diff) {
    if (!isRecord(trusted) || !isRecord(candidate))
        return;
    classifyRoleContracts(trusted, candidate, fieldPath, diff);
    classifyTierMap(trusted, candidate, "tierMapping", fieldPath, diff);
    classifyTierMap(trusted, candidate, "minimumTierByRisk", fieldPath, diff);
}
export function classifyProjectChoiceDiff(trusted, candidate) {
    const diff = { authority: [], weakened: [], allowed: [] };
    const trustedRecord = isRecord(trusted);
    const candidateRecord = isRecord(candidate);
    if (!trustedRecord)
        weaken(diff, "projectChoices", "trusted側のprojectChoicesはobjectでなければならない");
    if (!candidateRecord)
        weaken(diff, "projectChoices", "candidate側のprojectChoicesはobjectでなければならない");
    if (!trustedRecord || !candidateRecord)
        return diff;
    rejectUnknownFields(trusted, PROJECT_CHOICE_FIELDS, "projectChoices", diff);
    rejectUnknownFields(candidate, PROJECT_CHOICE_FIELDS, "projectChoices", diff);
    for (const field of AUTHORITY_FIELDS) {
        const fieldPath = `projectChoices.${field}`;
        if (validateValue(trusted[field], candidate[field], isString, fieldPath, diff) &&
            trusted[field] !== candidate[field])
            pushUnique(diff.authority, fieldPath);
    }
    for (const field of ALLOWED_STRING_FIELDS) {
        const fieldPath = `projectChoices.${field}`;
        if (validateValue(trusted[field], candidate[field], isString, fieldPath, diff) &&
            trusted[field] !== candidate[field])
            pushUnique(diff.allowed, fieldPath);
    }
    classifyMonotonicArray(trusted.testLayers, candidate.testLayers, "projectChoices.testLayers", diff);
    classifyMonotonicArray(trusted.forbiddenTestFileSuffixes, candidate.forbiddenTestFileSuffixes, "projectChoices.forbiddenTestFileSuffixes", diff);
    const trustedMappingValid = inspectModelMapping(trusted.modelMapping, "projectChoices.modelMapping", diff);
    const candidateMappingValid = inspectModelMapping(candidate.modelMapping, "projectChoices.modelMapping", diff);
    if (trustedMappingValid &&
        candidateMappingValid &&
        !sameValue(trusted.modelMapping, candidate.modelMapping)) {
        const classifiedBefore = diff.allowed.length + diff.weakened.length;
        classifyModelMappingExtensions(trusted.modelMapping, candidate.modelMapping, "projectChoices.modelMapping", diff);
        if (diff.allowed.length + diff.weakened.length === classifiedBefore)
            pushUnique(diff.allowed, "projectChoices.modelMapping");
    }
    const trustedCapabilities = isRecord(trusted.capabilities)
        ? trusted.capabilities
        : {};
    const candidateCapabilities = isRecord(candidate.capabilities)
        ? candidate.capabilities
        : {};
    if (!isRecord(trusted.capabilities))
        weaken(diff, "projectChoices.capabilities", "trusted側のcapabilitiesはobjectでなければならない");
    if (!isRecord(candidate.capabilities))
        weaken(diff, "projectChoices.capabilities", "candidate側のcapabilitiesはobjectでなければならない");
    rejectUnknownFields(trustedCapabilities, CAPABILITY_FIELDS, "projectChoices.capabilities", diff);
    rejectUnknownFields(candidateCapabilities, CAPABILITY_FIELDS, "projectChoices.capabilities", diff);
    for (const field of CAPABILITY_FIELDS)
        classifyDecision(trustedCapabilities[field], candidateCapabilities[field], `projectChoices.capabilities.${field}`, diff);
    const trustedQuality = isRecord(trusted.quality) ? trusted.quality : {};
    const candidateQuality = isRecord(candidate.quality) ? candidate.quality : {};
    if (!isRecord(trusted.quality))
        weaken(diff, "projectChoices.quality", "trusted側のqualityはobjectでなければならない");
    if (!isRecord(candidate.quality))
        weaken(diff, "projectChoices.quality", "candidate側のqualityはobjectでなければならない");
    const qualityFields = [
        ...QUALITY_STRING_FIELDS,
        ...QUALITY_APPLICABILITY_FIELDS,
        "strictTypecheck",
        "forbiddenTypes",
        "auxiliaryLanguages",
    ];
    rejectUnknownFields(trustedQuality, qualityFields, "projectChoices.quality", diff);
    rejectUnknownFields(candidateQuality, qualityFields, "projectChoices.quality", diff);
    for (const field of QUALITY_STRING_FIELDS) {
        const fieldPath = `projectChoices.quality.${field}`;
        if (validateValue(trustedQuality[field], candidateQuality[field], isString, fieldPath, diff) &&
            trustedQuality[field] !== candidateQuality[field])
            pushUnique(diff.allowed, fieldPath);
    }
    for (const field of QUALITY_APPLICABILITY_FIELDS)
        classifyQualityValue(trustedQuality[field], candidateQuality[field], `projectChoices.quality.${field}`, diff);
    const trustedStrictDecision = isNotApplicableDecision(trustedQuality.strictTypecheck);
    const candidateStrictDecision = isNotApplicableDecision(candidateQuality.strictTypecheck);
    if (trustedQuality.strictTypecheck !== true && !trustedStrictDecision)
        weaken(diff, "projectChoices.quality.strictTypecheck", "trusted側のstrictTypecheckが型契約を満たしていない");
    if (trustedQuality.strictTypecheck === true &&
        candidateQuality.strictTypecheck !== true)
        weaken(diff, "projectChoices.quality.strictTypecheck", "trusted側のtrueをcandidate側で維持していない");
    else if (trustedStrictDecision && candidateQuality.strictTypecheck === true)
        pushUnique(diff.allowed, "projectChoices.quality.strictTypecheck");
    else if (trustedStrictDecision && !candidateStrictDecision)
        weaken(diff, "projectChoices.quality.strictTypecheck", "candidate側のstrictTypecheckが型契約を満たしていない");
    else if (trustedStrictDecision &&
        candidateStrictDecision &&
        !sameValue(trustedStrictDecision, candidateStrictDecision))
        pushUnique(diff.allowed, "projectChoices.quality.strictTypecheck");
    classifyMonotonicArray(trustedQuality.forbiddenTypes, candidateQuality.forbiddenTypes, "projectChoices.quality.forbiddenTypes", diff);
    const trustedAuxiliary = isRecord(trustedQuality.auxiliaryLanguages)
        ? trustedQuality.auxiliaryLanguages
        : {};
    const candidateAuxiliary = isRecord(candidateQuality.auxiliaryLanguages)
        ? candidateQuality.auxiliaryLanguages
        : {};
    if (!isRecord(trustedQuality.auxiliaryLanguages))
        weaken(diff, "projectChoices.quality.auxiliaryLanguages", "trusted側のauxiliaryLanguagesはobjectでなければならない");
    if (!isRecord(candidateQuality.auxiliaryLanguages))
        weaken(diff, "projectChoices.quality.auxiliaryLanguages", "candidate側のauxiliaryLanguagesはobjectでなければならない");
    for (const language of Object.keys(trustedAuxiliary).sort()) {
        const fieldPath = `projectChoices.quality.auxiliaryLanguages.${language}`;
        if (!(language in candidateAuxiliary)) {
            weaken(diff, fieldPath, "trusted側に存在する補助言語宣言を削除している");
            continue;
        }
        classifyDecision(trustedAuxiliary[language], candidateAuxiliary[language], fieldPath, diff);
    }
    for (const language of Object.keys(candidateAuxiliary).sort()) {
        if (language in trustedAuxiliary)
            continue;
        const fieldPath = `projectChoices.quality.auxiliaryLanguages.${language}`;
        const candidateKnown = inspectDecisionUnknownFields(candidateAuxiliary[language], fieldPath, diff);
        if (isDecision(candidateAuxiliary[language]) && candidateKnown)
            pushUnique(diff.allowed, fieldPath);
        else
            weaken(diff, fieldPath, "追加する補助言語宣言が型契約を満たしていない");
    }
    return diff;
}
//# sourceMappingURL=project-choice-diff.js.map