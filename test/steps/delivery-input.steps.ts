import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  conformingPullRequestBody,
  stepDefinitions,
} from "../support/world.js";
import {
  prepareDeliveryCli,
  fixtureGit,
  stagingBytes,
  type WorkflowStepWorld,
} from "./workflow-step-enforcement.steps.js";
import {
  generateDeliveryInput,
  parseDeliverySummary,
} from "../../src/adapters/delivery-input.js";
import { assertCurrentReviewJournalBinding, main } from "../../src/cli.js";
import {
  loadEffectiveTrustedPolicySet,
  trustedVerificationPolicy,
} from "../../src/domain/policy.js";
import { validateDeliveryEvidence } from "../../src/domain/delivery.js";
import { isRecord } from "../../src/types.js";
import { findCommandUsage } from "../../src/cli-usage.js";
import {
  readVerificationRuns,
  appendVerificationRun,
} from "../../src/adapters/verification-run.js";
import { sealVerificationRun } from "../../src/domain/verification-run.js";

interface DeliveryInputWorld extends WorkflowStepWorld {
  prepared: ReturnType<typeof prepareDeliveryCli>;
  summary: Record<string, unknown>;
  preview: string;
  legacyPreview: string;
  refusal: string;
  snapshot: string;
  generated: ReturnType<typeof generateDeliveryInput>;
}
const { Given, When, Then } = stepDefinitions<DeliveryInputWorld>();
const SUMMARY_PATH = "delivery-summary.json";
function summaryDocument(): Record<string, unknown> {
  return {
    schemaVersion: "asc-delivery-summary/v1",
    issue: 877,
    body:
      conformingPullRequestBody({
        title: "bugfix: reviewed change",
        canonicalIssue: 877,
      }) + "\n{{ASC_HEAD}}\n{{ASC_VERIFICATION}}\n{{ASC_REVIEW}}\n",
    scenarioIds: ["SCN-DELIVERY-001"],
    spec: {
      consistent: true,
      impact: "no-spec-impact",
      rationale: "既存の文書表示だけの修正で製品仕様と公開契約を変更しない",
    },
    ownership: { classified: true, owner: "package", targetLayer: "package" },
  };
}
function input(world: DeliveryInputWorld) {
  const p = world.prepared;
  const binding = assertCurrentReviewJournalBinding(p.staging, p.headSha);
  const trusted = loadEffectiveTrustedPolicySet(p.root, "main");
  return {
    root: p.root,
    staging: p.staging,
    issue: 877,
    summaryPath: SUMMARY_PATH,
    headSha: p.headSha,
    implementationHeadSha: binding.implementationHeadSha,
    independenceMode: "context-isolated" as const,
    verificationPolicy: trustedVerificationPolicy(trusted),
  };
}
function args(world: DeliveryInputWorld) {
  return [
    "pr",
    "create",
    "--repo=o/r",
    "--issue=877",
    `--root=${world.prepared.root}`,
    `--staging=${world.prepared.staging}`,
    `--from-summary=${SUMMARY_PATH}`,
    "--dry-run",
  ];
}
async function run(arguments_: string[]) {
  const write = process.stdout.write;
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    const status = await main(arguments_);
    assert.equal(status, 0, output);
    return output;
  } finally {
    process.stdout.write = write;
  }
}
function snapshot(world: DeliveryInputWorld) {
  return JSON.stringify({
    staging: stagingBytes(world.prepared.staging),
    status: fixtureGit(world.prepared.root, ["status", "--porcelain"]),
    head: fixtureGit(world.prepared.root, ["rev-parse", "HEAD"]),
  });
}
Given(
  "review済みdelivery summaryと正式検証を持つ隔離projectがある",
  function () {
    this.prepared = prepareDeliveryCli(
      this,
      {},
      "automatic",
      "merge",
      "context-isolated",
      "quick",
      0,
      "valid",
      true,
      (root) => {
        fs.writeFileSync(
          path.join(root, SUMMARY_PATH),
          JSON.stringify(summaryDocument()),
        );
        fixtureGit(root, ["add", SUMMARY_PATH]);
        fixtureGit(root, ["commit", "-qm", "reviewable delivery summary"]);
      },
    );
    fixtureGit(this.prepared.root, ["checkout", "-qb", "feature/x"]);
    this.snapshot = snapshot(this);
  },
);
When("要約入力と生成済みlegacy入力でPRをpreviewする", async function () {
  this.generated = generateDeliveryInput(input(this));
  this.preview = await run(args(this));
  const temp = this.temp("asc-generated-delivery-");
  const body = path.join(temp, "body.md"),
    evidence = path.join(temp, "evidence.json");
  fs.writeFileSync(body, this.generated.body);
  fs.writeFileSync(evidence, JSON.stringify(this.generated.evidence));
  this.legacyPreview = await run([
    ...this.prepared.args.filter(
      (arg) =>
        !arg.startsWith("--body-file=") && !arg.startsWith("--evidence="),
    ),
    `--body-file=${body}`,
    `--evidence=${evidence}`,
    "--dry-run",
  ]);
});
Then("同じpreview結果となりGitとstagingとproviderに書き込まない", function () {
  assert.deepEqual(JSON.parse(this.preview), JSON.parse(this.legacyPreview));
  assert.equal(snapshot(this), this.snapshot);
  assert.equal(fs.existsSync(this.prepared.logFile), false);
});
When("worktreeの要約だけを書き換えて機械入力を導出する", function () {
  fs.writeFileSync(
    path.join(this.prepared.root, SUMMARY_PATH),
    "unreviewed content",
  );
  this.generated = generateDeliveryInput(input(this));
});
Then("review済みGit本文だけが出力される", function () {
  assert.match(this.generated.body, /reviewed change/u);
  assert.doesNotMatch(this.generated.body, /unreviewed content|\{\{ASC_/u);
});
When(
  "delivery summaryに「{word}」を与えてPRをpreviewする",
  async function (kind: string) {
    const p = this.prepared;
    let command = args(this);
    if (kind === "uncommitted-path") {
      fs.writeFileSync(
        path.join(p.root, "uncommitted.json"),
        JSON.stringify(summaryDocument()),
      );
      command = command.map((x) =>
        x.startsWith("--from-summary=") ? "--from-summary=uncommitted.json" : x,
      );
    } else if (kind === "head-changed") {
      fs.writeFileSync(path.join(p.root, "other.txt"), "change");
      fixtureGit(p.root, ["add", "other.txt"]);
      fixtureGit(p.root, ["commit", "-qm", "unreviewed"]);
    } else if (kind === "seal-changed")
      fs.appendFileSync(
        path.join(p.staging, "00_要求定義.md"),
        "\nUnreviewed request\n",
      );
    else if (kind === "missing-review") {
      fixtureGit(p.root, ["reset", "--hard", p.implementationCommitSha]);
    } else if (kind === "exclusive-input")
      command.push("--head-sha=" + p.headSha);
    else if (kind === "latest-failed") {
      const records = readVerificationRuns(p.staging);
      const previous = records.at(-1);
      assert.ok(previous);
      const { recordDigest: _digest, ...body } = previous;
      appendVerificationRun(
        p.staging,
        sealVerificationRun({
          ...body,
          exitCode: 1,
          finishedAt: new Date(
            Date.parse(previous.finishedAt) + 1000,
          ).toISOString(),
        }),
      );
    } else throw new Error("unknown fixture case");
    try {
      await run(command);
      this.refusal = "";
    } catch (error) {
      this.refusal = error instanceof Error ? error.message : String(error);
      const expected: Record<string, RegExp> = {
        "uncommitted-path": /通常Git blob/u,
        "head-changed": /HEAD|head|差分/u,
        "seal-changed": /封印|seal|digest|計画/u,
        "missing-review": /通常Git blob/u,
        "latest-failed": /正式review\/検証|検証欄/u,
        "exclusive-input": /併用できません/u,
      };
      assert.match(this.refusal, expected[kind]!);
    }
  },
);
Then("summary previewは安全gateで拒否される", function () {
  assert.notEqual(this.refusal, "");
  assert.equal(fs.existsSync(this.prepared.logFile), false);
});
Given("正常なdelivery summary JSONがある", function () {
  this.summary = summaryDocument();
});
When("summaryの「{word}」を不正にする", function (kind: string) {
  const value = this.summary;
  assert.ok(typeof value.body === "string");
  assert.ok(isRecord(value.spec));
  if (kind === "caller-head") value.headSha = "a".repeat(40);
  else if (kind === "caller-approval") value.review = { approved: true };
  else if (kind === "missing-placeholder")
    value.body = value.body.replace("{{ASC_HEAD}}", "");
  else if (kind === "duplicate-placeholder") value.body += "{{ASC_HEAD}}";
  else if (kind === "unknown-placeholder") value.body += "{{ASC_UNKNOWN}}";
  else if (kind === "missing-consistent") delete value.spec.consistent;
  else if (kind === "short-rationale") value.spec.rationale = "short";
  else if (kind === "false-consistent") value.spec.consistent = false;
  else if (kind === "wrong-issue") value.issue = 878;
  else throw new Error("unknown fixture case");
});
Then("delivery summary入力が拒否される", function () {
  assert.throws(() => {
    const parsed = parseDeliverySummary(JSON.stringify(this.summary), 877);
    validateDeliveryEvidence(
      {
        headSha: "a".repeat(40),
        review: { approved: true, headSha: "a".repeat(40) },
        tests: {
          passed: true,
          headSha: "a".repeat(40),
          scenarioIds: parsed.scenarioIds,
        },
        spec: { ...parsed.spec, headSha: "a".repeat(40) },
      },
      "a".repeat(40),
    );
  });
});

When("PR create helpのsummaryExampleを読む", function () {
  const usage = findCommandUsage("pr", "create");
  assert.ok(usage?.inputContract);
  const marker = " summaryExample: ";
  const index = usage.inputContract.description.indexOf(marker);
  assert.ok(index >= 0);
  const source = usage.inputContract.description.slice(index + marker.length);
  const value: unknown = JSON.parse(source);
  assert.ok(isRecord(value));
  this.summary = value;
});
Then("全placeholderと改行を持つsummaryとして解釈できる", function () {
  const parsed = parseDeliverySummary(JSON.stringify(this.summary), 886);
  assert.ok(parsed.body.includes("\n## 概要\n"));
  assert.match(parsed.body, /Closes #886/u);
  for (const token of ["ASC_HEAD", "ASC_REVIEW", "ASC_VERIFICATION"])
    assert.equal(parsed.body.split(`{{${token}}}`).length, 2);
});
