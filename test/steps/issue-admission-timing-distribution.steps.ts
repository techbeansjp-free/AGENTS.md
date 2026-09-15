import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { checkDirectoryGuides } from "../../scripts/check_directory_guides.js";
import { init } from "../../src/domain/lifecycle.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

/**
 * 新directoryが導入先へ実際に届くことを観測する（REQ-WF-023）。
 *
 * **字面検査では届くかを観測できない。** unit層はrepository内のfileを読むだけで、
 * 導入先へ配置されるかを見ない。ここではprocess境界を跨いだ導入結果を判定する。
 *
 * **入口充足を測る主体は`checkDirectoryGuides`だけである。** `doctor`はこの検査を
 * importしておらず、`ENTRY_DOCUMENTS`へ未登録のdirectoryがあっても`healthy`は
 * `true`のままになる。**`doctor().healthy`を入口不足の観測へ読み替えない。**
 */
interface DistributionWorld extends WorkflowWorld {
  root: string;
  installedAssets: string[];
  guideResult: ReturnType<typeof checkDirectoryGuides>;
}

const { Given, When, Then } = stepDefinitions<DistributionWorld>();

const PLANNING_DIRECTORY = ".agent-skill-chain/templates/planning";
const GUIDE = `${PLANNING_DIRECTORY}/00_利用案内.md`;
const TEMPLATE = `${PLANNING_DIRECTORY}/01_計画単位.md`;

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
  this.guideResult = checkDirectoryGuides(this.root);
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
    /**
     * **診断文字列を名指しする。** `valid`だけを見ると、この検査が本件の
     * directoryを走査していない場合も合格になる。未登録なら必ず出る
     * `入口文書が未定義です: <path>`をpathごと名指しし、それが無いことを判定する。
     */
    const missing = `入口文書が未定義です: ${PLANNING_DIRECTORY}`;
    assert.ok(
      !this.guideResult.errors.includes(missing),
      `入口不足が報告されました: ${missing}`,
    );
    assert.equal(
      this.guideResult.valid,
      true,
      `ディレクトリ入口検査が合格しません: ${JSON.stringify(this.guideResult.errors)}`,
    );
    /**
     * **走査したことまで確かめる。** `entries`は入口が解決したdirectoryだけを持つ。
     * ここに無ければ、検査が対象を見ていないか入口が解決していないかのどちらかで、
     * 「errorsに文字列が無い」だけでは両者を区別できない。
     */
    assert.equal(
      this.guideResult.entries[PLANNING_DIRECTORY],
      GUIDE,
      `入口検査が対象ディレクトリを走査していません: ${PLANNING_DIRECTORY}`,
    );
  },
);
