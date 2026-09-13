import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import {
  assertWorkflowReadyForDelivery,
  main,
  writeReviewRoundDraft,
} from "../../src/cli.js";
import { CliValidationError } from "../../src/cli-usage.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { QUESTIONS, type ModeAnswer } from "../../src/domain/mode.js";
import {
  parseReviewRoundInput,
  unconvergedReviewSessionDiagnostic,
  type ReviewRoundInput,
  type ReviewSessionState,
} from "../../src/domain/review-convergence.js";
import {
  buildReviewRoundDraft,
  observeReviewDiff,
  previewReviewRound,
  recordReviewRound,
} from "../../src/adapters/review-session.js";
import {
  calculateStagingDigest,
  listStagingArtifacts,
  refreshStoredStagingDigest,
} from "../../src/domain/staging.js";
import { STEP_JOURNAL_FILE } from "../../src/domain/workflow.js";
import {
  planCompletion,
  planRootUpdate,
  planWorktreeCleanup,
} from "../../src/domain/finalize.js";

interface ReviewRoundInitWorld extends WorkflowWorld {
  root: string;
  staging: string;
  base: string;
  head: string;
  session: ReviewSessionState;
  outFile: string;
  digestBefore: string;
  cliStatus: number;
  cliOutput: string;
  cliError: Error | undefined;
  draft: ReviewRoundInput;
  fixedPaths: string[];
  helpOutputs: Record<string, unknown>[];
  diagnostic: string;
  completion: ReturnType<typeof planCompletion>;
  reasonSets: string[][];
  writeError: Error | undefined;
  raceParent: string;
  unrelatedFile: string;
}

const { Given, When, Then } = stepDefinitions<ReviewRoundInitWorld>();
const repositoryRoot = process.cwd();
const instant = new Date("2026-09-11T00:00:00.000Z");
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

function commitFile(
  root: string,
  relative: string,
  source: string,
  message: string,
): string {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
  execFileSync("git", ["add", relative], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: root });
  return head(root);
}

function stagingDigest(staging: string): string {
  return calculateStagingDigest(staging, listStagingArtifacts(staging));
}

async function runCli(
  world: ReviewRoundInitWorld,
  arguments_: string[],
): Promise<void> {
  let output = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  world.cliError = undefined;
  try {
    world.cliStatus = await main(arguments_);
  } catch (error) {
    world.cliError = error instanceof Error ? error : new Error(String(error));
  } finally {
    process.stdout.write = originalWrite;
    world.cliOutput = output;
  }
}

function createFixture(
  world: ReviewRoundInitWorld,
  recordImplementation = true,
): void {
  world.root = world.initRepo();
  world.base = head(world.root);
  world.head = commitFile(
    world.root,
    reviewedPath,
    "export const reviewed = 1;\n",
    "feat: initial candidate",
  );
  world.staging = createIssueStaging(world.root, {
    title: "review-round-init",
    answers: answers(),
    now: instant,
    requestedMode: "quick",
  }).path;
  world.outFile = path.join(world.temp("asc-review-init-out-"), "round.json");
  if (recordImplementation) appendStepNine(world, world.head);
}

function appendStepNine(
  world: ReviewRoundInitWorld,
  implementationHeadSha?: string,
): void {
  const journal = path.join(world.staging, STEP_JOURNAL_FILE);
  fs.appendFileSync(
    journal,
    `${JSON.stringify({
      step: 9,
      skillId: "step-09-implement",
      mode: "quick",
      recordedAt: instant.toISOString(),
      artifacts: [reviewedPath],
      evidence: `candidate HEAD ${world.head}`,
      ...(implementationHeadSha ? { implementationHeadSha } : {}),
    })}\n`,
  );
  refreshStoredStagingDigest(world.staging);
}

function initArguments(world: ReviewRoundInitWorld, extra: string[] = []) {
  return [
    "review",
    "round",
    "--init",
    `--staging=${world.staging}`,
    `--out=${world.outFile}`,
    `--head=${world.head}`,
    ...extra,
  ];
}

Given("初回candidateを持つstagingがある", function () {
  createFixture(this);
});

Given(
  "Step 9のimplementation HEAD後に別commitを積んだstagingがある",
  function () {
    createFixture(this);
    this.head = commitFile(
      this.root,
      reviewedPath,
      "export const reviewed = 2;\n",
      "fix: change after step nine",
    );
  },
);

Given(
  "implementation HEAD bindingのない旧Step 9を持つstagingがある",
  function () {
    createFixture(this, false);
    appendStepNine(this);
  },
);

Given("Step 9をまだ記録していないstagingがある", function () {
  createFixture(this, false);
});

When("Step 9後のHEADでreview round --initを実行する", async function () {
  await runCli(
    this,
    initArguments(this, [
      `--base=${this.base}`,
      "--scope=SCOPE-001",
      "--ac=AC-001",
    ]),
  );
});

When("review round --initでround 1の雛形を書く", async function () {
  this.digestBefore = stagingDigest(this.staging);
  await runCli(
    this,
    initArguments(this, [
      `--base=${this.base}`,
      "--scope=SCOPE-002,SCOPE-001,SCOPE-002",
      "--ac=AC-002,AC-001",
      "--invariant=INV-001",
    ]),
  );
  assert.equal(this.cliError, undefined, this.cliError?.message);
  assert.equal(this.cliStatus, 0, this.cliOutput);
  this.draft = parseReviewRoundInput(
    JSON.parse(fs.readFileSync(this.outFile, "utf8")),
  );
  assert.deepEqual([...this.draft.anchor.scopeIds], ["SCOPE-001", "SCOPE-002"]);
  assert.deepEqual(
    [...this.draft.anchor.acceptanceCriteriaIds],
    ["AC-001", "AC-002"],
  );
});

When("round 1の雛形を直接構築する", function () {
  const draft = buildReviewRoundDraft({
    staging: this.staging,
    headSha: this.head,
    baseSha: this.base,
    scopeIds: ["SCOPE-001"],
    acceptanceCriteriaIds: ["AC-001"],
  });
  this.draft = draft.round;
  this.cliOutput = JSON.stringify({ notes: draft.notes });
});

Then("雛形をfileへ渡したreview round previewが受理される", function () {
  const state = previewReviewRound({
    staging: this.staging,
    round: this.draft,
  });
  assert.equal(state.rounds.length, 1);
  assert.equal(this.draft.round, 1);
  assert.equal(this.draft.candidateHeadSha, this.head);
  assert.equal(
    this.draft.anchor.initialDiffDigest,
    observeReviewDiff(this.root, this.base, this.head).digest,
  );
});

Then("notesは検分対象HEADと記録順を示す", function () {
  const notes = (JSON.parse(this.cliOutput) as { notes: string[] }).notes.join(
    "\n",
  );
  assert.match(notes, new RegExp(this.head.slice(0, 8), "u"));
  assert.match(notes, /feat: initial candidate/u);
  assert.match(
    notes,
    /レビュー結果を反映したcommitを、このroundの記録より先に作らない/u,
  );
});

Then("staging digestは--init前と同じである", function () {
  assert.equal(stagingDigest(this.staging), this.digestBefore);
  assert.equal(
    fs.existsSync(path.join(this.staging, "review-session.json")),
    false,
  );
});

Then("Step 9 HEADとの不一致errorで拒否し雛形を書かない", function () {
  assert.match(this.cliError?.message ?? "", /Step 9 implementation HEAD/u);
  assert.equal(fs.existsSync(this.outFile), false);
});

Then("Step 9 binding不足errorで拒否し雛形を書かない", function () {
  assert.match(this.cliError?.message ?? "", /implementationHeadSha binding/u);
  assert.equal(fs.existsSync(this.outFile), false);
});

Given(
  "round 1をblocker付きで記録し是正commitを積んだstagingがある",
  function () {
    createFixture(this);
    const observed = observeReviewDiff(this.root, this.base, this.head);
    this.session = recordReviewRound({
      staging: this.staging,
      round: parseReviewRoundInput({
        round: 1,
        previousRoundDigest: null,
        anchor: {
          scopeIds: ["SCOPE-001"],
          acceptanceCriteriaIds: ["AC-001"],
          invariantIds: ["INV-001"],
          diffBaseSha: this.base,
          initialHeadSha: this.head,
          initialDiffDigest: observed.digest,
        },
        candidateHeadSha: this.head,
        focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
        findings: [
          {
            id: "H-001",
            severity: "High",
            status: "valid",
            source: "review",
            relation: "acceptance-violation",
            evidence: "SCN-UNIT-REVINIT-003で再現した",
            path: reviewedPath,
            contractId: "AC-001",
            causedByFindingId: null,
          },
        ],
      }),
    });
    this.head = commitFile(
      this.root,
      reviewedPath,
      "export const reviewed = 2;\n",
      "fix: review finding",
    );
    this.fixedPaths = [reviewedPath];
  },
);

When("review round --initで次roundの雛形を書く", async function () {
  await runCli(this, initArguments(this));
  assert.equal(this.cliError, undefined, this.cliError?.message);
  assert.equal(this.cliStatus, 0, this.cliOutput);
  this.draft = parseReviewRoundInput(
    JSON.parse(fs.readFileSync(this.outFile, "utf8")),
  );
});

Then(
  "雛形のpreviousBlockingとfixedDiffが実測と一致しpreviewが受理される",
  function () {
    assert.equal(this.draft.round, 2);
    assert.equal(
      this.draft.previousRoundDigest,
      this.session.latestRoundDigest,
    );
    assert.deepEqual([...this.draft.focus.previousBlocking], ["H-001"]);
    assert.deepEqual([...this.draft.focus.fixedDiff], this.fixedPaths);
    assert.deepEqual(this.draft.anchor, this.session.anchor);
    const output: unknown = JSON.parse(this.cliOutput);
    assert.ok(output && typeof output === "object" && "notes" in output);
    assert.match(
      String((output as { notes: string[] }).notes.join("\n")),
      /H-001/u,
    );
    const withReevaluation = parseReviewRoundInput({
      ...this.draft,
      findings: [
        {
          id: "H-001",
          severity: "High",
          status: "resolved",
          source: "review",
          relation: "acceptance-violation",
          evidence: "是正commitで解消",
          path: reviewedPath,
          contractId: "AC-001",
          causedByFindingId: null,
        },
      ],
    });
    const state = previewReviewRound({
      staging: this.staging,
      round: withReevaluation,
    });
    assert.equal(state.rounds.length, 2);
  },
);

When("--outをstaging内にしてreview round --initを実行する", async function () {
  this.outFile = path.join(this.staging, "round.json");
  await runCli(
    this,
    initArguments(this, [
      `--base=${this.base}`,
      "--scope=SCOPE-001",
      "--ac=AC-001",
    ]),
  );
});

Then("staging外を要求するerrorで拒否する", function () {
  assert.ok(this.cliError, this.cliOutput);
  assert.match(this.cliError.message, /stagingの外を指定してください/u);
  assert.equal(fs.existsSync(this.outFile), false);
});

When("--outを既存fileにしてreview round --initを実行する", async function () {
  fs.writeFileSync(this.outFile, "{}\n");
  await runCli(
    this,
    initArguments(this, [
      `--base=${this.base}`,
      "--scope=SCOPE-001",
      "--ac=AC-001",
    ]),
  );
});

Then("既存fileを上書きしないerrorで拒否する", function () {
  assert.ok(this.cliError, this.cliOutput);
  assert.match(this.cliError.message, /既存fileは上書きしません/u);
  assert.equal(fs.readFileSync(this.outFile, "utf8"), "{}\n");
});

When(
  "--initと--applyを併用してreview round --initを実行する",
  async function () {
    await runCli(
      this,
      initArguments(this, [
        `--base=${this.base}`,
        "--scope=SCOPE-001",
        "--ac=AC-001",
        "--apply",
      ]),
    );
  },
);

Then("併用できないerrorで拒否する", function () {
  assert.ok(this.cliError, this.cliOutput);
  assert.match(this.cliError.message, /--fileおよび--applyと併用できません/u);
  assert.equal(fs.existsSync(this.outFile), false);
});

Given("配布CLIのusage正本がある", function () {
  this.helpOutputs = [];
});

Given("配布template・規範文書・step-09 skillがある", function () {
  assert.ok(
    fs.existsSync(
      path.join(
        repositoryRoot,
        ".agent-skill-chain/templates/issue/04_レビュー.md",
      ),
    ),
  );
});

When(
  "--outをstagingを指すsymlinkの配下にしてreview round --initを実行する",
  async function () {
    const link = path.join(this.temp("asc-review-init-link-"), "staging-link");
    fs.symlinkSync(this.staging, link);
    this.outFile = path.join(link, "round.json");
    await runCli(
      this,
      initArguments(this, [
        `--base=${this.base}`,
        "--scope=SCOPE-001",
        "--ac=AC-001",
      ]),
    );
  },
);

Then("stagingにfileは作られていない", function () {
  assert.equal(fs.existsSync(path.join(this.staging, "round.json")), false);
});

Given("round 1を記録しHEADを進めていないstagingがある", function () {
  createFixture(this);
  const observed = observeReviewDiff(this.root, this.base, this.head);
  this.session = recordReviewRound({
    staging: this.staging,
    round: parseReviewRoundInput({
      round: 1,
      previousRoundDigest: null,
      anchor: {
        scopeIds: ["SCOPE-001"],
        acceptanceCriteriaIds: ["AC-001"],
        invariantIds: [],
        diffBaseSha: this.base,
        initialHeadSha: this.head,
        initialDiffDigest: observed.digest,
      },
      candidateHeadSha: this.head,
      focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
      findings: [],
    }),
  });
});

When("review round --initで次roundの雛形を書こうとする", async function () {
  await runCli(this, initArguments(this));
});

Then("実Git差分が空であるerrorで拒否し雛形を書かない", function () {
  assert.ok(this.cliError, this.cliOutput);
  assert.match(this.cliError.message, /実Git差分が空です/u);
  assert.equal(fs.existsSync(this.outFile), false);
});

Then("空差分の診断はsession確認を案内する", function () {
  const message = this.cliError?.message ?? "";
  assert.match(message, /HEADを進めても取り違えが重なる/u);
  assert.match(message, /review-session\.json/u);
  assert.match(message, /candidateHeadSha/u);
});

Given("非収束statusごとの診断がある", function () {
  this.reasonSets = [
    [unconvergedReviewSessionDiagnostic("active")],
    [unconvergedReviewSessionDiagnostic("budget-exhausted")],
  ];
});

When("status別の診断を比較する", function () {
  assert.equal(this.reasonSets.length, 2);
});

Then("activeとbudget-exhaustedでownerの確認対象が異なる", function () {
  const active = this.reasonSets[0]?.[0] ?? "";
  const exhausted = this.reasonSets[1]?.[0] ?? "";
  assert.match(active, /candidateHeadSha/u);
  assert.match(active, /risk受容へ進まず/u);
  assert.match(exhausted, /既知の未解決finding/u);
  assert.notEqual(active, exhausted);
});

When("--headを基点SHAにしてreview round --initを実行する", async function () {
  await runCli(this, [
    "review",
    "round",
    "--init",
    `--staging=${this.staging}`,
    `--out=${this.outFile}`,
    `--head=${this.base}`,
    `--base=${this.base}`,
    "--scope=SCOPE-001",
    "--ac=AC-001",
  ]);
});

Then("current HEADと一致しないerrorで拒否し雛形を書かない", function () {
  assert.ok(this.cliError, this.cliOutput);
  assert.match(this.cliError.message, /current HEAD .* と一致しません/u);
  assert.equal(fs.existsSync(this.outFile), false);
});

When(
  "--stagingだけでreview roundを実行しさらに--initと--stagingだけで実行する",
  async function () {
    this.reasonSets = [];
    for (const arguments_ of [
      ["review", "round", `--staging=${this.staging}`],
      ["review", "round", "--init", `--staging=${this.staging}`],
    ]) {
      await runCli(this, arguments_);
      assert.ok(this.cliError instanceof CliValidationError, this.cliOutput);
      this.reasonSets.push([...this.cliError.reasons]);
    }
  },
);

Then("前者は--fileを後者は--outと--headを1回の診断で列挙する", function () {
  const [first, second] = this.reasonSets;
  assert.ok(first && second);
  assert.deepEqual(first, ["--file=...が必要です"]);
  assert.deepEqual(second, ["--out=...が必要です", "--head=...が必要です"]);
});

When("review roundとpr createのhelpを取得する", async function () {
  this.helpOutputs = [];
  for (const arguments_ of [
    ["review", "round", "--help"],
    ["pr", "create", "--help"],
  ]) {
    await runCli(this, arguments_);
    assert.equal(this.cliError, undefined, this.cliError?.message);
    this.helpOutputs.push(
      JSON.parse(this.cliOutput) as Record<string, unknown>,
    );
  }
});

Then("両方のhelpにdescriptionとexampleを持つinputContractがある", function () {
  assert.equal(this.helpOutputs.length, 2);
  for (const output of this.helpOutputs) {
    const contract = output.inputContract;
    assert.ok(contract && typeof contract === "object", JSON.stringify(output));
    const { description, example } = contract as Record<string, unknown>;
    assert.equal(typeof description, "string");
    assert.ok(String(description).length > 40);
    assert.ok(example && typeof example === "object");
  }
  const review = this.helpOutputs[0]?.inputContract as { description: string };
  assert.match(
    review.description,
    /sha256\(git diff --binary --full-index --no-renames/u,
  );
  assert.match(review.description, /Critical\|High\|Medium\|Low/u);
});

Given("round 1を記録した後にstagingを編集した状態がある", function () {
  createFixture(this);
  const observed = observeReviewDiff(this.root, this.base, this.head);
  this.session = recordReviewRound({
    staging: this.staging,
    round: parseReviewRoundInput({
      round: 1,
      previousRoundDigest: null,
      anchor: {
        scopeIds: ["SCOPE-001"],
        acceptanceCriteriaIds: ["AC-001"],
        invariantIds: [],
        diffBaseSha: this.base,
        initialHeadSha: this.head,
        initialDiffDigest: observed.digest,
      },
      candidateHeadSha: this.head,
      focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
      findings: [],
    }),
  });
  fs.appendFileSync(
    path.join(this.staging, "00_要求定義.md"),
    "\n進捗を追記した\n",
  );
});

When("編集後のstagingでreview roundを実行する", function () {
  this.diagnostic = "";
  try {
    previewReviewRound({
      staging: this.staging,
      round: parseReviewRoundInput({
        round: 2,
        previousRoundDigest: this.session.latestRoundDigest,
        anchor: this.session.anchor,
        candidateHeadSha: this.head,
        focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
        findings: [],
      }),
    });
  } catch (error) {
    this.diagnostic = error instanceof Error ? error.message : String(error);
  }
});

When("delivery直前の再検証を実行する", function () {
  this.diagnostic = "";
  try {
    assertWorkflowReadyForDelivery(this.staging);
  } catch (error) {
    this.diagnostic = error instanceof Error ? error.message : String(error);
  }
});

Then("digest不一致の診断はworkflow recordの再実行を案内する", function () {
  assert.match(
    this.diagnostic,
    /digestが一致しません|同期済み記録から変化しています/u,
  );
  assert.match(
    this.diagnostic,
    /workflow record --step=<最新のStep> を再実行/u,
  );
});

Given(
  "承認済みdigestがpreview digestと一致しないcompletion入力がある",
  function () {
    this.completion = planCompletion({
      mergeConfirmed: true,
      mergeSha: "b".repeat(40),
      rootUpdate: planRootUpdate({
        rootPath: "/repo",
        currentBranch: "main",
        defaultBranch: "main",
        dirty: false,
        untracked: [],
        upstreamRef: "origin/main",
        localSha: "a".repeat(40),
        upstreamSha: "b".repeat(40),
        remoteSha: "b".repeat(40),
        mergeSha: "b".repeat(40),
        fastForwardable: true,
      }),
      cleanup: planWorktreeCleanup({
        repositoryRoot: "/repo",
        target: { path: "/repo/.worktrees/target", branch: "feature/1323" },
        registered: [
          { path: "/repo/.worktrees/target", branch: "feature/1323" },
        ],
        prMerged: true,
        clean: true,
        pushed: true,
        remoteBranch: true,
        recoveryReachable: true,
        consumerAssets: [],
        stashes: [],
        temporaryArtifacts: [],
        ignoredArtifacts: [],
      }),
      cleanupAuthorityGranted: true,
      previewDigest: "c".repeat(64),
      approvedDigest: "d".repeat(64),
    });
  },
);

When("completion状態を評価する", function () {
  assert.equal(this.completion.state, "rejected");
});

Then("cleanup-applyの拒否は--approved-digestを案内する", function () {
  const phase = this.completion.phases.find(
    (item) => item.phase === "cleanup-apply",
  );
  assert.ok(phase);
  assert.equal(phase.state, "rejected");
  assert.match(
    phase.recovery.join("\n"),
    /--approved-digest=<preview digest>/u,
  );
});

When("配布template・規範文書・step-09 skillを読む", function () {
  this.helpOutputs = [];
});

Then(
  "04にH_impl行、01にQ-08の判定例表、step-09にstaging配置の手順がある",
  function () {
    const read = (relative: string): string =>
      fs.readFileSync(path.join(repositoryRoot, relative), "utf8");
    const review = read(".agent-skill-chain/templates/issue/04_レビュー.md");
    const identity =
      review.split("## 0. レビュー識別情報")[1]?.split("\n### ")[0] ?? "";
    assert.match(identity, /^\| H_impl \| （40桁SHA） \|$/mu);
    assert.match(identity, /^\| 比較基点 \| （40桁SHA） \|$/mu);
    const workflow = read(".agent-skill-chain/docs/01_開発ワークフロー.md");
    assert.match(workflow, /\*\*Q-08の判定例。\*\*/u);
    assert.match(workflow, /付随する更新は別コンテキストに数えない/u);
    const skill = read(".agent-skill-chain/skills/step-09-implement/SKILL.md");
    assert.match(skill, /stagingは実装するworktreeの中に置く/u);
    assert.match(skill, /issue create --root=<worktree>/u);
  },
);

When(
  "親directoryの検査直後にstagingへのsymlinkへ差し替えて雛形を書く",
  function () {
    const container = this.temp("asc-review-init-race-");
    const parent = path.join(container, "out");
    fs.mkdirSync(parent);
    this.raceParent = fs.realpathSync(parent);
    this.writeError = undefined;
    try {
      writeReviewRoundDraft(this.raceParent, "round.json", "{}\n", {
        beforeWrite: () => {
          fs.renameSync(parent, `${parent}.moved`);
          fs.symlinkSync(this.staging, parent);
        },
      });
    } catch (error) {
      this.writeError =
        error instanceof Error ? error : new Error(String(error));
    }
  },
);

Then(
  "親差し替えのerrorで拒否しstagingにも差し替え先にもfileを残さない",
  function () {
    assert.ok(this.writeError, "拒否を期待した");
    assert.match(this.writeError.message, /検査後に差し替えられました/u);
    assert.equal(fs.existsSync(path.join(this.staging, "round.json")), false);
    assert.equal(
      fs.existsSync(path.join(`${this.raceParent}.moved`, "round.json")),
      false,
    );
  },
);

When("作成後とcleanup直前に親directoryを2回差し替える", function () {
  const container = this.temp("asc-review-init-double-race-");
  const parent = path.join(container, "out");
  const unrelated = path.join(container, "unrelated");
  fs.mkdirSync(parent);
  fs.mkdirSync(unrelated);
  this.raceParent = fs.realpathSync(parent);
  this.unrelatedFile = path.join(unrelated, "round.json");
  fs.writeFileSync(this.unrelatedFile, "unrelated\n");
  this.writeError = undefined;
  try {
    writeReviewRoundDraft(this.raceParent, "round.json", "{}\n", {
      afterWriteBeforeVerify: () => {
        fs.renameSync(parent, `${parent}.moved`);
        fs.symlinkSync(this.staging, parent);
      },
      beforeCleanup: () => {
        fs.unlinkSync(parent);
        fs.symlinkSync(unrelated, parent);
      },
    });
  } catch (error) {
    this.writeError = error instanceof Error ? error : new Error(String(error));
  }
});

Then("親差し替えを拒否し作成fileを空にして無関係fileを保持する", function () {
  assert.ok(this.writeError, "拒否を期待した");
  if (process.platform === "darwin") {
    assert.equal(fs.existsSync(path.join(this.staging, "round.json")), false);
    assert.equal(fs.readFileSync(this.unrelatedFile, "utf8"), "unrelated\n");
    return;
  }
  assert.match(this.writeError.message, /作成descriptorを空にしました/u);
  assert.equal(fs.existsSync(path.join(this.staging, "round.json")), false);
  assert.equal(
    fs.readFileSync(
      path.join(`${this.raceParent}.moved`, "round.json"),
      "utf8",
    ),
    "",
  );
  assert.equal(fs.readFileSync(this.unrelatedFile, "utf8"), "unrelated\n");
});

When("排他的作成後に部分書込み失敗を注入する", function () {
  const parent = this.temp("asc-review-init-partial-");
  this.outFile = path.join(parent, "round.json");
  this.writeError = undefined;
  try {
    writeReviewRoundDraft(parent, "round.json", "{}\n", {
      afterCreateBeforeWrite: (descriptor) => {
        fs.writeSync(descriptor, "{");
        throw new Error("部分書込み失敗を注入");
      },
    });
  } catch (error) {
    this.writeError = error instanceof Error ? error : new Error(String(error));
  }
});

Then("書込み失敗を返し作成fileを空にして保持する", function () {
  if (process.platform === "darwin") {
    assert.ok(this.writeError, "fault injectionの拒否を期待した");
    assert.equal(fs.existsSync(this.outFile), false);
    return;
  }
  assert.match(this.writeError?.message ?? "", /作成descriptorを空にしました/u);
  assert.equal(fs.readFileSync(this.outFile, "utf8"), "");
});

When("排他的作成直後にidentity取得失敗を注入する", function () {
  const parent = this.temp("asc-review-init-identity-failure-");
  this.outFile = path.join(parent, "round.json");
  this.writeError = undefined;
  try {
    writeReviewRoundDraft(parent, "round.json", "{}\n", {
      afterCreateBeforeIdentity: () => {
        throw new Error("identity取得失敗を注入");
      },
    });
  } catch (error) {
    this.writeError = error instanceof Error ? error : new Error(String(error));
  }
});

Then("identity取得失敗を返し作成fileを空にして保持する", function () {
  if (process.platform === "darwin") {
    assert.ok(this.writeError, "fault injectionの拒否を期待した");
    assert.equal(fs.existsSync(this.outFile), false);
    return;
  }
  assert.match(this.writeError?.message ?? "", /作成descriptorを空にしました/u);
  assert.equal(fs.readFileSync(this.outFile, "utf8"), "");
});

When("雛形の耐久化後にdirectory descriptor close失敗を注入する", function () {
  const parent = this.temp("asc-review-init-directory-close-");
  this.outFile = path.join(parent, "round.json");
  this.writeError = undefined;
  try {
    this.raceParent = writeReviewRoundDraft(parent, "round.json", "{}\n", {
      closePinnedDirectory: (descriptor) => {
        fs.closeSync(descriptor);
        throw new Error("directory descriptor close失敗を注入");
      },
    });
  } catch (error) {
    this.writeError = error instanceof Error ? error : new Error(String(error));
  }
});

Then("完成済み雛形のpathを返し内容を保持する", function () {
  assert.equal(this.writeError, undefined);
  assert.equal(this.raceParent, this.outFile);
  assert.equal(fs.readFileSync(this.outFile, "utf8"), "{}\n");
});

When(
  "--outをstaging外を指すsymlink配下にしてreview round --initでround 1の雛形を書く",
  async function () {
    const real = this.temp("asc-review-init-real-");
    const link = path.join(this.temp("asc-review-init-link2-"), "via-link");
    fs.symlinkSync(real, link);
    this.outFile = path.join(link, "round.json");
    this.raceParent = fs.realpathSync(real);
    await runCli(
      this,
      initArguments(this, [
        `--base=${this.base}`,
        "--scope=SCOPE-001",
        "--ac=AC-001",
      ]),
    );
  },
);

Then("全対応環境で実体の親へ雛形を書く", function () {
  assert.equal(this.cliError, undefined, this.cliError?.message);
  const output: unknown = JSON.parse(this.cliOutput);
  assert.ok(output && typeof output === "object" && "written" in output);
  assert.equal((output as { written: string }).written, this.outFile);
  assert.ok(fs.existsSync(path.join(this.raceParent, "round.json")));
});

When("macOS helperのfile fsync直後に失敗を注入する", function () {
  const parent = this.temp("asc-review-init-darwin-fsync-");
  this.outFile = path.join(parent, "round.json");
  this.writeError = undefined;
  try {
    writeReviewRoundDraft(parent, "round.json", "sensitive\n", {
      darwinHelperFault: "after-file-fsync",
    });
  } catch (error) {
    this.writeError = error instanceof Error ? error : new Error(String(error));
  }
});

Then("Darwinでは作成descriptorを空にして失敗を返す", function () {
  if (process.platform !== "darwin") {
    assert.equal(this.writeError, undefined);
    assert.equal(fs.readFileSync(this.outFile, "utf8"), "sensitive\n");
    return;
  }
  assert.match(this.writeError?.message ?? "", /作成descriptorを空にしました/u);
  assert.equal(fs.readFileSync(this.outFile, "utf8"), "");
});

When("macOS helperを作成直後に強制終了する", function () {
  const parent = this.temp("asc-review-init-darwin-kill-");
  this.outFile = path.join(parent, "round.json");
  this.writeError = undefined;
  try {
    writeReviewRoundDraft(parent, "round.json", "sensitive\n", {
      darwinHelperFault: "kill-after-create",
    });
  } catch (error) {
    this.writeError = error instanceof Error ? error : new Error(String(error));
  }
});

Then("Darwinではsignalと未sanitizeを診断する", function () {
  if (process.platform !== "darwin") {
    assert.equal(this.writeError, undefined);
    assert.equal(fs.readFileSync(this.outFile, "utf8"), "sensitive\n");
    return;
  }
  assert.match(this.writeError?.message ?? "", /空にできませんでした/u);
  assert.match(this.writeError?.message ?? "", /signal SIGKILL/u);
  assert.equal(fs.readFileSync(this.outFile, "utf8"), "");
});

Given("budget-exhaustedのsessionを持つstagingがある", function () {
  createFixture(this);
  const observed = observeReviewDiff(this.root, this.base, this.head);
  const anchor = {
    scopeIds: ["SCOPE-001"],
    acceptanceCriteriaIds: ["AC-001"],
    invariantIds: [],
    diffBaseSha: this.base,
    initialHeadSha: this.head,
    initialDiffDigest: observed.digest,
  };
  const blocker = (status: string) => ({
    id: "H-001",
    severity: "High",
    status,
    source: "review",
    relation: "acceptance-violation",
    evidence: "未解決のまま6 roundを使い切る",
    path: reviewedPath,
    contractId: "AC-001",
    causedByFindingId: null,
  });
  this.session = recordReviewRound({
    staging: this.staging,
    round: parseReviewRoundInput({
      round: 1,
      previousRoundDigest: null,
      anchor,
      candidateHeadSha: this.head,
      focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
      findings: [blocker("valid")],
    }),
  });
  for (const round of [2, 3, 4, 5, 6]) {
    this.head = commitFile(
      this.root,
      reviewedPath,
      `export const reviewed = ${round};\n`,
      `fix: attempt ${round}`,
    );
    this.session = recordReviewRound({
      staging: this.staging,
      round: parseReviewRoundInput({
        round,
        previousRoundDigest: this.session.latestRoundDigest,
        anchor,
        candidateHeadSha: this.head,
        focus: {
          previousBlocking: ["H-001"],
          fixedDiff: [reviewedPath],
          adjacentScope: [],
        },
        findings: [blocker("valid")],
      }),
    });
  }
  assert.equal(this.session.status, "budget-exhausted");
  this.head = commitFile(
    this.root,
    reviewedPath,
    "export const reviewed = 9;\n",
    "fix: late",
  );
});

Given("HEADをbudget-exhausted sessionのcandidateへ戻す", function () {
  this.head = this.session.latestCandidateHeadSha;
  execFileSync("git", ["reset", "--hard", this.head], { cwd: this.root });
});

Then("budget-exhaustedのerrorで拒否し雛形を書かない", function () {
  assert.ok(this.cliError, this.cliOutput);
  assert.match(this.cliError.message, /budget-exhausted/u);
  assert.equal(fs.existsSync(this.outFile), false);
});

When(
  "--invariantだけを添えてreview round --initで次roundの雛形を書く",
  async function () {
    await runCli(this, initArguments(this, ["--invariant=INV-009"]));
    assert.equal(this.cliError, undefined, this.cliError?.message);
  },
);

Then("notesにanchorをsessionから写した旨がある", function () {
  const output: unknown = JSON.parse(this.cliOutput);
  assert.ok(output && typeof output === "object" && "notes" in output);
  assert.match(
    (output as { notes: string[] }).notes.join("\n"),
    /--invariantは無視し、anchorをsessionから写した/u,
  );
});

Then(
  "cleanup-applyの拒否は--approved-digestだけを案内し--report-hashを含まない",
  function () {
    const phase = this.completion.phases.find(
      (item) => item.phase === "cleanup-apply",
    );
    assert.ok(phase);
    const recovery = phase.recovery.join("\n");
    assert.match(recovery, /--approved-digest=<preview digest>/u);
    assert.doesNotMatch(recovery, /--report-hash/u);
  },
);

Then("session依存flagの個別報告とDC-UX根拠と発見IDの注記がある", function () {
  const read = (relative: string): string =>
    fs.readFileSync(path.join(repositoryRoot, relative), "utf8");
  assert.match(
    read("docs/specs/02_要件/01_ワークフロー要件.md"),
    /handlerが個別に報告する/u,
  );
  const template = read(".agent-skill-chain/templates/issue/04_レビュー.md");
  assert.match(template, /「JSON出力のみ」を非適用の根拠にせず/u);
  assert.match(template, /`DISC-\*`と同じ字面を使い/u);
});
