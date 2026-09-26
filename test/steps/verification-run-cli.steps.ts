import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { main } from "../../src/cli.js";
import { computeImpactSet } from "../../src/adapters/impact-set.js";
import {
  bindStoredPullRequest,
  prepareStoredMergeIntent,
  prepareStoredPullRequestCreation,
  recordStoredStep11,
} from "../../src/adapters/delivery-state.js";
import { readVerificationRuns } from "../../src/adapters/verification-run.js";
import {
  canonicalDigest,
  closingContractDigest,
  pullRequestContentDigest,
} from "../../src/domain/delivery-state.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { QUESTIONS, type ModeAnswer } from "../../src/domain/mode.js";
import {
  calculateStagingDigest,
  listStagingArtifacts,
  readStoredStagingRecord,
} from "../../src/domain/staging.js";
import {
  VERIFICATION_RUN_FILE,
  type VerificationPolicy,
} from "../../src/domain/verification-run.js";
import {
  commitTrustedPolicySet,
  installTrustedVerificationPolicy,
  markTrustedDefaultBranch,
  writeTrustedPolicySet,
} from "../support/trusted-verification-policy.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

interface VerifyRunWorld extends WorkflowWorld {
  root: string;
  staging: string;
  base: string;
  head: string;
  results: Record<string, CliResult>;
  stagingDigests: Record<string, string>;
}

interface CliResult {
  output?: Record<string, unknown>;
  error?: Error;
  exitCode?: number;
  relayed: string;
}

const { Given, When, Then } = stepDefinitions<VerifyRunWorld>();
const SECRET_OUTPUT = "SECRET-OUTPUT-NOT-STORED";
const SHELL_TEXT = "$(touch pwned)";
/** fixtureの振る舞いを切り替える環境変数。argvは同じまま、終了の形だけを変える。 */
const MODE_VARIABLE = "ASC_VERIFY_FIXTURE_MODE";
const FIXTURE_SCRIPT = [
  `const mode = process.env.${MODE_VARIABLE};`,
  `if (mode === "fail") { process.stdout.write(${JSON.stringify(SECRET_OUTPUT.split("-"))}.join("-")); process.exit(3); }`,
  `if (mode === "signal") process.kill(process.pid, "SIGTERM");`,
  `if (mode === "write") require("node:fs").writeFileSync("generated.txt", "x");`,
].join(" ");
/** trusted policyが宣言するfull command。shell記法を含むargvのまま実行・記録される。 */
const FULL_COMMAND = [process.execPath, "-e", FIXTURE_SCRIPT, SHELL_TEXT];
const POLICY: VerificationPolicy = {
  fullCommand: FULL_COMMAND,
  targetedRunner: [process.execPath, "-e", "process.exit(0)"],
};

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** stdoutのJSONと、commandの中継出力（標準エラー）を分けて捕捉する。 */
async function captureCli(
  args: string[],
  mode?: "fail" | "signal" | "write",
): Promise<CliResult> {
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  let stdout = "";
  let relayed = "";
  const collect =
    (append: (text: string) => void) => (chunk: string | Uint8Array) => {
      append(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    };
  process.stdout.write = collect((text) => {
    stdout += text;
  }) as typeof process.stdout.write;
  process.stderr.write = collect((text) => {
    relayed += text;
  }) as typeof process.stderr.write;
  if (mode !== undefined) process.env[MODE_VARIABLE] = mode;
  try {
    const exitCode = await main(args);
    return {
      output: JSON.parse(stdout) as Record<string, unknown>,
      exitCode,
      relayed,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
      relayed,
    };
  } finally {
    delete process.env[MODE_VARIABLE];
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}

function verifyArgs(
  world: VerifyRunWorld,
  flags: readonly string[],
  argv: readonly string[] | undefined,
): string[] {
  return [
    "verify",
    "run",
    `--staging=${world.staging}`,
    ...flags,
    ...(argv === undefined ? [] : ["--", ...argv]),
  ];
}

function recordFile(world: VerifyRunWorld): string {
  return path.join(world.staging, ...VERIFICATION_RUN_FILE.split("/"));
}

/** 差し替え用branch名の連番（実時計に依存しない）。 */
let retargetCount = 0;

/**
 * 既定branchのtrusted commitだけを差し替える。candidateのHEADとworktreeは動かさない。
 * `verification`が`null`なら検証command宣言を持たないtrusted commitにする。
 */
function retargetTrustedPolicy(
  world: VerifyRunWorld,
  verification: VerificationPolicy | null,
): void {
  const branch = git(world.root, ["symbolic-ref", "--short", "HEAD"]);
  retargetCount += 1;
  git(world.root, [
    "checkout",
    "-q",
    "-b",
    `trusted-${retargetCount}`,
    world.base,
  ]);
  writeTrustedPolicySet(world.root, verification);
  commitTrustedPolicySet(world.root, "retarget trusted policy");
  markTrustedDefaultBranch(world.root);
  git(world.root, ["checkout", "-q", branch]);
}

Given("verify run用のIssue stagingを持つrepositoryがある", function () {
  this.root = this.initRepo();
  this.base = installTrustedVerificationPolicy(this.root, POLICY);
  fs.mkdirSync(path.join(this.root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(this.root, "src", "verified.ts"),
    "export const verified = 1;\n",
  );
  git(this.root, ["add", "src/verified.ts"]);
  git(this.root, ["commit", "-q", "-m", "feat: verified"]);
  this.head = git(this.root, ["rev-parse", "HEAD"]);
  this.staging = createIssueStaging(this.root, {
    title: "verify-run",
    answers: Object.fromEntries(
      QUESTIONS.map((id) => [
        id,
        { answer: true, evidence: `${id}の固定証拠` } satisfies ModeAnswer,
      ]),
    ),
    now: new Date("2026-09-26T00:00:00.000Z"),
    requestedMode: "quick",
  }).path;
  this.results = {};
  this.stagingDigests = {};
});

When(
  "失敗するcommandとshell記法を含むargvでverify runを実行する",
  async function () {
    const flags = [`--base=${this.base}`, "--scope=full"];
    this.results.failed = await captureCli(
      verifyArgs(this, flags, FULL_COMMAND),
      "fail",
    );
    this.results.signaled = await captureCli(
      verifyArgs(this, flags, FULL_COMMAND),
      "signal",
    );
  },
);

Then(
  "終了値をそのまま返しshellを展開せずHEADと影響集合digestと出力digestだけを記録する",
  function () {
    const { failed, signaled } = this.results;
    assert.equal(failed?.error, undefined, String(failed?.error));
    assert.equal(failed?.exitCode, 3, "commandの終了値をそのまま返す");
    assert.match(failed!.relayed, new RegExp(SECRET_OUTPUT, "u"));
    assert.equal(
      fs.existsSync(path.join(this.root, "pwned")),
      false,
      "shell記法を展開しない",
    );
    assert.equal(signaled?.exitCode, 1, "signalで止まったcommandは失敗を返す");
    const records = readVerificationRuns(this.staging);
    assert.equal(records.length, 2);
    const [first, second] = records;
    const impact = computeImpactSet({
      root: this.root,
      baseSha: this.base,
      headSha: this.head,
    });
    assert.equal(first!.headSha, this.head);
    assert.equal(first!.baseSha, this.base);
    assert.equal(first!.impactDigest, impact.digest);
    assert.equal(first!.impactMode, impact.mode);
    assert.equal(first!.scope, "full");
    assert.equal(first!.exitCode, 3);
    assert.equal(first!.signal, null);
    assert.equal(first!.command.at(-1), SHELL_TEXT, "argvをそのまま記録する");
    assert.equal(
      first!.stdoutDigest,
      crypto.createHash("sha256").update(SECRET_OUTPUT).digest("hex"),
    );
    assert.equal(second!.exitCode, null);
    assert.equal(second!.signal, "SIGTERM");
    assert.equal(
      fs.readFileSync(recordFile(this), "utf8").includes(SECRET_OUTPUT),
      false,
      "生の出力を保存しない",
    );
    assert.equal(failed?.output?.recordDigest, first!.recordDigest);
  },
);

When("不正な条件でverify runを実行する", async function () {
  const full = [`--base=${this.base}`, "--scope=full"];
  this.results.noBase = await captureCli(
    verifyArgs(this, ["--scope=full"], FULL_COMMAND),
  );
  this.results.noSeparator = await captureCli(
    verifyArgs(this, full, undefined),
  );
  this.results.emptyArgv = await captureCli(verifyArgs(this, full, []));
  this.results.badScope = await captureCli(
    verifyArgs(this, [`--base=${this.base}`, "--scope=partial"], FULL_COMMAND),
  );
  this.results.targetedOnFull = await captureCli(
    verifyArgs(
      this,
      [`--base=${this.base}`, "--scope=targeted"],
      POLICY.targetedRunner,
    ),
  );
  fs.writeFileSync(path.join(this.root, "src", "dirty.ts"), "export {};\n");
  this.results.dirty = await captureCli(verifyArgs(this, full, FULL_COMMAND));
  fs.rmSync(path.join(this.root, "src", "dirty.ts"));
  this.results.writesTree = await captureCli(
    verifyArgs(this, full, FULL_COMMAND),
    "write",
  );
  fs.rmSync(path.join(this.root, "generated.txt"), { force: true });
  /** 起動できないcommandはtrusted policyが宣言した場合にだけ実行まで到達する */
  retargetTrustedPolicy(this, {
    ...POLICY,
    fullCommand: ["asc-nonexistent-program-for-verify-run"],
  });
  this.results.missingProgram = await captureCli(
    verifyArgs(this, full, ["asc-nonexistent-program-for-verify-run"]),
  );
});

Then("各条件を理由つきで拒否し観測記録を追記しない", function () {
  const expected: Record<string, RegExp> = {
    noBase: /--base=<commit>が必要/u,
    noSeparator: /`--`の後に実行するcommand/u,
    emptyArgv: /`--`の後に実行するcommand/u,
    badScope: /--scopeはtargetedまたはfull/u,
    targetedOnFull: /影響集合がfullのためscope=targeted/u,
    dirty: /完全一致するworktree/u,
    writesTree: /実行後に追跡fileまたは未追跡fileが変わりました/u,
    missingProgram: /commandを起動できません/u,
  };
  for (const [key, pattern] of Object.entries(expected)) {
    const result = this.results[key];
    assert.ok(result?.error instanceof Error, `${key}は拒否する`);
    assert.match(
      result.error.message,
      pattern,
      `${key}: ${result.error.message}`,
    );
  }
  assert.equal(
    fs.existsSync(recordFile(this)),
    false,
    "拒否した実行は記録しない",
  );
});

When(
  "trusted policyの宣言と異なるcommandとscope省略でverify runを実行する",
  async function () {
    const base = `--base=${this.base}`;
    this.results.trueAsFull = await captureCli(
      verifyArgs(this, [base, "--scope=full"], ["true"]),
    );
    this.results.missingScope = await captureCli(
      verifyArgs(this, [base], FULL_COMMAND),
    );
    this.results.targetedOption = await captureCli(
      verifyArgs(
        this,
        [base, "--scope=targeted"],
        [...POLICY.targetedRunner, "--dry-run"],
      ),
    );
    /**
     * **candidateが自分のmanifestで`true`を宣言しても使われない。** candidate HEADへ
     * `fullCommand: ["true"]`をcommitし、trusted commitは動かさない。
     */
    writeTrustedPolicySet(this.root, { ...POLICY, fullCommand: ["true"] });
    commitTrustedPolicySet(this.root, "candidate declares true");
    this.results.candidateDeclared = await captureCli(
      verifyArgs(this, [base, "--scope=full"], ["true"]),
    );
    /** trusted commitが宣言を持たなければ、宣言どおりのargvでも実行前に拒否する */
    retargetTrustedPolicy(this, null);
    this.results.undeclared = await captureCli(
      verifyArgs(this, [base, "--scope=full"], FULL_COMMAND),
    );
  },
);

Then(
  "trusted policyの宣言外とscope省略と宣言なしを実行前に拒否し記録しない",
  function () {
    const expected: Record<string, RegExp> = {
      trueAsFull: /\["true"\].*verification\.fullCommand/u,
      missingScope: /--scope=.*が必要/u,
      targetedOption: /影響集合がfullのためscope=targeted/u,
      candidateDeclared: /\["true"\].*verification\.fullCommand/u,
      undeclared: /検証command宣言.*がありません/u,
    };
    for (const [key, pattern] of Object.entries(expected)) {
      const result = this.results[key];
      assert.ok(result?.error instanceof Error, `${key}は拒否する`);
      assert.match(
        result.error.message,
        pattern,
        `${key}: ${result.error.message}`,
      );
      assert.equal(result.relayed, "", `${key}はcommandを実行しない`);
    }
    assert.equal(fs.existsSync(recordFile(this)), false);
  },
);

function createIntent(world: VerifyRunWorld) {
  const issueUrl = "https://github.com/example/repository/issues/1499";
  return {
    repository: "example/repository",
    issue: 1499,
    issueUrl,
    headRef: "fix/1499-verification-trust",
    headSha: world.head,
    baseRef: "main",
    baseSha: world.base,
    pullRequestDigest: pullRequestContentDigest({
      title: "検証commandをtrusted policyへ束縛する",
      body: "Closes #1499",
    }),
    bodyClosingDigest: closingContractDigest({
      canonicalIssue: 1499,
      canonicalIssueUrl: issueUrl,
      closingIssueNumbers: [1499],
    }),
    preparedAt: "2026-09-26T00:00:01.000Z",
  };
}

When(
  "PR停止のStep 11記録後とmerge準備後にverify runを実行する",
  async function () {
    const full = [`--base=${this.base}`, "--scope=full"];
    prepareStoredPullRequestCreation(this.staging, createIntent(this));
    bindStoredPullRequest(this.staging, {
      number: 1499,
      url: "https://github.com/example/repository/pull/1499",
      boundAt: "2026-09-26T00:00:02.000Z",
    });
    recordStoredStep11(this.staging, {
      outcome: "pull-request",
      recordedAt: "2026-09-26T00:00:03.000Z",
      journalDigest: "c".repeat(64),
    });
    this.stagingDigests.before = readStoredStagingRecord(this.staging).digest;
    /** 実行前のdigestが一致していることを先に確かめる（一致していなければ再固定の有無を測れない） */
    this.stagingDigests.observedBefore = calculateStagingDigest(
      this.staging,
      listStagingArtifacts(this.staging),
    );
    this.results.postTerminal = await captureCli(
      verifyArgs(this, full, FULL_COMMAND),
    );
    this.stagingDigests.after = readStoredStagingRecord(this.staging).digest;
    /** merge段階のstagingは別に作る（Step 11記録済みstateからはmergeへ遷移しない） */
    this.staging = createIssueStaging(this.root, {
      title: "verify-run-merge",
      answers: Object.fromEntries(
        QUESTIONS.map((id) => [
          id,
          { answer: true, evidence: `${id}の固定証拠` } satisfies ModeAnswer,
        ]),
      ),
      now: new Date("2026-09-26T00:00:00.000Z"),
      requestedMode: "quick",
    }).path;
    prepareStoredPullRequestCreation(this.staging, createIntent(this));
    bindStoredPullRequest(this.staging, {
      number: 1499,
      url: "https://github.com/example/repository/pull/1499",
      boundAt: "2026-09-26T00:00:02.000Z",
    });
    const review = {
      implementationCommitSha: this.head,
      reviewArtifactPath: "docs/reviews/1499_review.json",
      reviewArtifactDigest: "d".repeat(64),
      ciRunId: "42",
      reviewId: "7",
    };
    prepareStoredMergeIntent(this.staging, {
      method: "merge",
      authorizedHeadSha: this.head,
      authorizedBaseRef: "main",
      authorizedBaseSha: this.base,
      trustedPolicyCommitSha: this.base,
      ...review,
      reviewEvidenceId: canonicalDigest({
        domain: "agent-skill-chain/merge-review-evidence/v1",
        repository: "example/repository",
        prNumber: 1499,
        finalHeadSha: this.head,
        ...review,
      }),
      intentId: "e".repeat(32),
      preparedAt: "2026-09-26T00:00:04.000Z",
    });
    this.results.mergePrepared = await captureCli(
      verifyArgs(this, full, FULL_COMMAND),
    );
  },
);

Then(
  "Step 11後は記録してもstaging digestを再固定せずmerge段階では拒否する",
  function () {
    const { postTerminal, mergePrepared } = this.results;
    assert.equal(postTerminal?.error, undefined, String(postTerminal?.error));
    assert.equal(postTerminal?.exitCode, 0);
    assert.equal(
      this.stagingDigests.observedBefore,
      this.stagingDigests.before,
      "前提: 実行前のstaging digestは記録と一致している",
    );
    assert.equal(
      this.stagingDigests.after,
      this.stagingDigests.before,
      "Step 11記録後のstaging digestをverify runは再固定しない",
    );
    assert.ok(mergePrepared?.error instanceof Error);
    assert.match(mergePrepared.error.message, /merge-prepared.*merge段階以降/u);
    assert.equal(mergePrepared.relayed, "", "merge段階ではcommandを実行しない");
    assert.equal(fs.existsSync(recordFile(this)), false);
  },
);
