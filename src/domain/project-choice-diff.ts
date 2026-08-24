import type { ProjectChoices } from "../types.js";

export interface ProjectChoiceDiff {
  authority: string[];
  weakened: string[];
  allowed: string[];
}

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
] as const satisfies readonly (keyof ProjectChoices)[];

const AUTHORITY_FIELDS = ["release", "ci"] as const;
const ALLOWED_STRING_FIELDS = [
  "language",
  "testRunner",
  "gherkinDialect",
  "naming",
  "packageManager",
  "runtime",
  "projectKind",
] as const;
const CAPABILITY_FIELDS = [
  "privacySecurity",
  "observability",
  "humanCenteredUi",
  "designTokens",
] as const;
const QUALITY_STRING_FIELDS = [
  "implementationLanguage",
  "lintCommand",
  "formatCheckCommand",
  "formatWriteCommand",
  "typecheckCommand",
  "runtimeValidation",
] as const;
const DECISION_FIELDS = ["status", "reason", "evidence"] as const;

type ChoiceRecord = Record<string, unknown>;
type Decision = {
  status: "applicable" | "not-applicable";
  reason: string;
  evidence: string;
};

function isRecord(value: unknown): value is ChoiceRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function sameValue(
  trusted: unknown,
  candidate: unknown,
  visited = new WeakMap<object, object>(),
): boolean {
  if (Object.is(trusted, candidate)) return true;
  if (Array.isArray(trusted) && Array.isArray(candidate)) {
    if (trusted.length !== candidate.length) return false;
    return trusted.every((item, index) =>
      sameValue(item, candidate[index], visited),
    );
  }
  if (!isRecord(trusted) || !isRecord(candidate)) return false;
  if (visited.get(trusted) === candidate) return true;
  visited.set(trusted, candidate);
  const trustedKeys = Object.keys(trusted).sort();
  const candidateKeys = Object.keys(candidate).sort();
  if (!sameValue(trustedKeys, candidateKeys, visited)) return false;
  return trustedKeys.every((key) =>
    sameValue(trusted[key], candidate[key], visited),
  );
}

function pushUnique(target: string[], item: string): void {
  if (!target.includes(item)) target.push(item);
}

function weaken(
  diff: ProjectChoiceDiff,
  fieldPath: string,
  reason: string,
): void {
  pushUnique(diff.weakened, `${fieldPath}: ${reason}`);
}

function rejectUnknownFields(
  value: ChoiceRecord,
  knownFields: readonly string[],
  fieldPath: string,
  diff: ProjectChoiceDiff,
): boolean {
  let valid = true;
  for (const key of Object.keys(value).sort()) {
    if (knownFields.includes(key)) continue;
    valid = false;
    weaken(
      diff,
      `${fieldPath}.${key}`,
      "未知のproject choice fieldを黙って受理しない",
    );
  }
  return valid;
}

function validateValue<T>(
  trusted: unknown,
  candidate: unknown,
  guard: (value: unknown) => value is T,
  fieldPath: string,
  diff: ProjectChoiceDiff,
): trusted is T {
  const trustedValid = guard(trusted);
  const candidateValid = guard(candidate);
  if (!trustedValid)
    weaken(diff, fieldPath, "trusted側の値が型契約を満たしていない");
  if (!candidateValid)
    weaken(diff, fieldPath, "candidate側の値が型契約を満たしていない");
  return trustedValid && candidateValid;
}

function isDecision(value: unknown): value is Decision {
  return (
    isRecord(value) &&
    (value.status === "applicable" || value.status === "not-applicable") &&
    typeof value.reason === "string" &&
    typeof value.evidence === "string"
  );
}

function inspectDecisionUnknownFields(
  value: unknown,
  fieldPath: string,
  diff: ProjectChoiceDiff,
): boolean {
  return isRecord(value)
    ? rejectUnknownFields(value, DECISION_FIELDS, fieldPath, diff)
    : false;
}

function classifyDecision(
  trusted: unknown,
  candidate: unknown,
  fieldPath: string,
  diff: ProjectChoiceDiff,
): void {
  const trustedKnown = inspectDecisionUnknownFields(trusted, fieldPath, diff);
  const candidateKnown = inspectDecisionUnknownFields(
    candidate,
    fieldPath,
    diff,
  );
  const trustedValid = isDecision(trusted) && trustedKnown;
  const candidateValid = isDecision(candidate) && candidateKnown;
  if (!trustedValid) {
    weaken(diff, fieldPath, "trusted側の適用判定が型契約を満たしていない");
    return;
  }
  if (!candidateValid) {
    weaken(
      diff,
      fieldPath,
      trusted.status === "applicable"
        ? "trusted側のapplicable判定をcandidate側で維持していない"
        : "candidate側の適用判定が型契約を満たしていない",
    );
    return;
  }
  if (trusted.status === "applicable" && candidate.status !== "applicable")
    weaken(
      diff,
      `${fieldPath}.status`,
      "trusted側のapplicable判定を格下げしている",
    );
  else if (trusted.status !== candidate.status)
    pushUnique(diff.allowed, `${fieldPath}.status`);
  for (const field of ["reason", "evidence"] as const)
    if (trusted[field] !== candidate[field])
      pushUnique(diff.allowed, `${fieldPath}.${field}`);
}

function classifyMonotonicArray(
  trusted: unknown,
  candidate: unknown,
  fieldPath: string,
  diff: ProjectChoiceDiff,
): void {
  if (!validateValue(trusted, candidate, isStringArray, fieldPath, diff))
    return;
  if (!isStringArray(trusted) || !isStringArray(candidate)) return;
  const missing = trusted.filter((item) => !candidate.includes(item));
  if (missing.length > 0)
    weaken(
      diff,
      fieldPath,
      `trusted側の要素を削除している: ${missing.join("、")}`,
    );
  else if (!sameValue(trusted, candidate)) pushUnique(diff.allowed, fieldPath);
}

function inspectModelMapping(
  value: unknown,
  fieldPath: string,
  diff: ProjectChoiceDiff,
): boolean {
  if (value === undefined || typeof value === "string") return true;
  if (!isRecord(value)) {
    weaken(
      diff,
      fieldPath,
      "modelMappingは文字列または構造化値でなければならない",
    );
    return false;
  }
  let valid = rejectUnknownFields(
    value,
    ["roles", "fallback", "evidenceStoreRoot", "retention"],
    fieldPath,
    diff,
  );
  const roles = value.roles;
  if (!isRecord(roles)) {
    weaken(diff, `${fieldPath}.roles`, "rolesはobjectでなければならない");
    valid = false;
  } else {
    valid =
      rejectUnknownFields(
        roles,
        ["coordinator", "implementer", "reviewer"],
        `${fieldPath}.roles`,
        diff,
      ) && valid;
    for (const role of ["coordinator", "implementer", "reviewer"] as const) {
      const rolePath = `${fieldPath}.roles.${role}`;
      const configuration = roles[role];
      if (!isRecord(configuration)) {
        weaken(diff, rolePath, "role設定はobjectでなければならない");
        valid = false;
        continue;
      }
      valid =
        rejectUnknownFields(
          configuration,
          role === "reviewer"
            ? [
                "provider",
                "logicalTier",
                "reasoningEffort",
                "speed",
                "independence",
              ]
            : ["provider", "logicalTier", "reasoningEffort", "speed"],
          rolePath,
          diff,
        ) && valid;
      if (
        typeof configuration.provider !== "string" ||
        (configuration.logicalTier !== "project_default" &&
          configuration.logicalTier !== "highest_available") ||
        configuration.reasoningEffort !== "high" ||
        configuration.speed !== "standard"
      ) {
        weaken(diff, rolePath, "role設定が型契約を満たしていない");
        valid = false;
      }
      if (role === "reviewer") {
        const independence = configuration.independence;
        if (!isRecord(independence)) {
          weaken(
            diff,
            `${rolePath}.independence`,
            "reviewer独立性はobjectでなければならない",
          );
          valid = false;
        } else {
          valid =
            rejectUnknownFields(
              independence,
              ["differentFrom"],
              `${rolePath}.independence`,
              diff,
            ) && valid;
          if (independence.differentFrom !== "implementer") {
            weaken(
              diff,
              `${rolePath}.independence.differentFrom`,
              "reviewer独立性が型契約を満たしていない",
            );
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
  } else {
    valid =
      rejectUnknownFields(
        fallback,
        ["when", "role", "modelSelection"],
        `${fieldPath}.fallback`,
        diff,
      ) && valid;
    if (
      fallback.when !== "implementer_unavailable" ||
      fallback.role !== "coordinator" ||
      fallback.modelSelection !== "project_default"
    ) {
      weaken(
        diff,
        `${fieldPath}.fallback`,
        "fallback設定が型契約を満たしていない",
      );
      valid = false;
    }
  }
  if (typeof value.evidenceStoreRoot !== "string") {
    weaken(
      diff,
      `${fieldPath}.evidenceStoreRoot`,
      "evidenceStoreRootは文字列でなければならない",
    );
    valid = false;
  }
  const retention = value.retention;
  if (!isRecord(retention)) {
    weaken(
      diff,
      `${fieldPath}.retention`,
      "retentionはobjectでなければならない",
    );
    valid = false;
  } else {
    valid =
      rejectUnknownFields(
        retention,
        [
          "retentionDays",
          "maxRecordsPerIssue",
          "maxRecordBytes",
          "rotationCondition",
          "deletionMethod",
        ],
        `${fieldPath}.retention`,
        diff,
      ) && valid;
    if (
      typeof retention.retentionDays !== "number" ||
      typeof retention.maxRecordsPerIssue !== "number" ||
      typeof retention.maxRecordBytes !== "number" ||
      retention.rotationCondition !== "oldest_first" ||
      retention.deletionMethod !== "preview_then_explicit"
    ) {
      weaken(
        diff,
        `${fieldPath}.retention`,
        "retention設定が型契約を満たしていない",
      );
      valid = false;
    }
  }
  return valid;
}

export function classifyProjectChoiceDiff(
  trusted: unknown,
  candidate: unknown,
): ProjectChoiceDiff {
  const diff: ProjectChoiceDiff = { authority: [], weakened: [], allowed: [] };
  const trustedRecord = isRecord(trusted);
  const candidateRecord = isRecord(candidate);
  if (!trustedRecord)
    weaken(
      diff,
      "projectChoices",
      "trusted側のprojectChoicesはobjectでなければならない",
    );
  if (!candidateRecord)
    weaken(
      diff,
      "projectChoices",
      "candidate側のprojectChoicesはobjectでなければならない",
    );
  if (!trustedRecord || !candidateRecord) return diff;

  rejectUnknownFields(trusted, PROJECT_CHOICE_FIELDS, "projectChoices", diff);
  rejectUnknownFields(candidate, PROJECT_CHOICE_FIELDS, "projectChoices", diff);

  for (const field of AUTHORITY_FIELDS) {
    const fieldPath = `projectChoices.${field}`;
    if (
      validateValue(
        trusted[field],
        candidate[field],
        isString,
        fieldPath,
        diff,
      ) &&
      trusted[field] !== candidate[field]
    )
      pushUnique(diff.authority, fieldPath);
  }

  for (const field of ALLOWED_STRING_FIELDS) {
    const fieldPath = `projectChoices.${field}`;
    if (
      validateValue(
        trusted[field],
        candidate[field],
        isString,
        fieldPath,
        diff,
      ) &&
      trusted[field] !== candidate[field]
    )
      pushUnique(diff.allowed, fieldPath);
  }

  classifyMonotonicArray(
    trusted.testLayers,
    candidate.testLayers,
    "projectChoices.testLayers",
    diff,
  );
  classifyMonotonicArray(
    trusted.forbiddenTestFileSuffixes,
    candidate.forbiddenTestFileSuffixes,
    "projectChoices.forbiddenTestFileSuffixes",
    diff,
  );

  const trustedMappingValid = inspectModelMapping(
    trusted.modelMapping,
    "projectChoices.modelMapping",
    diff,
  );
  const candidateMappingValid = inspectModelMapping(
    candidate.modelMapping,
    "projectChoices.modelMapping",
    diff,
  );
  if (
    trustedMappingValid &&
    candidateMappingValid &&
    !sameValue(trusted.modelMapping, candidate.modelMapping)
  )
    pushUnique(diff.allowed, "projectChoices.modelMapping");

  const trustedCapabilities = isRecord(trusted.capabilities)
    ? trusted.capabilities
    : {};
  const candidateCapabilities = isRecord(candidate.capabilities)
    ? candidate.capabilities
    : {};
  if (!isRecord(trusted.capabilities))
    weaken(
      diff,
      "projectChoices.capabilities",
      "trusted側のcapabilitiesはobjectでなければならない",
    );
  if (!isRecord(candidate.capabilities))
    weaken(
      diff,
      "projectChoices.capabilities",
      "candidate側のcapabilitiesはobjectでなければならない",
    );
  rejectUnknownFields(
    trustedCapabilities,
    CAPABILITY_FIELDS,
    "projectChoices.capabilities",
    diff,
  );
  rejectUnknownFields(
    candidateCapabilities,
    CAPABILITY_FIELDS,
    "projectChoices.capabilities",
    diff,
  );
  for (const field of CAPABILITY_FIELDS)
    classifyDecision(
      trustedCapabilities[field],
      candidateCapabilities[field],
      `projectChoices.capabilities.${field}`,
      diff,
    );

  const trustedQuality = isRecord(trusted.quality) ? trusted.quality : {};
  const candidateQuality = isRecord(candidate.quality) ? candidate.quality : {};
  if (!isRecord(trusted.quality))
    weaken(
      diff,
      "projectChoices.quality",
      "trusted側のqualityはobjectでなければならない",
    );
  if (!isRecord(candidate.quality))
    weaken(
      diff,
      "projectChoices.quality",
      "candidate側のqualityはobjectでなければならない",
    );
  const qualityFields = [
    ...QUALITY_STRING_FIELDS,
    "strictTypecheck",
    "forbiddenTypes",
    "auxiliaryLanguages",
  ];
  rejectUnknownFields(
    trustedQuality,
    qualityFields,
    "projectChoices.quality",
    diff,
  );
  rejectUnknownFields(
    candidateQuality,
    qualityFields,
    "projectChoices.quality",
    diff,
  );
  for (const field of QUALITY_STRING_FIELDS) {
    const fieldPath = `projectChoices.quality.${field}`;
    if (
      validateValue(
        trustedQuality[field],
        candidateQuality[field],
        isString,
        fieldPath,
        diff,
      ) &&
      trustedQuality[field] !== candidateQuality[field]
    )
      pushUnique(diff.allowed, fieldPath);
  }

  if (trustedQuality.strictTypecheck !== true)
    weaken(
      diff,
      "projectChoices.quality.strictTypecheck",
      "trusted側のstrictTypecheckがtrueではない",
    );
  if (
    trustedQuality.strictTypecheck === true &&
    candidateQuality.strictTypecheck !== true
  )
    weaken(
      diff,
      "projectChoices.quality.strictTypecheck",
      "trusted側のtrueをcandidate側で維持していない",
    );
  classifyMonotonicArray(
    trustedQuality.forbiddenTypes,
    candidateQuality.forbiddenTypes,
    "projectChoices.quality.forbiddenTypes",
    diff,
  );

  const trustedAuxiliary = isRecord(trustedQuality.auxiliaryLanguages)
    ? trustedQuality.auxiliaryLanguages
    : {};
  const candidateAuxiliary = isRecord(candidateQuality.auxiliaryLanguages)
    ? candidateQuality.auxiliaryLanguages
    : {};
  if (!isRecord(trustedQuality.auxiliaryLanguages))
    weaken(
      diff,
      "projectChoices.quality.auxiliaryLanguages",
      "trusted側のauxiliaryLanguagesはobjectでなければならない",
    );
  if (!isRecord(candidateQuality.auxiliaryLanguages))
    weaken(
      diff,
      "projectChoices.quality.auxiliaryLanguages",
      "candidate側のauxiliaryLanguagesはobjectでなければならない",
    );
  for (const language of Object.keys(trustedAuxiliary).sort()) {
    const fieldPath = `projectChoices.quality.auxiliaryLanguages.${language}`;
    if (!(language in candidateAuxiliary)) {
      weaken(diff, fieldPath, "trusted側に存在する補助言語宣言を削除している");
      continue;
    }
    classifyDecision(
      trustedAuxiliary[language],
      candidateAuxiliary[language],
      fieldPath,
      diff,
    );
  }
  for (const language of Object.keys(candidateAuxiliary).sort()) {
    if (language in trustedAuxiliary) continue;
    const fieldPath = `projectChoices.quality.auxiliaryLanguages.${language}`;
    const candidateKnown = inspectDecisionUnknownFields(
      candidateAuxiliary[language],
      fieldPath,
      diff,
    );
    if (isDecision(candidateAuxiliary[language]) && candidateKnown)
      pushUnique(diff.allowed, fieldPath);
    else
      weaken(diff, fieldPath, "追加する補助言語宣言が型契約を満たしていない");
  }
  return diff;
}
