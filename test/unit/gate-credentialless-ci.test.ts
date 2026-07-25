import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workflowPath = path.join(root, '.github', 'workflows', 'agent-skill-chain-gate.yml');
const templatePath = path.join(root, '.agent-skill-chain', 'templates', 'github', '.github', 'workflows', 'agent-skill-chain-gate.yml');

test('gate workflow: protected baseでlocal-review証跡だけを検証しCheck Runを発行する', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.equal(workflow, fs.readFileSync(templatePath, 'utf8'));
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /pull_request_review:/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /gate verify-evidence/);
  assert.match(workflow, /gate-publish\.sh/);
  assert.match(workflow, /conclusion: "action_required"/);
  assert.match(workflow, /without executing target code/);

  const forbidden = [
    ['OPENAI', 'API', 'KEY'].join('_'),
    ['ANTHROPIC', 'API', 'KEY'].join('_'),
    ['openai', 'codex-action', 'v1'].join('/').replace('/v1', '@v1'),
    'Run Codex core reviewer',
    'Run gate reviewer judgment',
    'self-hosted',
  ];
  for (const token of forbidden) assert.equal(workflow.includes(token), false, `CI内AI依存を含まない: ${token}`);
});
