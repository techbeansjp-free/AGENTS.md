import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { assertCurrentReviewJournalBinding, main } from "../../src/cli.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { QUESTIONS, type ModeAnswer } from "../../src/domain/mode.js";
import {
  parseReviewRoundInput,
  type ReviewSessionState,
} from "../../src/domain/review-convergence.js";
import {
  assertConvergedReviewSession,
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

interface EvidenceOnlyHeadWorld extends WorkflowWorld {
  root: string;
  staging: string;
  base: string;
  implementationHead: string;
  finalHead: string;
  session: ReviewSessionState;
  error: unknown;
  cliStatus: number;
}

const { Given, When, Then } = stepDefinitions<EvidenceOnlyHeadWorld>();
const repositoryRoot = process.cwd();
const instant = new Date("2026-09-11T00:00:00.000Z");
const reviewedPath = "src/domain/review.ts";
const artifactPath = "docs/reviews/1_課題1272レビュー.md";

function answers(): Record<string, ModeAnswer> {
  return Object.fromEntries(
    QUESTIONS.map((id) => [id, { answer: true, evidence: `${id}の固定証拠` }]),
  );
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function commitFiles(
  root: string,
  files: Record<string, string>,
  message: string,
): string {
  for (const [relative, source] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
    git(root, ["add", relative]);
  }
  git(root, ["commit", "-q", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

function workflowEntry(step: number): StepJournalEntry {
  const definition = WORKFLOW_STEPS.find((item) => item.step === step);
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

/** 収束済みsession（round 1、finding無し）をH_implで作る */
function convergedFixture(world: EvidenceOnlyHeadWorld): void {
  world.root = world.initRepo();
  world.base = git(world.root, ["rev-parse", "HEAD"]);
  world.implementationHead = commitFiles(
    world.root,
    { [reviewedPath]: "export const reviewed = 1;\n" },
    "feat: implementation",
  );
  world.staging = createIssueStaging(world.root, {
    title: "evidence-only-head",
    answers: answers(),
    now: instant,
    requestedMode: "quick",
  }).path;
  for (const step of [1, 4, 9])
    appendWorkflowJournalEntry({
      staging: world.staging,
      entry: workflowEntry(step),
    });
  const observed = observeReviewDiff(
    world.root,
    world.base,
    world.implementationHead,
  );
  world.session = recordReviewRound({
    staging: world.staging,
    round: parseReviewRoundInput({
      round: 1,
      previousRoundDigest: null,
      anchor: {
        scopeIds: ["SCOPE-001"],
        acceptanceCriteriaIds: ["AC-001"],
        invariantIds: [],
        diffBaseSha: world.base,
        initialHeadSha: world.implementationHead,
        initialDiffDigest: observed.digest,
      },
      candidateHeadSha: world.implementationHead,
      focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
      findings: [],
    }),
  });
  assert.equal(world.session.status, "converged");
}

function assertSession(world: EvidenceOnlyHeadWorld): void {
  world.error = undefined;
  try {
    assertConvergedReviewSession({
      staging: world.staging,
      expectedDigest: world.session.latestRoundDigest,
      currentHeadSha: world.finalHead,
    });
  } catch (error) {
    world.error = error;
  }
}

Given(
  "収束したsessionの後にartifact 1 fileだけをcommitしたstagingがある",
  function () {
    convergedFixture(this);
    this.finalHead = commitFiles(
      this.root,
      { [artifactPath]: "# 04 レビュー\n" },
      "docs: review artifact",
    );
  },
);

When("H_finalでconverged session検査とbinding検査を行う", function () {
  assertSession(this);
  assert.equal(this.error, undefined, String(this.error));
  appendWorkflowJournalEntry({
    staging: this.staging,
    entry: {
      ...workflowEntry(10),
      reviewSession: {
        sessionId: this.session.sessionId,
        roundDigest: this.session.latestRoundDigest,
        headSha: this.session.latestCandidateHeadSha,
      },
    },
  });
  try {
    assertCurrentReviewJournalBinding(this.staging, this.finalHead);
  } catch (error) {
    this.error = error;
  }
});

Then("両方が受理される", function () {
  assert.equal(this.error, undefined, String(this.error));
});

When("CLIでStep 10を記録する", async function () {
  this.cliStatus = await captureMain([
    "workflow",
    "record",
    `--staging=${this.staging}`,
    "--step=10",
    `--artifact=${artifactPath}`,
    "--evidence=artifact commit後のH_finalで記録",
    `--review-session-digest=${this.session.latestRoundDigest}`,
    `--recorded-at=${instant.toISOString()}`,
  ]);
});

Then("記録は成功しbinding.headShaはsessionのcandidate HEADである", function () {
  assert.equal(this.cliStatus, 0);
  const step10 = readWorkflowJournal(this.staging)
    .entries.filter(({ step }) => step === 10)
    .at(-1);
  assert.equal(step10?.reviewSession?.headSha, this.implementationHead);
  assert.notEqual(step10?.reviewSession?.headSha, this.finalHead);
});

Given(
  "収束したsessionの後にartifactとsrcをcommitしたstagingがある",
  function () {
    convergedFixture(this);
    this.finalHead = commitFiles(
      this.root,
      {
        [artifactPath]: "# 04 レビュー\n",
        [reviewedPath]: "export const reviewed = 2;\n",
      },
      "docs: review artifact and a product change",
    );
  },
);

Given(
  "収束したsessionの後にsrc 1 fileだけをcommitしたstagingがある",
  function () {
    convergedFixture(this);
    this.finalHead = commitFiles(
      this.root,
      { [reviewedPath]: "export const reviewed = 2;\n" },
      "fix: product change without review",
    );
  },
);

Given("収束したsessionの後に空commitを積んだstagingがある", function () {
  convergedFixture(this);
  git(this.root, ["commit", "-q", "--allow-empty", "-m", "chore: empty"]);
  this.finalHead = git(this.root, ["rev-parse", "HEAD"]);
});

Given(
  "収束したsessionの後に別branchでartifactをcommitしたstagingがある",
  function () {
    convergedFixture(this);
    /**
     * treeはH_impl＋artifactと同一だが、H_implをancestorに持たないcommitを作る。
     * 差分の件数・allowlistだけでは区別できず、ancestor検査だけが拒否する。
     */
    git(this.root, ["checkout", "-q", "-b", "other", this.base]);
    git(this.root, ["cherry-pick", this.implementationHead]);
    /**
     * cherry-pickは元commitのauthor dateとmessageを保つため、同一秒内に
     * 作るとH_implと同じSHAになりancestorに化ける。messageを変えて別commitにする。
     */
    git(this.root, [
      "commit",
      "-q",
      "--amend",
      "-m",
      "feat: implementation (cherry-picked)",
    ]);
    assert.notEqual(
      git(this.root, ["rev-parse", "HEAD"]),
      this.implementationHead,
    );
    this.finalHead = commitFiles(
      this.root,
      { [artifactPath]: "# 04 レビュー\n" },
      "docs: artifact on another branch",
    );
  },
);

When("H_finalでconverged session検査を行う", function () {
  assertSession(this);
});

Then("candidate HEADがcurrent HEADと一致しないerrorで拒否する", function () {
  assert.ok(this.error instanceof Error, "拒否を期待した");
  assert.equal(
    this.error.message,
    "review sessionのcandidate HEADがcurrent HEADと一致しません",
  );
});

Given("規範文書01とstep-10 skillがある", function () {
  assert.ok(
    fs.existsSync(
      path.join(
        repositoryRoot,
        ".agent-skill-chain/docs/01_開発ワークフロー.md",
      ),
    ),
  );
});

When("規範文書01とstep-10 skillを読む", function () {
  this.error = undefined;
});

Then("artifact 1 fileのcommitに取り直しroundは要らない旨がある", function () {
  const read = (relative: string): string =>
    fs.readFileSync(path.join(repositoryRoot, relative), "utf8");
  assert.match(
    read(".agent-skill-chain/docs/01_開発ワークフロー.md"),
    /review artifact 1 fileだけを加えるHEAD移動.*には取り直しroundを要求しない/u,
  );
  assert.match(
    read(".agent-skill-chain/skills/step-10-review/SKILL.md"),
    /このartifact commitに対する取り直しroundは要らない/u,
  );
});
