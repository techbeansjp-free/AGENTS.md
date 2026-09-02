import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import {
  authorizeMerge,
  resolveMergeMethod,
  type MergeMethodDecision,
} from "../../src/domain/delivery.js";
import { validatePolicy } from "../../src/domain/policy.js";
import { type Policy } from "../../src/types.js";
import { main } from "../../src/cli.js";

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface MergeMethodWorld extends WorkflowWorld {
  cliResult: CommandResult;
  decision: MergeMethodDecision;
  mergeAuthorization: ReturnType<typeof authorizeMerge>;
  policy: Policy;
  policyFile: string;
  validation: ReturnType<typeof validatePolicy>;
}

const { Given, When, Then } = stepDefinitions<MergeMethodWorld>();

function mergePolicy(overrides: Partial<Policy["merge"]> = {}): Policy {
  return {
    schemaVersion: "agent-skill-chain/project-policy/v0.3.1",
    delivery: { stopAt: "pull_request" },
    merge: {
      mode: "automatic",
      branches: ["develop", "master", "feature/*"],
      methods: ["merge", "squash", "rebase"],
      requiredChecks: [],
      requiredReviews: 0,
      ...overrides,
    },
    budgets: { localFeedbackMs: 100, prGateMs: 1000 },
    rules: [
      {
        ruleId: "ASC-MERGE-TEST-001",
        purpose: "merge policyのtest入力を検証する",
        riskClass: "quality",
        scope: ["policy"],
        enforcement: "warn",
        activation: "active",
        owner: "test owner",
        targetLayer: "package",
        evidence: "merge method scenario",
        remediation: "test policyを修正する",
        overridePolicy: "bound",
        rollback: "test入力を保持する",
      },
    ],
  };
}

async function runCli(args: string[]): Promise<CommandResult> {
  let stdout = "";
  const write = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    return { status: await main(args), stdout, stderr: "" };
  } finally {
    process.stdout.write = write;
  }
}

Given(
  "base branch {string}へsquashだけを許可するbranch単位policyがある",
  function (baseRef: string) {
    this.policy = mergePolicy({
      methods: ["merge", "squash"],
      branchMethods: [{ branches: [baseRef], methods: ["squash"] }],
    });
  },
);

Given(
  "base branch {string}へ互いに共通しない複数のbranch単位policyがある",
  function (baseRef: string) {
    this.policy = mergePolicy({
      branchMethods: [
        { branches: [baseRef], methods: ["merge", "squash"] },
        { branches: [baseRef], methods: ["rebase"] },
      ],
    });
  },
);

Given("globalにない方式をbranch単位policyが許可している", function () {
  this.policy = mergePolicy({
    methods: ["merge"],
    branchMethods: [{ branches: ["master"], methods: ["squash"] }],
  });
});

Given(
  "{string}と{string}を長命branchとするpolicyがある",
  function (headRef: string, baseRef: string) {
    this.policy = mergePolicy({ branches: [headRef, baseRef] });
  },
);

Given("branchMethodsを持たずsquashを許可する既存policyがある", function () {
  this.policy = mergePolicy({
    branches: ["develop", "master"],
    methods: ["squash"],
  });
});

When(
  "{string}から{string}へ{string}方式を解決する",
  function (headRef: string, baseRef: string, method: string) {
    this.decision = resolveMergeMethod({
      baseRef,
      headRef,
      method,
      policy: this.policy,
    });
  },
);

When("merge policyをruntime検証する", function () {
  this.validation = validatePolicy(this.policy);
});

Then(
  "merge方式は許可されresolved methodsは{string}である",
  function (methods: string) {
    assert.equal(this.decision.allowed, true);
    assert.deepEqual(this.decision.resolvedMethods, methods.split(","));
  },
);

Then("merge方式は拒否されresolved methodsは空である", function () {
  assert.equal(this.decision.allowed, false);
  assert.deepEqual(this.decision.resolvedMethods, []);
});

Then("merge方式は拒否される", function () {
  assert.equal(this.decision.allowed, false);
});

Then("merge方式は許可される", function () {
  assert.equal(this.decision.allowed, true);
});

Then("branch単位policyはglobalな許可の拡大として拒否される", function () {
  assert.equal(this.validation.valid, false);
  assert.match(this.validation.errors.join(" "), /global.*許可.*拡大/u);
});

Then(
  "拒否診断はrule ID、全面衝突の根拠、mergeでの次の操作、必要authority、rollbackを日本語で返す",
  function () {
    const diagnostic = this.decision.diagnostic;
    assert.equal(diagnostic?.ruleId, "ASC-MERGE-METHOD-001");
    assert.match(diagnostic?.reasons.join(" ") ?? "", /merge-base.*全面衝突/u);
    assert.match(diagnostic?.next ?? "", /merge方式.*再実行/u);
    assert.match(diagnostic?.requiredAuthority ?? "", /repository/u);
    assert.match(diagnostic?.rollback ?? "", /実行せず|実行しない/u);
  },
);

Given("長命branchへsquashだけを解決する有効なpolicy fileがある", function () {
  const root = this.temp("asc-merge-method-policy-");
  this.policy = mergePolicy({
    branches: ["develop", "master"],
    methods: ["squash"],
  });
  this.policyFile = path.join(root, "policy.json");
  fs.writeFileSync(this.policyFile, `${JSON.stringify(this.policy)}\n`);
});

/**
 * head allowlistとして短命branchのglobだけを列挙した実利用構成を再現する。
 *
 * **`merge.branches`は3役を兼ねる。** この構成は役割1を満たすが、役割3の
 * base候補としては1件も成立しない（Issue #1035）。
 */
Given(
  "短命branchのglobだけを列挙しsquashだけを許可したpolicy fileがある",
  function () {
    const root = this.temp("asc-merge-method-glob-");
    this.policy = mergePolicy({
      branches: ["feature/*", "fix/*", "bugfix/*", "chore/*"],
      methods: ["squash"],
    });
    this.policyFile = path.join(root, "policy.json");
    fs.writeFileSync(this.policyFile, `${JSON.stringify(this.policy)}\n`);
  },
);

/**
 * 除外後のbase候補がちょうど1件になる構成。
 *
 * **長命branch「間」のmergeは2件以上でしか成立しない。** 1件で警告を出すと、
 * 相手のいないbranchを「長命branchのbase候補」と呼ぶことになる（Issue #1035）。
 */
Given(
  "globと具体名1件を列挙しsquashだけを許可したpolicy fileがある",
  function () {
    const root = this.temp("asc-merge-method-single-");
    this.policy = mergePolicy({
      branches: ["feature/*", "fix/*", "main"],
      methods: ["squash"],
    });
    this.policyFile = path.join(root, "policy.json");
    fs.writeFileSync(this.policyFile, `${JSON.stringify(this.policy)}\n`);
  },
);

Given(
  "globと具体名を混在させsquashだけを許可したpolicy fileがある",
  function () {
    const root = this.temp("asc-merge-method-mixed-");
    this.policy = mergePolicy({
      branches: ["feature/*", "fix/*", "develop", "master"],
      methods: ["squash"],
    });
    this.policyFile = path.join(root, "policy.json");
    fs.writeFileSync(this.policyFile, `${JSON.stringify(this.policy)}\n`);
  },
);

When("policy validate CLIを実行する", async function () {
  this.cliResult = await runCli(["policy", "validate", this.policyFile]);
});

Then("policy validate結果にwarn診断がある", function () {
  assert.equal(this.cliResult.status, 0, this.cliResult.stderr);
  const output: unknown = JSON.parse(this.cliResult.stdout);
  assert.ok(output && typeof output === "object" && "warnings" in output);
  const warnings = Reflect.get(output, "warnings");
  assert.ok(Array.isArray(warnings));
  assert.ok(
    warnings.some(
      (warning) =>
        warning &&
        typeof warning === "object" &&
        Reflect.get(warning, "enforcement") === "warn" &&
        Reflect.get(warning, "ruleId") === "ASC-MERGE-METHOD-001",
    ),
  );
});

Then("policy validate CLIの終了コードは0である", function () {
  assert.equal(this.cliResult.status, 0, this.cliResult.stderr);
});

function mergeMethodWarnings(raw: string): Record<string, unknown>[] {
  const output: unknown = JSON.parse(raw);
  assert.ok(output && typeof output === "object" && "warnings" in output);
  const warnings = Reflect.get(output, "warnings");
  assert.ok(Array.isArray(warnings));
  return warnings.filter(
    (warning): warning is Record<string, unknown> =>
      typeof warning === "object" &&
      warning !== null &&
      Reflect.get(warning, "ruleId") === "ASC-MERGE-METHOD-001",
  );
}

Then("policy validate結果に長命branch警告がない", function () {
  assert.equal(this.cliResult.status, 0, this.cliResult.stderr);
  const warnings = mergeMethodWarnings(this.cliResult.stdout);
  assert.equal(
    warnings.length,
    0,
    `globだけの構成で長命branch警告が出ました: ${JSON.stringify(warnings)}`,
  );
});

Then("長命branch警告のbase候補は具体名だけになる", function () {
  assert.equal(this.cliResult.status, 0, this.cliResult.stderr);
  const warnings = mergeMethodWarnings(this.cliResult.stdout);
  assert.equal(warnings.length, 1, this.cliResult.stdout);
  const reasons = (
    Reflect.get(warnings[0]!, "reasons") as string[] | undefined
  )?.join(" ");
  assert.ok(reasons, "reasonsがありません");
  /**
   * **globがbase候補として名指しされていないことまで見る。** 件数だけを数えると、
   * 除外せずに警告を出す実装でも通ってしまう。
   */
  assert.match(reasons, /develop/u);
  assert.match(reasons, /master/u);
  assert.ok(
    !reasons.includes("feature/*") && !reasons.includes("fix/*"),
    `globがbase候補として列挙されています: ${reasons}`,
  );
  const scope = Reflect.get(warnings[0]!, "scope") as string[] | undefined;
  assert.ok(Array.isArray(scope));
  assert.ok(
    !scope.some((entry) => entry.includes("*")),
    `scopeにglobが含まれます: ${scope.join(", ")}`,
  );
});

Given(
  "長命branch同士のsquashを許可したtrusted policyとGitHub観測がある",
  function () {
    this.policy = mergePolicy({
      branches: ["develop", "master"],
      methods: ["merge", "squash"],
    });
  },
);

When("pr merge経路で長命branch同士のsquashを認可する", function () {
  this.mergeAuthorization = authorizeMerge({
    trustedPolicy: this.policy,
    method: "squash",
    checks: [],
    approvals: [],
    headSha: "b".repeat(40),
    branch: "develop",
    baseRef: "master",
    headRef: "develop",
    repositoryVerified: true,
    shaVerified: true,
    protectionVerified: true,
    mergeableVerified: true,
  });
});

Then("pr merge経路はrule ID付きで拒否し外部mergeを呼ばない", function () {
  assert.equal(this.mergeAuthorization.allowed, false);
  assert.equal(
    this.mergeAuthorization.diagnostic?.ruleId,
    "ASC-MERGE-METHOD-001",
  );
  assert.deepEqual(this.mergeAuthorization.operations, []);
});
