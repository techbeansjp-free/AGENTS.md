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

function example(subcommand: string): Record<string, unknown> {
  return structuredClone(
    findCommandUsage("workflow", subcommand)!.inputContract!.example as Record<
      string,
      unknown
    >,
  );
}

const TARGETS: readonly Target[] = [
  {
    command: "workflow",
    subcommand: "verification-set",
    parse: parseVerificationSelectionInput,
    valid: () => example("verification-set"),
  },
  {
    command: "workflow",
    subcommand: "assess-discovery",
    parse: parseImplementationDiscoveryInput,
    valid: () => example("assess-discovery"),
  },
  {
    command: "review",
    subcommand: "round",
    parse: parseReviewRoundInput,
    valid: () => reviewRound([finding()]),
  },
];

/** 配列の要素を1件以上持ち、全階層の項目を含む有効な入力。 */
function deepValid(target: Target): Record<string, unknown> {
  const input = target.valid();
  if (target.subcommand === "assess-discovery") {
    input.modeDisqualifiers = [{ id: "public-api", evidence: "根拠" }];
    input.changedContractKinds = ["requirement"];
  }
  if (target.subcommand === "round") {
    (input.focus as Record<string, unknown>).adjacentScope = [
      { path: "src/cli-usage.ts", graphEvidence: SHA256 },
    ];
    (input.anchor as Record<string, unknown>).progressInventory = {
      targetPath: "docs/issues/example/03_実装計画.md",
      baselineDigest: SHA256,
      prefixDigest: SHA256,
      suffixDigest: SHA256,
      fileMode: 0o644,
      allowedTaskIds: ["T01"],
    };
    input.inspection = {
      fromSha: SHA1,
      diffDigest: SHA256,
      cumulative: {
        baseSha: SHA1,
        scope: "paths",
        paths: [{ path: "src/cli-usage.ts", diffDigest: SHA256 }],
      },
    };
  }
  return input;
}

/**
 * 契約の期待表。helpと検証の両方から独立に固定する（`?`は任意項目）。
 * 定義から項目が消えると、helpと検証が同じ向きにずれてもここで落ちる。
 */
const EXPECTED_PATHS: Readonly<Record<string, readonly string[]>> = {
  "verification-set": [
    "changeType",
    "risk",
    "affectedBoundaries",
    "requirementIds",
    "acceptanceCriteriaIds",
    "impactAnalysis",
    "impactAnalysis.securityRelevant",
    "impactAnalysis.dataLossPossible",
    "impactAnalysis.irreversibleOperation",
    "impactAnalysis.externalContractChanged",
    "impactAnalysis.concurrentBehaviorChanged",
  ],
  "assess-discovery": [
    "discoveryId",
    "workflowMode",
    "modeDisqualifiers",
    "modeDisqualifiers[].id",
    "modeDisqualifiers[].evidence",
    "changedContractKinds",
    "changesGoal",
    "changesScope",
    "changesAcceptanceCriteria",
    "expandsSecurityBoundary",
    "introducesIrreversibleOperation",
  ],
  round: [
    "round",
    "previousRoundDigest",
    "anchor",
    "anchor.scopeIds",
    "anchor.acceptanceCriteriaIds",
    "anchor.invariantIds",
    "anchor.diffBaseSha",
    "anchor.initialHeadSha",
    "anchor.initialDiffDigest",
    "anchor.progressInventory?",
    "anchor.progressInventory.targetPath",
    "anchor.progressInventory.baselineDigest",
    "anchor.progressInventory.prefixDigest",
    "anchor.progressInventory.suffixDigest",
    "anchor.progressInventory.fileMode",
    "anchor.progressInventory.allowedTaskIds",
    "anchor.progressInventory.schemaVersion?",
    "anchor.progressInventory.targets?",
    "candidateHeadSha",
    "focus",
    "focus.previousBlocking",
    "focus.fixedDiff",
    "focus.adjacentScope",
    "focus.adjacentScope[].path",
    "focus.adjacentScope[].graphEvidence",
    "focus.adjacentScopeUnbounded?",
    "findings",
    "findings[].id",
    "findings[].severity",
    "findings[].status",
    "findings[].source",
    "findings[].relation",
    "findings[].evidence",
    "findings[].path",
    "findings[].contractId",
    "findings[].causedByFindingId",
    "findings[].decisionRef?",
    "followOnly?",
    "recordLayerOnly?",
    "inspection?",
    "inspection.fromSha",
    "inspection.diffDigest",
    "inspection.cumulative?",
    "inspection.cumulative.baseSha",
    "inspection.cumulative.scope",
    "inspection.cumulative.diffDigest?",
    "inspection.cumulative.paths?",
    "inspection.cumulative.paths[].path",
    "inspection.cumulative.paths[].diffDigest",
  ],
};

function fieldsOf(target: Target): readonly InputFieldSpec[] {
  const fields = findCommandUsage(target.command, target.subcommand)
    ?.inputContract?.fields;
  assert.ok(fields && fields.length > 0, `${target.subcommand}にfieldsが無い`);
  return fields;
}

/** `a[].b`の親object（配列は先頭要素）と末尾の名前を返す。 */
function locate(
  input: Record<string, unknown>,
  path: string,
): { parent: Record<string, unknown> | undefined; name: string } {
  const segments = path.split(".");
  const name = segments.pop()!;
  let current: unknown = input;
  for (const segment of segments) {
    const key = segment.replace(/\[\]$/u, "");
    current = (current as Record<string, unknown> | undefined)?.[key];
    if (segment.endsWith("[]"))
      current = (current as unknown[] | undefined)?.[0];
  }
  return {
    parent: current as Record<string, unknown> | undefined,
    name: name.replace(/\[\]$/u, ""),
  };
}

function errorOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return (error as Error).message;
  }
  assert.fail("拒否されるべき入力が受理された");
}

const UNSAFE = "SECRET\u0007値";

Given("3コマンドのusageと全階層を含む有効な入力がある", function () {
  this.cliInputTargets = TARGETS;
  for (const target of TARGETS) target.parse(deepValid(target));
});

When(
  "inputContract.fieldsの各項目を欠く・未知fieldを足す・任意項目を足す・受理値外にした入力を検証する",
  function () {
    this.cliInputErrors = {};
    for (const target of this.cliInputTargets) {
      const fields = fieldsOf(target);
      const record = (kind: string, path: string, message: string): void => {
        this.cliInputErrors[`${target.subcommand}|${kind}|${path}`] = message;
      };
      for (const spec of fields) {
        if (spec.required) {
          const input = deepValid(target);
          const { parent, name } = locate(input, spec.path);
          assert.ok(parent && name in parent, `${spec.path}が有効入力に無い`);
          delete parent[name];
          record(
            "missing",
            spec.path,
            errorOf(() => target.parse(input)),
          );
        } else {
          const input = deepValid(target);
          const { parent, name } = locate(input, spec.path);
          assert.ok(parent, `${spec.path}の親が有効入力に無い`);
          parent[name] =
            spec.type === "true"
              ? true
              : spec.type.includes("null")
                ? null
                : {};
          try {
            target.parse(input);
            record("optional", spec.path, "");
          } catch (error) {
            record("optional", spec.path, (error as Error).message);
          }
        }
        if (spec.values) {
          const input = deepValid(target);
          const { parent, name } = locate(input, spec.path);
          parent![name] = spec.type.includes("[]") ? [UNSAFE] : UNSAFE;
          record(
            "values",
            spec.path,
            errorOf(() => target.parse(input)),
          );
        }
      }
      const objects = [
        "",
        ...fields
          .filter(({ type }) => type.startsWith("object"))
          .map(({ path, type }) => (type.includes("[]") ? `${path}[]` : path)),
      ];
      for (const object of objects) {
        const input = deepValid(target);
        const { parent, name } = locate(
          input,
          object === "" ? "extraField" : `${object}.extraField`,
        );
        if (!parent) continue;
        parent[name] = true;
        record(
          "unknown",
          object,
          errorOf(() => target.parse(input)),
        );
      }
    }
  },
);

Then(
  "項目一覧は契約の期待表と一致し検証は全階層で同じ必須・任意項目と受理値を使う",
  function () {
    for (const target of this.cliInputTargets)
      assert.deepEqual(
        fieldsOf(target).map(({ path, required }) =>
          required ? path : `${path}?`,
        ),
        EXPECTED_PATHS[target.subcommand],
        target.subcommand,
      );
    const kinds = new Set<string>();
    for (const [key, message] of Object.entries(this.cliInputErrors)) {
      const [subcommand, kind, path] = key.split("|") as [
        string,
        string,
        string,
      ];
      kinds.add(kind);
      const spec = fieldsOf(
        TARGETS.find((target) => target.subcommand === subcommand)!,
      ).find((candidate) => candidate.path === path);
      if (kind === "missing") {
        const name = path.split(".").pop()!.replace(/\[\]$/u, "");
        assert.ok(
          message.endsWith(`必須fieldがありません: ${name}`) &&
            !message.includes("未知field"),
          `${key}: ${message}`,
        );
      }
      if (kind === "optional")
        assert.ok(!message.includes("未知field"), `${key}: ${message}`);
      if (kind === "values") {
        assert.ok(
          message.includes(`受理値: ${spec!.values!.join("|")}`),
          `${key}: ${message}`,
        );
        assert.ok(!message.includes("SECRET"), `${key}: ${message}`);
      }
      if (kind === "unknown")
        assert.ok(
          message.includes("未知fieldを拒否しました: extraField"),
          `${key}: ${message}`,
        );
    }
    assert.deepEqual([...kinds].sort(), [
      "missing",
      "optional",
      "unknown",
      "values",
    ]);
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
    disqualifier: errorOf(() =>
      parseImplementationDiscoveryInput({
        ...TARGETS[1]!.valid(),
        modeDisqualifiers: [{ id: "SECRET\u0007id", evidence: "根拠" }],
      }),
    ),
    contractKind: errorOf(() =>
      parseImplementationDiscoveryInput({
        ...TARGETS[1]!.valid(),
        changedContractKinds: ["requirement", "SECRET\u0007kind"],
      }),
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
      disqualifier,
      contractKind,
      unsafeId,
    } = this.cliInputErrors;
    assert.match(
      disqualifier!,
      /modeDisqualifiers\[0\]\.idの未知idを拒否しました（受理値: [^）]*public-api/u,
    );
    assert.match(
      contractKind!,
      /changedContractKinds\[1\]の未知値を拒否しました（受理値: [^）]*requirement/u,
    );
    for (const message of [disqualifier!, contractKind!])
      assert.ok(!message.includes("SECRET"), message);
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
