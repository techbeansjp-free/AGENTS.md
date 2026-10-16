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
import {
  parseReviewEvidence,
  renderReviewEvidence,
  reviewEvidenceDigest,
} from "../../src/domain/review-evidence.js";

interface DeliveryInputWorld extends WorkflowStepWorld {
  prepared: ReturnType<typeof prepareDeliveryCli>;
  summary: Record<string, unknown>;
  preview: string;
  legacyPreview: string;
  refusal: string;
  snapshot: string;
  generated: ReturnType<typeof generateDeliveryInput>;
  declarationCase: string;
}
const { Given, When, Then } = stepDefinitions<DeliveryInputWorld>();
const SUMMARY_PATH = "delivery-summary.json";
function writeScenarioSource(root: string): void {
  fs.mkdirSync(path.join(root, "test/features"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "test/features/delivery.feature"),
    "Feature: delivery\n  Scenario: SCN-DELIVERY-001 reviewed delivery\n    Given a request\n    When delivering\n    Then it is checked\n",
  );
}
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
      trace: { tests: ["test/features/delivery.feature"] },
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
function registerPlanningScenario(staging: string): void {
  fs.appendFileSync(
    path.join(staging, "00_要求定義.md"),
    "\n```gherkin\nScenario: SCN-DELIVERY-001 reviewed delivery\n  Given a request\n  When delivering\n  Then it is checked\n```\n",
  );
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
        writeScenarioSource(root);
        fixtureGit(root, [
          "add",
          SUMMARY_PATH,
          "test/features/delivery.feature",
        ]);
        fixtureGit(root, ["commit", "-qm", "reviewable delivery summary"]);
      },
      registerPlanningScenario,
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
    } else if (kind === "old-review" || kind === "tampered-review") {
      const artifact = "docs/reviews/877_review.json";
      const evidence = parseReviewEvidence(
        fs.readFileSync(path.join(p.root, artifact), "utf8"),
      );
      const body = {
        ...evidence,
        observed: { ...evidence.observed, implementationHeadSha: p.baseSha },
      };
      const changed = {
        ...body,
        evidenceDigest:
          kind === "old-review"
            ? reviewEvidenceDigest(body)
            : evidence.evidenceDigest,
      };
      fs.writeFileSync(
        path.join(p.root, artifact),
        renderReviewEvidence(changed),
      );
      fixtureGit(p.root, ["add", artifact]);
      fixtureGit(p.root, ["commit", "-qm", "stale or tampered evidence"]);
    } else if (kind === "tampered-summary") {
      fs.writeFileSync(
        path.join(p.root, SUMMARY_PATH),
        JSON.stringify({
          ...summaryDocument(),
          scenarioIds: ["SCN-FORGED-001"],
        }),
      );
      fixtureGit(p.root, ["add", SUMMARY_PATH]);
      fixtureGit(p.root, ["commit", "-qm", "unreviewed summary change"]);
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
        "old-review": /H_impl|review|HEAD/u,
        "tampered-review": /digest|証跡|review/u,
        "tampered-summary": /HEAD|head|差分/u,
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
  else if (kind === "missing-trace-tests") delete value.spec.trace;
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

Given(
  "「{word}」の仕様・検証申告を含む要約がreviewされた隔離projectがある",
  function (kind: string) {
    this.declarationCase = kind;
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
        const summary = summaryDocument();
        writeScenarioSource(root);
        assert.ok(isRecord(summary.ownership));
        if (kind === "spec-change-no-spec" || kind === "valid-updated") {
          fs.mkdirSync(path.join(root, "docs/specs/02_要件"), {
            recursive: true,
          });
          fs.writeFileSync(
            path.join(root, "docs/specs/02_要件/00_要件一覧.md"),
            "# 要件\nREQ-DELIVERY-001 新しい振舞いを要求する\n",
          );
          if (kind === "valid-updated")
            summary.spec = {
              consistent: true,
              impact: "updated",
              trace: {
                requirements: ["REQ-DELIVERY-001"],
                scenarios: ["SCN-DELIVERY-001"],
                tests: ["test/features/delivery.feature"],
              },
            };
        } else if (kind === "feature-reference") {
          fs.writeFileSync(
            path.join(root, "test/features/delivery.feature"),
            "Feature: reference\n# Scenario: SCN-DELIVERY-001 is only a comment\nScenario: SCN-OTHER-001 mentions SCN-DELIVERY-001\n Given a request\n Then it is checked\n",
          );
        } else if (kind === "scenario-reference") {
          summary.scenarioIds = ["SCN-NOT-EXIST-001"];
          fs.appendFileSync(
            path.join(root, "test/features/delivery.feature"),
            "\n# Scenario: SCN-NOT-EXIST-001 comment only\n\n  Scenario: SCN-REAL-002 mentions SCN-NOT-EXIST-001\n    Given a request\n    Then it is checked\n",
          );
        } else if (
          kind === "generic-comment" ||
          kind === "valid-native" ||
          kind === "backtick-docstring" ||
          kind === "quote-docstring" ||
          ["raw-backtick-docstring", "raw-background-docstring"].includes(kind)
        ) {
          if (kind !== "valid-native")
            summary.scenarioIds = ["SCN-NOT-EXIST-001"];
          fs.writeFileSync(
            path.join(root, "test/fake.test.js"),
            "// SCN-NOT-EXIST-001 cannot register a scenario\nexport const example = true;\n",
          );
          assert.ok(isRecord(summary.spec));
          summary.spec.trace = { tests: ["test/fake.test.js"] };
        } else if (kind === "nonexistent-scenario") {
          summary.scenarioIds = ["SCN-NOT-EXIST-001"];
        } else if (kind === "missing-test-source") {
          assert.ok(isRecord(summary.spec));
          summary.spec.trace = { tests: ["test/features/missing.feature"] };
        } else if (kind === "self-reference") {
          assert.ok(isRecord(summary.spec));
          summary.spec.trace = { tests: [SUMMARY_PATH] };
        } else if (kind === "missing-requirement") {
          summary.spec = {
            consistent: true,
            impact: "updated",
            trace: {
              requirements: ["REQ-MISSING-001"],
              scenarios: ["SCN-DELIVERY-001"],
              tests: ["test/features/delivery.feature"],
            },
          };
        } else if (kind === "unclassified-owner")
          summary.ownership.classified = false;
        else if (kind === "invalid-owner-layer")
          summary.ownership.targetLayer = "administrator";
        else throw new Error(`unknown fixture: ${kind}`);
        fs.writeFileSync(
          path.join(root, SUMMARY_PATH),
          JSON.stringify(summary),
        );
        fixtureGit(root, ["add", "."]);
        fixtureGit(root, ["commit", "-qm", "adversarial delivery declaration"]);
      },
      (staging) => {
        registerPlanningScenario(staging);
        if (
          kind === "backtick-docstring" ||
          kind === "quote-docstring" ||
          ["raw-backtick-docstring", "raw-background-docstring"].includes(kind)
        ) {
          const delimiter = kind === "quote-docstring" ? '"""' : "```";
          fs.appendFileSync(
            path.join(staging, "00_要求定義.md"),
            `\n${["raw-backtick-docstring", "raw-background-docstring"].includes(kind) ? "" : "~~~gherkin\n"}${kind === "raw-background-docstring" ? "Background: shared payload" : "Scenario: SCN-REAL-002 payload"}\n  Given a payload\n${delimiter}\nScenario: SCN-NOT-EXIST-001 payload is not a definition\n${delimiter}\n  Then it is checked\n${["raw-backtick-docstring", "raw-background-docstring"].includes(kind) ? "" : "~~~\n"}`,
          );
        }
      },
    );
    fixtureGit(this.prepared.root, ["checkout", "-qb", "feature/x"]);
    this.snapshot = snapshot(this);
  },
);
When("不正申告の要約でPRをpreviewする", async function () {
  try {
    await run(args(this));
    this.refusal = "";
  } catch (error) {
    this.refusal = error instanceof Error ? error.message : String(error);
    const expected: Record<string, RegExp> = {
      "spec-change-no-spec": /no-spec-impact.*正式docs\/specs変更/u,
      "nonexistent-scenario": /SCNが正式計画にありません/u,
      "scenario-reference": /SCNが正式計画にありません/u,
      "feature-reference": /SCNが固定test根拠にありません/u,
      "generic-comment": /SCNが正式計画にありません/u,
      "backtick-docstring": /SCNが正式計画にありません/u,
      "quote-docstring": /SCNが正式計画にありません/u,
      "raw-backtick-docstring": /SCNが正式計画にありません/u,
      "raw-background-docstring": /SCNが正式計画にありません/u,
      "missing-test-source": /通常Git blob/u,
      "self-reference": /自己参照/u,
      "missing-requirement": /要件IDが正式仕様にありません/u,
      "unclassified-owner": /ownership明示宣言/u,
      "invalid-owner-layer": /ownership明示宣言/u,
    };
    assert.match(this.refusal, expected[this.declarationCase]!);
  }
});
