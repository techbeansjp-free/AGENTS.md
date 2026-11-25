// Creates or removes the two isolation-probe marker files (owner requirement): one in the real HOME and one in this
// repository under the git-ignored .agent-skill-chain/local/. Each holds a random token that must never appear in any
// probe record. Only these two exact files are written or removed; an existing file is never overwritten.
// Usage: node markers.mjs create|remove <repo-root>     (prints the two paths on create)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const markerPaths = (repoRoot) => ({
  home: path.join(os.homedir(), 'asc1814-isolation-marker.txt'),
  repo: path.join(path.resolve(repoRoot), '.agent-skill-chain/local/asc1814-isolation-marker.txt'),
});

if (import.meta.url === `file://${process.argv[1]}`) {
  const [action, repoRoot] = process.argv.slice(2);
  const p = markerPaths(repoRoot);
  if (action === 'create') {
    for (const f of Object.values(p)) {
      fs.mkdirSync(path.dirname(f), {recursive: true});
      fs.writeFileSync(f, `ASC1814-MARKER-${crypto.randomBytes(12).toString('hex')}\n`, {flag: 'wx', mode: 0o600});
    }
    console.log(JSON.stringify(p));
  } else if (action === 'remove') {
    for (const f of Object.values(p)) fs.rmSync(f, {force: true});
    console.log(JSON.stringify({removed: Object.values(p).length}));
  } else {
    console.error('usage: node markers.mjs create|remove <repo-root>');
    process.exit(2);
  }
}
