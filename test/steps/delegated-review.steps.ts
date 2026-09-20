import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  launchDelegatedReview,
  type DelegatedReviewResult,
} from "../../src/adapters/delegated-review-launch.js";
import { resolveReviewWorkspace } from "../../src/adapters/review-workspace.js";
import type { ReviewerExecutor } from "../../src/domain/reviewer-provider.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class DelegatedReviewWorld extends WorkflowWorld {
  root = "";
  configHome = "";
  staging = "";
  reviewCalls = 0;
  dispatchedModel = "";
  dispatchedPrompt = "";
  result: DelegatedReviewResult | undefined;
  baseSha = "";
  headSha = "";
  driftHeadDuringExecution = false;
  rejectVerification = false;
  response = JSON.stringify({
    decision: "ready",
    affirmative: "要求と受け入れ条件が対応する",
    adversarial: "欠落IDと矛盾を確認した",
    findings: [],
  });
}

const { Given, When, Then } = stepDefinitions<DelegatedReviewWorld>();

function setup(world: DelegatedReviewWorld): void {
  world.root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "asc-delegated-review-")),
  );
  world.temporaryDirectories.push(world.root);
  world.configHome = path.join(world.root, "config-home");
  world.staging = ".agent-skill-chain/tmp/issues/example";
  world.reviewCalls = 0;
  world.rejectVerification = false;
  world.dispatchedPrompt = "";
  world.response = JSON.stringify({
    decision: "ready",
    affirmative: "要求と受け入れ条件が対応する",
    adversarial: "欠落IDと矛盾を確認した",
    findings: [],
  });
  const staging = path.join(world.root, world.staging);
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, "00_要求定義.md"), "# 要求\nAC-001\n");
  git(world.root, ["init", "-q", "-b", "main"]);
  git(world.root, ["config", "user.name", "review-test"]);
  git(world.root, ["config", "user.email", "review@example.invalid"]);
}

function writeConfig(
  world: DelegatedReviewWorld,
  source: "local" | "global",
  fields: Record<string, unknown>,
): void {
  const file =
    source === "local"
      ? path.join(
          world.root,
          ".agent-skill-chain/local/supplemental-review.json",
        )
      : path.join(
          world.configHome,
          "agent-skill-chain/supplemental-review.json",
        );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(fields));
}

function config(model: string, extra: Record<string, unknown> = {}) {
  return {
    enabled: true,
    provider: "ollama",
    model,
    endpoint: "http://127.0.0.1:11434",
    timeoutMs: 300000,
    ...extra,
  };
}

function executor(world: DelegatedReviewWorld): ReviewerExecutor {
  return async (input) => {
    world.reviewCalls += 1;
    world.dispatchedModel = input.model;
    world.dispatchedPrompt = input.prompt;
    if (input.prompt.includes("投稿前の独立したfinding検証者"))
      return {
        state: "succeeded",
        reason: "ok",
        output: JSON.stringify({
          verdicts: [
            {
              index: 0,
              valid: !world.rejectVerification,
              reason: world.rejectVerification
                ? "現在のfileでは成立しない"
                : "現在のfileに重大な欠落が残る",
              faultCode: world.rejectVerification ? "" : "after",
              failurePath: world.rejectVerification ? "" : "入力から欠落に到達",
              blockingCode: world.rejectVerification ? "after" : "",
            },
          ],
        }),
      };
    /**
     * LLM応答待ち中（executor実行中）にHEADが動いた状況を再現する。
     * ここでの追加commitはexecutorが「成功応答」を返す直前、すなわち
     * launchDelegatedReviewが最初にHEADを固定確認した後に発生する。
     */
    if (world.driftHeadDuringExecution)
      git(world.root, ["commit", "-q", "--allow-empty", "-m", "drift"]);
    return { state: "succeeded", reason: "ok", output: world.response };
  };
}

function git(root: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

Given("委譲reviewer設定の無い隔離projectがある", function () {
  setup(this);
});

Given("異なるmodelのローカル設定とユーザー共通設定がある", function () {
  setup(this);
  writeConfig(this, "global", config("qwen3.6:27b"));
  writeConfig(this, "local", config("qwen3-coder:30b"));
});

Given("ユーザー共通設定と無効化したローカル設定がある", function () {
  setup(this);
  writeConfig(this, "global", config("qwen3-coder:30b"));
  writeConfig(this, "local", { enabled: false });
});

Given("ユーザー共通の委譲reviewer設定だけがある", function () {
  setup(this);
  writeConfig(this, "global", config("qwen3.6:27b"));
});

Given("主worktreeに設定があり対象stagingは連結worktreeにある", function () {
  setup(this);
  writeConfig(this, "local", config("qwen3-coder:30b"));
  fs.writeFileSync(
    path.join(this.root, ".gitignore"),
    ".agent-skill-chain/local/\n.worktrees/\n",
  );
  git(this.root, ["add", "-A"]);
  git(this.root, ["commit", "-q", "-m", "base"]);
  const linked = path.join(this.root, ".worktrees", "review");
  fs.mkdirSync(path.dirname(linked), { recursive: true });
  git(this.root, ["worktree", "add", "-q", "-b", "review", linked]);
  this.root = linked;
  const staging = path.join(this.root, this.staging);
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, "00_要求定義.md"), "# 要求\nAC-001\n");
});

Given("rootだけ主worktreeを指定してstagingは連結worktreeにある", function () {
  setup(this);
  writeConfig(this, "local", config("qwen3-coder:30b"));
  fs.writeFileSync(
    path.join(this.root, ".gitignore"),
    ".agent-skill-chain/local/\n.worktrees/\n",
  );
  git(this.root, ["add", "-A"]);
  git(this.root, ["commit", "-q", "-m", "base"]);
  const linked = path.join(this.root, ".worktrees", "review");
  fs.mkdirSync(path.dirname(linked), { recursive: true });
  git(this.root, ["worktree", "add", "-q", "-b", "review", linked]);
  this.staging = path.relative(this.root, path.join(linked, this.staging));
  const staging = path.join(this.root, this.staging);
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, "00_要求定義.md"), "# 要求\nAC-001\n");
});

Given("Step 7用の設計文書とローカルreviewer設定がある", function () {
  setup(this);
  writeConfig(this, "local", config("qwen3-coder:30b"));
  fs.writeFileSync(
    path.join(this.root, this.staging, "02_設計.md"),
    "# 設計\nAC-001を実装する設計\n",
  );
});

Given("loopback以外の委譲reviewer設定がある", function () {
  setup(this);
  writeConfig(
    this,
    "local",
    config("qwen3-coder:30b", { endpoint: "https://example.com" }),
  );
});

Given("上限超のstaging文書とローカルreviewer設定がある", function () {
  setup(this);
  writeConfig(this, "local", config("qwen3-coder:30b"));
  fs.writeFileSync(
    path.join(this.root, this.staging, "00_要求定義.md"),
    "# 要求\n" + "あ".repeat(350000),
  );
});

Given("Step 10の委譲reviewerがCritical指摘と承認を返す", function () {
  setup(this);
  writeConfig(this, "local", config("qwen3-coder:30b"));
  git(this.root, ["init", "-q", "-b", "main"]);
  git(this.root, ["config", "user.name", "review-test"]);
  git(this.root, ["config", "user.email", "review@example.invalid"]);
  fs.writeFileSync(path.join(this.root, "review-target.txt"), "before\n");
  git(this.root, ["add", "review-target.txt"]);
  git(this.root, ["commit", "-q", "-m", "base"]);
  this.baseSha = git(this.root, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(this.root, "review-target.txt"), "after\n");
  git(this.root, ["add", "review-target.txt"]);
  git(this.root, ["commit", "-q", "-m", "change"]);
  this.headSha = git(this.root, ["rev-parse", "HEAD"]);
  this.response = JSON.stringify({
    decision: "approved",
    affirmative: "差分の目的は明確",
    adversarial: "境界値を検討",
    findings: [
      {
        file: "review-target.txt",
        location: "1",
        content: "重大な欠落",
        severity: "Critical",
      },
    ],
  });
});

Given("委譲reviewの対象HEADが古い", function () {
  this.headSha = this.baseSha;
});

Given("委譲reviewerの実行中にHEADが進む", function () {
  this.driftHeadDuringExecution = true;
});

Given("Step 10の委譲reviewerが差分外ファイルのCritical指摘を返す", function () {
  setup(this);
  writeConfig(this, "local", config("qwen3-coder:30b"));
  git(this.root, ["init", "-q", "-b", "main"]);
  git(this.root, ["config", "user.name", "review-test"]);
  git(this.root, ["config", "user.email", "review@example.invalid"]);
  fs.writeFileSync(path.join(this.root, "review-target.txt"), "before\n");
  git(this.root, ["add", "review-target.txt"]);
  git(this.root, ["commit", "-q", "-m", "base"]);
  this.baseSha = git(this.root, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(this.root, "review-target.txt"), "after\n");
  git(this.root, ["add", "review-target.txt"]);
  git(this.root, ["commit", "-q", "-m", "change"]);
  this.headSha = git(this.root, ["rev-parse", "HEAD"]);
  this.response = JSON.stringify({
    decision: "changes_requested",
    affirmative: "変更行の動作は要求に合う",
    adversarial: "差分と関連文脈を確認した",
    findings: [
      {
        file: "unrelated/task.md",
        location: "1",
        content: "別作業の既知欠陥",
        severity: "Critical",
      },
    ],
  });
});

When("Step 3の委譲reviewを実行する", async function () {
  this.result = await launchDelegatedReview(
    {
      root: this.root,
      step: 3,
      stagingPath: this.staging,
      globalConfigHome: this.configHome,
    },
    { execute: executor(this) },
  );
});

When("Step 7の委譲reviewを実行する", async function () {
  this.result = await launchDelegatedReview(
    {
      root: this.root,
      step: 7,
      stagingPath: this.staging,
      globalConfigHome: this.configHome,
    },
    { execute: executor(this) },
  );
});

When("Step 10の委譲reviewを実行する", async function () {
  this.result = await launchDelegatedReview(
    {
      root: this.root,
      step: 10,
      baseSha: this.baseSha,
      headSha: this.headSha,
      stagingPath: this.staging,
      globalConfigHome: this.configHome,
    },
    { execute: executor(this) },
  );
});

Then("委譲reviewはdisabledでexecutorを起動しない", function () {
  assert.deepEqual(this.result, { state: "disabled" });
  assert.equal(this.reviewCalls, 0);
});

Then("ローカルmodelでStep 3の肯定と敵対の結果を返す", function () {
  assert.equal(this.result?.state, "reviewed");
  if (this.result?.state !== "reviewed") return;
  assert.equal(this.result.model, "qwen3-coder:30b");
  assert.equal(this.result.configSource, "local");
  assert.equal(this.result.decision, "ready");
  assert.ok(this.result.affirmative);
  assert.ok(this.result.adversarial);
  assert.equal(this.reviewCalls, 1);
});

Then("共通modelでStep 3の肯定と敵対の結果を返す", function () {
  assert.equal(this.result?.state, "reviewed");
  if (this.result?.state !== "reviewed") return;
  assert.equal(this.result.model, "qwen3.6:27b");
  assert.equal(this.result.configSource, "global");
  assert.equal(this.result.decision, "ready");
  assert.ok(this.result.affirmative);
  assert.ok(this.result.adversarial);
  assert.equal(this.reviewCalls, 1);
});

Then("主worktreeのmodelでStep 3の結果を返す", function () {
  assert.equal(this.result?.state, "reviewed");
  if (this.result?.state !== "reviewed") return;
  assert.equal(this.result.configSource, "primary");
  assert.equal(this.result.model, "qwen3-coder:30b");
  assert.equal(this.reviewCalls, 1);
});

Then("異なるworktreeのstagingを拒否して起動しない", function () {
  assert.equal(this.result?.state, "degraded");
  assert.equal(this.reviewCalls, 0);
  assert.throws(
    () => resolveReviewWorkspace(this.root, this.staging),
    /stagingとrootは同じGit worktree/,
  );
});

Then("設計文書を含むStep 7の肯定と敵対の結果を返す", function () {
  assert.equal(this.result?.state, "reviewed");
  if (this.result?.state !== "reviewed") return;
  assert.equal(this.result.step, 7);
  assert.equal(this.result.decision, "ready");
  assert.ok(this.result.affirmative);
  assert.ok(this.result.adversarial);
  assert.match(this.dispatchedPrompt, /02_設計\.md/u);
  assert.match(this.dispatchedPrompt, /AC-001を実装する設計/u);
  assert.equal(this.reviewCalls, 1);
});

Then("差分外の指摘を除外して進行役確認へ渡す", function () {
  assert.equal(this.result?.state, "needs_coordinator_review");
  if (this.result?.state !== "needs_coordinator_review") return;
  assert.deepEqual(this.result.findings, []);
  assert.equal(this.result.ignoredOutOfScopeCount, 1);
  assert.equal(this.reviewCalls, 1);
  assert.match(this.dispatchedPrompt, /review-target\.txt/u);
});

Then("委譲reviewはdegradedでexecutorを起動しない", function () {
  assert.equal(this.result?.state, "degraded");
  assert.equal(this.reviewCalls, 0);
});

Then("委譲reviewはdegradedでHEAD不一致を理由に返す", function () {
  assert.equal(this.result?.state, "degraded", JSON.stringify(this.result));
  assert.equal(this.reviewCalls, 1);
  if (this.result?.state !== "degraded") return;
  assert.match(this.result.reason, /HEAD/u);
});

Then("委譲reviewのCritical候補は進行役確認となりHEADへ固定される", function () {
  assert.equal(
    this.result?.state,
    "needs_coordinator_review",
    JSON.stringify(this.result),
  );
  if (this.result?.state !== "needs_coordinator_review") return;
  assert.equal(this.result.findings[0]?.severity, "Critical");
  assert.equal(this.result.baseSha, this.baseSha);
  assert.equal(this.result.headSha, this.headSha);
  assert.match(this.result.inputDigest, /^[a-f0-9]{64}$/u);
  assert.match(this.result.outputDigest, /^[a-f0-9]{64}$/u);
});

Given("chill profileのStep 3委譲reviewer設定がある", function () {
  setup(this);
  writeConfig(this, "local", config("qwen3-coder:30b", { profile: "chill" }));
  this.response = JSON.stringify({
    decision: "blocked",
    affirmative: "要件を確認した",
    adversarial: "失敗経路を確認した",
    findings: [
      {
        file: "00_要求定義.md",
        location: "1",
        content: "重大な欠落",
        severity: "High",
        effort: "Quick win",
      },
      {
        file: "00_要求定義.md",
        location: "1",
        content: "軽微な欠落",
        severity: "Low",
        effort: "Heavy lift",
      },
    ],
  });
});

Given(
  "chill profileのStep 3委譲reviewerが根拠のないblocked判定を返す",
  function () {
    setup(this);
    writeConfig(this, "local", config("qwen3-coder:30b", { profile: "chill" }));
    this.response = JSON.stringify({
      decision: "blocked",
      affirmative: "要件を確認した",
      adversarial: "失敗経路を確認した",
      findings: [],
    });
  },
);

Then("委譲reviewはdegradedで応答不正を返す", function () {
  assert.equal(this.result?.state, "degraded");
  if (this.result?.state !== "degraded") return;
  assert.match(this.result.reason, /応答を検証できませんでした/u);
});

Then("委譲reviewはHighのEffortだけを返す", function () {
  assert.equal(this.result?.state, "reviewed");
  if (this.result?.state !== "reviewed") return;
  assert.deepEqual(
    this.result.findings.map((finding) => [finding.severity, finding.effort]),
    [["High", "Quick win"]],
  );
  assert.deepEqual(
    this.result.suppressedFindings.map((finding) => [
      finding.severity,
      finding.effort,
    ]),
    [["Low", "Heavy lift"]],
  );
  assert.equal(this.result.decision, "blocked");
  assert.match(this.dispatchedPrompt, /chill profile/u);
});
Given("投稿前検証者はfindingを却下する", function () {
  this.rejectVerification = true;
});
Then("委譲reviewは初回候補と検証者の却下を進行役確認へ渡す", function () {
  assert.equal(
    this.result?.state,
    "needs_coordinator_review",
    JSON.stringify(this.result),
  );
  if (this.result?.state !== "needs_coordinator_review") return;
  assert.equal(this.result.findings.length, 1);
  assert.deepEqual(this.result.verificationSuggestedFindings, []);
  assert.equal(
    this.result.verificationAssessments?.[0]?.sourceFile,
    "review-target.txt",
  );
  assert.equal(
    this.result.verificationAssessments?.[0]?.sourceCommit,
    this.headSha,
  );
  assert.equal(this.result.verificationAssessments?.[0]?.modelValid, false);
  assert.equal(
    this.result.verificationAssessments?.[0]?.evidenceStatus,
    "quote_matched",
  );
  assert.equal(this.reviewCalls, 2);
});
