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
