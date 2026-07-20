import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
export const binPath = path.join(packageRoot, 'bin', 'agents-md.js');

export interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface RunCliOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
}

/**
 * ビルド後の bin/agents-md.js を子プロセスとして実行し、終了コード・標準出力・標準エラー出力を
 * まとめて返す。実際に npx 経由で実行される成果物そのものに対してテストするための薄いラッパー。
 *
 * spawnSync を使う（execFileSync ではない）: execFileSync は終了コード0の場合 stderr を戻り値に
 * 含めない（例外時のみ .stderr が取れる）ため、成功時に非推奨警告等をstderrへ出す挙動を
 * テストできない（Issue #169 で判明）。spawnSync は成功・失敗いずれも stdout/stderr を返す。
 */
export function runCli(args: string[], options: RunCliOptions = {}): CliResult {
  const result = spawnSync('node', [binPath, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env ?? process.env,
    input: options.input,
  });
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}
