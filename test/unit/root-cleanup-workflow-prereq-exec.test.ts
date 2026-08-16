// Issue #686: root-cleanup 配布ワークフローの npm 前提判定と CLI 保証を、YAML から
// 機械抽出したステップ実体で検証する。構造検査では既存契約と配布物の同期も固定する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readYamlFile } from '../../src/lib/yaml-io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATE = path.join(
  REPO_ROOT,
  '.agent-skill-chain',
  'templates',
  'github',
  '.github',
  'workflows',
  'agent-skill-chain-root-cleanup.yml',
);
const DEPLOYED = path.join(REPO_ROOT, '.github', 'workflows', 'agent-skill-chain-root-cleanup.yml');

interface Step {
  id?: string;
  name?: string;
  if?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  run?: string;
}

interface Workflow {
  on: { push: { branches: string[] } };
  permissions: Record<string, string>;
  jobs: Record<
    string,
    {
      if?: string;
      concurrency?: { group: string; 'cancel-in-progress': boolean };
      steps: Step[];
    }
  >;
}

function workflow(): Workflow {
  return readYamlFile<Workflow>(TEMPLATE);
}

function uniqueStep(predicate: (step: Step) => boolean, label: string): Step {
  const matches = workflow().jobs['root-cleanup'].steps.filter(predicate);
  assert.equal(matches.length, 1, `${label} が一意に存在すること`);
  return matches[0];
}

function extractedRun(step: Step, label: string): string {
  assert.equal(typeof step.run, 'string', `${label} が run 本文を持つこと`);
  const run = step.run as string;
  const indentedBody = run
    .trimEnd()
    .split('\n')
    .map((line) => `          ${line}`)
    .join('\n');
  assert.ok(
    fs.readFileSync(TEMPLATE, 'utf8').includes(indentedBody),
    `${label} の抽出結果が配布正本のブロックスカラー本文と一致すること`,
  );
  return run;
}

function prereqRun(): string {
  return extractedRun(uniqueStep((step) => step.id === 'npm-prereq', 'npm 前提判定ステップ'), 'npm 前提判定ステップ');
}

interface PrereqResult {
  status: number | null;
  stderr: string;
  outputs: Record<string, string>;
}

function runPrereq(files: Record<string, string>): PrereqResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue686-root-cleanup-prereq-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    const script = path.join(dir, 'step.sh');
    const output = path.join(dir, 'github-output');
    fs.writeFileSync(script, prereqRun());
    fs.writeFileSync(output, '');
    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', script], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? '', GITHUB_OUTPUT: output },
      encoding: 'utf8',
    });
    const outputs: Record<string, string> = {};
    for (const line of fs.readFileSync(output, 'utf8').split('\n')) {
      const separator = line.indexOf('=');
      if (separator > 0) outputs[line.slice(0, separator)] = line.slice(separator + 1);
    }
    return { status: result.status, stderr: result.stderr, outputs };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function assertPrereq(files: Record<string, string>, ci: string, build: string): void {
  const result = runPrereq(files);
  assert.equal(result.status, 0, `判定ステップが正常終了すること: ${result.stderr}`);
  assert.deepEqual(result.outputs, { ci, build });
}

test('root-cleanup npm前提: package.jsonもlockfileも無い場合は両手順を実行しない', () => {
  assertPrereq({}, 'false', 'false');
});

test('root-cleanup npm前提: package.json無しでlockfileのみ存在しても両手順を実行しない', () => {
  assertPrereq({ 'package-lock.json': '{}' }, 'false', 'false');
});

test('root-cleanup npm前提: package.json・lockfile・有効なbuild scriptがあれば両手順を実行する', () => {
  assertPrereq(
    {
      'package.json': JSON.stringify({ scripts: { build: 'tsc' } }),
      'npm-shrinkwrap.json': '{}',
    },
    'true',
    'true',
  );
});

for (const [label, packageJson] of [
  ['scripts無し', {}],
  ['buildキー無し', { scripts: { test: 'echo ok' } }],
  ['空文字列', { scripts: { build: '' } }],
  ['空白のみ', { scripts: { build: ' \t ' } }],
  ['null', { scripts: { build: null } }],
  ['文字列以外', { scripts: { build: 42 } }],
] as const) {
  test(`root-cleanup npm前提: ${label}のbuild scriptはnpm ciのみ実行する`, () => {
    assertPrereq(
      { 'package.json': JSON.stringify(packageJson), 'package-lock.json': '{}' },
      'true',
      'false',
    );
  });
}

test('root-cleanup npm前提: lockfileが無ければ有効なbuild scriptがあっても両手順を実行しない', () => {
  assertPrereq({ 'package.json': JSON.stringify({ scripts: { build: 'tsc' } }) }, 'false', 'false');
});

test('root-cleanup npm前提: 解析不能なpackage.jsonではci判定を保ちbuildを実行しない', () => {
  assertPrereq({ 'package.json': '{', 'package-lock.json': '{}' }, 'true', 'false');
});

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
  npmInvocations: string[];
  resolvableAfterRun: boolean;
}

function makeExecutable(file: string, body = '#!/bin/sh\nexit 0\n'): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  fs.chmodSync(file, 0o755);
}

function ensureCliRun(): string {
  return extractedRun(
    uniqueStep((step) => step.name === 'Ensure agent-skill-chain CLI', 'CLI 保証ステップ'),
    'CLI 保証ステップ',
  );
}

function runEnsureCli(
  setup: (dir: string, mockBin: string) => void,
  npmExit = 0,
): CliResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue686-root-cleanup-cli-'));
  const mockBin = fs.mkdtempSync(path.join(os.tmpdir(), 'issue686-root-cleanup-path-'));
  const npmLog = path.join(mockBin, 'npm.log');
  try {
    const scriptDir = path.join(dir, '.agent-skill-chain', 'scripts');
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.copyFileSync(
      path.join(REPO_ROOT, '.agent-skill-chain', 'scripts', 'cli-resolve.sh'),
      path.join(scriptDir, 'cli-resolve.sh'),
    );
    setup(dir, mockBin);
    makeExecutable(
      path.join(mockBin, 'npm'),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${npmLog}"\nexit ${npmExit}\n`,
    );
    const script = path.join(dir, 'step.sh');
    fs.writeFileSync(script, ensureCliRun());
    const env = { PATH: `${mockBin}:/bin`, ASC_CLI_INSTALL_SOURCE: 'github:techbeansjp-free/AGENTS.md' };
    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', script], {
      cwd: dir,
      env,
      encoding: 'utf8',
    });
    const probe = spawnSync(
      'bash',
      [
        '--noprofile',
        '--norc',
        '-e',
        '-o',
        'pipefail',
        '-c',
        'source .agent-skill-chain/scripts/cli-resolve.sh; asc_resolve_cli',
      ],
      { cwd: dir, env: { ...env, AGENT_SKILL_CHAIN_AUTO_INSTALL: '0' }, encoding: 'utf8' },
    );
    const npmInvocations = fs.existsSync(npmLog)
      ? fs.readFileSync(npmLog, 'utf8').trim().split('\n').filter(Boolean)
      : [];
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      npmInvocations,
      resolvableAfterRun: probe.status === 0,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(mockBin, { recursive: true, force: true });
  }
}

test('root-cleanup CLI保証: リポジトリ内ビルド成果物を追加導入なしで解決する', () => {
  const result = runEnsureCli((dir) => {
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'bin', 'agents-md.js'), '');
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /bin\/agents-md\.js/);
  assert.deepEqual(result.npmInvocations, []);
  assert.equal(result.resolvableAfterRun, true);
});

test('root-cleanup CLI保証: node_modules配下の実行ファイルを追加導入なしで解決する', () => {
  const result = runEnsureCli((dir) => makeExecutable(path.join(dir, 'node_modules', '.bin', 'agent-skill-chain')));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /node_modules\/\.bin\/agent-skill-chain/);
  assert.deepEqual(result.npmInvocations, []);
  assert.equal(result.resolvableAfterRun, true);
});

test('root-cleanup CLI保証: PATH上の実行ファイルを追加導入なしで解決する', () => {
  const result = runEnsureCli((_dir, mockBin) => makeExecutable(path.join(mockBin, 'agent-skill-chain')));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PATH上の agent-skill-chain/);
  assert.deepEqual(result.npmInvocations, []);
  assert.equal(result.resolvableAfterRun, true);
});

test('root-cleanup CLI保証: 3経路も自動導入も成立しない場合は理由を出して失敗する', () => {
  const result = runEnsureCli(() => {}, 17);
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.npmInvocations, ['install -g github:techbeansjp-free/AGENTS.md']);
  assert.match(result.stderr, /自動導入に失敗/);
  assert.equal(result.resolvableAfterRun, false);
});

test('root-cleanup構造: npm条件・CLI保証順序・共有resolver参照を固定する', () => {
  const steps = workflow().jobs['root-cleanup'].steps;
  const find = (predicate: (step: Step) => boolean, label: string): Step => {
    const matches = steps.filter(predicate);
    assert.equal(matches.length, 1, `${label} が一意に存在すること`);
    return matches[0];
  };
  const prereq = find((step) => step.id === 'npm-prereq', 'npm 前提判定ステップ');
  const npmCi = find((step) => step.name === 'npm ci', 'npm ci ステップ');
  const npmBuild = find((step) => step.name === 'npm run build', 'npm run build ステップ');
  const ensure = find((step) => step.name === 'Ensure agent-skill-chain CLI', 'CLI 保証ステップ');
  const remove = find((step) => step.name?.startsWith('Remove stray root-level') === true, '除去ステップ');
  const sync = find((step) => step.name === 'Sync local checkout to latest main', 'main 同期ステップ');
  const verify = find((step) => step.name === 'Verify root is clean', 'root clean 検証ステップ');

  assert.equal(npmCi.if, "steps.npm-prereq.outputs.ci == 'true'");
  assert.equal(npmBuild.if, "steps.npm-prereq.outputs.build == 'true'");
  assert.equal(ensure.if, undefined);
  assert.match(ensure.run ?? '', /source \.agent-skill-chain\/scripts\/cli-resolve\.sh/);
  assert.match(ensure.run ?? '', /asc_resolve_cli/);
  assert.ok(!ensure.run?.includes('npm install -g'));
  assert.equal(steps.indexOf(prereq) < steps.indexOf(npmCi), true);
  assert.equal(steps.indexOf(npmCi) < steps.indexOf(npmBuild), true);
  assert.equal(steps.indexOf(npmBuild) < steps.indexOf(ensure), true);
  assert.equal(steps.indexOf(ensure) < steps.indexOf(remove), true);
  assert.equal(steps.indexOf(remove) < steps.indexOf(sync), true);
  assert.equal(steps.indexOf(sync) < steps.indexOf(verify), true);
});

test('root-cleanup構造: 既存の契機・権限・認証情報・除去・同期・検証契約を保つ', () => {
  const definition = workflow();
  const job = definition.jobs['root-cleanup'];
  assert.deepEqual(definition.on, { push: { branches: ['main'] } });
  assert.deepEqual(definition.permissions, { contents: 'write' });
  assert.equal(job.if, "${{ !contains(github.event.head_commit.message, '[skip ci]') }}");
  assert.deepEqual(job.concurrency, { group: 'main-mutator', 'cancel-in-progress': false });

  const checkout = uniqueStep((step) => step.uses === 'actions/checkout@v7.0.1', 'checkout ステップ');
  const setupNode = uniqueStep((step) => step.uses === 'actions/setup-node@v7', 'Node.js セットアップ');
  const remove = uniqueStep((step) => step.name?.startsWith('Remove stray root-level') === true, '除去ステップ');
  const sync = uniqueStep((step) => step.name === 'Sync local checkout to latest main', 'main 同期ステップ');
  const verify = uniqueStep((step) => step.name === 'Verify root is clean', 'root clean 検証ステップ');
  assert.deepEqual(checkout.with, { 'fetch-depth': 0 });
  assert.deepEqual(setupNode.with, { 'node-version': '20' });
  assert.deepEqual(remove.env, { GH_TOKEN: '${{ secrets.RELEASE_MAIN_PAT }}' });
  assert.equal(remove.run?.trim(), './.agent-skill-chain/scripts/root-cleanup.sh');
  assert.equal(sync.run?.trim(), 'git fetch origin main\ngit checkout -B main origin/main');
  assert.deepEqual(verify.env, { GH_TOKEN: '${{ github.token }}' });
  assert.equal(verify.run?.trim(), './.agent-skill-chain/ci/verify-root-clean.sh');
});

test('root-cleanup配布正本と本リポジトリ展開先は完全一致する', () => {
  assert.equal(fs.readFileSync(TEMPLATE, 'utf8'), fs.readFileSync(DEPLOYED, 'utf8'));
});
