import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { checkSpecNormalization } from "../../scripts/check_trace.js";
import {
  isIssueStagingPath,
  isStagingLifecyclePath,
  isStagingLifecycleScanPath,
  STAGING_LIFECYCLE_AREAS,
} from "../../src/domain/staging.js";
import { visibleMarkdownLines } from "../support/markdown.js";

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
  write(this.root, ".agent-skill-chain/tmp-old/例.md", SCN_LINE);
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

/**
 * **報告される期待集合を固定値で書く。**
 *
 * 述語自身から期待を導出すると、判定を`startsWith(area)`へ緩めても両側が
 * 同じ向きにずれて通過する。独立reviewerが固定oracleと退化oracleの比較で
 * その差を実測した（Issue #1273）。
 */
const PLACEMENT_FIXTURE: ReadonlyArray<readonly [string, boolean]> = [
  ["test/features/unit/allowed.feature", false],
  ["test/features/unit/not-allowed.md", true],
  ["test/features-old/misplaced.feature", true],
  ["test/steps/misplaced.feature", true],
  ["docs/outside.md", true],
  ["src/outside.feature", true],
  [".agent-skill-chain/docs/outside.md", true],
  [".agent-skill-chain/tmp-old/near.md", true],
  [".agent-skill-chain/role-log-old/near.feature", true],
  [".agent-skill-chain/metrics-old/near.md", true],
  [".agent-skill-chain/runtime-old/near.feature", true],
  [".agent-skill-chain/tmp/handoffs/draft.md", false],
  [".agent-skill-chain/tmp/issues-old/draft.feature", false],
  [".agent-skill-chain/role-log/draft.feature", false],
  [".agent-skill-chain/metrics/draft.md", false],
  [".agent-skill-chain/runtime/draft.feature", false],
];

Given("一時ライフサイクル領域4件すべてにSCN定義がある", function () {
  this.root = this.temp();
  write(this.root, ".agent-skill-chain/tmp/handoffs/例.md", SCN_LINE);
  write(this.root, ".agent-skill-chain/role-log/例.feature", SCN_LINE);
  write(this.root, ".agent-skill-chain/metrics/例.md", SCN_LINE);
  write(this.root, ".agent-skill-chain/runtime/例.feature", SCN_LINE);
});

Given(
  "4領域それぞれの近似pathと所定locationと領域外にSCN定義がある",
  function () {
    this.root = this.temp();
    for (const [relative] of PLACEMENT_FIXTURE)
      write(this.root, relative, SCN_LINE);
  },
);

Then("検査は固定の期待集合どおりに配置違反を報告する", function () {
  const expected = PLACEMENT_FIXTURE.filter(([, reported]) => reported)
    .map(([relative]) => relative)
    .sort();
  const actual = this.errors
    .map((error) => error.slice(SCN_PLACEMENT.length + 2).split(":")[0] ?? "")
    .sort();
  assert.deepEqual(actual, expected);
});

Given("新しい除外判定へ渡す生のpath一覧がある", function () {
  // filesystemを経由するとpath.joinが親参照を解決してしまい、悪用入力そのものを
  // 検証できない。判定関数へ生の文字列を直接入力する。
  const area = STAGING_LIFECYCLE_AREAS[0]!;
  this.judged = [
    `${area}/handoffs/01_要件定義.md`,
    // **POSIXの \ はfile名文字であり区切りではない。** 領域外として扱う
    ".agent-skill-chain\\tmp\\handoffs\\01_要件定義.md",
    `${area}/../../../docs/例.md`,
    `${area}/./handoffs/01_要件定義.md`,
    `${area}//handoffs/01_要件定義.md`,
    ...STAGING_LIFECYCLE_AREAS,
    `${area}-old/例.md`,
    "docs/例.md",
    "",
  ].map((input) => ({ input, excluded: isStagingLifecycleScanPath(input) }));
});

When("新しい除外判定を1件ずつ適用する", function () {
  assert.notEqual(this.judged.length, 0, "判定対象がありません");
});

Then(
  "区切りを正規化し親参照と現在参照と空segmentを含むpathは除外しない",
  function () {
    assert.deepEqual(
      this.judged.map(({ excluded }) => excluded),
      [
        true,
        false,
        false,
        false,
        false,
        ...STAGING_LIFECYCLE_AREAS.map(() => true),
        false,
        false,
        false,
      ],
    );
    /**
     * **2種類の「領域そのもの」を混同しない。** 一時ライフサイクル領域そのものは
     * 真だが、Issue一時ステージングのprefixそのものは従来どおり偽である。
     */
    assert.equal(isIssueStagingPath(".agent-skill-chain/tmp/issues"), false);
  },
);

/**
 * **`isStagingLifecyclePath`の契約が変わっていないことを固定する。**
 *
 * `\\`はPOSIXでは通常文字であり、これらは一時領域配下に実在しうる合法なfile名
 * である。厳格化すると`checkLifecycleIgnore`の追跡混入拒否がすり抜ける。
 */
Given("区切り文字を名前に含む合法な一時領域pathがある", function () {
  this.judged = [
    // **領域そのものも契約の一部である。** 配下だけを見ると
    // `normalized === area` を落とす変異が生存する。
    ...STAGING_LIFECYCLE_AREAS,
    ...STAGING_LIFECYCLE_AREAS.flatMap((area) =>
      ["..\\draft.md", ".\\draft.md", "\\draft.md", "draft.md"].map(
        (name) => `${area}/${name}`,
      ),
    ),
  ].map((input) => ({ input, excluded: isStagingLifecyclePath(input) }));
});

When("追跡混入検査が使う領域判定を適用する", function () {
  assert.equal(this.judged.length, STAGING_LIFECYCLE_AREAS.length * 5);
});

Then("すべて領域内と判定される", function () {
  assert.deepEqual(
    this.judged.filter(({ excluded }) => !excluded).map(({ input }) => input),
    [],
  );
});

const REQ_SQ_017_STALE = [
  "**`.agent-skill-chain/role-log/`と`.agent-skill-chain/metrics/`は除外しない。**",
  "この2領域は`.gitignore`に無く追跡され得るため",
];
const REQ_SQ_017_STALE_SCOPE = [
  "走査範囲からIssue一時ステージング`.agent-skill-chain/tmp/issues/`だけを除く",
];

/**
 * **標識文だけでなく、各段落の実体も固定する。**
 *
 * 見出しの1文だけを検査すると、段落の後続本文を空にする変異が生存する
 * （Issue #1273、独立reviewerのM-02）。品質基準が要求する
 * 「欄名や見出しを残して値だけを空にする変異」を殺すため、各段落から
 * **判断の実体を1文ずつ**名指しする。
 */
const REQ_SQ_017_CURRENT = [
  "**除外は一時ライフサイクル領域`STAGING_LIFECYCLE_AREAS`の4件とする。**",
  "除外範囲をこの検査が独自に持たず、分類の唯一の正本から導出する",
  "**`role-log/`と`metrics/`を除外しなかった旧来の理由は成立しない。**",
  "REQ-SQ-019がその非対称を解消し",
  "**受け入れる検出損失を明示する。**",
  "**未追跡の誤配置featureまで代替検出する保証ではない。代替検出があるとは主張しない。**",
  "**SCN配置検査が使う判定は`isStagingLifecyclePath`ではない。**",
  "**「安全側」の向きは呼び出し元ごとに逆である。**",
];

Given("仕様・品質管理要件の正本がある", function () {
  this.exported = [];
});

When("REQ-SQ-017の除外範囲の記述を表示本文で検査する", function () {
  const document = fs.readFileSync(
    path.resolve("docs/specs/02_要件/04_仕様・品質管理要件.md"),
    "utf8",
  );
  const [, after = ""] = document.split(
    "### REQ-SQ-017 SCN配置検査の走査範囲から一時ライフサイクル領域を除く",
  );
  this.exported = visibleMarkdownLines(after.split("\n### ")[0] ?? "");
});

Then("陳腐化した記述が存在せず新しい除外範囲と理由が存在する", function () {
  const section = this.exported.join("\n");
  assert.notEqual(section, "", "REQ-SQ-017の節が見つかりません");
  for (const stale of [...REQ_SQ_017_STALE, ...REQ_SQ_017_STALE_SCOPE])
    assert.equal(
      section.includes(stale),
      false,
      `陳腐化した記述が残っています: ${stale}`,
    );
  for (const current of REQ_SQ_017_CURRENT)
    assert.equal(
      section.includes(current),
      true,
      `新しい記述がありません: ${current}`,
    );
});

/**
 * **領域名の直後に区切り文字を持つfileは領域外である。**
 *
 * POSIXでは`\\`は通常のfile名文字であり、
 * `.agent-skill-chain/role-log\\evil.feature`の親directoryは
 * `.agent-skill-chain`である。除外判定が`\\`を区切りへ倒すと、
 * **除外が領域の外へ及ぶ**（Issue #1273、独立reviewerのH-01）。
 */
Given("領域名の直後に区切り文字を含む領域外pathにSCN定義がある", function () {
  this.root = this.temp();
  const container = path.join(this.root, ".agent-skill-chain");
  fs.mkdirSync(container, { recursive: true });
  for (const name of [
    "role-log\\evil.feature",
    "metrics\\evil.feature",
    "runtime\\evil.feature",
    "tmp\\handoffs\\evil.feature",
  ])
    fs.writeFileSync(path.join(container, name), SCN_LINE);
});

Then("検査はSCN配置違反を4件報告する", function () {
  assert.equal(this.errors.length, 4);
});
