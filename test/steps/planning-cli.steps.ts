import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findCommandUsage, renderUsage } from "../../src/cli-usage.js";
import {
  parseVerificationSelectionInput,
  selectVerificationSet,
} from "../../src/domain/agile-verification.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

const { Given, When, Then } = stepDefinitions<WorkflowWorld>();
function execute(
  file: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  // file descriptorへ捕捉し、pipeの容量や親のstdoutへの依存を避ける。
  const directory = fs.mkdtempSync(
    path.join(process.env.TMPDIR ?? "/tmp", "asc-planning-output-"),
  );
  const stdoutFile = path.join(directory, "stdout");
  const stderrFile = path.join(directory, "stderr");
  const stdoutFd = fs.openSync(stdoutFile, "w");
  const stderrFd = fs.openSync(stderrFile, "w");
  try {
    const result = spawnSync(file, args, {
      ...options,
      stdio: ["ignore", stdoutFd, stderrFd],
    });
    const stdout = fs.readFileSync(stdoutFile, "utf8");
    const stderr = fs.readFileSync(stderrFile, "utf8");
    if (result.error) return Promise.reject(result.error);
    if (result.status !== 0)
      return Promise.reject(
        Object.assign(new Error(stderr || stdout), {
          code: result.status,
          stdout,
          stderr,
        }),
      );
    return Promise.resolve({ stdout, stderr });
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
const cli = path.resolve("dist/bin/agent-skill-chain.js");

Given("Planning CLIの隔離した作業directoryがある", function () {
  this.value = this.temp("asc-planning-cli-");
});

When("Verification Set雛形を実CLIで出力して選定入力へ渡す", async function () {
  assert.equal(typeof this.value, "string");
  const root = this.value as string;
  const run = (args: string[]) =>
    execute(process.execPath, [cli, "workflow", "verification-set", ...args], {
      cwd: root,
    });
  const initialized = await run(["--init"]);
  const input: unknown = JSON.parse(initialized.stdout);
  assert.deepEqual(
    input,
    findCommandUsage("workflow", "verification-set")!.inputContract!.example,
  );
  const parsed = parseVerificationSelectionInput(input);
  assert.deepEqual(fs.readdirSync(root), [], "--initはfileを作らない");
  fs.writeFileSync(path.join(root, "input.json"), initialized.stdout);
  const selected = await run(["--input=input.json"]);
  assert.deepEqual(JSON.parse(selected.stdout), selectVerificationSet(parsed));
  const before = fs.readFileSync(path.join(root, "input.json"), "utf8");
  for (const args of [
    ["--init", "--input=input.json"],
    ["--init=false"],
    ["--init=__present__"],
    ["--init", "--unknown=x"],
    ["--init", "--artifact=x"],
    ["--init", "--init"],
    ["--init", "extra"],
  ]) {
    await assert.rejects(
      run(args),
      (error: unknown) => {
        assert.ok(error && typeof error === "object" && "code" in error);
        assert.notEqual(error.code, 0);
        return true;
      },
      args.join(" "),
    );
  }
  assert.deepEqual(fs.readdirSync(root), ["input.json"]);
  assert.equal(fs.readFileSync(path.join(root, "input.json"), "utf8"), before);
});

Then("CLIのstageと成果物とSCN案内が現行契約に一致する", async function () {
  const usage = findCommandUsage("issue", "validate")!;
  assert.equal(
    usage.optionalFlags.find((flag) => flag.name === "stage")!.value,
    "requirements|design",
  );
  const example = usage.inputContract!.example as {
    requiredArtifacts: { full: Record<string, string[]> };
    scenario: string;
  };
  assert.deepEqual(example.requiredArtifacts.full, {
    requirements: ["00_要求定義.md", "01_要件定義.md"],
    design: [
      "00_要求定義.md",
      "01_要件定義.md",
      "02_設計.md",
      "03_実装計画.md",
    ],
  });
  const help = await execute(process.execPath, [
    cli,
    "issue",
    "validate",
    "--help",
  ]);
  assert.deepEqual(JSON.parse(help.stdout), renderUsage(usage));
  assert.match(
    example.scenario,
    /^Scenario: SCN-[A-Z0-9-]+ .+\n {2}Given .+\n {2}When .+\n {2}Then .+$/u,
  );
  for (const stage of [
    "requirements",
    "design",
    "request",
    "design-artifact",
    "unknown",
  ]) {
    const root = this.value as string;
    try {
      await execute(process.execPath, [
        cli,
        "issue",
        "validate",
        `--path=${root}`,
        `--stage=${stage}`,
      ]);
      assert.fail("空directoryを受理した");
    } catch (error) {
      assert.ok(error && typeof error === "object" && "stdout" in error);
      const stdout =
        String(error.stdout) + ("stderr" in error ? String(error.stderr) : "");
      if (["requirements", "design"].includes(stage))
        assert.match(stdout, /00_要求定義.mdがありません/u);
      else assert.match(stdout, /--stageはrequirementsまたはdesign/u);
    }
  }
});
