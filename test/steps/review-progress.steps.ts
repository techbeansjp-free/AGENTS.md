import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  buildReviewProgressInventory,
  makeReviewProgressEntry,
  makeReviewProgressSeal,
  parallelCriticalPath,
  parseReviewProgressRecords,
  projectReviewProgressTarget,
  PROGRESS_END,
  PROGRESS_START,
  verifyReviewProgressTarget,
  type ReviewProgressInventory,
  type ReviewProgressRecord,
} from "../../src/domain/review-progress.js";
import { parseReviewRoundInput } from "../../src/domain/review-convergence.js";
import { COMMAND_USAGE } from "../../src/cli-usage.js";
import { stableJson } from "../../src/lib/security.js";
import { checkParallelProgressSourceIsolation } from "../../scripts/check_conformance.js";
import {
  appendReviewProgress,
  projectReviewProgress,
} from "../../src/adapters/review-progress.js";
import {
  buildReviewRoundDraft,
  recordReviewRound,
} from "../../src/adapters/review-session.js";
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
