import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { conformanceTestArgv } from "../../src/domain/conformance.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

interface SwitchRun {
  status: number | null;
  stdout: string;
  stderr: string;
}
class TestSwitchWorld extends WorkflowWorld {
  switchRoot = "";
  switchRuns: SwitchRun[] = [];
  switchReports: Array<
    Array<{ name: string; steps: Array<{ result: { status: string } }> }>
  > = [];
}
const { Given, When, Then } = stepDefinitions<TestSwitchWorld>();
const selectedIds = [
  "SCN-UNIT-FIXTURE-001",
  "SCN-INT-FIXTURE-001",
  "SCN-E2E-FIXTURE-001",
];

function runNpm(root: string, argv: string[]): SwitchRun {
  const env = { ...process.env };
  delete env.ASC_TEST_SHARDS;
  const result = spawnSync("npm", argv, {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
Given("unitとintegrationとe2eの小さなnpm検証fixtureがある", function () {
  this.switchRoot = this.temp("asc-test-switch-");
  const write = (relative: string, text: string) => {
    const target = path.join(this.switchRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  };
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
    scripts: { test: string };
  };
  write(
    "package.json",
    JSON.stringify({
      type: "module",
      scripts: {
        test: pkg.scripts.test,
        compile: "node compile.mjs",
      },
    }),
  );
  write(
    "compile.mjs",
    'import fs from "node:fs"; fs.writeFileSync("compiled", "yes");\n',
  );
  for (const file of [
    "scripts/run_cucumber_shards.ts",
    "src/lib/entrypoint.ts",
  ])
    write(file, fs.readFileSync(file, "utf8"));
  write(
    "cucumber.mjs",
    'export default { paths: ["test/features/**/*.feature"], import: ["steps.mjs"], format: ["summary"] };\n',
  );
  write(
    "steps.mjs",
    fs.readFileSync("test/fixtures/default-test-switch/steps.mjs", "utf8"),
  );
  for (const [index, layer] of ["unit", "integration", "e2e"].entries())
    write(
      `test/features/${layer}/fixture.feature`,
      `Feature: ${layer}\n  Scenario: ${selectedIds[index]} chosen\n    Given fixture succeeds\n  Scenario: ${selectedIds[index]}-EXTRA unselected\n    Given fixture succeeds\n`,
    );
  fs.symlinkSync(
    path.resolve("node_modules"),
    path.join(this.switchRoot, "node_modules"),
    "dir",
  );
});
When(
  "本repositoryのnpm test scriptをfixtureで実行する",
  { timeout: 90_000 },
  function () {
    this.switchRuns = [runNpm(this.switchRoot, ["test"])];
    fs.writeFileSync(path.join(this.switchRoot, "inject-failure"), "yes");
    this.switchRuns.push(runNpm(this.switchRoot, ["test"]));
  },
);
Then("compile後に全layerのscenarioが実行され失敗も伝播する", function () {
  const [pass, fail] = this.switchRuns;
  assert.equal(pass?.status, 0, pass?.stderr);
  assert.match(pass.stdout, /全体: \d+ shard、割当6件、実行6件、成功/u);
  assert.equal(fail?.status, 1, fail?.stderr);
  assert.match(fail.stdout, /全体: \d+ shard、割当6件、実行6件、失敗/u);
});
When(
  "conformanceの生成argvを実npmで実行する",
  { timeout: 90_000 },
  function () {
    fs.writeFileSync(path.join(this.switchRoot, "compiled"), "yes");
    const report = path.join(this.switchRoot, "selected report.json");
    const argv = conformanceTestArgv(report, {
      bindings: [{ counterexampleScenarios: selectedIds }],
    });
    assert.ok(argv);
    this.switchRuns = [];
    this.switchReports = [];
    for (const failing of [false, true]) {
      if (failing)
        fs.writeFileSync(path.join(this.switchRoot, "inject-failure"), "yes");
      this.switchRuns.push(runNpm(this.switchRoot, argv));
      const features = JSON.parse(fs.readFileSync(report, "utf8")) as Array<{
        elements: TestSwitchWorld["switchReports"][number];
      }>;
      this.switchReports.push(features.flatMap((feature) => feature.elements));
      fs.unlinkSync(report);
    }
  },
);
Then(
  "完全ID一致で選択した全layerのJSONだけを生成し失敗を伝播する",
  function () {
    assert.equal(this.switchRuns[0]?.status, 0, this.switchRuns[0]?.stderr);
    assert.equal(this.switchRuns[1]?.status, 1, this.switchRuns[1]?.stderr);
    for (const [index, scenarios] of this.switchReports.entries()) {
      assert.deepEqual(
        scenarios.map((scenario) => scenario.name).sort(),
        selectedIds.map((id) => `${id} chosen`).sort(),
      );
      assert.ok(
        scenarios.every((scenario) =>
          scenario.steps.every(
            (step) =>
              step.result.status === (index === 0 ? "passed" : "failed"),
          ),
        ),
      );
    }
  },
);
