import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CANDIDATE_RISKS } from "../../src/domain/candidate-workflow.js";
import { run, type ProcessResult } from "../../src/lib/process.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class CandidateSessionWorld extends WorkflowWorld {
  home = "";
  primary = "";
  candidate = "";
  session = "";
  baseSha = "";
  result?: ProcessResult;
  output?: Record<string, unknown>;
  rejectionReasons: string[] = [];
}
const { Given, When, Then } = stepDefinitions<CandidateSessionWorld>();

function invoke(
  world: CandidateSessionWorld,
  input: Record<string, unknown>,
  repo = world.candidate,
) {
  const inputFile = path.join(world.home, "candidate-input.json");
  fs.writeFileSync(inputFile, JSON.stringify(input));
  world.result = run(
    process.execPath,
    [
      "--import",
      "tsx",
      path.resolve("bin/agent-skill-chain.ts"),
      "workflow",
      "candidate",
      `--input=${inputFile}`,
      `--repo=${repo}`,
      `--session=${world.session}`,
    ],
    process.cwd(),
    { allowFailure: true, timeoutMs: 30_000 },
  );
  world.output = JSON.parse(world.result.stdout) as Record<string, unknown>;
  return world.output;
}

function reasons(world: CandidateSessionWorld): string[] {
  const result = world.output?.result as Record<string, unknown> | undefined;
  const diagnostic = result?.diagnostic as Record<string, unknown> | undefined;
  return (diagnostic?.reasons as string[] | undefined) ?? [];
}

Given("候補用の隔離dummyと事前sessionを作る", function () {
  this.rejectionReasons = [];
  this.home = this.temp("asc-candidate-dummy-");
  this.primary = path.join(this.home, "source");
  this.candidate = path.join(this.home, "candidate");
  this.session = path.join(this.home, "session.json");
  fs.mkdirSync(this.primary);
  run(
    "git",
    ["init", "-q", "-b", "main", "--object-format=sha1"],
    this.primary,
  );
  run("git", ["config", "user.name", "Candidate Dummy"], this.primary);
  run("git", ["config", "user.email", "dummy@example.invalid"], this.primary);
  fs.mkdirSync(path.join(this.primary, "src"));
  fs.writeFileSync(
    path.join(this.primary, "src", "label.js"),
    'export const label = "Helo";\n',
  );
  fs.writeFileSync(
    path.join(this.primary, "src", "authorization.js"),
    "export const authorized = true;\n",
  );
  fs.writeFileSync(
    path.join(this.primary, "test.js"),
    'if (process.argv.includes("--fail")) process.exit(7);\n',
  );
  run("git", ["add", "."], this.primary);
  run("git", ["commit", "-qm", "base"], this.primary);
  this.baseSha = run("git", ["rev-parse", "HEAD"], this.primary).stdout.trim();
  run(
    "git",
    ["worktree", "add", "-qb", "candidate", this.candidate, this.baseSha],
    this.primary,
  );
  const output = invoke(this, {
    phase: "preflight",
    intent: "文言をHelloに修正",
    correctnessCriterion: "label === Hello",
    allowedPaths: ["src/label.js"],
    risk: Object.fromEntries(CANDIDATE_RISKS.map((risk) => [risk, "cleared"])),
    unresolved: [],
  });
  assert.equal(this.result?.status, 0);
  assert.equal(output.route, "candidate");
  assert.equal(output.baseSha, this.baseSha);
});

When("dummyの文言修正をcommitする", function () {
  fs.writeFileSync(
    path.join(this.candidate, "src", "label.js"),
    'export const label = "Hello";\n',
  );
  run("git", ["commit", "-qam", "fix label"], this.candidate);
});

Then("対象テストの実行結果から独立review待ちになる", function () {
  const output = invoke(this, {
    phase: "post",
    gaps: [],
    targetTest: [process.execPath, "test.js"],
  });
  assert.equal(this.result?.status, 0);
  assert.equal(output.route, "independent-review");
  assert.equal(output.baseSha, this.baseSha);
  assert.deepEqual(output.changedPaths, ["src/label.js"]);
  const test = output.targetTest as Record<string, unknown>;
  assert.equal(test.exitCode, 0);
  assert.equal(test.formalEvidence, false);
});

When("後からbaseと許可範囲とテスト成功を申告する", function () {
  const head = run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim();
  for (const extra of [
    { baseSha: head },
    { allowedPaths: ["src/label.js", "src/authorization.js"] },
    { targetTestsPassed: true },
  ]) {
    invoke(this, {
      phase: "post",
      gaps: [],
      targetTest: [process.execPath, "test.js"],
      ...extra,
    });
    assert.equal(this.result?.status, 1);
    this.rejectionReasons.push(...reasons(this));
  }
});

Then("すべての自己申告を拒否する", function () {
  assert.equal(this.rejectionReasons.length, 3);
  assert.ok(
    this.rejectionReasons.every((reason) => reason.includes("自己申告")),
  );
});

When("dummyの認可処理へ想定外の変更をcommitする", function () {
  fs.writeFileSync(
    path.join(this.candidate, "src", "authorization.js"),
    "export const authorized = false;\n",
  );
  run("git", ["commit", "-qam", "unexpected authorization"], this.candidate);
});

Then("事前HEADから認可差分を検出し上流へ戻す", function () {
  const output = invoke(this, {
    phase: "post",
    gaps: [],
    targetTest: [process.execPath, "test.js"],
  });
  assert.equal(this.result?.status, 1);
  assert.equal(output.route, "upstream");
  assert.equal(output.baseSha, this.baseSha);
  assert.deepEqual(output.changedPaths, [
    "src/authorization.js",
    "src/label.js",
  ]);
  assert.deepEqual(output.pendingResponsibilities, ["security-risk"]);
});

Then("対象テストの失敗をCLIが観測する", function () {
  const output = invoke(this, {
    phase: "post",
    gaps: [],
    targetTest: [process.execPath, "test.js", "--fail"],
  });
  assert.equal(this.result?.status, 1);
  assert.equal(output.route, "repair");
  assert.equal((output.targetTest as Record<string, unknown>).exitCode, 7);
  assert.deepEqual(output.pendingResponsibilities, ["verification"]);
});

Then("失敗テストとセキュリティ不足を両方保持する", function () {
  const output = invoke(this, {
    phase: "post",
    gaps: ["requirement"],
    targetTest: [process.execPath, "test.js", "--fail"],
  });
  assert.equal(this.result?.status, 1);
  assert.equal(output.route, "upstream");
  assert.deepEqual(output.pendingResponsibilities, [
    "security-risk",
    "requirement",
    "verification",
  ]);
});

Then("別worktreeのsessionを使えない", function () {
  invoke(
    this,
    { phase: "post", gaps: [], targetTest: [process.execPath, "test.js"] },
    this.primary,
  );
  assert.equal(this.result?.status, 1);
  assert.ok(reasons(this).some((reason) => reason.includes("worktree")));
});

When("候補に未記録の変更を加える", function () {
  fs.writeFileSync(path.join(this.candidate, "untracked.txt"), "dirty\n");
});

Then("事後検分はdirtyなGitを拒否する", function () {
  invoke(this, {
    phase: "post",
    gaps: [],
    targetTest: [process.execPath, "test.js"],
  });
  assert.equal(this.result?.status, 1);
  assert.ok(reasons(this).some((reason) => reason.includes("未記録")));
});

Then("同じsessionを事前判定で上書きできない", function () {
  invoke(this, {
    phase: "preflight",
    intent: "文言をHelloに修正",
    correctnessCriterion: "label === Hello",
    allowedPaths: ["src/label.js"],
    risk: Object.fromEntries(CANDIDATE_RISKS.map((risk) => [risk, "cleared"])),
    unresolved: [],
  });
  assert.equal(this.result?.status, 1);
  assert.ok(reasons(this).some((reason) => reason.includes("EEXIST")));
});

When("sessionをsymlinkへ置き換える", function () {
  const backup = path.join(this.home, "session-backup.json");
  fs.renameSync(this.session, backup);
  fs.symlinkSync(backup, this.session);
});

Then("事後検分はsessionのsymlinkを拒否する", function () {
  invoke(this, {
    phase: "post",
    gaps: [],
    targetTest: [process.execPath, "test.js"],
  });
  assert.equal(this.result?.status, 1);
  assert.ok(reasons(this).some((reason) => reason.includes("ELOOP")));
});

Then("対象テスト中のtracked変更を拒否する", function () {
  invoke(this, {
    phase: "post",
    gaps: [],
    targetTest: [
      process.execPath,
      "-e",
      "require('fs').writeFileSync('src/label.js', 'export const label = 7;\\n')",
    ],
  });
  assert.equal(this.result?.status, 1);
  assert.ok(reasons(this).some((reason) => reason.includes("未記録")));
});

When("上限超過の事前Intentを与える", function () {
  fs.unlinkSync(this.session);
  invoke(this, {
    phase: "preflight",
    intent: "a".repeat(70_000),
    correctnessCriterion: "label === Hello",
    allowedPaths: ["src/label.js"],
    risk: Object.fromEntries(CANDIDATE_RISKS.map((risk) => [risk, "cleared"])),
    unresolved: [],
  });
});

Then("sessionは生成されず拒否される", function () {
  assert.equal(this.result?.status, 1);
  assert.ok(reasons(this).some((reason) => reason.includes("64 KiB")));
  assert.equal(fs.existsSync(this.session), false);
});
