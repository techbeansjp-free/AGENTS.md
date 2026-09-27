import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { buildShadowEvaluation } from "../../src/adapters/shadow-evaluation.js";
import {
  buildMetricsReport,
  appendMetricsEvent,
} from "../../src/adapters/metrics-journal.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { QUESTIONS, type ModeAnswer } from "../../src/domain/mode.js";
import assert from "node:assert/strict";
import {
  evaluateShadowRecords,
  type EvaluationInput,
} from "../../src/domain/shadow-evaluation.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";
interface EvaluationWorld extends WorkflowWorld {
  root: string;
  staging: string;
  directory: string;
  original: string[];
  evaluated?: ReturnType<typeof buildShadowEvaluation>;
  metrics?: ReturnType<typeof buildMetricsReport>;
  cliResults: ReturnType<typeof spawnSync>[];
}
const { Given, When, Then } = stepDefinitions<EvaluationWorld>();
function sample(staging = "a", count = 20): EvaluationInput {
  return {
    staging,
    unavailable: false,
    diagnostics: [],
    decisions: Array.from({ length: count }, (_, i) => ({
      decisionRecordId: `DR-${i.toString(16).padStart(16, "0")}`,
      decisionTypeId: "DCAND-010",
      inputDigest: "a".repeat(64),
      subjectRef: "SECRET",
      candidateHeadSha: "a".repeat(40),
      executor: {
        kind: "provider" as const,
        target: "lightweight-tier" as const,
      },
      providerModel: "SECRET-MODEL",
      providerVersion: "v1",
      proposedValue: "not-minor",
      effectiveValue: "not-minor",
      authorityMode: "one-way-escalation" as const,
      adjudicationReason: "SECRET",
      latencyMs: 2,
      cost: 0,
      decidedAt: "2026-09-28T00:00:00.000Z",
    })),
    shadows: Array.from({ length: count }, (_, i) => ({
      decisionRecordId: `DR-${i.toString(16).padStart(16, "0")}`,
      decisionTypeId: "DCAND-010",
      candidateHeadSha: "a".repeat(40),
      primaryProposedValue: "not-minor",
      primaryAuthorityMode: "one-way-escalation" as const,
      jevModel: "SECRET-JEV",
      jevResolvedModel: "SECRET-RESOLVED",
      jevProposedValue: "minor",
      jevConfidence: 0.9,
      outcomeKind: "ok" as const,
      outcomeDetail: null,
      matchesPrimaryProposedValue: false,
      inputTokens: 3,
      outputTokens: 1,
      latencyMs: 10,
      dispatchedAt: "2026-09-28T00:00:00.000Z",
    })),
    labels: Array.from({ length: count }, (_, i) => ({
      decisionRecordId: `DR-${i.toString(16).padStart(16, "0")}`,
      referenceValue: "minor",
      labelSource: "independent-review" as const,
      evidenceRefs: ["SECRET"],
      labeledAt: "2026-09-28T00:01:00.000Z",
    })),
  };
}
Then("別stagingの同じ判断IDを混同せずshadow評価を再現する", function () {
  const a = sample(),
    b = sample("b");
  const before = JSON.stringify([a, b]);
  const r = evaluateShadowRecords([a, b]);
  assert.equal(r.totals.compared, 40);
  assert.deepEqual(r, evaluateShadowRecords([b, a]));
  assert.equal(JSON.stringify([a, b]), before);
  assert.ok(!JSON.stringify(r).includes("SECRET"));
});
Then("重複と孤立と不整合を除外し汚染stagingを分離する", function () {
  for (const kind of [
    "duplicate",
    "orphan",
    "head",
    "type",
    "proposal",
    "authority",
  ]) {
    const a = sample();
    if (kind === "duplicate") a.shadows.push(a.shadows[0]!);
    if (kind === "orphan")
      a.shadows[0] = {
        ...a.shadows[0]!,
        decisionRecordId: "DR-ffffffffffffffff",
      };
    if (kind === "head")
      a.shadows[0] = { ...a.shadows[0]!, candidateHeadSha: "b".repeat(40) };
    if (kind === "type")
      a.shadows[0] = { ...a.shadows[0]!, decisionTypeId: "DCAND-008" };
    if (kind === "proposal")
      a.shadows[0] = { ...a.shadows[0]!, primaryProposedValue: "minor" };
    if (kind === "authority")
      a.shadows[0] = { ...a.shadows[0]!, primaryAuthorityMode: "advisory" };
    const r = evaluateShadowRecords([a]);
    assert.equal(r.totals.compared, 19, kind);
    assert.ok(r.diagnostics.length > 0, kind);
  }
  const dirty = sample("dirty");
  dirty.unavailable = true;
  const r = evaluateShadowRecords([dirty, sample()]);
  assert.equal(r.totals.compared, 20);
  assert.equal(r.groups[0]!.jev.accuracy, 1);
});
Then(
  "referenceを正解として十九件と二十件の精度と分母ゼロを区別する",
  function () {
    const small = evaluateShadowRecords([sample("a", 19)]).groups[0]!;
    assert.equal(small.jev.accuracy, null);
    assert.equal(small.status, "insufficient-evidence");
    const full = evaluateShadowRecords([sample()]).groups[0]!;
    assert.equal(full.jev.accuracy, 1);
    assert.equal(full.primary.accuracy, 0);
    assert.equal(
      full.jev.classes.find((x) => x.value === "not-minor")!.precision,
      null,
    );
    const empty = evaluateShadowRecords([]);
    assert.equal(empty.totals.labelCoverage, null);
    const missing = sample();
    missing.labels = [];
    assert.equal(evaluateShadowRecords([missing]).totals.compared, 0);
  },
);
Then("shadow失敗tokenとconfidence校正の欠測を区別する", function () {
  const a = sample();
  a.shadows.push({
    ...a.shadows[0]!,
    decisionRecordId: "DR-ffffffffffffffff",
    outcomeKind: "network-error",
    jevProposedValue: null,
    jevConfidence: null,
    jevResolvedModel: null,
    inputTokens: 0,
    outputTokens: 0,
  });
  a.decisions.push({
    ...a.decisions[0]!,
    decisionRecordId: "DR-ffffffffffffffff",
  });
  const r = evaluateShadowRecords([a]);
  assert.equal(r.totals.failed, 1);
  assert.equal(r.totals.inputTokens.count, 20);
  assert.equal(r.totals.inputTokens.sum, 60);
  assert.equal(r.totals.inputTokens.missing, 1);
  assert.equal(
    r.groups.find((g) => g.compared === 20)!.calibration.bins[4]!
      .observedAccuracy,
    1,
  );
  assert.equal(r.primaryInferenceLatencyMs, null);
  assert.equal(r.cost, null);
  for (const c of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    const b = sample();
    b.shadows = b.shadows.map((s) => ({ ...s, jevConfidence: c }));
    const bins = evaluateShadowRecords([b]).groups[0]!.calibration.bins;
    assert.equal(bins[Math.min(4, Math.floor(c * 5))]!.n, 20);
  }
});

Given("二十件の参照値付きshadow評価記録を用意する", function () {
  this.value = sample();
});
When("shadow記録の評価を生成する", function () {
  this.value = evaluateShadowRecords([this.value as EvaluationInput]);
});

const evaluationFiles = [
  "events.jsonl",
  "jev-shadow.jsonl",
  "evaluation-labels.jsonl",
];
function saveSample(root: string, id: string, records = sample(id)) {
  const directory = path.join(root, ".agent-skill-chain/runtime/decisions", id);
  fs.mkdirSync(directory, { recursive: true });
  [records.decisions, records.shadows, records.labels].forEach((rows, i) =>
    fs.writeFileSync(
      path.join(directory, evaluationFiles[i]!),
      rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
    ),
  );
  return directory;
}
function bytes(directory: string) {
  return evaluationFiles.map((f) =>
    fs.readFileSync(path.join(directory, f), "utf8"),
  );
}
Given("隔離repositoryにshadow評価journalを用意する", function () {
  this.root = this.initRepo();
  this.staging = createIssueStaging(this.root, {
    title: "評価日本語",
    requestedMode: "quick",
    now: new Date("2026-09-28T00:00:00.000Z"),
    answers: Object.fromEntries(
      QUESTIONS.map((q) => [
        q,
        { answer: true, evidence: "隔離fixture" } satisfies ModeAnswer,
      ]),
    ),
  }).path;
  this.directory = saveSample(this.root, path.basename(this.staging));
  this.original = bytes(this.directory);
  this.cliResults = [];
});
When("別worktreeから重複指定を含めshadow評価を読む", function () {
  const worktree = path.join(this.temp(), "candidate");
  execFileSync("git", ["worktree", "add", "--detach", worktree, "HEAD"], {
    cwd: this.root,
    stdio: "ignore",
  });
  saveSample(worktree, path.basename(this.staging), sample("candidate", 1));
  this.evaluated = buildShadowEvaluation({
    root: worktree,
    stagings: [path.basename(this.staging), path.basename(this.staging)],
  });
});
Then(
  "入力を変えずprimary記録を一度だけ評価し安全でない読取りを拒否する",
  function () {
    assert.equal(this.evaluated?.totals.compared, 20);
    assert.equal(this.evaluated?.targets.length, 1);
    assert.deepEqual(bytes(this.directory), this.original);
    const evaluate = () =>
      buildShadowEvaluation({
        root: this.root,
        stagings: [path.basename(this.staging)],
      });
    const shadowFile = path.join(this.directory, evaluationFiles[1]!);
    const backup = shadowFile + ".backup";
    fs.renameSync(shadowFile, backup);
    fs.symlinkSync(backup, shadowFile);
    assert.throws(evaluate, /unsafe-path/u);
    fs.unlinkSync(shadowFile);
    fs.linkSync(backup, shadowFile);
    assert.throws(evaluate, /unsafe-path/u);
    fs.unlinkSync(shadowFile);
    fs.renameSync(backup, shadowFile);
    const moved = this.directory + "-backup";
    fs.renameSync(this.directory, moved);
    fs.symlinkSync(moved, this.directory);
    assert.throws(evaluate, /unsafe-path/u);
    fs.unlinkSync(this.directory);
    fs.renameSync(moved, this.directory);
    fs.appendFileSync(shadowFile, "SECRET invalid JSON\n");
    assert.equal(evaluate().targets[0]!.status, "unavailable");
    assert.equal(evaluate().totals.compared, 0);
    fs.writeFileSync(shadowFile, this.original[1]!);
    for (const patch of [
      { jevConfidence: 1.01 },
      { inputTokens: 0.5 },
      { latencyMs: -1 },
      { candidateHeadSha: "SECRET" },
      { jevResolvedModel: null },
      { dispatchedAt: "invalid" },
      { unknown: "SECRET" },
    ]) {
      const input = sample();
      input.shadows[0] = { ...input.shadows[0]!, ...patch };
      saveSample(this.root, path.basename(this.staging), input);
      const result = evaluate();
      assert.equal(result.totals.compared, 19);
      assert.ok(!JSON.stringify(result).includes("SECRET"));
    }
    evaluationFiles.forEach((f, i) =>
      fs.writeFileSync(path.join(this.directory, f), this.original[i]!),
    );
    const originalRead = fs.readFileSync;
    let changed = false;
    fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
      const result = Reflect.apply(originalRead, fs, args);
      if (typeof args[0] === "number" && !changed) {
        changed = true;
        fs.appendFileSync(shadowFile, "\n");
      }
      return result;
    }) as typeof fs.readFileSync;
    try {
      const result = evaluate();
      assert.equal(result.targets[0]!.status, "unavailable");
      assert.ok(result.diagnostics.some((d) => d.code === "source-changed"));
    } finally {
      fs.readFileSync = originalRead;
      fs.writeFileSync(shadowFile, this.original[1]!);
    }
    assert.deepEqual(bytes(this.directory), this.original);
  },
);
When("既存metricsへshadow評価を合成する", function () {
  this.metrics = buildMetricsReport({ staging: this.staging });
});
Then("shadow集計と既存時間およびnullをそれぞれ維持する", function () {
  assert.equal(this.metrics?.support_ms, null);
  assert.equal(this.metrics?.artifact_build_ms, null);
  assert.deepEqual(
    this.metrics?.shadow,
    buildShadowEvaluation({ root: this.root, stagings: [this.staging] }),
  );
  appendMetricsEvent({
    staging: this.staging,
    kind: "role",
    phase: "start",
    label: "implementer",
    now: "2026-09-28T00:00:00.000Z",
  });
  appendMetricsEvent({
    staging: this.staging,
    kind: "role",
    phase: "end",
    label: "implementer",
    now: "2026-09-28T00:00:01.000Z",
  });
  const before = buildMetricsReport({ staging: this.staging });
  const input = sample();
  input.shadows = input.shadows.map((s) => ({ ...s, latencyMs: 100000 }));
  saveSample(this.root, path.basename(this.staging), input);
  const after = buildMetricsReport({ staging: this.staging });
  assert.equal(after.support_ms, before.support_ms);
  assert.equal(after.role_ms, before.role_ms);
  assert.equal(after.artifact_build_ms, 1000);
  assert.notEqual(
    after.shadow.totals.latencyMs.sum,
    before.shadow.totals.latencyMs.sum,
  );
});
When("公開CLIで正常と不正のshadow評価を要求する", function () {
  const run = (args: string[]) =>
    spawnSync(
      process.execPath,
      [
        path.resolve("dist/bin/agent-skill-chain.js"),
        "decision",
        "evaluate",
        `--root=${this.root}`,
        ...args,
      ],
      { encoding: "utf8" },
    );
  this.cliResults.push(
    run([
      `--staging=${path.basename(this.staging)}`,
      `--staging=${path.basename(this.staging)}`,
    ]),
    run(["--staging=missing"]),
    run(["--staging=../SECRET"]),
    run([`--staging=${path.basename(this.staging)}`, "--apply"]),
    run(["--staging=SECRET\u0001"]),
  );
  const file = path.join(this.directory, evaluationFiles[0]!);
  fs.appendFileSync(file, "SECRET invalid JSON\n");
  this.cliResults.push(run([`--staging=${path.basename(this.staging)}`]));
  fs.writeFileSync(file, this.original[0]!);
});
Then("安全なJSONと終了値を返し秘密も入力変更も生じない", function () {
  assert.deepEqual(
    this.cliResults.map((r) => r.status),
    [0, 0, 1, 1, 1, 0],
  );
  for (const r of this.cliResults) {
    assert.ok(!String(r.stdout).includes("SECRET"));
    assert.ok(!String(r.stderr).includes("SECRET"));
    JSON.parse(String(r.stdout));
  }
  assert.equal(
    (
      JSON.parse(String(this.cliResults[0]!.stdout)) as ReturnType<
        typeof buildShadowEvaluation
      >
    ).totals.compared,
    20,
  );
  assert.equal(
    (
      JSON.parse(String(this.cliResults[5]!.stdout)) as ReturnType<
        typeof buildShadowEvaluation
      >
    ).targets[0]!.status,
    "unavailable",
  );
  assert.deepEqual(bytes(this.directory), this.original);
});
