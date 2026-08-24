import { validateDevelopmentConsiderationRecords } from "./conformance.js";

const AFFIRMATIVE = [
  "correctness",
  "value",
  "feasibility",
  "consistency",
  "maintainability",
];
const ADVERSARIAL = [
  "counterexamples",
  "failures",
  "boundaries",
  "abuse",
  "security",
  "dataLoss",
  "rollback",
  "scope",
];
const VALUES = new Set(["pass", "finding", "not-applicable"]);
const DISPOSITIONS = new Set([
  "valid",
  "resolved",
  "duplicate",
  "false-positive",
  "out-of-scope",
]);
const SEVERITIES = new Set(["Critical", "High", "Medium", "Low"]);
const EVIDENCE_ONLY_PREFIXES = ["docs/reviews/", ".agent-skill-chain/reviews/"];

interface RiskAcceptance {
  authority?: unknown;
  owner?: unknown;
  reason?: unknown;
  reviewCondition?: unknown;
}
interface ArtifactEvidence {
  path?: unknown;
  sha256?: unknown;
  blobOid?: unknown;
}
interface CandidateEvidence {
  implementationCommitSha?: unknown;
  finalCommitSha?: unknown;
  implementationTreeSha?: unknown;
  implementationIsAncestor?: unknown;
  changedPaths?: unknown[];
  artifact?: ArtifactEvidence;
}
interface ProvenanceEvidence {
  source?: unknown;
  repository?: unknown;
  prNumber?: unknown;
  runId?: unknown;
  reviewId?: unknown;
}
interface ImplementationEvidence {
  repository?: unknown;
  commitSha?: unknown;
  authorActorId?: unknown;
}
interface PullRequestEvidence {
  repository?: unknown;
  number?: unknown;
  headSha?: unknown;
  authorActorId?: unknown;
}
interface CiEvidence {
  repository?: unknown;
  runId?: unknown;
  event?: unknown;
  headSha?: unknown;
  conclusion?: unknown;
  pullRequestNumbers?: unknown[];
}
interface ExternalReviewEvidence {
  repository?: unknown;
  prNumber?: unknown;
  reviewId?: unknown;
  commitSha?: unknown;
  actorId?: unknown;
  submittedAt?: unknown;
  verdict?: unknown;
}
interface ExternalEvidence {
  provenance?: ProvenanceEvidence;
  implementation?: ImplementationEvidence;
  pr?: PullRequestEvidence;
  ci?: CiEvidence;
  review?: ExternalReviewEvidence;
}
interface ImmutableReviewEvidence {
  headSha?: unknown;
  candidateEvidence?: CandidateEvidence;
  externalEvidence?: ExternalEvidence;
}
interface ReviewObservation {
  implementationCommitSha?: unknown;
  finalCommitSha?: unknown;
  implementationTreeSha?: unknown;
  implementationIsAncestor?: unknown;
  changedPaths?: unknown[];
  artifact?: ArtifactEvidence;
  externalEvidence?: ExternalEvidence;
}
interface Finding {
  id?: string;
  severity?: string;
  status?: string;
  evidence?: unknown;
  reproductionSteps?: unknown;
  reproductionResult?: unknown;
  riskAcceptance?: RiskAcceptance;
}
interface ReviewInput extends ImmutableReviewEvidence {
  round: number;
  developmentConsiderations?: unknown;
  affirmative?: Record<string, string>;
  adversarial?: Record<string, string>;
  rationales?: {
    affirmative?: Record<string, string>;
    adversarial?: Record<string, string>;
  };
  focus?: {
    unresolvedBlocking?: unknown;
    fixedDiff?: unknown;
    adjacentScope?: unknown;
    fullRescan?: boolean;
  };
  tests?: string;
  specConsistency?: string;
  findings?: Finding[];
}

function reviewInput(value: unknown): value is ReviewInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const allowed = [
    "round",
    "developmentConsiderations",
    "affirmative",
    "adversarial",
    "rationales",
    "focus",
    "tests",
    "specConsistency",
    "findings",
    "headSha",
    "candidateEvidence",
    "externalEvidence",
    "valid",
    "status",
    "errors",
  ];
  if (Object.keys(record).some((key) => !allowed.includes(key))) return false;
  if (typeof record.round !== "number") return false;
  if (record.valid !== undefined && typeof record.valid !== "boolean")
    return false;
  if (record.status !== undefined && typeof record.status !== "string")
    return false;
  if (
    record.errors !== undefined &&
    (!Array.isArray(record.errors) ||
      !record.errors.every((item) => typeof item === "string"))
  )
    return false;
  for (const [field, expected] of [
    ["affirmative", AFFIRMATIVE],
    ["adversarial", ADVERSARIAL],
  ] as const)
    if (
      record[field] !== undefined &&
      (!isStringRecord(record[field]) ||
        Object.keys(record[field]).some((key) => !expected.includes(key)))
    )
      return false;
  if (record.rationales !== undefined) {
    if (!isPlainRecord(record.rationales)) return false;
    if (
      Object.keys(record.rationales).some(
        (key) => !["affirmative", "adversarial"].includes(key),
      )
    )
      return false;
    for (const [field, expected] of [
      ["affirmative", AFFIRMATIVE],
      ["adversarial", ADVERSARIAL],
    ] as const)
      if (
        record.rationales[field] !== undefined &&
        (!isStringRecord(record.rationales[field]) ||
          Object.keys(record.rationales[field]).some(
            (key) => !expected.includes(key),
          ))
      )
        return false;
  }
  if (record.focus !== undefined) {
    if (!isPlainRecord(record.focus)) return false;
    if (
      Object.keys(record.focus).some(
        (key) =>
          ![
            "unresolvedBlocking",
            "fixedDiff",
            "adjacentScope",
            "fullRescan",
          ].includes(key),
      )
    )
      return false;
  }
  if (
    record.findings !== undefined &&
    (!Array.isArray(record.findings) ||
      !record.findings.every(
        (finding) =>
          isPlainRecord(finding) &&
          Object.keys(finding).every((key) =>
            [
              "id",
              "severity",
              "status",
              "evidence",
              "reproductionSteps",
              "reproductionResult",
              "riskAcceptance",
            ].includes(key),
          ) &&
          (finding.riskAcceptance === undefined ||
            (isPlainRecord(finding.riskAcceptance) &&
              Object.keys(finding.riskAcceptance).every((key) =>
                ["authority", "owner", "reason", "reviewCondition"].includes(
                  key,
                ),
              ))),
      ))
  )
    return false;
  if (
    record.candidateEvidence !== undefined &&
    !isPlainRecord(record.candidateEvidence)
  )
    return false;
  if (
    record.externalEvidence !== undefined &&
    !isPlainRecord(record.externalEvidence)
  )
    return false;
  return true;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isPlainRecord(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function validRiskAcceptance(acceptance?: RiskAcceptance): boolean {
  return (
    acceptance?.authority === "human" &&
    typeof acceptance.owner === "string" &&
    acceptance.owner.trim() !== "" &&
    typeof acceptance.reason === "string" &&
    acceptance.reason.trim().length >= 12 &&
    typeof acceptance.reviewCondition === "string" &&
    acceptance.reviewCondition.trim() !== ""
  );
}

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.trim() !== "")
  );
}

function commitOid(value: unknown): value is string {
  return (
    typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value)
  );
}
function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}
function stableActorId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9_.:=/-]{0,255}$/u.test(value)
  );
}
function safeEvidencePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    EVIDENCE_ONLY_PREFIXES.some((prefix) => value.startsWith(prefix)) &&
    !value.includes("..") &&
    !/[\\\u0000-\u001f\u007f]/u.test(value)
  );
}
function exactFields(
  object: unknown,
  fields: string[],
  label: string,
  errors: string[],
): void {
  if (!object || typeof object !== "object" || Array.isArray(object)) {
    errors.push(`${label}がobjectではありません`);
    return;
  }
  const record = object as Record<string, unknown>;
  for (const field of fields)
    if (record[field] === undefined) errors.push(`${label}.${field}が必要です`);
  for (const field of Object.keys(object))
    if (!fields.includes(field))
      errors.push(`${label}.${field}は未知fieldです`);
}

function validateImmutableCandidateEvidence(
  review: ImmutableReviewEvidence,
): string[] {
  const errors: string[] = [];
  const candidate = review.candidateEvidence;
  const external = review.externalEvidence;
  exactFields(
    candidate,
    [
      "implementationCommitSha",
      "finalCommitSha",
      "implementationTreeSha",
      "implementationIsAncestor",
      "changedPaths",
      "artifact",
    ],
    "candidateEvidence",
    errors,
  );
  exactFields(
    candidate?.artifact,
    ["path", "sha256", "blobOid"],
    "candidateEvidence.artifact",
    errors,
  );
  exactFields(
    external,
    ["provenance", "implementation", "pr", "ci", "review"],
    "externalEvidence",
    errors,
  );
  exactFields(
    external?.provenance,
    ["source", "repository", "prNumber", "runId", "reviewId"],
    "externalEvidence.provenance",
    errors,
  );
  exactFields(
    external?.implementation,
    ["repository", "commitSha", "authorActorId"],
    "externalEvidence.implementation",
    errors,
  );
  exactFields(
    external?.pr,
    ["repository", "number", "headSha", "authorActorId"],
    "externalEvidence.pr",
    errors,
  );
  exactFields(
    external?.ci,
    [
      "repository",
      "runId",
      "event",
      "headSha",
      "conclusion",
      "pullRequestNumbers",
    ],
    "externalEvidence.ci",
    errors,
  );
  exactFields(
    external?.review,
    [
      "repository",
      "prNumber",
      "reviewId",
      "commitSha",
      "actorId",
      "submittedAt",
      "verdict",
    ],
    "externalEvidence.review",
    errors,
  );
  if (!commitOid(candidate?.implementationCommitSha))
    errors.push("H_implが不正です");
  if (!commitOid(candidate?.finalCommitSha)) errors.push("H_finalが不正です");
  if (candidate?.implementationCommitSha === candidate?.finalCommitSha)
    errors.push("H_implとH_finalは異なるcommitでなければなりません");
  if (!commitOid(candidate?.implementationTreeSha))
    errors.push("implementation tree OIDが不正です");
  if (candidate?.implementationIsAncestor !== true)
    errors.push("H_implがH_finalのancestorである観測証拠が必要です");
  if (
    !Array.isArray(candidate?.changedPaths) ||
    candidate.changedPaths.length !== 1 ||
    candidate.changedPaths[0] !== candidate?.artifact?.path ||
    !safeEvidencePath(candidate.changedPaths[0])
  )
    errors.push(
      "H_impl..H_finalはartifact pathだけのevidence-only差分でなければなりません",
    );
  if (!safeEvidencePath(candidate?.artifact?.path))
    errors.push("review artifact pathがevidence-only allowlist外です");
  if (!sha256(candidate?.artifact?.sha256))
    errors.push("review artifact sha256が不正です");
  if (!commitOid(candidate?.artifact?.blobOid))
    errors.push("review artifact blob OIDが不正です");
  const final = candidate?.finalCommitSha;
  const repository = external?.provenance?.repository;
  if (external?.provenance?.source !== "github")
    errors.push("trusted GitHub providerの観測証拠が必要です");
  if (
    typeof repository !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)
  )
    errors.push("repositoryが不正です");
  if (
    external?.implementation?.repository !== repository ||
    external?.pr?.repository !== repository ||
    external?.ci?.repository !== repository ||
    external?.review?.repository !== repository
  )
    errors.push("全GitHub証拠のrepositoryが一致しません");
  if (
    external?.implementation?.commitSha !== candidate?.implementationCommitSha
  )
    errors.push("implementation commit SHAがH_implと一致しません");
  if (!stableActorId(external?.implementation?.authorActorId))
    errors.push("implementation commit author stable IDが不正です");
  if (
    typeof external?.pr?.number !== "number" ||
    !Number.isInteger(external.pr.number) ||
    external.pr.number <= 0
  )
    errors.push("PR numberが不正です");
  if (external?.provenance?.prNumber !== external?.pr?.number)
    errors.push("providerのPR numberが一致しません");
  if (external?.review?.prNumber !== external?.pr?.number)
    errors.push("reviewのPR numberが一致しません");
  if (
    typeof external?.ci?.runId !== "string" ||
    !/^[1-9]\d*$/u.test(external.ci.runId)
  )
    errors.push("Actions run IDが不正です");
  if (external?.provenance?.runId !== external?.ci?.runId)
    errors.push("providerのrun IDが一致しません");
  if (
    !Array.isArray(external?.ci?.pullRequestNumbers) ||
    external.ci.pullRequestNumbers.length !== 1 ||
    external.ci.pullRequestNumbers[0] !== external?.pr?.number
  )
    errors.push("Actions runのPR numberが対象PRと一致しません");
  if (
    typeof external?.review?.reviewId !== "string" ||
    !/^[1-9]\d*$/u.test(external.review.reviewId)
  )
    errors.push("review IDが不正です");
  if (external?.provenance?.reviewId !== external?.review?.reviewId)
    errors.push("providerのreview IDが一致しません");
  if (review.headSha !== final) errors.push("headShaがH_finalと一致しません");
  if (external?.pr?.headSha !== final)
    errors.push("PR headがH_finalと一致しません");
  if (external?.ci?.headSha !== final)
    errors.push("CI headがH_finalと一致しません");
  if (external?.review?.commitSha !== final)
    errors.push("review metadata commitがH_finalと一致しません");
  if (external?.ci?.event !== "pull_request")
    errors.push("CIは対象PRのpull_request eventでなければなりません");
  if (external?.ci?.conclusion !== "success")
    errors.push("CI conclusionはsuccessでなければなりません");
  if (!stableActorId(external?.pr?.authorActorId))
    errors.push("PR author stable actor IDが不正です");
  if (!stableActorId(external?.review?.actorId))
    errors.push("review stable actor IDが不正です");
  if (external?.review?.actorId === external?.pr?.authorActorId)
    errors.push("reviewerはPR authorと独立していなければなりません");
  if (external?.review?.actorId === external?.implementation?.authorActorId)
    errors.push(
      "reviewerはobserved implementation commit authorと独立していなければなりません",
    );
  if (
    typeof external?.review?.submittedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(
      external.review.submittedAt,
    ) ||
    !Number.isFinite(Date.parse(external.review.submittedAt))
  )
    errors.push("review submittedAtが不正です");
  if (external?.review?.verdict !== "approved")
    errors.push("review approved verdictが必要です");
  return errors;
}

/** Build the domain evidence from already observed Git/GitHub metadata. */
export function buildReviewEvidence(observation: ReviewObservation) {
  const evidence = {
    candidateEvidence: {
      implementationCommitSha: observation?.implementationCommitSha,
      finalCommitSha: observation?.finalCommitSha,
      implementationTreeSha: observation?.implementationTreeSha,
      implementationIsAncestor: observation?.implementationIsAncestor,
      changedPaths: observation?.changedPaths,
      artifact: observation?.artifact,
    },
    externalEvidence: observation?.externalEvidence,
  };
  const errors = validateImmutableCandidateEvidence({
    headSha: observation?.finalCommitSha,
    ...evidence,
  });
  const pending = errors.some((error) =>
    /CI conclusion|approved verdict|submittedAt/u.test(error),
  );
  return {
    valid: errors.length === 0,
    status: errors.length === 0 ? "verified" : pending ? "pending" : "rejected",
    errors,
    ...evidence,
  };
}

export function evaluateReview(reviewValue: unknown) {
  if (!reviewInput(reviewValue))
    return {
      approved: false,
      blocking: [],
      acceptedRisks: [],
      errors: ["review入力の構造または未知fieldが不正です"],
    };
  const review = reviewValue;
  if (!Number.isInteger(review.round) || review.round < 1 || review.round > 3)
    throw new Error("レビューのラウンドは1〜3で指定してください");
  const errors: string[] = [];
  errors.push(
    ...validateDevelopmentConsiderationRecords(
      review.developmentConsiderations,
      "review",
    ).errors,
  );
  const perspectives: Array<["affirmative" | "adversarial", string[]]> = [
    ["affirmative", AFFIRMATIVE],
    ["adversarial", ADVERSARIAL],
  ];
  for (const [perspective, fields] of perspectives) {
    for (const field of fields) {
      const value = review[perspective]?.[field];
      if (typeof value !== "string" || !VALUES.has(value))
        errors.push(`${perspective}.${field}の評価が未完了です`);
      if (
        value === "not-applicable" &&
        (typeof review.rationales?.[perspective]?.[field] !== "string" ||
          review.rationales[perspective][field].trim() === "")
      ) {
        errors.push(`${perspective}.${field}のnot-applicable理由がありません`);
      }
    }
  }
  if (review.round >= 2) {
    if (
      !review.focus ||
      !stringArray(review.focus.unresolvedBlocking) ||
      !stringArray(review.focus.fixedDiff) ||
      !Array.isArray(review.focus.adjacentScope)
    ) {
      errors.push(
        `ラウンド${review.round}には未解決指摘・修正差分・隣接範囲の限定が必要です`,
      );
    }
    if (review.focus?.fullRescan !== false)
      errors.push(`ラウンド${review.round}で既承認範囲の全再走査はできません`);
  }
  if (!commitOid(review.headSha)) errors.push("headShaが不正です");
  errors.push(...validateImmutableCandidateEvidence(review));
  if (review.tests !== "pass") errors.push("テスト合格が必要です");
  if (review.specConsistency !== "pass")
    errors.push("仕様整合性の合格が必要です");
  const findings = Array.isArray(review.findings) ? review.findings : [];
  const blocking: string[] = [];
  const acceptedRisks: string[] = [];
  for (const finding of findings) {
    if (
      !finding.id ||
      !finding.severity ||
      !finding.status ||
      !finding.evidence
    )
      errors.push("指摘の必須項目が不足しています");
    if (
      typeof finding.severity !== "string" ||
      !SEVERITIES.has(finding.severity)
    )
      errors.push(`${finding.id ?? "指摘"}の重大度が不正です`);
    if (typeof finding.status !== "string" || !DISPOSITIONS.has(finding.status))
      errors.push(`${finding.id ?? "指摘"}の分類が不正です`);
    if (
      typeof finding.status === "string" &&
      DISPOSITIONS.has(finding.status) &&
      finding.status !== "valid" &&
      (typeof finding.reproductionSteps !== "string" ||
        finding.reproductionSteps.trim() === "" ||
        typeof finding.reproductionResult !== "string" ||
        finding.reproductionResult.trim() === "")
    )
      errors.push(
        `${finding.id ?? "指摘"}は分類前に現コードでの再現手順と再現結果が必要です`,
      );
    if (
      typeof finding.id === "string" &&
      typeof finding.severity === "string" &&
      ["Critical", "High"].includes(finding.severity) &&
      finding.status === "valid"
    ) {
      if (validRiskAcceptance(finding.riskAcceptance))
        acceptedRisks.push(finding.id);
      else blocking.push(finding.id);
    }
  }
  return {
    approved: errors.length === 0 && blocking.length === 0,
    blocking,
    acceptedRisks,
    errors,
  };
}

export const reviewRubrics = {
  affirmative: AFFIRMATIVE,
  adversarial: ADVERSARIAL,
};
