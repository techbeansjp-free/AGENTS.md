import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

const POLICY_DOCUMENT = ".agent-skill-chain/docs/00_運用ポリシー.md";
const WORKFLOW_DOCUMENT = ".agent-skill-chain/docs/01_開発ワークフロー.md";
const GUIDE_DOCUMENT = "AGENTS.md";
const PURPOSE_HEADING = "## 目的と成立条件";

interface PropositionWorld extends WorkflowWorld {
  document: string;
  documentPath: string;
  section: string;
  linkTarget: string;
}

const { Given, When, Then } = stepDefinitions<PropositionWorld>();

function read(relative: string): string {
  return fs.readFileSync(path.resolve(relative), "utf8");
}

function purposeSection(document: string): string {
  const start = document.indexOf(PURPOSE_HEADING);
  assert.notEqual(start, -1, "目的と成立条件の節がありません");
  const next = document.indexOf("\n## ", start + PURPOSE_HEADING.length);
  return next === -1 ? document.slice(start) : document.slice(start, next);
}

function resolveLink(source: string, pattern: RegExp): string {
  const matched = pattern.exec(source);
  assert.notEqual(matched, null, "参照が見つかりません");
  const target = matched?.[1] ?? "";
  const base = path.dirname(
    path.resolve(
      source === read(GUIDE_DOCUMENT) ? GUIDE_DOCUMENT : WORKFLOW_DOCUMENT,
    ),
  );
  return path.resolve(base, target);
}

Given("規範的正本の運用ポリシーがある", function () {
  this.documentPath = POLICY_DOCUMENT;
  this.document = read(POLICY_DOCUMENT);
});

Given("利用案内がある", function () {
  this.documentPath = GUIDE_DOCUMENT;
  this.document = read(GUIDE_DOCUMENT);
});

Given("規範的正本の開発ワークフローがある", function () {
  this.documentPath = WORKFLOW_DOCUMENT;
  this.document = read(WORKFLOW_DOCUMENT);
});

When("目的と成立条件の節を読む", function () {
  this.section = purposeSection(this.document);
});

When("既存の節構成を読む", function () {
  this.section = this.document;
});

When("索引の参照を解決する", function () {
  assert.ok(
    this.document.includes("目的と成立条件、権限と所有権は"),
    "索引が目的と成立条件を名指ししていません",
  );
  this.linkTarget = resolveLink(
    this.document,
    /\[00_運用ポリシー\.md\]\(([^)]+)\)/u,
  );
});

When("薄い支援層の記述から参照を解決する", function () {
  const marker = "薄い支援層";
  assert.ok(this.document.includes(marker), "薄い支援層の記述がありません");
  this.linkTarget = resolveLink(
    this.document,
    /「薄い」の判定基準と、開発速度を成立条件とする命題は\[00_運用ポリシー\.md\]\(([^)]+)\)/u,
  );
});

Then(
  "速さが開発速度を指し正しさと開発速度の双方が成立条件であると読める",
  function () {
    assert.ok(
      this.section.includes(
        "ここでいう速さは開発速度、すなわち要求から成果物を提出するまでに要する時間の短さを指し、成果物自体の実行性能を指さない",
      ),
    );
    assert.ok(
      this.section.includes(
        "正しさと開発速度はトレードオフではなく、両方が成立条件である",
      ),
    );
    assert.ok(
      this.section.includes(
        "正しさを満たしても開発速度を失った状態は、目的を達成していない",
      ),
    );
    assert.ok(
      this.section.includes(
        "開発速度を満たしても正しさを失った状態も、目的を達成していない",
      ),
    );
  },
);

Then(
  "支援層の所要時間が成果物構築の所要時間を上回らないことを含む",
  function () {
    assert.ok(
      this.section.includes(
        "支援層の所要時間が成果物構築の所要時間を上回らないこと",
      ),
    );
  },
);

Then("既存手段の縮小を先に評価すると読める", function () {
  assert.ok(
    this.section.includes("既存手段の縮小で目的を満たせないかを先に評価する"),
  );
  assert.ok(
    this.section.includes(
      "手段が開発速度を損なうとき、縮小するのは手段の側である",
    ),
  );
});

Then("目的と成立条件の節へ到達できる", function () {
  const target = read(path.relative(path.resolve("."), this.linkTarget));
  assert.ok(target.includes(PURPOSE_HEADING));
});

Then(
  "権限と所有権とrole分離とfail-closedとconformanceとrisk比例型ruleの各節が残っている",
  function () {
    for (const heading of [
      "## 権限",
      "## 所有権",
      "## role分離とmodel tier",
      "## fail-closed不変条件",
      "## conformance scopeと適用可否",
      "## risk比例型rule",
    ])
      assert.ok(this.section.includes(heading), `${heading}がありません`);
    for (const sentinel of [
      "パッケージ既定値は`delivery.stopAt=pull_request`である",
      "同一scopeの工程責務は",
      "モードの根拠が不明なら`full`を選ぶ",
      "強制強度は具体的なrisk",
    ])
      assert.ok(
        this.section.includes(sentinel),
        `${sentinel}が改変されています`,
      );
  },
);
