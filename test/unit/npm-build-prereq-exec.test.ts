// Issue #536: 配布CIテンプレートの npm ci / npm run build は、agent-skill-chain自身のビルド前提を
// consumerへ無条件に持ち込み、package.json・lockfile・build scriptを持たないconsumerでCIが
// 恒常的に失敗していた。本テストは「Detect npm build prerequisites」ステップのbash実体を
// 実際のファイルシステム上（fixture ディレクトリ）で実行し、各技術構成の組み合わせで
// npm ci/npm run build 実行要否の判定が実測どおりであることを検証する
// （静的パーステスト dependabot-ci-skip.test.ts が YAML 構造自体を固定するのに対し、
// 本テストは run スクリプト本文の挙動を bash 実行で検証する）。
// npm ci/buildのスキップだけでは、後続の各検査スクリプトが依存するagent-skill-chain CLIが
// 用意されず「CLIが見つからない」という別のエラーへ失敗ポイントが移動するだけになる
// （PR #541 レビュー指摘）。本ファイル後半は「Ensure agent-skill-chain CLI」ステップのbash実体を
// 同様にfixture上で実行し、3経路（bin/agents-md.js・node_modules/.bin/agent-skill-chain・PATH）
// のいずれかが既にあれば npm install を呼ばないこと、非Node consumer（package.jsonが無い＝
// 3経路いずれも無いケース）でのみ GitHub リポジトリからの npm install -g を呼び、その結果
// CLIがPATH上で解決可能になる（＝後続のverify-branch-name等がCLI未検出で失敗しない）ことを検証する。
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
const CI_BODY = path.join(REPO_ROOT, '.github', 'workflows', 'agent-skill-chain-ci.yml');

interface Step {
  id?: string;
  name?: string;
  run?: string;
}

interface Workflow {
  jobs: Record<string, { steps: Step[] }>;
}

function prereqStepRun(): string {
  const wf = readYamlFile<Workflow>(CI_BODY);
  const step = wf.jobs.verify.steps.find((s) => s.id === 'npm-prereq');
  assert.ok(step?.run, "id 'npm-prereq' の run ステップが存在すること");
  return step.run as string;
}

interface Outputs {
  ci?: string;
  build?: string;
}

function runPrereqStep(files: Record<string, string>): Outputs {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue536-npm-prereq-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    const script = path.join(dir, 'step.sh');
    const outFile = path.join(dir, 'github_output');
    fs.writeFileSync(script, prereqStepRun());
    fs.writeFileSync(outFile, '');
    const res = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', script], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? '', GITHUB_OUTPUT: outFile },
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, `Detect npm build prerequisites の実行自体は常に成功すること（stderr: ${res.stderr}）`);
    const outputs: Outputs = {};
    for (const line of fs.readFileSync(outFile, 'utf8').split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) {
        const key = line.slice(0, eq);
        const value = line.slice(eq + 1);
        if (key === 'ci' || key === 'build') outputs[key] = value;
      }
    }
    return outputs;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('npm build prereq: package.json も lockfile も無い consumer は ci=false, build=false', () => {
  const outputs = runPrereqStep({});
  assert.equal(outputs.ci, 'false');
  assert.equal(outputs.build, 'false');
});

test('npm build prereq: package.json はあるが build script が無い consumer は ci に依存し build=false', () => {
  const outputs = runPrereqStep({
    'package.json': JSON.stringify({ name: 'consumer', scripts: { test: 'echo ok' } }),
    'package-lock.json': '{}',
  });
  assert.equal(outputs.ci, 'true');
  assert.equal(outputs.build, 'false');
});

test('npm build prereq: package.json はあるが lockfile が無い consumer は ci=false', () => {
  const outputs = runPrereqStep({
    'package.json': JSON.stringify({ name: 'consumer', scripts: { build: 'echo build' } }),
  });
  assert.equal(outputs.ci, 'false');
});

test('npm build prereq: package.json・lockfile・build script を全て持つ（agent-skill-chain自身相当）consumerは ci=true, build=true', () => {
  const outputs = runPrereqStep({
    'package.json': JSON.stringify({ name: 'agent-skill-chain', scripts: { build: 'tsc' } }),
    'package-lock.json': '{}',
  });
  assert.equal(outputs.ci, 'true');
  assert.equal(outputs.build, 'true');
});

test('npm build prereq: npm-shrinkwrap.json のみ持つ consumer も ci=true', () => {
  const outputs = runPrereqStep({
    'package.json': JSON.stringify({ name: 'consumer' }),
    'npm-shrinkwrap.json': '{}',
  });
  assert.equal(outputs.ci, 'true');
});

// --- Ensure agent-skill-chain CLI ステップの実行検証 ---

function ensureCliStepRun(): string {
  const wf = readYamlFile<Workflow>(CI_BODY);
  const step = wf.jobs.verify.steps.find((s) => s.name === 'Ensure agent-skill-chain CLI');
  assert.ok(step?.run, "'Ensure agent-skill-chain CLI' の run ステップが存在すること");
  return step.run as string;
}

interface EnsureCliResult {
  status: number | null;
  stderr: string;
  npmArgs: string[];
  pathHasCli: boolean;
}

// dir をワークスペース（cwd）とし、mockBinDir を PATH 先頭に置く。mockBinDir には常に
// 記録専用の mock npm を置き、setup コールバックで各テストケースの技術構成
// （bin/agents-md.js・node_modules/.bin/agent-skill-chain・PATH上のagent-skill-chain）を用意する。
// mock npm は「install -g」呼び出し時、実際のnpm install -gが行うのと同様にmockBinDir配下へ
// agent-skill-chain実行ファイルを配置する（グローバルbinが既にPATH上にあるCI環境を模する）。
function runEnsureCliStep(setup: (dir: string, mockBinDir: string) => void): EnsureCliResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue536-ensure-cli-'));
  const mockBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue536-mockbin-'));
  const globalPrefix = path.join(mockBinDir, 'global');
  const globalBinDir = path.join(globalPrefix, 'bin');
  const npmLog = path.join(mockBinDir, 'npm.invocations.log');
  try {
    const sharedDir = path.join(dir, '.agent-skill-chain', 'scripts');
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.copyFileSync(
      path.join(REPO_ROOT, '.agent-skill-chain', 'scripts', 'cli-resolve.sh'),
      path.join(sharedDir, 'cli-resolve.sh'),
    );
    setup(dir, mockBinDir);

    const npmMock = path.join(mockBinDir, 'npm');
    fs.writeFileSync(
      npmMock,
      [
        '#!/usr/bin/env bash',
        `echo "$@" >> "${npmLog}"`,
        'if [[ "$1" == "prefix" && "$2" == "-g" ]]; then',
        `  printf '%s\\n' "${globalPrefix}"`,
        '  exit 0',
        'fi',
        'if [[ "$1" == "install" && "$2" == "-g" ]]; then',
        `  printf '#!/usr/bin/env bash\\necho mock-agent-skill-chain\\n' > "${mockBinDir}/agent-skill-chain"`,
        `  chmod +x "${mockBinDir}/agent-skill-chain"`,
        'fi',
        'exit 0',
        '',
      ].join('\n'),
    );
    fs.chmodSync(npmMock, 0o755);

    const script = path.join(dir, 'step.sh');
    fs.writeFileSync(script, ensureCliStepRun());
    const res = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', script], {
      cwd: dir,
      env: { PATH: `${globalBinDir}:${mockBinDir}:${process.env.PATH ?? ''}` },
      encoding: 'utf8',
    });
    const npmArgs = fs.existsSync(npmLog) ? fs.readFileSync(npmLog, 'utf8').trim().split('\n').filter(Boolean) : [];

    // フォールバック導入後、後続ステップ（verify-branch-name.sh等）と同じ`command -v`判定で
    // CLIが解決可能になっているかを実測する。
    const probe = spawnSync('bash', ['-c', 'command -v agent-skill-chain'], {
      cwd: dir,
      env: { PATH: `${mockBinDir}:${process.env.PATH ?? ''}` },
      encoding: 'utf8',
    });

    return { status: res.status, stderr: res.stderr, npmArgs, pathHasCli: probe.status === 0 };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(mockBinDir, { recursive: true, force: true });
  }
}

test('Ensure CLI: bin/agents-md.js がある場合は npm install を呼ばない', () => {
  const result = runEnsureCliStep((dir) => {
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'bin', 'agents-md.js'), '// mock');
  });
  assert.equal(result.status, 0, `ステップは成功終了すること（stderr: ${result.stderr}）`);
  assert.deepEqual(result.npmArgs, [], 'npmは一切呼ばれないこと');
});

test('Ensure CLI: node_modules/.bin/agent-skill-chain がある場合は npm install を呼ばない', () => {
  const result = runEnsureCliStep((dir) => {
    fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
    const bin = path.join(dir, 'node_modules', '.bin', 'agent-skill-chain');
    fs.writeFileSync(bin, '#!/usr/bin/env bash\necho mock\n');
    fs.chmodSync(bin, 0o755);
  });
  assert.equal(result.status, 0, `ステップは成功終了すること（stderr: ${result.stderr}）`);
  assert.deepEqual(result.npmArgs, [], 'npmは一切呼ばれないこと');
});

test('Ensure CLI: PATH上にagent-skill-chainが既にある場合は npm install を呼ばない', () => {
  const result = runEnsureCliStep((_dir, mockBinDir) => {
    const bin = path.join(mockBinDir, 'agent-skill-chain');
    fs.writeFileSync(bin, '#!/usr/bin/env bash\necho preexisting\n');
    fs.chmodSync(bin, 0o755);
  });
  assert.equal(result.status, 0, `ステップは成功終了すること（stderr: ${result.stderr}）`);
  assert.deepEqual(result.npmArgs, [], 'npmは一切呼ばれないこと');
});

test('Ensure CLI: 非Node consumer（package.json・3経路いずれも無い）はGitHubからCLIを導入し、以後PATHで解決可能になる', () => {
  const result = runEnsureCliStep(() => {
    // 何も用意しない = package.jsonすら無いnon-Node consumerを模す
  });
  assert.equal(result.status, 0, `ステップは成功終了すること（stderr: ${result.stderr}）`);
  assert.deepEqual(
    result.npmArgs,
    ['install -g github:techbeansjp-free/AGENTS.md', 'prefix -g'],
    '自動導入後にグローバルprefixを取得して再解決すること',
  );
  assert.ok(
    result.pathHasCli,
    'フォールバック導入後、verify-branch-name.sh等と同じ command -v agent-skill-chain 判定でCLIが見つかること（＝CLI未検出エラーへ失敗ポイントが移動しないこと）',
  );
});
