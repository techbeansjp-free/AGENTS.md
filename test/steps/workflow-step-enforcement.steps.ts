import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
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
  appendWorkflowJournalEntry,
  inspectWorkflowStaging,
  promoteWorkflowStagingToFull,
  resolvePullRequestStaging,
} from "../../src/adapters/workflow-journal.js";
import {
  calculateStagingDigest,
  listStagingArtifacts,
  readStoredStagingRecord,
  refreshStoredStagingDigest,
} from "../../src/domain/staging.js";
import type { ImplementationDiscovery } from "../../src/domain/agile-verification.js";
import {
  DELIVERY_STATE_FILE,
  canonicalDigest,
  closingContractDigest,
  parseDeliveryState,
  renderDeliveryState,
} from "../../src/domain/delivery-state.js";
import {
  claimStoredMergeDispatch,
  claimStoredPullRequestCreationDispatch,
  prepareStoredMergeIntent,
  prepareStoredPullRequestCreation,
} from "../../src/adapters/delivery-state.js";
import { doctor } from "../../src/domain/lifecycle.js";
import { checkWorkflowStepDocument } from "../../scripts/check_conformance.js";
import { checkWorkflowSteps } from "../../scripts/check_workflow_steps.js";
import { main } from "../../src/cli.js";

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
  };
}

function result(mode: Mode, entries: StepJournalEntry[], upToStep: number) {
  return validateStepJournal({ mode, entries, upToStep });
}

function validPoc(): PocDeclaration {
  return {
    purpose: "依存変更を伴う仮説を検証する",
    period: { from: "2026-08-25", to: "2026-08-26" },
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

When("{string}の単体検査を実行する", function (scenarioId: string) {
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
      assert.match(JSON.stringify(checked.output), /PR作成を再実行せず/u);
      assert.match(JSON.stringify(checked.output), /workflow record/u);
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
      assert.match(JSON.stringify(checked.output), /pr mergeを再実行せず/u);
      assert.match(JSON.stringify(checked.output), /workflow record/u);
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
      assert.throws(
        () =>
          appendWorkflowJournalEntry({
            staging,
            entry: entry(11),
          }),
        /Step 11.*delivery終端専用/u,
      );
      await assert.rejects(
        () =>
          executeMain([
            "workflow",
            "record",
            `--staging=${staging}`,
            "--step=11",
            "--artifact=https://github.com/o/r/pull/1",
            "--evidence=forged terminal",
          ]),
        /Step 11.*delivery終端専用/u,
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
  phase: "ready" | "merge-requested" | "queue-requested" | "merged";
  closingChanged: boolean;
  failMerge: boolean;
  mergedAt: string;
  remoteBaseSha: string;
  autoMergeMethod: "MERGE" | "SQUASH" | "REBASE";
  providerDefaultBranch: "main" | "develop";
  requestedAt: string;
  existingPr: "none" | "open" | "closed";
}

interface PreparedDeliveryCli extends PreparedPullRequest {
  controlFile: string;
  logFile: string;
  env: NodeJS.ProcessEnv;
}

function preparedMergeReviewEvidence(prepared: PreparedPullRequest) {
  const reviewArtifactPath = "docs/reviews/90_test_review.md";
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

function preparePullRequest(
  world: WorkflowStepWorld,
  missingStep4: boolean,
  mergeMode: "disabled" | "automatic" = "disabled",
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
  if (mergeMode === "automatic") {
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
      mode: "automatic",
      branches: ["feature/x"],
      methods: ["merge"],
      requiredChecks: [],
      requiredReviews: 0,
    };
    fs.writeFileSync(policyFile, `${JSON.stringify(policy, null, 2)}\n`);
  }
  spawnSync("git", ["add", ".agent-skill-chain/policy/default.json"], {
    cwd: root,
  });
  spawnSync("git", ["commit", "-q", "-m", "trusted policy"], {
    cwd: root,
  });
  const implementationCommitSha = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).stdout.trim();
  const baseSha = implementationCommitSha;
  spawnSync("git", ["update-ref", "refs/remotes/origin/main", baseSha], {
    cwd: root,
  });
  spawnSync(
    "git",
    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    { cwd: root },
  );
  fs.mkdirSync(path.join(root, "docs", "reviews"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "docs", "reviews", "90_test_review.md"),
    "# test review artifact\n",
  );
  spawnSync("git", ["add", "docs/reviews/90_test_review.md"], { cwd: root });
  spawnSync("git", ["commit", "-q", "-m", "review evidence"], {
    cwd: root,
  });
  const headSha = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).stdout.trim();
  const staging = createIssueStaging(root, {
    title: "workflow-test",
    answers: answers(),
    now: new Date(fixtureInstantMs()),
    requestedMode: "quick",
  }).path;
  const journalFile = path.join(staging, STEP_JOURNAL_FILE);
  if (missingStep4) {
    const entries = [0, 1, 9, 10].map((step) =>
      entry(step, "quick", fixturePast),
    );
    fs.writeFileSync(
      journalFile,
      `${entries.map((item) => JSON.stringify(item)).join("\n")}\n`,
    );
    refreshStoredStagingDigest(staging);
  } else {
    for (const step of [1, 4, 9, 10])
      appendWorkflowJournalEntry({
        staging,
        entry: entry(step, "quick", fixturePast),
      });
  }
  recordStagingSync(staging, {
    tracker: "https://github.com/o/r/issues/877",
    checkpoint: 4,
    syncedAt: fixtureNow,
    bodyDigest: "a".repeat(64),
    readBackDigest: "a".repeat(64),
  });
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
      instructedAt: fixturePast,
      expiresAt: fixtureFuture,
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
  return args[0] === "pr" && args[1] === "list";
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

function prepareDeliveryCli(
  world: WorkflowStepWorld,
  initial: Partial<DeliveryProviderControl> = {},
  mergeMode: "disabled" | "automatic" = "automatic",
): PreparedDeliveryCli {
  const prepared = preparePullRequest(world, false, mergeMode);
  const stubDirectory = world.temp("asc-delivery-cli-gh-");
  const stub = path.join(stubDirectory, "gh");
  const controlFile = path.join(stubDirectory, "control.json");
  const logFile = path.join(stubDirectory, "calls.jsonl");
  const observedBody = path.join(stubDirectory, "observed-pr-body.md");
  const control: DeliveryProviderControl = {
    phase: "ready",
    closingChanged: false,
    failMerge: false,
    mergedAt: fixtureInstant({ secondsAhead: 1 }),
    remoteBaseSha: prepared.baseSha,
    autoMergeMethod: "MERGE",
    providerDefaultBranch: "main",
    requestedAt: fixtureInstant(),
    existingPr: "none",
    ...initial,
  };
  fs.writeFileSync(controlFile, `${JSON.stringify(control)}\n`);
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const sha = ${JSON.stringify(prepared.headSha)};
const implementationSha = ${JSON.stringify(prepared.implementationCommitSha)};
const mergeSha = ${JSON.stringify("b".repeat(40))};
const prUrl = "https://github.com/o/r/pull/1";
const issueUrl = "https://github.com/o/r/issues/877";
const controlFile = ${JSON.stringify(controlFile)};
const logFile = ${JSON.stringify(logFile)};
const observedBody = ${JSON.stringify(observedBody)};
const canonicalBody = ${JSON.stringify(fs.readFileSync(prepared.bodyFile, "utf8").trimEnd())};
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
  return control.closingChanged ? canonical + "\\n\\nCloses #878" : canonical;
};
const observation = () => ({
  number: 1,
  url: prUrl,
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
    control.phase === "merge-requested"
      ? {
          enabledAt: control.requestedAt,
          mergeMethod: control.autoMergeMethod,
        }
      : null,
  author: { id: "pr-author" },
  isDraft: false,
  headRefName: "feature/x",
  baseRefName: "main",
  headRefOid: sha,
  baseRefOid: baseSha,
  mergeStateStatus: "CLEAN",
  reviewDecision: "APPROVED",
  statusCheckRollup: [],
  closingIssuesReferences: control.closingChanged
    ? [
        { number: 877, url: issueUrl },
        { number: 878, url: "https://github.com/o/r/issues/878" },
      ]
    : [{ number: 877, url: issueUrl }],
});

if (exact(["auth", "status"])) {
  process.exitCode = 0;
} else if (
  exact(["repo", "view", "o/r", "--json", "nameWithOwner,viewerPermission"])
) {
  process.stdout.write(
    JSON.stringify({ nameWithOwner: "o/r", viewerPermission: "WRITE" }),
  );
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
  process.stdout.write(sha + "\\n");
} else if (exact(["api", "repos/o/r/commits/main", "--jq", ".sha"])) {
  process.stdout.write(baseSha + "\\n");
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
  process.stdout.write(JSON.stringify(observation()));
} else if (args[0] === "pr" && args[1] === "list") {
  process.stdout.write(
    JSON.stringify(control.existingPr === "none" ? [] : [observation()]),
  );
} else if (args[0] === "api" && args[1] === "graphql") {
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
} else if (
  exact(["api", "repos/o/r/branches/main/protection"])
) {
  process.stdout.write("{}");
} else if (
  exact([
    "api",
    "--paginate",
    "--slurp",
    "repos/o/r/pulls/1/reviews?per_page=100",
  ])
) {
  process.stdout.write(
    JSON.stringify([[{
      id: 7,
      state: "APPROVED",
      commit_id: sha,
      user: { node_id: "independent-reviewer" },
      submitted_at: control.requestedAt,
    }]]),
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
        pull_requests: [{ number: 1 }],
      }],
    }]),
  );
} else if (exact(["api", "repos/o/r/commits/" + implementationSha])) {
  process.stdout.write(
    JSON.stringify({ sha: implementationSha, author: { node_id: "implementation-author" } }),
  );
} else if (exact(["api", "repos/o/r/commits/" + mergeSha])) {
  process.stdout.write(
    JSON.stringify({
      sha: mergeSha,
      commit: { tree: { sha: ${JSON.stringify("c".repeat(40))} } },
      parents: [{ sha: baseSha }, { sha }],
    }),
  );
} else if (args[0] === "pr" && args[1] === "merge" && args[2] === "1") {
  fs.writeFileSync(
    controlFile,
    JSON.stringify({ ...control, phase: "merge-requested", failMerge: false, requestedAt: new Date().toISOString() }) +
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
    env: {
      ...process.env,
      PATH: `${stubDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  };
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

function deliveryMergeArgs(
  prepared: PreparedDeliveryCli,
  overrides: { pr?: number; root?: string; staging?: string } = {},
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
    "--method=merge",
    `--root=${root}`,
    `--staging=${stagingArgument}`,
    "--apply",
  ];
}

function executeDeliveryMerge(
  prepared: PreparedDeliveryCli,
  overrides: { pr?: number; root?: string; staging?: string } = {},
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
    "number,url,body,headRefName,baseRefName,headRefOid,baseRefOid,closingIssuesReferences",
  ])
) {
  process.stdout.write(
    JSON.stringify({
      number: 1,
      url: prUrl,
      body: require("node:fs").readFileSync(observedBody, "utf8").trimEnd(),
      headRefName: "feature/x",
      baseRefName: "main",
      headRefOid: sha,
      baseRefOid: baseSha,
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
      const staging = createIssueStaging(root, {
        title: "poc-merge-test",
        answers: answers(),
        now: new Date(fixtureInstantMs()),
        requestedMode: "poc",
        poc: validPoc(),
      }).path;
      for (const step of [1, 4, 9, 10])
        appendWorkflowJournalEntry({
          staging,
          entry: entry(step, "poc", fixtureInstant({ hoursAgo: 1 })),
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
      const prepared = prepareDeliveryCli(this);
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
        /canonical Issue|closing|close/u,
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
      const prepared = prepareDeliveryCli(this);
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
        intentId: "8".repeat(32),
        preparedAt: bound.pr?.boundAt ?? fixtureInstant(),
      });
      writeDeliveryProviderControl(prepared, { phase: "queue-requested" });
      const before = deliveryProviderCalls(prepared);
      const observed = executeDeliveryMerge(prepared);
      assert.equal(observed.status, 0, observed.stdout + observed.stderr);
      const delta = deliveryProviderCalls(prepared).slice(before.length);
      assert.equal(delta.filter(isMergeCall).length, 0);
      assert.equal(
        delta.some((args) => args[0] === "api" && args[1] === "graphql"),
        true,
      );
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
      assert.equal(
        parseStepJournal(
          fs.readFileSync(
            path.join(prepared.staging, STEP_JOURNAL_FILE),
            "utf8",
          ),
        ).entries.some((entry) => entry.step === 11),
        false,
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
      const prepared = prepareDeliveryCli(this);
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
      const claimed = claimStoredMergeDispatch(
        prepared.staging,
        fixtureInstant({ minutesAhead: 1 }),
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
    default:
      throw new Error(`未対応のe2e scenarioです: ${scenarioId}`);
  }
  this.workflowCheckPassed = true;
});

Then("ワークフローStep公開CLI検査は期待結果になる", function () {
  assert.equal(this.workflowCheckPassed, true);
});
