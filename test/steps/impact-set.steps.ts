import assert from "node:assert/strict";
import { createReuseObserver } from "../../src/adapters/review-reuse.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import {
  bindFeaturesToStepDefinitions,
  type FeatureStepBinding,
  type StepDefinitionSource,
} from "../../src/domain/cucumber-binding.js";
import {
  deriveImpactSet,
  reviewAdjacentScope,
  type ImpactDerivationInput,
  type ImpactSet,
  type StepDefinitionFileSummary,
} from "../../src/domain/impact-set.js";
import {
  SEMANTIC_GRAPH_BUILDER_VERSION,
  SEMANTIC_GRAPH_SCHEMA_VERSION,
  type SemanticEdgeKind,
  type SemanticGraphSnapshot,
} from "../../src/domain/semantic-graph.js";
import {
  advanceReviewSession,
  parseReviewRoundInput,
  type ReviewRoundInput,
  type ReviewSessionState,
} from "../../src/domain/review-convergence.js";
import { stableJson } from "../../src/lib/security.js";
import {
  buildCommitSemanticGraph,
  DEFAULT_SOURCE_OBSERVATION_LIMITS,
} from "../../src/adapters/repository-graph.js";
import { computeImpactSet } from "../../src/adapters/impact-set.js";
import {
  buildReviewRoundDraft,
  observeReviewDiff,
  recordReviewRound,
} from "../../src/adapters/review-session.js";
import { collectSupplementalReviewDiff } from "../../src/adapters/supplemental-review-collect.js";
import { appendWorkflowJournalEntry } from "../../src/adapters/workflow-journal.js";
import { createIssueStaging } from "../../src/domain/issue.js";
import { QUESTIONS, type ModeAnswer } from "../../src/domain/mode.js";
import {
  WORKFLOW_STEPS,
  type StepJournalEntry,
} from "../../src/domain/workflow.js";
import { main } from "../../src/cli.js";

interface ImpactWorld extends WorkflowWorld {
  graphInput: ImpactDerivationInput;
  impact: ImpactSet;
  impacts: ImpactSet[];
  binding: FeatureStepBinding;
  admitted: ReviewSessionState;
  roundTwo: ReviewRoundInput;
  root: string;
  base: string;
  head: string;
  cliStatus: number;
  cliStdout: string;
  cliStderr: string;
  staging: string;
  session: ReviewSessionState;
  draft: ReviewRoundInput;
  related: string[];
}

const { Given, When, Then } = stepDefinitions<ImpactWorld>();

const BASE = "1".repeat(40);
const HEAD = "2".repeat(40);
const CHANGE_DIGEST = "3".repeat(64);

function snapshot(
  files: readonly string[],
  edges: readonly [string, string, SemanticEdgeKind][],
  scenarios: readonly string[],
): SemanticGraphSnapshot {
  const nodes = [
    ...files.map((file) => ({
      id: `file:${file}`,
      kind: "file" as const,
      certainty: "deterministic" as const,
      sourcePath: file,
      properties: {},
    })),
    ...scenarios.map((scenario) => ({
      id: `scenario:${scenario}`,
      kind: "scenario" as const,
      certainty: "deterministic" as const,
      sourcePath: "docs/trace.md",
      properties: {},
    })),
  ];
  return {
    schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION,
    builderVersion: SEMANTIC_GRAPH_BUILDER_VERSION,
    source: {
      repositoryId: "local:fixture",
      worktreeId: "a".repeat(64),
      headSha: HEAD,
      treeSha: "c".repeat(40),
      contentDigest: "d".repeat(64),
      dirty: false,
    },
    nodes,
    edges: edges.map(([from, to, kind], index) => ({
      id: `edge:${index + 1}`,
      from,
      to,
      kind,
      certainty: "deterministic" as const,
      sourcePath: "docs/trace.md",
      properties: {},
    })),
  };
}

const FIXTURE_FILES = [
  "src/a.ts",
  "src/b.ts",
  "src/c.ts",
  "src/orphan.ts",
  "src/adapters/merge-gate.ts",
  "test/steps/a.steps.ts",
  "test/steps/gate.steps.ts",
  "test/steps/other.steps.ts",
  "test/features/a.feature",
  "test/features/gate.feature",
  "test/features/traced.feature",
  "test/features/unrelated.feature",
  "docs/specs/guide.md",
  "docs/read.md",
  "dist/src/b.js",
  "package.json",
];

const FIXTURE_EDGES: [string, string, SemanticEdgeKind][] = [
  ["file:src/a.ts", "file:src/b.ts", "imports"],
  ["file:src/b.ts", "file:src/c.ts", "imports"],
  ["file:test/steps/a.steps.ts", "file:src/a.ts", "imports"],
  [
    "file:test/steps/gate.steps.ts",
    "file:src/adapters/merge-gate.ts",
    "imports",
  ],
  ["scenario:SCN-T-001", "file:src/a.ts", "satisfied-by"],
  ["scenario:SCN-T-001", "file:test/features/traced.feature", "verified-by"],
];

function summary(file: string, global = false): StepDefinitionFileSummary {
  return { path: file, complete: true, global };
}

Given("import鎖と追跡表とstep定義を持つ意味Graphがある", function () {
  const graph = snapshot(FIXTURE_FILES, FIXTURE_EDGES, ["SCN-T-001"]);
  this.graphInput = {
    baseSha: BASE,
    headSha: HEAD,
    changeDigest: CHANGE_DIGEST,
    changedPaths: [],
    graph: { status: "built", snapshot: graph, contentHash: "e".repeat(64) },
    literalReferences: { "read.md": ["test/steps/a.steps.ts"] },
    stepDefinitionFiles: [
      summary("test/steps/a.steps.ts"),
      summary("test/steps/gate.steps.ts"),
      summary("test/steps/other.steps.ts"),
    ],
    featureBinding: {
      byFeature: {
        "test/features/a.feature": ["test/steps/a.steps.ts"],
        "test/features/gate.feature": ["test/steps/gate.steps.ts"],
        "test/features/traced.feature": ["test/steps/other.steps.ts"],
        "test/features/unrelated.feature": ["test/steps/other.steps.ts"],
      },
      unmatchedFeatures: [],
      unparsedFeatures: [],
    },
    scripts: {
      "docs:format": "node scripts/docs.ts",
      "trace:check": "node scripts/trace.ts",
      "test:format": "node scripts/gherkin.ts",
    },
  };
});

Given(
  "test\\/support\\/world.tsがsrc\\/c.tsをimportしWorldを登録する",
  function () {
    const graph = this.graphInput.graph;
    assert.equal(graph.status, "built");
    if (graph.status !== "built") return;
    this.graphInput = {
      ...this.graphInput,
      graph: {
        ...graph,
        snapshot: snapshot(
          [...FIXTURE_FILES, "test/support/world.ts"],
          [
            ...FIXTURE_EDGES,
            ["file:test/support/world.ts", "file:src/c.ts", "imports"],
          ],
          ["SCN-T-001"],
        ),
      },
      stepDefinitionFiles: [
        ...this.graphInput.stepDefinitionFiles,
        summary("test/support/world.ts", true),
      ],
    };
  },
);

function derive(
  world: ImpactWorld,
  changedPaths: string[],
  overrides: Partial<ImpactDerivationInput> = {},
): ImpactSet {
  return deriveImpactSet({ ...world.graphInput, changedPaths, ...overrides });
}

When("src\\/b.tsだけを変更した影響集合を導出する", function () {
  this.impact = derive(this, ["src/b.ts"]);
});

When("package.jsonとsrc\\/b.tsを変更した影響集合を導出する", function () {
  this.impact = derive(this, ["package.json", "src/b.ts"]);
});

When("test\\/steps\\/a.steps.tsを変更した影響集合を導出する", function () {
  this.impact = derive(this, ["test/steps/a.steps.ts"]);
});

When("docs\\/specs\\/guide.mdだけを変更した影響集合を導出する", function () {
  this.impact = derive(this, ["docs/specs/guide.md"]);
});

When(
  "宣言済みstaging root直下の00_要求定義.mdと.gitignoreだけを変更した影響集合を導出する",
  function () {
    this.impact = derive(
      this,
      [
        "docs/issues/20260927_x/00_要求定義.md",
        "docs/issues/20260927_x/.gitignore",
      ],
      { stagingRootPattern: "docs/issues" },
    );
  },
);

When(
  "宣言済みstaging root直下の.gitignoreとsrc\\/b.tsを変更した影響集合を導出する",
  function () {
    this.impact = derive(
      this,
      ["docs/issues/20260927_x/.gitignore", "src/b.ts"],
      { stagingRootPattern: "docs/issues" },
    );
  },
);

When(
  "staging rootをtestと宣言してtest\\/steps\\/a.steps.tsだけを変更した影響集合を導出する",
  function () {
    this.impact = derive(this, ["test/steps/a.steps.ts"], {
      stagingRootPattern: "test",
    });
  },
);

When(
  "宣言済みstaging rootのstaging directoryより深い.gitignoreだけを変更した影響集合を導出する",
  function () {
    this.impact = derive(this, ["docs/issues/20260927_x/sub/.gitignore"], {
      stagingRootPattern: "docs/issues",
    });
  },
);

When(
  "staging root宣言が無いまま.gitignoreだけを変更した影響集合を導出する",
  function () {
    this.impact = derive(this, ["docs/issues/20260927_x/.gitignore"], {
      stagingRootPattern: undefined,
    });
  },
);

When(
  "step定義が字面で読むdocs\\/read.mdだけを変更した影響集合を導出する",
  function () {
    this.impact = derive(this, ["docs/read.md"]);
  },
);

When(
  "src\\/adapters\\/merge-gate.tsだけを変更した影響集合を導出する",
  function () {
    this.impact = derive(this, ["src/adapters/merge-gate.ts"]);
  },
);

When(
  "どこからもimportされないsrc\\/orphan.tsを変更した影響集合を導出する",
  function () {
    this.impact = derive(this, ["src/orphan.ts"]);
  },
);

When("意味Graphを構築できないままsrc\\/b.tsの影響集合を導出する", function () {
  this.impact = derive(this, ["src/b.ts"], {
    graph: { status: "unavailable", reason: "trace-endpoint-missing" },
  });
});

When("src\\/b.tsとdist\\/src\\/b.jsを変更した影響集合を導出する", function () {
  this.impact = derive(this, ["src/b.ts", "dist/src/b.js"]);
});

When("dist\\/src\\/b.jsだけを変更した影響集合を導出する", function () {
  this.impact = derive(this, ["dist/src/b.js"]);
});

When("src\\/c.tsだけを変更した影響集合を導出する", function () {
  this.impact = derive(this, ["src/c.ts"]);
});

When("src\\/b.tsだけを変更した影響集合を2回導出する", function () {
  this.impacts = [derive(this, ["src/b.ts"]), derive(this, ["src/b.ts"])];
  this.impact = this.impacts[0]!;
});

When("差分digestだけを変えて影響集合を導出する", function () {
  this.impacts.push(
    derive(this, ["src/b.ts"], { changeDigest: "4".repeat(64) }),
  );
});

Then("影響集合はtargetedで理由を持たない", function () {
  assert.deepEqual(this.impact.reasons, []);
  assert.equal(this.impact.mode, "targeted");
});

Then("影響集合はfullで理由に{string}を含む", function (needle: string) {
  assert.equal(this.impact.mode, "full");
  assert.ok(
    this.impact.reasons.some((reason) => reason.includes(needle)),
    this.impact.reasons.join("\n"),
  );
});

Then("fullの影響集合は検証featureと検査を選ばない", function () {
  assert.deepEqual(this.impact.features, []);
  assert.deepEqual(this.impact.scenarios, []);
  assert.deepEqual(this.impact.checks, []);
});

Then(
  "隣接範囲はsrc\\/a.tsとsrc\\/c.tsだけでGraph Evidenceは影響集合digestである",
  function () {
    assert.deepEqual(this.impact.adjacent, [
      { path: "src/a.ts", graphEvidence: this.impact.digest },
      { path: "src/c.ts", graphEvidence: this.impact.digest },
    ]);
  },
);

Then(
  "影響featureはstep定義経由と追跡表経由のfeatureを含み無関係featureを含まない",
  function () {
    assert.deepEqual(this.impact.features, [
      "test/features/a.feature",
      "test/features/traced.feature",
    ]);
    assert.deepEqual(this.impact.scenarios, ["SCN-T-001"]);
  },
);

Then("影響featureは空で検査はdocs:formatとtrace:checkである", function () {
  assert.deepEqual(this.impact.features, []);
  assert.deepEqual(this.impact.checks, ["docs:format", "trace:check"]);
});

Then("影響featureは空で検査はdocs:formatだけである", function () {
  assert.deepEqual(this.impact.features, []);
  assert.deepEqual(this.impact.checks, ["docs:format"]);
});

Then("影響featureはtest\\/features\\/a.featureだけである", function () {
  assert.deepEqual(this.impact.features, ["test/features/a.feature"]);
});

Then("security注意pathはsrc\\/adapters\\/merge-gate.tsである", function () {
  assert.equal(this.impact.securitySensitive, true);
  assert.deepEqual(this.impact.securityPaths, ["src/adapters/merge-gate.ts"]);
  assert.deepEqual(this.impact.features, ["test/features/gate.feature"]);
});

Then("影響集合はGraph content hashと隣接範囲を持たない", function () {
  assert.equal(this.impact.graphContentHash, null);
  assert.deepEqual(this.impact.adjacent, []);
});

Then(
  "2回の影響集合digestは一致し本体のstable JSONのSHA-256である",
  function () {
    const [first, second] = this.impacts;
    assert.ok(first && second);
    assert.equal(first.digest, second.digest);
    const { digest, adjacent, ...rest } = first;
    const body = { ...rest, adjacent: adjacent.map(({ path }) => path) };
    assert.equal(
      digest,
      crypto.createHash("sha256").update(stableJson(body)).digest("hex"),
    );
  },
);

Then("影響集合digestは変わる", function () {
  assert.notEqual(this.impacts[2]?.digest, this.impacts[0]?.digest);
});

Given(
  "文字列とregexとtemplateのstep patternを持つ2つのstep定義fileがある",
  function () {
    const definitions: StepDefinitionSource[] = [
      {
        path: "test/steps/x.steps.ts",
        complete: true,
        patterns: [
          { kind: "expression", source: "{string}を読む" },
          { kind: "expression", source: "結果は{int}件/個" },
          { kind: "expression", source: "cache(s)を消す" },
        ],
      },
      {
        path: "test/steps/y.steps.ts",
        complete: true,
        patterns: [
          { kind: "regex", source: "^固定の(.+)$", flags: "u" },
          { kind: "expression", source: "{}を検査する" },
        ],
      },
    ];
    this.value = definitions;
  },
);

When("Outlineを含むfeatureと未定義stepを含むfeatureを照合する", function () {
  this.binding = bindFeaturesToStepDefinitions({
    definitions: this.value as StepDefinitionSource[],
    features: [
      {
        path: "test/features/outline.feature",
        text: [
          "Feature: 照合",
          "  Scenario Outline: SCN-X-001 読む",
          '    Given "<name>"を読む',
          "    When cachesを消す",
          "    Then 結果は<count>個",
          "    And 固定の値",
          "    And 対象を検査する",
          "",
          "    Examples:",
          "      | name | count |",
          "      | a    | 1     |",
          "      | b    | 2     |",
        ].join("\n"),
      },
      {
        path: "test/features/partial.feature",
        text: [
          "Feature: 未定義",
          "  Scenario: SCN-X-002 未定義",
          "    Given 未定義のstep",
          "    Then 結果は3件",
          '    """',
          "    Given 本文の中のstepは照合しない",
          '    """',
        ].join("\n"),
      },
    ],
  });
});

Then("Outlineのfeatureは2つのstep定義fileへ結び付く", function () {
  assert.deepEqual(this.binding.byFeature["test/features/outline.feature"], [
    "test/steps/x.steps.ts",
    "test/steps/y.steps.ts",
  ]);
  assert.equal(
    this.binding.unmatchedFeatures.includes("test/features/outline.feature"),
    false,
  );
});

Then("未定義stepを含むfeatureは未照合として返る", function () {
  assert.deepEqual(this.binding.unmatchedFeatures, [
    "test/features/partial.feature",
  ]);
  assert.deepEqual(this.binding.byFeature["test/features/partial.feature"], [
    "test/steps/x.steps.ts",
  ]);
});

const ANCHOR = {
  scopeIds: ["SCOPE-001"],
  acceptanceCriteriaIds: ["AC-001"],
  invariantIds: [],
  diffBaseSha: "5".repeat(40),
  initialHeadSha: "6".repeat(40),
  initialDiffDigest: "7".repeat(64),
};

function reviewFinding(overrides: Record<string, unknown>) {
  return {
    id: "H-001",
    severity: "High",
    status: "valid",
    source: "review",
    relation: "acceptance-violation",
    evidence: "固定fixtureで再現した",
    path: "src/a.ts",
    contractId: "AC-001",
    causedByFindingId: null,
    ...overrides,
  };
}

Given("隣接範囲を持つround 2の入力がある", function () {
  const first = advanceReviewSession(
    null,
    parseReviewRoundInput({
      round: 1,
      previousRoundDigest: null,
      anchor: ANCHOR,
      candidateHeadSha: ANCHOR.initialHeadSha,
      focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
      findings: [reviewFinding({})],
    }),
  );
  assert.deepEqual(first.rounds[0]?.blocking, ["H-001"]);
  this.admitted = first;
  this.roundTwo = parseReviewRoundInput({
    round: 2,
    previousRoundDigest: first.latestRoundDigest,
    anchor: ANCHOR,
    candidateHeadSha: "8".repeat(40),
    focus: {
      previousBlocking: ["H-001"],
      fixedDiff: ["src/a.ts"],
      adjacentScope: [{ path: "src/b.ts", graphEvidence: "9".repeat(64) }],
    },
    findings: [
      reviewFinding({ status: "resolved" }),
      reviewFinding({
        id: "H-REG",
        relation: "fix-regression",
        path: "src/b.ts",
        contractId: null,
        causedByFindingId: "H-001",
      }),
      reviewFinding({ id: "H-AC", path: "src/b.ts" }),
      reviewFinding({
        id: "H-IMP",
        relation: "improvement",
        path: "src/b.ts",
        contractId: null,
      }),
      reviewFinding({
        id: "H-OUT",
        relation: "fix-regression",
        path: "src/z.ts",
        contractId: null,
        causedByFindingId: "H-001",
      }),
    ],
  });
});

When("隣接範囲と範囲外のfindingをadmissionへ通す", function () {
  this.admitted = advanceReviewSession(this.admitted, this.roundTwo);
});

function admittedFinding(world: ImpactWorld, id: string) {
  const finding = world.admitted.rounds
    .at(-1)
    ?.findings.find((candidate) => candidate.id === id);
  assert.ok(finding, `${id}がありません`);
  return finding;
}

Then("隣接範囲の前round blocker起因Highはcurrent blockerになる", function () {
  const finding = admittedFinding(this, "H-REG");
  assert.equal(finding.admission, "block-current");
  assert.match(finding.admissionReason, /影響集合の隣接範囲/u);
});

Then(
  "隣接範囲の固定Acceptance Criteria違反はcurrent blockerになる",
  function () {
    const finding = admittedFinding(this, "H-AC");
    assert.equal(finding.admission, "block-current");
    assert.match(finding.admissionReason, /影響集合の隣接範囲/u);
    assert.deepEqual(this.admitted.rounds.at(-1)?.blocking, ["H-AC", "H-REG"]);
  },
);

Then("隣接範囲の改善提案と範囲外Highはrecord-onlyである", function () {
  assert.equal(admittedFinding(this, "H-IMP").admission, "record-only");
  const outside = admittedFinding(this, "H-OUT");
  assert.equal(outside.admission, "record-only");
  assert.equal(
    outside.admissionReason,
    "実Gitの修正差分外なのでcurrent scopeへ追加しない",
  );
});

/** ---- integration: temp Git repositoryでの影響集合 ---- */

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

function commit(root: string, files: Record<string, string>, message: string) {
  writeFiles(root, files);
  git(root, ["add", "--", ...Object.keys(files)]);
  git(root, ["commit", "-q", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

const REPOSITORY_FILES: Record<string, string> = {
  "package.json": `${JSON.stringify({ name: "fixture", private: true, scripts: { "test:format": "node scripts/gherkin.ts" } }, null, 2)}\n`,
  "src/util.ts": "export const util = (): number => 1;\n",
  "src/lib.ts":
    'import { util } from "./util.js";\n\nexport const lib = (): number => util();\n',
  "src/app.ts":
    'import { lib } from "./lib.js";\n\nexport const app = (): number => lib();\n',
  "test/steps/app.steps.ts":
    'import { defineStep } from "@cucumber/cucumber";\nimport { app } from "../../src/app.js";\n\ndefineStep("アプリを起動する", () => {\n  app();\n});\n',
  "test/steps/other.steps.ts":
    'import { defineStep } from "@cucumber/cucumber";\n\ndefineStep("別の処理を行う", () => undefined);\n',
  "test/features/app.feature":
    "Feature: アプリ\n  Scenario: SCN-FX-001 起動する\n    Given アプリを起動する\n",
  "test/features/other.feature":
    "Feature: 別処理\n  Scenario: SCN-FX-003 別の処理\n    Given 別の処理を行う\n",
  "test/features/traced.feature":
    "Feature: 追跡\n  Scenario: SCN-FX-002 追跡される\n    Given 別の処理を行う\n",
  "docs/specs/15_要件追跡/00_追跡表.md":
    "# 追跡表\n\n| 要件 | 受入 | シナリオ | feature | 実装 | 備考 |\n| --- | --- | --- | --- | --- | --- |\n| REQ-FX-001 | AC-FX-001 | SCN-FX-002 | `test/features/traced.feature` | `src/app.ts` | fixture |\n",
};

function createImpactRepository(world: ImpactWorld): void {
  world.root = world.initRepo();
  world.base = commit(world.root, REPOSITORY_FILES, "feat: fixture");
}

Given(
  "importし合うTypeScriptとstep定義とfeatureと追跡表を持つGit repositoryがある",
  function () {
    createImpactRepository(this);
  },
);

When(
  "src\\/lib.tsを変更したcommitを作りworktreeへ未commit変更を残す",
  function () {
    this.head = commit(
      this.root,
      {
        "src/lib.ts":
          'import { util } from "./util.js";\n\nexport const lib = (): number => util() + 1;\n',
      },
      "fix: lib",
    );
    /** worktreeの未commit変更は影響集合へ入らない（commit treeだけを読む） */
    writeFiles(this.root, {
      "src/util.ts": "export const util = (): number => {\n",
    });
  },
);

const STAGED_POLICY = `${JSON.stringify({ policy: { staging: { root: "docs/issues", tracked: true, issueBody: "pointer" } } })}\n`;

When(
  "staging宣言の無いcommitでstaging配下の.gitignoreを変更し作業treeにだけstaging宣言を置く",
  function () {
    this.head = commit(
      this.root,
      { "docs/issues/20260927_x/.gitignore": "journal/\n" },
      "docs: staging gitignore",
    );
    writeFiles(this.root, {
      ".agent-skill-chain/project-policy.json": STAGED_POLICY,
    });
    // commitしないがindexへは載せる（indexから読む実装も誤りとして検出する）
    execFileSync("git", ["add", ".agent-skill-chain/project-policy.json"], {
      cwd: this.root,
    });
  },
);

When(
  "staging宣言をcommitしたうえでstaging配下の.gitignoreを再び変更する",
  function () {
    this.base = commit(
      this.root,
      { ".agent-skill-chain/project-policy.json": STAGED_POLICY },
      "chore: declare staging",
    );
    this.head = commit(
      this.root,
      {
        "docs/issues/20260927_x/.gitignore": "journal/\nreview-session.json\n",
      },
      "docs: staging gitignore again",
    );
  },
);

When("2 commit間の影響集合をGitから導出する", function () {
  this.impact = computeImpactSet({
    root: this.root,
    baseSha: this.base,
    headSha: this.head,
  });
});

Then(
  "影響集合はtargetedで隣接範囲はsrc\\/app.tsとsrc\\/util.tsである",
  function () {
    assert.deepEqual(this.impact.reasons, []);
    assert.equal(this.impact.mode, "targeted");
    assert.deepEqual(
      this.impact.adjacent.map(({ path: adjacent }) => adjacent),
      ["src/app.ts", "src/util.ts"],
    );
    assert.notEqual(this.impact.graphContentHash, null);
  },
);

Then(
  "影響featureはtest\\/features\\/app.featureとtest\\/features\\/traced.featureである",
  function () {
    assert.deepEqual(this.impact.features, [
      "test/features/app.feature",
      "test/features/traced.feature",
    ]);
  },
);

async function captureMain(world: ImpactWorld, args: string[]): Promise<void> {
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  let out = "";
  let err = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    err += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    world.cliStatus = await main(args);
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
  }
  world.cliStdout = out;
  world.cliStderr = err;
}

When("impact CLIをfeatures形式で実行する", async function () {
  await captureMain(this, [
    "impact",
    `--root=${this.root}`,
    `--base=${this.base}`,
    `--head=${this.head}`,
    "--format=features",
  ]);
});

Then("impact CLIは終了値0で影響featureを1行1件で出力する", function () {
  assert.equal(this.cliStatus, 0, this.cliStderr);
  assert.equal(
    this.cliStdout,
    "test/features/app.feature\ntest/features/traced.feature\n",
  );
});

When(
  "package.jsonを変更したcommitを作りimpact CLIをfeatures形式で実行する",
  async function () {
    const base = this.head;
    const head = commit(
      this.root,
      { "package.json": '{ "name": "fixture", "private": true }\n' },
      "chore: package",
    );
    await captureMain(this, [
      "impact",
      `--root=${this.root}`,
      `--base=${base}`,
      `--head=${head}`,
      "--format=features",
    ]);
  },
);

Then("impact CLIは終了値1で全体検証を要求する", function () {
  assert.equal(this.cliStatus, 1);
  assert.equal(this.cliStdout, "");
  assert.match(this.cliStderr, /mode=full/u);
  assert.match(this.cliStderr, /package\.json/u);
});

function answers(): Record<string, ModeAnswer> {
  return Object.fromEntries(
    QUESTIONS.map((id) => [id, { answer: true, evidence: `${id}の固定証拠` }]),
  );
}

function workflowEntry(
  step: number,
  implementationHeadSha?: string,
): StepJournalEntry {
  const definition = WORKFLOW_STEPS.find(
    (candidate) => candidate.step === step,
  );
  if (!definition) throw new Error(`step ${step}がありません`);
  return {
    step,
    skillId: definition.skillId,
    mode: "quick",
    recordedAt: "2026-09-26T00:00:00.000Z",
    artifacts: [`artifact-${step}`],
    evidence: `step ${step}の固定証拠`,
    ...(step === 9 ? { implementationHeadSha } : {}),
  };
}

Given(
  "影響集合を導出できるrepositoryでround 1のHigh findingを永続化したreview sessionがある",
  function () {
    this.root = this.initRepo();
    const base = git(this.root, ["rev-parse", "HEAD"]);
    const initialHead = commit(this.root, REPOSITORY_FILES, "feat: fixture");
    this.staging = createIssueStaging(this.root, {
      title: "impact-set",
      answers: answers(),
      now: new Date("2026-09-26T00:00:00.000Z"),
      requestedMode: "quick",
    }).path;
    for (const step of [1, 4, 9])
      appendWorkflowJournalEntry({
        staging: this.staging,
        entry: workflowEntry(step, initialHead),
      });
    this.session = recordReviewRound({
      staging: this.staging,
      round: parseReviewRoundInput({
        round: 1,
        previousRoundDigest: null,
        anchor: {
          scopeIds: ["SCOPE-001"],
          acceptanceCriteriaIds: ["AC-001"],
          invariantIds: [],
          diffBaseSha: base,
          initialHeadSha: initialHead,
          initialDiffDigest: observeReviewDiff(this.root, base, initialHead)
            .digest,
        },
        candidateHeadSha: initialHead,
        focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
        findings: [reviewFinding({ path: "src/lib.ts" })],
      }),
    });
    assert.deepEqual(this.session.rounds[0]?.blocking, ["H-001"]);
  },
);

When("src\\/lib.tsを是正したcommitでround 2の雛形を作る", function () {
  this.base = this.session.latestCandidateHeadSha;
  this.head = commit(
    this.root,
    {
      "src/lib.ts":
        'import { util } from "./util.js";\n\nexport const lib = (): number => util() + 1;\n',
    },
    "fix: lib",
  );
  this.draft = buildReviewRoundDraft({
    staging: this.staging,
    headSha: this.head,
  }).round;
});

Then(
  "雛形のadjacentScopeは影響集合の隣接範囲でGraph Evidenceは影響集合digestである",
  function () {
    const impact = computeImpactSet({
      root: this.root,
      baseSha: this.base,
      headSha: this.head,
    });
    assert.equal(impact.mode, "targeted", impact.reasons.join("\n"));
    assert.deepEqual(this.draft.focus.adjacentScope, [
      { path: "src/app.ts", graphEvidence: impact.digest },
      { path: "src/util.ts", graphEvidence: impact.digest },
    ]);
  },
);

When(
  "雛形のadjacentScopeへ任意のGraph Evidenceを持つpathを加えて記録する",
  function () {
    this.error = undefined;
    try {
      recordReviewRound({
        staging: this.staging,
        round: parseReviewRoundInput({
          ...this.draft,
          focus: {
            ...this.draft.focus,
            adjacentScope: [
              ...this.draft.focus.adjacentScope,
              { path: "src/unrelated.ts", graphEvidence: "f".repeat(64) },
            ],
          },
          findings: [reviewFinding({ path: "src/lib.ts", status: "resolved" })],
        }),
      });
    } catch (error) {
      this.error = error;
    }
  },
);

Then("review roundは隣接範囲の不一致で拒否される", function () {
  assert.ok(this.error instanceof Error);
  assert.match(this.error.message, /adjacentScope/u);
  assert.equal(this.session.rounds.length, 1);
});

When("雛形へ隣接範囲の修正起因High findingを加えて記録する", function () {
  this.session = recordReviewRound({
    staging: this.staging,
    round: parseReviewRoundInput({
      ...this.draft,
      findings: [
        reviewFinding({ path: "src/lib.ts", status: "resolved" }),
        reviewFinding({
          id: "H-REG",
          relation: "fix-regression",
          path: "src/app.ts",
          contractId: null,
          causedByFindingId: "H-001",
        }),
      ],
    }),
  });
});

Then("隣接範囲の修正起因Highはcurrent blockerとして記録される", function () {
  const round = this.session.rounds.at(-1);
  assert.deepEqual(round?.blocking, ["H-REG"]);
  assert.equal(this.session.status, "active");
});

When("補助reviewの差分文脈を収集する", function () {
  this.impact = computeImpactSet({
    root: this.root,
    baseSha: this.base,
    headSha: this.head,
  });
  this.related = collectSupplementalReviewDiff(
    this.root,
    this.base,
    this.head,
  ).related;
});

Then("補助reviewの関連fileは影響集合の隣接範囲と一致する", function () {
  assert.equal(this.impact.mode, "targeted");
  assert.deepEqual(
    this.related,
    this.impact.adjacent.map(({ path: adjacent }) => adjacent),
  );
});

/** ---- 影響集合を証明できないround（SCN-UNIT-IMPACT-014） ---- */

function roundTwoInput(
  world: ImpactWorld,
  focus: Record<string, unknown>,
  findings: unknown[],
): ReviewRoundInput {
  return parseReviewRoundInput({
    round: 2,
    previousRoundDigest: world.admitted.latestRoundDigest,
    anchor: ANCHOR,
    candidateHeadSha: "8".repeat(40),
    focus: {
      previousBlocking: ["H-001"],
      fixedDiff: ["src/a.ts"],
      adjacentScope: [],
      ...focus,
    },
    findings,
  });
}

Given("影響集合を証明できない印を持つround 2の入力がある", function () {
  this.admitted = advanceReviewSession(
    null,
    parseReviewRoundInput({
      round: 1,
      previousRoundDigest: null,
      anchor: ANCHOR,
      candidateHeadSha: ANCHOR.initialHeadSha,
      focus: { previousBlocking: [], fixedDiff: [], adjacentScope: [] },
      findings: [reviewFinding({})],
    }),
  );
  this.roundTwo = roundTwoInput(this, { adjacentScopeUnbounded: true }, [
    reviewFinding({ status: "resolved" }),
    reviewFinding({
      id: "H-REG",
      relation: "fix-regression",
      path: "src/z.ts",
      contractId: null,
      causedByFindingId: "H-001",
    }),
    reviewFinding({ id: "H-AC", path: "src/z.ts" }),
    reviewFinding({
      id: "H-IMP",
      relation: "improvement",
      path: "src/z.ts",
      contractId: null,
    }),
    reviewFinding({
      id: "H-UNCAUSED",
      relation: "fix-regression",
      path: "src/z.ts",
      contractId: null,
      causedByFindingId: null,
    }),
  ]);
  assert.equal(this.roundTwo.focus.adjacentScopeUnbounded, true);
});

When("修正差分外のfindingをadmissionへ通す", function () {
  this.admitted = advanceReviewSession(this.admitted, this.roundTwo);
});

Then(
  "修正差分外の前round blocker起因Highと固定Acceptance Criteria違反はcurrent blockerになる",
  function () {
    for (const id of ["H-REG", "H-AC"]) {
      const finding = admittedFinding(this, id);
      assert.equal(finding.admission, "block-current", id);
      assert.match(finding.admissionReason, /影響集合の隣接範囲/u);
    }
    assert.deepEqual(this.admitted.rounds.at(-1)?.blocking, ["H-AC", "H-REG"]);
    assert.equal(
      this.admitted.rounds.at(-1)?.focus.adjacentScopeUnbounded,
      true,
    );
  },
);

Then(
  "修正差分外の改善提案と前round blockerに結び付かないHighはrecord-onlyである",
  function () {
    assert.equal(admittedFinding(this, "H-IMP").admission, "record-only");
    assert.equal(admittedFinding(this, "H-UNCAUSED").admission, "record-only");
  },
);

Then(
  "印の無い旧roundは限定済みとして読み印にfalseを指定したroundと隣接pathを併記したroundは拒否する",
  function () {
    const legacy = roundTwoInput(this, {}, []);
    assert.equal("adjacentScopeUnbounded" in legacy.focus, false);
    assert.throws(
      () => roundTwoInput(this, { adjacentScopeUnbounded: false }, []),
      /adjacentScopeUnboundedはtrueだけを指定できます/u,
    );
    assert.throws(
      () =>
        roundTwoInput(
          this,
          {
            adjacentScopeUnbounded: true,
            adjacentScope: [
              { path: "src/b.ts", graphEvidence: "9".repeat(64) },
            ],
          },
          [],
        ),
      /adjacentScopeUnboundedとadjacentScopeは同時に指定できません/u,
    );
  },
);

/** ---- src/が字面で読む文書（SCN-UNIT-IMPACT-015） ---- */

When(
  "src\\/b.tsだけが字面で読むdocs\\/loaded.mdを変更した影響集合を導出する",
  function () {
    this.impact = derive(this, ["docs/loaded.md"], {
      literalReferences: {
        ...this.graphInput.literalReferences,
        "loaded.md": ["src/b.ts"],
      },
    });
  },
);

Then("反復Git観測は返却値の改変から隔離される", function () {
  const input = { root: this.root, baseSha: this.base, headSha: this.head };
  const expected = structuredClone(computeImpactSet(input));
  const exposed = computeImpactSet(input);
  assert.throws(
    () => Object.assign(exposed, { mode: "full", digest: "corrupted" }),
    TypeError,
  );
  assert.deepEqual(computeImpactSet(input), expected);
  const built = buildCommitSemanticGraph(this.root, this.head);
  const expectedGraph = structuredClone(built.snapshot);
  Object.assign(built.snapshot, { nodes: [], edges: [] });
  assert.deepEqual(
    buildCommitSemanticGraph(this.root, this.head).snapshot,
    expectedGraph,
  );
});

Then("基点とHEADとpolicyの変更は以前の影響集合を再利用しない", function () {
  const input = { root: this.root, baseSha: this.base, headSha: this.head };
  const first = computeImpactSet(input);
  const empty = computeImpactSet({ ...input, baseSha: this.head });
  assert.deepEqual(empty.changedPaths, []);
  assert.notEqual(empty.digest, first.digest);
  this.head = commit(
    this.root,
    { ".agent-skill-chain/project-policy.json": STAGED_POLICY },
    "policy: new identity",
  );
  const changed = computeImpactSet({ ...input, headSha: this.head });
  assert.notEqual(changed.digest, first.digest);
  assert.equal(changed.mode, "full");
  assert(
    changed.changedPaths.includes(".agent-skill-chain/project-policy.json"),
  );
});

Then("Git sourceの欠落と観測上限は反復投影でも拒否する", function () {
  buildCommitSemanticGraph(this.root, this.head);
  assert.throws(
    () =>
      buildCommitSemanticGraph(this.root, this.head, {
        ...DEFAULT_SOURCE_OBSERVATION_LIMITS,
        maxFiles: 1,
      }),
    /件数上限/u,
  );
  const blob = git(this.root, ["rev-parse", `${this.head}:src/lib.ts`]);
  const object = path.join(
    this.root,
    ".git",
    "objects",
    blob.slice(0, 2),
    blob.slice(2),
  );
  const bytes = fs.readFileSync(object);
  try {
    fs.unlinkSync(object);
    assert.throws(
      () => buildCommitSemanticGraph(this.root, this.head),
      /blob/u,
    );
  } finally {
    fs.writeFileSync(object, bytes);
  }
});

Then("Git replacementのsource変更を同じSHAの古い投影で隠さない", function () {
  const before = buildCommitSemanticGraph(this.root, this.head);
  const blob = git(this.root, ["rev-parse", `${this.head}:src/lib.ts`]);
  const replacement = execFileSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: this.root,
    encoding: "utf8",
    input: "export const replaced = 100;\n",
  }).trim();
  git(this.root, ["replace", blob, replacement]);
  try {
    const after = buildCommitSemanticGraph(this.root, this.head);
    assert.notEqual(
      after.snapshot.source.contentDigest,
      before.snapshot.source.contentDigest,
    );
    assert.equal(
      after.sources.get("src/lib.ts"),
      "export const replaced = 100;\n",
    );
  } finally {
    git(this.root, ["replace", "-d", blob]);
  }
});

When(
  "動的な依存読込{string}を{string}へcommitして影響集合を2回導出する",
  function (expression: string, location: string) {
    this.head = commit(
      this.root,
      {
        "src/lib.ts": `${REPOSITORY_FILES["src/lib.ts"]}\n// changed\n`,
        [location]: `${REPOSITORY_FILES[location] ?? ""}\nexport const load = (name: string) => ${expression};\n`,
      },
      "dynamic dependency",
    );
    this.impacts = [0, 1].map(() =>
      computeImpactSet({
        root: this.root,
        baseSha: this.base,
        headSha: this.head,
      }),
    );
  },
);

Then("初回も反復時も動的依存を名指ししてfull検証を要求する", function () {
  for (const impact of this.impacts) {
    assert.equal(impact.mode, "full");
    assert.equal(impact.reviewMode ?? impact.mode, "full");
    assert.ok(impact.graphContentHash);
    assert.ok(impact.adjacent.some(({ path }) => path === "src/app.ts"));
    assert.equal(impact.unresolvedImportPaths?.length, 1);
    assert.deepEqual(impact.features, []);
    assert(
      impact.reasons.some(
        (reason) =>
          reason.includes("動的import/require") &&
          impact.unresolvedImportPaths?.some((file) => reason.includes(file)),
      ),
    );
  }
});

Then("検証はfullのままレビューの未知範囲を拡大しない", function () {
  assert.equal(this.impact.mode, "full");
  assert.equal(this.impact.reviewMode, "targeted");
  assert.deepEqual(this.impact.reviewReasons, []);
  assert.deepEqual(reviewAdjacentScope(this.impact), this.impact.adjacent);
  const { reviewMode: _mode, reviewReasons: _reasons, ...legacy } = this.impact;
  assert.deepEqual(reviewAdjacentScope(legacy), []);
  const graph = this.graphInput.graph;
  assert.equal(graph.status, "built");
  if (graph.status !== "built") throw new Error("fixture graph missing");
  const withoutTests = {
    ...graph,
    snapshot: {
      ...graph.snapshot,
      edges: graph.snapshot.edges.filter(({ kind }) => kind !== "verified-by"),
    },
  };
  const security = derive(this, ["src/adapters/merge-gate.ts"], {
    graph: withoutTests,
    stepDefinitionFiles: [],
    featureBinding: {
      byFeature: {},
      unmatchedFeatures: [],
      unparsedFeatures: [],
    },
  });
  assert.equal(security.mode, "full");
  assert.equal(security.reviewMode ?? security.mode, "full");
  for (const unsafeGraph of [
    { ...graph, unresolvedImportPaths: ["src/unrelated-loader.ts"] },
    { ...graph, snapshot: { ...graph.snapshot, nodes: [] } },
  ]) {
    const unsafe = derive(this, ["src/orphan.ts"], { graph: unsafeGraph });
    assert.equal(unsafe.mode, "full");
    assert.equal(unsafe.reviewMode ?? unsafe.mode, "full");
    assert.deepEqual(reviewAdjacentScope(unsafe), []);
  }
});

When(
  "有限候補の依存読込{string}を{string}へ配置して影響集合を導出する",
  function (expression: string, location: string) {
    this.base = commit(
      this.root,
      {
        [location]: `export const load = (flag: boolean) => ${expression};\n`,
        "src/isolated-a.ts": "export const a = 1;\n",
        "src/isolated-b.ts": "export const b = 1;\n",
      },
      "finite dependencies",
    );
    this.head = commit(
      this.root,
      {
        "src/util.ts": "export const util = (): number => 2;\n",
      },
      "change utility",
    );
    this.impacts = [0, 1].map(() =>
      computeImpactSet({
        root: this.root,
        baseSha: this.base,
        headSha: this.head,
      }),
    );
  },
);

Then("有限候補の全依存を保持して初回も反復時もtargetedになる", function () {
  const built = buildCommitSemanticGraph(this.root, this.head);
  assert.deepEqual(built.unresolvedImportPaths, []);
  for (const impact of this.impacts) {
    assert.equal(impact.mode, "targeted", impact.reasons.join("; "));
    assert.ok(impact.graphContentHash);
    assert.ok(impact.features.includes("test/features/app.feature"));
  }
  assert.deepEqual(this.impacts[0], this.impacts[1]);
});

Then(
  "reviewの同一操作はfocusとinspectionのImpactを一度だけ導出する",
  function () {
    const counter = { contentDiffs: 0, impactDerivations: 0 };
    const records = {
      issue: undefined,
      session: { sessionId: "fixture", rounds: [] },
    };
    const observer = createReuseObserver(this.root, records, counter);
    const derived = observer.deriveImpact(this.base, this.head);
    const transition = observer.transition(this.base, this.head);
    assert.equal(counter.impactDerivations, 1);
    assert.equal(transition.digest, derived.impact.changeDigest);
    assert.deepEqual(transition.adjacentScope, derived.adjacentScope);
    assert.equal(transition.unbounded, derived.adjacentScopeUnbounded);
    createReuseObserver(this.root, records, counter).transition(
      this.base,
      this.head,
    );
    assert.equal(counter.impactDerivations, 2);
  },
);
