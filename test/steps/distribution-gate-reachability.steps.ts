import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { checkDistributionGateReachability } from "../../scripts/check_conformance.js";

const { Given, When, Then } = stepDefinitions<WorkflowWorld>();

const GATE_COMMAND =
  "npm run project:quality && npm run quality && npm run build && npm run docs:format && npm run test:format && npm run trace:check && npm run architecture:check && npm run conformance:check && npm run audit:check && npm run package:check";
const PREPARE_COMMAND = "npm run build";

interface Fixture {
  readonly prepack?: string;
  readonly invoked?: string;
  readonly workflow?: string;
  readonly omitWorkflow?: boolean;
}

function build(world: WorkflowWorld, fixture: Fixture): string {
  const root = world.temp("asc-distgate-");
  const scripts: Record<string, string> = {};
  if (fixture.prepack !== undefined) scripts.prepack = fixture.prepack;
  fs.writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "fixture", scripts }, null, 2)}\n`,
  );
  if (!fixture.omitWorkflow) {
    fs.mkdirSync(path.join(root, ".github/workflows"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".github/workflows/release.yml"),
      fixture.workflow ??
        [
          "jobs:",
          "  validate:",
          "    steps:",
          `      - run: npm run ${fixture.invoked ?? "prepack"}`,
          "",
        ].join("\n"),
    );
  }
  return root;
}

const CHECKS: Readonly<Record<string, (world: WorkflowWorld) => void>> = {
  "SCN-INT-DISTGATE-001": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, { prepack: GATE_COMMAND, invoked: "prepack" }),
    );
    assert.deepEqual(errors, []);
  },
  "SCN-INT-DISTGATE-002": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, { prepack: PREPARE_COMMAND, invoked: "prepack" }),
    );
    assert.ok(
      errors.some((entry) =>
        entry.includes("verify:distributionを実行しなければなりません"),
      ),
      `期待した拒否がありません: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-003": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        invoked: "verify:distribution",
      }),
    );
    assert.deepEqual(errors, []);
  },
  "SCN-INT-DISTGATE-004": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, { prepack: GATE_COMMAND, invoked: "verify:distribution" }),
    );
    assert.ok(
      errors.some((entry) =>
        entry.includes("npm run prepackを実行しなければなりません"),
      ),
      `期待した拒否がありません: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-005": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, { prepack: GATE_COMMAND, omitWorkflow: true }),
    );
    assert.ok(
      errors.some((entry) => entry.includes("判定できません")),
      `判定不能を拒否していません: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-006": (world) => {
    const errors = checkDistributionGateReachability(build(world, {}));
    assert.ok(
      errors.some((entry) => entry.includes("prepack scriptがありません")),
      `判定不能を拒否していません: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-007": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: [
          "jobs:",
          "  validate:",
          "    steps:",
          "      # npm run verify:distribution はここでは実行しない",
          "      - run: npm run build",
          "",
        ].join("\n"),
      }),
    );
    assert.ok(
      errors.some((entry) =>
        entry.includes("verify:distributionを実行しなければなりません"),
      ),
      `コメントを実行と誤判定しています: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-008": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: [
          "jobs:",
          "  validate:",
          "    steps:",
          '      - run: echo "npm run verify:distribution"',
          "",
        ].join("\n"),
      }),
    );
    assert.ok(
      errors.some((entry) =>
        entry.includes("verify:distributionを実行しなければなりません"),
      ),
      `echoの引数を実行と誤判定しています: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-009": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: [
          "jobs:",
          "  validate:",
          "    steps:",
          "      - if: false",
          "        run: npm run verify:distribution",
          "",
        ].join("\n"),
      }),
    );
    assert.ok(
      errors.some((entry) =>
        entry.includes("verify:distributionを実行しなければなりません"),
      ),
      `無効化されたstepを実行と誤判定しています: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-010": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: [
          "jobs:",
          "  validate:",
          "    steps:",
          "      - run: npm run verify:distribution",
          "  publish:",
          "    steps:",
          "      - run: npm run prepack",
          "",
        ].join("\n"),
      }),
    );
    assert.ok(
      errors.some((entry) =>
        entry.includes("配布前品質検証として実行できません"),
      ),
      `軽量prepackの残存呼び出しを拒否していません: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-011": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: [
          "jobs:",
          "  validate:",
          "    steps:",
          "      - run: |",
          "          npm ci",
          "          npm run verify:distribution",
          "",
        ].join("\n"),
      }),
    );
    assert.deepEqual(errors, []);
  },
  "SCN-INT-DISTGATE-012": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: [
          "jobs:",
          "  validate:",
          "    steps:",
          "      - run: npm ci && npm run build  # && npm run verify:distribution",
          "",
        ].join("\n"),
      }),
    );
    assert.ok(
      errors.some((entry) =>
        entry.includes("verify:distributionを実行しなければなりません"),
      ),
      `末尾commentを実行と誤判定しています: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-013": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: [
          "jobs:",
          "  validate:",
          "    steps:",
          "      - run: >",
          "          npm run verify:distribution",
          "",
        ].join("\n"),
      }),
    );
    assert.deepEqual(errors, []);
  },
  "SCN-INT-DISTGATE-014": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: [
          "jobs:",
          "  validate:",
          "    steps:",
          "      - run: |",
          "          npm run build",
          "      - run: npm run verify:distribution",
          "",
        ].join("\n"),
      }),
    );
    assert.deepEqual(errors, []);
  },
  "SCN-INT-DISTGATE-015": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, { prepack: "echo skip", invoked: "prepack" }),
    );
    assert.ok(
      errors.some((entry) => entry.includes("既知の形ではありません")),
      `未知の準備工程を全gate形と誤認しています: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-016": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: "true || npm run project:quality",
        invoked: "prepack",
      }),
    );
    assert.ok(
      errors.some((entry) => entry.includes("既知の形ではありません")),
      `短絡を含む準備工程を受理しています: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-017": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: [
          "jobs:",
          "  validate:",
          "    steps:",
          "      - run: true || npm run verify:distribution",
          "",
        ].join("\n"),
      }),
    );
    assert.ok(
      errors.some((entry) =>
        entry.includes("verify:distributionを実行しなければなりません"),
      ),
      `短絡で実行されない呼び出しを数えています: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-018": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: [
          "jobs:",
          "  validate:",
          "    steps:",
          "      - run: npm run verify:distribution || true",
          "",
        ].join("\n"),
      }),
    );
    assert.ok(
      errors.some((entry) =>
        entry.includes("verify:distributionを実行しなければなりません"),
      ),
      `失敗を握り潰す呼び出しを数えています: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-019": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: [
          "jobs:",
          "  release:",
          "    steps:",
          "      - run: npm publish",
          "      - run: npm run verify:distribution",
          "",
        ].join("\n"),
      }),
    );
    assert.ok(
      errors.some((entry) => entry.includes("npm publishより後でしか")),
      `publish後の検証を受理しています: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-020": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: [
          "jobs:",
          "  release:",
          "    steps:",
          "      - run: npm run verify:distribution",
          "      - run: npm publish",
          "",
        ].join("\n"),
      }),
    );
    assert.deepEqual(errors, []);
  },
};

Given("配布gate到達性検査の準備がある", function (this: WorkflowWorld) {
  this.value = undefined;
});

When(
  "{string}の配布gate到達性検査を実行する",
  function (this: WorkflowWorld, id: string) {
    const check = CHECKS[id];
    assert.ok(check, `未知の配布gate到達性検査です: ${id}`);
    check(this);
  },
);

Then("配布gate到達性検査は期待結果になる", function () {
  assert.ok(true);
});
