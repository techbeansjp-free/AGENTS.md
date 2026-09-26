import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  createIssueStaging,
  issueRequiredHeadings,
  validateIssue,
} from "../../src/domain/issue.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface TemplateBrevityWorld extends WorkflowWorld {
  staging: string;
  validation: ReturnType<typeof validateIssue>;
  templates: Map<string, string>;
}

const { Given, When, Then } = stepDefinitions<TemplateBrevityWorld>();
const FULL_FILES = [
  "00_要求定義.md",
  "01_要件定義.md",
  "02_設計.md",
  "03_実装計画.md",
] as const;
/** 変更前の雛形4件の合計行数（188+152+217+195）。縮小の基準であり、上限ではない。 */
const PREVIOUS_TOTAL_LINES = 752;
const TITLE = "縮小雛形の複写";
const CREATED_AT = "2026-09-16T00:00:00.000Z";

function copyStaging(world: TemplateBrevityWorld): string {
  const answers = Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => [
      `Q-${String(index + 1).padStart(2, "0")}`,
      { answer: false as const, evidence: "fixture evidence" },
    ]),
  );
  return createIssueStaging(world.initRepo(), {
    title: TITLE,
    answers,
    requestedMode: "full",
    now: new Date(CREATED_AT),
  }).path;
}

function read(staging: string, name: string): string {
  return fs.readFileSync(path.join(staging, name), "utf8");
}

/** placeholderを埋めて検証器が受理する内容にする。見出しは残す。 */
function fill(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line.startsWith("#")
        ? line
        : line
            .replaceAll("applicable / not-applicable", "not-applicable")
            .replace(/（[^）\n]+）/gu, "具体的な記入済み内容")
            .replace(/<[^>\n]+>/gu, "記入済み")
            .replace(/\{[^}\n]+\}/gu, "記入済み"),
    )
    .join("\n");
}

When("配布templateからfullの件名と作成日時でstagingを複写する", function () {
  this.staging = copyStaging(this);
});

Then(
  "00から03の件名、正本、作成更新日、開発考慮事項の行が事前充填されている",
  function () {
    for (const name of FULL_FILES) {
      const text = read(this.staging, name);
      assert.match(
        text,
        new RegExp(`\\| 件名(?:・正本)? \\| ${TITLE}`, "u"),
        name,
      );
      assert.match(text, /未同期/u, name);
      assert.match(text, new RegExp(CREATED_AT.replace(".", "\\."), "u"), name);
      for (const id of ["DC-PRIVACY", "DC-OBSERVABILITY", "DC-UX", "DC-TOKENS"])
        assert.match(text, new RegExp(`^\\| ${id} \\|`, "mu"), `${name} ${id}`);
    }
  },
);

Then("00から03はそれぞれ冒頭に読者表を持つ", function () {
  for (const name of FULL_FILES) {
    const head = read(this.staging, name).split("\n").slice(0, 12).join("\n");
    assert.match(head, /^\| 読者 \| 読む節 \|$/mu, name);
    for (const reader of [
      "発注・評価する人",
      "実装・レビューする人",
      "運用する人",
    ])
      assert.match(
        head,
        new RegExp(`^\\| ${reader} \\|`, "mu"),
        `${name} ${reader}`,
      );
  }
});

Then("00から03の合計行数は752行より少ない", function () {
  const total = FULL_FILES.reduce(
    (sum, name) => sum + read(this.staging, name).split("\n").length - 1,
    0,
  );
  assert.ok(
    total < PREVIOUS_TOTAL_LINES,
    `複写直後の合計は${total}行で、変更前の${PREVIOUS_TOTAL_LINES}行以上`,
  );
});

Given("配布templateを複写し必須欄だけ埋めたfull stagingがある", function () {
  this.staging = copyStaging(this);
  for (const name of FULL_FILES) {
    const filled = fill(read(this.staging, name));
    fs.writeFileSync(
      path.join(this.staging, name),
      name === "00_要求定義.md"
        ? `${filled}\n\nScenario: SCN-FIXTURE-BREVITY-001 記入済みIssueを検証する\n  Given 記入済みである\n  When 検証する\n  Then 合格する\n`
        : filled,
    );
  }
});

When("複写したstagingをdesign段階で検証する", function () {
  this.validation = validateIssue(this.staging, { stage: "design" });
});

Then("複写したstagingの検証は合格する", function () {
  assert.deepEqual(this.validation.errors, []);
  assert.equal(this.validation.valid, true);
});

Then(
  "複写した00から必須見出しを1つ削ると必須項目の不足で拒否される",
  function () {
    const file = path.join(this.staging, "00_要求定義.md");
    const heading = issueRequiredHeadings("full")[7]!;
    const original = read(this.staging, "00_要求定義.md");
    assert.ok(original.includes(`## ${heading}`), heading);
    fs.writeFileSync(file, original.replace(`## ${heading}`, `## 削除済み`));
    const validation = validateIssue(this.staging, { stage: "design" });
    assert.equal(validation.valid, false);
    assert.ok(
      validation.errors.some((error) =>
        error.includes(`必須項目がありません: ${heading}`),
      ),
      validation.errors.join("; "),
    );
  },
);

/**
 * **管理情報より先に目的が来ることを構造で固定する。** 読者が最初に見るのが件名・日付では、
 * 何を求めている文書かが画面外へ出る。分量の閾値は置かない（INV-04）。
 */
Then("00から03の最初の節見出しは管理情報ではない", function () {
  for (const name of FULL_FILES) {
    const first = read(this.staging, name)
      .split("\n")
      .find((line) => line.startsWith("## "));
    assert.ok(first, `${name}に節見出しがありません`);
    assert.doesNotMatch(
      first,
      /管理情報|レビュー識別情報/u,
      `${name}: ${first}`,
    );
  }
});

Then("00から03の管理情報の節は最後の節である", function () {
  for (const name of FULL_FILES) {
    const headings = read(this.staging, name)
      .split("\n")
      .filter((line) => line.startsWith("## "));
    assert.match(headings.at(-1) ?? "", /管理情報/u, `${name}の末尾節`);
  }
});

const DISTRIBUTED_ISSUE_TEMPLATES = [
  "00_要求定義_full.md",
  "00_要求定義_quick.md",
  "00_要求定義_poc.md",
  "01_要件定義.md",
  "02_設計.md",
  "03_実装計画.md",
  "05_計画変更.md",
  "11_プルリクエスト事前確認.md",
  "11_プルリクエスト本文.md",
  "12_利用案内.md",
] as const;
const READERS = [
  "発注・評価する人",
  "実装・レビューする人",
  "運用する人",
] as const;

When("配布するIssue templateを全件読む", function () {
  this.templates = new Map(
    DISTRIBUTED_ISSUE_TEMPLATES.map((name) => [
      name,
      fs.readFileSync(
        path.join(process.cwd(), ".agent-skill-chain/templates/issue", name),
        "utf8",
      ),
    ]),
  );
});

Then("全templateは冒頭に読者3区分の読者表を持つ", function () {
  assert.equal(this.templates.size, DISTRIBUTED_ISSUE_TEMPLATES.length);
  for (const [name, text] of this.templates) {
    const head = text.split("\n").slice(0, 16).join("\n");
    assert.match(
      head,
      /^\| 読者 \| 読む節 \|$/mu,
      `${name}に読者表がありません`,
    );
    for (const reader of READERS)
      assert.match(
        head,
        new RegExp(`^\\| ${reader} \\|`, "mu"),
        `${name} ${reader}`,
      );
  }
});
