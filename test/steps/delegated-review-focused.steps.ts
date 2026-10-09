import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import {
  launchDelegatedReview,
  type DelegatedReviewResult,
} from "../../src/adapters/delegated-review-launch.js";
import {
  advanceReviewSession,
  parseReviewSessionState,
  type ReviewRoundFinding,
} from "../../src/domain/review-convergence.js";
import { observeReviewDiff } from "../../src/adapters/review-diff.js";
import { computeImpactSet } from "../../src/adapters/impact-set.js";

interface FocusedWorld extends WorkflowWorld {
  root: string;
  staging: string;
  base: string;
  previous: string;
  head: string;
  prompts: string[];
  result: DelegatedReviewResult;
  driftSession: boolean;
}
const { Given, When, Then } = stepDefinitions<FocusedWorld>();
function git(root: string, args: string[]) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}
function write(root: string, files: Record<string, string>) {
  for (const [file, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), body);
  }
}
function commit(root: string, files: Record<string, string>) {
  write(root, files);
  git(root, ["add", "--", ...Object.keys(files)]);
  git(root, ["commit", "-qm", "fixture"]);
  return git(root, ["rev-parse", "HEAD"]);
}
function gitTrace(): string[][] {
  const file = process.env.ASC_FOCUSED_GIT_TRACE;
  return file && fs.existsSync(file)
    ? fs
        .readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[])
    : [];
}
function gitCounts(start: number) {
  const calls = gitTrace().slice(start);
  const nameCalls = calls.filter(
    (args) => args[0] === "diff" && args.includes("--name-only"),
  );
  const intervals = new Map<string, number>();
  for (const args of nameCalls) {
    const interval = args
      .flatMap((arg) => arg.split(".."))
      .filter((arg) => /^[a-f0-9]{40}$/u.test(arg))
      .join("..");
    intervals.set(interval, (intervals.get(interval) ?? 0) + 1);
  }
  return {
    total: calls.length,
    graphBlobBatches: calls.filter(
      (args) => args[0] === "cat-file" && args[1] === "--batch",
    ).length,
    diffNameOnly: nameCalls.length,
    uniqueNameOnlyRanges: intervals.size,
    maximumNameOnlyCallsPerRange: Math.max(0, ...intervals.values()),
  };
}
Given("focused委譲用の2つのblockerと大きな承認済み計画がある", function () {
  this.root = this.initRepo();
  this.driftSession = false;
  this.staging = ".agent-skill-chain/tmp/issues/focused";
  this.base = commit(this.root, {
    "src/lib.ts": "export const lib = () => 0;\n",
    "src/other.ts": "export const other = () => 0;\n",
    "src/caller.ts":
      'import { lib } from "./lib.js";\nexport const caller = () => lib();\n',
    "src/unrelated.ts": "export const unrelated = () => 0;\n",
    "test/support/world.ts": fs.readFileSync(
      new URL("../fixtures/delegated-review-focused/world.ts", import.meta.url),
      "utf8",
    ),
    "test/steps/app.steps.ts":
      'import { AppWorld, stepDefinitions } from "../support/world.js";\nimport { caller } from "../../src/caller.js";\nconst { Given } = stepDefinitions<AppWorld>();\nGiven("app runs", () => caller());\n',
    "test/features/app.feature":
      "Feature: app\n  Scenario: SCN-FIXTURE-001 app\n    Given app runs\n",
  });
  this.previous = commit(this.root, {
    "src/lib.ts": "export const lib = () => 1;\n",
    "src/other.ts": "export const other = () => 1;\n",
    "src/unrelated.ts": "export const unrelated = () => 1;\n",
  });
  const findings: ReviewRoundFinding[] = ["src/lib.ts", "src/other.ts"].map(
    (file, i) => ({
      id: `BLOCK-${i + 1}`,
      severity: "High",
      status: "valid",
      source: "review",
      relation: "acceptance-violation",
      evidence: `blocker evidence ${i + 1}`,
      path: file,
      contractId: "AC-001",
      causedByFindingId: null,
    }),
  );
  findings.push({
    ...findings[0]!,
    id: "MEDIUM-UNRELATED",
    severity: "Medium",
    relation: "improvement",
    path: "src/unrelated.ts",
    contractId: null,
  });
  const session = advanceReviewSession(null, {
    round: 1,
    previousRoundDigest: null,
    anchor: {
      scopeIds: ["SCOPE-001"],
      acceptanceCriteriaIds: ["AC-001"],
      invariantIds: [],
      diffBaseSha: this.base,
      initialHeadSha: this.previous,
      initialDiffDigest: observeReviewDiff(this.root, this.base, this.previous)
        .digest,
    },
    candidateHeadSha: this.previous,
    focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
    findings,
  });
  write(this.root, {
    [`${this.staging}/review-session.json`]: JSON.stringify(session),
    [`${this.staging}/00_要求定義.md`]:
      "# ACCEPTED_FULL_PLAN\nAC-001\n" + "accepted plan details\n".repeat(6000),
    ".agent-skill-chain/local/supplemental-review.json": JSON.stringify({
      enabled: true,
      provider: "ollama",
      model: "fixture",
      endpoint: "http://127.0.0.1:11434",
    }),
  });
  this.head = commit(this.root, {
    "src/lib.ts": "export const lib = () => 2;\n",
  });
});
Given("focused委譲の影響を証明できない設定変更を含める", function () {
  this.head = commit(this.root, {
    "package.json": '{"name":"fixture","private":true}\n',
  });
});
Given("focused委譲の隣接fileが収集上限を超える", function () {
  const files: Record<string, string> = {};
  for (let i = 0; i < 21; i++)
    files[`src/consumer${i}.ts`] =
      'import { lib } from "./lib.js";\nexport const consumer = () => lib();\n';
  // Add consumers to the reviewed head so the repair itself remains targeted.
  const original = this.head;
  this.head = commit(this.root, files);
  const sessionFile = path.join(this.root, this.staging, "review-session.json");
  const old = parseReviewSessionState(
    JSON.parse(fs.readFileSync(sessionFile, "utf8")),
  );
  const anchor = {
    ...old.anchor,
    initialHeadSha: this.head,
    initialDiffDigest: observeReviewDiff(this.root, this.base, this.head)
      .digest,
  };
  const session = advanceReviewSession(null, {
    round: 1,
    previousRoundDigest: null,
    anchor,
    candidateHeadSha: this.head,
    focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
    findings: old.rounds[0]!.findings.map(
      ({ admission: _a, admissionReason: _r, ...f }) => f,
    ),
  });
  fs.writeFileSync(sessionFile, JSON.stringify(session));
  this.previous = this.head;
  this.head = commit(this.root, {
    "src/lib.ts": `export const lib = () => 3; // ${original}\n`,
  });
});
Given("focused委譲の比較基点がsessionと異なる", function () {
  this.base = this.previous;
});
Given("focused委譲をRound 1として起動する", function () {
  fs.unlinkSync(path.join(this.root, this.staging, "review-session.json"));
});
Given("focused委譲の実行中にsessionが変わる", function () {
  this.driftSession = true;
});
Given("focused委譲の差分がbyte上限を超える", function () {
  this.head = commit(this.root, {
    "src/lib.ts": "export const lib = () => 2;\n" + "// large\n".repeat(140000),
  });
});
Given("focused委譲の前回HEADが今回HEADのancestorではない", function () {
  const sessionFile = path.join(this.root, this.staging, "review-session.json");
  const previous = parseReviewSessionState(
    JSON.parse(fs.readFileSync(sessionFile, "utf8")),
  );
  const sibling = git(this.root, [
    "commit-tree",
    `${this.previous}^{tree}`,
    "-p",
    this.base,
    "-m",
    "sibling",
  ]);
  const session = advanceReviewSession(null, {
    round: 1,
    previousRoundDigest: null,
    anchor: {
      ...previous.anchor,
      initialHeadSha: sibling,
      initialDiffDigest: observeReviewDiff(this.root, this.base, sibling)
        .digest,
    },
    candidateHeadSha: sibling,
    focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
    findings: previous.rounds[0]!.findings.map(
      ({ admission: _a, admissionReason: _r, ...finding }) => finding,
    ),
  });
  fs.writeFileSync(sessionFile, JSON.stringify(session));
});
When("同じHEADのfocused委譲入力をcaptureする", async function () {
  this.prompts = [];
  const input = {
    root: this.root,
    stagingPath: this.staging,
    step: 10 as const,
    baseSha: this.base,
    headSha: this.head,
    globalConfigHome: path.join(this.root, "empty-config"),
  };
  const execute = async ({ prompt }: { prompt: string }) => {
    this.prompts.push(prompt);
    if (this.driftSession)
      fs.writeFileSync(
        path.join(this.root, this.staging, "review-session.json"),
        "{}",
      );
    return {
      state: "succeeded" as const,
      reason: "fixture",
      output: JSON.stringify({
        decision: "approved",
        affirmative: "修正を確認",
        adversarial: "隣接回帰を確認",
        findings: [],
      }),
    };
  };
  const currentStart = gitTrace().length;
  this.result = await launchDelegatedReview(input, { execute });
  if (
    process.env.ASC_FOCUSED_BASELINE_LAUNCH &&
    this.result.state === "needs_coordinator_review" &&
    this.prompts.join("\n").includes("focused review")
  ) {
    const current = {
      bytes: this.prompts.reduce((n, p) => n + Buffer.byteLength(p), 0),
      chunks: this.prompts.length,
      gitCalls: gitCounts(currentStart),
    };
    const baselinePrompts: string[] = [];
    const baseline = (await import(
      pathToFileURL(process.env.ASC_FOCUSED_BASELINE_LAUNCH).href
    )) as { launchDelegatedReview: typeof launchDelegatedReview };
    const baselineStart = gitTrace().length;
    const result = await baseline.launchDelegatedReview(input, {
      execute: async ({ prompt }: { prompt: string }) => {
        baselinePrompts.push(prompt);
        return {
          state: "succeeded",
          reason: "fixture",
          output: JSON.stringify({
            decision: "approved",
            affirmative: "修正を確認",
            adversarial: "隣接回帰を確認",
            findings: [],
          }),
        };
      },
    });
    assert.equal(result.state, "needs_coordinator_review");
    fs.writeFileSync(
      process.env.ASC_FOCUSED_METRICS!,
      JSON.stringify({
        baseline: {
          bytes: baselinePrompts.reduce((n, p) => n + Buffer.byteLength(p), 0),
          chunks: baselinePrompts.length,
          gitCalls: gitCounts(baselineStart),
        },
        current,
      }),
    );
  }
});
Then(
  "focused委譲の1入力に両blockerと隣接対象があり全計画と無関係Mediumがない",
  function () {
    assert.equal(this.result.state, "needs_coordinator_review");
    assert.equal(this.prompts.length, 1);
    const impact = computeImpactSet({
      root: this.root,
      baseSha: this.previous,
      headSha: this.head,
    });
    assert.equal(impact.mode, "targeted");
    assert.deepEqual(impact.features, ["test/features/app.feature"]);
    const prompt = this.prompts[0]!;
    for (const text of [
      "focused review",
      "BLOCK-1",
      "BLOCK-2",
      "src/other.ts",
      "src/caller.ts",
      "肯定・敵対",
      `${this.previous}..${this.head}`,
      "adjacentScope",
    ])
      assert.ok(prompt.includes(text), text);
    for (const text of [
      "ACCEPTED_FULL_PLAN",
      "MEDIUM-UNRELATED",
      "src/unrelated.ts",
    ])
      assert.ok(!prompt.includes(text), text);
  },
);
Then("complete委譲には承認済み計画と全差分がある", function () {
  assert.equal(this.result.state, "needs_coordinator_review");
  const prompts = this.prompts.join("\n");
  assert.ok(prompts.includes("complete review"));
  assert.ok(prompts.includes("ACCEPTED_FULL_PLAN"));
  assert.ok(prompts.includes(`${this.base}..${this.head}`));
});
Then("focused委譲は入力不成立としてexecutorを起動しない", function () {
  assert.equal(this.result.state, "degraded");
  assert.equal(this.prompts.length, 0);
});
Then("focused委譲はsession変更後の応答を破棄する", function () {
  assert.equal(this.result.state, "degraded");
  assert.equal(this.prompts.length, 1);
});
When("focused隣接fileと前blockerへの新findingをcaptureする", async function () {
  this.prompts = [];
  this.result = await launchDelegatedReview(
    {
      root: this.root,
      stagingPath: this.staging,
      step: 10,
      baseSha: this.base,
      headSha: this.head,
      globalConfigHome: path.join(this.root, "empty-config"),
    },
    {
      execute: async ({ prompt }) => {
        this.prompts.push(prompt);
        if (prompt.includes("投稿前の独立したfinding検証者"))
          return { state: "failed", reason: "fixture: coordinator verifies" };
        return {
          state: "succeeded",
          reason: "fixture",
          output: JSON.stringify({
            decision: "changes_requested",
            affirmative: "修正を確認",
            adversarial: "隣接回帰を確認",
            findings: [
              {
                file: "src/caller.ts",
                location: "2",
                content: "隣接regression",
                severity: "High",
              },
              {
                file: "src/other.ts",
                location: "1",
                content: "前blockerの別の欠陥",
                severity: "High",
              },
              {
                file: "src/unrelated.ts",
                location: "1",
                content: "無関係な改善",
                severity: "Medium",
              },
            ],
          }),
        };
      },
    },
  );
});
Then(
  "隣接回帰と前blockerの新findingを保持し無関係Mediumを除外する",
  function () {
    assert.equal(this.result.state, "needs_coordinator_review");
    if (this.result.state !== "needs_coordinator_review") return;
    assert.deepEqual(
      this.result.findings.map(({ file }) => file),
      ["src/caller.ts", "src/other.ts"],
    );
    assert.equal(this.result.ignoredOutOfScopeCount, 1);
  },
);
