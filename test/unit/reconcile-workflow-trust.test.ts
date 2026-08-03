import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readYamlFile } from '../../src/lib/yaml-io.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'agent-skill-chain-reconcile.yml');

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  'continue-on-error'?: boolean;
}

interface ReconcileWorkflow {
  on: { pull_request_target: { types: string[] } };
  jobs: { reconcile: { if: string; steps: WorkflowStep[] } };
}

function workflow(): ReconcileWorkflow {
  return readYamlFile<ReconcileWorkflow>(WORKFLOW_PATH);
}

function stepNamed(name: string): WorkflowStep {
  const step = workflow().jobs.reconcile.steps.find((candidate) => candidate.name === name);
  assert.ok(step, `step '${name}' が存在すること`);
  return step;
}

function runDetection(gitShowOutput: string, gitExit = 0) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-workflow-detect-'));
  const gitPath = path.join(dir, 'git');
  fs.writeFileSync(
    gitPath,
    '#!/bin/sh\nprintf "%s" "$GIT_SHOW_OUTPUT"\nexit "${GIT_SHOW_EXIT:-0}"\n',
    { mode: 0o755 },
  );
  const step = stepNamed('Detect unmigrated reconcile workflow');
  const result = spawnSync('bash', ['-euo', 'pipefail', '-c', step.run ?? ''], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}${path.delimiter}${process.env.PATH}`,
      HEAD_SHA: 'a'.repeat(40),
      GIT_SHOW_OUTPUT: gitShowOutput,
      GIT_SHOW_EXIT: String(gitExit),
    },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

test('reconcile workflowはprotected baseをcheckoutしPR headをread-only objectとしてfetchする', () => {
  const parsed = workflow();
  assert.deepEqual(parsed.on.pull_request_target.types, ['synchronize']);
  assert.equal(
    parsed.jobs.reconcile.if,
    'github.event.pull_request.base.ref == github.event.repository.default_branch',
  );
  const checkout = stepNamed('Checkout protected base trust root');
  assert.equal(checkout.uses, 'actions/checkout@v7');
  assert.equal(checkout.with?.ref, '${{ github.event.pull_request.base.sha }}');
  assert.equal(checkout.with?.['fetch-depth'], 0);
  assert.equal(checkout.with?.['persist-credentials'], false);
  const fetch = stepNamed('Fetch target as read-only Git object');
  assert.match(fetch.run ?? '', /git fetch --no-tags origin/);
  assert.match(fetch.run ?? '', /refs\/agent-skill-chain\/targets\/\$\{HEAD_SHA\}/);
});

test('未移行のblock-style push workflowにはwarningを出す', () => {
  const oldWorkflow = "on:\n  push:\n    branches-ignore: [main, 'chore/root-cleanup-*']\n";
  const result = runDetection(oldWorkflow);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /::warning::/);
});

test('移行済みpull_request_target workflowにはwarningを出さない', () => {
  const migratedWorkflow = 'on:\n  pull_request_target:\n    types: [synchronize]\n';
  const result = runDetection(migratedWorkflow);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /::warning::/);
});

test('PR headにworkflowが無くgit showが失敗しても後続reconcile stepを止めない契約である', () => {
  const steps = workflow().jobs.reconcile.steps;
  const detectionIndex = steps.findIndex((step) => step.name === 'Detect unmigrated reconcile workflow');
  const reconcileIndex = steps.findIndex((step) => step.name === 'Reconcile gates against pushed SHA');
  const detection = steps[detectionIndex];
  const result = runDetection('', 128);
  assert.notEqual(result.status, 0);
  assert.equal(detection['continue-on-error'], true);
  assert.ok(reconcileIndex > detectionIndex, '失敗を許容する検知stepより後にreconcile stepが存在すること');
});
