import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateScenarioTrace } from '../src/domain/trace.js';
import { loadProjectPolicySet } from '../src/domain/policy.js';

/** @param {string} directory @param {(file: string) => boolean} predicate @returns {string[]} */
function walkFiles(directory, predicate) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(resolved, predicate);
    return entry.isFile() && predicate(resolved) ? [resolved] : [];
  });
}

/** Project-owned cucumber-js adapter. @param {string} text */
export function parseProjectGherkin(text) {
  const lines = text.split(/\r?\n/u);
  const scenarios = [];
  /** @type {{id: string, title: string, steps: string[], line: number}|undefined} */
  let current;
  for (let index = 0; index < lines.length; index += 1) {
    const scenario = /^\s*Scenario(?: Outline)?:\s+(SCN-[A-Z0-9-]+)\s+(.+?)\s*$/u.exec(lines[index]);
    if (scenario) {
      current = { id: scenario[1], title: scenario[2], steps: [], line: index + 1 };
      scenarios.push(current);
      continue;
    }
    const step = /^\s*(Given|When|Then|And|But)\s+\S/u.exec(lines[index]);
    if (!step || !current) continue;
    const role = step[1].toLowerCase();
    if (['given', 'when', 'then'].includes(role)) current.steps.push(role);
  }
  return scenarios;
}

/** @param {string} root @param {string[]} layers @param {string[]} forbiddenSuffixes */
export function collectProjectTrace(root, layers, forbiddenSuffixes) {
  const featuresRoot = path.join(root, 'test', 'features');
  const scenarios = walkFiles(featuresRoot, (file) => file.endsWith('.feature')).flatMap((file) => {
    const source = path.relative(root, file).split(path.sep).join('/');
    const layer = layers.find((candidate) => file.split(path.sep).includes(candidate)) ?? 'unknown';
    return parseProjectGherkin(fs.readFileSync(file, 'utf8')).map(({ id, title, steps }) => ({ id, title, steps, source, layer }));
  });
  const forbiddenFiles = walkFiles(path.join(root, 'test'), (file) => forbiddenSuffixes.some((suffix) => file.endsWith(suffix))).map((file) => path.relative(root, file).split(path.sep).join('/'));
  return { adapter: 'agent-skill-chain-project/cucumber-js', scenarios, forbiddenFiles };
}

/** @param {string} root */
export function checkProjectTrace(root) {
  const choices = loadProjectPolicySet(root).policy.projectChoices;
  const layers = choices?.testLayers;
  const forbiddenSuffixes = choices?.forbiddenTestFileSuffixes;
  const evidence = collectProjectTrace(root, Array.isArray(layers) ? layers : [], Array.isArray(forbiddenSuffixes) ? forbiddenSuffixes : []);
  return validateScenarioTrace(evidence, { layers });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = checkProjectTrace(process.cwd());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}
