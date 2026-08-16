import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const wrapperMarker = '# >>> agent-skill-chain CLI resolver preamble >>>';
export const adapterWrappers = [
  '.agent-skill-chain/adapters/claude.sh',
  '.agent-skill-chain/adapters/human.sh',
] as const;

function shellFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return shellFiles(absolute);
    return entry.isFile() && entry.name.endsWith('.sh') ? [absolute] : [];
  });
}

export function wrapperTargets(root = packageRoot): string[] {
  const assetRoot = path.join(root, '.agent-skill-chain');
  return shellFiles(assetRoot)
    .filter((file) => fs.readFileSync(file, 'utf8').includes(wrapperMarker))
    .map((file) => path.relative(root, file).split(path.sep).join('/'))
    .sort();
}

export interface WrapperFixture {
  root: string;
  cleanup(): void;
}

export function createWrapperFixture(): WrapperFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue677-wrappers-'));
  fs.cpSync(path.join(packageRoot, '.agent-skill-chain'), path.join(root, '.agent-skill-chain'), { recursive: true });
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

export function wrapperArgs(relative: string, fixtureRoot: string): string[] {
  if (relative.endsWith('/worker-launch.sh')) return ['ISSUE-677', 'implementation'];
  if (relative.endsWith('/worker-launch-verify.sh')) {
    const dispatch = path.join(fixtureRoot, 'agent-skill-chain-worker-dispatch.test');
    fs.mkdirSync(dispatch, { recursive: true });
    return ['ISSUE-677', dispatch];
  }
  if (relative.endsWith('/gate-launch-reviewer.sh')) {
    return ['ISSUE-677', 'implementation', 'standard', path.join(fixtureRoot, 'gate-report.yaml'), '0'.repeat(40)];
  }
  if (adapterWrappers.includes(relative as (typeof adapterWrappers)[number])) {
    return ['gate', 'reviewer-context', 'ISSUE-677'];
  }
  return ['issue677 argument', '--issue677-flag'];
}

export function runWrapper(
  fixtureRoot: string,
  relative: string,
  env: NodeJS.ProcessEnv,
): SpawnSyncReturns<string> {
  const absolute = path.join(fixtureRoot, relative);
  const args = wrapperArgs(relative, fixtureRoot);
  if (adapterWrappers.includes(relative as (typeof adapterWrappers)[number])) {
    const driver = 'set -uo pipefail; source "$1" || exit $?; shift; _asc_cli "$@"';
    return spawnSync('bash', ['-c', driver, '_', absolute, ...args], {
      cwd: fixtureRoot,
      env,
      encoding: 'utf8',
      timeout: 3000,
    });
  }
  return spawnSync('bash', [absolute, ...args], { cwd: fixtureRoot, env, encoding: 'utf8', timeout: 3000 });
}

export function writeExecutable(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { mode: 0o755 });
}

export function installNodeCliStub(fixtureRoot: string, recordFile: string): void {
  const stub = [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    'const args = process.argv.slice(2);',
    `fs.appendFileSync(${JSON.stringify(recordFile)}, JSON.stringify(args) + '\\n');`,
    "if (args[0] === 'worker' && args[1] === 'context') {",
    "  console.log('worktree_path=' + process.env.ASC_TEST_FIXTURE_ROOT);",
    "  console.log('adapter=issue677-invalid');",
    '}',
    "if (args[0] === 'gate' && args[1] === 'reviewer-context') {",
    "  console.log('adapter=issue677-invalid');",
    "  console.log('core_review_required=false');",
    "  console.log('core_review_status=not_required');",
    "  console.log('core_required_profile=strict');",
    '}',
    '',
  ].join('\n');
  writeExecutable(path.join(fixtureRoot, 'bin', 'agents-md.js'), stub);
}

export function readArgvRecords(recordFile: string): string[][] {
  if (!fs.existsSync(recordFile)) return [];
  return fs
    .readFileSync(recordFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}
