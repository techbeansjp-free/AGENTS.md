import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { assertWorkflowReadyForDelivery } from "../../src/cli.js";
import { assertStoredStagingDigestForTest } from "../../src/adapters/review-session.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { STEP_JOURNAL_FILE } from "../../src/domain/workflow.js";
import {
  DELIVERY_STATE_FILE,
  pullRequestTerminalEvidenceId,
} from "../../src/domain/delivery-state.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

/**
 * 案内が**CLI経路を通って利用者へ届く**ことを検査する（REQ-WF-024、FR-03）。
 *
 * **純関数のunit testはcall siteの委譲欠落を素通りする。** `stagingDigestRecoveryHint`が
 * 正しい文言を返しても、`assertWorkflowReadyForDelivery`が旧定数を連結したままなら
 * 利用者には届かない。3 call siteのうち1つだけを元へ戻す変異は、合成経路を通る
 * このscenarioでしかkillできない。
 */
interface CliHintWorld extends WorkflowWorld {
  staging: string;
  diagnostic: string;
}

const { Given, When, Then } = stepDefinitions<CliHintWorld>();
const instant = new Date("2026-09-15T00:00:00.000Z");

function answers(): Record<string, { answer: true; evidence: string }> {
  return Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => [
      `Q-0${index + 1}`,
      { answer: true as const, evidence: "対象外である根拠を確認した" },
    ]),
  );
}

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

Given("Step 10まで記録した隔離stagingとdigest不一致がある", function () {
  const root = this.initRepo();
  this.staging = createIssueStaging(root, {
    title: "recovery-hint-cli",
    answers: answers(),
    now: instant,
    requestedMode: "quick",
  }).path;
  const journal = path.join(this.staging, STEP_JOURNAL_FILE);
  /**
   * **skillIdはStep定義と一致させる。** 一致しないentryは`readWorkflowJournal`が
   * 読み捨て、Step 10が記録済みに見えなくなる。fixtureの不備が実装の欠陥に見える。
   */
  const skillIds = new Map([
    [1, "step-01-request"],
    [4, "step-04-issue-sync"],
    [9, "step-09-implement"],
    [10, "step-10-review"],
  ]);
  const sha = "a".repeat(40);
  for (const [step, skillId] of skillIds)
    fs.appendFileSync(
      journal,
      `${JSON.stringify({
        step,
        skillId,
        mode: "quick",
        recordedAt: instant.toISOString(),
        artifacts: ["00_要求定義.md"],
        evidence: "fixtureが記録した",
        /**
         * **Step 10のentryはreviewSession bindingを持たないと読み捨てられる。**
         * 欠けるとStep 10が記録済みに見えず、案内の分岐が誤って旧文言を返す。
         */
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
  /** 記録後にstagingを編集し、digestを保存値から外す */
  fs.appendFileSync(
    path.join(this.staging, "00_要求定義.md"),
    "\n是正のため追記した\n",
  );
});

/**
 * **journalとdelivery stateの読み取りは互いに独立でなければならない。**
 *
 * 両方を1つの`try`で囲むと、delivery stateを読めない時点でjournalのStep 11判定ごと
 * 落ち、**terminal状態の利用者へ必ず失敗する再記録操作を案内する**
 * （PR #1402の外部review指摘）。delivery stateをdirectoryにして読み取りを
 * 確定的に失敗させ、journal側のStep 11だけで終端案内へ倒れることを観測する。
 * 権限に依存しないよう`chmod`ではなくdirectoryを使う。
 */
Given(
  "Step 11まで記録しdelivery stateを読み取れない隔離stagingとdigest不一致がある",
  function () {
    const root = this.initRepo();
    this.staging = createIssueStaging(root, {
      title: "recovery-hint-terminal",
      answers: answers(),
      now: instant,
      requestedMode: "quick",
    }).path;
    const journal = path.join(this.staging, STEP_JOURNAL_FILE);
    const sha = "a".repeat(40);
    const skillIds = new Map([
      [1, "step-01-request"],
      [4, "step-04-issue-sync"],
      [9, "step-09-implement"],
      [10, "step-10-review"],
      [11, "step-11-pr"],
    ]);
    for (const [step, skillId] of skillIds)
      fs.appendFileSync(
        journal,
        `${JSON.stringify({
          step,
          skillId,
          mode: "quick",
          recordedAt: instant.toISOString(),
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
    fs.mkdirSync(path.join(this.staging, DELIVERY_STATE_FILE), {
      recursive: true,
    });
    fs.appendFileSync(
      path.join(this.staging, "00_要求定義.md"),
      "\n是正のため追記した\n",
    );
  },
);

/**
 * **delivery stateだけがterminalを示す隔離stagingを作る。**
 *
 * journalにStep 11 entryを置かないことが要点である。`recordStep11`は
 * `merge-observed`からしか遷移しないため、**merge観測とStep 11記録の間には
 * journalがterminalを示さない窓が必ず開く**。この窓でterminal判定を落とすと、
 * 置けない上流再確定を案内することになる（Issue #1312のI-01）。
 */
function writeTerminalDeliveryState(staging: string): void {
  const sha = "a".repeat(40);
  const base = "b".repeat(40);
  const digest = "c".repeat(64);
  const at = instant.toISOString();
  const create = {
    baseRef: "main",
    baseSha: base,
    bodyClosingDigest: digest,
    dispatchClaimedAt: at,
    headRef: "fix/recovery-hint",
    headSha: sha,
    issue: 1,
    issueUrl: "https://github.com/o/n/issues/1",
    preparedAt: at,
    pullRequestDigest: digest,
    repository: "o/n",
  };
  const pr = {
    boundAt: at,
    number: 1,
    url: "https://github.com/o/n/pull/1",
  };
  fs.writeFileSync(
    path.join(staging, DELIVERY_STATE_FILE),
    JSON.stringify({
      schemaVersion: "agent-skill-chain/delivery-state/v1",
      revision: 4,
      state: "step11-recorded",
      create,
      pr,
      merge: null,
      step11: {
        outcome: "pull-request",
        recordedAt: at,
        journalDigest: digest,
        evidenceId: pullRequestTerminalEvidenceId(create, pr),
      },
      reconciliation: null,
    }),
  );
}

function writeJournalSteps(staging: string, steps: readonly number[]): void {
  const sha = "a".repeat(40);
  const skillIds = new Map([
    [1, "step-01-request"],
    [4, "step-04-issue-sync"],
    [9, "step-09-implement"],
    [10, "step-10-review"],
    [11, "step-11-pr"],
  ]);
  for (const step of steps)
    fs.appendFileSync(
      path.join(staging, STEP_JOURNAL_FILE),
      `${JSON.stringify({
        step,
        skillId: skillIds.get(step),
        mode: "quick",
        recordedAt: instant.toISOString(),
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
}

Given(
  "journalがStep 11を持たずdelivery stateだけがterminalな隔離stagingとdigest不一致がある",
  function () {
    const root = this.initRepo();
    this.staging = createIssueStaging(root, {
      title: "recovery-hint-delivery-terminal",
      answers: answers(),
      now: instant,
      requestedMode: "quick",
    }).path;
    writeJournalSteps(this.staging, [1, 4, 9, 10]);
    writeTerminalDeliveryState(this.staging);
    fs.appendFileSync(
      path.join(this.staging, "00_要求定義.md"),
      "\n是正のため追記した\n",
    );
  },
);

Given(
  "journalを読み取れずdelivery stateがterminalな隔離stagingとdigest不一致がある",
  function () {
    const root = this.initRepo();
    this.staging = createIssueStaging(root, {
      title: "recovery-hint-journal-unreadable",
      answers: answers(),
      now: instant,
      requestedMode: "quick",
    }).path;
    writeTerminalDeliveryState(this.staging);
    /** journalをdirectoryにして読み取りを確定的に失敗させる */
    const journal = path.join(this.staging, STEP_JOURNAL_FILE);
    fs.rmSync(journal);
    fs.mkdirSync(journal);
    fs.appendFileSync(
      path.join(this.staging, "00_要求定義.md"),
      "\n是正のため追記した\n",
    );
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

Then("返された診断に上流Step再確定の案内が含まれる", function () {
  assert.match(
    this.diagnostic,
    /digestが一致しません|同期済み記録から変化しています/u,
    "digest不一致の判定そのものが起きていません",
  );
  assert.match(
    this.diagnostic,
    /--reconfirm/u,
    "案内がCLI経路を通って届いていません。call siteが委譲していない可能性があります",
  );
  /**
   * **範囲表記ではなく記録済みの具体Stepを名指しすることまで縛る。** 部分一致だと
   * 未記録のStepを含む案内も通り、利用者が選んだ時点で拒否される。
   */
  assert.deepEqual(citedReconfirmSteps(this.diagnostic), [1, 4, 9]);
});

/**
 * **3 call siteのうちreview session更新前検査は別のadapterにある。**
 * delivery側だけを検査すると、この経路の委譲を旧案内へ戻す変異が生存する
 * （round 1のI-05・変異D3）。経路ごとに合成を観測する。
 */
When("review session更新前検査を実行する", function () {
  this.diagnostic = "";
  try {
    assertStoredStagingDigestForTest(this.staging);
  } catch (error) {
    this.diagnostic = error instanceof Error ? error.message : String(error);
  }
});

Then("返された診断が上流再確定を名指しせず内容を戻す手順を示す", function () {
  assert.match(
    this.diagnostic,
    /digestが一致しません|同期済み記録から変化しています/u,
    "digest不一致の判定そのものが起きていません",
  );
  assert.doesNotMatch(
    this.diagnostic,
    /--reconfirm/u,
    "terminal状態で上流再確定を案内すると、必ず失敗する手順を示すことになる",
  );
  assert.match(
    this.diagnostic,
    /編集前の内容へ戻す/u,
    "delivery stateの読み取り失敗がjournalのStep 11判定ごと落ちています",
  );
});
