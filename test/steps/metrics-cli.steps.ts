import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { main } from "../../src/cli.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import {
  calculateStagingDigest,
  listStagingArtifacts,
} from "../../src/domain/staging.js";
import { stagingRepositoryRoot } from "../../src/domain/staging-layout.js";
import { appendWorkflowJournalEntry } from "../../src/adapters/workflow-journal.js";
import type { ModeAnswer } from "../../src/domain/mode.js";
import { advanceReviewSession } from "../../src/domain/review-convergence.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface MetricsCliWorld extends WorkflowWorld {
  staging: string;
  stagingDigestBefore: string;
  lastStatus: number;
  lastStdout: string;
  report: Record<string, unknown>;
  grepMatches: string[];
  reviewSessionRelativePath: string;
  temporaryReviewSessionPath: string | undefined;
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

Given("隔離issue stagingを用意しstaging digestを記録する", function () {
  const root = this.temp();
  const created = createIssueStaging(root, {
    title: "metrics-digest-fixture",
    answers: quickAnswers(),
    now: new Date("2026-09-25T00:00:00.000Z"),
    requestedMode: "quick",
  });
  this.staging = created.path;
  this.stagingDigestBefore = calculateStagingDigest(
    this.staging,
    listStagingArtifacts(this.staging),
  );
});

When("workflow markを1回実行する", async function () {
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

Then("staging digestはworkflow markの前後で変化しない", function () {
  // 独立reviewのH1指摘: metrics event logがstaging配下にあった旧実装では、
  // このdigestがworkflow markのたびに変化し、workflow record --step=10や
  // review artifact等のstaging digest一致検査を壊していた。
  // workflow recordはdigestを自己修復してしまい判別力が無いため
  // （round2独立reviewの指摘）、staging digestそのものの不変性を直接検証する。
  const stagingDigestAfter = calculateStagingDigest(
    this.staging,
    listStagingArtifacts(this.staging),
  );
  assert.equal(stagingDigestAfter, this.stagingDigestBefore);
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

Given(
  "journal付きの隔離issue stagingでrole=implementerがopen状態である",
  async function () {
    const root = this.temp();
    const created = createIssueStaging(root, {
      title: "metrics-cli-inv03-fixture",
      answers: quickAnswers(),
      now: new Date("2026-09-25T00:00:00.000Z"),
      requestedMode: "quick",
    });
    this.staging = created.path;
    const markResult = await executeMain([
      "workflow",
      "mark",
      `--staging=${this.staging}`,
      "--kind=role",
      "--phase=start",
      "--label=implementer",
      "--now=2026-09-25T00:00:00.000Z",
    ]);
    assert.equal(markResult.status, 0, markResult.stdout);
  },
);

When("同じkind=roleでstartのworkflow markを試みる", async function () {
  this.error = undefined;
  try {
    await executeMain([
      "workflow",
      "mark",
      `--staging=${this.staging}`,
      "--kind=role",
      "--phase=start",
      "--label=coordinator",
    ]);
  } catch (error) {
    this.error = error;
  }
});

Then("CLI経由でもINV-03により拒否される", function () {
  assert.ok(this.error instanceof Error, "workflow markは拒否されるはずです");
  assert.match((this.error as Error).message, /INV-03/u);
});

Given(
  "journal付きの隔離issue stagingとrelative pathのreview session fileを用意する",
  function () {
    const root = this.temp();
    const created = createIssueStaging(root, {
      title: "metrics-cli-reviewsession-fixture",
      answers: quickAnswers(),
      now: new Date("2026-09-25T00:00:00.000Z"),
      requestedMode: "quick",
    });
    this.staging = created.path;
    this.reviewSessionRelativePath = "review-session.json";
    const reviewSessionAbsolutePath = path.join(
      process.cwd(),
      this.reviewSessionRelativePath,
    );
    // process.cwd()直下へ書く。--review-sessionはCLI利用者が相対pathで
    // 指定できる必要がある（round2独立reviewの新規指摘: 絶対pathへ解決してから
    // realpath比較しないと常に拒否されていた）。testの後始末で削除する。
    this.temporaryReviewSessionPath = reviewSessionAbsolutePath;
    // parseReviewSessionStateは各roundをadvanceReviewSessionで再導出し、
    // 手書きdigestとの完全一致を要求するため、実際にadvanceReviewSessionで
    // 組み立てる（test/steps/metrics.steps.tsの同種fixtureと同じ理由）。
    const state = advanceReviewSession(null, {
      round: 1,
      previousRoundDigest: null,
      anchor: {
        scopeIds: ["scope-1"],
        acceptanceCriteriaIds: ["AC-1482-01"],
        invariantIds: [],
        diffBaseSha: "a".repeat(40),
        initialHeadSha: "b".repeat(40),
        initialDiffDigest: "c".repeat(64),
      },
      candidateHeadSha: "b".repeat(40),
      focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
      findings: [],
    });
    fs.writeFileSync(reviewSessionAbsolutePath, `${JSON.stringify(state)}\n`);
  },
);

When(
  "relative pathの--review-sessionでworkflow metricsを実行する",
  async function () {
    const result = await executeMain([
      "workflow",
      "metrics",
      `--staging=${this.staging}`,
      `--review-session=${this.reviewSessionRelativePath}`,
    ]);
    this.lastStatus = result.status;
    this.lastStdout = result.stdout;
    this.report = JSON.parse(result.stdout) as Record<string, unknown>;
    if (this.temporaryReviewSessionPath)
      fs.rmSync(this.temporaryReviewSessionPath, { force: true });
  },
);

Then("review_roundsがrelative pathからも算出される", function () {
  assert.equal(this.lastStatus, 0, this.lastStdout);
  assert.equal(this.report.review_rounds, 1);
});

Given(
  "journal付きの隔離issue stagingを計測event logなしで用意する",
  function () {
    const root = this.temp();
    const created = createIssueStaging(root, {
      title: "metrics-cli-missinglog-fixture",
      answers: quickAnswers(),
      now: new Date("2026-09-25T00:00:00.000Z"),
      requestedMode: "quick",
    });
    this.staging = created.path;
  },
);

When("計測event logが無い状態でworkflow metricsを実行する", async function () {
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
  "role_msとmodel_msとdeterministic_msとartifact_build_msとsupport_msはunavailableである",
  function () {
    assert.equal(this.lastStatus, 0, this.lastStdout);
    assert.equal(this.report.role_ms, null);
    assert.equal(this.report.model_ms, null);
    assert.equal(this.report.deterministic_ms, null);
    assert.equal(this.report.artifact_build_ms, null);
    assert.equal(this.report.support_ms, null);
    const warnings = this.report.warnings as string[];
    assert.ok(warnings.some((warning) => /がありません/u.test(warning)));
  },
);

Given("journal付きの隔離issue stagingがある", function () {
  const root = this.temp();
  const created = createIssueStaging(root, {
    title: "metrics-cli-out-fixture",
    answers: quickAnswers(),
    now: new Date("2026-09-25T00:00:00.000Z"),
    requestedMode: "quick",
  });
  this.staging = created.path;
});

When("--out付きでworkflow metricsを実行する", async function () {
  const result = await executeMain([
    "workflow",
    "metrics",
    `--staging=${this.staging}`,
    "--out",
  ]);
  this.lastStatus = result.status;
  this.lastStdout = result.stdout;
  this.report = JSON.parse(result.stdout) as Record<string, unknown>;
});

Then(".agent-skill-chain\\/metrics\\/配下へreportが書き込まれる", function () {
  assert.equal(this.lastStatus, 0, this.lastStdout);
  const writtenTo = this.report.writtenTo as string;
  assert.ok(writtenTo, "writtenToが返っていません");
  assert.match(writtenTo, /\.agent-skill-chain[/\\]metrics[/\\]/u);
  assert.ok(fs.existsSync(writtenTo), "書き込み先fileが存在しません");
  const written = JSON.parse(fs.readFileSync(writtenTo, "utf8")) as Record<
    string,
    unknown
  >;
  assert.deepEqual(written.step_ms, this.report.step_ms);
});

Given(
  "計測event logに不正な行を1件書き込んだstagingを用意する",
  async function () {
    const root = this.temp();
    const created = createIssueStaging(root, {
      title: "metrics-cli-malformed-fixture",
      answers: quickAnswers(),
      now: new Date("2026-09-25T00:00:00.000Z"),
      requestedMode: "quick",
    });
    this.staging = created.path;
    const markResult = await executeMain([
      "workflow",
      "mark",
      `--staging=${this.staging}`,
      "--kind=role",
      "--phase=start",
      "--label=implementer",
      "--now=2026-09-25T00:00:00.000Z",
    ]);
    assert.equal(markResult.status, 0, markResult.stdout);
    const repositoryRoot = stagingRepositoryRoot(this.staging);
    const logPath = path.join(
      repositoryRoot,
      ".agent-skill-chain",
      "metrics",
      path.basename(this.staging),
      "events.jsonl",
    );
    fs.appendFileSync(logPath, '{"kind":"role","phase":"start"}\n');
  },
);

When("その状態でworkflow metricsを実行する", async function () {
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
  "role_msはfail-closedでunavailableになり不正行のwarningが含まれる",
  function () {
    // 独立reviewのM2指摘: 不正行をwarningとして無視し残りから部分計算するfail-open
    // ではなく、fileごとfail-closedでunavailableにする（既にlabelが正しく閉じている
    // implementer区間の値も、fileに不正行が1件でもあれば公開しない）。
    assert.equal(this.lastStatus, 0, this.lastStdout);
    assert.equal(this.report.role_ms, null);
    assert.deepEqual(this.report.role_breakdown, {});
    const warnings = this.report.warnings as string[];
    assert.ok(
      warnings.some((warning) => /不正な行/u.test(warning)),
      `warningsに不正行の報告が無い: ${JSON.stringify(warnings)}`,
    );
  },
);
