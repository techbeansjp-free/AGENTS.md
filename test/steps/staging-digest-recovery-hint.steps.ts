import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { stagingDigestRecoveryHint } from "../../src/domain/workflow.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

/**
 * staging digest不一致の復旧案内（REQ-WF-024）を検査する。
 *
 * **案内が名指しする手順は、その状態で実際に成功するものに限る。** Step 10記録後に
 * 最新Stepの再記録を案内すると必ず失敗し、Step 11記録後に上流再確定を案内しても
 * 必ず失敗する。**どちらの誤りも反対側で繰り返さないよう、3状態すべてを判定する。**
 */
interface HintWorld extends WorkflowWorld {
  recordedSteps: number[];
  hint: string;
  documents: Array<{ path: string; text: string }>;
}

const { Given, When, Then } = stepDefinitions<HintWorld>();
const repositoryRoot = process.cwd();

const WORKFLOW_DOCUMENT = ".agent-skill-chain/docs/01_開発ワークフロー.md";
const STEP_TEN_SKILL = ".agent-skill-chain/skills/step-10-review/SKILL.md";

Given(
  "Step 10を記録しStep 11を記録していないjournalの記録状態がある",
  function () {
    this.recordedSteps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  },
);

Given("Step 10を記録していないjournalの記録状態がある", function () {
  this.recordedSteps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
});

Given("Step 11まで記録したjournalの記録状態がある", function () {
  this.recordedSteps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
});

Given("配布される規範文書とStep 10のskill契約がある", function () {
  this.documents = [WORKFLOW_DOCUMENT, STEP_TEN_SKILL].map((relative) => ({
    path: relative,
    text: fs.readFileSync(path.join(repositoryRoot, relative), "utf8"),
  }));
});

When("staging digest不一致の案内を生成する", function () {
  this.hint = stagingDigestRecoveryHint(this.recordedSteps);
});

When("上流再確定の記述を読み取る", function () {
  assert.equal(this.documents.length, 2, "走査対象を読み取れません");
});

Then("案内が上流Step再確定と対象Step範囲を名指しする", function () {
  assert.match(this.hint, /--reconfirm/u);
  /** 対象Step範囲まで名指しする。`--reconfirm`だけでは利用者がStepを選べない */
  assert.match(this.hint, /1〜9/u);
  assert.match(this.hint, /workflow record/u);
});

Then("案内が最新Stepの再記録を示し上流再確定を名指ししない", function () {
  assert.match(this.hint, /--step=<最新のStep>/u);
  assert.doesNotMatch(
    this.hint,
    /--reconfirm/u,
    "Step 10記録前に上流再確定を案内すると、使えない手順を示すことになる",
  );
});

Then("案内が上流再確定を名指しせずstagingを編集しないことを示す", function () {
  assert.doesNotMatch(
    this.hint,
    /--reconfirm/u,
    "Step 11記録後は上流再確定を置けないため、案内しても必ず失敗する",
  );
  assert.match(this.hint, /Step 11記録後/u);
  assert.match(this.hint, /編集せず/u);
});

Then("両方に上流再確定の記述がある", function () {
  for (const { path: relative, text } of this.documents) {
    assert.match(
      text,
      /--reconfirm/u,
      `上流再確定への到達経路がありません: ${relative}`,
    );
    assert.match(
      text,
      /上流Step/u,
      `上流再確定の説明がありません: ${relative}`,
    );
  }
  /**
   * **規則本文は規範文書が唯一所有する。** skillが手順の条件まで書くと、
   * 規範を空にしても両方の記述が残って合格する。
   */
  const [workflow, skill] = this.documents;
  assert.match(workflow.text, /順序判定から除外/u);
  assert.doesNotMatch(
    skill.text,
    /順序判定から除外/u,
    "skillは参照だけを持ち、規則本文を複製しない",
  );
});
