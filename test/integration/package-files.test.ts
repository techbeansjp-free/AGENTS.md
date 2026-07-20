import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Issue #169 T9: package.json の files フィールド追加後、npm pack --dry-run の出力に
// 開発用ファイル（src/*.ts・test/**/*.ts・tsconfig*.json等）が含まれず、配布必須ファイルが
// 欠落していないことを実測確認する（02_設計§9.2、03_実装計画2.9）。

const packageRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

interface PackEntry {
  path: string;
}

function npmPackDryRunFiles(): string[] {
  const stdout = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: packageRoot, encoding: 'utf8' });
  const parsed = JSON.parse(stdout) as { files: PackEntry[] }[];
  return parsed[0].files.map((f) => f.path);
}

test('npm pack --dry-run: 開発用ファイル（src/・test/・tsconfig）が配布物に含まれない', () => {
  const files = npmPackDryRunFiles();

  assert.ok(!files.some((f) => f.startsWith('src/')), 'src/ 配下が含まれないこと');
  assert.ok(!files.some((f) => f.startsWith('test/')), 'test/ 配下が含まれないこと');
  assert.ok(!files.some((f) => f.startsWith('tsconfig')), 'tsconfig*.json が含まれないこと');
  assert.ok(!files.some((f) => f === 'CONTRIBUTING.md'), 'CONTRIBUTING.md が含まれないこと');
  assert.ok(!files.some((f) => f.startsWith('docs/adr/')), 'docs/adr/ が含まれないこと');
  assert.ok(!files.some((f) => f.startsWith('docs/maintainer/')), 'docs/maintainer/ が含まれないこと');
});

test('npm pack --dry-run: 配布必須ファイル（bin/・config・AGENTS.md等）は欠落していない', () => {
  const files = npmPackDryRunFiles();

  assert.ok(files.includes('bin/agents-md.js'), 'bin/agents-md.js が含まれること');
  assert.ok(
    files.includes(path.join('.agent-skill-chain', 'config', 'agent-skill-chain.yaml')),
    '.agent-skill-chain/config/agent-skill-chain.yaml が含まれること',
  );
  assert.ok(
    files.includes(path.join('.agent-skill-chain', 'hooks', 'claude-pretooluse.sh')),
    '.agent-skill-chain/hooks/claude-pretooluse.sh が含まれること（Issue #169新設アセット）',
  );
  assert.ok(files.includes('AGENTS.md'), 'AGENTS.md が含まれること');
  assert.ok(files.includes('CLAUDE.md'), 'CLAUDE.md が含まれること');
  assert.ok(files.includes(path.join('docs', 'GLOSSARY.md')), 'docs/GLOSSARY.md が含まれること');
});
