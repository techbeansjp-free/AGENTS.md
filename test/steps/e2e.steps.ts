import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  WorkflowWorld,
  conformingPullRequestBody,
  stepDefinitions,
} from "../support/world.js";
import {
  createIssueStaging,
  recordStagingSync,
} from "../../src/domain/issue.js";
import { QUESTIONS } from "../../src/domain/mode.js";
import { appendWorkflowJournalEntry } from "../../src/adapters/workflow-journal.js";
import { WORKFLOW_STEPS } from "../../src/domain/workflow.js";
import {
  observeReviewDiff,
  recordReviewRound,
} from "../../src/adapters/review-session.js";
import { parseReviewRoundInput } from "../../src/domain/review-convergence.js";

interface E2eWorld extends WorkflowWorld {
  cliEnv: NodeJS.ProcessEnv;
  cliResult: ReturnType<typeof execute>;
  cliResults: Array<ReturnType<typeof execute>>;
  ghMarker: string;
  npxResults: Array<ReturnType<typeof executeNpx>>;
  prArgs: string[];
  prCwd: string;
  root: string;
}

const { Given, When, Then } = stepDefinitions<E2eWorld>();

function execute(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
) {
  const cli = path.resolve(
    process.cwd(),
    "dist",
    "bin",
    "agent-skill-chain.js",
  );
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    env,
  });
}

function executeNpx(args: string[], cwd: string) {
  return spawnSync("npx", ["--no-install", "agent-skill-chain", ...args], {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
}

When("project bootstrapをdry-runする", function () {
  this.cliResults = [
    execute([
      "project",
      "bootstrap",
      "--new-project",
      "--kind=cli",
      "--dry-run",
      `--root=${this.root}`,
    ]),
  ];
});
When("project bootstrapをapplyする", function () {
  this.cliResults.push(
    execute([
      "project",
      "bootstrap",
      "--new-project",
      "--kind=cli",
      "--apply",
      `--root=${this.root}`,
    ]),
  );
});
When("spec validate commandを実行する", function () {
  this.cliResults.push(execute(["spec", "validate", `--root=${this.root}`]));
});
Then("すべてのCLI終了codeは0である", function () {
  for (const result of this.cliResults)
    assert.equal(result.status, 0, result.stderr);
});

Given("pass済みreview、tests、specのPR引数がある", function () {
  this.root = this.temp();
  this.prCwd = this.initRepo();
  fs.mkdirSync(path.join(this.prCwd, ".agent-skill-chain", "policy"), {
    recursive: true,
  });
  fs.copyFileSync(
    path.resolve(".agent-skill-chain/policy/default.json"),
    path.join(this.prCwd, ".agent-skill-chain", "policy", "default.json"),
  );
  spawnSync("git", ["add", ".agent-skill-chain/policy/default.json"], {
    cwd: this.prCwd,
  });
  spawnSync("git", ["commit", "-q", "-m", "trusted policy floor"], {
    cwd: this.prCwd,
  });
  spawnSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], {
    cwd: this.prCwd,
  });
  spawnSync(
    "git",
    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    { cwd: this.prCwd },
  );
  const headResult = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: this.prCwd,
    encoding: "utf8",
  });
  assert.equal(headResult.status, 0, headResult.stderr);
  const headSha = headResult.stdout.trim();
  const evidence = path.join(this.root, "pr-evidence.json");
  fs.writeFileSync(
    evidence,
    `${JSON.stringify({
      headSha,
      review: { approved: true, headSha },
      tests: { passed: true, headSha, scenarioIds: ["SCN-E2E-002"] },
      spec: {
        consistent: true,
        headSha,
        impact: "updated",
        trace: {
          requirements: ["FR-01"],
          scenarios: ["SCN-E2E-002"],
          tests: ["test/features/e2e/cli.feature"],
        },
      },
    })}\n`,
  );
  const staging = createIssueStaging(this.prCwd, {
    title: "existing-pr-test",
    answers: Object.fromEntries(
      QUESTIONS.map((id) => [id, { answer: true, evidence: `${id}根拠` }]),
    ),
    requestedMode: "quick",
    now: new Date("2026-08-25T12:00:00.000Z"),
  }).path;
  const observedReviewDiff = observeReviewDiff(this.prCwd, headSha, headSha);
  const reviewSession = recordReviewRound({
    staging,
    round: parseReviewRoundInput({
      round: 1,
      previousRoundDigest: null,
      anchor: {
        scopeIds: ["SCOPE-E2E"],
        acceptanceCriteriaIds: ["AC-E2E-002"],
        invariantIds: ["INV-E2E"],
        diffBaseSha: headSha,
        initialHeadSha: headSha,
        initialDiffDigest: observedReviewDiff.digest,
      },
      candidateHeadSha: headSha,
      focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
      findings: [],
    }),
  });
  for (const stepNumber of [1, 4, 9, 10]) {
    const step = WORKFLOW_STEPS.find((item) => item.step === stepNumber);
    assert.ok(step);
    appendWorkflowJournalEntry({
      staging,
      entry: {
        step: stepNumber,
        skillId: step.skillId,
        mode: "quick",
        recordedAt: "2026-08-25T12:00:00.000Z",
        artifacts: [`artifact-${stepNumber}`],
        evidence: `step ${stepNumber}証拠`,
        ...(stepNumber === 10
          ? {
              reviewSession: {
                sessionId: reviewSession.sessionId,
                roundDigest: reviewSession.latestRoundDigest,
                headSha: reviewSession.latestCandidateHeadSha,
              },
            }
          : {}),
      },
    });
  }
  recordStagingSync(staging, {
    tracker: "https://github.com/o/r/issues/824",
    checkpoint: 4,
    syncedAt: "2026-08-25T13:00:00.000Z",
    bodyDigest: "a".repeat(64),
    readBackDigest: "a".repeat(64),
  });
  const prBodyFile = path.join(this.temp("asc-e2e-pr-body-"), "PR.md");
  fs.writeFileSync(
    prBodyFile,
    conformingPullRequestBody({
      title: "bugfix: 824を是正する",
      canonicalIssue: 824,
    }),
  );
  this.prArgs = [
    "pr",
    "create",
    "--repo=o/r",
    "--issue=824",
    "--head=x",
    "--base=main",
    `--head-sha=${headSha}`,
    `--evidence=${evidence}`,
    `--root=${this.prCwd}`,
    `--staging=${staging}`,
    `--body-file=${prBodyFile}`,
  ];
  const stubDirectory = this.temp("asc-gh-stub-");
  this.ghMarker = path.join(stubDirectory, "called");
  const stub = path.join(stubDirectory, "gh");
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(this.ghMarker)}, 'called')\nprocess.exit(99)\n`,
  );
  fs.chmodSync(stub, 0o755);
  this.cliEnv = {
    ...process.env,
    PATH: `${stubDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
  };
});
When("pr create commandをdry-runする", function () {
  this.cliResult = execute(
    [...this.prArgs, "--dry-run"],
    this.cliEnv,
    this.prCwd,
  );
});
When("authorizationなしでpr create commandをapplyする", function () {
  this.cliResult = execute(
    [...this.prArgs, "--apply"],
    this.cliEnv,
    this.prCwd,
  );
});
Then("CLI終了codeは0である", function () {
  assert.equal(this.cliResult.status, 0, this.cliResult.stderr);
});
Then("CLI終了codeは非0である", function () {
  assert.notEqual(this.cliResult.status, 0);
});
Then("diagnosticに明示authorization不足が含まれる", function () {
  assert.match(
    `${this.cliResult.stdout}\n${this.cliResult.stderr}`,
    /明示的な承認/u,
  );
});
Then("stdoutに{string}が含まれる", function (value: string) {
  assert.ok(
    this.cliResult.stdout.includes(value),
    `args=${JSON.stringify(this.prArgs)} stdout=${JSON.stringify(this.cliResult.stdout)} stderr=${JSON.stringify(this.cliResult.stderr)} pid=${this.cliResult.pid}`,
  );
});
Then("ghは呼ばれない", function () {
  assert.equal(fs.existsSync(this.ghMarker), false);
});

Given("local package binをnpxで解決できる空のconsumerがある", function () {
  this.root = this.temp("asc-npx-consumer-");
  const binDirectory = path.join(this.root, "node_modules", ".bin");
  fs.mkdirSync(binDirectory, { recursive: true });
  fs.symlinkSync(
    path.resolve("dist/bin/agent-skill-chain.js"),
    path.join(binDirectory, "agent-skill-chain"),
  );
  this.npxResults = [];
});
When("npx installをflagなしでpreviewする", function () {
  this.npxResults.push(
    executeNpx(["install", `--root=${this.root}`], this.root),
  );
});
Then("npx lifecycleの終了codeはすべて0である", function () {
  for (const result of this.npxResults)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
Then("previewではAGENTS.mdが作成されない", function () {
  assert.equal(fs.existsSync(path.join(this.root, "AGENTS.md")), false);
});
When("npx installとupdateをapplyしてdoctorを実行する", function () {
  this.npxResults.push(
    executeNpx(["install", `--root=${this.root}`, "--apply"], this.root),
  );
  this.npxResults.push(
    executeNpx(["update", `--root=${this.root}`, "--apply"], this.root),
  );
  this.npxResults.push(
    executeNpx(["doctor", `--root=${this.root}`], this.root),
  );
});
Then("managed asset recordが作成される", function () {
  assert.equal(
    fs.existsSync(
      path.join(this.root, ".agent-skill-chain", "managed-assets.json"),
    ),
    true,
  );
});
When("npx deleteをapplyする", function () {
  this.npxResults.push(
    executeNpx(["delete", `--root=${this.root}`, "--apply"], this.root),
  );
});
Then("managed asset recordが削除される", function () {
  assert.equal(
    fs.existsSync(
      path.join(this.root, ".agent-skill-chain", "managed-assets.json"),
    ),
    false,
  );
});
When("npx installへapplyとdry-runを同時指定する", function () {
  this.npxResults.push(
    executeNpx(
      ["install", `--root=${this.root}`, "--apply", "--dry-run"],
      this.root,
    ),
  );
});
Then("npx lifecycleの終了codeは非0である", function () {
  for (const result of this.npxResults) assert.notEqual(result.status, 0);
});
