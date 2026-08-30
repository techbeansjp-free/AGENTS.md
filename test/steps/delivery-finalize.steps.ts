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
  commitResults: Array<{ sha?: string; authorActorId?: string } | Error>;
  deliveryResult: ReturnType<typeof createPullRequest>;
  evidence: ReturnType<typeof safeDeliveryEvidence>;
  finalizeReport: ReturnType<typeof buildFinalizeReport>;
  finalizeResult: ReturnType<typeof applyFinalize>;
  finalizeState: Parameters<typeof buildFinalizeReport>[0];
  ghLog: string;
  issueSyncResult: { url: string };
  mergeInput: MergeInput;
  mergeResult: ReturnType<typeof authorizeMerge>;
  mergeOperationResult: { state: string };
  omitTrustedPolicy: boolean;
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
        trustedPolicy: this.omitTrustedPolicy
          ? undefined
          : trustedDeliveryPolicy(),
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
function prepareGhCreateStub(
  world: GhReadStubWorld,
  matchingHead: boolean,
  matchingBase = true,
) {
  const directory = world.temp("asc-gh-create-");
  world.ghLog = path.join(directory, "operations.log");
  const stub = path.join(directory, "gh");
  const expected = "a".repeat(40);
  const observed = matchingHead ? expected : "b".repeat(40);
  const base = "c".repeat(40);
  const observedBase = matchingBase ? base : "d".repeat(40);
  const pr = JSON.stringify({
    number: 9,
    url: "https://github.com/o/r/pull/9",
    body: "Relates to #824",
    headRefName: "feature/x",
    baseRefName: "main",
    headRefOid: expected,
    baseRefOid: observedBase,
    closingIssuesReferences: [],
  });
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env node\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(world.ghLog)},args.join(' ')+'\\n');if(args[0]==='repo')process.stdout.write(JSON.stringify({nameWithOwner:'o/r',viewerPermission:'WRITE'}));if(args[0]==='api')process.stdout.write((args[1].includes('feature%2Fx')?${JSON.stringify(observed)}:${JSON.stringify(base)})+'\\n');if(args[0]==='pr'&&args[1]==='create')process.stdout.write('https://github.com/o/r/pull/9\\n');if(args[0]==='pr'&&args[1]==='view')process.stdout.write(${JSON.stringify(pr)});\n`,
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
When("PR create adapterを実行する", function () {
  const original = process.env.PATH;
  process.env.PATH = this.stubPath;
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
      },
      process.cwd(),
    );
  } catch (error) {
    this.error = error;
  } finally {
    process.env.PATH = original;
  }
});
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
Given("reviewが旧HEADまたは実装者自身による承認である", function () {
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
