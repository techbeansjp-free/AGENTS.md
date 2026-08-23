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

const GHERKIN_DIALECTS = {
  en: { scenario: /^\s*Scenario(?: Outline)?:\s+(SCN-[A-Z0-9-]+)\s+(.+?)\s*$/u, step: /^\s*(Given|When|Then|And|But)\s+\S/u, canonical: { Given: 'given', When: 'when', Then: 'then' } },
  ja: { scenario: /^\s*(?:シナリオ|シナリオアウトライン):\s+(SCN-[A-Z0-9-]+)\s+(.+?)\s*$/u, step: /^\s*(前提|もし|ならば|かつ|しかし)\s+\S/u, canonical: { 前提: 'given', もし: 'when', ならば: 'then' } },
};

/**
 * The adapter owns dialect parsing so the package validator can remain neutral
 * while each project makes its structural keyword choice explicit.
 * @param {string} text @param {'en'|'ja'} [dialect]
 */
export function parseProjectGherkin(text, dialect = 'en') {
  const grammar = GHERKIN_DIALECTS[dialect];
  if (!grammar) throw new Error(`未対応のGherkin dialectです: ${dialect}`);
  const lines = text.split(/\r?\n/u);
  const scenarios = [];
  /** @type {{id: string, title: string, steps: string[], line: number}|undefined} */
  let current;
  for (let index = 0; index < lines.length; index += 1) {
    const scenario = grammar.scenario.exec(lines[index]);
    if (scenario) {
      current = { id: scenario[1], title: scenario[2], steps: [], line: index + 1 };
      scenarios.push(current);
      continue;
    }
    const step = grammar.step.exec(lines[index]);
    if (!step || !current) continue;
    const role = /** @type {Record<string, string>} */ (grammar.canonical)[step[1]];
    if (role) current.steps.push(role);
  }
  return scenarios;
}

/** @param {string} root @param {string[]} layers @param {string[]} forbiddenSuffixes @param {'en'|'ja'} [dialect] */
export function collectProjectTrace(root, layers, forbiddenSuffixes, dialect = 'en') {
  const featuresRoot = path.join(root, 'test', 'features');
  const scenarios = walkFiles(featuresRoot, (file) => file.endsWith('.feature')).flatMap((file) => {
    const source = path.relative(root, file).split(path.sep).join('/');
    const layer = layers.find((candidate) => file.split(path.sep).includes(candidate)) ?? 'unknown';
    return parseProjectGherkin(fs.readFileSync(file, 'utf8'), dialect).map(({ id, title, steps }) => ({ id, title, steps, source, layer }));
  });
  const forbiddenFiles = walkFiles(path.join(root, 'test'), (file) => forbiddenSuffixes.some((suffix) => file.endsWith(suffix))).map((file) => path.relative(root, file).split(path.sep).join('/'));
  return { adapter: 'agent-skill-chain-project/cucumber-js', scenarios, forbiddenFiles };
}

/** @param {string} root */
export function checkProjectTrace(root) {
  const choices = loadProjectPolicySet(root).policy.projectChoices;
  const layers = choices?.testLayers;
  const forbiddenSuffixes = choices?.forbiddenTestFileSuffixes;
  const dialect = choices?.gherkinDialect;
  if (!['en', 'ja'].includes(dialect)) return { valid: false, errors: ['projectChoices.gherkinDialectが不正です'], layerCounts: {}, nodeTests: [] };
  const evidence = collectProjectTrace(root, Array.isArray(layers) ? layers : [], Array.isArray(forbiddenSuffixes) ? forbiddenSuffixes : [], dialect);
  return validateScenarioTrace(evidence, { layers });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = checkProjectTrace(process.cwd());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}
