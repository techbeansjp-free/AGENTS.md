import assert from "node:assert/strict";
import fs from "node:fs";
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
}

const { Given, When, Then } = stepDefinitions<DecisionContractWorld>();

const FILE_LINE_PATTERN = /^[\w./-]+:\d+(?:-\d+)?$/u;

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
 * `lineSpec`（"484"または"39-45"）が指す行の前後2行を含む窓を`filePath`から読む。
 *
 * **file存在だけでなく行内容の実在も検査する。** Step 10独立reviewで、file:line形式と
 * fileの存在しか確認しておらず行番号が実際に主張する内容を指しているかを検査していない
 * 点をHighとして指摘され追加した。
 */
function anchorPresent(
  filePath: string,
  lineSpec: string,
  anchor: string,
): boolean {
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  const match = /^(\d+)(?:-(\d+))?$/u.exec(lineSpec);
  if (!match) return false;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : start;
  const windowStart = Math.max(0, start - 1 - 2);
  const windowEnd = Math.min(lines.length, end + 2);
  const window = lines.slice(windowStart, windowEnd).join("\n");
  return window.includes(anchor);
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

When(
  "採用された候補の件数とfile:line形式を確認する",
  function (this: DecisionContractWorld) {
    this.adopted = (this.candidates ?? []).filter(
      (candidate) => candidate.disposition === "adopted",
    );
  },
);

Then(
  "5件以上でありそれぞれ実在するfile:line形式の判断箇所を持つ",
  function (this: DecisionContractWorld) {
    const adopted = this.adopted ?? [];
    assert.ok(
      adopted.length >= 5,
      `採用candidateは5件以上必要ですが${adopted.length}件でした`,
    );
    for (const candidate of adopted) {
      const decisionSite = `${candidate.decisionSiteFile}:${candidate.decisionSiteLine}`;
      assert.match(
        decisionSite,
        FILE_LINE_PATTERN,
        `${candidate.id}のdecisionSiteがfile:line形式ではありません: ${decisionSite}`,
      );
      assert.equal(candidate.disposition, "adopted");
      const callerSite = `${candidate.callerFile}:${candidate.callerLine}`;
      assert.match(
        callerSite,
        FILE_LINE_PATTERN,
        `${candidate.id}のcallerがfile:line形式ではありません: ${callerSite}`,
      );
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
      // file存在だけでなく、主張する行の近傍に実際にその内容があることを検査する
      // （Step 10独立reviewのHigh指摘で追加。形式と存在だけでは偽陽性を防げない）。
      assert.equal(
        anchorPresent(
          candidate.decisionSiteFile,
          candidate.decisionSiteLine,
          candidate.decisionSiteAnchor,
        ),
        true,
        `${candidate.id}のdecisionSiteAnchor"${candidate.decisionSiteAnchor}"が${decisionSite}近傍に見つかりません`,
      );
      assert.equal(
        anchorPresent(
          candidate.callerFile,
          candidate.callerLine,
          candidate.callerAnchor,
        ),
        true,
        `${candidate.id}のcallerAnchor"${candidate.callerAnchor}"が${callerSite}近傍に見つかりません`,
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
    // 除外候補も判断箇所の実在（file存在＋行近傍の内容）を検査する。
    // 除外理由の正しさは引用元の実在に依存するため（Step 10独立reviewのHigh指摘）。
    assert.equal(
      fs.existsSync(candidate.decisionSiteFile),
      true,
      `${candidate.id}のdecisionSiteFileが存在しません: ${candidate.decisionSiteFile}`,
    );
    assert.equal(
      anchorPresent(
        candidate.decisionSiteFile,
        candidate.decisionSiteLine,
        candidate.decisionSiteAnchor,
      ),
      true,
      `${candidate.id}のdecisionSiteAnchor"${candidate.decisionSiteAnchor}"が${candidate.decisionSiteFile}:${candidate.decisionSiteLine}近傍に見つかりません`,
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
    const diagnostics = this.compileDiagnostics ?? [];
    const messages = diagnostics.map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    );
    assert.ok(
      messages.some((message) => /is not assignable to type/u.test(message)),
      `callableTargetのfail-open値がcompile errorになりませんでした: ${messages.join(" / ")}`,
    );
  },
);
