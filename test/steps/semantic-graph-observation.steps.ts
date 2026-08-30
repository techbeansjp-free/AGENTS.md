import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  GRAPHQLITE_VERSION,
  graphQlLiteAsset,
  type GraphQlLiteAsset,
} from "../../src/adapters/graphqlite.js";
import { buildRepositorySemanticGraph } from "../../src/adapters/repository-graph.js";
import { main } from "../../src/cli.js";
import {
  DEFAULT_GRAPH_BUDGET,
  SEMANTIC_GRAPH_BUILDER_VERSION,
  SEMANTIC_GRAPH_SCHEMA_VERSION,
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

interface SemanticGraphObservationWorld extends WorkflowWorld {
  algorithmObservations?: AlgorithmObservations;
  asset?: GraphQlLiteAsset;
  cliOutput?: Record<string, unknown>;
  cliStatus?: number;
  cliError?: string;
  freshness?: GraphFreshnessResult;
  fixtureRoot?: string;
  mode?: ObservationMode;
  mutationObservations?: MutationObservations;
  scc?: StronglyConnectedComponentsResult;
  snapshots?: SemanticGraphSnapshot[];
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
  gitFixture(root, ["remote", "add", "origin", FIXED_REMOTE]);
  writeFixture(
    root,
    "docs/specs/02_要件/00_観測要件.md",
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
    const renamed = buildRepositorySemanticGraph(root);
    fs.rmSync(path.join(root, "test/features/full.feature"));
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

Given("TSX JSX CJS CTSのrelative importを持つ疑似projectがある", function () {
  const root = createModeFixture(this, "Full");
  writeFixture(root, "src/a.tsx", 'import "./b.js";\nexport const a = true;\n');
  writeFixture(root, "src/b.jsx", "export const b = true;\n");
  writeFixture(root, "src/c.cjs", 'require("./d");\nmodule.exports = true;\n');
  writeFixture(root, "src/d.cts", "export const d = true;\n");
  commitFixture(root, "add ECMAScript source variants");
});

When("source variantをsemantic graphへ投影する", function () {
  assert.ok(this.fixtureRoot);
  this.snapshots = [buildRepositorySemanticGraph(this.fixtureRoot)];
});

Then("各relative importは実在fileへの決定論的edgeになる", function () {
  const snapshot = this.snapshots?.[0];
  assert.ok(snapshot);
  for (const [from, to] of [
    ["file:src/a.tsx", "file:src/b.jsx"],
    ["file:src/c.cjs", "file:src/d.cts"],
  ])
    assert.ok(
      snapshot.edges.some(
        (edge) =>
          edge.from === from &&
          edge.to === to &&
          edge.kind === "imports" &&
          edge.certainty === "deterministic",
      ),
    );
});

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
