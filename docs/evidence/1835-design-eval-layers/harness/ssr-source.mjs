// Writes the SSR tool (ssr.py) recorded in SSR_SOURCE.md to a file outside the repository, and checks its sha256
// against the hash of the file used in the main run. The repository keeps no .py source (TypeScript-only policy).
// Usage: node harness/ssr-source.mjs <out.py>
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SSR_SHA256 = 'af4d175da3c06b4514aa319d0f2910a08a55080d9b4908cf00e1c5d2e4af2855';

export function ssrSource(md = fs.readFileSync(path.join(here, 'SSR_SOURCE.md'), 'utf8')) {
  const m = md.match(/\n```python\n([\s\S]*?)```\n/);
  if (!m) throw new Error('SSR_SOURCE.md has no python block');
  const sha = crypto.createHash('sha256').update(m[1]).digest('hex');
  if (sha !== SSR_SHA256) throw new Error(`ssr.py sha256 ${sha} does not match ${SSR_SHA256}`);
  return m[1];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2];
  if (!out) { console.error('usage: ssr-source.mjs <out.py>'); process.exit(2); }
  fs.writeFileSync(path.resolve(out), ssrSource());
  console.log(`wrote ${out} (sha256 ${SSR_SHA256})`);
}
