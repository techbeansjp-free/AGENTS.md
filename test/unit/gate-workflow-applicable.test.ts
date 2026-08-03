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

test('detect-segments job outputsはapplicableをResolve immutable contextのstep出力から取得する', () => {
  assert.equal(
    workflow().jobs['detect-segments'].outputs.applicable,
    "${{ steps.context.outputs.applicable }}",
  );
});

test('Issue命名規則に一致するbranchはapplicable=trueでissue_idを解決する', () => {
  const result = runResolveContext('feature/123-user-authentication', 'someone');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(outputValue(result.outputs, 'applicable'), 'true');
  assert.equal(outputValue(result.outputs, 'issue_id'), 'ISSUE-123');
});

test('dependabot/*かつPR作成者がdependabot[bot]の場合のみapplicable=falseとする', () => {
  const result = runResolveContext('dependabot/npm_and_yarn/foo-1.0.0', 'dependabot[bot]');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(outputValue(result.outputs, 'applicable'), 'false');
  assert.equal(outputValue(result.outputs, 'issue_id'), '');
});

test('dependabot/*ブランチでもPR作成者がdependabot[bot]でなければfail-closedでexitする（なりすまし防止）', () => {
  const result = runResolveContext('dependabot/npm_and_yarn/foo-1.0.0', 'someone-else');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dependabot\[bot\]/);
});

test('chore/root-cleanup-*ブランチはapplicable=falseとする', () => {
  const result = runResolveContext('chore/root-cleanup-20260101', 'someone');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(outputValue(result.outputs, 'applicable'), 'false');
});

test('許可リストに該当しない任意のbranch名はfail-closedでexitし、無審査success付与を許さない（ISSUE-374回帰）', () => {
  const result = runResolveContext('patch-1', 'someone');
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.outputs, /applicable=false/);
});

test('mark-not-applicable jobはdetect-segmentsのapplicableがtrue以外の場合のみ実行される', () => {
  assert.equal(
    workflow().jobs['mark-not-applicable'].if,
    "github.event.pull_request.base.ref == github.event.repository.default_branch && needs.detect-segments.outputs.applicable != 'true'",
  );
});
