import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { doctor, init } from "../../src/domain/lifecycle.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

/**
 * 新directoryが導入先へ実際に届くことを観測する（REQ-WF-023）。
 *
 * **字面検査では届くかを観測できない。** `templates/planning/`は`package.json`の
 * `files`と`check_directory_guides.ts`の`ENTRY_DOCUMENTS`の双方が揃って初めて
 * 配布と診断が成立する。片方だけを消す変異はunit層を素通りするため、process境界を
 * 跨いだ導入結果をここで判定する。
 */
interface DistributionWorld extends WorkflowWorld {
  root: string;
  installedAssets: string[];
  doctorResult: ReturnType<typeof doctor>;
}

const { Given, When, Then } = stepDefinitions<DistributionWorld>();

const GUIDE = ".agent-skill-chain/templates/planning/00_利用案内.md";
const TEMPLATE = ".agent-skill-chain/templates/planning/01_計画単位.md";

Given("計画テンプレート検証用の隔離directoryがある", function () {
  this.root = this.temp("asc-admit-distribution-");
  fs.writeFileSync(path.join(this.root, "README.md"), "# fixture\n");
});

When("隔離先へpackage資産を導入する", function () {
  const preview = init(this.root, { apply: false });
  assert.equal(preview.applied, false);
  assert.equal(fs.existsSync(path.join(this.root, GUIDE)), false);
  const installed = init(this.root, { apply: true });
  this.installedAssets = installed.assets;
  this.doctorResult = doctor(this.root);
});

Then(
  "計画単位テンプレートとディレクトリ入口が配置され診断が入口不足を報告しない",
  function () {
    for (const asset of [GUIDE, TEMPLATE]) {
      assert.ok(
        this.installedAssets.includes(asset),
        `導入結果に含まれていません: ${asset}`,
      );
      assert.ok(
        fs.existsSync(path.join(this.root, asset)),
        `導入先へ配置されていません: ${asset}`,
      );
    }
    assert.equal(
      fs.readFileSync(path.join(this.root, TEMPLATE), "utf8"),
      fs.readFileSync(path.join(process.cwd(), TEMPLATE), "utf8"),
      "配置された計画単位テンプレートが正本と一致しません",
    );
    assert.equal(
      this.doctorResult.healthy,
      true,
      `導入直後の診断がhealthyではありません: ${JSON.stringify(this.doctorResult.unmanagedAssets)}`,
    );
  },
);
