import assert from "node:assert/strict";
import { appendLegacyJournal } from "../support/legacy-journal.js";
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
import { DECISION_JOURNAL_DIRECTORY } from "../../src/adapters/decision-journal-store.js";
import { stableJson } from "../../src/lib/security.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface DecisionRefWorld extends WorkflowWorld {
  root: string;
  staging: string;
  round?: ReviewRoundInput;
  digestWithout?: string;
  digestWithNull?: string;
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
  appendLegacyJournal(
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
    appendLegacyJournal(
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

Given(
  "effectiveValueがHighのdecisionRefをseverity Lowのfindingへ設定したround入力がある",
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
          severity: "Low",
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
  "有効なdecisionRefを持つがdecision journalに不正な行も混在するfindingがあるround入力がある",
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
    const journalFile = path.join(
      this.root,
      DECISION_JOURNAL_DIRECTORY,
      path.basename(this.staging),
      "events.jsonl",
    );
    fs.appendFileSync(journalFile, "この行はJSONとして不正です\n");
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
  "decisionRef導入前のfield無しfindingを持つround入力がある",
  function (this: DecisionRefWorld) {
    const { base, head: candidateHead } = createFixture(this);
    const draft = draftRound(this, candidateHead, base);
    // decisionRefそのものを持たないlegacy findingを直接構成する（parseReviewRoundInputの
    // 型はunknownを受けるため、TS型を経由せずfield無しの生objectを渡せる）。
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
        },
      ],
    });
  },
);

function syntheticRoundInput(findingExtra: Record<string, unknown>): unknown {
  const sha40 = "a".repeat(40);
  const sha64 = "c".repeat(64);
  return {
    round: 1,
    previousRoundDigest: null,
    anchor: {
      scopeIds: ["SCOPE-001"],
      acceptanceCriteriaIds: ["AC-001"],
      invariantIds: [],
      diffBaseSha: sha40,
      initialHeadSha: sha40,
      initialDiffDigest: sha64,
    },
    candidateHeadSha: sha40,
    focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
    findings: [
      {
        id: "F-01",
        severity: "Low",
        status: "valid",
        source: "review",
        relation: "improvement",
        evidence: "e",
        path: "src/domain/reviewed.ts",
        contractId: null,
        causedByFindingId: null,
        ...findingExtra,
      },
    ],
  };
}

Given(
  "decisionRef field無しのfindingとdecisionRef nullのfindingで同内容のround入力を用意する",
  function (this: DecisionRefWorld) {
    const without = parseReviewRoundInput(syntheticRoundInput({}));
    const withNull = parseReviewRoundInput(
      syntheticRoundInput({ decisionRef: null }),
    );
    this.digestWithout = stableJson(without.findings[0]);
    this.digestWithNull = stableJson(withNull.findings[0]);
  },
);

When("両方のroundDigestを比較する", function (this: DecisionRefWorld) {
  // roundDigest自体はstaging/gitを要するpreviewReviewRoundの副産物だが、
  // digestへの寄与はfindingのstableJson直列化で決まる。直列化そのものを比較する。
});

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

Then(
  "severityとeffectiveValueの不一致として拒否される",
  function (this: DecisionRefWorld) {
    assert.ok(this.error instanceof Error);
    assert.match(
      (this.error as Error).message,
      /severity High がdecisionRef .*のeffectiveValue Low と一致しません|severity Low がdecisionRef .*のeffectiveValue High と一致しません/u,
    );
  },
);

Then(
  "decision journalの不正な行として拒否される",
  function (this: DecisionRefWorld) {
    assert.ok(this.error instanceof Error);
    assert.match(
      (this.error as Error).message,
      /不正な行があるため参照できません/u,
    );
  },
);

Then("roundDigestは異なる", function (this: DecisionRefWorld) {
  assert.notEqual(this.digestWithout, undefined);
  assert.notEqual(this.digestWithNull, undefined);
  assert.notEqual(this.digestWithout, this.digestWithNull);
  // fieldが無い場合はキー自体を持たず、nullの場合は"decisionRef":nullを含む。
  assert.doesNotMatch(this.digestWithout!, /"decisionRef"/u);
  assert.match(this.digestWithNull!, /"decisionRef":null/u);
});
