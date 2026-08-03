import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readYamlFile } from '../../src/lib/yaml-io.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'agent-skill-chain-gate.yml');

interface WorkflowStep {
  name?: string;
  run?: string;
}

interface DetectSegmentsJob {
  outputs: Record<string, string>;
  steps: WorkflowStep[];
}

interface MarkNotApplicableJob {
  if: string;
}

interface GateWorkflow {
  jobs: {
    'detect-segments': DetectSegmentsJob;
    'mark-not-applicable': MarkNotApplicableJob;
  };
}

function workflow(): GateWorkflow {
  return readYamlFile<GateWorkflow>(WORKFLOW_PATH);
}

function stepNamed(name: string): WorkflowStep {
  const step = workflow().jobs['detect-segments'].steps.find((candidate) => candidate.name === name);
  assert.ok(step, `step '${name}' が存在すること`);
  return step;
}

function runResolveContext(branch: string, prAuthor: string) {
  const step = stepNamed('Resolve immutable context');
  const outputFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gate-workflow-context-')), 'output');
  fs.writeFileSync(outputFile, '');
  const result = spawnSync('bash', ['-euo', 'pipefail', '-c', step.run ?? ''], {
    encoding: 'utf8',
    env: {
      ...process.env,
      BRANCH: branch,
      PR_AUTHOR: prAuthor,
      HEAD_SHA: 'a'.repeat(40),
      BASE_SHA: 'b'.repeat(40),
      PR_NUMBER: '1',
      LABELS_JSON: '[]',
      GITHUB_OUTPUT: outputFile,
    },
  });
  const outputs = fs.readFileSync(outputFile, 'utf8');
  fs.rmSync(path.dirname(outputFile), { recursive: true, force: true });
  return { ...result, outputs };
}

function outputValue(outputs: string, key: string): string | undefined {
  const line = outputs.split('\n').find((candidate) => candidate.startsWith(`${key}=`));
  return line?.slice(key.length + 1);
}

function runDetectSegments(applicable: string) {
  const step = workflow().jobs['detect-segments'].steps.find(
    (candidate) => candidate.name === 'Detect started segments without executing target code',
  );
  assert.ok(step, "step 'Detect started segments without executing target code' が存在すること");
  const outputFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gate-workflow-segments-')), 'output');
  fs.writeFileSync(outputFile, '');
  const result = spawnSync('bash', ['-euo', 'pipefail', '-c', step.run ?? ''], {
    encoding: 'utf8',
    env: {
      ...process.env,
      BASE_SHA: 'HEAD',
      HEAD_SHA: 'HEAD',
      APPLICABLE: applicable,
      GITHUB_OUTPUT: outputFile,
    },
    cwd: REPO_ROOT,
  });
  const outputs = fs.readFileSync(outputFile, 'utf8');
  fs.rmSync(path.dirname(outputFile), { recursive: true, force: true });
  return { ...result, outputs };
}

test('detect-segments job outputsはapplicable/dependabot_trustedをResolve immutable contextのstep出力から取得する', () => {
  const outputs = workflow().jobs['detect-segments'].outputs;
  assert.equal(outputs.applicable, '${{ steps.context.outputs.applicable }}');
  assert.equal(outputs.dependabot_trusted, '${{ steps.context.outputs.dependabot_trusted }}');
});

test('Issue命名規則に一致するbranchはapplicable=trueでissue_idを解決する', () => {
  const result = runResolveContext('feature/123-user-authentication', 'someone');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(outputValue(result.outputs, 'applicable'), 'true');
  assert.equal(outputValue(result.outputs, 'dependabot_trusted'), 'false');
  assert.equal(outputValue(result.outputs, 'issue_id'), 'ISSUE-123');
});

test('dependabot/*かつPR作成者がdependabot[bot]の場合のみdependabot_trusted=trueとする', () => {
  const result = runResolveContext('dependabot/npm_and_yarn/foo-1.0.0', 'dependabot[bot]');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(outputValue(result.outputs, 'applicable'), 'false');
  assert.equal(outputValue(result.outputs, 'dependabot_trusted'), 'true');
  assert.equal(outputValue(result.outputs, 'issue_id'), '');
});

test('dependabot/*ブランチでもPR作成者がdependabot[bot]でなければfail-closedでexitする（なりすまし防止）', () => {
  const result = runResolveContext('dependabot/npm_and_yarn/foo-1.0.0', 'someone-else');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dependabot\[bot\]/);
});

test('許可リストに該当しない任意のbranch名はapplicable=false・dependabot_trusted=falseで(exit 1せず)成功する（release/bump-v*等の内部自動化branchの回帰防止）', () => {
  for (const branch of ['chore/root-cleanup-20260101T000000Z', 'release/bump-v0.2.31', 'patch-1']) {
    const result = runResolveContext(branch, 'someone');
    assert.equal(result.status, 0, `${branch}: ${result.stderr}`);
    assert.equal(outputValue(result.outputs, 'applicable'), 'false', branch);
    assert.equal(outputValue(result.outputs, 'dependabot_trusted'), 'false', branch);
  }
});

test('detect-segmentsのsegments検出stepはapplicable!=trueのとき常にmatrix=[]で成功する', () => {
  const result = runDetectSegments('false');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(outputValue(result.outputs, 'matrix'), '[]');
});

test('mark-not-applicable jobはdependabot_trusted=trueの場合のみ実行される（root-cleanup等の他の非Issueブランチには無条件successを付与しない、ISSUE-374回帰）', () => {
  assert.equal(
    workflow().jobs['mark-not-applicable'].if,
    "github.event.pull_request.base.ref == github.event.repository.default_branch && needs.detect-segments.outputs.dependabot_trusted == 'true'",
  );
});
