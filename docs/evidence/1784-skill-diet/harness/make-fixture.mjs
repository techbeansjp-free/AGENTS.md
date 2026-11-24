// Usage: node make-fixture.mjs <repoRoot> <A|B|C> <outDir>
// Builds a consumer project: the npm package file set is registered with `project-assets --register-claude-skill --apply`.
// A: the asc Skill (entry, shared copy, managed-runtime copy) is removed. B: current Skill. C: make-candidate.mjs applied.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [repoRoot, cond, outDir] = process.argv.slice(2);
if (!['A', 'B', 'C'].includes(cond)) throw Error('cond must be A, B or C');
const here = path.dirname(new URL(import.meta.url).pathname);
if (fs.existsSync(outDir)) throw Error('outDir must not exist');
const pkg = outDir + '.pkg';
fs.rmSync(pkg, { recursive: true, force: true });
const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
for (const { path: rel } of packed[0].files) {
  fs.mkdirSync(path.join(pkg, path.dirname(rel)), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, rel), path.join(pkg, rel));
}
if (cond === 'C') execFileSync('node', [path.join(here, 'make-candidate.mjs'), path.join(pkg, 'skills/asc')]);

const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(outDir, rel)), { recursive: true }); fs.writeFileSync(path.join(outDir, rel), text); };
write('package.json', JSON.stringify({ name: 'sample-shop', version: '1.0.0', type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n');
write('README.md', '# sample-shop\n\n小さな価格計算ライブラリ。\n');
write('src/price.mjs', '// Round a price up to the next 10 yen.\nexport function roundPrice(yen) {\n  return Math.ceil(yen / 10) * 10;\n}\n\nexport function withTax(yen, rate = 0.1) {\n  return roundPrice(yen * (1 + rate));\n}\n');
write('test/price.test.mjs', "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { roundPrice } from '../src/price.mjs';\n\ntest('rounds up to 10 yen', () => {\n  assert.equal(roundPrice(101), 110);\n});\n");
execFileSync('node', [path.join(pkg, 'bin/asc-v05.mjs'), 'project-assets', outDir, '--register-claude-skill', '--apply'], { stdio: 'ignore' });
if (cond === 'A') {
  for (const rel of ['.claude/skills/asc', '.agent-skill-chain/skills/asc', '.agent-skill-chain/managed-runtime/skills/asc']) {
    if (!fs.existsSync(path.join(outDir, rel))) throw Error('missing ' + rel);
    fs.rmSync(path.join(outDir, rel), { recursive: true });
  }
}
fs.rmSync(pkg, { recursive: true, force: true });
