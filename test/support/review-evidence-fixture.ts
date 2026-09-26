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
  type ReviewEvidenceObserved,
  type ReviewEvidenceVerification,
  type ReviewIndependenceMode,
} from "../../src/domain/review-evidence.js";
import {
  parseReviewSessionState,
  type ReviewSessionState,
} from "../../src/domain/review-convergence.js";
import {
  sealVerificationRun,
  selectObservedVerification,
  VERIFICATION_RUN_SCHEMA_VERSION,
  type VerificationRunRecord,
  type VerificationScope,
} from "../../src/domain/verification-run.js";
import { stagingRepositoryRoot } from "../../src/domain/staging-layout.js";
import { computeImpactSet } from "../../src/adapters/impact-set.js";
import { observeReviewDiff } from "../../src/adapters/review-diff.js";
import {
  appendVerificationRun,
  readVerificationRuns,
} from "../../src/adapters/verification-run.js";
import { FIXTURE_VERIFICATION_POLICY } from "./trusted-verification-policy.js";

/**
 * testが共有するreview証跡fixture。**製品と同じ生成関数を通す。**
 * 手書きJSONを持たないことで、正規直列化・digest規則の変更に1箇所で追随する。
 */
function fakeDigest(label: string): string {
  return crypto.createHash("sha256").update(label).digest("hex");
}

const FIXED_FINISHED_AT = "2026-09-26T00:00:00.000Z";

/** 検証commandの文字列表現をargvへ分ける（fixture専用。製品はargvを直接受け取る）。 */
export function fixtureArgv(command: string): string[] {
  return command.split(" ").filter(Boolean);
}

/**
 * fixture commandのscope。trusted fixture policyの`targetedRunner`で始まるものだけを
 * targetedとし、他はfullとして記録する（宣言外のfullは導出で拒否される）。
 */
export function fixtureScope(command: string): VerificationScope {
  const argv = fixtureArgv(command);
  const runner = FIXTURE_VERIFICATION_POLICY.targetedRunner;
  return runner.every((argument, index) => argv[index] === argument)
    ? "targeted"
    : "full";
}

/**
 * 記録を持たない合成の検証欄。session照合・記録照合を行わない経路（parser、
 * `audit:check`、比較関数）専用である。
 */
export function syntheticVerification(input: {
  implementationHeadSha: string;
  impactDigest: string;
  commands?: readonly string[];
  scope?: VerificationScope;
}): ReviewEvidenceVerification[] {
  return (input.commands ?? ["npm test"]).map((command) => ({
    command: fixtureArgv(command),
    scope: input.scope ?? fixtureScope(command),
    exitCode: 0 as const,
    headSha: input.implementationHeadSha,
    impactDigest: input.impactDigest,
    finishedAt: FIXED_FINISHED_AT,
    recordDigest: fakeDigest(
      `record:${input.implementationHeadSha}:${input.impactDigest}:${command}`,
    ),
  }));
}

function syntheticImpactDigest(baseSha: string, headSha: string): string {
  return fakeDigest(`impact:${baseSha}..${headSha}`);
}

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
    /**
     * 検証記録の終了時刻。**同じcommandの再実行**を別の記録として作るときに変える
     * （trusted policyはfull commandを1つしか宣言しないため、検証欄を変える前進修正は
     * 再実行で作る）。
     */
    verificationFinishedAt?: string;
    diffDigest?: string;
    impact?: { digest: string; mode: "targeted" | "full" };
    observedVerification?: readonly ReviewEvidenceVerification[];
  } = {},
): ReviewEvidence {
  const baseSha = options.baseSha ?? session.anchor.diffBaseSha;
  const implementationHeadSha =
    options.implementationHeadSha ?? session.latestCandidateHeadSha;
  const impact = options.impact ?? {
    digest: syntheticImpactDigest(baseSha, implementationHeadSha),
    mode: "full" as const,
  };
  return createReviewEvidence({
    issue: options.issue ?? 1,
    baseSha,
    implementationHeadSha,
    diffDigest:
      options.diffDigest ??
      fakeDigest(`diff:${baseSha}..${implementationHeadSha}`),
    session,
    impact,
    verification:
      options.observedVerification ??
      syntheticVerification({
        implementationHeadSha,
        impactDigest: impact.digest,
        ...(options.verification === undefined
          ? {}
          : { commands: options.verification }),
      }),
    independenceMode: options.independenceMode ?? "context-isolated",
    reviewer: options.reviewer ?? "reviewer-context",
    implementer: options.implementer ?? "implementer-context",
  });
}

/**
 * stagingへ製品と同じ形の検証記録を追記し、`selectObservedVerification`が導く
 * 検証欄を返す。影響集合とdiffはGitから実測する。
 */
export function recordObservedVerification(
  staging: string,
  input: {
    baseSha: string;
    implementationHeadSha: string;
    commands?: readonly string[];
    finishedAt?: string;
  },
): {
  diffDigest: string;
  impact: { digest: string; mode: "targeted" | "full" };
  verification: readonly ReviewEvidenceVerification[];
} {
  const observed = observeFixtureVerification(
    stagingRepositoryRoot(staging),
    input,
  );
  appendFixtureVerificationRecords(staging, observed.records);
  return {
    diffDigest: observed.diffDigest,
    impact: observed.impact,
    verification: selectObservedVerification(readVerificationRuns(staging), {
      headSha: input.implementationHeadSha,
      impactDigest: observed.impact.digest,
      impactMode: observed.impact.mode,
      impactFeatures: observed.features,
      policy: FIXTURE_VERIFICATION_POLICY,
    }),
  };
}

/** 観測済みの記録をstagingへ追記する。同じrecordDigestが既にあれば追記しない。 */
export function appendFixtureVerificationRecords(
  staging: string,
  records: readonly VerificationRunRecord[],
): void {
  for (const record of records)
    if (
      !readVerificationRuns(staging).some(
        (item) => item.recordDigest === record.recordDigest,
      )
    )
      appendVerificationRun(staging, record);
}

/**
 * Gitから影響集合とdiffを実測し、製品と同じ形の合格記録を封じて返す（stagingへは
 * 書かない）。**同じ入力は同じ記録になる**（時刻を固定する）。stagingを後から作る
 * fixtureは、`appendFixtureVerificationRecords`で同じ記録を追記できる。
 */
export function observeFixtureVerification(
  root: string,
  input: {
    baseSha: string;
    implementationHeadSha: string;
    commands?: readonly string[];
    finishedAt?: string;
  },
): {
  diffDigest: string;
  impact: { digest: string; mode: "targeted" | "full" };
  features: readonly string[];
  records: readonly VerificationRunRecord[];
  verification: readonly ReviewEvidenceVerification[];
} {
  const impact = computeImpactSet({
    root,
    baseSha: input.baseSha,
    headSha: input.implementationHeadSha,
  });
  const records = (input.commands ?? ["npm test"]).map((command) =>
    sealVerificationRun({
      schemaVersion: VERIFICATION_RUN_SCHEMA_VERSION,
      baseSha: input.baseSha,
      headSha: input.implementationHeadSha,
      command: fixtureArgv(command),
      scope: fixtureScope(command),
      impactDigest: impact.digest,
      impactMode: impact.mode,
      exitCode: 0,
      signal: null,
      startedAt: input.finishedAt ?? FIXED_FINISHED_AT,
      finishedAt: input.finishedAt ?? FIXED_FINISHED_AT,
      stdoutDigest: fakeDigest("stdout"),
      stderrDigest: fakeDigest("stderr"),
    }),
  );
  return {
    diffDigest: observeReviewDiff(
      root,
      input.baseSha,
      input.implementationHeadSha,
    ).digest,
    impact: { digest: impact.digest, mode: impact.mode },
    features: impact.features,
    records,
    verification: selectObservedVerification(records, {
      headSha: input.implementationHeadSha,
      impactDigest: impact.digest,
      impactMode: impact.mode,
      impactFeatures: impact.features,
      policy: FIXTURE_VERIFICATION_POLICY,
    }),
  };
}

/**
 * Gitから実測した観測値で、sessionの証跡を作る（stagingへは書かない）。同じ入力で
 * `observeFixtureVerification`の記録を後からstagingへ追記すれば照合を通る。
 */
export function observedReviewEvidenceFromSession(
  root: string,
  session: ReviewSessionState,
  options: Parameters<typeof reviewEvidenceFromSession>[1] = {},
): ReviewEvidence {
  const baseSha = options.baseSha ?? session.anchor.diffBaseSha;
  const implementationHeadSha =
    options.implementationHeadSha ?? session.latestCandidateHeadSha;
  const observed = observeFixtureVerification(root, {
    baseSha,
    implementationHeadSha,
    ...(options.verification === undefined
      ? {}
      : { commands: options.verification }),
    ...(options.verificationFinishedAt === undefined
      ? {}
      : { finishedAt: options.verificationFinishedAt }),
  });
  return reviewEvidenceFromSession(session, {
    ...options,
    baseSha,
    implementationHeadSha,
    diffDigest: observed.diffDigest,
    impact: observed.impact,
    observedVerification: observed.verification,
  });
}

/**
 * stagingの`review-session.json`から証跡の正規byte列を作る。**検証記録もstagingへ
 * 追記し、diff・影響集合はGitから実測する。** session・Git・記録照合を行う経路が
 * そのまま受理できる証跡になる。
 */
export function reviewEvidenceContentFromStaging(
  staging: string,
  options: Parameters<typeof reviewEvidenceFromSession>[1] = {},
): string {
  const session = parseReviewSessionState(
    JSON.parse(
      fs.readFileSync(path.join(staging, "review-session.json"), "utf8"),
    ) as unknown,
  );
  const baseSha = options.baseSha ?? session.anchor.diffBaseSha;
  const implementationHeadSha =
    options.implementationHeadSha ?? session.latestCandidateHeadSha;
  const observed = recordObservedVerification(staging, {
    baseSha,
    implementationHeadSha,
    ...(options.verification === undefined
      ? {}
      : { commands: options.verification }),
    ...(options.verificationFinishedAt === undefined
      ? {}
      : { finishedAt: options.verificationFinishedAt }),
  });
  return renderReviewEvidence(
    reviewEvidenceFromSession(session, {
      ...options,
      baseSha,
      implementationHeadSha,
      diffDigest: observed.diffDigest,
      impact: observed.impact,
      observedVerification: observed.verification,
    }),
  );
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
  const impactDigest = syntheticImpactDigest(
    input.baseSha,
    input.implementationHeadSha,
  );
  return sealReviewEvidence({
    schemaVersion: REVIEW_EVIDENCE_SCHEMA_VERSION,
    issue: input.issue ?? 1,
    observed: {
      baseSha: input.baseSha,
      implementationHeadSha: input.implementationHeadSha,
      diffDigest: fakeDigest(
        `diff:${input.baseSha}..${input.implementationHeadSha}`,
      ),
      session: {
        sessionId: fakeDigest(`session:${input.implementationHeadSha}`),
        latestRoundDigest: fakeDigest(`round:${input.implementationHeadSha}`),
        status: "converged",
        countedRounds: input.countedRounds ?? 1,
      },
      impact: { digest: impactDigest, mode: "full" },
      verification: syntheticVerification({
        implementationHeadSha: input.implementationHeadSha,
        impactDigest,
        ...(input.verification === undefined
          ? {}
          : { commands: input.verification }),
      }),
    },
    findings: [],
    unresolvedCriticalHigh: [],
    verdict: "approved",
    declared: {
      reviewer: "reviewer-context",
      implementer: "implementer-context",
      independenceMode: input.independenceMode ?? "context-isolated",
      reviewerModifiedCandidate: false,
    },
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
 * `observed`節の一部を変えてdigestを付け直す。比較基点または`H_impl`を変えると、
 * 検証欄のheadShaも新しい`H_impl`へ揃える（検証欄は`H_impl`へ束縛される）。
 */
export function resealObservedEvidence(
  evidence: ReviewEvidence,
  change: Partial<ReviewEvidenceObserved>,
  other: Partial<Omit<ReviewEvidence, "evidenceDigest" | "observed">> = {},
): string {
  const implementationHeadSha =
    change.implementationHeadSha ?? evidence.observed.implementationHeadSha;
  const verification = (
    change.verification ?? evidence.observed.verification
  ).map((item) => ({ ...item, headSha: implementationHeadSha }));
  return resealReviewEvidence(evidence, {
    ...other,
    observed: {
      ...evidence.observed,
      ...change,
      verification,
    },
  });
}

/** 検証commandを1件追加した検証欄。`verification`以外は変えない。 */
export function withAddedObservedVerification(
  evidence: ReviewEvidence,
  command = "npm run lint",
): ReviewEvidenceVerification[] {
  return [
    ...evidence.observed.verification,
    ...syntheticVerification({
      implementationHeadSha: evidence.observed.implementationHeadSha,
      impactDigest: evidence.observed.impact.digest,
      commands: [command],
    }),
  ];
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
    observed: {
      ...body.observed,
      session: {
        ...body.observed.session,
        countedRounds: input.countedRounds ?? 1,
      },
    },
  };
  return renderReviewEvidence({
    ...changed,
    evidenceDigest: reviewEvidenceDigest(changed),
  });
}
