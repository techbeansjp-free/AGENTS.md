import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Issue #244: npm package の配布境界を実測し、consumer project へ導入しない運用状態・
// 自己拡張ポリシー・保守者資産が混入しないことを確認する。

const packageRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

interface PackEntry {
  path: string;
}

function npmPackDryRunFiles(): string[] {
  const stdout = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: packageRoot, encoding: 'utf8' });
  const parsed = JSON.parse(stdout) as { files: PackEntry[] }[];
  return parsed[0].files.map((f) => f.path);
}

test('npm pack --dry-run: runtime状態・自己拡張ポリシー・保守者資産が配布物に含まれない', () => {
  const files = npmPackDryRunFiles();

  assert.ok(
    !files.some((f) => f.startsWith('.agent-skill-chain/runtime/')),
    '.agent-skill-chain/runtime/ 配下が含まれないこと',
  );
  assert.ok(
    !files.some((f) => f.startsWith('.agent-skill-chain/project/')),
    '.agent-skill-chain/project/ 配下が含まれないこと',
  );
  assert.ok(!files.includes('.agent-skill-chain/.installed_version'), '.installed_version が含まれないこと');
  assert.ok(!files.some((f) => f.startsWith('src/')), 'src/ 配下が含まれないこと');
  assert.ok(!files.some((f) => f.startsWith('test/')), 'test/ 配下が含まれないこと');
  assert.ok(!files.some((f) => f.startsWith('tsconfig')), 'tsconfig*.json が含まれないこと');
  assert.ok(!files.some((f) => f === 'CONTRIBUTING.md'), 'CONTRIBUTING.md が含まれないこと');
  assert.ok(!files.some((f) => f.startsWith('docs/adr/')), 'docs/adr/ が含まれないこと');
  assert.ok(!files.some((f) => f.startsWith('docs/maintainer/')), 'docs/maintainer/ が含まれないこと');
});

test('npm pack --dry-run: init/upgrade の全配布 namespace とルート資産は欠落していない', () => {
  const files = npmPackDryRunFiles();

  assert.ok(files.includes('bin/agents-md.js'), 'bin/agents-md.js が含まれること');
  const requiredAssets = [
    ['adapters', 'claude.sh'],
    ['ci', 'verify-ac-coverage.sh'],
    ['config', 'agent-skill-chain.yaml'],
    ['hooks', 'claude-pretooluse.sh'],
    ['schemas', 'config.schema.yaml'],
    ['scripts', 'init.sh'],
    ['standards', 'GIT_CONVENTIONS.md'],
    ['templates', 'issue', 'SPEC.md'],
  ];
  for (const asset of requiredAssets) {
    const assetPath = path.join('.agent-skill-chain', ...asset);
    assert.ok(files.includes(assetPath), `${assetPath} が含まれること`);
  }
  assert.ok(files.includes('AGENTS.md'), 'AGENTS.md が含まれること');
  assert.ok(files.includes('CLAUDE.md'), 'CLAUDE.md が含まれること');
  assert.ok(files.includes(path.join('docs', 'GLOSSARY.md')), 'docs/GLOSSARY.md が含まれること');
});
