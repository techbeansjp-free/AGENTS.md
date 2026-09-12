import { tierProvenance } from "../../src/cli.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { WorkflowWorld, stepDefinitions } from "../support/world.js";
import { git } from "../../src/lib/process.js";
import { isRecord } from "../../src/types.js";

interface TierProvenanceWorld extends WorkflowWorld {
  tierRoot: string;
  results: Array<{ label: string; result: SpawnSyncReturns<string> }>;
  provenanceSources: string[];
  provenanceMapped: Array<{ source: string; ref: string }>;
}

const { Given, When, Then } = stepDefinitions<TierProvenanceWorld>();
const cli = path.resolve("dist/bin/agent-skill-chain.js");

/** trusted refを持つ隔離repository。既定branchのpolicyだけをcommitする */
function trustedRoot(world: TierProvenanceWorld): string {
  const root = world.initRepo();
  const namespace = path.join(root, ".agent-skill-chain");
  fs.mkdirSync(namespace);
  for (const relative of ["project", "policy"])
    fs.cpSync(
      path.resolve(".agent-skill-chain", relative),
      path.join(namespace, relative),
      { recursive: true },
    );
  fs.copyFileSync(
    path.resolve(".agent-skill-chain/project-policy.json"),
    path.join(namespace, "project-policy.json"),
  );
  git(["add", ".agent-skill-chain"], root);
  git(["commit", "-q", "-m", "trusted fixture", "--allow-empty"], root);
  git(["update-ref", "refs/remotes/origin/main", "HEAD"], root);
  git(
    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    root,
  );
  return root;
}

function tier(root: string, extra: string[]): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    [
      cli,
      "routing",
      "tier",
      `--root=${root}`,
      "--risk=path",
      "--mode=full",
      "--scope=issue-1350",
      "--selected=critical",
      ...extra,
    ],
    { cwd: root, encoding: "utf8" },
  );
}

function output(result: SpawnSyncReturns<string>): Record<string, unknown> {
  const parsed: unknown = JSON.parse(result.stdout);
  assert.ok(isRecord(parsed), result.stdout);
  return parsed;
}

function diagnosticOf(
  result: SpawnSyncReturns<string>,
): Record<string, unknown> {
  const parsed = output(result);
  const inner = isRecord(parsed.result) ? parsed.result : parsed;
  const diagnostic = isRecord(inner.diagnostic) ? inner.diagnostic : undefined;
  assert.ok(diagnostic, result.stdout);
  return diagnostic;
}

Given("trusted policyを持つ隔離repositoryがある", function () {
  this.tierRoot = trustedRoot(this);
});

Given(
  "trusted policyを持つ隔離repositoryのworking treeへtierMappingのkeyを未commitで足す",
  function () {
    this.tierRoot = trustedRoot(this);
    const choice = path.join(
      this.tierRoot,
      ".agent-skill-chain/project/choices/development.json",
    );
    const document = JSON.parse(fs.readFileSync(choice, "utf8")) as {
      modelMapping: { tierMapping: Record<string, string> };
    };
    document.modelMapping.tierMapping["candidate-only-model"] = "critical";
    fs.writeFileSync(choice, `${JSON.stringify(document, null, 2)}\n`);
    // 既定branchには存在しない。trustedと誤読させないことがこのscenarioの対象である
    assert.match(
      git(["status", "--porcelain"], this.tierRoot).stdout,
      /development\.json/u,
    );
  },
);

When("routing tierをcodex以外のprovider値で実行する", function () {
  this.results = ["claude", "CODEX", "", "codex-preview"].map((provider) => ({
    label: provider === "" ? "(空)" : provider,
    result: tier(this.tierRoot, [
      "--model=claude-opus-5",
      `--provider=${provider}`,
    ]),
  }));
});

When("routing tierをprovider未指定で実行する", function () {
  this.results = [
    {
      label: "unspecified",
      result: tier(this.tierRoot, ["--model=candidate-only-model"]),
    },
  ];
});

When("routing tierを未定義のmodelでprovider未指定で実行する", function () {
  this.results = [
    {
      label: "undefined-model",
      result: tier(this.tierRoot, ["--model=absent-model"]),
    },
  ];
});

Then("すべてcodexだけを受理する案内つきで拒否される", function () {
  for (const { label, result } of this.results) {
    assert.equal(result.status, 1, `${label}: ${result.stdout}`);
    const reasons = diagnosticOf(result).reasons;
    assert.ok(Array.isArray(reasons), result.stdout);
    assert.equal(
      reasons.filter(
        (reason) =>
          typeof reason === "string" &&
          reason.includes("--providerはcodexだけを受理します") &&
          reason.includes("互換検証"),
      ).length,
      1,
      `${label}: ${reasons.join("; ")}`,
    );
  }
});

Then(
  "成功出力はfilesystemの信頼源とcompatibility-onlyの用途を含む",
  function () {
    const [entry] = this.results;
    assert.equal(entry?.result.status, 0, entry?.result.stdout);
    const parsed = output(entry!.result);
    assert.equal(parsed.valid, true);
    assert.deepEqual(parsed.provenance, {
      source: "filesystem",
      ref: ".agent-skill-chain/project-policy.json",
    });
    assert.equal(parsed.usage, "compatibility-only");
  },
);

Then(
  "失敗出力は信頼源を含みtrustedの語が無く必要authorityは不要である",
  function () {
    const [entry] = this.results;
    assert.equal(entry?.result.status, 1, entry?.result.stdout);
    const parsed = output(entry!.result);
    assert.deepEqual(parsed.provenance, {
      source: "filesystem",
      ref: ".agent-skill-chain/project-policy.json",
    });
    assert.equal(parsed.usage, "compatibility-only");
    const diagnostic = diagnosticOf(entry!.result);
    assert.equal(diagnostic.requiredAuthority, "不要");
    assert.match(String(diagnostic.next), /working tree/u);
    assert.doesNotMatch(String(diagnostic.next), /trusted/u);
    assert.doesNotMatch(entry!.result.stdout, /trusted project choice/u);
  },
);

/**
 * **loaderの語彙は`src/domain/policy.ts`が唯一の発生源である。** ここへ書くのは
 * その実測値であり、`tierProvenance`の実装から導出しない（Issue #1350のREV-02）。
 * 実装から期待値を作ると、特定の値だけを読み替える変異で期待値も同じ向きへずれる。
 */
const LOADER_SOURCES = [
  "filesystem",
  "filesystem-legacy",
  "git",
  "git-legacy",
  "git-floor",
] as const;

Given("policy loaderが返しうる信頼源の語彙を5件すべて用意する", function () {
  this.provenanceSources = [...LOADER_SOURCES];
});

When("それぞれを出力用の信頼源へ写す", function () {
  this.provenanceMapped = this.provenanceSources.map((source) =>
    tierProvenance({ source, commitSha: "a".repeat(40) }),
  );
});

Then("どの語彙も読み替えられずそのまま現れる", function () {
  assert.equal(this.provenanceMapped.length, LOADER_SOURCES.length);
  assert.deepEqual(
    this.provenanceMapped.map((entry) => entry.source),
    [...LOADER_SOURCES],
  );
});
