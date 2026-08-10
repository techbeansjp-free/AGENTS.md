// Issue #536: 配布CIテンプレートの npm ci / npm run build は、agent-skill-chain自身のビルド前提を
// consumerへ無条件に持ち込み、package.json・lockfile・build scriptを持たないconsumerでCIが
// 恒常的に失敗していた。本テストは「Detect npm build prerequisites」ステップのbash実体を
// 実際のファイルシステム上（fixture ディレクトリ）で実行し、各技術構成の組み合わせで
// npm ci/npm run build 実行要否の判定が実測どおりであることを検証する
// （静的パーステスト dependabot-ci-skip.test.ts が YAML 構造自体を固定するのに対し、
// 本テストは run スクリプト本文の挙動を bash 実行で検証する）。
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
