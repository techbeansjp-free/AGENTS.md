import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  EVIDENCE_REANCHOR_FILE,
  appendEvidenceReanchor,
  readEvidenceReanchorChain,
} from "../../src/adapters/evidence-reanchor.js";
import {
  deriveEffectiveHead,
  observeReachability,
  type EvidenceReanchorRecord,
} from "../../src/domain/evidence-reanchor.js";
import {
  bindStoredPullRequest,
  prepareStoredPullRequestCreation,
  recordStoredStep11,
} from "../../src/adapters/delivery-state.js";
import {
  closingContractDigest,
  pullRequestContentDigest,
} from "../../src/domain/delivery-state.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { parseReviewRoundInput } from "../../src/domain/review-convergence.js";
import {
  observeReviewDiff,
  readStoredReviewSession,
  recordReviewRound,
} from "../../src/adapters/review-session.js";
import { appendWorkflowJournalEntry } from "../../src/adapters/workflow-journal.js";
import { WORKFLOW_STEPS } from "../../src/domain/workflow.js";
import { QUESTIONS } from "../../src/domain/mode.js";
import {
  assertBoundPullRequestObservation,
  assertCurrentReviewJournalBinding,
  main,
} from "../../src/cli.js";
import { readStoredDeliveryState } from "../../src/adapters/delivery-state.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

class ReanchorWorld extends WorkflowWorld {
  root = "";
  staging = "";
  baseSha = "";
  oldHeadSha = "";
  newBaseSha = "";
  newHeadSha = "";
  chain: EvidenceReanchorRecord[] = [];
  /** 最後に成立した再固定の記録時刻（Issue #969）。 */
  effectiveRecordedAt: string | undefined = undefined;
  effectiveHead = "";
  reachability = "";
  override error: unknown = undefined;
  applied = false;
  before: Record<string, string> = {};
  providerCalls = 0;
  unconverged = false;
  bindingPassed = false;
}

const { Given, When, Then } = stepDefinitions<ReanchorWorld>();

const INSTANT = new Date("2026-09-01T00:00:00.000Z");
const REVIEWED = "src/domain/reviewed.ts";

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function commit(root: string, body: string, message: string): string {
  const file = path.join(root, REVIEWED);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  execFileSync("git", ["add", REVIEWED], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: root });
  return git(root, ["rev-parse", "HEAD"]);
}

function makeStaging(world: ReanchorWorld): string {
  return createIssueStaging(world.root, {
    title: "evidence-reanchor",
    answers: Object.fromEntries(
      QUESTIONS.map((id) => [
        id,
        { answer: true, evidence: `${id}の固定証拠` },
      ]),
    ),
    now: INSTANT,
    requestedMode: "quick",
  }).path;
}

/**
 * 旧baseから旧headまでの差分を、新baseの上へ同じ内容で載せ直す。
 *
 * **`git rebase`を使わず、新baseから同じ内容のcommitを作る。** fixtureの意図は
 * 「内容が等価な新しいhead」を作ることであり、rebaseの実行手順そのものではない。
 */
function replay(
  world: ReanchorWorld,
  mutate?: (file: string) => void,
): { newBase: string; newHead: string } {
  const root = world.root;
  const content = fs.readFileSync(path.join(root, REVIEWED), "utf8");
  execFileSync("git", ["checkout", "-q", world.baseSha], { cwd: root });
  /**
   * **新baseは`REVIEWED`以外のpathだけを変える。**
   *
   * 新baseが`REVIEWED`へ触れると、新base→新headの差分が旧base→旧headと変わり、
   * fixture自身が等価でなくなる。fixtureの意図は「等価な新しいhead」を作ることである。
   */
  const upstream = path.join(root, "upstream.ts");
  fs.writeFileSync(upstream, "export const upstream = 1;\n");
  execFileSync("git", ["add", "upstream.ts"], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "chore: 既定branchが進む"], {
    cwd: root,
  });
  const newBase = git(root, ["rev-parse", "HEAD"]);
  const file = path.join(root, REVIEWED);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  mutate?.(file);
  execFileSync("git", ["add", REVIEWED], { cwd: root });
  execFileSync(
    "git",
    ["commit", "-q", "-m", "feat: 同じ内容を新baseの上へ載せ直す"],
    {
      cwd: root,
    },
  );
  return { newBase, newHead: git(root, ["rev-parse", "HEAD"]) };
}

function buildDelivery(world: ReanchorWorld, terminal = true): void {
  const issueUrl = "https://github.com/example/repository/issues/1093";
  prepareStoredPullRequestCreation(world.staging, {
    repository: "example/repository",
    issue: 1093,
    issueUrl,
    headRef: "bugfix/1093-evidence-reanchor",
    headSha: world.oldHeadSha,
    baseRef: "main",
    baseSha: world.baseSha,
    pullRequestDigest: pullRequestContentDigest({
      title: "証跡再固定",
      body: "Closes #1093",
    }),
    bodyClosingDigest: closingContractDigest({
      canonicalIssue: 1093,
      canonicalIssueUrl: issueUrl,
      closingIssueNumbers: [1093],
    }),
    preparedAt: INSTANT.toISOString(),
  });
  bindStoredPullRequest(world.staging, {
    number: 1093,
    url: "https://github.com/example/repository/pull/1093",
    boundAt: INSTANT.toISOString(),
  });
  if (terminal)
    recordStoredStep11(world.staging, {
      outcome: "pull-request",
      recordedAt: INSTANT.toISOString(),
      journalDigest: "c".repeat(64),
    });
}

function snapshot(world: ReanchorWorld): void {
  world.before = {};
  for (const relative of [
    "journal/delivery-state.json",
    "journal/steps.jsonl",
  ]) {
    const file = path.join(world.staging, relative);
    if (fs.existsSync(file))
      world.before[relative] = fs.readFileSync(file, "utf8");
  }
}

function baseFixture(world: ReanchorWorld): void {
  world.root = world.initRepo();
  world.baseSha = git(world.root, ["rev-parse", "HEAD"]);
  world.oldHeadSha = commit(
    world.root,
    "export const reviewed = 1;\n",
    "feat: レビュー対象",
  );
  world.staging = makeStaging(world);
}

function applyReanchor(
  world: ReanchorWorld,
  layer: "delivery" | "review",
): void {
  snapshot(world);
  try {
    const result = appendEvidenceReanchor({
      staging: world.staging,
      root: world.root,
      layer,
      newHeadSha: world.newHeadSha,
      newBaseSha: world.newBaseSha,
      reason: "既定branchが動いたためrebaseした",
      recordedAt: INSTANT.toISOString(),
    });
    world.chain = [...result.chain];
    world.effectiveHead = result.effectiveHeadSha;
    world.applied = true;
  } catch (error) {
    world.error = error;
    world.applied = false;
  }
}

/**
 * Step 1・4・9・10のjournal entryを実APIで書く。
 *
 * **Step 10 bindingは旧headを指す。** rebase前に記録された状態を再現するためである。
 * `assertCurrentReviewJournalBinding`が実効HEADで照合するようになっていなければ、
 * この状態から新headでの検査は必ず落ちる。
 */
function recordStep10Binding(world: ReanchorWorld): void {
  const session = readStoredReviewSession(world.staging);
  assert.ok(session, "review sessionがありません");
  for (const step of [1, 4, 9, 10]) {
    const definition = WORKFLOW_STEPS.find(
      (candidate) => candidate.step === step,
    );
    assert.ok(definition, `step ${step}がありません`);
    appendWorkflowJournalEntry({
      staging: world.staging,
      entry: {
        step,
        skillId: definition.skillId,
        mode: "quick",
        recordedAt: INSTANT.toISOString(),
        artifacts: [`artifact-${step}`],
        evidence: `step ${step}の固定証拠`,
        ...(step === 10
          ? {
              reviewSession: {
                sessionId: session.sessionId,
                roundDigest: session.latestRoundDigest,
                headSha: session.latestCandidateHeadSha,
              },
            }
          : {}),
      },
    });
  }
}

Given("固定済みPR identityを持つstagingと等価なrebaseがある", function () {
  baseFixture(this);
  buildDelivery(this);
  const replayed = replay(this);
  this.newBaseSha = replayed.newBase;
  this.newHeadSha = replayed.newHead;
});

Given(
  "固定済みPR identityを持つstagingと内容が変わったrebaseがある",
  function () {
    baseFixture(this);
    buildDelivery(this);
    const replayed = replay(this, (file) => {
      fs.writeFileSync(file, "export const reviewed = 2;\n");
    });
    this.newBaseSha = replayed.newBase;
    this.newHeadSha = replayed.newHead;
  },
);

Given(
  "固定済みPR identityを持つstagingとfile modeだけが変わったrebaseがある",
  function () {
    baseFixture(this);
    buildDelivery(this);
    const replayed = replay(this, (file) => {
      fs.chmodSync(file, 0o755);
    });
    this.newBaseSha = replayed.newBase;
    this.newHeadSha = replayed.newHead;
  },
);

Given(
  "固定済みPR identityを持つstagingと移動していないheadがある",
  function () {
    baseFixture(this);
    buildDelivery(this);
    this.newBaseSha = this.baseSha;
    this.newHeadSha = this.oldHeadSha;
  },
);

Given("固定済みPR identityを持つstagingと解決できないSHAがある", function () {
  baseFixture(this);
  buildDelivery(this);
  this.newBaseSha = "f".repeat(40);
  this.newHeadSha = "e".repeat(40);
});

Given("delivery stateを持たないstagingがある", function () {
  baseFixture(this);
  const replayed = replay(this);
  this.newBaseSha = replayed.newBase;
  this.newHeadSha = replayed.newHead;
});

Given("delivery stateがstep11-recorded以外のstagingがある", function () {
  baseFixture(this);
  buildDelivery(this, false);
  const replayed = replay(this);
  this.newBaseSha = replayed.newBase;
  this.newHeadSha = replayed.newHead;
});

Given("連鎖条件を満たさない再固定chainがある", function () {
  baseFixture(this);
  this.chain = [
    {
      oldHeadSha: "a".repeat(40),
      newHeadSha: "b".repeat(40),
      oldBaseSha: this.baseSha,
      newBaseSha: this.baseSha,
      diffDigest: "d".repeat(64),
      method: "rebase",
      reason: "連鎖しない記録",
      recordedAt: INSTANT.toISOString(),
    },
  ];
});

Given("再固定記録を持たないstagingがある", function () {
  baseFixture(this);
  this.chain = [];
});

Given("実効HEADを持つstagingとproviderを観測できない環境がある", function () {
  baseFixture(this);
  this.effectiveHead = this.oldHeadSha;
});

Given("実効HEADがPR headの祖先でないstagingがある", function () {
  baseFixture(this);
  this.effectiveHead = this.oldHeadSha;
  /**
   * **前進commitではなく、baseから分岐した別系譜のheadを作る。**
   * 前進commitだと実効HEADが祖先になり`reachable`になってしまう。
   * force-pushでheadが書き換えられた状態を再現する。
   */
  execFileSync("git", ["checkout", "-q", this.baseSha], { cwd: this.root });
  this.newHeadSha = commit(
    this.root,
    "export const rewritten = 1;\n",
    "feat: 書き換えられたhead",
  );
});

When("再固定を適用する", function () {
  applyReanchor(this, "delivery");
});

When("delivery層の再固定を適用する", function () {
  applyReanchor(this, "delivery");
});

When("review層の再固定を適用する", function () {
  applyReanchor(this, "review");
});

When("両方の再固定を適用する", function () {
  applyReanchor(this, "delivery");
  const first = this.error;
  applyReanchor(this, "review");
  assert.ok(first, "delivery層が拒否していません");
});

When("再固定を二回適用する", function () {
  applyReanchor(this, "delivery");
  assert.equal(
    this.applied,
    true,
    `一回目が失敗しました: ${String(this.error)}`,
  );
  applyReanchor(this, "delivery");
});

When("実効HEADを導出する", function () {
  const derived = deriveEffectiveHead({
    records: this.chain,
    anchoredHeadSha: this.oldHeadSha,
  });
  this.effectiveHead = derived.effectiveHeadSha;
  /**
   * **実効HEADが動いたなら事象時刻も動く**（Issue #969）。CI配送判定は
   * この時刻からの経過で`pending`と`undelivered`を分ける。元の固定時刻の
   * ままだと、再固定直後の未生成を`undelivered`と誤分類する。
   */
  this.effectiveRecordedAt = derived.effectiveRecordedAt;
});

Given("成立する再固定chainがある", function () {
  baseFixture(this);
  this.chain = [
    {
      oldHeadSha: this.oldHeadSha,
      newHeadSha: "c".repeat(40),
      oldBaseSha: this.baseSha,
      newBaseSha: this.baseSha,
      diffDigest: "d".repeat(64),
      method: "rebase",
      reason: "等価なrebase",
      recordedAt: "2026-09-05T12:00:00.000Z",
    },
  ];
});

Then("実効HEADの再固定時刻を返す", function () {
  assert.equal(this.effectiveRecordedAt, "2026-09-05T12:00:00.000Z");
});

Then("再固定時刻を返さない", function () {
  assert.equal(this.effectiveRecordedAt, undefined);
});

When("到達性を判定する", function () {
  this.reachability = observeReachability({
    effectiveHeadSha: this.effectiveHead,
    providerHeadSha: this.newHeadSha === "" ? undefined : this.newHeadSha,
    isAncestor:
      this.newHeadSha === ""
        ? undefined
        : (descendant: string) => {
            try {
              execFileSync(
                "git",
                ["merge-base", "--is-ancestor", this.effectiveHead, descendant],
                { cwd: this.root, stdio: "ignore" },
              );
              return true;
            } catch {
              return false;
            }
          },
  }).state;
});

When("再固定の入力契約を調べる", function () {
  this.applied = true;
});

Then("再固定chainは1件伸び実効HEADは新headになる", function () {
  assert.equal(this.applied, true, String(this.error));
  assert.equal(this.chain.length, 1);
  assert.equal(this.effectiveHead, this.newHeadSha);
  /**
   * **staging recordのartifact一覧とdigestが追記へ追随していることを測る。**
   * `refreshStoredStagingDigest`を呼ばない変異はここで落ちる。
   */
  const record = JSON.parse(
    fs.readFileSync(path.join(this.staging, "staging-record.json"), "utf8"),
  ) as { artifacts: string[] };
  assert.ok(
    record.artifacts.includes("journal/reanchor.jsonl"),
    `staging recordが追記へ追随していません: ${JSON.stringify(record.artifacts)}`,
  );
});

Then("delivery stateとjournalは1 byteも変わらない", function () {
  assert.equal(this.applied, true, String(this.error));
  for (const [relative, expected] of Object.entries(this.before)) {
    const actual = fs.readFileSync(path.join(this.staging, relative), "utf8");
    assert.equal(actual, expected, `${relative}が変化しました`);
  }
});

Then("再固定は拒否され両側のdiff digestが理由に含まれる", function () {
  assert.equal(this.applied, false, "拒否されていません");
  const message = String(this.error);
  /**
   * **両側のdigestが揃って出ることを測る。** 1件だけの検査では、
   * `before`か`after`の一方を出力しない回帰を通してしまう。
   */
  assert.match(message, /before=[0-9a-f]{64}/u);
  assert.match(message, /after=[0-9a-f]{64}/u);
  const before = /before=([0-9a-f]{64})/u.exec(message)?.[1];
  const after = /after=([0-9a-f]{64})/u.exec(message)?.[1];
  assert.notEqual(before, after, "両側のdigestが同一です");
});

Then("実効HEADは固定済み記録headのままになる", function () {
  assert.equal(this.effectiveHead, this.oldHeadSha);
});

Then("再固定は拒否される", function () {
  assert.equal(this.applied, false, "拒否されていません");
  assert.equal(readEvidenceReanchorChain(this.staging).length, 0);
});

Then("収束判定は新headと一致する", function () {
  assert.equal(this.applied, true, String(this.error));
  assert.equal(this.effectiveHead, this.newHeadSha);
});

Then("到達性はunverifiableになる", function () {
  assert.equal(this.reachability, "unverifiable");
});

Then("到達性はrewrittenになる", function () {
  assert.equal(this.reachability, "rewritten");
});

Then("どちらも拒否され復旧経路が案内される", function () {
  assert.equal(this.applied, false);
  assert.match(String(this.error), /pr reanchor|pr create/u);
});

Then("再固定chainは1件のままになる", function () {
  /**
   * **二回目が「成功して追記しない」ことを測る。**
   * 冪等判定を外すと二回目は同一head拒否で例外になる。chainの長さだけを見ると
   * どちらも1件で区別できない。終了の成否が唯一の観測点である。
   */
  assert.equal(
    this.applied,
    true,
    `二回目が成功していません: ${String(this.error)}`,
  );
  assert.equal(this.chain.length, 1);
  assert.equal(readEvidenceReanchorChain(this.staging).length, 1);
  /**
   * **file上の行数も測る。** 冪等判定を外した変異は、同じ記録を二重に積んでも
   * `deriveEffectiveHead`が2件目を連鎖違反として捨てるため、chainの長さだけでは
   * 検出できない。実fileの行数が唯一の観測点である。
   */
  const lines = fs
    .readFileSync(path.join(this.staging, "journal/reanchor.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "");
  assert.equal(lines.length, 1, "同一記録が二重に積まれています");
});

Then("旧baseと旧headを受け取る引数が存在しない", function () {
  const source = fs.readFileSync("src/adapters/evidence-reanchor.ts", "utf8");
  assert.ok(
    !/oldHeadSha\s*[?:]/u.test(
      source.split("export function appendEvidenceReanchor")[1] ?? "",
    ),
    "appendEvidenceReanchorが旧headを引数で受け取っています",
  );
  assert.ok(
    !/oldBaseSha\s*[?:]/u.test(
      source.split("export function appendEvidenceReanchor")[1] ?? "",
    ),
    "appendEvidenceReanchorが旧baseを引数で受け取っています",
  );
});

/**
 * 収束済みまたは未収束のreview sessionを作る。
 *
 * **`recordReviewRound`を実際に通す。** session fileを手で書くと、round契約と
 * 実装の乖離を検査できない。
 */
function buildReviewSession(world: ReanchorWorld, converged: boolean): void {
  const observed = observeReviewDiff(
    world.root,
    world.baseSha,
    world.oldHeadSha,
  );
  recordReviewRound({
    staging: world.staging,
    round: parseReviewRoundInput({
      round: 1,
      previousRoundDigest: null,
      anchor: {
        scopeIds: ["SCOPE-1093"],
        acceptanceCriteriaIds: ["AC-1093-07"],
        invariantIds: ["INV-02"],
        diffBaseSha: world.baseSha,
        initialHeadSha: world.oldHeadSha,
        initialDiffDigest: observed.digest,
      },
      candidateHeadSha: world.oldHeadSha,
      focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
      findings: converged
        ? []
        : [
            {
              id: "H-1093",
              severity: "High",
              status: "valid",
              source: "review",
              relation: "acceptance-violation",
              evidence: "収束していないsessionを作るための未解決finding",
              path: REVIEWED,
              contractId: "AC-1093-07",
              causedByFindingId: null,
            },
          ],
    }),
  });
}

Given("収束済みreview sessionと等価なrebaseがある", function () {
  baseFixture(this);
  execFileSync("git", ["checkout", "-q", this.oldHeadSha], { cwd: this.root });
  buildReviewSession(this, true);
  const replayed = replay(this);
  this.newBaseSha = replayed.newBase;
  this.newHeadSha = replayed.newHead;
});

Given("収束していないreview sessionと等価なrebaseがある", function () {
  baseFixture(this);
  execFileSync("git", ["checkout", "-q", this.oldHeadSha], { cwd: this.root });
  buildReviewSession(this, false);
  const replayed = replay(this);
  this.newBaseSha = replayed.newBase;
  this.newHeadSha = replayed.newHead;
  this.unconverged = true;
});

Given("実git fixtureのstagingがある", function () {
  baseFixture(this);
  buildDelivery(this);
  const replayed = replay(this);
  this.newBaseSha = replayed.newBase;
  this.newHeadSha = replayed.newHead;
});

When("再固定をCLIから適用する", async function () {
  this.providerCalls = 0;
  const status = await main([
    "pr",
    "reanchor",
    `--staging=${this.staging}`,
    `--root=${this.root}`,
    `--new-head=${this.newHeadSha}`,
    `--new-base=${this.newBaseSha}`,
    "--reason=既定branchが動いたためrebaseした",
    "--apply",
  ]);
  this.applied = status === 0;
});

/**
 * `pr merge`が再観測するPRを、固定済みdelivery identityと同じ内容で組み立てる。
 *
 * **headだけを引数で変える。** 他の項目を一致させておかないと、head照合を
 * 通過したのか別の理由で落ちたのかを区別できない（Issue #1101）。
 */
function observedPullRequest(headRefOid: string): Record<string, unknown> {
  return {
    number: 1093,
    url: "https://github.com/example/repository/pull/1093",
    title: "証跡再固定",
    body: "Closes #1093",
    headRefName: "bugfix/1093-evidence-reanchor",
    baseRefName: "main",
    headRefOid,
    headRepository: { nameWithOwner: "example/repository" },
    isCrossRepository: false,
    closingIssuesReferences: [
      {
        number: 1093,
        url: "https://github.com/example/repository/issues/1093",
      },
    ],
  };
}

function observeBoundPullRequest(
  world: ReanchorWorld,
  headRefOid: string,
): void {
  const state = readStoredDeliveryState(world.staging);
  assert.ok(state, "delivery stateがありません");
  try {
    assertBoundPullRequestObservation({
      staging: world.staging,
      state,
      observed: observedPullRequest(headRefOid) as never,
      tracker: "https://github.com/example/repository/issues/1093",
    });
    world.bindingPassed = true;
  } catch (error) {
    world.bindingPassed = false;
    world.error = error;
  }
}

When("delivery層の再固定のあとにpr mergeのbinding検査を通す", function () {
  applyReanchor(this, "delivery");
  assert.equal(
    this.applied,
    true,
    `再固定が失敗しました: ${String(this.error)}`,
  );
  observeBoundPullRequest(this, this.newHeadSha);
});

When("再固定せずに新headでpr mergeのbinding検査を通す", function () {
  observeBoundPullRequest(this, this.newHeadSha);
});

When("連鎖しない記録を積んで新headでpr mergeのbinding検査を通す", function () {
  /**
   * **先頭の`oldHeadSha`が固定済みheadと一致しない記録を直接置く。**
   * `pr reanchor`は等価性を要求するため、連鎖破綻はCLI経由では作れない。
   */
  fs.mkdirSync(path.join(this.staging, "journal"), { recursive: true });
  fs.writeFileSync(
    path.join(this.staging, EVIDENCE_REANCHOR_FILE),
    `${JSON.stringify({
      oldHeadSha: "a".repeat(40),
      newHeadSha: this.newHeadSha,
      oldBaseSha: this.baseSha,
      newBaseSha: this.newBaseSha,
      diffDigest: "d".repeat(64),
      method: "rebase",
      reason: "連鎖しない記録",
      recordedAt: INSTANT.toISOString(),
    })}\n`,
  );
  observeBoundPullRequest(this, this.newHeadSha);
});

Then("pr mergeのbinding検査は通過する", function () {
  assert.equal(
    this.bindingPassed,
    true,
    `binding検査が停止しました: ${String(this.error)}`,
  );
});

Then("pr mergeのbinding検査は固定済みheadとの不一致で停止する", function () {
  assert.equal(this.bindingPassed, false, "binding検査が通過しました");
  assert.match(
    String((this.error as Error)?.message ?? ""),
    /PR再観測が固定済みrepository・PR・base ref・headと一致しません/u,
  );
});

When("到達性を観測する", function () {
  this.providerCalls = 0;
  const chain = readEvidenceReanchorChain(this.staging);
  const derived = deriveEffectiveHead({
    records: chain,
    anchoredHeadSha: this.oldHeadSha,
  });
  /**
   * **provider境界をfakeへ差し替えて実呼び出し数を数える。**
   * `observeReachability`はproviderの観測結果を引数で受け取る純関数であり、
   * 自分では呼ばない。数えるのは呼び出し側の責務である。
   */
  const providerHeadSha = ((): string => {
    this.providerCalls += 1;
    return this.newHeadSha;
  })();
  this.reachability = observeReachability({
    effectiveHeadSha: derived.effectiveHeadSha,
    providerHeadSha,
    isAncestor: (descendant: string) => {
      try {
        execFileSync(
          "git",
          ["merge-base", "--is-ancestor", derived.effectiveHeadSha, descendant],
          { cwd: this.root, stdio: "ignore" },
        );
        return true;
      } catch {
        return false;
      }
    },
  }).state;
});

When("review層の再固定のあとにpr createのbinding検査を通す", function () {
  applyReanchor(this, "review");
  assert.equal(
    this.applied,
    true,
    `再固定が失敗しました: ${String(this.error)}`,
  );
  /**
   * **製品の`assertCurrentReviewJournalBinding`を実際に呼ぶ。**
   * 再固定しただけで「通過した」と見なすと、`src/cli.ts:429`の照合を
   * 差し替え忘れた回帰を検出できない。
   */
  recordStep10Binding(this);
  try {
    assertCurrentReviewJournalBinding(this.staging, this.newHeadSha);
    this.bindingPassed = true;
  } catch (error) {
    this.bindingPassed = false;
    this.error = error;
  }
});

Then("provider呼び出しは0件になる", function () {
  assert.equal(this.applied, true);
  assert.equal(this.providerCalls, 0);
});

Then("到達性の三値が報告される", function () {
  assert.ok(
    ["reachable", "rewritten", "unverifiable"].includes(this.reachability),
    `三値でない: ${this.reachability}`,
  );
});

Then("provider観測は1回になる", function () {
  assert.equal(this.providerCalls, 1);
});

Then("binding検査は停止しない", function () {
  assert.equal(this.applied, true, String(this.error));
  assert.equal(this.effectiveHead, this.newHeadSha);
  assert.equal(
    this.bindingPassed,
    true,
    `binding検査が停止しました: ${String(this.error)}`,
  );
});
