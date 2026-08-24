import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  appendCompletionRecord,
  appendEvidenceStateRecord,
  applyEvidencePrune,
  assertRoutingEvidenceBinding,
  evaluateRoutingEvidenceHead,
  getEffectiveEvidenceState,
  issueRoutingEvidence,
  previewEvidencePrune,
  type EvidencePrunePreview,
  type RoutingEvidence,
  type RoutingEvidenceIssueInput,
} from "../../src/domain/routing-evidence.js";
import type { RoutingEvidenceRetentionChoice } from "../../src/types.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class RoutingEvidenceWorld extends WorkflowWorld {
  repositoryRoot = "";
  storeRoot = "evidence/routing/";
  retention: RoutingEvidenceRetentionChoice | undefined = undefined;
  issueInput: RoutingEvidenceIssueInput | undefined = undefined;
  evidence: RoutingEvidence | undefined = undefined;
  evidenceFile = "";
  evidenceSource = "";
  preview: EvidencePrunePreview | undefined = undefined;
  failures: unknown[] = [];
  implementationHead = "b".repeat(40);
  changedHead = "c".repeat(40);
}

const { Given, When, Then } = stepDefinitions<RoutingEvidenceWorld>();

const completeRetention = (): RoutingEvidenceRetentionChoice => ({
  retentionDays: 30,
  maxRecordsPerIssue: 20,
  maxRecordBytes: 65_536,
  rotationCondition: "oldest_first",
  deletionMethod: "preview_then_explicit",
});

function evidenceInput(
  world: RoutingEvidenceWorld,
  overrides: Partial<RoutingEvidenceIssueInput> = {},
): RoutingEvidenceIssueInput {
  return {
    repositoryRoot: world.repositoryRoot,
    storeRoot: world.storeRoot,
    retention: world.retention,
    baseSha: "a".repeat(40),
    issue: 836,
    scope: "T06-routing-evidence",
    role: "implementer",
    provider: "codex",
    model: "model-fixture",
    mappingVersion: "fixture-v1",
    reasoningEffort: "high",
    serviceTier: "default",
    identity: "codex-implementer",
    evaluatorRef: "trusted-evaluator-ref",
    ...overrides,
  };
}

function requireEvidence(world: RoutingEvidenceWorld): RoutingEvidence {
  assert.ok(world.evidence);
  return world.evidence;
}

Given("Issueとscopeへ拘束するrouting evidence入力がある", function () {
  this.repositoryRoot = this.temp("asc-routing-evidence-");
  this.storeRoot = "evidence/routing/";
  this.retention = completeRetention();
  this.implementationHead = "b".repeat(40);
  this.changedHead = "c".repeat(40);
  this.issueInput = evidenceInput(this);
});

When("routing evidenceを隔離storeへ発行する", function () {
  assert.ok(this.issueInput);
  this.evidence = issueRoutingEvidence(
    this.issueInput,
    () => new Date("2026-08-24T01:02:03.000Z"),
  );
  this.evidenceFile = path.join(
    this.repositoryRoot,
    this.storeRoot,
    "routing",
    `${this.evidence.id}.json`,
  );
  this.evidenceSource = fs.readFileSync(this.evidenceFile, "utf8");
});

Then("routing evidenceは必須拘束項目と開始状態issuedを持つ", function () {
  assert.deepEqual(Object.keys(requireEvidence(this)).sort(), [
    "baseSha",
    "evaluatorRef",
    "id",
    "identity",
    "issue",
    "issuedAt",
    "mappingVersion",
    "model",
    "provider",
    "reasoningEffort",
    "role",
    "scope",
    "serviceTier",
    "startState",
  ]);
  assert.equal(this.evidence?.startState, "issued");
});

Then("同じ識別子の再発行は排他的に拒否される", function () {
  assert.ok(this.issueInput);
  assert.throws(() =>
    issueRoutingEvidence(
      this.issueInput!,
      () => new Date("2026-08-24T01:02:03.000Z"),
    ),
  );
});

When("routing evidenceへcompletion recordを追記する", function () {
  const evidence = requireEvidence(this);
  appendCompletionRecord(
    {
      repositoryRoot: this.repositoryRoot,
      storeRoot: this.storeRoot,
      retention: this.retention,
      routingEvidenceId: evidence.id,
      implementationHead: this.implementationHead,
      endState: "completed",
    },
    () => new Date("2026-08-24T02:00:00.000Z"),
  );
});

Then("routing evidence本体は発行時から変化しない", function () {
  assert.equal(fs.readFileSync(this.evidenceFile, "utf8"), this.evidenceSource);
});

Then("別Issueまたは別scopeへの再利用は拒否される", function () {
  const evidence = requireEvidence(this);
  assert.throws(() =>
    assertRoutingEvidenceBinding(evidence, 837, evidence.scope),
  );
  assert.throws(() =>
    assertRoutingEvidenceBinding(evidence, evidence.issue, "T07"),
  );
});

Given("隔離した一時evidence storeと完全な保持方針がある", function () {
  this.repositoryRoot = this.temp("asc-routing-retention-");
  this.storeRoot = "evidence/routing/";
  this.retention = completeRetention();
});

When(
  "store rootまたは保持方針が未設定のまま保存と削除previewを試みる",
  function () {
    this.failures = [];
    for (const operation of [
      () => issueRoutingEvidence(evidenceInput(this, { storeRoot: undefined })),
      () =>
        previewEvidencePrune({
          repositoryRoot: this.repositoryRoot,
          storeRoot: this.storeRoot,
          retention: { ...completeRetention(), deletionMethod: undefined },
        }),
    ]) {
      try {
        operation();
      } catch (error) {
        this.failures.push(error);
      }
    }
  },
);

Then("保存も削除も行われず拒否される", function () {
  assert.equal(this.failures.length, 2);
  assert.equal(
    fs.existsSync(path.join(this.repositoryRoot, this.storeRoot)),
    false,
  );
});

When("保存許可list外の秘密fieldと安全でない識別子で保存を試みる", function () {
  const secretInput: unknown = {
    ...evidenceInput(this),
    credential: "never-store-this",
  };
  assert.throws(() => issueRoutingEvidence(secretInput));
  assert.throws(() =>
    issueRoutingEvidence(evidenceInput(this, { scope: "../outside" })),
  );
});

Then("秘密とpath脱出を含む記録は保存されない", function () {
  const allFiles = fs.existsSync(this.repositoryRoot)
    ? fs.readdirSync(this.repositoryRoot, { recursive: true, encoding: "utf8" })
    : [];
  assert.doesNotMatch(JSON.stringify(allFiles), /never-store-this|outside/u);
});

When("期限超過routing evidenceを発行して削除previewを実行する", function () {
  this.issueInput = evidenceInput(this);
  this.evidence = issueRoutingEvidence(
    this.issueInput,
    () => new Date("2026-01-01T00:00:00.000Z"),
  );
  this.evidenceFile = path.join(
    this.repositoryRoot,
    this.storeRoot,
    "routing",
    `${this.evidence.id}.json`,
  );
  this.preview = previewEvidencePrune(
    {
      repositoryRoot: this.repositoryRoot,
      storeRoot: this.storeRoot,
      retention: this.retention,
    },
    () => new Date("2026-08-24T00:00:00.000Z"),
  );
});

Then("previewは削除せず対象id一覧とダイジェストを返す", function () {
  assert.deepEqual(this.preview?.targetIds, [requireEvidence(this).id]);
  assert.match(this.preview?.digest ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(fs.existsSync(this.evidenceFile), true);
});

When(
  "tombstone耐久化後の物理削除を失敗させてから同じ削除を再開する",
  function () {
    assert.ok(this.preview);
    let failed = false;
    assert.throws(() =>
      applyEvidencePrune(
        {
          repositoryRoot: this.repositoryRoot,
          storeRoot: this.storeRoot,
          retention: this.retention,
          approvedDigest: this.preview!.digest,
          targetIds: this.preview!.targetIds,
          authorize: "approved",
        },
        () => new Date("2026-08-24T00:01:00.000Z"),
        {
          remove: () => {
            failed = true;
            throw new Error("injected delete failure");
          },
        },
      ),
    );
    assert.equal(failed, true);
    const tombstones = path.join(
      this.repositoryRoot,
      this.storeRoot,
      "tombstones",
    );
    assert.equal(fs.readdirSync(tombstones).length, 1);
    assert.equal(fs.existsSync(this.evidenceFile), true);
    this.value = applyEvidencePrune(
      {
        repositoryRoot: this.repositoryRoot,
        storeRoot: this.storeRoot,
        retention: this.retention,
        approvedDigest: this.preview.digest,
        targetIds: this.preview.targetIds,
        authorize: "approved",
      },
      () => new Date("2026-08-24T00:02:00.000Z"),
    );
  },
);

Then("auditとtombstoneから冪等に削除を完了できる", function () {
  assert.equal(fs.existsSync(this.evidenceFile), false);
  assert.equal(
    typeof this.value === "object" &&
      this.value !== null &&
      "completed" in this.value,
    true,
  );
  assert.doesNotThrow(() =>
    applyEvidencePrune(
      {
        repositoryRoot: this.repositoryRoot,
        storeRoot: this.storeRoot,
        retention: this.retention,
        approvedDigest: this.preview!.digest,
        targetIds: this.preview!.targetIds,
        authorize: "approved",
      },
      () => new Date("2026-08-24T00:03:00.000Z"),
    ),
  );
});

Given(
  "routing evidenceとそのheadに依存するcompletion recordがある",
  function () {
    this.repositoryRoot = this.temp("asc-routing-head-");
    this.storeRoot = "evidence/routing/";
    this.retention = completeRetention();
    this.implementationHead = "b".repeat(40);
    this.changedHead = "c".repeat(40);
    this.evidence = issueRoutingEvidence(
      evidenceInput(this),
      () => new Date("2026-08-24T01:00:00.000Z"),
    );
    appendCompletionRecord(
      {
        repositoryRoot: this.repositoryRoot,
        storeRoot: this.storeRoot,
        retention: this.retention,
        routingEvidenceId: this.evidence.id,
        implementationHead: this.implementationHead,
        endState: "completed",
      },
      () => new Date("2026-08-24T02:00:00.000Z"),
    );
  },
);

When("implementation headを変更して有効性を評価する", function () {
  this.value = evaluateRoutingEvidenceHead(
    {
      repositoryRoot: this.repositoryRoot,
      storeRoot: this.storeRoot,
      retention: this.retention,
    },
    requireEvidence(this).id,
    this.changedHead,
  );
});

Then(
  "routing evidenceは有効のままでcompletion recordだけが失効する",
  function () {
    assert.deepEqual(this.value, {
      routingEvidenceValid: true,
      effectiveState: "issued",
      completionRecords: [
        {
          endState: "completed",
          implementationHead: this.implementationHead,
          validForCurrentHead: false,
        },
      ],
    });
  },
);

When("routing evidenceへinvalidated状態recordを追記する", function () {
  appendEvidenceStateRecord(
    {
      repositoryRoot: this.repositoryRoot,
      storeRoot: this.storeRoot,
      retention: this.retention,
      routingEvidenceId: requireEvidence(this).id,
      state: "superseded",
      reason: "new routing decision",
    },
    () => new Date("2026-08-24T03:00:00.000Z"),
  );
  appendEvidenceStateRecord(
    {
      repositoryRoot: this.repositoryRoot,
      storeRoot: this.storeRoot,
      retention: this.retention,
      routingEvidenceId: requireEvidence(this).id,
      state: "invalidated",
      reason: "scope invalidated",
    },
    () => new Date("2026-08-24T04:00:00.000Z"),
  );
});

Then("有効状態は最後の状態recordから算出される", function () {
  assert.equal(
    getEffectiveEvidenceState(
      {
        repositoryRoot: this.repositoryRoot,
        storeRoot: this.storeRoot,
        retention: this.retention,
      },
      requireEvidence(this).id,
    ),
    "invalidated",
  );
});

Then("routing evidence状態とcompletion終了状態の集合は重ならない", function () {
  const evidenceStates = new Set(["issued", "superseded", "invalidated"]);
  const completionStates = new Set(["completed", "interrupted"]);
  assert.equal(
    [...evidenceStates].some((state) => completionStates.has(state)),
    false,
  );
});
