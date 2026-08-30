import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import {
  POC_HIGH_RISK_IDS,
  classifyMode,
  type ModeAnswer,
  type PocDeclaration,
} from "../../src/domain/mode.js";
import {
  createIssueStaging,
  planPocPromotion,
  validateIssue,
} from "../../src/domain/issue.js";
import {
  POC_OBSERVATION_SCHEMA,
  pocDeclarationDigest,
  pocObservationEvidenceDigest,
  pocObservationResultDigest,
  pocObservationArtifact,
  pocScenarioExecutionDigest,
  validatePocObservationEvidence,
  type PocObservationEvidence,
  type PocObservationResult,
  type PocScenarioExecution,
} from "../../src/domain/poc-observation.js";
import {
  appendDeliveryTerminalJournalEntry,
  appendWorkflowJournalEntry,
  assertPocDeliveryChangeScope,
  calculatePocFixtureDigest,
  executePocObservation,
} from "../../src/adapters/workflow-journal.js";
import {
  STEP_JOURNAL_FILE,
  WORKFLOW_STEPS,
  parseStepJournal,
} from "../../src/domain/workflow.js";
import {
  calculateStagingDigest,
  listStagingArtifacts,
  readStoredStagingRecord,
} from "../../src/domain/staging.js";
import {
  observeReviewDiff,
  readStoredReviewSession,
} from "../../src/adapters/review-session.js";
import { main } from "../../src/cli.js";

interface PocModeWorld extends WorkflowWorld {
  answers: Record<string, ModeAnswer>;
  declaration: PocDeclaration;
  issue: ReturnType<typeof createIssueStaging>;
  legacyModes: string[];
  modeResult: ReturnType<typeof classifyMode>;
  promotion: ReturnType<typeof planPocPromotion>;
  quickIssue: ReturnType<typeof createIssueStaging>;
  root: string;
  validations: Array<ReturnType<typeof validateIssue>>;
  headSha: string;
  observationSource: string;
}

const { Given, When, Then } = stepDefinitions<PocModeWorld>();

function completeAnswers(): Record<string, ModeAnswer> {
  return Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => [
      `Q-${String(index + 1).padStart(2, "0")}`,
      { answer: true, evidence: `根拠${index + 1}` },
    ]),
  );
}

function completeDeclaration(): PocDeclaration {
  return {
    purpose: "検索仮説を隔離fixtureで即時検証する",
    fixture: {
      id: "FIX-SEARCH",
      root: "test/fixtures/poc/search",
      isolationEvidence: "一時directoryと合成dataだけを使用する",
      resetEvidence: "fixture digestを実行前後に再確認する",
      runner: {
        id: "RUN-SEARCH",
        path: "runner.mjs",
      },
    },
    useCases: [
      {
        id: "UC-SEARCH",
        actor: "試験利用者",
        goal: "検索結果から対象を選択する",
      },
    ],
    scenarios: [
      {
        id: "SCN-SEARCH",
        useCaseId: "UC-SEARCH",
        given: "隔離fixtureに合成dataがある",
        when: "定義済み検索runnerを実行する",
        then: "期待する候補を構造化出力する",
        argv: [],
      },
    ],
    observables: [
      {
        id: "OBS-SEARCH-EXIT",
        scenarioId: "SCN-SEARCH",
        kind: "exit-code",
        expected: 0,
      },
      {
        id: "OBS-SEARCH-STDOUT",
        scenarioId: "SCN-SEARCH",
        kind: "stdout-digest",
        expected: crypto
          .createHash("sha256")
          .update('{"selected":"fixture-1"}\n')
          .digest("hex"),
      },
    ],
    outOfScope: "正式提供と本番データ",
    successCriteria: "試験利用者5名中4名が完了する",
    abortCriteria: "情報漏えいriskまたは期限超過を検出する",
    owner: "PoC責任者",
    highRisk: POC_HIGH_RISK_IDS.map((id) => ({
      id,
      present: false,
      evidence: `${id}を対象外と確認済み`,
    })),
  };
}

function materializePocFixture(
  root: string,
  declaration: PocDeclaration,
): void {
  const fixture = path.join(root, declaration.fixture.root);
  fs.mkdirSync(fixture, { recursive: true });
  const runner = path.join(fixture, declaration.fixture.runner.path);
  fs.writeFileSync(
    runner,
    'process.stdout.write(\'{"selected":"fixture-1"}\\n\');\n',
    { mode: 0o600 },
  );
}

function initializePocRepository(root: string): string {
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["config", "user.name", "poc-test"],
    ["config", "user.email", "poc-test@example.invalid"],
  ]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  fs.writeFileSync(path.join(root, "README.md"), "# PoC baseline\n");
  for (const args of [
    ["add", "README.md"],
    ["commit", "-q", "-m", "poc baseline"],
  ]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  return spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).stdout.trim();
}

function commitPocFixture(root: string, declaration: PocDeclaration): string {
  materializePocFixture(root, declaration);
  for (const args of [
    ["add", declaration.fixture.root],
    ["commit", "-q", "-m", "poc fixture"],
  ]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  return spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).stdout.trim();
}

function observationSource(
  declaration: PocDeclaration,
  headSha: string,
  overrides: Partial<
    Omit<PocObservationEvidence, "evidenceDigest" | "results">
  > & { results?: PocObservationResult[] } = {},
): string {
  const results = overrides.results ?? [
    ...declaration.observables.map((observable) => {
      const resultIdentity: Omit<PocObservationResult, "resultDigest"> = {
        observableId: observable.id,
        scenarioId: observable.scenarioId,
        kind: observable.kind,
        target: observable.target ?? null,
        expected: observable.expected,
        actual: observable.expected,
        status: "passed",
      };
      return {
        ...resultIdentity,
        resultDigest: pocObservationResultDigest(resultIdentity),
      };
    }),
  ];
  const executions: PocScenarioExecution[] = declaration.scenarios.map(
    ({ id }) => {
      const execution = { scenarioId: id, exitCode: 0, signal: null };
      return {
        ...execution,
        executionDigest: pocScenarioExecutionDigest(execution),
      };
    },
  );
  const identity: Omit<PocObservationEvidence, "evidenceDigest"> = {
    schemaVersion: POC_OBSERVATION_SCHEMA,
    declarationDigest: pocDeclarationDigest(declaration),
    headSha,
    observedAt: "2026-08-25T00:00:02.000Z",
    fixture: {
      id: declaration.fixture.id,
      root: declaration.fixture.root,
      digest: "b".repeat(64),
    },
    runner: { ...declaration.fixture.runner, digest: "a".repeat(64) },
    executions,
    results,
    ...overrides,
  };
  return `${JSON.stringify({
    ...identity,
    evidenceDigest: pocObservationEvidenceDigest(identity),
  })}\n`;
}

function pocEntry(step: number) {
  const definition = WORKFLOW_STEPS.find((item) => item.step === step);
  assert.ok(definition);
  return {
    step,
    skillId: definition.skillId,
    mode: "poc" as const,
    recordedAt: "2026-08-25T00:00:03.000Z",
    artifacts: [`artifact-${step}`],
    evidence: `step ${step} Evidence`,
  };
}

Given("完全でhigh riskのないPoC宣言がある", function () {
  this.answers = completeAnswers();
  this.declaration = completeDeclaration();
});

Given("PoC宣言の全必須欄が記入済みである", function () {
  assert.ok(this.declaration.purpose);
  assert.equal(this.declaration.highRisk.length, POC_HIGH_RISK_IDS.length);
});

Given("従来判定用のQ-01〜Q-08回答がある", function () {
  this.answers = completeAnswers();
});

When("pocを明示してモード判定する", function () {
  this.modeResult = classifyMode(this.answers, {
    requestedMode: "poc",
    poc: this.declaration,
  });
});

Then("PoC判定結果はpocである", function () {
  assert.equal(this.modeResult.mode, "poc");
});

Then("PoC判定理由は0件である", function () {
  assert.deepEqual(this.modeResult.reasons, []);
});

Given("PoC宣言の目的が欠落している", function () {
  this.declaration.purpose = "";
});

Given("personal-dataのhigh risk確認が不明である", function () {
  this.declaration.highRisk = this.declaration.highRisk.filter(
    (risk) => risk.id !== "personal-data",
  );
});

Then("PoC判定結果はfullである", function () {
  assert.equal(this.modeResult.mode, "full");
});

Then("PoC判定理由に目的とpersonal-dataが含まれる", function () {
  const reasons = this.modeResult.reasons.join(" ");
  assert.match(reasons, /目的/u);
  assert.match(reasons, /personal-data/u);
});

Given("external-exposureのhigh risk条件が存在する", function () {
  const risk = this.declaration.highRisk.find(
    (entry) => entry.id === "external-exposure",
  );
  assert.ok(risk);
  risk.present = true;
});

Then("PoC判定理由にexternal-exposureとfull昇格が含まれる", function () {
  const reasons = this.modeResult.reasons.join(" ");
  assert.match(reasons, /external-exposure/u);
  assert.match(reasons, /full.*昇格/u);
});

When("fullからpocへの途中降格を要求する", function () {
  this.modeResult = classifyMode(this.answers, {
    requestedMode: "poc",
    currentMode: "full",
    poc: completeDeclaration(),
  });
});

Given("PoCの変更fileに{string}がある", function (file: string) {
  this.value = [file];
});

When("変更fileを含めてpocを明示判定する", function () {
  assert.ok(Array.isArray(this.value));
  const changedFiles = this.value.filter(
    (entry): entry is string => typeof entry === "string",
  );
  this.modeResult = classifyMode(this.answers, {
    requestedMode: "poc",
    poc: this.declaration,
    changedFiles,
  });
});

Then("PoC判定理由にpublic-apiが含まれる", function () {
  assert.match(this.modeResult.reasons.join(" "), /public-api/u);
});

When("第2引数なしで従来の完全回答と不明回答を判定する", function () {
  const incomplete = completeAnswers();
  incomplete["Q-08"] = { answer: "unknown", evidence: "未確認" };
  this.legacyModes = [
    classifyMode(completeAnswers()).mode,
    classifyMode(incomplete).mode,
  ];
});

Then("従来判定はquickとfullである", function () {
  assert.deepEqual(this.legacyModes, ["quick", "full"]);
});

Given("PoC宣言のfixtureとscenarioとobservableが不完全である", function () {
  this.declaration.fixture.root = "fixtures/.git/escape";
  this.declaration.scenarios = [];
  this.declaration.observables = [];
});

Then(
  "PoC判定理由に隔離fixtureとBDD scenarioとobservableが含まれる",
  function () {
    const reasons = this.modeResult.reasons.join(" ");
    assert.match(reasons, /隔離fixture/u);
    assert.match(reasons, /BDD scenario/u);
    assert.match(reasons, /observable/u);
  },
);

Given("完全なPoC即時観測Evidenceがある", function () {
  this.headSha = "c".repeat(40);
  this.observationSource = observationSource(this.declaration, this.headSha);
});

When("PoC即時観測Evidenceを宣言とHEADへ完全照合する", function () {
  this.value = validatePocObservationEvidence({
    source: this.observationSource,
    declaration: this.declaration,
    headSha: this.headSha,
  });
});

Then("PoC即時観測Evidenceは有効である", function () {
  assert.equal((this.value as { valid: boolean }).valid, true);
});

When("PoC即時観測Evidenceのfixture digestとHEADとfieldを改変する", function () {
  const parsed = JSON.parse(this.observationSource) as Record<string, unknown>;
  const fixture = parsed.fixture as Record<string, unknown>;
  fixture.digest = "d".repeat(64);
  parsed.headSha = "e".repeat(40);
  parsed.unknown = true;
  this.value = validatePocObservationEvidence({
    source: `${JSON.stringify(parsed)}\n`,
    declaration: this.declaration,
    headSha: this.headSha,
  });
});

Then("PoC即時観測Evidenceはstrictに拒否される", function () {
  const checked = this.value as { valid: boolean; errors: string[] };
  assert.equal(checked.valid, false);
  assert.match(checked.errors.join(" "), /field集合|digest|HEAD/u);
});

Given("fixture file境界を検査する隔離directoryがある", function () {
  this.root = this.temp("asc-poc-invalid-fixture-");
});

When("不正なfixture file種別とbyte上限を検査する", function () {
  const fixture = this.root;
  const regular = path.join(fixture, "regular.txt");
  fs.writeFileSync(regular, "fixture\n");
  assert.match(calculatePocFixtureDigest(fixture), /^[a-f0-9]{64}$/u);

  const hardlink = path.join(fixture, "hardlink.txt");
  fs.linkSync(regular, hardlink);
  assert.throws(() => calculatePocFixtureDigest(fixture), /hardlink/u);
  fs.unlinkSync(hardlink);

  const symlink = path.join(fixture, "symlink.txt");
  fs.symlinkSync("regular.txt", symlink);
  assert.throws(() => calculatePocFixtureDigest(fixture), /symlink/u);
  fs.unlinkSync(symlink);

  const fifo = path.join(fixture, "fifo");
  const created = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
  assert.equal(created.status, 0, created.stderr);
  assert.throws(
    () => calculatePocFixtureDigest(fixture),
    /通常fileとdirectory/u,
  );
  fs.unlinkSync(fifo);

  fs.writeFileSync(
    path.join(fixture, "huge.bin"),
    Buffer.alloc(1024 * 1024 + 1),
  );
  assert.throws(() => calculatePocFixtureDigest(fixture), /上限/u);
  this.value = true;
});

Then("PoC fixture境界はすべてfail-closedになる", function () {
  assert.equal(this.value, true);
});

Given("PoC宣言にexit-code observableしかない", function () {
  this.declaration.observables = this.declaration.observables.filter(
    ({ kind }) => kind === "exit-code",
  );
});

Then("PoC判定理由にbehavior observableが含まれる", function () {
  assert.match(this.modeResult.reasons.join(" "), /behavior observable/u);
});

Given("PoC検証用の隔離repositoryと完全宣言がある", function () {
  this.root = this.temp("asc-poc-int-");
  this.answers = completeAnswers();
  this.declaration = completeDeclaration();
  this.headSha = initializePocRepository(this.root);
});

Given("PoCの最小stagingを生成する条件が揃っている", function () {
  assert.equal(fs.statSync(this.root).isDirectory(), true);
  assert.equal(
    this.declaration.highRisk.every((risk) => !risk.present),
    true,
  );
});

When("pocのissue stagingを作成する", function () {
  this.issue = createIssueStaging(this.root, {
    title: "検索仮説の検証",
    answers: this.answers,
    requestedMode: "poc",
    poc: this.declaration,
    now: new Date("2026-08-25T00:00:00Z"),
  });
  this.headSha = commitPocFixture(this.root, this.declaration);
});

Given("pocのissue stagingを作成済みである", function () {
  this.issue = createIssueStaging(this.root, {
    title: "検索仮説の検証",
    answers: this.answers,
    requestedMode: "poc",
    poc: this.declaration,
    now: new Date("2026-08-25T00:00:00Z"),
  });
});

Then("stagingのモードはpocである", function () {
  assert.equal(this.issue.mode, "poc");
});

Then("stagingには00要求定義とstaging記録が存在する", function () {
  assert.deepEqual(fs.readdirSync(this.issue.path), [
    "00_モード判定.json",
    "00_要求定義.md",
    "journal",
    "staging-record.json",
  ]);
});

Then(
  "00要求定義に目的と隔離fixtureとuse caseとBDD scenarioとobservableが記録される",
  function () {
    const document = fs.readFileSync(
      path.join(this.issue.path, "00_要求定義.md"),
      "utf8",
    );
    for (const expected of [
      this.declaration.purpose,
      this.declaration.fixture.id,
      this.declaration.fixture.root,
      this.declaration.fixture.runner.id,
      this.declaration.useCases[0]!.id,
      this.declaration.scenarios[0]!.id,
      this.declaration.observables[0]!.id,
      this.declaration.successCriteria,
      this.declaration.abortCriteria,
      this.declaration.outOfScope,
      this.declaration.owner,
    ])
      assert.ok(document.includes(expected), expected);
  },
);

Then("00要求定義の管理情報はpocである", function () {
  const document = fs.readFileSync(
    path.join(this.issue.path, "00_要求定義.md"),
    "utf8",
  );
  assert.match(document, /^\|\s*モード\s*\|\s*`poc`\s*\|\s*$/mu);
});

When("pocでreleaseと自動mergeと本番cleanupを検証する", function () {
  this.validations = ["release", "automatic-merge", "production-cleanup"].map(
    (requestedOperation) =>
      validateIssue(this.issue.path, {
        requestedOperation,
        delivery: { stopAt: "pull_request" },
      }),
  );
});

Then("すべての禁止操作は拒否される", function () {
  assert.ok(this.validations.every((validation) => !validation.valid));
  for (const validation of this.validations)
    assert.match(validation.errors.join(" "), /PoC.*できません/u);
});

Then("PoCの禁止操作一覧が返る", function () {
  for (const validation of this.validations)
    assert.deepEqual(validation.blockedOperations, [
      "release",
      "automatic-merge",
      "production-cleanup",
    ]);
});

When("PoCの正式開発昇格計画を作る", function () {
  this.promotion = planPocPromotion(this.issue.path);
});

Then("fullに不足する01と02と03の成果物が列挙される", function () {
  assert.deepEqual(this.promotion.missing, [
    "01_要件定義.md",
    "02_設計.md",
    "03_実装計画.md",
  ]);
});

Then("昇格根拠と補完理由が返る", function () {
  assert.match(this.promotion.reasons.join(" "), /PoC宣言.*昇格根拠/u);
  assert.match(this.promotion.reasons.join(" "), /補完が必要/u);
});

Given("pocのStep 4までを記録済みである", function () {
  this.issue = createIssueStaging(this.root, {
    title: "検索仮説の即時観測",
    answers: this.answers,
    requestedMode: "poc",
    poc: this.declaration,
    now: new Date("2026-08-25T00:00:00Z"),
  });
  this.headSha = commitPocFixture(this.root, this.declaration);
  for (const step of [1, 4])
    appendWorkflowJournalEntry({
      staging: this.issue.path,
      entry: pocEntry(step),
    });
  this.observationSource = observationSource(this.declaration, this.headSha);
});

When("PoC観測EvidenceなしでStep 9を記録する", function () {
  assert.throws(
    () =>
      appendWorkflowJournalEntry({
        staging: this.issue.path,
        entry: pocEntry(9),
        headSha: this.headSha,
      }),
    /poc-observation/u,
  );
});

Then("Step 9は未記録のままである", function () {
  const parsed = parseStepJournal(
    fs.readFileSync(path.join(this.issue.path, STEP_JOURNAL_FILE), "utf8"),
  );
  assert.equal(
    parsed.entries.some(({ step }) => step === 9),
    false,
  );
});

When("PoC観測Evidenceを固定してStep 9を記録する", function () {
  executePocObservation({
    staging: this.issue.path,
    headSha: this.headSha,
    observedAt: "2026-08-25T00:00:02.000Z",
  });
  appendWorkflowJournalEntry({
    staging: this.issue.path,
    entry: pocEntry(9),
    headSha: this.headSha,
  });
});

Then(
  "Evidenceは世代別inventoryとdigestへ入り同一HEAD再実行で変化しない",
  function () {
    const artifacts = listStagingArtifacts(this.issue.path);
    const stored = readStoredStagingRecord(this.issue.path);
    const artifact = pocObservationArtifact(this.headSha);
    assert.ok(artifacts.includes(artifact));
    assert.equal(
      stored.digest,
      calculateStagingDigest(this.issue.path, artifacts),
    );
    const before = fs.readFileSync(
      path.join(this.issue.path, artifact),
      "utf8",
    );
    const repeated = executePocObservation({
      staging: this.issue.path,
      headSha: this.headSha,
      observedAt: "2026-08-25T00:00:04.000Z",
    });
    const existing = JSON.parse(before) as { evidenceDigest: string };
    assert.equal(repeated.evidenceDigest, existing.evidenceDigest);
    assert.equal(
      fs.readFileSync(path.join(this.issue.path, artifact), "utf8"),
      before,
    );
  },
);

When("PoCをStep 11まで終端して再観測とStep 9追記を試みる", function () {
  executePocObservation({
    staging: this.issue.path,
    headSha: this.headSha,
    observedAt: "2026-08-25T00:00:02.000Z",
  });
  for (const step of [9, 10])
    appendWorkflowJournalEntry({
      staging: this.issue.path,
      entry: {
        ...pocEntry(step),
        ...(step === 10
          ? {
              reviewSession: {
                sessionId: "c".repeat(64),
                roundDigest: "d".repeat(64),
                headSha: this.headSha,
              },
            }
          : {}),
      },
      headSha: this.headSha,
    });
  appendDeliveryTerminalJournalEntry({
    staging: this.issue.path,
    entry: pocEntry(11),
    headSha: this.headSha,
  });
  const journal = fs.readFileSync(
    path.join(this.issue.path, STEP_JOURNAL_FILE),
    "utf8",
  );
  const record = fs.readFileSync(
    path.join(this.issue.path, "staging-record.json"),
    "utf8",
  );
  const evidence = fs.readFileSync(
    path.join(this.issue.path, pocObservationArtifact(this.headSha)),
    "utf8",
  );
  assert.throws(
    () =>
      executePocObservation({
        staging: this.issue.path,
        headSha: this.headSha,
        observedAt: "2026-08-25T00:00:04.000Z",
      }),
    /Step 11/u,
  );
  assert.throws(
    () =>
      appendWorkflowJournalEntry({
        staging: this.issue.path,
        entry: pocEntry(9),
        headSha: this.headSha,
      }),
    /Step 11/u,
  );
  this.value = { journal, record, evidence };
});

Then("終端後のPoC stagingとEvidenceは変化しない", function () {
  const before = this.value as {
    journal: string;
    record: string;
    evidence: string;
  };
  assert.equal(
    fs.readFileSync(path.join(this.issue.path, STEP_JOURNAL_FILE), "utf8"),
    before.journal,
  );
  assert.equal(
    fs.readFileSync(path.join(this.issue.path, "staging-record.json"), "utf8"),
    before.record,
  );
  assert.equal(
    fs.readFileSync(
      path.join(this.issue.path, pocObservationArtifact(this.headSha)),
      "utf8",
    ),
    before.evidence,
  );
});

When("exact HEAD後にrunnerのlive bytesを変更して観測する", function () {
  const before = fs.readFileSync(
    path.join(this.issue.path, "staging-record.json"),
    "utf8",
  );
  fs.appendFileSync(
    path.join(
      this.root,
      this.declaration.fixture.root,
      this.declaration.fixture.runner.path,
    ),
    "// dirty\n",
  );
  assert.throws(
    () =>
      executePocObservation({
        staging: this.issue.path,
        headSha: this.headSha,
        observedAt: "2026-08-25T00:00:04.000Z",
      }),
    /dirty|HEAD.*一致/u,
  );
  this.value = before;
});

When("fixture外のsource変更を同じHEADへcommitして観測する", function () {
  const before = fs.readFileSync(
    path.join(this.issue.path, "staging-record.json"),
    "utf8",
  );
  fs.mkdirSync(path.join(this.root, "src"), { recursive: true });
  fs.writeFileSync(path.join(this.root, "src", "outside.ts"), "export {};\n");
  for (const args of [
    ["add", "src/outside.ts"],
    ["commit", "-q", "-m", "outside fixture"],
  ]) {
    const result = spawnSync("git", args, { cwd: this.root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  this.headSha = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: this.root,
    encoding: "utf8",
  }).stdout.trim();
  assert.throws(
    () =>
      executePocObservation({
        staging: this.issue.path,
        headSha: this.headSha,
        observedAt: "2026-08-25T00:00:04.000Z",
      }),
    /fixture root外/u,
  );
  this.value = before;
});

When("stdout一致のままrunnerを非0終了へ変更して観測する", function () {
  const before = fs.readFileSync(
    path.join(this.issue.path, "staging-record.json"),
    "utf8",
  );
  fs.appendFileSync(
    path.join(
      this.root,
      this.declaration.fixture.root,
      this.declaration.fixture.runner.path,
    ),
    "process.exitCode = 1;\n",
  );
  for (const args of [
    ["add", this.declaration.fixture.root],
    ["commit", "-q", "-m", "nonzero runner"],
  ]) {
    const result = spawnSync("git", args, { cwd: this.root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  this.headSha = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: this.root,
    encoding: "utf8",
  }).stdout.trim();
  assert.throws(
    () =>
      executePocObservation({
        staging: this.issue.path,
        headSha: this.headSha,
        observedAt: "2026-08-25T00:00:04.000Z",
      }),
    /不合格/u,
  );
  this.value = before;
});

Then("PoC観測はpublishせずfail-closedになる", function () {
  assert.equal(
    fs.readFileSync(path.join(this.issue.path, "staging-record.json"), "utf8"),
    this.value,
  );
  assert.equal(
    fs.existsSync(
      path.join(this.issue.path, pocObservationArtifact(this.headSha)),
    ),
    false,
  );
});

When(
  "provider baseからfixture-only差分と起票前fixture外commitを検査する",
  function () {
    const baseSha = spawnSync("git", ["rev-parse", `${this.headSha}^`], {
      cwd: this.root,
      encoding: "utf8",
    }).stdout.trim();
    assert.deepEqual(
      assertPocDeliveryChangeScope(this.issue.path, baseSha, this.headSha),
      [`${this.declaration.fixture.root}/runner.mjs`],
    );

    const launderingRoot = this.temp("asc-poc-base-laundering-");
    const trustedBase = initializePocRepository(launderingRoot);
    fs.mkdirSync(path.join(launderingRoot, "src"));
    fs.writeFileSync(
      path.join(launderingRoot, "src", "security.ts"),
      "export const insecure = true;\n",
    );
    for (const args of [
      ["add", "src/security.ts"],
      ["commit", "-q", "-m", "pre-issue outside change"],
    ]) {
      const result = spawnSync("git", args, {
        cwd: launderingRoot,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
    }
    const declaration = completeDeclaration();
    const issue = createIssueStaging(launderingRoot, {
      title: "baseline laundering",
      answers: completeAnswers(),
      requestedMode: "poc",
      poc: declaration,
      now: new Date("2026-08-25T00:00:00Z"),
    });
    const headSha = commitPocFixture(launderingRoot, declaration);
    assert.throws(
      () => assertPocDeliveryChangeScope(issue.path, trustedBase, headSha),
      /fixture root外/u,
    );
    this.value = true;
  },
);

Then("provider baseのactual diffだけがPoC scopeのEvidenceになる", function () {
  assert.equal(this.value, true);
});

Given("quickとpocを実行する隔離ディレクトリがある", function () {
  this.root = this.temp("asc-poc-e2e-");
  initializePocRepository(this.root);
});

When("公開staging経路からquickとpocを生成する", function () {
  const answers = completeAnswers();
  this.quickIssue = createIssueStaging(this.root, {
    title: "quick",
    answers,
    now: new Date("2026-08-25T00:00:00Z"),
  });
  this.issue = createIssueStaging(this.root, {
    title: "poc",
    answers,
    requestedMode: "poc",
    poc: completeDeclaration(),
    now: new Date("2026-08-25T00:00:01Z"),
  });
});

function e2eOutput(world: PocModeWorld): {
  quick: { mode: string; files: string[]; text: string };
  poc: { mode: string; files: string[]; text: string };
} {
  return {
    quick: {
      mode: world.quickIssue.mode,
      files: fs.readdirSync(world.quickIssue.path),
      text: fs.readFileSync(
        path.join(world.quickIssue.path, "00_要求定義.md"),
        "utf8",
      ),
    },
    poc: {
      mode: world.issue.mode,
      files: fs.readdirSync(world.issue.path),
      text: fs.readFileSync(
        path.join(world.issue.path, "00_要求定義.md"),
        "utf8",
      ),
    },
  };
}

Then("quickとpocはどちらも00要求定義とstaging記録を生成する", function () {
  const output = e2eOutput(this);
  assert.equal(output.quick.mode, "quick");
  assert.equal(output.poc.mode, "poc");
  assert.deepEqual(output.quick.files, [
    "00_モード判定.json",
    "00_要求定義.md",
    "journal",
    "staging-record.json",
  ]);
  assert.deepEqual(output.poc.files, [
    "00_モード判定.json",
    "00_要求定義.md",
    "journal",
    "staging-record.json",
  ]);
});

Then("quickにはPoC宣言がなくpocにはPoC宣言と停止点がある", function () {
  const output = e2eOutput(this);
  assert.doesNotMatch(output.quick.text, /PoC宣言/u);
  assert.match(output.poc.text, /PoC宣言/u);
  assert.match(output.poc.text, /release、自動merge、本番cleanupは禁止/u);
});

Given("PoC即時観測用の隔離Git repositoryがある", async function () {
  this.root = this.temp("asc-poc-observation-e2e-");
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["config", "user.name", "poc-test"],
    ["config", "user.email", "poc-test@example.invalid"],
  ]) {
    const result = spawnSync("git", args, { cwd: this.root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  fs.writeFileSync(path.join(this.root, "README.md"), "# fixture\n");
  for (const args of [
    ["add", "README.md"],
    ["commit", "-q", "-m", "fixture"],
  ]) {
    const result = spawnSync("git", args, { cwd: this.root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  this.answers = completeAnswers();
  this.declaration = completeDeclaration();
  const input = this.temp("asc-poc-cli-input-");
  const assessment = path.join(input, "assessment.json");
  const declaration = path.join(input, "poc-declaration.json");
  fs.writeFileSync(assessment, JSON.stringify(this.answers));
  fs.writeFileSync(declaration, JSON.stringify(this.declaration));
  assert.equal(
    await main(
      [
        "issue",
        "create",
        `--root=${this.root}`,
        "--title=poc-observation-e2e",
        "--mode=poc",
        `--assessment=${assessment}`,
        `--poc-declaration=${declaration}`,
      ],
      { now: () => new Date("2026-08-25T00:00:00Z") },
    ),
    0,
  );
  const stagingRoot = path.join(
    this.root,
    ".agent-skill-chain",
    "tmp",
    "issues",
  );
  const staging = fs.readdirSync(stagingRoot);
  assert.equal(staging.length, 1);
  this.issue = {
    path: path.join(stagingRoot, staging[0]!),
    mode: "poc",
    reasons: [],
    durable: false,
    synced: false,
  };
  materializePocFixture(this.root, this.declaration);
  for (const args of [
    ["add", this.declaration.fixture.root],
    ["commit", "-q", "-m", "poc implementation"],
  ]) {
    const result = spawnSync("git", args, { cwd: this.root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  this.headSha = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: this.root,
    encoding: "utf8",
  }).stdout.trim();
  this.observationSource = observationSource(this.declaration, this.headSha);
});

When("公開CLIでPoC観測Evidenceを固定してStep 10まで進める", async function () {
  const relativeStaging = path.relative(this.root, this.issue.path);
  assert.equal(
    await main(
      [
        "workflow",
        "poc-observation",
        `--root=${this.root}`,
        `--staging=${relativeStaging}`,
        "--apply",
      ],
      { now: () => new Date("2026-08-25T00:00:02.000Z") },
    ),
    0,
  );
  for (const step of [1, 4, 9])
    assert.equal(
      await main([
        "workflow",
        "record",
        `--staging=${this.issue.path}`,
        `--step=${step}`,
        `--artifact=artifact-${step}`,
        `--evidence=step-${step}`,
        "--recorded-at=2026-08-25T00:00:03.000Z",
      ]),
      0,
    );
  const baseSha = spawnSync("git", ["rev-parse", `${this.headSha}^`], {
    cwd: this.root,
    encoding: "utf8",
  }).stdout.trim();
  const observed = observeReviewDiff(this.root, baseSha, this.headSha);
  const reviewRoundFile = path.join(
    this.temp("asc-poc-review-round-"),
    "round.json",
  );
  fs.writeFileSync(
    reviewRoundFile,
    JSON.stringify({
      round: 1,
      previousRoundDigest: null,
      anchor: {
        scopeIds: ["SCOPE-POC-FIXTURE"],
        acceptanceCriteriaIds: ["AC-POC-OBSERVATION"],
        invariantIds: [],
        diffBaseSha: baseSha,
        initialHeadSha: this.headSha,
        initialDiffDigest: observed.digest,
      },
      candidateHeadSha: this.headSha,
      focus: {
        previousBlocking: [],
        fixedDiff: [],
        adjacentScope: [],
      },
      findings: [],
    }),
  );
  assert.equal(
    await main([
      "review",
      "round",
      `--staging=${this.issue.path}`,
      `--file=${reviewRoundFile}`,
      "--apply",
    ]),
    0,
  );
  const reviewSession = readStoredReviewSession(this.issue.path);
  assert.ok(reviewSession);
  assert.equal(
    await main([
      "workflow",
      "record",
      `--staging=${this.issue.path}`,
      "--step=10",
      "--artifact=artifact-10",
      "--evidence=step-10",
      `--review-session-digest=${reviewSession.latestRoundDigest}`,
      "--recorded-at=2026-08-25T00:00:03.000Z",
    ]),
    0,
  );
});

Then(
  "公開CLIは待機期間なしでexact HEADのPoC Evidenceをgateにする",
  function () {
    const parsed = parseStepJournal(
      fs.readFileSync(path.join(this.issue.path, STEP_JOURNAL_FILE), "utf8"),
    );
    assert.deepEqual(
      parsed.entries.map(({ step }) => step),
      [0, 1, 4, 9, 10],
    );
    const stored = JSON.parse(
      fs.readFileSync(
        path.join(this.issue.path, pocObservationArtifact(this.headSha)),
        "utf8",
      ),
    ) as PocObservationEvidence;
    assert.equal(stored.headSha, this.headSha);
    assert.equal(
      stored.fixture.digest,
      calculatePocFixtureDigest(
        path.join(this.root, this.declaration.fixture.root),
      ),
    );
  },
);
