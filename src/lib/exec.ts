import { spawnSync } from 'node:child_process';

export interface ExecResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface BinaryExecResult {
  status: number;
  stdout: Buffer;
  stderr: string;
}

/** `git ... -z` のNUL区切りpathを、改行や非ASCIIを保持したままUTF-8文字列へ変換する。 */
export function decodeNullSeparatedUtf8(output: Buffer): string[] {
  if (output.length === 0) return [];
  if (output.at(-1) !== 0) throw new Error('NUL区切りGit出力が終端NULを持ちません');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries: string[] = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0) continue;
    entries.push(decoder.decode(output.subarray(start, index)));
    start = index + 1;
  }
  return entries;
}

// Node既定の1MiB上限だと大規模diff等（例: mainとの初回統合マージの全差分）でENOBUFSになるため拡張する。
const MAX_BUFFER_BYTES = 256 * 1024 * 1024;

export function run(
  command: string,
  args: string[],
  cwd?: string,
  input?: string,
  env?: NodeJS.ProcessEnv,
): ExecResult {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', input, env, maxBuffer: MAX_BUFFER_BYTES });
  if (result.error) {
    return { status: 127, stdout: '', stderr: String(result.error.message) };
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Git object等を文字コード変換せずexact bytesで読むためのbinary subprocess境界。 */
export function runBinary(command: string, args: string[], cwd?: string): BinaryExecResult {
  const result = spawnSync(command, args, { cwd, encoding: null, maxBuffer: MAX_BUFFER_BYTES });
  if (result.error) {
    return { status: 127, stdout: Buffer.alloc(0), stderr: String(result.error.message) };
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: (result.stderr ?? Buffer.alloc(0)).toString('utf8'),
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

export function gitBinary(args: string[], cwd?: string): BinaryExecResult {
  return runBinary('git', args, cwd);
}

export function gh(args: string[], cwd?: string, input?: string, env?: NodeJS.ProcessEnv): ExecResult {
  return run('gh', args, cwd, input, env);
}

export function commandExists(command: string): boolean {
  const probe = run(process.platform === 'win32' ? 'where' : 'which', [command]);
  return probe.status === 0;
}
