import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const deployedWorkflowPath = path.join(root, '.github', 'workflows', 'agent-skill-chain-release.yml');
const templateWorkflowPath = path.join(
  root,
  '.agent-skill-chain',
  'templates',
  'github',
  '.github',
  'workflows',
  'agent-skill-chain-release.yml',
);
const deployedRootCleanupPath = path.join(root, '.github', 'workflows', 'agent-skill-chain-root-cleanup.yml');
const templateRootCleanupPath = path.join(
  root,
  '.agent-skill-chain',
  'templates',
  'github',
  '.github',
  'workflows',
  'agent-skill-chain-root-cleanup.yml',
);
const securityPolicyPath = path.join(root, '.agent-skill-chain', 'standards', 'SECURITY_POLICY.md');

test('release workflow: consumer向け配布テンプレートには存在しない', () => {
  assert.equal(fs.existsSync(templateWorkflowPath), false);
});

test('release workflow: 本体専用ファイルは既存のrelease契約を保持する', () => {
  assert.equal(fs.existsSync(deployedWorkflowPath), true);
  const workflow = fs.readFileSync(deployedWorkflowPath, 'utf8');

  assert.match(workflow, /name: agent-skill-chain \/ release/);
  assert.match(workflow, /on:\n  push:\n    branches: \[main\]/);
  assert.match(workflow, /jobs:\n  release:/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ secrets\.RELEASE_MAIN_PAT \}\}/);
  assert.match(workflow, /release-resolve-version\.sh/);
  assert.match(workflow, /release-bump\.sh/);
  assert.match(workflow, /release-tag\.sh/);
  assert.match(workflow, /release-publish\.sh/);
});

test('root-cleanup: consumer向けコメントとPAT運用方針が自己完結している', () => {
  const deployed = fs.readFileSync(deployedRootCleanupPath, 'utf8');
  const template = fs.readFileSync(templateRootCleanupPath, 'utf8');
  const policy = fs.readFileSync(securityPolicyPath, 'utf8');

  assert.equal(deployed, template);
  assert.doesNotMatch(template, /agent-skill-chain-release\.yml/);
  assert.match(template, /secrets\.RELEASE_MAIN_PAT/);
  assert.match(policy, /secrets\.RELEASE_MAIN_PAT/);
  assert.match(policy, /admin mergeできるPAT/);
  assert.match(policy, /未設定の場合[\s\S]*認証エラーで失敗/);
  assert.match(policy, /required status checksに含まれない/);
  assert.match(policy, /通常のPRのマージ可否には影響しない/);
});
