import assert from "node:assert/strict";

import {
  CI_DELIVERY_GRACE_MINUTES,
  inspectCiDelivery,
  type CiDeliveryInput,
  type CiDeliveryInspection,
} from "../../src/domain/ci-delivery.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface CiDeliveryWorld extends WorkflowWorld {
  ciDeliveryInput: CiDeliveryInput;
  ciDeliveryResult: CiDeliveryInspection;
  ciDeliveryThrown: Error | undefined;
}

const { Given, When, Then } = stepDefinitions<CiDeliveryWorld>();

const HEAD = "a".repeat(40);
const EVENT_AT = "2026-09-05T00:00:00.000Z";

/** イベント時刻から`minutes`分後のISO 8601を返す。 */
function after(minutes: number): string {
  return new Date(Date.parse(EVENT_AT) + minutes * 60000).toISOString();
}

function base(overrides: Partial<CiDeliveryInput>): CiDeliveryInput {
  return {
    runs: [],
    headSha: HEAD,
    pullRequest: 969,
    eventAt: EVENT_AT,
    observedAt: after(1),
    graceMinutes: CI_DELIVERY_GRACE_MINUTES,
    ...overrides,
  };
}

Given("失敗した該当CI runだけがある観測がある", function () {
  /**
   * **`delivered`は成否を問わない。** 成否の判定は既存の拒否点が持つ。
   * ここで混ぜると、失敗したrunを「まだ来ていない」と誤って報告する。
   */
  this.ciDeliveryInput = base({
    runs: [
      {
        runId: "1",
        headSha: HEAD,
        event: "pull_request",
        pullRequestNumbers: [969],
      },
    ],
  });
});

Given("該当CI runが無く経過が猶予時間内の観測がある", function () {
  this.ciDeliveryInput = base({
    observedAt: after(CI_DELIVERY_GRACE_MINUTES - 1),
  });
});

Given("該当CI runが無く経過が猶予時間を超えた観測がある", function () {
  this.ciDeliveryInput = base({
    observedAt: after(CI_DELIVERY_GRACE_MINUTES + 1),
  });
});

Given("該当CI runが無く経過が猶予時間ちょうどの観測がある", function () {
  /** **境界は`pending`側に含める。** 猶予時間ちょうどはまだ超えていない。 */
  this.ciDeliveryInput = base({ observedAt: after(CI_DELIVERY_GRACE_MINUTES) });
});

Given("別PRと別headと別eventのCI runだけがある観測がある", function () {
  this.ciDeliveryInput = base({
    observedAt: after(CI_DELIVERY_GRACE_MINUTES + 1),
    runs: [
      {
        runId: "1",
        headSha: HEAD,
        event: "pull_request",
        pullRequestNumbers: [970],
      },
      {
        runId: "2",
        headSha: "b".repeat(40),
        event: "pull_request",
        pullRequestNumbers: [969],
      },
      {
        runId: "3",
        headSha: HEAD,
        event: "push",
        pullRequestNumbers: [969],
      },
      {
        runId: "4",
        headSha: HEAD,
        event: "pull_request",
        pullRequestNumbers: [969, 971],
      },
    ],
  });
});

Given(
  "Issue969の実測どおり22分経過して該当CI runが無い観測がある",
  function (this: CiDeliveryWorld) {
    this.ciDeliveryInput = base({ observedAt: after(22) });
  },
);

Given("観測時刻がイベント時刻より前の観測がある", function () {
  this.ciDeliveryInput = base({ observedAt: after(-1) });
});

When("CI配送状態を判定する", function () {
  this.ciDeliveryThrown = undefined;
  try {
    this.ciDeliveryResult = inspectCiDelivery(this.ciDeliveryInput);
  } catch (error) {
    this.ciDeliveryThrown = error as Error;
  }
});

Then(
  "配送状態は {string} で人間を呼ばないよう指示する",
  function (this: CiDeliveryWorld, expected: string) {
    assert.equal(this.ciDeliveryThrown, undefined);
    assert.equal(this.ciDeliveryResult.state, expected);
    /**
     * **文言まで判定する。** stateだけを見る検査は、次の行動を取り違える変異を
     * 捕まえない。`undelivered`を人間へ上げる唯一の条件にすることが要求である。
     */
    assert.match(this.ciDeliveryResult.nextAction, /人間を呼ばないでください/u);
  },
);

Then(
  "配送状態は {string} で人間へ上げるよう指示する",
  function (this: CiDeliveryWorld, expected: string) {
    assert.equal(this.ciDeliveryThrown, undefined);
    assert.equal(this.ciDeliveryResult.state, expected);
    assert.match(this.ciDeliveryResult.nextAction, /人間へ上げてください/u);
    assert.doesNotMatch(
      this.ciDeliveryResult.nextAction,
      /人間を呼ばないでください/u,
    );
  },
);

Then("該当run件数は0件である", function () {
  assert.equal(this.ciDeliveryResult.runCount, 0);
});

Then("CI配送判定はerrorになる", function () {
  assert.ok(this.ciDeliveryThrown, "errorになっていません");
  assert.match(
    this.ciDeliveryThrown.message,
    /観測時刻がイベント時刻より前です/u,
  );
});
