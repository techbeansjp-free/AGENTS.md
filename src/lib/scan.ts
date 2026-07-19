import fs from 'node:fs';
import path from 'node:path';
import { ASSET_NAMESPACE } from './paths.js';

const TEXT_EXTENSIONS = new Set(['.md', '.yaml', '.yml', '.sh', '.json', '.ts']);

/** AGENTS.md §参照・コメントの陳腐化防止 / §用語: 検査対象は「生きたファイル」（AGENTS.md・
 * .agent-skill-chain/{standards,templates,config,schemas,scripts,ci}/等）であり、
 * memo/等の非追跡scratchは対象外。 */
export function defaultLiveFileRoots(repoRoot: string): string[] {
  const roots = [path.join(repoRoot, 'AGENTS.md'), path.join(repoRoot, 'docs', 'GLOSSARY.md')];
  for (const dir of ['standards', 'templates', 'config', 'schemas', 'scripts', 'ci']) {
    roots.push(path.join(repoRoot, ASSET_NAMESPACE, dir));
  }
  return roots.filter((p) => fs.existsSync(p));
}

export function walkTextFiles(entryPaths: string[]): string[] {
  const files: string[] = [];
  function walk(p: string): void {
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(p)) walk(path.join(p, child));
      return;
    }
    if (TEXT_EXTENSIONS.has(path.extname(p))) files.push(p);
  }
  for (const entry of entryPaths) {
    if (fs.existsSync(entry)) walk(entry);
  }
  return files;
}
