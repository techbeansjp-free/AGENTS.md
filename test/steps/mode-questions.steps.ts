import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  checkModeQuestionText,
  checkRepositoryRuleLedger,
} from "../../scripts/check_conformance.js";
import {
  classifyMode,
  MODE_QUESTIONS,
  QUESTIONS,
  QUICK_DISQUALIFIER_IDS,
  validateModeQuestions,
  type ModeQuestion,
} from "../../src/domain/mode.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

const LEDGER_KEYS = ["valid", "errors", "rules", "coverage"];
const DOCUMENT = ".agent-skill-chain/docs/01_開発ワークフロー.md";

class ModeQuestionWorld extends WorkflowWorld {
  root = "";
  questions: ModeQuestion[] = [];
  errors: string[] = [];
  texts: string[] = [];
  ids: string[] = [];
  modes: Array<{ label: string; mode: string; reasons: number }> = [];
}

const { Given, When, Then } = stepDefinitions<ModeQuestionWorld>();

function repositoryRoot(): string {
  return path.resolve(".");
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** 製品repositoryの規範文書と定義を写した隔離repositoryを作る。 */
function createRepository(
  world: ModeQuestionWorld,
  edit: (markdown: string) => string = (markdown) => markdown,
  extra?: { path: string; contents: string },
): string {
  const root = world.initRepo();
  const target = path.join(root, DOCUMENT);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    edit(fs.readFileSync(path.join(repositoryRoot(), DOCUMENT), "utf8")),
  );
  if (extra) {
    const extraPath = path.join(root, extra.path);
    fs.mkdirSync(path.dirname(extraPath), { recursive: true });
    fs.writeFileSync(extraPath, extra.contents);
  }
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "chore: 規範文書を置く"]);
  return root;
}

// ---------- unit ----------

Given("公開されたモード判定質問がある", function () {
  this.questions = [...MODE_QUESTIONS];
});

When("質問の組を数える", function () {
  this.errors = this.questions
    .filter(
      (entry) =>
        entry.id.trim() === "" ||
        entry.disqualifier.trim() === "" ||
        entry.question.trim() === "",
    )
    .map((entry) => entry.id);
});

Then("8件あり、IDと分類と質問文がすべて空でない", function () {
  assert.equal(this.questions.length, 8);
  assert.deepEqual(this.errors, []);
});

When("質問IDの列を取り出す", function () {
  this.ids = this.questions.map((entry) => entry.id);
});

Then("既存のQUESTIONSと完全一致する", function () {
  assert.deepEqual(this.ids, [...QUESTIONS]);
});

When("分類の集合を取り出す", function () {
  this.ids = this.questions.map((entry) => entry.disqualifier);
});

Then("承認済みの8分類と完全一致する", function () {
  // 導出値どうしを比べると常に一致する。承認済みtokenをtest側の固定期待値として持つ
  const approved = [
    "public-api",
    "data-migration",
    "security-boundary",
    "dependency",
    "infrastructure",
    "irreversible-operation",
    "ambiguity",
    "multi-context",
  ];
  assert.deepEqual([...this.ids].sort(), [...approved].sort());
  assert.deepEqual([...QUICK_DISQUALIFIER_IDS].sort(), [...approved].sort());
  assert.equal(new Set(this.ids).size, 8);
});

Given("分類を1件差し替えたモード判定質問がある", function () {
  this.questions = MODE_QUESTIONS.map((entry, index) =>
    index === 6 ? { ...entry, disqualifier: "unknown-token" } : entry,
  );
});

Given("分類を重複させたモード判定質問がある", function () {
  this.questions = MODE_QUESTIONS.map((entry, index) =>
    index === 6 ? { ...entry, disqualifier: "dependency" } : entry,
  );
});

Given("分類を空文字にしたモード判定質問がある", function () {
  this.questions = MODE_QUESTIONS.map((entry, index) =>
    index === 6 ? { ...entry, disqualifier: "" } : entry,
  );
});

When("モード判定質問の対応を検証する", function () {
  this.errors = validateModeQuestions(this.questions);
});

Then("対応が無い分類を示して失敗する", function () {
  assert.ok(
    this.errors.some((message) =>
      /quick失格分類に対応する質問がありません: ambiguity/u.test(message),
    ),
    JSON.stringify(this.errors),
  );
});

Then("検証は成功する", function () {
  assert.deepEqual(this.errors, []);
});

Then("重複した分類を示して失敗する", function () {
  assert.ok(
    this.errors.some((message) =>
      /quick失格分類が重複しています: dependency/u.test(message),
    ),
    JSON.stringify(this.errors),
  );
});

Then("承認済みでない分類を示して失敗する", function () {
  assert.ok(
    this.errors.some((message) =>
      /対応する分類が承認済みではありません/u.test(message),
    ),
    JSON.stringify(this.errors),
  );
});

function questionText(id: string): string {
  return MODE_QUESTIONS.find((entry) => entry.id === id)?.question ?? "";
}

/**
 * **Q-01の3つの判断を個別に固定する。**
 *
 * 対象の限定、内部仕様の除外、確認できない場合のfalseは別々の判断であり、
 * どれか1つを落とす変異を他の2つが吸収しない。
 */
const Q01_JUDGEMENTS = [
  "列挙した文書等は外部へinterfaceとして提供するものを指し",
  "内部の仕様・追跡記録の更新という事実だけでは該当しないが",
  "変更fileの所在や配布の有無によらず、生成物を含む当該interfaceまたはその外部観測可能な振る舞いを追加・変更・削除する場合や、公開境界またはそれらへの影響を確認できない場合はfalseとする",
] as const;

/**
 * **判定例は行として固定する。** 変更の実態cellと判定cellの対応まで見なければ、
 * 判定値だけを反転する変異が生存する。
 */
const Q01_EXAMPLE_ROWS: ReadonlyArray<readonly [string, string]> = [
  [
    "外部へinterfaceとして提供しない内部の仕様・追跡記録だけを更新し、生成物を含む外部interfaceとその外部観測可能な振る舞いに追加・変更・削除がないことを確認できた",
    "true（他の7問も真かつ根拠付きの場合だけquick）",
  ],
  [
    "内部仕様fileだけを変更したが、それを入力に生成される公開schemaの必須項目が変わる",
    "false（full）",
  ],
  [
    "公開境界、または生成物を含む外部interfaceとその外部観測可能な振る舞いへの影響を確認できない",
    "false（full）",
  ],
];

When("Q-01の質問文を読む", function () {
  this.texts = [questionText("Q-01")];
});

Then(
  "外部提供への限定と内部仕様の除外と確認できない場合のfalseが含まれる",
  function () {
    const text = this.texts[0] ?? "";
    for (const judgement of Q01_JUDGEMENTS)
      assert.equal(
        text.includes(judgement),
        true,
        `Q-01の質問文に判断がありません: ${judgement}`,
      );
  },
);

/**
 * **表示される本文だけを走査対象にする。**
 *
 * HTMLコメント、fenced code block（バッククォートとチルダの両方）、indented code
 * blockへ退避した正しい表を充足証拠にしない。**独立reviewerが、チルダfenceと
 * 4スペースindentへ正しい行を退避して表本文を反転する回避を実証した。**
 */
function visibleLines(markdown: string): string[] {
  const lines: string[] = [];
  let fence: string | null = null;
  let inComment = false;
  for (const line of markdown.split(/\r?\n/u)) {
    const opener = /^\s{0,3}(`{3,}|~{3,})/u.exec(line);
    if (fence !== null) {
      if (opener && line.trimStart().startsWith(fence)) fence = null;
      continue;
    }
    if (opener) {
      fence = opener[1]!.slice(0, 3);
      continue;
    }
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }
    if (line.includes("<!--")) {
      if (!line.includes("-->")) inComment = true;
      continue;
    }
    /** indented code blockは4スペースまたはtabで始まる。表の行はindentしない。 */
    if (/^(?: {4}|\t)/u.test(line)) continue;
    lines.push(line);
  }
  return lines;
}

/** Markdownの表として、header・区切り行・連続する本文行を1つの表に閉じる。 */
function tableBody(
  lines: readonly string[],
  header: readonly string[],
): string[][] {
  const cells = (line: string): string[] | null => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
    return trimmed
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
  };
  for (const [index, line] of lines.entries()) {
    const head = cells(line);
    if (!head || head.length !== header.length) continue;
    if (head.some((cell, column) => cell !== header[column])) continue;
    const separator = cells(lines[index + 1] ?? "");
    if (
      !separator ||
      separator.length !== header.length ||
      separator.some((cell) => !/^:?-{3,}:?$/u.test(cell))
    )
      continue;
    const body: string[][] = [];
    for (const rest of lines.slice(index + 2)) {
      const row = cells(rest);
      if (!row || row.length !== header.length) break;
      body.push(row);
    }
    return body;
  }
  return [];
}

When("モード判定質問の判定例を検査する", function () {
  const document = fs.readFileSync(
    path.join(repositoryRoot(), DOCUMENT),
    "utf8",
  );
  const [, afterHeading = ""] = document.split("\n## モード判定質問\n");
  this.texts = visibleLines(afterHeading.split("\n## ")[0] ?? "");
});

Then(
  "真の例と公開生成物へ影響する偽の例と確認できない場合の偽が各1行ある",
  function () {
    const body = tableBody(this.texts, ["変更の実態", "Q-01"]);
    assert.notEqual(
      body.length,
      0,
      "判定例の表がheaderと区切り行を伴って見つかりません",
    );
    for (const [situation, verdict] of Q01_EXAMPLE_ROWS) {
      const matched = body.filter(
        (row) => row[0] === situation && row[1] === verdict,
      );
      assert.equal(
        matched.length,
        1,
        `判定例の行が1件ではありません: ${situation} / ${verdict}`,
      );
    }
  },
);

When("Q-06の質問文を読む", function () {
  this.texts = [questionText("Q-06")];
});

Then(
  "復旧可能性と、変えない引用の例外と、不明ならfalseとする旨が含まれる",
  function () {
    const text = this.texts[0] ?? "";
    assert.match(text, /復旧可能性/u);
    assert.match(text, /引用だけであれば該当しない/u);
    assert.match(text, /不明な場合はfalseとする/u);
  },
);

When("Q-01とQ-02の質問文を読む", function () {
  this.texts = [questionText("Q-01"), questionText("Q-02")];
});

Then(
  "一方は外部へ公開するinterface、他方は保存されているデータの形式を対象にしている",
  function () {
    assert.match(this.texts[0] ?? "", /外部へ公開するinterface/u);
    assert.match(this.texts[1] ?? "", /既に保存されているデータの形式/u);
  },
);

When("Q-07の質問文を読む", function () {
  this.texts = [questionText("Q-07")];
});

Then(
  "目的と対象範囲と受け入れ条件と不変条件と要件の矛盾を問う旨が含まれる",
  function () {
    assert.match(
      this.texts[0] ?? "",
      /目的、対象範囲、受け入れ条件、不変条件、要件のいずれのあいだにも矛盾が無いか/u,
    );
  },
);

function answers(
  overrides: Record<
    string,
    { answer?: boolean | "unknown"; evidence?: string }
  >,
) {
  return Object.fromEntries(
    QUESTIONS.map((id) => [
      id,
      overrides[id] ?? { answer: true, evidence: "観測済み" },
    ]),
  );
}

Given("モード判定の代表入力がある", function () {
  this.modes = [];
  const cases: Array<{
    label: string;
    answers: Record<
      string,
      { answer?: boolean | "unknown"; evidence?: string }
    >;
    requestedMode: string;
  }> = [
    { label: "全問true", answers: answers({}), requestedMode: "quick" },
    {
      label: "1問false",
      answers: answers({ "Q-03": { answer: false, evidence: "触れる" } }),
      requestedMode: "quick",
    },
    {
      label: "1問unknown",
      answers: answers({ "Q-04": { answer: "unknown", evidence: "未確認" } }),
      requestedMode: "quick",
    },
    {
      label: "1問未回答",
      answers: answers({ "Q-05": {} }),
      requestedMode: "quick",
    },
    {
      label: "1問根拠なし",
      answers: answers({ "Q-06": { answer: true } }),
      requestedMode: "quick",
    },
    { label: "full要求", answers: answers({}), requestedMode: "full" },
  ];
  for (const entry of cases) {
    const result = classifyMode(entry.answers, {
      requestedMode: entry.requestedMode,
    });
    this.modes.push({
      label: entry.label,
      mode: result.mode,
      reasons: result.reasons.length,
    });
  }
});

When("各入力でモードを判定する", function () {
  this.errors = this.modes
    .filter((entry) => {
      const expectQuick = entry.label === "全問true";
      return expectQuick ? entry.mode !== "quick" : entry.mode !== "full";
    })
    .map((entry) => `${entry.label}=${entry.mode}`);
});

Then("期待するモードと理由がすべて一致する", function () {
  assert.deepEqual(this.errors, []);
  assert.equal(this.modes.find((e) => e.label === "全問true")?.reasons, 0);
  for (const entry of this.modes.filter(
    (e) => e.label !== "全問true" && e.label !== "full要求",
  ))
    assert.ok(entry.reasons > 0, `${entry.label}の理由が空です`);
});

// ---------- integration ----------

Given("製品repositoryがある", function () {
  this.root = repositoryRoot();
});

Given("規範文書の質問文を1文字書き換えた隔離repository", function () {
  this.root = createRepository(this, (markdown) =>
    markdown.replace(
      "影響する境界づけられたコンテキストが1つに限定でき",
      "影響する境界づけられたコンテキストが2つに限定でき",
    ),
  );
});

Given("規範文書の分類を2つ入れ替えた隔離repository", function () {
  this.root = createRepository(this, (markdown) =>
    markdown
      .replace("| Q-04 | dependency |", "| Q-04 | ZZTEMP |")
      .replace("| Q-05 | infrastructure |", "| Q-05 | dependency |")
      .replace("| Q-04 | ZZTEMP |", "| Q-04 | infrastructure |"),
  );
});

Given("質問文を別の追跡fileへ書いた隔離repository", function () {
  this.root = createRepository(this, undefined, {
    path: "docs/guide.md",
    contents: `# 案内\n\n${questionText("Q-01")}\n`,
  });
});

Given("規範文書をそのまま持つ隔離repository", function () {
  this.root = createRepository(this);
});

When("モード判定質問の整合を検査する", function () {
  this.errors = checkModeQuestionText(this.root);
});

When("隔離repositoryのモード判定質問の整合を検査する", function () {
  this.errors = checkModeQuestionText(this.root);
});

When(
  "追跡fileの列挙が失敗する状態でモード判定質問の整合を検査する",
  function () {
    const directory = this.temp();
    const real = execFileSync("sh", ["-c", "command -v git"], {
      encoding: "utf8",
    }).trim();
    const fake = path.join(directory, "git");
    fs.writeFileSync(
      fake,
      `#!/bin/sh\nfor a in "$@"; do if [ "$a" = "ls-files" ]; then exit 9; fi; done\nexec ${real} "$@"\n`,
    );
    fs.chmodSync(fake, 0o755);
    const saved = process.env.PATH;
    process.env.PATH = `${directory}${path.delimiter}${saved ?? ""}`;
    try {
      this.errors = checkModeQuestionText(this.root);
    } finally {
      process.env.PATH = saved;
    }
  },
);

Then("モード判定質問の整合検査は合格する", function () {
  assert.deepEqual(this.errors, []);
});

Then("整合検査は規範文書との不一致を示して失敗する", function () {
  assert.ok(
    this.errors.some((message) => /規範文書と一致しません/u.test(message)),
    JSON.stringify(this.errors),
  );
});

Then("整合検査は許可外のfileを示して失敗する", function () {
  assert.ok(
    this.errors.some((message) =>
      /許可外のfileにあります: docs\/guide\.md/u.test(message),
    ),
    JSON.stringify(this.errors),
  );
});

Then("整合検査は追跡fileを列挙できないことを示して失敗する", function () {
  assert.ok(
    this.errors.some((message) => /追跡fileを列挙できません/u.test(message)),
    JSON.stringify(this.errors),
  );
});

When("適合性検査の公開関数の戻り値を確認する", function () {
  this.ids = Object.keys(checkRepositoryRuleLedger(this.root)).sort();
});

Then("戻り値のkey集合が従来と一致する", function () {
  assert.deepEqual(this.ids, [...LEDGER_KEYS].sort());
});

Given("質問文を重複させたモード判定質問がある", function () {
  this.questions = MODE_QUESTIONS.map((entry, index) =>
    index === 7 ? { ...entry, question: MODE_QUESTIONS[6]!.question } : entry,
  );
});

Then("重複した質問文を示して失敗する", function () {
  assert.ok(
    this.errors.some((message) => /文面が重複しています/u.test(message)),
    JSON.stringify(this.errors),
  );
});

Then("検査は不合格となり、モード判定質問の不一致を報告する", function () {
  assert.equal(this.texts[0], "false");
  assert.ok(
    this.errors.some((message) =>
      /モード判定質問が規範文書と一致しません/u.test(message),
    ),
    JSON.stringify(this.errors.slice(0, 5)),
  );
});

Given("適合性検査scriptがある", function () {
  this.texts = [
    fs.readFileSync(
      path.join(repositoryRoot(), "scripts/check_conformance.ts"),
      "utf8",
    ),
  ];
});

When("適合性検査scriptの合成箇所を読む", function () {
  // 公開入口の本体からerrorsへ合成されているかを見る。
  // 隔離repositoryでの実行はproject policy一式を要求するため、配線の存在で回帰を守る
  const source = this.texts[0] ?? "";
  const start = source.indexOf("export function checkRepositoryRuleLedger");
  this.ids = start < 0 ? [] : [source.slice(start)];
});

Then("モード判定質問の整合検査が公開入口のerrorsへ合成されている", function () {
  assert.equal(this.ids.length, 1, "公開入口の関数が見つかりません");
  assert.match(
    this.ids[0]!,
    /errors\.push\(\.\.\.checkModeQuestionText\(root\)\)/u,
  );
});
