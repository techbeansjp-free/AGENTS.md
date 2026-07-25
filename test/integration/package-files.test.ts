import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Issue #244: npm package の配布境界を実測し、consumer project へ導入しない運用状態・
// 自己拡張ポリシー・保守者資産が混入しないことを確認する。

const packageRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

interface PackEntry {
  path: string;
}

let cachedPackFiles: string[] | undefined;

function npmPackDryRunFiles(): string[] {
  if (cachedPackFiles) return cachedPackFiles;

  // npm pack は --ignore-scripts でも prepare（tsc）を実行する。node:test の別テストが共有 bin/
  // を実行中に再生成すると、書換え途中のCLIを読み得る。pack対象assetだけを隔離コピーし、
  // そのコピーのprepareを除いてmanifestによる収録ファイル集合を測定する。
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-pack-test-'));
  try {
    for (const entry of [
      'package.json',
      'README.md',
      'AGENTS.md',
      'CLAUDE.md',
      'docs',
      'bin',
      '.agent-skill-chain',
    ]) {
      fs.cpSync(path.join(packageRoot, entry), path.join(scratch, entry), { recursive: true });
    }
    const manifestPath = path.join(scratch, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    if (manifest.scripts) delete manifest.scripts.prepare;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const stdout = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: path.join(scratch, '.npm-cache') },
    });
    const parsed = JSON.parse(stdout) as { files: PackEntry[] }[];
    cachedPackFiles = parsed[0].files.map((f) => f.path);
    return cachedPackFiles;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
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
