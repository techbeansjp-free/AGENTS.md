import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

export interface TmpRepo {
  dir: string;
  remoteDir: string;
  cleanup(): void;
}

export type CoordinationBackend = 'local' | 'github';

/**
 * `.agent-skill-chain/` 正本資産一式を複製した、独立した bare remote 付きの一時 git repo を作る。
 * setup を経由せず、テストが必要とする最小限のリポジトリ状態を直接組み立てる
 * （setup コマンド自体のテストは test/integration/setup.test.ts が別途担う）。
 *
 * backend: 'local' なら config/agent-skill-chain.yaml の coordination.backend を local に書き換える
 * （既定の github だと lease/issue resume/cleanup 等が gh 呼び出しを要求し、gh-stub 無しでは
 * テストできないため）。
 */
export function createTmpRepo({ backend = 'local' }: { backend?: CoordinationBackend } = {}): TmpRepo {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-repo-'));
  const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-chain-remote-'));
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remoteDir], { stdio: 'pipe' });

  git(dir, ['init', '--initial-branch=main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'agent-skill-chain test']);
  git(dir, ['remote', 'add', 'origin', remoteDir]);

  fs.cpSync(path.join(packageRoot, '.agent-skill-chain'), path.join(dir, '.agent-skill-chain'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.copyFileSync(path.join(packageRoot, 'docs', 'GLOSSARY.md'), path.join(dir, 'docs', 'GLOSSARY.md'));
  fs.copyFileSync(path.join(packageRoot, 'AGENTS.md'), path.join(dir, 'AGENTS.md'));

  if (backend === 'local') {
    const configPath = path.join(dir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
    const text = fs.readFileSync(configPath, 'utf8');
    const patched = text.replace('backend: github            # github | local', 'backend: local              # github | local');
    if (patched === text) {
      throw new Error('coordination.backend: github の書き換えに失敗しました（config/agent-skill-chain.yaml の書式が変わった可能性）');
    }
    fs.writeFileSync(configPath, patched);
  }

  fs.writeFileSync(path.join(dir, 'README.md'), '# test fixture repo\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'chore: initial commit']);
  git(dir, ['push', '-u', 'origin', 'main']);

  return {
    dir,
    remoteDir,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(remoteDir, { recursive: true, force: true });
    },
  };
}

/** worktree.timestamp.format（既定 "%Y%m%d_%H%M%S"）に適合する固定タイムスタンプ。 */
export const FIXED_TIMESTAMP = '20260101_000000';
