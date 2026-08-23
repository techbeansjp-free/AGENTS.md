import fs from 'node:fs';
import path from 'node:path';

/** @param {string} directory @param {(file: string) => boolean} predicate @returns {string[]} */
function walkFiles(directory, predicate) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(resolved, predicate);
    return entry.isFile() && predicate(resolved) ? [resolved] : [];
  });
}

/** @param {string} text */
export function parseGherkinScenarios(text) {
  const lines = text.split(/\r?\n/);
  const scenarios = [];
  /** @type {{id: string, title: string, keywords: Set<string>, line: number}|undefined} */
  let current;
  for (let index = 0; index < lines.length; index += 1) {
    const scenario = /^\s*Scenario(?: Outline)?:\s+(SCN-[A-Z0-9-]+)\s+(.+?)\s*$/.exec(lines[index]);
    if (scenario) {
      current = { id: scenario[1], title: scenario[2], keywords: new Set(), line: index + 1 };
      scenarios.push(current);
      continue;
    }
    const step = /^\s*(Given|When|Then|And|But)\s+\S/.exec(lines[index]);
    if (step && current) current.keywords.add(step[1]);
  }
  return scenarios;
}

/** Validate a caller-supplied directed graph without knowing its language or build tool. @param {unknown} nodesInput @param {unknown} edgesInput */
export function validateDependencyGraph(nodesInput, edgesInput) {
  const errors = [];
  const nodes = Array.isArray(nodesInput) ? nodesInput : [];
  const edges = Array.isArray(edgesInput) ? edgesInput : [];
  if (!Array.isArray(nodesInput) || nodes.some((node) => typeof node !== 'string' || node.trim() === '') || new Set(nodes).size !== nodes.length) errors.push('nodes must be a unique non-empty string array');
  const known = new Set(nodes);
  /** @type {Map<string, string[]>} */
  const outgoing = new Map(nodes.map((node) => [node, []]));
  /** @type {Map<string, number>} */
  const indegree = new Map(nodes.map((node) => [node, 0]));
  for (const edge of edges) {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge) || typeof edge.from !== 'string' || typeof edge.to !== 'string') { errors.push('edge must contain from and to'); continue; }
    if (!known.has(edge.from) || !known.has(edge.to)) { errors.push(`unknown node in edge: ${edge.from} -> ${edge.to}`); continue; }
    if (edge.from === edge.to) { errors.push(`self-loop is forbidden: ${edge.from}`); continue; }
    outgoing.get(edge.from)?.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }
  const ready = nodes.filter((node) => indegree.get(node) === 0).sort();
  const order = [];
  while (ready.length) {
    const node = /** @type {string} */ (ready.shift()); order.push(node);
    for (const target of outgoing.get(node) ?? []) {
      indegree.set(target, (indegree.get(target) ?? 0) - 1);
      if (indegree.get(target) === 0) { ready.push(target); ready.sort(); }
    }
  }
  if (errors.length === 0 && order.length !== nodes.length) errors.push('dependency cycle is forbidden');
  return {
    valid: errors.length === 0, errors, order,
    diagnostic: errors.length ? { ruleId: 'ASC-DEPENDENCY-CYCLE-001', purpose: '依存・authority・evidence graphを非循環に保つ', risk: 'authority', reasons: errors, scope: ['dependency-graph'], checks: ['node、edge、self-loop、unknown node、cycleを検証した'], autoFixes: [], next: 'project hookのedgeを依存方向へ戻しtopological orderを再計算してください', requiredAuthority: 'graph owner', rollback: '循環edgeを適用しない' } : undefined,
  };
}

/** @param {string} featuresRoot @param {{layers?: string[], forbiddenFileSuffixes?: string[]}} [options] */
export function validateScenarioTrace(featuresRoot, options = {}) {
  const errors = [];
  const layers = options.layers ?? [];
  if (!Array.isArray(layers) || layers.length === 0 || layers.some((layer) => typeof layer !== 'string' || layer.trim() === '') || new Set(layers).size !== layers.length) errors.push('project policyから空でない一意なtest layerを選択してください');
  const featureFiles = walkFiles(featuresRoot, (file) => file.endsWith('.feature'));
  const scenarios = featureFiles.flatMap((file) => parseGherkinScenarios(fs.readFileSync(file, 'utf8')).map((scenario) => ({ ...scenario, file })));
  const ids = new Set();
  for (const scenario of scenarios) {
    if (ids.has(scenario.id)) errors.push(`GherkinシナリオIDが重複しています: ${scenario.id}`);
    ids.add(scenario.id);
    for (const keyword of ['Given', 'When', 'Then']) if (!scenario.keywords.has(keyword)) errors.push(`${scenario.id}に${keyword}がありません`);
  }
  /** @type {Record<string, number>} */
  const layerCounts = {};
  for (const layer of layers) {
    layerCounts[layer] = scenarios.filter((scenario) => scenario.file.split(path.sep).includes(layer)).length;
    if (layerCounts[layer] === 0) errors.push(`${layer}層にGherkinシナリオがありません`);
  }
  const testRoot = path.dirname(featuresRoot);
  const forbiddenFiles = walkFiles(testRoot, (file) => (options.forbiddenFileSuffixes ?? []).some((suffix) => file.endsWith(suffix)));
  if (forbiddenFiles.length > 0) errors.push(`project policyが禁止するtest fileが残っています: ${forbiddenFiles.join(', ')}`);
  return { valid: errors.length === 0, errors, scenarios: scenarios.map(({ id, title, file }) => ({ id, title, layer: layers.find((layer) => file.split(path.sep).includes(layer)) ?? 'unknown' })), layerCounts, forbiddenFiles, nodeTests: forbiddenFiles };
}
