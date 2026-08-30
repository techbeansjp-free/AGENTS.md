import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DELIVERY_STATE_TRANSACTION_LIMITS,
  DELIVERY_STATE_TRANSACTION_SCHEMA,
  bindStoredPullRequest,
  claimStoredPullRequestCreationDispatch,
  deliveryStateTransactionPath,
  prepareStoredPullRequestCreation,
  readStoredDeliveryState,
  recordStoredStep11,
} from "../../src/adapters/delivery-state.js";
import {
  DELIVERY_STATE_FILE,
  claimPullRequestCreationDispatch,
  closingContractDigest,
  deliveryStateDigest,
  preparePullRequestCreation,
  pullRequestContentDigest,
  renderDeliveryState,
  type DeliveryCreateIntentInput,
  type DeliveryState,
} from "../../src/domain/delivery-state.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { QUESTIONS } from "../../src/domain/mode.js";
import {
  calculateStagingDigest,
  listStagingArtifacts,
  readStoredStagingRecord,
  refreshStoredStagingDigest,
  STAGING_RECORD_FILE,
} from "../../src/domain/staging.js";
import { writeFileAtomic } from "../../src/lib/atomic.js";
import { stableJson } from "../../src/lib/security.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface DeliveryTransactionFixture {
  staging: string;
  marker: Record<string, unknown>;
  beforeState: DeliveryState | undefined;
  afterState: DeliveryState;
  beforeDeliverySource: string | null;
  afterDeliverySource: string;
  beforeRecordSource: string;
  afterRecordSource: string;
}

interface DeliveryTransactionWorld extends WorkflowWorld {
  fixture?: DeliveryTransactionFixture;
  expectedVersion?: "旧版" | "新版";
  beforeOperation?: DiskSnapshot;
  externalMarkerTarget?: string;
  externalMarkerSource?: string;
  dispatchResult?: ReturnType<typeof claimStoredPullRequestCreationDispatch>;
}

interface DiskSnapshot {
  delivery: string | null;
  record: string;
  requirement: string;
}

const { Given, When, Then } = stepDefinitions<DeliveryTransactionWorld>();

const T0 = "2026-08-30T00:00:00.000Z";
const T1 = "2026-08-30T00:00:01.000Z";
const T2 = "2026-08-30T00:00:02.000Z";
const T3 = "2026-08-30T00:00:03.000Z";
const DELIVERY_PATH_PARTS = DELIVERY_STATE_FILE.split("/");

function sha256(value: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stagingOf(world: DeliveryTransactionWorld): string {
  assert.ok(world.fixture, "delivery transaction fixtureがありません");
  return world.fixture.staging;
}

function createIntent(): DeliveryCreateIntentInput {
  const issueUrl = "https://github.com/example/repository/issues/1062";
  return {
    repository: "example/repository",
    issue: 1062,
    issueUrl,
    headRef: "codex/1062-delivery-transaction",
    headSha: "a".repeat(40),
    baseRef: "main",
    baseSha: "b".repeat(40),
    pullRequestDigest: pullRequestContentDigest({
      title: "delivery transactionを検証する",
      body: "Closes #1062",
    }),
    bodyClosingDigest: closingContractDigest({
      canonicalIssue: 1062,
      canonicalIssueUrl: issueUrl,
      closingIssueNumbers: [1062],
    }),
    preparedAt: T0,
  };
}

function createStaging(world: DeliveryTransactionWorld): string {
  const root = world.temp("asc-delivery-transaction-");
  return createIssueStaging(root, {
    title: "delivery-transaction",
    answers: Object.fromEntries(
      QUESTIONS.map((id) => [
        id,
        { answer: true, evidence: `${id} fixture evidence` },
      ]),
    ),
    now: new Date(T0),
    requestedMode: "quick",
  }).path;
}

function deliveryFile(staging: string): string {
  return path.join(staging, ...DELIVERY_PATH_PARTS);
}

function optionalSource(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function writeSource(staging: string, file: string, source: string): void {
  writeFileAtomic(file, source, {
    temporaryDirectory: path.dirname(staging),
  });
}

function setDeliverySource(staging: string, source: string | null): void {
  const file = deliveryFile(staging);
  if (source === null) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  writeSource(staging, file, source);
}

function snapshot(staging: string): DiskSnapshot {
  return {
    delivery: optionalSource(deliveryFile(staging)),
    record: fs.readFileSync(path.join(staging, STAGING_RECORD_FILE), "utf8"),
    requirement: fs.readFileSync(path.join(staging, "00_要求定義.md"), "utf8"),
  };
}

function assertStoredDigestConsistent(staging: string): void {
  const stored = readStoredStagingRecord(staging);
  const artifacts = listStagingArtifacts(staging);
  assert.deepEqual(stored.artifacts, artifacts);
  assert.equal(stored.digest, calculateStagingDigest(staging, artifacts));
}

function buildFixture(
  world: DeliveryTransactionWorld,
  beforeState?: DeliveryState,
  afterState = preparePullRequestCreation(createIntent()),
): DeliveryTransactionFixture {
  const staging = createStaging(world);
  if (beforeState) {
    const prepared = prepareStoredPullRequestCreation(staging, createIntent());
    assert.deepEqual(prepared, beforeState);
  }
  const beforeDeliverySource = optionalSource(deliveryFile(staging));
  const beforeRecordSource = fs.readFileSync(
    path.join(staging, STAGING_RECORD_FILE),
    "utf8",
  );
  const beforeRecord = readStoredStagingRecord(staging);
  assert.deepEqual(
    beforeState,
    beforeDeliverySource ? readStoredDeliveryState(staging) : undefined,
  );

  const afterDeliverySource = renderDeliveryState(afterState);
  setDeliverySource(staging, afterDeliverySource);
  const afterRecord = refreshStoredStagingDigest(staging);
  const afterRecordSource = fs.readFileSync(
    path.join(staging, STAGING_RECORD_FILE),
    "utf8",
  );

  setDeliverySource(staging, beforeDeliverySource);
  writeSource(
    staging,
    path.join(staging, STAGING_RECORD_FILE),
    beforeRecordSource,
  );
  const otherArtifacts = beforeRecord.artifacts.filter(
    (artifact) => artifact !== DELIVERY_STATE_FILE,
  );
  const marker: Record<string, unknown> = {
    schemaVersion: DELIVERY_STATE_TRANSACTION_SCHEMA,
    deliveryBeforeDigest: beforeState ? deliveryStateDigest(beforeState) : null,
    deliveryAfterDigest: deliveryStateDigest(afterState),
    deliveryBeforeFileDigest: beforeDeliverySource
      ? sha256(beforeDeliverySource)
      : null,
    deliveryAfterFileDigest: sha256(afterDeliverySource),
    stagingRecordBeforeFileDigest: sha256(beforeRecordSource),
    stagingRecordAfterFileDigest: sha256(afterRecordSource),
    stagingDigestBefore: beforeRecord.digest,
    stagingDigestAfter: afterRecord.digest,
    artifactsBefore: beforeRecord.artifacts,
    artifactsAfter: afterRecord.artifacts,
    otherArtifactsDigest: calculateStagingDigest(staging, otherArtifacts),
  };
  return {
    staging,
    marker,
    beforeState,
    afterState,
    beforeDeliverySource,
    afterDeliverySource,
    beforeRecordSource,
    afterRecordSource,
  };
}

function writeMarker(
  fixture: DeliveryTransactionFixture,
  source?: string,
): void {
  writeSource(
    fixture.staging,
    deliveryStateTransactionPath(fixture.staging),
    source ?? `${stableJson(fixture.marker)}\n`,
  );
}

function installCut(
  fixture: DeliveryTransactionFixture,
  cut:
    | "publish前"
    | "delivery publish後"
    | "staging record refresh後"
    | "marker clear後",
): void {
  const markerFile = deliveryStateTransactionPath(fixture.staging);
  if (fs.existsSync(markerFile)) fs.unlinkSync(markerFile);
  setDeliverySource(fixture.staging, fixture.beforeDeliverySource);
  writeSource(
    fixture.staging,
    path.join(fixture.staging, STAGING_RECORD_FILE),
    fixture.beforeRecordSource,
  );
  if (cut !== "publish前")
    setDeliverySource(fixture.staging, fixture.afterDeliverySource);
  if (cut === "staging record refresh後" || cut === "marker clear後")
    writeSource(
      fixture.staging,
      path.join(fixture.staging, STAGING_RECORD_FILE),
      fixture.afterRecordSource,
    );
  if (cut !== "marker clear後") writeMarker(fixture);
}

Given(
  "delivery state transactionが{string}で停止している",
  function (cut: string) {
    const fixture = buildFixture(this);
    assert.ok(
      cut === "publish前" ||
        cut === "delivery publish後" ||
        cut === "staging record refresh後" ||
        cut === "marker clear後",
      `未知のcrash cutです: ${cut}`,
    );
    installCut(fixture, cut);
    this.fixture = fixture;
    this.expectedVersion = cut === "publish前" ? "旧版" : "新版";
  },
);

Given(
  "delivery state transaction markerを{string}にする",
  function (tamper: string) {
    const fixture = buildFixture(this);
    installCut(fixture, "publish前");
    const markerFile = deliveryStateTransactionPath(fixture.staging);
    if (tamper === "digest改ざん") {
      writeMarker(
        fixture,
        `${stableJson({
          ...fixture.marker,
          deliveryAfterFileDigest: "f".repeat(64),
        })}\n`,
      );
    } else if (tamper === "path escape") {
      writeMarker(
        fixture,
        `${stableJson({ ...fixture.marker, artifactsBefore: ["../escape"] })}\n`,
      );
    } else if (tamper === "path count超過") {
      writeMarker(
        fixture,
        `${stableJson({
          ...fixture.marker,
          artifactsBefore: Array.from(
            { length: DELIVERY_STATE_TRANSACTION_LIMITS.artifacts + 1 },
            (_, index) => `artifact-${String(index).padStart(4, "0")}`,
          ),
        })}\n`,
      );
    } else if (tamper === "byte超過") {
      writeMarker(
        fixture,
        `${stableJson(fixture.marker)}${" ".repeat(DELIVERY_STATE_TRANSACTION_LIMITS.bytes)}\n`,
      );
    } else if (tamper === "symlink") {
      fs.unlinkSync(markerFile);
      const externalDirectory = this.temp("asc-delivery-marker-target-");
      const target = path.join(externalDirectory, "marker.json");
      const source = `${stableJson(fixture.marker)}\n`;
      fs.writeFileSync(target, source);
      fs.symlinkSync(target, markerFile);
      this.externalMarkerTarget = target;
      this.externalMarkerSource = source;
    } else if (tamper === "hardlink") {
      fs.linkSync(
        markerFile,
        path.join(path.dirname(markerFile), ".delivery-marker-peer.json"),
      );
    } else {
      throw new Error(`未知のmarker tamperです: ${tamper}`);
    }
    this.fixture = fixture;
  },
);

Given("delivery state transactionに第三のdelivery stateがある", function () {
  const fixture = buildFixture(this);
  installCut(fixture, "publish前");
  const third = claimPullRequestCreationDispatch(fixture.afterState, T2);
  setDeliverySource(fixture.staging, renderDeliveryState(third));
  this.fixture = fixture;
});

Given(
  "delivery state transaction中に別のstaging成果物が改ざんされている",
  function () {
    const fixture = buildFixture(this);
    installCut(fixture, "publish前");
    fs.appendFileSync(
      path.join(fixture.staging, "00_要求定義.md"),
      "\ntransaction外の改ざん\n",
    );
    this.fixture = fixture;
  },
);

Given("PR create dispatch claimのpublish後に停止している", function () {
  const staging = createStaging(this);
  const before = prepareStoredPullRequestCreation(staging, createIntent());
  const after = claimPullRequestCreationDispatch(before, T1);
  const fixture = buildFixture(this, before, after);
  installCut(fixture, "delivery publish後");
  this.fixture = fixture;
});

Given("Step 11をPR停止終端として記録済みである", function () {
  const staging = createStaging(this);
  prepareStoredPullRequestCreation(staging, createIntent());
  bindStoredPullRequest(staging, {
    number: 1234,
    url: "https://github.com/example/repository/pull/1234",
    boundAt: T1,
  });
  recordStoredStep11(staging, {
    outcome: "pull-request",
    recordedAt: T2,
    journalDigest: "c".repeat(64),
  });
  this.fixture = {
    ...buildFixture(this),
    staging,
  };
});

When("delivery readiness readでpending transactionを復旧する", function () {
  const staging = stagingOf(this);
  this.beforeOperation = snapshot(staging);
  try {
    this.value = readStoredDeliveryState(staging);
  } catch (error) {
    this.error = error;
  }
});

When("別時刻でPR create dispatchを再claimする", function () {
  try {
    this.dispatchResult = claimStoredPullRequestCreationDispatch(
      stagingOf(this),
      T2,
    );
  } catch (error) {
    this.error = error;
  }
});

When("異なるStep 11 evidenceへの変更を試みる", function () {
  const staging = stagingOf(this);
  this.beforeOperation = snapshot(staging);
  try {
    recordStoredStep11(staging, {
      outcome: "pull-request",
      recordedAt: T3,
      journalDigest: "d".repeat(64),
    });
  } catch (error) {
    this.error = error;
  }
});

Then(
  "delivery state transactionは{string}へ収束する",
  function (result: string) {
    assert.equal(this.error, undefined);
    const fixture = this.fixture;
    assert.ok(fixture);
    assert.equal(result, this.expectedVersion);
    assert.deepEqual(
      this.value,
      result === "旧版" ? fixture.beforeState : fixture.afterState,
    );
    assert.equal(
      fs.existsSync(deliveryStateTransactionPath(fixture.staging)),
      false,
    );
    assertStoredDigestConsistent(fixture.staging);
  },
);

Then("delivery state transactionは副作用なしで拒否される", function () {
  assert.ok(this.error instanceof Error, "不正transactionが受理されました");
  const staging = stagingOf(this);
  assert.deepEqual(snapshot(staging), this.beforeOperation);
  if (this.externalMarkerTarget) {
    assert.equal(
      fs.readFileSync(this.externalMarkerTarget, "utf8"),
      this.externalMarkerSource,
    );
  }
});

Then("最初のdispatch claimだけを保持し再dispatchを許可しない", function () {
  assert.equal(this.error, undefined);
  assert.equal(this.dispatchResult?.dispatchAllowed, false);
  assert.equal(this.dispatchResult?.state.create.dispatchClaimedAt, T1);
  const staging = stagingOf(this);
  assert.equal(fs.existsSync(deliveryStateTransactionPath(staging)), false);
  assertStoredDigestConsistent(staging);
});

Then("終端delivery stateとstaging recordはbyte単位で変わらない", function () {
  assert.ok(this.error instanceof Error, "終端後の変更が受理されました");
  assert.deepEqual(snapshot(stagingOf(this)), this.beforeOperation);
});
