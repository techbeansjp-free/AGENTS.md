import { spawnSync } from 'node:child_process';

export interface ExecResult {
  status: number;
  stdout: string;
  stderr: string;
}

export function run(command: string, args: string[], cwd?: string, input?: string): ExecResult {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', input });
  if (result.error) {
    return { status: 127, stdout: '', stderr: String(result.error.message) };
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** 失敗時に stderr を含めて例外を投げる薄いラッパー。標準出力の trim 済み文字列を返す。 */
export function runOrThrow(command: string, args: string[], cwd?: string): string {
  const result = run(command, args, cwd);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} が失敗しました（終了コード ${result.status}）: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export function git(args: string[], cwd?: string): ExecResult {
  return run('git', args, cwd);
}

export function gh(args: string[], cwd?: string, input?: string): ExecResult {
  return run('gh', args, cwd, input);
}

export function commandExists(command: string): boolean {
  const probe = run(process.platform === 'win32' ? 'where' : 'which', [command]);
  return probe.status === 0;
}
