import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateDependencyGraph } from '../src/domain/trace.js';

/** @param {string} directory @returns {string[]} */
function javascriptFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(resolved);
    return entry.isFile() && resolved.endsWith('.js') ? [resolved] : [];
  });
}

/** Collect this repository's JavaScript import graph for the generic cycle validator. @param {string} root */
export function collectJavaScriptDependencyGraph(root) {
  const absoluteFiles = ['src', 'bin', 'scripts'].flatMap((directory) => javascriptFiles(path.join(root, directory))).sort();
  const byAbsolute = new Map(absoluteFiles.map((file) => [path.resolve(file), path.relative(root, file).split(path.sep).join('/')]));
  const nodes = [...byAbsolute.values()];
  const edges = [];
  for (const file of absoluteFiles) {
    const source = fs.readFileSync(file, 'utf8');
    const specifiers = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.\.?\/[^'"]+)['"]/gu)].map((match) => match[1]);
    for (const specifier of specifiers) {
      const unresolved = path.resolve(path.dirname(file), specifier);
      const resolved = path.extname(unresolved) ? unresolved : `${unresolved}.js`;
      const target = byAbsolute.get(resolved);
      if (target) edges.push({ from: /** @type {string} */ (byAbsolute.get(path.resolve(file))), to: target });
    }
  }
  return { nodes, edges };
}

/** @param {string} root */
export function checkJavaScriptDependencyGraph(root) {
  const graph = collectJavaScriptDependencyGraph(root);
  return validateDependencyGraph(graph.nodes, graph.edges);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = checkJavaScriptDependencyGraph(process.cwd());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}
