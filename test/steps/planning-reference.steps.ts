import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { DataTable } from "@cucumber/cucumber";
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
  contentFailures: string[];
}
const { Given, When, Then } = stepDefinitions<PlanningReferenceWorld>();
const REQUEST = "00_要求定義.md";
const REQUIREMENTS = "01_要件定義.md";
const DESIGN = "02_設計.md";
const OVERVIEW = "概要は00_要求定義.md §1・§2を参照";
const EXCLUSION = "設計対象外は00_要求定義.md §2.2を参照";
const CONTEXT = "コンテキストは00_要求定義.md §4.1を参照";
const DC = "開発考慮事項の適用判定は00_要求定義.md §6.1と同じ";
const MARKERS = { 概要: OVERVIEW, 対象外: EXCLUSION, コンテキスト: CONTEXT };

When(
  "Planningの{string}の{string}で次の有限内容境界を検査する",
  function (side: string, shape: string, cases: DataTable) {
    const originals = { ...this.documents };
    const [file, heading, marker] =
      side === "source"
        ? [REQUEST, "4.1 境界づけられたコンテキスト", CONTEXT]
        : [REQUIREMENTS, "1. システム・変更概要", OVERVIEW];
    this.contentFailures = [];
    for (const row of cases.hashes()) {
      const value = row["値"]!.replaceAll("\\n", "\n")
        .replaceAll("\\t", "\t")
        .replaceAll("\\s", " ")
        .replaceAll("既知引用", `\`${marker}\``);
      const body =
        shape === "table"
          ? "| 項目 | 内容 |\n|---|---|\n" +
            value
              .split("\n")
              .map((line) => `| 判断 | ${line} |`)
              .join("\n")
          : shape === "list"
            ? value
                .split("\n")
                .map((line) => `- 判断: ${line}`)
                .join("\n")
            : value;
      this.documents = {
        ...originals,
        [file!]: replacePlanningBody(originals[file!]!, heading!, body),
      };
      for (const [name, text] of Object.entries(this.documents))
        fs.writeFileSync(path.join(this.staging, name), text);
      const result = validateIssue(this.staging);
      if (result.valid !== (row["判定"] === "合格"))
        this.contentFailures.push(
          `${side}/${shape}/${JSON.stringify(value)}: ${result.valid}; ${result.errors.join("; ")}`,
        );
    }
  },
);

Then("有限内容境界の全例が期待した判定になる", function () {
  assert.deepEqual(this.contentFailures, []);
});

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

When(
  "Planningの{string}本文を{string}にする",
  function (section: string, body: string) {
    const targets: Record<string, readonly [string, string]> = {
      概要: [REQUIREMENTS, "1. システム・変更概要"],
      コンテキスト: [DESIGN, "2.1 境界づけられたコンテキスト"],
      source: [REQUEST, "4.1 境界づけられたコンテキスト"],
    };
    const [file, heading] = targets[section]!;
    this.documents[file] = replacePlanningBody(
      this.documents[file]!,
      heading,
      body.replaceAll("\\n", "\n").replaceAll("\\t", "\t"),
    );
  },
);

When("Planningのsource表の値を{string}にする", function (value: string) {
  this.documents[REQUEST] = replacePlanningBody(
    this.documents[REQUEST]!,
    "4.1 境界づけられたコンテキスト",
    `| 項目 | 内容 |\n|---|---|\n| コンテキスト | ${value.replaceAll("\\t", "\t")} |`,
  );
});

When("Planningの概要markerに{string}を付け足す", function (extra: string) {
  this.documents[REQUIREMENTS] = replacePlanningBody(
    this.documents[REQUIREMENTS]!,
    "1. システム・変更概要",
    OVERVIEW + extra.replaceAll("\\n", "\n"),
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
    case "詳細本文内で引用":
      replace(
        REQUIREMENTS,
        OVERVIEW,
        `共有の判断は別資料を参照する。\n\`${OVERVIEW}\``,
      );
      replace(
        DESIGN,
        EXCLUSION,
        `共有の判断は別資料を参照する。\n\`${EXCLUSION}\``,
      );
      replace(
        DESIGN,
        CONTEXT,
        `共有の判断は別資料を参照する。\n\`${CONTEXT}\``,
      );
      break;
    case "引用をfence化":
    case "引用をcomment化":
      for (const file of Object.keys(this.documents))
        for (const marker of Object.values(MARKERS)) {
          const quoted = `\`${marker}\``;
          this.documents[file] = this.documents[file]!.replaceAll(
            quoted,
            change === "引用をfence化"
              ? `\`\`\`\n${quoted}\n\`\`\``
              : `<!-- ${quoted} -->`,
          );
        }
      break;
    case "実参照と同じ節に引用":
      replace(REQUIREMENTS, OVERVIEW, `${OVERVIEW}\n\`${OVERVIEW}\``);
      break;
    case "詳細形式":
      replace(REQUIREMENTS, OVERVIEW, "利用者が重複せず目的を伝えられる。");
      replace(DESIGN, EXCLUSION, "同期権限は変更しない。");
      replace(
        DESIGN,
        CONTEXT,
        "コンテキストはPlanningでありownerはprojectである。",
      );
      break;
    case "詳細形式の補足参照":
      replace(
        REQUIREMENTS,
        OVERVIEW,
        "概要を利用者に提示し、変更の目的と価値を伝える。実装手順は03_実装計画.md §9を参照。",
      );
      replace(
        DESIGN,
        EXCLUSION,
        "設計対象外を同期権限の変更とし、既存の権限を保持する。\n共有の判断は00_要求定義.md §2.2を参照。",
      );
      replace(
        DESIGN,
        CONTEXT,
        "コンテキストをPlanningに限定し、projectが判断を所有する。\n境界の詳細は00_要求定義.md §4.1を参照。",
      );
      break;
    case "source symlink":
      this.sourceSymlink = true;
      break;
    case "source欠落":
      replace(REQUEST, "### 2.2 対象外（必須）", "### 2.5 別節");
      break;
    case "source空":
      replace(REQUEST, "- 外部同期の権限変更は行わない。", "");
      break;
    case "sourceラベルのみ":
      replace(REQUEST, "- 外部同期の権限変更は行わない。", "- 対象外:");
      break;
    case "source表の値だけ空":
      replace(REQUEST, "| Planning | project owner |", "| | |");
      break;
    case "source表が参照のみ":
      replace(
        REQUEST,
        "| Planning | project owner |",
        "| 01_要件定義.mdを参照 | - |",
      );
      break;
    case "sourceplaceholder":
      replace(REQUEST, "- 外部同期の権限変更は行わない。", "- {対象外}");
      break;
    case "source参照のみ":
      replace(
        REQUEST,
        "- 外部同期の権限変更は行わない。",
        "01_要件定義.mdを参照",
      );
      break;
    case "source重複":
      this.documents[REQUEST] += "\n### 2.2 対象外（必須）\n対象外はない。\n";
      break;
    case "target重複":
      this.documents[REQUIREMENTS] +=
        `\n## 1. システム・変更概要\n${OVERVIEW}\n`;
      break;
    case "target欠落":
      replace(REQUIREMENTS, "1. システム・変更概要", "1. 別節");
      break;
    case "自己参照":
      replace(REQUIREMENTS, "00_要求定義.md §1・§2", "01_要件定義.md §1");
      break;
    case "後方参照":
      replace(REQUIREMENTS, "00_要求定義.md §1・§2", "03_実装計画.md §1");
      break;
    case "を使う後方参照":
      replace(REQUIREMENTS, OVERVIEW, "概要を03_実装計画.md §9を参照");
      break;
    case "を使う自己参照":
      replace(REQUIREMENTS, OVERVIEW, "概要を01_要件定義.md §1を参照");
      break;
    case "を使う既知参照先":
      replace(REQUIREMENTS, OVERVIEW, OVERVIEW.replace("概要は", "概要を"));
      break;
    case "を使う対象外参照":
      replace(DESIGN, EXCLUSION, "設計対象外を03_実装計画.md §9を参照");
      break;
    case "を使うコンテキスト参照":
      replace(DESIGN, CONTEXT, "コンテキストを03_実装計画.md §9を参照");
      break;
    case "を使う連鎖":
      replace(
        REQUEST,
        "- 外部同期の権限変更は行わない。",
        "設計対象外を03_実装計画.md §9を参照",
      );
      break;
    case "未知path":
      replace(
        REQUIREMENTS,
        "00_要求定義.md §1・§2",
        "../00_要求定義.md §1・§2",
      );
      break;
    case "未知節":
      replace(DESIGN, "§2.2", "§2.3");
      break;
    case "Unicode類似":
      replace(DESIGN, "§2.2", "§２.２");
      break;
    case "連鎖":
      replace(REQUEST, "- 外部同期の権限変更は行わない。", EXCLUSION);
      break;
    case "余分な本文":
      replace(
        REQUIREMENTS,
        OVERVIEW,
        `${OVERVIEW}\n変更後は別の価値を提供する。`,
      );
      break;
    case "許可節外":
      replace(REQUIREMENTS, OVERVIEW, "詳細を記述する。");
      this.documents[REQUIREMENTS] += `\n## 8. 権限\n${OVERVIEW}\n`;
      break;
    case "code内":
      this.documents[DESIGN] += `\n\`\`\`\n${EXCLUSION}\n\`\`\`\n`;
      break;
    case "comment内":
      this.documents[DESIGN] += `\n<!-- ${EXCLUSION} -->\n`;
      break;
    case "comment内の偽見出し":
      replace(
        REQUIREMENTS,
        "## 1. システム・変更概要",
        "<!--\n## 1. システム・変更概要",
      );
      replace(
        REQUIREMENTS,
        "## 7. 非機能要件",
        "## 終端\n-->\n## 7. 非機能要件",
      );
      break;
    case "code内の偽見出し":
      replace(
        REQUIREMENTS,
        "## 1. システム・変更概要",
        "```\n## 1. システム・変更概要",
      );
      replace(
        REQUIREMENTS,
        "## 7. 非機能要件",
        "## 終端\n```\n## 7. 非機能要件",
      );
      break;
    case "引用内":
      this.documents[DESIGN] += `\n> ${CONTEXT}\n`;
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

When("Planningに{string}の説明用引用を加える", function (kind: string) {
  const marker = MARKERS[kind as keyof typeof MARKERS];
  assert.ok(marker);
  this.documents[DESIGN] +=
    `\n## 3. 設計判断\n| 判断 | 記法の説明 |\n|---|---|\n| 上流で判断する | \`${marker}\` を固定文として使える。 |\n`;
});

When(
  "Planningの{string}を{string}の引用だけにする",
  function (side: string, kind: string) {
    const marker = MARKERS[kind as keyof typeof MARKERS];
    assert.ok(marker);
    const file =
      side === "source" ? REQUEST : kind === "概要" ? REQUIREMENTS : DESIGN;
    const before =
      side !== "source"
        ? marker
        : kind === "概要"
          ? "利用者が重複せずに目的を伝えられる。"
          : kind === "対象外"
            ? "- 外部同期の権限変更は行わない。"
            : "| Planning | project owner |";
    const after =
      side === "source" && kind === "コンテキスト"
        ? `| \`${marker}\` | \`${marker}\` |`
        : `\`${marker}\``;
    assert.ok(this.documents[file]!.includes(before));
    this.documents[file] = this.documents[file]!.replace(before, after);
  },
);

When("Planningの説明に{string}の不正markerを加える", function (kind: string) {
  const forms: Record<string, string> = {
    未知path引用: `\`${OVERVIEW.replace("00_", "../00_")}\``,
    未知節引用: `\`${EXCLUSION.replace("§2.2", "§2.3")}\``,
    二重backtick: `\`\`${CONTEXT}\`\``,
    開始二重backtick: `\`\`${OVERVIEW}\``,
    終了二重backtick: `\`${EXCLUSION}\`\``,
    閉じ引用なし: `\`${OVERVIEW}`,
    余分な引用本文: `\`例: ${EXCLUSION}\``,
    引用内改行: `\`${CONTEXT.replace("§4.1", "\n§4.1")}\``,
    裸marker: OVERVIEW,
    fence内の裸marker: `\`\`\`\n${EXCLUSION}\n\`\`\``,
    comment内の裸marker: `<!-- ${CONTEXT} -->`,
    blockquote内の裸marker: `> ${OVERVIEW}`,
    を使う後方参照の引用: "`概要を03_実装計画.md §9を参照`",
    を使う未知pathの引用: "`概要を../00_要求定義.md §1・§2を参照`",
    を使う後方参照のfence: "```\n概要を03_実装計画.md §9を参照\n```",
    を使う後方参照のcomment: "<!-- 概要を03_実装計画.md §9を参照 -->",
    を使う後方参照のblockquote: "> 概要を03_実装計画.md §9を参照",
  };
  assert.ok(forms[kind]);
  this.documents[DESIGN] += `\n## 3. 設計判断\n${forms[kind]}\n`;
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
