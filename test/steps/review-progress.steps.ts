import assert from "node:assert/strict";
import { appendLegacyJournal } from "../support/legacy-journal.js";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildReviewProgressInventory,
  buildReviewProgressInventories,
  describeReviewProgressUnbuildable,
  tryBuildReviewProgressInventory,
  REVIEW_PROGRESS_UNBUILDABLE_REASONS,
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
  recordReviewRound,
} from "../../src/adapters/review-session.js";
import { evidenceOnlySuffix } from "../../src/adapters/review-diff.js";
import { recordLayerSuffix } from "../../src/adapters/review-record-layer.js";
import { main } from "../../src/cli.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { promoteWorkflowStagingToFull } from "../../src/adapters/workflow-journal.js";
import { QUESTIONS, type ModeAnswer } from "../../src/domain/mode.js";
import {
  refreshStoredStagingDigest,
  REVIEW_PROGRESS_JOURNAL_FILE,
} from "../../src/domain/staging.js";
import { STEP_JOURNAL_FILE } from "../../src/domain/workflow.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";
import { After as cucumberAfter } from "@cucumber/cucumber";

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
  fs.writeFileSync(
    path.join(this.staging, "README.md"),
    `# task\n${PROGRESS_START}\n| T02 | 未着手 |\n${PROGRESS_END}\n`,
    { mode: 0o644 },
  );
  appendLegacyJournal(
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
    progressTargetPaths: ["03_実装計画.md", "README.md"],
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
  assert.throws(
    () =>
      appendReviewProgress({
        staging: this.staging,
        taskId: "T99",
        state: "completed",
        recordedAt: instant,
        expectedDigest: applied.journalDigest,
        apply: false,
      }),
    /03_実装計画\.md、README\.md/u,
  );
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
        const foreignEntry = makeReviewProgressEntry({
          previous: [],
          sessionId: "f".repeat(64),
          implementationHeadSha,
          taskId: "T01",
          state: "completed",
          recordedAt: instant,
        });
        const mixedSeal = makeReviewProgressSeal({
          previous: [foreignEntry],
          sessionId: boundSessionId,
          implementationHeadSha,
          sealedAt: instant,
        });
        fs.writeFileSync(
          path.join(staging, "journal/review-progress.jsonl"),
          `${stableJson(foreignEntry)}\n${stableJson(mixedSeal)}\n`,
        );
        assert.equal(
          recordLayerSuffix(
            staging,
            root,
            implementationHeadSha,
            finalHead,
            session,
          ),
          undefined,
        );
        fs.writeFileSync(
          path.join(staging, "journal/review-progress.jsonl"),
          `${stableJson(progressEntry)}\n${stableJson(progressSeal)}\n`,
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
        const unsafeHead = gitHead(root);
        execFileSync("git", ["replace", unsafeHead, finalHead], { cwd: root });
        assert.equal(
          recordLayerSuffix(
            staging,
            root,
            implementationHeadSha,
            unsafeHead,
            session,
          ),
          undefined,
        );
        execFileSync("git", ["replace", "-d", unsafeHead], { cwd: root });
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
      case "mode-mismatch": {
        /** 成立するのは通常fileの0644ちょうどだけで、他は分類済み不成立になる。 */
        const classify = (mode: number, isSymbolicLink: boolean) => {
          const outcome = tryBuildReviewProgressInventory(
            "03_実装計画.md",
            this.source,
            { fileMode: mode, isSymbolicLink, isRegularFile: !isSymbolicLink },
          );
          return outcome.state === "built" ? "built" : outcome.reason;
        };
        assert.equal(classify(0o644, false), "built");
        assert.equal(classify(0o664, false), "mode-mismatch");
        assert.equal(classify(0o600, false), "mode-mismatch");
        assert.equal(classify(0o755, false), "mode-mismatch");
        assert.equal(classify(0o777, true), "not-regular-file");
        /** **symlinkはmodeが0644でもnot-regular-fileへ落とす。** */
        assert.equal(classify(0o644, true), "not-regular-file");
        /** 実測modeを案内へそのまま運ぶ。桁を崩さない。 */
        const guidance = describeReviewProgressUnbuildable({
          reason: "mode-mismatch",
          observedMode: 0o664,
          isSymbolicLink: false,
          isRegularFile: true,
          targetPath: "03_実装計画.md",
        });
        assert.equal(guidance.observed, "100664");
        assert.equal(guidance.expected, "100644");
        assert.equal(
          describeReviewProgressUnbuildable({
            reason: "mode-mismatch",
            observedMode: 0o600,
            isSymbolicLink: false,
            isRegularFile: true,
            targetPath: "03_実装計画.md",
          }).observed,
          "100600",
        );
        /**
         * **3桁未満のmodeで桁が崩れないことを固定する**（F-09）。
         * `umask 0733`のような環境では`0o044`が観測されうる。3桁paddingと
         * `& 0o777`のどちらを落としても、ここが落ちる。
         */
        assert.equal(
          describeReviewProgressUnbuildable({
            reason: "mode-mismatch",
            observedMode: 0o044,
            isSymbolicLink: false,
            isRegularFile: true,
            targetPath: "03_実装計画.md",
          }).observed,
          "100044",
        );
        assert.equal(
          describeReviewProgressUnbuildable({
            reason: "mode-mismatch",
            observedMode: 0o100644,
            isSymbolicLink: false,
            isRegularFile: true,
            targetPath: "03_実装計画.md",
          }).observed,
          "100644",
        );
        assert.deepEqual(guidance.repairArgv, [
          "chmod",
          "0644",
          "03_実装計画.md",
        ]);
        assert.equal(
          guidance.code,
          "ASC-REVIEW-PROGRESS-INVENTORY-UNBUILDABLE",
        );
        assert.ok(guidance.requiredAuthority.length > 0);
        assert.ok(guidance.rollback.length > 0);
        assert.ok(guidance.effect.includes("review"));
        break;
      }
      case "symlink-target": {
        /** symlinkへchmodを案内するとlink先を書き換えるため、案内に出さない。 */
        const guidance = describeReviewProgressUnbuildable({
          reason: "not-regular-file",
          observedMode: 0o777,
          isSymbolicLink: true,
          isRegularFile: false,
          targetPath: "03_実装計画.md",
        });
        assert.equal(guidance.reason, "not-regular-file");
        assert.equal(guidance.repairArgv, null);
        assert.ok(!guidance.action.includes("chmod 0644"));
        assert.ok(guidance.action.includes("symlink"));
        assert.ok(guidance.observed.includes("symlink"));
        break;
      }
      case "diagnostic-scope": {
        /** 案内は相対nameとcommand名だけを出す。絶対path・環境変数・tokenを出さない。 */
        for (const reason of REVIEW_PROGRESS_UNBUILDABLE_REASONS) {
          const guidance = describeReviewProgressUnbuildable({
            reason,
            observedMode: 0o664,
            isSymbolicLink: reason === "not-regular-file",
            isRegularFile: reason !== "not-regular-file",
            targetPath: "03_実装計画.md",
          });
          const rendered = [
            guidance.target,
            guidance.action,
            guidance.effect,
            guidance.requiredAuthority,
            guidance.rollback,
            ...(guidance.repairArgv ?? []),
          ].join(" ");
          assert.ok(!rendered.includes("/home/"), reason);
          assert.ok(!rendered.includes(process.cwd()), reason);
          assert.ok(!/\$[A-Z_]{3,}/u.test(rendered), reason);
          assert.ok(!/gh[pousr]_[A-Za-z0-9]{10,}/u.test(rendered), reason);
          assert.equal(guidance.target, "03_実装計画.md");
        }
        break;
      }
      case "authority-per-reason": {
        /**
         * **必要authorityを分類ごとに分ける。** mode変更権限で全分類を代表
         * させると、marker是正やtask ID追加やfile置換に必要な権限を誤って
         * 案内することになり、行動可能にならない。
         */
        const authority = (
          reason: (typeof REVIEW_PROGRESS_UNBUILDABLE_REASONS)[number],
        ) =>
          describeReviewProgressUnbuildable({
            reason,
            observedMode: 0o664,
            isSymbolicLink: reason === "not-regular-file",
            isRegularFile: reason !== "not-regular-file",
            targetPath: "03_実装計画.md",
          }).requiredAuthority;
        assert.equal(authority("mode-mismatch"), "対象fileのmode変更権限");
        assert.notEqual(
          authority("not-regular-file"),
          authority("mode-mismatch"),
        );
        assert.notEqual(
          authority("marker-not-single-pair"),
          authority("mode-mismatch"),
        );
        assert.equal(
          authority("marker-not-single-pair"),
          authority("no-task-id"),
        );
        for (const reason of REVIEW_PROGRESS_UNBUILDABLE_REASONS)
          assert.ok(authority(reason).length > 0, reason);
        break;
      }
      case "inventory-unbuildable": {
        /** marker不正とtask ID 0件も同じ分類機構で扱い、成立入力だけがbuiltになる。 */
        const at = (source: string) =>
          tryBuildReviewProgressInventory("03_実装計画.md", source, {
            fileMode: 0o644,
            isSymbolicLink: false,
            isRegularFile: true,
          });
        assert.equal(at(this.source).state, "built");
        assert.equal(
          (at(`${this.source}${this.source}`) as { reason: string }).reason,
          "marker-not-single-pair",
        );
        assert.equal(
          (at("# plan\n") as { reason: string }).reason,
          "marker-not-single-pair",
        );
        assert.equal(
          (
            at(
              `# plan\n${PROGRESS_START}\n| lower | x |\n${PROGRESS_END}\n`,
            ) as { reason: string }
          ).reason,
          "no-task-id",
        );
        /** targetPath契約違反だけは値へ落とさず例外のまま残す。 */
        expectFailure(() =>
          tryBuildReviewProgressInventory("../03_実装計画.md", this.source, {
            fileMode: 0o644,
            isSymbolicLink: false,
            isRegularFile: true,
          }),
        );
        break;
      }
      default:
        assert.fail(`unknown case: ${kind}`);
    }
    this.passed = true;
  },
);

Then("parallel progress契約を満たす", function () {
  assert.equal(this.passed, true);
});

/**
 * Issue #1408。progress inventoryを構築できない入力でreview本線が止まらないことと、
 * `issue create`の生成modeが実行環境のumaskから独立することを、実経路で観測する。
 */
interface NonblockingWorld extends ProgressWorld {
  draft: ReturnType<typeof buildReviewRoundDraft>;
  builtDraft: ReturnType<typeof buildReviewRoundDraft>;
  generatedStaging: string;
  initFailure: unknown;
  pendingUmask: number;
  cliExitCode: number;
  cliOutput: string;
  baseShaForFailure: string;
  templateRestore?: Array<[string, number]>;
  unbuildableCases: Array<{
    reason: string;
    options: { mode: number; symlink?: boolean; source?: string };
  }>;
  unbuildableDrafts: Array<{
    reason: string;
    draft: ReturnType<typeof buildReviewRoundDraft>;
  }>;
}

const nb = stepDefinitions<NonblockingWorld>();

/**
 * F-07。**製品repositoryのtemplate modeを必ず戻す。**
 * `issueTemplateRoot`を注入できないため隔離できず、Givenの途中で失敗すると
 * 0664が残る。gitは0644と0664の差を追跡しないので`git status`もCIのclean検査も
 * 検出しない。Whenの`finally`だけに頼らずAfterでも復元する。
 */
const templateModeRestore: Array<[string, number]> = [];
cucumberAfter(function () {
  /**
   * **復元失敗を握り潰さない。** 失敗したまま通すと追跡済みtemplateが0664で
   * 残り、後続scenarioと開発環境を汚染する。gitは0644と0664の差を追跡しない
   * ので`git status`もCIのclean検査も検出しない。ここで落とすのが唯一の signal。
   */
  const failures: string[] = [];
  while (templateModeRestore.length > 0) {
    const entry = templateModeRestore.pop();
    if (!entry) break;
    try {
      fs.chmodSync(entry[0], entry[1]);
    } catch (error) {
      failures.push(`${entry[0]}: ${String(error)}`);
    }
  }
  if (failures.length > 0)
    throw new Error(
      `templateのmode復元に失敗しました。追跡済みfileが変更されたまま残っています: ${failures.join("; ")}`,
    );
});

/** 実装HEAD bindingを持つreview前stagingを作る。03のmodeだけを引数で変える。 */
function nonblockingStaging(
  world: NonblockingWorld,
  options: { mode: number; symlink?: boolean; source?: string },
): { baseSha: string } {
  world.root = world.initRepo();
  const baseSha = gitHead(world.root);
  fs.writeFileSync(
    path.join(world.root, "candidate.ts"),
    "export const x = 1;\n",
  );
  execFileSync("git", ["add", "candidate.ts"], { cwd: world.root });
  execFileSync("git", ["commit", "-q", "-m", "candidate"], { cwd: world.root });
  world.fixtureHead = gitHead(world.root);
  world.staging = createIssueStaging(world.root, {
    title: "progress-nonblocking",
    answers: fixtureAnswers(),
    now: new Date(instant),
    requestedMode: "quick",
  }).path;
  world.source =
    options.source ??
    `# 実装計画\n${PROGRESS_START}\n| タスク | 状態 |\n|---|---|\n| T01 | 未着手 |\n${PROGRESS_END}\n`;
  world.target = path.join(world.staging, "03_実装計画.md");
  if (options.symlink) {
    const real = path.join(world.staging, "real-plan.md");
    fs.writeFileSync(real, world.source);
    fs.chmodSync(real, 0o644);
    fs.symlinkSync(real, world.target);
  } else {
    fs.writeFileSync(world.target, world.source);
    /** **umaskから独立させるためchmodで固定する。** writeFileSyncのmodeはmaskされる。 */
    fs.chmodSync(world.target, options.mode);
  }
  appendLegacyJournal(
    path.join(world.staging, STEP_JOURNAL_FILE),
    `${JSON.stringify({
      step: 9,
      skillId: "step-09-implement",
      mode: "quick",
      recordedAt: instant,
      artifacts: ["candidate.ts"],
      evidence: `candidate HEAD ${world.fixtureHead}`,
      implementationHeadSha: world.fixtureHead,
    })}\n`,
  );
  refreshStoredStagingDigest(world.staging);
  return { baseSha };
}

function initDraft(world: NonblockingWorld, baseSha: string) {
  return buildReviewRoundDraft({
    staging: world.staging,
    headSha: world.fixtureHead,
    baseSha,
    scopeIds: ["SCOPE-1408"],
    acceptanceCriteriaIds: ["AC-1408-01"],
  });
}

/**
 * SCN-INT-PROGRESS-040。**複数targetでも非停止化を保つ**（REQ-WF-021）。
 *
 * 03は正しく、`tasks/README.md`だけmodeを外す。all-or-nothingなので
 * inventoryは付かず、案内は不成立になった側のstaging相対nameを示す。
 */
nb.Given(
  "2件のprogress targetのうち1件がmode不一致のstagingがある",
  function () {
    const { baseSha } = nonblockingStaging(this, { mode: 0o644 });
    const second = path.join(this.staging, "tasks", "README.md");
    fs.mkdirSync(path.dirname(second), { recursive: true });
    fs.writeFileSync(second, this.source.replace("# 実装計画", "# task"));
    fs.chmodSync(second, 0o664);
    this.draft = buildReviewRoundDraft({
      staging: this.staging,
      headSha: this.fixtureHead,
      baseSha,
      scopeIds: ["SCOPE-1408"],
      acceptanceCriteriaIds: ["AC-1408-01"],
      progressTargetPaths: ["03_実装計画.md", "tasks/README.md"],
    });
  },
);

nb.Then("inventoryを付けずroundを開き不成立targetを名指しする", function () {
  /** **roundは開く。** 例外で止まるとREQ-WF-021の明文違反へ戻る。 */
  assert.equal(this.draft.round.anchor.progressInventory, undefined);
  const note = this.draft.notes.find((entry) =>
    entry.includes("ASC-REVIEW-PROGRESS-INVENTORY-UNBUILDABLE"),
  );
  assert.ok(note, "複数targetの不成立に案内がありません");
  /**
   * **不成立になった側を名指しする。** 先頭targetの名で案内すると、
   * 利用者は正しい03をchmodし直して直らない原因を探すことになる。
   */
  assert.ok(note.includes("tasks/README.md"), note);
  assert.ok(!note.includes("03_実装計画.mdのparallel"), note);
  assert.ok(note.includes("mode-mismatch"), note);
  assert.ok(note.includes("実測=100664"), note);
});

nb.Given("mode 0664の03を持つreview前stagingがある", function () {
  const { baseSha } = nonblockingStaging(this, { mode: 0o664 });
  this.draft = initDraft(this, baseSha);
});

nb.Given("mode 0644の03を持つreview前stagingがある", function () {
  const { baseSha } = nonblockingStaging(this, { mode: 0o644 });
  this.draft = initDraft(this, baseSha);
});

nb.Given(
  "progress inventoryの構築が分類外の失敗をするstagingがある",
  function () {
    const { baseSha } = nonblockingStaging(this, { mode: 0o644 });
    /**
     * **読み取り失敗を注入する。** directoryは`not-regular-file`として分類
     * されるようになったので分類外にならない。通常fileのまま読めなくする。
     */
    assert.notEqual(process.getuid?.(), 0, "この反例は非rootでのみ成立します");
    fs.chmodSync(this.target, 0o000);
    this.initFailure = undefined;
    try {
      initDraft(this, baseSha);
    } catch (error) {
      this.initFailure = error;
    }
    fs.chmodSync(this.target, 0o644);
  },
);

nb.When("review round --initを実行する", function () {
  assert.ok(this.draft !== undefined || this.initFailure !== undefined);
});

nb.Then("roundが開きanchorにprogress inventoryが無い", function () {
  assert.equal(this.draft.round.round, 1);
  assert.equal(this.draft.round.anchor.progressInventory, undefined);
  /** 案内がnotesへ出ており、行動可能な語を含む。 */
  const note = this.draft.notes.find((entry) =>
    entry.includes("ASC-REVIEW-PROGRESS-INVENTORY-UNBUILDABLE"),
  );
  assert.ok(note, "不成立の案内がnotesにありません");
  assert.ok(note.includes("100664"));
  assert.ok(note.includes("100644"));
  assert.ok(note.includes("chmod 0644 03_実装計画.md"));
  assert.ok(!note.includes("/home/"));
});

nb.Then(
  "round recordの差はprogress inventory keyの有無だけである",
  function () {
    /**
     * **同一repo・同一stagingで比較する。** 別repoを作り直すとcommit SHAが
     * 実時計に依存し（fixtureは`GIT_AUTHOR_DATE`を固定していない）、
     * `diffBaseSha`・`initialHeadSha`・`candidateHeadSha`が秒境界を跨いだ
     * ときだけ食い違ってCIが確率的に赤くなる。
     */
    const baseSha = execFileSync("git", ["rev-parse", "HEAD~1"], {
      cwd: this.root,
      encoding: "utf8",
    }).trim();
    fs.chmodSync(this.target, 0o644);
    const builtDraft = initDraft(this, baseSha);
    fs.chmodSync(this.target, 0o664);
    const strip = (round: Record<string, unknown>) => {
      const anchor = { ...(round.anchor as Record<string, unknown>) };
      delete anchor.progressInventory;
      return stableJson({ ...round, anchor });
    };
    assert.ok(builtDraft.round.anchor.progressInventory !== undefined);
    assert.equal(
      strip(this.draft.round as unknown as Record<string, unknown>),
      strip(builtDraft.round as unknown as Record<string, unknown>),
    );
  },
);

nb.Then("review round --initは従来どおり拒否する", function () {
  /** **任意のErrorで通さない。** 無関係な早期例外でもgreenになる。 */
  assert.ok(
    this.initFailure instanceof Error,
    "分類外の失敗が伝播していません",
  );
  assert.equal(
    (this.initFailure as NodeJS.ErrnoException).code,
    "EACCES",
    `分類外のI/O失敗が伝播していません: ${String(this.initFailure)}`,
  );
});

nb.Given("progress inventoryが不成立のreview sessionがある", function () {
  const { baseSha } = nonblockingStaging(this, { mode: 0o664 });
  this.draft = initDraft(this, baseSha);
  recordReviewRound({ staging: this.staging, round: this.draft.round });
});

nb.Then("review progressは従来の直列経路を案内して拒否する", function () {
  assert.throws(
    () =>
      appendReviewProgress({
        staging: this.staging,
        taskId: "T01",
        state: "started",
        recordedAt: instant,
        expectedDigest: null,
        apply: true,
      }),
    /直列経路/u,
  );
});

nb.Then(
  "inventoryのfileModeが実測modeと一致しinit後のmode変化を拒否する",
  function () {
    const inventory = this.draft.round.anchor.progressInventory;
    assert.ok(inventory);
    assert.equal(inventory.fileMode, fs.lstatSync(this.target).mode & 0o777);
    recordReviewRound({ staging: this.staging, round: this.draft.round });
    fs.chmodSync(this.target, 0o664);
    assert.throws(
      () =>
        appendReviewProgress({
          staging: this.staging,
          taskId: "T01",
          state: "started",
          recordedAt: instant,
          expectedDigest: null,
          apply: true,
        }),
      /identityまたはmode/u,
    );
  },
);

/** 生成modeの独立。umaskはprocess全体に効くのでtry/finallyで必ず戻す。 */
function generateUnderUmask(world: NonblockingWorld, mask: number): void {
  const previous = process.umask(mask);
  try {
    world.root = world.initRepo();
    world.generatedStaging = createIssueStaging(world.root, {
      title: "generated-mode",
      answers: fixtureAnswers(),
      now: new Date(instant),
      requestedMode: "full",
    }).path;
  } finally {
    process.umask(previous);
  }
}

nb.Given("umask 0002のissue create環境がある", function () {
  this.pendingUmask = 0o002;
});

nb.Given("umask 0077のissue create環境がある", function () {
  this.pendingUmask = 0o077;
});

nb.Given("on-disk modeが0664のissue templateがある", function () {
  this.pendingUmask = 0o022;
  this.templateRestore = [];
  const templateDirectory = path.resolve(
    process.cwd(),
    ".agent-skill-chain",
    "templates",
    "issue",
  );
  for (const name of ["01_要件定義.md", "02_設計.md", "03_実装計画.md"]) {
    const file = path.join(templateDirectory, name);
    const original = fs.lstatSync(file).mode & 0o777;
    this.templateRestore.push([file, original]);
    templateModeRestore.push([file, original]);
    fs.chmodSync(file, 0o664);
  }
});

nb.When("full stagingを生成する", function () {
  try {
    generateUnderUmask(this, this.pendingUmask);
  } finally {
    for (const [file, mode] of this.templateRestore ?? [])
      fs.chmodSync(file, mode);
    this.templateRestore = undefined;
  }
});

nb.Then("生成された03のmodeは0644である", function () {
  assert.equal(
    fs.lstatSync(path.join(this.generatedStaging, "03_実装計画.md")).mode &
      0o777,
    0o644,
  );
});

/**
 * Issue #1408のE2E。**domain側だけを直接呼ぶと合成経路の欠落を見逃す**ため、
 * 公開CLIの`issue create`が作ったstagingをそのまま`review round --init`へ渡し、
 * 手動`chmod`を一度も挟まずにinventoryが固定されることを観測する。
 */
nb.Given("配布CLIのissue create出力がある", async function () {
  const previous = process.umask(0o002);
  try {
    this.root = this.initRepo();
    fs.writeFileSync(
      path.join(this.root, "candidate.ts"),
      "export const x = 1;\n",
    );
    execFileSync("git", ["add", "candidate.ts"], { cwd: this.root });
    execFileSync("git", ["commit", "-q", "-m", "candidate"], {
      cwd: this.root,
    });
    this.fixtureHead = gitHead(this.root);
    /**
     * **`createIssueStaging`を直接呼ばない。** adapterを直接呼ぶと
     * `src/cli.ts`の`issue create` handlerが一行も実行されず、handler側の
     * mode固定を消す変異が生存する。本scenarioは「配布CLIのissue create出力」
     * を名乗るため、argv経路でstagingを生成する。
     */
    const assessment = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "asc-e2e-issue-create-")),
      "assessment.json",
    );
    fs.writeFileSync(assessment, JSON.stringify(fixtureAnswers()));
    assert.equal(
      await main(
        [
          "issue",
          "create",
          `--root=${this.root}`,
          "--title=e2e-generated",
          "--mode=full",
          `--assessment=${assessment}`,
        ],
        { now: () => new Date(instant) },
      ),
      0,
    );
    const stagingRoot = path.join(
      this.root,
      ".agent-skill-chain",
      "tmp",
      "issues",
    );
    const generated = fs.readdirSync(stagingRoot);
    assert.equal(generated.length, 1);
    this.staging = path.join(stagingRoot, generated[0]!);
  } finally {
    process.umask(previous);
  }
  this.target = path.join(this.staging, "03_実装計画.md");
  appendLegacyJournal(
    path.join(this.staging, STEP_JOURNAL_FILE),
    `${JSON.stringify({
      step: 9,
      skillId: "step-09-implement",
      mode: "full",
      recordedAt: instant,
      artifacts: ["candidate.ts"],
      evidence: `candidate HEAD ${this.fixtureHead}`,
      implementationHeadSha: this.fixtureHead,
    })}\n`,
  );
  refreshStoredStagingDigest(this.staging);
});

nb.When("手動chmodなしでreview round --initを実行する", async function () {
  /**
   * **ここでchmodを挟まない。** 挟むと生成modeの契約を検査しない空虚なtestになる。
   * **公開CLIのargv経路を通す。** adapterを直接呼ぶと`src/cli.ts`の
   * `review round --init` handler（`--out`の包含判定、draft書き出し、終了値）
   * が一行も実行されず、「配布CLI経路」を名乗る根拠が無くなる。
   */
  const baseSha = execFileSync("git", ["rev-parse", "HEAD~1"], {
    cwd: this.root,
    encoding: "utf8",
  }).trim();
  const out = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "asc-e2e-round-")),
    "round1.json",
  );
  let output = "";
  const write = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  const previousCwd = process.cwd();
  try {
    process.chdir(this.root);
    this.cliExitCode = await main([
      "review",
      "round",
      `--staging=${this.staging}`,
      "--init",
      `--head=${this.fixtureHead}`,
      `--base=${baseSha}`,
      "--scope=SCOPE-1408",
      "--ac=AC-1408-07",
      `--out=${out}`,
    ]);
  } finally {
    process.chdir(previousCwd);
    process.stdout.write = write;
  }
  this.cliOutput = output;
  /**
   * **bundleの実byte列から digest と byte数を取る。** 固定値を書くと、
   * `review round --init`が書き出したbundleと一致しない値でも通ってしまう。
   */
  const canonical = fs.readFileSync(out, "utf8");
  this.draft = {
    round: JSON.parse(canonical) as ReturnType<
      typeof buildReviewRoundDraft
    >["round"],
    notes: [],
    bundleDigest: crypto.createHash("sha256").update(canonical).digest("hex"),
    bundleBytes: Buffer.byteLength(canonical, "utf8"),
  } as ReturnType<typeof buildReviewRoundDraft>;
});

nb.Then("roundが開きprogress inventoryが固定される", function () {
  /** 終了値0をCLIの観測値として固定する。 */
  assert.equal(
    this.cliExitCode,
    0,
    `CLIが終了値0を返しません: ${this.cliOutput}`,
  );
  assert.equal(fs.lstatSync(this.target).mode & 0o777, 0o644);
  const inventory = this.draft.round.anchor.progressInventory;
  assert.ok(inventory, "配布CLI経路でprogress inventoryが固定されていません");
  assert.equal(inventory.fileMode, 0o644);
  assert.ok(inventory.allowedTaskIds.length > 0);
  assert.ok(
    !this.cliOutput.includes("ASC-REVIEW-PROGRESS-INVENTORY-UNBUILDABLE"),
    "成立しているのに不成立の案内が出ています",
  );
});

/**
 * Issue #1408 D-04。**分類ごとに案内が出ることをadapterの合成経路で観測する。**
 * 純関数を直接呼ぶunitだけでは、adapterが特定の分類でしか案内を出さなくなる
 * 変異が生存する（実測: D-04が全green のまま通過した）。
 */
nb.Given("分類の異なる不成立03を持つreview前stagingが揃っている", function () {
  const plan = `# 実装計画\n${PROGRESS_START}\n| タスク | 状態 |\n|---|---|\n| T01 | 未着手 |\n${PROGRESS_END}\n`;
  /**
   * **`not-regular-file`はここに置かない。** `calculateStagingDigest`と
   * `listStagingArtifacts`（`src/domain/staging.ts`）がsymlinkの成果物を先に
   * 拒否するため、symlinkの03を持つstagingはreview roundへ到達できない。
   * 当該分類は純関数の防御として残し、観測はSCN-UNIT-PROGRESS-023が担う。
   */
  this.unbuildableCases = [
    { reason: "mode-mismatch", options: { mode: 0o664 } },
    {
      reason: "marker-not-single-pair",
      options: { mode: 0o644, source: `${plan}${plan}` },
    },
    {
      reason: "no-task-id",
      options: {
        mode: 0o644,
        source: `# 実装計画\n${PROGRESS_START}\n| lower | x |\n${PROGRESS_END}\n`,
      },
    },
  ];
});

nb.When("それぞれでreview round --initを実行する", function () {
  this.unbuildableDrafts = this.unbuildableCases.map((entry) => {
    const { baseSha } = nonblockingStaging(this, entry.options);
    return { reason: entry.reason, draft: initDraft(this, baseSha) };
  });
});

nb.Then("どの分類でも案内がnotesへ出る", function () {
  assert.equal(this.unbuildableDrafts.length, 3);
  for (const { reason, draft } of this.unbuildableDrafts) {
    assert.equal(
      draft.round.anchor.progressInventory,
      undefined,
      `${reason}: inventoryが付いています`,
    );
    const note = draft.notes.find((entry) =>
      entry.includes("ASC-REVIEW-PROGRESS-INVENTORY-UNBUILDABLE"),
    );
    assert.ok(note, `${reason}: 案内がnotesにありません`);
    assert.ok(note.includes(reason), `${reason}: 分類が案内に現れません`);
    assert.ok(note.includes("03_実装計画.md"), `${reason}: 対象名がありません`);
    assert.ok(!note.includes("/home/"), `${reason}: 絶対pathが混入しています`);
    /** 通常fileでない対象へchmodを案内しない。 */
    assert.equal(
      note.includes("chmod 0644"),
      reason === "mode-mismatch",
      `${reason}: chmod案内の有無が契約と違います`,
    );
    /**
     * **REQ-WF-021が要求する欄をすべて合成経路で確かめる。** 分類とchmodだけを
     * 見ると、authority・rollback・effectを落とす変異が生存する。
     */
    const guidance = describeReviewProgressUnbuildable({
      reason: reason as Parameters<
        typeof describeReviewProgressUnbuildable
      >[0]["reason"],
      observedMode: 0o664,
      isSymbolicLink: false,
      isRegularFile: true,
      targetPath: "03_実装計画.md",
    });
    assert.ok(
      note.includes(guidance.requiredAuthority),
      `${reason}: 必要authorityがnotesにありません`,
    );
    assert.ok(
      note.includes(guidance.rollback),
      `${reason}: rollbackがnotesにありません`,
    );
    assert.ok(
      note.includes(guidance.effect),
      `${reason}: 影響がnotesにありません`,
    );
    assert.equal(
      guidance.requiredAuthority === "対象fileのmode変更権限",
      reason === "mode-mismatch",
      `${reason}: authorityが分類と対応していません`,
    );
  }
});

/**
 * Issue #1408 round 2。独立reviewとcodexが指摘した穴へ、
 * **是正の再発変異が殺される観測**を1件ずつ置く。
 * 直したがtestを足していない状態では、同じ欠陥が黙って戻る。
 */
nb.Given("親directoryが読めない03を持つstagingがある", function () {
  assert.notEqual(process.getuid?.(), 0, "この反例は非rootでのみ成立します");
  const { baseSha } = nonblockingStaging(this, { mode: 0o644 });
  this.baseShaForFailure = baseSha;
});

nb.When("lstatが不在以外の理由で失敗する", function () {
  /** stagingそのものを走査不能にし、lstatをEACCESで失敗させる。 */
  fs.chmodSync(this.staging, 0o000);
  this.initFailure = undefined;
  try {
    initDraft(this, this.baseShaForFailure);
  } catch (error) {
    this.initFailure = error;
  }
  fs.chmodSync(this.staging, 0o700);
});

nb.Then("不在と区別して拒否する", function () {
  /**
   * **この検査が固定するのは「読めないstagingが拒否される」ことだけである。**
   * `lstat(03)`のENOENT以外の分岐そのものは観測できない。実測では
   * `readStoredStagingRecord`の`staging-record.json`読み取りが先にEACCESで
   * 落ちるため（staging directoryが走査不能なら必ずそうなる）、当該分岐を
   * bare catchへ置き換える変異は観測上等価になる。分岐は防御として残す。
   */
  assert.ok(
    this.initFailure instanceof Error,
    "読めないstagingが非停止化で素通りしています",
  );
  assert.equal(
    (this.initFailure as NodeJS.ErrnoException).code,
    "EACCES",
    `EACCESが伝播していません: ${String(this.initFailure)}`,
  );
});

nb.Given("03が通常fileでないstagingがある", function () {
  const { baseSha } = nonblockingStaging(this, { mode: 0o644 });
  fs.rmSync(this.target);
  fs.mkdirSync(this.target);
  this.draft = initDraft(this, baseSha);
});

nb.Then("not-regular-fileとして案内する", function () {
  assert.equal(this.draft.round.anchor.progressInventory, undefined);
  const note = this.draft.notes.find((entry) =>
    entry.includes("ASC-REVIEW-PROGRESS-INVENTORY-UNBUILDABLE"),
  );
  assert.ok(note, "通常fileでない03の案内がありません");
  assert.ok(note.includes("not-regular-file"), note);
  /** 通常fileでない対象へchmodを案内しない。 */
  assert.ok(!note.includes("chmod 0644"), note);
  /**
   * **案内の本文を名指しで検査する。** 本fixtureはdirectoryであり、
   * symlinkではない。分類名だけを検査すると、種別によらず「symlinkです」と
   * 出す実装を素通りさせる。
   */
  assert.ok(note.includes("が通常fileではありません"), note);
  assert.ok(!note.includes("symlinkです"), note);
});

nb.Given("markerが片側だけの03を持つstagingがある", function () {
  const { baseSha } = nonblockingStaging(this, {
    mode: 0o644,
    source: `# 実装計画\n${PROGRESS_START}\n| T01 | 未着手 |\n`,
  });
  this.draft = initDraft(this, baseSha);
});

nb.Then("marker不正として案内する", function () {
  assert.equal(this.draft.round.anchor.progressInventory, undefined);
  const note = this.draft.notes.find((entry) =>
    entry.includes("ASC-REVIEW-PROGRESS-INVENTORY-UNBUILDABLE"),
  );
  assert.ok(note, "片側markerが無言で落ちています");
  assert.ok(note.includes("marker-not-single-pair"), note);
});

nb.Given("full昇格で03を生成するquick stagingがある", function () {
  const previous = process.umask(0o002);
  try {
    this.root = this.initRepo();
    this.staging = createIssueStaging(this.root, {
      title: "promote-mode",
      answers: fixtureAnswers(),
      now: new Date(instant),
      requestedMode: "quick",
    }).path;
  } finally {
    process.umask(previous);
  }
});

nb.When("full昇格を適用する", function () {
  promoteWorkflowStagingToFull({
    staging: this.staging,
    promotedAt: "2026-09-12T01:00:00.000Z",
    discovery: {
      discoveryId: "DISC-1408-PROMOTE",
      workflowMode: "quick",
      modeDisqualifiers: [
        { id: "security-boundary", evidence: "昇格経路の生成modeを観測する" },
      ],
      changedContractKinds: ["interface"],
      changesGoal: false,
      changesScope: false,
      changesAcceptanceCriteria: false,
      expandsSecurityBoundary: true,
      introducesIrreversibleOperation: false,
    },
  });
});

nb.Then("昇格で生成された03のmodeは0644である", function () {
  assert.equal(
    fs.lstatSync(path.join(this.staging, "03_実装計画.md")).mode & 0o777,
    0o644,
  );
});
