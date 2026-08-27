import fs from "node:fs";
import path from "node:path";

import { validateDependencyGraph } from "../src/domain/trace.js";
import { isExecutionEntry } from "../src/lib/entrypoint.js";

function typeScriptFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) return typeScriptFiles(resolved);
    return entry.isFile() && resolved.endsWith(".ts") ? [resolved] : [];
  });
}

/** Collect this repository's TypeScript import graph for the generic cycle validator. */
export function collectTypeScriptDependencyGraph(root: string) {
  const absoluteFiles = ["src", "bin", "scripts"]
    .flatMap((directory) => typeScriptFiles(path.join(root, directory)))
    .sort();
  const byAbsolute = new Map(
    absoluteFiles.map((file) => [
      path.resolve(file),
      path.relative(root, file).split(path.sep).join("/"),
    ]),
  );
  const nodes = [...byAbsolute.values()];
  const edges: Array<{ from: string; to: string }> = [];
  for (const file of absoluteFiles) {
    const source = fs.readFileSync(file, "utf8");
    const specifiers = [
      ...source.matchAll(
        /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.\.?\/[^'"]+)['"]/gu,
      ),
    ].map((match) => match[1]);
    for (const specifier of specifiers) {
      const unresolved = path.resolve(path.dirname(file), specifier);
      const resolved = path.extname(unresolved)
        ? unresolved.replace(/\.js$/u, ".ts")
        : `${unresolved}.ts`;
      const target = byAbsolute.get(resolved);
      const sourceNode = byAbsolute.get(path.resolve(file));
      if (target && sourceNode) edges.push({ from: sourceNode, to: target });
    }
  }
  return { nodes, edges };
}

export function checkTypeScriptDependencyGraph(root: string) {
  const graph = collectTypeScriptDependencyGraph(root);
  return validateDependencyGraph(graph.nodes, graph.edges);
}

if (isExecutionEntry(import.meta.url)) {
  const result = checkTypeScriptDependencyGraph(process.cwd());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}
