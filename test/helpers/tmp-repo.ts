import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { versionMarkerRelativePath } from '../../src/lib/version-marker.js';

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

  // 本物のリポジトリ（このパッケージ自身）の .agent-skill-chain/ を複製するが、
  // .installed_version は init 実行によって生成される実行時状態でありテンプレートに含めない
  // （本物側で init 済みだとテスト fixture が「init未導入」を装えなくなる）。
  const installedVersionAbs = path.join(packageRoot, versionMarkerRelativePath());
  fs.cpSync(path.join(packageRoot, '.agent-skill-chain'), path.join(dir, '.agent-skill-chain'), {
    recursive: true,
    filter: (src) => src !== installedVersionAbs,
  });
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

export type ReviewAdapter = 'claude' | 'codex' | 'human';

/**
 * review.adapter を書き換える。
 *
 * 書き換え前後でテキストが変わらないこと（= 既に目的の値だった場合）を失敗とはしない
 * （本物のリポジトリ側の既定値が変わった場合に誤って no-op 判定してしまうバグの修正）。
 * 代わりに、書き換え後のファイルを読み直し、実際に目的の adapter 値になっていることを検証する。
 */
export function setAdapter(repoDir: string, adapter: ReviewAdapter): void {
  const configPath = path.join(repoDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  const text = fs.readFileSync(configPath, 'utf8');
  const patched = text.replace(/adapter: \w+/, `adapter: ${adapter}`);
  fs.writeFileSync(configPath, patched);

  const after = fs.readFileSync(configPath, 'utf8');
  if (!new RegExp(`adapter: ${adapter}\\b`).test(after)) {
    throw new Error(`review.adapter を ${adapter} へ書き換えられませんでした（config/agent-skill-chain.yaml の書式が変わった可能性）`);
  }
}

/**
 * review.adapter 行そのものを config から取り除く（schema上 review.adapter は任意項目）。
 * CLI 側の既定値フォールバック（未設定時 claude）を、本物のリポジトリ側の現在値に依存せず検証するために使う。
 *
 * review: ブロック直下の adapter 行のみを対象にする（worker.adapter 行も同名で存在するため、
 * ブロックを跨いだ誤マッチを避ける）。
 */
export function unsetAdapter(repoDir: string): void {
  const configPath = path.join(repoDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  const text = fs.readFileSync(configPath, 'utf8');
  const patched = text.replace(/(review:\n)(\s*adapter: \w+.*\n)/, '$1');
  fs.writeFileSync(configPath, patched);

  const after = fs.readFileSync(configPath, 'utf8');
  if (/review:\n\s*adapter: \w+/.test(after)) {
    throw new Error('review.adapter 行を削除できませんでした（config/agent-skill-chain.yaml の書式が変わった可能性）');
  }
}

/**
 * worker.adapter を書き換える（launch_worker が起動するセグメント作業ワーカーの実体）。
 * setAdapter と同型だが、review: ブロックの adapter 行と誤マッチしないよう worker: ブロックに
 * スコープする。
 */
export function setWorkerAdapter(repoDir: string, adapter: ReviewAdapter): void {
  const configPath = path.join(repoDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  const text = fs.readFileSync(configPath, 'utf8');
  const patched = text.replace(/(worker:\n\s*adapter: )\w+/, `$1${adapter}`);
  fs.writeFileSync(configPath, patched);

  const after = fs.readFileSync(configPath, 'utf8');
  if (!new RegExp(`worker:\\n\\s*adapter: ${adapter}\\b`).test(after)) {
    throw new Error(`worker.adapter を ${adapter} へ書き換えられませんでした（config/agent-skill-chain.yaml の書式が変わった可能性）`);
  }
}

/**
 * worker.adapter 行そのものを config から取り除く（schema上 worker.adapter は任意項目）。
 * CLI 側の既定値フォールバック（未設定時 human）を検証するために使う。
 */
export function unsetWorkerAdapter(repoDir: string): void {
  const configPath = path.join(repoDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml');
  const text = fs.readFileSync(configPath, 'utf8');
  const patched = text.replace(/(worker:\n)(\s*adapter: \w+.*\n)/, '$1');
  fs.writeFileSync(configPath, patched);

  const after = fs.readFileSync(configPath, 'utf8');
  if (/worker:\n\s*adapter: \w+/.test(after)) {
    throw new Error('worker.adapter 行を削除できませんでした（config/agent-skill-chain.yaml の書式が変わった可能性）');
  }
}
