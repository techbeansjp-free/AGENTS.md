import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  STEP_JOURNAL_FILE,
  stagingDigestRecoveryHint,
} from "../../src/domain/workflow.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { main } from "../../src/cli.js";
import { readStoredStagingRecord } from "../../src/domain/staging.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

/**
 * staging digest不一致の復旧案内（REQ-WF-024）を検査する。
 *
 * **案内が名指しする手順は、その状態で実際に成功するものに限る。** Step 10記録後に
 * 最新Stepの再記録を案内すると必ず失敗し、Step 11記録後に上流再確定を案内しても
 * 必ず失敗する。**どちらの誤りも反対側で繰り返さないよう、3状態すべてを判定する。**
 */
interface HintWorld extends WorkflowWorld {
  recordedSteps: number[];
  terminalDelivery: boolean;
  hint: string;
  documents: Array<{ path: string; text: string }>;
  staging: string;
  digestBefore: string;
  digestAfter: string;
  accepted: boolean;
}

const { Given, When, Then } = stepDefinitions<HintWorld>();
const repositoryRoot = process.cwd();

const WORKFLOW_DOCUMENT = ".agent-skill-chain/docs/01_開発ワークフロー.md";
const STEP_TEN_SKILL = ".agent-skill-chain/skills/step-10-review/SKILL.md";

/**
 * 案内が印字したcommandを取り出し、**1件ずつが単独で実行できる形か**まで検査する。
 *
 * 件数や最初の数字だけを見ると、複数候補を1つの`--step`値へ連結する変異
 * （`--step=1または4`）が生存する。その値は`workflowStepNumber`の`/^\d+$/`に
 * 一致せずCLIが必ず拒否するため、**案内どおり実行すると失敗する**という
 * 本要件が消そうとした欠陥そのものになる（PR #1402の外部review指摘）。
 */
function citedReconfirmSteps(text: string): number[] {
  const commands = [...text.matchAll(/workflow record[^、]*/gu)].map((match) =>
    match[0].trim(),
  );
  assert.ok(commands.length > 0, `案内がcommandを示していません: ${text}`);
  return commands.map((command) => {
    const matched = /^workflow record --step=(\d+) --reconfirm$/u.exec(command);
    assert.ok(
      matched,
      `案内したcommandが単独で実行できる形ではありません: ${command}`,
    );
    return Number(matched[1]);
  });
}

Given(
  "Step 10を記録しStep 11を記録していないjournalの記録状態がある",
  function () {
    this.recordedSteps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  },
);

Given("Step 10を記録していないjournalの記録状態がある", function () {
  this.recordedSteps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
});

Given("Step 11まで記録したjournalの記録状態がある", function () {
  this.recordedSteps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  this.terminalDelivery = false;
});

Given("Step 10まで記録しdelivery stateがterminalな記録状態がある", function () {
  /**
   * **journalにStep 11 entryが無くてもterminalになりうる。** merge観測と
   * Step 11記録の間に必ずこの窓が開く。journalのStep集合だけを見ると見落とす。
   */
  this.recordedSteps = [0, 1, 4, 9, 10];
  this.terminalDelivery = true;
});

Given("Step 10まで記録しquickのStep集合を持つ記録状態がある", function () {
  /** quickは0,1,4,9,10,11しか持たない。2,3,5〜8は先行通常entryが無く拒否される */
  this.recordedSteps = [0, 1, 4, 9, 10];
  this.terminalDelivery = false;
});

Given("Step 10まで記録しstagingを編集した隔離stagingがある", function () {
  const root = this.initRepo();
  this.staging = createIssueStaging(root, {
    title: "recovery-hint-accept",
    answers: Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [
        `Q-0${index + 1}`,
        { answer: true as const, evidence: "対象外である根拠を確認した" },
      ]),
    ) as never,
    now: new Date("2026-09-15T00:00:00.000Z"),
    requestedMode: "quick",
  }).path;
  const sha = "a".repeat(40);
  for (const [step, skillId] of [
    [1, "step-01-request"],
    [4, "step-04-issue-sync"],
    [9, "step-09-implement"],
    [10, "step-10-review"],
  ] as Array<[number, string]>)
    fs.appendFileSync(
      path.join(this.staging, STEP_JOURNAL_FILE),
      `${JSON.stringify({
        step,
        skillId,
        mode: "quick",
        recordedAt: "2026-09-15T00:00:00.000Z",
        artifacts: ["00_要求定義.md"],
        evidence: "fixtureが記録した",
        ...(step === 10
          ? {
              reviewSession: {
                sessionId: "b".repeat(64),
                roundDigest: "c".repeat(64),
                headSha: sha,
              },
            }
          : {}),
        ...(step === 9 ? { implementationHeadSha: sha } : {}),
      })}\n`,
    );
  fs.appendFileSync(
    path.join(this.staging, "00_要求定義.md"),
    "\n是正のため追記した\n",
  );
  this.digestBefore = readStoredStagingRecord(this.staging).digest;
});

Given("配布される規範文書とStep 10のskill契約がある", function () {
  this.documents = [WORKFLOW_DOCUMENT, STEP_TEN_SKILL].map((relative) => ({
    path: relative,
    text: fs.readFileSync(path.join(repositoryRoot, relative), "utf8"),
  }));
});

When("staging digest不一致の案内を生成する", function () {
  this.hint = stagingDigestRecoveryHint(
    this.recordedSteps,
    this.terminalDelivery,
  );
});

When("案内が名指しする上流Stepの再確定を適用する", async function () {
  /**
   * **案内が印字した完全なcommandを、そのまま公開CLIへ渡して実行する。**
   *
   * 以前は`--step=`の値から最初の数字だけを抜き出し`appendWorkflowJournalEntry`を
   * 直接呼んでいた。その形では`--step=1または4または9`のように**CLIが必ず拒否する
   * 値を案内していても受理に見え**、AC-WF-024の中心条項「案内した手順がその状態で
   * 実際に受理される」を測れていなかった（PR #1402の外部review指摘）。
   *
   * **argvを案内文から組み立てる。** 固定値で実行すると、案内が別のStepや不正な値を
   * 名指しするよう変異しても検出できない。`workflow record`から次の区切りまでを
   * 1 commandとして切り出すため、複数候補を1つの`--step`へ連結する変異は
   * そのまま不正なargvになり`workflowStepNumber`が拒否する。
   */
  const hint = stagingDigestRecoveryHint([0, 1, 4, 9, 10], false);
  const commands = [...hint.matchAll(/workflow record[^、]*/gu)].map((match) =>
    match[0].trim(),
  );
  assert.ok(
    commands.length > 0,
    `案内が実行可能なcommandを示していません: ${hint}`,
  );
  this.accepted = false;
  for (const command of commands) {
    /**
     * **`--staging`・`--evidence`・`--artifact`だけを足す。** これらは案内文へ
     * 含めない運用値であり、`--step`と`--reconfirm`は案内が示した字面をそのまま使う。
     * Step 4の再確定は同期証拠に64桁hex digestとsync語を要求するため、
     * どのStepでも満たす証跡を渡す。
     */
    const status = await main([
      ...command.split(/\s+/u),
      `--staging=${this.staging}`,
      `--evidence=sync digest ${"0".repeat(64)} 案内どおり上流Stepを再確定した`,
      "--artifact=00_要求定義.md",
    ]);
    assert.equal(status, 0, `案内したcommandが受理されません: ${command}`);
  }
  this.accepted = true;
  this.digestAfter = readStoredStagingRecord(this.staging).digest;
});

When("上流再確定の記述を読み取る", function () {
  assert.equal(this.documents.length, 2, "走査対象を読み取れません");
});

Then("案内が上流Step再確定と対象Step範囲を名指しする", function () {
  assert.match(this.hint, /--reconfirm/u);
  assert.match(this.hint, /workflow record/u);
  /**
   * **対象Stepを具体値で名指しする。** 範囲表記だけでは、modeによって
   * 存在しないStepまで含んでしまう。記録済みの上流Stepだけが選べる。
   */
  assert.deepEqual(citedReconfirmSteps(this.hint), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  /** 上流Stepを再確定しdigestを再固定するという行動まで示す */
  assert.match(this.hint, /上流Stepを再確定/u);
  assert.match(this.hint, /digestを再固定/u);
});

Then("案内が最新Stepの再記録を示し上流再確定を名指ししない", function () {
  assert.match(this.hint, /--step=<最新のStep>/u);
  assert.doesNotMatch(
    this.hint,
    /--reconfirm/u,
    "Step 10記録前に上流再確定を案内すると、使えない手順を示すことになる",
  );
});

Then("追記が受理されstaging digestが再固定される", function () {
  assert.equal(this.accepted, true, "案内どおりの再確定が受理されませんでした");
  assert.notEqual(
    this.digestAfter,
    this.digestBefore,
    "staging digestが再固定されていません",
  );
  /** 再固定後も是正した内容が残る。案内が目的を達したことの観測 */
  assert.ok(
    fs
      .readFileSync(path.join(this.staging, "00_要求定義.md"), "utf8")
      .includes("是正のため追記した"),
    "是正した内容が残っていません",
  );
});

Then("案内が上流再確定を名指しせず内容を戻す手順を示す", function () {
  assert.doesNotMatch(
    this.hint,
    /--reconfirm/u,
    "上流再確定を置けない状態で案内すると、必ず失敗する手順を示すことになる",
  );
  /** 行動可能な次の1手を持つ。「編集しない」は既に編集した後では行動にならない */
  assert.match(this.hint, /編集前の内容へ戻す/u);
});

Then(
  "案内が記録済みの上流Stepだけを名指しし未記録のStepを含まない",
  function () {
    const cited = citedReconfirmSteps(this.hint);
    assert.deepEqual(
      cited,
      [1, 4, 9],
      "記録済みの上流Stepだけを名指ししていません",
    );
    for (const absent of [2, 3, 5, 6, 7, 8])
      assert.ok(
        !cited.includes(absent),
        `未記録のStepを名指ししています: ${absent}`,
      );
  },
);

Then("両方に上流再確定の記述がある", function () {
  for (const { path: relative, text } of this.documents) {
    assert.match(
      text,
      /--reconfirm/u,
      `上流再確定への到達経路がありません: ${relative}`,
    );
    assert.match(
      text,
      /上流Step/u,
      `上流再確定の説明がありません: ${relative}`,
    );
  }
  /**
   * **規則本文は規範文書が唯一所有する。** skillが手順の条件まで書くと、
   * 規範を空にしても両方の記述が残って合格する。
   */
  const [workflow, skill] = this.documents;
  assert.match(workflow.text, /順序判定から除外/u);
  /**
   * **1字面だけを見ると、別の規則本文を複写しても検出できない。** 規範文書だけが
   * 所有する条件を複数挙げ、skillがそのいずれも持たないことを確かめる。
   */
  for (const owned of [
    /順序判定から除外/u,
    /merge-observed/u,
    /記録済みの上流Step/u,
  ])
    assert.doesNotMatch(
      skill.text,
      owned,
      `skillは参照だけを持ち、規則本文を複製しない: ${String(owned)}`,
    );
});
