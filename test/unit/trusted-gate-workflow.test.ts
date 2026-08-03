import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const workflowPath = path.join(root, '.github', 'workflows', 'agent-skill-chain-trusted-gate.yml');
const templatePath = path.join(
  root,
  '.agent-skill-chain',
  'templates',
  'github',
  '.github',
  'workflows',
  'agent-skill-chain-trusted-gate.yml',
);

test('trusted gate workflowはdispatch/environment/concurrency/GITHUB_TOKEN権限を最小固定する', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.equal(workflow, fs.readFileSync(templatePath, 'utf8'));
  assert.match(workflow, /types: \[agent-skill-chain-gate-record\]/);
  assert.match(workflow, /environment: agent-skill-chain-gate-bootstrap-v1/);
  assert.match(
    workflow,
    /group: gate-record-\$\{\{ github\.repository \}\}-\$\{\{ github\.event\.client_payload\.pr_number \}\}-\$\{\{ github\.event\.client_payload\.gate \}\}/,
  );
  assert.match(workflow, /cancel-in-progress: false/);
  for (const permission of [
    'contents: read',
    'pull-requests: read',
    'issues: write',
    'attestations: write',
    'id-token: write',
    'artifact-metadata: write',
  ]) {
    assert.match(workflow, new RegExp(permission));
  }
  assert.doesNotMatch(workflow, /checks:\s*write/);
  assert.match(workflow, /Checks write、Commit statuses write、Metadata read/);
});

test('trusted gate workflowは固定attest actionとexact gh verificationを使いfinalizeを最終stepにする', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
  assert.match(workflow, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/);
  assert.match(
    workflow,
    /actions\/attest@508db95dd578ae2727ebd6217d5ba78e4fbda05d/,
  );
  assert.match(
    workflow,
    /--signer-workflow "\$GITHUB_REPOSITORY\/\.github\/workflows\/agent-skill-chain-trusted-gate\.yml"/,
  );
  assert.match(workflow, /--source-ref refs\/heads\/main/);
  assert.match(workflow, /--signer-digest "\$GITHUB_WORKFLOW_SHA"/);
  assert.match(workflow, /--format json/);
  const finalize = workflow.indexOf('gate record-trusted-check finalize');
  assert.ok(finalize > 0);
  assert.equal(workflow.slice(finalize).includes('\n      - name:'), false);
  assert.doesNotMatch(workflow, /uses:\s+\S+@v[0-9]/);
});
