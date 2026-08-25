import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import {
  MODE_STEP_SEQUENCES,
  NEVER_SKIPPABLE_STEPS,
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
} from "../../src/domain/mode.js";
import { stableJson } from "../../src/lib/security.js";
import {
  createIssueStaging,
  recordStagingSync,
} from "../../src/domain/issue.js";
import {
  appendWorkflowJournalEntry,
  STEP_JOURNAL_FILE,
} from "../../src/adapters/workflow-journal.js";
import { refreshStoredStagingDigest } from "../../src/domain/staging.js";
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
  overrideTimes: {
    instructedAt: string;
    expiresAt: string;
  };
}

function preparePullRequest(
  world: WorkflowStepWorld,
  missingStep4: boolean,
): PreparedPullRequest {
  const fixtureConstructedAt = Date.now();
  const fixturePast = new Date(
    fixtureConstructedAt - 60 * 60 * 1000,
  ).toISOString();
  const fixtureNow = new Date(fixtureConstructedAt).toISOString();
  const fixtureFuture = new Date(
    fixtureConstructedAt + 24 * 60 * 60 * 1000,
  ).toISOString();
  const root = world.initRepo();
  fs.mkdirSync(path.join(root, ".agent-skill-chain", "policy"), {
    recursive: true,
  });
  fs.copyFileSync(
    path.resolve(".agent-skill-chain/policy/default.json"),
    path.join(root, ".agent-skill-chain", "policy", "default.json"),
  );
  spawnSync("git", ["add", ".agent-skill-chain/policy/default.json"], {
    cwd: root,
  });
  spawnSync("git", ["commit", "-q", "-m", "trusted policy"], {
    cwd: root,
  });
  const headSha = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).stdout.trim();
  spawnSync("git", ["update-ref", "refs/remotes/origin/main", headSha], {
    cwd: root,
  });
  spawnSync(
    "git",
    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    { cwd: root },
  );
  const staging = createIssueStaging(root, {
    title: "workflow-test",
    answers: answers(),
    now: new Date(fixtureConstructedAt),
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
    tracker: "#877",
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
  return {
    root,
    staging,
    headSha,
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
    ],
  };
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
      const prepared = preparePullRequest(this, true);
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
      fs.writeFileSync(
        stub,
        `#!/usr/bin/env node
const args = process.argv.slice(2);
const sha = ${JSON.stringify(prepared.headSha)};
const prUrl = "https://github.com/o/r/pull/1";
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
  exact(["api", "repos/o/r/commits/feature%2Fx", "--jq", ".sha"]) ||
  exact(["api", "repos/o/r/commits/main", "--jq", ".sha"])
) {
  process.stdout.write(sha + "\\n");
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
    "Issue #877",
    "--body",
    "Closes #877",
  ])
) {
  process.stdout.write(prUrl + "\\n");
} else if (
  exact([
    "pr",
    "view",
    prUrl,
    "--repo",
    "o/r",
    "--json",
    "url,headRefName,baseRefName,headRefOid,baseRefOid",
  ])
) {
  process.stdout.write(
    JSON.stringify({
      url: prUrl,
      headRefName: "feature/x",
      baseRefName: "main",
      headRefOid: sha,
      baseRefOid: sha,
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
      const parsed = parseStepJournal(
        fs.readFileSync(path.join(prepared.staging, STEP_JOURNAL_FILE), "utf8"),
      );
      const overrideEntry = parsed.entries.find((item) => item.step === 4);
      assert.equal(
        overrideEntry?.humanOverride?.instructedBy,
        "repository-owner",
      );
      assert.match(overrideEntry?.humanOverride?.reason ?? "", /緊急修復/u);
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
