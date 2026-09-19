import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { assertWorkflowStaging } from "../../src/adapters/workflow-journal.js";
import {
  buildIssueSyncBody,
  createIssueStaging,
} from "../../src/domain/issue.js";
import type { ModeAnswer } from "../../src/domain/mode.js";
import { refreshStoredStagingDigest } from "../../src/domain/staging.js";
import {
  DEFAULT_ISSUE_STAGING_ROOT,
  isValidStagingRootPattern,
  readStagingLayout,
  stagingExcludePathspec,
  stagingRepositoryRoot,
  validateStagingPolicy,
  type StagingLayout,
} from "../../src/domain/staging-layout.js";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";

interface LayoutWorld extends WorkflowWorld {
  root: string;
  staging: string;
  layout: StagingLayout;
  rejections: Record<string, string[]>;
  lastError: string;
  syncBody: string;
  request: string;
  stagingRootCases: Array<{ value: string; valid: boolean }>;
  stagingRootResults: Array<{
    value: string;
    valid: boolean;
    runtime: boolean;
    schemas: boolean[];
  }>;
}

const { Given, When, Then } = stepDefinitions<LayoutWorld>();
const repositoryRoot = process.cwd();
const SPRINT_PARENT = "docs/05_スプリント/01-0914_0925/tasks";
const STAGING_NAME = "S1-T99_配置の検証";

function answers(value: boolean): Record<string, ModeAnswer> {
  return Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => [
      `Q-${String(index + 1).padStart(2, "0")}`,
      { answer: value, evidence: "fixture evidence" },
    ]),
  );
}

function writeManifest(root: string, staging: unknown): void {
  fs.mkdirSync(path.join(root, ".agent-skill-chain"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".agent-skill-chain", "project-policy.json"),
    `${JSON.stringify(
      {
        schemaVersion: "agent-skill-chain/project-policy-manifest/v1",
        policy: {
          schemaVersion: "agent-skill-chain/project-policy/v0.3.1",
          delivery: { stopAt: "pull_request" },
          merge: {
            mode: "disabled",
            branches: [],
            methods: [],
            requiredChecks: [],
            requiredReviews: 1,
          },
          budgets: { localFeedbackMs: 120000, prGateMs: 900000 },
          staging,
        },
        choiceFiles: [],
        ruleFiles: [],
      },
      null,
      2,
    )}\n`,
  );
}

/** 出荷templateのplaceholderを埋め、検証器が受理するfullの00を作る。 */
function materializedRequest(): string {
  const filled = fs
    .readFileSync(
      path.join(
        repositoryRoot,
        ".agent-skill-chain/templates/issue/00_要求定義_full.md",
      ),
      "utf8",
    )
    .split("\n")
    .map((line) =>
      line.startsWith("## ")
        ? line
        : line
            .replaceAll("applicable / not-applicable", "not-applicable")
            .replace(/（[^）\n]+）/gu, "具体的な記入済み内容")
            .replace(/<[^>\n]+>/gu, "記入済み")
            .replace(/\{[^}\n]+\}/gu, "記入済み"),
    )
    .join("\n");
  return `${filled}\n\nScenario: SCN-FIXTURE-STGLAYOUT-001 記入済みIssueを同期する\n  Given 記入済みである\n  When 同期する\n  Then 合格する\n`;
}

function considerationDocument(title: string): string {
  const rows = ["DC-PRIVACY", "DC-OBSERVABILITY", "DC-UX", "DC-TOKENS"]
    .map(
      (id) =>
        `| ${id} | 対象 | not-applicable | CLI文書だけを変更するため対象外である | SCN-FIXTURE-STGLAYOUT-001で確認済み |`,
    )
    .join("\n");
  return `# ${title}\n\n${rows}\n`;
}

function gitStatus(root: string, extra: string[] = []): string[] {
  return execFileSync(
    "git",
    [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ".",
      ...extra,
    ],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .map((line) => line.slice(3));
}

function materializeFullStaging(world: LayoutWorld): void {
  const contents = [
    { name: "00_要求定義.md", text: materializedRequest() },
    { name: "01_要件定義.md", text: considerationDocument("01 要件定義") },
    { name: "02_設計.md", text: considerationDocument("02 設計") },
    { name: "03_実装計画.md", text: considerationDocument("03 実装計画") },
  ];
  for (const artifact of contents)
    fs.writeFileSync(path.join(world.staging, artifact.name), artifact.text);
  world.request = materializedRequest();
  refreshStoredStagingDigest(world.staging);
}

Given("project policy manifestを持たないrepositoryがある", function () {
  this.root = this.initRepo();
});

Given("sprint配下をrootにする版管理下のstaging policyがある", function () {
  this.root = this.initRepo();
  writeManifest(this.root, {
    root: "docs/05_スプリント/*/tasks",
    tracked: true,
    issueBody: "pointer",
  });
  execFileSync("git", ["add", "-A"], { cwd: this.root });
  execFileSync("git", ["commit", "-q", "-m", "policy"], { cwd: this.root });
});

When("staging配置契約を読む", function () {
  this.layout = readStagingLayout(this.root);
});

Then("rootは既定の一時領域でtrackedは偽でissueBodyはfullである", function () {
  assert.equal(this.layout.rootPattern, DEFAULT_ISSUE_STAGING_ROOT);
  assert.equal(this.layout.tracked, false);
  assert.equal(this.layout.issueBody, "full");
});

Given("staging節の不正な候補がある", function () {
  this.rejections = {};
});

When("各候補を検証する", function () {
  const candidates: Record<string, unknown> = {
    trailingStar: { root: "docs/*" },
    absolute: { root: "/docs/tasks" },
    parent: { root: "docs/../tasks" },
    trackedWithoutRoot: { tracked: true },
    unknownField: { root: "docs/tasks", extra: 1 },
    valid: {
      root: "docs/05_スプリント/*/tasks",
      tracked: true,
      issueBody: "pointer",
    },
  };
  for (const [key, value] of Object.entries(candidates)) {
    const errors: string[] = [];
    validateStagingPolicy(value, "staging", errors);
    this.rejections[key] = errors;
  }
});

Then(
  "末尾がアスタリスクのrootと絶対pathと親参照とroot無しのtrackedは拒否される",
  function () {
    for (const key of [
      "trailingStar",
      "absolute",
      "parent",
      "trackedWithoutRoot",
      "unknownField",
    ])
      assert.ok((this.rejections[key] ?? []).length > 0, `${key}は拒否される`);
    assert.deepEqual(this.rejections.valid, []);
  },
);

Given("staging rootの正常例と反例がある", function () {
  this.stagingRootCases = [
    { value: "docs/tasks", valid: true },
    { value: "docs/05_スプリント/*/tasks", valid: true },
    {
      value: Array.from({ length: 16 }, (_, index) => `s${index}`).join("/"),
      valid: true,
    },
    { value: "./tasks", valid: false },
    { value: "docs/./tasks", valid: false },
    { value: "docs/../tasks", valid: false },
    { value: "docs/\u0000/tasks", valid: false },
    { value: "docs/\u202e/tasks", valid: false },
    {
      value: Array.from({ length: 17 }, (_, index) => `s${index}`).join("/"),
      valid: false,
    },
    { value: "/docs/tasks", valid: false },
    { value: "docs\\tasks", valid: false },
    { value: "docs/*", valid: false },
  ];
});

When("runtimeと2つのpolicy schemaでrootを検証する", function () {
  const assembled = JSON.parse(
    fs.readFileSync(
      path.join(
        repositoryRoot,
        ".agent-skill-chain/schemas/project-policy.schema.json",
      ),
      "utf8",
    ),
  ) as {
    properties: { staging: { properties: { root: { pattern: string } } } };
  };
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(
        repositoryRoot,
        ".agent-skill-chain/schemas/project-policy-manifest.schema.json",
      ),
      "utf8",
    ),
  ) as {
    properties: {
      policy: {
        properties: { staging: { properties: { root: { pattern: string } } } };
      };
    };
  };
  const patterns = [
    assembled.properties.staging.properties.root.pattern,
    manifest.properties.policy.properties.staging.properties.root.pattern,
  ].map((pattern) => new RegExp(pattern, "u"));
  this.stagingRootResults = this.stagingRootCases.map((item) => ({
    ...item,
    runtime: isValidStagingRootPattern(item.value),
    schemas: patterns.map((pattern) => pattern.test(item.value)),
  }));
});

Then(
  "正常なrepository相対pathだけを受理しdot segmentと制御文字と既存の境界違反を拒否する",
  function () {
    for (const result of this.stagingRootResults) {
      assert.equal(
        result.runtime,
        result.valid,
        `runtime: ${JSON.stringify(result.value)}`,
      );
      assert.deepEqual(
        result.schemas,
        [result.valid, result.valid],
        `schemas: ${JSON.stringify(result.value)}`,
      );
    }
  },
);

When("staging-rootを省略してissue createする", function () {
  try {
    createIssueStaging(this.root, {
      title: "配置",
      answers: answers(true),
      requestedMode: "quick",
      now: new Date("2026-09-16T00:00:00.000Z"),
    });
    this.lastError = "";
  } catch (error) {
    this.lastError = (error as Error).message;
  }
});

Then("staging-rootの明示を求めて拒否される", function () {
  assert.match(this.lastError, /--staging-root/u);
});

When("patternに一致しないstaging-rootでissue createする", function () {
  try {
    createIssueStaging(this.root, {
      title: "配置",
      answers: answers(true),
      requestedMode: "quick",
      now: new Date("2026-09-16T00:00:00.000Z"),
      stagingRoot: "docs/06_別/01/tasks",
    });
    this.lastError = "";
  } catch (error) {
    this.lastError = (error as Error).message;
  }
});

Then("patternの不一致で拒否される", function () {
  assert.match(this.lastError, /一致しません/u);
});

When("staging-rootとnameを指定してissue createする", function () {
  this.staging = createIssueStaging(this.root, {
    title: "配置",
    answers: answers(false),
    requestedMode: "full",
    now: new Date("2026-09-16T00:00:00.000Z"),
    stagingRoot: SPRINT_PARENT,
    name: STAGING_NAME,
  }).path;
  fs.writeFileSync(path.join(this.staging, "verification-input.json"), "{}\n");
});

Then("stagingは指定したsprint配下に指定した名前で作られる", function () {
  assert.equal(
    this.staging,
    path.join(this.root, ...SPRINT_PARENT.split("/"), STAGING_NAME),
  );
  assert.ok(fs.existsSync(path.join(this.staging, "00_要求定義.md")));
});

Then("stagingには機械記録だけを除外するgitignoreがある", function () {
  const ignore = fs.readFileSync(path.join(this.staging, ".gitignore"), "utf8");
  for (const entry of [
    "journal/",
    "staging-record.json",
    "review-session*.json",
    ".full-promotion-transaction.json",
    "00_モード判定.json",
    "verification-input.json",
  ])
    assert.ok(ignore.includes(entry), `${entry}を除外する`);
  assert.ok(!ignore.includes("00_要求定義.md"), "Markdown文書は除外しない");
});

Then("git statusは文書を未追跡として見せ機械記録を見せない", function () {
  const shown = gitStatus(this.root);
  const relative = path
    .relative(this.root, this.staging)
    .split(path.sep)
    .join("/");
  assert.ok(shown.some((item) => item === `${relative}/00_要求定義.md`));
  assert.ok(shown.some((item) => item === `${relative}/03_実装計画.md`));
  assert.ok(!shown.some((item) => item.includes("staging-record.json")));
  assert.ok(!shown.some((item) => item.includes("/journal/")));
  assert.ok(!shown.some((item) => item.includes("00_モード判定.json")));
  assert.ok(!shown.some((item) => item.includes("verification-input.json")));
});

Then("版管理下のstagingからrepository rootを導ける", function () {
  assert.equal(stagingRepositoryRoot(this.staging), this.root);
  const legacy = path.join(
    this.root,
    ".agent-skill-chain",
    "tmp",
    "issues",
    "20260916_000000_x",
  );
  assert.equal(stagingRepositoryRoot(legacy), this.root);
});

Then("workflow stagingの配置検査は版管理下のstagingを受理する", function () {
  assert.equal(assertWorkflowStaging(this.staging), this.staging);
});

Then("repository外のstagingは配置検査で拒否される", function () {
  const outside = path.join(this.root, "docs", "elsewhere", STAGING_NAME);
  fs.mkdirSync(outside, { recursive: true });
  assert.throws(() => assertWorkflowStaging(outside), /直下/u);
});

When("00を検証可能な内容に置き換えて同期本文を生成する", function () {
  materializeFullStaging(this);
  this.syncBody = buildIssueSyncBody(this.staging, 8).body;
});

Then("同期本文は成果物のpathとdigestと目的と受け入れ条件を含む", function () {
  const relative = path
    .relative(this.root, this.staging)
    .split(path.sep)
    .join("/");
  for (const name of [
    "00_要求定義.md",
    "01_要件定義.md",
    "02_設計.md",
    "03_実装計画.md",
  ])
    assert.ok(this.syncBody.includes(`\`${relative}/${name}\``), name);
  assert.match(this.syncBody, /\| `[0-9a-f]{64}` \|/u);
  assert.match(this.syncBody, /^## 1\. 目的と背景/mu);
  assert.match(this.syncBody, /^## 7\. 受け入れ条件と成功基準/mu);
});

Then("同期本文は00の他の節を含まない", function () {
  assert.doesNotMatch(this.syncBody, /^## 2\. 対象範囲/mu);
  assert.doesNotMatch(this.syncBody, /^## 9\. モード判定/mu);
  assert.ok(!this.syncBody.includes("<details>"));
  assert.ok(this.syncBody.length < this.request.length / 2, "全文より十分短い");
});

When(
  "既定配置にissue createして00を検証可能な内容に置き換え同期本文を生成する",
  function () {
    this.staging = createIssueStaging(this.root, {
      title: "既定配置",
      answers: answers(false),
      requestedMode: "full",
      now: new Date("2026-09-16T00:00:00.000Z"),
    }).path;
    materializeFullStaging(this);
    this.syncBody = buildIssueSyncBody(this.staging, 8).body;
  },
);

Then("同期本文は00の全文である", function () {
  assert.ok(this.syncBody.startsWith(this.request.trimEnd()));
  assert.ok(this.syncBody.includes("<details>"));
});

Then(
  "除外pathspecつきのgit statusはstaging配下の未追跡fileを見せない",
  function () {
    const layout = readStagingLayout(this.root);
    fs.writeFileSync(path.join(this.root, "docs", "elsewhere.md"), "x\n");
    const shown = gitStatus(this.root, [stagingExcludePathspec(layout)]);
    assert.ok(shown.includes("docs/elsewhere.md"));
    assert.ok(!shown.some((item) => item.includes(STAGING_NAME)));
    const legacyRoot = this.initRepo();
    fs.mkdirSync(
      path.join(legacyRoot, ".agent-skill-chain", "tmp", "issues", "x"),
      { recursive: true },
    );
    fs.writeFileSync(
      path.join(legacyRoot, ".agent-skill-chain", "tmp", "issues", "x", "a.md"),
      "a\n",
    );
    const legacyShown = gitStatus(legacyRoot, [
      stagingExcludePathspec(readStagingLayout(legacyRoot)),
    ]);
    assert.deepEqual(legacyShown, []);
  },
);

import { auditRowDraft } from "../../src/domain/review-artifact.js";

interface AuditWorld extends LayoutWorld {
  auditRows: Record<string, string>;
}
const audit = stepDefinitions<AuditWorld>();

audit.Given("種別の異なる変更pathがある", function () {
  this.auditRows = {};
});

audit.When("監査行の雛形を描画する", function () {
  for (const p of [
    "pnpm-lock.yaml",
    "docs/specs/07_データ/01_データモデル.md",
    "src/backend/tests/features/unit/a.feature",
    ".github/workflows/ci.yml",
    "src/backend/app/api/x.py",
  ])
    this.auditRows[p] = auditRowDraft(p, "M");
});

audit.Then(
  "lockfileと文書とtestと設定は層と依存と安全の列が埋まり判定列は未確定のままである",
  function () {
    for (const p of [
      "pnpm-lock.yaml",
      "docs/specs/07_データ/01_データモデル.md",
      "src/backend/tests/features/unit/a.feature",
      ".github/workflows/ci.yml",
    ]) {
      const cells = this.auditRows[p]!.split("|").map((c) => c.trim());
      assert.notEqual(cells[4], "reviewerが確認", `${p} layer`);
      assert.notEqual(cells[6], "reviewerが確認", `${p} dependency`);
      assert.match(cells[8]!, /revert/u);
      assert.equal(cells[7], "reviewerが確認", `${p} spec/AC column`);
      assert.equal(cells[9], "finding", `${p} verdict column`);
    }
  },
);

audit.Then("product codeの行は全列が未確定のままである", function () {
  const cells = this.auditRows["src/backend/app/api/x.py"]!.split("|").map(
    (c) => c.trim(),
  );
  for (const index of [3, 4, 5, 6, 7, 8])
    assert.equal(cells[index], "reviewerが確認");
  assert.equal(cells[9], "finding");
});

import { renderReviewArtifactDraft } from "../../src/domain/review-artifact.js";

interface DraftWorld extends LayoutWorld {
  draft: string;
}
const draft = stepDefinitions<DraftWorld>();

draft.Given("生成物を含む変更pathとpackage filesがある", function () {
  this.draft = "";
});

draft.When("review artifact雛形をpackage filesつきで描画する", function () {
  const template = fs.readFileSync(
    path.join(
      repositoryRoot,
      ".agent-skill-chain/templates/issue/04_レビュー.md",
    ),
    "utf8",
  );
  this.draft = renderReviewArtifactDraft({
    template,
    staging: ".agent-skill-chain/tmp/issues/x",
    stagingDigest: "a".repeat(64),
    baseSha: "1".repeat(40),
    headSha: "2".repeat(40),
    paths: [
      { path: "src/domain/staging-layout.ts", changeType: "A" },
      { path: "dist/src/domain/staging-layout.js", changeType: "A" },
      { path: "dist/src/cli.js", changeType: "M" },
      { path: "docs/specs/02_要件/00_要件一覧.md", changeType: "M" },
      { path: "test/features/unit/staging-layout.feature", changeType: "A" },
    ],
    packageFiles: ["dist/src/", "dist/bin/", ".agent-skill-chain/docs/"],
  });
});

draft.Then("個別監査表に生成物を含む全変更pathの行がある", function () {
  const audit = this.draft.slice(
    this.draft.indexOf("### 1.1 変更ファイル個別監査"),
    this.draft.indexOf("## 2. 受け入れ条件の確認"),
  );
  for (const changed of [
    "src/domain/staging-layout.ts",
    "dist/src/domain/staging-layout.js",
    "dist/src/cli.js",
    "docs/specs/02_要件/00_要件一覧.md",
    "test/features/unit/staging-layout.feature",
  ])
    assert.ok(audit.includes(`\`${changed}\``), changed);
});

draft.Then(
  "生成物行に生成元との対応確認と配布影響の確認方法がある",
  function () {
    const generatedRows = this.draft
      .split("\n")
      .filter((line) => line.startsWith("| `dist/"));
    assert.equal(generatedRows.length, 2);
    for (const row of generatedRows) {
      assert.match(row, /生成元/u);
      assert.match(row, /配布物影響/u);
    }
  },
);

draft.Then(
  "配布物影響の表は生成物を境界単位にまとめ入る入らないを判定している",
  function () {
    const section = this.draft.slice(
      this.draft.indexOf("## 8. 配布物影響"),
      this.draft.indexOf("## 9. 独立reviewの成立"),
    );
    assert.match(section, /^\| dist\/src\/ \| 入る \|/mu);
    assert.ok(!section.includes("dist/src/cli.js"), "生成物は個別に並べない");
    assert.match(section, /^\| src\/domain\/staging-layout\.ts \| 入る \|/mu);
    assert.match(
      section,
      /^\| docs\/specs\/02_要件\/00_要件一覧\.md \| 入らない \| なし \|/mu,
    );
    assert.ok(!section.includes("{パス}"));
  },
);

draft.Then("ラウンド数は整数で始まる", function () {
  assert.match(this.draft, /^\| ラウンド数 \| \d+/mu);
});
