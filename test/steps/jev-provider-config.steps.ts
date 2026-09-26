import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { After } from "@cucumber/cucumber";
import { resolveJevProviderConfig } from "../../src/adapters/local-config-workspace.js";
import {
  classifyJevProviderConfig,
  loadJevProviderConfig,
  JEV_PROVIDER_CONFIG_PATH,
  type JevProviderConfig,
} from "../../src/domain/jev-provider-config.js";
import type {
  LocalConfigClassification,
  LocalConfigResolution,
} from "../../src/domain/local-config-resolution.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

class JevProviderConfigWorld extends WorkflowWorld {
  root = "";
  configPath = JEV_PROVIDER_CONFIG_PATH;
  envVarName = "";
  previousEnvValue: string | undefined = undefined;
  result: JevProviderConfig | undefined = undefined;
  fixtureSnapshotBefore: string = "";
  fixtureSnapshotAfter: string = "";
  secretValue = "";
  classification: LocalConfigClassification<JevProviderConfig> | undefined =
    undefined;
  /**
   * loader呼び出し中に実際にfsへ渡されたpath（readFileSync/statSync）。
   * import specifierの静的走査だけでは、読み取った結果を捨てる変異
   * （例えばmodelMappingをreadFileSyncしても戻り値を使わない）を見逃す
   * （readiness reviewのcodex指摘M-02）。この配列は実際に発生したfs
   * 呼び出しを記録し、SCN-008がtrusted pathの不在を動的に確認する。
   */
  readPaths: string[] = [];
  restoreReadFileSync: (() => void) | undefined = undefined;
  resolution: LocalConfigResolution<JevProviderConfig> | undefined = undefined;
}

const { Given, When, Then } = stepDefinitions<JevProviderConfigWorld>();

After<JevProviderConfigWorld>(function () {
  // L-01是正（readiness reviewのcodex指摘）:
  // 変更したenv varを必ず元の値へ戻し、後続scenarioへ漏らさない。
  if (this.envVarName !== "") {
    if (this.previousEnvValue === undefined)
      delete process.env[this.envVarName];
    else process.env[this.envVarName] = this.previousEnvValue;
  }
});

function writeConfig(root: string, content: unknown): void {
  const resolved = path.join(root, JEV_PROVIDER_CONFIG_PATH);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(content, null, 2));
}

function snapshotLocalDir(root: string): string {
  // M-03是正（readiness reviewのcodex指摘）:
  // 直下fileだけでなく配下を再帰的に走査し、nested pathへの書込みも検知する。
  const dir = path.join(root, ".agent-skill-chain/local");
  if (!fs.existsSync(dir)) return "";
  const parts: string[] = [];
  const walk = (current: string, prefix: string) => {
    for (const name of fs.readdirSync(current).sort()) {
      const filePath = path.join(current, name);
      const relative = prefix === "" ? name : `${prefix}/${name}`;
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) walk(filePath, relative);
      else if (stat.isFile())
        parts.push(`${relative}:${fs.readFileSync(filePath, "utf8")}`);
    }
  };
  walk(dir, "");
  return parts.join("\n---\n");
}

function setEnvVar(world: JevProviderConfigWorld, name: string, value: string) {
  world.envVarName = name;
  world.previousEnvValue = process.env[name];
  process.env[name] = value;
}

/**
 * `loadJevProviderConfig`呼び出し中にfsへ渡された実際のpathを記録する。
 * import specifierの静的一致だけでは、読み取った結果を破棄する変異を
 * 見逃すため（readiness reviewのcodex指摘M-02）、実行時のfs呼び出しを
 * 直接計測する。
 */
/**
 * `loadJevProviderConfig`は`fs.readFileSync(path, "utf8")`と
 * `fs.statSync(path)`のこの2形状だけを呼ぶ。spyは実装が実際に使う
 * 形状だけを対象とし、fsモジュール全体のoverload型を保持しない。
 */
type NarrowReadFileSync = (
  targetPath: fs.PathOrFileDescriptor,
  encoding: BufferEncoding,
) => string;
type NarrowStatSync = (targetPath: fs.PathLike) => fs.Stats;
interface MutableFsReadSurface {
  readFileSync: NarrowReadFileSync;
  statSync: NarrowStatSync;
}

function callLoaderWithReadSpy(
  world: JevProviderConfigWorld,
): JevProviderConfig | undefined {
  const mutableFs = fs as unknown as MutableFsReadSurface;
  const originalReadFileSync: NarrowReadFileSync = fs.readFileSync;
  const originalStatSync: NarrowStatSync = fs.statSync;
  const readPaths: string[] = [];
  mutableFs.readFileSync = (targetPath, encoding) => {
    readPaths.push(String(targetPath));
    return originalReadFileSync(targetPath, encoding);
  };
  mutableFs.statSync = (targetPath) => {
    readPaths.push(String(targetPath));
    return originalStatSync(targetPath);
  };
  try {
    return loadJevProviderConfig(world.root, world.configPath);
  } finally {
    mutableFs.readFileSync = originalReadFileSync;
    mutableFs.statSync = originalStatSync;
    world.readPaths = readPaths;
  }
}

// --- SCN-UNIT-JEVCFG-001 ---

Given(
  "jev-provider.jsonがenabled trueかつ有効なapiKeyEnvVarで存在する",
  function () {
    this.root = this.temp("asc-jevcfg-001-");
    writeConfig(this.root, {
      enabled: true,
      apiKeyEnvVar: "JEV_API_KEY",
      endpoint: "https://api.jev.example.invalid/v1",
      model: "jev-decision-1",
    });
  },
);

Given("指定したenv varがprocess.envに設定されている", function () {
  setEnvVar(this, "JEV_API_KEY", "test-secret-value-should-not-leak");
});

When("loadJevProviderConfigを実行する", function () {
  this.result = callLoaderWithReadSpy(this);
});

Then("有効なJevProviderConfigが返る", function () {
  assert.deepEqual(this.result, {
    enabled: true,
    apiKeyEnvVar: "JEV_API_KEY",
    endpoint: "https://api.jev.example.invalid/v1",
    model: "jev-decision-1",
  });
});

// --- SCN-UNIT-JEVCFG-002 ---

Given("jev-provider.jsonが存在しない", function () {
  this.root = this.temp("asc-jevcfg-002-");
});

Then("例外を投げずundefinedが返る", function () {
  assert.equal(this.result, undefined);
});

// --- SCN-UNIT-JEVCFG-003 ---

Given("jev-provider.jsonのJSON構文が壊れている", function () {
  this.root = this.temp("asc-jevcfg-003-");
  const resolved = path.join(this.root, JEV_PROVIDER_CONFIG_PATH);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, "{ enabled: true, ");
});

// --- SCN-UNIT-JEVCFG-004 ---

Given("jev-provider.jsonに未知keyが含まれている", function () {
  this.root = this.temp("asc-jevcfg-004-");
  writeConfig(this.root, {
    enabled: true,
    apiKeyEnvVar: "JEV_API_KEY",
    endpoint: "https://api.jev.example.invalid/v1",
    model: "jev-decision-1",
    unexpectedField: "should be rejected",
  });
});

// --- SCN-UNIT-JEVCFG-005 ---

Given("jev-provider.jsonのenabledがfalseまたは欠落している", function () {
  this.root = this.temp("asc-jevcfg-005-");
  writeConfig(this.root, {
    enabled: false,
    apiKeyEnvVar: "JEV_API_KEY",
    endpoint: "https://api.jev.example.invalid/v1",
    model: "jev-decision-1",
  });
});

// --- SCN-UNIT-JEVCFG-006 ---

Given(
  "jev-provider.jsonは有効だが指定env varがprocess.envに設定されていない",
  function () {
    this.root = this.temp("asc-jevcfg-006-");
    // readiness reviewのcodex指摘（round 1最終確認）: previousEnvValueを
    // 削除前に必ず捕捉する。setEnvVar()を経由しない直接deleteだと、
    // 実行環境に同名変数が既に存在した場合にAfter hookが値を復元できない。
    setEnvVar(this, "JEV_API_KEY_UNSET_006", "");
    delete process.env[this.envVarName];
    writeConfig(this.root, {
      enabled: true,
      apiKeyEnvVar: this.envVarName,
      endpoint: "https://api.jev.example.invalid/v1",
      model: "jev-decision-1",
    });
  },
);

// --- SCN-UNIT-JEVCFG-007 ---

Given("env varへ設定したAPIキー値を持つ実行環境がある", function () {
  this.root = this.temp("asc-jevcfg-007-");
  this.secretValue = "sk-test-secret-9f3ce2b1-4a7d-fixed-must-not-leak";
  setEnvVar(this, "JEV_API_KEY", this.secretValue);
  writeConfig(this.root, {
    enabled: true,
    apiKeyEnvVar: "JEV_API_KEY",
    endpoint: "https://api.jev.example.invalid/v1",
    model: "jev-decision-1",
  });
  this.fixtureSnapshotBefore = snapshotLocalDir(this.root);
});

When("loadJevProviderConfigを実行し関連fileを走査する", function () {
  this.result = loadJevProviderConfig(this.root, this.configPath);
  this.fixtureSnapshotAfter = snapshotLocalDir(this.root);
});

Then(
  "APIキー値を含む代入形が.agent-skill-chain\\/local\\/配下のどのfileにも見つからない",
  function () {
    // (a) 戻り値のJSON表現に秘密値が含まれない
    assert.ok(this.result);
    assert.ok(!JSON.stringify(this.result).includes(this.secretValue));

    // (b) loader呼び出し前後でfixture配下のfile内容が1 byteも変化しない
    assert.equal(this.fixtureSnapshotBefore, this.fixtureSnapshotAfter);
    assert.ok(!this.fixtureSnapshotAfter.includes(this.secretValue));

    // (c) 実装ソースに書き込みAPI呼び出しの文字列が存在しない
    const implementationPath = new URL(
      "../../src/domain/jev-provider-config.ts",
      import.meta.url,
    );
    const source = fs.readFileSync(implementationPath, "utf8");
    for (const writeApi of ["writeFile", "appendFile", "fs.write("])
      assert.ok(
        !source.includes(writeApi),
        `実装ソースに書込みAPI(${writeApi})が含まれています`,
      );
  },
);

// --- SCN-UNIT-JEVCFG-008 ---

Given(
  "modelMapping.jsonとproject-policy.jsonが対象repositoryに存在する",
  function () {
    this.root = this.temp("asc-jevcfg-008-");
    writeConfig(this.root, {
      enabled: true,
      apiKeyEnvVar: "JEV_API_KEY",
      endpoint: "https://api.jev.example.invalid/v1",
      model: "jev-decision-1",
    });
    setEnvVar(this, "JEV_API_KEY", "test-secret-value-008");
    const modelMappingPath = path.join(
      this.root,
      ".agent-skill-chain/project/providers/model-mapping.json",
    );
    fs.mkdirSync(path.dirname(modelMappingPath), { recursive: true });
    fs.writeFileSync(
      modelMappingPath,
      JSON.stringify({ roles: { reviewer: { provider: "codex" } } }),
    );
    const projectPolicyPath = path.join(
      this.root,
      ".agent-skill-chain/project-policy.json",
    );
    fs.writeFileSync(
      projectPolicyPath,
      JSON.stringify({ schemaVersion: "fixture", policy: {} }),
    );
  },
);

Then(
  "modelMappingとtrusted project policyの内容は結果に影響せず読み込まれない",
  function () {
    // 実行時挙動: fixtureが存在してもloaderの結果は変わらない
    assert.deepEqual(this.result, {
      enabled: true,
      apiKeyEnvVar: "JEV_API_KEY",
      endpoint: "https://api.jev.example.invalid/v1",
      model: "jev-decision-1",
    });

    // 静的: 実装のimport文（コメントは対象外）にtrusted pathが一切現れない。
    // ソース中のJSDocコメントはmodelMappingへ「触れない」設計を説明するために
    // その語を含むため、コメントを含む全文一致ではなくimport specifierだけを見る。
    const implementationPath = new URL(
      "../../src/domain/jev-provider-config.ts",
      import.meta.url,
    );
    const source = fs.readFileSync(implementationPath, "utf8");
    const importSpecifiers = [
      ...source.matchAll(/^import\b[^;]*from\s+["']([^"']+)["']/gmu),
    ].map((match) => match[1]);
    for (const specifier of importSpecifiers)
      assert.ok(
        !/model-?mapping|project-policy/iu.test(specifier),
        `trusted pathをimportしています: ${specifier}`,
      );

    // 動的: loader呼び出し中に実際にfsへ渡されたpathのいずれもtrusted
    // pathを含まない（readiness reviewのcodex指摘M-02：読み取った結果を
    // 破棄するだけの変異はimport走査だけでは検出できないため、実際の
    // fs呼び出しを計測する）。
    assert.ok(this.readPaths.length > 0, "fs呼び出しが記録されていません");
    for (const readPath of this.readPaths)
      assert.ok(
        !/model-?mapping|project-policy/iu.test(readPath),
        `trusted pathを読み取っています: ${readPath}`,
      );
  },
);

// --- classifyJevProviderConfig（Issue #1485、L-04）--------------------------

When(
  "classifyJevProviderConfigを実行する",
  function (this: JevProviderConfigWorld) {
    this.classification = classifyJevProviderConfig(this.root, this.configPath);
  },
);

Then("分類結果はabsentである", function (this: JevProviderConfigWorld) {
  assert.equal(this.classification?.state, "absent");
});

Then("分類結果はdisabledである", function (this: JevProviderConfigWorld) {
  assert.equal(this.classification?.state, "disabled");
});

Then(
  "分類結果はinvalidであり理由が空でない",
  function (this: JevProviderConfigWorld) {
    assert.equal(this.classification?.state, "invalid");
    assert.ok(
      this.classification?.state === "invalid" &&
        this.classification.reason.length > 0,
    );
  },
);

Then("分類結果はenabledである", function (this: JevProviderConfigWorld) {
  assert.equal(this.classification?.state, "enabled");
});

// --- SCN-UNIT-JEVCFG-014（PR #1497独立review round 4指摘） ------------------

Given(
  "jev-provider.jsonが存在するが読み取り権限が無い",
  function (this: JevProviderConfigWorld) {
    // PR #1497独立review round 4の追加指摘（CodeRabbit）: `chmod 0o000`は
    // root権限で実行されるCI環境ではreadFileSyncを止められず、実行環境に
    // よってSCN-UNIT-JEVCFG-014の結果が不安定になる。既存の
    // `callLoaderWithReadSpy`と同じfs.readFileSyncの一時的な置き換えで、
    // OS権限を一切変更せずに対象pathだけへEACCESを発生させる
    // （`ENOTDIR`はabsentへ分類されるため使わない）。
    this.root = this.temp("asc-jevcfg-014-");
    writeConfig(this.root, {
      enabled: true,
      apiKeyEnvVar: "JEV_API_KEY",
      endpoint: "https://api.jev.example.invalid/v1",
      model: "jev-decision-1",
    });
    const resolved = path.join(this.root, JEV_PROVIDER_CONFIG_PATH);
    const mutableFs = fs as unknown as MutableFsReadSurface;
    const originalReadFileSync: NarrowReadFileSync = fs.readFileSync;
    mutableFs.readFileSync = (targetPath, encoding) => {
      if (path.resolve(String(targetPath)) === path.resolve(resolved)) {
        const error = new Error(
          "EACCES: permission denied",
        ) as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
      return originalReadFileSync(targetPath, encoding);
    };
    this.restoreReadFileSync = () => {
      mutableFs.readFileSync = originalReadFileSync;
    };
  },
);

After<JevProviderConfigWorld>(function () {
  // fs.readFileSyncを差し替えたままにすると後続scenarioへ漏れるため、
  // EACCES fixtureが使ったmonkey patchを必ず元へ戻す。
  this.restoreReadFileSync?.();
});

// --- 独立security review L2 -------------------------------------------------

Given(
  "jev-provider.jsonのapiKeyEnvVarがJEV_で始まらない名前で指定env varも設定されている",
  function (this: JevProviderConfigWorld) {
    this.root = this.temp("asc-jevcfg-015-");
    setEnvVar(this, "GITHUB_TOKEN", "ghp-must-not-be-sent-to-jev");
    writeConfig(this.root, {
      enabled: true,
      apiKeyEnvVar: "GITHUB_TOKEN",
      endpoint: "https://api.jev.example.invalid/v1",
      model: "jev-decision-1",
    });
  },
);

function runFixtureGit(root: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function writeConfigInGitRepository(
  world: JevProviderConfigWorld,
  prefix: string,
  track: boolean,
): void {
  world.root = world.temp(prefix);
  runFixtureGit(world.root, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(
    path.join(world.root, ".gitignore"),
    ".agent-skill-chain/local/\n",
  );
  writeConfig(world.root, {
    enabled: true,
    apiKeyEnvVar: "JEV_API_KEY",
    endpoint: "https://api.jev.example.invalid/v1",
    model: "jev-decision-1",
  });
  if (track)
    runFixtureGit(world.root, ["add", "-f", "--", JEV_PROVIDER_CONFIG_PATH]);
  setEnvVar(world, "JEV_API_KEY", "test-secret-value-should-not-leak");
}

Given(
  "Git repositoryでjev-provider.jsonが強制的に追跡されている",
  function (this: JevProviderConfigWorld) {
    writeConfigInGitRepository(this, "asc-jevcfg-016-", true);
  },
);

Given(
  "Git repositoryでjev-provider.jsonが追跡されずignoreされている",
  function (this: JevProviderConfigWorld) {
    writeConfigInGitRepository(this, "asc-jevcfg-017-", false);
  },
);

When(
  "resolveJevProviderConfigを実行する",
  function (this: JevProviderConfigWorld) {
    this.resolution = resolveJevProviderConfig(this.root);
  },
);

Then(
  "解決結果はGit追跡を理由とするinvalidである",
  function (this: JevProviderConfigWorld) {
    assert.equal(this.resolution?.state, "invalid");
    assert.ok(
      this.resolution?.state === "invalid" &&
        this.resolution.reason.includes("Gitで追跡"),
    );
  },
);

Then("解決結果はenabledである", function (this: JevProviderConfigWorld) {
  assert.equal(this.resolution?.state, "enabled");
});

Given(
  "Git repositoryでjev-provider.jsonが追跡されずindexが壊れている",
  function (this: JevProviderConfigWorld) {
    writeConfigInGitRepository(this, "asc-jevcfg-018-", false);
    fs.writeFileSync(path.join(this.root, ".git", "index"), "garbage");
  },
);

function assertTrackingUnknown(
  resolution: JevProviderConfigWorld["resolution"],
): void {
  assert.equal(resolution?.state, "invalid");
  assert.ok(
    resolution?.state === "invalid" &&
      resolution.reason.includes("Gitで追跡されているかを確認できません"),
    JSON.stringify(resolution),
  );
}

Then(
  "解決結果はGit追跡を確認できないことを理由とするinvalidである",
  function (this: JevProviderConfigWorld) {
    assertTrackingUnknown(this.resolution);
  },
);

Then(
  "gitを実行できない環境でも解決結果はGit追跡を確認できないことを理由とするinvalidである",
  function (this: JevProviderConfigWorld) {
    fs.rmSync(path.join(this.root, ".git"), { recursive: true, force: true });
    runFixtureGit(this.root, ["init", "-q", "-b", "main"]);
    const emptyPath = this.temp("asc-jevcfg-018-nogit-");
    const previousPath = process.env.PATH;
    process.env.PATH = emptyPath;
    try {
      assertTrackingUnknown(resolveJevProviderConfig(this.root));
    } finally {
      process.env.PATH = previousPath;
    }
    /** 同じrepositoryでgitを実行できれば未追跡としてenabledになる */
    assert.equal(resolveJevProviderConfig(this.root).state, "enabled");
  },
);
