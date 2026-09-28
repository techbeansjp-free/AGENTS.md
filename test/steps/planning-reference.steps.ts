import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildIssueSyncBody,
  createIssueStaging,
  issueRequiredHeadings,
  validateIssue,
} from "../../src/domain/issue.js";
import { main } from "../../src/cli.js";
import { refreshStoredStagingDigest } from "../../src/domain/staging.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface PlanningReferenceWorld extends WorkflowWorld {
  staging: string;
  documents: Record<string, string>;
  validation: ReturnType<typeof validateIssue>;
  sourceSymlink: boolean;
}
const { Given, When, Then } = stepDefinitions<PlanningReferenceWorld>();
const REQUEST = "00_要求定義.md";
const REQUIREMENTS = "01_要件定義.md";
const DESIGN = "02_設計.md";
const OVERVIEW = "概要は00_要求定義.md §1・§2を参照";
const EXCLUSION = "設計対象外は00_要求定義.md §2.2を参照";
const CONTEXT = "コンテキストは00_要求定義.md §4.1を参照";
const DC = "開発考慮事項の適用判定は00_要求定義.md §6.1と同じ";
function replacePlanningBody(
  text: string,
  heading: string,
  body: string,
): string {
  const lines = text.split("\n");
  const start = lines.findIndex(
    (line) => /^#{2,6} /u.test(line) && line.replace(/^#+ /u, "") === heading,
  );
  assert.ok(start >= 0, heading);
  const level = lines[start]!.match(/^#+/u)![0].length;
  let end = start + 1;
  while (
    end < lines.length &&
    !new RegExp(`^#{2,${level}} `, "u").test(lines[end]!)
  )
    end += 1;
  lines.splice(start + 1, end - start - 1, "", body, "");
  return lines.join("\n");
}

Given("Issue1523の封印済みPlanningの固定snapshotがある", function () {
  this.staging = this.temp("asc-planning-sealed-");
  this.sourceSymlink = false;
  this.documents = JSON.parse(
    fs.readFileSync("test/fixtures/planning-sealed-1523.json", "utf8"),
  ) as Record<string, string>;
});

When("Planningの3対象節だけを正規の固定参照に置き換える", function () {
  for (const [file, heading, marker] of [
    [REQUIREMENTS, "1. システム・変更概要", OVERVIEW],
    [DESIGN, "1.2 設計対象外", EXCLUSION],
    [DESIGN, "2.1 境界づけられたコンテキスト", CONTEXT],
  ] as const)
    this.documents[file] = replacePlanningBody(
      this.documents[file]!,
      heading,
      marker,
    );
});

Given("同stagingの00に具体的な内容を持つ3つのPlanning参照がある", function () {
  this.staging = this.temp("asc-planning-reference-");
  this.sourceSymlink = false;
  const source = issueRequiredHeadings("full")
    .map((heading) => {
      const body =
        heading === "1. 目的と背景"
          ? "### 1.1 目的（必須、1文）\n利用者が重複せずに目的を伝えられる。"
          : heading === "2. 対象範囲"
            ? "### 2.1 対象内（必須）\n- CLI文書の参照を検証する。\n### 2.2 対象外（必須）\n- 外部同期の権限変更は行わない。"
            : heading === "4. ドメイン影響"
              ? "### 4.1 境界づけられたコンテキスト\n| コンテキスト | 所有者 |\n|---|---|\n| Planning | project owner |"
              : "既存の契約を保持する。";
      return `## ${heading}\n\n${body}\n`;
    })
    .join("\n");
  this.documents = {
    [REQUEST]: `${source}\n| モード | full |\n${Array.from({ length: 7 }, (_, i) => `P-0${i + 1}: 既存検証を保持`).join("\n")}\n${["DC-PRIVACY", "DC-OBSERVABILITY", "DC-UX", "DC-TOKENS"].map((id) => `| ${id} | 対象 | not-applicable | 文書参照のみで新機能を持たない | SCN-PRAT-001 |`).join("\n")}\nScenario: SCN-PRAT-001 参照を検査する\n  Given 具体的なsourceがある\n  When 検証する\n  Then 合格する\n`,
    [REQUIREMENTS]: `## 1. システム・変更概要\n\n${OVERVIEW}\n\n## 7. 非機能要件\n${DC}\n`,
    [DESIGN]: `## 1. 設計方針\n### 1.0 開発考慮事項の適用判定（必須）\n${DC}\n### 1.2 設計対象外\n\n${EXCLUSION}\n\n## 2. システムコンテキストと責務\n### 2.1 境界づけられたコンテキスト\n\n${CONTEXT}\n`,
    "03_実装計画.md": DC,
  };
});

When("Planning参照に{string}の変更を加える", function (change: string) {
  const replace = (file: string, before: string, after: string): void => {
    assert.ok(this.documents[file]!.includes(before), before);
    this.documents[file] = this.documents[file]!.replace(before, after);
  };
  switch (change) {
    case "参照形式":
      break;
    case "外側空白":
      replace(REQUIREMENTS, OVERVIEW, ` \t${OVERVIEW}\t `);
      replace(DESIGN, EXCLUSION, ` \t${EXCLUSION}\t `);
      replace(DESIGN, CONTEXT, ` \t${CONTEXT}\t `);
      break;
    case "詳細形式":
    case "詳細形式の補足参照":
      replace(REQUIREMENTS, OVERVIEW, "利用者が重複せず目的を伝えられる。");
      replace(DESIGN, EXCLUSION, "同期権限は変更しない。");
      replace(DESIGN, CONTEXT, "Planningの判断をprojectが所有する。");
      if (change === "詳細形式の補足参照")
        this.documents[REQUIREMENTS] +=
          "\n実装手順は03_実装計画.md §9を参照。\n";
      break;
    case "source symlink":
      this.sourceSymlink = true;
      break;
    case "source file欠落":
      delete this.documents[REQUEST];
      break;
    case "source欠落":
      replace(REQUEST, "### 2.2 対象外（必須）", "### 2.5 別節");
      break;
    case "概要source空":
      this.documents[REQUEST] = replacePlanningBody(
        this.documents[REQUEST]!,
        "1. 目的と背景",
        "",
      );
      break;
    case "コンテキストsource欠落":
      replace(REQUEST, "### 4.1 境界づけられたコンテキスト", "### 4.9 別節");
      break;
    case "source空":
    case "source見出しのみ":
    case "source code/commentのみ":
    case "sourceplaceholder":
      replace(
        REQUEST,
        "- 外部同期の権限変更は行わない。",
        change === "source空"
          ? ""
          : change === "source見出しのみ"
            ? "#### 下位の見出し\n##### 詳細"
            : change === "sourceplaceholder"
              ? "{対象外}"
              : "<!--説明-->\n```text\n説明\n```\n`説明`",
      );
      break;
    case "source重複":
      this.documents[REQUEST] += "\n### 2.2 対象外（必須）\n対象外はない。\n";
      break;
    case "target重複":
      this.documents[REQUIREMENTS] += "\n## 1. システム・変更概要\n詳細本文\n";
      break;
    case "DC空":
      replace(
        REQUEST,
        "| DC-PRIVACY | 対象 | not-applicable | 文書参照のみで新機能を持たない | SCN-PRAT-001 |",
        "| DC-PRIVACY | 対象 | not-applicable | | | ",
      );
      break;
    case "SCNなし":
      replace(REQUEST, "Scenario: SCN-PRAT-001", "例の識別子を未記入");
      break;
    case "source必須欄なし":
      replace(REQUEST, "## 7. 受け入れ条件と成功基準", "## 7. 別名");
      break;
    default:
      assert.fail(`未知の反例: ${change}`);
  }
});

When("Planningのsource最小本文を{string}にする", function (body: string) {
  this.documents[REQUEST] = this.documents[REQUEST]!.replace(
    "- 外部同期の権限変更は行わない。",
    body.replaceAll("\\n", "\n"),
  );
});

When(
  "Planningの非正規形{string}はsourceを解決せずlegacy判定を保つ",
  function (shape: string) {
    // 非必須source節を欠落させる。正規形ならD1だけが拒否する対照。
    this.documents[REQUEST] = this.documents[REQUEST]!.replace(
      "### 2.2 対象外（必須）",
      "### 2.5 別節",
    );
    const original = this.documents[DESIGN]!;
    const neutral = replacePlanningBody(
      original,
      "1.2 設計対象外",
      "同期権限は変更しない。",
    );
    const bodies: Record<string, string> = {
      引用: `\`${EXCLUSION}\``,
      fence: `\`\`\`text\n${EXCLUSION}\n\`\`\``,
      comment: `<!-- ${EXCLUSION} -->`,
      強調: `**${EXCLUSION}**`,
      list: `- ${EXCLUSION}`,
      表: `| 項目 | 内容 |\n|---|---|\n| 説明 | ${EXCLUSION} |`,
      blockquote: `> ${EXCLUSION}`,
      未知path: EXCLUSION.replace("00_要求定義.md", "../unknown.md"),
      未知節: EXCLUSION.replace("§2.2", "§9"),
      内部改行: EXCLUSION.replace("は", "は\n"),
      comment追記: `${EXCLUSION}\n<!-- 注記 -->`,
      本文追記: `${EXCLUSION}\n追加の判断`,
      子見出し: `${EXCLUSION}\n#### 注記`,
      自然言語: "設計対象外を別資料と同じにする。",
    };
    let candidate =
      bodies[shape] === undefined
        ? neutral
        : replacePlanningBody(original, "1.2 設計対象外", bodies[shape]!);
    if (shape === "別節") candidate += `\n## 別節\n${EXCLUSION}\n`;
    else if (shape === "別file")
      this.documents[REQUIREMENTS] += `\n## 別節\n${EXCLUSION}\n`;
    else if (shape === "target欠落")
      candidate = original.replace("1.2 設計対象外", "1.9 別節");
    else if (shape === "fence内見出し" || shape === "comment内見出し") {
      const section = `### 1.2 設計対象外\n${EXCLUSION}\n### 終端`;
      candidate =
        neutral.replace("### 1.2 設計対象外", "### 1.9 別節") +
        (shape === "fence内見出し"
          ? `\n\`\`\`\n${section}\n\`\`\``
          : `\n<!--\n${section}\n-->`);
    } else
      assert.ok(
        shape in bodies ||
          shape === "別節" ||
          shape === "別file" ||
          shape === "target欠落",
      );
    for (const [name, text] of Object.entries(this.documents))
      fs.writeFileSync(path.join(this.staging, name), text);
    fs.writeFileSync(path.join(this.staging, DESIGN), original);
    assert.ok(
      validateIssue(this.staging).errors.some((error) =>
        error.includes("上流参照元"),
      ),
    );
    for (const broken of [false, true]) {
      const request = this.documents[REQUEST]!.replace(
        "## 7. 受け入れ条件と成功基準",
        broken ? "## 7. 別名" : "## 7. 受け入れ条件と成功基準",
      );
      fs.writeFileSync(path.join(this.staging, REQUEST), request);
      fs.writeFileSync(path.join(this.staging, DESIGN), neutral);
      const legacy = validateIssue(this.staging);
      assert.equal(legacy.valid, !broken);
      fs.writeFileSync(path.join(this.staging, DESIGN), candidate);
      assert.deepEqual(validateIssue(this.staging), legacy);
    }
  },
);

When("Planningの{string}判定を詳細形式と比較する", function (mode: string) {
  const source = this.documents[REQUEST]!.replace(
    "| モード | full |",
    `| モード | ${mode} |`,
  ).replace("### 2.2 対象外（必須）", "### 2.5 別節");
  for (const [name, text] of Object.entries(this.documents))
    fs.writeFileSync(path.join(this.staging, name), text);
  fs.writeFileSync(path.join(this.staging, REQUEST), source);
  const canonical = validateIssue(this.staging);
  assert.ok(canonical.errors.every((error) => !error.includes("上流参照")));
  fs.writeFileSync(
    path.join(this.staging, DESIGN),
    this.documents[DESIGN]!.replace(EXCLUSION, "同期権限は変更しない。"),
  );
  assert.deepEqual(validateIssue(this.staging), canonical);
});

When("Planning参照を検証する", function () {
  for (const [name, text] of Object.entries(this.documents))
    fs.writeFileSync(path.join(this.staging, name), text);
  if (this.sourceSymlink) {
    const outside = path.join(this.temp("asc-planning-source-"), REQUEST);
    fs.renameSync(path.join(this.staging, REQUEST), outside);
    fs.symlinkSync(outside, path.join(this.staging, REQUEST));
  }
  this.validation = validateIssue(this.staging);
});

Then("Planning参照は{string}になる", function (expected: string) {
  assert.equal(
    this.validation.valid,
    expected === "合格",
    this.validation.errors.join("; "),
  );
  if (expected === "拒否") assert.ok(this.validation.errors.length > 0);
});

When("不正Planningの同期previewを隔離providerで検査する", async function () {
  const root = this.temp("asc-planning-sync-");
  const staging = createIssueStaging(root, {
    title: "invalid-planning-sync-preview",
    answers: Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [
        `Q-${String(index + 1).padStart(2, "0")}`,
        { answer: false as const, evidence: "文書参照のfixture" },
      ]),
    ),
    requestedMode: "full",
    now: new Date("2026-09-28T00:00:00.000Z"),
  }).path;
  for (const [name, text] of Object.entries(this.documents))
    fs.writeFileSync(path.join(staging, name), text);
  refreshStoredStagingDigest(staging);
  for (const checkpoint of [4, 8] as const)
    assert.ok(buildIssueSyncBody(staging, checkpoint).body.length > 0);
  const request = path.join(staging, REQUEST);
  fs.writeFileSync(
    request,
    this.documents[REQUEST]!.replace("## 7. 受け入れ条件と成功基準", "## 欠落"),
  );
  refreshStoredStagingDigest(staging);
  const stubDirectory = this.temp("asc-planning-provider-");
  const calls = path.join(stubDirectory, "calls");
  fs.writeFileSync(calls, "");
  fs.writeFileSync(
    path.join(stubDirectory, "gh"),
    '#!/bin/sh\nprintf "called\\n" >> "$ASC_PLANNING_PROVIDER_CALLS"\nexit 1\n',
    { mode: 0o755 },
  );
  const originalPath = process.env.PATH;
  const originalCalls = process.env.ASC_PLANNING_PROVIDER_CALLS;
  try {
    process.env.PATH = `${stubDirectory}${path.delimiter}${originalPath ?? ""}`;
    process.env.ASC_PLANNING_PROVIDER_CALLS = calls;
    for (const checkpoint of [4, 8])
      await assert.rejects(
        main([
          "issue",
          "sync",
          "--generate-body",
          `--staging-path=${staging}`,
          `--checkpoint=${checkpoint}`,
          "--repo=example/fixture",
          "--issue=1",
          "--dry-run",
        ]),
        /同期本文の成果物が未検証です: 必須項目がありません/u,
      );
    this.calls = fs.readFileSync(calls, "utf8").split("\n").filter(Boolean);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalCalls === undefined)
      delete process.env.ASC_PLANNING_PROVIDER_CALLS;
    else process.env.ASC_PLANNING_PROVIDER_CALLS = originalCalls;
  }
});

Then("同期previewのprovider呼出しは0件である", function () {
  assert.deepEqual(this.calls, []);
});

Then("Planningの比較検証が完了する", function () {
  assert.ok(this.staging);
});
