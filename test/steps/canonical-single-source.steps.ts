import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { checkCanonicalDuplication } from "../../scripts/check_conformance.js";
import {
  CANONICAL_SCAN_LOCATIONS,
  CANONICAL_SINGLE_SOURCE_RULE_ID,
  buildRuleCoverage,
  collectCanonicalScanTargets,
  detectCanonicalDuplication,
  validateCanonicalContracts,
  PROJECT_RULE_ENFORCEMENT_POINTS,
  type CanonicalContract,
  type CanonicalDuplicationResult,
  type CanonicalContractValidation,
} from "../../src/domain/conformance.js";

const CANONICAL = ".agent-skill-chain/docs/01_開発ワークフロー.md";
const TOKENS = ["Closes #", "Relates to #"];
const RULE_FILE = ".agent-skill-chain/project/rules/canonical-source.json";

interface CanonicalWorld extends WorkflowWorld {
  root: string;
  contracts: CanonicalContract[];
  files: Array<{ path: string; text: string | null }>;
  result: CanonicalDuplicationResult;
  validation: CanonicalContractValidation;
  registry: unknown;
  existing: Set<string>;
  paths: string[];
  targets: string[];
  coverage: ReturnType<typeof buildRuleCoverage>;
  diagnostics: string[];
  locations: readonly string[];
  ruleScope: string[];
  mismatches: string[];
}

const { Given, When, Then } = stepDefinitions<CanonicalWorld>();

function contract(
  overrides: Partial<CanonicalContract> = {},
): CanonicalContract {
  return {
    contractId: "CANON-CONTRACT-ISSUE-REFERENCE",
    canonical: CANONICAL,
    tokens: [...TOKENS],
    reason: "Issue参照規約",
    ...overrides,
  };
}

function joinedText(root: string, extensions: ReadonlySet<string>): string {
  const walk = (directory: string): string[] =>
    fs.existsSync(directory)
      ? fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
          const absolute = path.join(directory, entry.name);
          if (entry.isDirectory()) return walk(absolute);
          return extensions.has(path.extname(entry.name))
            ? [fs.readFileSync(absolute, "utf8")]
            : [];
        })
      : [];
  return walk(root).join("\n");
}

function repositoryPaths(root: string): string[] {
  const walk = (directory: string): string[] =>
    fs.existsSync(directory)
      ? fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
          if (entry.name === "node_modules" || entry.name === ".git") return [];
          const absolute = path.join(directory, entry.name);
          if (entry.isDirectory()) return walk(absolute);
          return [path.relative(root, absolute).replaceAll(path.sep, "/")];
        })
      : [];
  return walk(root);
}

Given("契約正本registryと正本以外の複製fileがある", function () {
  this.contracts = [contract()];
  this.files = [
    {
      path: "docs/specs/12_運用保守/00_運用設計.md",
      text: "canonical Issueは`Closes #番号`で1回だけ参照する。",
    },
  ];
});

Given("検出tokenと正本へのMarkdown linkを持つfileがある", function () {
  this.contracts = [contract()];
  this.files = [
    {
      path: "docs/specs/12_運用保守/00_運用設計.md",
      text: "`Closes #`の規約は[開発ワークフロー](../../../.agent-skill-chain/docs/01_開発ワークフロー.md)が所有する。",
    },
  ];
});

Given(
  "正本へのlinkをanchor付きとtitle付きと山括弧とpercent encodeと参照定義で書いたfileがある",
  function () {
    const encoded = CANONICAL.split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    this.contracts = [contract()];
    this.files = [
      {
        path: "docs/specs/a/anchor.md",
        text: "`Closes #`は[正本](../../../.agent-skill-chain/docs/01_開発ワークフロー.md#提出とライフサイクル)が所有する。",
      },
      {
        path: "docs/specs/a/title.md",
        text: '`Closes #`は[正本](../../../.agent-skill-chain/docs/01_開発ワークフロー.md "規約")が所有する。',
      },
      {
        path: "docs/specs/a/angle.md",
        text: "`Closes #`は[正本](<../../../.agent-skill-chain/docs/01_開発ワークフロー.md>)が所有する。",
      },
      {
        path: "docs/specs/a/encoded.md",
        text: `\`Closes #\`は[正本](/${encoded})が所有する。`,
      },
      {
        path: "docs/specs/a/definition.md",
        text: "`Closes #`は[正本][wf]が所有する。\n\n[wf]: ../../../.agent-skill-chain/docs/01_開発ワークフロー.md\n",
      },
    ];
  },
);

Given("正本自身が検出tokenを含む", function () {
  this.contracts = [contract()];
  this.files = [
    {
      path: CANONICAL,
      text: "canonical Issueは`Closes #番号`で1回だけ参照する。",
    },
  ];
});

Given("契約entryを1件追加したregistryがある", function () {
  this.contracts = [
    contract(),
    contract({
      contractId: "CANON-CONTRACT-REVIEW-ROUND",
      tokens: ["最大3 review round"],
      reason: "reviewラウンド予算",
    }),
  ];
  this.files = [
    {
      path: "docs/specs/14_開発・品質/02_テスト標準.md",
      text: "同一scope最大3 review roundとする。",
    },
  ];
});

Given("registryへ未登録の語だけを含むfileがある", function () {
  this.contracts = [contract()];
  this.files = [
    {
      path: "docs/specs/12_運用保守/00_運用設計.md",
      text: "Issue #824を根拠とする。closeは行わない。",
    },
  ];
});

Given("正本と異なる記述と正本へのMarkdown linkを持つfileがある", function () {
  this.contracts = [contract()];
  this.files = [
    {
      path: ".agent-skill-chain/templates/issue/11_プルリクエスト本文.md",
      text: "`Relates to #`の扱いは正本と語順が違うが、[正本](../../docs/01_開発ワークフロー.md)を参照する。",
    },
  ];
});

Given(
  "検出tokenを含み正本pathを言及するがMarkdown linkを持たないfileがある",
  function () {
    this.contracts = [contract()];
    this.files = [
      {
        path: "docs/specs/12_運用保守/00_運用設計.md",
        text: `\`Closes #\`の規約は ${CANONICAL} が所有する。`,
      },
    ];
  },
);

Given("contractsが空のregistryがある", function () {
  this.contracts = [];
  this.files = [
    {
      path: "docs/specs/12_運用保守/00_運用設計.md",
      text: "canonical Issueは`Closes #番号`で参照する。",
    },
  ];
});

Given("読み取れない走査対象fileがある", function () {
  this.contracts = [contract()];
  this.files = [{ path: "docs/specs/12_運用保守/00_運用設計.md", text: null }];
});

Given("正本pathが実在しないregistryがある", function () {
  this.registry = {
    schemaVersion: "agent-skill-chain/canonical-contracts/v1",
    contracts: [{ ...contract(), canonical: "docs/specs/存在しない.md" }],
  };
  this.existing = new Set([CANONICAL]);
});

Given("正本pathが規範宣言location外を指すregistryがある", function () {
  this.registry = {
    schemaVersion: "agent-skill-chain/canonical-contracts/v1",
    contracts: [
      { ...contract(), canonical: "docs/reviews/00_課題824実装レビュー.md" },
    ],
  };
  this.existing = new Set(["docs/reviews/00_課題824実装レビュー.md"]);
});

Given("契約IDが重複したregistryがある", function () {
  this.registry = {
    schemaVersion: "agent-skill-chain/canonical-contracts/v1",
    contracts: [contract(), contract()],
  };
  this.existing = new Set([CANONICAL]);
});

Given("証跡と一時ステージングと実装を含むpath一覧がある", function () {
  this.paths = [
    ".agent-skill-chain/docs/01_開発ワークフロー.md",
    ".agent-skill-chain/templates/issue/11_プルリクエスト本文.md",
    "docs/specs/12_運用保守/00_運用設計.md",
    "docs/reviews/00_課題824実装レビュー.md",
    ".agent-skill-chain/tmp/issues/x/00_要求定義.md",
    "src/domain/delivery.ts",
    "docs/specs/12_運用保守/notes.txt",
    "docs/specs-old/00_旧仕様.md",
  ];
});

Given("実repositoryの契約正本registryがある", function () {
  this.root = path.resolve(".");
  const registry = JSON.parse(
    fs.readFileSync(
      path.join(this.root, ".agent-skill-chain/canonical-contracts.json"),
      "utf8",
    ),
  ) as unknown;
  const all = repositoryPaths(this.root);
  this.validation = validateCanonicalContracts(registry, new Set(all));
  this.contracts = this.validation.contracts;
  this.targets = collectCanonicalScanTargets(all);
  this.files = this.targets.map((relative) => ({
    path: relative,
    text: fs.readFileSync(path.join(this.root, relative), "utf8"),
  }));
});

Given("正本単一化ruleを含む実repositoryのrule台帳がある", function () {
  this.root = path.resolve(".");
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(this.root, ".agent-skill-chain/project-policy.json"),
      "utf8",
    ),
  ) as { ruleFiles: string[] };
  const rules = manifest.ruleFiles.map(
    (relative) =>
      JSON.parse(
        fs.readFileSync(
          path.join(this.root, ".agent-skill-chain", relative),
          "utf8",
        ),
      ) as unknown,
  );
  this.coverage = buildRuleCoverage({
    rules,
    normativeText: joinedText(
      path.join(this.root, ".agent-skill-chain/docs"),
      new Set([".md"]),
    ),
    schemaText: joinedText(
      path.join(this.root, ".agent-skill-chain/schemas"),
      new Set([".json"]),
    ),
    runtimeText: [
      joinedText(path.join(this.root, "src"), new Set([".ts"])),
      ...Object.keys(PROJECT_RULE_ENFORCEMENT_POINTS),
    ].join("\n"),
    ciText: joinedText(
      path.join(this.root, ".github/workflows"),
      new Set([".yml", ".yaml"]),
    ),
  });
});

Given("実repositoryがある", function () {
  this.root = path.resolve(".");
  this.paths = repositoryPaths(this.root);
});

When("正本複製を検査する", function () {
  this.result = detectCanonicalDuplication({
    contracts: this.contracts,
    files: this.files,
  });
});

When("契約正本registryを検証する", function () {
  this.validation = validateCanonicalContracts(this.registry, this.existing);
});

When("走査対象file集合を構築する", function () {
  this.targets = collectCanonicalScanTargets(this.paths);
});

When("実repositoryの走査対象file集合を構築する", function () {
  this.targets = collectCanonicalScanTargets(this.paths);
});

When("規範宣言locationのMarkdownを走査する", function () {
  this.result = detectCanonicalDuplication({
    contracts: this.contracts,
    files: this.files,
  });
});

When("rule coverageを算出する", function () {
  // Givenで算出済み
});

Then("検査は違反を報告する", function () {
  assert.ok(this.result.violations.length > 0);
});

Then("診断は複製箇所と契約IDと正本pathと置換方針を含む", function () {
  const [violation] = this.result.violations;
  assert.ok(violation);
  assert.equal(violation.path, "docs/specs/12_運用保守/00_運用設計.md");
  assert.equal(violation.contractId, "CANON-CONTRACT-ISSUE-REFERENCE");
  assert.equal(violation.canonical, CANONICAL);
  assert.equal(violation.ruleId, CANONICAL_SINGLE_SOURCE_RULE_ID);
  assert.ok(violation.remediation.includes("Markdown link"));
});

Then("検査は適合を報告する", function () {
  assert.deepEqual(this.result.violations, []);
});

Then("追加した契約の違反を報告する", function () {
  assert.equal(this.result.violations.length, 1);
  assert.equal(
    this.result.violations[0]?.contractId,
    "CANON-CONTRACT-REVIEW-ROUND",
  );
});

Then("検証は理由付きで拒否する", function () {
  assert.ok(this.validation.errors.length > 0);
  assert.ok(this.validation.errors.every((error) => error.trim().length > 0));
});

Then("検査は違反0件の適合を報告する", function () {
  assert.deepEqual(this.result.violations, []);
  assert.deepEqual(this.result.errors, []);
});

Then("検査は走査errorを報告し違反にしない", function () {
  assert.deepEqual(this.result.violations, []);
  assert.equal(this.result.errors.length, 1);
});

Then("集合は規範宣言locationのMarkdownだけを含む", function () {
  assert.deepEqual(this.targets, [
    ".agent-skill-chain/docs/01_開発ワークフロー.md",
    ".agent-skill-chain/templates/issue/11_プルリクエスト本文.md",
    "docs/specs/12_運用保守/00_運用設計.md",
  ]);
});

Then("登録契約の違反は0件である", function () {
  assert.deepEqual(this.validation.errors, []);
  assert.deepEqual(this.result.violations, []);
});

Then("orphansに正本単一化ruleは含まれない", function () {
  assert.ok(
    !this.coverage.orphans.some(
      (orphan) => orphan.ruleId === CANONICAL_SINGLE_SOURCE_RULE_ID,
    ),
  );
});

Then("ruleは20件でorphansは0件である", function () {
  assert.equal(this.coverage.rows.length, 20);
  assert.deepEqual(this.coverage.orphans, []);
});

Then("集合は証跡と一時ステージングのfileを含まない", function () {
  assert.ok(!this.targets.some((target) => target.startsWith("docs/reviews/")));
  assert.ok(
    !this.targets.some((target) =>
      target.startsWith(".agent-skill-chain/tmp/"),
    ),
  );
});

Given("top-levelに未知fieldがあるregistryがある", function () {
  this.registry = {
    schemaVersion: "agent-skill-chain/canonical-contracts/v1",
    contracts: [contract()],
    unexpected: true,
  };
  this.existing = new Set([CANONICAL]);
});

Given("contractIdが規約外のregistryがある", function () {
  this.registry = {
    schemaVersion: "agent-skill-chain/canonical-contracts/v1",
    contracts: [{ ...contract(), contractId: "WRONG-PREFIX-ISSUE" }],
  };
  this.existing = new Set([CANONICAL]);
});

Given("実装の走査location一覧がある", function () {
  this.locations = CANONICAL_SCAN_LOCATIONS;
});

Given("契約正本registryを持たないdirectoryがある", function () {
  this.root = path.resolve("src");
});

Given("正本単一化ruleの定義がある", function () {
  this.root = path.resolve(".");
  const rule = JSON.parse(
    fs.readFileSync(path.join(this.root, RULE_FILE), "utf8"),
  ) as { scope: string[] };
  this.ruleScope = rule.scope;
});

When("走査locationを確認する", function () {
  // Givenで取得済み
});

When("conformance検査で正本複製を検査する", function () {
  this.diagnostics = checkCanonicalDuplication(this.root);
});

When("rule scopeと走査locationを突合する", function () {
  const fromCode = [...CANONICAL_SCAN_LOCATIONS]
    .map((location) => location.replace(/\/$/u, ""))
    .sort();
  const fromRule = [...this.ruleScope].sort();
  this.mismatches = [
    ...fromCode.filter((entry) => !fromRule.includes(entry)),
    ...fromRule.filter((entry) => !fromCode.includes(entry)),
  ];
});

Then("拒否理由は要求するcontractId prefixを示す", function () {
  assert.ok(
    this.validation.errors.some((error) => error.includes("CANON-CONTRACT-")),
  );
  assert.ok(
    !this.validation.errors.some((error) => error.includes("ASC-CONTRACT-")),
  );
});

Then("locationは規範宣言location3箇所に一致する", function () {
  assert.deepEqual(
    [...this.locations],
    [
      ".agent-skill-chain/docs/",
      ".agent-skill-chain/templates/",
      "docs/specs/",
    ],
  );
});

Then("検査はregistry不在を診断として報告する", function () {
  assert.ok(this.diagnostics.length > 0);
  assert.ok(
    this.diagnostics.some((diagnostic) =>
      diagnostic.includes("canonical-contracts.json"),
    ),
  );
});

Then("突合は差異0件で一致する", function () {
  assert.deepEqual(this.mismatches, []);
});
