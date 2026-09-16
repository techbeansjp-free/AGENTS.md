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
  restatements: Array<{ path: string; text: string }>;
}

const { Given, When, Then } = stepDefinitions<AdmissionWorld>();
const repositoryRoot = process.cwd();

const WORKFLOW_DOCUMENT = ".agent-skill-chain/docs/01_開発ワークフロー.md";
const STEP_ZERO_SKILL = ".agent-skill-chain/skills/step-00-stage/SKILL.md";
const PLANNING_TEMPLATE =
  ".agent-skill-chain/templates/planning/01_計画単位.md";
const PLANNING_GUIDE = ".agent-skill-chain/templates/planning/00_利用案内.md";
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

Given("配布される計画template利用案内がある", function () {
  this.documentText = read(PLANNING_GUIDE);
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
  const [target, fragment] = match[1].split("#");
  /**
   * **fragmentまで判定する。** fileの存在だけを見ると、別の節を指すfragmentへ
   * 差し替える変異も、fragmentごと削る変異も生存する。ACは「規律の節へ到達する」
   * ことを要求しており、到達先の節を特定できなければ充足しない。
   */
  assert.equal(
    fragment,
    SECTION_HEADING.replace(/^#+\s*/u, ""),
    `相対リンクのfragmentが規律の節を指していません: ${match[1]}`,
  );
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

When("計画期間の所有境界を読み取る", function () {
  this.sectionText = this.documentText;
});

Then(
  "canonical Issueを作成してよい条件と別セッションからの再開への導出が同じ節にある",
  function () {
    assert.match(this.sectionText, /着手を決めた時点/u);
    assert.match(
      this.sectionText,
      /着手を決めていない内部計画をcanonical implementation Issueにしない/u,
    );
    assert.match(this.sectionText, /別セッションからの再開/u);
    /**
     * **多義を閉じた1句まで判定する。** これが無いと「commit」がGit commitと
     * 読まれ、gitignore下のstagingを持つASC自身のStep 4が本節へ違反する
     * （round 1のF-01）。限定句を落とす変異を生存させない。
     */
    assert.match(this.sectionText, /Git commitの有無を指さない/u);
  },
);

Then("外部由来事象を規律の対象外とする列挙がある", function () {
  assert.match(this.sectionText, /この規律の対象外/u);
  for (const item of [
    "bug報告",
    "security事象",
    "法令・契約上の期限",
    "他チームからの依存要求",
  ])
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
  /**
   * **見出しの存在だけでは欄が空でも合格する。** 各必須欄が実体を持つことを、
   * 表を持つ節についてはheader行で確かめる。
   */
  for (const [heading, header] of [
    ["## 2. 完了条件", "| ID | 検証可能な条件 |"],
    ["## 4. タスク", "| ID | 独立した成果 |"],
    ["## 6. 持ち越しと再開", "| 項目 | MVPへの影響 |"],
  ] as const) {
    const index = lines.indexOf(heading);
    assert.notEqual(index, -1, `必須欄がありません: ${heading}`);
    assert.ok(
      lines.slice(index).some((line) => line.startsWith(header)),
      `必須欄の表が空です: ${heading} -> ${header}`,
    );
  }
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

Then(
  "計画期間の既定と変更規則は無く開発ワークフローだけを正本として指す",
  function () {
    assert.doesNotMatch(this.sectionText, /既定1週間/u);
    assert.doesNotMatch(this.sectionText, /利用projectが変更できる/u);
    assert.match(this.sectionText, /開発ワークフロー.*唯一所有/u);
  },
);

/**
 * **単一正本は「複製が無いこと」だけでは守れない。** 規律を別の語で言い換えた下流が、
 * 正本と食い違ったまま残る経路がある。実際にround 2で規範文書を「着手を決めた時点」へ
 * 直した際、用語台帳・要件本文・template・変更履歴の4箇所が「着手をcommit」のまま
 * 取り残され、独立reviewerも見逃した。外部reviewが検出するまで残った。
 *
 * **ここで禁じるのはGit commitを起票条件にする言い換えである。** 正本は
 * 「Git commitの有無を指さない」と明記しており、下流がそれと矛盾してはならない。
 */
const RESTATEMENT_SOURCES = [
  "docs/specs/01_システム概要/02_用語・略語.md",
  "docs/specs/02_要件/01_ワークフロー要件.md",
  ".agent-skill-chain/templates/planning/01_計画単位.md",
];

/** 起票条件をGit commitへ結び付ける言い換え。正本の否定と直接矛盾する */
const COMMIT_CONDITIONED = /着手(を|の)?(commit|コミット)/u;

Given("規律を言い換える配布物と仕様がある", function () {
  this.restatements = RESTATEMENT_SOURCES.map((relative) => ({
    path: relative,
    text: read(relative),
  }));
  assert.equal(
    this.restatements.length,
    RESTATEMENT_SOURCES.length,
    "言い換えの走査対象を読み取れません",
  );
});

When("起票条件の言い換えを読み取る", function () {
  assert.ok(
    this.restatements.every(({ text }) => text.includes("起票")),
    "走査対象が起票時点に言及していません。対象選定が誤っています",
  );
});

Then("Git commitを起票条件にした記述が1件もない", function () {
  const violations = this.restatements
    .filter(({ text }) => COMMIT_CONDITIONED.test(text))
    .map(({ path: relative }) => relative);
  assert.deepEqual(
    violations,
    [],
    `起票条件をGit commitへ結び付けた言い換えが残っています: ${violations.join(", ")}`,
  );
});
