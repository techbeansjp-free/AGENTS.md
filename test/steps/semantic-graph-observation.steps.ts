import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  GRAPHQLITE_VERSION,
  graphQlLiteAsset,
  type GraphQlLiteAsset,
} from "../../src/adapters/graphqlite.js";
import {
  REPOSITORY_GRAPH_EVIDENCE_AUTHORITY,
  REPOSITORY_GRAPH_PROJECTOR_CAPABILITY,
  buildRepositorySemanticGraph,
} from "../../src/adapters/repository-graph.js";
import { main } from "../../src/cli.js";
import {
  assessImplementationDiscovery,
  decideDeliveryContinuation,
  type DeliveryContinuation,
  type DiscoveryAssessment,
} from "../../src/domain/agile-verification.js";
import {
  DEFAULT_GRAPH_BUDGET,
  SEMANTIC_GRAPH_BUILDER_VERSION,
  SEMANTIC_GRAPH_SCHEMA_VERSION,
  SEMANTIC_EDGE_KINDS,
  SEMANTIC_NODE_KINDS,
  assessGraphFreshness,
  semanticGraphContentHash,
  shortestSemanticPath,
  stronglyConnectedComponents,
  topologicalSemanticOrder,
  traverseSemanticGraph,
  type GraphFreshnessResult,
  type GraphProjectionManifest,
  type GraphTraversalResult,
  type SemanticGraphSnapshot,
  type ShortestPathResult,
  type StronglyConnectedComponentsResult,
  type TopologicalResult,
} from "../../src/domain/semantic-graph.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

type ObservationMode = "Full" | "Quick" | "PoC";

interface MutationObservations {
  readonly baseline: SemanticGraphSnapshot;
  readonly dirty: SemanticGraphSnapshot;
  readonly renamed: SemanticGraphSnapshot;
  readonly deleted: SemanticGraphSnapshot;
}

interface AlgorithmObservations {
  readonly topological: readonly TopologicalResult[];
  readonly shortest: readonly ShortestPathResult[];
}

interface PromotionObservations {
  readonly assessment: DiscoveryAssessment;
  readonly poc: SemanticGraphSnapshot;
  readonly full: SemanticGraphSnapshot;
  readonly oldProjectionFreshness: GraphFreshnessResult;
  readonly fullProjectionFreshness: GraphFreshnessResult;
}

interface SemanticGraphObservationWorld extends WorkflowWorld {
  algorithmObservations?: AlgorithmObservations;
  asset?: GraphQlLiteAsset;
  cliOutput?: Record<string, unknown>;
  cliStatus?: number;
  cliError?: string;
  deliveryContinuation?: DeliveryContinuation;
  freshness?: GraphFreshnessResult;
  fixtureRoot?: string;
  mode?: ObservationMode;
  mutationObservations?: MutationObservations;
  scc?: StronglyConnectedComponentsResult;
  snapshots?: SemanticGraphSnapshot[];
  promotionObservations?: PromotionObservations;
  topological?: TopologicalResult;
  traversal?: GraphTraversalResult;
}

const { Given, When, Then } = stepDefinitions<SemanticGraphObservationWorld>();

const FIXED_REMOTE = "https://example.invalid/asc-observation.git";

function modeSlug(mode: ObservationMode): string {
  return mode === "PoC" ? "poc" : mode.toLowerCase();
}

function modeToken(mode: ObservationMode): string {
  return mode === "PoC" ? "POC" : mode.toUpperCase();
}

function writeFixture(root: string, relative: string, contents: string): void {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, "utf8");
}

function gitFixture(root: string, args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commitFixture(root: string, message: string): void {
  gitFixture(root, ["add", "-A"]);
  gitFixture(root, ["commit", "-q", "-m", message]);
}

async function runCli(
  world: SemanticGraphObservationWorld,
  arguments_: string[],
  nodeVersion?: string,
): Promise<void> {
  let output = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    world.cliStatus = await main(arguments_, {
      now: () => new Date("2026-08-30T00:00:00.000Z"),
      ...(nodeVersion === undefined ? {} : { nodeVersion }),
    });
  } finally {
    process.stdout.write = originalWrite;
  }
  world.cliOutput = JSON.parse(output) as Record<string, unknown>;
}

function graphRuntimeExists(root: string): boolean {
  return fs.existsSync(path.join(root, ".agent-skill-chain/runtime/graph"));
}

function createModeFixture(
  world: SemanticGraphObservationWorld,
  mode: ObservationMode,
): string {
  const root = world.initRepo();
  const slug = modeSlug(mode);
  const token = modeToken(mode);
  const requirement = `REQ-OBS-${token}-001`;
  const acceptance = `AC-OBS-${token}-001`;
  const scenario = `SCN-OBS-${token}-001`;
  const contractPath =
    mode === "Full"
      ? "docs/specs/02_要件/00_観測要件.md"
      : mode === "Quick"
        ? "docs/quick/00_要求定義.md"
        : "docs/poc/00_要求定義.md";
  gitFixture(root, ["remote", "add", "origin", FIXED_REMOTE]);
  writeFixture(
    root,
    contractPath,
    [
      `# ${mode} mode observation`,
      "",
      `${requirement} は${mode} modeを独立した契約として扱う。`,
      `${acceptance} は隔離fixture内で即時検証する。`,
      "",
    ].join("\n"),
  );
  if (mode === "Full")
    writeFixture(
      root,
      "docs/specs/03_アーキテクチャ/00_詳細設計.md",
      "# Full mode detailed design\n",
    );
  if (mode === "Quick")
    writeFixture(
      root,
      "docs/quick/decision.md",
      "# Quick mode local decision record\n",
    );
  if (mode === "PoC")
    writeFixture(
      root,
      "docs/poc/hypothesis.md",
      "# PoC hypothesis and disposal decision\n",
    );
  writeFixture(
    root,
    `test/features/${slug}.feature`,
    [
      `Feature: ${mode} mode observation`,
      "",
      `  Scenario: ${scenario} ${mode} mode behavior`,
      "    Given an isolated project",
      "    Then the behavior is observable",
      "",
    ].join("\n"),
  );
  writeFixture(
    root,
    `src/${slug}.ts`,
    `export const observationMode = ${JSON.stringify(mode)};\n`,
  );
  writeFixture(
    root,
    "docs/specs/15_要件追跡/00_追跡表.md",
    [
      "# Observation trace",
      "",
      "| Requirement | Acceptance | Scenario | Feature | Implementation |",
      "| --- | --- | --- | --- | --- |",
      `| ${requirement} | ${acceptance} | ${scenario} | \`test/features/${slug}.feature\` | \`src/${slug}.ts\` |`,
      "",
    ].join("\n"),
  );
  commitFixture(root, `add ${mode} observation fixture`);
  world.fixtureRoot = root;
  world.mode = mode;
  return root;
}

function replacePocFixtureWithFullContract(root: string): void {
  fs.rmSync(path.join(root, "docs/poc/00_要求定義.md"));
  fs.rmSync(path.join(root, "docs/poc/hypothesis.md"));
  fs.rmSync(path.join(root, "test/features/poc.feature"));
  fs.rmSync(path.join(root, "src/poc.ts"));
  writeFixture(
    root,
    "docs/specs/02_要件/00_観測要件.md",
    [
      "# Full promotion observation",
      "",
      "REQ-OBS-FULL-001 は補完した正本からFull契約を再構築する。",
      "AC-OBS-FULL-001 は旧PoC投影を正式成果物へ昇格しない。",
      "",
    ].join("\n"),
  );
  writeFixture(
    root,
    "docs/specs/03_アーキテクチャ/00_詳細設計.md",
    "# Full mode detailed design\n",
  );
  writeFixture(
    root,
    "docs/specs/14_開発・品質/00_実装計画.md",
    "# Full mode implementation plan\n",
  );
  writeFixture(
    root,
    "test/features/full.feature",
    [
      "Feature: Full promotion observation",
      "",
      "  Scenario: SCN-OBS-FULL-001 Full mode behavior",
      "    Given a supplemented canonical contract",
      "    Then the behavior is observable",
      "",
    ].join("\n"),
  );
  writeFixture(root, "src/full.ts", 'export const observationMode = "Full";\n');
  writeFixture(
    root,
    "docs/specs/15_要件追跡/00_追跡表.md",
    [
      "# Full promotion trace",
      "",
      "| Requirement | Acceptance | Scenario | Feature | Implementation |",
      "| --- | --- | --- | --- | --- |",
      "| REQ-OBS-FULL-001 | AC-OBS-FULL-001 | SCN-OBS-FULL-001 | `test/features/full.feature` | `src/full.ts` |",
      "",
    ].join("\n"),
  );
  commitFixture(root, "promote supplemented canonical contract to Full");
}

function assertDirectModeTrace(
  snapshot: SemanticGraphSnapshot,
  mode: ObservationMode,
): void {
  const slug = modeSlug(mode);
  const token = modeToken(mode);
  const scenario = `scenario:SCN-OBS-${token}-001`;
  const implementation = `file:src/${slug}.ts`;
  const feature = `file:test/features/${slug}.feature`;
  assert.ok(
    snapshot.nodes.some(
      ({ id, kind }) => id === scenario && kind === "scenario",
    ),
    `${mode} scenario nodeがありません`,
  );
  assert.ok(
    snapshot.edges.some(
      ({ from, kind, to }) =>
        from === scenario && kind === "satisfied-by" && to === implementation,
    ),
    `${mode} scenarioから実装fileへのdirect traceがありません`,
  );
  assert.ok(
    snapshot.edges.some(
      ({ from, kind, to }) =>
        from === scenario && kind === "verified-by" && to === feature,
    ),
    `${mode} scenarioからfeatureへのverification traceがありません`,
  );
}

function addDagFixture(root: string): void {
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
  commitFixture(root, "add deterministic import DAG");
}

function reverseSnapshot(
  snapshot: SemanticGraphSnapshot,
): SemanticGraphSnapshot {
  return {
    ...snapshot,
    nodes: [...snapshot.nodes].reverse(),
    edges: [...snapshot.edges].reverse(),
  };
}

function graphManifest(
  snapshot: SemanticGraphSnapshot,
  asset: GraphQlLiteAsset,
): GraphProjectionManifest {
  return {
    manifestVersion: "agent-skill-chain/graph-projection-manifest/v1",
    graphSchemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION,
    graphBuilderVersion: SEMANTIC_GRAPH_BUILDER_VERSION,
    extensionVersion: GRAPHQLITE_VERSION,
    extensionSha256: asset.sha256,
    source: snapshot.source,
    graphContentHash: semanticGraphContentHash(snapshot),
    nodeCount: snapshot.nodes.length,
    edgeCount: snapshot.edges.length,
    generation: 1,
    status: "complete",
    builtAt: "2026-08-30T00:00:00.000Z",
  };
}

for (const mode of ["Full", "Quick", "PoC"] as const)
  Given(`${mode} modeの隔離疑似projectがある`, function () {
    createModeFixture(this, mode);
  });

When("mode別semantic graphを構築する", function () {
  assert.ok(this.fixtureRoot);
  this.snapshots = [buildRepositorySemanticGraph(this.fixtureRoot)];
});

for (const mode of ["Full", "Quick", "PoC"] as const)
  Then(
    `${mode} modeのscenarioから実装fileへのdirect traceが得られる`,
    function () {
      assert.equal(this.mode, mode);
      const snapshot = this.snapshots?.[0];
      assert.ok(snapshot);
      assertDirectModeTrace(snapshot, mode);
    },
  );

Given("決定性観測用の隔離疑似projectがある", function () {
  createModeFixture(this, "Full");
});

When("同一sourceからsemantic graphを2回構築する", function () {
  assert.ok(this.fixtureRoot);
  this.snapshots = [
    buildRepositorySemanticGraph(this.fixtureRoot),
    buildRepositorySemanticGraph(this.fixtureRoot),
  ];
});

Then("2つのsnapshotとcontent hashは完全に一致する", function () {
  assert.equal(this.snapshots?.length, 2);
  assert.deepEqual(this.snapshots?.[0], this.snapshots?.[1]);
  assert.equal(
    semanticGraphContentHash(this.snapshots![0]!),
    semanticGraphContentHash(this.snapshots![1]!),
  );
});

Given("source mutation観測用の隔離疑似projectがある", function () {
  createModeFixture(this, "Full");
});

When(
  "tracked sourceを変更してrenameしtracked featureをdeleteする",
  function () {
    assert.ok(this.fixtureRoot);
    const root = this.fixtureRoot;
    const baseline = buildRepositorySemanticGraph(root);
    fs.appendFileSync(
      path.join(root, "src/full.ts"),
      "export const dirtyChange = true;\n",
      "utf8",
    );
    const dirty = buildRepositorySemanticGraph(root);
    gitFixture(root, ["mv", "src/full.ts", "src/full-renamed.ts"]);
    writeFixture(
      root,
      "docs/specs/15_要件追跡/00_追跡表.md",
      fs
        .readFileSync(
          path.join(root, "docs/specs/15_要件追跡/00_追跡表.md"),
          "utf8",
        )
        .replace("`src/full.ts`", "`src/full-renamed.ts`"),
    );
    const renamed = buildRepositorySemanticGraph(root);
    fs.rmSync(path.join(root, "test/features/full.feature"));
    writeFixture(
      root,
      "docs/specs/15_要件追跡/00_追跡表.md",
      fs
        .readFileSync(
          path.join(root, "docs/specs/15_要件追跡/00_追跡表.md"),
          "utf8",
        )
        .replace("`test/features/full.feature`", "deleted-feature"),
    );
    const deleted = buildRepositorySemanticGraph(root);
    this.mutationObservations = { baseline, dirty, renamed, deleted };
  },
);

Then("各mutationのcontent digestとfile状態が直ちに変化する", function () {
  const observations = this.mutationObservations;
  assert.ok(observations);
  assert.equal(observations.baseline.source.dirty, false);
  for (const snapshot of [
    observations.dirty,
    observations.renamed,
    observations.deleted,
  ])
    assert.equal(snapshot.source.dirty, true);
  assert.equal(
    new Set(
      [
        observations.baseline,
        observations.dirty,
        observations.renamed,
        observations.deleted,
      ].map((snapshot) => snapshot.source.contentDigest),
    ).size,
    4,
  );
  assert.ok(
    observations.renamed.nodes.some(
      ({ id }) => id === "file:src/full-renamed.ts",
    ),
  );
  assert.equal(
    observations.renamed.nodes.some(({ id }) => id === "file:src/full.ts"),
    false,
  );
  const deleted = observations.deleted.nodes.find(
    ({ id }) => id === "file:test/features/full.feature",
  );
  assert.ok(deleted);
  assert.equal(deleted.properties.state, "missing");
});

Given("同一commitをcheckoutした2つの隔離worktreeがある", function () {
  const primary = createModeFixture(this, "Full");
  const holder = this.temp("asc-graph-second-worktree-");
  const secondary = path.join(holder, "checkout");
  gitFixture(primary, [
    "worktree",
    "add",
    "-q",
    "-b",
    "observation-second",
    secondary,
    "HEAD",
  ]);
  this.snapshots = [
    buildRepositorySemanticGraph(primary),
    buildRepositorySemanticGraph(secondary),
  ];
});

When("両worktreeでsemantic graphを構築する", function () {
  assert.equal(this.snapshots?.length, 2);
});

Then("source内容は一致するがworktree identityは分離される", function () {
  const [primary, secondary] = this.snapshots ?? [];
  assert.ok(primary);
  assert.ok(secondary);
  assert.equal(primary.source.repositoryId, secondary.source.repositoryId);
  assert.equal(primary.source.headSha, secondary.source.headSha);
  assert.equal(primary.source.treeSha, secondary.source.treeSha);
  assert.equal(primary.source.contentDigest, secondary.source.contentDigest);
  assert.notEqual(primary.source.worktreeId, secondary.source.worktreeId);
  assert.equal(
    semanticGraphContentHash(primary),
    semanticGraphContentHash(secondary),
  );
});

Given("同順位の2経路を持つDAG疑似projectがある", function () {
  const root = createModeFixture(this, "Full");
  addDagFixture(root);
});

When("import graphをtopological sortして最短経路を探索する", function () {
  assert.ok(this.fixtureRoot);
  const snapshot = buildRepositorySemanticGraph(this.fixtureRoot);
  const reversed = reverseSnapshot(snapshot);
  this.algorithmObservations = {
    topological: [snapshot, reversed].map((candidate) =>
      topologicalSemanticOrder(candidate, ["imports"]),
    ),
    shortest: [snapshot, reversed].map((candidate) =>
      shortestSemanticPath(
        candidate,
        "file:src/root.ts",
        "file:src/target.ts",
        { edgeKinds: ["imports"] },
      ),
    ),
  };
});

Then("DAG順序と同距離pathは入力順に依存せず辞書順で確定する", function () {
  const observations = this.algorithmObservations;
  assert.ok(observations);
  assert.deepEqual(observations.topological[0], observations.topological[1]);
  assert.deepEqual(observations.shortest[0], observations.shortest[1]);
  const topological = observations.topological[0]!;
  assert.equal(topological.status, "complete");
  const order = topological.order;
  assert.ok(
    order.indexOf("file:src/root.ts") < order.indexOf("file:src/left.ts"),
  );
  assert.ok(
    order.indexOf("file:src/root.ts") < order.indexOf("file:src/right.ts"),
  );
  assert.ok(
    order.indexOf("file:src/left.ts") < order.indexOf("file:src/right.ts"),
  );
  assert.ok(
    order.indexOf("file:src/right.ts") < order.indexOf("file:src/target.ts"),
  );
  assert.deepEqual(observations.shortest[0], {
    ...observations.shortest[0],
    status: "complete",
    algorithm: "bfs",
    path: ["file:src/root.ts", "file:src/left.ts", "file:src/target.ts"],
    distance: 2,
    reasons: [],
  });
});

Given("self-loopと2 node cycleを持つ疑似projectがある", function () {
  const root = createModeFixture(this, "Full");
  writeFixture(
    root,
    "src/self.ts",
    'import "./self.js";\nexport const self = true;\n',
  );
  writeFixture(
    root,
    "src/cycle-a.ts",
    'import "./cycle-b.js";\nexport const cycleA = true;\n',
  );
  writeFixture(
    root,
    "src/cycle-b.ts",
    'import "./cycle-a.js";\nexport const cycleB = true;\n',
  );
  commitFixture(root, "add cyclic import fixtures");
});

When("import graphのSCCとtopological sortを実行する", function () {
  assert.ok(this.fixtureRoot);
  const snapshot = buildRepositorySemanticGraph(this.fixtureRoot);
  this.scc = stronglyConnectedComponents(snapshot, ["imports"]);
  this.topological = topologicalSemanticOrder(snapshot, ["imports"]);
});

Then("self-loopと2 node cycleをそれぞれcycle Evidenceとして返す", function () {
  assert.equal(this.scc?.status, "complete");
  assert.ok(
    this.scc?.components.some(
      (component) =>
        component.length === 1 && component[0] === "file:src/self.ts",
    ),
  );
  assert.ok(
    this.scc?.components.some(
      (component) =>
        JSON.stringify(component) ===
        JSON.stringify(["file:src/cycle-a.ts", "file:src/cycle-b.ts"]),
    ),
  );
  assert.equal(this.topological?.status, "invalid");
  assert.ok(
    this.topological?.stronglyConnectedComponents.some(
      (component) =>
        component.length === 1 && component[0] === "file:src/self.ts",
    ),
  );
  assert.ok(
    this.topological?.stronglyConnectedComponents.some(
      (component) =>
        JSON.stringify(component) ===
        JSON.stringify(["file:src/cycle-a.ts", "file:src/cycle-b.ts"]),
    ),
  );
});

Given("多数の投影edgeを持つbudget観測用疑似projectがある", function () {
  const root = createModeFixture(this, "Full");
  for (let index = 0; index < 8; index += 1)
    writeFixture(
      root,
      `src/budget-${index}.ts`,
      `export const budget${index} = ${index};\n`,
    );
  commitFixture(root, "add bounded traversal fixture");
  this.snapshots = [buildRepositorySemanticGraph(root)];
});

When("result上限2でrepositoryからbounded BFSを実行する", function () {
  const snapshot = this.snapshots?.[0];
  assert.ok(snapshot);
  const repository = snapshot.nodes.find(({ kind }) => kind === "repository");
  assert.ok(repository);
  this.traversal = traverseSemanticGraph(snapshot, [repository.id], {
    direction: "outgoing",
    budget: { ...DEFAULT_GRAPH_BUDGET, maxResults: 2 },
  });
});

Then("budget exceededを返し結果数と観測値はhard limit以内である", function () {
  assert.equal(this.traversal?.status, "budget-exceeded");
  assert.ok((this.traversal?.nodes.length ?? Number.POSITIVE_INFINITY) <= 2);
  assert.ok(
    (this.traversal?.visitedNodes ?? Number.POSITIVE_INFINITY) <=
      DEFAULT_GRAPH_BUDGET.maxVisitedNodes,
  );
  assert.ok(
    (this.traversal?.visitedEdges ?? Number.POSITIVE_INFINITY) <=
      DEFAULT_GRAPH_BUDGET.maxVisitedEdges,
  );
  assert.ok(
    (this.traversal?.operations ?? Number.POSITIVE_INFINITY) <=
      DEFAULT_GRAPH_BUDGET.maxOperations,
  );
});

Given("GraphQLite固定assetと現在source identityがある", function () {
  const root = createModeFixture(this, "Full");
  this.snapshots = [buildRepositorySemanticGraph(root)];
  this.asset = graphQlLiteAsset("linux", "x64");
  assert.equal(this.asset.name, "graphqlite-linux-x86_64.so");
  assert.equal(this.asset.url.includes(`/v${GRAPHQLITE_VERSION}/`), true);
  assert.match(this.asset.sha256, /^[a-f0-9]{64}$/u);
});

When("graph projectionがmissingとしてfreshnessを評価する", function () {
  const snapshot = this.snapshots?.[0];
  assert.ok(snapshot);
  assert.ok(this.asset);
  this.freshness = assessGraphFreshness({
    expectedSource: snapshot.source,
    expectedExtensionVersion: GRAPHQLITE_VERSION,
    expectedExtensionSha256: this.asset.sha256,
    readError: "missing",
  });
});

When("graph projectionがcorruptとしてfreshnessを評価する", function () {
  const snapshot = this.snapshots?.[0];
  assert.ok(snapshot);
  assert.ok(this.asset);
  this.freshness = assessGraphFreshness({
    expectedSource: snapshot.source,
    expectedExtensionVersion: GRAPHQLITE_VERSION,
    expectedExtensionSha256: this.asset.sha256,
    readError: "corrupt",
  });
});

When("過去sourceのmanifestを現在sourceに対して評価する", function () {
  const snapshot = this.snapshots?.[0];
  assert.ok(snapshot);
  assert.ok(this.asset);
  const manifest = graphManifest(snapshot, this.asset);
  this.freshness = assessGraphFreshness({
    expectedSource: {
      ...snapshot.source,
      contentDigest: "f".repeat(64),
      dirty: !snapshot.source.dirty,
    },
    expectedExtensionVersion: GRAPHQLITE_VERSION,
    expectedExtensionSha256: this.asset.sha256,
    manifest,
    observedGraphContentHash: manifest.graphContentHash,
    observedNodeCount: manifest.nodeCount,
    observedEdgeCount: manifest.edgeCount,
  });
});

for (const [reason, phrase] of [
  ["missing", "missing"],
  ["corrupt", "corrupt"],
  ["source-ahead", "source ahead"],
] as const)
  Then(
    `${phrase}を理由にexact Evidenceを拒否してrebuildを要求する`,
    function () {
      assert.equal(this.freshness?.fresh, false);
      assert.equal(this.freshness?.exactEvidenceAllowed, false);
      assert.equal(this.freshness?.recovery, "rebuild");
      assert.ok(this.freshness?.reasons.includes(reason));
    },
  );

Given("Graph CLI観測用の隔離疑似projectがある", function () {
  createModeFixture(this, "Full");
});

When("graph installをdry-runで実行する", async function () {
  assert.ok(this.fixtureRoot);
  await runCli(this, [
    "graph",
    "install",
    `--root=${this.fixtureRoot}`,
    "--dry-run",
  ]);
});

Then("固定asset計画だけを返しGraph runtimeを作らない", function () {
  assert.equal(this.cliStatus, 0);
  assert.equal(this.cliOutput?.status, "preview");
  assert.equal(
    (this.cliOutput?.asset as Record<string, unknown> | undefined)?.sha256,
    graphQlLiteAsset().sha256,
  );
  assert.ok(this.fixtureRoot);
  assert.equal(graphRuntimeExists(this.fixtureRoot), false);
});

When("graph rebuildをdry-runで実行する", async function () {
  assert.ok(this.fixtureRoot);
  await runCli(this, [
    "graph",
    "rebuild",
    `--root=${this.fixtureRoot}`,
    "--dry-run",
  ]);
});

Then("source identityと件数とhashを返しGraph runtimeを作らない", function () {
  assert.equal(this.cliStatus, 0);
  assert.equal(this.cliOutput?.status, "preview");
  assert.ok(
    typeof this.cliOutput?.nodeCount === "number" &&
      this.cliOutput.nodeCount > 0,
  );
  assert.ok(
    typeof this.cliOutput?.edgeCount === "number" &&
      this.cliOutput.edgeCount > 0,
  );
  assert.match(String(this.cliOutput?.graphContentHash), /^[a-f0-9]{64}$/u);
  assert.ok(this.fixtureRoot);
  assert.equal(graphRuntimeExists(this.fixtureRoot), false);
});

When("missing Graphでgraph statusを実行する", async function () {
  assert.ok(this.fixtureRoot);
  await runCli(this, ["graph", "status", `--root=${this.fixtureRoot}`]);
});

Then("非0と明示的rebuild案内を返しGraph runtimeを作らない", function () {
  assert.equal(this.cliStatus, 1);
  assert.equal(this.cliOutput?.status, "unavailable-or-stale");
  assert.equal(this.cliOutput?.exactEvidenceAllowed, false);
  assert.match(String(this.cliOutput?.next), /graph install.*graph rebuild/u);
  assert.ok(this.fixtureRoot);
  assert.equal(graphRuntimeExists(this.fixtureRoot), false);
});

Given("複数要件と受け入れ条件を持つtrace rowがある", function () {
  const root = createModeFixture(this, "Full");
  writeFixture(root, "src/one.ts", "export const one = true;\n");
  writeFixture(root, "src/two.ts", "export const two = true;\n");
  writeFixture(
    root,
    "test/features/multi.feature",
    [
      "Feature: multi trace",
      "",
      "  Scenario: SCN-OBS-ONE-001 first",
      "    Then first",
      "",
      "  Scenario: SCN-OBS-TWO-001 second",
      "    Then second",
      "",
    ].join("\n"),
  );
  writeFixture(
    root,
    "docs/specs/15_要件追跡/00_追跡表.md",
    [
      "# Multi trace",
      "",
      "| 要件ID | 受け入れ条件 | SCN ID | テスト層 | Feature | 実装 | 結果 |",
      "|---|---|---|---|---|---|---|",
      "| REQ-OBS-ONE-001、REQ-OBS-TWO-001 | AC-OBS-ONE-001、AC-OBS-TWO-001 | SCN-OBS-ONE-001、SCN-OBS-TWO-001 | integration | `test/features/multi.feature` | `src/one.ts`、`src/two.ts` | 未実行 |",
      "",
    ].join("\n"),
  );
  commitFixture(root, "add ambiguous multi trace row");
});

When("trace rowをsemantic graphへ投影する", function () {
  assert.ok(this.fixtureRoot);
  this.snapshots = [buildRepositorySemanticGraph(this.fixtureRoot)];
});

Then(
  "IDが一致する要件と受け入れ条件だけを結び曖昧なscenario辺を作らない",
  function () {
    const snapshot = this.snapshots?.[0];
    assert.ok(snapshot);
    const relation = (from: string, to: string, kind: string): boolean =>
      snapshot.edges.some(
        (edge) => edge.from === from && edge.to === to && edge.kind === kind,
      );
    assert.equal(
      relation(
        "requirement:REQ-OBS-ONE-001",
        "acceptance-criteria:AC-OBS-ONE-001",
        "has-acceptance-criteria",
      ),
      true,
    );
    assert.equal(
      relation(
        "requirement:REQ-OBS-TWO-001",
        "acceptance-criteria:AC-OBS-TWO-001",
        "has-acceptance-criteria",
      ),
      true,
    );
    assert.equal(
      relation(
        "requirement:REQ-OBS-ONE-001",
        "acceptance-criteria:AC-OBS-TWO-001",
        "has-acceptance-criteria",
      ),
      false,
    );
    assert.equal(
      snapshot.edges.some(
        ({ from, kind }) =>
          from.startsWith("acceptance-criteria:AC-OBS-") &&
          kind === "verified-by",
      ),
      false,
    );
  },
);

Given(
  "relative importと複数行宣言とbinding shadowと字句decoyを持つ疑似projectがある",
  function () {
    const root = createModeFixture(this, "Full");
    writeFixture(
      root,
      "src/a.tsx",
      [
        "import {",
        '  /* from "./decoy.js" */',
        "  b,",
        '} from "./b.js";',
        "export const a = b;",
        "",
      ].join("\n"),
    );
    writeFixture(root, "src/b.jsx", "export const b = true;\n");
    writeFixture(
      root,
      "src/c.cjs",
      'require("./d");\nmodule.exports = true;\n',
    );
    writeFixture(root, "src/d.cts", "export const d = true;\n");
    writeFixture(
      root,
      "src/division-context.ts",
      [
        "const of = 4;",
        "const quotient = of / 2;",
        'void import("./b.js");',
        "export { quotient };",
        "",
      ].join("\n"),
    );
    writeFixture(root, "src/dynamic.mjs", 'import("./b.js");\n');
    writeFixture(
      root,
      "src/dynamic-options.mjs",
      'import("./b.js", { with: { type: "json" } });\n',
    );
    writeFixture(
      root,
      "src/escaped-import.ts",
      'import \\u0062 from "./\\u0062.js";\nexport { \\u0062 };\n',
    );
    writeFixture(root, "src/export-all.mts", 'export * from "./b.js";\n');
    writeFixture(
      root,
      "src/export-type.mts",
      'export type { b } from "./b.js";\n',
    );
    writeFixture(
      root,
      "src/hashbang.mjs",
      '#!/usr/bin/env import("./decoy.js")\nexport const valid = true;\n',
    );
    writeFixture(root, "src/bom.mjs", "\uFEFFexport const valid = true;\n");
    writeFixture(
      root,
      "src/jsx-context.tsx",
      [
        "export const view = (",
        "  <div data-fake='import(\"./decoy.js\")'>",
        '    import fake from "./decoy.js"',
        '    <span>require("./decoy.js")</span>',
        '    {import("./b.js")}',
        "  </div>",
        ");",
        "",
      ].join("\n"),
    );
    writeFixture(
      root,
      "src/tsx-generic.tsx",
      [
        "const identity = <T,>(value: T): T => value;",
        "const constrained = <T extends object>(value: T): T => value;",
        'void import("./b.js");',
        "export { constrained, identity };",
        "",
      ].join("\n"),
    );
    writeFixture(root, "src/side-effect.js", 'import "./b.js";\n');
    writeFixture(
      root,
      "src/template-expression.mts",
      'export const lazy = `${import("./b.js")}`;\n',
    );
    writeFixture(
      root,
      "src/e.mts",
      ["export {", "  b,", '} from "./b.js";', ""].join("\n"),
    );
    writeFixture(
      root,
      "src/interrupted.ts",
      ["export const value = true", '// from "./decoy.js"', ""].join("\n"),
    );
    writeFixture(
      root,
      "src/lexical-decoys.ts",
      [
        "/*",
        'import "./decoy.js";',
        'export { decoy } from "./decoy.js";',
        'require("./decoy.js");',
        "*/",
        '// import("./decoy.js")',
        `const quoted = 'require("./decoy.js")';`,
        'const doubleQuoted = "import(\\"./decoy.js\\")";',
        'const template = `import("./decoy.js") ${`require("./decoy.js")`}`;',
        'const pattern = /require\\("\\.\\/decoy\\.js"\\)/;',
        "const division = 8 / 2;",
        'if (division) /import\\("\\.\\/decoy\\.js"\\)/.test(quoted);',
        'if (division) {} /import\\("\\.\\/decoy\\.js"\\)/.test(quoted);',
        'export default /import\\("\\.\\/decoy\\.js"\\)/;',
        'async function consume(xs: AsyncIterable<string>) { for await (const x of xs) /import\\("\\.\\/decoy\\.js"\\)/.test(x); }',
        'loader.require("./decoy.js");',
        'loader.import("./decoy.js");',
        "export { division, doubleQuoted, pattern, quoted, template };",
        "",
      ].join("\n"),
    );
    writeFixture(
      root,
      "src/contextual.cjs",
      [
        "let await = 4;",
        "const first = await / 2;",
        "function divide() {",
        "  let yield = 4;",
        "  const second = yield / 2;",
        '  return import("./b.js");',
        "}",
        "module.exports = { divide, first };",
        "",
      ].join("\n"),
    );
    writeFixture(
      root,
      "src/non-null.ts",
      [
        "declare const value: number;",
        "const quotient = value! / 2;",
        'void import("./b.js");',
        "export { quotient };",
        "",
      ].join("\n"),
    );
    writeFixture(
      root,
      "src/nonliteral.ts",
      [
        'const target = "./decoy.js" as string;',
        "declare const require: (value: string) => unknown;",
        "void import(target);",
        "require(target);",
        "export { target };",
        "",
      ].join("\n"),
    );
    writeFixture(root, "src/loader.js", "export default value => value;\n");
    writeFixture(
      root,
      "src/ambient-module.ts",
      'declare module "require" { export const value: boolean; } require("./b.js");\n',
    );
    writeFixture(
      root,
      "src/ambient-const.ts",
      'declare const require: (value: string) => unknown; require("./b.js");\n',
    );
    writeFixture(
      root,
      "src/ambient-function.ts",
      'declare function require(value: string): unknown; require("./b.js");\n',
    );
    writeFixture(
      root,
      "src/shadow-arrow.cjs",
      '(require => require("./decoy.js"))(value => value);\n',
    );
    writeFixture(
      root,
      "src/shadow-block.cjs",
      '{ const require = value => value; require("./decoy.js"); }\n',
    );
    writeFixture(
      root,
      "src/shadow-catch.cjs",
      'try { throw value => value; } catch (require) { require("./decoy.js"); }\n',
    );
    writeFixture(
      root,
      "src/shadow-destructure.cjs",
      'const { loader: require } = { loader: value => value }; require("./decoy.js");\n',
    );
    writeFixture(
      root,
      "src/shadow-function.cjs",
      'function load(require) { return require("./decoy.js"); } module.exports = load;\n',
    );
    writeFixture(
      root,
      "src/shadow-function-expression.cjs",
      'const load = function require() { return require("./decoy.js"); }; module.exports = load;\n',
    );
    writeFixture(
      root,
      "src/shadow-function-declaration.cjs",
      'function require(value) { return value; } require("./decoy.js");\n',
    );
    writeFixture(
      root,
      "src/shadow-class-declaration.cjs",
      'class require {} require("./decoy.js");\n',
    );
    writeFixture(
      root,
      "src/shadow-import.mts",
      'import require from "./loader.js"; require("./decoy.js");\n',
    );
    writeFixture(
      root,
      "src/shadow-import-equals.ts",
      'import require = require("./loader.js"); require("./decoy.js");\n',
    );
    writeFixture(
      root,
      "src/shadow-local.cjs",
      'const require = value => value; require("./decoy.js");\n',
    );
    writeFixture(
      root,
      "src/dynamic-eval.cjs",
      'function load(source) { eval(source); require("./decoy.js"); } module.exports = load;\n',
    );
    writeFixture(
      root,
      "src/dynamic-reassignment.cjs",
      'require = value => value; require("./decoy.js");\n',
    );
    writeFixture(
      root,
      "src/dynamic-array-reassignment.cjs",
      '[require] = [value => value]; require("./decoy.js");\n',
    );
    writeFixture(
      root,
      "src/dynamic-object-reassignment.cjs",
      '({ loader: require } = { loader: value => value }); require("./decoy.js");\n',
    );
    writeFixture(
      root,
      "src/dynamic-with.cjs",
      'function load(value) { return value; } with (load(require("./b.js"))) { require("./decoy.js"); }\n',
    );
    writeFixture(
      root,
      "src/shadow-var-hoist.cjs",
      'function load() { require("./decoy.js"); { var require = value => value; } } module.exports = load;\n',
    );
    writeFixture(
      root,
      "src/scoped-function-declaration.cjs",
      'function load() { function require(value) { return value; } require("./decoy.js"); } require("./b.js"); module.exports = load;\n',
    );
    writeFixture(
      root,
      "src/scoped-module.ts",
      'namespace Scope { var require = (value: string) => value; require("./decoy.js"); } require("./b.js");\n',
    );
    writeFixture(
      root,
      "src/scoped-static-block.cjs",
      'class Scope { static { var require = value => value; require("./decoy.js"); } } require("./b.js");\n',
    );
    writeFixture(
      root,
      "src/type-only-shadow.ts",
      'type require = string; interface requireShape { value: string } require("./b.js");\n',
    );
    writeFixture(
      root,
      "src/type-import.ts",
      'import type { b } from "./b.js";\ntype B = import("./b.js").b;\nexport type { B, b };\n',
    );
    writeFixture(root, "src/decoy.ts", "export const decoy = true;\n");
    writeFixture(root, "src/types.ts", "export type loader = string;\n");
    writeFixture(
      root,
      "src/type-only-default.mts",
      'import type require from "./types.js"; require("./b.js");\n',
    );
    writeFixture(
      root,
      "src/type-only-named.mts",
      'import { type loader as require } from "./types.js"; require("./b.js");\n',
    );
    writeFixture(
      root,
      "src/type-only-namespace.mts",
      'import type * as require from "./types.js"; require("./b.js");\n',
    );
    writeFixture(
      root,
      "src/type-only-import-equals.ts",
      'import type require = require("./types.js"); require("./b.js");\n',
    );
    commitFixture(root, "add ECMAScript source variants");
  },
);

When("source variantをsemantic graphへ投影する", function () {
  assert.ok(this.fixtureRoot);
  this.snapshots = [buildRepositorySemanticGraph(this.fixtureRoot)];
});

Then(
  "各relative importとexportは決定論的edgeになり構文と資源境界を越えない",
  function () {
    const snapshot = this.snapshots?.[0];
    assert.ok(snapshot);
    for (const [from, to] of [
      ["file:src/ambient-const.ts", "file:src/b.jsx"],
      ["file:src/ambient-function.ts", "file:src/b.jsx"],
      ["file:src/ambient-module.ts", "file:src/b.jsx"],
      ["file:src/a.tsx", "file:src/b.jsx"],
      ["file:src/c.cjs", "file:src/d.cts"],
      ["file:src/contextual.cjs", "file:src/b.jsx"],
      ["file:src/division-context.ts", "file:src/b.jsx"],
      ["file:src/dynamic.mjs", "file:src/b.jsx"],
      ["file:src/dynamic-options.mjs", "file:src/b.jsx"],
      ["file:src/dynamic-with.cjs", "file:src/b.jsx"],
      ["file:src/escaped-import.ts", "file:src/b.jsx"],
      ["file:src/e.mts", "file:src/b.jsx"],
      ["file:src/export-all.mts", "file:src/b.jsx"],
      ["file:src/export-type.mts", "file:src/b.jsx"],
      ["file:src/jsx-context.tsx", "file:src/b.jsx"],
      ["file:src/side-effect.js", "file:src/b.jsx"],
      ["file:src/template-expression.mts", "file:src/b.jsx"],
      ["file:src/tsx-generic.tsx", "file:src/b.jsx"],
      ["file:src/type-import.ts", "file:src/b.jsx"],
      ["file:src/type-only-default.mts", "file:src/b.jsx"],
      ["file:src/type-only-import-equals.ts", "file:src/b.jsx"],
      ["file:src/type-only-named.mts", "file:src/b.jsx"],
      ["file:src/type-only-namespace.mts", "file:src/b.jsx"],
      ["file:src/type-only-shadow.ts", "file:src/b.jsx"],
      ["file:src/non-null.ts", "file:src/b.jsx"],
      ["file:src/scoped-function-declaration.cjs", "file:src/b.jsx"],
      ["file:src/scoped-module.ts", "file:src/b.jsx"],
      ["file:src/scoped-static-block.cjs", "file:src/b.jsx"],
    ])
      assert.ok(
        snapshot.edges.some(
          (edge) =>
            edge.from === from &&
            edge.to === to &&
            edge.kind === "imports" &&
            edge.certainty === "deterministic",
        ),
        `missing deterministic imports edge: ${from} -> ${to}`,
      );
    for (const source of [
      "file:src/a.tsx",
      "file:src/dynamic-eval.cjs",
      "file:src/dynamic-array-reassignment.cjs",
      "file:src/dynamic-object-reassignment.cjs",
      "file:src/dynamic-reassignment.cjs",
      "file:src/dynamic-with.cjs",
      "file:src/hashbang.mjs",
      "file:src/interrupted.ts",
      "file:src/jsx-context.tsx",
      "file:src/lexical-decoys.ts",
      "file:src/nonliteral.ts",
      "file:src/shadow-arrow.cjs",
      "file:src/shadow-block.cjs",
      "file:src/shadow-catch.cjs",
      "file:src/shadow-destructure.cjs",
      "file:src/shadow-function.cjs",
      "file:src/shadow-function-declaration.cjs",
      "file:src/shadow-function-expression.cjs",
      "file:src/shadow-class-declaration.cjs",
      "file:src/shadow-import.mts",
      "file:src/shadow-import-equals.ts",
      "file:src/shadow-local.cjs",
      "file:src/shadow-var-hoist.cjs",
      "file:src/scoped-function-declaration.cjs",
      "file:src/scoped-module.ts",
      "file:src/scoped-static-block.cjs",
    ])
      assert.equal(
        snapshot.edges.some(
          (edge) =>
            edge.from === source &&
            edge.to === "file:src/decoy.ts" &&
            edge.kind === "imports",
        ),
        false,
      );
    assert.ok(this.fixtureRoot);
    for (const [file, content] of [
      [
        "src/annex-b.cjs",
        '<!-- import("./decoy.js")\nmodule.exports = true;\n',
      ],
      ["src/malformed-call.ts", 'import("./decoy.js",\n'],
      [
        "src/malformed-clause.ts",
        'import { function nested() {} } from "./decoy.js";\n',
      ],
      ["src/invalid-unicode.ts", 'import 😀 from "./decoy.js";\n'],
      [
        "src/terminated.ts",
        'import { missing, };\nconst decoy = "./decoy.js";\n',
      ],
    ]) {
      writeFixture(this.fixtureRoot, file, content);
      assert.throws(
        () => buildRepositorySemanticGraph(this.fixtureRoot!),
        new RegExp(`構文解析に失敗.*${file.replace(".", "\\.")}`, "u"),
      );
      fs.rmSync(path.join(this.fixtureRoot, file));
    }
    writeFixture(this.fixtureRoot, "src/token-flood.ts", ";".repeat(250_001));
    assert.throws(
      () => buildRepositorySemanticGraph(this.fixtureRoot!),
      /token件数上限.*src\/token-flood\.ts/u,
    );
    fs.rmSync(path.join(this.fixtureRoot, "src/token-flood.ts"));
    writeFixture(this.fixtureRoot, "src/deep-source.ts", "(".repeat(50_000));
    assert.throws(
      () => buildRepositorySemanticGraph(this.fixtureRoot!),
      /解析resource境界.*src\/deep-source\.ts/u,
    );
  },
);

Given("credential付きoriginを持つ隔離疑似projectがある", function () {
  const root = createModeFixture(this, "Full");
  gitFixture(root, [
    "remote",
    "set-url",
    "origin",
    "https://secret-user:secret-token@example.invalid/org/project.git",
  ]);
});

When("repository identityをsemantic graphへ投影する", function () {
  assert.ok(this.fixtureRoot);
  this.snapshots = [buildRepositorySemanticGraph(this.fixtureRoot)];
});

Then(
  "credentialとremote URLはhash化されたidentityから復元できない",
  function () {
    const snapshot = this.snapshots?.[0];
    assert.ok(snapshot);
    assert.match(snapshot.source.repositoryId, /^remote:[a-f0-9]{64}$/u);
    const serialized = JSON.stringify(snapshot);
    assert.doesNotMatch(
      serialized,
      /secret-user|secret-token|example\.invalid/u,
    );
  },
);

When("Node 20 runtime seamでworkflow stepsを実行する", async function () {
  await runCli(this, ["workflow", "steps"], "20.19.0");
});

Then("非graph CLIは成功しGraph runtimeをloadしない", function () {
  assert.equal(this.cliStatus, 0);
  assert.ok(Array.isArray(this.cliOutput?.steps));
  assert.ok(this.fixtureRoot);
  assert.equal(graphRuntimeExists(this.fixtureRoot), false);
});

When("Node 22.12 runtime seamでgraph installを実行する", async function () {
  assert.ok(this.fixtureRoot);
  try {
    await main(
      ["graph", "install", `--root=${this.fixtureRoot}`, "--dry-run"],
      { nodeVersion: "22.12.0" },
    );
  } catch (error) {
    this.cliError = error instanceof Error ? error.message : String(error);
  }
});

Then("Node下限の理由を返しGraph runtimeを作らない", function () {
  assert.match(this.cliError ?? "", /Node\.js 22\.13\.0以上/u);
  assert.ok(this.fixtureRoot);
  assert.equal(graphRuntimeExists(this.fixtureRoot), false);
});

Then(
  "固定projector capabilityはsnapshotで実際に生成可能なkindだけを宣言する",
  function () {
    const snapshot = this.snapshots?.[0];
    assert.ok(snapshot);
    assert.deepEqual(REPOSITORY_GRAPH_PROJECTOR_CAPABILITY, {
      capabilityVersion:
        "agent-skill-chain/repository-graph-projector-capability/v1",
      materializedNodeKinds: [
        "repository",
        "commit",
        "requirement",
        "acceptance-criteria",
        "design",
        "file",
        "scenario",
        "review",
        "worktree",
      ],
      materializedEdgeKinds: [
        "contains",
        "imports",
        "references",
        "has-acceptance-criteria",
        "verified-by",
        "satisfied-by",
        "supported-by",
      ],
    });
    const capableNodes = new Set<string>(
      REPOSITORY_GRAPH_PROJECTOR_CAPABILITY.materializedNodeKinds,
    );
    const capableEdges = new Set<string>(
      REPOSITORY_GRAPH_PROJECTOR_CAPABILITY.materializedEdgeKinds,
    );
    assert.ok(
      SEMANTIC_NODE_KINDS.some((kind) => !capableNodes.has(kind)),
      "schema vocabularyとprojector capabilityが同一集合になっています",
    );
    assert.ok(
      SEMANTIC_EDGE_KINDS.some((kind) => !capableEdges.has(kind)),
      "schema edge vocabularyとprojector capabilityが同一集合になっています",
    );
    assert.ok(snapshot.nodes.every(({ kind }) => capableNodes.has(kind)));
    assert.ok(snapshot.edges.every(({ kind }) => capableEdges.has(kind)));
  },
);

When("Full要件からtrace edge限定のbounded traversalを実行する", function () {
  assert.ok(this.fixtureRoot);
  const snapshot = buildRepositorySemanticGraph(this.fixtureRoot);
  this.snapshots = [snapshot];
  this.traversal = traverseSemanticGraph(
    snapshot,
    ["requirement:REQ-OBS-FULL-001"],
    {
      direction: "outgoing",
      edgeKinds: ["has-acceptance-criteria", "verified-by", "satisfied-by"],
      budget: {
        maxDepth: 3,
        maxVisitedNodes: 100,
        maxVisitedEdges: 100,
        maxResults: 100,
        maxOperations: 300,
      },
    },
  );
});

Then(
  "Requirement AC Scenario feature implementationへ上限内で到達する",
  function () {
    assert.equal(this.traversal?.status, "complete");
    const reached = new Set(this.traversal?.nodes);
    for (const id of [
      "requirement:REQ-OBS-FULL-001",
      "acceptance-criteria:AC-OBS-FULL-001",
      "scenario:SCN-OBS-FULL-001",
      "file:test/features/full.feature",
      "file:src/full.ts",
    ])
      assert.equal(reached.has(id), true, `${id}へ到達できません`);
    assert.ok((this.traversal?.maxDepthReached ?? 4) <= 3);
    assert.ok((this.traversal?.visitedNodes ?? 101) <= 100);
    assert.ok((this.traversal?.visitedEdges ?? 101) <= 100);
    assert.ok((this.traversal?.operations ?? 301) <= 300);
  },
);

Given("存在しない実装pathを含むtrace rowがある", function () {
  const root = createModeFixture(this, "Full");
  writeFixture(
    root,
    "docs/specs/15_要件追跡/00_追跡表.md",
    [
      "# Missing endpoint trace",
      "",
      "| Requirement | Acceptance | Scenario | Feature | Implementation |",
      "| --- | --- | --- | --- | --- |",
      "| REQ-OBS-FULL-001 | AC-OBS-FULL-001 | SCN-OBS-FULL-001 | `test/features/full.feature` | `src/missing.ts` |",
      "",
    ].join("\n"),
  );
  commitFixture(root, "add missing trace endpoint");
});

Given("trackedな.astroを実装列へ持つtrace rowがある", function () {
  const root = createModeFixture(this, "Full");
  writeFixture(root, "src/pages/index.astro", "<main>Astro page</main>\n");
  writeFixture(
    root,
    "docs/specs/15_要件追跡/00_追跡表.md",
    [
      "# Astro endpoint trace",
      "",
      "| Requirement | Acceptance | Scenario | Feature | Implementation |",
      "| --- | --- | --- | --- | --- |",
      "| REQ-OBS-FULL-001 | AC-OBS-FULL-001 | SCN-OBS-FULL-001 | `test/features/full.feature` | `src/pages/index.astro` |",
      "",
    ].join("\n"),
  );
  commitFixture(root, "add tracked Astro trace endpoint");
});

Given("trackedな.astro.bakを実装列へ持つtrace rowがある", function () {
  const root = createModeFixture(this, "Full");
  writeFixture(root, "src/pages/index.astro.bak", "Astro backup\n");
  writeFixture(
    root,
    "docs/specs/15_要件追跡/00_追跡表.md",
    [
      "# Astro backup endpoint trace",
      "",
      "| Requirement | Acceptance | Scenario | Feature | Implementation |",
      "| --- | --- | --- | --- | --- |",
      "| REQ-OBS-FULL-001 | AC-OBS-FULL-001 | SCN-OBS-FULL-001 | `test/features/full.feature` | `src/pages/index.astro.bak` |",
      "",
    ].join("\n"),
  );
  commitFixture(root, "add tracked Astro backup trace endpoint");
});

Given(
  "path以外のinline codeをFeature列・実装列へ持つtrace rowがある",
  function () {
    const root = createModeFixture(this, "Full");
    writeFixture(root, ".gitignore", "dist/\n");
    writeFixture(root, "AGENTS.md", "# エージェント案内\n");
    writeFixture(
      root,
      "docs/specs/15_要件追跡/00_追跡表.md",
      [
        "# Trace endpoint candidate observation",
        "",
        "| Requirement | Acceptance | Scenario | Feature | Implementation |",
        "| --- | --- | --- | --- | --- |",
        "| REQ-OBS-FULL-001 | AC-OBS-FULL-001 | SCN-OBS-FULL-001 | `test/features/full.feature` `.feature` | `src/full.ts` `src/components/` `src/**/*.css` `ci:quality` `z-index` `.gitignore` `AGENTS.md` |",
        "",
      ].join("\n"),
    );
    commitFixture(root, "add non-path inline code trace endpoints");
  },
);

Given("実在しないpathをFeature列・実装列へ持つtrace rowがある", function () {
  const root = createModeFixture(this, "Full");
  fs.rmSync(path.join(root, "README.md"));
  writeFixture(
    root,
    "docs/specs/15_要件追跡/00_追跡表.md",
    [
      "# Missing trace endpoint candidates",
      "",
      "| Requirement | Acceptance | Scenario | Feature | Implementation |",
      "| --- | --- | --- | --- | --- |",
      "| REQ-OBS-FULL-001 | AC-OBS-FULL-001 | SCN-OBS-FULL-001 | `test/features/full.feature` | `src/proces.ts` `README.md` |",
      "",
    ].join("\n"),
  );
  commitFixture(root, "add missing trace endpoint candidates");
});

When("trace endpoint観測用のsemantic graphを構築する", function () {
  assert.ok(this.fixtureRoot);
  try {
    this.snapshots = [buildRepositorySemanticGraph(this.fixtureRoot)];
  } catch (error) {
    this.cliError = error instanceof Error ? error.message : String(error);
  }
});

Then(".astroのtrace endpointは実在と判定され投影が成立する", function () {
  assert.equal(this.cliError, undefined);
  const snapshot = this.snapshots?.[0];
  assert.ok(snapshot);
  assert.equal(
    snapshot.nodes.some(({ id }) => id === "file:src/pages/index.astro"),
    true,
  );
});

Then(
  ".astro.bakのtrace endpointはstableな診断でfail closedになる",
  function () {
    assert.match(
      this.cliError ?? "",
      /semantic graph projection診断 trace-endpoint-missing: docs\/specs\/15_要件追跡\/00_追跡表\.md:5: 存在しないrepository path=src\/pages\/index\.astro\.bak/u,
    );
  },
);

Then(
  "path以外のinline codeは実在検査の対象にならず投影が成立する",
  function () {
    assert.equal(this.cliError, undefined);
    const snapshot = this.snapshots?.[0];
    assert.ok(snapshot);
    assert.equal(
      snapshot.nodes.some(({ id }) => id === "file:src/full.ts"),
      true,
    );
    for (const candidate of [
      "src/components/",
      "src/**/*.css",
      "ci:quality",
      "z-index",
      ".feature",
    ]) {
      const id = `file:${candidate}`;
      assert.equal(
        snapshot.nodes.some((node) => node.id === id),
        false,
        `${id} nodeが投影されています`,
      );
      assert.equal(
        snapshot.edges.some((edge) => edge.from === id || edge.to === id),
        false,
        `${id} edgeが投影されています`,
      );
    }
  },
);

Then("実在しないpathは既存の診断文言でfail closedになる", function () {
  assert.match(
    this.cliError ?? "",
    /semantic graph projection診断 trace-endpoint-missing: docs\/specs\/15_要件追跡\/00_追跡表\.md:5: 存在しないrepository path=README\.md,src\/proces\.ts/u,
  );
});

When("endpoint不足のsemantic graphを構築する", function () {
  assert.ok(this.fixtureRoot);
  try {
    buildRepositorySemanticGraph(this.fixtureRoot);
  } catch (error) {
    this.cliError = error instanceof Error ? error.message : String(error);
  }
});

Then("stableなtrace endpoint診断でfail closedになる", function () {
  assert.match(
    this.cliError ?? "",
    /semantic graph projection診断 trace-endpoint-missing: docs\/specs\/15_要件追跡\/00_追跡表\.md:5: 存在しないrepository path=src\/missing\.ts/u,
  );
});

Given(
  "trackedなFeatureとImplementationをworking treeから削除したtrace rowがある",
  function () {
    const root = createModeFixture(this, "Full");
    fs.rmSync(path.join(root, "test/features/full.feature"));
    fs.rmSync(path.join(root, "src/full.ts"));
  },
);

Then("削除済みtrace endpointのstableな診断でfail closedになる", function () {
  assert.match(
    this.cliError ?? "",
    /semantic graph projection診断 trace-endpoint-missing: docs\/specs\/15_要件追跡\/00_追跡表\.md:5: 存在しないrepository path=src\/full\.ts,test\/features\/full\.feature/u,
  );
});

Given("ignored stagingにFull modeを持つQuick疑似projectがある", function () {
  const root = createModeFixture(this, "Quick");
  writeFixture(root, ".gitignore", ".agent-skill-chain/tmp/\n");
  commitFixture(root, "ignore transient staging");
  writeFixture(
    root,
    ".agent-skill-chain/tmp/issues/ignored/staging-record.json",
    '{"mode":"full","state":"local-active"}\n',
  );
});

Then(
  "Graph Evidenceのauthorityはnoneでmergeとmodeの許可を持たない",
  function () {
    assert.deepEqual(REPOSITORY_GRAPH_EVIDENCE_AUTHORITY, {
      authority: "none",
      mergeAuthorization: false,
      modeAuthorization: false,
    });
  },
);

Then("ignored stagingのmodeはsnapshotへ投影されない", function () {
  const snapshot = this.snapshots?.[0];
  assert.ok(snapshot);
  assert.equal(
    snapshot.nodes.some(({ sourcePath }) =>
      sourcePath.startsWith(".agent-skill-chain/tmp/issues/ignored/"),
    ),
    false,
  );
  assert.equal(
    snapshot.edges.some(({ sourcePath }) =>
      sourcePath.startsWith(".agent-skill-chain/tmp/issues/ignored/"),
    ),
    false,
  );
});

Then("Quick traceは成立しFull専用成果物nodeは存在しない", function () {
  const snapshot = this.snapshots?.[0];
  assert.ok(snapshot);
  assertDirectModeTrace(snapshot, "Quick");
  assert.equal(
    snapshot.nodes.some(({ kind }) => kind === "design"),
    false,
  );
  assert.equal(
    snapshot.nodes.some(({ sourcePath }) =>
      /(?:^|\/)(?:01_要件定義|02_設計|03_実装計画)\.md$/u.test(sourcePath),
    ),
    false,
  );
});

Given("fresh Graphを持つPoC疑似projectがある", function () {
  const root = createModeFixture(this, "PoC");
  const snapshot = buildRepositorySemanticGraph(root);
  const asset = graphQlLiteAsset("linux", "x64");
  const manifest = graphManifest(snapshot, asset);
  this.snapshots = [snapshot];
  this.freshness = assessGraphFreshness({
    expectedSource: snapshot.source,
    expectedExtensionVersion: GRAPHQLITE_VERSION,
    expectedExtensionSha256: asset.sha256,
    manifest,
    observedGraphContentHash: manifest.graphContentHash,
    observedNodeCount: manifest.nodeCount,
    observedEdgeCount: manifest.edgeCount,
  });
});

When(
  "automatic merge条件とGraph Evidenceを既存delivery gateへ合成する",
  function () {
    assert.equal(this.freshness?.fresh, true);
    assert.equal(this.freshness?.exactEvidenceAllowed, true);
    assert.equal(REPOSITORY_GRAPH_EVIDENCE_AUTHORITY.mergeAuthorization, false);
    this.deliveryContinuation = decideDeliveryContinuation({
      workflowMode: "poc",
      trustedMergeMode: "automatic",
      assistedAuthorityVerified: true,
      mergeReadyVerified: true,
    });
  },
);

Then("PoCはGraph freshnessに関係なくstop-at-prになる", function () {
  assert.equal(this.deliveryContinuation, "stop-at-pr");
});

Given("PoCでFull昇格が必要な実装中発見がある", function () {
  const root = createModeFixture(this, "PoC");
  const poc = buildRepositorySemanticGraph(root);
  const assessment = assessImplementationDiscovery({
    discoveryId: "DISC-OBS-GR-PROMOTION-001",
    workflowMode: "poc",
    modeDisqualifiers: [
      { id: "external-exposure", evidence: "外部公開境界を確認した" },
    ],
    changedContractKinds: ["non-functional"],
    changesGoal: false,
    changesScope: true,
    changesAcceptanceCriteria: true,
    expandsSecurityBoundary: true,
    introducesIrreversibleOperation: false,
  });
  this.snapshots = [poc];
  this.value = assessment;
});

When("Full成果物を補完してrepository graphを完全再構築する", function () {
  assert.ok(this.fixtureRoot);
  const poc = this.snapshots?.[0];
  assert.ok(poc);
  const assessment = this.value as DiscoveryAssessment;
  replacePocFixtureWithFullContract(this.fixtureRoot);
  const full = buildRepositorySemanticGraph(this.fixtureRoot);
  const asset = graphQlLiteAsset("linux", "x64");
  const pocManifest = graphManifest(poc, asset);
  const fullManifest = graphManifest(full, asset);
  this.promotionObservations = {
    assessment,
    poc,
    full,
    oldProjectionFreshness: assessGraphFreshness({
      expectedSource: full.source,
      expectedExtensionVersion: GRAPHQLITE_VERSION,
      expectedExtensionSha256: asset.sha256,
      manifest: pocManifest,
      observedGraphContentHash: pocManifest.graphContentHash,
      observedNodeCount: pocManifest.nodeCount,
      observedEdgeCount: pocManifest.edgeCount,
    }),
    fullProjectionFreshness: assessGraphFreshness({
      expectedSource: full.source,
      expectedExtensionVersion: GRAPHQLITE_VERSION,
      expectedExtensionSha256: asset.sha256,
      manifest: fullManifest,
      observedGraphContentHash: fullManifest.graphContentHash,
      observedNodeCount: fullManifest.nodeCount,
      observedEdgeCount: fullManifest.edgeCount,
    }),
  };
});

Then("旧PoC投影はstaleであり新Full投影として再利用されない", function () {
  const observations = this.promotionObservations;
  assert.ok(observations);
  assert.equal(observations.assessment.disposition, "stop-or-promote-full");
  assert.deepEqual(observations.assessment.promotionArtifacts, [
    "00_要求定義.md",
    "01_要件定義.md",
    "02_設計.md",
    "03_実装計画.md",
  ]);
  assert.equal(observations.oldProjectionFreshness.fresh, false);
  assert.equal(observations.oldProjectionFreshness.exactEvidenceAllowed, false);
  assert.ok(
    observations.oldProjectionFreshness.reasons.includes("source-ahead"),
  );
  assert.equal(observations.fullProjectionFreshness.fresh, true);
  assert.equal(observations.fullProjectionFreshness.exactEvidenceAllowed, true);
  assert.notEqual(
    semanticGraphContentHash(observations.poc),
    semanticGraphContentHash(observations.full),
  );
  assert.equal(
    observations.full.nodes.some(({ id }) => id === "scenario:SCN-OBS-POC-001"),
    false,
  );
  assertDirectModeTrace(observations.full, "Full");
  assert.ok(this.fixtureRoot);
  assert.equal(graphRuntimeExists(this.fixtureRoot), false);
});
