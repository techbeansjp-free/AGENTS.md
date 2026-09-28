import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  invokeDecision,
  type DecisionInvokeResult,
} from "../../src/adapters/decision-invoke.js";
import { findDecisionJournalRecord } from "../../src/adapters/decision-journal-store.js";
import { resolveGitWorkspace } from "../../src/adapters/review-workspace.js";
import {
  detectQuickDisqualifiers,
  QUESTIONS,
  type ModeAnswer,
} from "../../src/domain/mode.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { main } from "../../src/cli.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface DecisionInvokeWorld extends WorkflowWorld {
  root: string;
  staging: string;
  headSha: string;
  decisionInput: unknown;
  decisionTypeId: string;
  result?: DecisionInvokeResult;
  home: string;
  rcPath: string;
  rcBefore: Buffer;
  fetchCalls: number;
  cliRuns: CliRun[];
}

interface CliRun {
  readonly label: string;
  readonly exitCode: number;
  readonly output: Record<string, unknown> | undefined;
  readonly message: string | undefined;
}

const { Given, When, Then } = stepDefinitions<DecisionInvokeWorld>();

function head(root: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function answers(): Record<string, ModeAnswer> {
  return Object.fromEntries(
    QUESTIONS.map((id) => [id, { answer: true, evidence: `${id}の固定証拠` }]),
  );
}

function createFixture(world: DecisionInvokeWorld, root: string): void {
  world.root = root;
  world.headSha = head(root);
  world.staging = createIssueStaging(root, {
    title: "decision-invoke-fixture",
    answers: answers(),
    now: new Date("2026-09-26T00:00:00.000Z"),
    requestedMode: "quick",
  }).path;
}

Given(
  "quick失格分類が検出されるchangedFilesを持つdecision invoke入力がある",
  function (this: DecisionInvokeWorld) {
    const root = this.initRepo();
    createFixture(this, root);
    this.decisionTypeId = "DCAND-001";
    this.decisionInput = {
      candidateHeadSha: this.headSha,
      subjectRef: "changed-files-fixture",
      payload: { changedFiles: ["package.json", "src/public-api/x.ts"] },
    };
  },
);

Given(
  "最新HEADにrate limit観測を持つDCAND-008入力がある",
  function (this: DecisionInvokeWorld) {
    const root = this.initRepo();
    createFixture(this, root);
    this.decisionTypeId = "DCAND-008";
    this.decisionInput = {
      candidateHeadSha: this.headSha,
      subjectRef: "PR#1485",
      payload: {
        latestHeadSha: this.headSha,
        observations: [
          {
            kind: "check-run",
            targetHeadSha: this.headSha,
            text: "CodeRabbit: rate limit exceeded for this repository",
            observedAt: "2026-09-26T00:00:00.000Z",
          },
        ],
      },
    };
  },
);

Given(
  "最新HEADの観測が無いDCAND-008入力がありproposedValueを渡す",
  function (this: DecisionInvokeWorld) {
    const root = this.initRepo();
    createFixture(this, root);
    this.decisionTypeId = "DCAND-008";
    this.decisionInput = {
      candidateHeadSha: this.headSha,
      subjectRef: "PR#1485",
      payload: { latestHeadSha: this.headSha, observations: [] },
      proposedValue: "unknown",
    };
  },
);

Given(
  "confirmedByを含むDCAND-006入力がある",
  function (this: DecisionInvokeWorld) {
    const root = this.initRepo();
    createFixture(this, root);
    this.decisionTypeId = "DCAND-006";
    this.decisionInput = {
      candidateHeadSha: this.headSha,
      subjectRef: "F-01",
      payload: { path: "src/example.ts", evidence: "file:12 反例" },
      proposedValue: "High",
      confirmedBy: "coordinator",
    };
  },
);

Given(
  "実HEADと異なるcandidateHeadShaを持つdecision invoke入力がある",
  function (this: DecisionInvokeWorld) {
    const root = this.initRepo();
    createFixture(this, root);
    this.decisionTypeId = "DCAND-001";
    this.decisionInput = {
      candidateHeadSha: "0".repeat(40),
      subjectRef: "mismatch-fixture",
      payload: { changedFiles: [] },
    };
  },
);

Given(
  "連結worktreeのstagingでDCAND-006入力がある",
  function (this: DecisionInvokeWorld) {
    const primary = this.initRepo();
    const linked = path.join(primary, ".worktrees", "linked");
    fs.mkdirSync(path.dirname(linked), { recursive: true });
    execFileSync("git", ["worktree", "add", "-q", "-b", "linked", linked], {
      cwd: primary,
    });
    createFixture(this, linked);
    this.decisionTypeId = "DCAND-006";
    this.decisionInput = {
      candidateHeadSha: this.headSha,
      subjectRef: "F-02",
      payload: { path: "src/example2.ts", evidence: "file:34 反例" },
      proposedValue: "Medium",
      confirmedBy: "coordinator",
    };
  },
);

Given(
  "候補集合外の提案を持つDCAND-009入力がある",
  function (this: DecisionInvokeWorld) {
    const root = this.initRepo();
    createFixture(this, root);
    this.decisionTypeId = "DCAND-009";
    this.decisionInput = {
      candidateHeadSha: this.headSha,
      subjectRef: "reviewer-selection",
      payload: { candidateSet: ["codex", "claude"] },
      proposedValue: "gemini",
    };
  },
);

Given(
  "Policy Allowed外の値だけを宣言したDCAND-009入力がある",
  function (this: DecisionInvokeWorld) {
    const root = this.initRepo();
    createFixture(this, root);
    this.decisionTypeId = "DCAND-009";
    this.decisionInput = {
      candidateHeadSha: this.headSha,
      subjectRef: "reviewer-selection",
      payload: { candidateSet: ["gemini", "mistral"] },
      proposedValue: "gemini",
    };
  },
);

Given(
  "Policy Allowed外の値を混入させたcandidateSetとそれに一致するproposedValueを持つDCAND-009入力がある",
  function (this: DecisionInvokeWorld) {
    const root = this.initRepo();
    createFixture(this, root);
    this.decisionTypeId = "DCAND-009";
    this.decisionInput = {
      candidateHeadSha: this.headSha,
      subjectRef: "reviewer-selection",
      // 呼び出し側がcandidateSetとproposedValueの両方に同じPolicy Allowed外の
      // 値（gemini）を宣言しても、実効candidateSetはPolicy Allowedとの積集合
      // （codex/claude）だけになるため、geminiはrejectedになる（round 1のgap是正）。
      payload: { candidateSet: ["codex", "claude", "gemini"] },
      proposedValue: "gemini",
    };
  },
);

When("invokeDecisionを実行する", function (this: DecisionInvokeWorld) {
  this.error = undefined;
  try {
    this.result = invokeDecision({
      root: this.root,
      staging: this.staging,
      decisionTypeId: this.decisionTypeId,
      input: this.decisionInput,
      apply: false,
    });
  } catch (error) {
    this.error = error instanceof Error ? error : new Error(String(error));
  }
});

When(
  "invokeDecisionをapplyつきで実行する",
  function (this: DecisionInvokeWorld) {
    this.result = invokeDecision({
      root: this.root,
      staging: this.staging,
      decisionTypeId: this.decisionTypeId,
      input: this.decisionInput,
      apply: true,
    });
  },
);

When(
  "連結worktreeでinvokeDecisionをapplyつきで実行する",
  function (this: DecisionInvokeWorld) {
    this.result = invokeDecision({
      root: this.root,
      staging: this.staging,
      decisionTypeId: this.decisionTypeId,
      input: this.decisionInput,
      apply: true,
    });
  },
);

Then(
  "resolverOutputはdetectQuickDisqualifiersの直接呼び出しと一致する",
  function (this: DecisionInvokeWorld) {
    const input = this.decisionInput as { payload: { changedFiles: string[] } };
    const direct = detectQuickDisqualifiers(input.payload.changedFiles);
    assert.deepEqual(this.result?.resolverOutput, direct);
    assert.ok(direct.length > 0, "fixtureは失格分類を含む必要があります");
  },
);

Then(
  "authorityModeはauthoritativeでeffectiveValueは{string}である",
  function (this: DecisionInvokeWorld, expected: string) {
    assert.equal(this.result?.authorityMode, "authoritative");
    assert.equal(this.result?.effectiveValue, expected);
  },
);

Then(
  "authorityModeはadvisoryでexecutorはproviderになる",
  function (this: DecisionInvokeWorld) {
    assert.equal(this.result?.authorityMode, "advisory");
    assert.equal(this.result?.executor.kind, "provider");
  },
);

Then(
  "primaryRootのdecision journalへ同じdecisionRecordIdの記録が読み返せる",
  function (this: DecisionInvokeWorld) {
    assert.ok(this.result?.applied);
    const decisionRecordId = this.result?.decisionRecordId;
    assert.ok(
      typeof decisionRecordId === "string" && decisionRecordId.length > 0,
    );
    const primaryRoot = resolveGitWorkspace(this.root).primaryRoot;
    const record = findDecisionJournalRecord(
      primaryRoot,
      this.staging,
      decisionRecordId as string,
    );
    assert.ok(record !== undefined, "journalへ記録が見つかりません");
    assert.equal(record?.decisionRecordId, decisionRecordId);
    assert.equal(record?.effectiveValue, "High");
  },
);

Then("エラーで拒否される", function (this: DecisionInvokeWorld) {
  assert.ok(this.error instanceof Error);
});

Then(
  "journalは連結worktreeでなくprimaryRoot配下に作られる",
  function (this: DecisionInvokeWorld) {
    assert.ok(this.result?.applied);
    const primaryRoot = resolveGitWorkspace(this.root).primaryRoot;
    assert.notEqual(primaryRoot, this.root);
    const decisionRecordId = this.result?.decisionRecordId as string;
    const inPrimary = findDecisionJournalRecord(
      primaryRoot,
      this.staging,
      decisionRecordId,
    );
    assert.ok(inPrimary !== undefined);
    const inLinked = findDecisionJournalRecord(
      this.root,
      this.staging,
      decisionRecordId,
    );
    assert.equal(inLinked, undefined);
  },
);

Then("rejectedである", function (this: DecisionInvokeWorld) {
  assert.equal(this.result?.rejected, true);
});

/** testだけが使うダミーのenv var名と値。実APIキーではない。 */
const JEV_TEST_ENV_VAR = "JEV_DECINV_FIXTURE_KEY";
const JEV_TEST_ENV_VALUE = "dummy-not-a-real-key";

function jevConfigPath(root: string): string {
  return path.join(root, ".agent-skill-chain", "local", "jev-provider.json");
}

/** 指定directory配下で、名前が一致するfileを再帰的に数える（配置のずれに依存しない）。 */
function countFilesNamed(directory: string, name: string): number {
  if (!fs.existsSync(directory)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(directory, {
    withFileTypes: true,
    recursive: true,
  })) {
    if (entry.name === name) count += 1;
  }
  return count;
}

/**
 * `main()`をin-processで呼び、bin（`bin/agent-skill-chain.ts`）と同じく
 * 例外を終了値1へ写す。`globalThis.fetch`は呼び出し回数を数えるstubへ
 * 差し替え、実networkへは出ない。env varとHOMEは呼び出し後に元へ戻す。
 */
async function runCli(
  world: DecisionInvokeWorld,
  label: string,
  args: string[],
  env: Record<string, string>,
): Promise<CliRun> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalFetch = globalThis.fetch;
  const originalEnv = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  let stdout = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;
  globalThis.fetch = (async () => {
    world.fetchCalls += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  Object.assign(process.env, env);
  try {
    const exitCode = await main(args);
    return {
      label,
      exitCode,
      output: JSON.parse(stdout) as Record<string, unknown>,
      message: undefined,
    };
  } catch (error) {
    return {
      label,
      exitCode: 1,
      output: undefined,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    process.stdout.write = originalWrite;
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function writeDcand009Input(world: DecisionInvokeWorld, subjectRef: string) {
  fs.writeFileSync(
    path.join(world.root, "decision-input.json"),
    JSON.stringify({
      candidateHeadSha: world.headSha,
      subjectRef,
      payload: { candidateSet: ["codex", "claude"] },
      proposedValue: "codex",
    }),
  );
}

Given(
  "Jevを有効にした設定fileとenv varを持つfixtureでDCAND-009入力がある",
  function (this: DecisionInvokeWorld) {
    const root = this.initRepo();
    createFixture(this, root);
    this.fetchCalls = 0;
    this.cliRuns = [];
    fs.mkdirSync(path.dirname(jevConfigPath(root)), { recursive: true });
    fs.writeFileSync(
      jevConfigPath(root),
      JSON.stringify(
        {
          enabled: true,
          apiKeyEnvVar: JEV_TEST_ENV_VAR,
          endpoint: "https://example.invalid/v1",
          model: "fixture-model",
        },
        null,
        2,
      ),
    );
    writeDcand009Input(this, "reviewer-selection-1");
  },
);

async function invokeViaCli(world: DecisionInvokeWorld): Promise<void> {
  world.cliRuns.push(
    await runCli(
      world,
      "decision invoke",
      [
        "decision",
        "invoke",
        `--root=${world.root}`,
        `--staging=${world.staging}`,
        "--type=DCAND-009",
        "--input=decision-input.json",
        "--apply",
      ],
      { [JEV_TEST_ENV_VAR]: JEV_TEST_ENV_VALUE },
    ),
  );
}

When(
  "CLIからdecision invokeをapplyつきで実行する",
  async function (this: DecisionInvokeWorld) {
    await invokeViaCli(this);
  },
);

When(
  "Jev設定fileを不正なJSONへ置き換えてCLIからdecision invokeをapplyつきで再実行する",
  async function (this: DecisionInvokeWorld) {
    fs.writeFileSync(jevConfigPath(this.root), '{"enabled": true,');
    writeDcand009Input(this, "reviewer-selection-2");
    await invokeViaCli(this);
  },
);

Then(
  "fetchは呼ばれずJev fieldとjev-shadow記録が無く終了値は0である",
  function (this: DecisionInvokeWorld) {
    const run = this.cliRuns.at(-1);
    assert.ok(run !== undefined);
    assert.equal(run.message, undefined, run.message);
    assert.equal(run.exitCode, 0);
    assert.equal(this.fetchCalls, 0, "fetchが呼ばれました");
    const output = run.output ?? {};
    assert.equal(Object.hasOwn(output, "jevShadow"), false, "jevShadow");
    assert.equal(
      Object.hasOwn(output, "jevProviderConfig"),
      false,
      "jevProviderConfig",
    );
    assert.equal(output.effectiveValue, "codex");
    assert.equal(output.applied, true);
    assert.equal(
      JSON.stringify(output).includes(JEV_TEST_ENV_VALUE),
      false,
      "env varの値が出力に現れました",
    );
    const primaryRoot = resolveGitWorkspace(this.root).primaryRoot;
    assert.equal(countFilesNamed(primaryRoot, "jev-shadow.jsonl"), 0);
  },
);

const REMOVED_SUBCOMMAND_DIAGNOSTICS = [
  "不明なコマンドです: decision configure",
  "不明なコマンドです: decision configure",
  "不明なコマンドです: decision label",
  "不明なコマンドです: decision evaluate",
] as const;

Given(
  "一時HOMEと一時shell起動fileとJev env varを持つfixtureがある",
  function (this: DecisionInvokeWorld) {
    const root = this.initRepo();
    createFixture(this, root);
    this.fetchCalls = 0;
    this.cliRuns = [];
    this.home = this.temp();
    this.rcPath = path.join(this.temp(), ".bashrc");
    fs.writeFileSync(this.rcPath, "# fixture shell rc\nexport PATH=$PATH\n");
    this.rcBefore = fs.readFileSync(this.rcPath);
    fs.writeFileSync(
      path.join(root, "label-input.json"),
      JSON.stringify({
        decisionRecordId: "dr-fixture",
        referenceValue: "codex",
        labelSource: "independent-review",
        evidenceRefs: ["fixture"],
        labeledAt: "2026-09-28T00:00:00.000Z",
      }),
    );
  },
);

When(
  "撤去したdecision subcommandを旧flag付きでCLIから実行する",
  async function (this: DecisionInvokeWorld) {
    const env = {
      HOME: this.home,
      [JEV_TEST_ENV_VAR]: JEV_TEST_ENV_VALUE,
    };
    const invocations: ReadonlyArray<readonly [string, string[]]> = [
      [
        "decision configure --shell-rc-append",
        [
          "decision",
          "configure",
          "--provider=jev",
          `--root=${this.root}`,
          `--api-key-env-var=${JEV_TEST_ENV_VAR}`,
          "--shell-rc-append",
          `--rc-path=${this.rcPath}`,
          "--apply",
          "--confirm=APPEND",
        ],
      ],
      [
        "decision configure",
        [
          "decision",
          "configure",
          "--provider=jev",
          `--root=${this.root}`,
          `--api-key-env-var=${JEV_TEST_ENV_VAR}`,
          "--endpoint=https://example.invalid/v1",
          "--model=fixture-model",
          "--apply",
        ],
      ],
      [
        "decision label",
        [
          "decision",
          "label",
          `--root=${this.root}`,
          `--staging=${this.staging}`,
          "--input=label-input.json",
          "--apply",
        ],
      ],
      [
        "decision evaluate",
        [
          "decision",
          "evaluate",
          `--staging=${this.staging}`,
          `--root=${this.root}`,
        ],
      ],
    ];
    for (const [label, args] of invocations)
      this.cliRuns.push(await runCli(this, label, args, env));
  },
);

Then(
  "各subcommandは終了値1で不明なコマンドとして拒否される",
  function (this: DecisionInvokeWorld) {
    assert.equal(this.cliRuns.length, REMOVED_SUBCOMMAND_DIAGNOSTICS.length);
    this.cliRuns.forEach((run, index) => {
      assert.equal(run.exitCode, 1, `${run.label}の終了値`);
      assert.ok(
        run.message?.startsWith(REMOVED_SUBCOMMAND_DIAGNOSTICS[index]) === true,
        `${run.label}の診断: ${String(run.message)}`,
      );
    });
    assert.equal(this.fetchCalls, 0);
  },
);

Then(
  "一時shell起動fileは変更されずjev-provider.json・jev.env・evaluation-labels.jsonlは作られない",
  function (this: DecisionInvokeWorld) {
    assert.deepEqual(fs.readFileSync(this.rcPath), this.rcBefore);
    const primaryRoot = resolveGitWorkspace(this.root).primaryRoot;
    assert.equal(countFilesNamed(this.root, "jev-provider.json"), 0);
    assert.equal(countFilesNamed(this.home, "jev.env"), 0);
    assert.equal(countFilesNamed(primaryRoot, "evaluation-labels.jsonl"), 0);
  },
);
