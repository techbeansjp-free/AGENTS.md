import assert from "node:assert/strict";

import {
  DEFAULT_GRAPH_BUDGET,
  GraphFreshnessError,
  MAX_SEMANTIC_GRAPH_EDGES,
  MAX_SEMANTIC_GRAPH_NODES,
  SEMANTIC_GRAPH_BUILDER_VERSION,
  SEMANTIC_GRAPH_SCHEMA_VERSION,
  assessGraphFreshness,
  canonicalSemanticGraph,
  semanticGraphCardinalityErrors,
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
  type SemanticEdgeKind,
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
  cardinalityExactErrors?: string[][];
  cardinalityProbe?: { touched: boolean };
  cardinalityThrowMessages?: string[];
  cardinalityValidation?: string[][];
  canonicalBefore?: string[];
  canonicalHashes?: string[];
  freshnessInput?: Parameters<typeof assessGraphFreshness>[0];
  freshnessResult?: GraphFreshnessResult;
  freshnessError?: GraphFreshnessError;
  graphBudget?: GraphBudget;
  graphSnapshots?: SemanticGraphSnapshot[];
  malformedErrors?: string[];
  sccBudgetResults?: ReturnType<typeof stronglyConnectedComponents>[];
  shortestObservations?: BudgetObservation[];
  shortestResults?: ShortestPathResult[];
  sccResults?: ReturnType<typeof stronglyConnectedComponents>[];
  topologicalResult?: TopologicalResult;
  topologicalResults?: TopologicalResult[];
  traversalObservations?: BudgetObservation[];
  traversalResults?: GraphTraversalResult[];
  oracleGraphs?: SemanticGraphSnapshot[];
  oracleMismatches?: string[];
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
    readonly kind?: SemanticEdgeKind;
    readonly weight?: number;
    readonly sourceLine?: number;
    readonly sourcePath?: string;
  } = {},
): SemanticGraphEdge {
  const certainty = options.certainty ?? "deterministic";
  return {
    id,
    from,
    to,
    kind: options.kind ?? "depends-on",
    certainty,
    ...(certainty === "inferred"
      ? { confidence: options.confidence ?? 0.8 }
      : {}),
    ...(options.weight === undefined ? {} : { weight: options.weight }),
    sourcePath: options.sourcePath ?? "fixtures/semantic-graph.feature",
    ...(options.sourceLine === undefined
      ? {}
      : { sourceLine: options.sourceLine }),
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

function guardedSparseArray<T>(
  length: number,
  probe: { touched: boolean },
): readonly T[] {
  const target: T[] = [];
  target.length = length;
  return new Proxy(target, {
    get(value, property, receiver) {
      if (property !== "length") {
        probe.touched = true;
        throw new Error(
          `cardinality判定前に${String(property)}へアクセスしました`,
        );
      }
      return Reflect.get(value, property, receiver);
    },
  });
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

function binaryOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function oracleOutgoing(
  snapshot: SemanticGraphSnapshot,
): ReadonlyMap<string, readonly SemanticGraphEdge[]> {
  const outgoing = new Map<string, SemanticGraphEdge[]>(
    snapshot.nodes.map(({ id }) => [id, []]),
  );
  for (const edge of snapshot.edges) outgoing.get(edge.from)?.push(edge);
  for (const edges of outgoing.values())
    edges.sort(
      (left, right) =>
        binaryOrder(left.to, right.to) || binaryOrder(left.id, right.id),
    );
  return outgoing;
}

/** Production BFSを呼ばない、小規模Graph専用のreference queue実装。 */
function oracleBfs(
  snapshot: SemanticGraphSnapshot,
  start: string,
): readonly string[] {
  const outgoing = oracleOutgoing(snapshot);
  const result = [start];
  const visited = new Set(result);
  for (let cursor = 0; cursor < result.length; cursor += 1) {
    const current = result[cursor]!;
    for (const edge of outgoing.get(current) ?? []) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      result.push(edge.to);
    }
  }
  return result;
}

/** Floyd-Warshallの到達可能性から相互到達集合を作る独立SCC oracle。 */
function oracleScc(
  snapshot: SemanticGraphSnapshot,
): readonly (readonly string[])[] {
  const nodes = snapshot.nodes.map(({ id }) => id).sort(binaryOrder);
  const position = new Map(nodes.map((node, index) => [node, index]));
  const reachable = nodes.map((_, row) =>
    nodes.map((__, column) => row === column),
  );
  for (const edge of snapshot.edges)
    reachable[position.get(edge.from)!]![position.get(edge.to)!] = true;
  for (let through = 0; through < nodes.length; through += 1)
    for (let from = 0; from < nodes.length; from += 1)
      for (let to = 0; to < nodes.length; to += 1)
        reachable[from]![to] =
          reachable[from]![to]! ||
          (reachable[from]![through]! && reachable[through]![to]!);
  const assigned = new Set<string>();
  const components: string[][] = [];
  for (const node of nodes) {
    if (assigned.has(node)) continue;
    const from = position.get(node)!;
    const component = nodes.filter((candidate) => {
      const to = position.get(candidate)!;
      return reachable[from]![to]! && reachable[to]![from]!;
    });
    for (const member of component) assigned.add(member);
    components.push(component);
  }
  return components;
}

function oracleTopological(snapshot: SemanticGraphSnapshot): {
  readonly order: readonly string[];
  readonly cycles: readonly (readonly string[])[];
} {
  const nodes = snapshot.nodes.map(({ id }) => id).sort(binaryOrder);
  const outgoing = oracleOutgoing(snapshot);
  const indegree = new Map(nodes.map((node) => [node, 0]));
  for (const edge of snapshot.edges)
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  const ready = nodes.filter((node) => indegree.get(node) === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort(binaryOrder);
    const node = ready.shift()!;
    order.push(node);
    for (const edge of outgoing.get(node) ?? []) {
      const next = (indegree.get(edge.to) ?? 0) - 1;
      indegree.set(edge.to, next);
      if (next === 0) ready.push(edge.to);
    }
  }
  const selfLoops = new Set(
    snapshot.edges
      .filter((edge) => edge.from === edge.to)
      .map((edge) => edge.from),
  );
  const cycles = oracleScc(snapshot).filter(
    (component) =>
      component.length > 1 || component.some((node) => selfLoops.has(node)),
  );
  return { order, cycles };
}

/** Non-negative weight向けBellman-Ford。production heap/stateを再利用しない。 */
function oracleShortestDistance(
  snapshot: SemanticGraphSnapshot,
  from: string,
  to: string,
): number | undefined {
  const distance = new Map(
    snapshot.nodes.map(({ id }) => [id, Number.POSITIVE_INFINITY]),
  );
  distance.set(from, 0);
  for (let pass = 1; pass < snapshot.nodes.length; pass += 1) {
    let changed = false;
    for (const edge of snapshot.edges) {
      const candidate = distance.get(edge.from)! + (edge.weight ?? 1);
      if (candidate >= distance.get(edge.to)!) continue;
      distance.set(edge.to, candidate);
      changed = true;
    }
    if (!changed) break;
  }
  const result = distance.get(to);
  return result === undefined || !Number.isFinite(result) ? undefined : result;
}

function fixedSeedSnapshots(
  seed: number,
  count: number,
): SemanticGraphSnapshot[] {
  let state = seed >>> 0;
  const next = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
  return Array.from({ length: count }, (_, graphIndex) => {
    const nodeCount = 2 + (next() % 5);
    const nodeIds = Array.from(
      { length: nodeCount },
      (__, nodeIndex) => `node:${String(graphIndex)}:${String(nodeIndex)}`,
    );
    const edges: SemanticGraphEdge[] = [];
    for (let from = 0; from < nodeCount; from += 1)
      for (let to = 0; to < nodeCount; to += 1) {
        if (next() % 5 !== 0) continue;
        edges.push(
          graphEdge(
            `edge:${String(graphIndex)}:${String(from)}:${String(to)}`,
            nodeIds[from]!,
            nodeIds[to]!,
            { weight: next() % 4 },
          ),
        );
      }
    return graphSnapshot(nodeIds, edges);
  });
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

Given(
  "edge budget 1を超える高次数の無重みGraphと重み付きGraphがある",
  function () {
    const nodeIds = ["node:a", "node:b", "node:c", "node:d"];
    const unweighted = graphSnapshot(nodeIds, [
      graphEdge("edge:a-b", "node:a", "node:b"),
      graphEdge("edge:a-c", "node:a", "node:c"),
      graphEdge("edge:a-d", "node:a", "node:d"),
    ]);
    const weighted = graphSnapshot(
      nodeIds,
      unweighted.edges.map((edge) => ({ ...edge, weight: 1 })),
    );
    this.graphSnapshots = [unweighted, weighted];
    this.graphBudget = budget({ maxVisitedEdges: 1 });
  },
);

When("budget超過listのsortを禁止してBFSとDijkstraを実行する", function () {
  const unweighted = this.graphSnapshots?.[0];
  const weighted = this.graphSnapshots?.[1];
  assert.ok(unweighted);
  assert.ok(weighted);
  assert.ok(this.graphBudget);
  const originalSort = Array.prototype.sort;
  Array.prototype.sort = function <T>(
    this: T[],
    compareFunction?: (left: T, right: T) => number,
  ): T[] {
    if (this.length > 1)
      throw new Error("budget超過listをsortしようとしました");
    return originalSort.call(this, compareFunction);
  };
  try {
    this.traversalResults = [
      traverseSemanticGraph(unweighted, ["node:a"], {
        direction: "outgoing",
        budget: this.graphBudget,
      }),
    ];
    this.shortestResults = [
      shortestSemanticPath(weighted, "node:a", "node:d", {
        budget: this.graphBudget,
      }),
    ];
  } finally {
    Array.prototype.sort = originalSort;
  }
});

Then("両局所探索はsortせずbudget exceededを上限内で返す", function () {
  const traversal = this.traversalResults?.[0];
  const shortest = this.shortestResults?.[0];
  assert.ok(traversal);
  assert.ok(shortest);
  assert.equal(traversal.status, "budget-exceeded");
  assert.equal(shortest.status, "budget-exceeded");
  assert.ok(traversal.visitedEdges <= 1);
  assert.ok(shortest.visitedEdges <= 1);
  assert.equal(shortest.algorithm, "dijkstra");
});

Given(
  "nodeまたはedgeが共通上限と上限プラス1のProxy snapshotがある",
  function () {
    const base = graphSnapshot([], []);
    const probe = { touched: false };
    this.cardinalityProbe = probe;
    this.graphSnapshots = [
      {
        ...base,
        nodes: guardedSparseArray<SemanticGraphNode>(
          MAX_SEMANTIC_GRAPH_NODES + 1,
          probe,
        ),
      },
      {
        ...base,
        edges: guardedSparseArray<SemanticGraphEdge>(
          MAX_SEMANTIC_GRAPH_EDGES + 1,
          probe,
        ),
      },
      {
        ...base,
        nodes: guardedSparseArray<SemanticGraphNode>(
          MAX_SEMANTIC_GRAPH_NODES,
          probe,
        ),
      },
      {
        ...base,
        edges: guardedSparseArray<SemanticGraphEdge>(
          MAX_SEMANTIC_GRAPH_EDGES,
          probe,
        ),
      },
    ];
  },
);

When("全公開Domain入口とcardinality判定へProxy snapshotを渡す", function () {
  const nodeOver = this.graphSnapshots?.[0];
  const edgeOver = this.graphSnapshots?.[1];
  const nodeAtLimit = this.graphSnapshots?.[2];
  const edgeAtLimit = this.graphSnapshots?.[3];
  assert.ok(nodeOver);
  assert.ok(edgeOver);
  assert.ok(nodeAtLimit);
  assert.ok(edgeAtLimit);
  const overLimit = [nodeOver, edgeOver];
  this.cardinalityValidation = overLimit.map((snapshot) =>
    validateSemanticGraphSnapshot(snapshot),
  );
  this.traversalResults = overLimit.map((snapshot) =>
    traverseSemanticGraph(snapshot, [], { direction: "outgoing" }),
  );
  this.sccResults = overLimit.map((snapshot) =>
    stronglyConnectedComponents(snapshot),
  );
  this.topologicalResults = overLimit.map((snapshot) =>
    topologicalSemanticOrder(snapshot),
  );
  this.shortestResults = overLimit.map((snapshot) =>
    shortestSemanticPath(snapshot, "node:a", "node:b"),
  );
  const thrown: string[] = [];
  for (const snapshot of overLimit)
    for (const operation of [
      () => canonicalSemanticGraph(snapshot),
      () => semanticGraphContentHash(snapshot),
    ]) {
      try {
        operation();
        assert.fail("上限超過snapshotが拒否されませんでした");
      } catch (error) {
        thrown.push(error instanceof Error ? error.message : String(error));
      }
    }
  this.cardinalityThrowMessages = thrown;
  this.cardinalityExactErrors = [nodeAtLimit, edgeAtLimit].map((snapshot) =>
    semanticGraphCardinalityErrors(snapshot),
  );
});

Then(
  "上限超過はiteratorへ触れず拒否され上限ちょうどはcardinality判定を通過する",
  function () {
    assert.deepEqual(this.cardinalityValidation, [
      [
        `semantic graph node数が上限${String(MAX_SEMANTIC_GRAPH_NODES)}を超えています`,
      ],
      [
        `semantic graph edge数が上限${String(MAX_SEMANTIC_GRAPH_EDGES)}を超えています`,
      ],
    ]);
    for (const result of this.traversalResults ?? []) {
      assert.equal(result.status, "invalid");
      assert.equal(result.operations, 0);
    }
    for (const result of this.sccResults ?? []) {
      assert.equal(result.status, "invalid");
      assert.equal(result.operations, 0);
    }
    for (const result of this.topologicalResults ?? []) {
      assert.equal(result.status, "invalid");
      assert.equal(result.operations, 0);
      assert.equal(result.evidenceComplete, false);
    }
    for (const result of this.shortestResults ?? []) {
      assert.equal(result.status, "invalid");
      assert.equal(result.operations, 0);
    }
    assert.equal(this.cardinalityThrowMessages?.length, 4);
    for (const message of this.cardinalityThrowMessages ?? [])
      assert.match(message, /semantic graph (?:node|edge)数が上限/u);
    assert.deepEqual(this.cardinalityExactErrors, [[], []]);
    assert.equal(this.cardinalityProbe?.touched, false);
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

Given("operation budget 1に対して孤立した2 nodeがある", function () {
  this.graphSnapshots = [graphSnapshot(["node:b", "node:a"], [])];
  this.graphBudget = budget({ maxOperations: 1 });
});

When("同じoperation budgetでTarjanとKahnを実行する", function () {
  const snapshot = this.graphSnapshots?.[0];
  assert.ok(snapshot);
  assert.ok(this.graphBudget);
  this.sccResults = [
    stronglyConnectedComponents(snapshot, undefined, this.graphBudget),
  ];
  this.topologicalResult = topologicalSemanticOrder(
    snapshot,
    undefined,
    this.graphBudget,
  );
});

Then("両探索はoperation 1で停止し完全Evidenceを返さない", function () {
  const scc = this.sccResults?.[0];
  assert.ok(scc);
  assert.equal(scc.status, "budget-exceeded");
  assert.equal(scc.operations, 1);
  assert.deepEqual(scc.components, []);
  assert.equal(this.topologicalResult?.status, "budget-exceeded");
  assert.equal(this.topologicalResult?.operations, 1);
  assert.equal(this.topologicalResult?.evidenceComplete, false);
  assert.equal(this.topologicalResult?.gateConformant, null);
  assert.deepEqual(this.topologicalResult?.order, []);
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

Given("explicit weight 1だけを持つ意味グラフがある", function () {
  this.graphSnapshots = [
    graphSnapshot(
      ["node:a", "node:b", "node:c"],
      [
        graphEdge("edge:a-b", "node:a", "node:b", { weight: 1 }),
        graphEdge("edge:b-c", "node:b", "node:c", { weight: 1 }),
      ],
    ),
  ];
});

When("explicit weight graphでshortest pathを計算する", function () {
  const snapshot = this.graphSnapshots?.[0];
  assert.ok(snapshot);
  this.shortestResults = [shortestSemanticPath(snapshot, "node:a", "node:c")];
});

Then("explicit weightの存在によりDijkstraで距離2の経路を返す", function () {
  assert.deepEqual(this.shortestResults?.[0], {
    status: "complete",
    algorithm: "dijkstra",
    path: ["node:a", "node:b", "node:c"],
    distance: 2,
    visitedNodes: 3,
    visitedEdges: 2,
    operations: 6,
    reasons: [],
  });
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
  "budget外のedge kindと除外対象inferred edgeを多数持つ意味グラフがある",
  function () {
    const extraNodes = Array.from(
      { length: 8 },
      (_, index) => `node:raw-${String(index)}`,
    );
    this.graphSnapshots = [
      graphSnapshot(
        ["node:a", "node:b", ...extraNodes],
        [
          graphEdge("edge:a-b", "node:a", "node:b"),
          ...extraNodes.map((node, index) =>
            graphEdge(`edge:reference-${String(index)}`, "node:a", node, {
              kind: "references",
            }),
          ),
          ...extraNodes.map((node, index) =>
            graphEdge(`edge:inferred-${String(index)}`, "node:a", node, {
              certainty: "inferred",
            }),
          ),
        ],
      ),
    ];
  },
);

When("deterministic depends-onだけを最小budgetで探索する", function () {
  const snapshot = this.graphSnapshots?.[0];
  assert.ok(snapshot);
  const filteredBudget: GraphBudget = {
    maxDepth: 2,
    maxVisitedNodes: 2,
    maxVisitedEdges: 1,
    maxResults: 2,
    maxOperations: 2,
  };
  this.traversalResults = [
    traverseSemanticGraph(snapshot, ["node:a"], {
      direction: "outgoing",
      edgeKinds: ["depends-on"],
      includeInferred: false,
      budget: filteredBudget,
    }),
  ];
  this.shortestResults = [
    shortestSemanticPath(snapshot, "node:a", "node:b", {
      edgeKinds: ["depends-on"],
      budget: filteredBudget,
    }),
  ];
});

Then(
  "raw snapshotの対象外要素では拒否せず訪問対象だけを数えて完了する",
  function () {
    const result = this.traversalResults?.[0];
    assert.ok(result);
    assert.equal(result.status, "complete");
    assert.deepEqual(result.nodes, ["node:a", "node:b"]);
    assert.equal(result.visitedNodes, 2);
    assert.equal(result.visitedEdges, 1);
    assert.equal(result.operations, 2);
    const shortest = this.shortestResults?.[0];
    assert.ok(shortest);
    assert.equal(shortest.status, "complete");
    assert.deepEqual(shortest.path, ["node:a", "node:b"]);
    assert.equal(shortest.visitedNodes, 2);
    assert.equal(shortest.visitedEdges, 1);
    assert.equal(shortest.operations, 2);
  },
);

Given(
  "inferred edgeの後にdeterministic edgeが続く意味グラフがある",
  function () {
    const snapshot = graphSnapshot(
      ["node:a", "node:b", "node:c", "node:d"],
      [
        graphEdge("edge:a-b", "node:a", "node:b", {
          certainty: "inferred",
          confidence: 0.42,
          sourcePath: "evidence/inference.json",
          sourceLine: 17,
        }),
        graphEdge("edge:b-c", "node:b", "node:c"),
        graphEdge("edge:a-d", "node:a", "node:d"),
      ],
    );
    this.graphSnapshots = [snapshot, reverseSnapshot(snapshot)];
  },
);

When("inferred edgeを明示的に含めて探索する", function () {
  assert.ok(this.graphSnapshots);
  this.traversalResults = this.graphSnapshots.map((snapshot) =>
    traverseSemanticGraph(snapshot, ["node:a"], {
      direction: "outgoing",
      includeInferred: true,
    }),
  );
});

Then(
  "inferred到達結果はconfidenceとsourceを持つcandidateとなり単独authorityを持たない",
  function () {
    const result = this.traversalResults?.[0];
    assert.ok(result);
    assert.deepEqual(result, this.traversalResults?.[1]);
    assert.equal(result.status, "complete");
    assert.deepEqual(result.nodes, ["node:a", "node:b", "node:d", "node:c"]);
    const candidateEdge = {
      id: "edge:a-b",
      from: "node:a",
      to: "node:b",
      kind: "depends-on",
      confidence: 0.42,
      sourcePath: "evidence/inference.json",
      sourceLine: 17,
    } as const;
    assert.deepEqual(result.evidence, [
      {
        nodeId: "node:a",
        classification: "exact",
        gateAuthority: "freshness-required",
        candidateEdges: [],
      },
      {
        nodeId: "node:b",
        classification: "candidate",
        gateAuthority: "never",
        candidateEdges: [candidateEdge],
      },
      {
        nodeId: "node:d",
        classification: "exact",
        gateAuthority: "freshness-required",
        candidateEdges: [],
      },
      {
        nodeId: "node:c",
        classification: "candidate",
        gateAuthority: "never",
        candidateEdges: [candidateEdge],
      },
    ]);
  },
);

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

Given("逆順かつ重複したdrift理由がある", function () {
  this.malformedErrors = [
    "projection-drift",
    "missing",
    "wrong-worktree",
    "missing",
  ];
});

When("typed GraphFreshnessErrorを構築する", function () {
  assert.ok(this.malformedErrors);
  this.freshnessError = new GraphFreshnessError(
    this.malformedErrors as GraphDriftReason[],
  );
});

Then("errorはcanonical reasonsとfail closed recoveryを保持する", function () {
  const error = this.freshnessError;
  assert.ok(error instanceof GraphFreshnessError);
  assert.equal(error.name, "GraphFreshnessError");
  assert.equal(error.code, "GRAPH_FRESHNESS_ERROR");
  assert.equal(error.fresh, false);
  assert.equal(error.exactEvidenceAllowed, false);
  assert.equal(error.recovery, "rebuild");
  assert.deepEqual(error.reasons, [
    "missing",
    "wrong-worktree",
    "projection-drift",
  ]);
  assert.match(error.message, /missing, wrong-worktree, projection-drift/u);
  assert.throws(() => new GraphFreshnessError([]), /drift reasonが必要/u);
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

Given("固定seedから生成した小規模な有向Graph集合がある", function () {
  this.oracleGraphs = fixedSeedSnapshots(0x5eed_2026, 48);
});

When("production探索と独立oracleを各Graphで実行する", function () {
  assert.ok(this.oracleGraphs);
  const mismatches: string[] = [];
  for (const [index, snapshot] of this.oracleGraphs.entries()) {
    const start = snapshot.nodes[0]!.id;
    const destination = snapshot.nodes[snapshot.nodes.length - 1]!.id;
    for (const candidate of [snapshot, reverseSnapshot(snapshot)]) {
      const bfs = traverseSemanticGraph(candidate, [start], {
        direction: "outgoing",
      });
      const expectedBfs = oracleBfs(snapshot, start);
      if (
        bfs.status !== "complete" ||
        JSON.stringify(bfs.nodes) !== JSON.stringify(expectedBfs)
      )
        mismatches.push(`graph ${String(index)} BFS`);

      const scc = stronglyConnectedComponents(candidate);
      const expectedScc = oracleScc(snapshot);
      if (
        scc.status !== "complete" ||
        JSON.stringify(scc.components) !== JSON.stringify(expectedScc)
      )
        mismatches.push(`graph ${String(index)} SCC`);

      const order = topologicalSemanticOrder(candidate);
      const expectedOrder = oracleTopological(snapshot);
      if (
        JSON.stringify(order.order) !== JSON.stringify(expectedOrder.order) ||
        JSON.stringify(order.stronglyConnectedComponents) !==
          JSON.stringify(expectedOrder.cycles) ||
        order.gateConformant !== (expectedOrder.cycles.length === 0)
      )
        mismatches.push(`graph ${String(index)} topological`);

      const shortest = shortestSemanticPath(candidate, start, destination);
      const expectedDistance = oracleShortestDistance(
        snapshot,
        start,
        destination,
      );
      if (
        shortest.status !== "complete" ||
        shortest.distance !== expectedDistance
      )
        mismatches.push(
          `graph ${String(index)} shortest expected=${String(expectedDistance)} actual=${shortest.status}/${String(shortest.distance)} edges=${JSON.stringify(snapshot.edges.map(({ from, to, weight }) => ({ from, to, weight })))}`,
        );
    }
  }
  this.oracleMismatches = mismatches;
});

Then(
  "BFSとSCCとtopological orderとweighted distanceがoracleに一致する",
  function () {
    assert.deepEqual(this.oracleMismatches, []);
  },
);
