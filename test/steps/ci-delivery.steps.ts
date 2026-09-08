import assert from "node:assert/strict";

import {
  CI_DELIVERY_GRACE_MINUTES,
  inspectCiDelivery,
  reconcileFixedMergeRun,
  type CiDeliveryInput,
  type CiDeliveryInspection,
  type FixedMergeRunIdentity,
  type FixedMergeRunObservation,
} from "../../src/domain/ci-delivery.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface CiDeliveryWorld extends WorkflowWorld {
  ciDeliveryInput: CiDeliveryInput;
  ciDeliveryResult: CiDeliveryInspection;
  ciDeliveryThrown: Error | undefined;
  fixedMergeIdentity: FixedMergeRunIdentity;
  fixedMergeObservation: FixedMergeRunObservation;
  fixedMergeResults: { label: string; mismatches: readonly string[] }[];
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

/**
 * **merge前の選別とmerge後の照合を、同じfixtureで対比する。**
 * 空の関連PRはmerge前では拒否、merge後では受理という**逆向きの扱い**であり、
 * 片方を他方へ流用すると安全条件が緩む（Issue #1280）。
 */
Given("固定merge identityと固定run観測の組がある", function () {
  this.fixedMergeIdentity = {
    runId: "42",
    repository: "o/r",
    headSha: HEAD,
    headBranch: "feature/x",
    pullRequest: 1,
  };
  this.fixedMergeObservation = {
    runId: "42",
    repository: "o/r",
    headRepository: "o/r",
    event: "pull_request",
    headSha: HEAD,
    headBranch: "feature/x",
    status: "completed",
    conclusion: "success",
    pullRequestNumbers: [],
  };
});
When("merge後の固定run照合を評価する", function () {
  const base = this.fixedMergeObservation;
  const cases: { label: string; observed: FixedMergeRunObservation }[] = [
    { label: "空の関連PR", observed: base },
    { label: "対象PRのみ", observed: { ...base, pullRequestNumbers: [1] } },
    { label: "別PR混入", observed: { ...base, pullRequestNumbers: [2] } },
    {
      label: "対象PRと別PR",
      observed: { ...base, pullRequestNumbers: [1, 2] },
    },
    { label: "runId不一致", observed: { ...base, runId: "43" } },
    { label: "repository不一致", observed: { ...base, repository: "x/y" } },
    {
      label: "headRepository不一致",
      observed: { ...base, headRepository: "fork/y" },
    },
    { label: "event不一致", observed: { ...base, event: "push" } },
    { label: "headSha不一致", observed: { ...base, headSha: "b".repeat(40) } },
    {
      label: "headBranch不一致",
      observed: { ...base, headBranch: "feature/other" },
    },
    { label: "status未完了", observed: { ...base, status: "in_progress" } },
    { label: "conclusion失敗", observed: { ...base, conclusion: "failure" } },
    /** **欄名を残して観測値だけ空にする変異。** 空を一致へ倒さない。 */
    { label: "conclusion空", observed: { ...base, conclusion: "" } },
    { label: "headSha空", observed: { ...base, headSha: "" } },
    { label: "status空", observed: { ...base, status: "" } },
  ];
  /**
   * **固定した側が空の場合を別枠で測る**（Issue #1280）。
   *
   * 観測側だけを空にする変異は`"" !== "success"`で普通に不一致になるため、
   * **`expected === ""`の歯止めを1文字も検査しない。** `state.merge.ciRunId`が
   * 空文字のまま保存されると、観測側も空なら照合が空虚に成立する。
   * **両側が空でも一致にしない**ことをここで固定する。
   */
  const emptyFixedCases: {
    label: string;
    fixed: FixedMergeRunIdentity;
    observed: FixedMergeRunObservation;
  }[] = [
    {
      label: "固定runIdが空",
      fixed: { ...this.fixedMergeIdentity, runId: "" },
      observed: { ...base, runId: "" },
    },
    {
      label: "固定repositoryが空",
      fixed: { ...this.fixedMergeIdentity, repository: "" },
      observed: { ...base, repository: "", headRepository: "" },
    },
    {
      label: "固定headShaが空",
      fixed: { ...this.fixedMergeIdentity, headSha: "" },
      observed: { ...base, headSha: "" },
    },
    {
      label: "固定headBranchが空",
      fixed: { ...this.fixedMergeIdentity, headBranch: "" },
      observed: { ...base, headBranch: "" },
    },
  ];
  this.fixedMergeResults = [
    ...cases.map(({ label, observed }) => ({
      label,
      mismatches: reconcileFixedMergeRun(this.fixedMergeIdentity, observed)
        .mismatches,
    })),
    ...emptyFixedCases.map(({ label, fixed, observed }) => ({
      label,
      mismatches: reconcileFixedMergeRun(fixed, observed).mismatches,
    })),
  ];
});
Then(
  "全field一致だけが成立し各不一致と他PR混入は名指しで拒否される",
  function () {
    const by = (label: string): readonly string[] =>
      this.fixedMergeResults.find((entry) => entry.label === label)
        ?.mismatches ?? ["見つかりません"];
    /** **merge後は空の関連PRを受理する。** PRが閉じると必ず空になる。 */
    assert.deepEqual(by("空の関連PR"), []);
    assert.deepEqual(by("対象PRのみ"), []);
    /** **他PRの混入は拒否する。** 別PRが同一headをopenで持つ場合に取り違えない。 */
    assert.deepEqual(by("別PR混入"), ["pullRequestNumbers"]);
    assert.deepEqual(by("対象PRと別PR"), ["pullRequestNumbers"]);
    /** **不一致は名指しする。** 「一致しません」だけにしない。 */
    for (const [label, field] of [
      ["runId不一致", "runId"],
      ["repository不一致", "repository"],
      ["headRepository不一致", "headRepository"],
      ["event不一致", "event"],
      ["headSha不一致", "headSha"],
      ["headBranch不一致", "headBranch"],
      ["status未完了", "status"],
      ["conclusion失敗", "conclusion"],
      ["conclusion空", "conclusion"],
      ["headSha空", "headSha"],
      ["status空", "status"],
    ] as const)
      assert.deepEqual(by(label), [field], `${label}の名指しが違います`);
    /**
     * **固定した側が空なら、観測が同じ空でも一致にしない。**
     * これを落とすと空のidentityで照合が空虚に成立する。
     */
    assert.deepEqual(by("固定runIdが空"), ["runId"]);
    assert.deepEqual(by("固定repositoryが空"), [
      "repository",
      "headRepository",
    ]);
    assert.deepEqual(by("固定headShaが空"), ["headSha"]);
    assert.deepEqual(by("固定headBranchが空"), ["headBranch"]);
  },
);
Given("関連PRが空のrunと対象PRのrunがある", function () {
  this.ciDeliveryInput = {
    runs: [
      {
        runId: "41",
        headSha: HEAD,
        event: "pull_request",
        pullRequestNumbers: [],
      },
      {
        runId: "42",
        headSha: HEAD,
        event: "pull_request",
        pullRequestNumbers: [1],
      },
    ],
    headSha: HEAD,
    pullRequest: 1,
    eventAt: EVENT_AT,
    observedAt: EVENT_AT,
    graceMinutes: CI_DELIVERY_GRACE_MINUTES,
  };
});
Then("空の関連PRは該当0件になり対象PRのrunだけが該当する", function () {
  /**
   * **merge前の選別は空を拒否し続ける。** ここが緩むと、fork由来や旧PRの残骸runで
   * mergeが通る。merge後の照合とは逆向きの安全側である。
   */
  assert.equal(this.ciDeliveryResult.state, "delivered");
  assert.equal(this.ciDeliveryResult.runCount, 1);
});

Then("診断は {string} を含む", function (fragment: string) {
  assert.equal(this.ciDeliveryThrown, undefined);
  assert.ok(
    this.ciDeliveryResult.nextAction.includes(fragment),
    `診断が期待の断片を含みません: ${this.ciDeliveryResult.nextAction}`,
  );
});
Then("head SHA一致run件数は{int}件である", function (expected: number) {
  assert.equal(this.ciDeliveryResult.headShaRunCount, expected);
});
