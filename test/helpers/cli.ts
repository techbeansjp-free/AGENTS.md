import { execFileSync } from 'node:child_process';
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
 */
export function runCli(args: string[], options: RunCliOptions = {}): CliResult {
  try {
    const stdout = execFileSync('node', [binPath, ...args], {
      cwd: options.cwd,
      encoding: 'utf8',
      env: options.env ?? process.env,
      input: options.input,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const execError = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      status: typeof execError.status === 'number' ? execError.status : 1,
      stdout: execError.stdout?.toString() ?? '',
      stderr: execError.stderr?.toString() ?? '',
    };
  }
}
