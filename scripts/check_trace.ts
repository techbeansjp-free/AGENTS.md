import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateScenarioTrace } from "../src/domain/trace.js";
import { loadProjectPolicySet } from "../src/domain/policy.js";
import { validateSpecs } from "../src/domain/spec.js";

function walkFiles(
  directory: string,
  predicate: (file: string) => boolean,
): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, "ja"))
    .flatMap((entry) => {
      const resolved = path.join(directory, entry.name);
      if (entry.isDirectory()) return walkFiles(resolved, predicate);
      return entry.isFile() && predicate(resolved) ? [resolved] : [];
    });
}

function walkRepositoryFiles(
  directory: string,
  predicate: (file: string) => boolean,
): string[] {
  if (!fs.existsSync(directory)) return [];
  const ignoredDirectories = new Set([
    ".git",
    ".worktrees",
    "dist",
    "node_modules",
  ]);
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, "ja"))
    .flatMap((entry) => {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return [];
      const resolved = path.join(directory, entry.name);
      if (entry.isDirectory()) return walkRepositoryFiles(resolved, predicate);
      return entry.isFile() && predicate(resolved) ? [resolved] : [];
    });
}

type Dialect = "en" | "ja";
interface ParsedScenario {
  id: string;
  title: string;
  steps: string[];
  line: number;
}
interface Grammar {
  scenario: RegExp;
  step: RegExp;
  canonical: Record<string, string>;
}
const GHERKIN_DIALECTS: Record<Dialect, Grammar> = {
  en: {
    scenario: /^\s*Scenario(?: Outline)?:\s+(SCN-[A-Z0-9-]+)\s+(.+?)\s*$/u,
    step: /^\s*(Given|When|Then|And|But)\s+\S/u,
    canonical: { Given: "given", When: "when", Then: "then" },
  },
  ja: {
    scenario:
      /^\s*(?:シナリオ|シナリオアウトライン):\s+(SCN-[A-Z0-9-]+)\s+(.+?)\s*$/u,
    step: /^\s*(前提|もし|ならば|かつ|しかし)\s+\S/u,
    canonical: { 前提: "given", もし: "when", ならば: "then" },
  },
};

/**
 * The adapter owns dialect parsing so the package validator can remain neutral
 * while each project makes its structural keyword choice explicit.
 */
export function parseProjectGherkin(
  text: string,
  dialect: Dialect = "en",
): ParsedScenario[] {
  const grammar = GHERKIN_DIALECTS[dialect];
  if (!grammar) throw new Error(`未対応のGherkin dialectです: ${dialect}`);
  const lines = text.split(/\r?\n/u);
  const scenarios: ParsedScenario[] = [];
  let current: ParsedScenario | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const scenario = grammar.scenario.exec(lines[index] ?? "");
    if (scenario) {
      if (!scenario[1] || !scenario[2]) continue;
      current = {
        id: scenario[1],
        title: scenario[2],
        steps: [],
        line: index + 1,
      };
      scenarios.push(current);
      continue;
    }
    const step = grammar.step.exec(lines[index] ?? "");
    if (!step || !current) continue;
    const role = step[1] ? grammar.canonical[step[1]] : undefined;
    if (role) current.steps.push(role);
  }
  return scenarios;
}

export function collectProjectTrace(
  root: string,
  layers: string[],
  forbiddenSuffixes: string[],
  dialect: Dialect = "en",
) {
  const featuresRoot = path.join(root, "test", "features");
  const scenarios = walkFiles(featuresRoot, (file) =>
    file.endsWith(".feature"),
  ).flatMap((file) => {
    const source = path.relative(root, file).split(path.sep).join("/");
    const layer =
      layers.find((candidate) => file.split(path.sep).includes(candidate)) ??
      "unknown";
    return parseProjectGherkin(fs.readFileSync(file, "utf8"), dialect).map(
      ({ id, title, steps }) => ({ id, title, steps, source, layer }),
    );
  });
  const forbiddenFiles = walkFiles(path.join(root, "test"), (file) =>
    forbiddenSuffixes.some((suffix) => file.endsWith(suffix)),
  ).map((file) => path.relative(root, file).split(path.sep).join("/"));
  return {
    adapter: "agent-skill-chain-project/cucumber-js",
    scenarios,
    forbiddenFiles,
  };
}

export function checkProjectTrace(root: string) {
  const choices = loadProjectPolicySet(root).policy.projectChoices;
  const layers = choices?.testLayers;
  const forbiddenSuffixes = choices?.forbiddenTestFileSuffixes;
  const dialect = choices?.gherkinDialect;
  if (dialect !== "en" && dialect !== "ja")
    return {
      valid: false,
      errors: ["projectChoices.gherkinDialectが不正です"],
      layerCounts: {},
      nodeTests: [],
    };
  const evidence = collectProjectTrace(
    root,
    Array.isArray(layers) ? layers : [],
    Array.isArray(forbiddenSuffixes) ? forbiddenSuffixes : [],
    dialect,
  );
  return validateScenarioTrace(evidence, { layers });
}

const REQUIREMENT_ID = /\bREQ-[A-Z][A-Z0-9]*-[0-9]{3,}\b/gu;
const ACCEPTANCE_ID = /\bAC-[A-Z][A-Z0-9]*-[0-9]{3,}\b/gu;
const SCENARIO_ID = /\bSCN-[A-Z0-9-]+\b/gu;
const REQUIREMENT_HEADING =
  /^#{2,6}\s+(REQ-[A-Z][A-Z0-9]*-[0-9]{3,})(?:\s+.+)?\s*$/u;

interface RequirementDefinition {
  id: string;
  file: string;
  line: number;
  acceptanceIds: string[];
  implementationPaths: string[];
}

interface TraceRow {
  requirementIds: string[];
  acceptanceIds: string[];
  scenarioIds: string[];
  featurePaths: string[];
  implementationPaths: string[];
  line: number;
}

interface ScenarioDefinition {
  id: string;
  source: string;
}

export interface SpecNormalizationResult {
  valid: boolean;
  errors: string[];
  requirements: string[];
  indexedRequirements: string[];
  scenarios: string[];
  orphanRequirements: string[];
  orphanScenarios: string[];
  orphanImplementations: string[];
  operationCount: number;
}

export interface TraceGateResult {
  valid: boolean;
  errors: string[];
  specs: ReturnType<typeof validateSpecs>;
  scenarios: ReturnType<typeof checkProjectTrace>;
  normalization: SpecNormalizationResult;
}

function relativePath(root: string, file: string) {
  return path.relative(root, file).split(path.sep).join("/");
}

function tableCells(line: string): string[] {
  if (!line.trim().startsWith("|")) return [];
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function matchingIds(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[0]);
}

function markdownPaths(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/gu)]
    .map((match) => match[1] ?? "")
    .filter((candidate) => candidate.includes("/"))
    .map((candidate) => candidate.replaceAll("\\", "/"));
}

function collectRequirementDefinitions(
  root: string,
  markdownFiles: string[],
): { definitions: RequirementDefinition[]; operationCount: number } {
  const definitions: RequirementDefinition[] = [];
  let operationCount = 0;
  for (const file of markdownFiles) {
    const source = relativePath(root, file);
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      operationCount += 1;
      const heading = REQUIREMENT_HEADING.exec(lines[index] ?? "");
      if (!heading?.[1]) continue;
      let end = index + 1;
      while (end < lines.length && !/^#{1,6}\s+/u.test(lines[end] ?? "")) {
        operationCount += 1;
        end += 1;
      }
      const body = lines.slice(index + 1, end).join("\n");
      definitions.push({
        id: heading[1],
        file: source,
        line: index + 1,
        acceptanceIds: matchingIds(body, ACCEPTANCE_ID),
        implementationPaths: markdownPaths(
          body
            .split(/\r?\n/u)
            .filter((line) => /^\s*-\s*実装:/u.test(line))
            .join("\n"),
        ),
      });
    }
  }
  return { definitions, operationCount };
}

function collectIndexedRequirements(indexFile: string): string[] {
  if (!fs.existsSync(indexFile)) return [];
  const ids = new Set<string>();
  for (const line of fs.readFileSync(indexFile, "utf8").split(/\r?\n/u)) {
    const cells = tableCells(line);
    if (cells[0] && /^REQ-[A-Z][A-Z0-9]*-[0-9]{3,}$/u.test(cells[0]))
      ids.add(cells[0]);
  }
  return [...ids].sort();
}

function collectTraceRows(traceFile: string): TraceRow[] {
  if (!fs.existsSync(traceFile)) return [];
  const rows: TraceRow[] = [];
  const lines = fs.readFileSync(traceFile, "utf8").split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const cells = tableCells(lines[index] ?? "");
    if (cells.length < 7 || !REQUIREMENT_ID.test(cells[0] ?? "")) {
      REQUIREMENT_ID.lastIndex = 0;
      continue;
    }
    REQUIREMENT_ID.lastIndex = 0;
    rows.push({
      requirementIds: matchingIds(cells[0] ?? "", REQUIREMENT_ID),
      acceptanceIds: matchingIds(cells[1] ?? "", ACCEPTANCE_ID),
      scenarioIds: matchingIds(cells[2] ?? "", SCENARIO_ID),
      featurePaths: markdownPaths(cells[4] ?? ""),
      implementationPaths: markdownPaths(cells[5] ?? ""),
      line: index + 1,
    });
  }
  return rows;
}

function collectScenarios(
  root: string,
  dialect: Dialect,
): ScenarioDefinition[] {
  return walkFiles(path.join(root, "test", "features"), (file) =>
    file.endsWith(".feature"),
  ).flatMap((file) => {
    const source = relativePath(root, file);
    return parseProjectGherkin(fs.readFileSync(file, "utf8"), dialect).map(
      ({ id }) => ({ id, source }),
    );
  });
}

function isSafeRepositoryPath(candidate: string): boolean {
  return (
    candidate.length > 0 &&
    candidate === path.posix.normalize(candidate) &&
    !path.posix.isAbsolute(candidate) &&
    candidate !== ".." &&
    !candidate.startsWith("../")
  );
}

function addEdge(
  graph: Map<string, Set<string>>,
  reverse: Map<string, Set<string>>,
  from: string,
  to: string,
) {
  const outgoing = graph.get(from) ?? new Set<string>();
  outgoing.add(to);
  graph.set(from, outgoing);
  const incoming = reverse.get(to) ?? new Set<string>();
  incoming.add(from);
  reverse.set(to, incoming);
}

function reachableFrom(
  starts: Iterable<string>,
  graph: Map<string, Set<string>>,
): { nodes: Set<string>; operations: number } {
  const nodes = new Set(starts);
  const queue = [...nodes];
  let cursor = 0;
  let operations = queue.length;
  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    for (const target of graph.get(current ?? "") ?? []) {
      operations += 1;
      if (nodes.has(target)) continue;
      nodes.add(target);
      queue.push(target);
    }
  }
  return { nodes, operations };
}

function definitionLocations(definitions: RequirementDefinition[]) {
  const locations = new Map<string, string[]>();
  for (const definition of definitions) {
    const files = locations.get(definition.id) ?? [];
    files.push(`${definition.file}:${definition.line}`);
    locations.set(definition.id, files);
  }
  return locations;
}

function detectTraceOnlyBodies(
  root: string,
  traceFiles: string[],
  definedIds: Set<string>,
): string[] {
  const errors: string[] = [];
  for (const file of traceFiles) {
    if (relativePath(root, file) === "docs/specs/15_要件追跡/00_追跡表.md")
      continue;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const cells = tableCells(lines[index] ?? "");
      const ids = matchingIds(cells[0] ?? "", REQUIREMENT_ID);
      if (ids.length === 0 || !cells[1] || /^AC-/u.test(cells[1])) continue;
      for (const id of ids) {
        if (!definedIds.has(id))
          errors.push(
            `15_要件追跡にしか要件本文がありません: ${id} (${relativePath(root, file)}:${index + 1})`,
          );
      }
    }
  }
  return errors;
}

export function checkSpecNormalization(
  root: string,
  dialect: Dialect = "en",
): SpecNormalizationResult {
  const errors: string[] = [];
  const specsRoot = path.join(root, "docs", "specs");
  const markdownFiles = walkRepositoryFiles(root, (file) =>
    file.endsWith(".md"),
  );
  const collected = collectRequirementDefinitions(root, markdownFiles);
  let operationCount = collected.operationCount + markdownFiles.length;
  const locations = definitionLocations(collected.definitions);
  const definedIds = new Set(locations.keys());
  const indexedRequirements = collectIndexedRequirements(
    path.join(specsRoot, "02_要件", "00_要件一覧.md"),
  );
  const indexedIds = new Set(indexedRequirements);

  for (const [id, files] of locations) {
    operationCount += files.length;
    if (files.length > 1)
      errors.push(`要件IDが重複しています: ${id}: ${files.join(", ")}`);
  }
  for (const definition of collected.definitions) {
    if (!definition.file.startsWith("docs/specs/02_要件/"))
      errors.push(
        `所定location外に要件本文があります: ${definition.id} (${definition.file}:${definition.line})`,
      );
    if (definition.acceptanceIds.length === 0)
      errors.push(`要件に受け入れ条件がありません: ${definition.id}`);
  }
  for (const id of indexedIds) {
    operationCount += 1;
    if (!definedIds.has(id))
      errors.push(`要件の二重列挙で索引にだけ存在します: ${id}`);
  }
  for (const id of definedIds) {
    operationCount += 1;
    if (!indexedIds.has(id))
      errors.push(`要件の二重列挙で定義にだけ存在します: ${id}`);
  }

  const traceRoot = path.join(specsRoot, "15_要件追跡");
  const traceFiles = walkFiles(traceRoot, (file) => file.endsWith(".md"));
  errors.push(...detectTraceOnlyBodies(root, traceFiles, definedIds));
  const traceFile = path.join(traceRoot, "00_追跡表.md");
  const traceRows = collectTraceRows(traceFile);
  const scenarios = collectScenarios(root, dialect);
  const scenariosById = new Map<string, ScenarioDefinition[]>();
  for (const scenario of scenarios) {
    const definitions = scenariosById.get(scenario.id) ?? [];
    definitions.push(scenario);
    scenariosById.set(scenario.id, definitions);
    operationCount += 1;
  }

  const graph = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();
  const declaredImplementations = new Set<string>();
  const acceptanceByRequirement = new Map<string, Set<string>>();
  for (const definition of collected.definitions) {
    const requirementNode = `req:${definition.id}`;
    const acceptanceIds =
      acceptanceByRequirement.get(definition.id) ?? new Set();
    for (const acceptanceId of definition.acceptanceIds)
      addEdge(graph, reverse, requirementNode, `ac:${acceptanceId}`);
    for (const acceptanceId of definition.acceptanceIds)
      acceptanceIds.add(acceptanceId);
    acceptanceByRequirement.set(definition.id, acceptanceIds);
    for (const implementationPath of definition.implementationPaths)
      declaredImplementations.add(implementationPath);
  }

  for (const row of traceRows) {
    operationCount += 1;
    for (const requirementId of row.requirementIds) {
      if (!definedIds.has(requirementId))
        errors.push(
          `追跡表から要件一覧への未解決参照です: ${requirementId} (${relativePath(root, traceFile)}:${row.line})`,
        );
      const expectedAcceptanceId = requirementId.replace(/^REQ-/u, "AC-");
      if (
        !row.acceptanceIds.includes(expectedAcceptanceId) ||
        !(
          acceptanceByRequirement
            .get(requirementId)
            ?.has(expectedAcceptanceId) ?? false
        )
      )
        errors.push(
          `追跡表から受け入れ条件への未解決参照です: ${requirementId} -> ${expectedAcceptanceId} (${relativePath(root, traceFile)}:${row.line})`,
        );
      else
        addEdge(
          graph,
          reverse,
          `req:${requirementId}`,
          `ac:${expectedAcceptanceId}`,
        );
    }
    for (const scenarioId of row.scenarioIds) {
      const definitions = scenariosById.get(scenarioId) ?? [];
      const exactSources = new Set(definitions.map(({ source }) => source));
      if (row.featurePaths.length === 0)
        errors.push(
          `SCN参照にはFeatureの完全pathが必要です: ${scenarioId} (${relativePath(root, traceFile)}:${row.line})`,
        );
      for (const featurePath of row.featurePaths) {
        if (!isSafeRepositoryPath(featurePath)) {
          errors.push(
            `SCN参照のFeature pathが不正です: ${featurePath} (${relativePath(root, traceFile)}:${row.line})`,
          );
          continue;
        }
        if (!exactSources.has(featurePath)) {
          errors.push(
            `SCN参照のFeatureを完全pathで解決できません: ${scenarioId} -> ${featurePath} (${relativePath(root, traceFile)}:${row.line})`,
          );
          continue;
        }
        for (const acceptanceId of row.acceptanceIds)
          addEdge(graph, reverse, `ac:${acceptanceId}`, `scn:${scenarioId}`);
        addEdge(graph, reverse, `scn:${scenarioId}`, `test:${featurePath}`);
        for (const implementationPath of row.implementationPaths) {
          if (!isSafeRepositoryPath(implementationPath)) {
            errors.push(
              `追跡表の実装pathが不正です: ${implementationPath} (${relativePath(root, traceFile)}:${row.line})`,
            );
            continue;
          }
          if (!fs.existsSync(path.join(root, implementationPath))) {
            errors.push(
              `追跡表の実装pathを解決できません: ${implementationPath} (${relativePath(root, traceFile)}:${row.line})`,
            );
            continue;
          }
          addEdge(
            graph,
            reverse,
            `test:${featurePath}`,
            `impl:${implementationPath}`,
          );
        }
      }
    }
  }

  const requirementNodes = [...definedIds].map((id) => `req:${id}`);
  const forward = reachableFrom(requirementNodes, graph);
  const reverseFromScenarios = reachableFrom(
    scenarios.map(({ id }) => `scn:${id}`),
    reverse,
  );
  operationCount += forward.operations + reverseFromScenarios.operations;
  const orphanRequirements = [...definedIds]
    .filter((id) => !reverseFromScenarios.nodes.has(`req:${id}`))
    .sort();
  const orphanScenarios = [...scenariosById.keys()]
    .filter((id) => !forward.nodes.has(`scn:${id}`))
    .sort();
  const orphanImplementations = [...declaredImplementations]
    .filter(
      (implementationPath) => !forward.nodes.has(`impl:${implementationPath}`),
    )
    .sort();
  if (orphanRequirements.length > 0)
    errors.push(
      `孤立要件です。どのSCNへも到達できません: ${orphanRequirements.join(", ")}`,
    );
  if (orphanScenarios.length > 0)
    errors.push(
      `孤立SCNです。どの要件からも到達できません: ${orphanScenarios.join(", ")}`,
    );
  if (orphanImplementations.length > 0)
    errors.push(
      `孤立実装です。要件からtestを経由して到達できません: ${orphanImplementations.join(", ")}`,
    );

  const scenarioDefinitionFiles = walkRepositoryFiles(
    root,
    (file) => file.endsWith(".md") || file.endsWith(".feature"),
  );
  for (const file of scenarioDefinitionFiles) {
    if (
      relativePath(root, file).startsWith("test/features/") &&
      file.endsWith(".feature")
    )
      continue;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      if (
        /^\s*(?:Scenario(?: Outline)?|シナリオ(?:アウトライン)?):\s+SCN-/u.test(
          lines[index] ?? "",
        )
      )
        errors.push(
          `所定location外にSCN定義があります: ${relativePath(root, file)}:${index + 1}`,
        );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    requirements: [...definedIds].sort(),
    indexedRequirements,
    scenarios: [...scenariosById.keys()].sort(),
    orphanRequirements,
    orphanScenarios,
    orphanImplementations,
    operationCount,
  };
}

export function checkTraceGate(
  root: string,
  options?: { dialect: Dialect; layers: string[] },
): TraceGateResult {
  const scenarios = options
    ? validateScenarioTrace(
        collectProjectTrace(root, options.layers, [], options.dialect),
        { layers: options.layers },
      )
    : checkProjectTrace(root);
  const specs = validateSpecs(root);
  const dialect = options?.dialect ?? "en";
  const normalization = checkSpecNormalization(root, dialect);
  const errors = [
    ...specs.errors,
    ...scenarios.errors,
    ...normalization.errors,
  ];
  return {
    valid: specs.valid && scenarios.valid && normalization.valid,
    errors,
    specs,
    scenarios,
    normalization,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const result = checkTraceGate(process.cwd());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}
