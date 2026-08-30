import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  advanceReviewSession,
  parseReviewSessionState,
  type ReviewRoundInput,
  type ReviewSessionState,
} from "../domain/review-convergence.js";
import {
  calculateStagingDigest,
  listStagingArtifacts,
  readStoredStagingRecord,
  refreshStoredStagingDigest,
  withStagingMutationLock,
} from "../domain/staging.js";
import { writeFileAtomic } from "../lib/atomic.js";
import { git } from "../lib/process.js";
import { parseJsonStrict, stableJson } from "../lib/security.js";
import { assertWorkflowStaging } from "./workflow-journal.js";

export const REVIEW_SESSION_FILE = "review-session.json";

const GIT_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  LANG: "C",
  LC_ALL: "C",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
};

export function observeReviewDiff(
  root: string,
  baseSha: string,
  headSha: string,
): { digest: string; changedPaths: readonly string[] } {
  for (const [label, oid] of [
    ["base", baseSha],
    ["head", headSha],
  ] as const) {
    const observed = git(["rev-parse", "--verify", `${oid}^{commit}`], root, {
      env: GIT_ENV,
    }).stdout.trim();
    if (observed !== oid)
      throw new Error(`review diff ${label} SHAをexact commitへ解決できません`);
  }
  if (
    git(["merge-base", "--is-ancestor", baseSha, headSha], root, {
      env: GIT_ENV,
      allowFailure: true,
    }).status !== 0
  )
    throw new Error("review diff baseがcandidate HEADのancestorではありません");
  const source = git(
    [
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      baseSha,
      headSha,
      "--",
    ],
    root,
    { env: GIT_ENV },
  ).stdout;
  const names = git(
    ["diff", "--name-only", "-z", "--no-renames", baseSha, headSha, "--"],
    root,
    { env: GIT_ENV },
  )
    .stdout.split("\0")
    .filter(Boolean)
    .sort();
  if (new Set(names).size !== names.length)
    throw new Error("review diff path観測に重複があります");
  return {
    digest: crypto.createHash("sha256").update(source).digest("hex"),
    changedPaths: Object.freeze(names),
  };
}

function assertStoredStagingDigest(staging: string): void {
  const stored = readStoredStagingRecord(staging);
  const artifacts = listStagingArtifacts(staging);
  if (
    stableJson(stored.artifacts) !== stableJson(artifacts) ||
    stored.digest !== calculateStagingDigest(staging, artifacts)
  )
    throw new Error(
      "review session更新前のstaging成果物一覧またはdigestが一致しません",
    );
}

function assertRegularSessionFile(file: string): void {
  const stat = fs.lstatSync(file);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.nlink !== 1 ||
    stat.size > 2 * 1024 * 1024 ||
    fs.realpathSync(file) !== file
  )
    throw new Error(
      "review sessionはsymlink・hardlinkでない2MiB以下の通常fileが必要です",
    );
}

export function readStoredReviewSession(
  stagingInput: string,
): ReviewSessionState | null {
  const staging = assertWorkflowStaging(stagingInput);
  const file = path.join(staging, REVIEW_SESSION_FILE);
  if (!fs.existsSync(file)) return null;
  assertRegularSessionFile(file);
  return parseReviewSessionState(
    parseJsonStrict(fs.readFileSync(file, "utf8"), "review session"),
  );
}

export function previewReviewRound(input: {
  staging: string;
  round: ReviewRoundInput;
}): ReviewSessionState {
  const staging = assertWorkflowStaging(input.staging);
  assertStoredStagingDigest(staging);
  const previous = readStoredReviewSession(staging);
  const root = path.resolve(staging, "../../../..");
  const currentHeadSha = git(["rev-parse", "--verify", "HEAD^{commit}"], root, {
    env: GIT_ENV,
  }).stdout.trim();
  if (currentHeadSha !== input.round.candidateHeadSha)
    throw new Error(
      "review round candidate HEADがrepositoryのcurrent HEADと一致しません",
    );
  if (previous === null) {
    const observed = observeReviewDiff(
      root,
      input.round.anchor.diffBaseSha,
      input.round.anchor.initialHeadSha,
    );
    if (observed.digest !== input.round.anchor.initialDiffDigest)
      throw new Error(
        "review roundのinitial diff digestがGit観測値と一致しません",
      );
  } else {
    const fixed = observeReviewDiff(
      root,
      previous.latestCandidateHeadSha,
      input.round.candidateHeadSha,
    ).changedPaths;
    if (stableJson(fixed) !== stableJson(input.round.focus.fixedDiff))
      throw new Error(
        "review roundのfixedDiffが前roundからの実Git差分と一致しません",
      );
  }
  return advanceReviewSession(previous, input.round);
}

export function recordReviewRound(input: {
  staging: string;
  round: ReviewRoundInput;
}): ReviewSessionState {
  const staging = assertWorkflowStaging(input.staging);
  return withStagingMutationLock(staging, () => {
    const next = previewReviewRound({ staging, round: input.round });
    const file = path.join(staging, REVIEW_SESSION_FILE);
    writeFileAtomic(file, `${stableJson(next)}\n`, {
      temporaryDirectory: path.dirname(staging),
    });
    refreshStoredStagingDigest(staging);
    const reread = readStoredReviewSession(staging);
    if (reread === null || stableJson(reread) !== stableJson(next))
      throw new Error("review sessionの書き込み後read-backが一致しません");
    assertStoredStagingDigest(staging);
    return reread;
  });
}

export function assertConvergedReviewSession(input: {
  staging: string;
  expectedDigest: string;
  currentHeadSha: string;
}): ReviewSessionState {
  const staging = assertWorkflowStaging(input.staging);
  assertStoredStagingDigest(staging);
  const session = readStoredReviewSession(staging);
  if (session === null)
    throw new Error("Step 10には永続review sessionが必要です");
  if (session.status !== "converged")
    throw new Error(
      `review sessionが収束していません: status=${session.status}`,
    );
  if (session.latestRoundDigest !== input.expectedDigest)
    throw new Error(
      "Step 10のreview session digestが保存済みlatest roundと一致しません",
    );
  if (session.latestCandidateHeadSha !== input.currentHeadSha)
    throw new Error(
      "review sessionのcandidate HEADがcurrent HEADと一致しません",
    );
  return session;
}
