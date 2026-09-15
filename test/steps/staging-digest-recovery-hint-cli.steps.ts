import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { assertWorkflowReadyForDelivery } from "../../src/cli.js";
import { assertStoredStagingDigestForTest } from "../../src/adapters/review-session.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { STEP_JOURNAL_FILE } from "../../src/domain/workflow.js";
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
  const named = /--step=([0-9]+(?:または[0-9]+)*)/u.exec(this.diagnostic);
  assert.ok(named, `診断が対象Stepを名指ししていません: ${this.diagnostic}`);
  assert.deepEqual(named[1].split("または").map(Number), [1, 4, 9]);
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
