import { spawnSync } from 'node:child_process';

export interface ExecResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface ExecBytesResult {
  status: number;
  stdout: Buffer;
  stderr: Buffer;
}

// Node既定の1MiB上限だと大規模diff等（例: mainとの初回統合マージの全差分）でENOBUFSになるため拡張する。
const MAX_BUFFER_BYTES = 256 * 1024 * 1024;

export function run(command: string, args: string[], cwd?: string, input?: string): ExecResult {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', input, maxBuffer: MAX_BUFFER_BYTES });
  if (result.error) {
    return { status: 127, stdout: '', stderr: String(result.error.message) };
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** バイナリblobを文字列変換せず取得するための薄い実行ラッパー。 */
export function runBytes(command: string, args: string[], cwd?: string, input?: Buffer): ExecBytesResult {
  const result = spawnSync(command, args, { cwd, input, maxBuffer: MAX_BUFFER_BYTES });
  if (result.error) {
    return { status: 127, stdout: Buffer.alloc(0), stderr: Buffer.from(result.error.message) };
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: result.stderr ?? Buffer.alloc(0),
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

export function git(args: string[], cwd?: string, input?: string): ExecResult {
  return run('git', args, cwd, input);
}

export function gitBytes(args: string[], cwd?: string, input?: Buffer): ExecBytesResult {
  return runBytes('git', args, cwd, input);
}

export function gh(args: string[], cwd?: string, input?: string): ExecResult {
  return run('gh', args, cwd, input);
}

export function commandExists(command: string): boolean {
  const probe = run(process.platform === 'win32' ? 'where' : 'which', [command]);
  return probe.status === 0;
}
