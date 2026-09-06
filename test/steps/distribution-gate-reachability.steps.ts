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

const CONDITIONAL_GATE_WORKFLOW = [
  "jobs:",
  "  validate:",
  "    steps:",
  "      - if: ${{ github.event_name == 'never_ever' }}",
  "        run: npm run verify:distribution",
  "",
].join("\n");

const TOLERANT_GATE_WORKFLOW = [
  "jobs:",
  "  validate:",
  "    steps:",
  "      - run: npm run verify:distribution",
  "        continue-on-error: true",
  "",
].join("\n");

/** gate呼び出しstepがjobの最終stepであり、直後に条件付きjobが続く形。 */
const TRAILING_JOB_WORKFLOW = [
  "jobs:",
  "  validate:",
  "    steps:",
  "      - run: npm run verify:distribution",
  "  tag:",
  "    needs: validate",
  "    if: ${{ needs.validate.result == 'success' }}",
  "    steps:",
  "      - run: echo tag",
  "",
].join("\n");

/**
 * sequenceを親keyと同じindentへ置いた形。**step markerのindentとjob-level keyのindentが
 * 等しくなる。** 終端条件を`width < indent`にすると、job-levelの`if:`がstepへ混入する。
 */
const FLUSH_LEFT_SEQUENCE_WORKFLOW = [
  "jobs:",
  "  validate:",
  "    steps:",
  "    - run: npm run verify:distribution",
  "    if: ${{ github.event_name == 'never_ever' }}",
  "",
].join("\n");

/** `continue-on-error`が実行時式であり、静的な`false`と同一視できない形。 */
const EXPRESSION_TOLERANT_GATE_WORKFLOW = [
  "jobs:",
  "  validate:",
  "    steps:",
  "      - run: npm run verify:distribution",
  "        continue-on-error: ${{ github.event_name == 'push' }}",
  "",
].join("\n");

/** quoteしたkeyで`if:`を書いた形。妥当なYAMLである。 */
const QUOTED_CONDITION_WORKFLOW = [
  "jobs:",
  "  validate:",
  "    steps:",
  '      - "if": ${{ false }}',
  "        run: npm run verify:distribution",
  "",
].join("\n");

/** quoteしたkeyで`continue-on-error`を書いた形。 */
const QUOTED_TOLERANCE_WORKFLOW = [
  "jobs:",
  "  validate:",
  "    steps:",
  "      - run: npm run verify:distribution",
  '        "continue-on-error": true',
  "",
].join("\n");

/** `continue-on-error`が静的な`false`と決まる定数式である形。 */
const STATIC_FALSE_TOLERANCE_WORKFLOW = [
  "jobs:",
  "  validate:",
  "    steps:",
  "      - run: npm run verify:distribution",
  "        continue-on-error: ${{ false }}",
  "",
].join("\n");

/** 条件付きstepが公開より前に、無条件stepが公開より後に同じgateを呼ぶ形。 */
const SPLIT_ORDER_WORKFLOW = [
  "jobs:",
  "  validate:",
  "    steps:",
  "      - if: ${{ github.event_name == 'push' }}",
  "        run: npm run verify:distribution",
  "      - run: npm publish",
  "      - run: npm run verify:distribution",
  "",
].join("\n");

/** gate呼び出しstep以外が失敗を許容する形。 */
const OTHER_STEP_TOLERANT_WORKFLOW = [
  "jobs:",
  "  validate:",
  "    steps:",
  "      - run: echo diagnostics",
  "        continue-on-error: true",
  "      - run: npm run verify:distribution",
  "",
].join("\n");

/** gate呼び出しstepが属するjobが失敗を許容する形。 */
const JOB_TOLERANT_WORKFLOW = [
  "jobs:",
  "  validate:",
  "    continue-on-error: true",
  "    steps:",
  "      - run: npm run verify:distribution",
  "",
].join("\n");

/** 静的なfalseならjob-levelでも失敗を許容しない。 */
const JOB_TOLERANCE_FALSE_WORKFLOW = [
  "jobs:",
  "  validate:",
  "    continue-on-error: false",
  "    steps:",
  "      - run: npm run verify:distribution",
  "",
].join("\n");

/** 失敗を許容するのはgate呼び出しstepを持たない別jobだけの形。 */
const OTHER_JOB_TOLERANT_WORKFLOW = [
  "jobs:",
  "  diagnostics:",
  "    continue-on-error: true",
  "    steps:",
  "      - run: echo diagnostics",
  "  validate:",
  "    steps:",
  "      - run: npm run verify:distribution",
  "",
].join("\n");

/** step-levelの静的なfalseをjob-levelの許容と読み違えない形。 */
const STEP_TOLERANCE_FALSE_WORKFLOW = [
  "jobs:",
  "  validate:",
  "    steps:",
  "      - run: npm run verify:distribution",
  "        continue-on-error: false",
  "",
].join("\n");

/** indentless sequenceで別stepだけが失敗を許容する形。 */
const INDENTLESS_STEP_TOLERANT_WORKFLOW = [
  "jobs:",
  "  validate:",
  "    steps:",
  "    - run: npm run verify:distribution",
  "    - run: echo diagnostics",
  "      continue-on-error: true",
  "",
].join("\n");

/** indentless sequenceでもjob-levelの失敗許容は検出する。 */
const INDENTLESS_JOB_TOLERANT_WORKFLOW = [
  "jobs:",
  "  validate:",
  "    continue-on-error: true",
  "    steps:",
  "    - run: npm run verify:distribution",
  "",
].join("\n");

/** job-levelの失敗許容を`steps:`より後ろへ置いた形。 */
const TRAILING_JOB_TOLERANT_WORKFLOW = [
  "jobs:",
  "  validate:",
  "    steps:",
  "      - run: npm run verify:distribution",
  "    continue-on-error: true",
  "",
].join("\n");

const CHECKS: Readonly<Record<string, (world: WorkflowWorld) => void>> = {
  "SCN-INT-DISTGATE-038": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: TRAILING_JOB_TOLERANT_WORKFLOW,
      }),
    );
    assert.ok(
      errors.some((entry) =>
        entry.includes(
          "npm run verify:distributionを呼ぶstepが属するjobにcontinue-on-errorがあります",
        ),
      ),
      `期待した拒否がありません: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-036": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: INDENTLESS_STEP_TOLERANT_WORKFLOW,
      }),
    );
    assert.deepEqual(errors, []);
  },
  "SCN-INT-DISTGATE-037": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: INDENTLESS_JOB_TOLERANT_WORKFLOW,
      }),
    );
    assert.ok(
      errors.some((entry) =>
        entry.includes(
          "npm run verify:distributionを呼ぶstepが属するjobにcontinue-on-errorがあります",
        ),
      ),
      `期待した拒否がありません: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-032": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: JOB_TOLERANT_WORKFLOW,
      }),
    );
    assert.ok(
      errors.some((entry) =>
        entry.includes(
          "npm run verify:distributionを呼ぶstepが属するjobにcontinue-on-errorがあります。gateは実行されて失敗しますが、後続jobのneedsのresultがsuccessになるため配布が止まりません。当該jobからcontinue-on-errorを外してください",
        ),
      ),
      `期待した拒否がありません: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-033": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: JOB_TOLERANCE_FALSE_WORKFLOW,
      }),
    );
    assert.deepEqual(errors, []);
  },
  "SCN-INT-DISTGATE-034": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: OTHER_JOB_TOLERANT_WORKFLOW,
      }),
    );
    assert.deepEqual(errors, []);
  },
  "SCN-INT-DISTGATE-035": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: STEP_TOLERANCE_FALSE_WORKFLOW,
      }),
    );
    assert.deepEqual(errors, []);
  },
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
      errors.some((entry) => entry.includes("を呼ぶstepにif:があります")),
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
  "SCN-INT-DISTGATE-021": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: CONDITIONAL_GATE_WORKFLOW,
      }),
    );
    assert.ok(
      errors.some(
        (entry) =>
          entry.includes(
            "npm run verify:distributionを呼ぶstepにif:があります",
          ) && entry.includes("条件をjob-levelへ移すか"),
      ),
      `条件付きのgate呼び出しstepを数えています: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-022": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: TOLERANT_GATE_WORKFLOW,
      }),
    );
    assert.ok(
      errors.some(
        (entry) =>
          entry.includes(
            "npm run verify:distributionを呼ぶstepがcontinue-on-errorで失敗を許容しています",
          ) && entry.includes("当該stepからcontinue-on-errorを外してください"),
      ),
      `失敗を許容するgate呼び出しstepを数えています: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-023": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: TRAILING_JOB_WORKFLOW,
      }),
    );
    assert.deepEqual(
      errors,
      [],
      `次のjobのjob-level条件を最終stepへ混入させています: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-024": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: OTHER_STEP_TOLERANT_WORKFLOW,
      }),
    );
    assert.deepEqual(
      errors,
      [],
      `gate呼び出し以外のstepの失敗許容を拒否しています: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-026": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: EXPRESSION_TOLERANT_GATE_WORKFLOW,
      }),
    );
    assert.ok(
      errors.some((entry) =>
        entry.includes(
          "npm run verify:distributionを呼ぶstepがcontinue-on-errorで失敗を許容しています",
        ),
      ),
      `continue-on-errorの実行時式を静的なfalseと同一視しています: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-027": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: FLUSH_LEFT_SEQUENCE_WORKFLOW,
      }),
    );
    assert.deepEqual(
      errors,
      [],
      `job-level keyをstepへ混入させています: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-028": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: QUOTED_CONDITION_WORKFLOW,
      }),
    );
    assert.ok(
      errors.some((entry) => entry.includes("を呼ぶstepにif:があります")),
      `quoteしたif:を失格条件として検出していません: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-029": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: QUOTED_TOLERANCE_WORKFLOW,
      }),
    );
    assert.ok(
      errors.some((entry) =>
        entry.includes("continue-on-errorで失敗を許容しています"),
      ),
      `quoteしたcontinue-on-errorを失格条件として検出していません: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-030": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: STATIC_FALSE_TOLERANCE_WORKFLOW,
      }),
    );
    assert.deepEqual(
      errors,
      [],
      `静的なfalseと決まる定数式を失敗許容と誤判定しています: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-031": (world) => {
    const errors = checkDistributionGateReachability(
      build(world, {
        prepack: PREPARE_COMMAND,
        workflow: SPLIT_ORDER_WORKFLOW,
      }),
    );
    assert.ok(
      errors.some((entry) =>
        entry.includes(
          "npm publishより後でしか配布前品質検証を実行していません",
        ),
      ),
      `条件付きstepの位置で順序を判定しています: ${errors.join(" | ")}`,
    );
  },
  "SCN-INT-DISTGATE-025": () => {
    const errors = checkDistributionGateReachability(path.resolve("."));
    assert.deepEqual(
      errors,
      [],
      `現行のrelease.ymlを拒否しています: ${errors.join(" | ")}`,
    );
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
