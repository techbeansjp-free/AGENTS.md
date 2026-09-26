import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createIssueStaging } from "../../src/domain/issue.js";
import { QUESTIONS, type ModeAnswer } from "../../src/domain/mode.js";
import {
  parseReviewRoundInput,
  type ReviewRoundInput,
} from "../../src/domain/review-convergence.js";
import {
  buildReviewRoundDraft,
  previewReviewRound,
} from "../../src/adapters/review-session.js";
import { STEP_JOURNAL_FILE } from "../../src/domain/workflow.js";
import { refreshStoredStagingDigest } from "../../src/domain/staging.js";
import { invokeDecision } from "../../src/adapters/decision-invoke.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface DecisionRefWorld extends WorkflowWorld {
  root: string;
  staging: string;
  round?: ReviewRoundInput;
}

const { Given, When, Then } = stepDefinitions<DecisionRefWorld>();

const reviewedPath = "src/domain/reviewed.ts";
const instant = new Date("2026-09-26T00:00:00.000Z");

function head(root: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function commitFile(
  root: string,
  relative: string,
  source: string,
  message: string,
): string {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
  execFileSync("git", ["add", relative], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: root });
  return head(root);
}

function answers(): Record<string, ModeAnswer> {
  return Object.fromEntries(
    QUESTIONS.map((id) => [id, { answer: true, evidence: `${id}の固定証拠` }]),
  );
}

function createFixture(world: DecisionRefWorld): {
  base: string;
  head: string;
} {
  const root = world.initRepo();
  world.root = root;
  const base = head(root);
  const candidateHead = commitFile(
    root,
    reviewedPath,
    "export const reviewed = 1;\n",
    "feat: initial candidate",
  );
  world.staging = createIssueStaging(root, {
    title: "decision-ref-verification",
    answers: answers(),
    now: instant,
    requestedMode: "quick",
  }).path;
  const journal = path.join(world.staging, STEP_JOURNAL_FILE);
  fs.appendFileSync(
    journal,
    `${JSON.stringify({
      step: 9,
      skillId: "step-09-implement",
      mode: "quick",
      recordedAt: instant.toISOString(),
      artifacts: [reviewedPath],
      evidence: `candidate HEAD ${candidateHead}`,
      implementationHeadSha: candidateHead,
    })}\n`,
  );
  refreshStoredStagingDigest(world.staging);
  return { base, head: candidateHead };
}

function draftRound(world: DecisionRefWorld, headSha: string, baseSha: string) {
  return buildReviewRoundDraft({
    staging: world.staging,
    headSha,
    baseSha,
    scopeIds: ["SCOPE-001"],
    acceptanceCriteriaIds: ["AC-001"],
  }).round;
}

Given(
  "DCAND-006で分類しdecisionRefを付けたfindingを持つround入力がある",
  function (this: DecisionRefWorld) {
    const { base, head: candidateHead } = createFixture(this);
    const invoked = invokeDecision({
      root: this.root,
      staging: this.staging,
      decisionTypeId: "DCAND-006",
      input: {
        candidateHeadSha: candidateHead,
        subjectRef: "F-01",
        payload: { path: reviewedPath, evidence: "file:1 反例" },
        proposedValue: "High",
        confirmedBy: "coordinator",
      },
      apply: true,
    });
    const draft = draftRound(this, candidateHead, base);
    this.round = parseReviewRoundInput({
      ...draft,
      findings: [
        {
          id: "F-01",
          severity: "High",
          status: "valid",
          source: "review",
          relation: "improvement",
          evidence: "file:1 反例",
          path: reviewedPath,
          contractId: null,
          causedByFindingId: null,
          decisionRef: invoked.decisionRecordId,
        },
      ],
    });
  },
);

Given(
  "存在しないdecisionRefを持つfindingがあるround入力がある",
  function (this: DecisionRefWorld) {
    const { base, head: candidateHead } = createFixture(this);
    const draft = draftRound(this, candidateHead, base);
    this.round = parseReviewRoundInput({
      ...draft,
      findings: [
        {
          id: "F-01",
          severity: "High",
          status: "valid",
          source: "review",
          relation: "improvement",
          evidence: "file:1 反例",
          path: reviewedPath,
          contractId: null,
          causedByFindingId: null,
          decisionRef: "DR-0000000000000000",
        },
      ],
    });
  },
);

Given(
  "別HEADで記録したdecisionRefを持つfindingがあるround入力がある",
  function (this: DecisionRefWorld) {
    const { base, head: firstHead } = createFixture(this);
    const invoked = invokeDecision({
      root: this.root,
      staging: this.staging,
      decisionTypeId: "DCAND-006",
      input: {
        candidateHeadSha: firstHead,
        subjectRef: "F-01",
        payload: { path: reviewedPath, evidence: "file:1 反例" },
        proposedValue: "High",
        confirmedBy: "coordinator",
      },
      apply: true,
    });
    const secondHead = commitFile(
      this.root,
      reviewedPath,
      "export const reviewed = 2;\n",
      "fix: follow-up",
    );
    const journal = path.join(this.staging, STEP_JOURNAL_FILE);
    fs.appendFileSync(
      journal,
      `${JSON.stringify({
        step: 9,
        skillId: "step-09-implement",
        mode: "quick",
        recordedAt: instant.toISOString(),
        artifacts: [reviewedPath],
        evidence: `candidate HEAD ${secondHead}`,
        implementationHeadSha: secondHead,
      })}\n`,
    );
    refreshStoredStagingDigest(this.staging);
    const draft = draftRound(this, secondHead, base);
    this.round = parseReviewRoundInput({
      ...draft,
      findings: [
        {
          id: "F-01",
          severity: "High",
          status: "valid",
          source: "review",
          relation: "improvement",
          evidence: "file:1 反例",
          path: reviewedPath,
          contractId: null,
          causedByFindingId: null,
          decisionRef: invoked.decisionRecordId,
        },
      ],
    });
  },
);

Given(
  "decisionRef記録後にevidenceを書き換えたfindingがあるround入力がある",
  function (this: DecisionRefWorld) {
    const { base, head: candidateHead } = createFixture(this);
    const invoked = invokeDecision({
      root: this.root,
      staging: this.staging,
      decisionTypeId: "DCAND-006",
      input: {
        candidateHeadSha: candidateHead,
        subjectRef: "F-01",
        payload: { path: reviewedPath, evidence: "file:1 反例" },
        proposedValue: "High",
        confirmedBy: "coordinator",
      },
      apply: true,
    });
    const draft = draftRound(this, candidateHead, base);
    this.round = parseReviewRoundInput({
      ...draft,
      findings: [
        {
          id: "F-01",
          severity: "High",
          status: "valid",
          source: "review",
          relation: "improvement",
          evidence: "file:1 書き換え後の反例",
          path: reviewedPath,
          contractId: null,
          causedByFindingId: null,
          decisionRef: invoked.decisionRecordId,
        },
      ],
    });
  },
);

When("previewReviewRoundを実行する", function (this: DecisionRefWorld) {
  this.error = undefined;
  if (this.round === undefined) throw new Error("roundが未設定です");
  try {
    this.value = previewReviewRound({
      staging: this.staging,
      round: this.round,
    });
  } catch (error) {
    this.error = error instanceof Error ? error : new Error(String(error));
  }
});

Then("roundが受理される", function (this: DecisionRefWorld) {
  assert.equal(this.error, undefined);
  assert.ok(this.value !== undefined);
});

Then("decisionRef欠落として拒否される", function (this: DecisionRefWorld) {
  assert.ok(this.error instanceof Error);
  assert.match(
    (this.error as Error).message,
    /見つかりません|decisionRef欠落/u,
  );
});

Then(
  "candidateHeadSha不一致として拒否される",
  function (this: DecisionRefWorld) {
    assert.ok(this.error instanceof Error);
    assert.match((this.error as Error).message, /candidateHeadSha.*不一致/u);
  },
);

Then("inputDigest不一致として拒否される", function (this: DecisionRefWorld) {
  assert.ok(this.error instanceof Error);
  assert.match((this.error as Error).message, /inputDigest.*不一致/u);
});
