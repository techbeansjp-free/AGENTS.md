import assert from "node:assert/strict";
import fs from "node:fs";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class IsolatedCopyTrustAnchorWorld extends WorkflowWorld {}

const { Given, Then, When } = stepDefinitions<IsolatedCopyTrustAnchorWorld>();

const QUALITY_PATH = ".agent-skill-chain/docs/02_品質基準.md";
const PLAN_PATH = ".agent-skill-chain/templates/issue/03_実装計画.md";
const QUALITY_HEADING = "### 隔離copy検査の信頼境界";
const PLAN_HEADING = "### 5.1 project選択test layer";

interface SectionRange {
  start: number;
  end: number;
  text: string;
}

function readIsolatedCopyDocuments(): { quality: string; plan: string } {
  return {
    quality: fs.readFileSync(QUALITY_PATH, "utf8"),
    plan: fs.readFileSync(PLAN_PATH, "utf8"),
  };
}

function sectionRange(document: string, heading: string): SectionRange {
  const start = document.indexOf(`${heading}\n`);
  assert.notEqual(start, -1, `対象節がありません: ${heading}`);
  const afterHeading = start + heading.length + 1;
  const nextHeading = /^#{1,3} /mu.exec(document.slice(afterHeading));
  const end = nextHeading ? afterHeading + nextHeading.index : document.length;
  return { start, end, text: document.slice(start, end) };
}

function tableCells(section: string, firstCell: string): string[] | undefined {
  const line = section
    .split("\n")
    .find((candidate) => candidate.startsWith(`| ${firstCell} |`));
  return line
    ?.split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function includesAll(
  value: string | undefined,
  fragments: readonly string[],
): boolean {
  return (
    value !== undefined &&
    fragments.every((fragment) => value.includes(fragment))
  );
}

function validateQualityContract(document: string): string[] {
  const errors: string[] = [];
  const section = sectionRange(document, QUALITY_HEADING).text;
  const gitIndependent = tableCells(section, "Git非依存検査");
  const trusted = tableCells(section, "trusted repository依存検査");
  const noIndex = tableCells(section, "no-index差分検査");
  if (
    !includesAll(gitIndependent?.[1], [
      "通常file",
      "Git repositoryを生成しない",
    ])
  )
    errors.push("Git非依存検査の実行境界");
  if (
    !includesAll(trusted?.[1], [
      "candidateの外部",
      "read-only",
      "candidate work tree",
    ])
  )
    errors.push("trusted repository依存検査の実行境界");
  if (!includesAll(noIndex?.[2], ["git diff --check --no-index", "stdoutが空"]))
    errors.push("no-index差分検査の合格observable");
  for (const [label, pattern] of [
    ["candidate .git禁止", /candidateが作った`\.git`をauthorityにしない/u],
    ["candidate origin禁止", /candidateが作ったoriginをauthorityにしない/u],
    ["candidate commit禁止", /candidateが作ったcommitをauthorityにしない/u],
    [
      "外部anchor不在時fail closed",
      /外部の固定済みtrust anchor.+fail closedとする/u,
    ],
    ["no-index終了値の誤読禁止", /終了値だけをwhitespace不備と判定しない/u],
  ] as const)
    if (!pattern.test(section)) errors.push(label);
  return errors;
}

function validatePlanContract(document: string): string[] {
  const errors: string[] = [];
  const section = sectionRange(document, PLAN_HEADING).text;
  const header = tableCells(section, "SCN ID");
  const example = tableCells(section, "SCN-...");
  if (header?.[4] !== "検査分類・実行場所/trust anchor")
    errors.push("検査分類・実行場所/trust anchor欄");
  if (header?.[5] !== "合格observable") errors.push("合格observable欄");
  if (
    !includesAll(example?.[4], [
      "Git非依存",
      "trusted repository依存",
      "no-index差分",
      "外部の固定済みtrust anchorまたはなし",
    ])
  )
    errors.push("SCNごとの隔離検査分類例");
  if (!includesAll(example?.[5], ["機械判定"]))
    errors.push("SCNごとのobservable例");
  for (const [label, pattern] of [
    [
      "3分類の記録",
      /隔離copyを使うSCNは、Git非依存、trusted repository依存、no-index差分のいずれかを記録する/u,
    ],
    [
      "外部anchorと合成Git禁止",
      /candidate外部で事前に固定したtrust anchorとread-only Git metadata.+candidate内で生成した`\.git`、origin、commitをauthorityにしない/u,
    ],
    [
      "no-index空stdout",
      /git diff --check --no-index`のstdoutが空であることを合格observableにする/u,
    ],
  ] as const)
    if (!pattern.test(section)) errors.push(label);
  return errors;
}

function replaceSection(
  document: string,
  heading: string,
  transform: (section: string) => string,
): string {
  const range = sectionRange(document, heading);
  const transformed = transform(range.text);
  assert.notEqual(transformed, range.text, `変異が成立しません: ${heading}`);
  return (
    document.slice(0, range.start) + transformed + document.slice(range.end)
  );
}

function removeTableRow(section: string, firstCell: string): string {
  return section
    .split("\n")
    .filter((line) => !line.startsWith(`| ${firstCell} |`))
    .join("\n");
}

function emptyTableCell(
  section: string,
  firstCell: string,
  index: number,
): string {
  return section
    .split("\n")
    .map((line) => {
      if (!line.startsWith(`| ${firstCell} |`)) return line;
      const cells = line.split("|");
      assert.ok(index + 1 < cells.length - 1);
      cells[index + 1] = " ";
      return cells.join("|");
    })
    .join("\n");
}

function removePattern(section: string, pattern: RegExp): string {
  assert.match(section, pattern);
  return section.replace(pattern, "");
}

function moveParagraphOutside(
  document: string,
  heading: string,
  marker: string,
): string {
  const range = sectionRange(document, heading);
  const paragraphs = range.text.split("\n\n");
  const index = paragraphs.findIndex((paragraph) => paragraph.includes(marker));
  assert.notEqual(index, -1, `移動対象段落がありません: ${marker}`);
  const [paragraph] = paragraphs.splice(index, 1);
  return (
    document.slice(0, range.start) +
    paragraphs.join("\n\n") +
    document.slice(range.end) +
    `\n\n${paragraph ?? ""}`
  );
}

function assertRejected(errors: readonly string[], label: string): void {
  assert.ok(errors.length > 0, `変異を拒否できませんでした: ${label}`);
}

Given("隔離copy検査の配布規範と実装計画templateがある", function () {
  assert.equal(fs.existsSync(QUALITY_PATH), true);
  assert.equal(fs.existsSync(PLAN_PATH), true);
});

When("trust anchor境界の記述を検査する", function () {
  assert.doesNotThrow(readIsolatedCopyDocuments);
});

Then("Git依存検査の実行場所と外部anchorが定義されている", function () {
  const { quality, plan } = readIsolatedCopyDocuments();
  assert.deepEqual(validateQualityContract(quality), []);
  assert.deepEqual(validatePlanContract(plan), []);
});

Then("candidate由来のrepositoryとoriginとcommitは禁止されている", function () {
  const { quality, plan } = readIsolatedCopyDocuments();
  assert.deepEqual(validateQualityContract(quality), []);
  assert.deepEqual(validatePlanContract(plan), []);
});

Then("配布規範とtemplateの契約削除変異をすべて検出する", function () {
  const { quality, plan } = readIsolatedCopyDocuments();
  const emptyValue = replaceSection(quality, QUALITY_HEADING, (section) =>
    emptyTableCell(section, "trusted repository依存検査", 1),
  );
  assertRejected(
    validateQualityContract(emptyValue),
    "品質基準の値だけを空にする",
  );
  assertRejected(
    validateQualityContract(
      moveParagraphOutside(quality, QUALITY_HEADING, "candidateが作った`.git`"),
    ),
    "品質基準の同形段落を対象節外へ移す",
  );
  assertRejected(
    validatePlanContract(
      moveParagraphOutside(plan, PLAN_HEADING, "隔離copyを使うSCNは"),
    ),
    "templateの同形段落を対象節外へ移す",
  );
  for (const row of [
    "Git非依存検査",
    "trusted repository依存検査",
    "no-index差分検査",
  ])
    assertRejected(
      validateQualityContract(
        replaceSection(quality, QUALITY_HEADING, (section) =>
          removeTableRow(section, row),
        ),
      ),
      `品質基準の個別row欠落: ${row}`,
    );
  for (const pattern of [
    /candidateが作った`\.git`をauthorityにしない。/u,
    /candidateが作ったoriginをauthorityにしない。/u,
    /candidateが作ったcommitをauthorityにしない。/u,
    /外部の固定済みtrust anchor.+?fail closedとする。/u,
    /`git diff --check --no-index`の終了値1.+?判定しない。/u,
  ])
    assertRejected(
      validateQualityContract(
        replaceSection(quality, QUALITY_HEADING, (section) =>
          removePattern(section, pattern),
        ),
      ),
      `品質基準の個別契約欠落: ${pattern.source}`,
    );
  for (const [firstCell, index] of [
    ["SCN ID", 4],
    ["SCN ID", 5],
    ["SCN-...", 4],
    ["SCN-...", 5],
  ] as const)
    assertRejected(
      validatePlanContract(
        replaceSection(plan, PLAN_HEADING, (section) =>
          emptyTableCell(section, firstCell, index),
        ),
      ),
      `templateの個別欄欠落: ${firstCell}/${index}`,
    );
  for (const pattern of [
    /隔離copyを使うSCNは.+?いずれかを記録する。/u,
    /trusted repository依存検査は.+?authorityにしない。/u,
    /no-index差分検査は.+?合格observableにする。/u,
  ])
    assertRejected(
      validatePlanContract(
        replaceSection(plan, PLAN_HEADING, (section) =>
          removePattern(section, pattern),
        ),
      ),
      `templateの個別契約欠落: ${pattern.source}`,
    );
});

Then("no-index検査は終了値ではなく空の標準出力を合格条件にする", function () {
  const { quality, plan } = readIsolatedCopyDocuments();
  assert.deepEqual(validateQualityContract(quality), []);
  assert.deepEqual(validatePlanContract(plan), []);
});

Then("Git非依存検査はGit状態を合成せずcopy内で実行する", function () {
  const { quality, plan } = readIsolatedCopyDocuments();
  assert.deepEqual(validateQualityContract(quality), []);
  assert.deepEqual(validatePlanContract(plan), []);
});
