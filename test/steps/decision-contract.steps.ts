import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  DECISION_CANDIDATES,
  type DecisionCandidateEntry,
  type DecisionContract,
  type DecisionJournalField,
} from "../../src/domain/decision-contract.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface DecisionContractWorld extends WorkflowWorld {
  candidates?: readonly DecisionCandidateEntry[];
  adopted?: readonly DecisionCandidateEntry[];
  excluded?: readonly DecisionCandidateEntry[];
  schemaPropertyNames?: ReadonlySet<string>;
  journalFieldNames?: readonly string[];
  collidingFieldNames?: readonly string[];
  compileDiagnostics?: readonly ts.Diagnostic[];
  rejectedCallableTargetLiteral?: string;
  anchorFixturePath?: string;
  anchorFound?: boolean;
}

const { Given, When, Then } = stepDefinitions<DecisionContractWorld>();

const JOURNAL_SCHEMA_PATHS = [
  ".agent-skill-chain/schemas/workflow-step-journal.schema.json",
  ".agent-skill-chain/schemas/routing-evidence.schema.json",
  ".agent-skill-chain/schemas/review-progress-record.schema.json",
  ".agent-skill-chain/schemas/delivery-state.schema.json",
];

/** JSON Schemaの`properties`キーを再帰的に集める（`$defs`配下も含む）。 */
function collectSchemaPropertyNames(schema: unknown, names: Set<string>): void {
  if (schema === null || typeof schema !== "object") return;
  const record = schema as Record<string, unknown>;
  if (record.properties && typeof record.properties === "object") {
    for (const key of Object.keys(record.properties as Record<string, unknown>))
      names.add(key);
  }
  for (const value of Object.values(record))
    if (value && typeof value === "object")
      collectSchemaPropertyNames(value, names);
}

/**
 * `filePath`内で`anchor`が出現する回数を数える。
 *
 * **行番号ではなくfile内の一意な出現をidentityにする**（Issue #1503、REQ-WF-044）。
 * 旧方式（宣言済み行番号の前後2行だけを見る`anchorPresent`）は、import行の追加等で
 * 実際の行がずれると一致しなくなり、全件検証とroundを消費する原因になっていた
 * （#1388のDCAND-007）。file全体から数えることで行ずれの影響を受けず、0件（消失）と
 * 2件以上（重複）の両方を区別して検出できる（INV-03）。
 */
function anchorOccurrences(filePath: string, anchor: string): number {
  if (anchor === "") return 0;
  const text = fs.readFileSync(filePath, "utf8");
  let count = 0;
  let index = text.indexOf(anchor);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(anchor, index + anchor.length);
  }
  return count;
}

function anchorUniquelyPresent(filePath: string, anchor: string): boolean {
  return anchorOccurrences(filePath, anchor) === 1;
}

// --- SCN-UNIT-DC-001 -------------------------------------------------------

Given(
  "src配下にDecision Contract型定義がある",
  function (this: DecisionContractWorld) {
    // DecisionContractはimport時点でTypeScript型として存在確認済み（typecheckがこのfileの
    // compileを保証する）。runtime値は持たないため、fieldの静的確認はTypeScriptの型システムで行う。
    this.value = true;
  },
);

When("型のfieldを確認する", function (this: DecisionContractWorld) {
  const sample: DecisionContract = {
    value: "x",
    confidence: 0.5,
    callableTarget: "unassigned",
  };
  this.value = sample;
});

Then(
  "value、confidence、callableTargetの3fieldを持つ",
  function (this: DecisionContractWorld) {
    const sample = this.value as DecisionContract;
    assert.equal(Object.prototype.hasOwnProperty.call(sample, "value"), true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(sample, "confidence"),
      true,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(sample, "callableTarget"),
      true,
    );
    assert.deepEqual(Object.keys(sample).sort(), [
      "callableTarget",
      "confidence",
      "value",
    ]);
  },
);

// --- SCN-UNIT-DC-002 --------------------------------------------------------

Given(
  "有限選択判断候補の一覧DECISION_CANDIDATESがある",
  function (this: DecisionContractWorld) {
    this.candidates = DECISION_CANDIDATES;
  },
);

When("採用された候補の件数を確認する", function (this: DecisionContractWorld) {
  this.adopted = (this.candidates ?? []).filter(
    (candidate) => candidate.disposition === "adopted",
  );
});

Then(
  "5件以上でありそれぞれ実在しfile内で一意なanchorを持つ判断箇所を持つ",
  function (this: DecisionContractWorld) {
    const adopted = this.adopted ?? [];
    assert.ok(
      adopted.length >= 5,
      `採用candidateは5件以上必要ですが${adopted.length}件でした`,
    );
    for (const candidate of adopted) {
      assert.equal(candidate.disposition, "adopted");
      // decisionSiteFileが相対pathとして実在することを確認する（P-07 Zero Trust）。
      // decisionSiteFileはrepository root相対で記述している前提。
      assert.equal(
        fs.existsSync(candidate.decisionSiteFile),
        true,
        `${candidate.id}のdecisionSiteFileが存在しません: ${candidate.decisionSiteFile}`,
      );
      assert.equal(
        fs.existsSync(candidate.callerFile),
        true,
        `${candidate.id}のcallerFileが存在しません: ${candidate.callerFile}`,
      );
      // file存在だけでなく、anchor文字列がfile内で一意に実在することを検査する
      // （INV-03）。0件（消失）・2件以上（重複）のどちらも同一性を壊すため拒否する。
      assert.equal(
        anchorUniquelyPresent(
          candidate.decisionSiteFile,
          candidate.decisionSiteAnchor,
        ),
        true,
        `${candidate.id}のdecisionSiteAnchor"${candidate.decisionSiteAnchor}"が${candidate.decisionSiteFile}内で一意に見つかりません（${anchorOccurrences(candidate.decisionSiteFile, candidate.decisionSiteAnchor)}件）`,
      );
      assert.equal(
        anchorUniquelyPresent(candidate.callerFile, candidate.callerAnchor),
        true,
        `${candidate.id}のcallerAnchor"${candidate.callerAnchor}"が${candidate.callerFile}内で一意に見つかりません（${anchorOccurrences(candidate.callerFile, candidate.callerAnchor)}件）`,
      );
    }
  },
);

// --- SCN-UNIT-DC-003 --------------------------------------------------------

Given(
  "DECISION_CANDIDATESの各候補の採否を確認する",
  function (this: DecisionContractWorld) {
    this.candidates = DECISION_CANDIDATES;
  },
);

When("採否が除外の候補を抽出する", function (this: DecisionContractWorld) {
  this.excluded = (this.candidates ?? []).filter(
    (candidate) => candidate.disposition === "excluded",
  );
});

Then("除外理由が空でない", function (this: DecisionContractWorld) {
  const excluded = this.excluded ?? [];
  assert.ok(excluded.length > 0, "除外candidateが1件も無い");
  for (const candidate of excluded) {
    assert.equal(candidate.disposition, "excluded");
    // 除外候補も判断箇所の実在（file存在＋file内で一意なanchor）を検査する。
    // 除外理由の正しさは引用元の実在に依存するため（Step 10独立reviewのHigh指摘）。
    assert.equal(
      fs.existsSync(candidate.decisionSiteFile),
      true,
      `${candidate.id}のdecisionSiteFileが存在しません: ${candidate.decisionSiteFile}`,
    );
    assert.equal(
      anchorUniquelyPresent(
        candidate.decisionSiteFile,
        candidate.decisionSiteAnchor,
      ),
      true,
      `${candidate.id}のdecisionSiteAnchor"${candidate.decisionSiteAnchor}"が${candidate.decisionSiteFile}内で一意に見つかりません（${anchorOccurrences(candidate.decisionSiteFile, candidate.decisionSiteAnchor)}件）`,
    );
    assert.ok(
      candidate.exclusionReason.trim().length > 0,
      `${candidate.id}のexclusionReasonが空です`,
    );
  }
});

// --- SCN-UNIT-DC-004 --------------------------------------------------------

Given(
  "既存journal schema4fileのproperty名一覧を読み込む",
  function (this: DecisionContractWorld) {
    const names = new Set<string>();
    for (const schemaPath of JOURNAL_SCHEMA_PATHS) {
      const raw = fs.readFileSync(schemaPath, "utf8");
      collectSchemaPropertyNames(JSON.parse(raw), names);
    }
    this.schemaPropertyNames = names;
  },
);

When(
  "DecisionJournalFieldのfield名と比較する",
  function (this: DecisionContractWorld) {
    const sample: DecisionJournalField = {
      decisionRecordId: "DEC-0001",
      value: "x",
      confidence: 0.5,
      callableTarget: "unassigned",
      decidedAt: "2026-09-25T00:00:00.000Z",
    };
    this.journalFieldNames = Object.keys(sample);
    const schemaNames = this.schemaPropertyNames ?? new Set<string>();
    this.collidingFieldNames = this.journalFieldNames.filter((name) =>
      schemaNames.has(name),
    );
  },
);

Then("field名の衝突が無い", function (this: DecisionContractWorld) {
  assert.deepEqual(
    this.collidingFieldNames ?? [],
    [],
    `既存journal schemaとfield名が衝突しています: ${(this.collidingFieldNames ?? []).join(", ")}`,
  );
});

// --- SCN-UNIT-DC-005 --------------------------------------------------------

Given(
  "fail-open方向を表す文字列リテラル{string}をcallableTargetへ代入するsourceがある",
  function (this: DecisionContractWorld, literal: string) {
    this.rejectedCallableTargetLiteral = literal;
    this.value = `
      import type { DecisionContract } from "../../src/domain/decision-contract.js";
      const invalid: DecisionContract = {
        value: "x",
        confidence: 0.5,
        callableTarget: "${literal}",
      };
      export {};
    `;
  },
);

When(
  "TypeScript Compiler APIで型検査する",
  function (this: DecisionContractWorld) {
    // 実containingディレクトリを"test/fixtures/"に見せかけ、上記sourceの相対import
    // "../../src/domain/decision-contract.js"がrepository rootの実fileへ解決されるようにする。
    const fileName = "test/fixtures/decision-contract-negative-fixture.ts";
    const source = String(this.value);
    const host = ts.createCompilerHost({});
    const originalGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion, ...rest) =>
      name === fileName
        ? ts.createSourceFile(name, source, languageVersion, true)
        : originalGetSourceFile(name, languageVersion, ...rest);
    host.fileExists = (name) => name === fileName || ts.sys.fileExists(name);
    host.readFile = (name) =>
      name === fileName ? source : ts.sys.readFile(name);

    const program = ts.createProgram(
      [fileName],
      {
        strict: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        noEmit: true,
        skipLibCheck: true,
      },
      host,
    );
    this.compileDiagnostics = ts.getPreEmitDiagnostics(program);
  },
);

Then(
  "型の不一致によるcompile errorが報告される",
  function (this: DecisionContractWorld) {
    const literal = this.rejectedCallableTargetLiteral;
    assert.ok(literal, "rejectedCallableTargetLiteralが設定されていません");
    const diagnostics = this.compileDiagnostics ?? [];
    // TS2322（型不一致）に限定し、対象がcallableTargetの宣言型DecisionCallableTargetと
    // 拒否対象literalであることまで確認する。診断コードや対象を確認しないと、無関係な
    // compile errorでも本Scenarioが誤って成功する（CodeRabbit指摘、Step 10後の是正）。
    const relevant = diagnostics.filter(
      (diagnostic) => diagnostic.code === 2322,
    );
    const messages = relevant.map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    );
    assert.ok(
      messages.some(
        (message) =>
          message.includes(`"${literal}"`) &&
          message.includes("DecisionCallableTarget"),
      ),
      `callableTarget="${literal}"がTS2322としてDecisionCallableTargetへの不一致で報告されませんでした: ${messages.join(" / ")}`,
    );
  },
);

// --- SCN-UNIT-DCANCHOR-001〜003 ---------------------------------------------

const ANCHOR_FIXTURE = "TARGET_ANCHOR_STRING";

Given(
  "anchor文字列の前後に無関係な行を追加したfixtureがある",
  function (this: DecisionContractWorld) {
    const directory = this.temp();
    this.anchorFixturePath = path.join(directory, "fixture.ts");
    fs.writeFileSync(
      this.anchorFixturePath,
      [
        'import { unrelated } from "./unrelated.js";',
        "// 無関係な行1",
        "// 無関係な行2",
        `const site = "${ANCHOR_FIXTURE}";`,
        "// 無関係な行3",
        "void unrelated;",
        "",
      ].join("\n"),
    );
  },
);

Given(
  "anchor文字列を2箇所に持つfixtureがある",
  function (this: DecisionContractWorld) {
    const directory = this.temp();
    this.anchorFixturePath = path.join(directory, "fixture.ts");
    fs.writeFileSync(
      this.anchorFixturePath,
      [
        `const first = "${ANCHOR_FIXTURE}";`,
        `const second = "${ANCHOR_FIXTURE}";`,
        "",
      ].join("\n"),
    );
  },
);

Given(
  "anchor文字列を持たないfixtureがある",
  function (this: DecisionContractWorld) {
    const directory = this.temp();
    this.anchorFixturePath = path.join(directory, "fixture.ts");
    fs.writeFileSync(this.anchorFixturePath, 'const other = "unrelated";\n');
  },
);

When("anchorの一意な実在を確認する", function (this: DecisionContractWorld) {
  assert.ok(this.anchorFixturePath, "fixtureが用意されていません");
  this.anchorFound = anchorUniquelyPresent(
    this.anchorFixturePath,
    ANCHOR_FIXTURE,
  );
});

Then("一意に見つかる", function (this: DecisionContractWorld) {
  assert.equal(this.anchorFound, true);
});

Then("一意には見つからない", function (this: DecisionContractWorld) {
  assert.equal(this.anchorFound, false);
});
