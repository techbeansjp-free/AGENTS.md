import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  computeEventDurationsMs,
  computeMetricsWindowMs,
  computeReviewRounds,
  computeStepDurationsMs,
  computeSupportArtifactSplit,
  parseMetricsEventLine,
  validateNextMetricsEvent,
  type MetricsEvent,
} from "../../src/domain/metrics.js";
import {
  advanceReviewSession,
  parseReviewSessionState,
} from "../../src/domain/review-convergence.js";
import type { StepJournalEntry } from "../../src/domain/workflow.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface MetricsWorld extends WorkflowWorld {
  stepEntries: StepJournalEntry[];
  metricsEvents: MetricsEvent[];
  stepDurations: ReturnType<typeof computeStepDurationsMs>;
  reviewRounds: number;
  eventDurations: ReturnType<typeof computeEventDurationsMs>;
  windowMs: number;
  split: ReturnType<typeof computeSupportArtifactSplit>;
  transitionResult: ReturnType<typeof validateNextMetricsEvent>;
  metricsImportViolations: string[];
  parseMetricsEventLineResult: ReturnType<typeof parseMetricsEventLine>;
}

const { Given, When, Then } = stepDefinitions<MetricsWorld>();

function baseStepEntry(step: number, recordedAt: string): StepJournalEntry {
  return {
    step,
    skillId: `step-${String(step).padStart(2, "0")}-fixture`,
    mode: "full",
    recordedAt,
    artifacts: ["fixture.md"],
    evidence: "fixture evidence",
  };
}

Given("空の計測用worldを準備する", function () {
  this.stepEntries = [];
  this.metricsEvents = [];
});

Given(
  "journal\\/steps.jsonlにStep1・Step2・Step4のentryが記録済みである",
  function () {
    this.stepEntries = [
      baseStepEntry(1, "2026-09-25T00:00:00.000Z"),
      baseStepEntry(2, "2026-09-25T00:05:00.000Z"),
      baseStepEntry(4, "2026-09-25T00:12:00.000Z"),
    ];
  },
);

Given("journal\\/steps.jsonlのentryが0件である", function () {
  this.stepEntries = [];
});

Given("journal\\/steps.jsonlのentryが1件だけである", function () {
  this.stepEntries = [baseStepEntry(1, "2026-09-25T00:00:00.000Z")];
});

When("対象journalのstep_msを算出する", function () {
  this.stepDurations = computeStepDurationsMs(this.stepEntries);
});

Then("step_msはStep間のrecordedAt差分と一致する", function () {
  assert.deepEqual(
    this.stepDurations.map((entry) => ({ step: entry.step, ms: entry.ms })),
    [
      { step: 2, ms: 5 * 60 * 1000 },
      { step: 4, ms: 7 * 60 * 1000 },
    ],
  );
});

Then("step_msは空集合である", function () {
  assert.equal(this.stepDurations.length, 0);
});

Given(
  "rounds 3件のうち1件がfollowOnly、1件がrecordLayerOnlyのreview session stateである",
  function () {
    // parseReviewSessionStateは各roundをadvanceReviewSessionで再導出し、
    // 手書きdigestとの完全一致を要求する。手書きのroundDigestは受理されないため、
    // 実際にadvanceReviewSessionを3回適用して有効なstateを組み立てる。
    const anchor = {
      scopeIds: ["scope-1"],
      acceptanceCriteriaIds: ["AC-1482-01"],
      invariantIds: ["INV-01"],
      diffBaseSha: "a".repeat(40),
      initialHeadSha: "b".repeat(40),
      initialDiffDigest: "c".repeat(64),
    };
    const round1Focus = {
      previousBlocking: [],
      fixedDiff: [],
      adjacentScope: [],
    };
    let state = advanceReviewSession(null, {
      round: 1,
      previousRoundDigest: null,
      anchor,
      candidateHeadSha: "b".repeat(40),
      focus: round1Focus,
      findings: [],
    });
    // round1はfindingsが無いため即collapse convergeする。収束後の追加roundは
    // 異なるcandidate HEADと空でないfixedDiffを要求する（advanceReviewSession）。
    const followOnFocus = {
      previousBlocking: [],
      fixedDiff: ["docs/reviews/fixture.md"],
      adjacentScope: [],
    };
    state = advanceReviewSession(state, {
      round: 2,
      previousRoundDigest: state.latestRoundDigest,
      anchor,
      candidateHeadSha: "e".repeat(40),
      focus: followOnFocus,
      findings: [],
      followOnly: true,
    });
    state = advanceReviewSession(state, {
      round: 3,
      previousRoundDigest: state.latestRoundDigest,
      anchor,
      candidateHeadSha: "f".repeat(40),
      focus: followOnFocus,
      findings: [],
      recordLayerOnly: true,
    });
    this.value = parseReviewSessionState(
      JSON.parse(JSON.stringify(state)) as unknown,
    );
  },
);

When("review_roundsを算出する", function () {
  this.reviewRounds = computeReviewRounds(
    this.value as ReturnType<typeof parseReviewSessionState>,
  );
});

Then("review_roundsは1である", function () {
  assert.equal(this.reviewRounds, 1);
});

Given(
  "kind=roleでlabel=implementerの計測イベントがopen状態である",
  function () {
    this.metricsEvents = [
      {
        kind: "role",
        phase: "start",
        label: "implementer",
        recordedAt: "2026-09-25T00:00:00.000Z",
      },
    ];
  },
);

When("同じkind=roleでstartの新規イベントを検証する", function () {
  this.transitionResult = validateNextMetricsEvent(this.metricsEvents, {
    kind: "role",
    phase: "start",
    label: "coordinator",
  });
});

Then("INV-03により拒否される", function () {
  assert.equal(this.transitionResult.ok, false);
  if (this.transitionResult.ok === false)
    assert.match(this.transitionResult.reason, /INV-03/u);
});

Given("kind=modelの計測イベントはidle状態である", function () {
  this.metricsEvents = [];
});

When("同じkind=modelでendの新規イベントを検証する", function () {
  this.transitionResult = validateNextMetricsEvent(this.metricsEvents, {
    kind: "model",
    phase: "end",
    label: "codex",
  });
});

Then("INV-04により拒否される", function () {
  assert.equal(this.transitionResult.ok, false);
  if (this.transitionResult.ok === false)
    assert.match(this.transitionResult.reason, /INV-04/u);
});

Given(
  "kind=roleでlabel=implementerが1000ms、label=reviewerが500ms記録済みのイベント系列である",
  function () {
    this.metricsEvents = [
      {
        kind: "role",
        phase: "start",
        label: "implementer",
        recordedAt: "2026-09-25T00:00:00.000Z",
      },
      {
        kind: "role",
        phase: "end",
        label: "implementer",
        recordedAt: "2026-09-25T00:00:01.000Z",
      },
      {
        kind: "role",
        phase: "start",
        label: "reviewer",
        recordedAt: "2026-09-25T00:00:01.000Z",
      },
      {
        kind: "role",
        phase: "end",
        label: "reviewer",
        recordedAt: "2026-09-25T00:00:01.500Z",
      },
    ];
  },
);

Given("計測window全体が2000msである", function () {
  // computeMetricsWindowMsが実際に使う対象（journal/steps.jsonlのentry）から
  // 2000msの経過を再現し、windowMsをハードコードせず算出させる。
  this.stepEntries = [
    baseStepEntry(1, "2026-09-25T00:00:00.000Z"),
    baseStepEntry(2, "2026-09-25T00:00:02.000Z"),
  ];
});

When("support_msとartifact_build_msを算出する", function () {
  this.eventDurations = computeEventDurationsMs(this.metricsEvents);
  this.windowMs = computeMetricsWindowMs({
    stepEntries: this.stepEntries,
    eventEntries: this.metricsEvents,
  });
  this.split = computeSupportArtifactSplit({
    windowMs: this.windowMs,
    roleByLabel: this.eventDurations.byLabel,
    roleOpen: this.eventDurations.openKinds.includes("role"),
  });
});

Then("artifact_build_msは1000でsupport_msは1000である", function () {
  assert.equal(this.split.artifact_build_ms, 1000);
  assert.equal(this.split.support_ms, 1000);
});

Given(
  "kind=roleでlabel=implementerが開いたままのイベント系列である",
  function () {
    this.metricsEvents = [
      {
        kind: "role",
        phase: "start",
        label: "implementer",
        recordedAt: "2026-09-25T00:00:00.000Z",
      },
    ];
    this.stepEntries = [
      baseStepEntry(1, "2026-09-25T00:00:00.000Z"),
      baseStepEntry(2, "2026-09-25T00:00:02.000Z"),
    ];
  },
);

Then("artifact_build_msとsupport_msはunavailableである", function () {
  assert.equal(this.split.artifact_build_ms, null);
  assert.equal(this.split.support_ms, null);
});

Given(
  "kind=deterministicのstartだけが記録され対応するendが無いイベント系列である",
  function () {
    this.metricsEvents = [
      {
        kind: "deterministic",
        phase: "start",
        label: "npm-test",
        recordedAt: "2026-09-25T00:00:00.000Z",
      },
    ];
  },
);

When("role_ms・model_ms・deterministic_msを算出する", function () {
  this.eventDurations = computeEventDurationsMs(this.metricsEvents);
});

Then("deterministic_msの合計は0でunavailable警告が1件以上ある", function () {
  assert.equal(this.eventDurations.totals.deterministic ?? 0, 0);
  assert.ok(this.eventDurations.warnings.length >= 1);
});

Given("repository rootのsrc\\/domain\\/metrics.tsを対象にする", function () {
  this.metricsImportViolations = [];
});

When("src\\/domain\\/metrics.tsの依存importを検査する", function () {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/domain/metrics.ts"),
    "utf8",
  );
  // 複数行importでも取りこぼさないよう、`from "..."`のspecifierだけを
  // 全文から抽出する（行単位の正規表現は改行をまたぐimportを見逃す）。
  const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map(
    (match) => match[1] ?? "",
  );
  this.metricsImportViolations = specifiers.filter(
    (specifier) =>
      specifier.includes("../adapters/") || specifier.endsWith("../cli.js"),
  );
});

Then("src\\/adapters配下とsrc\\/cli.tsへのimportは無い", function () {
  assert.deepEqual(this.metricsImportViolations, []);
});

Given("kind=roleでlabelがROLES列挙値でないイベント行である", function () {
  this.value = {
    kind: "role",
    phase: "start",
    label: "Implementer",
    recordedAt: "2026-09-25T00:00:00.000Z",
  };
});

When("その行をparseする", function () {
  this.parseMetricsEventLineResult = parseMetricsEventLine(this.value, 1);
});

Then("ROLES列挙値エラーで拒否される", function () {
  const result = this.parseMetricsEventLineResult;
  assert.ok(result);
  assert.equal(result.entry, undefined);
  assert.ok(result.errors.some((error) => /ROLES列挙値/u.test(error)));
});

Given("kind=modelでlabel=codexがopen状態（start=00:00:05）である", function () {
  this.metricsEvents = [
    {
      kind: "model",
      phase: "start",
      label: "codex",
      recordedAt: "2026-09-25T00:00:05.000Z",
    },
  ];
});

When("startより前の時刻でendの新規イベントを検証する", function () {
  this.transitionResult = validateNextMetricsEvent(this.metricsEvents, {
    kind: "model",
    phase: "end",
    label: "codex",
    recordedAt: "2026-09-25T00:00:01.000Z",
  });
});

Then("時間逆行として拒否される", function () {
  assert.equal(this.transitionResult.ok, false);
  if (this.transitionResult.ok === false)
    assert.match(this.transitionResult.reason, /時間逆行/u);
});

Given(
  "journal\\/steps.jsonlの範囲外に計測イベントがあるfixtureである",
  function () {
    // stepEntriesは[00:00:05, 00:00:10]（span=5000ms）、
    // eventEntriesは[00:00:00]（stepより前）1件だけを持つ。
    // 個別spanのmaxだと5000msのままだが、合わせた集合の最古〜最新は
    // 00:00:00〜00:00:10で10000msになるはずである。
    this.stepEntries = [
      baseStepEntry(1, "2026-09-25T00:00:05.000Z"),
      baseStepEntry(2, "2026-09-25T00:00:10.000Z"),
    ];
    this.metricsEvents = [
      {
        kind: "deterministic",
        phase: "start",
        label: "npm-test",
        recordedAt: "2026-09-25T00:00:00.000Z",
      },
    ];
  },
);

When("計測windowを算出する", function () {
  this.windowMs = computeMetricsWindowMs({
    stepEntries: this.stepEntries,
    eventEntries: this.metricsEvents,
  });
});

Then("計測windowは合わせた集合の最古から最新までの10000msである", function () {
  assert.equal(this.windowMs, 10000);
});
