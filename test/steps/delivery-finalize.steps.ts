import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {
  WorkflowWorld,
  conformingPullRequestBody,
  stepDefinitions,
} from "../support/world.js";
import { pullRequestRequiredHeadings } from "../../src/domain/issue.js";
import {
  assertPullRequestTrackerBinding,
  createPullRequest,
  authorizeMerge,
  extractIssueClosingNumbers,
  validateIssueClosingReferences,
  type MergeInput,
} from "../../src/domain/delivery.js";
import {
  buildFinalizeReport,
  applyFinalize,
} from "../../src/domain/finalize.js";
import {
  github,
  type ApprovalObservation,
  type BranchProtectionObservation,
  type PullRequestCreationResult,
  type PullRequestInspection,
} from "../../src/adapters/github.js";
import { type Policy } from "../../src/types.js";

interface DeliveryFinalizeWorld extends WorkflowWorld {
  authorization: "approved";
  bodyFile: string;
  ciRunObservation: unknown;
  ciRunError?: Error;
  commitResults: Array<{ sha?: string; authorActorId?: string } | Error>;
  deliveryResult: ReturnType<typeof createPullRequest>;
  evidence: ReturnType<typeof safeDeliveryEvidence>;
  finalizeReport: ReturnType<typeof buildFinalizeReport>;
  finalizeResult: ReturnType<typeof applyFinalize>;
  finalizeState: Parameters<typeof buildFinalizeReport>[0];
  ghLog: string;
  issueSyncResult: { url: string };
  issueReadResult: {
    repository: string;
    issue: number;
    body: string;
    bodySha256: string;
  };
  mergeInput: MergeInput;
  mergeResult: ReturnType<typeof authorizeMerge>;
  mergeOperationResult: { state: string };
  mergeMethodError: string | undefined;
  omitTrustedPolicy: boolean;
  /** provider要求の直前でdispatch claimが消費されたか（Issue #1157）。 */
  dispatchClaimed: boolean;
  settleElapsedMs: number;
  /** PR本文の一時領域を観測するための専用tmp（Issue #1157）。 */
  temporaryRoot: string;
  prCreationResult: PullRequestCreationResult;
  prInspection: PullRequestInspection;
  prOverrides: Record<string, string>;
  requiredHeadings: readonly string[];
  protectionObservation: BranchProtectionObservation;
  reviewObservations: ApprovalObservation[];
  stubPath: string;
  trustedPolicy: Policy;
  withApproval: ReturnType<typeof authorizeMerge>;
  withoutApproval: ReturnType<typeof authorizeMerge>;
  declaredZero: ReturnType<typeof authorizeMerge>;
  declaredOne: ReturnType<typeof authorizeMerge>;
}

const { Given, When, Then } = stepDefinitions<DeliveryFinalizeWorld>();

interface GhStubWorld {
  temp(prefix?: string): string;
  ghLog: string;
  bodyFile: string;
  stubPath: string;
}

interface GhReadStubWorld {
  temp(prefix?: string): string;
  ghLog: string;
  stubPath: string;
}

const safeState = () => ({
  repository: "o/r",
  worktree: "/tmp/specific-worktree",
  branch: "feature/x",
  base: "main",
  headSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  dirty: false,
  untracked: [],
  stashes: [],
  temporaryArtifacts: [],
  ignoredArtifacts: [],
  pushed: true,
  remoteBranch: true,
  prMerged: true,
  specConsistent: true,
  testsPassed: true,
  reviewApproved: true,
  recoveryRef: "refs/agent-skill-chain/recovery/feature-x",
  recoveryReachable: true,
});

const safeDeliveryEvidence = () => {
  const headSha = "a".repeat(40);
  return {
    headSha,
    review: { approved: true, headSha },
    tests: { passed: true, headSha, scenarioIds: ["SCN-DELIVERY-001"] },
    spec: {
      consistent: true,
      headSha,
      impact: "updated",
      trace: {
        requirements: ["FR-01"],
        scenarios: ["SCN-DELIVERY-001"],
        tests: ["test/features/integration/delivery-finalize.feature"],
      },
    },
  };
};

const trustedDeliveryPolicy = (): Policy => ({
  schemaVersion: "agent-skill-chain/project-policy/v0.3.1",
  delivery: { stopAt: "pull_request" },
  merge: {
    mode: "disabled",
    branches: [],
    methods: [],
    requiredChecks: [],
    requiredReviews: 0,
  },
  budgets: { localFeedbackMs: 100, prGateMs: 1000 },
  rules: [
    {
      ruleId: "ASC-TRUST-TEST-001",
      purpose: "PRで自己緩和を防止する",
      riskClass: "authority",
      scope: ["pull_request"],
      enforcement: "deny",
      activation: "active",
      owner: "policy owner",
      targetLayer: "package",
      evidence: "trusted comparison",
      remediation: "trusted条件を維持する",
      overridePolicy: "never",
      rollback: "PRを作成しない",
    },
  ],
});
const trustedFinalizePolicy = (): Policy => ({
  ...trustedDeliveryPolicy(),
  rules: [
    {
      ruleId: "ASC-FINALIZE-TEST-001",
      purpose: "安全なworktreeだけを完了する",
      riskClass: "identity",
      scope: ["worktree"],
      enforcement: "deny",
      activation: "active",
      owner: "policy owner",
      targetLayer: "package",
      evidence: "finalize report",
      remediation: "状態を再確認する",
      overridePolicy: "never",
      rollback: "worktreeを保持する",
    },
  ],
});

function policyWithMerge(merge: Policy["merge"]): Policy {
  return { ...trustedDeliveryPolicy(), merge };
}

function independentReviewMergeInput(requiredReviews: number): MergeInput {
  return {
    trustedPolicy: policyWithMerge({
      mode: "automatic",
      branches: ["feature/*"],
      methods: ["merge"],
      requiredChecks: ["ci"],
      requiredReviews,
    }),
    method: "merge",
    checks: ["ci"],
    approvals: [],
    headSha: "a".repeat(40),
    prAuthorActorId: "author",
    implementationAuthorActorId: "implementer",
    branch: "feature/a",
    repositoryVerified: true,
    shaVerified: true,
    protectionVerified: true,
    mergeableVerified: true,
  };
}

Given("review、test、spec evidenceがすべてpassである", function () {
  this.evidence = safeDeliveryEvidence();
});
Given("PR単位のexternal writeが承認済みである", function () {
  this.authorization = "approved";
});
Given("{word} evidenceをfailにする", function (name: string) {
  if (name === "review") this.evidence.review.approved = false;
  else if (name === "tests") this.evidence.tests.passed = false;
  else this.evidence.spec.consistent = false;
});
Given("test evidenceのHEADだけが異なる", function () {
  this.evidence.tests.headSha = "b".repeat(40);
});
Given("spec evidenceからscenario traceを除く", function () {
  this.evidence.spec.trace.scenarios = [];
});
const BASE_PR_BODY = (): string =>
  conformingPullRequestBody({
    title: "bugfix: 824を是正する",
    canonicalIssue: 824,
  });

/** 見出し節を1件だけ取り除く。**節の本文ごと落とす。**見出し行だけ消すと本文が前節へ混ざる。 */
function withoutHeading(body: string, heading: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line === `## ${heading}`);
  if (start === -1) throw new Error(`見出しがありません: ${heading}`);
  const rest = lines.slice(start + 1);
  const offset = rest.findIndex((line) => line.startsWith("## "));
  const end = offset === -1 ? lines.length : start + 1 + offset;
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}

Given("PR本文から{string}の見出しを除く", function (heading: string) {
  this.prOverrides = { body: withoutHeading(BASE_PR_BODY(), heading) };
});

Given(
  "PR本文の{string}見出しを{string}へ置き換える",
  function (heading: string, substitute: string) {
    this.prOverrides = {
      body: BASE_PR_BODY().replace(`## ${heading}`, substitute),
    };
  },
);

Given("PR本文の{string}見出しをcode block内へ移す", function (heading: string) {
  this.prOverrides = {
    body: BASE_PR_BODY().replace(
      `## ${heading}`,
      ["```markdown", `## ${heading}`, "```"].join("\n"),
    ),
  };
});

Given("PR本文のIssue参照をcode spanで囲む", function () {
  this.prOverrides = {
    body: BASE_PR_BODY().replace("Closes #824", "`Closes #824`"),
  };
});

Given("PR本文へ未解決のplaceholderを残す", function () {
  this.prOverrides = {
    body: BASE_PR_BODY().replace("## 変更内容\n", "## 変更内容\n\n（内容）\n"),
  };
});

Given("PR本文へ条件付き見出しを加える", function () {
  this.prOverrides = {
    body: `${BASE_PR_BODY()}\n## 図表（理解を大きく助ける場合だけ）\n\nなし。\n`,
  };
});

Given("PR本文からIssue参照を除く", function () {
  this.prOverrides = {
    body: BASE_PR_BODY().replace("Closes #824", "対象を是正した。"),
  };
});

const CONDITIONAL_HEADING = /（[^）]*だけ）/u;

/** 配布templateの`## `見出しを原文のまま読む。**導出関数を経由しない。** */
function templateHeadings(): string[] {
  const template = fs.readFileSync(
    path.join(
      process.cwd(),
      ".agent-skill-chain/templates/issue/11_プルリクエスト本文.md",
    ),
    "utf8",
  );
  return [...template.matchAll(/^## (.+)$/gmu)].map((match) =>
    match[1]!.trim(),
  );
}

Given("PR本文templateに条件付き見出しがある", function () {
  assert.ok(
    templateHeadings().some((heading) => CONDITIONAL_HEADING.test(heading)),
    "templateに条件付き見出しがありません。この検査は前提を失っています",
  );
});

When("必須見出しを導出する", function () {
  this.requiredHeadings = pullRequestRequiredHeadings();
});

Then("必須見出しに条件付き見出しは含まれない", function () {
  const conditional = this.requiredHeadings.filter((heading) =>
    CONDITIONAL_HEADING.test(heading),
  );
  assert.deepEqual(
    conditional,
    [],
    `条件付き見出しを必須にしています: ${conditional.join(", ")}`,
  );
});

Then("必須見出しにtemplateの無条件見出しがすべて含まれる", function () {
  const required = this.requiredHeadings;
  for (const heading of templateHeadings())
    if (!CONDITIONAL_HEADING.test(heading))
      assert.ok(
        required.includes(heading),
        `無条件見出しが必須から漏れています: ${heading}`,
      );
});

Then("PR previewのtitleは{string}である", function (expected: string) {
  assert.equal(this.deliveryResult.preview?.title, expected);
});

Then("PR previewのbodyはH1見出しを含まない", function () {
  assert.ok(!/^#\s+\S/mu.test(this.deliveryResult.preview?.body ?? ""));
});

Then("PR previewのbodyは必須見出しをすべて含む", function () {
  const body = this.deliveryResult.preview?.body ?? "";
  for (const heading of pullRequestRequiredHeadings())
    assert.ok(body.includes(`## ${heading}`), `見出しがありません: ${heading}`);
  for (const keyword of [
    "close",
    "closes",
    "closed",
    "fix",
    "fixes",
    "fixed",
    "resolve",
    "resolves",
    "resolved",
  ])
    assert.deepEqual(extractIssueClosingNumbers(`${keyword}: #824`), [824]);
  assert.deepEqual(extractIssueClosingNumbers("FIXES #824"), [824]);
  assert.equal(
    validateIssueClosingReferences("Fixes #824\nResolved: #824", {
      canonicalIssue: 824,
      relatedIssues: [],
    }).valid,
    false,
  );
});

Given(
  "PR inputの{word}を{string}にする",
  function (field: string, value: string) {
    this.prOverrides = { [field]: value };
  },
);
When("PR createをdry-runする", function () {
  this.deliveryResult = createPullRequest(
    {
      apply: false,
      evidence: this.evidence,
      headSha: this.evidence.headSha,
      issue: 824,
      head: "feature",
      base: "main",
      repository: "o/r",
      body: conformingPullRequestBody({
        title: "bugfix: 824を是正する",
        canonicalIssue: 824,
      }),
      ...this.prOverrides,
    },
    () => {
      this.calls.push("unexpected");
      return { url: "https://example.invalid/unexpected" };
    },
  );
});
When("PR createをapplyする", function () {
  try {
    this.deliveryResult = createPullRequest(
      {
        apply: true,
        authorization: this.authorization,
        evidence: this.evidence,
        headSha: this.evidence.headSha,
        issue: 824,
        head: "feature",
        base: "main",
        baseSha: "b".repeat(40),
        repository: "o/r",
        body: conformingPullRequestBody({
          title: "bugfix: 824を是正する",
          canonicalIssue: 824,
        }),
        ...(this.omitTrustedPolicy
          ? { trustedPolicy: undefined }
          : {
              trustedPolicy: trustedDeliveryPolicy(),
              packageFloor: trustedDeliveryPolicy(),
            }),
      },
      (operation) => {
        this.calls.push(operation);
        return { url: "https://example.invalid/pr/1" };
      },
    );
  } catch (error) {
    this.error = error;
  }
});
When("PR createをdry-runして失敗を確認する", function () {
  try {
    createPullRequest(
      {
        apply: false,
        evidence: this.evidence,
        headSha: this.evidence.headSha,
        issue: 824,
        head: "feature",
        base: "main",
        repository: "o/r",
        body: conformingPullRequestBody({
          title: "bugfix: 824を是正する",
          canonicalIssue: 824,
        }),
        ...this.prOverrides,
      },
      () => {
        this.calls.push("unexpected");
        return { url: "https://example.invalid/unexpected" };
      },
    );
  } catch (error) {
    this.error = error;
  }
});
Then("delivery stateはpreviewである", function () {
  assert.equal(this.deliveryResult.state, "preview");
  assert.equal(
    this.deliveryResult.preview?.authorityStatus,
    "unverified-preview",
  );
});
Then("delivery stateはwaiting_for_human_reviewである", function () {
  assert.equal(this.deliveryResult.state, "waiting_for_human_review");
});
Then("external operation callは0件である", function () {
  assert.equal(this.calls.length, 0);
});
Then("external operationは{string}だけである", function (operation: string) {
  assert.deepEqual(this.calls, [operation]);
});
Then("PR createは失敗する", function () {
  assert.ok(this.error instanceof Error);
});
Given("trusted policyをPR inputから除く", function () {
  this.omitTrustedPolicy = true;
});

function prepareGhStub(
  world: GhStubWorld,
  matchingBody: boolean,
  permission = "WRITE",
) {
  const directory = world.temp("asc-gh-adapter-");
  world.ghLog = path.join(directory, "operations.log");
  world.bodyFile = path.join(directory, "body.md");
  fs.writeFileSync(world.bodyFile, "# 同期本文\n");
  const stub = path.join(directory, "gh");
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env node\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(world.ghLog)},args.join(' ')+'\\n');if(args[0]==='repo')process.stdout.write(JSON.stringify({nameWithOwner:'o/r',viewerPermission:${JSON.stringify(permission)}}));if(args[0]==='issue'&&args[1]==='view')process.stdout.write(${JSON.stringify(matchingBody ? "# 同期本文\n" : "# 不一致\n")});\n`,
  );
  fs.chmodSync(stub, 0o755);
  world.stubPath = `${directory}${path.delimiter}${process.env.PATH ?? ""}`;
}

Given("exact repositoryと同じbodyを返すgh stubがある", function () {
  prepareGhStub(this, true);
});
Given("exact repositoryだが異なるbodyを返すgh stubがある", function () {
  prepareGhStub(this, false);
});
Given("read権限だけを返すgh stubがある", function () {
  prepareGhStub(this, true, "READ");
});
When("Issue sync adapterを実行する", function () {
  const original = process.env.PATH;
  process.env.PATH = this.stubPath;
  try {
    this.issueSyncResult = github(
      "issue.sync",
      { repository: "o/r", issue: 824, bodyFile: this.bodyFile },
      process.cwd(),
    );
  } catch (error) {
    this.error = error;
  } finally {
    process.env.PATH = original;
  }
});
When("Issue read adapterを実行する", function () {
  const original = process.env.PATH;
  process.env.PATH = this.stubPath;
  try {
    this.issueReadResult = github(
      "issue.read",
      { repository: "o/r", issue: 824 },
      process.cwd(),
    );
  } catch (error) {
    this.error = error;
  } finally {
    process.env.PATH = original;
  }
});

Then("Issue readは本文とsha256を返す", function () {
  assert.equal(this.issueReadResult.repository, "o/r");
  assert.equal(this.issueReadResult.issue, 824);
  assert.equal(this.issueReadResult.body, "# 同期本文\n");
  assert.equal(
    this.issueReadResult.bodySha256,
    crypto
      .createHash("sha256")
      .update(this.issueReadResult.body, "utf8")
      .digest("hex"),
  );
});

Then(
  "gh操作順にauth、repo確認、read-onlyのissue viewだけが含まれる",
  function () {
    const lines = fs.readFileSync(this.ghLog, "utf8").trim().split("\n");
    assert.deepEqual(
      lines.map((line) => line.split(" ").slice(0, 2).join(" ")),
      ["auth status", "repo view", "issue view"],
    );
    assert.equal(
      lines.some((line) => line.startsWith("issue edit")),
      false,
      `Issue readが書き込みを行っています: ${lines.join(" | ")}`,
    );
  },
);

Then("Issue readは成功する", function () {
  assert.equal(this.error, undefined);
  assert.equal(this.issueReadResult.body, "# 同期本文\n");
});

Then("Issue syncは成功する", function () {
  assert.equal(this.issueSyncResult.url, "https://github.com/o/r/issues/824");
});
Then("gh操作順にauth、repo確認、edit、read-backが含まれる", function () {
  const lines = fs.readFileSync(this.ghLog, "utf8").trim().split("\n");
  assert.deepEqual(
    lines.map((line) => line.split(" ").slice(0, 2).join(" ")),
    ["auth status", "repo view", "issue edit", "issue view"],
  );
});
Then("Issue syncは失敗する", function () {
  assert.ok(this.error instanceof Error);
});
Then("errorにwrite権限不足が含まれる", function () {
  assert.ok(this.error instanceof Error);
  assert.match(this.error.message, /書き込み権限/);
});
Then("Issue edit操作は呼ばれない", function () {
  assert.equal(
    fs.readFileSync(this.ghLog, "utf8").includes("issue edit"),
    false,
  );
});

function prepareGhReadStub(
  world: GhReadStubWorld,
  operation: "pr" | "protection" | "reviews",
) {
  const directory = world.temp("asc-gh-read-");
  world.ghLog = path.join(directory, "operations.log");
  const stub = path.join(directory, "gh");
  const payload =
    operation === "pr"
      ? JSON.stringify({
          number: 1,
          url: "https://github.com/o/r/pull/1",
          headRefName: "feature/x",
          baseRefName: "main",
          headRefOid: "a".repeat(40),
          baseRefOid: "b".repeat(40),
          statusCheckRollup: [],
          closingIssuesReferences: [
            { number: 877, url: "https://github.com/o/r/issues/877" },
          ],
        })
      : operation === "reviews"
        ? JSON.stringify([
            Array.from({ length: 31 }, (_, index) => ({
              id: index + 1,
              state: "APPROVED",
              commit_id: "a".repeat(40),
              user: { node_id: `reviewer-${index}` },
              submitted_at: `2026-08-23T12:00:${String(index).padStart(2, "0")}Z`,
            })),
            [
              {
                id: 32,
                state: "CHANGES_REQUESTED",
                commit_id: "a".repeat(40),
                user: { node_id: "reviewer-0" },
                submitted_at: "2026-08-23T13:00:00Z",
              },
            ],
          ])
        : JSON.stringify({ required_status_checks: null });
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env node\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(world.ghLog)},args.join(' ')+'\\n');if(args[0]==='repo')process.stdout.write(JSON.stringify({nameWithOwner:'o/r',viewerPermission:'READ'}));if(args[0]==='pr')process.stdout.write(${JSON.stringify(payload)});if(args[0]==='api')process.stdout.write(${JSON.stringify(payload)});\n`,
  );
  fs.chmodSync(stub, 0o755);
  world.stubPath = `${directory}${path.delimiter}${process.env.PATH ?? ""}`;
}

Given("PR状態を返すexact repositoryのgh stubがある", function () {
  prepareGhReadStub(this, "pr");
});
Given("branch protectionを返すexact repositoryのgh stubがある", function () {
  prepareGhReadStub(this, "protection");
});

function prepareGhProtectionFallbackStub(
  world: GhReadStubWorld,
  outcome: "protected" | "unprotected" | "deletion-only" | "unknown",
) {
  const directory = world.temp("asc-gh-protection-fallback-");
  world.ghLog = path.join(directory, "operations.log");
  const stub = path.join(directory, "gh");
  const rulesPayload =
    outcome === "protected"
      ? [[{ type: "pull_request", source_type: "Repository" }]]
      : outcome === "deletion-only"
        ? [[{ type: "deletion", source_type: "Repository" }]]
        : [[]];
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env node\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(world.ghLog)},args.join(' ')+'\\n');const endpoint=args.find((arg)=>arg.startsWith('repos/'));if(args[0]==='repo')process.stdout.write(JSON.stringify({nameWithOwner:'o/r',viewerPermission:'READ'}));if(endpoint==='repos/o/r/branches/main/protection'){process.stderr.write('gh: Branch not protected (HTTP 404)\\n');process.exitCode=1;}if(endpoint==='repos/o/r/rules/branches/main?per_page=100'){${outcome === "unknown" ? "process.stderr.write('gh: rules API unavailable (HTTP 503)\\n');process.exitCode=1;" : `process.stdout.write(${JSON.stringify(JSON.stringify(rulesPayload))});`}}\n`,
  );
  fs.chmodSync(stub, 0o755);
  world.stubPath = `${directory}${path.delimiter}${process.env.PATH ?? ""}`;
}

Given("classic protectionが404で有効なrulesetを返すgh stubがある", function () {
  prepareGhProtectionFallbackStub(this, "protected");
});
Given("classic protectionが404で空なrulesetを返すgh stubがある", function () {
  prepareGhProtectionFallbackStub(this, "unprotected");
});
Given("classic protectionが404でrules APIが失敗するgh stubがある", function () {
  prepareGhProtectionFallbackStub(this, "unknown");
});
Given(
  "classic protectionが404でdeletionだけのrulesetを返すgh stubがある",
  function () {
    prepareGhProtectionFallbackStub(this, "deletion-only");
  },
);
Given("複数pageのreviewを返すexact repositoryのgh stubがある", function () {
  prepareGhReadStub(this, "reviews");
});
Given("commit OID検証用のgh stubがある", function () {
  const directory = this.temp("asc-gh-commit-");
  const stub = path.join(directory, "gh");
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env node\nconst args=process.argv.slice(2);if(args[0]==='repo')process.stdout.write(JSON.stringify({nameWithOwner:'o/r',viewerPermission:'READ'}));if(args[0]==='api'){const oid=args[1].split('/').at(-1);const sha=oid===${JSON.stringify("a".repeat(40))}?${JSON.stringify("b".repeat(40))}:oid;process.stdout.write(JSON.stringify({sha,author:{node_id:'actor'}}));}\n`,
  );
  fs.chmodSync(stub, 0o755);
  this.stubPath = `${directory}${path.delimiter}${process.env.PATH ?? ""}`;
});
When("短縮OIDと応答不一致と完全一致をcommit inspectへ渡す", function () {
  const original = process.env.PATH;
  process.env.PATH = this.stubPath;
  this.commitResults = [];
  try {
    for (const sha of ["abc123", "a".repeat(40), "c".repeat(40)]) {
      try {
        this.commitResults.push(
          github("commit.inspect", { repository: "o/r", sha }, process.cwd()),
        );
      } catch (error) {
        this.commitResults.push(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  } finally {
    process.env.PATH = original;
  }
});
Then("完全一致だけがcommit観測に成功する", function () {
  assert.ok(this.commitResults[0] instanceof Error);
  assert.ok(this.commitResults[1] instanceof Error);
  assert.deepEqual(this.commitResults[2], {
    sha: "c".repeat(40),
    authorActorId: "actor",
  });
});
Given("merge操作を記録するwrite権限のgh stubがある", function () {
  const directory = this.temp("asc-gh-merge-");
  this.ghLog = path.join(directory, "operations.log");
  const stub = path.join(directory, "gh");
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env node\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(this.ghLog)},args.join(' ')+'\\n');if(args[0]==='repo')process.stdout.write(JSON.stringify({nameWithOwner:'o/r',viewerPermission:'WRITE'}));\n`,
  );
  fs.chmodSync(stub, 0o755);
  this.stubPath = `${directory}${path.delimiter}${process.env.PATH ?? ""}`;
});
When("再認可済みHEADを指定してPR merge adapterを実行する", function () {
  const original = process.env.PATH;
  process.env.PATH = this.stubPath;
  try {
    this.mergeOperationResult = github(
      "pr.merge",
      {
        repository: "o/r",
        pr: 9,
        method: "squash",
        headSha: "a".repeat(40),
      },
      process.cwd(),
    );
  } finally {
    process.env.PATH = original;
  }
});
When("未知のmerge方式を指定してPR merge adapterを実行する", function () {
  const original = process.env.PATH;
  process.env.PATH = this.stubPath;
  try {
    github(
      "pr.merge",
      {
        repository: "o/r",
        pr: 9,
        /**
         * **型が塞いでいる値を実行時に渡す。**
         *
         * `method`の型は3値へ絞られているためTS呼び出し元からは未知値が入らない。
         * 実行時の防御はJSON入力とJS呼び出し元のためにあり、その経路を再現する。
         */
        method: "fast-forward" as "merge",
        headSha: "a".repeat(40),
      },
      process.cwd(),
    );
    this.mergeMethodError = undefined;
  } catch (error) {
    this.mergeMethodError =
      error instanceof Error ? error.message : String(error);
  } finally {
    process.env.PATH = original;
  }
});

Then("PR merge adapterは方式を解決できず例外になりghを呼ばない", function () {
  assert.match(
    String(this.mergeMethodError),
    /merge方式を解決できません: fast-forward/u,
    "未知のmerge方式が例外にならず既定値で実行されています",
  );
  const log = fs.existsSync(this.ghLog)
    ? fs.readFileSync(this.ghLog, "utf8")
    : "";
  assert.equal(
    log.includes("pr merge"),
    false,
    `例外の前にghのpr mergeを呼んでいます: ${log}`,
  );
});

Then("merge操作はmatch-head-commitで同じHEADへ拘束される", function () {
  assert.equal(
    this.mergeOperationResult.state,
    "merge_or_native_auto_merge_requested",
  );
  const operations = fs.readFileSync(this.ghLog, "utf8").trim().split("\n");
  assert.equal(
    operations.some(
      (line) =>
        line ===
        `pr merge 9 --repo o/r --squash --auto --match-head-commit ${"a".repeat(40)}`,
    ),
    true,
  );
});
When("PR inspect adapterを実行する", function () {
  const original = process.env.PATH;
  process.env.PATH = this.stubPath;
  try {
    this.prInspection = github(
      "pr.inspect",
      { repository: "o/r", pr: 1 },
      process.cwd(),
    );
  } finally {
    process.env.PATH = original;
  }
});
When("branch protection adapterを実行する", function () {
  const original = process.env.PATH;
  process.env.PATH = this.stubPath;
  try {
    this.protectionObservation = github(
      "branch.protection",
      { repository: "o/r", branch: "main" },
      process.cwd(),
    );
  } finally {
    process.env.PATH = original;
  }
});
When("PR reviews adapterを実行する", function () {
  const original = process.env.PATH;
  process.env.PATH = this.stubPath;
  try {
    this.reviewObservations = github(
      "pr.reviews",
      { repository: "o/r", pr: 1 },
      process.cwd(),
    );
  } finally {
    process.env.PATH = original;
  }
});
Then("PR状態を取得できる", function () {
  assert.equal(this.prInspection.headRefName, "feature/x");
  assert.deepEqual(this.prInspection.closingIssuesReferences, [
    { number: 877, url: "https://github.com/o/r/issues/877" },
  ]);
});
Then("branch protection状態を取得できる", function () {
  assert.equal(this.protectionObservation.known, true);
  assert.equal(this.protectionObservation.protected, true);
});
Then("branch protectionはrulesetによりprotectedと判定される", function () {
  assert.deepEqual(this.protectionObservation, {
    known: true,
    protected: true,
    value: {
      source: "ruleset",
      rules: [{ type: "pull_request", source_type: "Repository" }],
    },
  });
});
Then("branch protectionはknownかつunprotectedである", function () {
  assert.deepEqual(this.protectionObservation, {
    known: true,
    protected: false,
    value: { source: "ruleset" },
  });
});
Then("deletionだけのrulesetはknownかつunprotectedである", function () {
  assert.deepEqual(this.protectionObservation, {
    known: true,
    protected: false,
    value: {
      source: "ruleset",
      rules: [{ type: "deletion", source_type: "Repository" }],
    },
  });
});
Then("branch protectionはrules API失敗をunknownにする", function () {
  assert.equal(this.protectionObservation.known, false);
  assert.equal(this.protectionObservation.protected, false);
  assert.match(
    this.protectionObservation.error ?? "",
    /rules API unavailable/u,
  );
});
Then("classic protection後にrulesetを確認する", function () {
  const operations = fs.readFileSync(this.ghLog, "utf8").trim().split("\n");
  const classic = operations.indexOf("api repos/o/r/branches/main/protection");
  const ruleset = operations.indexOf(
    "api --paginate --slurp repos/o/r/rules/branches/main?per_page=100",
  );
  assert.ok(classic >= 0, "classic protection観測がありません");
  assert.ok(
    ruleset > classic,
    "ruleset観測がclassic protection後ではありません",
  );
});
Then("全pageのreviewと順序根拠を取得できる", function () {
  assert.equal(this.reviewObservations.length, 32);
  assert.deepEqual(this.reviewObservations.at(-1), {
    state: "CHANGES_REQUESTED",
    commitSha: "a".repeat(40),
    actorId: "reviewer-0",
    submittedAt: "2026-08-23T13:00:00Z",
    reviewId: "32",
  });
  const log = fs.readFileSync(this.ghLog, "utf8");
  assert.match(
    log,
    /api --paginate --slurp repos\/o\/r\/pulls\/1\/reviews\?per_page=100/u,
  );
});
Then("PR読取前にauthとrepository確認が行われる", function () {
  const operations = fs
    .readFileSync(this.ghLog, "utf8")
    .trim()
    .split("\n")
    .map((line) => line.split(" ").slice(0, 2).join(" "));
  assert.deepEqual(operations, ["auth status", "repo view", "pr view"]);
});
Then("protection読取前にauthとrepository確認が行われる", function () {
  const operations = fs
    .readFileSync(this.ghLog, "utf8")
    .trim()
    .split("\n")
    .map((line) => line.split(" ").slice(0, 2).join(" "));
  assert.deepEqual(operations, [
    "auth status",
    "repo view",
    "api repos/o/r/branches/main/protection",
  ]);
});

/** `matchingBase` reproduces a base-branch OID change between preflight and PR read-back. */
/**
 * `pr view`が返すclosing索引の観測列（Issue #1271）。
 *
 * **実PRの本文は作成前に「canonical Issueを1件だけcloseする」ことが
 * 検証されている。** したがって空配列は索引の未反映であり、「1件もcloseしない」
 * という確定判定ではない。列を与えて停止条件を1つずつ検査する。
 */
type CreateStubClosing =
  | "canonical"
  | "empty-then-canonical"
  | "always-empty"
  | "missing"
  | "wrong-issue"
  | "mismatch-then-canonical"
  | "view-fails";

const CANONICAL_CLOSING = [
  { number: 824, url: "https://github.com/o/r/issues/824" },
];

function prepareGhCreateStub(
  world: GhReadStubWorld,
  matchingHead: boolean,
  matchingBase = true,
  closing: CreateStubClosing = "canonical",
) {
  const directory = world.temp("asc-gh-create-");
  world.ghLog = path.join(directory, "operations.log");
  const stub = path.join(directory, "gh");
  const expected = "a".repeat(40);
  const observed = matchingHead ? expected : "b".repeat(40);
  const base = "c".repeat(40);
  const observedBase = matchingBase ? base : "d".repeat(40);
  const view = (
    override: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    number: 9,
    url: "https://github.com/o/r/pull/9",
    title: "bugfix: 対象を是正する",
    body: "Relates to #824",
    headRefName: "feature/x",
    baseRefName: "main",
    headRefOid: expected,
    baseRefOid: observedBase,
    headRepository: { nameWithOwner: "o/r" },
    isCrossRepository: false,
    closingIssuesReferences: CANONICAL_CLOSING,
    ...override,
  });
  /**
   * **観測列は呼び出し回数で切り替える。** stubは呼び出しごとに別processで
   * 起動するため、回数はfileへ数える。
   */
  const sequence: Record<CreateStubClosing, Record<string, unknown>[]> = {
    canonical: [view()],
    "empty-then-canonical": [view({ closingIssuesReferences: [] }), view()],
    "always-empty": [view({ closingIssuesReferences: [] })],
    missing: [view({ closingIssuesReferences: undefined })],
    "wrong-issue": [
      view({
        closingIssuesReferences: [
          { number: 999, url: "https://github.com/o/r/issues/999" },
        ],
      }),
    ],
    "mismatch-then-canonical": [view({ title: "別のtitle" }), view()],
    /** 読み戻し自体が失敗する。**未確定ではなく異常であり待たない。** */
    "view-fails": [],
  };
  const payloads = JSON.stringify(
    sequence[closing].map((value) => JSON.stringify(value)),
  );
  const viewFails = closing === "view-fails";
  const counter = path.join(directory, "view-count");
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env node\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(world.ghLog)},args.join(' ')+'\\n');if(args[0]==='repo')process.stdout.write(JSON.stringify({nameWithOwner:'o/r',viewerPermission:'WRITE'}));if(args[0]==='api')process.stdout.write((args[1].includes('feature%2Fx')?${JSON.stringify(observed)}:${JSON.stringify(base)})+'\\n');if(args[0]==='pr'&&args[1]==='create')process.stdout.write('https://github.com/o/r/pull/9\\n');if(args[0]==='pr'&&args[1]==='view'){${viewFails ? "process.stderr.write('gh: could not read PR\\n');process.exit(1);" : `const p=${payloads};let n=0;try{n=Number(fs.readFileSync(${JSON.stringify(counter)},'utf8'))}catch{}fs.writeFileSync(${JSON.stringify(counter)},String(n+1));process.stdout.write(p[Math.min(n,p.length-1)]);`}}\n`,
  );
  fs.chmodSync(stub, 0o755);
  world.stubPath = `${directory}${path.delimiter}${process.env.PATH ?? ""}`;
}

Given("一致するremote HEADとPR状態を返すgh stubがある", function () {
  prepareGhCreateStub(this, true);
});
Given("異なるremote HEADを返すgh stubがある", function () {
  prepareGhCreateStub(this, false);
});
Given("作成中にremote base OIDが変更されるgh stubがある", function () {
  prepareGhCreateStub(this, true, false);
});
Given(
  "PR作成後の読み戻しが1回目に空のclosing索引を返すstubがある",
  function () {
    prepareGhCreateStub(this, true, true, "empty-then-canonical");
  },
);
Given("PR作成後の読み戻しが常に空のclosing索引を返すstubがある", function () {
  prepareGhCreateStub(this, true, true, "always-empty");
});
Given("読み戻しの1回目がidentity不一致で2回目が正常なstubがある", function () {
  prepareGhCreateStub(this, true, true, "mismatch-then-canonical");
});
Given("読み戻しがclosing索引を欠く観測を返すstubがある", function () {
  prepareGhCreateStub(this, true, true, "missing");
});
Given("読み戻しが対象外Issueをcloseする観測を返すstubがある", function () {
  prepareGhCreateStub(this, true, true, "wrong-issue");
});
Given("索引が未確定な観測列を2回流す準備がある", function () {
  /** stubはWhenの中で毎回作り直す。**counterを共有すると2回目が待たない。** */
  prepareGhCreateStub(this, true, true, "empty-then-canonical");
});
Given("読み戻し自体が失敗するstubがある", function () {
  prepareGhCreateStub(this, true, true, "view-fails");
});

/**
 * **認証観測の失敗を実際に起こす**（Issue #1157）。`gh auth status` は
 * `pr.create` の第1文で呼ばれる。ここで落ちた時点でproviderへ変更要求を
 * 送っていないため、dispatch claimを消費してはならない。
 */
Given("認証観測に失敗するgh stubがある", function () {
  const directory = this.temp("asc-gh-authfail-");
  const stub = path.join(directory, "gh");
  this.ghLog = path.join(directory, "gh.log");
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env node\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(
      "GHLOG",
    )},args.join(' ')+'\\n');if(args[0]==='auth'){process.stderr.write('timeout');process.exit(1);}\n`.replace(
      JSON.stringify("GHLOG"),
      JSON.stringify(this.ghLog),
    ),
  );
  fs.chmodSync(stub, 0o755);
  this.stubPath = `${directory}${path.delimiter}${process.env.PATH ?? ""}`;
});
Then("dispatch claimを消費していない", function () {
  assert.equal(
    this.dispatchClaimed,
    false,
    "provider要求を送っていないのにdispatch claimを消費しています",
  );
});

When("dispatch claimを渡さずPR create adapterを実行する", function () {
  const original = process.env.PATH;
  process.env.PATH = this.stubPath;
  /**
   * **一時領域の残留を観測する**（Issue #1157）。adapterはPR本文を
   * `os.tmpdir()`直下の`asc-pr-body-*`へ書く。**gateが`try`の外にあると、
   * 拒否したときに本文入りの一時領域が残る。** `os.tmpdir()`は呼び出しごとに
   * 環境変数を読むため、専用のtmpへ差し替えて観測できる。
   */
  this.temporaryRoot = this.temp("asc-pr-tmp-");
  const originalTmp = process.env.TMPDIR;
  process.env.TMPDIR = this.temporaryRoot;
  this.dispatchClaimed = false;
  try {
    /**
     * **型で必須にしていても実行時の経路が残る。** 呼び出し側がcastで
     * 省略できるため、実装側のfail-closedを直接測る。
     */
    (
      github as unknown as (
        operation: string,
        input: Record<string, unknown>,
        cwd: string,
      ) => unknown
    )(
      "pr.create",
      {
        repository: "o/r",
        issue: 824,
        head: "feature/x",
        headSha: "a".repeat(40),
        base: "main",
        baseSha: "c".repeat(40),
        title: "bugfix: 対象を是正する",
        body: "Relates to #824",
      },
      process.cwd(),
    );
  } catch (error) {
    this.error = error;
  } finally {
    process.env.PATH = original;
    if (originalTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTmp;
  }
});

Then("PR本文の一時領域が残っていない", function () {
  const leftovers = fs
    .readdirSync(this.temporaryRoot)
    .filter((entry) => entry.startsWith("asc-pr-body-"));
  assert.deepEqual(
    leftovers,
    [],
    `PR本文を含む一時領域が残っています: ${leftovers.join("、")}`,
  );
});

When("PR create adapterを実行する", function () {
  const original = process.env.PATH;
  process.env.PATH = this.stubPath;
  /**
   * **dispatch claimの消費時点を観測する**（Issue #1157）。claimはprovider要求の
   * 直前でだけ消費されるべきで、認証や再検証で落ちた場合は消費されない。
   */
  this.dispatchClaimed = false;
  try {
    this.prCreationResult = github(
      "pr.create",
      {
        repository: "o/r",
        issue: 824,
        head: "feature/x",
        headSha: "a".repeat(40),
        base: "main",
        baseSha: "c".repeat(40),
        title: "bugfix: 対象を是正する",
        body: "Relates to #824",
        onDispatch: () => {
          this.dispatchClaimed = true;
          return true;
        },
      },
      process.cwd(),
    );
  } catch (error) {
    this.error = error;
  } finally {
    process.env.PATH = original;
  }
});
/**
 * **上限を引数で注入する**（Issue #1271）。testが実時間を待たないためであり、
 * 既定値を弱めるためではない。既定値は`DEFAULT_READ_BACK_SETTLE`が持つ。
 */
When("settle上限を絞ってPR create adapterを実行する", function () {
  const original = process.env.PATH;
  process.env.PATH = this.stubPath;
  this.dispatchClaimed = false;
  try {
    this.prCreationResult = github(
      "pr.create",
      {
        repository: "o/r",
        issue: 824,
        head: "feature/x",
        headSha: "a".repeat(40),
        base: "main",
        baseSha: "c".repeat(40),
        title: "bugfix: 対象を是正する",
        body: "Relates to #824",
        readBackSettle: { maxAttempts: 3, delaysMs: [0], maxElapsedMs: 1000 },
        onDispatch: () => {
          this.dispatchClaimed = true;
          return true;
        },
      },
      process.cwd(),
    );
  } catch (error) {
    this.error = error;
  } finally {
    process.env.PATH = original;
  }
});

function ghOperationCounts(log: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of fs.readFileSync(log, "utf8").trim().split("\n")) {
    const key = line.split(" ").slice(0, 2).join(" ");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * **待機の実在は差分でしか測れない**（Issue #1271）。
 *
 * 読み戻しは`gh`のsubprocessを起動するため、待機を全く行わなくても経過は
 * 数十から数百msになる。**下限を1回測るだけでは、待機を落とす変異が
 * subprocess起動コストに隠れて生存する**（変異試験で実測）。同じ観測列を
 * 待機0と待機Nで2回流し、**差が待機に由来することを測る。**
 *
 * **判定の余裕は雑音より大きく取る。** 差分300msでは、他scenarioの負荷で
 * 待機なしの2回目が偶然遅くなったときに変異が生き延びた（実測）。
 * 注入する待機を1000msとし、その6割を下限にする。
 */
When(
  "待機0と待機 {int} ミリ秒のsettleを続けて実行する",
  function (delay: number) {
    const original = process.env.PATH;
    const measure = (delayMs: number): number => {
      prepareGhCreateStub(this, true, true, "empty-then-canonical");
      process.env.PATH = this.stubPath;
      const startedAt = process.hrtime.bigint();
      this.prCreationResult = github(
        "pr.create",
        {
          repository: "o/r",
          issue: 824,
          head: "feature/x",
          headSha: "a".repeat(40),
          base: "main",
          baseSha: "c".repeat(40),
          title: "bugfix: 対象を是正する",
          body: "Relates to #824",
          readBackSettle: {
            maxAttempts: 100,
            delaysMs: [delayMs],
            maxElapsedMs: 60000,
          },
          onDispatch: () => true,
        },
        process.cwd(),
      );
      return Number((process.hrtime.bigint() - startedAt) / 1000000n);
    };
    try {
      /**
       * **cold startを測定へ入れない。** 1回目はmodule読込とprocess起動の
       * 初期費用を含み、待機なしでも数百msかかる。**warm-upを捨ててから
       * 2回を比べる。** これを省くと、待機を落とす変異が偶然生き延びる。
       */
      measure(0);
      const withoutDelay = measure(0);
      const withDelay = measure(delay);
      this.settleElapsedMs = withDelay - withoutDelay;
    } catch (error) {
      this.error = error;
    } finally {
      process.env.PATH = original;
    }
  },
);

Then("待機由来の経過差は {int} ミリ秒以上である", function (least: number) {
  assert.ok(
    this.settleElapsedMs >= least,
    `待機していないか短縮されています: 差分 ${this.settleElapsedMs}ms < ${least}ms`,
  );
});

/**
 * **経過時間の上限だけで止まることを測る**（Issue #1271）。
 *
 * 回数上限を事実上無効な大きさにし、経過時間の上限だけが停止条件になる形を作る。
 * **片方の上限を落とす変異は、両方が効いている条件では検出できない。**
 */
When(
  "経過時間の上限だけで止まるsettleでPR create adapterを実行する",
  function () {
    const original = process.env.PATH;
    process.env.PATH = this.stubPath;
    this.dispatchClaimed = false;
    try {
      this.prCreationResult = github(
        "pr.create",
        {
          repository: "o/r",
          issue: 824,
          head: "feature/x",
          headSha: "a".repeat(40),
          base: "main",
          baseSha: "c".repeat(40),
          title: "bugfix: 対象を是正する",
          body: "Relates to #824",
          readBackSettle: {
            maxAttempts: 100,
            delaysMs: [10],
            maxElapsedMs: 1000,
          },
          onDispatch: () => {
            this.dispatchClaimed = true;
            return true;
          },
        },
        process.cwd(),
      );
    } catch (error) {
      this.error = error;
    } finally {
      process.env.PATH = original;
    }
  },
);

Then(
  "読み戻し回数は回数上限より少ない {int} 回以下である",
  function (most: number) {
    const views = ghOperationCounts(this.ghLog).get("pr view") ?? 0;
    assert.ok(views <= most, `経過時間の上限で停止していません: ${views}回`);
    assert.ok(views >= 2, `反復していません: ${views}回`);
  },
);

Then(
  "読み戻し回数は {int} 回でcanonical Issueをcloseする観測が返る",
  function (times: number) {
    assert.equal(this.prCreationResult.state, "created");
    assert.deepEqual(
      this.prCreationResult.observation?.closingIssuesReferences,
      [{ number: 824, url: "https://github.com/o/r/issues/824" }],
      "確定した観測が返っていません",
    );
    assert.equal(
      ghOperationCounts(this.ghLog).get("pr view") ?? 0,
      times,
      "読み戻し回数が想定と違います",
    );
  },
);

Then(
  "読み戻し回数は {int} 回で空のclosing索引がそのまま返る",
  function (times: number) {
    assert.equal(this.prCreationResult.state, "created");
    assert.deepEqual(
      this.prCreationResult.observation?.closingIssuesReferences,
      [],
      "空を成功側の値へ書き換えています",
    );
    assert.equal(ghOperationCounts(this.ghLog).get("pr view") ?? 0, times);
  },
);

Then("PR create操作は1回だけ呼ばれる", function () {
  assert.equal(
    ghOperationCounts(this.ghLog).get("pr create") ?? 0,
    1,
    "読み戻しの反復がprovider createを再送しています",
  );
});

Then("読み戻し回数は {int} 回でrollback要求が返る", function (times: number) {
  assert.equal(this.prCreationResult.state, "rollback_required");
  assert.equal(
    ghOperationCounts(this.ghLog).get("pr view") ?? 0,
    times,
    "identity不一致を待ってしまっています",
  );
});

Then(
  "読み戻し回数は {int} 回でclosing索引を欠く観測がそのまま返る",
  function (times: number) {
    assert.equal(this.prCreationResult.state, "created");
    assert.equal(
      this.prCreationResult.observation?.closingIssuesReferences,
      undefined,
      "配列でない観測を書き換えています",
    );
    assert.equal(ghOperationCounts(this.ghLog).get("pr view") ?? 0, times);
  },
);

Then(
  "読み戻し回数は {int} 回で対象外Issueの観測がそのまま返る",
  function (times: number) {
    assert.equal(this.prCreationResult.state, "created");
    assert.deepEqual(
      this.prCreationResult.observation?.closingIssuesReferences,
      [{ number: 999, url: "https://github.com/o/r/issues/999" }],
      "非空だが不一致な観測を待つか書き換えています",
    );
    assert.equal(ghOperationCounts(this.ghLog).get("pr view") ?? 0, times);
  },
);

Then("PR create adapterは成功する", function () {
  assert.equal(this.prCreationResult.url, "https://github.com/o/r/pull/9");
});
Then("PR create adapterは失敗する", function () {
  assert.ok(this.error instanceof Error);
});
Then("PR create adapterはrollback要求を返す", function () {
  assert.equal(this.prCreationResult.state, "rollback_required");
  if (this.prCreationResult.state !== "rollback_required")
    throw new Error("rollback_requiredではありません");
  assert.match(this.prCreationResult.reason, /作成済みPR/u);
});
Then("作成済みPRのURLを失わない", function () {
  assert.equal(this.prCreationResult.url, "https://github.com/o/r/pull/9");
});
Then(
  "PR作成順にauth、repository、remote HEAD、create、read-backが含まれる",
  function () {
    const operations = fs
      .readFileSync(this.ghLog, "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split(" ").slice(0, 2).join(" "));
    assert.deepEqual(operations, [
      "auth status",
      "repo view",
      "api repos/o/r/commits/feature%2Fx",
      "api repos/o/r/commits/main",
      "pr create",
      "pr view",
    ]);
  },
);
Then("PR create操作は呼ばれない", function () {
  const operations = fs.readFileSync(this.ghLog, "utf8").trim().split("\n");
  assert.equal(
    operations.some((line) => line.startsWith("pr create")),
    false,
  );
});

Given(
  "trusted policyはdisabledでcandidate policyはautomaticである",
  function () {
    this.mergeInput = {
      trustedPolicy: trustedDeliveryPolicy(),
      candidatePolicy: policyWithMerge({
        mode: "automatic",
        branches: ["feature/*"],
        methods: ["squash"],
        requiredChecks: [],
        requiredReviews: 0,
      }),
      method: "squash",
      checks: [],
      branch: "feature/a",
    };
  },
);
Given(
  "trusted policyがautomaticでcheck {string}とreview 1件を要求する",
  function (check: string) {
    this.mergeInput = {
      trustedPolicy: policyWithMerge({
        mode: "automatic",
        branches: ["feature/*"],
        methods: ["squash"],
        requiredChecks: [check],
        requiredReviews: 1,
      }),
      method: "squash",
      checks: [],
      approvals: [],
      headSha: "a".repeat(40),
      prAuthorActorId: "author",
      implementationAuthorActorId: "implementer",
      branch: "feature/a",
      repositoryVerified: true,
      shaVerified: true,
      protectionVerified: true,
      mergeableVerified: true,
    };
  },
);
Given("branch、method、check、reviewがすべて条件を満たす", function () {
  this.mergeInput.checks = ["ci"];
  this.mergeInput.approvals = [
    {
      state: "APPROVED",
      commitSha: this.mergeInput.headSha,
      actorId: "independent-reviewer",
      submittedAt: "2026-08-23T12:00:00Z",
      reviewId: "1",
    },
  ];
});
Given("trusted policyがassistedである", function () {
  this.trustedPolicy = policyWithMerge({
    mode: "assisted",
    branches: ["feature/*"],
    methods: ["merge"],
    requiredChecks: [],
    requiredReviews: 0,
  });
});
Given(
  "trusted automatic policyがrequired check {string}を持つ",
  function (check: string) {
    this.mergeInput = {
      trustedPolicy: policyWithMerge({
        mode: "automatic",
        branches: ["*"],
        methods: ["squash"],
        requiredChecks: [check],
        requiredReviews: 0,
      }),
      method: "squash",
      checks: undefined,
      approvals: [],
      headSha: "a".repeat(40),
      branch: "x",
      repositoryVerified: true,
      shaVerified: true,
      protectionVerified: true,
      mergeableVerified: true,
    };
  },
);
When("candidate branchのmerge authorizationを評価する", function () {
  this.mergeResult = authorizeMerge(this.mergeInput);
});
When("merge authorizationを評価する", function () {
  this.mergeResult = authorizeMerge(this.mergeInput);
});
When("human approvalなしとありでmerge authorizationを評価する", function () {
  const headSha = "a".repeat(40);
  const base: MergeInput = {
    trustedPolicy: this.trustedPolicy,
    method: "merge",
    checks: [],
    approvals: [],
    headSha,
    prAuthorActorId: "author",
    implementationAuthorActorId: "implementer",
    branch: "feature/a",
    repositoryVerified: true,
    shaVerified: true,
    protectionVerified: true,
    mergeableVerified: true,
  };
  this.withoutApproval = authorizeMerge(base);
  this.withApproval = authorizeMerge({
    ...base,
    approvals: [
      {
        state: "APPROVED",
        commitSha: headSha,
        actorId: "independent-reviewer",
        submittedAt: "2026-08-23T12:00:00Z",
        reviewId: "1",
      },
    ],
  });
});
When("check state unknownでmerge authorizationを評価する", function () {
  this.mergeResult = authorizeMerge(this.mergeInput);
});
/**
 * **単独運用が既定で成立することを固定する**（Issue #1317）。
 *
 * implementer・PR author・reviewerがすべて同一actorという、別のGitHub利用者が
 * 居ないprojectの形である。旧契約ではこの構成が変更のリスクに関係なく恒常的に
 * 停止していた。**exact HEAD一致とAPPROVEDは引き続き必須である。**
 */
const soleOperatorMergeInput = (
  reviewIndependence?: "context-isolated" | "actor-independent",
) => {
  const headSha = "a".repeat(40);
  return {
    trustedPolicy: policyWithMerge({
      mode: "automatic",
      branches: ["feature/*"],
      methods: ["squash"],
      requiredChecks: [],
      requiredReviews: 1,
      ...(reviewIndependence === undefined ? {} : { reviewIndependence }),
    }),
    method: "squash" as const,
    checks: [],
    approvals: [
      {
        state: "APPROVED",
        commitSha: headSha,
        actorId: "actor-solo",
        submittedAt: "2026-09-10T12:00:00Z",
        reviewId: "1",
      },
    ],
    branch: "feature/solo",
    headSha,
    prAuthorActorId: "actor-solo",
    implementationAuthorActorId: "actor-solo",
    repositoryVerified: true,
    shaVerified: true,
    protectionVerified: true,
    mergeableVerified: true,
  };
};

Given(
  "trusted policyがreviewIndependenceを宣言せず実装者自身の承認だけがある",
  function () {
    this.mergeInput = soleOperatorMergeInput();
  },
);

Given(
  "trusted policyがactor-independentを宣言し実装者自身の承認だけがある",
  function () {
    this.mergeInput = soleOperatorMergeInput("actor-independent");
  },
);

Given("reviewが旧HEADまたは実装者自身による承認である", function () {
  const headSha = "a".repeat(40);
  this.mergeInput = {
    trustedPolicy: policyWithMerge({
      mode: "automatic",
      branches: ["feature/*"],
      methods: ["squash"],
      requiredChecks: [],
      requiredReviews: 1,
      /**
       * **実装者自身の承認を数えない性質は`actor-independent`の強制点である。**
       *
       * 旧HEADの承認を数えないことは両モード共通だが、実装者自身を除外するのは
       * actor単位の独立性を要求する場合だけである。本scenarioはその強制点を
       * 固定するので、policyが明示的に宣言する。
       */
      reviewIndependence: "actor-independent",
    }),
    method: "squash",
    checks: [],
    approvals: [
      {
        state: "APPROVED",
        commitSha: "b".repeat(40),
        actorId: "reviewer",
        submittedAt: "2026-08-23T11:00:00Z",
        reviewId: "1",
      },
      {
        state: "APPROVED",
        commitSha: headSha,
        actorId: "implementer",
        submittedAt: "2026-08-23T12:00:00Z",
        reviewId: "2",
      },
    ],
    headSha,
    prAuthorActorId: "author",
    implementationAuthorActorId: "implementer",
    branch: "feature/a",
    repositoryVerified: true,
    shaVerified: true,
    protectionVerified: true,
    mergeableVerified: true,
  };
});
Given("repository、SHA、保護設定のtrusted観測が欠けている", function () {
  this.mergeInput = {
    trustedPolicy: policyWithMerge({
      mode: "automatic",
      branches: ["feature/*"],
      methods: ["squash"],
      requiredChecks: [],
      requiredReviews: 0,
    }),
    method: "squash",
    checks: [],
    approvals: [],
    headSha: "a".repeat(40),
    branch: "feature/a",
  };
});
Given("同一reviewerが承認後に変更要求へ更新している", function () {
  const headSha = "a".repeat(40);
  this.mergeInput = {
    trustedPolicy: policyWithMerge({
      mode: "automatic",
      branches: ["feature/*"],
      methods: ["squash"],
      requiredChecks: [],
      requiredReviews: 1,
    }),
    method: "squash",
    checks: [],
    approvals: [
      {
        state: "CHANGES_REQUESTED",
        commitSha: headSha,
        actorId: "reviewer",
        submittedAt: "2026-08-23T13:00:00Z",
        reviewId: "2",
      },
      {
        state: "APPROVED",
        commitSha: headSha,
        actorId: "reviewer",
        submittedAt: "2026-08-23T12:00:00Z",
        reviewId: "1",
      },
    ],
    headSha,
    prAuthorActorId: "author",
    implementationAuthorActorId: "implementer",
    branch: "feature/a",
    repositoryVerified: true,
    shaVerified: true,
    protectionVerified: true,
    mergeableVerified: true,
  };
});
Given("reviewのsubmittedAtが不正である", function () {
  const approval = this.mergeInput.approvals?.[0];
  if (!approval) throw new Error("review fixtureがありません");
  approval.submittedAt = "sometime";
});
Given("同一review IDに異なるactorと時刻の観測がある", function () {
  const headSha = "a".repeat(40);
  this.mergeInput = {
    trustedPolicy: policyWithMerge({
      mode: "automatic",
      branches: ["feature/*"],
      methods: ["squash"],
      requiredChecks: [],
      requiredReviews: 1,
    }),
    method: "squash",
    checks: [],
    approvals: [
      {
        state: "APPROVED",
        commitSha: headSha,
        actorId: "reviewer-a",
        submittedAt: "2026-08-23T12:00:00Z",
        reviewId: "same-id",
      },
      {
        state: "APPROVED",
        commitSha: headSha,
        actorId: "reviewer-b",
        submittedAt: "2026-08-23T12:01:00Z",
        reviewId: "same-id",
      },
    ],
    headSha,
    prAuthorActorId: "author",
    implementationAuthorActorId: "implementer",
    branch: "feature/a",
    repositoryVerified: true,
    shaVerified: true,
    protectionVerified: true,
    mergeableVerified: true,
  };
});
Then("mergeは許可されない", function () {
  assert.equal(this.mergeResult.allowed, false);
});
Then("mergeは許可される", function () {
  assert.equal(this.mergeResult.allowed, true);
});
Then("許可operationは{string}だけである", function (operation: string) {
  assert.deepEqual(this.mergeResult.operations, [operation]);
});
Given(
  "trusted automatic policyがreview 1件を要求しapprovalが0件である",
  function () {
    this.mergeInput = independentReviewMergeInput(1);
  },
);
Given(
  "requiredReviewsを0と宣言したtrusted automatic policyがある",
  function () {
    this.mergeInput = independentReviewMergeInput(0);
  },
);
When("宣言0件と宣言1件でmerge authorizationを評価する", function () {
  this.declaredZero = authorizeMerge(independentReviewMergeInput(0));
  this.declaredOne = authorizeMerge(independentReviewMergeInput(1));
});
Then("独立review不足の拒否診断が次の操作と必要authorityを持つ", function () {
  assert.equal(this.mergeResult.allowed, false);
  const diagnostic = this.mergeResult.diagnostic;
  assert.ok(diagnostic, "拒否診断がありません");
  assert.equal(diagnostic.ruleId, "ASC-MERGE-REVIEW-001");
  assert.equal(
    diagnostic.purpose,
    "実装者以外の独立した確認を経ないmergeを防ぐ",
  );
  assert.equal(diagnostic.risk, "authority");
  assert.equal(
    diagnostic.next,
    "対象HEAD SHAに対する独立reviewerのapprovalを得てからpr mergeを再実行してください",
  );
  assert.equal(
    diagnostic.requiredAuthority,
    "対象PRへ独立approvalを与えられるreviewer",
  );
  assert.equal(
    diagnostic.rollback,
    "mergeを実行せず、branchと既存commitを変更しない",
  );
  assert.deepEqual(diagnostic.autoFixes, []);
  assert.ok(diagnostic.checks.length >= 1);
  assert.ok(diagnostic.scope.includes("mode:automatic"));
  assert.ok(diagnostic.scope.includes(`head:${"a".repeat(40)}`));
});
Then("独立review不足の拒否診断は件数だけを根拠にする", function () {
  const diagnostic = this.mergeResult.diagnostic;
  assert.ok(diagnostic, "拒否診断がありません");
  assert.ok(
    diagnostic.reasons.includes(
      "要求する独立approvalは1件ですが、対象HEADに対する独立approvalは0件です",
    ),
    `要求数と観測数の根拠がありません: ${JSON.stringify(diagnostic.reasons)}`,
  );
  for (const reason of diagnostic.reasons)
    for (const actorId of ["author", "implementer", "independent-reviewer"])
      assert.ok(
        !reason.includes(actorId),
        `根拠へactor IDが混入しています: ${reason}`,
      );
});
Then("独立review不足の拒否診断は宣言値と適用値の双方を示す", function () {
  const raised =
    "policyが宣言したrequiredReviewsは0ですが、独立reviewの下限は1のため適用値は1です";
  assert.ok(
    this.declaredZero.diagnostic?.reasons.includes(raised),
    `宣言値と適用値の差がありません: ${JSON.stringify(this.declaredZero.diagnostic?.reasons)}`,
  );
  assert.ok(
    !this.declaredOne.diagnostic?.reasons.some((reason: string) =>
      reason.startsWith("policyが宣言したrequiredReviewsは"),
    ),
    "宣言値と適用値が一致する場合に差の根拠を出しています",
  );
});
Then(
  "診断の有無にかかわらずallowedとoperationsが従来どおりになる",
  function () {
    assert.equal(this.withoutApproval.allowed, false);
    assert.deepEqual(this.withoutApproval.operations, []);
    assert.equal(
      this.withoutApproval.diagnostic?.ruleId,
      "ASC-MERGE-REVIEW-001",
    );
    assert.equal(this.withApproval.allowed, true);
    assert.deepEqual(this.withApproval.operations, ["pr.merge"]);
    assert.equal(this.withApproval.diagnostic, undefined);
  },
);
Then("approvalなしは拒否され、approvalありだけ許可される", function () {
  assert.equal(this.withoutApproval.allowed, false);
  assert.equal(this.withApproval.allowed, true);
});

Given(
  "staging trackerと同じcanonical IssueをcloseするPR観測がある",
  function () {
    this.value = {
      repository: "owner/repository",
      tracker: "https://github.com/owner/repository/issues/877",
      closingIssueReferences: [
        {
          number: 877,
          url: "https://github.com/owner/repository/issues/877",
        },
      ],
    };
  },
);

Given("staging trackerと異なるIssueをcloseするPR観測がある", function () {
  this.value = {
    repository: "owner/repository",
    tracker: "https://github.com/owner/repository/issues/877",
    closingIssueReferences: [
      {
        number: 878,
        url: "https://github.com/owner/repository/issues/878",
      },
    ],
  };
});

Given("staging trackerとcanonical以外もcloseするPR観測がある", function () {
  this.value = {
    repository: "owner/repository",
    tracker: "https://github.com/owner/repository/issues/877",
    closingIssueReferences: [
      {
        number: 877,
        url: "https://github.com/owner/repository/issues/877",
      },
      {
        number: 878,
        url: "https://github.com/owner/repository/issues/878",
      },
    ],
  };
});

When("PRとstagingの同一性を検証する", function () {
  try {
    this.value = assertPullRequestTrackerBinding(
      this.value as Parameters<typeof assertPullRequestTrackerBinding>[0],
    );
  } catch (error) {
    this.error = error;
  }
});

Then("PRとstagingの同一性検証は成功する", function () {
  assert.equal(this.error, undefined);
  assert.deepEqual(this.value, {
    issue: 877,
    issueUrl: "https://github.com/owner/repository/issues/877",
  });
});

Then("PRとstagingの同一性検証は失敗する", function () {
  assert.ok(this.error instanceof Error);
  assert.match(this.error.message, /canonical Issue #877/u);
});

Given("merged、clean、pushed、recoveryありのworktree stateがある", function () {
  this.finalizeState = safeState();
});
Given("finalize stateを{word}にする", function (condition: string) {
  const changes = {
    dirty: { dirty: true },
    untracked: { untracked: ["secret.txt"] },
    unpushed: { pushed: false },
    unmerged: { prMerged: false },
    "recovery-unknown": { recoveryReachable: false },
    /**
     * PRがmergeされremote branchが削除された着地形の**観測結果**。
     * upstream由来の観測はすべて偽のままで、`reachableFromDefaultBranch`だけが真になる。
     * **判定側はこの独立fieldが真であると観測できたときだけupstream由来の理由を免除する**
     * （Issue #1097）。観測の意味は上書きしない。
     */
    "merged-remote-deleted": {
      pushed: false,
      remoteBranch: false,
      recoveryRef: undefined,
      recoveryReachable: true,
      reachableFromDefaultBranch: true,
      unpushedCommits: 2,
    },
    /**
     * 到達を**観測できていない**同型の入力。`reachableFromDefaultBranch`が
     * `undefined`なら免除せず拒否する（Issue #1097のfail-closed）。
     */
    "merged-remote-deleted-unknown": {
      pushed: false,
      remoteBranch: false,
      recoveryRef: undefined,
      recoveryReachable: true,
      unpushedCommits: 2,
    },
    /**
     * 復旧参照の不在**だけ**が拒否理由になる入力。到達が不明なので免除しない。
     * `finalize.ts`の免除条件を無条件にする変異をこの入力だけが落とす。
     *
     * **`merged-remote-deleted-unknown`と本fixtureは`inspectRecoveryState`が生成し得ない
     * 観測の組み合わせを含む。** 判定側の免除gateを単独で隔離するための入力であり、
     * 観測器の出力を模したものではない。
     */
    "recovery-ref-missing-unknown": {
      recoveryRef: undefined,
    },
    "spec-unknown": { specConsistent: "unknown" },
    "ignored-artifact": { ignoredArtifacts: ["output.bin"] },
  };
  assert.ok(condition in changes);
  Object.assign(this.finalizeState, changes[condition as keyof typeof changes]);
});
Given("safe finalize reportを作成済みである", function () {
  this.finalizeReport = buildFinalizeReport(this.finalizeState);
});
When("finalize reportを作成する", function () {
  this.finalizeReport = buildFinalizeReport(this.finalizeState);
});
Then("finalize reportはsafeでない", function () {
  assert.equal(this.finalizeReport.safe, false);
});
Then("finalize reportはsafeである", function () {
  assert.equal(
    this.finalizeReport.safe,
    true,
    `safeではありません: ${this.finalizeReport.reasons.join(" / ")}`,
  );
});
When("report hashを承認してfinalize applyを試みる", function () {
  this.finalizeReport = buildFinalizeReport(this.finalizeState);
  try {
    applyFinalize(
      {
        report: this.finalizeReport,
        approvedHash: this.finalizeReport.hash,
        currentState: this.finalizeState,
        trustedPolicy: trustedFinalizePolicy(),
      },
      (operation) => this.calls.push(operation),
    );
  } catch (error) {
    this.error = error;
  }
});
When("current HEADを変更してfinalize applyする", function () {
  try {
    applyFinalize(
      {
        report: this.finalizeReport,
        approvedHash: this.finalizeReport.hash,
        currentState: { ...this.finalizeState, headSha: "c".repeat(40) },
        trustedPolicy: trustedFinalizePolicy(),
      },
      (operation) => this.calls.push(operation),
    );
  } catch (error) {
    this.error = error;
  }
});
When("同一stateと承認hashでfinalize applyする", function () {
  this.finalizeResult = applyFinalize(
    {
      report: this.finalizeReport,
      approvedHash: this.finalizeReport.hash,
      currentState: this.finalizeState,
      trustedPolicy: trustedFinalizePolicy(),
    },
    (operation) => this.calls.push(operation),
  );
});
When("trusted policyなしでfinalize applyを試みる", function () {
  try {
    applyFinalize(
      {
        report: this.finalizeReport,
        approvedHash: this.finalizeReport.hash,
        currentState: this.finalizeState,
        trustedPolicy: undefined,
      },
      (operation) => this.calls.push(operation),
    );
  } catch (error) {
    this.error = error;
  }
});
Then("reportはsafeで64桁hashを持つ", function () {
  assert.equal(this.finalizeReport.safe, true);
  assert.match(this.finalizeReport.hash, /^[a-f0-9]{64}$/u);
});
Then("destructive operation callは0件である", function () {
  assert.equal(this.calls.length, 0);
});
Then("finalize applyは失敗する", function () {
  assert.ok(this.error instanceof Error);
});
Then("lifecycle stateはfinalizedである", function () {
  assert.equal(this.finalizeResult.state, "finalized");
});
Then("destructive operationは{string}だけである", function (operation: string) {
  assert.deepEqual(this.calls, [operation]);
});

/**
 * 固定run IDの直読みを実gh境界で測る（Issue #1280）。
 * merge後の照合はこのadapterの返り値だけを入力にするため、
 * 欠落や型違いを合格へ倒すと偽のmerged終端を受理する。
 */
const fixedCiRunPayload = (): Record<string, unknown> => ({
  id: 42,
  repository: { full_name: "o/r" },
  head_repository: { full_name: "o/r" },
  event: "pull_request",
  head_sha: "a".repeat(40),
  head_branch: "feature/x",
  status: "completed",
  conclusion: "success",
  pull_requests: [{ number: 9 }],
});

function prepareCiRunStub(
  world: GhReadStubWorld,
  body: string,
  apiExitCode = 0,
) {
  const directory = world.temp("asc-gh-cirun-");
  world.ghLog = path.join(directory, "operations.log");
  const stub = path.join(directory, "gh");
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env node\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(world.ghLog)},args.join(' ')+'\\n');if(args[0]==='repo')process.stdout.write(JSON.stringify({nameWithOwner:'o/r',viewerPermission:'READ'}));if(args[0]==='api'){if(${apiExitCode}!==0){process.stderr.write('HTTP 404: Not Found');process.exit(${apiExitCode});}process.stdout.write(${JSON.stringify(body)});}\n`,
  );
  fs.chmodSync(stub, 0o755);
  world.stubPath = `${directory}${path.delimiter}${process.env.PATH ?? ""}`;
}

/** 変種名から壊し方を導く。fixtureを実装から書き写さず、健全な観測へ1箇所だけ操作を当てる。 */
const ciRunVariants: Record<string, () => { body: string; exit?: number }> = {
  head_repository欠落: () => {
    const payload = fixedCiRunPayload();
    delete payload.head_repository;
    return { body: JSON.stringify(payload) };
  },
  head_repositoryのfull_nameが非文字列: () => ({
    body: JSON.stringify({
      ...fixedCiRunPayload(),
      head_repository: { full_name: 1 },
    }),
  }),
  repository欠落: () => {
    const payload = fixedCiRunPayload();
    delete payload.repository;
    return { body: JSON.stringify(payload) };
  },
  event欠落: () => {
    const payload = fixedCiRunPayload();
    delete payload.event;
    return { body: JSON.stringify(payload) };
  },
  head_sha欠落: () => {
    const payload = fixedCiRunPayload();
    delete payload.head_sha;
    return { body: JSON.stringify(payload) };
  },
  head_branch欠落: () => {
    const payload = fixedCiRunPayload();
    delete payload.head_branch;
    return { body: JSON.stringify(payload) };
  },
  status欠落: () => {
    const payload = fixedCiRunPayload();
    delete payload.status;
    return { body: JSON.stringify(payload) };
  },
  conclusionがnull: () => ({
    body: JSON.stringify({ ...fixedCiRunPayload(), conclusion: null }),
  }),
  idが非整数: () => ({
    body: JSON.stringify({ ...fixedCiRunPayload(), id: "42" }),
  }),
  pull_requestsが配列でない: () => ({
    body: JSON.stringify({ ...fixedCiRunPayload(), pull_requests: {} }),
  }),
  pull_requests要素のnumberが欠落: () => ({
    body: JSON.stringify({ ...fixedCiRunPayload(), pull_requests: [{}] }),
  }),
  応答がobjectでない: () => ({ body: '"o/r"' }),
  応答が404: () => ({ body: "", exit: 1 }),
};

Given("固定run IDのrun観測を返すgh stubがある", function () {
  prepareCiRunStub(this, JSON.stringify(fixedCiRunPayload()));
});
/**
 * **head側とbase側を同値にしたfixtureはforkを区別できない**（Issue #1280）。
 * `head_repository.full_name`の代わりに`repository.full_name`を流用する変異は、
 * 両者が同値のfixtureでは観測不能である。**異なる値を1件置く。**
 */
Given("head repositoryがforkのrun観測を返すgh stubがある", function () {
  prepareCiRunStub(
    this,
    JSON.stringify({
      ...fixedCiRunPayload(),
      head_repository: { full_name: "fork/x" },
    }),
  );
});
Then(
  "CI run観測のhead repositoryは {string} である",
  function (expected: string) {
    assert.equal(
      (this.ciRunObservation as { headRepository: string }).headRepository,
      expected,
    );
  },
);
Then("CI run観測のrepositoryは {string} である", function (expected: string) {
  assert.equal(
    (this.ciRunObservation as { repository: string }).repository,
    expected,
  );
});
Given("{word}のrun観測を返すgh stubがある", function (variant: string) {
  const build = ciRunVariants[variant];
  assert.ok(build, `未知のrun観測変種です: ${variant}`);
  const { body, exit } = build();
  prepareCiRunStub(this, body, exit ?? 0);
});

function readFixedCiRun(world: { stubPath: string }): unknown {
  const original = process.env.PATH;
  process.env.PATH = world.stubPath;
  try {
    return github(
      "pr.ci-run",
      { repository: "o/r", runId: "42" },
      process.cwd(),
    );
  } finally {
    process.env.PATH = original;
  }
}

When(
  "run ID {string} でCI run adapterを実行して失敗を確認する",
  function (runId: string) {
    /**
     * **`runId`はAPI pathへそのまま連結される**（Issue #1280）。
     * 字句検査を落とすと`repos/o/r/actions/runs/<任意文字列>`を組み立てて
     * provider要求を送ってしまう。**拒否するだけでなく、送っていないことを測る。**
     */
    const original = process.env.PATH;
    process.env.PATH = this.stubPath;
    try {
      this.ciRunObservation = github(
        "pr.ci-run",
        { repository: "o/r", runId },
        process.cwd(),
      );
      this.ciRunError = undefined;
    } catch (error) {
      this.ciRunError = error as Error;
    } finally {
      process.env.PATH = original;
    }
  },
);
Then("run読取のapi操作は呼ばれない", function () {
  const log = fs.existsSync(this.ghLog)
    ? fs.readFileSync(this.ghLog, "utf8")
    : "";
  assert.doesNotMatch(
    log,
    /^api /mu,
    `不正なrun IDでprovider要求を送っています: ${log}`,
  );
});
When("固定run IDでCI run adapterを実行する", function () {
  this.ciRunObservation = readFixedCiRun(this);
});
When("固定run IDでCI run adapterを実行して失敗を確認する", function () {
  try {
    this.ciRunObservation = readFixedCiRun(this);
    this.ciRunError = undefined;
  } catch (error) {
    this.ciRunError = error as Error;
  }
});
Then("CI run adapterは失敗する", function () {
  assert.ok(
    this.ciRunError instanceof Error,
    `不正なrun観測を受理しました: ${JSON.stringify(this.ciRunObservation)}`,
  );
});
Then("CI run観測は9項目のidentityを返す", function () {
  assert.deepEqual(this.ciRunObservation, {
    runId: "42",
    repository: "o/r",
    headRepository: "o/r",
    event: "pull_request",
    headSha: "a".repeat(40),
    headBranch: "feature/x",
    status: "completed",
    conclusion: "success",
    pullRequestNumbers: [9],
  });
});
Then("run読取前にauthとrepository確認が行われる", function () {
  const operations = fs
    .readFileSync(this.ghLog, "utf8")
    .trim()
    .split("\n")
    .map((line: string) => line.split(" ").slice(0, 2).join(" "));
  assert.deepEqual(operations, [
    "auth status",
    "repo view",
    "api repos/o/r/actions/runs/42",
  ]);
});
