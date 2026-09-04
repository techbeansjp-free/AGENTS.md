function unknownArray(value) {
    return Array.isArray(value) ? value : [];
}
export function validateDependencyGraph(nodesInput, edgesInput) {
    const errors = [];
    const nodes = Array.isArray(nodesInput) &&
        nodesInput.every((node) => typeof node === "string")
        ? nodesInput
        : [];
    const edges = unknownArray(edgesInput);
    if (!Array.isArray(nodesInput) ||
        nodes.some((node) => typeof node !== "string" || node.trim() === "") ||
        new Set(nodes).size !== nodes.length)
        errors.push("nodes must be a unique non-empty string array");
    const known = new Set(nodes);
    const outgoing = new Map(nodes.map((node) => [node, []]));
    const indegree = new Map(nodes.map((node) => [node, 0]));
    for (const candidate of edges) {
        if (!candidate ||
            typeof candidate !== "object" ||
            Array.isArray(candidate) ||
            !("from" in candidate) ||
            !("to" in candidate) ||
            typeof candidate.from !== "string" ||
            typeof candidate.to !== "string") {
            errors.push("edge must contain from and to");
            continue;
        }
        const edge = { from: candidate.from, to: candidate.to };
        if (!known.has(edge.from) || !known.has(edge.to)) {
            errors.push(`unknown node in edge: ${edge.from} -> ${edge.to}`);
            continue;
        }
        if (edge.from === edge.to) {
            errors.push(`self-loop is forbidden: ${edge.from}`);
            continue;
        }
        outgoing.get(edge.from)?.push(edge.to);
        indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    }
    const ready = nodes.filter((node) => indegree.get(node) === 0).sort();
    const order = [];
    while (ready.length) {
        const node = ready.shift();
        if (node === undefined)
            break;
        order.push(node);
        for (const target of outgoing.get(node) ?? []) {
            indegree.set(target, (indegree.get(target) ?? 0) - 1);
            if (indegree.get(target) === 0) {
                ready.push(target);
                ready.sort();
            }
        }
    }
    if (errors.length === 0 && order.length !== nodes.length)
        errors.push("dependency cycle is forbidden");
    return {
        valid: errors.length === 0,
        errors,
        order,
        diagnostic: errors.length
            ? {
                ruleId: "ASC-DEPENDENCY-CYCLE-001",
                purpose: "依存・authority・evidence graphを非循環に保つ",
                risk: "authority",
                reasons: errors,
                scope: ["dependency-graph"],
                checks: ["node、edge、self-loop、unknown node、cycleを検証した"],
                autoFixes: [],
                next: "project hookのedgeを依存方向へ戻しtopological orderを再計算してください",
                requiredAuthority: "graph owner",
                rollback: "循環edgeを適用しない",
            }
            : undefined,
    };
}
/**
 * Validate project-adapter supplied scenario trace without owning its file format,
 * runner, display language, or directory convention.
 */
export function validateScenarioTrace(traceInput, options = {}) {
    const errors = [];
    const layers = options.layers ?? [];
    if (!Array.isArray(layers) ||
        layers.length === 0 ||
        layers.some((layer) => typeof layer !== "string" || layer.trim() === "") ||
        new Set(layers).size !== layers.length)
        errors.push("project policyから空でない一意なtest layerを選択してください");
    const trace = traceInput && typeof traceInput === "object" && !Array.isArray(traceInput)
        ? traceInput
        : {};
    if (trace !== traceInput)
        errors.push("trace evidenceはobjectでなければなりません");
    for (const key of Object.keys(trace))
        if (!["adapter", "scenarios", "forbiddenFiles"].includes(key))
            errors.push(`trace evidence.${key}は未知fieldです`);
    if (typeof trace.adapter !== "string" || trace.adapter.trim() === "")
        errors.push("trace evidence.adapterが必要です");
    const scenarios = unknownArray(trace.scenarios);
    if (!Array.isArray(trace.scenarios))
        errors.push("trace evidence.scenariosは配列でなければなりません");
    const forbiddenFiles = Array.isArray(trace.forbiddenFiles) &&
        trace.forbiddenFiles.every((file) => typeof file === "string")
        ? trace.forbiddenFiles
        : [];
    if (!Array.isArray(trace.forbiddenFiles) ||
        forbiddenFiles.length !== trace.forbiddenFiles.length ||
        new Set(forbiddenFiles).size !== forbiddenFiles.length)
        errors.push("trace evidence.forbiddenFilesは重複のない文字列配列でなければなりません");
    const ids = new Set();
    const layerCounts = Object.fromEntries(Array.isArray(layers) ? layers.map((layer) => [layer, 0]) : []);
    for (const scenario of scenarios) {
        if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) {
            errors.push("scenario evidenceはobjectでなければなりません");
            continue;
        }
        const item = scenario;
        for (const key of Object.keys(item))
            if (!["id", "title", "source", "layer", "steps"].includes(key))
                errors.push(`${String(item.id)}.${key}は未知fieldです`);
        const { id, title, source, layer, steps } = item;
        if (typeof id !== "string" || !/^SCN-[A-Z0-9-]+$/u.test(id))
            errors.push(`scenario IDが不正です: ${String(id)}`);
        else if (ids.has(id))
            errors.push(`scenario IDが重複しています: ${id}`);
        else
            ids.add(id);
        if (typeof title !== "string" || title.trim() === "")
            errors.push(`${String(id)}のtitleが不正です`);
        if (typeof source !== "string" || source.trim() === "")
            errors.push(`${String(id)}のsourceが不正です`);
        if (typeof layer !== "string" || !layers.includes(layer))
            errors.push(`${String(id)}のtest layerがproject choiceにありません: ${String(layer)}`);
        else
            layerCounts[layer] += 1;
        if (!Array.isArray(steps) ||
            unknownArray(steps).some((step) => typeof step !== "string" || !["given", "when", "then"].includes(step)))
            errors.push(`${String(id)}のstep roleが不正です`);
        else
            for (const role of ["given", "when", "then"])
                if (!steps.includes(role))
                    errors.push(`${String(id)}に${role} roleがありません`);
    }
    for (const layer of Array.isArray(layers) ? layers : [])
        if (layerCounts[layer] === 0)
            errors.push(`${layer}層にscenario evidenceがありません`);
    if (forbiddenFiles.length > 0)
        errors.push(`project policyが禁止するtest fileが残っています: ${forbiddenFiles.join(", ")}`);
    return {
        valid: errors.length === 0,
        errors,
        adapter: typeof trace.adapter === "string" ? trace.adapter : undefined,
        scenarios: scenarios
            .filter((scenario) => Boolean(scenario) &&
            typeof scenario === "object" &&
            !Array.isArray(scenario))
            .map(({ id, title, source, layer }) => ({ id, title, source, layer })),
        layerCounts,
        forbiddenFiles,
        nodeTests: forbiddenFiles,
    };
}
//# sourceMappingURL=trace.js.map