import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readYamlFile } from '../../src/lib/yaml-io.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflowFiles = [
  path.join(repoRoot, '.github', 'workflows', 'agent-skill-chain-ci.yml'),
  path.join(repoRoot, '.agent-skill-chain', 'templates', 'github', '.github', 'workflows', 'agent-skill-chain-ci.yml'),
];

interface Step {
  name?: string;
  id?: string;
  if?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}

interface Workflow {
  permissions: Record<string, string>;
  jobs: { verify: { steps: Step[] } };
}

function workflow(file: string): Workflow {
  return readYamlFile<Workflow>(file);
}

function namedStep(steps: Step[], name: string): Step {
  const step = steps.find((candidate) => candidate.name === name);
  assert.ok(step, `ステップ '${name}' が存在すること`);
  return step;
}

for (const file of workflowFiles) {
  const relative = path.relative(repoRoot, file);

  test(`${relative}: 必須成果物検査へIssue読み取り権限・トークン・リポジトリ識別子を与える`, () => {
    const definition = workflow(file);
    assert.equal(definition.permissions.issues, 'read');
    const step = namedStep(definition.jobs.verify.steps, 'verify-artifacts (対象集合を一括検査)');
    assert.equal(step.env?.GH_TOKEN, '${{ github.token }}');
    assert.equal(step.env?.GH_REPO, '${{ github.repository }}');
  });

  test(`${relative}: skip_checks=trueでは必須成果物検査を1回も実行しないガードを固定する（AC-1）`, () => {
    const step = namedStep(workflow(file).jobs.verify.steps, 'verify-artifacts (対象集合を一括検査)');
    assert.ok(step.if?.includes("steps.ctx.outputs.skip_checks != 'true'"));
  });

  test(`${relative}: S導出前提と失敗伝播を静的に固定する`, () => {
    const steps = workflow(file).jobs.verify.steps;
    const checkoutIndex = steps.findIndex((step) => step.uses === 'actions/checkout@v7.0.1');
    const fetchIndex = steps.findIndex((step) => step.name === 'Fetch base branch for diff-based checks');
    const detectIndex = steps.findIndex((step) => step.name === 'Detect started segments');
    assert.ok(checkoutIndex >= 0 && fetchIndex > checkoutIndex && detectIndex > fetchIndex);
    assert.equal(steps[checkoutIndex].with?.['fetch-depth'], 0);

    const run = steps[detectIndex].run ?? '';
    assert.match(run, /detected="\$\(\.\/\.agent-skill-chain\/scripts\/detect-changed-segments\.sh "\$BASE_REF"\)"/);
    assert.match(run, /values="\$\(paste -sd, - <<< "\$detected"\)"/);
    assert.doesNotMatch(run, /detect-changed-segments\.sh[^\n]*\|/);
  });

  test(`${relative}: base fetchはremote-trackingブランチの更新先を明示する`, () => {
    const fetchCommands = workflow(file).jobs.verify.steps.flatMap((step) =>
      (step.run ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('git fetch origin ')),
    );
    assert.equal(fetchCommands.length, 3);
    for (const command of fetchCommands) {
      assert.equal(command, 'git fetch origin "refs/heads/$BASE_REF:refs/remotes/origin/$BASE_REF"');
    }
  });

  test(`${relative}: ワークフローはSだけを一括で渡しRの導出規則を持たない`, () => {
    const steps = workflow(file).jobs.verify.steps;
    const step = namedStep(steps, 'verify-artifacts (対象集合を一括検査)');
    assert.match(step.run ?? '', /--started-segments/);
    assert.doesNotMatch(step.run ?? '', /spec,design|implementation,validation|閉包|upstream/);
    assert.doesNotMatch(steps.map((candidate) => candidate.run ?? '').join('\n'), /addedByClosure|deriveArtifactTargets/);
  });
}

test('展開結果と配布テンプレートのCIワークフローは完全一致する', () => {
  assert.equal(fs.readFileSync(workflowFiles[0], 'utf8'), fs.readFileSync(workflowFiles[1], 'utf8'));
});

test('Detect started segments段は導出コマンドの非0終了を空のSへ読み替えない', () => {
  const steps = workflow(workflowFiles[0]).jobs.verify.steps;
  const run = namedStep(steps, 'Detect started segments').run ?? '';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue741-detect-step-'));
  try {
    const scriptDir = path.join(dir, '.agent-skill-chain', 'scripts');
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.writeFileSync(path.join(scriptDir, 'detect-changed-segments.sh'), '#!/usr/bin/env bash\nexit 17\n', {
      mode: 0o755,
    });
    const output = path.join(dir, 'github-output');
    fs.writeFileSync(output, '');
    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-c', run], {
      cwd: dir,
      env: { ...process.env, BASE_REF: 'main', GITHUB_OUTPUT: output },
      encoding: 'utf8',
    });
    assert.equal(result.status, 17);
    assert.equal(fs.readFileSync(output, 'utf8'), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('開始済みセグメント導出はbase解決失敗と差分算出失敗を区別して非0終了する', () => {
  const script = path.join(repoRoot, '.agent-skill-chain', 'scripts', 'detect-changed-segments.sh');
  const missingBase = spawnSync(script, ['branch-that-does-not-exist'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(missingBase.status, 1);
  assert.match(missingBase.stderr, /base branchを解決できません/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue741-unrelated-histories-'));
  try {
    execFileSync('git', ['init', '--initial-branch=main'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'main.txt'), 'main\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'main'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['checkout', '--orphan', 'feature'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['rm', '-rf', '.'], { cwd: dir, stdio: 'pipe' });
    fs.writeFileSync(path.join(dir, 'feature.txt'), 'feature\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'feature'], { cwd: dir, stdio: 'pipe' });

    const noMergeBase = spawnSync(script, ['main'], { cwd: dir, encoding: 'utf8' });
    assert.equal(noMergeBase.status, 1);
    assert.match(noMergeBase.stderr, /git diff failed for main\.\.\.HEAD/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
