import crypto from "node:crypto";
import { redactSecrets, stableJson } from "../lib/security.js";

export const PRIVATE_STRUCTURAL_CASE_VERSION =
  "asc/laya-private-structural-case/v1" as const;
export const PRIVATE_CASE_CATEGORIES = [
  "authorization",
  "null-safety",
  "resource-lifecycle",
  "error-handling",
  "data-validation",
  "concurrency",
  "distribution",
  "documentation-consistency",
] as const;
export const PRIVATE_CASE_SIGNALS = [
  "reachable-path",
  "guard-present",
  "guard-absent",
  "reproduced-before",
  "passes-after",
  "static-evidence",
  "spec-evidence",
  "consumer-failure",
] as const;

type PrivateCategory = (typeof PRIVATE_CASE_CATEGORIES)[number];
type PrivateSignal = (typeof PRIVATE_CASE_SIGNALS)[number];

export interface RawAuthorizedPrivateCase {
  sourceRepository: string;
  sourceCommit: string;
  issueKey: string;
  rootCauseKey: string;
  observedAt: string;
  category: PrivateCategory;
  signals: PrivateSignal[];
  claim: string;
  evidence: Array<{ path: string; excerpt: string }>;
  gold: "yes" | "no" | "insufficient-evidence";
}

export interface PrivateSanitizationPolicy {
  authorizedRepository: string;
  pseudonymKey: Buffer;
  corpusSalt: string;
  forbiddenLiterals: string[];
}

export interface PrivateStructuralCase {
  schemaVersion: typeof PRIVATE_STRUCTURAL_CASE_VERSION;
  caseId: string;
  sourceClass: "authorized-private-structural";
  groupId: string;
  category: PrivateCategory;
  signals: PrivateSignal[];
  gold: "yes" | "no" | "insufficient-evidence";
  sanitizationPolicy: "asc/laya-private-structural/v1";
}

export interface PrivateLeakageReport {
  schemaVersion: "asc/laya-private-leakage-report/v2";
  caseCount: number;
  secretCanaryMatches: number;
  rawIdentifierMatches: number;
  rawPathMatches: number;
  sourceIdentityMatches: number;
  rawTextFields: number;
  eligible: boolean;
}

export interface PrivateStructuralTrainingView {
  input: string;
  answer: "yes" | "no" | "insufficient-evidence";
}

export interface PrivateStructuralCorpus {
  schemaVersion: "asc/laya-private-structural-corpus/v1";
  cases: PrivateStructuralCase[];
  report: PrivateLeakageReport;
}

const CONTROL = /[\p{Cc}\p{Cf}]/u;
const SHA40 = /^[0-9a-f]{40}$/u;
const GENERIC_PRIVATE_VALUE =
  /(?:\b\d{12}\b|arn:aws:|https?:\/\/|git@[\w.-]+:|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\/(?:Users|home)\/|[A-Z]:\\|(?:^|\s)(?:\d{1,3}\.){3}\d{1,3}(?:\s|$)|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|\b(?:localhost|[\w-]+\.(?:local|internal|corp))\b)/iu;

function normalize(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") throw new Error(`${label}は文字列が必要です`);
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > maximum || CONTROL.test(normalized))
    throw new Error(`${label}が空、長過ぎる、または制御文字を含みます`);
  return normalized;
}

function assertNoPrivateValue(
  value: unknown,
  label: string,
  maximum: number,
  forbidden: readonly string[],
): string {
  const normalized = normalize(value, label, maximum);
  const folded = normalized.normalize("NFKC").toLocaleLowerCase("und");
  if (
    redactSecrets(normalized) !== normalized ||
    redactSecrets(folded) !== folded ||
    GENERIC_PRIVATE_VALUE.test(folded) ||
    forbidden.some((item) =>
      folded.includes(item.normalize("NFKC").toLocaleLowerCase("und")),
    )
  )
    throw new Error(`${label}に秘密または固有情報があります`);
  return normalized;
}

function hmac(
  key: Buffer,
  scope: string,
  salt: string,
  kind: string,
  value: string,
): string {
  return `${kind}-${crypto
    .createHmac("sha256", key)
    .update(
      stableJson({
        schemaVersion: PRIVATE_STRUCTURAL_CASE_VERSION,
        scope,
        salt,
        kind,
        value,
      }),
    )
    .digest("hex")
    .slice(0, 24)}`;
}

export function createPrivateStructuralCase(
  value: RawAuthorizedPrivateCase,
  policy: PrivateSanitizationPolicy,
): PrivateStructuralCase {
  if (value.sourceRepository !== policy.authorizedRepository)
    throw new Error("owner許可済みrepository以外を拒否しました");
  if (!SHA40.test(value.sourceCommit))
    throw new Error("private sourceCommitは完全SHAが必要です");
  if (
    !Buffer.isBuffer(policy.pseudonymKey) ||
    policy.pseudonymKey.length !== 32 ||
    new Set(policy.pseudonymKey).size < 20
  )
    throw new Error("pseudonym keyは高entropyの32 byte binary値が必要です");
  if (!/^[0-9a-f]{64}$/u.test(policy.corpusSalt))
    throw new Error("corpus saltは256-bit hex値が必要です");
  if (
    !Array.isArray(policy.forbiddenLiterals) ||
    policy.forbiddenLiterals.length === 0
  )
    throw new Error("固有情報の禁止語が必要です");
  const forbidden = policy.forbiddenLiterals.map((item) =>
    normalize(item, "forbidden literal", 256),
  );
  const observedAt = new Date(value.observedAt).toISOString();
  if (observedAt !== value.observedAt)
    throw new Error("observedAtは正規ISO 8601 UTC instantが必要です");
  const issueKey = normalize(value.issueKey, "issueKey", 128);
  const rootCauseKey = normalize(value.rootCauseKey, "rootCauseKey", 256);
  assertNoPrivateValue(value.claim, "claim", 4096, forbidden);
  if (
    !Array.isArray(value.evidence) ||
    value.evidence.length < 1 ||
    value.evidence.length > 16
  )
    throw new Error("private evidenceは1〜16件が必要です");
  for (const evidence of value.evidence) {
    normalize(evidence.path, "evidence.path", 1024);
    assertNoPrivateValue(evidence.excerpt, "evidence.excerpt", 8192, forbidden);
  }
  if (!PRIVATE_CASE_CATEGORIES.includes(value.category))
    throw new Error("private categoryが不正です");
  if (
    !Array.isArray(value.signals) ||
    value.signals.length === 0 ||
    new Set(value.signals).size !== value.signals.length ||
    value.signals.some((signal) => !PRIVATE_CASE_SIGNALS.includes(signal))
  )
    throw new Error("private signalsが不正です");
  if (!(["yes", "no", "insufficient-evidence"] as const).includes(value.gold))
    throw new Error("private goldが不正です");
  return {
    schemaVersion: PRIVATE_STRUCTURAL_CASE_VERSION,
    caseId: hmac(
      policy.pseudonymKey,
      policy.authorizedRepository,
      policy.corpusSalt,
      "case",
      `${value.sourceCommit}\0${issueKey}\0${rootCauseKey}\0${stableJson({ claim: value.claim, evidence: value.evidence })}`,
    ),
    sourceClass: "authorized-private-structural",
    groupId: hmac(
      policy.pseudonymKey,
      policy.authorizedRepository,
      policy.corpusSalt,
      "group",
      `${issueKey}\0${rootCauseKey}`,
    ),
    category: value.category,
    signals: [...value.signals].sort(),
    gold: value.gold,
    sanitizationPolicy: "asc/laya-private-structural/v1",
  };
}

export function assessPrivateStructuralLeakage(
  cases: readonly PrivateStructuralCase[],
  forbiddenValues: readonly string[],
): PrivateLeakageReport {
  const serialized = stableJson(cases);
  const folded = serialized.normalize("NFKC").toLocaleLowerCase("und");
  const rawIdentifierMatches = forbiddenValues
    .map((value) => value.normalize("NFC").trim())
    .filter((value) => value.length > 0)
    .filter((value) =>
      folded.includes(value.normalize("NFKC").toLocaleLowerCase("und")),
    ).length;
  const secretCanaryMatches =
    /ASC_PRIVATE_CANARY_|github_pat_|gh[pousr]_/u.test(serialized) ? 1 : 0;
  const rawPathMatches =
    /\/(?:Users|home)\/|[A-Za-z]:\\|(?:src|docs|test)\//u.test(serialized)
      ? 1
      : 0;
  const sourceIdentityMatches = /[0-9a-f]{40}/iu.test(serialized) ? 1 : 0;
  const rawTextFields =
    /"(?:claim|evidence|path|excerpt|sourceCommit|sourceRepository)"/u.test(
      serialized,
    )
      ? 1
      : 0;
  return {
    schemaVersion: "asc/laya-private-leakage-report/v2",
    caseCount: cases.length,
    secretCanaryMatches,
    rawIdentifierMatches,
    rawPathMatches,
    sourceIdentityMatches,
    rawTextFields,
    eligible:
      cases.length > 0 &&
      secretCanaryMatches === 0 &&
      rawIdentifierMatches === 0 &&
      rawPathMatches === 0 &&
      sourceIdentityMatches === 0 &&
      rawTextFields === 0,
  };
}

export function validatePrivateStructuralCase(
  value: PrivateStructuralCase,
): PrivateStructuralCase {
  const allowed = new Set([
    "schemaVersion",
    "caseId",
    "sourceClass",
    "groupId",
    "category",
    "signals",
    "gold",
    "sanitizationPolicy",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new Error("private structural caseに未知fieldがあります");
  if (
    value.schemaVersion !== PRIVATE_STRUCTURAL_CASE_VERSION ||
    value.sourceClass !== "authorized-private-structural" ||
    value.sanitizationPolicy !== "asc/laya-private-structural/v1" ||
    !/^case-[0-9a-f]{24}$/u.test(value.caseId) ||
    !/^group-[0-9a-f]{24}$/u.test(value.groupId) ||
    !PRIVATE_CASE_CATEGORIES.includes(value.category) ||
    !Array.isArray(value.signals) ||
    value.signals.length === 0 ||
    new Set(value.signals).size !== value.signals.length ||
    value.signals.some((signal) => !PRIVATE_CASE_SIGNALS.includes(signal)) ||
    !(["yes", "no", "insufficient-evidence"] as const).includes(value.gold)
  )
    throw new Error("private structural case contractが不正です");
  if (!assessPrivateStructuralLeakage([value], []).eligible)
    throw new Error("private structural caseに漏洩候補があります");
  return value;
}

export function createPrivateStructuralTrainingView(
  value: PrivateStructuralCase,
): PrivateStructuralTrainingView {
  const validated = validatePrivateStructuralCase(value);
  return {
    input: `category=${validated.category};signals=${validated.signals.join(",")}`,
    answer: validated.gold,
  };
}

export function validatePrivateStructuralCorpus(
  input: unknown,
  forbiddenValues: readonly string[],
): PrivateStructuralCorpus {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("private structural corpusはobjectが必要です");
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(",") !== "cases,report,schemaVersion" ||
    value.schemaVersion !== "asc/laya-private-structural-corpus/v1" ||
    !Array.isArray(value.cases) ||
    value.cases.length === 0
  )
    throw new Error("private structural corpus contractが不正です");
  const cases = value.cases.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("private structural caseはobjectが必要です");
    return validatePrivateStructuralCase(item as PrivateStructuralCase);
  });
  const caseIds = cases.map((item) => item.caseId);
  if (
    new Set(caseIds).size !== caseIds.length ||
    caseIds.some((caseId, index) => index > 0 && caseIds[index - 1]! > caseId)
  )
    throw new Error("private structural caseの順序または一意性が不正です");
  const expectedReport = assessPrivateStructuralLeakage(cases, forbiddenValues);
  if (stableJson(value.report) !== stableJson(expectedReport))
    throw new Error(
      "private structural leakage reportが再計算値と一致しません",
    );
  return {
    schemaVersion: "asc/laya-private-structural-corpus/v1",
    cases,
    report: expectedReport,
  };
}
