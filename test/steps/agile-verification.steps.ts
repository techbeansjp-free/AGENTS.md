import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main } from "../../src/cli.js";
import { findCommandUsage } from "../../src/cli-usage.js";
import {
  assessImplementationDiscovery,
  assertWorkflowMergeAllowed,
  decideDeliveryContinuation,
  selectVerificationSet,
  type DeliveryContinuation,
  type DiscoveryAssessment,
  type ImplementationDiscovery,
  type VerificationImpactAnalysis,
  type VerificationSelection,
} from "../../src/domain/agile-verification.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

const { Given, When, Then } = stepDefinitions<WorkflowWorld>();

let discovery: ImplementationDiscovery;
let assessment: DiscoveryAssessment;
let selection: VerificationSelection;
let affectedBoundaries: string[];
let deliveryInput: Parameters<typeof decideDeliveryContinuation>[0];
let deliveryContinuation: DeliveryContinuation;
let cliRoot: string;

interface AgileCliRun {
  output?: Record<string, unknown>;
  error?: Error;
}

async function runAgileCli(args: string[]): Promise<AgileCliRun> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let stdout = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    await main(args);
    return { output: JSON.parse(stdout) as Record<string, unknown> };
  } catch (error) {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  } finally {
    process.stdout.write = originalWrite;
  }
}

function writeCliInput(world: WorkflowWorld, value: unknown): void {
  cliRoot = world.temp("asc-agile-cli-");
  fs.writeFileSync(
    path.join(cliRoot, "input.json"),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

function captureError(action: () => void): Error {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof Error);
    return error;
  }
  throw new assert.AssertionError({ message: "例外が必要です" });
}

const noAdditionalImpact = (): VerificationImpactAnalysis => ({
  securityRelevant: false,
  dataLossPossible: false,
  irreversibleOperation: false,
  externalContractChanged: false,
  concurrentBehaviorChanged: false,
});

const verificationInput = (
  changeType: Parameters<typeof selectVerificationSet>[0]["changeType"],
  risk: Parameters<typeof selectVerificationSet>[0]["risk"],
) => ({
  changeType,
  risk,
  affectedBoundaries,
  requirementIds: ["REQ-001"],
  acceptanceCriteriaIds: ["AC-001"],
  impactAnalysis: noAdditionalImpact(),
});

Given("契約を変更しない実装中の発見がある", function () {
  discovery = {
    discoveryId: "DISC-TEST-001",
    workflowMode: "full",
    modeDisqualifiers: [],
    changedContractKinds: [],
    changesGoal: false,
    changesScope: false,
    changesAcceptanceCriteria: false,
    expandsSecurityBoundary: false,
    introducesIrreversibleOperation: false,
  };
});

Given("受け入れ条件を変更する実装中の発見がある", function () {
  discovery = {
    discoveryId: "DISC-TEST-002",
    workflowMode: "full",
    modeDisqualifiers: [],
    changedContractKinds: [],
    changesGoal: false,
    changesScope: false,
    changesAcceptanceCriteria: true,
    expandsSecurityBoundary: false,
    introducesIrreversibleOperation: false,
  };
});

Given("目的を変更する実装中の発見がある", function () {
  discovery = {
    discoveryId: "DISC-TEST-003",
    workflowMode: "full",
    modeDisqualifiers: [],
    changedContractKinds: [],
    changesGoal: true,
    changesScope: false,
    changesAcceptanceCriteria: false,
    expandsSecurityBoundary: false,
    introducesIrreversibleOperation: false,
  };
});

Given("fullでscopeを変更する実装中の発見がある", function () {
  discovery = {
    discoveryId: "DISC-TEST-004",
    workflowMode: "full",
    modeDisqualifiers: [],
    changedContractKinds: [],
    changesGoal: false,
    changesScope: true,
    changesAcceptanceCriteria: false,
    expandsSecurityBoundary: false,
    introducesIrreversibleOperation: false,
  };
});

Given("quickで受け入れ条件を変更する実装中の発見がある", function () {
  discovery = {
    discoveryId: "DISC-TEST-005",
    workflowMode: "quick",
    modeDisqualifiers: [],
    changedContractKinds: [],
    changesGoal: false,
    changesScope: false,
    changesAcceptanceCriteria: true,
    expandsSecurityBoundary: false,
    introducesIrreversibleOperation: false,
  };
});

Given("quickでsecurity境界を拡大する実装中の発見がある", function () {
  discovery = {
    discoveryId: "DISC-TEST-006",
    workflowMode: "quick",
    modeDisqualifiers: [],
    changedContractKinds: [],
    changesGoal: false,
    changesScope: false,
    changesAcceptanceCriteria: false,
    expandsSecurityBoundary: true,
    introducesIrreversibleOperation: false,
  };
});

Given("pocで不可逆操作を導入する実装中の発見がある", function () {
  discovery = {
    discoveryId: "DISC-TEST-007",
    workflowMode: "poc",
    modeDisqualifiers: [],
    changedContractKinds: [],
    changesGoal: false,
    changesScope: false,
    changesAcceptanceCriteria: false,
    expandsSecurityBoundary: false,
    introducesIrreversibleOperation: true,
  };
});

Given("quickでpublic API変更を検出した実装中の発見がある", function () {
  discovery = {
    discoveryId: "DISC-TEST-008",
    workflowMode: "quick",
    modeDisqualifiers: [
      { id: "public-api", evidence: "公開API contractの差分を検出した" },
    ],
    changedContractKinds: [],
    changesGoal: false,
    changesScope: false,
    changesAcceptanceCriteria: false,
    expandsSecurityBoundary: false,
    introducesIrreversibleOperation: false,
  };
});

Given("pocでhigh risk条件を検出した実装中の発見がある", function () {
  discovery = {
    discoveryId: "DISC-TEST-009",
    workflowMode: "poc",
    modeDisqualifiers: [
      { id: "personal-data", evidence: "個人dataへの影響を検出した" },
    ],
    changedContractKinds: [],
    changesGoal: false,
    changesScope: false,
    changesAcceptanceCriteria: false,
    expandsSecurityBoundary: false,
    introducesIrreversibleOperation: false,
  };
});

Given("fullでdomain invariantの契約変更を発見した", function () {
  discovery = {
    discoveryId: "DISC-TEST-010",
    workflowMode: "full",
    modeDisqualifiers: [],
    changedContractKinds: ["domain-invariant"],
    changesGoal: false,
    changesScope: false,
    changesAcceptanceCriteria: false,
    expandsSecurityBoundary: false,
    introducesIrreversibleOperation: false,
  };
});

When("実装中発見の処理を判定する", function () {
  assessment = assessImplementationDiscovery(discovery);
});

Given("変更が単一domain境界に限定される", function () {
  affectedBoundaries = ["domain"];
});

Given("変更がworkflowとqualityの複数境界に及ぶ", function () {
  affectedBoundaries = ["workflow", "quality"];
});

Then("実装を継続して事実と影響と対処と検証と仕様更新を記録する", function () {
  assert.equal(assessment.disposition, "continue");
  assert.deepEqual(assessment.affectedArtifacts, []);
  assert.deepEqual(assessment.requiredRecordFields, [
    "discoveryId",
    "fact",
    "impact",
    "decision",
    "action",
    "verification",
    "specificationUpdate",
  ]);
});

Then("要件と設計と実装計画だけを再確定する", function () {
  assert.equal(assessment.disposition, "rebaseline-affected-contracts");
  assert.deepEqual(assessment.affectedArtifacts, [
    "01_要件定義.md",
    "02_設計.md",
    "03_実装計画.md",
  ]);
});

Then("要求から実装計画までを再確定する", function () {
  assert.equal(assessment.disposition, "rebaseline-affected-contracts");
  assert.deepEqual(assessment.affectedArtifacts, [
    "00_要求定義.md",
    "01_要件定義.md",
    "02_設計.md",
    "03_実装計画.md",
  ]);
});

Then("要求と要件と設計と実装計画を再確定する", function () {
  assert.equal(assessment.disposition, "rebaseline-affected-contracts");
  assert.deepEqual(assessment.affectedArtifacts, [
    "00_要求定義.md",
    "01_要件定義.md",
    "02_設計.md",
    "03_実装計画.md",
  ]);
});

Then("quickの集約00だけを再確定する", function () {
  assert.equal(assessment.disposition, "rebaseline-affected-contracts");
  assert.deepEqual(assessment.affectedArtifacts, ["00_要求定義.md"]);
});

Then("fullへ昇格して00から03を確定する", function () {
  assert.equal(assessment.disposition, "promote-to-full");
  assert.deepEqual(assessment.affectedArtifacts, [
    "00_要求定義.md",
    "01_要件定義.md",
    "02_設計.md",
    "03_実装計画.md",
  ]);
});

Then("fullへ昇格し失格Evidenceを保持して00から03を確定する", function () {
  assert.equal(assessment.workflowMode, "quick");
  assert.deepEqual(assessment.modeDisqualifiers, [
    { id: "public-api", evidence: "公開API contractの差分を検出した" },
  ]);
  assert.equal(assessment.disposition, "promote-to-full");
  assert.deepEqual(assessment.affectedArtifacts, [
    "00_要求定義.md",
    "01_要件定義.md",
    "02_設計.md",
    "03_実装計画.md",
  ]);
});

Then("PoCを停止するかfullへ昇格する", function () {
  assert.equal(assessment.disposition, "stop-or-promote-full");
  assert.deepEqual(assessment.affectedArtifacts, []);
  assert.deepEqual(assessment.promotionArtifacts, [
    "00_要求定義.md",
    "01_要件定義.md",
    "02_設計.md",
    "03_実装計画.md",
  ]);
});

Then("fullのその他契約変更は01から03だけを再確定する", function () {
  assert.equal(assessment.disposition, "rebaseline-affected-contracts");
  assert.deepEqual(assessment.affectedArtifacts, [
    "01_要件定義.md",
    "02_設計.md",
    "03_実装計画.md",
  ]);
});

Then("PoC停止の更新対象とfull昇格の補完成果物を分離する", function () {
  assert.equal(assessment.disposition, "stop-or-promote-full");
  assert.deepEqual(assessment.affectedArtifacts, []);
  assert.deepEqual(assessment.promotionArtifacts, [
    "00_要求定義.md",
    "01_要件定義.md",
    "02_設計.md",
    "03_実装計画.md",
  ]);
});

When("bug-fixのmedium risk検証集合を選ぶ", function () {
  selection = selectVerificationSet(verificationInput("bug-fix", "medium"));
});

Then("bug reproductionとregressionとintegrationが選ばれる", function () {
  assert.deepEqual(selection.methods, [
    "bug-reproduction",
    "regression-test",
    "integration-test",
  ]);
});

When("algorithmのcritical risk検証集合を選ぶ", function () {
  selection = selectVerificationSet(verificationInput("algorithm", "critical"));
});

Then(
  "propertyとdifferentialとnegativeとsecurityが選ばれmutationは一律強制されない",
  function () {
    for (const method of [
      "property-based-test",
      "differential-test",
      "negative-test",
      "security-analysis",
    ] as const) {
      assert.equal(selection.methods.includes(method), true);
    }
    assert.equal(selection.methods.includes("mutation-test"), false);
  },
);

When("documentationのlow riskで複数境界の検証集合を選ぶ", function () {
  selection = selectVerificationSet(verificationInput("documentation", "low"));
});

Then("integrationが追加されTDD反復は要求されない", function () {
  assert.equal(selection.methods.includes("integration-test"), true);
  assert.equal(
    selection.methods.some((method) => method.includes("test-first")),
    false,
  );
});

When("外部契約変更を伴うnew-featureの検証集合を選ぶ", function () {
  const input = verificationInput("new-feature", "medium");
  input.impactAnalysis.externalContractChanged = true;
  selection = selectVerificationSet(input);
});

Then("RequirementとACとImpactに対応するcontract検証が選ばれる", function () {
  assert.deepEqual(selection.requirementIds, ["REQ-001"]);
  assert.deepEqual(selection.acceptanceCriteriaIds, ["AC-001"]);
  assert.equal(selection.impactAnalysis.externalContractChanged, true);
  assert.equal(selection.methods.includes("contract-test"), true);
  assert.equal(selection.methods.includes("integration-test"), true);
});

When("RequirementとACがない検証集合を選ぶ", function () {
  const input = verificationInput("new-feature", "low");
  input.requirementIds = [];
  input.acceptanceCriteriaIds = [];
  this.value = captureError(() => selectVerificationSet(input));
});

Then("検証集合の選択を拒否する", function () {
  assert.ok(this.value instanceof Error);
});

Given("fullのautomatic deliveryがmerge-readyである", function () {
  deliveryInput = {
    workflowMode: "full",
    trustedMergeMode: "automatic",
    assistedAuthorityVerified: false,
    mergeReadyVerified: true,
  };
});

Given("pocのautomatic deliveryがmerge-readyである", function () {
  deliveryInput = {
    workflowMode: "poc",
    trustedMergeMode: "automatic",
    assistedAuthorityVerified: false,
    mergeReadyVerified: true,
  };
});

Given("quickのassisted deliveryに対象PR authorityがない", function () {
  deliveryInput = {
    workflowMode: "quick",
    trustedMergeMode: "assisted",
    assistedAuthorityVerified: false,
    mergeReadyVerified: true,
  };
});

When("delivery継続先を判定する", function () {
  deliveryContinuation = decideDeliveryContinuation(deliveryInput);
});

Then("独立したpr merge操作へ進む", function () {
  assert.equal(deliveryContinuation, "invoke-pr-merge");
});

Then("PRを停止点にする", function () {
  assert.equal(deliveryContinuation, "stop-at-pr");
});

Then("authorityと再開条件を待つ", function () {
  assert.equal(deliveryContinuation, "wait-authority");
});

Given("PoC stagingのworkflow modeがある", function () {
  this.value = "poc";
});

When("PoC stagingでpr merge可否を判定する", function () {
  this.value = captureError(() =>
    assertWorkflowMergeAllowed(this.value as "poc"),
  );
});

Then("pr mergeを拒否する", function () {
  assert.ok(this.value instanceof Error);
  assert.match(this.value.message, /PoC.*PR.*停止点/u);
});

Given("有効なVerification Set入力JSONがrepository内にある", function () {
  writeCliInput(this, {
    changeType: "new-feature",
    risk: "medium",
    affectedBoundaries: ["workflow", "quality"],
    requirementIds: ["REQ-WF-012"],
    acceptanceCriteriaIds: ["AC-WF-012-01"],
    impactAnalysis: {
      securityRelevant: false,
      dataLossPossible: false,
      irreversibleOperation: false,
      externalContractChanged: true,
      concurrentBehaviorChanged: false,
    },
  });
});

When("workflow verification-set CLIで選定する", async function () {
  const result = await runAgileCli([
    "workflow",
    "verification-set",
    "--input=input.json",
    `--root=${cliRoot}`,
  ]);
  this.value = result.output;
  this.error = result.error;
});

Then("production CLIがVerification Setを機械可読に返す", function () {
  assert.equal(this.error, undefined);
  const output = this.value as {
    requirementIds: string[];
    acceptanceCriteriaIds: string[];
    methods: string[];
  };
  assert.deepEqual(output.requirementIds, ["REQ-WF-012"]);
  assert.deepEqual(output.acceptanceCriteriaIds, ["AC-WF-012-01"]);
  assert.equal(output.methods.includes("contract-test"), true);
  const usage = findCommandUsage("workflow", "verification-set");
  assert.ok(usage);
  assert.deepEqual(
    usage.requiredFlags.map(({ name }) => name),
    ["input"],
  );
});

Given("有効な実装中発見入力JSONがrepository内にある", function () {
  writeCliInput(this, {
    discoveryId: "DISC-CLI-001",
    workflowMode: "quick",
    modeDisqualifiers: [],
    changedContractKinds: [],
    changesGoal: false,
    changesScope: false,
    changesAcceptanceCriteria: true,
    expandsSecurityBoundary: false,
    introducesIrreversibleOperation: false,
  });
});

When("workflow assess-discovery CLIで評価する", async function () {
  const result = await runAgileCli([
    "workflow",
    "assess-discovery",
    "--input=input.json",
    `--root=${cliRoot}`,
  ]);
  this.value = result.output;
  this.error = result.error;
});

Then("production CLIがmode別の前向きな処理先を返す", function () {
  assert.equal(this.error, undefined);
  assert.deepEqual(this.value, {
    discoveryId: "DISC-CLI-001",
    workflowMode: "quick",
    modeDisqualifiers: [],
    disposition: "rebaseline-affected-contracts",
    affectedArtifacts: ["00_要求定義.md"],
    requiredRecordFields: [
      "discoveryId",
      "fact",
      "impact",
      "decision",
      "action",
      "verification",
      "specificationUpdate",
    ],
  });
  const usage = findCommandUsage("workflow", "assess-discovery");
  assert.ok(usage);
  assert.deepEqual(
    usage.requiredFlags.map(({ name }) => name),
    ["input"],
  );
});

Given(
  "未知fieldを含むVerification Set入力JSONがrepository内にある",
  function () {
    writeCliInput(this, {
      changeType: "new-feature",
      risk: "low",
      affectedBoundaries: ["workflow"],
      requirementIds: ["REQ-WF-012"],
      acceptanceCriteriaIds: ["AC-WF-012-01"],
      impactAnalysis: {
        securityRelevant: false,
        dataLossPossible: false,
        irreversibleOperation: false,
        externalContractChanged: false,
        concurrentBehaviorChanged: false,
        inferredSafe: true,
      },
    });
  },
);

Then("未知fieldをfail-closedで拒否する", function () {
  assert.ok(this.error instanceof Error);
  assert.match(this.error.message, /未知field.*inferredSafe/u);
  assert.equal(this.value, undefined);
});

Given("必須fieldが欠けた実装中発見入力JSONがrepository内にある", function () {
  writeCliInput(this, {
    discoveryId: "DISC-CLI-002",
    workflowMode: "full",
    modeDisqualifiers: [],
    changedContractKinds: [],
    changesGoal: false,
    changesScope: false,
    changesAcceptanceCriteria: false,
    expandsSecurityBoundary: false,
  });
});

Then("欠損fieldをfail-closedで拒否する", function () {
  assert.ok(this.error instanceof Error);
  assert.match(
    this.error.message,
    /必須field.*introducesIrreversibleOperation/u,
  );
  assert.equal(this.value, undefined);
});

Given(
  "重複した失格IDを含む実装中発見入力JSONがrepository内にある",
  function () {
    writeCliInput(this, {
      discoveryId: "DISC-CLI-003",
      workflowMode: "quick",
      modeDisqualifiers: [
        { id: "public-api", evidence: "公開API差分" },
        { id: " public-api ", evidence: "同じ差分の別観測" },
      ],
      changedContractKinds: [],
      changesGoal: false,
      changesScope: false,
      changesAcceptanceCriteria: false,
      expandsSecurityBoundary: false,
      introducesIrreversibleOperation: false,
    });
  },
);

Then("重複した失格IDをfail-closedで拒否する", function () {
  assert.ok(this.error instanceof Error);
  assert.match(this.error.message, /重複id.*public-api/u);
  assert.equal(this.value, undefined);
});

Given("未知の失格IDを含む実装中発見入力JSONがrepository内にある", function () {
  writeCliInput(this, {
    discoveryId: "DISC-CLI-004",
    workflowMode: "quick",
    modeDisqualifiers: [
      { id: "invented-risk", evidence: "canonicalでない分類" },
    ],
    changedContractKinds: [],
    changesGoal: false,
    changesScope: false,
    changesAcceptanceCriteria: false,
    expandsSecurityBoundary: false,
    introducesIrreversibleOperation: false,
  });
});

Then("未知の失格IDをfail-closedで拒否する", function () {
  assert.ok(this.error instanceof Error);
  assert.match(this.error.message, /未知id.*invented-risk/u);
  assert.equal(this.value, undefined);
});

Given(
  "不正なdiscoveryIdを含む実装中発見入力JSONがrepository内にある",
  function () {
    writeCliInput(this, {
      discoveryId: "DSC-CLI-005",
      workflowMode: "quick",
      modeDisqualifiers: [],
      changedContractKinds: [],
      changesGoal: false,
      changesScope: false,
      changesAcceptanceCriteria: false,
      expandsSecurityBoundary: false,
      introducesIrreversibleOperation: false,
    });
  },
);

Then("不正なdiscoveryIdをfail-closedで拒否する", function () {
  assert.ok(this.error instanceof Error);
  assert.match(this.error.message, /discoveryId.*DISC-/u);
  assert.equal(this.value, undefined);
});
