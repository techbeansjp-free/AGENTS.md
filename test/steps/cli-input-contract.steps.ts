import assert from "node:assert/strict";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { findCommandUsage } from "../../src/cli-usage.js";
import {
  parseImplementationDiscoveryInput,
  parseVerificationSelectionInput,
} from "../../src/domain/agile-verification.js";
import { parseReviewRoundInput } from "../../src/domain/review-convergence.js";
import type { InputFieldSpec } from "../../src/domain/input-contract.js";

interface Target {
  readonly command: string;
  readonly subcommand: string;
  readonly parse: (value: unknown) => unknown;
  readonly valid: () => Record<string, unknown>;
}

interface CliInputWorld extends WorkflowWorld {
  cliInputTargets: readonly Target[];
  cliInputErrors: Record<string, string>;
}

const { Given, When, Then } = stepDefinitions<CliInputWorld>();

const SHA1 = "a".repeat(40);
const SHA256 = "b".repeat(64);

function reviewRound(findings: unknown[] = []): Record<string, unknown> {
  return {
    round: 1,
    previousRoundDigest: null,
    anchor: {
      scopeIds: ["ISSUE-1388"],
      acceptanceCriteriaIds: ["AC-01"],
      invariantIds: [],
      diffBaseSha: SHA1,
      initialHeadSha: SHA1,
      initialDiffDigest: SHA256,
    },
    candidateHeadSha: SHA1,
    focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
    findings,
  };
}

function finding(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "REV-01",
    severity: "High",
    status: "valid",
    source: "review",
    relation: "acceptance-violation",
    evidence: "反例",
    path: "src/cli.ts",
    contractId: "AC-01",
    causedByFindingId: null,
    ...overrides,
  };
}

const TARGETS: readonly Target[] = [
  {
    command: "workflow",
    subcommand: "verification-set",
    parse: parseVerificationSelectionInput,
    valid: () =>
      structuredClone(
        findCommandUsage("workflow", "verification-set")!.inputContract!
          .example as Record<string, unknown>,
      ),
  },
  {
    command: "workflow",
    subcommand: "assess-discovery",
    parse: parseImplementationDiscoveryInput,
    valid: () =>
      structuredClone(
        findCommandUsage("workflow", "assess-discovery")!.inputContract!
          .example as Record<string, unknown>,
      ),
  },
  {
    command: "review",
    subcommand: "round",
    parse: parseReviewRoundInput,
    valid: () => reviewRound([finding()]),
  },
];

function fieldsOf(target: Target): readonly InputFieldSpec[] {
  const fields = findCommandUsage(target.command, target.subcommand)
    ?.inputContract?.fields;
  assert.ok(fields && fields.length > 0, `${target.subcommand}にfieldsが無い`);
  return fields;
}

function errorOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return (error as Error).message;
  }
  assert.fail("拒否されるべき入力が受理された");
}

Given("3コマンドのusageと有効な入力例がある", function () {
  this.cliInputTargets = TARGETS;
  for (const target of TARGETS) target.parse(target.valid());
});

When(
  "inputContract.fieldsの最上位の必須項目を1つずつ欠いた入力を検証する",
  function () {
    this.cliInputErrors = {};
    for (const target of this.cliInputTargets)
      for (const spec of fieldsOf(target).filter(
        ({ path, required }) => required && !/[.[]/u.test(path),
      )) {
        const input = target.valid();
        delete input[spec.path];
        this.cliInputErrors[`${target.subcommand}:${spec.path}`] = errorOf(() =>
          target.parse(input),
        );
      }
  },
);

Then(
  "欠いた項目だけが必須fieldとして名指され受理値の一覧は検証の列挙と一致する",
  function () {
    for (const [key, message] of Object.entries(this.cliInputErrors)) {
      const name = key.split(":")[1]!;
      assert.match(message, new RegExp(`必須fieldがありません: ${name}$`, "u"));
    }
    // 最上位の実入力keyとfieldsの最上位項目が一致する（helpにだけ・検証にだけある項目が無い）
    for (const target of this.cliInputTargets) {
      const topLevel = fieldsOf(target)
        .filter(({ path }) => !/[.[]/u.test(path))
        .map(({ path }) => path);
      for (const key of Object.keys(target.valid()))
        assert.ok(topLevel.includes(key), `${target.subcommand}.${key}`);
      const unknown = { ...target.valid(), extraField: true };
      assert.match(
        errorOf(() => target.parse(unknown)),
        /未知fieldを拒否しました: extraField/u,
      );
    }
    const relation = fieldsOf(TARGETS[2]!).find(
      ({ path }) => path === "findings[].relation",
    )!;
    const message = errorOf(() =>
      parseReviewRoundInput(reviewRound([finding({ relation: "x" })])),
    );
    assert.ok(message.includes(`受理値: ${relation.values!.join("|")}`));
  },
);

Given("未知fieldと欠落fieldを同時に含む3コマンドの入力がある", function () {
  this.cliInputTargets = TARGETS;
});

When("それぞれを検証する", function () {
  this.cliInputErrors = {};
  if (this.cliInputTargets) {
    for (const target of this.cliInputTargets) {
      const input = target.valid();
      const [firstKey] = Object.keys(input);
      delete input[firstKey!];
      input.wrongName = 1;
      this.cliInputErrors[target.subcommand] = errorOf(() =>
        target.parse(input),
      );
    }
    return;
  }
  this.cliInputErrors = {
    enum: errorOf(() =>
      parseVerificationSelectionInput({
        ...TARGETS[0]!.valid(),
        risk: "SECRET-VALUE-risk",
      }),
    ),
    finding: errorOf(() =>
      parseReviewRoundInput(
        reviewRound([finding(), finding({ id: "REV-02", severity: "urgent" })]),
      ),
    ),
    unsafeId: errorOf(() =>
      parseReviewRoundInput(
        reviewRound([finding({ id: "bad id\nSECRET", severity: "urgent" })]),
      ),
    ),
  };
});

Then("1件のerrorが未知fieldと欠落fieldの名前を両方含む", function () {
  for (const target of this.cliInputTargets) {
    const message = this.cliInputErrors[target.subcommand]!;
    const [firstKey] = Object.keys(target.valid());
    assert.match(message, /未知fieldを拒否しました: wrongName/u);
    assert.ok(
      message.includes(`必須fieldがありません: ${firstKey}`),
      `${target.subcommand}: ${message}`,
    );
  }
});

Given("enum違反とfindingの誤りを含む入力がある", function () {
  this.cliInputTargets = undefined as unknown as readonly Target[];
});

Then(
  "診断は受理値の集合とfinding IDを含み違反した入力値を含まない",
  function () {
    const {
      enum: enumError,
      finding: findingError,
      unsafeId,
    } = this.cliInputErrors;
    assert.match(
      enumError!,
      /riskが不正です（受理値: low\|medium\|high\|critical）/u,
    );
    assert.ok(!enumError!.includes("SECRET-VALUE"));
    assert.match(
      findingError!,
      /findings\[1\]（id=REV-02）\.severityが不正です/u,
    );
    assert.match(findingError!, /受理値: Critical\|High\|Medium\|Low/u);
    assert.ok(!findingError!.includes("urgent"));
    assert.match(unsafeId!, /findings\[0\]\.id/u);
    assert.ok(!unsafeId!.includes("SECRET"));
  },
);
