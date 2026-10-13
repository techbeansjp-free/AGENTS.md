import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CANDIDATE_RISKS } from "../../src/domain/candidate-workflow.js";
import {
  codexCandidateEnvironment,
  parseCodexCandidateUsage,
  runCandidateCodexWorker,
} from "../../src/adapters/candidate-codex-worker.js";
import {
  createIssueStaging,
  recordStagingSync,
} from "../../src/domain/issue.js";
import {
  appendWorkflowJournalEntry,
  readWorkflowJournal,
  promoteWorkflowStagingToFull,
} from "../../src/adapters/workflow-journal.js";
import {
  finalizeCandidateWorkerBoundary,
  runCandidateWorkerBoundary,
  workerExecutable,
} from "../../src/adapters/candidate-worker-boundary.js";
import { run, type ProcessResult } from "../../src/lib/process.js";
import {
  buildReviewRoundDraft,
  readStoredReviewSession,
  recordReviewRound,
} from "../../src/adapters/review-session.js";
import { observeWorkflowExecutionPlan } from "../../src/adapters/workflow-execution-plan.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class CandidateSessionWorld extends WorkflowWorld {
  home = "";
  staging = "";
  primary = "";
  candidate = "";
  sourceCandidate = "";
  session = "";
  baseSha = "";
  result?: ProcessResult;
  output?: Record<string, unknown>;
  rejectionReasons: string[] = [];
  adoptionPlan?: ReturnType<typeof observeWorkflowExecutionPlan>;
  authEnvironment?: ReturnType<typeof codexCandidateEnvironment>;
  boundaryResult?: ReturnType<typeof runCandidateWorkerBoundary>;
  resolvedExecutable?: string;
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

function lacksHostIsolation(world: CandidateSessionWorld): boolean {
  return reasons(world).some(
    (reason) =>
      reason.includes("candidate Worker隔離にはCodex sandboxが必要です") ||
      reason.includes("host隔離を起動できません") ||
      reason.includes("このhostで強制できません"),
  );
}

Given("候補用の隔離dummyと事前sessionを作る", function () {
  this.rejectionReasons = [];
  this.home = this.temp("asc-candidate-dummy-");
  this.primary = path.join(this.home, "source");
  this.candidate = path.join(this.home, "candidate");
  this.sourceCandidate = this.candidate;
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
    path.join(this.primary, "src", "secondary.js"),
    "export const secondary = true;\n",
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

When("認可pathを低riskと誤申告する", function () {
  this.session = path.join(this.home, "unsafe-session.json");
  invoke(this, {
    phase: "preflight",
    intent: "認可処理を変更する",
    correctnessCriterion: "既存の認可testが通る",
    allowedPaths: ["src/authorization.js"],
    risk: Object.fromEntries(CANDIDATE_RISKS.map((risk) => [risk, "cleared"])),
    unresolved: [],
  });
});

Then("新しいCandidate sessionを作らず上流へ戻す", function () {
  assert.equal(this.result?.status, 1);
  assert.equal(this.output?.route, "upstream");
  assert.equal(fs.existsSync(this.session), false);
  assert.equal(
    run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim(),
    this.baseSha,
  );
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
  environment: NodeJS.ProcessEnv = process.env,
  compiled = false,
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
      ...(compiled
        ? [path.resolve("dist/bin/agent-skill-chain.js")]
        : ["--import", "tsx", path.resolve("bin/agent-skill-chain.ts")]),
      "workflow",
      "candidate",
      `--input=${inputFile}`,
      `--repo=${world.candidate}`,
    ],
    process.cwd(),
    { allowFailure: true, timeoutMs: 60_000, env: environment },
  );
  world.output = JSON.parse(world.result.stdout) as Record<string, unknown>;
  if (typeof world.output.candidateWorktree === "string")
    world.candidate = world.output.candidateWorktree;
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
  assert.equal(
    run("git", ["symbolic-ref", "-q", "HEAD"], this.candidate, {
      allowFailure: true,
    }).status,
    1,
  );
  assert.equal(
    run(
      "git",
      ["rev-parse", "refs/heads/candidate"],
      this.candidate,
    ).stdout.trim(),
    this.baseSha,
  );
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
  assert.equal(
    fs.readFileSync(
      path.join(this.candidate, "src", "authorization.js"),
      "utf8",
    ),
    "export const authorized = true;\n",
  );
  assert.equal(
    fs.readFileSync(path.join(this.candidate, "src", "label.js"), "utf8"),
    'export const label = "Helo";\n',
  );
  assert.equal(
    run("git", ["status", "--porcelain"], this.candidate).stdout.trim(),
    "",
  );
  assert.ok(
    reasons(this).some(
      (reason) =>
        reason.includes("許可範囲外") || reason.includes("candidate Worker"),
    ),
  );
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
    path.join(hookDirectory, "post-index-change"),
    `#!/bin/sh\nprintf attack > '${path.join(this.home, "index-hook-ran")}'\nexit 8\n`,
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
  assert.equal(fs.existsSync(path.join(this.home, "hook-ran")), false);
  assert.equal(fs.existsSync(path.join(this.home, "ref-hook-ran")), false);
  assert.equal(fs.existsSync(path.join(this.home, "index-hook-ran")), false);
  if (this.result?.status !== 0) {
    if (lacksHostIsolation(this)) return "skipped";
    assert.fail(JSON.stringify(this.output));
  }
  assert.equal(this.output?.route, "independent-review");
  assert.equal(fs.existsSync(path.join(this.home, "hook-ran")), false);
  assert.equal(fs.existsSync(path.join(this.home, "ref-hook-ran")), false);
  assert.equal(fs.existsSync(path.join(this.home, "index-hook-ran")), false);
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

When(
  "悪意あるGit clean filterを設定して隔離Workerを起動しようとする",
  function () {
    const infoPath = run(
      "git",
      ["rev-parse", "--git-path", "info/attributes"],
      this.candidate,
    ).stdout.trim();
    fs.writeFileSync(
      path.isAbsolute(infoPath)
        ? infoPath
        : path.resolve(this.candidate, infoPath),
      "src/label.js filter=attack\n",
    );
    run(
      "git",
      [
        "config",
        "filter.attack.clean",
        `sh -c 'cat; touch ${path.join(this.home, "filter-ran")}'`,
      ],
      this.candidate,
    );
    invokeExecute(this);
  },
);

Then("Coordinatorはfilterを実行せず候補を変更しない", function () {
  assert.equal(this.result?.status, 1);
  assert.equal(fs.existsSync(path.join(this.home, "filter-ran")), false);
  assert.equal(
    run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim(),
    this.baseSha,
  );
  assert.equal(
    fs.readFileSync(path.join(this.candidate, "src", "label.js"), "utf8"),
    'export const label = "Helo";\n',
  );
});

When("commit内のfilter属性をassume-unchangedで隠して候補実行する", function () {
  const attribute = path.join(this.candidate, ".gitattributes");
  fs.writeFileSync(attribute, "src/label.js filter=attack\n");
  run("git", ["add", ".gitattributes"], this.candidate);
  run("git", ["commit", "-qm", "add attributes"], this.candidate);
  this.baseSha = run(
    "git",
    ["rev-parse", "HEAD"],
    this.candidate,
  ).stdout.trim();
  run(
    "git",
    ["update-index", "--assume-unchanged", ".gitattributes"],
    this.candidate,
  );
  fs.writeFileSync(attribute, "# harmless working copy\n");
  run(
    "git",
    [
      "config",
      "filter.attack.smudge",
      `sh -c 'cat; touch ${path.join(this.home, "hidden-filter-ran")}'`,
    ],
    this.candidate,
  );
  invokeExecute(this);
});

Then("Coordinatorは隠された属性を拒否しfilterを起動しない", function () {
  assert.equal(this.result?.status, 1);
  assert.ok(
    reasons(this).some(
      (reason) => reason.includes("Git属性file") || reason.includes("隠蔽flag"),
    ),
  );
  assert.equal(fs.existsSync(path.join(this.home, "hidden-filter-ran")), false);
  assert.equal(
    run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim(),
    this.baseSha,
  );
});

When("Workerが先頭の許可fileと巨大な後続fileを変更する", function () {
  invokeExecute(this, {
    allowedPaths: ["src/label.js", "src/secondary.js"],
    workerArgv: [
      "/bin/sh",
      "-c",
      "printf denied > src/secondary.js; dd if=/dev/zero of=src/label.js bs=1048576 count=17 2>/dev/null",
    ],
  });
});

Then("Coordinatorは全payloadを検査して元候補をcleanに保つ", function () {
  assert.equal(this.result?.status, 1);
  assert.equal(
    run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim(),
    this.baseSha,
  );
  assert.equal(
    run("git", ["status", "--porcelain"], this.candidate).stdout.trim(),
    "",
  );
  assert.equal(
    fs.readFileSync(path.join(this.candidate, "src", "label.js"), "utf8"),
    'export const label = "Helo";\n',
  );
  assert.equal(
    fs.readFileSync(path.join(this.candidate, "src", "secondary.js"), "utf8"),
    "export const secondary = true;\n",
  );
  if (lacksHostIsolation(this)) return "skipped";
  assert.ok(
    reasons(this).some((reason) => reason.includes("size上限")),
    JSON.stringify(this.output),
  );
});

When(
  "Workerが一時worktreeの書込directoryを読み取り専用にして失敗する",
  function () {
    invokeExecute(this, {
      workerArgv: ["/bin/sh", "-c", "chmod 0555 src; exit 8"],
    });
  },
);

Then("Coordinatorは一時worktree登録を片付け元候補をcleanに保つ", function () {
  assert.equal(this.result?.status, 1);
  assert.equal(
    run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim(),
    this.baseSha,
  );
  assert.equal(
    run("git", ["status", "--porcelain"], this.candidate).stdout.trim(),
    "",
  );
  const registered = run(
    "git",
    ["worktree", "list", "--porcelain"],
    this.candidate,
  ).stdout;
  assert.equal(
    registered.split("\n").filter((line) => line.startsWith("worktree "))
      .length,
    2,
  );
  if (lacksHostIsolation(this)) return "skipped";
  assert.ok(
    reasons(this).some((reason) => reason.includes("candidate Workerが失敗")),
    JSON.stringify(this.output),
  );
});

When("元候補の許可fileをassume-unchangedで隠してWorkerを起動する", function () {
  run(
    "git",
    ["update-index", "--assume-unchanged", "src/label.js"],
    this.candidate,
  );
  fs.writeFileSync(
    path.join(this.candidate, "src", "label.js"),
    "private edit\n",
  );
  invokeExecute(this);
});

Then("Coordinatorは隠された元fileを保持しWorkerを起動しない", function () {
  assert.equal(this.result?.status, 1);
  assert.ok(reasons(this).some((reason) => reason.includes("隠蔽flag")));
  assert.equal(
    fs.readFileSync(path.join(this.candidate, "src", "label.js"), "utf8"),
    "private edit\n",
  );
  assert.equal(
    run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim(),
    this.baseSha,
  );
});

When("元候補の許可fileにskip-worktreeを設定してWorkerを起動する", function () {
  run(
    "git",
    ["update-index", "--skip-worktree", "src/label.js"],
    this.candidate,
  );
  invokeExecute(this);
});

Then("Coordinatorは隠蔽index flagを拒否する", function () {
  assert.equal(this.result?.status, 1);
  assert.ok(reasons(this).some((reason) => reason.includes("隠蔽flag")));
  assert.equal(
    run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim(),
    this.baseSha,
  );
});

When("WorkerがTMPDIR内のdirectoryを読取専用にして失敗する", function () {
  invokeExecute(this, {
    workerArgv: [
      "/bin/sh",
      "-c",
      'mkdir "$TMPDIR/locked"; printf x > "$TMPDIR/locked/file"; chmod 0555 "$TMPDIR/locked"; printf "%s" "$TMPDIR" >&2; exit 8',
    ],
  });
});

Then("CoordinatorはWorker runtimeを削除し失敗を保持する", function () {
  assert.equal(this.result?.status, 1);
  assert.equal(
    run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim(),
    this.baseSha,
  );
  assert.equal(
    run("git", ["status", "--porcelain"], this.candidate).stdout.trim(),
    "",
  );
  const detail = reasons(this).join("\n");
  if (lacksHostIsolation(this)) return "skipped";
  assert.ok(detail.includes("candidate Workerが失敗"), detail);
  const runtime = detail.match(
    /\/tmp\/asc-candidate-worker-[A-Za-z0-9]+/u,
  )?.[0];
  assert.ok(runtime, detail);
  assert.equal(fs.existsSync(runtime), false);
});

Given("cleanup診断用の観測を準備する", function () {
  this.rejectionReasons = [];
});

When("runtime cleanup失敗とWorker終了値の観測を合成する", function () {
  try {
    finalizeCandidateWorkerBoundary({
      result: {
        boundary: "host-enforced",
        status: 8,
        stdout: "",
        stderr: "worker failed",
      },
      primaryError: undefined,
      cleanupErrors: [new Error("permission denied")],
    });
    assert.fail("cleanup失敗が拒否されませんでした");
  } catch (error) {
    assert.ok(error instanceof AggregateError);
    this.rejectionReasons = [error.message, ...error.errors.map(String)];
  }
});

Then("診断にWorker終了値とcleanup失敗が両方残る", function () {
  const detail = this.rejectionReasons.join("\n");
  assert.match(detail, /終了値8/u);
  assert.match(detail, /worker failed/u);
  assert.match(detail, /permission denied/u);
});

When("Workerが各fileは上限内だが合計が上限超過の差分を作る", function () {
  for (let index = 0; index < 5; index += 1)
    fs.writeFileSync(
      path.join(this.primary, "src", `payload-${index}.bin`),
      "base\n",
    );
  run("git", ["add", "."], this.primary);
  run("git", ["commit", "-qm", "add payload fixtures"], this.primary);
  this.baseSha = run("git", ["rev-parse", "HEAD"], this.primary).stdout.trim();
  run("git", ["reset", "--hard", this.baseSha], this.candidate);
  invokeExecute(this, {
    allowedPaths: Array.from(
      { length: 5 },
      (_, index) => `src/payload-${index}.bin`,
    ),
    workerArgv: [
      "/bin/sh",
      "-c",
      "for i in 0 1 2 3 4; do dd if=/dev/zero of=src/payload-$i.bin bs=1048576 count=15 2>/dev/null; done",
    ],
  });
});

Then("Coordinatorは合計sizeを拒否し元候補をcleanに保つ", function () {
  assert.equal(this.result?.status, 1);
  assert.equal(
    run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim(),
    this.baseSha,
  );
  assert.equal(
    run("git", ["status", "--porcelain"], this.candidate).stdout.trim(),
    "",
  );
  for (let index = 0; index < 5; index += 1)
    assert.equal(
      fs.readFileSync(
        path.join(this.candidate, "src", `payload-${index}.bin`),
        "utf8",
      ),
      "base\n",
    );
  if (lacksHostIsolation(this)) return "skipped";
  assert.ok(
    reasons(this).some((reason) => reason.includes("size上限")),
    JSON.stringify(this.output),
  );
});

function candidateGitFaultEnvironment(
  world: CandidateSessionWorld,
  command: "commit-tree" | "result-worktree",
  action: string,
): NodeJS.ProcessEnv {
  const shimDir = path.join(world.home, `fault-bin-${command}`);
  fs.mkdirSync(shimDir);
  const matcher =
    command === "commit-tree"
      ? '*" commit-tree "*'
      : '*" worktree add "*".asc-candidate-result-"*';
  fs.writeFileSync(
    path.join(shimDir, "git"),
    `#!/bin/sh\ncase " $* " in ${matcher}) ${action};; esac\nexec /usr/bin/git "$@"\n`,
    { mode: 0o755 },
  );
  return {
    ...process.env,
    PATH: `${shimDir}${path.delimiter}${process.env.PATH}`,
  };
}

When("Coordinatorのcommit-tree失敗を注入する", function () {
  invokeExecute(
    this,
    {},
    candidateGitFaultEnvironment(this, "commit-tree", "exit 73"),
  );
});

When("Coordinatorの出力worktree生成失敗を注入する", function () {
  invokeExecute(
    this,
    {},
    candidateGitFaultEnvironment(this, "result-worktree", "exit 73"),
  );
});

When("Coordinatorの出力生成中に元HEADを移動する", function () {
  fs.writeFileSync(
    path.join(this.primary, "src", "other.js"),
    "export const other = true;\n",
  );
  run("git", ["add", "src/other.js"], this.primary);
  run("git", ["commit", "-qm", "concurrent move"], this.primary);
  const movedSha = run(
    "git",
    ["rev-parse", "HEAD"],
    this.primary,
  ).stdout.trim();
  this.rejectionReasons = [movedSha];
  invokeExecute(
    this,
    {},
    candidateGitFaultEnvironment(
      this,
      "result-worktree",
      `/usr/bin/git -C '${this.sourceCandidate}' -c core.hooksPath=/dev/null update-ref --no-deref HEAD ${movedSha} ${this.baseSha}`,
    ),
  );
});

When("Coordinatorの出力生成中に元fileを編集する", function () {
  invokeExecute(
    this,
    {},
    candidateGitFaultEnvironment(
      this,
      "result-worktree",
      `printf '%s\\n' 'export const label = "Concurrent edit";' > '${path.join(this.sourceCandidate, "src", "label.js")}'`,
    ),
  );
});

Then("Coordinatorは元候補のHEAD・index・fileを保持する", function () {
  assert.equal(this.result?.status, 1);
  assert.equal(
    run("git", ["rev-parse", "HEAD"], this.sourceCandidate).stdout.trim(),
    this.baseSha,
  );
  assert.equal(
    run("git", ["status", "--porcelain"], this.sourceCandidate).stdout.trim(),
    "",
  );
  assert.equal(
    fs.readFileSync(path.join(this.sourceCandidate, "src", "label.js"), "utf8"),
    'export const label = "Helo";\n',
  );
  if (lacksHostIsolation(this)) return "skipped";
  assert.ok(
    reasons(this).some((reason) => reason.includes("73")),
    JSON.stringify(this.output),
  );
});

Then("Coordinatorは元HEAD変更を保持し出力を拒否する", function () {
  assert.equal(this.result?.status, 1);
  if (lacksHostIsolation(this)) return "skipped";
  assert.equal(
    run("git", ["rev-parse", "HEAD"], this.sourceCandidate).stdout.trim(),
    this.rejectionReasons[0],
  );
  assert.equal(this.output?.candidateWorktree, undefined);
});

Then("Coordinatorは元file変更を保持し出力を拒否する", function () {
  assert.equal(this.result?.status, 1);
  if (lacksHostIsolation(this)) return "skipped";
  assert.equal(
    fs.readFileSync(path.join(this.sourceCandidate, "src", "label.js"), "utf8"),
    'export const label = "Concurrent edit";\n',
  );
  assert.equal(this.output?.candidateWorktree, undefined);
});

When("対象テストが失敗する候補実装を実行する", function () {
  invokeExecute(this, { targetTest: [process.execPath, "test.js", "--fail"] });
});

Then("失敗したcommitを同じ候補worktreeの新規executeへ流用しない", function () {
  if (this.output?.route !== "repair") {
    assert.equal(this.result?.status, 1);
    if (lacksHostIsolation(this)) return "skipped";
    assert.fail(JSON.stringify(this.output));
  }
  assert.equal(this.result?.status, 1);
  assert.equal(
    (this.output?.targetTest as Record<string, unknown>).exitCode,
    7,
  );
  assert.notEqual(
    run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim(),
    this.baseSha,
  );
  invokeExecute(this);
  assert.equal(this.result?.status, 1);
  assert.ok(
    reasons(this).some((reason) => reason.includes("Git分岐点")),
    JSON.stringify(this.output),
  );
});

Then("Coordinatorは元候補を維持し別worktreeへcommitを公開する", function () {
  if (this.result?.status !== 0) {
    assert.equal(this.result?.status, 1);
    if (lacksHostIsolation(this)) return "skipped";
    assert.fail(JSON.stringify(this.output));
  }
  assert.notEqual(this.candidate, this.sourceCandidate);
  assert.equal(this.output?.candidateWorktree, this.candidate);
  assert.equal(
    run("git", ["rev-parse", "HEAD"], this.sourceCandidate).stdout.trim(),
    this.baseSha,
  );
  assert.equal(
    run("git", ["status", "--porcelain"], this.sourceCandidate).stdout.trim(),
    "",
  );
  assert.notEqual(
    run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim(),
    this.baseSha,
  );
});

When("元worktreeだけなら成功する絶対test pathを候補で実行する", function () {
  fs.writeFileSync(
    path.join(this.primary, "test-original.cjs"),
    'const fs = require("node:fs"); const path = require("node:path"); if (!fs.readFileSync(path.join(__dirname, "src/label.js"), "utf8").includes("Helo")) process.exit(7);\n',
  );
  run("git", ["add", "test-original.cjs"], this.primary);
  run("git", ["commit", "-qm", "add original-only oracle"], this.primary);
  this.baseSha = run("git", ["rev-parse", "HEAD"], this.primary).stdout.trim();
  run("git", ["reset", "--hard", this.baseSha], this.sourceCandidate);
  invokeExecute(this, {
    targetTest: [
      process.execPath,
      path.join(this.sourceCandidate, "test-original.cjs"),
    ],
  });
});

Then("Coordinatorは元worktreeの成功を候補成功へ昇格しない", function () {
  if (this.output?.route !== "repair") {
    assert.equal(this.result?.status, 1);
    if (lacksHostIsolation(this)) return "skipped";
    assert.fail(JSON.stringify(this.output));
  }
  assert.equal(this.output?.authority, "none");
  assert.notEqual(
    (this.output?.targetTest as Record<string, unknown>).exitCode,
    0,
  );
  assert.equal(
    run("git", ["status", "--porcelain"], this.sourceCandidate).stdout.trim(),
    "",
  );
});

When("配布CLIで隔離Workerの文言修正を実行する", function () {
  invokeExecute(this, {}, process.env, true);
});

When("元worktreeでだけ成功する実行testを絶対pathで指定する", function () {
  const script = path.join(this.primary, "test-original.sh");
  fs.writeFileSync(
    script,
    '#!/bin/sh\nIFS= read -r line < "${0%/*}/src/label.js"\ncase "$line" in *Helo*) exit 0;; *) exit 7;; esac\n',
    { mode: 0o755 },
  );
  run("git", ["add", "test-original.sh"], this.primary);
  run("git", ["commit", "-qm", "add executable original oracle"], this.primary);
  this.baseSha = run("git", ["rev-parse", "HEAD"], this.primary).stdout.trim();
  run("git", ["reset", "--hard", this.baseSha], this.sourceCandidate);
  invokeExecute(this, {
    targetTest: [path.join(this.sourceCandidate, "test-original.sh")],
  });
});

Then("Coordinatorは別worktreeの実行testを拒否する", function () {
  assert.equal(this.result?.status, 1);
  if (lacksHostIsolation(this)) {
    assert.equal(
      run("git", ["status", "--porcelain"], this.sourceCandidate).stdout.trim(),
      "",
    );
    return "skipped";
  }
  assert.ok(
    reasons(this).some((reason) => reason.includes("別worktreeの実行file")),
    JSON.stringify(this.output),
  );
  assert.equal(this.output?.candidateWorktree, undefined);
  assert.equal(
    run("git", ["status", "--porcelain"], this.sourceCandidate).stdout.trim(),
    "",
  );
});

When("元worktreeの親に実行fileを複製して元のtestを指定する", function () {
  const script = path.join(this.primary, "test-original.sh");
  fs.writeFileSync(
    script,
    '#!/bin/sh\nIFS= read -r line < "${0%/*}/src/label.js"\ncase "$line" in *Helo*) exit 0;; *) exit 7;; esac\n',
    { mode: 0o755 },
  );
  run("git", ["add", "test-original.sh"], this.primary);
  run("git", ["commit", "-qm", "add original oracle"], this.primary);
  this.baseSha = run("git", ["rev-parse", "HEAD"], this.primary).stdout.trim();
  run("git", ["reset", "--hard", this.baseSha], this.sourceCandidate);
  const copiedShell = path.join(this.home, "copied-sh");
  fs.copyFileSync("/bin/sh", copiedShell);
  fs.chmodSync(copiedShell, 0o755);
  invokeExecute(this, {
    targetTest: [
      copiedShell,
      path.join(this.sourceCandidate, "test-original.sh"),
    ],
  });
});

When(
  "結果用worktreeのclean・変更済み・登録のみ・未登録directory・同名fileを作る",
  function () {
    const names = ["clean", "modified", "missing"];
    for (const name of names) {
      const target = path.join(this.home, `.asc-candidate-result-${name}`);
      run(
        "git",
        ["worktree", "add", "--detach", target, this.baseSha],
        this.primary,
      );
      if (name === "modified")
        fs.writeFileSync(
          path.join(target, "src", "label.js"),
          'export const label = "Changed";\n',
        );
      if (name === "missing")
        fs.rmSync(target, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(this.home, ".asc-candidate-result-orphan"));
    fs.writeFileSync(
      path.join(this.home, ".asc-candidate-result-file"),
      "not a worktree",
    );
    this.rejectionReasons = [
      run("git", ["rev-parse", "HEAD"], this.primary).stdout,
      run("git", ["worktree", "list", "--porcelain"], this.primary).stdout,
    ];
    this.result = run(
      process.execPath,
      [
        "--import",
        "tsx",
        path.resolve("bin/agent-skill-chain.ts"),
        "workflow",
        "candidate-inventory",
        `--repo=${this.candidate}`,
      ],
      process.cwd(),
      { allowFailure: true, timeoutMs: 30_000 },
    );
    this.output = JSON.parse(this.result.stdout) as Record<string, unknown>;
  },
);

Then("Candidate inventoryは5状態を区別しGit状態を変更しない", function () {
  assert.equal(this.result?.status, 0);
  assert.equal(this.output?.authority, "observation-only");
  const entries = this.output?.entries as Array<Record<string, unknown>>;
  assert.deepEqual(
    Object.fromEntries(
      entries.map((entry) => [
        path.basename(entry.path as string),
        entry.state,
      ]),
    ),
    {
      ".asc-candidate-result-clean": "registered-clean",
      ".asc-candidate-result-missing": "registered-missing",
      ".asc-candidate-result-modified": "registered-modified",
      ".asc-candidate-result-file": "unregistered-path",
      ".asc-candidate-result-orphan": "unregistered-directory",
    },
  );
  assert.equal(
    run("git", ["rev-parse", "HEAD"], this.primary).stdout,
    this.rejectionReasons[0],
  );
  assert.equal(
    run("git", ["worktree", "list", "--porcelain"], this.primary).stdout,
    this.rejectionReasons[1],
  );
});

function runCandidateInventory(world: CandidateSessionWorld): void {
  world.result = run(
    process.execPath,
    [
      "--import",
      "tsx",
      path.resolve("bin/agent-skill-chain.ts"),
      "workflow",
      "candidate-inventory",
      `--repo=${world.candidate}`,
    ],
    process.cwd(),
    { allowFailure: true, timeoutMs: 30_000 },
  );
  world.output = JSON.parse(world.result.stdout) as Record<string, unknown>;
}

function inventoryState(world: CandidateSessionWorld): unknown {
  const entries = world.output?.entries as Array<Record<string, unknown>>;
  return entries.find((entry) =>
    (entry.path as string).endsWith(".asc-candidate-result-adversarial"),
  )?.state;
}

When("clean filterを設定した結果worktreeをinventoryする", function () {
  const target = path.join(this.home, ".asc-candidate-result-adversarial");
  run(
    "git",
    ["worktree", "add", "--detach", target, this.baseSha],
    this.primary,
  );
  const marker = path.join(this.home, "filter-ran");
  run(
    "git",
    ["config", "filter.attack.clean", `sh -c 'cat; touch ${marker}'`],
    this.primary,
  );
  const infoPath = run(
    "git",
    ["rev-parse", "--git-path", "info/attributes"],
    target,
  ).stdout.trim();
  fs.mkdirSync(path.dirname(infoPath), { recursive: true });
  fs.writeFileSync(infoPath, "src/label.js filter=attack\n");
  fs.writeFileSync(
    path.join(target, "src", "label.js"),
    'export const label = "Changed";\n',
  );
  this.rejectionReasons = [marker];
  runCandidateInventory(this);
});

Then("Candidate inventoryはfilterを起動せず不明として停止する", function () {
  assert.equal(this.result?.status, 1);
  assert.equal(inventoryState(this), "registered-unknown");
  assert.equal(fs.existsSync(this.rejectionReasons[0]), false);
});

When("隠蔽indexを設定した結果worktreeをinventoryする", function () {
  const target = path.join(this.home, ".asc-candidate-result-adversarial");
  run(
    "git",
    ["worktree", "add", "--detach", target, this.baseSha],
    this.primary,
  );
  run("git", ["update-index", "--assume-unchanged", "src/label.js"], target);
  fs.writeFileSync(
    path.join(target, "src", "label.js"),
    'export const label = "Changed";\n',
  );
  runCandidateInventory(this);
});

Then("Candidate inventoryは隠蔽indexを不明として停止する", function () {
  assert.equal(this.result?.status, 1);
  assert.equal(inventoryState(this), "registered-unknown");
});

When("結果worktreeを壊れたsymlinkに置換してinventoryする", function () {
  const target = path.join(this.home, ".asc-candidate-result-adversarial");
  run(
    "git",
    ["worktree", "add", "--detach", target, this.baseSha],
    this.primary,
  );
  fs.rmSync(target, { recursive: true, force: true });
  fs.symlinkSync(path.join(this.home, "missing-target"), target);
  runCandidateInventory(this);
});

Then("Candidate inventoryはsymlinkを不明として停止する", function () {
  assert.equal(this.result?.status, 1);
  assert.equal(inventoryState(this), "registered-unknown");
});

function prepareCandidateAdoption(
  world: CandidateSessionWorld,
  security = false,
  inheritedSecurity = false,
  neutralGuardRemoval = false,
): void {
  if (neutralGuardRemoval) {
    fs.writeFileSync(
      path.join(world.primary, "src/service.js"),
      "export const service = (user) => { authorize(user); return true; };\n",
    );
    run("git", ["add", "src/service.js"], world.primary);
    run("git", ["commit", "-qm", "base service guard"], world.primary);
    world.baseSha = run(
      "git",
      ["rev-parse", "HEAD"],
      world.primary,
    ).stdout.trim();
    run("git", ["reset", "--hard", world.baseSha], world.candidate);
  }
  if (inheritedSecurity) {
    fs.writeFileSync(
      path.join(world.candidate, "src/authorization.js"),
      "export const authorized = false;\n",
    );
    run("git", ["add", "src/authorization.js"], world.candidate);
    run("git", ["commit", "-qm", "authorization change"], world.candidate);
  }
  const changed = neutralGuardRemoval
    ? "src/service.js"
    : security
      ? "src/authorization.js"
      : "src/label.js";
  fs.writeFileSync(
    path.join(world.candidate, changed),
    neutralGuardRemoval
      ? "export const service = (_user) => true;\n"
      : security
        ? "export const authorized = false;\n"
        : 'export const label = "Hello";\n',
  );
  run("git", ["add", changed], world.candidate);
  run(
    "git",
    ["commit", "-qm", "asc: isolated candidate implementation"],
    world.candidate,
  );
  const candidateHead = run(
    "git",
    ["rev-parse", "HEAD"],
    world.candidate,
  ).stdout.trim();
  run("git", ["reset", "--hard", world.baseSha], world.candidate);
  run(
    "git",
    ["update-ref", "refs/remotes/origin/main", world.baseSha],
    world.primary,
  );
  run(
    "git",
    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    world.primary,
  );
  const resultRoot = path.join(world.home, ".asc-candidate-result-adoption");
  run(
    "git",
    ["worktree", "add", "--detach", resultRoot, candidateHead],
    world.primary,
  );
  world.staging = createIssueStaging(resultRoot, {
    title: "Candidate adoption",
    requestedMode: "quick",
    answers: Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [
        `Q-${String(i + 1).padStart(2, "0")}`,
        { answer: true as const, evidence: "isolated fixture" },
      ]),
    ),
    now: new Date("2026-10-12T00:00:00.000Z"),
  }).path;
  for (const step of [1, 4]) {
    appendWorkflowJournalEntry({
      staging: world.staging,
      entry: {
        step,
        skillId: step === 1 ? "step-01-request" : "step-04-issue-sync",
        mode: "quick",
        recordedAt: "2026-10-12T00:01:00.000Z",
        artifacts: ["00_要求定義.md"],
        evidence:
          step === 1 ? "fixture request" : "fixture tracker sync digest",
      },
    });
  }
  recordStagingSync(world.staging, {
    tracker: "https://github.com/dummy/repo/issues/1",
    checkpoint: 4,
    syncedAt: "2026-10-12T00:02:00.000Z",
    bodyDigest: "a".repeat(64),
    readBackDigest: "a".repeat(64),
  });
}

function recordCandidatePreAdoptionReview(world: CandidateSessionWorld): void {
  const headSha = run(
    "git",
    ["rev-parse", "HEAD"],
    path.dirname(path.dirname(world.staging)),
  ).stdout.trim();
  const draft = buildReviewRoundDraft({
    staging: world.staging,
    headSha,
    baseSha: world.baseSha,
    scopeIds: ["SCOPE-CANDIDATE-DUMMY"],
    acceptanceCriteriaIds: ["AC-CANDIDATE-DUMMY"],
  });
  recordReviewRound({
    staging: world.staging,
    round: { ...draft.round, findings: [] },
  });
}

function invokeCandidateAdoption(
  world: CandidateSessionWorld,
  apply: boolean,
): void {
  world.result = run(
    process.execPath,
    [
      "--import",
      "tsx",
      path.resolve("bin/agent-skill-chain.ts"),
      "workflow",
      "candidate-adopt",
      `--staging=${world.staging}`,
      ...(apply ? ["--apply"] : []),
    ],
    process.cwd(),
    { allowFailure: true, timeoutMs: 30_000 },
  );
  if (world.result.stdout.trim().startsWith("{"))
    world.output = JSON.parse(world.result.stdout) as Record<string, unknown>;
}

When("結果用worktreeにquick stagingを作りCandidateを正式採用する", function () {
  prepareCandidateAdoption(this);
  invokeCandidateAdoption(this, false);
  assert.equal(this.result?.status, 0, this.result?.stdout);
  assert.equal(this.output?.state, "independent-review-required");
  const beforeReview = observeWorkflowExecutionPlan(this.staging);
  assert.equal(beforeReview.state, "ready", JSON.stringify(beforeReview));
  assert.equal(beforeReview.action.executor, "fresh-worker");
  assert.equal(
    readWorkflowJournal(this.staging).entries.some((entry) => entry.step === 9),
    false,
  );
  invokeCandidateAdoption(this, true);
  assert.equal(this.result?.status, 1);
  recordCandidatePreAdoptionReview(this);
  const plan = observeWorkflowExecutionPlan(this.staging);
  assert.equal(plan.state, "ready", JSON.stringify(plan));
  assert.equal(plan.step, 9);
  assert.equal(plan.action.executor, "cli");
  assert.equal(plan.assurance.selectedWork.kind, "deterministic");
  assert.equal(plan.agentDispatch, undefined);
  assert.ok(
    plan.action.allowedOperations.some(
      (item) => item.operation === "adopt-reviewed-candidate",
    ),
  );
  invokeCandidateAdoption(this, true);
});

Then("Candidate採用記録はGitと要求に束縛されStep 10 reviewが残る", function () {
  assert.equal(this.result?.status, 0, this.result?.stdout);
  const journal = readWorkflowJournal(this.staging);
  assert.deepEqual(journal.errors, []);
  const adoption = journal.entries.find((entry) => entry.step === 9);
  assert.ok(adoption?.candidateAdoption);
  assert.equal(adoption.implementationHeadSha, this.output?.headSha);
  assert.equal(this.output?.independentReviewRequired, true);
  assert.equal(this.output?.provenance, "git-lineage-only");
  assert.equal(this.output?.coordinatorOriginVerified, false);
  assert.equal(
    journal.entries.some((entry) => entry.step === 10),
    false,
  );
  const session = readStoredReviewSession(this.staging);
  assert.ok(session);
  assert.equal(session.latestCandidateHeadSha, adoption.implementationHeadSha);
  assert.equal(session.anchor.diffBaseSha, adoption.candidateAdoption.baseSha);
});

When("Candidate結果をreview後に未commit修正してplanを観測する", function () {
  prepareCandidateAdoption(this);
  recordCandidatePreAdoptionReview(this);
  const resultRoot = path.join(this.home, ".asc-candidate-result-adoption");
  fs.writeFileSync(
    path.join(resultRoot, "src/label.js"),
    'export const label = "Correction";\n',
  );
  this.adoptionPlan = observeWorkflowExecutionPlan(this.staging);
  invokeCandidateAdoption(this, true);
});

Then("planは採用せずStep9のfresh workerへ戻し正式採用は拒否する", function () {
  assert.equal(
    this.adoptionPlan?.state,
    "ready",
    JSON.stringify(this.adoptionPlan),
  );
  assert.equal(this.adoptionPlan?.step, 9);
  assert.equal(this.adoptionPlan?.action.executor, "fresh-worker");
  assert.equal(this.adoptionPlan?.handoff?.branch, null);
  assert.equal(this.result?.status, 1);
  assert.equal(
    readWorkflowJournal(this.staging).entries.some((entry) => entry.step === 9),
    false,
  );
});

When("結果用worktreeのCandidateを採用後に要求成果物を改変する", function () {
  prepareCandidateAdoption(this);
  recordCandidatePreAdoptionReview(this);
  invokeCandidateAdoption(this, true);
  assert.equal(this.result?.status, 0, this.result?.stdout);
  fs.appendFileSync(path.join(this.staging, "00_要求定義.md"), "\n改変\n");
});

Then("Candidate採用記録の要求digest不一致を検出する", function () {
  assert.ok(
    readWorkflowJournal(this.staging).errors.some((error) =>
      error.includes("要求digestが一致しません"),
    ),
  );
});

When("認可変更を含む結果用worktreeのCandidate採用を試す", function () {
  prepareCandidateAdoption(this, true);
  invokeCandidateAdoption(this, true);
});

Then("Candidate採用は拒否されStep 9記録を残さない", function () {
  assert.equal(this.result?.status, 1);
  assert.equal(
    readWorkflowJournal(this.staging).entries.some((entry) => entry.step === 9),
    false,
  );
});

When("認可変更を前のcommitに隠したCandidate採用を試す", function () {
  prepareCandidateAdoption(this, false, true);
  invokeCandidateAdoption(this, true);
});

When("中立名のserviceから認可guardを削除したCandidate採用を試す", function () {
  prepareCandidateAdoption(this, false, false, true);
  run("git", ["config", "color.ui", "always"], this.candidate);
  invokeCandidateAdoption(this, true);
  assert.match(this.result?.stdout ?? "", /認可・認証guard/);
});

When("中立名のserviceから認可guardを削除した単独postを試す", function () {
  fs.writeFileSync(
    path.join(this.primary, "src/service.js"),
    "export const service = (user) => { authorize(user); return true; };\n",
  );
  run("git", ["add", "src/service.js"], this.primary);
  run("git", ["commit", "-qm", "base service guard"], this.primary);
  this.baseSha = run("git", ["rev-parse", "HEAD"], this.primary).stdout.trim();
  run("git", ["reset", "--hard", this.baseSha], this.candidate);
  this.session = path.join(this.home, "neutral-session.json");
  const pre = invoke(this, {
    phase: "preflight",
    intent: "文言を修正する",
    correctnessCriterion: "label === Hello",
    allowedPaths: ["src/label.js", "src/service.js"],
    risk: Object.fromEntries(CANDIDATE_RISKS.map((risk) => [risk, "cleared"])),
    unresolved: [],
  });
  assert.equal(pre.route, "candidate");
  fs.writeFileSync(
    path.join(this.candidate, "src/service.js"),
    "export const service = (_user) => true;\n",
  );
  fs.writeFileSync(
    path.join(this.candidate, "src/label.js"),
    'export const label = "Hello";\n',
  );
  run("git", ["commit", "-qam", "remove access guard"], this.candidate);
  run("git", ["config", "color.ui", "always"], this.candidate);
  invoke(this, {
    phase: "post",
    gaps: [],
    targetTest: [process.execPath, "test.js"],
  });
});

Then("単独postは認可riskをGit差分から検出し上流へ戻す", function () {
  assert.equal(this.result?.status, 1);
  assert.equal(this.output?.route, "upstream");
  assert.deepEqual(this.output?.pendingResponsibilities, ["security-risk"]);
});

When("Candidate採用後に既定branch参照が候補HEADへ進む", function () {
  prepareCandidateAdoption(this);
  recordCandidatePreAdoptionReview(this);
  invokeCandidateAdoption(this, true);
  assert.equal(this.result?.status, 0, this.result?.stdout);
  const head = this.output?.headSha;
  assert.equal(typeof head, "string");
  run(
    "git",
    ["update-ref", "refs/remotes/origin/main", head as string],
    this.primary,
  );
});

Then("Candidate採用記録は固定したtrusted tipで有効なままである", function () {
  const journal = readWorkflowJournal(this.staging);
  assert.deepEqual(journal.errors, []);
  const adoption = journal.entries.find(
    (entry) => entry.step === 9,
  )?.candidateAdoption;
  assert.ok(adoption);
  assert.equal(adoption.trustedTipSha, this.baseSha);
});

When(
  "Candidateを事前review後に修正し同じsessionで再reviewして採用する",
  function () {
    prepareCandidateAdoption(this);
    recordCandidatePreAdoptionReview(this);
    const root = run(
      "git",
      ["rev-parse", "--show-toplevel"],
      this.staging,
    ).stdout.trim();
    fs.writeFileSync(
      path.join(root, "src/label.js"),
      'export const label = "Hello, reviewed";\n',
    );
    run("git", ["add", "src/label.js"], root);
    run("git", ["commit", "-qm", "fix: address candidate review"], root);
    const headSha = run("git", ["rev-parse", "HEAD"], root).stdout.trim();
    const draft = buildReviewRoundDraft({ staging: this.staging, headSha });
    recordReviewRound({
      staging: this.staging,
      round: { ...draft.round, findings: [] },
    });
    invokeCandidateAdoption(this, true);
  },
);

Then("採用記録は再review済みHEADと修正履歴のGit差分に束縛される", function () {
  assert.equal(this.result?.status, 0, this.result?.stdout);
  const journal = readWorkflowJournal(this.staging);
  assert.deepEqual(journal.errors, []);
  const adoption = journal.entries.find((entry) => entry.step === 9);
  assert.ok(adoption?.candidateAdoption);
  assert.equal(adoption.implementationHeadSha, this.output?.headSha);
  const session = readStoredReviewSession(this.staging);
  assert.ok(session);
  assert.equal(session.latestCandidateHeadSha, adoption.implementationHeadSha);
  assert.notEqual(
    session.anchor.initialHeadSha,
    adoption.implementationHeadSha,
  );
});

When("採用済みCandidateのquick stagingを正式にfull昇格する", function () {
  prepareCandidateAdoption(this);
  recordCandidatePreAdoptionReview(this);
  invokeCandidateAdoption(this, true);
  assert.equal(this.result?.status, 0, this.result?.stdout);
  promoteWorkflowStagingToFull({
    staging: this.staging,
    promotedAt: "2026-10-12T02:00:00.000Z",
    discovery: {
      discoveryId: "DISC-CANDIDATE-FULL-PROMOTION",
      workflowMode: "quick",
      modeDisqualifiers: [
        {
          id: "security-boundary",
          evidence: "Candidate再評価で権限境界の影響を発見した",
        },
      ],
      changedContractKinds: ["interface"],
      changesGoal: false,
      changesScope: false,
      changesAcceptanceCriteria: false,
      expandsSecurityBoundary: true,
      introducesIrreversibleOperation: false,
    },
  });
});

Then("昇格後も採用時の旧要求を照合しjournalを有効に保つ", function () {
  const journal = readWorkflowJournal(this.staging);
  assert.equal(journal.mode, "full");
  assert.deepEqual(journal.errors, []);
  assert.ok(journal.entries.some((entry) => entry.candidateAdoption));
});

When("symlinkのNode実行fileを対象testに指定する", function () {
  const alias = path.join(this.home, "node-alias");
  fs.symlinkSync(process.execPath, alias);
  invokeExecute(this, { targetTest: [alias, "test.js"] });
});

Then("Candidateは実体Nodeで対象testを観測する", function () {
  if (this.result?.status !== 0) {
    assert.ok(
      reasons(this).some((reason) => reason.includes("candidate Worker")),
      JSON.stringify(this.output),
    );
    return;
  }
  assert.equal(this.output?.route, "independent-review");
  const observed = this.output?.targetTest as Record<string, unknown>;
  assert.equal(observed.exitCode, 0);
  assert.equal(observed.formalEvidence, false);
});

When("shのsymlink起動名に依存する対象testを指定する", function () {
  if (process.platform !== "linux") return;
  const alias = path.join(this.home, "candidate-sh-alias");
  fs.symlinkSync("/bin/sh", alias);
  invokeExecute(this, {
    targetTest: [alias, "-c", 'test "${0##*/}" = candidate-sh-alias'],
  });
});

Then("実体fileを読取許可しつつsymlink起動名で対象testが成功する", function () {
  if (process.platform !== "linux") return;
  if (this.result?.status !== 0 && lacksHostIsolation(this)) return;
  assert.equal(this.result?.status, 0, JSON.stringify(this.output));
  assert.equal(this.output?.route, "independent-review");
  assert.equal(
    (this.output?.targetTest as Record<string, unknown>).exitCode,
    0,
  );
});

When("Codexの正常・破損・範囲外usageイベントを解析する", function () {
  const valid = [
    JSON.stringify({ type: "thread.started", thread_id: "dummy" }),
    JSON.stringify({
      type: "turn.completed",
      usage: {
        input_tokens: 100,
        cached_input_tokens: 40,
        cache_write_input_tokens: 0,
        output_tokens: 20,
        reasoning_output_tokens: 5,
      },
    }),
    JSON.stringify({
      type: "turn.completed",
      usage: {
        input_tokens: 80,
        cached_input_tokens: 20,
        cache_write_input_tokens: 5,
        output_tokens: 10,
        reasoning_output_tokens: 2,
      },
    }),
  ].join("\n");
  const malformed = `${valid}\nnot-json`;
  const impossible = JSON.stringify({
    type: "turn.completed",
    usage: {
      input_tokens: 10,
      cached_input_tokens: 11,
      cache_write_input_tokens: 0,
      output_tokens: 1,
      reasoning_output_tokens: 0,
    },
  });
  this.output = {
    valid: parseCodexCandidateUsage(valid),
    malformed: parseCodexCandidateUsage(malformed),
    missing: parseCodexCandidateUsage(
      `${valid}\n${JSON.stringify({ type: "turn.completed" })}`,
    ),
    impossible: parseCodexCandidateUsage(impossible),
  };
});

Then("有効なusageだけを合算し不正イベントは欠測にする", function () {
  assert.deepEqual(this.output?.valid, {
    inputTokens: 180,
    cachedInputTokens: 60,
    cacheWriteInputTokens: 5,
    outputTokens: 30,
    reasoningOutputTokens: 7,
    source: "codex-turn-completed",
  });
  assert.equal(this.output?.malformed, null);
  assert.equal(this.output?.missing, null);
  assert.equal(this.output?.impossible, null);
});

When("Codex ProviderとworkerArgvを同時に申告する", function () {
  invokeExecute(this, { workerProvider: "codex" });
});

Then("Workerを起動せず入力混在を拒否する", function () {
  assert.equal(this.result?.status, 1);
  assert.ok(
    reasons(this).some((reason) => reason.includes("workerArgv")),
    JSON.stringify(this.output),
  );
  assert.equal(
    run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim(),
    this.baseSha,
  );
});

When("候補worktreeにproject-local Codex設定を置く", function () {
  const config = path.join(this.candidate, ".codex", "config.toml");
  fs.mkdirSync(path.dirname(config), { recursive: true });
  fs.writeFileSync(config, 'sandbox_mode = "danger-full-access"\n');
});

Then("Codex Workerはその設定を読まず停止する", function () {
  assert.throws(
    () =>
      runCandidateCodexWorker({
        root: this.candidate,
        allowedPaths: ["src/label.js"],
        intent: "文言を直す",
        correctnessCriterion: "label === Hello",
      }),
    /project-local Codex config/u,
  );
  assert.equal(
    run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim(),
    this.baseSha,
  );
});

When("環境変数で認証するCodex Workerの起動環境を作る", function () {
  const secret = "test-secret-do-not-forward";
  const built = codexCandidateEnvironment(path.join(this.home, "runtime"), {
    PATH: "/usr/bin:/bin",
    HOME: this.home,
    LANG: "C.UTF-8",
    OPENAI_API_KEY: secret,
    CODEX_API_KEY: secret,
    CODEX_ACCESS_TOKEN: secret,
    UNRELATED_SECRET: secret,
  });
  this.authEnvironment = built;
});

Then("Providerは認証できツール環境から認証情報を除外する", function () {
  const built = this.authEnvironment;
  assert.ok(built);
  assert.equal(built.env.OPENAI_API_KEY, "test-secret-do-not-forward");
  assert.equal(built.env.CODEX_API_KEY, "test-secret-do-not-forward");
  assert.equal(built.env.CODEX_ACCESS_TOKEN, "test-secret-do-not-forward");
  assert.equal(built.env.UNRELATED_SECRET, undefined);
  assert.ok(
    built.toolPolicy.includes('shell_environment_policy.inherit="none"'),
  );
  assert.ok(built.toolPolicy.some((item: string) => item.includes("PATH=")));
  assert.ok(
    built.toolPolicy.every(
      (item: string) => !item.includes("test-secret-do-not-forward"),
    ),
  );
});

When("Candidate worktree内の相対実行fileを隔離Workerに指定する", function () {
  const script = path.join(this.candidate, "scripts", "check.sh");
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, "#!/bin/sh\nprintf relative-ok\n", { mode: 0o755 });
  this.resolvedExecutable = workerExecutable(
    ["./scripts/check.sh"],
    this.candidate,
  );
  try {
    this.boundaryResult = runCandidateWorkerBoundary({
      root: this.candidate,
      allowedPaths: ["src/label.js"],
      argv: ["./scripts/check.sh"],
    });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes("candidate Worker隔離にはCodex sandboxが必要です")
    )
      throw error;
  }
});

Then("相対実行fileをCandidate基点で解決して実行する", function () {
  assert.equal(
    this.resolvedExecutable,
    path.join(this.candidate, "scripts", "check.sh"),
  );
  if (this.boundaryResult) {
    assert.equal(this.boundaryResult.status, 0);
    assert.equal(this.boundaryResult.stdout, "relative-ok");
  }
  assert.equal(
    run("git", ["rev-parse", "HEAD"], this.candidate).stdout.trim(),
    this.baseSha,
  );
});
