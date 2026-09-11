import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { main } from "../../src/cli.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { QUESTIONS, type ModeAnswer } from "../../src/domain/mode.js";
import {
  parseStepJournal,
  STEP_JOURNAL_FILE,
} from "../../src/domain/workflow.js";

interface ReconfirmationWorld extends WorkflowWorld {
  staging: string;
  journalLines: string[];
  parseErrors: string[];
  journalBefore: string;
  results: Array<{ label: string; status: number; stdout: string }>;
}

const { Given, When, Then } = stepDefinitions<ReconfirmationWorld>();
const SYNC_DIGEST = "1".repeat(64);

function answers(): Record<string, ModeAnswer> {
  return Object.fromEntries(
    QUESTIONS.map((id) => [id, { answer: true, evidence: `${id}の確認根拠` }]),
  );
}

async function run(
  args: string[],
): Promise<{ status: number; stdout: string }> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let stdout = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    const status = await main(args);
    return { status, stdout };
  } catch (error) {
    return { status: 1, stdout: error instanceof Error ? error.message : "" };
  } finally {
    process.stdout.write = originalWrite;
  }
}

async function record(
  staging: string,
  step: number,
  extra: string[] = [],
): Promise<{ status: number; stdout: string }> {
  const evidence =
    step === 4 || step === 8
      ? `sync digest ${SYNC_DIGEST}`
      : `Step ${step}の証跡`;
  return run([
    "workflow",
    "record",
    `--staging=${staging}`,
    `--step=${step}`,
    "--artifact=00_要求定義.md",
    `--evidence=${evidence}`,
    ...extra,
  ]);
}

function journalOf(staging: string): string {
  return fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE), "utf8");
}

async function stagingRecordedUpTo(
  world: ReconfirmationWorld,
  upTo: number,
): Promise<string> {
  const root = world.temp("asc-reconfirm-");
  fs.mkdirSync(path.join(root, ".agent-skill-chain", "tmp", "issues"), {
    recursive: true,
  });
  const staging = createIssueStaging(root, {
    title: "reconfirm-test",
    answers: answers(),
    now: new Date("2026-09-12T00:00:00Z"),
    requestedMode: "full",
  }).path;
  for (let step = 1; step <= upTo; step += 1) {
    const result = await record(staging, step);
    assert.equal(result.status, 0, `Step ${step}: ${result.stdout}`);
  }
  world.journalBefore = journalOf(staging);
  return staging;
}

Given("Step 0から8まで記録したfull stagingがある", async function () {
  this.staging = await stagingRecordedUpTo(this, 8);
});

Given("Step 0から4まで記録したfull stagingがある", async function () {
  this.staging = await stagingRecordedUpTo(this, 4);
});

When("Step 3を--reconfirm付きで記録する", async function () {
  this.results = [
    {
      label: "step3",
      ...(await record(this.staging, 3, [
        "--reconfirm",
        "--recorded-at=2026-09-12T01:00:00.000Z",
      ])),
    },
  ];
});

When("Step 3を--reconfirmなしで記録する", async function () {
  this.results = [{ label: "step3", ...(await record(this.staging, 3)) }];
});

When("Step 5とStep 10を--reconfirm付きで記録する", async function () {
  this.results = [
    { label: "step5", ...(await record(this.staging, 5, ["--reconfirm"])) },
    {
      label: "step10",
      ...(await record(this.staging, 10, [
        "--reconfirm",
        `--review-session-digest=${SYNC_DIGEST}`,
      ])),
    },
  ];
});

Then("記録は受理されworkflow verifyのoutOfOrderは空である", async function () {
  const [recorded] = this.results;
  assert.equal(recorded?.status, 0, recorded?.stdout);
  const verify = await run([
    "workflow",
    "verify",
    `--staging=${this.staging}`,
    "--up-to=8",
  ]);
  assert.equal(verify.status, 0, verify.stdout);
  const output = JSON.parse(verify.stdout) as {
    valid: boolean;
    completedSteps: number[];
  };
  assert.equal(output.valid, true);
  assert.deepEqual(output.completedSteps, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.doesNotMatch(verify.stdout, /outOfOrder/u);
});

Then(
  "追記entryはreconfirmation trueを持ちjournal行で通常entryと区別できる",
  function () {
    const [recorded] = this.results;
    assert.equal(recorded?.status, 0, recorded?.stdout);
    const output = JSON.parse(recorded?.stdout ?? "") as {
      entry: Record<string, unknown>;
    };
    assert.equal(output.entry.step, 3);
    assert.equal(output.entry.reconfirmation, true);
    const entries = parseStepJournal(journalOf(this.staging)).entries;
    const third = entries.filter((entry) => entry.step === 3);
    assert.equal(third.length, 2);
    assert.equal(third[0]?.reconfirmation, undefined);
    assert.equal(third[1]?.reconfirmation, true);
    assert.equal(entries.filter((entry) => entry.reconfirmation).length, 1);
  },
);

Then("記録はoutOfOrderで拒否されjournalは変わらない", function () {
  const [recorded] = this.results;
  assert.equal(recorded?.status, 1);
  assert.match(recorded?.stdout ?? "", /outOfOrder=(?:[0-9]+,)*8/u);
  assert.equal(journalOf(this.staging), this.journalBefore);
});

Then("両方とも理由を名指しして拒否されjournalは変わらない", function () {
  const step5 = this.results.find((item) => item.label === "step5");
  assert.equal(step5?.status, 1);
  assert.match(
    step5?.stdout ?? "",
    /Step 5の上流再確定entryに先行する通常entryがありません/u,
  );
  const step10 = this.results.find((item) => item.label === "step10");
  assert.equal(step10?.status, 1);
  assert.match(
    step10?.stdout ?? "",
    /--reconfirmはStep 1〜9にだけ指定できます/u,
  );
  assert.equal(journalOf(this.staging), this.journalBefore);
});

function journalLine(step: number, extra: Record<string, unknown>): string {
  return JSON.stringify({
    step,
    skillId: `step-${String(step).padStart(2, "0")}-x`,
    mode: "full",
    recordedAt: "2026-09-12T00:00:00.000Z",
    artifacts: ["00_要求定義.md"],
    evidence: `Step ${step}の証跡`,
    ...extra,
  });
}

Given(
  "reconfirmationにtrue以外の値とStep 10を持つjournal行がある",
  function () {
    this.journalLines = [
      journalLine(3, { reconfirmation: "yes" }),
      journalLine(10, {
        reconfirmation: true,
        reviewSession: {
          sessionId: "a".repeat(64),
          roundDigest: "b".repeat(64),
          headSha: "c".repeat(40),
        },
      }),
    ];
  },
);

When("journalを構造検査する", function () {
  this.parseErrors = parseStepJournal(
    `${this.journalLines.join("\n")}\n`,
  ).errors;
});

Then("両方の行が理由を名指しして拒否される", function () {
  assert.ok(
    this.parseErrors.some((error) =>
      error.includes("reconfirmationはtrueだけを受理します"),
    ),
    this.parseErrors.join("; "),
  );
  assert.ok(
    this.parseErrors.some((error) =>
      error.includes("reconfirmationはStep 1〜9にだけ指定できます"),
    ),
    this.parseErrors.join("; "),
  );
});
