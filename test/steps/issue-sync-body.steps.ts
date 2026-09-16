import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  buildIssueSyncBody,
  createIssueStaging,
  escapeFoldBoundary,
  renderIssueSyncBody,
  type IssueSyncArtifactText,
} from "../../src/domain/issue.js";
import type { Mode } from "../../src/domain/mode.js";
import { refreshStoredStagingDigest } from "../../src/domain/staging.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface SyncBodyWorld extends WorkflowWorld {
  syncInputs: IssueSyncArtifactText[];
  syncMode: Mode;
  syncCheckpoint: 4 | 8;
  rendered: string;
}

const { Given, When, Then } = stepDefinitions<SyncBodyWorld>();
const repositoryRoot = process.cwd();
const ARTIFACT_NAMES = [
  "00_要求定義.md",
  "01_要件定義.md",
  "02_設計.md",
  "03_実装計画.md",
] as const;

/**
 * **境界値を入力に含める。** 01は空、02は`</details>`という折りたたみ終端と同じ字面を含む。
 * 折りたたみが内容を1文字も落とさず、字面をescapeしないことを、通常入力だけでは確かめられない。
 */
function knownInputs(): IssueSyncArtifactText[] {
  return [
    { name: ARTIFACT_NAMES[0], text: "# 00 要求定義\n\n目的は1文で書く。\n\n" },
    { name: ARTIFACT_NAMES[1], text: "" },
    {
      name: ARTIFACT_NAMES[2],
      text: "# 02 設計\n\n本文に</details>が現れる。\n\n`</details>`はinline code。\n\n```\n</details>はfence内。\n```\n",
    },
    { name: ARTIFACT_NAMES[3], text: "# 03 実装計画\n\n| T01 | 完了 |\n" },
  ];
}

/** 出荷templateのplaceholderを埋め、検証器が受理する00を作る。 */
function materializedRequest(): string {
  const filled = fs
    .readFileSync(
      path.join(
        repositoryRoot,
        ".agent-skill-chain/templates/issue/00_要求定義_full.md",
      ),
      "utf8",
    )
    .split("\n")
    .map((line) =>
      line.startsWith("## ")
        ? line
        : line
            .replaceAll("applicable / not-applicable", "not-applicable")
            .replace(/（[^）\n]+）/gu, "具体的な記入済み内容")
            .replace(/<[^>\n]+>/gu, "記入済み")
            .replace(/\{[^}\n]+\}/gu, "記入済み"),
    )
    .join("\n");
  return `${filled}\n\nScenario: SCN-FIXTURE-SYNCBODY-001 記入済みIssueを同期する\n  Given 記入済みである\n  When 同期する\n  Then 合格する\n`;
}

function considerationDocument(title: string): string {
  const rows = ["DC-PRIVACY", "DC-OBSERVABILITY", "DC-UX", "DC-TOKENS"]
    .map(
      (id) =>
        `| ${id} | 対象 | not-applicable | CLI文書だけを変更するため対象外である | SCN-FIXTURE-SYNCBODY-001で確認済み |`,
    )
    .join("\n");
  return `# ${title}\n\n${rows}\n`;
}

/**
 * 折りたたみへ入れた本文の期待形。**実装から導出せず、字面で書く。**
 * `escapeFoldBoundary`から導くと、実装と期待が同じ向きへずれても検出できない。
 */
const EXPECTED_INNER: Readonly<Record<string, string>> = Object.freeze({
  "01_要件定義.md": "",
  "02_設計.md":
    "# 02 設計\n\n本文に&lt;/details&gt;が現れる。\n\n`</details>`はinline code。\n\n```\n</details>はfence内。\n```",
  "03_実装計画.md": "# 03 実装計画\n\n| T01 | 完了 |",
});

function foldedSections(body: string): { summary: string; inner: string }[] {
  const sections: { summary: string; inner: string }[] = [];
  const pattern =
    /<details>\n<summary>([^\n]*)<\/summary>\n\n([\s\S]*?)\n\n<\/details>/gu;
  for (const match of body.matchAll(pattern))
    sections.push({ summary: match[1]!, inner: match[2]! });
  return sections;
}

Given("00から03の内容が既知の同期本文入力がある", function () {
  this.syncInputs = knownInputs();
});

When("full checkpoint 8の同期本文を描画する", function () {
  this.rendered = renderIssueSyncBody("full", 8, this.syncInputs);
});

When("同期条件で先頭{int}件の同期本文を描画する", function (count: number) {
  this.rendered = renderIssueSyncBody(
    this.syncMode,
    this.syncCheckpoint,
    this.syncInputs.slice(0, count),
  );
});

Then("最初の折りたたみより前は00の全文と一致する", function () {
  const first = this.rendered.indexOf("<details>");
  assert.notEqual(first, -1, "折りたたみがありません");
  assert.equal(
    this.rendered.slice(0, first),
    `${this.syncInputs[0]!.text.trimEnd()}\n\n`,
  );
});

Then(
  "折りたたみは3つあり見出しは01_要件定義.md、02_設計.md、03_実装計画.mdの順である",
  function () {
    assert.deepEqual(
      foldedSections(this.rendered).map((section) => section.summary),
      ARTIFACT_NAMES.slice(1),
    );
  },
);

Then("各折りたたみの中身は対応する成果物の全文と一致する", function () {
  const inner = foldedSections(this.rendered).map((section) => section.inner);
  assert.deepEqual(
    inner,
    this.syncInputs.slice(1).map((artifact) => EXPECTED_INNER[artifact.name]),
  );
  assert.ok(this.rendered.endsWith("</details>\n"), "末尾は改行1つで終わる");
});

Then(
  "検証済みfull stagingから生成した同期本文は同じ入力の描画結果と一致する",
  function () {
    const root = this.initRepo();
    const answers = Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [
        `Q-${String(index + 1).padStart(2, "0")}`,
        { answer: false as const, evidence: "fixture evidence" },
      ]),
    );
    const staging = createIssueStaging(root, {
      title: "同期本文の折りたたみ",
      answers,
      requestedMode: "full",
      now: new Date("2026-09-16T00:00:00.000Z"),
    }).path;
    const contents: IssueSyncArtifactText[] = [
      { name: ARTIFACT_NAMES[0], text: materializedRequest() },
      { name: ARTIFACT_NAMES[1], text: considerationDocument("01 要件定義") },
      { name: ARTIFACT_NAMES[2], text: considerationDocument("02 設計") },
      { name: ARTIFACT_NAMES[3], text: considerationDocument("03 実装計画") },
    ];
    for (const artifact of contents)
      fs.writeFileSync(path.join(staging, artifact.name), artifact.text);
    refreshStoredStagingDigest(staging);
    const built = buildIssueSyncBody(staging, 8);
    assert.equal(built.body, renderIssueSyncBody("full", 8, contents));
    assert.ok(
      built.body.startsWith(materializedRequest().trimEnd()),
      "本文は00で始まる",
    );
    assert.equal(foldedSections(built.body).length, 3);
  },
);

Then("同期本文は成果物を区切り線で連結した従来形式である", function () {
  const count = this.syncMode === "full" ? 2 : 1;
  const expected = `${this.syncInputs
    .slice(0, count)
    .map((artifact) => artifact.text.trimEnd())
    .join("\n\n---\n\n")}\n`;
  assert.equal(this.rendered, expected);
  assert.ok(!this.rendered.includes("<details>"), "折りたたみを含まない");
});

/**
 * **HTML境界と表示内容の両方を見る。** 本文が持つ生の閉じtagは折りたたみを早期に閉じ、
 * 以降の成果物が区画の外へ出る。構造の均衡だけでなく、codeの内側が保たれることも確かめる。
 */
Then("折りたたみの構造は本文中の閉じtagで壊れない", function () {
  const structural = this.rendered.split("\n\n</details>").length - 1;
  assert.equal(
    structural,
    (this.rendered.match(/<details>/gu) ?? []).length,
    "開始と構造上の終端が釣り合わない",
  );
  const design = foldedSections(this.rendered)[1];
  assert.ok(design, "02の折りたたみがありません");
  assert.match(design.inner, /本文に&lt;\/details&gt;が現れる。/u);
  assert.match(design.inner, /`<\/details>`はinline code。/u);
  assert.match(design.inner, /```\n<\/details>はfence内。\n```/u);
});

/**
 * **境界の判定そのものを字面で固定する。** 折りたたみ本文の一致検査は正常入力だけを通すため、
 * 属性付き・大文字・開始tagのような形を取りこぼしても気付けない。
 */
Then("折りたたみ境界の置き換えは形を変えた閉じtagも捕まえる", function () {
  const replaced: readonly [string, string][] = [
    ["</details>", "&lt;/details&gt;"],
    ["</DETAILS>", "&lt;/DETAILS&gt;"],
    ["</ details >", "&lt;/ details &gt;"],
    ["</details foo>", "&lt;/details foo&gt;"],
    ["<details>", "&lt;details&gt;"],
    ["<details open>", "&lt;details open&gt;"],
  ];
  for (const [input, expected] of replaced)
    assert.equal(escapeFoldBoundary(input), expected, input);
  const kept = [
    "`</details>`",
    "```\n</details>\n```",
    "~~~\n</details>\n~~~",
    "< /details>",
  ];
  for (const input of kept)
    assert.equal(escapeFoldBoundary(input), input, input);
});
