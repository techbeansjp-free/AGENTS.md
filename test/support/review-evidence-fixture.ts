import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  createReviewEvidence,
  renderReviewEvidence,
  reviewEvidenceDigest,
  sealReviewEvidence,
  REVIEW_EVIDENCE_SCHEMA_VERSION,
  type ReviewEvidence,
  type ReviewIndependenceMode,
} from "../../src/domain/review-evidence.js";
import {
  parseReviewSessionState,
  type ReviewSessionState,
} from "../../src/domain/review-convergence.js";

/**
 * testが共有するreview証跡fixture。**製品と同じ生成関数を通す。**
 * 手書きJSONを持たないことで、正規直列化・digest規則の変更に1箇所で追随する。
 */
export function reviewEvidenceFromSession(
  session: ReviewSessionState,
  options: {
    issue?: number;
    baseSha?: string;
    implementationHeadSha?: string;
    independenceMode?: ReviewIndependenceMode;
    reviewer?: string;
    implementer?: string;
    verification?: readonly string[];
  } = {},
): ReviewEvidence {
  return createReviewEvidence({
    issue: options.issue ?? 1,
    baseSha: options.baseSha ?? session.anchor.diffBaseSha,
    implementationHeadSha:
      options.implementationHeadSha ?? session.latestCandidateHeadSha,
    session,
    independenceMode: options.independenceMode ?? "context-isolated",
    reviewer: options.reviewer ?? "reviewer-context",
    implementer: options.implementer ?? "implementer-context",
    verification: options.verification ?? ["npm test"],
  });
}

/** stagingの`review-session.json`から証跡の正規byte列を作る。 */
export function reviewEvidenceContentFromStaging(
  staging: string,
  options: Parameters<typeof reviewEvidenceFromSession>[1] = {},
): string {
  const session = parseReviewSessionState(
    JSON.parse(
      fs.readFileSync(path.join(staging, "review-session.json"), "utf8"),
    ) as unknown,
  );
  return renderReviewEvidence(reviewEvidenceFromSession(session, options));
}

function fakeDigest(label: string): string {
  return crypto.createHash("sha256").update(label).digest("hex");
}

/**
 * sessionを持たないGit fixture（`audit:check`など）用の証跡。sessionIdと
 * round digestは固定labelから導いた値であり、session照合を行う経路では使わない。
 */
export function syntheticReviewEvidence(input: {
  baseSha: string;
  implementationHeadSha: string;
  issue?: number;
  countedRounds?: number;
  independenceMode?: ReviewIndependenceMode;
  verification?: readonly string[];
}): ReviewEvidence {
  return sealReviewEvidence({
    schemaVersion: REVIEW_EVIDENCE_SCHEMA_VERSION,
    issue: input.issue ?? 1,
    baseSha: input.baseSha,
    implementationHeadSha: input.implementationHeadSha,
    session: {
      sessionId: fakeDigest(`session:${input.implementationHeadSha}`),
      latestRoundDigest: fakeDigest(`round:${input.implementationHeadSha}`),
      status: "converged",
      countedRounds: input.countedRounds ?? 1,
    },
    findings: [],
    unresolvedCriticalHigh: [],
    independence: {
      mode: input.independenceMode ?? "context-isolated",
      reviewer: "reviewer-context",
      implementer: "implementer-context",
      reviewerModifiedCandidate: false,
    },
    verdict: "approved",
    verification: (input.verification ?? ["npm test"]).map((command) => ({
      command,
      result: "pass" as const,
    })),
  });
}

/** `syntheticReviewEvidence`の正規byte列。 */
export function syntheticReviewEvidenceContent(
  input: Parameters<typeof syntheticReviewEvidence>[0],
): string {
  return renderReviewEvidence(syntheticReviewEvidence(input));
}

/** 証跡のbodyを変えてdigestを付け直す。改竄fixtureではなく「別の正当な証跡」を作る。 */
export function resealReviewEvidence(
  evidence: ReviewEvidence,
  change: Partial<Omit<ReviewEvidence, "evidenceDigest">>,
): string {
  const { evidenceDigest: _ignored, ...body } = evidence;
  void _ignored;
  return renderReviewEvidence(sealReviewEvidence({ ...body, ...change }));
}

/**
 * 値の検査を通さずにdigestだけを付けた正規byte列。parserの拒否（round上限など）を
 * 観測するfixture専用であり、製品の生成経路では作れない値を書く。
 */
export function unvalidatedReviewEvidenceContent(
  input: Parameters<typeof syntheticReviewEvidence>[0],
): string {
  const valid = syntheticReviewEvidence({ ...input, countedRounds: 1 });
  const { evidenceDigest: _ignored, ...body } = valid;
  void _ignored;
  const changed = {
    ...body,
    session: { ...body.session, countedRounds: input.countedRounds ?? 1 },
  };
  return renderReviewEvidence({
    ...changed,
    evidenceDigest: reviewEvidenceDigest(changed),
  });
}
