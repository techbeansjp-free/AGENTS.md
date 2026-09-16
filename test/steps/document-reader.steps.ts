import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface DocumentReaderWorld extends WorkflowWorld {
  workflowDocument: string;
  overview: string;
  index: string;
}

const { Given, When, Then } = stepDefinitions<DocumentReaderWorld>();
const repositoryRoot = process.cwd();
const READERS = [
  "発注・評価する人",
  "実装・レビューする人",
  "運用する人",
] as const;
const READER_HEADING = "## 文書の読者";

/**
 * **実repositoryのfileを読む。** fixtureへ書き写すと、規範や概要から節が消えても
 * 検査が緑のまま残る（Issue #1262の型）。読むのは配布される規範文書と製品仕様の正本である。
 */
function readRepositoryFile(relative: string): string {
  return fs.readFileSync(path.join(repositoryRoot, relative), "utf8");
}

function section(document: string, heading: string): string {
  const start = document.indexOf(`${heading}\n`);
  assert.notEqual(start, -1, `見出しがありません: ${heading}`);
  const rest = document.slice(start + heading.length + 1);
  const next = /^## /mu.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

function firstTableColumn(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("|---"))
    .map((line) => line.split("|")[1]!.trim());
}

Given("配布される規範文書がある", function () {
  this.workflowDocument = "";
});

When("実repositoryの開発ワークフロー正本を読む", function () {
  this.workflowDocument = readRepositoryFile(
    ".agent-skill-chain/docs/01_開発ワークフロー.md",
  );
});

Then("文書の読者の節がある", function () {
  assert.ok(this.workflowDocument.includes(`${READER_HEADING}\n`));
});

Then(
  "読者表は発注・評価する人、実装・レビューする人、運用する人の3区分を持つ",
  function () {
    const rows = firstTableColumn(
      section(this.workflowDocument, READER_HEADING),
    );
    assert.deepEqual(rows.slice(1), [...READERS]);
  },
);

Then("文書の読者の節は強制点を持たないと明記する", function () {
  assert.match(
    section(this.workflowDocument, READER_HEADING),
    /本節は案内であり、強制点を持たない/u,
  );
});

Given("製品のシステム仕様書がある", function () {
  this.overview = "";
  this.index = "";
});

When("実repositoryのシステム概要と仕様書索引を読む", function () {
  this.overview = readRepositoryFile("docs/specs/01_システム概要/00_概要.md");
  this.index = readRepositoryFile("docs/specs/00_仕様書構成/00_仕様書索引.md");
});

Then(
  "概要は目的、利用者、解決する課題、提供する価値、対象外、全体の流れの見出しを持つ",
  function () {
    const headings = this.overview
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3));
    for (const expected of [
      "目的",
      "利用者",
      "解決する課題",
      "提供する価値",
      "対象外",
      "全体の流れ",
    ])
      assert.ok(
        headings.includes(expected),
        `概要に見出しがありません: ${expected}`,
      );
  },
);

Then("概要はStep 0からStep 11までの工程図を1枚持つ", function () {
  const diagrams = [...this.overview.matchAll(/```mermaid\n([\s\S]*?)```/gu)];
  assert.equal(diagrams.length, 1, "mermaid図は1枚");
  const diagram = diagrams[0]![1]!;
  for (let step = 0; step <= 11; step += 1)
    assert.match(
      diagram,
      new RegExp(`step${step}\\["Step ${step} `, "u"),
      `工程図にStep ${step}がありません`,
    );
});

Then("索引は読み手別の読み順の表に3区分の読者を持つ", function () {
  const rows = firstTableColumn(section(this.index, "## 読み手別の読み順"));
  assert.deepEqual(rows.slice(1), [...READERS]);
});
