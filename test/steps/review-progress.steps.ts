import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  buildReviewProgressInventory,
  buildReviewProgressInventories,
  makeReviewProgressEntry,
  makeReviewProgressSeal,
  parallelCriticalPath,
  parseReviewProgressRecords,
  projectReviewProgressTarget,
  reviewProgressTargets,
  PROGRESS_END,
  PROGRESS_START,
  verifyReviewProgressTarget,
  type ReviewProgressInventory,
  type ReviewProgressRecord,
} from "../../src/domain/review-progress.js";
import {
  advanceReviewSession,
  parseReviewRoundInput,
  reviewSessionId,
  type ReviewSessionState,
} from "../../src/domain/review-convergence.js";
import { COMMAND_USAGE } from "../../src/cli-usage.js";
import { stableJson } from "../../src/lib/security.js";
import { checkParallelProgressSourceIsolation } from "../../scripts/check_conformance.js";
import {
  appendReviewProgress,
  projectReviewProgress,
} from "../../src/adapters/review-progress.js";
import {
  buildReviewRoundDraft,
  evidenceOnlySuffix,
  recordReviewRound,
} from "../../src/adapters/review-session.js";
import { recordLayerSuffix } from "../../src/adapters/review-record-layer.js";
import { main } from "../../src/cli.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { QUESTIONS, type ModeAnswer } from "../../src/domain/mode.js";
import {
  refreshStoredStagingDigest,
  REVIEW_PROGRESS_JOURNAL_FILE,
} from "../../src/domain/staging.js";
import { STEP_JOURNAL_FILE } from "../../src/domain/workflow.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

interface ProgressWorld extends WorkflowWorld {
  source: string;
  inventory: ReviewProgressInventory;
  records: readonly ReviewProgressRecord[];
  passed: boolean;
  root: string;
  staging: string;
  target: string;
  fixtureHead: string;
}

const { Given, When, Then } = stepDefinitions<ProgressWorld>();
const sessionId = "a".repeat(64);
const head = "b".repeat(40);
const instant = "2026-09-12T00:00:00.000Z";
const isolatedSources = {
  "src/domain/staging.ts":
    'export const REVIEW_PROGRESS_JOURNAL_FILE = "journal/review-progress.jsonl";',
  "src/adapters/review-progress.ts":
    'import { REVIEW_PROGRESS_JOURNAL_FILE } from "../domain/staging.js";',
  "src/adapters/review-record-layer.ts":
    'const journal = "journal/review-progress.jsonl";',
  "src/adapters/review-session.ts":
    'import { buildReviewProgressInventory } from "../domain/review-progress.js";',
  "src/domain/delivery.ts": "export const delivery = true;",
};

function expectFailure(action: () => unknown): void {
  assert.throws(action);
}

function fixtureAnswers(): Record<string, ModeAnswer> {
  return Object.fromEntries(
    QUESTIONS.map((id) => [id, { answer: true, evidence: `${id} fixture` }]),
  );
}

function gitHead(root: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

Given("parallel progressの純粋fixtureがある", function () {
  this.source = `# plan\n${PROGRESS_START}\n| T01 | old |\n${PROGRESS_END}\n# tail\n`;
  this.inventory = buildReviewProgressInventory(
    "03_実装計画.md",
    this.source,
    0o644,
  );
  this.records = [];
  this.passed = false;
});

Given("parallel progressの実adapter fixtureがある", function () {
  this.root = this.initRepo();
  const base = gitHead(this.root);
  fs.writeFileSync(
    path.join(this.root, "candidate.ts"),
    "export const x = 1;\n",
  );
  execFileSync("git", ["add", "candidate.ts"], { cwd: this.root });
  execFileSync("git", ["commit", "-q", "-m", "candidate"], {
    cwd: this.root,
  });
  this.fixtureHead = gitHead(this.root);
  this.staging = createIssueStaging(this.root, {
    title: "parallel-progress-adapter",
    answers: fixtureAnswers(),
    now: new Date(instant),
    requestedMode: "quick",
  }).path;
  this.source = `# 実装計画\n${PROGRESS_START}\n| タスク | 状態 |\n|---|---|\n| T01 | 未着手 |\n${PROGRESS_END}\n`;
  this.target = path.join(this.staging, "03_実装計画.md");
  fs.writeFileSync(this.target, this.source, { mode: 0o644 });
  fs.appendFileSync(
    path.join(this.staging, STEP_JOURNAL_FILE),
    `${JSON.stringify({
      step: 9,
      skillId: "step-09-implement",
      mode: "quick",
      recordedAt: instant,
      artifacts: ["candidate.ts"],
      evidence: `candidate HEAD ${this.fixtureHead}`,
      implementationHeadSha: this.fixtureHead,
    })}\n`,
  );
  refreshStoredStagingDigest(this.staging);
  const { round } = buildReviewRoundDraft({
    staging: this.staging,
    headSha: this.fixtureHead,
    baseSha: base,
    scopeIds: ["ISSUE-1336"],
    acceptanceCriteriaIds: ["AC-1336-01"],
  });
  recordReviewRound({ staging: this.staging, round });
  this.passed = false;
});

When("review入力を変えずcompleted進捗を実際にappendする", function () {
  const preview = appendReviewProgress({
    staging: this.staging,
    taskId: "T01",
    state: "completed",
    recordedAt: instant,
    expectedDigest: null,
    apply: false,
  });
  assert.equal(preview.applied, false);
  const applied = appendReviewProgress({
    staging: this.staging,
    taskId: "T01",
    state: "completed",
    recordedAt: instant,
    expectedDigest: null,
    apply: true,
  });
  assert.equal(applied.applied, true);
  assert.equal(fs.readFileSync(this.target, "utf8"), this.source);
  assert.equal(
    fs.statSync(path.join(this.staging, REVIEW_PROGRESS_JOURNAL_FILE)).mode &
      0o777,
    0o600,
  );
  const projection = projectReviewProgress({
    staging: this.staging,
    apply: false,
  });
  assert.match(projection.projected, /\| T01 \| completed \|/u);
  assert.equal(fs.readFileSync(this.target, "utf8"), this.source);
  this.passed = true;
});

When(
  "{string} のparallel progress反例を評価する",
  async function (kind: string) {
    const entry = () =>
      makeReviewProgressEntry({
        previous: this.records,
        sessionId,
        implementationHeadSha: head,
        taskId: "T01",
        state: "completed",
        recordedAt: instant,
      });
    switch (kind) {
      case "append": {
        const next = entry();
        assert.equal(next.previousDigest, null);
        assert.equal(next.sequence, 1);
        break;
      }
      case "digest-chain": {
        const next = entry();
        const line = `${stableJson({ ...next, entryDigest: "f".repeat(64) })}\n`;
        expectFailure(() => parseReviewProgressRecords(line));
        break;
      }
      case "binding":
        expectFailure(() =>
          makeReviewProgressEntry({
            previous: [],
            sessionId: "bad",
            implementationHeadSha: head,
            taskId: "T01",
            state: "completed",
            recordedAt: instant,
          }),
        );
        break;
      case "projection": {
        const projected = projectReviewProgressTarget({
          inventory: this.inventory,
          source: this.source,
          records: [entry()],
        });
        assert.match(projected, /\| T01 \| completed \|/u);
        break;
      }
      case "multiple-targets": {
        const readme = this.source.replace("# plan", "# task README");
        const inventory = buildReviewProgressInventories([
          {
            targetPath: "03_実装計画.md",
            source: this.source,
            fileMode: 0o644,
          },
          {
            targetPath: "tasks/README.md",
            source: readme,
            fileMode: 0o644,
          },
        ]);
        const targets = reviewProgressTargets(inventory);
        assert.deepEqual(
          targets.map(({ targetPath }) => targetPath),
          ["03_実装計画.md", "tasks/README.md"],
        );
        for (const target of targets) {
          const projected = projectReviewProgressTarget({
            inventory: target,
            source:
              target.targetPath === "03_実装計画.md" ? this.source : readme,
            records: [entry()],
          });
          assert.match(projected, /\| T01 \| completed \|/u);
        }
        const parsed = parseReviewRoundInput({
          round: 1,
          previousRoundDigest: null,
          anchor: {
            scopeIds: ["ISSUE-1418"],
            acceptanceCriteriaIds: ["AC-1418-01"],
            invariantIds: [],
            diffBaseSha: head,
            initialHeadSha: head,
            initialDiffDigest: "c".repeat(64),
            progressInventory: inventory,
          },
          candidateHeadSha: head,
          focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
          findings: [],
        });
        assert.equal(
          reviewProgressTargets(parsed.anchor.progressInventory!).length,
          2,
        );
        break;
      }
      case "record-layer": {
        const root = this.initRepo();
        const staging = path.join(root, "tasks/1418");
        const targetPath = "README.md";
        const repositoryTarget = "tasks/1418/README.md";
        fs.mkdirSync(staging, { recursive: true });
        fs.writeFileSync(path.join(staging, targetPath), this.source);
        execFileSync("git", ["add", repositoryTarget], { cwd: root });
        execFileSync("git", ["commit", "-q", "-m", "docs: baseline task"], {
          cwd: root,
        });
        const implementationHeadSha = gitHead(root);
        const progressInventory = buildReviewProgressInventory(
          targetPath,
          this.source,
          0o644,
        );
        const anchor = {
          scopeIds: ["ISSUE-1418"],
          acceptanceCriteriaIds: ["AC-1418-02"],
          invariantIds: ["INV-01"],
          diffBaseSha: implementationHeadSha,
          initialHeadSha: implementationHeadSha,
          initialDiffDigest: "c".repeat(64),
          progressInventory,
        };
        const boundSessionId = reviewSessionId(anchor);
        const progressEntry = makeReviewProgressEntry({
          previous: [],
          sessionId: boundSessionId,
          implementationHeadSha,
          taskId: "T01",
          state: "completed",
          recordedAt: instant,
        });
        const progressSeal = makeReviewProgressSeal({
          previous: [progressEntry],
          sessionId: boundSessionId,
          implementationHeadSha,
          sealedAt: instant,
        });
        fs.mkdirSync(path.join(staging, "journal"), { recursive: true });
        fs.writeFileSync(
          path.join(staging, "journal/review-progress.jsonl"),
          `${stableJson(progressEntry)}\n${stableJson(progressSeal)}\n`,
        );
        const projected = projectReviewProgressTarget({
          inventory: progressInventory,
          source: this.source,
          records: [progressEntry, progressSeal],
        });
        fs.writeFileSync(path.join(staging, targetPath), projected);
        fs.mkdirSync(path.join(root, "docs/reviews"), { recursive: true });
        fs.writeFileSync(path.join(root, "docs/reviews/1418.md"), "# review\n");
        execFileSync("git", ["add", repositoryTarget, "docs/reviews/1418.md"], {
          cwd: root,
        });
        execFileSync("git", ["commit", "-q", "-m", "docs: record layer"], {
          cwd: root,
        });
        const finalHead = gitHead(root);
        const session = {
          schemaVersion: "agent-skill-chain/review-session/v1",
          sessionId: boundSessionId,
          anchor,
          rounds: [],
          latestRoundDigest: "d".repeat(64),
          latestCandidateHeadSha: implementationHeadSha,
          status: "converged",
        } as unknown as ReviewSessionState;
        assert.deepEqual(
          recordLayerSuffix(
            staging,
            root,
            implementationHeadSha,
            finalHead,
            session,
          ),
          ["docs/reviews/1418.md", repositoryTarget],
        );
        const roundOne = advanceReviewSession(
          null,
          parseReviewRoundInput({
            round: 1,
            previousRoundDigest: null,
            anchor,
            candidateHeadSha: implementationHeadSha,
            focus: {
              previousBlocking: [],
              fixedDiff: [],
              adjacentScope: [],
            },
            findings: [],
          }),
        );
        const recordLayerSession = advanceReviewSession(
          roundOne,
          parseReviewRoundInput({
            round: 2,
            previousRoundDigest: roundOne.latestRoundDigest,
            anchor,
            candidateHeadSha: finalHead,
            focus: {
              previousBlocking: [],
              fixedDiff: ["docs/reviews/1418.md", repositoryTarget],
              adjacentScope: [],
            },
            findings: [],
            recordLayerOnly: true,
          }),
        );
        assert.equal(
          recordLayerSession.latestCandidateHeadSha,
          implementationHeadSha,
        );
        fs.appendFileSync(path.join(staging, targetPath), "manual edit\n");
        execFileSync("git", ["add", repositoryTarget], { cwd: root });
        execFileSync("git", ["commit", "-q", "--amend", "--no-edit"], {
          cwd: root,
        });
        assert.equal(
          recordLayerSuffix(
            staging,
            root,
            implementationHeadSha,
            gitHead(root),
            session,
          ),
          undefined,
        );
        fs.writeFileSync(path.join(staging, targetPath), projected);
        fs.writeFileSync(path.join(root, "unexpected.txt"), "unexpected\n");
        execFileSync("git", ["add", repositoryTarget, "unexpected.txt"], {
          cwd: root,
        });
        execFileSync("git", ["commit", "-q", "--amend", "--no-edit"], {
          cwd: root,
        });
        assert.equal(
          recordLayerSuffix(
            staging,
            root,
            implementationHeadSha,
            gitHead(root),
            session,
          ),
          undefined,
        );
        fs.writeFileSync(path.join(staging, targetPath), projected);
        execFileSync("git", ["rm", "-q", "unexpected.txt"], { cwd: root });
        execFileSync("git", ["mv", repositoryTarget, "tasks/1418/RENAMED.md"], {
          cwd: root,
        });
        execFileSync("git", ["commit", "-q", "--amend", "--no-edit"], {
          cwd: root,
        });
        assert.equal(
          recordLayerSuffix(
            staging,
            root,
            implementationHeadSha,
            gitHead(root),
            session,
          ),
          undefined,
        );
        break;
      }
      case "legacy-record-layer": {
        assert.equal(this.inventory.schemaVersion, undefined);
        assert.equal(this.inventory.targets, undefined);
        const root = this.initRepo();
        const implementationHeadSha = gitHead(root);
        fs.mkdirSync(path.join(root, "docs/reviews"), { recursive: true });
        fs.writeFileSync(path.join(root, "docs/reviews/1418.md"), "# review\n");
        execFileSync("git", ["add", "docs/reviews/1418.md"], { cwd: root });
        execFileSync("git", ["commit", "-q", "-m", "docs: review"], {
          cwd: root,
        });
        assert.equal(
          evidenceOnlySuffix(root, implementationHeadSha, gitHead(root)),
          "docs/reviews/1418.md",
        );
        break;
      }
      case "prefix":
        expectFailure(() =>
          verifyReviewProgressTarget({
            inventory: this.inventory,
            source: `changed${this.source}`,
            records: [],
          }),
        );
        break;
      case "suffix":
        expectFailure(() =>
          verifyReviewProgressTarget({
            inventory: this.inventory,
            source: `${this.source}changed`,
            records: [],
          }),
        );
        break;
      case "one-byte": {
        const projected = projectReviewProgressTarget({
          inventory: this.inventory,
          source: this.source,
          records: [entry()],
        });
        expectFailure(() =>
          verifyReviewProgressTarget({
            inventory: this.inventory,
            source: projected.replace("completed", "completeD"),
            records: [entry()],
          }),
        );
        break;
      }
      case "mode":
        expectFailure(() =>
          buildReviewProgressInventory("03_実装計画.md", this.source, 0o755),
        );
        break;
      case "traversal":
        expectFailure(() =>
          buildReviewProgressInventory("../03_実装計画.md", this.source, 0o644),
        );
        break;
      case "unicode":
        expectFailure(() =>
          makeReviewProgressEntry({
            previous: [],
            sessionId,
            implementationHeadSha: head,
            taskId: "T\u0001",
            state: "completed",
            recordedAt: instant,
          }),
        );
        break;
      case "stale": {
        const first = entry();
        const second = makeReviewProgressEntry({
          previous: [first],
          sessionId,
          implementationHeadSha: head,
          taskId: "T02",
          state: "started",
          recordedAt: instant,
        });
        assert.equal(second.previousDigest, first.entryDigest);
        break;
      }
      case "partial":
        expectFailure(() => parseReviewProgressRecords('{"schemaVersion":'));
        break;
      case "sealed": {
        const first = entry();
        const seal = makeReviewProgressSeal({
          previous: [first],
          sessionId,
          implementationHeadSha: head,
          sealedAt: instant,
        });
        expectFailure(() =>
          makeReviewProgressEntry({
            previous: [first, seal],
            sessionId,
            implementationHeadSha: head,
            taskId: "T02",
            state: "started",
            recordedAt: instant,
          }),
        );
        break;
      }
      case "limit":
        expectFailure(() => parseReviewProgressRecords("{}\n".repeat(258)));
        break;
      case "no-verdict": {
        const errors = checkParallelProgressSourceIsolation({
          ...isolatedSources,
          "src/adapters/review-session.ts":
            'const x = parseReviewProgressRecords("{}");',
        });
        assert.ok(errors.some((error) => error.includes("review gate")));
        break;
      }
      case "no-delivery": {
        const errors = checkParallelProgressSourceIsolation({
          ...isolatedSources,
          "src/domain/delivery.ts":
            'import { renderReviewProgress } from "./review-progress.js";',
        });
        assert.ok(errors.some((error) => error.includes("delivery")));
        break;
      }
      case "acyclic": {
        assert.deepEqual(
          checkParallelProgressSourceIsolation(isolatedSources),
          [],
        );
        const errors = checkParallelProgressSourceIsolation({
          ...isolatedSources,
          "src/adapters/review-progress.ts":
            "refreshStoredStagingDigest(staging); writeFileAtomic(observed.target, body);",
        });
        assert.ok(errors.some((error) => error.includes("review入力tree")));
        break;
      }
      case "absent":
        expectFailure(() =>
          buildReviewProgressInventory(
            "03_実装計画.md",
            "# no marker\n",
            0o644,
          ),
        );
        break;
      case "legacy": {
        const round = parseReviewRoundInput({
          round: 1,
          previousRoundDigest: null,
          anchor: {
            scopeIds: ["ISSUE-1336"],
            acceptanceCriteriaIds: ["AC-1336-01"],
            invariantIds: [],
            diffBaseSha: head,
            initialHeadSha: head,
            initialDiffDigest: "c".repeat(64),
          },
          candidateHeadSha: head,
          focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
          findings: [],
        });
        assert.equal(round.anchor.progressInventory, undefined);
        break;
      }
      case "cli": {
        let output = "";
        const write = process.stdout.write;
        process.stdout.write = ((chunk: string | Uint8Array) => {
          output += String(chunk);
          return true;
        }) as typeof process.stdout.write;
        try {
          assert.equal(await main(["review", "progress", "--help"]), 0);
        } finally {
          process.stdout.write = write;
        }
        assert.match(output, /"command": "review progress"/u);
        assert.ok(
          COMMAND_USAGE.some(
            ({ command, subcommand }) =>
              command === "review" && subcommand === "progress",
          ),
        );
        break;
      }
      case "critical-path":
        assert.ok(parallelCriticalPath(30, 15) <= 30 + 15);
        break;
      default:
        assert.fail(`unknown case: ${kind}`);
    }
    this.passed = true;
  },
);

Then("parallel progress契約を満たす", function () {
  assert.equal(this.passed, true);
});
