import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  GRAPHQLITE_VERSION,
  GraphQlLiteStore,
  graphQlLiteAsset,
  installGraphQlLiteExtension,
  type GraphQlLiteAsset,
} from "../../src/adapters/graphqlite.js";
import {
  buildRepositorySemanticGraph,
  observeRepositoryGraphSource,
} from "../../src/adapters/repository-graph.js";
import {
  assessGraphFreshness,
  semanticGraphContentHash,
  shortestSemanticPath,
  topologicalSemanticOrder,
  traverseSemanticGraph,
  type GraphFreshnessResult,
  type GraphProjectionManifest,
  type GraphStoreReadResult,
  type GraphTraversalResult,
  type SemanticGraphSnapshot,
  type ShortestPathResult,
  type TopologicalResult,
} from "../../src/domain/semantic-graph.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

const ACTUAL_EXTENSION_ENV = "ASC_GRAPHQLITE_TEST_EXTENSION";
const GRAPH_RUNTIME = ".agent-skill-chain/runtime/graph/v1";
const FIXED_REMOTE = "https://example.invalid/asc-runtime-evidence.git";
const FIRST_BUILT_AT = "2026-08-30T01:00:00.000Z";
const SECOND_BUILT_AT = "2026-08-30T01:00:01.000Z";
const MODULE_COUNT = 24;
const APP_NODE = "file:src/app.ts";
const TARGET_NODE = "file:src/shared/result.ts";

interface NativeAssetMetadata {
  readonly nodeVersion: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly extensionVersion: string;
  readonly assetName: string;
  readonly assetSize: number;
  readonly assetSha256: string;
  readonly injectedAssetRealpath: string;
}

interface RuntimeFileEvidence {
  readonly path: string;
  readonly byteLength?: number;
  readonly bytesBase64?: string;
  readonly sha256?: string;
  readonly symlinkTarget?: string;
}

interface RuntimeIdentity {
  readonly runtimeRealpath: string;
  readonly runtimeDevice: number;
  readonly runtimeInode: number;
  readonly databaseRealpath: string;
  readonly databaseDevice: number;
  readonly databaseInode: number;
}

interface NormalizedQueryEvidence {
  readonly status: {
    readonly freshness: GraphFreshnessResult;
    readonly graphSchemaVersion: string;
    readonly graphBuilderVersion: string;
    readonly extensionVersion: string;
    readonly extensionSha256: string;
    readonly graphContentHash: string;
    readonly nodeCount: number;
    readonly edgeCount: number;
  };
  readonly impact: GraphTraversalResult;
  readonly path: ShortestPathResult;
  readonly order: TopologicalResult;
}

interface ProjectionObservation {
  readonly manifest: GraphProjectionManifest;
  readonly readBack: GraphStoreReadResult;
  readonly normalized: NormalizedQueryEvidence;
  readonly durationNanoseconds: bigint;
}

interface WorktreeObservation {
  readonly primaryRoot: string;
  readonly secondaryRoot: string;
  readonly primaryInitial: ProjectionObservation;
  readonly secondaryInitial: ProjectionObservation;
  readonly primaryAfterMutation: ProjectionObservation;
  readonly secondaryAfterMutation: NormalizedQueryEvidence;
  readonly primaryRuntime: RuntimeIdentity;
  readonly secondaryRuntime: RuntimeIdentity;
  readonly secondaryRuntimeBefore: readonly RuntimeFileEvidence[];
  readonly secondaryRuntimeAfter: readonly RuntimeFileEvidence[];
}

interface RepeatabilityObservation {
  readonly root: string;
  readonly first: ProjectionObservation;
  readonly second: ProjectionObservation;
}

interface SemanticGraphRuntimeEvidenceWorld extends WorkflowWorld {
  asset?: GraphQlLiteAsset;
  assetBytes?: Buffer;
  assetMetadata?: NativeAssetMetadata;
  fixtureRoot?: string;
  repeatability?: RepeatabilityObservation;
  secondaryRoot?: string;
  worktrees?: WorktreeObservation;
}

const { Given, When, Then } =
  stepDefinitions<SemanticGraphRuntimeEvidenceWorld>();

function sha256(contents: string | Buffer): string {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function git(root: string, arguments_: readonly string[]): string {
  return execFileSync("git", arguments_, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function write(root: string, relative: string, contents: string): void {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, contents, "utf8");
}

function nextSeed(state: { value: number }): number {
  state.value = (Math.imul(state.value, 1_664_525) + 1_013_904_223) >>> 0;
  return state.value;
}

function moduleName(index: number): string {
  return `module-${String(index).padStart(2, "0")}`;
}

function seededModuleSource(index: number, state: { value: number }): string {
  if (index === MODULE_COUNT - 1)
    return [
      'import { result } from "../shared/result.js";',
      `export const ${moduleName(index).replace("-", "_")} = result + ${String(index)};`,
      "",
    ].join("\n");
  const targets = new Set([index + 1]);
  const remaining = MODULE_COUNT - index - 1;
  for (let candidateIndex = 0; candidateIndex < 2; candidateIndex += 1)
    targets.add(index + 1 + (nextSeed(state) % remaining));
  const imports = [...targets]
    .sort((left, right) => left - right)
    .map(
      (target) =>
        `import { ${moduleName(target).replace("-", "_")} } from "./${moduleName(target)}.js";`,
    );
  return [
    ...imports,
    `export const ${moduleName(index).replace("-", "_")} = ${[...targets]
      .sort((left, right) => left - right)
      .map((target) => moduleName(target).replace("-", "_"))
      .join(" + ")} + ${String(index)};`,
    "",
  ].join("\n");
}

function populateSeededRepository(root: string): void {
  const seed = { value: 0x5eedc0de };
  git(root, ["remote", "add", "origin", FIXED_REMOTE]);
  write(root, ".gitignore", ".agent-skill-chain/runtime/\n");
  write(
    root,
    "src/app.ts",
    'import { module_00 } from "./modules/module-00.js";\nexport const app = module_00;\n',
  );
  write(root, "src/shared/result.ts", "export const result = 1;\n");
  for (let index = 0; index < MODULE_COUNT; index += 1)
    write(
      root,
      `src/modules/${moduleName(index)}.ts`,
      seededModuleSource(index, seed),
    );
  write(
    root,
    "docs/specs/02_要件/00_runtime-evidence.md",
    [
      "# Runtime Evidence要件",
      "",
      "REQ-RUNTIME-EVIDENCE-001 は固定seed疑似projectの振る舞いを即時観測する。",
      "AC-RUNTIME-EVIDENCE-001 はactual GraphQLiteの再構築と探索を再現する。",
      "",
    ].join("\n"),
  );
  write(
    root,
    "docs/specs/03_アーキテクチャ/00_runtime-evidence.md",
    "# Runtime Evidence詳細設計\n\nworktree固有runtimeへ派生投影を保存する。\n",
  );
  write(
    root,
    "test/features/runtime-evidence.feature",
    [
      "Feature: Runtime Evidence",
      "",
      "  Scenario: SCN-RUNTIME-EVIDENCE-001 固定seedの探索を再現する",
      "    Given a seeded repository",
      "    Then graph evidence is repeatable",
      "",
    ].join("\n"),
  );
  write(
    root,
    "docs/specs/15_要件追跡/00_追跡表.md",
    [
      "# Runtime Evidence追跡",
      "",
      "| Requirement | Acceptance | Scenario | Feature | Implementation |",
      "| --- | --- | --- | --- | --- |",
      "| REQ-RUNTIME-EVIDENCE-001 | AC-RUNTIME-EVIDENCE-001 | SCN-RUNTIME-EVIDENCE-001 | `test/features/runtime-evidence.feature` | `src/app.ts` |",
      "",
    ].join("\n"),
  );
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "add fixed-seed graph evidence fixture"]);
}

function createSeededProject(world: SemanticGraphRuntimeEvidenceWorld): string {
  const root = world.initRepo();
  populateSeededRepository(root);
  world.fixtureRoot = root;
  return root;
}

function requireActualAsset(
  world: SemanticGraphRuntimeEvidenceWorld,
): "skipped" | undefined {
  const configured = process.env[ACTUAL_EXTENSION_ENV];
  if (configured === undefined || configured === "") return "skipped";
  assert.equal(
    path.isAbsolute(configured),
    true,
    `${ACTUAL_EXTENSION_ENV}にはabsolute pathが必要です`,
  );
  const stat = fs.lstatSync(configured);
  assert.equal(stat.isSymbolicLink(), false, "注入assetをsymlinkにできません");
  assert.equal(stat.isFile(), true, "注入assetは通常fileが必要です");
  const asset = graphQlLiteAsset();
  const bytes = fs.readFileSync(configured);
  assert.equal(bytes.length, asset.size, "固定asset sizeが一致しません");
  assert.equal(sha256(bytes), asset.sha256, "固定asset digestが一致しません");
  world.asset = asset;
  world.assetBytes = bytes;
  world.assetMetadata = {
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    extensionVersion: GRAPHQLITE_VERSION,
    assetName: asset.name,
    assetSize: asset.size,
    assetSha256: asset.sha256,
    injectedAssetRealpath: fs.realpathSync(configured),
  };
  return undefined;
}

async function installInjectedAsset(
  root: string,
  asset: GraphQlLiteAsset,
  bytes: Buffer,
): Promise<void> {
  let requestCount = 0;
  const result = await installGraphQlLiteExtension(root, {
    apply: true,
    fetchAsset: async (input) => {
      requestCount += 1;
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      assert.equal(url, asset.url);
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: { "content-length": String(bytes.length) },
      });
    },
  });
  assert.equal(result.status, "installed");
  assert.equal(requestCount, 1);
  assert.equal(sha256(fs.readFileSync(result.path)), asset.sha256);
}

function normalizeProjection(
  expected: SemanticGraphSnapshot,
  stored: GraphStoreReadResult,
  asset: GraphQlLiteAsset,
): NormalizedQueryEvidence {
  const observedHash = semanticGraphContentHash(stored.snapshot);
  const expectedHash = semanticGraphContentHash(expected);
  assert.equal(observedHash, expectedHash);
  const freshness = assessGraphFreshness({
    expectedSource: expected.source,
    expectedExtensionVersion: GRAPHQLITE_VERSION,
    expectedExtensionSha256: asset.sha256,
    manifest: stored.manifest,
    observedGraphContentHash: observedHash,
    observedNodeCount: stored.snapshot.nodes.length,
    observedEdgeCount: stored.snapshot.edges.length,
  });
  assert.equal(freshness.fresh, true);
  assert.equal(freshness.exactEvidenceAllowed, true);
  return {
    status: {
      freshness,
      graphSchemaVersion: stored.manifest.graphSchemaVersion,
      graphBuilderVersion: stored.manifest.graphBuilderVersion,
      extensionVersion: stored.manifest.extensionVersion,
      extensionSha256: stored.manifest.extensionSha256,
      graphContentHash: stored.manifest.graphContentHash,
      nodeCount: stored.manifest.nodeCount,
      edgeCount: stored.manifest.edgeCount,
    },
    impact: traverseSemanticGraph(stored.snapshot, [TARGET_NODE], {
      direction: "incoming",
      edgeKinds: ["imports"],
    }),
    path: shortestSemanticPath(stored.snapshot, APP_NODE, TARGET_NODE, {
      edgeKinds: ["imports"],
    }),
    order: topologicalSemanticOrder(stored.snapshot, ["imports"]),
  };
}

async function rebuildAndObserve(
  root: string,
  asset: GraphQlLiteAsset,
  builtAt: string,
): Promise<ProjectionObservation> {
  const expected = buildRepositorySemanticGraph(root);
  const store = new GraphQlLiteStore(root);
  const started = process.hrtime.bigint();
  try {
    const manifest = await store.replace(expected, builtAt, async () =>
      observeRepositoryGraphSource(root),
    );
    const readBack = await store.read();
    const durationNanoseconds = process.hrtime.bigint() - started;
    assert.equal(manifest.graphContentHash, semanticGraphContentHash(expected));
    assert.equal(manifest.nodeCount, expected.nodes.length);
    assert.equal(manifest.edgeCount, expected.edges.length);
    return {
      manifest,
      readBack,
      normalized: normalizeProjection(expected, readBack, asset),
      durationNanoseconds,
    };
  } finally {
    await store.close();
  }
}

async function readAndNormalize(
  root: string,
  asset: GraphQlLiteAsset,
): Promise<NormalizedQueryEvidence> {
  const expected = buildRepositorySemanticGraph(root);
  const store = new GraphQlLiteStore(root);
  try {
    return normalizeProjection(expected, await store.read(), asset);
  } finally {
    await store.close();
  }
}

function filesBelow(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const current = path.join(directory, entry.name);
      return entry.isDirectory()
        ? filesBelow(current)
        : entry.isFile() || entry.isSymbolicLink()
          ? [current]
          : [];
    })
    .sort();
}

function runtimeInventory(root: string): readonly RuntimeFileEvidence[] {
  const runtime = path.join(root, ".agent-skill-chain", "runtime");
  return filesBelow(runtime).map((file) => {
    const relative = path.relative(root, file).replaceAll(path.sep, "/");
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink())
      return { path: relative, symlinkTarget: fs.readlinkSync(file) };
    const bytes = fs.readFileSync(file);
    return {
      path: relative,
      byteLength: bytes.length,
      bytesBase64: bytes.toString("base64"),
      sha256: sha256(bytes),
    };
  });
}

function runtimeIdentity(root: string): RuntimeIdentity {
  const runtime = path.join(root, GRAPH_RUNTIME);
  const pointer = JSON.parse(
    fs.readFileSync(path.join(runtime, "current.json"), "utf8"),
  ) as { databaseFile?: unknown };
  const databaseFile = pointer.databaseFile;
  if (typeof databaseFile !== "string")
    throw new Error("GraphQLite current pointerにdatabaseFileがありません");
  const database = path.resolve(root, databaseFile);
  const runtimeRealpath = fs.realpathSync(runtime);
  const databaseRealpath = fs.realpathSync(database);
  const runtimeStat = fs.statSync(runtimeRealpath);
  const databaseStat = fs.statSync(databaseRealpath);
  return {
    runtimeRealpath,
    runtimeDevice: runtimeStat.dev,
    runtimeInode: runtimeStat.ino,
    databaseRealpath,
    databaseDevice: databaseStat.dev,
    databaseInode: databaseStat.ino,
  };
}

Given(
  "actual GraphQLiteによる2 worktree分離観測用の隔離疑似projectがある",
  function () {
    if (requireActualAsset(this) === "skipped") return "skipped";
    const primary = createSeededProject(this);
    const holder = this.temp("asc-graph-runtime-worktree-");
    const secondary = path.join(holder, "checkout");
    git(primary, [
      "worktree",
      "add",
      "-q",
      "-b",
      "runtime-evidence-secondary",
      secondary,
      "HEAD",
    ]);
    this.secondaryRoot = secondary;
  },
);

When(
  "両worktreeを完全再構築してAだけtracked sourceを変更し再構築する",
  async function () {
    const primary = this.fixtureRoot;
    const secondary = this.secondaryRoot;
    const asset = this.asset;
    const bytes = this.assetBytes;
    assert.ok(primary);
    assert.ok(secondary);
    assert.ok(asset);
    assert.ok(bytes);
    await installInjectedAsset(primary, asset, bytes);
    await installInjectedAsset(secondary, asset, bytes);
    const primaryInitial = await rebuildAndObserve(
      primary,
      asset,
      FIRST_BUILT_AT,
    );
    const secondaryInitial = await rebuildAndObserve(
      secondary,
      asset,
      FIRST_BUILT_AT,
    );
    const primaryRuntime = runtimeIdentity(primary);
    const secondaryRuntime = runtimeIdentity(secondary);
    const secondaryRuntimeBefore = runtimeInventory(secondary);
    fs.appendFileSync(
      path.join(primary, "src/shared/result.ts"),
      "export const primaryOnlyMutation = true;\n",
      "utf8",
    );
    const primaryAfterMutation = await rebuildAndObserve(
      primary,
      asset,
      SECOND_BUILT_AT,
    );
    const secondaryAfterMutation = await readAndNormalize(secondary, asset);
    const secondaryRuntimeAfter = runtimeInventory(secondary);
    this.worktrees = {
      primaryRoot: primary,
      secondaryRoot: secondary,
      primaryInitial,
      secondaryInitial,
      primaryAfterMutation,
      secondaryAfterMutation,
      primaryRuntime,
      secondaryRuntime,
      secondaryRuntimeBefore,
      secondaryRuntimeAfter,
    };
  },
);

Then(
  "初期semantic contentは一致しworktree identityとruntimeは物理的に分離される",
  function () {
    const observation = this.worktrees;
    assert.ok(observation);
    const primary = observation.primaryInitial;
    const secondary = observation.secondaryInitial;
    assert.equal(
      semanticGraphContentHash(primary.readBack.snapshot),
      semanticGraphContentHash(secondary.readBack.snapshot),
    );
    assert.equal(
      primary.manifest.graphContentHash,
      secondary.manifest.graphContentHash,
    );
    assert.equal(primary.manifest.nodeCount, secondary.manifest.nodeCount);
    assert.equal(primary.manifest.edgeCount, secondary.manifest.edgeCount);
    assert.equal(
      primary.manifest.source.contentDigest,
      secondary.manifest.source.contentDigest,
    );
    assert.equal(
      primary.manifest.source.headSha,
      secondary.manifest.source.headSha,
    );
    assert.equal(
      primary.manifest.source.treeSha,
      secondary.manifest.source.treeSha,
    );
    assert.notEqual(
      primary.manifest.source.worktreeId,
      secondary.manifest.source.worktreeId,
    );
    assert.notEqual(
      observation.primaryRuntime.runtimeRealpath,
      observation.secondaryRuntime.runtimeRealpath,
    );
    assert.notEqual(
      `${String(observation.primaryRuntime.runtimeDevice)}:${String(observation.primaryRuntime.runtimeInode)}`,
      `${String(observation.secondaryRuntime.runtimeDevice)}:${String(observation.secondaryRuntime.runtimeInode)}`,
    );
    assert.notEqual(
      observation.primaryRuntime.databaseRealpath,
      observation.secondaryRuntime.databaseRealpath,
    );
    assert.notEqual(
      `${String(observation.primaryRuntime.databaseDevice)}:${String(observation.primaryRuntime.databaseInode)}`,
      `${String(observation.secondaryRuntime.databaseDevice)}:${String(observation.secondaryRuntime.databaseInode)}`,
    );
  },
);

Then("Aの変更後もBのruntime byte列とqueryとfreshnessは不変である", function () {
  const observation = this.worktrees;
  assert.ok(observation);
  assert.notEqual(
    observation.primaryAfterMutation.manifest.graphContentHash,
    observation.primaryInitial.manifest.graphContentHash,
  );
  assert.equal(observation.primaryAfterMutation.manifest.source.dirty, true);
  assert.deepEqual(
    observation.secondaryAfterMutation,
    observation.secondaryInitial.normalized,
  );
  assert.deepEqual(
    observation.secondaryRuntimeAfter,
    observation.secondaryRuntimeBefore,
  );
  assert.equal(observation.secondaryAfterMutation.status.freshness.fresh, true);
  assert.equal(observation.secondaryAfterMutation.impact.status, "complete");
  assert.equal(observation.secondaryAfterMutation.path.status, "complete");
  assert.equal(observation.secondaryAfterMutation.order.status, "complete");
  this.attach(
    JSON.stringify({
      evidence: "two-worktree-runtime-isolation",
      native: this.assetMetadata,
      initial: {
        semanticContentHash:
          observation.primaryInitial.manifest.graphContentHash,
        nodeCount: observation.primaryInitial.manifest.nodeCount,
        edgeCount: observation.primaryInitial.manifest.edgeCount,
        primaryWorktreeId:
          observation.primaryInitial.manifest.source.worktreeId,
        secondaryWorktreeId:
          observation.secondaryInitial.manifest.source.worktreeId,
      },
      runtime: {
        primary: observation.primaryRuntime,
        secondary: observation.secondaryRuntime,
        secondaryInventoryDigest: sha256(
          JSON.stringify(observation.secondaryRuntimeAfter),
        ),
      },
    }),
    "application/json",
  );
});

Given(
  "actual GraphQLiteによる固定seed再現性観測用の隔離疑似projectがある",
  function () {
    if (requireActualAsset(this) === "skipped") return "skipped";
    createSeededProject(this);
  },
);

When(
  "同一sourceからactual GraphQLite projectionを2回完全再構築する",
  async function () {
    const root = this.fixtureRoot;
    const asset = this.asset;
    const bytes = this.assetBytes;
    assert.ok(root);
    assert.ok(asset);
    assert.ok(bytes);
    await installInjectedAsset(root, asset, bytes);
    const first = await rebuildAndObserve(root, asset, FIRST_BUILT_AT);
    const second = await rebuildAndObserve(root, asset, SECOND_BUILT_AT);
    this.repeatability = { root, first, second };
  },
);

Then("正規化したstatusとimpactとpathとorderは完全に一致する", function () {
  const observation = this.repeatability;
  assert.ok(observation);
  assert.equal(observation.first.manifest.generation, 1);
  assert.equal(observation.second.manifest.generation, 2);
  assert.deepEqual(observation.second.normalized, observation.first.normalized);
  assert.equal(observation.first.normalized.status.freshness.fresh, true);
  assert.equal(observation.first.normalized.impact.status, "complete");
  assert.equal(observation.first.normalized.path.status, "complete");
  assert.deepEqual(observation.first.normalized.path.path, [
    APP_NODE,
    "file:src/modules/module-00.ts",
    "file:src/modules/module-12.ts",
    "file:src/modules/module-21.ts",
    "file:src/modules/module-23.ts",
    TARGET_NODE,
  ]);
  assert.equal(observation.first.normalized.order.status, "complete");
  assert.equal(observation.first.normalized.order.evidenceComplete, true);
});

Then(
  "node数とedge数と各hrtimeを閾値判定せず観測Evidenceとして保持する",
  function () {
    const observation = this.repeatability;
    assert.ok(observation);
    const durations = [
      observation.first.durationNanoseconds,
      observation.second.durationNanoseconds,
    ];
    assert.equal(observation.first.manifest.nodeCount > 0, true);
    assert.equal(observation.first.manifest.edgeCount > 0, true);
    assert.equal(
      observation.second.manifest.nodeCount,
      observation.first.manifest.nodeCount,
    );
    assert.equal(
      observation.second.manifest.edgeCount,
      observation.first.manifest.edgeCount,
    );
    assert.equal(
      durations.every((duration) => duration > 0n),
      true,
    );
    this.attach(
      JSON.stringify({
        evidence: "fixed-seed-actual-rebuild-repeatability",
        native: this.assetMetadata,
        source: observation.first.manifest.source,
        graphContentHash: observation.first.manifest.graphContentHash,
        nodeCount: observation.first.manifest.nodeCount,
        edgeCount: observation.first.manifest.edgeCount,
        durationNanoseconds: durations.map(String),
        thresholdEnforced: false,
      }),
      "application/json",
    );
  },
);
