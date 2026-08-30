import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  WorkflowWorld,
  conformingPullRequestBody,
  stepDefinitions,
} from "../support/world.js";
import {
  createIssueStaging,
  recordStagingSync,
} from "../../src/domain/issue.js";
import { QUESTIONS, type ModeAnswer } from "../../src/domain/mode.js";
import {
  parseReviewRoundInput,
  type ReviewRoundInput,
  type ReviewSessionAnchor,
  type ReviewSessionState,
} from "../../src/domain/review-convergence.js";
import {
  observeReviewDiff,
  recordReviewRound,
} from "../../src/adapters/review-session.js";
import {
  appendWorkflowJournalEntry,
  readWorkflowJournal,
} from "../../src/adapters/workflow-journal.js";
import {
  WORKFLOW_STEPS,
  type StepJournalEntry,
} from "../../src/domain/workflow.js";
import { main } from "../../src/cli.js";

interface ReviewConvergenceWorld extends WorkflowWorld {
  root: string;
  staging: string;
  anchor: ReviewSessionAnchor;
  session: ReviewSessionState;
  cliStatus: number;
  prArgs: string[];
  evidenceFile: string;
  providerMarker: string;
}

const { Given, When, Then } = stepDefinitions<ReviewConvergenceWorld>();
const instant = new Date("2026-08-30T00:00:00.000Z");
const reviewedPath = "src/domain/review.ts";

function answers(): Record<string, ModeAnswer> {
  return Object.fromEntries(
    QUESTIONS.map((id) => [id, { answer: true, evidence: `${id}の固定証拠` }]),
  );
}

function head(root: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function commitFile(root: string, source: string, message: string): string {
  const file = path.join(root, reviewedPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
  execFileSync("git", ["add", reviewedPath], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: root });
  return head(root);
}

function finding(overrides: Record<string, unknown> = {}) {
  return {
    id: "H-001",
    severity: "High",
    status: "valid",
    source: "review",
    relation: "acceptance-violation",
    evidence: "SCN-UNIT-REVIEWCONV-001で再現した",
    path: reviewedPath,
    contractId: "AC-001",
    causedByFindingId: null,
    ...overrides,
  };
}

function roundInput(input: {
  world: ReviewConvergenceWorld;
  round: number;
  candidateHeadSha: string;
  previousRoundDigest: string | null;
  fixedDiff?: string[];
  adjacentScope?: Array<{ path: string; graphEvidence: string }>;
  anchor?: ReviewSessionAnchor;
  findings: Array<Record<string, unknown>>;
}): ReviewRoundInput {
  const previousBlocking =
    input.round === 1
      ? []
      : [...(input.world.session.rounds.at(-1)?.blocking ?? [])].sort();
  return parseReviewRoundInput({
    round: input.round,
    previousRoundDigest: input.previousRoundDigest,
    anchor: input.anchor ?? input.world.anchor,
    candidateHeadSha: input.candidateHeadSha,
    focus: {
      previousBlocking,
      fixedDiff: [...(input.fixedDiff ?? [])].sort(),
      adjacentScope: input.adjacentScope ?? [],
    },
    findings: input.findings,
  });
}

function createFixture(
  world: ReviewConvergenceWorld,
  withFinding = true,
): void {
  world.root = world.initRepo();
  const base = head(world.root);
  const initialHead = commitFile(
    world.root,
    "export const reviewed = 1;\n",
    "feat: initial candidate",
  );
  const observed = observeReviewDiff(world.root, base, initialHead);
  world.anchor = {
    scopeIds: ["SCOPE-001"],
    acceptanceCriteriaIds: ["AC-001"],
    invariantIds: ["INV-001"],
    diffBaseSha: base,
    initialHeadSha: initialHead,
    initialDiffDigest: observed.digest,
  };
  world.staging = createIssueStaging(world.root, {
    title: "review-convergence",
    answers: answers(),
    now: instant,
    requestedMode: "quick",
  }).path;
  world.session = recordReviewRound({
    staging: world.staging,
    round: roundInput({
      world,
      round: 1,
      candidateHeadSha: initialHead,
      previousRoundDigest: null,
      findings: withFinding ? [finding()] : [],
    }),
  });
}

Given(
  "固定scopeとAcceptance Criteriaでround 1のHigh findingを永続化したreview sessionがある",
  function () {
    createFixture(this);
    assert.equal(this.session.status, "active");
  },
);

When("round 2で既存findingを解消し範囲外audit改善提案を追加する", function () {
  const candidate = commitFile(
    this.root,
    "export const reviewed = 2;\n",
    "fix: review finding",
  );
  this.session = recordReviewRound({
    staging: this.staging,
    round: roundInput({
      world: this,
      round: 2,
      candidateHeadSha: candidate,
      previousRoundDigest: this.session.latestRoundDigest,
      fixedDiff: [reviewedPath],
      adjacentScope: [
        { path: "src/adjacent.ts", graphEvidence: "f".repeat(64) },
      ],
      findings: [
        finding({ status: "resolved" }),
        finding({
          id: "AUD-001",
          source: "audit",
          relation: "improvement",
          path: "src/optional.ts",
          contractId: null,
        }),
        finding({ id: "H-ADJ", path: "src/adjacent.ts" }),
      ],
    }),
  });
});

Then("review sessionはdigest chainを保ってconvergedになる", function () {
  assert.equal(this.session.status, "converged");
  assert.equal(this.session.rounds.length, 2);
  assert.equal(
    this.session.rounds[1]?.previousRoundDigest,
    this.session.rounds[0]?.roundDigest,
  );
});

Then("範囲外audit改善提案はrecord-onlyである", function () {
  const audit = this.session.rounds[1]?.findings.find(
    ({ id }) => id === "AUD-001",
  );
  assert.equal(audit?.admission, "record-only");
  assert.equal(this.session.rounds[1]?.blocking.length, 0);
});

Then("未照合Graph digestによる隣接Highはrecord-onlyである", function () {
  const adjacent = this.session.rounds[1]?.findings.find(
    ({ id }) => id === "H-ADJ",
  );
  assert.equal(adjacent?.admission, "record-only");
  assert.match(adjacent?.admissionReason ?? "", /実照合が未導入/u);
});

When("同じstagingでround 1へresetする", function () {
  this.error = undefined;
  try {
    recordReviewRound({
      staging: this.staging,
      round: roundInput({
        world: this,
        round: 1,
        candidateHeadSha: this.anchor.initialHeadSha,
        previousRoundDigest: null,
        findings: [finding()],
      }),
    });
  } catch (error) {
    this.error = error;
  }
});

Then("review session更新はreset拒否で失敗する", function () {
  assert.ok(this.error instanceof Error);
  assert.match(this.error.message, /reset/u);
});

When("round 2でscope anchorを変更する", function () {
  this.error = undefined;
  const changedAnchor = { ...this.anchor, scopeIds: ["SCOPE-002"] };
  try {
    recordReviewRound({
      staging: this.staging,
      round: roundInput({
        world: this,
        round: 2,
        candidateHeadSha: this.anchor.initialHeadSha,
        previousRoundDigest: this.session.latestRoundDigest,
        anchor: changedAnchor,
        findings: [finding()],
      }),
    });
  } catch (error) {
    this.error = error;
  }
});

Then("review session更新はanchor拒否で失敗する", function () {
  assert.ok(this.error instanceof Error);
  assert.match(this.error.message, /anchor変更/u);
});

When("round 2の修正差分で前round finding起因のHigh回帰を記録する", function () {
  const candidate = commitFile(
    this.root,
    "export const reviewed = 3;\n",
    "fix: introduce reviewed regression",
  );
  this.session = recordReviewRound({
    staging: this.staging,
    round: roundInput({
      world: this,
      round: 2,
      candidateHeadSha: candidate,
      previousRoundDigest: this.session.latestRoundDigest,
      fixedDiff: [reviewedPath],
      findings: [
        finding({ status: "resolved" }),
        finding({
          id: "H-002",
          relation: "fix-regression",
          contractId: null,
          causedByFindingId: "H-001",
        }),
      ],
    }),
  });
});

Then("修正起因Highはcurrent blockerになる", function () {
  assert.deepEqual(this.session.rounds[1]?.blocking, ["H-002"]);
  assert.equal(this.session.status, "active");
});

When("同じHigh findingをround 3まで未解決にする", function () {
  for (const round of [2, 3]) {
    const candidate = commitFile(
      this.root,
      `export const reviewed = ${round};\n`,
      `fix: review round ${round}`,
    );
    this.session = recordReviewRound({
      staging: this.staging,
      round: roundInput({
        world: this,
        round,
        candidateHeadSha: candidate,
        previousRoundDigest: this.session.latestRoundDigest,
        fixedDiff: [reviewedPath],
        findings: [finding()],
      }),
    });
  }
});

Then("review sessionはbudget-exhaustedになる", function () {
  assert.equal(this.session.status, "budget-exhausted");
  assert.equal(this.session.rounds.length, 3);
});

Then("round 4への自動継続を拒否する", function () {
  assert.throws(
    () =>
      recordReviewRound({
        staging: this.staging,
        round: roundInput({
          world: this,
          round: 4,
          candidateHeadSha: head(this.root),
          previousRoundDigest: this.session.latestRoundDigest,
          findings: [finding()],
        }),
      }),
    /3 round/u,
  );
});

Given("findingなしでround 1が収束したreview sessionがある", function () {
  createFixture(this, false);
  assert.equal(this.session.status, "converged");
});

When("収束HEAD後に実commitを追加しround 2で再reviewする", function () {
  const candidate = commitFile(
    this.root,
    "export const reviewed = 2;\n",
    "fix: post-review candidate",
  );
  this.session = recordReviewRound({
    staging: this.staging,
    round: roundInput({
      world: this,
      round: 2,
      candidateHeadSha: candidate,
      previousRoundDigest: this.session.latestRoundDigest,
      fixedDiff: [reviewedPath],
      findings: [],
    }),
  });
});

Then("review sessionはround 2で再収束する", function () {
  assert.equal(this.session.status, "converged");
  assert.equal(this.session.rounds.length, 2);
  assert.equal(
    this.session.rounds[1]?.previousRoundDigest,
    this.session.rounds[0]?.roundDigest,
  );
});

When("同じHEADをround 3として追記する", function () {
  this.error = undefined;
  try {
    recordReviewRound({
      staging: this.staging,
      round: roundInput({
        world: this,
        round: 3,
        candidateHeadSha: this.session.latestCandidateHeadSha,
        previousRoundDigest: this.session.latestRoundDigest,
        findings: [],
      }),
    });
  } catch (error) {
    this.error = error;
  }
});

Then("review session更新は同じHEADと空fixedDiffで拒否される", function () {
  assert.ok(this.error instanceof Error);
  assert.match(this.error.message, /異なるcandidate HEAD.*fixedDiff/u);
});

function workflowEntry(step: number): StepJournalEntry {
  const definition = WORKFLOW_STEPS.find(
    (candidate) => candidate.step === step,
  );
  if (!definition) throw new Error(`step ${step}がありません`);
  return {
    step,
    skillId: definition.skillId,
    mode: "quick",
    recordedAt: instant.toISOString(),
    artifacts: [`artifact-${step}`],
    evidence: `step ${step}の固定証拠`,
  };
}

async function captureMain(args: string[]): Promise<number> {
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    return await main(args);
  } finally {
    process.stdout.write = original;
  }
}

Given(
  "Step 9まで進んだquick stagingと収束済みreview sessionがある",
  function () {
    createFixture(this, false);
    for (const step of [1, 4, 9])
      appendWorkflowJournalEntry({
        staging: this.staging,
        entry: workflowEntry(step),
      });
    assert.equal(this.session.status, "converged");
  },
);

When("保存済みreview session digestでStep 10をCLI記録する", async function () {
  this.cliStatus = await captureMain([
    "workflow",
    "record",
    `--staging=${this.staging}`,
    "--step=10",
    "--artifact=04_レビュー.md",
    "--evidence=review session converged",
    `--review-session-digest=${this.session.latestRoundDigest}`,
    `--recorded-at=${instant.toISOString()}`,
  ]);
});

Then("Step 10記録は成功する", function () {
  assert.equal(this.cliStatus, 0);
});

Then("Step 10にreview session bindingが永続化される", function () {
  const step10 = readWorkflowJournal(this.staging)
    .entries.filter(({ step }) => step === 10)
    .at(-1);
  assert.deepEqual(step10?.reviewSession, {
    sessionId: this.session.sessionId,
    roundDigest: this.session.latestRoundDigest,
    headSha: this.session.latestCandidateHeadSha,
  });
});

When("自己申告した別digestでStep 10をCLI記録する", async function () {
  this.error = undefined;
  try {
    await captureMain([
      "workflow",
      "record",
      `--staging=${this.staging}`,
      "--step=10",
      "--artifact=04_レビュー.md",
      "--evidence=forged review session",
      `--review-session-digest=${"f".repeat(64)}`,
      `--recorded-at=${instant.toISOString()}`,
    ]);
  } catch (error) {
    this.error = error;
  }
});

Then("Step 10記録は拒否される", function () {
  assert.ok(this.error instanceof Error);
  assert.match(this.error.message, /digest/u);
});

function writePrEvidence(file: string, headSha: string): void {
  fs.writeFileSync(
    file,
    `${JSON.stringify({
      headSha,
      review: { approved: true, headSha },
      tests: {
        passed: true,
        headSha,
        scenarioIds: ["SCN-INT-REVIEWCONV-002"],
      },
      spec: {
        consistent: true,
        headSha,
        impact: "updated",
        trace: {
          requirements: ["REQ-WF-005"],
          scenarios: ["SCN-INT-REVIEWCONV-002"],
          tests: ["test/features/integration/review-convergence.feature"],
        },
      },
      ownership: {
        classified: true,
        owner: "package",
        targetLayer: "package",
      },
    })}\n`,
  );
}

Given(
  "Step 10まで進んだquick stagingとPR preview入力がある",
  async function () {
    this.root = this.initRepo();
    const policy = path.join(this.root, ".agent-skill-chain", "policy");
    fs.mkdirSync(policy, { recursive: true });
    fs.copyFileSync(
      path.resolve(".agent-skill-chain/policy/default.json"),
      path.join(policy, "default.json"),
    );
    execFileSync("git", ["add", ".agent-skill-chain/policy/default.json"], {
      cwd: this.root,
    });
    execFileSync("git", ["commit", "-q", "-m", "trusted policy"], {
      cwd: this.root,
    });
    const base = head(this.root);
    execFileSync("git", ["update-ref", "refs/remotes/origin/main", base], {
      cwd: this.root,
    });
    execFileSync(
      "git",
      ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
      { cwd: this.root },
    );
    const initialHead = commitFile(
      this.root,
      "export const reviewed = 1;\n",
      "feat: initial candidate",
    );
    const observed = observeReviewDiff(this.root, base, initialHead);
    this.anchor = {
      scopeIds: ["SCOPE-001"],
      acceptanceCriteriaIds: ["AC-001"],
      invariantIds: ["INV-001"],
      diffBaseSha: base,
      initialHeadSha: initialHead,
      initialDiffDigest: observed.digest,
    };
    this.staging = createIssueStaging(this.root, {
      title: "review-binding-pr",
      answers: answers(),
      now: instant,
      requestedMode: "quick",
    }).path;
    this.session = recordReviewRound({
      staging: this.staging,
      round: roundInput({
        world: this,
        round: 1,
        candidateHeadSha: initialHead,
        previousRoundDigest: null,
        findings: [],
      }),
    });
    for (const step of [1, 4, 9])
      appendWorkflowJournalEntry({
        staging: this.staging,
        entry: workflowEntry(step),
      });
    this.cliStatus = await captureMain([
      "workflow",
      "record",
      `--staging=${this.staging}`,
      "--step=10",
      "--artifact=04_レビュー.md",
      "--evidence=review session converged",
      `--review-session-digest=${this.session.latestRoundDigest}`,
      `--recorded-at=${instant.toISOString()}`,
    ]);
    assert.equal(this.cliStatus, 0);
    recordStagingSync(this.staging, {
      tracker: "https://github.com/o/r/issues/1061",
      checkpoint: 4,
      syncedAt: instant.toISOString(),
      bodyDigest: "a".repeat(64),
      readBackDigest: "a".repeat(64),
    });
    const fixture = this.temp("asc-review-pr-");
    this.evidenceFile = path.join(fixture, "evidence.json");
    writePrEvidence(this.evidenceFile, initialHead);
    const body = path.join(fixture, "PR.md");
    fs.writeFileSync(
      body,
      conformingPullRequestBody({
        title: "fix: review bindingを検証する",
        canonicalIssue: 1061,
      }),
    );
    this.providerMarker = path.join(fixture, "provider-called");
    this.prArgs = [
      "pr",
      "create",
      "--repo=o/r",
      "--issue=1061",
      "--head=feature/review-binding",
      "--base=main",
      `--head-sha=${initialHead}`,
      `--evidence=${this.evidenceFile}`,
      `--root=${this.root}`,
      `--staging=${this.staging}`,
      `--body-file=${body}`,
    ];
  },
);

When(
  "Step 10後に新しいcommitを追加し旧bindingでPR previewする",
  async function () {
    const candidate = commitFile(
      this.root,
      "export const reviewed = 2;\n",
      "fix: post-review change",
    );
    writePrEvidence(this.evidenceFile, candidate);
    this.prArgs = this.prArgs.map((argument) =>
      argument.startsWith("--head-sha=") ? `--head-sha=${candidate}` : argument,
    );
    this.error = undefined;
    try {
      await captureMain([...this.prArgs, "--apply", "--authorize=approved"]);
    } catch (error) {
      this.error = error;
    }
  },
);

Then(
  "PR previewはreview binding不一致でprovider呼び出し前に拒否される",
  function () {
    assert.ok(this.error instanceof Error);
    assert.match(this.error.message, /binding HEAD|candidate HEAD/u);
    assert.equal(fs.existsSync(this.providerMarker), false);
  },
);

When("新しいHEADをround 2で再reviewしStep 10を再記録する", async function () {
  const candidate = head(this.root);
  this.session = recordReviewRound({
    staging: this.staging,
    round: roundInput({
      world: this,
      round: 2,
      candidateHeadSha: candidate,
      previousRoundDigest: this.session.latestRoundDigest,
      fixedDiff: [reviewedPath],
      findings: [],
    }),
  });
  this.cliStatus = await captureMain([
    "workflow",
    "record",
    `--staging=${this.staging}`,
    "--step=10",
    "--artifact=04_再レビュー.md",
    "--evidence=review session reconverged",
    `--review-session-digest=${this.session.latestRoundDigest}`,
    `--recorded-at=${instant.toISOString()}`,
  ]);
  assert.equal(this.cliStatus, 0);
});

When("新しいbindingでPR previewする", async function () {
  this.cliStatus = await captureMain([...this.prArgs, "--dry-run"]);
});

Then("PR previewは成功する", function () {
  assert.equal(this.cliStatus, 0);
});
