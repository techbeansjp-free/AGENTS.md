import { spawnSync } from 'node:child_process';
import { redactSecrets } from './security.js';

/** @param {string} file @param {string[]} args @param {string} cwd @param {{allowFailure?: boolean}} [options] */
export function run(file, args, cwd, options = {}) {
  const result = spawnSync(file, args, { cwd, encoding: 'utf8', env: process.env });
  const output = { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: redactSecrets(result.stderr ?? '') };
  if (!options.allowFailure && output.status !== 0) {
    const command = redactSecrets(`${file} ${args.join(' ')}`);
    throw new Error(`${command}が失敗しました（終了値${output.status}）: ${output.stderr.trim()}`);
  }
  return output;
}

/** @param {string[]} args @param {string} cwd @param {{allowFailure?: boolean}} [options] */
export function git(args, cwd, options) {
  return run('git', args, cwd, options);
}
