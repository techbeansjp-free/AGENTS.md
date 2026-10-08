import assert from "node:assert/strict";
import {
  appendLegacyJournal,
  unchainedJournalText,
} from "../support/legacy-journal.js";
import { ensureImplementationCommit } from "../support/implementation-commit.js";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  WorkflowWorld,
  conformingPullRequestBody,
  stepDefinitions,
} from "../support/world.js";
import {
  fixtureInstant,
  fixtureInstantMs,
} from "../support/fixture-instant.js";
import {
  MODE_STEP_SEQUENCES,
  MODE_DECISION_FILE,
  NEVER_SKIPPABLE_STEPS,
  STEP_JOURNAL_BASENAME,
  STEP_JOURNAL_FILE,
  WORKFLOW_JOURNAL_DIRECTORY,
  completePullRequestWorkflow,
  inspectWorkflowStagingArtifacts,
  parseModeDecision,
  planWorkflowAdvance,
  parseStepJournal,
  renderModeDecision,
  skippableSteps,
  validateJournalHumanOverride,
  validateStepJournal,
  WORKFLOW_STEPS,
  type JournalHumanOverride,
  type StepJournalEntry,
} from "../../src/domain/workflow.js";
import {
  QUESTIONS,
  type Mode,
  type ModeAnswer,
  type PocDeclaration,
} from "../../src/domain/mode.js";
import { stableJson } from "../../src/lib/security.js";
import {
  createIssueStaging,
  recordStagingSync,
} from "../../src/domain/issue.js";
import {
  appendDeliveryTerminalJournalEntry,
  appendWorkflowJournalEntry,
  inspectPendingJournalTransaction,
  inspectWorkflowStaging,
  promoteWorkflowStagingToFull,
  resolvePullRequestStaging,
  recoverPendingJournalTransaction,
  executePocObservation,
} from "../../src/adapters/workflow-journal.js";
import {
  calculateStagingDigest,
  listStagingArtifacts,
  readStoredStagingRecord,
  refreshStoredStagingDigest,
  STAGING_RECORD_FILE,
} from "../../src/domain/staging.js";
import type { ImplementationDiscovery } from "../../src/domain/agile-verification.js";
import {
  DELIVERY_STATE_FILE,
  canonicalDigest,
  closingContractDigest,
  externalMergeObservationId,
  parseDeliveryState,
  pullRequestContentDigest,
  renderDeliveryState,
  type DeliveryState,
} from "../../src/domain/delivery-state.js";
import { splitPullRequestDocument } from "../../src/domain/delivery.js";
import {
  bindStoredPullRequest,
  claimStoredMergeDispatch,
  claimStoredPullRequestCreationDispatch,
  prepareStoredMergeIntent,
  prepareStoredPullRequestCreation,
} from "../../src/adapters/delivery-state.js";
import { doctor } from "../../src/domain/lifecycle.js";
import { checkWorkflowStepDocument } from "../../scripts/check_conformance.js";
import { checkWorkflowSteps } from "../../scripts/check_workflow_steps.js";
import { composeWorkflowAdvanceIssueBody, main } from "../../src/cli.js";
import {
  buildReviewRoundDraft,
  observeReviewDiff,
  recordReviewRound,
} from "../../src/adapters/review-session.js";
import {
  advanceReviewSession,
  parseReviewRoundInput,
} from "../../src/domain/review-convergence.js";
import {
  parseReviewEvidence,
  renderReviewEvidence,
  type ReviewEvidence,
} from "../../src/domain/review-evidence.js";
import { PLAN_AMENDMENT_FILE } from "../../src/domain/plan-seal.js";
import { readStoredReviewSession } from "../../src/adapters/review-session-store.js";
import {
  appendFixtureVerificationRecords,
  observeFixtureVerification,
  reviewEvidenceContentFromStaging,
  reviewEvidenceFromSession,
  resealObservedEvidence,
} from "../support/review-evidence-fixture.js";
import {
  TRUSTED_POLICY_PATHS,
  writeTrustedPolicySet,
} from "../support/trusted-verification-policy.js";

interface WorkflowStepWorld extends WorkflowWorld {
  workflowCheckPassed: boolean;
}

const { Given, When, Then } = stepDefinitions<WorkflowStepWorld>();

const instant = "2026-08-25T12:00:00.000Z";
const later = "2026-08-25T13:00:00.000Z";

const overrideNow = "2026-08-25T12:00:00.000Z";

function humanOverride(
  overrides: Partial<JournalHumanOverride> = {},
): JournalHumanOverride {
  return {
    issue: 877,
    scope: "workflow.pr.create",
    instructedBy: "repository-owner",
    instructedAt: "2026-08-25T11:00:00.000Z",
    expiresAt: "2026-08-25T13:00:00.000Z",
    reason: "欠落stepを明示承認する",
    ...overrides,
  };
}

function answers(
  answer: boolean | "unknown" = true,
): Record<string, ModeAnswer> {
  return Object.fromEntries(
    QUESTIONS.map((id) => [id, { answer, evidence: `${id}の確認根拠` }]),
  );
}

function entry(
  step: number,
  mode: Mode = "quick",
  recordedAt = instant,
): StepJournalEntry {
  const definition = WORKFLOW_STEPS.find((item) => item.step === step);
  if (!definition) throw new Error(`step ${step}がありません`);
  return {
    step,
    skillId: definition.skillId,
    mode,
    recordedAt,
    artifacts: [`artifact-${step}`],
    evidence: `step ${step}の証拠`,
    ...(step === 10
      ? {
          reviewSession: {
            sessionId: "a".repeat(64),
            roundDigest: "b".repeat(64),
            headSha: "c".repeat(40),
          },
        }
      : {}),
  };
}

function result(mode: Mode, entries: StepJournalEntry[], upToStep: number) {
  return validateStepJournal({ mode, entries, upToStep });
}

function validPoc(): PocDeclaration {
  return {
    purpose: "依存変更を伴う仮説を検証する",
    fixture: {
      id: "FIX-DEPENDENCY",
      root: "test/fixtures/poc/dependency",
      isolationEvidence: "一時directoryと模擬dataだけを使用する",
      resetEvidence: "fixture snapshotのdigestを再確認する",
      runner: {
        id: "RUN-DEPENDENCY",
        path: "runner.mjs",
      },
    },
    useCases: [
      { id: "UC-DEPENDENCY", actor: "maintainer", goal: "分類を再現する" },
    ],
    scenarios: [
      {
        id: "SCN-DEPENDENCY",
        useCaseId: "UC-DEPENDENCY",
        given: "隔離fixtureが初期化済み",
        when: "定義済みrunnerを実行する",
        then: "分類結果を構造化出力する",
        argv: [],
      },
    ],
    observables: [
      {
        id: "OBS-DEPENDENCY-EXIT",
        scenarioId: "SCN-DEPENDENCY",
        kind: "exit-code",
        expected: 0,
      },
      {
        id: "OBS-DEPENDENCY-STDOUT",
        scenarioId: "SCN-DEPENDENCY",
        kind: "stdout-digest",
        expected: crypto
          .createHash("sha256")
          .update('{"classification":"full"}\n')
          .digest("hex"),
      },
    ],
    outOfScope: "本番提供",
    successCriteria: "分類結果を再現できる",
    abortCriteria: "再現できない",
    owner: "repository-owner",
    highRisk: [
      "public-api",
      "personal-data",
      "confidential-data",
      "external-exposure",
      "irreversible-operation",
    ].map((id) => ({ id, present: false, evidence: `${id}は対象外` })),
  };
}

function materializeValidPocFixture(
  root: string,
  declaration: PocDeclaration,
): void {
  const fixture = path.join(root, declaration.fixture.root);
  fs.mkdirSync(fixture, { recursive: true });
  const runner = path.join(fixture, declaration.fixture.runner.path);
  fs.writeFileSync(
    runner,
    'process.stdout.write(\'{"classification":"full"}\\n\');\n',
    { mode: 0o600 },
  );
}

function quickPromotionDiscovery(): ImplementationDiscovery {
  return {
    discoveryId: "DISC-PROMOTION-001",
    workflowMode: "quick",
    modeDisqualifiers: [
      {
        id: "security-boundary",
        evidence: "実装中に認可境界の拡大を観測した",
      },
    ],
    changedContractKinds: ["interface"],
    changesGoal: false,
    changesScope: false,
    changesAcceptanceCriteria: false,
    expandsSecurityBoundary: true,
    introducesIrreversibleOperation: false,
  };
}

function failedPullRequestWorkflow() {
  return completePullRequestWorkflow(
    {
      state: "waiting_for_human_review",
      url: "https://github.com/o/r/pull/906",
      next: "独立したpr mergeコマンドを使う",
    },
    "/repo/.agent-skill-chain/tmp/issues/issue-906",
    () => {
      throw new Error("journal digest mismatch");
    },
  );
}

function failedMergeWorkflow() {
  return completePullRequestWorkflow(
    {
      state: "merge-queued",
      url: "https://github.com/o/r/pull/906",
    },
    "/repo/.agent-skill-chain/tmp/issues/issue-906",
    () => {
      throw new Error("journal digest mismatch");
    },
    {
      operation: "merge要求",
      repeatAction: "pr merge",
      recoveryEvidence: "merge要求済み状態の確認",
    },
  );
}

Given("ワークフローStep単体検査の準備がある", function () {
  this.workflowCheckPassed = false;
});

When("{string}の単体検査を実行する", async function (scenarioId: string) {
  switch (scenarioId) {
    case "SCN-UNIT-WFSTEP-001":
      assert.deepEqual(
        MODE_STEP_SEQUENCES.full,
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      );
      break;
    case "SCN-UNIT-WFSTEP-002":
      assert.deepEqual(MODE_STEP_SEQUENCES.quick, [0, 1, 4, 9, 10, 11]);
      break;
    case "SCN-UNIT-WFSTEP-003":
      assert.deepEqual(MODE_STEP_SEQUENCES.poc, MODE_STEP_SEQUENCES.quick);
      break;
    case "SCN-UNIT-WFSTEP-004":
      assert.deepEqual(skippableSteps("quick"), [2, 3, 5, 6, 7, 8]);
      break;
    case "SCN-UNIT-WFSTEP-005":
      for (const mode of ["full", "quick", "poc"] as const)
        assert.equal(skippableSteps(mode).includes(4), false);
      assert.ok(NEVER_SKIPPABLE_STEPS.includes(4));
      break;
    case "SCN-UNIT-WFSTEP-006":
      for (const mode of ["full", "quick", "poc"] as const)
        assert.equal(skippableSteps(mode).includes(11), false);
      assert.ok(NEVER_SKIPPABLE_STEPS.includes(11));
      break;
    case "SCN-UNIT-WFSTEP-007": {
      const root = this.temp("asc-workflow-empty-step-");
      const document = path.join(root, "workflow.md");
      const markdown = fs
        .readFileSync(".agent-skill-chain/docs/01_開発ワークフロー.md", "utf8")
        .replace("0 → 1 → 4 → 9 → 10 → 11", "0 → 1 →  → 9 → 10 → 11");
      fs.writeFileSync(document, markdown);
      const checked = checkWorkflowSteps(process.cwd(), document);
      assert.equal(checked.valid, false);
      assert.match(checked.errors.join("\n"), /空のStep番号/u);
      break;
    }
    case "SCN-UNIT-PRJRNL-001": {
      const checked = failedPullRequestWorkflow();
      assert.equal(
        (checked.output as { url?: string }).url,
        "https://github.com/o/r/pull/906",
      );
      break;
    }
    case "SCN-UNIT-PRJRNL-002": {
      const checked = failedPullRequestWorkflow();
      assert.match(JSON.stringify(checked.output), /記録に失敗/u);
      assert.match(JSON.stringify(checked.output), /外部のPR作成は再送せず/u);
      assert.match(JSON.stringify(checked.output), /delivery専用コマンド/u);
      assert.doesNotMatch(JSON.stringify(checked.output), /workflow record/u);
      break;
    }
    case "SCN-UNIT-PRJRNL-003":
      assert.equal(failedPullRequestWorkflow().exitCode, 1);
      break;
    case "SCN-UNIT-PRJRNL-004": {
      const created = {
        state: "waiting_for_human_review" as const,
        url: "https://github.com/o/r/pull/906",
        next: "独立したpr mergeコマンドを使う",
      };
      const recorded = {
        entry: entry(11),
        journalDigest: "a".repeat(64),
        stagingDigest: "b".repeat(64),
      };
      const checked = completePullRequestWorkflow(
        created,
        "/repo/.agent-skill-chain/tmp/issues/issue-906",
        () => recorded,
      );
      assert.equal(checked.exitCode, 0);
      assert.deepEqual(checked.output, { ...created, workflow: recorded });
      break;
    }
    case "SCN-UNIT-PRJRNL-005": {
      const checked = failedMergeWorkflow();
      assert.equal(checked.exitCode, 1);
      assert.match(JSON.stringify(checked.output), /merge要求後/u);
      assert.match(JSON.stringify(checked.output), /外部のpr mergeは再送せず/u);
      assert.match(JSON.stringify(checked.output), /delivery専用コマンド/u);
      assert.doesNotMatch(JSON.stringify(checked.output), /workflow record/u);
      assert.match(
        JSON.stringify(checked.output),
        /https:\/\/github\.com\/o\/r\/pull\/906/u,
      );
      break;
    }
    case "SCN-UNIT-PRJRNL-006": {
      const root = this.temp("asc-pr-staging-binding-");
      const staging = createIssueStaging(root, {
        title: "pr-staging-binding",
        answers: answers(),
        now: new Date(fixtureInstantMs()),
        requestedMode: "quick",
      }).path;
      for (const step of [1, 4])
        appendWorkflowJournalEntry({
          staging,
          entry: entry(step, "quick", fixtureInstant({ hoursAgo: 1 })),
        });
      recordStagingSync(staging, {
        tracker: "https://github.com/o/r/issues/877",
        checkpoint: 4,
        syncedAt: fixtureInstant(),
        bodyDigest: "a".repeat(64),
        readBackDigest: "a".repeat(64),
      });
      assert.throws(
        () =>
          resolvePullRequestStaging({
            root,
            staging,
            issue: 878,
            repository: "o/r",
          }),
        /tracker.*repository・Issue.*一致しません/u,
      );
      assert.throws(
        () =>
          resolvePullRequestStaging({
            root,
            staging,
            issue: 877,
            repository: "other/repository",
          }),
        /tracker.*repository・Issue.*一致しません/u,
      );
      break;
    }
    case "SCN-UNIT-PRJRNL-007": {
      const root = this.temp("asc-pr-staging-root-");
      const otherRoot = this.temp("asc-pr-staging-other-root-");
      const otherStaging = createIssueStaging(otherRoot, {
        title: "pr-staging-root-binding",
        answers: answers(),
        now: new Date(fixtureInstantMs()),
        requestedMode: "quick",
      }).path;
      recordStagingSync(otherStaging, {
        tracker: "https://github.com/o/r/issues/877",
        checkpoint: 4,
        syncedAt: fixtureInstant(),
        bodyDigest: "a".repeat(64),
        readBackDigest: "a".repeat(64),
      });
      assert.equal(
        resolvePullRequestStaging({
          root: otherRoot,
          staging: otherStaging,
          issue: 877,
          repository: "o/r",
        }),
        otherStaging,
      );
      assert.throws(
        () =>
          resolvePullRequestStaging({
            root,
            staging: otherStaging,
            issue: 877,
            repository: "o/r",
          }),
        /対象root.*\.agent-skill-chain\/tmp\/issues\/直下/u,
      );

      const aliasParent = path.join(root, ".agent-skill-chain", "tmp");
      fs.mkdirSync(aliasParent, { recursive: true });
      fs.symlinkSync(
        path.join(otherRoot, ".agent-skill-chain", "tmp", "issues"),
        path.join(aliasParent, "issues"),
        "dir",
      );
      const aliasedStaging = path.join(
        aliasParent,
        "issues",
        path.basename(otherStaging),
      );
      assert.throws(
        () =>
          resolvePullRequestStaging({
            root,
            staging: aliasedStaging,
            issue: 877,
            repository: "o/r",
          }),
        /symlink祖先/u,
      );
      break;
    }
    case "SCN-UNIT-WFPATH-001": {
      assert.equal(MODE_DECISION_FILE, "00_モード判定.json");
      assert.equal(WORKFLOW_JOURNAL_DIRECTORY, "journal");
      assert.equal(STEP_JOURNAL_BASENAME, "steps.jsonl");
      assert.equal(STEP_JOURNAL_FILE, "journal/steps.jsonl");
      for (const file of [
        "src/domain/lifecycle.ts",
        "src/domain/issue.ts",
        "src/adapters/workflow-journal.ts",
      ]) {
        const source = fs.readFileSync(file, "utf8");
        assert.doesNotMatch(source, /["`]00_モード判定\.json["`]/u);
        assert.doesNotMatch(source, /["`]journal["`]/u);
        assert.doesNotMatch(source, /["`]steps\.jsonl["`]/u);
      }
      break;
    }
    case "SCN-UNIT-WFPATH-002": {
      const root = this.temp("asc-workflow-inspection-");
      const staging = createQuickStaging(root);
      const record = readStoredStagingRecord(staging);
      const direct = inspectWorkflowStagingArtifacts({
        staging,
        mode: record.mode,
        state: record.state,
        modeDecisionSource: fs.readFileSync(
          path.join(staging, MODE_DECISION_FILE),
          "utf8",
        ),
        journalSource: fs.readFileSync(
          path.join(staging, STEP_JOURNAL_FILE),
          "utf8",
        ),
      });
      assert.deepEqual(inspectWorkflowStaging(staging), direct);
      break;
    }
    case "SCN-UNIT-WFPATH-003":
    case "SCN-UNIT-WFPATH-004":
    case "SCN-UNIT-WFPATH-005": {
      /**
       * **契約を満たしたまま止まっているstagingだけをinterruptedにする**
       *（Issue #954）。`valid: false`には「契約を満たさない古い記録」と
       * 「単に途中で止まっている」が混ざる。実測では未完28件のうち手を入れる
       * べきは9件で、残りはmerge済みだった。**混ぜると選べない。**
       */
      const root = this.temp("asc-workflow-interrupted-");
      const staging = createQuickStaging(root);
      const record = readStoredStagingRecord(staging);
      const steps =
        scenarioId === "SCN-UNIT-WFPATH-003"
          ? [0, 1, 4]
          : scenarioId === "SCN-UNIT-WFPATH-004"
            ? [0, 1, 9, 10]
            : [0, 1, 4, 9, 10, 11];
      const inspected = inspectWorkflowStagingArtifacts({
        staging,
        mode: record.mode,
        state: record.state,
        modeDecisionSource: fs.readFileSync(
          path.join(staging, MODE_DECISION_FILE),
          "utf8",
        ),
        journalSource: `${steps
          .map((step) => JSON.stringify(entry(step)))
          .join("\n")}\n`,
      });
      if (scenarioId === "SCN-UNIT-WFPATH-003") {
        assert.equal(inspected.valid, true);
        assert.equal(inspected.nextStep, 9);
        assert.equal(inspected.interrupted, true);
      } else if (scenarioId === "SCN-UNIT-WFPATH-004") {
        /** Step 4を欠いた記録は契約違反であり、interruptedへ入れない。 */
        assert.equal(inspected.valid, false);
        assert.equal(inspected.interrupted, false);
      } else {
        assert.equal(inspected.valid, true);
        assert.equal(inspected.nextStep, undefined);
        assert.equal(inspected.interrupted, false);
      }
      break;
    }
    case "SCN-UNIT-WFJRNL-001":
      assert.equal(
        result(
          "quick",
          [0, 1, 4, 9, 10].map((step) => entry(step)),
          10,
        ).valid,
        true,
      );
      break;
    case "SCN-UNIT-WFJRNL-002": {
      const checked = result(
        "quick",
        [0, 1, 9, 10].map((step) => entry(step)),
        10,
      );
      assert.deepEqual(checked.missingSteps, [4]);
      break;
    }
    case "SCN-UNIT-WFJRNL-003": {
      const checked = result(
        "full",
        [entry(0, "full"), entry(1, "full"), entry(3, "full")],
        3,
      );
      assert.deepEqual(checked.missingSteps, [2]);
      break;
    }
    case "SCN-UNIT-WFJRNL-004": {
      const checked = result(
        "quick",
        [entry(0), entry(1), entry(4), entry(5)],
        4,
      );
      assert.deepEqual(checked.unexpectedSteps, [5]);
      break;
    }
    case "SCN-UNIT-WFJRNL-005": {
      const checked = result("quick", [entry(0), entry(4), entry(1)], 4);
      assert.deepEqual(checked.outOfOrder, [4]);
      break;
    }
    case "SCN-UNIT-WFJRNL-006":
      assert.equal(
        result("quick", [entry(0), entry(0), entry(1)], 1).valid,
        true,
      );
      break;
    case "SCN-UNIT-WFJRNL-007":
      assert.equal(
        result("full", [entry(0), entry(1), entry(2, "full")], 2).valid,
        true,
      );
      break;
    case "SCN-UNIT-WFJRNL-008": {
      const checked = result("quick", [entry(0, "full"), entry(1)], 1);
      assert.ok(
        checked.modeConflicts.some((message) =>
          message.includes("fullからquick"),
        ),
      );
      break;
    }
    case "SCN-UNIT-WFJRNL-009": {
      const checked = result("poc", [entry(0), entry(1, "poc")], 1);
      assert.ok(
        checked.modeConflicts.some((message) =>
          message.includes("quickからpoc"),
        ),
      );
      break;
    }
    case "SCN-UNIT-WFJRNL-010": {
      const parsed = parseStepJournal(
        `${JSON.stringify({ ...entry(0), unknown: true })}\n`,
      );
      assert.equal(parsed.entries.length, 0);
      assert.match(parsed.errors.join("\n"), /未知field/u);
      break;
    }
    case "SCN-UNIT-WFJRNL-011": {
      const parsed = parseStepJournal(
        `${JSON.stringify(entry(0))}\n{broken\n${JSON.stringify(entry(1))}\n`,
      );
      assert.equal(parsed.entries.length, 2);
      assert.ok(parsed.errors.length > 0);
      break;
    }
    case "SCN-UNIT-WFJRNL-012":
      assert.equal(
        result(
          "quick",
          [entry(0, "quick", later), entry(1, "quick", instant)],
          1,
        ).valid,
        true,
      );
      break;
    case "SCN-UNIT-WFJRNL-013": {
      const parsed = parseStepJournal(
        `${JSON.stringify({ ...entry(0), artifacts: [] })}\n`,
      );
      assert.match(parsed.errors.join("\n"), /artifacts/u);
      break;
    }
    case "SCN-UNIT-WFJRNL-014": {
      const checked = result(
        "full",
        [entry(0), entry(1), entry(4), entry(9), entry(2, "full")],
        2,
      );
      assert.equal(checked.valid, true);
      assert.deepEqual(checked.outOfOrder, []);
      break;
    }
    case "SCN-UNIT-WFJRNL-015": {
      const checked = result(
        "full",
        [
          entry(0, "full"),
          entry(1, "full"),
          entry(4, "full"),
          entry(9, "full"),
          entry(2, "full"),
        ],
        2,
      );
      assert.equal(checked.valid, false);
      assert.deepEqual(checked.outOfOrder, [4, 9]);
      break;
    }
    case "SCN-UNIT-WFJRNL-016": {
      const modeDecisionSource = renderModeDecision({
        requestedMode: "full",
        currentMode: "full",
        answers: answers(),
        decidedAt: instant,
      });
      const journalSource = [
        entry(0),
        entry(1),
        entry(4),
        entry(9),
        entry(2, "full"),
        entry(3, "full"),
      ]
        .map((item) => JSON.stringify(item))
        .join("\n");
      const checked = inspectWorkflowStagingArtifacts({
        staging: "/repo/.agent-skill-chain/tmp/issues/promoted",
        mode: "full",
        state: "promotion-active",
        modeDecisionSource,
        journalSource: `${journalSource}\n`,
        upToStep: 3,
      });
      assert.deepEqual(checked.completedSteps, [0, 1, 2, 3]);
      assert.equal(checked.currentStep, 3);
      assert.equal(checked.nextStep, 4);
      assert.equal(checked.validation.valid, true);
      const throughStepEight = inspectWorkflowStagingArtifacts({
        staging: "/repo/.agent-skill-chain/tmp/issues/promoted",
        mode: "full",
        state: "promotion-active",
        modeDecisionSource,
        journalSource: `${[
          journalSource,
          ...[4, 5, 6, 7, 8].map((step) => JSON.stringify(entry(step, "full"))),
        ].join("\n")}\n`,
        upToStep: 8,
      });
      assert.deepEqual(
        throughStepEight.completedSteps,
        [0, 1, 2, 3, 4, 5, 6, 7, 8],
      );
      assert.equal(throughStepEight.currentStep, 8);
      assert.equal(throughStepEight.nextStep, 9);
      assert.equal(throughStepEight.validation.valid, true);
      break;
    }
    case "SCN-UNIT-WFJRNL-017": {
      const root = this.temp("asc-journal-atomic-");
      const staging = createIssueStaging(root, {
        title: "journal-atomic",
        answers: answers(),
        now: new Date(fixtureInstantMs()),
        requestedMode: "quick",
      }).path;
      const journal = path.join(staging, STEP_JOURNAL_FILE);
      const before = fs.readFileSync(journal);
      const interruptedTemporary = path.join(
        path.dirname(staging),
        `.workflow-journal-${path.basename(staging)}-999-interrupted.tmp`,
      );
      fs.writeFileSync(interruptedTemporary, '{"partial":');

      appendWorkflowJournalEntry({ staging, entry: entry(1) });

      const after = fs.readFileSync(journal);
      assert.deepEqual(after.subarray(0, before.length), before);
      const parsed = parseStepJournal(after.toString("utf8"));
      assert.deepEqual(parsed.errors, []);
      assert.deepEqual(
        parsed.entries.map((item) => item.step),
        [0, 1],
      );
      assert.equal(
        listStagingArtifacts(staging).includes(interruptedTemporary),
        false,
      );
      assert.equal(
        fs.readFileSync(interruptedTemporary, "utf8"),
        '{"partial":',
      );
      break;
    }
    case "SCN-UNIT-WFJRNL-018": {
      for (const digestAlreadyRefreshed of [false, true]) {
        const root = this.temp("asc-journal-recovery-");
        const staging = createIssueStaging(root, {
          title: `journal-recovery-${String(digestAlreadyRefreshed)}`,
          answers: answers(),
          now: new Date(fixtureInstantMs()),
          requestedMode: "quick",
        }).path;
        const journal = path.join(staging, STEP_JOURNAL_FILE);
        const beforeSource = fs.readFileSync(journal, "utf8");
        /** CLIが公開する行と同じく、先行するjournal本文のhash chainを持たせる */
        const proposedSource = `${beforeSource}${JSON.stringify({
          ...entry(1),
          previousEntryDigest: crypto
            .createHash("sha256")
            .update(beforeSource)
            .digest("hex"),
        })}\n`;
        const stored = readStoredStagingRecord(staging);
        const otherArtifacts = stored.artifacts.filter(
          (artifact) => artifact !== STEP_JOURNAL_FILE,
        );
        const transaction = path.join(
          path.dirname(staging),
          `.${path.basename(staging)}.workflow-journal-transaction.json`,
        );
        fs.writeFileSync(
          transaction,
          `${stableJson({
            schemaVersion: "agent-skill-chain/workflow-journal-transaction/v1",
            journalBeforeDigest: crypto
              .createHash("sha256")
              .update(beforeSource)
              .digest("hex"),
            journalAfterDigest: crypto
              .createHash("sha256")
              .update(proposedSource)
              .digest("hex"),
            stagingDigestBefore: stored.digest,
            artifacts: stored.artifacts,
            otherArtifactsDigest: calculateStagingDigest(
              staging,
              otherArtifacts,
            ),
          })}\n`,
          { mode: 0o600 },
        );
        fs.writeFileSync(journal, proposedSource);
        if (digestAlreadyRefreshed) refreshStoredStagingDigest(staging);

        assert.equal(
          inspectPendingJournalTransaction(staging)?.state,
          "published",
        );
        assert.equal(
          readStoredStagingRecord(staging).digest ===
            calculateStagingDigest(staging, listStagingArtifacts(staging)),
          digestAlreadyRefreshed,
        );
        assert.equal(recoverPendingJournalTransaction(staging), true);
        assert.equal(fs.existsSync(transaction), false);
        assert.equal(recoverPendingJournalTransaction(staging), false);
        assert.equal(
          readStoredStagingRecord(staging).digest,
          calculateStagingDigest(staging, listStagingArtifacts(staging)),
        );
        assert.deepEqual(
          parseStepJournal(fs.readFileSync(journal, "utf8")).errors,
          [],
        );
      }
      break;
    }
    case "SCN-UNIT-WFJRNL-019": {
      const root = this.temp("asc-journal-staging-observation-");
      const staging = createIssueStaging(root, {
        title: "journal-staging-observation",
        answers: answers(),
        now: new Date(fixtureInstantMs()),
        requestedMode: "quick",
      }).path;
      const journal = path.join(staging, STEP_JOURNAL_FILE);
      const before = parseStepJournal(fs.readFileSync(journal, "utf8"));
      fs.appendFileSync(path.join(staging, "00_要求定義.md"), "\n追記内容\n");

      const appended = appendWorkflowJournalEntry({
        staging,
        entry: entry(1),
      });

      const after = parseStepJournal(fs.readFileSync(journal, "utf8"));
      assert.equal(after.entries.length, before.entries.length + 1);
      const stored = readStoredStagingRecord(staging);
      const artifacts = listStagingArtifacts(staging);
      assert.deepEqual(stored.artifacts, artifacts);
      assert.equal(stored.digest, calculateStagingDigest(staging, artifacts));
      assert.equal(appended.stagingDigest, stored.digest);
      break;
    }
    case "SCN-UNIT-WFJRNL-020": {
      const root = this.temp("asc-journal-unrecoverable-");
      const staging = createIssueStaging(root, {
        title: "journal-unrecoverable",
        answers: answers(),
        now: new Date(fixtureInstantMs()),
        requestedMode: "quick",
      }).path;
      const journal = path.join(staging, STEP_JOURNAL_FILE);
      const before = parseStepJournal(fs.readFileSync(journal, "utf8"));
      const stored = readStoredStagingRecord(staging);
      const transaction = path.join(
        path.dirname(staging),
        `.${path.basename(staging)}.workflow-journal-transaction.json`,
      );
      fs.writeFileSync(
        transaction,
        `${stableJson({
          schemaVersion: "agent-skill-chain/workflow-journal-transaction/v1",
          journalBeforeDigest: "a".repeat(64),
          journalAfterDigest: "b".repeat(64),
          stagingDigestBefore: stored.digest,
          artifacts: stored.artifacts,
          otherArtifactsDigest: calculateStagingDigest(
            staging,
            stored.artifacts.filter(
              (artifact) => artifact !== STEP_JOURNAL_FILE,
            ),
          ),
        })}\n`,
        { mode: 0o600 },
      );

      assert.throws(
        () => appendWorkflowJournalEntry({ staging, entry: entry(1) }),
        /workflow journalがtransactionの旧版・新版いずれとも一致しません/u,
      );
      const after = parseStepJournal(fs.readFileSync(journal, "utf8"));
      assert.equal(after.entries.length, before.entries.length);
      break;
    }
    case "SCN-UNIT-WFJRNL-022": {
      /**
       * **post-terminal intakeの記録は順序判定から外す。**
       *
       * `pr create`後に届いた外部指摘を同じPRで取り込んだroundは、定義上Step 11より
       * 後に現れる。除外しないとStep 11がout-of-orderになり、規範が許した取り込みを
       * 記録できない（Issue #1194）。
       */
      const entries = [
        ...[0, 1, 4, 9, 10].map((step) => entry(step)),
        entry(11),
        { ...entry(10), postTerminalIntake: true as const },
      ];
      const outcome = result("quick", entries, 11);
      assert.deepEqual(outcome.outOfOrder, []);
      assert.equal(outcome.valid, true, outcome.errors.join("; "));
      break;
    }
    case "SCN-UNIT-WFJRNL-023": {
      /**
       * **intakeはStep 11より後にだけ置ける。** 前に置けると、終端を経ていない工程で
       * 順序判定を外す抜け道になる。
       */
      const entries = [
        ...[0, 1, 4, 9].map((step) => entry(step)),
        { ...entry(10), postTerminalIntake: true as const },
        entry(10),
        entry(11),
      ];
      const outcome = result("quick", entries, 11);
      assert.equal(outcome.valid, false);
      assert.ok(
        outcome.errors.some((message) =>
          message.includes("Step 11より後に置いてください"),
        ),
        outcome.errors.join("; "),
      );
      break;
    }
    case "SCN-UNIT-WFJRNL-027": {
      /**
       * **parseを通した往復で残ることを固定する。** 直接構築したentryだけを検査すると、
       * field許可一覧から`postTerminalIntake`を外す変異が生存する。
       */
      const rendered = JSON.stringify({
        ...entry(10),
        postTerminalIntake: true,
      });
      const parsed = parseStepJournal(`${rendered}\n`);
      assert.deepEqual(parsed.errors, []);
      assert.equal(parsed.entries[0]?.postTerminalIntake, true);
      break;
    }
    case "SCN-UNIT-WFJRNL-025": {
      /**
       * **postTerminalIntakeはStep 10にだけ許す。** 他のStepへ許すと、そのStepを
       * 順序判定から外せてしまう。
       */
      const rendered = JSON.stringify({
        ...entry(9),
        postTerminalIntake: true,
      });
      assert.match(
        parseStepJournal(`${rendered}\n`).errors.join("\n"),
        /postTerminalIntakeはStep 10にだけ指定できます/u,
      );
      break;
    }
    case "SCN-UNIT-WFJRNL-026": {
      /**
       * **postTerminalIntakeはtrueだけを受理する。** 任意値を許すと、falsyな値で
       * 記録しながらfield自体は存在する状態を作れる。
       */
      const rendered = JSON.stringify({
        ...entry(10),
        postTerminalIntake: "yes",
      });
      assert.match(
        parseStepJournal(`${rendered}\n`).errors.join("\n"),
        /postTerminalIntakeはtrueだけを受理します/u,
      );
      break;
    }
    case "SCN-UNIT-WFJRNL-024": {
      /**
       * **intakeを外すと順序判定が壊れる。** この反例が、除外そのものを消す変異を殺す。
       */
      const entries = [
        ...[0, 1, 4, 9, 10].map((step) => entry(step)),
        entry(11),
        entry(10),
      ];
      const outcome = result("quick", entries, 11);
      assert.deepEqual(outcome.outOfOrder, [11]);
      assert.equal(outcome.valid, false);
      break;
    }
    case "SCN-UNIT-WFJRNL-028": {
      /**
       * **adapterの第1封印を診断文字列ごと固定する。** 公開CLIはこの手前で
       * `--post-terminal-intake`の欠落を止めるため、adapter側の封印はAPI経由でしか
       * 観測できない。**封印を消す変異はCLI経路の検査だけでは生存する。**
       */
      const root = this.temp("asc-journal-intake-append-");
      const staging = createIssueStaging(root, {
        title: "journal-intake-append",
        answers: answers(),
        now: new Date(fixtureInstantMs()),
        requestedMode: "quick",
      }).path;
      for (const step of [1, 4, 9, 10])
        appendWorkflowJournalEntry({ staging, entry: entry(step) });
      appendDeliveryTerminalJournalEntry({ staging, entry: entry(11) });
      assert.throws(
        () => appendWorkflowJournalEntry({ staging, entry: entry(10) }),
        /Step 11記録後にworkflow journalへ追記できるのはpost-terminal intakeのStep 10だけです/u,
      );
      assert.throws(
        () =>
          appendWorkflowJournalEntry({
            staging,
            entry: { ...entry(9), postTerminalIntake: true as const },
          }),
        /postTerminalIntake/u,
      );
      const appended = appendWorkflowJournalEntry({
        staging,
        entry: { ...entry(10), postTerminalIntake: true as const },
      });
      assert.equal(appended.entry.postTerminalIntake, true);
      const stored = parseStepJournal(
        fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE), "utf8"),
      );
      assert.equal(stored.entries.at(-1)?.postTerminalIntake, true);
      break;
    }
    case "SCN-UNIT-WFJRNL-029": {
      const entries = [
        ...[0, 1, 4, 9, 10].map((step) => entry(step)),
        { ...entry(10), postPrIntake: true as const },
        entry(11),
      ];
      const outcome = result("quick", entries, 11);
      assert.deepEqual(outcome.outOfOrder, []);
      assert.equal(outcome.valid, true, outcome.errors.join("; "));
      break;
    }
    case "SCN-UNIT-WFJRNL-030": {
      const outcome = result(
        "quick",
        [
          ...[0, 1, 4, 9].map((step) => entry(step)),
          { ...entry(10), postPrIntake: true as const },
        ],
        10,
      );
      assert.equal(outcome.valid, false);
      assert.match(
        outcome.errors.join("\n"),
        /先行する通常のStep 10記録がありません/u,
      );
      break;
    }
    case "SCN-UNIT-WFJRNL-031": {
      const valid = parseStepJournal(
        `${JSON.stringify({ ...entry(10), postPrIntake: true })}\n`,
      );
      assert.deepEqual(valid.errors, []);
      assert.equal(valid.entries[0]?.postPrIntake, true);
      const invalidStep = parseStepJournal(
        `${JSON.stringify({ ...entry(9), postPrIntake: true })}\n`,
      );
      assert.match(
        invalidStep.errors.join("\n"),
        /postPrIntakeはStep 10にだけ指定できます/u,
      );
      const conflicting = parseStepJournal(
        `${JSON.stringify({
          ...entry(10),
          postPrIntake: true,
          postTerminalIntake: true,
        })}\n`,
      );
      assert.match(conflicting.errors.join("\n"), /同時に指定できません/u);
      break;
    }
    case "SCN-UNIT-WFJRNL-032":
    case "SCN-UNIT-WFJRNL-033":
    case "SCN-UNIT-WFJRNL-034":
    case "SCN-UNIT-WFJRNL-035": {
      const root = this.temp("asc-journal-post-pr-verify-");
      const staging = createIssueStaging(root, {
        title: "post-pr-intake-verify",
        answers: answers(),
        now: new Date(fixtureInstantMs()),
        requestedMode: "quick",
      }).path;
      for (const step of [1, 4, 9, 10])
        appendWorkflowJournalEntry({ staging, entry: entry(step) });
      const issueUrl = "https://github.com/o/r/issues/877";
      prepareStoredPullRequestCreation(staging, {
        repository: "o/r",
        issue: 877,
        issueUrl,
        headRef: "feature/x",
        headSha: "c".repeat(40),
        baseRef: "main",
        baseSha: "d".repeat(40),
        pullRequestDigest: pullRequestContentDigest({
          title: "post-PR intake",
          body: "Closes #877",
        }),
        bodyClosingDigest: closingContractDigest({
          canonicalIssue: 877,
          canonicalIssueUrl: issueUrl,
          closingIssueNumbers: [877],
        }),
        preparedAt: instant,
      });
      if (scenarioId === "SCN-UNIT-WFJRNL-035") {
        appendLegacyJournal(
          path.join(staging, STEP_JOURNAL_FILE),
          `${JSON.stringify({ ...entry(10), postPrIntake: true })}\n`,
        );
        refreshStoredStagingDigest(staging);
      } else {
        bindStoredPullRequest(staging, {
          number: 1,
          url: "https://github.com/o/r/pull/1",
          boundAt: instant,
        });
        appendWorkflowJournalEntry({
          staging,
          entry: { ...entry(10), postPrIntake: true as const },
        });
      }
      if (scenarioId === "SCN-UNIT-WFJRNL-033") {
        fs.rmSync(path.join(staging, ...DELIVERY_STATE_FILE.split("/")));
        refreshStoredStagingDigest(staging);
      } else if (scenarioId === "SCN-UNIT-WFJRNL-034") {
        fs.appendFileSync(path.join(staging, "00_要求定義.md"), "\n改変\n");
      }
      const verified = await executeMain([
        "workflow",
        "verify",
        `--staging=${staging}`,
        "--up-to=10",
      ]);
      if (scenarioId === "SCN-UNIT-WFJRNL-032") {
        assert.equal(verified.status, 0, verified.stdout);
        assert.match(verified.stdout, /"valid": true/u);
      } else {
        assert.equal(verified.status, 1, verified.stdout);
        assert.match(
          verified.stdout,
          scenarioId === "SCN-UNIT-WFJRNL-033"
            ? /delivery stateがありません/u
            : scenarioId === "SCN-UNIT-WFJRNL-035"
              ? /対応しないdelivery stateです: create-prepared/u
              : /content digestが保存値と一致しません/u,
        );
      }
      break;
    }
    case "SCN-UNIT-WFJRNL-021": {
      const root = this.temp("asc-journal-staging-mismatch-");
      const staging = createIssueStaging(root, {
        title: "journal-staging-mismatch",
        answers: answers(),
        now: new Date(fixtureInstantMs()),
        requestedMode: "quick",
      }).path;
      const stored = readStoredStagingRecord(staging);
      fs.appendFileSync(path.join(staging, "00_要求定義.md"), "\n編集済み\n");
      const artifacts = listStagingArtifacts(staging);
      const currentDigest = calculateStagingDigest(staging, artifacts);
      assert.notEqual(currentDigest, stored.digest);
      const journal = path.join(staging, STEP_JOURNAL_FILE);
      const transaction = path.join(
        path.dirname(staging),
        `.${path.basename(staging)}.workflow-journal-transaction.json`,
      );
      fs.writeFileSync(
        transaction,
        `${stableJson({
          schemaVersion: "agent-skill-chain/workflow-journal-transaction/v1",
          journalBeforeDigest: crypto
            .createHash("sha256")
            .update(fs.readFileSync(journal))
            .digest("hex"),
          journalAfterDigest: "f".repeat(64),
          stagingDigestBefore: currentDigest,
          artifacts,
          otherArtifactsDigest: calculateStagingDigest(
            staging,
            artifacts.filter((artifact) => artifact !== STEP_JOURNAL_FILE),
          ),
        })}\n`,
        { mode: 0o600 },
      );

      // markerのstagingDigestBeforeは現在の実内容と一致し、staging recordだけが
      // 旧値のまま残る。before-publishの3条件のうち
      // `stored.digest === stagingDigestBefore`だけが偽になる入力である。
      assert.notEqual(readStoredStagingRecord(staging).digest, currentDigest);
      assert.throws(
        () => inspectPendingJournalTransaction(staging),
        /workflow journalがtransactionの旧版・新版いずれとも一致しません/u,
      );
      break;
    }
    case "SCN-UNIT-WFMODE-001": {
      const rendered = renderModeDecision({
        requestedMode: "quick",
        answers: answers(),
        decidedAt: instant,
      });
      const parsed = parseModeDecision(rendered);
      assert.ok(parsed.decision);
      assert.equal(rendered, `${stableJson(parsed.decision)}\n`);
      break;
    }
    case "SCN-UNIT-WFMODE-002": {
      const rendered = JSON.parse(
        renderModeDecision({
          requestedMode: "quick",
          answers: answers(),
          decidedAt: instant,
        }),
      ) as Record<string, unknown>;
      const incomplete = rendered.answers as Record<string, unknown>;
      delete incomplete["Q-08"];
      assert.match(
        parseModeDecision(JSON.stringify(rendered)).errors.join("\n"),
        /Q-08/u,
      );
      break;
    }
    case "SCN-UNIT-WFMODE-003": {
      const source = {
        mode: "poc",
        requestedMode: "poc",
        answers: answers(),
        reasons: [],
        decidedAt: instant,
      };
      assert.match(
        parseModeDecision(JSON.stringify(source)).errors.join("\n"),
        /PocDeclaration/u,
      );
      break;
    }
    case "SCN-UNIT-WFMODE-004": {
      const rendered = JSON.parse(
        renderModeDecision({
          requestedMode: "quick",
          answers: answers(),
          decidedAt: instant,
        }),
      ) as Record<string, unknown>;
      rendered.unknown = true;
      assert.match(
        parseModeDecision(JSON.stringify(rendered)).errors.join("\n"),
        /未知field/u,
      );
      break;
    }
    case "SCN-UNIT-WFMODE-005": {
      const parsed = parseModeDecision(
        renderModeDecision({
          requestedMode: "poc",
          answers: answers(),
          decidedAt: instant,
          poc: validPoc(),
          changedFiles: ["package.json"],
        }),
      );
      assert.deepEqual(parsed.errors, []);
      assert.equal(parsed.decision?.mode, "full");
      assert.deepEqual(parsed.decision?.changedFiles, ["package.json"]);
      break;
    }
    case "SCN-UNIT-WFOVR-001": {
      const checked = validateJournalHumanOverride({
        override: humanOverride({
          instructedAt: "2026-08-25T12:00:00.001Z",
        }),
        issue: 877,
        now: overrideNow,
      });
      assert.equal(checked.valid, false);
      assert.match(checked.errors.join("\n"), /指示日時が未来/u);
      break;
    }
    case "SCN-UNIT-WFOVR-002": {
      const checked = validateJournalHumanOverride({
        override: humanOverride({
          expiresAt: "2026-08-25T11:59:59.999Z",
        }),
        issue: 877,
        now: overrideNow,
      });
      assert.equal(checked.valid, false);
      assert.match(checked.errors.join("\n"), /失効/u);
      break;
    }
    case "SCN-UNIT-WFOVR-003": {
      const checked = validateJournalHumanOverride({
        override: humanOverride({ instructedAt: overrideNow }),
        issue: 877,
        now: overrideNow,
      });
      assert.deepEqual(checked, { valid: true, errors: [] });
      break;
    }
    case "SCN-UNIT-WFOVR-004": {
      const checked = validateJournalHumanOverride({
        override: humanOverride({ issue: 878 }),
        issue: 877,
        now: overrideNow,
      });
      assert.equal(checked.valid, false);
      assert.match(checked.errors.join("\n"), /Issueが対象と一致しません/u);
      break;
    }
    case "SCN-UNIT-ADVANCE-001": {
      const plan = planWorkflowAdvance({
        mode: "full",
        currentStep: 3,
        nextStep: 4,
        valid: true,
      });
      assert.equal(plan.operation, "sync");
      assert.equal(plan.validationStage, "requirements");
      assert.deepEqual(plan.required, [
        "repository",
        "issue",
        "authorize=approved",
      ]);
      const design = planWorkflowAdvance({
        mode: "full",
        currentStep: 4,
        nextStep: 5,
        valid: true,
      });
      assert.equal(design.validationStage, "design-artifact");
      break;
    }
    case "SCN-UNIT-ADVANCE-002": {
      const review = planWorkflowAdvance({
        mode: "full",
        currentStep: 9,
        nextStep: 10,
        valid: true,
        implementationHeadBound: true,
      });
      const delivery = planWorkflowAdvance({
        mode: "full",
        currentStep: 10,
        nextStep: 11,
        valid: true,
      });
      assert.equal(review.state, "delegated");
      assert.equal(review.operation, "review");
      assert.equal(delivery.state, "delegated");
      assert.equal(delivery.operation, "delivery");
      break;
    }
    case "SCN-UNIT-ADVANCE-003": {
      const plan = planWorkflowAdvance({
        mode: "quick",
        currentStep: 1,
        nextStep: 4,
        valid: false,
        errors: ["journal digest mismatch"],
      });
      assert.equal(plan.state, "blocked");
      assert.equal(plan.operation, "blocked");
      assert.deepEqual(plan.reasons, ["journal digest mismatch"]);
      break;
    }
    case "SCN-UNIT-ADVANCE-004": {
      const plan = planWorkflowAdvance({
        mode: "quick",
        currentStep: 1,
        nextStep: 9,
        valid: true,
      });
      assert.equal(plan.state, "blocked");
      assert.equal(plan.operation, "blocked");
      assert.match(plan.reasons.join("\n"), /必須順序/u);
      break;
    }
    case "SCN-UNIT-ADVANCE-005": {
      const plan = planWorkflowAdvance({
        mode: "full",
        currentStep: 9,
        nextStep: 10,
        valid: true,
        implementationHeadBound: false,
      });
      assert.equal(plan.state, "blocked");
      assert.equal(plan.operation, "blocked");
      assert.match(plan.reasons.join("\n"), /implementationHeadSha/u);
      assert.match(plan.next, /workflow record --step=9/u);
      break;
    }
    default:
      throw new Error(`未対応のunit scenarioです: ${scenarioId}`);
  }
  this.workflowCheckPassed = true;
});

Then("ワークフローStep単体検査は期待結果になる", function () {
  assert.equal(this.workflowCheckPassed, true);
});

function createQuickStaging(root: string): string {
  return createIssueStaging(root, {
    title: "workflow-test",
    answers: answers(),
    now: new Date(instant),
    requestedMode: "quick",
  }).path;
}

/** 再開状態（REQ-WF-047）のpreview出力。 */
interface ResumePreview {
  status: number;
  output: {
    state: string;
    operation: string;
    targetStep: number;
    reasons: string[];
    resume: {
      authority: string;
      staging: string;
      headSha: string | null;
      baseSha: string | null;
      planning: {
        sealed: boolean;
        sealDigest: string | null;
        amendmentCount: number;
      } | null;
      implementation: { headSha: string | null; matchesHead: boolean | null };
      verification: Record<string, unknown> | null;
      review: Record<string, unknown> | null;
      delivery: Record<string, unknown> | null;
      errors: string[];
    };
  };
}

async function previewResume(staging: string): Promise<ResumePreview> {
  const checked = await executeMain([
    "workflow",
    "advance",
    `--staging=${staging}`,
  ]);
  return {
    status: checked.status,
    output: JSON.parse(checked.stdout) as ResumePreview["output"],
  };
}

/**
 * previewが書き込まないことの観測点（INV-01）。stagingの全fileのpathとSHA-256、
 * `git count-objects -v`、`.git`直下のlock file。
 */
function resumeWriteSnapshot(root: string, staging: string): unknown {
  const files: [string, string][] = [];
  const walk = (directory: string) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) walk(file);
      else
        files.push([
          path.relative(staging, file),
          crypto
            .createHash("sha256")
            .update(fs.readFileSync(file))
            .digest("hex"),
        ]);
    }
  };
  walk(staging);
  const objects = spawnSync("git", ["count-objects", "-v"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(objects.status, 0, objects.stderr);
  const gitDirectory = spawnSync("git", ["rev-parse", "--absolute-git-dir"], {
    cwd: root,
    encoding: "utf8",
  }).stdout.trim();
  return {
    files,
    objects: objects.stdout,
    locks: fs
      .readdirSync(gitDirectory)
      .filter((name) => name.endsWith(".lock"))
      .sort(),
  };
}

function gitHeadOf(root: string): string {
  return spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).stdout.trim();
}

/** Step 9をimplementation HEADで記録し、初回review前のquick staging。 */
function implementedResumeStaging(world: WorkflowStepWorld): {
  root: string;
  staging: string;
  implementationHeadSha: string;
} {
  const root = fs.realpathSync(world.initRepo());
  const staging = createIssueStaging(root, {
    title: "resume-test",
    answers: answers(),
    now: new Date(instant),
    requestedMode: "quick",
  }).path;
  for (const step of [1, 4])
    appendWorkflowJournalEntry({ staging, entry: entry(step) });
  const implementationHeadSha = ensureImplementationCommit(root);
  appendWorkflowJournalEntry({
    staging,
    entry: { ...entry(9), implementationHeadSha },
    headSha: implementationHeadSha,
  });
  return { root, staging, implementationHeadSha };
}

function completeAdvanceRequirement(staging: string): void {
  const requirementFile = path.join(staging, "00_要求定義.md");
  const completed = fs
    .readFileSync(requirementFile, "utf8")
    .split("\n")
    .map((line) =>
      line.startsWith("|")
        ? line
            .replaceAll("applicable / not-applicable", "not-applicable")
            .replace(/（[^）\n]*）/gu, "自動検査で非該当を確認した")
        : line,
    )
    .join("\n");
  fs.writeFileSync(
    requirementFile,
    `${completed}\nScenario: SCN-QUICK-ADVANCE-001 次Stepを記録する\n  Given 要求成果物が完成している\n  When 次Stepを適用する\n  Then Step 1が記録される\n`,
  );
}

function executeCli(args: string[], cwd = process.cwd(), env = process.env) {
  return spawnSync(
    process.execPath,
    [path.resolve("dist/bin/agent-skill-chain.js"), ...args],
    { cwd, env, encoding: "utf8" },
  );
}

async function executeMain(args: string[]): Promise<{
  status: number;
  stdout: string;
}> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let stdout = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    const status = await main(args);
    return { status, stdout };
  } finally {
    process.stdout.write = originalWrite;
  }
}

Given("ワークフローStep統合検査の隔離環境がある", function () {
  this.workflowCheckPassed = false;
});

When("{string}の統合検査を実行する", async function (scenarioId: string) {
  const root = this.temp("asc-workflow-int-");
  switch (scenarioId) {
    case "SCN-INT-WFSTEP-001": {
      const staging = createQuickStaging(root);
      const before = fs.readFileSync(
        path.join(staging, STEP_JOURNAL_FILE),
        "utf8",
      );
      const appended = appendWorkflowJournalEntry({ staging, entry: entry(1) });
      const after = fs.readFileSync(
        path.join(staging, STEP_JOURNAL_FILE),
        "utf8",
      );
      assert.ok(after.length > before.length);
      assert.match(appended.journalDigest, /^[a-f0-9]{64}$/u);
      break;
    }
    case "SCN-INT-WFSTEP-002": {
      const staging = createQuickStaging(root);
      assert.throws(
        () => appendWorkflowJournalEntry({ staging, entry: entry(4) }),
        /missingSteps=1/u,
      );
      break;
    }
    case "SCN-INT-WFSTEP-003": {
      const staging = createQuickStaging(root);
      const checked = await executeMain([
        "workflow",
        "verify",
        `--staging=${staging}`,
        "--up-to=4",
      ]);
      assert.notEqual(checked.status, 0);
      assert.match(checked.stdout, /step 1/u);
      assert.match(checked.stdout, /記録がありません/u);
      break;
    }
    case "SCN-INT-WFSTEP-004": {
      const staging = createQuickStaging(root);
      fs.rmSync(path.join(staging, STEP_JOURNAL_FILE));
      const checked = doctor(root);
      assert.match(
        JSON.stringify(checked.workflow),
        /steps\.jsonlがありません/u,
      );
      break;
    }
    case "SCN-INT-WFSTEP-005": {
      const staging = createQuickStaging(root);
      fs.rmSync(path.join(staging, "00_モード判定.json"));
      const checked = doctor(root);
      assert.match(
        JSON.stringify(checked.workflow),
        /00_モード判定\.jsonがありません/u,
      );
      break;
    }
    case "SCN-INT-WFSTEP-006":
      assert.equal(checkWorkflowSteps().valid, true);
      break;
    case "SCN-INT-WFSTEP-007":
    case "SCN-INT-WFSTEP-008": {
      const document = path.join(root, "workflow.md");
      let markdown = fs.readFileSync(
        ".agent-skill-chain/docs/01_開発ワークフロー.md",
        "utf8",
      );
      markdown =
        scenarioId === "SCN-INT-WFSTEP-007"
          ? markdown.replace("専用worktreeで実装", "通常directoryで実装")
          : markdown.replace("0 → 1 → 4 → 9 → 10 → 11", "0 → 1 → 9 → 10 → 11");
      fs.writeFileSync(document, markdown);
      const checked = checkWorkflowSteps(process.cwd(), document);
      assert.equal(checked.valid, false);
      assert.match(checked.errors.join("\n"), /一致しません/u);
      break;
    }
    case "SCN-INT-WFSTEP-009": {
      const document = path.join(root, "workflow.md");
      const markdown = fs
        .readFileSync(".agent-skill-chain/docs/01_開発ワークフロー.md", "utf8")
        .replace("専用worktreeで実装", "通常directoryで実装");
      fs.writeFileSync(document, markdown);
      const errors = checkWorkflowStepDocument(process.cwd(), document);
      assert.match(errors.join("\n"), /workflow step契約/u);
      assert.match(errors.join("\n"), /一致しません/u);
      break;
    }
    case "SCN-INT-WFSTEP-010": {
      const staging = createQuickStaging(root);
      for (const step of [1, 4, 9])
        appendWorkflowJournalEntry({ staging, entry: entry(step) });
      recordStagingSync(staging, {
        tracker: "https://github.com/o/r/issues/877",
        checkpoint: 4,
        syncedAt: instant,
        bodyDigest: "a".repeat(64),
        readBackDigest: "a".repeat(64),
      });
      const promoted = promoteWorkflowStagingToFull({
        staging,
        promotedAt: later,
        discovery: quickPromotionDiscovery(),
      });
      assert.equal(promoted.previousMode, "quick");
      assert.equal(promoted.mode, "full");
      assert.equal(promoted.state, "promotion-active");
      assert.equal(promoted.tracker, "https://github.com/o/r/issues/877");
      assert.deepEqual(promoted.nextSteps, [2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const stored = readStoredStagingRecord(staging);
      assert.equal(stored.mode, "full");
      assert.equal(stored.state, "promotion-active");
      assert.equal(stored.checkpoint, 4);
      const canonicalDecision = parseModeDecision(
        fs.readFileSync(path.join(staging, MODE_DECISION_FILE), "utf8"),
      ).decision;
      assert.equal(canonicalDecision?.mode, "full");
      assert.equal(canonicalDecision?.requestedMode, "quick");
      assert.equal(canonicalDecision?.answers["Q-03"]?.answer, false);
      assert.match(
        canonicalDecision?.answers["Q-03"]?.evidence ?? "",
        /security-boundary/u,
      );
      const originalDecision = parseModeDecision(
        fs.readFileSync(
          path.join(staging, "00_モード判定_昇格前_quick.json"),
          "utf8",
        ),
      ).decision;
      assert.equal(originalDecision?.mode, "quick");
      assert.equal(originalDecision?.requestedMode, "quick");
      assert.match(
        fs.readFileSync(path.join(staging, "00_要求定義.md"), "utf8"),
        /\| Q-03 \| false \|/u,
      );
      for (const artifact of [
        "00_要求定義_昇格前_quick.md",
        "00_モード判定_昇格前_quick.json",
        "01_要件定義.md",
        "02_設計.md",
        "03_実装計画.md",
        "09_実装中発見_full昇格.json",
      ])
        assert.equal(fs.existsSync(path.join(staging, artifact)), true);
      appendWorkflowJournalEntry({
        staging,
        entry: entry(2, "full", later),
      });
      assert.equal(inspectWorkflowStaging(staging, 2).validation.valid, true);
      const notReady = inspectWorkflowStaging(staging, 10);
      assert.equal(notReady.validation.valid, false);
      assert.equal(notReady.state, "promotion-active");
      for (const step of [3, 4, 5, 6, 7])
        appendWorkflowJournalEntry({
          staging,
          entry: entry(step, "full", later),
        });
      recordStagingSync(staging, {
        tracker: "https://github.com/o/r/issues/877",
        checkpoint: 8,
        syncedAt: later,
        bodyDigest: "b".repeat(64),
        readBackDigest: "b".repeat(64),
      });
      for (const step of [8, 9, 10])
        appendWorkflowJournalEntry({
          staging,
          entry: entry(step, "full", later),
        });
      const ready = inspectWorkflowStaging(staging, 10);
      assert.equal(ready.validation.valid, true);
      assert.equal(ready.state, "sync-verified");
      assert.equal(ready.nextStep, 11);
      break;
    }
    case "SCN-INT-WFSTEP-011": {
      for (const args of [
        ["init", "-q", "-b", "main"],
        ["config", "user.name", "poc-test"],
        ["config", "user.email", "poc-test@example.invalid"],
      ]) {
        const initialized = spawnSync("git", args, {
          cwd: root,
          encoding: "utf8",
        });
        assert.equal(initialized.status, 0, initialized.stderr);
      }
      fs.writeFileSync(path.join(root, "README.md"), "# baseline\n");
      for (const args of [
        ["add", "README.md"],
        ["commit", "-q", "-m", "baseline"],
      ]) {
        const committed = spawnSync("git", args, {
          cwd: root,
          encoding: "utf8",
        });
        assert.equal(committed.status, 0, committed.stderr);
      }
      const staging = createIssueStaging(root, {
        title: "poc-promotion",
        answers: answers(),
        now: new Date(instant),
        requestedMode: "poc",
        poc: validPoc(),
      }).path;
      const inputFile = path.join(root, "discovery.json");
      fs.writeFileSync(
        inputFile,
        `${JSON.stringify({
          discoveryId: "DISC-PROMOTION-002",
          workflowMode: "poc",
          modeDisqualifiers: [
            { id: "personal-data", evidence: "個人データ利用を観測した" },
          ],
          changedContractKinds: ["data"],
          changesGoal: false,
          changesScope: false,
          changesAcceptanceCriteria: false,
          expandsSecurityBoundary: false,
          introducesIrreversibleOperation: false,
        })}\n`,
      );
      const checked = await executeMain([
        "workflow",
        "promote-full",
        `--root=${root}`,
        `--staging=${staging}`,
        "--input=discovery.json",
        `--promoted-at=${later}`,
      ]);
      assert.equal(checked.status, 0);
      assert.match(checked.stdout, /"state": "preview"/u);
      assert.equal(readStoredStagingRecord(staging).mode, "poc");
      const applied = await executeMain([
        "workflow",
        "promote-full",
        `--root=${root}`,
        `--staging=${staging}`,
        "--input=discovery.json",
        `--promoted-at=${later}`,
        "--apply",
      ]);
      assert.equal(applied.status, 0);
      assert.match(applied.stdout, /"previousMode": "poc"/u);
      assert.match(applied.stdout, /"mode": "full"/u);
      const stored = readStoredStagingRecord(staging);
      assert.equal(stored.mode, "full");
      assert.equal(stored.state, "local-active");
      assert.equal(
        fs.existsSync(path.join(staging, "00_要求定義_昇格前_poc.md")),
        true,
      );
      const canonicalDecision = parseModeDecision(
        fs.readFileSync(path.join(staging, MODE_DECISION_FILE), "utf8"),
      ).decision;
      assert.equal(canonicalDecision?.requestedMode, "poc");
      assert.equal(
        canonicalDecision?.poc?.highRisk.find(
          ({ id }) => id === "personal-data",
        )?.present,
        true,
      );
      assert.equal(
        parseModeDecision(
          fs.readFileSync(
            path.join(staging, "00_モード判定_昇格前_poc.json"),
            "utf8",
          ),
        ).decision?.mode,
        "poc",
      );
      break;
    }
    case "SCN-INT-WFSTEP-012": {
      const staging = createQuickStaging(root);
      const outside = path.join(root, "outside-requirement.md");
      fs.writeFileSync(outside, "staging外の内容\n");
      fs.rmSync(path.join(staging, "00_要求定義.md"));
      fs.symlinkSync(outside, path.join(staging, "00_要求定義.md"));
      assert.throws(
        () =>
          promoteWorkflowStagingToFull({
            staging,
            promotedAt: later,
            discovery: quickPromotionDiscovery(),
          }),
        /symlinkでない通常file/u,
      );
      assert.equal(fs.readFileSync(outside, "utf8"), "staging外の内容\n");
      assert.equal(
        fs.existsSync(path.join(staging, "00_要求定義_昇格前_quick.md")),
        false,
      );
      break;
    }
    case "SCN-INT-WFSTEP-013": {
      const staging = createQuickStaging(root);
      fs.appendFileSync(path.join(staging, "00_要求定義.md"), "\n改ざん\n");
      assert.throws(
        () =>
          promoteWorkflowStagingToFull({
            staging,
            promotedAt: later,
            discovery: quickPromotionDiscovery(),
          }),
        /content digest/u,
      );
      assert.equal(
        fs.existsSync(path.join(staging, "00_要求定義_昇格前_quick.md")),
        false,
      );
      break;
    }
    case "SCN-INT-WFSTEP-014": {
      const staging = createQuickStaging(root);
      const recordSource = fs.readFileSync(
        path.join(staging, "staging-record.json"),
        "utf8",
      );
      const decisionSource = fs.readFileSync(
        path.join(staging, MODE_DECISION_FILE),
        "utf8",
      );
      const requirementSource = fs.readFileSync(
        path.join(staging, "00_要求定義.md"),
        "utf8",
      );
      const generated = [
        "00_要求定義_昇格前_quick.md",
        "00_モード判定_昇格前_quick.json",
        "01_要件定義.md",
        "02_設計.md",
        "03_実装計画.md",
        "09_実装中発見_full昇格.json",
      ];
      fs.writeFileSync(
        path.join(staging, ".full-promotion-transaction.json"),
        `${stableJson({
          schemaVersion: "agent-skill-chain/full-promotion-transaction/v1",
          pid: 2_147_483_647,
          previousMode: "quick",
          originalRecordSource: recordSource,
          originalDecisionSource: decisionSource,
          originalRequirementSource: requirementSource,
          absentArtifacts: generated,
        })}\n`,
      );
      fs.writeFileSync(
        path.join(staging, "00_要求定義_昇格前_quick.md"),
        "途中生成物\n",
      );
      fs.writeFileSync(path.join(staging, "00_要求定義.md"), "途中状態\n");
      fs.writeFileSync(
        path.join(staging, "staging-record.json.tmp-2147483647-interrupted"),
        "途中record\n",
      );
      const promoted = promoteWorkflowStagingToFull({
        staging,
        promotedAt: later,
        discovery: quickPromotionDiscovery(),
      });
      assert.equal(promoted.mode, "full");
      assert.equal(
        fs.existsSync(path.join(staging, ".full-promotion-transaction.json")),
        false,
      );
      assert.notEqual(
        fs.readFileSync(
          path.join(staging, "00_要求定義_昇格前_quick.md"),
          "utf8",
        ),
        "途中生成物\n",
      );
      assert.equal(
        fs.existsSync(
          path.join(staging, "staging-record.json.tmp-2147483647-interrupted"),
        ),
        false,
      );
      break;
    }
    case "SCN-INT-WFSTEP-015": {
      const staging = createQuickStaging(root);
      const discovery = quickPromotionDiscovery();
      promoteWorkflowStagingToFull({
        staging,
        promotedAt: later,
        discovery,
      });
      const recovered = promoteWorkflowStagingToFull({
        staging,
        promotedAt: "2026-08-25T14:00:00.000Z",
        discovery,
      });
      assert.equal(recovered.mode, "full");
      assert.equal(recovered.previousMode, "quick");
      const finalized = readStoredStagingRecord(staging);
      assert.throws(
        () =>
          promoteWorkflowStagingToFull({
            staging,
            promotedAt: later,
            discovery: { ...discovery, workflowMode: "poc" },
          }),
        /永続化済み昇格Evidenceと一致しません/u,
      );
      assert.throws(
        () =>
          promoteWorkflowStagingToFull({
            staging,
            promotedAt: later,
            discovery: {
              ...discovery,
              discoveryId: "DISC-PROMOTION-OTHER",
            },
          }),
        /永続化済み昇格Evidenceと一致しません/u,
      );
      const artifacts = listStagingArtifacts(staging);
      assert.deepEqual(finalized.artifacts, artifacts);
      assert.equal(
        finalized.digest,
        calculateStagingDigest(staging, artifacts),
      );
      fs.appendFileSync(path.join(staging, "00_要求定義.md"), "\n未記録変更\n");
      assert.throws(
        () =>
          promoteWorkflowStagingToFull({
            staging,
            promotedAt: later,
            discovery,
          }),
        /成果物またはdigest/u,
      );
      break;
    }
    case "SCN-INT-WFSTEP-016": {
      const staging = createQuickStaging(root);
      for (const step of [1, 4])
        appendWorkflowJournalEntry({ staging, entry: entry(step) });
      recordStagingSync(staging, {
        tracker: "https://github.com/o/r/issues/877",
        checkpoint: 4,
        syncedAt: instant,
        bodyDigest: "a".repeat(64),
        readBackDigest: "a".repeat(64),
      });
      for (const step of [9, 10])
        appendWorkflowJournalEntry({ staging, entry: entry(step) });
      for (const forbidden of [0, 11]) {
        assert.throws(
          () =>
            appendWorkflowJournalEntry({
              staging,
              entry: entry(forbidden),
            }),
          /初期化専用|delivery終端専用/u,
        );
        await assert.rejects(
          () =>
            executeMain([
              "workflow",
              "record",
              `--staging=${staging}`,
              `--step=${forbidden}`,
              "--artifact=https://github.com/o/r/pull/1",
              "--evidence=forged terminal",
            ]),
          /初期化専用|delivery終端専用/u,
        );
      }
      assert.equal(
        parseStepJournal(
          fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE), "utf8"),
        ).entries.filter((item) => item.step === 0).length,
        1,
      );
      assert.equal(
        parseStepJournal(
          fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE), "utf8"),
        ).entries.some((item) => item.step === 11),
        false,
      );
      break;
    }
    case "SCN-INT-WFSTEP-017": {
      const staging = createQuickStaging(root);
      const issueUrl = "https://github.com/o/r/issues/877";
      const discoveryFile = path.join(root, "discovery.json");
      fs.writeFileSync(
        discoveryFile,
        `${JSON.stringify(quickPromotionDiscovery())}\n`,
      );
      prepareStoredPullRequestCreation(staging, {
        repository: "o/r",
        issue: 877,
        issueUrl,
        headRef: "feature/x",
        headSha: "a".repeat(40),
        baseRef: "main",
        baseSha: "b".repeat(40),
        pullRequestDigest: pullRequestContentDigest({
          title: "workflow promotion",
          body: "Closes #877",
        }),
        bodyClosingDigest: closingContractDigest({
          canonicalIssue: 877,
          canonicalIssueUrl: issueUrl,
          closingIssueNumbers: [877],
        }),
        preparedAt: instant,
      });
      const recordBefore = fs.readFileSync(
        path.join(staging, "staging-record.json"),
        "utf8",
      );
      const artifactsBefore = listStagingArtifacts(staging);
      await assert.rejects(
        () =>
          executeMain([
            "workflow",
            "promote-full",
            `--staging=${staging}`,
            "--input=discovery.json",
            `--root=${root}`,
          ]),
        /delivery開始後.*full昇格/u,
      );
      await assert.rejects(
        () =>
          executeMain([
            "workflow",
            "promote-full",
            `--staging=${staging}`,
            "--input=discovery.json",
            `--root=${root}`,
            "--apply",
          ]),
        /delivery開始後.*full昇格/u,
      );
      assert.equal(readStoredStagingRecord(staging).mode, "quick");
      assert.equal(
        fs.readFileSync(path.join(staging, "staging-record.json"), "utf8"),
        recordBefore,
      );
      assert.deepEqual(listStagingArtifacts(staging), artifactsBefore);
      assert.equal(
        fs.existsSync(path.join(staging, "00_要求定義_昇格前_quick.md")),
        false,
      );
      break;
    }
    case "SCN-INT-WFSTEP-018": {
      const source = createQuickStaging(root);
      const target = createQuickStaging(
        this.temp("asc-workflow-symlink-target-"),
      );
      const sourceJournal = path.join(source, STEP_JOURNAL_FILE);
      const targetJournal = path.join(target, STEP_JOURNAL_FILE);
      const before = fs.readFileSync(targetJournal, "utf8");
      fs.unlinkSync(sourceJournal);
      fs.symlinkSync(targetJournal, sourceJournal);
      assert.throws(
        () => appendWorkflowJournalEntry({ staging: source, entry: entry(1) }),
        /symlink|通常file/u,
      );
      assert.equal(fs.readFileSync(targetJournal, "utf8"), before);
      break;
    }
    case "SCN-INT-WFSTEP-019": {
      const staging = createQuickStaging(root);
      const journal = path.join(staging, STEP_JOURNAL_FILE);
      const before = parseStepJournal(fs.readFileSync(journal, "utf8"));
      fs.appendFileSync(path.join(staging, "00_要求定義.md"), "\n統合追記\n");

      appendWorkflowJournalEntry({ staging, entry: entry(1) });

      const after = parseStepJournal(fs.readFileSync(journal, "utf8"));
      assert.equal(after.entries.length, before.entries.length + 1);
      break;
    }
    case "SCN-INT-WFSTEP-020": {
      const staging = createQuickStaging(root);
      const stored = readStoredStagingRecord(staging);
      const journal = path.join(staging, STEP_JOURNAL_FILE);
      const beforeSource = fs.readFileSync(journal, "utf8");
      const transaction = path.join(
        path.dirname(staging),
        `.${path.basename(staging)}.workflow-journal-transaction.json`,
      );
      fs.writeFileSync(
        transaction,
        `${stableJson({
          schemaVersion: "agent-skill-chain/workflow-journal-transaction/v1",
          journalBeforeDigest: crypto
            .createHash("sha256")
            .update(beforeSource)
            .digest("hex"),
          journalAfterDigest: "f".repeat(64),
          stagingDigestBefore: stored.digest,
          artifacts: stored.artifacts,
          otherArtifactsDigest: calculateStagingDigest(
            staging,
            stored.artifacts.filter(
              (artifact) => artifact !== STEP_JOURNAL_FILE,
            ),
          ),
        })}\n`,
        { mode: 0o600 },
      );
      fs.appendFileSync(path.join(staging, "00_要求定義.md"), "\n未記録変更\n");

      assert.throws(
        () => appendWorkflowJournalEntry({ staging, entry: entry(1) }),
        /workflow journal transaction以外のstaging成果物が変更されています/u,
      );
      assert.equal(fs.readFileSync(journal, "utf8"), beforeSource);
      break;
    }
    default:
      throw new Error(`未対応のintegration scenarioです: ${scenarioId}`);
  }
  this.workflowCheckPassed = true;
});

Then("ワークフローStep統合検査は期待結果になる", function () {
  assert.equal(this.workflowCheckPassed, true);
});

interface PreparedPullRequest {
  root: string;
  staging: string;
  args: string[];
  headSha: string;
  baseSha: string;
  implementationCommitSha: string;
  bodyFile: string;
  overrideTimes: {
    instructedAt: string;
    expiresAt: string;
  };
}

interface DeliveryProviderControl {
  /**
   * providerが観測させるPR head（`H_final`）と`H_impl`（Issue #1531）。
   *
   * **未指定なら`preparePullRequest`の固定値を使う。** `pr create`後に前進commitを
   * pushした状態を再現するscenarioだけが、再固定先の新headへ進める。
   */
  headSha?: string;
  implementationSha?: string;
  /**
   * merge後の既定branch tipをmerge commitより先へ進める（Issue #1569）。
   * 未指定ならmerge commit自体がtipであり、既存scenarioの挙動を変えない。
   */
  postMergeTipSha?: string;
  /** 2親merge commitの親の順序を入れ替える（Issue #1569、方式判定不能の再現）。 */
  mergeParentsSwapped?: boolean;
  /**
   * `pr.create`内のremote HEAD再検証を失敗させる（Issue #1157）。
   *
   * **この照会は`pr.create`の中でだけ起きる。** dispatch gateより前で落ちるため、
   * claimを消費しないことをCLI経路で観測できる。
   */
  failCreateVerification: boolean;
  phase: "ready" | "merge-requested" | "queue-requested" | "merged";
  mergeStateStatus: "CLEAN" | "BLOCKED";
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  viewerPermission: "WRITE" | "ADMIN";
  rulesetOnly: boolean;
  unresolvedReviewThreads: number;
  unknownBranchRule: boolean;
  unknownRuleParameter: boolean;
  omitPullRequestRule: boolean;
  statusCheckConclusion: "SUCCESS" | "FAILURE";
  ghVersion: string;
  closingChanged: boolean;
  /**
   * PR作成後の読み戻しのうち、先頭何回をclosing索引が空の観測にするか
   * （Issue #1271）。GitHubの索引反映遅延を再現する。
   */
  emptyClosingViews: number;
  /**
   * PR本文を変えずにclosing索引だけへ対象外Issueを混ぜる（Issue #1271）。
   *
   * `closingChanged`は本文も変えるため、core identityの照合で先に落ちて
   * binding失敗の経路へ届かない。**索引だけが契約と食い違う場合を作る。**
   */
  extraClosingIndexOnly: boolean;
  failMerge: boolean;
  mergedAt: string;
  remoteBaseSha: string;
  mergeTreeSha: string;
  autoMergeMethod: "MERGE" | "SQUASH" | "REBASE";
  providerDefaultBranch: "main" | "develop";
  requestedAt: string;
  existingPr:
    | "none"
    | "open"
    | "closed"
    | "paged-closed"
    | "open-and-closed"
    | "empty-pages"
    | "unterminated-page"
    | "malformed-node";
  prAuthorId: string | null;
  implementationAuthorId: string | null;
  /**
   * **APPROVEDを提出したreviewerのstable actor ID**（Issue #1317）。
   *
   * 既定は実装者と別actorであり、既存scenarioの挙動を変えない。
   * `prAuthorId`・`implementationAuthorId`と同じ値にすると、**実利用者が報告した
   * 単独運用（implementer = PR author = reviewer）をprovider観測として再現できる。**
   */
  reviewerId: string;
  /**
   * **APPROVED reviewが指すcommit**（Issue #1320）。
   *
   * 既定の`"head"`は現在のH_finalであり、既存scenarioの挙動を変えない。
   * `"stale"`は別commitを指す承認を作る。**merge実経路のexact-HEAD拘束は
   * これまでE2Eで検査されておらず、拘束を外す変異が既存scenarioでも生存した。**
   */
  reviewCommitSha: "head" | "stale";
  reviewDisposition:
    "approved" | "changes-requested" | "commented-after-approval" | "none";
  mergeTreeTampered: boolean;
  terminalParentTampered: boolean;
  mergeOnDefaultBranch: boolean;
  mergeImmediately: boolean;
  queueOnMerge: boolean;
  retainAutoMergeRequestWhenMerged: boolean;
  headRepository: string;
  isCrossRepository: boolean;
  contentChanged: boolean;
  titleChanged: boolean;
  /**
   * **closing索引を変えずに本文のclosing参照だけを変える**（Issue #1517 AMD-001）。
   *
   * `"added"`は対象外Issueの`Closes`を本文へ足し、`"removed"`は canonical Issueの
   * `Closes`を`Relates to`へ置き換える。索引が一致したままなので、本文のclosing契約
   * digestの照合だけが拒否の根拠になる。既定の`"none"`は既存scenarioの挙動を変えない。
   *
   * 修飾付きの形（R5-01）: `"qualified-other"`は同一repositoryの`o/r#878`、
   * `"url-other"`は同一repositoryのIssue URLで878、`"cross-repo"`は`other/repo#9`を、
   * `"cross-repo-same-number"`は番号だけcanonicalと同じ`other/repo#877`を足す。
   * `"url-canonical-only"`は canonical Issueの参照をURL形へ置き換え、
   * `"url-canonical-duplicate"`は`#877`を残したままURL形の877を足す。
   * code境界（AMD-003）: canonical以外への終端keyword参照はcode領域を除かずに拒否するため、
   * code内・code判定の境界にある外部closing参照はすべて拒否する。`"indented-fence-other"`は4スペース字下げの
   * 疑似fenceの後、`"fenced-code-other"`は正規fence内、`"info-backtick-fence-other"`は
   * info stringにbacktickを含む疑似fenceの後、`"list-unclosed-fence-other"`はlist内の
   * 閉じないfenceの後に外部参照を足す。
   */
  closingBodyEdit:
    | "none"
    | "added"
    | "removed"
    | "qualified-other"
    | "url-other"
    | "cross-repo"
    | "cross-repo-same-number"
    | "url-canonical-only"
    | "url-canonical-duplicate"
    | "indented-fence-other"
    | "fenced-code-other"
    | "info-backtick-fence-other"
    | "list-unclosed-fence-other";
  /**
   * merge後に固定run IDで直読みしたrunの`conclusion`（Issue #1280）。
   * **不一致側を作るための唯一の入口である。** 既定は`"success"`で挙動を変えない。
   */
  fixedRunConclusion: string;
  /**
   * **merge前の一覧観測が返す`pull_requests`**（Issue #1280）。
   *
   * merge前の選別はこの一覧を読む。**空を許すとdispatch可能集合が増える。**
   * 既定の`"target"`は対象PR 1件で、既存scenarioの挙動を変えない。
   */
  preMergeRunPullRequests: "target" | "empty" | "other";
  /**
   * **merge成功後にprovider側のreview状態が動いた場合を作る**（Issue #1280）。
   *
   * merge後のread-backは固定review Evidenceをread-onlyで再観測する。
   * `"replaced"`はより小さいreview IDの別の独立reviewerが現れた場合、
   * `"revoked"`は独立reviewerが承認を取り下げた場合である。
   * 既定の`"none"`は既存scenarioの挙動を変えない。
   */
  postMergeReviewShift: "none" | "replaced" | "revoked";
  concurrentIssueEditAtAdapterCas?: boolean;
  failIssueReadBackAfterEditOnce?: boolean;
  mutateIssueBodyAfterEdit?: "drop-final-lf";
}

interface PreparedDeliveryCli extends PreparedPullRequest {
  controlFile: string;
  logFile: string;
  issueBodyFile: string;
  env: NodeJS.ProcessEnv;
}

function preparedPullRequestDigest(prepared: PreparedPullRequest): string {
  const content = splitPullRequestDocument(
    fs.readFileSync(prepared.bodyFile, "utf8"),
  );
  return pullRequestContentDigest(content);
}

function preparedMergeReviewEvidence(prepared: PreparedPullRequest) {
  const reviewArtifactPath = "docs/reviews/877_review.json";
  const reviewArtifactDigest = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(prepared.root, reviewArtifactPath)))
    .digest("hex");
  const identity = {
    domain: "agent-skill-chain/merge-review-evidence/v1",
    repository: "o/r",
    prNumber: 1,
    finalHeadSha: prepared.headSha,
    implementationCommitSha: prepared.implementationCommitSha,
    reviewArtifactPath,
    reviewArtifactDigest,
    ciRunId: "42",
    reviewId: "7",
  };
  return {
    implementationCommitSha: prepared.implementationCommitSha,
    reviewArtifactPath,
    reviewArtifactDigest,
    ciRunId: "42",
    reviewId: "7",
    reviewEvidenceId: canonicalDigest(identity),
  };
}

function reviewRoundFixture(root: string, baseSha: string, headSha: string) {
  const observed = observeReviewDiff(root, baseSha, headSha);
  return parseReviewRoundInput({
    round: 1,
    previousRoundDigest: null,
    anchor: {
      scopeIds: ["SCOPE-WORKFLOW"],
      acceptanceCriteriaIds: ["AC-WF-005"],
      invariantIds: ["INV-WORKFLOW"],
      diffBaseSha: baseSha,
      initialHeadSha: headSha,
      initialDiffDigest: observed.digest,
    },
    candidateHeadSha: headSha,
    focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
    findings: [],
  });
}

/**
 * `convergedReviewBinding`が後で記録するsessionと同じ値を先に導出し、そこから
 * review証跡を生成する。**session値はround入力だけから決まる**ため、証跡commitを
 * session記録より前に置いても一致する。
 */
function contextIsolatedReviewEvidence(
  root: string,
  baseSha: string,
  implementationSha: string,
  independenceMode: "context-isolated" | "actor-independent",
) {
  const session = advanceReviewSession(
    null,
    reviewRoundFixture(root, baseSha, implementationSha),
  );
  const observed = observeFixtureVerification(root, {
    baseSha,
    implementationHeadSha: implementationSha,
  });
  return {
    evidence: reviewEvidenceFromSession(session, {
      issue: 877,
      independenceMode,
      baseSha,
      implementationHeadSha: implementationSha,
      diffDigest: observed.diffDigest,
      impact: observed.impact,
      observedVerification: observed.verification,
    }),
    records: observed.records,
  };
}

function convergedReviewBinding(
  root: string,
  staging: string,
  baseSha: string,
  headSha: string,
): NonNullable<StepJournalEntry["reviewSession"]> {
  const session = recordReviewRound({
    staging,
    round: reviewRoundFixture(root, baseSha, headSha),
  });
  return {
    sessionId: session.sessionId,
    roundDigest: session.latestRoundDigest,
    headSha: session.latestCandidateHeadSha,
  };
}

/**
 * trusted policyが宣言できるmerge mode（Issue #1320）。
 *
 * **3値すべてを受け取る。** 旧実装は`"disabled" | "automatic"`の2値で、
 * `assisted`をE2Eへ渡す手段が無かった。**その結果`assisted`は実CLI経路で
 * 一度も踏まれておらず、`decideDeliveryContinuation`の`wait-authority`分岐が
 * 回帰検出の対象外だった。**
 */
type FixtureMergeMode = "disabled" | "assisted" | "automatic";

/** 版管理下full stagingのroot（Issue #1531）。 */
const TRACKED_FULL_STAGING_ROOT = "docs/issues";

/** `pr create`後の前進commitで初めてcommitする計画変更記録。 */
const TRACKED_FULL_AMENDMENT = [
  "# 05 計画変更",
  "",
  "## AMD-001 変更",
  "",
  "- 対象: 対象の計画変更の記述",
  "- 変更: 変更の計画変更の記述",
  "- 理由: 理由の計画変更の記述",
  "",
].join("\n");

/**
 * trusted policyのstaging節を版管理下rootへ差し替え、Step 8で封印したfull stagingを
 * 作る（Issue #1531）。**呼出し側はこのstagingをtrusted commitへ含める。**
 */
function prepareTrackedFullStaging(root: string): string {
  const manifestFile = path.join(
    root,
    ".agent-skill-chain",
    "project-policy.json",
  );
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as {
    policy: Record<string, unknown>;
  };
  manifest.policy.staging = { root: TRACKED_FULL_STAGING_ROOT, tracked: true };
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.mkdirSync(path.join(root, ...TRACKED_FULL_STAGING_ROOT.split("/")), {
    recursive: true,
  });
  const staging = createIssueStaging(root, {
    title: "workflow-test",
    answers: answers(),
    now: new Date(fixtureInstantMs()),
    requestedMode: "full",
    stagingRoot: TRACKED_FULL_STAGING_ROOT,
  }).path;
  writeFullStagingArtifacts(staging);
  for (const step of [1, 2, 3, 4, 5, 6, 7, 8])
    appendWorkflowJournalEntry({
      staging,
      entry: entry(step, "full", fixtureInstant({ hoursAgo: 1 })),
    });
  return staging;
}

function preparePullRequest(
  world: WorkflowStepWorld,
  missingStep4: boolean,
  mergeMode: FixtureMergeMode = "disabled",
  mergeMethod: "merge" | "squash" | "rebase" = "merge",
  /**
   * trusted policyが宣言する`merge.reviewIndependence`（Issue #1317）。
   * **未指定は宣言なし**であり、既定の`context-isolated`が適用される。
   */
  reviewIndependence?: "context-isolated" | "actor-independent",
  /**
   * 生成するstagingのworkflow mode（Issue #1320）。
   *
   * **既定は`"quick"`で、既存scenarioの観測値を変えない。** `"poc"`では
   * review artifactの代わりにPoC隔離fixtureをHEAD commitにする。PoCの
   * `pr create`は**baselineからHEADまでの差分がfixture root内だけである**ことを
   * 再計測するため、review artifactを載せると成立しない。
   *
   * `"full"`は版管理下root（`docs/issues`）のfull stagingを作る（Issue #1531）。
   * Step 8で封印した00〜03はtrusted commit（`baseSha`）に載せる。
   * `05_計画変更.md`はここでは作らない。呼出し側が`pr create`後の前進commitで
   * AMDを追加し、実CLIの`pr reanchor --apply`で実効HEADを移す。
   */
  workflowMode: "quick" | "poc" | "full" = "quick",
  requiredReviews = 0,
  artifactDisposition:
    | "valid"
    | "rejected"
    | "session-mismatch"
    | "himpl-mismatch"
    | "untracked"
    | "extra-file"
    | "stale-verification" = "valid",
  /**
   * disabledでも実装commitと証跡commitを分離する。後からmergeへ再開する
   * scenarioは、review sessionと一致する証跡を`H_final`に持つ必要がある。
   */
  separateArtifact = false,
  /**
   * **`implementation.txt`の既定commitを置き換える差し込み点（Issue #1495）。**
   *
   * merge-base-audit E2E fixtureは、実装commit自体をT→M(既定branch前進)→merge→
   * revertという特定のgraph形状で作る必要がある。このhookはHEADがbaseSha上に
   * checkoutされた時点で呼ばれ、戻り値なしでrepositoryへ直接commitする。
   * hookが返った後のHEADが新しい実装commitとして扱われる。**未指定時は
   * 既存の`implementation.txt`単一commitのまま**であり、他の900件超の既存
   * scenarioの観測値は1byteも変わらない。
   */
  customImplementationCommit?: (root: string, baseSha: string) => void,
): PreparedPullRequest {
  const fixturePast = fixtureInstant({ hoursAgo: 1 });
  const fixtureNow = fixtureInstant();
  const fixtureFuture = fixtureInstant({ daysAhead: 1 });
  const root = fs.realpathSync(world.initRepo());
  fs.mkdirSync(path.join(root, ".agent-skill-chain", "policy"), {
    recursive: true,
  });
  fs.copyFileSync(
    path.resolve(".agent-skill-chain/policy/default.json"),
    path.join(root, ".agent-skill-chain", "policy", "default.json"),
  );
  /**
   * **`disabled`はpackage同梱の既定policyをそのまま使う**（Issue #1320）。
   * 上書きするのは`assisted`と`automatic`だけであり、`automatic`の生成内容は
   * 従来と1文字も変えていない。既存scenarioの観測値を動かさないためである。
   */
  if (mergeMode !== "disabled") {
    const policyFile = path.join(
      root,
      ".agent-skill-chain",
      "policy",
      "default.json",
    );
    const policy = JSON.parse(fs.readFileSync(policyFile, "utf8")) as Record<
      string,
      unknown
    >;
    policy.merge = {
      mode: mergeMode,
      branches: ["feature/x"],
      methods: [mergeMethod],
      requiredChecks: [],
      requiredReviews,
      ...(reviewIndependence ? { reviewIndependence } : {}),
    };
    fs.writeFileSync(policyFile, `${JSON.stringify(policy, null, 2)}\n`);
  }
  /**
   * **trusted commitは検証command宣言を持つproject policy setを含む**（REQ-WF-040）。
   * manifestの`policy`は上で書いた既定policyと同じ値にし、merge条件を動かさない。
   */
  writeTrustedPolicySet(root);
  const fullStaging =
    workflowMode === "full" ? prepareTrackedFullStaging(root) : undefined;
  spawnSync(
    "git",
    [
      "add",
      "--",
      ...TRUSTED_POLICY_PATHS,
      ...(fullStaging ? [TRACKED_FULL_STAGING_ROOT] : []),
    ],
    {
      cwd: root,
    },
  );
  spawnSync("git", ["commit", "-q", "-m", "trusted policy"], {
    cwd: root,
  });
  const baseSha = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).stdout.trim();
  spawnSync("git", ["update-ref", "refs/remotes/origin/main", baseSha], {
    cwd: root,
  });
  spawnSync(
    "git",
    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    { cwd: root },
  );
  // Merge可能なPRではreview対象の実装commitをbaseより後に置く。
  // review artifactはさらに後の専用commitへ分離する。
  if (
    (mergeMode !== "disabled" || separateArtifact) &&
    workflowMode !== "poc"
  ) {
    if (customImplementationCommit) customImplementationCommit(root, baseSha);
    else {
      fs.writeFileSync(
        path.join(root, "implementation.txt"),
        "product change\n",
      );
      spawnSync("git", ["add", "implementation.txt"], { cwd: root });
      spawnSync("git", ["commit", "-q", "-m", "implementation"], {
        cwd: root,
      });
    }
  }
  const implementationCommitSha = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).stdout.trim();
  const pocDeclaration = workflowMode === "poc" ? validPoc() : undefined;
  /**
   * **PoC baselineはstaging生成時のHEADで固定される**（`src/domain/issue.ts`）。
   * fixtureをcommitしてからstagingを作るとbaselineとHEADが同じcommitになり、
   * `pr create`が「baselineからcurrent HEADへのfixture変更がありません」で
   * 止まる。**stagingを先に作る。**
   */
  const pocStaging = pocDeclaration
    ? createIssueStaging(root, {
        title: "workflow-test",
        answers: answers(),
        now: new Date(fixtureInstantMs()),
        requestedMode: "poc",
        poc: pocDeclaration,
      }).path
    : undefined;
  let reviewFixture:
    ReturnType<typeof contextIsolatedReviewEvidence> | undefined;
  if (pocDeclaration) {
    materializeValidPocFixture(root, pocDeclaration);
    spawnSync("git", ["add", pocDeclaration.fixture.root], { cwd: root });
    spawnSync("git", ["commit", "-q", "-m", "poc fixture"], { cwd: root });
  } else {
    fs.mkdirSync(path.join(root, "docs", "reviews"), { recursive: true });
    reviewFixture = contextIsolatedReviewEvidence(
      root,
      baseSha,
      implementationCommitSha,
      reviewIndependence ?? "context-isolated",
    );
    const reviewEvidence = reviewFixture.evidence;
    const reviewArtifact = renderReviewEvidence(reviewEvidence);
    if (artifactDisposition !== "untracked")
      fs.writeFileSync(
        path.join(root, "docs", "reviews", "877_review.json"),
        artifactDisposition === "rejected"
          ? reviewArtifact.replace(
              '"verdict": "approved"',
              '"verdict": "rejected"',
            )
          : artifactDisposition === "session-mismatch"
            ? resealObservedEvidence(reviewEvidence, {
                session: {
                  ...reviewEvidence.observed.session,
                  latestRoundDigest: "0".repeat(64),
                },
              })
            : artifactDisposition === "himpl-mismatch"
              ? resealObservedEvidence(reviewEvidence, {
                  implementationHeadSha: "f".repeat(40),
                })
              : reviewArtifact,
      );
    if (artifactDisposition !== "untracked") {
      if (artifactDisposition === "extra-file")
        fs.writeFileSync(
          path.join(root, "unexpected.txt"),
          "not evidence-only\n",
        );
      spawnSync(
        "git",
        [
          "add",
          "docs/reviews/877_review.json",
          ...(artifactDisposition === "extra-file" ? ["unexpected.txt"] : []),
        ],
        { cwd: root },
      );
      spawnSync("git", ["commit", "-q", "-m", "review evidence"], {
        cwd: root,
      });
    }
  }
  const headSha = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).stdout.trim();
  const separatedReviewArtifact =
    workflowMode !== "poc" &&
    (mergeMode !== "disabled" || separateArtifact) &&
    artifactDisposition !== "untracked";
  const reviewCandidateHeadSha = separatedReviewArtifact
    ? implementationCommitSha
    : headSha;
  /**
   * **通常は`implementationCommitSha^`（直接の親）を使う。** 通常のfixtureは
   * `implementationCommitSha`が常に`baseSha`の直接の子（単一親）であり、
   * これは`baseSha`と同値になる。**`customImplementationCommit`を渡した
   * fixture（Issue #1495）はこの前提を壊す。** 実装commitがmerge commitを
   * 経由する複数親graphになりうるため、`implementationCommitSha^`は
   * `baseSha`と一致しない。宣言済み`baseSha`をそのまま使う。
   */
  const reviewBaseSha = customImplementationCommit
    ? baseSha
    : separatedReviewArtifact
      ? spawnSync("git", ["rev-parse", `${implementationCommitSha}^`], {
          cwd: root,
          encoding: "utf8",
        }).stdout.trim()
      : baseSha;
  const branchRef = separatedReviewArtifact
    ? spawnSync("git", ["symbolic-ref", "--short", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).stdout.trim()
    : undefined;
  if (separatedReviewArtifact)
    spawnSync("git", ["checkout", "-q", "--detach", implementationCommitSha], {
      cwd: root,
    });
  const staging =
    pocStaging ??
    fullStaging ??
    createIssueStaging(root, {
      title: "workflow-test",
      answers: answers(),
      now: new Date(fixtureInstantMs()),
      requestedMode: "quick",
    }).path;
  if (pocDeclaration) {
    for (const step of [1, 4])
      appendWorkflowJournalEntry({
        staging,
        entry: entry(step, "poc", fixturePast),
      });
    executePocObservation({
      staging,
      headSha,
      observedAt: new Date(fixtureInstantMs()).toISOString(),
    });
    appendWorkflowJournalEntry({
      staging,
      entry: entry(9, "poc", fixturePast),
      headSha,
    });
    const pocReviewSession = convergedReviewBinding(
      root,
      staging,
      baseSha,
      headSha,
    );
    appendWorkflowJournalEntry({
      staging,
      entry: {
        ...entry(10, "poc", fixturePast),
        reviewSession: pocReviewSession,
      },
      headSha,
    });
    recordStagingSync(staging, {
      tracker: "https://github.com/o/r/issues/877",
      checkpoint: 4,
      syncedAt: fixtureNow,
      bodyDigest: "a".repeat(64),
      readBackDigest: "a".repeat(64),
    });
    return finalizePreparedPullRequest({
      world,
      root,
      staging,
      headSha,
      baseSha,
      implementationCommitSha,
      fixtureNow,
      fixturePast,
      fixtureFuture,
    });
  }
  const journalFile = path.join(staging, STEP_JOURNAL_FILE);
  if (missingStep4) {
    const preReviewEntries = [0, 1, 9].map((step) => ({
      ...entry(step, "quick", fixturePast),
      ...(step === 9 ? { implementationHeadSha: reviewCandidateHeadSha } : {}),
    }));
    fs.writeFileSync(
      journalFile,
      `${preReviewEntries.map((item) => JSON.stringify(item)).join("\n")}\n`,
    );
    refreshStoredStagingDigest(staging);
    const reviewSession = convergedReviewBinding(
      root,
      staging,
      reviewBaseSha,
      reviewCandidateHeadSha,
    );
    appendLegacyJournal(
      journalFile,
      `${JSON.stringify({
        ...entry(10, "quick", fixturePast),
        reviewSession,
      })}\n`,
    );
    refreshStoredStagingDigest(staging);
  } else {
    const journalMode = fullStaging ? "full" : "quick";
    for (const step of fullStaging ? [9] : [1, 4, 9])
      appendWorkflowJournalEntry({
        staging,
        entry: entry(step, journalMode, fixturePast),
        ...(step === 9 ? { headSha: reviewCandidateHeadSha } : {}),
      });
    const reviewSession = convergedReviewBinding(
      root,
      staging,
      reviewBaseSha,
      reviewCandidateHeadSha,
    );
    appendWorkflowJournalEntry({
      staging,
      entry: {
        ...entry(10, journalMode, fixturePast),
        reviewSession,
      },
    });
  }
  if (branchRef) spawnSync("git", ["checkout", "-q", branchRef], { cwd: root });
  /**
   * artifact生成で観測した同一root/base/H_implの記録をそのまま置く。
   * prepare呼出し内だけで共有し、別fixture・HEAD・時刻の観測は再利用しない。
   */
  assert.ok(reviewFixture);
  appendFixtureVerificationRecords(staging, reviewFixture.records);
  /**
   * `stale-verification`は証跡の生成後に同じcommandを再実行した記録を足す。
   * 証跡の検証欄の記録は存在し合格だが、stagingから再導出した検証欄（最新の実行）とは
   * 一致しない。staging digestはこの状態で同期する。
   */
  if (artifactDisposition === "stale-verification")
    appendFixtureVerificationRecords(
      staging,
      observeFixtureVerification(root, {
        baseSha,
        implementationHeadSha: implementationCommitSha,
        finishedAt: "2026-09-26T00:00:30.000Z",
      }).records,
    );
  recordStagingSync(staging, {
    tracker: "https://github.com/o/r/issues/877",
    checkpoint: fullStaging ? 8 : 4,
    syncedAt: fixtureNow,
    bodyDigest: "a".repeat(64),
    readBackDigest: "a".repeat(64),
  });
  if (artifactDisposition === "untracked")
    fs.writeFileSync(
      path.join(root, "docs", "reviews", "877_review.json"),
      renderReviewEvidence(reviewFixture.evidence),
    );
  return finalizePreparedPullRequest({
    world,
    root,
    staging,
    headSha,
    baseSha,
    implementationCommitSha,
    fixtureNow,
    fixturePast,
    fixtureFuture,
  });
}

/**
 * `pr create`の引数とevidenceを組み立てる共通の末尾（Issue #1320）。
 *
 * **quickとpocで同一にする。** 経路ごとに別の引数を組み立てると、観測差が
 * modeの差なのか引数の差なのか判別できなくなる。
 */
function finalizePreparedPullRequest(input: {
  world: WorkflowStepWorld;
  root: string;
  staging: string;
  headSha: string;
  baseSha: string;
  implementationCommitSha: string;
  fixtureNow: string;
  fixturePast: string;
  fixtureFuture: string;
}): PreparedPullRequest {
  const { world, root, staging, headSha, baseSha, implementationCommitSha } =
    input;
  const evidence = path.join(world.temp("asc-workflow-evidence-"), "pr.json");
  fs.writeFileSync(
    evidence,
    `${JSON.stringify({
      headSha,
      review: { approved: true, headSha },
      tests: {
        passed: true,
        headSha,
        scenarioIds: ["SCN-E2E-WFSTEP-002"],
      },
      spec: {
        consistent: true,
        headSha,
        impact: "updated",
        trace: {
          requirements: ["FR-877-01"],
          scenarios: ["SCN-E2E-WFSTEP-002"],
          tests: ["test/features/e2e/workflow-step-enforcement-cli.feature"],
        },
      },
      ownership: {
        classified: true,
        owner: "package",
        targetLayer: "package",
      },
    })}\n`,
  );
  const bodyFile = path.join(world.temp("asc-workflow-body-"), "PR.md");
  fs.writeFileSync(
    bodyFile,
    conformingPullRequestBody({
      title: "bugfix: 877を是正する",
      canonicalIssue: 877,
    }),
  );
  return {
    root,
    staging,
    headSha,
    baseSha,
    implementationCommitSha,
    bodyFile,
    overrideTimes: {
      instructedAt: input.fixturePast,
      expiresAt: input.fixtureFuture,
    },
    args: [
      "pr",
      "create",
      "--repo=o/r",
      "--issue=877",
      "--head=feature/x",
      "--base=main",
      `--head-sha=${headSha}`,
      `--evidence=${evidence}`,
      `--root=${root}`,
      `--staging=${staging}`,
      `--body-file=${bodyFile}`,
    ],
  };
}

function writeDeliveryProviderControl(
  prepared: PreparedDeliveryCli,
  patch: Partial<DeliveryProviderControl>,
): void {
  const current = JSON.parse(
    fs.readFileSync(prepared.controlFile, "utf8"),
  ) as DeliveryProviderControl;
  fs.writeFileSync(
    prepared.controlFile,
    `${JSON.stringify({ ...current, ...patch })}\n`,
  );
}

function advanceDeliveryTrustedMergeMode(
  prepared: PreparedDeliveryCli,
  mode: FixtureMergeMode,
  /**
   * 許可するmerge方式と、providerが観測させるbaseまで進めるか（Issue #1569）。
   * 既定は従来どおり`merge`だけを許可し、provider baseも進める。
   */
  options: { methods?: string[]; updateProviderBase?: boolean } = {},
): string {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "asc-policy-index-"));
  const indexFile = path.join(scratch, "index");
  const policyPath = ".agent-skill-chain/policy/default.json";
  const shown = spawnSync(
    "git",
    ["show", `${prepared.baseSha}:${policyPath}`],
    {
      cwd: prepared.root,
      encoding: "utf8",
    },
  );
  assert.equal(shown.status, 0, shown.stderr);
  const merge = {
    mode,
    branches: ["feature/x"],
    methods: options.methods ?? ["merge"],
    requiredChecks: [],
    requiredReviews: 0,
  };
  const policy = JSON.parse(shown.stdout) as Record<string, unknown>;
  policy.merge = merge;
  /**
   * **trusted project policy manifestの`policy.merge`も同じ値へ進める**（REQ-WF-040で
   * trusted commitがproject policy setを持つため）。既定policyだけを変えると、
   * project側のmerge宣言がそのまま残る。
   */
  const manifestPath = ".agent-skill-chain/project-policy.json";
  const manifestShown = spawnSync(
    "git",
    ["show", `${prepared.baseSha}:${manifestPath}`],
    { cwd: prepared.root, encoding: "utf8" },
  );
  assert.equal(manifestShown.status, 0, manifestShown.stderr);
  const manifest = JSON.parse(manifestShown.stdout) as {
    policy: Record<string, unknown>;
  };
  manifest.policy.merge = merge;
  const environment = { ...process.env, GIT_INDEX_FILE: indexFile };
  const readTree = spawnSync("git", ["read-tree", prepared.baseSha], {
    cwd: prepared.root,
    env: environment,
    encoding: "utf8",
  });
  assert.equal(readTree.status, 0, readTree.stderr);
  for (const [target, value] of [
    [policyPath, policy],
    [manifestPath, manifest],
  ] as const) {
    const materialized = path.join(scratch, path.basename(target));
    fs.writeFileSync(materialized, `${JSON.stringify(value, null, 2)}\n`);
    const blob = spawnSync("git", ["hash-object", "-w", materialized], {
      cwd: prepared.root,
      encoding: "utf8",
    });
    assert.equal(blob.status, 0, blob.stderr);
    const updateIndex = spawnSync(
      "git",
      [
        "update-index",
        "--add",
        "--cacheinfo",
        `100644,${blob.stdout.trim()},${target}`,
      ],
      { cwd: prepared.root, env: environment, encoding: "utf8" },
    );
    assert.equal(updateIndex.status, 0, updateIndex.stderr);
  }
  const tree = spawnSync("git", ["write-tree"], {
    cwd: prepared.root,
    env: environment,
    encoding: "utf8",
  });
  assert.equal(tree.status, 0, tree.stderr);
  const commit = spawnSync(
    "git",
    [
      "commit-tree",
      tree.stdout.trim(),
      "-p",
      prepared.baseSha,
      "-m",
      `merge mode ${mode}`,
    ],
    { cwd: prepared.root, encoding: "utf8" },
  );
  assert.equal(commit.status, 0, commit.stderr);
  const advanced = commit.stdout.trim();
  const updateRef = spawnSync(
    "git",
    ["update-ref", "refs/remotes/origin/main", advanced],
    { cwd: prepared.root, encoding: "utf8" },
  );
  assert.equal(updateRef.status, 0, updateRef.stderr);
  if (options.updateProviderBase === false) return advanced;
  const mergeTree = spawnSync(
    "git",
    ["merge-tree", "--write-tree", advanced, prepared.headSha],
    { cwd: prepared.root, encoding: "utf8" },
  );
  assert.equal(mergeTree.status, 0, mergeTree.stderr);
  const mergeTreeSha = mergeTree.stdout.trim();
  assert.match(mergeTreeSha, /^[a-f0-9]{40}$/u);
  writeDeliveryProviderControl(prepared, {
    remoteBaseSha: advanced,
    mergeTreeSha,
  });
  return advanced;
}

function deliveryProviderCalls(prepared: PreparedDeliveryCli): string[][] {
  if (!fs.existsSync(prepared.logFile)) return [];
  const source = fs.readFileSync(prepared.logFile, "utf8").trim();
  if (source === "") return [];
  return source.split("\n").map((line) => JSON.parse(line) as string[]);
}

function isMergeCall(args: readonly string[]): boolean {
  return args[0] === "pr" && args[1] === "merge";
}

function isCreateCall(args: readonly string[]): boolean {
  return args[0] === "pr" && args[1] === "create";
}

function isPullRequestFindCall(args: readonly string[]): boolean {
  return (
    args[0] === "api" &&
    args[1] === "graphql" &&
    args.some((argument) => argument.includes("query ExactPullRequests"))
  );
}

function isMergeReadBack(args: readonly string[]): boolean {
  return args[0] === "pr" && args[1] === "view" && args[2] === "1";
}

function assertReadBackWithoutMergeResend(
  before: readonly string[][],
  after: readonly string[][],
): void {
  const delta = after.slice(before.length);
  assert.equal(delta.some(isMergeCall), false);
  assert.ok(
    delta.filter(isMergeReadBack).length >= 1,
    "再実行はPRをread-backし、必要なauthority・review Evidenceを再検証する",
  );
}

/**
 * `full` stagingが`issue validate`を通る最小の00〜03を書く（Issue #1320）。
 *
 * **内容の妥当性はここで検査しない。** 目的はStep 0〜11の連続遷移を実CLI経路で
 * 通すことであり、成果物の中身は既存のunit・integration層が所有する。
 *
 * **括弧付きのtemplate語を書かない。** `unresolvedPlaceholders`が
 * 「記載」「内容」「根拠」などを含む丸括弧を未解決placeholderとして拒否する。
 */
function writeFullStagingArtifacts(staging: string): void {
  const dc = [
    "| ID | 考慮事項 | 判定 | 理由 | 証拠 |",
    "|---|---|---|---|---|",
    "| DC-PRIVACY | Privacy/Security by Design | not-applicable | E2E fixtureは隔離repository内で完結し個人情報も秘密情報も扱わない | fixtureはworld.temp配下に作られ実credentialを持たない |",
    "| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | not-applicable | 観測対象はCLIの終了値とjournalだけであり運用logを持たない | journalとdelivery stateを直接読んで判定する |",
    "| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | CLIでありWeb画面もUI componentも持たない | 変更対象にstyle定義を含まない |",
    "| DC-TOKENS | Design System・Design/Layout Token | not-applicable | design tokenとlayout tokenを持つUI層が存在しない | 変更対象にtheme定義を含まない |",
  ].join("\n");
  const principles = [
    "| P-01 worktree | 専用worktreeで作業する |",
    "| P-02 Markdown | 判断をMarkdownへ残す |",
    "| P-03 UNIX | 単一責務に保つ |",
    "| P-04 DDD | コンテキストと不変条件を守る |",
    "| P-05 BDD | Gherkin scenarioで固定する |",
    "| P-06 Evidence-driven Verification | 再現可能な証拠を残す |",
    "| P-07 Zero Trust | 入力と同一性を検証する |",
  ].join("\n");
  const scenario = [
    "```gherkin",
    "Scenario: SCN-E2E-WFSTEP-052 fullのStep 0から11までを実CLI経路で通す",
    "  Given full stagingがある",
    "  When Step 0から11までを実CLIで進める",
    "  Then journalは0から11までを持つ",
    "```",
  ].join("\n");
  fs.writeFileSync(
    path.join(staging, "00_要求定義.md"),
    [
      "# 00 要求定義",
      "",
      "| 項目 | 内容 |",
      "|---|---|",
      "| モード | `full` |",
      "",
      "## 1. 目的と背景",
      "",
      "full modeの全Stepを実CLI経路で通せることを確かめる。",
      "",
      "## 2. 対象範囲",
      "",
      "対象内はStep 0から11までの遷移である。対象外は成果物の内容検査である。",
      "",
      "## 3. 利害関係者と利用場面",
      "",
      "ASCの開発者が回帰として使う。",
      "",
      "## 4. ドメイン影響",
      "",
      "Workflowコンテキストのstep列だけに触れる。INV-01としてStep列を維持する。",
      "",
      "## 5. 要求の概要",
      "",
      "RQ-01としてfullの全Stepが実CLIで通ることを求める。",
      "",
      "## 6. 制約、前提、依存関係",
      "",
      dc,
      "",
      "## 7. 受け入れ条件と成功基準",
      "",
      "OUTCOME-01としてjournalが0から11までを持つ。",
      "",
      "## 8. リスクと安全側への縮小",
      "",
      "隔離repository外へ書き込まないことで実workspaceを守る。",
      "",
      "## 9. モード判定Q-01〜Q-08",
      "",
      "Q-07とQ-08が偽であるためfullとする。",
      "",
      "## 10. P-01〜P-07の適用計画",
      "",
      "| 原則 | 適用 |",
      "|---|---|",
      principles,
      "",
      "## 11. 図表と識別子の判断",
      "",
      "Mermaidは不要である。識別子はSCN IDだけで足りる。",
      "",
      "## 12. 参考資料、未決事項、再開地点",
      "",
      "未決事項は無い。次に実行するのはStep 2である。",
      "",
      scenario,
      "",
    ].join("\n"),
  );
  for (const [name, title] of [
    ["01_要件定義.md", "01 要件定義"],
    ["02_設計.md", "02 設計"],
    ["03_実装計画.md", "03 実装計画"],
  ])
    fs.writeFileSync(
      path.join(staging, name),
      [
        `# ${title}`,
        "",
        "## 1. 概要",
        "",
        "full経路の最小成果物である。",
        "",
        dc,
        "",
      ].join("\n"),
    );
}

function prepareDeliveryCli(
  world: WorkflowStepWorld,
  initial: Partial<DeliveryProviderControl> = {},
  mergeMode: FixtureMergeMode = "automatic",
  mergeMethod: "merge" | "squash" | "rebase" = "merge",
  reviewIndependence?: "context-isolated" | "actor-independent",
  workflowMode: "quick" | "poc" | "full" = "quick",
  requiredReviews = 0,
  artifactDisposition:
    | "valid"
    | "rejected"
    | "session-mismatch"
    | "himpl-mismatch"
    | "untracked"
    | "extra-file"
    | "stale-verification" = "valid",
  separateArtifact = false,
  /** `preparePullRequest`の同名引数への素通し（Issue #1495）。 */
  customImplementationCommit?: (root: string, baseSha: string) => void,
): PreparedDeliveryCli {
  const prepared = preparePullRequest(
    world,
    false,
    mergeMode,
    mergeMethod,
    reviewIndependence,
    workflowMode,
    requiredReviews,
    artifactDisposition,
    separateArtifact,
    customImplementationCommit,
  );
  const stubDirectory = world.temp("asc-delivery-cli-gh-");
  const stub = path.join(stubDirectory, "gh");
  const controlFile = path.join(stubDirectory, "control.json");
  const logFile = path.join(stubDirectory, "calls.jsonl");
  const observedBody = path.join(stubDirectory, "observed-pr-body.md");
  const issueBodyFile = path.join(stubDirectory, "issue-body.md");
  const issueViewCountFile = path.join(stubDirectory, "issue-view-count.txt");
  const mergeTree = spawnSync(
    "git",
    ["merge-tree", "--write-tree", prepared.baseSha, prepared.headSha],
    { cwd: prepared.root, encoding: "utf8" },
  );
  assert.equal(mergeTree.status, 0, mergeTree.stderr);
  const mergeTreeSha = mergeTree.stdout.trim();
  assert.match(mergeTreeSha, /^[a-f0-9]{40}$/u);
  const control: DeliveryProviderControl = {
    phase: "ready",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    viewerPermission: "WRITE",
    rulesetOnly: false,
    unresolvedReviewThreads: 0,
    unknownBranchRule: false,
    unknownRuleParameter: false,
    omitPullRequestRule: false,
    statusCheckConclusion: "SUCCESS",
    ghVersion: "2.97.0",
    closingChanged: false,
    emptyClosingViews: 0,
    extraClosingIndexOnly: false,
    failMerge: false,
    mergedAt: fixtureInstant({ secondsAhead: 1 }),
    remoteBaseSha: prepared.baseSha,
    mergeTreeSha,
    autoMergeMethod: "MERGE",
    providerDefaultBranch: "main",
    requestedAt: fixtureInstant(),
    existingPr: "none",
    failCreateVerification: false,
    prAuthorId: "pr-author",
    implementationAuthorId: "implementation-author",
    reviewerId: "independent-reviewer",
    reviewCommitSha: "head",
    reviewDisposition: "approved",
    mergeTreeTampered: false,
    terminalParentTampered: false,
    mergeOnDefaultBranch: true,
    mergeImmediately: false,
    queueOnMerge: false,
    retainAutoMergeRequestWhenMerged: false,
    headRepository: "o/r",
    isCrossRepository: false,
    contentChanged: false,
    titleChanged: false,
    closingBodyEdit: "none",
    fixedRunConclusion: "success",
    preMergeRunPullRequests: "target",
    postMergeReviewShift: "none",
    ...initial,
  };
  const canonicalDocument = splitPullRequestDocument(
    fs.readFileSync(prepared.bodyFile, "utf8"),
  );
  fs.writeFileSync(controlFile, `${JSON.stringify(control)}\n`);
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const initialControl = JSON.parse(fs.readFileSync(${JSON.stringify(controlFile)}, "utf8"));
const sha = initialControl.headSha ?? ${JSON.stringify(prepared.headSha)};
const implementationSha =
  initialControl.implementationSha ?? ${JSON.stringify(prepared.implementationCommitSha)};
const mergeSha = ${JSON.stringify("b".repeat(40))};
const rebasedImplementationSha = ${JSON.stringify("c".repeat(40))};
const prUrl = "https://github.com/o/r/pull/1";
const issueUrl = "https://github.com/o/r/issues/877";
const controlFile = ${JSON.stringify(controlFile)};
const logFile = ${JSON.stringify(logFile)};
const observedBody = ${JSON.stringify(observedBody)};
const canonicalTitle = ${JSON.stringify(canonicalDocument.title)};
const canonicalBody = ${JSON.stringify(canonicalDocument.body)};
/**
 * **provider clock由来のtimestampはfixture clockから供給する。**
 *
 * 実wall clockを使うと、full suiteがこのstubへ到達した時刻と、fixture基準から
 * 導いたprovider mergedAtとの前後関係がsuiteの所要時間で変わる。
 * delivery-stateは同一provider clock同士の順序だけを因果証拠として検査するため、
 * 一方を実時刻にすると検査が時間依存で落ちる（Issue #1300）。
 */
const mergeRequestedAt = ${JSON.stringify(fixtureInstant())};
const issueBodyFile = ${JSON.stringify(issueBodyFile)};
const issueViewCountFile = ${JSON.stringify(issueViewCountFile)};
fs.appendFileSync(logFile, JSON.stringify(args) + "\\n");
const control = JSON.parse(fs.readFileSync(controlFile, "utf8"));
const baseSha = control.remoteBaseSha;
const exact = (expected) =>
  args.length === expected.length &&
  args.every((argument, index) => argument === expected[index]);
const body = () => {
  const canonical = fs.existsSync(observedBody)
    ? fs.readFileSync(observedBody, "utf8").trimEnd()
    : canonicalBody;
  if (control.closingChanged) return canonical + "\\n\\nCloses #878";
  if (control.closingBodyEdit === "added") return canonical + "\\n\\nCloses #878";
  if (control.closingBodyEdit === "removed")
    return canonical.split("Closes #877").join("Relates to #877");
  if (control.closingBodyEdit === "qualified-other")
    return canonical + "\\n\\nCloses o/r#878";
  if (control.closingBodyEdit === "url-other")
    return canonical + "\\n\\nFixes https://github.com/o/r/issues/878";
  if (control.closingBodyEdit === "cross-repo")
    return canonical + "\\n\\nCloses other/repo#9";
  if (control.closingBodyEdit === "cross-repo-same-number")
    return canonical + "\\n\\nCloses other/repo#877";
  if (control.closingBodyEdit === "url-canonical-only")
    return canonical.split("Closes #877").join("Closes https://github.com/O/R/issues/877");
  if (control.closingBodyEdit === "indented-fence-other")
    return canonical + "\\n\\n    \`\`\`\\n\\nFixes other/repo#9";
  if (control.closingBodyEdit === "fenced-code-other")
    return canonical + "\\n\\n\`\`\`\\nCloses other/repo#9\\n\`\`\`";
  if (control.closingBodyEdit === "info-backtick-fence-other")
    return canonical + "\\n\\n\`\`\`a\`b\\n\\nFixes other/repo#9";
  if (control.closingBodyEdit === "list-unclosed-fence-other")
    return canonical + "\\n\\n- a\\n  \`\`\`\\nFixes other/repo#9";
  if (control.closingBodyEdit === "url-canonical-duplicate")
    return canonical + "\\n\\nCloses https://github.com/o/r/issues/877";
  return control.contentChanged ? canonical + "\\n\\nprovider content changed" : canonical;
};
const observation = () => ({
  number: 1,
  url: prUrl,
  title: control.titleChanged ? canonicalTitle + " changed" : canonicalTitle,
  body: body(),
  state:
    control.phase === "merged"
      ? "MERGED"
      : control.existingPr === "closed"
        ? "CLOSED"
        : "OPEN",
  mergedAt: control.phase === "merged" ? control.mergedAt : null,
  mergeCommit: control.phase === "merged" ? { oid: mergeSha } : null,
  autoMergeRequest:
    control.phase === "merge-requested" ||
    (control.phase === "merged" && control.retainAutoMergeRequestWhenMerged)
      ? {
          enabledAt: control.requestedAt,
          mergeMethod: control.autoMergeMethod,
        }
      : null,
  author: control.prAuthorId === null ? {} : { id: control.prAuthorId },
  isDraft: false,
  headRefName: "feature/x",
  baseRefName: "main",
  headRefOid: sha,
  baseRefOid: baseSha,
  headRepository: { nameWithOwner: control.headRepository },
  isCrossRepository: control.isCrossRepository,
  mergeable: control.mergeable,
  mergeStateStatus: control.mergeStateStatus,
  reviewDecision:
    control.reviewDisposition === "none" ? null : "APPROVED",
  statusCheckRollup:
    control.mergeStateStatus === "BLOCKED"
      ? [{ conclusion: control.statusCheckConclusion, name: "quality" }]
      : [],
  closingIssuesReferences:
    control.closingChanged || control.extraClosingIndexOnly
      ? [
          { number: 877, url: issueUrl },
          { number: 878, url: "https://github.com/o/r/issues/878" },
        ]
      : [{ number: 877, url: issueUrl }],
});

if (exact(["--version"])) {
  process.stdout.write("gh version " + control.ghVersion + "\\n");
} else if (exact(["auth", "status"])) {
  process.exitCode = 0;
} else if (
  exact(["repo", "view", "o/r", "--json", "nameWithOwner,viewerPermission"])
) {
  process.stdout.write(
    JSON.stringify({ nameWithOwner: "o/r", viewerPermission: control.viewerPermission }),
  );
} else if (exact(["api", "user", "--jq", ".node_id"])) {
  process.stdout.write("repository-owner-node-id\\n");
} else if (
  exact(["repo", "view", "o/r", "--json", "nameWithOwner,defaultBranchRef"])
) {
  process.stdout.write(
    JSON.stringify({
      nameWithOwner: "o/r",
      defaultBranchRef: { name: control.providerDefaultBranch },
    }),
  );
} else if (
  exact(["api", "repos/o/r/commits/feature%2Fx", "--jq", ".sha"])
) {
  process.stdout.write(
    (control.failCreateVerification ? "e".repeat(40) : sha) + "\\n",
  );
} else if (exact(["api", "repos/o/r/commits/main", "--jq", ".sha"])) {
  process.stdout.write(
    (control.phase === "merged"
      ? (control.postMergeTipSha ?? (control.mergeOnDefaultBranch ? mergeSha : "d".repeat(40)))
      : baseSha) + "\\n",
  );
} else if (exact(["api", "repos/o/r/commits/develop", "--jq", ".sha"])) {
  process.stdout.write(baseSha + "\\n");
} else if (args[0] === "pr" && args[1] === "create") {
  const bodyIndex = args.indexOf("--body-file");
  if (bodyIndex < 0 || !args[bodyIndex + 1]) {
    process.stderr.write("PR body file was not supplied\\n");
    process.exitCode = 64;
  } else {
    fs.writeFileSync(
      observedBody,
      fs.readFileSync(args[bodyIndex + 1], "utf8"),
    );
    process.stdout.write(prUrl + "\\n");
  }
} else if (
  args[0] === "pr" &&
  args[1] === "view" &&
  (args[2] === prUrl || args[2] === "1")
) {
  const views = fs
    .readFileSync(logFile, "utf8")
    .trim()
    .split("\\n")
    .filter((line) => {
      const logged = JSON.parse(line);
      return logged[0] === "pr" && logged[1] === "view";
    }).length;
  const value = observation();
  if (views <= control.emptyClosingViews) value.closingIssuesReferences = [];
  process.stdout.write(JSON.stringify(value));
} else if (args[0] === "api" && args[1] === "graphql") {
  if (args.some((argument) => argument.includes("query ExactPullRequests"))) {
    const graphNode = (value) => ({
      ...value,
      closingIssuesReferences: { nodes: value.closingIssuesReferences },
    });
    let pages;
    if (control.existingPr === "empty-pages") pages = [];
    else if (control.existingPr === "none" || control.existingPr === "unterminated-page") pages = [[]];
    else if (control.existingPr === "malformed-node") pages = [[{ number: 1 }]];
    else if (control.existingPr === "paged-closed") {
      const unrelated = Array.from({ length: 100 }, (_, index) =>
        graphNode({
          ...observation(),
          number: index + 1,
          url: "https://github.com/o/r/pull/" + (index + 1),
          body: "# unrelated " + (index + 1),
          state: "CLOSED",
        }),
      );
      pages = [
        unrelated,
        [
          graphNode({
            ...observation(),
            number: 101,
            url: "https://github.com/o/r/pull/101",
            state: "CLOSED",
          }),
        ],
      ];
    } else if (control.existingPr === "open-and-closed") {
      pages = [
        [
          graphNode({
            ...observation(),
            number: 1,
            url: "https://github.com/o/r/pull/1",
            state: "OPEN",
          }),
          graphNode({
            ...observation(),
            number: 2,
            url: "https://github.com/o/r/pull/2",
            state: "CLOSED",
          }),
        ],
      ];
    } else pages = [[graphNode(observation())]];
    process.stdout.write(
      JSON.stringify(
        pages.map((nodes, pageIndex) => ({
          data: {
            repository: {
              nameWithOwner: "o/r",
              pullRequests: {
                nodes,
                pageInfo: {
                  hasNextPage:
                    control.existingPr === "unterminated-page" ||
                    pageIndex < pages.length - 1,
                  endCursor:
                    control.existingPr === "unterminated-page" ||
                    pageIndex < pages.length - 1
                      ? "cursor-" + (pageIndex + 1)
                      : null,
                },
              },
            },
          },
        })),
      ),
    );
  } else if (args.some((argument) => argument.includes("query ExactReviewThreads"))) {
    process.stdout.write(JSON.stringify([{
      data: {
        repository: {
          nameWithOwner: "o/r",
          pullRequest: {
            number: 1,
            reviewThreads: {
              nodes: Array.from(
                { length: control.unresolvedReviewThreads },
                () => ({ isResolved: false }),
              ),
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    }]));
  } else {
    const entry =
      control.phase === "queue-requested"
        ? {
            id: "MQE_kwDO_test",
            state: "QUEUED",
            enqueuedAt: control.requestedAt,
            headCommit: { oid: sha },
            baseCommit: { oid: baseSha },
            pullRequest: { number: 1 },
          }
        : null;
    process.stdout.write(
      JSON.stringify({
        data: {
          repository: {
            nameWithOwner: "o/r",
            pullRequest: { number: 1, headRefOid: sha, mergeQueueEntry: entry },
          },
        },
      }),
    );
  }
} else if (
  exact(["api", "repos/o/r/branches/main/protection"])
) {
  if (control.rulesetOnly) {
    process.stderr.write("HTTP 404: Branch not protected\\n");
    process.exitCode = 1;
  } else {
    process.stdout.write("{}");
  }
} else if (
  exact([
    "api",
    "--paginate",
    "--slurp",
    "repos/o/r/rules/branches/main?per_page=100",
  ])
) {
  process.stdout.write(JSON.stringify([[
    { type: "deletion", ruleset_source_type: "Repository", ruleset_source: "o/r", ruleset_id: 1 },
    { type: "non_fast_forward", ruleset_source_type: "Repository", ruleset_source: "o/r", ruleset_id: 1 },
    ...(control.omitPullRequestRule ? [] : [{
      type: "pull_request",
      parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: true,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: true,
        require_extra_approval_for_unattributed_changes: true,
        required_reviewers: [],
        dismissal_restriction: { enabled: false, allowed_actors: [] },
        allowed_merge_methods: ["merge", "squash", "rebase"],
        ...(control.unknownRuleParameter ? { future_review_gate: true } : {}),
      },
      ruleset_source_type: "Repository",
      ruleset_source: "o/r",
      ruleset_id: 1,
    }]),
    {
      type: control.unknownBranchRule ? "required_signatures" : "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: false,
        required_status_checks: [{ context: "quality" }],
      },
      ruleset_source_type: "Repository",
      ruleset_source: "o/r",
      ruleset_id: 1,
    },
  ]]));
} else if (
  exact([
    "api",
    "--paginate",
    "--slurp",
    "repos/o/r/pulls/1/reviews?per_page=100",
  ])
) {
  process.stdout.write(
    JSON.stringify([[
      {
        id: 6,
        state: "PENDING",
        commit_id: null,
        user: { node_id: "draft-reviewer" },
        submitted_at: null,
      },
      ...(control.reviewDisposition === "none"
        ? []
        : [{
            id: 7,
            state: "APPROVED",
            commit_id:
              control.reviewCommitSha === "stale" ? "0".repeat(40) : sha,
            user: { node_id: control.reviewerId },
            submitted_at: control.requestedAt,
          }]),
      // merge後にprovider側のreview状態が動いた場合（Issue #1280）。
      ...(control.phase === "merged" && control.postMergeReviewShift === "replaced"
        ? [{
            id: 5,
            state: "APPROVED",
            commit_id: sha,
            user: { node_id: "independent-reviewer-2" },
            submitted_at: control.requestedAt,
          }]
        : []),
      ...(control.phase === "merged" && control.postMergeReviewShift === "revoked"
        ? [{
            id: 9,
            state: "CHANGES_REQUESTED",
            commit_id: sha,
            user: { node_id: control.reviewerId },
            submitted_at: new Date(Date.parse(control.requestedAt) + 2000).toISOString(),
          }]
        : []),
      ...(control.reviewDisposition !== "approved" && control.reviewDisposition !== "none"
        ? [{
            id: 8,
            state: control.reviewDisposition === "changes-requested"
              ? "CHANGES_REQUESTED"
              : "COMMENTED",
            commit_id: sha,
            user: { node_id: control.reviewerId },
            submitted_at: new Date(Date.parse(control.requestedAt) + 1000).toISOString(),
          }]
        : []),
    ]]),
  );
} else if (args[0] === "issue" && args[1] === "edit") {
  // Issue同期の実CLI経路（Issue #1320）。本文を保存して読み返すだけにし、
  // GitHub固有の正規化は模さない。
  const index = args.indexOf("--body-file");
  fs.writeFileSync(issueBodyFile, fs.readFileSync(args[index + 1], "utf8"));
  if (control.mutateIssueBodyAfterEdit === "drop-final-lf") {
    const saved = fs.readFileSync(issueBodyFile, "utf8");
    fs.writeFileSync(issueBodyFile, saved.endsWith("\\n") ? saved.slice(0, -1) : saved);
  }
  if (control.failIssueReadBackAfterEditOnce) {
    control.failIssueReadBackAfterEditOnce = false;
    control.failNextIssueView = true;
    fs.writeFileSync(controlFile, JSON.stringify(control) + "\\n");
  }
} else if (args[0] === "issue" && args[1] === "view") {
  const issueViewCount = fs.existsSync(issueViewCountFile)
    ? Number(fs.readFileSync(issueViewCountFile, "utf8")) + 1
    : 1;
  fs.writeFileSync(issueViewCountFile, String(issueViewCount));
  if (control.failNextIssueView) {
    control.failNextIssueView = false;
    fs.writeFileSync(controlFile, JSON.stringify(control) + "\\n");
    process.stderr.write("simulated issue read-back failure\\n");
    process.exit(1);
  }
  if (control.concurrentIssueEditAtAdapterCas && issueViewCount === 4)
    fs.writeFileSync(issueBodyFile, "# concurrent edit\\n");
  process.stdout.write(JSON.stringify({
    body: fs.existsSync(issueBodyFile) ? fs.readFileSync(issueBodyFile, "utf8") : "",
  }) + "\\n");
} else if (exact(["api", "repos/o/r/actions/runs/42"])) {
  // merge後の固定run ID直読み。pull_requests はPRが閉じると空になる実仕様を保つ。
  process.stdout.write(
    JSON.stringify({
      id: 42,
      repository: { full_name: "o/r" },
      head_repository: { full_name: "o/r" },
      event: "pull_request",
      head_sha: sha,
      head_branch: "feature/x",
      status: "completed",
      conclusion: control.fixedRunConclusion,
      pull_requests: control.phase === "merged" ? [] : [{ number: 1 }],
    }),
  );
} else if (
  args[0] === "api" &&
  args[1] === "--paginate" &&
  args[2] === "--slurp" &&
  String(args[3] || "").startsWith("repos/o/r/actions/runs?")
) {
  process.stdout.write(
    JSON.stringify([{
      workflow_runs: [{
        id: 42,
        repository: { full_name: "o/r" },
        event: "pull_request",
        head_sha: sha,
        conclusion: "success",
        // 実GitHubの仕様を再現する。pull_requests は「現在openで同一headを持つ
        // same-repo PR」の一覧であり、PRが閉じた瞬間に空になる（Issue #1280で実測）。
        // mergedでも埋まったままにすると、merge後のread-backが実環境で必ず失敗する
        // 欠陥を検査が見逃す。
        // merge前は control で操作する。空や別PRを許すとdispatch可能集合が増える。
        pull_requests: control.phase === "merged"
          ? []
          : control.preMergeRunPullRequests === "empty"
            ? []
            : control.preMergeRunPullRequests === "other"
              ? [{ number: 2 }]
              : [{ number: 1 }],
      }],
    }]),
  );
} else if (exact(["api", "repos/o/r/commits/" + implementationSha])) {
  process.stdout.write(
    JSON.stringify({
      sha: implementationSha,
      author: control.implementationAuthorId === null
        ? {}
        : { node_id: control.implementationAuthorId },
    }),
  );
} else if (exact(["api", "repos/o/r/commits/" + rebasedImplementationSha])) {
  process.stdout.write(
    JSON.stringify({
      sha: rebasedImplementationSha,
      commit: { tree: { sha: control.mergeTreeSha } },
      parents: [{ sha: control.terminalParentTampered ? "e".repeat(40) : baseSha }],
    }),
  );
} else if (exact(["api", "repos/o/r/commits/" + mergeSha])) {
  const parents = control.autoMergeMethod === "MERGE"
    ? (control.mergeParentsSwapped ? [{ sha }, { sha: baseSha }] : [{ sha: baseSha }, { sha }])
    : [{ sha: control.autoMergeMethod === "REBASE"
      ? rebasedImplementationSha
      : control.terminalParentTampered
        ? "e".repeat(40)
        : baseSha }];
  process.stdout.write(
    JSON.stringify({
      sha: mergeSha,
      commit: {
        tree: {
          sha: control.mergeTreeTampered
            ? "c".repeat(40)
            : control.mergeTreeSha,
        },
      },
      parents,
    }),
  );
} else if (
  args[0] === "api" &&
  String(args[1] || "") ===
    "repos/o/r/compare/" + baseSha + "..." + mergeSha
) {
  process.stdout.write(
    JSON.stringify({
      status: "ahead",
      base_commit: { sha: baseSha },
      merge_base_commit: { sha: baseSha },
    }),
  );
} else if (
  args[0] === "api" &&
  String(args[1] || "").startsWith("repos/o/r/compare/" + mergeSha + "...")
) {
  const descendant = control.mergeOnDefaultBranch ? mergeSha : "d".repeat(40);
  process.stdout.write(
    JSON.stringify({
      status: control.mergeOnDefaultBranch ? "identical" : "diverged",
      base_commit: { sha: mergeSha },
      merge_base_commit: {
        sha: control.mergeOnDefaultBranch ? mergeSha : baseSha,
      },
      descendant,
    }),
  );
} else if (args[0] === "pr" && args[1] === "merge" && args[2] === "1") {
  const requestedAt = mergeRequestedAt;
  fs.writeFileSync(
    controlFile,
    JSON.stringify({
      ...control,
      phase: control.mergeImmediately
        ? "merged"
        : control.queueOnMerge
          ? "queue-requested"
          : "merge-requested",
      failMerge: false,
      requestedAt,
      mergedAt: control.mergeImmediately
        ? new Date(Date.parse(requestedAt) + 1000).toISOString()
        : control.mergedAt,
    }) +
      "\\n",
  );
  if (control.failMerge) {
    process.stderr.write("simulated uncertain merge response\\n");
    process.exitCode = 70;
  }
} else {
  process.stderr.write("Unexpected gh invocation: " + JSON.stringify(args) + "\\n");
  process.exitCode = 64;
}
`,
  );
  fs.chmodSync(stub, 0o755);
  return {
    ...prepared,
    controlFile,
    logFile,
    issueBodyFile,
    env: {
      ...process.env,
      PATH: `${stubDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  };
}

/** 拒否後のfixture共有は永続stateとjournalがbyte不変の場合だけ成立する。 */
function deliveryPersistence(prepared: PreparedDeliveryCli): readonly string[] {
  return [DELIVERY_STATE_FILE, STEP_JOURNAL_FILE].map((relative) =>
    fs.readFileSync(path.join(prepared.staging, relative), "utf8"),
  );
}

function createDeliveryPullRequest(prepared: PreparedDeliveryCli) {
  const result = executeCli(
    [...prepared.args, "--apply", "--authorize=approved"],
    prepared.root,
    prepared.env,
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result;
}

/**
 * merge-base-audit攻撃fixtureの実装commitを作る（Issue #1495）。
 *
 * `baseSha`(T)を検分中に既定branchが`advancedBaseSha`(M)へ前進し、candidateが
 * Mをmergeしてから即座に同じ変更を打ち消す、という実際のgraph形状を作る。
 *
 * 1. `baseSha`から独立したbranchでMを作る（`advanceFile`を追加した1 commit）
 * 2. 元のbranchへ戻り、通常の`implementation.txt`commit（=C）を積む
 * 3. Mを`--no-ff`でmergeする（2親、tree = Cのtree + advanceFile）
 * 4. `advanceFile`を取り除くcommitを積む（treeがCのtreeへ厳密に戻る）
 *
 * 結果として最終commitのbaseSha(T)からの差分はCと1byteも変わらない
 * （review evidenceの`diffDigest`は不変のまま）が、`git merge-base`はM自身に
 * 前進する。`refs/remotes/origin/main`もMへ更新するので、呼び出し側は
 * `advancedBaseSha`を`prepareDeliveryCli`のcontrol（`remoteBaseSha`）へ
 * 反映させるだけでよい。
 */
function buildDefaultBranchMergeRevertAttack(
  root: string,
  baseSha: string,
  options: { advanceFile?: string; advanceBranch?: string } = {},
): { advancedBaseSha: string; implementationCommitSha: string } {
  const advanceFile = options.advanceFile ?? "downstream-guard.txt";
  const advanceBranch = options.advanceBranch ?? "asc-1495-advance";
  const run = (args: string[]): string => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
    return result.stdout.trim();
  };
  const originalBranch = run(["symbolic-ref", "--short", "HEAD"]);
  run(["checkout", "-q", "-b", advanceBranch, baseSha]);
  fs.writeFileSync(
    path.join(root, advanceFile),
    "default branch advance (Issue #1495 attack fixture)\n",
  );
  run(["add", "--", advanceFile]);
  run([
    "commit",
    "-q",
    "-m",
    "default branch advance (Issue #1495 attack fixture)",
  ]);
  const advancedBaseSha = run(["rev-parse", "HEAD"]);
  run(["update-ref", "refs/remotes/origin/main", advancedBaseSha]);
  run(["checkout", "-q", originalBranch]);
  fs.writeFileSync(path.join(root, "implementation.txt"), "product change\n");
  run(["add", "implementation.txt"]);
  run(["commit", "-q", "-m", "implementation"]);
  run([
    "merge",
    "--no-ff",
    "-q",
    advanceBranch,
    "-m",
    "merge default branch advance (Issue #1495 attack fixture)",
  ]);
  run(["rm", "-q", "--", advanceFile]);
  run([
    "commit",
    "-q",
    "-m",
    "revert default branch file (Issue #1495 attack fixture)",
  ]);
  const implementationCommitSha = run(["rev-parse", "HEAD"]);
  run(["branch", "-D", advanceBranch]);
  return { advancedBaseSha, implementationCommitSha };
}

/**
 * PR create後、既存の`parentSha`（H_impl）へ同型のmerge-revert攻撃を積み、rebase
 * 経路の再固定用に新しいH_final（review evidence 1件だけを加えた単一親commit）
 * まで作る（Issue #1495、AC-004）。branchのcurrent HEADは動かさず、最後に
 * `originalRef`を新H_finalへ強制的に進める（`resolveImplementationCommitForMerge`が
 * current HEADと申告headの一致を要求するため）。
 *
 * `oldEvidence`は書き換え前のreview evidenceオブジェクトであり、新評価は
 * `resealObservedEvidence(oldEvidence, {implementationHeadSha})`で作る。
 * 比較基点・reviewer・implementer・session・diffDigestは変えないため、
 * `evaluateEvidenceReanchor`の`rebase`等価性判定（`comparableReviewEvidence`）が
 * 素通りする。
 */
function buildRebaseMergeRevertAttack(
  root: string,
  input: {
    parentSha: string;
    baseSha: string;
    oldEvidence: ReviewEvidence;
    artifactPath: string;
  },
  options: { advanceFile?: string; advanceBranch?: string } = {},
): {
  advancedBaseSha: string;
  implementationCommitSha: string;
  finalHeadSha: string;
} {
  const advanceFile = options.advanceFile ?? "downstream-guard.txt";
  const advanceBranch = options.advanceBranch ?? "asc-1495-rebase-advance";
  const run = (args: string[]): string => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
    return result.stdout.trim();
  };
  const originalRef = run(["symbolic-ref", "--short", "HEAD"]);
  run(["checkout", "-q", "-b", advanceBranch, input.baseSha]);
  fs.writeFileSync(
    path.join(root, advanceFile),
    "default branch advance (Issue #1495 attack fixture)\n",
  );
  run(["add", "--", advanceFile]);
  run([
    "commit",
    "-q",
    "-m",
    "default branch advance (Issue #1495 attack fixture)",
  ]);
  const advancedBaseSha = run(["rev-parse", "HEAD"]);
  run(["update-ref", "refs/remotes/origin/main", advancedBaseSha]);
  run(["checkout", "-q", "--detach", input.parentSha]);
  run([
    "merge",
    "--no-ff",
    "-q",
    advanceBranch,
    "-m",
    "merge default branch advance (Issue #1495 attack fixture)",
  ]);
  run(["rm", "-q", "--", advanceFile]);
  run([
    "commit",
    "-q",
    "-m",
    "revert default branch file (Issue #1495 attack fixture)",
  ]);
  const implementationCommitSha = run(["rev-parse", "HEAD"]);
  const newContent = resealObservedEvidence(input.oldEvidence, {
    implementationHeadSha: implementationCommitSha,
  });
  const artifactFile = path.join(root, input.artifactPath);
  fs.mkdirSync(path.dirname(artifactFile), { recursive: true });
  fs.writeFileSync(artifactFile, newContent);
  run(["add", "--", input.artifactPath]);
  run(["commit", "-q", "-m", "review evidence (Issue #1495 attack fixture)"]);
  const finalHeadSha = run(["rev-parse", "HEAD"]);
  run(["checkout", "-q", "-B", originalRef, finalHeadSha]);
  run(["branch", "-D", advanceBranch]);
  return { advancedBaseSha, implementationCommitSha, finalHeadSha };
}

/**
 * **同一round内の部分的hunk revert攻撃（Issue #1495、round 3独立reviewの
 * High指摘。SCN-MERGE-BASE-AUDIT-010専用、`buildDefaultBranchMergeRevertAttack`
 * とは意図的に異なる形状）。**
 *
 * `buildDefaultBranchMergeRevertAttack`は既定branchが**新しいfile丸ごと**を
 * 追加し、candidateがその**file全体**を取り除いて打ち消す。この場合、
 * `T..H_impl`のchanged-path集合にも`M..H_impl`のchanged-path集合にも
 * `downstream-guard.txt`という同じpathが現れるため、path集合の突合だけでも
 * 検出できてしまう——**このpathが「一度も現れない」ことを検出する旧設計が
 * 通っていた理由そのものである。**
 *
 * この関数はそれとは異なる、より狭い形状を作る。**既定branchの前進もcandidate
 * 自身の正当な変更も、同じ既存file `shared.txt`の別々の行（別々のhunk）を
 * 変更する。** candidateはMをmergeしたのち、M由来のhunkだけを厳密に
 * revertし、自分のhunkはそのまま残す。結果として:
 *
 * - `T..H_impl`（round 1が実際にreviewした範囲）には、candidate自身のhunkの
 *   変更**だけ**が現れる（Mのhunkは merge→revert でnetが0になり、この範囲では
 *   一度も変化していないように見える）。
 * - しかし`M..H_impl`（実際の`merge-base`から見た範囲）には**両方の**hunkの
 *   変更が現れる——`shared.txt`というpath自体は両方の範囲に共通して現れるため
 *   （path集合はどちらも`{shared.txt}`で完全に一致する）、changed-path部分集合
 *   検査は素通りする。**content（diff digest）を実際に再計算して比較する
 *   gateだけがこの非対称性を検出できる。**
 */
function buildPartialHunkRevertAttack(
  root: string,
  baseSha: string,
  options: { advanceBranch?: string } = {},
): { advancedBaseSha: string; implementationCommitSha: string } {
  const sharedFile = "shared.txt";
  const advanceBranch = options.advanceBranch ?? "asc-1495-hunk-advance";
  const run = (args: string[]): string => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
    return result.stdout.trim();
  };
  const sharedFilePath = path.join(root, sharedFile);
  const originalLines = [
    "line1 original",
    "line2 original",
    "line3 original",
    "line4 original",
    "line5 original",
  ];
  const originalBranch = run(["symbolic-ref", "--short", "HEAD"]);
  // T2: baseSha（T）の直接の子として、両側が分岐する前にsharedFileを置く。
  // T2自体はT..H_implの正当なreviewed diffの一部（fileの新規追加）になる。
  run(["checkout", "-q", "-B", originalBranch, baseSha]);
  fs.writeFileSync(sharedFilePath, `${originalLines.join("\n")}\n`);
  run(["add", "--", sharedFile]);
  run(["commit", "-q", "-m", "shared.txt baseline (Issue #1495 fixture)"]);
  const sharedBaseline = run(["rev-parse", "HEAD"]);
  // 既定branchの前進（M）: line2だけを書き換える（downstream由来のhunk）。
  run(["checkout", "-q", "-b", advanceBranch, sharedBaseline]);
  const advancedLines = [...originalLines];
  advancedLines[1] = "line2 changed-by-default-branch-advance";
  fs.writeFileSync(sharedFilePath, `${advancedLines.join("\n")}\n`);
  run(["add", "--", sharedFile]);
  run([
    "commit",
    "-q",
    "-m",
    "default branch advance: hunk on line2 (Issue #1495 fixture)",
  ]);
  const advancedBaseSha = run(["rev-parse", "HEAD"]);
  run(["update-ref", "refs/remotes/origin/main", advancedBaseSha]);
  // candidate自身の正当な変更: line4だけを書き換える（Mのhunkとは別のhunk）。
  run(["checkout", "-q", originalBranch]);
  const candidateLines = [...originalLines];
  candidateLines[3] = "line4 changed-by-candidate (legitimate)";
  fs.writeFileSync(sharedFilePath, `${candidateLines.join("\n")}\n`);
  run(["add", "--", sharedFile]);
  run([
    "commit",
    "-q",
    "-m",
    "candidate change: hunk on line4 (Issue #1495 fixture)",
  ]);
  // Mを取り込む（--no-ff）。この時点でline2・line4の両方の変更が同居する。
  run([
    "merge",
    "--no-ff",
    "-q",
    advanceBranch,
    "-m",
    "merge default branch advance (Issue #1495 fixture)",
  ]);
  const merged = fs.readFileSync(sharedFilePath, "utf8");
  const expectedMerged = [...originalLines];
  expectedMerged[1] = advancedLines[1]!;
  expectedMerged[3] = candidateLines[3]!;
  assert.equal(
    merged,
    `${expectedMerged.join("\n")}\n`,
    "mergeがline2・line4の両方の変更を素直に取り込んでいません",
  );
  // Mが導入したhunk（line2）だけを厳密にrevertする。line4は残す。
  const revertedLines = [...candidateLines];
  revertedLines[1] = originalLines[1]!;
  fs.writeFileSync(sharedFilePath, `${revertedLines.join("\n")}\n`);
  run(["add", "--", sharedFile]);
  run([
    "commit",
    "-q",
    "-m",
    "revert only the M-introduced hunk on line2 (Issue #1495 attack fixture)",
  ]);
  const implementationCommitSha = run(["rev-parse", "HEAD"]);
  run(["branch", "-D", advanceBranch]);
  // fixtureの前提を実Gitで検算する: T..H_implのpath集合とM..H_implのpath集合が
  // 完全に一致すること（どちらも{shared.txt}）——これが「path集合の突合だけでは
  // 検出できない」ことの直接証拠であり、そうでなければこのfixtureは
  // SCN-MERGE-BASE-AUDIT-001と同じ「新規path」型に戻ってしまっている。
  const pathsFromReviewedBase = run([
    "diff",
    "--name-only",
    baseSha,
    implementationCommitSha,
  ])
    .split("\n")
    .filter(Boolean)
    .sort();
  const pathsFromActualBase = run([
    "diff",
    "--name-only",
    advancedBaseSha,
    implementationCommitSha,
  ])
    .split("\n")
    .filter(Boolean)
    .sort();
  assert.deepEqual(
    pathsFromReviewedBase,
    [sharedFile],
    "fixtureの前提: T..H_implのchanged pathはshared.txtだけのはず",
  );
  assert.deepEqual(
    pathsFromActualBase,
    [sharedFile],
    "fixtureの前提: M..H_implのchanged pathもshared.txtだけのはず（path集合は" +
      "T..H_implと完全に一致し、path集合突合だけでは区別できないはず）",
  );
  // T2（shared.txtが最初に存在する共通祖先）..H_implのnet diffに、Mが導入した
  // 変更値（"changed-by-default-branch-advance"）が一度も現れないこと（round 1が
  // honestに見て「line4だけが変わった」と結論づけられる、この攻撃の核心）を
  // 検算する。T..H_implの範囲全体で見るとshared.txt自体が新規fileとして丸ごと
  // 現れるため（Tにはfileが無い）、この検算はより狭いT2..H_implの範囲で行う
  // 必要がある——round 1のreviewerが実際に目にする最終行はT..H_implの範囲でも
  // 変わらないが、「Mのhunkが一度も見えない」という主張自体はT2..H_implの範囲で
  // しか意味を持たない。
  const reviewedDiff = run([
    "diff",
    sharedBaseline,
    implementationCommitSha,
    "--",
    sharedFile,
  ]);
  assert.doesNotMatch(
    reviewedDiff,
    /changed-by-default-branch-advance/u,
    "fixtureの前提: T2..H_implの差分にMが導入した変更値が一度も現れないはず" +
      "（Mのhunkがnetで0になっていない）",
  );
  assert.match(
    reviewedDiff,
    /line4/u,
    "fixtureの前提: T..H_implの差分にcandidate自身のline4変更が現れるはず",
  );
  return { advancedBaseSha, implementationCommitSha };
}

/** provider既定branchをHEADと親子関係のないexact commitへ進める。 */
function divergeDeliveryBase(prepared: PreparedDeliveryCli): string {
  const tree = spawnSync("git", ["rev-parse", `${prepared.baseSha}^{tree}`], {
    cwd: prepared.root,
    encoding: "utf8",
  }).stdout.trim();
  const parent = spawnSync("git", ["rev-parse", `${prepared.baseSha}^`], {
    cwd: prepared.root,
    encoding: "utf8",
  }).stdout.trim();
  const created = spawnSync(
    "git",
    ["commit-tree", tree, "-p", parent, "-m", "parallel base advance"],
    { cwd: prepared.root, encoding: "utf8" },
  );
  assert.equal(created.status, 0, created.stderr);
  const advanced = created.stdout.trim();
  spawnSync("git", ["update-ref", "refs/remotes/origin/main", advanced], {
    cwd: prepared.root,
  });
  const control = JSON.parse(
    fs.readFileSync(prepared.controlFile, "utf8"),
  ) as DeliveryProviderControl;
  fs.writeFileSync(
    prepared.controlFile,
    `${JSON.stringify({ ...control, remoteBaseSha: advanced })}\n`,
  );
  return advanced;
}

/** `merge-base --all`だけをGit実行失敗にして比較不能を再現する。 */
function failDeliveryAncestryComparison(prepared: PreparedDeliveryCli): void {
  const stubDirectory = (prepared.env.PATH ?? "").split(path.delimiter)[0];
  assert.ok(stubDirectory);
  const realGit = spawnSync("which", ["git"], {
    encoding: "utf8",
  }).stdout.trim();
  assert.ok(realGit);
  const stub = path.join(stubDirectory, "git");
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
if (args[0] === "merge-base" && args[1] === "--all") {
  process.stderr.write("simulated incomparable Git objects\\n");
  process.exitCode = 128;
} else {
  const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: "inherit" });
  process.exitCode = result.status ?? 70;
}
`,
  );
  fs.chmodSync(stub, 0o755);
}

/** Step 4欠落を作り、既存review bindingを保ったHumanOverride経路を検査する。 */
function removeDeliveryStep4(prepared: PreparedDeliveryCli): string {
  const journalFile = path.join(prepared.staging, STEP_JOURNAL_FILE);
  /** Step 4を欠く手書きjournalは旧journal（hash chainなし）として作る */
  const entries = unchainedJournalText(journalFile)
    .trimEnd()
    .split("\n")
    .filter((line) => (JSON.parse(line) as { step: number }).step !== 4);
  fs.writeFileSync(journalFile, `${entries.join("\n")}\n`);
  refreshStoredStagingDigest(prepared.staging);
  return journalFile;
}

function deliveryMergeArgs(
  prepared: PreparedDeliveryCli,
  overrides: {
    pr?: number;
    root?: string;
    staging?: string;
    method?: "merge" | "squash" | "rebase";
    reopenTerminal?: boolean;
    authorize?: boolean;
  } = {},
): string[] {
  const root = overrides.root ?? prepared.root;
  const staging = overrides.staging ?? prepared.staging;
  const stagingArgument = path.isAbsolute(staging)
    ? path.relative(root, staging)
    : staging;
  return [
    "pr",
    "merge",
    "--repo=o/r",
    `--pr=${overrides.pr ?? 1}`,
    `--method=${overrides.method ?? "merge"}`,
    `--root=${root}`,
    `--staging=${stagingArgument}`,
    "--apply",
    ...(overrides.reopenTerminal ? ["--reopen-terminal=approved"] : []),
    ...(overrides.authorize === true ? ["--authorize=approved"] : []),
  ];
}

function executeDeliveryMerge(
  prepared: PreparedDeliveryCli,
  overrides: {
    pr?: number;
    root?: string;
    staging?: string;
    method?: "merge" | "squash" | "rebase";
    reopenTerminal?: boolean;
    authorize?: boolean;
  } = {},
) {
  return executeCli(
    deliveryMergeArgs(prepared, overrides),
    prepared.root,
    prepared.env,
  );
}

function completeDeliveryMerge(prepared: PreparedDeliveryCli) {
  createDeliveryPullRequest(prepared);
  const requested = executeDeliveryMerge(prepared);
  assert.equal(requested.status, 0, requested.stdout + requested.stderr);
  const mergedAt = fixtureInstant({ minutesAhead: 5 });
  writeDeliveryProviderControl(prepared, { phase: "merged", mergedAt });
  const completed = executeDeliveryMerge(prepared);
  assert.equal(completed.status, 0, completed.stdout + completed.stderr);
  return completed;
}

function rewriteStep11Journal(
  prepared: PreparedDeliveryCli,
  disposition: "remove" | "modify",
): void {
  const journalFile = path.join(prepared.staging, STEP_JOURNAL_FILE);
  const lines = fs.readFileSync(journalFile, "utf8").trimEnd().split("\n");
  let found = false;
  const rewritten = lines.flatMap((line) => {
    const value = JSON.parse(line) as StepJournalEntry;
    if (value.step !== 11) return [line];
    found = true;
    if (disposition === "remove") return [];
    return [
      JSON.stringify({
        ...value,
        evidence: `${value.evidence} 改変済み`,
      }),
    ];
  });
  assert.equal(found, true, "改変対象のStep 11 entryがありません");
  fs.writeFileSync(journalFile, `${rewritten.join("\n")}\n`);
  refreshStoredStagingDigest(prepared.staging);
}

/**
 * ASC外でmergeされたPRのfixture（Issue #1569、SCN-E2E-EXTMERGE-*）。
 *
 * `pr create`でpr-boundにしてから、providerだけをmerged（2親merge commit）へ進める。
 * mergedAtはfixture clockより先に置き、Step 11記録時刻の下限がprovider mergedAtになる
 * 経路を通す。
 */
function prepareExternallyMergedPullRequest(
  world: WorkflowStepWorld,
  mergeMode: FixtureMergeMode = "automatic",
): PreparedDeliveryCli {
  const prepared = prepareDeliveryCli(world, {}, mergeMode);
  createDeliveryPullRequest(prepared);
  return prepared;
}

function markExternallyMerged(
  prepared: PreparedDeliveryCli,
  patch: Partial<DeliveryProviderControl> = {},
): void {
  writeDeliveryProviderControl(prepared, {
    phase: "merged",
    mergedAt: fixtureInstant({ minutesAhead: 5 }),
    ...patch,
  });
}

function executeExternalMergeImport(
  prepared: PreparedDeliveryCli,
  mode: "--dry-run" | "--apply",
  pr = 1,
) {
  return executeCli(
    [
      "pr",
      "record-external-merge",
      "--repo=o/r",
      `--pr=${pr}`,
      `--root=${prepared.root}`,
      `--staging=${path.relative(prepared.root, prepared.staging)}`,
      mode,
    ],
    prepared.root,
    prepared.env,
  );
}

interface ExternalMergeOutput {
  state: string;
  checks?: Array<{ id: string; ok: boolean; reason?: string }>;
  observation?: { observationId: string; defaultBranchTipSha: string };
  deliveryState?: DeliveryState;
}

function stagingBytes(staging: string): string {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      if (fs.lstatSync(file).isDirectory()) walk(file);
      else
        files.push(
          `${path.relative(staging, file)}:${crypto
            .createHash("sha256")
            .update(fs.readFileSync(file))
            .digest("hex")}`,
        );
    }
  };
  walk(staging);
  return files.join("\n");
}

function journalStep11Entries(staging: string): StepJournalEntry[] {
  return parseStepJournal(
    fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE), "utf8"),
  ).entries.filter((item) => item.step === 11);
}

function readFixtureDeliveryState(staging: string): DeliveryState {
  return parseDeliveryState(
    fs.readFileSync(
      path.join(staging, ...DELIVERY_STATE_FILE.split("/")),
      "utf8",
    ),
  );
}

/** 1項目だけ壊したfixtureで取り込みを拒否させ、名指しとbyte不変を確かめる。 */
function assertExternalMergeRejected(
  prepared: PreparedDeliveryCli,
  checkId: string,
  reason: RegExp | undefined,
  pr = 1,
): void {
  const before = stagingBytes(prepared.staging);
  const rejected = executeExternalMergeImport(prepared, "--apply", pr);
  assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
  const output = JSON.parse(rejected.stdout) as ExternalMergeOutput;
  assert.equal(output.state, "rejected");
  assert.deepEqual(
    output.checks?.map((check) => check.id),
    [
      "binding",
      "merged",
      "default-branch",
      "trusted-policy",
      "reachable",
      "method",
      "delivery",
    ],
  );
  const named = output.checks?.find((check) => check.id === checkId);
  assert.equal(named?.ok, false, rejected.stdout);
  if (reason) assert.match(named?.reason ?? "", reason);
  assert.equal(stagingBytes(prepared.staging), before);
}

function runExternalMergeAcceptance(world: WorkflowStepWorld): void {
  const prepared = prepareExternallyMergedPullRequest(world);
  markExternallyMerged(prepared);
  const beforePreview = stagingBytes(prepared.staging);
  const preview = executeExternalMergeImport(prepared, "--dry-run");
  assert.equal(preview.status, 0, preview.stdout + preview.stderr);
  const previewed = JSON.parse(preview.stdout) as ExternalMergeOutput;
  assert.equal(previewed.state, "preview");
  assert.equal(
    previewed.checks?.every((check) => check.ok),
    true,
    preview.stdout,
  );
  assert.equal(stagingBytes(prepared.staging), beforePreview);
  const deliveryFile = path.join(
    prepared.staging,
    ...DELIVERY_STATE_FILE.split("/"),
  );
  const boundSource = fs.readFileSync(deliveryFile);

  const applied = executeExternalMergeImport(prepared, "--apply");
  assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  const recorded = JSON.parse(applied.stdout) as ExternalMergeOutput;
  assert.equal(recorded.state, "recorded");
  const observationId = recorded.observation?.observationId ?? "";
  assert.match(observationId, /^[a-f0-9]{64}$/u);
  const [step11] = journalStep11Entries(prepared.staging);
  assert.equal(journalStep11Entries(prepared.staging).length, 1);
  for (const fragment of [
    "outcome=merged",
    `external-merge observation ${observationId}`,
    `mergeCommit=${"b".repeat(40)}`,
    `HEAD=${prepared.headSha}`,
    "method=merge",
  ])
    assert.ok(step11?.evidence.includes(fragment), step11?.evidence);
  const delivered = readFixtureDeliveryState(prepared.staging);
  assert.equal(delivered.state, "step11-recorded");
  assert.equal(delivered.merge, null);
  assert.equal(delivered.step11?.outcome, "merged");
  assert.equal(delivered.step11?.evidenceId, observationId);
  assert.equal(delivered.externalMerge?.observationId, observationId);
  assert.equal(delivered.externalMerge?.mergeCommitSha, "b".repeat(40));
  /**
   * 外部merge観測の形状検査: 終端以外へ`externalMerge`を持たせた状態と、Step 11時刻が
   * provider mergedAt・PR bind時刻より前の状態をparseが拒否する（02 §4.1）。
   */
  const recordedExternal = delivered.externalMerge!;
  const earlierMergedAt = new Date(
    Date.parse(delivered.pr!.boundAt) - 2000,
  ).toISOString();
  const earlierExternal = {
    ...recordedExternal,
    providerMergedAt: earlierMergedAt,
    observationId: externalMergeObservationId({
      ...recordedExternal,
      providerMergedAt: earlierMergedAt,
    }),
  };
  for (const [tampered, diagnostic] of [
    [
      { ...delivered, state: "pr-bound", step11: null },
      /externalMergeはmerge intentもredeliveryも無いmerged終端だけが持てます/u,
    ],
    [
      {
        ...delivered,
        step11: {
          ...delivered.step11!,
          recordedAt: new Date(
            Date.parse(recordedExternal.providerMergedAt) - 1,
          ).toISOString(),
        },
      },
      /step11\.recordedAtは先行event/u,
    ],
    [
      {
        ...delivered,
        externalMerge: earlierExternal,
        step11: {
          ...delivered.step11!,
          evidenceId: earlierExternal.observationId,
          recordedAt: new Date(
            Date.parse(delivered.pr!.boundAt) - 1000,
          ).toISOString(),
        },
      },
      /step11\.recordedAtは先行event/u,
    ],
  ] as const)
    assert.throws(
      () => parseDeliveryState(JSON.stringify(tampered)),
      diagnostic,
    );

  /**
   * 中断復旧（02 §10 (4)）: journal追記後・delivery書込前の状態へ戻し、既定branch tipを
   * 1 commit前進させてから再applyしてもStep 11は1件のままobservationIdが変わらない。
   */
  fs.writeFileSync(deliveryFile, boundSource);
  refreshStoredStagingDigest(prepared.staging);
  writeDeliveryProviderControl(prepared, { postMergeTipSha: "a".repeat(40) });
  const resumed = executeExternalMergeImport(prepared, "--apply");
  assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
  const resumedOutput = JSON.parse(resumed.stdout) as ExternalMergeOutput;
  assert.equal(resumedOutput.state, "recorded");
  assert.equal(resumedOutput.observation?.observationId, observationId);
  assert.equal(resumedOutput.observation?.defaultBranchTipSha, "a".repeat(40));
  assert.equal(journalStep11Entries(prepared.staging).length, 1);

  const advanced = executeCli(
    ["workflow", "advance", `--staging=${prepared.staging}`],
    prepared.root,
    prepared.env,
  );
  assert.equal(advanced.status, 0, advanced.stdout + advanced.stderr);
  assert.match(advanced.stdout, /"state": "complete"/u);
  const verified = executeCli(
    ["workflow", "verify", `--staging=${prepared.staging}`],
    prepared.root,
    prepared.env,
  );
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  assert.match(verified.stdout, /"valid": true/u);

  const callsBefore = deliveryProviderCalls(prepared).length;
  const beforeRepeat = stagingBytes(prepared.staging);
  const repeated = executeExternalMergeImport(prepared, "--apply");
  assert.equal(repeated.status, 0, repeated.stdout + repeated.stderr);
  assert.equal(
    (JSON.parse(repeated.stdout) as ExternalMergeOutput).state,
    "already-recorded",
  );
  assert.equal(deliveryProviderCalls(prepared).length, callsBefore);
  assert.equal(stagingBytes(prepared.staging), beforeRepeat);
  assert.equal(journalStep11Entries(prepared.staging).length, 1);
  const forged = executeCli(
    [
      "workflow",
      "record",
      `--staging=${prepared.staging}`,
      "--step=11",
      "--artifact=https://github.com/o/r/pull/1",
      "--evidence=forged terminal",
    ],
    prepared.root,
    prepared.env,
  );
  assert.notEqual(forged.status, 0);
  assert.match(forged.stdout + forged.stderr, /delivery終端専用/u);
}

/** SCN-E2E-EXTMERGE-002の例ごとに1項目だけを壊す（02 §10の支援層縮小）。 */
function runExternalMergeMismatch(
  world: WorkflowStepWorld,
  example: string,
): void {
  if (example === "Step 11が記録されていない") {
    const terminal = prepareExternallyMergedPullRequest(world, "disabled");
    assert.equal(
      readFixtureDeliveryState(terminal.staging).step11?.outcome,
      "pull-request",
    );
    markExternallyMerged(terminal);
    assertExternalMergeRejected(terminal, "delivery", /Step 11が記録済み/u);
    /**
     * journalにだけ別経路のStep 11がある`pr-bound`（PR停止終端の中断状態）も、
     * 外部merge取り込みの中断復旧と取り違えずに拒否する。他の6項目は一致させる。
     */
    const interrupted = prepareExternallyMergedPullRequest(world);
    appendDeliveryTerminalJournalEntry({
      staging: interrupted.staging,
      entry: {
        ...entry(11),
        artifacts: ["https://github.com/o/r/pull/1", DELIVERY_STATE_FILE],
        evidence: "outcome=pull-request evidence=別経路の停止終端",
      },
    });
    markExternallyMerged(interrupted);
    assertExternalMergeRejected(interrupted, "delivery", /Step 11が記録済み/u);
    return;
  }
  const prepared = prepareExternallyMergedPullRequest(world);
  const cases: Record<
    string,
    {
      patch: Partial<DeliveryProviderControl>;
      check: string;
      reason?: RegExp;
      pr?: number;
    }
  > = {
    "PRがMERGEDである（OPEN）": { patch: { phase: "ready" }, check: "merged" },
    "PRがMERGEDである（CLOSEDで未merge）": {
      patch: { phase: "ready", existingPr: "closed" },
      check: "merged",
    },
    merge時headが実効headと一致する: {
      patch: { headSha: "e".repeat(40) },
      check: "binding",
    },
    repositoryとPR番号が固定値と一致する: {
      patch: {},
      check: "binding",
      pr: 2,
    },
    "base refが既定branchである": {
      patch: { providerDefaultBranch: "develop" },
      check: "default-branch",
    },
    "merge commitが既定branch tipから到達可能である": {
      patch: { mergeOnDefaultBranch: false },
      check: "reachable",
    },
    merge方式を判定できる: {
      patch: { mergeParentsSwapped: true },
      check: "method",
      reason: /merge方式を判定できません/u,
    },
    "merge時baseのtrusted policyを解決できる": {
      patch: { remoteBaseSha: "f".repeat(40) },
      check: "trusted-policy",
      reason: /git fetch/u,
    },
    "merge方式を判定できる（1親でtrusted policyがsquashも許可）": {
      patch: { autoMergeMethod: "SQUASH" },
      check: "method",
      reason: /merge方式を判定できません/u,
    },
    "delivery stateがpr-boundである（merge-prepared）": {
      patch: {},
      check: "delivery",
      reason: /merge-prepared以後/u,
    },
  };
  const selected = cases[example];
  if (!selected) throw new Error(`未対応のExamples行です: ${example}`);
  if (example.endsWith("squashも許可）"))
    advanceDeliveryTrustedMergeMode(prepared, "automatic", {
      methods: ["merge", "squash"],
    });
  if (example.endsWith("（merge-prepared）")) {
    const bound = readFixtureDeliveryState(prepared.staging);
    prepareStoredMergeIntent(prepared.staging, {
      method: "merge",
      authorizedHeadSha: prepared.headSha,
      authorizedBaseRef: "main",
      authorizedBaseSha: prepared.baseSha,
      trustedPolicyCommitSha: prepared.baseSha,
      ...preparedMergeReviewEvidence(prepared),
      intentId: "6".repeat(32),
      preparedAt: bound.pr?.boundAt ?? fixtureInstant(),
    });
  }
  markExternallyMerged(prepared, selected.patch);
  assertExternalMergeRejected(
    prepared,
    selected.check,
    selected.reason,
    selected.pr,
  );
}

/**
 * SCN-E2E-EXTMERGE-003: merge方式の許可はmerge時base（第1親）のtrusted policyから解決し、
 * merge後の既定branch tip（PR自身のpolicy変更を含みうる）を使わない。
 */
function runExternalMergeTrustedPolicy(
  world: WorkflowStepWorld,
  example: string,
): void {
  const prepared = prepareExternallyMergedPullRequest(world);
  if (example === "squash") {
    advanceDeliveryTrustedMergeMode(prepared, "automatic", {
      methods: ["merge", "squash"],
      updateProviderBase: false,
    });
    markExternallyMerged(prepared, { autoMergeMethod: "SQUASH" });
  } else if (example === "merge") {
    advanceDeliveryTrustedMergeMode(prepared, "automatic", {
      methods: ["squash"],
    });
    advanceDeliveryTrustedMergeMode(prepared, "automatic", {
      methods: ["merge"],
      updateProviderBase: false,
    });
    markExternallyMerged(prepared);
  } else throw new Error(`未対応のExamples行です: ${example}`);
  assertExternalMergeRejected(
    prepared,
    "method",
    /trusted policyが許可するmerge方式と観測したmerge commitの形が一致しません/u,
  );
}

/** fixture repositoryでgitを実行し、失敗を名指しする（Issue #1569）。 */
function fixtureGit(root: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
}

function sha256File(file: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

interface ReplacementFixture {
  prepared: PreparedDeliveryCli;
  branch: string;
  baseSha: string;
  implementationSha: string;
  pullRequestHeadSha: string;
}

/** pr-boundの通常fixture（round 1でH_impl0へ収束、PR head＝H_impl0＋証跡）。 */
function boundReplacementFixture(world: WorkflowStepWorld): ReplacementFixture {
  const prepared = prepareDeliveryCli(world);
  createDeliveryPullRequest(prepared);
  return {
    prepared,
    branch: fixtureGit(prepared.root, ["symbolic-ref", "--short", "HEAD"]),
    baseSha: prepared.baseSha,
    implementationSha: prepared.implementationCommitSha,
    pullRequestHeadSha: prepared.headSha,
  };
}

/**
 * 既定branch前進をmergeで取り込み、旧sessionのround 2・post-PR intake・reviewed-forwardを
 * 経たPR（SCN-MERGE-BASE-AUDIT-003と同じ形）。暫定guardは比較基点不一致で拒否する。
 */
function followedMainReplacementFixture(
  world: WorkflowStepWorld,
): ReplacementFixture {
  const prepared = prepareDeliveryCli(world);
  createDeliveryPullRequest(prepared);
  const root = prepared.root;
  const branch = fixtureGit(root, ["symbolic-ref", "--short", "HEAD"]);
  fixtureGit(root, [
    "checkout",
    "-q",
    "-b",
    "asc-1569-advance",
    prepared.baseSha,
  ]);
  fs.writeFileSync(
    path.join(root, "downstream-note.txt"),
    "default branch advance\n",
  );
  fixtureGit(root, ["add", "--", "downstream-note.txt"]);
  fixtureGit(root, ["commit", "-q", "-m", "default branch advance"]);
  const advancedBaseSha = fixtureGit(root, ["rev-parse", "HEAD"]);
  fixtureGit(root, ["update-ref", "refs/remotes/origin/main", advancedBaseSha]);
  fixtureGit(root, ["checkout", "-q", branch]);
  fixtureGit(root, [
    "merge",
    "-q",
    "asc-1569-advance",
    "-m",
    "merge default branch advance",
  ]);
  fixtureGit(root, ["branch", "-D", "asc-1569-advance"]);
  const forwardHead = fixtureGit(root, ["rev-parse", "HEAD"]);
  const draft = buildReviewRoundDraft({
    staging: prepared.staging,
    headSha: forwardHead,
  }).round;
  const session = recordReviewRound({
    staging: prepared.staging,
    round: draft,
  });
  const finalHead = commitReviewEvidence(
    prepared,
    advancedBaseSha,
    forwardHead,
  );
  recordPostPrIntake(prepared, session.latestRoundDigest);
  pointProviderAt(prepared, advancedBaseSha, finalHead, forwardHead);
  const reanchored = executeReanchor(
    prepared,
    finalHead,
    advancedBaseSha,
    "--apply",
  );
  assert.equal(reanchored.status, 0, reanchored.stdout + reanchored.stderr);
  return {
    prepared,
    branch,
    baseSha: advancedBaseSha,
    implementationSha: forwardHead,
    pullRequestHeadSha: finalHead,
  };
}

function commitReviewEvidence(
  prepared: PreparedDeliveryCli,
  baseSha: string,
  implementationHeadSha: string,
  extraFile?: string,
): string {
  const content = reviewEvidenceContentFromStaging(prepared.staging, {
    issue: 877,
    baseSha,
    implementationHeadSha,
  });
  fs.mkdirSync(path.join(prepared.root, "docs", "reviews"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(prepared.root, "docs", "reviews", "877_review.json"),
    content,
  );
  fixtureGit(prepared.root, ["add", "--", "docs/reviews/877_review.json"]);
  if (extraFile) {
    fs.writeFileSync(path.join(prepared.root, extraFile), "not evidence\n");
    fixtureGit(prepared.root, ["add", "--", extraFile]);
  }
  fixtureGit(prepared.root, ["commit", "-q", "-m", "review evidence"]);
  return fixtureGit(prepared.root, ["rev-parse", "HEAD"]);
}

function recordPostPrIntake(
  prepared: PreparedDeliveryCli,
  roundDigest: string,
): void {
  const intake = executeCli(
    [
      "workflow",
      "record",
      `--staging=${prepared.staging}`,
      "--step=10",
      "--post-pr-intake",
      "--artifact=docs/reviews/877_review.json",
      "--evidence=同じPRで収束したreview roundへStep 10を束縛した",
      `--review-session-digest=${roundDigest}`,
    ],
    prepared.root,
    prepared.env,
  );
  assert.equal(intake.status, 0, intake.stdout + intake.stderr);
}

function pointProviderAt(
  prepared: PreparedDeliveryCli,
  baseSha: string,
  headSha: string,
  implementationSha: string,
): void {
  const mergeTree = spawnSync(
    "git",
    ["merge-tree", "--write-tree", baseSha, headSha],
    {
      cwd: prepared.root,
      encoding: "utf8",
    },
  );
  assert.equal(mergeTree.status, 0, mergeTree.stderr);
  writeDeliveryProviderControl(prepared, {
    remoteBaseSha: baseSha,
    headSha,
    implementationSha,
    mergeTreeSha: mergeTree.stdout.trim(),
  });
}

function executeReanchor(
  prepared: PreparedDeliveryCli,
  newHead: string,
  newBase: string,
  mode: "--dry-run" | "--apply",
) {
  return executeCli(
    [
      "pr",
      "reanchor",
      `--staging=${prepared.staging}`,
      `--root=${prepared.root}`,
      `--new-head=${newHead}`,
      `--new-base=${newBase}`,
      "--reason=review session置換後の新sessionの証跡へ再固定する",
      mode,
    ],
    prepared.root,
    prepared.env,
  );
}

function executeReviewReplace(
  prepared: PreparedDeliveryCli,
  mode: "--dry-run" | "--apply",
) {
  return executeCli(
    [
      "review",
      "replace",
      `--root=${prepared.root}`,
      `--staging=${path.relative(prepared.root, prepared.staging)}`,
      mode,
    ],
    prepared.root,
    prepared.env,
  );
}

interface ReplacedOutput {
  state: string;
  recovered?: boolean;
  reasons?: string[];
  record?: {
    sequence: number;
    previousRecordDigest: string | null;
    previousSession: { digest: string };
    implementationHeadSha: string;
    savedPath: string;
  };
}

function applyReviewReplace(fixture: ReplacementFixture): ReplacedOutput {
  const applied = executeReviewReplace(fixture.prepared, "--apply");
  assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  const output = JSON.parse(applied.stdout) as ReplacedOutput;
  assert.equal(output.state, "replaced");
  return output;
}

/** 置換が固定したH_implへdetachしてround 1を収束させ、branchへ戻る。 */
function convergeReplacementRoundOne(fixture: ReplacementFixture) {
  const { prepared } = fixture;
  fixtureGit(prepared.root, [
    "checkout",
    "-q",
    "--detach",
    fixture.implementationSha,
  ]);
  const draft = buildReviewRoundDraft({
    staging: prepared.staging,
    headSha: fixture.implementationSha,
    baseSha: fixture.baseSha,
    scopeIds: ["SCOPE-WORKFLOW"],
    acceptanceCriteriaIds: ["AC-WF-005"],
  }).round;
  const session = recordReviewRound({
    staging: prepared.staging,
    round: draft,
  });
  fixtureGit(prepared.root, ["checkout", "-q", fixture.branch]);
  assert.equal(session.status, "converged");
  assert.equal(session.anchor.initialHeadSha, fixture.implementationSha);
  return session;
}

/**
 * 置換 → H_implでround 1 → post-PR intake → 証跡 → `pr reanchor`（session-replacement）
 * までの公式経路。SCN-E2E-REVREPLACE-001とSCN-MERGE-BASE-AUDIT-012が共有する。
 */
function replaceAndReconverge(fixture: ReplacementFixture): string {
  const { prepared } = fixture;
  applyReviewReplace(fixture);
  const session = convergeReplacementRoundOne(fixture);
  recordPostPrIntake(prepared, session.latestRoundDigest);
  const finalHead = commitReviewEvidence(
    prepared,
    fixture.baseSha,
    fixture.implementationSha,
  );
  pointProviderAt(
    prepared,
    fixture.baseSha,
    finalHead,
    fixture.implementationSha,
  );
  const reanchored = executeReanchor(
    prepared,
    finalHead,
    fixture.baseSha,
    "--apply",
  );
  assert.equal(reanchored.status, 0, reanchored.stdout + reanchored.stderr);
  const chain = fs
    .readFileSync(
      path.join(prepared.staging, "journal", "reanchor.jsonl"),
      "utf8",
    )
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as { method: string; newHeadSha: string });
  assert.equal(chain.at(-1)?.method, "session-replacement");
  assert.equal(chain.at(-1)?.newHeadSha, finalHead);
  return finalHead;
}

function executeDeliveryMergePreview(prepared: PreparedDeliveryCli) {
  return executeCli(
    deliveryMergeArgs(prepared).map((argument) =>
      argument === "--apply" ? "--dry-run" : argument,
    ),
    prepared.root,
    prepared.env,
  );
}

const REVIEW_REPLACE_GUIDE =
  /`review replace --staging=<staging> --apply`でreview sessionを置換し、round 1からやり直してください/u;

function runReviewReplaceAcceptance(world: WorkflowStepWorld): void {
  const fixture = followedMainReplacementFixture(world);
  const { prepared } = fixture;
  const staging = prepared.staging;
  const rejected = executeDeliveryMergePreview(prepared);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stdout + rejected.stderr, REVIEW_REPLACE_GUIDE);

  const sessionFile = path.join(staging, "review-session.json");
  const sessionDigest = sha256File(sessionFile);
  // 旧sessionのreview progress journalは新sessionと混ぜず、保存名へ移す。
  const progressFile = path.join(staging, "journal", "review-progress.jsonl");
  fs.writeFileSync(progressFile, "{}\n", { mode: 0o600 });
  const progressDigest = sha256File(progressFile);
  const beforePreview = stagingBytes(staging);
  const preview = executeReviewReplace(prepared, "--dry-run");
  assert.equal(preview.status, 0, preview.stdout + preview.stderr);
  assert.equal((JSON.parse(preview.stdout) as ReplacedOutput).state, "preview");
  assert.equal(stagingBytes(staging), beforePreview);

  /**
   * 中断復旧（02 §6）: 段1後（記録だけ追記）と段2後（rename済み・digest未再固定）を
   * 実applyの結果から作り、同じapplyの再実行が置換を完了させることを確かめる。
   */
  const recordFile = path.join(staging, "staging-record.json");
  const storedRecord = fs.readFileSync(recordFile);
  const first = applyReviewReplace(fixture);
  const savedFile = path.join(staging, first.record!.savedPath);
  fs.writeFileSync(recordFile, storedRecord);
  // 置換以外の成果物も変わっていれば中断復旧として扱わない。
  const requestFile = path.join(staging, "00_要求定義.md");
  const requestBytes = fs.readFileSync(requestFile);
  fs.appendFileSync(requestFile, "\n置換と無関係な変更\n");
  const tampered = executeReviewReplace(prepared, "--apply");
  assert.equal(tampered.status, 1, tampered.stdout + tampered.stderr);
  fs.writeFileSync(requestFile, requestBytes);
  const afterStageTwo = executeReviewReplace(prepared, "--apply");
  assert.equal(
    afterStageTwo.status,
    0,
    afterStageTwo.stdout + afterStageTwo.stderr,
  );
  assert.equal(
    (JSON.parse(afterStageTwo.stdout) as ReplacedOutput).recovered,
    true,
  );
  fs.renameSync(savedFile, sessionFile);
  fs.writeFileSync(recordFile, storedRecord);
  const afterStageOne = executeReviewReplace(prepared, "--apply");
  assert.equal(
    afterStageOne.status,
    0,
    afterStageOne.stdout + afterStageOne.stderr,
  );
  const recovered = JSON.parse(afterStageOne.stdout) as ReplacedOutput;
  assert.equal(recovered.recovered, true);
  assert.equal(fs.existsSync(sessionFile), false);
  assert.equal(sha256File(savedFile), sessionDigest);
  assert.equal(fs.existsSync(progressFile), false);
  assert.equal(
    sha256File(
      path.join(staging, "journal", "review-progress-replaced-001.jsonl"),
    ),
    progressDigest,
  );
  assert.equal(recovered.record?.sequence, 1);
  assert.equal(recovered.record?.previousSession.digest, sessionDigest);
  assert.equal(
    recovered.record?.implementationHeadSha,
    fixture.implementationSha,
  );
  assert.equal(
    fs
      .readFileSync(
        path.join(staging, "journal", "review-session-replacements.jsonl"),
        "utf8",
      )
      .trimEnd()
      .split("\n").length,
    1,
  );

  const session = convergeReplacementRoundOne(fixture);
  recordPostPrIntake(prepared, session.latestRoundDigest);
  const finalHead = commitReviewEvidence(
    prepared,
    fixture.baseSha,
    fixture.implementationSha,
  );
  pointProviderAt(
    prepared,
    fixture.baseSha,
    finalHead,
    fixture.implementationSha,
  );
  const reanchored = executeReanchor(
    prepared,
    finalHead,
    fixture.baseSha,
    "--apply",
  );
  assert.equal(reanchored.status, 0, reanchored.stdout + reanchored.stderr);
  assert.equal(
    (
      JSON.parse(
        fs
          .readFileSync(path.join(staging, "journal", "reanchor.jsonl"), "utf8")
          .trimEnd()
          .split("\n")
          .at(-1)!,
      ) as { method: string }
    ).method,
    "session-replacement",
  );
  const authorized = executeDeliveryMergePreview(prepared);
  assert.equal(authorized.status, 0, authorized.stdout + authorized.stderr);
  assert.equal(deliveryProviderCalls(prepared).filter(isMergeCall).length, 0);

  // 2回目の置換（02 §10 (1)）: 置換記録2行の一方向chainと保存file2件。
  const secondSessionDigest = sha256File(sessionFile);
  const second = applyReviewReplace(fixture);
  const lines = fs
    .readFileSync(
      path.join(staging, "journal", "review-session-replacements.jsonl"),
      "utf8",
    )
    .trimEnd()
    .split("\n");
  assert.equal(lines.length, 2);
  assert.equal(second.record?.sequence, 2);
  assert.equal(
    second.record?.previousRecordDigest,
    crypto.createHash("sha256").update(lines[0]!).digest("hex"),
  );
  assert.equal(
    sha256File(path.join(staging, second.record!.savedPath)),
    secondSessionDigest,
  );
  assert.equal(sha256File(savedFile), sessionDigest);
}

/** SCN-E2E-REVREPLACE-002: 前提を1つだけ破り、名指しの拒否とbyte不変を確かめる。 */
function runReviewReplaceRejection(
  world: WorkflowStepWorld,
  example: string,
): void {
  const fixture =
    example === "Step 11が無い"
      ? (() => {
          const prepared = prepareDeliveryCli(world, {}, "disabled");
          createDeliveryPullRequest(prepared);
          return { prepared } as ReplacementFixture;
        })()
      : boundReplacementFixture(world);
  const { prepared } = fixture;
  const expected: Record<string, RegExp> = {
    "review sessionが存在する": /review sessionが存在しません/u,
    "review sessionがconvergedである":
      /review sessionがconvergedではありません/u,
    "latest roundのcandidate HEADがcurrent H_implと一致する":
      /latest roundのcandidate HEADがcurrent H_impl/u,
    "delivery stateがpr-boundである": /delivery stateがpr-boundではありません/u,
    "merge intentが無い": /merge intentがあります/u,
    "Step 11が無い": /Step 11が記録されています/u,
    置換記録のsequenceが連番である: /置換記録のsequenceが連番ではありません/u,
    "置換記録のhash chainが一致する":
      /置換記録のhash chainが直前の記録と一致しません/u,
    置換済みsessionの保存fileが置換記録のdigestと一致する:
      /保存file review-session-replaced-001\.json が置換記録のdigestと一致しません/u,
    置換記録の末尾が完全な行である: /置換記録の末尾が完全な行ではありません/u,
  };
  const diagnostic = expected[example];
  if (!diagnostic) throw new Error(`未対応のExamples行です: ${example}`);
  const productCommit = (): string => {
    fs.writeFileSync(
      path.join(prepared.root, "implementation.txt"),
      "unreviewed change\n",
    );
    fixtureGit(prepared.root, ["add", "--", "implementation.txt"]);
    fixtureGit(prepared.root, ["commit", "-q", "-m", "change after review"]);
    return fixtureGit(prepared.root, ["rev-parse", "HEAD"]);
  };
  if (example === "review sessionが存在する") applyReviewReplace(fixture);
  else if (
    example === "review sessionがconvergedである" ||
    example === "latest roundのcandidate HEADがcurrent H_implと一致する"
  ) {
    const head = productCommit();
    const draft = buildReviewRoundDraft({
      staging: prepared.staging,
      headSha: head,
    }).round;
    recordReviewRound({
      staging: prepared.staging,
      round:
        example === "review sessionがconvergedである"
          ? parseReviewRoundInput({
              ...draft,
              findings: [
                {
                  id: "H-1569",
                  severity: "High",
                  status: "valid",
                  source: "review",
                  relation: "acceptance-violation",
                  evidence: "置換前提の未収束fixture",
                  path: "implementation.txt",
                  contractId: "AC-WF-005",
                  causedByFindingId: null,
                  decisionRef: null,
                },
              ],
            })
          : draft,
    });
  } else if (
    example === "delivery stateがpr-boundである" ||
    example === "merge intentが無い"
  ) {
    const bound = readFixtureDeliveryState(prepared.staging);
    prepareStoredMergeIntent(prepared.staging, {
      method: "merge",
      authorizedHeadSha: prepared.headSha,
      authorizedBaseRef: "main",
      authorizedBaseSha: prepared.baseSha,
      trustedPolicyCommitSha: prepared.baseSha,
      ...preparedMergeReviewEvidence(prepared),
      intentId: "5".repeat(32),
      preparedAt: bound.pr?.boundAt ?? fixtureInstant(),
    });
  } else if (example.startsWith("置換")) {
    applyReviewReplace(fixture);
    convergeReplacementRoundOne(fixture);
    const recordsFile = path.join(
      prepared.staging,
      "journal",
      "review-session-replacements.jsonl",
    );
    const record = JSON.parse(fs.readFileSync(recordsFile, "utf8")) as Record<
      string,
      unknown
    >;
    if (example === "置換記録のsequenceが連番である")
      fs.writeFileSync(
        recordsFile,
        `${JSON.stringify({ ...record, sequence: 2 })}\n`,
      );
    else if (example === "置換記録のhash chainが一致する")
      fs.writeFileSync(
        recordsFile,
        `${JSON.stringify({ ...record, previousRecordDigest: "0".repeat(64) })}\n`,
      );
    else if (example === "置換記録の末尾が完全な行である")
      // 改行を欠く末尾は、JSONとして読める記録でも完全な行として扱わない。
      fs.writeFileSync(recordsFile, JSON.stringify(record));
    else
      fs.appendFileSync(
        path.join(prepared.staging, "review-session-replaced-001.json"),
        " ",
      );
    refreshStoredStagingDigest(prepared.staging);
  }
  const before = stagingBytes(prepared.staging);
  const rejected = executeReviewReplace(prepared, "--apply");
  assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
  const output = JSON.parse(rejected.stdout) as ReplacedOutput;
  assert.equal(output.state, "rejected");
  assert.match((output.reasons ?? []).join("\n"), diagnostic);
  assert.equal(stagingBytes(prepared.staging), before);
  if (example === "Step 11が無い") {
    // journalにだけStep 11がある`pr-bound`（PR停止終端の中断状態）も拒否する。
    const interrupted = boundReplacementFixture(world);
    appendDeliveryTerminalJournalEntry({
      staging: interrupted.prepared.staging,
      entry: {
        ...entry(11),
        artifacts: ["https://github.com/o/r/pull/1", DELIVERY_STATE_FILE],
        evidence: "outcome=pull-request evidence=別経路の停止終端",
      },
    });
    const journalOnlyBefore = stagingBytes(interrupted.prepared.staging);
    const journalOnly = executeReviewReplace(interrupted.prepared, "--apply");
    assert.equal(
      journalOnly.status,
      1,
      journalOnly.stdout + journalOnly.stderr,
    );
    const reasons =
      (JSON.parse(journalOnly.stdout) as ReplacedOutput).reasons ?? [];
    assert.deepEqual(reasons, ["Step 11が記録されています"]);
    assert.equal(stagingBytes(interrupted.prepared.staging), journalOnlyBefore);
  }
}

/**
 * SCN-E2E-REVREPLACE-003: 置換後もH_implが動けば暫定guardが拒否し、
 * `session-replacement`はR1〜R7のどれか1つでも破れば受理しない。
 */
function runReviewReplaceAbuse(world: WorkflowStepWorld): void {
  const fixture = boundReplacementFixture(world);
  const { prepared } = fixture;
  const root = prepared.root;
  const chainFile = path.join(prepared.staging, "journal", "reanchor.jsonl");
  const chainBytes = (): string =>
    fs.existsSync(chainFile) ? fs.readFileSync(chainFile, "utf8") : "";
  applyReviewReplace(fixture);
  const session = convergeReplacementRoundOne(fixture);
  const reject = (head: string, base: string, condition: RegExp): void => {
    const before = chainBytes();
    const rejected = executeReanchor(prepared, head, base, "--dry-run");
    assert.notEqual(rejected.status, 0, rejected.stdout);
    assert.match(rejected.stdout + rejected.stderr, condition);
    assert.equal(chainBytes(), before);
    fixtureGit(root, ["reset", "-q", "--hard", fixture.pullRequestHeadSha]);
  };
  // R3: post-PR intakeのStep 10を記録せずに証跡を作る。
  reject(
    commitReviewEvidence(prepared, fixture.baseSha, fixture.implementationSha),
    fixture.baseSha,
    /R3: 新証跡が置換後sessionとpost-PR intakeのStep 10 bindingに一致しません/u,
  );
  recordPostPrIntake(prepared, session.latestRoundDigest);
  const accepted = commitReviewEvidence(
    prepared,
    fixture.baseSha,
    fixture.implementationSha,
  );
  const positive = executeReanchor(
    prepared,
    accepted,
    fixture.baseSha,
    "--dry-run",
  );
  assert.equal(positive.status, 0, positive.stdout + positive.stderr);
  assert.match(positive.stdout, /"willAppend": true/u);
  fixtureGit(root, ["reset", "-q", "--hard", fixture.pullRequestHeadSha]);
  // R1: 置換記録と異なるH_implを宣言する証跡。
  reject(
    commitReviewEvidence(prepared, fixture.baseSha, fixture.pullRequestHeadSha),
    fixture.baseSha,
    /R1: 新証跡のH_implが最新置換記録のH_impl/u,
  );
  // R4: 証跡commitに証跡以外のfile変更を含める。
  reject(
    commitReviewEvidence(
      prepared,
      fixture.baseSha,
      fixture.implementationSha,
      "unreviewed.txt",
    ),
    fixture.baseSha,
    /R4: 新headが置換記録のH_implへ証跡pathだけを足したevidence-only suffixではありません/u,
  );
  // R6: 旧baseの子孫でない新base（証跡の比較基点とも一致しない）。
  reject(
    commitReviewEvidence(prepared, fixture.baseSha, fixture.implementationSha),
    fixture.implementationSha,
    /R6: 新baseが旧baseと同一でないか/u,
  );
  // R6: 新baseが旧baseの祖先（後退）で、証跡もその後退したbaseを宣言する。
  const retreatedBase = fixtureGit(root, ["rev-parse", `${fixture.baseSha}^`]);
  reject(
    commitReviewEvidence(prepared, retreatedBase, fixture.implementationSha),
    retreatedBase,
    /R6: 新baseが旧baseと同一でないか/u,
  );
  // R5: PR bindingの実効headをH_impl上にない別commitへ差し替えた状態。
  fs.writeFileSync(path.join(root, "detour.txt"), "detour\n");
  fixtureGit(root, ["add", "--", "detour.txt"]);
  fixtureGit(root, ["commit", "-q", "-m", "detour"]);
  const detour = fixtureGit(root, ["rev-parse", "HEAD"]);
  fixtureGit(root, ["reset", "-q", "--hard", fixture.pullRequestHeadSha]);
  fs.writeFileSync(
    chainFile,
    `${JSON.stringify({
      oldHeadSha: fixture.pullRequestHeadSha,
      newHeadSha: detour,
      oldBaseSha: fixture.baseSha,
      newBaseSha: fixture.baseSha,
      diffDigest: "0".repeat(64),
      method: "rebase",
      reason: "binding改変fixture",
      recordedAt: fixtureInstant(),
    })}\n`,
  );
  refreshStoredStagingDigest(prepared.staging);
  reject(
    commitReviewEvidence(prepared, fixture.baseSha, fixture.implementationSha),
    fixture.baseSha,
    /R5: 旧PR headが置換記録のH_implまたはその同じ証跡pathだけのsuffixではありません/u,
  );
  fs.rmSync(chainFile);
  refreshStoredStagingDigest(prepared.staging);
  // R2: 2回目の置換でcurrent sessionが無い（証跡は置換前に作る）。
  const replacedEvidence = commitReviewEvidence(
    prepared,
    fixture.baseSha,
    fixture.implementationSha,
  );
  applyReviewReplace(fixture);
  reject(
    replacedEvidence,
    fixture.baseSha,
    /R2: current review sessionの初回H_implが最新置換記録のH_implと一致しません/u,
  );
  // R7: delivery stateがpr-boundでない。
  const bound = readFixtureDeliveryState(prepared.staging);
  prepareStoredMergeIntent(prepared.staging, {
    method: "merge",
    authorizedHeadSha: prepared.headSha,
    authorizedBaseRef: "main",
    authorizedBaseSha: prepared.baseSha,
    trustedPolicyCommitSha: prepared.baseSha,
    ...preparedMergeReviewEvidence(prepared),
    intentId: "4".repeat(32),
    preparedAt: bound.pr?.boundAt ?? fixtureInstant(),
  });
  reject(
    replacedEvidence,
    fixture.baseSha,
    /pr-boundまたはstep11-recordedだけがpr reanchorを受理します/u,
  );
}

/**
 * SCN-E2E-REVREPLACE-003: 保存済み`session-replacement`記録のreview bindingの形
 * （sessionId・H_impl）と置換連番（1以上）が崩れていれば、既存chainとして受理しない。
 * 同じ入力の再実行（冪等な受理）でなく再固定記録readerの形式診断で拒否されることを確かめる。
 */
function rejectMalformedSessionReplacementRecord(
  fixture: ReplacementFixture,
  finalHead: string,
): void {
  const { prepared } = fixture;
  const chainFile = path.join(prepared.staging, "journal", "reanchor.jsonl");
  const original = fs.readFileSync(chainFile, "utf8");
  const lines = original.trimEnd().split("\n");
  const index = lines.length - 1;
  const last = JSON.parse(lines[index]!) as {
    method: string;
    sessionReplacement: Record<string, unknown>;
  };
  assert.equal(last.method, "session-replacement");
  assert.equal(last.sessionReplacement.replacementSequence, 1);
  for (const malformed of [
    { sessionId: "not-a-session-digest" },
    { implementationSha: "z".repeat(40) },
    { replacementSequence: 0 },
  ]) {
    fs.writeFileSync(
      chainFile,
      `${[
        ...lines.slice(0, index),
        JSON.stringify({
          ...last,
          sessionReplacement: { ...last.sessionReplacement, ...malformed },
        }),
      ].join("\n")}\n`,
    );
    refreshStoredStagingDigest(prepared.staging);
    const rejected = executeReanchor(
      prepared,
      finalHead,
      fixture.baseSha,
      "--dry-run",
    );
    assert.notEqual(rejected.status, 0, JSON.stringify(malformed));
    assert.match(
      rejected.stdout + rejected.stderr,
      /再固定記録の形式が不正です/u,
    );
  }
  fs.writeFileSync(chainFile, original);
  refreshStoredStagingDigest(prepared.staging);
}

/** SCN-E2E-REVREPLACE-003前半: 置換後sessionのround 2（部分的revert）は暫定guardが拒否する。 */
function runReviewReplaceRoundTwo(world: WorkflowStepWorld): void {
  const fixture = boundReplacementFixture(world);
  const { prepared } = fixture;
  const finalHead = replaceAndReconverge(fixture);
  rejectMalformedSessionReplacementRecord(fixture, finalHead);
  fs.writeFileSync(
    path.join(prepared.root, "implementation.txt"),
    "partially reverted\n",
  );
  fixtureGit(prepared.root, ["add", "--", "implementation.txt"]);
  fixtureGit(prepared.root, [
    "commit",
    "-q",
    "-m",
    "partial revert after round 1",
  ]);
  const revertHead = fixtureGit(prepared.root, ["rev-parse", "HEAD"]);
  const draft = buildReviewRoundDraft({
    staging: prepared.staging,
    headSha: revertHead,
  }).round;
  const session = recordReviewRound({
    staging: prepared.staging,
    round: draft,
  });
  assert.equal(session.status, "converged");
  assert.equal(session.rounds.length, 2);
  const revertFinal = commitReviewEvidence(
    prepared,
    fixture.baseSha,
    revertHead,
  );
  recordPostPrIntake(prepared, session.latestRoundDigest);
  pointProviderAt(prepared, fixture.baseSha, revertFinal, revertHead);
  const forwarded = executeReanchor(
    prepared,
    revertFinal,
    fixture.baseSha,
    "--apply",
  );
  assert.equal(forwarded.status, 0, forwarded.stdout + forwarded.stderr);
  assert.notEqual(revertFinal, finalHead);
  const rejected = executeDeliveryMergePreview(prepared);
  assert.notEqual(rejected.status, 0);
  const output = rejected.stdout + rejected.stderr;
  assert.match(
    output,
    /実効H_impl\(.*\)がreview sessionの初回H_impl\(.*\)と一致しません/u,
  );
  assert.match(output, REVIEW_REPLACE_GUIDE);
}

When(
  "{string}の{string}のE2E検査を実行する",
  function (this: WorkflowStepWorld, scenarioId: string, example: string) {
    if (scenarioId === "SCN-E2E-EXTMERGE-002")
      runExternalMergeMismatch(this, example);
    else if (scenarioId === "SCN-E2E-REVREPLACE-002")
      runReviewReplaceRejection(this, example);
    else if (scenarioId === "SCN-E2E-EXTMERGE-003")
      runExternalMergeTrustedPolicy(this, example);
    else throw new Error(`未対応のe2e scenarioです: ${scenarioId}`);
    this.workflowCheckPassed = true;
  },
);

Given("ワークフローStep公開CLIの隔離環境がある", function () {
  this.workflowCheckPassed = false;
});

When("{string}のE2E検査を実行する", async function (scenarioId: string) {
  switch (scenarioId) {
    case "SCN-E2E-WFSTEP-001": {
      const prepared = preparePullRequest(this, true);
      const checked = executeCli(
        [...prepared.args, "--dry-run"],
        prepared.root,
      );
      assert.notEqual(checked.status, 0);
      assert.match(checked.stdout, /step 4/u);
      assert.match(checked.stdout, /step-04-issue-sync/u);
      assert.match(checked.stdout, /quickでもstep 4は省略対象ではない/u);
      break;
    }
    case "SCN-E2E-WFSTEP-002": {
      const prepared = preparePullRequest(this, false);
      const checked = executeCli(
        [...prepared.args, "--dry-run"],
        prepared.root,
      );
      assert.equal(checked.status, 0, checked.stdout + checked.stderr);
      assert.match(checked.stdout, /preview/u);
      break;
    }
    case "SCN-E2E-WFSTEP-061":
    case "SCN-E2E-WFSTEP-062": {
      const prepared = prepareDeliveryCli(
        this,
        {},
        scenarioId.endsWith("061") ? "automatic" : "assisted",
      );
      const advanced = divergeDeliveryBase(prepared);
      const stateFile = path.join(
        prepared.staging,
        ...DELIVERY_STATE_FILE.split("/"),
      );
      const createsBefore =
        deliveryProviderCalls(prepared).filter(isCreateCall).length;
      const rejected = executeCli(
        [...prepared.args, "--apply", "--authorize=approved"],
        prepared.root,
        prepared.env,
      );
      assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
      assert.match(rejected.stdout + rejected.stderr, /ancestor/u);
      assert.match(
        rejected.stdout + rejected.stderr,
        new RegExp(advanced, "u"),
      );
      assert.match(rejected.stdout + rejected.stderr, /merge/u);
      assert.match(rejected.stdout + rejected.stderr, /review reanchor/u);
      assert.doesNotMatch(
        rejected.stdout + rejected.stderr,
        /\bpr reanchor\b/u,
      );
      assert.equal(fs.existsSync(stateFile), false);
      assert.equal(
        deliveryProviderCalls(prepared).filter(isCreateCall).length,
        createsBefore,
      );
      break;
    }
    case "SCN-E2E-WFSTEP-063": {
      const prepared = prepareDeliveryCli(this, {}, "disabled");
      const advanced = divergeDeliveryBase(prepared);
      const created = createDeliveryPullRequest(prepared);
      assert.match(created.stdout, /warning/u);
      assert.match(created.stdout, new RegExp(advanced, "u"));
      assert.match(created.stdout, /pull_request_complete/u);
      const state = parseDeliveryState(
        fs.readFileSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
          "utf8",
        ),
      );
      assert.equal(state.step11?.outcome, "pull-request");
      break;
    }
    case "SCN-E2E-WFSTEP-064": {
      const prepared = prepareDeliveryCli(this, {}, "automatic");
      const journalFile = removeDeliveryStep4(prepared);
      const overrideFile = path.join(
        this.temp("asc-anchor-override-"),
        "override.json",
      );
      fs.writeFileSync(
        overrideFile,
        `${JSON.stringify({
          issue: 877,
          scope: "workflow.pr.create",
          instructedBy: "repository-owner",
          instructedAt: fixtureInstant({ hoursAgo: 1 }),
          expiresAt: fixtureInstant({ daysAhead: 1 }),
          reason: "missing Step 4を明示承認する",
        })}\n`,
      );
      divergeDeliveryBase(prepared);
      const journalBefore = fs.readFileSync(journalFile, "utf8");
      const rejected = executeCli(
        [
          ...prepared.args,
          "--apply",
          "--authorize=approved",
          `--workflow-override=${overrideFile}`,
        ],
        prepared.root,
        prepared.env,
      );
      assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
      assert.match(rejected.stdout + rejected.stderr, /ancestor/u);
      assert.equal(fs.readFileSync(journalFile, "utf8"), journalBefore);
      assert.equal(
        fs.existsSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
        ),
        false,
      );
      assert.equal(
        deliveryProviderCalls(prepared).filter(isCreateCall).length,
        0,
      );
      break;
    }
    case "SCN-E2E-WFSTEP-065": {
      const prepared = prepareDeliveryCli(
        this,
        {},
        "automatic",
        "merge",
        undefined,
        "poc",
      );
      const journalFile = removeDeliveryStep4(prepared);
      const overrideFile = path.join(
        this.temp("asc-anchor-poc-override-"),
        "override.json",
      );
      fs.writeFileSync(
        overrideFile,
        `${JSON.stringify({
          issue: 877,
          scope: "workflow.pr.create",
          instructedBy: "repository-owner",
          instructedAt: fixtureInstant({ hoursAgo: 1 }),
          expiresAt: fixtureInstant({ daysAhead: 1 }),
          reason: "missing Step 4を明示承認する",
        })}\n`,
      );
      divergeDeliveryBase(prepared);
      const journalBefore = fs.readFileSync(journalFile, "utf8");
      const rejected = executeCli(
        [
          ...prepared.args,
          "--apply",
          "--authorize=approved",
          `--workflow-override=${overrideFile}`,
        ],
        prepared.root,
        prepared.env,
      );
      assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
      assert.match(rejected.stdout + rejected.stderr, /ancestor/u);
      assert.match(rejected.stdout + rejected.stderr, /merge/u);
      assert.match(rejected.stdout + rejected.stderr, /authority/u);
      assert.equal(fs.readFileSync(journalFile, "utf8"), journalBefore);
      assert.equal(
        deliveryProviderCalls(prepared).filter(isCreateCall).length,
        0,
      );
      assert.equal(
        fs.existsSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
        ),
        false,
      );
      break;
    }
    case "SCN-E2E-WFSTEP-066": {
      const prepared = prepareDeliveryCli(this, {}, "disabled");
      failDeliveryAncestryComparison(prepared);
      const rejected = executeCli(
        [...prepared.args, "--apply", "--authorize=approved"],
        prepared.root,
        prepared.env,
      );
      assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
      assert.match(rejected.stdout + rejected.stderr, /比較できません/u);
      assert.equal(
        deliveryProviderCalls(prepared).filter(isCreateCall).length,
        0,
      );
      assert.equal(
        fs.existsSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
        ),
        false,
      );
      break;
    }
    case "SCN-E2E-WFSTEP-1410": {
      const prepared = prepareDeliveryCli(
        this,
        {},
        "automatic",
        "merge",
        undefined,
        "quick",
        0,
        "untracked",
      );
      assert.equal(prepared.headSha, prepared.implementationCommitSha);
      const checked = executeCli(
        [...prepared.args, "--dry-run"],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(checked.status, 0);
      assert.match(checked.stdout + checked.stderr, /H_impl.*H_final.*同一/u);
      assert.match(
        checked.stdout + checked.stderr,
        /review export.*review証跡.*commit/u,
      );
      const applied = executeCli(
        [...prepared.args, "--apply", "--authorize=approved"],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(applied.status, 0);
      assert.match(applied.stdout + applied.stderr, /H_impl.*H_final.*同一/u);
      assert.equal(
        fs.existsSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
        ),
        false,
      );
      const issueUrl = "https://github.com/o/r/issues/877";
      prepareStoredPullRequestCreation(prepared.staging, {
        repository: "o/r",
        issue: 877,
        issueUrl,
        headRef: "feature/x",
        headSha: prepared.headSha,
        baseRef: "main",
        baseSha: prepared.baseSha,
        pullRequestDigest: preparedPullRequestDigest(prepared),
        bodyClosingDigest: closingContractDigest({
          canonicalIssue: 877,
          canonicalIssueUrl: issueUrl,
          closingIssueNumbers: [877],
        }),
        preparedAt: fixtureInstant({ secondsAgo: 1 }),
      });
      writeDeliveryProviderControl(prepared, {
        existingPr: "open",
      });
      const recovered = executeCli(
        [...prepared.args, "--apply", "--authorize=approved"],
        prepared.root,
        prepared.env,
      );
      assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
      assert.match(recovered.stdout, /merge_pending/u);
      const callsAfterRecovery = deliveryProviderCalls(prepared);
      assert.equal(callsAfterRecovery.filter(isPullRequestFindCall).length, 1);
      assert.equal(callsAfterRecovery.filter(isCreateCall).length, 0);
      const recoveredState = parseDeliveryState(
        fs.readFileSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
          "utf8",
        ),
      );
      assert.equal(recoveredState.state, "pr-bound");
      const replayed = executeCli(
        [...prepared.args, "--apply", "--authorize=approved"],
        prepared.root,
        prepared.env,
      );
      assert.equal(replayed.status, 0, replayed.stdout + replayed.stderr);
      assert.match(replayed.stdout, /merge_pending/u);
      break;
    }
    case "SCN-E2E-WFSTEP-003": {
      const checked = await executeMain(["workflow", "steps", "--mode=quick"]);
      assert.equal(checked.status, 0);
      const output = JSON.parse(checked.stdout) as {
        sequence: number[];
        skippableSteps: number[];
        neverSkippableSteps: number[];
      };
      assert.deepEqual(output.sequence, [0, 1, 4, 9, 10, 11]);
      assert.deepEqual(output.skippableSteps, [2, 3, 5, 6, 7, 8]);
      assert.ok(output.neverSkippableSteps.includes(4));
      break;
    }
    case "SCN-E2E-WFSTEP-004": {
      const prepared = preparePullRequest(this, true, "automatic");
      const denied = executeCli([...prepared.args, "--dry-run"], prepared.root);
      assert.notEqual(denied.status, 0);
      const overrideFile = path.join(
        this.temp("asc-workflow-override-"),
        "override.json",
      );
      fs.writeFileSync(
        overrideFile,
        `${JSON.stringify({
          issue: 877,
          scope: "workflow.pr.create",
          instructedBy: "repository-owner",
          instructedAt: prepared.overrideTimes.instructedAt,
          expiresAt: prepared.overrideTimes.expiresAt,
          reason: "緊急修復のためstep 4欠落を明示承認する",
        })}\n`,
      );
      const stubDirectory = this.temp("asc-workflow-gh-");
      const stub = path.join(stubDirectory, "gh");
      const observedBody = path.join(stubDirectory, "observed-pr-body.md");
      fs.writeFileSync(
        stub,
        `#!/usr/bin/env node
const args = process.argv.slice(2);
const sha = ${JSON.stringify(prepared.headSha)};
const baseSha = ${JSON.stringify(prepared.baseSha)};
const prUrl = "https://github.com/o/r/pull/1";
const observedBody = ${JSON.stringify(observedBody)};
const exact = (expected) =>
  args.length === expected.length &&
  args.every((argument, index) => argument === expected[index]);

if (exact(["auth", "status"])) {
  process.exitCode = 0;
} else if (
  exact(["repo", "view", "o/r", "--json", "nameWithOwner,viewerPermission"])
) {
  process.stdout.write(
    JSON.stringify({ nameWithOwner: "o/r", viewerPermission: "WRITE" }),
  );
} else if (exact(["api", "user", "--jq", ".node_id"])) {
  process.stdout.write("repository-owner-node-id\\n");
} else if (
  exact(["repo", "view", "o/r", "--json", "nameWithOwner,defaultBranchRef"])
) {
  process.stdout.write(
    JSON.stringify({ nameWithOwner: "o/r", defaultBranchRef: { name: "main" } }),
  );
} else if (
  exact(["api", "repos/o/r/commits/feature%2Fx", "--jq", ".sha"])
) {
  process.stdout.write(sha + "\\n");
} else if (exact(["api", "repos/o/r/commits/main", "--jq", ".sha"])) {
  process.stdout.write(baseSha + "\\n");
} else if (
  exact([
    "pr",
    "create",
    "--repo",
    "o/r",
    "--head",
    "feature/x",
    "--base",
    "main",
    "--title",
    "bugfix: 877を是正する",
    "--body-file",
    args[args.length - 1],
  ]) &&
  require("node:fs").readFileSync(args[args.length - 1], "utf8").includes("Closes #877")
) {
  require("node:fs").writeFileSync(
    observedBody,
    require("node:fs").readFileSync(args[args.length - 1], "utf8"),
  );
  process.stdout.write(prUrl + "\\n");
} else if (
  exact([
    "pr",
    "view",
    prUrl,
    "--repo",
    "o/r",
    "--json",
    "number,url,title,body,headRefName,baseRefName,headRefOid,baseRefOid,headRepository,isCrossRepository,closingIssuesReferences",
  ])
) {
  process.stdout.write(
    JSON.stringify({
      number: 1,
      url: prUrl,
      title: "bugfix: 877を是正する",
      body: require("node:fs").readFileSync(observedBody, "utf8").trimEnd(),
      headRefName: "feature/x",
      baseRefName: "main",
      headRefOid: sha,
      baseRefOid: baseSha,
      headRepository: { nameWithOwner: "o/r" },
      isCrossRepository: false,
      closingIssuesReferences: [
        { number: 877, url: "https://github.com/o/r/issues/877" },
      ],
    }),
  );
} else {
  process.stderr.write("Unexpected gh invocation: " + JSON.stringify(args) + "\\n");
  process.exitCode = 64;
}
`,
      );
      fs.chmodSync(stub, 0o755);
      const allowed = executeCli(
        [
          ...prepared.args,
          "--apply",
          "--authorize=approved",
          `--workflow-override=${overrideFile}`,
        ],
        prepared.root,
        {
          ...process.env,
          PATH: `${stubDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      );
      assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
      assert.match(allowed.stdout, /merge_pending/u);
      const parsed = parseStepJournal(
        fs.readFileSync(path.join(prepared.staging, STEP_JOURNAL_FILE), "utf8"),
      );
      const overrideEntry = parsed.entries.find((item) => item.step === 4);
      assert.equal(
        overrideEntry?.humanOverride?.instructedBy,
        "repository-owner",
      );
      assert.match(overrideEntry?.humanOverride?.reason ?? "", /緊急修復/u);
      assert.equal(
        parsed.entries.some((item) => item.step === 11),
        false,
      );
      break;
    }
    case "SCN-E2E-WFSTEP-005": {
      const root = this.temp("asc-poc-merge-");
      const declaration = validPoc();
      for (const args of [
        ["init", "-q", "-b", "main"],
        ["config", "user.name", "poc-test"],
        ["config", "user.email", "poc-test@example.invalid"],
      ]) {
        const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
      }
      fs.writeFileSync(path.join(root, "README.md"), "# baseline\n");
      spawnSync("git", ["add", "README.md"], { cwd: root });
      spawnSync("git", ["commit", "-q", "-m", "baseline"], { cwd: root });
      const staging = createIssueStaging(root, {
        title: "poc-merge-test",
        answers: answers(),
        now: new Date(fixtureInstantMs()),
        requestedMode: "poc",
        poc: declaration,
      }).path;
      materializeValidPocFixture(root, declaration);
      spawnSync("git", ["add", declaration.fixture.root], { cwd: root });
      spawnSync("git", ["commit", "-q", "-m", "poc fixture"], { cwd: root });
      const headSha = spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).stdout.trim();
      for (const step of [1, 4])
        appendWorkflowJournalEntry({
          staging,
          entry: entry(step, "poc", fixtureInstant({ hoursAgo: 1 })),
        });
      executePocObservation({
        staging,
        headSha,
        observedAt: instant,
      });
      for (const step of [9, 10])
        appendWorkflowJournalEntry({
          staging,
          entry: entry(step, "poc", fixtureInstant({ hoursAgo: 1 })),
          headSha,
        });
      recordStagingSync(staging, {
        tracker: "https://github.com/o/r/issues/877",
        checkpoint: 4,
        syncedAt: fixtureInstant(),
        bodyDigest: "a".repeat(64),
        readBackDigest: "a".repeat(64),
      });
      const relativeStaging = path.relative(root, staging);
      await assert.rejects(
        () =>
          main([
            "pr",
            "merge",
            "--repo=o/r",
            "--pr=1",
            "--method=merge",
            `--root=${root}`,
            `--staging=${relativeStaging}`,
            "--dry-run",
          ]),
        /PoC.*PR.*停止点/u,
      );
      break;
    }
    case "SCN-E2E-WFSTEP-006": {
      const prepared = prepareDeliveryCli(
        this,
        {},
        "automatic",
        "merge",
        "actor-independent",
      );
      const created = createDeliveryPullRequest(prepared);
      assert.match(created.stdout, /merge_pending/u);
      const delivery = parseDeliveryState(
        fs.readFileSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
          "utf8",
        ),
      );
      assert.equal(delivery.state, "pr-bound");
      assert.equal(delivery.create.repository, "o/r");
      assert.equal(delivery.create.issue, 877);
      assert.equal(
        delivery.create.issueUrl,
        "https://github.com/o/r/issues/877",
      );
      assert.equal(delivery.create.headSha, prepared.headSha);
      assert.equal(delivery.pr?.number, 1);
      assert.equal(delivery.pr?.url, "https://github.com/o/r/pull/1");
      assert.equal(delivery.merge, null);
      const journal = parseStepJournal(
        fs.readFileSync(path.join(prepared.staging, STEP_JOURNAL_FILE), "utf8"),
      );
      assert.equal(
        journal.entries.some((item) => item.step === 11),
        false,
      );
      break;
    }
    case "SCN-E2E-WFSTEP-007": {
      const prepared = prepareDeliveryCli(this);
      createDeliveryPullRequest(prepared);
      const requested = executeDeliveryMerge(prepared);
      assert.equal(requested.status, 0, requested.stdout + requested.stderr);
      assert.match(requested.stdout, /merge_pending/u);
      const preparedState = parseDeliveryState(
        fs.readFileSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
          "utf8",
        ),
      );
      assert.equal(preparedState.state, "merge-observed");
      assert.equal(
        preparedState.merge?.observation?.providerState,
        "merge-requested",
      );
      const beforePreparedRetry = deliveryProviderCalls(prepared);
      const preparedRetry = executeDeliveryMerge(prepared);
      assert.equal(
        preparedRetry.status,
        0,
        preparedRetry.stdout + preparedRetry.stderr,
      );
      const afterPreparedRetry = deliveryProviderCalls(prepared);
      assertReadBackWithoutMergeResend(beforePreparedRetry, afterPreparedRetry);
      assert.equal(afterPreparedRetry.filter(isMergeCall).length, 1);

      const uncertain = prepareDeliveryCli(this, { failMerge: true });
      createDeliveryPullRequest(uncertain);
      const failed = executeDeliveryMerge(uncertain);
      assert.notEqual(failed.status, 0);
      assert.match(failed.stdout + failed.stderr, /reconciliation_required/u);
      const reconciliation = parseDeliveryState(
        fs.readFileSync(
          path.join(uncertain.staging, ...DELIVERY_STATE_FILE.split("/")),
          "utf8",
        ),
      );
      assert.equal(reconciliation.state, "reconciliation-required");
      assert.equal(reconciliation.reconciliation?.phase, "merge");
      const beforeReconciliationRetry = deliveryProviderCalls(uncertain);
      const reconciliationRetry = executeDeliveryMerge(uncertain);
      assert.equal(
        reconciliationRetry.status,
        0,
        reconciliationRetry.stdout + reconciliationRetry.stderr,
      );
      const afterReconciliationRetry = deliveryProviderCalls(uncertain);
      assertReadBackWithoutMergeResend(
        beforeReconciliationRetry,
        afterReconciliationRetry,
      );
      assert.equal(afterReconciliationRetry.filter(isMergeCall).length, 1);
      break;
    }
    case "SCN-E2E-WFSTEP-008": {
      const prepared = prepareDeliveryCli(this);
      createDeliveryPullRequest(prepared);
      const requested = executeDeliveryMerge(prepared);
      assert.equal(requested.status, 0, requested.stdout + requested.stderr);
      const pendingState = parseDeliveryState(
        fs.readFileSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
          "utf8",
        ),
      );
      assert.equal(pendingState.state, "merge-observed");
      assert.equal(
        pendingState.merge?.observation?.providerState,
        "merge-requested",
      );
      assert.equal(
        pendingState.merge?.observation?.providerRequest?.kind,
        "auto-merge",
      );
      const pendingJournal = parseStepJournal(
        fs.readFileSync(path.join(prepared.staging, STEP_JOURNAL_FILE), "utf8"),
      );
      assert.equal(
        pendingJournal.entries.some((item) => item.step === 11),
        false,
      );

      const mergedAt = fixtureInstant({ minutesAhead: 5 });
      writeDeliveryProviderControl(prepared, {
        phase: "merged",
        mergedAt,
      });
      const completed = executeDeliveryMerge(prepared);
      assert.equal(completed.status, 0, completed.stdout + completed.stderr);
      const completedOutput = JSON.parse(completed.stdout) as {
        state?: string;
      };
      assert.equal(completedOutput.state, "merged");
      const completedState = parseDeliveryState(
        fs.readFileSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
          "utf8",
        ),
      );
      assert.equal(completedState.state, "step11-recorded");
      assert.deepEqual(completedState.create, pendingState.create);
      assert.deepEqual(completedState.pr, pendingState.pr);
      assert.equal(completedState.merge?.observation?.providerState, "merged");
      assert.equal(
        completedState.merge?.observation?.providerMergedAt,
        mergedAt,
      );
      assert.equal(
        completedState.step11?.evidenceId,
        completedState.merge?.observation?.observationId,
      );
      const completedJournal = parseStepJournal(
        fs.readFileSync(path.join(prepared.staging, STEP_JOURNAL_FILE), "utf8"),
      );
      const step11 = completedJournal.entries.filter(
        (item) => item.step === 11,
      );
      assert.equal(step11.length, 1);
      assert.ok(step11[0]?.artifacts.includes(DELIVERY_STATE_FILE));
      assert.match(
        step11[0]?.evidence ?? "",
        new RegExp(completedState.step11?.evidenceId ?? "^$", "u"),
      );
      assert.equal(
        deliveryProviderCalls(prepared).filter(isMergeCall).length,
        1,
      );
      break;
    }
    case "SCN-E2E-WFSTEP-051": {
      /**
       * **実経路の`pr merge`で単独運用が通ることと、宣言で止まることを測る**
       * （Issue #1317）。
       *
       * `authorizeMerge`は純関数であり、**`pr merge`はその手前で
       * `observeMergeReviewEvidence`内のselectorを通る。** 判定関数だけを直接
       * 呼ぶSCNはこの前段を通らないため、`authorizeMerge`側だけを2モード化しても
       * 既定modeが実経路では到達不能なまま残る欠陥を検出できなかった
       * （独立reviewerの指摘）。
       *
       * implementer・PR author・reviewerをすべて同一actorにして、報告された
       * 単独運用の構成をprovider観測として再現する。
       *
       * **`pr.merge`の呼出回数まで測る。** 文言だけでは、要求を送ってから
       * 落ちる実装と、送らずに拒否する実装を区別できない。
       */
      /**
       * **GitHubで実際に生成できる観測だけを使う**（外部reviewの指摘）。
       *
       * GitHubはPR author自身の`APPROVE`を許可しない。PR authorとreviewerを
       * 同一actorにしたfixtureは**providerが返し得ない状態**であり、実merge経路を
       * 検証したことにならない。
       *
       * **実在する単独運用の形はこれである。** PRはautomation identityが作り、
       * 実装commitを書いた本人が承認する。旧契約はreviewerがimplementation commit
       * authorと同一であることを理由に、この構成を恒常的に拒否していた。
       */
      const soleOperator = {
        prAuthorId: "automation-actor",
        implementationAuthorId: "sole-operator",
        reviewerId: "sole-operator",
      } as const;
      const permitted = prepareDeliveryCli(this, soleOperator);
      createDeliveryPullRequest(permitted);
      const requested = executeDeliveryMerge(permitted);
      assert.equal(
        requested.status,
        0,
        `既定のcontext-isolatedで単独運用のmergeが止まりました: ${requested.stdout}${requested.stderr}`,
      );
      assert.ok(
        deliveryProviderCalls(permitted).filter(isMergeCall).length >= 1,
        "許可したのにproviderへmergeを要求していません",
      );

      const denied = prepareDeliveryCli(
        this,
        soleOperator,
        "automatic",
        "merge",
        "actor-independent",
      );
      createDeliveryPullRequest(denied);
      const before = deliveryProviderCalls(denied).filter(isMergeCall).length;
      const rejected = executeDeliveryMerge(denied);
      assert.notEqual(
        rejected.status,
        0,
        "actor-independentを宣言しても単独運用のmergeを受理しました",
      );
      assert.match(
        rejected.stdout + rejected.stderr,
        /PR author・H_impl authorと独立したreviewがありません/u,
      );
      assert.equal(
        deliveryProviderCalls(denied).filter(isMergeCall).length,
        before,
        "拒否したのにproviderへmergeを要求しています",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-057": {
      const sameActor = "sole-operator";
      const prepared = prepareDeliveryCli(this, {
        prAuthorId: sameActor,
        implementationAuthorId: sameActor,
        reviewerId: sameActor,
        reviewDisposition: "none",
      });
      createDeliveryPullRequest(prepared);
      const requested = executeDeliveryMerge(prepared);
      assert.equal(
        requested.status,
        0,
        `context-isolated formal reviewがmerge認可へ接続されていません: ${requested.stdout}${requested.stderr}`,
      );
      assert.equal(
        deliveryProviderCalls(prepared).filter(isMergeCall).length,
        1,
        "formal reviewで認可したmerge requestは1回だけでなければなりません",
      );
      const state = parseDeliveryState(
        fs.readFileSync(
          path.join(prepared.staging, "journal", "delivery-state.json"),
          "utf8",
        ),
      );
      assert.match(
        state.merge?.reviewId ?? "",
        /^[a-f0-9]{64}$/u,
        "formal review round digestがmerge intentのapproval IDに固定されていません",
      );
      const session = JSON.parse(
        fs.readFileSync(
          path.join(prepared.staging, "review-session.json"),
          "utf8",
        ),
      ) as { latestRoundDigest: string };
      assert.equal(
        state.merge?.reviewId,
        session.latestRoundDigest,
        "merge intentのreviewIdがactual latestRoundDigestと一致しません",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-058": {
      const sameActor = "sole-operator";
      const prepared = prepareDeliveryCli(this, {
        prAuthorId: sameActor,
        implementationAuthorId: sameActor,
        reviewerId: sameActor,
        reviewDisposition: "none",
        mergeStateStatus: "BLOCKED",
        mergeable: "MERGEABLE",
        viewerPermission: "ADMIN",
        rulesetOnly: true,
        mergeImmediately: true,
      });
      createDeliveryPullRequest(prepared);
      const preview = executeCli(
        deliveryMergeArgs(prepared).map((arg) =>
          arg === "--apply" ? "--dry-run" : arg,
        ),
        prepared.root,
        prepared.env,
      );
      assert.equal(preview.status, 0, preview.stdout + preview.stderr);
      assert.equal(
        (JSON.parse(preview.stdout) as { dispatchMode?: string }).dispatchMode,
        "admin",
        "previewがadmin dispatchを表示していません",
      );
      const requested = executeDeliveryMerge(prepared);
      assert.equal(
        requested.status,
        0,
        `GitHub自己承認blockを安全なadmin mergeへ接続できません: ${requested.stdout}${requested.stderr}`,
      );
      const calls = deliveryProviderCalls(prepared).filter(isMergeCall);
      assert.equal(
        calls.length,
        1,
        "admin merge requestは1回だけでなければなりません",
      );
      assert.ok(calls[0]?.includes("--admin"), "admin flagがありません");
      assert.equal(
        calls[0]?.includes("--auto"),
        false,
        "admin mergeへ--autoを混在させています",
      );
      assert.ok(
        calls[0]?.includes("--match-head-commit"),
        "exact head CASがありません",
      );
      const matchHeadIndex = calls[0]?.indexOf("--match-head-commit") ?? -1;
      assert.equal(
        calls[0]?.[matchHeadIndex + 1],
        prepared.headSha,
        "exact head CASが認可済みHEADと一致しません",
      );
      const state = parseDeliveryState(
        fs.readFileSync(
          path.join(prepared.staging, "journal", "delivery-state.json"),
          "utf8",
        ),
      );
      assert.equal(state.merge?.dispatchMode, "admin");
      const legacy = JSON.parse(
        fs.readFileSync(
          path.join(prepared.staging, "journal", "delivery-state.json"),
          "utf8",
        ),
      ) as { merge?: Record<string, unknown> };
      assert.ok(legacy.merge);
      delete legacy.merge.dispatchMode;
      assert.equal(
        parseDeliveryState(JSON.stringify(legacy)).merge?.dispatchMode,
        "normal",
        "dispatchMode欠落の旧stateをnormalとして読めません",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-059": {
      const variants: Array<Partial<DeliveryProviderControl>> = [
        { unknownBranchRule: true },
        { unknownRuleParameter: true },
        { omitPullRequestRule: true },
        { unresolvedReviewThreads: 1 },
        { viewerPermission: "WRITE" },
        { statusCheckConclusion: "FAILURE" },
      ];
      const prepared = prepareDeliveryCli(this, {
        reviewDisposition: "none",
        mergeStateStatus: "BLOCKED",
        mergeable: "MERGEABLE",
        viewerPermission: "ADMIN",
        rulesetOnly: true,
      });
      createDeliveryPullRequest(prepared);
      const persistence = deliveryPersistence(prepared);
      for (const variant of variants) {
        writeDeliveryProviderControl(prepared, {
          unknownBranchRule: false,
          unknownRuleParameter: false,
          omitPullRequestRule: false,
          unresolvedReviewThreads: 0,
          viewerPermission: "ADMIN",
          statusCheckConclusion: "SUCCESS",
          ...variant,
        });
        const before =
          deliveryProviderCalls(prepared).filter(isMergeCall).length;
        const rejected = executeDeliveryMerge(prepared);
        assert.notEqual(rejected.status, 0, "不完全なadmin条件を受理しました");
        assert.deepEqual(deliveryPersistence(prepared), persistence);
        assert.equal(
          deliveryProviderCalls(prepared).filter(isMergeCall).length,
          before,
          "拒否したadmin mergeをproviderへ送っています",
        );
      }
      break;
    }
    case "SCN-E2E-WFSTEP-060": {
      const prepared = prepareDeliveryCli(this);
      createDeliveryPullRequest(prepared);
      const deliveryFile = path.join(
        prepared.staging,
        ...DELIVERY_STATE_FILE.split("/"),
      );
      const delivery = JSON.parse(fs.readFileSync(deliveryFile, "utf8")) as {
        create: { headSha: string };
      };
      delivery.create.headSha = prepared.implementationCommitSha;
      fs.writeFileSync(deliveryFile, `${JSON.stringify(delivery, null, 2)}\n`);
      fs.writeFileSync(
        path.join(prepared.staging, "journal", "reanchor.jsonl"),
        `${JSON.stringify({
          oldHeadSha: prepared.implementationCommitSha,
          newHeadSha: prepared.headSha,
          oldBaseSha: prepared.baseSha,
          newBaseSha: prepared.baseSha,
          diffDigest: "a".repeat(64),
          method: "reviewed-forward",
          reason: "外部reviewer指摘後のexact headへ再固定した",
          recordedAt: fixtureInstant(),
          reviewedForward: {
            sessionId: "b".repeat(64),
            roundDigest: "c".repeat(64),
            implementationSha: prepared.implementationCommitSha,
            artifactPath: "docs/reviews/fixture.md",
            artifactDigest: "d".repeat(64),
          },
        })}\n`,
      );
      refreshStoredStagingDigest(prepared.staging);
      const requested = executeDeliveryMerge(prepared);
      assert.equal(requested.status, 0, requested.stdout + requested.stderr);
      const mergeCalls = deliveryProviderCalls(prepared).filter(isMergeCall);
      assert.equal(mergeCalls.length, 1);
      const headIndex = mergeCalls[0]!.indexOf("--match-head-commit");
      assert.equal(
        mergeCalls[0]![headIndex + 1],
        prepared.headSha,
        "pr mergeが固定create HEADではなく再固定後の実効HEADを送っていません",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-072": {
      /**
       * **Step 8で封印した版管理下full stagingでも、再固定後の`pr merge`は計画凍結を
       * 実効HEAD上で検査する**（Issue #1531、OUTCOME-01）。
       *
       * **再固定は実CLIの`pr reanchor --apply`で作る。** 手書きのreanchor recordでは
       * `pr merge`が記録を消費することしか示せず、OUTCOME-01が名指しする
       * 「AMD追記→`pr reanchor --apply`→`pr merge --dry-run`」の合成経路を通らない
       * （外部review指摘）。
       *
       * 手順: `pr create`で`pr-bound`（AMDを持たない`H_final0`）→前進commitで
       * `05_計画変更.md`のAMD-001を追加（`H_impl1`）→同sessionのround 2→証跡commit
       * （`H_final1`）→実CLIの`workflow record --step=10 --post-pr-intake`→
       * 実CLIの`pr reanchor`（dry-run、apply）→実CLIの`pr merge --dry-run`。
       * 固定済み`create.headSha`（`H_final0`）にはAMDが無いため、固定値のまま
       * 検査すると計画変更記録の不一致としてmerge前に拒否される。
       *
       * **Issue #1495暫定guard（Issue #1544解決まで）により、`pr merge --dry-run`の
       * 最終結果は拒否へ変わる。** `assertWorkflowReadyForDelivery`
       * （`inspectAuthorizedPullRequestMerge`より前に呼ばれる）は`deriveEffectiveHead`が
       * 導出した実効HEAD（reanchor後の`H_final1`／`H_impl1`）で計画凍結を検査するため、
       * ここまでは今までどおり成功し続ける——固定済み`H_final0`基準の古い計画凍結
       * 不一致（`05_計画変更\.mdがworktreeと一致しません`・`計画文書が封印と一致しません`）は
       * 出ない。これが#1531の保証（本scenarioの本来の目的）であり、このscenarioは
       * それを弱めずに検証し続ける。**その後**、`inspectAuthorizedPullRequestMerge`の
       * 暫定guardが`H_impl1 !== session.anchor.initialHeadSha`（round 1の元々の
       * `H_impl0`）を検出して拒否する——`reviewed-forward`はsessionの`H_impl`を
       * 前進させる経路である以上、暫定guard下では常にこの条件に触れる。この
       * scenarioが検証する#1531の保証そのものは無傷だが、「reanchorされたHEADが
       * mergeまで到達する」full end-to-end成功は、#1544が`reviewed-forward`の
       * 健全性を回復するまで一時的に失われる（本file、Issue #1544参照）。
       */
      const prepared = prepareDeliveryCli(
        this,
        {},
        "automatic",
        "merge",
        undefined,
        "full",
      );
      createDeliveryPullRequest(prepared);
      const deliveryFile = path.join(
        prepared.staging,
        ...DELIVERY_STATE_FILE.split("/"),
      );
      const bound = parseDeliveryState(fs.readFileSync(deliveryFile, "utf8"));
      assert.equal(bound.state, "pr-bound");
      assert.equal(bound.create?.headSha, prepared.headSha);
      const git = (args: string[]): string => {
        const result = spawnSync("git", args, {
          cwd: prepared.root,
          encoding: "utf8",
        });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
      };
      const amendmentPath = path
        .relative(
          prepared.root,
          path.join(prepared.staging, PLAN_AMENDMENT_FILE),
        )
        .split(path.sep)
        .join("/");
      const reviewArtifactPath = "docs/reviews/877_review.json";
      // pr create後の前進commit: AMD-001を初めてcommitする。
      fs.writeFileSync(
        path.join(prepared.staging, PLAN_AMENDMENT_FILE),
        TRACKED_FULL_AMENDMENT,
      );
      git(["add", "--", amendmentPath]);
      git(["commit", "-q", "-m", "plan amendment after pr intake"]);
      const forwardImplementation = git(["rev-parse", "HEAD"]);
      // 同sessionのround 2を前進`H_impl`で収束させる。
      const previous = readStoredReviewSession(prepared.staging);
      assert.ok(previous, "round 1のreview sessionがありません");
      recordReviewRound({
        staging: prepared.staging,
        round: parseReviewRoundInput({
          round: 2,
          previousRoundDigest: previous.latestRoundDigest,
          anchor: previous.anchor,
          candidateHeadSha: forwardImplementation,
          focus: {
            previousBlocking: [],
            fixedDiff: [amendmentPath, reviewArtifactPath].sort(),
            adjacentScope: [],
          },
          findings: [],
        }),
      });
      const session = readStoredReviewSession(prepared.staging);
      assert.ok(session);
      assert.equal(session.latestCandidateHeadSha, forwardImplementation);
      // 前進`H_impl`に対する証跡だけを加えた`H_final1`。
      fs.writeFileSync(
        path.join(prepared.root, ...reviewArtifactPath.split("/")),
        reviewEvidenceContentFromStaging(prepared.staging, { issue: 877 }),
      );
      git(["add", "--", reviewArtifactPath]);
      git(["commit", "-q", "-m", "review evidence after pr intake"]);
      const forwardHead = git(["rev-parse", "HEAD"]);
      for (const [commit, present] of [
        [prepared.baseSha, false],
        [prepared.headSha, false],
        [forwardHead, true],
      ] as const)
        assert.equal(
          spawnSync("git", ["cat-file", "-e", `${commit}:${amendmentPath}`], {
            cwd: prepared.root,
          }).status === 0,
          present,
          `${commit}上の${amendmentPath}の有無がfixtureの前提と異なります`,
        );
      const intake = executeCli(
        [
          "workflow",
          "record",
          `--staging=${prepared.staging}`,
          "--step=10",
          "--post-pr-intake",
          `--artifact=${reviewArtifactPath}`,
          "--evidence=pr-bound後の計画変更をround 2で再reviewした",
          `--review-session-digest=${session.latestRoundDigest}`,
        ],
        prepared.root,
        prepared.env,
      );
      assert.equal(intake.status, 0, intake.stdout + intake.stderr);
      // providerは前進pushしたheadをPR headとして返す。
      writeDeliveryProviderControl(prepared, {
        headSha: forwardHead,
        implementationSha: forwardImplementation,
        mergeTreeSha: git([
          "merge-tree",
          "--write-tree",
          prepared.baseSha,
          forwardHead,
        ]),
      });
      const reanchorArgs = [
        "pr",
        "reanchor",
        `--staging=${prepared.staging}`,
        `--root=${prepared.root}`,
        `--new-head=${forwardHead}`,
        `--new-base=${prepared.baseSha}`,
        "--reason=pr-bound後に05_計画変更.mdへAMD-001を追記した前進commitへ再固定する",
      ];
      const chainFile = path.join(
        prepared.staging,
        "journal",
        "reanchor.jsonl",
      );
      const reanchor = (mode: "--dry-run" | "--apply") => {
        const result = executeCli(
          [...reanchorArgs, mode],
          prepared.root,
          prepared.env,
        );
        assert.equal(result.status, 0, result.stdout + result.stderr);
        return JSON.parse(result.stdout) as Record<string, unknown>;
      };
      const preview = reanchor("--dry-run");
      assert.deepEqual(
        [
          preview.state,
          preview.layer,
          preview.chainLength,
          preview.willAppend,
          preview.effectiveHeadSha,
        ],
        ["preview", "delivery", 0, true, forwardHead],
        JSON.stringify(preview),
      );
      assert.equal(
        fs.existsSync(chainFile),
        false,
        "dry-runが再固定chainを書いています",
      );
      const applied = reanchor("--apply");
      assert.deepEqual(
        [
          applied.state,
          applied.layer,
          applied.chainLength,
          applied.effectiveHeadSha,
        ],
        ["reanchored", "delivery", 1, forwardHead],
        JSON.stringify(applied),
      );
      const chain = fs
        .readFileSync(chainFile, "utf8")
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      assert.equal(chain.length, 1);
      assert.equal(chain[0]!.oldHeadSha, prepared.headSha);
      assert.equal(chain[0]!.newHeadSha, forwardHead);
      assert.equal(chain[0]!.method, "reviewed-forward");
      assert.deepEqual(
        (chain[0]!.reviewedForward as Record<string, unknown>)
          .implementationSha,
        forwardImplementation,
      );
      assert.equal(
        parseDeliveryState(fs.readFileSync(deliveryFile, "utf8")).create
          ?.headSha,
        prepared.headSha,
        "pr reanchorが固定済みcreate.headShaを書き換えています",
      );
      const previewed = executeCli(
        deliveryMergeArgs(prepared).map((argument) =>
          argument === "--apply" ? "--dry-run" : argument,
        ),
        prepared.root,
        prepared.env,
      );
      const output = previewed.stdout + previewed.stderr;
      /**
       * **#1531の保証は無傷: 計画凍結は実効HEAD（reanchor後）で評価され、
       * 固定済み`H_final0`基準の古い不一致は出ない。** `assertWorkflowReadyForDelivery`は
       * `inspectAuthorizedPullRequestMerge`より前に呼ばれるため、ここまで到達した
       * 時点でこの2つの回帰検出文言が出ていないことが#1531の保証そのものの証拠になる。
       */
      assert.doesNotMatch(output, /05_計画変更\.mdがworktreeと一致しません/u);
      assert.doesNotMatch(output, /計画文書が封印と一致しません/u);
      /**
       * **Issue #1495暫定guardにより、#1531の保証を通過した後でmergeそのものは
       * 拒否される。** `reviewed-forward`はH_implを前進させる経路であり、暫定guard
       * （Issue #1544解決まで）は`session.anchor.initialHeadSha`（round 1の元々の
       * H_impl）からの1byteの変化も拒否する。ここでは新gateのH_impl不一致条件が
       * 実際に発火したことを、診断文言そのものを名指しして確認する——round-count・
       * 比較基点・digestの条件と取り違えていないことの証拠。
       */
      assert.notEqual(previewed.status, 0, output);
      assert.match(
        output,
        /実効H_impl\(.*\)がreview sessionの初回H_impl\(.*\)と一致しません/u,
        "Issue #1495暫定guardのH_impl不一致診断が出ていません",
      );
      assert.doesNotMatch(
        output,
        /比較基点/u,
        "H_impl不一致ではなく比較基点(base)不一致で拒否されています",
      );
      assert.doesNotMatch(
        output,
        /counted round数/u,
        "H_impl不一致ではなくround数不一致で拒否されています",
      );
      assert.equal(
        deliveryProviderCalls(prepared).filter(isMergeCall).length,
        0,
        "dry-runがmerge要求をproviderへ送っています",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-067": {
      /**
       * **reviewed-forwardが記録したnewBaseShaは、oldBaseShaのancestorであっても
       * 検証済み既定branch tipのancestorでなければmergeを拒否する（Issue #1493
       * round 2、独立reviewの発見）。** `prepared.headSha`はcandidate自身の
       * exact head（`prepared.baseSha`の子孫）であり、既定branch tip
       * （`prepared.baseSha`）のancestorではない。observeReviewedForward自体の
       * ancestor検証（oldBaseSha→newBaseSha）はここでは満たしても、merge直前の
       * 既定branch tip照合で拒否されることを確認する。
       */
      const prepared = prepareDeliveryCli(this);
      createDeliveryPullRequest(prepared);
      const deliveryFile = path.join(
        prepared.staging,
        ...DELIVERY_STATE_FILE.split("/"),
      );
      const delivery = JSON.parse(fs.readFileSync(deliveryFile, "utf8")) as {
        create: { headSha: string };
      };
      delivery.create.headSha = prepared.implementationCommitSha;
      fs.writeFileSync(deliveryFile, `${JSON.stringify(delivery, null, 2)}\n`);
      fs.writeFileSync(
        path.join(prepared.staging, "journal", "reanchor.jsonl"),
        `${JSON.stringify({
          oldHeadSha: prepared.implementationCommitSha,
          newHeadSha: prepared.headSha,
          oldBaseSha: prepared.baseSha,
          newBaseSha: prepared.headSha,
          diffDigest: "a".repeat(64),
          method: "reviewed-forward",
          reason: "既定branch以外へ差し替えたnewBaseSha（攻撃反例）",
          recordedAt: fixtureInstant(),
          reviewedForward: {
            sessionId: "b".repeat(64),
            roundDigest: "c".repeat(64),
            implementationSha: prepared.implementationCommitSha,
            artifactPath: "docs/reviews/fixture.md",
            artifactDigest: "d".repeat(64),
          },
        })}\n`,
      );
      refreshStoredStagingDigest(prepared.staging);
      const requested = executeDeliveryMerge(prepared);
      assert.notEqual(
        requested.status,
        0,
        "既定branch tipのancestorでないnewBaseShaのreviewed-forwardがmergeを通過しました",
      );
      assert.match(requested.stdout + requested.stderr, /実効base.*ancestor/u);
      const mergeCalls = deliveryProviderCalls(prepared).filter(isMergeCall);
      assert.equal(
        mergeCalls.length,
        0,
        "拒否前にmerge要求をproviderへ送っています",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-068": {
      /**
       * **oldBaseShaが検証済み既定branch tip（`prepared.baseSha`）のancestorで、
       * newBaseShaがtip自体と一致する既定branch追随は許可する。** round 2の
       * 拒否条件（SCN-E2E-WFSTEP-067）と対になる、正当なbase変更の回帰確認。
       */
      const prepared = prepareDeliveryCli(this);
      createDeliveryPullRequest(prepared);
      const rootCommit = spawnSync(
        "git",
        ["rev-list", "--max-parents=0", prepared.baseSha],
        { cwd: prepared.root, encoding: "utf8" },
      );
      assert.equal(rootCommit.status, 0, rootCommit.stderr);
      const oldBaseSha = rootCommit.stdout.trim().split("\n")[0]!;
      assert.match(oldBaseSha, /^[a-f0-9]{40}$/u);
      assert.notEqual(oldBaseSha, prepared.baseSha);
      const deliveryFile = path.join(
        prepared.staging,
        ...DELIVERY_STATE_FILE.split("/"),
      );
      const delivery = JSON.parse(fs.readFileSync(deliveryFile, "utf8")) as {
        create: { headSha: string };
      };
      delivery.create.headSha = prepared.implementationCommitSha;
      fs.writeFileSync(deliveryFile, `${JSON.stringify(delivery, null, 2)}\n`);
      fs.writeFileSync(
        path.join(prepared.staging, "journal", "reanchor.jsonl"),
        `${JSON.stringify({
          oldHeadSha: prepared.implementationCommitSha,
          newHeadSha: prepared.headSha,
          oldBaseSha,
          newBaseSha: prepared.baseSha,
          diffDigest: "a".repeat(64),
          method: "reviewed-forward",
          reason: "既定branch追随（正当なbase前進）",
          recordedAt: fixtureInstant(),
          reviewedForward: {
            sessionId: "b".repeat(64),
            roundDigest: "c".repeat(64),
            implementationSha: prepared.implementationCommitSha,
            artifactPath: "docs/reviews/fixture.md",
            artifactDigest: "d".repeat(64),
          },
        })}\n`,
      );
      refreshStoredStagingDigest(prepared.staging);
      const requested = executeDeliveryMerge(prepared);
      assert.equal(requested.status, 0, requested.stdout + requested.stderr);
      const mergeCalls = deliveryProviderCalls(prepared).filter(isMergeCall);
      assert.equal(mergeCalls.length, 1);
      break;
    }
    case "SCN-E2E-WFSTEP-069": {
      /**
       * **同じ非ancestor baseを維持する2件目のreanchorも拒否する（Issue #1493
       * round 3、独立reviewの2件目のHigh指摘）。** 1件目のreanchorで
       * `newBaseSha`をprepared.headSha（既定branch tipのancestorではない）へ
       * 変更し、2件目のreanchorはbaseを変えずにそのまま維持する（`oldBaseSha
       * === newBaseSha`）。round 2時点の実装はterminal recordの
       * `oldBaseSha !== newBaseSha`だけを検査条件にしていたため、この2件目は
       * 検査を素通りしていた。round 3は`deriveEffectiveHead`と同じlink検証を
       * 通過した実効baseを常に検査するため、2件chainでも拒否できることを確認する。
       */
      const prepared = prepareDeliveryCli(this);
      createDeliveryPullRequest(prepared);
      const deliveryFile = path.join(
        prepared.staging,
        ...DELIVERY_STATE_FILE.split("/"),
      );
      const delivery = JSON.parse(fs.readFileSync(deliveryFile, "utf8")) as {
        create: { headSha: string };
      };
      delivery.create.headSha = prepared.implementationCommitSha;
      fs.writeFileSync(deliveryFile, `${JSON.stringify(delivery, null, 2)}\n`);
      const intermediateHeadSha = "e".repeat(40);
      const maliciousBaseSha = prepared.headSha;
      const record1 = {
        oldHeadSha: prepared.implementationCommitSha,
        newHeadSha: intermediateHeadSha,
        oldBaseSha: prepared.baseSha,
        newBaseSha: maliciousBaseSha,
        diffDigest: "a".repeat(64),
        method: "reviewed-forward",
        reason: "既定branch以外へ差し替えたnewBaseSha（1件目、攻撃反例）",
        recordedAt: fixtureInstant(),
        reviewedForward: {
          sessionId: "b".repeat(64),
          roundDigest: "c".repeat(64),
          implementationSha: intermediateHeadSha,
          artifactPath: "docs/reviews/fixture.md",
          artifactDigest: "d".repeat(64),
        },
      };
      const record2 = {
        oldHeadSha: intermediateHeadSha,
        newHeadSha: prepared.headSha,
        oldBaseSha: maliciousBaseSha,
        newBaseSha: maliciousBaseSha,
        diffDigest: "a".repeat(64),
        method: "reviewed-forward",
        reason: "同じ非ancestor baseを維持した2件目（攻撃反例）",
        recordedAt: fixtureInstant({ secondsAhead: 1 }),
        reviewedForward: {
          sessionId: "b".repeat(64),
          roundDigest: "c".repeat(64),
          implementationSha: prepared.implementationCommitSha,
          artifactPath: "docs/reviews/fixture.md",
          artifactDigest: "d".repeat(64),
        },
      };
      fs.writeFileSync(
        path.join(prepared.staging, "journal", "reanchor.jsonl"),
        `${JSON.stringify(record1)}\n${JSON.stringify(record2)}\n`,
      );
      refreshStoredStagingDigest(prepared.staging);
      const requested = executeDeliveryMerge(prepared);
      assert.notEqual(
        requested.status,
        0,
        "2件目のreanchorで同じ非ancestor baseを維持したままmergeが通過しました",
      );
      assert.match(requested.stdout + requested.stderr, /実効base.*ancestor/u);
      const mergeCalls = deliveryProviderCalls(prepared).filter(isMergeCall);
      assert.equal(
        mergeCalls.length,
        0,
        "拒否前にmerge要求をproviderへ送っています",
      );
      break;
    }
    case "SCN-MERGE-BASE-AUDIT-001": {
      /**
       * **base攻撃そのもの（Issue #1495、reanchor無し）。** PR base T; 既定branchが
       * T→M（file `downstream-guard.txt`を追加）へ前進; candidateはTから分岐した
       * 実装commitでMをmergeしてから即座に`downstream-guard.txt`を取り除く。
       * `T..H_impl`のnet diffは（Mの変更が打ち消されているため）Mを一度も
       * mergeしなかった場合と1byteも変わらない。review evidenceは
       * `contextIsolatedReviewEvidence`により素直にT（宣言済み比較基点）と
       * H_impl（攻撃後の実装commit）を検分したものとして生成される
       * （`preparePullRequest`のhookで実装commit自体をこの形にするため、
       * Step 9/10・review sessionは最初からこのH_implだけを対象に作られ、
       * 追加の整合作業は不要）。
       *
       * **旧`#1493` ancestor検査は必ず通過する。** reanchor chainが空
       * （`validCount===0`）なので、そもそも実効base検査は走らない
       * （`inspectAuthorizedPullRequestMerge`のcoverage comment参照）。
       * 新gateだけがこの攻撃を検出する。
       *
       * **実測（このscenarioのfixtureで確認済み）: 発火するのは比較基点不一致
       * 検査である。** `actualAuditBase = merge-base(H_impl, M) = M`
       * （Mはcandidateの`--no-ff` mergeでH_implの祖先になっている）に対し、
       * `session.anchor.diffBaseSha = T`（round 1で固定、reanchor無しなので不変）。
       * `M !== T`のため、5条件のうち最初の比較基点検査がH_impl不一致・round数・
       * digestのいずれよりも先に発火する。
       */
      let advancedBaseSha: string | undefined;
      const prepared = prepareDeliveryCli(
        this,
        {},
        "automatic",
        "merge",
        undefined,
        "quick",
        0,
        "valid",
        false,
        (root, baseSha) => {
          advancedBaseSha = buildDefaultBranchMergeRevertAttack(
            root,
            baseSha,
          ).advancedBaseSha;
        },
      );
      assert.ok(advancedBaseSha, "default branch advanceが構築されていません");
      const mergeTree = spawnSync(
        "git",
        ["merge-tree", "--write-tree", advancedBaseSha!, prepared.headSha],
        { cwd: prepared.root, encoding: "utf8" },
      );
      assert.equal(mergeTree.status, 0, mergeTree.stderr);
      writeDeliveryProviderControl(prepared, {
        remoteBaseSha: advancedBaseSha!,
        mergeTreeSha: mergeTree.stdout.trim(),
      });
      createDeliveryPullRequest(prepared);
      const requested = executeDeliveryMerge(prepared);
      assert.notEqual(
        requested.status,
        0,
        "既定branchをmergeして即revertした攻撃が新gateを通過しました",
      );
      const output = requested.stdout + requested.stderr;
      assert.match(output, /merge-base/u);
      assert.match(
        output,
        /実際のmerge-base\(.*\)がreview sessionの比較基点\(.*\)と一致しません/u,
        "Issue #1495暫定guardの比較基点不一致診断が出ていません",
      );
      assert.doesNotMatch(
        output,
        /実効H_impl\(.*\)がreview sessionの初回H_impl/u,
        "比較基点不一致ではなくH_impl不一致で拒否されています",
      );
      assert.doesNotMatch(
        output,
        /counted round数/u,
        "比較基点不一致ではなくround数不一致で拒否されています",
      );
      assert.match(output, new RegExp(advancedBaseSha!, "u"));
      assert.match(output, new RegExp(prepared.baseSha, "u"));
      const mergeCalls = deliveryProviderCalls(prepared).filter(isMergeCall);
      assert.equal(
        mergeCalls.length,
        0,
        "拒否前にmerge要求をproviderへ送っています",
      );
      break;
    }
    case "SCN-MERGE-BASE-AUDIT-002": {
      /**
       * **既定branchが動いていない場合の回帰確認（Issue #1495）。** 通常fixtureは
       * 何も手を加えなければ`reviewEvidence.baseSha === actualAuditBase`が
       * 自明に成り立つ（Cは1回もmergeを経ないTの直接の子孫であり、
       * `merge-base(C,T)=T`）。新gateがこの最も基本的な経路を壊していないことを
       * 確認する。
       */
      const prepared = prepareDeliveryCli(this);
      createDeliveryPullRequest(prepared);
      const requested = executeDeliveryMerge(prepared);
      assert.equal(requested.status, 0, requested.stdout + requested.stderr);
      const mergeCalls = deliveryProviderCalls(prepared).filter(isMergeCall);
      assert.equal(mergeCalls.length, 1);
      break;
    }
    case "SCN-MERGE-BASE-AUDIT-003": {
      /**
       * **正当に見えるreviewed-forward follow-mainが、暫定guard下では拒否される
       * ことのドキュメント化（Issue #1495、Issue #1544が解決するまでの既知の
       * 使い勝手上のcost。バグではない）。** 既定branchが本当にT→M
       * （`downstream-note.txt`を追加）へ前進し、boundしたH_final(H0)へMを実際に
       * mergeする（SCN-E2E-WFSTEP-072と同型: H0の直接の子として前進commitを作る）。
       * round 2をGitから実測して記録し、新review evidenceは`baseSha=M`・
       * `implementationHeadSha=forwardHead`を正しく宣言する。
       * `workflow record --step=10 --post-pr-intake`でStep 10 bindingを更新した後、
       * 実CLIの`pr reanchor --apply`（`--new-base=M`）は`reviewed-forward`として
       * 受理される——旧`#1493` ancestor検査（`observeReviewedForward`）は
       * `merge-base(forwardHead,M)=M`が宣言済みbaseSha(M)と一致するため、これ自体は
       * 引き続き通過する。
       *
       * **しかしIssue #1495暫定guardは`pr merge`で別に拒否する。** `session.anchor`は
       * round 1で固定された不変値（`diffBaseSha=T`・`initialHeadSha=H_impl0`）であり、
       * round 2やreanchorでは変わらない（`advanceReviewSession`が
       * `previous.sessionId !== sessionId`でanchor変更そのものを拒否する）。暫定guardは
       * `actualAuditBase`（実際のmerge-base）を`session.anchor.diffBaseSha`と、
       * `effectiveImplementationHeadSha`を`session.anchor.initialHeadSha`と、それぞれ
       * 厳密一致で要求する——round 2を経た時点でどちらも原理的に成立しなくなる
       * （実測: `actualAuditBase=merge-base(forwardHead,M)=M`だが
       * `anchor.diffBaseSha=T`であり、比較基点不一致が最初に発火する。base側の検査が
       * H_impl不一致より先に評価されるため、ここで拒否理由は比較基点不一致になる。
       * これはSCN-E2E-WFSTEP-072——既定branchが動かない、H_implだけが前進する
       * ケース——でH_impl不一致が先に発火するのと対照的である）。
       *
       * **この暫定guardが取引するusability costを、成功ではなく拒否として記録する。**
       * 置き換えとなる正当な経路（既定branch前進後は新しいreview sessionを作り
       * 直す）はSCN-MERGE-BASE-AUDIT-012が証明する。
       */
      const prepared = prepareDeliveryCli(this);
      createDeliveryPullRequest(prepared);
      const run = (args: string[]): string => {
        const result = spawnSync("git", args, {
          cwd: prepared.root,
          encoding: "utf8",
        });
        assert.equal(
          result.status,
          0,
          `git ${args.join(" ")}\n${result.stderr}`,
        );
        return result.stdout.trim();
      };
      // 既定branchを実際に前進させる（M）。
      const originalRef = run(["symbolic-ref", "--short", "HEAD"]);
      run([
        "checkout",
        "-q",
        "-b",
        "asc-1495-follow-advance",
        prepared.baseSha,
      ]);
      fs.writeFileSync(
        path.join(prepared.root, "downstream-note.txt"),
        "legitimate default branch advance (Issue #1495 fixture)\n",
      );
      run(["add", "--", "downstream-note.txt"]);
      run(["commit", "-q", "-m", "default branch advance (legitimate)"]);
      const advancedBaseSha = run(["rev-parse", "HEAD"]);
      run(["update-ref", "refs/remotes/origin/main", advancedBaseSha]);
      // H0（bound済みH_final）の直接の子としてMをmergeする。
      run(["checkout", "-q", originalRef]);
      run([
        "merge",
        "-q",
        "asc-1495-follow-advance",
        "-m",
        "merge default branch advance (follow-main)",
      ]);
      const forwardHead = run(["rev-parse", "HEAD"]);
      run(["branch", "-D", "asc-1495-follow-advance"]);
      const draft = buildReviewRoundDraft({
        staging: prepared.staging,
        headSha: forwardHead,
      }).round;
      recordReviewRound({ staging: prepared.staging, round: draft });
      const session = readStoredReviewSession(prepared.staging);
      assert.ok(session, "round 2を記録できていません");
      assert.equal(session!.latestCandidateHeadSha, forwardHead);
      const newContent = reviewEvidenceContentFromStaging(prepared.staging, {
        issue: 877,
        baseSha: advancedBaseSha,
        implementationHeadSha: forwardHead,
      });
      fs.writeFileSync(
        path.join(prepared.root, "docs", "reviews", "877_review.json"),
        newContent,
      );
      run(["add", "--", "docs/reviews/877_review.json"]);
      run(["commit", "-q", "-m", "review evidence (follow-main)"]);
      const newFinalHead = run(["rev-parse", "HEAD"]);
      const intake = executeCli(
        [
          "workflow",
          "record",
          `--staging=${prepared.staging}`,
          "--step=10",
          "--post-pr-intake",
          "--artifact=docs/reviews/877_review.json",
          "--evidence=既定branch追随をfollow-mainでmergeし比較基点をMへ正しく更新した",
          `--review-session-digest=${session!.latestRoundDigest}`,
        ],
        prepared.root,
        prepared.env,
      );
      assert.equal(intake.status, 0, intake.stdout + intake.stderr);
      const mergeTree = spawnSync(
        "git",
        ["merge-tree", "--write-tree", advancedBaseSha, newFinalHead],
        { cwd: prepared.root, encoding: "utf8" },
      );
      assert.equal(mergeTree.status, 0, mergeTree.stderr);
      writeDeliveryProviderControl(prepared, {
        remoteBaseSha: advancedBaseSha,
        headSha: newFinalHead,
        implementationSha: forwardHead,
        mergeTreeSha: mergeTree.stdout.trim(),
      });
      const reanchorArgs = [
        "pr",
        "reanchor",
        `--staging=${prepared.staging}`,
        `--root=${prepared.root}`,
        `--new-head=${newFinalHead}`,
        `--new-base=${advancedBaseSha}`,
        "--reason=既定branch追随をfollow-mainでmergeし比較基点を正しく更新した",
      ];
      const applied = executeCli(
        [...reanchorArgs, "--apply"],
        prepared.root,
        prepared.env,
      );
      assert.equal(applied.status, 0, applied.stdout + applied.stderr);
      const appliedOutput = JSON.parse(applied.stdout) as Record<
        string,
        unknown
      >;
      assert.equal(appliedOutput.state, "reanchored");
      assert.equal(appliedOutput.effectiveHeadSha, newFinalHead);
      const chain = fs
        .readFileSync(
          path.join(prepared.staging, "journal", "reanchor.jsonl"),
          "utf8",
        )
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      assert.equal(chain.length, 1);
      assert.equal(
        chain[0]!.method,
        "reviewed-forward",
        "fixtureがreviewed-forward経路として分類されていません",
      );
      /**
       * **Issue #1495暫定guardは、この正当なfollow-mainを拒否する。** 実測
       * （このscenarioのfixtureで確認済み）: `actualAuditBase`
       * （`merge-base(forwardHead, M)=M`）が`session.anchor.diffBaseSha`（round 1で
       * 固定されたT）と一致しないため、比較基点不一致が最初に発火する——H_impl
       * 不一致・round数不一致・digest不一致のいずれでもない。
       */
      const requested = executeDeliveryMerge(prepared);
      assert.notEqual(
        requested.status,
        0,
        "暫定guard下でreviewed-forward follow-mainがmergeを通過しました（Issue #1544解決までは意図的に拒否されるはず）",
      );
      const output = requested.stdout + requested.stderr;
      assert.match(
        output,
        /実際のmerge-base\(.*\)がreview sessionの比較基点\(.*\)と一致しません/u,
        "Issue #1495暫定guardの比較基点不一致診断が出ていません",
      );
      assert.doesNotMatch(
        output,
        /実効H_impl\(.*\)がreview sessionの初回H_impl/u,
        "比較基点不一致ではなくH_impl不一致で拒否されています",
      );
      assert.doesNotMatch(
        output,
        /counted round数/u,
        "比較基点不一致ではなくround数不一致で拒否されています",
      );
      const mergeCalls = deliveryProviderCalls(prepared).filter(isMergeCall);
      assert.equal(
        mergeCalls.length,
        0,
        "拒否前にmerge要求をproviderへ送っています",
      );
      break;
    }
    case "SCN-MERGE-BASE-AUDIT-008": {
      /**
       * **`reviewed-forward`のreanchor記録が残っていても、宣言はnewBaseShaが
       * 検証済み既定branch tip自身と一致する（Issue #1495）。** 旧`#1493`
       * ancestor検査（`newBaseSha`が既定branch tipのancestorか）は
       * `is-ancestor(M,M)`で自明に通過する。しかし実際に監査すべき範囲の基点は
       * review evidenceが宣言する比較基点（T、攻撃時点のまま）であり、
       * `merge-base(H_impl,M)=M`と食い違う。reanchor記録の`newBaseSha`宣言は
       * 新gateの入力に一切現れないことを、SCN-MERGE-BASE-AUDIT-001と同一の
       * 攻撃fixtureへ記録を1件足すだけで示す。
       *
       * **実測（このscenarioのfixtureで確認済み）: SCN-MERGE-BASE-AUDIT-001と
       * 同じく比較基点不一致検査が発火する。** reanchor記録は手書きで
       * `journal/reanchor.jsonl`へ足しているだけで、`session.anchor`（round 1で
       * 固定）にも`delivery.create.headSha`が指す実際のH_impl（round1攻撃commitの
       * まま）にも影響しない。新gateの5条件はreanchor記録を一切参照しないため
       * （`readEvidenceReanchorChain`ではなく`readStoredReviewSession`の
       * `anchor`だけを見る）、この記録の存在自体が無意味であることも同時に
       * 示している。
       */
      let advancedBaseSha: string | undefined;
      const prepared = prepareDeliveryCli(
        this,
        {},
        "automatic",
        "merge",
        undefined,
        "quick",
        0,
        "valid",
        false,
        (root, baseSha) => {
          advancedBaseSha = buildDefaultBranchMergeRevertAttack(
            root,
            baseSha,
          ).advancedBaseSha;
        },
      );
      assert.ok(advancedBaseSha, "default branch advanceが構築されていません");
      const mergeTree = spawnSync(
        "git",
        ["merge-tree", "--write-tree", advancedBaseSha!, prepared.headSha],
        { cwd: prepared.root, encoding: "utf8" },
      );
      assert.equal(mergeTree.status, 0, mergeTree.stderr);
      writeDeliveryProviderControl(prepared, {
        remoteBaseSha: advancedBaseSha!,
        mergeTreeSha: mergeTree.stdout.trim(),
      });
      createDeliveryPullRequest(prepared);
      const deliveryFile = path.join(
        prepared.staging,
        ...DELIVERY_STATE_FILE.split("/"),
      );
      const delivery = JSON.parse(fs.readFileSync(deliveryFile, "utf8")) as {
        create: { headSha: string };
      };
      delivery.create.headSha = prepared.implementationCommitSha;
      fs.writeFileSync(deliveryFile, `${JSON.stringify(delivery, null, 2)}\n`);
      fs.writeFileSync(
        path.join(prepared.staging, "journal", "reanchor.jsonl"),
        `${JSON.stringify({
          oldHeadSha: prepared.implementationCommitSha,
          newHeadSha: prepared.headSha,
          oldBaseSha: prepared.baseSha,
          newBaseSha: advancedBaseSha,
          diffDigest: "a".repeat(64),
          method: "reviewed-forward",
          reason:
            "既定branch tip自身を宣言したreanchor（旧#1493 ancestor検査は自明に通過する、Issue #1495攻撃反例）",
          recordedAt: fixtureInstant(),
          reviewedForward: {
            sessionId: "b".repeat(64),
            roundDigest: "c".repeat(64),
            implementationSha: prepared.implementationCommitSha,
            artifactPath: "docs/reviews/877_review.json",
            artifactDigest: "d".repeat(64),
          },
        })}\n`,
      );
      refreshStoredStagingDigest(prepared.staging);
      const requested = executeDeliveryMerge(prepared);
      assert.notEqual(
        requested.status,
        0,
        "旧ancestor検査を通過するreanchor宣言を足した攻撃が新gateを通過しました",
      );
      const output = requested.stdout + requested.stderr;
      assert.match(output, /merge-base/u);
      assert.match(
        output,
        /実際のmerge-base\(.*\)がreview sessionの比較基点\(.*\)と一致しません/u,
        "Issue #1495暫定guardの比較基点不一致診断が出ていません",
      );
      assert.doesNotMatch(
        output,
        /実効base.*ancestor/u,
        "新gateではなく旧#1493 ancestor検査で拒否されています",
      );
      assert.doesNotMatch(
        output,
        /実効H_impl\(.*\)がreview sessionの初回H_impl/u,
        "比較基点不一致ではなくH_impl不一致で拒否されています",
      );
      assert.doesNotMatch(
        output,
        /counted round数/u,
        "比較基点不一致ではなくround数不一致で拒否されています",
      );
      const mergeCalls = deliveryProviderCalls(prepared).filter(isMergeCall);
      assert.equal(
        mergeCalls.length,
        0,
        "拒否前にmerge要求をproviderへ送っています",
      );
      break;
    }
    case "SCN-MERGE-BASE-AUDIT-009": {
      /**
       * **「trivial round 2 + reanchor」攻撃の再現（Issue #1495、Step 10 round 2
       * 独立reviewのHigh指摘、中間fixを破った実際の反例）。**
       *
       * round 1のH_implはSCN-MERGE-BASE-AUDIT-001と完全に同一の攻撃形
       * （T; 既定branchがT→M（`downstream-guard.txt`追加）へ前進; candidateは
       * Tから分岐した実装commitでMを`--no-ff`でmergeしてから即座に
       * `downstream-guard.txt`を取り除く）。honestにT..H_implで検分され、
       * round 1として収束する。
       *
       * **中間fix（`reviewEvidenceBindingErrors`をsessionの比較基点との厳密一致へ
       * 強化）はSCN-MERGE-BASE-AUDIT-001/008型の「reanchorを経ない裸のbase
       * 宣言」だけを塞いでいた。** round 2独立reviewは、round 1のH_impl
       * （攻撃commit）へ内容的に無関係なtrivial commit（`trivial-round2.txt`）を
       * 1件積むだけで、真の・content差分のある「新しいreview round」として
       * 合法的に収束させられることを発見した。round収束のmechanics自体は
       * 「前roundHEADから新HEADへの実差分が空でない」ことしか要求せず、
       * 宣言するbaseとの内容的関連は一切問わない。この2件目のroundで
       * `workflow record --step=10 --post-pr-intake`の正当なjournal bindingを
       * 取得し、真の既定branch tip`M`（round 1の攻撃で既にH_implへ`--no-ff`で
       * mergeされ、ancestorとして残っているcommit）を`--new-base`に宣言する
       * 実`pr reanchor --apply`を実行すると、`observeReviewedForward`の構造的
       * 検査（H0がforwardHeadのancestorであること・artifactが単一parentの
       * evidence-only suffixであること・`acceptedSessionEvidence`のpostPrIntake
       * binding）はすべて満たされ、`reviewed-forward`として受理される
       * （中間fixのsession比較基点厳密一致要求も、`baseSha=M`・
       * `implementationHeadSha=trivialImplHead`が新round収束後の
       * `session.latestCandidateHeadSha`と一致するため、H_impl不変分岐にすら
       * 入らず素通りする）。
       *
       * `downstream-guard.txt`の巻き戻しは、round 1の`T..H_impl`のnet diffにも、
       * round 2の`fixedDiff`（前roundHEAD→trivialImplHead、
       * `trivial-round2.txt`の追加だけ）にも一度も現れない。旧（round 2独立review
       * 当時の）中間fixが検査していたのはreview evidenceが宣言する比較基点と
       * changed-pathの部分集合関係だけであり、この非対称性を見逃していた。
       *
       * **現行の新gate（Issue #1495暫定guard）は、この攻撃を2つの独立した理由で
       * 拒否できる状態にある。** (1) `session.anchor`はround 1で固定される不変値
       * （`advanceReviewSession`が`previous.sessionId !== sessionId`でanchor変更
       * そのものを拒否するため、round 2を足しても`anchor.diffBaseSha=T`は動かない）
       * ため`actualAuditBase=merge-base(trivialImplHead, M)=M`（Mはround 1の
       * `--no-ff` mergeでtrivialImplHeadの祖先になっている）との比較基点不一致が
       * 成立し、(2) `countedRounds=2`（round 1 + round 2）でも暫定guardの
       * 「counted round数は1でなければならない」条件に反する。**実測
       * （このscenarioのfixtureで確認済み）: 5条件は比較基点検査から順に評価
       * されるため、(1)の比較基点不一致が(2)のround数不一致より先に発火する。**
       * `M..H_impl`にだけ`downstream-guard.txt`が現れるという、この攻撃固有の
       * digest-level非対称性そのもの（round 3が実際に発見したhunk-revert型の
       * 中心的な弱点）を専門に検出する回帰確認はSCN-MERGE-BASE-AUDIT-010が担う。
       */
      let advancedBaseSha: string | undefined;
      const prepared = prepareDeliveryCli(
        this,
        {},
        "automatic",
        "merge",
        undefined,
        "quick",
        0,
        "valid",
        false,
        (root, baseSha) => {
          advancedBaseSha = buildDefaultBranchMergeRevertAttack(
            root,
            baseSha,
          ).advancedBaseSha;
        },
      );
      assert.ok(advancedBaseSha, "default branch advanceが構築されていません");
      const mergeTreeRound1 = spawnSync(
        "git",
        ["merge-tree", "--write-tree", advancedBaseSha!, prepared.headSha],
        { cwd: prepared.root, encoding: "utf8" },
      );
      assert.equal(mergeTreeRound1.status, 0, mergeTreeRound1.stderr);
      writeDeliveryProviderControl(prepared, {
        remoteBaseSha: advancedBaseSha!,
        mergeTreeSha: mergeTreeRound1.stdout.trim(),
      });
      createDeliveryPullRequest(prepared);
      const run = (args: string[]): string => {
        const result = spawnSync("git", args, {
          cwd: prepared.root,
          encoding: "utf8",
        });
        assert.equal(
          result.status,
          0,
          `git ${args.join(" ")}\n${result.stderr}`,
        );
        return result.stdout.trim();
      };
      // round 2: bound H_final（H0）の直接の子として、内容的に無関係なtrivial
      // commitを1件積むだけ（Mの再mergeは行わない——round 1で既にH_implへ
      // 入っている）。
      fs.writeFileSync(
        path.join(prepared.root, "trivial-round2.txt"),
        "content-unrelated trivial round 2 (Issue #1495 round 2 repro)\n",
      );
      run(["add", "--", "trivial-round2.txt"]);
      run(["commit", "-q", "-m", "trivial round 2 (content-unrelated)"]);
      const trivialImplHead = run(["rev-parse", "HEAD"]);
      const draft = buildReviewRoundDraft({
        staging: prepared.staging,
        headSha: trivialImplHead,
      }).round;
      recordReviewRound({ staging: prepared.staging, round: draft });
      const session = readStoredReviewSession(prepared.staging);
      assert.ok(session, "round 2を記録できていません");
      assert.equal(session!.latestCandidateHeadSha, trivialImplHead);
      const newContent = reviewEvidenceContentFromStaging(prepared.staging, {
        issue: 877,
        baseSha: advancedBaseSha!,
        implementationHeadSha: trivialImplHead,
      });
      fs.writeFileSync(
        path.join(prepared.root, "docs", "reviews", "877_review.json"),
        newContent,
      );
      run(["add", "--", "docs/reviews/877_review.json"]);
      run(["commit", "-q", "-m", "review evidence (trivial round 2)"]);
      const newFinalHead = run(["rev-parse", "HEAD"]);
      const intake = executeCli(
        [
          "workflow",
          "record",
          `--staging=${prepared.staging}`,
          "--step=10",
          "--post-pr-intake",
          "--artifact=docs/reviews/877_review.json",
          "--evidence=無関係なtrivial round 2を記録し比較基点をMへ宣言した",
          `--review-session-digest=${session!.latestRoundDigest}`,
        ],
        prepared.root,
        prepared.env,
      );
      assert.equal(intake.status, 0, intake.stdout + intake.stderr);
      const mergeTreeRound2 = spawnSync(
        "git",
        ["merge-tree", "--write-tree", advancedBaseSha!, newFinalHead],
        { cwd: prepared.root, encoding: "utf8" },
      );
      assert.equal(mergeTreeRound2.status, 0, mergeTreeRound2.stderr);
      writeDeliveryProviderControl(prepared, {
        remoteBaseSha: advancedBaseSha!,
        headSha: newFinalHead,
        implementationSha: trivialImplHead,
        mergeTreeSha: mergeTreeRound2.stdout.trim(),
      });
      const reanchorArgs = [
        "pr",
        "reanchor",
        `--staging=${prepared.staging}`,
        `--root=${prepared.root}`,
        `--new-head=${newFinalHead}`,
        `--new-base=${advancedBaseSha}`,
        "--reason=無関係なtrivial round 2で得た正当なbindingで真の既定branch tipへreanchorする",
      ];
      const applied = executeCli(
        [...reanchorArgs, "--apply"],
        prepared.root,
        prepared.env,
      );
      assert.equal(applied.status, 0, applied.stdout + applied.stderr);
      const appliedOutput = JSON.parse(applied.stdout) as Record<
        string,
        unknown
      >;
      assert.equal(appliedOutput.state, "reanchored");
      assert.equal(appliedOutput.effectiveHeadSha, newFinalHead);
      const chain = fs
        .readFileSync(
          path.join(prepared.staging, "journal", "reanchor.jsonl"),
          "utf8",
        )
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      assert.equal(chain.length, 1);
      assert.equal(
        chain[0]!.method,
        "reviewed-forward",
        "trivial round 2独立reviewが破ったreviewed-forward経路として分類されていません",
      );
      /**
       * **旧#1493 ancestor検査（実効base検査）はここまでで一度もこの宣言を
       * 拒否していない。** `M`は検証済み既定branch tip自身であり、
       * `is-ancestor(M,M)`は自明に成立する（SCN-MERGE-BASE-AUDIT-008と同型の
       * 非対称性）。新gateだけが`pr merge`側で検出する。
       */
      const requested = executeDeliveryMerge(prepared);
      assert.notEqual(
        requested.status,
        0,
        "無関係なtrivial round 2 + reviewed-forward reanchorを経た攻撃が新gateを通過しました",
      );
      const output = requested.stdout + requested.stderr;
      assert.match(output, /merge-base/u);
      /**
       * **実測（このscenarioのfixtureで確認済み）: 比較基点不一致検査が
       * round数不一致検査より先に発火する。** 両方とも本来この攻撃を拒否できる
       * 条件だが、`inspectAuthorizedPullRequestMerge`は比較基点検査を
       * round数検査より前に評価するため、拒否理由は比較基点不一致になる
       * （`counted round数`という文言は出ない）。
       */
      assert.match(
        output,
        /実際のmerge-base\(.*\)がreview sessionの比較基点\(.*\)と一致しません/u,
        "Issue #1495暫定guardの比較基点不一致診断が出ていません",
      );
      assert.doesNotMatch(
        output,
        /counted round数/u,
        "比較基点不一致ではなくround数不一致で拒否されています",
      );
      assert.doesNotMatch(
        output,
        /実効H_impl\(.*\)がreview sessionの初回H_impl/u,
        "比較基点不一致ではなくH_impl不一致で拒否されています",
      );
      assert.doesNotMatch(
        output,
        /実効base.*ancestor/u,
        "新gateではなく旧#1493 ancestor検査（reanchor chain実効base検査）で" +
          "拒否されています——reanchorが`M`を宣言している以上この旧検査は" +
          "is-ancestor(M,M)で自明に通過するはずであり、新gate以外で拒否されて" +
          "いるなら攻撃の再現が意図どおりでない",
      );
      assert.match(output, new RegExp(advancedBaseSha!, "u"));
      assert.match(output, new RegExp(prepared.baseSha, "u"));
      const mergeCalls009 = deliveryProviderCalls(prepared).filter(isMergeCall);
      assert.equal(
        mergeCalls009.length,
        0,
        "拒否前にmerge要求をproviderへ送っています",
      );
      break;
    }
    case "SCN-MERGE-BASE-AUDIT-010": {
      /**
       * **同一round内の部分的hunk revert攻撃（Issue #1495、round 3独立reviewの
       * High指摘の核心形。`buildPartialHunkRevertAttack`参照）。** reanchor無し・
       * round 1件だけ。default branchの前進と、candidate自身の正当な変更が、
       * **同じ既存file`shared.txt`の別々の行**を触る。旧（この設計より前の）
       * changed-path部分集合検査は、`T..H_impl`と`M..H_impl`のchanged-path集合が
       * どちらも`{shared.txt}`で完全に一致するため、これを見逃していた
       * （`buildPartialHunkRevertAttack`のdoc comment参照）。
       *
       * **実測で確認した、重要な発見（このtaskの分析文書の想定と異なる）:**
       * この攻撃を拒否するのは digest不一致検査ではなく、SCN-MERGE-BASE-AUDIT-001
       * と同じ**比較基点不一致検査**である。理由は数学的に必然:
       * `pr merge`の暫定guardは (1) `actualAuditBase === anchor.diffBaseSha`
       * と (2) `effectiveImplementationHeadSha === anchor.initialHeadSha` を
       * **digest再計算より先に**厳密一致で要求する。この攻撃が成立する
       * （=最終的にmergeされる内容から本当にMの変更が消える）ためには、
       * candidateが実際に`--no-ff`でMをmergeし、Mを自分のancestorにする必要が
       * ある——そうしなければ、GitHubの実merge処理（3-way merge）が
       * base(T)から見て変化していない側（candidate側）を「Mの変更を受け取る側」
       * として扱い、Mの変更を自動的に復元してしまう（=攻撃が成立しない）。
       * しかしMが実際にancestorになった時点で、`merge-base(H_impl,M)=M`が
       * 常に成立し、`M !== anchor.diffBaseSha(=T)`により比較基点不一致が
       * digest検査へ到達する前に必ず発火する。**つまりhunk単位であれ
       * whole-file単位であれ、「mergeしてから打ち消す」型の攻撃はすべて
       * 比較基点不一致検査だけで閉じる——digest再計算検査は、この攻撃族に
       * 対しては（base・H_impl両方が厳密一致した後にしか評価されないため）
       * 数学的に到達不能な防御線になっている。** base・H_implが両方とも
       * anchorと一致した時点で、そこから計算するdiffはanchor作成時に
       * 計算したdiffと同じ2つのcommit SHA間のdiffであり、Git diffは
       * commit SHAの組に対して決定的なため、digestは必ず一致する
       * （これは実装のbugではなく、2つの厳密一致検査の論理的帰結）。
       *
       * **この発見は分析文書のitem 5の想定（「digest検査がhunk-revertを
       * 検出する」）と食い違う。** 実際にhunk-revert攻撃を閉じているのは
       * 比較基点不一致検査（item 3のREV-02是正そのもの）であり、これは
       * whole-file攻撃（SCN-MERGE-BASE-AUDIT-001）を閉じているのと**同じ
       * 検査**である。digest再計算検査はcodeとして存在し続けるが、この攻撃族に
       * 対しては到達不能なdefense-in-depthである（session-store fileの直接
       * 改ざんのような、Git commit graphを経由しない別種の攻撃に対しては
       * 依然として意味を持ちうる）。owner・parent sessionへ報告する。
       */
      let advancedBaseSha: string | undefined;
      const prepared = prepareDeliveryCli(
        this,
        {},
        "automatic",
        "merge",
        undefined,
        "quick",
        0,
        "valid",
        false,
        (root, baseSha) => {
          advancedBaseSha = buildPartialHunkRevertAttack(
            root,
            baseSha,
          ).advancedBaseSha;
        },
      );
      assert.ok(advancedBaseSha, "default branch advanceが構築されていません");
      const mergeTree = spawnSync(
        "git",
        ["merge-tree", "--write-tree", advancedBaseSha!, prepared.headSha],
        { cwd: prepared.root, encoding: "utf8" },
      );
      assert.equal(mergeTree.status, 0, mergeTree.stderr);
      writeDeliveryProviderControl(prepared, {
        remoteBaseSha: advancedBaseSha!,
        mergeTreeSha: mergeTree.stdout.trim(),
      });
      createDeliveryPullRequest(prepared);
      const requested = executeDeliveryMerge(prepared);
      assert.notEqual(
        requested.status,
        0,
        "同一round内の部分的hunk revert攻撃が新gateを通過しました",
      );
      const output = requested.stdout + requested.stderr;
      assert.match(output, /merge-base/u);
      assert.match(
        output,
        /実際のmerge-base\(.*\)がreview sessionの比較基点\(.*\)と一致しません/u,
        "Issue #1495暫定guardの比較基点不一致診断が出ていません",
      );
      assert.doesNotMatch(
        output,
        /実効H_impl\(.*\)がreview sessionの初回H_impl/u,
        "比較基点不一致ではなくH_impl不一致で拒否されています",
      );
      assert.doesNotMatch(
        output,
        /counted round数/u,
        "比較基点不一致ではなくround数不一致で拒否されています",
      );
      assert.match(output, new RegExp(advancedBaseSha!, "u"));
      assert.match(output, new RegExp(prepared.baseSha, "u"));
      const mergeCalls = deliveryProviderCalls(prepared).filter(isMergeCall);
      assert.equal(
        mergeCalls.length,
        0,
        "拒否前にmerge要求をproviderへ送っています",
      );
      break;
    }
    case "SCN-MERGE-BASE-AUDIT-011": {
      /**
       * **round 1の`--base`自己申告そのものを拒否する回帰確認（Issue #1495、
       * REV-02是正の発生点そのもの。`buildReviewRoundDraft`、item 3）。**
       * round 3独立reviewの4件目の反例: `session.anchor.diffBaseSha`自体を
       * 任意の無関係な古いcommitへ宣言できてしまえば、`pr merge`側の比較基点
       * 一致検査は宣言側を実際のmerge-baseへ合わせるだけで通ってしまう
       * （report宣言と実測を両方攻撃者が制御できるため）。この検査は
       * `pr merge`側ではなく`review round --init`側（round 1作成時点、
       * まだPR番号が無くprovider認可APIを呼べない地点）に置く必要がある——
       * それがREV-02是正の設計そのものである。
       *
       * ここでは実CLIの`review round --init`を、観測済み既定branch tip
       * （`refs/remotes/origin/HEAD`が指す`prepared.baseSha`）とも、
       * headとそのtipから計算した実際のmerge-base（この通常fixtureでは
       * `prepared.baseSha`自身と一致する）とも異なる、無関係な祖先
       * （repositoryのroot commit）を`--base`に宣言して呼び、拒否されることを
       * 確認する。
       *
       * **既存のreview sessionを破棄してから呼ぶ。** 通常の`prepareDeliveryCli`は
       * 既にround 1（`previous!==null`）を構築済みであり、`buildReviewRoundDraft`は
       * `previous!==null`のときround 1の`--base`検証（このscenarioが検査したい
       * 分岐）を経由しない。`review-session.json`を削除して`previous===null`の
       * round 1経路を強制する。
       */
      const prepared = prepareDeliveryCli(this);
      createDeliveryPullRequest(prepared);
      fs.rmSync(path.join(prepared.staging, "review-session.json"), {
        force: true,
      });
      // Step 9 bindingが指すexact commit（review evidence commitより前）へ
      // current HEADを合わせる（`buildReviewRoundDraft`はcurrent HEADと`--head`の
      // 厳密一致を要求する）。
      const checkout = spawnSync(
        "git",
        ["checkout", "-q", "--detach", prepared.implementationCommitSha],
        { cwd: prepared.root, encoding: "utf8" },
      );
      assert.equal(checkout.status, 0, checkout.stderr);
      const rootCommit = spawnSync(
        "git",
        ["rev-list", "--max-parents=0", prepared.baseSha],
        { cwd: prepared.root, encoding: "utf8" },
      );
      assert.equal(rootCommit.status, 0, rootCommit.stderr);
      const unrelatedBaseSha = rootCommit.stdout.trim().split("\n")[0]!;
      assert.match(unrelatedBaseSha, /^[a-f0-9]{40}$/u);
      assert.notEqual(unrelatedBaseSha, prepared.baseSha);
      const outPath = path.join(
        this.temp("asc-1495-round-draft-"),
        "round-draft.json",
      );
      const attempted = executeCli(
        [
          "review",
          "round",
          `--staging=${prepared.staging}`,
          "--init",
          `--out=${outPath}`,
          `--head=${prepared.implementationCommitSha}`,
          `--base=${unrelatedBaseSha}`,
          "--scope=SCOPE-WORKFLOW",
          "--ac=AC-WF-005",
        ],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(
        attempted.status,
        0,
        "無関係な祖先を--baseに自己申告したreview round --initが通過しました",
      );
      const output = attempted.stdout + attempted.stderr;
      assert.match(
        output,
        /review round --initの--base\(.*\)が.*一致しません/u,
        "Issue #1495 REV-02是正のround 1 --base検証診断が出ていません",
      );
      assert.match(output, new RegExp(unrelatedBaseSha, "u"));
      assert.equal(
        fs.existsSync(outPath),
        false,
        "拒否前にround draftを書き出しています",
      );
      assert.equal(
        readStoredReviewSession(prepared.staging),
        null,
        "拒否されたはずのround --initがreview sessionを永続化しています",
      );
      break;
    }
    case "SCN-MERGE-BASE-AUDIT-012": {
      /**
       * **暫定guardが指し示す置き換え経路そのものの回帰確認（Issue #1495、
       * AC-003の裏面）。** SCN-MERGE-BASE-AUDIT-003と同じく既定branchの前進を
       * mergeで取り込み、旧sessionのround 2とreviewed-forwardを経たPRは
       * 暫定guardで拒否される。暫定guardの診断が案内する同一PR・同一stagingでの
       * review session置換（Issue #1569、TERM-1569-01）を公式経路で実行し、
       * 実際のmerge-baseを比較基点とするround 1で収束させると`pr merge`が許可される。
       *
       * **`review-session.json`の削除、journalの手書き置換、`delivery.create.headSha`の
       * 直接更新は行わない。** 置換は`review replace --apply`、round 1は置換記録の
       * H_implへdetachした`review round`、PR headの移動は`pr reanchor`の
       * `session-replacement`だけで行う。
       */
      const fixture = followedMainReplacementFixture(this);
      const rejected = executeDeliveryMerge(fixture.prepared);
      assert.notEqual(rejected.status, 0);
      assert.match(
        rejected.stdout + rejected.stderr,
        /実際のmerge-base\(.*\)がreview sessionの比較基点\(.*\)と一致しません/u,
      );
      replaceAndReconverge(fixture);
      const session = readStoredReviewSession(fixture.prepared.staging);
      assert.equal(session?.anchor.diffBaseSha, fixture.baseSha);
      assert.equal(session?.anchor.initialHeadSha, fixture.implementationSha);
      const requested = executeDeliveryMerge(fixture.prepared);
      assert.equal(requested.status, 0, requested.stdout + requested.stderr);
      const mergeCalls = deliveryProviderCalls(fixture.prepared).filter(
        isMergeCall,
      );
      assert.equal(mergeCalls.length, 1);
      break;
    }
    case "SCN-MERGE-BASE-AUDIT-004": {
      /**
       * rebase経路での同一攻撃の試み(Issue #1495)。実測の結論: pr-bound後は
       * rebase分類そのものがevaluateEvidenceReanchor自身によって拒否され、
       * 新gateへ到達する前に止まる。通常fixture(T,C,H0)をPR createで固定した後、
       * pr reanchor --apply(比較基点T不変)でH_implをC->merge(M)->revertへ
       * 差し替える。差し替え後のT..H_impl diffはCと1byteも変わらないため、
       * evaluateEvidenceReanchorの内容等価性判定(isRebaseEquivalent)自体は
       * rebase(reason: "ok")を返す(comparableReviewEvidence("rebase")が
       * baseSha・implementationHeadSha・impactを比較対象から除くため)。
       *
       * しかしevaluateEvidenceReanchorはここでもう1段、method自体を検査する。
       * src/adapters/evidence-reanchor.tsのevaluateEvidenceReanchor終盤:
       *   if (anchor.prBound && method !== "artifact-replacement" &&
       *       method !== "artifact-supersession" && method !== "reviewed-forward")
       *     throw new Error("pr reanchorのpr-bound再固定は監査合格済みartifact改名、
       *       または明示したpost-PR intakeとexact review bindingを持つ前進commitだけを
       *       受理します");
       * pr createで固定した後(anchor.prBound===true)はrebase分類そのものが
       * 許可method集合に無いため、内容等価性が成立していてもpr reanchor --apply
       * 自体がここで拒否される。rebaseはreview層(review reanchor、PR binding前)
       * 専用の分類であり、pr-bound後にmerge-base監査attackへ到達する経路として
       * 使えない。新gate(resolveUniqueMergeBase突合)より手前、reanchor自体の
       * 受理判定で止まることを確認する。
       */
      const prepared = prepareDeliveryCli(this);
      createDeliveryPullRequest(prepared);
      const oldContent = spawnSync(
        "git",
        ["show", `${prepared.headSha}:docs/reviews/877_review.json`],
        { cwd: prepared.root, encoding: "utf8" },
      );
      assert.equal(oldContent.status, 0, oldContent.stderr);
      const oldEvidence = parseReviewEvidence(oldContent.stdout);
      const attack = buildRebaseMergeRevertAttack(prepared.root, {
        parentSha: prepared.implementationCommitSha,
        baseSha: prepared.baseSha,
        oldEvidence,
        artifactPath: "docs/reviews/877_review.json",
      });
      const reanchorArgs = [
        "pr",
        "reanchor",
        `--staging=${prepared.staging}`,
        `--root=${prepared.root}`,
        `--new-head=${attack.finalHeadSha}`,
        `--new-base=${prepared.baseSha}`,
        "--reason=既定branch追随をmergeしてから同じ変更をrevertした(Issue #1495 fixture)",
      ];
      const applied = executeCli(
        [...reanchorArgs, "--apply"],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(
        applied.status,
        0,
        "pr-bound後のrebase分類が受理されてしまいました(pr-bound method制限が壊れています)",
      );
      const output = applied.stdout + applied.stderr;
      assert.match(
        output,
        /pr-bound再固定は監査合格済みartifact改名、または明示したpost-PR intake/u,
        "想定と異なる理由で拒否されています(evaluateEvidenceReanchorのpr-bound method制限以外)",
      );
      assert.doesNotMatch(
        output,
        /merge-base/u,
        "新gateまで到達してから拒否されています(reanchor自体で止まる想定と異なります)",
      );
      const chainFile = path.join(
        prepared.staging,
        "journal",
        "reanchor.jsonl",
      );
      assert.equal(
        fs.existsSync(chainFile),
        false,
        "拒否されたreanchorがchainへ書き込まれています",
      );
      break;
    }
    case "SCN-MERGE-BASE-AUDIT-005": {
      /**
       * artifact-replacement経路での同一攻撃の試み（Issue #1495）。実測の結論:
       * observeArtifactReplacementは新旧artifactのbyte完全一致（同一base・同一
       * H_impl、pathだけが違う）を要求するため、H_implを変える攻撃はこの経路を
       * 構造的に使えない。
       *
       * artifact-replacementの本来の形（同一base・同一H_impl、artifact pathだけを
       * 変える）を装うには、新evidenceのimplementationHeadShaを変えないまま新path
       * へ書く必要がある。しかしそれではH_implが変わらず、merge-base攻撃（Mを
       * mergeしてから即revertし、真のmerge-baseをMへ動かす）を一切表現できない。
       * そこで実際に試すのは「H_implを変えつつpathも変える」構成である。これは
       * evaluateEvidenceReanchorの以下の経路をすべて落ちる。
       *   1. isContentEquivalent（浅い判定、H_final全体のdiff）: artifactの内容も
       *      path混みで変わるためfalse
       *   2. observeRebaseEquivalence: beforeArtifactPath !== afterArtifactPathで
       *      "artifact-path-changed"（"ok"ではない）
       *   3. observeArtifactReplacement: oldArtifact !== newArtifact（H_implの
       *      宣言値が違うためbyteが一致しない）でundefined
       *   4. observeArtifactSupersession: 新H_finalの親が旧H_finalではない
       *      （新H_implの直後commitである）ためundefined
       *   5. observeReviewedForward: 旧H_finalが新H_implのancestorではない
       *      （branchが分岐しているため）observeReviewDiffが失敗しundefined
       * 結果、evaluateEvidenceReanchorは「再固定前後の内容が等価ではありません
       * （artifact-path-changed）」で拒否する。新gate（resolveUniqueMergeBase突合）
       * より手前、reanchor自体の等価性判定で止まる。
       */
      const prepared = prepareDeliveryCli(this);
      createDeliveryPullRequest(prepared);
      const oldContent = spawnSync(
        "git",
        ["show", `${prepared.headSha}:docs/reviews/877_review.json`],
        { cwd: prepared.root, encoding: "utf8" },
      );
      assert.equal(oldContent.status, 0, oldContent.stderr);
      const oldEvidence = parseReviewEvidence(oldContent.stdout);
      const attack = buildRebaseMergeRevertAttack(
        prepared.root,
        {
          parentSha: prepared.implementationCommitSha,
          baseSha: prepared.baseSha,
          oldEvidence,
          artifactPath: "docs/reviews/877_review_v2.json",
        },
        { advanceFile: "downstream-guard-005.txt" },
      );
      const reanchorArgs = [
        "pr",
        "reanchor",
        `--staging=${prepared.staging}`,
        `--root=${prepared.root}`,
        `--new-head=${attack.finalHeadSha}`,
        `--new-base=${prepared.baseSha}`,
        "--reason=artifact pathを変えつつH_implも変えた（Issue #1495 fixture）",
      ];
      const applied = executeCli(
        [...reanchorArgs, "--apply"],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(
        applied.status,
        0,
        "H_implを変えたartifact-replacement風の攻撃が受理されてしまいました",
      );
      const output = applied.stdout + applied.stderr;
      assert.match(
        output,
        /再固定前後の内容が等価ではありません/u,
        "想定と異なる理由で拒否されています",
      );
      assert.match(output, /artifact-path-changed/u);
      assert.doesNotMatch(
        output,
        /merge-base/u,
        "新gateまで到達してから拒否されています(reanchor自体で止まる想定と異なります)",
      );
      const chainFile = path.join(
        prepared.staging,
        "journal",
        "reanchor.jsonl",
      );
      assert.equal(
        fs.existsSync(chainFile),
        false,
        "拒否されたreanchorがchainへ書き込まれています",
      );
      break;
    }
    case "SCN-MERGE-BASE-AUDIT-006": {
      /**
       * artifact-supersession経路での同一攻撃の試み（Issue #1495）。実測の結論:
       * observeArtifactSupersessionはoldEvidence.implementationHeadSha ===
       * newEvidence.implementationHeadShaを明示的に要求するため（src/adapters/
       * evidence-reanchor.tsのobserveArtifactSupersession）、H_implを変える攻撃は
       * この経路も構造的に使えない。
       *
       * さらに、artifact pathとH_impl直前diffの形をartifact-supersession向け
       * （新H_finalの親を旧H_finalそのものにし、artifact pathも変えない）に
       * 揃えると、evaluateEvidenceReanchorの分類はobserveArtifactSupersessionへ
       * すら到達しない。isContentEquivalent（浅い判定）は証跡byteが違うためfalseに
       * なるが、observeRebaseEquivalenceは同一path・同一H_impl-diffなら
       * "ok"（method="rebase"）を返してしまい、SCN-MERGE-BASE-AUDIT-004と全く同じ
       * pr-bound method制限（"rebase"は許可method集合に無い）で拒否される。
       * つまりartifact-supersession固有の拒否理由（H_impl不変の要求）へ実際に
       * 到達する前に、rebase分類の優先順位そのものが経路を閉じる。
       *
       * ここでは「同じmerge-revert攻撃構造をartifact-supersession向けの形
       * （旧H_finalへ直接1 commitだけ載せる）で試す」構成を実行し、実際に発火する
       * 拒否理由（SCN-004と同じpr-bound method制限）を確認する。
       */
      const prepared = prepareDeliveryCli(this);
      createDeliveryPullRequest(prepared);
      const oldContent = spawnSync(
        "git",
        ["show", `${prepared.headSha}:docs/reviews/877_review.json`],
        { cwd: prepared.root, encoding: "utf8" },
      );
      assert.equal(oldContent.status, 0, oldContent.stderr);
      const oldEvidence = parseReviewEvidence(oldContent.stdout);
      const attack = buildRebaseMergeRevertAttack(
        prepared.root,
        {
          parentSha: prepared.implementationCommitSha,
          baseSha: prepared.baseSha,
          oldEvidence,
          artifactPath: "docs/reviews/877_review.json",
        },
        { advanceFile: "downstream-guard-006.txt" },
      );
      const reanchorArgs = [
        "pr",
        "reanchor",
        `--staging=${prepared.staging}`,
        `--root=${prepared.root}`,
        `--new-head=${attack.finalHeadSha}`,
        `--new-base=${prepared.baseSha}`,
        "--reason=artifact-supersession向けの形でH_implを変えた（Issue #1495 fixture）",
      ];
      const applied = executeCli(
        [...reanchorArgs, "--apply"],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(
        applied.status,
        0,
        "H_implを変えたartifact-supersession風の攻撃が受理されてしまいました",
      );
      const output = applied.stdout + applied.stderr;
      assert.match(
        output,
        /pr-bound再固定は監査合格済みartifact改名、または明示したpost-PR intake/u,
        "想定と異なる理由で拒否されています（SCN-004と同じrebase優先分類のpr-bound制限のはず）",
      );
      assert.doesNotMatch(
        output,
        /merge-base/u,
        "新gateまで到達してから拒否されています(reanchor自体で止まる想定と異なります)",
      );
      const chainFile = path.join(
        prepared.staging,
        "journal",
        "reanchor.jsonl",
      );
      assert.equal(
        fs.existsSync(chainFile),
        false,
        "拒否されたreanchorがchainへ書き込まれています",
      );
      break;
    }
    case "SCN-INT-MERGE-019": {
      const prepared = prepareDeliveryCli(
        this,
        {},
        "automatic",
        "merge",
        "context-isolated",
        "quick",
        2,
      );
      createDeliveryPullRequest(prepared);
      const requested = executeDeliveryMerge(prepared);
      assert.equal(
        requested.status,
        0,
        `formal 1件とprovider 1件を合算できません: ${requested.stdout}${requested.stderr}`,
      );
      assert.equal(
        deliveryProviderCalls(prepared).filter(isMergeCall).length,
        1,
      );
      break;
    }
    case "SCN-INT-MERGE-020": {
      for (const disposition of [
        "rejected",
        "session-mismatch",
        "himpl-mismatch",
        "untracked",
        "extra-file",
      ] as const) {
        const prepared = prepareDeliveryCli(
          this,
          { reviewDisposition: "none" },
          "automatic",
          "merge",
          "context-isolated",
          "quick",
          1,
          disposition,
        );
        const created = executeCli(
          [...prepared.args, "--apply", "--authorize=approved"],
          prepared.root,
          prepared.env,
        );
        // 新規PRでは同一HEAD・非artifact suffixを作成前に拒否する。
        // 既存のmerge側拒否だけで偶然passしたと扱わない。
        if (disposition === "untracked" || disposition === "extra-file")
          assert.notEqual(
            created.status,
            0,
            `${disposition} artifactはPR作成前に拒否する必要があります`,
          );
        if (disposition === "untracked")
          assert.match(
            created.stdout + created.stderr,
            /H_impl.*H_final.*同一/u,
          );
        const rejected =
          created.status === 0 ? executeDeliveryMerge(prepared) : created;
        assert.notEqual(
          rejected.status,
          0,
          `${disposition} artifactを受理しました`,
        );
        assert.equal(
          deliveryProviderCalls(prepared).filter(isMergeCall).length,
          0,
        );
      }

      for (const mutation of [
        "missing-session",
        "head-digest",
        "step10-digest",
      ] as const) {
        const prepared = prepareDeliveryCli(this, {
          reviewDisposition: "none",
        });
        createDeliveryPullRequest(prepared);
        const sessionFile = path.join(prepared.staging, "review-session.json");
        if (mutation === "missing-session") {
          fs.unlinkSync(sessionFile);
          fs.writeFileSync(
            path.join(prepared.staging, "candidate-formal-approval.json"),
            `${JSON.stringify({ approved: true, headSha: prepared.headSha })}\n`,
          );
        } else if (mutation === "head-digest") {
          const session = JSON.parse(fs.readFileSync(sessionFile, "utf8")) as {
            latestCandidateHeadSha: string;
            latestRoundDigest: string;
          };
          session.latestCandidateHeadSha = "f".repeat(40);
          session.latestRoundDigest = "e".repeat(64);
          fs.writeFileSync(sessionFile, `${JSON.stringify(session)}\n`);
        } else {
          const journalFile = path.join(prepared.staging, STEP_JOURNAL_FILE);
          const entries = fs
            .readFileSync(journalFile, "utf8")
            .trimEnd()
            .split("\n")
            .map((line) => JSON.parse(line) as StepJournalEntry)
            .map((entry) =>
              entry.step === 10 && entry.reviewSession
                ? {
                    ...entry,
                    reviewSession: {
                      ...entry.reviewSession,
                      roundDigest: "d".repeat(64),
                    },
                  }
                : entry,
            );
          fs.writeFileSync(
            journalFile,
            `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
          );
        }
        refreshStoredStagingDigest(prepared.staging);
        const rejected = executeDeliveryMerge(prepared);
        assert.notEqual(rejected.status, 0, `${mutation}を受理しました`);
        assert.equal(
          deliveryProviderCalls(prepared).filter(isMergeCall).length,
          0,
        );
      }
      break;
    }
    case "SCN-E2E-WFSTEP-048": {
      /**
       * **索引の反映待ちを合成経路で通す**（Issue #1271）。
       *
       * adapterの単体だけでは、CLIが待った結果を使わずに捨てる変異を
       * 1件も捕まえない。1回のpr createでpr-boundへ到達することを測る。
       */
      const prepared = prepareDeliveryCli(this, { emptyClosingViews: 1 });
      const created = executeCli(
        [...prepared.args, "--apply", "--authorize=approved"],
        prepared.root,
        prepared.env,
      );
      assert.equal(created.status, 0, created.stdout + created.stderr);
      const views = deliveryProviderCalls(prepared).filter(
        (call) => call[0] === "pr" && call[1] === "view",
      );
      assert.equal(
        views.length >= 2,
        true,
        `読み戻しが反復していません: ${JSON.stringify(views)}`,
      );
      assert.equal(
        deliveryProviderCalls(prepared).filter(
          (call) => call[0] === "pr" && call[1] === "create",
        ).length,
        1,
        "読み戻しの反復がprovider createを再送しています",
      );
      const state = parseDeliveryState(
        fs.readFileSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
          "utf8",
        ),
      );
      assert.equal(state.state, "pr-bound");
      break;
    }
    case "SCN-E2E-WFSTEP-049": {
      /**
       * **binding失敗時の案内が実際に踏める手順であることを測る**
       * （Issue #1271）。**「案内が出る」ではなく「何を述べているか」を検査する。**
       *
       * 是正前の文言は「pr createを再実行せず」であり、実際の回復経路
       * （同一commandの再実行によるread-only照合）と逆を向いていた。
       */
      const prepared = prepareDeliveryCli(this, {
        extraClosingIndexOnly: true,
      });
      const rejected = executeCli(
        [...prepared.args, "--apply", "--authorize=approved"],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(rejected.status, 0);
      const output = rejected.stdout + rejected.stderr;
      assert.match(output, /binding_recovery_required/u);
      assert.match(
        output,
        /同じstagingで同じpr createを再実行してください/u,
        "案内が同一commandの再実行を述べていません",
      );
      assert.match(
        output,
        /headを動かす前に再実行してください/u,
        "案内がheadを動かす前に行うことを述べていません",
      );
      assert.equal(
        /pr createを再実行せず/u.test(output),
        false,
        "是正前の誤った案内が残っています",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-050": {
      /**
       * **provider mergedAtより後のmerge要求時刻を因果証拠にしない**
       * （Issue #1300）。
       *
       * この拒否はこれまで**どのscenarioも意図的に到達していなかった。**
       * 到達していたのはgh stubがrequestedAtを実wall clockで書いていたためで、
       * full suiteの所要時間が5分を超えたときだけ偶発的に発火していた。
       * stubをfixture clockへ揃えて決定的にした結果、偶発的な到達も消える。
       *
       * **消えた到達を意図的な反例で置き換える。** requestedAtをmergedAtより
       * 後へ明示的に置き、拒否とStep 11未記録の両方を測る。
       */
      const prepared = prepareDeliveryCli(this);
      createDeliveryPullRequest(prepared);
      const requested = executeDeliveryMerge(prepared);
      assert.equal(requested.status, 0, requested.stdout + requested.stderr);
      writeDeliveryProviderControl(prepared, {
        phase: "merged",
        mergedAt: fixtureInstant({ minutesAhead: 1 }),
        requestedAt: fixtureInstant({ minutesAhead: 5 }),
        retainAutoMergeRequestWhenMerged: true,
      });
      const rejected = executeDeliveryMerge(prepared);
      assert.notEqual(rejected.status, 0);
      assert.match(
        rejected.stdout + rejected.stderr,
        /merge providerRequestがprovider mergedAtより後になっています/u,
      );
      const journal = parseStepJournal(
        fs.readFileSync(path.join(prepared.staging, STEP_JOURNAL_FILE), "utf8"),
      );
      assert.ok(
        !journal.entries.some((item) => item.step === 11),
        "因果が成立しないのにStep 11が記録されています",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-009": {
      const prepared = prepareDeliveryCli(this);
      createDeliveryPullRequest(prepared);
      const afterCreate = deliveryProviderCalls(prepared);

      const wrongPr = executeDeliveryMerge(prepared, { pr: 2 });
      assert.notEqual(wrongPr.status, 0);
      assert.equal(deliveryProviderCalls(prepared).length, afterCreate.length);

      const otherRoot = fs.realpathSync(this.initRepo());
      const otherProject = executeDeliveryMerge(prepared, { root: otherRoot });
      assert.notEqual(otherProject.status, 0);
      assert.equal(deliveryProviderCalls(prepared).length, afterCreate.length);

      writeDeliveryProviderControl(prepared, { closingChanged: true });
      const changedClosing = executeDeliveryMerge(prepared);
      assert.notEqual(changedClosing.status, 0);
      assert.match(
        changedClosing.stdout + changedClosing.stderr,
        /canonical Issue|closing|close|固定content/u,
      );
      const afterClosingRejection = deliveryProviderCalls(prepared);
      assert.equal(afterClosingRejection.some(isMergeReadBack), true);
      assert.equal(afterClosingRejection.filter(isMergeCall).length, 0);
      break;
    }
    case "SCN-E2E-WFSTEP-010": {
      const prepared = prepareDeliveryCli(this, {
        remoteBaseSha: "f".repeat(40),
      });
      const rejected = executeCli(
        [...prepared.args, "--apply", "--authorize=approved"],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(rejected.status, 0);
      assert.match(
        rejected.stdout + rejected.stderr,
        /trusted policy|provenance|base SHA/u,
      );
      assert.equal(
        deliveryProviderCalls(prepared).filter(isCreateCall).length,
        0,
        "remote baseと由来が異なるlocal policyでPRを作成してはならない",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-011": {
      const prepared = prepareDeliveryCli(this);
      const issueUrl = "https://github.com/o/r/issues/877";
      const persisted = prepareStoredPullRequestCreation(prepared.staging, {
        repository: "o/r",
        issue: 877,
        issueUrl,
        headRef: "feature/x",
        headSha: prepared.headSha,
        baseRef: "main",
        baseSha: prepared.baseSha,
        pullRequestDigest: preparedPullRequestDigest(prepared),
        bodyClosingDigest: closingContractDigest({
          canonicalIssue: 877,
          canonicalIssueUrl: issueUrl,
          closingIssueNumbers: [877],
        }),
        preparedAt: fixtureInstant({ secondsAgo: 1 }),
      });
      assert.equal(persisted.state, "create-prepared");

      const retried = executeCli(
        [...prepared.args, "--apply", "--authorize=approved"],
        prepared.root,
        prepared.env,
      );
      assert.equal(retried.status, 0, retried.stdout + retried.stderr);
      const calls = deliveryProviderCalls(prepared);
      assert.equal(calls.filter(isPullRequestFindCall).length, 1);
      const findCall = calls.find(isPullRequestFindCall);
      assert.ok(findCall);
      for (const variable of [
        "owner=o",
        "repo=r",
        "head=feature/x",
        "base=main",
      ]) {
        const index = findCall.indexOf(variable);
        assert.ok(index > 0, `GraphQL変数がありません: ${variable}`);
        assert.equal(findCall[index - 1], "-f");
      }
      assert.equal(
        calls.filter(isCreateCall).length,
        1,
        "providerが対象PRなしを確定した同一create intentは一度だけ再送する",
      );
      assert.equal(
        parseDeliveryState(
          fs.readFileSync(
            path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
            "utf8",
          ),
        ).state,
        "pr-bound",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-012": {
      const prepared = prepareDeliveryCli(
        this,
        {},
        "automatic",
        "merge",
        "actor-independent",
      );
      createDeliveryPullRequest(prepared);
      const bound = parseDeliveryState(
        fs.readFileSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
          "utf8",
        ),
      );
      assert.equal(bound.state, "pr-bound");
      const persisted = prepareStoredMergeIntent(prepared.staging, {
        method: "merge",
        authorizedHeadSha: prepared.headSha,
        authorizedBaseRef: "main",
        authorizedBaseSha: prepared.baseSha,
        trustedPolicyCommitSha: prepared.baseSha,
        ...preparedMergeReviewEvidence(prepared),
        intentId: "9".repeat(32),
        preparedAt: bound.pr?.boundAt ?? fixtureInstant(),
      });
      assert.equal(persisted.state.state, "merge-prepared");
      const before = deliveryProviderCalls(prepared);

      const retried = executeDeliveryMerge(prepared);
      assert.equal(retried.status, 0, retried.stdout + retried.stderr);
      assert.match(retried.stdout, /merge_pending/u);
      const delta = deliveryProviderCalls(prepared).slice(before.length);
      assert.equal(
        delta.filter(isMergeCall).length,
        1,
        "providerがmerge要求なしを確定した同一intentは一度だけ再送する",
      );

      const unsupported = prepareDeliveryCli(
        this,
        { ghVersion: "2.12.1" },
        "automatic",
        "merge",
        "actor-independent",
      );
      createDeliveryPullRequest(unsupported);
      const unsupportedResult = executeDeliveryMerge(unsupported);
      assert.notEqual(unsupportedResult.status, 0);
      assert.match(
        unsupportedResult.stdout + unsupportedResult.stderr,
        /gh 2\.13\.0以上/u,
      );
      assert.equal(
        deliveryProviderCalls(unsupported).filter(isMergeCall).length,
        0,
        "未対応ghではdispatch claim取得前にmergeを拒否する",
      );
      assert.equal(
        parseDeliveryState(
          fs.readFileSync(
            path.join(unsupported.staging, ...DELIVERY_STATE_FILE.split("/")),
            "utf8",
          ),
        ).state,
        "pr-bound",
      );

      const unsupportedGit = prepareDeliveryCli(this);
      createDeliveryPullRequest(unsupportedGit);
      const gitStubDirectory = this.temp("asc-delivery-old-git-");
      const gitStub = path.join(gitStubDirectory, "git");
      const realGit = spawnSync("which", ["git"], {
        encoding: "utf8",
      }).stdout.trim();
      fs.writeFileSync(
        gitStub,
        `#!/usr/bin/env node\nconst {spawnSync}=require("node:child_process");const args=process.argv.slice(2);if(args.length===1&&args[0]==="--version"){process.stdout.write("git version 2.37.9\\n");}else{const result=spawnSync(${JSON.stringify(realGit)},args,{stdio:"inherit"});process.exitCode=result.status??1;}\n`,
      );
      fs.chmodSync(gitStub, 0o755);
      unsupportedGit.env = {
        ...unsupportedGit.env,
        PATH: `${gitStubDirectory}${path.delimiter}${unsupportedGit.env.PATH ?? ""}`,
      };
      const unsupportedGitResult = executeDeliveryMerge(unsupportedGit);
      assert.notEqual(unsupportedGitResult.status, 0);
      assert.match(
        unsupportedGitResult.stdout + unsupportedGitResult.stderr,
        /git 2\.38\.0以上/u,
      );
      assert.equal(
        deliveryProviderCalls(unsupportedGit).filter(isMergeCall).length,
        0,
        "未対応Gitではdispatch claim取得前にmergeを拒否する",
      );
      assert.equal(
        parseDeliveryState(
          fs.readFileSync(
            path.join(
              unsupportedGit.staging,
              ...DELIVERY_STATE_FILE.split("/"),
            ),
            "utf8",
          ),
        ).state,
        "pr-bound",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-013": {
      for (const disposition of ["remove", "modify"] as const) {
        const prepared = prepareDeliveryCli(this);
        completeDeliveryMerge(prepared);
        rewriteStep11Journal(prepared, disposition);
        const before = deliveryProviderCalls(prepared);

        const rejected = executeDeliveryMerge(prepared);
        assert.notEqual(rejected.status, 0);
        assert.match(
          rejected.stdout + rejected.stderr,
          /Step 11|journal|digest/u,
        );
        assert.equal(
          deliveryProviderCalls(prepared).length,
          before.length,
          "Step 11 evidence不一致の拒否でproviderを呼び出してはならない",
        );
      }
      break;
    }
    case "SCN-E2E-WFSTEP-014": {
      const prepared = prepareDeliveryCli(this);
      createDeliveryPullRequest(prepared);
      const requested = executeDeliveryMerge(prepared);
      assert.equal(requested.status, 0, requested.stdout + requested.stderr);
      const providerMergedAt = fixtureInstant({ minutesAhead: 5 }).replace(
        /\.\d{3}Z$/u,
        "Z",
      );
      const mergedAt = new Date(Date.parse(providerMergedAt)).toISOString();
      writeDeliveryProviderControl(prepared, {
        phase: "merged",
        mergedAt: providerMergedAt,
      });
      const result = executeDeliveryMerge(prepared);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const completed = parseDeliveryState(
        fs.readFileSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
          "utf8",
        ),
      );
      assert.equal(completed.state, "step11-recorded");
      assert.equal(completed.merge?.observation?.providerMergedAt, mergedAt);
      break;
    }
    case "SCN-E2E-WFSTEP-015": {
      const prepared = prepareDeliveryCli(
        this,
        { autoMergeMethod: "SQUASH", queueOnMerge: true },
        "automatic",
        "squash",
      );
      createDeliveryPullRequest(prepared);
      const before = deliveryProviderCalls(prepared);
      const observed = executeDeliveryMerge(prepared, { method: "squash" });
      assert.equal(observed.status, 0, observed.stdout + observed.stderr);
      const delta = deliveryProviderCalls(prepared).slice(before.length);
      assert.equal(delta.filter(isMergeCall).length, 1);
      assert.equal(
        delta.some((args) => args[0] === "api" && args[1] === "graphql"),
        true,
      );
      const queueGraphql = delta.find(
        (args) =>
          args[0] === "api" &&
          args[1] === "graphql" &&
          args.some((argument) => argument.includes("ExactPullRequestQueue")),
      );
      assert.ok(queueGraphql);
      assert.ok(queueGraphql.includes("-f"));
      assert.ok(queueGraphql.includes("owner=o"));
      assert.ok(queueGraphql.includes("repo=r"));
      assert.ok(queueGraphql.includes("-F"));
      assert.ok(queueGraphql.includes("number=1"));
      const state = parseDeliveryState(
        fs.readFileSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
          "utf8",
        ),
      );
      assert.equal(state.state, "merge-observed");
      assert.equal(
        state.merge?.observation?.providerRequest?.kind,
        "merge-queue",
      );
      assert.ok(state.merge?.dispatchClaimedAt);
      assert.equal(
        parseStepJournal(
          fs.readFileSync(
            path.join(prepared.staging, STEP_JOURNAL_FILE),
            "utf8",
          ),
        ).entries.some((entry) => entry.step === 11),
        false,
      );

      const callsBeforeTerminal = deliveryProviderCalls(prepared);
      const providerControl = JSON.parse(
        fs.readFileSync(prepared.controlFile, "utf8"),
      ) as DeliveryProviderControl;
      writeDeliveryProviderControl(prepared, {
        phase: "merged",
        mergedAt: new Date(
          Date.parse(providerControl.requestedAt) + 1000,
        ).toISOString(),
      });
      const terminal = executeDeliveryMerge(prepared, { method: "squash" });
      assert.equal(terminal.status, 0, terminal.stdout + terminal.stderr);
      assert.equal(
        deliveryProviderCalls(prepared)
          .slice(callsBeforeTerminal.length)
          .filter(isMergeCall).length,
        0,
      );
      const completed = parseDeliveryState(
        fs.readFileSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
          "utf8",
        ),
      );
      assert.equal(completed.state, "step11-recorded");
      assert.equal(
        completed.merge?.observation?.providerRequest?.kind,
        "merge-queue",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-016": {
      const prepared = prepareDeliveryCli(this);
      createDeliveryPullRequest(prepared);
      const bound = parseDeliveryState(
        fs.readFileSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
          "utf8",
        ),
      );
      prepareStoredMergeIntent(prepared.staging, {
        method: "merge",
        authorizedHeadSha: prepared.headSha,
        authorizedBaseRef: "main",
        authorizedBaseSha: prepared.baseSha,
        trustedPolicyCommitSha: prepared.baseSha,
        ...preparedMergeReviewEvidence(prepared),
        intentId: "7".repeat(32),
        preparedAt: bound.pr?.boundAt ?? fixtureInstant(),
      });
      writeDeliveryProviderControl(prepared, {
        phase: "merge-requested",
        autoMergeMethod: "SQUASH",
      });
      const before = deliveryProviderCalls(prepared);
      const rejected = executeDeliveryMerge(prepared);
      assert.notEqual(rejected.status, 0);
      assert.match(
        rejected.stdout + rejected.stderr,
        /method|intent|reconciliation/u,
      );
      assert.equal(
        deliveryProviderCalls(prepared).slice(before.length).filter(isMergeCall)
          .length,
        0,
      );
      assert.equal(
        parseDeliveryState(
          fs.readFileSync(
            path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
            "utf8",
          ),
        ).state,
        "reconciliation-required",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-017": {
      const prepared = prepareDeliveryCli(this, {}, "disabled");
      const first = createDeliveryPullRequest(prepared);
      assert.match(first.stdout, /pull_request_complete/u);
      const stateFile = path.join(
        prepared.staging,
        ...DELIVERY_STATE_FILE.split("/"),
      );
      const completed = parseDeliveryState(fs.readFileSync(stateFile, "utf8"));
      assert.equal(completed.state, "step11-recorded");
      assert.equal(completed.step11?.outcome, "pull-request");
      assert.equal(completed.merge, null);
      const before = deliveryProviderCalls(prepared);
      const revision = completed.revision;
      /**
       * 固定済みdelivery identityの再実行は、providerの既定branchが後から
       * divergeしても新規anchor検査へ戻してはならない。
       */
      divergeDeliveryBase(prepared);
      const replay = createDeliveryPullRequest(prepared);
      assert.match(replay.stdout, /pull_request_complete/u);
      assert.deepEqual(deliveryProviderCalls(prepared), before);
      const replayed = parseDeliveryState(fs.readFileSync(stateFile, "utf8"));
      assert.equal(replayed.revision, revision);
      assert.equal(
        parseStepJournal(
          fs.readFileSync(
            path.join(prepared.staging, STEP_JOURNAL_FILE),
            "utf8",
          ),
        ).entries.filter((entry) => entry.step === 11).length,
        1,
      );
      break;
    }
    case "SCN-E2E-WFSTEP-053": {
      /**
       * **PR停止終端へ`pr merge`を発行したときの帰結を実CLI経路で観測する**
       * （Issue #1320）。
       *
       * `merge.mode=disabled`は`outcome=pull-request`のStep 11終端である
       * （`01_開発ワークフロー.md`）。**その終端へ`pr merge`を発行する経路は、
       * これまでE2Eで一度も踏まれていなかった。** `disabled`のE2Eは`pr create`
       * だけを観測しており、終端後の`pr merge`が何を返すかは未検査だった。
       *
       * **終了値まで測る。** 文言だけでは、拒否を報告しつつ0で返す実装を
       * 区別できない。**`pr merge`の呼出回数も測る。** 送ってから落ちる実装と
       * 送らずに拒否する実装は、利用者にとって別物である。
       */
      const prepared = prepareDeliveryCli(this, {}, "disabled");
      const created = createDeliveryPullRequest(prepared);
      assert.match(created.stdout, /pull_request_complete/u);
      const before = deliveryProviderCalls(prepared).filter(isMergeCall).length;
      const rejected = executeDeliveryMerge(prepared);
      assert.equal(
        rejected.status,
        1,
        `PR停止終端のpr mergeが終了値1で拒否されていません: ${rejected.stdout}${rejected.stderr}`,
      );
      const output = rejected.stdout + rejected.stderr;
      assert.match(output, /"state": "pull_request_complete"/u, output);
      assert.match(
        output,
        /このworkflowはPR停止点で完了済みです。新しいowner判断で再開する場合だけ--reopen-terminal=approvedを指定してください/u,
        output,
      );
      assert.equal(
        deliveryProviderCalls(prepared).filter(isMergeCall).length,
        before,
        "拒否したのにproviderへmergeを要求しています",
      );
      /** **終端を1件のまま保つ。** 拒否がStep 11を増やしてはならない。 */
      assert.equal(
        parseStepJournal(
          fs.readFileSync(
            path.join(prepared.staging, STEP_JOURNAL_FILE),
            "utf8",
          ),
        ).entries.filter((entry) => entry.step === 11).length,
        1,
      );
      break;
    }
    case "SCN-E2E-DELIVERY-REOPEN-001": {
      const prepared = prepareDeliveryCli(
        this,
        {},
        "disabled",
        "merge",
        undefined,
        "quick",
        0,
        "valid",
        true,
      );
      const created = createDeliveryPullRequest(prepared);
      assert.match(created.stdout, /pull_request_complete/u);
      const stateFile = path.join(
        prepared.staging,
        ...DELIVERY_STATE_FILE.split("/"),
      );
      const terminal = parseDeliveryState(fs.readFileSync(stateFile, "utf8"));
      const originalEvidenceId = terminal.step11?.evidenceId;
      assert.equal(terminal.step11?.outcome, "pull-request");
      const originalJournal = fs.readFileSync(
        path.join(prepared.staging, STEP_JOURNAL_FILE),
        "utf8",
      );
      const trustedPolicyCommitSha = advanceDeliveryTrustedMergeMode(
        prepared,
        "assisted",
      );
      const before = deliveryProviderCalls(prepared).filter(isMergeCall).length;
      const resumed = executeDeliveryMerge(prepared, {
        reopenTerminal: true,
        authorize: true,
      });
      assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
      assert.doesNotMatch(resumed.stdout, /pull_request_complete/u);
      assert.equal(
        deliveryProviderCalls(prepared).filter(isMergeCall).length,
        before + 1,
      );
      const current = parseDeliveryState(fs.readFileSync(stateFile, "utf8"));
      const redelivery = (
        current as unknown as { redelivery?: Record<string, unknown> }
      ).redelivery;
      assert.equal(redelivery?.priorStep11EvidenceId, originalEvidenceId);
      assert.equal(redelivery?.trustedPolicyCommitSha, trustedPolicyCommitSha);
      assert.equal(redelivery?.authorizedHeadSha, prepared.headSha);
      writeDeliveryProviderControl(prepared, {
        phase: "merged",
        mergedAt: fixtureInstant({ minutesAhead: 5 }),
      });
      const completed = executeDeliveryMerge(prepared);
      assert.equal(completed.status, 0, completed.stdout + completed.stderr);
      assert.match(completed.stdout, /"state": "merged"/u);
      assert.equal(
        fs.readFileSync(path.join(prepared.staging, STEP_JOURNAL_FILE), "utf8"),
        originalJournal,
        "旧Step 11 journalを変更しています",
      );
      const callsAfterCompletion =
        deliveryProviderCalls(prepared).filter(isMergeCall).length;
      const replayed = executeDeliveryMerge(prepared);
      assert.equal(replayed.status, 0, replayed.stdout + replayed.stderr);
      assert.match(replayed.stdout, /"state": "merged"/u);
      assert.equal(
        deliveryProviderCalls(prepared).filter(isMergeCall).length,
        callsAfterCompletion,
        "完了済みredeliveryをproviderへ再送しています",
      );
      break;
    }
    case "SCN-E2E-DELIVERY-REOPEN-002": {
      const prepared = prepareDeliveryCli(this, {}, "disabled");
      const created = createDeliveryPullRequest(prepared);
      assert.match(created.stdout, /pull_request_complete/u);
      advanceDeliveryTrustedMergeMode(prepared, "assisted");
      const before = deliveryProviderCalls(prepared).filter(isMergeCall).length;
      const rejected = executeDeliveryMerge(prepared);
      assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
      assert.match(rejected.stdout, /pull_request_complete/u);
      assert.equal(
        deliveryProviderCalls(prepared).filter(isMergeCall).length,
        before,
      );

      const stillDisabled = prepareDeliveryCli(this, {}, "disabled");
      createDeliveryPullRequest(stillDisabled);
      const disabledBefore =
        deliveryProviderCalls(stillDisabled).filter(isMergeCall).length;
      const disabledRejected = executeDeliveryMerge(stillDisabled, {
        reopenTerminal: true,
      });
      assert.equal(
        disabledRejected.status,
        1,
        disabledRejected.stdout + disabledRejected.stderr,
      );
      assert.equal(
        deliveryProviderCalls(stillDisabled).filter(isMergeCall).length,
        disabledBefore,
        "現在もdisabledなのにproviderへmergeを要求しています",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-054": {
      /**
       * **`assisted`のauthority未成立を実CLI経路で観測する**（Issue #1320）。
       *
       * `01_開発ワークフロー.md`は「`assisted`のauthority未成立は終端ではなく
       * `pr-bound`の再開可能な待機であり、Step 11を記録しない」と定める。
       * **この分岐は実CLI経路で一度も踏まれていなかった。** harnessの
       * `mergeMode`が2値で、`assisted`を渡す手段が無かったためである。
       *
       * **Step 11を記録しないことまで測る。** `merge_pending`と報告しながら
       * 終端を記録する実装は、再開可能な待機ではなく偽の終端になる。
       */
      const prepared = prepareDeliveryCli(this, {}, "assisted");
      const created = createDeliveryPullRequest(prepared);
      assert.match(created.stdout, /"state": "merge_pending"/u, created.stdout);
      /**
       * **`merge_pending`だけでは`automatic`と区別できない。**
       *
       * `pr create`は`mergeReadyVerified`を偽で渡すため、`automatic`も
       * `wait-merge-ready`で`merge_pending`になる。**この2つを分けているのは
       * `continuation`と、それに応じた`next`の文面だけである。** 変異試験で
       * 実測した。`assisted`分岐を削除しても`merge_pending`は出続けるため、
       * そこまでしか見ない検査は`assisted`を覆ったことにならない。
       */
      assert.match(
        created.stdout,
        /"continuation": "wait-authority"/u,
        created.stdout,
      );
      assert.match(
        created.stdout,
        /owner authorityを待ち、Step 11を記録せずpr-boundから再開してください/u,
        created.stdout,
      );
      const journal = parseStepJournal(
        fs.readFileSync(path.join(prepared.staging, STEP_JOURNAL_FILE), "utf8"),
      );
      assert.equal(
        journal.entries.filter((entry) => entry.step === 11).length,
        0,
        "authority未成立なのにStep 11を記録しています",
      );
      const stateFile = path.join(
        prepared.staging,
        ...DELIVERY_STATE_FILE.split("/"),
      );
      const bound = parseDeliveryState(fs.readFileSync(stateFile, "utf8"));
      assert.equal(
        bound.state,
        "pr-bound",
        `再開可能な待機ではない状態になっています: ${bound.state}`,
      );
      break;
    }
    case "SCN-E2E-WFSTEP-071": {
      /**
       * **`pr-bound`以後の本文・タイトル訂正はmergeを妨げない**（Issue #1517 AMD-001）。
       * 作成直後のread-backとは別に、merge前後の再観測はclosing契約とidentityだけを照合する。
       */
      const edited = prepareDeliveryCli(this);
      createDeliveryPullRequest(edited);
      writeDeliveryProviderControl(edited, {
        contentChanged: true,
        titleChanged: true,
      });
      const requested = executeDeliveryMerge(edited);
      assert.equal(requested.status, 0, requested.stdout + requested.stderr);
      assert.match(requested.stdout, /merge_pending/u);
      assert.equal(deliveryProviderCalls(edited).filter(isMergeCall).length, 1);
      writeDeliveryProviderControl(edited, {
        phase: "merged",
        mergedAt: fixtureInstant({ minutesAhead: 5 }),
      });
      const completed = executeDeliveryMerge(edited);
      assert.equal(completed.status, 0, completed.stdout + completed.stderr);
      assert.equal(
        (JSON.parse(completed.stdout) as { state?: string }).state,
        "merged",
      );

      /**
       * **修飾付きの同一repository参照がcanonical Issueを指すときだけ受理する**（R5-01）。
       * `#877`と同じIssueのURL形が並んでも、解決後のidentityは1件である。
       */
      for (const edit of [
        "url-canonical-only",
        "url-canonical-duplicate",
      ] as const) {
        const prepared = prepareDeliveryCli(this);
        createDeliveryPullRequest(prepared);
        writeDeliveryProviderControl(prepared, { closingBodyEdit: edit });
        const accepted = executeDeliveryMerge(prepared);
        assert.equal(
          accepted.status,
          0,
          `${edit}: ${accepted.stdout}${accepted.stderr}`,
        );
        assert.equal(
          deliveryProviderCalls(prepared).filter(isMergeCall).length,
          1,
          edit,
        );
      }

      for (const edit of [
        "added",
        "removed",
        "qualified-other",
        "url-other",
        "cross-repo",
        "cross-repo-same-number",
      ] as const) {
        const prepared = prepareDeliveryCli(this);
        createDeliveryPullRequest(prepared);
        writeDeliveryProviderControl(prepared, { closingBodyEdit: edit });
        const rejected = executeDeliveryMerge(prepared);
        assert.notEqual(rejected.status, 0, `${edit}: mergeを受理しました`);
        assert.match(
          rejected.stdout + rejected.stderr,
          /closing Issueはcanonical Issue 1件だけが必要です/u,
          `${edit}: ${rejected.stdout}${rejected.stderr}`,
        );
        assert.equal(
          deliveryProviderCalls(prepared).filter(isMergeCall).length,
          0,
          edit,
        );
      }

      /**
       * **canonical以外への終端keyword参照はcode領域を除かずに拒否する**（AMD-003）。
       * code判定の誤り・境界を突く形も、正規のcode内も拒否する。
       */
      for (const edit of [
        "indented-fence-other",
        "fenced-code-other",
        "info-backtick-fence-other",
        "list-unclosed-fence-other",
      ] as const) {
        const prepared = prepareDeliveryCli(this);
        createDeliveryPullRequest(prepared);
        writeDeliveryProviderControl(prepared, { closingBodyEdit: edit });
        const rejected = executeDeliveryMerge(prepared);
        assert.notEqual(rejected.status, 0, `${edit}: mergeを受理しました`);
        assert.match(
          rejected.stdout + rejected.stderr,
          /PR本文は、code内を含めcanonical Issue以外への終端keyword参照を持てません: other\/repo#9/u,
          `${edit}: ${rejected.stdout}${rejected.stderr}`,
        );
        assert.equal(
          deliveryProviderCalls(prepared).filter(isMergeCall).length,
          0,
          edit,
        );
      }

      /**
       * **作成時の本文も同じ規則で検査する**（AMD-003）。code内だけへ置いた外部参照も
       * `pr create`がprovider副作用より前に拒否し、固定後の照合と判定を揃える。
       */
      {
        const prepared = prepareDeliveryCli(this);
        fs.appendFileSync(
          prepared.bodyFile,
          "\n```\nCloses other/repo#9\n```\n",
        );
        writeDeliveryProviderControl(prepared, {});
        const refused = executeCli(
          [...prepared.args, "--apply", "--authorize=approved"],
          prepared.root,
          prepared.env,
        );
        assert.notEqual(refused.status, 0, refused.stdout + refused.stderr);
        assert.match(
          refused.stdout + refused.stderr,
          /code内を含めcanonical Issue以外への終端keyword参照を置けません: other\/repo#9/u,
        );
        assert.equal(
          deliveryProviderCalls(prepared).filter(isMergeCall).length,
          0,
        );
      }
      break;
    }
    case "SCN-E2E-WFSTEP-070": {
      /**
       * **actor-independentでもreview証跡の観測値を再導出する**（REQ-WF-038）。
       * 独立approvalが揃っていても、stagingの検証記録が証跡の検証欄を再導出できなければ
       * mergeを要求しない。対照として記録が揃った同じ構成はmergeを要求する。
       */
      const permitted = prepareDeliveryCli(
        this,
        {},
        "automatic",
        "merge",
        "actor-independent",
      );
      createDeliveryPullRequest(permitted);
      const accepted = executeDeliveryMerge(permitted);
      assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
      assert.equal(
        deliveryProviderCalls(permitted).filter(isMergeCall).length,
        1,
        "記録が揃ったactor-independentのmergeを要求していません",
      );
      const tampered = prepareDeliveryCli(
        this,
        {},
        "automatic",
        "merge",
        "actor-independent",
        "quick",
        0,
        "stale-verification",
      );
      createDeliveryPullRequest(tampered);
      const before = deliveryProviderCalls(tampered).filter(isMergeCall).length;
      const rejected = executeDeliveryMerge(tampered);
      assert.notEqual(
        rejected.status,
        0,
        "検証記録を再導出できないactor-independentのmergeを受理しました",
      );
      assert.match(
        rejected.stdout + rejected.stderr,
        /actor-independentのreview証跡が観測値と一致しません.*再導出した検証欄と一致しません/u,
      );
      assert.equal(
        deliveryProviderCalls(tampered).filter(isMergeCall).length,
        before,
        "拒否したのにproviderへmergeを要求しています",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-055": {
      /**
       * **`assisted`が実CLI経路でmerge終端まで到達できることを測る**
       * （Issue #1320）。
       *
       * `assisted`はこれまで実CLI経路で一度も踏まれていなかった。**経路が
       * 到達可能であること自体が未観測だった。**
       *
       * **このscenarioが示す範囲を広げて読まない。** `authorizeMerge`の
       * `assisted`固有分岐（`src/domain/delivery.ts`）は到達不能である。
       * 直前の`Math.max(1, requiredReviews)`が常に1以上のため、独立approvalが
       * 0件なら手前の検査で必ず拒否されるからである。したがってここで観測して
       * いるのは**「`assisted`を宣言してもmerge終端へ到達できる」ことと
       * 「独立approvalが無ければ到達しない」ことであって、`assisted`固有の門では
       * ない。** 実装の是正はIssue #1036が所有する。
       */
      const approved = prepareDeliveryCli(
        this,
        {},
        "assisted",
        "merge",
        "actor-independent",
      );
      const created = createDeliveryPullRequest(approved);
      assert.match(created.stdout, /"state": "merge_pending"/u, created.stdout);
      const requested = executeDeliveryMerge(approved, { authorize: true });
      assert.equal(
        requested.status,
        0,
        `assistedでmerge要求が通りません: ${requested.stdout}${requested.stderr}`,
      );
      writeDeliveryProviderControl(approved, {
        phase: "merged",
        mergedAt: fixtureInstant({ minutesAhead: 5 }),
      });
      const completed = executeDeliveryMerge(approved, { authorize: true });
      assert.equal(
        completed.status,
        0,
        `assistedでmerged終端へ到達できません: ${completed.stdout}${completed.stderr}`,
      );
      const journal = parseStepJournal(
        fs.readFileSync(path.join(approved.staging, STEP_JOURNAL_FILE), "utf8"),
      );
      const terminal = journal.entries.filter((entry) => entry.step === 11);
      assert.equal(terminal.length, 1, "Step 11終端が1件ではありません");
      const state = parseDeliveryState(
        fs.readFileSync(
          path.join(approved.staging, ...DELIVERY_STATE_FILE.split("/")),
          "utf8",
        ),
      );
      assert.equal(state.state, "step11-recorded");
      assert.equal(state.step11?.outcome, "merged");

      /**
       * **反対向きも同じ経路で測る。** 独立approvalが無ければ到達しないことを
       * 示さないと、「assistedはいつでも通る」だけを固定してしまう。
       */
      const denied = prepareDeliveryCli(
        this,
        { reviewDisposition: "changes-requested" },
        "assisted",
        "merge",
        "actor-independent",
      );
      createDeliveryPullRequest(denied);
      const before = deliveryProviderCalls(denied).filter(isMergeCall).length;
      const rejected = executeDeliveryMerge(denied, { authorize: true });
      assert.notEqual(
        rejected.status,
        0,
        "承認が無いのにassistedのmergeを受理しました",
      );
      /**
       * **拒否は`authorizeMerge`より前段で起きる。** `pr merge`は
       * `observeMergeReviewEvidence`内のselectorを先に通り、対象HEADへの
       * APPROVEDが無い時点で止まる。**`authorizeMerge`の診断文を期待すると、
       * 実経路が到達しない文言を固定してしまう。** 実測して確かめた。
       */
      assert.match(
        rejected.stdout + rejected.stderr,
        /current H_final.*独立したreviewがありません/u,
        rejected.stdout + rejected.stderr,
      );
      assert.equal(
        deliveryProviderCalls(denied).filter(isMergeCall).length,
        before,
        "拒否したのにproviderへmergeを要求しています",
      );

      /**
       * **古いHEADへのAPPROVEDを数えないことも同じ経路で測る**（Issue #1320）。
       *
       * `pr merge`の前段selectorはexact-HEAD一致を要求するが、**その拘束を
       * 外す変異は既存のE2Eでも生存した。** 承認そのものが存在する状態で
       * headだけを外す入力は、どのscenarioも作っていなかった。
       */
      const stale = prepareDeliveryCli(
        this,
        { reviewCommitSha: "stale" },
        "assisted",
        "merge",
        "actor-independent",
      );
      createDeliveryPullRequest(stale);
      const staleBefore =
        deliveryProviderCalls(stale).filter(isMergeCall).length;
      const staleRejected = executeDeliveryMerge(stale, { authorize: true });
      assert.notEqual(
        staleRejected.status,
        0,
        "旧HEADへのAPPROVEDでmergeを受理しました",
      );
      assert.match(
        staleRejected.stdout + staleRejected.stderr,
        /current H_final.*独立したreviewがありません/u,
        staleRejected.stdout + staleRejected.stderr,
      );
      assert.equal(
        deliveryProviderCalls(stale).filter(isMergeCall).length,
        staleBefore,
        "拒否したのにproviderへmergeを要求しています",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-052": {
      /**
       * **`full`のStep 0から11までを実CLI経路で通す**（Issue #1320）。
       *
       * `full`は既定modeだが、**E2Eにfull stagingを作る経路すら存在しなかった。**
       * 既存のE2Eはすべて`quick`固定で、`full`固有のStep 2/3/5/6/7/8は
       * どのE2Eも通っていない。
       *
       * **Step 0とStep 1〜10とStep 11をすべて別processのCLIで起動する。**
       * journalへ直接追記するとStepの記録契約そのものを迂回してしまい、
       * 「Step 0〜11が通る」ことの証拠にならない。
       */
      const prepared = prepareDeliveryCli(this, {}, "disabled");
      const assessment = path.join(prepared.root, "assessment.json");
      const answered = (answer: boolean, evidence: string) => ({
        answer,
        evidence,
      });
      fs.writeFileSync(
        assessment,
        JSON.stringify({
          "Q-01": answered(true, "配布境界のfileを変更しない"),
          "Q-02": answered(true, "保存済みdataの形式に触れない"),
          "Q-03": answered(true, "信頼境界の判定を変更しない"),
          "Q-04": answered(true, "依存packageを変更しない"),
          "Q-05": answered(true, "CI設定を変更しない"),
          "Q-06": answered(true, "不可逆操作を変更しない"),
          "Q-07": answered(false, "受け入れ条件の観測方法が未確定である"),
          "Q-08": answered(false, "複数のコンテキストに触れる"),
        }),
      );
      const staged = executeCli(
        [
          "issue",
          "create",
          "--title=full-path-test",
          "--mode=full",
          `--assessment=${assessment}`,
          `--root=${prepared.root}`,
        ],
        prepared.root,
        prepared.env,
      );
      assert.equal(staged.status, 0, staged.stdout + staged.stderr);
      const created = JSON.parse(staged.stdout) as {
        path: string;
        mode: string;
      };
      fs.unlinkSync(assessment);
      assert.equal(created.mode, "full", staged.stdout);
      const fullStaging = created.path;
      writeFullStagingArtifacts(fullStaging);

      const record = (step: number, extra: string[] = []) => {
        const result = executeCli(
          [
            "workflow",
            "record",
            `--staging=${fullStaging}`,
            `--step=${step}`,
            "--artifact=00_要求定義.md",
            `--evidence=Step ${step}を実CLI経路で記録した`,
            ...extra,
          ],
          prepared.root,
          prepared.env,
        );
        assert.equal(
          result.status,
          0,
          `Step ${step}: ${result.stdout}${result.stderr}`,
        );
      };
      const syncIssue = (extra: string[]) => {
        const expectedBodySha256 = crypto
          .createHash("sha256")
          .update(fs.readFileSync(path.join(fullStaging, "00_要求定義.md")))
          .digest("hex");
        const expectedCurrentBodySha256 = crypto
          .createHash("sha256")
          .update(
            fs.existsSync(prepared.issueBodyFile)
              ? fs.readFileSync(prepared.issueBodyFile)
              : "",
          )
          .digest("hex");
        const result = executeCli(
          [
            "issue",
            "sync",
            "--issue=877",
            "--repo=o/r",
            `--body-file=${path.join(fullStaging, "00_要求定義.md")}`,
            "--authorize=approved",
            `--synced-at=${new Date(fixtureInstantMs()).toISOString()}`,
            `--expected-body-sha256=${expectedBodySha256}`,
            `--expected-current-body-sha256=${expectedCurrentBodySha256}`,
            ...extra,
            "--apply",
          ],
          prepared.root,
          prepared.env,
        );
        assert.equal(result.status, 0, result.stdout + result.stderr);
      };

      for (const step of [1, 2, 3]) record(step);
      syncIssue([]);
      record(4, ["--artifact=https://github.com/o/r/issues/877"]);
      for (const step of [5, 6, 7]) record(step);
      syncIssue([`--staging-path=${fullStaging}`, "--checkpoint=8"]);
      record(8, ["--artifact=https://github.com/o/r/issues/877"]);
      record(9);
      const reviewSession = convergedReviewBinding(
        prepared.root,
        fullStaging,
        prepared.baseSha,
        prepared.headSha,
      );
      record(10, [`--review-session-digest=${reviewSession.roundDigest}`]);

      const delivered = executeCli(
        [
          "pr",
          "create",
          "--repo=o/r",
          "--issue=877",
          "--head=feature/x",
          "--base=main",
          `--head-sha=${prepared.headSha}`,
          `--evidence=${prepared.args[prepared.args.findIndex((item) => item.startsWith("--evidence="))]?.slice("--evidence=".length) ?? ""}`,
          `--root=${prepared.root}`,
          `--staging=${fullStaging}`,
          `--body-file=${prepared.bodyFile}`,
          "--apply",
          "--authorize=approved",
        ],
        prepared.root,
        prepared.env,
      );
      assert.equal(
        delivered.status,
        0,
        `Step 11: ${delivered.stdout}${delivered.stderr}`,
      );
      const journal = parseStepJournal(
        fs.readFileSync(path.join(fullStaging, STEP_JOURNAL_FILE), "utf8"),
      );
      assert.deepEqual(
        journal.entries.map((entry) => entry.step),
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        `fullのStep列が0〜11になっていません: ${JSON.stringify(journal.entries.map((entry) => entry.step))}`,
      );
      assert.ok(
        journal.entries.every((entry) => entry.mode === "full"),
        "journalのmodeがfullではありません",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-056": {
      /**
       * **`poc`のStep 10からStep 11までを実CLI経路で通す**（Issue #1320）。
       *
       * 既存のPoC E2Eは`main()`を同一processで呼び、しかもStep 10で止まって
       * いた。**`outcome=pull-request`のPoC終端へ実CLIで到達する経路は
       * 一度も検査されていなかった。**
       *
       * **`pr merge`がPoCを拒否することも同じ経路で測る。** 終端に到達できる
       * ことだけを示すと、PoCがmergeへ進めない停止点であることを覆えない。
       */
      const prepared = prepareDeliveryCli(
        this,
        {},
        "automatic",
        "merge",
        undefined,
        "poc",
      );
      const created = createDeliveryPullRequest(prepared);
      assert.match(created.stdout, /pull_request_complete/u, created.stdout);
      const state = parseDeliveryState(
        fs.readFileSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
          "utf8",
        ),
      );
      assert.equal(state.state, "step11-recorded");
      assert.equal(
        state.step11?.outcome,
        "pull-request",
        "PoCがPR停止終端になっていません",
      );
      /**
       * **`automatic`を宣言していてもPoCはPR停止終端になる。**
       * `01_開発ワークフロー.md`が「PoCと`merge.mode=disabled`は
       * `outcome=pull-request`のStep 11終端とする」と定める。**merge policyでは
       * なくworkflow modeが終端を決めることを、この組み合わせで固定する。**
       */
      const journal = parseStepJournal(
        fs.readFileSync(path.join(prepared.staging, STEP_JOURNAL_FILE), "utf8"),
      );
      assert.ok(
        journal.entries.every((entry) => entry.mode === "poc"),
        "journalのmodeがpocではありません",
      );
      const before = deliveryProviderCalls(prepared).filter(isMergeCall).length;
      const rejected = executeDeliveryMerge(prepared);
      assert.notEqual(rejected.status, 0, "PoCのpr mergeを受理しました");
      assert.match(
        rejected.stdout + rejected.stderr,
        /PoCはPRが停止点でありpr mergeを実行できません/u,
        rejected.stdout + rejected.stderr,
      );
      assert.equal(
        deliveryProviderCalls(prepared).filter(isMergeCall).length,
        before,
        "拒否したのにproviderへmergeを要求しています",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-018": {
      const prepared = prepareDeliveryCli(this, {}, "disabled");
      createDeliveryPullRequest(prepared);
      const stateFile = path.join(
        prepared.staging,
        ...DELIVERY_STATE_FILE.split("/"),
      );
      const completed = parseDeliveryState(fs.readFileSync(stateFile, "utf8"));
      assert.equal(completed.step11?.outcome, "pull-request");
      fs.writeFileSync(
        stateFile,
        renderDeliveryState({
          ...completed,
          revision: completed.revision - 1,
          state: "pr-bound",
          step11: null,
        }),
      );
      refreshStoredStagingDigest(prepared.staging);
      const before = deliveryProviderCalls(prepared);
      const recovered = createDeliveryPullRequest(prepared);
      assert.match(recovered.stdout, /pull_request_complete/u);
      assert.deepEqual(deliveryProviderCalls(prepared), before);
      const state = parseDeliveryState(fs.readFileSync(stateFile, "utf8"));
      assert.equal(state.state, "step11-recorded");
      assert.equal(state.step11?.outcome, "pull-request");
      assert.equal(
        parseStepJournal(
          fs.readFileSync(
            path.join(prepared.staging, STEP_JOURNAL_FILE),
            "utf8",
          ),
        ).entries.filter((entry) => entry.step === 11).length,
        1,
      );
      break;
    }
    case "SCN-E2E-WFSTEP-019": {
      const prepared = prepareDeliveryCli(this, {
        providerDefaultBranch: "develop",
      });
      const rejected = executeCli(
        [...prepared.args, "--apply", "--authorize=approved"],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(rejected.status, 0);
      assert.match(
        rejected.stdout + rejected.stderr,
        /既定branch|default branch|trusted policy/u,
      );
      assert.equal(
        deliveryProviderCalls(prepared).filter(isCreateCall).length,
        0,
      );
      assert.equal(
        fs.existsSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
        ),
        false,
      );
      break;
    }
    case "SCN-E2E-WFSTEP-020": {
      const prepared = prepareDeliveryCli(
        this,
        {},
        "automatic",
        "merge",
        "actor-independent",
      );
      createDeliveryPullRequest(prepared);
      writeDeliveryProviderControl(prepared, {
        providerDefaultBranch: "develop",
      });
      const before = deliveryProviderCalls(prepared);
      const rejected = executeDeliveryMerge(prepared);
      assert.notEqual(rejected.status, 0);
      assert.match(
        rejected.stdout + rejected.stderr,
        /authority|既定branch|trusted policy/u,
      );
      assert.equal(
        deliveryProviderCalls(prepared).slice(before.length).filter(isMergeCall)
          .length,
        0,
      );
      break;
    }
    case "SCN-E2E-WFSTEP-021": {
      const prepared = prepareDeliveryCli(this);
      completeDeliveryMerge(prepared);
      const before = deliveryProviderCalls(prepared);
      const replayed = executeDeliveryMerge(prepared);
      assert.equal(replayed.status, 0, replayed.stdout + replayed.stderr);
      assert.equal(
        (JSON.parse(replayed.stdout) as { state?: string }).state,
        "merged",
      );
      assert.deepEqual(deliveryProviderCalls(prepared), before);
      break;
    }
    case "SCN-E2E-WFSTEP-022": {
      const prepared = prepareDeliveryCli(this);
      completeDeliveryMerge(prepared);
      const stateFile = path.join(
        prepared.staging,
        ...DELIVERY_STATE_FILE.split("/"),
      );
      const completed = parseDeliveryState(fs.readFileSync(stateFile, "utf8"));
      assert.equal(completed.step11?.outcome, "merged");
      fs.writeFileSync(
        stateFile,
        renderDeliveryState({
          ...completed,
          revision: completed.revision - 1,
          state: "merge-observed",
          step11: null,
        }),
      );
      refreshStoredStagingDigest(prepared.staging);
      const before = deliveryProviderCalls(prepared);
      const recovered = executeDeliveryMerge(prepared);
      assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
      assert.deepEqual(deliveryProviderCalls(prepared), before);
      const state = parseDeliveryState(fs.readFileSync(stateFile, "utf8"));
      assert.equal(state.state, "step11-recorded");
      assert.equal(state.step11?.outcome, "merged");
      assert.equal(
        parseStepJournal(
          fs.readFileSync(
            path.join(prepared.staging, STEP_JOURNAL_FILE),
            "utf8",
          ),
        ).entries.filter((entry) => entry.step === 11).length,
        1,
      );
      break;
    }
    case "SCN-E2E-WFSTEP-044": {
      /**
       * **merge成功後は関連PRが必ず空になる**（Issue #1280で実測）。
       *
       * GitHubの`pull_requests`は「現在openで同一headを持つsame-repo PR」の一覧であり、
       * PRが閉じた瞬間に空になる。head_shaによる一覧再検索はmerge成功後に必ず失敗し、
       * `outcome=merged`のStep 11を構造的に記録できなくする。
       *
       * **固定`ciRunId`の直読みで照合すれば到達できる。** mockは`phase === "merged"`で
       * 関連PRを空にしており、実GitHubの仕様を再現している。
       */
      const prepared = prepareDeliveryCli(this);
      const completed = completeDeliveryMerge(prepared);
      const completedOutput = JSON.parse(completed.stdout) as {
        state?: string;
      };
      assert.equal(completedOutput.state, "merged");
      const state = parseDeliveryState(
        fs.readFileSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
          "utf8",
        ),
      );
      assert.equal(state.state, "step11-recorded");
      assert.equal(state.merge?.observation?.providerState, "merged");
      /** **固定run IDが照合に使われた。** 一覧の再検索では到達できない。 */
      assert.equal(state.merge?.ciRunId, "42");
      const journal = parseStepJournal(
        fs.readFileSync(path.join(prepared.staging, STEP_JOURNAL_FILE), "utf8"),
      );
      assert.ok(
        journal.entries.some((item) => item.step === 11),
        "Step 11が記録されていません",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-045": {
      /**
       * **照合結果を捨てる変異を捕まえる**（Issue #1280）。
       *
       * `reconcileFixedMergeRun`が不一致を名指ししても、**cliがその結果を無視すれば
       * 誰も気付かない。** 判定関数の単体SCNだけでは合成経路を検査できないため、
       * 固定run観測を不一致側にしてCLI経路で拒否を観測する。
       *
       * **Step 11を記録していないことまで測る。** 例外を投げるだけで終端記録が
       * 残るなら、偽のmerged終端を作ってしまう。
       */
      const prepared = prepareDeliveryCli(this);
      createDeliveryPullRequest(prepared);
      const requested = executeDeliveryMerge(prepared);
      assert.equal(requested.status, 0, requested.stdout + requested.stderr);
      writeDeliveryProviderControl(prepared, {
        phase: "merged",
        mergedAt: fixtureInstant({ minutesAhead: 5 }),
        fixedRunConclusion: "failure",
      });
      const rejected = executeDeliveryMerge(prepared);
      assert.notEqual(rejected.status, 0);
      assert.match(
        rejected.stdout + rejected.stderr,
        /固定済みmerge CI runがcurrent providerの観測と一致しません: conclusion/u,
      );
      const journal = parseStepJournal(
        fs.readFileSync(path.join(prepared.staging, STEP_JOURNAL_FILE), "utf8"),
      );
      assert.ok(
        !journal.entries.some((item) => item.step === 11),
        "照合が不一致なのにStep 11が記録されています",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-046": {
      /**
       * **merge前の実selectorが空`pull_requests`を拒否する**（Issue #1280）。
       *
       * 純関数`inspectCiDelivery`は診断文の生成にしか使われておらず、
       * **merge可否を決めているのは`observeMergeReviewEvidence`内のinline
       * selectorである。** 独立reviewerがこの差を指摘した。単体SCNは
       * 「dispatch可能集合が増えない」を強制していなかった。
       *
       * **`pr.merge`が0回であることまで測る。** 拒否の文言だけでは、
       * 要求を送った後で落ちる実装を区別できない。
       */
      const prepared = prepareDeliveryCli(this);
      createDeliveryPullRequest(prepared);
      for (const variant of ["empty", "other"] as const) {
        writeDeliveryProviderControl(prepared, {
          preMergeRunPullRequests: variant,
        });
        const before =
          deliveryProviderCalls(prepared).filter(isMergeCall).length;
        const rejected = executeDeliveryMerge(prepared);
        assert.notEqual(rejected.status, 0, `${variant}を受理しました`);
        assert.match(
          rejected.stdout + rejected.stderr,
          /successful pull_request CI runがありません/u,
        );
        const after =
          deliveryProviderCalls(prepared).filter(isMergeCall).length;
        assert.equal(
          after,
          before,
          `${variant}でproviderへmergeを要求しています`,
        );
      }
      break;
    }
    case "SCN-E2E-WFSTEP-047": {
      /**
       * **merge後もreview Evidenceをread-onlyで再観測する**（Issue #1280）。
       *
       * 独立reviewerが指摘した。merge後のCI照合を固定run直読みへ移すとき、
       * **私は`observeMergeReviewEvidence`と`assertFixedMergeReviewEvidence`を
       * 丸ごと迂回していた。** 実装commitの再観測、独立approvalの再確認、
       * review Evidence identityの照合が同時に失われていた。
       *
       * **どちらの失敗も、変更前からどのSCNでも検査されていなかった。**
       * `replaced`はidentity照合を、`revoked`は独立approvalの再確認を殺す変異を
       * 捕まえる。**Step 11を記録しないことまで測る。**
       */
      for (const [shift, pattern] of [
        ["replaced", /固定済みmerge review identityと一致しません/u],
        /**
         * **`actor-independent`が返す診断を名指しする**（Issue #1317）。
         * reviewerは実装者と別actorなので、ここで検査しているのは
         * 「承認取り下げ後に対象HEADへのAPPROVEDが無い」ことである。
         */
        ["revoked", /current H_final.*独立したreviewがありません/u],
      ] as const) {
        const scenario = prepareDeliveryCli(
          this,
          {},
          "automatic",
          "merge",
          "actor-independent",
        );
        createDeliveryPullRequest(scenario);
        const requested = executeDeliveryMerge(scenario);
        assert.equal(requested.status, 0, requested.stdout + requested.stderr);
        writeDeliveryProviderControl(scenario, {
          phase: "merged",
          mergedAt: fixtureInstant({ minutesAhead: 5 }),
          postMergeReviewShift: shift,
        });
        const rejected = executeDeliveryMerge(scenario);
        assert.notEqual(rejected.status, 0, `${shift}を受理しました`);
        assert.match(rejected.stdout + rejected.stderr, pattern);
        const journal = parseStepJournal(
          fs.readFileSync(
            path.join(scenario.staging, STEP_JOURNAL_FILE),
            "utf8",
          ),
        );
        assert.ok(
          !journal.entries.some((item) => item.step === 11),
          `${shift}でStep 11が記録されています`,
        );
      }
      break;
    }
    case "SCN-E2E-WFSTEP-043": {
      /**
       * **dispatch gateより前で落ちた場合はclaimを消費しない**（Issue #1157）。
       *
       * `pr.create`内のremote HEAD再検証を失敗させる。この照会はgateより前に
       * あるため、providerへ変更要求を送っていない。**stateは`create-prepared`の
       * まま残り、原因を解消すれば同じcommandで前進できる。**
       */
      const prepared = prepareDeliveryCli(this);
      const issueUrl = "https://github.com/o/r/issues/877";
      prepareStoredPullRequestCreation(prepared.staging, {
        repository: "o/r",
        issue: 877,
        issueUrl,
        headRef: "feature/x",
        headSha: prepared.headSha,
        baseRef: "main",
        baseSha: prepared.baseSha,
        pullRequestDigest: preparedPullRequestDigest(prepared),
        bodyClosingDigest: closingContractDigest({
          canonicalIssue: 877,
          canonicalIssueUrl: issueUrl,
          closingIssueNumbers: [877],
        }),
        preparedAt: fixtureInstant({ secondsAgo: 1 }),
      });
      writeDeliveryProviderControl(prepared, { failCreateVerification: true });
      const before = deliveryProviderCalls(prepared);
      const blocked = executeCli(
        [...prepared.args, "--apply", "--authorize=approved"],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(blocked.status, 0);
      const blockedDelta = deliveryProviderCalls(prepared).slice(before.length);
      assert.equal(
        blockedDelta.filter(isCreateCall).length,
        0,
        "再検証で落ちたのにPR createを送っています",
      );
      const stopped = parseDeliveryState(
        fs.readFileSync(
          path.join(prepared.staging, "journal", "delivery-state.json"),
          "utf8",
        ),
      );
      assert.equal(
        stopped.create.dispatchClaimedAt,
        null,
        "変更要求を送っていないのにdispatch claimを消費しています",
      );
      assert.equal(
        stopped.state,
        "create-prepared",
        "送信前の失敗でreconciliation-requiredへ落としています",
      );
      /** **原因を解消すれば同じcommandで前進できる。** */
      writeDeliveryProviderControl(prepared, { failCreateVerification: false });
      const recovered = executeCli(
        [...prepared.args, "--apply", "--authorize=approved"],
        prepared.root,
        prepared.env,
      );
      assert.equal(
        recovered.status,
        0,
        `${recovered.stdout}\n${recovered.stderr}`,
      );
      break;
    }
    case "SCN-E2E-WFSTEP-023": {
      const prepared = prepareDeliveryCli(this);
      const issueUrl = "https://github.com/o/r/issues/877";
      prepareStoredPullRequestCreation(prepared.staging, {
        repository: "o/r",
        issue: 877,
        issueUrl,
        headRef: "feature/x",
        headSha: prepared.headSha,
        baseRef: "main",
        baseSha: prepared.baseSha,
        pullRequestDigest: preparedPullRequestDigest(prepared),
        bodyClosingDigest: closingContractDigest({
          canonicalIssue: 877,
          canonicalIssueUrl: issueUrl,
          closingIssueNumbers: [877],
        }),
        preparedAt: fixtureInstant({ secondsAgo: 1 }),
      });
      const claimed = claimStoredPullRequestCreationDispatch(
        prepared.staging,
        fixtureInstant(),
      );
      assert.equal(claimed.dispatchAllowed, true);
      const before = deliveryProviderCalls(prepared);

      const recovered = executeCli(
        [...prepared.args, "--apply", "--authorize=approved"],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(recovered.status, 0);
      const delta = deliveryProviderCalls(prepared).slice(before.length);
      assert.equal(delta.filter(isPullRequestFindCall).length, 1);
      assert.equal(
        delta.filter(isCreateCall).length,
        0,
        "dispatch claim消費後はproviderが未反映でもPR createを再送しない",
      );
      const state = parseDeliveryState(
        fs.readFileSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
          "utf8",
        ),
      );
      assert.equal(state.state, "reconciliation-required");
      break;
    }
    case "SCN-E2E-WFSTEP-024": {
      const prepared = prepareDeliveryCli(this);
      createDeliveryPullRequest(prepared);
      const stateFile = path.join(
        prepared.staging,
        ...DELIVERY_STATE_FILE.split("/"),
      );
      const bound = parseDeliveryState(fs.readFileSync(stateFile, "utf8"));
      const mergePrepared = prepareStoredMergeIntent(prepared.staging, {
        method: "merge",
        authorizedHeadSha: prepared.headSha,
        authorizedBaseRef: "main",
        authorizedBaseSha: prepared.baseSha,
        trustedPolicyCommitSha: prepared.baseSha,
        ...preparedMergeReviewEvidence(prepared),
        intentId: "6".repeat(32),
        preparedAt: bound.pr?.boundAt ?? fixtureInstant(),
      });
      assert.ok(mergePrepared.state.merge);
      const claimed = claimStoredMergeDispatch(
        prepared.staging,
        mergePrepared.state.merge.preparedAt,
      );
      assert.equal(claimed.dispatchAllowed, true);
      const before = deliveryProviderCalls(prepared);

      const recovered = executeDeliveryMerge(prepared);
      assert.notEqual(recovered.status, 0);
      const delta = deliveryProviderCalls(prepared).slice(before.length);
      assert.equal(
        delta.filter(isMergeCall).length,
        0,
        "dispatch claim消費後はproviderが未反映でもmerge要求を再送しない",
      );
      assert.equal(
        parseDeliveryState(fs.readFileSync(stateFile, "utf8")).state,
        "reconciliation-required",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-025": {
      const prepared = prepareDeliveryCli(this);
      const issueUrl = "https://github.com/o/r/issues/877";
      prepareStoredPullRequestCreation(prepared.staging, {
        repository: "o/r",
        issue: 877,
        issueUrl,
        headRef: "feature/x",
        headSha: prepared.headSha,
        baseRef: "main",
        baseSha: prepared.baseSha,
        pullRequestDigest: preparedPullRequestDigest(prepared),
        bodyClosingDigest: closingContractDigest({
          canonicalIssue: 877,
          canonicalIssueUrl: issueUrl,
          closingIssueNumbers: [877],
        }),
        preparedAt: fixtureInstant({ secondsAgo: 1 }),
      });
      writeDeliveryProviderControl(prepared, { existingPr: "closed" });
      const rejected = executeCli(
        [...prepared.args, "--apply", "--authorize=approved"],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(rejected.status, 0);
      assert.match(
        rejected.stdout + rejected.stderr,
        /closed PR|reconciliation/u,
      );
      const calls = deliveryProviderCalls(prepared);
      assert.equal(calls.filter(isPullRequestFindCall).length, 1);
      assert.equal(calls.filter(isCreateCall).length, 0);
      break;
    }
    case "SCN-E2E-WFSTEP-026": {
      const prepared = prepareDeliveryCli(this);
      const issueUrl = "https://github.com/o/r/issues/877";
      prepareStoredPullRequestCreation(prepared.staging, {
        repository: "o/r",
        issue: 877,
        issueUrl,
        headRef: "feature/x",
        headSha: prepared.headSha,
        baseRef: "main",
        baseSha: prepared.baseSha,
        pullRequestDigest: preparedPullRequestDigest(prepared),
        bodyClosingDigest: closingContractDigest({
          canonicalIssue: 877,
          canonicalIssueUrl: issueUrl,
          closingIssueNumbers: [877],
        }),
        preparedAt: fixtureInstant({ secondsAgo: 1 }),
      });
      const baseTree = spawnSync(
        "git",
        ["rev-parse", `${prepared.baseSha}^{tree}`],
        { cwd: prepared.root, encoding: "utf8" },
      );
      assert.equal(baseTree.status, 0, baseTree.stderr);
      const advancedBase = spawnSync(
        "git",
        [
          "commit-tree",
          baseTree.stdout.trim(),
          "-p",
          prepared.baseSha,
          "-m",
          "advance base",
        ],
        { cwd: prepared.root, encoding: "utf8" },
      );
      assert.equal(advancedBase.status, 0, advancedBase.stderr);
      const advancedBaseSha = advancedBase.stdout.trim();
      const updateBase = spawnSync(
        "git",
        ["update-ref", "refs/remotes/origin/main", advancedBaseSha],
        { cwd: prepared.root, encoding: "utf8" },
      );
      assert.equal(updateBase.status, 0, updateBase.stderr);
      writeDeliveryProviderControl(prepared, {
        existingPr: "open",
        remoteBaseSha: advancedBaseSha,
      });
      const recovered = executeCli(
        [...prepared.args, "--apply", "--authorize=approved"],
        prepared.root,
        prepared.env,
      );
      assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
      assert.match(recovered.stdout, /merge_pending/u);
      const calls = deliveryProviderCalls(prepared);
      assert.equal(calls.filter(isPullRequestFindCall).length, 1);
      assert.equal(calls.filter(isCreateCall).length, 0);
      const state = parseDeliveryState(
        fs.readFileSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
          "utf8",
        ),
      );
      assert.equal(state.state, "pr-bound");
      assert.equal(state.create.baseSha, prepared.baseSha);
      assert.notEqual(state.create.baseSha, advancedBaseSha);
      break;
    }
    case "SCN-E2E-WFSTEP-027": {
      const prepared = prepareDeliveryCli(this, {}, "disabled");
      createDeliveryPullRequest(prepared);
      const stateFile = path.join(
        prepared.staging,
        ...DELIVERY_STATE_FILE.split("/"),
      );
      const completed = parseDeliveryState(fs.readFileSync(stateFile, "utf8"));
      fs.writeFileSync(
        stateFile,
        renderDeliveryState({
          ...completed,
          revision: completed.revision - 1,
          state: "pr-bound",
          step11: null,
        }),
      );
      refreshStoredStagingDigest(prepared.staging);
      fs.appendFileSync(
        path.join(prepared.staging, "00_要求定義.md"),
        "\n改変\n",
      );
      const before = deliveryProviderCalls(prepared);
      const rejected = executeCli(
        [...prepared.args, "--apply", "--authorize=approved"],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stdout + rejected.stderr, /digest|成果物一覧/u);
      assert.deepEqual(deliveryProviderCalls(prepared), before);
      assert.equal(
        parseDeliveryState(fs.readFileSync(stateFile, "utf8")).state,
        "pr-bound",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-028": {
      const prepared = prepareDeliveryCli(this);
      completeDeliveryMerge(prepared);
      const stateFile = path.join(
        prepared.staging,
        ...DELIVERY_STATE_FILE.split("/"),
      );
      const completed = parseDeliveryState(fs.readFileSync(stateFile, "utf8"));
      fs.writeFileSync(
        stateFile,
        renderDeliveryState({
          ...completed,
          revision: completed.revision - 1,
          state: "merge-observed",
          step11: null,
        }),
      );
      refreshStoredStagingDigest(prepared.staging);
      fs.appendFileSync(
        path.join(prepared.staging, "00_要求定義.md"),
        "\n改変\n",
      );
      const before = deliveryProviderCalls(prepared);
      const rejected = executeDeliveryMerge(prepared);
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stdout + rejected.stderr, /digest|成果物一覧/u);
      assert.deepEqual(deliveryProviderCalls(prepared), before);
      assert.equal(
        parseDeliveryState(fs.readFileSync(stateFile, "utf8")).state,
        "merge-observed",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-029": {
      const prepared = prepareDeliveryCli(this);
      const issueUrl = "https://github.com/o/r/issues/877";
      prepareStoredPullRequestCreation(prepared.staging, {
        repository: "o/r",
        issue: 877,
        issueUrl,
        headRef: "feature/x",
        headSha: prepared.headSha,
        baseRef: "main",
        baseSha: prepared.baseSha,
        pullRequestDigest: preparedPullRequestDigest(prepared),
        bodyClosingDigest: closingContractDigest({
          canonicalIssue: 877,
          canonicalIssueUrl: issueUrl,
          closingIssueNumbers: [877],
        }),
        preparedAt: fixtureInstant({ secondsAgo: 1 }),
      });
      writeDeliveryProviderControl(prepared, { existingPr: "paged-closed" });
      const rejected = executeCli(
        [...prepared.args, "--apply", "--authorize=approved"],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(rejected.status, 0);
      assert.match(
        rejected.stdout + rejected.stderr,
        /closed PR|reconciliation/u,
      );
      const calls = deliveryProviderCalls(prepared);
      assert.equal(calls.filter(isPullRequestFindCall).length, 1);
      assert.equal(calls.filter(isCreateCall).length, 0);
      break;
    }
    case "SCN-E2E-WFSTEP-030": {
      const prepared = prepareDeliveryCli(this);
      const issueUrl = "https://github.com/o/r/issues/877";
      prepareStoredPullRequestCreation(prepared.staging, {
        repository: "o/r",
        issue: 877,
        issueUrl,
        headRef: "feature/x",
        headSha: prepared.headSha,
        baseRef: "main",
        baseSha: prepared.baseSha,
        pullRequestDigest: preparedPullRequestDigest(prepared),
        bodyClosingDigest: closingContractDigest({
          canonicalIssue: 877,
          canonicalIssueUrl: issueUrl,
          closingIssueNumbers: [877],
        }),
        preparedAt: fixtureInstant({ secondsAgo: 1 }),
      });
      writeDeliveryProviderControl(prepared, {
        existingPr: "open-and-closed",
      });
      const rejected = executeCli(
        [...prepared.args, "--apply", "--authorize=approved"],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(rejected.status, 0);
      assert.match(
        rejected.stdout + rejected.stderr,
        /一意ではありません|reconciliation/u,
      );
      const calls = deliveryProviderCalls(prepared);
      assert.equal(calls.filter(isPullRequestFindCall).length, 1);
      assert.equal(calls.filter(isCreateCall).length, 0);
      break;
    }
    case "SCN-E2E-WFSTEP-031": {
      const prepared = prepareDeliveryCli(this);
      createDeliveryPullRequest(prepared);
      const persistence = deliveryPersistence(prepared);
      for (const missing of ["pr", "implementation"] as const) {
        writeDeliveryProviderControl(prepared, {
          prAuthorId: missing === "pr" ? null : "pr-author",
          implementationAuthorId:
            missing === "implementation" ? null : "implementation-author",
        });
        const rejected = executeDeliveryMerge(prepared);
        assert.notEqual(rejected.status, 0);
        assert.deepEqual(deliveryPersistence(prepared), persistence);
        assert.match(
          rejected.stdout + rejected.stderr,
          /stable ID|author|review/u,
        );
        assert.equal(
          deliveryProviderCalls(prepared).filter(isMergeCall).length,
          0,
        );
      }
      break;
    }
    case "SCN-E2E-WFSTEP-032": {
      const rejectedPrepared = prepareDeliveryCli(
        this,
        {},
        "automatic",
        "merge",
        "actor-independent",
      );
      createDeliveryPullRequest(rejectedPrepared);
      writeDeliveryProviderControl(rejectedPrepared, {
        reviewDisposition: "changes-requested",
      });
      const rejected = executeDeliveryMerge(rejectedPrepared);
      assert.notEqual(rejected.status, 0);
      assert.match(
        rejected.stdout + rejected.stderr,
        /独立review|review|承認/u,
      );
      assert.equal(
        deliveryProviderCalls(rejectedPrepared).filter(isMergeCall).length,
        0,
      );

      const acceptedPrepared = prepareDeliveryCli(
        this,
        {},
        "automatic",
        "merge",
        "actor-independent",
      );
      createDeliveryPullRequest(acceptedPrepared);
      writeDeliveryProviderControl(acceptedPrepared, {
        reviewDisposition: "commented-after-approval",
      });
      const accepted = executeDeliveryMerge(acceptedPrepared);
      assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
      assert.equal(
        deliveryProviderCalls(acceptedPrepared).filter(isMergeCall).length,
        1,
      );
      break;
    }
    case "SCN-E2E-WFSTEP-033": {
      for (const invalid of ["tree", "ancestry"] as const) {
        const prepared = prepareDeliveryCli(this);
        createDeliveryPullRequest(prepared);
        const requested = executeDeliveryMerge(prepared);
        assert.equal(requested.status, 0, requested.stdout + requested.stderr);
        writeDeliveryProviderControl(
          prepared,
          invalid === "tree"
            ? { phase: "merged", mergeTreeTampered: true }
            : { phase: "merged", mergeOnDefaultBranch: false },
        );
        const rejected = executeDeliveryMerge(prepared);
        assert.notEqual(rejected.status, 0);
        assert.match(
          rejected.stdout + rejected.stderr,
          /tree|ancestor|既定branch|reconciliation/u,
        );
        const state = parseDeliveryState(
          fs.readFileSync(
            path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
            "utf8",
          ),
        );
        assert.notEqual(state.state, "step11-recorded");
      }
      break;
    }
    case "SCN-E2E-WFSTEP-034": {
      for (const invalid of [
        "empty-pages",
        "unterminated-page",
        "malformed-node",
      ] as const) {
        const prepared = prepareDeliveryCli(this);
        const issueUrl = "https://github.com/o/r/issues/877";
        prepareStoredPullRequestCreation(prepared.staging, {
          repository: "o/r",
          issue: 877,
          issueUrl,
          headRef: "feature/x",
          headSha: prepared.headSha,
          baseRef: "main",
          baseSha: prepared.baseSha,
          pullRequestDigest: preparedPullRequestDigest(prepared),
          bodyClosingDigest: closingContractDigest({
            canonicalIssue: 877,
            canonicalIssueUrl: issueUrl,
            closingIssueNumbers: [877],
          }),
          preparedAt: fixtureInstant({ secondsAgo: 1 }),
        });
        writeDeliveryProviderControl(prepared, { existingPr: invalid });
        const rejected = executeCli(
          [...prepared.args, "--apply", "--authorize=approved"],
          prepared.root,
          prepared.env,
        );
        assert.notEqual(rejected.status, 0);
        assert.match(
          rejected.stdout + rejected.stderr,
          /照合に失敗|page|pagination|node|reconciliation/u,
        );
        const calls = deliveryProviderCalls(prepared);
        assert.equal(calls.filter(isPullRequestFindCall).length, 1);
        assert.equal(calls.filter(isCreateCall).length, 0);

        writeDeliveryProviderControl(prepared, { existingPr: "none" });
        const recovered = executeCli(
          [...prepared.args, "--apply", "--authorize=approved"],
          prepared.root,
          prepared.env,
        );
        assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
        const recoveredState = parseDeliveryState(
          fs.readFileSync(
            path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
            "utf8",
          ),
        );
        assert.equal(recoveredState.state, "pr-bound");
        assert.equal(
          deliveryProviderCalls(prepared).filter(isCreateCall).length,
          1,
        );
      }

      const conflicting = prepareDeliveryCli(this);
      const issueUrl = "https://github.com/o/r/issues/877";
      prepareStoredPullRequestCreation(conflicting.staging, {
        repository: "o/r",
        issue: 877,
        issueUrl,
        headRef: "feature/x",
        headSha: conflicting.headSha,
        baseRef: "main",
        baseSha: conflicting.baseSha,
        pullRequestDigest: preparedPullRequestDigest(conflicting),
        bodyClosingDigest: closingContractDigest({
          canonicalIssue: 877,
          canonicalIssueUrl: issueUrl,
          closingIssueNumbers: [877],
        }),
        preparedAt: fixtureInstant({ secondsAgo: 1 }),
      });
      writeDeliveryProviderControl(conflicting, {
        existingPr: "open",
        contentChanged: true,
      });
      const conflict = executeCli(
        [...conflicting.args, "--apply", "--authorize=approved"],
        conflicting.root,
        conflicting.env,
      );
      assert.notEqual(conflict.status, 0);
      assert.match(
        conflict.stdout + conflict.stderr,
        /同じhead\/base|固定済みidentity|既存PR/u,
      );
      assert.equal(
        deliveryProviderCalls(conflicting).filter(isCreateCall).length,
        0,
        "同じhead/baseの不一致PRをexact absenceとして新規createしてはならない",
      );
      break;
    }
    case "SCN-E2E-WFSTEP-035": {
      const prepared = prepareDeliveryCli(
        this,
        {
          autoMergeMethod: "SQUASH",
          mergeImmediately: true,
          retainAutoMergeRequestWhenMerged: true,
        },
        "automatic",
        "squash",
      );
      createDeliveryPullRequest(prepared);
      const completed = executeDeliveryMerge(prepared, { method: "squash" });
      assert.equal(completed.status, 0, completed.stdout + completed.stderr);
      assert.equal(
        (JSON.parse(completed.stdout) as { state?: string }).state,
        "merged",
      );
      const state = parseDeliveryState(
        fs.readFileSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
          "utf8",
        ),
      );
      assert.equal(state.state, "step11-recorded");
      assert.equal(state.merge?.method, "squash");
      assert.equal(
        state.merge?.observation?.providerRequest?.kind,
        "auto-merge",
      );
      assert.equal(state.merge?.observation?.providerRequest?.method, "squash");
      assert.equal(
        deliveryProviderCalls(prepared).filter(isMergeCall).length,
        1,
      );
      break;
    }
    case "SCN-E2E-WFSTEP-037": {
      for (const method of ["squash", "rebase"] as const) {
        const prepared = prepareDeliveryCli(
          this,
          {
            autoMergeMethod: method === "squash" ? "SQUASH" : "REBASE",
            mergeImmediately: true,
            queueOnMerge: true,
            retainAutoMergeRequestWhenMerged: false,
          },
          "automatic",
          method,
        );
        createDeliveryPullRequest(prepared);
        const completed = executeDeliveryMerge(prepared, { method });
        assert.equal(completed.status, 0, completed.stdout + completed.stderr);
        const state = parseDeliveryState(
          fs.readFileSync(
            path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
            "utf8",
          ),
        );
        assert.equal(state.state, "step11-recorded");
        assert.equal(state.merge?.method, method);
        assert.equal(state.merge?.observation?.providerRequest, null);
        assert.equal(
          deliveryProviderCalls(prepared).filter(isMergeCall).length,
          1,
        );

        const repeated = executeDeliveryMerge(prepared, { method });
        assert.equal(repeated.status, 0, repeated.stdout + repeated.stderr);
        assert.equal(
          deliveryProviderCalls(prepared).filter(isMergeCall).length,
          1,
        );
      }
      break;
    }
    case "SCN-E2E-WFSTEP-038": {
      const prepared = prepareDeliveryCli(
        this,
        {
          autoMergeMethod: "REBASE",
          mergeImmediately: true,
          queueOnMerge: true,
          retainAutoMergeRequestWhenMerged: false,
          terminalParentTampered: true,
        },
        "automatic",
        "rebase",
      );
      createDeliveryPullRequest(prepared);
      const rejected = executeDeliveryMerge(prepared, { method: "rebase" });
      assert.notEqual(rejected.status, 0);
      assert.match(
        rejected.stdout + rejected.stderr,
        /rebase終端chainのfirst parentが終端検証baseと一致しません/u,
      );
      const state = parseDeliveryState(
        fs.readFileSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
          "utf8",
        ),
      );
      assert.notEqual(state.state, "step11-recorded");
      const mergeCalls =
        deliveryProviderCalls(prepared).filter(isMergeCall).length;
      assert.equal(mergeCalls, 1);
      const repeated = executeDeliveryMerge(prepared, { method: "rebase" });
      assert.notEqual(repeated.status, 0);
      assert.equal(
        deliveryProviderCalls(prepared).filter(isMergeCall).length,
        mergeCalls,
      );
      break;
    }
    case "SCN-E2E-WFSTEP-036": {
      for (const invalid of ["fork", "body", "title"] as const) {
        const prepared = prepareDeliveryCli(this);
        const issueUrl = "https://github.com/o/r/issues/877";
        prepareStoredPullRequestCreation(prepared.staging, {
          repository: "o/r",
          issue: 877,
          issueUrl,
          headRef: "feature/x",
          headSha: prepared.headSha,
          baseRef: "main",
          baseSha: prepared.baseSha,
          pullRequestDigest: preparedPullRequestDigest(prepared),
          bodyClosingDigest: closingContractDigest({
            canonicalIssue: 877,
            canonicalIssueUrl: issueUrl,
            closingIssueNumbers: [877],
          }),
          preparedAt: fixtureInstant({ secondsAgo: 1 }),
        });
        claimStoredPullRequestCreationDispatch(
          prepared.staging,
          fixtureInstant(),
        );
        writeDeliveryProviderControl(prepared, {
          existingPr: "open",
          ...(invalid === "fork"
            ? {
                headRepository: "attacker/fork",
                isCrossRepository: true,
              }
            : invalid === "body"
              ? { contentChanged: true }
              : { titleChanged: true }),
        });
        const rejected = executeCli(
          [...prepared.args, "--apply", "--authorize=approved"],
          prepared.root,
          prepared.env,
        );
        assert.notEqual(rejected.status, 0);
        assert.match(
          rejected.stdout + rejected.stderr,
          /head repository|タイトル|本文|content|reconciliation|dispatch claim/u,
        );
        const state = parseDeliveryState(
          fs.readFileSync(
            path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
            "utf8",
          ),
        );
        assert.notEqual(state.state, "pr-bound");
        assert.equal(
          deliveryProviderCalls(prepared).filter(isCreateCall).length,
          0,
        );
      }
      break;
    }
    case "SCN-E2E-WFSTEP-039": {
      const root = this.temp("asc-workflow-record-cli-");
      const staging = createQuickStaging(root);
      const journal = path.join(staging, STEP_JOURNAL_FILE);
      const before = parseStepJournal(fs.readFileSync(journal, "utf8"));
      fs.appendFileSync(path.join(staging, "00_要求定義.md"), "\nCLI追記\n");

      const checked = await executeMain([
        "workflow",
        "record",
        `--staging=${staging}`,
        "--step=1",
        "--artifact=00_要求定義.md",
        "--evidence=編集済みstagingの受理",
        `--recorded-at=${instant}`,
      ]);

      assert.equal(checked.status, 0, checked.stdout);
      const output = JSON.parse(checked.stdout) as {
        entry?: StepJournalEntry;
        journalDigest?: string;
        stagingDigest?: string;
      };
      assert.ok(output.entry);
      assert.match(output.journalDigest ?? "", /^[a-f0-9]{64}$/u);
      assert.match(output.stagingDigest ?? "", /^[a-f0-9]{64}$/u);
      const after = parseStepJournal(fs.readFileSync(journal, "utf8"));
      assert.equal(after.entries.length, before.entries.length + 1);
      break;
    }
    case "SCN-E2E-WFSTEP-040": {
      /**
       * **`pr create`後のpost-terminal intakeを公開CLIで通す。**
       *
       * Issue #1194 は順序判定だけを直しており、追記経路そのものは
       * `appendWorkflowJournalEntryLocked`の2つの封印とCLIのboolean flag未登録で
       * 塞がったままだった。**判定関数だけを呼ぶ検査では3件とも生存する。**
       */
      const prepared = prepareDeliveryCli(this, {}, "disabled");
      createDeliveryPullRequest(prepared);
      const stateFile = path.join(
        prepared.staging,
        ...DELIVERY_STATE_FILE.split("/"),
      );
      assert.equal(
        parseDeliveryState(fs.readFileSync(stateFile, "utf8")).state,
        "step11-recorded",
      );
      const journalFile = path.join(prepared.staging, STEP_JOURNAL_FILE);
      const before = parseStepJournal(fs.readFileSync(journalFile, "utf8"));
      const step10 = before.entries.find((item) => item.step === 10);
      assert.ok(step10?.reviewSession);
      const recorded = executeCli(
        [
          "workflow",
          "record",
          `--staging=${prepared.staging}`,
          "--step=10",
          "--evidence=外部reviewer指摘を同じPRで取り込んだround",
          "--artifact=00_要求定義.md",
          `--review-session-digest=${step10.reviewSession.roundDigest}`,
          `--recorded-at=${fixtureInstant({ minutesAhead: 5 })}`,
          "--post-terminal-intake",
        ],
        prepared.root,
        prepared.env,
      );
      assert.equal(recorded.status, 0, recorded.stdout + recorded.stderr);
      const after = parseStepJournal(fs.readFileSync(journalFile, "utf8"));
      assert.equal(after.entries.length, before.entries.length + 1);
      assert.equal(after.entries.at(-1)?.step, 10);
      assert.equal(after.entries.at(-1)?.postTerminalIntake, true);
      assert.deepEqual(
        validateStepJournal({
          mode: after.entries[0]?.mode ?? "full",
          entries: after.entries,
          upToStep: 11,
        }).errors,
        [],
      );
      break;
    }
    case "SCN-E2E-WFSTEP-041": {
      /**
       * **intakeでないStep記録は封印されたままである。** 封印を「外した」のではなく
       * 「1種類だけ通した」ことを、診断文字列を名指しして固定する。
       */
      const prepared = prepareDeliveryCli(this, {}, "disabled");
      createDeliveryPullRequest(prepared);
      const journalFile = path.join(prepared.staging, STEP_JOURNAL_FILE);
      const before = parseStepJournal(fs.readFileSync(journalFile, "utf8"));
      const step10 = before.entries.find((item) => item.step === 10);
      assert.ok(step10?.reviewSession);
      const rejected = executeCli(
        [
          "workflow",
          "record",
          `--staging=${prepared.staging}`,
          "--step=10",
          "--evidence=intake指定のない通常のStep 10再記録",
          "--artifact=00_要求定義.md",
          `--review-session-digest=${step10.reviewSession.roundDigest}`,
          `--recorded-at=${fixtureInstant({ minutesAhead: 5 })}`,
        ],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(rejected.status, 0);
      assert.match(
        rejected.stdout + rejected.stderr,
        /Step 11記録後のStep 10再記録には--post-terminal-intakeが必要です/u,
      );
      assert.equal(
        parseStepJournal(fs.readFileSync(journalFile, "utf8")).entries.length,
        before.entries.length,
      );
      break;
    }
    case "SCN-E2E-WFSTEP-042": {
      /**
       * **terminal delivery state側の封印も残す。** Step 11 entryを取り除いて
       * 第1封印を外すと、この記録は第2封印だけに当たる。**intakeを通す変更が
       * 両方を開けていないことは、この経路でしか観測できない。**
       */
      const prepared = prepareDeliveryCli(this, {}, "disabled");
      createDeliveryPullRequest(prepared);
      const journalFile = path.join(prepared.staging, STEP_JOURNAL_FILE);
      const before = parseStepJournal(fs.readFileSync(journalFile, "utf8"));
      const step10 = before.entries.find((item) => item.step === 10);
      assert.ok(step10?.reviewSession);
      const withoutTerminal = fs
        .readFileSync(journalFile, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .filter((line) => (JSON.parse(line) as { step: number }).step !== 11);
      fs.writeFileSync(journalFile, `${withoutTerminal.join("\n")}\n`);
      refreshStoredStagingDigest(prepared.staging);
      const rejected = executeCli(
        [
          "workflow",
          "record",
          `--staging=${prepared.staging}`,
          "--step=10",
          "--evidence=terminal delivery state後の通常のStep 10記録",
          "--artifact=00_要求定義.md",
          `--review-session-digest=${step10.reviewSession.roundDigest}`,
          `--recorded-at=${fixtureInstant({ minutesAhead: 5 })}`,
        ],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(rejected.status, 0);
      assert.match(
        rejected.stdout + rejected.stderr,
        /terminal delivery state後はStep 0〜10を追記できません/u,
      );
      break;
    }
    case "SCN-E2E-ADVANCE-001": {
      const staging = createQuickStaging(this.temp("asc-advance-preview-"));
      const journal = path.join(staging, STEP_JOURNAL_FILE);
      const before = fs.readFileSync(journal);
      const checked = await executeMain([
        "workflow",
        "advance",
        `--staging=${staging}`,
        "--dry-run",
      ]);
      assert.equal(checked.status, 0, checked.stdout);
      const output = JSON.parse(checked.stdout) as {
        operation: string;
        targetStep: number;
      };
      assert.equal(output.operation, "record");
      assert.equal(output.targetStep, 1);
      assert.deepEqual(fs.readFileSync(journal), before);
      break;
    }
    case "SCN-E2E-ADVANCE-002": {
      const staging = createQuickStaging(this.temp("asc-advance-apply-"));
      completeAdvanceRequirement(staging);
      const before = fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE));
      const recordBefore = fs.readFileSync(
        path.join(staging, STAGING_RECORD_FILE),
      );
      await assert.rejects(
        () =>
          executeMain([
            "workflow",
            "advance",
            `--staging=${staging}`,
            "--artifact=関係のない成果物.md",
            "--evidence=要求成果物を確認した",
            `--recorded-at=${instant}`,
            "--apply",
          ]),
        /Step 1のartifact/u,
      );
      assert.deepEqual(
        fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE)),
        before,
      );
      assert.deepEqual(
        fs.readFileSync(path.join(staging, STAGING_RECORD_FILE)),
        recordBefore,
      );
      const checked = await executeMain([
        "workflow",
        "advance",
        `--staging=${staging}`,
        "--artifact=00_要求定義.md",
        "--evidence=要求成果物を確認した",
        `--recorded-at=${instant}`,
        "--apply",
      ]);
      assert.equal(checked.status, 0, checked.stdout);
      const journal = parseStepJournal(
        fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE), "utf8"),
      );
      assert.equal(journal.entries.at(-1)?.step, 1);
      assert.equal(journal.entries.filter((item) => item.step === 1).length, 1);
      break;
    }
    case "SCN-E2E-ADVANCE-003": {
      const staging = createQuickStaging(this.temp("asc-advance-delegate-"));
      appendWorkflowJournalEntry({ staging, entry: entry(1) });
      appendWorkflowJournalEntry({
        staging,
        entry: {
          ...entry(4),
          artifacts: ["https://github.com/o/r/issues/877"],
          evidence: `sync read-back digest ${"a".repeat(64)}`,
        },
      });
      appendWorkflowJournalEntry({
        staging,
        entry: {
          ...entry(9),
          implementationHeadSha: "a".repeat(40),
        },
      });
      const before = fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE));
      const checked = await executeMain([
        "workflow",
        "advance",
        `--staging=${staging}`,
      ]);
      assert.equal(checked.status, 0, checked.stdout);
      const output = JSON.parse(checked.stdout) as {
        state: string;
        operation: string;
        targetStep: number;
      };
      assert.deepEqual(
        [output.state, output.operation, output.targetStep],
        ["delegated", "review", 10],
      );
      assert.deepEqual(
        fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE)),
        before,
      );
      appendWorkflowJournalEntry({ staging, entry: entry(9) });
      const legacy = await executeMain([
        "workflow",
        "advance",
        `--staging=${staging}`,
      ]);
      assert.notEqual(legacy.status, 0, legacy.stdout);
      const legacyOutput = JSON.parse(legacy.stdout) as {
        state: string;
        operation: string;
        reasons: string[];
      };
      assert.deepEqual(
        [legacyOutput.state, legacyOutput.operation],
        ["blocked", "blocked"],
      );
      assert.match(legacyOutput.reasons.join("\n"), /implementationHeadSha/u);
      break;
    }
    case "SCN-E2E-ADVANCE-004": {
      const prepared = prepareDeliveryCli(this, {}, "disabled");
      fs.writeFileSync(
        prepared.issueBodyFile,
        "# 既存トラッカー\n\n- [ ] 利用者の進捗を保持する\n",
      );
      const staging = createIssueStaging(prepared.root, {
        title: "workflow-advance-sync",
        answers: answers(false),
        now: new Date(instant),
        requestedMode: "full",
      }).path;
      writeFullStagingArtifacts(staging);
      for (const step of [1, 2, 3])
        appendWorkflowJournalEntry({
          staging,
          entry: entry(step, "full"),
        });
      const preview = executeCli(
        [
          "workflow",
          "advance",
          `--staging=${staging}`,
          "--repo=o/r",
          "--issue=877",
        ],
        prepared.root,
        prepared.env,
      );
      assert.equal(preview.status, 0, preview.stdout + preview.stderr);
      const previewOutput = JSON.parse(preview.stdout) as {
        sync: { tracker: string; checkpoint: number; bodySha256: string };
      };
      assert.equal(
        previewOutput.sync.tracker,
        "https://github.com/o/r/issues/877",
      );
      assert.equal(previewOutput.sync.checkpoint, 4);
      assert.match(previewOutput.sync.bodySha256, /^[a-f0-9]{64}$/u);
      assert.equal(
        deliveryProviderCalls(prepared).some(
          (args) => args[0] === "issue" && args[1] === "edit",
        ),
        false,
      );
      const unbound = executeCli(
        [
          "workflow",
          "advance",
          `--staging=${staging}`,
          "--repo=o/r",
          "--issue=877",
          "--authorize=approved",
          `--recorded-at=${instant}`,
          `--synced-at=${instant}`,
          "--apply",
        ],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(unbound.status, 0);
      assert.match(unbound.stdout + unbound.stderr, /expected-body-sha256/u);
      assert.equal(
        deliveryProviderCalls(prepared).some(
          (args) => args[0] === "issue" && args[1] === "edit",
        ),
        false,
      );
      const checked = executeCli(
        [
          "workflow",
          "advance",
          `--staging=${staging}`,
          "--repo=o/r",
          "--issue=877",
          "--authorize=approved",
          `--expected-body-sha256=${previewOutput.sync.bodySha256}`,
          `--recorded-at=${instant}`,
          `--synced-at=${instant}`,
          "--apply",
        ],
        prepared.root,
        prepared.env,
      );
      assert.equal(checked.status, 0, checked.stdout + checked.stderr);
      const journal = parseStepJournal(
        fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE), "utf8"),
      );
      assert.equal(journal.entries.at(-1)?.step, 4);
      assert.match(
        journal.entries.at(-1)?.evidence ?? "",
        /sync.*[a-f0-9]{64}/u,
      );
      assert.deepEqual(journal.entries.at(-1)?.artifacts, [
        "https://github.com/o/r/issues/877",
      ]);
      const synchronizedBody = fs.readFileSync(prepared.issueBodyFile, "utf8");
      assert.match(synchronizedBody, /利用者の進捗を保持する/u);
      assert.match(
        synchronizedBody,
        /agent-skill-chain:workflow-advance:start/u,
      );
      break;
    }
    case "SCN-E2E-ADVANCE-005": {
      const prepared = prepareDeliveryCli(this, {}, "disabled");
      const staging = createIssueStaging(prepared.root, {
        title: "workflow-advance-same-tracker",
        answers: answers(false),
        now: new Date(instant),
        requestedMode: "full",
      }).path;
      writeFullStagingArtifacts(staging);
      for (const step of [1, 2, 3])
        appendWorkflowJournalEntry({
          staging,
          entry: entry(step, "full"),
        });
      const firstPreview = executeCli(
        [
          "workflow",
          "advance",
          `--staging=${staging}`,
          "--repo=o/r",
          "--issue=877",
        ],
        prepared.root,
        prepared.env,
      );
      assert.equal(firstPreview.status, 0, firstPreview.stdout);
      const firstBodySha256 = (
        JSON.parse(firstPreview.stdout) as {
          sync: { bodySha256: string };
        }
      ).sync.bodySha256;
      const first = executeCli(
        [
          "workflow",
          "advance",
          `--staging=${staging}`,
          "--repo=o/r",
          "--issue=877",
          "--authorize=approved",
          `--expected-body-sha256=${firstBodySha256}`,
          `--recorded-at=${instant}`,
          `--synced-at=${instant}`,
          "--apply",
        ],
        prepared.root,
        prepared.env,
      );
      assert.equal(first.status, 0, first.stdout + first.stderr);
      for (const step of [5, 6, 7])
        appendWorkflowJournalEntry({
          staging,
          entry: entry(step, "full"),
        });
      const journalFile = path.join(staging, STEP_JOURNAL_FILE);
      const journalLines = fs
        .readFileSync(journalFile, "utf8")
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as StepJournalEntry);
      const step4 = journalLines.find((item) => item.step === 4);
      assert.ok(step4);
      step4.artifacts.push("https://github.com/o/r/issues/878");
      /** 手書きで改変したjournalは旧journal（hash chainなし）として作る */
      for (const item of journalLines) delete item.previousEntryDigest;
      fs.writeFileSync(
        journalFile,
        `${journalLines.map((item) => JSON.stringify(item)).join("\n")}\n`,
      );
      refreshStoredStagingDigest(staging);
      const rejected = executeCli(
        [
          "workflow",
          "advance",
          `--staging=${staging}`,
          "--repo=o/r",
          "--issue=878",
          "--authorize=approved",
          "--apply",
        ],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(rejected.status, 0);
      assert.match(
        rejected.stdout + rejected.stderr,
        /Step 4で一意に同期・記録した同じGitHub Issue/u,
      );
      const journal = parseStepJournal(
        fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE), "utf8"),
      );
      assert.equal(journal.entries.at(-1)?.step, 7);
      break;
    }
    case "SCN-E2E-ADVANCE-006": {
      const root = this.temp("asc-advance-poc-");
      const declaration = validPoc();
      for (const args of [
        ["init", "-q", "-b", "main"],
        ["config", "user.name", "advance-test"],
        ["config", "user.email", "advance-test@example.invalid"],
      ]) {
        const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
      }
      fs.writeFileSync(path.join(root, "README.md"), "# baseline\n");
      spawnSync("git", ["add", "README.md"], { cwd: root });
      spawnSync("git", ["commit", "-q", "-m", "baseline"], { cwd: root });
      const staging = createIssueStaging(root, {
        title: "workflow-advance-poc",
        answers: answers(),
        now: new Date(fixtureInstantMs()),
        requestedMode: "poc",
        poc: declaration,
      }).path;
      const requirementFile = path.join(staging, "00_要求定義.md");
      const completedRequirement = fs
        .readFileSync(requirementFile, "utf8")
        .split("\n")
        .map((line) =>
          line.startsWith("|")
            ? line
                .replaceAll("applicable / not-applicable", "not-applicable")
                .replace(/（[^）\n]*）/gu, "隔離fixture内の自動検査で確認した")
            : line,
        )
        .join("\n");
      fs.writeFileSync(
        requirementFile,
        `${completedRequirement}\nScenario: SCN-POC-ADVANCE-001 PoCの次Stepを記録する\n  Given PoC観測が現在HEADにある\n  When 次Stepを適用する\n  Then Step 9が観測証拠へ拘束される\n`,
      );
      refreshStoredStagingDigest(staging);
      materializeValidPocFixture(root, declaration);
      spawnSync("git", ["add", declaration.fixture.root], { cwd: root });
      spawnSync("git", ["commit", "-q", "-m", "poc fixture"], { cwd: root });
      const headSha = spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).stdout.trim();
      appendWorkflowJournalEntry({ staging, entry: entry(1, "poc") });
      appendWorkflowJournalEntry({
        staging,
        entry: {
          ...entry(4, "poc"),
          artifacts: ["https://github.com/o/r/issues/877"],
          evidence: `sync read-back digest ${"a".repeat(64)}`,
        },
      });
      executePocObservation({ staging, headSha, observedAt: instant });
      const untrackedArtifact = "omitted-untracked-change.txt";
      fs.writeFileSync(path.join(root, untrackedArtifact), "untracked\n");
      await assert.rejects(
        () =>
          executeMain([
            "workflow",
            "advance",
            `--staging=${staging}`,
            `--artifact=${declaration.fixture.root}`,
            "--evidence=artifact外の未追跡成果物を拒否する",
            `--recorded-at=${instant}`,
            "--apply",
          ]),
        /候補worktree全体は現在HEADと完全一致/u,
      );
      fs.unlinkSync(path.join(root, untrackedArtifact));
      const trackedFixturePath = path.join(
        declaration.fixture.root,
        declaration.fixture.runner.path,
      );
      const trackedFixture = path.join(root, trackedFixturePath);
      fs.appendFileSync(trackedFixture, "\n// uncommitted\n");
      await assert.rejects(
        () =>
          executeMain([
            "workflow",
            "advance",
            `--staging=${staging}`,
            `--artifact=${declaration.fixture.root}`,
            "--evidence=変更済み成果物を拒否する",
            `--recorded-at=${instant}`,
            "--apply",
          ]),
        /候補worktree全体は現在HEADと完全一致/u,
      );
      spawnSync("git", ["restore", trackedFixturePath], {
        cwd: root,
      });
      const checked = await executeMain([
        "workflow",
        "advance",
        `--staging=${staging}`,
        `--artifact=${declaration.fixture.root}`,
        "--evidence=PoC観測結果を現在HEADへ拘束した",
        `--recorded-at=${instant}`,
        "--apply",
      ]);
      assert.equal(checked.status, 0, checked.stdout);
      const journal = parseStepJournal(
        fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE), "utf8"),
      );
      assert.equal(journal.entries.at(-1)?.step, 9);
      assert.equal(journal.entries.at(-1)?.pocObservation?.headSha, headSha);
      break;
    }
    case "SCN-E2E-ADVANCE-007": {
      const staging = createQuickStaging(this.temp("asc-advance-request-"));
      fs.writeFileSync(path.join(staging, "00_要求定義.md"), "# 未完成\n");
      refreshStoredStagingDigest(staging);
      const before = fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE));
      await assert.rejects(
        () =>
          executeMain([
            "workflow",
            "advance",
            `--staging=${staging}`,
            "--artifact=00_要求定義.md",
            "--evidence=未完成成果物",
            "--apply",
          ]),
        /成果物検証に失敗/u,
      );
      assert.deepEqual(
        fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE)),
        before,
      );
      break;
    }
    case "SCN-E2E-ADVANCE-008": {
      const prepared = prepareDeliveryCli(this, {}, "disabled");
      const staging = createIssueStaging(prepared.root, {
        title: "workflow-advance-invalid-time",
        answers: answers(false),
        now: new Date(instant),
        requestedMode: "full",
      }).path;
      writeFullStagingArtifacts(staging);
      for (const step of [1, 2, 3])
        appendWorkflowJournalEntry({
          staging,
          entry: entry(step, "full"),
        });
      const rejected = executeCli(
        [
          "workflow",
          "advance",
          `--staging=${staging}`,
          "--repo=o/r",
          "--issue=877",
          "--authorize=approved",
          "--recorded-at=not-an-instant",
          "--apply",
        ],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stdout + rejected.stderr, /ISO 8601 UTC/u);
      assert.equal(
        deliveryProviderCalls(prepared).some(
          (args) => args[0] === "issue" && args[1] === "edit",
        ),
        false,
      );
      const journal = parseStepJournal(
        fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE), "utf8"),
      );
      assert.equal(journal.entries.at(-1)?.step, 3);
      break;
    }
    case "SCN-E2E-ADVANCE-009": {
      const staging = createQuickStaging(this.temp("asc-advance-flags-"));
      completeAdvanceRequirement(staging);
      const journalFile = path.join(staging, STEP_JOURNAL_FILE);
      const before = fs.readFileSync(journalFile);
      await assert.rejects(
        () =>
          executeMain([
            "workflow",
            "advance",
            `--staging=${staging}`,
            "--artifact=00_要求定義.md",
            "--evidence=競合する実行modeを拒否する",
            "--dry-run",
            "--apply",
          ]),
        /--applyと--dry-runは同時に指定できません/u,
      );
      assert.deepEqual(fs.readFileSync(journalFile), before);
      break;
    }
    case "SCN-E2E-ADVANCE-010": {
      assert.throws(
        () =>
          composeWorkflowAdvanceIssueBody(
            "# 既存本文\n",
            "# 生成本文\n<!-- agent-skill-chain:workflow-advance:start -->\n",
          ),
        /予約marker/u,
      );
      const preservedPrefix = "利用者のhard break  \n\n";
      const preservedSuffix = "\n    indented user content\n";
      assert.equal(
        composeWorkflowAdvanceIssueBody(
          `${preservedPrefix}<!-- agent-skill-chain:workflow-advance:start -->\nold\n<!-- agent-skill-chain:workflow-advance:end -->${preservedSuffix}`,
          "new",
        ),
        `${preservedPrefix}<!-- agent-skill-chain:workflow-advance:start -->\nnew\n<!-- agent-skill-chain:workflow-advance:end -->${preservedSuffix}`,
      );
      const prepared = prepareDeliveryCli(this, {}, "disabled");
      const staging = createIssueStaging(prepared.root, {
        title: "workflow-advance-reserved-marker",
        answers: answers(false),
        now: new Date(instant),
        requestedMode: "full",
      }).path;
      writeFullStagingArtifacts(staging);
      fs.appendFileSync(
        path.join(staging, "01_要件定義.md"),
        "\n<!-- agent-skill-chain:workflow-advance:end -->\n",
      );
      refreshStoredStagingDigest(staging);
      for (const step of [1, 2, 3])
        appendWorkflowJournalEntry({ staging, entry: entry(step, "full") });
      const rejected = executeCli(
        [
          "workflow",
          "advance",
          `--staging=${staging}`,
          "--repo=o/r",
          "--issue=877",
          "--authorize=approved",
          `--recorded-at=${instant}`,
          `--synced-at=${instant}`,
          "--apply",
        ],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(rejected.status, 0);
      assert.match(
        rejected.stdout + rejected.stderr,
        /予約marker|未解決のplaceholder/u,
      );
      assert.equal(
        deliveryProviderCalls(prepared).some(
          (args) => args[0] === "issue" && args[1] === "edit",
        ),
        false,
      );
      const journal = parseStepJournal(
        fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE), "utf8"),
      );
      assert.equal(journal.entries.at(-1)?.step, 3);
      break;
    }
    case "SCN-E2E-ADVANCE-011": {
      const root = this.temp("asc-advance-design-stage-");
      for (const args of [
        ["init", "-q", "-b", "main"],
        ["config", "user.name", "advance-test"],
        ["config", "user.email", "advance-test@example.invalid"],
      ]) {
        const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
      }
      fs.writeFileSync(path.join(root, "README.md"), "# baseline\n");
      spawnSync("git", ["add", "README.md"], { cwd: root });
      spawnSync("git", ["commit", "-q", "-m", "baseline"], { cwd: root });
      const staging = createIssueStaging(root, {
        title: "workflow-advance-design-stage",
        answers: answers(false),
        now: new Date(instant),
        requestedMode: "full",
      }).path;
      writeFullStagingArtifacts(staging);
      fs.writeFileSync(path.join(staging, "03_実装計画.md"), "# 未完成\n");
      refreshStoredStagingDigest(staging);
      for (const step of [1, 2, 3, 4])
        appendWorkflowJournalEntry({
          staging,
          entry: {
            ...entry(step, "full"),
            ...(step === 4
              ? {
                  artifacts: ["https://github.com/o/r/issues/877"],
                  evidence: `sync read-back digest ${"a".repeat(64)}`,
                }
              : {}),
          },
        });
      const checked = await executeMain([
        "workflow",
        "advance",
        `--staging=${staging}`,
        "--artifact=02_設計.md",
        "--evidence=設計成果物を確認した",
        `--recorded-at=${instant}`,
        "--apply",
      ]);
      assert.equal(checked.status, 0, checked.stdout);
      const journal = parseStepJournal(
        fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE), "utf8"),
      );
      assert.equal(journal.entries.at(-1)?.step, 5);
      break;
    }
    case "SCN-E2E-ADVANCE-012": {
      const prepared = prepareDeliveryCli(this, {}, "disabled");
      fs.writeFileSync(prepared.issueBodyFile, "# initial issue body\n");
      const staging = createIssueStaging(prepared.root, {
        title: "workflow-advance-concurrent-issue-edit",
        answers: answers(false),
        now: new Date(instant),
        requestedMode: "full",
      }).path;
      writeFullStagingArtifacts(staging);
      for (const step of [1, 2, 3])
        appendWorkflowJournalEntry({ staging, entry: entry(step, "full") });
      const preview = executeCli(
        [
          "workflow",
          "advance",
          `--staging=${staging}`,
          "--repo=o/r",
          "--issue=877",
        ],
        prepared.root,
        prepared.env,
      );
      assert.equal(preview.status, 0, preview.stdout);
      const expectedBodySha256 = (
        JSON.parse(preview.stdout) as { sync: { bodySha256: string } }
      ).sync.bodySha256;
      const control = JSON.parse(
        fs.readFileSync(prepared.controlFile, "utf8"),
      ) as DeliveryProviderControl;
      control.concurrentIssueEditAtAdapterCas = true;
      fs.writeFileSync(prepared.controlFile, `${JSON.stringify(control)}\n`);
      const rejected = executeCli(
        [
          "workflow",
          "advance",
          `--staging=${staging}`,
          "--repo=o/r",
          "--issue=877",
          "--authorize=approved",
          `--expected-body-sha256=${expectedBodySha256}`,
          `--recorded-at=${instant}`,
          `--synced-at=${instant}`,
          "--apply",
        ],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(rejected.status, 0);
      assert.match(
        rejected.stdout + rejected.stderr,
        /Issue同期直前に本文が変更されました/u,
      );
      assert.equal(
        deliveryProviderCalls(prepared).some(
          (args) => args[0] === "issue" && args[1] === "edit",
        ),
        false,
      );
      const journal = parseStepJournal(
        fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE), "utf8"),
      );
      assert.equal(journal.entries.at(-1)?.step, 3);
      break;
    }
    case "SCN-E2E-ADVANCE-013": {
      const prepared = prepareDeliveryCli(
        this,
        { failIssueReadBackAfterEditOnce: true },
        "disabled",
      );
      fs.writeFileSync(prepared.issueBodyFile, "# initial issue body\n");
      const staging = createIssueStaging(prepared.root, {
        title: "workflow-advance-journal-recovery",
        answers: answers(false),
        now: new Date(instant),
        requestedMode: "full",
      }).path;
      writeFullStagingArtifacts(staging);
      for (const step of [1, 2, 3])
        appendWorkflowJournalEntry({ staging, entry: entry(step, "full") });
      const applyFromNewPreview = () => {
        const preview = executeCli(
          [
            "workflow",
            "advance",
            `--staging=${staging}`,
            "--repo=o/r",
            "--issue=877",
          ],
          prepared.root,
          prepared.env,
        );
        assert.equal(preview.status, 0, preview.stdout);
        const expectedBodySha256 = (
          JSON.parse(preview.stdout) as { sync: { bodySha256: string } }
        ).sync.bodySha256;
        return executeCli(
          [
            "workflow",
            "advance",
            `--staging=${staging}`,
            "--repo=o/r",
            "--issue=877",
            "--authorize=approved",
            `--expected-body-sha256=${expectedBodySha256}`,
            `--recorded-at=${instant}`,
            `--synced-at=${instant}`,
            "--apply",
          ],
          prepared.root,
          prepared.env,
        );
      };
      const interrupted = applyFromNewPreview();
      assert.notEqual(interrupted.status, 0);
      assert.match(
        interrupted.stdout + interrupted.stderr,
        /state=published.*journalTransaction=none/u,
      );
      const recovered = applyFromNewPreview();
      assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
      assert.equal(
        (
          JSON.parse(recovered.stdout) as {
            result: { recovery: { state: string } };
          }
        ).result.recovery.state,
        "journal-recovered",
      );
      assert.equal(
        deliveryProviderCalls(prepared).filter(
          (args) => args[0] === "issue" && args[1] === "edit",
        ).length,
        1,
      );
      const journal = parseStepJournal(
        fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE), "utf8"),
      );
      assert.equal(journal.entries.at(-1)?.step, 4);
      break;
    }
    case "SCN-E2E-ADVANCE-014": {
      const root = fs.realpathSync(this.initRepo());
      const staging = createIssueStaging(root, {
        title: "resume-test",
        answers: answers(),
        now: new Date(instant),
        requestedMode: "full",
      }).path;
      const { status, output } = await previewResume(staging);
      assert.equal(status, 0, JSON.stringify(output));
      assert.equal(output.targetStep, 1);
      const short = executeCli(
        ["workflow", "advance", `--staging=${staging}`],
        root,
        {
          ...process.env,
          ASC_EXECUTION_CONTEXT_MODE: "short-lived",
        },
      );
      assert.equal(short.status, 0, short.stdout + short.stderr);
      const handoff = (
        JSON.parse(short.stdout) as {
          handoff: {
            role: string;
            headSha: string;
            staging: string;
            boundary: { stepsSha256: string };
            workUnit: {
              workUnitId: string;
              freshContextRequired: boolean;
              terminalAfterHandback: boolean;
              reuseForbidden: boolean;
            };
          };
        }
      ).handoff;
      assert.equal(handoff.role, "request");
      assert.equal(handoff.headSha, gitHeadOf(root));
      assert.equal(handoff.staging, staging);
      assert.match(handoff.boundary.stepsSha256, /^[a-f0-9]{64}$/u);
      assert.match(handoff.workUnit.workUnitId, /^[a-f0-9]{64}$/u);
      assert.equal(handoff.workUnit.freshContextRequired, true);
      assert.equal(handoff.workUnit.terminalAfterHandback, true);
      assert.equal(handoff.workUnit.reuseForbidden, true);
      assert.match(short.stdout, /ASC_REDISPATCH_REQUIRED/u);
      assert.deepEqual(output.resume, {
        authority: "advisory",
        staging,
        headSha: gitHeadOf(root),
        baseSha: null,
        planning: { sealed: false, sealDigest: null, amendmentCount: 0 },
        implementation: { headSha: null, matchesHead: null },
        verification: null,
        review: null,
        delivery: null,
        errors: [],
      });
      break;
    }
    case "SCN-E2E-ADVANCE-018": {
      const root = fs.realpathSync(this.initRepo());
      const staging = createIssueStaging(root, {
        title: "same-step-continuation",
        answers: answers(),
        now: new Date(instant),
        requestedMode: "quick",
      }).path;
      for (const step of [1, 4])
        appendWorkflowJournalEntry({ staging, entry: entry(step) });
      const previousHead = gitHeadOf(root);
      const initial = executeCli(
        ["workflow", "advance", `--staging=${staging}`],
        root,
      );
      assert.equal(initial.status, 0, initial.stdout + initial.stderr);
      const initialWorkUnitId = (
        JSON.parse(initial.stdout) as {
          handoff: { workUnit: { workUnitId: string } };
        }
      ).handoff.workUnit.workUnitId;
      const args = [
        "workflow",
        "advance",
        `--staging=${staging}`,
        `--continue-from=${previousHead}`,
      ];
      const beforeCommit = executeCli(args, root);
      assert.notEqual(beforeCommit.status, 0);
      assert.match(
        beforeCommit.stdout + beforeCommit.stderr,
        /checkpoint commit/u,
      );
      fs.writeFileSync(path.join(root, "checkpoint.txt"), "checkpoint\n");
      spawnSync("git", ["add", "checkpoint.txt"], { cwd: root });
      spawnSync("git", ["commit", "-q", "-m", "checkpoint"], { cwd: root });
      const missingCommit = executeCli(
        [
          "workflow",
          "advance",
          `--staging=${staging}`,
          `--continue-from=${"f".repeat(40)}`,
        ],
        root,
      );
      assert.notEqual(missingCommit.status, 0);
      assert.match(
        missingCommit.stdout + missingCommit.stderr,
        /checkpoint commit/u,
      );
      const continuation = executeCli(args, root);
      assert.equal(
        continuation.status,
        0,
        continuation.stdout + continuation.stderr,
      );
      const output = JSON.parse(continuation.stdout) as {
        handoff: {
          step: number;
          continuationFromHead: string;
          workUnit: { workUnitId: string };
        };
        agentDispatch: { prompt: string };
      };
      assert.equal(output.handoff.step, 9);
      assert.equal(output.handoff.continuationFromHead, previousHead);
      assert.match(output.handoff.workUnit.workUnitId, /^[a-f0-9]{64}$/u);
      assert.notEqual(output.handoff.workUnit.workUnitId, initialWorkUnitId);
      assert.match(output.agentDispatch.prompt, /ASC_REDISPATCH_REQUIRED/u);
      const realGit = spawnSync("which", ["git"], { encoding: "utf8" });
      assert.equal(realGit.status, 0);
      const realGitPath = realGit.stdout.trim();
      assert.match(realGitPath, /^\/[a-zA-Z0-9_./-]+$/u);
      const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "asc-git-diff-"));
      try {
        fs.writeFileSync(
          path.join(shimDir, "git"),
          `#!/bin/sh\nif [ "$1" = "diff" ] && [ "$2" = "--quiet" ]; then\n  echo "simulated execution failure" >&2\n  exit 1\nfi\nexec "${realGitPath}" "$@"\n`,
          { mode: 0o755 },
        );
        const failedDiff = executeCli(args, root, {
          ...process.env,
          PATH: `${shimDir}${path.delimiter}${process.env.PATH ?? ""}`,
        });
        assert.notEqual(failedDiff.status, 0);
        assert.match(
          failedDiff.stdout + failedDiff.stderr,
          /checkpoint差分判定に失敗しました: simulated execution failure/u,
        );
      } finally {
        fs.rmSync(shimDir, { recursive: true, force: true });
      }
      const repeated = executeCli(args, root);
      assert.equal(repeated.status, 0, repeated.stdout + repeated.stderr);
      assert.equal(
        (JSON.parse(repeated.stdout) as typeof output).handoff.workUnit
          .workUnitId,
        output.handoff.workUnit.workUnitId,
      );
      const apply = executeCli([...args, "--apply"], root);
      assert.notEqual(apply.status, 0);
      assert.match(apply.stdout + apply.stderr, /preview専用/u);
      const firstCheckpointHead = gitHeadOf(root);
      fs.writeFileSync(
        path.join(root, "checkpoint.txt"),
        "second checkpoint\n",
      );
      spawnSync("git", ["add", "checkpoint.txt"], { cwd: root });
      spawnSync("git", ["commit", "-q", "-m", "second checkpoint"], {
        cwd: root,
      });
      const olderAncestor = executeCli(args, root);
      assert.notEqual(olderAncestor.status, 0);
      assert.match(olderAncestor.stdout + olderAncestor.stderr, /直前親/u);
      const secondHead = gitHeadOf(root);
      const next = executeCli(
        [
          "workflow",
          "advance",
          `--staging=${staging}`,
          `--continue-from=${firstCheckpointHead}`,
        ],
        root,
      );
      assert.equal(next.status, 0, next.stdout + next.stderr);
      assert.notEqual(
        (JSON.parse(next.stdout) as typeof output).handoff.workUnit.workUnitId,
        output.handoff.workUnit.workUnitId,
      );
      spawnSync(
        "git",
        ["commit", "-q", "--allow-empty", "-m", "empty checkpoint"],
        {
          cwd: root,
        },
      );
      const emptyCheckpoint = executeCli(
        [
          "workflow",
          "advance",
          `--staging=${staging}`,
          `--continue-from=${secondHead}`,
        ],
        root,
      );
      assert.notEqual(emptyCheckpoint.status, 0);
      assert.match(
        emptyCheckpoint.stdout + emptyCheckpoint.stderr,
        /tracked変更/u,
      );
      break;
    }
    case "SCN-E2E-ADVANCE-015": {
      const { root, staging, implementationHeadSha } =
        implementedResumeStaging(this);
      const atImplementation = await previewResume(staging);
      assert.deepEqual(atImplementation.output.resume.implementation, {
        headSha: implementationHeadSha,
        matchesHead: true,
      });
      fs.writeFileSync(path.join(root, "later.txt"), "after Step 9\n");
      spawnSync("git", ["add", "later.txt"], { cwd: root });
      spawnSync("git", ["commit", "-q", "-m", "after Step 9"], { cwd: root });
      const movedHeadSha = gitHeadOf(root);
      assert.notEqual(movedHeadSha, implementationHeadSha);
      const moved = await previewResume(staging);
      assert.equal(moved.output.resume.headSha, movedHeadSha);
      assert.deepEqual(moved.output.resume.implementation, {
        headSha: implementationHeadSha,
        matchesHead: false,
      });
      assert.equal(moved.output.resume.review, null);
      const roundFile = path.join(this.temp("asc-resume-round-"), "round.json");
      fs.writeFileSync(
        roundFile,
        JSON.stringify(
          reviewRoundFixture(root, implementationHeadSha, movedHeadSha),
        ),
      );
      await assert.rejects(
        () =>
          executeMain([
            "review",
            "round",
            `--staging=${staging}`,
            `--file=${roundFile}`,
          ]),
        /review round candidate HEADがStep 9 implementation HEADと一致しません/u,
      );
      /** 再開状態は最新のStep 9を指す。current HEADで再記録すると一致へ戻る。 */
      appendWorkflowJournalEntry({
        staging,
        entry: { ...entry(9), implementationHeadSha: movedHeadSha },
        headSha: movedHeadSha,
      });
      const rerecorded = await previewResume(staging);
      assert.deepEqual(rerecorded.output.resume.implementation, {
        headSha: movedHeadSha,
        matchesHead: true,
      });
      break;
    }
    case "SCN-E2E-ADVANCE-016": {
      const prepared = prepareDeliveryCli(this);
      createDeliveryPullRequest(prepared);
      /** 最新の検証記録を指すことを、内容の異なる2件目の記録で確かめる。 */
      appendFixtureVerificationRecords(
        prepared.staging,
        observeFixtureVerification(prepared.root, {
          baseSha: prepared.baseSha,
          implementationHeadSha: prepared.implementationCommitSha,
          finishedAt: "2026-09-26T00:00:30.000Z",
        }).records,
      );
      fs.writeFileSync(
        path.join(prepared.staging, "05_計画変更.md"),
        "# 05 計画変更\n\n## AMD-001 範囲\n\n- 対象: T01\n- 変更: 再開状態\n- 理由: 検査\n",
      );
      const beforePreview = resumeWriteSnapshot(
        prepared.root,
        prepared.staging,
      );
      const checked = executeCli(
        ["workflow", "advance", `--staging=${prepared.staging}`],
        prepared.root,
        prepared.env,
      );
      /** previewはstagingのfileもGitのobject・lockも変えない。 */
      assert.deepEqual(
        resumeWriteSnapshot(prepared.root, prepared.staging),
        beforePreview,
      );
      const resume = (JSON.parse(checked.stdout) as ResumePreview["output"])
        .resume;
      const session = JSON.parse(
        fs.readFileSync(
          path.join(prepared.staging, "review-session.json"),
          "utf8",
        ),
      ) as {
        anchor: { diffBaseSha: string };
        latestRoundDigest: string;
        latestCandidateHeadSha: string;
        status: string;
        rounds: unknown[];
      };
      const runs = fs
        .readFileSync(
          path.join(prepared.staging, "journal", "verification-runs.jsonl"),
          "utf8",
        )
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line) as {
              headSha: string;
              scope: string;
              exitCode: number | null;
              signal: string | null;
              recordDigest: string;
            },
        );
      assert.ok(runs.length >= 2);
      assert.notEqual(runs[0]?.recordDigest, runs.at(-1)?.recordDigest);
      const latestRun = runs.at(-1)!;
      const delivery = JSON.parse(
        fs.readFileSync(
          path.join(prepared.staging, ...DELIVERY_STATE_FILE.split("/")),
          "utf8",
        ),
      ) as { state: string; pr: { number: number } };
      assert.equal(delivery.state, "pr-bound");
      assert.equal(resume.headSha, prepared.headSha);
      assert.equal(resume.baseSha, session.anchor.diffBaseSha);
      const sha256 = (value: string | Buffer) =>
        crypto.createHash("sha256").update(value).digest("hex");
      /** quickの封印は00要求定義だけのSHA-256であり、Step 4記録後に00は変えていない。 */
      const requirementDigest = sha256(
        fs.readFileSync(path.join(prepared.staging, "00_要求定義.md")),
      );
      assert.deepEqual(resume.planning, {
        sealed: true,
        sealDigest: sha256(
          JSON.stringify({ "00_要求定義.md": requirementDigest }),
        ),
        amendmentCount: 1,
      });
      assert.equal(
        resume.implementation.headSha,
        prepared.implementationCommitSha,
      );
      /** 期待値は実装と同じ式から導出せず、fixtureの既知値をliteralで書く。 */
      assert.deepEqual(
        [latestRun.headSha, latestRun.exitCode, latestRun.signal],
        [prepared.implementationCommitSha, 0, null],
      );
      assert.deepEqual(resume.verification, {
        headSha: prepared.implementationCommitSha,
        scope: "full",
        passed: true,
        recordDigest: latestRun.recordDigest,
        matchesImplementationHead: true,
      });
      assert.equal(
        session.latestCandidateHeadSha,
        prepared.implementationCommitSha,
      );
      assert.deepEqual(resume.review, {
        status: "converged",
        latestRoundDigest: session.latestRoundDigest,
        candidateHeadSha: prepared.implementationCommitSha,
        rounds: 1,
        matchesImplementationHead: true,
      });
      assert.deepEqual(resume.delivery, {
        state: "pr-bound",
        pr: delivery.pr.number,
      });
      assert.deepEqual(resume.errors, []);
      const serialized = JSON.stringify(resume);
      for (const body of ["step 9の証拠", "artifact-9", "findings", "範囲"])
        assert.equal(serialized.includes(body), false, body);
      /** 最新の検証記録がH_implと異なるHEADを指せば、一致をliteralのfalseで返す。 */
      assert.notEqual(prepared.headSha, prepared.implementationCommitSha);
      appendFixtureVerificationRecords(
        prepared.staging,
        observeFixtureVerification(prepared.root, {
          baseSha: prepared.baseSha,
          implementationHeadSha: prepared.headSha,
          finishedAt: "2026-09-26T00:01:00.000Z",
        }).records,
      );
      const stale = executeCli(
        ["workflow", "advance", `--staging=${prepared.staging}`],
        prepared.root,
        prepared.env,
      );
      const staleResume = (JSON.parse(stale.stdout) as ResumePreview["output"])
        .resume;
      assert.equal(staleResume.verification?.headSha, prepared.headSha);
      assert.equal(staleResume.verification?.passed, true);
      assert.equal(staleResume.verification?.matchesImplementationHead, false);
      /** Step 9が無いstagingのreview sessionは、H_impl不明のため一致をnullで返す。 */
      const withoutStep9 = createQuickStaging(
        this.temp("asc-resume-no-step9-"),
      );
      for (const step of [1, 4])
        appendWorkflowJournalEntry({
          staging: withoutStep9,
          entry: entry(step),
        });
      fs.copyFileSync(
        path.join(prepared.staging, "review-session.json"),
        path.join(withoutStep9, "review-session.json"),
      );
      const unanchored = (await previewResume(withoutStep9)).output.resume;
      assert.deepEqual(unanchored.implementation, {
        headSha: null,
        matchesHead: null,
      });
      assert.equal(
        unanchored.review?.candidateHeadSha,
        prepared.implementationCommitSha,
      );
      assert.equal(unanchored.review?.matchesImplementationHead, null);
      break;
    }
    case "SCN-E2E-ADVANCE-017": {
      const { staging } = implementedResumeStaging(this);
      const before = await previewResume(staging);
      fs.writeFileSync(path.join(staging, "review-session.json"), "{broken");
      const after = await previewResume(staging);
      assert.equal(after.status, before.status);
      assert.deepEqual(
        [
          after.output.state,
          after.output.operation,
          after.output.targetStep,
          after.output.reasons,
        ],
        [
          before.output.state,
          before.output.operation,
          before.output.targetStep,
          before.output.reasons,
        ],
      );
      assert.equal(after.output.resume.review, null);
      assert.equal(after.output.resume.errors.length, 1);
      assert.match(after.output.resume.errors[0] ?? "", /^review session: /u);
      assert.deepEqual(before.output.resume.errors, []);
      /** HEADを観測できないrepositoryでも判定は変わらず、一致を表示しない。 */
      const detached = createQuickStaging(this.temp("asc-resume-no-git-"));
      for (const step of [1, 4])
        appendWorkflowJournalEntry({ staging: detached, entry: entry(step) });
      appendWorkflowJournalEntry({
        staging: detached,
        entry: { ...entry(9), implementationHeadSha: "a".repeat(40) },
      });
      const unobserved = await previewResume(detached);
      assert.equal(unobserved.status, 0);
      assert.equal(unobserved.output.state, "delegated");
      assert.equal(unobserved.output.resume.headSha, null);
      assert.deepEqual(unobserved.output.resume.implementation, {
        headSha: "a".repeat(40),
        matchesHead: null,
      });
      assert.equal(unobserved.output.resume.errors.length, 1);
      assert.match(unobserved.output.resume.errors[0] ?? "", /^HEAD: /u);
      /** hash chainが壊れたjournalは信用せず、journal由来の項目を不明にする。 */
      const chained = implementedResumeStaging(this);
      const intact = await previewResume(chained.staging);
      assert.deepEqual(intact.output.resume.implementation, {
        headSha: chained.implementationHeadSha,
        matchesHead: true,
      });
      assert.deepEqual(intact.output.resume.errors, []);
      const journalFile = path.join(chained.staging, "journal", "steps.jsonl");
      const lines = fs.readFileSync(journalFile, "utf8").trimEnd().split("\n");
      const last = lines.length - 1;
      const tampered = JSON.parse(lines[last]!) as {
        previousEntryDigest: string;
      };
      assert.match(tampered.previousEntryDigest, /^[a-f0-9]{64}$/u);
      tampered.previousEntryDigest = "0".repeat(64);
      lines[last] = JSON.stringify(tampered);
      fs.writeFileSync(journalFile, `${lines.join("\n")}\n`);
      const broken = await previewResume(chained.staging);
      /** 既存のpreview判定はjournalの破損を独自に拒否する。再開状態はそれを変えない。 */
      const chainError =
        "journal 4行目.previousEntryDigestが先行するjournal本文と一致しません。記録済み行の編集・削除・挿入・並べ替えを拒否します";
      assert.deepEqual(
        [
          broken.status,
          broken.output.state,
          broken.output.operation,
          broken.output.targetStep,
          broken.output.reasons,
        ],
        [1, "blocked", "blocked", 10, [chainError]],
      );
      assert.equal(broken.output.resume.planning, null);
      assert.deepEqual(broken.output.resume.implementation, {
        headSha: null,
        matchesHead: null,
      });
      assert.deepEqual(broken.output.resume.errors, [`journal: ${chainError}`]);
      break;
    }
    case "SCN-INT-ISSUESYNC-024": {
      const prepared = prepareDeliveryCli(this, {}, "disabled");
      fs.writeFileSync(prepared.issueBodyFile, "# existing issue body\n");
      const staging = createIssueStaging(prepared.root, {
        title: "workflow-advance-exact-body-digest",
        answers: answers(false),
        now: new Date(instant),
        requestedMode: "full",
      }).path;
      writeFullStagingArtifacts(staging);
      for (const step of [1, 2, 3])
        appendWorkflowJournalEntry({ staging, entry: entry(step, "full") });
      const preview = executeCli(
        [
          "workflow",
          "advance",
          `--staging=${staging}`,
          "--repo=o/r",
          "--issue=877",
        ],
        prepared.root,
        prepared.env,
      );
      assert.equal(preview.status, 0, preview.stdout + preview.stderr);
      const previewDigest = (
        JSON.parse(preview.stdout) as { sync: { bodySha256: string } }
      ).sync.bodySha256;
      const applied = executeCli(
        [
          "workflow",
          "advance",
          `--staging=${staging}`,
          "--repo=o/r",
          "--issue=877",
          "--authorize=approved",
          `--expected-body-sha256=${previewDigest}`,
          `--recorded-at=${instant}`,
          `--synced-at=${instant}`,
          "--apply",
        ],
        prepared.root,
        prepared.env,
      );
      assert.equal(applied.status, 0, applied.stdout + applied.stderr);
      const synchronizedBody = fs.readFileSync(prepared.issueBodyFile, "utf8");
      assert.equal(
        previewDigest,
        crypto.createHash("sha256").update(synchronizedBody).digest("hex"),
      );
      break;
    }
    case "SCN-INT-ISSUESYNC-025": {
      const prepared = prepareDeliveryCli(
        this,
        { failIssueReadBackAfterEditOnce: true },
        "disabled",
      );
      fs.writeFileSync(prepared.issueBodyFile, "# initial issue body\n");
      const staging = createIssueStaging(prepared.root, {
        title: "workflow-advance-exact-readback-digest",
        answers: answers(false),
        now: new Date(instant),
        requestedMode: "full",
      }).path;
      writeFullStagingArtifacts(staging);
      for (const step of [1, 2, 3])
        appendWorkflowJournalEntry({ staging, entry: entry(step, "full") });
      const applyFromPreview = () => {
        const preview = executeCli(
          [
            "workflow",
            "advance",
            `--staging=${staging}`,
            "--repo=o/r",
            "--issue=877",
          ],
          prepared.root,
          prepared.env,
        );
        assert.equal(preview.status, 0, preview.stdout + preview.stderr);
        const digest = (
          JSON.parse(preview.stdout) as { sync: { bodySha256: string } }
        ).sync.bodySha256;
        return executeCli(
          [
            "workflow",
            "advance",
            `--staging=${staging}`,
            "--repo=o/r",
            "--issue=877",
            "--authorize=approved",
            `--expected-body-sha256=${digest}`,
            `--recorded-at=${instant}`,
            `--synced-at=${instant}`,
            "--apply",
          ],
          prepared.root,
          prepared.env,
        );
      };
      const interrupted = applyFromPreview();
      assert.notEqual(interrupted.status, 0);
      const recovered = applyFromPreview();
      assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
      const exactDigest = crypto
        .createHash("sha256")
        .update(fs.readFileSync(prepared.issueBodyFile, "utf8"))
        .digest("hex");
      const journal = parseStepJournal(
        fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE), "utf8"),
      );
      assert.match(
        journal.entries.at(-1)?.evidence ?? "",
        new RegExp(exactDigest, "u"),
      );
      assert.equal(
        deliveryProviderCalls(prepared).filter(
          (args) => args[0] === "issue" && args[1] === "edit",
        ).length,
        1,
      );
      break;
    }
    case "SCN-INT-ISSUESYNC-027": {
      const prepared = prepareDeliveryCli(
        this,
        { mutateIssueBodyAfterEdit: "drop-final-lf" },
        "disabled",
      );
      fs.writeFileSync(prepared.issueBodyFile, "# initial issue body\n");
      const staging = createIssueStaging(prepared.root, {
        title: "workflow-advance-reject-changed-readback",
        answers: answers(false),
        now: new Date(instant),
        requestedMode: "full",
      }).path;
      writeFullStagingArtifacts(staging);
      for (const step of [1, 2, 3])
        appendWorkflowJournalEntry({ staging, entry: entry(step, "full") });
      const preview = executeCli(
        [
          "workflow",
          "advance",
          `--staging=${staging}`,
          "--repo=o/r",
          "--issue=877",
        ],
        prepared.root,
        prepared.env,
      );
      assert.equal(preview.status, 0, preview.stdout + preview.stderr);
      const previewDigest = (
        JSON.parse(preview.stdout) as { sync: { bodySha256: string } }
      ).sync.bodySha256;
      const rejected = executeCli(
        [
          "workflow",
          "advance",
          `--staging=${staging}`,
          "--repo=o/r",
          "--issue=877",
          "--authorize=approved",
          `--expected-body-sha256=${previewDigest}`,
          `--recorded-at=${instant}`,
          `--synced-at=${instant}`,
          "--apply",
        ],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(rejected.status, 0);
      assert.match(
        rejected.stdout + rejected.stderr,
        /Issue同期後の読み取り検証に失敗しました/u,
      );
      const journal = parseStepJournal(
        fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE), "utf8"),
      );
      assert.equal(journal.entries.at(-1)?.step, 3);
      assert.equal(
        deliveryProviderCalls(prepared).filter(
          (args) => args[0] === "issue" && args[1] === "edit",
        ).length,
        1,
      );
      break;
    }
    case "SCN-INT-ISSUESYNC-028": {
      const prepared = prepareDeliveryCli(this, {}, "disabled");
      fs.writeFileSync(prepared.issueBodyFile, "# initial issue body\n");
      const staging = createIssueStaging(prepared.root, {
        title: "issue-sync-exact-body-digest",
        answers: answers(false),
        now: new Date(instant),
        requestedMode: "full",
      }).path;
      writeFullStagingArtifacts(staging);
      for (const step of [1, 2, 3, 4, 5, 6, 7])
        appendWorkflowJournalEntry({ staging, entry: entry(step, "full") });
      const preview = executeCli(
        [
          "issue",
          "sync",
          "--generate-body",
          `--staging-path=${staging}`,
          "--checkpoint=8",
          "--repo=o/r",
          "--issue=877",
          "--dry-run",
        ],
        prepared.root,
        prepared.env,
      );
      assert.equal(preview.status, 0, preview.stdout + preview.stderr);
      const previewObservation = JSON.parse(preview.stdout) as {
        bodySha256: string;
        currentBodySha256: string;
      };
      const previewDigest = previewObservation.bodySha256;
      const stalePreview = executeCli(
        [
          "issue",
          "sync",
          "--generate-body",
          `--staging-path=${staging}`,
          "--checkpoint=8",
          "--repo=o/r",
          "--issue=877",
          "--authorize=approved",
          `--expected-body-sha256=${"0".repeat(64)}`,
          `--expected-current-body-sha256=${previewObservation.currentBodySha256}`,
          `--synced-at=${instant}`,
          "--apply",
        ],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(stalePreview.status, 0);
      assert.match(stalePreview.stdout + stalePreview.stderr, /preview/u);
      assert.equal(
        deliveryProviderCalls(prepared).filter(
          (args) => args[0] === "issue" && args[1] === "edit",
        ).length,
        0,
      );
      fs.writeFileSync(prepared.issueBodyFile, "# concurrent remote edit\n");
      const staleRemote = executeCli(
        [
          "issue",
          "sync",
          "--generate-body",
          `--staging-path=${staging}`,
          "--checkpoint=8",
          "--repo=o/r",
          "--issue=877",
          "--authorize=approved",
          `--expected-body-sha256=${previewDigest}`,
          `--expected-current-body-sha256=${previewObservation.currentBodySha256}`,
          `--synced-at=${instant}`,
          "--apply",
        ],
        prepared.root,
        prepared.env,
      );
      assert.notEqual(staleRemote.status, 0);
      assert.match(staleRemote.stdout + staleRemote.stderr, /remote本文/u);
      assert.equal(
        deliveryProviderCalls(prepared).filter(
          (args) => args[0] === "issue" && args[1] === "edit",
        ).length,
        0,
      );
      const refreshedPreview = executeCli(
        [
          "issue",
          "sync",
          "--generate-body",
          `--staging-path=${staging}`,
          "--checkpoint=8",
          "--repo=o/r",
          "--issue=877",
          "--dry-run",
        ],
        prepared.root,
        prepared.env,
      );
      assert.equal(
        refreshedPreview.status,
        0,
        refreshedPreview.stdout + refreshedPreview.stderr,
      );
      const refreshedObservation = JSON.parse(refreshedPreview.stdout) as {
        bodySha256: string;
        currentBodySha256: string;
      };
      const applied = executeCli(
        [
          "issue",
          "sync",
          "--generate-body",
          `--staging-path=${staging}`,
          "--checkpoint=8",
          "--repo=o/r",
          "--issue=877",
          "--authorize=approved",
          `--expected-body-sha256=${refreshedObservation.bodySha256}`,
          `--expected-current-body-sha256=${refreshedObservation.currentBodySha256}`,
          `--synced-at=${instant}`,
          "--apply",
        ],
        prepared.root,
        prepared.env,
      );
      assert.equal(applied.status, 0, applied.stdout + applied.stderr);
      const synchronizedBody = fs.readFileSync(prepared.issueBodyFile, "utf8");
      const exactDigest = crypto
        .createHash("sha256")
        .update(synchronizedBody)
        .digest("hex");
      assert.equal(refreshedObservation.bodySha256, exactDigest);
      const record = readStoredStagingRecord(staging);
      assert.equal(record.syncDigest, exactDigest);
      assert.equal(record.readBackDigest, exactDigest);
      break;
    }
    case "SCN-E2E-REVREPLACE-001": {
      runReviewReplaceAcceptance(this);
      break;
    }
    case "SCN-E2E-REVREPLACE-003": {
      runReviewReplaceRoundTwo(this);
      runReviewReplaceAbuse(this);
      break;
    }
    case "SCN-E2E-EXTMERGE-001": {
      runExternalMergeAcceptance(this);
      break;
    }
    default:
      throw new Error(`未対応のe2e scenarioです: ${scenarioId}`);
  }
  this.workflowCheckPassed = true;
});

Then("ワークフローStep公開CLI検査は期待結果になる", function () {
  assert.equal(this.workflowCheckPassed, true);
});
