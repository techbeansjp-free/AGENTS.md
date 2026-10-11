import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CANDIDATE_RISKS } from "../../src/domain/candidate-workflow.js";
import { runCandidateWorkerBoundary } from "../../src/adapters/candidate-worker-boundary.js";
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
    'const fs = require("node:fs"); if (!fs.readFileSync("src/label.js", "utf8").includes("Hello") || process.argv.includes("--fail")) process.exit(7);\n',
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

When("sessionのbaseと許可範囲を事後改ざんする", function () {
  const session = JSON.parse(fs.readFileSync(this.session, "utf8")) as Record<
    string,
    unknown
  >;
  session.baseSha = run(
    "git",
    ["rev-parse", "HEAD^"],
    this.candidate,
  ).stdout.trim();
  session.allowedPaths = ["src/label.js", "src/authorization.js"];
  fs.writeFileSync(this.session, `${JSON.stringify(session)}\n`);
});

Then("Git分岐点の再計算でbase改ざんを拒否する", function () {
  invoke(this, {
    phase: "post",
    gaps: [],
    targetTest: [process.execPath, "test.js"],
  });
  assert.equal(this.result?.status, 1);
  assert.ok(reasons(this).some((reason) => reason.includes("Git分岐点")));
});

When("sessionの許可範囲だけを事後改ざんする", function () {
  const session = JSON.parse(fs.readFileSync(this.session, "utf8")) as Record<
    string,
    unknown
  >;
  session.allowedPaths = ["src/label.js", "src/authorization.js"];
  fs.writeFileSync(this.session, `${JSON.stringify(session)}\n`);
});

Then("許可済みと偽装した認可差分も上流へ戻す", function () {
  const output = invoke(this, {
    phase: "post",
    gaps: [],
    targetTest: [process.execPath, "test.js"],
  });
  assert.equal(this.result?.status, 1);
  assert.equal(output.route, "upstream");
  assert.deepEqual(output.pendingResponsibilities, ["security-risk"]);
  assert.deepEqual(output.changedPaths, [
    "src/authorization.js",
    "src/label.js",
  ]);
});

function invokeExecute(
  world: CandidateSessionWorld,
  overrides: Record<string, unknown> = {},
) {
  const inputFile = path.join(world.home, "execute-input.json");
  const input = {
    phase: "execute",
    intent: "文言をHelloに修正",
    correctnessCriterion: "label === Hello",
    allowedPaths: ["src/label.js"],
    risk: Object.fromEntries(CANDIDATE_RISKS.map((risk) => [risk, "cleared"])),
    unresolved: [],
    workerArgv: [
      "/bin/sh",
      "-c",
      "printf '%s\\n' 'export const label = \"Hello\";' > src/label.js",
    ],
    targetTest: [process.execPath, "test.js"],
    gaps: [],
    ...overrides,
  };
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
      `--repo=${world.candidate}`,
    ],
    process.cwd(),
    { allowFailure: true, timeoutMs: 60_000 },
  );
  world.output = JSON.parse(world.result.stdout) as Record<string, unknown>;
  return world.output;
}

When("隔離Workerが低riskの文言だけを修正する", function () {
  invokeExecute(this);
});

Then("Coordinatorが差分と対象テストを観測し独立reviewへ送る", function () {
  if (this.result?.status !== 0) {
    // Codex sandbox is an optional host capability; its absence must fail closed.
    assert.ok(
      reasons(this).some((reason) => reason.includes("candidate Worker")),
      JSON.stringify(this.output),
    );
    assert.equal(
      run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim(),
      this.baseSha,
    );
    return;
  }
  assert.equal(this.output?.route, "independent-review");
  assert.equal(this.output?.workerBoundary, "host-enforced");
  assert.equal(this.output?.baseSha, this.baseSha);
  assert.deepEqual(this.output?.changedPaths, ["src/label.js"]);
  const test = this.output?.targetTest as Record<string, unknown>;
  assert.equal(test.exitCode, 0);
  assert.equal(test.formalEvidence, false);
  assert.equal(this.output?.authority, "none");
});

When("隔離WorkerがCoordinatorのsessionへ書き込もうとする", function () {
  invokeExecute(this, {
    workerArgv: [
      "/bin/sh",
      "-c",
      'printf attack >> "$1"',
      "worker",
      this.session,
    ],
  });
});

Then("Coordinatorの事前契約を変更できずcandidateをcommitしない", function () {
  assert.equal(this.result?.status, 1);
  assert.equal(
    run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim(),
    this.baseSha,
  );
  const session = JSON.parse(fs.readFileSync(this.session, "utf8")) as Record<
    string,
    unknown
  >;
  assert.equal(session.baseSha, this.baseSha);
  assert.ok(!fs.readFileSync(this.session, "utf8").includes("attack"));
});

When("事前判定で認可riskを未解決にする", function () {
  invokeExecute(this, {
    risk: Object.fromEntries(
      CANDIDATE_RISKS.map((risk) => [
        risk,
        risk === "authorization" ? "triggered" : "cleared",
      ]),
    ),
  });
});

Then("Worker起動前に上流へ戻してGitを変更しない", function () {
  assert.equal(this.result?.status, 1);
  assert.equal(this.output?.route, "upstream");
  assert.equal(
    run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim(),
    this.baseSha,
  );
  assert.equal(
    fs.readFileSync(path.join(this.candidate, "src", "label.js"), "utf8"),
    'export const label = "Helo";\n',
  );
});

When("隔離Workerが許可外の認可fileも変更する", function () {
  invokeExecute(this, {
    workerArgv: [
      "/bin/sh",
      "-c",
      "printf changed > src/label.js; printf disabled > src/authorization.js",
    ],
  });
});

Then("Coordinatorは許可外差分をcommitしない", function () {
  assert.equal(this.result?.status, 1);
  assert.equal(
    run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim(),
    this.baseSha,
  );
  if (
    fs.readFileSync(
      path.join(this.candidate, "src", "authorization.js"),
      "utf8",
    ) === "disabled"
  ) {
    assert.ok(reasons(this).some((reason) => reason.includes("許可範囲外")));
    assert.equal(
      run(
        "git",
        ["diff", "--cached", "--name-only"],
        this.candidate,
      ).stdout.trim(),
      "",
    );
    invokeExecute(this);
    assert.equal(this.result?.status, 1);
    assert.ok(reasons(this).some((reason) => reason.includes("未記録の変更")));
  } else assert.ok(reasons(this).some((reason) => reason.includes("Worker")));
});

When("隔離WorkerがGit metadataへ書き込もうとする", function () {
  invokeExecute(this, {
    workerArgv: ["/bin/sh", "-c", "printf attack >> .git"],
  });
});

Then("Git metadataは変更されずcandidateをcommitしない", function () {
  assert.equal(this.result?.status, 1);
  assert.equal(
    run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim(),
    this.baseSha,
  );
  assert.ok(
    !fs
      .readFileSync(path.join(this.candidate, ".git"), "utf8")
      .includes("attack"),
  );
});

When("隔離Workerが無視対象のfileを作る", function () {
  fs.writeFileSync(
    path.join(this.candidate, ".gitignore"),
    "src/generated.log\n",
  );
  run("git", ["add", ".gitignore"], this.candidate);
  run("git", ["commit", "-qm", "ignore generated"], this.candidate);
  this.baseSha = run(
    "git",
    ["rev-parse", "HEAD"],
    this.candidate,
  ).stdout.trim();
  run(
    "git",
    ["update-ref", "refs/remotes/origin/main", this.baseSha],
    this.primary,
  );
  run(
    "git",
    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    this.primary,
  );
  invokeExecute(this, {
    workerArgv: [
      "/bin/sh",
      "-c",
      "printf changed > src/label.js; printf hidden > src/generated.log",
    ],
  });
});

Then("ignored差分も拒否しcandidateをcommitしない", function () {
  assert.equal(this.result?.status, 1);
  assert.ok(
    reasons(this).some(
      (reason) =>
        reason.includes("Git ignored") ||
        reason.includes("candidate Worker隔離"),
    ),
    JSON.stringify(this.output),
  );
  assert.equal(
    run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim(),
    this.baseSha,
  );
});

When("Workerの書込pathの祖先を外部directoryへのsymlinkにする", function () {
  const external = path.join(this.home, "external");
  fs.mkdirSync(path.join(external, "nested"), { recursive: true });
  fs.writeFileSync(path.join(external, "nested", "label.js"), "outside\n");
  fs.symlinkSync(external, path.join(this.candidate, "src", "redirect"));
  assert.throws(
    () =>
      runCandidateWorkerBoundary({
        root: this.candidate,
        allowedPaths: ["src/redirect/nested/label.js"],
        argv: ["/bin/true"],
      }),
    /symlink祖先/,
  );
});

Then("外部directoryへ書込権限を付与しない", function () {
  assert.equal(
    fs.readFileSync(
      path.join(this.home, "external", "nested", "label.js"),
      "utf8",
    ),
    "outside\n",
  );
});

When("悪意あるcommit hookを設定して隔離Workerが文言を修正する", function () {
  const hookDirectory = path.join(this.home, "hooks");
  fs.mkdirSync(hookDirectory);
  fs.writeFileSync(
    path.join(hookDirectory, "pre-commit"),
    `#!/bin/sh\nprintf attack > '${path.join(this.home, "hook-ran")}'\nexit 8\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(hookDirectory, "reference-transaction"),
    `#!/bin/sh\nprintf attack > '${path.join(this.home, "ref-hook-ran")}'\nexit 8\n`,
    { mode: 0o755 },
  );
  run("git", ["config", "core.hooksPath", hookDirectory], this.candidate);
  invokeExecute(this);
});

Then("Coordinatorはhookを実行せず候補だけをcommitする", function () {
  if (this.result?.status !== 0) {
    assert.ok(
      reasons(this).some((reason) => reason.includes("candidate Worker")),
      JSON.stringify(this.output),
    );
    return;
  }
  assert.equal(this.output?.route, "independent-review");
  assert.equal(fs.existsSync(path.join(this.home, "hook-ran")), false);
  assert.equal(fs.existsSync(path.join(this.home, "ref-hook-ran")), false);
  assert.notEqual(
    run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim(),
    this.baseSha,
  );
});

When("不正な対象テストで隔離Workerを起動しようとする", function () {
  invokeExecute(this, { targetTest: [] });
});

Then("Workerは差分を作らずHEADも変わらない", function () {
  assert.equal(this.result?.status, 1);
  assert.equal(
    run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim(),
    this.baseSha,
  );
  assert.equal(
    fs.readFileSync(path.join(this.candidate, "src", "label.js"), "utf8"),
    'export const label = "Helo";\n',
  );
});

When("隔離Workerが許可fileを壊れたsymlinkにする", function () {
  invokeExecute(this, {
    workerArgv: [
      "/bin/sh",
      "-c",
      "rm src/label.js; ln -s missing-target src/label.js",
    ],
  });
});

Then("CoordinatorはsymlinkをindexとHEADへ採用しない", function () {
  assert.equal(this.result?.status, 1);
  assert.equal(
    run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim(),
    this.baseSha,
  );
  assert.equal(
    run(
      "git",
      ["diff", "--cached", "--name-only"],
      this.candidate,
    ).stdout.trim(),
    "",
  );
  assert.ok(
    reasons(this).some(
      (reason) => reason.includes("通常file") || reason.includes("Worker"),
    ),
  );
});
