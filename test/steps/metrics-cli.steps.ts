import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { main } from "../../src/cli.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { appendWorkflowJournalEntry } from "../../src/adapters/workflow-journal.js";
import type { ModeAnswer } from "../../src/domain/mode.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface MetricsCliWorld extends WorkflowWorld {
  staging: string;
  lastStatus: number;
  lastStdout: string;
  report: Record<string, unknown>;
  grepMatches: string[];
}

const { Given, When, Then } = stepDefinitions<MetricsCliWorld>();

function quickAnswers(): Record<string, ModeAnswer> {
  return Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => [
      `Q-${String(index + 1).padStart(2, "0")}`,
      { answer: true, evidence: "fixture evidence" },
    ]),
  );
}

async function executeMain(
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
  } finally {
    process.stdout.write = originalWrite;
  }
}

Given("journal付きの隔離issue stagingを用意する", function () {
  const root = this.temp();
  const created = createIssueStaging(root, {
    title: "metrics-cli-fixture",
    answers: quickAnswers(),
    now: new Date("2026-09-25T00:00:00.000Z"),
    requestedMode: "quick",
  });
  this.staging = created.path;
  appendWorkflowJournalEntry({
    staging: this.staging,
    entry: {
      step: 1,
      skillId: "step-01-request",
      mode: "quick",
      recordedAt: "2026-09-25T00:00:00.000Z",
      artifacts: ["00_要求定義.md"],
      evidence: "fixture",
    },
  });
  appendWorkflowJournalEntry({
    staging: this.staging,
    entry: {
      step: 4,
      skillId: "step-04-issue-sync",
      mode: "quick",
      recordedAt: "2026-09-25T00:10:00.000Z",
      artifacts: ["00_要求定義.md"],
      evidence: "sync digest ".padEnd(20, "0") + " sync",
    },
  });
});

Given(
  "role=implementer・role=reviewer・model=codexの計測イベントをworkflow markで記録する",
  async function () {
    const events: Array<[string, string, string, string]> = [
      ["role", "start", "implementer", "2026-09-25T00:00:00.000Z"],
      ["role", "end", "implementer", "2026-09-25T00:00:05.000Z"],
      ["role", "start", "reviewer", "2026-09-25T00:00:05.000Z"],
      ["role", "end", "reviewer", "2026-09-25T00:00:07.000Z"],
      ["model", "start", "codex", "2026-09-25T00:00:00.500Z"],
      ["model", "end", "codex", "2026-09-25T00:00:04.500Z"],
    ];
    for (const [kind, phase, label, now] of events) {
      const result = await executeMain([
        "workflow",
        "mark",
        `--staging=${this.staging}`,
        `--kind=${kind}`,
        `--phase=${phase}`,
        `--label=${label}`,
        `--now=${now}`,
      ]);
      assert.equal(result.status, 0, result.stdout);
    }
  },
);

When("workflow metricsを実行する", async function () {
  const result = await executeMain([
    "workflow",
    "metrics",
    `--staging=${this.staging}`,
  ]);
  this.lastStatus = result.status;
  this.lastStdout = result.stdout;
  this.report = JSON.parse(result.stdout) as Record<string, unknown>;
});

Then(
  "step_msとrole_msとmodel_msとartifact_build_msとsupport_msが算出される",
  function () {
    assert.equal(this.lastStatus, 0, this.lastStdout);
    const report = this.report as {
      step_ms: Array<{ step: number; ms: number }>;
      role_ms: number | null;
      model_ms: number | null;
      role_breakdown: Record<string, number>;
      model_breakdown: Record<string, number>;
      artifact_build_ms: number | null;
      support_ms: number | null;
    };
    const step4 = report.step_ms.find((entry) => entry.step === 4);
    assert.ok(step4, "step=4のentryが無い");
    assert.equal(step4!.ms, 10 * 60 * 1000);
    assert.equal(report.role_ms, 7000);
    assert.equal(report.role_breakdown.implementer, 5000);
    assert.equal(report.role_breakdown.reviewer, 2000);
    assert.equal(report.model_ms, 4000);
    assert.equal(report.model_breakdown.codex, 4000);
    assert.equal(report.artifact_build_ms, 5000);
    assert.equal(report.support_ms, 10 * 60 * 1000 - 5000);
  },
);

Given(
  "journal\\/steps.jsonlにStep9が2回記録されたstagingを用意する",
  function () {
    const root = this.temp();
    const created = createIssueStaging(root, {
      title: "metrics-duplicate-step-fixture",
      answers: quickAnswers(),
      now: new Date("2026-09-25T00:00:00.000Z"),
      requestedMode: "quick",
    });
    this.staging = created.path;
    appendWorkflowJournalEntry({
      staging: this.staging,
      entry: {
        step: 1,
        skillId: "step-01-request",
        mode: "quick",
        recordedAt: "2026-09-25T00:00:00.000Z",
        artifacts: ["00_要求定義.md"],
        evidence: "fixture",
      },
    });
    appendWorkflowJournalEntry({
      staging: this.staging,
      entry: {
        step: 4,
        skillId: "step-04-issue-sync",
        mode: "quick",
        recordedAt: "2026-09-25T00:02:00.000Z",
        artifacts: ["00_要求定義.md"],
        evidence: "sync digest ".padEnd(20, "0") + " sync",
      },
    });
    appendWorkflowJournalEntry({
      staging: this.staging,
      entry: {
        step: 9,
        skillId: "step-09-implement",
        mode: "quick",
        recordedAt: "2026-09-25T00:05:00.000Z",
        artifacts: ["00_要求定義.md"],
        evidence: "first",
        implementationHeadSha: "a".repeat(40),
      },
    });
    appendWorkflowJournalEntry({
      staging: this.staging,
      entry: {
        step: 9,
        skillId: "step-09-implement",
        mode: "quick",
        recordedAt: "2026-09-25T00:20:00.000Z",
        artifacts: ["00_要求定義.md"],
        evidence: "second (re-recorded)",
        implementationHeadSha: "b".repeat(40),
      },
    });
  },
);

When("workflow metricsのstep_msを取得する", async function () {
  const result = await executeMain([
    "workflow",
    "metrics",
    `--staging=${this.staging}`,
  ]);
  this.lastStatus = result.status;
  this.lastStdout = result.stdout;
  this.report = JSON.parse(result.stdout) as Record<string, unknown>;
});

Then("step_msはStep9の両entryを縮約せず保持する", function () {
  assert.equal(this.lastStatus, 0, this.lastStdout);
  const report = this.report as {
    step_ms: Array<{ step: number; ms: number }>;
  };
  const step9Entries = report.step_ms.filter((entry) => entry.step === 9);
  // 独立reviewのH2指摘: 以前の実装はStep番号をkeyにしたRecordへ縮約し、
  // 同じStepの再記録・reconfirmで先行entryのmsを無言で上書きしていた。
  assert.equal(
    step9Entries.length,
    2,
    "Step9の2 entryが両方とも保持されているはずです",
  );
  assert.equal(step9Entries[0]!.ms, 3 * 60 * 1000);
  assert.equal(step9Entries[1]!.ms, 15 * 60 * 1000);
});

Given("隔離issue stagingでworkflow markを1回実行済みである", async function () {
  const root = this.temp();
  const created = createIssueStaging(root, {
    title: "metrics-digest-fixture",
    answers: quickAnswers(),
    now: new Date("2026-09-25T00:00:00.000Z"),
    requestedMode: "quick",
  });
  this.staging = created.path;
  const markResult = await executeMain([
    "workflow",
    "mark",
    `--staging=${this.staging}`,
    "--kind=deterministic",
    "--phase=start",
    "--label=npm-test",
    "--now=2026-09-25T00:00:00.000Z",
  ]);
  assert.equal(markResult.status, 0, markResult.stdout);
});

When("同じstagingへworkflow recordでStep1を記録する", async function () {
  const result = await executeMain([
    "workflow",
    "record",
    `--staging=${this.staging}`,
    "--step=1",
    "--evidence=fixture after mark",
    "--artifact=00_要求定義.md",
    "--recorded-at=2026-09-25T00:01:00.000Z",
  ]);
  this.lastStatus = result.status;
  this.lastStdout = result.stdout;
});

Then("workflow recordはstaging digest不一致を起こさず成功する", function () {
  // 独立reviewのH1指摘: metrics event logがstaging配下にあった旧実装では、
  // ここでstaging digest不一致により失敗していた。
  assert.equal(this.lastStatus, 0, this.lastStdout);
  assert.doesNotMatch(this.lastStdout, /digestが一致しません/u);
});

Given("repository rootを対象にする", function () {
  this.grepMatches = [];
});

When("repository全体でmetrics既存資産の誤情報をgrepする", function () {
  const patterns = [
    "metrics/`が既存資産",
    "metrics/は既存資産",
    "metricsは既存資産",
    "metrics/がすでに存在する実装",
  ];
  const matches: string[] = [];
  for (const pattern of patterns) {
    try {
      const output = execFileSync(
        "git",
        [
          "grep",
          "-n",
          "-F",
          pattern,
          "--",
          ".",
          ":!memo",
          // このfile自身は誤情報の判定patternを文字列literalとして保持するため、
          // 自己一致を対象外にする（判定対象は本file以外の全repository）。
          ":!test/steps/metrics-cli.steps.ts",
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      if (output.trim() !== "") matches.push(...output.trim().split("\n"));
    } catch (error) {
      // git grepはmatchが無いとexit 1を返す。実行時errorだけ再送する。
      const status = (error as { status?: number }).status;
      if (status !== 1) throw error;
    }
  }
  this.grepMatches = matches;
});

Then("memo配下以外に一致は無い", function () {
  assert.deepEqual(this.grepMatches, []);
});

When("制御文字を含むlabelでworkflow markを試みる", async function () {
  this.error = undefined;
  try {
    await executeMain([
      "workflow",
      "mark",
      `--staging=${this.staging}`,
      "--kind=role",
      "--phase=start",
      "--label=bad\u0007label",
    ]);
  } catch (error) {
    this.error = error;
  }
});

Then("workflow markは拒否される", function () {
  assert.ok(this.error instanceof Error, "workflow markは拒否されるはずです");
  assert.match((this.error as Error).message, /制御文字/u);
});
