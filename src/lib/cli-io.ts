export function printUsage(text: string): void {
  process.stdout.write(`${text.trim()}\n`);
}

export function fail(message: string): number {
  process.stderr.write(`${message}\n`);
  return 1;
}

export function ok(message?: string): number {
  if (message !== undefined) process.stdout.write(`${message}\n`);
  return 0;
}

export function isHelp(args: string[]): boolean {
  return args[0] === '-h' || args[0] === '--help';
}

import { CliError } from './issue.js';

/** ハンドラ本体を try/catch し、CliError は使い方エラーとして stderr + exit 1 に正規化する。 */
export async function guard(fn: () => Promise<number> | number): Promise<number> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof CliError) {
      return fail(error.message);
    }
    const message = error instanceof Error ? error.message : String(error);
    return fail(`予期しないエラー: ${message}`);
  }
}
