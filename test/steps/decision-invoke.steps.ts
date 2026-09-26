import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  invokeDecision,
  type DecisionInvokeResult,
} from "../../src/adapters/decision-invoke.js";
import { findDecisionJournalRecord } from "../../src/adapters/decision-journal-store.js";
import { resolveGitWorkspace } from "../../src/adapters/review-workspace.js";
import {
  detectQuickDisqualifiers,
  QUESTIONS,
  type ModeAnswer,
} from "../../src/domain/mode.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface DecisionInvokeWorld extends WorkflowWorld {
  root: string;
  staging: string;
  headSha: string;
  decisionInput: unknown;
  decisionTypeId: string;
  result?: DecisionInvokeResult;
}

const { Given, When, Then } = stepDefinitions<DecisionInvokeWorld>();

function head(root: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function answers(): Record<string, ModeAnswer> {
  return Object.fromEntries(
    QUESTIONS.map((id) => [id, { answer: true, evidence: `${id}の固定証拠` }]),
  );
}

function createFixture(world: DecisionInvokeWorld, root: string): void {
  world.root = root;
  world.headSha = head(root);
  world.staging = createIssueStaging(root, {
    title: "decision-invoke-fixture",
    answers: answers(),
    now: new Date("2026-09-26T00:00:00.000Z"),
    requestedMode: "quick",
  }).path;
}

Given(
  "quick失格分類が検出されるchangedFilesを持つdecision invoke入力がある",
  function (this: DecisionInvokeWorld) {
    const root = this.initRepo();
    createFixture(this, root);
    this.decisionTypeId = "DCAND-001";
    this.decisionInput = {
      candidateHeadSha: this.headSha,
      subjectRef: "changed-files-fixture",
      payload: { changedFiles: ["package.json", "src/public-api/x.ts"] },
    };
  },
);

Given(
  "最新HEADにrate limit観測を持つDCAND-008入力がある",
  function (this: DecisionInvokeWorld) {
    const root = this.initRepo();
    createFixture(this, root);
    this.decisionTypeId = "DCAND-008";
    this.decisionInput = {
      candidateHeadSha: this.headSha,
      subjectRef: "PR#1485",
      payload: {
        latestHeadSha: this.headSha,
        observations: [
          {
            kind: "check-run",
            targetHeadSha: this.headSha,
            text: "CodeRabbit: rate limit exceeded for this repository",
            observedAt: "2026-09-26T00:00:00.000Z",
          },
        ],
      },
    };
  },
);

Given(
  "最新HEADの観測が無いDCAND-008入力がありproposedValueを渡す",
  function (this: DecisionInvokeWorld) {
    const root = this.initRepo();
    createFixture(this, root);
    this.decisionTypeId = "DCAND-008";
    this.decisionInput = {
      candidateHeadSha: this.headSha,
      subjectRef: "PR#1485",
      payload: { latestHeadSha: this.headSha, observations: [] },
      proposedValue: "unknown",
    };
  },
);

Given(
  "confirmedByを含むDCAND-006入力がある",
  function (this: DecisionInvokeWorld) {
    const root = this.initRepo();
    createFixture(this, root);
    this.decisionTypeId = "DCAND-006";
    this.decisionInput = {
      candidateHeadSha: this.headSha,
      subjectRef: "F-01",
      payload: { path: "src/example.ts", evidence: "file:12 反例" },
      proposedValue: "High",
      confirmedBy: "coordinator",
    };
  },
);

Given(
  "実HEADと異なるcandidateHeadShaを持つdecision invoke入力がある",
  function (this: DecisionInvokeWorld) {
    const root = this.initRepo();
    createFixture(this, root);
    this.decisionTypeId = "DCAND-001";
    this.decisionInput = {
      candidateHeadSha: "0".repeat(40),
      subjectRef: "mismatch-fixture",
      payload: { changedFiles: [] },
    };
  },
);

Given(
  "連結worktreeのstagingでDCAND-006入力がある",
  function (this: DecisionInvokeWorld) {
    const primary = this.initRepo();
    const linked = path.join(primary, ".worktrees", "linked");
    fs.mkdirSync(path.dirname(linked), { recursive: true });
    execFileSync(
      "git",
      ["worktree", "add", "-q", "-b", "linked", linked],
      { cwd: primary },
    );
    createFixture(this, linked);
    this.decisionTypeId = "DCAND-006";
    this.decisionInput = {
      candidateHeadSha: this.headSha,
      subjectRef: "F-02",
      payload: { path: "src/example2.ts", evidence: "file:34 反例" },
      proposedValue: "Medium",
      confirmedBy: "coordinator",
    };
  },
);

Given(
  "候補集合外の提案を持つDCAND-009入力がある",
  function (this: DecisionInvokeWorld) {
    const root = this.initRepo();
    createFixture(this, root);
    this.decisionTypeId = "DCAND-009";
    this.decisionInput = {
      candidateHeadSha: this.headSha,
      subjectRef: "reviewer-selection",
      payload: { candidateSet: ["codex-sol", "opus"] },
      proposedValue: "gemini",
    };
  },
);

When("invokeDecisionを実行する", function (this: DecisionInvokeWorld) {
  this.error = undefined;
  try {
    this.result = invokeDecision({
      root: this.root,
      staging: this.staging,
      decisionTypeId: this.decisionTypeId,
      input: this.decisionInput,
      apply: false,
    });
  } catch (error) {
    this.error = error instanceof Error ? error : new Error(String(error));
  }
});

When(
  "invokeDecisionをapplyつきで実行する",
  function (this: DecisionInvokeWorld) {
    this.result = invokeDecision({
      root: this.root,
      staging: this.staging,
      decisionTypeId: this.decisionTypeId,
      input: this.decisionInput,
      apply: true,
    });
  },
);

When(
  "連結worktreeでinvokeDecisionをapplyつきで実行する",
  function (this: DecisionInvokeWorld) {
    this.result = invokeDecision({
      root: this.root,
      staging: this.staging,
      decisionTypeId: this.decisionTypeId,
      input: this.decisionInput,
      apply: true,
    });
  },
);

Then(
  "resolverOutputはdetectQuickDisqualifiersの直接呼び出しと一致する",
  function (this: DecisionInvokeWorld) {
    const input = this.decisionInput as { payload: { changedFiles: string[] } };
    const direct = detectQuickDisqualifiers(input.payload.changedFiles);
    assert.deepEqual(this.result?.resolverOutput, direct);
    assert.ok(direct.length > 0, "fixtureは失格分類を含む必要があります");
  },
);

Then(
  "authorityModeはauthoritativeでeffectiveValueは{string}である",
  function (this: DecisionInvokeWorld, expected: string) {
    assert.equal(this.result?.authorityMode, "authoritative");
    assert.equal(this.result?.effectiveValue, expected);
  },
);

Then(
  "authorityModeはadvisoryでexecutorはproviderになる",
  function (this: DecisionInvokeWorld) {
    assert.equal(this.result?.authorityMode, "advisory");
    assert.equal(this.result?.executor.kind, "provider");
  },
);

Then(
  "primaryRootのdecision journalへ同じdecisionRecordIdの記録が読み返せる",
  function (this: DecisionInvokeWorld) {
    assert.ok(this.result?.applied);
    const decisionRecordId = this.result?.decisionRecordId;
    assert.ok(typeof decisionRecordId === "string" && decisionRecordId.length > 0);
    const primaryRoot = resolveGitWorkspace(this.root).primaryRoot;
    const record = findDecisionJournalRecord(
      primaryRoot,
      this.staging,
      decisionRecordId as string,
    );
    assert.ok(record !== undefined, "journalへ記録が見つかりません");
    assert.equal(record?.decisionRecordId, decisionRecordId);
    assert.equal(record?.effectiveValue, "High");
  },
);

Then("エラーで拒否される", function (this: DecisionInvokeWorld) {
  assert.ok(this.error instanceof Error);
});

Then(
  "journalは連結worktreeでなくprimaryRoot配下に作られる",
  function (this: DecisionInvokeWorld) {
    assert.ok(this.result?.applied);
    const primaryRoot = resolveGitWorkspace(this.root).primaryRoot;
    assert.notEqual(primaryRoot, this.root);
    const decisionRecordId = this.result?.decisionRecordId as string;
    const inPrimary = findDecisionJournalRecord(
      primaryRoot,
      this.staging,
      decisionRecordId,
    );
    assert.ok(inPrimary !== undefined);
    const inLinked = findDecisionJournalRecord(
      this.root,
      this.staging,
      decisionRecordId,
    );
    assert.equal(inLinked, undefined);
  },
);

Then("rejectedである", function (this: DecisionInvokeWorld) {
  assert.equal(this.result?.rejected, true);
});
