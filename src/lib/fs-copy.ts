import fs from 'node:fs';
import path from 'node:path';

export interface CopyResult {
  path: string;
  action: 'created' | 'overwritten' | 'skipped';
}

export function copyTree(src: string, dest: string, mode: 'skip-existing' | 'overwrite'): CopyResult[] {
  const results: CopyResult[] = [];

  function walk(s: string, d: string): void {
    const stat = fs.statSync(s);
    if (stat.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      for (const child of fs.readdirSync(s)) {
        walk(path.join(s, child), path.join(d, child));
      }
      return;
    }
    const exists = fs.existsSync(d);
    if (exists && mode === 'skip-existing') {
      results.push({ path: d, action: 'skipped' });
      return;
    }
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(s, d);
    results.push({ path: d, action: exists ? 'overwritten' : 'created' });
  }

  if (fs.existsSync(src)) walk(src, dest);
  return results;
}
