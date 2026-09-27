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
import { refreshStoredStagingDigest } from "../../src/domain/staging.js";
import { stableJson } from "../../src/lib/security.js";
import { QUESTIONS, type ModeAnswer } from "../../src/domain/mode.js";
import {
  REVIEW_DIVERGENCE_RECURRENCE,
  REVIEW_FIX_REGRESSION_CHAIN,
  advanceReviewSession,
  countedRounds,
  reviewDivergence,
  parseReviewRoundInput,
  type ReviewRoundInput,
  type ReviewSessionAnchor,
  type ReviewSessionState,
} from "../../src/domain/review-convergence.js";
import {
  buildReviewRoundDraft,
  observeReviewDiff,
  recordReviewRound,
} from "../../src/adapters/review-session.js";
import {
  REVIEW_SESSION_FILE,
  readStoredReviewSession,
} from "../../src/adapters/review-session-store.js";
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
  conflictCandidate: string;
  cliOutputs: Array<Record<string, unknown>>;
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
    decisionRef: null,
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
  followOnly?: true;
  recordLayerOnly?: true;
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
    ...(input.followOnly ? { followOnly: true } : {}),
    ...(input.recordLayerOnly ? { recordLayerOnly: true } : {}),
  });
}

When("検証済みrecord layerとしてround 2をdomainへ記録する", function () {
  const candidate = commitFile(
    this.root,
    "export const reviewed = 2;\n",
    "docs: verified record layer fixture",
  );
  this.session = advanceReviewSession(
    this.session,
    roundInput({
      world: this,
      round: 2,
      candidateHeadSha: candidate,
      previousRoundDigest: this.session.latestRoundDigest,
      fixedDiff: [reviewedPath],
      findings: [],
      recordLayerOnly: true,
    }),
  );
});

Then("record layer roundは保存され数えるroundに含めない", function () {
  assert.equal(this.session.rounds.length, 2);
  assert.equal(this.session.rounds.at(-1)?.recordLayerOnly, true);
  assert.equal(countedRounds(this.session), 1);
  assert.equal(
    this.session.latestCandidateHeadSha,
    this.session.anchor.initialHeadSha,
  );
  assert.equal(this.session.status, "converged");
});

When("findingありの通常round 2をdomainへ記録する", function () {
  const candidate = commitFile(
    this.root,
    "export const reviewed = 3;\n",
    "fix: reviewed implementation",
  );
  const draft = buildReviewRoundDraft({
    staging: this.staging,
    headSha: candidate,
  });
  assert.equal(draft.round.recordLayerOnly, undefined);
  this.session = recordReviewRound({
    staging: this.staging,
    round: parseReviewRoundInput({
      ...draft.round,
      findings: [finding({ id: "H-RECORD" })],
    }),
  });
});

Then("findingありroundは数えるroundに含める", function () {
  assert.equal(countedRounds(this.session), 2);
  assert.deepEqual(this.session.rounds.at(-1)?.blocking, ["H-RECORD"]);
});

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
  for (const step of [1, 4, 9])
    appendWorkflowJournalEntry({
      staging: world.staging,
      entry: workflowEntry(step, initialHead),
    });
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
      findings: [
        finding({ status: "resolved" }),
        finding({
          id: "AUD-001",
          source: "audit",
          relation: "improvement",
          path: "src/optional.ts",
          contractId: null,
        }),
        finding({
          id: "H-ADJ",
          relation: "fix-regression",
          path: "src/adjacent.ts",
          contractId: null,
          causedByFindingId: null,
        }),
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

/**
 * このfixtureの影響集合は証明できない（full）。全pathが隣接範囲になるため、
 * 修正差分外でも前round blockerへ結び付かないHighだけがrecord-onlyになる。
 */
Then(
  "影響集合を証明できない修正差分外で前round blockerへ結び付かないHighはrecord-onlyである",
  function () {
    const outside = this.session.rounds[1]?.findings.find(
      ({ id }) => id === "H-ADJ",
    );
    assert.deepEqual(this.session.rounds[1]?.focus.adjacentScope, []);
    assert.equal(this.session.rounds[1]?.focus.adjacentScopeUnbounded, true);
    assert.equal(outside?.admission, "record-only");
    assert.equal(
      outside?.admissionReason,
      "修正起因を前round blockerと固定修正差分へ立証できない",
    );
  },
);

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
          decisionRef: null,
        }),
      ],
    }),
  });
});

Then("修正起因Highはcurrent blockerになる", function () {
  assert.deepEqual(this.session.rounds[1]?.blocking, ["H-002"]);
  assert.equal(this.session.status, "active");
});

/** Issue #1503より前の上限（通算8 round）を超える件数。 */
const BEYOND_FORMER_LIMIT = 9;

function recordCountedRound(
  world: ReviewConvergenceWorld,
  findings: Array<Record<string, unknown>>,
): void {
  const round = world.session.rounds.length + 1;
  const candidate = commitFile(
    world.root,
    `export const reviewed = ${round};\n`,
    `fix: review round ${round}`,
  );
  world.session = recordReviewRound({
    staging: world.staging,
    round: roundInput({
      world,
      round,
      candidateHeadSha: candidate,
      previousRoundDigest: world.session.latestRoundDigest,
      fixedDiff: [reviewedPath],
      findings,
    }),
  });
}

When("同じHigh findingを旧上限を超えるroundまで未解決にする", function () {
  while (this.session.rounds.length < BEYOND_FORMER_LIMIT)
    recordCountedRound(this, [finding()]);
});

Then("round数を理由に拒否されずactiveのままである", function () {
  assert.equal(this.session.rounds.length, BEYOND_FORMER_LIMIT);
  assert.equal(countedRounds(this.session), BEYOND_FORMER_LIMIT);
  assert.equal(this.session.status, "active");
});

When("次roundで前round blockerを解消する", function () {
  recordCountedRound(this, [finding({ status: "resolved" })]);
});

Then("review sessionは旧上限を超えたroundで収束する", function () {
  assert.equal(this.session.status, "converged");
  assert.equal(this.session.rounds.length, BEYOND_FORMER_LIMIT + 1);
});

When("収束後にHEADを進めて再reviewを繰り返す", function () {
  for (let count = 0; count < 2; count += 1) recordCountedRound(this, []);
});

Then("収束後の再reviewも件数で拒否されない", function () {
  assert.equal(this.session.status, "converged");
  assert.equal(this.session.rounds.length, BEYOND_FORMER_LIMIT + 3);
});

When(
  "保存済みsessionのstatusを旧形式のbudget-exhaustedへ書き換える",
  function () {
    const file = path.join(this.staging, REVIEW_SESSION_FILE);
    const stored = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(stored.status, "active");
    fs.writeFileSync(
      file,
      `${JSON.stringify({ ...stored, status: "budget-exhausted" })}\n`,
    );
    refreshStoredStagingDigest(this.staging);
  },
);

Then("旧形式のsessionをactiveとして読み取れる", function () {
  const reread = readStoredReviewSession(this.staging);
  assert.equal(reread?.status, "active");
  assert.equal(reread?.latestRoundDigest, this.session.latestRoundDigest);
});

Then("旧形式のsessionへ次roundを記録できる", function () {
  recordCountedRound(this, [finding({ status: "resolved" })]);
  assert.equal(this.session.status, "converged");
});

Then("旧形式でもstatus以外の改竄は拒否する", function () {
  const file = path.join(this.staging, REVIEW_SESSION_FILE);
  const original = fs.readFileSync(file, "utf8");
  const stored = JSON.parse(original) as Record<string, unknown>;
  assert.equal(stored.status, "budget-exhausted");
  fs.writeFileSync(
    file,
    `${JSON.stringify({
      ...stored,
      latestCandidateHeadSha: this.anchor.initialHeadSha,
    })}\n`,
  );
  refreshStoredStagingDigest(this.staging);
  assert.throws(
    () => readStoredReviewSession(this.staging),
    /再導出値と一致しません/u,
  );
  fs.writeFileSync(file, original);
  refreshStoredStagingDigest(this.staging);
});

Then("発散warningが再発findingを名指しする", function () {
  const divergence = reviewDivergence(this.session);
  assert.equal(divergence.countedRounds, BEYOND_FORMER_LIMIT);
  assert.equal(divergence.maxFindingRecurrence, BEYOND_FORMER_LIMIT);
  assert.equal(divergence.repeatedFindingRate, 1);
  assert.equal(divergence.newBlockerRate, 0);
  assert.equal(divergence.fixedPathCount, 1);
  assert.deepEqual(divergence.warnings, [
    `同じfindingが${REVIEW_DIVERGENCE_RECURRENCE} round以上blockerとして残っています: H-001`,
  ]);
});

Then("再発が閾値未満ならwarningを出さない", function () {
  const first = this.session.rounds.slice(0, REVIEW_DIVERGENCE_RECURRENCE - 1);
  const partial = { ...this.session, rounds: first };
  assert.deepEqual(reviewDivergence(partial).warnings, []);
  const atThreshold = {
    ...this.session,
    rounds: this.session.rounds.slice(0, REVIEW_DIVERGENCE_RECURRENCE),
  };
  assert.equal(reviewDivergence(atThreshold).warnings.length, 1);
});

When("次roundで新しいHigh blockerを修正差分に記録する", function () {
  recordCountedRound(this, [
    finding(),
    finding({
      id: "H-009",
      relation: "fix-regression",
      causedByFindingId: "H-001",
    }),
  ]);
});

Then("発散warningが新規blockerを名指しする", function () {
  const divergence = reviewDivergence(this.session);
  assert.equal(divergence.newBlockerRate, 0.5);
  assert.equal(divergence.repeatedFindingRate, 0.5);
  assert.ok(
    divergence.warnings.includes(
      "直前roundに無かったblockerが新たに出ています: H-009",
    ),
    divergence.warnings.join("\n"),
  );
});

Then("warningは記録済みstatusとdigestを変えない", function () {
  const before = stableJson(this.session);
  reviewDivergence(this.session);
  assert.equal(stableJson(this.session), before);
  assert.equal(
    stableJson(readStoredReviewSession(this.staging)),
    stableJson(this.session),
  );
});

Then("旧上限を超えたroundでもadmission違反を拒否する", function () {
  assert.ok(this.session.rounds.length >= BEYOND_FORMER_LIMIT);
  const candidate = commitFile(
    this.root,
    "export const reviewed = admission;\n",
    "fix: admission violation",
  );
  assert.throws(
    () =>
      recordReviewRound({
        staging: this.staging,
        round: roundInput({
          world: this,
          round: this.session.rounds.length + 1,
          candidateHeadSha: candidate,
          previousRoundDigest: this.session.latestRoundDigest,
          fixedDiff: [reviewedPath],
          findings: [],
        }),
      }),
    /前round blockerの再評価結果をfindingから脱落できません/u,
  );
});

Then(
  "旧上限を超えたroundでも固定ACへ結び付かないHighはrecord-onlyである",
  function () {
    recordCountedRound(this, [
      finding(),
      finding({
        id: "H-010",
        contractId: "AC-999",
      }),
    ]);
    const outside = this.session.rounds
      .at(-1)
      ?.findings.find(({ id }) => id === "H-010");
    assert.equal(outside?.admission, "record-only");
    assert.equal(
      outside?.admissionReason,
      "固定済みAcceptance Criteriaへ結び付かない",
    );
    assert.deepEqual(this.session.rounds.at(-1)?.blocking, ["H-001"]);
  },
);

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

function workflowEntry(
  step: number,
  implementationHeadSha?: string,
): StepJournalEntry {
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
    ...(step === 9 ? { implementationHeadSha } : {}),
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

async function recordRoundByCli(
  world: ReviewConvergenceWorld,
  findings: Array<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const round = world.session.rounds.length + 1;
  const candidate = commitFile(
    world.root,
    `export const reviewed = ${round};\n`,
    `fix: intake round ${round}`,
  );
  const file = path.join(path.dirname(world.root), `round-${round}.json`);
  fs.writeFileSync(
    file,
    `${stableJson(
      roundInput({
        world,
        round,
        candidateHeadSha: candidate,
        previousRoundDigest: world.session.latestRoundDigest,
        fixedDiff: [reviewedPath],
        findings,
      }),
    )}\n`,
  );
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  let status: number;
  try {
    status = await main([
      "review",
      "round",
      `--staging=${world.staging}`,
      `--file=${file}`,
      "--apply",
    ]);
  } finally {
    process.stdout.write = original;
  }
  assert.equal(status, 0, chunks.join(""));
  const output = JSON.parse(chunks.join("")) as Record<string, unknown>;
  const stored = readStoredReviewSession(world.staging);
  assert.ok(stored);
  world.session = stored;
  return output;
}

When(
  "収束後に届いた指摘の記録と是正をCLIで旧上限を超えるまで繰り返す",
  async function () {
    const outputs: Array<Record<string, unknown>> = [];
    while (this.session.rounds.length < BEYOND_FORMER_LIMIT - 1)
      outputs.push(await recordRoundByCli(this, [finding()]));
    outputs.push(
      await recordRoundByCli(this, [finding({ status: "resolved" })]),
    );
    this.cliOutputs = outputs;
  },
);

Then("CLIはどのroundも件数で拒否せず記録する", function () {
  assert.equal(this.session.rounds.length, BEYOND_FORMER_LIMIT);
  assert.equal(this.cliOutputs.length, BEYOND_FORMER_LIMIT - 1);
  for (const output of this.cliOutputs) assert.equal(output.applied, true);
});

Then("CLI出力は発散warningを返し最後に再収束する", function () {
  const beforeLast = this.cliOutputs.at(-2)?.divergence as
    { warnings: string[] } | undefined;
  assert.deepEqual(beforeLast?.warnings, [
    `同じfindingが${REVIEW_DIVERGENCE_RECURRENCE} round以上blockerとして残っています: H-001`,
  ]);
  const last = this.cliOutputs.at(-1);
  assert.equal(last?.status, "converged");
  assert.equal(this.session.status, "converged");
});

Given(
  "Step 9まで進んだquick stagingと収束済みreview sessionがある",
  function () {
    createFixture(this, false);
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
    for (const step of [1, 4, 9])
      appendWorkflowJournalEntry({
        staging: this.staging,
        entry: workflowEntry(step, initialHead),
      });
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
    fs.writeFileSync(
      path.join(fixture, "gh"),
      `#!/bin/sh\nprintf 'called\\n' > ${JSON.stringify(this.providerMarker)}\nexit 1\n`,
      { mode: 0o700 },
    );
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
    const originalPath = process.env.PATH;
    process.env.PATH = `${path.dirname(this.providerMarker)}${path.delimiter}${originalPath ?? ""}`;
    try {
      await captureMain([...this.prArgs, "--apply", "--authorize=approved"]);
    } catch (error) {
      this.error = error;
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
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

/**
 * **既定branchへ1 commit積み、それを取り込むmergeをcandidateにする。**
 * `mode`で3種の受理しない形を作り分ける。
 */
function upstreamCommit(root: string, target: string, body: string): string {
  const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  execFileSync("git", ["checkout", "-q", "refs/remotes/origin/main"], {
    cwd: root,
  });
  const file = path.join(root, target);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  execFileSync("git", ["add", target], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", `feat: upstream ${target}`], {
    cwd: root,
  });
  const upstream = head(root);
  execFileSync("git", ["update-ref", "refs/remotes/origin/main", upstream], {
    cwd: root,
  });
  execFileSync("git", ["checkout", "-q", branch], { cwd: root });
  return upstream;
}

function initDefaultRef(root: string): void {
  execFileSync("git", ["update-ref", "refs/remotes/origin/main", head(root)], {
    cwd: root,
  });
  execFileSync(
    "git",
    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    { cwd: root },
  );
}

function mergeUpstream(root: string, upstream: string): string {
  execFileSync("git", ["merge", "--no-ff", "--no-edit", upstream], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return head(root);
}

When(
  "既定branchを取り込む自動mergeだけでHEADを進めroundを3回記録する",
  function () {
    initDefaultRef(this.root);
    for (let index = 0; index < 3; index += 1) {
      const upstream = upstreamCommit(
        this.root,
        `docs/upstream-${index}.md`,
        `upstream ${index}\n`,
      );
      const candidate = mergeUpstream(this.root, upstream);
      this.session = recordReviewRound({
        staging: this.staging,
        round: roundInput({
          world: this,
          round: this.session.rounds.length + 1,
          candidateHeadSha: candidate,
          previousRoundDigest: this.session.latestRoundDigest,
          fixedDiff: [`docs/upstream-${index}.md`],
          findings: [],
          followOnly: true,
        }),
      });
    }
  },
);

Then("どのroundも記録されるが数えるroundには含めない", function () {
  assert.equal(this.session.rounds.length, 4);
  for (const record of this.session.rounds.slice(1))
    assert.equal(record.followOnly, true);
  assert.equal(countedRounds(this.session), 1);
  assert.equal(this.session.status, "converged");
});

When(
  "未解決blockerを持ったまま既定branchの自動mergeだけを記録する",
  function () {
    initDefaultRef(this.root);
    const upstream = upstreamCommit(
      this.root,
      "docs/active-follow.md",
      "active follow\n",
    );
    const candidate = mergeUpstream(this.root, upstream);
    this.session = recordReviewRound({
      staging: this.staging,
      round: roundInput({
        world: this,
        round: 2,
        candidateHeadSha: candidate,
        previousRoundDigest: this.session.latestRoundDigest,
        fixedDiff: ["docs/active-follow.md"],
        findings: [],
        followOnly: true,
      }),
    });
  },
);

Then(
  "追随roundはblockerと数えるround数を維持したactive状態になる",
  function () {
    assert.equal(this.session.status, "active");
    assert.deepEqual(this.session.rounds.at(-1)?.blocking, ["H-001"]);
    assert.equal(countedRounds(this.session), 1);
  },
);

When("Git条件を満たさないfollow-only sessionを保存して読み直す", function () {
  const candidate = commitFile(
    this.root,
    "export const reviewed = 99;\n",
    "fix: not a follow merge",
  );
  const fake = advanceReviewSession(
    this.session,
    roundInput({
      world: this,
      round: this.session.rounds.length + 1,
      candidateHeadSha: candidate,
      previousRoundDigest: this.session.latestRoundDigest,
      fixedDiff: [reviewedPath],
      findings: [],
      followOnly: true,
    }),
  );
  fs.writeFileSync(
    path.join(this.staging, REVIEW_SESSION_FILE),
    `${JSON.stringify(fake)}\n`,
  );
});

Then("保存済みfollow-only roundはGit再検証で拒否される", function () {
  assert.throws(
    () => readStoredReviewSession(this.staging),
    /保存済みreview sessionのfollow-only round 3を実Gitで再検証できません/u,
  );
});

When(
  "reanchor後の実効HEADから既定branchの自動mergeだけを記録する",
  function () {
    const oldHead = this.session.latestCandidateHeadSha;
    execFileSync(
      "git",
      [
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "test: equivalent reanchored candidate",
      ],
      { cwd: this.root },
    );
    const effectiveHead = head(this.root);
    fs.mkdirSync(path.join(this.staging, "journal"), { recursive: true });
    fs.writeFileSync(
      path.join(this.staging, "journal/reanchor.jsonl"),
      `${JSON.stringify({
        oldHeadSha: oldHead,
        newHeadSha: effectiveHead,
        oldBaseSha: this.anchor.diffBaseSha,
        newBaseSha: oldHead,
        diffDigest: "0".repeat(64),
        method: "rebase",
        reason: "SCN-UNIT-REVIEWCONV-011 fixture",
        recordedAt: instant.toISOString(),
      })}\n`,
    );
    refreshStoredStagingDigest(this.staging);
    initDefaultRef(this.root);
    const upstream = upstreamCommit(
      this.root,
      "docs/reanchored-follow.md",
      "reanchored follow\n",
    );
    const candidate = mergeUpstream(this.root, upstream);
    this.session = recordReviewRound({
      staging: this.staging,
      round: roundInput({
        world: this,
        round: 2,
        candidateHeadSha: candidate,
        previousRoundDigest: this.session.latestRoundDigest,
        fixedDiff: ["docs/reanchored-follow.md"],
        findings: [],
        followOnly: true,
      }),
    });
  },
);

Then("追随roundは保存後read-backでも受理される", function () {
  const reread = readStoredReviewSession(this.staging);
  assert.equal(reread?.latestRoundDigest, this.session.latestRoundDigest);
  assert.equal(reread?.rounds.at(-1)?.followOnly, true);
});

Then("通常roundを続けて記録でき記録総数は数えるround数を超える", function () {
  for (let count = 0; count < 2; count += 1) recordCountedRound(this, []);
  assert.equal(countedRounds(this.session), 3);
  // 追随roundを数える実装では記録総数と数えるround数が一致する
  assert.equal(this.session.rounds.length, 6);
});

function rejectsFollowOnly(
  world: ReviewConvergenceWorld,
  candidate: string,
  fixedDiff: string[],
  findings: Array<Record<string, unknown>>,
  pattern: RegExp,
): void {
  assert.throws(
    () =>
      recordReviewRound({
        staging: world.staging,
        round: roundInput({
          world,
          round: world.session.rounds.length + 1,
          candidateHeadSha: candidate,
          previousRoundDigest: world.session.latestRoundDigest,
          fixedDiff,
          findings,
          followOnly: true,
        }),
      }),
    pattern,
  );
}

Then(
  "衝突を解決したmergeは自動merge結果と一致しないとして拒否される",
  function () {
    initDefaultRef(this.root);
    const upstream = upstreamCommit(
      this.root,
      reviewedPath,
      "export const upstream = 1;\n",
    );
    execFileSync("git", ["merge", "--no-ff", "--no-commit", upstream], {
      cwd: this.root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    fs.writeFileSync(
      path.join(this.root, reviewedPath),
      "export const resolvedByHand = true;\n",
    );
    execFileSync("git", ["add", reviewedPath], { cwd: this.root });
    execFileSync("git", ["commit", "-q", "--no-edit"], { cwd: this.root });
    rejectsFollowOnly(
      this,
      head(this.root),
      [reviewedPath],
      [],
      /treeが両親の自動merge結果と一致するmerge commitだけです/u,
    );
    execFileSync("git", ["reset", "-q", "--hard", "HEAD~1"], {
      cwd: this.root,
    });
  },
);

Then("既定branchのancestorでない第2親を持つmergeは拒否される", function () {
  const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: this.root,
    encoding: "utf8",
  }).trim();
  execFileSync("git", ["checkout", "-q", "-b", "side-branch"], {
    cwd: this.root,
  });
  fs.mkdirSync(path.join(this.root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(this.root, "docs/side.md"), "side\n");
  execFileSync("git", ["add", "docs/side.md"], { cwd: this.root });
  execFileSync("git", ["commit", "-q", "-m", "feat: side"], {
    cwd: this.root,
  });
  const side = head(this.root);
  execFileSync("git", ["checkout", "-q", branch], { cwd: this.root });
  const candidate = mergeUpstream(this.root, side);
  rejectsFollowOnly(
    this,
    candidate,
    ["docs/side.md"],
    [],
    /treeが両親の自動merge結果と一致するmerge commitだけです/u,
  );
  execFileSync("git", ["reset", "-q", "--hard", "HEAD~1"], {
    cwd: this.root,
  });
});

Then("第1親が前roundのcandidateでないmergeは拒否される", function () {
  const upstream = upstreamCommit(
    this.root,
    "docs/upstream-first-parent.md",
    "first parent\n",
  );
  // **第1親を入れ替える。** `merge -s ours`ではなく、upstream側からmergeし直す
  const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: this.root,
    encoding: "utf8",
  }).trim();
  const ours = head(this.root);
  execFileSync("git", ["checkout", "-q", upstream], { cwd: this.root });
  execFileSync("git", ["merge", "--no-ff", "--no-edit", ours], {
    cwd: this.root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const candidate = head(this.root);
  /**
   * **candidateを現在のHEADにしたまま判定させる。** branchへ戻すと
   * 「candidate HEADがcurrent HEADと一致しません」で先に落ち、
   * 第1親の検査へ到達しない
   */
  execFileSync("git", ["checkout", "-q", "-B", branch, candidate], {
    cwd: this.root,
  });
  /**
   * `fixedDiff`は実Gitから取る。**`review round --init`と同じ導出であり、
   * 期待値を実装の判定から作っているわけではない。** ここで固定したいのは
   * 「第1親が前roundのcandidateでない」ことへの拒否である
   */
  const fixed = observeReviewDiff(
    this.root,
    this.session.latestCandidateHeadSha,
    candidate,
  ).changedPaths;
  rejectsFollowOnly(
    this,
    candidate,
    [...fixed],
    [],
    /treeが両親の自動merge結果と一致するmerge commitだけです/u,
  );
  // 後続のstepのために、branchを前roundのcandidateへ戻す
  execFileSync("git", ["checkout", "-q", "-B", branch, ours], {
    cwd: this.root,
  });
});

Then(
  "追随roundへfindingを載せると数えるroundとして記録する旨を名指しして拒否される",
  function () {
    const upstream = upstreamCommit(
      this.root,
      "docs/upstream-finding.md",
      "finding\n",
    );
    const candidate = mergeUpstream(this.root, upstream);
    const fixed = observeReviewDiff(
      this.root,
      this.session.latestCandidateHeadSha,
      candidate,
    ).changedPaths;
    rejectsFollowOnly(
      this,
      candidate,
      [...fixed],
      [finding()],
      /指摘があるroundは数えるroundとして記録します/u,
    );
  },
);

/**
 * **第1親の検査が無いと、実装commitを挟んだmergeが追随として通る。**
 *
 * 前roundのcandidateの上に実装commitを1つ積み、そこへ既定branchを取り込むと、
 * 第2親は既定branchのancestorで、treeも自動merge結果と一致する。それでも
 * **そのroundには実装者が書いたcommitが含まれる**ため、数えるroundに含めなければならない。
 * 第1親が前roundのcandidateであることが、この区別を担っている（Issue #1287）。
 */
Then("実装commitを挟んでからのmergeは拒否される", function () {
  commitFile(
    this.root,
    "export const authored = true;\n",
    "fix: authored commit before follow",
  );
  const upstream = upstreamCommit(
    this.root,
    "docs/upstream-after-authored.md",
    "after authored\n",
  );
  const candidate = mergeUpstream(this.root, upstream);
  const fixed = observeReviewDiff(
    this.root,
    this.session.latestCandidateHeadSha,
    candidate,
  ).changedPaths;
  rejectsFollowOnly(
    this,
    candidate,
    [...fixed],
    [],
    /treeが両親の自動merge結果と一致するmerge commitだけです/u,
  );
});

/** 修正回帰の連鎖（Issue #1517 AMD-002）を検査するための最小round列。 */
function chainedRounds(
  links: readonly (readonly [string, string | null])[],
): ReviewSessionState {
  const findings = links.map(([id, causedByFindingId]) => ({
    id,
    severity: "High" as const,
    status: "valid" as const,
    source: "review" as const,
    relation: "fix-regression" as const,
    evidence: "fixture",
    path: "src/a.ts",
    contractId: "AC-01",
    causedByFindingId,
  }));
  return {
    rounds: findings.map((finding, index) => ({
      round: index + 1,
      previousRoundDigest: null,
      candidateHeadSha: "a".repeat(40),
      focus: {
        previousBlocking: [],
        fixedDiff: ["src/a.ts"],
        adjacentScope: [],
      },
      findings: [
        { ...finding, admission: "block-current", admissionReason: "fixture" },
      ],
      blocking: [finding.id],
      recordOnly: [],
    })),
  } as unknown as ReviewSessionState;
}

const CHAIN_FIXTURES = {
  single: [
    ["R1-01", null],
    ["R2-01", "R1-01"],
  ],
  branched: [
    ["R1-01", null],
    ["R2-01", "R1-01"],
    ["R3-01", "R2-01"],
    ["R3-02", "R2-01"],
  ],
  deep: [
    ["R1-01", null],
    ["R2-01", "R1-01"],
    ["R3-01", "R2-01"],
    ["R4-01", "R3-01"],
  ],
  cyclic: [
    ["C-01", "C-02"],
    ["C-02", "C-01"],
  ],
} as const;
let chainDivergence: Record<
  keyof typeof CHAIN_FIXTURES,
  ReturnType<typeof reviewDivergence>
>;
const chainWarnings = (divergence: ReturnType<typeof reviewDivergence>) =>
  divergence.warnings
    .filter((warning) => warning.startsWith("修正回帰"))
    .map((warning) => warning.split("。")[0]);

Given(
  "是正起因のfindingがcausedByFindingIdで連鎖したreview roundがある",
  function () {
    assert.equal(REVIEW_FIX_REGRESSION_CHAIN, 2);
  },
);

When("発散の兆候を算出する", function () {
  chainDivergence = Object.fromEntries(
    Object.entries(CHAIN_FIXTURES).map(([name, links]) => [
      name,
      reviewDivergence(chainedRounds(links)),
    ]),
  ) as typeof chainDivergence;
});

Then(
  "1段の連鎖ではwarningを出さず2段以上の連鎖を根から名指しする",
  function () {
    assert.equal(chainDivergence.single.fixRegressionDepth, 1);
    assert.deepEqual(chainWarnings(chainDivergence.single), []);
    assert.equal(chainDivergence.branched.fixRegressionDepth, 2);
    assert.deepEqual(
      chainDivergence.branched.warnings.filter((w) => w.startsWith("修正回帰")),
      [
        "修正回帰が2段以上連鎖しています: R1-01 → R2-01 → R3-01, R1-01 → R2-01 → R3-02。同じ機構へ条件を足して塞がず、判定をその機構に依存させない縮小案（許可list化、入力全体の走査、fail-closed、機能の撤回）を先に評価してください",
      ],
    );
    /** 長い連鎖の途中までの連鎖を重ねて名指ししない。 */
    assert.equal(chainDivergence.deep.fixRegressionDepth, 3);
    assert.deepEqual(chainWarnings(chainDivergence.deep), [
      "修正回帰が2段以上連鎖しています: R1-01 → R2-01 → R3-01 → R4-01",
    ]);
    /** 循環は打ち切り、無限loopにしない。 */
    assert.equal(chainDivergence.cyclic.fixRegressionDepth, 1);
  },
);
