import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  checkLifecycleDistributionExclusion,
  checkLifecycleIgnore,
  checkLifecyclePackageEntries,
  LIFECYCLE_PACKAGE_ENTRIES,
} from "../../scripts/check_conformance.js";
import { FORBIDDEN_DISTRIBUTION_PREFIXES } from "../../scripts/check_package_contents.js";
import {
  isStagingLifecyclePath,
  STAGING_LIFECYCLE_AREAS,
} from "../../src/domain/staging.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class LifecycleIgnoreWorld extends WorkflowWorld {
  root = "";
  other = "";
  errors: string[] = [];
  areas: string[] = [];
  prefixes: string[] = [];
  judgements: Array<{ path: string; expected: boolean }> = [];
  output = "";
  environment: Record<string, string | undefined> = {};
}

const { Given, When, Then } = stepDefinitions<LifecycleIgnoreWorld>();

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function writeFile(root: string, relative: string, content: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/** 全領域を無視する`.gitignore`を持つ隔離repositoryを作る。 */
function createRepository(
  world: LifecycleIgnoreWorld,
  options: { ignoreLines?: string[]; trackIgnoreFile?: boolean } = {},
): string {
  const root = world.initRepo();
  const lines =
    options.ignoreLines ?? STAGING_LIFECYCLE_AREAS.map((area) => `${area}/`);
  writeFile(root, ".gitignore", `${lines.join("\n")}\n`);
  if (options.trackIgnoreFile !== false) {
    git(root, ["add", "--", ".gitignore"]);
    git(root, ["commit", "-q", "-m", "chore: 無視設定を置く"]);
  }
  return root;
}

function repositoryRoot(): string {
  return path.resolve(".");
}

// ---------- unit ----------

Given("適合性検査scriptがある", function () {
  this.output = fs.readFileSync(
    path.join(repositoryRoot(), "scripts/check_conformance.ts"),
    "utf8",
  );
});

When("適合性検査scriptのsourceを読む", function () {
  // 領域一覧の全要素と、除外一覧固有のprefixが直書きされていないことを見る
  this.errors = this.output
    .split(/\r?\n/u)
    .filter(
      (line) =>
        STAGING_LIFECYCLE_AREAS.some((area) => line.includes(area)) ||
        line.includes('"secret-fixtures/'),
    );
});

Then("領域prefixも除外一覧も自前で列挙していない", function () {
  assert.deepEqual(this.errors, []);
  assert.ok(this.output.includes("STAGING_LIFECYCLE_AREAS"));
  assert.ok(this.output.includes("FORBIDDEN_DISTRIBUTION_PREFIXES"));
});

Given("領域判定の代表入力がある", function () {
  this.judgements = [
    { path: ".agent-skill-chain/tmp", expected: true },
    { path: ".agent-skill-chain/tmp/issues/x", expected: true },
    { path: ".agent-skill-chain/role-log", expected: true },
    { path: ".agent-skill-chain/role-log/a/b", expected: true },
    { path: ".agent-skill-chain/metrics", expected: true },
    { path: ".agent-skill-chain/metrics/report.json", expected: true },
    { path: ".agent-skill-chain/tmpx/y", expected: false },
    { path: ".agent-skill-chain/role-logs", expected: false },
    { path: ".agent-skill-chain/docs/00_運用ポリシー.md", expected: false },
    { path: "src/domain/staging.ts", expected: false },
  ];
});

When("領域判定を実行する", function () {
  this.errors = this.judgements
    .filter((entry) => isStagingLifecyclePath(entry.path) !== entry.expected)
    .map((entry) => entry.path);
});

Then(
  "領域そのものと配下は真、境界の違うpathと無関係なpathは偽になる",
  function () {
    assert.deepEqual(this.errors, []);
  },
);

Given("除外一覧から1領域を落とした照合入力がある", function () {
  this.areas = [...STAGING_LIFECYCLE_AREAS];
  this.prefixes = FORBIDDEN_DISTRIBUTION_PREFIXES.filter(
    (prefix) => prefix !== `${STAGING_LIFECYCLE_AREAS[1]!}/`,
  );
});

Given("領域一覧にだけ新領域を足した照合入力がある", function () {
  this.areas = [...STAGING_LIFECYCLE_AREAS, ".agent-skill-chain/traces"];
  this.prefixes = [...FORBIDDEN_DISTRIBUTION_PREFIXES];
});

Given("実際の領域一覧と除外一覧がある", function () {
  this.areas = [...STAGING_LIFECYCLE_AREAS];
  this.prefixes = [...FORBIDDEN_DISTRIBUTION_PREFIXES];
});

When("配布物除外の照合を実行する", function () {
  this.errors = checkLifecycleDistributionExclusion(this.areas, this.prefixes);
});

Then("欠けている領域を示して失敗する", function () {
  assert.equal(this.errors.length, 1);
  assert.match(this.errors[0]!, /配布物検査の除外一覧にありません/u);
});

Then("照合は成功する", function () {
  assert.deepEqual(this.errors, []);
});

Given(
  "外部command起動を記録する偽commandを先頭に置いた子processを用意する",
  function () {
    // PATHの先頭へ偽npmを置き、起動されたらmarkerを書く。出力の有無ではなく起動そのものを観測する。
    this.other = this.temp();
    this.output = path.join(this.other, "invoked.log");
    const fake = path.join(this.other, "npm");
    fs.writeFileSync(
      fake,
      `#!/bin/sh\necho "$@" >> ${JSON.stringify(this.output)}\nexit 0\n`,
    );
    fs.chmodSync(fake, 0o755);
  },
);

When("子processを実行する", function () {
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "-e",
      'await import("./scripts/check_package_contents.ts");',
    ],
    {
      cwd: repositoryRoot(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${this.other}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    },
  );
});

Then("外部commandの起動記録が1件も無い", function () {
  assert.ok(
    !fs.existsSync(this.output),
    `import副作用で外部commandが起動しました: ${fs.existsSync(this.output) ? fs.readFileSync(this.output, "utf8") : ""}`,
  );
});

Given("公開された領域一覧と除外一覧がある", function () {
  this.areas = [...STAGING_LIFECYCLE_AREAS];
});

When("凍結状態を確認する", function () {
  this.judgements = [
    {
      path: "STAGING_LIFECYCLE_AREAS",
      expected: Object.isFrozen(STAGING_LIFECYCLE_AREAS),
    },
    {
      path: "FORBIDDEN_DISTRIBUTION_PREFIXES",
      expected: Object.isFrozen(FORBIDDEN_DISTRIBUTION_PREFIXES),
    },
  ];
});

Then("どちらも凍結されている", function () {
  assert.deepEqual(
    this.judgements
      .filter((entry) => !entry.expected)
      .map((entry) => entry.path),
    [],
  );
});

// ---------- integration ----------

Given("製品repositoryがある", function () {
  this.root = repositoryRoot();
});

Given("全領域を無視した隔離repository", function () {
  this.root = createRepository(this);
});

Given("role-logだけを無視対象から外した隔離repository", function () {
  this.root = createRepository(this, {
    ignoreLines: STAGING_LIFECYCLE_AREAS.filter(
      (area) => !area.endsWith("role-log"),
    ).map((area) => `${area}/`),
  });
});

Given("metrics配下のfileを追跡した隔離repository", function () {
  this.root = createRepository(this);
  writeFile(this.root, ".agent-skill-chain/metrics/report.json", "{}\n");
  git(this.root, ["add", "-f", "--", ".agent-skill-chain/metrics/report.json"]);
  git(this.root, ["commit", "-q", "-m", "chore: 計測を誤って追跡する"]);
});

Given("role-log配下の1つのpathだけを無視した隔離repository", function () {
  this.root = createRepository(this, {
    ignoreLines: [
      ...STAGING_LIFECYCLE_AREAS.filter(
        (area) => !area.endsWith("role-log"),
      ).map((area) => `${area}/`),
      ".agent-skill-chain/role-log/probe",
      ".agent-skill-chain/role-log/nested/deeper/probe",
    ],
  });
});

Given("role-log配下を否定patternで再許可した隔離repository", function () {
  this.root = createRepository(this, {
    // 親directoryごと除外すると否定patternは効かない。個別除外＋否定で再許可を成立させる
    ignoreLines: [
      ...STAGING_LIFECYCLE_AREAS.filter(
        (area) => !area.endsWith("role-log"),
      ).map((area) => `${area}/`),
      ".agent-skill-chain/role-log/*",
      "!.agent-skill-chain/role-log/probe",
    ],
  });
});

Given(
  "無視設定をrepository外のexclude fileへ置いた隔離repository",
  function () {
    this.root = createRepository(this, {
      ignoreLines: STAGING_LIFECYCLE_AREAS.filter(
        (area) => !area.endsWith("metrics"),
      ).map((area) => `${area}/`),
    });
    fs.appendFileSync(
      path.join(this.root, ".git/info/exclude"),
      "\n.agent-skill-chain/metrics/\n",
    );
  },
);

Given("gitignoreを追跡していない隔離repository", function () {
  this.root = createRepository(this, { trackIgnoreFile: false });
});

Given(
  "role-logだけを無視対象から外した隔離repositoryと、全領域を無視した別repositoryがある",
  function () {
    this.root = createRepository(this, {
      ignoreLines: STAGING_LIFECYCLE_AREAS.filter(
        (area) => !area.endsWith("role-log"),
      ).map((area) => `${area}/`),
    });
    this.other = createRepository(this);
  },
);

Given(
  "metrics配下のfileを追跡した隔離repositoryと、空の代替indexがある",
  function () {
    this.root = createRepository(this);
    writeFile(this.root, ".agent-skill-chain/metrics/report.json", "{}\n");
    git(this.root, [
      "add",
      "-f",
      "--",
      ".agent-skill-chain/metrics/report.json",
    ]);
    git(this.root, ["commit", "-q", "-m", "chore: 計測を誤って追跡する"]);
    this.other = path.join(this.temp(), "alternate.index");
  },
);

When("一時ライフサイクル領域の整合を検査する", function () {
  this.errors = checkLifecycleIgnore(this.root);
});

When("隔離repositoryの一時ライフサイクル領域の整合を検査する", function () {
  this.errors = checkLifecycleIgnore(this.root);
});

function withEnvironment(
  values: Record<string, string>,
  run: () => string[],
): string[] {
  const saved = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, values);
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(saved))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
}

When("別repositoryを指す環境変数を設定して整合を検査する", function () {
  this.errors = withEnvironment(
    {
      GIT_DIR: path.join(this.other, ".git"),
      GIT_WORK_TREE: this.other,
    },
    () => checkLifecycleIgnore(this.root),
  );
});

When("代替indexを指す環境変数を設定して整合を検査する", function () {
  this.errors = withEnvironment({ GIT_INDEX_FILE: this.other }, () =>
    checkLifecycleIgnore(this.root),
  );
});

Then("整合検査は合格する", function () {
  assert.deepEqual(this.errors, []);
});

Then("整合検査は無視対象でない領域を示して失敗する", function () {
  assert.ok(
    this.errors.some((message) =>
      /無視対象ではありません: \.agent-skill-chain\/role-log/u.test(message),
    ),
    JSON.stringify(this.errors),
  );
});

Then("整合検査は追跡中のpathを示して失敗する", function () {
  assert.ok(
    this.errors.some((message) =>
      /配下のfileが追跡されています: \.agent-skill-chain\/metrics\/report\.json/u.test(
        message,
      ),
    ),
    JSON.stringify(this.errors),
  );
});

Then(
  "整合検査は無視patternが領域全体を指していないことを示して失敗する",
  function () {
    assert.ok(
      this.errors.some((message) =>
        /無視patternが領域全体を指していません|無視対象ではありません/u.test(
          message,
        ),
      ),
      JSON.stringify(this.errors),
    );
  },
);

Then("整合検査は失敗する", function () {
  assert.notDeepEqual(this.errors, []);
});

Then("整合検査は一致元がgitignoreでないことを示して失敗する", function () {
  assert.ok(
    this.errors.some((message) =>
      /追跡される \.gitignore にありません/u.test(message),
    ),
    JSON.stringify(this.errors),
  );
});

Then("整合検査はgitignoreが追跡されていないことを示して失敗する", function () {
  assert.ok(
    this.errors.some((message) =>
      /\.gitignore がrepositoryで追跡されていません/u.test(message),
    ),
    JSON.stringify(this.errors),
  );
});

Given("package禁止entry一覧から1領域を落とした照合入力がある", function () {
  this.areas = [...STAGING_LIFECYCLE_AREAS];
  this.prefixes = LIFECYCLE_PACKAGE_ENTRIES.filter(
    (entry) => entry !== STAGING_LIFECYCLE_AREAS[2]!,
  );
});

Given("実際の領域一覧とpackage禁止entry一覧がある", function () {
  this.areas = [...STAGING_LIFECYCLE_AREAS];
  this.prefixes = [...LIFECYCLE_PACKAGE_ENTRIES];
});

When("package禁止entryの照合を実行する", function () {
  this.errors = checkLifecyclePackageEntries(this.areas, this.prefixes);
});

Then("欠けている領域をpackage禁止entryとして示して失敗する", function () {
  assert.equal(this.errors.length, 1);
  assert.match(this.errors[0]!, /package資産の禁止entry一覧にありません/u);
});

When("追跡fileの列挙だけが失敗する状態で整合を検査する", function () {
  // ls-filesだけを失敗させる。他のcommandは本物へ委譲するのでrev-parseで早期returnしない
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
  this.errors = withEnvironment(
    { PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}` },
    () => checkLifecycleIgnore(this.root),
  );
});

Then("整合検査は追跡fileを列挙できないことを示して失敗する", function () {
  assert.ok(
    this.errors.some((message) => /追跡fileを列挙できません/u.test(message)),
    JSON.stringify(this.errors),
  );
});

When("設定注入で外部の無視設定を足して整合を検査する", function () {
  // GIT_CONFIG_PARAMETERSでcore.excludesFileを注入すると、除去しなければ
  // check-ignoreがexit 0を返し、無視漏れが「一致元が違う」へすり替わる
  const excludes = path.join(this.temp(), "external-excludes");
  fs.writeFileSync(excludes, ".agent-skill-chain/role-log/\n");
  this.errors = withEnvironment(
    { GIT_CONFIG_PARAMETERS: `'core.excludesFile=${excludes}'` },
    () => checkLifecycleIgnore(this.root),
  );
});

Then("整合検査は無視対象でないことを理由に失敗する", function () {
  assert.ok(
    this.errors.some((message) =>
      /無視対象ではありません: \.agent-skill-chain\/role-log/u.test(message),
    ),
    JSON.stringify(this.errors),
  );
  assert.ok(
    !this.errors.some((message) => /一致元/u.test(message)),
    `外部の無視設定が観測に混入しています: ${JSON.stringify(this.errors)}`,
  );
});

Given("配布物検査moduleへのsymlinkを用意する", function () {
  this.other = path.join(this.temp(), "linked-check.ts");
  fs.symlinkSync(
    path.join(repositoryRoot(), "scripts/check_package_contents.ts"),
    this.other,
  );
});

When("symlink経由で子processを実行する", function () {
  this.output = execFileSync(
    process.execPath,
    ["--import", "tsx", this.other],
    {
      cwd: repositoryRoot(),
      encoding: "utf8",
    },
  );
});

Then("出力にパッケージ内容検査の結果が現れる", function () {
  assert.match(this.output, /パッケージ内容検査/u);
});
