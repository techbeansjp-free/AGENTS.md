import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { checkSpecNormalization } from "../../scripts/check_trace.js";
import { isIssueStagingPath } from "../../src/domain/staging.js";

const ISSUE_STAGING_PREFIX = ".agent-skill-chain/tmp/issues";

const SCN_PLACEMENT = "所定location外にSCN定義があります";
const SCN_LINE = "  Scenario: SCN-UNIT-EXAMPLE-001 例";

interface ScnScopeWorld extends WorkflowWorld {
  root: string;
  errors: string[];
  allErrors: string[];
  judged: Array<{ input: string; excluded: boolean }>;
  exported: string[];
  definitions: number;
}

const { Given, When, Then } = stepDefinitions<ScnScopeWorld>();

function write(root: string, relative: string, text: string) {
  const absolute = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, text);
  return absolute;
}

function placementErrors(errors: readonly string[]): string[] {
  return errors.filter((error) => error.startsWith(SCN_PLACEMENT));
}

Given("Issue一時ステージング内にSCN定義を含むMarkdownがある", function () {
  this.root = this.temp();
  write(
    this.root,
    `${ISSUE_STAGING_PREFIX}/20260826_x/01_要件定義.md`,
    SCN_LINE,
  );
});

Given("除外領域外にSCN定義を含むMarkdownがある", function () {
  this.root = this.temp();
  write(this.root, "docs/例.md", SCN_LINE);
});

Given("test配下のfeatureにSCN定義がある", function () {
  this.root = this.temp();
  write(this.root, "test/features/unit/例.feature", SCN_LINE);
});

Given("除外判定へ渡す生のpath一覧がある", function () {
  // filesystemを経由するとpath.joinが親参照を解決してしまい、悪用入力そのものを
  // 検証できない。判定関数へ生の文字列を直接入力する。
  this.judged = [
    `${ISSUE_STAGING_PREFIX}/20260826_x/01_要件定義.md`,
    ".agent-skill-chain\\tmp\\issues\\20260826_x\\01_要件定義.md",
    `${ISSUE_STAGING_PREFIX}/../../../docs/例.md`,
    `${ISSUE_STAGING_PREFIX}/./20260826_x/01_要件定義.md`,
    `${ISSUE_STAGING_PREFIX}//20260826_x/01_要件定義.md`,
    ISSUE_STAGING_PREFIX,
    `${ISSUE_STAGING_PREFIX}-old/例.md`,
    "docs/例.md",
    "",
  ].map((input) => ({ input, excluded: isIssueStagingPath(input) }));
});

Given("除外領域に前方一致するだけの近似pathにSCN定義がある", function () {
  this.root = this.temp();
  write(this.root, ".agent-skill-chain/tmp/issues-old/例.md", SCN_LINE);
});

Given("role-logとmetricsにSCN定義がある", function () {
  this.root = this.temp();
  write(this.root, ".agent-skill-chain/role-log/例.md", SCN_LINE);
  write(this.root, ".agent-skill-chain/metrics/例.md", SCN_LINE);
});

Given("git管理下にないrepositoryの除外領域外にSCN定義がある", function () {
  this.root = this.temp();
  assert.equal(fs.existsSync(path.join(this.root, ".git")), false);
  write(this.root, "docs/例.md", SCN_LINE);
});

Given("除外領域内から領域外のSCN定義へsymlinkを張る", function () {
  this.root = this.temp();
  write(this.root, "docs/例.md", SCN_LINE);
  const linkDirectory = path.join(
    this.root,
    ...`${ISSUE_STAGING_PREFIX}/20260826_x`.split("/"),
  );
  fs.mkdirSync(linkDirectory, { recursive: true });
  fs.symlinkSync(
    path.join(this.root, "docs", "例.md"),
    path.join(linkDirectory, "隠蔽.md"),
  );
});

Given("除外領域外にSCN定義fileとそのsymlinkがある", function () {
  this.root = this.temp();
  write(this.root, "docs/例.md", SCN_LINE);
  fs.symlinkSync(
    path.join(this.root, "docs", "例.md"),
    path.join(this.root, "docs", "写し.md"),
  );
});

Given(
  "仕様一式とIssue一時ステージングを持つrepository fixtureがある",
  function () {
    // 実rootの.agent-skill-chain/tmp/はgitignore対象であり、clean cloneやCIでは
    // 存在が保証されない。実rootに依存すると前提が空振りするためfixtureを組む。
    this.root = this.temp();
    fs.cpSync(
      path.join(process.cwd(), ".agent-skill-chain", "templates", "specs"),
      path.join(this.root, "docs", "specs"),
      { recursive: true },
    );
    write(
      this.root,
      `${ISSUE_STAGING_PREFIX}/20260826_x/01_要件定義.md`,
      SCN_LINE,
    );
    assert.ok(
      fs.existsSync(
        path.join(
          this.root,
          ...`${ISSUE_STAGING_PREFIX}/20260826_x/01_要件定義.md`.split("/"),
        ),
      ),
    );
  },
);

Given("SCN配置検査の実装がある", function () {
  this.root = process.cwd();
});

Given("除外領域に要件本文とSCN定義を併記したfixtureがある", function () {
  // 同じfileがSCN配置検査と要件本文検査の両方に掛かる。除外後もwalkerが
  // 列挙し続けていれば、要件本文側の診断だけが残る。
  this.root = this.temp();
  write(
    this.root,
    `${ISSUE_STAGING_PREFIX}/20260826_x/01_要件定義.md`,
    `## REQ-SCOPE-001 例\n\n本文\n\n${SCN_LINE}\n`,
  );
});

When("SCN配置検査を実行する", function () {
  this.allErrors = checkSpecNormalization(this.root).errors;
  this.errors = placementErrors(this.allErrors);
});

When("fixtureのtrace gateを実行する", function () {
  // 配置診断はnormalizationが持つ。specsだけを見ると素通りする
  this.errors = placementErrors(checkSpecNormalization(this.root).errors);
});

When("除外領域pathの定義箇所を数える", function () {
  const sources = ["src/domain/staging.ts", "scripts/check_trace.ts"];
  this.definitions = sources
    .map((relative) => fs.readFileSync(path.join(this.root, relative), "utf8"))
    .join("\n")
    .split("\n")
    .filter((line) => line.includes(`"${ISSUE_STAGING_PREFIX}"`)).length;
});

When("除外判定を1件ずつ適用する", function () {
  // Givenで適用済み
});

Then("検査はSCN配置違反を報告しない", function () {
  assert.deepEqual(this.errors, []);
});

Then("検査はSCN配置違反を報告する", function () {
  assert.ok(this.errors.length > 0, this.errors.join("; "));
});

Then("検査はSCN配置違反を2件報告する", function () {
  assert.equal(this.errors.length, 2, this.errors.join("; "));
});

Then("検査はSCN配置違反を1件だけ報告する", function () {
  assert.equal(this.errors.length, 1, this.errors.join("; "));
});

Then("trace gateはSCN配置違反を報告しない", function () {
  assert.deepEqual(this.errors, []);
});

Then("定義は正本1箇所だけであり検査は参照する", function () {
  assert.equal(this.definitions, 1);
});

Then("区切りを正規化し親参照と現在参照を含むpathは除外しない", function () {
  const byInput = new Map(this.judged.map((row) => [row.input, row.excluded]));
  // 正規化: Windows形式区切りも除外領域として扱う
  assert.equal(
    byInput.get(`${ISSUE_STAGING_PREFIX}/20260826_x/01_要件定義.md`),
    true,
  );
  assert.equal(
    byInput.get(".agent-skill-chain\\tmp\\issues\\20260826_x\\01_要件定義.md"),
    true,
  );
  // 親参照・現在参照・空segmentは判定不能として除外しない
  assert.equal(
    byInput.get(`${ISSUE_STAGING_PREFIX}/../../../docs/例.md`),
    false,
  );
  assert.equal(
    byInput.get(`${ISSUE_STAGING_PREFIX}/./20260826_x/01_要件定義.md`),
    false,
  );
  assert.equal(
    byInput.get(`${ISSUE_STAGING_PREFIX}//20260826_x/01_要件定義.md`),
    false,
  );
  // 領域そのもの、近似path、無関係path、空文字は除外しない
  assert.equal(byInput.get(ISSUE_STAGING_PREFIX), false);
  assert.equal(byInput.get(`${ISSUE_STAGING_PREFIX}-old/例.md`), false);
  assert.equal(byInput.get("docs/例.md"), false);
  assert.equal(byInput.get(""), false);
});

Then("SCN配置違反は出ないが要件本文の診断は従来どおり出る", function () {
  assert.deepEqual(this.errors, []);
  assert.ok(
    this.allErrors.some((error) =>
      error.startsWith("所定location外に要件本文があります"),
    ),
    this.allErrors.join("; "),
  );
});

// `dist/src/`は配布対象である。exportの追加が実際に配布物へ現れ、
// 既存exportが1件も欠けていないことを配布buildに対して直接確認する。
const BASELINE_STAGING_EXPORTS = [
  "STAGING_RECORD_FILE",
  "calculateStagingDigest",
  "listStagingArtifacts",
  "readStoredStagingRecord",
  "refreshStoredStagingDigest",
  "inspectStaging",
  "planStagingCleanup",
  "applyStagingCleanup",
  "isStagingLifecyclePath",
];

Given("配布buildのstaging moduleがある", function () {
  this.root = process.cwd();
});

When("公開exportの一覧を取得する", async function () {
  const distribution = path.join(
    this.root,
    "dist",
    "src",
    "domain",
    "staging.js",
  );
  assert.ok(fs.existsSync(distribution), `${distribution}が存在しません`);
  this.exported = Object.keys(
    (await import(pathToFileURL(distribution).href)) as Record<string, unknown>,
  );
});

Then(
  "一覧はisIssueStagingPathを含み既存exportを1件も失っていない",
  function () {
    assert.ok(
      this.exported.includes("isIssueStagingPath"),
      this.exported.join(", "),
    );
    const missing = BASELINE_STAGING_EXPORTS.filter(
      (name) => !this.exported.includes(name),
    );
    assert.deepEqual(missing, []);
  },
);
