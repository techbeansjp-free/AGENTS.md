import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  execFileSync,
  spawnSync,
  type SpawnSyncReturns,
} from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { stepDefinitions, WorkflowWorld } from "../support/world.js";

type CliProcessResult = SpawnSyncReturns<string>;

interface CliRun {
  readonly result: CliProcessResult;
  readonly output?: Record<string, unknown>;
}

interface SemanticGraphCliE2eWorld extends WorkflowWorld {
  bundleRoot?: string;
  cli?: string;
  fixtureRoot?: string;
  preload?: string;
  runs?: Record<string, CliRun>;
  runtimeBefore?: readonly string[];
  runtimeAfter?: readonly string[];
}

const { Given, When, Then } = stepDefinitions<SemanticGraphCliE2eWorld>();

const FIXED_BUILT_AT = "2026-08-30T00:00:00.000Z";
const GRAPH_RUNTIME = ".agent-skill-chain/runtime/graph/v1";
const FIXTURE_EXTENSION = `${GRAPH_RUNTIME}/extensions/vfixture-1.0.0/graphqlite-fixture.so`;
const FIXTURE_POINTER = `${GRAPH_RUNTIME}/current.json`;
const FIXTURE_PROJECTION = `${GRAPH_RUNTIME}/fixture-projection.json`;

function writeFixture(root: string, relative: string, contents: string): void {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, "utf8");
}

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createDagFixture(world: SemanticGraphCliE2eWorld): string {
  const root = world.initRepo();
  git(root, [
    "remote",
    "add",
    "origin",
    "https://example.invalid/semantic-graph-cli-e2e.git",
  ]);
  writeFixture(root, ".gitignore", ".agent-skill-chain/runtime/\n");
  writeFixture(
    root,
    "src/root.ts",
    'import "./right.js";\nimport "./left.js";\nexport const root = true;\n',
  );
  writeFixture(
    root,
    "src/left.ts",
    'import "./target.js";\nexport const left = true;\n',
  );
  writeFixture(
    root,
    "src/right.ts",
    'import "./target.js";\nexport const right = true;\n',
  );
  writeFixture(root, "src/target.ts", "export const target = true;\n");
  writeFixture(
    root,
    "test/features/graph.feature",
    [
      "Feature: graph fixture",
      "",
      "  Scenario: SCN-E2E-GRAPH-FIXTURE-001 deterministic DAG",
      "    Then graph behavior is observable",
      "",
    ].join("\n"),
  );
  writeFixture(
    root,
    "docs/specs/02_要件/00_graph.md",
    [
      "# Graph fixture requirement",
      "",
      "REQ-E2E-GRAPH-001 は決定論的なGraph探索を要求する。",
      "AC-E2E-GRAPH-001 はbuild済みCLIから検証する。",
      "",
    ].join("\n"),
  );
  writeFixture(
    root,
    "docs/specs/15_要件追跡/00_追跡表.md",
    [
      "# Graph fixture trace",
      "",
      "| Requirement | Acceptance | Scenario | Feature | Implementation |",
      "| --- | --- | --- | --- | --- |",
      "| REQ-E2E-GRAPH-001 | AC-E2E-GRAPH-001 | SCN-E2E-GRAPH-FIXTURE-001 | `test/features/graph.feature` | `src/root.ts` |",
      "",
    ].join("\n"),
  );
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "semantic graph CLI E2E fixture"]);
  return root;
}

/**
 * build済みCLIのcommand層を実processで通しつつ、native extensionだけを置換する。
 * このseamが立証するのはCLI routing、process exit、projection lifecycle、freshness、
 * production projectorとproduction graph algorithmである。native asset download、SHA/size、
 * ABI、SQLite load/transactionは立証せず、一回限りのactual verificationへ分離する。
 */
function fixtureAdapterSource(): string {
  return `import fs from "node:fs";
import path from "node:path";
import {
  GraphFreshnessError,
  SEMANTIC_GRAPH_BUILDER_VERSION,
  SEMANTIC_GRAPH_SCHEMA_VERSION,
  semanticGraphContentHash,
} from "../domain/semantic-graph.js";

export const GRAPHQLITE_VERSION = "fixture-1.0.0";
export const GRAPHQLITE_COMMIT = "ffffffffffffffffffffffffffffffffffffffff";
const SHA256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const RUNTIME = ${JSON.stringify(GRAPH_RUNTIME)};
const EXTENSION = ${JSON.stringify(FIXTURE_EXTENSION)};
const POINTER = ${JSON.stringify(FIXTURE_POINTER)};
const PROJECTION = ${JSON.stringify(FIXTURE_PROJECTION)};

function absolute(root, relative) {
  return path.join(fs.realpathSync(root), ...relative.split("/"));
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + ".pending-" + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(value) + "\\n", { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function graphQlLiteAsset() {
  return {
    platform: process.platform,
    arch: process.arch,
    name: "graphqlite-fixture.so",
    url: "fixture://graphqlite",
    sha256: SHA256,
    size: 16,
  };
}

export async function installGraphQlLiteExtension(root, options) {
  const asset = graphQlLiteAsset();
  const target = absolute(root, EXTENSION);
  if (fs.existsSync(target))
    return { status: "present", asset, path: target, backend: "fixture-seam" };
  if (!options.apply)
    return { status: "preview", asset, path: target, backend: "fixture-seam" };
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, "fixture-extension", { flag: "wx", mode: 0o600 });
  return { status: "installed", asset, path: target, backend: "fixture-seam" };
}

export class GraphQlLiteStore {
  constructor(root) {
    this.root = fs.realpathSync(root);
    if (!fs.existsSync(absolute(this.root, EXTENSION)))
      throw new GraphFreshnessError(["missing"], "fixture GraphQLite extension is missing");
  }

  async replace(snapshot, builtAt, observeCurrentSource) {
    const projectionFile = absolute(this.root, PROJECTION);
    let generation = 1;
    if (fs.existsSync(projectionFile)) {
      const previous = JSON.parse(fs.readFileSync(projectionFile, "utf8"));
      generation = previous.manifest.generation + 1;
    }
    const manifest = {
      manifestVersion: "agent-skill-chain/graph-projection-manifest/v1",
      graphSchemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION,
      graphBuilderVersion: SEMANTIC_GRAPH_BUILDER_VERSION,
      extensionVersion: GRAPHQLITE_VERSION,
      extensionSha256: SHA256,
      source: snapshot.source,
      graphContentHash: semanticGraphContentHash(snapshot),
      nodeCount: snapshot.nodes.length,
      edgeCount: snapshot.edges.length,
      generation,
      status: "complete",
      builtAt,
    };
    const currentSource = await observeCurrentSource();
    if (JSON.stringify(currentSource) !== JSON.stringify(snapshot.source))
      throw new GraphFreshnessError(["source-ahead"]);
    writeJsonAtomic(projectionFile, { manifest, snapshot });
    writeJsonAtomic(absolute(this.root, POINTER), {
      schemaVersion: "agent-skill-chain/graphqlite-fixture-current/v1",
      projectionFile: PROJECTION,
    });
    return manifest;
  }

  async read() {
    const pointerFile = absolute(this.root, POINTER);
    if (!fs.existsSync(pointerFile)) throw new GraphFreshnessError(["missing"]);
    let pointer;
    try {
      pointer = JSON.parse(fs.readFileSync(pointerFile, "utf8"));
    } catch {
      throw new GraphFreshnessError(["corrupt"]);
    }
    if (
      pointer?.schemaVersion !== "agent-skill-chain/graphqlite-fixture-current/v1" ||
      pointer?.projectionFile !== PROJECTION ||
      Object.keys(pointer).length !== 2
    ) throw new GraphFreshnessError(["corrupt"]);
    let stored;
    try {
      stored = JSON.parse(fs.readFileSync(absolute(this.root, pointer.projectionFile), "utf8"));
    } catch {
      throw new GraphFreshnessError(["corrupt"]);
    }
    if (!stored?.manifest || !stored?.snapshot || Object.keys(stored).length !== 2)
      throw new GraphFreshnessError(["corrupt"]);
    return stored;
  }

  async close() {}
}
`;
}

function prepareBuiltCliCopy(world: SemanticGraphCliE2eWorld): void {
  const sourceDist = path.resolve("dist");
  assert.ok(
    fs.existsSync(path.join(sourceDist, "bin/agent-skill-chain.js")),
    "先にnpm run compileでbuild済みCLIを生成してください",
  );
  const bundleRoot = world.temp("asc-graph-cli-bundle-");
  fs.cpSync(sourceDist, path.join(bundleRoot, "dist"), { recursive: true });
  fs.writeFileSync(
    path.join(bundleRoot, "package.json"),
    `${JSON.stringify({
      name: "agent-skill-chain-graph-cli-e2e-fixture",
      version: "0.3.0",
      type: "module",
      agentSkillChain: {
        qualityContractVersion: 8,
        policySchemaVersion: "0.3.1",
        compatiblePolicySchemaVersions: ["0.3.0"],
        deprecatedPolicySchemaAliases: { "0.3": "0.3.0" },
      },
    })}\n`,
    "utf8",
  );
  fs.cpSync(
    path.resolve(".agent-skill-chain"),
    path.join(bundleRoot, ".agent-skill-chain"),
    { recursive: true },
  );
  const dependencyLink = path.join(bundleRoot, "node_modules");
  fs.symlinkSync(
    path.resolve("node_modules"),
    dependencyLink,
    process.platform === "win32" ? "junction" : "dir",
  );
  fs.writeFileSync(
    path.join(bundleRoot, "dist/src/adapters/graphqlite.js"),
    fixtureAdapterSource(),
    "utf8",
  );
  const preload = path.join(bundleRoot, "process-seam.mjs");
  fs.writeFileSync(
    preload,
    [
      "const requested = process.env.ASC_E2E_NODE_VERSION;",
      "if (requested) Object.defineProperty(process.versions, 'node', { value: requested, configurable: true });",
      "Object.defineProperty(globalThis, 'fetch', {",
      "  configurable: true,",
      "  value: async () => { throw new Error('semantic graph E2Eではexternal networkを使用できません'); },",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );
  world.bundleRoot = bundleRoot;
  world.cli = path.join(bundleRoot, "dist/bin/agent-skill-chain.js");
  world.preload = preload;
}

function parseOutput(
  result: CliProcessResult,
): Record<string, unknown> | undefined {
  const output = result.stdout.trim();
  if (output === "") return undefined;
  return JSON.parse(output) as Record<string, unknown>;
}

function runCli(
  world: SemanticGraphCliE2eWorld,
  label: string,
  args: readonly string[],
  nodeVersion?: string,
): CliRun {
  assert.ok(world.cli);
  assert.ok(world.preload);
  assert.ok(world.fixtureRoot);
  const result = spawnSync(
    process.execPath,
    ["--import", world.preload, world.cli, ...args],
    {
      cwd: world.fixtureRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ...(nodeVersion === undefined
          ? {}
          : { ASC_E2E_NODE_VERSION: nodeVersion }),
      },
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000,
    },
  );
  const run = { result, output: parseOutput(result) };
  world.runs ??= {};
  world.runs[label] = run;
  return run;
}

function requireRun(world: SemanticGraphCliE2eWorld, label: string): CliRun {
  const run = world.runs?.[label];
  assert.ok(run, `${label} process resultがありません`);
  return run;
}

function assertGraphCannotAuthorize(
  output: Record<string, unknown> | undefined,
): void {
  assert.equal(output?.authority, "none");
  assert.equal(output?.mergeAuthorization, false);
  assert.equal(output?.modeAuthorization, false);
}

function runtimeFiles(root: string): readonly string[] {
  const runtime = path.join(root, ...GRAPH_RUNTIME.split("/"));
  if (!fs.existsSync(runtime)) return [];
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        const contents = fs.readFileSync(absolute);
        files.push(
          `${path.relative(runtime, absolute).split(path.sep).join("/")}:${contents.length}:${crypto.createHash("sha256").update(contents).digest("hex")}`,
        );
      } else files.push(`unsupported:${entry.name}`);
    }
  };
  visit(runtime);
  return files.sort();
}

function graphArgs(root: string, command: string, ...rest: string[]): string[] {
  return ["graph", command, `--root=${root}`, ...rest];
}

function installFixture(world: SemanticGraphCliE2eWorld): void {
  assert.ok(world.fixtureRoot);
  const run = runCli(
    world,
    "install-apply",
    graphArgs(world.fixtureRoot, "install", "--apply"),
  );
  assert.equal(
    run.result.status,
    0,
    `${run.result.stdout}\n${run.result.stderr}`,
  );
}

function rebuildFixture(world: SemanticGraphCliE2eWorld): void {
  assert.ok(world.fixtureRoot);
  installFixture(world);
  const run = runCli(
    world,
    "rebuild-apply",
    graphArgs(
      world.fixtureRoot,
      "rebuild",
      "--apply",
      `--built-at=${FIXED_BUILT_AT}`,
    ),
  );
  assert.equal(
    run.result.status,
    0,
    `${run.result.stdout}\n${run.result.stderr}`,
  );
}

Given("build済みGraph CLIの隔離copyと自己完結DAG fixtureがある", function () {
  this.fixtureRoot = createDagFixture(this);
  this.runs = {};
  prepareBuiltCliCopy(this);
});

Given("fixture Graph runtimeは未作成である", function () {
  assert.ok(this.fixtureRoot);
  assert.deepEqual(runtimeFiles(this.fixtureRoot), []);
});

When("graph installを実processでpreviewする", function () {
  assert.ok(this.fixtureRoot);
  this.runtimeBefore = runtimeFiles(this.fixtureRoot);
  runCli(
    this,
    "install-preview",
    graphArgs(this.fixtureRoot, "install", "--dry-run"),
  );
  this.runtimeAfter = runtimeFiles(this.fixtureRoot);
});

Then("install previewは成功しruntimeを変更しない", function () {
  const run = requireRun(this, "install-preview");
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.output?.status, "preview");
  assertGraphCannotAuthorize(run.output);
  assert.equal(run.output?.backend, "fixture-seam");
  assert.deepEqual(this.runtimeAfter, this.runtimeBefore);
  assert.deepEqual(this.runtimeAfter, []);
});

When("fixture seamのgraph installを実processでapplyする", function () {
  assert.ok(this.fixtureRoot);
  this.runtimeBefore = runtimeFiles(this.fixtureRoot);
  runCli(
    this,
    "install-apply",
    graphArgs(this.fixtureRoot, "install", "--apply"),
  );
  this.runtimeAfter = runtimeFiles(this.fixtureRoot);
});

Then("install applyだけが固定extension markerを作る", function () {
  const run = requireRun(this, "install-apply");
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.output?.status, "installed");
  assertGraphCannotAuthorize(run.output);
  assert.equal(run.output?.backend, "fixture-seam");
  assert.deepEqual(this.runtimeBefore, []);
  assert.equal(this.runtimeAfter?.length, 1);
  assert.match(
    this.runtimeAfter?.[0] ?? "",
    /extensions\/vfixture-1\.0\.0\/graphqlite-fixture\.so/u,
  );
});

Given("fixture extensionを実processでinstall済みである", function () {
  installFixture(this);
});

When("graph rebuildを実processでpreviewする", function () {
  assert.ok(this.fixtureRoot);
  this.runtimeBefore = runtimeFiles(this.fixtureRoot);
  runCli(
    this,
    "rebuild-preview",
    graphArgs(this.fixtureRoot, "rebuild", "--dry-run"),
  );
  this.runtimeAfter = runtimeFiles(this.fixtureRoot);
});

Then("rebuild previewは投影を書き込まない", function () {
  const run = requireRun(this, "rebuild-preview");
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.output?.status, "preview");
  assertGraphCannotAuthorize(run.output);
  assert.ok(Number(run.output?.nodeCount) > 0);
  assert.ok(Number(run.output?.edgeCount) > 0);
  assert.match(String(run.output?.graphContentHash), /^[a-f0-9]{64}$/u);
  assert.deepEqual(this.runtimeAfter, this.runtimeBefore);
  assert.equal(
    this.runtimeAfter?.some((entry) => entry.startsWith("current.json:")),
    false,
  );
});

When("graph rebuildを実processでapplyする", function () {
  assert.ok(this.fixtureRoot);
  this.runtimeBefore = runtimeFiles(this.fixtureRoot);
  runCli(
    this,
    "rebuild-apply",
    graphArgs(
      this.fixtureRoot,
      "rebuild",
      "--apply",
      `--built-at=${FIXED_BUILT_AT}`,
    ),
  );
  this.runtimeAfter = runtimeFiles(this.fixtureRoot);
});

Then("rebuild applyはfreshな投影を公開する", function () {
  const run = requireRun(this, "rebuild-apply");
  assert.equal(
    run.result.status,
    0,
    `${run.result.stdout}\n${run.result.stderr}`,
  );
  assert.equal(run.output?.status, "rebuilt");
  assertGraphCannotAuthorize(run.output);
  const manifest = run.output?.manifest as Record<string, unknown> | undefined;
  assert.equal(manifest?.status, "complete");
  assert.equal(manifest?.builtAt, FIXED_BUILT_AT);
  assert.match(String(manifest?.graphContentHash), /^[a-f0-9]{64}$/u);
  assert.equal(
    this.runtimeAfter?.some((entry) => entry.startsWith("current.json:")),
    true,
  );
  assert.equal(
    this.runtimeAfter?.some((entry) =>
      entry.startsWith("fixture-projection.json:"),
    ),
    true,
  );
});

When("graph statusを実processで実行する", function () {
  assert.ok(this.fixtureRoot);
  runCli(this, "status", graphArgs(this.fixtureRoot, "status"));
});

Then("statusはfreshかつexact Evidence可能である", function () {
  const run = requireRun(this, "status");
  assert.equal(
    run.result.status,
    0,
    `${run.result.stdout}\n${run.result.stderr}`,
  );
  assert.equal(run.output?.status, "fresh");
  assertGraphCannotAuthorize(run.output);
  assert.equal(run.output?.exactEvidenceAllowed, true);
});

When("graph impact、path、orderを実processで実行する", function () {
  assert.ok(this.fixtureRoot);
  runCli(
    this,
    "impact",
    graphArgs(
      this.fixtureRoot,
      "impact",
      "--start=file:src/root.ts",
      "--direction=outgoing",
      "--edge-kinds=imports",
    ),
  );
  runCli(
    this,
    "path",
    graphArgs(
      this.fixtureRoot,
      "path",
      "--from=file:src/root.ts",
      "--to=file:src/target.ts",
      "--edge-kinds=imports",
    ),
  );
  runCli(
    this,
    "order",
    graphArgs(this.fixtureRoot, "order", "--edge-kinds=imports"),
  );
});

Then(
  "BFS影響範囲、最短path、topological orderはexact Evidenceになる",
  function () {
    const impact = requireRun(this, "impact");
    assert.equal(impact.result.status, 0, impact.result.stderr);
    assert.equal(impact.output?.status, "complete");
    assertGraphCannotAuthorize(impact.output);
    assert.equal(impact.output?.exactEvidence, true);
    assert.deepEqual(impact.output?.nodes, [
      "file:src/root.ts",
      "file:src/left.ts",
      "file:src/right.ts",
      "file:src/target.ts",
    ]);

    const pathRun = requireRun(this, "path");
    assert.equal(pathRun.result.status, 0, pathRun.result.stderr);
    assert.equal(pathRun.output?.status, "complete");
    assertGraphCannotAuthorize(pathRun.output);
    assert.equal(pathRun.output?.algorithm, "bfs");
    assert.equal(pathRun.output?.exactEvidence, true);
    assert.deepEqual(pathRun.output?.path, [
      "file:src/root.ts",
      "file:src/left.ts",
      "file:src/target.ts",
    ]);

    const order = requireRun(this, "order");
    assert.equal(order.result.status, 0, order.result.stderr);
    assert.equal(order.output?.status, "complete");
    assertGraphCannotAuthorize(order.output);
    assert.equal(order.output?.gateConformant, true);
    assert.equal(order.output?.exactEvidence, true);
    assert.equal(order.output?.gatePass, true);
    const nodes = order.output?.order as string[];
    assert.ok(
      nodes.indexOf("file:src/root.ts") < nodes.indexOf("file:src/left.ts"),
    );
    assert.ok(
      nodes.indexOf("file:src/left.ts") < nodes.indexOf("file:src/target.ts"),
    );
    assert.ok(
      nodes.indexOf("file:src/right.ts") < nodes.indexOf("file:src/target.ts"),
    );
  },
);

When("missing状態でgraph statusを実processで実行する", function () {
  assert.ok(this.fixtureRoot);
  runCli(this, "status-missing", graphArgs(this.fixtureRoot, "status"));
});

Then("statusはmissingを非0で返しruntimeを作らない", function () {
  assert.ok(this.fixtureRoot);
  const run = requireRun(this, "status-missing");
  assert.equal(
    run.result.status,
    1,
    `${run.result.stdout}\n${run.result.stderr}`,
  );
  assert.equal(run.output?.status, "unavailable-or-stale");
  assertGraphCannotAuthorize(run.output);
  assert.equal(run.output?.exactEvidenceAllowed, false);
  assert.match(JSON.stringify(run.output?.reasons), /missing/u);
  assert.deepEqual(runtimeFiles(this.fixtureRoot), []);
});

When(
  "extension未installのままgraph rebuildを実processでapplyする",
  function () {
    assert.ok(this.fixtureRoot);
    runCli(
      this,
      "rebuild-missing-extension",
      graphArgs(
        this.fixtureRoot,
        "rebuild",
        "--apply",
        `--built-at=${FIXED_BUILT_AT}`,
      ),
    );
  },
);

Then("rebuildもmissingを型付きで返し権限を付与しない", function () {
  assert.ok(this.fixtureRoot);
  const run = requireRun(this, "rebuild-missing-extension");
  assert.equal(run.result.status, 1, run.result.stderr);
  assert.equal(run.output?.status, "unavailable-or-stale");
  assert.deepEqual(run.output?.reasons, ["missing"]);
  assert.equal(run.output?.recovery, "rebuild");
  assertGraphCannotAuthorize(run.output);
  assert.deepEqual(runtimeFiles(this.fixtureRoot), []);
});

Given("fixture graph投影を実processで構築済みである", function () {
  rebuildFixture(this);
});

When("current pointerを破損してgraph statusを実processで実行する", function () {
  assert.ok(this.fixtureRoot);
  fs.writeFileSync(
    path.join(this.fixtureRoot, ...FIXTURE_POINTER.split("/")),
    "{broken\n",
    "utf8",
  );
  runCli(this, "status-corrupt", graphArgs(this.fixtureRoot, "status"));
});

Then("statusはcorruptを非0で返しexact Evidenceを拒否する", function () {
  const run = requireRun(this, "status-corrupt");
  assert.equal(
    run.result.status,
    1,
    `${run.result.stdout}\n${run.result.stderr}`,
  );
  assert.equal(run.output?.status, "unavailable-or-stale");
  assertGraphCannotAuthorize(run.output);
  assert.equal(run.output?.exactEvidenceAllowed, false);
  assert.match(JSON.stringify(run.output?.reasons), /corrupt/u);
});

When("tracked sourceを変更してgraph statusを実processで実行する", function () {
  assert.ok(this.fixtureRoot);
  fs.appendFileSync(
    path.join(this.fixtureRoot, "src/root.ts"),
    "export const changedAfterProjection = true;\n",
    "utf8",
  );
  runCli(this, "status-stale", graphArgs(this.fixtureRoot, "status"));
});

Then("statusはstaleを非0で返しrebuildを要求する", function () {
  const run = requireRun(this, "status-stale");
  assert.equal(
    run.result.status,
    1,
    `${run.result.stdout}\n${run.result.stderr}`,
  );
  assert.equal(run.output?.status, "unavailable-or-stale");
  assertGraphCannotAuthorize(run.output);
  assert.equal(run.output?.exactEvidenceAllowed, false);
  assert.match(
    JSON.stringify(run.output?.reasons),
    /source-ahead|projection-drift/u,
  );
  assert.equal(run.output?.recovery, "rebuild");
  assert.match(String(run.output?.next), /graph install.*graph rebuild/u);
});

When("Node 22.12.0 process seamでgraph install previewを実行する", function () {
  assert.ok(this.fixtureRoot);
  runCli(
    this,
    "node-22.12",
    graphArgs(this.fixtureRoot, "install", "--dry-run"),
    "22.12.0",
  );
});

When("Node 22.13.0 process seamでgraph install previewを実行する", function () {
  assert.ok(this.fixtureRoot);
  runCli(
    this,
    "node-22.13",
    graphArgs(this.fixtureRoot, "install", "--dry-run"),
    "22.13.0",
  );
});

Then("22.12は拒否され22.13は許可されてruntimeは作られない", function () {
  assert.ok(this.fixtureRoot);
  const rejected = requireRun(this, "node-22.12");
  assert.equal(
    rejected.result.status,
    1,
    `${rejected.result.stdout}\n${rejected.result.stderr}`,
  );
  assert.match(
    `${rejected.result.stdout}\n${rejected.result.stderr}`,
    /Node\.js 22\.13\.0以上/u,
  );
  const accepted = requireRun(this, "node-22.13");
  assert.equal(
    accepted.result.status,
    0,
    `${accepted.result.stdout}\n${accepted.result.stderr}`,
  );
  assert.equal(accepted.output?.status, "preview");
  assert.deepEqual(runtimeFiles(this.fixtureRoot), []);
});

When("未知nodeと未知edge kindでgraph探索を実process実行する", function () {
  assert.ok(this.fixtureRoot);
  runCli(
    this,
    "impact-invalid",
    graphArgs(
      this.fixtureRoot,
      "impact",
      "--start=file:src/missing.ts",
      "--direction=outgoing",
      "--edge-kinds=imports",
    ),
  );
  runCli(
    this,
    "path-invalid",
    graphArgs(
      this.fixtureRoot,
      "path",
      "--from=file:src/root.ts",
      "--to=file:src/missing.ts",
      "--edge-kinds=imports",
    ),
  );
  runCli(
    this,
    "order-invalid",
    graphArgs(this.fixtureRoot, "order", "--edge-kinds=unknown"),
  );
});

Then("impact、path、orderはすべて非0でexact Evidenceにならない", function () {
  for (const label of ["impact-invalid", "path-invalid"] as const) {
    const run = requireRun(this, label);
    assert.equal(
      run.result.status,
      1,
      `${run.result.stdout}\n${run.result.stderr}`,
    );
    assert.equal(run.output?.status, "invalid");
    assert.equal(run.output?.exactEvidence, false);
    assert.match(JSON.stringify(run.output?.reasons), /nodeが存在しません/u);
  }
  const order = requireRun(this, "order-invalid");
  assert.equal(
    order.result.status,
    1,
    `${order.result.stdout}\n${order.result.stderr}`,
  );
  assert.match(
    `${order.result.stdout}\n${order.result.stderr}`,
    /未知のsemantic edge kind/u,
  );
});

When(
  "保存manifestのextension identityを改竄してgraph statusを実process実行する",
  function () {
    assert.ok(this.fixtureRoot);
    const projection = path.join(
      this.fixtureRoot,
      ...FIXTURE_PROJECTION.split("/"),
    );
    const stored = JSON.parse(fs.readFileSync(projection, "utf8")) as {
      manifest: Record<string, unknown>;
    };
    stored.manifest.extensionVersion = "tampered-extension";
    fs.writeFileSync(projection, `${JSON.stringify(stored)}\n`, "utf8");
    runCli(
      this,
      "status-extension-mismatch",
      graphArgs(this.fixtureRoot, "status"),
    );
  },
);

Then("statusはextension-mismatchだけを安定したreasonで返す", function () {
  const run = requireRun(this, "status-extension-mismatch");
  assert.equal(run.result.status, 1, run.result.stderr);
  assert.equal(run.output?.status, "unavailable-or-stale");
  assert.deepEqual(run.output?.reasons, ["extension-mismatch"]);
  assert.equal(run.output?.recovery, "rebuild");
  assert.equal(run.output?.authority, "none");
  assert.equal(run.output?.mergeAuthorization, false);
  assert.equal(run.output?.modeAuthorization, false);
});

When("include-inferred付きimpactを実processで実行する", function () {
  assert.ok(this.fixtureRoot);
  runCli(
    this,
    "impact-inferred",
    graphArgs(
      this.fixtureRoot,
      "impact",
      "--start=file:src/root.ts",
      "--direction=outgoing",
      "--edge-kinds=imports",
      "--include-inferred",
    ),
  );
});

Then(
  "completeでもcandidateでありexact Evidenceとmerge authorityを持たない",
  function () {
    const run = requireRun(this, "impact-inferred");
    assert.equal(run.result.status, 0, run.result.stderr);
    assert.equal(run.output?.status, "complete");
    assert.equal(run.output?.candidate, true);
    assert.equal(run.output?.exactEvidence, false);
    assert.equal(run.output?.authority, "none");
    assert.equal(run.output?.mergeAuthorization, false);
    assert.equal(run.output?.modeAuthorization, false);
    const evidence = run.output?.evidence as
      Record<string, unknown> | undefined;
    assert.equal(evidence?.candidate, true);
    assert.equal(evidence?.deterministicOnly, false);
    assert.equal(evidence?.exactEvidence, false);
    assert.equal(evidence?.authority, "none");
    assert.equal(evidence?.mergeAuthorization, false);
    assert.equal(evidence?.modeAuthorization, false);
    assert.deepEqual(
      (evidence?.query as Record<string, unknown> | undefined)?.certaintyPolicy,
      "include-inferred",
    );
  },
);

When(
  "current pointer破損後に値付きinclude-inferredを実processで実行する",
  function () {
    assert.ok(this.fixtureRoot);
    fs.writeFileSync(
      path.join(this.fixtureRoot, ...FIXTURE_POINTER.split("/")),
      "{broken\n",
      "utf8",
    );
    runCli(
      this,
      "impact-inferred-invalid",
      graphArgs(
        this.fixtureRoot,
        "impact",
        "--start=file:src/root.ts",
        "--include-inferred=false",
      ),
    );
  },
);

Then("値付きflagはGraph読取前に入力違反として拒否される", function () {
  const run = requireRun(this, "impact-inferred-invalid");
  assert.equal(run.result.status, 1, run.result.stderr);
  const observed = `${run.result.stdout}\n${run.result.stderr}`;
  assert.match(observed, /--include-inferredは値を取らないflag/u);
  assert.doesNotMatch(observed, /corrupt|missing|extension-mismatch/u);
});
