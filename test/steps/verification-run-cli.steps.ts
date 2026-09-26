import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { main } from "../../src/cli.js";
import { computeImpactSet } from "../../src/adapters/impact-set.js";
import { readVerificationRuns } from "../../src/adapters/verification-run.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { QUESTIONS, type ModeAnswer } from "../../src/domain/mode.js";
import { VERIFICATION_RUN_FILE } from "../../src/domain/verification-run.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

interface VerifyRunWorld extends WorkflowWorld {
  root: string;
  staging: string;
  base: string;
  head: string;
  results: Record<string, CliResult>;
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

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** stdoutのJSONと、commandの中継出力（標準エラー）を分けて捕捉する。 */
async function captureCli(args: string[]): Promise<CliResult> {
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

Given("verify run用のIssue stagingを持つrepositoryがある", function () {
  this.root = this.initRepo();
  this.base = git(this.root, ["rev-parse", "HEAD"]);
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
});

When(
  "失敗するcommandとshell記法を含むargvでverify runを実行する",
  async function () {
    this.results.failed = await captureCli(
      verifyArgs(
        this,
        [`--base=${this.base}`],
        [
          process.execPath,
          "-e",
          `process.stdout.write(${JSON.stringify(SECRET_OUTPUT.split("-"))}.join("-")); process.exit(3)`,
          SHELL_TEXT,
        ],
      ),
    );
    this.results.signaled = await captureCli(
      verifyArgs(
        this,
        [`--base=${this.base}`],
        [process.execPath, "-e", "process.kill(process.pid, 'SIGTERM')"],
      ),
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
  const pass = [process.execPath, "-e", "process.exit(0)"];
  const base = [`--base=${this.base}`];
  this.results.noBase = await captureCli(verifyArgs(this, [], pass));
  this.results.noSeparator = await captureCli(
    verifyArgs(this, base, undefined),
  );
  this.results.emptyArgv = await captureCli(verifyArgs(this, base, []));
  this.results.badScope = await captureCli(
    verifyArgs(this, [...base, "--scope=partial"], pass),
  );
  this.results.targetedOnFull = await captureCli(
    verifyArgs(this, [...base, "--scope=targeted"], pass),
  );
  fs.writeFileSync(path.join(this.root, "src", "dirty.ts"), "export {};\n");
  this.results.dirty = await captureCli(verifyArgs(this, base, pass));
  fs.rmSync(path.join(this.root, "src", "dirty.ts"));
  this.results.writesTree = await captureCli(
    verifyArgs(this, base, [
      process.execPath,
      "-e",
      "require('node:fs').writeFileSync('generated.txt', 'x')",
    ]),
  );
  fs.rmSync(path.join(this.root, "generated.txt"), { force: true });
  this.results.missingProgram = await captureCli(
    verifyArgs(this, base, ["asc-nonexistent-program-for-verify-run"]),
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
    assert.match(result.error.message, pattern, key);
  }
  assert.equal(
    fs.existsSync(recordFile(this)),
    false,
    "拒否した実行は記録しない",
  );
});
