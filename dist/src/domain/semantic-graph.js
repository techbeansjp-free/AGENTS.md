import crypto from "node:crypto";
export const SEMANTIC_GRAPH_SCHEMA_VERSION = "agent-skill-chain/semantic-graph/v1";
export const SEMANTIC_GRAPH_BUILDER_VERSION = "2";
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
]);
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
]);
export const DEFAULT_GRAPH_BUDGET = Object.freeze({
    maxDepth: 64,
    maxVisitedNodes: 20_000,
    maxVisitedEdges: 100_000,
    maxResults: 10_000,
    maxOperations: 250_000,
});
/** Raw snapshot全体を反復する前に適用する共通input/projection envelope。 */
export const MAX_SEMANTIC_GRAPH_NODES = 200_000;
export const MAX_SEMANTIC_GRAPH_EDGES = 1_000_000;
export const MAX_SEMANTIC_GRAPH_DISTANCE = Number.MAX_SAFE_INTEGER;
export const GRAPH_DRIFT_REASONS = Object.freeze([
    "missing",
    "corrupt",
    "incomplete",
    "schema-mismatch",
    "builder-mismatch",
    "extension-mismatch",
    "wrong-worktree",
    "source-ahead",
    "projection-unverified",
    "projection-drift",
]);
const GRAPH_DRIFT_REASON_RANK = new Map(GRAPH_DRIFT_REASONS.map((reason, index) => [reason, index]));
export function canonicalGraphDriftReasons(reasons) {
    return [...new Set(reasons)].sort((left, right) => (GRAPH_DRIFT_REASON_RANK.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (GRAPH_DRIFT_REASON_RANK.get(right) ?? Number.MAX_SAFE_INTEGER));
}
/** stale projectionを文字列例外へ潰さず、復旧判断まで型付きで伝える。 */
export class GraphFreshnessError extends Error {
    code = "GRAPH_FRESHNESS_ERROR";
    fresh = false;
    exactEvidenceAllowed = false;
    recovery = "rebuild";
    reasons;
    constructor(reasons, message = "semantic graph projectionはfreshではありません") {
        const canonicalReasons = canonicalGraphDriftReasons(reasons);
        if (canonicalReasons.length === 0)
            throw new TypeError("GraphFreshnessErrorにはdrift reasonが必要です");
        super(`${message}: ${canonicalReasons.join(", ")}`);
        this.name = "GraphFreshnessError";
        this.reasons = canonicalReasons;
    }
}
function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}
function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function stableGraphJson(value) {
    if (Array.isArray(value))
        return `[${value.map((entry) => stableGraphJson(entry)).join(",")}]`;
    if (value !== null && typeof value === "object") {
        const fields = Object.entries(value)
            .sort(([left], [right]) => compareText(left, right))
            .map(([key, entry]) => `${JSON.stringify(key)}:${stableGraphJson(entry)}`);
        return `{${fields.join(",")}}`;
    }
    const encoded = JSON.stringify(value);
    if (encoded === undefined)
        throw new TypeError("semantic graphにJSON表現できない値が含まれています");
    return encoded;
}
function validSha256(value) {
    return /^[a-f0-9]{64}$/u.test(value);
}
function validGitOid(value) {
    return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value);
}
function validId(value) {
    return (value.length > 0 &&
        value.length <= 512 &&
        value === value.normalize("NFC") &&
        !/[\p{Cc}\p{Cf}]/u.test(value));
}
function validSourcePath(value) {
    const segments = value.split("/");
    return (validId(value) &&
        !value.startsWith("/") &&
        !value.includes("\\") &&
        segments.every((segment) => segment !== "" && segment !== "." && segment !== ".."));
}
function validIsoInstant(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value))
        return false;
    const instant = Date.parse(value);
    if (!Number.isFinite(instant))
        return false;
    const canonical = value.includes(".") ? value : `${value.slice(0, -1)}.000Z`;
    return new Date(instant).toISOString() === canonical;
}
function validConfidence(value) {
    return (value === undefined || (Number.isFinite(value) && value >= 0 && value <= 1));
}
function validSourceIdentity(source) {
    return (validId(source.repositoryId) &&
        validSha256(source.worktreeId) &&
        validGitOid(source.headSha) &&
        validGitOid(source.treeSha) &&
        validSha256(source.contentDigest) &&
        typeof source.dirty === "boolean");
}
/**
 * `.length`だけを読むO(1) cardinality判定。上限超過時はiterator、validator、
 * canonicalizer、hasher、adjacency builderのどれにも入力を渡さない。
 */
export function semanticGraphCardinalityErrors(snapshot) {
    const errors = [];
    if (snapshot.nodes.length > MAX_SEMANTIC_GRAPH_NODES)
        errors.push(`semantic graph node数が上限${String(MAX_SEMANTIC_GRAPH_NODES)}を超えています`);
    if (snapshot.edges.length > MAX_SEMANTIC_GRAPH_EDGES)
        errors.push(`semantic graph edge数が上限${String(MAX_SEMANTIC_GRAPH_EDGES)}を超えています`);
    return errors;
}
function assertSemanticGraphCardinality(snapshot) {
    const errors = semanticGraphCardinalityErrors(snapshot);
    if (errors.length > 0)
        throw new RangeError(errors.join("; "));
}
function validProperties(properties) {
    return Object.entries(properties).every(([key, value]) => validId(key) &&
        (value === null ||
            typeof value === "string" ||
            typeof value === "boolean" ||
            (typeof value === "number" && Number.isFinite(value))));
}
export function validateSemanticGraphSnapshot(snapshot) {
    const cardinalityErrors = semanticGraphCardinalityErrors(snapshot);
    if (cardinalityErrors.length > 0)
        return cardinalityErrors;
    const errors = [];
    if (snapshot.schemaVersion !== SEMANTIC_GRAPH_SCHEMA_VERSION)
        errors.push("semantic graph schema versionが不正です");
    if (snapshot.builderVersion !== SEMANTIC_GRAPH_BUILDER_VERSION)
        errors.push("semantic graph builder versionが不正です");
    if (!validSourceIdentity(snapshot.source))
        errors.push("semantic graph source identityが不正です");
    const nodeIds = new Set();
    for (const node of snapshot.nodes) {
        if (!validId(node.id) || nodeIds.has(node.id))
            errors.push(`node IDが不正または重複しています: ${node.id}`);
        nodeIds.add(node.id);
        if (!SEMANTIC_NODE_KINDS.includes(node.kind))
            errors.push(`node kindが不正です: ${String(node.kind)}`);
        if (node.certainty === "deterministic" && node.confidence !== undefined)
            errors.push(`deterministic nodeにconfidenceを指定できません: ${node.id}`);
        if ((node.certainty !== "deterministic" && node.certainty !== "inferred") ||
            !validConfidence(node.confidence) ||
            (node.certainty === "inferred" && node.confidence === undefined))
            errors.push(`node certainty/confidenceが不正です: ${node.id}`);
        if (!validSourcePath(node.sourcePath) || !validProperties(node.properties))
            errors.push(`node provenance/propertiesが不正です: ${node.id}`);
        if (node.sourceLine !== undefined &&
            (!Number.isInteger(node.sourceLine) || node.sourceLine < 1))
            errors.push(`node source lineが不正です: ${node.id}`);
    }
    const edgeIds = new Set();
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
        if ((edge.certainty !== "deterministic" && edge.certainty !== "inferred") ||
            !validConfidence(edge.confidence) ||
            (edge.certainty === "inferred" && edge.confidence === undefined))
            errors.push(`edge certainty/confidenceが不正です: ${edge.id}`);
        if (edge.weight !== undefined &&
            (!Number.isFinite(edge.weight) || edge.weight < 0))
            errors.push(`edge weightは非負有限値でなければなりません: ${edge.id}`);
        if (!validSourcePath(edge.sourcePath) || !validProperties(edge.properties))
            errors.push(`edge provenance/propertiesが不正です: ${edge.id}`);
        if (edge.sourceLine !== undefined &&
            (!Number.isInteger(edge.sourceLine) || edge.sourceLine < 1))
            errors.push(`edge source lineが不正です: ${edge.id}`);
    }
    return [...new Set(errors)].sort(compareText);
}
function canonicalNode(node) {
    return {
        id: node.id,
        kind: node.kind,
        certainty: node.certainty,
        ...(node.confidence === undefined ? {} : { confidence: node.confidence }),
        sourcePath: node.sourcePath,
        ...(node.sourceLine === undefined ? {} : { sourceLine: node.sourceLine }),
        properties: Object.fromEntries(Object.entries(node.properties).sort(([left], [right]) => compareText(left, right))),
    };
}
function canonicalEdge(edge) {
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
        properties: Object.fromEntries(Object.entries(edge.properties).sort(([left], [right]) => compareText(left, right))),
    };
}
export function canonicalSemanticGraph(snapshot) {
    assertSemanticGraphCardinality(snapshot);
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
export function semanticGraphContentHash(snapshot) {
    assertSemanticGraphCardinality(snapshot);
    const canonical = canonicalSemanticGraph(snapshot);
    return sha256(stableGraphJson({
        schemaVersion: canonical.schemaVersion,
        builderVersion: canonical.builderVersion,
        nodes: canonical.nodes,
        edges: canonical.edges,
    }));
}
function validateBudget(budget) {
    return Object.entries(budget).flatMap(([name, value]) => Number.isInteger(value) && value > 0
        ? []
        : [`${name}は正の整数でなければなりません`]);
}
function eligibleGraphEdge(edge, edgeKinds, includeInferred) {
    return ((includeInferred || edge.certainty === "deterministic") &&
        (edgeKinds === undefined || edgeKinds.has(edge.kind)));
}
function compareGraphEdges(left, right) {
    return (compareText(left.to, right.to) ||
        compareText(left.from, right.from) ||
        compareText(left.id, right.id));
}
/**
 * Graph全体を対象にするKahn/Tarjan専用のbounded index。
 *
 * node/eligible edgeをindexへ追加する前にhard limitを確認し、追加自体を
 * Domain operationとして数える。したがってbudgetを超える入力を全件sortして
 * から拒否せず、上限内で停止する。局所queryはこの関数を使わず、実際に訪問する
 * adjacencyだけをboundedAdjacentEdgesで順序化する。
 */
function indexCompleteGraph(snapshot, edgeKinds, includeInferred, budget) {
    const nodes = [];
    const outgoing = new Map();
    const incoming = new Map();
    const indegree = new Map();
    const selfLoops = new Set();
    let visitedNodes = 0;
    let visitedEdges = 0;
    let operations = 0;
    for (const { id } of snapshot.nodes) {
        if (visitedNodes >= budget.maxVisitedNodes)
            return {
                status: "budget-exceeded",
                visitedNodes,
                visitedEdges,
                operations,
                reason: "Graph indexのnode上限に達しました",
            };
        if (operations >= budget.maxOperations)
            return {
                status: "budget-exceeded",
                visitedNodes,
                visitedEdges,
                operations,
                reason: "Graph indexのoperation上限に達しました",
            };
        nodes.push(id);
        outgoing.set(id, []);
        incoming.set(id, []);
        indegree.set(id, 0);
        visitedNodes += 1;
        operations += 1;
    }
    for (const edge of snapshot.edges) {
        if (!eligibleGraphEdge(edge, edgeKinds, includeInferred))
            continue;
        if (visitedEdges >= budget.maxVisitedEdges)
            return {
                status: "budget-exceeded",
                visitedNodes,
                visitedEdges,
                operations,
                reason: "Graph indexのedge上限に達しました",
            };
        if (operations >= budget.maxOperations)
            return {
                status: "budget-exceeded",
                visitedNodes,
                visitedEdges,
                operations,
                reason: "Graph indexのoperation上限に達しました",
            };
        outgoing.get(edge.from)?.push(edge);
        incoming.get(edge.to)?.push(edge);
        indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
        if (edge.from === edge.to)
            selfLoops.add(edge.from);
        visitedEdges += 1;
        operations += 1;
    }
    nodes.sort(compareText);
    for (const list of outgoing.values())
        list.sort(compareGraphEdges);
    for (const list of incoming.values())
        list.sort(compareGraphEdges);
    return {
        status: "complete",
        index: { nodes, outgoing, incoming, indegree, selfLoops },
        visitedNodes,
        visitedEdges,
        operations,
    };
}
/**
 * BFS/Dijkstra用のunsorted adjacency index。eligible edgeを一度だけO(E)で
 * 分類し、Graph projection自体の入力上限でmemoryを拘束する。query counterは
 * 非訪問edgeへ適用せず、実際に訪問するadjacencyの検査時にだけ消費する。
 */
function indexLocalGraph(snapshot, edgeKinds, includeInferred) {
    const outgoing = new Map();
    const incoming = new Map();
    let weighted = false;
    for (const edge of snapshot.edges) {
        if (!eligibleGraphEdge(edge, edgeKinds, includeInferred))
            continue;
        const outgoingEdges = outgoing.get(edge.from);
        if (outgoingEdges === undefined)
            outgoing.set(edge.from, [edge]);
        else
            outgoingEdges.push(edge);
        const incomingEdges = incoming.get(edge.to);
        if (incomingEdges === undefined)
            incoming.set(edge.to, [edge]);
        else
            incomingEdges.push(edge);
        if (edge.weight !== undefined)
            weighted = true;
    }
    return { outgoing, incoming, weighted };
}
/**
 * 実際に訪問する1 adjacencyだけを残budgetと比較し、超過時は全件sort前に停止する。
 */
function boundedAdjacentEdges(index, node, direction, remainingEdges, remainingOperations) {
    const unsorted = direction === "outgoing"
        ? (index.outgoing.get(node) ?? [])
        : (index.incoming.get(node) ?? []);
    if (unsorted.length > remainingEdges)
        return {
            status: "budget-exceeded",
            edges: [],
            reason: "探索edge上限に達しました",
        };
    if (unsorted.length > remainingOperations)
        return {
            status: "budget-exceeded",
            edges: [],
            reason: "探索operation上限に達しました",
        };
    const edges = [...unsorted];
    edges.sort(compareGraphEdges);
    return { status: "complete", edges };
}
function candidateEdgeEvidence(edge) {
    if (edge.certainty !== "inferred" || edge.confidence === undefined)
        throw new TypeError(`candidate edgeではありません: ${edge.id}`);
    return {
        id: edge.id,
        from: edge.from,
        to: edge.to,
        kind: edge.kind,
        confidence: edge.confidence,
        sourcePath: edge.sourcePath,
        ...(edge.sourceLine === undefined ? {} : { sourceLine: edge.sourceLine }),
    };
}
function traversalNodeEvidence(nodeId, candidateEdges) {
    return candidateEdges.length === 0
        ? {
            nodeId,
            classification: "exact",
            gateAuthority: "freshness-required",
            candidateEdges: [],
        }
        : {
            nodeId,
            classification: "candidate",
            gateAuthority: "never",
            candidateEdges: [...candidateEdges],
        };
}
export function traverseSemanticGraph(snapshot, starts, options) {
    const cardinalityReasons = semanticGraphCardinalityErrors(snapshot);
    if (cardinalityReasons.length > 0)
        return {
            status: "invalid",
            nodes: [],
            evidence: [],
            visitedNodes: 0,
            visitedEdges: 0,
            operations: 0,
            maxDepthReached: 0,
            reasons: cardinalityReasons,
        };
    const budget = options.budget ?? DEFAULT_GRAPH_BUDGET;
    const budgetReasons = validateBudget(budget);
    if (budgetReasons.length > 0)
        return {
            status: "invalid",
            nodes: [],
            evidence: [],
            visitedNodes: 0,
            visitedEdges: 0,
            operations: 0,
            maxDepthReached: 0,
            reasons: budgetReasons,
        };
    const reasons = validateSemanticGraphSnapshot(snapshot);
    const known = new Set(snapshot.nodes.map(({ id }) => id));
    const uniqueStarts = [...new Set(starts)].sort(compareText);
    for (const start of uniqueStarts)
        if (!known.has(start))
            reasons.push(`開始nodeが存在しません: ${start}`);
    if (reasons.length > 0)
        return {
            status: "invalid",
            nodes: [],
            evidence: [],
            visitedNodes: 0,
            visitedEdges: 0,
            operations: 0,
            maxDepthReached: 0,
            reasons: [...new Set(reasons)].sort(compareText),
        };
    const edgeKinds = options.edgeKinds === undefined ? undefined : new Set(options.edgeKinds);
    const includeInferred = options.includeInferred ?? false;
    const index = indexLocalGraph(snapshot, edgeKinds, includeInferred);
    const initialLimit = Math.min(budget.maxVisitedNodes, budget.maxResults, budget.maxOperations);
    if (uniqueStarts.length > initialLimit) {
        const included = uniqueStarts.slice(0, initialLimit);
        return {
            status: "budget-exceeded",
            nodes: included,
            evidence: included.map((nodeId) => traversalNodeEvidence(nodeId, [])),
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
    const candidatePath = new Map(uniqueStarts.map((node) => [node, []]));
    let cursor = 0;
    let visitedEdges = 0;
    let operations = uniqueStarts.length;
    let maxDepthReached = 0;
    const exceed = (reason) => ({
        status: "budget-exceeded",
        nodes: result,
        evidence: result.map((nodeId) => traversalNodeEvidence(nodeId, candidatePath.get(nodeId) ?? [])),
        visitedNodes: visited.size,
        visitedEdges,
        operations,
        maxDepthReached,
        reasons: [reason],
    });
    while (cursor < queue.length) {
        const current = queue[cursor++];
        if (!current)
            break;
        maxDepthReached = Math.max(maxDepthReached, current.depth);
        const adjacency = boundedAdjacentEdges(index, current.node, options.direction, budget.maxVisitedEdges - visitedEdges, budget.maxOperations - operations);
        if (adjacency.status === "budget-exceeded")
            return exceed(adjacency.reason ?? "探索budgetに達しました");
        const edges = adjacency.edges;
        if (current.depth >= budget.maxDepth) {
            const hasUnvisitedNeighbor = edges.some((edge) => {
                const next = options.direction === "outgoing" ? edge.to : edge.from;
                return !visited.has(next);
            });
            if (hasUnvisitedNeighbor)
                return exceed("探索depth上限に達しました");
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
            if (visited.has(next))
                continue;
            if (visited.size >= budget.maxVisitedNodes)
                return exceed("探索node上限に達しました");
            if (result.length >= budget.maxResults)
                return exceed("探索result上限に達しました");
            visited.add(next);
            result.push(next);
            const inheritedCandidates = candidatePath.get(current.node) ?? [];
            candidatePath.set(next, edge.certainty === "inferred"
                ? [...inheritedCandidates, candidateEdgeEvidence(edge)]
                : inheritedCandidates);
            queue.push({ node: next, depth: current.depth + 1 });
        }
    }
    return {
        status: "complete",
        nodes: result,
        evidence: result.map((nodeId) => traversalNodeEvidence(nodeId, candidatePath.get(nodeId) ?? [])),
        visitedNodes: visited.size,
        visitedEdges,
        operations,
        maxDepthReached,
        reasons: [],
    };
}
class MinHeap {
    #values = [];
    #compare;
    constructor(compare) {
        this.#compare = compare;
    }
    get size() {
        return this.#values.length;
    }
    push(value) {
        this.#values.push(value);
        let index = this.#values.length - 1;
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (this.#compare(this.#values[index], this.#values[parent]) >= 0)
                break;
            [this.#values[index], this.#values[parent]] = [
                this.#values[parent],
                this.#values[index],
            ];
            index = parent;
        }
    }
    pop() {
        const first = this.#values[0];
        const last = this.#values.pop();
        if (this.#values.length > 0 && last !== undefined) {
            this.#values[0] = last;
            let index = 0;
            while (true) {
                const left = index * 2 + 1;
                const right = left + 1;
                let smallest = index;
                if (left < this.#values.length &&
                    this.#compare(this.#values[left], this.#values[smallest]) < 0)
                    smallest = left;
                if (right < this.#values.length &&
                    this.#compare(this.#values[right], this.#values[smallest]) < 0)
                    smallest = right;
                if (smallest === index)
                    break;
                [this.#values[index], this.#values[smallest]] = [
                    this.#values[smallest],
                    this.#values[index],
                ];
                index = smallest;
            }
        }
        return first;
    }
}
export function stronglyConnectedComponents(snapshot, edgeKinds, budget = DEFAULT_GRAPH_BUDGET) {
    const cardinalityReasons = semanticGraphCardinalityErrors(snapshot);
    if (cardinalityReasons.length > 0)
        return {
            status: "invalid",
            components: [],
            operations: 0,
            reasons: cardinalityReasons,
        };
    const budgetReasons = validateBudget(budget);
    if (budgetReasons.length > 0)
        return {
            status: "invalid",
            components: [],
            operations: 0,
            reasons: budgetReasons,
        };
    const reasons = validateSemanticGraphSnapshot(snapshot);
    if (reasons.length > 0)
        return { status: "invalid", components: [], operations: 0, reasons };
    const indexed = indexCompleteGraph(snapshot, edgeKinds === undefined ? undefined : new Set(edgeKinds), false, budget);
    if (indexed.status === "budget-exceeded")
        return {
            status: "budget-exceeded",
            components: [],
            operations: indexed.operations,
            reasons: [indexed.reason ?? "SCC探索budgetに達しました"],
        };
    const index = indexed.index;
    const indices = new Map();
    const lowLink = new Map();
    const tarjanStack = [];
    const onStack = new Set();
    const components = [];
    let nextIndex = 0;
    let operations = indexed.operations;
    const budgetExceeded = (reason) => ({
        status: "budget-exceeded",
        components: components
            .map((component) => [...component].sort(compareText))
            .sort((left, right) => compareText(left[0] ?? "", right[0] ?? "")),
        operations,
        reasons: [reason],
    });
    for (const start of index.nodes) {
        if (indices.has(start))
            continue;
        const frames = [];
        const enter = (node, parent) => {
            if (operations >= budget.maxOperations)
                return false;
            operations += 1;
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
            return true;
        };
        if (!enter(start))
            return budgetExceeded("SCC operation上限に達しました");
        while (frames.length > 0) {
            const frame = frames[frames.length - 1];
            const edge = frame.edges[frame.cursor];
            if (edge !== undefined) {
                if (operations >= budget.maxOperations)
                    return budgetExceeded("SCC operation上限に達しました");
                frame.cursor += 1;
                operations += 1;
                if (!indices.has(edge.to)) {
                    if (!enter(edge.to, frame.node))
                        return budgetExceeded("SCC operation上限に達しました");
                    continue;
                }
                if (onStack.has(edge.to))
                    lowLink.set(frame.node, Math.min(lowLink.get(frame.node), indices.get(edge.to)));
                continue;
            }
            frames.pop();
            if (frame.parent !== undefined)
                lowLink.set(frame.parent, Math.min(lowLink.get(frame.parent), lowLink.get(frame.node)));
            if (lowLink.get(frame.node) === indices.get(frame.node)) {
                if (components.length >= budget.maxResults)
                    return budgetExceeded("SCC result上限に達しました");
                const component = [];
                while (tarjanStack.length > 0) {
                    const member = tarjanStack.pop();
                    onStack.delete(member);
                    component.push(member);
                    if (member === frame.node)
                        break;
                }
                components.push(component.sort(compareText));
            }
        }
    }
    return {
        status: "complete",
        components: components.sort((left, right) => compareText(left[0] ?? "", right[0] ?? "")),
        operations,
        reasons: [],
    };
}
export function topologicalSemanticOrder(snapshot, edgeKinds, budget = DEFAULT_GRAPH_BUDGET) {
    const cardinalityReasons = semanticGraphCardinalityErrors(snapshot);
    if (cardinalityReasons.length > 0)
        return {
            status: "invalid",
            evidenceComplete: false,
            gateConformant: null,
            order: [],
            stronglyConnectedComponents: [],
            operations: 0,
            reasons: cardinalityReasons,
        };
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
    if (snapshot.nodes.length > budget.maxResults)
        return {
            status: "budget-exceeded",
            evidenceComplete: false,
            gateConformant: null,
            order: [],
            stronglyConnectedComponents: [],
            operations: 0,
            reasons: ["topological sortのresult上限に達しました"],
        };
    const indexed = indexCompleteGraph(snapshot, edgeKinds === undefined ? undefined : new Set(edgeKinds), false, budget);
    if (indexed.status === "budget-exceeded")
        return {
            status: "budget-exceeded",
            evidenceComplete: false,
            gateConformant: null,
            order: [],
            stronglyConnectedComponents: [],
            operations: indexed.operations,
            reasons: [indexed.reason ?? "topological sortのindex上限に達しました"],
        };
    const index = indexed.index;
    const indegree = new Map();
    let operations = indexed.operations;
    const budgetExceeded = (reason, order = []) => ({
        status: "budget-exceeded",
        evidenceComplete: false,
        gateConformant: null,
        order,
        stronglyConnectedComponents: [],
        operations,
        reasons: [reason],
    });
    const ready = new MinHeap(compareText);
    for (const node of index.nodes) {
        if (operations >= budget.maxOperations)
            return budgetExceeded("topological sortのoperation上限に達しました");
        const degree = index.indegree.get(node) ?? 0;
        indegree.set(node, degree);
        if (degree === 0)
            ready.push(node);
        operations += 1;
    }
    const order = [];
    while (ready.size > 0) {
        if (operations >= budget.maxOperations)
            return budgetExceeded("topological sortのoperation上限に達しました", order);
        const node = ready.pop();
        order.push(node);
        operations += 1;
        for (const edge of index.outgoing.get(node) ?? []) {
            if (operations >= budget.maxOperations)
                return budgetExceeded("topological sortのoperation上限に達しました", order);
            const next = (indegree.get(edge.to) ?? 0) - 1;
            indegree.set(edge.to, next);
            if (next === 0)
                ready.push(edge.to);
            operations += 1;
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
    if (operations >= budget.maxOperations)
        return budgetExceeded("cycle診断のoperation上限に達しました", order);
    const scc = stronglyConnectedComponents(snapshot, edgeKinds, {
        ...budget,
        maxOperations: budget.maxOperations - operations,
    });
    if (scc.status !== "complete")
        return {
            status: scc.status,
            evidenceComplete: false,
            gateConformant: null,
            order,
            stronglyConnectedComponents: [],
            operations: operations + scc.operations,
            reasons: scc.reasons,
        };
    const cycles = scc.components.filter((component) => component.length > 1 ||
        component.some((node) => index.selfLoops.has(node)));
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
export function shortestSemanticPath(snapshot, from, to, options = {}) {
    const cardinalityReasons = semanticGraphCardinalityErrors(snapshot);
    if (cardinalityReasons.length > 0)
        return {
            status: "invalid",
            algorithm: "bfs",
            path: [],
            visitedNodes: 0,
            visitedEdges: 0,
            operations: 0,
            reasons: cardinalityReasons,
        };
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
    const reasons = validateSemanticGraphSnapshot(snapshot);
    const known = new Set(snapshot.nodes.map(({ id }) => id));
    if (!known.has(from))
        reasons.push(`開始nodeが存在しません: ${from}`);
    if (!known.has(to))
        reasons.push(`終了nodeが存在しません: ${to}`);
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
    const edgeKinds = options.edgeKinds === undefined ? undefined : new Set(options.edgeKinds);
    const index = indexLocalGraph(snapshot, edgeKinds, false);
    const weighted = index.weighted;
    let visitedNodes = 1;
    let visitedEdges = 0;
    let operations = 1;
    const algorithm = weighted ? "dijkstra" : "bfs";
    const predecessor = new Map();
    const budgetResult = (reason) => ({
        status: "budget-exceeded",
        algorithm,
        path: [],
        visitedNodes,
        visitedEdges,
        operations,
        reasons: [reason],
    });
    const buildPath = () => {
        const path = [to];
        while (path[0] !== from) {
            const previous = predecessor.get(path[0]);
            if (!previous)
                return undefined;
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
        const queue = [{ node: from, depth: 0 }];
        let cursor = 0;
        let found = false;
        while (cursor < queue.length && !found) {
            const current = queue[cursor++];
            const adjacency = boundedAdjacentEdges(index, current.node, "outgoing", budget.maxVisitedEdges - visitedEdges, budget.maxOperations - operations);
            if (adjacency.status === "budget-exceeded")
                return budgetResult((adjacency.reason ?? "探索budgetに達しました").replace(/^探索/u, "最短経路の"));
            const edges = adjacency.edges;
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
                if (discovered.has(edge.to))
                    continue;
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
    const weightedStateKey = (node, depth) => `${String(depth)}\u0000${node}`;
    const startKey = weightedStateKey(from, 0);
    const startState = {
        key: startKey,
        node: from,
        distance: 0,
        depth: 0,
        pathKey: from,
    };
    const state = new Map([[startKey, startState]]);
    const heap = new MinHeap((left, right) => left.distance - right.distance ||
        compareText(left.pathKey, right.pathKey) ||
        compareText(left.node, right.node) ||
        left.depth - right.depth);
    heap.push(startState);
    const settledStates = new Set();
    const settledNodes = new Set();
    const weightedPredecessor = new Map();
    const invalidWeightedResult = (reason) => ({
        status: "invalid",
        algorithm,
        path: [],
        visitedNodes,
        visitedEdges,
        operations,
        reasons: [reason],
    });
    const buildWeightedPath = (destinationStateKey) => {
        const path = [to];
        let cursor = destinationStateKey;
        while (cursor !== startKey) {
            const previous = weightedPredecessor.get(cursor);
            if (previous === undefined)
                return undefined;
            path.unshift(previous.node);
            cursor = previous.stateKey;
        }
        return path;
    };
    const depthLimitedTargets = new Set();
    let reachedStateKey;
    let reachedDistance;
    while (heap.size > 0) {
        if (operations >= budget.maxOperations)
            return budgetResult("最短経路のoperation上限に達しました");
        const current = heap.pop();
        operations += 1;
        const best = state.get(current.key);
        if (best?.distance !== current.distance ||
            best.pathKey !== current.pathKey ||
            settledStates.has(current.key))
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
        const adjacency = boundedAdjacentEdges(index, current.node, "outgoing", budget.maxVisitedEdges - visitedEdges, budget.maxOperations - operations);
        if (adjacency.status === "budget-exceeded")
            return budgetResult((adjacency.reason ?? "探索budgetに達しました").replace(/^探索/u, "最短経路の"));
        const edges = adjacency.edges;
        if (current.depth >= budget.maxDepth) {
            for (const edge of edges)
                depthLimitedTargets.add(edge.to);
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
            if (current.distance > MAX_SEMANTIC_GRAPH_DISTANCE - edgeWeight ||
                !Number.isFinite(current.distance + edgeWeight))
                return invalidWeightedResult(`最短経路の累積weightが安全上限を超えました: ${edge.id}`);
            const nextDepth = current.depth + 1;
            const key = weightedStateKey(edge.to, nextDepth);
            const candidate = {
                key,
                node: edge.to,
                distance: current.distance + edgeWeight,
                depth: nextDepth,
                pathKey: `${current.pathKey}\u0000${edge.to}\u0000${edge.id}`,
            };
            const previous = state.get(key);
            if (previous === undefined ||
                candidate.distance < previous.distance ||
                (candidate.distance === previous.distance &&
                    compareText(candidate.pathKey, previous.pathKey) < 0)) {
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
        if ([...depthLimitedTargets].some((node) => !settledNodes.has(node)))
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
    const path = reachedStateKey === undefined
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
export function assessGraphFreshness(input) {
    const reasons = [];
    if (input.readError !== undefined)
        reasons.push(input.readError);
    const manifest = input.manifest;
    if (manifest === undefined && input.readError === undefined)
        reasons.push("missing");
    if (manifest !== undefined) {
        if (manifest.manifestVersion !==
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
            !validIsoInstant(manifest.builtAt))
            reasons.push("corrupt");
        if (manifest.status !== "complete")
            reasons.push("incomplete");
        if (manifest.graphSchemaVersion !== SEMANTIC_GRAPH_SCHEMA_VERSION)
            reasons.push("schema-mismatch");
        if (manifest.graphBuilderVersion !== SEMANTIC_GRAPH_BUILDER_VERSION)
            reasons.push("builder-mismatch");
        if (manifest.extensionVersion !== input.expectedExtensionVersion ||
            manifest.extensionSha256 !== input.expectedExtensionSha256)
            reasons.push("extension-mismatch");
        if (manifest.source.worktreeId !== input.expectedSource.worktreeId)
            reasons.push("wrong-worktree");
        if (manifest.source.repositoryId !== input.expectedSource.repositoryId ||
            manifest.source.headSha !== input.expectedSource.headSha ||
            manifest.source.treeSha !== input.expectedSource.treeSha ||
            manifest.source.contentDigest !== input.expectedSource.contentDigest ||
            manifest.source.dirty !== input.expectedSource.dirty)
            reasons.push("source-ahead");
        if (input.observedGraphContentHash === undefined ||
            input.observedNodeCount === undefined ||
            input.observedEdgeCount === undefined)
            reasons.push("projection-unverified");
        else if (manifest.graphContentHash !== input.observedGraphContentHash)
            reasons.push("projection-drift");
        if ((input.observedNodeCount !== undefined &&
            (!Number.isSafeInteger(input.observedNodeCount) ||
                input.observedNodeCount < 0 ||
                manifest.nodeCount !== input.observedNodeCount)) ||
            (input.observedEdgeCount !== undefined &&
                (!Number.isSafeInteger(input.observedEdgeCount) ||
                    input.observedEdgeCount < 0 ||
                    manifest.edgeCount !== input.observedEdgeCount)))
            reasons.push("projection-drift");
    }
    const unique = canonicalGraphDriftReasons(reasons);
    return {
        fresh: unique.length === 0,
        exactEvidenceAllowed: unique.length === 0,
        reasons: unique,
        recovery: unique.length === 0 ? "none" : "rebuild",
    };
}
//# sourceMappingURL=semantic-graph.js.map