import crypto from "node:crypto";
import { parseJsonStrict, stableJson } from "../lib/security.js";
import { isRecord } from "../types.js";
import {
  countedRounds,
  REVIEW_RECOVERY_ROUND,
  type ReviewFindingRelation,
  type ReviewFindingSeverity,
  type ReviewFindingStatus,
  type ReviewSessionState,
} from "./review-convergence.js";

/**
 * Step 10の構造化review証跡（REQ-WF-038、TERM-ASC-WR-03）。
 *
 * **reviewの証明は散文ではなく構造化Evidenceである。Gitが示す事実を書き直さない。**
 * 本fileは`review export`だけが生成し、人やAIが手で書かない。安全性は次の3つで保つ。
 *
 * 1. 保存済みreview session（`review-session.json`）から導出できる値だけを持つ。
 *    消費側は毎回sessionから再導出し、fileの値をauthorityにしない
 * 2. `evidenceDigest`でfile全体の値を束縛する。1 byteの改変でも不一致になる
 * 3. 正規直列化（`renderReviewEvidence`）とbyte一致しないfileを拒否する。
 *    手書き・整形し直しを受理しない
 */
export const REVIEW_EVIDENCE_SCHEMA_VERSION =
  "agent-skill-chain/review-evidence/v1";

/** review証跡のfile名。`docs/reviews/<Issue番号>_review.json`。 */
export const REVIEW_EVIDENCE_NAME_PATTERN = /^([1-9]\d*)_review\.json$/u;

export type ReviewIndependenceMode = "context-isolated" | "actor-independent";

export interface ReviewEvidenceFinding {
  readonly id: string;
  readonly severity: ReviewFindingSeverity;
  readonly status: ReviewFindingStatus;
  readonly relation: ReviewFindingRelation;
  readonly path: string;
  readonly contractId: string | null;
}

export interface ReviewEvidenceVerification {
  readonly command: string;
  readonly result: "pass";
}

export interface ReviewEvidence {
  readonly schemaVersion: typeof REVIEW_EVIDENCE_SCHEMA_VERSION;
  readonly issue: number;
  readonly baseSha: string;
  readonly implementationHeadSha: string;
  readonly session: {
    readonly sessionId: string;
    readonly latestRoundDigest: string;
    readonly status: "converged";
    readonly countedRounds: number;
  };
  readonly findings: readonly ReviewEvidenceFinding[];
  readonly unresolvedCriticalHigh: readonly string[];
  readonly independence: {
    readonly mode: ReviewIndependenceMode;
    readonly reviewer: string;
    readonly implementer: string;
    readonly reviewerModifiedCandidate: false;
  };
  readonly verdict: "approved";
  readonly verification: readonly ReviewEvidenceVerification[];
  readonly evidenceDigest: string;
}

export type ReviewEvidenceBody = Omit<ReviewEvidence, "evidenceDigest">;

const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const STABLE_ID = /^[A-Z][A-Z0-9._-]{1,127}$/u;
const ACTOR_ID = /^[A-Za-z0-9][A-Za-z0-9_.:=/@-]{0,255}$/u;
const SEVERITIES = ["Critical", "High", "Medium", "Low"] as const;
const STATUSES = ["valid", "resolved", "duplicate", "false-positive"] as const;
const RELATIONS = [
  "acceptance-violation",
  "invariant-violation",
  "fix-regression",
  "improvement",
  "out-of-scope",
] as const;
const MODES = ["context-isolated", "actor-independent"] as const;
const MAX_VERIFICATIONS = 64;
const MAX_FINDINGS = 4096;

function exactObject(
  value: unknown,
  label: string,
  fields: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label}はobjectが必要です`);
  const unknown = Object.keys(value).filter((field) => !fields.includes(field));
  if (unknown.length > 0)
    throw new Error(`${label}の未知fieldを拒否しました: ${unknown.join(", ")}`);
  const missing = fields.filter(
    (field) => !Object.prototype.hasOwnProperty.call(value, field),
  );
  if (missing.length > 0)
    throw new Error(`${label}の必須fieldがありません: ${missing.join(", ")}`);
  return value;
}

function oneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  label: string,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value))
    throw new Error(`${label}が不正です`);
  return value as Values[number];
}

function oid(value: unknown, label: string): string {
  if (typeof value !== "string" || !OID.test(value))
    throw new Error(`${label}は小文字40桁または64桁のGit object IDが必要です`);
  return value;
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value))
    throw new Error(`${label}は小文字64桁のsha256が必要です`);
  return value;
}

function text(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value !== value.trim() ||
    value.normalize("NFC") !== value ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    Buffer.byteLength(value, "utf8") > 4096
  )
    throw new Error(`${label}は正規化済みの空でない1行の文字列が必要です`);
  return value;
}

function repositoryPath(value: unknown, label: string): string {
  const candidate = text(value, label);
  if (
    candidate.startsWith("/") ||
    candidate.includes("\\") ||
    candidate
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  )
    throw new Error(`${label}はrepository相対pathが必要です`);
  return candidate;
}

export function isReviewActorId(value: unknown): value is string {
  return typeof value === "string" && ACTOR_ID.test(value);
}

function actor(value: unknown, label: string): string {
  if (!isReviewActorId(value))
    throw new Error(
      `${label}は英数字で始まる256文字以下のstable identity（英数字と_.:=/@-）が必要です`,
    );
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label}は1以上の整数が必要です`);
  return value;
}

function parseFinding(value: unknown, index: number): ReviewEvidenceFinding {
  const label = `review evidence.findings[${index}]`;
  const finding = exactObject(value, label, [
    "id",
    "severity",
    "status",
    "relation",
    "path",
    "contractId",
  ]);
  if (typeof finding.id !== "string" || !STABLE_ID.test(finding.id))
    throw new Error(`${label}.idは安定IDが必要です`);
  if (
    finding.contractId !== null &&
    (typeof finding.contractId !== "string" ||
      !STABLE_ID.test(finding.contractId))
  )
    throw new Error(`${label}.contractIdはnullまたは安定IDが必要です`);
  return Object.freeze({
    id: finding.id,
    severity: oneOf(finding.severity, SEVERITIES, `${label}.severity`),
    status: oneOf(finding.status, STATUSES, `${label}.status`),
    relation: oneOf(finding.relation, RELATIONS, `${label}.relation`),
    path: repositoryPath(finding.path, `${label}.path`),
    contractId: finding.contractId,
  });
}

/** 値の検査だけを行い、digestとbyte表現は検査しない。 */
function parseEvidenceValue(value: unknown): ReviewEvidence {
  const evidence = exactObject(value, "review evidence", [
    "schemaVersion",
    "issue",
    "baseSha",
    "implementationHeadSha",
    "session",
    "findings",
    "unresolvedCriticalHigh",
    "independence",
    "verdict",
    "verification",
    "evidenceDigest",
  ]);
  if (evidence.schemaVersion !== REVIEW_EVIDENCE_SCHEMA_VERSION)
    throw new Error("review evidence.schemaVersionが不正です");
  const session = exactObject(evidence.session, "review evidence.session", [
    "sessionId",
    "latestRoundDigest",
    "status",
    "countedRounds",
  ]);
  if (session.status !== "converged")
    throw new Error(
      "review evidence.session.statusはconvergedだけを受理します",
    );
  const counted = positiveInteger(
    session.countedRounds,
    "review evidence.session.countedRounds",
  );
  if (counted > REVIEW_RECOVERY_ROUND)
    throw new Error(
      `review evidence.session.countedRoundsが上限${REVIEW_RECOVERY_ROUND}を超えています: ${counted}`,
    );
  if (
    !Array.isArray(evidence.findings) ||
    evidence.findings.length > MAX_FINDINGS
  )
    throw new Error(
      `review evidence.findingsは${MAX_FINDINGS}件以下の配列が必要です`,
    );
  const findings = evidence.findings.map(parseFinding);
  const ids = findings.map(({ id }) => id);
  if (stableJson(ids) !== stableJson([...new Set(ids)].sort()))
    throw new Error("review evidence.findingsはIDの重複なし昇順が必要です");
  if (
    !Array.isArray(evidence.unresolvedCriticalHigh) ||
    evidence.unresolvedCriticalHigh.length !== 0
  )
    throw new Error(
      "review evidence.unresolvedCriticalHighは空配列だけを受理します。未解決Critical/Highが残るreviewは証跡にできません",
    );
  const independence = exactObject(
    evidence.independence,
    "review evidence.independence",
    ["mode", "reviewer", "implementer", "reviewerModifiedCandidate"],
  );
  const reviewer = actor(
    independence.reviewer,
    "review evidence.independence.reviewer",
  );
  const implementer = actor(
    independence.implementer,
    "review evidence.independence.implementer",
  );
  if (reviewer === implementer)
    throw new Error(
      "review evidence.independence.reviewerとimplementerは異なるidentityが必要です",
    );
  if (independence.reviewerModifiedCandidate !== false)
    throw new Error(
      "review evidence.independence.reviewerModifiedCandidateはfalseだけを受理します",
    );
  if (evidence.verdict !== "approved")
    throw new Error("review evidence.verdictはapprovedだけを受理します");
  if (
    !Array.isArray(evidence.verification) ||
    evidence.verification.length < 1 ||
    evidence.verification.length > MAX_VERIFICATIONS
  )
    throw new Error(
      `review evidence.verificationは1〜${MAX_VERIFICATIONS}件が必要です`,
    );
  const verification = evidence.verification.map((candidate, index) => {
    const item = exactObject(
      candidate,
      `review evidence.verification[${index}]`,
      ["command", "result"],
    );
    if (item.result !== "pass")
      throw new Error(
        `review evidence.verification[${index}].resultはpassだけを受理します`,
      );
    return Object.freeze({
      command: text(
        item.command,
        `review evidence.verification[${index}].command`,
      ),
      result: "pass" as const,
    });
  });
  const commands = verification.map(({ command }) => command);
  if (new Set(commands).size !== commands.length)
    throw new Error("review evidence.verificationのcommandが重複しています");
  return Object.freeze({
    schemaVersion: REVIEW_EVIDENCE_SCHEMA_VERSION,
    issue: positiveInteger(evidence.issue, "review evidence.issue"),
    baseSha: oid(evidence.baseSha, "review evidence.baseSha"),
    implementationHeadSha: oid(
      evidence.implementationHeadSha,
      "review evidence.implementationHeadSha",
    ),
    session: Object.freeze({
      sessionId: sha256(session.sessionId, "review evidence.session.sessionId"),
      latestRoundDigest: sha256(
        session.latestRoundDigest,
        "review evidence.session.latestRoundDigest",
      ),
      status: "converged" as const,
      countedRounds: counted,
    }),
    findings: Object.freeze(findings),
    unresolvedCriticalHigh: Object.freeze([]),
    independence: Object.freeze({
      mode: oneOf(
        independence.mode,
        MODES,
        "review evidence.independence.mode",
      ),
      reviewer,
      implementer,
      reviewerModifiedCandidate: false as const,
    }),
    verdict: "approved" as const,
    verification: Object.freeze(verification),
    evidenceDigest: sha256(
      evidence.evidenceDigest,
      "review evidence.evidenceDigest",
    ),
  });
}

/** `evidenceDigest`を除く全fieldの正規JSONのsha256。 */
export function reviewEvidenceDigest(body: ReviewEvidenceBody): string {
  const withoutDigest = Object.fromEntries(
    Object.entries(body).filter(([field]) => field !== "evidenceDigest"),
  );
  return crypto
    .createHash("sha256")
    .update(stableJson(withoutDigest))
    .digest("hex");
}

/**
 * 正規直列化。field順を固定し、2 space indentと末尾改行1つで出力する。
 * **同じ値は常に同じbyte列になる。** 再固定のbyte一致比較はこの性質に依存する。
 */
export function renderReviewEvidence(evidence: ReviewEvidence): string {
  const ordered = {
    schemaVersion: evidence.schemaVersion,
    issue: evidence.issue,
    baseSha: evidence.baseSha,
    implementationHeadSha: evidence.implementationHeadSha,
    session: {
      sessionId: evidence.session.sessionId,
      latestRoundDigest: evidence.session.latestRoundDigest,
      status: evidence.session.status,
      countedRounds: evidence.session.countedRounds,
    },
    findings: evidence.findings.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      status: finding.status,
      relation: finding.relation,
      path: finding.path,
      contractId: finding.contractId,
    })),
    unresolvedCriticalHigh: [...evidence.unresolvedCriticalHigh],
    independence: {
      mode: evidence.independence.mode,
      reviewer: evidence.independence.reviewer,
      implementer: evidence.independence.implementer,
      reviewerModifiedCandidate:
        evidence.independence.reviewerModifiedCandidate,
    },
    verdict: evidence.verdict,
    verification: evidence.verification.map((item) => ({
      command: item.command,
      result: item.result,
    })),
    evidenceDigest: evidence.evidenceDigest,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** bodyへdigestを付けて値を検査した証跡を返す。 */
export function sealReviewEvidence(body: ReviewEvidenceBody): ReviewEvidence {
  return parseEvidenceValue({
    ...body,
    evidenceDigest: reviewEvidenceDigest(body),
  });
}

/**
 * review証跡fileを厳密に読む。未知field、型違い、digest不一致、
 * 正規直列化とのbyte不一致をすべて拒否する。
 */
export function parseReviewEvidence(source: string): ReviewEvidence {
  const evidence = parseEvidenceValue(
    parseJsonStrict(source, "review evidence"),
  );
  if (reviewEvidenceDigest(evidence) !== evidence.evidenceDigest)
    throw new Error(
      "review evidence.evidenceDigestが内容と一致しません。証跡は`review export`で再生成してください",
    );
  if (renderReviewEvidence(evidence) !== source)
    throw new Error(
      "review evidenceが正規直列化と一致しません。手書き・再整形した証跡は受理しません。`review export`で再生成してください",
    );
  return evidence;
}

/** 例外を投げずに読む。読めない場合は理由を返す。 */
export function tryParseReviewEvidence(
  source: string,
): { evidence: ReviewEvidence } | { error: string } {
  try {
    return { evidence: parseReviewEvidence(source) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * sessionの全roundを先頭から走査し、finding IDごとの最終状態を返す。
 * reviewer判断の本文（evidence文）は持たない。判断の記録はsessionが正本である。
 */
export function finalReviewFindings(
  session: ReviewSessionState,
): readonly ReviewEvidenceFinding[] {
  const latest = new Map<string, ReviewEvidenceFinding>();
  for (const round of session.rounds)
    for (const finding of round.findings)
      latest.set(
        finding.id,
        Object.freeze({
          id: finding.id,
          severity: finding.severity,
          status: finding.status,
          relation: finding.relation,
          path: finding.path,
          contractId: finding.contractId,
        }),
      );
  return Object.freeze(
    [...latest.values()].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    ),
  );
}

/** 最新roundのblocking。収束済みsessionでは空である。 */
export function unresolvedCriticalHighFindings(
  session: ReviewSessionState,
): readonly string[] {
  return Object.freeze([...(session.rounds.at(-1)?.blocking ?? [])].sort());
}

/**
 * 収束済みsessionと外部入力から証跡を組み立てる。**収束していない、blockerが残る、
 * reviewerとimplementerが同一、検証commandが無い場合は生成しない。**
 */
export function createReviewEvidence(input: {
  readonly issue: number;
  readonly baseSha: string;
  readonly implementationHeadSha: string;
  readonly session: ReviewSessionState;
  readonly independenceMode: ReviewIndependenceMode;
  readonly reviewer: string;
  readonly implementer: string;
  readonly verification: readonly string[];
}): ReviewEvidence {
  if (input.session.status !== "converged")
    throw new Error(
      `review sessionが収束していないため証跡を生成できません: status=${input.session.status}`,
    );
  const unresolved = unresolvedCriticalHighFindings(input.session);
  if (unresolved.length > 0)
    throw new Error(
      `未解決Critical/Highが残るため証跡を生成できません: ${unresolved.join(", ")}`,
    );
  return sealReviewEvidence({
    schemaVersion: REVIEW_EVIDENCE_SCHEMA_VERSION,
    issue: input.issue,
    baseSha: input.baseSha,
    implementationHeadSha: input.implementationHeadSha,
    session: {
      sessionId: input.session.sessionId,
      latestRoundDigest: input.session.latestRoundDigest,
      status: "converged",
      countedRounds: countedRounds(input.session),
    },
    findings: finalReviewFindings(input.session),
    unresolvedCriticalHigh: unresolved,
    independence: {
      mode: input.independenceMode,
      reviewer: input.reviewer,
      implementer: input.implementer,
      reviewerModifiedCandidate: false,
    },
    verdict: "approved",
    verification: input.verification.map((command) => ({
      command,
      result: "pass" as const,
    })),
  });
}

/**
 * 証跡を保存済みsessionと照合する。**fileの値をauthorityにせず、sessionから再導出した
 * 値との一致だけを受理する。** H_implとbaseのGit観測との照合はcallerが行う。
 */
export function validateReviewEvidenceAgainstSession(
  evidence: ReviewEvidence,
  session: ReviewSessionState | null,
  options: {
    readonly independenceMode?: ReviewIndependenceMode;
    /** 与えた場合だけ`implementationHeadSha`とsessionのcandidate HEADの一致を要求する。 */
    readonly requireSessionHead?: boolean;
  } = {},
): string[] {
  const errors: string[] = [];
  if (session === null)
    return ["review証跡を照合する永続review sessionがありません"];
  if (session.status !== "converged")
    errors.push(`review sessionが収束していません: status=${session.status}`);
  if (evidence.session.sessionId !== session.sessionId)
    errors.push("review証跡のsessionIdが保存済みsessionと一致しません");
  if (evidence.session.latestRoundDigest !== session.latestRoundDigest)
    errors.push(
      "review証跡のlatestRoundDigestが保存済みsessionの最新roundと一致しません",
    );
  if (evidence.session.countedRounds !== countedRounds(session))
    errors.push("review証跡のcountedRoundsが保存済みsessionと一致しません");
  if (
    stableJson(evidence.findings) !== stableJson(finalReviewFindings(session))
  )
    errors.push(
      "review証跡のfindingsが保存済みsessionのfinding最終状態と一致しません",
    );
  if (
    stableJson(evidence.unresolvedCriticalHigh) !==
    stableJson(unresolvedCriticalHighFindings(session))
  )
    errors.push(
      "review証跡の未解決Critical/Highが保存済みsessionと一致しません",
    );
  if (
    options.independenceMode !== undefined &&
    evidence.independence.mode !== options.independenceMode
  )
    errors.push(
      `review証跡の独立性モード${evidence.independence.mode}がtrusted policyの${options.independenceMode}と一致しません`,
    );
  if (
    options.requireSessionHead === true &&
    evidence.implementationHeadSha !== session.latestCandidateHeadSha
  )
    errors.push(
      "review証跡のimplementationHeadShaが保存済みsessionのcandidate HEADと一致しません",
    );
  return errors;
}

/**
 * 再固定で変わってよいfieldを除いた比較用の値。
 *
 * - `rebase`: 比較基点と`H_impl`だけが変わってよい
 * - `supersession`: 追加の検証記録（`verification`）だけが変わってよい
 * - `exact`: 何も変わってはならない（path是正）
 */
export function comparableReviewEvidence(
  evidence: ReviewEvidence,
  kind: "rebase" | "supersession" | "exact",
): string {
  const omitted = new Set<string>(["evidenceDigest"]);
  if (kind === "rebase") {
    omitted.add("baseSha");
    omitted.add("implementationHeadSha");
  }
  if (kind === "supersession") omitted.add("verification");
  return stableJson(
    Object.fromEntries(
      Object.entries(evidence).filter(([field]) => !omitted.has(field)),
    ),
  );
}
