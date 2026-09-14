import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { WorkflowWorld, stepDefinitions } from "../support/world.js";

/**
 * 起票時点の規律（REQ-WF-023）の配布契約を検査する。
 *
 * **規律の本文は規範文書1箇所だけが所有する。** そのため各assertionは規範文書の
 * 当該節本文だけを対象にし、file全体へ対しては判定しない。file全体を対象にすると、
 * 規則をtemplateやskillへ複製して規範側を空にする変異（03実装計画のM-07）が
 * 生存する。**節を切り出してから判定するのはそのためである。**
 */
interface AdmissionWorld extends WorkflowWorld {
  documentText: string;
  sectionText: string;
  linkTarget: string;
}

const { Given, When, Then } = stepDefinitions<AdmissionWorld>();
const repositoryRoot = process.cwd();

const WORKFLOW_DOCUMENT = ".agent-skill-chain/docs/01_開発ワークフロー.md";
const STEP_ZERO_SKILL = ".agent-skill-chain/skills/step-00-stage/SKILL.md";
const PLANNING_TEMPLATE =
  ".agent-skill-chain/templates/planning/01_計画単位.md";
const SECTION_HEADING = "### 起票時点と計画単位";

function read(relative: string): string {
  return fs.readFileSync(path.join(repositoryRoot, relative), "utf8");
}

/**
 * 見出しから次の同位以上の見出しまでを節本文として切り出す。
 *
 * **次の見出しが無い場合はfile末尾までとする。** 節が最後に置かれた構成でも
 * 切り出しが空にならないようにするためで、空文字を返すと全assertionが
 * 無条件に落ち、欠落と構成差を区別できなくなる。
 */
function extractSection(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, `規範文書に見出しがありません: ${heading}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,3} /u.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

Given("配布される開発ワークフローの規範文書がある", function () {
  this.documentText = read(WORKFLOW_DOCUMENT);
});

Given("配布されるStep 0のskill契約がある", function () {
  this.documentText = read(STEP_ZERO_SKILL);
});

Given("配布される計画単位テンプレートがある", function () {
  this.documentText = read(PLANNING_TEMPLATE);
});

When("起票時点と計画単位の節を読み取る", function () {
  this.sectionText = extractSection(this.documentText, SECTION_HEADING);
});

When("起票時点の規律への相対リンクを解決する", function () {
  const pattern = /\[起票時点と計画単位\]\(([^)]+)\)/u;
  const match = pattern.exec(this.documentText);
  assert.ok(
    match,
    "Step 0のskill契約に起票時点の規律への相対リンクがありません",
  );
  const [target] = match[1].split("#");
  const resolved = path.resolve(
    path.join(repositoryRoot, path.dirname(STEP_ZERO_SKILL)),
    target,
  );
  assert.ok(
    fs.existsSync(resolved),
    `相対リンクの解決先が存在しません: ${match[1]}`,
  );
  this.linkTarget = fs.readFileSync(resolved, "utf8");
});

When("必須欄を読み取る", function () {
  this.sectionText = this.documentText;
});

Then(
  "canonical Issueを作成してよい条件と別セッションからの再開への導出が同じ節にある",
  function () {
    assert.match(this.sectionText, /着手をcommitした時点/u);
    assert.match(
      this.sectionText,
      /未commitの内部計画をcanonical implementation Issueにしない/u,
    );
    assert.match(this.sectionText, /別セッションからの再開/u);
  },
);

Then("外部由来事象を規律の対象外とする列挙がある", function () {
  assert.match(this.sectionText, /この規律の対象外/u);
  for (const item of ["bug報告", "security事象", "期限", "依存要求"])
    assert.match(
      this.sectionText,
      new RegExp(item, "u"),
      `対象外の列挙に${item}がありません`,
    );
});

Then(
  "既定を1週間とし利用プロジェクトが変更できることが同じ節にある",
  function () {
    assert.match(this.sectionText, /既定は1週間/u);
    assert.match(this.sectionText, /利用projectが変更できる/u);
  },
);

Then(
  "計画単位をIssue分割単位に使わないことが成果物の結合度と結び付けてある",
  function () {
    assert.match(this.sectionText, /計画単位をIssueの分割単位に使わない/u);
    assert.match(this.sectionText, /成果物の結合度/u);
  },
);

Then("解決先のファイルに規律の節見出しがある", function () {
  assert.ok(
    this.linkTarget.split("\n").includes(SECTION_HEADING),
    `解決先に節見出しがありません: ${SECTION_HEADING}`,
  );
});

Then("MVPと完了条件と対象外とタスク表と依存の5欄がある", function () {
  for (const heading of [
    "## 1. MVP",
    "## 2. 完了条件",
    "## 3. 対象外",
    "## 4. タスク",
    "## 5. 依存順",
  ])
    assert.ok(
      this.sectionText.split("\n").includes(heading),
      `計画単位テンプレートに必須欄がありません: ${heading}`,
    );
  /**
   * **判定対象はタスク表の見出し行1本に限る。**
   *
   * file全体を走査すると§0の`進捗の正本`行に当たる。あの行は進捗そのものではなく
   * 外部トラッカーへの参照であり、**参照だけを置くのは設計が要求した形である。**
   * 禁じているのは進捗・担当・優先度を列として持ち二重管理にすることなので、
   * 列名を持つ見出し行だけを見る。
   */
  const lines = this.sectionText.split("\n");
  const taskHeadingIndex = lines.indexOf("## 4. タスク");
  assert.notEqual(taskHeadingIndex, -1, "タスク節がありません");
  const taskTableHeader = lines
    .slice(taskHeadingIndex)
    .find((line) => line.startsWith("| ID |"));
  assert.ok(taskTableHeader, "タスク表の見出し行がありません");
  const columns = taskTableHeader
    .split("|")
    .slice(1, -1)
    .map((column) => column.trim());
  assert.ok(columns.length > 0, "タスク表の列を読み取れません");
  for (const forbidden of ["担当", "優先度", "進捗"])
    assert.ok(
      !columns.some((column) => column.includes(forbidden)),
      `進捗・担当・優先度は外部トラッカーが正本であり、タスク表の列にしない: ${forbidden}`,
    );
});
