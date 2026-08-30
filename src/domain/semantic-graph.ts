import crypto from "node:crypto";

export const SEMANTIC_GRAPH_SCHEMA_VERSION =
  "agent-skill-chain/semantic-graph/v1" as const;
export const SEMANTIC_GRAPH_BUILDER_VERSION = "2" as const;

export const SEMANTIC_NODE_KINDS = Object.freeze([
  "repository",
  "commit",
  "requirement",
  "acceptance-criteria",
  "design",
  "adr",
  "file",
  "symbol",
  "scenario",
  "test",
  "review",
  "finding",
  "evidence",
  "pull-request",
  "merge",
  "workflow-run",
  "capability",
  "worktree",
] as const);

export const SEMANTIC_EDGE_KINDS = Object.freeze([
  "contains",
  "depends-on",
  "imports",
  "references",
  "has-acceptance-criteria",
  "designed-by",
  "decided-by",
  "verified-by",
  "satisfied-by",
  "produces-evidence",
  "reviewed-by",
  "produced-finding",
  "affects",
  "violates",
  "supported-by",
  "merged-as",
] as const);

export type SemanticNodeKind = (typeof SEMANTIC_NODE_KINDS)[number];
export type SemanticEdgeKind = (typeof SEMANTIC_EDGE_KINDS)[number];
export type GraphCertainty = "deterministic" | "inferred";
export type GraphScalar = string | number | boolean | null;

export interface SemanticGraphNode {
  readonly id: string;
  readonly kind: SemanticNodeKind;
  readonly certainty: GraphCertainty;
  readonly confidence?: number;
  readonly sourcePath: string;
  readonly sourceLine?: number;
  readonly properties: Readonly<Record<string, GraphScalar>>;
}

export interface SemanticGraphEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: SemanticEdgeKind;
  readonly certainty: GraphCertainty;
  readonly confidence?: number;
  readonly weight?: number;
  readonly sourcePath: string;
  readonly sourceLine?: number;
  readonly properties: Readonly<Record<string, GraphScalar>>;
}

export interface GraphSourceIdentity {
  readonly repositoryId: string;
  readonly worktreeId: string;
  readonly headSha: string;
  readonly treeSha: string;
  readonly contentDigest: string;
  readonly dirty: boolean;
}

export interface SemanticGraphSnapshot {
  readonly schemaVersion: typeof SEMANTIC_GRAPH_SCHEMA_VERSION;
  readonly builderVersion: typeof SEMANTIC_GRAPH_BUILDER_VERSION;
  readonly source: GraphSourceIdentity;
  readonly nodes: readonly SemanticGraphNode[];
  readonly edges: readonly SemanticGraphEdge[];
}

export interface GraphProjectionManifest {
  readonly manifestVersion: "agent-skill-chain/graph-projection-manifest/v1";
  readonly graphSchemaVersion: typeof SEMANTIC_GRAPH_SCHEMA_VERSION;
  readonly graphBuilderVersion: typeof SEMANTIC_GRAPH_BUILDER_VERSION;
  readonly extensionVersion: string;
  readonly extensionSha256: string;
  readonly source: GraphSourceIdentity;
  readonly graphContentHash: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly generation: number;
  readonly status: "building" | "complete";
  readonly builtAt: string;
}

export interface GraphStoreReadResult {
  readonly manifest: GraphProjectionManifest;
  readonly snapshot: SemanticGraphSnapshot;
}

export interface GraphStorePort {
  replace(
    snapshot: SemanticGraphSnapshot,
    builtAt: string,
  ): Promise<GraphProjectionManifest>;
  read(): Promise<GraphStoreReadResult>;
  close(): Promise<void>;
}

export interface GraphBudget {
  readonly maxDepth: number;
  readonly maxVisitedNodes: number;
  readonly maxVisitedEdges: number;
  readonly maxResults: number;
  readonly maxOperations: number;
}

export const DEFAULT_GRAPH_BUDGET: GraphBudget = Object.freeze({
  maxDepth: 64,
  maxVisitedNodes: 20_000,
  maxVisitedEdges: 100_000,
  maxResults: 10_000,
  maxOperations: 250_000,
});

export const MAX_SEMANTIC_GRAPH_DISTANCE = Number.MAX_SAFE_INTEGER;

export type GraphQueryStatus = "complete" | "budget-exceeded" | "invalid";

export interface GraphTraversalResult {
  readonly status: GraphQueryStatus;
  readonly nodes: readonly string[];
  readonly visitedNodes: number;
  readonly visitedEdges: number;
  readonly operations: number;
  readonly maxDepthReached: number;
  readonly reasons: readonly string[];
}

export interface TopologicalResult {
  readonly status: GraphQueryStatus;
  /** 全対象を走査し、orderまたはcycleをexact Evidenceとして確定できたか。 */
  readonly evidenceComplete: boolean;
  /** true=DAG、false=cycleを立証済み、null=Evidence不足で未確定。 */
  readonly gateConformant: boolean | null;
  readonly order: readonly string[];
  readonly stronglyConnectedComponents: readonly (readonly string[])[];
  readonly operations: number;
  readonly reasons: readonly string[];
}

export interface StronglyConnectedComponentsResult {
  readonly status: GraphQueryStatus;
  readonly components: readonly (readonly string[])[];
  readonly operations: number;
  readonly reasons: readonly string[];
}

export interface ShortestPathResult {
  readonly status: GraphQueryStatus;
  readonly algorithm: "bfs" | "dijkstra";
  readonly path: readonly string[];
  readonly distance?: number;
  readonly visitedNodes: number;
  readonly visitedEdges: number;
  readonly operations: number;
  readonly reasons: readonly string[];
}

export type GraphDriftReason =
  | "missing"
  | "corrupt"
  | "incomplete"
  | "schema-mismatch"
  | "builder-mismatch"
  | "extension-mismatch"
  | "wrong-worktree"
  | "source-ahead"
  | "projection-unverified"
  | "projection-drift";

export interface GraphFreshnessResult {
  readonly fresh: boolean;
  readonly exactEvidenceAllowed: boolean;
  readonly reasons: readonly GraphDriftReason[];
  readonly recovery: "none" | "rebuild";
}

interface IndexedGraph {
  readonly nodes: readonly string[];
  readonly outgoing: ReadonlyMap<string, readonly SemanticGraphEdge[]>;
  readonly incoming: ReadonlyMap<string, readonly SemanticGraphEdge[]>;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableGraphJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((entry) => stableGraphJson(entry)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const fields = Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => compareText(left, right))
      .map(
        ([key, entry]) => `${JSON.stringify(key)}:${stableGraphJson(entry)}`,
      );
    return `{${fields.join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined)
    throw new TypeError("semantic graphにJSON表現できない値が含まれています");
  return encoded;
}

function validSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function validGitOid(value: string): boolean {
  return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value);
}

function validId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 512 &&
    value === value.normalize("NFC") &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function validSourcePath(value: string): boolean {
  const segments = value.split("/");
  return (
    validId(value) &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    segments.every(
      (segment) => segment !== "" && segment !== "." && segment !== "..",
    )
  );
}

function validIsoInstant(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value))
    return false;
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return false;
  const canonical = value.includes(".") ? value : `${value.slice(0, -1)}.000Z`;
  return new Date(instant).toISOString() === canonical;
}

function validConfidence(value: number | undefined): boolean {
  return (
    value === undefined || (Number.isFinite(value) && value >= 0 && value <= 1)
  );
}

function validSourceIdentity(source: GraphSourceIdentity): boolean {
  return (
    validId(source.repositoryId) &&
    validSha256(source.worktreeId) &&
    validGitOid(source.headSha) &&
    validGitOid(source.treeSha) &&
    validSha256(source.contentDigest) &&
    typeof source.dirty === "boolean"
  );
}

function validProperties(
  properties: Readonly<Record<string, GraphScalar>>,
): boolean {
  return Object.entries(properties).every(
    ([key, value]) =>
      validId(key) &&
      (value === null ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))),
  );
}

export function validateSemanticGraphSnapshot(
  snapshot: SemanticGraphSnapshot,
): string[] {
  const errors: string[] = [];
  if (snapshot.schemaVersion !== SEMANTIC_GRAPH_SCHEMA_VERSION)
    errors.push("semantic graph schema versionが不正です");
  if (snapshot.builderVersion !== SEMANTIC_GRAPH_BUILDER_VERSION)
    errors.push("semantic graph builder versionが不正です");
  if (!validSourceIdentity(snapshot.source))
    errors.push("semantic graph source identityが不正です");
  const nodeIds = new Set<string>();
  for (const node of snapshot.nodes) {
    if (!validId(node.id) || nodeIds.has(node.id))
      errors.push(`node IDが不正または重複しています: ${node.id}`);
    nodeIds.add(node.id);
    if (!SEMANTIC_NODE_KINDS.includes(node.kind))
      errors.push(`node kindが不正です: ${String(node.kind)}`);
    if (node.certainty === "deterministic" && node.confidence !== undefined)
      errors.push(`deterministic nodeにconfidenceを指定できません: ${node.id}`);
    if (
      (node.certainty !== "deterministic" && node.certainty !== "inferred") ||
      !validConfidence(node.confidence) ||
      (node.certainty === "inferred" && node.confidence === undefined)
    )
      errors.push(`node certainty/confidenceが不正です: ${node.id}`);
    if (!validSourcePath(node.sourcePath) || !validProperties(node.properties))
      errors.push(`node provenance/propertiesが不正です: ${node.id}`);
    if (
      node.sourceLine !== undefined &&
      (!Number.isInteger(node.sourceLine) || node.sourceLine < 1)
    )
      errors.push(`node source lineが不正です: ${node.id}`);
  }
  const edgeIds = new Set<string>();
  for (const edge of snapshot.edges) {
    if (!validId(edge.id) || edgeIds.has(edge.id))
      errors.push(`edge IDが不正または重複しています: ${edge.id}`);
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to))
      errors.push(`edgeのendpointが未解決です: ${edge.id}`);
    if (!SEMANTIC_EDGE_KINDS.includes(edge.kind))
      errors.push(`edge kindが不正です: ${String(edge.kind)}`);
    if (edge.certainty === "deterministic" && edge.confidence !== undefined)
      errors.push(`deterministic edgeにconfidenceを指定できません: ${edge.id}`);
    if (
      (edge.certainty !== "deterministic" && edge.certainty !== "inferred") ||
      !validConfidence(edge.confidence) ||
      (edge.certainty === "inferred" && edge.confidence === undefined)
    )
      errors.push(`edge certainty/confidenceが不正です: ${edge.id}`);
    if (
      edge.weight !== undefined &&
      (!Number.isFinite(edge.weight) || edge.weight < 0)
    )
      errors.push(`edge weightは非負有限値でなければなりません: ${edge.id}`);
    if (!validSourcePath(edge.sourcePath) || !validProperties(edge.properties))
      errors.push(`edge provenance/propertiesが不正です: ${edge.id}`);
    if (
      edge.sourceLine !== undefined &&
      (!Number.isInteger(edge.sourceLine) || edge.sourceLine < 1)
    )
      errors.push(`edge source lineが不正です: ${edge.id}`);
  }
  return [...new Set(errors)].sort(compareText);
}

function canonicalNode(node: SemanticGraphNode): SemanticGraphNode {
  return {
    id: node.id,
    kind: node.kind,
    certainty: node.certainty,
    ...(node.confidence === undefined ? {} : { confidence: node.confidence }),
    sourcePath: node.sourcePath,
    ...(node.sourceLine === undefined ? {} : { sourceLine: node.sourceLine }),
    properties: Object.fromEntries(
      Object.entries(node.properties).sort(([left], [right]) =>
        compareText(left, right),
      ),
    ),
  };
}

function canonicalEdge(edge: SemanticGraphEdge): SemanticGraphEdge {
  return {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    certainty: edge.certainty,
    ...(edge.confidence === undefined ? {} : { confidence: edge.confidence }),
    ...(edge.weight === undefined ? {} : { weight: edge.weight }),
    sourcePath: edge.sourcePath,
    ...(edge.sourceLine === undefined ? {} : { sourceLine: edge.sourceLine }),
    properties: Object.fromEntries(
      Object.entries(edge.properties).sort(([left], [right]) =>
        compareText(left, right),
      ),
    ),
  };
}

export function canonicalSemanticGraph(
  snapshot: SemanticGraphSnapshot,
): SemanticGraphSnapshot {
  return {
    schemaVersion: snapshot.schemaVersion,
    builderVersion: snapshot.builderVersion,
    source: { ...snapshot.source },
    nodes: snapshot.nodes
      .map(canonicalNode)
      .sort((left, right) => compareText(left.id, right.id)),
    edges: snapshot.edges
      .map(canonicalEdge)
      .sort((left, right) => compareText(left.id, right.id)),
  };
}

export function semanticGraphContentHash(
  snapshot: SemanticGraphSnapshot,
): string {
  const canonical = canonicalSemanticGraph(snapshot);
  return sha256(
    stableGraphJson({
      schemaVersion: canonical.schemaVersion,
      builderVersion: canonical.builderVersion,
      nodes: canonical.nodes,
      edges: canonical.edges,
    }),
  );
}

function validateBudget(budget: GraphBudget): string[] {
  return Object.entries(budget).flatMap(([name, value]) =>
    Number.isInteger(value) && value > 0
      ? []
      : [`${name}は正の整数でなければなりません`],
  );
}

function indexBudgetReason(
  snapshot: SemanticGraphSnapshot,
  budget: GraphBudget,
): string | undefined {
  if (snapshot.nodes.length > budget.maxVisitedNodes)
    return "Graph indexのnode上限に達しました";
  if (snapshot.edges.length > budget.maxVisitedEdges)
    return "Graph indexのedge上限に達しました";
  if (snapshot.nodes.length + snapshot.edges.length > budget.maxOperations)
    return "Graph indexのoperation上限に達しました";
  return undefined;
}

function indexGraph(
  snapshot: SemanticGraphSnapshot,
  edgeKinds: ReadonlySet<SemanticEdgeKind> | undefined,
  includeInferred: boolean,
): IndexedGraph {
  const nodes = snapshot.nodes.map(({ id }) => id).sort(compareText);
  const outgoing = new Map<string, SemanticGraphEdge[]>(
    nodes.map((id) => [id, []]),
  );
  const incoming = new Map<string, SemanticGraphEdge[]>(
    nodes.map((id) => [id, []]),
  );
  for (const edge of snapshot.edges) {
    if (
      (!includeInferred && edge.certainty !== "deterministic") ||
      (edgeKinds !== undefined && !edgeKinds.has(edge.kind))
    )
      continue;
    outgoing.get(edge.from)?.push(edge);
    incoming.get(edge.to)?.push(edge);
  }
  const edgeOrder = (
    left: SemanticGraphEdge,
    right: SemanticGraphEdge,
  ): number =>
    compareText(left.to, right.to) ||
    compareText(left.from, right.from) ||
    compareText(left.id, right.id);
  for (const list of outgoing.values()) list.sort(edgeOrder);
  for (const list of incoming.values()) list.sort(edgeOrder);
  return { nodes, outgoing, incoming };
}

export function traverseSemanticGraph(
  snapshot: SemanticGraphSnapshot,
  starts: readonly string[],
  options: {
    readonly direction: "outgoing" | "incoming";
    readonly edgeKinds?: readonly SemanticEdgeKind[];
    readonly includeInferred?: boolean;
    readonly budget?: GraphBudget;
  },
): GraphTraversalResult {
  const budget = options.budget ?? DEFAULT_GRAPH_BUDGET;
  const budgetReasons = validateBudget(budget);
  if (budgetReasons.length > 0)
    return {
      status: "invalid",
      nodes: [],
      visitedNodes: 0,
      visitedEdges: 0,
      operations: 0,
      maxDepthReached: 0,
      reasons: budgetReasons,
    };
  const indexReason = indexBudgetReason(snapshot, budget);
  if (indexReason !== undefined)
    return {
      status: "budget-exceeded",
      nodes: [],
      visitedNodes: 0,
      visitedEdges: 0,
      operations: 0,
      maxDepthReached: 0,
      reasons: [indexReason],
    };
  const reasons = validateSemanticGraphSnapshot(snapshot);
  const known = new Set(snapshot.nodes.map(({ id }) => id));
  const uniqueStarts = [...new Set(starts)].sort(compareText);
  for (const start of uniqueStarts)
    if (!known.has(start)) reasons.push(`開始nodeが存在しません: ${start}`);
  if (reasons.length > 0)
    return {
      status: "invalid",
      nodes: [],
      visitedNodes: 0,
      visitedEdges: 0,
      operations: 0,
      maxDepthReached: 0,
      reasons: [...new Set(reasons)].sort(compareText),
    };
  const index = indexGraph(
    snapshot,
    options.edgeKinds === undefined ? undefined : new Set(options.edgeKinds),
    options.includeInferred ?? false,
  );
  const initialLimit = Math.min(
    budget.maxVisitedNodes,
    budget.maxResults,
    budget.maxOperations,
  );
  if (uniqueStarts.length > initialLimit) {
    const included = uniqueStarts.slice(0, initialLimit);
    return {
      status: "budget-exceeded",
      nodes: included,
      visitedNodes: included.length,
      visitedEdges: 0,
      operations: included.length,
      maxDepthReached: 0,
      reasons: ["開始node集合が探索budgetを超えました"],
    };
  }
  const visited = new Set(uniqueStarts);
  const queue = uniqueStarts.map((node) => ({ node, depth: 0 }));
  const result = [...uniqueStarts];
  let cursor = 0;
  let visitedEdges = 0;
  let operations = uniqueStarts.length;
  let maxDepthReached = 0;
  const exceed = (reason: string): GraphTraversalResult => ({
    status: "budget-exceeded",
    nodes: result,
    visitedNodes: visited.size,
    visitedEdges,
    operations,
    maxDepthReached,
    reasons: [reason],
  });
  while (cursor < queue.length) {
    const current = queue[cursor++];
    if (!current) break;
    maxDepthReached = Math.max(maxDepthReached, current.depth);
    const edges =
      options.direction === "outgoing"
        ? (index.outgoing.get(current.node) ?? [])
        : (index.incoming.get(current.node) ?? []);
    if (current.depth >= budget.maxDepth) {
      const hasUnvisitedNeighbor = edges.some((edge) => {
        const next = options.direction === "outgoing" ? edge.to : edge.from;
        return !visited.has(next);
      });
      if (hasUnvisitedNeighbor) return exceed("探索depth上限に達しました");
      continue;
    }
    for (const edge of edges) {
      if (visitedEdges >= budget.maxVisitedEdges)
        return exceed("探索edge上限に達しました");
      if (operations >= budget.maxOperations)
        return exceed("探索operation上限に達しました");
      visitedEdges += 1;
      operations += 1;
      const next = options.direction === "outgoing" ? edge.to : edge.from;
      if (visited.has(next)) continue;
      if (visited.size >= budget.maxVisitedNodes)
        return exceed("探索node上限に達しました");
      if (result.length >= budget.maxResults)
        return exceed("探索result上限に達しました");
      visited.add(next);
      result.push(next);
      queue.push({ node: next, depth: current.depth + 1 });
    }
  }
  return {
    status: "complete",
    nodes: result,
    visitedNodes: visited.size,
    visitedEdges,
    operations,
    maxDepthReached,
    reasons: [],
  };
}

class MinHeap<T> {
  readonly #values: T[] = [];
  readonly #compare: (left: T, right: T) => number;

  constructor(compare: (left: T, right: T) => number) {
    this.#compare = compare;
  }

  get size(): number {
    return this.#values.length;
  }

  push(value: T): void {
    this.#values.push(value);
    let index = this.#values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.#compare(this.#values[index]!, this.#values[parent]!) >= 0)
        break;
      [this.#values[index], this.#values[parent]] = [
        this.#values[parent]!,
        this.#values[index]!,
      ];
      index = parent;
    }
  }

  pop(): T | undefined {
    const first = this.#values[0];
    const last = this.#values.pop();
    if (this.#values.length > 0 && last !== undefined) {
      this.#values[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (
          left < this.#values.length &&
          this.#compare(this.#values[left]!, this.#values[smallest]!) < 0
        )
          smallest = left;
        if (
          right < this.#values.length &&
          this.#compare(this.#values[right]!, this.#values[smallest]!) < 0
        )
          smallest = right;
        if (smallest === index) break;
        [this.#values[index], this.#values[smallest]] = [
          this.#values[smallest]!,
          this.#values[index]!,
        ];
        index = smallest;
      }
    }
    return first;
  }
}

export function stronglyConnectedComponents(
  snapshot: SemanticGraphSnapshot,
  edgeKinds?: readonly SemanticEdgeKind[],
  budget: GraphBudget = DEFAULT_GRAPH_BUDGET,
): StronglyConnectedComponentsResult {
  const budgetReasons = validateBudget(budget);
  if (budgetReasons.length > 0)
    return {
      status: "invalid",
      components: [],
      operations: 0,
      reasons: budgetReasons,
    };
  const indexReason = indexBudgetReason(snapshot, budget);
  if (indexReason !== undefined)
    return {
      status: "budget-exceeded",
      components: [],
      operations: 0,
      reasons: [indexReason],
    };
  const reasons = validateSemanticGraphSnapshot(snapshot);
  if (reasons.length > 0)
    return { status: "invalid", components: [], operations: 0, reasons };
  const index = indexGraph(
    snapshot,
    edgeKinds === undefined ? undefined : new Set(edgeKinds),
    false,
  );
  const edgeCount = [...index.outgoing.values()].reduce(
    (total, edges) => total + edges.length,
    0,
  );
  if (
    index.nodes.length > budget.maxVisitedNodes ||
    edgeCount > budget.maxVisitedEdges ||
    edgeCount > budget.maxOperations
  )
    return {
      status: "budget-exceeded",
      components: [],
      operations: 0,
      reasons: ["SCC探索budgetに達しました"],
    };
  const indices = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const tarjanStack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  let nextIndex = 0;
  let operations = 0;
  interface Frame {
    node: string;
    parent?: string;
    edges: readonly SemanticGraphEdge[];
    cursor: number;
  }
  for (const start of index.nodes) {
    if (indices.has(start)) continue;
    const frames: Frame[] = [];
    const enter = (node: string, parent?: string): void => {
      indices.set(node, nextIndex);
      lowLink.set(node, nextIndex);
      nextIndex += 1;
      tarjanStack.push(node);
      onStack.add(node);
      frames.push({
        node,
        parent,
        edges: index.outgoing.get(node) ?? [],
        cursor: 0,
      });
    };
    enter(start);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const edge = frame.edges[frame.cursor];
      if (edge !== undefined) {
        frame.cursor += 1;
        operations += 1;
        if (!indices.has(edge.to)) {
          enter(edge.to, frame.node);
          continue;
        }
        if (onStack.has(edge.to))
          lowLink.set(
            frame.node,
            Math.min(lowLink.get(frame.node)!, indices.get(edge.to)!),
          );
        continue;
      }
      frames.pop();
      if (frame.parent !== undefined)
        lowLink.set(
          frame.parent,
          Math.min(lowLink.get(frame.parent)!, lowLink.get(frame.node)!),
        );
      if (lowLink.get(frame.node) === indices.get(frame.node)) {
        const component: string[] = [];
        while (tarjanStack.length > 0) {
          const member = tarjanStack.pop()!;
          onStack.delete(member);
          component.push(member);
          if (member === frame.node) break;
        }
        if (components.length >= budget.maxResults)
          return {
            status: "budget-exceeded",
            components,
            operations,
            reasons: ["SCC result上限に達しました"],
          };
        components.push(component.sort(compareText));
      }
    }
  }
  return {
    status: "complete",
    components: components.sort((left, right) =>
      compareText(left[0] ?? "", right[0] ?? ""),
    ),
    operations,
    reasons: [],
  };
}

export function topologicalSemanticOrder(
  snapshot: SemanticGraphSnapshot,
  edgeKinds?: readonly SemanticEdgeKind[],
  budget: GraphBudget = DEFAULT_GRAPH_BUDGET,
): TopologicalResult {
  const budgetReasons = validateBudget(budget);
  if (budgetReasons.length > 0)
    return {
      status: "invalid",
      evidenceComplete: false,
      gateConformant: null,
      order: [],
      stronglyConnectedComponents: [],
      operations: 0,
      reasons: budgetReasons,
    };
  const indexReason = indexBudgetReason(snapshot, budget);
  if (indexReason !== undefined)
    return {
      status: "budget-exceeded",
      evidenceComplete: false,
      gateConformant: null,
      order: [],
      stronglyConnectedComponents: [],
      operations: 0,
      reasons: [indexReason],
    };
  const reasons = validateSemanticGraphSnapshot(snapshot);
  if (reasons.length > 0)
    return {
      status: "invalid",
      evidenceComplete: false,
      gateConformant: null,
      order: [],
      stronglyConnectedComponents: [],
      operations: 0,
      reasons,
    };
  const index = indexGraph(
    snapshot,
    edgeKinds === undefined ? undefined : new Set(edgeKinds),
    false,
  );
  if (
    index.nodes.length > budget.maxVisitedNodes ||
    index.nodes.length > budget.maxResults
  )
    return {
      status: "budget-exceeded",
      evidenceComplete: false,
      gateConformant: null,
      order: [],
      stronglyConnectedComponents: [],
      operations: 0,
      reasons: ["topological sortのnode/result上限に達しました"],
    };
  const indegree = new Map(index.nodes.map((node) => [node, 0]));
  let operations = 0;
  for (const edges of index.outgoing.values())
    for (const edge of edges) {
      if (operations >= budget.maxVisitedEdges)
        return {
          status: "budget-exceeded",
          evidenceComplete: false,
          gateConformant: null,
          order: [],
          stronglyConnectedComponents: [],
          operations,
          reasons: ["topological sortのedge上限に達しました"],
        };
      if (operations >= budget.maxOperations)
        return {
          status: "budget-exceeded",
          evidenceComplete: false,
          gateConformant: null,
          order: [],
          stronglyConnectedComponents: [],
          operations,
          reasons: ["topological sortのoperation上限に達しました"],
        };
      indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
      operations += 1;
    }
  const ready = new MinHeap<string>(compareText);
  for (const node of index.nodes)
    if (indegree.get(node) === 0) ready.push(node);
  const order: string[] = [];
  while (ready.size > 0) {
    if (operations >= budget.maxOperations)
      return {
        status: "budget-exceeded",
        evidenceComplete: false,
        gateConformant: null,
        order,
        stronglyConnectedComponents: [],
        operations,
        reasons: ["topological sortのoperation上限に達しました"],
      };
    const node = ready.pop()!;
    order.push(node);
    operations += 1;
    for (const edge of index.outgoing.get(node) ?? []) {
      const next = (indegree.get(edge.to) ?? 0) - 1;
      indegree.set(edge.to, next);
      if (next === 0) ready.push(edge.to);
    }
  }
  if (order.length === index.nodes.length)
    return {
      status: "complete",
      evidenceComplete: true,
      gateConformant: true,
      order,
      stronglyConnectedComponents: [],
      operations,
      reasons: [],
    };
  const eligibleEdgeCount = [...index.outgoing.values()].reduce(
    (total, edges) => total + edges.length,
    0,
  );
  if (operations + eligibleEdgeCount > budget.maxOperations)
    return {
      status: "budget-exceeded",
      evidenceComplete: false,
      gateConformant: null,
      order,
      stronglyConnectedComponents: [],
      operations,
      reasons: ["cycle診断のoperation上限に達しました"],
    };
  const scc = stronglyConnectedComponents(snapshot, edgeKinds, {
    ...budget,
    maxOperations: budget.maxOperations - operations,
  });
  if (scc.status === "budget-exceeded")
    return {
      status: "budget-exceeded",
      evidenceComplete: false,
      gateConformant: null,
      order,
      stronglyConnectedComponents: [],
      operations: operations + scc.operations,
      reasons: scc.reasons,
    };
  const selfLoops = new Set(
    [...index.outgoing.values()]
      .flat()
      .filter((edge) => edge.from === edge.to)
      .map((edge) => edge.from),
  );
  const cycles = scc.components.filter(
    (component) =>
      component.length > 1 || component.some((node) => selfLoops.has(node)),
  );
  return {
    status: "invalid",
    evidenceComplete: true,
    gateConformant: false,
    order,
    stronglyConnectedComponents: cycles,
    operations: operations + scc.operations,
    reasons: ["cycleを検出しました"],
  };
}

export function shortestSemanticPath(
  snapshot: SemanticGraphSnapshot,
  from: string,
  to: string,
  options: {
    readonly edgeKinds?: readonly SemanticEdgeKind[];
    readonly budget?: GraphBudget;
  } = {},
): ShortestPathResult {
  const budget = options.budget ?? DEFAULT_GRAPH_BUDGET;
  const budgetReasons = validateBudget(budget);
  if (budgetReasons.length > 0)
    return {
      status: "invalid",
      algorithm: "bfs",
      path: [],
      visitedNodes: 0,
      visitedEdges: 0,
      operations: 0,
      reasons: budgetReasons,
    };
  const indexReason = indexBudgetReason(snapshot, budget);
  if (indexReason !== undefined)
    return {
      status: "budget-exceeded",
      algorithm: "bfs",
      path: [],
      visitedNodes: 0,
      visitedEdges: 0,
      operations: 0,
      reasons: [indexReason],
    };
  const reasons = validateSemanticGraphSnapshot(snapshot);
  const known = new Set(snapshot.nodes.map(({ id }) => id));
  if (!known.has(from)) reasons.push(`開始nodeが存在しません: ${from}`);
  if (!known.has(to)) reasons.push(`終了nodeが存在しません: ${to}`);
  if (reasons.length > 0)
    return {
      status: "invalid",
      algorithm: "bfs",
      path: [],
      visitedNodes: 0,
      visitedEdges: 0,
      operations: 0,
      reasons,
    };
  const index = indexGraph(
    snapshot,
    options.edgeKinds === undefined ? undefined : new Set(options.edgeKinds),
    false,
  );
  const weighted = [...index.outgoing.values()].some((edges) =>
    edges.some((edge) => edge.weight !== undefined && edge.weight !== 1),
  );
  let visitedNodes = 1;
  let visitedEdges = 0;
  let operations = 1;
  const algorithm = weighted ? "dijkstra" : "bfs";
  const predecessor = new Map<string, { node: string; edge: string }>();
  const budgetResult = (reason: string): ShortestPathResult => ({
    status: "budget-exceeded",
    algorithm,
    path: [],
    visitedNodes,
    visitedEdges,
    operations,
    reasons: [reason],
  });
  const buildPath = (): readonly string[] | undefined => {
    const path = [to];
    while (path[0] !== from) {
      const previous = predecessor.get(path[0]!);
      if (!previous) return undefined;
      path.unshift(previous.node);
    }
    return path;
  };
  if (from === to)
    return {
      status: "complete",
      algorithm,
      path: [from],
      distance: 0,
      visitedNodes,
      visitedEdges,
      operations,
      reasons: [],
    };

  if (!weighted) {
    const discovered = new Set([from]);
    const queue: { node: string; depth: number }[] = [{ node: from, depth: 0 }];
    let cursor = 0;
    let found = false;
    while (cursor < queue.length && !found) {
      const current = queue[cursor++]!;
      const edges = index.outgoing.get(current.node) ?? [];
      if (current.depth >= budget.maxDepth) {
        if (edges.some((edge) => !discovered.has(edge.to)))
          return budgetResult("最短経路のdepth上限に達しました");
        continue;
      }
      for (const edge of edges) {
        if (visitedEdges >= budget.maxVisitedEdges)
          return budgetResult("最短経路のedge上限に達しました");
        if (operations >= budget.maxOperations)
          return budgetResult("最短経路のoperation上限に達しました");
        visitedEdges += 1;
        operations += 1;
        if (discovered.has(edge.to)) continue;
        if (visitedNodes >= budget.maxVisitedNodes)
          return budgetResult("最短経路のnode上限に達しました");
        discovered.add(edge.to);
        visitedNodes += 1;
        predecessor.set(edge.to, { node: current.node, edge: edge.id });
        queue.push({ node: edge.to, depth: current.depth + 1 });
        if (edge.to === to) {
          found = true;
          break;
        }
      }
    }
    if (!found)
      return {
        status: "complete",
        algorithm,
        path: [],
        visitedNodes,
        visitedEdges,
        operations,
        reasons: ["到達可能な経路がありません"],
      };
    const path = buildPath();
    if (path === undefined)
      return {
        status: "invalid",
        algorithm,
        path: [],
        visitedNodes,
        visitedEdges,
        operations,
        reasons: ["predecessor chainが不完全です"],
      };
    if (path.length > budget.maxResults)
      return budgetResult("最短経路のresult上限に達しました");
    return {
      status: "complete",
      algorithm,
      path,
      distance: path.length - 1,
      visitedNodes,
      visitedEdges,
      operations,
      reasons: [],
    };
  }

  interface WeightedState {
    readonly key: string;
    readonly node: string;
    readonly distance: number;
    readonly depth: number;
    readonly pathKey: string;
  }
  const weightedStateKey = (node: string, depth: number): string =>
    `${String(depth)}\u0000${node}`;
  const startKey = weightedStateKey(from, 0);
  const startState: WeightedState = {
    key: startKey,
    node: from,
    distance: 0,
    depth: 0,
    pathKey: from,
  };
  const state = new Map<string, WeightedState>([[startKey, startState]]);
  const heap = new MinHeap<WeightedState>(
    (left, right) =>
      left.distance - right.distance ||
      compareText(left.pathKey, right.pathKey) ||
      compareText(left.node, right.node) ||
      left.depth - right.depth,
  );
  heap.push(startState);
  const settledStates = new Set<string>();
  const settledNodes = new Set<string>();
  const weightedPredecessor = new Map<
    string,
    { readonly stateKey: string; readonly node: string; readonly edge: string }
  >();
  const invalidWeightedResult = (reason: string): ShortestPathResult => ({
    status: "invalid",
    algorithm,
    path: [],
    visitedNodes,
    visitedEdges,
    operations,
    reasons: [reason],
  });
  const buildWeightedPath = (
    destinationStateKey: string,
  ): readonly string[] | undefined => {
    const path = [to];
    let cursor = destinationStateKey;
    while (cursor !== startKey) {
      const previous = weightedPredecessor.get(cursor);
      if (previous === undefined) return undefined;
      path.unshift(previous.node);
      cursor = previous.stateKey;
    }
    return path;
  };
  let depthLimitReached = false;
  let reachedStateKey: string | undefined;
  let reachedDistance: number | undefined;
  while (heap.size > 0) {
    if (operations >= budget.maxOperations)
      return budgetResult("最短経路のoperation上限に達しました");
    const current = heap.pop()!;
    operations += 1;
    const best = state.get(current.key);
    if (
      best?.distance !== current.distance ||
      best.pathKey !== current.pathKey ||
      settledStates.has(current.key)
    )
      continue;
    settledStates.add(current.key);
    if (!settledNodes.has(current.node)) {
      if (settledNodes.size >= budget.maxVisitedNodes)
        return budgetResult("最短経路のnode上限に達しました");
      settledNodes.add(current.node);
      visitedNodes = settledNodes.size;
    }
    if (current.node === to) {
      reachedStateKey = current.key;
      reachedDistance = current.distance;
      break;
    }
    const edges = index.outgoing.get(current.node) ?? [];
    if (current.depth >= budget.maxDepth) {
      if (edges.some((edge) => !settledNodes.has(edge.to)))
        depthLimitReached = true;
      continue;
    }
    for (const edge of edges) {
      if (visitedEdges >= budget.maxVisitedEdges)
        return budgetResult("最短経路のedge上限に達しました");
      if (operations >= budget.maxOperations)
        return budgetResult("最短経路のoperation上限に達しました");
      visitedEdges += 1;
      operations += 1;
      const edgeWeight = edge.weight ?? 1;
      if (
        current.distance > MAX_SEMANTIC_GRAPH_DISTANCE - edgeWeight ||
        !Number.isFinite(current.distance + edgeWeight)
      )
        return invalidWeightedResult(
          `最短経路の累積weightが安全上限を超えました: ${edge.id}`,
        );
      const nextDepth = current.depth + 1;
      const key = weightedStateKey(edge.to, nextDepth);
      const candidate: WeightedState = {
        key,
        node: edge.to,
        distance: current.distance + edgeWeight,
        depth: nextDepth,
        pathKey: `${current.pathKey}\u0000${edge.to}\u0000${edge.id}`,
      };
      const previous = state.get(key);
      if (
        previous === undefined ||
        candidate.distance < previous.distance ||
        (candidate.distance === previous.distance &&
          compareText(candidate.pathKey, previous.pathKey) < 0)
      ) {
        state.set(key, candidate);
        weightedPredecessor.set(key, {
          stateKey: current.key,
          node: current.node,
          edge: edge.id,
        });
        heap.push(candidate);
      }
    }
  }
  if (reachedDistance === undefined) {
    if (depthLimitReached)
      return budgetResult("最短経路のdepth上限に達しました");
    return {
      status: "complete",
      algorithm,
      path: [],
      visitedNodes,
      visitedEdges,
      operations,
      reasons: ["到達可能な経路がありません"],
    };
  }
  const path =
    reachedStateKey === undefined
      ? undefined
      : buildWeightedPath(reachedStateKey);
  if (path === undefined)
    return {
      status: "invalid",
      algorithm,
      path: [],
      visitedNodes,
      visitedEdges,
      operations,
      reasons: ["predecessor chainが不完全です"],
    };
  if (path.length > budget.maxResults)
    return budgetResult("最短経路のresult上限に達しました");
  return {
    status: "complete",
    algorithm,
    path,
    distance: reachedDistance,
    visitedNodes,
    visitedEdges,
    operations,
    reasons: [],
  };
}

export function assessGraphFreshness(input: {
  readonly expectedSource: GraphSourceIdentity;
  readonly expectedExtensionVersion: string;
  readonly expectedExtensionSha256: string;
  readonly manifest?: GraphProjectionManifest;
  readonly observedGraphContentHash?: string;
  readonly observedNodeCount?: number;
  readonly observedEdgeCount?: number;
  readonly readError?: "missing" | "corrupt";
}): GraphFreshnessResult {
  const reasons: GraphDriftReason[] = [];
  if (input.readError !== undefined) reasons.push(input.readError);
  const manifest = input.manifest;
  if (manifest === undefined && input.readError === undefined)
    reasons.push("missing");
  if (manifest !== undefined) {
    if (
      manifest.manifestVersion !==
        "agent-skill-chain/graph-projection-manifest/v1" ||
      !validSha256(manifest.extensionSha256) ||
      !validSha256(manifest.graphContentHash) ||
      !validSourceIdentity(manifest.source) ||
      !Number.isInteger(manifest.nodeCount) ||
      manifest.nodeCount < 0 ||
      !Number.isInteger(manifest.edgeCount) ||
      manifest.edgeCount < 0 ||
      !Number.isInteger(manifest.generation) ||
      manifest.generation < 1 ||
      !validIsoInstant(manifest.builtAt)
    )
      reasons.push("corrupt");
    if (manifest.status !== "complete") reasons.push("incomplete");
    if (manifest.graphSchemaVersion !== SEMANTIC_GRAPH_SCHEMA_VERSION)
      reasons.push("schema-mismatch");
    if (manifest.graphBuilderVersion !== SEMANTIC_GRAPH_BUILDER_VERSION)
      reasons.push("builder-mismatch");
    if (
      manifest.extensionVersion !== input.expectedExtensionVersion ||
      manifest.extensionSha256 !== input.expectedExtensionSha256
    )
      reasons.push("extension-mismatch");
    if (manifest.source.worktreeId !== input.expectedSource.worktreeId)
      reasons.push("wrong-worktree");
    if (
      manifest.source.repositoryId !== input.expectedSource.repositoryId ||
      manifest.source.headSha !== input.expectedSource.headSha ||
      manifest.source.treeSha !== input.expectedSource.treeSha ||
      manifest.source.contentDigest !== input.expectedSource.contentDigest ||
      manifest.source.dirty !== input.expectedSource.dirty
    )
      reasons.push("source-ahead");
    if (
      input.observedGraphContentHash === undefined ||
      input.observedNodeCount === undefined ||
      input.observedEdgeCount === undefined
    )
      reasons.push("projection-unverified");
    else if (manifest.graphContentHash !== input.observedGraphContentHash)
      reasons.push("projection-drift");
    if (
      (input.observedNodeCount !== undefined &&
        (!Number.isSafeInteger(input.observedNodeCount) ||
          input.observedNodeCount < 0 ||
          manifest.nodeCount !== input.observedNodeCount)) ||
      (input.observedEdgeCount !== undefined &&
        (!Number.isSafeInteger(input.observedEdgeCount) ||
          input.observedEdgeCount < 0 ||
          manifest.edgeCount !== input.observedEdgeCount))
    )
      reasons.push("projection-drift");
  }
  const unique = [...new Set(reasons)];
  return {
    fresh: unique.length === 0,
    exactEvidenceAllowed: unique.length === 0,
    reasons: unique,
    recovery: unique.length === 0 ? "none" : "rebuild",
  };
}
