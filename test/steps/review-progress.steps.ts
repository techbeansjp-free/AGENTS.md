import assert from "node:assert/strict";
import {
  buildReviewProgressInventory,
  makeReviewProgressEntry,
  makeReviewProgressSeal,
  parallelCriticalPath,
  parseReviewProgressRecords,
  projectReviewProgressTarget,
  PROGRESS_END,
  PROGRESS_START,
  renderReviewProgress,
  verifyReviewProgressTarget,
  type ReviewProgressInventory,
  type ReviewProgressRecord,
} from "../../src/domain/review-progress.js";
import { parseReviewRoundInput } from "../../src/domain/review-convergence.js";
import { COMMAND_USAGE } from "../../src/cli-usage.js";
import { stableJson } from "../../src/lib/security.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

interface ProgressWorld extends WorkflowWorld {
  source: string;
  inventory: ReviewProgressInventory;
  records: readonly ReviewProgressRecord[];
  passed: boolean;
}

const { Given, When, Then } = stepDefinitions<ProgressWorld>();
const sessionId = "a".repeat(64);
const head = "b".repeat(40);
const instant = "2026-09-12T00:00:00.000Z";

function expectFailure(action: () => unknown): void {
  assert.throws(action);
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

When("{string} のparallel progress反例を評価する", function (kind: string) {
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
    case "no-verdict":
      assert.doesNotMatch(
        renderReviewProgress([entry()]),
        /approved|passed|success/iu,
      );
      break;
    case "no-delivery":
      assert.doesNotMatch(stableJson(entry()), /merge|release|authority/iu);
      break;
    case "acyclic":
      assert.doesNotMatch(
        stableJson(entry()),
        /reviewVerdict|testResult|deliveryAuthority/u,
      );
      break;
    case "absent":
      expectFailure(() =>
        buildReviewProgressInventory("03_実装計画.md", "# no marker\n", 0o644),
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
    case "cli":
      assert.ok(
        COMMAND_USAGE.some(
          ({ command, subcommand }) =>
            command === "review" && subcommand === "progress",
        ),
      );
      break;
    case "critical-path":
      assert.ok(parallelCriticalPath(30, 15) <= 30 + 15);
      break;
    default:
      assert.fail(`unknown case: ${kind}`);
  }
  this.passed = true;
});

Then("parallel progress契約を満たす", function () {
  assert.equal(this.passed, true);
});
