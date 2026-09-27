import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { checkProjectQualityContract } from "../../scripts/check_project_quality.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class TrustedQualityShardsWorld extends WorkflowWorld {
  candidate = "";
  qualityErrors: string[] = [];
}

const { Given, When, Then } = stepDefinitions<TrustedQualityShardsWorld>();
const TEST_SCRIPTS: Readonly<Record<string, string>> = {
  serial:
    "npm run compile --silent && node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.mjs",
  shards:
    "npm run compile --silent && node --import tsx scripts/run_cucumber_shards.ts",
  invalid: "echo skipped",
};

Given("shard品質契約の隔離候補がある", function () {
  this.candidate = this.temp("asc-quality-shards-");
  const files = execFileSync("git", ["ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).split("\0");
  for (const relative of files.filter(Boolean)) {
    const target = path.join(this.candidate, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.resolve(relative), target);
  }
});

When("候補のtestを{string}形として品質検査する", function (shape: string) {
  const script = TEST_SCRIPTS[shape];
  assert.ok(script, `未知のtest形: ${shape}`);
  const file = path.join(this.candidate, "package.json");
  const metadata = JSON.parse(fs.readFileSync(file, "utf8")) as {
    scripts: Record<string, string>;
  };
  metadata.scripts.test = script;
  fs.writeFileSync(file, `${JSON.stringify(metadata, null, 2)}\n`);
  this.qualityErrors = checkProjectQualityContract(
    this.candidate,
    process.cwd(),
  ).errors;
});

When("候補の保護済みshard runnerを改変して品質検査する", function () {
  fs.appendFileSync(
    path.join(this.candidate, "scripts/run_cucumber_shards.ts"),
    "\n// candidate tampering\n",
  );
  this.qualityErrors = checkProjectQualityContract(
    this.candidate,
    process.cwd(),
  ).errors;
});

Then("shard品質契約は候補を受理する", function () {
  assert.deepEqual(this.qualityErrors, []);
});

Then("shard品質契約は{string}を理由に拒否する", function (reason: string) {
  assert.ok(
    this.qualityErrors.some((error) => error.includes(reason)),
    JSON.stringify(this.qualityErrors),
  );
});
