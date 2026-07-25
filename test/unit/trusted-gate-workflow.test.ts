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
    'actions: read',
    'contents: read',
    'pull-requests: read',
    'issues: read',
    'attestations: write',
    'id-token: write',
    'artifact-metadata: write',
  ]) {
    assert.match(workflow, new RegExp(permission));
  }
  assert.doesNotMatch(workflow, /checks:\s*write/);
  assert.match(workflow, /Checks write、Metadata read/);
  assert.doesNotMatch(workflow, /Commit statuses write/);
});

test('trusted gate workflowは固定attest actionとexact gh verificationを使い全経路をterminalにする', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /actions\/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0/);
  assert.match(workflow, /ref: \$\{\{ github\.workflow_sha \}\}/);
  assert.doesNotMatch(workflow, /with:\n\s+ref: refs\/heads\/main/);
  assert.match(workflow, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/);
  assert.match(
    workflow,
    /actions\/attest@f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6/,
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
  const abort = workflow.indexOf('gate record-trusted-check abort');
  assert.ok(abort > finalize);
  assert.match(workflow.slice(finalize, abort), /if: \$\{\{ failure\(\) \}\}/);
  assert.doesNotMatch(workflow.slice(abort), /if \[\[ -f .*trusted-gate-state/);
  assert.equal(workflow.slice(abort).includes('\n      - name:'), false);
  assert.doesNotMatch(workflow, /uses:\s+\S+@v[0-9]/);
});
