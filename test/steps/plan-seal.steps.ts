import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { assertWorkflowReadyForDelivery, main } from "../../src/cli.js";
import { assertStoredStagingDigestForTest } from "../../src/adapters/review-session.js";
import {
  appendWorkflowJournalEntry,
  assertPlanFrozen,
} from "../../src/adapters/workflow-journal.js";
import {
  assessImplementationDiscovery,
  type ImplementationDiscovery,
} from "../../src/domain/agile-verification.js";
import { DELIVERY_STATE_FILE } from "../../src/domain/delivery-state.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import {
  QUESTIONS,
  type Mode,
  type ModeAnswer,
} from "../../src/domain/mode.js";
import {
  PLAN_AMENDMENT_FILE,
  stagingDriftDiagnostic,
  validatePlanAmendment,
} from "../../src/domain/plan-seal.js";
import { refreshStoredStagingDigest } from "../../src/domain/staging.js";
import {
  parseStepJournal,
  STEP_JOURNAL_FILE,
  validateStepJournal,
  WORKFLOW_STEPS,
  type StepJournalEntry,
} from "../../src/domain/workflow.js";

/**
 * 計画封印（REQ-WF-036）と、それに伴うstaging digest不一致診断（REQ-WF-024）の検査。
 *
 * **封印値は成果物から計算した実digestと突き合わせる。** 件数やkey名だけを見ると、
 * 呼出し側の値をそのまま書く変異や、封印対象を00だけに狭める変異が生存する。
 */
interface PlanSealWorld extends WorkflowWorld {
  root: string;
  staging: string;
  journalBefore: string;
  original: string;
  result: { status: number; stdout: string };
  diagnostic: string;
  amendmentResults: Array<{
    label: string;
    result: ReturnType<typeof validatePlanAmendment>;
  }>;
  parseErrors: string[];
  parsedEntries: StepJournalEntry[];
  discoveries: Record<string, ImplementationDiscovery>;
  discoveryInput: string;
  assessments: Record<string, Record<string, unknown>>;
  drifts: Record<string, string>;
}

const { Given, When, Then } = stepDefinitions<PlanSealWorld>();
const SYNC_DIGEST = "1".repeat(64);
const REQUEST = "00_要求定義.md";
const FULL_PLAN = [
  "00_要求定義.md",
  "01_要件定義.md",
  "02_設計.md",
  "03_実装計画.md",
] as const;

function answers(): Record<string, ModeAnswer> {
  return Object.fromEntries(
    QUESTIONS.map((id) => [id, { answer: true, evidence: `${id}の確認根拠` }]),
  );
}

function sha256File(file: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
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
  return run([
    "workflow",
    "record",
    `--staging=${staging}`,
    `--step=${step}`,
    `--artifact=${REQUEST}`,
    `--evidence=${step === 4 || step === 8 ? `sync digest ${SYNC_DIGEST}` : `Step ${step}の証跡`}`,
    ...extra,
  ]);
}

function journalOf(staging: string): string {
  return fs.readFileSync(path.join(staging, STEP_JOURNAL_FILE), "utf8");
}

function lastEntry(staging: string): StepJournalEntry {
  const entry = parseStepJournal(journalOf(staging)).entries.at(-1);
  assert.ok(entry, "journal entryがありません");
  return entry;
}

function stage(world: PlanSealWorld, mode: Mode, root: string): string {
  fs.mkdirSync(path.join(root, ".agent-skill-chain", "tmp", "issues"), {
    recursive: true,
  });
  return createIssueStaging(root, {
    title: `plan-seal-${mode}`,
    answers: answers(),
    now: new Date("2026-09-26T00:00:00Z"),
    requestedMode: mode,
  }).path;
}

async function recordAll(staging: string, steps: readonly number[]) {
  for (const step of steps) {
    const result = await record(staging, step);
    assert.equal(result.status, 0, `Step ${step}: ${result.stdout}`);
  }
}

async function sealedQuick(world: PlanSealWorld): Promise<void> {
  world.root = world.initRepo();
  world.staging = stage(world, "quick", world.root);
  await recordAll(world.staging, [1, 4]);
  world.original = fs.readFileSync(path.join(world.staging, REQUEST), "utf8");
  world.journalBefore = journalOf(world.staging);
}

Given("Step 1まで記録したquick stagingがある", async function () {
  this.root = this.temp("asc-plan-seal-");
  this.staging = stage(this, "quick", this.root);
  await recordAll(this.staging, [1]);
});

When("Step 4を呼出し側の偽の封印値付きで記録する", function () {
  const skillId = WORKFLOW_STEPS.find((item) => item.step === 4)?.skillId;
  assert.ok(skillId);
  appendWorkflowJournalEntry({
    staging: this.staging,
    entry: {
      step: 4,
      skillId,
      mode: "quick",
      recordedAt: "2026-09-26T01:00:00.000Z",
      artifacts: [REQUEST],
      evidence: `sync digest ${SYNC_DIGEST}`,
      planSeal: { [REQUEST]: "f".repeat(64) },
    },
  });
});

Then(
  "Step 4 entryのplanSealは00の実digestだけを持ち偽の値を採用しない",
  function () {
    const entry = lastEntry(this.staging);
    assert.equal(entry.step, 4);
    assert.deepEqual(entry.planSeal, {
      [REQUEST]: sha256File(path.join(this.staging, REQUEST)),
    });
    assert.notEqual(entry.planSeal?.[REQUEST], "f".repeat(64));
  },
);

Given("01から03を置きStep 7まで記録したfull stagingがある", async function () {
  this.root = this.temp("asc-plan-seal-");
  this.staging = stage(this, "full", this.root);
  for (const name of FULL_PLAN.slice(1))
    fs.writeFileSync(path.join(this.staging, name), `# ${name}\n本文\n`);
  await recordAll(this.staging, [1, 2, 3, 4, 5, 6, 7]);
});

When("Step 8を記録する", async function () {
  this.result = await record(this.staging, 8);
});

Then(
  "Step 8 entryのplanSealは00から03の実digestを持ちStep 4 entryは封印を持たない",
  function () {
    assert.equal(this.result.status, 0, this.result.stdout);
    const entries = parseStepJournal(journalOf(this.staging)).entries;
    const step8 = entries.at(-1);
    assert.equal(step8?.step, 8);
    assert.deepEqual(
      step8?.planSeal,
      Object.fromEntries(
        FULL_PLAN.map((name) => [
          name,
          sha256File(path.join(this.staging, name)),
        ]),
      ),
    );
    const step4 = entries.find((entry) => entry.step === 4);
    assert.ok(step4);
    assert.equal(step4.planSeal, undefined);
  },
);

Given(
  "Step 4で封印したquick stagingとcommit済みrepositoryがある",
  async function () {
    await sealedQuick(this);
  },
);

When("00を編集してStep 9を記録する", async function () {
  fs.appendFileSync(path.join(this.staging, REQUEST), "\n封印後に追記した\n");
  this.result = await record(this.staging, 9);
});

Then(
  "封印済みで00が変化したことと05_計画変更.mdを名指しして拒否しjournalは変わらない",
  function () {
    assert.equal(this.result.status, 1);
    assert.match(this.result.stdout, /Step 4で封印済み/u);
    assert.match(this.result.stdout, /変化した計画文書: 00_要求定義\.md/u);
    assert.match(this.result.stdout, /05_計画変更\.mdへAMD-NNNとして追記/u);
    assert.equal(journalOf(this.staging), this.journalBefore);
  },
);

Then(
  "同じ状態のStep 10記録も封印済み計画の変化を名指しして拒否する",
  async function () {
    const result = await record(this.staging, 10, [
      `--review-session-digest=${SYNC_DIGEST}`,
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /変化した計画文書: 00_要求定義\.md/u);
    assert.equal(journalOf(this.staging), this.journalBefore);
  },
);

Then("00を封印時の内容へ戻すとStep 9を記録できる", async function () {
  fs.writeFileSync(path.join(this.staging, REQUEST), this.original);
  const result = await record(this.staging, 9);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(lastEntry(this.staging).step, 9);
});

When("00を編集してdelivery直前検査を実行する", function () {
  fs.appendFileSync(path.join(this.staging, REQUEST), "\n封印後に追記した\n");
  this.diagnostic = "";
  try {
    assertWorkflowReadyForDelivery(this.staging);
  } catch (error) {
    this.diagnostic = error instanceof Error ? error.message : String(error);
  }
});

Then(
  "診断は計画凍結と05_計画変更.mdを名指ししdigest不一致の診断ではない",
  function () {
    assert.match(this.diagnostic, /承認済み計画はStep 4で封印済み/u);
    assert.match(this.diagnostic, /00_要求定義\.md/u);
    assert.match(this.diagnostic, /05_計画変更\.md/u);
    assert.doesNotMatch(this.diagnostic, /同期済み記録から変化しています/u);
  },
);

Given(
  "封印を持たないStep 4 entryだけを記録した旧quick stagingがある",
  function () {
    this.root = this.temp("asc-plan-seal-");
    this.staging = stage(this, "quick", this.root);
    for (const [step, skillId] of [
      [1, "step-01-request"],
      [4, "step-04-issue-sync"],
    ] as const)
      fs.appendFileSync(
        path.join(this.staging, STEP_JOURNAL_FILE),
        `${JSON.stringify({
          step,
          skillId,
          mode: "quick",
          recordedAt: "2026-09-26T00:00:00.000Z",
          artifacts: [REQUEST],
          evidence: `sync digest ${SYNC_DIGEST}`,
        })}\n`,
      );
  },
);

When("00を編集して計画凍結を検査する", function () {
  fs.appendFileSync(path.join(this.staging, REQUEST), "\n旧stagingで追記\n");
  this.diagnostic = "";
  try {
    assertPlanFrozen(this.staging);
  } catch (error) {
    this.diagnostic = error instanceof Error ? error.message : String(error);
  }
});

Then("計画凍結の検査は拒否しない", function () {
  assert.equal(this.diagnostic, "");
  assert.equal(
    parseStepJournal(journalOf(this.staging)).entries.some(
      (entry) => entry.planSeal !== undefined,
    ),
    false,
  );
});

function amendment(
  entries: ReadonlyArray<{ id: string; skip?: string; value?: string }>,
): string {
  const fields = [
    "対象",
    "Before",
    "After",
    "理由",
    "影響する契約",
    "影響範囲",
  ];
  return [
    "# 05 計画変更",
    "",
    ...entries.flatMap(({ id, skip, value }) => [
      `## ${id} 変更`,
      "",
      ...fields
        .filter((field) => field !== skip)
        .map((field) => `- ${field}: ${value ?? `${field}の記述`}`),
      "",
    ]),
  ].join("\n");
}

Given("計画変更記録の正しい例と不正な例がある", function () {
  this.amendmentResults = [];
});

When("それぞれを構造検査する", function () {
  const cases: Array<[string, string]> = [
    ["valid", amendment([{ id: "AMD-001" }, { id: "AMD-002" }])],
    ["empty", "# 05 計画変更\n"],
    ["gap", amendment([{ id: "AMD-001" }, { id: "AMD-003" }])],
    ["duplicate", amendment([{ id: "AMD-001" }, { id: "AMD-001" }])],
    ["missing", amendment([{ id: "AMD-001", skip: "影響する契約" }])],
    ["placeholder", amendment([{ id: "AMD-001", value: "（未記入）" }])],
    ["malformed", amendment([{ id: "AMD-1" }])],
    [
      "fenced",
      `${amendment([{ id: "AMD-001" }])}\n\`\`\`\n## AMD-009 例\n\`\`\`\n`,
    ],
  ];
  this.amendmentResults = cases.map(([label, text]) => ({
    label,
    result: validatePlanAmendment(text),
  }));
});

Then("正しい例だけを受理し不正な例は理由を名指しして拒否する", function () {
  const byLabel = new Map(
    this.amendmentResults.map(({ label, result }) => [label, result]),
  );
  assert.equal(byLabel.get("valid")?.valid, true);
  assert.deepEqual(byLabel.get("valid")?.ids, ["AMD-001", "AMD-002"]);
  assert.equal(byLabel.get("empty")?.valid, true);
  assert.equal(byLabel.get("fenced")?.valid, true);
  const expectations: Array<[string, RegExp]> = [
    ["gap", /AMD-003はAMD-002であるべきです/u],
    ["duplicate", /AMD-001はAMD-002であるべきです/u],
    ["missing", /AMD-001に影響する契約がありません/u],
    ["placeholder", /AMD-001に対象がありません/u],
    ["malformed", /見出しAMD-1はAMD-NNN形式が必要です/u],
  ];
  for (const [label, pattern] of expectations) {
    const result = byLabel.get(label);
    assert.equal(result?.valid, false, label);
    assert.ok(
      result.errors.some((error) => pattern.test(error)),
      `${label}: ${result.errors.join("; ")}`,
    );
  }
  assert.equal(
    byLabel.get("missing")?.errors.length,
    1,
    "欠けていない項目まで欠落と報告しています",
  );
});

When("項目の欠けた05_計画変更.mdを置いてStep 9を記録する", async function () {
  fs.writeFileSync(
    path.join(this.staging, PLAN_AMENDMENT_FILE),
    amendment([{ id: "AMD-001", skip: "理由" }]),
  );
  this.result = await record(this.staging, 9);
});

Then(
  "05_計画変更.mdの構造検査失敗と欠けた項目を名指しして拒否する",
  function () {
    assert.equal(this.result.status, 1);
    assert.match(
      this.result.stdout,
      /計画変更記録05_計画変更\.mdの構造検査に失敗しました/u,
    );
    assert.match(this.result.stdout, /AMD-001に理由がありません/u);
    assert.equal(journalOf(this.staging), this.journalBefore);
  },
);

function journalLine(
  step: number,
  mode: Mode,
  extra: Record<string, unknown>,
): string {
  return JSON.stringify({
    step,
    skillId: WORKFLOW_STEPS.find((item) => item.step === step)?.skillId,
    mode,
    recordedAt: "2026-09-26T00:00:00.000Z",
    artifacts: [REQUEST],
    evidence: `Step ${step}の証跡`,
    ...extra,
  });
}

Given(
  "封印Step以外のplanSealと不正なfile集合のplanSealと正しいplanSealを持つjournal行がある",
  function () {
    const digest = "a".repeat(64);
    this.journalBefore = [
      journalLine(4, "full", { planSeal: { [REQUEST]: digest } }),
      journalLine(8, "full", { planSeal: { [REQUEST]: digest } }),
      journalLine(8, "full", {
        planSeal: Object.fromEntries(FULL_PLAN.map((name) => [name, digest])),
      }),
      journalLine(4, "quick", { planSeal: { [REQUEST]: digest } }),
    ].join("\n");
  },
);

When("journal行を構造検査する", function () {
  const parsed = parseStepJournal(`${this.journalBefore}\n`);
  this.parseErrors = parsed.errors;
  this.parsedEntries = parsed.entries;
});

Then("不正な2行だけが理由を名指しして拒否される", function () {
  assert.equal(this.parseErrors.length, 2, this.parseErrors.join("; "));
  assert.match(
    this.parseErrors[0] ?? "",
    /journal 1行目\.planSealはfullのStep 8にだけ指定できます/u,
  );
  assert.match(
    this.parseErrors[1] ?? "",
    /journal 2行目\.planSealのfile集合がfullの計画文書/u,
  );
  assert.deepEqual(
    this.parsedEntries.map((entry) => [entry.step, entry.mode]),
    [
      [8, "full"],
      [4, "quick"],
    ],
  );
  assert.equal(Object.keys(this.parsedEntries[0]?.planSeal ?? {}).length, 4);
});

Given("Step 0から8まで記録したfull stagingがある", async function () {
  this.root = this.temp("asc-plan-seal-");
  this.staging = stage(this, "full", this.root);
  for (const name of FULL_PLAN.slice(1))
    fs.writeFileSync(path.join(this.staging, name), `# ${name}\n`);
  await recordAll(this.staging, [1, 2, 3, 4, 5, 6, 7, 8]);
  this.journalBefore = journalOf(this.staging);
});

When("Step 3を--reconfirm付きで記録する", async function () {
  this.result = await record(this.staging, 3, ["--reconfirm"]);
});

function entryOf(
  step: number,
  extra: Partial<StepJournalEntry> = {},
): StepJournalEntry {
  const skillId = WORKFLOW_STEPS.find((item) => item.step === step)?.skillId;
  assert.ok(skillId);
  return {
    step,
    skillId,
    mode: "full",
    recordedAt: "2026-09-26T00:00:00.000Z",
    artifacts: [REQUEST],
    evidence: `Step ${step}の証跡`,
    ...(step === 9 ? { implementationHeadSha: "d".repeat(40) } : {}),
    ...(step === 10
      ? {
          reviewSession: {
            sessionId: "a".repeat(64),
            roundDigest: "b".repeat(64),
            headSha: "c".repeat(40),
          },
        }
      : {}),
    ...extra,
  };
}

Then("廃止を名指しして拒否されjournalは変わらない", function () {
  assert.equal(this.result.status, 1);
  assert.match(
    this.result.stdout,
    /workflow recordの未知optionです: --reconfirm/u,
  );
  assert.match(this.result.stdout, /--reconfirmは廃止されました/u);
  assert.match(this.result.stdout, /05_計画変更\.mdへ追記/u);
  assert.equal(journalOf(this.staging), this.journalBefore);
});

Then(
  "通常entryに続く既存の再確定entryを含むjournalは順序検査を通る",
  function () {
    const legacy = [
      ...Array.from({ length: 9 }, (_unused, step) => entryOf(step)),
      entryOf(3, { reconfirmation: true }),
    ];
    const text = `${legacy.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
    const parsed = parseStepJournal(text);
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.entries.at(-1)?.reconfirmation, true);
    const result = validateStepJournal({
      mode: "full",
      entries: parsed.entries,
      upToStep: 8,
    });
    assert.equal(result.valid, true, result.errors.join("; "));
    assert.deepEqual(result.outOfOrder, []);
  },
);

function discovery(
  overrides: Partial<ImplementationDiscovery>,
): ImplementationDiscovery {
  return {
    discoveryId: "DISC-PLANSEAL-001",
    workflowMode: "full",
    modeDisqualifiers: [],
    changedContractKinds: [],
    changesGoal: false,
    changesScope: false,
    changesAcceptanceCriteria: false,
    expandsSecurityBoundary: false,
    introducesIrreversibleOperation: false,
    ...overrides,
  };
}

Given(
  "fullのAC変更とquickの通常契約変更とquickの失格条件の発見がある",
  function () {
    this.discoveries = {
      fullAc: discovery({ changesAcceptanceCriteria: true }),
      quickScope: discovery({ workflowMode: "quick", changesScope: true }),
      quickSecurity: discovery({
        workflowMode: "quick",
        expandsSecurityBoundary: true,
      }),
    };
  },
);

When("封印済みと未封印でそれぞれ発見を評価する", function () {
  this.assessments = {};
  for (const [label, item] of Object.entries(this.discoveries)) {
    this.assessments[`${label}:sealed`] = {
      ...assessImplementationDiscovery(item, { planSealed: true }),
    };
    this.assessments[`${label}:unsealed`] = {
      ...assessImplementationDiscovery(item),
    };
  }
});

Then(
  "封印済みの再確定はrecord-planning-amendmentと05_計画変更.mdへ置き換わり昇格判定は変わらない",
  function () {
    const get = (key: string) => this.assessments[key] ?? {};
    assert.equal(
      get("fullAc:unsealed").disposition,
      "rebaseline-affected-contracts",
    );
    assert.equal(get("fullAc:sealed").disposition, "record-planning-amendment");
    assert.deepEqual(get("fullAc:sealed").affectedArtifacts, [
      PLAN_AMENDMENT_FILE,
    ]);
    assert.deepEqual(get("fullAc:sealed").amendmentTargets, [
      "01_要件定義.md",
      "02_設計.md",
      "03_実装計画.md",
    ]);
    assert.equal(
      get("quickScope:sealed").disposition,
      "record-planning-amendment",
    );
    assert.deepEqual(get("quickScope:sealed").amendmentTargets, [REQUEST]);
    assert.equal(get("quickScope:unsealed").amendmentTargets, undefined);
    for (const state of ["sealed", "unsealed"])
      assert.equal(
        get(`quickSecurity:${state}`).disposition,
        "promote-to-full",
        state,
      );
  },
);

Given(
  "Step 4で封印したquick stagingとquickの通常契約変更の発見入力がある",
  async function () {
    await sealedQuick(this);
    this.discoveryInput = path.join(this.root, "discovery.json");
    fs.writeFileSync(
      this.discoveryInput,
      JSON.stringify(discovery({ workflowMode: "quick", changesScope: true })),
    );
  },
);

When("staging指定ありとなしでassess-discoveryを実行する", async function () {
  this.assessments = {};
  for (const [label, extra] of [
    ["with", [`--staging=${path.relative(this.root, this.staging)}`]],
    ["without", []],
  ] as const) {
    const result = await run([
      "workflow",
      "assess-discovery",
      `--root=${this.root}`,
      `--input=${path.relative(this.root, this.discoveryInput)}`,
      ...extra,
    ]);
    assert.equal(result.status, 0, result.stdout);
    this.assessments[label] = JSON.parse(result.stdout) as Record<
      string,
      unknown
    >;
  }
});

Then("staging指定ありだけがrecord-planning-amendmentを返す", function () {
  assert.equal(this.assessments.with?.disposition, "record-planning-amendment");
  assert.deepEqual(this.assessments.with?.affectedArtifacts, [
    PLAN_AMENDMENT_FILE,
  ]);
  assert.equal(
    this.assessments.without?.disposition,
    "rebaseline-affected-contracts",
  );
});

Given("追加・削除・封印済み計画の変化と各記録状態の組がある", function () {
  this.drifts = {};
});

When("digest不一致の診断文を生成する", function () {
  const changes = {
    added: ["05_計画変更.md"],
    removed: ["99_旧メモ.md"],
    changedPlanning: [REQUEST],
  };
  const none = { added: [], removed: [], changedPlanning: [] };
  this.drifts = {
    early: stagingDriftDiagnostic({ ...none, recordedSteps: [0, 1] }),
    step9: stagingDriftDiagnostic({ ...changes, recordedSteps: [0, 1, 4, 9] }),
    step10: stagingDriftDiagnostic({
      ...none,
      recordedSteps: [0, 1, 4, 9, 10],
    }),
    journalTerminal: stagingDriftDiagnostic({
      ...none,
      recordedSteps: [0, 1, 4, 9, 10, 11],
    }),
    deliveryTerminal: stagingDriftDiagnostic({
      ...none,
      recordedSteps: [0, 1, 4, 9, 10],
      terminalDelivery: true,
    }),
  };
});

Then(
  "変化した成果物を名指しし記録状態ごとの次の行動を返し--reconfirmを含まない",
  function () {
    const drifts = this.drifts;
    assert.match(
      drifts.step9 ?? "",
      /変化した成果物: 追加 05_計画変更\.md; 削除 99_旧メモ\.md; 封印済み計画 00_要求定義\.md/u,
    );
    assert.match(
      drifts.step9 ?? "",
      /00_要求定義\.mdを封印時の内容へ戻し、計画の変更は05_計画変更\.mdへ/u,
    );
    assert.match(drifts.step9 ?? "", /review roundを実行するとstaging digest/u);
    assert.match(
      drifts.early ?? "",
      /成果物一覧は同じで、いずれかのfileの内容が変化しています/u,
    );
    assert.match(
      drifts.early ?? "",
      /workflow record --step=<最新のStep> を再実行/u,
    );
    assert.doesNotMatch(drifts.early ?? "", /封印/u);
    assert.match(
      drifts.step10 ?? "",
      /前進commitを伴う新しいreview roundだけ/u,
    );
    for (const key of ["journalTerminal", "deliveryTerminal"]) {
      assert.match(drifts[key] ?? "", /編集前の内容へ戻してください/u, key);
      assert.doesNotMatch(drifts[key] ?? "", /review round/u, key);
    }
    for (const [key, text] of Object.entries(drifts))
      assert.doesNotMatch(text, /reconfirm|再確定/u, key);
  },
);

/** 手書きjournalでStepを記録済みにし、digestを再固定してから成果物を1件追加する。 */
function driftedStaging(
  world: PlanSealWorld,
  steps: readonly number[],
  unreadableDelivery: boolean,
): void {
  world.root = world.initRepo();
  world.staging = stage(world, "quick", world.root);
  const sha = "a".repeat(40);
  for (const step of steps)
    fs.appendFileSync(
      path.join(world.staging, STEP_JOURNAL_FILE),
      `${journalLine(step, "quick", {
        ...(step === 9 ? { implementationHeadSha: sha } : {}),
        ...(step === 10
          ? {
              reviewSession: {
                sessionId: "b".repeat(64),
                roundDigest: "c".repeat(64),
                headSha: sha,
              },
            }
          : {}),
      })}\n`,
    );
  if (unreadableDelivery)
    fs.mkdirSync(path.join(world.staging, DELIVERY_STATE_FILE), {
      recursive: true,
    });
  refreshStoredStagingDigest(world.staging);
  fs.writeFileSync(path.join(world.staging, "99_メモ.md"), "追加した\n");
}

Given("Step 10まで記録した隔離stagingへ成果物を追加した", function () {
  driftedStaging(this, [1, 4, 9, 10], false);
});

Given(
  "Step 11まで記録しdelivery stateを読み取れない隔離stagingへ成果物を追加した",
  function () {
    driftedStaging(this, [1, 4, 9, 10, 11], true);
  },
);

When("CLI経路のdelivery直前検査を実行する", function () {
  this.diagnostic = "";
  try {
    assertWorkflowReadyForDelivery(this.staging);
  } catch (error) {
    this.diagnostic = error instanceof Error ? error.message : String(error);
  }
});

When("review session更新前検査を実行する", function () {
  this.diagnostic = "";
  try {
    assertStoredStagingDigestForTest(this.staging);
  } catch (error) {
    this.diagnostic = error instanceof Error ? error.message : String(error);
  }
});

Then(
  "診断は追加された成果物と前進commitを伴うreview roundを名指しし--reconfirmを含まない",
  function () {
    assert.match(
      this.diagnostic,
      /digestが一致しません|同期済み記録から変化しています/u,
    );
    assert.match(this.diagnostic, /変化した成果物: 追加 99_メモ\.md/u);
    assert.match(this.diagnostic, /前進commitを伴う新しいreview roundだけ/u);
    assert.doesNotMatch(this.diagnostic, /reconfirm/u);
  },
);

Then("診断は編集前の内容へ戻す手順を示し--reconfirmを含まない", function () {
  assert.match(this.diagnostic, /digestが一致しません/u);
  assert.match(this.diagnostic, /変化した成果物: 追加 99_メモ\.md/u);
  assert.match(this.diagnostic, /編集前の内容へ戻してください/u);
  assert.doesNotMatch(this.diagnostic, /reconfirm|review round/u);
});

// ---- 版管理下stagingのcommit上の計画文書（SCN-UNIT-PLANSEAL-013） ----

const TRACKED_ROOT = "docs/issues";

function gitIn(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** 本repositoryのpolicy setを複製し、`staging`節だけを版管理下rootへ差し替える。 */
function writeTrackedPolicySet(root: string): void {
  const source = process.cwd();
  const namespace = path.join(root, ".agent-skill-chain");
  fs.mkdirSync(namespace, { recursive: true });
  fs.cpSync(
    path.join(source, ".agent-skill-chain", "project"),
    path.join(namespace, "project"),
    { recursive: true },
  );
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(source, ".agent-skill-chain", "project-policy.json"),
      "utf8",
    ),
  ) as { policy: Record<string, unknown> };
  manifest.policy.staging = { root: TRACKED_ROOT, tracked: true };
  fs.writeFileSync(
    path.join(namespace, "project-policy.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function deliveryDiagnostic(staging: string, headSha: string): string {
  try {
    assertWorkflowReadyForDelivery(staging, headSha);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

Given(
  "Step 4で封印した版管理下quick stagingとcommit済みrepositoryがある",
  async function () {
    this.root = this.initRepo();
    writeTrackedPolicySet(this.root);
    fs.mkdirSync(path.join(this.root, ...TRACKED_ROOT.split("/")), {
      recursive: true,
    });
    this.staging = createIssueStaging(this.root, {
      title: "plan-seal-tracked",
      answers: answers(),
      now: new Date("2026-09-26T00:00:00Z"),
      requestedMode: "quick",
      stagingRoot: TRACKED_ROOT,
    }).path;
    await recordAll(this.staging, [1, 4]);
    gitIn(this.root, ["add", "-A"]);
    gitIn(this.root, ["commit", "-q", "-m", "sealed plan"]);
    assert.equal(gitIn(this.root, ["status", "--porcelain"]), "");
    this.original = fs.readFileSync(path.join(this.staging, REQUEST), "utf8");
    this.journalBefore = journalOf(this.staging);
  },
);

When("00の編集をcommitしworktreeだけ封印時の内容へ戻す", function () {
  const file = path.join(this.staging, REQUEST);
  fs.appendFileSync(file, "\n封印後にcommitした追記\n");
  gitIn(this.root, ["commit", "-q", "-am", "edit sealed plan"]);
  fs.writeFileSync(file, this.original);
});

Then(
  "Step 9記録と配送headのdelivery直前検査はcommit上の00の変化を名指しして拒否する",
  async function () {
    const result = await record(this.staging, 9);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /変化した計画文書: 00_要求定義\.md/u);
    assert.match(result.stdout, /commit HEAD上の計画文書が封印と一致しません/u);
    assert.equal(journalOf(this.staging), this.journalBefore);
    const head = gitIn(this.root, ["rev-parse", "HEAD"]);
    const diagnostic = deliveryDiagnostic(this.staging, head);
    assert.match(diagnostic, /変化した計画文書: 00_要求定義\.md/u);
    assert.match(
      diagnostic,
      new RegExp(`commit ${head}上の計画文書が封印と一致しません`, "u"),
    );
    /** 配送headが封印時のcommitなら同じ検査は計画凍結で止めない */
    const sealed = gitIn(this.root, ["rev-parse", "HEAD^"]);
    assert.doesNotMatch(
      deliveryDiagnostic(this.staging, sealed),
      /封印と一致しません/u,
    );
  },
);

Then("commitから00を除くと削除として拒否する", async function () {
  const relative = path
    .relative(this.root, path.join(this.staging, REQUEST))
    .split(path.sep)
    .join("/");
  gitIn(this.root, ["rm", "-q", "--cached", "--", relative]);
  gitIn(this.root, ["commit", "-q", "-m", "drop sealed plan"]);
  const result = await record(this.staging, 9);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /00_要求定義\.md（削除）/u);
  assert.equal(journalOf(this.staging), this.journalBefore);
});

Then("commit上の00を封印時の内容へ戻すとStep 9を記録できる", async function () {
  gitIn(this.root, ["add", "-A"]);
  gitIn(this.root, ["commit", "-q", "-m", "restore sealed plan"]);
  const result = await record(this.staging, 9);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(lastEntry(this.staging).step, 9);
});

// ---- Step 9後の再封印（SCN-UNIT-PLANSEAL-014） ----

When("Step 9を記録した後に00を編集してStep 4を記録する", async function () {
  await recordAll(this.staging, [9]);
  this.journalBefore = journalOf(this.staging);
  fs.appendFileSync(path.join(this.staging, REQUEST), "\n封印後に追記した\n");
  this.result = await record(this.staging, 4);
});

Then("再封印を名指しして拒否しjournalと最新封印は変わらない", function () {
  assert.equal(this.result.status, 1, this.result.stdout);
  assert.match(
    this.result.stdout,
    /Step 9以降の記録後にStep 4を追記して計画を再封印できません/u,
  );
  assert.equal(journalOf(this.staging), this.journalBefore);
  const seals = parseStepJournal(journalOf(this.staging)).entries.filter(
    (entry) => entry.planSeal !== undefined,
  );
  assert.equal(seals.length, 1);
  assert.equal(seals[0]?.step, 4);
});
