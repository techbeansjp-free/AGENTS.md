import assert from "node:assert/strict";

import {
  DEFAULT_GRAPH_BUDGET,
  SEMANTIC_GRAPH_BUILDER_VERSION,
  SEMANTIC_GRAPH_SCHEMA_VERSION,
  assessGraphFreshness,
  canonicalSemanticGraph,
  semanticGraphContentHash,
  shortestSemanticPath,
  stronglyConnectedComponents,
  topologicalSemanticOrder,
  traverseSemanticGraph,
  validateSemanticGraphSnapshot,
  type GraphBudget,
  type GraphDriftReason,
  type GraphFreshnessResult,
  type GraphProjectionManifest,
  type GraphSourceIdentity,
  type GraphTraversalResult,
  type SemanticGraphEdge,
  type SemanticGraphNode,
  type SemanticGraphSnapshot,
  type ShortestPathResult,
  type TopologicalResult,
} from "../../src/domain/semantic-graph.js";
import { stepDefinitions, WorkflowWorld } from "../support/world.js";

interface BudgetObservation {
  readonly field:
    "maxResults" | "maxVisitedNodes" | "maxVisitedEdges" | "maxOperations";
  readonly limit: number;
  readonly result: GraphTraversalResult | ShortestPathResult;
}

interface SemanticGraphWorld extends WorkflowWorld {
  canonicalBefore?: string[];
  canonicalHashes?: string[];
  freshnessInput?: Parameters<typeof assessGraphFreshness>[0];
  freshnessResult?: GraphFreshnessResult;
  graphBudget?: GraphBudget;
  graphSnapshots?: SemanticGraphSnapshot[];
  malformedErrors?: string[];
  sccBudgetResults?: ReturnType<typeof stronglyConnectedComponents>[];
  shortestObservations?: BudgetObservation[];
  shortestResults?: ShortestPathResult[];
  sccResults?: ReturnType<typeof stronglyConnectedComponents>[];
  topologicalResult?: TopologicalResult;
  traversalObservations?: BudgetObservation[];
  traversalResults?: GraphTraversalResult[];
}

const { Given, When, Then } = stepDefinitions<SemanticGraphWorld>();

const GRAPH_CONTENT_HASH = "9".repeat(64);
const EXTENSION_SHA256 = "e".repeat(64);

const BASE_SOURCE: GraphSourceIdentity = Object.freeze({
  repositoryId: "fixture-repository",
  worktreeId: "1".repeat(64),
  headSha: "a".repeat(40),
  treeSha: "b".repeat(40),
  contentDigest: "c".repeat(64),
  dirty: false,
});

function graphNode(
  id: string,
  properties: Readonly<Record<string, string | number | boolean | null>> = {},
): SemanticGraphNode {
  return {
    id,
    kind: "file",
    certainty: "deterministic",
    sourcePath: "fixtures/semantic-graph.feature",
    properties,
  };
}

function graphEdge(
  id: string,
  from: string,
  to: string,
  options: {
    readonly certainty?: "deterministic" | "inferred";
    readonly confidence?: number;
    readonly weight?: number;
  } = {},
): SemanticGraphEdge {
  const certainty = options.certainty ?? "deterministic";
  return {
    id,
    from,
    to,
    kind: "depends-on",
    certainty,
    ...(certainty === "inferred"
      ? { confidence: options.confidence ?? 0.8 }
      : {}),
    ...(options.weight === undefined ? {} : { weight: options.weight }),
    sourcePath: "fixtures/semantic-graph.feature",
    properties: {},
  };
}

function graphSnapshot(
  nodeIds: readonly string[],
  edges: readonly SemanticGraphEdge[],
  source: GraphSourceIdentity = BASE_SOURCE,
): SemanticGraphSnapshot {
  return {
    schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION,
    builderVersion: SEMANTIC_GRAPH_BUILDER_VERSION,
    source,
    nodes: nodeIds.map((id) => graphNode(id)),
    edges,
  };
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

function budget(overrides: Partial<GraphBudget>): GraphBudget {
  return { ...DEFAULT_GRAPH_BUDGET, ...overrides };
}

function manifest(
  source: GraphSourceIdentity = BASE_SOURCE,
): GraphProjectionManifest {
  return {
    manifestVersion: "agent-skill-chain/graph-projection-manifest/v1",
    graphSchemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION,
    graphBuilderVersion: SEMANTIC_GRAPH_BUILDER_VERSION,
    extensionVersion: "0.6.1",
    extensionSha256: EXTENSION_SHA256,
    source,
    graphContentHash: GRAPH_CONTENT_HASH,
    nodeCount: 4,
    edgeCount: 3,
    generation: 1,
    status: "complete",
    builtAt: "2026-08-30T00:00:00.000Z",
  };
}

function observedValue(
  result: GraphTraversalResult | ShortestPathResult,
  field: BudgetObservation["field"],
): number {
  switch (field) {
    case "maxResults":
      return "nodes" in result ? result.nodes.length : result.path.length;
    case "maxVisitedNodes":
      return result.visitedNodes;
    case "maxVisitedEdges":
      return result.visitedEdges;
    case "maxOperations":
      return result.operations;
  }
}

Given(
  "同じ意味内容を異なる順序とsource identityで持つ2つの意味グラフがある",
  function () {
    const first: SemanticGraphSnapshot = {
      ...graphSnapshot(
        ["file:b", "file:a"],
        [graphEdge("edge:b-a", "file:b", "file:a")],
      ),
      nodes: [
        graphNode("file:b", { z: 2, a: "value" }),
        graphNode("file:a", { second: false, first: true }),
      ],
    };
    const second: SemanticGraphSnapshot = {
      ...reverseSnapshot(first),
      source: {
        ...BASE_SOURCE,
        headSha: "d".repeat(40),
        treeSha: "f".repeat(40),
        contentDigest: "0".repeat(64),
        dirty: true,
      },
      nodes: [...first.nodes].reverse().map((node) => ({
        ...node,
        properties: Object.fromEntries(
          Object.entries(node.properties).reverse(),
        ),
      })),
    };
    this.graphSnapshots = [first, second];
    this.canonicalBefore = [JSON.stringify(first), JSON.stringify(second)];
  },
);

When("意味グラフのcanonical content hashを計算する", function () {
  assert.ok(this.graphSnapshots);
  this.canonicalHashes = this.graphSnapshots.map((snapshot) =>
    semanticGraphContentHash(snapshot),
  );
});

Then("2つのcontent hashは一致し元のsnapshotは変更されない", function () {
  assert.ok(this.graphSnapshots);
  assert.deepEqual(this.canonicalHashes, [
    this.canonicalHashes?.[0],
    this.canonicalHashes?.[0],
  ]);
  assert.match(this.canonicalHashes?.[0] ?? "", /^[a-f0-9]{64}$/u);
  assert.deepEqual(
    this.graphSnapshots.map((snapshot) => JSON.stringify(snapshot)),
    this.canonicalBefore,
  );
  assert.deepEqual(
    canonicalSemanticGraph(this.graphSnapshots[0]!).nodes.map(({ id }) => id),
    ["file:a", "file:b"],
  );
});

Given(
  "locale順とbinary順が異なるproperty keyを持つ2つの意味グラフがある",
  function () {
    const first: SemanticGraphSnapshot = {
      ...graphSnapshot(["node:a"], []),
      nodes: [graphNode("node:a", { ä: 3, z: 2, a: 1 })],
    };
    const second: SemanticGraphSnapshot = {
      ...first,
      nodes: [graphNode("node:a", { a: 1, z: 2, ä: 3 })],
    };
    this.graphSnapshots = [first, second];
  },
);

Then("property keyはbinary順になり2つのcontent hashは一致する", function () {
  assert.ok(this.graphSnapshots);
  assert.deepEqual(
    Object.keys(
      canonicalSemanticGraph(this.graphSnapshots[0]!).nodes[0]!.properties,
    ),
    ["a", "z", "ä"],
  );
  assert.deepEqual(this.canonicalHashes, [
    this.canonicalHashes?.[0],
    this.canonicalHashes?.[0],
  ]);
});

Given("入力順が異なり推論edgeを含む同値な2つの意味グラフがある", function () {
  const snapshot = graphSnapshot(
    ["node:d", "node:c", "node:b", "node:a", "node:z"],
    [
      graphEdge("edge:a-c", "node:a", "node:c"),
      graphEdge("edge:a-b", "node:a", "node:b"),
      graphEdge("edge:b-d", "node:b", "node:d"),
      graphEdge("edge:c-d", "node:c", "node:d"),
      graphEdge("edge:d-a", "node:d", "node:a"),
      graphEdge("edge:a-z", "node:a", "node:z", {
        certainty: "inferred",
      }),
    ],
  );
  this.graphSnapshots = [snapshot, reverseSnapshot(snapshot)];
});

When("確定edgeだけを対象にoutgoing bounded BFSを実行する", function () {
  assert.ok(this.graphSnapshots);
  this.traversalResults = this.graphSnapshots.map((snapshot) =>
    traverseSemanticGraph(snapshot, ["node:a", "node:a"], {
      direction: "outgoing",
      includeInferred: false,
    }),
  );
});

Then("2つのBFS結果は同一の辞書順になり推論edgeを含まない", function () {
  assert.equal(this.traversalResults?.length, 2);
  for (const result of this.traversalResults ?? []) {
    assert.equal(result.status, "complete");
    assert.deepEqual(result.nodes, ["node:a", "node:b", "node:c", "node:d"]);
    assert.equal(result.nodes.includes("node:z"), false);
  }
  assert.deepEqual(this.traversalResults?.[0], this.traversalResults?.[1]);
});

Given("4 nodeの線形な意味グラフがある", function () {
  this.graphSnapshots = [
    graphSnapshot(
      ["node:a", "node:b", "node:c", "node:d"],
      [
        graphEdge("edge:a-b", "node:a", "node:b"),
        graphEdge("edge:b-c", "node:b", "node:c"),
        graphEdge("edge:c-d", "node:c", "node:d"),
      ],
    ),
  ];
});

When("BFSの各hard budgetを個別に最小化して探索する", function () {
  const snapshot = this.graphSnapshots?.[0];
  assert.ok(snapshot);
  const limits: readonly [BudgetObservation["field"], number][] = [
    ["maxResults", 2],
    ["maxVisitedNodes", 2],
    ["maxVisitedEdges", 1],
    ["maxOperations", 1],
  ];
  this.traversalObservations = limits.map(([field, limit]) => ({
    field,
    limit,
    result: traverseSemanticGraph(snapshot, ["node:a"], {
      direction: "outgoing",
      budget: budget({ [field]: limit }),
    }),
  }));
});

Then(
  "各BFSはbudget exceededになり観測値と部分結果が指定上限以内である",
  function () {
    assert.equal(this.traversalObservations?.length, 4);
    for (const observation of this.traversalObservations ?? []) {
      assert.equal(
        observation.result.status,
        "budget-exceeded",
        observation.field,
      );
      assert.ok(
        observedValue(observation.result, observation.field) <=
          observation.limit,
        `${observation.field}がhard limit ${observation.limit}を超えました: ${observedValue(observation.result, observation.field)}`,
      );
      assert.ok(
        "nodes" in observation.result &&
          observation.result.nodes.length <=
            (observation.field === "maxResults"
              ? observation.limit
              : DEFAULT_GRAPH_BUDGET.maxResults),
      );
    }
  },
);

Given("3 nodeの線形な意味グラフがある", function () {
  this.graphSnapshots = [
    graphSnapshot(
      ["node:a", "node:b", "node:c"],
      [
        graphEdge("edge:a-b", "node:a", "node:b"),
        graphEdge("edge:b-c", "node:b", "node:c"),
      ],
    ),
  ];
});

When("max depth 1でoutgoing BFSを実行する", function () {
  const snapshot = this.graphSnapshots?.[0];
  assert.ok(snapshot);
  this.traversalResults = [
    traverseSemanticGraph(snapshot, ["node:a"], {
      direction: "outgoing",
      budget: budget({ maxDepth: 1 }),
    }),
  ];
});

Then("BFSは2 nodeの有界部分結果を返しbudget exceededになる", function () {
  const result = this.traversalResults?.[0];
  assert.ok(result);
  assert.equal(result.status, "budget-exceeded");
  assert.deepEqual(result.nodes, ["node:a", "node:b"]);
  assert.equal(result.maxDepthReached, 1);
});

Given("独立した2つのstart nodeがある", function () {
  this.graphSnapshots = [graphSnapshot(["node:a", "node:b"], [])];
});

When("result budget 1で複数startのBFSを実行する", function () {
  const snapshot = this.graphSnapshots?.[0];
  assert.ok(snapshot);
  this.traversalResults = [
    traverseSemanticGraph(snapshot, ["node:b", "node:a"], {
      direction: "outgoing",
      budget: budget({ maxResults: 1 }),
    }),
  ];
});

Then("BFSは初期result上限を超えずbudget exceededになる", function () {
  const result = this.traversalResults?.[0];
  assert.ok(result);
  assert.equal(result.status, "budget-exceeded");
  assert.ok(result.nodes.length <= 1);
});

Given(
  "入力順が異なるcycleとself loopと孤立nodeの意味グラフがある",
  function () {
    const snapshot = graphSnapshot(
      ["node:d", "node:c", "node:b", "node:a"],
      [
        graphEdge("edge:a-b", "node:a", "node:b"),
        graphEdge("edge:b-a", "node:b", "node:a"),
        graphEdge("edge:b-c", "node:b", "node:c"),
        graphEdge("edge:c-c", "node:c", "node:c"),
      ],
    );
    this.graphSnapshots = [snapshot, reverseSnapshot(snapshot)];
  },
);

When("2つの意味グラフでSCCを計算する", function () {
  assert.ok(this.graphSnapshots);
  this.sccResults = this.graphSnapshots.map((snapshot) =>
    stronglyConnectedComponents(snapshot),
  );
});

Then("SCCは同一かつcomponent内外とも辞書順である", function () {
  assert.equal(this.sccResults?.length, 2);
  for (const result of this.sccResults ?? []) {
    assert.deepEqual(result.reasons, []);
    assert.deepEqual(result.components, [
      ["node:a", "node:b"],
      ["node:c"],
      ["node:d"],
    ]);
  }
  assert.deepEqual(this.sccResults?.[0], this.sccResults?.[1]);
});

Given("SCC budgetごとの反例となる意味グラフがある", function () {
  const cycle = graphSnapshot(
    ["node:a", "node:b"],
    [
      graphEdge("edge:a-b", "node:a", "node:b"),
      graphEdge("edge:b-a", "node:b", "node:a"),
    ],
  );
  const isolated = graphSnapshot(["node:a", "node:b"], []);
  this.graphSnapshots = [cycle, isolated];
});

When("各hard budget付きでSCCを計算する", function () {
  const cycle = this.graphSnapshots?.[0];
  const isolated = this.graphSnapshots?.[1];
  assert.ok(cycle);
  assert.ok(isolated);
  this.sccBudgetResults = [
    stronglyConnectedComponents(
      cycle,
      undefined,
      budget({ maxVisitedNodes: 1 }),
    ),
    stronglyConnectedComponents(
      cycle,
      undefined,
      budget({ maxVisitedEdges: 1 }),
    ),
    stronglyConnectedComponents(cycle, undefined, budget({ maxOperations: 1 })),
    stronglyConnectedComponents(isolated, undefined, budget({ maxResults: 1 })),
  ];
});

Then("各SCC探索はbudget exceededとなり部分結果を上限内に保つ", function () {
  assert.equal(this.sccBudgetResults?.length, 4);
  for (const result of this.sccBudgetResults ?? [])
    assert.equal(result.status, "budget-exceeded");
  assert.ok(
    (this.sccBudgetResults?.[2]?.operations ?? Number.POSITIVE_INFINITY) <= 1,
  );
  assert.ok(
    (this.sccBudgetResults?.[3]?.components.length ??
      Number.POSITIVE_INFINITY) <= 1,
  );
});

Given("複数のready nodeと合流点を持つDAGがある", function () {
  this.graphSnapshots = [
    graphSnapshot(
      ["node:d", "node:c", "node:b", "node:a"],
      [
        graphEdge("edge:a-d", "node:a", "node:d"),
        graphEdge("edge:b-d", "node:b", "node:d"),
      ],
    ),
  ];
});

When("Kahnによるtopological orderを計算する", function () {
  const snapshot = this.graphSnapshots?.[0];
  assert.ok(snapshot);
  this.topologicalResult = topologicalSemanticOrder(snapshot);
});

Then("topological orderは依存関係を守る辞書順で完了する", function () {
  assert.equal(this.topologicalResult?.status, "complete");
  assert.equal(this.topologicalResult?.evidenceComplete, true);
  assert.equal(this.topologicalResult?.gateConformant, true);
  assert.deepEqual(this.topologicalResult?.order, [
    "node:a",
    "node:b",
    "node:c",
    "node:d",
  ]);
  assert.deepEqual(this.topologicalResult?.stronglyConnectedComponents, []);
});

Given("self loopを持つ意味グラフがある", function () {
  this.graphSnapshots = [
    graphSnapshot(
      ["node:a", "node:b"],
      [graphEdge("edge:a-a", "node:a", "node:a")],
    ),
  ];
});

Then(
  "cycle判定はself loopのSCCを欠落させずEvidence完了かつgate不適合になる",
  function () {
    assert.equal(this.topologicalResult?.status, "invalid");
    assert.equal(this.topologicalResult?.evidenceComplete, true);
    assert.equal(this.topologicalResult?.gateConformant, false);
    assert.deepEqual(this.topologicalResult?.stronglyConnectedComponents, [
      ["node:a"],
    ]);
    assert.deepEqual(this.topologicalResult?.reasons, ["cycleを検出しました"]);
  },
);

Given("1 edgeのDAGとoperation budget 1がある", function () {
  this.graphSnapshots = [
    graphSnapshot(
      ["node:a", "node:b"],
      [graphEdge("edge:a-b", "node:a", "node:b")],
    ),
  ];
  this.graphBudget = budget({ maxOperations: 1 });
});

When("operation budget付きKahnを実行する", function () {
  const snapshot = this.graphSnapshots?.[0];
  assert.ok(snapshot);
  assert.ok(this.graphBudget);
  this.topologicalResult = topologicalSemanticOrder(
    snapshot,
    undefined,
    this.graphBudget,
  );
});

Then("Kahnはbudget exceededになりoperation数が指定上限以内である", function () {
  assert.equal(this.topologicalResult?.status, "budget-exceeded");
  assert.equal(this.topologicalResult?.evidenceComplete, false);
  assert.equal(this.topologicalResult?.gateConformant, null);
  assert.ok(
    (this.topologicalResult?.operations ?? Number.POSITIVE_INFINITY) <= 1,
  );
});

Given("2 edgeのDAGとedge budget 1がある", function () {
  this.graphSnapshots = [
    graphSnapshot(
      ["node:a", "node:b", "node:c"],
      [
        graphEdge("edge:a-b", "node:a", "node:b"),
        graphEdge("edge:b-c", "node:b", "node:c"),
      ],
    ),
  ];
  this.graphBudget = budget({ maxVisitedEdges: 1 });
});

When("edge budget付きKahnを実行する", function () {
  const snapshot = this.graphSnapshots?.[0];
  assert.ok(snapshot);
  assert.ok(this.graphBudget);
  this.topologicalResult = topologicalSemanticOrder(
    snapshot,
    undefined,
    this.graphBudget,
  );
});

Then("Kahnはedge budget exceededとなり完全順序を返さない", function () {
  assert.equal(this.topologicalResult?.status, "budget-exceeded");
  assert.ok(
    (this.topologicalResult?.order.length ?? Number.POSITIVE_INFINITY) < 3,
  );
});

Given(
  "入力順が異なる同距離経路を持つ無重みと重み付きの意味グラフがある",
  function () {
    const unweighted = graphSnapshot(
      ["node:d", "node:c", "node:b", "node:a"],
      [
        graphEdge("edge:a-c", "node:a", "node:c"),
        graphEdge("edge:a-b", "node:a", "node:b"),
        graphEdge("edge:c-d", "node:c", "node:d"),
        graphEdge("edge:b-d", "node:b", "node:d"),
      ],
    );
    const weighted = graphSnapshot(
      ["node:d", "node:c", "node:b", "node:a"],
      [
        graphEdge("edge:a-c", "node:a", "node:c", { weight: 1 }),
        graphEdge("edge:a-b", "node:a", "node:b", { weight: 1 }),
        graphEdge("edge:c-d", "node:c", "node:d", { weight: 2 }),
        graphEdge("edge:b-d", "node:b", "node:d", { weight: 2 }),
      ],
    );
    this.graphSnapshots = [
      unweighted,
      reverseSnapshot(unweighted),
      weighted,
      reverseSnapshot(weighted),
    ];
  },
);

When("各意味グラフでshortest pathを計算する", function () {
  assert.ok(this.graphSnapshots);
  this.shortestResults = this.graphSnapshots.map((snapshot) =>
    shortestSemanticPath(snapshot, "node:a", "node:d"),
  );
});

Then("無重みはBFSで重み付きはDijkstraとなり辞書順の同一路を返す", function () {
  assert.equal(this.shortestResults?.length, 4);
  for (const result of this.shortestResults ?? []) {
    assert.equal(result.status, "complete");
    assert.deepEqual(result.path, ["node:a", "node:b", "node:d"]);
    assert.equal(result.distance, result.algorithm === "bfs" ? 2 : 3);
  }
  assert.equal(this.shortestResults?.[0]?.algorithm, "bfs");
  assert.equal(this.shortestResults?.[1]?.algorithm, "bfs");
  assert.equal(this.shortestResults?.[2]?.algorithm, "dijkstra");
  assert.equal(this.shortestResults?.[3]?.algorithm, "dijkstra");
  assert.deepEqual(this.shortestResults?.[0], this.shortestResults?.[1]);
  assert.deepEqual(this.shortestResults?.[2], this.shortestResults?.[3]);
});

Given("3 nodeの最短経路を持つ意味グラフがある", function () {
  this.graphSnapshots = [
    graphSnapshot(
      ["node:a", "node:b", "node:c"],
      [
        graphEdge("edge:a-b", "node:a", "node:b"),
        graphEdge("edge:b-c", "node:b", "node:c"),
      ],
    ),
  ];
});

When("shortest pathの各hard budgetを個別に最小化して探索する", function () {
  const snapshot = this.graphSnapshots?.[0];
  assert.ok(snapshot);
  const limits: readonly [BudgetObservation["field"], number][] = [
    ["maxVisitedNodes", 1],
    ["maxVisitedEdges", 1],
    ["maxOperations", 1],
  ];
  this.shortestObservations = limits.map(([field, limit]) => ({
    field,
    limit,
    result: shortestSemanticPath(snapshot, "node:a", "node:c", {
      budget: budget({ [field]: limit }),
    }),
  }));
});

Then(
  "各shortest pathはbudget exceededになり観測値が指定上限以内である",
  function () {
    assert.equal(this.shortestObservations?.length, 3);
    for (const observation of this.shortestObservations ?? []) {
      assert.equal(
        observation.result.status,
        "budget-exceeded",
        observation.field,
      );
      assert.ok(
        observedValue(observation.result, observation.field) <=
          observation.limit,
        `${observation.field}がhard limit ${observation.limit}を超えました: ${observedValue(observation.result, observation.field)}`,
      );
    }
  },
);

Given(
  "深い安価経路と浅い高価経路が同じ中継nodeへ合流する重み付きグラフがある",
  function () {
    this.graphSnapshots = [
      graphSnapshot(
        ["node:s", "node:a", "node:x", "node:t"],
        [
          graphEdge("edge:s-a", "node:s", "node:a", { weight: 0 }),
          graphEdge("edge:a-x", "node:a", "node:x", { weight: 0 }),
          graphEdge("edge:s-x", "node:s", "node:x", { weight: 5 }),
          graphEdge("edge:x-t", "node:x", "node:t", { weight: 1 }),
        ],
      ),
    ];
  },
);

When("max depth 2でDijkstra shortest pathを計算する", function () {
  const snapshot = this.graphSnapshots?.[0];
  assert.ok(snapshot);
  this.shortestResults = [
    shortestSemanticPath(snapshot, "node:s", "node:t", {
      budget: budget({ maxDepth: 2 }),
    }),
  ];
});

Then("浅い状態を失わずdepth内の最短経路を完全に返す", function () {
  assert.deepEqual(this.shortestResults?.[0], {
    status: "complete",
    algorithm: "dijkstra",
    path: ["node:s", "node:x", "node:t"],
    distance: 6,
    visitedNodes: 4,
    visitedEdges: 4,
    operations: 10,
    reasons: [],
  });
});

Given(
  "累積weightが非有限化または安全上限を超える重み付きグラフがある",
  function () {
    this.graphSnapshots = [
      graphSnapshot(
        ["node:s", "node:a", "node:t"],
        [
          graphEdge("edge:s-a", "node:s", "node:a", {
            weight: Number.MAX_VALUE,
          }),
          graphEdge("edge:a-t", "node:a", "node:t", {
            weight: Number.MAX_VALUE,
          }),
        ],
      ),
      graphSnapshot(
        ["node:s", "node:a", "node:t"],
        [
          graphEdge("edge:s-a", "node:s", "node:a", {
            weight: Number.MAX_SAFE_INTEGER - 1,
          }),
          graphEdge("edge:a-t", "node:a", "node:t", { weight: 2 }),
        ],
      ),
    ];
  },
);

When("overflowする各グラフでDijkstra shortest pathを計算する", function () {
  assert.ok(this.graphSnapshots);
  this.shortestResults = this.graphSnapshots.map((snapshot) =>
    shortestSemanticPath(snapshot, "node:s", "node:t"),
  );
});

Then("各shortest pathはinvalidとなり有限distanceを捏造しない", function () {
  assert.equal(this.shortestResults?.length, 2);
  for (const result of this.shortestResults ?? []) {
    assert.equal(result.status, "invalid");
    assert.equal(result.distance, undefined);
    assert.deepEqual(result.path, []);
    assert.match(result.reasons[0] ?? "", /累積weightが安全上限/u);
  }
});

Given(
  "重複nodeと未解決endpointと負のweightを持つmalformed snapshotがある",
  function () {
    const duplicate = graphNode("node:a");
    this.graphSnapshots = [
      {
        ...graphSnapshot(["node:a"], []),
        nodes: [duplicate, duplicate],
        edges: [
          {
            ...graphEdge("edge:dangling", "node:a", "node:missing"),
            weight: -1,
          },
        ],
      },
    ];
  },
);

When("malformed snapshotを検証してBFSへ渡す", function () {
  const snapshot = this.graphSnapshots?.[0];
  assert.ok(snapshot);
  this.malformedErrors = validateSemanticGraphSnapshot(snapshot);
  this.traversalResults = [
    traverseSemanticGraph(snapshot, ["node:a"], { direction: "outgoing" }),
  ];
});

Then("validatorとBFSは決定論的なinvalid理由を返す", function () {
  assert.ok(
    this.malformedErrors?.some((reason) =>
      reason.includes("node IDが不正または重複"),
    ),
  );
  assert.ok(
    this.malformedErrors?.some((reason) => reason.includes("endpointが未解決")),
  );
  assert.ok(
    this.malformedErrors?.some((reason) => reason.includes("非負有限値")),
  );
  assert.deepEqual(
    this.malformedErrors,
    [...(this.malformedErrors ?? [])].sort(),
  );
  assert.equal(this.traversalResults?.[0]?.status, "invalid");
  assert.deepEqual(this.traversalResults?.[0]?.reasons, this.malformedErrors);
});

Given(
  "redundant segmentを含むnon-canonical provenance pathがある",
  function () {
    const paths = ["fixtures//scenario.feature", "fixtures/./scenario.feature"];
    this.graphSnapshots = paths.map((sourcePath, index) => ({
      ...graphSnapshot([`node:${String(index)}`], []),
      nodes: [
        {
          ...graphNode(`node:${String(index)}`),
          sourcePath,
        },
      ],
    }));
  },
);

When("non-canonical provenance pathを持つsnapshotを検証する", function () {
  assert.ok(this.graphSnapshots);
  this.malformedErrors = this.graphSnapshots.flatMap((snapshot) =>
    validateSemanticGraphSnapshot(snapshot),
  );
});

Then("provenance不正としてfail closedで拒否する", function () {
  assert.equal(this.malformedErrors?.length, 2);
  for (const reason of this.malformedErrors ?? [])
    assert.match(reason, /node provenance\/propertiesが不正/u);
});

Given("dirtyがbooleanでないmalformed source identityがある", function () {
  const malformedSource = {
    ...BASE_SOURCE,
    dirty: "false",
  } as unknown as GraphSourceIdentity;
  this.graphSnapshots = [graphSnapshot(["node:a"], [], malformedSource)];
});

When("malformed source identityを持つsnapshotを検証する", function () {
  const snapshot = this.graphSnapshots?.[0];
  assert.ok(snapshot);
  this.malformedErrors = validateSemanticGraphSnapshot(snapshot);
});

Then("source identity不正として拒否する", function () {
  assert.ok(
    this.malformedErrors?.includes("semantic graph source identityが不正です"),
  );
});

Given("sourceとextensionと実投影hashが完全一致するmanifestがある", function () {
  this.freshnessInput = {
    expectedSource: BASE_SOURCE,
    expectedExtensionVersion: "0.6.1",
    expectedExtensionSha256: EXTENSION_SHA256,
    manifest: manifest(),
    observedGraphContentHash: GRAPH_CONTENT_HASH,
    observedNodeCount: 4,
    observedEdgeCount: 3,
  };
});

When("graph freshnessを評価する", function () {
  assert.ok(this.freshnessInput);
  this.freshnessResult = assessGraphFreshness(this.freshnessInput);
});

Then("graphはfreshでexact Evidenceが許可されrecoveryは不要である", function () {
  assert.deepEqual(this.freshnessResult, {
    fresh: true,
    exactEvidenceAllowed: true,
    reasons: [],
    recovery: "none",
  });
});

Given(
  "sourceとextensionが一致し実投影hashを未観測のmanifestがある",
  function () {
    this.freshnessInput = {
      expectedSource: BASE_SOURCE,
      expectedExtensionVersion: "0.6.1",
      expectedExtensionSha256: EXTENSION_SHA256,
      manifest: manifest(),
    };
  },
);

Then(
  "graphはprojection unverifiedとしてexact Evidenceを許可せずrebuildを要求する",
  function () {
    assert.deepEqual(this.freshnessResult, {
      fresh: false,
      exactEvidenceAllowed: false,
      reasons: ["projection-unverified"],
      recovery: "rebuild",
    });
  },
);

Given(
  "sourceとextensionと実投影hashが一致しcountを未観測のmanifestがある",
  function () {
    this.freshnessInput = {
      expectedSource: BASE_SOURCE,
      expectedExtensionVersion: "0.6.1",
      expectedExtensionSha256: EXTENSION_SHA256,
      manifest: manifest(),
      observedGraphContentHash: GRAPH_CONTENT_HASH,
    };
  },
);

Given("calendar上存在しないISO形式builtAtを持つmanifestがある", function () {
  this.freshnessInput = {
    expectedSource: BASE_SOURCE,
    expectedExtensionVersion: "0.6.1",
    expectedExtensionSha256: EXTENSION_SHA256,
    manifest: {
      ...manifest(),
      builtAt: "2026-02-30T00:00:00.000Z",
    },
    observedGraphContentHash: GRAPH_CONTENT_HASH,
    observedNodeCount: 4,
    observedEdgeCount: 3,
  };
});

Then(
  "graphはcorruptとしてexact Evidenceを許可せずrebuildを要求する",
  function () {
    assert.deepEqual(this.freshnessResult, {
      fresh: false,
      exactEvidenceAllowed: false,
      reasons: ["corrupt"],
      recovery: "rebuild",
    });
  },
);

Given(
  "incompleteとversionとworktreeとsourceとprojectionのdriftを持つmanifestがある",
  function () {
    const staleSource: GraphSourceIdentity = {
      ...BASE_SOURCE,
      worktreeId: "2".repeat(64),
      headSha: "3".repeat(40),
      treeSha: "4".repeat(40),
      contentDigest: "5".repeat(64),
      dirty: true,
    };
    const staleManifest = {
      ...manifest(staleSource),
      status: "building",
      graphSchemaVersion: "agent-skill-chain/semantic-graph/v0",
      graphBuilderVersion: "0",
      extensionVersion: "0.5.0",
      extensionSha256: "6".repeat(64),
      graphContentHash: "7".repeat(64),
    } as unknown as GraphProjectionManifest;
    this.freshnessInput = {
      expectedSource: BASE_SOURCE,
      expectedExtensionVersion: "0.6.1",
      expectedExtensionSha256: EXTENSION_SHA256,
      manifest: staleManifest,
      observedGraphContentHash: GRAPH_CONTENT_HASH,
      observedNodeCount: 4,
      observedEdgeCount: 3,
    };
  },
);

Then("全drift理由が安定順で返りrebuildが要求される", function () {
  assert.deepEqual(this.freshnessResult, {
    fresh: false,
    exactEvidenceAllowed: false,
    reasons: [
      "incomplete",
      "schema-mismatch",
      "builder-mismatch",
      "extension-mismatch",
      "wrong-worktree",
      "source-ahead",
      "projection-drift",
    ],
    recovery: "rebuild",
  });
});

Given(
  "graph storeのread結果が{word}である",
  function (state: "missing" | "corrupt") {
    this.freshnessInput = {
      expectedSource: BASE_SOURCE,
      expectedExtensionVersion: "0.6.1",
      expectedExtensionSha256: EXTENSION_SHA256,
      readError: state,
    };
  },
);

Then(
  "{word}を理由にstaleとなりrebuildが要求される",
  function (reason: GraphDriftReason) {
    assert.deepEqual(this.freshnessResult, {
      fresh: false,
      exactEvidenceAllowed: false,
      reasons: [reason],
      recovery: "rebuild",
    });
  },
);
